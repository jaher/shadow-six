import bpy, sys, re
from collections import Counter
mat = sys.argv[sys.argv.index('--') + 1]
c = Counter()
for o in bpy.data.objects:
    if o.type == 'MESH' and 'lod' not in o.name and o.name != 'main' and o.data.materials and o.data.materials[0] and o.data.materials[0].name.startswith('kit:' + mat):
        c[re.sub(r'[-\d_.]+$', '', o.name)] += sum(len(p.vertices) - 2 for p in o.data.polygons)
for k, v in c.most_common(20):
    print('PM', v, k)
