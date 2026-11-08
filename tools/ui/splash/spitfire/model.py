# Supermarine Spitfire LF Mk IXc (1943-44 fighter-bomber fit) for the title-splash formation sprites
# (src/ui/splash-planes.js). Own work, modelled in bmesh from published dimensions and 3-view proportions:
#   span 36 ft 10 in (11.23 m), length 31 ft 0.5 in (9.47 m), wing area 242 sq ft (22.48 m2) -> elliptical
#   planform, root chord 2.55 m, straight quarter-chord line; NACA 2213 root -> 2209.4 tip, 6 deg dihedral,
#   +2 deg root / -0.5 deg tip incidence; elliptical tailplane 3.20 m span; rounded fin and rudder; Merlin 66
#   nose with six ejector stacks a side and the long carburettor intake under it; Malcolm (blown) hood and the
#   rear-view glazing; two identical radiators (coolant starboard, intercooler/oil port); C wing with the two
#   Hispano stubs; main wheels retracted into their open wells, fixed tail wheel; Rotol four-blade 3.28 m prop.
# Load: a 250 lb GP bomb under each wing (the splash drops the pair from these hardpoints, near wing first).
# Paint: RAF day-fighter scheme (Aug 1941 on): Dark Green / Ocean Grey disruptive pattern over Medium Sea Grey,
# 18 in Sky band and Sky spinner, yellow outer-wing leading-edge strips, C1 fuselage roundels, B upper / C lower
# wing roundels, C fin flash (red forward). No unit codes (fictional machine).
# Frame: x aft from the spinner tip, y to port, z up from the thrust line (m). Blender: X = XD - x (nose +X).
import bpy, bmesh, math
from mathutils import Vector

XD = 3.95                       # model origin: the belly-bomb station under the wing centre section
SPAN, S = 11.23, 11.23 / 2
C0, XQ = 2.55, 2.55 + 0.25 * 2.55   # root chord, the straight quarter-chord line (x)
ZW = -0.47                      # wing quarter-chord line height at the root (dihedral rises from here)
DIH = math.radians(6.0)


