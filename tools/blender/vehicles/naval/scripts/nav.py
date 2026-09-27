"""nav.py - SHADOW SIX naval layer on top of veh.py (kit + vehicle metadata).
Convention: Blender Z up, metres; ORIGIN = design waterline at midships (z=0 is the water surface), bow faces -Y
(= glTF +Z = game south at rot 0). Hull below z=0 is split into a separate 'below' surface (anti-fouling paint,
algae/slime band just under the waterline) so the water shader can clip/tint it; sidecar carries draft/freeboard.
Weathering (COLOR_0): algae band, oily scum line, rust streaks from scuppers, salt bleaching, snow (winter), soot (burnt).
"""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh, bpy
from mathutils import Matrix
import kit_core as C

PAL = {}            # colour key -> sRGB for the current asset/variant (set by setup)
SC = 1.0            # weathering scale (metres of algae band etc. scale with hull size)
WOODY = set()       # colour keys that are painted wood (use wood_paint texture instead of veh_paint)

# Kriegsmarine colours 1939-43 (as seen, weathered): Dunkelgrau 51 hull, Hellgrau 50 superstructure,
# Schwarzgrau deck paint, black-grey or red-brown anti-fouling below the boot-top.
KM = {'hull': (80, 84, 86), 'super': (112, 115, 115), 'deck': (62, 64, 64), 'below': (48, 46, 46),
      'boot': (26, 26, 27), 'dark': (40, 42, 42), 'red_af': (96, 40, 32), 'teak': (150, 124, 92)}


def setup(name, variant, pal, scale=1.0, seed=7, heights=None):
    global PAL, SC
    a = VH.setup(name, variant, seed=seed)
    PAL = dict(pal)
    SC = scale
    C.grime_color = grime_naval
    a.grime_heights = heights or [h * scale for h in (-0.7, -0.25, -0.05, 0.12, 0.45, 1.2)]
    VH.GROUND_Z = -50.0
    return a


def base():
    return VH.paint_base()


def _n(p, s):
    return VH._n(p, s)


ALGAE = V((0.20, 0.24, 0.12))
SCUM = V((0.16, 0.14, 0.11))
RUST = V((0.42, 0.20, 0.09))
SALT = V((0.86, 0.85, 0.80))


FIRE = []           # burnt: fire sources [(x, y, z, radius)] (open hatches, bridge, breach): soot plumes rise from them
BURN_PAINT = False  # set by np_ while a painted part of a burnt variant is coloured (burn field on veh_paint)
PAINT_MEAN = 0.79   # veh_paint texture mean (vertex colour = absolute colour / mean)
BURN_L, BURN_MAXF = None, 260   # burnt densify edge length override / max faces per part (big ships: coarser)


