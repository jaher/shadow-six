import bpy, json, struct
o = bpy.data.objects['main']
me = o.data
print('ATTRS', [(a.name, a.domain, a.data_type) for a in me.color_attributes], 'active', me.color_attributes.active_color_name if hasattr(me.color_attributes,'active_color_name') else me.color_attributes.active_color)
for ob in bpy.data.objects: ob.select_set(False)
o.select_set(True); bpy.context.view_layer.objects.active = o
def ex(p):
    bpy.ops.export_scene.gltf(filepath=p, use_selection=True, export_format='GLB', export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_image_format='NONE')
    b=open(p,'rb').read(); ln=struct.unpack_from('<I',b,12)[0]; js=json.loads(b[20:20+ln])
    print('EXPORT', p, sorted({k for m in js['meshes'] for pr in m['primitives'] for k in pr['attributes']}))
ex('<claude-tmp>')
me.color_attributes.active_color = me.color_attributes['Col']
ex('<claude-tmp>')
