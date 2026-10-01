"""ac.py - aircraft layer on top of veh.py (kit pipeline). Blender Z up, metres, ground z=0, nose faces -Y.
Paint schemes are vertex colours (COLOR_0) over the pale library skins (air_skin / air_corr / air_fabric), assigned
PER FACE after the skin mesh is bisected along the camouflage splinter planes and theatre bands, so demarcations are
hard-edged like the real RLM splinter schemes. Classes by face normal: top (nz > TOP), bottom (nz < BOT), side.
Variants: grey (temperate RLM 70/71/65 or 74/75/76), dak (RLM 79/78 + white Mediterranean theatre band), winter
(temporary white distemper, worn, over the grey scheme), burnt (wreck)."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import V, P, box, beam, cyl, Matrix
import bmesh, bpy
from mathutils import noise
from mathutils.bvhtree import BVHTree
C, K = VH.C, VH.K

# RLM colours (sRGB, as seen slightly faded)
RLM = {'02': (112, 112, 96), '04': (200, 150, 30), '21': (205, 205, 200), '65': (138, 160, 172), '70': (38, 46, 38),
       '71': (58, 66, 48), '74': (64, 68, 70), '75': (84, 83, 90), '76': (160, 172, 178), '78': (112, 142, 160),
       '79': (166, 132, 88), '80': (62, 72, 44), '61': (72, 60, 42), '62': (66, 78, 60), '63': (150, 150, 140),
       'black': (26, 26, 26), 'white': (206, 206, 200), 'yellow': (196, 150, 36)}
TOP, BOT = 0.35, -0.30
NO_AO = (1.0, 1.0, 0.996)      # material tint marker '~fffffd': quantize.py strips the baked AO (fine corrugation)
CUR = {}


def setup(name, variant, scheme, planes=(), bands=(), seed=7):
    """scheme = {'grey': {'top': ('splinter', c1, c2) | ('solid', c), 'side': ..., 'bottom': ..., 'mottle': (c, amt)},
    'dak': ...}. planes = splinter cut planes [(point, normal)], bands = [(axis, lo, hi, rgb, classes, variants)]."""
    a = VH.setup(name, variant, seed=seed)
    base = variant.split('_')[0]
    sch = scheme.get(base) or scheme.get('grey')
    CUR.clear()
    CUR.update({'scheme': scheme, 'sch': sch, 'var': base, 'planes': [(V(p), V(n).normalized()) for p, n in planes],
                'bands': [b for b in bands if base in b[5]], 'rng': random.Random(seed)})
    main = sch['top'][1] if base != 'burnt' else (60, 50, 44)
    VH.PAINT[base] = main
    VH.PAINT['grey'] = scheme['grey']['top'][1]
    return a


def _cls(n):
    return 'top' if n.z > TOP else ('bottom' if n.z < BOT else 'side')


def camo(c, n, p):
    """sRGB 0-255 paint colour of the face with centre c and normal n, at loop position p (for soft mottles)."""
    sch = CUR['sch']
    cl = _cls(n)
    for ax, lo, hi, rgb, classes, _v in CUR['bands']:
        val = abs(c[ax]) if ax == 0 else c[ax]
        if ax == 1 and not CUR.get('skin', '').startswith('fuselage'):
            continue                                    # theatre bands go round the fuselage only
        if lo <= val <= hi and cl in classes:
            return rgb
    spec = sch[cl]
    if spec[0] == 'splinter':
        par = sum(1 for p0, nn in CUR['planes'] if (c - p0).dot(nn) > 0) % 2
        rgb = spec[1 + par]
    else:
        rgb = spec[1]
    mot = sch.get('mottle')
    if mot and cl == 'side':
        k = VH._n(p, 2.2)
        t = max(0.0, min(1.0, (k - 0.50) * 5)) * mot[1]
        rgb = tuple(rgb[i] * (1 - t) + mot[0][i] * t for i in range(3))
    return rgb


def _fnorm(f):
    """Face normal used for the paint class (top / side / bottom). Corrugated skins (CUR['cls_smooth']) use the
    averaged vertex normal = the normal of the underlying smooth surface, so ridge facets do not flip class."""
    if CUR.get('cls_smooth'):
        n = V((0, 0, 0))
        for v in f.verts:
            n += v.normal
        if n.length > 1e-6:
            return n.normalized()
    return f.normal


def recolor(ob, mid, amt=1.0, winter_top=False, fixed=None):
    """Per-face paint colour -> per-loop vertex colour with the vehicle weathering (dust / mud / snow / soot)."""
    mean = C.MATS[mid]['mean']
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    j = 1 + (CUR['rng'].random() - 0.5) * 0.05
    for f in bm.faces:
        cen = f.calc_center_median()
        fn = _fnorm(f)
        for l in f.loops:
            p = l.vert.co
            rgb = fixed or camo(cen, fn, p)
            t = V([min(1.0, rgb[i] / 255.0 / mean[i] * j) for i in range(3)])
            if winter_top:                          # worn distemper: camouflage shows through in soft patches
                wear = max(0.0, min(0.75, (VH._n(p, 1.3) - 0.46) * 2.2 + max(0.0, VH._n(p, 7.0) - 0.7) * 1.5))
                t = V((0.97, 0.97, 0.95)).lerp(t * 0.8, wear)
            c = VH.grime_vehicle(p, l.vert.normal if CUR.get('cls_smooth') else f.normal, amt, t)   # vertex-continuous
            l[col] = (min(c.x, 1), min(c.y, 1), min(c.z, 1), 1.0)
    bm.to_mesh(me)
    bm.free()


def _bisect(bm, planes):
    for p0, nn in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p0, plane_no=nn)


def skin(bm, name, mid='air_skin', node='main', axis=(0, 1, 0), pivot=None, lod=None, smooth=True, recalc=True,
         amt=0.8, uv='beam', uv_scale=1.0, camo_cut=True, fixed=None, sharp=35, cls_smooth=False, no_ao=False):
    """Painted airframe skin part(s). Returns list of objects (winter: whitewashed top/side + painted bottom)."""
    base = CUR['var']
    CUR['skin'] = name
    CUR['cls_smooth'] = cls_smooth
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc and len(bm.faces) > 1:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if base != 'burnt' and fixed is None and camo_cut:
        pl = list(CUR['planes']) if any(CUR['sch'][k][0] == 'splinter' for k in ('top', 'side', 'bottom')) else []
        for ax, lo, hi, rgb, classes, _v in CUR['bands']:
            for v_ in ((lo, hi) if ax != 0 else (lo, hi, -lo, -hi)):
                if abs(v_) < 1e5:
                    q = [0, 0, 0]
                    q[ax] = v_
                    nn = [0, 0, 0]
                    nn[ax] = 1
                    pl.append((V(q), V(nn)))
        _bisect(bm, pl)
    bm.normal_update()
    if smooth:
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(sharp):
                e.smooth = False
    parts = []
    if base == 'burnt':
        ob = C.part(bm, 'veh_burnt', name, uv=uv, axis=axis, node=node, grime=1.0, smooth=smooth, bisect=False, lod=lod,
                    tint=(0.8, 0.8, 0.8))
        parts.append(ob)
    elif base == 'winter' and fixed is None:
        bm2 = bm.copy()
        bm.normal_update()
        bm2.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if _fnorm(f).z < BOT], context='FACES')
        bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if _fnorm(f).z >= BOT], context='FACES')
        if bm.faces:
            ob = C.part(bm, 'limewash_worn', name, uv=uv, axis=axis, node=node, grime=0, smooth=smooth, bisect=False, lod=lod,
                        uv_scale=uv_scale, mat_tint=NO_AO if no_ao else None)
            recolor(ob, 'limewash_worn', amt, winter_top=True)
            parts.append(ob)
        else:
            bm.free()
        if bm2.faces:
            ob = C.part(bm2, mid, name + '_u', uv=uv, axis=axis, node=node, grime=0, smooth=smooth, bisect=False, lod=lod,
                        uv_scale=uv_scale, mat_tint=NO_AO if no_ao else None)
            recolor(ob, mid, amt)
            parts.append(ob)
        else:
            bm2.free()
    else:
        ob = C.part(bm, mid, name, uv=uv, axis=axis, node=node, grime=0, smooth=smooth, bisect=False, lod=lod, uv_scale=uv_scale,
                    mat_tint=NO_AO if no_ao else None)
        recolor(ob, mid, amt, fixed=fixed)
        parts.append(ob)
    for ob in parts:
        if pivot is not None:
            ob['kit_pivot'] = list(pivot)
    return parts


def S(builder, *a, **kw):
    """One-builder skin shortcut: S(builder, args..., name=, mid=, node=, pivot=, ...)."""
    skw = {k: kw.pop(k) for k in list(kw) if k in ('name', 'mid', 'node', 'axis', 'pivot', 'lod', 'smooth', 'recalc', 'amt',
                                                  'uv', 'uv_scale', 'camo_cut', 'fixed', 'sharp', 'cls_smooth')}
    bm = bmesh.new()
    builder(bm, *a, **kw)
    return skin(bm, skw.pop('name', 'skin'), **skw)


# ------------------------------------------------------------------ geometry builders
def airfoil2d(t=0.14, f0=0.0, f1=1.0, n=9, camber=0.02, blunt=0.004):
    """Closed airfoil outline in chord units (x from LE 0 to TE 1, z up) for the chord range [f0, f1]:
    top surface f0 -> f1 then bottom f1 -> f0. NACA 4-digit thickness, cosine spacing."""
    def yt(x):
        return 5 * t * (0.2969 * math.sqrt(max(x, 0)) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4) + blunt * x
    def yc(x):
        m, p = camber, 0.4
        return m / p ** 2 * (2 * p * x - x * x) if x < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)
    xs = [f0 + (f1 - f0) * (1 - math.cos(math.pi * i / (n - 1))) / 2 for i in range(n)]
    if f0 > 0:
        xs = [f0 + (f1 - f0) * i / (n - 1) for i in range(n)]
    top = [(x, yc(x) + yt(x)) for x in xs]
    bot = [(x, yc(x) - yt(x)) for x in reversed(xs)]
    if f0 == 0:
        bot = bot[:-1]
    return top + bot[1:] if f0 == 0 else top + bot


def place2d(ring, le, chord, cdir=(0, 1, 0), udir=(0, 0, 1), twist=0.0):
    """Map an airfoil outline to 3D: leading edge point le, chord length, chord direction, up direction, twist (deg,
    nose up positive about the span axis)."""
    cd, ud = V(cdir).normalized(), V(udir).normalized()
    if twist:
        ax = cd.cross(ud).normalized()
        R = Matrix.Rotation(math.radians(twist), 3, ax)
        cd, ud = R @ cd, R @ ud
    return [V(le) + cd * (x * chord) + ud * (z * chord) for x, z in ring]


def wing_bm(bm, stations, t=0.14, f0=0.0, f1=1.0, n=9, camber=0.02, cdir=(0, 1, 0), udir=(0, 0, 1), caps=True):
    """Loft airfoil sections. stations = [(le_point, chord, t_or_None, twist)...] root -> tip."""
    rings = []
    for st in stations:
        le, ch = st[0], st[1]
        tt = st[2] if len(st) > 2 and st[2] else t
        tw = st[3] if len(st) > 3 else 0.0
        rings.append(place2d(airfoil2d(tt, f0, f1, n, camber), le, ch, cdir, udir, tw))
    C.loft_bm(bm, rings, caps, caps)


def mirror_stations(st):
    return [(V((-s[0][0], s[0][1], s[0][2])),) + tuple(s[1:]) for s in st]


def fus_bm(bm, stations, segs=16, caps=True):
    """Fuselage loft of superellipse sections: stations = [(y, zc, w, h, n[, xc])...] nose (-y) -> tail."""
    rings = []
    for s in stations:
        y, zc, w, h, ne = s[:5]
        xc = s[5] if len(s) > 5 else 0.0
        rings.append(VH.superellipse(xc, zc - h / 2, max(w, 0.01), max(h, 0.01), ne, segs, y, flat_bottom=False))
    C.loft_bm(bm, rings, caps, caps)


def blade_bm(bm, hub, axis, radial, r0, r1, chord0, chord1, pitch0, pitch1, n=5, t=0.10, tip_round=True):
    """Propeller / rotor blade: airfoil sections from r0 to r1 along `radial`, chord along the rotation direction,
    pitched about the radial axis. axis = thrust/rotation axis."""
    ax, rd = V(axis).normalized(), V(radial).normalized()
    rot = ax.cross(rd).normalized()                  # rotation direction (chord direction at zero pitch)
    rings = []
    for i in range(n):
        f = i / (n - 1)
        r = r0 + (r1 - r0) * f
        ch = chord0 + (chord1 - chord0) * f
        if tip_round and i == n - 1:
            ch *= 0.55
        pt = math.radians(pitch0 + (pitch1 - pitch0) * f)
        cd = rot * math.cos(pt) + ax * math.sin(pt) * -1
        ud = cd.cross(rd).normalized() * -1
        le = V(hub) + rd * r - cd * ch * 0.35
        rings.append(place2d(airfoil2d(t, 0, 1, 6, 0.03), le, ch, cd, ud))
    C.loft_bm(bm, rings, True, True)


def frame_for(xdir, zhint=(0, 0, 1)):
    """3x3 rotation whose local X = xdir (hinge / rotation axis)."""
    x = V(xdir).normalized()
    z = V(zhint)
    y = z.cross(x).normalized()
    if y.length < 1e-6:
        y = V((0, 1, 0))
    z = x.cross(y).normalized()
    return Matrix((x, y, z)).transposed()


FRAMES, PARENTS = {}, {}


def hinge(node, p0, p1, kind, limits, parent=None, **extra):
    """Register a hinged control surface / door node: pivot on the hinge line p0-p1, local X along the hinge."""
    p0, p1 = V(p0), V(p1)
    FRAMES[node] = frame_for(p1 - p0)
    if parent:
        PARENTS[node] = parent
    VH.moving(node, kind, (p0 + p1) / 2, (1, 0, 0), limits, parent=parent, axis_world=VH.Gd(p1 - p0),
              hinge=[VH.G(p0), VH.G(p1)], **extra)
    return tuple((p0 + p1) / 2)


def spinner_bm(bm, c, axis, r, length, segs=16, rings=5, back=0.0):
    """Ogive spinner / nose cone along axis (tip at c + axis*length)."""
    ax = V(axis).normalized()
    u = ax.cross(V((0, 0, 1)) if abs(ax.z) < 0.9 else V((1, 0, 0))).normalized()
    w = ax.cross(u).normalized()
    rs = []
    for i in range(rings):
        f = i / (rings - 1)
        rr = r * math.sqrt(max(0.0, 1 - f ** 1.6)) if i < rings - 1 else 0.004
        cc = V(c) + ax * (length * f - back * (1 - f))
        rs.append([cc + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * rr for k in range(segs)])
    C.loft_bm(bm, rs, True, True)


def prop(node, hub, axis, radius, blades=3, chord=0.22, pitch=(55, 18), spin_r=0.2, spin_len=0.45, kind='black',
         phase=0.0, spinner=True, bent=0.0, spin_kind='paint'):
    """Propeller node (hub pivot, spins about the thrust axis). bent>0 curls the blade tips back (wreck)."""
    ax = V(axis).normalized()
    u = ax.cross(V((0, 0, 1))).normalized()
    w = ax.cross(u).normalized()
    for b in range(blades):
        a = phase + 2 * math.pi * b / blades
        rd = u * math.cos(a) + w * math.sin(a)
        bm = bmesh.new()
        blade_bm(bm, hub, ax, rd, spin_r * 0.6, radius, chord * 0.8, chord * 0.75, pitch[0], pitch[1])
        if bent:
            for v in bm.verts:
                d = (v.co - V(hub)).dot(rd)
                if d > radius * 0.45:
                    k = (d - radius * 0.45) / (radius * 0.55)
                    v.co += ax * (k * k * bent * radius) - rd * (k * k * bent * radius * 0.35)
        VH.vp(bm, kind, node + '_blade', node=node, pivot=tuple(hub), smooth=True, grime=0.4)
    if spinner:
        P(spin_kind, spinner_bm, V(hub) - ax * 0.02, -ax, spin_r, spin_len, 16, 5, 0.25, name=node + '_spinner', node=node,
          pivot=tuple(hub), smooth=True)
    VH.moving(node, 'prop', hub, (1, 0, 0), None, axis_world=VH.Gd(ax), rpm_idle=500, rpm_max=2300, radius=radius, blades=blades)
    FRAMES[node] = frame_for(ax)


# ------------------------------------------------------------------ markings (conformed to the skin)
def _bvh(obs):
    bm = bmesh.new()
    for o in obs:
        bm.from_mesh(o.data)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def _conform_quad(tree, c, u, v, n, du, dv, off, kind, node, nu=6, nv=6, name='mark'):
    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            q = c + u * (du * (i / nu - 0.5)) + v * (dv * (j / nv - 0.5))
            hit = tree.ray_cast(q + n * 0.6, -n, 1.5) if tree else (None,)
            if hit[0] is None and tree:
                hit = tree.find_nearest(q, 2.0)
            if hit[0] is not None:
                q = hit[0] + hit[1].normalized() * off
            else:
                q = q + n * off
            row.append(bm.verts.new(q))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    return VH.vp(bm, kind, name, node=node, grime=0.15, lod='drop2', recalc=False, smooth=True)


def _basis(n, up):
    n = V(n).normalized()
    v = V(up)
    v = (v - n * v.dot(n)).normalized()
    u = v.cross(n).normalized()
    return n, u, v


def _proj_quad(tree, c, u, v, n, du, dv, off, kind, node, nu, nv, name='mark'):
    """Quad projected along -n onto the skin in ONE fixed frame (points offset along n, not the hit normal), so
    stacked insignia layers register exactly even on narrow, tapering fuselages."""
    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            q = c + u * (du * (i / nu - 0.5)) + v * (dv * (j / nv - 0.5))
            hit = tree.ray_cast(q + n * 1.0, -n, 2.0)
            q = (hit[0] if hit[0] is not None else q) + n * off
            row.append(bm.verts.new(q))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    return VH.vp(bm, kind, name, node=node, grime=0.15, lod='drop2', recalc=False, smooth=True)


def cross(targets, c, n, size, up=(0, 1, 0), node='main', seg=4, lift=0.0, tree=None):
    """Luftwaffe Balkenkreuz (1939-43: black cross, broad white flanks, thin black outline), projected onto `targets`
    in a single frame. Insignia only (spec 10.6: no swastika on the fin)."""
    if CUR['var'] == 'burnt':
        return
    tree = tree or _bvh(targets)
    n, u, v = _basis(n, up)
    c = V(c)
    s = size
    k = max(seg, 6)
    for kind, a, b, off in (('black', 1.0, 0.44, 0.006), ('white', 0.94, 0.38, 0.011), ('black', 0.62, 0.16, 0.016)):
        _proj_quad(tree, c, u, v, n, a * s, b * s, off + lift, kind, node, k, 3)
        _proj_quad(tree, c, u, v, n, b * s, a * s, off + lift, kind, node, 3, k)


# 5x7 stroke font: segments in a 0..4 x 0..6 box
FONT = {'0': [(0, 0, 4, 0), (4, 0, 4, 6), (4, 6, 0, 6), (0, 6, 0, 0)], '1': [(2, 0, 2, 6), (2, 6, 1, 5)],
        '2': [(4, 0, 0, 0), (0, 0, 4, 4), (4, 4, 4, 6), (4, 6, 0, 6)], '3': [(0, 0, 4, 0), (4, 0, 4, 6), (4, 6, 0, 6), (1, 3, 4, 3)],
        '4': [(3, 0, 3, 6), (3, 6, 0, 2), (0, 2, 4, 2)], '5': [(0, 0, 4, 0), (4, 0, 4, 3), (4, 3, 0, 3), (0, 3, 0, 6), (0, 6, 4, 6)],
        '6': [(4, 6, 0, 6), (0, 6, 0, 0), (0, 0, 4, 0), (4, 0, 4, 3), (4, 3, 0, 3)], '7': [(0, 6, 4, 6), (4, 6, 1, 0)],
        '8': [(0, 0, 4, 0), (4, 0, 4, 6), (4, 6, 0, 6), (0, 6, 0, 0), (0, 3, 4, 3)], '9': [(0, 0, 4, 0), (4, 0, 4, 6), (4, 6, 0, 6), (0, 6, 0, 3), (0, 3, 4, 3)],
        'A': [(0, 0, 2, 6), (2, 6, 4, 0), (1, 2.5, 3, 2.5)], 'B': [(0, 0, 0, 6), (0, 6, 3, 6), (3, 6, 3.5, 3.2), (0, 3, 4, 3), (4, 3, 4, 0), (4, 0, 0, 0)],
        'D': [(0, 0, 0, 6), (0, 6, 3, 6), (3, 6, 4, 4), (4, 4, 4, 1.5), (4, 1.5, 3, 0), (3, 0, 0, 0)], 'E': [(4, 0, 0, 0), (0, 0, 0, 6), (0, 6, 4, 6), (0, 3, 3, 3)],
        'F': [(0, 0, 0, 6), (0, 6, 4, 6), (0, 3, 3, 3)], 'G': [(4, 6, 0, 6), (0, 6, 0, 0), (0, 0, 4, 0), (4, 0, 4, 3), (4, 3, 2, 3)],
        'H': [(0, 0, 0, 6), (4, 0, 4, 6), (0, 3, 4, 3)], 'K': [(0, 0, 0, 6), (0, 2.5, 4, 6), (1.2, 3.5, 4, 0)], 'L': [(0, 6, 0, 0), (0, 0, 4, 0)],
        'M': [(0, 0, 0, 6), (0, 6, 2, 3), (2, 3, 4, 6), (4, 6, 4, 0)], 'N': [(0, 0, 0, 6), (0, 6, 4, 0), (4, 0, 4, 6)],
        'S': [(4, 6, 0, 6), (0, 6, 0, 3), (0, 3, 4, 3), (4, 3, 4, 0), (4, 0, 0, 0)], 'T': [(0, 6, 4, 6), (2, 6, 2, 0)],
        'Z': [(0, 6, 4, 6), (4, 6, 0, 0), (0, 0, 4, 0)], 'C': [(4, 6, 0, 6), (0, 6, 0, 0), (0, 0, 4, 0)],
        'R': [(0, 0, 0, 6), (0, 6, 4, 6), (4, 6, 4, 3), (4, 3, 0, 3), (1.5, 3, 4, 0)], 'U': [(0, 6, 0, 0), (0, 0, 4, 0), (4, 0, 4, 6)],
        '+': [(0.5, 3, 3.5, 3), (2, 1.5, 2, 4.5)], '-': [(0.5, 3, 3.5, 3)]}


def _conform_poly(tree, c, u, v, n, q2d, sc, off, kind, node, name, nu=2, nv=3):
    """Conform a 2D quad (glyph units, scaled by sc, in the u/v frame at c) onto the skin (bilinear grid)."""
    import bmesh as _bm
    ar = sum(q2d[i][0] * q2d[(i + 1) % 4][1] - q2d[(i + 1) % 4][0] * q2d[i][1] for i in range(4))
    if ar < 0:
        q2d = [q2d[0], q2d[3], q2d[2], q2d[1]]
    P3 = [c + u * (x * sc) + v * (y * sc) for x, y in q2d]
    bm = _bm.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            a, b = i / nu, j / nv
            q = (P3[0] * (1 - a) + P3[1] * a) * (1 - b) + (P3[3] * (1 - a) + P3[2] * a) * b
            hit = tree.ray_cast(q + n * 0.6, -n, 1.5) if tree else (None,)
            if hit[0] is None and tree:
                hit = tree.find_nearest(q, 2.0)
            q = (hit[0] if hit[0] is not None else q) + n * off
            row.append(bm.verts.new(q))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    return VH.vp(bm, kind, name, node=node, grime=0.15, lod='drop2', recalc=False, smooth=True)


def letters(targets, text, c, n, h, up=(0, 0, 1), node='main', kind='black', stroke=None, outline=None, outline_w=0.14,
            lift=0.0, tree=None):
    """Painted code letters / tactical numbers (Luftwaffe block stencil font, blockfont.py) of height h, centred at c on
    the skin; `outline` = colour kind of a thin surround (e.g. white round a black number). stroke is ignored (kept
    for old call sites)."""
    import blockfont as BF
    if CUR['var'] == 'burnt':
        return
    tree = tree or _bvh(targets)
    n, u, v = _basis(n, up)
    sc = h / 6.0
    adv = 5.3
    x0 = -(adv * len(text) - 1.3) / 2
    c = V(c)
    layers = ([(outline, outline_w, 0.008 + lift)] if outline else []) + [(kind, 0.0, 0.012 + lift)]
    for kk, grow, off in layers:
        for k, ch in enumerate(text):
            for q in BF.pieces(ch, grow):
                q = [(x0 + k * adv + x, y - 3.0) for x, y in q]
                _conform_poly(tree, c, u, v, n, q, sc, off, kk, node, 'code')


# ------------------------------------------------------------------ small parts
def strut(p0, p1, w, h=None, kind='paint', name='strut', node='main', roll=0.0, segs=None):
    """Streamlined strut (flattened tube) or round tube (segs)."""
    if segs:
        return P(kind, cyl, p0, p1, w / 2, segs, name=name, node=node)
    return P(kind, beam, p0, p1, w, h or w * 0.35, name=name, node=node)


def nav_lights(left_tip, right_tip, tail, node='main'):
    """Wing-tip navigation lights: red port (left, +X is right in Blender? no: aircraft left = pilot's left = -X)."""
    for nm, p, k in (('nav_l', left_tip, 'red'), ('nav_r', right_tip, 'green'), ('nav_tail', tail, 'white')):
        P(k if k != 'green' else 'green', cyl, V(p) - V((0, 0.04, 0)), V(p) + V((0, 0.04, 0)), 0.035, 8, name=nm, node=node)
        VH.light(nm, p, (0, 0, 0), blackout=False, kind='nav_' + {'red': 'red', 'green': 'green', 'white': 'white'}[k], node=node)


VH.FLAT['green'] = ((20, 110, 40), 0.2, 0.0)
VH.FLAT['prop'] = ((34, 38, 32), 0.55, 0.2)
VH.FLAT['alu'] = ((150, 152, 154), 0.35, 0.9)
VH.FLAT['tyre'] = ((30, 30, 30), 0.9, 0.0)


def vfin(outdir, vtype, dims, footprint=None, variants=None, extra=None, ao_res=1024, lods=((0.6, 0.08), (0.3, 0.3)),
         quant=False, matfix=None):
    ground_snap()
    fr = dict(FRAMES)
    pa = dict(PARENTS)
    FRAMES.clear()
    PARENTS.clear()
    info = VH.vfinalize(outdir, vtype, dims, parents=pa, frames=fr, footprint=footprint, variants=variants, extra=extra,
                        ao_res=ao_res, lods=lods)
    if quant and info:                                   # KHR_mesh_quantization (normals int8, AO uv uint16)
        import quantize, json
        for d in info['lods']:
            p = os.path.join(outdir, d['file'])
            if os.path.exists(p):
                d['bytes'] = quantize.quantize(p)[1]
                print('[ac] quantized', d['file'], d['bytes'])
        info['vertex_quantization'] = 'KHR_mesh_quantization: NORMAL int8, TEXCOORD_1 uint16 (normalized)'
        kj = os.path.join(outdir, info['lods'][0]['file'].replace('.glb', '.kit.json'))
        json.dump(info, open(kj, 'w'), indent=1)
    if info:                                             # see-through clear-coated canopy glazing (all LODs)
        import json
        for d in info['lods']:
            p = os.path.join(outdir, d['file'])
            if os.path.exists(p):
                canopy_glass(p)
                if matfix:
                    mat_fix(p, matfix)
                d['bytes'] = os.path.getsize(p)
        kj = os.path.join(outdir, info['lods'][0]['file'].replace('.glb', '.kit.json'))
        json.dump(info, open(kj, 'w'), indent=1)
    return info


def canopy_glass(p):
    """Rework 2: the library 'glass_dirty' (dark, opaque building window) read as a black box from the game camera.
    Aircraft glazing -> blue-grey tint, alpha 0.14 BLEND, glossy clear coat, faint streak normals, so the
    cockpit interior and the frame bars read through it."""
    sys.path.insert(0, os.path.join(VH.SCR, '..', '..', '..', 'kit', 'tools'))
    from glb_post import read_glb, write_glb
    js, b = read_glb(p)
    ch = False
    for m in js.get('materials', []):
        if (m.get('extras') or {}).get('kit_id') == 'glass_dirty' or m.get('name', '').startswith('kit:glass_dirty') or \
                m.get('name') == 'veh:canopy_glass':
            nt = m.get('normalTexture')
            m.clear()
            m.update({'name': 'veh:canopy_glass', 'doubleSided': True, 'alphaMode': 'BLEND',
                      'pbrMetallicRoughness': {'baseColorFactor': [0.30, 0.37, 0.41, 0.14], 'metallicFactor': 0.0,
                                               'roughnessFactor': 0.06},
                      'extensions': {'KHR_materials_specular': {'specularFactor': 0.6},
                                     'KHR_materials_clearcoat': {'clearcoatFactor': 0.5, 'clearcoatRoughnessFactor': 0.03}},
                      'extras': {'veh_id': 'canopy_glass'}})
            if nt:
                nt['scale'] = 0.25
                m['normalTexture'] = nt
            ch = True
    if ch:
        eu = js.setdefault('extensionsUsed', [])
        for e in ('KHR_materials_specular', 'KHR_materials_clearcoat'):
            if e not in eu:
                eu.append(e)
        write_glb(p, js, b)


def mat_fix(p, fix):
    """Per-asset material override {kit_id: {'rough': r, 'metal': m, 'spec': s}}: drops the library MR texture so the
    surface gets one uniform (e.g. matte, heat-scaled) finish."""
    sys.path.insert(0, os.path.join(VH.SCR, '..', '..', '..', 'kit', 'tools'))
    from glb_post import read_glb, write_glb
    js, b = read_glb(p)
    for m in js.get('materials', []):
        f = fix.get((m.get('extras') or {}).get('kit_id'))
        if f:
            pb = m.setdefault('pbrMetallicRoughness', {})
            pb.pop('metallicRoughnessTexture', None)
            pb['roughnessFactor'] = f.get('rough', 0.9)
            pb['metallicFactor'] = f.get('metal', 0.0)
            if 'spec' in f:
                m.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': f['spec']}
                eu = js.setdefault('extensionsUsed', [])
                if 'KHR_materials_specular' not in eu:
                    eu.append('KHR_materials_specular')
    write_glb(p, js, b)


GROUND_EMIT = ('dust', 'prop_wash', 'rotor_wash', 'mud', 'snow_spray')


def ground_snap():
    """Ground-level metadata placed in the body frame (exit sockets, dust / wash emitters) would end up under or above
    the ground after the three-point levelling / wreck tilt: put it back on the ground plane (game y = 0.02)."""
    names = set()
    for d in VH.VM['sockets']:
        if d.get('role') == 'exit' or d.get('on_ground'):
            d['pos'][1] = 0.0
            names.add(d['name'])
    VH.VM['_blender'] = [(n, (p[0], p[1], 0.0) if n in names else p, nd) for n, p, nd in VH.VM.get('_blender', [])]
    for d in VH.VM['emitters']:
        if d.get('kind') in GROUND_EMIT:
            d['pos'][1] = 0.05


def _b(g):
    return V((g[0], -g[2], g[1]))


def transform_all(T):
    """VH.apply_T + rotate node frames, hinge/axis/dir metadata (apply_T only moves positions)."""
    R = T.to_3x3()
    VH.apply_T(T)
    for k in list(FRAMES):
        FRAMES[k] = R @ FRAMES[k]
    for key in ('sockets', 'emitters', 'lights', 'moving'):
        for d in VH.VM[key]:
            for f in ('dir', 'axis_world'):
                if f in d and d[f]:
                    d[f] = VH.Gd(R @ _b(d[f]))
            if 'hinge' in d:
                d['hinge'] = [VH.G(T @ _b(h)) for h in d['hinge']]


def level(main_c, main_r, tail_c, tail_r, sym=False):
    """Three-point attitude: rotate the body-frame airframe about X so both main wheels and the tail wheel touch the
    ground, drop it to z=0 and centre the bbox on the origin. Returns the ground angle (deg, nose up)."""
    mc, tc = V(main_c), V(tail_c)
    best = None
    for i in range(-400, 401):
        th = math.radians(i * 0.05)
        R = Matrix.Rotation(th, 3, 'X')
        dz = abs((R @ mc).z - main_r - ((R @ tc).z - tail_r))
        if best is None or dz < best[0]:
            best = (dz, th)
    th = best[1]
    R = Matrix.Rotation(th, 4, 'X')
    z0 = (R @ mc).z - main_r
    T = Matrix.Translation((0, 0, -z0)) @ R
    transform_all(T)
    recentre(sym)
    piv = {d['node']: d['pivot'] for d in VH.VM['moving']}
    for d in VH.VM['contacts']:
        if d.get('node') in piv:
            q = piv[d['node']]
            d['pos'] = [q[0], 0.0, q[2]]
    return math.degrees(th)


def recentre(sym=False):
    xs, ys = [], []
    for o in C.A.parts:
        for v in o.data.vertices:
            xs.append(v.co.x)
            ys.append(v.co.y)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    if sym:
        cx = 0.0                                    # airframe built symmetric about x=0: keep pivots symmetric
    transform_all(Matrix.Translation((-cx, -cy, 0)))


def glass(bm, name='glass', node='main', pivot=None):
    """Dirty cockpit glazing (kit glass_dirty: reflective, streaked). Burnt: shattered / gone."""
    if CUR['var'] == 'burnt':
        bm.free()
        return None
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    ob = C.part(bm, 'glass_dirty', name, uv='aligned', node=node, grime=0, bisect=False, jitter=0.1, smooth=True)
    if pivot is not None:
        ob['kit_pivot'] = list(pivot)
    return ob


def G_(builder, *a, **kw):
    nm, nd, pv = kw.pop('name', 'glass'), kw.pop('node', 'main'), kw.pop('pivot', None)
    bm = bmesh.new()
    builder(bm, *a, **kw)
    return glass(bm, nm, nd, pv)


def frame_bars(pts, w, kind='paint', node='main', closed=True, name='frame'):
    """Canopy / window framing bars along a polyline of points."""
    n = len(pts)
    for i in range(n if closed else n - 1):
        P(kind, beam, pts[i], pts[(i + 1) % n], w, w * 0.6, name=name, node=node)


def hull_bm(bm, pts):
    """Convex hull of points (canopy blocks, fairings)."""
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)