def _sm(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def burn_field(p, n, tint):
    """Fire-gutted painted steel as a continuous world-space field (no tiling texture): the heat of each fire source
    burns the paint off to bare dark steel with heat-scale rust; around it blistered, bleached paint; soot plumes
    rise from the sources (streaked upward); away from the fire the grey paint survives, only smoke-stained."""
    s = SC
    top = max(0.0, n.z - 0.3) / 0.7
    heat, plume = 0.0, 0.0
    for fx, fy, fz, r in FIRE:
        dx, dy, dz = p.x - fx, p.y - fy, p.z - fz
        dh = math.sqrt(dx * dx + dy * dy)
        heat = max(heat, math.exp(-(dh * dh + dz * dz * 0.5) / (r * r)))
        if dz > -0.2 * r:            # smoke rises: a plume above the source, widening with height
            w = r * (0.8 + 0.25 * max(0.0, dz) / r)
            plume = max(plume, math.exp(-(dh / w) ** 2) * math.exp(-max(0.0, dz) / (5.0 * r)))
    nb = _n(p, 1.1 / s)
    heat = min(1.0, heat * (0.75 + 0.5 * nb) + 0.42 * _sm(0.35, 0.8, _n(p + V((5.5, 3.3, 1.9)), 0.7 / s)) * (0.4 + 0.6 * top))
    paint = V(tint) * PAINT_MEAN * 0.62                                          # smoke-darkened surviving paint
    steel = V((0.12, 0.115, 0.11)).lerp(V((0.23, 0.12, 0.065)), _sm(0.45, 0.75, _n(p + V((3.3, 1.1, 0.7)), 2.3 / s)))
    blister = V((0.52, 0.48, 0.45)).lerp(V((0.30, 0.27, 0.25)), _sm(0.4, 0.7, _n(p, 9.0 / s)))
    c = paint.lerp(blister, _sm(0.18, 0.45, heat) * (0.55 + 0.45 * _sm(0.5, 0.62, _n(p + V((9.1, 2.2, 5.0)), 3.2 / s))))
    c = c.lerp(steel, _sm(0.45, 0.8, heat + 0.25 * (_n(p + V((1.7, 7.3, 2.9)), 1.8 / s) - 0.5)))
    streak = _n(V((p.x * 3.0, p.y * 3.0, p.z * 0.35)), 1.4 / s)                   # vertical soot run
    soot = min(0.93, 0.12 + 0.75 * plume * (0.7 + 0.6 * streak) + 0.35 * heat * top + 0.18 * top)
    c = c.lerp(V((0.028, 0.026, 0.025)), soot)
    c = c.lerp(V((0.50, 0.49, 0.47)), min(0.35, top * heat * _sm(0.55, 0.7, _n(p, 2.0 / s))))   # settled ash
    return c / PAINT_MEAN


def grime_naval(p, n, amt=1.0, tint=(1, 1, 1)):
    c = V(tint)
    if amt <= 0:
        return c
    if BURN_PAINT and p.z / SC >= 0.02:
        c = burn_field(p, n, tint)
        c *= 0.92 + 0.12 * _n(p, 0.8 / SC)
        return V((min(c.x, 1.0), min(c.y, 1.0), min(c.z, 1.0)))
    b = base()
    z = p.z / SC
    side = 1 - abs(n.z)
    if z < 0.02:                                    # under water: algae band just below the line, slime deeper
        k = math.exp(-((z + 0.12) / 0.22) ** 2) * (0.55 + 0.6 * _n(p, 3.1 / SC)) + 0.25 * min(1.0, -z / 1.5)
        c = c.lerp(ALGAE, min(0.8, k * amt))
        c *= 0.85 + 0.1 * _n(p, 0.7)
    else:
        if z < 0.18:                                # oily scum line along the waterline
            c = c.lerp(SCUM, (1 - z / 0.18) * 0.55 * amt * (0.5 + _n(p, 5.0 / SC)))
        # rust streaks running down the sides (stretched noise), stronger low on the hull
        st = max(0.0, _n(V((p.x * 6 / SC, p.y * 6 / SC, p.z * 0.4 / SC)), 1.0) - 0.6) * 2.2
        c = c.lerp(RUST, min(0.6, st * side * amt * (0.8 if b != 'burnt' else 0.3)))
        c = c.lerp(SCUM, side * max(0.0, _n(V((p.x * 2 / SC, p.y * 2 / SC, p.z * 0.25 / SC)), 1.0) - 0.5) * 0.5 * amt)   # grimy run-off
        if b not in ('burnt',) and side > 0.6 and z > 0.1:
            # scupper / fitting rust bleed: narrow vertical runs at irregular spacing, strongest just under the deck edge
            u = (p.y + 0.37 * p.z) / (1.7 * SC) + 0.5 * _n(V((0.0, p.y, 0.0)), 0.3 / SC)
            f = u - math.floor(u)
            run = math.exp(-((f - 0.5) / 0.08) ** 2) * _sm(0.55, 0.75, _n(V((p.x, p.y * 0.8, 0.0)), 0.9 / SC))
            run *= min(1.0, 0.35 + 0.65 * _n(V((p.x * 4, p.y * 4, p.z * 0.6)), 1.6 / SC))
            c = c.lerp(RUST * 0.8, min(0.75, run * amt * 0.9))
            # rubbing / fender scuffs: bare dark primer scrapes in a band 0.3-1.0 m above the waterline
            if z < 1.0 / max(SC, 1.0) + 0.3:
                sc = _sm(0.62, 0.7, _n(V((p.x * 6, p.y * 1.5, p.z * 6)), 2.5 / SC))
                c = c.lerp(V((0.22, 0.21, 0.2)), sc * 0.6 * amt)
        top = max(0.0, n.z - 0.3) / 0.7
        if b == 'winter':
            c = c.lerp(V((1.0, 1.0, 1.0)), min(0.9, top ** 1.2 * amt * (0.55 + 0.7 * _n(p, 2.0 / SC))))
            c = c.lerp(V((0.93, 0.95, 0.97)), side * max(0.0, _n(p, 4.0) - 0.55) * 0.9 * amt)   # rime/ice spray
        elif b == 'burnt':
            soot = V((0.03, 0.028, 0.026))
            k = min(1.0, (0.3 + 0.6 * _n(p, 1.2 / SC) + 0.3 * top) * amt)
            c = c.lerp(soot, k * 0.55)
        else:
            c = c.lerp(SALT, top * max(0.0, _n(p, 2.4 / SC) - 0.45) * 0.45 * amt)          # salt bloom on decks
    c *= 0.9 + 0.16 * _n(p, 0.8 / SC)
    return V((min(c.x, 1.0), min(c.y, 1.0), min(c.z, 1.0)))


def np_(bm, key, name=None, node='main', pivot=None, uv='aligned', grime=None, smooth=False, lod=None, axis=None,
        rot90=False, uv_scale=1.0, jitter=0.03, dens=None):
    """Naval part. key = palette colour key (painted steel/wood), a veh FLAT kind ('rubber','glass','black',...), or a
    textured kind: 'planks' (deck planks), 'wood' (bare weathered), 'tarred', 'canvas', 'rope', 'metal', 'rubberfab'."""
    b = base()
    # decks: weathered grey planking (timber_grey), not orange varnished deck boards: small craft grey-brown,
    # U-boat near grey-black, Bismarck's teak bleached pale grey-tan
    tex = {'planks': ('timber_grey', (0.86, 0.80, 0.72)), 'planks_dark': ('timber_grey', (0.40, 0.40, 0.39)), 'teak': ('timber_grey', (1.0, 0.95, 0.86)), 'wood': ('timber_grey', (0.85, 0.8, 0.74)), 'tarred': ('timber_tarred', None),
           'canvas': ('canvas', (0.7, 0.7, 0.62)), 'tarcanvas': ('canvas', (0.30, 0.27, 0.29)),
           'net': ('hessian', (0.62, 0.46, 0.34)), 'net_tar': ('hessian', (0.30, 0.27, 0.24)), 'rope': ('hessian', (0.85, 0.78, 0.62)), 'metal': ('cast_iron', None),
           'rubberfab': ('canvas', (0.16, 0.16, 0.16)), 'galv': ('steel_galv', None)}
    if key in tex:
        mid, t = tex[key]
        if b == 'burnt' and key in ('planks', 'planks_dark', 'teak', 'wood', 'canvas', 'rope', 'tarcanvas', 'net', 'net_tar'):
            mid, t = 'timber_creosote', (0.38, 0.34, 0.31)
        if b == 'burnt' and key == 'rubberfab':
            t = (0.08, 0.08, 0.08)
        ob = C.part(bm, mid, name, uv=uv, node=node, grime=grime, smooth=smooth, lod=lod, mat_tint=t, axis=axis,
                    rot90=rot90, uv_scale=uv_scale, jitter=jitter)
    elif key in PAL:
        rgb = PAL[key]
        global BURN_PAINT
        burn = b == 'burnt' and key not in ('below', 'red_af')
        mid = 'wood_paint' if key in WOODY else 'veh_paint'
        vc = tuple(min(1.0, rgb[i] / 255.0 / C.MATS[mid]['mean'][i]) for i in range(3))
        if burn or dens:
            _densify(bm, dens or BURN_L or max(0.9 * SC, 0.45), 600 if dens else BURN_MAXF)
        BURN_PAINT = burn
        try:
            ob = C.part(bm, mid, name, uv=uv, node=node, grime=grime, smooth=smooth, lod=lod, axis=axis, rot90=rot90,
                        uv_scale=uv_scale, jitter=jitter, tint=vc)
        finally:
            BURN_PAINT = False
    else:
        return VH.vp(bm, key, name, node=node, pivot=pivot, uv=uv, grime=grime, smooth=smooth, lod=lod)
    if pivot is not None:
        ob['kit_pivot'] = list(pivot)
    return ob


def _densify(bm, L, max_faces=900):
    """Split long edges so the vertex-colour burn field has resolution on big flat plates."""
    for _ in range(4):
        if len(bm.faces) > max_faces:
            break
        long_e = [e for e in bm.edges if e.calc_length() > L]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])


