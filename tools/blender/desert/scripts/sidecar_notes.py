"""Write rework notes + format requirements into every desert sidecar (<name>.kit.json)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from changes import CHANGES, COMMON
D = '<claude-tmp>'
for n, txt in CHANGES.items():
    p = f'{D}/{n}/{n}.kit.json'
    if not os.path.exists(p):
        print('missing', n); continue
    s = json.load(open(p))
    s['revision'] = 'desert rework 1 (2026-09-26)'
    s['rework'] = {'asset': txt, 'common': COMMON}
    s['gltf_extensions_required'] = ['KHR_mesh_quantization']
    if n.startswith('barracks'):
        s.setdefault('notes', []).append("node 'flag' is a static stand-in (field-grey banner + Balkenkreuz); hide it when the animated cloth is spawned at anchor 'flag'")
        s['notes'] = list(dict.fromkeys(s['notes']))
    if n == 'mosque_tunis':
        s['notes'] = [x for x in s.get('notes', []) if 'minaret_socket' not in x]
        s.setdefault('notes', []).append('complete landmark in one file (prayer hall + courtyard + minaret); minaret_tunis is also shipped standalone for other maps')
        s['notes'] = list(dict.fromkeys(s['notes']))
    for l in s.get('lods', []):
        l['bytes'] = os.path.getsize(f'{D}/{n}/{l["file"]}')
    json.dump(s, open(p, 'w'), indent=1)
    print('ok', n, [(l['tris'], round(l['bytes'] / 1e6, 2)) for l in s['lods']])
