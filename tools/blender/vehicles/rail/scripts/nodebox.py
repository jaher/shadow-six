# nodebox.py file.glb [node-substr...] -> world AABB per node (translation-only hierarchy, as exported by the kit) + total
import json, struct, sys
b = open(sys.argv[1], 'rb').read()
js = json.loads(b[20:20 + struct.unpack('<I', b[12:16])[0]])
nodes = js['nodes']
par = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
def off(i):
    t = [0, 0, 0]
    while i is not None:
        tr = nodes[i].get('translation', [0, 0, 0])
        t = [t[k] + tr[k] for k in range(3)]
        i = par.get(i)
    return t
tot = [[1e9] * 3, [-1e9] * 3]
for i, n in enumerate(nodes):
    if 'mesh' not in n:
        continue
    o = off(i)
    lo, hi = [1e9] * 3, [-1e9] * 3
    for p in js['meshes'][n['mesh']]['primitives']:
        a = js['accessors'][p['attributes']['POSITION']]
        lo = [min(lo[k], a['min'][k] + o[k]) for k in range(3)]; hi = [max(hi[k], a['max'][k] + o[k]) for k in range(3)]
    tot = [[min(tot[0][k], lo[k]) for k in range(3)], [max(tot[1][k], hi[k]) for k in range(3)]]
    if len(sys.argv) < 3 or any(s in n.get('name', '') for s in sys.argv[2:]):
        print('%-26s x %6.2f..%6.2f  y %6.2f..%6.2f  z %6.2f..%6.2f' % (n.get('name', '?')[:26], lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
print('TOTAL x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f' % (tot[0][0], tot[1][0], tot[0][1], tot[1][1], tot[0][2], tot[1][2]))
