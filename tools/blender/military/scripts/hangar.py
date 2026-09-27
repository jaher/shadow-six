"""Luftwaffe field-airfield hangar (M10 El Agheila; also M6/B6 in grey): 30 m clear-span segmental-arch roof of
corrugated iron on riveted lattice arch ribs, corrugated walls on a concrete plinth with a clerestory band of steel
industrial windows, 6-leaf sliding doors on a top track (two slid open), gable infill with windows, ridge ventilator,
lean-to workshop/office on the east side, concrete apron with tie-down rings, drums, workbench, sand drifts.
Variants: desert (sand-yellow paint, M10), a (grey-green, temperate), destroyed (bombed: roof torn open, ribs
exposed, doors blown, burnt apron).
Usage: blender -b --factory-startup --python hangar.py -- [desert|a|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('desert', 71)
DES = VAR in ('desert', 'destroyed')
K.begin('hangar' + ('' if VAR == 'desert' else '_' + VAR), SEED, theater='desert' if DES else 'temperate')
r = K.rng()
DEAD = VAR == 'destroyed'
PAINT = (1.04, 1.0, 0.93) if DES else (0.8, 0.86, 0.78)         # canvas sand / RAL 7009-ish grey-green paint
SKIN = 'tent_canvas' if DES else 'corrugated_galv'        # desert: Luftwaffe tent hangar (Zelthalle) skin over steel arches
HW, HD = 15.0, 12.0                  # half width (x), half depth (y)
ZS, RISE = 6.0, 5.6                  # arch springing, rise
DW, DH = 26.0, 7.2                   # door opening


def arch(n=18):
    return K.arch_profile(0, 2 * HW, ZS, RISE, n)          # [(x, z)] from x=-HW to +HW


def xz_prism(bm, pts, y0, y1):
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((a[j], a[i], b[i], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ------------------------------------------------------------------ walls (ring with door + clerestory windows), plinth
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]
door = K.opening(poly, 0, HW, DW, DH, 0.0, 0.25, 'rect', 'door')
wins = []
for e in (1, 3):
    for k in range(5):
        t = 2.4 + k * 4.8
        if e == 1 and 6.0 < t < 18.0:
            continue                                   # lean-to covers the middle of the east wall
        wins.append(K.opening(poly, e, t, 3.0, 1.5, 4.1, 0.25))
for t in (5.0, 10.0, 20.0, 25.0):
    wins.append(K.opening(poly, 2, t, 2.4, 1.4, 3.8, 0.25))
bdoor = K.opening(poly, 2, 15.0, 1.2, 2.2, 0.0, 0.25, 'rect', 'door')
K.wall_ring(poly, ZS, 0.25, SKIN, wins + [door, bdoor], plinth=('concrete_bunker', 0.45, 0.06), name='walls', mat_tint=PAINT)
for f in wins:                                     # steel industrial windows: deep reveal, steel angle surround,
    K.window(f, 'fixed', (3, 2), frame=(0.3, 0.32, 0.3), recess=0.16, sill='steel_painted', lintel=None, surround=None,
             curtain=0.0, streak=True, name='win')
bm = bmesh.new()                                   # ... and a pressed-steel drip flashing over each opening
for f in wins:
    c = f.p(0, f.h + 0.12, 0.08)
    K.box_bm(bm, tuple(c), (f.w + 0.4, 0.16, 0.05), math.atan2(f.r.y, f.r.x))
    c2 = f.p(0, -0.06, 0.07)
    K.box_bm(bm, tuple(c2), (f.w + 0.3, 0.14, 0.04), math.atan2(f.r.y, f.r.x))
K.part(bm, 'steel_painted', name='win_flashing', mat_tint=(0.55, 0.57, 0.52), grime=0.6, bisect=False)
K.door(bdoor, 'back', 'plank', (0.35, 0.38, 0.34), step='concrete_bunker')
# gable infills above the springing line (front leaves the door head, back closed) + gable windows
ap = arch()
front = [(-HW, ZS), (-DW / 2, ZS), (-DW / 2, DH), (DW / 2, DH), (DW / 2, ZS), (HW, ZS)] + [p for p in reversed(ap)][1:-1]
bm = bmesh.new()
xz_prism(bm, front, -HD - 0.02, -HD + 0.23)
gf = K.part(bm, SKIN, name='gable_front', mat_tint=PAINT, uv='aligned')
bm = bmesh.new()
xz_prism(bm, [(-HW, ZS), (HW, ZS)] + [p for p in reversed(ap)][1:-1], HD - 0.23, HD + 0.02)
gb = K.part(bm, SKIN, name='gable_back', mat_tint=PAINT, uv='aligned')
gw = [K.Frame((x, -HD - 0.02, DH + 0.7), (0, -1, 0), (1, 0, 0), 2.2, 1.3, 0.25) for x in (-6.0, -2.0, 2.0, 6.0)]
for f in gw:
    K.cut_object(gf, M.cutter_box(f.o.x - 1.1, -HD - 1, f.o.z, f.o.x + 1.1, -HD + 1, f.o.z + 1.3))
    K.window(f, 'fixed', (3, 2), frame=(0.3, 0.32, 0.3), sill=None, lintel=None, curtain=0.0, streak=False, interior=True, name='gwin')
# door head beam + pilasters (steel box sections) framing the opening
bm = bmesh.new()
M.K.ibeam_bm(bm, (-HW, -HD - 0.3, DH + 0.3), (HW, -HD - 0.3, DH + 0.3), 0.6, 0.35, up=(0, 0, 1))   # top track
for s in (-1, 1):
    K.box_bm(bm, (s * (DW / 2 + 0.25), -HD - 0.1, DH / 2), (0.5, 0.45, DH + 0.2))
K.part(bm, 'steel_painted', name='door_track', mat_tint=PAINT, grime=0.7)

# ------------------------------------------------------------------ roof skin over the arch + ribs + ridge ventilator
OH = 0.5
Rr = (HW ** 2 + RISE ** 2) / (2 * RISE)
cz = ZS + RISE - Rr
RIBS = [-HD + 0.3, -8.0, -4.0, 0.0, 4.0, 8.0, HD - 0.3]
ys = [-HD - OH]
for ya, yb in zip(RIBS[:-1], RIBS[1:]):
    ys += [ya + (yb - ya) * k / 4 for k in range(4)]
ys += [RIBS[-1], HD + OH]
def sag(y):                                        # canvas sags between the arch ribs (sheets stay taut)
    if not DES:
        return 0.0
    for ya, yb in zip(RIBS[:-1], RIBS[1:]):
        if ya <= y <= yb:
            return 0.3 * math.sin(math.pi * (y - ya) / (yb - ya)) ** 1.3
    return 0.0
bm = bmesh.new()
for side, off in ((1, 0.1), (-1, 0.07)):           # outer skin + inner face (seen through the door opening)
    grid = []
    for y in ys:
        row = []
        for x, z in ap:
            n = V((x, 0, z - cz)).normalized()
            row.append(bm.verts.new(V((x, y, z)) + n * (off - sag(y) * (1 - abs(x) / HW * 0.3))))
        grid.append(row)
    for j in range(len(ys) - 1):
        for i in range(len(ap) - 1):
            q = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
            bm.faces.new(q if side > 0 else tuple(reversed(q)))
for f in bm.faces:
    f.normal_update()
roof = K.part(bm, SKIN, name='roof_skin', mat_tint=PAINT, uv='aligned', rot90=False, grime=0.6, smooth=DES, bisect=False)
if DES:                                            # rework 2: canvas UVs follow the cloths: u along the hall (seams parallel
    tc = K.MATS[SKIN]['tile_m']                    # to the ribs, 1 m cloths), v = arc length over the arch -> no stamped grid
    me = roof.data
    uvl = me.uv_layers[0]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.y / tc + 0.37, Rr * math.atan2(co.x, co.z - cz) / tc)
bm = bmesh.new()                                   # lattice arch ribs (top + bottom chord, N-web) on wall columns
apr = K.arch_profile(0, 2 * HW, ZS, RISE, 10)      # ribs: 10 lattice panels (hidden under the skin except at the doors)
for y in RIBS:
    top = [V((x, y, z)) for x, z in apr]
    bot = [p + (V((0, 0, cz)) - V((p.x, 0, p.z))).normalized() * 0.9 * V((1, 0, 1)) for p in top]
    bot = [V((p.x, y, p.z)) for p in bot]
    for i in range(len(top) - 1):
        K.beam_bm(bm, top[i], top[i + 1], 0.16, 0.16)
        K.beam_bm(bm, bot[i], bot[i + 1], 0.16, 0.16)
        if i % 2 == 0 or y in (RIBS[0], RIBS[-1]):
            K.beam_bm(bm, bot[i], top[i + 1], 0.07, 0.07)
    for s in (-1, 1):
        K.beam_bm(bm, (s * (HW - 0.35), y, 0.0), (s * (HW - 0.35), y, ZS), 0.3, 0.3)
for s in (-1, 1):                                  # purlins under the skin
    for k in (3, 6, 9):
        x, z = ap[k] if s < 0 else ap[-1 - k]
        K.beam_bm(bm, (x, -HD, z - 0.15), (x, HD, z - 0.15), 0.1, 0.18)
K.part(bm, 'steel_painted', name='ribs', mat_tint=(0.55, 0.57, 0.53), uv='beam', axis=(0, 0, 1), grime=0.5)
bm = bmesh.new()                                   # ridge ventilator with louvres
zt = ZS + RISE + 0.05
K.box_bm(bm, (0, 0, zt + 0.35), (1.6, 2 * HD - 3.0, 0.1))
K.box_bm(bm, (0, 0, zt + 0.75), (2.1, 2 * HD - 2.6, 0.08))
for s in (-1, 1):
    for k in range(3):
        K.beam_bm(bm, (s * 0.8, -HD + 1.6, zt + 0.42 + k * 0.1), (s * 0.8, HD - 1.6, zt + 0.42 + k * 0.1), 0.02, 0.1, roll=s * 0.6)
K.part(bm, SKIN, name='ventilator', mat_tint=PAINT, uv='aligned')

# ------------------------------------------------------------------ sliding door leaves (node door_main; two centre leaves slid open)
nl = 6
lw = DW / nl
FRM = 'timber_beam' if DES else 'steel_painted'
bm, bw, bf, bk = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()      # infill, glass, frame+bracing, wheels/hangers
def leaf(x0, yl):
    cx = x0 + lw / 2
    K.box_bm(bm, (cx, yl, DH / 2 + 0.05), (lw - 0.2, 0.04, DH - 0.2))
    fw = 0.14
    for zz in (0.12, DH * 0.62, DH - 0.1):                              # rails
        K.box_bm(bf, (cx, yl - 0.06, zz), (lw - 0.04, 0.1, fw if zz != DH * 0.62 else 0.1))
    for sx in (-1, 1):                                                   # stiles
        K.box_bm(bf, (cx + sx * (lw / 2 - 0.09), yl - 0.06, DH / 2), (fw, 0.1, DH - 0.1))
    for xa, xb in ((x0 + 0.15, cx - 0.1), (cx + 0.1, x0 + lw - 0.15)):   # Z-braces in the lower panels
        K.beam_bm(bf, (xa, yl - 0.07, 0.25), (xb, yl - 0.07, DH * 0.62 - 0.1), 0.1, 0.05, up=(0, -1, 0))
    if not DES:                                   # glazed band only on the steel hangar (no teal strip on canvas)
        K.box_bm(bw, (cx, yl - 0.035, DH * 0.8), (lw - 0.5, 0.02, 0.9))
    for sx in (-1, 1):                                                   # bottom rollers in the floor rail, top hangers
        K.cyl_bm(bk, (cx + sx * (lw / 2 - 0.45), yl - 0.03, 0.14), (cx + sx * (lw / 2 - 0.45), yl + 0.05, 0.14), 0.13, 7)
        K.box_bm(bk, (cx + sx * (lw / 2 - 0.45), yl - 0.02, DH + 0.18), (0.12, 0.08, 0.36))
        K.cyl_bm(bk, (cx + sx * (lw / 2 - 0.45), yl - 0.1, DH + 0.32), (cx + sx * (lw / 2 - 0.45), yl + 0.06, DH + 0.32), 0.09, 6)
for i in range(nl):
    x0 = -DW / 2 + i * lw
    yl = -HD - 0.35
    if i in (2, 3) and not DEAD:                   # rework 2: leaves CLOSED by default (door_meta slide opens them)
        yl -= 0.22
    if DEAD and i in (3, 4):
        continue
    leaf(x0, yl)
if DEAD:                                           # two leaves blown flat onto the apron
    for k, (cx, cy, a) in enumerate(((3.5, -HD - 5.0, 0.3), (8.4, -HD - 3.2, -0.25))):
        K.box_bm(bm, (cx, cy, 0.08 + k * 0.1), (lw, DH * 0.9, 0.06), a)
nodes = []
nodes.append(K.part(bm, SKIN, name='door_main_leaves', node='door_main', mat_tint=PAINT, uv='aligned', grime=0.8))
nodes.append(K.part(bf, FRM, name='door_main_frames', node='door_main', mat_tint=(0.62, 0.64, 0.58) if not DES else (0.95, 0.85, 0.7), grime=0.7))
nodes.append(K.part(bk, 'cast_iron', name='door_main_rollers', node='door_main', grime=0.3, smooth=True))
if len(bw.faces):
    nodes.append(K.part(bw, 'glass_dirty', name='door_main_glass', node='door_main', grime=0, bisect=False))
if not DEAD:
    for o in nodes:
        o['kit_pivot'] = [0.0, -HD - 0.35, 0.0]
    K.door_meta('main', (0.0, -HD, 0.0), (0, -1, 0), 2 * lw * 0.98, DH, kind='hangar_gate', node='door_main')
    K.A().meta['doors'][-1].update({'slide': [[-lw, 0], [lw, 0]], 'leaves': nl, 'motion': 'translate',
                                    'note': 'sliding leaves: translate the node along x by slide[] (do not rotate)'})
bm = bmesh.new()                                   # floor rails (two tracks) running past the opening to park the leaves
for yr in (-HD - 0.35, -HD - 0.57):
    K.box_bm(bm, (0, yr, 0.015), (2 * HW + 2.0, 0.07, 0.05))
K.part(bm, 'cast_iron', name='floor_rails', grime=0.4, bisect=False)
bm = bmesh.new()                                   # interior darkness + concrete floor
K.box_bm(bm, (0, 0, 0.02), (2 * HW - 0.6, 2 * HD - 0.6, 0.04))
K.part(bm, 'concrete_bunker', name='floor', tint=(0.5, 0.5, 0.5), grime=0.2, bisect=False)
bm = bmesh.new()                                   # darkness card at the back of the hall, clipped to the arch
inner = [(x * 0.97, min(z - 0.4, ZS + RISE - 0.5)) for x, z in ap]
xz_prism(bm, [(-HW + 0.45, 0.05), (HW - 0.45, 0.05)] + [p for p in reversed(inner)][1:-1], HD - 0.34, HD - 0.3)
K.part(bm, 'interior_dark', name='hall_dark', grime=0, bisect=False, jitter=0.1)

# ------------------------------------------------------------------ lean-to workshop on the east wall
LX0, LX1, LY0, LY1 = HW, HW + 4.2, -5.5, 5.5
lp = [(LX0, LY0), (LX1, LY0), (LX1, LY1), (LX0, LY1)]
ld = K.opening(lp, 0, 2.6, 1.0, 2.1, 0.0, 0.3, 'rect', 'door')
lws = [K.opening(lp, 1, 2.7, 1.2, 1.1, 1.1, 0.3), K.opening(lp, 1, 7.5, 1.2, 1.1, 1.1, 0.3), K.opening(lp, 0, 1.0, 0.8, 1.0, 1.2, 0.3)]
WM = 'plaster_limewash' if DES else 'brick_red'
K.wall_ring(lp, 3.1, 0.3, WM, [ld] + lws, plinth=('concrete_bunker', 0.3, 0.04), name='leanto')
for f in lws:
    K.window(f, 'casement', (1, 2), frame=(0.35, 0.37, 0.33), sill='concrete_bunker', lintel='timber_beam', shutters='open' if DES else None,
             shutter_color=(0.45, 0.42, 0.32), curtain=0.3, name='lwin')
K.door(ld, 'workshop', 'plank', (0.36, 0.34, 0.28), step='concrete_bunker', lintel='timber_beam', open_deg=20)
K.roof_shed(LX0, LY0, LX1, LY1, 3.1, 4.0, 'corrugated_rust', low_side='+x', oh=0.3, name='leanto_roof')
K.sign((LX0 + 2.6, LY0 - 0.02, 2.55), (0, -1, 0), 1.0, 'wache' if not DES else 'halt_sperrgebiet', 'timber_grey')

# ------------------------------------------------------------------ apron + props
bm = bmesh.new()
K.box_bm(bm, (0, -HD - 7.5, -0.03), (38.0, 15.0, 0.1))
K.part(bm, 'concrete_bunker', name='apron', tint=(0.92, 0.88, 0.8) if DES else (0.8, 0.8, 0.78), grime=0.4, lod='keep')
bm = bmesh.new()
for i, (x, y) in enumerate(((-12.0, -14.0), (-11.4, -14.3), (-11.7, -13.5), (-12.3, -13.4), (-11.1, -13.7), (-12.8, -14.1))):
    if DEAD and i > 2:
        K.cyl_bm(bm, (x, y, 0.29), (x + 0.88, y + 0.2, 0.29), 0.29, 10)
    else:
        K.cyl_bm(bm, (x, y, 0.0), (x, y, 0.88), 0.29, 10)
K.part(bm, 'steel_painted', name='drums', mat_tint=(0.55, 0.6, 0.45) if not DES else (0.7, 0.6, 0.4), smooth=True, grime=0.6)
bm = bmesh.new()
K.box_bm(bm, (11.5, -HD - 1.2, 0.85), (2.2, 0.8, 0.08))
for sx in (-1, 1):
    for sy in (-1, 1):
        K.box_bm(bm, (11.5 + sx * 1.0, -HD - 1.2 + sy * 0.32, 0.42), (0.08, 0.08, 0.84))
for a in range(3):                                 # engine hoist tripod
    d = Matrix.Rotation(a * 2.09, 3, 'Z') @ V((1.5, 0, 0))
    K.beam_bm(bm, V((-6.0, -HD - 4.0, 4.2)), V((-6.0, -HD - 4.0, 0)) + d, 0.12, 0.12)
K.cyl_bm(bm, (-6.0, -HD - 4.0, 4.2), (-6.0, -HD - 4.0, 2.2), 0.015, 4)
K.part(bm, 'timber_beam', name='bench_hoist', uv='beam', axis=(0, 0, 1))
for i in range(8):
    K.decal('stain_blotch', (r.uniform(-12, 12), r.uniform(-HD - 12, -HD - 1), 0.025), (0, 0, 1), r.uniform(1.0, 2.5), r.uniform(1.0, 2.0), up=(0, 1, 0), alpha=0.3)
for i in range(7):                                 # apron: irregular cracks / oil / tyre marks, random size + rotation
    a = r.uniform(0, math.pi)
    K.decal(r.choice(['crack', 'crack', 'stain_blotch', 'efflorescence']), (r.uniform(-15, 15), -HD - r.uniform(2.5, 12.5), 0.025 + i * 0.001), (0, 0, 1),
            r.uniform(0.9, 2.6), r.uniform(0.8, 2.2), up=(math.cos(a), math.sin(a), 0), alpha=r.uniform(0.3, 0.5), flip=r.random() < 0.5)
if not DES:                                        # corrugated steel: rust runs from laps and fixings, paint fade patches
    for i in range(22):
        face = r.choice(['front', 'back', 'w', 'e', 'e', 'w'])
        if face in ('front', 'back'):
            yy = -HD - 0.03 if face == 'front' else HD + 0.03
            x = r.uniform(-HW + 1, HW - 1)
            if face == 'front' and abs(x) < DW / 2 + 0.6:
                zz = r.uniform(DH + 0.8, ZS + RISE * (1 - (x / HW) ** 2) - 1.0)
            else:
                zz = r.uniform(1.5, ZS + RISE * (1 - (x / HW) ** 2) * 0.8)
            p, n = (x, yy, zz), (0, -1 if face == 'front' else 1, 0)
        else:
            sx = -1 if face == 'w' else 1
            p, n = (sx * (HW + 0.03), r.uniform(-HD + 1, HD - 1), r.uniform(2.0, 5.0)), (sx, 0, 0)
        k = r.choice(['streak_rust', 'streak_rust', 'stain_rust_blotch', 'streak_long', 'stain_blotch'])
        w = r.uniform(0.6, 1.8) if k.startswith('streak') else r.uniform(1.5, 3.2)
        K.decal(k, p, n, w, w * (2.2 if k.startswith('streak') else 0.8), alpha=r.uniform(0.45, 0.75), flip=r.random() < 0.5)
if DES:                                            # guy ropes from the arch ribs to ground stakes, canvas skirt
    bm, bs = bmesh.new(), bmesh.new()
    for y in RIBS:
        for sx in (-1, 1):
            x, z = ap[5] if sx < 0 else ap[-6]
            n = V((x, 0, z - cz)).normalized()
            top = V((x, y, z)) + n * 0.1
            st = V((sx * (HW + 5.0), y + r.uniform(-0.3, 0.3), 0.0))
            mid = top.lerp(st, 0.5) - V((0, 0, 0.18))
            K.cyl_bm(bm, top, mid, 0.022, 4, caps=False)
            K.cyl_bm(bm, mid, st + V((0, 0, 0.3)), 0.022, 4, caps=False)
            K.box_bm(bs, tuple(st + V((0, 0, 0.18))), (0.08, 0.08, 0.4), r.uniform(0, 1))
    for x in (-6.0, 0.0, 6.0):                     # back gable ropes
        K.cyl_bm(bm, (x, HD + 0.2, 7.5 - abs(x) * 0.2), (x * 1.2, HD + 6.0, 0.3), 0.022, 4, caps=False)
        K.box_bm(bs, (x * 1.2, HD + 6.0, 0.18), (0.08, 0.08, 0.4))
    K.part(bm, 'hessian', name='guy_ropes', mat_tint=(0.9, 0.85, 0.72), grime=0, bisect=False, lod='drop')
    K.part(bs, 'timber_beam', name='stakes', grime=0.3, bisect=False, lod='drop')
    bm = bmesh.new()
    for (xa, ya), (xb, yb), (nx, ny) in (((-HW, -HD), (-HW, HD), (-1, 0)), ((HW, HD), (HW, -HD), (1, 0)), ((-HW, HD), (HW, HD), (0, 1))):
        q = [V((xa, ya, 0.55)), V((xb, yb, 0.55)), V((xb + nx * 0.45, yb + ny * 0.45, 0.02)), V((xa + nx * 0.45, ya + ny * 0.45, 0.02))]
        f = bm.faces.new([bm.verts.new(p) for p in q])
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, SKIN, name='skirt', mat_tint=(0.9, 0.84, 0.72), grime=1.0)
    M.berm([(-HW - 0.02, HD), (-HW - 0.02, -HD + 1)], [(-HW - 1.6, HD + 0.5), (-HW - 1.3, -HD + 0.5)], 0.55, 'sand', 'drift_w', taper_end=0.3, rows=5, step=1.0)
    M.berm([(HW - 3, HD + 0.02), (-HW + 2, HD + 0.02)], [(HW - 3.5, HD + 1.4), (-HW + 1.5, HD + 1.2)], 0.45, 'sand', 'drift_n', taper_end=0.3, rows=5, step=1.0)
for i in range(10):
    s = r.choice([-1, 1])
    K.decal(r.choice(['streak_rust', 'streak_rain']), (s * (HW + 0.03), r.uniform(-HD + 1, HD - 1), 4.6), (s, 0, 0), 1.0, 2.0, alpha=0.5)

# ------------------------------------------------------------------ destroyed: roof torn open (ribs remain), scorch, sheet debris
if DEAD:
    K.bite((-4.0, -3.0, ZS + RISE), 4.2, (1.2, 1.3, 0.8), seed=3, parts=[roof])
    K.bite((7.0, 6.5, ZS + RISE - 0.8), 3.2, (1.2, 1.0, 0.8), seed=5, parts=[roof, gb])
    K.bite((9.0, -HD, 8.5), 2.2, (1.2, 1.0, 1.0), seed=6, parts=[gf])
    bm = bmesh.new()
    for i in range(26):
        c = V((r.uniform(-14, 16), r.uniform(-HD - 8, HD + 3), 0.05))
        if abs(c.x) < HW - 0.5 and abs(c.y) < HD - 0.5:
            c.z = r.uniform(0.05, 0.4)
        K.box_bm(bm, tuple(c), (r.uniform(1.0, 2.6), r.uniform(0.6, 1.0), 0.03), r.uniform(0, 3))
    K.part(bm, SKIN, name='sheet_debris', mat_tint=PAINT, grime=0.9)
    for p in ((-4, -3), (7, 6.5), (0, -HD - 3)):
        K.decal('soot', (p[0], p[1], 0.06), (0, 0, 1), 7, 6, up=(0, 1, 0), alpha=0.95)
    for (hx, hy, hr) in ((-4.0, -3.0, 4.2 * 1.25), (7.0, 6.5, 3.2 * 1.15)):     # scorched, charred canvas round the holes
        for k in range(9):
            a = 2 * math.pi * k / 9 + r.uniform(-0.2, 0.2)
            x, y = hx + math.cos(a) * hr * 1.2, hy + math.sin(a) * hr * 1.15
            if abs(x) > HW - 0.8 or abs(y) > HD - 0.2:
                continue
            nd = V((x, 0, math.sqrt(max(1.0, Rr * Rr - x * x)))).normalized()
            zc = cz + math.sqrt(max(1.0, Rr * Rr - x * x)) + 0.1 - sag(y) * (1 - abs(x) / HW * 0.3)
            K.decal('soot', (x, y, zc), nd, hr * 0.6, hr * 0.5, up=(-math.sin(a), math.cos(a), 0), alpha=0.95)
    K.decal('soot', (9.0, -HD - 0.04, 8.2), (0, -1, 0), 5.0, 4.0, alpha=0.95)
    K.scorch_openings(1.2, 0.8)
    K.anchor('fire', (-4.0, -3.0, 0.5), kind='fire_large')

K.roof_meta([(-HW - 0.5, -HD - 0.5), (HW + 0.5, -HD - 0.5), (HW + 0.5, HD + 0.5), (-HW - 0.5, HD + 0.5)], ZS, walkable=False, kind='arch')
K.anchor('roof_ridge', (0, 0, ZS + RISE))
K.anchor('aircraft_bay', (0, 0, 0), (0, -1, 0), kind='plane_park', w=2 * HW - 1, d=2 * HD - 1)
M.finalize(M.outdir(K.A().name), ao_res=2048, ao_samples=40)
