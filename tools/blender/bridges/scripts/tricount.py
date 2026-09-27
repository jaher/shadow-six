import bpy, sys, re, collections
# counts triangles per part (name stem) in the saved .blend (parts are still in the file)
c = collections.Counter()
for o in bpy.data.objects:
    if o.type != 'MESH' or not o.get('kit_node'):
        continue
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    c[re.sub(r'[\d_.]+$', '', o.name)] += t
for k, v in c.most_common(25):
    print('TRI', k, v)
