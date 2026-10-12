"""M6 'Menace of the Leopold' (Masi, Finnmark 1941): the two bombed-out, roofless 2-storey Norwegian log manors.
The whole footprint is the mission's walkable upper floor at y 3.2 (deck), so the build is:
  ground storey: tarred laft logs (projecting notched corners) on a fieldstone plinth, burnt-out / boarded windows,
  the upper floor: plank deck with a chequer-tiled hall, charred floor-board patches,
  the upper storey: burnt log walls broken off at about 1 m (the mission's parapets, with its gaps at the climb spot,
  ladder and stair heads), log partitions broken at about 2.2 m where the mission has them, a fieldstone chimney stack,
  white stone exterior stairs and a timber ladder at the mission's links (visual only: the links are the mission's).
 w  = ruin_w  24 x 21 m at (32, 35.5)      ne = ruin_ne 20 x 16 m at (120, 44)
Coordinates below are GAME (X east, Z south) converted with G(); Blender y = -(Z - cz).
usage: blender -b --python masi_ruin.py -- outroot variant seed"""
import sys, math, random, bmesh
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/norway/scripts')
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/europe/scripts')
import nlib as N
from eu_common import K, V, finish, use_cheap_windows
import eu_dmg
use_cheap_windows()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'w'), (int(a[2]) if len(a) > 2 else 1)
NAME = {'w': 'house_bombed_log_w', 'ne': 'house_bombed_log_ne'}[VAR]
K.begin(NAME, SEED, theater='temperate')
rq = random.Random(SEED * 7 + 3)
CX, CZ, L, W = {'w': (32, 35.5, 24.0, 21.0), 'ne': (120, 44, 20.0, 16.0)}[VAR]
G = lambda X, Z: (X - CX, -(Z - CZ))
DECK, D, Z0 = 3.2, 0.26, 0.45
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
CHAR = (0.5, 0.46, 0.42)

# ---- ground storey -----------------------------------------------------------------------------------------------
fr = []
for e, n in ((0, 5 if VAR == 'w' else 4), (2, 5 if VAR == 'w' else 4), (1, 3), (3, 3)):
    span = L if e in (0, 2) else W
    for k in range(n):
        fr.append(K.opening(poly, e, span * (k + 0.5) / n + rq.uniform(-0.4, 0.4), 1.0, 1.25, 1.05, D + 0.1))
N.plinth(poly, Z0, mid='fieldstone_grey', proj=0.06)
N.log_walls(x0, y0, x1, y1, Z0, DECK - Z0 - 0.06, d=D, mid='timber_tarred', frames=fr, ext=0.3, name='logs_gf')
for k, f in enumerate(fr):
    if k % 3 == 1:          # boarded up: three rough planks nailed across
        bm = bmesh.new()
        for j in range(3):
            c = f.p(rq.uniform(-0.05, 0.05), 0.25 + j * 0.4 + rq.uniform(-0.05, 0.05), 0.04)
            K.box_bm(bm, tuple(c), (1.3, 0.04, 0.2), math.atan2(f.r.y, f.r.x) + rq.uniform(-0.08, 0.08))
        K.part(bm, 'boards_weathered', name='boards%d' % k, mat_tint=(0.7, 0.66, 0.6))
        K.window(f, 'fixed', (2, 2), frame=(0.3, 0.29, 0.27), sill='timber_beam', curtain=0.0, interior=True, streak=False, name='w%d' % k)
    else:
        K.window(f, 'casement', (2, 3), frame=(0.62, 0.6, 0.55), sill='timber_beam', curtain=0.0, interior=True,
                 shutters=('ajar' if k % 4 == 0 else None), shutter_color=(0.45, 0.2, 0.16), name='w%d' % k)
    if k % 2 == 0:          # soot licking up from the burnt-out windows
        K.decal('soot', tuple(f.p(0, f.h + 0.45, 0.03)), tuple(f.n), 1.3, 1.0, alpha=0.5)

# ---- the upper floor (deck) at exactly y 3.2 ------------------------------------------------------------------------
bm = bmesh.new()
K.prism_bm(bm, K.ccw(poly), DECK - 0.08, DECK)
K.part(bm, 'deck_planks', name='deck', grime=0.9, mat_tint=(0.5, 0.47, 0.44))
bm = bmesh.new()                                   # floor beam ends showing between the storeys
K.ring_bm(bm, K.poly_offset(K.ccw(poly), 0.04), K.poly_offset(K.ccw(poly), -0.25), DECK - 0.3, DECK - 0.06)
K.part(bm, 'timber_tarred', name='rim', mat_tint=(0.5, 0.47, 0.44))
if VAR == 'w':                                     # the chequer-tiled hall (27-35 x 29-37)
    hx0, hy1 = G(27, 29); hx1, hy0 = G(35, 37)
    K.P('floor_checker', K.box_bm, ((hx0 + hx1) / 2, (hy0 + hy1) / 2, DECK + 0.004), (hx1 - hx0, hy1 - hy0, 0.008), name='hall_tiles',
        grime=1.0, mat_tint=(0.52, 0.5, 0.47))
