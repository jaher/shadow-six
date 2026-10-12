#!/usr/bin/env python3
"""Before/after GPU memory by category from tools/perf/measure-memory.mjs runs (perf/gpu-memory).

  python3 tools/perf/gpumem-table.py <dir> [--before=before] [--after=after] [--md=out.md]

Per config and mission: GPU total and its parts — material textures (every scene texture uploaded), render targets
(RT textures + renderbuffers: post chain, shadow map, trails, impostors…), buffers (geometry) — then the renderer
process PSS (page memory), download, load time and frame time (zoom 1, median wall ms), before → after; sums at the end.
"""
import json, os, sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
d = args[0] if args else '.'
B, A = opt.get('before', 'before'), opt.get('after', 'after')
M = 1048576


def load(label, cfg):
    p = os.path.join(d, f'{label}-{cfg}.json')
    if not os.path.exists(p):
        return {}
    j = json.load(open(p))
    out = {}
    for r in j['rows']:
        det = j['details'].get(r['id'], {})
        rt = sum(b['bytes'] for b in det.get('buckets', []) if b['k'] in ('tex rt', 'rb rt'))
        unattributed = sum(b['bytes'] for b in det.get('buckets', []) if b['k'] == 'tex (unattributed)')  # shadow map
        r['rt'] = rt + unattributed
        r['mat'] = r['gpuTex'] - (rt - sum(b['bytes'] for b in det.get('buckets', []) if b['k'] == 'rb rt')) - unattributed
        r['net'] = ((det.get('lastLoad') or {}).get('bytes'))
        out[r['id']] = r
    return out


def f(a, b, unit=M, nd=0, pc=True):
    if a is None or b is None:
        return '—'
    s = f'{a / unit:.{nd}f} → {b / unit:.{nd}f}'
    if pc and a:
        s += f' ({(b - a) / a * 100:+.0f}%)'
    return s


lines = []
for cfg in ('desktop-high', 'desktop-medium', 'phone-medium'):
    before, after = load(B, cfg), load(A, cfg)
    if not before:
        continue
    lines += [f'\n### {cfg}\n', '| mission | GPU total MB | material textures MB | render targets MB | buffers MB | renderer PSS MB | download MB | load s | frame ms |', '|---|---|---|---|---|---|---|---|---|']
    tot = {k: [0, 0] for k in ('gpu', 'mat', 'rt', 'gpuBuf', 'rendererPss')}
    for mid in sorted(before):
        b, a = before[mid], after.get(mid)
        if not a:
            continue
        for k in tot:
            tot[k][0] += b.get(k) or 0
            tot[k][1] += a.get(k) or 0
        lines.append(f"| {mid} | {f(b['gpu'], a['gpu'])} | {f(b['mat'], a['mat'])} | {f(b['rt'], a['rt'])} | {f(b['gpuBuf'], a['gpuBuf'], pc=False)} | {f(b.get('rendererPss'), a.get('rendererPss'))} | {f(b.get('net') or b.get('download'), a.get('net') or a.get('download'), 1e6, 1, False)} | {f(b.get('loadMs'), a.get('loadMs'), 1000, 1, False)} | {f(b.get('frame'), a.get('frame'), 1, 1, False)} |")
    lines.append(f"| **sum** | {f(*tot['gpu'])} | {f(*tot['mat'])} | {f(*tot['rt'])} | {f(*tot['gpuBuf'], pc=False)} | {f(*tot['rendererPss'])} | | | |")
print('\n'.join(lines))
if opt.get('md'):
    open(opt['md'], 'w').write('\n'.join(lines) + '\n')
