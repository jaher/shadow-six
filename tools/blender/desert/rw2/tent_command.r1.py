"""Tented command post (M9 'command post', M10/M11 camps): large DAK HQ ridge tent (sand/khaki duck canvas sagging
between ridge poles, 1.5 m walls, rolled-up side flaps, tied-back door flaps, guy ropes to iron pegs), front fly
on two poles over a map table with folding chairs, field radio with a guyed telescopic mast, field telephone,
ammo/ration crates, jerrycans, drums, U-shaped sandbag wall, command sign. destroyed: burnt-out tent (charred
canvas remnants, broken/leaning poles), fallen mast, scattered crates, scorch marks.
Usage: blender -b --python tent_command.py -- outdir [intact|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'intact'
DEST = VAR == 'destroyed'
SEED = int(av[2]) if len(av) > 2 else 91
K.begin('tent_command' + ('_destroyed' if DEST else ''), SEED, theater='desert')
r = K.rng()
from mathutils import noise
LT, WT, HW, HR = 6.4, 4.6, 1.55, 3.05       # tent length (x), width (y), wall height, ridge height
CAN = (0.93, 0.86, 0.68)                    # sand-khaki duck
CHAR = (0.22, 0.2, 0.18)
X0, Y0 = 0.0, 1.0                           # tent centre


PROF = []                                   # (y, z, kind) across the tent: wall, roof slope, roof slope, wall
for j in range(4):
    PROF.append((-WT / 2 - 0.08 * (1 - j / 3) ** 2, HW * j / 3, 'w'))
for j in range(1, 7):
    t = j / 6
    PROF.append((-WT / 2 + WT / 2 * t, HW + (HR - HW) * t, 'r'))
for j in range(1, 6):
    t = j / 6
    PROF.append((WT / 2 * t, HR - (HR - HW) * t, 'r'))
for j in range(4):
    PROF.append((WT / 2 + 0.08 * (j / 3) ** 2, HW * (3 - j) / 3, 'w'))
NX = 24


def S(u, k):
    """Canvas point: u along the tent (0..1), k = profile index. Catenary sag of the roof between the three ridge
    uprights and between the guyed eave points, tension ridges toward the guy points, walls bellying out and
    pegged at the foot (sod cloth flare)."""
    y, z, kind = PROF[k]
    x = X0 - LT / 2 + LT * u
    span = math.sin(math.pi * ((u * 2) % 1.0))              # 0 at uprights, 1 mid-bay
    guy = math.sin(math.pi * ((u * 4) % 1.0))               # 0 at guy points
    p = V((x, Y0 + y, z))
    if kind == 'r':
        t = 1 - abs(z - HR) / (HR - HW)                     # 0 at eave, 1 at ridge
        p.z -= 0.09 * span * t + 0.13 * math.sin(math.pi * t) * (0.55 + 0.45 * span) + 0.03 * guy * (1 - t)
    else:
        f = math.sin(math.pi * min(1.0, z / HW))
        p.y += (-1 if y < 0 else 1) * (0.07 * f * (0.5 + 0.5 * guy))
        if z > HW - 0.01:
            p.z -= 0.035 * guy
    p += V((0, 0, 0.012 * noise.noise(V((x * 1.3, y * 1.3, z + SEED)))))
    if z < 0.01:
        p.z = 0.02
    return p


def tent_surface():
    rows = [[S(i / NX, k) for k in range(len(PROF))] for i in range(NX + 1)]
    bm = dz.bmesh.new()
    C.loft_bm(bm, rows, closed=False)
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ribbon(bm, pts, w, lift=0.012, axis=None):
    """Flat strip laid on the canvas along the polyline pts (seams, eave band)."""
    for a, b in zip(pts[:-1], pts[1:]):
        d = (b - a).normalized()
        s = V(axis) if axis else d.cross(V((0, 0, 1))).normalized()
        n = d.cross(s).normalized()
        if n.z < 0 and abs(n.z) > 0.2 or (abs(n.z) <= 0.2 and (a.y - Y0) * n.y < 0):
            n = -n
        q = [a - s * w / 2 + n * lift, b - s * w / 2 + n * lift, b + s * w / 2 + n * lift, a + s * w / 2 + n * lift]
        f = bm.faces.new([bm.verts.new(v) for v in q])
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()


def end_wall(x, sgn, door=True):
    """Gable end: canvas following the sagging end section; door = true opening (boolean) with flaps tied back."""
    u = 0.0 if sgn < 0 else 1.0
    ring = [S(u, k) for k in range(len(PROF))]
    bm = dz.bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ring])
    dz.bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    if door:
        fr = KA.Frame(V((x + sgn * 0.1, Y0, 0.0)), V((sgn, 0, 0)), V((0, -sgn, 0)), 1.3, 1.95, 0.35)
        bm = KA.boolean_cut(bm, [fr])
    dz.bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


CANM = 'canvas_camo'
# ---------------- tent body
bm = tent_surface()
if DEST:     # burnt: lower walls survive with ragged, charred tops; a few roof shreds hang from the sagging ridge
    for f in list(bm.faces):
        c = f.calc_center_median()
        if c.z > 0.45 + 0.9 * max(0.0, noise.noise(V((c.x * 0.9, c.y * 0.6, SEED)))) + 0.25 * (c.x > X0 + 1.5) or r.random() < 0.12:
            bm.faces.remove(f)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
dz.bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
ob = K.part(bm, CANM, name='tent_canvas', mat_tint=(0.95, 0.93, 0.9), bisect=False, grime=0.7, smooth=True)
if DEST:                   # char gradient: canvas darkens to black toward the burnt edge
    ca = ob.data.color_attributes.get('Col')
    for poly_ in ob.data.polygons:
        for li in poly_.loop_indices:
            z = ob.data.vertices[ob.data.loops[li].vertex_index].co.z
            k = min(1.0, max(0.0, (z - 0.15) / 0.9))
            c = list(ca.data[li].color)
            ca.data[li].color = (c[0] * (1 - 0.82 * k), c[1] * (1 - 0.84 * k), c[2] * (1 - 0.85 * k), c[3])
if not DEST:
    K.part(end_wall(X0 + LT / 2, 1, door=False), CANM, name='tent_end_e', mat_tint=(0.95, 0.93, 0.9))
    K.part(end_wall(X0 - LT / 2, -1, door=True), CANM, name='tent_end_w', mat_tint=(0.95, 0.93, 0.9))
    bm = dz.bmesh.new()      # seams (panel joins every ~1.1 m), eave reinforcement band, grommets at the guy points
    for i in range(1, 6):
        u = i / 6
        ribbon(bm, [S(u, k) for k in range(3, len(PROF) - 3)], 0.035, axis=(1, 0, 0))
    for side in (3, len(PROF) - 4):
        ribbon(bm, [S(i / NX, side) for i in range(NX + 1)], 0.1, lift=0.015)
    K.part(bm, 'canvas', name='seams', mat_tint=(0.72, 0.64, 0.48), grime=0.3, bisect=False, lod='drop')
    bm = dz.bmesh.new()
    for s in (3, len(PROF) - 4):
        for k in range(5):
            p = S(k / 4, s)
            n = V((0, -1 if p.y < Y0 else 1, 0))
            C.cyl_bm(bm, p + n * 0.01, p + n * 0.035, 0.035, 6)
    K.part(bm, 'steel_galv', name='grommets', grime=0.2, bisect=False, lod='drop')
    bm = dz.bmesh.new()      # tied-back door flaps (folded) + rolled side flaps
    for s in (-1, 1):
        a = V((X0 - LT / 2 - 0.02, Y0 + s * 0.65, 0.05))
        C.hexa_bm(bm, [a, a + V((0, s * 0.25, 0)), a + V((-0.06, s * 0.25, 0.02)), a + V((-0.06, 0, 0)),
                       a + V((0, 0, 1.9)), a + V((0, s * 0.1, 1.9)), a + V((-0.06, s * 0.1, 1.9)), a + V((-0.06, 0, 1.9))])
    for s in (-1, 1):
        C.cyl_bm(bm, (X0 - 0.8, Y0 + s * (WT / 2 + 0.1), 1.15), (X0 + 1.8, Y0 + s * (WT / 2 + 0.1), 1.15), 0.08, 8)
    K.part(bm, CANM, name='flaps', mat_tint=(0.9, 0.86, 0.8), smooth=True)
    # modelled interior seen through the door: inner canvas liner (lighter), duckboard floor, a cot, a chest
    bm = dz.bmesh.new()
    C.box_bm(bm, (X0, Y0, 0.72), (LT - 0.4, WT - 0.5, 1.36))
    for f in bm.faces:
        f.normal_flip()
    K.part(bm, 'canvas', name='liner', mat_tint=(0.85, 0.8, 0.66), grime=0.3, bisect=False, lod='drop')
    bm = dz.bmesh.new()
    for k in range(9):
        C.box_bm(bm, (X0 - LT / 2 + 0.4 + k * 0.18, Y0, 0.05), (0.12, 1.6, 0.04))
    C.box_bm(bm, (X0 - 1.6, Y0 + 1.4, 0.4), (1.9, 0.7, 0.08))
    C.box_bm(bm, (X0 - 1.2, Y0 - 1.5, 0.25), (0.8, 0.45, 0.5))
    K.part(bm, 'timber_grey', name='duckboards', uv='beam', axis=(0, 1, 0), bisect=False, lod='drop')
# poles (ridge uprights, wall corner poles, ridge pole) + ropes + pegs
bm = dz.bmesh.new()
ups = [X0 - LT / 2 - 0.03, X0, X0 + LT / 2 + 0.03]
for i, x in enumerate(ups):
    if DEST and i == 1:
        C.cyl_bm(bm, (x, Y0, 0), (x + 1.4, Y0 + 0.6, 2.2), 0.045, 6)       # leaning
        continue
    C.cyl_bm(bm, (x, Y0, 0), (x, Y0, HR + (0.25 if i != 1 else 0)), 0.045, 6)
if not DEST:
    C.cyl_bm(bm, (ups[0], Y0, HR - 0.05), (ups[2], Y0, HR - 0.05), 0.04, 6)
else:              # ridge pole snapped in the middle: both halves hang from the end uprights, splintered ends
    dz.broken_log(bm, (ups[0], Y0, HR - 0.05), (X0 - 0.1, Y0 + 0.3, 0.9), 0.04, 6)
    dz.broken_log(bm, (ups[2], Y0, HR - 0.05), (X0 + 0.3, Y0 - 0.2, 0.6), 0.04, 6)
for x in (X0 - LT / 2, X0 + LT / 2):
    for s in (-1, 1):
        C.cyl_bm(bm, (x, Y0 + s * WT / 2, 0), (x, Y0 + s * WT / 2, HW + 0.2), 0.03, 5)
K.part(bm, 'timber_beam', name='poles', uv='beam', axis=(0, 0, 1), mat_tint=(0.9, 0.8, 0.6) if not DEST else (0.3, 0.26, 0.22))
rb, pb = dz.bmesh.new(), dz.bmesh.new()
nr = 5
for s in (-1, 1):
    for k in range(nr):
        x = X0 - LT / 2 + LT * k / (nr - 1)
        top = V((x, Y0 + s * WT / 2, HW + 0.05))
        peg = V((x, Y0 + s * (WT / 2 + 1.5), 0.05))
        if not DEST or r.random() < 0.5:
            dz.rope(top, peg, 0.03, 0.01, 3, bm=rb)
        C.box_bm(pb, tuple(peg + V((0, 0, 0.06))), (0.04, 0.04, 0.2))
for x, dx in ((ups[0], -1), (ups[2], 1)):
    for s in (-0.6, 0.6):
        peg = V((x + dx * 2.0, Y0 + s, 0.05))
        if not DEST:
            dz.rope(V((x, Y0, HR + 0.2)), peg, 0.05, 0.01, 4, bm=rb)
        C.box_bm(pb, tuple(peg + V((0, 0, 0.06))), (0.04, 0.04, 0.2))
K.part(rb, 'hessian', name='guy_ropes', grime=0, bisect=False, mat_tint=(0.85, 0.8, 0.7))
K.part(pb, 'cast_iron', name='pegs', grime=0.2)
K.footprint([(X0 - LT / 2, Y0 - WT / 2), (X0 + LT / 2, Y0 - WT / 2), (X0 + LT / 2, Y0 + WT / 2), (X0 - LT / 2, Y0 + WT / 2)],
            'HIGH' if not DEST else 'LOW', 'tent')
if not DEST:
    C.door_meta('tent', (X0 - LT / 2, Y0, 0), (-1, 0, 0), 1.3, 1.9, kind='tent', node=None)
# ---------------- front fly over the map table (west side), on two poles
FX = X0 - LT / 2 - 2.6
if not DEST:
    bm = dz.bmesh.new()
    rows = []
    for i in range(5):
        u = i / 4
        x = X0 - LT / 2 - 0.05 + (FX - (X0 - LT / 2 - 0.05)) * u
        z = (HR - 0.35) + (2.15 - (HR - 0.35)) * u
        rows.append([V((x, Y0 + y, z - 0.07 * math.sin(math.pi * u) * math.cos(y / 1.8 * 1.57))) for y in (-1.7, -0.85, 0, 0.85, 1.7)])
    C.loft_bm(bm, rows, closed=False)
    dz.bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    K.part(bm, 'canvas', name='fly', mat_tint=(0.88, 0.8, 0.62))
    bm = dz.bmesh.new()
    for s in (-1, 1):
        C.cyl_bm(bm, (FX, Y0 + s * 1.7, 0), (FX, Y0 + s * 1.7, 2.3), 0.035, 6)
    K.part(bm, 'timber_beam', name='fly_poles', uv='beam', axis=(0, 0, 1), mat_tint=(0.9, 0.8, 0.6))
    rb = dz.bmesh.new()
    for s in (-1, 1):
        dz.rope(V((FX, Y0 + s * 1.7, 2.25)), V((FX - 1.4, Y0 + s * 2.6, 0.05)), 0.03, 0.01, 3, bm=rb)
    K.part(rb, 'hessian', name='fly_ropes', grime=0, bisect=False)
    K.roof_meta([(FX, Y0 - 1.7), (X0 - LT / 2, Y0 - 1.7), (X0 - LT / 2, Y0 + 1.7), (FX, Y0 + 1.7)], 2.2, walkable=False, kind='canvas')
# ---------------- command post furniture under the fly
TX, TY = X0 - LT / 2 - 1.35, Y0
bm, bw_ = dz.bmesh.new(), dz.bmesh.new()
if not DEST:
    C.box_bm(bw_, (TX, TY, 0.74), (0.9, 1.8, 0.04))                       # trestle map table
    for sx in (-1, 1):
        for sy in (-1, 1):
            C.beam_bm(bw_, (TX + sx * 0.38, TY + sy * 0.8, 0), (TX + sx * 0.3, TY + sy * 0.8, 0.72), 0.04, 0.04)
    for k, (cx, cy, a) in enumerate(((TX - 0.75, TY - 0.4, 0.2), (TX - 0.75, TY + 0.5, -0.1), (TX + 0.7, TY, 3.0))):
        R = dz.Matrix.Rotation(a, 3, 'Z')     # folding chairs
        P = lambda x, y, z: V((cx, cy, 0)) + R @ V((x, y, z))
        C.box_bm(bw_, tuple(P(0, 0, 0.45)), (0.42, 0.4, 0.03), a)
        C.box_bm(bw_, tuple(P(-0.2, 0, 0.72)), (0.03, 0.4, 0.3), a)
        for sx in (-1, 1):
            C.beam_bm(bw_, P(sx * 0.18, -0.18, 0), P(-sx * 0.18, -0.18, 0.44), 0.025, 0.025)
            C.beam_bm(bw_, P(sx * 0.18, 0.18, 0), P(-sx * 0.18, 0.18, 0.44), 0.025, 0.025)
    K.part(bw_, 'wood_paint', name='table_chairs', mat_tint=(0.62, 0.55, 0.42), uv='beam', axis=(1, 0, 0))
    bm = dz.bmesh.new()      # map sheet + message pads
    bm.faces.new([bm.verts.new(V((TX + x, TY + y, 0.765))) for x, y in ((-0.35, -0.6), (0.35, -0.6), (0.35, 0.55), (-0.35, 0.55))])
    K.part(bm, 'canvas', name='map', mat_tint=(1.0, 0.97, 0.88), grime=0, bisect=False)
    K.decal('stain_blotch', (TX, TY - 0.1, 0.77), (0, 0, 1), 0.5, 0.7, up=(1, 0, 0), alpha=0.35)
# radio set + field telephone + telescopic mast with guys (mast falls over when destroyed)
RX, RY = X0 + LT / 2 + 0.9, Y0 - 1.2
bm = dz.bmesh.new()
C.box_bm(bm, (RX, RY, 0.25), (0.8, 0.5, 0.5))
C.box_bm(bm, (RX, RY, 0.66), (0.55, 0.36, 0.32))
C.box_bm(bm, (RX - 0.2, RY + 0.5, 0.12), (0.25, 0.14, 0.24))
K.part(bm, 'steel_painted', name='radio', mat_tint=(0.6, 0.58, 0.44))
bm = dz.bmesh.new()
mast_top = V((RX + 0.5, RY - 0.4, 7.5)) if not DEST else V((RX + 6.0, RY - 2.5, 0.12))
C.cyl_bm(bm, (RX + 0.5, RY - 0.4, 0.0 if not DEST else 0.12), mast_top, 0.035, 6, r1=0.015)
if not DEST:
    for a in (0.3, 2.4, 4.5):
        dz.rope(V((RX + 0.5, RY - 0.4, 5.0)), V((RX + 0.5 + 3.2 * math.cos(a), RY - 0.4 + 3.2 * math.sin(a), 0.02)), 0.05, 0.006, 3, bm=bm)
K.part(bm, 'steel_galv', name='mast', grime=0.2)
K.part(dz.rope(V((RX + 0.3, RY, 0.8)), V((X0 + LT / 2, Y0 - 0.8, 0.02)), 0.0, 0.008, 3), 'cast_iron', name='cable', grime=0)
C.anchor('antenna_top', tuple(mast_top), (0, -1, 0))
# crates, jerrycans, drums, sandbags
bm, bj, bd = dz.bmesh.new(), dz.bmesh.new(), dz.bmesh.new()
cr = [(X0 + 1.2, Y0 + WT / 2 + 0.7, 0), (X0 + 2.1, Y0 + WT / 2 + 0.75, 0), (X0 + 1.6, Y0 + WT / 2 + 0.7, 0.55)]
if DEST:
    cr = [(X0 + 1.9 + r.uniform(-1, 1), Y0 + WT / 2 + 1.2 + r.uniform(-0.5, 0.5), 0) for _ in range(3)]
for c in cr:
    dz.crate(bm, c, (0.9, 0.55, 0.52), r.uniform(-0.2, 0.2) + (r.uniform(-1, 1) if DEST else 0))
K.part(bm, 'timber_grey', name='crates', uv='beam', axis=(1, 0, 0), mat_tint=(0.9, 0.85, 0.72))
for k in range(5):
    dz.jerrycan(bj, (X0 + LT / 2 + 0.35, Y0 + 0.6 + k * 0.2, 0), math.pi / 2)
K.part(bj, 'steel_painted', name='jerrycans', mat_tint=(0.55, 0.52, 0.38))
for k in range(2):
    dz.drum(bd, (X0 + LT / 2 + 0.6, Y0 + 1.9 + k * 0.65, 0))
dz.drum(bd, (X0 - 1.5, Y0 - WT / 2 - 1.0, 0.3), lying=True, axis=(1, 0.3, 0))
K.part(bd, 'steel_painted', name='drums', smooth=True, mat_tint=(0.5, 0.52, 0.4))
dz.sandbags((X0 - LT / 2 - 3.3, Y0 - 2.9), (X0 + LT / 2 + 1.8, Y0 - 2.9), 5, name='sb_s')
dz.sandbags((X0 + LT / 2 + 1.8, Y0 - 2.5), (X0 + LT / 2 + 1.8, Y0 + 2.6), 5, name='sb_e')
K.sign((X0 - LT / 2 - 3.2, Y0 - 2.6, 1.3), (-1, 0, 0), 0.9, 'kommandantur', board='timber_grey')
bm = dz.bmesh.new()
C.cyl_bm(bm, (X0 - LT / 2 - 3.2, Y0 - 2.6, 0), (X0 - LT / 2 - 3.2, Y0 - 2.6, 1.6), 0.04, 6)
K.part(bm, 'timber_beam', name='sign_post', uv='beam', axis=(0, 0, 1))
if DEST:
    # scorched ground gradient (big feathered soot + ash film), ash bed, burnt canvas shreds, charred furniture
    K.decal('soot', (X0, Y0, 0.03), (0, 0, 1), LT + 3.0, WT + 3.0, up=(0, 1, 0), alpha=0.75)
    K.decal('soot', (X0 + 0.4, Y0 - 0.3, 0.035), (0, 0, 1), LT * 0.8, WT * 0.8, up=(1, 0.3, 0), alpha=0.8)
    bm = dz.mound_bm((X0 + 0.2, Y0, 0), LT * 0.38, WT * 0.36, 0.12, SEED, 4, 16)
    K.part(bm, 'sand', name='ash', mat_tint=(0.36, 0.34, 0.32), smooth=True, grime=0.2, lod='keep')
    for k in range(9):         # shreds: drooping, curled canvas pieces with charred colour, lying on the ash
        a = r.uniform(0, math.pi)
        c = V((X0 + r.uniform(-LT * 0.4, LT * 0.4), Y0 + r.uniform(-WT * 0.35, WT * 0.35), 0.08))
        R = dz.Matrix.Rotation(a, 3, 'Z')
        w, l = r.uniform(0.5, 1.1), r.uniform(0.7, 1.6)
        bm = dz.bmesh.new()
        cur = r.uniform(0.1, 0.35)
        vv = [[bm.verts.new(c + R @ V(((i / 3 - 0.5) * l, (j / 2 - 0.5) * w * (1 - 0.3 * abs(i / 3 - 0.5)), cur * ((i / 3 - 0.5) * 2) ** 2 + 0.05 * math.sin(i * 2 + j))))
               for j in range(3)] for i in range(4)]
        for i in range(3):
            for j in range(2):
                bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
        dz.bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
        K.part(bm, CANM, name='shred%d' % k, mat_tint=(0.28, 0.25, 0.22) if k % 3 else (0.6, 0.55, 0.48), smooth=True, grime=0.3, lod='drop')
    for x in (ups[0], ups[2]):  # shreds still hanging from the end uprights
        bm = dz.bmesh.new()
        vv = [[bm.verts.new(V((x + (0.35 if x < X0 else -0.35) * j, Y0 + (i - 1) * 0.35, HR - 0.1 - 0.9 * j - 0.1 * (i % 2)))) for j in range(3)] for i in range(3)]
        for i in range(2):
            for j in range(2):
                bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
        dz.bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.01)
        K.part(bm, CANM, name='hang%d' % int(x), mat_tint=(0.25, 0.22, 0.2), smooth=True, grime=0.2, lod='drop')
    bm = dz.bmesh.new()        # burnt cots / table frame
    C.box_bm(bm, (X0 - 1.4, Y0 + 1.2, 0.3), (1.9, 0.7, 0.06), 0.3)
    C.box_bm(bm, (X0 + 1.5, Y0 - 0.9, 0.2), (1.2, 0.6, 0.05), -0.4)
    K.part(bm, 'timber_beam', name='burnt_frames', mat_tint=(0.2, 0.18, 0.16), bisect=False)
    K.footprint([(X0 - LT / 2, Y0 - WT / 2), (X0 + LT / 2, Y0 - WT / 2), (X0 + LT / 2, Y0 + WT / 2), (X0 - LT / 2, Y0 + WT / 2)], 'LOW', 'debris')
    C.A.meta['notes'].append('destroyed variant: burnt-out tent (charred wall stubs, snapped ridge, ash, shreds), walkable debris (LOW); radio mast down')
else:
    K.decal('dirt_splash', (X0 - LT / 2 - 1.2, Y0, 0.02), (0, 0, 1), 3.5, 3.0, up=(0, 1, 0), alpha=0.4)
K.anchor('objective', (X0, Y0, 1.0), (0, -1, 0), kind='command_post')
dz.finalize(OUT, ao_res=1024, ao_samples=48)