def P(x, y, z):
    return Vector((XD - x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def interp(table, x):
    """Linear interpolation of the station rows (x first) at x."""
    if x <= table[0][0]:
        return table[0][1:]
    for a, b in zip(table, table[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return tuple(lerp(u, v, t) for u, v in zip(a[1:], b[1:]))
    return table[-1][1:]


def mesh(name, bm, mats, smooth=True, recalc=True, coll=None):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def loft(bm, rings, closed=True, cap0=False, cap1=False, mat=lambda i, j: 0, caps=None):
    """Quad strips between consecutive rings (equal point counts); optional fan caps; mat(ring, seg) -> slot,
    caps = (slot, slot) for the two caps (default: mat of the adjoining strip)."""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for i, (a, b) in enumerate(zip(vs, vs[1:])):
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            f = bm.faces.new((a[j], a[k], b[k], b[j]))
            f.material_index = mat(i, j)
    for e, (ring, on, i) in enumerate(((vs[0], cap0, 0), (vs[-1], cap1, len(vs) - 2))):
        if on:
            c = bm.verts.new(sum((v.co for v in ring), Vector()) / n)
            for j in range(n):
                f = bm.faces.new((ring[j], ring[(j + 1) % n], c))
                f.material_index = caps[e] if caps else mat(i, j)
    return vs


# ---- fuselage: x, top z, bottom z, half width, top pinch (narrower V-12 cowl top), superellipse exponent ----
FUS = [(0.79, 0.305, -0.305, 0.305, 0.00, 2.0), (0.83, 0.322, -0.325, 0.312, 0.04, 2.1),
       (1.00, 0.352, -0.362, 0.330, 0.12, 2.3), (1.30, 0.392, -0.410, 0.350, 0.20, 2.5),
       (1.70, 0.432, -0.462, 0.370, 0.24, 2.6), (2.20, 0.472, -0.512, 0.388, 0.25, 2.6),
       (2.75, 0.510, -0.570, 0.400, 0.22, 2.5), (3.30, 0.530, -0.610, 0.405, 0.18, 2.4),
       (3.90, 0.545, -0.625, 0.410, 0.15, 2.4), (4.50, 0.555, -0.615, 0.405, 0.12, 2.4),
       (5.10, 0.560, -0.570, 0.385, 0.10, 2.3), (5.70, 0.535, -0.475, 0.340, 0.08, 2.2),
       (6.40, 0.495, -0.365, 0.285, 0.05, 2.1), (7.10, 0.455, -0.265, 0.225, 0.05, 2.0),
       (7.80, 0.425, -0.170, 0.165, 0.05, 2.0), (8.45, 0.400, -0.085, 0.105, 0.05, 2.0),
       (8.90, 0.380, -0.020, 0.060, 0.05, 2.0), (9.02, 0.360, 0.020, 0.030, 0.00, 2.0)]
SKY_BAND = (7.20, 7.66)         # the 18 in Sky band just ahead of the tail
NSEG = 40


def fus_pt(x, a):
    zt, zb, w, pinch, ex = interp(FUS, x)
    c, s = math.cos(a), math.sin(a)
    y = w * math.copysign(abs(c) ** (2 / ex), c)
    z = math.copysign(abs(s) ** (2 / ex), s) * (zt if s >= 0 else -zb)
    if s > 0:
        y *= 1 - pinch * s * s
    return y, z


def fus_y(x, z):
    """Half width of the fuselage surface at (x, z) (the decals sit on it)."""
    zt, zb, w, pinch, ex = interp(FUS, x)
    h = zt if z >= 0 else -zb
    q = min(1.0, abs(z) / h)
    y = w * max(0.0, 1 - q ** ex) ** (1 / ex)
    if z > 0:
        y *= 1 - pinch * q ** ex       # s^2 with |s| = q^(ex/2)
    return y


def z_dem(x):
    """Upper-surface camouflage / Medium Sea Grey demarcation on the fuselage side (lower nose to tail cone)."""
    return lerp(-0.30, -0.05, (x - 1.0) / 8.0)


def fuselage(M):
    xs = sorted({r[0] for r in FUS} | {SKY_BAND[0], SKY_BAND[1], 7.43, 6.0, 4.8, 3.6, 2.45, 1.5} |
                {round(0.79 + 0.2 * i, 3) for i in range(42) if 0.79 + 0.2 * i < 9.02})
    rings = [[P(x, *fus_pt(x, 2 * math.pi * j / NSEG)) for j in range(NSEG)] for x in xs]

    def mat(i, j):
        x = 0.5 * (xs[i] + xs[min(i + 1, len(xs) - 1)])
        a = 2 * math.pi * (j + 0.5) / NSEG
        _, z = fus_pt(x, a)
        if SKY_BAND[0] <= x < SKY_BAND[1]:
            return 2
        return 1 if z < z_dem(x) else 0
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('fuselage', bm, [M['camo'], M['msg'], M['sky']])


# ---- canopy: windscreen, Malcolm hood, rear fairing with the rear-view glazing: x, sill z, top z, half width ----
CANOPY = [(3.50, 0.50, 0.535, 0.300), (3.62, 0.50, 0.660, 0.300), (3.76, 0.50, 0.800, 0.300),
          (3.91, 0.50, 0.920, 0.310), (4.10, 0.50, 0.990, 0.330), (4.35, 0.50, 1.020, 0.335),
          (4.60, 0.50, 1.000, 0.330), (4.86, 0.51, 0.945, 0.310), (5.02, 0.52, 0.860, 0.285),
          (5.22, 0.53, 0.740, 0.250), (5.45, 0.53, 0.635, 0.220), (5.70, 0.52, 0.565, 0.195)]


def canopy(M):
    n = 24
    xs = sorted({r[0] for r in CANOPY} | {3.54, 3.87, 3.95, 4.82, 4.90, 5.18} | {round(3.5 + 0.06 * i, 3) for i in range(37)})
    rings = []
    for x in xs:
        sill, top, hw = interp(CANOPY, x)
        ring = []
        for j in range(n + 1):                     # sill (port) over the top to the sill (starboard)
            a = math.pi * j / n
            c, s = math.cos(a), math.sin(a)
            y = hw * math.copysign(abs(c) ** (2 / 2.7), c)
            ring.append(P(x, y, sill + (top - sill) * abs(s) ** (2 / 2.2)))
        ring.append(P(x, 0, sill - 0.04))           # closes under the sill, inside the fuselage
        rings.append(ring)

    def mat(i, j):
        x = 0.5 * (xs[i] + xs[i + 1])
        if j >= n:
            return 0
        h = math.sin(math.pi * (j + 0.5) / n)        # 0 at the sill, 1 on top
        if h < 0.18:
            return 0                                 # sill rail
        if 3.54 < x < 3.87 or 3.95 < x < 4.82:      # windscreen panels, hood (its frame bars are thin)
            return 1
        if 4.90 < x < 5.18 and h < 0.80:            # rear-view glazing (the side windows behind the hood)
            return 1
        return 0
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('canopy', bm, [M['camo'], M['glass']])


# ---- wings, tailplane, fin ----
def naca(t, n=22, m=0.02, p=0.2):
    """Closed NACA 4-digit loop (u along the chord, v up, chord units): TE upper -> LE -> TE lower."""
    xs = [(1 - math.cos(math.pi * i / (n - 1))) / 2 for i in range(n)]

    def yt(x):
        return 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)

    def yc(x):
        if m == 0:
            return 0.0
        return m / p ** 2 * (2 * p * x - x * x) if x < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)
    return [(x, yc(x) + yt(x)) for x in reversed(xs)] + [(x, yc(x) - yt(x)) for x in xs[1:-1]]


def wing_c(y):
    return C0 * math.sqrt(max(0.0, 1 - (y / S) ** 2))


def wing_section(y, side, n=22, fillet=0.0):
    """Section at span station y (>= 0): chord, quarter-chord line, washout, thinning, dihedral; points + u."""
    c = max(wing_c(y), 0.004)
    f = y / S
    t, inc = lerp(0.132, 0.094, f), math.radians(lerp(2.0, -0.5, f))
    zq = ZW + y * math.tan(DIH)
    out = []
    for u, v in naca(t, n):
        xl = u * c if u <= 0.5 else 0.5 * c + (u - 0.5) * (c + 2 * fillet)    # root fillet: aft half stretched
        xl -= 0.25 * c
        zl = v * c
        x = XQ + xl * math.cos(inc) + zl * math.sin(inc)
        z = zq + zl * math.cos(inc) - xl * math.sin(inc)
        out.append((P(x, side * y, z), u, v))
    return out


def wing(M, side):
    ys = [S * math.sin(0.5 * math.pi * k / 30) for k in range(31)]
    ys = sorted(set([0.0, 0.15, 0.3, 0.45, 0.6] + [y for y in ys if y > 0.6]))
    secs = [wing_section(y, side, fillet=0.6 * max(0.0, 1 - y / 0.85) ** 2) for y in ys]
    rings = [[p for p, _, _ in s] for s in secs]

    def mat(i, j):
        y = 0.5 * (ys[i] + ys[i + 1])
        u0, v0 = secs[i][j][1], secs[i][j][2]
        u1 = secs[i][(j + 1) % len(secs[i])][1]
        lower = v0 < 0 or (j >= len(secs[i]) // 2)
        if 2.15 < y < 4.95 and min(u0, u1) < 0.035:   # yellow leading-edge identification strip (outer wing)
            return 3
        return 1 if lower else 0
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('wing_%s' % ('port' if side > 0 else 'stbd'), bm, [M['camo'], M['msg'], M['sky'], M['yellow']])


def tailplane(M, side):
    s, c0, xq, z = 1.60, 1.06, 7.95 + 0.30 * 1.06, 0.13      # 10 ft 6 in span, elliptical, 30 % chord axis
    rings = []
    for k in range(13):
        y = s * math.sin(0.5 * math.pi * k / 12) if k else 0.0
        c = max(c0 * math.sqrt(max(0.0, 1 - (y / s) ** 2)), 0.004)
        t = lerp(0.10, 0.08, y / s)
        rings.append([P(xq + (u - 0.30) * c, side * y, z + v * c) for u, v in naca(t, 16, m=0)])
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=lambda i, j: 0 if j < 15 else 1)
    return mesh('tailplane_%s' % ('port' if side > 0 else 'stbd'), bm, [M['camo'], M['msg']])


# fin + rudder outline (side view): leading edge base -> top, top -> rudder trailing edge -> rudder foot
FIN_LE = [(7.70, 0.41), (7.92, 0.62), (8.10, 0.86), (8.26, 1.10), (8.40, 1.33), (8.53, 1.51), (8.68, 1.64),
          (8.85, 1.71), (9.00, 1.73)]
FIN_TE = [(9.00, 1.73), (9.17, 1.71), (9.31, 1.63), (9.40, 1.49), (9.46, 1.29), (9.48, 1.03), (9.48, 0.75),
          (9.47, 0.45), (9.45, 0.20), (9.42, 0.02), (9.36, -0.05)]
RUDDER_POST = 8.98


def _x_at(poly, z):
    """x of a monotone-in-z polyline at height z."""
    pts = sorted(poly, key=lambda p: p[1])
    if z <= pts[0][1]:
        return pts[0][0]
    for a, b in zip(pts, pts[1:]):
        if z <= b[1]:
            return lerp(a[0], b[0], (z - a[1]) / max(1e-9, b[1] - a[1]))
    return pts[-1][0]


def fin_half(x, z):
    """Half thickness of the fin / rudder at (x, z) (for the fin flash)."""
    le, te = (_x_at(FIN_LE, z) if z > 0.41 else 7.70), _x_at(FIN_TE, z)
    u = min(1.0, max(0.0, (x - le) / max(0.01, te - le)))
    t = lerp(0.10, 0.07, max(0.0, z - 0.4) / 1.33)
    return 5 * t * (te - le) * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)


def fin(M):
    rings = []
    zs = [0.30, 0.41, 0.52, 0.66, 0.80, 0.95, 1.10, 1.25, 1.38, 1.49, 1.58, 1.645, 1.69, 1.715, 1.73]
    for z in zs:
        le, te = (_x_at(FIN_LE, z) if z > 0.41 else 7.55), _x_at(FIN_TE, z)
        if z >= 1.73:
            le, te = 8.98, 9.02
        t = lerp(0.10, 0.07, max(0.0, z - 0.4) / 1.33)
        rings.append([P(le + u * (te - le), v * (te - le), z) for u, v in naca(t, 18, m=0)])
    lower = []                                                   # the rudder below the tail cone
    for z in (-0.05, 0.05, 0.20, 0.36):
        te = _x_at(FIN_TE, max(z, -0.049))
        ch = te - RUDDER_POST + 0.06
        lower.append([P(RUDDER_POST - 0.06 + u * ch, v * ch, z) for u, v in naca(0.09, 18, m=0)])
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True)
    loft(bm, lower, cap0=True, cap1=True)
    return mesh('fin', bm, [M['camo']])


