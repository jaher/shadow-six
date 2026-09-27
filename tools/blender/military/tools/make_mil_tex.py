"""Military procedural texture set (own work, CC0), derived from CC0 Poly Haven bases already in lib/:
concrete_formwork (board-formed wall concrete: board imprints, joints, tie-rod holes with rust weeping, pour-lift lines,
efflorescence, water staining), concrete_slab (weathered top surfaces: water stains, lichen, hairline cracks),
concrete_camo (formwork + painted 3-colour disruptive camouflage), steel_grating, tent_canvas, corrugated_galv.
Usage: python3 make_mil_tex.py [ids...]"""
import sys
import numpy as np
from mtex_util import *

T_CONC = 2.7          # metres per tile (18 boards of 0.15 m)
NB = 18


def formwork_layers(seed=1, n=N, tile=T_CONC, boards=NB):
    """Returns (albedo_luma_mod, height, rust, efflo) arrays for a board-formed concrete face (x = along, y = down)."""
    r = np.random.default_rng(seed)
    y = np.arange(n)[:, None] / n * boards
    bi = np.floor(y).astype(int) % boards
    fy = y - np.floor(y)
    tone = r.normal(0, 0.07, boards)[bi]                                # each board a slightly different shade
    grain = fbm(n, 5, 4, seed + 1, aniso=(24, 1)) - 0.5                  # wood grain streaks along x
    grain2 = fbm(n, 4, 8, seed + 2, aniso=(10, 1)) - 0.5
    joint = np.exp(-((np.minimum(fy, 1 - fy) * n / boards) / 2.2) ** 2)  # thin joint line between boards
    # board ends (butt joints) at random x per board
    bx = np.zeros((n, n), np.float32)
    xs = np.arange(n)[None, :] / n
    for b in range(boards):
        rows = slice(int(b * n / boards), int((b + 1) * n / boards))
        for x0 in r.uniform(0, 1, r.integers(1, 3)):
            d = np.abs(((xs - x0 + 0.5) % 1.0) - 0.5) * n
            bx[rows] = np.maximum(bx[rows], np.exp(-(d / 1.8) ** 2))
    luma = 1 + tone + grain * 0.16 + grain2 * 0.08 - joint * 0.34 - bx * 0.2
    height = -joint * 0.9 - bx * 0.6 + grain * 0.35 + grain2 * 0.15 + tone * 2
    # tie-rod holes: 4 x 3 grid per tile, jittered a little; darker, with rust weeping below 50 % of them
    rust = np.zeros((n, n), np.float32)
    yy, xx = np.mgrid[0:n, 0:n]
    for i in range(4):
        for j in range(3):
            cx = (i + 0.5) / 4 * n + r.normal(0, 8)
            cy = (j + 0.5) / 3 * n + r.normal(0, 8)
            dx = (xx - cx + n / 2) % n - n / 2
            dy = (yy - cy + n / 2) % n - n / 2
            d = np.sqrt(dx * dx + dy * dy) / (0.014 * n / tile * 1.0)
            hole = np.clip(1.4 - d, 0, 1)
            ring = np.exp(-((d - 1.4) / 0.6) ** 2) * 0.5
            luma -= hole * 0.55 + ring * 0.1
            height -= hole * 1.2
            if r.random() < 0.55:
                L = r.uniform(0.15, 0.5) * n / tile
                wdt = r.uniform(3, 7)
                st = np.exp(-(dx / wdt) ** 2) * np.clip(dy / L, 0, 1) ** 0.4 * np.clip(1 - dy / L, 0, 1) * (dy > 0)
                rust = np.maximum(rust, st * r.uniform(0.5, 1.0))
    # pour-lift lines: two per tile, slightly wavy, darker with efflorescence (white bloom) seeping below
    efflo = np.zeros((n, n), np.float32)
    wav = fbm(n, 3, 2, seed + 5)[0] - 0.5
    for k, y0 in enumerate((0.31, 0.81)):
        yl = (y0 + wav * 0.01) * n
        d = (yy - yl[None, :] + n / 2) % n - n / 2
        line = np.exp(-(d / 2.5) ** 2)
        luma -= line * 0.25
        height -= line * 0.8
        ef = np.clip(d / (0.2 * n / tile), 0, 1) * np.exp(-np.clip(d, 0, None) / (0.25 * n / tile)) * (d > 0)
        efflo = np.maximum(efflo, ef * (fbm(n, 4, 8, seed + 10 + k, aniso=(1, 6)) ** 1.5))
    return luma, height, rust, efflo


def stains(n, seed, amt=0.18):
    """Large-scale water/rain staining: vertical streaky darkening + blotches (x = along, y = down)."""
    s1 = fbm(n, 5, 6, seed + 20, aniso=(1, 8))          # vertical streaks
    s2 = fbm(n, 5, 3, seed + 21)
    return 1 - amt * (np.clip(s1 * 1.6 - 0.6, 0, 1) ** 1.5) - amt * 0.6 * np.clip(s2 * 1.5 - 0.7, 0, 1)


