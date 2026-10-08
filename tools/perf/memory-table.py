#!/usr/bin/env python3
"""Before/after table from tools/perf/measure-memory.mjs runs.

  python3 tools/perf/memory-table.py [dir] [--before=before] [--after=after]

Per config and mission: GPU (all live GL objects after every scene texture is uploaded), renderer process PSS, the
page's decoded images (ImageBitmaps) and ArrayBuffers, decoded audio, GPU-process VRAM, load peak of the renderer PSS,
download, load time and frame time (zoom 1), before → after.
"""
import json, os, sys

d = next((a for a in sys.argv[1:] if not a.startswith('--')), '<projects>/commandos-shots/memory')
opt = {a.split('=')[0][2:]: a.split('=')[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
B, A = opt.get('before', 'before'), opt.get('after', 'after')
MB = lambda b: '—' if b is None else f'{b / 1048576:.0f}'


def load(label, cfg):
    p = os.path.join(d, f'{label}-{cfg}.json')
    if not os.path.exists(p):
        return {}
    j = json.load(open(p))
    rows = {r['id']: r for r in j['rows']}
    for mid, r in rows.items():  # network bytes loadMission saw (Resource Timing; blob: / data: loads excluded)
        r['net'] = ((j.get('details', {}).get(mid) or {}).get('lastLoad') or {}).get('bytes')
    return rows


def pct(a, b):
    return '' if not a or b is None else f' ({(b - a) / a * 100:+.0f}%)'


for cfg in ('desktop-high', 'desktop-medium', 'phone-medium'):
    before, after = load(B, cfg), load(A, cfg)
    if not before:
        continue
    print(f'\n### {cfg}\n')
    print('| mission | GPU MB | renderer PSS MB | bitmaps MB | ArrayBuffers MB | audio MB | VRAM MB | load peak PSS MB | download MB (loadMission) | load s | frame ms |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    tot = {k: [0, 0] for k in ('gpu', 'rendererPss')}
    for mid in sorted(before):
        b, a = before[mid], after.get(mid, {})
        def cell(k, f=MB):
            if not a:
                return f(b.get(k))
            return f'{f(b.get(k))} → {f(a.get(k))}'
        peak = lambda r: (r.get('peak') or {}).get('rendererPss')
        row = [mid, cell('gpu') + (pct(b.get('gpu'), a.get('gpu')) if a else ''), cell('rendererPss') + (pct(b.get('rendererPss'), a.get('rendererPss')) if a else ''),
               cell('bitmaps'), cell('backing'), cell('audio'), cell('vram'),
               f'{MB(peak(b))} → {MB(peak(a))}' if a else MB(peak(b)),
               cell('net', lambda x: '—' if x is None else f'{x / 1e6:.0f}'), cell('loadMs', lambda x: '—' if x is None else f'{x / 1000:.1f}'),
               cell('frame', lambda x: '—' if x is None else f'{x:.1f}')]
        print('| ' + ' | '.join(row) + ' |')
        for k in tot:
            tot[k][0] += b.get(k) or 0
            tot[k][1] += a.get(k) or 0
    if after:
        print(f"\nsum over missions: GPU {MB(tot['gpu'][0])} → {MB(tot['gpu'][1])} MB{pct(tot['gpu'][0], tot['gpu'][1])}, "
              f"renderer PSS {MB(tot['rendererPss'][0])} → {MB(tot['rendererPss'][1])} MB{pct(tot['rendererPss'][0], tot['rendererPss'][1])}")