def spinner(M):
    L, R = 0.80, 0.305                                  # pointed Rotol spinner
    rings = []
    for k in range(1, 15):
        x = L * (k / 14) ** 1.25
        r = R * (1 - (1 - x / L) ** 2) ** 0.62
        rings.append([P(x, r * math.cos(a), r * math.sin(a)) for a in (2 * math.pi * j / 32 for j in range(32))])
    bm = bmesh.new()
    vs = loft(bm, rings, cap1=True)
    tip = bm.verts.new(P(0.0, 0, 0))
    for j in range(32):
        bm.faces.new((vs[0][(j + 1) % 32], vs[0][j], tip))
    return mesh('spinner', bm, [M['sky']])


def prop_disc(M):
    """Rotol four-blade, 10 ft 9 in: drawn as its motion-blurred disc (the shader adds the yellow tips and a
    faint blade hint). Two-sided, one quad ring per radius band; UV u = radius / R, v = angle / 2 pi."""
    R, x = 1.64, 0.47
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    nr, na = 16, 96
    rad = [0.30 + (R - 0.30) * k / (nr - 1) for k in range(nr)]
    vs = [[bm.verts.new(P(x, r * math.cos(2 * math.pi * j / na), r * math.sin(2 * math.pi * j / na))) for j in range(na)] for r in rad]
    for k in range(nr - 1):
        for j in range(na):
            q = (j + 1) % na
            f = bm.faces.new((vs[k][j], vs[k][q], vs[k + 1][q], vs[k + 1][j]))
            for lp, (kk, jj) in zip(f.loops, ((k, j), (k, j + 1), (k + 1, j + 1), (k + 1, j))):
                lp[uv].uv = (rad[kk] / R, jj / na)
    return mesh('prop_disc', bm, [M['disc']], recalc=False)


