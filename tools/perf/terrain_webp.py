#!/usr/bin/env python3
"""Recompress the terrain layer strips to WebP (art integration 2, step 4 — asset size).

  python3 tools/perf/terrain_webp.py [--keep]     # from assets/terrain/*.jpg|png, deletes the sources unless --keep

Layer arrays are vertical strips of square tiles (1024 x 8192 = 8 layers). WebP is limited to 16383 px per side, so
the 2K strips (2048 x 16384) are stored as a 2-column grid (4096 x 8192); the runtime (src/art/terrain/layer-image.js)
reads any row-major grid given the tile size. `_512` strips (preset 'low') are downscaled from the 1K ones (Lanczos).
Qualities were picked by image diff (in-game A/B at the default camera stays at the noise floor of two identical runs).
"""
import os, sys
from PIL import Image

D = os.path.join(os.path.dirname(__file__), '../../assets/terrain')
Q = {'albedo': 88, 'normal': 86, 'data': 90}
Q2K = {'albedo': 86, 'normal': 84}

def grid(im, tile, cols):
    n = im.height // tile
    rows = (n + cols - 1) // cols
    out = Image.new(im.mode, (tile * cols, tile * rows))
    for i in range(n):
        out.paste(im.crop((0, i * tile, tile, (i + 1) * tile)), ((i % cols) * tile, (i // cols) * tile))
    return out

def save(im, name, q):
    p = os.path.join(D, name)
    im.save(p, 'WEBP', quality=q, method=6, exact=True, alpha_quality=100)
    print(f'{name:28s} {im.size} q{q} {os.path.getsize(p) / 1e6:.2f} MB')

def main(keep):
    done = []
    for th in ('temperate', 'desert', 'snow'):
        for kind in ('albedo', 'normal', 'data'):
            src = os.path.join(D, f'{th}_{kind}.jpg')
            if not os.path.exists(src): continue
            im = Image.open(src).convert('RGB')
            save(im, f'{th}_{kind}.webp', Q[kind])
            if kind != 'data':
                save(im.resize((512, im.height // 2), Image.LANCZOS), f'{th}_{kind}_512.webp', Q[kind])
            done.append(src)
            src2 = os.path.join(D, f'{th}_{kind}_2k.jpg')
            if os.path.exists(src2):
                save(grid(Image.open(src2).convert('RGB'), 2048, 2), f'{th}_{kind}_2k.webp', Q2K[kind])
                done.append(src2)
    for name, q in (('bark_albedo.jpg', 88), ('bark_normal.jpg', 86), ('foliage.png', 90)):
        src = os.path.join(D, name)
        if not os.path.exists(src): continue
        im = Image.open(src)
        save(im, name.rsplit('.', 1)[0] + '.webp', q)
        done.append(src)
    if not keep:
        for s in done: os.remove(s)

if __name__ == '__main__':
    main('--keep' in sys.argv)
