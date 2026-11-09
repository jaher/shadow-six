#!/usr/bin/env python3
"""Pack a theatre's ground-fight bake (tools/ui/ground/bake_ground.mjs) for the menu:
 - the sprites, graded exactly as the still is (tools/ui/grade_stills.py's print grade, measured on this very render:
   auto-level, chroma, S-curve, split tone, print range; no vignette or grain), scaled to SCALE still px a px, trimmed,
   shelf-packed -> assets/ui/keyart/ground-<theatre>.webp
 - the depth of the action's regions at the still's 1920 x 1080 (each 2 x 2 block's nearest, so thin occluders hold),
   8 bits over the region's own depth range -> assets/ui/keyart/ground-<theatre>-depth-<n>.png
 - their layout and the camera -> src/ui/ground-data/<theatre>.js
    python3 pack_ground.py <bake dir> <theatre>
"""
import json, os, re, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SCALE, GAP, WIDTH, SHARP = 1.25, 2, 1024, 0.45
# atlas px a still px per theatre: the desert's men stand nearer (31-35 px/m against the river's 19-23), so at 1.1 they
# still get more atlas px per man than the river's at 1.25, and its atlas stays near the others' size
SCALE_OF = {'desert': 1.1}
REGIONS = {   # still px [x0, y0, x1, y1] where actors go, and the depth range (m) their occlusion needs
    # (the W bank's region reaches the W road behind the pillbox, 131-136 m: the tank leaves the frame along it)
    'temperate': [([0, 520, 700, 900], 60.0, 140.0), ([1100, 490, 1920, 700], 98.0, 132.0)],
    'snow': [([0, 470, 720, 700], 78.0, 132.0)],
    'desert': [([0, 640, 1080, 1080], 44.0, 100.0)],
    'coast': [([1140, 490, 1920, 770], 80.0, 140.0)],
}


def still_grade(raw, grade):
    """grade_stills.py's backdrop grade as a function of RGB (0..1), with its auto-level measured on this render."""
    P = {'sat': 0.58, 'warm': 0.8, 'contrast': 0.45, 'exposure': 0.0, 'gamma': 1.08, 'black': 0.04, 'white': 0.955,
         'gain_max': 1.35, 'soften': 0.5}
    P.update(grade or {})
    im = Image.open(raw).convert('RGB').resize((1920, 1080), Image.LANCZOS)
    if P['soften'] > 0:
        im = im.filter(ImageFilter.GaussianBlur(P['soften']))
    a = np.asarray(im).astype(np.float32) / 255.0
    Y = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lo, hi = np.percentile(Y, 0.4), np.percentile(Y, 99.6)
    gain = min(P['gain_max'], 1.0 / max(1e-3, hi - lo))

    def f(a):
        a = (a - lo) * gain * (2.0 ** P['exposure'])
        a = np.clip(a, 0, 1) ** P['gamma']
        Y = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        a = Y[..., None] + (a - Y[..., None]) * P['sat']
        c = P['contrast']
        Ys = np.clip(Y, 0, 1)
        Yc = Ys + c * (Ys * Ys * (3 - 2 * Ys) - Ys)
        a = a + (Yc - Y)[..., None]
        t = np.clip(Yc, 0, 1)[..., None]
        tint = np.array([1.06, 0.98, 0.86], np.float32) * (1 - t) + np.array([1.03, 1.0, 0.93], np.float32) * t
        a = a * (1 + (tint - 1) * P['warm'])
        black = np.array([P['black'] * 1.08, P['black'], P['black'] * 0.86], np.float32)
        white = np.array([P['white'], P['white'] * 0.985, P['white'] * 0.94], np.float32)
        return black + np.clip(a, 0, 1) * (white - black)
    return f


def gblur(a, r):
    """Gaussian blur (sigma r px) of a float [h, w, c] array: a separable kernel, edges clamped."""
    n = max(1, int(np.ceil(3 * r)))
    x = np.arange(-n, n + 1, dtype=np.float32)
    k = np.exp(-x * x / (2 * r * r)); k /= k.sum()
    p = np.pad(a, ((n, n), (n, n), (0, 0)), mode='edge')
    t = np.zeros((p.shape[0], a.shape[1], a.shape[2]), np.float32)
    for i in range(2 * n + 1):
        t += k[i] * p[:, i:i + a.shape[1]]
    out = np.zeros_like(a)
    for i in range(2 * n + 1):
        out += k[i] * t[i:i + a.shape[0]]
    return out