# ---- details: primitives ----
def _frame(axis):
    a = Vector(axis).normalized()
    h = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((0, 1, 0))
    u = a.cross(h).normalized()
    return a, u, a.cross(u)


def revolve(bm, p0, axis, prof, segs=16, mat=0, caps=None):
    """Surface of revolution: prof = [(t along axis, r)], p0 a Blender-space Vector."""
    a, u, v = _frame(axis)
    rings = [[p0 + a * t + (u * math.cos(2 * math.pi * j / segs) + v * math.sin(2 * math.pi * j / segs)) * max(r, 1e-4)
              for j in range(segs)] for t, r in prof]
    loft(bm, rings, cap0=True, cap1=True, mat=lambda i, j: mat, caps=caps)


def rbox(x0, x1, sec, n=24, ex=4.0):
    """Rings of a rounded box along x: sec(x) -> (yc, zc, half width, half height) (rounded-rectangle sections)."""
    rings = []
    xs = [lerp(x0, x1, k / 10) for k in range(11)]
    for x in xs:
        yc, zc, hw, hh = sec(x)
        ring = []
        for j in range(n):
            a = 2 * math.pi * j / n
            c, s = math.cos(a), math.sin(a)
            ring.append(P(x, yc + hw * math.copysign(abs(c) ** (2 / ex), c), zc + hh * math.copysign(abs(s) ** (2 / ex), s)))
        rings.append(ring)
    return rings


