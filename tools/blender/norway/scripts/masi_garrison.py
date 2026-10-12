"""M6 Masi (Finnmark 1941): the three German-held garrisons (Kildread's "3 Bunkers"). Variants (+ 'd' = destroyed twin):
 chapel  chapel_stone_no      14 x 8:  rubble-granite hall church, steep slate roof, arched S door (double plank, iron
                              strap hinges), round-headed windows, small W rose window, bell-cote, (garrison flag on a free-standing mission pole)
 barr    hq_log_flatroof      14 x 10: laft log barrack on a fieldstone plinth, white casings, sod roof over the W 8.5 m,
                              flat tar-paper section E with a plank parapet, radio mast, crates and sandbags; porch S
 hq      hq_fortified_block   16 x 12: rubble-granite ground storey with barred windows, log upper storey with shutters,
                              flat walkable roof at exactly 6.5 m (low kerb + iron rail), roof hatch, mast; S door
Fronts face game south (Blender -Y); the door is centred on the S wall (the game's entry point).
usage: blender -b --python masi_garrison.py -- outroot variant seed"""
import sys, math, random, bmesh
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/norway/scripts')
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/europe/scripts')
import nlib as N
from eu_common import K, V, finish, use_cheap_windows, use_cheap_doors, scorch_openings
import eu_dmg
use_cheap_windows()
use_cheap_doors()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'chapel'), (int(a[2]) if len(a) > 2 else 1)
DEST = VAR.endswith('d')
BASE = VAR[:-1] if DEST else VAR
NAME = {'chapel': 'chapel_stone_no', 'barr': 'hq_log_flatroof', 'hq': 'hq_fortified_block'}[BASE] + ('_destroyed' if DEST else '')
K.begin(NAME, SEED, theater='temperate')
rq = random.Random(SEED * 13 + 1)
L, W = {'chapel': (14.0, 8.0), 'barr': (14.0, 10.0), 'hq': (16.0, 12.0)}[BASE]
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
GRANITE = (0.84, 0.83, 0.82)
R = None


def wall_flag(x, y, z0, h, out):
    """Iron flagpole on two wall brackets, the banner flying away from the wall."""
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, z0), (x, y, z0 + h), 0.045, 6)
    for z in (z0 + 0.3, z0 + 1.3):
        K.box_bm(bm, (x - out[0] * 0.15, y - out[1] * 0.15, z), (0.06 + abs(out[0]) * 0.3, 0.06 + abs(out[1]) * 0.3, 0.06))
    K.part(bm, 'cast_iron', name='flagpole', mat_tint=(0.3, 0.3, 0.3), bisect=False)
    N.banner((x, y, z0 + h - 0.1), fw=1.5, fh=1.0, heading=(1, 0, 0))


