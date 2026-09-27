"""Procedural (own-work, CC0) shared textures: dirty glass, interior darkness, curtain, weathering decal atlas.
Merges entries into lib/materials.json (run AFTER build_lib.py)."""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(KIT, 'lib')
R = np.random.default_rng(7)


def fbm(n, octaves=6, base=4, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = base * 2 ** o
        g = r.random((s, s)).astype(np.float32)
        g = np.tile(g, (2, 2))[: s + 1, : s + 1]          # wrap for tiling
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((n + n // s, n + n // s), Image.BICUBIC)
        out += amp * np.asarray(im, np.float32)[:n, :n] / 255.0
        tot += amp
        amp *= 0.55
    return out / tot


def save_rgb(arr, name, sizes=((1024, '1k'), (2048, '2k')), mode='RGB', q=88):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    out = {}
    for sz, res in sizes:
        x = im.resize((sz, sz * im.size[1] // im.size[0]), Image.LANCZOS) if im.size[0] != sz else im
        os.makedirs(os.path.join(LIB, res), exist_ok=True)
        if mode == 'RGBA':
            x.save(os.path.join(LIB, res, name + '.png'), optimize=True)
            x.save(os.path.join(LIB, res, name + '.webp'), quality=90, method=5)
        else:
            x.save(os.path.join(LIB, res, name + '.jpg'), quality=q)
            x.save(os.path.join(LIB, res, name + '.webp'), quality=q - 4, method=5)
        out[res] = res + '/' + name
    return out


def flat_normal(n):
    a = np.zeros((n, n, 3), np.float32)
    a[..., 0] = a[..., 1] = 0.5
    a[..., 2] = 1.0
    return a


def normal_from_height(h, strength=2.0):
    gy, gx = np.gradient(h)
    nx, ny = -gx * strength * h.shape[0] / 64, gy * strength * h.shape[0] / 64
    nz = np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L * 0.5 + 0.5, ny / L * 0.5 + 0.5, nz / L * 0.5 + 0.5], -1)


def glass():
    n = 1024
    dirt = fbm(n, 7, 3, 1)
    smear = fbm(n, 5, 2, 2)
    d = np.clip((dirt - 0.45) * 2.2 + (smear - 0.5) * 0.8, 0, 1)
    base = np.array([0.075, 0.085, 0.085])
    dcol = np.array([0.34, 0.31, 0.26])
    diff = base[None, None] * (1 - d[..., None] * 0.7) + dcol[None, None] * d[..., None] * 0.7
    rough = 0.06 + 0.55 * d
    arm = np.stack([np.ones_like(d), rough, np.zeros_like(d)], -1)
    return {'diff': save_rgb(diff, 'glass_dirty_diff'), 'nor': save_rgb(flat_normal(n), 'glass_dirty_nor'),
            'arm': save_rgb(arm, 'glass_dirty_arm')}


def interior():
    n = 512
    f = fbm(n, 5, 2, 3)
    diff = np.stack([f * 0.05 + 0.035, f * 0.045 + 0.03, f * 0.04 + 0.025], -1)
    arm = np.stack([np.ones_like(f), np.full_like(f, 0.95), np.zeros_like(f)], -1)
    return {'diff': save_rgb(diff, 'interior_dark_diff', ((512, '1k'), (512, '2k'))),
            'nor': save_rgb(flat_normal(n), 'interior_dark_nor', ((512, '1k'), (512, '2k'))),
            'arm': save_rgb(arm, 'interior_dark_arm', ((512, '1k'), (512, '2k')))}


def curtain():
    n = 1024
    x = np.linspace(0, 1, n, endpoint=False)
    folds = 0.5 + 0.5 * np.sin(x * 2 * math.pi * 9 + 1.3 * np.sin(x * 2 * math.pi * 2))
    h = np.tile(folds[None, :], (n, 1)) + fbm(n, 4, 8, 4) * 0.15
    weave = fbm(n, 2, 128, 5) * 0.08
    shade = 0.55 + 0.45 * h + weave
    col = np.array([0.78, 0.74, 0.64])
    diff = col[None, None] * shade[..., None]
    arm = np.stack([0.7 + 0.3 * h, np.full_like(h, 0.9), np.zeros_like(h)], -1)
    return {'diff': save_rgb(diff, 'curtain_diff'), 'nor': save_rgb(normal_from_height(h * 0.6), 'curtain_nor'),
            'arm': save_rgb(arm, 'curtain_arm')}


def entry(label, maps, tile, rough, metal=0.0, grime=0.0, extra=None):
    e = {'label': label, 'tile_m': tile, 'grain': 'u', 'rot90': False, 'roughness': rough, 'metallic': metal,
         'grime': grime, 'mean': [0.3, 0.3, 0.3], 'normalScale': 1.0, 'maps': maps,
         'source': {'source': 'procedural (tools/make_procedural.py, own work)', 'license': 'CC0-1.0'}}
    if extra:
        e.update(extra)
    return e


if __name__ == '__main__':
    mj_path = os.path.join(LIB, 'materials.json')
    MJ = json.load(open(mj_path))
    M = MJ['materials']
    M['glass_dirty'] = entry('Dirty window glass', glass(), 0.9, 1.0, extra={'mean': [0.1, 0.1, 0.1], 'specular': 1.0, 'envBoost': 1.4})
    M['interior_dark'] = entry('Interior darkness card', interior(), 2.0, 1.0, extra={'mean': [0.05, 0.045, 0.04], 'specular': 0.0})
    M['curtain'] = entry('Curtain / lace hint', curtain(), 1.2, 1.0, extra={'mean': [0.6, 0.57, 0.5], 'specular': 0.2})
    json.dump(MJ, open(mj_path, 'w'), indent=1)
    print('procedural done')
