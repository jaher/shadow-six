#!/usr/bin/env python3
"""
Stone-ID maps for the pavement textures (anti-tiling, art/pavement/pavement-glsl.js).

  python3 tools/render/pave_stones.py [--preview=dir]

For each irregular stone pattern (setts, belgian, pave_fan, brick) the CC0 height map (ard.b, 1k) is segmented into
stones (height above a local threshold, connected with wrap-around so a stone that crosses the tile border is one
stone). Every texel, joints included (nearest stone), stores:
  R, G  the stone's centre in texture UV (8 bit each: the stone's identity inside the tile)
  B     wrap * 25 + level: wrap = (du + 1) * 3 + (dv + 1), the tile offset (-1, 0, +1) from the texel's own repeat to
        the repeat that holds the stone's centre, and level 0..24 = the stone's mean albedo luminance / the tile mean,
        0.6 + level * 0.8 / 24
The shader samples it with NEAREST filtering: floor(uv) + wrap is the stone's repeat, and (repeat, centre) is a key
that is unique for every stone in the world, so each stone gets its own random tone / tilt / wear wherever the tile
repeats, and the scan's own per-stone tones (which repeat with the tile) can be divided out by `level`.
Output: assets/textures/pavement/512/<set>_sid.png (RGB, no alpha: browsers premultiply alpha).
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets/textures/pavement/1k')
DST = os.path.join(ROOT, 'assets/textures/pavement/512')
# set → (local-threshold window px @1k, threshold offset, erosion px, min stone area px @1k)
SETS = {
    'setts': (96, 0.0, 3, 300),
    'belgian': (96, 0.0, 3, 300),
    'pave_fan': (40, 0.0, 1, 60),
    'brick': (48, 0.02, 2, 120),
}


def box(a, r):
    """Wrap-around box blur (the textures tile)."""
    k = 2 * r + 1
    out = np.zeros_like(a)
    for s in range(-r, r + 1):
        out += np.roll(a, s, axis=0)
    a = out / k
    out = np.zeros_like(a)
    for s in range(-r, r + 1):
        out += np.roll(a, s, axis=1)
    return out / k


def erode(m, r):
    for _ in range(r):
        m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    return m


def label(mask):
    """4-connected components with wrap-around: min-label propagation with pointer jumping."""
    H, W = mask.shape
    lab = np.where(mask, np.arange(H * W).reshape(H, W), H * W).astype(np.int64)
    while True:
        prev = lab
        n = lab.copy()
        for ax, s in ((0, 1), (0, -1), (1, 1), (1, -1)):
            r = np.roll(lab, s, axis=ax)
            n = np.where(mask & (r < n), r, n)
        flat = n.ravel().copy()
        # pointer jumping: a label is the index of a texel of the same stone, whose own label is <= it
        m = flat < H * W
        for _ in range(4):
            flat[m] = flat[flat[m]]
        lab = flat.reshape(H, W)
        if np.array_equal(lab, prev):
            return lab


def fill_nearest(lab, valid, iters=64):
    """Grow labels into the joints (nearest stone, wrap-around)."""
    lab = lab.copy()
    have = valid.copy()
    for _ in range(iters):
        if have.all():
            break
        for ax, s in ((0, 1), (0, -1), (1, 1), (1, -1)):
            r = np.roll(lab, s, axis=ax); rh = np.roll(have, s, axis=ax)
            take = ~have & rh
            lab = np.where(take, r, lab)
            have = have | take
    return lab, have


def build(name, win, off, ero, amin):
    H = W = 1024
    ard = np.asarray(Image.open(os.path.join(SRC, f'{name}_ard.jpg')).convert('RGB')).astype(np.float64) / 255
    alb = np.asarray(Image.open(os.path.join(SRC, f'{name}_diff.jpg')).convert('RGB')).astype(np.float64) / 255
    h = box(ard[:, :, 2], 2)
    mask = h > box(h, win // 2) + off
    mask = erode(mask, ero)
    lab = label(mask)
    ids, inv, counts = np.unique(lab.ravel(), return_inverse=True, return_counts=True)
    keep = (counts >= amin) & (ids < H * W)
    good = keep[inv].reshape(H, W)
    lab, have = fill_nearest(np.where(good, lab, -1), good)
    lab = np.where(have, lab, lab.max() + 1)
    yy, xx = np.mgrid[0:H, 0:W]
    lum = alb @ np.array([0.2126, 0.7152, 0.0722])
    out = np.zeros((H, W, 3), np.uint8)
    tile_mean = lum[good].mean()
    uids = np.unique(lab)
    for u in uids:
        m = lab == u
        py, px = yy[m], xx[m]
        # unwrap around the first texel (a stone is far smaller than half the tile)
        ry, rx = py[0], px[0]
        uy = py + np.where(py - ry > H / 2, -H, np.where(py - ry < -H / 2, H, 0))
        ux = px + np.where(px - rx > W / 2, -W, np.where(px - rx < -W / 2, W, 0))
        cy, cx = uy.mean(), ux.mean()
        wy, wx = np.floor(cy / H), np.floor(cx / W)       # repeat of the centre, relative to the reference frame
        cyw, cxw = cy - wy * H, cx - wx * W
        # texel's own repeat in that frame: floor(uy / H); offset (image axes) = centre repeat - texel repeat
        dy = (wy - np.floor(uy / H)).astype(int); dx = (wx - np.floor(ux / W)).astype(int)
        du, dv = dx, -dy                                     # UV: v = 1 - y / H (texture flipY)
        cu = int(np.clip(round((cxw + 0.5) / W * 255), 0, 255))
        cv = int(np.clip(round((1 - (cyw + 0.5) / H) * 255), 0, 255))
        mm = m & good
        ratio = lum[mm].mean() / tile_mean if mm.any() else 1.0
        lvl = int(np.clip(round((ratio - 0.6) / 0.8 * 24), 0, 24))
        code = (np.clip(du, -1, 1) + 1) * 3 + (np.clip(dv, -1, 1) + 1)
        out[py, px, 0] = cu
        out[py, px, 1] = cv
        out[py, px, 2] = (code * 25 + lvl).astype(np.uint8)
    # 512 tier, nearest (ids must not blend)
    img = Image.fromarray(out[::2, ::2], 'RGB')
    os.makedirs(DST, exist_ok=True)
    img.save(os.path.join(DST, f'{name}_sid.png'), optimize=True)
    return out, len(uids), lab


def courses(out, gap=0.04):
    """Stone courses (rows across v): clusters of stone-centre v; boundaries = midpoints between clusters (uv)."""
    cv = np.unique(out[:, :, 1])
    v = np.sort(cv / 255.0)                   # as the shader decodes it
    groups = [[v[0]]]
    for a in v[1:]:
        (groups[-1].append(a) if a - groups[-1][-1] < gap else groups.append([a]))
    if len(groups) > 1 and groups[0][0] + 1 - groups[-1][-1] < gap:   # the first and last cluster are one course
        groups[0] = [g - 1 for g in groups.pop()] + groups[0]
    lo = [min(g) for g in groups]; hi = [max(g) for g in groups]
    b = [(hi[i - 1] + lo[i]) / 2 if i else (hi[-1] - 1 + lo[0]) / 2 for i in range(len(groups))]
    return [round(x % 1.0, 4) for x in b]


COURSED = ('setts', 'belgian')   # stones laid in courses across v: the shader shuffles whole courses

if __name__ == '__main__':
    prev = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--preview=')), None)
    for n, cfg in SETS.items():
        out, k, lab = build(n, *cfg)
        print(f'{n}: {k} stones' + (f', course boundaries (v) {sorted(courses(out))}' if n in COURSED else ''))
        if prev:
            rng = np.random.default_rng(1)
            col = rng.integers(40, 255, (lab.max() + 2, 3)).astype(np.uint8)
            Image.fromarray(col[lab]).resize((512, 512), Image.NEAREST).save(os.path.join(prev, f'{n}_stones.png'))
