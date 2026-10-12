"""Stage 2 of the detailed hero: dress the posed character from build.py.
  blender -b <char.blend> --python tools/ui/keyart/herohd/dress.py -- <data dir> <out hero.blend>
Skin + eyes + lashes; the green beret (badge, leather band, bow) on the head bone; particle-free curve hair grown on the
posed skin (short back and sides kept under the beret, brows, two-day stubble, forearm hair); the smock and trousers
get thickness, subdivision and their fabrics (Denison brushstroke drill, wool serge); the collar, zip, rolled sleeves,
pockets and the jersey neckband; then the 1937-pattern webbing and kit (kit.py, gear.py)."""
import bpy, sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
from mathutils import Vector, Matrix
import mh, body, hair, beret, mats, kit, tailor, gear, garments as G

argv = sys.argv[sys.argv.index('--') + 1:]
ROOT, OUT = argv[0], argv[1]
STAGES = set((argv[2] if len(argv) > 2 else 'all').split(','))
sc = bpy.context.scene
rig = bpy.data.objects['hero.rig']
ob = bpy.data.objects['body']
smock = bpy.data.objects['smock_sim']
trousers = bpy.data.objects['trousers_sim']
Z = G.landmarks_z(rig)
H = body.shaped(ROOT)

# ---------------------------------------------------------------- head: eyes, lashes, beret, hair
sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
ob.data.materials.clear(); ob.data.materials.append(body.skin_material(H))        # (re)made here: look tweaks skip the sim
eyes = body.eyes(H, rig)
# eye contact: turn each eyeball (about its joint centre, rest space) toward the camera, at most 22 degrees
POSE = json.load(open(os.path.join(HERE, 'pose_herohd.json')))
pbh = rig.pose.bones['head']
Dh = (rig.matrix_world @ pbh.matrix) @ (rig.matrix_world @ pbh.bone.matrix_local).inverted()
cam_rest = rig.matrix_world.inverted() @ (Dh.inverted() @ Vector(POSE['cam']['loc']))
for side, sg in (('l', 1), ('r', -1)):
    cen = Vector(mh.mh2b(H.gcenter(f'joint-{side}-eye')[None])[0].tolist())
    q = Vector((0, -1, 0)).rotation_difference((cam_rest - cen).normalized())
    ang = min(q.angle, math.radians(22))
    q = q.to_axis_angle(); R = Matrix.Rotation(ang, 3, q[0])
    for v in eyes.data.vertices:
        if (v.co.x > 0) == (sg > 0):
            v.co = cen + R @ (v.co - cen)
body.card(H, rig, os.path.join(H.SYS, 'eyelashes/eyelashes01/eyelashes01.mhclo'), 'lashes')
# the beret is built on the rest head, then carried by the head bone into the pose
pb = rig.pose.bones['head']
D = (rig.matrix_world @ pb.matrix) @ (rig.matrix_world @ pb.bone.matrix_local).inverted()
rest_eye_z = rig['eye_z']
bo, band, badge, binfo = beret.build(ob, rig, rest_eye_z, rig['eye_y'])
for o in [bo, band, badge] + binfo['tails']:
    o.matrix_world = D @ o.matrix_world
# keep the hair out from under the beret: zero the scalp mask above the band plane (rest coordinates)
c, n_ = np.array(binfo['c']), np.array(binfo['n'])
vg = ob.vertex_groups['k_scalp']
Mb = ob.matrix_world
for v in ob.data.vertices:
    p = np.array(Mb @ v.co)
    if (p - c) @ n_ > -0.006:
        vg.remove([v.index])
hm = body.hair_material('hair_dk', melanin=0.94, redness=0.28)
bm_ = body.hair_material('brow', melanin=0.97, redness=0.25, rough=0.4)
smat = body.hair_material('stubble', melanin=0.95, redness=0.22, rough=0.42, random=0.25)
amat = body.hair_material('armhair', melanin=0.7, redness=0.35, rough=0.4, random=0.3)
co, tri, w = hair.surface(ob, 'k_beard')
hair.grow('stubble', co, tri, w, 70000, 0.0022, hair.flow_beard(rig), smat, lie=0.62, pts=3, root_r=4.2e-5, tip_r=1.8e-5, jitter=0.35, seed=2)
co, tri, w = hair.surface(ob, 'k_scalp')
hair.grow('scalp', co, tri, w, 160000, 0.0095, hair.flow_down_back(rig), hm, lie=0.88, pts=5, root_r=4.2e-5, tip_r=1.2e-5, curl=0.15, jitter=0.3, seed=3)
co, tri, w = hair.surface(ob, 'k_brow')
hair.grow('brows', co, tri, w, 6500, 0.0105, hair.flow_brow(rig), bm_, lie=0.92, pts=5, root_r=5e-5, tip_r=1.2e-5, curl=0.1, jitter=0.22, seed=4)
co, tri, w = hair.surface(ob, 'k_armhair')
hair.grow('armhair', co, tri, w, 9000, 0.007, hair.flow_arm(rig, None), amat, lie=0.85, pts=4, root_r=2.2e-5, tip_r=0.8e-5, curl=0.2, jitter=0.4, seed=5)

# ---------------------------------------------------------------- garments
camo = mats.denison('denison', seed=0.0)
camo_in = mats.denison('denison_inside', seed=3.7, fade=0.3)
serge = mats.serge()
for g, m, th in ((smock, camo, 0.0024), (trousers, serge, 0.0026)):
    g.data.materials.clear(); g.data.materials.append(m)
    sd = g.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = th; sd.offset = -1; sd.use_quality_normals = True
    ss = g.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
col, cframes = tailor.collar(smock, camo, Z['zn'], rig['eye_y'])
brass = mats.brass('brass')
zipm = mats.brass('zipmetal', tarnish=0.8)
tailor.zip_teeth(smock, cframes, zipm)
for s in ('l', 'r'):
    tailor.rolled_sleeve(smock, Z['arms'][s], camo_in, seed=1 if s == 'l' else 2)
surf = kit.Surface(smock)
yb_front = -0.2
for s in (1, -1):
    # breast pockets (flap + pocket) and skirt pockets
    pc, _ = tailor.patch('pocket_breast', surf, (s * 0.095, -0.4, Z['zs'] - 0.155), 0.135, 0.15, camo, bulge=0.006)
    tailor.patch('flap_breast', surf, (s * 0.095, -0.4, Z['zs'] - 0.085), 0.145, 0.05, camo, clear=0.004, bulge=0.002, flap=True)
    tailor.patch('pocket_skirt', surf, (s * 0.11, -0.4, Z['zh'] - 0.05), 0.15, 0.15, camo, bulge=0.008)
    tailor.patch('flap_skirt', surf, (s * 0.11, -0.4, Z['zh'] + 0.02), 0.16, 0.05, camo, clear=0.004, bulge=0.002, flap=True)
gear.equip(smock, rig, Z)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('WROTE', OUT)
