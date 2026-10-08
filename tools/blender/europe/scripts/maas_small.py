"""Small Mosan / Belgian railway-side buildings for the M16/M18 Maas bridge map, 1944.
 h  6 x 5   brick field hut (garrison hut by the fields): red brick on a bluestone plinth, corrugated pent roof,
            door centred on the front, stovepipe, rain butt, a Wehrmacht notice board
 p  4 x 4   tarred plank shed on the bridge island: black-tarred boards, tar-paper gable roof, plank door, oars, net
 t  12 x 7  village railway halt (gare): red brick with bluestone trims, hipped slate roof, a glazed canopy on iron
            brackets over the platform side (front), station clock, waiting-room door centred
usage: blender -b --python maas_small.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, SHUTTER, DOOR, finish, roof_tone, roof_decals, eave_streaks, use_cheap_windows, use_cheap_doors
import bmesh
use_cheap_windows()
use_cheap_doors()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'h'), (int(a[2]) if len(a) > 2 else 1)
NAME = {'h': 'hut_brick_be', 'p': 'shed_tarred_be', 't': 'station_halt_be'}[VAR]
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
BLUE, BLUE_T = 'ashlar', (0.52, 0.56, 0.6)
L, W = {'h': (6.0, 5.0), 'p': (3.4, 3.4), 't': (12.0, 7.0)}[VAR]
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def plinth(h=0.45, tint=BLUE_T, mid=BLUE):
    bm = bmesh.new()
    K.prism_bm(bm, K.poly_offset(K.ccw(poly), 0.05), -0.1, h)
    K.part(bm, mid, name='plinth', mat_tint=tint, grime=0.6)


if VAR == 'h':
    T, ZL, ZH = 0.3, 2.75, 3.25                    # pent roof: low at the back, high over the front
    door = K.opening(poly, 0, L / 2, 1.0, 2.1, 0.15, T, 'segment', 'door')
    w1 = K.opening(poly, 0, 1.15, 0.9, 1.0, 1.05, T, 'segment')
    w2 = K.opening(poly, 0, L - 1.15, 0.9, 1.0, 1.05, T, 'segment')
    w3 = K.opening(poly, 1, W / 2, 0.8, 0.9, 1.1, T, 'segment')
    w4 = K.opening(poly, 2, L / 2, 0.8, 0.9, 1.1, T, 'segment')
    plinth()
    K.wall_ring(poly, ZL, T, 'brick_red', [door, w1, w2, w3, w4], name='walls', mat_tint=(0.88, 0.78, 0.74), grime=0.8)
    bm = bmesh.new()                                # the front wall rises to the high side, the side walls rake
    K.box_bm(bm, (0, y0 + T / 2, (ZL + ZH) / 2), (L, T, ZH - ZL))
    for xs in (x0 + T / 2, x1 - T / 2):
        K.hexa_bm(bm, [V((xs - T / 2, y0, ZL)), V((xs + T / 2, y0, ZL)), V((xs + T / 2, y1, ZL)), V((xs - T / 2, y1, ZL)),
                       V((xs - T / 2, y0, ZH)), V((xs + T / 2, y0, ZH)), V((xs + T / 2, y1, ZL + 0.02)), V((xs - T / 2, y1, ZL + 0.02))])
    K.part(bm, 'brick_red', name='rake_walls', mat_tint=(0.88, 0.78, 0.74), grime=0.6)
    K.course(poly, ZL - 0.25, 0.1, 0.04, 'brick_dark', name='band')
    K.roof_shed(x0, y0, x1, y1, ZL, ZH + 0.12, 'corrugated_galv', low_side='+y', oh=0.3, name='roof', thick=0.06)
    for k, f in enumerate((w1, w2, w3, w4)):
        K.window(f, 'casement', (2, 2), frame=(0.75, 0.74, 0.7), sill=BLUE, bars=k > 1, shutters=None, curtain=0.3, name='w%d' % k)
        K.voussoirs(f, 'brick_dark', key=False, name='arch%d' % k)
    K.door(door, 'front', 'plank', DOOR['grey'], step=BLUE)
    K.voussoirs(door, 'brick_dark', key=False, name='archd')
    bm = bmesh.new()
    K.cyl_bm(bm, (x1 - 1.0, 1.2, ZH - 0.4), (x1 - 1.0, 1.2, ZH + 0.9), 0.09, 10)
    K.cyl_bm(bm, (x1 - 1.0, 1.2, ZH + 0.9), (x1 - 1.0, 1.2, ZH + 1.04), 0.16, 10, r1=0.04)
    K.part(bm, 'cast_iron', name='stovepipe', mat_tint=(0.34, 0.32, 0.3), smooth=True)
    K.anchor('smoke', (x1 - 1.0, 1.2, ZH + 1.1), (0, 0, 1), kind='smoke')
    K.sign((door.o.x + 1.15, y0 - 0.05, 1.7), (0, -1, 0), 0.6, 'wache', board='timber_beam')
    K.wall_lantern((door.o.x - 0.8, y0, 0), (0, -1, 0), 2.3)
    for i in range(3):
        K.decal('damp_base', (r.uniform(x0 + 0.6, x1 - 0.6), y0 - 0.16, 0.6), (0, -1, 0), r.uniform(1.0, 1.8), 0.6, alpha=0.5)
    K.decal('streak_rust', (0, y0 - 0.16, ZH - 0.5), (0, -1, 0), 2.5, 0.8, alpha=0.4)
    K.anchor('roof_ridge', (0, 0, ZH))
    bm = bmesh.new()                                    # garrison flagpole on wall brackets at the SE corner
    K.cyl_bm(bm, (x1 - 0.35, y0 - 0.3, 1.2), (x1 - 0.35, y0 - 0.3, 6.0), 0.045, 6)
    for z in (1.5, 2.6):
        K.box_bm(bm, (x1 - 0.35, y0 - 0.15, z), (0.06, 0.3, 0.06))
    K.part(bm, 'cast_iron', name='flagpole', mat_tint=(0.3, 0.3, 0.3), bisect=False)
    K.anchor('flag', (x1 - 0.3, y0 - 0.3, 5.9), (1, 0, 0), kind='flag', w=1.5, h=1.0)

if VAR == 'p':
    T, ZE, pitch = 0.12, 2.1, 32
    door = K.opening(poly, 0, L / 2, 0.95, 1.9, 0.25, T, 'rect', 'door')
    w1 = K.opening(poly, 1, W / 2, 0.6, 0.55, 1.2, T)
    plinth(0.25, (0.6, 0.58, 0.55), 'rubble_stone')
    K.wall_ring(poly, ZE, T, 'timber_tarred', [door, w1], name='walls', mat_tint=(0.42, 0.4, 0.38), grime=0.5)
    zr = ZE + (W / 2) * math.tan(math.radians(pitch))
    for e in (1, 3):
        K.gable(poly, e, ZE, zr, T, 'timber_tarred', [], name='gable%d' % e, mat_tint=(0.42, 0.4, 0.38))
    bm = bmesh.new()                                 # vertical battens over the board joints + corner posts
    for xx in [x0 + 0.4 + 0.52 * k for k in range(6)]:
        K.box_bm(bm, (xx, y0 - 0.02, ZE / 2 + 0.15), (0.06, 0.04, ZE - 0.3))
    for (cx, cy) in poly:
        K.box_bm(bm, (cx, cy, ZE / 2), (0.16, 0.16, ZE))
    K.part(bm, 'timber_tarred', name='battens', mat_tint=(0.36, 0.34, 0.32), uv='beam', axis=(0, 0, 1))
    R = K.roof_gable(0, 0, L, W, ZE, pitch, 'tar_paper_batten', eave_oh=0.3, gable_oh=0.25, thick=0.08,
                     fascia='timber_beam', barge='timber_beam', gutters=False, sag=0.05, wobble=0.015)
    K.window(w1, 'fixed', (2, 2), frame=(0.6, 0.58, 0.52), sill='timber_beam', streak=False, name='w1')
    K.door(door, 'front', 'plank', (0.3, 0.33, 0.3), step=None)
    bm = bmesh.new()                                 # oars + boat hook leaning on the W wall, a fish box
    for k in range(2):
        K.beam_bm(bm, (x0 - 0.15, -0.8 + 0.35 * k, 0.0), (x0 - 0.05, -0.6 + 0.35 * k, 2.3), 0.06, 0.04)
        K.box_bm(bm, (x0 - 0.17, -0.82 + 0.35 * k, 0.35), (0.04, 0.16, 0.6))
    K.part(bm, 'timber_beam', name='oars', mat_tint=(0.62, 0.52, 0.4), uv='beam', axis=(0, 0, 1), lod='drop')
    bm = bmesh.new()
    K.box_bm(bm, (x1 - 0.5, y0 - 0.17, 0.18), (0.7, 0.3, 0.36))
    K.part(bm, 'boards_weathered', name='fish_box', mat_tint=(0.6, 0.55, 0.48), lod='drop')
    bm = bmesh.new()                                 # a drying net hung on two pegs under the E eave
    K.box_bm(bm, (x1 + 0.06, 0.0, 1.5), (0.03, 2.2, 0.9))
    K.part(bm, 'mesh_screen', name='net', mat_tint=(0.45, 0.42, 0.36), lod='drop')
    for i in range(3):
        K.decal('moss_patch', (r.uniform(x0 + 0.5, x1 - 0.5), y1 + 0.08, 0.35), (0, 1, 0), r.uniform(0.6, 1.0), 0.4, alpha=0.5)
    roof_tone(R, seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))
    K.footprint_rect(0, 0, 4.0, 4.0, 0, 'HIGH', 'building')   # the plot incl. the oars / fish box / net (fits the 4 x 4 m hut)

if VAR == 't':
    T, ZE, pitch = 0.4, 4.4, 38
    fr = []
    door = K.opening(poly, 0, L / 2, 1.5, 2.7, 0.2, T, 'segment', 'door'); fr.append(door)
    wins = []
    for x in (1.3, 3.3, L - 3.3, L - 1.3):
        f = K.opening(poly, 0, x, 1.05, 2.1, 0.95, T, 'segment'); fr.append(f); wins.append(f)
    door_b = K.opening(poly, 2, L / 2, 1.3, 2.6, 0.2, T, 'segment', 'door'); fr.append(door_b)
    for x in (2.0, 4.0, L - 4.0, L - 2.0):
        f = K.opening(poly, 2, x, 1.0, 1.9, 1.0, T, 'segment'); fr.append(f); wins.append(f)
    for e in (1, 3):
        f = K.opening(poly, e, W / 2, 1.0, 1.9, 1.0, T, 'segment'); fr.append(f); wins.append(f)
    plinth(0.6)
    K.wall_ring(poly, ZE, T, 'brick_red', fr, name='walls', mat_tint=(0.9, 0.8, 0.75), grime=0.7)
    K.quoins(poly, 0.6, ZE, BLUE, name='quoins')
    K.course(poly, 3.15, 0.14, 0.05, BLUE, name='band')
    K.cornice(poly, ZE - 0.05, 'brick_dark', steps=((0.05, 0.08), (0.1, 0.08)), name='cornice')
    R = K.roof_gable(0, 0, L, W, ZE, pitch, 'roof_slate', eave_oh=0.4, gable_oh=0.4, thick=0.12, hip=True,
                     fascia='timber_beam', barge='timber_beam', gutters=True, sag=0.02, wobble=0.008)
    zr = R.z_ridge
    K.dormer(R, 0.0, -1, w=1.3, h=1.3, wall='brick_red', roof='roof_slate', pitch=52, window_kw=dict(frame='white'))
    K.chimney(-3.0, 0.8, zr - 1.4, zr + 0.8, 0.8, 0.55, 'brick_red', cap=BLUE, pots=2, name='chimneyW')
    K.chimney(3.4, 0.8, zr - 1.4, zr + 0.8, 0.8, 0.55, 'brick_red', cap=BLUE, pots=1, name='chimneyE')
    for k, f in enumerate(wins):
        K.window(f, 'sash', (2, 3), frame='white', sill=BLUE, shutters=None, curtain=0.5, name='w%d' % k)
        K.voussoirs(f, BLUE, key=True, name='arch%d' % k)
    K.door(door, 'front', 'double', DOOR['green'], step=BLUE)
    K.door(door_b, 'back', 'double', DOOR['green'], step=BLUE)
    K.voussoirs(door, BLUE, key=True, name='archd'); K.voussoirs(door_b, BLUE, key=True, name='archdb')
    # platform canopy: glazed / corrugated roof on cast-iron brackets, sawtooth valance (no posts on the platform)
    CZ, CD = 3.35, 2.3
    bm = bmesh.new()
    for k in range(7):
        x = x0 + 0.6 + k * (L - 1.2) / 6
        K.beam_bm(bm, (x, y0, CZ + 0.45), (x, y0 - CD + 0.1, CZ + 0.1), 0.08, 0.12)
        K.beam_bm(bm, (x, y0, CZ - 0.9), (x, y0 - 1.3, CZ + 0.22), 0.06, 0.08)
    K.beam_bm(bm, (x0 + 0.3, y0 - CD + 0.1, CZ + 0.08), (x1 - 0.3, y0 - CD + 0.1, CZ + 0.08), 0.1, 0.14)
    K.part(bm, 'cast_iron', name='canopy_iron', mat_tint=(0.24, 0.3, 0.26), uv='beam', axis=(1, 0, 0))
    K.roof_shed(x0 + 0.2, y0 - CD, x1 - 0.2, y0, CZ + 0.05, CZ + 0.5, 'corrugated_galv', low_side='-y', oh=0.05, name='canopy', thick=0.05)
    bm = bmesh.new()
    n = int((L - 0.4) / 0.25)
    for k in range(n):
        xa = x0 + 0.2 + k * 0.25
        K.box_bm(bm, (xa + 0.125, y0 - CD - 0.06, CZ - 0.12), (0.2, 0.03, 0.3 if k % 2 else 0.22))
    K.part(bm, 'wood_paint', name='valance', mat_tint=(0.85, 0.83, 0.76), lod='drop')
    bm = bmesh.new()                                 # station clock on a bracket under the canopy
    K.cyl_bm(bm, (1.2, y0 - 0.55, 2.85), (1.2, y0 - 0.65, 2.85), 0.32, 16)
    K.box_bm(bm, (1.2, y0 - 0.3, 3.2), (0.06, 0.6, 0.06))
    K.part(bm, 'cast_iron', name='clock', mat_tint=(0.2, 0.22, 0.2), smooth=True, lod='drop')
    K.decal('poster_fr', (-1.9, y0 - 0.21, 1.6), (0, -1, 0), 0.6, 0.85, alpha=0.85)
    K.decal('poster_de', (2.2, y0 - 0.21, 1.6), (0, -1, 0), 0.6, 0.85, alpha=0.85)
    K.wall_lantern((door.o.x - 1.25, y0, 0), (0, -1, 0), 2.9)
    K.wall_lantern((door_b.o.x + 1.15, y1, 0), (0, 1, 0), 2.8)
    eave_streaks([((x0, y0), (x1, y0)), ((x1, y1), (x0, y1))], ZE - 0.3, n=4, seed=SEED, alpha=0.3)
    for i in range(5):
        K.decal('damp_base', (r.uniform(x0 + 0.8, x1 - 0.8), y1 + 0.21, 0.8), (0, 1, 0), r.uniform(1.2, 2.2), 0.7, alpha=0.5)
    roof_tone(R, seed=SEED)
    roof_decals(R, 3, seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))
    bm = bmesh.new()                                    # garrison flagpole on the hip ridge
    K.cyl_bm(bm, (2.0, 0, zr - 0.3), (2.0, 0, zr + 3.2), 0.045, 6)
    K.part(bm, 'cast_iron', name='flagpole', mat_tint=(0.3, 0.3, 0.3), bisect=False)
    K.anchor('flag', (2.05, 0, zr + 3.1), (1, 0, 0), kind='flag', w=1.6, h=1.05)

finish(os.path.join(ROOT, NAME))
