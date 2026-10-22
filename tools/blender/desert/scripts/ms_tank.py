"""M11 Maradah `oil_tanks_vertical` process tank (quarry x2, yard x3), 3.5 m x 7 m: a riveted steel tank in sun-bleached
white on a concrete ring footing, four seam bands, a shallow cone roof with a manhole and a vent, a pipe handrail round
the roof edge, a caged ladder up the W side to a steel landing plate on the roof (the handrail open over the ladder: a
man climbs up and stands there — the sidecar's walkable `landing` roof + ladder), inlet + outlet pipes with flanges and
red-wheeled gate valves at the foot (running out E toward the rig), a level gauge board, a black crude run from the
outlet, oil-soaked sand.
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
CONE = lambda rho: ZR + R * 0.35 * (R + 0.06 - rho) / (R + 0.06 - 0.2)  # the cone roof's surface height at radius rho
GAP = 4                                                   # the rail segment left open: 162-198 deg, centred on the ladder (W)
for k in range(10):                                       # roof handrail posts + ring
    a0, a1 = 2 * math.pi * (k + 0.5) / 10, 2 * math.pi * (k + 1.5) / 10
    if k == GAP:
        continue                                          # gap at the ladder head (W)
    p0 = V(((R - 0.1) * math.cos(a0), (R - 0.1) * math.sin(a0), ZR))
    p1 = V(((R - 0.1) * math.cos(a1), (R - 0.1) * math.sin(a1), ZR))
    pipe([p0 + V((0, 0, 0.95)), p1 + V((0, 0, 0.95))], r=0.022, name='rail%d' % k, tint=(0.62, 0.6, 0.55), flanges=False)
    pipe([p0, p0 + V((0, 0, 0.95))], r=0.02, name='post%d' % k, tint=(0.62, 0.6, 0.55), flanges=False)
    if (k + 1) % 10 == GAP:                               # the rail's end post on the gap's near side
        pipe([p1, p1 + V((0, 0, 0.95))], r=0.02, name='post%de' % k, tint=(0.62, 0.6, 0.55), flanges=False)
# the landing: a level steel plate over the cone at the ladder head, its inner edge on the cone, its outer edge on two
# brackets; the walk grid's landing is the plate (a man stands on it, climbs back down the ladder)
LA, LR0, LR1 = math.radians(30), 0.98, R - 0.04          # half angle, inner / outer radius (to the shell's edge)
ZL = CONE(LR0) + 0.03                                    # plate top
sector = lambda r0, r1, h, n=7: ([(r1 * math.cos(math.pi - h + 2 * h * i / (n - 1)), r1 * math.sin(math.pi - h + 2 * h * i / (n - 1))) for i in range(n)]
                                 + [(r0 * math.cos(math.pi + h - 2 * h * i / (n - 1)), r0 * math.sin(math.pi + h - 2 * h * i / (n - 1))) for i in range(n)])
bm = bmesh.new()
C.prism_bm(bm, list(reversed(sector(LR0, LR1, LA))), ZL - 0.05, ZL)
for a in (math.pi - LA * 0.75, math.pi + LA * 0.75):     # brackets from the cone up to the plate's outer edge
    rb = LR1 - 0.12
    C.box_bm(bm, (rb * math.cos(a), rb * math.sin(a), (CONE(rb) + ZL - 0.05) / 2), (0.06, 0.06, ZL - 0.05 - CONE(rb) + 0.04))
K.part(bm, 'paint_metal', name='landing', mat_tint=(0.5, 0.48, 0.44), grime=0.9, bisect=False)
bm = bmesh.new()
C.cyl_bm(bm, V((-0.6, 0.4, ZR + 0.15)), V((-0.6, 0.4, ZR + 0.75)), 0.09, 8)
C.cyl_bm(bm, V((-0.6, 0.4, ZR + 0.75)), V((-0.6, 0.4, ZR + 0.85)), 0.18, 8)
K.part(bm, 'paint_metal', name='vent', mat_tint=(0.5, 0.48, 0.44), grime=0.9, bisect=False)
LX = -R - 0.18                                            # the ladder 0.18 m off the shell on brackets (toe room)
cage_ladder(LX, 0, 0.0, ZR + 0.1, normal=(-1, 0, 0), name='ladder', cage_from=2.4, rung_r=0.02)
bm = bmesh.new()
for zb in (0.9, 3.6, 6.3):
    for sy in (-0.22, 0.22):
        C.cyl_bm(bm, V((-R + 0.02, sy, zb)), V((LX, sy, zb)), 0.02, 5)
K.part(bm, 'paint_metal', name='ladder_brackets', mat_tint=STEEL, grime=0.6, bisect=False)
# game nav: the plate is a walkable roof (clear of the rail posts and the brackets' feet: inside 25 deg), the ladder
# from 0.6 m out at its foot to the plate's middle
K.roof_meta(sector(LR0 + 0.02, LR1 - 0.06, math.radians(25), 6), ZL, walkable=True, kind='landing')
K.ladder_meta((LX - 0.6, 0), (-(LR0 + LR1) / 2, 0), ZL)
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