if BASE == 'chapel':
    T, ZE = 0.75, 4.6
    door = K.opening(poly, 0, L / 2, 1.5, 2.7, 0.08, T, 'arch', 'door')
    wins = [K.opening(poly, 0, t, 0.85, 1.9, 1.7, T, 'arch') for t in (2.6, 11.4)]
    wins += [K.opening(poly, 2, t, 0.85, 1.9, 1.7, T, 'arch') for t in (2.8, 7.0, 11.2)]
    rose = K.opening(poly, 3, W / 2, 0.8, 0.8, ZE + 0.9, T, 'arch')
    K.wall_ring(poly, ZE, T, 'fieldstone_grey', [door, rose] + wins, plinth=('granite', 0.45, 0.06), name='walls', mat_tint=(0.9, 0.89, 0.87))
    K.quoins(poly, 0.45, ZE, 'granite')
    R = K.roof_gable(0, 0, L, W, ZE, 47, 'roof_slate', eave_oh=0.4, gable_oh=0.2, thick=0.14, gutters=False, sag=0.03)
    for e in (1, 3):
        K.gable(poly, e, ZE, R.z_ridge - R.lift, T, 'fieldstone_grey', [rose] if e == 3 else [], name='gable%d' % e, mat_tint=(0.9, 0.89, 0.87))
    for k, f in enumerate(wins + [rose]):
        K.window(f, 'fixed', (2, 4), frame=(0.3, 0.3, 0.29), sill='granite', surround='granite', curtain=0.0, interior=True, name='w%d' % k)
    K.door(door, 'front', 'double', (0.32, 0.22, 0.15), step='granite', surround='granite')
    bm = bmesh.new()                                    # wrought-iron strap hinges on the door leaves
    for z in (0.6, 1.5, 2.2):
        for s in (-1, 1):
            K.box_bm(bm, tuple(door.p(s * 0.42, z, 0.06)), (0.5, 0.025, 0.05))
    K.part(bm, 'cast_iron', name='straps', mat_tint=(0.2, 0.2, 0.2), lod='drop')
    gx = x0 + 0.1                                       # bell-cote on the W gable apex
    zt = R.z_ridge - R.lift
    bm = bmesh.new()
    K.box_bm(bm, (gx, 0, zt + 0.55), (0.6, 1.3, 1.1))
    K.part(bm, 'fieldstone_grey', name='bellcote', mat_tint=(0.88, 0.87, 0.85))
    bm = bmesh.new()
    K.box_bm(bm, (gx, 0, zt + 1.25), (0.9, 1.6, 0.12))
    K.box_bm(bm, (gx, 0, zt + 1.5), (0.5, 0.25, 0.45), taper=(0.3, 0.6))
    K.part(bm, 'granite', name='bellcote_cap', mat_tint=GRANITE)
    K.P('cast_iron', K.cyl_bm, (gx, 0, zt + 0.55), (gx, 0, zt + 0.95), 0.2, 10, r1=0.12, name='bell', mat_tint=(0.45, 0.38, 0.25))
    K.sign((x0 + 2.3, y0 - 0.05, 2.0), (0, -1, 0), 0.8, 'wache', board='timber_beam')
    K.wall_lantern((door.o.x + 1.4, y0, 0), (0, -1, 0), 2.6)
    # no wall flag: M6 flies the chapel garrison flag from a free-standing pole E of the door (mission chapel_flag)
    K.anchor('roof_ridge', (0, 0, R.z_ridge))

