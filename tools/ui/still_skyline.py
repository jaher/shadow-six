#!/usr/bin/env python3
"""Measure each front-end theatre still's skyline for STILL_SCENES `sky` (src/ui/menu-model.js): per pixel column the
first row (from the top) where the hazy sky ends — a colour step from the sky above, or a strong edge — then per 1/64
of the width the 35th percentile of those rows (thin lattice derricks, masts and wires mostly let the sky through), as
fractions of the height at 65 points. The desert's derricks are lattice: its horizon behind them is kept.
    python3 tools/ui/still_skyline.py [--sheet out.jpg]      (prints the arrays to paste)
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
N = 64


def skyline(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W = a.shape[:2]
    gy = np.abs(np.diff(a, axis=0)).sum(2)
    gx = np.zeros_like(gy)
    gx[:, 1:] = np.abs(np.diff(a[:-1], axis=1)).sum(2)
    ys = np.zeros(W, int)
    for x in range(W):
        col, y = a[:, x], 30
        while y < H - 1 and np.abs(col[y] - col[max(0, y - 12)]).sum() <= 22 and gy[y, x] <= 18 and gx[y, x] <= 18:
            y += 1
        ys[x] = y
    out = []
    for i in range(N + 1):
        x0, x1 = max(0, int((i - 0.5) * W / N)), min(W, int((i + 0.5) * W / N))
        out.append(float(np.percentile(ys[x0:x1], 35)) / H)
    return out


def main():
    sheet = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    tiles = []
    for th in ('temperate', 'snow', 'desert', 'coast'):
        path = os.path.join(ROOT, 'assets/ui/diorama/%s.webp' % th)
        s = skyline(path)
        if th == 'desert':
            s = [max(v, 0.30) if i / N > 0.42 and v < 0.29 else v for i, v in enumerate(s)]
        print('%s: sky: [%s]' % (th, ', '.join('%.3f' % v for v in s)))
        if sheet:
            im = Image.open(path).convert('RGB').crop((0, 0, 1920, 480)).resize((960, 240))
            ImageDraw.Draw(im).line([(i * 960 / N, v * 540) for i, v in enumerate(s)], fill=(0, 255, 255), width=2)
            tiles.append(im)
    if sheet:
        out = Image.new('RGB', (960, 240 * len(tiles)))
        for i, im in enumerate(tiles):
            out.paste(im, (0, 240 * i))
        out.save(sheet, quality=85)


if __name__ == '__main__':
    main()
