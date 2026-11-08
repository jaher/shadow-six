# Messerschmitt Bf 109 G-6 (1943-44) for the main menu's dogfight sprites (src/ui/menu-dogfight.js). Own work,
# modelled in bmesh from published dimensions and 3-view proportions, with model.py's helpers:
#   span 9.925 m, length 9.02 m, wing area 16.05 m2 -> straight-tapered wing with rounded tips, root chord 2.05 m,
#   tip chord 1.12 m, near-straight quarter-chord line, 6.5 deg dihedral, NACA 2R1 14.2 -> 11.35 (as 2414 -> 2411);
#   slab-sided fuselage, DB 605 cowl with the chin oil cooler, the port supercharger intake and the "Beulen" over
#   the MG 131 breeches; the short, angular standard framed hood; braced-free tailplane on the fin root; the tall,
#   narrow G-6 fin and rudder; shallow underwing radiators; VDM three-blade 3.0 m propeller with the large spinner.
# Paint: RLM 74 / 75 splinter over the upper surfaces, RLM 76 sides softly mottled, RLM 76 below; yellow lower
# cowling (theatre band), black-green spinner with the white spiral; Balkenkreuze on the fuselage sides and the
# wings. No swastika on the fin (the game stays publishable everywhere) and no unit markings (a fictional machine).
# Frame as model.py: x aft from the spinner tip, y to port, z up from the thrust line (m); Blender X = XD - x.
import bpy, bmesh, math
from mathutils import Vector
import model as SP
from model import lerp, interp, mesh, loft, naca, revolve, srgb, principled, _set

XD = 3.30                        # model origin: under the wing centre section (the pose pivot)
SPAN, S = 9.925, 9.925 / 2
CR, CT = 2.05, 1.12              # root / tip chord
XQ = 2.55 + 0.25 * CR            # quarter-chord line at the root (x)
ZW = -0.42                       # wing reference at the root (low wing)
DIH = math.radians(6.5)


def P(x, y, z):
    return Vector((XD - x, y, z))


# ---- fuselage: x, top z, bottom z, half width, top pinch, superellipse exponent (slab sides: high exponent) ----
# (G-6 side view: a deep nose and cowling, ~1.15 m from the cowl top to the oil-cooler line at the cockpit, then a
# slim tail; 9.02 m spinner to rudder)
FUS = [(0.62, 0.370, -0.380, 0.360, 0.00, 2.0), (0.72, 0.400, -0.420, 0.370, 0.06, 2.3),
       (1.00, 0.445, -0.520, 0.380, 0.14, 2.7), (1.50, 0.475, -0.610, 0.390, 0.20, 3.0),
       (2.10, 0.500, -0.645, 0.400, 0.22, 3.1), (2.70, 0.520, -0.660, 0.410, 0.20, 3.1),
       (3.30, 0.535, -0.660, 0.415, 0.16, 3.1), (3.90, 0.540, -0.645, 0.410, 0.12, 3.0),
       (4.60, 0.530, -0.600, 0.390, 0.10, 2.9), (5.40, 0.490, -0.525, 0.340, 0.08, 2.7),
       (6.30, 0.435, -0.425, 0.270, 0.06, 2.5), (7.20, 0.380, -0.315, 0.200, 0.05, 2.3),
       (8.00, 0.335, -0.205, 0.130, 0.05, 2.1), (8.60, 0.300, -0.110, 0.078, 0.05, 2.0),
       (9.02, 0.270, -0.030, 0.030, 0.00, 2.0)]
NSEG = 36
COWL_END = 2.55                  # the yellow lower cowl ends here (behind the oil cooler)


def fus_pt(x, a):
    zt, zb, w, pinch, ex = interp(FUS, x)
    c, s = math.cos(a), math.sin(a)
    y = w * math.copysign(abs(c) ** (2 / ex), c)
    z = math.copysign(abs(s) ** (2 / ex), s) * (zt if s >= 0 else -zb)
    if s > 0:
        y *= 1 - pinch * s * s
    return y, z