def wing_z(x, y, lower=True):
    """Height of the wing surface at (x, |y|) (sections sampled analytically)."""
    y = abs(y)
    c, f = wing_c(y), y / S
    t, inc = lerp(0.132, 0.094, f), math.radians(lerp(2.0, -0.5, f))
    xl = x - XQ
    u = min(1.0, max(0.0, xl / c + 0.25))
    yt = 5 * t * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
    m, p = 0.02, 0.2
    yc = m / p ** 2 * (2 * p * u - u * u) if u < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * u - u * u)
    v = (yc - yt) if lower else (yc + yt)
    return ZW + y * math.tan(DIH) + v * c * math.cos(inc) - xl * math.sin(inc)


def details(M):
    bm = bmesh.new()      # slots: 0 camo, 1 msg, 2 black, 3 exhaust metal, 4 tyre, 5 gunmetal
    for side in (1, -1):
        for i in range(6):                                   # Merlin 66 ejector stacks, six a side
            x, z = 1.30 + 0.195 * i, 0.165
            y = fus_y(x, z)
            rings = []
            for t, k in ((0.0, 0.9), (0.05, 1.0), (0.13, 1.0), (0.135, 0.7)):   # aft and outward, flattened oval
                c = P(x + t, side * (y - 0.015 + 0.45 * t), z - 0.1 * t)
                rings.append([c + Vector((0, side * 0.022 * k * math.cos(a), 0.036 * k * math.sin(a)))
                              for a in (2 * math.pi * j / 10 for j in range(10))])
            loft(bm, rings, cap0=True, cap1=True, mat=lambda i, j: 3, caps=(3, 2))
        yc = side * 1.45                                     # radiator housings (coolant stbd, intercooler port)

        def rsec(x, yc=yc):
            k = (x - 3.55) / 1.20
            depth = 0.24 + 0.07 * math.sin(min(1.0, k * 1.6) * math.pi / 2) - 0.13 * max(0.0, k - 0.55) / 0.45
            top = wing_z(x, abs(yc)) + 0.06
            return yc, top - (depth + 0.06) / 2, 0.27, (depth + 0.06) / 2
        loft(bm, rbox(3.55, 4.75, rsec), cap0=True, cap1=True, mat=lambda i, j: 1, caps=(2, 2))  # mouth + exit dark
        # Hispano 20 mm stub, C wing inner bay
        yg = 1.98
        xle = XQ - 0.25 * wing_c(yg)
        zg = ZW + yg * math.tan(DIH) + 0.01
        revolve(bm, P(xle + 0.06, side * yg, zg), (1, 0, 0), [(0, 0.07), (0.22, 0.066), (0.30, 0.045), (0.31, 0.034), (0.70, 0.030), (0.71, 0.022)], 12, mat=5)
        # main wheels retracted outward into their open wells (tyre faces flush with the lower skin)
        xw, yw = 3.18, 1.52
        zw = wing_z(xw, yw) - 0.012
        revolve(bm, P(xw, side * yw, zw + 0.05), (0, 0, -1), [(0, 0.27), (0.04, 0.30), (0.055, 0.29), (0.06, 0.15)], 20, mat=4)
        revolve(bm, P(xw, side * yw, zw + 0.05), (0, 0, -1), [(0, 0.16), (0.062, 0.15), (0.066, 0.07)], 16, mat=1)
    # carburettor air intake under the nose (long Mk IX fairing), mouth dark
    def isec(x):
        k = (x - 1.45) / 1.30
        zb = interp(FUS, x)[1]
        hh = 0.06 + 0.055 * (1 - k) ** 0.6
        return 0.0, zb + 0.05 - hh, 0.12 - 0.03 * k, hh
    loft(bm, rbox(1.45, 2.75, isec), cap0=True, cap1=True, mat=lambda i, j: 1, caps=(2, 1))
    # fixed tail wheel and its leg
    revolve(bm, P(8.40, 0, -0.06), (0.25, 0, -1), [(0, 0.035), (0.26, 0.03)], 8, mat=5)
    revolve(bm, P(8.47, -0.035, -0.36), (0, 1, 0), [(0, 0.06), (0.01, 0.105), (0.06, 0.105), (0.07, 0.06)], 16, mat=4)
    return mesh('details', bm, [M['camo'], M['msg'], M['black'], M['exhaust'], M['tyre'], M['gun']])


