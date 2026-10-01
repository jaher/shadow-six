# compose.py - mounts the rendered eye frames (render_eye.py) behind the porthole passes (frame.py) and writes
#   masters/tool/eye.open|closed.png (+json)  and  masters/cursor/eye.open|closed.png  -> post.py builds the static icons
#   out/tool/eye.anim@<tier>.webp              the animation sprite sheet: the window cell of every frame, one grid
#   out/tool/eye.anim.json + src/ui/eye-anim-data.js   grid, cell rect (ref px), tiers and the frame table
# usage: python3 tools/blender/hud/eye/compose.py <eye_frames_dir> [--repo <repo root>]   (ICON_SCRATCH as for post.py)
import os, sys, json, math
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.normpath(os.path.join(HERE, '..', '..', 'icons')), HERE]
import post as P
import frames as FR

RAW = os.path.join(P.MASTERS, 'raw')
TIERS = [2, 3, 4, 6]
COLS = 8
ZOOM = 1.0              # eye picture cover-fit into the window ellipse (1 = exactly cover)


def pas(cls, name):
    p = os.path.join(RAW, f'eyeframe.{cls}.{name}')
    return P.load(p + '.png'), json.load(open(p + '.json'))


def _fit(eye, w, h):
    """Cover-fit an sRGB float RGB picture into w x h (centre crop), Lanczos in linear light."""
    H, W = eye.shape[:2]; k = max(w / W, h / H) * ZOOM
    rw, rh = max(w, int(round(W * k))), max(h, int(round(H * k)))
    lin = P.s2l(eye)
    ch = [np.asarray(Image.fromarray(lin[..., i].astype(np.float32), 'F').resize((rw, rh), Image.LANCZOS)) for i in range(3)]
    im = np.clip(np.stack(ch, -1), 0, None)
    x0, y0 = (rw - w) // 2, (rh - h) // 2
    return im[y0:y0 + h, x0:x0 + w]


def composite(cls, eye):
    """Straight-alpha sRGB RGBA at master size: eye (linear) shaded by the bezel, dome highlights added, frame over."""
    F, fm = pas(cls, 'frame'); G, _ = pas(cls, 'glass'); M, _ = pas(cls, 'mask')
    m = M[..., 3]
    ys, xs = np.nonzero(m > 0.5)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    pad = int(0.03 * (x1 - x0))
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(m.shape[1], x1 + pad), min(m.shape[0], y1 + pad)
    lin = np.zeros(F.shape[:2] + (3,), np.float32)
    lin[y0:y1, x0:x1] = _fit(eye, x1 - x0, y1 - y0)
    W = m.shape[1]
    occl = P.blur(1.0 - m, 0.035 * W)                        # recessed plate: soft shadow from the bezel lip
    lin *= np.clip(1.0 - 1.5 * occl, 0.18, 1.0)[..., None]
    lin *= np.clip(1.0 - 0.35 * P.blur(1.0 - m, 0.012 * W), 0.0, 1.0)[..., None]
    g = P.s2l(G[..., :3]); floor = np.percentile(g[m > 0.9], 60, axis=0) if (m > 0.9).any() else 0
    lin += np.clip(g - floor, 0, None) * 0.9 * m[..., None]   # dome reflections (the grey studio wash removed)
    eye_s = P.l2s(lin)
    a = F[..., 3]
    rgb = F[..., :3] * a[..., None] + eye_s * (m * (1 - a))[..., None]
    A = a + m * (1 - a)
    return np.dstack([rgb / np.maximum(A[..., None], 1e-5), A]).astype(np.float32), fm, m


def save_master(img, meta, cls, iid):
    os.makedirs(os.path.join(P.MASTERS, cls), exist_ok=True)
    p = os.path.join(P.MASTERS, cls, iid)
    Image.fromarray(np.clip(np.round(img * 255), 0, 255).astype(np.uint8), 'RGBA').save(p + '.png')
    meta = {k: v for k, v in meta.items() if k not in ('for',)}
    meta.update(id=iid, cls=cls)
    json.dump(meta, open(p + '.json', 'w'))
    print('MASTER', cls, iid, img.shape[1], img.shape[0])


def eye_img(d, name):
    return np.asarray(Image.open(os.path.join(d, name + '.png')).convert('RGB'), dtype=np.float32) / 255.0


def framed(img, meta, m):
    """The exact framing post.build gives a tool icon (compose -> autocrop 7 %), with the window mask carried along."""
    f = P.compose(meta, img, None, 'tool', None, None)
    fc, meta2 = P.autocrop(f, meta, 0.07)
    mc, _ = P.autocrop(np.dstack([np.repeat(m[..., None], 3, -1), f[..., 3]]), meta, 0.07)
    return fc, mc[..., 0], meta2


