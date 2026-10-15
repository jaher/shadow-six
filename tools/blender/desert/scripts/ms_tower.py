"""M11 Maradah lattice structures.
water: `water_tower_legs` (S camp): a riveted steel tank (3.6 m, faded white) on four splayed angle-iron legs (4 x 4 m at the
       foot), girts and X bracing, a timber-decked catwalk with a railing round the tank foot, a caged ladder up the S leg,
       a riser pipe with a gate valve and a canvas fill hose, a drip-stained concrete apron, a jerrycan row. 4 x 4 x 10 m.
pump:  `windpump` (inner yard): an 8 m four-leg tapering lattice tower on concrete footings, an 18-blade 2.4 m wheel with a
       tail vane on a gearbox, the pump rod down the middle to a cased well head, a stone trough fed by a spout pipe,
       a small platform under the head. 3 x 3 x 9 m.
Front (Blender -Y) = game S. Usage: blender -b --python ms_tower.py -- outdir [water|pump] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('water')
NAME = {'water': 'water_tower_legs_ms', 'pump': 'windpump_ms'}[VAR]
K.begin(NAME, 11201 + SEED, theater='desert')
r = K.rng()

if VAR == 'water':
    B, T, ZT = 1.85, 1.15, 6.6                      # leg half-spread at foot / top, tank floor z
    bot = [(-B, -B), (B, -B), (B, B), (-B, B)]
    top = [(-T, -T), (T, -T), (T, T), (-T, T)]
    footings(bot)
    lattice_tower(bot, top, 0.15, ZT, levels=3, w=0.14, name='legs')
    # deck: steel joists + timber catwalk ring with a railing
    bm = bmesh.new()
    for s in (-1, 1):
        C.box_bm(bm, (0, s * (T - 0.05), ZT + 0.06), (2 * T + 0.5, 0.16, 0.18))
        C.box_bm(bm, (s * (T - 0.05), 0, ZT + 0.06), (0.16, 2 * T + 0.5, 0.18))
    K.part(bm, 'paint_metal', name='joists', mat_tint=STEEL, grime=0.7, bisect=False)
    P = 1.95
    deck = rect(-P, -P, P, P)
    bm = bmesh.new()
    C.prism_bm(bm, deck, ZT + 0.15, ZT + 0.22)
    K.part(bm, 'deck_planks', name='catwalk', mat_tint=(0.82, 0.74, 0.62), grime=0.8, bisect=False)
    for e in range(4):
        a, b = deck[e], deck[(e + 1) % 4]
        if e == 0:   # gap at the ladder head (S, x -0.35..0.35)
            KD_rail = [((a[0], a[1], ZT + 0.22), (-0.35, a[1], ZT + 0.22)), ((0.35, a[1], ZT + 0.22), (b[0], b[1], ZT + 0.22))]
        else:
            KD_rail = [((a[0], a[1], ZT + 0.22), (b[0], b[1], ZT + 0.22))]
        for p0, p1 in KD_rail:
            K.railing(p0, p1, h=0.95, style='pipe', name='rail%d_%d' % (e, len(p0)))
    top_z = riveted_tank((0, 0), 1.75, ZT + 0.22, 2.9, tint=TANKW, name='tank', bands=3)
    # overflow + riser with a valve, fill hose hanging off the catwalk
    pipe([(0.6, 0.6, ZT + 0.15), (0.6, 0.6, 0.9), (0.6, 0.6, 0.35), (1.6, 0.6, 0.35)], r=0.07, name='riser')
    valve((0.6, 0.6, 0.9), axis=(0, 0, 1), name='riser_valve')
    pipe([(-1.0, -1.85, ZT + 2.8), (-1.0, -2.05, ZT + 2.8), (-1.0, -2.05, ZT + 0.5)], r=0.045, name='overflow', flanges=False)
    bm = bmesh.new()
    pts = [V((1.95, -0.8, ZT + 0.3)), V((2.2, -0.9, ZT - 1.5)), V((2.25, -1.0, 2.0)), V((2.3, -1.3, 0.25)), V((2.9, -1.6, 0.08))]
    for a, b in zip(pts, pts[1:]):
        C.cyl_bm(bm, a, b, 0.05, 6)
    K.part(bm, 'canvas', name='hose', mat_tint=(0.5, 0.45, 0.35), grime=0.8, bisect=False, smooth=True)
    cage_ladder(0, -B - 0.05, 0.0, ZT + 0.2, normal=(0, -1, 0), name='ladder')
    # apron, damp stain, jerrycans, a bucket
    bm = bmesh.new()
    C.prism_bm(bm, rect(-1.3, -1.3, 2.0, 1.3), 0.0, 0.08)
    K.part(bm, 'concrete_slab', name='apron', mat_tint=(0.85, 0.8, 0.72), grime=1.0, bisect=False)
    K.decal('stain_blotch', (0.9, 0.3, 0.09), (0, 0, 1), 1.6, 1.4, alpha=0.55)
    jerrycans((-1.0, 1.0, 0.08), n=4, rot=0.0, tint=(0.36, 0.4, 0.3))
    drums([(1.3, -0.6, 0.08)], tint=(0.3, 0.36, 0.3))
    for k in range(4):
        K.footprint(rect(bot[k][0] - 0.3, bot[k][1] - 0.3, bot[k][0] + 0.3, bot[k][1] + 0.3), 'LOW', 'tower_leg')
else:
    B, T, ZH = 1.35, 0.35, 7.6                      # foot half-spread, head half-width, head platform z
    bot = [(-B, -B), (B, -B), (B, B), (-B, B)]
    top = [(-T, -T), (T, -T), (T, T), (-T, T)]
    footings(bot, s=0.45, h=0.3)
    lattice_tower(bot, top, 0.1, ZH, levels=5, w=0.1, name='tower')
    bm = bmesh.new()
    C.prism_bm(bm, rect(-0.75, -0.75, 0.75, 0.75), ZH - 0.4, ZH - 0.34)
    K.part(bm, 'deck_planks', name='platform', mat_tint=(0.78, 0.7, 0.58), grime=0.8, bisect=False)
    # gearbox + mast pipe + wheel (facing S-SE into the prevailing wind), tail vane to the N
    hub = V((0, -0.55, ZH + 0.75))
    bm = bmesh.new()
    C.cyl_bm(bm, V((0, 0, ZH - 0.1)), V((0, 0, ZH + 0.6)), 0.09, 8)
    C.box_bm(bm, (0, -0.1, ZH + 0.72), (0.42, 0.75, 0.42))
    C.cyl_bm(bm, hub + V((0, 0.2, 0)), hub - V((0, 0.12, 0)), 0.1, 8)
    C.beam_bm(bm, (0, 0.2, ZH + 0.75), (0, 2.0, ZH + 0.85), 0.07, 0.07)
    K.part(bm, 'paint_metal', name='head', mat_tint=(0.45, 0.43, 0.4), grime=0.9, bisect=False)
    bm = bmesh.new()
    C.hexa_bm(bm, [V((-0.02, 1.4, ZH + 0.35)), V((0.02, 1.4, ZH + 0.35)), V((0.02, 2.6, ZH + 0.5)), V((-0.02, 2.6, ZH + 0.5)),
                   V((-0.02, 1.4, ZH + 1.2)), V((0.02, 1.4, ZH + 1.2)), V((0.02, 2.6, ZH + 1.45)), V((-0.02, 2.6, ZH + 1.45))])
    K.part(bm, 'steel_galv', name='vane', mat_tint=(0.82, 0.8, 0.74), grime=0.7, bisect=False)
    K.decal('streak_rust', (0.03, 2.0, ZH + 0.9), (1, 0, 0), 0.8, 0.6, alpha=0.6)
    bm = bmesh.new()
    R0, R1, NB = 0.35, 1.2, 18
    for ring_r in (0.55, R1):
        pts = [hub - V((0, 0.04, 0)) + V((ring_r * math.cos(2 * math.pi * i / 24), 0, ring_r * math.sin(2 * math.pi * i / 24))) for i in range(25)]
        for a, b in zip(pts, pts[1:]):
            C.cyl_bm(bm, a, b, 0.018, 4, caps=False)
    for i in range(6):
        a = 2 * math.pi * i / 6
        C.cyl_bm(bm, hub, hub + V((R1 * math.cos(a), -0.04, R1 * math.sin(a))), 0.016, 4)
    K.part(bm, 'paint_metal', name='wheel_frame', mat_tint=(0.4, 0.39, 0.36), grime=0.8, bisect=False)
    bm = bmesh.new()
    for i in range(NB):
        a = 2 * math.pi * i / NB
        ca, sa = math.cos(a), math.sin(a)
        tw = 0.28                                         # blade pitch: the leading edge forward
        q = []
        for rr_, half in ((R0, 0.06), (R1, 0.17)):
            for s in (-1, 1):
                ang = a + s * half / rr_
                q.append(hub + V((rr_ * math.cos(ang), -0.04 - s * tw * half, rr_ * math.sin(ang))))
        q8 = [q[0], q[1], q[3], q[2]]
        C.hexa_bm(bm, [p + V((0, -0.012, 0)) for p in q8] + [p + V((0, 0.012, 0)) for p in q8])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'steel_galv', name='blades', mat_tint=(0.86, 0.84, 0.78), grime=0.6, bisect=False)
    # pump rod, well casing, spout to a stone trough
    pipe([(0, 0, ZH - 0.4), (0, 0, 0.9)], r=0.025, name='rod', flanges=False)
    bm = bmesh.new()
    C.cyl_bm(bm, V((0, 0, 0)), V((0, 0, 0.9)), 0.14, 10)
    C.box_bm(bm, (0, 0, 0.07), (0.9, 0.9, 0.14))
    K.part(bm, 'cast_iron', name='well_head', mat_tint=(0.42, 0.4, 0.37), grime=0.9, bisect=False)
    pipe([(0, 0, 0.75), (0, -0.9, 0.75), (0, -1.55, 0.7)], r=0.04, name='spout', flanges=True)
    dz.trough((0, -1.95, 0), L=2.0, w=0.65, h=0.5, rot=0.0)
    K.decal('stain_blotch', (0, -1.95, 0.02), (0, 0, 1), 2.6, 1.3, alpha=0.5)
    for k in range(4):
        K.footprint(rect(bot[k][0] - 0.25, bot[k][1] - 0.25, bot[k][0] + 0.25, bot[k][1] + 0.25), 'LOW', 'tower_leg')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=32)
