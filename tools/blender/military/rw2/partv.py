import bpy, collections
c = collections.Counter()
for o in bpy.data.objects:
    if o.type == 'MESH':
        me = o.data; me.calc_loop_triangles() if hasattr(me,'calc_loop_triangles') else None
        key = o.name.split('.')[0].rstrip('0123456789_')
        c[key] += len(me.loops)
for k, v in c.most_common(30): print('PV', k, v)
