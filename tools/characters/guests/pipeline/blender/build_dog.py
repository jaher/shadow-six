# build_dog.py - Alsatian guard dog (bible §6.5: black-and-tan, 30-38 kg; seed varies saddle size and ear set)
# usage: tools/bl.sh blender/build_dog.py <out_dir> <id> <seed> [lod0_tris]
import sys, os, json, math, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *


def activate(o, select_only=True):   # scene-object based (view_layer iteration can hold stale None after clean_scene)
    for x in bpy.context.scene.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
import bpy, bmesh
from mathutils import Vector
import dog_geo as DG, dog_anim as DA

a = args()
out_dir, did, seed = os.path.abspath(a[0]), a[1], int(a[2])
LOD0 = int(a[3]) if len(a) > 3 else 4200
rnd = random.Random(seed)
T0 = time.time()
clean_scene()
bpy.context.view_layer.update()
# ---- seed variation: body size (30-38 kg ~ 0.60-0.65 m withers), saddle extent, ear set, coat tone
size = rnd.uniform(0.96, 1.04)
saddle = rnd.uniform(0.0, 1.0)          # 0 = small saddle, 1 = blanket back
ear_tilt = rnd.uniform(-1.0, 1.0)       # ear set (outward tilt)
tan = [c * k for c, k in zip((0.56, 0.36, 0.17), [rnd.uniform(0.88, 1.1)] * 3)]
for s, sx in (('l', 1), ('r', -1)):
    pass
body = DG.body_mesh(seed)
parts = DG.parts_mesh()
# ear set variation: rotate ears outwards about their base
for v in parts.data.vertices:
    for g in v.groups:
        gn = parts.vertex_groups[g.group].name
        if gn in ('ear_l', 'ear_r') and g.weight > 0.5:
            sgn = 1 if gn == 'ear_l' else -1
            base = Vector((sgn * 0.042, -0.43, 0.82))
            d = v.co - base
            ang = math.radians(8 * ear_tilt) * sgn
            d = Vector((d.x * math.cos(ang) + d.z * math.sin(ang), d.y, -d.x * math.sin(ang) + d.z * math.cos(ang)))
            v.co = base + d
activate(body)
dec = body.modifiers.new('dec', 'DECIMATE'); dec.ratio = min(1.0, (LOD0 - tri_count(parts)) / max(1, tri_count(body)))
bpy.ops.object.modifier_apply(modifier='dec')
log('dog body tris', tri_count(body), 'parts', tri_count(parts))
rig = DG.armature()
# auto weights on the body only, jaw/ears/root excluded (they would steal muzzle/skull verts)
for n in ('root', 'jaw', 'ear_l', 'ear_r'):
    rig.data.bones[n].use_deform = False
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for n in ('jaw', 'ear_l', 'ear_r'):
    rig.data.bones[n].use_deform = True
# ---- coat colours as a vertex attribute (then baked with fur noise into a small atlas)
def coat(c, is_part=None):
    y, z, x = c.y, c.z, abs(c.x)
    black = (0.045, 0.04, 0.035)
    if is_part in ('ear_l', 'ear_r'):
        return (0.07, 0.055, 0.045)
    if is_part == 'nose':
        return (0.02, 0.02, 0.02)
    if is_part == 'eye':
        return (0.12, 0.07, 0.03)
    if is_part == 'jaw':
        return black if y < -0.55 else (0.30, 0.20, 0.11)
    # spine line height at y (hip 0.54 .. wither 0.62)
    top = 0.54 + (0.62 - 0.54) * min(1.0, max(0.0, (0.30 - y) / 0.55))
    sad = 0.0
    if -0.27 - 0.05 * saddle < y < 0.40:
        depth = 0.03 + 0.12 * saddle + 0.03 * math.sin((y + 0.2) * 9)
        sad = max(0.0, min(1.0, (z - (top - depth)) / 0.03))
    if y > 0.36 and z > 0.2:   # tail: dark on top and at the tip
        sad = max(sad, 0.8 if z > 0.3 else 1.0)
    if y < -0.5:   # black muzzle mask, fading back to the eyes
        sad = max(sad, min(1.0, (-0.5 - y) / 0.04 + 0.4))
    if -0.5 <= y < -0.4 and z > 0.8:   # dark forehead/crown line
        sad = max(sad, 0.6 * min(1.0, (z - 0.8) / 0.02) * max(0.0, 1 - x / 0.03))
    light = min(1.0, max(0.0, (0.35 - z) / 0.3))   # paler legs and underside
    base = [t * (1 + 0.15 * light) for t in tan]
    return tuple(b * (1 - sad) + k * sad for b, k in zip(base, black))
for ob, part in ((body, None), (parts, 'parts')):
    me = ob.data
    at = me.color_attributes.new('coat', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        p = part
        if part:
            names = [ob.vertex_groups[g.group].name for g in v.groups if g.weight > 0.5]
            p = next((n for n in names if n in ('ear_l', 'ear_r', 'jaw')), None)
            if p is None:
                p = 'nose' if v.co.y < -0.63 else 'eye'
        c = coat(v.co, p)
        at.data[v.index].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1.0)
# parts: parent to rig with their rigid groups (eyes/nose -> head)
for v in parts.data.vertices:
    if not v.groups:
        pass
hg = parts.vertex_groups.new(name='head')
for v in parts.data.vertices:
    names = [parts.vertex_groups[g.group].name for g in v.groups]
    if not any(n in ('ear_l', 'ear_r', 'jaw') for n in names):
        hg.add([v.index], 1.0, 'REPLACE')
for n in ('eyes', 'nose'):
    if n in parts.vertex_groups:
        parts.vertex_groups.remove(parts.vertex_groups[n])
parts.parent = rig
am = parts.modifiers.new('Armature', 'ARMATURE'); am.object = rig
bpy.ops.object.select_all(action='DESELECT'); parts.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
dog = body; dog.name = 'dog'
log('dog joined tris', tri_count(dog), round(time.time() - T0, 1), 's')
import dog_bake
dog_bake.bake(dog, out_dir, did, seed)
meta = DA.build_clips(rig)
dog_bake.export(dog, rig, out_dir, did, meta, {'seed': seed, 'size': round(size, 3), 'saddle': round(saddle, 2), 'ear_tilt': round(ear_tilt, 2)}, size)
log('DONE dog', did, round(time.time() - T0, 1), 's')
