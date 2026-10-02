"""V-2 (A4) on its Meillerwagen (FR-Anhaenger) in the transport position (M20 Gundelfingen, building-inventory
`v2_meillerwagen`): a 14 m A4 in splinter camouflage lying in the erector cradle (three clamp rings, the folded
work platforms), twin longerons on a rear twin-wheel bogie and a front axle with an A-frame drawbar, the folded
hydraulic rams, chocks and a tarpaulin over the warhead. Variants: a (olive/sand splinter), b (dark green with a
canvas cover over the nose), destroyed (burnt-out: the rocket burst open, the cradle twisted, scorch).
Usage: blender -b --factory-startup --python v2_meillerwagen.py -- [a|b|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 211)
K.begin('v2_meillerwagen' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost')
r = K.rng()
DEAD = VAR == 'destroyed'
AX = 1.9                                     # rocket axis height in the cradle
X0 = -7.0                                     # tail (nozzle) end; the nose points east (+X) to the drawbar
MC = (0.53, 0.55, 0.42) if VAR != 'b' else (0.36, 0.4, 0.3)

# ------------------------------------------------------------------ chassis: longerons, cross members, axles, wheels
bm = bmesh.new()
for y in (-0.62, 0.62):
    K.ibeam_bm(bm, (-6.6, y, 0.95), (4.6, y, 0.95), 0.42, 0.24, up=(0, 0, 1))
for x in (-6.4, -4.2, -2.0, 0.2, 2.4, 4.4):
    K.beam_bm(bm, (x, -0.7, 1.0), (x, 0.7, 1.0), 0.14, 0.26)
for y in (-0.62, 0.62):                                                  # A-frame drawbar to the towing eye
    K.beam_bm(bm, (4.6, y, 1.0), (7.0, 0.0, 0.75), 0.14, 0.16)
K.cyl_bm(bm, (7.0, 0, 0.75), (7.35, 0, 0.75), 0.09, 8)
for x in (-5.6, -4.3, 4.0):                                              # axles
    K.beam_bm(bm, (x, -1.25, 0.56), (x, 1.25, 0.56), 0.12, 0.12)
    K.beam_bm(bm, (x, -0.62, 0.62), (x, -0.62, 0.95), 0.12, 0.12)
    K.beam_bm(bm, (x, 0.62, 0.62), (x, 0.62, 0.95), 0.12, 0.12)
K.part(bm, 'steel_painted', name='mw_chassis', mat_tint=MC, grime=0.8)
bm = bmesh.new()
for x, lats in ((-5.6, (-1.15, -0.88, 0.88, 1.15)), (-4.3, (-1.15, -0.88, 0.88, 1.15)), (4.0, (-1.12, 1.12))):
    for y in lats:
        K.cyl_bm(bm, (x, y - 0.12, 0.55), (x, y + 0.12, 0.55), 0.53, 14)
K.part(bm, 'cast_iron', name='mw_tyres', mat_tint=(0.24, 0.24, 0.24), smooth=True, grime=0.6)
bm = bmesh.new()
for x, lats in ((-5.6, (-1.28, 1.28)), (-4.3, (-1.28, 1.28)), (4.0, (-1.25, 1.25))):
    for y in lats:
        K.cyl_bm(bm, (x, y - 0.03, 0.55), (x, y + 0.03, 0.55), 0.3, 10)
K.part(bm, 'steel_painted', name='mw_hubs', mat_tint=MC, smooth=True)
bm = bmesh.new()                                                         # mudguards over the rear bogie
for y in (-1.02, 1.02):
    K.loft_bm(bm, [[V((-6.3 + 2.6 * k / 8, y + s * 0.2, 0.55 + 0.72 * math.sin(math.pi * k / 8))) for k in range(9)] for s in (-1, 1)],
              close_start=False, close_end=False)
K.part(bm, 'steel_painted', name='mw_guards', mat_tint=MC, grime=0.7, bisect=False)

# ------------------------------------------------------------------ erector cradle with clamp rings, rams
bm = bmesh.new()
for y in (-0.55, 0.55):
    K.ibeam_bm(bm, (-6.8, y, 1.3), (3.8, y, 1.3), 0.34, 0.2, up=(0, 0, 1))
for x in (-5.2, -0.6, 3.2):
    ring = [V((x, math.cos(a) * 0.9, AX + math.sin(a) * 0.9)) for a in [math.pi * (1.15 + 0.7 * k / 10) for k in range(11)]]
    for a, b in zip(ring[:-1], ring[1:]):
        K.beam_bm(bm, a, b, 0.2, 0.1)
    for s in (-1, 1):
        K.beam_bm(bm, (x, s * 0.55, 1.32), (x, s * 0.86, AX - 0.25), 0.1, 0.1)
for s in (-1, 1):                                                        # folded work platforms on the cradle sides
    K.box_bm(bm, (-1.6, s * 1.05, 1.42), (5.2, 0.5, 0.05))
K.part(bm, 'steel_painted', name='mw_cradle', mat_tint=MC, grime=0.7)
bm = bmesh.new()
for y in (-0.3, 0.3):
    K.cyl_bm(bm, (-6.2, y, 1.15), (-1.0, y, 1.22), 0.11, 8)
    K.cyl_bm(bm, (-1.0, y, 1.22), (1.6, y, 1.25), 0.065, 8)
K.part(bm, 'steel_galv', name='mw_rams', mat_tint=(0.85, 0.85, 0.8), smooth=True, grime=0.3)

# ------------------------------------------------------------------ the A4 (node 'rocket'), lying along +X
prof = [(0.0, 0.42), (0.05, 0.62), (0.4, 0.74), (1.5, 0.78), (3.2, 0.82), (4.6, 0.825), (8.2, 0.825), (9.6, 0.78),
        (10.8, 0.66), (11.9, 0.48), (12.9, 0.27), (13.6, 0.1), (14.0, 0.02)]
cols = [(0.5, 0.55, 0.38), (0.78, 0.74, 0.55)] if VAR != 'b' else [(0.3, 0.36, 0.26), (0.46, 0.48, 0.36)]
NS = 24
halves = {0: bmesh.new(), 1: bmesh.new()}
for i in range(len(prof) - 1):
    (s0, r0), (s1, r1) = prof[i], prof[i + 1]
    if DEAD and 5.5 < s0 < 9.0:
        continue                                                         # burst-open midsection
    for k in range(NS):
        a0, a1 = 2 * math.pi * k / NS, 2 * math.pi * (k + 1) / NS
        c = (k * 3 // NS + int((s0 + 0.9 * math.sin(k * 0.7 + s0 * 0.3)) / 2.6)) % 2 if VAR != 'b' else (k * 2 // NS + int(s0 / 3.2)) % 2  # splinter patches
        P = lambda s, rr, a: V((X0 + s, math.cos(a) * rr, AX + math.sin(a) * rr))
        q = [P(s0, r0, a0), P(s0, r0, a1), P(s1, r1, a1), P(s1, r1, a0)]
        if r1 < 0.03:
            q = q[:3]
        b = halves[c]
        b.faces.new([b.verts.new(p) for p in q])
for c, b in halves.items():
    bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-4)
    K.part(b, 'steel_painted', name='rocket_skin%d' % c, node='rocket', mat_tint=cols[c] if not DEAD else (0.18, 0.17, 0.16),
           smooth=True, grime=0.3 if not DEAD else 1.0, bisect=False)
bm = bmesh.new()                                                         # fins in the X position (clear the longerons)
for a in range(4):
    ang = math.pi / 4 + a * math.pi / 2
    d = V((0, math.cos(ang), math.sin(ang)))
    t = V((0, -d.z, d.y))
    root = [V((X0 + 0.35, 0, AX)) + d * 0.74, V((X0 + 3.4, 0, AX)) + d * 0.8]
    tip = [V((X0 + 0.02, 0, AX)) + d * 1.78, V((X0 + 1.45, 0, AX)) + d * 1.78]
    q = [root[0], tip[0], tip[1], root[1]]
    K.hexa_bm(bm, [p - t * 0.04 for p in q] + [p + t * 0.04 for p in q])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'steel_painted', name='rocket_fins', node='rocket', mat_tint=cols[0] if not DEAD else (0.15, 0.14, 0.13), grime=0.4)
bm = bmesh.new()
K.cyl_bm(bm, (X0 + 0.1, 0, AX), (X0 - 0.25, 0, AX), 0.42, 16, r1=0.36)
K.part(bm, 'cast_iron', name='rocket_nozzle', node='rocket', smooth=True)
if VAR == 'b':                                                           # canvas cover lashed over the nose
    bm = bmesh.new()
    K.cyl_bm(bm, (X0 + 9.4, 0, AX), (X0 + 14.2, 0, AX), 0.9, 18, r1=0.25)
    K.part(bm, 'tent_canvas', name='nose_cover', node='rocket', mat_tint=(0.62, 0.6, 0.48), smooth=True, grime=0.6)
K.anchor('v2', (0, 0, AX), (1, 0, 0), kind='v2_rocket', height=AX + 0.9, bomb_target=True)

# ------------------------------------------------------------------ chocks, jerricans, destroyed dressing
bm = bmesh.new()
for x in (-6.25, -3.65):
    for y in (-1.0, 1.0):
        K.box_bm(bm, (x, y, 0.13), (0.3, 0.4, 0.26), 0, taper=(0.5, 1.0))
K.part(bm, 'timber_beam', name='chocks', mat_tint=(0.5, 0.42, 0.33))
if DEAD:
    M.rubble((0.5, 0.0, 0), 3.8, 0.5, mids=('steel_painted', 'cast_iron'), n=30, beams=0, tiles=None)
    for k in range(3):
        K.decal('soot', (r.uniform(-3, 3), r.uniform(-1, 1), 0.04 + k * 0.001), (0, 0, 1), 9, 5, up=(1, 0, 0), alpha=0.95)
    K.anchor('fire', (0.5, 0, 1.2), kind='fire_large')
else:
    K.decal('soot', (-7.4, 0, 0.03), (0, 0, 1), 1.8, 1.6, up=(1, 0, 0), alpha=0.35)

# ------------------------------------------------------------------ metadata
K.footprint([(-7.3, -1.45), (7.4, -1.45), (7.4, 1.45), (-7.3, 1.45)], 'HIGH', 'meillerwagen')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
