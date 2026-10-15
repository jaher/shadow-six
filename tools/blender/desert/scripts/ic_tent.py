"""M10 tent row (dossier §5.3 `tent_pyramid_desert`, building-inventory: tan pyramid tents on sandbag bases, x3; 6 x 5 x 3):
a square-ish pyramid tent of faded tan duck canvas: 1.1 m walls on a 4.6 x 4.0 base rising to a pole apex at 3.0 m, a door
flap rolled up and tied on the long S side, a ventilator cap at the apex, a course of sandbags round the foot (open at the
door), guy ropes from the eave corners and mid-sides to pegs that stay INSIDE the 6 x 5 footprint, wind-blown sand on the
weather side. Front (Blender -Y) = game S. Usage: blender -b --python ic_tent.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('a')
NAME = 'tent_pyramid_ic'
K.begin(NAME, 11201 + SEED, theater='desert')
r = K.rng()
BW, BD, ZW, ZA = 2.3, 2.0, 1.1, 3.0        # half base, wall height, apex
TAN = (0.9, 0.82, 0.64)
base = [V((-BW, -BD, 0.05)), V((BW, -BD, 0.05)), V((BW, BD, 0.05)), V((-BW, BD, 0.05))]
eave = [V((p.x * 0.97, p.y * 0.97, ZW)) for p in base]
apex = V((0, 0, ZA))
bm = bmesh.new()
vb = [bm.verts.new(tuple(p)) for p in base]
ve = [bm.verts.new(tuple(p)) for p in eave]
va = bm.verts.new(tuple(apex))
for i in range(4):
    j = (i + 1) % 4
    if i == 0:                             # the S wall: a door gap (the flap is rolled up over it)
        d0, d1 = bm.verts.new((-0.55, -BD, 0.05)), bm.verts.new((0.55, -BD, 0.05))
        e0, e1 = bm.verts.new((-0.55, -BD * 0.97, ZW)), bm.verts.new((0.55, -BD * 0.97, ZW))
        bm.faces.new((vb[0], d0, e0, ve[0])); bm.faces.new((d1, vb[1], ve[1], e1))
    else:
        bm.faces.new((vb[i], vb[j], ve[j], ve[i]))
    sag = V((0, 0, -0.08))                 # the roof panels sag a little between the eave and the apex
    m = bm.verts.new(tuple((ve[i].co + ve[j].co) / 2 * 0.55 + apex * 0.45 + sag))
    bm.faces.new((ve[i], ve[j], m)); bm.faces.new((ve[j], va, m)); bm.faces.new((va, ve[i], m))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
K.part(bm, 'canvas', name='canvas', mat_tint=TAN, grime=0.8, bisect=False, smooth=False)
bm = bmesh.new()                           # the rolled door flap, the apex cap, the inner pole showing at the door
C.cyl_bm(bm, V((-0.6, -BD - 0.05, ZW - 0.05)), V((0.6, -BD - 0.05, ZW - 0.05)), 0.09, 8)
C.cyl_bm(bm, apex - V((0, 0, 0.05)), apex + V((0, 0, 0.18)), 0.28, 8, r1=0.05)
K.part(bm, 'canvas', name='flap_cap', mat_tint=(0.84, 0.76, 0.58), grime=0.8, bisect=False, smooth=True)
bm = bmesh.new()
C.cyl_bm(bm, V((0, 0, 0)), apex, 0.05, 6)
K.part(bm, 'timber_beam', name='pole', mat_tint=(0.7, 0.6, 0.48), bisect=False)
bm = bmesh.new()
C.box_bm(bm, (0, -BD + 0.6, 0.02), (1.0, 1.0, 0.04))
K.part(bm, 'interior_dark', name='inside', mat_tint=(0.2, 0.18, 0.16), bisect=False)
for (a, b) in (((-BW - 0.25, -BD - 0.25), (-0.75, -BD - 0.25)), ((0.75, -BD - 0.25), (BW + 0.25, -BD - 0.25)),
               ((BW + 0.25, -BD), (BW + 0.25, BD)), ((-BW - 0.25, BD + 0.25), (BW + 0.25, BD + 0.25)), ((-BW - 0.25, BD), (-BW - 0.25, -BD))):
    dz.sandbags(a, b, rows=2, name='skirt%d' % int(a[0] * 10 + a[1] * 100), thick=1, footprint=False)
bm = bmesh.new()                           # guy ropes to pegs inside the 6 x 5 footprint
pegs = [(-2.85, -2.35), (2.85, -2.35), (2.85, 2.35), (-2.85, 2.35), (0.0, 2.4), (2.9, 0.0), (-2.9, 0.0)]
tops = [eave[0], eave[1], eave[2], eave[3], V((0, BD * 0.97, ZW)), V((BW * 0.97, 0, ZW)), V((-BW * 0.97, 0, ZW))]
for (px, py), t in zip(pegs, tops):
    C.cyl_bm(bm, t, V((px, py, 0.08)), 0.008, 3, caps=False)
    C.cyl_bm(bm, V((px, py, -0.05)), V((px, py, 0.14)), 0.025, 4)
K.part(bm, 'hessian', name='ropes', mat_tint=(0.6, 0.55, 0.45), bisect=False)
dz.sand_drift((-BW - 0.5, BD + 0.55), (BW + 0.5, BD + 0.55), (0, 1, 0), h=0.2, w=0.45, seed=SEED, name='sand_n')
K.footprint(rect(-2.95, -BD - 0.45, 2.95, BD + 0.45), 'HIGH', 'building')
C.A.meta['notes'].append('pyramid tent: guy ropes and pegs inside a 6 x 5 footprint (neighbours 8 m apart never cross ropes)')
dz.finalize(os.path.join(OUT, NAME), ao_res=512, ao_samples=32)