# ---- burnt upper storey: log courses broken off along a ragged crest -------------------------------------------------
def crest(seed, lo, hi, n=7):
    r = random.Random(seed)
    knots = [r.uniform(lo, hi) for _ in range(n)]
    def f(t):
        u = max(0.0, min(0.999, t)) * (n - 1)
        i = int(u); s = u - i
        return knots[i] * (1 - s) + knots[i + 1] * s + r.uniform(-0.06, 0.06)
    return f


def logs_run(A, B, top, gaps=(), seed=1, name='upper', d=D, ext=0.0, tint=CHAR):
    """Horizontal logs from game point A to B (on the deck), each course cut where it is above the crest
    top(t) or inside a gap (t0, t1 along the run, metres)."""
    (ax, ay), (bx, by) = G(*A), G(*B)
    Ln = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / Ln, (by - ay) / Ln
    bm = bmesh.new(); z = DECK + d / 2; step = 0.08
    while z < DECK + 2.6:
        s = -ext
        while s < Ln + ext:
            t = s
            while t < Ln + ext and (z - DECK) < top(max(0, t) / Ln) and not any(g0 <= t <= g1 for g0, g1 in gaps):
                t += step
            if t - s > 0.3:
                p = V((ax + ux * s, ay + uy * s, z)); q = V((ax + ux * t, ay + uy * t, z))
                K.cyl_bm(bm, p, q, d / 2 * rq.uniform(0.92, 1.04), 7)
            s = t + step
        z += d * 0.9
    if len(bm.verts):
        K.part(bm, 'timber_tarred', name=name, uv='beam', axis=(ux, uy, 0), smooth=True, mat_tint=tint, jitter=0.12)


def hi_ends(f, k=0.07, add=0.45):
    """Laft corners survive higher than the wall between them."""
    return lambda t: f(t) + (add if t < k or t > 1 - k else 0.0)


o = D / 2
if VAR == 'w':
    runs = [((20, 25 + o), (44, 25 + o), (), 0.75, 1.3), ((20 + o, 25), (20 + o, 46), ((9.0, 13.0),), 0.7, 1.25),
            ((20, 46 - o), (44, 46 - o), ((8.0, 12.0),), 0.7, 1.2),
            ((44 - o, 25), (44 - o, 46), ((0.8, 4.0), (6.5, 10.5), (15.0, 21.5)), 0.75, 1.3)]
    for i, (A, B, gaps, lo, hi) in enumerate(runs):
        logs_run(A, B, hi_ends(crest(SEED + i, lo - 0.2, hi + 0.05, 10)), gaps, seed=i, name='upper%d' % i, ext=0.3)
    for i, (A, B) in enumerate((((24.5, 32.5), (31, 32.5)), ((33, 32.5), (38, 32.5)), ((24.5, 32.5), (24.5, 39.5)))):
        logs_run(A, B, crest(SEED + 10 + i, 1.3, 2.45, 7), (), seed=10 + i, name='partition%d' % i, d=0.22)
    chim = (36.0, 25.05, 6.8)
else:
    runs = [((110, 36 + o), (130, 36 + o), ((7.0, 9.5),)), ((110 + o, 36), (110 + o, 52), ((13.2, 15.6),)),
            ((110, 52 - o), (130, 52 - o), ((11.0, 13.5),)), ((130 - o, 36), (130 - o, 52), ((4.0, 6.0),))]
    for i, (A, B, gaps) in enumerate(runs):
        logs_run(A, B, hi_ends(crest(SEED + i, 0.25, 0.8), 0.06, 0.55), gaps, seed=i, name='upper%d' % i, ext=0.3)
    chim = (125.0, 36.05, 6.0)

