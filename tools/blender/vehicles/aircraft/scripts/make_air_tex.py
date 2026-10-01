"""make_air_tex.py - procedural CC0 aircraft skin textures for the kit library (own work), pale + tinted per asset
through COLOR_0 like 'veh_paint':
  air_corr   : painted Junkers corrugated duralumin (Ju 52): 50 mm pitch, ~9 mm deep waves running along the texture u
               axis (use uv='beam', axis = flight direction), grime in the troughs, rivet lines every 0.75 m.
  air_fabric : doped fabric over ribs (Storch / autogiro / control surfaces): rib tapes with stitching every 0.375 m
               along u, slight sag between ribs, smooth dope.
  air_skin   : smooth stressed aluminium skin with panel lines + flush rivet rows (Bf 109 / Ju 87).
Tile 1.5 m. Writes lib/{1k,2k}/<id>_{diff,nor,arm}.{jpg,webp} and registers lib/materials.json."""
import os, json
import numpy as np
from PIL import Image
KIT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'kit'))
LIB = os.path.join(KIT, 'lib')
N = 2048
rng = np.random.default_rng(1942)


def tile_noise(n, cells, octaves=4, pers=0.5):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = np.tile(rng.random((c, c)).astype(np.float32), (3, 3))
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((n * 3, n * 3), Image.BICUBIC)
        out += np.asarray(im, np.float32)[n:2 * n, n:2 * n] / 255.0 * amp
        tot += amp
        amp *= pers
    return out / tot


def normal_from(h, s):
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * s, gy * s, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)


