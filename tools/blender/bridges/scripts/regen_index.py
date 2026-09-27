"""Rebuild out/index.json from every out/<name>/<name>.kit.json sidecar."""
import json, os
OUT = '<claude-tmp>'
old = {e['name']: e for e in json.load(open(os.path.join(OUT, 'index.json')))}
idx = []
for n in sorted(os.listdir(OUT)):
    sc = os.path.join(OUT, n, n + '.kit.json')
    if not os.path.isfile(sc):
        continue
    m = json.load(open(sc))
    br = m.get('bridge') or {}
    e = {'name': n, 'glb': '%s/%s.glb' % (n, n), 'lods': m.get('lods'), 'nodes': m.get('nodes'), 'kind': br.get('kind'),
         'destroyed': bool(br.get('destroyed')), 'snow': n.endswith('_snow'), 'water_obstacles': len(m.get('water_obstacles', [])),
         'anim': list((m.get('anim') or {}).keys()), 'theater': old.get(n, {}).get('theater', 'temperate')}
    if 'rework' in m:
        e['rework'] = m['rework']
    idx.append(e)
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print(len(idx), 'assets')