def _ring(c, ax, r, segs):
    ax = V(ax).normalized()
    u = ax.cross(V((0, 0, 1)) if abs(ax.z) < 0.9 else V((1, 0, 0))).normalized()
    w = ax.cross(u).normalized()
    return [V(c) + (u * math.cos(2 * math.pi * k / segs) + w * math.sin(2 * math.pi * k / segs)) * r for k in range(segs)]


def cowl_bm(bm, c, axis, profile, segs=24):
    """Closed annular cowling: profile = [(d, r)...] loop (d along axis from c, r radius), e.g. outer front -> outer
    back -> inner back -> inner front. Faces connect successive rings and the last back to the first."""
    ax = V(axis).normalized()
    rings = [[bm.verts.new(p) for p in _ring(V(c) + ax * d, ax, r, segs)] for d, r in profile]
    for a, b in zip(rings, rings[1:] + rings[:1]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))


def radial_engine(node, c, axis, R, ncyl=9, cyl_r=0.075, crank_r=None, burnt=False, fins=3, seg=8):
    """Air-cooled radial: crankcase + finned cylinders (heads with pushrod tubes) + reduction gear nose."""
    ax = V(axis).normalized()
    u = ax.cross(V((0, 0, 1))).normalized()
    w = ax.cross(u).normalized()
    crank_r = crank_r or R * 0.36
    P('black' if not burnt else 'soot', cyl, V(c) - ax * 0.12, V(c) + ax * 0.10, crank_r, 16, name='crankcase', node=node)
    P('black' if not burnt else 'soot', cyl, V(c) - ax * 0.26, V(c) - ax * 0.12, crank_r * 0.55, 12, name='reduction_gear', node=node)
    for k in range(ncyl):
        a = 2 * math.pi * (k + 0.5) / ncyl
        rd = u * math.cos(a) + w * math.sin(a)
        p0 = V(c) + rd * crank_r * 0.9
        p1 = V(c) + rd * (R - 0.04)
        P('gunmetal' if not burnt else 'soot', cyl, p0, p1, cyl_r, seg, name='cylinder', node=node)
        for f in range(fins):                           # cooling fins
            q = p0.lerp(p1, 0.3 + 0.6 * f / max(1, fins))
            P('gunmetal' if not burnt else 'soot', cyl, q - rd * 0.008, q + rd * 0.008, cyl_r * 1.35, seg, name='fin', node=node, lod='drop')
        P('black' if not burnt else 'soot', beam, V(c) + rd * crank_r - ax * 0.1, p1 - ax * 0.02, 0.018, 0.018, name='pushrod',
          node=node, lod='drop')


