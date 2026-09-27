"""Menu key art (review fix: the S03 hero and the S20 figure were flat SVG clip-art): offline Cycles renders of the
project's Green Beret character model (the character pipeline's greenberet.blend, CPU Cycles; Blender 4.0).
  blender -b <greenberet.blend> --python tools/ui/keyart/render.py -- hero <out.png> 1800 2700 160 tools/ui/keyart/pose_hero.json
  blender -b <greenberet.blend> --python tools/ui/keyart/render.py -- portrait <out.png> 1200 1680 160 tools/ui/keyart/pose_portrait.json
then  python3 tools/ui/keyart/grade.py <out.png> assets/ui/keyart/hero.webp 900 1350 hero   (tiny-portrait: 600 840 muted)
The pose JSON aims bones in armature space, curls fingers, places the Colt from weapons.glb in the fist, frames the
camera and sets the fire / moon light energies. The model's UV nodes name a layer 'atlas' the mesh calls 'UVMap', so
the script clears the node's uv_map (default layer).
"""
# blender -b greenberet.blend --python render.py -- <mode:hero|portrait> <out.png> [W H samples]
import bpy, sys, math, json
from mathutils import Vector, Euler
argv = sys.argv[sys.argv.index('--') + 1:]
mode, out = argv[0], argv[1]
W = int(argv[2]) if len(argv) > 2 else 900
H = int(argv[3]) if len(argv) > 3 else 1300
SPP = int(argv[4]) if len(argv) > 4 else 64
POSE = json.loads(open(argv[5]).read()) if len(argv) > 5 else {}
sc = bpy.context.scene
for vl in sc.view_layers:
    print('OVR', vl.material_override); vl.material_override = None
for n in ('LOD1', 'LOD2'):
    o = bpy.data.objects.get(n)
    if o: o.hide_render = True
rig = bpy.data.objects['body.rig']
# ---- pose (euler degrees per bone, local XYZ)
bpy.context.view_layer.objects.active = rig
for b in rig.pose.bones: b.rotation_mode = 'XYZ'
for name, rot in POSE.get('bones', {}).items():
    pb = rig.pose.bones.get(name)
    if pb: pb.rotation_euler = Euler([math.radians(v) for v in rot], 'XYZ')
bpy.context.view_layer.update()
from mathutils import Matrix
def aim_bone(pb, d, twist=0.0):
    M = pb.matrix.copy(); loc = M.translation.copy()
    q = M.col[1].xyz.normalized().rotation_difference(Vector(d).normalized())
    N = q.to_matrix().to_4x4() @ M
    if twist: N = N @ Matrix.Rotation(math.radians(twist), 4, 'Y')
    N.translation = loc; pb.matrix = N; bpy.context.view_layer.update()
for step in POSE.get('aim', []):
    pb = rig.pose.bones[step[0]]
    tgt = step[1]
    if step[2] if len(step) > 2 else False: d = Vector(tgt) - pb.head
    else: d = Vector(tgt)
    aim_bone(pb, d, step[3] if len(step) > 3 else 0.0)
    print('BONE', step[0], 'head', tuple(round(v, 3) for v in pb.head), 'tail', tuple(round(v, 3) for v in pb.tail))
# ---- pistol in the right hand
if POSE.get('pistol'):
    bpy.ops.import_scene.gltf(filepath='<projects>/commandos-rnd-backup/scratchpad/chars/out/weapons.glb')
    keep = bpy.data.objects.get('colt1911')
    for o in list(bpy.context.selected_objects):
        if o is not keep and not o.name.startswith('colt1911'): bpy.data.objects.remove(o, do_unlink=True)
    p = POSE['pistol']
    hb = rig.pose.bones['hand_r']
    Mh = rig.matrix_world @ hb.matrix
    at = Mh.translation + Mh.col[1].xyz.normalized() * p.get('along', 0.07) + Vector(p.get('offset', (0, 0, 0)))
    if p.get('auto'):
        Wh = lambda n: rig.matrix_world @ rig.pose.bones[n].head
        fist = sum((Wh(n) for n in ('index_02_r', 'middle_02_r', 'ring_02_r', 'pinky_02_r')), Vector()) / 4
        knuck = (Wh('index_01_r') - Wh('pinky_01_r')).normalized()
        at = fist + Vector(p.get('offset', (0, 0, 0)))
        mz = Mh.col[1].xyz.normalized() + Vector(p.get('muzzle_bias', (0, 0, 0)))
        fwd = -(mz - knuck * mz.dot(knuck)).normalized()
        up = knuck
    else:
        fwd = -Vector(p['muzzle']).normalized()          # pistol +Y points back (muzzle is -Y)
        up = Vector(p['up'])
    up = (up - fwd * up.dot(fwd)).normalized()
    x = fwd.cross(up)
    R = Matrix((x, fwd, up)).transposed().to_4x4()
    R.translation = at
    keep.matrix_world = R @ Matrix.Scale(p.get('scale', 1.0), 4)
    gm = bpy.data.materials.new('gunmetal'); gm.use_nodes = True
    bs = gm.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value = (0.035, 0.036, 0.04, 1)
    bs.inputs['Metallic'].default_value = 0.85; bs.inputs['Roughness'].default_value = 0.38
    keep.data.materials.clear(); keep.data.materials.append(gm)
