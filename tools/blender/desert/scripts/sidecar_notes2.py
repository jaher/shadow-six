"""Stamp round-2 rework notes into every desert sidecar (keeps the round-1 notes from changes.py)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from changes import CHANGES, COMMON
from changes2 import CHANGES2, COMMON2
D = '<claude-tmp>'
for n, txt in CHANGES2.items():
    p = f'{D}/{n}/{n}.kit.json'
    if not os.path.exists(p):
        print('missing', n); continue
    s = json.load(open(p))
    s['revision'] = 'desert rework 2 (2026-09-26)'
    s['rework'] = {'asset': CHANGES.get(n, ''), 'common': COMMON}
    s['rework2'] = {'asset': txt, 'common': COMMON2}
    s['gltf_extensions_required'] = ['KHR_mesh_quantization']
    if n.startswith('barracks'):
        s.setdefault('notes', []).append("node 'flag' is a static stand-in (field-grey banner + Balkenkreuz); hide it when the animated cloth is spawned at anchor 'flag'")
    if n == 'mosque_tunis':
        s['notes'] = [x for x in s.get('notes', []) if 'minaret_socket' not in x]
        s.setdefault('notes', []).append('complete landmark in one file (prayer hall + courtyard + minaret); minaret_tunis is also shipped standalone for other maps')
    s['notes'] = list(dict.fromkeys(s.get('notes', [])))
    for l in s.get('lods', []):
        l['bytes'] = os.path.getsize(f'{D}/{n}/{l["file"]}')
    json.dump(s, open(p, 'w'), indent=1)
    print('ok', n, [(l['tris'], round(l['bytes'] / 1e6, 2)) for l in s['lods']])
