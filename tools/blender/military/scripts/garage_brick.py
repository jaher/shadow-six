"""Brick vehicle depot (M13 Le Havre tank garage; reusable as a French/Belgian works garage):
 a   garage_brick   10 x 10 m, red-brick walls (0.4 m) on a blue-brick plinth with pilasters, 8.2 m wide S opening
     under a riveted steel lintel, four folding plank door leaves standing open inside against the side walls,
     ridge N-S roof of flat interlocking tiles (eaves 4.6 m), gable oculus vent, high barred windows E/W, gutters and
     downpipes, painted GARAGE board, concrete apron with oil stains. Interior: dark floor, inspection-pit grating,
     work bench and tool board on the N wall.
Footprint = 10 x 10 outer walls; the S side is open (layout `pen`, open 'S').
Usage: blender -b --factory-startup --python garage_brick.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1311)
K.begin('garage_brick', SEED, theater='coast')
r = K.rng()
HW, HD, T, ZE = 5.0, 5.0, 0.4, 4.6
OPEN_W, OPEN_H = 8.2, 4.1
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]      # edges 0 S (front, game +z), 1 E, 2 N, 3 W

frames = [K.opening(poly, 0, HW, OPEN_W, OPEN_H, 0.0, T, 'rect', 'door')]
wins = [K.opening(poly, e, t, 1.3, 0.8, 2.9, T, 'rect', 'window') for e in (1, 3) for t in (2.5, 7.5)]
K.wall_ring(poly, ZE, T, 'brick_red', frames + wins, plinth=('brick_dark', 0.55, 0.05), name='walls')
for f in wins:
    K.window(f, 'fixed', (3, 2), frame=(0.3, 0.3, 0.28), sill='concrete_bunker', lintel='brick_dark', surround=None, shutters=None,
             curtain=0.0, bars=True, name='win')
# pilasters on the side walls and the front corners, brick corbel course under the eaves
bm = bmesh.new()
for y in (-HD + 0.25, 0.0, HD - 0.25):
    for x in (-HW - 0.12, HW + 0.12):
        K.box_bm(bm, (x, y, ZE / 2), (0.24, 0.6, ZE))
for x in (-HW + 0.45, HW - 0.45):
    K.box_bm(bm, (x, -HD - 0.12, ZE / 2), (0.9, 0.24, ZE))
K.part(bm, 'brick_red', name='pilasters', grime=0.7)
K.course(poly, ZE - 0.25, 0.18, 0.08, 'brick_dark', name='corbel')

# ------------------------------------------------------------------ front gable (S) + rear gable (N) and the roof
PITCH = 28
R = K.roof_gable(0, 0, 2 * HD, 2 * HW, ZE, pitch=PITCH, mid='roof_tile_flat', rot=math.pi / 2, eave_oh=0.4, gable_oh=0.3,
                 fascia='timber_beam', barge='timber_beam', gutters=True, name='roof')
ocu = K.opening(poly, 0, HW, 0.9, 0.9, ZE + 0.55, T, 'arch', 'window')
K.gable(poly, 0, ZE, R.z_ridge - R.lift, T, 'brick_red', frames=[ocu], name='gable_s')
K.gable(poly, 2, ZE, R.z_ridge - R.lift, T, 'brick_red', name='gable_n')
K.window(ocu, 'fixed', (2, 2), frame=(0.3, 0.3, 0.28), sill=None, lintel='brick_dark', surround=None, curtain=0.0, bars=False, name='oculus')

# ------------------------------------------------------------------ steel lintel over the opening + door guides
bm = bmesh.new()
f = frames[0]
K.beam_bm(bm, f.p(-OPEN_W / 2 - 0.35, OPEN_H + 0.17, -0.05), f.p(OPEN_W / 2 + 0.35, OPEN_H + 0.17, -0.05), 0.34, 0.3)
K.beam_bm(bm, f.p(-OPEN_W / 2 - 0.35, OPEN_H + 0.17, 0.08), f.p(OPEN_W / 2 + 0.35, OPEN_H + 0.17, 0.08), 0.04, 0.36)
for k in range(17):                                     # rivet heads on the lintel's flange
    K.box_bm(bm, tuple(f.p(-OPEN_W / 2 - 0.2 + k * (OPEN_W + 0.4) / 16, OPEN_H + 0.08, 0.11)), (0.05, 0.03, 0.05))
    K.box_bm(bm, tuple(f.p(-OPEN_W / 2 - 0.2 + k * (OPEN_W + 0.4) / 16, OPEN_H + 0.27, 0.11)), (0.05, 0.03, 0.05))
for s in (-1, 1):                                        # steel corner guards on the jambs
    K.beam_bm(bm, f.p(s * OPEN_W / 2, 0.0, -0.05), f.p(s * OPEN_W / 2, 1.1, -0.05), 0.12, 0.12)
K.part(bm, 'steel_painted', name='lintel', mat_tint=(0.24, 0.25, 0.25), grime=1.0, bisect=False)
K.sign(tuple(f.p(0.0, OPEN_H + 0.8, 0.05)), tuple(f.n), 2.2, kind='garage', name='garage_sign')

# folding plank door leaves standing open inside the side walls (2 per side)
for s in (-1, 1):
    bm = bmesh.new()
    for k in range(2):
        x = s * (HW - T - 0.08)
        y0 = -HD + T + 0.25 + k * 2.1
        K.box_bm(bm, (x - s * 0.04 * k, y0 + 1.0, OPEN_H / 2), (0.06, 2.0, OPEN_H - 0.15))
    K.part(bm, 'door_planks', name='door_leaf', mat_tint=(0.32, 0.36, 0.3), uv='beam', axis=(0, 0, 1), grime=0.8, bisect=False)
    bm = bmesh.new()
    for k in range(2):
        x = s * (HW - T - 0.12 - 0.04 * k)
        for z in (0.5, OPEN_H - 0.6):
            K.box_bm(bm, (x, -HD + T + 1.25 + k * 2.1, z), (0.02, 1.7, 0.06))
    K.part(bm, 'cast_iron', name='door_straps', grime=0.4, bisect=False, lod='drop')

# ------------------------------------------------------------------ interior: dark floor, pit grating, bench, tool board
bm = bmesh.new()
K.box_bm(bm, (0, 0, 0.01), (2 * HW - 2 * T, 2 * HD - 2 * T, 0.02))
K.part(bm, 'concrete_slab', name='floor', grime=1.0, tint=(0.55, 0.55, 0.53), bisect=False)
bm = bmesh.new()
K.box_bm(bm, (0, 0.6, 0.035), (1.0, 5.0, 0.03))
K.part(bm, 'steel_grating', name='pit_grating', grime=0.8, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (-2.0, HD - T - 0.4, 0.9), (2.6, 0.7, 0.08))
for x in (-3.1, -0.9):
    K.box_bm(bm, (x, HD - T - 0.4, 0.45), (0.08, 0.6, 0.9))
K.box_bm(bm, (2.0, HD - T - 0.03, 1.7), (2.2, 0.04, 1.2))
K.part(bm, 'timber_grey', name='bench', grime=0.9, bisect=False, lod='drop')
bm = bmesh.new()
for x in (2.8, 3.25, 3.7):
    K.cyl_bm(bm, V((x, HD - T - 0.35, 0.0)), V((x, HD - T - 0.35, 0.88)), 0.29, 12)
K.part(bm, 'steel_painted', name='drums', mat_tint=(0.22, 0.26, 0.3), grime=0.9, smooth=True, bisect=False, lod='drop')

# ------------------------------------------------------------------ apron + weathering
bm = bmesh.new()
M.chamfer_block(bm, -HW + 0.2, -HD - 2.2, HW - 0.2, -HD + 0.02, -0.1, 0.04, ch=0.02)
M.conc_part(bm, 'apron', 'concrete_bunker', (0.8, 0.8, 0.78))
for k in range(4):
    K.decal('stain_blotch', (r.uniform(-2.5, 2.5), -HD - r.uniform(0.3, 1.8), 0.045), (0, 0, 1), r.uniform(0.9, 1.6), r.uniform(0.6, 1.1), up=(0, 1, 0), alpha=0.6)
for k in range(3):
    K.decal('stain_blotch', (r.uniform(-1.5, 1.5), r.uniform(-3, 2), 0.025), (0, 0, 1), r.uniform(1.0, 1.8), r.uniform(0.8, 1.2), up=(0, 1, 0), alpha=0.7)
faces = (((1, 0, 0), (HW + 0.25, 0), 2 * HD), ((-1, 0, 0), (-HW - 0.25, 0), 2 * HD), ((0, 1, 0), (0, HD + 0.006), 2 * HW))
for nrm, (cx, cy), w in faces:
    for k in range(3):
        t = (k + r.uniform(0.25, 0.75)) / 3 - 0.5
        p = (cx + (t * w if nrm[0] == 0 else 0), cy + (t * w if nrm[1] == 0 else 0), ZE - 0.8)
        K.decal(r.choice(['streak_rain', 'streak_long', 'soot']), p, nrm, r.uniform(0.6, 1.0), 1.4, alpha=0.5)
    K.decal('damp_base', (cx, cy, 0.4), nrm, w * 0.9, 0.7, alpha=0.65)
for s in (-1, 1):
    K.decal('streak_rust', tuple(f.p(s * (OPEN_W / 2 + 0.2), OPEN_H - 0.6, 0.01)), tuple(f.n), 0.3, 1.2, alpha=0.6)
K.decal('poster_de', (-HW - 0.25, -2.6, 1.5), (-1, 0, 0), 0.7, 0.95, alpha=0.9)

K.footprint(poly, 'HIGH', 'building')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48)
