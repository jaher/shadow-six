#!/usr/bin/env python3
"""Compare tools/perf/memshot.mjs before/after pairs: per pair the mean / 99th-percentile / max per-pixel difference
(0-255, max over RGB) and the share of pixels differing by more than 8, plus a side-by-side sheet
(before | after | difference ×4) per pair.

  python3 tools/perf/memshot-diff.py [dir]   (default <projects>/commandos-shots/memory/shots)
"""
import os, sys, glob
from PIL import Image, ImageChops
import numpy as np

d = sys.argv[1] if len(sys.argv) > 1 else '<projects>/commandos-shots/memory/shots'
rows = []
for b in sorted(glob.glob(os.path.join(d, '*-before.png'))):
    a = b.replace('-before.png', '-after.png')
    if not os.path.exists(a):
        continue
    A = np.asarray(Image.open(b).convert('RGB')).astype(np.int16)
    B = np.asarray(Image.open(a).convert('RGB')).astype(np.int16)
    diff = np.abs(A - B).max(axis=2)
    rows.append((os.path.basename(b)[:-11], diff.mean(), np.percentile(diff, 99), diff.max(), (diff > 8).mean() * 100))
    w, h = A.shape[1], A.shape[0]
    sheet = Image.new('RGB', (w * 3 // 2, h // 2))
    sheet.paste(Image.open(b).convert('RGB').resize((w // 2, h // 2)), (0, 0))
    sheet.paste(Image.open(a).convert('RGB').resize((w // 2, h // 2)), (w // 2, 0))
    dimg = Image.fromarray(np.clip(diff * 4, 0, 255).astype(np.uint8)).convert('RGB').resize((w // 2, h // 2))
    sheet.paste(dimg, (w, 0))
    sheet.save(os.path.join(d, os.path.basename(b)[:-11] + '-sheet.jpg'), quality=85)
print(f"{'view':44} {'mean':>6} {'p99':>5} {'max':>4} {'>8 %':>6}")
for r in rows:
    print(f'{r[0]:44} {r[1]:6.2f} {r[2]:5.0f} {r[3]:4.0f} {r[4]:6.2f}')
