"""make_veh_tex.py - procedural CC0 'veh_paint' texture set for the kit library (own work).
Military vehicle paint (pale neutral, tinted per asset): smooth pressed steel with low-frequency mottling (brush/spray
unevenness), faint vertical run-down streaks, sparse small chips showing dark primer/steel, fine scratches, subtle
orange-peel normal. Tile 1.5 m. Writes lib/{1k,2k}/veh_paint_{diff,nor,arm}.{jpg,webp} and registers materials.json."""
import os, json, sys
import numpy as np
from PIL import Image, ImageFilter
KIT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'kit'))
LIB = os.path.join(KIT, 'lib')
N = 2048
rng = np.random.default_rng(1941)


def tile_noise(n, cells, octaves=4, pers=0.5):
    """Tileable value noise via bicubic-upsampled random grids."""
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = rng.random((c, c)).astype(np.float32)
        g = np.tile(g, (3, 3))
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((n * 3, n * 3), Image.BICUBIC)
        a = np.asarray(im, np.float32)[n:2 * n, n:2 * n] / 255.0
        out += a * amp
        tot += amp
        amp *= pers
    return out / tot


base = 0.80
mott = tile_noise(N, 4, 4, 0.55) - 0.5
streak = tile_noise(N, 1, 1)                          # placeholder
cols = rng.random(N // 8).astype(np.float32)
cols = np.asarray(Image.fromarray((cols * 255).astype(np.uint8)[None, :]).resize((N, 1), Image.BICUBIC), np.float32)[0] / 255.0
vert = tile_noise(N, 2, 3, 0.5)
streaks = (cols[None, :] - 0.5) * 0.9 * (0.4 + vert)   # vertical runs (v axis = up in kit UVs)
alb = base * (1 + 0.12 * mott + 0.04 * streaks + 0.05 * (tile_noise(N, 16, 2) - 0.5))
rough = 0.52 + 0.10 * (tile_noise(N, 8, 3) - 0.5) + 0.06 * streaks
# chips: sparse, small, irregular; dark primer/steel core with a lighter paint-edge ring
hf = tile_noise(N, 48, 3, 0.6)
lf = tile_noise(N, 3, 3, 0.5)
mf = tile_noise(N, 12, 2, 0.5)
score = hf + 0.35 * mf + 0.3 * lf
chip = (score > np.percentile(score, 98.9)).astype(np.float32)
chip_img = Image.fromarray((chip * 255).astype(np.uint8))
chip_s = np.asarray(chip_img.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0
ring = np.clip(np.asarray(chip_img.filter(ImageFilter.MaxFilter(5)), np.float32) / 255.0 - chip_s, 0, 1)
# scratches: thin short lines
scr = Image.new('L', (N, N), 0)
from PIL import ImageDraw
d = ImageDraw.Draw(scr)
for _ in range(140):
    x, y = rng.integers(0, N, 2)
    a = rng.uniform(0, np.pi)
    L = rng.uniform(10, 60)
    d.line([(x, y), (x + np.cos(a) * L, y + np.sin(a) * L)], fill=int(rng.uniform(90, 200)), width=1)
scr = np.asarray(scr, np.float32) / 255.0
primer = np.array([0.30, 0.22, 0.18], np.float32)     # red-brown primer / dark steel
rgb = np.repeat(alb[..., None], 3, 2) * np.array([1.0, 0.995, 0.985], np.float32)
rgb = rgb * (1 - chip_s[..., None]) + primer * chip_s[..., None]
rgb = rgb * (1 + 0.10 * ring[..., None]) * (1 - 0.25 * scr[..., None])
rgb = np.clip(rgb, 0, 1)
rough = np.clip(rough + 0.2 * chip_s + 0.1 * scr, 0.3, 0.95)
metal = np.clip(chip_s * 0.25, 0, 1)
ao = np.ones_like(rough)
# normal: orange peel + chips recessed + scratches
h = 0.25 * (tile_noise(N, 64, 2) - 0.5) - 0.9 * chip_s - 0.35 * scr + 0.15 * mott
gy, gx = np.gradient(h)
s = 3.0
nx, ny, nz = -gx * s, gy * s, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nor = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)
arm = np.stack([ao, rough, metal], -1)
maps = {}
for res, px in (('1k', 1024), ('2k', 2048)):
    os.makedirs(os.path.join(LIB, res), exist_ok=True)
    for kind, arr in (('diff', rgb), ('nor', nor), ('arm', arm)):
        im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
        if px != N:
            im = im.resize((px, px), Image.LANCZOS)
        p = os.path.join(LIB, res, 'veh_paint_' + kind)
        im.save(p + '.jpg', quality=90)
        im.save(p + '.webp', quality=88)
        maps.setdefault(kind, {})[res] = res + '/veh_paint_' + kind
mean = [round(float(rgb[..., i].mean()), 4) for i in range(3)]
J = os.path.join(LIB, 'materials.json')
db = json.load(open(J))
db['materials']['veh_paint'] = {'grain': 'u', 'grime': 0.5, 'label': 'Military vehicle paint on pressed steel (pale, tint per asset)',
                                'maps': maps, 'mean': mean, 'metallic': 0.0, 'normalScale': 0.6, 'rot90': False, 'roughness': 0.55,
                                'source': {'license': 'CC0-1.0', 'source': 'procedural (vehicles/cars_moto/scripts/make_veh_tex.py, own work)'},
                                'texel_density_px_per_m': {'1k': 683, '2k': 1365}, 'tile_m': 1.5}
tmp = J + '.tmp'
json.dump(db, open(tmp, 'w'), indent=1)
os.replace(tmp, J)
print('veh_paint mean', mean)
