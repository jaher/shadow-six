"""Procedural CC0 riveted-plate texture sets (own work) for the K5 carriage and riveted rolling stock, 6.0 m tile,
1536 px (256 px/m): plate butt seams every 1.5 m (u) with double rivet columns, horizontal lap rows every 1.0 m (v).
  rivet_{diff,nor,arm}: pale paint (mean ~0.78, tinted per asset by vertex colour)
  k5camo_diff: Dunkelgelb/tan base + red-brown + olive-green sprayed blotches (Italy 1943-44), absolute colours
  k5ww_diff:   worn winter whitewash over Dunkelgrau: worn-through patches, vertical run-off streaks, grime."""
import numpy as np
from PIL import Image, ImageFilter
import os
N, TILE = 1536, 6.0
PX = N / TILE
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib')
rng = np.random.default_rng(5)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)


def fbm(scale_px, oct=5, seed=0):
    r = np.random.default_rng(seed)
    acc = np.zeros((N, N), np.float32); amp = 1.0; tot = 0
    s = scale_px
    for o in range(oct):
        g = max(2, int(round(N / s)))
        a = r.random((g, g)).astype(np.float32)
        a = np.concatenate([a, a[:1]], 0); a = np.concatenate([a, a[:, :1]], 1)
        im = Image.fromarray(a).resize((N * (g + 1) // g, N * (g + 1) // g), Image.BICUBIC)
        acc += np.asarray(im)[:N, :N] * amp
        tot += amp; amp *= 0.5; s /= 2
    return acc / tot


# ---- height: rivets + seams
h = np.zeros((N, N), np.float32)
rr = 0.011 * PX
pitch = 0.075 * PX


def rivet_col(u0):
    for v in np.arange(pitch / 2, N, pitch):
        d2 = (xx - u0) ** 2 + (yy - v) ** 2
        np.maximum(h, np.clip(1 - d2 / rr ** 2, 0, 1) ** 0.5, out=h)


def rivet_row(v0):
    for u in np.arange(pitch / 2, N, pitch):
        d2 = (xx - u) ** 2 + (yy - v0) ** 2
        np.maximum(h, np.clip(1 - d2 / rr ** 2, 0, 1) ** 0.5, out=h)


seam = np.zeros((N, N), np.float32)
for k in range(int(TILE / 1.5)):
    u = k * 1.5 * PX + 0.75 * PX
    seam = np.maximum(seam, np.clip(1 - np.abs(xx - u) / 1.2, 0, 1))                  # butt joint line
    strap = (np.abs(xx - u) < 0.07 * PX).astype(np.float32) * 0.25                     # butt strap plate
    h = np.maximum(h, strap)
    rivet_col(u - 0.04 * PX); rivet_col(u + 0.04 * PX)
for k in range(int(TILE / 1.0)):
    v = k * 1.0 * PX + 0.5 * PX
    seam = np.maximum(seam, np.clip(1 - np.abs(yy - v - 0.03 * PX) / 1.2, 0, 1))      # lap edge
    h = np.maximum(h, (np.abs(yy - v) < 0.03 * PX).astype(np.float32) * 0.18)
    rivet_row(v)
h = (h * 2 + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 6
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 2.2
gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 2.2
n = np.stack([-gx, gy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'rivet_nor.jpg'), quality=90)
mott = fbm(180, 5, 1)
ao = np.clip(1 - seam * 0.45, 0, 1) * (0.92 + 0.08 * h)
rough = np.clip(0.72 + 0.12 * (mott - 0.5) - 0.12 * h, 0, 1)
Image.fromarray((np.stack([ao, rough, np.zeros_like(h)], -1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'rivet_arm.jpg'), quality=90)
shade = (1 - seam * 0.35) * (1 + 0.06 * h)
streak = np.clip(fbm(60, 3, 7) - 0.55, 0, 1) * np.clip(1 - (yy % (1.0 * PX)) / (0.9 * PX), 0, 1)   # rust tears under rows


def save(name, rgb_lin):
    Image.fromarray((np.clip(rgb_lin, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=88)


pale = 0.78 * (0.94 + 0.12 * (mott - 0.5))[..., None] * shade[..., None] * np.ones(3)
pale = pale * (1 - 0.35 * streak[..., None] * np.array([0.2, 0.45, 0.7]))
save('rivet_diff.jpg', pale)
# ---- DAK / Italy camouflage: tan base, brown + green sprayed blotches (soft edges)
tan = np.array([150, 124, 84]) / 255.0
brown = np.array([96, 64, 42]) / 255.0
green = np.array([82, 88, 54]) / 255.0
b1 = fbm(420, 4, 11); b2 = fbm(380, 4, 23)
mb = np.clip((b1 - 0.56) * 14, 0, 1); mg = np.clip((b2 - 0.58) * 14, 0, 1) * (1 - mb)
lin = lambda c: c ** 2.2
cam = lin(tan)[None, None] * (1 - mb - mg)[..., None] + lin(brown)[None, None] * mb[..., None] + lin(green)[None, None] * mg[..., None]
cam = cam * (0.9 + 0.2 * (mott[..., None] - 0.5)) * shade[..., None]
fade = np.clip(fbm(90, 4, 3) - 0.62, 0, 1)[..., None] * 1.2                          # sun-bleached / dusty patches
cam = cam * (1 - fade) + lin(np.array([0.82, 0.74, 0.6]))[None, None] * fade * 0.8
save('k5camo_diff.jpg', cam * (1 - 0.3 * streak[..., None] * np.array([0.1, 0.3, 0.5])))
# ---- worn winter whitewash over Dunkelgrau
grey = lin(np.array([54, 56, 55]) / 255.0)
white = lin(np.array([214, 214, 206]) / 255.0)
wear = np.clip((fbm(140, 5, 31) - 0.6) * 6, 0, 1)                                     # worn through to the grey
brush = np.clip(fbm(40, 3, 41) * 1.0, 0, 1)
st = np.clip((np.tile(fbm(25, 2, 61)[:1, :], (N, 1)) * (0.6 + 0.8 * fbm(300, 2, 62)) - 0.5) * 3, 0, 1)   # vertical streaks
ww = white[None, None] * (0.88 + 0.14 * brush[..., None])
ww = ww * (1 - wear[..., None]) + grey[None, None] * wear[..., None] * 1.15
ww = ww * (1 - 0.35 * st[..., None] * np.array([0.8, 0.85, 0.95]))
ww = ww * shade[..., None]
save('k5ww_diff.jpg', ww)
for f in ('rivet_diff', 'k5camo_diff', 'k5ww_diff'):
    a = np.asarray(Image.open(os.path.join(OUT, f + '.jpg'))).astype(np.float32) / 255
    print(f, ((a ** 2.2).reshape(-1, 3).mean(0)).round(3))