def fus_y(x, z):
    zt, zb, w, pinch, ex = interp(FUS, x)
    h = zt if z >= 0 else -zb
    q = min(1.0, abs(z) / h)
    y = w * max(0.0, 1 - q ** ex) ** (1 / ex)
    if z > 0:
        y *= 1 - pinch * q ** ex
    return y


def fuselage(M):
    xs = sorted({r[0] for r in FUS} | {COWL_END} | {round(0.62 + 0.18 * i, 3) for i in range(46) if 0.62 + 0.18 * i < 9.02})
    rings = [[P(x, *fus_pt(x, 2 * math.pi * j / NSEG)) for j in range(NSEG)] for x in xs]

    def mat(i, j):                 # 0 upper splinter, 1 side mottle, 2 RLM 76 below, 3 yellow lower cowl
        x = 0.5 * (xs[i] + xs[min(i + 1, len(xs) - 1)])
        a = 2 * math.pi * (j + 0.5) / NSEG
        _, z = fus_pt(x, a)
        zt, zb = interp(FUS, x)[:2]
        if z < zb * 0.45:
            return 3 if x < COWL_END else 2
        if z > zt * 0.70:
            return 0
        return 1
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('fuselage', bm, [M['upper'], M['mottle'], M['lb76'], M['yellow']])


# ---- canopy: the G-6's standard framed hood — short and angular: a sloped armoured windscreen, flat side panels
# leaning in to a flat roof, heavy frames (windscreen, the hood's middle bar, its rear), then a short solid fairing
# tapering into the spine. (x, roof z); the sill rides on the fuselage's flank ----
CANOPY = [(3.00, 0.545), (3.10, 0.680), (3.20, 0.800), (3.30, 0.905), (3.55, 0.930), (3.82, 0.938), (4.10, 0.932),
          (4.36, 0.920), (4.44, 0.820), (4.62, 0.730), (4.86, 0.640), (5.15, 0.555)]
SILL = 0.51
FRAMES = (3.30, 3.82, 4.36)        # the windscreen's rear frame, the hood's middle bar, its rear frame
HOOD_END = 4.40                    # glazed ahead of this, the solid fairing behind


def canopy(M):
    xs = sorted({r[0] for r in CANOPY} | {round(3.0 + 0.05 * i, 3) for i in range(45)} | {round(f + d, 3) for f in FRAMES for d in (-0.03, 0.03)})
    rings = []
    for x in xs:
        top = interp(CANOPY, x)[0]
        hs = fus_y(x, SILL) + 0.004                       # on the fuselage's flank
        ht, zc = 0.58 * hs, SILL + (top - SILL) * 0.86    # the roof's corner: the side panels lean in to it
        side = [(hs, SILL), (lerp(hs, ht, 0.33), lerp(SILL, zc, 0.33)), (lerp(hs, ht, 0.66), lerp(SILL, zc, 0.66)),
                (lerp(hs, ht, 0.93), lerp(SILL, zc, 0.93)), (ht, zc), (0.5 * ht, lerp(zc, top, 0.75))]
        half = side + [(0.0, top)]
        ring = half + [(-y, z) for y, z in reversed(side)] + [(0.0, SILL - 0.04)]
        rings.append([P(x, y, z) for y, z in ring])

    def mat(i, j):                 # 1 glass between the frames; 0 the frames, the sill rail, the roof edges, the fairing
        x = 0.5 * (xs[i] + xs[i + 1])
        if x > HOOD_END or j in (0, 3, 9, 12) or j >= 13 or any(abs(x - b) < 0.031 for b in FRAMES):
            return 0
        return 1
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('canopy', bm, [M['upper'], M['glass']])