VH.FLAT['yellow'] = ((196, 150, 36), 0.5, 0.0)
VH.FLAT['rope'] = ((150, 130, 95), 0.95, 0.0)


def bomb(node, c, L, r, kind='paint_under', fins=True, name='bomb', pivot=None):
    """German SC-series bomb along Y (nose -Y): ogive nose, cylindrical body, tapered tail, cross fins + ring."""
    c = V(c)
    kw = {'node': node, 'pivot': pivot}
    bm = bmesh.new()
    fus_bm(bm, [(c.y - L * 0.5, c.z, r * 0.25, r * 0.25, 2.0, c.x), (c.y - L * 0.42, c.z, r * 1.5, r * 1.5, 2.0, c.x),
                (c.y - L * 0.30, c.z, r * 2, r * 2, 2.0, c.x), (c.y + L * 0.10, c.z, r * 2, r * 2, 2.0, c.x),
                (c.y + L * 0.30, c.z, r * 1.1, r * 1.1, 2.0, c.x), (c.y + L * 0.36, c.z, r * 0.5, r * 0.5, 2.0, c.x)], segs=12)
    VH.vp(bm, kind, name, smooth=True, **kw)
    if fins:
        for a in (45, 135):
            bmf = bmesh.new()
            C.box_bm(bmf, (0, 0, 0), (r * 2.4, L * 0.22, 0.008))
            for v in bmf.verts:
                v.co = Matrix.Rotation(math.radians(a), 3, 'Y') @ v.co + V((c.x, c.y + L * 0.40, c.z))
            VH.vp(bmf, kind, name + '_fin', **kw)
        P(kind, cyl, (c.x, c.y + L * 0.46, c.z), (c.x, c.y + L * 0.51, c.z), r * 1.2, 12, name=name + '_ring', **kw)
    P('yellow', box, (c.x, c.y + L * 0.05, c.z + r * 1.0), (0.02, L * 0.3, 0.004), name=name + '_stripe', **kw)


