# tools.py - hand tools & small kit: shovel, climbing axe, wire cutters, handcuffs, hanger, lipstick, pencil, syringe, stones.
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import sl, bx, cy, MM, mm, walnut


def ring(name, R, sec, mat, a0=0, a1=360, segs=64, sec_segs=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0003):
    """Sweep a 2D cross-section [(dr, dz)] around the Z axis at radius R from angle a0..a1 (deg); mm inputs."""
    bm = bmesh.new(); rings = []
    full = abs(a1 - a0) >= 360; n = segs if full else segs + 1
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / segs)
        rings.append([bm.verts.new(((R + dr) * MM * math.cos(a), (R + dr) * MM * math.sin(a), dz * MM)) for dr, dz in sec])
    k = len(sec)
    for i in range(n if full else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(k):
            bm.faces.new((A[j], A[(j + 1) % k], B[(j + 1) % k], B[j]))
    if not full:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = D.from_bm(name, bm, mat, bevel=bevel, angle=40)
    o.location = loc; o.rotation_euler = [math.radians(v) for v in rot]
    return o


def rsec(w, h, n=0):
    """rectangular (or rounded n>0) section centred, mm."""
    if n == 0:
        return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    return [(w / 2 * math.cos(2 * math.pi * i / n), h / 2 * math.sin(2 * math.pi * i / n)) for i in range(n)]


def od_paint():
    return M.paint('od_paint2', M.lin((0.52, 0.52, 0.36)), rough=0.55, wear=1.0, under=M.lin((0.74, 0.74, 0.72)), chips=0.18)


def shovel():
    """US M1910 T-handle entrenching tool. Blade at +X end, handle toward -X."""
    wd = M.wood('ash', tint=(1.7, 1.45, 1.1), tex='fine_grained_wood', scale=0.3, rough=0.55, coat=0.05, stretch=(3, 1, 1))
    steel = M.metal('shov_steel', M.lin((0.45, 0.46, 0.46)), rough=0.4, wear=0.5)
    blade_pts = [(0, -75), (150, -78)] + [(150 + 70 * math.sin(math.radians(t)), -78 * math.cos(math.radians(t)) * (1 - 0.15 * math.sin(math.radians(t)))) for t in range(10, 171, 10)] + [(150, 78), (0, 75)]
    blade = sl('blade', blade_pts, 2.2, od_paint(), bevel=0.8, smooth=1, keep=(0, len(blade_pts) - 1))
    D.deform(blade, lambda v: Vector((v.x, v.y - 0.00055 * (v.z / 0.075) ** 2 * 30, v.z)))   # dish across width
    P = [blade]
    P.append(sl('socket', [(-70, -16), (10, -30), (40, -26), (40, 26), (10, 30), (-70, 16)], 5, od_paint(), bevel=1.5, smooth=1))
    P.append(cy('collar', 17, 70, steel, -80, 0, 0, 'X', 32, 1.0))
    P.append(cy('handle', 17, 250, wd, -230, 0, 0, 'X', 40, 2.0))
    # D-handle: two riveted wooden cheeks spreading into a D round a turned cross grip
    for sg in (1, -1):
        P.append(D.tube(f'dside{sg}', [(-340 * MM, 0, sg * 10 * MM), (-380 * MM, 0, sg * 40 * MM), (-440 * MM, 0, sg * 50 * MM), (-470 * MM, 0, sg * 44 * MM)],
                        9 * MM, wd, segs=16))
    P.append(cy('dgrip', 14, 104, wd, -472, 0, 0, 'Z', 40, 3.0))
    P.append(cy('dferrule', 18, 22, steel, -345, 0, 0, 'X', 32, 1.2))
    for sg in (1, -1):
        P.append(cy(f'dcap{sg}', 9.5, 6, steel, -472, 0, sg * 50, 'Z', 24, 1.2))
    for x in (-95, -60, 10):
        P.append(cy(f'rivet{x}', 3, 2, steel, x, -4 if x > 0 else -17, 0, 'Y', 16, 0.8))
    return P


@S.shot('shovel')
def _shovel(mode):
    root = D.group('shovel', shovel(), rot=(0, -26, 0))      # upright, blade up-right (the one inventory view)
    D.hot((0.22, 0, 0), parent=root)
    S.shoot('shovel', mode, box=(48, 34), margin=0.04)


def ice_axe():
    """1940s mountaineering ice axe: long ash shaft, forged steel head (pick + adze), ferrule spike."""
    wd = M.wood('ash', tint=(1.7, 1.45, 1.1), tex='fine_grained_wood', scale=0.3, rough=0.55, coat=0.05, stretch=(3, 1, 1))
    steel = M.metal('axe_steel', M.lin((0.52, 0.53, 0.54)), rough=0.3, wear=0.6, wear_color=M.lin((0.8, 0.8, 0.8)))
    P = []
    shaft = D.lathe('shaft', [(0, 0.22), (0.017, 0.22), (0.018, 0.3), (0.019, 0.62), (0.018, 0.70), (0, 0.70)], wd, segs=40, bevel=0.0005)
    shaft.rotation_euler = (0, math.radians(90), 0); P.append(shaft)
    # head across the top of the shaft (along Z in profile): pick curving down to +Z? pick toward -Z side, adze toward +Z
    pick = [(686, 8), (714, 10), (720, -30), (716, -80), (706, -140), (698, -176), (700, -130), (696, -80), (690, -30)]
    P.append(sl('pick', pick, 13, steel, bevel=1.2, smooth=2, keep=(5,), taper=0.7))
    adze = [(686, 4), (714, 4), (716, 40), (722, 78), (734, 96), (676, 96), (686, 72), (688, 40)]
    P.append(sl('adze', adze, 12, steel, bevel=1.0, smooth=1, keep=(3, 4)))
    P.append(bx('adze_blade', 672, 92, 738, 98, 30, steel, bevel=1.0))
    P.append(bx('collar', 660, -18, 716, 18, 34, steel, bevel=3))
    P.append(cy('ring', 22, 16, steel, 440, 0, 0, 'X', 32, 1.5))
    spike = D.lathe('spike', [(0, 0), (0.018, 0), (0.018, 0.03), (0.01, 0.06), (0, 0.095)], steel, segs=32)
    spike.rotation_euler = (0, math.radians(-90), 0); spike.location = (0.22, 0, 0); P.append(spike)
    P.append(D.tube('strap', [(0.60, -0.02, 0.0), (0.56, -0.03, -0.05), (0.48, -0.025, -0.07), (0.44, -0.02, -0.02)], 0.004, M.textured('axe_strap', 'brown_leather', scale=0.05)))
    return P


def big_head(parts, k=1.45):
    """Icon read: scale the forged head about the top of the shaft (an axe, not a nail)."""
    for o in parts:
        if o.name.split('.')[0] in ('pick', 'adze', 'adze_blade', 'collar'):
            o.matrix_world = Matrix.Translation((0.70, 0, 0)) @ Matrix.Scale(k, 4) @ Matrix.Translation((-0.70, 0, 0)) @ o.matrix_world


@S.shot('climbAxe')
def _axe(mode):
    parts = ice_axe(); big_head(parts)
    root = D.group('iceaxe', parts, rot=(0, -32, 0))
    D.hot((0.70, 0, -0.176), parent=root)
    S.shoot('climbAxe', mode, box=(48, 34), margin=0.04)


def wire_cutters():
    """British Army wire cutters: forged jaws, pivot bolt, long handles with red and black insulated grips."""
    steel = M.metal('wc_steel', M.lin((0.40, 0.41, 0.42)), rough=0.34, wear=0.8, wear_color=M.lin((0.75, 0.75, 0.76)))
    red = M.solid('grip_red', M.lin((0.62, 0.10, 0.07)), rough=0.45, var=0.15, bevel=0.001)
    blk = M.solid('grip_blk', M.lin((0.10, 0.095, 0.09)), rough=0.5, var=0.12, bevel=0.001)
    P = []
    for side, grip, th in ((1, red, 0), (-1, blk, 1)):
        y = (th - 0.5) * 11
        jaw = [(0, 0), (70, side * 5), (118, side * 4), (134, side * 0.5), (120, side * 14), (80, side * 22), (24, side * 25), (-26, side * 19), (-36, side * 8)]
        P.append(sl(f'jaw{side}', jaw, 11, steel, y=y, bevel=1.1, smooth=1, keep=(3,)))
        arm = [(-26, side * 12), (-180, side * 34), (-330, side * 50), (-330, side * 24), (-180, side * 13), (-14, -side * 4)]
        P.append(sl(f'arm{side}', arm, 12, steel, y=y, bevel=1.5, smooth=1))
        g = D.lathe(f'grip{side}', [(0, 0), (0.018, 0.003), (0.0205, 0.02), (0.0205, 0.15), (0.019, 0.166), (0, 0.17)], grip, segs=32)
        ang = math.atan2(side * 12, 150)
        g.matrix_world = Matrix.Translation((-310 * MM, y * MM, side * 36 * MM)) @ Matrix.Rotation(ang, 4, 'Y') @ Matrix.Rotation(math.radians(-90), 4, 'Y')
        P.append(g)
    P.append(cy('pivot', 9, 26, steel, 0, 0, 0, 'Y', 24, 1.5))
    return P


@S.shot('wireCutters')
def _wc(mode):
    root = D.group('cutters', wire_cutters(), rot=(0, -30, 0))
    D.hot((0.134, 0, 0), parent=root)
    S.shoot('wireCutters', mode, box=(48, 34), margin=0.04)


def nickel():
    return M.metal('nickel', M.lin((0.70, 0.70, 0.68)), rough=0.2, wear=0.2, grain=0.2)


def cuff(name, ni, open_deg=0.0):
    """One cuff in local coords: centre at origin, lock case at +X. open_deg swings the bow about its hinge (angle 200)."""
    P = [ring(name + '_frame', 30, rsec(9.5, 8, 0), ni, a0=22, a1=200, segs=40, loc=(0, 0, 4 * MM), bevel=0.0008),
         ring(name + '_frame2', 30, rsec(9.5, 8, 0), ni, a0=338, a1=360, segs=6, loc=(0, 0, 4 * MM), bevel=0.0008)]
    bow = ring(name + '_bow', 30.6, rsec(7, 6, 0), ni, a0=200, a1=372, segs=40, loc=(0, 0, 4 * MM), bevel=0.0008)
    if open_deg:
        h = Vector((30 * MM * math.cos(math.radians(200)), 30 * MM * math.sin(math.radians(200)), 0))
        bow.matrix_world = Matrix.Translation(h) @ Matrix.Rotation(math.radians(-open_deg), 4, 'Z') @ Matrix.Translation(-h) @ bow.matrix_world
    P.append(bow)
    P.append(cy(name + '_hinge', 5, 9, ni, 30 * math.cos(math.radians(200)), 30 * math.sin(math.radians(200)), 3, 'Z', 20, 1))
    P.append(D.box(name + '_lock', (24 * MM, 30 * MM, 11 * MM), ni, loc=(34 * MM, 0, 5.5 * MM), bevel=2 * MM))
    P.append(cy(name + '_key', 2.2, 1, M.solid('keyhole', (0.01, 0.01, 0.01), rough=0.8, spec=0.0), 34, 0, 11.3, 'Z', 16, 0))
    P.append(cy(name + '_swivel', 4, 10, ni, 50, 0, 5, 'X', 16, 1))
    return P


def handcuffs():
    """Hiatt-style chain handcuffs, nickel steel: left cuff closed, right cuff open. Lying flat (XY)."""
    ni = nickel()
    D.group('cuffL', cuff('L', ni), loc=(-68 * MM, 0, 0))
    D.group('cuffR', cuff('R', ni, open_deg=75), loc=(68 * MM, 0, 0), rot=(0, 0, 180))
    P = []
    for i, x in enumerate((-9, 0, 9)):   # three chain links alternating orientation
        o = ring(f'link{i}', 5.6, rsec(3.6, 3.6, 10), ni, segs=24, loc=(x * 1.25 * MM, 0, 5 * MM), rot=(90 if i % 2 else 0, 0, 0))
        o.scale = (1.45, 1, 1); P.append(o)
    return P


@S.shot('handcuffs')
def _cuffs(mode):
    root = D.group('cuffs', handcuffs(), rot=(42, 0, 8))        # propped towards the camera
    S.shoot('handcuffs', mode, box=(44, 30), margin=0.04)


def hanger():
    """Wooden coat hanger (shoulder bar) with a steel hook. Profile in XZ, laid flat."""
    wd = M.wood('beech2', tint=(2.3, 1.85, 1.3), tex='fine_grained_wood', scale=0.6, rough=0.35, coat=0.45, stretch=(4, 1, 1))
    steel = nickel(); P = []
    top = [(x, 38 - 0.00024 * x * x - (6 if abs(x) > 190 else 0)) for x in range(-215, 216, 15)]
    bot = [(x, 8 - 0.00016 * x * x) for x in range(215, -216, -15)]
    top = [(x, 54 - 0.00024 * x * x - (6 if abs(x) > 190 else 0)) for x in range(-215, 216, 15)]
    P = [sl('bar', top + bot, 20, wd, bevel=5, smooth=2, segs=4)]
    P.append(D.tube('hook', [(0, 0, 50 * MM), (0, 0, 94 * MM), (0, 0, 114 * MM), (16 * MM, 0, 140 * MM), (42 * MM, 0, 138 * MM),
                             (48 * MM, 0, 114 * MM), (36 * MM, 0, 96 * MM)], 5.5 * MM, steel, segs=16))
    P.append(cy('nut', 8, 12, steel, 0, 0, 54, 'Z', 16, 1))
    return P


@S.shot('hanger')
def _hanger(mode):
    root = D.group('hanger', hanger(), rot=(0, 0, 0))
    S.shoot('hanger', mode, box=(48, 26), margin=0.04)


def brass_mat():
    return M.metal('brass', M.lin((0.80, 0.64, 0.36)), rough=0.22, wear=0.3, wear_color=M.lin((0.95, 0.85, 0.6)), grain=0.2)


def lipstick():
    """Brass swivel lipstick: base + sleeve, red stick with a slanted tip; cap lying beside."""
    br = brass_mat()
    red = M.solid('lip_red', M.lin((0.62, 0.05, 0.07)), rough=0.3, var=0.05, coat=0.3, bevel=0.0004)
    P = []
    base = [(0, 0), (9.6, 0), (10, 1), (10, 30), (9.6, 31), (9.0, 31), (9.0, 32), (8.6, 32.4), (8.6, 58), (8.2, 59), (0, 59)]
    P.append(D.lathe('base', [(r * MM, z * MM) for r, z in base], br, segs=64))
    st = D.lathe('stick', [(0, 55 * MM), (7.3 * MM, 55 * MM), (7.3 * MM, 90 * MM), (0, 90 * MM)], red, segs=64)
    D.deform(st, lambda v: Vector((v.x, v.y, min(v.z, 0.084 - 0.0009 * (v.x * 1000) * 1.0))))
    P.append(st)
    for z in (6, 24):   # decorative rings
        P.append(D.lathe(f'rib{z}', [(0, (z - 0.6) * MM), (10.25 * MM, (z - 0.6) * MM), (10.25 * MM, (z + 0.6) * MM), (0, (z + 0.6) * MM)], br, segs=64))
    cap = D.lathe('cap', [(r * MM, z * MM) for r, z in [(0, 0), (10.4, 0), (10.6, 1), (10.6, 44), (10.0, 45), (0, 45)]], br, segs=64)
    cap.rotation_euler = (math.radians(90), 0, math.radians(-30)); cap.location = (26 * MM, 10 * MM, 10.6 * MM)
    P.append(cap)
    return P


@S.shot('lipstick')
def _lipstick(mode):
    D.group('lipstick', lipstick())
    S.shoot('lipstick', mode, box=(22, 32), margin=0.04)


def syringe():
    """1940s all-glass Record syringe: glass barrel with graduations, nickel ends, finger + thumb rings, needle. Along +X."""
    ni = nickel(); gl = M.glass('syr_glass', color=(0.96, 0.98, 0.97), rough=0.02, ior=1.47)
    liq = M.glass('syr_liquid', color=(0.95, 0.62, 0.18), rough=0.02, ior=1.34)
    ink = M.solid('grad_ink', M.lin((0.12, 0.10, 0.08)), rough=0.6)
    P = []
    P.append(cy('barrel', 8.2, 70, gl, 35, 0, 0, 'X', 48, 0.2))
    P.append(cy('liquid', 7.4, 46, M.solid('syr_liq2', M.lin((0.86, 0.52, 0.10)), rough=0.08, coat=1.0, var=0.05, spec=0.8), 48, 0, 0, 'X', 48, 0.2))
    P.append(cy('plunger_head', 7.3, 5, ni, 24, 0, 0, 'X', 48, 0.5))
    for i in range(8):
        P.append(cy(f'grad{i}', 8.25, 0.35 if i % 2 else 0.6, ink, 18 + i * 6, 0, 0, 'X', 48, 0))
    P.append(cy('cap_front', 9, 5, ni, 72, 0, 0, 'X', 48, 0.6))
    cone = D.lathe('cone', [(0, 0), (6 * MM, 0), (2.2 * MM, 12 * MM), (1.4 * MM, 16 * MM), (0, 16 * MM)], ni, segs=32)
    cone.rotation_euler = (0, math.radians(90), 0); cone.location = (74 * MM, 0, 0); P.append(cone)
    P.append(cy('needle', 1.3, 44, ni, 110, 0, 0, 'X', 12, 0.1))
    P.append(cy('cap_back', 9, 5, ni, -1, 0, 0, 'X', 48, 0.6))
    P.append(cy('rod', 2.2, 40, ni, -20, 0, 0, 'X', 20, 0.3))
    for sgn in (1, -1):
        P.append(ring(f'finger{sgn}', 8, rsec(3.2, 3.0, 10), ni, segs=32, loc=(-1 * MM, sgn * 18 * MM, 0), rot=(0, 90, 0)))
    P.append(ring('thumb', 9, rsec(3.4, 3.2, 10), ni, segs=32, loc=(-48 * MM, 0, 0), rot=(90, 0, 0)))
    return P


@S.shot('lethalInjection')
def _syr(mode):
    parts = syringe()
    for o in parts:       # icon girth: fatten the barrel section 1.35x about the axis (length unchanged)
        if o.name.split('.')[0] in ('barrel', 'liquid', 'plunger_head', 'cap_front', 'cap_back') or o.name.startswith('grad'):
            o.scale = (o.scale[0] * 1.35, o.scale[1] * 1.35, o.scale[2])
    root = D.group('syringe', parts, rot=(0, -28, 0), loc=(0, 0, 0.012))
    D.hot((0.132, 0, 0), parent=root)
    S.shoot('lethalInjection', mode, box=(44, 24), margin=0.04)


def pencil(color=(0.80, 0.62, 0.14)):
    """Hexagonal painted pencil, sharpened, brass ferrule + eraser. Along +X, tip at +X."""
    paint = M.solid('pencil_paint', M.lin(color), rough=0.35, coat=0.4, var=0.05, bevel=0.0006)
    wd = M.wood('cedar', tint=(2.2, 1.7, 1.2), tex='fine_grained_wood', scale=0.1, rough=0.6, coat=0.0)
    gr = M.metal('graphite', M.lin((0.25, 0.25, 0.26)), rough=0.4, wear=0.0)
    br = brass_mat(); er = M.solid('eraser', M.lin((0.78, 0.42, 0.40)), rough=0.8, var=0.1)
    P = []
    h = D.lathe('hex', [(0, 0), (4.0 * MM, 0), (4.0 * MM, 150 * MM), (0, 150 * MM)], paint, segs=6, smooth_angle=20)
    h.rotation_euler = (0, math.radians(90), 0); P.append(h)
    c = D.lathe('cone', [(0, 0), (3.7 * MM, 0), (1.1 * MM, 20 * MM), (0, 20.1 * MM)], wd, segs=48)
    c.rotation_euler = (0, math.radians(90), 0); c.location = (150 * MM, 0, 0); P.append(c)
    t = D.lathe('tip', [(0, 0), (1.15 * MM, 0), (0.1 * MM, 6 * MM), (0, 6.2 * MM)], gr, segs=24)
    t.rotation_euler = (0, math.radians(90), 0); t.location = (164.5 * MM, 0, 0); P.append(t)
    P.append(cy('ferrule', 4.3, 10, br, -4, 0, 0, 'X', 40, 0.4))
    P.append(cy('eraser', 3.9, 8, er, -12, 0, 0, 'X', 40, 1.2))
    return P


# the pencil is shot with the notebook binding (hudtools.spiral_strip), tucked in the coil


def stone_mat(name, tint, seed):
    """Rough field stone: CC0 rock scan albedo (tinted), dirt caught in the crevices, matte with a faint wet sheen."""
    t = M.NT(name)
    vec = t.coords(0.22 + 0.03 * seed)
    c = t.img('rock_face_03', 'diff', vec)
    c = t.mix(1.0, c, tint, 'MULTIPLY')
    cav = t.noise(90.0 + 13 * seed, 8.0, 0.7)
    dirt = t.math('MULTIPLY', t.math('SMOOTH_MAX', t.math('SUBTRACT', cav, 0.55), 0.0, 0.05), 3.0)
    c = t.mix(dirt, c, M.lin((0.20, 0.15, 0.10)))
    t.L(c, t.p.inputs['Base Color'])
    t.L(t.math('MULTIPLY_ADD', t.img('rock_face_03', 'rough', vec, noncolor=True), 0.3, 0.6), t.p.inputs['Roughness'])
    h = t.math('ADD', t.img('rock_face_03', 'rough', vec, noncolor=True), t.math('MULTIPLY', t.noise(300.0, 8.0, 0.7), 0.6))
    t.L(t.bump(h, strength=0.55, dist=0.0012), t.p.inputs['Normal'])
    return t.m


def rock(name, size, mat, seed, loc, rot):
    """Irregular faceted rock: low-subdivision icosphere, a few random plane cuts (fractured faces) + coarse noise."""
    import random
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
    o = bpy.context.active_object; o.name = name
    bm = bmesh.new(); bm.from_mesh(o.data)
    for _ in range(7):                     # fracture planes
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 1))).normalized()
        d = rnd.uniform(0.55, 0.8)
        for v in bm.verts:
            k = v.co.dot(n)
            if k > d: v.co -= n * (k - d)
    bm.to_mesh(o.data); bm.free()
    o.scale = size
    tex = bpy.data.textures.new(name + '_n', 'CLOUDS'); tex.noise_scale = 0.55; tex.noise_depth = 3
    dm = o.modifiers.new('disp', 'DISPLACE'); dm.texture = tex; dm.strength = 0.10; dm.texture_coords = 'LOCAL'
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    D.apply_mods(o)
    D.deform(o, lambda v: Vector((v.x, v.y, max(v.z, -0.55))))   # resting underside
    o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = True
    try: o.data.set_sharp_from_angle(angle=math.radians(38))
    except Exception: pass
    return o


def stones():
    P = []
    P.append(rock('s1', (0.032, 0.026, 0.021), stone_mat('st1', M.lin((0.70, 0.72, 0.72)), 1), 11, (-0.018, 0.008, 0.013), (8, -6, 20)))
    P.append(rock('s2', (0.025, 0.021, 0.018), stone_mat('st2', M.lin((0.74, 0.70, 0.64)), 2), 23, (0.036, 0.016, 0.011), (-10, 4, -30)))
    P.append(rock('s3', (0.022, 0.019, 0.016), stone_mat('st3', M.lin((0.62, 0.64, 0.66)), 3), 37, (0.012, -0.030, 0.010), (5, 12, 60)))
    return P


@S.shot('stones')
def _stones(mode):
    D.group('stones', stones())
    S.shoot('stones', mode, box=(36, 26), margin=0.05)
