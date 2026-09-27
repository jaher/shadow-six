import bpy
res=[]
for o in bpy.data.objects:
    if o.type=='MESH' and o.data.vertices:
        z=min((o.matrix_world@v.co).z for v in o.data.vertices); res.append((z,o.name))
for z,n in sorted(res)[:6]: print('LOWZ %.3f %s'%(z,n))
