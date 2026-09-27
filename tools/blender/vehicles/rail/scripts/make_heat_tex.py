"""Procedural CC0 (own work) heat-discoloured burnt steel, 3.0 m tile, 1024 px -> lib/heat_{diff,nor,arm}.jpg.
Organic fbm fields (no cells/blocks): grey-white ash base, straw/bronze temper bands, blue-violet oxide, dark soot,
rust bloom where paint burnt off, and flaking (irregular paint/scale flakes with lighter fresh-oxide edges)."""
import numpy as np
from PIL import Image, ImageFilter
import os
N = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib')


def fbm(scale_px, oct=5, seed=0):
    r = np.random.default_rng(seed)
    acc = np.zeros((N, N), np.float32); amp = 1.0; tot = 0; s = scale_px
    for o in range(oct):
        g = max(2, int(round(N / s)))
        a = r.random((g, g)).astype(np.float32)
        a = np.concatenate([a, a[:1]], 0); a = np.concatenate([a, a[:, :1]], 1)
        im = Image.fromarray(a).resize((N * (g + 1) // g, N * (g + 1) // g), Image.BICUBIC)
        acc += np.asarray(im)[:N, :N] * amp; tot += amp; amp *= 0.5; s /= 2
    return acc / tot


def sm(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# warped temper field: bands of straw -> bronze -> blue -> grey as "temperature" rises
w1, w2 = fbm(260, 4, 1), fbm(260, 4, 2)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
T = fbm(420, 5, 3)
T = np.asarray(Image.fromarray((T * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
T = (T - T.min()) / (T.max() - T.min())
cols = {'ash': (0.46, 0.45, 0.43), 'straw': (0.60, 0.48, 0.27), 'bronze': (0.45, 0.30, 0.18), 'blue': (0.24, 0.26, 0.38),
        'soot': (0.07, 0.065, 0.06), 'rust': (0.42, 0.21, 0.10)}
img = np.zeros((N, N, 3), np.float32)
def put(c, w):
    global img
    img = img * (1 - w[..., None]) + np.array(c, np.float32)[None, None] * w[..., None]
put(cols['ash'], np.ones((N, N), np.float32))
put(cols['straw'], sm(T, 0.25, 0.38) * (1 - sm(T, 0.42, 0.5)) * 0.85)
put(cols['bronze'], sm(T, 0.4, 0.48) * (1 - sm(T, 0.52, 0.58)) * 0.8)
put(cols['blue'], sm(T, 0.52, 0.6) * (1 - sm(T, 0.66, 0.74)) * 0.8)
put(cols['rust'], sm(fbm(180, 5, 7), 0.55, 0.7) * 0.75)
put(cols['soot'], sm(fbm(300, 5, 8), 0.5, 0.68) * 0.9)
# flaking: irregular flakes (thresholded fine fbm), dark underside + light fresh-oxide rim
F = fbm(40, 4, 11)
flake = sm(F, 0.66, 0.69)
rim = np.clip(sm(F, 0.63, 0.66) - flake, 0, 1)
put((0.16, 0.12, 0.10), flake * 0.65)
put((0.62, 0.56, 0.48), rim * 0.6)
img *= (0.85 + 0.3 * fbm(12, 3, 13))[..., None]
Image.fromarray((np.clip(img, 0, 1) ** (1 / 1.0) * 255).astype(np.uint8)).save(os.path.join(OUT, 'heat_diff.jpg'), quality=88)
# normal from flakes + pitting
h = flake * 0.6 + fbm(20, 3, 14) * 0.4
gx = np.roll(h, -1, 1) - np.roll(h, 1, 1); gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
k = 3.0
n = np.dstack([-gx * k, -gy * k, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'heat_nor.jpg'), quality=90)
arm = np.dstack([1 - flake * 0.3, 0.8 + 0.15 * fbm(60, 3, 15) - 0.25 * sm(T, 0.5, 0.7), np.zeros_like(h)])
Image.fromarray((np.clip(arm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'heat_arm.jpg'), quality=88)
print('heat textures written')
