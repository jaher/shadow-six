"""M6 Masi (Finnmark 1941) small builds.
 lean   lean_to_canopy      5 x 5 x 3: open timber lean-to on six posts (pent roof of tarred boards / tar paper, high
                            side E towards the HQ), braces, a firewood stack, crates and a chopping block under it
 burnt  ruin_burned_timber  10 x 8: burnt-out log house, ragged charred laft walls 0.6-2.6 m, the fieldstone chimney
                            stack still standing, the inside filled with fallen roof timbers, sod and ash (solid in game)
 clock  grandfather_clock   0.8 x 0.5: long-case clock standing ON the W ruin's deck (geometry from y 3.2 to 5.3)
 gatling gatling_wheeled    1.6 x 1.2: multi-barrel gun on a two-wheeled field carriage, trail behind, crank, hopper
 logs   log_pile_stack      3 x 1.5 x 1: stacked birch / pine logs on two bearers, stakes at the ends
 cart   handcart_wood       2 x 1.2: two-wheeled wooden handcart with shafts, side boards, a sack and a shovel
usage: blender -b --python masi_small.py -- outroot variant seed"""
import sys, math, random, bmesh
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/norway/scripts')
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/europe/scripts')
import nlib as N
from eu_common import K, V, finish
import eu_dmg

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'lean'), (int(a[2]) if len(a) > 2 else 1)
NAME = {'lean': 'lean_to_canopy', 'burnt': 'ruin_burned_timber', 'clock': 'grandfather_clock', 'gatling': 'gatling_wheeled',
        'logs': 'log_pile_stack', 'cart': 'handcart_wood'}[VAR]
K.begin(NAME, SEED, theater='temperate')
rq = random.Random(SEED * 17 + 3)


def logs_box(bm, x0, x1, y, z, r):
    K.cyl_bm(bm, (x0, y, z), (x1, y, z), r, 8)


def wheel(bm, c, axis, r, spokes=12, w=0.07):
    """Felloe ring (24 short segments, open between the spokes) + hub; the spokes are added by the caller."""
    ax = V(axis).normalized(); up = V((0, 0, 1)); s = ax.cross(up)
    c = V(c)
    n = 24
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p0 = c + s * (math.cos(a0) * (r - 0.03)) + up * (math.sin(a0) * (r - 0.03))
        p1 = c + s * (math.cos(a1) * (r - 0.03)) + up * (math.sin(a1) * (r - 0.03))
        K.beam_bm(bm, p0, p1, w, 0.07, up=tuple(ax))
    K.cyl_bm(bm, c - ax * 0.1, c + ax * 0.1, 0.09, 10)            # hub
    return s