def wing_c(y):
    """Chord at span station y: straight taper, the tip rounded over its last 0.55 m."""
    c = lerp(CR, CT, min(1.0, y / S))
    k = (y - (S - 0.55)) / 0.55
    return c * math.sqrt(max(0.0, 1 - k * k)) if k > 0 else c


def wing_xq(y):
    return XQ + 0.10 * y / S         # a hint of sweep on the quarter-chord line


def wing_section(y, side, n=22):
    c = max(wing_c(y), 0.004)
    f = min(1.0, y / S)
    t, inc = lerp(0.142, 0.114, f), math.radians(lerp(1.5, 0.0, f))
    zq, xq = ZW + y * math.tan(DIH), wing_xq(y)
    out = []
    for u, v in naca(t, n, m=0.02, p=0.4):
        xl, zl = (u - 0.25) * c, v * c
        out.append((P(xq + xl * math.cos(inc) + zl * math.sin(inc), side * y, zq + zl * math.cos(inc) - xl * math.sin(inc)), u, v))
    return out


def wing_z(x, y, lower=True):
    y = abs(y)
    c, f = max(wing_c(y), 0.004), min(1.0, y / S)
    t, xl = lerp(0.142, 0.114, f), x - wing_xq(y)
    u = min(1.0, max(0.0, xl / c + 0.25))
    yt = 5 * t * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
    yc = 0.02 / 0.16 * (0.8 * u - u * u) if u < 0.4 else 0.02 / 0.36 * (0.2 + 0.8 * u - u * u)
    return ZW + y * math.tan(DIH) + (yc - yt if lower else yc + yt) * c


def wing(M, side):
    ys = sorted({0.0, 0.2, 0.4, 0.6} | {round(0.6 + (S - 0.6) * math.sin(0.5 * math.pi * k / 24), 4) for k in range(25)})
    secs = [wing_section(y, side) for y in ys]
    rings = [[p for p, _, _ in s] for s in secs]

    def mat(i, j):                 # 0 upper splinter, 2 RLM 76 below
        return 2 if (secs[i][j][2] < 0 or j >= len(secs[i]) // 2) else 0
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=mat)
    return mesh('wing_%s' % ('port' if side > 0 else 'stbd'), bm, [M['upper'], M['mottle'], M['lb76']])


def tailplane(M, side):
    s, cr, ct, z = 1.50, 0.86, 0.52, 0.47          # on the fin root, above the fuselage line, under the rudder hinge
    rings = []
    for k in range(11):
        y = s * k / 10
        c = lerp(cr, ct, y / s) * (math.sqrt(max(0.0, 1 - ((y - 1.2) / 0.3) ** 2)) if y > 1.2 else 1.0)
        c = max(c, 0.004)
        rings.append([P(7.96 + (u - 0.3) * c, side * y, z + v * c) for u, v in naca(0.10, 16, m=0)])
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True, mat=lambda i, j: 0 if j < 15 else 1)
    return mesh('tailplane_%s' % ('port' if side > 0 else 'stbd'), bm, [M['upper'], M['lb76']])


# G-6 fin + rudder (side view): straight raked leading edge, rounded top, straight rudder hinge, rounded trailing edge
FIN_LE = [(7.66, 0.28), (7.86, 0.50), (8.05, 0.75), (8.20, 0.97), (8.32, 1.15), (8.42, 1.28), (8.52, 1.35)]
FIN_TE = [(8.52, 1.35), (8.68, 1.36), (8.84, 1.29), (8.95, 1.13), (9.01, 0.88), (9.02, 0.55), (9.01, 0.25),
          (8.97, 0.02), (8.90, -0.08)]


def _x_at(poly, z):
    return SP._x_at(poly, z)


