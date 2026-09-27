"""Village / town cemetery (M15 Compiegne, and generic France/Belgium): enclosure wall with coping, gate piers with
ball finials and wrought-iron double gate (interactable), gravel cross paths, rows of varied graves (granite ledger
tombs with steles, limestone headstones, cast-iron crosses, kerbed plots, a few railed plots), two family chapels
(mausoleums) and a central calvary cross.
 a = 2.0 m rubble wall all round      b = low wall + iron railings on the street sides (M15 look), back wall full height
usage: blender -b --python cemetery.py -- outdir variant seed"""
import sys, os, math, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, pick, finish, iron_fence
import random


def cheap_rail(p0, p1, z, h=1.3, sp=0.2, name='rail'):
    """Budget cast-iron railing: triangular bars without caps (6 tris) + 3-sided spear tips, 2 flat rails."""
    a, b = V((p0[0], p0[1], z)), V((p1[0], p1[1], z))
    d = (b - a).normalized(); nn = V((d.y, -d.x, 0))
    bm = K.bm_new()
    for zz in (0.12, h - 0.12):
        K.beam_bm(bm, a + V((0, 0, zz)), b + V((0, 0, zz)), 0.02, 0.05)
    n = max(1, int((b - a).length / sp))
    for k in range(n + 1):
        p = a + (b - a) * (k / n)
        K.cyl_bm(bm, p, p + V((0, 0, h)), 0.014, 3, caps=False)
        K.cyl_bm(bm, p + V((0, 0, h)), p + V((0, 0, h + 0.1)), 0.028, 3, r1=0.0, caps=False)
    return K.part(bm, 'cast_iron', name=name, grime=0.15)


OUT, VAR, SEED = args('cemetery_a')
K.begin('cemetery_' + VAR, SEED, theater='temperate')
r = K.rng()
L, W, T = 32.0, 22.0, 0.5
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
low = VAR == 'b'
WH = 0.8 if low else 2.0
GW = 3.0
gate = K.opening(poly, 0, L / 2, GW, 3.5, 0.0, T, 'rect', 'door')
K.wall_ring(poly, WH, T, 'fieldstone' if not low else 'ashlar', [gate], name='enclosure', footprint=False)
bm = bmesh.new()                                   # coping
K.ring_bm(bm, K.poly_offset(poly, 0.07), K.poly_offset(poly, -T - 0.07), WH, WH + 0.12)
bm = K.boolean_cut(bm, [gate])
K.part(bm, 'ashlar_limestone', name='coping')['eu_lod'] = 'all'
if low:                                            # back (north) wall full height
    K.P('fieldstone', K.box_bm, (0, y1 - T / 2, 1.0), (L, T, 2.0), name='back_wall')
    K.P('ashlar_limestone', K.box_bm, (0, y1 - T / 2, 2.06), (L + 0.1, T + 0.14, 0.12), name='back_coping')
    for (a, b) in (((x0 + 0.25, y0 + 0.25), (-GW / 2 - 0.4, y0 + 0.25)), ((GW / 2 + 0.4, y0 + 0.25), (x1 - 0.25, y0 + 0.25)),
                   ((x0 + 0.25, y0 + 0.3), (x0 + 0.25, y1 - 0.6)), ((x1 - 0.25, y0 + 0.3), (x1 - 0.25, y1 - 0.6))):
        cheap_rail(a, b, WH + 0.12, 1.3, 0.3, name='rail')
    for x in [x0 + 0.25 + k * 4.0 for k in range(9)]:   # railing posts / small piers
        if abs(x) > GW / 2 + 0.6:
            K.P('ashlar_limestone', K.box_bm, (x, y0 + 0.25, WH + 0.6), (0.4, 0.4, 1.2), name='rpier')