if VAR == 'lean':
    L, W, ZL, ZH = 5.0, 5.0, 2.2, 3.0
    bm = bmesh.new()
    posts = [(-2.3, -2.3), (0, -2.3), (2.3, -2.3), (-2.3, 2.3), (0, 2.3), (2.3, 2.3)]
    for (x, y) in posts:
        h = ZL + (ZH - ZL) * (x + 2.5) / 5
        K.box_bm(bm, (x, y, h / 2), (0.16, 0.16, h))
        K.box_bm(bm, (x, y, 0.1), (0.35, 0.35, 0.2))
    for y in (-2.3, 2.3):                          # plates and braces
        K.beam_bm(bm, (-2.5, y, ZL - 0.05), (2.5, y, ZH - 0.05), 0.14, 0.18)
        for x in (-2.3, 2.3):
            d = 0.7 if x < 0 else -0.7
            hb = ZL + (ZH - ZL) * (x + 2.5) / 5
            K.beam_bm(bm, (x, y, hb - 0.75), (x + d, y, hb - 0.1 + (ZH - ZL) * d / 5), 0.08, 0.08)
    for x in (-2.3, -1.15, 0, 1.15, 2.3):          # rafters
        h = ZL + (ZH - ZL) * (x + 2.5) / 5
        K.beam_bm(bm, (x, -2.7, h + 0.1), (x, 2.7, h + 0.1), 0.1, 0.12)
    K.part(bm, 'timber_beam', name='frame', uv='beam', axis=(0, 0, 1), mat_tint=(0.6, 0.55, 0.5))
    bm = bmesh.new()
    K.hexa_bm(bm, [V((-2.75, -2.85, ZL + 0.12)), V((2.75, -2.85, ZH + 0.12)), V((2.75, 2.85, ZH + 0.12)), V((-2.75, 2.85, ZL + 0.12)),
                   V((-2.75, -2.85, ZL + 0.2)), V((2.75, -2.85, ZH + 0.2)), V((2.75, 2.85, ZH + 0.2)), V((-2.75, 2.85, ZL + 0.2))])
    K.part(bm, 'tar_paper_batten', name='roof', grime=0.6)
    bm = bmesh.new()                               # firewood stack against the E side, crates W, chopping block
    for row in range(5):
        for k in range(9):
            logs_box(bm, 1.5, 2.25, -1.9 + k * 0.42 + (row % 2) * 0.2, 0.14 + row * 0.25, 0.12 * rq.uniform(0.85, 1.1))
    K.part(bm, 'log_hewn', name='firewood', uv='beam', axis=(1, 0, 0), smooth=True, mat_tint=(0.85, 0.78, 0.7))
    bm = bmesh.new()
    for (x, y, z, s) in ((-1.6, -1.3, 0.3, 0.6), (-1.6, -0.6, 0.3, 0.6), (-1.55, -0.95, 0.9, 0.6), (-1.5, 1.4, 0.35, 0.7)):
        K.box_bm(bm, (x, y, z), (s * 1.2, s, s), rq.uniform(-0.15, 0.15))
    K.part(bm, 'boards_weathered', name='crates', mat_tint=(0.6, 0.62, 0.5))
    K.P('log_hewn', K.cyl_bm, (0.3, 0.6, 0), (0.3, 0.6, 0.45), 0.25, 12, name='block', mat_tint=(0.8, 0.72, 0.62))
    K.P('steel_painted', K.beam_bm, (0.3, 0.6, 0.45), (0.55, 0.9, 0.9), 0.03, 0.03, name='axe', mat_tint=(0.4, 0.33, 0.25))
    K.footprint(N.rect(-2.5, -2.5, 2.5, 2.5), 'LOW', 'hut')

if VAR == 'burnt':
    L, W, D = 10.0, 8.0, 0.26
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    N.plinth(N.rect(x0, y0, x1, y1), 0.4, mid='fieldstone_grey', proj=0.05)
    knots = [rq.uniform(0.5, 2.6) for _ in range(28)]
    def top(px, py):
        t = ((px - x0) + (py - y0)) * 0.9
        i = int(t) % 27
        return knots[i] + (knots[i + 1] - knots[i]) * (t - int(t))
    bm = bmesh.new()
    z, k = 0.4 + D / 2, 0
    while z < 2.7:
        if k % 2 == 0:
            for y in (y0 + D / 2, y1 - D / 2):
                s = x0 - 0.28
                while s < x1 + 0.28:
                    t = s
                    while t < x1 + 0.28 and z < top(t, y):
                        t += 0.1
                    if t - s > 0.35:
                        K.cyl_bm(bm, (s, y, z), (t, y, z), D / 2 * rq.uniform(0.85, 1.0), 7)
                    s = t + 0.1
        else:
            for x in (x0 + D / 2, x1 - D / 2):
                s = y0 - 0.28
                while s < y1 + 0.28:
                    t = s
                    while t < y1 + 0.28 and z < top(x, t):
                        t += 0.1
                    if t - s > 0.35:
                        K.cyl_bm(bm, (x, s, z + 0.1), (x, t, z + 0.1), D / 2 * rq.uniform(0.85, 1.0), 7)
                    s = t + 0.1
        z += D * 0.45; k += 1
    K.part(bm, 'timber_tarred', name='charred_logs', uv='beam', axis=(1, 0, 0), smooth=True, mat_tint=(0.36, 0.33, 0.31), jitter=0.15)
    bm = bmesh.new()
    K.box_bm(bm, (1.5, 0.8, 2.6), (1.2, 1.0, 5.2))
    K.part(bm, 'fieldstone_grey', name='chimney', grime=1.0, mat_tint=(0.72, 0.7, 0.68))
    for zz in (1.5, 3.5):
        K.decal('soot', (1.5, 0.8 - 0.52, zz), (0, -1, 0), 1.0, 1.6, alpha=0.7)
    eu_dmg.heap(V((-1.8, -0.5, 0.0)), 2.6, 1.1, stone='fieldstone_grey', dress=None, tiles='sod', seed=SEED, name='heap_in', footprint=False,
                n=18, beams=6, planks=6, slabs=0, elong=1.3)
    eu_dmg.heap(V((2.2, -1.5, 0.0)), 1.7, 0.8, stone='fieldstone_grey', dress=None, tiles='roof_shingle', seed=SEED + 1, name='heap_in2',
                footprint=False, n=12, beams=4, planks=4, slabs=0)
    bm = bmesh.new()                                # fallen roof purlins leaning out over the walls
    for (p0, p1) in (((-4.0, 2.5, 0.3), (-0.5, 3.6, 2.4)), ((0.5, -2.8, 0.2), (3.8, -3.6, 2.0)), ((-3.5, -2.0, 1.2), (2.0, 1.5, 0.3))):
        eu_dmg.splinter_bm(bm, V(p0), V(p1), 0.18, 0.2, rq, 0.4)
    K.part(bm, 'timber_tarred', name='purlins', uv='beam', axis=(1, 0, 0), mat_tint=(0.3, 0.28, 0.26))
    K.footprint(N.rect(x0, y0, x1, y1), 'HIGH', 'building')

