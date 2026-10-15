"""M11 Maradah `oil_tanks_vertical` process tank (quarry x2, yard x3), 3.5 m x 7 m: a riveted steel tank in sun-bleached
white on a concrete ring footing, four seam bands, a shallow cone roof with a manhole and a vent, a pipe handrail round
the roof edge, a caged ladder up the W side, inlet + outlet pipes with flanges and red-wheeled gate valves at the foot
(running out E toward the rig), a level gauge board, a black crude run from the outlet, oil-soaked sand.
Front (Blender -Y) = game S. Usage: blender -b --python ms_tank.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('a')
NAME = 'oil_tank_process_ms'
K.begin(NAME, 11701 + SEED, theater='desert')
r = K.rng()
R, Z0, H = 1.72, 0.35, 6.6
CRUDE = (0.11, 0.095, 0.075)

bm = bmesh.new()
C.cyl_bm(bm, V((0, 0, 0)), V((0, 0, Z0)), R + 0.3, 24, r1=R + 0.2)
K.part(bm, 'concrete_aggregate', name='footing', mat_tint=(0.86, 0.8, 0.7), grime=0.9, bisect=False)
top = riveted_tank((0, 0), R, Z0, H, tint=TANKW, name='tank', bands=4, roof='cone')
ZR = Z0 + H
for k in range(10):                                       # roof handrail posts + ring
    a0, a1 = 2 * math.pi * k / 10, 2 * math.pi * (k + 1) / 10
    if k == 5:
        continue                                          # gap at the ladder head (W)
    p0 = V(((R - 0.1) * math.cos(a0), (R - 0.1) * math.sin(a0), ZR))
    p1 = V(((R - 0.1) * math.cos(a1), (R - 0.1) * math.sin(a1), ZR))
    pipe([p0 + V((0, 0, 0.95)), p1 + V((0, 0, 0.95))], r=0.022, name='rail%d' % k, tint=(0.62, 0.6, 0.55), flanges=False)
    pipe([p0, p0 + V((0, 0, 0.95))], r=0.02, name='post%d' % k, tint=(0.62, 0.6, 0.55), flanges=False)
bm = bmesh.new()
C.cyl_bm(bm, V((-0.6, 0.4, ZR + 0.15)), V((-0.6, 0.4, ZR + 0.75)), 0.09, 8)
C.cyl_bm(bm, V((-0.6, 0.4, ZR + 0.75)), V((-0.6, 0.4, ZR + 0.85)), 0.18, 8)
K.part(bm, 'paint_metal', name='vent', mat_tint=(0.5, 0.48, 0.44), grime=0.9, bisect=False)
cage_ladder(-R - 0.05, 0, 0.0, ZR + 0.1, normal=(-1, 0, 0), name='ladder', cage_from=2.4)
# inlet high on the E side down to a valve, outlet low on the S-E with a valve, both running E
pipe([(R + 0.02, -0.5, Z0 + 5.6), (R + 0.45, -0.5, Z0 + 5.6), (R + 0.45, -0.5, 0.5), (R + 1.2, -0.5, 0.5)], r=0.09, name='inlet')
valve((R + 0.45, -0.5, 1.35), axis=(0, 0, 1), r=0.09, name='inlet_valve')
pipe([(R * 0.7, -R * 0.7 - 0.02, Z0 + 0.45), (R + 0.6, -R * 0.75, Z0 + 0.45), (R + 1.2, -R * 0.75, 0.45)], r=0.11, name='outlet')
valve((R + 0.35, -R * 0.74, 0.45), axis=(1, 0, 0), r=0.11, name='outlet_valve')
bm = bmesh.new()                                          # pipe saddles
for y in (-0.5, -R * 0.75):
    C.box_bm(bm, (R + 1.0, y, 0.2), (0.25, 0.3, 0.4))
K.part(bm, 'concrete_aggregate', name='saddles', mat_tint=(0.82, 0.76, 0.66), grime=0.9, bisect=False)
bm = bmesh.new()                                          # level gauge board up the S face
C.box_bm(bm, (0.5, -R - 0.06, Z0 + 3.3), (0.12, 0.05, 5.6))
C.box_bm(bm, (0.5, -R - 0.09, Z0 + 2.2), (0.18, 0.04, 0.12))
K.part(bm, 'wood_paint', name='gauge', mat_tint=(0.25, 0.25, 0.22), grime=0.6, bisect=False)
dz.patch_quad([(R - 0.6, -R - 0.9, 0), (R + 1.6, -R - 0.7, 0), (R + 1.4, -R + 0.6, 0), (R - 0.2, -R + 0.9, 0)], 'mud', 'crude', tint=CRUDE, lift=0.02)
K.decal('streak_long', (R * 0.72, -R * 0.72, Z0 + 0.9), (0.7, -0.7, 0), 0.6, 1.2, alpha=0.6)
for k in range(3):
    a = math.pi * (1.6 + 0.3 * k)
    K.decal('stain_blotch', (R * 1.005 * math.cos(a), R * 1.005 * math.sin(a), Z0 + 0.6), (math.cos(a), math.sin(a), 0), 1.0, 0.8, alpha=0.45)
ring = [(R * 1.0 * math.cos(2 * math.pi * k / 12), R * 1.0 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
K.footprint(ring, 'HIGH', 'tank')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=32)