# 250 lb GP bomb (Mk IV-type): 10.2 in body, 54 in overall with the box tail; one under each wing on its crutched
# rack, outboard of the radiator. The splash drops the pair (near wing first) from these hardpoints.
BOMB_L, BOMB_R, BOMB_FIN = 1.10, 0.13, 0.14     # body length to the tail cone, radius, tail half-span (m)
BOMB_X, BOMB_Y = 3.30, 2.30                      # nose station (x aft of the spinner tip), span station


def bomb_mesh(bm, x0, y, z, L=BOMB_L, r=BOMB_R, fin=BOMB_FIN):
    """One GP bomb, nose at station x0 pointing forward: ogive nose, parallel body, tail cone, box fins (to
    1.24 L: 1.36 m overall), a red filling band behind the nose. Slots: 0 bomb green, 2 red band."""
    prof = [(0, 0.0), (0.04 * L, 0.35 * r), (0.12 * L, 0.72 * r), (0.24 * L, 0.95 * r), (0.32 * L, r), (0.68 * L, r),
            (0.84 * L, 0.78 * r), (0.95 * L, 0.42 * r), (L, 0.32 * r)]
    revolve(bm, P(x0, y, z), (-1, 0, 0), prof, 16, mat=0)
    for k in range(4):                  # box tail: four plates on the diagonals
        a = math.pi / 4 + k * math.pi / 2
        dy, dz = math.cos(a) * fin, math.sin(a) * fin
        q = [P(x0 + 0.86 * L, y + dy * 0.30, z + dz * 0.30), P(x0 + 1.24 * L, y + dy * 0.30, z + dz * 0.30),
             P(x0 + 1.24 * L, y + dy, z + dz), P(x0 + 0.98 * L, y + dy, z + dz)]
        vs = [bm.verts.new(p) for p in q]
        bm.faces.new(vs).material_index = 0
    revolve(bm, P(x0 + 0.2 * L, y, z), (-1, 0, 0), [(0, r * 1.012), (0.05 * L, r * 1.012)], 16, mat=2)


def bomb_z():
    """Centre height of the wing bombs (under the lower skin, below the rack)."""
    return wing_z(BOMB_X + 0.45, BOMB_Y) - 0.06 - BOMB_R


def wing_bombs(M):
    """The two 250 lb bombs with their racks, one object per side: {'stbd': ob, 'port': ob}."""
    out = {}
    for side, name in ((-1, 'stbd'), (1, 'port')):
        bm = bmesh.new()
        y = side * BOMB_Y
        bomb_mesh(bm, BOMB_X, y, bomb_z())
        revolve(bm, P(BOMB_X + 0.48, y, wing_z(BOMB_X + 0.45, BOMB_Y) + 0.02), (0, 0, -1), [(0, 0.04), (0.07, 0.035)], 8, mat=1)
        out[name] = mesh('bomb_' + name, bm, [M['bomb'], M['msg'], M['r_red']], recalc=False)
    return out


def falling_bomb(M):
    """A lone 250 lb bomb centred on the model origin, nose +X (the splash's falling-bomb sprite)."""
    bm = bmesh.new()
    bomb_mesh(bm, XD - 0.62 * BOMB_L, 0.0, 0.0)
    return mesh('falling_bomb', bm, [M['bomb'], M['msg'], M['r_red']], recalc=False)


