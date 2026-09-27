import json, glob, os
rows = []
for d in sorted(glob.glob('out/*/')):
    n = os.path.basename(d.rstrip('/'))
    sc = os.path.join(d, n + '.kit.json')
    if not os.path.exists(sc): continue
    m = json.load(open(sc))
    l = m.get('lods', [])
    rows.append((n, [x['tris'] for x in l], round(l[0]['bytes'] / 1e6, 2) if l else 0, len(m.get('doors', [])), len(m.get('footprints', [])),
                 len(m.get('roofs', [])), len(m.get('climb', [])), len(m.get('ladders', [])), m.get('height')))
for r in rows: print('%-28s tris=%-22s %5.2fMB doors=%d fp=%d roofs=%d climb=%d ladders=%d h=%s' % r)
