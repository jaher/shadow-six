"""U-boat pen (M7 Arendal; after Dora 1 Trondheim / Bruno Bergen, 1941-43): massive board-formed concrete bunker with
two wet pens and a workshop wing. 3 m walls, 3.2 m roof slab with a Fangrost (bomb-trap beam grid), projecting
front apron roof on piers over the water, raised armoured splinter shutters in the pen mouths, inner quays with
bollards, pipe railings and crane rails with travelling cranes, rear landing hall with rail gates, stair tower to the
roof, two roof Flak ringstands with 2 cm Flak 38, vents, waterline staining.
Road/water convention: pens open to the SOUTH (-Y, the harbour); quay/ground level z=0, water at WATER.
Variants: a (coast, grey), snow (M7 Norway). Usage: blender -b --factory-startup --python uboat_pen.py -- [a|snow] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('snow', 61)
WATER = -1.8
K.begin('uboat_pen' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='snow' if VAR == 'snow' else 'coast',
        snow=VAR == 'snow', water_level=WATER)
r = K.rng()
CT = (0.8, 0.8, 0.78)
X0, X1, Y0, Y1 = -19.5, 19.5, -45.0, 45.0            # 90 m: a 67 m Type VII fits a pen with room to spare
ZB, ZW, ZR = -6.5, 10.0, 13.2            # foundation bottom, wall top (roof soffit), roof top
PENS = [(-16.5, -5.5), (-2.5, 8.5)]       # x ranges of the wet pens
YW = 31.0                                  # end of water in the pens (76 m of wet berth)
QW = 1.3                                   # inner quay width
ZO = 9.0                                   # opening / hall soffit height

# ------------------------------------------------------------------ main mass: one board-formed block with pens and hall cut out
bm = bmesh.new()
M.chamfer_block(bm, X0, Y0, X1, Y1, ZB, ZW, ch=0.3, top_ch=False)
body = M.conc_part(bm, 'body', 'concrete_board', CT)
for (a, b) in PENS:
    K.cut_object(body, M.cutter_box(a + QW, Y0 - 1, ZB - 1, b - QW, YW, 0.0))      # water basin (quays stay)
    K.cut_object(body, M.cutter_box(a, Y0 - 1, 0.0, b, YW + 0.01, ZO))              # pen volume above the quays
K.cut_object(body, M.cutter_box(PENS[0][0], YW, 0.0, PENS[1][1], Y1 - 3.0, ZO))      # landing hall behind the pens
K.cut_object(body, M.cutter_box(PENS[0][0] + 3, Y1 - 3.5, 0.0, PENS[0][0] + 8, Y1 + 1, 5.5))   # rail gate
K.cut_object(body, M.cutter_box(PENS[1][0] + 4, Y1 - 3.5, 0.0, PENS[1][0] + 9, Y1 + 1, 5.5))   # lorry gate
bm = bmesh.new()
M.chamfer_block(bm, X0 - 0.4, Y0 - 0.4, X1 + 0.4, Y1 + 0.4, ZW - 0.02, ZR, ch=0.35, top_ch=True)
roof = M.conc_part(bm, 'roof_slab', 'concrete_bunker', CT)
# projecting apron roof over the water on three piers (splinter protection for the pen mouths)
bm = bmesh.new()
M.chamfer_block(bm, X0 + 1.0, Y0 - 7.0, PENS[1][1] + 1.5, Y0 + 0.2, ZW + 0.6, ZR - 0.4, ch=0.25, top_ch=True)
apron = M.conc_part(bm, 'apron_roof', 'concrete_board', CT)
bm = bmesh.new()
for xa, xb in ((X0 + 1.0, PENS[0][0]), (PENS[0][1], PENS[1][0]), (PENS[1][1], PENS[1][1] + 1.5)):
    M.chamfer_block(bm, xa, Y0 - 6.8, xb, Y0 - 4.6, ZB, ZW + 0.62, ch=0.15, top_ch=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'apron_piers', 'concrete_board', CT)
# pen interiors: dark soffit + back walls, hall darkness
bm = bmesh.new()
for (a, b) in PENS:
    K.box_bm(bm, ((a + b) / 2, (Y0 + YW) / 2, ZO - 0.05), (b - a, YW - Y0, 0.06))
K.box_bm(bm, ((PENS[0][0] + PENS[1][1]) / 2, Y1 - 3.05, 4.5), (PENS[1][1] - PENS[0][0], 0.06, 9.0))
K.box_bm(bm, ((PENS[0][0] + PENS[1][1]) / 2, (YW + Y1 - 3) / 2, ZO - 0.05), (PENS[1][1] - PENS[0][0], Y1 - 3 - YW, 0.06))
K.part(bm, 'concrete_formwork', name='pen_dark', mat_tint=(0.36, 0.36, 0.35), grime=0.3, bisect=False, jitter=0.15)   # R4: dim concrete, not a void

# ------------------------------------------------------------------ armoured splinter shutters (raised) + lintel beams in the mouths
bm = bmesh.new()
for (a, b) in PENS:
    n = 5
    for i in range(n):
        xa = a + (b - a) * i / n + 0.03
        xb = a + (b - a) * (i + 1) / n - 0.03
        drop = r.uniform(0.0, 0.5)
        K.box_bm(bm, ((xa + xb) / 2, Y0 + 0.9 + (i % 2) * 0.25, ZO - 1.6 - drop), (xb - xa, 0.08, 3.2))
        for z in (ZO - 0.4, ZO - 1.6, ZO - 2.8):
            K.box_bm(bm, ((xa + xb) / 2, Y0 + 0.82 + (i % 2) * 0.25, z - drop), (xb - xa, 0.08, 0.14))
    K.beam_bm(bm, (a, Y0 + 1.4, ZO - 0.1), (b, Y0 + 1.4, ZO - 0.1), 0.4, 0.3)               # shutter track
K.part(bm, 'steel_painted', name='shutters', mat_tint=(0.62, 0.62, 0.58), grime=0.8)

# ------------------------------------------------------------------ inner quays: bollards, pipe railings, crane rails, travelling cranes
bm = bmesh.new()
for (a, b) in PENS:
    for x in (a + 0.45, b - 0.45):
        for k in range(6):                         # R4: 6 bollards per quay (budget)
            y = Y0 + 3 + k * 8.5
            K.cyl_bm(bm, (x, y, 0.0), (x, y, 0.55), 0.2, 6, r1=0.17)
            K.cyl_bm(bm, (x, y, 0.55), (x, y, 0.65), 0.26, 6)
K.part(bm, 'cast_iron', name='bollards', smooth=True, grime=0.4)
bm = bmesh.new()                                           # light pipe railings along the quay edges (posts every 2.4 m)
for (a, b) in PENS:
    for x in (a + QW - 0.08, b - QW + 0.08):
        n = int((YW - 0.3 - Y0 - 1.5) / 2.4)
        for i in range(n + 1):
            y = Y0 + 1.5 + i * 2.4
            K.cyl_bm(bm, (x, y, 0.0), (x, y, 1.0), 0.025, 4, caps=False)
        for z in (0.55, 1.0):
            K.cyl_bm(bm, (x, Y0 + 1.5, z), (x, Y0 + 1.5 + n * 2.4, z), 0.022, 4, caps=False)
K.part(bm, 'steel_painted', name='quay_rail', mat_tint=(0.75, 0.7, 0.35), grime=0.3, bisect=False)
bm = bmesh.new()
for (a, b) in PENS:
    for x in (a + 0.25, b - 0.25):
        M.K.ibeam_bm(bm, (x, Y0 + 0.5, 7.4), (x, Y1 - 3.5, 7.4), 0.5, 0.3)
        for k in range(19):
            y = Y0 + 2 + k * 4.5
            K.beam_bm(bm, (x, y, 7.1), (x + (0.25 if x < (a + b) / 2 else -0.25), y, 6.4), 0.12, 0.12)
    for yc in (-20.0 + r.uniform(-4, 4), 12.0 + r.uniform(-4, 4)):   # travelling crane bridges + hoists
        M.K.ibeam_bm(bm, (a + 0.3, yc, 7.95), (b - 0.3, yc, 7.95), 0.9, 0.4)
        M.K.ibeam_bm(bm, (a + 0.3, yc + 1.6, 7.95), (b - 0.3, yc + 1.6, 7.95), 0.9, 0.4)
        xh = (a + b) / 2 + r.uniform(-2, 2)
        K.box_bm(bm, (xh, yc + 0.8, 7.4), (1.4, 2.2, 0.9))
        K.cyl_bm(bm, (xh, yc + 0.8, 6.9), (xh, yc + 0.8, 3.2), 0.03, 4)
        K.box_bm(bm, (xh, yc + 0.8, 3.1), (0.5, 0.3, 0.3))
K.part(bm, 'steel_painted', name='cranes', mat_tint=(0.8, 0.72, 0.45), grime=0.8)
# rail track into the landing hall + sliding gates (half open)
bm = bmesh.new()
gx = PENS[0][0] + 5.5
for s in (-1, 1):
    K.beam_bm(bm, (gx + s * 0.72, YW + 0.5, 0.06), (gx + s * 0.72, Y1 + 6, 0.06), 0.07, 0.12)
for i in range(int((Y1 + 6 - YW) / 0.65)):
    y = YW + 0.8 + i * 0.65
    K.box_bm(bm, (gx, y, 0.0), (2.4, 0.22, 0.12))
K.part(bm, 'steel_galv', name='rails', mat_tint=(0.7, 0.6, 0.5), grime=0.5, lod='drop')
bm = bmesh.new()
for g0, g1 in ((PENS[0][0] + 3, PENS[0][0] + 8), (PENS[1][0] + 4, PENS[1][0] + 9)):
    w = (g1 - g0) / 2
    K.box_bm(bm, (g0 + w / 2 - 0.9, Y1 + 0.25, 2.7), (w, 0.1, 5.4))
    K.box_bm(bm, (g1 - w / 2 + 1.6, Y1 + 0.35, 2.7), (w, 0.1, 5.4))
    for z in (0.8, 2.7, 4.6):
        K.box_bm(bm, (g0 + w / 2 - 0.9, Y1 + 0.32, z), (w, 0.06, 0.14))
        K.box_bm(bm, (g1 - w / 2 + 1.6, Y1 + 0.42, z), (w, 0.06, 0.14))
    K.beam_bm(bm, (g0 - 2, Y1 + 0.5, 5.6), (g1 + 3, Y1 + 0.5, 5.6), 0.2, 0.25)
K.part(bm, 'steel_painted', name='gates', mat_tint=(0.55, 0.58, 0.52), grime=0.8)

# ------------------------------------------------------------------ workshop wing: shuttered windows, steel door
WX = [(PENS[1][1] + 3.0, 3.2), (PENS[1][1] + 7.0, 3.2), (PENS[1][1] + 3.0, 6.4), (PENS[1][1] + 7.0, 6.4)]
for x, z in WX:
    K.cut_object(body, M.cutter_box(x - 0.6, Y0 - 1, z, x + 0.6, Y0 + 0.5, z + 1.0))
bm = bmesh.new()
for x, z in WX:
    K.box_bm(bm, (x, Y0 + 0.5, z + 0.5), (1.2, 0.04, 1.0))
K.part(bm, 'interior_dark', name='wing_dark', grime=0, bisect=False)
bm = bmesh.new()
for i, (x, z) in enumerate(WX):
    if i % 2:
        K.box_bm(bm, (x, Y0 + 0.3, z + 0.5), (1.15, 0.05, 0.95))
    else:
        K.box_bm(bm, (x - 0.9, Y0 - 0.05, z + 0.5), (0.56, 0.05, 0.95))
        K.box_bm(bm, (x + 0.9, Y0 - 0.05, z + 0.5), (0.56, 0.05, 0.95))
K.part(bm, 'steel_painted', name='wing_shutters', mat_tint=(0.6, 0.62, 0.56))
DXW = PENS[1][1] + 5.0
K.cut_object(body, M.cutter_box(DXW - 0.7, Y0 - 1, 0.0, DXW + 0.7, Y0 + 0.6, 2.3))
bm = bmesh.new()
K.box_bm(bm, (DXW, Y0 + 0.6, 1.15), (1.4, 0.04, 2.3))
K.part(bm, 'interior_dark', name='wing_door_dark', grime=0, bisect=False)
hinge = V((DXW - 0.65, Y0 + 0.35, 0.02))
bm = bmesh.new()
K.box_bm(bm, (0.65, 0.0, 1.1), (1.28, 0.06, 2.2))
for v in bm.verts:
    v.co = hinge + Matrix.Rotation(math.radians(-25), 3, 'Z') @ v.co
dp = K.part(bm, 'steel_painted', name='door_wing_leaf', node='door_wing', mat_tint=(0.58, 0.6, 0.55))
dp['kit_pivot'] = list(hinge)
K.door_meta('wing', (DXW, Y0, 0.0), (0, -1, 0), 1.4, 2.3, kind='bunker_door', node='door_wing')

# ------------------------------------------------------------------ stair tower (east) to the roof
SX0, SX1, SY0, SY1 = X1, X1 + 4.2, 33.0, 40.0
bm = bmesh.new()
M.chamfer_block(bm, SX0 - 0.3, SY0, SX1, SY1, -0.08, ZR + 2.8, ch=0.12, top_ch=True)
st = M.conc_part(bm, 'stair_tower', 'concrete_board', CT)
K.cut_object(st, M.cutter_box(SX0 + 1.4, SY0 - 1, 0.0, SX0 + 2.6, SY0 + 0.5, 2.2))
K.cut_object(st, M.cutter_box(SX0 - 1, SY0 + 2.5, ZR, SX0 + 0.5, SY0 + 3.7, ZR + 2.2))
bm = bmesh.new()
K.box_bm(bm, (SX0 + 2.0, SY0 + 0.5, 1.1), (1.2, 0.04, 2.2))
K.box_bm(bm, (SX0 + 0.5, SY0 + 3.1, ZR + 1.1), (0.04, 1.2, 2.2))
K.part(bm, 'interior_dark', name='stair_dark', grime=0, bisect=False)
K.door_meta('stair', (SX0 + 2.0, SY0, 0.0), (0, -1, 0), 1.2, 2.2, kind='doorway', node=None)
K.ladder_meta((SX0 + 2.0, SY0 - 0.8), (SX0 - 1.0, SY0 + 3.1), ZR)
for k in range(3):
    K.cut_object(st, M.cutter_box(SX1 - 0.5, SY0 + 2.5, 3.5 + k * 4, SX1 + 1, SY0 + 2.7, 4.6 + k * 4))

# ------------------------------------------------------------------ roof: Fangrost beam grid, Flak ringstands, vents
FLAK = [(-13.0, 36.0), (12.5, -36.0), (13.0, 10.0), (-12.0, -6.0)]     # rework 2: four ringstands
# R4: ribs = runs split at random expansion joints into segments; each segment its own tone lot (4 lots, wide spread),
# own UV offset + rotation; tops weathered bunker concrete, faces board-formed (no identical crack band on every rib)
LOTS_T = [bmesh.new() for _ in range(4)]
LOTS_S = [bmesh.new() for _ in range(4)]
def _rib_seg(a, b, y, h):
    tb = bmesh.new()                                   # plain box (the 8 cm chamfer is invisible at game zoom; budget)
    K.box_bm(tb, ((a + b) / 2, y, ZR - 0.02 + (h + 0.02) / 2), (b - a, 1.4, h + 0.02))
    tb.normal_update()
    bmesh.ops.delete(tb, geom=[f for f in tb.faces if f.normal.z < -0.5], context='FACES')
    k = r.randint(0, 3)
    for dst, want_top, mid in ((LOTS_T[k], True, 'concrete_bunker'), (LOTS_S[(k + r.randint(0, 3)) % 4], False, 'concrete_formwork')):
        nf = []
        for f in tb.faces:
            if (f.normal.z > 0.7) == want_top:
                nf.append(dst.faces.new([dst.verts.new(v.co) for v in f.verts]))
        for f in nf:
            f.normal_update()
        K.uv_faces(dst, nf, mid, 'aligned', offset=(r.random() * 9.1, r.random() * 7.7), rot90=want_top and r.random() < 0.5)
    tb.free()
RIBY = []
y = Y0 + 1.2
while y < Y1 - 0.8:
    xs = [(X0 + 0.4, X1 - 0.4)]
    for fx, fy in FLAK:
        if abs(y - fy) < 4.2:
            half = math.sqrt(max(0.0, 4.2 ** 2 - (y - fy) ** 2))
            nxs = []
            for a, b in xs:
                if b < fx - half or a > fx + half:
                    nxs.append((a, b))
                else:
                    if a < fx - half - 0.5:
                        nxs.append((a, fx - half))
                    if b > fx + half + 0.5:
                        nxs.append((fx + half, b))
            xs = nxs
    RIBY.append(y)
    for a, b in xs:
        cuts = [a]
        while b - cuts[-1] > 16.0:
            cuts.append(cuts[-1] + r.uniform(7.0, 15.0))
        cuts.append(b)
        for sa, sb in zip(cuts[:-1], cuts[1:]):
            _rib_seg(sa + (0.03 if sa > a else 0.0), sb - (0.03 if sb < b else 0.0), y, 1.3 + r.uniform(-0.05, 0.05))
    y += 3.3
fangs = []
TT = [(0.86, 0.86, 0.83), (0.72, 0.72, 0.7), (0.96, 0.94, 0.89), (0.8, 0.82, 0.77)]
def vc_mottle(o, freq=0.045, amp=0.22, seed=3.3):
    from mathutils import noise as NZ_
    cl = o.data.color_attributes.get('Col')
    if cl is None:
        return
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            p_ = o.data.vertices[o.data.loops[li].vertex_index].co
            n1 = NZ_.noise(V((p_.x * freq, p_.y * freq, seed)))
            n2 = NZ_.noise(V((p_.x * freq * 4.1, p_.y * freq * 4.1, seed + 7)))
            k = max(0.55, 1 + amp * n1 + amp * 0.45 * n2)
            c = cl.data[li].color
            cl.data[li].color = (min(1, c[0] * k), min(1, c[1] * k * (1 + 0.05 * n2)), min(1, c[2] * k), c[3])
for k in range(4):
    for bm, mid, tint in ((LOTS_T[k], 'concrete_bunker', TT[k]), (LOTS_S[k], 'concrete_formwork', tuple(min(1.0, c * (0.72, 1.02, 0.84, 1.12)[k]) for c in CT))):
        o = K.part(bm, mid, name='fangrost', uv='keep', mat_tint=tint, grime=0.9)
        o['conc_fixed'] = 1                               # keep the per-segment UVs (skip the finalize re-projection)
        vc_mottle(o, amp=0.3, seed=3.3 + k)
        fangs.append(o)
fang = fangs[0]
bm = bmesh.new()
for fx, fy in FLAK:                                        # ringstand: platform drum + parapet ring
    K.cyl_bm(bm, (fx, fy, ZR - 0.02), (fx, fy, ZR + 1.5), 3.6, 24)
    rin, rout = 2.9, 3.6
    ring = []
    for i in range(24):
        a = 2 * math.pi * i / 24
        ring.append((math.cos(a), math.sin(a)))
    o0 = [V((fx + c * rout, fy + s * rout, ZR + 1.5)) for c, s in ring]
    o1 = [V((fx + c * rout, fy + s * rout, ZR + 2.5)) for c, s in ring]
    i1 = [V((fx + c * rin, fy + s * rin, ZR + 2.5)) for c, s in ring]
    i0 = [V((fx + c * rin, fy + s * rin, ZR + 1.5)) for c, s in ring]
    K.loft_bm(bm, [o0, o1, i1, i0], close_start=False, close_end=False)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'flak_stands', 'concrete_board', CT)
for k, (fx, fy) in enumerate(FLAK):                        # 2 cm Flak 38 on its pedestal
    bm = bmesh.new()
    p = V((fx, fy, ZR + 1.5))
    yaw = r.uniform(0, 6.28)
    Rz = Matrix.Rotation(yaw, 3, 'Z')
    K.cyl_bm(bm, p, p + V((0, 0, 0.55)), 0.45, 10, r1=0.3)
    K.box_bm(bm, tuple(p + V((0, 0, 0.8))), (0.5, 0.9, 0.4), yaw)
    d = Rz @ V((0, -math.cos(0.5), math.sin(0.5)))
    K.cyl_bm(bm, p + V((0, 0, 0.9)), p + V((0, 0, 0.9)) + d * 2.3, 0.04, 6)
    K.box_bm(bm, tuple(p + V((0, 0, 1.0)) + Rz @ V((0, -0.55, 0))), (1.2, 0.04, 0.8), yaw)
    for a in range(3):
        dd = Matrix.Rotation(a * 2.09, 3, 'Z') @ V((1.3, 0, 0))
        K.beam_bm(bm, p + V((0, 0, 0.05)), p + dd + V((0, 0, 0.02)), 0.12, 0.08)
    K.part(bm, 'steel_painted', name='flak%d' % k, mat_tint=(0.68, 0.7, 0.64), bisect=False)
    K.anchor('flak', tuple(p + V((0, 0, 0.9))), tuple(d), kind='flak38')
    M.K.ladder_meta((fx + 3.8, fy), (fx + 2.5, fy), ZR + 1.5)
bm = bmesh.new()
for x, yv in ((-4.0, 5.0), (3.0, 20.0), (-9.0, -18.0), (6.0, -4.0), (16.5, 19.0), (-15.5, 8.0), (2.0, 32.0), (-3.0, -30.0)):
    K.box_bm(bm, (x, yv, ZR + 1.9), (1.2, 1.2, 1.2))
    K.box_bm(bm, (x, yv, ZR + 2.6), (1.6, 1.6, 0.2))
M.conc_part(bm, 'vents', 'concrete_bunker', CT)

# ------------------------------------------------------------------ rework: piers, fenders, ladders, quay edges, numbers, gates, damage
PIERS = ((X0 + 1.0, PENS[0][0]), (PENS[0][1], PENS[1][0]), (PENS[1][1], PENS[1][1] + 1.5))
bm = bmesh.new()
for xa, xb in PIERS:                                       # pointed cutwater noses + battered plinths + corbelled capitals
    xm = (xa + xb) / 2
    K.prism_bm(bm, K.ccw([(xa - 0.25, Y0 - 4.6), (xb + 0.25, Y0 - 4.6), (xb + 0.25, Y0 - 6.8), (xm, Y0 - 8.0), (xa - 0.25, Y0 - 6.8)]), ZB, WATER + 1.2)
    K.prism_bm(bm, K.ccw([(xa, Y0 - 4.6), (xb, Y0 - 4.6), (xb, Y0 - 6.8), (xm, Y0 - 7.5), (xa, Y0 - 6.8)]), WATER + 1.2, ZW - 1.0)
    for k, (dz, pj) in enumerate(((ZW - 1.0, 0.15), (ZW - 0.4, 0.35))):
        K.box_bm(bm, (xm, Y0 - 5.7, dz + 0.3), (xb - xa + 2 * pj, 2.2 + 2 * pj, 0.6))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'pier_detail', 'concrete_board', CT)
bm = bmesh.new()                                           # timber fenders on the pier noses/sides and the quay ends
for xa, xb in PIERS:
    xm = (xa + xb) / 2
    for x, y in ((xm, Y0 - 8.05), (xa - 0.3, Y0 - 6.0), (xb + 0.3, Y0 - 6.0), (xa - 0.3, Y0 - 5.0), (xb + 0.3, Y0 - 5.0)):
        K.box_bm(bm, (x, y, (WATER - 1.2 + 1.0) / 2), (0.26, 0.26, 1.0 - WATER + 1.2))
for (a, b) in PENS:
    for x in (a + QW + 0.13, b - QW - 0.13):
        for k in range(5):
            K.box_bm(bm, (x, Y0 + 2 + k * 14.5, (WATER - 1.0 - 0.1) / 2), (0.24, 0.3, 1.1 - WATER))
K.part(bm, 'timber_creosote', name='fenders', uv='beam', axis=(0, 0, 1), grime=0.6, bisect=False)
for (a, b) in PENS:                                        # steel ladders down the quay walls
    for x, n in ((a + QW, (1, 0, 0)), (b - QW, (-1, 0, 0))):
        for k in (2, 6):
            K.ladder((x + n[0] * 0.06, Y0 + 6.5 + k * 9.5, WATER - 1.2), 0.9, n, lean=0.0, mid='cast_iron', name='quay_ladder', meta=False)
bm = bmesh.new()                                           # steel angle nosing on every quay edge + outer quay at the wing
for (a, b) in PENS:
    for x in (a + QW - 0.05, b - QW + 0.05):
        K.box_bm(bm, (x, (Y0 + YW) / 2, -0.02), (0.12, YW - Y0, 0.08))
K.box_bm(bm, ((PENS[1][1] + 1.5 + X1) / 2, Y0 - 0.05, -0.02), (X1 - PENS[1][1] - 1.5, 0.12, 0.08))
K.part(bm, 'cast_iron', name='quay_nosing', grime=0.4, bisect=False)
SEG = {'1': 'bc', '2': 'abged', '3': 'abgcd'}
def digit(bm, ch, cx, cz, h, y):
    w, t = h * 0.55, h * 0.13
    segs = {'a': (0, h / 2 - t / 2, w, t), 'g': (0, 0, w, t), 'd': (0, -h / 2 + t / 2, w, t),
            'b': (w / 2 - t / 2, h / 4, t, h / 2), 'c': (w / 2 - t / 2, -h / 4, t, h / 2),
            'e': (-w / 2 + t / 2, -h / 4, t, h / 2), 'f': (-w / 2 + t / 2, h / 4, t, h / 2)}
    for sg in SEG[ch]:
        dx, dz, sw, sh = segs[sg]
        K.box_bm(bm, (cx + dx, y, cz + dz), (sw, 0.03, sh))
bm = bmesh.new()                                           # stencilled pen numbers on the apron front + pier heads
for i, (a, b) in enumerate(PENS):
    digit(bm, str(i + 1), (a + b) / 2, (ZW + 0.6 + ZR - 0.4) / 2, 1.7, Y0 - 7.02)
K.part(bm, 'plaster_white', name='pen_numbers', mat_tint=(0.95, 0.94, 0.9), grime=0.3, bisect=False)
bm = bmesh.new()                                           # armoured sliding gate half across pen 2's mouth (on a floor track)
a, b = PENS[1]
for i in range(3):
    xa_ = a + QW + i * 1.6
    K.box_bm(bm, (xa_ + 0.78, Y0 + 0.2, (WATER - 0.6 + ZO - 3.2) / 2), (1.56, 0.25, ZO - 3.2 - WATER + 0.6))
    for z in range(4):
        K.box_bm(bm, (xa_ + 0.78, Y0 + 0.04, WATER + 0.2 + z * 1.4), (1.5, 0.08, 0.16))
K.box_bm(bm, ((a + b) / 2, Y0 + 0.2, ZO - 3.0), (b - a, 0.35, 0.3))
K.part(bm, 'steel_painted', name='sliding_gate', mat_tint=(0.5, 0.52, 0.48), grime=0.9)
for (a, b) in PENS:                                        # water-level staining + algae inside the pens and on piers
    for x, n in ((a + QW + 0.01, (1, 0, 0)), (b - QW - 0.01, (-1, 0, 0))):
        for k in range(3):
            K.decal('waterline', (x, Y0 + 8 + k * 22, WATER + 0.3), n, 12.0, 1.4, alpha=0.9)
for xa, xb in PIERS:
    for x, n in ((xa - 0.26, (-1, 0, 0)), (xb + 0.26, (1, 0, 0))):
        K.decal('waterline', (x, Y0 - 5.7, WATER + 0.3), n, 2.4, 1.5, alpha=0.9)
        K.decal('moss_patch', (x, Y0 - 5.7, WATER + 0.7), n, 2.2, 0.7, alpha=0.7)

# ------------------------------------------------------------------ weathering
for (a, b) in PENS:
    for x in (a - 0.001, b + 0.001):
        pass
    K.decal('waterline', ((a + b) / 2 - (b - a) / 2 - 0.3, Y0 - 0.002, WATER + 0.45), (0, -1, 0), 3.0, 1.4)
for xa, xb in ((X0 + 1.0, PENS[0][0]), (PENS[0][1], PENS[1][0]), (PENS[1][1], PENS[1][1] + 1.5)):
    K.decal('waterline', ((xa + xb) / 2, Y0 - 6.81, WATER + 0.4), (0, -1, 0), xb - xa + 0.2, 1.4)
for i in range(22):
    x = r.uniform(X0, X1)
    K.decal(r.choice(['streak_long', 'streak_long', 'streak_rain', 'streak_rust']), (x, Y0 - 7.01 if x < PENS[1][1] + 1.5 else Y0 - 0.401, ZR - 1.4),
            (0, -1, 0), r.uniform(1.0, 2.2), 2.0, alpha=0.55)
for i in range(10):
    yv = r.uniform(Y0, Y1)
    for s, x in ((-1, X0 - 0.401), (1, X1 + 0.401)):
        if s > 0 and SY0 - 1 < yv < SY1 + 1:
            continue
        K.decal(r.choice(['streak_long', 'streak_rain']), (x, yv, ZR - 1.5), (s, 0, 0), r.uniform(1.0, 2.2), 2.2, alpha=0.5)
for (a, b) in PENS:
    K.decal('streak_rust', ((a + b) / 2, Y0 + 0.75, ZO - 3.8), (0, -1, 0), b - a - 0.5, 1.5, alpha=0.5)
for i in range(6):
    K.decal('efflorescence', (r.uniform(X0 + 2, X1 - 2), Y0 - 0.002, r.uniform(1.0, 3.0)), (0, -1, 0), 2.0, 1.2, alpha=0.4)

HOODS = []
bm, bl = bmesh.new(), bmesh.new()                         # ventilation openings with steel louvres along both long walls
for sx, x in ((-1, X0), (1, X1)):
    for k in range(9):
        yv = Y0 + 6 + k * 9.5
        if sx > 0 and SY0 - 2 < yv < SY1 + 2:
            continue
        K.box_bm(bm, (x + sx * 0.01, yv, 7.6), (0.03, 2.6, 1.7))             # rework 2: bigger louvred vents, deep steel frame,
        for j in range(4):                                                   # concrete weather hood; rust weeping below
            K.box_bm(bl, (x + sx * 0.1, yv, 7.0 + j * 0.4), (0.12, 2.5, 0.08), 0)
        for dy in (-1.33, 1.33):
            K.box_bm(bl, (x + sx * 0.12, yv + dy, 7.6), (0.24, 0.08, 1.82))
        HOODS.append((x + sx * 0.3, yv, sx))
        K.decal('streak_rust', (x + sx * 0.004, yv, 5.2), (sx, 0, 0), 2.2, 3.4, alpha=0.8)
K.part(bm, 'interior_dark', name='vents_dark', grime=0, bisect=False)
K.part(bl, 'steel_painted', name='vent_louvres', mat_tint=(0.5, 0.48, 0.44), grime=0.8, bisect=False)
for i in range(10):                                        # big dark water-staining blotches on the long walls
    yv = r.uniform(Y0 + 3, Y1 - 3)
    for sx, x in ((-1, X0 - 0.004), (1, X1 + 0.004)):
        if sx > 0 and SY0 - 2 < yv < SY1 + 2:
            continue
        K.decal('stain_blotch', (x, yv, r.uniform(2.5, 8.0)), (sx, 0, 0), r.uniform(4, 8), r.uniform(3, 6), alpha=0.55)

# roof: bomb hits on the Fangrost (the beam grid did its job: spalled craters, exposed rebar, debris), drainage stains
for cx, cy, rad in ((-6.0, -12.0, 2.3), (9.0, 22.0, 1.8), (-15.5, -30.0, 1.4), (13.0, -24.5, 1.7), (-11.0, 16.0, 1.5), (2.0, 38.0, 1.3)):
    K.bite((cx, cy, ZR + 1.0), rad, (1.2, 1.0, 0.7), seed=int(cx * 7) % 97, parts=fangs)
    bm = bmesh.new()
    for i in range(6):
        a_ = r.uniform(0, 2 * math.pi)
        p_ = V((cx + math.cos(a_) * rad * 0.8, cy + math.sin(a_) * rad * 0.7, ZR + r.uniform(0.2, 1.1)))
        K.cyl_bm(bm, p_, p_ + V((math.cos(a_) * -0.5, math.sin(a_) * -0.5, r.uniform(-0.3, 0.4))), 0.014, 4, caps=False)
    K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.6, 0.42, 0.3), grime=0, bisect=False, lod='drop')
    M.rubble((cx + rad * 0.9, cy - rad * 0.4, ZR), 1.2, 0.5, mids=('concrete_bunker',), n=3, beams=0, tiles=None, footprint=False, pile=True)
    K.decal('soot', (cx, cy, ZR + 0.03), (0, 0, 1), rad * 3, rad * 2.6, up=(0, 1, 0), alpha=0.6)
    M.DECAL_RIM = 0.55
    ry_ = min(RIBY, key=lambda q: abs(q - cy))                 # scorch + spall fan on the neighbouring rib tops
    for dy in (-3.3, 0.0, 3.3):
        K.decal(r.choice(['soot', 'dirt_splash']), (cx + r.uniform(-0.8, 0.8), ry_ + dy, ZR + 1.3 + 0.03), (0, 0, 1), rad * 2.4, 1.3, up=(0, 1, 0), alpha=0.8)
bm = bmesh.new()                                           # R4: exposed rib ends - blast-broken at the roof edge, rebar
for sx, idx in ((-1, 5), (-1, 16), (1, 9), (1, 21)):
    ry_ = RIBY[idx]
    ex = X0 + 0.4 if sx < 0 else X1 - 0.4
    K.bite((ex - sx * 0.2, ry_, ZR + 1.05), 0.95, (1.3, 0.9, 0.8), seed=60 + idx, parts=fangs)
    for i in range(2 if VAR == 'snow' else 5):
        p_ = V((ex - sx * r.uniform(0.6, 1.1), ry_ + r.uniform(-0.55, 0.55), ZR + r.uniform(0.3, 1.1)))
        K.cyl_bm(bm, p_, p_ + V((sx * r.uniform(0.4, 0.9), r.uniform(-0.2, 0.2), r.uniform(-0.35, 0.15))), 0.014, 4, caps=False)
K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.55, 0.38, 0.26), grime=0, bisect=False, lod='drop')
M.DECAL_RIM = 0.0
for i in range(16):
    K.decal(r.choice(['stain_blotch', 'moss_patch', 'lichen']), (r.uniform(X0 + 1, X1 - 1), r.uniform(Y0 + 1, Y1 - 1), ZR + 0.01), (0, 0, 1),
            r.uniform(2.0, 5.0), r.uniform(1.5, 3.0), up=(0, 1, 0), alpha=0.4)
for i in range(18):                                        # long rain / rust runs down the 13 m walls
    yv = r.uniform(Y0 + 1, Y1 - 1)
    for sx, x in ((-1, X0 - 0.004), (1, X1 + 0.004)):
        if sx > 0 and SY0 - 1 < yv < SY1 + 1:
            continue
        K.decal(r.choice(['streak_long', 'streak_rust', 'streak_long']), (x, yv, ZW - 3.2), (sx, 0, 0), r.uniform(1.6, 3.2), 6.0, alpha=0.75)

# ------------------------------------------------------------------ rework 2: roof life (tar patches, puddles, moss, debris,
# cable runs, MG nests, camouflage nets on the ribs) - breaks the stripe field seen at the game camera
from mathutils import noise as NZ
def rib_top(y):
    return any(abs(y - ry) < 0.7 for ry in RIBY)
bm = bmesh.new()                                          # bitumen repair patches on rib tops + trough floors
for i in range(38):
    ry = r.choice(RIBY)
    top = r.random() < 0.75
    cx, cy = r.uniform(X0 + 2, X1 - 2), (ry if top else ry + 1.65)
    w, h = r.uniform(1.2, 4.0), (r.uniform(0.6, 1.25) if top else r.uniform(0.8, 1.7))
    z = (ZR + 1.3 + 0.012) if top else (ZR + 0.012)
    pts = [(cx + math.cos(a) * w / 2 * r.uniform(0.75, 1.0), cy + math.sin(a) * h / 2 * r.uniform(0.75, 1.0)) for a in [2 * math.pi * k / 7 for k in range(7)]]
    if any(math.hypot(px - fx, py - fy) < 4.6 for px, py in pts for fx, fy in FLAK):
        continue
    f = bm.faces.new([bm.verts.new((px, py, z)) for px, py in K.ccw(pts)])
if VAR == 'snow':
    bm.free()
else:
    K.part(bm, 'bitumen_felt', name='tar_patches', mat_tint=(0.36, 0.36, 0.35), grime=0.2, bisect=False, lod='drop')
if VAR != 'snow':
    for i in range(18):                                   # standing water + moss / weeds colonising the troughs
        ry = r.choice(RIBY[:-1]) + 1.65
        K.decal(r.choice(['stain_blotch', 'moss_patch', 'moss_patch', 'damp_base']), (r.uniform(X0 + 2, X1 - 2), ry, ZR + 0.02 + i * 0.0005), (0, 0, 1),
                r.uniform(2.0, 5.5), r.uniform(1.2, 1.8), up=(0, 1, 0), alpha=r.uniform(0.55, 0.85))
    M.DECAL_RIM = 0.55
    for i in range(44):                                   # R4: strong moss / lichen / puddle / dirt on the rib tops
        ry = r.choice(RIBY)
        K.decal(r.choice(['lichen', 'stain_blotch', 'dirt_splash', 'moss_patch', 'damp_base', 'moss_patch']), (r.uniform(X0 + 2, X1 - 2), ry, ZR + 1.3 + 0.02 + i * 0.0003), (0, 0, 1),
                r.uniform(2.5, 7.0), 1.34, up=(0, 1, 0), alpha=r.uniform(0.85, 1.0))
for i in range(22 if VAR == 'snow' else 40):              # R4: rib faces seen by the game camera: runs, efflorescence, cracks, moss foot
    ry = r.choice(RIBY)
    kind = r.choice(['streak_rain', 'streak_long', 'efflorescence', 'crack', 'moss_patch', 'streak_rust'])
    if VAR == 'snow' and kind == 'moss_patch':
        kind = 'streak_long'
    M.DECAL_RIM = 0.55
    K.decal(kind, (r.uniform(X0 + 2, X1 - 2), ry - 0.7 - 0.004, ZR + 0.62), (0, -1, 0), r.uniform(1.2, 3.8), 1.28, alpha=r.uniform(0.65, 0.9))
M.DECAL_RIM = 0.0
for cx, cy in (() if VAR == 'snow' else ((4.0, -24.0), (-8.0, 26.0), (15.0, -14.0))):  # (buried under snow in the snow variant) spalled concrete debris lying in the troughs
    cy = min(RIBY, key=lambda ry: abs(ry - cy)) + 1.65
    M.rubble((cx, cy, ZR), 0.9, 0.4, mids=('concrete_bunker',), n=2, beams=0, tiles=None, footprint=False, mound_tint=(0.75, 0.75, 0.74), pile=True)
bm = bmesh.new()                                          # cable runs (field telephone / power) looping over the ribs
for x0c, y0c, y1c in ((X0 + 2.2, -38.0, 34.0),):
    pts = []
    for ry in RIBY:
        if y0c < ry < y1c:
            for dy, z in ((-0.85, ZR + 0.05), (-0.7, ZR + 1.34), (0.7, ZR + 1.34), (0.85, ZR + 0.05)):
                pts.append(V((x0c + 0.2 * math.sin(ry), ry + dy, z)))
    for a_, b_ in zip(pts[:-1], pts[1:]):
        K.cyl_bm(bm, a_, b_, 0.03, 3, caps=False)
if VAR == 'snow':                                         # cables buried under the snow
    bm.free()
else:
    K.part(bm, 'cast_iron', name='cables', mat_tint=(0.35, 0.35, 0.33), grime=0, bisect=False, lod='drop')
bm = bmesh.new()                                          # 2 MG ringstands (Tobruk-type concrete collars) at the seaward corners
MGS = ((X0 + 3.0, Y0 + 3.0), (X1 - 3.2, Y0 + 5.3), (-3.0, -33.0), (6.0, 29.0))   # R4: + 2 inland AA/MG posts
for cx, cy in MGS:
    cy = min(RIBY, key=lambda ry: abs(ry - cy))
    ring = [(math.cos(2 * math.pi * i / 14), math.sin(2 * math.pi * i / 14)) for i in range(14)]
    o0 = [V((cx + c * 1.3, cy + s_ * 1.3, ZR + 1.28)) for c, s_ in ring]
    o1 = [V((cx + c * 1.3, cy + s_ * 1.3, ZR + 2.1)) for c, s_ in ring]
    i1 = [V((cx + c * 0.95, cy + s_ * 0.95, ZR + 2.1)) for c, s_ in ring]
    i0 = [V((cx + c * 0.95, cy + s_ * 0.95, ZR + 1.3)) for c, s_ in ring]
    K.loft_bm(bm, [o0, o1, i1, i0], close_start=False, close_end=False)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'mg_stands', 'concrete_board', CT, bisect=False)
for k, (cx, cy) in enumerate(MGS):
    cy = min(RIBY, key=lambda ry: abs(ry - cy))
    M.mg34((cx, cy, ZR + 1.85), yaw=math.pi + (0.4 if k else -0.4), name='roof_mg')
bm = bmesh.new()                                          # ammunition boxes / ready racks by the Flak stands
for fx, fy in FLAK:
    for k in range(4):
        a = r.uniform(0, 2 * math.pi)
        K.box_bm(bm, (fx + math.cos(a) * 3.1, fy + math.sin(a) * 3.1 * 0.2 + (4.3 if k % 2 else -4.3), ZR + 1.3 + 0.15), (0.7, 0.35, 0.3), r.uniform(0, 3))
K.part(bm, 'wood_paint', name='ammo_boxes', mat_tint=(0.5, 0.55, 0.4), grime=0.6, bisect=False, lod='drop')
if VAR != 'snow':                                         # camouflage nets stretched over the ribs by two ringstands
    for (fx, fy), (w, h) in ((FLAK[2], (9.0, 8.0)), (FLAK[1], (10.0, 7.0))):
        sup = lambda x, y: ZR + 1.3 if rib_top(y) else ZR + 0.95
        M.camo_net(fx - w / 2 - 4.0, fy - h / 2, fx - 4.0 + w / 2, fy + h / 2, sup, cell=0.6, drop=lambda x, y: ZR + 1.32,
                   tint=(0.5, 0.52, 0.42), sag=0.15, garnish=0.22)
    for nx0, ny0, nx1, ny1 in ((-18.6, -26.0, -13.0, -20.5), (13.5, 22.5, 18.6, 27.5)):     # R4: torn net remnants on the ribs
        M.camo_net(nx0, ny0, nx1, ny1, lambda x, y: ZR + 1.3 if rib_top(y) else ZR + 0.7, cell=0.6, holes=2.6,
                   drop=lambda x, y: ZR + 0.25, tint=(0.5, 0.52, 0.42), sag=0.3, garnish=0.12, name='net_remnant')

# ------------------------------------------------------------------ rework 2: long-wall rhythm: pilasters every bay, vent hoods,
# personnel doors behind blast baffles, melt / rain streaking; pen interiors read as concrete (not black voids)
bm = bmesh.new()
for x, yv, sx in HOODS:
    K.box_bm(bm, (x, yv, 8.75), (0.6, 3.1, 0.22))
for sx, x in ((-1, X0), (1, X1)):
    for k in range(10):
        yv = Y0 + 1.25 + k * 9.5
        if sx > 0 and SY0 - 2.5 < yv < SY1 + 2.5:
            continue
        K.hexa_bm(bm, [V((x, yv - 0.8, ZB)), V((x, yv + 0.8, ZB)), V((x + sx * 0.7, yv + 0.8, ZB)), V((x + sx * 0.7, yv - 0.8, ZB)),
                       V((x, yv - 0.8, ZW - 0.6)), V((x, yv + 0.8, ZW - 0.6)), V((x + sx * 0.12, yv + 0.8, ZW - 0.1)), V((x + sx * 0.12, yv - 0.8, ZW - 0.1))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'pilasters', 'concrete_board', CT, bisect=False)
bm, bd, bk = bmesh.new(), bmesh.new(), bmesh.new()
for sx, x in ((-1, X0), (1, X1)):
    for yv in ((-20.0, 14.0) if sx < 0 else (-26.0, 2.0)):
        K.box_bm(bd, (x + sx * 0.01, yv, 1.05), (0.03, 1.3, 2.1))                   # steel door leaf (dark grey)
        K.box_bm(bk, (x + sx * 0.03, yv, 2.2), (0.08, 1.6, 0.14))                   # angle-iron frame head
        for dy in (-0.72, 0.72):
            K.box_bm(bk, (x + sx * 0.03, yv + dy, 1.1), (0.08, 0.14, 2.2))
        M.wall_strip(bm, [(x + sx * 1.6, yv - 2.6), (x + sx * 1.6, yv + 1.2), (x + sx * 0.2, yv + 1.2)], lambda s_: 2.4, 0.6, sx, step=5.0)
        K.footprint([(x, yv + 1.2), (x + sx * 2.2, yv + 1.2), (x + sx * 2.2, yv - 2.6), (x + sx * 1.6, yv - 2.6)], 'HIGH', 'blast_baffle')
M.conc_part(bm, 'door_baffles', 'concrete_board', CT, bisect=False)
K.part(bd, 'steel_painted', name='side_doors', mat_tint=(0.42, 0.44, 0.42), grime=0.8, bisect=False)
K.part(bk, 'cast_iron', name='side_door_frames', grime=0.5, bisect=False)
for i in range(16):                                        # extra rust / rain runs from the roof lip, varied widths
    yv = r.uniform(Y0 + 1, Y1 - 1)
    for sx, x in ((-1, X0 - 0.405), (1, X1 + 0.405)):
        if sx > 0 and SY0 - 1 < yv < SY1 + 1:
            continue
        K.decal(r.choice(['streak_rust', 'streak_long', 'efflorescence']), (x, yv, ZR - 2.0), (sx, 0, 0), r.uniform(1.0, 2.6), 3.2, alpha=0.7)
bm = bmesh.new()                                           # pen soffit + back wall + inner quay walls: dim concrete, not void
for (a, b) in PENS:
    K.box_bm(bm, ((a + b) / 2, (Y0 + YW) / 2, ZO - 0.12), (b - a - 0.02, YW - Y0, 0.06))
K.part(bm, 'concrete_slab', name='pen_soffit', mat_tint=(0.42, 0.42, 0.41), grime=0.3, bisect=False)
bm = bmesh.new()
for (a, b) in PENS:
    for k in range(5):                                     # soffit lamps (dim, gives scale and depth)
        K.box_bm(bm, ((a + b) / 2, Y0 + 6 + k * 14, ZO - 0.25), (0.5, 0.5, 0.2))
K.part(bm, 'steel_painted', name='pen_lamps', mat_tint=(0.9, 0.85, 0.6), grime=0, bisect=False, lod='drop')
if VAR == 'snow':                                          # drifts: every trough its own fill (none / partial / full, wind-scalloped)
    bm = bmesh.new()
    for ry in RIBY[:-1]:
        kind = r.random()
        if kind < 0.25:
            continue
        h0 = r.uniform(0.25, 0.55) if kind < 0.7 else r.uniform(0.7, 1.15)
        sd = r.uniform(0, 50)
        xs_ = [X0 + 0.6 + (X1 - X0 - 1.2) * i / 12 for i in range(13)]
        rows = []
        for x in xs_:
            hz = max(0.02, h0 * (0.55 + 0.6 * NZ.noise(V((x * 0.12 + sd, ry * 0.1, 1.3)))))
            if any(math.hypot(x - fx, ry + 1.65 - fy) < 4.4 for fx, fy in FLAK):
                hz = 0.02
            yl, yr = ry + 0.72, ry + 3.3 - 0.72
            rows.append([bm.verts.new((x, yl - 0.02, ZR + hz * 0.95)), bm.verts.new((x, (yl + yr) / 2 + 0.25 * NZ.noise(V((x * 0.3, sd, 2.0))), ZR + hz)),
                         bm.verts.new((x, yr + 0.02, ZR + hz * 0.8))])
        for a_, b_ in zip(rows[:-1], rows[1:]):
            for k in range(2):
                bm.faces.new((a_[k], b_[k], b_[k + 1], a_[k + 1]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'snow', name='trough_drifts', grime=0, smooth=True, bisect=False)
    bm = bmesh.new()                                       # icicles under the roof lip, apron lip and vent hoods
    for sx, x in ((-1, X0 - 0.4), (1, X1 + 0.4)):
        yv = Y0
        while yv < Y1:
            yv += r.uniform(1.2, 4.0)
            if sx > 0 and SY0 - 1 < yv < SY1 + 1:
                continue
            L = r.uniform(0.25, 1.1)
            K.cyl_bm(bm, (x - sx * 0.05, yv, ZW - 0.02), (x - sx * 0.05, yv, ZW - 0.02 - L), 0.06 + L * 0.04, 3, r1=0.005, caps=False)
    for i in range(26):
        xv = r.uniform(X0 + 1.2, PENS[1][1] + 1.3)
        L = r.uniform(0.3, 1.4)
        K.cyl_bm(bm, (xv, Y0 - 6.95, ZW + 0.58), (xv, Y0 - 6.95, ZW + 0.58 - L), 0.07 + L * 0.03, 3, r1=0.005, caps=False)
    K.part(bm, 'snow', name='icicles', mat_tint=(0.9, 0.95, 1.0), grime=0, smooth=True, bisect=False, lod='drop')
    for i in range(20):                                    # melt-water staining under the icicle lines
        yv = r.uniform(Y0 + 1, Y1 - 1)
        for sx, x in ((-1, X0 - 0.406), (1, X1 + 0.406)):
            if sx > 0 and SY0 - 1 < yv < SY1 + 1:
                continue
            K.decal(r.choice(['streak_long', 'damp_base', 'streak_rain']), (x, yv, ZW - 2.4), (sx, 0, 0), r.uniform(1.2, 3.0), 4.0, alpha=0.75)

# ------------------------------------------------------------------ R4: long walls - formwork lift bands, downpipes, service
# pipes, a second (west) stair tower; murky water body in the basins / harbour front (the review 'front' view looked through
# edge-on water onto grass pit walls -> 'stilts over grass')
LIFTS = [0.0, 1.7, 3.3, 5.2, 6.9, 8.5]
WX0, WX1, WY0, WY1 = X0 - 4.2, X0, 0.8, 5.8
def lift_bands(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for z in LIFTS[1:]:
        for zz in (z, z - 0.07):
            g = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=g, plane_co=(0, 0, zz), plane_no=(0, 0, 1))
    for k in range(10):
        g = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=g, plane_co=(0, Y0 + 1.25 + k * 9.5 + r.uniform(-2.5, 2.5), 0), plane_no=(0, 1, 0))
    cl = bm.loops.layers.color.get('Col')
    import random as _r
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(f.normal.z) > 0.5 or c.z < 0.0:
            continue
        li = sum(1 for z in LIFTS if c.z > z)
        joint = any(z - 0.07 < c.z < z for z in LIFTS[1:])
        bi = int((c.y - Y0) // 9.5)
        rr = _r.Random(li * 131 + bi * 17 + (1 if c.x > 0 else 0) * 7 + (3 if abs(f.normal.y) > 0.5 else 0))
        k = 0.62 if joint else rr.uniform(0.84, 1.08)
        warm = rr.uniform(-0.03, 0.03)
        for l in f.loops:
            c0 = l[cl]
            l[cl] = (min(1, c0[0] * k * (1 + warm)), min(1, c0[1] * k), min(1, c0[2] * k * (1 - warm)), c0[3])
    bm.to_mesh(o.data)
    bm.free()
for sx, x in ((-1, X0 - 0.004), (1, X1 + 0.004)):           # formwork lift lines: long dark joint bands, varied per bay
    for z in LIFTS[1:]:
        yv = Y0 + r.uniform(0.5, 4.0)
        while yv < Y1 - 3.0:
            L = r.uniform(4.0, 11.0)
            if not ((sx > 0 and SY0 - 1.5 < yv + L / 2 < SY1 + 1.5) or (sx < 0 and WY0 - 1.5 < yv + L / 2 < WY1 + 1.5)):
                K.decal('waterline', (x, min(yv + L / 2, Y1 - 1.0), z + r.uniform(-0.06, 0.06)), (sx, 0, 0), L, 0.35, alpha=r.uniform(0.3, 0.55))
            yv += L + r.uniform(2.0, 9.0)
    for k in range(6):
        K.decal('stain_blotch', (x, r.uniform(Y0 + 4, Y1 - 4), r.uniform(1.5, 7.5)), (sx, 0, 0), r.uniform(5, 10), r.uniform(2.5, 4.5), alpha=0.35)
bm = bmesh.new()
M.chamfer_block(bm, WX0, WY0, WX1 + 0.3, WY1, -0.08, ZR + 2.6, ch=0.12, top_ch=True)
wt = M.conc_part(bm, 'stair_tower_w', 'concrete_board', CT)
K.cut_object(wt, M.cutter_box(WX0 + 1.5, WY0 - 1, 0.0, WX0 + 2.7, WY0 + 0.5, 2.2))
for k in range(3):
    K.cut_object(wt, M.cutter_box(WX0 - 1, WY0 + 2.3, 3.5 + k * 4, WX0 + 0.5, WY0 + 2.5, 4.6 + k * 4))
bm = bmesh.new()
K.box_bm(bm, (WX0 + 2.1, WY0 + 0.5, 1.1), (1.2, 0.04, 2.2))
K.part(bm, 'interior_dark', name='stair_dark', grime=0, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (WX0 + 2.1, WY0 - 0.02, 1.1), (1.14, 0.05, 2.16))
K.part(bm, 'steel_painted', name='door_wstair', mat_tint=(0.4, 0.42, 0.4), grime=0.8, bisect=False)
K.door_meta('stair_w', (WX0 + 2.1, WY0, 0.0), (0, -1, 0), 1.2, 2.2, kind='doorway', node=None)
K.ladder_meta((WX0 + 2.1, WY0 - 0.8), (X0 + 1.0, WY0 + 2.5), ZR)
K.footprint([(WX0, WY0), (WX1, WY0), (WX1, WY1), (WX0, WY1)], 'HIGH', 'stair_tower')
bm = bmesh.new()                                           # downpipes (hopper + shoe) beside every other pilaster, service pipes
for sx, x in ((-1, X0), (1, X1)):
    for k in range(0, 10, 2):
        yv = Y0 + 1.25 + k * 9.5 + 1.15
        if (sx > 0 and SY0 - 2 < yv < SY1 + 2) or (sx < 0 and WY0 - 1.5 < yv < WY1 + 1.5):
            continue
        px = x + sx * 0.16
        K.box_bm(bm, (px, yv, ZW - 0.35), (0.34, 0.42, 0.4))
        K.cyl_bm(bm, (px, yv, ZW - 0.55), (px, yv, 0.35), 0.085, 6, caps=False)
        K.cyl_bm(bm, (px, yv, 0.35), (px + sx * 0.35, yv, 0.08), 0.085, 6, caps=False)
    zp = 3.1 if sx < 0 else 3.6
    ys = [Y0 + 1.5, Y1 - 1.5] if sx < 0 else [Y0 + 1.5, SY0 - 1.0]
    for ya, yb in ((ys[0], WY0 - 0.2), (WY1 + 0.2, ys[1])) if sx < 0 else ((ys[0], ys[1]),):
        K.cyl_bm(bm, (x + sx * 0.5, ya, zp), (x + sx * 0.5, yb, zp), 0.11, 6, caps=False)
    for k in range(10):
        yv = Y0 + 1.25 + k * 9.5
        K.box_bm(bm, (x + sx * 0.45, yv, zp - 0.14), (0.3, 0.12, 0.08))
K.part(bm, 'cast_iron', name='pipes', mat_tint=(0.55, 0.46, 0.4), grime=0.7, bisect=False)
bm = bmesh.new()                                           # murky water body (top 3 cm under the water plane)
for (a, b) in PENS:
    K.box_bm(bm, ((a + b) / 2, (Y0 - 0.3 + YW) / 2, (ZB + WATER - 0.03) / 2), (b - a - 2 * QW - 0.02, YW - Y0 + 0.3, WATER - 0.03 - ZB))
K.part(bm, 'water_flow', name='water_body', mat_tint=(0.12, 0.16, 0.15), grime=0, bisect=False, lod='drop')

# ------------------------------------------------------------------ gameplay metadata
K.footprint([(X0, Y0), (PENS[0][0], Y0), (PENS[0][0], Y1), (X0, Y1)], 'HIGH', 'pen_wall')
K.footprint([(PENS[0][1], Y0), (PENS[1][0], Y0), (PENS[1][0], YW), (PENS[0][1], YW)], 'HIGH', 'pen_wall')
K.footprint([(PENS[1][1], Y0), (X1, Y0), (X1, Y1), (PENS[1][1], Y1)], 'HIGH', 'workshop')
K.footprint([(PENS[0][0], Y1 - 3), (PENS[1][1], Y1 - 3), (PENS[1][1], Y1), (PENS[0][0], Y1)], 'HIGH', 'rear_wall')
K.footprint([(SX0, SY0), (SX1, SY0), (SX1, SY1), (SX0, SY1)], 'HIGH', 'stair_tower')
for xa, xb in ((X0 + 1.0, PENS[0][0]), (PENS[0][1], PENS[1][0]), (PENS[1][1], PENS[1][1] + 1.5)):
    K.footprint([(xa, Y0 - 6.8), (xb, Y0 - 6.8), (xb, Y0 - 4.6), (xa, Y0 - 4.6)], 'HIGH', 'apron_pier')
basins = []
for (a, b) in PENS:
    q = [(a + QW, Y0), (b - QW, Y0), (b - QW, YW), (a + QW, YW)]
    K.footprint(q, 'NONE', 'water_basin')
    basins.append([K.g2(p) for p in q])
    for x0q, x1q in ((a, a + QW), (b - QW, b)):
        K.footprint([(x0q, Y0), (x1q, Y0), (x1q, YW), (x0q, YW)], 'NONE', 'quay')
    K.anchor('berth', ((a + b) / 2, (Y0 + YW) / 2, WATER), (0, -1, 0), kind='uboat_berth', length=70.0)
K.footprint([(PENS[0][0], YW), (PENS[1][1], YW), (PENS[1][1], Y1 - 3), (PENS[0][0], Y1 - 3)], 'NONE', 'hall_floor')
K.A().meta['water_basins'] = basins
K.A().meta['water_level'] = WATER
K.A().meta['review_water'] = {'level': WATER, 'bed': ZB, 'rects': [[-80, 36.0, 80, 120]] + [[a + QW, -YW, b - QW, -Y0 + 0.5] for a, b in PENS]}
K.roof_meta([(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)], ZR + 1.3, walkable=True, kind='fangrost_roof')
K.roof_meta([(X0 + 1, Y0 - 7), (PENS[1][1] + 1.5, Y0 - 7), (PENS[1][1] + 1.5, Y0), (X0 + 1, Y0)], ZR - 0.4, walkable=True, kind='apron_roof')
if VAR == 'snow':
    K.snow_pass(thick=0.12, min_area=2.2, min_nz=0.7)
M.finalize(M.outdir(K.A().name), ao_res=1536, ao_samples=40, recenter=False)
