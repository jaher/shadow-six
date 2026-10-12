"""M6 Masi (Finnmark 1941) round towers.
 log   = tower_round_log    5 m across, 8 m: 12-sided laft tower of tarred logs with notched, projecting corner heads,
         on a fieldstone footing; arrow-slit lookouts with plank shutters, a projecting log gallery band under the eave,
         a steep shingled cone with a snow cap left over from the winter, iron finial
 stone = tower_round_stone  5 m across, 10 m: rubble-granite round tower (the chapel's / the HQ's), dressed quoin
         bands, slit windows with granite surrounds, a plank door, conical slate roof with a lead-roll finial
usage: blender -b --python masi_tower.py -- outroot variant seed"""
import sys, math, random, bmesh
sys.path.insert(0, '<projects>/commandos-shots/m06art/blender/europe/scripts')
from eu_common import K, V, finish, use_cheap_windows
use_cheap_windows()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'log'), (int(a[2]) if len(a) > 2 else 1)
NAME = {'log': 'tower_round_log', 'stone': 'tower_round_stone'}[VAR]
K.begin(NAME, SEED, theater='temperate')
rq = random.Random(SEED * 11 + 5)
R = 2.5
NS = 12 if VAR == 'log' else 20
ring = lambda r, n=NS, ph=0.0: [(r * math.cos(2 * math.pi * (k + ph) / n), r * math.sin(2 * math.pi * (k + ph) / n)) for k in range(n)]


def cone(r0, z0, z1, mid, name, n=24, tint=None, r_top=0.03, uvmode='aligned'):
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, z0), (0, 0, z1), r0, n, r1=r_top)
    return K.part(bm, mid, name=name, mat_tint=tint, grime=0.5)


if VAR == 'log':
    ZE, D = 6.0, 0.26
    bm = bmesh.new()                                   # fieldstone footing
    K.prism_bm(bm, K.ccw(ring(R + 0.08, NS, 0.5)), -0.1, 0.45)
    K.part(bm, 'fieldstone_grey', name='footing', grime=0.8)
    poly = ring(R - D / 2, NS, 0.5)
    slits = [(k, z) for k, z in ((0, 1.4), (3, 3.6), (6, 2.2), (9, 4.4), (1, 4.8), (7, 4.9))]
    bmx = bmesh.new()
    z, c = 0.45 + D / 2, 0
    while z < ZE:                                      # alternate courses project at alternate corners (laft heads)
        for k in range(NS):
            p, q = V((*poly[k], z)), V((*poly[(k + 1) % NS], z))
            d = (q - p).normalized()
            ext = 0.28 if (k + c) % 2 == 0 else 0.02
            cut = any(k == sk and abs(z - sz) < 0.5 for sk, sz in slits)
            if cut:                                    # leave a slit: two short logs either side
                m = (p + q) / 2
                K.cyl_bm(bmx, p - d * ext, m - d * 0.22, D / 2 * rq.uniform(0.93, 1.03), 7)
                K.cyl_bm(bmx, m + d * 0.22, q + d * 0.02, D / 2 * rq.uniform(0.93, 1.03), 7)
            else:
                K.cyl_bm(bmx, p - d * ext, q + d * 0.02, D / 2 * rq.uniform(0.93, 1.03), 7)
        z += D * 0.86
        c += 1
    K.part(bmx, 'timber_tarred', name='logs', uv='beam', axis=(1, 0, 0), smooth=True, jitter=0.12, mat_tint=(0.92, 0.88, 0.84))
    bm = bmesh.new()                                   # dark backing behind the slits / chinking
    K.prism_bm(bm, K.ccw(ring(R - D - 0.02, NS, 0.5)), 0.45, ZE)
    K.part(bm, 'interior_dark', name='core')
    bm = bmesh.new()                                   # plank shutters half open on the slits
    for sk, sz in slits:
        p, q = V((*poly[sk], sz)), V((*poly[(sk + 1) % NS], sz))
        m = (p + q) / 2; n_ = V((m.x, m.y, 0)).normalized()
        K.box_bm(bm, tuple(m + n_ * 0.2 + (q - p).normalized() * 0.3), (0.05, 0.36, 0.55), math.atan2(n_.y, n_.x) + 0.7)
    K.part(bm, 'boards_weathered', name='shutters', mat_tint=(0.55, 0.5, 0.45))
    bm = bmesh.new()                                   # projecting log band (a ring of corbel logs) under the eave
    for k in range(NS):
        ang = 2 * math.pi * (k + 0.5) / NS
        K.cyl_bm(bm, (math.cos(ang) * (R - 0.4), math.sin(ang) * (R - 0.4), ZE - 0.15), (math.cos(ang) * (R + 0.35), math.sin(ang) * (R + 0.35), ZE - 0.15), 0.12, 7)
    K.part(bm, 'timber_tarred', name='corbels', uv='beam', axis=(1, 0, 0), smooth=True, mat_tint=(0.7, 0.66, 0.62))
    cone(R + 0.5, ZE, ZE + 3.0, 'roof_shingle', 'cone', tint=(0.72, 0.68, 0.64))
    bm = bmesh.new()                                   # snow cap: the upper cone and a ragged lower edge on the N side
    K.cyl_bm(bm, (0, 0, ZE + 1.5), (0, 0, ZE + 3.04), (R + 0.5) * (1 - 1.5 / 3.0) + 0.04, 24, r1=0.05)
    K.part(bm, 'snow', name='snow_cap', mat_tint=(0.96, 0.97, 1.0))
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, ZE + 2.9), (0, 0, ZE + 3.6), 0.03, 6)
    K.cyl_bm(bm, (0, 0, ZE + 3.3), (0, 0, ZE + 3.38), 0.09, 8)
    K.part(bm, 'cast_iron', name='finial', mat_tint=(0.3, 0.3, 0.3))
    K.footprint(ring(R, NS, 0.5), 'HIGH', 'tower')
