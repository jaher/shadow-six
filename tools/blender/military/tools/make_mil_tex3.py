"""Military procedural textures part 3 (rework 2, own work CC0): concrete_camo v2 (smaller ragged blotches, muted
paints, no board banding through the paint), tent_canvas v2 (6 m tile, 1 m sewn panels with strong lap seams, few
irregular soft-edged patches, weather streaks -> no stamped grid). Usage: python3 make_mil_tex3.py [ids]"""
import sys
import numpy as np
from mtex_util import *
from make_mil_tex import concrete_formwork


def camo_mask2(n, seed, tile, colors=3):
    idx = np.zeros((n, n), np.int8)
    for c in range(1, colors):
        f = fbm(n, 5, max(3, int(tile / 0.75)), seed + 30 + c, gain=0.5)
        rag = fbm(n, 3, 96, seed + 40 + c) - 0.5
        m = (f + rag * 0.10) > (0.5 if c == 1 else 0.62)
        idx[m] = c
    return idx


def concrete_camo(seed=13, tile=5.4):
    col, nor, arm = concrete_formwork(seed)
    half = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS)
    col = np.tile(np.asarray(half, np.float32) / 255, (2, 2, 1))
    halfn = Image.fromarray((np.clip(nor, 0, 1) * 255).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS)
    nor = np.tile(np.asarray(halfn, np.float32) / 255, (2, 2, 1))
    nor = nor * 0.6 + np.array([0.5, 0.5, 1.0]) * 0.4            # paint film softens the board relief
    arm = np.tile(arm[::2, ::2], (2, 2, 1))
    idx = camo_mask2(N, seed, tile)
    lum = col.mean(2, keepdims=True)
    lum = blur(lum[..., 0], 6)[..., None]                          # no board stripes through the paint
    lum = 1 + (lum / lum.mean() - 1) * 0.35
    paint = np.array([[0.50, 0.46, 0.36],   # dunkelgelb, chalky / weathered
                      [0.31, 0.33, 0.25],   # olivgruen, faded
                      [0.36, 0.29, 0.24]],  # rotbraun, faded (no pink)
                     np.float32)
    brush = (fbm(N, 4, 40, seed + 60, aniso=(1, 3)) - 0.5) * 0.08    # brush-mottle, short strokes (not scanlines)
    wear = np.clip(fbm(N, 5, 14, seed + 50) * 2.2 - 1.35, 0, 1)[..., None]
    pc = paint[idx] * np.clip(lum, 0.85, 1.15) * (1 + brush[..., None])
    grime = fbm(N, 4, 6, seed + 70)[..., None]
    out = pc * (1 - wear * 0.5) + col * 0.85 * wear * 0.5
    out = out * (0.9 + 0.1 * grime)
    return out, nor, arm


def tent_canvas(seed=32, tile=6.0):
    n = N
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    ppm = n / tile
    weave = (np.sin(xx * np.pi / 1.5) * np.sin(yy * np.pi / 1.5)) * 0.025
    blot = fbm(n, 6, 5, seed)
    streak = fbm(n, 5, 8, seed + 1, aniso=(1, 12))               # rain runs down the fall line (v)
    base = np.array([0.60, 0.55, 0.43], np.float32)
    luma = 1 + (blot - 0.5) * 0.26 - np.clip(streak * 2.0 - 1.0, 0, 1) * 0.22 + weave
    h = weave * 2 + (blot - 0.5) * 0.3
    npan = int(round(tile))
    for k in range(npan):                                   # 1 m cloths, each its own dye lot
        x0, x1 = k * ppm, (k + 1) * ppm
        m = (xx >= x0) & (xx < x1)
        luma = luma * np.where(m, r.uniform(0.92, 1.07), 1.0)
        d = xx - x0
        edge = np.exp(-(d / 5.0) ** 2) + np.exp(-((d - 0.035 * ppm) / 3.0) ** 2) * 0.6
        stitch = ((np.abs(d - 0.012 * ppm) < 1.3) | (np.abs(d - 0.028 * ppm) < 1.3)) & ((yy // 7) % 2 == 0)
        lap = (d >= 0) & (d < 0.035 * ppm)
        luma = luma - edge * 0.22 - stitch * 0.1 + lap * 0.04
        h = h + lap * 0.8 - edge * 0.5
    col = base * luma[..., None]
    for k in range(3):                                      # a few irregular repairs, soft ragged edge
        cx, cy = r.uniform(0, n), r.uniform(0, n)
        w, hh = r.uniform(0.25, 0.6) * ppm, r.uniform(0.2, 0.45) * ppm
        dx = np.abs((xx - cx + n / 2) % n - n / 2) / (w / 2)
        dy = np.abs((yy - cy + n / 2) % n - n / 2) / (hh / 2)
        rag = (fbm(n, 3, 32, seed + 10 + k) - 0.5) * 0.25
        m = np.clip((1 - np.maximum(dx, dy) + rag) * 12, 0, 1)
        col = col * (1 + m[..., None] * (r.choice([0.1, -0.08])))
        h = h + m * 0.25
    mould = np.clip(fbm(n, 5, 10, seed + 3) * 2.4 - 1.55, 0, 1)
    col = col * (1 - mould[..., None] * 0.4) + mould[..., None] * 0.4 * np.array([0.3, 0.3, 0.22])
    nor = normal_from_height(blur(h, 1.0), 1.8)
    ao = np.clip(1 - np.clip(-h, 0, 1) * 0.35, 0, 1)
    return col, nor, arm_map(ao, np.full((n, n), 0.95, np.float32))


if __name__ == '__main__':
    want = sys.argv[1:] or ['concrete_camo', 'tent_canvas']
    B = {'source': 'Poly Haven', 'id': 'concrete_wall_008', 'license': 'CC0-1.0'}
    if 'concrete_camo' in want:
        register('concrete_camo', 'Concrete with 3-colour disruptive camouflage paint (muted, 0.5-1.2 m blotches)', *concrete_camo(), 5.4, 0.88, base=B)
    if 'tent_canvas' in want:
        register('tent_canvas', 'Tent / hangar canvas: 1 m sewn cloths, lap seams, repairs, rain streaks', *tent_canvas(), 6.0, 0.95, grime=0.6)