def _af(f, t, camber, surf):
    """Airfoil surface height (chord units) at chord fraction f: surf=+1 upper, -1 lower (same law as airfoil2d)."""
    yt = 5 * t * (0.2969 * math.sqrt(max(f, 0)) - 0.126 * f - 0.3516 * f ** 2 + 0.2843 * f ** 3 - 0.1036 * f ** 4) + 0.004 * f
    m, p = camber, 0.4
    yc = m / p ** 2 * (2 * p * f - f * f) if f < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * f - f * f)
    return yc + surf * yt


def corr_surface(bm, st0, st1, pitch=0.1, depth=0.02, f0=0.03, f1=0.97, k=6, cdir=(0, 1, 0), udir=(0, 0, 1),
                 camber=0.03, surf=1, lift=0.004, trap=False, uv_off=0.0, fs=None):
    """Junkers corrugated skin as real geometry over a lofted surface: a triangle-wave sheet whose ridges run along
    the chord (streamwise), laid `lift` above the upper (surf=+1) or lower (surf=-1) surface between wing stations
    st0 -> st1 = (le, chord, t). Flat-shade it (skin sharp < ridge angle) so the ridges read as light/dark stripes."""
    cd, ud = V(cdir).normalized(), V(udir).normalized()
    if fs:
        k = len(fs)
    le0, le1 = V(st0[0]), V(st1[0])
    span = (le1 - le0).length
    step = pitch / 4 if trap else pitch / 2           # trap: valley-flat / slope / crest-flat / slope, smooth-shaded
    nl = max(2, int(round(span / step)) + 1)
    lines = []
    for i in range(nl):
        a = i / (nl - 1)
        le = le0.lerp(le1, a)
        ch = st0[1] + (st1[1] - st0[1]) * a
        t = st0[2] + (st1[2] - st0[2]) * a
        h = (depth if i % 4 in (1, 2) else 0.0) if trap else (depth if i % 2 else 0.0)
        row = []
        for j in range(k):
            f = fs[j] if fs else f0 + (f1 - f0) * j / (k - 1)
            row.append(bm.verts.new(le + cd * (f * ch) + ud * (surf * (lift + h) + _af(f, t, camber, surf) * ch)))
        lines.append(row)
    t_ = C.tile_of('air_skin')
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    uvw = {}
    for i in range(nl):                                  # continuous UVs (u chord, v span) -> shared vertices
        a = i / (nl - 1)
        ch = st0[1] + (st1[1] - st0[1]) * a
        for j in range(k):
            f = fs[j] if fs else f0 + (f1 - f0) * j / (k - 1)
            uvw[lines[i][j]] = ((f * ch) / t_, (i * step + uv_off) / t_)
    for i in range(nl - 1):
        for j in range(k - 1):
            f = bm.faces.new((lines[i][j], lines[i][j + 1], lines[i + 1][j + 1], lines[i + 1][j]))
            f.normal_update()
            if f.normal.dot(ud) * surf < 0:
                f.normal_flip()
            for l in f.loops:
                l[lay].uv = uvw[l.vert]
    return bm


