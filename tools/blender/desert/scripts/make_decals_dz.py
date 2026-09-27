"""Desert weathering decal atlas 'decals_dz' (own work, CC0): soft organic cells, no hard edges, 2 variants for the
repeated kinds. 4x4 cells; rect [u0, v0, u1, v1] with v up (image top = decal 'up'). Writes kit/lib/{1k,2k}/decals_dz_rgba
(.png + .webp), merges 'decals_dz' into lib/decals.json and lib/materials.json (re-read right before writing)."""
import json, os
import numpy as np
from PIL import Image

KIT = '<claude-tmp>'
N = 512
CELLS = ['soot_a', 'soot_b', 'grime_a', 'grime_b',
         'damp_rise', 'roof_stain_a', 'roof_stain_b', 'dust_wash',
         'scorch_a', 'scorch_b', 'oil_stain', 'wet_ground',
         'crack_fine', 'render_loss', 'rust_run', 'ash']
Y, X = np.mgrid[0:N, 0:N] / (N - 1.0)          # Y = 0 at image top
UP = 1.0 - Y                                    # 0 at the bottom (decal 'down'), 1 at the top


def fbm(seed, oct=5, base=4, sx=1.0, sy=1.0, pers=0.55):
    r = np.random.RandomState(seed)
    out = np.zeros((N, N))
    amp, tot = 1.0, 0.0
    for o in range(oct):
        fx, fy = max(2, int(base * sx * 2 ** o)), max(2, int(base * sy * 2 ** o))
        g = r.rand(fy + 1, fx + 1).astype(np.float32)
        out += amp * np.asarray(Image.fromarray(g).resize((N, N), Image.BICUBIC))
        tot += amp
        amp *= pers
    out /= tot
    return (out - out.min()) / (out.max() - out.min() + 1e-6)


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


WIN = ss(0.0, 0.1, X) * ss(0.0, 0.1, 1 - X) * ss(0.0, 0.1, Y) * ss(0.0, 0.1, 1 - Y)


def rgb(c, var=None, k=0.12):
    a = np.ones((N, N, 3)) * (np.array(c, float) / 255.0)
    if var is not None:
        a *= (1 - k + 2 * k * var)[..., None]
    return a


def soot(seed):
    n, st = fbm(seed, 5, 3), fbm(seed + 9, 4, 6, sx=1.0, sy=0.25)
    width = 0.1 + 0.3 * UP ** 0.8 + 0.1 * (n - 0.5)       # narrow at the opening head, widening upward
    body = ss(0.0, 1.0, 1 - np.abs(X - 0.5 - 0.08 * (n - 0.5)) / np.maximum(width, 0.05)) ** 1.5
    fade = ss(0.95, 0.05, UP) ** 1.4 * ss(0.0, 0.06, UP)
    breakup = ss(0.25, 0.75, 0.6 * st + 0.4 * n)
    a = 0.72 * body * fade * (0.35 + 0.65 * breakup)
    return rgb((56, 49, 43), n, 0.2), a


def grime(seed):
    runs = np.zeros((N, N))
    r = np.random.RandomState(seed)
    for i in range(r.randint(6, 10)):
        x0, w, L = r.uniform(0.15, 0.85), r.uniform(0.015, 0.06), r.uniform(0.35, 0.95)
        wob = 0.02 * np.sin(Y * r.uniform(6, 14) + r.uniform(0, 6))
        prof = ss(1.0, 0.0, np.abs(X - x0 - wob) / w)
        runs = np.maximum(runs, prof * ss(L, L * 0.3, Y) * r.uniform(0.5, 1.0))
    n = fbm(seed + 3, 4, 4, sx=1, sy=0.3)
    top = ss(0.2, 0.0, Y) * ss(0.3, 0.8, n) * ss(0.15, 0.45, X) * ss(0.85, 0.55, X)
    a = 0.6 * np.maximum(runs * (0.6 + 0.4 * n), top * 0.45)
    return rgb((148, 134, 116), n), a


def damp():
    n = fbm(21, 5, 5, sx=1, sy=0.5)
    edge = 0.5 + 0.12 * (fbm(22, 3, 3, sx=1, sy=0.2) - 0.5)
    a = 0.55 * ss(edge + 0.04, edge - 0.25, UP) * (0.6 + 0.4 * n) * ss(0.0, 0.1, UP)
    salt = np.exp(-((UP - edge) / 0.025) ** 2) * (0.5 + 0.5 * n)
    c = rgb((124, 110, 94), n) * (1 - salt[..., None]) + rgb((222, 216, 200)) * salt[..., None]
    return c, np.maximum(a, 0.55 * salt)


def blob(seed, rad=0.4, soft=0.18, amp=0.45, warp=0.22, sx=1.0):
    n, w = fbm(seed, 5, 3), fbm(seed + 1, 3, 2)
    d = np.sqrt(((X - 0.5) / sx) ** 2 + (Y - 0.5) ** 2) + warp * (w - 0.5)
    return ss(rad, rad - soft, d) * amp * (0.55 + 0.45 * n), n


def roof_stain(seed, sx=1.0):
    a, n = blob(seed, 0.38, 0.22, 0.42, 0.3, sx)
    spots = ss(0.72, 0.9, fbm(seed + 5, 4, 8)) * 0.35 * ss(0.45, 0.2, np.hypot(X - 0.5, Y - 0.5))
    return rgb((112, 100, 86), n, 0.18), np.maximum(a, spots)


def dust():
    a, n = blob(41, 0.42, 0.3, 0.6, 0.35)
    return rgb((198, 170, 132), n, 0.08), a