else:
    ZE = 8.2
    poly = ring(R, NS)
    fr = [K.opening(poly, k, 0.39, 0.32, 1.0, z, 0.7) for k, z in ((2, 2.4), (7, 5.0), (12, 3.2), (16, 6.0), (4, 6.6))]
    door = K.opening(poly, 15, 0.39, 0.9, 1.95, 0.05, 0.7, 'arch', 'door')
    K.wall_ring(poly, ZE, 0.7, 'fieldstone_grey', fr + [door], plinth=('granite', 0.5, 0.06), name='walls', mat_tint=(0.86, 0.85, 0.83))
    for zz in (2.9, 5.6):
        K.course(poly, zz, 0.16, 0.05, 'granite', name='band%d' % int(zz))
    K.cornice(poly, ZE - 0.1, 'granite', steps=((0.08, 0.12), (0.16, 0.1)))
    for k, f in enumerate(fr):
        K.window(f, 'fixed', (1, 3), frame=(0.3, 0.3, 0.3), sill='granite', lintel='granite', curtain=0.0, interior=True, name='slit%d' % k)
    K.door(door, 'tower', 'plank', (0.33, 0.27, 0.22), step='granite', surround='granite')
    cone(R + 0.35, ZE, ZE + 3.3, 'roof_slate', 'cone', tint=(0.8, 0.8, 0.82))
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, ZE + 3.1), (0, 0, ZE + 3.9), 0.035, 6)
    K.cyl_bm(bm, (0, 0, ZE + 3.2), (0, 0, ZE + 3.35), 0.12, 10, r1=0.05)
    K.part(bm, 'cast_iron', name='finial', mat_tint=(0.35, 0.35, 0.36))
    for i in range(5):
        ang = rq.uniform(0, 6.28)
        K.decal('streak_long', (math.cos(ang) * (R + 0.02), math.sin(ang) * (R + 0.02), ZE - 1.6), (math.cos(ang), math.sin(ang), 0), 0.8, 2.6, alpha=0.3)
    K.footprint(poly, 'HIGH', 'tower')
K.anchor('roof_ridge', (0, 0, ZE))
finish(ROOT + '/' + NAME)