def resize_mask(m, w, h):
    return np.clip(np.asarray(Image.fromarray(m.astype(np.float32), 'F').resize((w, h), Image.LANCZOS)), 0, 1)


def sheets(fdir, names, repo=None):
    box = None; cells = {t: [] for t in TIERS}; rect = None
    for n in names:
        img, meta, m = composite('tool', eye_img(fdir, n))
        fc, mc, meta2 = framed(img, meta, m)
        bw, bh = meta2['box']; Wm, Hm = meta2['master']
        if rect is None:
            ys, xs = np.nonzero(mc > 0.02); k = bw / Wm
            rect = [max(0, math.floor(xs.min() * k) - 1), max(0, math.floor(ys.min() * k) - 1),
                    min(bw, math.ceil((xs.max() + 1) * k) + 1), min(bh, math.ceil((ys.max() + 1) * k) + 1)]
            box = (bw, bh)
        for t in TIERS:
            W, H = int(round(bw * t)), int(round(bh * t))
            im = P.resize(fc, W, H); mt = resize_mask(mc, W, H)
            x0, y0, x1, y1 = (int(round(v * t)) for v in rect)
            cell = im[y0:y1, x0:x1].copy()
            a = np.clip(P.blur(P.dilate(mt, 1), 0.5)[y0:y1, x0:x1] * 1.5, 0, 1) * cell[..., 3]
            cell[..., 3] = a
            cells[t].append(cell)
        print('CELL', n, flush=True)
    rows = math.ceil(len(names) / COLS)
    os.makedirs(os.path.join(P.OUT, 'tool'), exist_ok=True)
    files = {}
    for t in TIERS:
        ch, cw = cells[t][0].shape[:2]
        sheet = np.zeros((rows * ch, COLS * cw, 4), np.float32)
        for i, c in enumerate(cells[t]):
            r, q = divmod(i, COLS); sheet[r * ch:(r + 1) * ch, q * cw:(q + 1) * cw] = c
        tag = ('%gx' % t).replace('.', 'p')
        path = os.path.join(P.OUT, 'tool', f'eye.anim@{tag}.webp')
        P.to_pil(sheet).save(path, 'WEBP', quality=88, method=6, exact=False)
        files[tag] = [COLS * cw, rows * ch, os.path.getsize(path)]
        print('SHEET', tag, COLS * cw, rows * ch, os.path.getsize(path) // 1024, 'KB')
    data = {'box': list(box), 'cell': rect, 'cols': COLS, 'rows': rows, 'tiers': files,
            'frames': [{k: f[k] for k in ('name', 'gx', 'gy', 'p', 'blink')} for f in (FR.BY_NAME[n] for n in names)]}
    json.dump(data, open(os.path.join(P.OUT, 'tool', 'eye.anim.json'), 'w'), indent=1)
    if repo: write_js(data, repo)
    return data


def write_js(d, repo):
    fr = ',\n'.join(f"  {json.dumps(f, separators=(',', ':'))}" for f in d['frames'])
    js = f"""/**
 * GENERATED by tools/blender/hud/eye/compose.py. Do not edit by hand.
 * The HUD eye's sprite sheets (assets/ui/icons/tool/eye.anim@<tier>.webp): `cols` x `rows` cells, each the porthole
 * window `cell` = [x0, y0, x1, y1] in ref px of the {d['box'][0]}x{d['box'][1]} tool box, at the tool tiers (ref px x 2/3/4/6).
 * Frame: gx/gy gaze (-1..1, +x screen right, +y up), p pupil ('n' normal, 'd' dilated), blink lid closure 0..1.
 * Names: gNN<p> gaze frames, b1gNN<p> / b2gNNn the blink stages over that gaze, blink3 the shut lid.
 * @module ui/eye-anim-data
 */
export const EYE_ANIM = {{
  box: {json.dumps(d['box'])}, cell: {json.dumps(d['cell'])}, cols: {d['cols']}, rows: {d['rows']},
  tiers: {json.dumps({k: v[:2] for k, v in d['tiers'].items()})},
  frames: [
{fr},
  ],
}};
"""
    open(os.path.join(repo, 'src', 'ui', 'eye-anim-data.js'), 'w').write(js)
    print('JS', os.path.join(repo, 'src', 'ui', 'eye-anim-data.js'))


def main():
    a = sys.argv[1:]
    repo = a[a.index('--repo') + 1] if '--repo' in a else None
    fdir = a[0]
    for cls in ('tool', 'cursor'):
        for iid, n in (('eye.open', 'g00n'), ('eye.closed', 'blink3')):
            img, meta, _ = composite(cls, eye_img(fdir, n))
            save_master(img, meta, cls, iid)
    names = [f['name'] for f in FR.FRAMES if os.path.exists(os.path.join(fdir, f['name'] + '.png'))]
    sheets(fdir, names, repo)


if __name__ == '__main__':
    main()