# wall footprints (the interior stays walkable)
K.footprint_rect((x0 - GW / 2 - 0.4) / 2, y0 + T / 2, (-GW / 2 - 0.4) - x0, T, block='HIGH', kind='wall')
K.footprint_rect((x1 + GW / 2 + 0.4) / 2, y0 + T / 2, x1 - (GW / 2 + 0.4), T, block='HIGH', kind='wall')
K.footprint_rect(0, y1 - T / 2, L, T, block='HIGH', kind='wall')
K.footprint_rect(x0 + T / 2, 0, T, W, block='HIGH', kind='wall')
K.footprint_rect(x1 - T / 2, 0, T, W, block='HIGH', kind='wall')
if not low:
    for (a, b) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        K.climb_meta(a, b, WH + 0.12)

# gate piers + finials
for sx in (-1, 1):
    px = sx * (GW / 2 + 0.4)
    K.P('ashlar_limestone', K.box_bm, (px, y0 + T / 2, 1.35), (0.8, 0.8, 2.7), name='gpier')
    K.P('ashlar_limestone', K.box_bm, (px, y0 + T / 2, 2.78), (0.95, 0.95, 0.16), name='gcap')
    K.P('ashlar_limestone', K.cyl_bm, (px, y0 + T / 2, 2.86), (px, y0 + T / 2, 3.35), 0.22, 10, r1=0.05, name='gfinial', smooth=True)
# wrought-iron double gate: two leaves as separate hinged nodes
for s in (-1, 1):
    hp = V((s * GW / 2, y0 + T / 2, 0.05))
    bm = bmesh.new()
    lw = GW / 2 - 0.03
    d = V((-s, 0, 0))
    for z in (0.12, 1.0, 1.9):
        K.beam_bm(bm, hp + V((0, 0, z)), hp + d * lw + V((0, 0, z)), 0.04, 0.03)
    n = int(lw / 0.13)
    for k in range(n + 1):
        p = hp + d * (0.03 + k * (lw - 0.06) / n)
        top = 2.05 + 0.25 * math.sin(math.pi * (k / n if s < 0 else 1 - k / n) * 0.5)
        K.beam_bm(bm, p + V((0, 0, 0.08)), p + V((0, 0, top)), 0.022, 0.022)
        K.cyl_bm(bm, p + V((0, 0, top)), p + V((0, 0, top + 0.12)), 0.03, 4, r1=0.0)
    K.beam_bm(bm, hp, hp + d * lw + V((0, 0, 1.9)), 0.03, 0.02, up=V((0, 1, 0)))
    ob = K.part(bm, 'cast_iron', name='gate_leaf%d' % s, node='gate%d' % s, grime=0.2)
    ob['kit_pivot'] = list(hp)
K.door_meta('gate', (0, y0, 0), (0, -1, 0), GW, 2.2, kind='gate', node='gate-1')


# ---- gravel paths with limestone kerbs and a worn centre track -------------------------------------------------------
PT = (0.97, 0.97, 0.98)                               # grey limestone gravel (lib gravel_grey, PH 'gravel' graded neutral)
K.P('gravel_grey', K.box_bm, (0, 0, 0.025), (2.4, W - 2 * T, 0.05), name='path_ns', grime=0.2, tint=PT, uv_scale=0.6)
K.P('gravel_grey', K.box_bm, (0, 1.0, 0.026), (L - 2 * T, 2.0, 0.05), name='path_ew', grime=0.2, tint=PT, uv_scale=0.6)
bm = K.bm_new()
for sx in (-1, 1):
    for ya, yb in ((y0 + T, 1.0 - 1.0), (1.0 + 1.0, y1 - T)):
        K.box_bm(bm, (sx * 1.25, (ya + yb) / 2, 0.05), (0.1, yb - ya, 0.1))
    for xa_, xb_ in ((x0 + T, -1.2), (1.2, x1 - T)):
        K.box_bm(bm, ((xa_ + xb_) / 2, 1.0 + sx * 1.05, 0.05), (xb_ - xa_, 0.1, 0.1))
K.part(bm, 'limestone_smooth', name='path_kerbs', grime=0.8)
K.P('gravel_grey', K.box_bm, (0, -2.5, 0.052), (0.8, W - 2 * T - 5.5, 0.004), name='path_wear', grime=0.3, tint=(0.8, 0.8, 0.8), bisect=False, uv_scale=0.8)
K.footprint_rect(0, 0, 2.4, W - 2 * T, block='NONE', kind='path')