def NP(key, builder, *a, **kw):
    pkw = {k: kw.pop(k) for k in list(kw) if k in ('name', 'node', 'pivot', 'uv', 'grime', 'smooth', 'lod', 'axis', 'rot90', 'uv_scale')}
    bm = bmesh.new()
    builder(bm, *a, **kw)
    return np_(bm, key, **pkw)


# ------------------------------------------------------------------ hull
def _cr(pts, t):
    """Catmull-Rom through a list of floats at parameter t in [0, len-1]."""
    i = min(int(t), len(pts) - 2)
    f = t - i
    p0, p1, p2 = pts[max(i - 1, 0)], pts[i], pts[i + 1]
    p3 = pts[min(i + 2, len(pts) - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


class Hull:
    """Parametric hull from control stations [(y, half_beam_at_sheer, z_sheer, z_keel, n_exp)], bow (-Y) first.
    n_exp: section superellipse exponent (2 round bilge, 3-5 full U midships, <1.6 V bow)."""

    def __init__(self, st, res=24, m=9, lap=0.0):
        self.st, self.lap = st, lap
        self.res, self.m = res, m
        k = len(st) - 1
        self.S = []
        for i in range(res + 1):
            t = k * i / res
            self.S.append(tuple(_cr([s[j] for s in st], t) for j in range(5)))

    def at(self, y):
        """Interpolated station params at y."""
        S = self.S
        if y <= S[0][0]:
            return S[0]
        for a, b in zip(S[:-1], S[1:]):
            if a[0] <= y <= b[0]:
                f = (y - a[0]) / max(1e-6, b[0] - a[0])
                return tuple(a[j] + (b[j] - a[j]) * f for j in range(5))
        return S[-1]

    def half(self, s, u):
        y, hb, zs, zk, n = s
        th = u * math.pi / 2
        n = max(0.6, n)
        x = max(0.004, hb) * (abs(math.cos(th)) ** (2 / n))
        z = zs - (zs - zk) * (abs(math.sin(th)) ** (2 / n))
        return x, z

    def hb_at(self, y, z):
        """Half-breadth of the outer shell at station y, height z."""
        s = self.at(y)
        best = 0.0
        for i in range(41):
            x, zz = self.half(s, i / 40)
            if zz <= z:
                return x
            best = x
        return best

    def ring(self, s, inset=0.0):
        """Closed-bottom open-top section: port sheer -> keel -> starboard sheer."""
        pts = []
        for i in range(self.m + 1):
            x, z = self.half(s, i / self.m)
            if inset:
                x = max(0.0, x - inset)
                z = z + inset
            elif self.lap and 0 < i < self.m and i % 2 == 1:
                x += self.lap                        # clinker: lower edge of each strake laps over the next
            pts.append(V((x, s[0], z)))
        side = [V((p.x, p.y, p.z)) for p in pts]
        port = [V((-p.x, p.y, p.z)) for p in side]
        return port + list(reversed(side))[1:]

    def shell(self, below_key='below', above_key='hull', transom=True, split=0.0, name='hull', node='main',
              smooth=True, inset=0.0, above_name=None):
        """Outer shell split at the waterline (z=split) into two parts; returns (above, below) objects."""
        bm = bmesh.new()
        rings = [self.ring(s, inset) for s in self.S]
        vr = [[bm.verts.new(p) for p in r] for r in rings]
        n = len(rings[0])
        for a, b in zip(vr[:-1], vr[1:]):
            for i in range(n - 1):
                bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
        if transom and self.S[-1][1] > 0.05:
            bm.faces.new(list(reversed(vr[-1])))
        if self.S[0][1] > 0.05:
            bm.faces.new(vr[0])
        if inset:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        return split_z(bm, split, above_key, below_key, above_name or name, name + '_below', node, smooth)

    def deck(self, key='deck', bulwark=0.0, camber=0.03, y0=None, y1=None, name='deck', node='main', inner_key=None,
             rail_w=0.06, uv_scale=1.0, lod=None):
        """Deck surface (cambered) + bulwark inner faces + rail cap between stations y0..y1."""
        S = [s for s in self.S if (y0 is None or s[0] >= y0 - 1e-6) and (y1 is None or s[0] <= y1 + 1e-6)]
        bmd, bmb = bmesh.new(), bmesh.new()
        rd, rb = [], []
        for s in S:
            y, hb, zs, zk, nn = s
            zd = zs - bulwark
            xd = max(0.004, self.hb_at(y, zd) - (rail_w if bulwark > 0 else 0.0))
            rd.append([V((-xd, y, zd)), V((-xd * 0.5, y, zd + camber * 0.75)), V((0, y, zd + camber)),
                       V((xd * 0.5, y, zd + camber * 0.75)), V((xd, y, zd))])
            if bulwark > 0:
                xs = max(0.004, hb - rail_w)
                rb.append([V((xs, y, zs)), V((xd, y, zd)), V((-xd, y, zd)), V((-xs, y, zs))])
        _strip(bmd, rd)
        np_(bmd, key, name, node=node, uv_scale=uv_scale, lod=lod, jitter=0.02)
        if rb:
            bmr = bmesh.new()
            for side in (0, 1):
                _strip(bmb, [[r[0], r[1]] if side == 0 else [r[2], r[3]] for r in rb])
            _strip(bmr, [[V((s[1], s[0], s[2])), V((max(0.004, s[1] - rail_w), s[0], s[2]))] for s in S])
            _strip(bmr, [[V((-max(0.004, s[1] - rail_w), s[0], s[2])), V((-s[1], s[0], s[2]))] for s in S])
            bmesh.ops.reverse_faces(bmb, faces=bmb.faces[:])
            bmesh.ops.reverse_faces(bmr, faces=bmr.faces[:])
            np_(bmb, inner_key or key, name + '_bulwark', node=node, lod=lod)
            np_(bmr, 'dark' if 'dark' in PAL else key, name + '_rail', node=node, lod=lod)


def _strip(bm, rings):
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    return bm


def split_z(bm, z, above_key, below_key, name_a, name_b, node='main', smooth=False):
    """Bisect at z and return (above_part, below_part) with separate surfaces (waterline split)."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    b2 = bm.copy()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < z], context='FACES')
    bmesh.ops.delete(b2, geom=[f for f in b2.faces if f.calc_center_median().z >= z], context='FACES')
    a = np_(bm, above_key, name_a, node=node, smooth=smooth, dens=(max(0.5 * SC, 0.5) if SC <= 2.5 else None)) if bm.faces else None
    b = np_(b2, below_key, name_b, node=node, smooth=smooth) if b2.faces else None
    return a, b


# ------------------------------------------------------------------ fittings
def Tf(piv, yaw_deg=0.0):
    """local -> world mapper: local coords relative to piv, rotated about Z by yaw (0 = facing -Y / bow)."""
    R = Matrix.Rotation(math.radians(yaw_deg), 3, 'Z')
    pv = V(piv)
    return lambda p: tuple(pv + R @ V(p))


def mg34(node, piv, yaw=0.0, shield=True, key='hull', limits=(-150, 150), socket='mg'):
    """MG 34 on a naval pedestal (Sockellafette) with optional splinter shield; node yaws + pitches about piv."""
    T = Tf(piv, yaw)
    kw = dict(node=node, pivot=tuple(piv))
    g = 'gunmetal'
    NP(key, box, T((0, 0.0, -0.03)), (0.10, 0.10, 0.06), name='mg_cradle', **kw)
    NP(g, beam, T((0, 0.14, 0.04)), T((0, -0.22, 0.04)), 0.05, 0.075, name='mg_receiver', **kw)
    NP(g, cyl, T((0, -0.22, 0.04)), T((0, -0.72, 0.04)), 0.022, 8, name='mg_jacket', **kw)
    NP(g, cyl, T((0, -0.72, 0.04)), T((0, -0.80, 0.04)), 0.022, 8, r1=0.017, name='mg_muzzle', **kw)
    NP('black', beam, T((0, 0.14, 0.03)), T((0, 0.42, -0.02)), 0.04, 0.08, name='mg_stock', **kw)
    NP('black', beam, T((0, 0.06, 0.0)), T((0, 0.09, -0.10)), 0.03, 0.022, name='mg_grip', **kw)
    NP(g, cyl, T((-0.03, -0.02, 0.03)), T((-0.13, -0.02, 0.03)), 0.06, 10, name='mg_drum', **kw)
    NP(g, beam, T((0, -0.30, 0.12)), T((0, -0.30, 0.30)), 0.012, 0.012, name='mg_aa_sight', **kw)
    NP(g, VH.ring_torus, T((0, -0.30, 0.34)), 0.05, 0.005, V(T((0, 1, 0))) - V(T((0, 0, 0))), 12, 4, name='mg_ring_sight', lod='drop', **kw)
    if shield:
        # splinter shield: two raked wings with folded outer edges, sized to read from the game camera; painted light
        # (Hellgrau) so the gun position stands out against the Dunkelgrau hull / grey deck
        sk = 'super' if 'super' in PAL else key
        bm = bmesh.new()
        for sx in (-1, 1):
            C.quad(bm, [V(T((sx * 0.05, -0.18, -0.32))), V(T((sx * 0.50, -0.05, -0.32))), V(T((sx * 0.50, -0.05, 0.40))), V(T((sx * 0.05, -0.18, 0.46)))], flip=sx < 0)
            C.quad(bm, [V(T((sx * 0.50, -0.05, -0.32))), V(T((sx * 0.56, 0.12, -0.32))), V(T((sx * 0.56, 0.12, 0.34))), V(T((sx * 0.50, -0.05, 0.40)))], flip=sx < 0)
        _thicken(bm, 0.01)
        np_(bm, sk, 'mg_shield', **kw)
        NP('dark', box, T((0, -0.19, 0.46)), (0.12, 0.02, 0.05), name='mg_shield_notch', **kw)
        for sx in (-1, 1):
            NP('dark', beam, T((sx * 0.05, -0.18, 0.46)), T((sx * 0.50, -0.05, 0.40)), 0.022, 0.022, name='mg_shield_rim', lod='drop', **kw)
    VH.socket('muzzle_' + socket, T((0, -0.80, 0.04)), V(T((0, -1, 0))) - V(T((0, 0, 0))), node=node, weapon='MG34', rpm=900)
    VH.socket('gunner_' + socket, T((0, 0.75, -1.0 + 0.0)), V(T((0, -1, 0))) - V(T((0, 0, 0))), node=None, pose='stand_mg')
    VH.moving(node, 'gun_yaw', piv, (0, 0, 1), limits=limits)
    VH.moving(node, 'gun_pitch', piv, (1, 0, 0), limits=(-10, 75), note='same node: yaw about local Y then pitch about local X (YXZ)')


def _thicken(bm, t):
    r = bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=t)
    return r


def pedestal(p, h, r=0.09, key='hull'):
    NP(key, cyl, (p[0], p[1], p[2]), (p[0], p[1], p[2] + h), r, 10, name='pedestal')
    NP(key, cyl, (p[0], p[1], p[2]), (p[0], p[1], p[2] + 0.04), r * 1.8, 10, name='pedestal_foot')


RAIL_SEG, RAIL_R, RAIL_SP = (5, 4), 1.0, 1.0   # stanchion / wire cross-section segments (big ships (3, 3)), radius + spacing scale


def rail(pts, h=0.9, spacing=1.4, key='dark', wires=2, lod='drop', lod2=True):
    """Guard rail: stanchions along the polyline pts (x,y,z deck points) + wires/tubes."""
    spacing *= RAIL_SP
    L = []
    for a, b in zip(pts[:-1], pts[1:]):
        a, b = V(a), V(b)
        n = max(1, int((b - a).length / spacing))
        for i in range(n):
            L.append(a.lerp(b, i / n))
    L.append(V(pts[-1]))
    bm = bmesh.new()
    for q in L:
        C.cyl_bm(bm, q, q + V((0, 0, h)), 0.014 * RAIL_R, RAIL_SEG[0], caps=False)
    for k in range(wires):
        z = h * (k + 1) / wires
        for a, b in zip(L[:-1], L[1:]):
            C.cyl_bm(bm, a + V((0, 0, z)), b + V((0, 0, z)), (0.009 if k < wires - 1 else 0.014) * RAIL_R, RAIL_SEG[1], caps=False)
    np_(bm, key, 'rail', lod=lod, grime=0.7)
    if lod == 'drop':        # LOD1/2 stand-in (never decimated): square top rail + every 2nd stanchion, so rails survive
        bm = bmesh.new()
        for i, q in enumerate(L):
            if i % 2 == 0 or i == len(L) - 1:
                C.beam_bm(bm, q, q + V((0, 0, h)), 0.03, 0.03)
        for a, b in zip(L[:-1], L[1:]):
            C.beam_bm(bm, a + V((0, 0, h)), b + V((0, 0, h)), 0.035, 0.035)
            if wires > 1:
                C.beam_bm(bm, a + V((0, 0, h * 0.5)), b + V((0, 0, h * 0.5)), 0.02, 0.02)
        np_(bm, key, 'rail_lod', lod='lodonly' if lod2 else 'lodonly1', grime=0.7)


def cowl_vent(p, r=0.12, h=0.6, yaw=0.0, key='super'):
    """Mushroom/cowl ventilator: vertical pipe + bent cowl mouth facing yaw."""
    x, y, z = p
    NP(key, cyl, (x, y, z), (x, y, z + h), r, 10, name='vent_pipe')
    d = V((math.sin(math.radians(yaw)), -math.cos(math.radians(yaw)), 0))
    c = V((x, y, z + h))
    NP(key, cyl, c - d * r * 0.2, c + d * r * 0.9 + V((0, 0, r * 0.9)), r, 10, r1=r * 1.5, name='vent_cowl')
    NP('black', cyl, c + d * r * 0.85 + V((0, 0, r * 0.9)), c + d * r * 0.95 + V((0, 0, r * 0.95)), r * 1.35, 10, name='vent_mouth', lod='drop')


BOLLARD_SEG = 8


def bollard(p, r=0.09, h=0.28, sep=0.3, yaw=0.0):
    d = V((math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0)) * sep / 2
    for s in (-1, 1):
        q = V(p) + d * s
        NP('dark', cyl, q, q + V((0, 0, h)), r, BOLLARD_SEG, name='bollard', lod='drop')
        NP('dark', cyl, q + V((0, 0, h)), q + V((0, 0, h + 0.03)), r * 1.3, BOLLARD_SEG, name='bollard_cap', lod='drop')
    NP('dark', box, (p[0], p[1], p[2] + 0.02), (sep + 2.4 * r, 2.4 * r, 0.04), math.radians(yaw), name='bollard_base', lod='drop')


def life_ring(p, normal, R=0.33, key='white'):
    NP(key, VH.ring_torus, p, R, 0.06, normal, 16, 6, name='life_ring', lod='drop')


def fender(p0, p1, r=0.1):
    NP('rope', cyl, p0, p1, r, 8, name='fender', lod='drop')


def nav_light(name, p, color, direction):
    NP('dark', box, p, (0.14, 0.14, 0.16), name='navlight_box', lod='drop')
    NP(color, box, V(p) + V(direction) * 0.075, (0.08, 0.02, 0.08) if abs(direction[0]) < 0.5 else (0.02, 0.08, 0.08), name='navlight_lens', lod='drop')
    VH.light(name, p, direction, True, kind='nav_' + color)


VH.FLAT['green'] = ((20, 110, 40), 0.3, 0.0)
VH.FLAT['yellow'] = ((170, 140, 40), 0.5, 0.0)


# ------------------------------------------------------------------ finalize
def wake(stern, bow, beam, prop=None):
    """Standard boat emitters: stern wake, bow spray each side, prop wash."""
    VH.emitter('wake', stern, (0, 1, 0), width=round(beam, 2), note='V-wake spawned at the transom on the water plane')
    for sx in (-1, 1):
        VH.emitter('bow_spray', (bow[0] + sx * 0.05, bow[1], bow[2]), (sx * 0.8, -0.4, 0.3), side='l' if sx > 0 else 'r')
    if prop:
        VH.emitter('prop_wash', prop, (0, 1, 0))


LOD_TARGET = (0.41, 0.15)      # LOD1 ~40 %, LOD2 ~15 % of LOD0 triangles (probe + solved decimation ratio)


def finalize(out_root, key, vtype, dims, draft, var, allv, real, extra=None, ao_res=1024, ao_dist=0.8, lods=((0.75, 0.04), (0.34, 0.2)),
             parents=None, frames=None):
    ex = {'real_name': real, 'destroyed': var in ('burnt', 'deflated'), 'rotation_order': 'YXZ', 'side': 'axis',
          'origin': 'design waterline (y=0 is the water surface), midships', 'waterline_y': 0.0, 'draft_m': draft,
          'hull_below_nodes': 'parts named *_below use the anti-fouling surface: clip/tint under the water plane'}
    ex.update(extra or {})
    fast = os.environ.get('NAV_FAST') == '1'          # quick look: no AO bake, written to ../fast/
    if os.environ.get('NAV_STATS'):                   # triangle budget per part name (debug)
        import re
        acc = {}
        for o in C.A.parts:
            if o.name in bpy.data.objects:
                k = re.sub(r'(\.\d+|_[lr]\d*|_\d+)$', '', o.name)
                sm = sum(1 for p in o.data.polygons if p.use_smooth)
                vv = len(o.data.vertices) if sm > len(o.data.polygons) / 2 else len(o.data.loops)
                acc[k] = acc.get(k, 0) + vv
        for k, v in sorted(acc.items(), key=lambda kv: -kv[1])[:40]:
            C.log('STATS %6d %s' % (v, k))
    outdir = os.path.join(out_root, '..', 'fast', key) if fast else os.path.join(out_root, key)
    meta = VH.vfinalize(outdir, vtype, dims, parents=parents, frames=frames, lods=lods, ao_res=ao_res, ao_dist=ao_dist,
                        variants=allv, extra=ex, skip_ao=fast, lod_target=LOD_TARGET)
    f = os.path.join(outdir, C.A.name + '.kit.json')
    m = json.load(open(f))
    bb = m['bbox_game']
    m['pivot'] = 'design waterline at midships; model bow faces +Z (game south at rot 0); hull extends below y=0'
    m['review_water'] = {'level': 0.0, 'bed': round(-draft - 1.5, 2),
                         'rects': [[round(bb['min'][0] - 0.25, 2), -2000, 2000, 2000]], 'land': 0.9, 'fig_y': 0.91}
    m['footprints'][0]['block'] = 'HIGH'
    if dims.get('length', 0) > 20:           # big hulls: review figure on the quay abreast of midships
        m['review_water']['fig_z'] = round((bb['min'][2] + bb['max'][2]) / 2, 2)
    json.dump(m, open(f, 'w'), indent=1)
    check_rig(outdir, C.A.name)
    if not fast:
        meshopt_if_big(outdir, C.A.name)
    return m


def meshopt_if_big(outdir, name, limit=1.8e6):
    """GLBs over the 2 MB budget (battleship) get EXT_meshopt_compression (the engine's GLTFLoader has the meshopt
    decoder, src/engine/assets.js); external library texture uris are preserved. Sidecar lods[] sizes updated."""
    import subprocess
    D = os.path.dirname(os.path.abspath(__file__))
    f = os.path.join(outdir, name + '.kit.json')
    m = json.load(open(f))
    for L in m.get('lods', []):
        p = os.path.join(outdir, L['file'])
        if os.path.getsize(p) <= limit:
            continue
        tmp = p + '.mo.glb'
        subprocess.run(['node', os.path.join(D, 'mo_keepuri.mjs'), p, tmp], check=True, cwd=D)
        subprocess.run(['python3', os.path.join(D, 'mo_fix.py'), p, tmp], check=True)
        L['compression'] = 'KHR_mesh_quantization (NORMAL int8, TEXCOORD uint16) + EXT_meshopt_compression'
        if os.path.getsize(tmp) > 2.0e6:        # still over: 8-bit vertex colours too (burnt: noisy colours pack badly)
            import shutil
            src8 = p + '.c8.glb'
            shutil.copy(p, src8)
            VH._quantize_colors(src8)
            subprocess.run(['node', os.path.join(D, 'mo_keepuri.mjs'), src8, tmp], check=True, cwd=D)
            subprocess.run(['python3', os.path.join(D, 'mo_fix.py'), src8, tmp], check=True)
            os.remove(src8)
            L['compression'] += ' + COLOR_0 uint8'
        os.replace(tmp, p)
        L['bytes'] = os.path.getsize(p)
        C.log('MESHOPT', L['file'], L['bytes'])
    json.dump(m, open(f, 'w'), indent=1)


def check_rig(outdir, name):
    """Every sidecar node / socket name must resolve to exactly one GLB node (no Blender '.001' suffixes)."""
    import glb_post
    m = json.load(open(os.path.join(outdir, name + '.kit.json')))
    for lvl in range(3):
        fn = os.path.join(outdir, name + ('' if lvl == 0 else '_lod%d' % lvl) + '.glb')
        js, _ = glb_post.read_glb(fn)
        names = [n.get('name', '') for n in js.get('nodes', [])]
        bad = [n for n in names if '.0' in n or '__' in n]
        want = set(m['nodes']) | {mv['node'] for mv in m['vehicle'].get('moving', []) if not m['vehicle'].get('destroyed')} | ({s['name'] for s in m['vehicle'].get('sockets', [])} if lvl == 0 else set())
        mov = {mv['node'] for mv in m['vehicle'].get('moving', []) if not m['vehicle'].get('destroyed')}
        miss = sorted(w for w in (want if lvl == 0 else mov) if w not in names)   # LOD1/2 may drop small static nodes, never rig nodes
        dup = sorted({n for n in names if names.count(n) > 1})
        C.log('RIG_CHECK lod%d nodes=%d bad=%s missing=%s dup=%s' % (lvl, len(names), bad, miss, dup))
        if bad or miss or dup:
            raise RuntimeError('RIG_ERROR %s lod%d bad=%s missing=%s dup=%s' % (name, lvl, bad, miss, dup))


def run(main, allv):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else allv[0]).split(',')
    for v in (allv if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))


# ------------------------------------------------------------------ generic section loft (subs / big ships)
def section_loft(bm, secs, cap0=True, cap1=True):
    """secs = [(y, [(x, z), ...])] half profiles on +X from the top centreline around to the bottom centreline
    (equal point counts), bow (-Y) first. Mirrored to a closed ring; returns bm."""
    rings = []
    for y, hp in secs:
        st = [V((x, y, z)) for x, z in hp]
        port = [V((-x, y, z)) for x, z in reversed(hp[1:-1])]
        rings.append(st + port)
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0:
        bm.faces.new(list(reversed(vr[0])))
    if cap1:
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def interp_stations(st, ys):
    """Catmull-Rom interpolate station tuples (y, a, b, c, ...) at the given ys (y strictly increasing)."""
    out = []
    Y = [s[0] for s in st]
    for y in ys:
        k = 0
        while k < len(Y) - 2 and y > Y[k + 1]:
            k += 1
        f = (y - Y[k]) / (Y[k + 1] - Y[k])
        out.append((y,) + tuple(_cr([s[j] for s in st], k + max(0.0, min(1.0, f))) for j in range(1, len(st[0]))))
    return out


def snow_cover(min_z=0.2, depth=0.03, cover=0.28, skip=('rail', 'shroud', 'wire', 'glass', 'lens', 'navlight', 'bk', 'prop', 'lashing',
                                                            'pudding', 'rim', 'davit', 'ladder', '_bar', 'strut', 'rope', 'cork', 'float')):
    """Winter: lay snow slabs (library 'snow_soft') on the up-facing faces above the waterline, patchy by noise."""
    parts = list(C.A.parts)
    for o in parts:
        if o.name not in bpy.data.objects or any(s in o.name for s in skip):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        keep = [f for f in bm.faces if f.normal.z > 0.72 and f.calc_center_median().z > min_z and f.calc_area() > 0.006 * max(1.0, SC) ** 2
                and _n(f.calc_center_median(), 0.9 / max(SC, 0.3)) > cover]
        if not keep:
            bm.free()
            continue
        nb = bmesh.new()
        vm = {}
        for f in keep:
            vs = []
            for v in f.verts:
                if v.index not in vm:
                    vm[v.index] = nb.verts.new(v.co + V((0, 0, depth)))
                vs.append(vm[v.index])
            try:
                nb.faces.new(vs)
            except ValueError:
                pass
        bm.free()
        # thickness: extrude down the slab edges so it reads as a layer from the 40 deg camera
        r = bmesh.ops.extrude_face_region(nb, geom=nb.faces[:])
        for v in [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z -= depth * 1.2
        bmesh.ops.recalc_face_normals(nb, faces=nb.faces[:])
        ob = C.part(nb, 'snow_soft', o.name + '_snow', node=o.get('kit_node', 'main'), grime=0.0, jitter=0.02, bisect=False)
        if o.get('kit_pivot'):
            ob['kit_pivot'] = list(o['kit_pivot'])
        if o.get('kit_lod'):
            ob['kit_lod'] = o['kit_lod']


# ------------------------------------------------------------------ painted text / numbers (tactical/hull numbers only)
def text_bm(txt, height, extrude=0.0):
    """Blender built-in font -> bmesh in the XY plane (x along the text, y up), baseline at 0, left aligned."""
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = txt
    cu.size = height / 0.72          # Bfont cap height ~0.72 of size
    cu.extrude = extrude
    cu.resolution_u = 2
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return bm


def hull_text(txt, hull, y_c, z_base, height, key='white', off=0.012, sides=(-1, 1), name='hull_number', node='main'):
    """Paint `txt` on both bow sides, wrapped onto the hull surface (x = local half-breadth + off); reads bow->aft."""
    for sx in sides:
        bm = text_bm(txt, height)
        xs = [v.co.x for v in bm.verts]
        w = max(xs) - min(xs)
        for v in bm.verts:
            u, h = v.co.x - min(xs) - w / 2, v.co.y
            y = y_c + (u if sx > 0 else -u)             # port (+X) reads bow->stern (+Y), starboard mirrored
            z = z_base + h
            v.co = V((sx * (hull(y, z) + off), y, z))
        bm.normal_update()
        for f in bm.faces:
            if (f.normal.x > 0) != (sx > 0):
                f.normal_flip()
        np_(bm, key, name, node=node, grime=0.4, lod='drop2')


def oval_tube_bm(bm, c, a, b, r, n=28, m=7, e=3.0):
    """Inflatable tube ring: circle section swept round a rounded-rect (superellipse exponent e) path, half-length a
    along Y, half-width b along X, centred on c (the tube centre height)."""
    c = V(c)
    path = []
    for i in range(n):
        t = 2 * math.pi * i / n
        ct, st = math.cos(t), math.sin(t)
        path.append(c + V((b * math.copysign(abs(ct) ** (2 / e), ct), a * math.copysign(abs(st) ** (2 / e), st), 0)))
    rings = []
    for i, q in enumerate(path):
        tng = (path[(i + 1) % n] - path[i - 1]).normalized()
        out = tng.cross(V((0, 0, 1))).normalized()
        if out.dot(q - c) < 0:
            out = -out
        rings.append([bm.verts.new(q + out * r * math.cos(2 * math.pi * k / m) + V((0, 0, r * math.sin(2 * math.pi * k / m)))) for k in range(m)])
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(m):
            try:
                bm.faces.new((A[k], A[(k + 1) % m], B[(k + 1) % m], B[k]))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


# ------------------------------------------------------------------ single-screw stern gear (keel, deadwood, aperture, rudder)
def _slab_yz(bm, prof, t_of):
    """Centreline plate from a closed YZ polygon; t_of(y) = thickness at y (tapers fore/aft edges)."""
    n = len(prof)
    R = [bm.verts.new(V((t_of(y) / 2, y, z))) for y, z in prof]
    L = [bm.verts.new(V((-t_of(y) / 2, y, z))) for y, z in prof]
    bm.faces.new(R)
    bm.faces.new(list(reversed(L)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((R[j], R[i], L[i], L[j]))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='EAR_CLIP')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def hull_zk(H, y):
    return H.at(y)[3]


def bury(H, y, t, cap=0.7):
    """Height above the centreline keel point where the shell is wider than t/2 (so a centreline plate stays inside)."""
    zk = hull_zk(H, y)
    b = 0.04
    while b < cap and H.hb_at(y, zk + b) < t / 2 + 0.02:
        b += 0.04
    return min(b, cap)


def prop(node, pp, R, blades=3, key='brass', hub=0.08, below=True, rpm=400, skew=0.28):
    sfx = '_below' if below else ''
    NP(key, cyl, pp - V((0, R * 0.22, 0)), pp + V((0, R * 0.25, 0)), hub, 10, name='prop_hub' + sfx, node=node, pivot=tuple(pp))
    for k in range(blades):
        a = math.radians(360 * k / blades + 15)
        d = V((math.cos(a), 0, math.sin(a)))
        s = d.cross(V((0, 1, 0)))
        bm = bmesh.new()
        C.quad(bm, [pp + d * hub * 0.8 - V((0, R * 0.14, 0)) - s * R * 0.12, pp + d * R * 0.72 + s * R * skew - V((0, R * 0.05, 0)),
                    pp + d * R + s * R * 0.12, pp + d * hub * 0.8 + V((0, R * 0.14, 0)) + s * R * 0.12])
        _thicken(bm, 0.012 + 0.01 * R)
        np_(bm, key, 'prop_blade' + sfx, node=node, pivot=tuple(pp))
    VH.moving(node, 'propeller', pp, (0, 1, 0), rpm_max=rpm)


def stern_gear(H, keel_z, y_fore, y_pp, y_rp, y_ra, t=0.2, kd=0.28, sole=0.16, prop_r=None, rud_key='below', stock_top=None,
               rudder_node='rudder', prop_node='propeller', blades=3, prop_key='brass', rpm=400, post_w=None):
    """Full-length keel + deadwood plate under the shell (buried into it, no gap), propeller aperture between the
    deadwood (propeller post, y_pp) and the sternpost / rudder post (y_rp), sole piece under the aperture and the rudder
    carrying the heel bearing, rudder hung aft of the post under the counter with its stock rising into the hull.
    Bow = -Y. Returns dict(prop_centre, rudder_pivot, rudder_top)."""
    pw = post_w or t * 0.9
    ys = [y_fore + (y_pp - y_fore) * i / 26 for i in range(27)]
    top = [(y, hull_zk(H, y) + bury(H, y, t)) for y in ys]
    L = y_pp - y_fore
    y_mid = y_fore + 0.45 * L                  # forefoot: keel follows the shell up into the stem; aft: straight keel line + deadwood
    bot = [(y, max(keel_z, hull_zk(H, y) - kd) if y < y_mid else keel_z) for y in reversed(ys)]

    def tk(y):                                  # fine entry at the forefoot
        return t * (0.45 + 0.55 * min(1.0, (y - y_fore) / max(0.3, 0.12 * L)))
    bm = bmesh.new()
    _slab_yz(bm, top + bot, tk)
    np_(bm, 'below', 'keel_deadwood_below', smooth=False)
    # aperture: top = shell bottom over the aperture; sole piece underneath from the deadwood to under the rudder heel
    zs_top = keel_z + sole
    gap = 0.05
    pcy = y_pp + (y_rp - pw - y_pp) * 0.55
    R0 = (hull_zk(H, pcy) - zs_top) / 2 - gap
    z_ap = hull_zk(H, pcy - 0.25 * R0)
    bm = bmesh.new()
    _slab_yz(bm, [(y_pp - 0.1, keel_z + sole), (y_ra + 0.02, keel_z + sole), (y_ra + 0.06, keel_z + sole * 0.4), (y_ra - 0.05, keel_z),
                  (y_pp - 0.1, keel_z)], lambda y: t * 0.85)
    np_(bm, 'below', 'sole_piece_below')
    zt_post = hull_zk(H, y_rp) + bury(H, y_rp, pw)
    bm = bmesh.new()
    _slab_yz(bm, [(y_rp - pw, keel_z + 0.02), (y_rp, keel_z + 0.02), (y_rp, zt_post), (y_rp - pw, zt_post)], lambda y: pw)
    np_(bm, 'below', 'sternpost_below')
    # propeller in the aperture
    R = prop_r or ((z_ap - zs_top) / 2 - gap)
    pc = V((0, pcy, zs_top + gap + R))
    NP('metal', cyl, V((0, y_pp - 0.12, pc.z)), V((0, pc.y, pc.z)), 0.045 + 0.02 * R, 8, name='prop_shaft_below')
    prop(prop_node, pc, R, blades=blades, key=prop_key, rpm=rpm)
    # rudder: hung on the post, top just under the counter, stock into the hull
    zr_top = min(hull_zk(H, y_rp + (y_ra - y_rp) * f) for f in (0.0, 0.33, 0.66, 1.0)) - 0.04
    zr_bot = zs_top + 0.03
    rp = V((0, y_rp + 0.02, zr_bot))
    c = y_ra - y_rp
    bm = bmesh.new()
    _slab_yz(bm, [(y_rp + 0.03, zr_bot), (y_ra - 0.1 * c, zr_bot), (y_ra, zr_bot + 0.12 * (zr_top - zr_bot)), (y_ra, zr_top), (y_rp + 0.03, zr_top)],
             lambda y: max(0.035, 0.11 * t / 0.2 * (1 - 0.6 * (y - y_rp) / c)))
    np_(bm, rud_key, 'rudder_blade_below', node=rudder_node, pivot=tuple(rp))
    st = stock_top if stock_top is not None else zr_top + 0.8
    NP('metal', cyl, V((0, rp.y, zr_top - 0.05)), V((0, rp.y, st)), 0.05 + 0.03 * t / 0.2, 8, name='rudder_stock_below', node=rudder_node, pivot=tuple(rp))
    VH.moving(rudder_node, 'rudder', rp, (0, 0, 1), limits=(-35, 35))
    VH.contact('keel', (0, 0, keel_z), width=t)
    return {'prop': pc, 'rudder_pivot': rp, 'rudder_top': zr_top, 'prop_r': R}


def buckled_rail(pts, h=0.85, spacing=1.1, seed=0, key='dark', r=0.02):
    """Fire-damaged guard rail: heat-bent stanchions (some sheared short), sagging top rail with gaps."""
    bm = bmesh.new()
    k = seed
    tops = []
    for a, b in zip(pts[:-1], pts[1:]):
        a, b = V(a), V(b)
        n = max(1, int((b - a).length / spacing))
        for i in range(n + (1 if b is V(pts[-1]) else 0)):
            p = a.lerp(b, i / n)
            k += 1
            side = V((p.x, 0, 0)).normalized() if abs(p.x) > 0.05 else V((0, 1, 0))
            hh = h * (0.45 if k % 4 == 2 else 1.0)
            lean = side * (0.25 if k % 3 == 0 else 0.06) + V((0, 0.12 * math.sin(k * 2.3), 0))
            t = p + V((0, 0, hh)) + lean * (hh / h)
            C.cyl_bm(bm, p, t, r, 5)
            tops.append((t, k % 4 != 2))
    for (t0, ok0), (t1, ok1) in zip(tops[:-1], tops[1:]):
        if ok0 and ok1 and (hash((round(t0.x, 2), round(t0.y, 2))) % 3):
            m = t0.lerp(t1, 0.5) - V((0, 0, 0.18))
            C.cyl_bm(bm, t0, m, r * 0.9, 4)
            C.cyl_bm(bm, m, t1, r * 0.9, 4)
    np_(bm, key, 'rail_buckled', lod='drop')


def pose(nodes, pivot, deg, axis=(0, 0, 1)):
    """Wreck pose: rotate every part of the given nodes (a turret and its child gun, say) about one pivot."""
    pv = V(pivot)
    R = Matrix.Translation(pv) @ Matrix.Rotation(math.radians(deg), 4, V(axis)) @ Matrix.Translation(-pv)
    for o in C.A.parts:
        if o.get('kit_node') in nodes:
            o.data.transform(R)
            if o.get('kit_pivot'):
                o['kit_pivot'] = list(R @ V(o['kit_pivot']))


def hull_hole(bm, pts, sx, hx, depth=0.05):
    """Ragged black hole decal on a hull side: pts = [(y, z)] outline, projected onto the shell hx(y, z) on side sx."""
    c = V((0, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
    vs = [bm.verts.new(V((sx * (hx(y, z) + depth), y, z))) for y, z in pts]
    cv = bm.verts.new(V((sx * (hx(c.y, c.z) + depth * 0.5), c.y, c.z)))
    for a, b in zip(vs, vs[1:] + vs[:1]):
        f = bm.faces.new((cv, a, b) if sx > 0 else (cv, b, a))
    return bm