px_m = N / 1.5                                   # pixels per metre
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
mott = tile_noise(N, 4, 4, 0.55) - 0.5
fine = tile_noise(N, 32, 2) - 0.5
streak_cols = np.asarray(Image.fromarray((rng.random(N // 16) * 255).astype(np.uint8)[None, :]).resize((N, 1), Image.BICUBIC),
                         np.float32)[0] / 255.0
streaks = (streak_cols[None, :] - 0.5) * (0.3 + tile_noise(N, 2, 3))
hf = tile_noise(N, 48, 3, 0.6)
chip = (hf + 0.4 * tile_noise(N, 6, 2) > np.percentile(hf + 0.4 * tile_noise(N, 6, 2), 99.5)).astype(np.float32)


def rivets(mask_rows, pitch_m, r_px, along='u'):
    """Dome rivet heights on rows (list of pixel coords across) every pitch along u."""
    h = np.zeros((N, N), np.float32)
    step = int(pitch_m * px_m)
    for r in mask_rows:
        for c in range(step // 2, N, step):
            y0, y1 = max(0, r - r_px - 1), min(N, r + r_px + 2)
            x0, x1 = max(0, c - r_px - 1), min(N, c + r_px + 2)
            d = np.sqrt((yy[y0:y1, x0:x1] - r) ** 2 + (xx[y0:y1, x0:x1] - c) ** 2) / r_px
            h[y0:y1, x0:x1] = np.maximum(h[y0:y1, x0:x1], np.clip(1 - d * d, 0, 1))
    return h


def save(mid, rgb, nor, rough, metal, label, grime, nscale, rough_def):
    arm = np.stack([np.ones_like(rough), rough, metal], -1)
    maps = {}
    for res, px in (('1k', 1024), ('2k', 2048)):
        os.makedirs(os.path.join(LIB, res), exist_ok=True)
        for kind, arr in (('diff', rgb), ('nor', nor), ('arm', arm)):
            im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
            if px != N:
                im = im.resize((px, px), Image.LANCZOS)
            p = os.path.join(LIB, res, mid + '_' + kind)
            im.save(p + '.jpg', quality=90)
            im.save(p + '.webp', quality=88)
            maps.setdefault(kind, {})[res] = res + '/' + mid + '_' + kind
    mean = [round(float(rgb[..., i].mean()), 4) for i in range(3)]
    J = os.path.join(LIB, 'materials.json')
    db = json.load(open(J))
    db['materials'][mid] = {'grain': 'u', 'grime': grime, 'label': label, 'maps': maps, 'mean': mean, 'metallic': 0.0,
                            'normalScale': nscale, 'rot90': False, 'roughness': rough_def,
                            'source': {'license': 'CC0-1.0', 'source': 'procedural (vehicles/aircraft/scripts/make_air_tex.py, own work)'},
                            'texel_density_px_per_m': {'1k': 683, '2k': 1365}, 'tile_m': 1.5}
    tmp = J + '.tmp'
    json.dump(db, open(tmp, 'w'), indent=1)
    os.replace(tmp, J)
    print(mid, 'mean', mean)


def paintish(extra_dark):
    alb = 0.80 * (1 + 0.10 * mott + 0.05 * streaks + 0.04 * fine) - extra_dark
    rgb = np.repeat(alb[..., None], 3, 2) * np.array([1.0, 0.995, 0.985], np.float32)
    bare = np.array([0.62, 0.63, 0.64], np.float32)           # chipped paint -> bare duralumin, not rust
    return rgb * (1 - chip[..., None]) + bare * chip[..., None]


# ---- air_corr: waves vary with v (rows), ridges run along u
P = 0.05 * px_m
ph = 2 * np.pi * yy / P
wave = np.sin(ph)                                        # +1 crest, -1 trough
lap_rows = [int(r) for r in np.arange(0.375, 1.5, 0.75) * px_m]
riv = rivets(lap_rows, 0.03, 3)
for r in lap_rows:                                        # skin lap joint across the waves
    wave[max(0, r - 6):r + 6] *= 0.3
h = 0.9 * wave + 0.08 * fine + 0.6 * riv
trough = np.clip(-wave, 0, 1) ** 2
rgb = paintish(0.07 * trough * (0.5 + tile_noise(N, 3, 2)))
nor = normal_from(h, 10.0)
rough = np.clip(0.55 + 0.08 * mott + 0.08 * trough, 0.3, 0.9)
save('air_corr', rgb, nor, rough, chip * 0.6, 'Painted Junkers corrugated duralumin, 50 mm pitch (pale, tint per asset)',
     0.5, 1.0, 0.55)

# ---- air_fabric: rib tapes every 0.375 m (rows), stitching, sag between ribs
rp = 0.375 * px_m
d = ((yy + rp / 2) % rp) - rp / 2                       # distance to nearest rib (px), rib at d=0
tape = np.clip(1 - np.abs(d) / (0.012 * px_m), 0, 1)
tape = (tape > 0).astype(np.float32) * 0.6 + 0.4 * tape
sag = -(np.abs(d) / (rp / 2) - 1) ** 2 * 0.0 + (np.abs(d) / (rp / 2)) ** 0.7 * -0.5
stitch = ((xx % (0.03 * px_m)) < 0.012 * px_m).astype(np.float32) * (np.abs(d) < 0.005 * px_m)
h = sag + 0.9 * tape + 0.4 * stitch + 0.05 * fine
alb = 0.80 * (1 + 0.08 * mott + 0.04 * streaks + 0.05 * fine) - 0.03 * tape
rgb = np.repeat(alb[..., None], 3, 2) * np.array([1.0, 0.99, 0.97], np.float32)
nor = normal_from(h, 6.0)
rough = np.clip(0.62 + 0.06 * mott - 0.05 * tape, 0.3, 0.9)
save('air_fabric', rgb, nor, rough, np.zeros_like(rough), 'Doped aircraft fabric over ribs, 0.375 m rib pitch (pale, tint per asset)',
     0.5, 0.8, 0.62)

# ---- air_skin: panel lines every 0.75 m (both axes), rivet rows beside them
pl = np.zeros((N, N), np.float32)
for q in np.arange(0.0, 1.5, 0.75) * px_m:
    q = int(q)
    pl[max(0, q - 2):q + 2, :] = 1
    pl[:, max(0, q - 2):q + 2] = 1
rows = [int(q) + 10 for q in np.arange(0.0, 1.5, 0.75) * px_m]
riv = rivets(rows, 0.025, 2)
riv = np.maximum(riv, rivets(rows, 0.025, 2).T)
h = -1.0 * pl + 0.35 * riv + 0.06 * fine + 0.08 * mott
rgb = paintish(0.08 * pl + 0.03 * riv)
nor = normal_from(h, 5.0)
rough = np.clip(0.5 + 0.08 * mott + 0.15 * pl, 0.3, 0.9)
save('air_skin', rgb, nor, rough, chip * 0.6, 'Painted stressed aluminium skin, panel lines + flush rivets (pale, tint per asset)',
     0.5, 0.8, 0.5)
