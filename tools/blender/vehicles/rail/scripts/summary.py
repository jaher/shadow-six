"""summary.py: asset table from out/*/*.kit.json (tris, sizes, LOD ratios, nodes, sockets) + budget checks."""
import json, glob, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
rows = []
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.kit.json'))):
    if '/smoke/' in f:
        continue
    m = json.load(open(f))
    v = m['vehicle']
    l = m['lods']
    t0 = l[0]['tris']
    ok = t0 <= (20000 if v['type'] in ('railgun',) else 15000) and all(x['bytes'] <= 2_000_000 for x in l)
    rows.append((m['asset'], t0, l[1]['tris'], l[2]['tris'], round(l[1]['tris'] / t0, 2), round(l[2]['tris'] / t0, 2),
                 round(l[0]['bytes'] / 1024), round(l[1]['bytes'] / 1024), round(l[2]['bytes'] / 1024),
                 len(v['moving']), len(v['sockets']), len(v['emitters']), len(v['contacts']), len(v['lights']), v['measured_m'], 'OK' if ok else 'OVER'))
print('asset | LOD0/1/2 tris | ratio1 ratio2 | KB 0/1/2 | moving sockets emitters contacts lights | measured | budget')
for r in rows:
    print('%s | %d/%d/%d | %.2f %.2f | %d/%d/%d | %d %d %d %d %d | %s | %s' % r)
