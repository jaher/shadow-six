#!/usr/bin/env python3
"""S15 briefing slides from public-domain period photographs (Imperial War Museums via Wikimedia Commons, PD-UKGov).
Each photo is cropped to the slide frame (378×433 r, portrait) and graded offline for its slot in BEL's four-slide
rhythm: 'archival' silver-gelatin B&W (S-curve, warm paper white, grain, dust, vignette), 'tinted' hand-coloured
print (sepia base + transparent colour washes), 'cold' foggy blue-grey. Sources and licences: CREDITS.md.
Usage: python3 tools/ui/build_briefing_photos.py <dir with the downloaded originals> [name,name...]   (needs Pillow + numpy)
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'ui', 'briefing')
W, H = 700, 800
# out name: (source file, grade, crop box as fractions x0 y0 x1 y1 — the Stuka crop leaves out the tail markings)
PHOTOS = {
    'norway-harbour': ('c1.jpg', 'archival', (0.0, 0.0, 0.62, 1.0)),   # Raid on the Lofoten Islands, 4 March 1941 N396
    'norway-landing': ('c3.jpg', 'archival', (0.1, 0.0, 0.9, 1.0)),    # Raid on Vaagso, 27 December 1941 N470
    'norway-vaagso': ('c4.jpg', 'cold', (0.1, 0.0, 0.9, 1.0)),         # Raid on Vaagso, 27 December 1941 N459
    'stuka': ('c6.jpg', 'tinted', (0.3, 0.2, 1.0, 1.0)),               # The British Army in North Africa 1941 E3900E
    'desert': ('c5.jpg', 'archival', (0.1, 0.0, 0.9, 1.0)),            # Ju 87 burning near Tobruk 1941
    'france-tank': ('c7.jpg', 'archival', (0.18, 0.0, 0.8, 1.0)),      # The British Army in France 1940 F4591
    'france-road': ('c8.jpg', 'cold', (0.3, 0.0, 0.92, 1.0)),          # The British Army in France 1940 F4863
    # Norway set for M1-M3 (art integration 2 polish: no North-Africa print in a Norway briefing)
    'norway-airfield': ('n1.jpg', 'tinted', (0.2, 0.0, 1.0, 1.0)),     # Herdla airfield bombing, Operation Archery (IWM C 2724)
    'norway-commandos': ('n2.jpg', 'archival', (0.08, 0.0, 0.84, 1.0)), # Commandos archery (IWM N 530)
    'norway-prisoners': ('n3.jpg', 'tinted', (0.0, 0.0, 0.9, 1.0)),    # Captured German troops norway (Vaagso)
    'lofoten-craft': ('n4.jpg', 'tinted', (0.04, 0.0, 0.7, 1.0)),      # Lofoten raid, 4 March 1941 A3321
    'norway-snow': ('n5.jpg', 'cold', (0.1, 0.0, 0.9, 1.0)),           # Raid on Vaagso, 27 December 1941 N456
}
rng = np.random.default_rng(1941)

def crop(im, box):
    w, h = im.size
    x0, y0, x1, y1 = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    # widen/narrow around the box centre to the frame aspect
    cx, cy, bw, bh = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    if bw / bh > W / H: bw = bh * W / H
    else: bh = bw * H / W
    return im.crop((int(cx - bw / 2), int(cy - bh / 2), int(cx + bw / 2), int(cy + bh / 2))).resize((W, H), Image.LANCZOS)

def grade(im, kind):
    g = np.asarray(im.convert('L')).astype(np.float32) / 255
    lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    g = np.clip((g - lo) / max(1e-3, hi - lo), 0, 1)
    yy, xx = np.mgrid[0:H, 0:W]
    vig = 1 - 0.42 * (((xx / W - .5) ** 2 + (yy / H - .5) ** 2) * 2.2) ** 1.4
    grain = rng.normal(0, 0.035, (H, W))
    dust = (rng.random((H, W)) < (0.00012 if kind == "archival" else 0.00004)).astype(np.float32)
    dust = np.asarray(Image.fromarray((dust * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))).astype(np.float32) / 255
    if kind == 'archival':
        g = g * g * (3 - 2 * g) * 0.9 + g * 0.1                     # S-curve
        g = np.clip(g * vig + grain, 0, 1)
        g = np.clip(g + dust * 0.55, 0, 1)
        rgb = np.stack([g * 0.97 + 0.02, g * 0.94 + 0.02, g * 0.86 + 0.015], -1)   # warm fibre-paper white
    elif kind == 'tinted':
        g = np.clip(g * 0.92 * vig + grain * 0.8, 0, 1)
        base = np.stack([g * 1.0, g * 0.88, g * 0.7], -1)             # sepia print
        sky = np.clip(1 - yy / (H * 0.55), 0, 1)[..., None] * np.array([0.55, 0.7, 0.85])
        ground = np.clip((yy / H - 0.5) * 2, 0, 1)[..., None] * np.array([0.78, 0.66, 0.42])
        wash = sky + ground + (1 - np.clip(sky.sum(-1, keepdims=True) + ground.sum(-1, keepdims=True), 0, 1)) * np.array([0.72, 0.7, 0.6])
        rgb = np.clip(base * (0.62 + 0.38 * wash) + dust[..., None] * 0.4, 0, 1)
    else:  # cold fog
        g = np.clip(g * 0.72 + 0.2, 0, 1)
        fog = np.clip(1 - yy / H, 0, 1) * 0.18
        g = np.clip(g * vig + fog + grain * 0.8, 0, 1)
        rgb = np.stack([g * 0.9, g * 0.96, g * 1.02], -1)
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))

os.makedirs(OUT, exist_ok=True)
ONLY = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None   # optional: rebuild just these names
for name, (f, kind, box) in PHOTOS.items():
    if ONLY and name not in ONLY: continue
    if not os.path.exists(os.path.join(SRC, f)):
        print('skip (no original)', name); continue
    im = crop(Image.open(os.path.join(SRC, f)).convert('RGB'), box)
    grade(im, kind).save(os.path.join(OUT, f'{name}.webp'), quality=76, method=6)
    print(name, kind)