def concrete_formwork(seed=11):
    base = load('concrete_bunker')
    detail = (base - base.mean((0, 1))) * 3.2                                     # boost the photo's own speckle x3
    luma, height, rust, efflo = formwork_layers(seed)
    st = stains(N, seed)
    grey = np.array([0.52, 0.52, 0.505], np.float32)
    col = grey[None, None] * (luma * st)[..., None] + detail
    col = col * (1 - rust[..., None] * 0.55) + rust[..., None] * 0.5 * np.array([0.40, 0.25, 0.14])
    col = col * (1 - efflo[..., None] * 0.35) + efflo[..., None] * 0.35 * np.array([0.8, 0.8, 0.78])
    nb = load('concrete_bunker', 'nor')
    nor = blend_normals(nb, normal_from_height(blur(height, 1.0), 1.6))
    ao = np.clip(1 + height * 0.12, 0.6, 1)
    rough = np.clip(0.88 + (1 - st) * 0.1 - efflo * 0.1, 0, 1)
    return col, nor, arm_map(ao, rough)


def concrete_slab(seed=12):
    """Weathered horizontal slab (roofs, aprons): trowel swirls, water-pond stains, lichen, hairline cracks."""
    base = load('concrete_bunker')
    detail = (base - base.mean((0, 1))) * 3.0
    n = N
    pond = fbm(n, 5, 3, seed)
    lich = fbm(n, 6, 8, seed + 1)
    lich_m = np.clip(lich * 2.2 - 1.45, 0, 1) * np.clip(fbm(n, 3, 2, seed + 2) * 2 - 0.6, 0, 1)
    trowel = fbm(n, 5, 6, seed + 3, aniso=(3, 1)) - 0.5
    grey = np.array([0.55, 0.545, 0.52], np.float32)
    col = grey * (1 + trowel[..., None] * 0.1) * (1 - 0.22 * np.clip(pond * 1.8 - 0.8, 0, 1) ** 1.3)[..., None] + detail
    # hairline cracks: thresholded ridges of noise
    rid = 1 - np.abs(fbm(n, 5, 4, seed + 4) * 2 - 1)
    crack = np.clip((rid - 0.965) * 30, 0, 1) * np.clip(fbm(n, 3, 3, seed + 5) * 2 - 0.7, 0, 1)
    col = col * (1 - crack[..., None] * 0.45)
    col = col * (1 - lich_m[..., None] * 0.6) + lich_m[..., None] * 0.6 * np.array([0.38, 0.4, 0.28])
    h = trowel * 0.4 - crack * 1.5 + lich_m * 0.3
    nor = blend_normals(load('concrete_bunker', 'nor'), normal_from_height(blur(h, 1.0), 1.2))
    ao = np.clip(1 - crack * 0.4, 0, 1)
    return col, nor, arm_map(ao, np.clip(0.9 - pond * 0.1, 0, 1))


def camo_mask(n, seed, tile, colors=3):
    """Disruptive hand-painted camouflage: blobs 0.6-2 m with brushed, slightly ragged edges. Returns index map."""
    idx = np.zeros((n, n), np.int8)
    for c in range(1, colors):
        f = fbm(n, 4, max(2, int(tile / 1.6)), seed + 30 + c, gain=0.45)
        rag = fbm(n, 3, 64, seed + 40 + c) - 0.5
        m = (f + rag * 0.08) > (0.48 if c == 1 else 0.6)
        idx[m] = c
    return idx


def concrete_camo(seed=13, tile=5.4):
    """Formwork concrete (two formwork tiles per camo tile) with 3-colour paint: olive green / red-brown / ochre."""
    col, nor, arm = concrete_formwork(seed)
    half = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS)
    col = np.tile(np.asarray(half, np.float32) / 255, (2, 2, 1))
    halfn = Image.fromarray((np.clip(nor, 0, 1) * 255).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS)
    nor = np.tile(np.asarray(halfn, np.float32) / 255, (2, 2, 1))
    arm = np.tile(arm[::2, ::2], (2, 2, 1))
    idx = camo_mask(N, seed, tile)
    lum = col.mean(2, keepdims=True) / 0.5
    paint = np.array([[0.54, 0.48, 0.34],   # dunkelgelb (weathered)
                      [0.27, 0.30, 0.19],   # olivgruen
                      [0.33, 0.22, 0.155]],  # rotbraun
                     np.float32)
    wear = np.clip(fbm(N, 5, 12, seed + 50) * 2.2 - 1.3, 0, 1)[..., None]   # paint worn off -> concrete shows
    pc = paint[idx] * np.clip(lum, 0.5, 1.4)
    out = pc * (1 - wear * 0.55) + col * 0.8 * wear * 0.55
    return out, nor, arm


if __name__ == '__main__':
    want = sys.argv[1:] or ['concrete_formwork', 'concrete_slab', 'concrete_camo']
    B = {'source': 'Poly Haven', 'id': 'concrete_wall_008', 'license': 'CC0-1.0'}
    if 'concrete_formwork' in want:
        register('concrete_formwork', 'Board-formed concrete (formwork, ties, lifts)', *concrete_formwork(), T_CONC, 0.9, base=B)
    if 'concrete_slab' in want:
        register('concrete_slab', 'Weathered concrete slab (top surfaces)', *concrete_slab(), 4.0, 0.9, base=B)
    if 'concrete_camo' in want:
        register('concrete_camo', 'Concrete with 3-colour disruptive camouflage paint', *concrete_camo(), 5.4, 0.88, base=B)