VH.FLAT['rust'] = ((92, 56, 38), 0.8, 0.3)
VH.FLAT['heat_steel'] = ((50, 44, 50), 0.55, 0.6)      # heat-blued, sooted exhaust steel
VH.FLAT['soot_stain'] = ((44, 40, 36), 0.95, 0.0)      # exhaust staining streaked along a cowl
VH.FLAT['rlm02'] = ((100, 102, 88), 0.75, 0.0)       # cockpit interior grey-green
VH.FLAT['webbing'] = ((150, 132, 100), 0.9, 0.0)


def insert_stations(fus, ys):
    """Fuselage station list with linearly interpolated stations inserted at ys (so cut-outs land on face rows)."""
    out = list(fus)
    for y in ys:
        for a, b in zip(out[:-1], out[1:]):
            if a[0] < y < b[0]:
                t = (y - a[0]) / (b[0] - a[0])
                out.insert(out.index(b), tuple([y] + [a[i] + (b[i] - a[i]) * t for i in range(1, len(a))]))
                break
    return out


def cut_opening(bm, y0, y1, xhalf, nz=0.3):
    """Delete the top-decking faces of a lofted fuselage bmesh over y0..y1, |x| < xhalf. Returns the boundary edges of
    the hole (list of (p0, p1)) so a coaming can be laid exactly on the cut edge."""
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        f.normal_update()
        if f.normal.z > nz and abs(c.x) < xhalf and y0 < c.y < y1:
            kill.append(f)
    ks = set(kill)
    edges = []
    for f in kill:
        for e in f.edges:
            if sum(1 for g in e.link_faces if g not in ks) == 1:
                edges.append((e.verts[0].co.copy(), e.verts[1].co.copy()))
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    return edges