def scorch(seed):
    n, w = fbm(seed, 5, 3), fbm(seed + 2, 4, 5)
    d = np.hypot(X - 0.5, Y - 0.5) + 0.2 * (w - 0.5)
    core = ss(0.22, 0.05, d)
    halo = ss(0.44, 0.15, d)
    c = rgb((88, 70, 56), n) * (1 - core[..., None]) + rgb((40, 36, 33), n) * core[..., None]
    a = (0.45 * halo + 0.4 * core) * (0.6 + 0.4 * n)
    return c, a


def oil():
    a, n = blob(61, 0.34, 0.12, 0.62, 0.25)
    ring = np.exp(-((np.hypot(X - 0.5, Y - 0.5) + 0.25 * (fbm(62, 3, 2) - 0.5) - 0.3) / 0.03) ** 2) * 0.2
    return rgb((46, 41, 36), n, 0.1), np.clip(a + ring, 0, 0.8)


def wet():
    a, n = blob(71, 0.4, 0.2, 0.5, 0.35)
    return rgb((96, 80, 62), n, 0.1), a


def crack():
    img = np.zeros((N, N))
    r = np.random.RandomState(81)

    def walk(x, y, ang, L, w):
        for i in range(int(L)):
            ang += r.normal(0, 0.25)
            x, y = x + np.cos(ang) * 2, y + np.sin(ang) * 2
            xi, yi = int(x), int(y)
            if not (40 < xi < N - 40 and 40 < yi < N - 40):
                return
            img[yi - w:yi + w + 1, xi - w:xi + w + 1] = 1
            if r.rand() < 0.012 and L > 40:
                walk(x, y, ang + r.choice([-1, 1]) * r.uniform(0.5, 1.1), L * 0.4, max(0, w - 1))
    walk(N * 0.5, N * 0.12, np.pi / 2, 200, 1)
    walk(N * 0.5, N * 0.5, 0.3, 100, 1)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((N, N))
    from PIL import ImageFilter
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
    return rgb((58, 50, 44)), np.clip(a * 1.4, 0, 0.85)


def render_loss():
    n, w = fbm(91, 5, 3), fbm(92, 3, 3)
    d = np.hypot((X - 0.5) * 1.2, Y - 0.5) + 0.25 * (w - 0.5)
    inside = ss(0.3, 0.285, d)
    rim = np.exp(-((d - 0.29) / 0.012) ** 2)
    shade = np.clip((Y - 0.5) * -2 + (X - 0.5) * -1, -1, 1)          # top-left inner edge in shadow
    c = rgb((150, 128, 104), n, 0.2) * (1 - 0.35 * rim[..., None] * (shade[..., None] > 0))
    c = c * (1 - rim[..., None] * 0.2) + rgb((235, 230, 220)) * (rim[..., None] * 0.2 * (shade[..., None] <= 0))
    return c, np.clip(inside * 0.95 + rim * 0.5, 0, 1)


def rust():
    c, a = grime(101)
    return rgb((122, 64, 34)), a * 0.9


def ash():
    n = fbm(111, 5, 6)
    a, _ = blob(112, 0.42, 0.25, 0.7, 0.4)
    return rgb((112, 110, 106), n, 0.25), a * ss(0.35, 0.7, n)


GEN = {'soot_a': lambda: soot(1), 'soot_b': lambda: soot(7), 'grime_a': lambda: grime(11), 'grime_b': lambda: grime(17),
       'damp_rise': damp, 'roof_stain_a': lambda: roof_stain(31), 'roof_stain_b': lambda: roof_stain(37, 1.5),
       'dust_wash': dust, 'scorch_a': lambda: scorch(51), 'scorch_b': lambda: scorch(57), 'oil_stain': oil,
       'wet_ground': wet, 'crack_fine': crack, 'render_loss': render_loss, 'rust_run': rust, 'ash': ash}

atlas = np.zeros((4 * N, 4 * N, 4))
rects = {}
for i, k in enumerate(CELLS):
    r, c = divmod(i, 4)
    col, a = GEN[k]()
    a = np.clip(a, 0, 1) * WIN
    atlas[r * N:(r + 1) * N, c * N:(c + 1) * N, :3] = np.clip(col, 0, 1)
    atlas[r * N:(r + 1) * N, c * N:(c + 1) * N, 3] = a
    rects[k] = [c / 4, 1 - (r + 1) / 4, (c + 1) / 4, 1 - r / 4]
img = Image.fromarray((atlas * 255).astype(np.uint8), 'RGBA')
for res, px in (('2k', 2048), ('1k', 1024)):
    im = img if px == 2048 else img.resize((px, px), Image.LANCZOS)
    im.save(f'{KIT}/lib/{res}/decals_dz_rgba.png', optimize=True)
    im.save(f'{KIT}/lib/{res}/decals_dz_rgba.webp', quality=88)
dj = json.load(open(KIT + '/lib/decals.json'))
dj['decals_dz'] = rects
json.dump(dj, open(KIT + '/lib/decals.json', 'w'), indent=1)
mj = json.load(open(KIT + '/lib/materials.json'))
e = dict(mj['materials']['decals'])
e.update({'label': 'Desert weathering decal atlas (soft organic soot/grime/damp/stains/scorch, alpha blend)',
          'source': {'source': 'procedural (art/desert/scripts/make_decals_dz.py, own work)', 'license': 'CC0-1.0'},
          'maps': {'diff': {'1k': '1k/decals_dz_rgba', '2k': '2k/decals_dz_rgba'}}, 'atlas': 'decals_dz'})
mj['materials']['decals_dz'] = e
json.dump(mj, open(KIT + '/lib/materials.json', 'w'), indent=1)
Image.fromarray((atlas[..., :3] * atlas[..., 3:] * 255 + (1 - atlas[..., 3:]) * 200).astype(np.uint8)).resize((600, 600)).save(
    '<claude-tmp>')
print('ok', rects['soot_a'])