# ---- graves: polished granite / limestone monuments with engraved steles (atlas), kerbs, wreaths, bead crowns ----------
rq = random.Random(SEED * 5 + 1)
GM = {'granite_polished': K.bm_new(), 'limestone_smooth': K.bm_new()}
GT = {'granite_polished': [(0.9, 0.86, 0.88), (1.1, 1.05, 1.05), (0.7, 0.72, 0.78)], 'limestone_smooth': [(1, 1, 1), (0.9, 0.88, 0.84)]}
FACE, IRON, GRAV, SOD = K.bm_new(), K.bm_new(), K.bm_new(), K.bm_new()
WRE, BEAD, POT = K.bm_new(), K.bm_new(), K.bm_new()
uvl = FACE.loops.layers.uv.new('UVMap')
CELLS = {'granite_polished': (0, 1), 'limestone_smooth': (2, 3)}
PXR = []                                             # LOD1/LOD2 proxy boxes: (mat, centre, size)


def cell_rect(k):
    col, row = k % 2, k // 2
    u0, v1 = col * 0.5, 1 - row * 0.5
    return u0 + 0.01, v1 - 0.49, u0 + 0.49, v1 - 0.01


def stele(mat, x, y, w, h, t=0.14, top='round', lean=0.0):
    """Stele with a shaped top; front face (-y) gets an atlas cell (inscription / plaque / cross), rest = stone."""
    if top == 'round':
        prof = [(-w / 2, 0), (w / 2, 0), (w / 2, h - w / 2)] + [(w / 2 * math.cos(a), h - w / 2 + w / 2 * math.sin(a))
                                                                 for a in [math.pi * i / 6 for i in range(1, 6)]] + [(-w / 2, h - w / 2)]
    elif top == 'point':
        prof = [(-w / 2, 0), (w / 2, 0), (w / 2, h - w * 0.4), (0, h), (-w / 2, h - w * 0.4)]
    else:
        prof = [(-w / 2, 0), (w / 2, 0), (w / 2, h), (-w / 2, h)]
    M = __import__('mathutils').Matrix.Rotation(lean, 3, 'X')
    P = lambda u, z, d: V((x, y, 0)) + M @ V((u, d, z))
    PXR.append((mat, (x, y, h * 0.46), (w, t, h * 0.92)))
    front = [P(u, z, -t / 2) for u, z in prof]
    back = [P(u, z, t / 2) for u, z in prof]
    bm = GM[mat]
    vf = [bm.verts.new(p) for p in front]; vb = [bm.verts.new(p) for p in back]
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vf[i], vb[i], vb[j], vf[j]))
    bm.faces.new(list(reversed(vb)))
    f = FACE.faces.new([FACE.verts.new(p - V((0, 0.003, 0))) for p in front])
    u0, v0, u1, v1 = cell_rect(rq.choice(CELLS[mat]))
    for l in f.loops:
        q = M.inverted() @ (l.vert.co - V((x, y, 0)))
        l[uvl].uv = (u0 + (q.x / w + 0.5) * (u1 - u0), v0 + max(0.0, min(1.0, q.z / h)) * (v1 - v0))


