"""M4 Stokkan (Trondheim, March 1941) art pass builds (norway family; own types only, M4 picks them by `asset`).
 arch   arch_gate_granite_no      5.6 x 0.9 x 4.5: the inner compound gate, two dressed granite piers on plinths with
                                  impost blocks, a segmental arch of granite voussoirs with a keystone over the 4.4 m
                                  opening, rubble-granite spandrels, a slab coping, an iron lantern bracket and a
                                  HALT board on the yard face; `archd` = the collapsed arch (_destroyed): broken pier
                                  stumps, the arch down in a heap of granite blocks across the opening
 ruina  ruin_fieldstone_no_a      5 x 1: a broken fieldstone wall with a window gap and a ragged top
 ruinb  ruin_fieldstone_no_b      8 x 6: L-shaped ruin of a farmhouse (two standing walls, low foundation courses on
                                  the other sides, chimney stub, rubble and a charred beam inside)
 ruinc  ruin_fieldstone_no_c      9 x 5: U-shaped ruin with a doorway and a gable stub
 hen    henhouse_no               3 x 2 x 2: Falu-red board henhouse on stone pads, tar-paper shed roof, nest box,
                                  pop-hole ramp, a netted run on the E end; `hend` = smashed (_destroyed)
 jail   jail_guardhouse_no        5 x 4 x 3.5: tarred log guardhouse with barred windows, iron-strapped door, WACHE
                                  board, porch lamp, stovepipe, tar-paper roof; `jaild` = blown (_destroyed)
usage: blender -b --python stokkan.py -- outroot variant seed [snow]"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'europe', 'scripts'))
import bmesh
import nlib as N
from nlib import K, V, C
import eu_dmg

OUT, VAR, SEED, SNOW = N.args('stokkan')
BASE = {'arch': 'arch_gate_granite_no', 'archd': 'arch_gate_granite_no', 'ruina': 'ruin_fieldstone_no_a',
        'ruinb': 'ruin_fieldstone_no_b', 'ruinc': 'ruin_fieldstone_no_c', 'hen': 'henhouse_no', 'hend': 'henhouse_no',
        'jail': 'jail_guardhouse_no', 'jaild': 'jail_guardhouse_no'}[VAR]
DEST = VAR.endswith('d') and VAR != 'ruind'
NAME = BASE + ('_destroyed' if DEST else '') + ('_snow' if SNOW and not DEST else '')
K.begin(NAME, SEED, theater='snow' if (SNOW or DEST) else 'temperate', snow=SNOW or DEST)
rq = random.Random(SEED * 31 + len(VAR))


def xz_prism(bm, pts, y0, y1):
    """Extrude a closed XZ outline (list of (x, z)) between y0 and y1 (front y0 face, back y1 face, side quads)."""
    f = [bm.verts.new((x, y0, z)) for (x, z) in pts]
    b = [bm.verts.new((x, y1, z)) for (x, z) in pts]
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], b[i], b[j], f[j]))


def stones_on(bm, x0, x1, y0, y1, ztop, n, s=(0.22, 0.4)):
    """Loose / bedded stones along a wall top (ragged silhouette)."""
    for _ in range(n):
        x = rq.uniform(x0, x1)
        y = rq.uniform(y0, y1)
        a = rq.uniform(*s)
        z = ztop(x) if callable(ztop) else ztop
        K.box_bm(bm, (x, y, z + a * 0.25), (a * rq.uniform(0.9, 1.4), a * rq.uniform(0.7, 1.0), a * 0.55), rot_z=rq.uniform(-0.6, 0.6),
                 taper=(0.8, 0.85))


def ragged_wall(bm, x0, x1, y, t, hfun, step=0.3, gaps=()):
    """Fieldstone wall along X from x0 to x1 (centre line y, thickness t) whose top follows hfun(x) (sloped column
    tops, so the break line reads as rough masonry, not steps); `gaps` = [(xa, xb, zsill)] window gaps."""
    def hh(x):
        h = hfun(x)
        for (ga, gb, zs) in gaps:
            if ga <= x <= gb:
                h = min(h, zs)
        return h
    x = x0
    while x < x1 - 1e-3:
        w = min(step, x1 - x)
        xa, xb = x, x + w
        for (ga, gb, zs) in gaps:                      # snap columns to the gap edges (square reveals)
            if xa < ga < xb:
                xb = ga
            elif xa < gb < xb:
                xb = gb
        ha, hb = hh(xa + 0.01), hh(xb - 0.01)
        if max(ha, hb) > 0.05:
            ya, yb = y - t / 2, y + t / 2
            K.hexa_bm(bm, [V((xa, ya, 0)), V((xb, ya, 0)), V((xb, yb, 0)), V((xa, yb, 0)),
                           V((xa, ya, ha)), V((xb, ya, hb)), V((xb, yb, hb)), V((xa, yb, ha))])
        x = xb


def wall_y(bm, y0, y1, x, t, hfun, step=0.3):
    """Same as ragged_wall but along Y (centre line x); hfun takes the distance from y0."""
    y = y0
    while y < y1 - 1e-3:
        w = min(step, y1 - y)
        ha, hb = hfun(y - y0 + 0.01), hfun(y + w - y0 - 0.01)
        if max(ha, hb) > 0.05:
            xa, xb = x - t / 2, x + t / 2
            K.hexa_bm(bm, [V((xa, y, 0)), V((xb, y, 0)), V((xb, y + w, 0)), V((xa, y + w, 0)),
                           V((xa, y, ha)), V((xb, y, ha)), V((xb, y + w, hb)), V((xa, y + w, hb))])
        y += w


def ragged(seed, lo, hi, L, k=5):
    """Smooth random height profile over [0, L]: piecewise-linear through k+1 knots."""
    r = random.Random(seed)
    knots = [r.uniform(lo, hi) for _ in range(k + 1)]

    def f(x):
        t = max(0.0, min(1.0, x / L)) * k
        i = min(int(t), k - 1)
        return knots[i] + (knots[i + 1] - knots[i]) * (t - i)
    return f


# ------------------------------------------------------------------------------------------------ the granite arch
PX, PW, PD = 2.5, 0.6, 0.9                     # pier centre, width (x), depth (y)
ZI, RISE, SPAN = 3.2, 0.85, 4.4                # springing (top of the impost), arch rise, clear span
RAD = (SPAN * SPAN / 4 + RISE * RISE) / (2 * RISE)
ZC = ZI + RISE - RAD
HALF = math.asin(SPAN / 2 / RAD)
DEPTH = 0.5                                    # voussoir depth (radial)


def arc_pt(a, r):
    return (r * math.sin(a), ZC + r * math.cos(a))


def piers(top_l=ZI, top_r=ZI, broken=False):
    bm = K.bm_new()
    for sx, top in ((-1, top_l), (1, top_r)):
        cx = sx * PX
        K.box_bm(bm, (cx, 0, 0.2), (PW + 0.22, PD + 0.18, 0.45), taper=(0.97, 0.97))       # plinth
        z, k = 0.42, 0
        while z < top - 0.05:
            hc = min(0.56, top - z)
            dx = rq.uniform(-0.015, 0.015)
            K.box_bm(bm, (cx + dx, rq.uniform(-0.01, 0.01), z + hc / 2), (PW + rq.uniform(-0.02, 0.02), PD + rq.uniform(-0.02, 0.02), hc - 0.012))
            z += hc; k += 1
        if not broken:
            K.box_bm(bm, (cx, 0, ZI - 0.11), (PW + 0.14, PD + 0.1, 0.22))                  # impost block
        else:
            stones_on(bm, cx - 0.3, cx + 0.3, -0.4, 0.4, top, 4, (0.2, 0.35))
    K.part(bm, 'granite', name='piers', jitter=0.08, mat_tint=(0.86, 0.85, 0.83))


if VAR in ('arch', 'archd'):
    if VAR == 'arch':
        piers()
        bm = K.bm_new()                                # rubble-granite spandrel wall above the imposts
        pts = [(-PX - PW / 2, ZI)]
        n = 16
        for i in range(n + 1):
            a = -HALF + 2 * HALF * i / n
            pts.append(arc_pt(a, RAD))
        pts += [(PX + PW / 2, ZI), (PX + PW / 2, 4.3), (-PX - PW / 2, 4.3)]
        xz_prism(bm, pts, -0.43, 0.43)
        K.part(bm, 'fieldstone_grey', name='spandrel', grime=0.7, mat_tint=(0.82, 0.8, 0.78))
        bm = K.bm_new()                                # voussoirs (13) with a raised keystone, proud of both faces
        nv = 13
        for i in range(nv):
            a0 = -HALF + 2 * HALF * i / nv + 0.004
            a1 = -HALF + 2 * HALF * (i + 1) / nv - 0.004
            dep = DEPTH + (0.18 if i == nv // 2 else rq.uniform(-0.03, 0.03))
            yb = 0.48 if i == nv // 2 else 0.46
            p = [arc_pt(a0, RAD), arc_pt(a1, RAD), arc_pt(a1, RAD + dep), arc_pt(a0, RAD + dep)]
            K.hexa_bm(bm, [V((p[0][0], -yb, p[0][1])), V((p[1][0], -yb, p[1][1])), V((p[1][0], yb, p[1][1])), V((p[0][0], yb, p[0][1])),
                           V((p[3][0], -yb, p[3][1])), V((p[2][0], -yb, p[2][1])), V((p[2][0], yb, p[2][1])), V((p[3][0], yb, p[3][1]))])
        K.part(bm, 'granite', name='voussoirs', jitter=0.1, mat_tint=(0.9, 0.89, 0.87))
        bm = K.bm_new()                                # coping slabs (3) with a weathering slope
        for k in range(3):
            x0 = -PX - PW / 2 - 0.08 + k * (2 * PX + PW + 0.16) / 3
            K.box_bm(bm, (x0 + (2 * PX + PW + 0.16) / 6, 0, 4.4), ((2 * PX + PW + 0.16) / 3 - 0.015, PD + 0.16, 0.2), taper=(1.0, 0.92))
        K.part(bm, 'granite', name='coping', jitter=0.06, mat_tint=(0.8, 0.8, 0.79))
        # wrought-iron lantern on a scroll bracket (yard face, +Y = north at rot 0), HALT board on the S pier face
        bm = K.bm_new()
        K.beam_bm(bm, (PX, PD / 2, 2.75), (PX, PD / 2 + 0.55, 2.75), 0.03, 0.03)
        K.beam_bm(bm, (PX, PD / 2, 2.45), (PX, PD / 2 + 0.45, 2.73), 0.02, 0.02)
        K.box_bm(bm, (PX, PD / 2 + 0.55, 2.62), (0.2, 0.2, 0.04))
        K.box_bm(bm, (PX, PD / 2 + 0.55, 2.38), (0.18, 0.18, 0.03))
        for sx in (-1, 1):
            for sy in (-1, 1):
                K.box_bm(bm, (PX + sx * 0.085, PD / 2 + 0.55 + sy * 0.085, 2.5), (0.015, 0.015, 0.24))
        K.cyl_bm(bm, (PX, PD / 2 + 0.55, 2.64), (PX, PD / 2 + 0.55, 2.78), 0.11, 4, r1=0.02)
        K.part(bm, 'cast_iron', name='lamp_iron', mat_tint=(0.25, 0.25, 0.25), lod='keep')
        K.P('glass_dirty', K.box_bm, (PX, PD / 2 + 0.55, 2.5), (0.15, 0.15, 0.22), name='lamp_glass')
        K.anchor('light', (PX, PD / 2 + 0.55, 2.5), (0, 1, 0), kind='light')
        K.sign((-PX, -PD / 2 - 0.02, 1.85), (0, -1, 0), 0.5, 'halt_sperrgebiet', board='timber_grey')
        K.decal('streak_rain', (0, -0.47, 3.0), (0, -1, 0), 0.9, 1.2, alpha=0.5)
        K.decal('lichen', (-PX, -0.462, 0.9), (0, -1, 0), 0.6, 0.8, alpha=0.5)
        K.decal('damp_base', (PX, -0.462, 0.55), (0, -1, 0), 0.7, 0.5, alpha=0.6)
    else:
        piers(1.55, 2.35, broken=True)
        eu_dmg.heap(V((0, 0, 0)), 2.0, 1.25, stone='fieldstone_grey', dress='granite', tiles=None, seed=SEED, name='arch_heap',
                    footprint=False, n=34, beams=0, planks=0, slabs=0, elong=1.55)
        bm = K.bm_new()                                # fallen voussoirs and coping slabs on the heap and beside it
        for k in range(9):
            x, y = rq.uniform(-2.6, 2.6), rq.uniform(-1.4, 1.4)
            z = max(0.12, 1.0 - abs(x) * 0.3 - abs(y) * 0.35)
            K.box_bm(bm, (x, y, z), (rq.uniform(0.45, 0.7), rq.uniform(0.35, 0.5), rq.uniform(0.25, 0.4)), rot_z=rq.uniform(-1.5, 1.5),
                     taper=(0.75, 1.0))
        K.box_bm(bm, (1.2, -1.2, 0.12), (1.9, 1.0, 0.2), rot_z=0.3)
        K.part(bm, 'granite', name='blocks', jitter=0.1, mat_tint=(0.8, 0.79, 0.77))
        K.P('cast_iron', K.beam_bm, (2.0, 1.1, 0.1), (2.5, 1.5, 0.16), 0.05, 0.05, name='lamp_bent', mat_tint=(0.2, 0.2, 0.2))
        K.decal('soot', (0, -0.48, 1.2), (0, -1, 0), 2.0, 1.4, alpha=0.6)
    for sx in (-1, 1):
        K.footprint(N.rect(sx * PX - PW / 2, -PD / 2, sx * PX + PW / 2, PD / 2), 'HIGH', 'wall')
    K.footprint(N.rect(-SPAN / 2, -PD / 2, SPAN / 2, PD / 2), 'NONE', 'gate_passage')

# ------------------------------------------------------------------------------------------------ fieldstone ruins
def foundation(bm, x0, x1, y0, y1, h=0.45):
    """Low mortared foundation course round a rect (the sill line of the vanished timber upper walls)."""
    t = 0.55
    for (a, b, y) in ((x0, x1, y0 + t / 2), (x0, x1, y1 - t / 2)):
        ragged_wall(bm, a, b, y, t, ragged(rq.random() * 1e6, h * 0.5, h, b - a, 4))
    for (a, b, x) in ((y0 + t, y1 - t, x0 + t / 2), (y0 + t, y1 - t, x1 - t / 2)):
        wall_y(bm, a, b, x, t, ragged(rq.random() * 1e6, h * 0.5, h, b - a, 3))


def ruin_dress(x0, x1, y0, y1, heaps, beams):
    for k, (hx, hy, rad, hh) in enumerate(heaps):
        eu_dmg.heap(V((hx, hy, 0)), rad, hh, stone='fieldstone_grey', dress='granite', tiles='roof_slate', seed=SEED + k, name='heap%d' % k,
                    footprint=False, n=16, beams=1, planks=2, slabs=0, elong=1.2, rot=rq.uniform(0, 3))
    bm = K.bm_new()
    for (p0, p1) in beams:
        eu_dmg.splinter_bm(bm, V(p0), V(p1), 0.18, 0.2, rq, 0.4)
    if beams:
        K.part(bm, 'timber_tarred', name='charred_beams', uv='beam', axis=(1, 0, 0), mat_tint=(0.3, 0.28, 0.26))
    K.decal('soot', (x0 + 1.0, y0 - 0.02, 1.0), (0, -1, 0), 1.6, 1.2, alpha=0.55)
    K.decal('moss_patch', (x1 - 1.2, y0 - 0.02, 0.35), (0, -1, 0), 1.4, 0.5, alpha=0.6)


if VAR == 'ruina':                                 # 5 x 1: a broken wall with a window gap
    L = 5.0
    bm = K.bm_new()
    hf = ragged(SEED * 7 + 1, 1.3, 2.6, L, 6)
    ragged_wall(bm, -L / 2, L / 2, 0, 0.6, lambda x: hf(x + L / 2), gaps=[(0.2, 1.1, 0.95)])
    K.box_bm(bm, (0, 0, 0.12), (L + 0.2, 0.8, 0.25))                     # footing course
    K.part(bm, 'fieldstone_grey', name='wall', grime=0.8, mat_tint=(0.8, 0.79, 0.77))
    bm = K.bm_new()
    stones_on(bm, -L / 2, L / 2, -0.2, 0.2, lambda x: hf(x + L / 2) if not (0.2 <= x <= 1.1) else 0.95, 9)
    K.box_bm(bm, (0.65, 0, 0.98), (1.2, 0.66, 0.08))                       # granite window sill
    for x in (-2.0, 1.8):
        K.box_bm(bm, (x, rq.choice((-0.6, 0.6)), 0.12), (0.4, 0.3, 0.25), rot_z=rq.uniform(-1, 1), taper=(0.8, 0.8))
    K.part(bm, 'granite', name='stones', jitter=0.12)
    K.decal('lichen', (-1.4, -0.31, 1.0), (0, -1, 0), 0.9, 0.9, alpha=0.5)
    K.decal('moss_patch', (1.6, 0.31, 0.35), (0, 1, 0), 1.2, 0.5, alpha=0.6)
    K.footprint(N.rect(-L / 2, -0.5, L / 2, 0.5), 'HIGH', 'wall')

if VAR in ('ruinb', 'ruinc'):
    L, W = (8.0, 6.0) if VAR == 'ruinb' else (9.0, 5.0)
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    T = 0.6
    bm = K.bm_new()
    foundation(bm, x0, x1, y0, y1)
    hb = ragged(SEED * 13 + 3, 1.2, 2.5, L, 6)                             # the back (N) wall stands highest
    ragged_wall(bm, x0, x1, y1 - T / 2, T, lambda x: hb(x - x0), gaps=[(x0 + 2.0, x0 + 2.9, 1.0)] + ([(x1 - 3.0, x1 - 2.1, 1.0)] if VAR == 'ruinc' else []))
    hw = ragged(SEED * 13 + 5, 0.9, 2.4, W, 4)
    wall_y(bm, y0, y1 - T, x0 + T / 2, T, lambda y: hw(W - T - y) if VAR == 'ruinb' else min(2.5, 0.8 + 1.8 * (y / W)))
    if VAR == 'ruinc':                                                     # E wall with a doorway; gable stub
        he = ragged(SEED * 13 + 9, 1.0, 2.2, W, 4)
        y = y0
        while y < y1 - T - 1e-3:
            w = min(0.3, y1 - T - y); ym = y + w / 2
            if not (-0.55 < ym < 0.55):
                K.box_bm(bm, (x1 - T / 2, ym, he(ym - y0) / 2), (T, w + 0.02, he(ym - y0)))
            y += w
        hf2 = ragged(SEED * 13 + 11, 0.4, 1.4, L, 5)                       # front wall broken low
        ragged_wall(bm, x0 + 1.0, x1 - 1.5, y0 + T / 2, T, lambda x: hf2(x - x0))
    K.part(bm, 'fieldstone_grey', name='walls', grime=0.8, mat_tint=(0.8, 0.79, 0.77))
    bm = K.bm_new()
    stones_on(bm, x0, x1, y1 - T + 0.1, y1 - 0.1, lambda x: hb(x - x0), 14)
    for (xa, xb) in ((x0 + 2.0, x0 + 2.9),) + (((x1 - 3.0, x1 - 2.1),) if VAR == 'ruinc' else ()):
        K.box_bm(bm, ((xa + xb) / 2, y1 - T / 2, 1.03), (xb - xa + 0.2, T + 0.06, 0.08))   # window sills
    if VAR == 'ruinc':
        K.box_bm(bm, (x1 - T / 2, 0, 0.06), (T + 0.1, 1.1, 0.12))                # door threshold slab
    K.part(bm, 'granite', name='stones', jitter=0.12)
    bm = K.bm_new()                                                        # chimney stub (corner hearth)
    cx, cy = (x0 + 1.4, y1 - 1.2) if VAR == 'ruinb' else (x1 - 1.5, y1 - 1.1)
    K.box_bm(bm, (cx, cy, 1.2), (1.1, 0.9, 2.4))
    K.box_bm(bm, (cx, cy - 0.46, 0.45), (0.7, 0.05, 0.6))
    K.part(bm, 'fieldstone_grey', name='chimney', grime=1.0, mat_tint=(0.62, 0.6, 0.58))
    K.decal('soot', (cx, cy - 0.47, 1.4), (0, -1, 0), 0.9, 1.4, alpha=0.7)
    heaps = [(x0 + L * 0.55, y0 + W * 0.45, 1.6, 0.7), (x1 - 1.4, y0 + 1.2, 1.0, 0.45)]
    beams = [((x0 + 1.0, y1 - 1.0, 1.4), (x0 + 3.8, y0 + 1.6, 0.2)), ((x1 - 2.5, y1 - 0.8, 0.9), (x1 - 0.8, y0 + 1.5, 0.15))]
    ruin_dress(x0, x1, y0, y1, heaps, beams)
    K.footprint(N.rect(x0, y0, x1, y1), 'HIGH', 'building')

# ------------------------------------------------------------------------------------------------ henhouse
FALU = (0.55, 0.16, 0.11)
if VAR == 'hen':
    x0, x1, y0, y1, ZF = -1.5, 0.45, -0.9, 0.9, 0.4
    poly = N.rect(x0, y0, x1, y1)
    bm = K.bm_new()
    for (cx, cy) in ((x0 + 0.15, y0 + 0.15), (x1 - 0.15, y0 + 0.15), (x1 - 0.15, y1 - 0.15), (x0 + 0.15, y1 - 0.15)):
        K.box_bm(bm, (cx, cy, 0.17), (0.34, 0.32, 0.42), rot_z=rq.uniform(-0.3, 0.3), taper=(0.8, 0.8))
    K.part(bm, 'granite', name='pads', jitter=0.1)
    bm = K.bm_new()
    K.box_bm(bm, ((x0 + x1) / 2, 0, ZF - 0.06), (x1 - x0, y1 - y0, 0.1))
    for yy in (y0 + 0.12, y1 - 0.12):
        K.box_bm(bm, ((x0 + x1) / 2, yy, ZF - 0.17), (x1 - x0, 0.1, 0.12))
    K.part(bm, 'deck_planks', name='floor', uv='beam', axis=(1, 0, 0), mat_tint=(0.6, 0.55, 0.5))
    pop = K.opening(poly, 0, 1.45, 0.28, 0.34, ZF, 0.06, 'rect', 'door')
    win = K.opening(poly, 0, 0.55, 0.45, 0.32, ZF + 0.75, 0.06)
    dr = K.opening(poly, 3, 0.9, 0.62, 1.25, ZF, 0.06, 'rect', 'door')
    N.board_walls(poly, ZF, 1.25, 0.06, [pop, win, dr], cladding='vert', tint=FALU, name='walls')
    K.window(win, 'fixed', (2, 1), frame=(0.85, 0.84, 0.8), recess=0.03, sill=None, curtain=0, streak=False, name='win')
    K.door(dr, 'gable', 'plank', FALU, step=None)
    N.corner_boards(poly, ZF, ZF + 1.25, w=0.1, name='corners')
    R = K.roof_shed(x0 - 0.1, y0 - 0.25, x1 + 0.1, y1 + 0.15, ZF + 1.25, ZF + 1.6, 'tar_paper_batten', low_side='-y', name='roof',
                    gutters=False)
    C.A.meta['roofs'].pop()
    N.ROOFS[-1].snow_lip = 0.05                        # fix round: a short cornice, not a hanging tongue over the pop-hole
    bm = K.bm_new()                                    # back gable triangles closing the shed roof
    for x in (x0, x1):
        K.hexa_bm(bm, [V((x - 0.03, y0, ZF + 1.25)), V((x + 0.03, y0, ZF + 1.25)), V((x + 0.03, y1, ZF + 1.25)), V((x - 0.03, y1, ZF + 1.25)),
                       V((x - 0.03, y0, ZF + 1.25)), V((x + 0.03, y0, ZF + 1.25)), V((x + 0.03, y1, ZF + 1.55)), V((x - 0.03, y1, ZF + 1.55))])
    K.box_bm(bm, (-0.5, y1 + 0.2, ZF + 0.45), (1.1, 0.4, 0.5))           # nest box on the back wall
    K.part(bm, 'weatherboard_paint', name='nestbox', mat_tint=FALU, grime=0.6)
    K.P('tar_paper', K.beam_bm, (-0.5, y1 + 0.02, ZF + 0.78), (-0.5, y1 + 0.47, ZF + 0.66), 1.2, 0.04, name='nest_lid')
    bm = K.bm_new()                                    # pop-hole ramp with cleats
    K.beam_bm(bm, (x0 + 1.45, y0 - 0.02, ZF - 0.02), (x0 + 1.45, y0 - 0.95, 0.02), 0.3, 0.025)
    for k in range(5):
        t = (k + 0.5) / 5
        K.box_bm(bm, (x0 + 1.45, y0 - 0.02 - 0.93 * t, ZF - 0.02 - (ZF - 0.04) * t + 0.02), (0.3, 0.025, 0.02))
    K.part(bm, 'boards_weathered', name='ramp', uv='beam', axis=(0, 1, 0))
    bm = K.bm_new()                                    # the run: posts and rails
    for (px, py) in ((x1 + 1.0, y0 + 0.05), (x1 + 1.0, y1 - 0.05), (x1 + 0.5, y0 + 0.05), (x1 + 0.5, y1 - 0.05)):
        K.box_bm(bm, (px, py, 0.65), (0.07, 0.07, 1.3))
    for z in (0.08, 1.27):
        K.box_bm(bm, (x1 + 0.52, y0 + 0.05, z), (1.05, 0.05, 0.05)); K.box_bm(bm, (x1 + 0.52, y1 - 0.05, z), (1.05, 0.05, 0.05))
        K.box_bm(bm, (x1 + 1.0, 0, z), (0.05, y1 - y0 - 0.1, 0.05))
    K.part(bm, 'timber_grey', name='run_posts', uv='beam', axis=(0, 0, 1))
    bm = K.bm_new()
    K.box_bm(bm, (x1 + 0.52, y0 + 0.05, 0.67), (1.0, 0.01, 1.18)); K.box_bm(bm, (x1 + 0.52, y1 - 0.05, 0.67), (1.0, 0.01, 1.18))
    K.box_bm(bm, (x1 + 1.0, 0, 0.67), (0.01, y1 - y0 - 0.1, 1.18)); K.box_bm(bm, (x1 + 0.52, 0, 1.3), (1.0, y1 - y0 - 0.1, 0.01))
    K.part(bm, 'mesh_screen', name='run_netting', lod='drop')
    K.P('hessian', K.box_bm, (x1 + 0.75, 0.3, 0.12), (0.4, 0.3, 0.24), 0.3, name='feed_sack', mat_tint=(0.85, 0.78, 0.62))
    K.footprint(N.rect(x0, y0, x1 + 1.05, y1), 'HIGH', 'hut')

if VAR == 'hend':                                      # smashed coop: boards splayed, roof sheet on the ground
    bm = K.bm_new()
    for k in range(26):
        x, y = rq.uniform(-1.4, 1.3), rq.uniform(-0.9, 0.9)
        a = rq.uniform(0, 3.1)
        L = rq.uniform(0.6, 1.3)
        K.beam_bm(bm, (x, y, 0.05 + rq.uniform(0, 0.4)), (x + math.cos(a) * L, y + math.sin(a) * L, 0.04), 0.1, 0.025)
    K.part(bm, 'weatherboard_paint', name='boards', uv='beam', axis=(1, 0, 0), mat_tint=FALU, grime=1.0)
    bm = K.bm_new()
    ragged_wall(bm, -1.5, 0.4, 0.85, 0.06, ragged(SEED, 0.3, 1.1, 1.9, 4), step=0.12)
    wall_y(bm, -0.9, 0.85, -1.47, 0.06, ragged(SEED + 1, 0.2, 0.9, 1.75, 3), step=0.12)
    K.part(bm, 'weatherboard_paint', name='stumps', mat_tint=FALU, grime=1.0)
    K.P('tar_paper_batten', K.hexa_bm, [V((-1.4, -0.9, 0.05)), V((0.4, -1.1, 0.05)), V((0.6, 0.6, 0.6)), V((-1.2, 0.8, 0.7)),
                                         V((-1.4, -0.9, 0.1)), V((0.4, -1.1, 0.1)), V((0.6, 0.6, 0.65)), V((-1.2, 0.8, 0.75))], name='roof_down')
    eu_dmg.heap(V((-0.4, 0, 0)), 1.0, 0.35, stone='fieldstone_grey', dress=None, tiles=None, seed=SEED, name='debris', footprint=False,
                n=8, beams=2, planks=4, slabs=0)
    K.footprint(N.rect(-1.5, -0.9, 1.5, 0.9), 'LOW', 'hut')

# ------------------------------------------------------------------------------------------------ jail guardhouse
if VAR in ('jail', 'jaild'):
    L, W, D, Z0, ZE, PITCH = 5.0, 4.0, 0.24, 0.3, 2.45, 27
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    poly = N.rect(x0, y0, x1, y1)
    zr = ZE + (W / 2) * math.tan(math.radians(PITCH)) + 0.1
    door = K.opening(poly, 1, W / 2, 0.9, 1.85, Z0 + 0.1, D, 'rect', 'door')
    wins = [K.opening(poly, 0, 1.4, 0.6, 0.5, Z0 + 1.2, D), K.opening(poly, 0, 3.6, 0.6, 0.5, Z0 + 1.2, D),
            K.opening(poly, 2, 2.5, 0.6, 0.5, Z0 + 1.2, D), K.opening(poly, 3, 2.0, 0.5, 0.45, Z0 + 1.3, D)]
    N.log_walls(x0, y0, x1, y1, Z0, ZE - Z0, D, 'timber_tarred', [door] + wins, ext=0.28, gable_x=(ZE, zr), tint=(0.5, 0.42, 0.36))
    for k, f in enumerate(wins):
        K.window(f, 'fixed', (2, 2), frame=(0.3, 0.28, 0.26), recess=0.1, sill=None, curtain=0, bars=True, streak=False, name='w%d' % k)
    K.door(door, 'front', 'plank', (0.32, 0.3, 0.26), step='granite')
    bm = K.bm_new()                                    # iron strap hinges + lock plate on the cell door
    fx = x1 + D / 2 + 0.03
    for z in (Z0 + 0.45, Z0 + 1.5):
        K.box_bm(bm, (fx, -0.1, z), (0.02, 0.7, 0.07))
    K.box_bm(bm, (fx, 0.3, Z0 + 1.0), (0.02, 0.14, 0.22))
    K.part(bm, 'cast_iron', name='straps', mat_tint=(0.2, 0.2, 0.2), lod='drop')
    K.sign((x1 + D / 2 + 0.03, -1.2, Z0 + 1.5), (1, 0, 0), 0.6, 'wache', board='timber_grey')
    bm = K.bm_new()                                    # gooseneck lamp over the door
    K.beam_bm(bm, (x1 + 0.15, 0, ZE - 0.1), (x1 + 0.55, 0, ZE - 0.05), 0.03, 0.03)
    K.cyl_bm(bm, (x1 + 0.55, 0, ZE - 0.05), (x1 + 0.55, 0, ZE - 0.25), 0.03, 6, r1=0.16)
    K.part(bm, 'cast_iron', name='lamp', mat_tint=(0.25, 0.27, 0.24), lod='keep')
    K.anchor('light', (x1 + 0.55, 0, ZE - 0.3), (1, 0, 0), kind='light')
    bm = K.bm_new()
    for (cx, cy) in ((x0 + 0.1, y0 + 0.1), (x1 - 0.1, y0 + 0.1), (x1 - 0.1, y1 - 0.1), (x0 + 0.1, y1 - 0.1), (0, y0 + 0.1), (0, y1 - 0.1)):
        K.box_bm(bm, (cx, cy, 0.1), (0.6, 0.58, 0.5), rot_z=rq.uniform(-0.2, 0.2), taper=(0.85, 0.8))
    K.part(bm, 'granite', name='corner_stones', jitter=0.1)
    K.wall_ring(C.poly_offset(poly, -0.04), Z0 + 0.02, 0.3, 'fieldstone_grey', [door], z0=-0.05, name='fill', footprint=False)
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'tar_paper', eave_oh=0.35, gable_oh=0.3, thick=0.08, gutters=False)
    N.roof_battens(R, spacing=0.85)
    N.stovepipe(x0 + 1.0, 0.7, ZE - 0.3, zr + 0.7)
    bm = K.bm_new()                                    # firewood under the W eave, a bench by the door
    for k in range(18):
        zz = 0.1 + (k // 6) * 0.15
        K.cyl_bm(bm, (x0 - 0.3, -1.2 + (k % 6) * 0.2, zz), (x0 - 0.75, -1.2 + (k % 6) * 0.2, zz), rq.uniform(0.06, 0.08), 6)
    K.part(bm, 'timber_beam', name='woodpile', uv='beam', axis=(1, 0, 0), grime=0.3)
    bm = K.bm_new()
    K.box_bm(bm, (x1 + 0.4, 1.2, 0.45), (0.35, 1.2, 0.06))
    for sy in (-0.45, 0.45):
        K.box_bm(bm, (x1 + 0.4, 1.2 + sy, 0.21), (0.3, 0.08, 0.42))
    K.part(bm, 'timber_grey', name='bench')
    K.footprint(N.rect(x0 - 0.8, -1.35, x0, 0.0), 'LOW', 'woodpile')
    if VAR == 'jaild':
        K.bite((x1 - 0.5, -0.8, 1.8), 1.3, seed=SEED)
        K.bite((x0 + 1.2, y1, 2.6), 1.1, seed=SEED + 1)
        K.roof_holes(R, [(1.0, -0.8, 1.2), (-1.2, 0.9, 0.9)])
        K.rubble((x1 + 0.9, -0.6, 0), 1.3, 0.5, mids=('timber_tarred', 'fieldstone_grey'), n=20, beams=4, tiles='tar_paper', seed=SEED)
    K.anchor('roof_ridge', (0, 0, zr))

# ------------------------------------------------------------------------------------------------ finish
if DEST:
    N.char(0.55 if VAR == 'archd' else 0.75, seed=SEED)
if SNOW or DEST:
    if VAR in ('hen', 'jail'):                         # fix round: few bare patches (a bare verge under the blanket read as a void)
        import nfx2
        nfx2.PATCHY = 0.12
        if VAR == 'jail':
            nfx2.SLIDE = 0.0                           # whole eave cornice: a bare band by the verge read as a cavity
    N.snow()
    if VAR == 'hen':                                   # fix round: no cornice curtain hanging below the low eave (z 1.6)
        import bpy
        for ob in [o for o in bpy.data.objects if o.name.startswith('snowbl')]:
            mw, mi = ob.matrix_world, ob.matrix_world.inverted()
            for v in ob.data.vertices:
                p = mw @ v.co
                if p.z < 1.53:
                    p.z = 1.53
                    v.co = mi @ p
K.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48, recenter=False)
print('finalized', NAME)
