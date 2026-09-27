import bpy
res = []
for o in bpy.data.objects:
    if o.type == 'MESH' and 'kit_node' in o.keys() and len(o.data.vertices):
        res.append((min(v.co.z for v in o.data.vertices), o.name))
for z, n in sorted(res)[:6]:
    print('MINZ', round(z, 3), n)
