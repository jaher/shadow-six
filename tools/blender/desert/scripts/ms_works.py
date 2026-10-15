"""M11 Maradah works and small structures.
  portal: `tunnel_portal` (10 x 1 face, 7 m): a dressed-sandstone portal face on the rock, a round arch 5 m wide x 4.5 m
          clear on chamfered imposts with voussoirs and a keystone, a string course and a coped parapet, battered wing
          ends, a dark lined bore 2.5 m deep with timber ribs, a drain gully, rockfall rubble, a cable on insulators.
  shed:   `shed_timber_long` (shed_m, 7 x 4 x 3): an open timber lean-to, four front posts, a planked back wall, a
          mono-pitch roof of corrugated sheets on purlins (rusted, one sheet lifted), crates, drums, a bench, a tarp.
  dugout: `dugout` (dugout_y, 4.5 x 4 x 2): a half-dug sandbag shelter with a log roof under sand and bags, a timber
          door frame mid S with a hessian curtain, a sand berm round it, a stovepipe.
  tower:  `wall_ruined_stone_tower` (tower_s, 3 x 3 x 5): a rubble-stone tower stub, broken ragged top, an arrow slit,
          a blocked doorway, rubble at the foot.
Front (Blender -Y) = game S. Usage: blender -b --python ms_works.py -- outdir [portal|shed|dugout|tower] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('portal')
NAME = {'portal': 'tunnel_portal_ms', 'shed': 'shed_lean_to_ms', 'dugout': 'dugout_sandbag_ms', 'tower': 'tower_stub_ms'}[VAR]
K.begin(NAME, 11501 + SEED + 17 * len(VAR), theater='desert')
r = K.rng()
SAND_ST = (0.95, 0.86, 0.7)

if VAR == 'portal':
    HW, D, H = 3.75, 1.0, 7.0
    face = rect(-HW, -0.5, HW, 0.5)                       # edges 0 S (front), 1 E, 2 N, 3 W
    arch = K.opening(face, 0, HW, 4.6, 4.5, 0.0, D, 'arch', 'door')
    K.wall_ring(face, H - 0.6, D, 'sandstone_ochre', [arch], name='face', mat_tint=SAND_ST, footprint=False)
    KA.voussoirs(arch, 'ashlar_limestone') if hasattr(KA, 'voussoirs') else None
    bm = bmesh.new()                                       # string course + coped parapet + chamfered impost blocks
    C.box_bm(bm, (0, -0.55, H - 0.75), (2 * HW + 0.2, 0.2, 0.22))
    C.box_bm(bm, (0, 0, H - 0.3), (2 * HW, 1.0, 0.6))
    C.box_bm(bm, (0, -0.02, H + 0.04), (2 * HW + 0.12, 1.12, 0.1))
    for s in (-1, 1):
        C.box_bm(bm, (s * 2.4, -0.55, 2.2), (0.45, 0.2, 0.3))
        C.hexa_bm(bm, [V((s * HW, -0.5, 0)), V((s * (HW + 0.9), -0.5, 0)), V((s * (HW + 0.9), 0.5, 0)), V((s * HW, 0.5, 0)),
                       V((s * HW, -0.5, H - 0.6)), V((s * (HW + 0.15), -0.5, H - 0.6)), V((s * (HW + 0.15), 0.5, H - 0.6)), V((s * HW, 0.5, H - 0.6))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'ashlar', name='trim', mat_tint=SAND_ST, grime=0.8, bisect=False)
    bm = bmesh.new()                                       # the lined bore: a dark barrel vault 2.5 m back
    n = 12
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        p = lambda a, y: V((2.25 * math.cos(a), y, 2.2 + 2.25 * math.sin(a)))
        C.quad(bm, [p(a0, 0.5), p(a1, 0.5), p(a1, 3.0), p(a0, 3.0)])
    for s in (-1, 1):
        C.box_bm(bm, (s * 2.25, 1.75, 1.1), (0.05, 2.5, 2.2))
    C.box_bm(bm, (0, 3.0, 2.2), (4.6, 0.05, 4.5))
    K.part(bm, 'interior_dark', name='bore', bisect=False)
    bm = bmesh.new()      # the bore's darkness in front of the rock (the map's rock prism closes the arch 0.1 m behind the face)
    ol = arch.outline(14)
    pts = [arch.p(x, z, -0.88) for x, z in ol]
    for i in range(1, len(pts) - 1):
        for fl in (False, True):
            C.quad(bm, [pts[0], pts[i], pts[i + 1]], flip=fl)
    for s in (-1, 1):     # dark reveals between the face and the card
        C.box_bm(bm, (s * 2.27, -0.06, 1.1), (0.02, 0.88, 2.2))
    K.part(bm, 'interior_dark', name='bore_card', bisect=False)
    bm = bmesh.new()
    for y in (1.0, 2.2):
        for i in range(n):
            a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
            C.beam_bm(bm, (2.15 * math.cos(a0), y, 2.2 + 2.15 * math.sin(a0)), (2.15 * math.cos(a1), y, 2.2 + 2.15 * math.sin(a1)), 0.18, 0.18)
        for s in (-1, 1):
            C.box_bm(bm, (s * 2.15, y, 1.1), (0.18, 0.18, 2.2))
    K.part(bm, 'timber_beam', name='ribs', mat_tint=(0.5, 0.42, 0.34), grime=0.9, bisect=False)
    for s in (-1, 1):
        K.rubble((s * (HW - 0.4), -1.3, 0), radius=0.9, height=0.45, mids=('sandstone_ochre', 'rock_cliff'), n=14, beams=0, tiles=None, seed=SEED + s, name='fall%d' % (s + 1))
    bm = bmesh.new()                                        # field-telephone cable on insulator brackets over the arch
    for x in (-3.0, -1.2, 1.2, 3.0):
        C.box_bm(bm, (x, -0.58, 5.6), (0.05, 0.16, 0.05))
    K.part(bm, 'cast_iron', name='brackets', mat_tint=(0.3, 0.3, 0.28), bisect=False)
    wire((-3.7, -0.65, 5.62), (3.7, -0.65, 5.62), sag=0.12, name='cable', r=0.012)
    sign_board((2.85, -0.53, 3.4), (0, -1, 0), 0.9, 0.55, name='plate', post=False)
    for k in range(4):
        x = r.uniform(-3.2, 3.2)
        K.decal(['streak_long', 'stain_blotch', 'streak_rain', 'crack'][k], (x, -0.52, r.uniform(4.5, 6.0)), (0, -1, 0), 0.7, 1.6, alpha=0.45)
    for o in C.A.parts:
        if o.name.startswith(('face', 'trim')):
            o['dz_noao'] = 1
    K.footprint(face, 'HIGH', 'wall')
elif VAR == 'shed':
    HW, HD, ZF, ZB = 3.5, 2.0, 3.0, 2.2                    # front (S) eave 3.0, back (N) 2.2: the roof sheds N
    TIM = (0.74, 0.64, 0.5)
    posts([(-HW + 0.15, -HD + 0.15), (-1.15, -HD + 0.15), (1.15, -HD + 0.15), (HW - 0.15, -HD + 0.15)], 0, ZF, s=0.18, name='posts_f', tint=TIM)
    posts([(-HW + 0.15, HD - 0.15), (0, HD - 0.15), (HW - 0.15, HD - 0.15)], 0, ZB, s=0.18, name='posts_b', tint=TIM)
    beams([((-HW, -HD + 0.15, ZF), (HW, -HD + 0.15, ZF)), ((-HW, HD - 0.15, ZB), (HW, HD - 0.15, ZB)),
           ((-HW + 0.15, -HD + 0.15, ZF), (-HW + 0.15, HD - 0.15, ZB)), ((HW - 0.15, -HD + 0.15, ZF), (HW - 0.15, HD - 0.15, ZB)),
           ((-1.15, -HD + 0.15, ZF - 0.7), (-1.9, -HD + 0.15, ZF)), ((1.15, -HD + 0.15, ZF - 0.7), (1.9, -HD + 0.15, ZF))], s=0.14, name='frame', tint=TIM)
    bm = bmesh.new()                                        # purlins
    for t in (0.2, 0.5, 0.8):
        y = -HD + 0.15 + (2 * HD - 0.3) * t
        z = ZF + (ZB - ZF) * t + 0.12
        C.box_bm(bm, (0, y, z), (2 * HW + 0.3, 0.1, 0.1))
    K.part(bm, 'timber_beam', name='purlins', mat_tint=TIM, grime=0.7, bisect=False)
    bm = bmesh.new()                                        # corrugated roof sheets, one lifted at the SE corner
    for i in range(7):
        x0 = -HW - 0.2 + i * (2 * HW + 0.4) / 7
        lift = 0.18 if i == 6 else 0.0
        vy, vz = 2 * HD + 0.6, (ZB - ZF) - lift
        dz.corrugated_bm(bm, (x0, -HD - 0.3, ZF + 0.2 + lift), (1, 0, 0), (0, vy, vz), (2 * HW + 0.4) / 7 + 0.08, math.hypot(vy, vz),
                         bend=0.25 if i == 6 else 0.0)
    K.part(bm, 'corrugated_rust', name='roof', grime=0.8, bisect=False)
    bm = bmesh.new()                                        # planked back wall + a half-height W end
    C.box_bm(bm, (0, HD - 0.12, ZB / 2), (2 * HW - 0.2, 0.05, ZB))
    C.box_bm(bm, (-HW + 0.12, 0.6, 0.65), (0.05, 2.4, 1.3))
    K.part(bm, 'boards_weathered', name='boards', mat_tint=(0.86, 0.78, 0.64), grime=0.8, bisect=False)
    bm = bmesh.new()
    for k, (x, y, z) in enumerate(((-2.4, 1.2, 0), (-1.7, 1.25, 0), (-2.05, 1.2, 0.42), (2.5, 1.3, 0))):
        dz.crate(bm, (x, y, z), (0.62, 0.42, 0.4), r.uniform(-0.1, 0.1))
    K.part(bm, 'wood_paint', name='boxes', mat_tint=DAK, grime=0.8, bisect=False)
    drums([(0.6, 1.4, 0), (1.25, 1.35, 0), (0.9, 0.7, 0)], tint=(0.34, 0.37, 0.3), lying=(2,))
    bm = bmesh.new()                                        # work bench with a vice
    C.box_bm(bm, (2.0, 0.2, 0.85), (1.6, 0.6, 0.06))
    for (x, y) in ((1.3, -0.05), (2.7, -0.05), (1.3, 0.45), (2.7, 0.45)):
        C.box_bm(bm, (x, y, 0.42), (0.07, 0.07, 0.84))
    K.part(bm, 'timber_grey', name='bench', grime=0.7, bisect=False)
    jerrycans((-0.6, 1.5, 0), n=5, rot=0.0)
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')
elif VAR == 'dugout':
    HW, HD = 2.25, 2.0
    ring = rect(-HW + 0.18, -HD + 0.18, HW - 0.18, HD - 0.18)
    for i in range(4):
        a, b = V((*ring[i], 0)), V((*ring[(i + 1) % 4], 0))
        L = (b - a).length
        d = (b - a) / L
        for k, (t0, t1) in enumerate(dz.segs_minus(L, [(L / 2 - 0.55, L / 2 + 0.55)] if i == 0 else [])):
            dz.sandbags(tuple(a + d * t0), tuple(a + d * t1), rows=9, name='bags%d_%d' % (i, k), thick=1, footprint=False)
        n = V((d.y, -d.x, 0))
        dz.sand_drift(a + d * 0.1, b - d * 0.1, n, h=0.75 if i else 0.4, w=0.6, seed=SEED + i, name='berm%d' % i) if i != 0 else None
    bm = bmesh.new()                                        # log roof
    x = -HW + 0.25
    while x < HW:
        C.cyl_bm(bm, V((x, -HD + 0.05, 1.32)), V((x, HD - 0.05, 1.32)), 0.11, 7)
        x += 0.24
    K.part(bm, 'palm_log', name='logs', mat_tint=(0.76, 0.66, 0.52), grime=0.8, bisect=False)
    bm = bmesh.new()                                        # sand mound over the logs, bags on top
    vv = [[bm.verts.new(V((-HW + 0.1 + (2 * HW - 0.2) * i / 6, -HD + 0.1 + (2 * HD - 0.2) * j / 6,
                           1.42 + 0.35 * math.sin(math.pi * i / 6) * math.sin(math.pi * j / 6) + r.uniform(-0.02, 0.02)))) for j in range(7)] for i in range(7)]
    for i in range(6):
        for j in range(6):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    K.part(bm, 'sand', name='mound', mat_tint=(0.95, 0.88, 0.74), grime=0.4, bisect=False, smooth=True)
    for k, (x, y) in enumerate(((-0.8, -0.6), (0.4, 0.3), (1.0, -0.9))):
        dz.sandbags((x - 0.5, y), (x + 0.5, y), rows=1, name='topbag%d' % k, thick=1, footprint=False)
        C.A.parts[-1].location.z += 1.62
    bm = bmesh.new()                                        # door frame + dark doorway + curtain
    for s in (-1, 1):
        C.box_bm(bm, (s * 0.55, -HD + 0.18, 0.65), (0.14, 0.36, 1.3))
    C.box_bm(bm, (0, -HD + 0.18, 1.32), (1.3, 0.36, 0.16))
    K.part(bm, 'timber_beam', name='doorframe', mat_tint=(0.62, 0.52, 0.4), grime=0.8, bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0, -HD + 0.3, 0.62), (0.95, 0.04, 1.24))
    K.part(bm, 'hessian', name='curtain', mat_tint=(0.7, 0.62, 0.48), grime=0.7, bisect=False)
    C.door_meta('entry', (0, -HD - 0.3, 0), (0, -1, 0), 0.95, 1.3, kind='door')
    bm = bmesh.new()
    C.cyl_bm(bm, V((1.3, 1.1, 1.3)), V((1.3, 1.1, 2.35)), 0.06, 8)
    K.part(bm, 'cast_iron', name='stovepipe', mat_tint=(0.33, 0.32, 0.29), bisect=False)
    bm = bmesh.new()
    dz.crate(bm, (1.4, -HD - 0.3, 0), (0.6, 0.38, 0.34), 0.1)
    K.part(bm, 'wood_paint', name='box', mat_tint=DAK, grime=0.8, bisect=False)
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')
elif VAR == 'tower':
    HW = 1.5
    sq = rect(-HW, -HW, HW, HW)
    slit = K.opening(sq, 0, HW, 0.25, 1.1, 2.4, 0.6, 'rect')
    blocked = K.opening(sq, 3, HW, 1.0, 1.9, 0.0, 0.6, 'arch', 'door')
    K.wall_ring(sq, 4.6, 0.6, 'rubble_stone', [slit, blocked], plinth=('fieldstone', 0.5, 0.05), name='walls', mat_tint=(0.92, 0.84, 0.7))
    bm = bmesh.new()                                        # the blocked doorway: rough fill set back
    C.box_bm(bm, tuple(blocked.p(0, 0.95, -0.25)), (0.22, 1.0, 1.9))
    K.part(bm, 'fieldstone', name='fill', mat_tint=(0.8, 0.72, 0.6), grime=0.9, bisect=False)
    for k in range(5):                                      # ragged broken top: bites out of the wall head
        a = 2 * math.pi * k / 5 + 0.3
        dz.safe_bite(V((HW * 1.1 * math.cos(a), HW * 1.1 * math.sin(a), 4.6)), r.uniform(0.7, 1.1), seed=SEED + k)
    K.rubble((0.6, -HW - 0.9, 0), radius=1.1, height=0.5, mids=('rubble_stone', 'fieldstone'), n=18, beams=0, tiles=None, seed=SEED, name='rubble')
    K.decal('streak_long', (0.6, -HW - 0.01, 3.0), (0, -1, 0), 0.8, 2.2, alpha=0.4)
    K.decal('lichen', (-0.7, -HW - 0.01, 1.2), (0, -1, 0), 0.9, 0.8, alpha=0.4)
    sand_feet(sq, h=0.3, w=0.6, seed=SEED)
    K.footprint(sq, 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=32, soften=VAR != 'portal')   # the bore stays dark
