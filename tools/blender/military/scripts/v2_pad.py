"""V-2 (A4) field launch site (M19 Oldenburg / M20): Brennstand firing table (square frame on screw-jack legs, rotating
ring, pyramidal blast deflector) on a concrete pad, a 14 m A4 rocket in splinter camouflage (separate node 'rocket'),
steel lattice servicing gantry on rails with three cantilever work platforms, railings, ladder and hoist beam,
fuel/ oxidiser hoses, cable reels, drums. Variants: a (olive splinter), test (black/white quadrant test scheme),
destroyed (rocket exploded: bent table, gantry toppled across the pad, scorched crater, debris).
Usage: blender -b --factory-startup --python v2_pad.py -- [a|test|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 101)
K.begin('v2_pad' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost')
r = K.rng()
DEAD = VAR == 'destroyed'
ZT = 1.35                                   # top of the firing-table ring = rocket base
STEEL = (0.5, 0.52, 0.47)
TABLE = (0.62, 0.6, 0.5)                    # Brennstand in lighter field-grey primer so it reads under the rocket

# ------------------------------------------------------------------ concrete pad + scorch
bm = bmesh.new()
PAD = [(math.cos(2 * math.pi * k / 24) * 7.0, math.sin(2 * math.pi * k / 24) * 7.0) for k in range(24)]
K.prism_bm(bm, PAD, -0.1, 0.06)
K.part(bm, 'concrete_bunker', name='pad', tint=(0.78, 0.78, 0.76), grime=0.5, lod='keep')
for k in range(4):
    K.decal('soot', (r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), 0.075 + k * 0.001), (0, 0, 1), 5.5 + k * 1.8, 5.5 + k * 1.8,
            up=(math.cos(k), math.sin(k), 0), alpha=0.9 if DEAD else 0.55)
for i in range(6):
    K.decal('crack', (r.uniform(-5, 5), r.uniform(-5, 5), 0.07), (0, 0, 1), 1.4, 1.4, up=(0, 1, 0), alpha=0.4)

# ------------------------------------------------------------------ firing table (Brennstand)
table0 = len(K.A().parts)
bm = bmesh.new()
H2 = 1.9
for sx in (-1, 1):                                              # square frame (box girders) + diagonal legs with jacks
    K.beam_bm(bm, (sx * H2, -H2, 1.0), (sx * H2, H2, 1.0), 0.22, 0.3)
    K.beam_bm(bm, (-H2, sx * H2, 1.0), (H2, sx * H2, 1.0), 0.22, 0.3)
for sx in (-1, 1):
    for sy in (-1, 1):
        top = V((sx * H2, sy * H2, 0.95))
        foot = V((sx * 2.8, sy * 2.8, 0.06))
        K.beam_bm(bm, top, foot, 0.2, 0.2)
        K.cyl_bm(bm, foot, foot + V((0, 0, 0.35)), 0.11, 8)
        K.cyl_bm(bm, foot, foot + V((0, 0, 0.05)), 0.3, 8)
for a in range(4):                                              # radial arms to the ring
    d = V((math.cos(math.pi / 4 + a * math.pi / 2), math.sin(math.pi / 4 + a * math.pi / 2), 0))
    K.beam_bm(bm, d * 1.2 + V((0, 0, 1.18)), d * H2 * 1.41 + V((0, 0, 1.05)), 0.16, 0.16)
K.loft_bm(bm, [[V((math.cos(2 * math.pi * k / 24) * rr, math.sin(2 * math.pi * k / 24) * rr, z)) for k in range(24)]
               for rr, z in ((1.05, 1.15), (1.35, 1.15), (1.35, ZT), (1.05, ZT))], close_start=False, close_end=False)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'steel_painted', name='table', mat_tint=TABLE, grime=0.8)
bm = bmesh.new()                                                # steel blast plate under the table + jack pads
K.prism_bm(bm, [(math.cos(math.pi / 4 + k * math.pi / 2) * 3.4, math.sin(math.pi / 4 + k * math.pi / 2) * 3.4) for k in range(4)], 0.05, 0.09)
K.part(bm, 'cast_iron', name='blast_plate', grime=0.9, mat_tint=(0.7, 0.66, 0.6))
bm = bmesh.new()                                                # blast deflector: 4-sided pyramid, point up
K.cyl_bm(bm, (0, 0, 0.09), (0, 0, 1.05), 1.35, 4, r1=0.02)
K.part(bm, 'steel_galv', name='deflector', mat_tint=(0.35, 0.32, 0.3), grime=0.9)
table_parts = K.A().parts[table0:]

# ------------------------------------------------------------------ A4 rocket (node 'rocket')
if not DEAD:
    prof = [(0.0, 0.42), (0.05, 0.62), (0.4, 0.74), (1.5, 0.78), (3.2, 0.82), (4.6, 0.825), (8.2, 0.825), (9.6, 0.78),
            (10.8, 0.66), (11.9, 0.48), (12.9, 0.27), (13.6, 0.1), (14.0, 0.02)]
    NS = 24
    cols = [(0.5, 0.55, 0.38), (0.78, 0.74, 0.55)] if VAR != 'test' else [(0.1, 0.1, 0.1), (0.85, 0.84, 0.8)]
    halves = {0: bmesh.new(), 1: bmesh.new()}
    for i in range(len(prof) - 1):
        (z0, r0), (z1, r1) = prof[i], prof[i + 1]
        for k in range(NS):
            a0, a1 = 2 * math.pi * k / NS, 2 * math.pi * (k + 1) / NS
            if VAR == 'test':
                c = (k * 4 // NS + (1 if z0 > 5.5 else 0)) % 2
            else:                                               # splinter camo: diagonal bands
                c = int((k / NS * 6 + z0 * 0.45) % 2)
            b = halves[c]
            q = [V((math.cos(a0) * r0, math.sin(a0) * r0, ZT + z0)), V((math.cos(a1) * r0, math.sin(a1) * r0, ZT + z0)),
                 V((math.cos(a1) * r1, math.sin(a1) * r1, ZT + z1)), V((math.cos(a0) * r1, math.sin(a0) * r1, ZT + z1))]
            if r1 < 0.03:
                q = q[:3]
            b.faces.new([b.verts.new(p) for p in q])
    for c, b in halves.items():
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-4)
        K.part(b, 'steel_painted', name='rocket_skin%d' % c, node='rocket', mat_tint=cols[c], smooth=True, grime=0.3, bisect=False)
    bm = bmesh.new()                                            # fins (tapered plates) + rudders + graphite vanes + nozzle
    for a in range(4):
        ang = a * math.pi / 2
        d = V((math.cos(ang), math.sin(ang), 0))
        t = V((-d.y, d.x, 0))
        root = [d * 0.74 + V((0, 0, ZT + 0.35)), d * 0.8 + V((0, 0, ZT + 3.4))]
        tip = [d * 1.78 + V((0, 0, ZT + 0.02)), d * 1.78 + V((0, 0, ZT + 1.45))]
        q = [root[0], tip[0], tip[1], root[1]]
        K.hexa_bm(bm, [p - t * 0.04 for p in q] + [p + t * 0.04 for p in q])
        K.box_bm(bm, tuple(d * 1.5 + V((0, 0, ZT + 0.1))), (0.3, 0.3, 0.2), ang)
        K.box_bm(bm, tuple(d * 0.33 + V((0, 0, ZT - 0.05))), (0.28, 0.05, 0.4), ang + math.pi / 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'steel_painted', name='rocket_fins', node='rocket', mat_tint=cols[0], grime=0.3)
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, ZT + 0.1), (0, 0, ZT - 0.2), 0.42, 16, r1=0.36)
    K.part(bm, 'cast_iron', name='rocket_nozzle', node='rocket', smooth=True)
    K.anchor('v2', (0, 0, ZT), (0, -1, 0), kind='v2_rocket', height=14.0, bomb_target=True)

# ------------------------------------------------------------------ servicing gantry on rails (east of the rocket)
g0 = len(K.A().parts)
GX0, GW, GH = 2.2, 3.0, 16.0
bm = bmesh.new()
legs = [(GX0, -GW / 2), (GX0 + GW, -GW / 2), (GX0 + GW, GW / 2), (GX0, GW / 2)]
for x, y in legs:
    K.ibeam_bm(bm, (x, y, 0.45), (x, y, GH), 0.26, 0.2, up=(1, 0, 0))
lv = [0.5 + k * 3.1 for k in range(6)]
for i in range(4):
    (xa, ya), (xb, yb) = legs[i], legs[(i + 1) % 4]
    for z in lv:
        K.beam_bm(bm, (xa, ya, z), (xb, yb, z), 0.12, 0.12)
    for k in range(len(lv) - 1):
        if i == 3 and k % 2 == 0:
            continue                                            # rocket side: open bays for the work platforms
        K.beam_bm(bm, (xa, ya, lv[k]), (xb, yb, lv[k + 1]), 0.08, 0.08)
        K.beam_bm(bm, (xb, yb, lv[k]), (xa, ya, lv[k + 1]), 0.08, 0.08)
K.beam_bm(bm, (GX0 + GW / 2, 0, GH + 0.2), (-0.3, 0, GH + 0.2), 0.2, 0.3)          # hoist beam over the rocket
K.cyl_bm(bm, (-0.2, 0, GH + 0.05), (-0.2, 0, GH - 1.5), 0.012, 4)
K.box_bm(bm, (-0.2, 0, GH - 1.6), (0.25, 0.2, 0.25))
for x in (GX0 - 0.2, GX0 + GW + 0.2):                                             # base bogies
    K.box_bm(bm, (x, 0, 0.3), (0.5, GW + 0.9, 0.45))
    for y in (-GW / 2 - 0.2, GW / 2 + 0.2):
        K.cyl_bm(bm, (x - 0.3, y, 0.25), (x + 0.3, y, 0.25), 0.22, 10)
K.part(bm, 'steel_painted', name='gantry', mat_tint=STEEL, uv='beam', axis=(0, 0, 1), grime=0.7)
bm = bmesh.new()                                                # work platforms cantilevered toward the rocket
plats = [5.2, 9.3, 13.4]
for z in plats:
    K.box_bm(bm, (GX0 + GW / 2 - 0.9, 0, z), (GW + 1.8, GW + 0.4, 0.06))
    for y in (-GW / 2 - 0.2, GW / 2 + 0.2):
        K.beam_bm(bm, (GX0 - 1.8, y, z - 0.05), (GX0 + GW, y, z - 0.05), 0.08, 0.16)
        K.beam_bm(bm, (GX0 - 1.7, y, z - 0.1), (GX0, y, z - 1.4), 0.07, 0.07)
K.part(bm, 'steel_grating', name='platforms', grime=0.3, bisect=False)
for z in plats:
    for (a, b) in (((GX0 - 1.8, -GW / 2 - 0.2), (GX0 + GW, -GW / 2 - 0.2)), ((GX0 - 1.8, GW / 2 + 0.2), (GX0 + GW, GW / 2 + 0.2)),
                   ((GX0 + GW, -GW / 2 - 0.2), (GX0 + GW, GW / 2 + 0.2))):
        K.railing((a[0], a[1], z), (b[0], b[1], z), 1.0, 'pipe', name='plat_rail')
bm = bmesh.new()                                                # ladder on the east face
for s in (-1, 1):
    K.beam_bm(bm, (GX0 + GW + 0.25, s * 0.25, 0.0), (GX0 + GW + 0.25, s * 0.25, GH - 2.4), 0.05, 0.07)
for k in range(int((GH - 2.4) / 0.3)):
    z = 0.3 + k * 0.3
    K.cyl_bm(bm, (GX0 + GW + 0.25, -0.25, z), (GX0 + GW + 0.25, 0.25, z), 0.015, 4)
for k in range(int((GH - 4.4) / 0.9)):                          # safety cage hoops on the ladder
    z = 2.6 + k * 0.9
    c = V((GX0 + GW + 0.55, 0, z))
    for i in range(8):
        a0, a1 = -math.pi / 2 + math.pi * i / 8, -math.pi / 2 + math.pi * (i + 1) / 8
        K.cyl_bm(bm, c + V((math.cos(a0) * 0.38, math.sin(a0) * 0.38, 0)), c + V((math.cos(a1) * 0.38, math.sin(a1) * 0.38, 0)), 0.014, 4, caps=False)
for y in (-0.38, 0.0, 0.38):
    K.beam_bm(bm, (GX0 + GW + 0.55 + (0.38 if y == 0 else 0), y, 2.6), (GX0 + GW + 0.55 + (0.38 if y == 0 else 0), y, GH - 2.4), 0.03, 0.03)
K.part(bm, 'steel_painted', name='gantry_ladder', mat_tint=(0.75, 0.7, 0.45))
bm = bmesh.new()                                                # gusset plates at every lattice joint (legible at 1x)
for i in range(4):
    (xa, ya), (xb, yb) = legs[i], legs[(i + 1) % 4]
    o = V(((xa + xb) / 2 - (GX0 + GW / 2), (ya + yb) / 2, 0)).normalized()
    t = V((xb - xa, yb - ya, 0)).normalized()
    for z in lv:
        for (x, y), sgn in (((xa, ya), 1), ((xb, yb), -1)):
            c = V((x, y, z)) + o * 0.15 + t * sgn * 0.2
            K.box_bm(bm, tuple(c), (0.5, 0.02, 0.5), math.atan2(t.y, t.x))
K.part(bm, 'steel_painted', name='gussets', mat_tint=(0.58, 0.6, 0.54), grime=0.6, bisect=False)
gantry_parts = K.A().parts[g0:]
bm = bmesh.new()                                                # rails
for y in (-GW / 2 - 0.2, GW / 2 + 0.2):
    K.beam_bm(bm, (GX0 - 1.5, y, 0.08), (GX0 + 11, y, 0.08), 0.08, 0.14)
for k in range(20):
    x = GX0 - 1.2 + k * 0.62
    K.box_bm(bm, (x, 0, 0.04), (0.24, GW + 1.4, 0.1))
K.part(bm, 'timber_tarred', name='rails', uv='beam', axis=(0, 1, 0), lod='drop')

# ------------------------------------------------------------------ Meillerwagen (FR-Anhänger) erector, cradle raised against the rocket
mw0 = len(K.A().parts)
MD = V((-1, 1, 0)).normalized()                                   # trailer runs out to the north-west (behind the rocket, so the camera sees the A4 in front of the cradle)
MP = V((-MD.y, MD.x, 0))
MC = (0.53, 0.55, 0.42) if VAR != 'test' else (0.5, 0.52, 0.48)
def mp(d, lat, z):
    return MD * d + MP * lat + V((0, 0, z))
bm = bmesh.new()                                                  # erector cradle: two I-beam uprights, rungs, diagonals
for lat in (-0.62, 0.62):
    K.ibeam_bm(bm, mp(1.35, lat, 1.0), mp(1.35, lat, 14.2), 0.26, 0.18, up=tuple(MD))
for k in range(11):
    z = 1.4 + k * 1.25
    K.beam_bm(bm, mp(1.35, -0.62, z), mp(1.35, 0.62, z), 0.09, 0.12)
    if k < 10:
        K.beam_bm(bm, mp(1.35, -0.62, z), mp(1.35, 0.62, z + 1.25), 0.06, 0.06)
for z in (3.2, 7.4, 11.6):                                        # clamp arms round the rocket + folding work platforms
    for sgn in (-1, 1):
        K.beam_bm(bm, mp(1.35, sgn * 0.62, z), mp(0.35, sgn * 0.9, z), 0.08, 0.12)
    K.beam_bm(bm, mp(0.35, -0.9, z), mp(0.35, 0.9, z), 0.06, 0.1)
K.beam_bm(bm, mp(1.35, 0, 0.5), mp(2.6, 0, 0.9), 0.5, 0.5)       # hinge bracket at the table
K.part(bm, 'steel_painted', name='mw_cradle', mat_tint=MC, grime=0.7)
bm = bmesh.new()
for z in (4.6, 8.8, 13.0):
    K.box_bm(bm, tuple(mp(1.35, 0, z)), (1.3, 1.3, 0.05), math.atan2(MD.y, MD.x))
K.part(bm, 'steel_grating', name='mw_platforms', grime=0.3, bisect=False)
bm = bmesh.new()                                                  # chassis: twin longerons, cross members, drawbar, axles
for lat in (-0.85, 0.85):
    K.beam_bm(bm, mp(2.4, lat, 0.95), mp(13.2, lat, 0.95), 0.22, 0.42)
for d in (3.0, 5.5, 8.0, 10.5, 13.0):
    K.beam_bm(bm, mp(d, -0.9, 0.95), mp(d, 0.9, 0.95), 0.16, 0.3)
K.beam_bm(bm, mp(13.2, 0, 0.9), mp(15.4, 0, 0.55), 0.14, 0.14)
for d in (5.0, 6.3, 12.0):
    K.beam_bm(bm, mp(d, -1.25, 0.55), mp(d, 1.25, 0.55), 0.12, 0.12)
K.part(bm, 'steel_painted', name='mw_chassis', mat_tint=MC, grime=0.8)
bm = bmesh.new()
for d in (5.0, 6.3, 12.0):
    for lat in (-1.15, -0.85, 0.85, 1.15) if d < 7 else (-1.15, 1.15):
        K.cyl_bm(bm, mp(d, lat - 0.13, 0.55), mp(d, lat + 0.13, 0.55), 0.52, 12)
K.part(bm, 'cast_iron', name='mw_wheels', mat_tint=(0.35, 0.35, 0.33), smooth=True, grime=0.5)
bm = bmesh.new()                                                  # twin hydraulic erecting rams
for lat in (-0.45, 0.45):
    a, b = mp(5.2, lat, 1.1), mp(1.5, lat, 6.4)
    K.cyl_bm(bm, a, a.lerp(b, 0.55), 0.11, 8)
    K.cyl_bm(bm, a.lerp(b, 0.5), b, 0.06, 8)
K.part(bm, 'steel_galv', name='mw_rams', mat_tint=(0.85, 0.85, 0.8), smooth=True, grime=0.3)
mw_parts = K.A().parts[mw0:]
K.footprint([tuple(mp(2.4, -1.4, 0))[:2], tuple(mp(13.4, -1.4, 0))[:2], tuple(mp(13.4, 1.4, 0))[:2], tuple(mp(2.4, 1.4, 0))[:2]], 'HIGH', 'meillerwagen')
K.anchor('meillerwagen', tuple(mp(8.0, 0, 0)), tuple(-MD), kind='erector_trailer')

# ------------------------------------------------------------------ hoses, cable reels, drums, camouflage-net poles
bm = bmesh.new()
if not DEAD:
    for (sx, sy), zc, rr in (((-5.5, -2.5), 4.5, 0.09), ((1.0, -5.5), 2.2, 0.07)):
        pts = []
        for i in range(13):
            t = i / 12
            p = V((sx, sy, 0.1)).lerp(V((-0.95 * math.copysign(1, sx), 0.4 * math.copysign(1, sy), ZT + zc)), t)
            p.z = 0.1 + (ZT + zc) * t * t
            pts.append(p)
        for a, b in zip(pts[:-1], pts[1:]):
            K.cyl_bm(bm, a, b, rr, 6)
K.part(bm, 'cast_iron', name='hoses', smooth=True, grime=0.4)
bm = bmesh.new()                                                # timber cable drums (flanges + core)
for x, y in ((-5.5, -2.5), (1.0, -5.5)):
    for dy in (-0.38, 0.38):
        K.cyl_bm(bm, (x, y + dy - 0.03, 0.72), (x, y + dy + 0.03, 0.72), 0.72, 14)
    K.cyl_bm(bm, (x, y - 0.35, 0.72), (x, y + 0.35, 0.72), 0.42, 12)
K.part(bm, 'timber_tarred', name='cable_drums', uv='beam', axis=(0, 1, 0))
bm = bmesh.new()
for i, (x, y) in enumerate(((5.5, -5.0), (6.1, -5.2), (5.8, -4.5), (6.4, -4.7))):
    K.cyl_bm(bm, (x, y, 0.06), (x, y, 0.94), 0.29, 10)
K.part(bm, 'steel_painted', name='drums', mat_tint=(0.35, 0.4, 0.3), smooth=True)

# ------------------------------------------------------------------ destroyed
if DEAD:
    piv = V((GX0 + GW, 0, 0))
    T = Matrix.Translation((0.0, -1.0, 0.0)) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-84), 4, 'Y') @ \
        Matrix.Rotation(math.radians(-18), 4, 'Z') @ Matrix.Translation(-piv)
    M.xform_parts(gantry_parts, T, ground=0.02)
    pv = MD * 1.35                                               # erector cradle blown over onto its trailer, burnt
    T3 = Matrix.Translation(pv) @ Matrix.Rotation(math.radians(-78), 4, tuple(MP)) @ Matrix.Translation(-pv)
    M.xform_parts([o for o in mw_parts if o.name.startswith(('mw_cradle', 'mw_platforms'))], T3, ground=0.02)
    T2 = Matrix.Rotation(math.radians(9), 4, 'X') @ Matrix.Rotation(math.radians(-6), 4, 'Y')
    M.xform_parts(table_parts, T2, ground=0.0)
    M.rubble((0.0, 0.0, 0), 4.5, 0.6, mids=('concrete_bunker', 'steel_painted'), n=40, beams=0, tiles=None)
    bm = bmesh.new()                                            # torn rocket skin and fin fragments
    for i in range(18):
        c = V((r.uniform(-9, 9), r.uniform(-9, 9), 0.1))
        K.box_bm(bm, tuple(c), (r.uniform(0.4, 1.6), r.uniform(0.3, 0.9), 0.04), r.uniform(0, 3))
    K.part(bm, 'steel_painted', name='rocket_debris', mat_tint=(0.3, 0.3, 0.26))
    for k in range(3):
        K.decal('soot', (r.uniform(-3, 3), r.uniform(-3, 3), 0.08 + k * 0.001), (0, 0, 1), 9, 9, up=(1, k, 0), alpha=0.95)
    K.anchor('fire', (0, 0, 0.5), kind='fire_large')

# ------------------------------------------------------------------ metadata
K.footprint([(-2.4, -2.4), (2.4, -2.4), (2.4, 2.4), (-2.4, 2.4)], 'HIGH', 'firing_table')
if not DEAD:
    for x, y in legs:
        K.footprint_rect(x, y, 0.5, 0.5, block='HIGH', kind='gantry_leg')
    for z in plats:
        K.roof_meta([(GX0 - 1.8, -GW / 2 - 0.2), (GX0 + GW, -GW / 2 - 0.2), (GX0 + GW, GW / 2 + 0.2), (GX0 - 1.8, GW / 2 + 0.2)], z,
                    walkable=True, kind='gantry_platform')
    K.ladder_meta((GX0 + GW + 0.9, 0), (GX0 + GW - 0.4, 0), plats[0])
else:
    K.footprint([(GX0 - 12, -3.5), (GX0 + GW + 0.5, -3.5), (GX0 + GW + 0.5, 2.0), (GX0 - 12, 2.0)], 'HIGH', 'wreck')
K.footprint(PAD, 'NONE', 'pad')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
