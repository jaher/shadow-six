#!/usr/bin/env python3
"""Menu material library (docs/menus-art-direction.md §1.4.2) → assets/ui/tex/*.webp (@1x 512 px, @2x 1024 px).
Sources are CC0 ambientCG materials (IDs and dates in CREDITS.md), recoloured here, plus our own procedural layers
(tileable Worley camo mask + speckle for M1, foxing/stain layer for M3, film grain for M4).
Usage: python3 tools/ui/build_textures.py <dir with the unzipped ambientCG 1K-JPG sets>   (needs Pillow + numpy)
Download: https://ambientcg.com/get?file=<ID>_1K-JPG.zip for Fabric031 Fabric019 Paper003 Metal009 Leather037 Wood049.
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter


def speckle(path='assets/ui/tex/speck-512.png', size=512, coverage=0.003, seed=7):
    """A6 pin-prick highlights: sparse random dots (0.3 % coverage), #6f7a4a / #9aa86a, soft 1-2 px, tileable."""
    import random
    from PIL import Image, ImageDraw
    rnd = random.Random(seed)
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = int(size * size * coverage / 2.2)
    for _ in range(n):
        x, y = rnd.uniform(0, size), rnd.uniform(0, size)
        r = rnd.choice([0.6, 0.8, 1.0, 1.3])
        c = rnd.choice([(0x6f, 0x7a, 0x4a), (0x6f, 0x7a, 0x4a), (0x7a, 0x86, 0x52)])
        a = int(rnd.uniform(0.5, 0.7) * 255)  # A6: #6f7a4a at ~60 %
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                d.ellipse((x + ox - r, y + oy - r, x + ox + r, y + oy + r), fill=c + (a,))
    im.save(path, optimize=True)
    return path



if 'speckle' in sys.argv:  # python tools/ui/build_textures.py speckle
    print(speckle())
    sys.exit(0)

SRC = sys.argv[1]  # python3 tools/ui/build_textures.py <src> [camo]  (camo: rebuild M1 only)
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'ui', 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1941)

def load(id_):
    im = Image.open(os.path.join(SRC, id_, f'{id_}_1K-JPG_Color.jpg')).convert('RGB').resize((1024, 1024), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0

def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722

def norm(x, lo=2, hi=98):
    a, b = np.percentile(x, lo), np.percentile(x, hi)
    return np.clip((x - a) / max(1e-6, b - a), 0, 1)

def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)

def ramp(t, stops):
    """t (H×W, 0..1) → RGB through [(pos, '#hex'), ...]."""
    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(1e-6, p1 - p0))[..., None]
        out[m] = (hexc(c0) * (1 - k) + hexc(c1) * k)[m]
    return out

def worley(n=1024, cells=6, seed=0):
    """Tileable F1 Worley noise (wrap-around distances)."""
    r = np.random.default_rng(seed)
    pts = r.random((cells, cells, 2))
    yy, xx = np.mgrid[0:n, 0:n] / n * cells
    d = np.full((n, n), 9.0, np.float32)
    for oy in range(-1, cells + 1):
        for ox in range(-1, cells + 1):
            p = pts[oy % cells, ox % cells]
            px, py = ox + p[0], oy + p[1]
            d = np.minimum(d, np.hypot(xx - px, yy - py))
    return d

def save(name, arr):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    im.save(os.path.join(OUT, f'{name}@2x.webp'), quality=80, method=6)
    im.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'{name}@1x.webp'), quality=80, method=6)
    print(name)

# M1 wool-olive (review fix: BEL's blanket reads moss green, #252412 average, ~15 % chroma): wool weave luminance
# → moss ramp olive-950 … #56603a, 3-octave Worley camo mottles with crisp edges, pale-green pin-pricks (A6)
w = norm(lum(load('Fabric031')))
camo = sum(norm(-worley(1024, c, s)) * a for c, s, a in ((4, 1, .55), (8, 2, .3), (16, 3, .15)))
camo = norm(camo)
t = np.clip(0.42 * w + 0.58 * np.where(camo > 0.64, 0.86, np.where(camo > 0.42, 0.52, 0.2)), 0, 1)
m1 = ramp(t, [(0, '#0d0e07'), (0.28, '#17180b'), (0.5, '#222410'), (0.72, '#30351a'), (0.88, '#3d4423'), (1, '#4b5430')])
spk = rng.random((1024, 1024)) < 0.003
m1[spk] = m1[spk] * 0.4 + hexc('#6f7a4a') * 0.6
save('wool-olive', m1)
if 'camo' in sys.argv:
    sys.exit(0)

# M2 canvas webbing (khaki cotton), recoloured Fabric019
m2 = ramp(norm(lum(load('Fabric019'))), [(0, '#3d3822'), (0.5, '#6d6441'), (1, '#8c8055')])
save('webbing', m2)

# M3 aged paper: Paper003 fibres + foxing/stain layer (low-frequency Worley blotches)
p = norm(lum(load('Paper003')), 1, 99)
stain = norm(-worley(1024, 5, 7)) * 0.6 + norm(-worley(1024, 11, 8)) * 0.4
fox = (rng.random((1024, 1024)) < 0.0006).astype(np.float32)
fox = np.asarray(Image.fromarray((fox * 255).astype(np.uint8)).resize((256, 256), Image.BILINEAR).resize((1024, 1024), Image.BICUBIC)).astype(np.float32) / 255
# review fix: less 'clouds', more paper — the Paper003 mottling is flattened, fine fibres and pin-point foxing added
fib = np.asarray(Image.fromarray((rng.random((1024, 1024)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)).resize((1024, 256)).resize((1024, 1024), Image.BICUBIC)).astype(np.float32) / 255
paper = ramp(np.clip(0.7 + 0.2 * p + 0.1 * (fib - 0.5) - 0.07 * np.clip(stain - 0.6, 0, 1) - 1.6 * fox, 0, 1), [(0, '#8f7f58'), (0.5, '#cdbf98'), (1, '#e9e0c4')])
save('paper-aged', paper)
# notebook paper (S17): olive stock with the #9da375 / #7d8155 blotches over a lightened #b3b68a base (§1.2)
nb = ramp(np.clip(0.6 + 0.4 * p - 0.35 * np.clip(stain - 0.5, 0, 1), 0, 1), [(0, '#7d8155'), (0.45, '#9da375'), (0.75, '#b3b68a'), (1, '#c3c69c')])
save('paper-note', nb)

# M5 brushed steel mask (greyscale, CSS applies the gradient)
st = norm(lum(load('Metal009')))
save('brushed-steel-mask', np.repeat(st[..., None], 3, 2))

# M7 leather, M8 oak
save('leather', ramp(norm(lum(load('Leather037'))), [(0, '#140c07'), (0.6, '#2c1a10'), (1, '#4a2e1c')]))
save('oak', ramp(norm(lum(load('Wood049'))), [(0, '#1b1209'), (0.5, '#3a2616'), (1, '#6a4a2c')]))

# M4 film grain (256 px, tiling, neutral grey around 0.5)
g = rng.normal(0.5, 0.16, (256, 256)).clip(0, 1)
Image.fromarray((g * 255).astype(np.uint8), 'L').save(os.path.join(OUT, 'grain-256.png'), optimize=True)
print('grain-256')

