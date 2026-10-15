"""M10 garrison barracks `barracks` (dossier §5.4 `barracks_corrugated_gable`, 22 x 10 x 6, NE of the apron):
a long corrugated-iron gable barracks on a timber frame and a low concrete plinth, walls in faded DAK sand paint with
rust coming through, a rusted corrugated roof with a galvanised ridge cap and three stovepipes, louvred timber shutters,
a shaded veranda (timber posts, pent corrugated roof) along the S long side with two doors under it, a third door in the
E gable, a sandbag splinter wall along the N foot, a steel flagpole at the W end (animated flag anchor), water drums,
jerrycans, a notice board, wind-blown sand at every foot. Front (Blender -Y) = game S at rot 0 (the mission turns it so
the veranda faces WSW onto the apron). Usage: blender -b --python ic_barracks.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('a')
NAME = 'barracks_corr_ic'
K.begin(NAME, 10701 + SEED, theater='desert')
r = K.rng()
L, W, ZE, PITCH = 22.0, 10.0, 3.2, 28.0
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
P = rect(x0, y0, x1, y1)
T = 0.14
CORR = (1.08, 0.95, 0.74)                  # faded sand paint on the sheets
WOOD = (0.72, 0.62, 0.5)
DOORS = (0.9, 4.4)                         # S long side, under the veranda (mission garrison exits a3 / a2)
doors = [K.opening(P, 0, d - x0, 1.2, 2.15, 0.35, T, 'rect', 'door') for d in DOORS]
doors.append(K.opening(P, 1, W / 2 + 1.5, 1.1, 2.1, 0.35, T, 'rect', 'door'))     # E gable
wins = []
for e, xs in ((0, (-9.0, -6.0, -3.0, 7.4, 9.6)), (2, (-9.0, -5.5, -2.0, 1.5, 5.0, 8.5))):
    for x in xs:
        wins.append(K.opening(P, e, (x - x0) if e == 0 else (x1 - x), 1.0, 1.0, 1.25, T))
wins.append(K.opening(P, 3, W / 2, 0.9, 0.9, 1.3, T))
bm = bmesh.new()
C.prism_bm(bm, C.poly_offset(C.ccw(P), 0.1), -0.1, 0.35)
K.part(bm, 'concrete_aggregate', name='plinth', mat_tint=(0.86, 0.8, 0.7), grime=1.0)
K.wall_ring(P, ZE, T, 'corrugated_galv', doors + wins, z0=0.35, name='walls', mat_tint=CORR, grime=1.2, uv='aligned', rot90=True)
zr = ZE + (W / 2) * math.tan(math.radians(PITCH))
for e in (1, 3):
    K.gable(P, e, ZE, zr, T, 'corrugated_galv', [], name='gable%d' % e, mat_tint=CORR, rot90=True)
bm = bmesh.new()                           # timber corner / bay posts and sill plate showing outside
for (cx, cy) in P:
    C.box_bm(bm, (cx, cy, ZE / 2 + 0.2), (0.2, 0.2, ZE - 0.3))
for k in range(1, 6):
    for yy in (y0, y1):
        C.box_bm(bm, (x0 + L * k / 6, yy, ZE / 2 + 0.2), (0.16, 0.2, ZE - 0.3))
for a, b in zip(P, P[1:] + P[:1]):
    C.beam_bm(bm, (a[0], a[1], 0.42), (b[0], b[1], 0.42), 0.16, 0.12)
K.part(bm, 'timber_beam', name='frame', mat_tint=WOOD, uv='beam', axis=(0, 0, 1), grime=0.8)
R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'corrugated_rust', eave_oh=0.4, gable_oh=0.3, thick=0.06, fascia=None, barge='timber_beam', gutters=False, sag=0.03)
bm = bmesh.new()
C.beam_bm(bm, (x0 - 0.3, 0, R.z_ridge + 0.02), (x1 + 0.3, 0, R.z_ridge + 0.02), 0.5, 0.06)
K.part(bm, 'steel_galv', name='ridge_cap', mat_tint=(0.6, 0.58, 0.54))
for k, f in enumerate(wins):
    K.window(f, 'casement', (2, 2), frame=(0.66, 0.6, 0.5), recess=0.05, sill='timber_beam', lintel=None,
             shutters=['open', 'closed', 'ajar'][(k + SEED) % 3], shutter_color=(0.6, 0.55, 0.42), shutter_style='louvred',
             curtain=0.3, streak=False, name='w%d' % k)
for k, f in enumerate(doors):
    K.door(f, 'd%d' % k, 'plank', (0.5, 0.46, 0.36), step='concrete_board', hinge='left', node='door_main' if k == 1 else None, open_deg=0 if k else 35)
# ---- the S veranda: posts, a pent corrugated roof from under the eave, a plank floor on bearers
VX0, VX1, VD = -2.2, 7.4, 2.2
posts([(x, y0 - VD + 0.12) for x in (VX0 + 0.12, (VX0 + VX1) / 2 - 1.4, (VX0 + VX1) / 2 + 1.6, VX1 - 0.12)], 0.2, ZE - 0.45, s=0.18, name='ver_posts', tint=WOOD)
beams([((VX0, y0 - VD + 0.12, ZE - 0.45), (VX1, y0 - VD + 0.12, ZE - 0.45))], s=0.18, name='ver_beam', tint=WOOD)
KR.roof_shed(VX0, y0 - VD, VX1, y0, ZE - 0.38, ZE - 0.02, mid='corrugated_galv', thick=0.05, oh=0.1, low_side='-y', name='ver_roof')
bm = bmesh.new()
C.box_bm(bm, ((VX0 + VX1) / 2, y0 - VD / 2, 0.24), (VX1 - VX0, VD, 0.08))
K.part(bm, 'deck_planks', name='ver_floor', mat_tint=(0.8, 0.72, 0.6), grime=0.9, uv='aligned')
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_barracks_b.py')).read())