def _decal(bm, place, rings_r, segs, x0, z0, keep=None):
    """Concentric bands (roundel) on a surface: place(x, z) -> Blender Vector; rings_r = [(r_in, r_out, slot)];
    keep(x, z) -> False drops the faces there (where the fuselage side turns under, the paint would wrap)."""
    for r0, r1, slot in rings_r:
        sub = max(1, int((r1 - r0) / 0.06))
        rr = [lerp(r0, r1, k / sub) for k in range(sub + 1)]
        grid = [[place(x0 + r * math.cos(2 * math.pi * j / segs), z0 + r * math.sin(2 * math.pi * j / segs)) for j in range(segs)] for r in rr]
        vs = [[bm.verts.new(p) for p in ring] for ring in grid]
        for ia, (a, b) in enumerate(zip(vs, vs[1:])):
            for j in range(segs):
                k = (j + 1) % segs
                if keep:
                    r, ang = rr[ia + 1], 2 * math.pi * (j + 0.5) / segs
                    if not keep(x0 + r * math.cos(ang), z0 + r * math.sin(ang)):
                        continue
                f = bm.faces.new((a[j], a[k], b[k], b[j])) if r0 > 0 or a is not vs[0] else bm.faces.new((a[k], b[k], b[j]))
                f.material_index = slot


def markings(M):
    bm = bmesh.new()       # slots: 0 red, 1 white, 2 blue, 3 yellow
    C1 = [(0.0, 0.152, 0), (0.152, 0.178, 1), (0.178, 0.406, 2), (0.406, 0.457, 3)]   # 36 in C1, fuselage
    C = [(0.0, 0.152, 0), (0.152, 0.178, 1), (0.178, 0.406, 2)]                       # 32 in C, under the wing
    B = [(0.0, 0.284, 0), (0.284, 0.711, 2)]                                         # 56 in B, upper wing
    for side in (1, -1):
        def on_side(x, z):
            zt, zb = interp(FUS, x)[:2]
            return zb * 0.85 < z < zt * 0.88
        _decal(bm, lambda x, z, side=side: P(x, side * (fus_y(x, z) + 0.006), z), C1, 48, 6.05, 0.06, keep=on_side)
        yr = 3.35
        xr = XQ - 0.25 * wing_c(yr) + 0.42 * wing_c(yr)
        _decal(bm, lambda x, y, side=side: P(x, side * y, wing_z(x, y) - 0.006), C, 48, xr, yr)
        _decal(bm, lambda x, y, side=side: P(x, side * y, wing_z(x, y, lower=False) + 0.006), B, 48, xr, yr)
        # C fin flash, 24 x 27 in (red 11, white 2, blue 11, red forward), clipped to the fin's leading edge
        for x0, x1, slot in ((8.43, 8.68, 0), (8.68, 8.73, 1), (8.73, 8.98, 2)):
            nx, nz = 4, 10
            grid = []
            for i in range(nx + 1):
                row = []
                for k in range(nz + 1):
                    z = lerp(0.50, 1.19, k / nz)
                    x = max(lerp(x0, x1, i / nx), _x_at(FIN_LE, z) + 0.025)
                    row.append(bm.verts.new(P(x, side * (fin_half(x, z) + 0.004), z)))
                grid.append(row)
            for i in range(nx):
                for k in range(nz):
                    f = bm.faces.new((grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]))
                    f.material_index = slot
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return mesh('markings', bm, [M['r_red'], M['r_white'], M['r_blue'], M['r_yellow']], recalc=False)


# ---- materials (base colours given in sRGB, converted to scene linear) ----
def srgb(r, g, b):
    f = lambda c: (c / 255 / 12.92) if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


DARK_GREEN, OCEAN_GREY, MED_SEA_GREY = srgb(62, 74, 51), srgb(91, 98, 99), srgb(147, 152, 152)
SKY = srgb(183, 198, 166)


def _set(node, **kw):
    for k, v in kw.items():
        for name in (k.replace('_', ' '), {'Specular': 'Specular IOR Level', 'Emission': 'Emission Color'}.get(k, k)):
            if name in node.inputs:
                node.inputs[name].default_value = v
                break