def fin(M):
    rings = []
    for z in [0.15, 0.28, 0.40, 0.55, 0.70, 0.85, 1.00, 1.12, 1.22, 1.29, 1.34, 1.355]:
        le, te = (_x_at(FIN_LE, z) if z > 0.28 else 7.48), _x_at(FIN_TE, z)
        if z >= 1.355:
            le, te = 8.56, 8.62
        rings.append([P(le + u * (te - le), v * (te - le), z) for u, v in naca(0.10, 18, m=0)])
    bm = bmesh.new()
    loft(bm, rings, cap0=True, cap1=True)
    return mesh('fin', bm, [M['upper']])


def spinner(M):
    L, R = 0.74, 0.375
    rings = []
    for k in range(1, 15):
        x = L * (k / 14) ** 1.2
        r = R * (1 - (1 - x / L) ** 2) ** 0.55
        rings.append([P(x, r * math.cos(a), r * math.sin(a)) for a in (2 * math.pi * j / 32 for j in range(32))])
    bm = bmesh.new()
    vs = loft(bm, rings, cap1=True)
    tip = bm.verts.new(P(0.0, 0, 0))
    for j in range(32):
        bm.faces.new((vs[0][(j + 1) % 32], vs[0][j], tip))
    return mesh('spinner', bm, [M['spinner']])


def prop_disc(M):
    """VDM three-blade, 3.0 m: the motion-blurred disc (model.py's disc shader)."""
    R, x = 1.50, 0.40
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    nr, na = 14, 96
    rad = [0.30 + (R - 0.30) * k / (nr - 1) for k in range(nr)]
    vs = [[bm.verts.new(P(x, r * math.cos(2 * math.pi * j / na), r * math.sin(2 * math.pi * j / na))) for j in range(na)] for r in rad]
    for k in range(nr - 1):
        for j in range(na):
            q = (j + 1) % na
            f = bm.faces.new((vs[k][j], vs[k][q], vs[k + 1][q], vs[k + 1][j]))
            for lp, (kk, jj) in zip(f.loops, ((k, j), (k, j + 1), (k + 1, j + 1), (k + 1, j))):
                lp[uv].uv = (rad[kk] / R, jj / na)
    return mesh('prop_disc', bm, [M['disc']], recalc=False)


def rbox(x0, x1, sec, n=20, ex=4.0):
    rings = []
    for k in range(11):
        x = lerp(x0, x1, k / 10)
        yc, zc, hw, hh = sec(x)
        rings.append([P(x, yc + hw * math.copysign(abs(math.cos(a)) ** (2 / ex), math.cos(a)),
                        zc + hh * math.copysign(abs(math.sin(a)) ** (2 / ex), math.sin(a))) for a in (2 * math.pi * j / n for j in range(n))])
    return rings


def details(M):
    bm = bmesh.new()      # slots: 0 upper, 1 RLM 76, 2 black, 3 exhaust metal, 4 yellow
    for side in (1, -1):
        for i in range(6):                                    # DB 605 exhaust stacks, six a side
            x, z = 0.95 + 0.17 * i, 0.06
            y = fus_y(x, z)
            revolve(bm, P(x, side * (y - 0.01), z), (0.2, side * 1.0, -0.15), [(0, 0.035), (0.07, 0.03), (0.075, 0.018)], 8, mat=3, caps=(3, 2))
        yc = side * 1.05                                      # shallow underwing radiators

        def rsec(x, yc=yc):
            k = (x - 2.95) / 0.95
            depth = 0.13 + 0.03 * math.sin(min(1.0, k * 1.8) * math.pi / 2) - 0.06 * max(0.0, k - 0.6) / 0.4
            return yc, wing_z(x, abs(yc)) - depth / 2 + 0.02, 0.34, depth / 2 + 0.02
        loft(bm, rbox(2.95, 3.90, rsec), cap0=True, cap1=True, mat=lambda i, j: 1, caps=(2, 2))
        # the "Beulen": fairings over the MG 131 breeches, either side of the cowl top ahead of the windscreen
        def bsec(x, side=side):                              # a teardrop, fullest 60 % along
            k = min(1.0, max(0.0, (x - 2.02) / 0.90))
            h = math.sin(math.pi * k ** 0.75)
            return side * 0.25, interp(FUS, x)[0] - 0.07 + 0.045 * h, 0.03 + 0.085 * h, max(0.008, 0.10 * h)
        loft(bm, rbox(2.02, 2.92, bsec, n=14), cap0=True, cap1=True, mat=lambda i, j: 0)
    # chin oil cooler (yellow cowl) and the port supercharger intake
    def osec(x):                                             # the oil-cooler bath hanging under the nose
        k = min(1.0, max(0.0, (x - 1.00) / 1.25))
        zb = interp(FUS, x)[1]
        hh = 0.06 + 0.075 * math.sin(math.pi * k ** 0.8)
        return 0.0, zb - hh + 0.07, 0.215 - 0.03 * k, hh
    loft(bm, rbox(1.00, 2.25, osec), cap0=True, cap1=True, mat=lambda i, j: 4, caps=(2, 4))
    def isec(x):
        k = (x - 1.55) / 0.55
        return 0.32 + 0.06 * (1 - k), 0.02, 0.08 * (1 - 0.4 * k) + 0.02, 0.07
    loft(bm, rbox(1.55, 2.10, isec), cap0=True, cap1=True, mat=lambda i, j: 0, caps=(2, 0))
    return mesh('details', bm, [M['upper'], M['lb76'], M['black'], M['exhaust'], M['yellow']])


