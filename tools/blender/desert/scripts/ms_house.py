"""M11 Maradah (Libya, Dec 1942) second art pass: the three enterable houses of the oil field, Italian colonial
settlers' houses of the 1930s (the Ente di Colonizzazione's case coloniche) taken over by the field's garrison.
Variants (footprint = the mission's gameplay w x d; front Blender -Y = game S):
  y: `house_y`, 10 x 8, the "double" house in the inner yard: whitewashed rubble walls on a rubble plinth, a hipped
     roof of Marseille tiles, door S at the middle under a bracketed tile hood, two S windows, green shutters, E / W /
     N windows, eave course, water jars and a stencilled board by the door.
  w: `house_w`, 6 x 6, the small house by the W edge (the "small building"): ochre sandstone rubble with dressed
     quoins under a tile gable (ridge E-W), door S at the middle, the lure window W of it, E and W windows.
  l: `house_l`, 5 x 6, the little building in the S lowlands (the Sniper's post): whitewash over mud render, a tile
     gable roof (ridge N-S), door W 0.43 m S of the middle, S and E windows, a palm-frond shade over the door.
Usage: blender -b --python ms_house.py -- outdir VAR [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('y')
NAME = {'y': 'house_colonial_ms_y', 'w': 'house_colonial_ms_w', 'l': 'house_colonial_ms_l'}[VAR]
K.begin(NAME, 11301 + SEED + 17 * ['y', 'w', 'l'].index(VAR), theater='desert')
r = K.rng()
STONE, STONE_T = 'sandstone_ochre', (0.98, 0.94, 0.88)
T = 0.5


def quoins(poly, h, name='quoins'):
    bm = bmesh.new()
    for (x, y) in poly:
        sx, sy = (1 if x > 0 else -1), (1 if y > 0 else -1)
        z, k = 0.45, 0
        while z < h - 0.2:
            l = 0.55 if k % 2 else 0.32
            C.box_bm(bm, (x - sx * (l / 2 - 0.03), y - sy * 0.13 + sy * 0.03, z + 0.15), (l, 0.32, 0.3))
            C.box_bm(bm, (x - sx * 0.13 + sx * 0.03, y - sy * (0.32 if k % 2 else 0.55) / 2 + sy * 0.03, z + 0.15), (0.32, 0.32 if k % 2 else 0.55, 0.3))
            z += 0.32
            k += 1
    K.part(bm, 'ashlar_limestone', name=name, mat_tint=(0.96, 0.92, 0.84), grime=0.8, bisect=False)


def eave_course(poly, z, name='eave'):
    """A projecting moulded course under the eaves (two stepped bands)."""
    bm = bmesh.new()
    for i in range(len(poly)):
        a, b = V((*poly[i], 0)), V((*poly[(i + 1) % len(poly)], 0))
        d = (b - a)
        n = V((d.y, -d.x, 0)).normalized()
        for (o, h, zz) in ((0.06, 0.14, z - 0.07), (0.1, 0.08, z + 0.04)):
            c = (a + b) / 2 + n * (o / 2) + V((0, 0, zz))
            L = d.length + o
            C.beam_bm(bm, c - d.normalized() * L / 2, c + d.normalized() * L / 2, h, o + 0.02)
    K.part(bm, 'plaster_white', name=name, mat_tint=(0.95, 0.93, 0.88), grime=0.6, bisect=False)


def jars(pts, name='jars'):
    bm = bmesh.new()
    for (x, y, rr) in pts:
        C.cyl_bm(bm, V((x, y, 0)), V((x, y, 0.55 + rr * 0.3)), rr, 10, r1=rr * 0.7)
    K.part(bm, 'mud', name=name, mat_tint=(0.8, 0.56, 0.4), grime=0.5, bisect=False, smooth=True)


def base_decals(poly, z=0.4):
    for e in range(len(poly)):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, z))), tuple(n), L * 0.95, 0.6, alpha=0.4)


if VAR == 'y':
    HW, HD, ZE = 5.0, 4.0, 3.2
    poly = rect(-HW, -HD, HW, HD)
    door = K.opening(poly, 0, HW, 1.1, 2.2, 0.0, T, 'segment', 'door')
    wins = [K.opening(poly, 0, HW - 3.0, 0.8, 1.1, 1.0, T, 'segment'), K.opening(poly, 0, HW + 3.0, 0.8, 1.1, 1.0, T, 'segment'),
            K.opening(poly, 1, HD, 0.8, 1.1, 1.0, T, 'segment'), K.opening(poly, 3, HD, 0.8, 1.1, 1.0, T, 'segment'),
            K.opening(poly, 2, HW - 2.5, 0.6, 0.8, 1.4, T, 'rect'), K.opening(poly, 2, HW + 2.5, 0.6, 0.8, 1.4, T, 'rect')]
    K.wall_ring(poly, ZE, T, 'plaster_white', [door] + wins, plinth=('rubble_stone', 0.5, 0.05), name='walls', mat_tint=WASH)
    eave_course(poly, ZE - 0.1)
    KR.roof_hip(0, 0, 2 * HW, 2 * HD, ZE, pitch=24.0, mid='roof_terracotta', eave_oh=0.4, gable_oh=0.4, thick=0.1)
    # the door hood: a short tile pent on two iron brackets
    KR.roof_shed(-1.0, -HD - 0.55, 1.0, -HD + 0.02, 2.55, 2.85, mid='roof_terracotta', thick=0.05, oh=0.05, low_side='-y', name='hood')
    bm = bmesh.new()
    for x in (-0.85, 0.85):
        C.beam_bm(bm, V((x, -HD - 0.02, 2.2)), V((x, -HD - 0.5, 2.55)), 0.04, 0.04)
    K.part(bm, 'cast_iron', name='hood_brackets', mat_tint=(0.3, 0.29, 0.27), bisect=False)
    K.door(door, 'main', 'plank', SHUT_GREEN, step='ashlar', hinge='left', node='door_main', open_deg=0)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.86, 0.84, 0.78), sill='ashlar_limestone', shutters=['open', 'ajar', 'closed', 'open', None, None][k],
                 shutter_color=SHUT_GREEN, curtain=0.0, streak=True, name='w%d' % k)
    jars([(1.6, -HD - 0.4, 0.24), (2.05, -HD - 0.36, 0.2)])
    sign_board((-1.75, -HD - 0.03, 2.1), (0, -1, 0), 0.7, 0.4, name='board', post=False)
    base_decals(poly)
    sand_feet(poly, h=0.2, w=0.75, seed=SEED)
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')

if VAR == 'w':
    HW, HD, ZE = 3.0, 3.0, 2.8
    poly = rect(-HW, -HD, HW, HD)
    door = K.opening(poly, 0, HW, 1.0, 2.05, 0.0, T, 'segment', 'door')
    wins = [K.opening(poly, 0, HW - 1.9, 0.7, 0.9, 1.15, T, 'segment'), K.opening(poly, 1, HD, 0.7, 0.9, 1.15, T, 'segment'),
            K.opening(poly, 3, HD - 0.8, 0.7, 0.9, 1.15, T, 'segment'), K.opening(poly, 2, HW, 0.6, 0.7, 1.5, T, 'rect')]
    K.wall_ring(poly, ZE, T, STONE, [door] + wins, plinth=('rubble_stone', 0.45, 0.04), name='walls', mat_tint=STONE_T)
    quoins(poly, ZE)
    rise = HD * math.tan(math.radians(26.0))
    bm = bmesh.new()
    for x in (-HW + 0.25, HW - 0.25):
        C.hexa_bm(bm, [V((x - 0.25, -HD, ZE)), V((x + 0.25, -HD, ZE)), V((x + 0.25, HD, ZE)), V((x - 0.25, HD, ZE)),
                       V((x - 0.25, -0.02, ZE + rise)), V((x + 0.25, -0.02, ZE + rise)), V((x + 0.25, 0.02, ZE + rise)), V((x - 0.25, 0.02, ZE + rise))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STONE, name='gables', mat_tint=STONE_T, grime=0.8)
    KR.roof_gable(0, 0, 2 * HW, 2 * HD, ZE, pitch=26.0, mid='roof_terracotta', eave_oh=0.3, gable_oh=0.2, thick=0.1)
    K.door(door, 'main', 'plank', (0.32, 0.42, 0.5), step='ashlar', hinge='left', node='door_main', open_deg=0)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.6, 0.52, 0.42), sill='ashlar_limestone', shutters=['ajar', 'open', 'closed', None][k],
                 shutter_color=(0.32, 0.42, 0.5), curtain=0.0, streak=True, name='w%d' % k)
    dz.tabouna((HW + 0.75, 1.6), r=0.45, name='oven')
    base_decals(poly)
    sand_feet(poly, h=0.2, w=0.75, seed=SEED)
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')

if VAR == 'l':
    HW, HD, ZE = 2.5, 3.0, 2.7
    poly = rect(-HW, -HD, HW, HD)
    door = K.opening(poly, 3, HD + 0.43, 1.0, 2.05, 0.0, T, 'rect', 'door')
    wins = [K.opening(poly, 0, HW, 0.7, 0.9, 1.1, T, 'rect'), K.opening(poly, 1, HD, 0.6, 0.8, 1.2, T, 'rect')]
    K.wall_ring(poly, ZE, T, 'plaster_white', [door] + wins, plinth=('rubble_stone', 0.35, 0.04), name='walls', mat_tint=(0.95, 0.92, 0.85))
    # gables N and S (the ridge runs N-S over the narrow house)
    rise = HW * math.tan(math.radians(24.0))
    bm = bmesh.new()
    for y in (-HD + 0.25, HD - 0.25):
        C.hexa_bm(bm, [V((-HW, y - 0.25, ZE)), V((-HW, y + 0.25, ZE)), V((HW, y + 0.25, ZE)), V((HW, y - 0.25, ZE)),
                       V((-0.02, y - 0.25, ZE + rise)), V((-0.02, y + 0.25, ZE + rise)), V((0.02, y + 0.25, ZE + rise)), V((0.02, y - 0.25, ZE + rise))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'plaster_white', name='gables', mat_tint=(0.95, 0.92, 0.85), grime=0.8)
    KR.roof_gable(0, 0, 2 * HD, 2 * HW, ZE, pitch=24.0, mid='roof_terracotta', rot=math.pi / 2, eave_oh=0.3, gable_oh=0.2, thick=0.1)
    K.door(door, 'main', 'plank', (0.45, 0.36, 0.26), step='ashlar', hinge='left', node='door_main', open_deg=0)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.6, 0.52, 0.42), sill='ashlar_limestone', shutters=['closed', 'ajar'][k],
                 shutter_color=SHUT_GREEN, curtain=0.0, streak=True, name='w%d' % k)
    dz.shade(-HW - 1.3, -1.25, -HW + 0.05, 0.4, 2.3, name='shade')
    jars([(-HW - 0.35, 1.2, 0.22), (-HW - 0.4, 1.65, 0.19)])
    base_decals(poly, z=0.3)
    sand_feet(poly, h=0.2, w=0.7, seed=SEED)
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')

dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
