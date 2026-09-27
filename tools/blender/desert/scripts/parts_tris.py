# blender -b file.blend --python parts_tris.py : top parts by tris
import bpy
from collections import Counter
c = Counter()
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.name.endswith(('_lod1', '_lod2')) and 'lod' not in o.name:
        c[o.name] = sum(len(p.vertices) - 2 for p in o.data.polygons)
for k, v in c.most_common(25):
    print('PT', v, k)