if BASE == 'barr':
    D, Z0, ZE, XJ = 0.26, 0.45, 3.35, 1.5          # XJ: the sod roof covers x0..XJ, the flat section XJ..x1
    door = K.opening(poly, 0, L / 2, 1.0, 2.0, Z0 + 0.12, D, 'rect', 'door')
    wins = [K.opening(poly, 0, t, 0.95, 1.1, Z0 + 1.0, D) for t in (2.2, 4.6, 9.6, 12.0)]
    wins += [K.opening(poly, 2, t, 0.95, 1.1, Z0 + 1.0, D) for t in (3.0, 7.0, 11.0)]
    wins += [K.opening(poly, 1, W / 2, 0.95, 1.1, Z0 + 1.0, D), K.opening(poly, 3, W / 2, 0.95, 1.1, Z0 + 1.0, D)]
    N.plinth(poly, Z0, mid='fieldstone_grey', proj=0.06)
    N.log_walls(x0, y0, x1, y1, Z0, ZE - Z0, d=D, mid='timber_tarred', frames=[door] + wins, ext=0.3, name='logs')
    for k, f in enumerate(wins):
        N.casing(f, name='cas%d' % k)
        K.window(f, 'casement', (2, 3), frame='white', sill=None, curtain=0.4, interior=True, name='w%d' % k)
    K.door(door, 'front', 'panel', (0.36, 0.42, 0.34), step=None)
    N.porch(door, depth=1.6, roof=True, roof_mid='roof_shingle')
    pw = N.rect(x0, y0, XJ, y1)
    R = K.roof_sod(x0 / 2 + XJ / 2, 0, XJ - x0, W, ZE, 27)
    for e in (1, 3):
        N.board_gable(pw, e, ZE, R.z_ridge - R.lift, 0.12, cladding='tar', name='gable%d' % e)
    N.stovepipe(-4.0, 1.5, R.z_ridge - 1.0, R.z_ridge + 0.6)
    bm = bmesh.new()                                # the flat section: tar paper on boards, plank parapet
    K.prism_bm(bm, K.ccw(N.rect(XJ, y0 - 0.15, x1 + 0.15, y1 + 0.15)), ZE, ZE + 0.14)
    K.part(bm, 'tar_paper', name='flat_roof', grime=0.6)
    bm = bmesh.new()
    for (ax, ay), (bx, by) in (((XJ + 0.2, y0 - 0.1), (x1 + 0.1, y0 - 0.1)), ((x1 + 0.1, y0 - 0.1), (x1 + 0.1, y1 + 0.1)), ((x1 + 0.1, y1 + 0.1), (XJ + 0.2, y1 + 0.1))):
        K.beam_bm(bm, (ax, ay, ZE + 0.45), (bx, by, ZE + 0.45), 0.06, 0.5)
    K.part(bm, 'boards_weathered', name='parapet', uv='beam', axis=(1, 0, 0), mat_tint=(0.62, 0.58, 0.52))
    bm = bmesh.new()                                # radio mast with guys, crates, a sandbag rest at the E edge
    K.cyl_bm(bm, (x1 - 1.2, y1 - 1.2, ZE + 0.14), (x1 - 1.2, y1 - 1.2, ZE + 6.5), 0.05, 8, r1=0.02)
    for gx, gy in ((XJ + 0.6, y1 - 0.4), (x1 - 0.2, y0 + 1.5), (x1 - 0.2, y1 - 0.2)):
        K.cyl_bm(bm, (x1 - 1.2, y1 - 1.2, ZE + 4.5), (gx, gy, ZE + 0.15), 0.008, 4)
    K.part(bm, 'steel_galv', name='mast', grime=0.3)
    bm = bmesh.new()
    for cx_, cy_, h in ((XJ + 1.0, y0 + 1.2, 0.6), (XJ + 1.0, y0 + 1.9, 0.6), (XJ + 1.1, y0 + 1.5, 1.2)):
        K.box_bm(bm, (cx_, cy_, ZE + 0.14 + h / 2 - 0.3 + 0.3), (0.9, 0.65, 0.6), rq.uniform(-0.1, 0.1))
    K.part(bm, 'boards_weathered', name='crates', mat_tint=(0.55, 0.6, 0.45))
    bm = bmesh.new()
    for k in range(5):
        K.box_bm(bm, (x1 - 0.5, -2.0 + k * 0.62, ZE + 0.27), (0.42, 0.6, 0.24), 1.5708 + rq.uniform(-0.1, 0.1))
    K.part(bm, 'burlap_bag', name='sandbags', mat_tint=(0.85, 0.8, 0.7))
    K.sign((door.o.x + 1.6, y0 - 0.05, 1.9), (0, -1, 0), 0.7, 'wache', board='timber_beam')
    wall_flag(x1 + 0.3, 0.0, 1.2, 5.6, (1, 0))
    K.anchor('roof_ridge', (0, 0, R.z_ridge))

