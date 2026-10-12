"""M19 Oldenburg coal mine + V2 base buildings (north Germany, January 1945).
 o  mine_office_de     12 x 9 x 9 timber mine office (Zechenbuero) on 3 m creosoted stilts: dark-stained board-and-batten
                       hall, white six-pane casements, red plain-tile gable roof with a brick stack, an E deck with a timber stair
                       down to the SE corner (all inside the footprint), cross-braced legs, notice board, lamp, flagpole
 b  boiler_house_de    10 x 11 x 7 brick boiler house (Kesselhaus): clinker brick with pilaster strips and a dentil
                       eaves band, tall segmental iron-glazed windows, a roof ridge vent, coal chute and a sliding door
 k  barracks_corr_a    8 x 7 x 5 corrugated-iron gable barracks on a timber frame, door W, flag
 K  barracks_corr_b    12 x 9 x 6 the larger one (two stovepipes, a porch at the W door)
 t  house_tall_brick_de 4 x 5 x 11 tall narrow brick house (3 storeys + steep gable), door S
 p  pithead_adit_de  7 x 10 x 4.5 drift-mine pithead: silver-grey plank shed on a rubble base against the cliff, a flat
                       corrugated-iron roof (walked by a sentry, kerb boards), a dressed-stone adit portal (Mundloch) on the W
                       face on the rail line, the SE corner canted 45 deg for the 15 deg mine rail's open portal (its 2.6 m bed
                       clear of every wall) under a cantilevered roof bay, men's door SE, ladder N
 h  hut_timber_de      9 x 8 x 5 timber hut with a big tar-paper roof, door S
usage: blender -b --python olden.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from od_common import *
from eu_common import floor_slab
use_cheap_windows()
use_cheap_doors()

ROOT, VAR, SEED = args('o')
NAME = {'o': 'mine_office_de', 'b': 'boiler_house_de', 'k': 'barracks_corr_a', 'K': 'barracks_corr_b',
        't': 'house_tall_brick_de', 'h': 'hut_timber_de', 'p': 'pithead_adit_de'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
STAIN = (0.46, 0.36, 0.28)          # dark-stained boards

if VAR == 'o':
    FZ, T, ZE = 3.0, 0.16, 6.1             # floor level, wall thickness, eave
    bx0, bx1, by0, by1 = -6.0, 3.9, -3.9, 4.5           # (S face 0.6 m in: the cliff's foot bulges at the SW corner)
    body = rect(bx0, by0, bx1, by1)
    # stilts: a 4 x 3 grid under the body + 2 under the deck, cross-braced; a sill beam ring at the floor
    xs, ys = (-5.2, -2.3, 0.7, 3.7), (-3.3, 0.5, 4.3)
    legs = [(x, y) for x in xs for y in ys] + [(5.85, 0.3), (5.85, 4.3)]
    posts(legs, 0.0, FZ, 0.26)
    bm = bmesh.new()
    for (x, y) in legs:                     # concrete pad footings
        K.box_bm(bm, (x, y, 0.1), (0.6, 0.6, 0.3))
    K.part(bm, 'concrete_board', name='footings', mat_tint=(0.7, 0.7, 0.68), grime=1.5)
    br = []
    for y in (ys[0], ys[2]):
        for a, b in zip(xs, xs[1:]):
            br.append(((a, y, 0.3), (b, y, FZ - 0.35)))
    for x in (xs[0], xs[3]):
        for a, b in zip(ys, ys[1:]):
            br.append(((x, a, FZ - 0.35), (x, b, 0.3)))
    braces(br, 0.11)
    floor_slab(rect(bx0 - 0.1, by0 - 0.1, bx1 + 0.1, by1 + 0.1), FZ, 0.24, 'deck_planks', name='floor', joists=True, tint=(0.6, 0.55, 0.48))
    door = K.opening(body, 1, 6.7, 1.0, 2.15, FZ, T, 'rect', 'door')         # E wall, onto the deck (N half)
    wins = [K.opening(body, 0, t, 1.0, 1.35, FZ + 0.95, T) for t in (1.6, 4.1, 6.6, 8.4)]
    wins += [K.opening(body, 2, t, 1.0, 1.35, FZ + 0.95, T) for t in (1.5, 4.0, 6.5, 8.6)]
    wins += [K.opening(body, 3, 4.5, 1.0, 1.35, FZ + 0.95, T), K.opening(body, 1, 2.6, 0.9, 1.2, FZ + 1.0, T)]
    K.wall_ring(body, ZE - FZ, T, 'board_batten', [door] + wins, z0=FZ, name='walls', mat_tint=STAIN, grime=1.1, footprint=False)
    K.footprint(rect(-6, -4.5, 6, 4.5), 'HIGH', 'building')
    zr = ZE + (by1 - by0) / 2 * math.tan(math.radians(33))
    for e in (1, 3):
        K.gable(body, e, ZE, zr, T, 'board_batten', [], name='gable%d' % e, mat_tint=STAIN)
    R = K.roof_gable((bx0 + bx1) / 2, (by0 + by1) / 2, bx1 - bx0, by1 - by0, ZE, 33, 'roof_tile_flat', eave_oh=0.45, gable_oh=0.35, thick=0.1,
                     fascia='timber_beam', barge='timber_beam', gutters=False, sag=0.03)   # (no downpipe into the cliff at the SW)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (1, 3), frame='white', recess=0.06, sill='timber_beam', lintel=None, curtain=0.4,
                 shutters=None, streak=False, name='w%d' % k)
    K.door(door, 'front', 'panel', DOOR['brown'] if 'brown' in DOOR else (0.35, 0.25, 0.18), step=None)
    # E deck (x 3.9 .. 6.1) at the floor level: N half landing, S half the stair down to the SE corner
    bm = bmesh.new()
    K.box_bm(bm, (5.0, 2.3, FZ - 0.06), (2.2, 4.4, 0.12))
    K.part(bm, 'deck_planks', name='deck', mat_tint=(0.55, 0.5, 0.42))
    K.stairs((5.05, -3.9, 0.0), (0, 1, 0), 1.3, FZ, 14, 'timber_beam', solid=False, name='stair', meta=False)
    K.railing((6.05, 0.1, FZ), (6.05, 4.45, FZ), 1.0, 'timber', name='deck_rail_e')
    K.railing((3.95, 4.45, FZ), (6.05, 4.45, FZ), 1.0, 'timber', name='deck_rail_n')
    K.railing((5.72, -3.85, 0.2), (5.72, 0.1, FZ), 1.0, 'timber', name='stair_rail')
    K.roof_shed(3.9, 0.1, 6.35, 4.6, ZE - 0.95, ZE - 0.45, 'tar_paper', low_side='+x', oh=0.15, name='deck_roof', thick=0.06)
    posts([(6.1, 0.2), (6.1, 4.45)], FZ, ZE - 0.95, 0.14)
    K.chimney(-2.0, 1.4, zr - 1.6, zr + 0.9, 0.6, 0.6, 'brick_red', cap='concrete_board', pots=1)
    K.anchor('smoke', (-2.0, 1.4, zr + 1.0), (0, 0, 1), kind='smoke')
    K.sign((door.o.x + 0.03, 3.9, FZ + 1.55), (1, 0, 0), 0.9, 'kommandantur', board='timber_grey')
    K.wall_lantern((bx1, 1.2, 0), (1, 0, 0), FZ + 2.3)
    flagpole(1.0, 5.2, 0.0, 10.5)
    coal_dust([((bx0, by0), (bx1, by0), (0, -1)), ((bx1, by1), (bx0, by1), (0, 1))], n=3, seed=SEED, z=FZ + 0.25, alpha=0.22)
    eave_streaks([((bx0, by0), (bx1, by0)), ((bx1, by1), (bx0, by1))], ZE - 0.3, n=3, seed=SEED, alpha=0.3)
    roof_tone(R, seed=SEED)
    roof_decals(R, 3, seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))

if VAR == 'b':
    T, ZE, PITCH = 0.38, 5.0, 22
    x0, x1, y0, y1 = -5.0, 5.0, -5.5, 5.5
    P = rect(x0, y0, x1, y1)
    door = K.opening(P, 0, 3.0, 2.6, 3.0, 0.0, T, 'segment', 'door')            # S gable: big sliding door
    wins = [K.opening(P, 0, 7.0, 1.4, 2.6, 1.1, T, 'segment')]
    wins += [K.opening(P, 1, t, 1.3, 2.6, 1.3, T, 'segment') for t in (1.8, 5.5, 9.2)]
    wins += [K.opening(P, 3, t, 1.3, 2.6, 1.3, T, 'segment') for t in (1.8, 5.5, 9.2)]
    wins += [K.opening(P, 0, 5.0, 1.0, 0.9, ZE + 0.25, T, 'segment')]                   # S gable lunette
    wins += [K.opening(P, 2, 5.0, 1.6, 1.0, 3.2, T, 'segment')]
    conv = K.opening(P, 1, 7.5, 1.6, 1.3, 3.6, T, 'rect', 'door')               # E: the covered belt's mouth (y +2)
    bm = bmesh.new()
    K.prism_bm(bm, K.poly_offset(K.ccw(P), 0.06), -0.1, 0.55)
    K.part(bm, 'brick_dark', name='plinth', mat_tint=(0.6, 0.5, 0.46), grime=1.6)
    K.wall_ring(P, ZE, T, 'brick_red', [door, conv] + wins[:-2] + wins[-1:], name='walls', mat_tint=BRICK_T, grime=COAL_GRIME)
    zr = ZE + 5.0 * math.tan(math.radians(PITCH))
    for e in (0, 2):
        K.gable(P, e, ZE, zr, T, 'brick_red', [wins[-2]] if e == 0 else [], name='gable%d' % e, mat_tint=BRICK_T)
    bm = bmesh.new()                                   # pilaster strips (Lisenen) on the long walls and the corners
    for y in (-5.5, -1.8, 1.8, 5.5):
        for sx in (-1, 1):
            K.box_bm(bm, (sx * (5.0 + 0.07), y if abs(y) < 5 else y - math.copysign(0.25, y), ZE / 2 + 0.2), (0.14, 0.5, ZE - 0.4))
    for x in (-4.75, 4.75):
        K.box_bm(bm, (x, -5.5 - 0.07, ZE / 2 + 0.2), (0.5, 0.14, ZE - 0.4))
    K.part(bm, 'brick_red', name='pilasters', mat_tint=(0.72, 0.56, 0.5))
    K.course(P, ZE - 0.35, 0.22, 0.08, 'brick_dark', name='eaves_band')
    K.course(P, 0.55, 0.12, 0.05, 'concrete_board', name='plinth_cap')
    R = K.roof_gable(0, 0, 11.0, 10.0, ZE, PITCH, 'tar_paper_batten', rot=math.pi / 2, eave_oh=0.35, gable_oh=0.3, thick=0.1,
                     fascia='timber_beam', barge='timber_beam', gutters=True, sag=0.02)
    bm = bmesh.new()                                   # ridge vent (Dachreiter): louvred box with its own little roof
    K.box_bm(bm, (0, -1.0, zr + 0.35), (1.3, 5.0, 0.8))
    K.part(bm, 'timber_siding', name='vent', mat_tint=(0.4, 0.36, 0.32))
    bm = bmesh.new()
    for k in range(4):
        for sx in (-1, 1):
            K.box_bm(bm, (sx * 0.67, -1.0, zr + 0.12 + k * 0.17), (0.04, 4.8, 0.06))
    K.part(bm, 'timber_beam', name='louvres', mat_tint=(0.25, 0.22, 0.2))
    K.roof_gable(0, -1.0, 5.4, 1.5, zr + 0.75, 30, 'tar_paper_batten', rot=math.pi / 2, eave_oh=0.15, gable_oh=0.15, thick=0.06,
                 fascia=None, barge=None, gutters=False, name='vent_roof')
    for k, f in enumerate(wins):
        K.window(f, 'fixed', (4, 5), frame=(0.2, 0.21, 0.2), recess=0.14, sill='concrete_board', lintel=None, curtain=0.0,
                 streak=False, name='w%d' % k)
        K.voussoirs(f, 'brick_dark', key=False, name='arch%d' % k)
    K.door(door, 'front', 'barn', (0.28, 0.3, 0.27), step=None)
    K.voussoirs(door, 'brick_dark', key=False, name='archd')
    K.door(conv, 'belt', 'plank', (0.25, 0.25, 0.24), open_deg=95, step=None)
    bm = bmesh.new()                                   # sliding-door rail + coal chute on the W wall
    K.box_bm(bm, (door.o.x + 1.4, y0 - 0.3, 3.25), (5.6, 0.1, 0.12))
    K.beam_bm(bm, (x0 - 0.1, 1.0, 2.2), (x0 - 1.4, 1.0, 0.5), 0.9, 0.08)
    for sx in (-1, 1):
        K.beam_bm(bm, (x0 - 0.1, 1.0 + sx * 0.45, 2.35), (x0 - 1.4, 1.0 + sx * 0.45, 0.65), 0.05, 0.25)
    K.part(bm, 'steel_painted', name='chute', mat_tint=(0.35, 0.3, 0.26), grime=1.8)
    K.sign((door.o.x + 2.3, y0 - 0.22, 2.4), (0, -1, 0), 1.0, 'halt_sperrgebiet', board='timber_grey')
    K.wall_lantern((door.o.x - 1.7, y0, 0), (0, -1, 0), 3.4)
    K.wall_lantern((x1, -3.6, 0), (1, 0, 0), 3.2)
    coal_dust([((x0, y0), (x1, y0), (0, -1)), ((x0, y1), (x0, y0), (-1, 0)), ((x1, y0), (x1, y1), (1, 0))], n=5, seed=SEED)
    eave_streaks([((x1, y0), (x1, y1)), ((x0, y1), (x0, y0))], ZE - 0.3, n=4, seed=SEED, alpha=0.35)
    for i in range(4):
        K.decal('efflorescence', (r.uniform(x0 + 1, x1 - 1), y0 - T / 2 - 0.22, r.uniform(0.6, 1.4)), (0, -1, 0), 1.4, 0.8, alpha=0.4)
    roof_tone(R, seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))

if VAR in ('k', 'K'):
    L, W, ZE, PITCH = (8.0, 7.0, 2.7, 30) if VAR == 'k' else (12.0, 9.0, 3.0, 29)
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    P = rect(x0, y0, x1, y1)
    T = 0.12
    CORR = (0.9, 0.88, 0.82)
    door = K.opening(P, 3, W / 2, 1.1, 2.1, 0.3, T, 'rect', 'door')               # W gable door
    nw = 2 if VAR == 'k' else 4
    ts = [L * (k + 0.5) / nw for k in range(nw)]
    wins = [K.opening(P, 0, t, 1.0, 1.0, 1.2, T) for t in ts] + [K.opening(P, 2, t, 1.0, 1.0, 1.2, T) for t in ts]
    wins += [K.opening(P, 1, W / 2, 0.9, 0.9, 1.3, T)]
    bm = bmesh.new()
    K.prism_bm(bm, K.poly_offset(K.ccw(P), 0.08), -0.1, 0.3)
    K.part(bm, 'concrete_board', name='plinth', mat_tint=(0.66, 0.65, 0.62), grime=1.4)
    K.wall_ring(P, ZE, T, 'corrugated_galv', [door] + wins, z0=0.3, name='walls', mat_tint=CORR, grime=1.2, uv='aligned', rot90=True)
    zr = ZE + (W / 2) * math.tan(math.radians(PITCH))
    for e in (1, 3):
        K.gable(P, e, ZE, zr, T, 'corrugated_galv', [], name='gable%d' % e, mat_tint=CORR, rot90=True)
    bm = bmesh.new()                                   # timber corner posts, sill and eave plates showing outside
    for (cx, cy) in P:
        K.box_bm(bm, (cx, cy, ZE / 2 + 0.15), (0.18, 0.18, ZE - 0.3))
    for a, b in zip(P, P[1:] + P[:1]):
        K.beam_bm(bm, (a[0], a[1], 0.36), (b[0], b[1], 0.36), 0.16, 0.12)
    K.part(bm, 'timber_creosote', name='frame', mat_tint=(0.45, 0.4, 0.36), uv='beam', axis=(0, 0, 1))
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'corrugated_rust', eave_oh=0.35, gable_oh=0.25, thick=0.06,
                     fascia=None, barge='timber_beam', gutters=False, sag=0.02)
    bm = bmesh.new()                                   # galvanised ridge flashing
    K.beam_bm(bm, (x0 - 0.25, 0, R.z_ridge + 0.02), (x1 + 0.25, 0, R.z_ridge + 0.02), 0.5, 0.06)
    K.part(bm, 'steel_galv', name='ridge_cap', mat_tint=(0.5, 0.5, 0.5))
    for k, f in enumerate(wins):
        K.window(f, 'casement', (2, 2), frame=(0.62, 0.6, 0.55), recess=0.05, sill='timber_beam', lintel=None,
                 shutters='open' if k % 3 == 0 else None, shutter_color=(0.42, 0.4, 0.34), curtain=0.5, streak=False, name='w%d' % k)
    K.door(door, 'front', 'plank', (0.36, 0.38, 0.33), step='concrete_board')
    bm = bmesh.new()                                   # door porch: timber steps + a small pent canopy on brackets
    K.box_bm(bm, (x0 - 0.45, 0, 0.15), (0.9, 1.6, 0.3))
    K.part(bm, 'timber_beam', name='step', mat_tint=(0.5, 0.45, 0.4))
    K.roof_shed(x0 - 1.0, -1.0, x0, 1.0, 2.55, 2.85, 'corrugated_galv', low_side='-x', oh=0.05, name='canopy', thick=0.04)
    braces([((x0, -0.9, 2.0), (x0 - 0.9, -0.9, 2.55)), ((x0, 0.9, 2.0), (x0 - 0.9, 0.9, 2.55))], 0.08)
    for k, xx in enumerate((-L / 4, L / 4) if VAR == 'K' else (L / 4,)):
        stovepipe(xx, 0.8, zr - 0.6, zr + 0.9)
    K.sign((x0 - 0.08, 1.45, 1.6), (-1, 0, 0), 0.7, 'wache', board='timber_grey')
    K.wall_lantern((x0, -1.1, 0), (-1, 0, 0), 2.35)
    flagpole(x0 - 0.9, y0 - 0.7, 0.0, 6.5)
    bm = bmesh.new()                                   # rain barrel + firewood under the N eave
    K.cyl_bm(bm, (x1 - 0.6, y1 + 0.45, 0.0), (x1 - 0.6, y1 + 0.45, 0.9), 0.32, 12)
    K.part(bm, 'timber_creosote', name='butt', mat_tint=(0.45, 0.38, 0.3), lod='drop')
    for i in range(3):
        K.decal('streak_rust', (r.uniform(x0 + 1, x1 - 1), y0 - T / 2 - 0.02, r.uniform(0.8, 1.6)), (0, -1, 0), 0.9, 1.2, alpha=0.3)
        K.decal('streak_rust', (r.uniform(x0 + 1, x1 - 1), y1 + T / 2 + 0.02, ZE - 0.6), (0, 1, 0), 1.2, 1.0, alpha=0.45)
    roof_tone(R, seed=SEED, amp=0.22)
    K.anchor('roof_ridge', (0, 0, zr))

if VAR == 't':
    T, ZE, PITCH = 0.36, 8.1, 50
    x0, x1, y0, y1 = -2.0, 2.0, -2.5, 2.5
    P = rect(x0, y0, x1, y1)
    door = K.opening(P, 0, 2.0, 1.0, 2.2, 0.25, T, 'segment', 'door')
    F = (0.0, 2.75, 5.4)                                # storey levels
    wins = [K.opening(P, 0, t, 0.85, 1.4, z + 1.0, T, 'segment') for z in F[1:] for t in (1.0, 3.0)]
    wins += [K.opening(P, e, 2.5 if e != 2 else 2.0, 0.8, 1.3, z + 1.0, T, 'segment') for z in F for e in (1, 3)]
    wins += [K.opening(P, 2, 2.0, 0.8, 1.3, z + 1.0, T, 'segment') for z in F[1:]]
    gwin = K.opening(P, 0, 2.0, 0.7, 1.0, ZE + 0.3, T, 'segment')
    hoist = K.opening(P, 2, 2.0, 1.0, 1.6, ZE + 0.15, T, 'rect', 'door')       # N gable loading door under the hoist beam
    bm = bmesh.new()
    K.prism_bm(bm, K.poly_offset(K.ccw(P), 0.06), -0.1, 0.6)
    K.part(bm, 'brick_dark', name='plinth', mat_tint=(0.6, 0.52, 0.48), grime=1.5)
    K.wall_ring(P, ZE, T, 'brick_red', [door] + wins, name='walls', mat_tint=BRICK_T, grime=1.1)
    zr = ZE + 2.0 * math.tan(math.radians(PITCH))
    K.gable(P, 0, ZE, zr, T, 'brick_red', [gwin], name='gable_s', mat_tint=BRICK_T)
    K.gable(P, 2, ZE, zr, T, 'brick_red', [hoist], name='gable_n', mat_tint=BRICK_T)
    for z in F[1:]:
        K.course(P, z - 0.05, 0.14, 0.05, 'brick_dark', name='band%d' % int(z))
    K.course(P, ZE - 0.3, 0.25, 0.09, 'brick_dark', name='eaves_band')
    R = K.roof_gable(0, 0, 5.0, 4.0, ZE, PITCH, 'roof_tile_flat', rot=math.pi / 2, eave_oh=0.3, gable_oh=0.15, thick=0.1,
                     fascia='timber_beam', barge=None, gutters=True, sag=0.02)
    for k, f in enumerate(wins + [gwin]):
        K.window(f, 'casement', (1, 3), frame='white', recess=0.12, sill='concrete_board', lintel=None, curtain=0.5,
                 shutters=None, streak=True, name='w%d' % k)
        K.voussoirs(f, 'brick_dark', key=False, name='arch%d' % k)
    K.door(door, 'front', 'panel', DOOR['green'], step='concrete_board', fanlight=True)
    K.voussoirs(door, 'brick_dark', key=False, name='archd')
    K.door(hoist, 'hoist', 'plank', (0.3, 0.27, 0.22), step=None)
    bm = bmesh.new()                                   # hoist beam + pulley out of the N gable
    K.beam_bm(bm, (0, y1 - 0.2, zr - 0.6), (0, y1 + 1.2, zr - 0.6), 0.2, 0.22)
    K.cyl_bm(bm, (-0.05, y1 + 1.0, zr - 0.85), (0.05, y1 + 1.0, zr - 0.85), 0.16, 10)
    K.part(bm, 'timber_beam', name='hoist_beam', mat_tint=(0.4, 0.35, 0.3))
    K.chimney(0, 1.6, zr - 1.4, zr + 0.6, 0.55, 0.5, 'brick_red', cap='concrete_board', pots=1)
    K.anchor('smoke', (0, 1.6, zr + 0.7), (0, 0, 1), kind='smoke')
    K.wall_lantern((door.o.x + 0.95, y0, 0), (0, -1, 0), 2.6)
    for i in range(3):
        K.decal('damp_base', (r.uniform(x0 + 0.5, x1 - 0.5), y0 - T / 2 - 0.1, 0.7), (0, -1, 0), 1.3, 0.7, alpha=0.5)
    roof_tone(R, seed=SEED)
    roof_decals(R, 2, seed=SEED)

if VAR == 'h':
    T, ZE, PITCH = 0.14, 2.6, 31
    x0, x1, y0, y1 = -4.5, 4.5, -4.0, 4.0
    P = rect(x0, y0, x1, y1)
    GREY = (0.6, 0.6, 0.55)
    door = K.opening(P, 0, 4.5, 1.0, 2.05, 0.45, T, 'rect', 'door')
    wins = [K.opening(P, 0, t, 1.1, 1.15, 1.25, T) for t in (1.6, 7.4)] + [K.opening(P, 2, t, 1.1, 1.15, 1.25, T) for t in (2.0, 4.5, 7.0)]
    wins += [K.opening(P, 1, 4.0, 0.9, 0.9, 1.4, T), K.opening(P, 3, 4.0, 0.9, 0.9, 1.4, T)]
    posts([(x, y) for x in (x0 + 0.3, 0, x1 - 0.3) for y in (y0 + 0.3, y1 - 0.3)], -0.1, 0.45, 0.35, 'concrete_board', name='piers', tint=(0.65, 0.64, 0.6))
    K.wall_ring(P, ZE - 0.45, T, 'board_batten', [door] + wins, z0=0.45, name='walls', mat_tint=GREY, grime=0.9)
    zr = ZE + 4.0 * math.tan(math.radians(PITCH))
    for e in (1, 3):
        K.gable(P, e, ZE, zr, T, 'board_batten', [], name='gable%d' % e, mat_tint=GREY)
    R = K.roof_gable(0, 0, 9.0, 8.0, ZE, PITCH, 'tar_paper_batten', eave_oh=0.7, gable_oh=0.55, thick=0.1,
                     fascia='timber_beam', barge='timber_beam', gutters=False, sag=0.04, wobble=0.015)
    for k, f in enumerate(wins):
        K.window(f, 'casement', (2, 2), frame='white', recess=0.05, sill='timber_beam', lintel='timber_beam',
                 shutters='open', shutter_color=SHUTTER['green'], curtain=0.6, streak=False, name='w%d' % k)
    K.door(door, 'front', 'plank', DOOR['green'], step=None)
    K.stairs((0, y0 - 0.95, 0.0), (0, 1, 0), 1.4, 0.45, 3, 'timber_beam', solid=False, name='steps', meta=False)
    bm = bmesh.new()                                   # eave brackets under the deep overhangs
    for x in (-3.5, -1.2, 1.2, 3.5):
        for sy in (-1, 1):
            K.beam_bm(bm, (x, sy * 4.0, ZE - 0.7), (x, sy * 4.55, ZE - 0.05), 0.1, 0.1)
    K.part(bm, 'timber_beam', name='brackets', mat_tint=(0.45, 0.4, 0.35))
    stovepipe(2.4, -0.8, zr - 0.7, zr + 0.7)
    K.wall_lantern((door.o.x - 0.9, y0, 0), (0, -1, 0), 2.4)
    bm = bmesh.new()                                   # stacked firewood along the W wall
    for k in range(12):
        K.cyl_bm(bm, (x0 - 0.25, -2.5 + (k % 6) * 0.42 + 0.2, 0.15 + (k // 6) * 0.3), (x0 - 0.75, -2.5 + (k % 6) * 0.42 + 0.2, 0.15 + (k // 6) * 0.3), 0.14, 6)
    K.part(bm, 'log_hewn', name='firewood', mat_tint=(0.7, 0.6, 0.5), lod='drop')
    roof_tone(R, seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))

if VAR == 'p':
    T, ZR = 0.12, 4.35
    x0, x1, y0, y1 = -2.0, 3.5, -5.0, 5.0          # (the W 1.5 m of the plot is the cliff's bulging foot)
    # The asset is recentred on its bbox (x by -0.85: local x = world x - 7.65, local y = 31 - world z). The mission rail
    # (kit-terrain buildRailTrack: 2.6 m ballast bed, 2.5 m sleepers, NOT the nominal 1.2 m) runs at 15 deg on
    # y = -3.576 - 0.268 x, i.e. its bed spans -4.39..-1.69 at the W wall. The SE corner is canted 45 deg from CX (bed
    # edge 0.41 m clear of the corner post) so the whole bed stays clear of the S stub and crosses the canted wall
    # inside one 3.6 m open rail portal (bed 0.48..3.48 along that wall); the W adit arch is 3.2 m on the rail line.
    # The flat roof still covers the full rectangle, cantilevered over the rail bay on deep edge beams, a hip beam, a
    # strut and one post on the E edge (0.55 m N of the bed).
    CX, CY = -1.3, -0.2
    P = [(x0, y0), (CX, y0), (x1, CY), (x1, y1), (x0, y1)]
    RY = -3.04                                          # rail centre at the W wall
    S2 = math.sqrt(0.5)
    NC = (S2, -S2)                                      # canted wall: outward normal; point at t along it:

    def cw(t, out=0.0):
        return (CX + t * S2 + out * NC[0], y0 + t * S2 + out * NC[1])
    BOARD = (0.98, 0.94, 0.86)                         # silver-grey weathered boards (reads in the backlit low sun)
    rail = K.opening(P, 1, 2.0, 3.6, 2.8, 0.0, T, 'rect', 'door')               # canted SE wall: the open rail portal
    door = K.opening(P, 1, 4.75, 1.0, 2.1, 0.0, T, 'rect', 'door')               # canted wall: men's door
    wins = [K.opening(P, 1, 6.0, 0.9, 0.8, 1.5, T), K.opening(P, 2, 2.0, 1.1, 0.8, 1.5, T), K.opening(P, 2, 4.2, 1.1, 0.8, 1.5, T)]
    adit = K.opening(P, 4, y1 - RY, 3.2, 3.0, 0.0, T, 'arch', 'door')            # W: into the adit, on the rail line
    # rubble-stone base course as a ring (gapped at the doors: the rail runs in at ground level)
    K.wall_ring(K.poly_offset(K.ccw(P), 0.05), 0.75, 0.35, 'rubble_stone', [rail, door, adit], z0=-0.1, name='plinth', mat_tint=(0.82, 0.8, 0.76), grime=1.0, footprint=False)
    K.wall_ring(P, ZR - 0.65, T, 'boards_weathered', [rail, door, adit] + wins, z0=0.65, name='walls', mat_tint=BOARD, grime=0.8, footprint=False)
    K.footprint(rect(-3.5, -5.0, 3.5, 5.0), 'HIGH', 'building')
    bm = bmesh.new()                                     # framing posts and a mid rail showing outside
    for (cx, cy) in P:
        K.box_bm(bm, (cx, cy, ZR / 2), (0.22, 0.22, ZR))
    for y in (0.9, 2.9):
        K.box_bm(bm, (x1 + 0.06, y, ZR / 2), (0.1, 0.16, ZR))
    jx, jy = cw(3.9, 0.02)                               # heavy jamb post between the rail portal and the men's door
    K.box_bm(bm, (jx, jy, ZR / 2), (0.2, 0.2, ZR), rot_z=math.pi / 4)
    K.box_bm(bm, (x1 + 0.05, -2.6, (ZR - 0.27) / 2), (0.2, 0.2, ZR - 0.27))    # roof-bay post, clear N of the bed
    K.part(bm, 'timber_creosote', name='frame', mat_tint=(0.62, 0.56, 0.48), uv='beam', axis=(0, 0, 1))
    bm = bmesh.new()                                     # rail portal: a deep lintel proud of the wall, a rolled tarp
    la, lb = cw(0.0, 0.1), cw(4.0, 0.1)
    K.beam_bm(bm, (la[0], la[1], 2.95), (lb[0], lb[1], 2.95), 0.18, 0.3)
    K.part(bm, 'timber_beam', name='lintel', mat_tint=(0.62, 0.56, 0.48))
    bm = bmesh.new()
    ta, tb = cw(0.35, 0.3), cw(3.65, 0.3)
    K.cyl_bm(bm, (ta[0], ta[1], 3.18), (tb[0], tb[1], 3.18), 0.13, 10)
    for t in (0.8, 3.2):                                 # the two ties holding the rolled tarp up
        q = cw(t, 0.3)
        K.box_bm(bm, (q[0], q[1], 3.2), (0.05, 0.05, 0.34))
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.55, 0.52, 0.44), grime=1.0)
    bm = bmesh.new()                                     # shallow corrugated-iron roof on joists, kerb boards
    K.box_bm(bm, ((x0 + x1) / 2 + 0.1, 0, ZR + 0.06), (x1 - x0 + 0.2, 10.4, 0.12))
    K.part(bm, 'corrugated_galv', name='roof', mat_tint=(0.9, 0.9, 0.88), grime=0.8)
    bm = bmesh.new()
    for (a, b) in (((x0, -5.2), (3.7, -5.2)), ((3.7, -5.2), (3.7, 5.2)), ((3.7, 5.2), (x0, 5.2)), ((x0, 5.2), (x0, -5.2))):
        K.beam_bm(bm, (a[0], a[1], ZR + 0.2), (b[0], b[1], ZR + 0.2), 0.08, 0.28)
    # the cantilevered rail bay: edge beams from the canted wall's corner posts out to the open corner, a hip beam
    # and a diagonal strut from the canted wall's head down onto it (all above 2.9 m: the rail and carts pass under)
    K.beam_bm(bm, (CX, y0 - 0.05, ZR - 0.15), (x1 + 0.05, y0 - 0.05, ZR - 0.15), 0.2, 0.3)
    K.beam_bm(bm, (x1 + 0.05, CY, ZR - 0.15), (x1 + 0.05, y0 - 0.05, ZR - 0.15), 0.2, 0.3)
    mx, my = cw(6.788 / 2)
    K.beam_bm(bm, (mx - 0.1, my + 0.1, ZR - 0.15), (x1 - 0.05, y0 + 0.05, ZR - 0.15), 0.2, 0.3)
    K.beam_bm(bm, (mx - 0.12, my + 0.12, 3.1), (mx + 1.0, my - 1.0, ZR - 0.3), 0.14, 0.14)
    K.part(bm, 'timber_beam', name='kerb', mat_tint=(0.62, 0.56, 0.48))
    K.roof_meta(rect(x0 + 0.1, -4.9, 3.4, 4.9), ZR + 0.12, walkable=True)
    for k, f in enumerate(wins):
        K.window(f, 'fixed', (3, 2), frame=(0.75, 0.72, 0.64), recess=0.05, sill='timber_beam', lintel=None, curtain=0.0, bars=True,
                 streak=False, name='w%d' % k)
    K.door(door, 'front', 'plank', (0.55, 0.42, 0.3), step=None)
    # (the rail portal has no leaves: hinged leaves would stand on the oblique bed; the tarp is rolled up above it)
    bm = bmesh.new()                                     # the adit portal: dressed stone arch ring proud of the W wall
    RA, ZS = 1.82, 1.4                                   # voussoir ring radius (opening 3.2 wide, springing 1.4)
    for k in range(11):
        a0 = math.pi * (k + 0.5) / 11
        K.box_bm(bm, (x0 - 0.18, RY + math.cos(a0) * RA, ZS + math.sin(a0) * RA), (0.35, 0.46, 0.42))
    for sy in (-1, 1):
        K.box_bm(bm, (x0 - 0.18, RY + sy * RA, ZS / 2), (0.35, 0.4, ZS))
    K.part(bm, 'ashlar', name='portal', mat_tint=(0.6, 0.58, 0.54), grime=1.6)
    bm = bmesh.new()                                     # the dark mouth, stepped to the arch
    K.box_bm(bm, (x0 - 0.05, RY, ZS / 2), (0.06, 3.2, ZS))
    for k in range(5):
        za, zb = ZS + 1.6 * k / 5, ZS + 1.6 * (k + 1) / 5
        hw = math.sqrt(max(0.0, 1.6 ** 2 - (zb - ZS) ** 2)) + 0.12
        K.box_bm(bm, (x0 - 0.05, RY, (za + zb) / 2), (0.06, 2 * hw, zb - za))
    K.part(bm, 'interior_dark', name='portal_dark', mat_tint=(0.02, 0.02, 0.02))
    # (no rails of its own: the mission's rail_track runs through the doorway and the shed on its true 15 deg line)
    K.ladder((-1.6, 5.05, 0.0), ZR + 0.15, (0, 1, 0), 0.45, 0.35, 'timber_grey', name='ladder', meta=False)
    sx, sy = cw(4.75, 0.08)
    K.sign((sx, sy, 2.75), NC + (0,), 1.0, 'wache', board='timber_grey')
    K.wall_lantern((x1, 0.4, 0), (1, 0, 0), 3.0)
    coal_dust([((x0, y0), (CX, y0), (0, -1)), ((x1, CY), (x1, y1), (1, 0))], n=4, seed=SEED, z=0.5, alpha=0.4)

finish(os.path.join(ROOT, NAME))
