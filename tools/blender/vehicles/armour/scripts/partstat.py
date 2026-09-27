import bpy, collections, sys
c = collections.Counter(); n = collections.Counter()
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name.startswith('__') or o.hide_viewport: continue
    me = o.data; me.calc_loop_triangles()
    k = o.name.split('.')[0]
    c[k] += len(me.loop_triangles); n[k] += 1
print('PARTSTAT', sum(c.values()), [(k, v, n[k]) for k, v in c.most_common(40)])
