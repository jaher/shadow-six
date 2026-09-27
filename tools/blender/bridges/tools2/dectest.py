import bpy, bmesh, math
obs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(('wing_1_1', 'bridge_body'))]
def tri(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
for o in obs:
    c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
    bm = bmesh.new(); bm.from_mesh(c.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(3), verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(c.data); bm.free()
    t1 = tri(c)
    m = c.modifiers.new('d', 'DECIMATE'); m.ratio = 0.3; m.use_collapse_triangulate = True; m.delimit = {'MATERIAL'}
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = c; c.select_set(True)
    bpy.ops.object.modifier_apply(modifier='d')
    print('DEC', o.name, tri(o), 'merged+dissolved', t1, 'dec', tri(c))