def slab(bm, cx, cy, w, d, z0, z1, ch=0.05, rot=0.0):
    """Chamfered slab (ledger / plinth / step)."""
    import mathutils
    R = mathutils.Matrix.Rotation(rot, 3, 'Z')
    q = lambda sx, sy, z, k: V((cx, cy, 0)) + R @ V((sx * (w / 2 - k), sy * (d / 2 - k), z))
    pts = [q(sx, sy, z0, 0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] + \
          [q(sx, sy, z1, ch) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    K.hexa_bm(bm, pts)


def torus(bm, c, n, R_=0.24, r_=0.05, seg=12, mseg=3, beads=True):
    """Wreath / bead crown (couronne de perles) ring standing in plane with normal n: 12 segments, the tube swells
    and pinches every other ring so the wire-strung beads read; an inner beaded rosette on the crowns."""
    c, n = V(c), V(n).normalized()
    a = n.orthogonal().normalized(); b = n.cross(a)
    rings = []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        d = a * math.cos(t) + b * math.sin(t)
        rr_ = r_ * (1.25 if (beads and i % 2 == 0) else 0.8)
        rings.append([c + d * (R_ + rr_ * math.cos(2 * math.pi * k / mseg + 0.785)) + n * (rr_ * math.sin(2 * math.pi * k / mseg + 0.785)) for k in range(mseg)])
    rings.append(rings[0])
    K.loft_bm(bm, rings, closed=True, close_start=False, close_end=False)


CHAPEL_MID = (x0 + 9.2, y0 + 1.9 + 2 * 2.6)
rows_y = [y0 + 1.9 + k * 2.6 for k in range(8)]
cnt = 0
for yy in rows_y:
    if abs(yy - 1.0) < 1.6 or yy > y1 - 1.6:
        continue
    for xx in [x0 + 1.4 + k * 1.45 for k in range(22)]:
        if abs(xx) < 1.9 or xx > x1 - 1.0 or rq.random() < (0.5 if VAR == 'b' else 0.22):
            continue
        if (abs(xx - (x0 + 4.5)) < 2.2 or abs(xx - (x1 - 4.5)) < 2.2) and yy > 5:
            continue                                    # back chapels
        if abs(xx - CHAPEL_MID[0]) < 1.9 and abs(yy - CHAPEL_MID[1]) < 1.8:
            continue                                    # family chapel among the graves
        hy = yy + 0.95
        kind = rq.random()
        mat = 'granite_polished' if kind < 0.45 or rq.random() < 0.3 else 'limestone_smooth'
        lean = rq.uniform(-0.05, 0.03) if mat == 'limestone_smooth' else rq.uniform(-0.01, 0.01)
        if kind < 0.4:                                  # granite ledger tomb: plinth + chamfered polished slab + stele
            w_ = rq.uniform(0.9, 1.05)
            slab(GM[mat], xx, yy, w_ + 0.1, 2.15, 0.0, 0.18, 0.02)
            slab(GM[mat], xx, yy - 0.05, w_, 1.95, 0.18, 0.34, 0.05)
            PXR.append((mat, (xx, yy, 0.17), (w_ + 0.1, 2.1, 0.34)))
            stele(mat, xx, hy - 0.02, w_ * rq.uniform(0.7, 0.9), rq.uniform(0.75, 1.3), 0.15, rq.choice(('round', 'point', 'flat')), lean)
            if rq.random() < 0.35:
                torus(BEAD if rq.random() < 0.5 else WRE, (xx, yy - 0.2, 0.37), (0, 0, 1), 0.26, 0.05)
            elif rq.random() < 0.4:
                K.cyl_bm(POT, (xx + 0.25, yy - 0.7, 0.34), (xx + 0.25, yy - 0.7, 0.58), 0.09, 6, r1=0.12)
        elif kind < 0.68:                               # headstone in a kerbed plot with gravel infill
            h_ = rq.uniform(0.7, 1.6)
            stele(mat, xx, hy, rq.uniform(0.55, 0.8), h_, 0.12, rq.choice(('round', 'round', 'point', 'flat')), lean)
            for (cx_, cy_, sx_, sy_) in ((xx - 0.42, yy, 0.1, 1.8), (xx + 0.42, yy, 0.1, 1.8), (xx, yy - 0.9, 0.94, 0.1)):
                slab(GM['limestone_smooth'], cx_, cy_, sx_, sy_, 0.0, 0.16, 0.015)
            K.box_bm(GRAV, (xx, yy, 0.06), (0.74, 1.7, 0.12))
            if rq.random() < 0.4:
                torus(WRE, (xx, hy - 0.12, 0.35), (0, -1, 0.35), 0.22, 0.045)
        elif kind < 0.85:                               # limestone cross on a stepped, chamfered base
            slab(GM['limestone_smooth'], xx, hy - 0.1, 0.75, 0.55, 0.0, 0.22, 0.03)
            slab(GM['limestone_smooth'], xx, hy - 0.1, 0.48, 0.36, 0.22, 0.4, 0.03)
            K.box_bm(GM['limestone_smooth'], (xx, hy - 0.1, 1.0), (0.13, 0.13, 1.2))
            K.box_bm(GM['limestone_smooth'], (xx, hy - 0.1, 1.28), (0.56, 0.13, 0.13))
            PXR.append(('limestone_smooth', (xx, hy - 0.1, 0.8), (0.3, 0.3, 1.6)))
            K.box_bm(SOD, (xx, yy - 0.2, 0.05), (0.7, 1.5, 0.12))
        else:                                           # cast-iron cross on a turf mound (+ railed plot)
            K.cyl_bm(IRON, (xx, hy, 0), (xx, hy, 1.25), 0.03, 4)
            K.beam_bm(IRON, (xx - 0.3, hy, 0.95), (xx + 0.3, hy, 0.95), 0.04, 0.03)
            K.box_bm(SOD, (xx, yy, 0.07), (0.8, 1.8, 0.14), taper=(0.8, 0.9))
            if rq.random() < 0.35:
                torus(BEAD, (xx, hy - 0.05, 0.75), (0, -1, 0), 0.2, 0.04)
        K.footprint_rect(xx, yy, 1.0, 2.1, block='LOW', kind='grave')
        cnt += 1
for mat, bm in GM.items():
    K.part(bm, mat, name='graves_' + mat, jitter=0.15, grime=0.8)['eu_lod'] = 'only0'
K.part(FACE, 'stele_face', name='stele_faces', uv='keep', grime=0.5, bisect=False)['eu_lod'] = 'only0'
for mat in GM:                                       # LOD1/2: one clean box per monument part (no collapsed shards)
    bm = K.bm_new()
    for m_, c_, s_ in PXR:
        if m_ == mat:
            K.box_bm(bm, c_, s_)
    if bm.verts:
        K.part(bm, mat, name='graves_px_' + mat, jitter=0.15, grime=0.8)['eu_lod'] = 'only12'
K.part(IRON, 'cast_iron', name='iron_crosses', grime=0.1)['eu_lod'] = 'only0'
K.part(GRAV, 'gravel_grey', name='grave_gravel', tint=(0.95, 0.95, 0.96), grime=0.2, bisect=False)['eu_lod'] = 'all'
K.part(SOD, 'sod', name='grave_turf', grime=0.2, bisect=False)['eu_lod'] = 'all'
if WRE.verts:
    K.part(WRE, 'sod', name='wreaths', mat_tint=(0.45, 0.62, 0.38), grime=0.1, bisect=False, lod='drop')
if BEAD.verts:
    K.part(BEAD, 'wood_paint', name='bead_crowns', mat_tint=(0.42, 0.3, 0.5), grime=0.1, bisect=False, lod='drop')
if POT.verts:
    K.part(POT, 'roof_terracotta', name='flower_pots', grime=0.4, bisect=False, lod='drop')
C_LOG = cnt

# family chapels (mausoleums)
for k, (cx, cy, cw, cd, ch) in enumerate(((x0 + 4.5, y1 - T - 2.4, 2.6, 3.2, 3.2), (x1 - 4.5, y1 - T - 2.4, 2.6, 3.2, 3.2),
                                        (CHAPEL_MID[0], CHAPEL_MID[1], 1.9, 2.5, 2.7))):
    cp = [(cx - cw / 2, cy - cd / 2), (cx + cw / 2, cy - cd / 2), (cx + cw / 2, cy + cd / 2), (cx - cw / 2, cy + cd / 2)]
    dfr = K.opening(cp, 0, cw / 2, 1.0, 2.2, 0.3, 0.35, 'arch', 'door')
    CHS = 'ashlar_limestone' if k == 0 else 'ashlar'            # dressed stone (granite_wall read as brown planks, review 2)
    K.wall_ring(cp, ch, 0.35, CHS, [dfr], plinth=('limestone_smooth', 0.35, 0.06), name='chapel%d' % k)
    K.door(dfr, 'chapel%d' % k, 'glazed', (0.12, 0.13, 0.13), step='granite', lintel=None)
    Rc = K.roof_gable(cx, cy, cw + 0.3, cd + 0.3, ch, 32, 'roof_slate', rot=math.pi / 2, eave_oh=0.15, gable_oh=0.15, thick=0.15,
                      fascia=None, barge=None, gutters=False, sag=0.0, wobble=0.0, name='chroof%d' % k)
    K.gable(cp, 0, ch, Rc.z_ridge - Rc.lift, 0.35, CHS, name='chped%d' % k)
    K.gable(cp, 2, ch, Rc.z_ridge - Rc.lift, 0.35, CHS, name='chpedb%d' % k)
    K.cornice(cp, ch - 0.25, 'ashlar_limestone', steps=((0.06, 0.1), (0.12, 0.12)), name='chcorn%d' % k)
    K.P('ashlar_limestone', K.box_bm, (cx, cy - cd / 2 - 0.05, Rc.z_ridge + 0.4), (0.12, 0.12, 0.9), name='chx%d' % k)
    K.P('ashlar_limestone', K.box_bm, (cx, cy - cd / 2 - 0.05, Rc.z_ridge + 0.55), (0.5, 0.12, 0.12), name='chy%d' % k)
    K.decal('lichen', (cx - 0.6, cy - cd / 2 - 0.02, 1.6), (0, -1, 0), 0.9, 1.1, alpha=0.7)
    K.decal('streak_rain', (cx + 0.7, cy - cd / 2 - 0.02, 2.2), (0, -1, 0), 0.6, 1.5, alpha=0.7)
# calvary at the crossing: three chamfered limestone steps, moulded pedestal, granite shaft + cross with a cast corpus
bm = bmesh.new()
for i, s in enumerate((2.3, 1.7, 1.1)):
    slab(bm, 0, 1.0, s, s, i * 0.24, i * 0.24 + 0.24, 0.04)
slab(bm, 0, 1.0, 0.75, 0.75, 0.72, 0.9, 0.05)
K.box_bm(bm, (0, 1.0, 1.35), (0.55, 0.55, 0.9))
slab(bm, 0, 1.0, 0.7, 0.7, 1.8, 1.95, 0.06)
K.part(bm, 'limestone_smooth', name='calvary_base', grime=1.0)
bm = bmesh.new()
K.box_bm(bm, (0, 1.0, 3.35), (0.24, 0.24, 2.8))
K.box_bm(bm, (0, 1.0, 4.05), (1.4, 0.22, 0.22))
K.part(bm, 'granite_polished', name='calvary_cross')
bm = bmesh.new()
K.box_bm(bm, (0, 1.0 - 0.15, 3.75), (0.12, 0.08, 0.75))
K.beam_bm(bm, (-0.45, 1.0 - 0.15, 4.05), (0.45, 1.0 - 0.15, 4.05), 0.06, 0.06)
K.part(bm, 'cast_iron', name='calvary_corpus', mat_tint=(0.6, 0.55, 0.45))
K.footprint_rect(0, 1.0, 2.2, 2.2, block='LOW', kind='calvary')
K.anchor('van_stop', (0, y0 - 3.0, 0), (0, -1, 0), kind='vehicle')
# weathering
for i in range(10):
    side = pick(r, [(0, y0 - 0.01, (0, -1, 0)), (0, y1 - T - 0.01, (0, -1, 0))])
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), side[1], 0.35), side[2], r.uniform(1.0, 2.2), 0.6, alpha=0.7)
import kit_core as _C
for o in _C.A.parts:                                     # big low-poly rings / slabs: never decimated (LOD2 collapsed the coping
    if o.name.startswith(('enclosure', 'coping', 'path_', 'back_wall', 'back_coping')):   # ring into a yard-wide triangle)
        o['eu_lod'] = 'all'
K.log('graves', C_LOG)
finish(OUT)