if BASE == 'hq':
    TG, ZG, ZR = 0.6, 3.3, 6.5                      # ground storey stone, log upper storey, roof top at 6.5
    door = K.opening(poly, 0, L / 2, 1.3, 2.4, 0.1, TG, 'segment', 'door')
    gw = [K.opening(poly, 0, t, 0.9, 1.0, 1.35, TG) for t in (2.5, 5.2, 10.8, 13.5)]
    gw += [K.opening(poly, 2, t, 0.9, 1.0, 1.35, TG) for t in (2.5, 6.0, 10.0, 13.5)]
    gw += [K.opening(poly, 1, t, 0.9, 1.0, 1.35, TG) for t in (2.0,)] + [K.opening(poly, 3, t, 0.9, 1.0, 1.35, TG) for t in (3.5, 8.5)]
    K.wall_ring(poly, ZG, TG, 'fieldstone_grey', [door] + gw, plinth=('granite', 0.5, 0.06), name='stone', mat_tint=(0.86, 0.85, 0.83))
    K.quoins(poly, 0.5, ZG, 'granite')
    K.course(poly, ZG - 0.05, 0.18, 0.08, 'granite', name='band')
    for k, f in enumerate(gw):
        K.window(f, 'casement', (2, 2), frame=(0.35, 0.36, 0.33), sill='granite', lintel='granite', bars=True, curtain=0.2, name='gw%d' % k)
    K.door(door, 'front', 'panel', (0.3, 0.33, 0.3), step='granite', surround='granite')
    up = N.rect(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08)
    uw = [K.opening(up, 0, t, 1.0, 1.25, ZG + 0.85, 0.26) for t in (1.9, 4.9, 7.9, 10.9, 13.9)]
    uw += [K.opening(up, 2, t, 1.0, 1.25, ZG + 0.85, 0.26) for t in (2.5, 6.5, 10.5, 13.5)]
    uw += [K.opening(up, 3, t, 1.0, 1.25, ZG + 0.85, 0.26) for t in (3.0, 9.0)]
    N.log_walls(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, ZG, ZR - 0.2 - ZG, d=0.26, mid='timber_tarred', frames=uw, ext=0.3, name='logs')
    for k, f in enumerate(uw):
        N.casing(f, name='ucas%d' % k)
        K.window(f, 'casement', (2, 3), frame='white', sill=None, shutters='open', shutter_color=(0.3, 0.36, 0.3), curtain=0.5, name='uw%d' % k)
    bm = bmesh.new()                                # flat roof: boards + tar paper, the top exactly at 6.5
    K.prism_bm(bm, K.ccw(N.rect(x0 - 0.2, y0 - 0.2, x1 + 0.2, y1 + 0.2)), ZR - 0.22, ZR)
    K.part(bm, 'tar_paper', name='roof', grime=0.7, mat_tint=(0.8, 0.8, 0.8))
    bm = bmesh.new()
    K.ring_bm(bm, K.ccw(N.rect(x0 - 0.22, y0 - 0.22, x1 + 0.22, y1 + 0.22)), K.ccw(N.rect(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02)), ZR - 0.3, ZR + 0.12)
    K.part(bm, 'timber_beam', name='kerb', mat_tint=(0.45, 0.42, 0.4))
    for (ax, ay), (bx, by) in (((x0 - 0.1, y0 - 0.1), (x1 + 0.1, y0 - 0.1)), ((x1 + 0.1, y0 - 0.1), (x1 + 0.1, y1 + 0.1)),
                               ((x1 + 0.1, y1 + 0.1), (x0 - 0.1, y1 + 0.1)), ((x0 - 0.1, y1 + 0.1), (x0 - 0.1, y0 - 0.1))):
        K.railing((ax, ay, ZR + 0.1), (bx, by, ZR + 0.1), 0.95, style='pipe', name='rail')
    bm = bmesh.new()
    K.box_bm(bm, (-6.5, 4.5, ZR + 0.2), (1.0, 1.0, 0.4))
    K.part(bm, 'boards_weathered', name='hatch', mat_tint=(0.5, 0.48, 0.44))
    bm = bmesh.new()
    K.cyl_bm(bm, (x1 - 0.5, y1 - 0.5, ZR), (x1 - 0.5, y1 - 0.5, ZR + 5.0), 0.045, 8, r1=0.02)
    K.part(bm, 'steel_galv', name='mast', grime=0.3)
    K.sign((0, y0 - 0.05, 2.95), (0, -1, 0), 1.5, 'kommandantur', board='timber_beam')
    for sx in (-1.3, 1.3):
        K.wall_lantern((sx, y0, 0), (0, -1, 0), 2.6)
    wall_flag(x0 + 0.4, y0 - 0.35, ZG + 0.4, 4.2, (0, -1))
    K.roof_meta(N.rect(x0, y0, x1, y1), ZR, walkable=True, kind='roof')
    K.anchor('roof_ridge', (0, 0, ZR))

