import bpy, json, struct
o = bpy.data.objects['main']; me = o.data
for ob in bpy.data.objects: ob.select_set(False)
o.select_set(True); bpy.context.view_layer.objects.active = o
base='<claude-tmp>'
def ex(p, **kw):
    bpy.ops.export_scene.gltf(filepath=p, use_selection=True, export_format='GLB', export_image_format='NONE', **kw)
    b=open(p,'rb').read(); ln=struct.unpack_from('<I',b,12)[0]; js=json.loads(b[20:20+ln])
    print('EXPORT', kw, sorted({k for m in js['meshes'] for pr in m['primitives'] for k in pr['attributes']}))
ca = me.color_attributes
print('IDX', ca.active_color_index, ca.render_color_index, [a.name for a in ca])
ca.active_color = ca['Col']
print('IDX2', ca.active_color_index, ca.render_color_index)
ex(base+'5.glb', export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
ca.render_color_index = 0
ex(base+'6.glb', export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
ex(base+'7.glb', export_vertex_color='ACTIVE', export_all_vertex_colors=True)