def sprite(path, k, grade):
    """A rendered window -> graded, scaled by k (premultiplied Lanczos from the ZOOM x render: every edge antialiased),
    a light unsharp mask (SHARP: the silhouette, helmet and rifle hold at 18-32 px), trimmed; its offset in the window."""
    im = Image.open(path).convert('RGBA').convert('RGBa')
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0            # premultiplied
    if SHARP > 0:
        a = np.clip(a + SHARP * (a - gblur(a, 0.75)), 0, 1)
        a[..., :3] = np.minimum(a[..., :3], a[..., 3:4])
    al = a[..., 3:4]
    rgb = np.where(al > 1e-4, a[..., :3] / np.maximum(al, 1e-4), 0)
    rgb = grade(np.clip(rgb, 0, 1))
    out = np.concatenate([np.clip(rgb, 0, 1), al], -1)
    img = Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')
    box = img.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox()
    if not box:
        return None, (0, 0)
    x0, y0 = max(0, box[0] - GAP), max(0, box[1] - GAP)
    return img.crop((x0, y0, min(img.width, box[2] + GAP), min(img.height, box[3] + GAP))), (x0, y0)


def main():
    global SCALE
    bake, th = sys.argv[1], sys.argv[2]
    SCALE = SCALE_OF.get(th, SCALE)
    d = os.path.join(bake, th)
    cam = json.load(open(os.path.join(d, 'camera.json')))
    meta = json.load(open(os.path.join(d, 'sprites.json')))
    from importlib import util  # noqa: F401  (stdlib only)
    shot_grade = {}
    grade = still_grade(os.path.join(d, 'still.png'), shot_grade)
    cells = []
    for key, m in meta.items():
        if not isinstance(m, dict) or 'zoom' not in m:
            continue
        k = SCALE / m['zoom']
        img, (ox, oy) = sprite(os.path.join(d, 'sprites', key + '.png'), k, grade)
        if img is None:
            continue
        pt = lambda q: [round(q[0] * k - ox, 1), round(q[1] * k - oy, 1)] if q else None
        # the muzzle (a fire pose's flash) and the right hand (a throw's release) in the cell
        cells.append({'key': key, 'im': img, 'ax': round(m['ax'] * k - ox, 1), 'ay': round(m['ay'] * k - oy, 1), 'pxm': m['pxm'],
                      'muzzle': pt(m.get('muzzle')) if re.search(r'_(kneel|stand|prone|mg)_', key) else None,
                      'hand': pt(m.get('hand')) if '_throw_' in key else None})
    blank = [key for key, m in meta.items() if isinstance(m, dict) and 'zoom' in m and key not in {c['key'] for c in cells}]
    if blank:   # an actor out of his window (a bad bake) must not ship as a fight of nobody
        sys.exit('%s: %d of %d sprites came out blank (%s ...): re-bake' % (th, len(blank), len(blank) + len(cells), ', '.join(blank[:3])))
    order = sorted(range(len(cells)), key=lambda i: -cells[i]['im'].height)
    x = y = shelf = 0
    for i in order:
        im = cells[i]['im']
        if x + im.width + GAP > WIDTH:
            x, y, shelf = 0, y + shelf + GAP, 0
        cells[i]['xy'] = (x + GAP, y + GAP)
        x += im.width + GAP
        shelf = max(shelf, im.height)
    H = y + shelf + 2 * GAP
    atlas = Image.new('RGBA', (WIDTH, H), (0, 0, 0, 0))
    for c in cells:
        atlas.paste(c['im'], c['xy'])
    out = os.path.join(ROOT, 'assets/ui/keyart/ground-%s.webp' % th)
    atlas.save(out, 'WEBP', quality=80, alpha_quality=70, method=6, exact=True)
    print('atlas %dx%d %d cells, %d bytes' % (WIDTH, H, len(cells), os.path.getsize(out)))
    # the depth of the action's regions
    a = np.asarray(Image.open(os.path.join(d, 'depth.png')).convert('RGB')).astype(np.float32)
    z = (a[..., 0] * 256 + a[..., 1]) / 32.0
    z[a[..., 2] > 128] = 1e5
    z = z.reshape(540, 2, 960, 2, 2 * 0 + 2).min(axis=(1, 3)) if False else z.reshape(1080, 2, 1920, 2).min(axis=(1, 3))
    depth = []
    for n, (r, z0, z1) in enumerate(REGIONS.get(th, [])):
        x0, y0, x1, y1 = r
        q = np.clip(np.round((z[y0:y1, x0:x1] - z0) / (z1 - z0) * 254), 0, 255)
        q[z[y0:y1, x0:x1] > z1] = 255
        p = os.path.join(ROOT, 'assets/ui/keyart/ground-%s-depth-%d.webp' % (th, n))
        Image.fromarray(q.astype(np.uint8), 'L').convert('RGB').save(p, 'WEBP', lossless=True, quality=100, method=6)
        depth.append({'url': 'assets/ui/keyart/' + os.path.basename(p), 'rect': r, 'z0': z0, 'z1': z1})
        print('depth %d %s %d bytes' % (n, r, os.path.getsize(p)))
    # the camera: still px from world through VP (column-major, as three.js), the view depth from clip w
    P = np.array(cam['projection']).reshape(4, 4).T
    V = np.linalg.inv(np.array(cam['matrixWorld']).reshape(4, 4).T)
    VP = (P @ V).T.reshape(-1)
    p11 = P[1][1]                      # still px per metre at view depth z: p11 * 540 / z
    def cell_js(c):
        v = '%d, %d, %d, %d, %g, %g, %.2f' % (c['xy'][0], c['xy'][1], c['im'].width, c['im'].height, c['ax'], c['ay'], c['pxm'])
        if c['muzzle'] or c['hand']:
            v += ', %s, %s' % tuple(('%g' % q) for q in c['muzzle']) if c['muzzle'] else ', null, null'
        if c['hand']:
            v += ', %g, %g' % tuple(c['hand'])
        return '    %s: [%s]' % (json.dumps(c['key']), v)
    js_cells = ',\n'.join(cell_js(c) for c in cells)
    os.makedirs(os.path.join(ROOT, 'src/ui/ground-data'), exist_ok=True)
    with open(os.path.join(ROOT, 'src/ui/ground-data/%s.js' % th), 'w') as fh:
        fh.write('''/**
 * GENERATED by tools/ui/ground/pack_ground.py (do not edit): the %s still's ground fight data — its camera (world ->
 * still px through VP, column-major; the view depth is clip w), the sprites of the game's own soldiers and vehicle rendered
 * through it (assets/ui/keyart/ground-%s.webp; cell [x, y, w, h, ax, ay, pxm]: (ax, ay) the ground point in the cell,
 * away: the camera's own heading on the ground (a sprite heading h was rendered facing away - h deg),
 * pxm still px per metre where it was rendered; then, for a fire pose, the muzzle (mx, my) and for a throw the right
 * hand (hx, hy) in the cell; the atlas holds SCALE px a still px); the looks (each man of a fight has his own: side,
 * name, weapon class, and per act its frame count and the headings it was rendered in), and the depth of the action's
 * regions (8 bits over [z0, z1] m; 255 = further, or sky).
 * @module ui/ground-data/%s
 */
export default {
  vp: %s,
  p11: %.6f,
  scale: %g,
  away: %.6f,
  headings: %s,
  looks: {
%s
  },
  vehicle: %s,
  atlas: { url: 'assets/ui/keyart/ground-%s.webp', w: %d, h: %d },
  depth: %s,
  cells: {
%s,
  },
};
''' % (th, th, th, json.dumps([round(v, 7) for v in VP]), p11, SCALE, meta['away'], json.dumps(meta['headings']), '\n'.join('    %s: %s,' % (json.dumps(k), json.dumps(v)) for k, v in meta['looks'].items()),
       json.dumps(meta.get('vehicle')), th, WIDTH, H, json.dumps(depth), js_cells))
    print('-> src/ui/ground-data/%s.js' % th)


if __name__ == '__main__':
    main()
