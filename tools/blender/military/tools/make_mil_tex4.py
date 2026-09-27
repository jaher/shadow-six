"""Military procedural textures part 4 (rework R4, own work CC0):
concrete_camo_heer - period Heer disruptive paint over plain (not board-formed) bunker concrete: dunkelgelb ground,
    olivgruen + rotbraun (chocolate, no pink) soft-sprayed blotches, isotropic brush mottle, chips showing concrete.
    No board lines / anisotropic noise -> no 'scanline' streaks on slabs.  Derived from CC0 Poly Haven concrete.
camo_netting - garnished camouflage net, alpha MASK, double sided: 10 cm diamond cord mesh with hessian scrim strips
    (olive / brown / sand) tied in at a coverage that varies over the tile (thick clumps + near-bare mesh).
Usage: python3 make_mil_tex4.py [ids]"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from mtex_util import *
from make_mil_tex3 import camo_mask2


def concrete_camo_heer(seed=21, tile=5.4):
    base = load('concrete_bunker', 'diff', N // 2)
    col = np.tile(base, (2, 2, 1))
    nb = np.tile(load('concrete_bunker', 'nor', N // 2), (2, 2, 1))
    ab = np.tile(load('concrete_bunker', 'arm', N // 2), (2, 2, 1))
    nor = nb * 0.55 + np.array([0.5, 0.5, 1.0]) * 0.45
    idx = camo_mask2(N, seed, tile)
    paint = np.array([[0.55, 0.48, 0.33],   # dunkelgelb RAL 7028, weathered
                      [0.29, 0.31, 0.21],   # olivgruen RAL 6003, faded
                      [0.32, 0.255, 0.165]],  # rotbraun RAL 8017, faded chocolate (warm, not mauve)
                     np.float32)
    pc = paint[idx]
    pc = blur(pc, 2.5)                                             # soft sprayed edges
    lum = blur(col.mean(2), 3)[..., None]
    lum = 1 + (lum / lum.mean() - 1) * 0.45
    brush = (fbm(N, 5, 24, seed + 60) - 0.5) * 0.07
    pc = pc * np.clip(lum, 0.8, 1.2) * (1 + brush[..., None])
    wear = np.clip(fbm(N, 6, 12, seed + 50) * 2.4 - 1.5, 0, 1)[..., None]
    chips = (fbm(N, 3, 180, seed + 51) > 0.8)[..., None] * np.clip(fbm(N, 4, 6, seed + 52) * 2 - 0.6, 0, 1)[..., None]
    m = np.clip(wear * 0.55 + chips * 0.8, 0, 1)
    out = pc * (1 - m) + col * 0.92 * m
    grime = fbm(N, 4, 5, seed + 70)[..., None]
    out = out * (0.88 + 0.12 * grime)
    arm = ab.copy()
    arm[..., 1] = np.clip(ab[..., 1] * 0.85 + 0.1, 0, 1)
    return out, nor, arm


def camo_netting(seed=5, tile=1.2):
    n, ss = N, 2
    W = n * ss
    ppm = W / tile
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    pitch = 0.1 * n / tile                                    # 10 cm diamond mesh
    u, v = (xx + yy) / (pitch * 1.4142), (xx - yy) / (pitch * 1.4142)
    du, dv = np.abs(u - np.round(u)), np.abs(v - np.round(v))
    cord = np.clip(1.6 - np.minimum(du, dv) * pitch * 1.4142 / 3.0, 0, 1)   # ~5 mm twine
    dens = fbm(n, 4, 3, seed + 1)                             # thick clumps vs bare mesh across the tile
    cim = Image.new('RGB', (W, W), (0, 0, 0))
    aim = Image.new('L', (W, W), 0)
    him = Image.new('L', (W, W), 0)
    dc, da, dh = ImageDraw.Draw(cim), ImageDraw.Draw(aim), ImageDraw.Draw(him)
    lots = [(0.30, 0.33, 0.20), (0.36, 0.29, 0.19), (0.52, 0.46, 0.31), (0.24, 0.27, 0.17)]
    k = 0
    while k < 310:
        cx, cy = r.uniform(0, W), r.uniform(0, W)
        if r.random() > dens[int(cy / ss) % n, int(cx / ss) % n] ** 1.3 * 1.25:
            continue
        k += 1
        L, Wd = r.uniform(0.07, 0.2) * ppm, r.uniform(0.025, 0.05) * ppm
        a = r.uniform(0, np.pi)
        ca, sa = np.cos(a), np.sin(a)
        side1 = [(t * L, w * Wd * r.uniform(0.8, 1.2)) for t, w in ((-0.5, 0.3), (-0.25, 0.5), (0.05, 0.5), (0.3, 0.4), (0.5, 0.1))]
        side2 = [(t, -w) for t, w in reversed(side1)]
        loc = [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in side1 + side2]
        c = np.array(lots[r.integers(0, 4)]) * r.uniform(0.85, 1.12)
        rgb = tuple(int(np.clip(x, 0, 1) * 255) for x in c)
        hv = int(r.uniform(120, 255))
        for ox in (-W, 0, W):
            for oy in (-W, 0, W):
                q = [(x + ox, y + oy) for x, y in loc]
                if min(p[0] for p in q) > W or max(p[0] for p in q) < 0 or min(p[1] for p in q) > W or max(p[1] for p in q) < 0:
                    continue
                dc.polygon(q, fill=rgb)
                da.polygon(q, fill=255)
                dh.polygon(q, fill=hv)
    cs = np.asarray(cim.resize((n, n), Image.LANCZOS), np.float32) / 255
    sa_ = np.asarray(aim.resize((n, n), Image.LANCZOS), np.float32) / 255
    hs = np.asarray(him.resize((n, n), Image.LANCZOS), np.float32) / 255
    twine = np.array([0.22, 0.21, 0.15], np.float32)
    c = cs * sa_[..., None] + twine * cord[..., None] * (1 - sa_[..., None])
    c = np.where(sa_[..., None] > 0.02, cs / np.maximum(sa_[..., None], 1e-3), c)
    c = np.where((sa_ + cord)[..., None] > 0.05, c, twine)
    weave = (np.sin(xx * 1.9) * np.sin(yy * 1.9)) * 0.04
    c = c * (1 + weave[..., None]) * (0.92 + 0.16 * fbm(n, 4, 12, seed + 3)[..., None])
    a = np.clip(np.maximum(sa_, cord), 0, 1)
    h = hs * 0.8 + cord * 0.3 + weave
    ao = np.clip(0.55 + 0.45 * np.clip(hs * 1.5, 0, 1), 0, 1)
    c = c * (0.75 + 0.25 * ao[..., None])
    nor = normal_from_height(blur(h, 1.2), 1.4)
    arm = arm_map(ao, np.full((n, n), 0.95, np.float32))
    return np.clip(c, 0, 1), a, nor, arm


def register_alpha(mid, label, c, a, nor, arm, tile):
    maps = {'diff': {}, 'nor': save(nor, mid + '_nor', 92), 'arm': save(arm, mid + '_arm')}
    rgba = Image.fromarray((np.concatenate([c, a[..., None]], -1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    for sz, res in ((1024, '1k'), (2048, '2k')):
        x = rgba.resize((sz, sz), Image.LANCZOS)
        x.save(os.path.join(LIB, res, mid + '_diff.png'))
        x.save(os.path.join(LIB, res, mid + '_diff.webp'), quality=90, method=5)
        x.convert('RGB').save(os.path.join(LIB, res, mid + '_diff.jpg'), quality=88)
        for k in ('nor', 'arm'):     # kit_core loads every map of an alpha material as .png
            Image.open(os.path.join(LIB, res, '%s_%s.jpg' % (mid, k))).save(os.path.join(LIB, res, '%s_%s.png' % (mid, k)))
        maps['diff'][res] = res + '/' + mid + '_diff'
    m = a > 0.5
    e = {'label': label, 'tile_m': tile, 'grain': 'u', 'rot90': False, 'roughness': 0.95, 'metallic': 0.0, 'grime': 0.2,
         'mean': [round(float(x), 4) for x in c[m].mean(0)], 'normalScale': 0.8, 'alpha': 'MASK', 'alphaCutoff': 0.45,
         'doubleSided': True, 'specular': 0.1, 'maps': maps,
         'source': {'source': 'procedural (art/military/tools/make_mil_tex4.py, own work)', 'license': 'CC0-1.0'},
         'texel_density_px_per_m': {'1k': round(1024 / tile), '2k': round(2048 / tile)}}
    p = os.path.join(LIB, 'materials.json')
    MJ = json.load(open(p))
    MJ['materials'][mid] = e
    json.dump(MJ, open(p + '.tmp_mil4', 'w'), indent=1)
    os.replace(p + '.tmp_mil4', p)
    print('registered', mid, e['mean'], 'coverage', float(m.mean()))


if __name__ == '__main__':
    want = sys.argv[1:] or ['concrete_camo_heer', 'camo_netting']
    if 'concrete_camo_heer' in want:
        register('concrete_camo_heer', 'Concrete, Heer disruptive paint (dunkelgelb / olive / chocolate brown, muted, sprayed edges)',
                 *concrete_camo_heer(), 5.4, 0.88, base={'source': 'Poly Haven', 'id': 'concrete_bunker (lib)', 'license': 'CC0-1.0'})
    if 'camo_netting' in want:
        register_alpha('camo_netting', 'Garnished camouflage net: 10 cm twine mesh + hessian scrim strips (alpha MASK, double sided)',
                       *camo_netting(), 1.2)
