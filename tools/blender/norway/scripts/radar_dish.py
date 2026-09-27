"""Wurzburg-Riese (FuSE 65) fire-control radar, M5 objective: 7.5 m paraboloid reflector with radial ribs, ring
beams and central feed rod, carried on a yoke over the rotating operator cabin, on a steel pedestal and an octagonal
concrete emplacement with ladder, railing and cable trench. Variants: a = intact (dish at 25 deg elevation, facing
SSW so the reflector shows to the camera), ad = destroyed (dish torn off the yoke and lying crumpled against the
emplacement, cabin blasted, burnt, debris). Usage: blender -b --python radar_dish.py -- outdir a|ad seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C
import bmesh
from mathutils import Matrix

OUT, VAR, SEED, SNOW = N.args('radar_dish')
DEST = VAR.endswith('d')
name = 'radar_dish_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
STEEL = 'steel_painted'
ST = (0.8, 0.81, 0.79)                     # light grey paint (RLM 02 / 63-ish)

# ---- emplacement --------------------------------------------------------------------------------------------
oct_ = [(4.2 * math.cos(math.pi / 8 + k * math.pi / 4), 4.2 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
bm = K.bm_new()
K.prism_bm(bm, oct_, -0.2, 0.45)
K.part(bm, 'concrete_board', name='emplacement')
K.footprint(oct_, 'LOW', 'emplacement')
K.roof_meta(oct_, 0.45, walkable=True, kind='platform')
for k in range(8):
    a, b = oct_[k], oct_[(k + 1) % 8]
    if k != 5:
        K.railing((a[0] * 0.97, a[1] * 0.97, 0.45), (b[0] * 0.97, b[1] * 0.97, 0.45), 1.0, 'pipe')
p0 = V((*oct_[5], 0)).lerp(V((*oct_[6], 0)), 0.5)
K.stairs((p0.x * 1.25, p0.y * 1.25, 0), (-p0.x, -p0.y, 0), 1.2, 0.45, 3, 'concrete_bunker', name='steps')

# ---- pedestal: cruciform outriggers with jack pads, turntable drum, rotating carriage ---------------------------
EL, AZ = math.radians(25), math.radians(-100)          # dish axis: elevation, azimuth (0 = +X); -100 = faces SSW
fwd = V((math.cos(AZ), math.sin(AZ), 0))
side = V((-fwd.y, fwd.x, 0))
bm = K.bm_new()
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    d = V((math.cos(a), math.sin(a), 0))
    K.beam_bm(bm, V((0, 0, 0.75)), d * 3.0 + V((0, 0, 0.62)), 0.35, 0.34)
    K.beam_bm(bm, d * 0.8 + V((0, 0, 0.95)), d * 2.6 + V((0, 0, 0.62)), 0.12, 0.3)          # gusset web
    K.cyl_bm(bm, d * 3.0 + V((0, 0, 0.45)), d * 3.0 + V((0, 0, 0.62)), 0.28, 10)            # jack pad
    K.cyl_bm(bm, d * 3.0 + V((0, 0, 0.62)), d * 3.0 + V((0, 0, 0.95)), 0.07, 8)             # jack screw
K.cyl_bm(bm, (0, 0, 0.45), (0, 0, 1.25), 1.0, 20, r1=0.9)
K.part(bm, STEEL, name='pedestal', mat_tint=(0.6, 0.62, 0.58))
bm = K.bm_new()
K.cyl_bm(bm, (0, 0, 1.25), (0, 0, 1.75), 1.45, 28)                                          # turntable drum
K.cyl_bm(bm, (0, 0, 1.75), (0, 0, 1.85), 1.6, 28)
K.part(bm, STEEL, name='turntable', mat_tint=ST, smooth=True)
PIV = V((0, 0, 6.2))
if not DEST:
    CAB_C = -fwd * 1.05 + V((0, 0, 1.85))
else:
    CAB_C = -fwd * 1.05 + V((0, 0, 1.85))
cabpoly = [tuple((CAB_C + fwd * x + side * y)[:2]) for x, y in ((-1.1, -1.2), (1.1, -1.2), (1.1, 1.2), (-1.1, 1.2))]
bm = K.bm_new()
K.box_bm(bm, (CAB_C.x, CAB_C.y, 1.85 + 1.05), (2.2, 2.4, 2.1), rot_z=AZ)
fr = K.opening(cabpoly, 0, 1.1, 1.4, 0.55, 3.0, 0.1)                                        # west window
door = K.opening(cabpoly, 2, 1.1, 0.75, 1.75, 1.9, 0.1, 'rect', 'door')
bm = K.boolean_cut(bm, [fr, door])
K.part(bm, STEEL, name='cabin', mat_tint=ST)
K.window(fr, 'fixed', (3, 1), frame=ST, recess=0.02, sill=None, curtain=0, streak=False, name='cabwin')
K.door(door, 'cabin', 'plank', (0.62, 0.64, 0.6), step=None)
bm = K.bm_new()
K.box_bm(bm, (CAB_C.x, CAB_C.y, 4.0), (2.35, 2.55, 0.1), rot_z=AZ)
for k in range(5):                                                                          # roof stiffeners
    p_ = CAB_C + side * (-1.0 + k * 0.5)
    K.box_bm(bm, (p_.x, p_.y, 4.08), (2.3, 0.06, 0.06), rot_z=AZ)
K.part(bm, STEEL, name='cabin_roof', mat_tint=(0.66, 0.68, 0.64))
bm = K.bm_new()                                                                             # railing platform + ladder
for k in range(6):
    p_ = CAB_C + side * (-1.25 + k * 0.5) - fwd * 1.15
    K.cyl_bm(bm, (p_.x, p_.y, 1.85), (p_.x, p_.y, 2.85), 0.025, 5)
a_, b_ = CAB_C + side * -1.25 - fwd * 1.15, CAB_C + side * 1.25 - fwd * 1.15
K.cyl_bm(bm, (a_.x, a_.y, 2.85), (b_.x, b_.y, 2.85), 0.03, 5)
K.part(bm, 'steel_galv', name='cab_rail', mat_tint=(0.6, 0.6, 0.58))
K.ladder((1.9, -1.6, 0.45), 1.4, (0.7, -0.7, 0), mid='steel_galv')
for sx in (-1, 1):                                                                          # cable reels on the drum
    p_ = side * sx * 1.2 + fwd * 0.6
    K.P('cast_iron', K.cyl_bm, (p_.x, p_.y, 1.9), (p_.x, p_.y, 2.2), 0.28, 12, name='reel%d' % (sx + 1))

D, F = 7.5, 2.4


def dish_surface(back=0.0, dent=0.0):
    """Paraboloid mesh skin (axis +X, concave side +X); back=offset for the rear skin (normals -X)."""
    bm = bmesh.new()
    R0 = D / 2
    nr, ns = 8, 48
    rings = []
    for i in range(nr + 1):
        rr = R0 * (0.06 + 0.94 * i / nr)
        ring = []
        for j in range(ns):
            a = 2 * math.pi * j / ns
            x = rr * rr / (4 * F) - back
            if dent:
                x += dent * max(0, math.cos(a - 0.6)) ** 3 * (rr / R0) ** 2 + r.uniform(-0.04, 0.04) * dent * (rr / R0)
            ring.append(bm.verts.new((x, rr * math.cos(a), rr * math.sin(a))))
        rings.append(ring)
    for i in range(nr):
        for j in range(ns):
            q = (rings[i + 1][j], rings[i + 1][(j + 1) % ns], rings[i][(j + 1) % ns], rings[i][j])
            bm.faces.new(q if not back else tuple(reversed(q)))
    return bm


def dish_frame(nrib=24, broken=0.0):
    """Radial rib lattice behind the mesh, rim ring tube (clean silhouette), two inner ring beams, hub."""
    bm = bmesh.new()
    R0 = D / 2
    for j in range(nrib):
        if broken and r.random() < broken:
            continue
        a = 2 * math.pi * j / nrib
        c, s_ = math.cos(a), math.sin(a)
        pts = []
        for i in range(6):
            rr = R0 * (0.08 + 0.92 * i / 5)
            x = rr * rr / (4 * F)
            depth = 0.55 * (1 - i / 5) + 0.08
            pts.append((V((x - 0.04, rr * c, rr * s_)), V((x - depth, rr * c, rr * s_))))
        for i in range(5):
            K.beam_bm(bm, pts[i][0], pts[i + 1][0], 0.05, 0.06)
            if j % 2 == 0:
                K.beam_bm(bm, pts[i][1], pts[i + 1][1], 0.05, 0.06)
                K.beam_bm(bm, pts[i][1], pts[i + 1][0], 0.025, 0.025)
    return bm


def dish_rim(broken=0.0):
    """Rim ring tube (clean round silhouette), inner ring beams and hub - kept in every LOD."""
    bm = bmesh.new()
    R0 = D / 2
    for rr, dx in ((R0, 0.0), (R0 * 0.62, 0.12), (R0 * 0.3, 0.2)):
        x = rr * rr / (4 * F) - dx
        rad = 0.06 if rr == R0 else 0.04
        for j in range(48 if rr == R0 else 24):
            n_ = 48 if rr == R0 else 24
            a0, a1 = 2 * math.pi * j / n_, 2 * math.pi * (j + 1) / n_
            if broken and r.random() < broken * (0.5 if rr == R0 else 1.4):
                continue
            K.cyl_bm(bm, V((x, rr * math.cos(a0), rr * math.sin(a0))), V((x, rr * math.cos(a1), rr * math.sin(a1))), rad, 6)
    K.cyl_bm(bm, (-0.75, 0, 0), (0.15, 0, 0), 0.38, 14)
    return bm


def feed_bm():
    bm = bmesh.new()
    K.cyl_bm(bm, (0.1, 0, 0), (F - 0.15, 0, 0), 0.045, 8)
    K.cyl_bm(bm, (F - 0.15, 0, 0), (F + 0.1, 0, 0), 0.09, 10)
    K.cyl_bm(bm, (0.12, 0, 0), (0.42, 0, 0), 0.4, 16, r1=0.14)          # feed mount cone closes the hub
    K.cyl_bm(bm, (0.42, 0, 0), (0.5, 0, 0), 0.14, 12, r1=0.1)
    for k in range(3):                                                   # feed-rod stays to the inner ring
        a = 2 * math.pi * k / 3 + 0.5
        K.cyl_bm(bm, (0.9 * F, 0, 0), (0.35, 1.0 * math.cos(a), 1.0 * math.sin(a)), 0.012, 4)
    for sgn in (-1, 1):
        K.cyl_bm(bm, (F, 0, 0), (F, sgn * 0.32, 0), 0.018, 6)
        K.cyl_bm(bm, (F + 0.12, 0, 0), (F + 0.12, sgn * 0.25, 0), 0.012, 6)      # director
    return bm


def place(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


def dish_parts(M, tag, dent=0.0, broken=0.0):
    ob = K.part(place(dish_surface(0.0, dent), M), 'mesh_screen', name='reflector' + tag, bisect=False, grime=0.2, lod='keep')
    # rear skin is OPAQUE light-grey sheet: the fine front mesh reads as a solid dish at game zoom, so the yoke,
    # trunnions and cabin behind it never show through as dark boxes on the dish face
    K.part(place(dish_surface(0.03, dent), M), STEEL, name='reflector_back' + tag, bisect=False, grime=0.3, lod='keep',
           mat_tint=(0.72, 0.73, 0.7))
    for fb, nm, lk in ((dish_frame(broken=broken), 'reflector_lattice', None), (dish_rim(broken=broken), 'reflector_rim', 'keep')):
        if dent:
            for v in fb.verts:
                a = math.atan2(v.co.z, v.co.y)
                rr = math.hypot(v.co.y, v.co.z) / (D / 2)
                v.co.x += dent * max(0, math.cos(a - 0.6)) ** 3 * rr * rr
        K.part(place(fb, M), STEEL, name=nm + tag, mat_tint=(0.74, 0.75, 0.72), bisect=False, grime=0.4, lod=lk)
    return ob


if not DEST:
    M = Matrix.Translation(PIV) @ Matrix.Rotation(AZ, 4, 'Z') @ Matrix.Rotation(-EL, 4, 'Y') @ Matrix.Translation((0.55, 0, 0))   # trunnions sit BEHIND the reflector skin
    dish_parts(M, '')
    K.part(place(feed_bm(), M), 'steel_galv', name='feed', bisect=False, lod='keep')
    bm = K.bm_new()
    for sgn in (-1, 1):                    # heavy fork arms from the carriage to the elevation trunnions
        base = side * sgn * 1.25 + fwd * 0.35 + V((0, 0, 1.85))
        K.beam_bm(bm, base, PIV + side * sgn * 1.25, 0.34, 0.5)
        K.cyl_bm(bm, PIV + side * sgn * 1.05, PIV + side * sgn * 1.45, 0.3, 14)
    K.beam_bm(bm, side * -1.25 + fwd * 0.35 + V((0, 0, 2.1)), side * 1.25 + fwd * 0.35 + V((0, 0, 2.1)), 0.3, 0.4)
    q_ = PIV - fwd * 0.2
    K.P(STEEL, K.cyl_bm, tuple(q_ - side * 0.2 - V((0, 0, 1.2))), tuple(q_ - side * 0.2 - V((0, 0, 0.4))), 0.08, 8,
        name='elev_ram', mat_tint=(0.55, 0.56, 0.54))
    K.part(bm, STEEL, name='yoke', mat_tint=ST)
    K.anchor('bomb_target', (0, 0, 2.0), radius=3.0)
else:
    # reflector torn off: lying tilted against the emplacement edge on the SW side, crumpled, ribs broken
    M = Matrix.Translation((-3.8, -2.6, 3.1)) @ Matrix.Rotation(math.radians(-150), 4, 'Z') @ Matrix.Rotation(math.radians(58), 4, 'Y') @ Matrix.Rotation(0.3, 4, 'X')
    dish_parts(M, '_wreck', dent=0.9, broken=0.3)
    bm = K.bm_new()                       # snapped fork stumps, bent feed rod and rib fragments on the ground
    for sgn in (-1, 1):
        base = side * sgn * 1.25 + fwd * 0.35 + V((0, 0, 1.85))
        K.beam_bm(bm, base, base + V((0.15 * sgn, 0.1, 1.3)), 0.34, 0.5, roll=0.25 * sgn)
    K.part(bm, STEEL, name='yoke_stumps', mat_tint=ST)
    bm = K.bm_new()
    K.cyl_bm(bm, (1.5, -3.0, 0.5), (2.4, -3.2, 0.62), 0.045, 6)
    K.cyl_bm(bm, (2.4, -3.2, 0.62), (3.2, -3.9, 0.55), 0.045, 6)
    for k in range(9):
        a = r.uniform(0, 6.28)
        p_ = V((math.cos(a), math.sin(a), 0)) * r.uniform(2.0, 4.8)
        p_.z = 0.47 if p_.length < 4.0 else 0.05
        d_ = V((math.cos(a + r.uniform(-1, 1)), math.sin(a + r.uniform(-1, 1)), 0))
        mid_ = p_ + d_ * r.uniform(0.5, 1.0) + V((0, 0, r.uniform(0.1, 0.4)))
        K.beam_bm(bm, p_, mid_, 0.05, 0.06)
        K.beam_bm(bm, mid_, mid_ + (d_ + V((r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), -0.3))).normalized() * r.uniform(0.4, 0.9), 0.05, 0.06)
    K.part(bm, STEEL, name='rib_fragments', mat_tint=(0.7, 0.7, 0.68))
    bm = K.bm_new()                       # torn cables snaking from the turntable
    for k in range(3):
        pts = [V((0.8 * math.cos(k), 0.8 * math.sin(k), 1.8))]
        for t in range(5):
            pts.append(pts[-1] + V((r.uniform(-0.5, 0.9), r.uniform(-0.9, 0.3), -0.35 if pts[-1].z > 0.6 else 0.0)))
        for a_, b_ in zip(pts, pts[1:]):
            K.cyl_bm(bm, a_, b_, 0.025, 5)
    K.part(bm, 'timber_tarred', name='cables_torn', mat_tint=(0.3, 0.3, 0.3))
    N.blast((CAB_C.x - side.x * 1.2, CAB_C.y - side.y * 1.2, 2.8), 1.0, tuple(-side), seed=SEED, splinters='concrete')
    N.debris((-2.8, -3.6, 0), 1.6, 0.45, 'concrete', seed=SEED)
    N.debris((2.6, 1.8, 0.45), 1.1, 0.35, 'concrete', seed=SEED + 3, name='debris2')
    N.char_blasts(0.9, 2.6, 0.25)
# cable trench to the operations building (runs north), with a cover of precast slabs
bm = K.bm_new()
for k in range(8):
    K.box_bm(bm, (r.uniform(-0.02, 0.02), 4.45 + k * 0.58, 0.04), (0.55, 0.55, 0.1), rot_z=r.uniform(-0.03, 0.03))
K.part(bm, 'concrete_bunker', name='cable_trench_cover')
if SNOW:
    N.snow(exclude=N.SNOW_EXCLUDE + ('reflector',))
    if not DEST:                          # snow collects in the lower bowl of the tilted reflector
        bm = K.bm_new()
        M2 = Matrix.Translation(PIV) @ Matrix.Rotation(AZ, 4, 'Z') @ Matrix.Rotation(-EL, 4, 'Y') @ Matrix.Translation((0.55, 0, 0))   # trunnions sit BEHIND the reflector skin
        R0 = D / 2
        na, nr_ = 12, 5
        for layer, off in ((0, 0.0), (1, -0.03)):
            grid = []
            for i in range(nr_ + 1):
                rr = R0 * (0.3 + 0.62 * i / nr_)
                row = []
                for j in range(na + 1):
                    a = math.pi * (1.2 + 0.6 * j / na)
                    edge = min(i, nr_ - i, j, na - j)
                    th = 0.12 * min(1.0, edge / 1.5) * (1.0 + 0.6 * (1 - i / nr_))
                    x = rr * rr / (4 * F) + 0.02 + th + off
                    row.append(bm.verts.new(M2 @ V((x, rr * math.cos(a), rr * math.sin(a)))))
                grid.append(row)
            for i in range(nr_):
                for j in range(na):
                    f = (grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])
                    bm.faces.new(f if layer == 0 else tuple(reversed(f)))
        K.part(bm, 'snow', name='snow_bowl', grime=0, bisect=False, smooth=True)
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
