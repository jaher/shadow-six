import bpy
for o in bpy.data.objects:
    if o.type=='MESH' and 'kit_node' in o.keys():
        print('PART', o.name, len(o.data.polygons), o.get('kit_node'))
