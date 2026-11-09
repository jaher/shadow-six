import sys; sys.setrecursionlimit(20000)
# post_kit.py - the knapsack kit renders (models/kit.py, masters/kit/) -> shipped layers: assets/ui/icons/kit/<id>@<tier>.webp
# (+ PNG at 2x/3x) and their manifest entries ('kit/<id>': box, offset in the knapsack box, hit polygon, stacking order).
#   python3 tools/blender/icons/post_kit.py [left]          (system python: numpy + Pillow)
# Every layer is cropped to whole ref px (so all layers stay registered at every tier); an item hanging off the pack gets
# a thin dark keyline where it lies over the map (never over the pack: that is its own shadow and contact); the hit
# polygon is the outline of the visible object (its mask render: the pack a holdout), traced and simplified here.
import os, sys, json, glob
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post

SCR = post.SCRATCH
SRC = os.path.join(SCR, 'masters', 'kit')
OUT = os.path.join(SCR, 'out')
TIERS = [1, 1.5, 2, 3, 4, 6]
PNG = ()        # no PNG fallback for kit layers: WebP everywhere the game runs; 2.5 MB of PNG for a fallback nobody takes


def trace(b):
    """Outer contour (Moore neighbour tracing) of the largest 8-connected blob in bool array b: [(y, x), ...]."""
    H, W = b.shape
    lab = np.zeros((H, W), np.int32); best, bestn, cur = 0, 0, 0
    for y0, x0 in zip(*np.nonzero(b)):
        if lab[y0, x0]: continue
        cur += 1; st = [(y0, x0)]; lab[y0, x0] = cur; n = 0
        while st:
            y, x = st.pop(); n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and b[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur; st.append((yy, xx))
        if n > bestn: best, bestn = cur, n
    m = np.pad(lab == best, 1)
    ys, xs = np.nonzero(m)
    i = np.lexsort((xs, ys))[0]
    start = (ys[i], xs[i])
    D8 = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]
    cont = [start]; cur_p = start; back = 0          # came from the west
    for _ in range(4 * m.size):
        for k in range(1, 9):
            d = D8[(back + k) % 8]
            n = (cur_p[0] + d[0], cur_p[1] + d[1])
            if m[n]:
                pd = D8[(back + k - 1) % 8]
                prev = (cur_p[0] + pd[0], cur_p[1] + pd[1])
                cur_p = n
                back = D8.index((prev[0] - cur_p[0], prev[1] - cur_p[1]))
                break
        else:
            break
        if cur_p == start:
            break
        cont.append(cur_p)
    return [(y - 1, x - 1) for y, x in cont]


def simplify(pts, eps):
    """Douglas-Peucker on a closed polygon [(x, y)]."""
    if len(pts) < 4: return pts
    def rdp(P):
        a, b = np.array(P[0], float), np.array(P[-1], float)
        ab = b - a; L = np.hypot(*ab) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(P) - 1):
            p = np.array(P[i], float)
            d = abs(ab[0] * (a[1] - p[1]) - ab[1] * (a[0] - p[0])) / L
            if d > best: best, bi = d, i
        if best > eps:
            return rdp(P[:bi + 1])[:-1] + rdp(P[bi:])
        return [P[0], P[-1]]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    return rdp(pts[:far + 1])[:-1] + rdp(pts[far:] + [pts[0]])[:-1]


