"""Norway procedural texture set (own work, CC0; derived from CC0 Poly Haven bases already in lib/):
roof_pantile_black (black glazed S-pantiles), tar_paper (roofing felt with roll laps + patches), turf_grass (dense
turf for torvtak, from sparse_grass), log_hewn (weathered hewn log surface, grain along u), board_batten (painted
board-and-batten cladding, light base tinted per asset).  Usage: python3 make_nor_tex.py [ids...]"""
import sys, os, json
import numpy as np
sys.path.insert(0, '<claude-tmp>')
import mtex_util as U
from mtex_util import fbm, blur, normal_from_height, blend_normals, arm_map, load, N

SRC = 'procedural (art/norway/tools/make_nor_tex.py, own work)'


def register(mid, label, diff, nor, arm, tile, rough, metal=0.0, grime=1.0, grain='u', base=None):
    maps = {'diff': U.save(diff, mid + '_diff'), 'nor': U.save(nor, mid + '_nor', 92), 'arm': U.save(arm, mid + '_arm')}
    src = {'source': SRC, 'license': 'CC0-1.0'}
    if base:
        src['derived_from'] = base
    e = {'label': label, 'tile_m': tile, 'grain': grain, 'rot90': False, 'roughness': rough, 'metallic': metal,
         'grime': grime, 'mean': [round(float(x), 4) for x in diff.reshape(-1, 3).mean(0)], 'normalScale': 1.0,
         'maps': maps, 'source': src, 'texel_density_px_per_m': {'1k': round(1024 / tile), '2k': round(2048 / tile)}}
    p = os.path.join(U.LIB, 'materials.json')
    MJ = json.load(open(p))
    MJ['materials'][mid] = e
    tmp = p + '.tmp_nor'
    json.dump(MJ, open(tmp, 'w'), indent=1)
    os.replace(tmp, p)
    print('registered', mid, e['mean'], 'tile', tile)


yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N          # yy = rows (0 top = up-slope), xx = u


def pantile():
    tile = 2.0
    nc, nt = 6, 10                                           # courses (0.33 m) x tiles (0.2 m) per repeat
    fy = (yy * nc) % 1.0
    ci = np.floor(yy * nc).astype(int)
    xs = xx * nt + (ci % 2) * 0.0
    ti = np.floor(xs).astype(int)
    fx = xs % 1.0
    wave = 0.65 * np.sin(2 * np.pi * fx) + 0.25 * np.sin(4 * np.pi * fx + 0.6)
    r = np.random.default_rng(3)
    tone = r.normal(0, 0.12, (nc, nt))[ci % nc, ti % nt]
    h = wave * 0.9 + fy * 0.9 + tone * 0.3
    butt = np.exp(-((1 - fy) * 30) ** 2)                      # rounded butt edge
    shadow = np.exp(-(fy * 9) ** 1.5)                          # shadow under the course above
    h = h - shadow * 0.8
    crest = np.clip(wave, 0, 1)
    lich = (fbm(N, 5, 14, 11) > 0.9).astype(np.float32) * fbm(N, 4, 24, 12)
    lich = blur(lich, 1.5)
    dirt = fbm(N, 5, 3, 13)
    base = np.array([0.075, 0.08, 0.09])
    col = base[None, None, :] * (1 + tone[..., None] * 0.6 + crest[..., None] * 0.9 + butt[..., None] * 0.5
                                 - shadow[..., None] * 0.55)
    col = col * (0.85 + 0.3 * dirt[..., None])
    col = col * (1 - lich[..., None] * 0.6) + np.array([0.42, 0.42, 0.34])[None, None] * lich[..., None] * 0.6
    nor = normal_from_height(blur(h, 1.2), 1.4)
    ao = np.clip(1 - shadow * 0.6, 0, 1)
    rough = np.clip(0.28 + 0.15 * dirt + lich * 0.5, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, rough)