def ragged_logs(x0_, y0_, x1_, y1_, z0, lo, hi, d=0.26, seed=1, name='burnt_logs'):
    """Burnt laft walls: log courses that stop under a ragged crest (z0 + lo .. z0 + hi), charred."""
    r = random.Random(seed)
    knots = [r.uniform(lo, hi) for _ in range(40)]
    per = 2 * ((x1_ - x0_) + (y1_ - y0_))
    def top(u):
        t = (u % per) / per * 39
        i = int(t); return knots[i] + (knots[i + 1] - knots[i]) * (t - i)
    edges = [((x0_, y0_ + d / 2), (x1_, y0_ + d / 2), 0.0), ((x1_ - d / 2, y0_), (x1_ - d / 2, y1_), x1_ - x0_),
             ((x1_, y1_ - d / 2), (x0_, y1_ - d / 2), (x1_ - x0_) + (y1_ - y0_)), ((x0_ + d / 2, y1_), (x0_ + d / 2, y0_), 2 * (x1_ - x0_) + (y1_ - y0_))]
    bm = bmesh.new()
    for k, ((ax, ay), (bx, by), u0) in enumerate(edges):
        Ln = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / Ln, (by - ay) / Ln
        z = z0 + d / 2 + (k % 2) * d * 0.43
        while z < z0 + hi:
            sx = -0.28
            while sx < Ln + 0.28:
                t = sx
                while t < Ln + 0.28 and z - z0 < top(u0 + max(0.0, min(Ln, t))):
                    t += 0.12
                if t - sx > 0.35:
                    K.cyl_bm(bm, (ax + ux * sx, ay + uy * sx, z), (ax + ux * t, ay + uy * t, z), d / 2 * r.uniform(0.86, 1.0), 7)
                sx = t + 0.12
            z += d * 0.86
    K.part(bm, 'timber_tarred', name=name, uv='beam', axis=(1, 0, 0), smooth=True, mat_tint=(0.42, 0.39, 0.36), jitter=0.14)


if DEST:                                            # burnt out, roofless, but standing (not a black husk)
    import kit_core as C
    gone = {'chapel': ('roof', 'flag', 'banner', 'bellcote', 'bell', 'straps'),
            'barr': ('roof', 'sod', 'railing', 'gable', 'logs', 'cas', 'w', 'door', 'stovepipe', 'flat_roof', 'parapet', 'mast', 'crates', 'sandbags', 'flag', 'banner', 'porch'),
            'hq': ('roof', 'kerb', 'rail', 'hatch', 'mast', 'logs', 'ucas', 'uw', 'flag', 'banner')}[BASE]
    eu_dmg.remove_parts(lambda o: o.name.startswith(gone) and not o.name.startswith(('walls', 'w_')) or eu_dmg._kid(o) == 'glass_dirty')
    C.A.meta['anchors'] = [an for an in C.A.meta['anchors'] if an['name'] not in ('flag', 'light')]
    if BASE == 'barr':
        ragged_logs(x0, y0, x1, y1, 0.45, 0.6, 2.7, seed=SEED)
    if BASE == 'hq':
        ragged_logs(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 3.3, 0.25, 1.8, seed=SEED)
        bm = bmesh.new()                            # the charred first floor, holed
        K.prism_bm(bm, K.ccw(N.rect(x0 + 0.6, y0 + 0.6, x1 - 0.6, 1.5)), 3.18, 3.3)
        K.part(bm, 'deck_planks', name='floor_burnt', mat_tint=(0.35, 0.32, 0.3))
    ztop = {'chapel': 4.6, 'barr': 2.4, 'hq': 3.6}[BASE]
    bm = bmesh.new()                                # fallen and leaning charred roof timbers
    for k in range(9):
        xa = x0 + 1 + k * (L - 2) / 8
        ya = (y0 + 0.5) if k % 2 else (y1 - 0.5)
        eu_dmg.splinter_bm(bm, V((xa, ya, ztop - 0.2)), V((xa + rq.uniform(-0.8, 0.8), -ya * 0.2, rq.uniform(0.3, 1.6))), 0.16, 0.2, rq, 0.4)
    K.part(bm, 'timber_tarred', name='charred_timbers', uv='beam', axis=(1, 0, 0), mat_tint=(0.32, 0.3, 0.28))
    for i, (cx_, cy_) in enumerate(((-L * 0.22, 0.6), (L * 0.2, -0.8))):
        eu_dmg.heap(V((cx_, cy_, 0.0)), min(W, L) * 0.3, 1.0, stone='fieldstone_grey', dress='granite',
                    tiles='roof_slate' if BASE == 'chapel' else 'roof_shingle', seed=SEED + 30 + i, name='heap%d' % i, footprint=False, n=14)
    eu_dmg.heap(V((L * 0.3, y0 - 1.0, 0.0)), 1.3, 0.6, stone='fieldstone_grey', dress=None, tiles='roof_slate', seed=SEED + 40, name='heap_out', footprint=False, n=10)
    scorch_openings(0.9)
    N.char(strength=0.3, z0=1.2, seed=SEED)
finish(ROOT + '/' + NAME)