for im in bpy.data.images:
    if im.source == 'FILE':
        try: im.reload(); im.pack(); print('PACK', im.name, im.size[:])
        except Exception as e: print('IMGERR', im.name, e)
# ---- material fixes: glTF ORM (G rough, B metal) -> no stray chrome; skin/cloth read rough
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'UVMAP': n.uv_map = ''
        if n.type == 'BSDF_PRINCIPLED' and False:
            for l in list(n.inputs['Metallic'].links): m.node_tree.links.remove(l)
            n.inputs['Metallic'].default_value = 0.0
            for l in list(n.inputs['Roughness'].links): m.node_tree.links.remove(l)
            n.inputs['Roughness'].default_value = 0.62
# ---- world + lights
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences
    pass
    for d in pr.devices: d.use = True
except Exception as e: print('gpu', e)
sc.cycles.samples = SPP
sc.cycles.use_denoising = False
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = 'Filmic'
sc.view_settings.look = 'Medium High Contrast' if mode == 'hero' else 'Medium Contrast'
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.012, 0.014, 0.022, 1) if mode == 'hero' else (0.012, 0.012, 0.01, 1)
bg.inputs[1].default_value = 1.0
def light(name, kind, loc, rot, energy, color, size=1.0):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if kind == 'AREA': d.size = size
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = Euler([math.radians(v) for v in rot])
    return o
def aim(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()
head = Vector((0, -0.08, 1.86))
if mode == 'hero':
    L = POSE.get('lights', {})
    g = lambda k, d: L.get(k, d)
    a = light('rimR', 'AREA', (1.2, 1.5, 1.8), (0, 0, 0), g('rimR', 2600), (1.0, 0.42, 0.12), 1.0); aim(a, head)
    b = light('rimL', 'AREA', (-1.3, 1.3, 1.4), (0, 0, 0), g('rimL', 1100), (1.0, 0.5, 0.16), 0.8); aim(b, head)
    c = light('bounce', 'AREA', (1.1, -1.5, 0.5), (0, 0, 0), g('bounce', 170), (1.0, 0.45, 0.16), 1.2); aim(c, head)
    d = light('moon', 'AREA', (-1.9, -1.2, 3.0), (0, 0, 0), g('moon', 70), (0.5, 0.64, 1.0), 1.5); aim(d, head)
    e = light('key', 'AREA', (0.5, -2.6, 1.2), (0, 0, 0), g('key', 22), (1.0, 0.6, 0.32), 0.8); aim(e, head)
    cam_loc, cam_tgt, lens = Vector((0.05, -2.9, 1.05)), Vector((0, 0, 1.38)), 50
else:
    k = light('key', 'AREA', (1.5, -1.9, 2.7), (0, 0, 0), 300, (1.0, 0.9, 0.76), 1.2); aim(k, head)
    f = light('fill', 'AREA', (-1.8, -1.5, 1.5), (0, 0, 0), 35, (0.8, 0.88, 1.0), 2.0); aim(f, head)
    r = light('rim', 'AREA', (-1.0, 1.5, 2.3), (0, 0, 0), 420, (1, 0.95, 0.85), 1.0); aim(r, head)
    sc.view_settings.look = 'Medium High Contrast'
    cam_loc, cam_tgt, lens = Vector((-0.55, -2.2, 1.62)), Vector((0.02, 0, 1.58)), 70
for k2, v in POSE.get('cam', {}).items():
    if k2 == 'loc': cam_loc = Vector(v)
    if k2 == 'tgt': cam_tgt = Vector(v)
    if k2 == 'lens': lens = v
cd = bpy.data.cameras.new('cam'); cd.lens = lens
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); cam.location = cam_loc; aim(cam, cam_tgt)
sc.camera = cam
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