if VAR == 'clock':
    Z = 3.2                                         # stands on the W ruin's deck
    bm = bmesh.new()
    K.box_bm(bm, (0, 0, Z + 0.15), (0.62, 0.42, 0.3))            # plinth
    K.box_bm(bm, (0, 0, Z + 0.9), (0.5, 0.34, 1.2))              # trunk
    K.box_bm(bm, (0, 0, Z + 1.75), (0.6, 0.4, 0.5))              # hood
    K.box_bm(bm, (0, 0, Z + 2.05), (0.66, 0.44, 0.1))            # cornice
    K.hexa_bm(bm, [V((-0.3, -0.2, Z + 2.1)), V((0.3, -0.2, Z + 2.1)), V((0.3, 0.2, Z + 2.1)), V((-0.3, 0.2, Z + 2.1)),
                   V((-0.05, -0.2, Z + 2.28)), V((0.05, -0.2, Z + 2.28)), V((0.05, 0.2, Z + 2.28)), V((-0.05, 0.2, Z + 2.28))])
    K.part(bm, 'wood_paint', name='case', mat_tint=(0.36, 0.22, 0.13), grime=0.8, lod='keep')
    K.P('plaster_white', K.cyl_bm, (0, -0.2, Z + 1.75), (0, -0.215, Z + 1.75), 0.17, 16, name='dial', mat_tint=(0.9, 0.86, 0.72))
    K.P('cast_iron', K.box_bm, (0, -0.172, Z + 0.95), (0.3, 0.01, 0.75), name='door_glass', mat_tint=(0.12, 0.12, 0.12))
    K.P('steel_galv', K.cyl_bm, (0, -0.18, Z + 0.7), (0, -0.19, Z + 0.7), 0.08, 12, name='bob', mat_tint=(0.8, 0.65, 0.3))
    K.decal('soot', (0, -0.222, Z + 1.3), (0, -1, 0), 0.5, 0.9, alpha=0.45)
    K.footprint(N.rect(-0.4, -0.25, 0.4, 0.25), 'HIGH', 'building')