# fieldstone chimney stack standing out of the wreck (the hearth wall survives the fire)
cx, cy = G(chim[0], chim[1])
bm = bmesh.new()
K.box_bm(bm, (cx, cy, chim[2] / 2), (1.25, 1.0, chim[2]))
K.part(bm, 'fieldstone_grey', name='chimney', grime=0.9, mat_tint=(0.8, 0.78, 0.75))
bm = bmesh.new()
K.box_bm(bm, (cx, cy, chim[2] + 0.05), (1.45, 1.2, 0.1))
K.box_bm(bm, (cx - 0.25, cy, chim[2] + 0.3), (0.3, 0.3, 0.4))
K.part(bm, 'granite', name='chimney_cap', mat_tint=(0.6, 0.6, 0.6))
for zz in (DECK + 0.8, DECK + 2.3):
    K.decal('soot', (cx, cy - 0.52, zz), (0, -1, 0), 1.1, 1.4, alpha=0.6)
    K.decal('soot', (cx, cy + 0.52, zz), (0, 1, 0), 1.1, 1.4, alpha=0.6)
K.anchor('smoke', (cx, cy, chim[2] + 0.5), (0, 0, 1), kind='smoke')

# links (visual only: the mission's ladders / stairs carry the nav)
if VAR == 'w':
    # each flight is the engine's own flight of its link (world/stairs.js linkFlight: n = ceil(rise / 0.2) treads of
    # run / n, the first riser at the foot, the last tread ending at the top), so the men's feet (art/stair-gait.js)
    # land on these treads and nobody walking the link sinks into the stone
    def link_flight(b, t, name):
        L = math.hypot(t[0] - b[0], t[1] - b[1]); n = math.ceil(DECK / 0.2 - 1e-9); go = L / n
        dw = ((t[0] - b[0]) / L, (t[1] - b[1]) / L)                      # world XZ direction
        bx, by = G(b[0], b[1])
        # 1 cm low: the top tread meets the deck planks without a coplanar face
        K.stairs((bx, by, 0), (dw[0], -dw[1], 0), 1.3, DECK - 0.01, n, 'ashlar_limestone', solid=True, meta=False, name=name, go=go)
        # the link's top lies inside the footprint: a stairwell through the deck edge, rim joists and the log wall
        # head over the flight's last treads (they stand below the deck there), so a man on them never walks in planks
        s_in = next(k * 0.02 for k in range(int(L / 0.02) + 1)
                    if 20 <= b[0] + dw[0] * k * 0.02 <= 44 and 25 <= b[1] + dw[1] * k * 0.02 <= 46)
        s0, s1 = s_in - 0.12, L - 0.01                                 # no slit past the top tread
        cx, cy = G(b[0] + dw[0] * (s0 + s1) / 2, b[1] + dw[1] * (s0 + s1) / 2)
        wells.append(eu_dmg.Box((cx, cy, DECK - 0.15), (dw[0], -dw[1], 0), (dw[1], dw[0], 0), (0, 0, 1), ((s1 - s0) / 2, 0.68, 0.4)))
    wells = []
    link_flight((30, 49), (30, 45.5), 'stair_s')
    link_flight((47, 45), (43.4, 42), 'stair_e')
    eu_dmg.carve(wells, skip=lambda o: o.name.startswith('stair'))
    lx, ly = G(45.4, 27)
    K.ladder((lx, ly, 0), DECK, (1, 0, 0), lean=1.25, mid='timber_grey', meta=False, name='ladder_e')
else:
    lx, ly = G(108.8, 51)
    K.ladder((lx, ly, 0), DECK, (-1, 0, 0), lean=1.0, mid='timber_grey', meta=False, name='ladder_sw')

# low debris on the deck, clear of every post and route
spots = [(36.5, 26.7), (25.8, 44.8), (38.5, 44.8)] if VAR == 'w' else [(127.5, 37.6), (126.0, 51.0)]
for i, (X, Z) in enumerate(spots):
    hx, hy = G(X, Z)
    eu_dmg.heap(V((hx, hy, DECK)), 0.9, 0.3, stone='fieldstone_grey', dress=None, tiles='roof_shingle', seed=SEED + 20 + i,
                name='debris%d' % i, footprint=False, n=8, beams=2, planks=3, slabs=0)
bm = bmesh.new()
for i in range(3):
    X, Z = spots[i % len(spots)]
    hx, hy = G(X, Z)
    eu_dmg.splinter_bm(bm, V((hx - 1.2, hy + 0.3 * i, DECK + 0.1)), V((hx + 1.0, hy - 0.2, DECK + 0.25)), 0.16, 0.2, rq, 0.4)
K.part(bm, 'timber_tarred', name='charred_beams', uv='beam', axis=(1, 0, 0), mat_tint=(0.36, 0.33, 0.3))

K.roof_meta(poly, DECK, walkable=True, kind='floor')
finish(ROOT + "/" + NAME)