def main(side=''):
    suf = '.left' if side == 'left' else ''
    lay = json.load(open(os.path.join(SRC, f'layers{suf}.json')))
    fr = lay.pop('_frame')
    S = fr['scale']; bx, by = fr['box_at']
    pack = post.load(os.path.join(SRC, f'pack{suf}.png'))
    pa = pack[..., 3]
    # the pack's self-shadow as the shadow catcher saw it with no kit on (kit.py 'pack.catcher')
    self_sh = post.load(os.path.join(SRC, f'pack{suf}.catcher.png'))[..., 3]
    mpath = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {}
    os.makedirs(os.path.join(OUT, 'kit'), exist_ok=True)
    total2 = 0
    for name, info in sorted(lay.items()):
        img = pack if name == 'pack' else post.load(os.path.join(SRC, f'{name}{suf}.png'))
        rgb, a = post.grade(img[..., :3]), img[..., 3]
        if name != 'pack':
            mk = post.load(os.path.join(SRC, f'{name}{suf}.mask.png'))[..., 3]
            # off the object, the layer is the shadow catcher: the pack's own shadow and the item's combined, divide the
            # pack's out (1 - s_with = (1 - s_pack)(1 - s_item)); a whisper of it is noise
            s_item = np.clip(1 - (1 - a) / np.maximum(1 - self_sh, 0.05), 0, 1)
            # an item shades the pack near itself only: keep its shadow within ~10 ref px of its silhouette (the rest is the
            # denoiser's difference between two renders)
            H_, W_ = mk.shape
            sm = Image.fromarray((np.clip(mk, 0, 1) * 255).astype(np.uint8), 'L').resize((W_ // S, H_ // S), Image.BOX)
            sm = sm.point(lambda v: 255 if v > 8 else 0).filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(2))
            near = np.asarray(sm.resize((W_, H_), Image.BILINEAR), dtype=np.float32) / 255
            s_item = np.where(s_item > 0.05, s_item, 0) * (pa > 0.02) * near
            ob = np.clip(mk, 0, 1)
            sc_ = np.array([12, 10, 6], np.float32) / 255
            A0 = ob + (1 - ob) * s_item
            rgb = (rgb * ob[..., None] + sc_ * ((1 - ob) * s_item)[..., None]) / np.maximum(A0[..., None], 1e-4)
            a = A0
            # keyline over the map only (the item off the pack's silhouette)
            ring = np.clip(post.blur(post.dilate(mk, 2), 0.8) * 1.2 - mk, 0, 1) * (1 - np.clip(pa * 1.5, 0, 1)) * 0.75
            A = a + ring * (1 - a)
            C = (rgb * a[..., None] + np.array([10, 8, 5], np.float32) / 255 * (ring * (1 - a))[..., None]) / np.maximum(A[..., None], 1e-4)
            rgb, a = C, A
        else:
            mk = None
            ring = np.clip(post.blur(post.dilate(a, 3), 0.9) * 1.15 - a, 0, 1) * 0.7      # the pack's own dark contour
            A = a + ring * (1 - a)
            rgb = (rgb * a[..., None] + np.array([10, 8, 5], np.float32) / 255 * (ring * (1 - a))[..., None]) / np.maximum(A[..., None], 1e-4)
            a = A
        full = np.dstack([rgb, a])
        ys, xs = np.nonzero(a > 0.004)
        if not len(xs):
            print('empty', name); continue
        x0, y0 = (xs.min() // S) * S, (ys.min() // S) * S
        x1, y1 = -(-(xs.max() + 1) // S) * S, -(-(ys.max() + 1) // S) * S
        crop = full[y0:y1, x0:x1]
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        bw, bh = (x1 - x0) // S, (y1 - y0) // S
        files = {}
        for t in TIERS:
            w, h = post.tier_px(bw, t), post.tier_px(bh, t)
            im = post.to_pil(post.resize(crop, w, h))
            tag = post.tier_tag(t)
            base = os.path.join(OUT, 'kit', f'{name}{suf}@{tag}')
            post.save_webp(im, base + '.webp')
            f = {'w': w, 'h': h, 'webp': os.path.getsize(base + '.webp')}
            if t in PNG:
                post.save_png(im, base + '.png'); f['png'] = os.path.getsize(base + '.png')
            elif os.path.exists(base + '.png'):
                os.remove(base + '.png')
            files[tag] = f
        e = {'class': 'kit', 'box': [bw, bh], 'files': files, 'offset': [x0 // S - int(bx), y0 // S - int(by)], 'z': int(info.get('z', 0)),
             'content': post.content_box(crop)}
        if info.get('anchor'):   # where its count is stencilled (fractions of the layer box; may lie outside it)
            ax, ay = info['anchor']
            e['anchor'] = [round((ax - x0) / (x1 - x0), 4), round((ay - y0) / (y1 - y0), 4)]
            e['paint'] = info.get('paint', 'dark')
        if mk is not None:
            # hit polygon: the visible object, traced at 2 px per ref px, simplified to ~0.4 ref px
            q = S // 2
            mc = mk[y0:y1, x0:x1]
            small = mc[:mc.shape[0] // q * q, :mc.shape[1] // q * q].reshape(mc.shape[0] // q, q, mc.shape[1] // q, q).mean(axis=(1, 3)) > 0.5
            if small.any():
                c = trace(small)
                poly = simplify([(x + 0.5, y + 0.5) for y, x in c], 0.8)
                W2, H2 = small.shape[1], small.shape[0]
                e['poly'] = [round(v, 4) for p in poly for v in (min(1, max(0, p[0] / W2)), min(1, max(0, p[1] / H2)))]
        man[f'kit/{name}{suf}'] = e
        total2 += files['2x']['webp']
        print('kit', name + suf, f'{bw}x{bh}', 'at', e['offset'], 'z', e['z'], f"2x {files['2x']['webp'] // 1024}k", 'poly', len(e.get('poly', [])) // 2)
    json.dump(man, open(mpath, 'w'), indent=1, sort_keys=True)
    print('total @2x', total2 // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '')
