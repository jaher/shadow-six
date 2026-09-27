"""Kit roofs: gable / hip / shed / flat-walkable / sod, ridge caps, eaves (fascia, bargeboards, gutters, downpipes),
chimneys, dormers."""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix
import kit_core as C
from kit_core import part, box_bm, beam_bm, cyl_bm, rng


class Roof:
    """Result of a roof builder: local frame (centre, ridge axis ax, across axis ay), eave/ridge heights, slopes."""

    def __init__(s, **kw):
        s.__dict__.update(kw)

    def w(s, lx, ly, z):
        """local (along ridge, across, z) -> world"""
        return s.c + s.ax * lx + s.ay * ly + V((0, 0, z))


def slab_bm(bm, q, thick, nu=4, nv=4, sag=0.0, wobble=0.0, seed=0):
    """Thick roof slab from 4 top corners q = (eave_l, eave_r, top_r, top_l); grid-subdivided, sagging surface."""
    r = rng()
    top = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            p = q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v)
            if 0 < i < nu and 0 < j < nv:
                p = p + V((0, 0, -sag * math.sin(math.pi * u) * math.sin(math.pi * v) + r.uniform(-wobble, wobble)))
            row.append(p)
        top.append(row)
    n = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
    if n.z < 0:
        n = -n
    vt = [[bm.verts.new(p) for p in row] for row in top]
    vb = [[bm.verts.new(p - n * thick) for p in row] for row in top]
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((vt[j][i], vt[j][i + 1], vt[j + 1][i + 1], vt[j + 1][i]))
            bm.faces.new((vb[j][i], vb[j + 1][i], vb[j + 1][i + 1], vb[j][i + 1]))
    ring = [vt[0][i] for i in range(nu + 1)] + [vt[j][nu] for j in range(1, nv + 1)] + \
           [vt[nv][i] for i in range(nu - 1, -1, -1)] + [vt[j][0] for j in range(nv - 1, 0, -1)]
    ringb = [vb[0][i] for i in range(nu + 1)] + [vb[j][nu] for j in range(1, nv + 1)] + \
            [vb[nv][i] for i in range(nu - 1, -1, -1)] + [vb[j][0] for j in range(nv - 1, 0, -1)]
    for k in range(len(ring)):
        l = (k + 1) % len(ring)
        bm.faces.new((ring[l], ring[k], ringb[k], ringb[l]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return n


def _frame(cx, cy, rot):
    ax = V((math.cos(rot), math.sin(rot), 0))
    ay = V((-ax.y, ax.x, 0))
    return V((cx, cy, 0)), ax, ay


def roof_gable(cx, cy, L, W, z_eave, pitch=45.0, mid='roof_slate', rot=0.0, eave_oh=0.35, gable_oh=0.25, thick=0.12,
               ridge='auto', fascia='timber_beam', barge='timber_beam', gutters=True, gutter_mid='cast_iron',
               sag=0.035, wobble=0.012, name='roof', snow=None, hip=False, sod=False, walk=False):
    """Gable (or hip=True) roof over a W (across) x L (along ridge) wall rectangle centred (cx,cy), ridge along
    rotation `rot` (0 = ridge along X). z_eave = wall-plate height. Returns Roof with z_ridge etc."""
    c, ax, ay = _frame(cx, cy, rot)
    t = math.tan(math.radians(pitch))
    rise = (W / 2) * t
    z_r = z_eave + rise
    R = Roof(c=c, ax=ax, ay=ay, L=L, W=W, z_eave=z_eave, z_ridge=z_r, pitch=pitch, rot=rot, mid=mid)
    lift = thick / math.cos(math.radians(pitch))       # slab underside passes through the wall-plate line
    R.lift = lift
    R.z_ridge = z_r + lift
    Lh, ze = L / 2 + (0 if hip else gable_oh), z_eave - eave_oh * t + lift
    yw = W / 2 + eave_oh
    nu = max(3, int(L / 1.6))
    nv = max(3, int(yw / 1.2))
    parts = []
    hip_in = (W / 2 + eave_oh) if hip else 0.0
    for s in (-1, 1):
        bm = bmesh.new()
        q = [R.w(-Lh, s * yw, ze), R.w(Lh, s * yw, ze), R.w(Lh - hip_in, 0, z_r + lift + 0.02), R.w(-Lh + hip_in, 0, z_r + lift + 0.02)]
        if s > 0:
            q = [q[1], q[0], q[3], q[2]]
        slab_bm(bm, q, thick, nu, nv, sag, wobble)
        parts.append(part(bm, mid, name='%s_slope%d' % (name, s)))
    if hip:
        for s in (-1, 1):
            bm = bmesh.new()
            e0, e1 = R.w(s * Lh, -s * yw, ze), R.w(s * Lh, s * yw, ze)
            apex = R.w(s * (Lh - hip_in), 0, z_r + lift + 0.02)
            slab_bm(bm, [e0, e1, apex, apex + (e0 - e1) * 1e-3], thick, max(3, int(W / 1.2)), 3, sag * 0.5, wobble)
            parts.append(part(bm, mid, name='%s_hip%d' % (name, s)))
    # ridge cap
    if ridge:
        rk = ridge if ridge != 'auto' else ('round' if mid in ('roof_terracotta',) else ('turf' if sod else 'angle'))
        bm = bmesh.new()
        a, b = R.w(-Lh + hip_in, 0, z_r + lift + 0.03), R.w(Lh - hip_in, 0, z_r + lift + 0.03)
        if rk == 'round':
            n = max(2, int((b - a).length / 0.42))
            for i in range(n):
                p0, p1 = a.lerp(b, i / n), a.lerp(b, (i + 1) / n + 0.02)
                cyl_bm(bm, p0, p1, 0.13, 10, r1=0.12)
            parts.append(part(bm, mid, name=name + '_ridge', smooth=True))
        elif rk in ('angle', 'turf'):
            cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
            k = 0.2 if rk == 'angle' else 0.35
            prof = [V((0, 0, 0.05)), V((0, k * cp, 0.05 - k * sp)), V((0, k * cp, -k * sp - 0.03)), V((0, -k * cp, -k * sp - 0.03)), V((0, -k * cp, 0.05 - k * sp))]
            rings = []
            for p0 in (a, b):
                rings.append([p0 + ay * q.y + V((0, 0, q.z)) for q in prof])
            C.loft_bm(bm, rings)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            rm = 'sod' if rk == 'turf' else ('roof_slate' if mid in ('roof_slate', 'corrugated_rust') else 'timber_grey')
            parts.append(part(bm, rm, name=name + '_ridge'))
    # fascia boards + gutters along the eaves, bargeboards on the gable verges
    bm = bmesh.new()
    for s in (-1, 1):
        if fascia:
            e = R.w(0, s * (yw + 0.01), ze - 0.06)
            beam_bm(bm, e - ax * Lh, e + ax * Lh, 0.03, 0.2, up=(0, 0, 1))
        if barge and not hip:
            for k in (-1, 1):
                p0 = R.w(s * (Lh + 0.015), k * (yw + 0.02), ze - 0.05)
                p1 = R.w(s * (Lh + 0.015), 0, z_r + lift - 0.03)
                beam_bm(bm, p0, p1, 0.035, 0.24, up=(0, 0, 1))
    if fascia or barge:
        parts.append(part(bm, fascia or barge, name=name + '_fascia', uv='beam', axis=tuple(ax)))
    if gutters:
        bm = bmesh.new()
        for s in (-1, 1):
            g = R.w(0, s * (yw + 0.09), ze - 0.12)
            cyl_bm(bm, g - ax * Lh, g + ax * Lh, 0.065, 8)
            for k in (-1, 1):                              # downpipes at the corners
                x = k * (L / 2 - 0.25)
                top = R.w(x, s * (yw + 0.09), ze - 0.14)
                wall = R.w(x, s * (W / 2 + 0.07), ze - 0.5)
                foot = R.w(x, s * (W / 2 + 0.07), 0.3)
                shoe = R.w(x, s * (W / 2 + 0.3), 0.1)
                cyl_bm(bm, top, wall, 0.045, 8)
                cyl_bm(bm, wall, foot, 0.045, 8)
                cyl_bm(bm, foot, shoe, 0.045, 8)
                for zb in (0.8, 2.0, 3.2):                 # pipe brackets
                    if zb < ze - 0.6:
                        cyl_bm(bm, R.w(x, s * (W / 2 + 0.07), zb - 0.03), R.w(x, s * (W / 2 + 0.07), zb + 0.03), 0.06, 8)
        parts.append(part(bm, gutter_mid, name=name + '_gutters', smooth=True, grime=0.5))
    fp = [R.w(-Lh, -yw, 0), R.w(Lh, -yw, 0), R.w(Lh, yw, 0), R.w(-Lh, yw, 0)]
    C.roof_meta([(p.x, p.y) for p in fp], z_eave, walkable=walk, kind='hip' if hip else 'gable')
    R.parts = parts
    return R


def roof_hip(cx, cy, L, W, z_eave, pitch=40.0, mid='roof_terracotta', rot=0.0, **kw):
    """Hip roof (all four sides slope). Same params as roof_gable."""
    return roof_gable(cx, cy, L, W, z_eave, pitch, mid, rot, hip=True, **kw)


def roof_sod(cx, cy, L, W, z_eave, pitch=27.0, rot=0.0, **kw):
    """Norwegian torvtak: thick turf over birch bark, turf-boards along the eaves, no gutters."""
    kw.setdefault('thick', 0.28)
    kw.setdefault('eave_oh', 0.45)
    kw.setdefault('sag', 0.06)
    kw.setdefault('wobble', 0.05)
    kw.setdefault('gutters', False)
    kw.setdefault('fascia', 'timber_tarred')
    kw.setdefault('barge', 'timber_tarred')
    R = roof_gable(cx, cy, L, W, z_eave, pitch, 'sod', rot, sod=True, **kw)
    bm = bmesh.new()                               # torvvol: log/board retaining the turf at the eaves
    t = math.tan(math.radians(pitch))
    for s in (-1, 1):
        yw = W / 2 + kw['eave_oh']
        e = R.w(0, s * (yw - 0.05), z_eave - kw['eave_oh'] * t + 0.12)
        cyl_bm(bm, e - R.ax * (L / 2 + 0.3), e + R.ax * (L / 2 + 0.3), 0.09, 8)
    part(bm, 'timber_tarred', name='sod_eave_logs', uv='beam', axis=tuple(R.ax), smooth=True)
    return R


def roof_shed(x0, y0, x1, y1, z_low, z_high, mid='corrugated_rust', thick=0.08, oh=0.25, low_side='-y', name='shed',
              gutters=True):
    """Single-slope (lean-to) roof over rectangle x0..x1, y0..y1; low edge on side low_side ('-y','+y','-x','+x')."""
    x0, x1, y0, y1 = x0 - oh, x1 + oh, y0 - oh, y1 + oh
    zl, zh = z_low - 0.05, z_high
    cs = {'-y': [(x0, y0, zl), (x1, y0, zl), (x1, y1, zh), (x0, y1, zh)], '+y': [(x1, y1, zl), (x0, y1, zl), (x0, y0, zh), (x1, y0, zh)],
          '-x': [(x0, y1, zl), (x0, y0, zl), (x1, y0, zh), (x1, y1, zh)], '+x': [(x1, y0, zl), (x1, y1, zl), (x0, y1, zh), (x0, y0, zh)]}[low_side]
    bm = bmesh.new()
    slab_bm(bm, [V(p) for p in cs], thick, 4, 3, 0.02, 0.01)
    ob = part(bm, mid, name=name)
    if gutters:
        bm = bmesh.new()
        a, b = V(cs[0]), V(cs[1])
        n = (a - V(cs[3])).normalized() * 0.08
        cyl_bm(bm, a + n - V((0, 0, 0.08)), b + n - V((0, 0, 0.08)), 0.06, 8)
        part(bm, 'cast_iron', name=name + '_gutter', smooth=True)
    C.roof_meta([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z_low, kind='shed')
    return ob


def roof_flat(poly, z, mid='concrete_bunker', parapet_h=0.9, parapet_t=0.3, parapet_mid=None, coping='ashlar',
              slab_t=0.25, walkable=True, spouts=True, name='flatroof', snow_ok=True):
    """Flat walkable roof on a CCW wall footprint at height z (top of slab), with parapet, coping and water spouts.
    Registers a walkable roof polygon (elev z) and climbable parapet edges for the nav grid."""
    import kit_arch as KA
    poly = C.ccw(poly)
    bm = bmesh.new()
    C.prism_bm(bm, poly, z - slab_t, z)
    part(bm, mid, name=name + '_slab')
    if parapet_h > 0:
        inner = C.poly_offset(poly, -parapet_t)
        bm = bmesh.new()
        KA.ring_bm(bm, poly, inner, z, z + parapet_h)
        part(bm, parapet_mid or mid, name=name + '_parapet')
        if coping:
            bm = bmesh.new()
            KA.ring_bm(bm, C.poly_offset(poly, 0.04), C.poly_offset(inner, -0.03), z + parapet_h, z + parapet_h + 0.07)
            part(bm, coping, name=name + '_coping')
    if spouts:
        bm = bmesh.new()
        for i in range(len(poly)):
            a, b = V((*poly[i], 0)), V((*poly[(i + 1) % len(poly)], 0))
            L = (b - a).length
            if L < 3:
                continue
            r = (b - a).normalized()
            n = V((r.y, -r.x, 0))
            for k in range(1, int(L / 4) + 1):
                p = a + r * (L * k / (int(L / 4) + 1)) + V((0, 0, z + 0.05))
                beam_bm(bm, p - n * 0.1, p + n * 0.45, 0.12, 0.08)
        if bm.verts:
            part(bm, 'ashlar' if mid.startswith('plaster') or mid.startswith('adobe') else 'cast_iron', name=name + '_spouts')
    inner = C.poly_offset(poly, -parapet_t) if parapet_h > 0 else poly
    C.roof_meta(inner, z, walkable=walkable, kind='flat')
    for i in range(len(poly)):
        C.climb_meta(poly[i], poly[(i + 1) % len(poly)], z + parapet_h, 'parapet')


def chimney(x, y, z_base, z_top, w=0.75, d=0.55, mid='brick_red', cap='ashlar', pots=2, rot=0.0, soot=True, name='chimney'):
    """Chimney stack with corbelled band, cap slab, clay pots and soot decals. Anchor 'smoke' at the top."""
    import kit_weather as W
    bm = bmesh.new()
    box_bm(bm, (x, y, (z_base + z_top) / 2), (w, d, z_top - z_base), rot)
    part(bm, mid, name=name + '_stack')
    bm = bmesh.new()
    box_bm(bm, (x, y, z_top - 0.3), (w + 0.08, d + 0.08, 0.1), rot)
    box_bm(bm, (x, y, z_top + 0.04), (w + 0.1, d + 0.1, 0.08), rot)
    part(bm, cap or mid, name=name + '_cap')
    if pots:
        bm = bmesh.new()
        R = Matrix.Rotation(rot, 3, 'Z')
        for i in range(pots):
            o = R @ V(((i - (pots - 1) / 2) * (w / max(pots, 1)) * 0.9, 0, 0))
            p0 = V((x, y, z_top + 0.08)) + o
            cyl_bm(bm, p0, p0 + V((0, 0, 0.42 + rng().uniform(-0.05, 0.08))), 0.12, 10, r1=0.095)
        part(bm, 'roof_terracotta', name=name + '_pots', smooth=True, grime=0.8)
    if soot:
        R = Matrix.Rotation(rot, 3, 'Z')
        for n, ext in ((V((0, -1, 0)), d), (V((0, 1, 0)), d), (V((1, 0, 0)), w), (V((-1, 0, 0)), w)):
            nn = R @ n
            ww = w if abs(n.y) > 0.5 else d
            W.decal('soot', V((x, y, z_top - 0.5)) + nn * ((d if abs(n.y) > 0.5 else w) / 2 + 0.002), nn, ww + 0.02, 0.8)
    C.anchor('smoke', (x, y, z_top + 0.5), kind='chimney')


def dormer(R, lx, side=-1, w=1.1, h=1.25, wall='plaster_white', roof=None, pitch=50.0, oh=0.12, window_kw=None, name='dormer'):
    """Wall dormer (lucarne) on gable roof R, flush with the facade on `side` (-1/+1 across), centred at lx along the ridge.
    Builds front gable wall with a window, cheeks, a small gable roof; cuts the main roof under it."""
    import kit_arch as KA
    roof = roof or R.mid
    s = side
    t = math.tan(math.radians(R.pitch))
    td = math.tan(math.radians(pitch))
    ze, W2 = R.z_eave, R.W / 2
    n = R.ay * s
    rr = V((-n.y, n.x, 0))
    zt = ze + h
    zr = zt + (w / 2 + oh) * td
    back = W2 - (zr - ze) / t - 0.2           # where the dormer ridge dies into the main roof
    # cut the main roof slopes under the dormer
    cut = bmesh.new()                          # the dormer's own volume (pentagonal prism) - keeps the valleys
    prof = [(-w / 2 + 0.02, ze - 0.6), (w / 2 - 0.02, ze - 0.6), (w / 2 - 0.02, zt - 0.05), (0, zr - 0.06), (-w / 2 + 0.02, zt - 0.05)]
    rings = [[R.w(lx, s * ly, 0) + rr * px + V((0, 0, pz)) for px, pz in prof] for ly in (W2 + 0.6, back)]
    C.loft_bm(cut, rings)
    for ob in list(getattr(R, 'parts', [])):
        if 'slope' in ob.name:
            KA.cut_object(ob, cut)
    cut.free()
    # front wall (gable-shaped panel) with a window
    fr = KA.Frame(R.w(lx, s * W2, ze + 0.12), n, rr, w - 0.36, h - 0.3, 0.22)
    prof = [(-w / 2, ze - 0.35), (w / 2, ze - 0.35), (w / 2, zt), (0, zr - oh * td + 0.02), (-w / 2, zt)]
    ring0 = [R.w(lx, s * W2, 0) + rr * px + V((0, 0, pz)) for px, pz in prof]
    ring1 = [p - n * 0.22 for p in ring0]
    bm = bmesh.new()
    C.loft_bm(bm, [ring0, ring1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm = KA.boolean_cut(bm, [fr])
    part(bm, wall, name=name + '_front')
    # cheeks
    bm = bmesh.new()
    for k in (-1, 1):
        a = R.w(lx, s * W2, 0) + rr * (k * w / 2)
        pts = [a + V((0, 0, ze - 0.05)), a + V((0, 0, zt)), a - n * (W2 - back) + V((0, 0, zt))]
        r0 = [p - rr * k * 0.0 for p in pts]
        r1 = [p - rr * k * 0.08 for p in pts]
        C.loft_bm(bm, [r0, r1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, wall, name=name + '_cheeks')
    # dormer roof
    for k in (-1, 1):
        bm = bmesh.new()
        e0 = R.w(lx, s * (W2 + oh), 0) + rr * k * (w / 2 + oh) + V((0, 0, zt - oh * td))
        e1 = R.w(lx, s * back, 0) + rr * k * (w / 2 + oh) + V((0, 0, zt - oh * td))
        r0 = R.w(lx, s * (W2 + oh), zr)
        r1 = R.w(lx, s * back, zr)
        q = [e0, e1, r1, r0] if (k * s) > 0 else [e1, e0, r0, r1]
        slab_bm(bm, q, 0.08, 3, 2, 0.01, 0.005)
        part(bm, roof, name=name + '_roof%d' % k)
    KA.window(fr, **(window_kw or {}))
    return fr
