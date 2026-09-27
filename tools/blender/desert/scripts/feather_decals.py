"""Feather the shared decal atlas: every non-poster cell gets alpha -> min(alpha, edge ramp) so no decal quad can show a
hard rectangular edge (stain_blotch/moss/soot/dirt_splash/damp_base had alpha 100-230 at their cell borders).
Idempotent (min with a fixed ramp). Also backs up the originals once."""
import json, os, shutil
import numpy as np
from PIL import Image
KIT = '<claude-tmp>'
cells = json.load(open(KIT + '/lib/decals.json'))['decals']
for res in ('1k', '2k'):
    p = f'{KIT}/lib/{res}/decals_rgba.png'
    if not os.path.exists(p):
        continue
    bak = '<claude-tmp>' % res
    if not os.path.exists(bak):
        shutil.copy(p, bak)
    im = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    H, W = im.shape[:2]
    for k, (u0, v0, u1, v1) in cells.items():
        if k.startswith('poster'):
            continue
        x0, x1 = int(round(u0 * W)), int(round(u1 * W))
        y0, y1 = int(round((1 - v1) * H)), int(round((1 - v0) * H))
        w, h = x1 - x0, y1 - y0
        fx = np.minimum(np.arange(w) + 0.5, w - np.arange(w) - 0.5) / (0.14 * w)
        fy = np.minimum(np.arange(h) + 0.5, h - np.arange(h) - 0.5) / (0.14 * h)
        s = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))
        ramp = (s(fy)[:, None] * s(fx)[None, :]) * 255.0
        im[y0:y1, x0:x1, 3] = np.minimum(im[y0:y1, x0:x1, 3], ramp)
    out = Image.fromarray(np.clip(im + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    out.save(p, optimize=True)
    out.save(p.replace('.png', '.webp'), quality=90, method=5)
    print('feathered', p)