def tar_paper():
    tile = 3.6
    nr = 4                                                   # 0.9 m rolls, laps along u
    fy = (yy * nr) % 1.0
    lap = np.exp(-(fy * 60) ** 2) + np.exp(-((1 - fy) * 45) ** 2) * 0.5
    grit = fbm(N, 3, 256, 21)
    blot = fbm(N, 6, 3, 22)
    streak = fbm(N, 5, 4, 23, aniso=(1, 8))
    r = np.random.default_rng(24)
    patch = np.zeros((N, N), np.float32)
    edge = np.zeros((N, N), np.float32)
    for _ in range(5):
        cx, cy, w, hh = r.uniform(0, 1), r.uniform(0, 1), r.uniform(0.06, 0.18), r.uniform(0.04, 0.12)
        dx = np.abs(((xx - cx + 0.5) % 1) - 0.5)
        dy = np.abs(((yy - cy + 0.5) % 1) - 0.5)
        m = ((dx < w) & (dy < hh)).astype(np.float32)
        patch = np.maximum(patch, m * r.uniform(0.5, 1))
        e = ((np.abs(dx - w) < 0.002) & (dy < hh)) | ((np.abs(dy - hh) < 0.002) & (dx < w))
        edge = np.maximum(edge, e.astype(np.float32))
    luma = 0.1 + 0.05 * grit + 0.06 * blot + 0.03 * streak - lap * 0.035 + patch * -0.02 + edge * 0.04
    col = np.stack([luma * 1.0, luma * 0.99, luma * 0.97], -1)
    col += (blot > 0.72)[..., None] * np.array([0.05, 0.05, 0.035]) * blur(blot, 4)[..., None]   # sun-bleached
    h = lap * 1.0 + grit * 0.25 + patch * 0.4 + edge * 0.6
    nor = normal_from_height(blur(h, 0.8), 1.2)
    rough = np.clip(0.82 + 0.1 * grit - 0.15 * (blot < 0.2), 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(np.clip(1 - lap * 0.3, 0, 1), rough)


def turf():
    d = load('sod', 'diff')
    nb = load('sod', 'nor')
    tuss = fbm(N, 5, 10, 31)
    blades = fbm(N, 3, 180, 32, aniso=(1, 3))
    dry = fbm(N, 5, 3, 33)
    lum = d.mean(-1, keepdims=True)
    green = np.array([0.20, 0.30, 0.10])
    straw = np.array([0.46, 0.42, 0.22])
    dark = np.array([0.10, 0.14, 0.06])
    base = green[None, None] * (1 - dry[..., None] * 0.6) + straw[None, None] * dry[..., None] * 0.6
    col = base * (0.55 + 1.2 * lum) * (0.8 + 0.4 * blades[..., None])
    col = col * (1 - (1 - tuss[..., None]) * 0.35) + dark * (1 - tuss[..., None]) * 0.2
    h = tuss * 1.0 + blades * 0.6
    nor = blend_normals(nb, normal_from_height(blur(h, 1.5), 1.6))
    ao = np.clip(0.55 + 0.45 * tuss, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, np.full_like(ao, 0.95))


def log_hewn():
    streak = fbm(N, 6, 3, 41, aniso=(40, 1))
    fine = fbm(N, 3, 64, 42, aniso=(24, 1))
    tone = fbm(N, 4, 2, 43)
    r = np.random.default_rng(44)
    check = np.zeros((N, N), np.float32)
    for _ in range(26):
        cy, cx, L = r.uniform(0, 1), r.uniform(0, 1), r.uniform(0.08, 0.4)
        dy = np.abs(((yy - cy + 0.5) % 1) - 0.5)
        dx = ((xx - cx + 1) % 1)
        m = np.exp(-(dy * N / r.uniform(1.0, 2.2)) ** 2) * (dx < L) * np.sin(np.clip(dx / L, 0, 1) * np.pi)
        check = np.maximum(check, m)
    knots = np.zeros((N, N), np.float32)
    for _ in range(9):
        cy, cx = r.uniform(0, 1), r.uniform(0, 1)
        dx = ((xx - cx + 0.5) % 1) - 0.5
        dy = ((yy - cy + 0.5) % 1) - 0.5
        knots = np.maximum(knots, np.exp(-((dx / 0.012) ** 2 + (dy / 0.02) ** 2)))
    luma = 0.5 + 0.18 * (streak - 0.5) + 0.1 * (fine - 0.5) + 0.1 * (tone - 0.5) - check * 0.35 - knots * 0.15
    col = np.stack([luma * 0.98, luma * 0.88, luma * 0.74], -1)
    h = streak * 0.5 + fine * 0.35 - check * 1.2 - knots * 0.15
    nor = normal_from_height(blur(h, 0.7), 1.5)
    return np.clip(col, 0, 1), nor, arm_map(np.clip(1 - check * 0.5, 0, 1), np.full_like(h, 0.85))


def board_batten():
    nb = 8                                                    # 0.3 m module per 2.4 m tile: 0.24 board + 0.06 batten
    fx = (xx * nb) % 1.0
    bi = np.floor(xx * nb).astype(int)
    batten = (np.abs(fx - 0.0) < 0.1) | (fx > 0.9)
    bat = np.where(batten, 1.0, 0.0).astype(np.float32)
    bat = blur(bat, 1.2)
    grain = fbm(N, 5, 6, 51, aniso=(1, 30))
    r = np.random.default_rng(52)
    tone = r.normal(0, 0.05, nb)[bi % nb]
    wear = (fbm(N, 6, 14, 53) > 0.84).astype(np.float32) * blur(fbm(N, 4, 40, 54), 1)
    edge_sh = np.exp(-((np.abs(fx - 0.1)) * 70) ** 2) + np.exp(-((np.abs(fx - 0.9)) * 70) ** 2)
    cup = (np.sin(np.clip((fx - 0.1) / 0.8, 0, 1) * np.pi)) * (1 - bat)
    luma = 0.8 + tone + 0.08 * (grain - 0.5) - edge_sh * 0.28 + bat * 0.04
    col = np.stack([luma, luma, luma * 0.97], -1)
    wood = np.stack([0.42 + 0.1 * grain, 0.38 + 0.08 * grain, 0.32 + 0.06 * grain], -1)
    col = col * (1 - wear[..., None] * 0.7) + wood * wear[..., None] * 0.7
    h = bat * 2.2 + cup * 0.3 + grain * 0.25
    nor = normal_from_height(blur(h, 1.0), 1.8)
    ao = np.clip(1 - edge_sh * 0.45, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, np.clip(0.7 + wear * 0.2, 0, 1))


if __name__ == '__main__':
    ids = sys.argv[1:] or ['roof_pantile_black', 'tar_paper', 'turf_grass', 'log_hewn', 'board_batten']
    PH = lambda i: {'source': 'Poly Haven', 'id': i, 'license': 'CC0-1.0'}
    if 'roof_pantile_black' in ids:
        register('roof_pantile_black', 'Black glazed S-pantile roof (0.2 x 0.33 m)', *pantile(), 2.0, 0.35, grime=0.3)
    if 'tar_paper' in ids:
        register('tar_paper', 'Tar paper / roofing felt with roll laps and patches', *tar_paper(), 3.6, 0.85, grime=0.6)
    if 'turf_grass' in ids:
        register('turf_grass', 'Dense turf for sod roofs (torvtak)', *turf(), 2.0, 0.95, grime=0.0, base=PH('sparse_grass'))
    if 'log_hewn' in ids:
        register('log_hewn', 'Weathered hewn log surface (grain along u)', *log_hewn(), 2.0, 0.85, grime=0.8)
    if 'board_batten' in ids:
        register('board_batten', 'Painted board-and-batten cladding (tint per asset)', *board_batten(), 2.4, 0.7, grime=0.8)


def mesh_screen():
    """Radar reflector wire mesh: 24 x 24 wires per 0.6 m tile, light grey galvanised; alpha = wire coverage."""
    n = 24
    fx = (xx * n) % 1.0
    fy = (yy * n) % 1.0
    wx = np.exp(-(np.minimum(fx, 1 - fx) / 0.11) ** 2)
    wy = np.exp(-(np.minimum(fy, 1 - fy) / 0.11) ** 2)
    wire = np.clip(wx + wy, 0, 1)
    tone = fbm(N, 4, 6, 61)
    col = np.stack([0.7 + 0.1 * tone, 0.71 + 0.1 * tone, 0.72 + 0.1 * tone], -1) * (0.75 + 0.25 * wire[..., None])
    h = wire
    nor = normal_from_height(blur(h, 1.0), 1.0)
    arm = arm_map(np.ones_like(h), np.full_like(h, 0.5), 0.6)
    return col, nor, arm, wire


def register_alpha(mid, label, col, nor, arm, alpha, tile):
    from PIL import Image
    rgba = np.concatenate([np.clip(col, 0, 1), np.clip(alpha, 0, 1)[..., None]], -1)
    im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA')
    maps = {'diff': {}, 'nor': U.save(nor, mid + '_nor', 92), 'arm': U.save(arm, mid + '_arm')}
    for sz, res in ((1024, '1k'), (2048, '2k')):
        x = im.resize((sz, sz), Image.LANCZOS)
        x.save(os.path.join(U.LIB, res, mid + '_diff.png'))
        x.save(os.path.join(U.LIB, res, mid + '_diff.webp'), quality=88, method=5)
        x.convert('RGB').save(os.path.join(U.LIB, res, mid + '_diff.jpg'), quality=88)
        maps['diff'][res] = res + '/' + mid + '_diff'
    e = {'label': label, 'tile_m': tile, 'grain': 'u', 'rot90': False, 'roughness': 0.5, 'metallic': 0.6, 'grime': 0.3,
         'mean': [round(float(x), 4) for x in col.reshape(-1, 3).mean(0)], 'normalScale': 1.0, 'alpha': 'BLEND', 'specular': 0.0,
         'maps': maps, 'source': {'source': SRC, 'license': 'CC0-1.0'},
         'texel_density_px_per_m': {'1k': round(1024 / tile), '2k': round(2048 / tile)}}
    p = os.path.join(U.LIB, 'materials.json')
    MJ = json.load(open(p))
    MJ['materials'][mid] = e
    json.dump(MJ, open(p + '.tmp_nor', 'w'), indent=1)
    os.replace(p + '.tmp_nor', p)
    print('registered', mid)


if __name__ == '__main__' and 'mesh_screen' in sys.argv[1:]:
    c, nr, a, al = mesh_screen()
    register_alpha('mesh_screen', 'Radar reflector wire mesh (alpha blend, 25 mm)', c, nr, a, al * 0.92, 0.6)
