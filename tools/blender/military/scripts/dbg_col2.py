import bpy, json, struct
props = bpy.ops.export_scene.gltf.get_rna_type().properties
print('PROPS', [p.identifier for p in props if 'color' in p.identifier.lower()])
o = bpy.data.objects['main']; me = o.data
me.color_attributes.active_color = me.color_attributes['Col']
try:
    me.color_attributes.render_color_index = 0
except Exception as e: print('ERR', e)
for ob in bpy.data.objects: ob.select_set(False)
o.select_set(True); bpy.context.view_layer.objects.active = o
def ex(p, **kw):
    bpy.ops.export_scene.gltf(filepath=p, use_selection=True, export_format='GLB', export_image_format='NONE', **kw)
    b=open(p,'rb').read(); ln=struct.unpack_from('<I',b,12)[0]; js=json.loads(b[20:20+ln])
    print('EXPORT', kw, sorted({k for m in js['meshes'] for pr in m['primitives'] for k in pr['attributes']}))
base='<claude-tmp>'
ex(base+'3.glb', export_vertex_color='ACTIVE', export_all_vertex_colors=True)
try: ex(base+'4.glb', export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True)
except Exception as e: print('ERR4', e)
