import bpy, collections
c = collections.Counter(); v = collections.Counter()
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    me = o.data; me.calc_loop_triangles()
    k = o.name.split('.')[0]
    c[k] += len(me.loop_triangles); v[k] += len(me.loops)
print('TOTAL', sum(c.values()))
for k, n in c.most_common(45): print('%-28s %6d tris %6d loops' % (k, n, v[k]))
