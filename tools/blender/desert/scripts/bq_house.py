"""M9 Bab el Qattara camp houses (the village the 21st Panzer took over). Variants:
  s1 (+ s1_destroyed): `wstore` the weapons store, 8 x 7.5: a rubble-sandstone house with dressed quoins, a pitched
     roof of Marseille tiles on timber purlins (ridge along x), a timber lean-to porch along the W side (1.6 m) piled
     with ammunition boxes behind a sandbag wall, an iron-strapped double door with a padlock bar S at x +2, barred
     windows, a stencilled board. destroyed: roof gone (charred rafters, a tile slope left on the N), walls broken
     down at the S-E, rubble with tiles, soot round the openings only.
  s2, s3: hideout houses 7 x 7 (door S at x -1.5 / -2.5): same masonry; s2 a bread oven, a washing line of uniform
     shirts and a ladder, s3 a palm-frond shade, water jars and a woodpile.
  cp (+ cp_destroyed): the command post, 9 x 7, whitewashed flat-roofed with a parapet, a mud-brick lean-to annex on
     the W (2.4 m), door S at x +2.5 with sandbag cheeks and a sign board, green shutters, a whip aerial and a short
     flagpole (animated flag anchor) on the roof, a field-telephone line. destroyed: roof slab down at the E, breach S,
     soot round the openings.
  ne: `house_ne` the NE hideout, 7 x 6: a whitewashed flat-roofed village house (rubble plinth, lime-screed roof behind a low
     rounded parapet, palm-log spouts), door mid-W with a palm-frond shade, blue shutters, water jars, a washing line N.
Front (Blender -Y) = game S. Usage: blender -b --python bq_house.py -- outdir VAR [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *

OUT, VAR, SEED = args('s1')
DEST = VAR.endswith('destroyed')
KIND = VAR.split('_')[0]
NAME = {'s1': 'house_stone_store_bq', 's2': 'house_stone_bq_a', 's3': 'house_stone_bq_b', 'cp': 'command_post_white_bq', 'ne': 'house_flat_white_bq'}[KIND] + ('_destroyed' if DEST else '')
K.begin(NAME, 9061 + SEED + 13 * ['s1', 's2', 's3', 'cp', 'ne'].index(KIND) + (5 if DEST else 0), theater='desert')
r = K.rng()
STONE, STONE_T = 'sandstone_ochre', (0.98, 0.94, 0.88)


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


def laundry_line(p0, p1, z=1.8, n=4, name='laundry'):
    """Uniform shirts and a towel pegged on a cord between two poles (khaki / sand / off-white)."""
    p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    bm = bmesh.new()
    for p in (p0, p1):
        C.cyl_bm(bm, V((p.x, p.y, 0)), V((p.x, p.y, z + 0.15)), 0.04, 6)
    K.part(bm, 'timber_beam', name=name + '_poles', mat_tint=(0.7, 0.6, 0.48), bisect=False)
    wire(tuple(p0 + V((0, 0, z))), tuple(p1 + V((0, 0, z))), sag=0.12, name=name + '_cord', r=0.006)
    bm = bmesh.new()
    d = (p1 - p0)
    for k in range(n):
        t = (k + 0.7) / (n + 0.4)
        c = p0.lerp(p1, t) + V((0, 0, z - 0.12 * 4 * t * (1 - t) - 0.02))
        w, h = (0.5, 0.62) if k % 3 != 2 else (0.35, 0.7)
        u = d.normalized()
        q = [c - u * w / 2, c + u * w / 2, c + u * w / 2 - V((0, 0, h)) + V((r.uniform(-0.03, 0.03), r.uniform(-0.05, 0.05), 0)), c - u * w / 2 - V((0, 0, h))]
        f = bm.faces.new([bm.verts.new(tuple(v)) for v in q])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    K.part(bm, 'canvas', name=name + '_cloth', mat_tint=(0.86, 0.78, 0.6), grime=0.2, bisect=False)


def stone_house(HWx0, HWx1, HD, ZE, door_x, wins_s, has_e=True):
    poly = rect(HWx0, -HD, HWx1, HD)
    T = 0.5
    door = K.opening(poly, 0, door_x - HWx0, 1.4 if KIND == 's1' else 1.0, 2.2 if KIND == 's1' else 2.05, 0.0, T, 'segment', 'door')
    wins = [K.opening(poly, 0, x - HWx0, 0.7, 0.9, 1.2, T, 'segment') for x in wins_s]
    if has_e:
        wins.append(K.opening(poly, 1, HD, 0.7, 0.9, 1.2, T, 'segment'))
    wins.append(K.opening(poly, 2, (HWx1 - HWx0) / 2, 0.6, 0.7, 1.5, T, 'rect'))
    br = []
    if DEST:
        br = [dz.RagFrame(K.opening(poly, 1, HD * 0.6, 2.0, 2.2, 0.2, T, 'rect', 'breach'), seed=SEED)]
        wins = wins[:-2] + wins[-1:]
    K.wall_ring(poly, ZE, T, STONE, [door] + wins + br, plinth=('rubble_stone', 0.45, 0.04), name='walls', mat_tint=STONE_T)
    quoins(poly, ZE)
    return poly, door, wins


def gable_roof(x0, x1, HD, ZE, pitch=26.0, mid='roof_terracotta'):
    """Gable walls up to the ridge (ridge along x) + the tile roof."""
    rise = HD * math.tan(math.radians(pitch))
    bm = bmesh.new()
    for x in (x0 + 0.25, x1 - 0.25):
        C.hexa_bm(bm, [V((x - 0.25, -HD, ZE)), V((x + 0.25, -HD, ZE)), V((x + 0.25, HD, ZE)), V((x - 0.25, HD, ZE)),
                       V((x - 0.25, -0.02, ZE + rise)), V((x + 0.25, -0.02, ZE + rise)), V((x + 0.25, 0.02, ZE + rise)), V((x - 0.25, 0.02, ZE + rise))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STONE, name='gables', mat_tint=STONE_T, grime=0.8)
    return KR.roof_gable((x0 + x1) / 2, 0, x1 - x0, 2 * HD, ZE, pitch=pitch, mid=mid, eave_oh=0.3, gable_oh=0.2, thick=0.1), rise


if KIND in ('s1', 's2', 's3'):
    if KIND == 's1':
        X0, X1, HD, ZE = -2.4, 4.0, 3.75, 2.9
        poly, door, wins = stone_house(X0, X1, HD, ZE, 2.0, [-0.8])
    elif KIND == 's2':
        X0, X1, HD, ZE = -3.5, 3.5, 3.5, 2.8
        poly, door, wins = stone_house(X0, X1, HD, ZE, -1.5, [1.4])
    else:
        X0, X1, HD, ZE = -3.5, 3.5, 3.5, 2.8
        poly, door, wins = stone_house(X0, X1, HD, ZE, -2.5, [0.6, 2.4], has_e=False)
    if not DEST:
        R, rise = gable_roof(X0, X1, HD, ZE)
    else:   # charred rafters on the wall heads, the N tile slope left half-standing, tiles in the rubble
        rise = HD * math.tan(math.radians(26.0))
        bm = bmesh.new()
        for k in range(6):
            x = X0 + 0.6 + (X1 - X0 - 1.2) * k / 5
            if k in (1, 3, 4):
                C.cyl_bm(bm, V((x, HD - 0.2, ZE)), V((x + r.uniform(-0.2, 0.2), -0.3, ZE + rise * 0.9 - (1.4 if k == 3 else 0))), 0.07, 6)
        C.cyl_bm(bm, V((X0 + 0.3, 0, ZE + rise - 0.1)), V((X1 - 1.5, -0.6, 1.0)), 0.09, 6)
        K.part(bm, 'timber_beam', name='rafters_charred', mat_tint=(0.42, 0.36, 0.3), grime=1.0, bisect=False)
        bm = bmesh.new()
        C.hexa_bm(bm, [V((X0 + 0.2, HD + 0.3, ZE - 0.1)), V((X0 + 3.3, HD + 0.3, ZE - 0.1)), V((X0 + 3.1, 0.6, ZE + rise * 0.8)), V((X0 + 0.2, 0.4, ZE + rise * 0.85)),
                       V((X0 + 0.2, HD + 0.3, ZE)), V((X0 + 3.3, HD + 0.3, ZE)), V((X0 + 3.1, 0.6, ZE + rise * 0.8 + 0.1)), V((X0 + 0.2, 0.4, ZE + rise * 0.85 + 0.1))])
        K.part(bm, 'roof_terracotta', name='tiles_left', mat_tint=(0.8, 0.66, 0.58), grime=1.0, bisect=False)
        K.rubble(((X0 + X1) / 2 + 0.6, -0.3, 0), radius=2.2, height=1.0, mids=('sandstone_ochre', 'rubble_stone'), n=40, beams=4, tiles='roof_terracotta',
                 seed=SEED, name='rubble_in')
        K.rubble((X1 + 1.0, 0.6, 0), radius=1.3, height=0.5, mids=('sandstone_ochre', 'rubble_stone'), n=20, beams=2, tiles='roof_terracotta',
                 seed=SEED + 1, name='rubble_e')
        K.scorch_openings(0.9, 0.7)
        C.A.meta['notes'].append('destroyed variant: roof gone (charred rafters, a tile slope left on the N), E breach, rubble; soot round openings only')
    kind_door = 'double' if KIND == 's1' else 'plank'
    K.door(door, 'main', kind_door, (0.42, 0.36, 0.28) if KIND == 's1' else (0.32, 0.42, 0.5), step='ashlar', hinge='left', node='door_main',
           open_deg=0 if not DEST else 70)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.6, 0.52, 0.42), sill='ashlar_limestone', shutters=None if (DEST or KIND == 's1') else ['open', 'ajar', 'closed'][k % 3],
                 shutter_color=(0.32, 0.42, 0.5) if KIND == 's2' else SHUT_GREEN, bars=KIND == 's1', curtain=0.0, streak=True, name='w%d' % k)
    if KIND == 's1':
        if not DEST:
            # the W porch: posts, a plank lean-to roof, ammunition boxes piled behind a sandbag wall, a padlock bar
            posts([(-3.85, -3.4), (-3.85, 0.0), (-3.85, 3.4)], 0, 2.35, s=0.16, name='porch_posts')
            beams([((-3.9, -3.7, 2.4), (-3.9, 3.7, 2.4))], s=0.16, name='porch_beam')
            KR.roof_shed(-4.05, -3.85, -2.4, 3.85, 2.3, 2.75, mid='corrugated_rust', thick=0.05, oh=0.1, low_side='-x', name='porch_roof')
            bm = bmesh.new()
            for k, (x, y, z) in enumerate(((-3.1, -2.6, 0), (-3.1, -1.9, 0), (-3.05, -2.25, 0.37), (-3.1, 1.6, 0), (-3.1, 2.3, 0), (-3.1, 1.95, 0.37), (-3.1, 2.0, 0.74))):
                dz.crate(bm, (x, y, z), (0.6, 0.62, 0.36), math.pi / 2 + r.uniform(-0.08, 0.08))
            K.part(bm, 'wood_paint', name='porch_boxes', mat_tint=DAK, grime=0.8, bisect=False)
            dz.sandbags((-3.95, -1.2), (-3.95, 1.0), rows=6, name='porch_bags', thick=1, footprint=False)
            bm = bmesh.new()
            C.box_bm(bm, (2.0, -HD - 0.13, 1.25), (1.6, 0.05, 0.1))
            C.box_bm(bm, (2.75, -HD - 0.16, 1.2), (0.08, 0.06, 0.14))
            K.part(bm, 'cast_iron', name='padlock_bar', mat_tint=(0.3, 0.29, 0.27), bisect=False)
            sign_board((0.3, -HD - 0.27, 1.6), (0, -1, 0), 0.8, 0.45, name='store_sign', post=False)
            drums([(3.7, -4.35, 0)], tint=(0.5, 0.52, 0.46), name='water_drum')
    elif KIND == 's2':
        dz.tabouna((2.6, -HD - 0.75), r=0.45, name='oven')
        laundry_line((X0 - 0.7, -2.4), (X0 - 0.7, 1.8), z=1.75, n=4)
        K.ladder((X1 + 0.5, 1.2, 0), ZE - 0.1, (1, 0, 0), width=0.45, lean=0.5, mid='timber_grey', name='ladder', meta=False)
    else:
        bm = bmesh.new()
        for k, (x, y) in enumerate(((0.8, -HD - 0.4), (1.25, -HD - 0.38))):
            C.cyl_bm(bm, V((x, y, 0)), V((x, y, 0.62)), 0.22, 10, r1=0.13)
        K.part(bm, 'mud', name='jars', mat_tint=(0.8, 0.56, 0.4), grime=0.4, bisect=False, smooth=True)
        dz.shade(1.7, -HD - 1.2, 3.3, -HD + 0.05, 2.2, name='shade')
    for e in range(4):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.4))), tuple(n), L * 0.95, 0.6, alpha=0.4)
    sand_feet(poly, h=0.2, w=0.75, seed=SEED, skip=(3,) if KIND == 's1' else ())
    K.footprint(rect(-4.0 if KIND == 's1' else X0, -HD, X1, HD), 'HIGH', 'building')

if KIND == 'ne':
    HW, HD, ZE, T = 3.5, 3.0, 3.1, 0.45
    poly = rect(-HW, -HD, HW, HD)
    door = K.opening(poly, 3, HD, 1.0, 2.05, 0.0, T, 'rect', 'door')                 # W face, mid-wall
    wins = [K.opening(poly, 0, 2.0, 0.75, 0.95, 1.25, T), K.opening(poly, 0, 5.0, 0.75, 0.95, 1.25, T),
            K.opening(poly, 1, 3.0, 0.7, 0.9, 1.3, T), K.opening(poly, 2, 2.2, 0.6, 0.7, 1.55, T)]
    K.wall_ring(poly, ZE, T, 'plaster_white', [door] + wins, plinth=('rubble_stone', 0.35, 0.04), name='walls', mat_tint=WASH)
    dz.roof_slab(poly, ZE + 0.2, 0.22, 'screed_lime', oh=0.04, name='roof', tint=(0.9, 0.86, 0.79))
    dz.parapet(poly, ZE + 0.2, 0.4, 0.22, 'plaster_white', style='round', mat_tint=WASH, climb=False, name='parapet')
    dz.spouts(poly, ZE + 0.25, every=3.5, mid='palm_log', skip=(3,))
    K.door(door, 'main', 'plank', (0.3, 0.42, 0.52), step='ashlar', hinge='left', node='door_main', open_deg=0)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 2), frame=(0.86, 0.84, 0.78), sill='ashlar_limestone', shutters=['open', 'ajar', 'closed', 'open'][k],
                 shutter_color=(0.3, 0.42, 0.52), curtain=0.0, streak=True, name='w%d' % k)
    # palm-frond shade over the W door on two poles, water jars by the door, a washing line along the N wall
    dz.shade(-HW - 1.5, -1.2, -HW + 0.05, 1.2, 2.3, name='shade')
    bm = bmesh.new()
    for k, (x, y, rr) in enumerate(((-HW - 0.35, 1.0, 0.24), (-HW - 0.4, 1.5, 0.2), (-HW - 0.3, -1.0, 0.22))):
        C.cyl_bm(bm, V((x, y, 0)), V((x, y, 0.55 + 0.05 * k)), rr, 10, r1=rr * 0.7)
    K.part(bm, 'mud', name='jars', mat_tint=(0.8, 0.55, 0.4), grime=0.6, bisect=False, smooth=True)
    laundry_line((-2.4, HD + 0.9), (2.2, HD + 0.9), z=1.75, n=4, name='laundry')
    for e in range(4):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.35))), tuple(n), L * 0.95, 0.5, alpha=0.4)
    sand_feet(poly, h=0.2, w=0.75, seed=SEED, skip=(3,))
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')

if KIND == 'cp':
    HW, HD, ZE, AX = 4.5, 3.5, 3.6, -2.1          # main block x AX..HW; the mud-brick annex x -HW..AX (lower)
    T = 0.45
    poly = rect(AX, -HD, HW, HD)
    door = K.opening(poly, 0, 2.5 - AX, 1.1, 2.2, 0.0, T, 'rect', 'door')
    wins = [K.opening(poly, 0, 0.0 - AX, 0.85, 1.1, 1.2, T), K.opening(poly, 1, 1.8, 0.85, 1.1, 1.2, T), K.opening(poly, 1, 5.2, 0.85, 1.1, 1.2, T),
            K.opening(poly, 2, 2.0, 0.7, 0.8, 1.5, T)]
    br = []
    if DEST:
        br = [dz.RagFrame(K.opening(poly, 0, 4.6 - AX - 1.0, 1.6, 2.0, 0.3, T, 'rect', 'breach'), seed=SEED)]
        wins = wins[1:]
    K.wall_ring(poly, ZE, T, 'plaster_white', [door] + wins + br, plinth=('rubble_stone', 0.4, 0.04), name='walls', mat_tint=WASH)
    if not DEST:
        dz.roof_slab(poly, ZE + 0.25, 0.25, 'screed_lime', oh=0.04, name='roof', tint=(0.9, 0.87, 0.8))
    else:
        dz.roof_slab(rect(AX, -HD, 1.4, HD), ZE + 0.25, 0.25, 'screed_lime', oh=0.04, name='roof', tint=(0.84, 0.8, 0.74))
        bm = bmesh.new()
        C.hexa_bm(bm, [V((1.4, -HD, ZE)), V((HW, -HD, 1.0)), V((HW, HD, 1.3)), V((1.4, HD, ZE)),
                       V((1.4, -HD, ZE + 0.25)), V((HW, -HD, 1.25)), V((HW, HD, 1.55)), V((1.4, HD, ZE + 0.25))])
        K.part(bm, 'screed_lime', name='slab_down', mat_tint=(0.7, 0.66, 0.6), grime=1.0)
        K.rubble((HW + 0.9, -0.5, 0), radius=1.4, height=0.5, mids=('rubble_stone', 'plaster_white'), n=22, beams=2, tiles=None, seed=SEED, name='rubble_e')
    dz.parapet(poly, ZE + 0.25, 0.55, 0.25, 'plaster_white', style='round', mat_tint=WASH, climb=False, name='parapet')
    dz.spouts(poly, ZE + 0.3, every=4.0, mid='palm_log', skip=(3,))
    # the annex: mud brick under a worn render, palm-joist flat roof at 2.6, a doorway into the main block
    ap = rect(-HW, -HD + 0.4, AX + 0.02, HD - 0.4)
    adoor = K.opening(ap, 0, 1.2, 0.85, 1.9, 0.0, 0.4, 'rect', 'door')
    K.wall_ring(ap, 2.5, 0.4, 'mud_render', [adoor], plinth=('mudbrick', 0.35, 0.03), name='annex', mat_tint=(0.96, 0.9, 0.82))
    dz.roof_slab(ap, 2.62, 0.14, 'mud_render', oh=0.06, name='annex_roof', tint=(0.92, 0.86, 0.78))
    dz.joists(ap, 2.4, [3], 0.55, r=0.07, out=0.2, mid='palm_log', name='annex_joists')
    K.door(adoor, 'annex', 'plank', (0.45, 0.4, 0.32), step=None, hinge='left', open_deg=30)
    K.door(door, 'main', 'panel', SHUT_GREEN if not DEST else (0.24, 0.24, 0.22), step='ashlar', hinge='left', node='door_main', open_deg=0 if not DEST else 75)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (2, 2), frame=(0.86, 0.84, 0.78), sill='ashlar_limestone', shutters=None if DEST else ['open', 'ajar', 'open', 'closed'][k],
                 shutter_color=SHUT_GREEN, curtain=0.0, streak=True, name='w%d' % k)
    if not DEST:
        for s in (-1, 1):
            dz.sandbags((2.5 + s * 0.75, -HD - 0.4), (2.5 + s * 1.85, -HD - 0.4), rows=6, name='bags_door%d' % (s + 1), thick=2, footprint=False)
        sign_board((0.9, -HD - 0.03, 2.4), (0, -1, 0), 0.8, 0.45, name='cp_sign', post=False)
        whip(HW - 0.4, HD - 0.4, ZE + 0.8, 5.0, name='whip')
        bm = bmesh.new()                                  # short flagpole on the parapet's SE corner (animated cloth)
        C.cyl_bm(bm, V((HW - 0.3, -HD + 0.3, ZE + 0.8)), V((HW - 0.3, -HD + 0.3, ZE + 3.6)), 0.04, 6)
        K.part(bm, 'cast_iron', name='flagpole', mat_tint=(0.35, 0.34, 0.3), bisect=False)
        K.anchor('flag', (HW - 0.25, -HD + 0.3, ZE + 3.5), (1, 0, 0), kind='flag', w=1.2, h=0.8)
        jerrycans((HW + 0.35, 2.2, 0), n=3, rot=math.pi / 2)
    else:
        K.scorch_openings(0.9, 0.6)
        C.A.meta['notes'].append('destroyed variant: E half of the roof slab down, S breach, rubble; soot round openings only')
    for e in range(4):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.4))), tuple(n), L * 0.95, 0.6, alpha=0.4)
    sand_feet(poly, h=0.22, w=0.8, seed=SEED, skip=(3,))
    K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')

dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
