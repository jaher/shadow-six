"""M9 Bab el Qattara field works. Variants:
  bunker (+ _destroyed): `bunker_sandbag_thatch` (8 x 7 x 2.5, objective o5): an earth-banked sandbag bunker,
     stretcher-bond bag walls on a sand berm, timber-framed firing slits S/E/W, the entrance in the middle of the N face
     behind a sandbag baffle (facing the tanker), a pyramidal roof of palm-log rafters under reed thatch with a torn
     camouflage net pegged down over it, a periscope pipe and a stovepipe, ammunition boxes by the door.
     destroyed: the walls blown out to 3-5 courses with burst bags flung round, the roof fallen in (charred rafters and
     slumped thatch, NOT a black box: soot only round the slits and the blast), the net torn and hanging, sand spill.
  comms (+ _destroyed): `comms_hut_antenna` (8 x 6 x 4.5, objective o1): a sand-painted board-and-batten radio hut on a
     rubble plinth, corrugated-iron gable roof with two whip aerials on the ridge, the door N (game (72, 76.5)), a
     sandbag blast wall along the S side, a field generator and cable drums on the E, the dish cable leaving the E gable
     on insulators down a pole. destroyed: walls burst outward, roof sheets collapsed and twisted, aerials down.
Front (Blender -Y) = game S. Usage: blender -b --python bq_mil.py -- outdir [bunker|comms][_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *

OUT, VAR, SEED = args('bunker')
DEST = VAR.endswith('destroyed')
KIND = VAR.split('_')[0]
NAME = {'bunker': 'sandbag_bunker_thatch_bq', 'comms': 'comms_hut_antenna_bq'}[KIND] + ('_destroyed' if DEST else '')
K.begin(NAME, 9091 + SEED + (7 if DEST else 0), theater='desert')
r = K.rng()


def bag_ring(pts, rows, thick=2, name='bags', skip=None):
    """Sandbag walls along a closed CCW polyline, `rows` courses (0.14 m each); skip = {edge: [(t0, t1)]} gaps."""
    for i in range(len(pts)):
        a, b = V((*pts[i], 0)), V((*pts[(i + 1) % len(pts)], 0))
        L = (b - a).length
        d = (b - a) / L
        for k, (t0, t1) in enumerate(dz.segs_minus(L, (skip or {}).get(i, []))):
            rr_ = rows[i] if isinstance(rows, (list, tuple)) else rows
            if rr_ > 0 and t1 - t0 > 0.5:
                dz.sandbags(tuple(a + d * t0), tuple(a + d * t1), rows=rr_, name='%s%d_%d' % (name, i, k), thick=thick, footprint=False)


def thatch_pyramid(cx, cy, w, d, z0, apex, oh=0.4, name='thatch', droop=0.0):
    """Reed thatch over a hipped pyramid: four ragged, thick sheets (solidified), eaves cut uneven."""
    bm = bmesh.new()
    corners = [V((cx - w / 2 - oh, cy - d / 2 - oh, z0 - 0.12)), V((cx + w / 2 + oh, cy - d / 2 - oh, z0 - 0.12)),
               V((cx + w / 2 + oh, cy + d / 2 + oh, z0 - 0.12)), V((cx - w / 2 - oh, cy + d / 2 + oh, z0 - 0.12))]
    top = V((cx, cy, apex))
    n = 7
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        rows = []
        for j in range(n + 1):
            u = j / n
            e = a.lerp(b, u) + V((0, 0, r.uniform(-0.08, 0.05) if 0 < j < n else 0))
            rows.append([e.lerp(top, s / 4) - V((0, 0, droop * math.sin(math.pi * s / 4) * math.sin(math.pi * u))) for s in range(5)])
        vv = [[bm.verts.new(p) for p in row] for row in rows]
        for j in range(n):
            for s in range(4):
                bm.faces.new((vv[j][s], vv[j + 1][s], vv[j + 1][s + 1], vv[j][s + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.22)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'roof_thatch', name=name, mat_tint=(0.86, 0.78, 0.6), grime=0.7, bisect=False, smooth=True)


def net(cx, cy, w, d, z_fn, name='net', torn=0.0):
    """Camouflage netting with garnish: a sagging sheet (one-sided cards, both faces) over the given height field."""
    bm = bmesh.new()
    nx, ny = 10, 9
    vv = [[bm.verts.new(V((cx - w / 2 + w * i / nx + r.uniform(-0.05, 0.05), cy - d / 2 + d * j / ny + r.uniform(-0.05, 0.05), 0)))
           for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(ny + 1):
            v = vv[i][j]
            v.co.z = z_fn(v.co.x, v.co.y) + 0.06 + r.uniform(-0.03, 0.04)
    for i in range(nx):
        for j in range(ny):
            if torn and r.random() < torn:
                continue
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    K.part(bm, 'camo_netting', name=name, mat_tint=(0.88, 0.8, 0.62), grime=0.3, bisect=False)


if KIND == 'bunker':
    HW, HD = 3.6, 3.1                       # outer bag line (footprint 8 x 7 incl. the berm)
    ring = rect(-HW, -HD, HW, HD)           # edges 0 S, 1 E, 2 N, 3 W
    DOORG = (HW - 0.55, HW + 0.55)          # gap in the N edge (runs x +HW -> -HW): centred on x 0
    # sand berm banked against the bag walls (the bunker is half dug in)
    for i in range(4):
        a, b, rr_, n, L = dz.edge(ring, i)
        if i == 2:
            dz.sand_drift(a + rr_ * 0.1, a + rr_ * (DOORG[0] - 0.2), n, h=0.55, w=0.75, seed=SEED + i, name='berm%da' % i)
            dz.sand_drift(a + rr_ * (DOORG[1] + 0.2), b - rr_ * 0.1, n, h=0.55, w=0.75, seed=SEED + i + 9, name='berm%db' % i)
        else:
            dz.sand_drift(a - rr_ * 0.3, b + rr_ * 0.3, n, h=0.6 if not DEST else 0.4, w=0.8, seed=SEED + i, name='berm%d' % i)
    rows = 10 if not DEST else [4, 3, 5, 2]
    bag_ring(ring, rows, thick=1, name='bags', skip={2: [DOORG]} if not DEST else {2: [DOORG], 1: [(1.8, 4.6)], 0: [(2.0, 4.2)]})
    ZW = 1.4
    if not DEST:
        # firing slits: timber box frames set between courses (S x2, E, W)
        bm = bmesh.new()
        for (x, y, rz) in ((-1.6, -HD, 0), (1.6, -HD, 0), (HW, 0.2, math.pi / 2), (-HW, 0.6, math.pi / 2)):
            C.box_bm(bm, (x, y, 1.0), (1.0, 0.75, 0.06), rz)
            C.box_bm(bm, (x, y, 1.24), (1.0, 0.75, 0.06), rz)
        K.part(bm, 'timber_beam', name='slits', mat_tint=(0.62, 0.52, 0.4), grime=0.8, bisect=False)
        bm = bmesh.new()
        for (x, y, rz) in ((-1.6, -HD, 0), (1.6, -HD, 0), (HW, 0.2, math.pi / 2), (-HW, 0.6, math.pi / 2)):
            C.box_bm(bm, (x, y, 1.12), (0.9, 0.78, 0.18), rz)
        K.part(bm, 'interior_dark', name='slit_dark', bisect=False)
        for (x, y, nrm) in ((-1.6, -HD - 0.4, (0, -1, 0)), (1.6, -HD - 0.4, (0, -1, 0)), (HW + 0.4, 0.2, (1, 0, 0)), (-HW - 0.4, 0.6, (-1, 0, 0))):
            K.anchor('embrasure', (x, y, 1.12), nrm, kind='embrasure')
        # roof: wall plate, palm-log rafters to the apex, reed thatch, camo net pegged to the berm
        bm = bmesh.new()
        for (a, b) in (((-HW, -HD, ZW), (HW, -HD, ZW)), ((HW, -HD, ZW), (HW, HD, ZW)), ((HW, HD, ZW), (-HW, HD, ZW)), ((-HW, HD, ZW), (-HW, -HD, ZW))):
            C.cyl_bm(bm, V(a), V(b), 0.09, 6)
        for (x, y) in ((-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD), (0, -HD), (0, HD), (-HW, 0), (HW, 0)):
            C.cyl_bm(bm, V((x * 0.98, y * 0.98, ZW + 0.05)), V((0, 0, 2.55)), 0.08, 6)
        K.part(bm, 'palm_log', name='rafters', grime=0.7, bisect=False)
        thatch_pyramid(0, 0, 2 * HW, 2 * HD, ZW + 0.12, 2.6, oh=0.35, droop=0.12)
        net(0.3, -0.2, 2 * HW - 0.6, 2 * HD - 0.4, lambda x, y: 2.62 - 1.1 * max(abs(x) / (HW + 0.35), abs(y) / (HD + 0.35)), name='net', torn=0.3)
        # entrance: a doorframe in the N gap, a plank door ajar, steps down, a sandbag baffle 1.3 m out (L)
        bm = bmesh.new()
        for x in (-0.5, 0.5):
            C.box_bm(bm, (x, HD, ZW / 2 + 0.05), (0.14, 0.7, ZW + 0.1))
        C.box_bm(bm, (0, HD, ZW + 0.05), (1.3, 0.7, 0.16))
        K.part(bm, 'timber_beam', name='doorframe', mat_tint=(0.62, 0.52, 0.4), grime=0.8, bisect=False)
        bm = bmesh.new()
        C.box_bm(bm, (0, HD - 0.1, 0.02), (0.95, 0.9, 0.04))
        K.part(bm, 'interior_dark', name='doorway_dark', bisect=False)
        C.door_meta('entry', (0, HD + 0.35, 0), (0, 1, 0), 0.95, 1.4, kind='door')
        dz.sandbags((-1.6, HD + 1.35), (0.9, HD + 1.35), rows=7, name='baffle', thick=2, footprint=False)
        # periscope and stovepipe through the thatch, ammo boxes and a water can by the door
        bm = bmesh.new()
        C.cyl_bm(bm, V((1.4, -0.6, 1.2)), V((1.4, -0.6, 2.45)), 0.06, 6)
        C.box_bm(bm, (1.4, -0.66, 2.5), (0.14, 0.2, 0.16))
        C.cyl_bm(bm, V((-1.5, 0.9, 1.2)), V((-1.5, 0.9, 2.5)), 0.07, 8)
        K.part(bm, 'cast_iron', name='pipes', mat_tint=(0.33, 0.32, 0.29), bisect=False)
        bm = bmesh.new()
        for k, (x, y) in enumerate(((1.5, HD + 0.55), (2.2, HD + 0.6), (1.85, HD + 0.6))):
            dz.crate(bm, (x, y, 0 if k < 2 else 0.36), (0.6, 0.4, 0.34), r.uniform(-0.1, 0.1))
        K.part(bm, 'wood_paint', name='boxes', mat_tint=DAK, grime=0.8, bisect=False)
        jerrycans((-2.3, HD + 0.5, 0), n=3, rot=0.0)
    else:
        # roof fallen in: broken rafters at angles, slumped half-burnt thatch inside, the net torn and draped
        bm = bmesh.new()
        for k in range(9):
            a = V((r.uniform(-HW, HW), r.uniform(-HD, HD), r.uniform(0.15, 0.9)))
            d = V((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.3, 0.6))).normalized() * r.uniform(1.0, 2.6)
            C.cyl_bm(bm, a, a + d, 0.075, 6)
        K.part(bm, 'palm_log', name='rafters_broken', mat_tint=(0.5, 0.42, 0.34), grime=1.0, bisect=False)
        thatch_pyramid(0.3, -0.2, 2 * HW - 1.2, 2 * HD - 1.2, 0.55, 1.0, oh=0.1, droop=0.25, name='thatch_down')
        net(-0.6, 0.6, 2 * HW, 2 * HD - 0.6, lambda x, y: max(0.04, 0.9 - 0.35 * abs(x) - 0.25 * abs(y) + 0.3 * math.sin(x * 2.1)), name='net', torn=0.35)
        # burst bags flung round, sand spill, a blackened scorch only at the blast centre and the slits
        bm = bmesh.new()
        for k in range(26):
            a = r.uniform(0, 2 * math.pi)
            d = r.uniform(4.0, 6.2)
            C.box_bm(bm, (math.cos(a) * d * 0.9, math.sin(a) * d * 0.8, 0.07), (0.56, 0.32, 0.13), r.uniform(0, 3.1), taper=(0.85, 0.8))
        K.part(bm, 'hessian', name='flung_bags', grime=0.7, mat_tint=(0.95, 0.9, 0.8), bisect=False)
        for k in range(6):
            a = r.uniform(0, 2 * math.pi)
            K.decal('stain_blotch', (math.cos(a) * 4.6, math.sin(a) * 4.0, 0.012), (0, 0, 1), r.uniform(1.0, 2.0), r.uniform(0.8, 1.5), alpha=0.35)
        K.decal('soot', (0.2, -0.1, 0.62), (0, 0, 1), 3.4, 3.0, alpha=0.45)
        C.A.meta['notes'].append('destroyed variant: bag walls blown down to 2-5 courses, roof fallen in (charred rafters, slumped thatch), net torn; soot only at the blast')
    K.footprint(rect(-HW - 0.4, -HD - 0.4, HW + 0.4, HD + 0.4), 'HIGH' if not DEST else 'LOW', 'bunker')

if KIND == 'comms':
    HW, HD, ZE = 3.6, 2.4, 2.6
    poly = rect(-HW, -HD, HW, HD)
    PAINT = (0.86, 0.76, 0.56)
    door = K.opening(poly, 2, HW - 1.5, 0.95, 2.05, 0.0, 0.15, 'rect', 'door')          # N face at x +1.5
    wins = [K.opening(poly, 0, 1.6, 0.9, 0.8, 1.45, 0.15), K.opening(poly, 0, 5.6, 0.9, 0.8, 1.45, 0.15),
            K.opening(poly, 1, 2.4, 0.8, 0.8, 1.4, 0.15), K.opening(poly, 3, 2.4, 0.8, 0.8, 1.4, 0.15)]
    br = []
    if DEST:
        br = [dz.RagFrame(K.opening(poly, 0, 3.6, 2.2, 2.2, 0.15, 0.15, 'rect', 'breach'), seed=SEED),
              dz.RagFrame(K.opening(poly, 1, 2.6, 1.6, 1.9, 0.3, 0.15, 'rect', 'breach'), seed=SEED + 1)]
        wins = [wins[3]]
    K.wall_ring(poly, ZE, 0.15, 'board_batten', [door] + wins + br, plinth=('rubble_stone', 0.4, 0.05), name='walls', mat_tint=PAINT)
    # gable ends (boards up to the ridge) + corrugated iron gable roof, ridge along x
    pitch = 24.0
    rise = HD * math.tan(math.radians(pitch))
    bm = bmesh.new()
    for x in (-HW + 0.075, HW - 0.075):
        C.hexa_bm(bm, [V((x - 0.075, -HD, ZE)), V((x + 0.075, -HD, ZE)), V((x + 0.075, HD, ZE)), V((x - 0.075, HD, ZE)),
                       V((x - 0.075, -0.02, ZE + rise)), V((x + 0.075, -0.02, ZE + rise)), V((x + 0.075, 0.02, ZE + rise)), V((x - 0.075, 0.02, ZE + rise))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'board_batten', name='gables', mat_tint=PAINT, grime=0.7)
    if not DEST:
        KR.roof_gable(0, 0, 2 * HW, 2 * HD, ZE, pitch=pitch, mid='corrugated_galv', eave_oh=0.35, gable_oh=0.25, thick=0.06)
        whip(-HW + 0.6, 0, ZE + rise + 0.05, 3.2, name='whip_w')
        whip(HW - 0.6, 0, ZE + rise + 0.05, 3.6, name='whip_e')
    else:   # the roof sheets slid off: one plane tilted into the room, one leaning on the S sandbags, a whip down
        bm = bmesh.new()
        C.hexa_bm(bm, [V((-HW + 0.3, -HD - 0.9, 0.3)), V((0.8, -HD - 1.1, 0.25)), V((0.9, 0.2, 2.1)), V((-HW + 0.2, 0.3, 2.0)),
                       V((-HW + 0.3, -HD - 0.9, 0.36)), V((0.8, -HD - 1.1, 0.31)), V((0.9, 0.2, 2.16)), V((-HW + 0.2, 0.3, 2.06))])
        C.hexa_bm(bm, [V((-0.6, 0.0, 0.5)), V((HW - 0.2, -0.2, 0.9)), V((HW - 0.3, HD + 0.2, 2.2)), V((-0.5, HD + 0.3, 1.6)),
                       V((-0.6, 0.0, 0.56)), V((HW - 0.2, -0.2, 0.96)), V((HW - 0.3, HD + 0.2, 2.26)), V((-0.5, HD + 0.3, 1.66))])
        K.part(bm, 'corrugated_galv', name='roof_down', mat_tint=(0.7, 0.66, 0.6), grime=1.0, bisect=False)
        bm = bmesh.new()
        C.cyl_bm(bm, V((HW + 0.3, 1.0, 0.05)), V((HW + 3.2, 1.8, 0.1)), 0.015, 4)
        K.part(bm, 'cast_iron', name='whip_down', bisect=False)
        dz.patch_quad([(-HW + 0.2, -HD + 0.2, 0), (HW - 0.2, -HD + 0.2, 0), (HW - 0.2, HD - 0.2, 0), (-HW + 0.2, HD - 0.2, 0)], 'boards_weathered',
                      'floor', tint=(0.62, 0.56, 0.48), lift=0.3)
        K.rubble((HW + 0.9, -0.6, 0), radius=1.3, height=0.45, mids=('boards_weathered', 'rubble_stone'), n=18, beams=4, tiles=None, seed=SEED, name='rubble_e')
        K.rubble((0.4, -HD - 1.0, 0), radius=1.4, height=0.4, mids=('boards_weathered', 'rubble_stone'), n=18, beams=4, tiles=None, seed=SEED + 2, name='rubble_s')
    K.door(door, 'main', 'plank', (0.5, 0.44, 0.32), step='ashlar', hinge='left', node='door_main', open_deg=0 if not DEST else 95)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.8, 0.74, 0.6), sill=None, shutters=None if DEST else ['open', 'closed', 'ajar', 'open'][k],
                 shutter_color=(0.5, 0.44, 0.32), curtain=0.0, streak=False, name='w%d' % k)
    # the sandbag blast wall along the S side (with its gap at the E end), generator and cable drums on the E
    dz.sandbags((-HW + 0.2, -HD - 0.45), (HW - 1.0, -HD - 0.45), rows=9 if not DEST else 3, name='bags_s', thick=2, footprint=False)
    bm = bmesh.new()
    C.box_bm(bm, (HW + 0.55, 0.9, 0.42), (0.7, 1.2, 0.7))
    C.box_bm(bm, (HW + 0.55, 0.9, 0.82), (0.5, 1.0, 0.12))
    C.cyl_bm(bm, V((HW + 0.55, 0.4, 0.85)), V((HW + 0.55, 0.4, 1.35)), 0.04, 6)
    K.part(bm, 'paint_metal', name='generator', mat_tint=(0.72, 0.62, 0.44), grime=0.9, bisect=False)
    bm = bmesh.new()
    for k, (x, y) in enumerate(((HW + 0.5, -0.6), (HW + 0.85, -1.2))):
        C.cyl_bm(bm, V((x - 0.2, y, 0.3)), V((x + 0.2, y, 0.3)), 0.3, 12)
    K.part(bm, 'timber_beam', name='cable_drums', mat_tint=(0.66, 0.56, 0.44), grime=0.7, bisect=False, smooth=True)
    if not DEST:   # the dish cable: insulators on the E gable, down a short pole to the ground, off towards the mast (NE)
        bm = bmesh.new()
        C.cyl_bm(bm, V((HW + 0.9, 1.6, 0)), V((HW + 0.9, 1.6, 2.7)), 0.06, 6)
        K.part(bm, 'timber_beam', name='cable_pole', mat_tint=(0.6, 0.5, 0.4), grime=0.7, bisect=False)
        wire((HW + 0.08, 0.6, ZE + 0.6), (HW + 0.9, 1.6, 2.6), sag=0.12, name='cable_a', r=0.014)
        wire((HW + 0.9, 1.6, 2.6), (HW + 0.9, 1.6, 0.05), sag=0.0, name='cable_b', r=0.014)
        wire((HW + 0.9, 1.6, 0.03), (HW + 0.95, 2.4, 0.03), sag=0.0, name='cable_c', r=0.016)
        jerrycans((-HW - 0.5, 1.2, 0), n=3, rot=math.pi / 2)
    for e in range(4):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.01 + V((0, 0, 0.45))), tuple(n), L * 0.9, 0.5, alpha=0.4)
    sand_feet(poly, h=0.2, w=0.7, seed=SEED, skip=(0,))
    if DEST:
        K.scorch_openings(0.8, 0.6)
        C.A.meta['notes'].append('destroyed variant: S and E walls burst, roof sheets down, aerials down; soot round the openings only')
    K.footprint(poly, 'HIGH', 'building')
    K.footprint(rect(-HW + 0.2, -HD - 0.75, HW - 1.0, -HD - 0.15), 'LOW', 'wall')   # the S blast wall: part of the 8 x 6 m plot

dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