def principled(name, color, rough=0.6, spec=0.35, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    _set(b, Base_Color=color, Roughness=rough, Specular=spec, Metallic=metal)
    return m


def camo_material():
    """Dark Green / Ocean Grey disruptive pattern: large soft-edged noise blobs in object space."""
    m = principled('camo', DARK_GREEN, 0.62, 0.35)
    nt, b = m.node_tree, m.node_tree.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    _set(nz, Scale=0.32, Detail=0.0, Roughness=0.5, Distortion=0.0)
    mr = nt.nodes.new('ShaderNodeMapRange')
    _set(mr, From_Min=0.488, From_Max=0.512)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs[6].default_value, mix.inputs[7].default_value = DARK_GREEN, OCEAN_GREY
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs[0])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def disc_material():
    """Prop disc: black blades blurred to a faint haze, a ring from the yellow tips, a faint four-blade hint."""
    m = bpy.data.materials.new('disc')
    m.use_nodes = True
    m.blend_method = 'BLEND'
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    _set(b, Roughness=0.45, Specular=0.5)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    uv = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs[0])
    # alpha = 0.09 + 0.20 * tips(u > 0.93) + 0.07 * hint(cos^12 of 4 * angle)
    tip = nt.nodes.new('ShaderNodeMath'); tip.operation = 'GREATER_THAN'; tip.inputs[1].default_value = 0.935
    nt.links.new(sep.outputs['X'], tip.inputs[0])
    ang = nt.nodes.new('ShaderNodeMath'); ang.operation = 'MULTIPLY'; ang.inputs[1].default_value = 8 * math.pi
    nt.links.new(sep.outputs['Y'], ang.inputs[0])
    cs = nt.nodes.new('ShaderNodeMath'); cs.operation = 'COSINE'
    nt.links.new(ang.outputs[0], cs.inputs[0])
    sh = nt.nodes.new('ShaderNodeMapRange'); _set(sh, From_Min=-1.0, From_Max=1.0)
    nt.links.new(cs.outputs[0], sh.inputs['Value'])
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 12.0
    nt.links.new(sh.outputs['Result'], pw.inputs[0])
    a1 = nt.nodes.new('ShaderNodeMath'); a1.operation = 'MULTIPLY_ADD'
    a1.inputs[1].default_value, a1.inputs[2].default_value = 0.09, 0.08
    nt.links.new(tip.outputs[0], a1.inputs[0])
    a2 = nt.nodes.new('ShaderNodeMath'); a2.operation = 'MULTIPLY_ADD'; a2.inputs[1].default_value = 0.07
    nt.links.new(pw.outputs[0], a2.inputs[0]); nt.links.new(a1.outputs[0], a2.inputs[2])
    col = nt.nodes.new('ShaderNodeMix'); col.data_type = 'RGBA'
    col.inputs[6].default_value, col.inputs[7].default_value = srgb(18, 18, 18), srgb(205, 160, 40)
    nt.links.new(tip.outputs[0], col.inputs[0])
    nt.links.new(col.outputs[2], b.inputs['Base Color'])
    nt.links.new(a2.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])
    return m


def materials():
    M = {'camo': camo_material(), 'msg': principled('msg', MED_SEA_GREY, 0.6), 'sky': principled('sky', SKY, 0.55),
         'yellow': principled('yellow', srgb(219, 168, 46), 0.6), 'disc': disc_material(),
         'glass': principled('glass', srgb(30, 34, 40), 0.05, 0.9),
         'black': principled('black', srgb(12, 12, 12), 0.8, 0.2), 'tyre': principled('tyre', srgb(22, 22, 22), 0.75, 0.3),
         'exhaust': principled('exhaust', srgb(48, 40, 36), 0.5, 0.4, 0.6), 'gun': principled('gun', srgb(40, 42, 44), 0.4, 0.5, 0.7),
         'bomb': principled('bomb', srgb(50, 54, 42), 0.5, 0.45), 'r_red': principled('r_red', srgb(150, 38, 38), 0.6),
         'r_white': principled('r_white', srgb(212, 212, 206), 0.6), 'r_blue': principled('r_blue', srgb(38, 54, 104), 0.6),
         'r_yellow': principled('r_yellow', srgb(216, 176, 54), 0.6)}
    return M


MATS = None


def build():
    """All parts parented to the empty 'spitfire' (the pose node); returns (root, {'stbd', 'port'} wing bombs, prop disc)."""
    global MATS
    MATS = M = materials()
    root = bpy.data.objects.new('spitfire', None)
    bpy.context.scene.collection.objects.link(root)
    parts = [fuselage(M), canopy(M), wing(M, 1), wing(M, -1), tailplane(M, 1), tailplane(M, -1), fin(M), spinner(M),
             details(M), markings(M)]
    disc, bmb = prop_disc(M), wing_bombs(M)
    for ob in parts + [disc] + list(bmb.values()):
        ob.parent = root
    return root, bmb, disc