def cockpit_tub(fus, y0, y1, xhalf, shrink=0.94, kind='rlm02', segs=16, nz=0.3, name='cockpit_tub', node='main'):
    """Inward-facing inner shell of the fuselage between y0..y1 (shrunk copy of the same superellipse sections, so it
    can never poke through the skin) with the opening removed, plus front / rear bulkheads."""
    st = [s for s in insert_stations(fus, (y0, y1)) if y0 - 1e-6 <= s[0] <= y1 + 1e-6]
    rings = []
    for s in st:
        y, zc, w, h, ne = s[:5]
        xc = s[5] if len(s) > 5 else 0.0
        r = VH.superellipse(xc, zc - h / 2, w, h, ne, segs, y, flat_bottom=False)
        rings.append([V((xc + (p.x - xc) * shrink, p.y, zc + (p.z - zc) * shrink)) for p in r])
    bm = bmesh.new()
    C.loft_bm(bm, rings, True, True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.normal_flip()
    bm.normal_update()
    kill = [f for f in bm.faces if abs(f.normal.y) < 0.7 and f.normal.z < -nz and abs(f.calc_center_median().x) < xhalf]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    return VH.vp(bm, kind, name, node=node, recalc=False, grime=0.3)


def scale_y(K, y0, skip_nodes=()):
    """Scale the body-frame airframe along Y about y0 (length correction) - geometry, sockets / emitters / lights /
    moving pivots and hinges; hinge node frames are rebuilt from the scaled hinge lines. Nodes in skip_nodes (e.g. a
    rotor centred on y0) keep their shape."""
    def sy(p):
        return V((p.x, y0 + (p.y - y0) * K, p.z))
    for o in C.A.parts:
        if o.get('kit_node', 'main') in skip_nodes:
            continue
        for v in o.data.vertices:
            v.co = sy(v.co)
        if o.get('kit_pivot'):
            o['kit_pivot'] = list(sy(V(o['kit_pivot'])))
    for key in ('sockets', 'emitters', 'lights', 'moving', 'contacts'):
        for d in VH.VM[key]:
            for f in ('pos', 'pivot'):
                if f in d and d[f]:
                    d[f] = VH.G(sy(_b(d[f])))
            if 'hinge' in d:
                h = [sy(_b(q)) for q in d['hinge']]
                d['hinge'] = [VH.G(q) for q in h]
                d['axis_world'] = VH.Gd(h[1] - h[0])
                FRAMES[d['node']] = frame_for(h[1] - h[0])
    VH.VM['_blender'] = [(n, tuple(sy(V(p))), nd) for n, p, nd in VH.VM.get('_blender', [])]


def warp(fn, skip_nodes=()):
    """Generic body-frame deformation p -> fn(p) (piecewise length corrections): geometry, pivots, sockets / emitters /
    lights / contacts, hinge lines (node frames rebuilt from the warped hinge)."""
    for o in C.A.parts:
        if o.get('kit_node', 'main') in skip_nodes:
            continue
        for v in o.data.vertices:
            v.co = fn(V(v.co))
        if o.get('kit_pivot'):
            o['kit_pivot'] = list(fn(V(o['kit_pivot'])))
    for key in ('sockets', 'emitters', 'lights', 'moving', 'contacts'):
        for d in VH.VM[key]:
            for f in ('pos', 'pivot'):
                if f in d and d[f]:
                    d[f] = VH.G(fn(_b(d[f])))
            if 'hinge' in d:
                h = [fn(_b(q)) for q in d['hinge']]
                d['hinge'] = [VH.G(q) for q in h]
                d['axis_world'] = VH.Gd(h[1] - h[0])
                FRAMES[d['node']] = frame_for(h[1] - h[0])
    VH.VM['_blender'] = [(n, tuple(fn(V(p))), nd) for n, p, nd in VH.VM.get('_blender', [])]


def pw_y(segs):
    """Piecewise-linear y map from [(y_src, y_dst), ...] (sorted; constant shift beyond the ends)."""
    def f(y):
        if y <= segs[0][0]:
            return y + segs[0][1] - segs[0][0]
        for (a, a2), (b, b2) in zip(segs[:-1], segs[1:]):
            if y <= b:
                return a2 + (y - a) * (b2 - a2) / (b - a)
        return y + segs[-1][1] - segs[-1][0]
    return f


def reaim(node, axis):
    """Rotate a spinning node (local +X = spin axis) about its pivot so the spin axis becomes `axis` (Blender frame,
    after levelling): geometry, node frame, moving-metadata axis_world, sockets / emitters parented to the node."""
    fr = FRAMES[node]
    cur = (fr @ V((1, 0, 0))).normalized()
    q = cur.rotation_difference(V(axis).normalized())
    Rm = q.to_matrix()
    piv = None
    for o in C.A.parts:
        if o.get('kit_node') == node and o.get('kit_pivot'):
            piv = V(o['kit_pivot'])
            break
    T = Matrix.Translation(piv) @ Rm.to_4x4() @ Matrix.Translation(-piv)
    for o in C.A.parts:
        if o.get('kit_node') == node:
            o.data.transform(T)
    FRAMES[node] = Rm @ fr
    for d in VH.VM['moving']:
        if d['node'] == node:
            d['axis_world'] = VH.Gd(V(axis))
            d['head_tilt_deg'] = round(math.degrees(V(axis).angle(V((0, 0, 1)))), 1)
    return math.degrees(q.angle)
