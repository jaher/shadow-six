"""make_burnt_tex.py - procedural CC0 'veh_burnt' (fire-gutted vehicle steel) for the kit library (own work).
Charred black steel, rust-orange/brown oxide blotches where the paint burnt off, grey-white ash / heat scale patches,
blistered texture. Tile 2.0 m. Writes lib/{1k,2k}/veh_burnt_{diff,nor,arm}.{jpg,webp} + materials.json entry."""
import os, json
import numpy as np
from PIL import Image
import importlib.util
spec = importlib.util.spec_from_file_location('mvt_noise', os.path.join(os.path.dirname(__file__), 'make_veh_tex.py'))
KIT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'art', 'kit'))
LIB = os.path.join(KIT, 'lib')
N = 2048
rng = np.random.default_rng(1944)


def tile_noise(n, cells, octaves=4, pers=0.5):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = np.tile(rng.random((c, c)).astype(np.float32), (3, 3))
        a = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((n * 3, n * 3), Image.BICUBIC), np.float32)[n:2 * n, n:2 * n] / 255.0
        out += a * amp
        tot += amp
        amp *= pers
    return out / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


lf = tile_noise(N, 3, 5, 0.55)
mf = tile_noise(N, 10, 4, 0.55)
hf = tile_noise(N, 64, 2, 0.6)
char = np.array([0.055, 0.050, 0.046], np.float32)
rust1 = np.array([0.40, 0.20, 0.09], np.float32)
rust2 = np.array([0.24, 0.13, 0.07], np.float32)
ash = np.array([0.50, 0.48, 0.45], np.float32)
r = smooth(0.48, 0.60, lf * 0.7 + mf * 0.3)                        # rust coverage
rv = smooth(0.3, 0.7, mf)
rgb = char[None, None] * (1 - r[..., None]) + (rust2 * (1 - rv[..., None]) + rust1 * rv[..., None]) * r[..., None]
a = smooth(0.66, 0.74, mf * 0.6 + hf * 0.4) * (1 - r * 0.6)          # ash / heat scale
rgb = rgb * (1 - a[..., None]) + ash * a[..., None]
rgb *= (0.8 + 0.4 * hf)[..., None]
rgb = np.clip(rgb, 0, 1)
rough = np.clip(0.88 + 0.08 * (hf - 0.5) - 0.1 * r * 0, 0.6, 1.0)
h = 0.6 * hf + 0.25 * smooth(0.55, 0.8, tile_noise(N, 40, 2)) - 0.3 * a
gy, gx = np.gradient(h)
nx, ny, nz = -gx * 6, gy * 6, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nor = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)
arm = np.stack([np.ones_like(h), rough, np.zeros_like(h)], -1)
maps = {}
for res, px in (('1k', 1024), ('2k', 2048)):
    for kind, arr in (('diff', rgb), ('nor', nor), ('arm', arm)):
        im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
        if px != N:
            im = im.resize((px, px), Image.LANCZOS)
        p = os.path.join(LIB, res, 'veh_burnt_' + kind)
        im.save(p + '.jpg', quality=90)
        im.save(p + '.webp', quality=88)
        maps.setdefault(kind, {})[res] = res + '/veh_burnt_' + kind
mean = [round(float(rgb[..., i].mean()), 4) for i in range(3)]
J = os.path.join(LIB, 'materials.json')
db = json.load(open(J))
db['materials']['veh_burnt'] = {'grain': 'u', 'grime': 0.3, 'label': 'Fire-gutted vehicle steel (char, rust, ash)', 'maps': maps,
                                'mean': mean, 'metallic': 0.0, 'normalScale': 0.8, 'rot90': False, 'roughness': 0.9,
                                'source': {'license': 'CC0-1.0', 'source': 'procedural (vehicles/cars_moto/scripts/make_burnt_tex.py, own work)'},
                                'texel_density_px_per_m': {'1k': 512, '2k': 1024}, 'tile_m': 2.0}
json.dump(db, open(J + '.tmp', 'w'), indent=1)
os.replace(J + '.tmp', J)
print('veh_burnt mean', mean)
