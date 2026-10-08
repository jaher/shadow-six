"""Compiegne town cemetery pieces (M15; building-inventory `cemetery`): a family mausoleum-chapel and chest tombs.
 chapel   6 x 5 x 5 limestone family chapel: granite plinth + steps, pedimented S front with a cross acroterion, iron and
          glass door, stained-glass oculus, slate saddle roof with an iron-and-glass lantern, side lancets, moss, streaks
 tomb_a   2 x 1 chest tomb (tombeau coffre) in weathered limestone with panelled sides, chamfered lid and a cross
 tomb_b   granite ledger tomb on a plinth with a polished stele at the head and a bead wreath
 tomb_c   sarcophagus with a gabled lid and corner acroteria, urn, lichen
Usage: blender -b --factory-startup --python cemetery_fr.py -- <outroot> <variant> <seed>"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fr_common import no_streaks, K, V, C, bmesh, args, rect, compact, tag_lod, report_tris, TRIM, use_cheap_windows, use_cheap_doors
use_cheap_windows()
use_cheap_doors()
no_streaks()

ROOT, VAR, SEED = args()
NAME = {'chapel': 'mausoleum_chapel', 'tomb_a': 'tomb_chest_a', 'tomb_b': 'tomb_chest_b', 'tomb_c': 'tomb_chest_c'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
LIME, LT = 'limestone_smooth', (0.92, 0.89, 0.8)


def chslab(bm, cx, cy, w, d, z0, z1, ch=0.04):
    q = lambda sx, sy, z, k: V((cx + sx * (w / 2 - k), cy + sy * (d / 2 - k), z))
    pts = [q(sx, sy, z0, 0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] + [q(sx, sy, z1, ch) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    K.hexa_bm(bm, pts)


def cross(bm, c, h=0.6, w=0.36, t=0.07):
    c = V(c)
    K.box_bm(bm, tuple(c + V((0, 0, h / 2))), (t, t, h))
    K.box_bm(bm, tuple(c + V((0, 0, h * 0.68))), (t, w, t))


if VAR == 'chapel':
    HX, HY, ZE, OY = 2.9, 2.05, 3.6, 0.42               # body 5.8 x 4.1 shifted N: the steps stay inside the 6 x 5 plot
    P = [(x, y + OY) for (x, y) in rect(-HX, -HY, HX, HY)]
    door = K.opening(P, 0, HX, 1.2, 2.3, 0.55, 0.4, 'arch', 'door')
    lanc = [K.opening(P, e, t, 0.45, 1.5, 1.4, 0.4, 'arch', 'window') for e, t in ((1, HY), (3, HY), (2, HX))]
    K.wall_ring(P, ZE, 0.4, 'ashlar_limestone', [door] + lanc, plinth=('granite', 0.55, 0.06), name='walls', mat_tint=LT, footprint=False)
    K.footprint(rect(-3.0, -2.5, 3.0, 2.5), 'HIGH', 'building')
    K.quoins(P, 0.55, ZE - 0.2, LIME, block_h=0.35, long=0.5, short=0.3)
    K.cornice(P, ZE - 0.3, LIME, steps=((0.05, 0.1), (0.12, 0.1), (0.2, 0.12)), name='cornice')
    K.door(door, 'chapel', 'glazed', (0.12, 0.13, 0.13), step=None, lintel=None, surround=LIME)
    for k, f in enumerate(lanc):
        K.window(f, 'fixed', (1, 3), frame=(0.15, 0.15, 0.15), recess=0.15, sill=LIME, lintel=None, curtain=0.0, name='lancet%d' % k)
    K.stairs((0, OY - HY - 0.86, 0), (0, 1, 0), 1.8, 0.55, 3, 'granite', name='steps', meta=False)
    R = K.roof_gable(0, OY, 2 * HY + 0.3, 2 * HX, ZE, 50, 'roof_slate', rot=math.pi / 2, eave_oh=0.25, gable_oh=0.2, thick=0.12,
                     fascia=None, barge=None, gutters=False)
    K.gable(P, 0, ZE, R.z_ridge - R.lift, 0.4, 'ashlar_limestone', name='pediment_s', mat_tint=LT)
    K.gable(P, 2, ZE, R.z_ridge - R.lift, 0.4, 'ashlar_limestone', name='gable_n', mat_tint=LT)
    bm = bmesh.new()                                  # oculus (stained glass) in the pediment + cross acroterion
    C.cyl_bm(bm, V((0, OY - HY - 0.02, ZE + 0.85)), V((0, OY - HY - 0.08, ZE + 0.85)), 0.42, 16)
    K.part(bm, LIME, name='oculus_ring', mat_tint=LT)
    bm = bmesh.new()
    C.cyl_bm(bm, V((0, OY - HY - 0.06, ZE + 0.85)), V((0, OY - HY - 0.1, ZE + 0.85)), 0.33, 16)
    K.part(bm, 'glass_dirty', name='oculus_glass', mat_tint=(0.45, 0.3, 0.5), grime=0.1)
    bm = bmesh.new()
    cross(bm, (0, OY - HY - 0.05, R.z_ridge - 0.1), 0.9, 0.5, 0.1)
    K.part(bm, LIME, name='acroterion', mat_tint=LT)
    bm = bmesh.new()                                  # iron + glass lantern on the ridge
    C.cyl_bm(bm, V((0, OY + 0.4, R.z_ridge - 0.15)), V((0, OY + 0.4, R.z_ridge + 0.75)), 0.42, 8)
    K.part(bm, 'glass_dirty', name='lantern_glass', mat_tint=(0.7, 0.8, 0.8), grime=0.3)
    bm = bmesh.new()
    for k in range(8):
        a = 2 * math.pi * k / 8
        C.cyl_bm(bm, V((math.cos(a) * 0.43, OY + 0.4 + math.sin(a) * 0.43, R.z_ridge - 0.15)), V((math.cos(a) * 0.43, OY + 0.4 + math.sin(a) * 0.43, R.z_ridge + 0.75)), 0.025, 4)
    C.cyl_bm(bm, V((0, OY + 0.4, R.z_ridge + 0.75)), V((0, OY + 0.4, R.z_ridge + 1.25)), 0.5, 8, r1=0.04)
    cross(bm, (0, OY + 0.4, R.z_ridge + 1.2), 0.5, 0.28, 0.04)
    K.part(bm, 'cast_iron', name='lantern_iron')
    for i in range(5):
        K.decal('moss_patch', (r.uniform(-HX, HX), OY - HY - 0.01, r.uniform(0.2, 0.7)), (0, -1, 0), r.uniform(0.6, 1.2), 0.5, alpha=0.6)
        r.uniform(-HX + 0.3, HX - 0.3)  # (fix round: no 'streak_long' decals — in game they drew as black bars over the inscription)
    text3d = __import__('fr_common').text3d
    text3d('FAMILLE DUVAL', door.p(0, 2.75, 0.08), door.n, size=0.16, depth=0.02, mid=LIME, tint=(0.55, 0.52, 0.46), name='inscription')
else:
    L, W = 2.0, 1.0
    bm = bmesh.new()
    if VAR == 'tomb_a':
        chslab(bm, 0, 0, L + 0.1, W + 0.1, 0.0, 0.18, 0.02)
        chslab(bm, 0, 0, L - 0.1, W - 0.12, 0.18, 0.78, 0.0)
        chslab(bm, 0, 0, L + 0.02, W, 0.78, 0.92, 0.06)
        K.part(bm, LIME, name='chest', mat_tint=(0.86, 0.83, 0.74), grime=1.2)
        bm = bmesh.new()                              # recessed panels on the long sides
        for s in (-1, 1):
            for x in (-0.45, 0.45):
                K.box_bm(bm, (x, s * (W - 0.12) / 2, 0.48), (0.7, 0.02, 0.4))
        K.part(bm, LIME, name='panels', mat_tint=(0.66, 0.64, 0.57))
        bm = bmesh.new()
        K.box_bm(bm, (L / 2 - 0.25, 0, 0.98), (0.26, 0.4, 0.12))          # a plinth for a tall head cross (reads at zoom 1)
        cross(bm, (L / 2 - 0.25, 0, 1.04), 1.15, 0.62, 0.1)
        K.part(bm, LIME, name='cross', mat_tint=(0.82, 0.8, 0.72))
    elif VAR == 'tomb_b':
        chslab(bm, 0, 0, L + 0.1, W + 0.1, 0.0, 0.25, 0.02)
        chslab(bm, -0.1, 0, L - 0.25, W - 0.05, 0.25, 0.42, 0.05)
        K.part(bm, 'granite_polished', name='ledger', mat_tint=(0.55, 0.55, 0.56))
        bm = bmesh.new()
        prof = [(-0.4, 0), (0.4, 0), (0.4, 0.75)] + [(0.4 * math.cos(a), 0.75 + 0.4 * math.sin(a)) for a in [math.pi * i / 6 for i in range(1, 6)]] + [(-0.4, 0.75)]
        ring0 = [V((L / 2 - 0.12, y, 0.25 + z)) for (y, z) in prof]
        C.loft_bm(bm, [ring0, [p - V((0.14, 0, 0)) for p in ring0]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        cross(bm, (L / 2 - 0.19, 0, 0.25 + 1.13), 0.5, 0.32, 0.08)        # a cross on the arched stele
        K.part(bm, 'granite_polished', name='stele', mat_tint=(0.4, 0.4, 0.42))
        bm = bmesh.new()
        C.cyl_bm(bm, V((-0.2, 0, 0.42)), V((-0.2, 0, 0.47)), 0.22, 12)
        K.part(bm, 'cast_iron', name='wreath', mat_tint=(0.25, 0.3, 0.35))
    else:
        chslab(bm, 0, 0, L + 0.1, W + 0.1, 0.0, 0.2, 0.02)
        chslab(bm, 0, 0, L - 0.08, W - 0.1, 0.2, 0.72, 0.0)
        K.part(bm, LIME, name='sarcophagus', mat_tint=(0.84, 0.82, 0.74), grime=1.4)
        bm = bmesh.new()                              # gabled lid
        hw, hl = (W + 0.02) / 2, (L + 0.06) / 2
        ring = [V((-hl, -hw, 0.72)), V((-hl, hw, 0.72)), V((-hl, hw, 0.8)), V((-hl, 0, 0.98)), V((-hl, -hw, 0.8))]
        C.loft_bm(bm, [ring, [p + V((2 * hl, 0, 0)) for p in ring]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for sx in (-1, 1):
            for sy in (-1, 1):
                K.box_bm(bm, (sx * (hl - 0.08), sy * (hw - 0.08), 0.86), (0.16, 0.16, 0.14))
        K.part(bm, LIME, name='lid', mat_tint=(0.8, 0.78, 0.7), grime=1.4)
        bm = bmesh.new()
        C.cyl_bm(bm, V((-L / 2 + 0.3, 0, 0.92)), V((-L / 2 + 0.3, 0, 1.22)), 0.13, 10, r1=0.2)   # the urn at the foot
        C.cyl_bm(bm, V((-L / 2 + 0.3, 0, 1.22)), V((-L / 2 + 0.3, 0, 1.3)), 0.1, 10)
        K.part(bm, LIME, name='urn', mat_tint=(0.75, 0.73, 0.66))
        bm = bmesh.new()                              # a wrought-iron cross at the head
        cross(bm, (L / 2 - 0.22, 0, 0.88), 1.05, 0.56, 0.06)
        K.part(bm, 'cast_iron', name='iron_cross', mat_tint=(0.2, 0.21, 0.22))
    for i in range(2):
        K.decal('lichen', (r.uniform(-0.8, 0.8), -W / 2 - 0.01, r.uniform(0.15, 0.5)), (0, -1, 0), 0.5, 0.35, alpha=0.55)
    K.footprint(rect(-L / 2, -W / 2, L / 2, W / 2), 'LOW', 'tomb')
report_tris()
tag_lod()
compact()
K.finalize(os.path.join(ROOT, NAME), ao_res=512 if VAR != 'chapel' else 1024, ao_samples=48,
           lods=((0.4, 0.15, 4.0), (0.25, 0.4, 6.0)), recenter=False)
