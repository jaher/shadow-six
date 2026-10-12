"""M19 V-2 (A4) launch pad pieces, split to match the mission's three gameplay structures per pad.
 R  v2_rocket_a4   the 14 m A4 upright, base at the firing-table ring (1.35 m): ogive warhead, tapered tail, four fins with
                   rudder fairings and aerial masts, graphite jet vanes, olive/sand splinter camouflage, access hatches,
                   the black tail ring, panel seams; footprint = the 1.7 m body
 T  v2_table_de    6 x 6 concrete pad (expansion joints, soot fan) with the Brennstand: box-girder frame on four screw-jack
                   legs, rotating ring, pyramid blast deflector; cable trough, fuel-hose manifold and a cable drum
 G  v2_gantry_de   1.6 x 1.6 x 15.5 servicing tower: riveted steel lattice, three work platforms cantilevered west
                   towards the rocket with railings, an inside ladder, a hoist beam over the warhead
J  crane_jib_de   2.5 x 2.5 yard derrick: 7 m riveted lattice mast on a concrete plinth, a 5 m lattice jib slewed E over the
                   rail end with its stay, hook block and chain, a hand winch with a cog train and a counterweight box
usage: blender -b --python v2_kit.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from od_common import *

ROOT, VAR, SEED = args('R')
NAME = {'R': 'v2_rocket_a4', 'T': 'v2_table_de', 'G': 'v2_gantry_de', 'J': 'crane_jib_de'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
ZT = 1.35


def ring(rad, z, n=24):
    return [V((math.cos(2 * math.pi * k / n) * rad, math.sin(2 * math.pi * k / n) * rad, z)) for k in range(n)]


if VAR == 'R':
    prof = [(0.0, 0.42), (0.05, 0.62), (0.4, 0.74), (1.5, 0.78), (3.2, 0.82), (4.6, 0.825), (8.2, 0.825), (9.6, 0.78),
            (10.8, 0.66), (11.9, 0.48), (12.9, 0.27), (13.6, 0.1), (14.0, 0.02)]
    NS = 28
    cols = [(0.4, 0.45, 0.29), (0.66, 0.62, 0.46), (0.27, 0.31, 0.21)]   # olive, sand, dark green splinter
    hull, tail = bmesh.new(), bmesh.new()
    for i in range(len(prof) - 1):
        (z0, r0), (z1, r1) = prof[i], prof[i + 1]
        sub = max(1, int((z1 - z0) / 0.7))
        for s in range(sub):
            za, zb = z0 + (z1 - z0) * s / sub, z0 + (z1 - z0) * (s + 1) / sub
            ra, rb = r0 + (r1 - r0) * s / sub, r0 + (r1 - r0) * (s + 1) / sub
            for k in range(NS):
                a0, a1 = 2 * math.pi * k / NS, 2 * math.pi * (k + 1) / NS
                q = [V((math.cos(a0) * ra, math.sin(a0) * ra, ZT + za)), V((math.cos(a1) * ra, math.sin(a1) * ra, ZT + za)),
                     V((math.cos(a1) * rb, math.sin(a1) * rb, ZT + zb)), V((math.cos(a0) * rb, math.sin(a0) * rb, ZT + zb))]
                if rb < 0.03:
                    q = q[:3]
                b = tail if za < 0.45 else hull                  # black tail ring / painted skin
                b.faces.new([b.verts.new(p) for p in q])
    for b in (hull, tail):
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-4)
    # splinter camouflage (as on operational A4s, Splittertarn-like): the skin is sliced by a dozen oblique planes, each
    # one a straight diagonal line on the body; every cell of that arrangement takes one colour, so the patches are
    # irregular angular polygons with straight edges (no grid, no 'pixel' blocks). Olive and dark green dominate.
    import random
    rr = random.Random(SEED * 7919 + 13)
    planes = []
    for i in range(12):
        th, ph = rr.uniform(0.45, 1.15), rr.uniform(0, 2 * math.pi)
        planes.append((V((0, 0, ZT + rr.uniform(0.8, 12.6))), V((math.cos(ph) * math.sin(th), math.sin(ph) * math.sin(th), math.cos(th))),
                       rr.random()))
    for co, n, _w in planes:
        bmesh.ops.bisect_plane(hull, geom=hull.verts[:] + hull.edges[:] + hull.faces[:], plane_co=co, plane_no=n)
    parts = {0: bmesh.new(), 1: bmesh.new(), 2: bmesh.new()}
    for f in hull.faces:
        c = f.calc_center_median()
        h = sum(w for co, n, w in planes if (c - co).dot(n) > 0) % 1.0
        col = 0 if h < 0.45 else 2 if h < 0.8 else 1
        b = parts[col]
        b.faces.new([b.verts.new(v.co) for v in f.verts])
    cols = [(0.4, 0.45, 0.29), (0.66, 0.62, 0.46), (0.27, 0.31, 0.21)]   # olive, sand, dark green
    for c, b in parts.items():
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-4)
        K.part(b, 'paint_metal', name='skin%d' % c, mat_tint=cols[c], smooth=True, grime=0.25, bisect=False)
    K.part(tail, 'paint_metal', name='skin_tail', mat_tint=(0.1, 0.1, 0.1), smooth=True, grime=0.25, bisect=False)
    bm = bmesh.new()                                         # panel seams: thin proud rings at the section joints
    for z, rr in ((0.45, 0.745), (3.2, 0.825), (8.2, 0.83), (10.8, 0.665), (12.9, 0.275)):
        C.loft_bm(bm, [ring(rr + 0.012, ZT + z - 0.03, NS), ring(rr + 0.012, ZT + z + 0.03, NS)], close_start=False, close_end=False)
    K.part(bm, 'paint_metal', name='seams', mat_tint=(0.18, 0.2, 0.15), grime=0.3)
    bm = bmesh.new()                                         # access hatches on the S and E faces
    for (z, ang, w, h) in ((5.6, -math.pi / 2, 0.5, 0.7), (9.0, -math.pi / 2, 0.4, 0.5), (6.8, 0.2, 0.45, 0.6), (2.2, -0.9, 0.35, 0.45)):
        rr = 0.83 if z < 8.3 else 0.79
        K.box_bm(bm, (math.cos(ang) * rr, math.sin(ang) * rr, ZT + z), (0.03, w, h), rot_z=ang)
    K.part(bm, 'paint_metal', name='hatches', mat_tint=(0.3, 0.34, 0.23), grime=0.4)
    bm = bmesh.new()                                         # fins + rudder fairings + aerial masts at the tips
    for a in range(4):
        ang = a * math.pi / 2
        d = V((math.cos(ang), math.sin(ang), 0)); t = V((-d.y, d.x, 0))
        root = [d * 0.74 + V((0, 0, ZT + 0.35)), d * 0.8 + V((0, 0, ZT + 3.4))]
        tip = [d * 1.78 + V((0, 0, ZT + 0.02)), d * 1.78 + V((0, 0, ZT + 1.45))]
        q = [root[0], tip[0], tip[1], root[1]]
        K.hexa_bm(bm, [p - t * 0.045 for p in q] + [p + t * 0.045 for p in q])
        K.box_bm(bm, tuple(d * 1.5 + V((0, 0, ZT + 0.12))), (0.32, 0.26, 0.24), ang)        # rudder fairing
        K.cyl_bm(bm, d * 1.78 + V((0, 0, ZT + 1.45)), d * 1.8 + V((0, 0, ZT + 2.05)), 0.018, 4)  # aerial mast
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'paint_metal', name='fins', mat_tint=cols[0], grime=0.35)
    bm = bmesh.new()
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        d = V((math.cos(ang), math.sin(ang), 0))
        K.box_bm(bm, tuple(d * 0.3 + V((0, 0, ZT - 0.08))), (0.26, 0.05, 0.38), ang + math.pi / 2)   # graphite jet vanes
    K.cyl_bm(bm, (0, 0, ZT + 0.12), (0, 0, ZT - 0.15), 0.42, 16, r1=0.36)
    K.part(bm, 'cast_iron', name='nozzle_vanes', smooth=True, mat_tint=(0.2, 0.2, 0.2))
    K.decal('streak_rain', (0, -0.84, ZT + 7.0), (0, -1, 0), 0.6, 3.0, alpha=0.25)
    K.anchor('v2', (0, 0, ZT), (0, -1, 0), kind='v2_rocket', height=14.0, bomb_target=True)
    K.footprint([(p.x, p.y) for p in ring(0.85, 0, 12)], 'HIGH', 'building')

if VAR == 'T':
    bm = bmesh.new()
    for i in range(3):                                       # 6 x 6 pad cast in nine bays (expansion joints show)
        for j in range(3):
            K.box_bm(bm, (-2 + 2 * i, -2 + 2 * j, -0.02), (1.97, 1.97, 0.18))
    K.part(bm, 'concrete_slab', name='pad', mat_tint=(0.74, 0.74, 0.72), grime=0.6)
    for k in range(3):
        K.decal('soot', (r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), 0.075 + k * 0.001), (0, 0, 1), 3.8 + k * 1.0, 3.8 + k * 1.0,
                up=(math.cos(k), math.sin(k), 0), alpha=0.5)
    for i in range(4):
        K.decal('crack', (r.uniform(-2.5, 2.5), r.uniform(-2.5, 2.5), 0.072), (0, 0, 1), 1.2, 1.2, up=(0, 1, 0), alpha=0.4)
    bm = bmesh.new()
    H2 = 1.55
    for sx in (-1, 1):
        K.beam_bm(bm, (sx * H2, -H2, 1.0), (sx * H2, H2, 1.0), 0.22, 0.3)
        K.beam_bm(bm, (-H2, sx * H2, 1.0), (H2, sx * H2, 1.0), 0.22, 0.3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            top, foot = V((sx * H2, sy * H2, 0.95)), V((sx * 2.4, sy * 2.4, 0.07))
            K.beam_bm(bm, top, foot, 0.2, 0.2)
            K.cyl_bm(bm, foot, foot + V((0, 0, 0.35)), 0.11, 8)
            K.cyl_bm(bm, foot, foot + V((0, 0, 0.05)), 0.3, 8)
    for a in range(4):
        d = V((math.cos(math.pi / 4 + a * math.pi / 2), math.sin(math.pi / 4 + a * math.pi / 2), 0))
        K.beam_bm(bm, d * 1.2 + V((0, 0, 1.18)), d * H2 * 1.41 + V((0, 0, 1.05)), 0.16, 0.16)
    C.loft_bm(bm, [ring(1.05, 1.15), ring(1.35, 1.15), ring(1.35, ZT), ring(1.05, ZT)], close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'paint_metal', name='table', mat_tint=(0.48, 0.47, 0.4), grime=0.8)
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, 0.07), (0, 0, 1.05), 1.3, 4, r1=0.02)
    K.part(bm, 'steel_galv', name='deflector', mat_tint=(0.35, 0.32, 0.3), grime=0.9)
    bm = bmesh.new()                                         # cable trough to the E edge + a hose manifold, a cable drum
    K.box_bm(bm, (2.2, 0.9, 0.12), (1.6, 0.3, 0.12))
    K.part(bm, 'concrete_board', name='trough', mat_tint=(0.55, 0.55, 0.52))
    bm = bmesh.new()
    K.cyl_bm(bm, (-2.2, -2.3, 0.07), (-2.2, -2.3, 0.6), 0.1, 8)
    K.box_bm(bm, (-2.2, -2.3, 0.62), (0.5, 0.18, 0.12))
    K.part(bm, 'steel_painted', name='manifold', mat_tint=(0.55, 0.45, 0.2))
    bm = bmesh.new()
    pts = [V((-2.2, -2.3, 0.6)), V((-1.8, -1.9, 0.1)), V((-1.1, -1.2, 0.1)), V((-0.7, -0.7, 1.0))]
    for a, b in zip(pts, pts[1:]):
        K.cyl_bm(bm, a, b, 0.06, 6)
    K.part(bm, 'cast_iron', name='hose', mat_tint=(0.12, 0.12, 0.12))
    bm = bmesh.new()
    K.cyl_bm(bm, (2.25, -2.3, 0.55), (2.25, -1.8, 0.55), 0.5, 14)
    K.cyl_bm(bm, (2.25, -2.28, 0.55), (2.25, -1.82, 0.55), 0.3, 12)
    K.part(bm, 'timber_beam', name='cable_drum', mat_tint=(0.5, 0.42, 0.32), lod='drop')
    K.footprint(rect(-3, -3, 3, 3), 'NONE', 'building')

if VAR == 'G':
    HW, HT = 0.75, 15.2
    cs = [(sx * HW, sy * HW) for sx in (-1, 1) for sy in (-1, 1)]
    bm = bmesh.new()
    for (x, y) in cs:                                        # corner angles on base plates
        K.box_bm(bm, (x, y, HT / 2), (0.14, 0.14, HT))
        K.box_bm(bm, (x, y, 0.04), (0.45, 0.45, 0.08))
    lv = [0.3 + k * 1.85 for k in range(9)]
    for z in lv:                                             # horizontal girts all round
        for a, b in zip(cs[0:1] + cs[1:2] + cs[3:4] + cs[2:3], cs[1:2] + cs[3:4] + cs[2:3] + cs[0:1]):
            K.beam_bm(bm, (a[0], a[1], z), (b[0], b[1], z), 0.08, 0.1)
    order = [cs[0], cs[1], cs[3], cs[2]]
    for z0, z1 in zip(lv, lv[1:]):                           # X-bracing in every bay of every face
        for a, b in zip(order, order[1:] + order[:1]):
            K.beam_bm(bm, (a[0], a[1], z0), (b[0], b[1], z1), 0.05, 0.05)
            K.beam_bm(bm, (b[0], b[1], z0), (a[0], a[1], z1), 0.05, 0.05)
    K.part(bm, 'paint_metal', name='lattice', mat_tint=(0.36, 0.39, 0.32), grime=0.7)
    bm = bmesh.new()                                         # three work platforms towards the rocket (W) + the top deck
    for z in (4.0, 7.7, 11.4):
        K.box_bm(bm, (-HW - 0.35, 0, z), (1.2, 1.9, 0.06))
        K.beam_bm(bm, (-HW, -0.9, z - 0.7), (-HW - 0.9, -0.9, z - 0.05), 0.06, 0.06)
        K.beam_bm(bm, (-HW, 0.9, z - 0.7), (-HW - 0.9, 0.9, z - 0.05), 0.06, 0.06)
    K.box_bm(bm, (0, 0, HT + 0.03), (1.8, 1.8, 0.06))
    K.part(bm, 'steel_grating', name='platforms', mat_tint=(0.5, 0.5, 0.46))
    for z in (4.0, 7.7, 11.4):
        K.railing((-HW - 0.92, -0.92, z + 0.03), (-HW - 0.92, 0.92, z + 0.03), 1.0, 'pipe', name='rail%d' % int(z))
    K.railing((-0.88, 0.88, HT + 0.06), (0.88, 0.88, HT + 0.06), 1.0, 'pipe', name='rail_top_n')
    K.railing((0.88, -0.88, HT + 0.06), (0.88, 0.88, HT + 0.06), 1.0, 'pipe', name='rail_top_e')
    K.ladder((0.5, 0.79, 0.0), HT, (0, 1, 0), 0.4, 0.0, 'steel_painted', name='ladder', meta=False)
    bm = bmesh.new()                                         # hoist beam over the warhead with block and hook
    K.beam_bm(bm, (0.6, 0, HT + 0.5), (-3.0, 0, HT + 0.5), 0.16, 0.24)
    K.beam_bm(bm, (0.0, 0, HT + 0.06), (0.0, 0, HT + 0.4), 0.16, 0.16)
    K.beam_bm(bm, (-1.2, 0, HT + 0.4), (0.0, 0, HT + 0.06), 0.08, 0.08)
    K.box_bm(bm, (-2.4, 0, HT + 0.2), (0.2, 0.14, 0.3))
    K.cyl_bm(bm, (-2.4, 0, HT + 0.05), (-2.4, 0, HT - 0.9), 0.01, 4)
    K.part(bm, 'steel_painted', name='hoist', mat_tint=(0.55, 0.45, 0.2), grime=0.7)
    bm = bmesh.new()                                         # cables / hoses looping down the W face
    pts = [V((-HW - 0.1, 0.5, 11.3)), V((-HW - 0.2, 0.5, 7.0)), V((-HW - 0.15, 0.45, 3.0)), V((-HW - 0.3, 0.3, 0.1))]
    for a, b in zip(pts, pts[1:]):
        K.cyl_bm(bm, a, b, 0.04, 6)
    K.part(bm, 'cast_iron', name='cables', mat_tint=(0.1, 0.1, 0.1), lod='drop')
    K.footprint(rect(-0.8, -0.8, 0.8, 0.8), 'HIGH', 'building')

if VAR == 'J':
    HW, HT = 0.55, 7.0
    bm = bmesh.new()
    K.box_bm(bm, (0, 0, 0.2), (2.4, 2.4, 0.5))
    K.part(bm, 'concrete_board', name='plinth', mat_tint=(0.62, 0.62, 0.6), grime=1.4)
    bm = bmesh.new()
    cs = [(-HW, -HW), (HW, -HW), (HW, HW), (-HW, HW)]
    for (x, y) in cs:
        K.beam_bm(bm, (x * 1.5, y * 1.5, 0.45), (x, y, HT), 0.12, 0.12)
    lv = [0.45 + k * 1.3 for k in range(6)]
    for z in lv:
        f = 1.5 - 0.5 * (z - 0.45) / (HT - 0.45)
        for a, b in zip(cs, cs[1:] + cs[:1]):
            K.beam_bm(bm, (a[0] * f, a[1] * f, z), (b[0] * f, b[1] * f, z), 0.07, 0.07)
    for z0, z1 in zip(lv, lv[1:]):
        f0, f1 = 1.5 - 0.5 * (z0 - 0.45) / (HT - 0.45), 1.5 - 0.5 * (z1 - 0.45) / (HT - 0.45)
        for a, b in zip(cs, cs[1:] + cs[:1]):
            K.beam_bm(bm, (a[0] * f0, a[1] * f0, z0), (b[0] * f1, b[1] * f1, z1), 0.04, 0.04)
    # the jib: two chords + lacing from the mast head out 5 m E, the stay back to the mast top
    ja, jb = V((0.4, 0, HT - 1.2)), V((5.2, 0, HT + 0.2))
    for sy in (-0.25, 0.25):
        K.beam_bm(bm, ja + V((0, sy, 0)), jb + V((0, sy * 0.4, 0)), 0.08, 0.1)
    for k in range(8):
        t0, t1 = k / 8, (k + 1) / 8
        p0, p1 = ja.lerp(jb, t0), ja.lerp(jb, t1)
        K.beam_bm(bm, p0 + V((0, -0.25 * (1 - 0.6 * t0), 0)), p1 + V((0, 0.25 * (1 - 0.6 * t1), 0)), 0.035, 0.035)
    K.beam_bm(bm, (0, 0, HT + 1.0), jb, 0.05, 0.05)
    K.beam_bm(bm, (0, 0, HT), (0, 0, HT + 1.1), 0.12, 0.12)
    K.part(bm, 'paint_metal', name='lattice', mat_tint=(0.24, 0.24, 0.22), grime=1.3)
    bm = bmesh.new()                                         # hook block + chain hanging over the rail end
    K.cyl_bm(bm, (5.1, 0, HT + 0.1), (5.1, 0, HT - 2.6), 0.015, 4)
    K.box_bm(bm, (5.1, 0, HT - 2.75), (0.2, 0.12, 0.3))
    K.cyl_bm(bm, (5.1, 0, HT - 2.9), (5.1, 0, HT - 3.15), 0.05, 6)
    K.part(bm, 'cast_iron', name='hook', mat_tint=(0.2, 0.2, 0.2))
    bm = bmesh.new()                                         # hand winch on the mast + counterweight box on a back arm
    K.box_bm(bm, (-0.75, 0, 1.3), (0.2, 0.7, 0.6))
    K.cyl_bm(bm, (-0.75, -0.4, 1.3), (-0.75, 0.4, 1.3), 0.18, 12)
    K.cyl_bm(bm, (-0.75, -0.45, 1.3), (-0.75, -0.48, 1.3), 0.38, 16)
    K.beam_bm(bm, (-0.75, 0.42, 1.3), (-0.75, 0.62, 1.55), 0.03, 0.03)
    K.beam_bm(bm, (-0.3, 0, HT - 1.0), (-1.6, 0, HT - 0.8), 0.1, 0.12)
    K.box_bm(bm, (-1.6, 0, HT - 1.15), (0.6, 0.6, 0.6))
    K.part(bm, 'paint_metal', name='winch', mat_tint=(0.3, 0.28, 0.22), grime=1.4)
    K.footprint(rect(-1.25, -1.25, 1.25, 1.25), 'HIGH', 'building')

finish(os.path.join(ROOT, NAME), ao_res=1024)
