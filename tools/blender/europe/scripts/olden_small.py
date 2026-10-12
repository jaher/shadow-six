"""M19 Oldenburg small structures.
 p  coal_hopper_de   4 x 4 x 5 coal bunker hopper on a creosoted timber trestle: riveted steel bin heaped with coal,
                     a slide gate and a chute to the conveyor foot (NE), ladder and a plank catwalk
 r  bunker_obs_de    5 m round surveillance bunker (Ringstand type): board-marked grey concrete drum, a thick chamfered
                     roof with the observer's open ring hatch (steel rail, lid hinged up), vision slits all round, a sunken N entrance
 o  outhouse_de      1.5 x 1.5 plank privy with a pent tar-paper roof and a heart in the door
 d  drum_stack_de    2.5 x 5 oil drums by the conveyor: 21 upright on two pallets, 8 lying on top, chocked
 c  coal_heap_de     5 x 5 x 1.6 coal heap: lumpy slumped cone of black coal with slack at the toe, lumps and a shovel
 q  pit_props_de     4 x 1.4 stack of debarked pine pit props (Grubenholz) on bearers, chained, with a few loose ones
 n  kennel_de        1.6 x 1.4 dog kennel: gabled box on skids, arched hole, chain post and a tin bowl
usage: blender -b --python olden_small.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from od_common import *
use_cheap_doors()

ROOT, VAR, SEED = args('p')
NAME = {'p': 'coal_hopper_de', 'r': 'bunker_obs_de', 'o': 'outhouse_de', 'n': 'kennel_de', 'd': 'drum_stack_de', 'c': 'coal_heap_de', 'q': 'pit_props_de'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()


def ring_pts(rad, n=24, z=0.0, a0=0.0):
    return [V((rad * math.cos(a0 + 2 * math.pi * k / n), rad * math.sin(a0 + 2 * math.pi * k / n), z)) for k in range(n)]


def sq(h, z):
    return [V((-h, -h, z)), V((h, -h, z)), V((h, h, z)), V((-h, h, z))]


if VAR == 'p':
    ZB, ZT = 2.3, 4.6                                    # bin bottom / top
    legs = [(sx * 1.75, sy * 1.75) for sx in (-1, 1) for sy in (-1, 1)]
    posts(legs, 0.0, ZT - 0.2, 0.3)
    bm = bmesh.new()
    for (x, y) in legs:
        K.box_bm(bm, (x, y, 0.12), (0.6, 0.6, 0.35))
    K.part(bm, 'concrete_board', name='footings', mat_tint=(0.6, 0.6, 0.58), grime=1.8)
    braces([((-1.75, sy * 1.75, 0.3), (1.75, sy * 1.75, ZB - 0.2)) for sy in (-1, 1)] +
           [((sx * 1.75, -1.75, ZB - 0.2), (sx * 1.75, 1.75, 0.3)) for sx in (-1, 1)], 0.16)
    bm = bmesh.new()                                     # cap beams under the bin
    for s in (-1, 1):
        K.beam_bm(bm, (-1.9, s * 1.75, ZB + 0.6), (1.9, s * 1.75, ZB + 0.6), 0.3, 0.3)
        K.beam_bm(bm, (s * 1.75, -1.9, ZB + 0.9), (s * 1.75, 1.9, ZB + 0.9), 0.3, 0.3)
    K.part(bm, 'timber_creosote', name='caps', mat_tint=(0.45, 0.4, 0.36), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()                                     # the bin: square funnel + vertical upper box
    C.loft_bm(bm, [sq(0.35, ZB), sq(1.95, ZB + 1.2), sq(1.95, ZT)], close_start=True, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'paint_metal', name='bin', mat_tint=(0.3, 0.26, 0.23), grime=2.0)
    bm = bmesh.new()                                     # rivet bands + corner angles
    for z in (ZB + 1.25, ZT - 0.05):
        for a, b in zip(sq(1.99, z), sq(1.99, z)[1:] + sq(1.99, z)[:1]):
            K.beam_bm(bm, a, b, 0.08, 0.1)
    for c in sq(1.97, 0):
        K.beam_bm(bm, (c.x, c.y, ZB + 1.2), (c.x, c.y, ZT), 0.1, 0.1)
    K.part(bm, 'paint_metal', name='bands', mat_tint=(0.2, 0.18, 0.16), grime=2.2)
    bm = bmesh.new()                                     # heaped coal in the bin (lumpy cone)
    n = 20
    rings = [ring_pts(1.9, n, ZT - 0.15), ring_pts(1.3, n, ZT + 0.25), ring_pts(0.5, n, ZT + 0.5)]
    for rg in rings[1:]:
        for p in rg:
            p.z += r.uniform(-0.08, 0.08); p.x *= r.uniform(0.92, 1.08); p.y *= r.uniform(0.92, 1.08)
    C.loft_bm(bm, rings, close_start=True, close_end=True)
    K.part(bm, 'gravel_grey', name='coal', mat_tint=(0.2, 0.2, 0.21), grime=0.0, smooth=True)
    bm = bmesh.new()                                     # slide gate + chute towards the conveyor foot (NE)
    K.box_bm(bm, (0, 0, ZB - 0.15), (0.8, 0.8, 0.3))
    d = V((1, 1, 0)).normalized()
    K.beam_bm(bm, (0.2, 0.2, ZB - 0.3), (2.2, 2.2, 1.0), 0.75, 0.08)
    for s in (-1, 1):
        o = V((-d.y, d.x, 0)) * 0.37 * s
        K.beam_bm(bm, (0.2 + o.x, 0.2 + o.y, ZB - 0.15), (2.2 + o.x, 2.2 + o.y, 1.15), 0.05, 0.3)
    K.part(bm, 'steel_painted', name='chute', mat_tint=(0.3, 0.27, 0.24), grime=2.0)
    bm = bmesh.new()
    K.beam_bm(bm, (0.25, 0.25, ZB - 0.24), (2.15, 2.15, 1.09), 0.6, 0.05)
    K.part(bm, 'rubble_stone', name='chute_coal', mat_tint=(0.08, 0.08, 0.08), grime=0.0, lod='drop')
    # catwalk on the W side at the bin top, with a ladder down the SW leg
    bm = bmesh.new()
    K.box_bm(bm, (-2.35, 0, ZT - 0.3), (0.7, 3.8, 0.08))
    K.part(bm, 'deck_planks', name='catwalk', mat_tint=(0.5, 0.46, 0.4))
    K.railing((-2.68, -1.9, ZT - 0.26), (-2.68, 1.9, ZT - 0.26), 1.0, 'pipe', name='cat_rail')
    K.ladder((-2.2, -2.05, 0.0), ZT - 0.3, (0, -1, 0), 0.45, 0.0, 'timber_grey', name='ladder', meta=False)
    K.sign((0, -2.0, ZB + 2.0), (0, -1, 0), 1.0, 'achtung_minen' if False else 'halt_sperrgebiet', board='timber_grey')
    K.footprint(rect(-2.0, -2.0, 2.0, 2.0), 'HIGH', 'building')

if VAR == 'r':
    RO, H, N = 2.3, 1.75, 28
    bm = bmesh.new()
    C.loft_bm(bm, [ring_pts(RO + 0.2, N, -0.15), ring_pts(RO + 0.1, N, 0.3), ring_pts(RO, N, 0.45), ring_pts(RO, N, H)])
    K.part(bm, 'concrete_formwork', name='wall', mat_tint=(0.72, 0.72, 0.7), grime=1.0)
    bm = bmesh.new()                                     # roof slab, chamfered, overhang 0.25, with the observer's
    rings = [ring_pts(RO + 0.25, N, H - 0.02), ring_pts(RO + 0.25, N, H + 0.3), ring_pts(RO - 0.2, N, H + 0.55),   # ring hatch
             ring_pts(0.9, N, H + 0.58), ring_pts(0.8, N, H + 0.74), ring_pts(0.62, N, H + 0.74), ring_pts(0.62, N, H - 0.25)]
    C.loft_bm(bm, rings, close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'concrete_bunker', name='roof', mat_tint=(0.7, 0.7, 0.68), grime=0.9)
    bm = bmesh.new()                                     # steel rail round the hatch (MG / periscope mount)
    C.loft_bm(bm, [ring_pts(0.66, 16, H + 0.75), ring_pts(0.66, 16, H + 0.82), ring_pts(0.6, 16, H + 0.82), ring_pts(0.6, 16, H + 0.75)],
              close_start=False, close_end=False)
    K.part(bm, 'paint_metal', name='hatch_rail', mat_tint=(0.3, 0.32, 0.28), grime=0.8)
    bm = bmesh.new()                                     # a steel lid hinged open on the N side of the hatch
    K.box_bm(bm, (0, 0.95, H + 1.05), (1.0, 0.06, 0.6))
    K.part(bm, 'paint_metal', name='hatch_lid', mat_tint=(0.36, 0.38, 0.32), grime=0.8)
    for k, hdeg in enumerate((-90, -30, -150, 30, 150)):  # vision slits round the drum (none at the N door)
        a = math.radians(hdeg); c, s = math.cos(a), math.sin(a)
        o = V((c * (RO + 0.01), s * (RO + 0.01), 1.15))
        bm = bmesh.new()
        K.box_bm(bm, o, (0.7, 0.1, 0.16), rot_z=a + math.pi / 2)
        K.part(bm, 'interior_dark', name='slit%d' % k, mat_tint=(0.05, 0.05, 0.05))
        bm = bmesh.new()
        K.box_bm(bm, o + V((c * 0.05, s * 0.05, 0.16)), (0.95, 0.12, 0.12), rot_z=a + math.pi / 2)
        K.part(bm, 'concrete_formwork', name='hood%d' % k, mat_tint=(0.66, 0.66, 0.63))
        K.anchor('mg', (o.x, o.y, 1.15), (c, s, 0), kind='mg_post')
    bm = bmesh.new()                                     # sunken N entrance: two cheek walls, steps and a steel door
    for x in (-0.7, 0.7):
        K.box_bm(bm, (x, RO + 0.6, 0.35), (0.2, 1.4, 0.9))
    K.part(bm, 'concrete_formwork', name='cheeks', mat_tint=(0.68, 0.68, 0.65))
    bm = bmesh.new()
    K.box_bm(bm, (0, RO + 0.02, 0.85), (0.9, 0.06, 1.6))
    for z in (0.35, 0.85, 1.35):
        K.box_bm(bm, (0, RO + 0.06, z), (0.85, 0.04, 0.05))
    K.part(bm, 'steel_painted', name='door', mat_tint=(0.3, 0.32, 0.28))
    bm = bmesh.new()                                     # a ring of earth banked against the S half
    C.loft_bm(bm, [ring_pts(RO + 1.2, N, 0.0), ring_pts(RO + 0.25, N, 0.75)], close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in list(bm.faces):
        if f.calc_center_median().y > 0.3:
            bm.faces.remove(f)
    K.part(bm, 'mud', name='berm', mat_tint=(0.55, 0.5, 0.42), grime=0.3)
    for i in range(4):
        a = r.uniform(-math.pi, 0)
        K.decal('streak_rain', (math.cos(a) * (RO + 0.02), math.sin(a) * (RO + 0.02), 1.1), (math.cos(a), math.sin(a), 0), 0.8, 1.0, alpha=0.4)
    K.footprint([(p.x, p.y) for p in ring_pts(2.5, 12)], 'HIGH', 'bunker')

if VAR == 'o':
    P = rect(-0.7, -0.7, 0.7, 0.7)
    door = K.opening(P, 0, 0.7, 0.7, 1.8, 0.12, 0.05, 'rect', 'door')
    bm = bmesh.new()
    K.box_bm(bm, (0, 0, 0.06), (1.5, 1.5, 0.12))
    K.part(bm, 'timber_creosote', name='sill', mat_tint=(0.45, 0.4, 0.35))
    K.wall_ring(P, 2.05, 0.05, 'boards_weathered', [door], z0=0.12, name='walls', mat_tint=(0.6, 0.55, 0.48), grime=1.0,
                footprint=False)
    bm = bmesh.new()                                     # the rake: the front wall rises to the pent roof
    K.hexa_bm(bm, [V((-0.7, -0.7, 2.17)), V((0.7, -0.7, 2.17)), V((0.7, -0.65, 2.17)), V((-0.7, -0.65, 2.17)),
                   V((-0.7, -0.7, 2.45)), V((0.7, -0.7, 2.45)), V((0.7, -0.65, 2.45)), V((-0.7, -0.65, 2.45))])
    for xs in (-0.675, 0.675):
        K.hexa_bm(bm, [V((xs - 0.025, -0.7, 2.17)), V((xs + 0.025, -0.7, 2.17)), V((xs + 0.025, 0.7, 2.17)), V((xs - 0.025, 0.7, 2.17)),
                       V((xs - 0.025, -0.7, 2.45)), V((xs + 0.025, -0.7, 2.45)), V((xs + 0.025, 0.7, 2.19)), V((xs - 0.025, 0.7, 2.19))])
    K.part(bm, 'boards_weathered', name='rake', mat_tint=(0.6, 0.55, 0.48))
    K.roof_shed(-0.7, -0.7, 0.7, 0.7, 2.17, 2.5, 'tar_paper', low_side='+y', oh=0.18, name='roof', thick=0.05)
    K.door(door, 'front', 'plank', (0.42, 0.38, 0.3), step=None)
    bm = bmesh.new()                                     # the heart cut in the door: a dark inlay just proud of the leaf
    for k in range(10):
        t = 2 * math.pi * k / 10
        hx = 0.06 * 16 * math.sin(t) ** 3 / 16
        hz = 0.06 * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 16
        K.box_bm(bm, (hx, -0.74, 1.62 + hz), (0.035, 0.012, 0.035))
    K.part(bm, 'interior_dark', name='heart', mat_tint=(0.04, 0.04, 0.04))
    K.footprint(rect(-0.75, -0.75, 0.75, 0.75), 'HIGH', 'hut')

if VAR == 'n':
    L, W = 1.5, 1.2
    P = rect(-L / 2, -W / 2, L / 2, W / 2)
    hole = K.opening(P, 0, L * 0.38, 0.42, 0.55, 0.12, 0.05, 'arch', 'door')
    bm = bmesh.new()
    for y in (-0.45, 0.45):
        K.box_bm(bm, (0, y, 0.05), (L + 0.1, 0.1, 0.1))
    K.part(bm, 'timber_creosote', name='skids', mat_tint=(0.45, 0.4, 0.35))
    K.wall_ring(P, 0.75, 0.04, 'boards_weathered', [hole], z0=0.1, name='walls', mat_tint=(0.62, 0.5, 0.38), grime=1.0, footprint=False)
    zr = 0.85 + (W / 2) * math.tan(math.radians(35))
    for e in (1, 3):
        K.gable(P, e, 0.85, zr, 0.04, 'boards_weathered', [], name='gable%d' % e, mat_tint=(0.62, 0.5, 0.38))
    K.roof_gable(0, 0, L, W, 0.85, 35, 'tar_paper', eave_oh=0.12, gable_oh=0.1, thick=0.04, fascia=None, barge='timber_beam',
                 gutters=False, sag=0.0, wobble=0.0)
    bm = bmesh.new()
    K.box_bm(bm, (hole.o.x, -W / 2 + 0.02, 0.4), (0.44, 0.02, 0.56))
    K.part(bm, 'interior_dark', name='hole_dark', mat_tint=(0.03, 0.03, 0.03))
    bm = bmesh.new()                                     # chain post and a tin bowl in front of it
    K.cyl_bm(bm, (0.5, -1.0, 0.0), (0.5, -1.0, 0.45), 0.05, 6)
    K.part(bm, 'timber_grey', name='post', mat_tint=(0.5, 0.48, 0.44))
    bm = bmesh.new()
    K.cyl_bm(bm, (-0.3, -0.9, 0.0), (-0.3, -0.9, 0.08), 0.13, 12, r1=0.1)
    K.beam_bm(bm, (0.5, -1.0, 0.4), (hole.o.x, -0.7, 0.3), 0.02, 0.02)
    K.part(bm, 'steel_galv', name='bowl_chain', mat_tint=(0.55, 0.55, 0.55))
    K.footprint(rect(-0.8, -0.7, 0.8, 0.7), 'LOW', 'hut')

if VAR == 'd':
    cols = [(0.3, 0.33, 0.24), (0.5, 0.2, 0.15), (0.28, 0.3, 0.32), (0.45, 0.4, 0.2)]
    bm = bmesh.new()
    for y in (-1.25, 1.25):
        K.box_bm(bm, (0, y, 0.07), (2.3, 2.4, 0.14))
    K.part(bm, 'timber_beam', name='pallets', mat_tint=(0.55, 0.48, 0.38))
    groups = {k: bmesh.new() for k in range(len(cols))}
    for i in range(3):
        for j in range(7):
            if (i, j) == (2, 6):
                continue
            x, y = -0.7 + 0.7 * i + r.uniform(-0.04, 0.04), -2.1 + 0.7 * j + r.uniform(-0.04, 0.04)
            b = groups[int(r.random() * len(cols))]
            K.cyl_bm(b, (x, y, 0.14), (x, y, 1.02), 0.29, 14)
            for z in (0.43, 0.73):
                K.cyl_bm(b, (x, y, 0.14 + z - 0.02), (x, y, 0.14 + z + 0.02), 0.3, 14)
    for i in range(2):
        for j in range(4):
            x, y = -0.35 + 0.7 * i, -1.55 + 0.98 * j + r.uniform(-0.04, 0.04)
            b = groups[int(r.random() * len(cols))]
            K.cyl_bm(b, (x, y - 0.42, 1.32), (x, y + 0.42, 1.32), 0.29, 14)
            for e in (-0.14, 0.14):
                K.cyl_bm(b, (x, y + e - 0.02, 1.32), (x, y + e + 0.02, 1.32), 0.3, 14)
    for k, b in groups.items():
        K.part(b, 'paint_metal', name='drums%d' % k, mat_tint=cols[k], grime=1.6, smooth=True)
    bm = bmesh.new()
    for x in (-0.35, 0.35):
        for y in (-2.0, 1.85):
            K.box_bm(bm, (x, y, 1.1), (0.5, 0.1, 0.12))
    K.part(bm, 'timber_beam', name='chocks', mat_tint=(0.5, 0.44, 0.36))
    for i in range(3):
        K.decal('stain_rust_blotch', (r.uniform(-0.8, 0.8), -2.45, 0.5), (0, -1, 0), 0.6, 0.6, alpha=0.5)
    K.footprint(rect(-1.25, -2.5, 1.25, 2.5), 'HIGH', 'crates')

if VAR == 'c':
    import random
    rr = random.Random(SEED)
    R0, H0, N = 2.55, 1.6, 34                             # heightfield heap: slumped cone, a shoulder, ragged toe
    def hgt(x, y):
        a = math.atan2(y, x); rad = math.hypot(x, y)
        edge = R0 * (1 + 0.1 * math.sin(3 * a + 1.3) + 0.06 * math.sin(5 * a + 0.4))
        t = rad / edge
        if t >= 1:
            return 0.0
        z = H0 * (1 - t ** 1.25) * (1 + 0.12 * math.sin(2 * a))
        z += 0.07 * math.sin(x * 3.1 + y * 1.7) * math.cos(y * 2.9 - x) * (1 - t)
        return max(0.0, z)
    bm = bmesh.new()
    vs = {}
    for i in range(N + 1):
        for j in range(N + 1):
            x, y = -R0 * 1.25 + 2.5 * R0 * i / N, -R0 * 1.25 + 2.5 * R0 * j / N
            vs[i, j] = bm.verts.new((x, y, hgt(x, y) + rr.uniform(-0.02, 0.02) * (hgt(x, y) > 0)))
    for i in range(N):
        for j in range(N):
            q = [vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]]
            if all(v.co.z <= 0.0 for v in q):
                continue
            bm.faces.new(q)
    K.part(bm, 'gravel_grey', name='heap', mat_tint=(0.2, 0.2, 0.21), grime=0.0, smooth=True)
    bm = bmesh.new()                                     # lumps (glinting anthracite) all over the slopes and the toe
    for i in range(160):
        a, t = rr.uniform(0, 2 * math.pi), rr.uniform(0.05, 1.05) ** 0.7
        x, y = math.cos(a) * R0 * t, math.sin(a) * R0 * t
        sz = rr.uniform(0.06, 0.17)
        K.box_bm(bm, (x, y, hgt(x, y) + sz * 0.15), (sz * 1.3, sz, sz * 0.8), rot_z=rr.uniform(0, 3))
    K.part(bm, 'paint_metal', name='lumps', mat_tint=(0.09, 0.09, 0.1), grime=0.0)
    bm = bmesh.new()                                     # a coal shovel stuck in the flank
    K.beam_bm(bm, (1.25, -0.85, 0.75), (1.7, -1.2, 1.8), 0.04, 0.04)
    K.box_bm(bm, (1.2, -0.82, 0.62), (0.26, 0.04, 0.3), rot_z=-0.66)
    K.part(bm, 'timber_beam', name='shovel', mat_tint=(0.5, 0.42, 0.3), lod='drop')
    K.footprint([(math.cos(2 * math.pi * k / 14) * R0, math.sin(2 * math.pi * k / 14) * R0) for k in range(14)], 'LOW', 'heap')

if VAR == 'q':
    bm = bmesh.new()
    for x in (-1.3, 0.0, 1.3):
        K.box_bm(bm, (x, 0, 0.07), (0.16, 1.4, 0.14))
    K.part(bm, 'timber_creosote', name='bearers', mat_tint=(0.4, 0.36, 0.32))
    bm = bmesh.new()
    rows = ((0.27, 6, 0.0), (0.7, 5, 0.11), (1.1, 4, 0.22))
    for (z, cnt, off) in rows:
        for k in range(cnt):
            y = -0.55 + off + k * 0.22 + r.uniform(-0.02, 0.02)
            L = r.uniform(3.6, 4.0); dx = r.uniform(-0.15, 0.15)
            K.cyl_bm(bm, (-L / 2 + dx, y, z), (L / 2 + dx, y, z), r.uniform(0.09, 0.12), 8)
    for k in range(3):                                   # a few loose props leaning on the stack
        y = -0.2 + k * 0.3
        K.cyl_bm(bm, (-1.6 + k * 1.2, -0.95, 0.05), (-1.3 + k * 1.2, -0.62, 0.95), 0.09, 8)
    K.part(bm, 'log_hewn', name='props', mat_tint=(0.86, 0.76, 0.6), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    for x in (-1.0, 1.0):
        K.beam_bm(bm, (x, -0.66, 0.15), (x, -0.62, 1.25), 0.02, 0.03)
        K.beam_bm(bm, (x, -0.62, 1.25), (x, 0.62, 1.25), 0.02, 0.03)
        K.beam_bm(bm, (x, 0.62, 1.25), (x, 0.66, 0.15), 0.02, 0.03)
    K.part(bm, 'cast_iron', name='chains', mat_tint=(0.3, 0.28, 0.26), lod='drop')
    K.footprint(rect(-2.0, -0.7, 2.0, 0.7), 'LOW', 'crates')

finish(os.path.join(ROOT, NAME), ao_res=512 if VAR in 'ondcq' else 1024)