def _cross(bm, place, cx, cz, arm, bar, slot, nx=6):
    """A Balkenkreuz layer: the union of two bars, gridded so it follows the surface; place(u, v) -> Vector."""
    for (u0, u1, v0, v1) in ((cx - arm, cx + arm, cz - bar, cz + bar), (cx - bar, cx + bar, cz - arm, cz - bar), (cx - bar, cx + bar, cz + bar, cz + arm)):
        g = [[bm.verts.new(place(lerp(u0, u1, i / nx), lerp(v0, v1, k / nx))) for k in range(nx + 1)] for i in range(nx + 1)]
        for i in range(nx):
            for k in range(nx):
                bm.faces.new((g[i][k], g[i + 1][k], g[i + 1][k + 1], g[i][k + 1])).material_index = slot


def markings(M):
    bm = bmesh.new()       # slots: 0 black, 1 white
    for side in (1, -1):
        for off, (arm, bar, slot) in ((0.006, (0.40, 0.13, 1)), (0.010, (0.33, 0.065, 0))):   # fuselage, white then black
            _cross(bm, lambda x, z, side=side, off=off: P(x, side * (fus_y(x, z) + off), z), 6.00, -0.01, arm, bar, slot)
        yw, xw = 3.45, wing_xq(3.45) + 0.05
        for off, (arm, bar, slot) in ((0.006, (0.50, 0.16, 1)), (0.010, (0.41, 0.08, 0))):      # under the wing
            _cross(bm, lambda x, y, side=side, off=off: P(x, side * y, wing_z(x, y) - off), xw, yw, arm, bar, slot)
        for off, (arm, bar, slot) in ((0.006, (0.42, 0.13, 1)), (0.010, (0.36, 0.07, 0))):      # over the wing
            _cross(bm, lambda x, y, side=side, off=off: P(x, side * y, wing_z(x, y, lower=False) + off), xw, yw, arm, bar, slot)
    return mesh('markings', bm, [M['black_m'], M['white_m']], recalc=False)


RLM74, RLM75, RLM76, RLM04, RLM70 = srgb(64, 70, 68), srgb(99, 97, 105), srgb(178, 189, 191), srgb(226, 176, 44), srgb(36, 42, 35)


def _node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k == 'op':
            n.operation = v
        else:
            _set(n, **{k: v})
    return n


