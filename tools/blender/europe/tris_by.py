import bpy, re, collections
c = collections.Counter(); m = collections.Counter()
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name in ('main',) or o.name.startswith(('main', 'decals', 'door_')) and False: continue
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    key = re.sub(r'[\d\.]+$', '', o.name); key = re.sub(r'\d+', '#', key)
    c[key] += t
    if o.data.materials: m[o.data.materials[0].name] += t
print('OBJS', len(bpy.data.objects))
for k, v in c.most_common(25): print('TRI %6d %s' % (v, k))
for k, v in m.most_common(12): print('MAT %6d %s' % (v, k))
