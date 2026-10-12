"""Print the hero's face box (beret top to chin, ear to ear) as fractions of the hero camera frame, for HERO_FACE in
src/ui/hero-art.js:   blender -b <hero.blend> --python tools/ui/keyart/herohd/facebox.py"""
import bpy, os, sys, json
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
HERE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(HERE, 'pose_herohd.json')))
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = 1800, 2700
cd = bpy.data.cameras.new('fbcam'); cd.lens = P['cam']['lens']
cam = bpy.data.objects.new('fbcam', cd); sc.collection.objects.link(cam)
cam.location = Vector(P['cam']['loc']); cam.rotation_euler = (Vector(P['cam']['tgt']) - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
pts = []
ob = bpy.data.objects['body']; ev = ob.evaluated_get(dg); me = ev.to_mesh()
gi = ob.vertex_groups['head'].index
orig = ob.data
w = {}
for v in orig.vertices:
    for g in v.groups:
        if g.group == gi: w[v.index] = g.weight
for i, v in enumerate(me.vertices):                 # subdivision keeps the original vertices first
    if i < len(orig.vertices) and w.get(i, 0) > 0.6: pts.append(ob.matrix_world @ v.co)
ev.to_mesh_clear()
for nm in ('beret', 'beret_band'):
    o = bpy.data.objects[nm]; e = o.evaluated_get(dg); m = e.to_mesh()
    pts += [o.matrix_world @ v.co for v in m.vertices]; e.to_mesh_clear()
uv = [world_to_camera_view(sc, cam, p) for p in pts]
x0, x1 = min(u.x for u in uv), max(u.x for u in uv)
y0, y1 = 1 - max(u.y for u in uv), 1 - min(u.y for u in uv)
print('HERO_FACE', json.dumps({'x0': round(x0, 3), 'y0': round(y0, 3), 'x1': round(x1, 3), 'y1': round(y1, 3)}))
