import bpy, collections
c = collections.Counter()
for o in bpy.data.objects:
    if o.type == 'MESH':
        c[o.name] += sum(len(p.vertices) - 2 for p in o.data.polygons)
print('OBJS', len(c), sum(c.values()))
for k, v in c.most_common(30): print('  T', v, k)
