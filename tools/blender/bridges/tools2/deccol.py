import sys, numpy as np
sys.argv += ['', '']
exec(open('<claude-tmp>').read().split('pat = sys.argv')[0])
for m in J['meshes']:
    for p in m['primitives']:
        mat = J['materials'][p['material']]
        if 'decal' not in mat['name']: continue
        c = acc(p['attributes']['COLOR_0']) if 'COLOR_0' in p['attributes'] else None
        print(m.get('name'), mat['name'], mat.get('alphaMode'), 'COLOR_0', None if c is None else (c.shape, c.min(0).round(2), c.max(0).round(2)))
