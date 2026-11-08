#!/usr/bin/env python3
"""Grade an engine render into a loading-card / backdrop still (tools/ui/bake_mission_stills.mjs).

The briefing's photo-print look (docs/menus-art-direction.md M4, S14; the archival prints in assets/ui/briefing):
crop to the output aspect, Lanczos-downsample the supersampled render, then a print grade: a gentle auto-level with a
lifted black and a cream paper white, part of the chroma taken out, a warm split tone (umber shadows, cream highlights),
a soft S-curve, a gentle vignette and a whisper of grain. Saved as WebP (method 6) under the byte budget.

Usage: grade_stills.py <raw.png> <out.webp> --size=WxH --kind=mission|backdrop [--grade='{"sat":0.6,...}']
grade keys: sat (chroma kept, 0..1), warm (split-tone strength), contrast (S-curve), exposure (stops), gamma,
vignette (corner darkening 0..1), black / white (print black / paper white), crop [cx, cy] (crop centre, 0..1),
zoom (crop tighter, >= 1), grain, soften (px of Gaussian blur after the downsample: a print's softness, and bytes),
sharpen (%), q (WebP quality: lowered in steps of 3 until the file fits `budget` KB), gain_max (auto-level bound).
Needs Pillow + numpy.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

def arg(k, d=None):
    for a in sys.argv[3:]:
        if a.startswith(f'--{k}='): return a[len(k) + 3:]
    return d

RAW, OUT = sys.argv[1], sys.argv[2]
W, H = (int(v) for v in arg('size', '1260x1000').split('x'))
KIND = arg('kind', 'mission')
G = {**json.loads(arg('grade', '{}') or '{}')}
P = {  # defaults (mission card); the backdrop goes under the menu's own olive grade, so it keeps a little more range
    'sat': 0.58, 'warm': 0.8, 'contrast': 0.45, 'exposure': 0.0, 'gamma': 1.08, 'vignette': 0.38, 'black': 0.04,
    'white': 0.955, 'crop': [0.5, 0.5], 'zoom': 1.0, 'grain': 0.008, 'q': 80, 'budget': 150 if KIND == 'mission' else 220,
    'gain_max': 1.35, 'soften': 0.5, 'sharpen': 0,
}
P.update(G)

im = Image.open(RAW).convert('RGB')
sw, sh = im.size
# crop to the output aspect around the crop centre (and `zoom` tighter), then downsample (the supersampling)
ar = W / H
cw, ch = (sw, sw / ar) if sw / sh < ar else (sh * ar, sh)
cw, ch = cw / P['zoom'], ch / P['zoom']
cx, cy = P['crop'][0] * sw, P['crop'][1] * sh
x0 = min(max(0, cx - cw / 2), sw - cw); y0 = min(max(0, cy - ch / 2), sh - ch)
im = im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))).resize((W, H), Image.LANCZOS)
# a print is soft: the supersampled render's finest texture (gravel, sand ripples, grass) only costs bytes at the card's
# size, so it is eased (`soften`, px) — or crisped (`sharpen`, %) when a shot wants it
if P['soften'] > 0: im = im.filter(ImageFilter.GaussianBlur(P['soften']))
if P['sharpen'] > 0: im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=P['sharpen'], threshold=2))

a = np.asarray(im).astype(np.float32) / 255.0
Y = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# gentle auto-level: the darkest / brightest few tenths of a percent to the print's black and paper white; the gain is
# bounded, so a dusk or snow scene keeps its key
lo, hi = np.percentile(Y, 0.4), np.percentile(Y, 99.6)
gain = min(P['gain_max'], 1.0 / max(1e-3, hi - lo))
a = (a - lo) * gain * (2.0 ** P['exposure'])
a = np.clip(a, 0, 1) ** P['gamma']
Y = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# chroma: keep `sat` of it (a muted, hand-tinted print rather than a colour photo)
a = Y[..., None] + (a - Y[..., None]) * P['sat']
# soft S-curve on the luminance (chroma rides along)
c = P['contrast']
Ys = np.clip(Y, 0, 1)
Yc = Ys + c * (Ys * Ys * (3 - 2 * Ys) - Ys)
a = a + (Yc - Y)[..., None]
# warm split tone: umber in the shadows, cream in the highlights (the archival prints' fibre paper)
w = P['warm']
t = np.clip(Yc, 0, 1)[..., None]
shadow = np.array([1.06, 0.98, 0.86], np.float32); high = np.array([1.03, 1.0, 0.93], np.float32)
tint = shadow * (1 - t) + high * t
a = a * (1 + (tint - 1) * w)
# print range: lifted black, cream paper white
black = np.array([P['black'] * 1.08, P['black'] * 1.0, P['black'] * 0.86], np.float32)
white = np.array([P['white'], P['white'] * 0.985, P['white'] * 0.94], np.float32)
a = black + np.clip(a, 0, 1) * (white - black)
# gentle vignette (elliptical, smooth), then a whisper of luminance grain
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r2 = ((xx / W - 0.5) * 2) ** 2 * 0.85 + ((yy / H - 0.5) * 2) ** 2
v = 1 - P['vignette'] * np.clip(r2 / 2, 0, 1) ** 1.6
a = a * v[..., None]
if P['grain'] > 0:
    rng = np.random.default_rng(1941)
    a = a + rng.normal(0, P['grain'], (H, W, 1)).astype(np.float32)
img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))

os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
q = int(P['q'])
while True:
    img.save(OUT, quality=q, method=6)
    kb = os.path.getsize(OUT) / 1024
    if kb <= P['budget'] or q <= 64: break
    q -= 3
print(f'{os.path.basename(OUT)} {W}x{H} q{q} {kb:.0f} KB ({KIND})')
