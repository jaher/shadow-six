"""Harbour lock-control cabin (M13 Le Havre lock gates; reusable at docks and canal locks):
 a   lock_control_shack   3.5 x 3 m brick cabin: blue-brick plinth, red-brick lower walls to 1.0 m, steel-framed
     glazing band on the S, E and W faces (the operator watches the gate), plank door S, flat concrete roof slab with a
     drip overhang, gate-control desk inside (two levers, handwheel, indicator dial), telephone box and lamp outside,
     cable conduit down the wall, enamel 'Schleuse' board, salt streaks.
Footprint = 3.5 x 3 rect (HIGH); front = Blender -Y = game +z (S); door S at x -0.9.
Usage: blender -b --factory-startup --python lock_shack.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1321)
# b = lock_control_shack_b: the 3 x 3 m variant, painted weatherboard over a brick dado (SW mole head)
K.begin('lock_control_shack' if VAR == 'a' else 'lock_control_shack_b', SEED, theater='coast')
r = K.rng()
HW, HD, T, ZW, ZR = (1.75 if VAR == 'a' else 1.5), 1.5, 0.25, 1.0, 2.45
WALL = 'brick_red' if VAR == 'a' else 'weatherboard_paint'
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]      # edges 0 S, 1 E, 2 N, 3 W
DX = -0.75 if VAR == 'a' else -0.6                                               # door centre (along S, from the W end: HW + DX)

door = K.opening(poly, 0, HW + DX, 0.85, 2.05, 0.0, T, 'rect', 'door')
glz = [K.opening(poly, 0, HW + 0.58, 1.15, 1.05, ZW, T, 'rect', 'window'),
       K.opening(poly, 1, HD, 1.9, 1.05, ZW, T, 'rect', 'window'),
       K.opening(poly, 3, HD, 1.9, 1.05, ZW, T, 'rect', 'window')]
K.wall_ring(poly, ZR, T, WALL, [door] + glz, plinth=('brick_dark', 0.35 if VAR == 'a' else 0.9, 0.04), name='walls')
K.door(door, 'main', 'plank', (0.28, 0.34, 0.33), step='concrete_bunker', node='door_main')
for f in glz:
    K.window(f, 'fixed', (3, 2), frame=(0.26, 0.28, 0.27), sill='concrete_bunker', lintel=None, surround=None, shutters=None,
             curtain=0.0, bars=False, streak=True, name='glaze')
K.course(poly, ZW - 0.06, 0.07, 0.05, 'concrete_bunker', name='sill_band')

# flat roof slab with drip overhang + tar edge, stove vent
bm = bmesh.new()
M.chamfer_block(bm, -HW - 0.3, -HD - 0.35, HW + 0.3, HD + 0.3, ZR, ZR + 0.18, ch=0.03)
M.conc_part(bm, 'roof', 'concrete_bunker', (0.8, 0.8, 0.77))
bm = bmesh.new()
K.cyl_bm(bm, V((1.0, 0.8, ZR + 0.18)), V((1.0, 0.8, ZR + 0.85)), 0.06, 8)
K.cyl_bm(bm, V((1.0, 0.8, ZR + 0.85)), V((1.0, 0.8, ZR + 0.93)), 0.13, 8)
K.part(bm, 'steel_painted', name='vent', mat_tint=(0.24, 0.24, 0.23), grime=1.0, bisect=False)

# gate-control desk inside: cabinet, two long levers (one thrown), handwheel, indicator dial
bm = bmesh.new()
K.box_bm(bm, (0.55, -HD + T + 0.35, 0.5), (1.3, 0.5, 1.0))
K.part(bm, 'steel_painted', name='desk', mat_tint=(0.32, 0.38, 0.34), grime=0.7, bisect=False)
bm = bmesh.new()
for x, lean in ((0.2, 0.25), (0.6, -0.35)):
    K.cyl_bm(bm, V((x, -HD + T + 0.35, 1.0)), V((x, -HD + T + 0.35 + lean * 0.6, 1.75)), 0.025, 6)
    K.cyl_bm(bm, V((x, -HD + T + 0.35 + lean * 0.6, 1.72)), V((x, -HD + T + 0.35 + lean * 0.65, 1.82)), 0.04, 8)
w0 = V((1.0, -HD + T + 0.12, 1.25))
for k in range(10):
    a0, a1 = k * math.pi / 5, (k + 1) * math.pi / 5
    K.cyl_bm(bm, w0 + V((0.22 * math.cos(a0), 0, 0.22 * math.sin(a0))), w0 + V((0.22 * math.cos(a1), 0, 0.22 * math.sin(a1))), 0.018, 5)
K.cyl_bm(bm, w0, w0 + V((0, 0.2, 0)), 0.03, 6)
K.part(bm, 'cast_iron', name='levers', grime=0.3, bisect=False)
bm = bmesh.new()
K.cyl_bm(bm, V((0.4, -HD + T + 0.1, 1.15)), V((0.4, -HD + T + 0.13, 1.15)), 0.12, 14)
K.part(bm, 'steel_painted', name='dial', mat_tint=(0.85, 0.82, 0.72), bisect=False, lod='drop')
bm = bmesh.new()                                          # dark interior volume (reads through the glass)
K.box_bm(bm, (0, 0, ZR - 0.04), (2 * HW - 2 * T, 2 * HD - 2 * T, 0.04))
K.box_bm(bm, (0, 0, 0.02), (2 * HW - 2 * T, 2 * HD - 2 * T, 0.04))
K.part(bm, 'interior_dark', name='interior', grime=0, bisect=False)

# outside: telephone box, lamp over the door, cable conduit, enamel board
bm = bmesh.new()
K.box_bm(bm, (HW + 0.09, 0.6, 1.45), (0.16, 0.36, 0.5))
K.cyl_bm(bm, V((HW + 0.05, 1.0, 0.05)), V((HW + 0.05, 1.0, ZR + 0.1)), 0.03, 6)
K.part(bm, 'steel_painted', name='phone_box', mat_tint=(0.3, 0.33, 0.3), grime=0.8, bisect=False)
K.wall_lantern(door.p(0.0, 0.0, 0.0), door.n, 2.3)
K.sign((HW - 0.75, -HD - 0.02, ZR - 0.25), (0, -1, 0), 0.8, kind='wache', name='board')

for nrm, (cx, cy), w in (((0, -1, 0), (0, -HD - 0.006), 2 * HW), ((0, 1, 0), (0, HD + 0.006), 2 * HW),
                         ((-1, 0, 0), (-HW - 0.006, 0), 2 * HD), ((1, 0, 0), (HW + 0.006, 0), 2 * HD)):
    K.decal('damp_base', (cx, cy, 0.3), nrm, w * 0.95, 0.55, alpha=0.7)
    K.decal(r.choice(['efflorescence', 'streak_rain', 'streak_long']), (cx + (r.uniform(-0.3, 0.3) * w if nrm[0] == 0 else 0),
            cy + (r.uniform(-0.3, 0.3) * w if nrm[1] == 0 else 0), 0.7), nrm, 0.7, 0.8, alpha=0.55)
for k in range(2):
    K.decal(r.choice(['lichen', 'stain_blotch']), (r.uniform(-1, 1), r.uniform(-0.8, 0.8), ZR + 0.185), (0, 0, 1), 0.9, 0.7, up=(0, 1, 0), alpha=0.5)

K.footprint(poly, 'HIGH', 'building')
K.anchor('lever', (0.4, -HD + T + 0.35, 1.0), (0, -1, 0), kind='lever')
M.finalize(M.outdir(K.A().name), ao_res=512, ao_samples=48)
