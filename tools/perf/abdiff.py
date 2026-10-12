#!/usr/bin/env python3
"""A/B frame comparison against the noise floor: for every view shot as <view>-before.png, <view>-after.png and
<view>-before2.png (a second run of the same checkout as 'before': animation phase, particles, water), print the
per-pixel difference (0-255, max over RGB) of before→after next to before→before2, and write a sheet per view:
before | after | |after−before| ×8 | |before2−before| ×8 (the last two on the same scale). 'static pixels': the
A/B difference over the pixels that differ by ≤ 2 between the two runs of 'before' (animation excluded).

  python3 tools/perf/abdiff.py <dir> [--a=before --b=after --n=before2] [--sheets]
"""
import os, sys, glob
from PIL import Image
import numpy as np

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: (a.split('=', 1)[1] if '=' in a else True) for a in sys.argv[1:] if a.startswith('--')}
d = args[0] if args else '.'
A, B, N = opt.get('a', 'before'), opt.get('b', 'after'), opt.get('n', 'before2')


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16)


def stats(x, y):
    diff = np.abs(x - y).max(axis=2)
    return diff, (diff.mean(), np.percentile(diff, 99), np.percentile(diff, 99.9), diff.max(), (diff > 8).mean() * 100)


rows = []
for fa in sorted(glob.glob(os.path.join(d, f'*-{A}.png'))):
    view = os.path.basename(fa)[: -len(f'-{A}.png')]
    fb, fn = fa.replace(f'-{A}.png', f'-{B}.png'), fa.replace(f'-{A}.png', f'-{N}.png')
    if not os.path.exists(fb):
        continue
    xa, xb = load(fa), load(fb)
    dab, sab = stats(xa, xb)
    dn, sn, sm = (None, None, None)
    if os.path.exists(fn):
        dn, sn = stats(xa, load(fn))
        # pixels that do not move between two runs of the same checkout (no water / particle / snow animation)
        m = dn <= 2
        v = dab[m]
        sm = (v.mean(), np.percentile(v, 99), np.percentile(v, 99.9), v.max(), (v > 8).mean() * 100, m.mean() * 100)
    rows.append((view, sab, sn, sm))
    if opt.get('sheets'):
        h, w = xa.shape[:2]
        k = 2
        sheet = Image.new('RGB', (w * 2 // k, h * 2 // k))
        sheet.paste(Image.open(fa).convert('RGB').resize((w // k, h // k)), (0, 0))
        sheet.paste(Image.open(fb).convert('RGB').resize((w // k, h // k)), (w // k, 0))
        amp = lambda x: Image.fromarray(np.clip(x * 8, 0, 255).astype(np.uint8)).convert('RGB').resize((w // k, h // k))
        sheet.paste(amp(dab), (0, h // k))
        if dn is not None:
            sheet.paste(amp(dn), (w // k, h // k))
        sheet.save(os.path.join(d, f'{view}-sheet.jpg'), quality=88)

f = lambda s: '—' if s is None else f'{s[0]:.2f} / {s[1]:.0f} / {s[2]:.0f} / {s[3]:.0f} / {s[4]:.2f}%'
g = lambda s: '—' if s is None else f'{s[0]:.2f} / {s[1]:.0f} / {s[2]:.0f} / {s[3]:.0f} / {s[4]:.2f}% ({s[5]:.0f}% of px)'
print(f'| view | {A}→{B}: mean / p99 / p99.9 / max / >8 | {A}→{N} (noise): mean / p99 / p99.9 / max / >8 | {A}→{B} on static pixels |')
print('|---|---|---|---|')
for v, sab, sn, sm in rows:
    print(f'| {v} | {f(sab)} | {f(sn)} | {g(sm)} |')