def upper_material():
    """RLM 74 / 75 splinter: Voronoi cells (angular patches) split between the two greys."""
    m = principled('upper109', RLM74, 0.6, 0.35)
    nt, b = m.node_tree, m.node_tree.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vo = _node(nt, 'ShaderNodeTexVoronoi', Scale=0.55)
    gt = _node(nt, 'ShaderNodeMath', op='GREATER_THAN')
    gt.inputs[1].default_value = 0.5
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs[6].default_value, mix.inputs[7].default_value = RLM74, RLM75
    nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
    nt.links.new(vo.outputs['Color'], gt.inputs[0])
    nt.links.new(gt.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def mottle_material():
    """RLM 76 sides softly mottled with RLM 74 (about a quarter of the surface)."""
    m = principled('mottle109', RLM76, 0.6, 0.35)
    nt, b = m.node_tree, m.node_tree.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = _node(nt, 'ShaderNodeTexNoise', Scale=2.4, Detail=2.0, Roughness=0.5)
    mr = _node(nt, 'ShaderNodeMapRange', From_Min=0.55, From_Max=0.62)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs[6].default_value, mix.inputs[7].default_value = RLM76, srgb(96, 100, 96)
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs[0])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def spinner_material():
    """RLM 70 black-green with the white spiral."""
    m = principled('spinner109', RLM70, 0.45, 0.4)
    nt, b = m.node_tree, m.node_tree.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    at = _node(nt, 'ShaderNodeMath', op='ARCTAN2')
    a1 = _node(nt, 'ShaderNodeMath', op='MULTIPLY')
    a1.inputs[1].default_value = 1 / (2 * math.pi)
    ax = _node(nt, 'ShaderNodeMath', op='MULTIPLY_ADD')       # (XD - X) / 0.72 * 1.1, the turns along the spinner
    ax.inputs[1].default_value, ax.inputs[2].default_value = -1.1 / 0.72, 1.1 * XD / 0.72
    s = _node(nt, 'ShaderNodeMath', op='ADD')
    fr = _node(nt, 'ShaderNodeMath', op='FRACT')
    lt = _node(nt, 'ShaderNodeMath', op='LESS_THAN')
    lt.inputs[1].default_value = 0.22
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs[6].default_value, mix.inputs[7].default_value = RLM70, srgb(225, 225, 218)
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], at.inputs[0]); nt.links.new(sep.outputs['Y'], at.inputs[1])
    nt.links.new(at.outputs[0], a1.inputs[0])
    nt.links.new(sep.outputs['X'], ax.inputs[0])
    nt.links.new(a1.outputs[0], s.inputs[0]); nt.links.new(ax.outputs[0], s.inputs[1])
    nt.links.new(s.outputs[0], fr.inputs[0]); nt.links.new(fr.outputs[0], lt.inputs[0])
    nt.links.new(lt.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def materials():
    return {'upper': upper_material(), 'mottle': mottle_material(), 'lb76': principled('lb76', RLM76, 0.6),
            'yellow': principled('yellow109', RLM04, 0.55), 'spinner': spinner_material(), 'disc': SP.disc_material(),
            'glass': principled('glass109', srgb(32, 36, 42), 0.05, 0.9), 'black': principled('black109', srgb(14, 14, 14), 0.8, 0.2),
            'exhaust': principled('exhaust109', srgb(46, 38, 34), 0.5, 0.4, 0.6),
            'black_m': principled('cross_black', srgb(16, 16, 16), 0.6), 'white_m': principled('cross_white', srgb(220, 220, 214), 0.6)}


def build():
    """All parts parented to the empty 'bf109' (the pose node); returns (root, prop disc)."""
    M = materials()
    root = bpy.data.objects.new('bf109', None)
    bpy.context.scene.collection.objects.link(root)
    parts = [fuselage(M), canopy(M), wing(M, 1), wing(M, -1), tailplane(M, 1), tailplane(M, -1), fin(M), spinner(M),
             details(M), markings(M)]
    disc = prop_disc(M)
    for ob in parts + [disc]:
        ob.parent = root
    return root, disc
