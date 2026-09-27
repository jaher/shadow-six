"""List top parts by triangle count from the .blend-free GLB (mesh name -> tris)."""
import sys, json, struct
from collections import Counter
def read(p):
    b = open(p, 'rb').read()
    L = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + L])
js = read(sys.argv[1])
cnt = Counter()
for m in js['meshes']:
    for pr in m['primitives']:
        a = js['accessors'][pr['indices']]
        mat = js['materials'][pr.get('material', 0)]['name'] if 'material' in pr else '?'
        cnt[m['name'] + ' | ' + mat] += a['count'] // 3
tot = sum(cnt.values())
print('total', tot)
for k, v in cnt.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 20):
    print(v, k)
