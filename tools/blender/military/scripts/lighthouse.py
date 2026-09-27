"""Coastal lighthouse (M7 Arendal mole; BCD M1 Guernsey): tapered round masonry tower, white-rendered, on an
octagonal granite plinth with steps; arched door under a moulded hood, small windows climbing the stair, corbelled
gallery with iron railing, 12-sided cast-iron lantern (vented base, glazed panes with astragals, Fresnel lens), red dome
with vent ball + lightning rod, attached lamp store with gable roof.
Variants: a (white + red lantern), b (red/white banded day-mark, grey lantern), snow (a + snow), destroyed (lantern
blown off, top of the shaft shattered, rubble, soot). Usage: ... lighthouse.py -- [a|b|snow|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 81)
K.begin('lighthouse' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='snow' if VAR == 'snow' else 'coast', snow=VAR == 'snow')
r = K.rng()
DEAD = VAR == 'destroyed'
RED = (0.62, 0.16, 0.12)
LANT = RED if VAR != 'b' else (0.35, 0.37, 0.36)
Z0, ZG = 0.8, 16.0                     # plinth top, gallery floor
R0, R1 = 2.9, 2.15                     # shaft radius at base / top
NS = 28


def rad(z):
    return R0 + (R1 - R0) * (z - Z0) / (ZG - Z0)


def ring(z, rr, n=NS, cx=0.0, cy=0.0):
    return [V((cx + math.cos(2 * math.pi * i / n) * rr, cy + math.sin(2 * math.pi * i / n) * rr, z)) for i in range(n)]


# ------------------------------------------------------------------ plinth + steps
bm = bmesh.new()
K.prism_bm(bm, [(math.cos(math.pi / 8 + k * math.pi / 4) * 3.9, math.sin(math.pi / 8 + k * math.pi / 4) * 3.9) for k in range(8)], -0.1, Z0)
K.part(bm, 'granite', name='plinth')
bm = bmesh.new()
K.prism_bm(bm, [(math.cos(math.pi / 8 + k * math.pi / 4) * 4.0, math.sin(math.pi / 8 + k * math.pi / 4) * 4.0) for k in range(8)], Z0 - 0.05, Z0 + 0.1)
K.part(bm, 'ashlar', name='plinth_cope')
K.stairs((0, -5.35, 0), (0, 1, 0), 1.6, Z0, 4, 'granite', name='steps')

# ------------------------------------------------------------------ shaft (tapered, slight entasis) with door + stair windows
ztop = ZG if not DEAD else 12.8
zs = [Z0 + (ztop - Z0) * k / 10 for k in range(11)]
bm = bmesh.new()
rings = [ring(z, rad(z) + 0.04 * math.sin(math.pi * (z - Z0) / (ZG - Z0))) for z in zs]
if DEAD:                                                     # jagged broken top
    rings[-1] = [p + V((0, 0, r.uniform(-1.6, 0.4))) for p in rings[-1]]
K.loft_bm(bm, rings)
frames = []
door = K.Frame((0, -rad(Z0) - 0.02, Z0), (0, -1, 0), (1, 0, 0), 1.1, 2.3, 0.9, 'arch', 'door')
frames.append(door)
wz = [(3.6, -70), (6.6, 20), (9.6, 110), (12.6, 200), (14.8, -90)]
wins = []
for z, a in wz:
    if z > ztop - 1.5:
        continue
    a = math.radians(a)
    n = V((math.cos(a), math.sin(a), 0))
    t = V((-n.y, n.x, 0))
    f = K.Frame(n * (rad(z) + 0.03) + V((0, 0, z)), n, t, 0.6, 1.0, 0.8, 'arch')
    frames.append(f)
    wins.append(f)
bm = K.boolean_cut(bm, frames)
BANDT = None
M.cyl_uv_smooth(bm, 'plaster_white')
shaft = K.part(bm, 'plaster_white', name='shaft', tint=(0.97, 0.96, 0.93), uv='keep', smooth=True)
if DEAD:                                                     # masonry wall thickness at the break: inner face + jagged top
    bm = bmesh.new()
    inner = [[V((p.x * (1 - 0.6 / rad(p.z)), p.y * (1 - 0.6 / rad(p.z)), p.z)) for p in rr] for rr in rings]
    vo = [bm.verts.new(p) for p in rings[-1]]
    vi = [bm.verts.new(p + V((0, 0, r.uniform(-0.35, 0.1)))) for p in inner[-1]]
    for i in range(NS):
        j = (i + 1) % NS
        bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
    K.loft_bm(bm, [[V((p.x, p.y, min(p.z, vi[k].co.z))) for k, p in enumerate(inner[-1])]] + [inner[k] for k in range(len(inner) - 2, 1, -1)], close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'fieldstone_grey', name='break_core', mat_tint=(0.78, 0.76, 0.72), grime=0.5)
    bm = bmesh.new()                                         # a few dislodged blocks teetering on the rim
    for k in range(9):
        p = rings[-1][r.randrange(NS)]
        K.box_bm(bm, tuple(p * 0.9 + V((0, 0, 0.12))), (0.45, 0.3, 0.25), r.uniform(0, 3))
    K.part(bm, 'ashlar', name='rim_blocks')
if VAR == 'b':                                               # red day-mark bands (thin shells over the render)
    for z0b, z1b in ((4.0, 6.5), (9.0, 11.5)):
        bm = bmesh.new()
        K.loft_bm(bm, [ring(z, rad(z) + 0.035) for z in (z0b, (z0b + z1b) / 2, z1b)], close_start=False, close_end=False)
        bm = K.boolean_cut(bm, [f for f in wins if z0b - 1.2 < f.o.z < z1b])
        M.cyl_uv_smooth(bm, 'plaster_white')
        K.part(bm, 'plaster_white', name='band', mat_tint=(0.8, 0.26, 0.2), grime=0.6, uv='keep', smooth=True)
for f in wins:
    K.window(f, 'fixed', (1, 2), frame=(0.3, 0.3, 0.3), sill='ashlar', lintel=None, surround=None, curtain=0.0, streak=True, name='win')
K.door(door, 'base', 'panel', (0.25, 0.33, 0.3) if VAR != 'b' else (0.45, 0.14, 0.1), step=None, lintel=None, surround='ashlar')
bm = bmesh.new()                                             # moulded hood over the door
K.box_bm(bm, (0, -rad(Z0 + 2.6) - 0.15, Z0 + 3.0), (1.9, 0.4, 0.14))
K.box_bm(bm, (0, -rad(Z0 + 2.6) - 0.08, Z0 + 3.12), (1.7, 0.3, 0.12))
K.part(bm, 'ashlar', name='door_hood')

if not DEAD:
    # -------------------------------------------------------------- gallery: corbels, slab, railing
    bm = bmesh.new()
    for i in range(16):
        a = 2 * math.pi * i / 16
        n = V((math.cos(a), math.sin(a), 0))
        t = V((-n.y, n.x, 0))
        p0 = n * (R1 - 0.1)
        pts = [p0 + V((0, 0, ZG - 0.25)), p0 + n * 0.85 + V((0, 0, ZG - 0.25)), p0 + V((0, 0, ZG - 1.1))]
        K.loft_bm(bm, [[p - t * 0.1 for p in pts], [p + t * 0.1 for p in pts]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'ashlar', name='corbels')
    bm = bmesh.new()
    K.loft_bm(bm, [ring(ZG - 0.25, 3.05, 32), ring(ZG, 3.05, 32)])
    K.part(bm, 'granite', name='gallery_slab', tint=(0.9, 0.9, 0.9))
    bm = bmesh.new()
    for i in range(32):
        a = 2 * math.pi * i / 32
        p = V((math.cos(a) * 2.95, math.sin(a) * 2.95, ZG))
        K.cyl_bm(bm, p, p + V((0, 0, 1.05)), 0.02 if i % 4 else 0.035, 4)
    for z, rr in ((1.05, 0.035), (0.55, 0.02), (0.12, 0.02)):
        pr = ring(ZG + z, 2.95, 32)
        for i in range(32):
            K.cyl_bm(bm, pr[i], pr[(i + 1) % 32], rr, 4, caps=False)
    K.part(bm, 'steel_painted', name='gallery_rail', mat_tint=LANT, grime=0.3, bisect=False)
    # -------------------------------------------------------------- lantern
    NL = 12
    zl0, zl1, zl2 = ZG, ZG + 1.0, ZG + 3.0
    bm = bmesh.new()
    K.loft_bm(bm, [ring(zl0, 1.45, NL), ring(zl1, 1.45, NL), ring(zl1, 1.52, NL), ring(zl1 + 0.08, 1.52, NL)])
    K.part(bm, 'steel_painted', name='lantern_base', mat_tint=LANT, grime=0.5)
    bm = bmesh.new()
    rl = ring(zl1 + 0.08, 1.42, NL)
    ru = ring(zl2, 1.42, NL)
    for i in range(NL):
        K.beam_bm(bm, rl[i], ru[i], 0.08, 0.08)
    for z in (zl1 + 0.08, zl1 + 1.0, zl2):
        pr = ring(z, 1.43, NL)
        for i in range(NL):
            K.beam_bm(bm, pr[i], pr[(i + 1) % NL], 0.07, 0.07)
    K.part(bm, 'steel_painted', name='astragals', mat_tint=LANT, grime=0.3, bisect=False)
    bm = bmesh.new()
    K.loft_bm(bm, [ring(zl1 + 0.08, 1.38, NL), ring(zl2, 1.38, NL)], close_start=False, close_end=False)
    K.part(bm, 'glass_dirty', name='lantern_glass', grime=0, bisect=False)
    bm = bmesh.new()                                         # Fresnel lens (brass frame, glass drum)
    K.cyl_bm(bm, (0, 0, zl1), (0, 0, zl1 + 0.35), 0.35, 10)
    for k in range(5):
        z = zl1 + 0.4 + k * 0.25
        K.cyl_bm(bm, (0, 0, z), (0, 0, z + 0.05), 0.62 - abs(k - 2) * 0.06, 16)
    K.part(bm, 'steel_galv', name='lens_frame', mat_tint=(1.0, 0.82, 0.45), smooth=True, grime=0)
    bm = bmesh.new()
    K.cyl_bm(bm, (0, 0, zl1 + 0.4), (0, 0, zl1 + 1.45), 0.58, 16)
    K.part(bm, 'glass_dirty', name='lens', grime=0, bisect=False, mat_tint=(1.4, 1.5, 1.4))
    bm = bmesh.new()                                         # dome, vent ball, lightning rod
    dr = []
    for k in range(7):
        t = k / 6
        dr.append(ring(zl2 + 0.05 + 1.1 * math.sin(t * math.pi / 2), 1.62 * math.cos(t * math.pi / 2) + 0.12 * (1 - t), 24))
    K.loft_bm(bm, dr, close_start=True, close_end=True)
    K.cyl_bm(bm, (0, 0, zl2 + 1.1), (0, 0, zl2 + 1.35), 0.18, 10)
    K.cyl_bm(bm, (0, 0, zl2 + 1.35), (0, 0, zl2 + 1.62), 0.3, 10, r1=0.05)
    K.cyl_bm(bm, (0, 0, zl2 + 1.62), (0, 0, zl2 + 2.6), 0.02, 4)
    K.part(bm, 'steel_painted', name='dome', mat_tint=LANT, smooth=True, grime=0.4)
    K.anchor('light', (0, 0, zl1 + 0.9), (0, -1, 0), kind='beacon', radius=60.0, rotating=True)
    K.roof_meta([(math.cos(2 * math.pi * k / 12) * 2.9, math.sin(2 * math.pi * k / 12) * 2.9) for k in range(12)], ZG, walkable=True, kind='gallery')
    K.ladder_meta((0, -rad(Z0) - 0.8), (0, -2.5), ZG)

# ------------------------------------------------------------------ keeper's cottage (N) with oil store lean-to + walled yard
hp = [(-4.6, 3.6), (4.6, 3.6), (4.6, 9.4), (-4.6, 9.4)]
hd = K.opening(hp, 0, 3.2, 1.0, 2.1, 0.0, 0.5, 'rect', 'door')
hw = [K.opening(hp, 0, 1.3, 0.9, 1.2, 0.95, 0.5), K.opening(hp, 0, 6.4, 0.9, 1.2, 0.95, 0.5), K.opening(hp, 0, 8.0, 0.9, 1.2, 0.95, 0.5),
      K.opening(hp, 2, 2.2, 0.9, 1.2, 0.95, 0.5), K.opening(hp, 2, 6.8, 0.9, 1.2, 0.95, 0.5), K.opening(hp, 3, 2.9, 0.8, 1.1, 1.0, 0.5)]
K.wall_ring(hp, 3.1, 0.5, 'plaster_white', [hd] + hw, plinth=('granite', 0.45, 0.05), name='cottage', tint=(0.96, 0.95, 0.91))
for f in hw:
    K.window(f, 'sash', (2, 2), frame='white', sill='granite', lintel='granite', shutters='open' if f.o.y < 5 else None,
             shutter_color=LANT if VAR != 'b' else (0.3, 0.38, 0.34), curtain=0.5, name='cwin')
K.door(hd, 'cottage', 'panel', (0.42, 0.14, 0.1) if VAR != 'b' else (0.25, 0.33, 0.3), step='granite', lintel='granite')
Rh = K.roof_gable(0, 6.5, 9.2, 5.8, 3.1, 40, 'roof_slate' if VAR != 'b' else 'roof_terracotta', eave_oh=0.35, gable_oh=0.25, thick=0.12,
                  fascia='wood_paint', barge='wood_paint', gutters=True)
for e in (1, 3):
    K.gable(hp, e, 3.1, Rh.z_ridge - Rh.lift, 0.5, 'plaster_white', name='cottage_gable')
K.chimney(-4.25, 6.5, 3.1, Rh.z_ridge + 0.6, 0.7, 0.55, 'plaster_white', cap='granite', pots=2)
K.chimney(4.25, 6.5, 3.1, Rh.z_ridge + 0.6, 0.7, 0.55, 'plaster_white', cap='granite', pots=1)
K.dormer(Rh, 0.0, side=-1, w=1.3, h=1.1, wall='plaster_white', roof='roof_slate' if VAR != 'b' else 'roof_terracotta')
bm = bmesh.new()                                             # porch hood over the door on brackets
K.box_bm(bm, (-1.4, 3.6 - 0.45, 2.45), (1.6, 0.9, 0.08))
for x in (-2.1, -0.7):
    K.beam_bm(bm, (x, 3.58, 1.9), (x, 3.0, 2.4), 0.08, 0.08)
K.part(bm, 'wood_paint', name='porch', mat_tint=(0.9, 0.9, 0.86))
lp = [(4.6, 4.4), (7.0, 4.4), (7.0, 8.6), (4.6, 8.6)]           # oil store lean-to (east)
ld = K.opening(lp, 0, 1.2, 0.9, 1.9, 0.0, 0.35, 'rect', 'door')
K.wall_ring(lp, 2.3, 0.35, 'plaster_white', [ld], plinth=('granite', 0.3, 0.04), name='oilstore', tint=(0.93, 0.92, 0.88))
K.door(ld, 'oil', 'plank', (0.3, 0.3, 0.28), step='granite')
K.roof_shed(4.6, 4.4, 7.0, 8.6, 2.3, 2.9, 'roof_slate' if VAR != 'b' else 'roof_terracotta', low_side='+x', oh=0.25, name='oil_roof')
bm = bmesh.new()                                             # whitewashed yard wall with coping and a gate gap
for (xa, ya), (xb, yb) in (((-7.5, 2.0), (-7.5, 11.5)), ((-7.5, 11.5), (8.5, 11.5)), ((8.5, 11.5), (8.5, 2.0)), ((8.5, 2.0), (4.2, 2.0)), ((-4.0, 2.0), (-7.5, 2.0))):
    K.beam_bm(bm, (xa, ya, 0.6), (xb, yb, 0.6), 0.4, 1.3)
yw = K.part(bm, 'plaster_white', name='yard_wall', mat_tint=(0.93, 0.92, 0.88))
bm = bmesh.new()
for (xa, ya), (xb, yb) in (((-7.5, 2.0), (-7.5, 11.5)), ((-7.5, 11.5), (8.5, 11.5)), ((8.5, 11.5), (8.5, 2.0)), ((8.5, 2.0), (4.2, 2.0)), ((-4.0, 2.0), (-7.5, 2.0))):
    K.beam_bm(bm, (xa, ya, 1.3), (xb, yb, 1.3), 0.5, 0.1)
K.part(bm, 'granite', name='yard_coping', mat_tint=(0.85, 0.85, 0.83))
for x in (-7.5, 8.5):
    K.footprint_rect(x, 6.75, 0.4, 9.5, block='LOW', kind='yard_wall')
K.footprint_rect(0.5, 11.5, 16.0, 0.4, block='LOW', kind='yard_wall')

# ------------------------------------------------------------------ weathering
for i in range(12):                                          # varied streaks (no two alike) + a few hairline cracks
    a = r.uniform(-math.pi, math.pi)
    z = r.uniform(2.0, ztop - 1.0)
    n = V((math.cos(a), math.sin(a), 0))
    kind = r.choice(['streak_long', 'streak_rain', 'streak_rust', 'streak_long', 'crack'])
    w = r.uniform(0.35, 1.3) if kind != 'crack' else r.uniform(0.4, 0.9)
    K.decal(kind, n * (rad(z) + 0.06) + V((0, 0, z)), n, w, w * r.uniform(1.4, 3.2), alpha=r.uniform(0.3, 0.55), flip=r.random() < 0.5)
for i in range(6):
    a = r.uniform(-math.pi, math.pi)
    n = V((math.cos(a), math.sin(a), 0))
    K.decal(r.choice(['damp_base', 'lichen', 'moss_patch']), n * (rad(1.4) + 0.07) + V((0, 0, 1.4)), n, 1.4, 1.0, alpha=0.6)

# ------------------------------------------------------------------ destroyed
if DEAD:
    K.bite((1.2, -1.5, ztop - 0.4), 1.9, (1.0, 1.0, 1.3), seed=4, parts=[shaft])
    WW = (0.95, 0.95, 0.93)
    zs1 = M.rubble((-2.8, -3.6, 0), 3.0, 1.3, mids=('plaster_white', 'ashlar'), n=34, beams=0, tiles=None, block_tint=WW,
                   mound_tint=(1.0, 1.0, 0.98))
    zs2 = M.rubble((3.6, 1.0, 0), 2.2, 0.8, mids=('ashlar', 'plaster_white'), n=18, beams=0, tiles=None, block_tint=WW,
                   mound_tint=(1.0, 1.0, 0.98))
    bm = bmesh.new()                                          # thick curved shaft fragments (0.55 m wall) on the scree
    for (cx, cy, zf), yaw, tilt in (((-3.4, -3.0, zs1), 0.4, 0.5), ((-1.6, -4.6, zs1), 2.2, -0.35), ((3.3, 0.6, zs2), 4.0, 0.3),
                                    ((-4.3, -4.7, zs1), 1.1, 0.9)):
        ro, t, sp, hh = 2.1, 0.55, math.radians(r.uniform(22, 34)), r.uniform(0.7, 1.1)
        ring = []
        for k in range(4):
            a = -sp / 2 + sp * k / 3
            ring += [(math.cos(a) * ro - ro, math.sin(a) * ro), ]
        inner = [(math.cos(-sp / 2 + sp * k / 3) * (ro - t) - ro, math.sin(-sp / 2 + sp * k / 3) * (ro - t)) for k in range(4)]
        poly = K.ccw(ring + list(reversed(inner)))
        nb = len(bm.verts)
        K.prism_bm(bm, poly, -hh / 2, hh / 2)
        bm.verts.ensure_lookup_table()
        T = Matrix.Translation((cx, cy, zf(cx, cy) + 0.25)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X')
        for v in bm.verts[nb:]:
            v.co = T @ v.co
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'plaster_white', name='rubble_shaftchunks', mat_tint=WW, smooth=False)
    bm = bmesh.new()                                          # crumpled lantern cage lying on the scree (not loose sticks)
    cc = V((-1.9, -2.6, zs1(-1.9, -2.6) + 0.35))
    T = Matrix.Translation(cc) @ Matrix.Rotation(0.5, 4, 'Z') @ Matrix.Rotation(1.25, 4, 'X')
    oc = [(math.cos(k * math.pi / 4) * 1.05, math.sin(k * math.pi / 4) * 1.05 * (0.75 if k in (2, 3) else 1.0)) for k in range(8)]
    for k in range(8):
        a, b = oc[k], oc[(k + 1) % 8]
        for z in (-0.6, 0.6):
            K.beam_bm(bm, tuple(T @ V((a[0], a[1], z))), tuple(T @ V((b[0], b[1], z + (0.15 if k == 3 else 0)))), 0.06, 0.06)
        if k != 5:
            K.beam_bm(bm, tuple(T @ V((a[0], a[1], -0.6))), tuple(T @ V((a[0] * (0.8 if k == 2 else 1), a[1], 0.6))), 0.05, 0.05)
    K.part(bm, 'steel_painted', name='lantern_wreck', mat_tint=LANT)
    for z in (ztop - 1.8, ztop - 3.8):
        for a in (-0.4, 0.9, 2.4):
            n = V((math.cos(a), math.sin(a), 0))
            K.decal('soot', n * (rad(z) + 0.07) + V((0, 0, z)), n, 2.2, 2.4, alpha=0.95)
    K.scorch_openings(0.9, 0.8)
    K.anchor('fire', (0, 0, ztop - 1.0), kind='fire_large')

# ------------------------------------------------------------------ metadata
K.footprint([(math.cos(math.pi / 8 + k * math.pi / 4) * 4.0, math.sin(math.pi / 8 + k * math.pi / 4) * 4.0) for k in range(8)], 'HIGH', 'lighthouse')
K.anchor('bomb_target', (0, -rad(Z0) - 0.4, Z0), (0, -1, 0), kind='charge_spot')
if VAR == 'snow':
    K.snow_pass(thick=0.09, min_area=0.06)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
