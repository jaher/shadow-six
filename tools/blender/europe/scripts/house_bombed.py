"""Bombed-out two-storey house (M6 'Menace of the Leopold' entry ruin; reusable anywhere): roofless stone shell with
jagged wall tops and blast breaches, plastered interior faces, partly collapsed first floor on joists, white interior
stair (ground -> first floor), interior ladder (first floor -> surviving attic platform), round corner turret with a
holed conical roof, grandfather clock, charred rafters, fallen joists, rubble inside and out.
Gameplay: interior is walkable (wall strips are HIGH footprints, interior NONE), first floor + attic registered as
walkable 'floor' roofs, ladder + stair links, climbable wall top next to the turret.
 a = M6: grey stone + turret      b = brick town house, no turret, more collapsed (generic Normandy/Belgium ruin)
usage: blender -b --python house_bombed.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, floor_slab, finish, scorch_openings, use_cheap_windows
use_cheap_windows()
import eu_dmg, random

OUT, VAR, SEED = args('house_bombed_a')
K.begin('house_bombed_' + VAR, SEED, theater='temperate')
r = K.rng()
TUR = VAR == 'a'
STONE = 'fieldstone_grey' if VAR == 'a' else 'brick_red'
DR = 'ashlar' if VAR == 'a' else 'ashlar_limestone'
L, W, T = 11.0, 8.0, 0.55
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
inner = K.poly_offset(poly, -T)
F1, ZE, ZA = 3.2, 6.6, 6.0

fr = [K.opening(poly, 0, 3.0, 1.2, 2.3, 0.15, T, 'segment', 'door'),
      K.opening(poly, 0, 6.0, 1.0, 1.5, 1.0, T), K.opening(poly, 0, 8.6, 1.0, 1.5, 1.0, T),
      K.opening(poly, 0, 3.0, 1.0, 1.5, F1 + 0.9, T), K.opening(poly, 0, 6.0, 1.0, 1.5, F1 + 0.9, T), K.opening(poly, 0, 8.6, 1.0, 1.5, F1 + 0.9, T),
      K.opening(poly, 2, 2.5, 1.0, 1.5, 1.0, T), K.opening(poly, 2, 7.5, 1.0, 2.1, 0.1, T, 'rect', 'door'),
      K.opening(poly, 2, 2.5, 1.0, 1.5, F1 + 0.9, T), K.opening(poly, 2, 7.5, 1.0, 1.5, F1 + 0.9, T),
      K.opening(poly, 3, 2.0, 0.9, 1.3, 1.1, T), K.opening(poly, 3, 5.5, 0.9, 1.3, F1 + 0.9, T),
      K.opening(poly, 1, 4.0, 0.9, 1.3, 1.1, T), K.opening(poly, 1, 4.0, 0.9, 1.3, F1 + 0.9, T)]
K.wall_ring(poly, ZE, T, STONE, fr, plinth=(DR, 0.5, 0.05), name='walls', footprint=False)
K.wall_ring(inner, ZE - 0.2, 0.03, 'plaster_rough', fr, name='plaster_in', footprint=False, mat_tint=(0.95, 0.93, 0.88))
K.gable(poly, 3, ZE, ZE + 3.4, T, STONE, name='gable_w')
if VAR == 'a':
    K.quoins(poly, 0.5, ZE, DR, corners=(0, 1, 3))
else:
    K.course(poly, F1 - 0.15, 0.18, 0.05, DR, name='band')
for k, f in enumerate(fr):
    if f.kind == 'window':
        K.window(f, 'casement', (1, 3), frame=(0.55, 0.53, 0.5), sill=DR, lintel=DR, shutters=('ajar' if k % 3 == 0 else None),
                 shutter_color=(0.35, 0.36, 0.33), curtain=0.0, interior=False, streak=True, name='w%d' % k)
K.door(fr[0], 'front', 'plank', (0.3, 0.26, 0.22), open_deg=70, step=DR, lintel=DR)
K.door(fr[7], 'back', 'plank', (0.3, 0.26, 0.22), open_deg=0, step=None, lintel='timber_beam')

# turret on the NE corner (16-gon ring, conical roof)
if TUR:
    tc, tr = V((x1 - 0.2, y1 - 0.2, 0)), 2.0
    tp = [(tc.x + math.cos(2 * math.pi * k / 16) * tr, tc.y + math.sin(2 * math.pi * k / 16) * tr) for k in range(16)]
    tf = [K.opening(tp, 2, 0.4, 0.6, 1.1, 4.2, 0.5, 'arch'), K.opening(tp, 14, 0.4, 0.6, 1.1, 1.4, 0.5, 'arch'),
          K.opening(tp, 0, 0.4, 0.6, 1.0, 7.0, 0.5, 'arch')]
    K.wall_ring(tp, 9.0, 0.5, STONE, tf, plinth=(DR, 0.5, 0.06), name='turret', footprint=False)
    K.course(tp, 8.6, 0.25, 0.12, DR, name='turret_cornice')
    for k, f in enumerate(tf):
        K.window(f, 'fixed', (1, 2), frame=(0.4, 0.4, 0.4), sill=DR, curtain=0.0, interior=True, name='tw%d' % k)
    K.footprint(tp, 'HIGH', 'turret')

# ---- floors, stair, ladder ------------------------------------------------------------------------------------------
ix0, ix1, iy0, iy1 = x0 + T, x1 - T, y0 + T, y1 - T
sw0, sw1, swy = ix0 + 3.35, ix0 + 4.45, iy0 + 4.9          # stairwell opening in the first floor
floor_slab([(ix0, iy0), (sw0, iy0), (sw0, iy1), (ix0, iy1)], F1, name='floor1a')
floor_slab([(sw0, swy), (sw1, swy), (sw1, iy1), (sw0, iy1)], F1, name='floor1b')
floor_slab([(sw1, iy0), (ix1, iy0), (ix1, iy1), (sw1, iy1)], F1, name='floor1c')
floor_slab([(ix0, iy0), (ix0 + 3.0, iy0), (ix0 + 3.0, iy1), (ix0, iy1)], ZA, name='attic')
K.P('floor_checker', K.box_bm, ((ix0 + ix1) / 2, 0, 0.03), (ix1 - ix0, iy1 - iy0, 0.06), name='ground_floor', grime=0.6)   # M6: checker tiles
# partition wall with doorway
pw = [(0.6, iy0), (0.8, iy0), (0.8, iy1), (0.6, iy1)]
pd = K.opening(pw, 1, 2.0, 1.0, 2.1, 0.0, 0.2, 'rect', 'door')
K.wall_ring(pw, F1 - 0.05, 0.2, 'plaster_rough', [pd], name='partition', footprint=False, mat_tint=(0.93, 0.9, 0.84))
# white stair (ground -> first floor) along the west half, landing hole in floor1
K.stairs((ix0 + 3.9, iy0 + 0.4, 0), (0, 1, 0), 1.0, F1, 16, 'plaster_white', solid=True, name='white_stair')
K.ladder((ix0 + 3.3, 2.6, F1), ZA - F1, (1, 0, 0), meta=False, name='ladder_attic')
K.ladder_meta((ix0 + 3.7, 2.6), (ix0 + 2.6, 2.6), ZA)
K.roof_meta([(ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1)], F1, walkable=True, kind='floor')
K.roof_meta([(ix0, iy0), (ix0 + 3.0, iy0), (ix0 + 3.0, iy1), (ix0, iy1)], ZA, walkable=True, kind='floor')
K.anchor('decoy_spot', (ix0 + 3.9, iy0 + 4.6, F1), (0, 1, 0), kind='stair_top')
# grandfather clock + table + chairs on the ground floor
bm = bmesh.new()
K.box_bm(bm, (ix0 + 0.3, 1.5, 1.0), (0.45, 0.35, 2.0))
K.box_bm(bm, (ix0 + 0.3, 1.5, 2.12), (0.55, 0.42, 0.24))
K.part(bm, 'wood_paint', name='clock_case', mat_tint=(0.35, 0.22, 0.14))
K.P('plaster_white', K.cyl_bm, (ix0 + 0.53, 1.5, 1.7), (ix0 + 0.56, 1.5, 1.7), 0.17, 12, name='clock_face', mat_tint=(0.95, 0.92, 0.8))
bm = bmesh.new()
K.box_bm(bm, (-2.5, -0.8, 0.75), (1.6, 0.9, 0.06), 0.3)
for dx, dy in ((-0.7, -0.35), (0.7, -0.35), (-0.7, 0.35), (0.7, 0.35)):
    K.box_bm(bm, (-2.5 + dx * 0.95 - dy * 0.3, -0.8 + dy + dx * 0.3, 0.37), (0.06, 0.06, 0.74))
K.box_bm(bm, (-1.2, -1.9, 0.12), (0.45, 0.45, 0.06), 1.1)          # toppled chair seat
K.part(bm, 'timber_beam', name='table', uv='beam', axis=(1, 0, 0), tint=(0.7, 0.55, 0.42))

# ---- damage (M6: roofless shell, ragged stepped wall heads, ruined turret, rubble + fallen joists + furniture inside) ----
rq = random.Random(SEED)
shell = lambda o: o.name.startswith(('walls', 'plaster_in', 'gable', 'quoins', 'band', 'w', 'turret', 'tw', 'floor1', 'attic'))
bx = []
for e_, (zl, zh, keep) in enumerate(((F1 + 0.9, ZE - 0.3, 0.6), (F1 + 1.6, ZE, 0.9), (F1 + 1.2, ZE - 0.2, 0.6), (ZA + 0.6, ZE + 2.2, 1.2))):
    a_, b_ = poly[e_], poly[(e_ + 1) % 4]
    b__, _ = eu_dmg.ragged_boxes(a_, b_, zh, zl, thick=T + 0.9, seed=SEED + e_, seg=(0.4, 1.4), keep_ends=keep)
    bx += b__
if TUR:
    for k in range(16):                                   # turret: broken, stepped top, one side standing higher
        a0 = 2 * math.pi * k / 16
        d_ = V((math.cos(a0), math.sin(a0), 0))
        zt = 6.4 + 2.2 * (0.5 + 0.5 * math.cos(a0 - 0.8)) + rq.uniform(-0.4, 0.4)
        bx.append(eu_dmg.Box(tc + d_ * tr + V((0, 0, (zt + 16) / 2)), d_, V((-d_.y, d_.x, 0)), (0, 0, 1), (0.6, 0.45, (16 - zt) / 2)))
eu_dmg.carve(bx, only=shell)
hits = [((x1 - 2.5, y0, 2.0), 1.5, (1.2, 1.2, 1.35)), ((x1 - 3.2, -0.8, F1), 2.3, (1.3, 1.25, 0.35)),     # front breach + floor collapse
        ((x1, -1.5, 4.5), 1.4, (1.0, 1.2, 1.4))]
if VAR == 'b':
    hits += [((x0 + 2.0, y1, 3.8), 1.8, (1.2, 1.2, 1.4)), ((0, 0, F1), 2.0, (1.4, 1.2, 0.35))]
for i, (c, rad, sq) in enumerate(hits):
    eu_dmg.blast(c, rad, 0.0, sq, SEED + 5 + i, mids=(STONE,), brick=VAR == 'b', only=shell)
# fallen joists hanging from the floor edge, a few charred rafter stumps on the west gable, a leaning principal
bm = bmesh.new()
for k in range(5):
    x = x1 - 4.4 + k * 0.55
    eu_dmg.splinter_bm(bm, V((x, 0.3 + rq.uniform(-0.3, 0.3), F1 - 0.12)), V((x + rq.uniform(-0.5, 0.5), -2.4, 0.25)), 0.1, 0.2, rq, 0.3)
for k in range(3):
    x = x0 + 0.4 + k * 0.7
    eu_dmg.splinter_bm(bm, V((x, y0 + 0.4, ZE - 0.1)), V((x, -1.0 + k * 0.4, ZE + 1.6 - k * 0.3)), 0.1, 0.16, rq, 0.3)
eu_dmg.splinter_bm(bm, V((x0 + 1.2, y1 - 0.4, ZA + 0.1)), V((x0 + 3.8, 0.4, 0.4)), 0.2, 0.24, rq, 0.5)
K.part(bm, 'timber_tarred', name='charred_timbers', uv='beam', axis=(1, 0, 0), tint=(0.55, 0.5, 0.45))
# furniture debris: toppled cupboard, broken chairs, a bed frame fallen through, picture frame, stove pipe
bm = bmesh.new()
K.box_bm(bm, (x1 - 1.6, 1.8, 0.35), (1.9, 0.55, 0.7), 0.25)
K.box_bm(bm, (x1 - 4.6, -2.4, 0.5), (1.9, 0.9, 0.08), 0.1)
for dx in (-0.9, 0.9):
    K.box_bm(bm, (x1 - 4.6 + dx, -2.4, 0.3), (0.08, 0.9, 0.6), 0.1)
for cx_, cy_ in ((-3.2, 1.8), (1.8, -2.2)):
    K.box_bm(bm, (cx_, cy_, 0.12), (0.45, 0.45, 0.05), rq.uniform(0, 3))
    K.beam_bm(bm, (cx_ - 0.2, cy_, 0.1), (cx_ - 0.1, cy_ + 0.5, 0.5), 0.04, 0.04)
K.part(bm, 'wood_paint', name='furniture_debris', mat_tint=(0.4, 0.28, 0.2), uv='beam', axis=(1, 0, 0))
K.P('cast_iron', K.cyl_bm, (ix0 + 1.5, iy1 - 0.3, 0.05), (ix0 + 2.8, iy1 - 0.9, 0.35), 0.08, 6, name='stove_pipe')
eu_dmg.heap(V((x1 - 3.0, -1.3, 0.06)), 2.1, 1.1, stone=STONE, dress=DR, brick='brick_red' if VAR == 'b' else None, tiles='roof_slate',
            seed=SEED, name='heap_in', footprint=False, n=18)
eu_dmg.heap(V((x1 - 2.4, y0 - 1.5, 0)), 2.2, 0.9, stone=STONE, dress=DR, brick='brick_red' if VAR == 'b' else None, tiles='roof_slate',
            seed=SEED + 1, name='heap_front', n=18)
eu_dmg.heap(V((0.6, y1 + 1.2, 0)), 1.7, 0.7, stone=STONE, dress=None, tiles='roof_slate', seed=SEED + 2, name='heap_back', n=16)
eu_dmg.heap(V((-2.8, 0.8, 0.06)), 1.3, 0.5, stone=STONE, dress=None, tiles='roof_slate', seed=SEED + 3, name='heap_in2', footprint=False, n=12)
eu_dmg.heap(V((ix0 + 1.6, 1.2, F1 + 0.02)), 1.2, 0.45, stone=STONE, dress=None, tiles='roof_slate', seed=SEED + 4, name='heap_f1',
            footprint=False, n=10, beams=2, planks=2)                        # debris on the surviving first floor
eu_dmg.carve(eu_dmg.blast_boxes((ix1 - 1.2, iy1 - 1.4, F1), 1.2, 0.3, (1.2, 1.2, 0.4), 0.25, 0.5, SEED + 9)[0],
             only=lambda o: o.name.startswith('floor1'))                     # second hole in the first floor
scorch_openings(0.55)
for i in range(4):                                        # smoke-blackened plaster + cracks (no rectangular smudges)
    K.decal('streak_long', (rq.uniform(x0 + 1, x1 - 1), y0 - 0.02, rq.uniform(2.0, 4.0)), (0, -1, 0), rq.uniform(0.6, 1.0), 2.2, alpha=0.28)
    K.decal('crack', (rq.uniform(x0 + 1, x1 - 1), y0 - 0.02, rq.uniform(1.0, 3.5)), (0, -1, 0), 0.9, 1.2, alpha=0.6)

# ---- nav metadata: wall strips (HIGH) with gaps at the ground breaches; interior walkable ------------------------------
K.footprint([(x0, y0), (x1 - 3.4, y0), (x1 - 3.4, y0 + T), (x0, y0 + T)], 'HIGH', 'wall')
K.footprint([(x1 - 0.3, y0), (x1, y0), (x1, y0 + T), (x1 - 0.3, y0 + T)], 'HIGH', 'wall')
K.footprint([(x1 - T, y0), (x1, y0), (x1, y1), (x1 - T, y1)], 'HIGH', 'wall')
K.footprint([(x0, y1 - T), (x1, y1 - T), (x1, y1), (x0, y1)], 'HIGH', 'wall')
K.footprint([(x0, y0), (x0 + T, y0), (x0 + T, y1), (x0, y1)], 'HIGH', 'wall')
K.footprint([(0.6, iy0), (0.8, iy0), (0.8, iy0 + 1.5), (0.6, iy0 + 1.5)], 'HIGH', 'wall')
K.footprint([(0.6, iy0 + 2.5), (0.8, iy0 + 2.5), (0.8, iy1), (0.6, iy1)], 'HIGH', 'wall')
K.footprint([(x1 - 3.4, y0 - 0.1), (x1 - 0.3, y0 - 0.1), (x1 - 0.3, y0 + T + 0.1), (x1 - 3.4, y0 + T + 0.1)], 'LOW', 'breach')
K.climb_meta((x0, y1), (x0, y0), 5.2, kind='ruin_wall')
K.climb_meta((x0, y1), (x1 - 2.2, y1), 5.4, kind='ruin_wall')
finish(OUT)