if VAR == 'gatling':
    bm = bmesh.new()                                # carriage: axle, cheeks, trail to the rear (-x)
    for y in (-0.5, 0.5):
        wheel(bm, (0.15, y, 0.55), (0, 1, 0), 0.55)
    K.part(bm, 'wood_paint', name='wheels', mat_tint=(0.32, 0.34, 0.26))
    bm = bmesh.new()
    for k in range(12):
        ang = k * math.pi / 6
        for y in (-0.5, 0.5):
            K.cyl_bm(bm, (0.15, y, 0.55), (0.15 + math.cos(ang) * 0.5, y, 0.55 + math.sin(ang) * 0.5), 0.022, 5)
    K.cyl_bm(bm, (0.15, -0.58, 0.55), (0.15, 0.58, 0.55), 0.045, 8)
    for y in (-0.22, 0.22):
        K.beam_bm(bm, (0.45, y, 0.75), (-0.75, y * 0.4, 0.08), 0.08, 0.14)
    K.box_bm(bm, (0.2, 0, 0.8), (0.5, 0.5, 0.12))
    K.box_bm(bm, (-0.25, -0.25, 0.92), (0.3, 0.05, 0.3))       # gunner's shield plate stub
    K.part(bm, 'steel_painted', name='carriage', mat_tint=(0.36, 0.38, 0.3), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()                                # the barrel cluster (8 barrels round a spindle), breech casing
    for k in range(8):
        ang = k * math.pi / 4
        oy, oz = math.cos(ang) * 0.075, math.sin(ang) * 0.075
        K.cyl_bm(bm, (0.15, oy, 1.0 + oz), (0.8, oy, 1.0 + oz), 0.016, 6)
    for x in (0.4, 0.75):
        K.cyl_bm(bm, (x, 0, 1.0), (x + 0.03, 0, 1.0), 0.105, 12)
    K.part(bm, 'steel_galv', name='barrels', mat_tint=(0.32, 0.32, 0.33), uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    K.cyl_bm(bm, (-0.25, 0, 1.0), (0.17, 0, 1.0), 0.13, 12)
    K.box_bm(bm, (-0.05, 0, 1.22), (0.18, 0.12, 0.22))             # gravity hopper
    K.beam_bm(bm, (-0.05, 0.14, 1.0), (-0.15, 0.3, 0.9), 0.02, 0.02)   # crank
    K.part(bm, 'steel_painted', name='breech', mat_tint=(0.55, 0.45, 0.25))
    K.anchor('muzzle', (0.82, 0, 1.0), (1, 0, 0), kind='muzzle')
    K.footprint(N.rect(-0.8, -0.6, 0.8, 0.6), 'LOW', 'building')

if VAR == 'logs':
    bm = bmesh.new()
    for y in (-0.55, 0.55):
        K.box_bm(bm, (0, y * 0.9, 0.06), (3.0, 0.14, 0.12))
    K.part(bm, 'timber_tarred', name='bearers', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    rows = [(5, 0.13), (4, 0.13), (3, 0.13)]
    z = 0.12 + 0.13
    for i, (n, r) in enumerate(rows):
        for k in range(n):
            y = (k - (n - 1) / 2) * 0.27
            K.cyl_bm(bm, (-1.4 + rq.uniform(-0.1, 0.1), y, z), (1.4 + rq.uniform(-0.1, 0.1), y, z), r * rq.uniform(0.85, 1.1), 10)
        z += 0.23
    K.part(bm, 'log_hewn', name='logs', uv='beam', axis=(1, 0, 0), smooth=True, mat_tint=(0.82, 0.75, 0.66))
    bm = bmesh.new()
    for x in (-1.25, 1.25):
        for y in (-0.72, 0.72):
            K.box_bm(bm, (x, y, 0.5), (0.08, 0.08, 1.0))
    K.part(bm, 'timber_grey', name='stakes', uv='beam', axis=(0, 0, 1))
    K.footprint(N.rect(-1.5, -0.75, 1.5, 0.75), 'LOW', 'building')

if VAR == 'cart':
    bm = bmesh.new()
    for y in (-0.62, 0.62):
        wheel(bm, (0.2, y, 0.45), (0, 1, 0), 0.45)
    K.part(bm, 'wood_paint', name='wheels', mat_tint=(0.45, 0.4, 0.33))
    bm = bmesh.new()
    for k in range(10):
        ang = k * math.pi / 5
        for y in (-0.62, 0.62):
            K.cyl_bm(bm, (0.2, y, 0.45), (0.2 + math.cos(ang) * 0.4, y, 0.45 + math.sin(ang) * 0.4), 0.02, 5)
    K.cyl_bm(bm, (0.2, -0.66, 0.45), (0.2, 0.66, 0.45), 0.035, 8)
    K.box_bm(bm, (0.2, 0, 0.62), (1.3, 1.0, 0.05))                 # bed
    for y in (-0.5, 0.5):
        K.box_bm(bm, (0.2, y, 0.8), (1.3, 0.04, 0.32))             # sides
        K.beam_bm(bm, (-0.45, y * 0.75, 0.62), (-1.0, y * 0.6, 0.35), 0.05, 0.06)   # shafts down to the ground
    K.box_bm(bm, (0.85, 0, 0.8), (0.04, 1.0, 0.32))
    K.part(bm, 'boards_weathered', name='body', uv='beam', axis=(1, 0, 0), mat_tint=(0.7, 0.64, 0.56))
    K.P('hessian', K.box_bm, (0.35, 0.1, 0.82), (0.55, 0.4, 0.32), 0.3, name='sack', mat_tint=(0.85, 0.78, 0.62))
    K.P('steel_painted', K.beam_bm, (-0.2, -0.3, 0.68), (0.75, 0.25, 1.0), 0.04, 0.03, name='shovel', mat_tint=(0.4, 0.35, 0.3))
    K.footprint(N.rect(-1.0, -0.6, 1.0, 0.6), 'LOW', 'building')

finish(ROOT + '/' + NAME)
