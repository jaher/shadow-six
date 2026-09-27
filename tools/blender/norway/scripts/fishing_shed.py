"""Lofoten-type fishing shed (rorbu / sjobu): red vertical board cabin with white trims standing half on a stone
foundation (land, +Y) and half on tarred log piles over the water (-Y), with a plank quay platform, ladder down to
the water, bollards, fish crates, a lamp and a loft hoist beam. Variants:
  a = rorbu 6 x 8 m, Falu red, red tile roof, quay on the front
  b = sjobu 5 x 7 m, ochre, sod roof, quay wrapping the east side, net drying poles
Usage: blender -b --python fishing_shed.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('fishing_shed')
name = 'fishing_shed_' + VAR + ('_snow' if SNOW else '')
WL = -0.9
K.begin(name, SEED, theater='snow' if SNOW else 'coast', snow=SNOW, water_level=WL)
r = K.rng()
Wd, Ln = (6.0, 8.0) if VAR == 'a' else (5.0, 7.0)
ZF = 0.55                                        # floor level
ZE = ZF + 3.0
PITCH = 38 if VAR == 'a' else 28
x0, x1, y0, y1 = -Wd / 2, Wd / 2, -Ln / 2, Ln / 2
poly = N.rect(x0, y0, x1, y1)
zr = ZE + (Wd / 2) * math.tan(math.radians(PITCH))
CL, TI = ('redv', None) if VAR == 'a' else ('batten', (1.0, 0.74, 0.4))
T = 0.18

door = K.opening(poly, 0, Wd / 2 - 0.9, 1.0, 2.0, ZF, T, 'rect', 'door')
loft = K.opening(poly, 0, Wd / 2, 1.1, 1.3, ZE + 0.3, T, 'rect', 'door')
wins = [K.opening(poly, 0, Wd / 2 + 1.4, 0.8, 1.0, ZF + 1.0, T),
        K.opening(poly, 1, 2.0, 0.8, 1.0, ZF + 1.0, T), K.opening(poly, 1, Ln - 2.0, 0.8, 1.0, ZF + 1.0, T),
        K.opening(poly, 3, 2.5, 0.8, 1.0, ZF + 1.0, T), K.opening(poly, 2, Wd / 2, 0.7, 0.9, ZE + 0.4, T)]
bdoor = K.opening(poly, 3, Ln - 1.5, 0.9, 1.9, ZF, T, 'rect', 'door')
N.board_walls(poly, ZF, ZE - ZF, T, [door, bdoor] + wins[:4], CL, TI)
N.board_gable(poly, 0, ZE, zr, T, [loft], CL, TI, name='gable_s')
N.board_gable(poly, 2, ZE, zr, T, [wins[4]], CL, TI, name='gable_n')
N.corner_boards(poly, ZF, ZE)
if VAR == 'b':
    # real cover battens (plank relief at 1x) + salt/damp weathering: darker, greyer boards toward the quay,
    # sun-faded upper boards, run-off streaks under the sod eaves
    _tz = math.tan(math.radians(PITCH))
    def _h(f, m=0.14):
        return (f.t - f.w / 2 - m, f.t + f.w / 2 + m, f.o.z - m, f.o.z + f.h + m) if hasattr(f, 't') else None
    def _hole(t, w, z0, h, m=0.14):
        return (t - w / 2 - m, t + w / 2 + m, z0 - m, z0 + h + m)
    N.battens((x0, y0), (x1, y0), (0, -1, 0), ZF + 0.08, lambda t: ZE + (Wd / 2 - abs(t - Wd / 2)) * _tz - 0.2,
              holes=[_hole(Wd / 2 - 0.9, 1.0, ZF, 2.0), _hole(Wd / 2, 1.1, ZE + 0.3, 1.3), _hole(Wd / 2 + 1.4, 0.8, ZF + 1.0, 1.0)],
              tint=TI, name='battens_s')
    N.battens((x1, y0), (x1, y1), (1, 0, 0), ZF + 0.08, lambda t: ZE - 0.3,
              holes=[_hole(2.0, 0.8, ZF + 1.0, 1.0), _hole(Ln - 2.0, 0.8, ZF + 1.0, 1.0)], tint=TI, name='battens_e')
    N.battens((x0, y1), (x0, y0), (-1, 0, 0), ZF + 0.08, lambda t: ZE - 0.3,
              holes=[_hole(2.5, 0.8, ZF + 1.0, 1.0), _hole(Ln - 1.5, 0.9, ZF, 1.9)], tint=TI, name='battens_w')
    N.weather_gradient(('walls', 'gable', 'battens_'), ZF, ZF + 2.4, low=(0.62, 0.6, 0.56), high=(1.04, 1.02, 0.98), seed=SEED)
    for k in range(6):
        sx = (-1, 1)[k % 2]
        K.decal('streak_rain', (sx * (Wd / 2 + 0.04), r.uniform(y0 + 0.6, y1 - 0.6), ZE - 0.8), (sx, 0, 0), 0.7, 1.4, alpha=0.8)
    for k in range(3):
        K.decal('stain_blotch', (r.uniform(x0 + 0.4, x1 - 0.4), y0 - 0.05, ZF + r.uniform(0.2, 0.7)), (0, -1, 0), 1.0, 0.6, alpha=0.6)
N.band(poly, ZF - 0.05, 0.16, 0.04, name='vannbord')
for k, f in enumerate(wins):
    K.window(f, 'casement', (1, 2), frame='white', recess=0.05, sill='wood_paint', curtain=0.6, streak=False, name='w%d' % k)
    N.casing(f, crown=VAR == 'a', name='cas%d' % k)
K.door(door, 'front', 'plank', (0.3, 0.33, 0.3) if VAR == 'a' else (0.4, 0.28, 0.2), step=None)
N.casing(door, name='cas_door')
K.door(bdoor, 'land', 'plank', (0.5, 0.46, 0.4), step=None)
N.casing(bdoor, crown=False, name='cas_bdoor')
from kit_arch import lbox
bm = K.bm_new()
lbox(bm, loft, -loft.w / 2, loft.w / 2, 0, loft.h, -0.12, -0.07)
K.part(bm, 'door_planks', name='loft_door', mat_tint=(0.9, 0.9, 0.85))
N.casing(loft, crown=False, apron=False, name='cas_loft')
# hoist beam projecting from the ridge over the loft door, with pulley
bm = K.bm_new()
K.box_bm(bm, (0, y0 - 0.45, zr - 0.35), (0.16, 1.4, 0.2))
K.part(bm, 'timber_beam', name='hoist_beam', uv='beam', axis=(0, 1, 0))
bm = K.bm_new()
K.cyl_bm(bm, (-0.05, y0 - 1.05, zr - 0.55), (0.05, y0 - 1.05, zr - 0.55), 0.1, 10)
K.cyl_bm(bm, (0, y0 - 1.13, zr - 0.6), (0, y0 - 1.13, ZF + 0.9), 0.012, 4)
K.part(bm, 'cast_iron', name='pulley')

# foundation: stone on land (north half), log piles over the water (south half)
K.wall_ring(C.poly_offset(N.rect(x0, 0.0, x1, y1), 0.04), ZF + 0.12, 0.5, 'fieldstone_grey', [bdoor], z0=-0.4,
            name='found', footprint=False)
bm = K.bm_new()
piles = []
qd = 2.4                                            # quay depth in front
qx0, qx1 = (x0 - 0.2, x1 + 0.2) if VAR == 'a' else (x0 - 0.2, x1 + 2.2)
for yy in (y0 - qd + 0.15, y0 - qd / 2, y0 + 0.2, y0 + 2.0, -0.2):
    nx = int((qx1 - qx0) / 1.6) + 1
    for i in range(nx + 1):
        xx = qx0 + 0.15 + (qx1 - qx0 - 0.3) * i / nx
        if yy > y0 and (xx > x1 + 0.3):
            continue
        if yy < y0 or abs(xx) > 0.1:
            K.cyl_bm(bm, (xx, yy, WL - 1.8), (xx + r.uniform(-0.05, 0.05), yy, ZF - 0.1), 0.14, 8)
            piles.append((xx, yy))
K.part(bm, 'timber_tarred', name='piles', uv='beam', axis=(0, 0, 1), smooth=True)
bm = K.bm_new()                                     # cross bracing between piles (below the deck)
for i in range(0, len(piles) - 1):
    a, b = piles[i], piles[i + 1]
    if abs(a[1] - b[1]) < 0.01 and abs(a[0] - b[0]) < 2.0:
        K.beam_bm(bm, (a[0], a[1], WL + 0.2), (b[0], b[1], ZF - 0.3), 0.08, 0.14)
K.part(bm, 'timber_tarred', name='bracing', uv='beam', axis=(1, 0, 0))
# quay deck
bm = K.bm_new()
for (ax0, ay0, ax1, ay1) in ([(qx0, y0 - qd, qx1, y0)] + ([(x1, y0, qx1, y1 - 1.0)] if VAR == 'b' else [])):
    K.box_bm(bm, ((ax0 + ax1) / 2, (ay0 + ay1) / 2, ZF - 0.2), (ax1 - ax0, ay1 - ay0, 0.25))
K.part(bm, 'timber_tarred', name='joists', uv='beam', axis=(1, 0, 0))
bm = K.bm_new()
for (ax0, ay0, ax1, ay1) in ([(qx0, y0 - qd, qx1, y0)] + ([(x1, y0, qx1, y1 - 1.0)] if VAR == 'b' else [])):
    n = int((ay1 - ay0) / 0.21)
    for k in range(n):
        yy = ay0 + (k + 0.5) * (ay1 - ay0) / n
        K.box_bm(bm, ((ax0 + ax1) / 2 + r.uniform(-0.03, 0.03), yy, ZF - 0.04), (ax1 - ax0 - r.uniform(0, 0.1), 0.19, 0.06))
K.part(bm, 'deck_planks', name='quay_planks', uv='beam', axis=(1, 0, 0))
K.footprint(N.rect(qx0, y0 - qd, qx1, y0), 'NONE', 'quay')
if VAR == 'b':
    K.footprint(N.rect(x1, y0, qx1, y1 - 1.0), 'NONE', 'quay')
K.roof_meta(N.rect(qx0, y0 - qd, qx1, y0), ZF, walkable=True, kind='quay')
C.A.meta['roofs'][-1]['walkable'] = True
# ladder down to the water, bollards, fish boxes, lantern
K.ladder((qx1 - 0.8, y0 - qd - 0.3, WL), ZF - WL, (0, -1, 0), meta=False)
K.ladder_meta((qx1 - 0.8, y0 - qd - 0.5), (qx1 - 0.8, y0 - qd + 0.3), ZF)
bm = K.bm_new()
for xx in (qx0 + 0.4, qx1 - 0.4):
    K.cyl_bm(bm, (xx, y0 - qd + 0.3, ZF), (xx, y0 - qd + 0.3, ZF + 0.55), 0.14, 10)
    K.cyl_bm(bm, (xx, y0 - qd + 0.3, ZF + 0.55), (xx, y0 - qd + 0.3, ZF + 0.62), 0.18, 10)
K.part(bm, 'cast_iron', name='bollards', smooth=True)
bm = K.bm_new()
for k in range(4):
    cx, cy = x0 + 0.9 + (k % 2) * 0.7, y0 - 0.6 - (k // 2) * 0.05
    K.box_bm(bm, (cx, cy, ZF + 0.18 + (k // 2) * 0.37), (0.62, 0.42, 0.34), rot_z=r.uniform(-0.1, 0.1))
K.part(bm, 'timber_grey', name='fish_boxes', rot90=True)
K.footprint(N.rect(x0 + 0.5, y0 - 0.9, x0 + 1.9, y0 - 0.3), 'LOW', 'crates')
K.wall_lantern((door.o.x + 0.8, y0, 0), (0, -1, 0), ZF + 2.2)
if VAR == 'b':
    bm = K.bm_new()                                 # net drying rack (hesje) on the side quay: 3 posts + crossbar
    px = qx1 - 0.35
    ys = (y0 + 0.5, (y0 + y1 - 1.0) / 2, y1 - 1.5)
    for yy in ys:
        K.cyl_bm(bm, (px, yy, ZF - 0.05), (px, yy, ZF + 2.35), 0.09, 8)
        K.beam_bm(bm, (px, yy, ZF + 1.7), (px + 0.45, yy, ZF + 0.02), 0.07, 0.07)       # raking strut
    K.cyl_bm(bm, (px, ys[0] - 0.2, ZF + 2.25), (px, ys[-1] + 0.2, ZF + 2.25), 0.07, 8)
    K.part(bm, 'log_hewn', name='net_poles', uv='beam', axis=(0, 0, 1), mat_tint=(0.6, 0.57, 0.52), smooth=True)
    netm, fl, bm = K.bm_new(), K.bm_new(), K.bm_new()
    ny = 14
    for side, dx in ((0, 0.02), (1, -0.02)):
        rows = []
        for j in range(4):
            row = []
            for k in range(ny + 1):
                yy = ys[0] + (ys[-1] - ys[0]) * k / ny
                sag = 0.18 * math.sin(math.pi * ((k * 2 / ny) % 1.0))
                zz = ZF + 2.2 - sag - j * 0.52 * (1 + 0.1 * math.sin(k * 1.7 + j))
                row.append(netm.verts.new(V((px + dx + 0.04 * math.sin(k * 0.9 + j), yy, zz))))
            rows.append(row)
        for j in range(3):
            for k in range(ny):
                f = (rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k])
                netm.faces.new(f if side == 0 else tuple(reversed(f)))
        if side == 0:
            for k in range(0, ny + 1, 1):                     # cork floats on the head rope, leads at the foot
                c0 = rows[0][k].co
                K.cyl_bm(fl, c0 + V((0.06, -0.05, 0)), c0 + V((0.06, 0.05, 0)), 0.055, 6)
                c1 = rows[3][k].co
                K.cyl_bm(bm, c1 + V((0.03, -0.03, 0)), c1 + V((0.03, 0.03, 0)), 0.03, 5)
    K.part(netm, 'hessian', name='net', mat_tint=(0.36, 0.36, 0.3), grime=0, bisect=False, jitter=0.1)
    K.part(fl, 'wood_paint', name='net_floats', mat_tint=(0.9, 0.62, 0.3), grime=0.3, smooth=True)
    K.part(bm, 'cast_iron', name='net_leads', grime=0.2)
    import kit_weather as KW
    nb = KW._blob_bm((qx1 - 1.2, y1 - 2.2, ZF + 0.12), 0.5, 3.0, (1.2, 1.5, 0.4), 2, 0.35)
    K.part(nb, 'hessian', name='net_heap', mat_tint=(0.3, 0.33, 0.28), grime=0.3)
    bm = K.bm_new()
    for k in range(5):
        K.cyl_bm(bm, (qx1 - 1.5 + k * 0.15, y1 - 2.0 - k * 0.1, ZF + 0.3), (qx1 - 1.5 + k * 0.15, y1 - 1.9 - k * 0.1, ZF + 0.3), 0.06, 6)
    K.part(bm, 'wood_paint', name='heap_floats', mat_tint=(0.9, 0.6, 0.3), smooth=True)
    K.footprint(N.rect(px - 0.2, ys[0] - 0.2, px + 0.6, ys[-1] + 0.2), 'LOW', 'net_rack')
    # continuous L-shaped quay edge: capping timbers + fender posts tie the side quay into the front quay
    bm = K.bm_new()
    edge = [(qx0, y0 - qd), (qx1, y0 - qd), (qx1, y1 - 1.0), (x1, y1 - 1.0)]
    for a_, b_ in zip(edge, edge[1:]):
        K.beam_bm(bm, (a_[0], a_[1], ZF + 0.02), (b_[0], b_[1], ZF + 0.02), 0.22, 0.14)
        L_ = math.hypot(b_[0] - a_[0], b_[1] - a_[1])
        for k in range(int(L_ / 1.2) + 1):
            t = k / max(1, int(L_ / 1.2))
            xx, yy = a_[0] + (b_[0] - a_[0]) * t, a_[1] + (b_[1] - a_[1]) * t
            K.cyl_bm(bm, (xx, yy, WL - 0.6), (xx, yy, ZF + 0.1), 0.1, 6)
    K.part(bm, 'timber_tarred', name='quay_edge', uv='beam', axis=(1, 0, 0), mat_tint=(0.8, 0.75, 0.7))
# roof
if VAR == 'a':
    R = K.roof_gable(0, 0, Ln, Wd, ZE, PITCH, 'roof_terracotta', rot=math.pi / 2, eave_oh=0.35, gable_oh=0.3,
                     thick=0.1, fascia='wood_paint', barge='wood_paint', gutters=False, sag=0.05)
    N.dress_roof(R, moss=0.5, guards=False, ridge=None, rafters=False, seed=SEED)
else:
    R = N.sod_roof(0, 0, Ln, Wd, ZE, PITCH, rot=math.pi / 2, eave_oh=0.4, gable_oh=0.3, barge_tint=(0.95, 0.94, 0.9),
                   seed=SEED, shrubs=1)
K.chimney(-0.9, 1.5, ZE - 0.4, R.z_ridge + 0.6, 0.55, 0.55, 'brick_red', cap='concrete_bunker', pots=0)
K.anchor('roof_ridge', (0, 0, R.z_ridge))
K.decal('waterline', (0, y0 - qd - 0.01, WL + 0.3), (0, -1, 0), qx1 - qx0, 0.8)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
