"""Stage 1 of the detailed hero (S03 key art): the posed, clothed character.
  blender -b --factory-startup --python tools/ui/keyart/herohd/build.py -- <data dir> <out char.blend> [voxel_m]
data dir = the CC0 MakeHuman data (see mh.py: mhrepo/, mpfb2/, mhsys/x/). Blender >= 4.2 (OIDN, RTX 50 GPUs);
tested with the official 4.5.14 LTS build.
  1. body.make: MakeHuman male + targets -> fictional face, rig + skin weights, region masks
  2. garments: Denison smock + battledress trousers built round the rest-pose body (garments.py)
  3. pose B (pose_herohd.json: aims, palm solve, the Colt in the palm, fingers curled round the grip)
  4. cloth: the armature eases from the rest pose into pose B (frames 1-14) while the trousers' waistband and the
     smock's belt line are pulled in (shape keys, pinned); trousers first, then the smock colliding with them
  5. the simulated garments are frozen as plain meshes; the file is saved at the final frame
Then dress.py (beret, hair, webbing and kit, materials) and render_hd.py (lights, camera, passes)."""
import bpy, sys, os, json, time, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import mh, body, pose, garments as G

argv = sys.argv[sys.argv.index('--') + 1:]
ROOT, OUT = argv[0], argv[1]
VOX = float(argv[2]) if len(argv) > 2 else 0.007
F_POSE, F_END = 14, 32

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene
H, ob, rig = body.make(ROOT)
ob.data.materials.append(body.skin_material(H))
bpy.context.view_layer.update()
lm = body.landmarks(H)
rig['eye_z'] = float(lm['E'][2] + rig.location.z); rig['eye_y'] = float(lm['E'][1])
rig['sub_z'] = float(lm['sub'][2] + rig.location.z); rig['chin_z'] = float(lm['chin'][2] + rig.location.z)

t0 = time.time()
tr, tr_sk, TZ = G.make_trousers(ob, rig, voxel=VOX)
sm, sm_sk, SZ = G.make_smock(ob, rig, voxel=VOX)
print('GARMENTS trousers %d verts, smock %d verts (%.0f s)' % (len(tr.data.vertices), len(sm.data.vertices), time.time() - t0))
rig['z_belt'] = float(SZ['z_belt']); rig['hem'] = float(SZ['hem']); rig['sleeve_t'] = float(SZ['sleeve_t'])

POSE = json.load(open(os.path.join(HERE, 'pose_herohd.json')))
ps = pose.Poser(rig, ob)
ps.apply(POSE)
gun = pose.pistol(ps, POSE, os.path.dirname(HERE)) if POSE.get('pistol') else None
G.keyframe_pose(rig, 1, F_POSE)
for sk, f0, f1 in ((tr_sk, 6, 16), (sm_sk, 12, 22)):
    sk.value = 0.0; sk.keyframe_insert('value', frame=f0); sk.value = 1.0; sk.keyframe_insert('value', frame=f1)
G.collider(ob, thick=0.003)

CL = dict(quality=8, mass=0.05, tension=40, compression=40, shear=20, bending=6, self_col=False)
# trousers (wool serge: a little heavier and stiffer)
G.cloth(tr, pin='waist', frames=(1, F_END), **dict(CL, mass=0.06, bending=9))
sm.hide_viewport = True
t0 = time.time(); G.run_sim(1, F_END, report=True); print('SIM trousers %.0f s' % (time.time() - t0))
trb = G.bake_to_mesh(tr, 'trousers_sim')
bpy.data.objects.remove(tr)
G.collider(trb, thick=0.003)
sm.hide_viewport = False
G.cloth(sm, pin='belt', frames=(1, F_END), **CL)
sc.frame_set(1)
t0 = time.time(); G.run_sim(1, F_END, report=True); print('SIM smock %.0f s' % (time.time() - t0))
smb = G.bake_to_mesh(sm, 'smock_sim')
bpy.data.objects.remove(sm)
for o in (trb, smb):
    for m in list(o.modifiers): o.modifiers.remove(m)
for m in list(ob.modifiers):
    if m.type == 'COLLISION': ob.modifiers.remove(m)
sc.frame_start, sc.frame_end = 1, F_END
sc.frame_set(F_END)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('WROTE', OUT)
