"""Norway rework 2 (art_rework_norway_2): snow that reads at 1x (wind ripples, drift swells, wind-scoured bare ridge
on the windward slope, leeward ridge cornice, bare slid-off patches showing the roofing, blue-grey hollows, eave
avalanche mounds + wall drifts on the ground), snow guards/ladders removed under snow, drooping cloth flag,
collapse rafters that hang DOWN into the hole. Imported at the end of nlib after nfx (patches nfx globals)."""
import math, bpy, bmesh
from mathutils import Vector as V, Matrix
import kit as K
import kit_core as C
import nfx as F
from nfx import noise01, slope_normal, orient, recolor, local, roof_z, Z

F.NO_COLLAPSE_MATS = tuple(m for m in F.NO_COLLAPSE_MATS if m != 'snow')
WIND = V((0.62, -0.78, 0)).normalized()          # prevailing wind from the NNW (sun from NW)
PATCHY = 0.45                                      # default bare-patch amount on every blanket


def _sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def snow_blanket(R, q, th=0.2, lip=0.2, seed=0, icicles=True, base_off=0.0, name='snowbl', patchy=0.0, res=1.0):
    n = slope_normal(q)
    e = q[1] - q[0]
    upv = ((q[3] + q[2]) / 2 - (q[0] + q[1]) / 2)
    down = -upv.normalized()
    el, ul = e.length, upv.length
    nu = max(3, int(el / (0.4 * res)))
    nv = max(4, int(ul / (0.34 * res)))
    rr = K.rng()
    ph = seed * 2.1 + rr.random() * 10
    windward = n.dot(-WIND) > 0.15                 # slope facing into the wind: scoured
    hipq = (q[2] - q[3]).length < 0.05
    patchy = max(patchy, PATCHY * (1.25 if windward else 0.8))
    melt = [(x, y, max(w, d) / 2 + 0.35) for (x, y, w, d, zt) in F.CHIMNEYS]

    def P(u, v):
        return q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v) + n * base_off

    def thick(p, u, v):
        dr = (1 - v) * ul                           # metres below the ridge
        swell = 0.5 + 0.95 * noise01(p, 0.27, ph)
        k = th * swell * (1 + 0.35 * (1 - v) ** 4)
        wp = (p.x * WIND.x + p.y * WIND.y) / 1.45 * 2 * math.pi + 2.2 * noise01(p, 0.35, ph + 3)
        k += (0.08 if windward else 0.07) * math.sin(wp) * (0.4 + 0.8 * noise01(p, 0.6, ph + 5))
        if windward and not hipq:                   # wind strips the ridge: bare roofing strip 0.3-0.7 m wide
            k *= _sstep(0.25, 0.25 + 0.55 * noise01(p, 0.8, ph + 9), dr)
            k -= (0.1 + base_off) * (1 - _sstep(0.0, 0.3, dr))
        elif not hipq:                              # leeward cornice crest just below the ridge
            k += th * 0.9 * math.exp(-((dr - 0.35) / 0.3) ** 2) * (0.6 + 0.6 * noise01(p, 0.9, ph + 2))
        # slid-off slabs / wind-bared patches that show the roofing (bigger toward the eave)
        bare = noise01(p, 0.42, ph + 7) - (1.0 - patchy * (0.55 + 0.7 * (1 - v)))
        if bare > 0:
            k -= bare * th * 11.0 + base_off * min(1.0, bare * 25)
        # snow slid off the lower roof in scallops: a bare, wavy band along ~half of the eave (reads at 1x)
        n1 = 0.6 * noise01((u * el * 0.8, ph * 3.1, 0.5), 1.0, 0.0) + 0.4 * noise01((u * el * 2.3, ph * 1.7, 0.2), 1.0, 0.0)
        ret = max(0.0, n1 - 0.5) * 4.0 * (1.0 if not hipq else 0.6)
        if ret > 0.05:
            k = k * _sstep(ret, ret + 0.15, v * ul) - (0.1 + base_off) * (1 - _sstep(ret - 0.06, ret + 0.06, v * ul))
        if edge_u(u):
            k *= 0.6
        return max(-0.07 - base_off, k)

    def edge_u(u):
        return u < 0.5 / nu or u > 1 - 0.5 / nu
    bm = bmesh.new()
    rows, flags, tk = [], [], []
    for j in range(-3, nv + 1):
        row, fl, tr = [], [], []
        for i in range(nu + 1):
            u = i / nu
            if j >= 0:
                v = j / nv
                b = P(u, v)
                t = thick(b, u, v)
                p = b + n * t
            else:
                b = P(u, 0)
                t = thick(b, u, 0)
                p = {-1: b + down * lip * 0.55 + n * t * 0.9,
                     -2: b + down * lip + n * t * 0.3 - Z * t * 0.45,
                     -3: b + down * lip * 0.7 - Z * t * 0.95 - n * 0.02}[j]
            m = any((p.x - mx) ** 2 + (p.y - my) ** 2 < mr * mr for mx, my, mr in melt)
            if j < 0 and t < 0.05:
                m = True
            row.append(bm.verts.new(p))
            fl.append(m)
            tr.append(t)
        rows.append(row)
        flags.append(fl)
        tk.append(tr)
    for j in range(len(rows) - 1):
        for i in range(nu):
            if flags[j][i] or flags[j][i + 1] or flags[j + 1][i] or flags[j + 1][i + 1]:
                continue
            if max(tk[j][i], tk[j][i + 1], tk[j + 1][i], tk[j + 1][i + 1]) < -0.03 - base_off:
                continue                             # fully bare cell: drop it (roofing shows, saves tris)
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    if not hipq:
        for i in (0, nu):                            # verge skirts
            for j in range(3, len(rows) - 1):
                if tk[j][i] < 0.02 - base_off or tk[j + 1][i] < 0.02 - base_off:
                    continue
                a, b = rows[j][i], rows[j + 1][i]
                c, d = bm.verts.new(b.co - n * 0.12), bm.verts.new(a.co - n * 0.12)
                bm.faces.new((a, b, c, d) if i == 0 else (b, a, d, c))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    orient(bm, bm.faces[:], n)
    ob = K.part(bm, 'snow', name=name, grime=0, bisect=False, jitter=0.0, smooth=True)
    ob['kit_lod'] = 'collapse_open'

    def col(p, nn, c):
        lp = p - n * base_off
        # height above the roof plane -> thin/bare edges read grey-blue (wet, compacted), crests bright
        hgt = (lp - q[0]).dot(n)
        k = 0.72 + 0.28 * _sstep(0.0, th * 1.1, hgt)
        k *= 0.8 + 0.24 * noise01(p, 0.27, ph)          # drift swells: broad light/dark areas that read at 1x
        wp = (p.x * WIND.x + p.y * WIND.y) / 1.45 * 2 * math.pi + 2.2 * noise01(p, 0.35, ph + 3)
        k *= 1.0 + 0.07 * math.sin(wp)                     # ripple crests lighter, troughs bluer
        k *= 0.95 + 0.06 * noise01(p, 1.7, ph)
        blue = 1 - _sstep(0.0, th * 0.8, hgt)
        if nn.z < 0.35:
            k *= 0.84
        for mx, my, mr in melt:
            d = math.hypot(p.x - mx, p.y - my)
            if d < mr + 0.6:
                k *= 0.78 + 0.22 * max(0.0, d - mr) / 0.6
        return (c[0] * k * (1 - 0.14 * blue), c[1] * k * (1 - 0.07 * blue), c[2] * k * (1 + 0.02 * blue))
    recolor(ob, col)
    if icicles and not hipq:
        bm = bmesh.new()
        u = rr.uniform(0.02, 0.1)
        while u < 0.97:
            b = P(u, 0)
            t = thick(b, u, 0)
            if rr.random() < 0.4 and t > 0.08:
                top = b + down * lip * 0.75 - Z * t * 0.9
                L = 0.05 + rr.random() ** 2.2 * 0.6
                K.cyl_bm(bm, top + Z * 0.03, top - Z * L, 0.025 + L * 0.03, 4, r1=0.003, caps=False)
            u += rr.uniform(0.1, 0.35) / max(1.0, el)
        if bm.verts:
            ic = K.part(bm, 'snow', name='icicles', grime=0, bisect=False, mat_tint=(0.8, 0.88, 0.97), jitter=0.0,
                        smooth=True)
            ic['kit_lod'] = 'drop'
        else:
            bm.free()
    return ob


F.snow_blanket = snow_blanket


def drop_parts(prefixes):
    """Remove parts whose name starts with any prefix (from the scene and the kit part list)."""
    keep = []
    for o in C.A.parts:
        try:
            nm = o.name
        except ReferenceError:
            continue
        if any(nm.startswith(p) for p in prefixes):
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            keep.append(o)
    C.A.parts[:] = keep


GAP_KEYS = ('door', 'step', 'stair', 'porch', 'ramp', 'landing', 'slip', 'rail', 'boat', 'bridge', 'deck', 'duckb')


def _gaps():
    out = []
    for o in C.A.parts:
        try:
            nm = o.name
        except ReferenceError:
            continue
        if o.type != 'MESH' or not any(k in nm for k in GAP_KEYS) or not o.data.vertices:
            continue
        xs = [(o.matrix_world @ v.co) for v in o.data.vertices]
        out.append((min(p.x for p in xs) - 0.35, max(p.x for p in xs) + 0.35,
                    min(p.y for p in xs) - 0.35, max(p.y for p in xs) + 0.35))
    return out


def snow_drifts(R=None, seed=1, h=0.42, name='snowdrift'):
    """Ground snow along the walls under roof R (default: biggest registered roof): an avalanche mound under each
    eave drip line (snow that slid off the roof) and wind drifts banked against the gable walls; flattened at
    doors, steps, ramps and porches so entrances stay clear."""
    if R is None:
        rs = [r for r in F.ROOFS if not getattr(r, 'no_snow', False)]
        if not rs:
            return None
        R = max(rs, key=lambda r: r.L * r.W)
    gaps = _gaps()
    ph = seed * 1.9
    bm = bmesh.new()
    hw, hl = R.W / 2, R.L / 2
    oh = getattr(R, 'eave_oh', 0.3)
    for (axis, sgn) in ((1, -1), (1, 1), (0, -1), (0, 1)):   # axis 1: eave walls (+-ay), 0: gable walls (+-ax)
        span = hl if axis == 1 else hw
        dist = hw if axis == 1 else hl
        wall_n = (R.ay if axis == 1 else R.ax) * sgn
        tang = R.ax if axis == 1 else R.ay
        width = (oh + 1.1) if axis == 1 else 1.5
        nt = max(4, int(2 * span / 0.6))
        ns = 5
        grid = []
        for i in range(nt + 1):
            t = -span - 0.4 + (2 * span + 0.8) * i / nt
            row = []
            for j in range(ns + 1):
                s = j / ns
                d = 0.02 + s * width
                p = R.c + tang * t + wall_n * (dist + d)
                p = V((p.x, p.y, 0))
                hh = h * (0.55 + 0.9 * noise01(p, 0.4, ph))
                if axis == 1:                        # mound centred on the drip line
                    prof = math.exp(-((d - oh - 0.15) / 0.5) ** 2) * 1.0 + 0.35 * (1 - s)
                else:
                    prof = (1 - s) ** 1.6 * (1.1 if sgn * (R.ax.x) < 0 else 0.7)
                endf = min(1.0, (span + 0.4 - abs(t)) / 0.8)
                z = hh * prof * max(0.0, endf)
                for (x0, x1, y0, y1) in gaps:
                    if x0 < p.x < x1 and y0 < p.y < y1:
                        z = min(z, 0.03)
                if j == ns:
                    z = 0.0
                row.append(bm.verts.new(V((p.x, p.y, z - 0.03 + 0.05 * (j < ns)))))
            grid.append(row)
        for i in range(nt):
            for j in range(ns):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    ob = K.part(bm, 'snow', name=name, grime=0, bisect=False, jitter=0.0, smooth=True)
    ob['kit_lod'] = 'collapse_open'

    def col(p, nn, c):
        k = 0.9 + 0.1 * min(1.0, p.z / 0.3)
        return (c[0] * k * 0.98, c[1] * k * 0.99, c[2] * k)
    recolor(ob, col)
    return ob


_orig_snow = F.snow
SAG_ONLY = []


def snow(*a, drifts=True, bury=('duckboards',), **kw):
    """Winter variant v2: snow guards / roof ladders are buried (removed) so nothing pokes through the blanket,
    blankets are the legible v2 ones, ground drifts + eave avalanche mounds along the main building."""
    drop_parts(('snowguard', 'roofladder') + tuple(bury))
    r = _orig_snow(*a, **kw)
    for h in SAG_ONLY:                                  # sag without a hole: blankets just follow the dip
        cx, cy = h['c']
        for o in C.A.parts:
            try:
                if not (o.name.startswith('snowbl') or o.name.startswith('icicles')):
                    continue
            except ReferenceError:
                continue
            for v in o.data.vertices:
                d = math.hypot(v.co.x - cx, v.co.y - cy)
                if d < h['radius'] * 1.6:
                    v.co.z -= h['depth'] * (1 - d / (h['radius'] * 1.6)) ** 2
    if drifts:
        snow_drifts()
    fit_budget()
    return r


def _tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


BUDGET = 14700


def fit_budget(budget=None):
    """Keep LOD0 inside the 15k building budget: if the snow variant is over, edge-collapse the (smooth, dense)
    snow blankets/drifts just enough; ripples survive because collapse keeps curvature."""
    import kit_export as KE
    budget = budget or BUDGET
    parts = []
    for o in C.A.parts:
        try:
            if o.name in bpy.data.objects and o.type == 'MESH':
                parts.append(o)
        except ReferenceError:
            pass
    tot = sum(_tris(o) for o in parts)
    sn = [o for o in parts if o.name.startswith('snowbl') or o.name.startswith('snowdrift')]
    B = sum(_tris(o) for o in sn)
    if tot <= budget or not B:
        return
    ratio = max(0.35, 1 - (tot - budget) / B * 1.08)
    for o in sn:
        m = o.modifiers.new('fit', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        KE._select([o])
        bpy.ops.object.modifier_apply(modifier='fit')
    C.log('FIT snow ratio %.2f total %d -> %d' % (ratio, tot, sum(_tris(o) for o in parts)))


F.snow = snow


def banner(p_top, fw=1.8, fh=1.2, heading=(1, 0, 0), nu=20, nv=8, name='flag'):
    """Cloth banner v2 in a faint breeze: the fly sags well below the hoist, the lower edge swings back toward the
    pole, and soft travelling folds (growing toward the fly) give light/dark bands so it reads as cloth, not a
    board. Folds are kept shallow over the cross so it never looks hooked. Separate 'flag' node; no swastika."""
    hd = V(heading).normalized()
    side = V((-hd.y, hd.x, 0))
    P0 = V(p_top)
    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            s, t = i / nu, j / nv                          # t = 1 top edge
            amp = 0.03 + 0.16 * s ** 1.3
            fold = amp * math.sin(2 * math.pi * (s * fw / 0.62) + 0.9 * (1 - t) + 0.3) \
                + 0.05 * s * math.sin(7.0 * t + s * 4.0)
            x = s * fw * (0.93 - 0.2 * (1 - t) * s)       # bottom edge hangs back toward the pole
            droop = fh * (0.42 * s ** 1.5 + 0.12 * s * (1 - t))
            row.append(P0 + hd * x + side * fold + V((0, 0, -(1 - t) * fh * (1 + 0.06 * s) - droop)))
        grid.append(row)
    cells = []
    for sgn, off in ((1, 0.0), (-1, 0.008)):
        vs = [[bm.verts.new(p + side * off * sgn) for p in row] for row in grid]
        for j in range(nv):
            for i in range(nu):
                f = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
                bm.faces.new(f if sgn > 0 else tuple(reversed(f)))
                cells.append(((i + 0.5) / nu, (j + 0.5) / nv))
    ob = K.part(bm, 'wood_paint', name=name, node='flag', grime=0, bisect=False, jitter=0.0, uv='aligned', smooth=True)
    ob['kit_lod'] = 'keep'

    def col(uv):
        u, v = (uv[0] - 0.5) * 24.0, (uv[1] - 0.5) * 16.0
        bl = (abs(u) < 1.9 and abs(v) < 5.6) or (abs(v) < 1.9 and abs(u) < 5.6)
        wh = (abs(u) < 2.9 and abs(v) < 6.6) or (abs(v) < 2.9 and abs(u) < 6.6)
        return (0.035, 0.035, 0.035) if bl else ((0.86, 0.86, 0.82) if wh else (0.5, 0.04, 0.035))
    me = ob.data
    ca = me.color_attributes.get('Col')
    for k, poly in enumerate(me.polygons):
        cc = col(cells[k % len(cells)])
        for li in poly.loop_indices:
            ca.data[li].color = (cc[0], cc[1], cc[2], 1.0)
    K.anchor('flag', P0, heading, width=fw, height=fh, node='flag')
    return ob


F.banner = banner


def sag_roof(R, center, radius, depth=0.7, holes=True, seed=1):
    """Roof collapse v2: slope vertices near `center` drop (vertical only, UVs untouched), a jagged hole opens, and
    snapped rafters hang DOWN into the building from the up-slope and down-slope rims (parallel to the real
    rafters, tips on the floor/debris) - nothing sticks up out of the roof; torn felt hangs over the rim."""
    import kit_arch as KA
    import random
    rr = random.Random(seed)
    c = V((center[0], center[1], 0))
    (F.SAG_HOLES if holes else SAG_ONLY).append(dict(c=(center[0], center[1]), radius=radius, depth=depth, seed=seed, R=R))

    def sagz(x, y):
        d = math.hypot(x - c.x, y - c.y)
        return depth * (1 - d / (radius * 1.6)) ** 2 if d < radius * 1.6 else 0.0
    for ob in R.parts:
        if not ('slope' in ob.name or '_hip' in ob.name or ob.name.endswith('_ridge') or 'battens' in ob.name):
            continue
        for v in ob.data.vertices:
            v.co.z -= sagz(v.co.x, v.co.y)
    if not holes:
        return
    lx0, ly0 = local(R, center)
    z = roof_z(R, lx0, ly0) - depth
    cut, pts = _star_cutter(V((center[0], center[1], z)), Z, radius * 0.75, seed, 3.0, spikes=14)
    for ob in list(R.parts):
        if ob.name in bpy.data.objects and ('slope' in ob.name or '_hip' in ob.name or 'battens' in ob.name):
            KA.cut_object(ob, cut)
    cut.free()
    r0 = radius * 0.62
    zfloor = max(0.3, R.z_eave - 2.4)
    bm = bmesh.new()
    for k in range(4):
        lx = lx0 + (k - 1.5) / 1.5 * r0 * 0.8 + rr.uniform(-0.1, 0.1)
        span = math.sqrt(max(0.05, r0 * r0 - (lx - lx0) ** 2))
        for sg in (-1, 1):                               # stub from each rim, bent down into the hole
            if rr.random() < 0.3:
                continue
            ly = ly0 + sg * span * 0.95
            top = R.w(lx, ly, roof_z(R, lx, ly) - sagz(*R.w(lx, ly, 0)[:2]) - 0.14)
            dl = rr.uniform(0.9, 1.9)
            tip = R.w(lx + rr.uniform(-0.2, 0.2), ly - sg * dl * 0.45, 0)
            tip.z = max(zfloor, top.z - dl)
            K.beam_bm(bm, top, tip, 0.07, 0.14, roll=rr.uniform(-0.2, 0.2))
    if bm.verts:
        K.part(bm, 'timber_beam', name='rafters_broken', uv='beam', axis=(0, 1, 0), grime=0.3,
               mat_tint=(0.45, 0.4, 0.36))
    else:
        bm.free()
    bm = bmesh.new()
    for k in range(3):                                   # torn roofing felt hanging over the hole edge
        a = pts[rr.randrange(len(pts))]
        d = (V((a.x, a.y, 0)) - c).normalized()
        w = rr.uniform(0.5, 1.0)
        side = d.cross(Z).normalized()
        p0 = a + Z * 0.02
        p1 = p0 - d * rr.uniform(0.2, 0.4) - Z * rr.uniform(0.4, 0.7)
        p2 = p1 - d * 0.1 - Z * rr.uniform(0.3, 0.6)
        vs = [[bm.verts.new(p + side * s * w / 2) for s in (-1, 1)] for p in (p0, p1, p2)]
        wb = [[bm.verts.new(p + side * s * w / 2 + d * 0.01) for s in (-1, 1)] for p in (p0, p1, p2)]
        for i in range(2):
            bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
            bm.faces.new((wb[i + 1][0], wb[i + 1][1], wb[i][1], wb[i][0]))
    K.part(bm, 'tar_paper', name='felt_torn', grime=0.2, bisect=False)


_star_orig = F._star_cutter


def _star_cutter(c, n, r, seed, depth=1.4, spikes=16, floor=None):
    """Roof holes (spikes=14 callers) get a ragged, roughly round outline (broken boards/felt), not a black star;
    wall blasts keep the original jagged star."""
    if spikes != 14:
        return _star_orig(c, n, r, seed, depth, spikes, floor)
    import random
    rr = random.Random(seed)
    n = V(n).normalized()
    up = Z if abs(n.z) < 0.9 else V((0, 1, 0))
    ru = up.cross(n).normalized()
    uu = n.cross(ru).normalized()
    pts = []
    m = 26
    ph = [rr.uniform(0, 6.28) for _ in range(3)]
    for i in range(m):
        a = 2 * math.pi * (i + rr.uniform(-0.25, 0.25)) / m
        k = 0.86 + 0.1 * math.sin(2 * a + ph[0]) + 0.06 * math.sin(3 * a + ph[1]) + rr.uniform(-0.07, 0.07)
        if i % 2:
            k *= rr.uniform(0.9, 0.97)
        p = c + ru * math.cos(a) * r * k + uu * math.sin(a) * r * k * 0.85
        pts.append(p)
    bm = bmesh.new()
    top = [bm.verts.new(p + n * depth) for p in pts]
    bot = [bm.verts.new(p - n * depth) for p in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((top[j], top[i], bot[i], bot[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, pts


F._star_cutter = _star_cutter
F.sag_roof = sag_roof


# ------------------------------------------------------------------------------------------------ roof variety
def _slope_pt(q, u, v, off=0.0):
    n = slope_normal(q)
    return q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v) + n * off, n


def roof_patches(R, mid, tint, n=5, size=(0.9, 2.2), seed=1, sides=(0, 1), off=0.018, vrange=(0.1, 0.85),
                 name='roof_patch', fixed=None):
    """Re-laid / replaced roofing sections: thin quads of the same roofing with a different tint lying on the
    slope (course-aligned), so a big roof reads as patched and aged at game zoom. fixed = [(side, u, v, w, h)]."""
    import random
    rr = random.Random(seed)
    bm = bmesh.new()
    spec = fixed or [(sides[i % len(sides)], rr.uniform(0.08, 0.92), rr.uniform(*vrange), rr.uniform(*size),
                      rr.uniform(size[0] * 0.6, size[1] * 0.8)) for i in range(n)]
    for (si, u, v, w, h) in spec:
        q = R.quads[si]
        c, nn = _slope_pt(q, u, v, off)
        ed = (q[1] - q[0]).normalized()
        up = nn.cross(ed).normalized()
        pts = [c - ed * w / 2 - up * h / 2, c + ed * w / 2 - up * h / 2, c + ed * w / 2 + up * h / 2,
               c - ed * w / 2 + up * h / 2]
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        orient(bm, [f], nn)
    ob = K.part(bm, mid, name=name, grime=0.3, bisect=False, mat_tint=tint)
    return ob


def roof_decals(R, kinds=(('moss_patch', 0.38, (1.6, 3.2)), ('lichen', 0.35, (1.0, 2.0)), ('streak_long', 0.35, (0.8, 1.4))),
                n=10, seed=1, sides=(0, 1)):
    """Large moss / lichen / run-off decals on the slopes: moss hugs the eave and the north slope, lichen is
    scattered, long streaks run down from the ridge (decal 'up' = down-slope direction flipped)."""
    import random
    rr = random.Random(seed)
    for i in range(n):
        si = sides[i % len(sides)]
        q = R.quads[si]
        kind, alpha, (a, b) = kinds[i % len(kinds)]
        if kind == 'moss_patch':
            v = rr.uniform(0.02, 0.3)
        elif kind == 'streak_long':
            v = rr.uniform(0.45, 0.75)
        else:
            v = rr.uniform(0.1, 0.9)
        c, nn = _slope_pt(q, rr.uniform(0.06, 0.94), v, 0.0)
        w = rr.uniform(a, b)
        up = (q[3] - q[0]).normalized()
        K.decal(kind, c, tuple(nn), w, w * (0.45 if kind != 'streak_long' else 1.6), up=tuple(up), alpha=alpha,
                offset=0.03)


def skylight(R, lx, side=-1, w=0.6, h=0.8, name='skylight'):
    """Cast-iron barn roof light: raised frame + glass pane lying on the slope."""
    ly = side * (R.yw * 0.55)
    q = R.quads[0 if side < 0 else 1]
    nn = slope_normal(q)
    c = R.w(lx, ly, roof_z(R, lx, ly)) + nn * 0.03
    ed = R.ax
    up = nn.cross(ed).normalized()
    bm = bmesh.new()
    for (a, b) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pass
    corners = [c + ed * sx * w / 2 + up * sy * h / 2 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        K.beam_bm(bm, corners[i] + nn * 0.04, corners[(i + 1) % 4] + nn * 0.04, 0.06, 0.08, up=tuple(nn))
    K.part(bm, 'cast_iron', name=name + '_frame', grime=0.6)
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p + nn * 0.05) for p in corners])
    orient(bm, [f], nn)
    K.part(bm, 'glass_dirty', name=name + '_glass', grime=0.3, bisect=False)


def battens(p0, p1, nrm, z0, ztop, spacing=0.3, w=0.07, proud=0.035, holes=(), mid='board_batten', tint=None,
            name='battens_geo'):
    """Real cover battens (3-sided strips, 6 tris each) on a board wall from p0 to p1 (outer face, xy), outward
    normal nrm; ztop(t) gives the top at distance t along the wall (gables); holes = [(t0, t1, za, zb)] openings
    the battens stop around. Gives board-and-batten the shadow lines that read at 1x."""
    p0, p1, n = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0)), V(nrm).normalized()
    d = p1 - p0
    Lw = d.length
    d.normalize()
    bm = bmesh.new()
    k = int(Lw / spacing)
    for i in range(1, k):
        t = Lw * i / k
        segs = [(z0, ztop(t))]
        for (t0, t1, za, zb) in holes:
            if t0 - w < t < t1 + w:
                nxt = []
                for (a, b) in segs:
                    if zb <= a or za >= b:
                        nxt.append((a, b))
                        continue
                    if za > a + 0.1:
                        nxt.append((a, za))
                    if zb < b - 0.1:
                        nxt.append((zb, b))
                segs = nxt
        c = p0 + d * t
        for (a, b) in segs:
            if b - a < 0.15:
                continue
            q = []
            for z in (a, b):
                base = c + V((0, 0, z))
                q.append([bm.verts.new(base - d * w / 2 + n * 0.002), bm.verts.new(base - d * w / 2 + n * proud),
                          bm.verts.new(base + d * w / 2 + n * proud), bm.verts.new(base + d * w / 2 + n * 0.002)])
            ax = c + n * (proud * 0.5)
            for m in range(3):
                f = bm.faces.new((q[0][m], q[0][m + 1], q[1][m + 1], q[1][m]))
                f.normal_update()
                fc = f.calc_center_median()
                off = V((fc.x - ax.x, fc.y - ax.y, 0))
                if f.normal.dot(off) < 0:
                    f.normal_flip()
    kw = dict(mat_tint=tint) if tint else {}
    ob = K.part(bm, mid, name=name, grime=0.6, bisect=False, uv='beam', axis=(0, 0, 1), **kw)
    return ob


# ------------------------------------------------------------------------------------------------ coastal props
def hanging_net(p0, p1, ztop, drop, seed=1, tint=(0.34, 0.33, 0.26), name='net_hung'):
    """Fishing net hung from a peg rail to dry: sagging head rope between pegs, deep vertical folds, cork floats
    along the head rope and a dark lead line at the foot (double-sided cloth)."""
    import random
    rr = random.Random(seed)
    p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    d = p1 - p0
    Lw = d.length
    d.normalize()
    out = V((-d.y, d.x, 0))
    if out.x > 0:
        out = -out                                 # away from the wall (wall is on the +x side for the W wall)
    nu, nv = 22, 6
    grid = []
    for j in range(nv + 1):
        t = j / nv
        row = []
        for i in range(nu + 1):
            s = i / nu
            sag = 0.12 * abs(math.sin(s * math.pi * 3))
            fold = (0.05 + 0.1 * t) * math.sin(s * Lw / 0.22 * math.pi + rr.uniform(-0.2, 0.2))
            hang = drop * (0.75 + 0.25 * math.sin(s * 5.3 + seed)) * t
            row.append(p0 + d * s * Lw + out * (0.04 + abs(fold) + 0.12 * t * t) + V((0, 0, ztop - sag - hang)))
        grid.append(row)
    bm = bmesh.new()
    for sg, off in ((1, 0.0), (-1, -0.012)):
        vs = [[bm.verts.new(p + out * off) for p in row] for row in grid]
        for j in range(nv):
            for i in range(nu):
                f = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
                f2 = bm.faces.new(f if sg > 0 else tuple(reversed(f)))
    bm.normal_update()
    K.part(bm, 'hessian', name=name, grime=0.3, bisect=False, mat_tint=tint, smooth=True)
    fl, ld = bmesh.new(), bmesh.new()
    for i in range(1, nu, 2):
        p = grid[0][i] + out * 0.03
        K.cyl_bm(fl, p - d * 0.05, p + d * 0.05, 0.04, 6)
    for i in range(nu):
        K.cyl_bm(ld, grid[nv][i], grid[nv][i + 1], 0.018, 4)
    K.part(fl, 'timber_beam', name=name + '_corks', mat_tint=(0.6, 0.48, 0.36), grime=0.4, smooth=True)
    K.part(ld, 'cast_iron', name=name + '_leads', grime=0.2)


def _merge(dst, src):
    tmp = bpy.data.meshes.new('mrg')
    src.to_mesh(tmp)
    src.free()
    dst.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


def naust_props(x0, x1, y0, y1, xw, var, seed):
    """Shore clutter that makes a naust read as a working boathouse: lobster pots, stacked fish crates, a tar
    barrel, a dahn buoy with its pole flag, a coiled mooring rope and a grapnel anchor."""
    import random
    import kit_weather as KW
    rr = random.Random(seed)
    wood, net, iron, tar = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    # lobster pots (hummerteine): plank base, three hoops, net cover - two by the east wall, one on top
    for k, (px, py, pz, rot) in enumerate(((x1 + 0.55, y0 + 1.2, 0.0, 0.1), (x1 + 0.6, y0 + 2.2, 0.0, -0.08),
                                            (x1 + 0.57, y0 + 1.7, 0.47, 0.25))):
        c, s_ = math.cos(rot), math.sin(rot)
        def P(lx, ly, lz):
            return V((px + lx * c - ly * s_, py + lx * s_ + ly * c, pz + lz))
        K.box_bm(wood, tuple(P(0, 0, 0.03)), (0.5, 0.85, 0.05), rot_z=rot)
        for hy in (-0.38, 0.0, 0.38):
            pts = [P(0.24 * math.cos(a), hy, 0.05 + 0.4 * math.sin(a)) for a in [math.pi * i / 6 for i in range(7)]]
            for a_, b_ in zip(pts, pts[1:]):
                K.cyl_bm(wood, a_, b_, 0.018, 4)
        for side, rad in ((0, 0.23), (1, 0.225)):
            rows = []
            for hy in (-0.4, 0.4):
                rows.append([net.verts.new(P(rad * math.cos(a), hy, 0.05 + (rad + 0.16) * math.sin(a)))
                             for a in [math.pi * i / 6 for i in range(7)]])
            for i in range(6):
                f = (rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i])
                net.faces.new(f if side else tuple(reversed(f)))
    # fish crates (3, stacked 2 + 1) at the west front corner
    for (cx, cy, cz, rz) in ((x0 - 0.5, y0 - 0.6, 0.0, 0.1), (x0 - 0.5, y0 - 1.3, 0.0, -0.05), (x0 - 0.5, y0 - 0.95, 0.27, 0.3)):
        K.box_bm(wood, (cx, cy, cz + 0.13), (0.45, 0.65, 0.26), rot_z=rz)
    # tar barrel with hoops
    bx, by = x1 + 0.55, y0 - 0.5
    K.cyl_bm(tar, (bx, by, 0.0), (bx, by, 0.85), 0.29, 12, r1=0.27)
    for hz in (0.12, 0.72):
        K.cyl_bm(iron, (bx, by, hz), (bx, by, hz + 0.04), 0.3, 12)
    # dahn buoy: pole leaning on the wall, cork float, small dark flag
    b0, b1 = V((x1 + 0.12, y0 + 3.2, 0.0)), V((x1 + 0.05, y0 + 3.35, 2.6))
    K.cyl_bm(wood, b0, b1, 0.025, 5)
    fc = b0.lerp(b1, 0.35)
    K.cyl_bm(tar, fc - V((0, 0, 0.12)), fc + V((0, 0, 0.12)), 0.16, 10)
    fl = [net.verts.new(b1 + V((0, dy, dz))) for dy, dz in ((0, 0), (0.32, -0.04), (0.3, -0.24), (0, -0.2))]
    net.faces.new(fl)
    net.faces.new(list(reversed([net.verts.new(v.co + V((0.004, 0, 0))) for v in fl])))
    # coiled mooring rope on the slip head + grapnel anchor
    cx, cy = x1 + 0.95, y0 + 0.35
    for ring in range(3):
        rad = 0.26 - ring * 0.05
        pts = [V((cx + rad * math.cos(a), cy + rad * math.sin(a), 0.03 + ring * 0.035)) for a in
               [2 * math.pi * i / 10 for i in range(11)]]
        for a_, b_ in zip(pts, pts[1:]):
            K.cyl_bm(net, a_, b_, 0.03, 4)
    ax, ay = x0 - 0.35, y0 + 3.4
    K.cyl_bm(iron, (ax, ay, 0.05), (ax + 0.1, ay, 0.9), 0.03, 6)
    for a in range(4):
        th_ = a * math.pi / 2 + 0.3
        tip = V((ax + 0.3 * math.cos(th_), ay + 0.3 * math.sin(th_), 0.25))
        K.cyl_bm(iron, (ax, ay, 0.07), tip, 0.022, 4)
    K.part(wood, 'timber_grey', name='props_wood', grime=0.6, mat_tint=(0.85, 0.82, 0.76))
    K.part(net, 'hessian', name='props_net', grime=0.3, mat_tint=(0.4, 0.33, 0.26))
    K.part(tar, 'timber_tarred', name='props_tar', grime=0.3, smooth=True)
    K.part(iron, 'cast_iron', name='props_iron', grime=0.4)
    K.footprint_rect(x1 + 0.58, y0 + 1.7, 0.7, 1.4, 0, 'LOW', 'pots')
    K.footprint_rect(x0 - 0.5, y0 - 0.95, 0.7, 1.4, 0, 'LOW', 'crates')
    K.footprint_rect(bx, by, 0.6, 0.6, 0, 'LOW', 'barrel')


def board_roof(R, w=0.22, seed=1, mid='timber_tarred', tint=None, name='roof_boards'):
    """Board-on-board lean-to roof over roof R's single slope: under-layer boards edge to edge, cover boards over
    every joint (proud, with shadow lines), a round eave log, moss decals. Replaces the flat 'card' look."""
    import random
    rr = random.Random(seed)
    q = R.quads[0]
    nn = slope_normal(q)
    e = q[1] - q[0]
    el = e.length
    ed = e.normalized()
    bm = bmesh.new()
    k = int(el / w)
    for i in range(k):
        for layer in (0, 1):
            if layer and i == k - 1:
                continue
            u = (i + 0.5 + 0.5 * layer) / k
            bw = w * (0.98 if not layer else 0.55)
            a = q[0].lerp(q[1], u) + nn * (0.03 + 0.03 * layer) - (q[3] - q[0]).normalized() * rr.uniform(0.0, 0.05)
            b = q[3].lerp(q[2], u) + nn * (0.03 + 0.03 * layer)
            K.beam_bm(bm, a, b, bw, 0.03, up=tuple(nn), roll=rr.uniform(-0.03, 0.03))
    ob = K.part(bm, mid, name=name, uv='beam', axis=tuple((q[3] - q[0]).normalized()), grime=0.6,
                **(dict(mat_tint=tint) if tint else {}))

    def col(p, n_, c):
        t = noise01(p, 1.7, seed)
        return (c[0] * (0.8 + 0.35 * t), c[1] * (0.8 + 0.35 * t), c[2] * (0.78 + 0.3 * t))
    recolor(ob, col)
    bm = bmesh.new()
    K.cyl_bm(bm, q[0] + nn * 0.07 - (q[3] - q[0]).normalized() * 0.02, q[1] + nn * 0.07 - (q[3] - q[0]).normalized() * 0.02,
             0.07, 8)
    K.part(bm, 'log_hewn', name=name + '_eavelog', uv='beam', axis=tuple(ed), smooth=True, mat_tint=(0.6, 0.5, 0.42))
    for i in range(3):
        c, n_ = _slope_pt(q, rr.uniform(0.15, 0.85), rr.uniform(0.1, 0.6), 0.0)
        K.decal('moss_patch', c + n_ * 0.06, tuple(n_), rr.uniform(0.7, 1.2), 0.5, up=tuple((q[3] - q[0]).normalized()),
                alpha=0.45)
    return ob


def felt_seams(inner, zt, spacing=0.9, w=0.09, h=0.018, name='felt_seams'):
    """Raised, slightly glossy lap seams of a torch-on felt roof (rolls along x, laps every `spacing` m) + a
    perimeter welt, darker than the sun-bleached membrane so the roof reads as tar paper at game zoom."""
    xs = [p[0] for p in inner]
    ys = [p[1] for p in inner]
    xa, xb, ya, yb = min(xs) + 0.05, max(xs) - 0.05, min(ys) + 0.05, max(ys) - 0.05
    bm = bmesh.new()
    y = ya + spacing
    while y < yb - 0.2:
        K.box_bm(bm, ((xa + xb) / 2, y, zt + h / 2), (xb - xa, w, h))
        y += spacing
    k = 0
    y = ya
    while y < yb - 0.2:                                   # staggered end laps of the rolls
        x = xa + (3.0 if k % 2 else 1.6)
        while x < xb - 0.3:
            K.box_bm(bm, (x, y + spacing / 2, zt + h / 2), (w * 0.8, spacing - w, h * 0.8))
            x += 5.0
        y += spacing
        k += 1
    K.part(bm, 'tar_paper', name=name, grime=0.2, bisect=False, mat_tint=(0.55, 0.55, 0.56))


def dam_b_detail(poly, x0, x1, y0, y1, H, T, door, seed):
    """Functionalist concrete gate house: expressed concrete frame (pilasters at the corners and bays), sill string
    course under the strip windows, projecting window surrounds, cast iron downpipes from the spouts, louvred vent
    grilles, a builder's plaque over the canopy, a steel roof ladder, a switch cabinet on its own plinth and rust /
    efflorescence staining so the massing does not read as a plain box."""
    import random
    rr = random.Random(seed)
    L, W = x1 - x0, y1 - y0
    bm = bmesh.new()
    zt = H + 0.25 + 0.5
    for x in (x0 + 0.2, x0 + L * 0.2, x1 - L * 0.2, x1 - 0.2):   # front + back pilasters
        for y, sg in ((y0, -1), (y1, 1)):
            if abs(x - door.o.x) < 1.6 and sg < 0:
                continue
            K.box_bm(bm, (x, y + sg * 0.06, (0.8 + zt) / 2), (0.4, 0.12, zt - 0.8))
    for y in (y0 + 0.2, 0.0, y1 - 0.2):                       # side pilasters
        for x, sg in ((x0, -1), (x1, 1)):
            if abs(y) < 0.1:
                K.box_bm(bm, (x + sg * 0.06, y, (0.8 + 3.7) / 2), (0.12, 0.4, 3.7 - 0.8))
            else:
                K.box_bm(bm, (x + sg * 0.06, y, (0.8 + zt) / 2), (0.12, 0.4, zt - 0.8))
    for (x, y, sx, sy, Lb) in ((0, y0 - 0.05, 0, -1, L + 0.1), (0, y1 + 0.05, 0, 1, L + 0.1), (x0 - 0.05, 0, -1, 0, W + 0.1),
                               (x1 + 0.05, 0, 1, 0, W + 0.1)):
        K.box_bm(bm, (x, y, 3.75), (Lb if sy else 0.12, Lb if sx else 0.12, 0.16))      # sill string course
    K.part(bm, 'concrete_formwork', name='frame_pilasters', grime=0.8, mat_tint=(0.92, 0.9, 0.86))
    bm = bmesh.new()                                         # window surrounds (strip windows at z 3.9..4.6)
    for (cx, cy, nx, ny, w) in ((x1, 0, 1, 0, 2.4), (x0, 0, -1, 0, 2.4), (0, y1, 0, 1, 2.4)):
        for dz in (3.84, 4.66):
            K.box_bm(bm, (cx + nx * 0.07, cy + ny * 0.07, dz), (0.14 if nx else w + 0.3, 0.14 if ny else w + 0.3, 0.12))
        for s_ in (-1, 1):
            K.box_bm(bm, (cx + nx * 0.07 + (0 if nx else s_ * (w / 2 + 0.09)), cy + ny * 0.07 + (0 if ny else s_ * (w / 2 + 0.09)),
                          4.25), (0.14 if nx else 0.12, 0.14 if ny else 0.12, 0.82))
    K.part(bm, 'concrete_slab', name='win_surrounds', grime=0.6)
    bm = bmesh.new()                                         # downpipes from the front spouts, with brackets + shoes
    for x in (x0 + 0.6, x1 - 0.6):
        K.cyl_bm(bm, (x, y0 - 0.14, 0.05), (x, y0 - 0.14, H + 0.1), 0.055, 8)
        K.cyl_bm(bm, (x, y0 - 0.14, 0.05), (x, y0 - 0.45, 0.05), 0.06, 8)
        for z in (1.0, 2.4, 3.8):
            K.box_bm(bm, (x, y0 - 0.08, z), (0.16, 0.1, 0.04))
    K.part(bm, 'cast_iron', name='downpipes', grime=0.5, smooth=True)
    bm = bmesh.new()                                         # louvred vent grilles low on the side walls
    for (x, nx) in ((x0, -1), (x1, 1)):
        for y in (y0 + 1.0, y1 - 1.0):
            K.box_bm(bm, (x + nx * 0.03, y, 1.3), (0.06, 0.7, 0.5))
            for k in range(5):
                K.box_bm(bm, (x + nx * 0.07, y, 1.1 + k * 0.1), (0.04, 0.66, 0.025))
    K.part(bm, 'steel_painted', name='vent_grilles', mat_tint=(0.36, 0.4, 0.38), grime=0.6)
    bm = bmesh.new()                                         # plaque over the canopy
    K.box_bm(bm, (door.o.x, y0 - 0.04, 4.35), (1.4, 0.06, 0.4))
    K.part(bm, 'granite', name='plaque')
    K.ladder((x1 + 0.35, y1 - 0.8, 0.0), H + 0.75, (1, 0, 0), mid='steel_galv')
    bm = bmesh.new()                                         # switch cabinet on a plinth (west)
    K.box_bm(bm, (x0 - 1.0, y0 + 0.9, 0.15), (0.9, 0.7, 0.3))
    K.part(bm, 'concrete_bunker', name='cabinet_plinth')
    bm = bmesh.new()
    K.box_bm(bm, (x0 - 1.0, y0 + 0.9, 1.0), (0.75, 0.55, 1.4))
    K.box_bm(bm, (x0 - 1.0, y0 + 0.9, 1.74), (0.85, 0.65, 0.08))
    K.part(bm, 'steel_painted', name='switch_cabinet', mat_tint=(0.4, 0.45, 0.4), grime=0.7)
    K.footprint_rect(x0 - 1.0, y0 + 0.9, 1.0, 0.8, 0, 'HIGH', 'cabinet')
    for (cx, cy, nx, ny) in ((x1 + 0.01, 0, 1, 0), (x0 - 0.01, 0, -1, 0)):
        K.decal('streak_rust', (cx, cy, 3.3), (nx, ny, 0), 0.6, 1.2, alpha=0.7)
    for k in range(4):
        K.decal(rr.choice(('efflorescence', 'streak_long')), (rr.uniform(x0 + 0.8, x1 - 0.8), y0 - 0.13,
                rr.uniform(1.6, 3.2)), (0, -1, 0), rr.uniform(0.6, 1.0), rr.uniform(1.0, 1.6), alpha=0.6)


# ------------------------------------------------------------------------------------------------ rope wheels
def spoked_wheel(c, axis, R, width=0.22, spokes=8, segs=40, rim_tint=(0.42, 0.5, 0.44), name='bull_wheel',
                 inner_ring=True):
    """Cable-way bull wheel / sheave: U-section rim with a bright worn rope groove, round tapered spokes, a heavy
    hub with bolt ring and an inner stiffening ring - open between the spokes (reads as a wheel, never a bowl)."""
    c = V(c)
    ax = V(axis).normalized()
    u = ax.orthogonal().normalized()
    v = ax.cross(u).normalized()
    hw = width / 2
    prof = [(R - 0.13, hw), (R, hw), (R, hw * 0.55), (R - 0.05, 0.0), (R, -hw * 0.55), (R, -hw), (R - 0.13, -hw)]
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        d = u * math.cos(a) + v * math.sin(a)
        rings.append([bm.verts.new(c + d * rr + ax * zz) for rr, zz in prof])
    np_ = len(prof)
    for i in range(segs):
        j = (i + 1) % segs
        for k in range(np_):
            k2 = (k + 1) % np_
            bm.faces.new((rings[i][k], rings[j][k], rings[j][k2], rings[i][k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rs = max(0.03, R * 0.028)
    for k in range(spokes):
        a = 2 * math.pi * (k + 0.5) / spokes
        d = u * math.cos(a) + v * math.sin(a)
        K.cyl_bm(bm, c + d * R * 0.16, c + d * (R - 0.11), rs * 1.5, 7, r1=rs)
    if inner_ring:
        for i in range(24):
            a0, a1 = 2 * math.pi * i / 24, 2 * math.pi * (i + 1) / 24
            K.cyl_bm(bm, c + (u * math.cos(a0) + v * math.sin(a0)) * R * 0.55,
                     c + (u * math.cos(a1) + v * math.sin(a1)) * R * 0.55, rs * 0.8, 5)
    K.cyl_bm(bm, c - ax * hw * 1.8, c + ax * hw * 1.8, R * 0.16, 16)
    ob = K.part(bm, 'steel_painted', name=name, smooth=True, mat_tint=rim_tint, grime=0.6)
    bm = bmesh.new()                                     # polished groove liner + bolt heads on the hub
    for i in range(segs):
        a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
        K.cyl_bm(bm, c + (u * math.cos(a0) + v * math.sin(a0)) * (R - 0.035),
                 c + (u * math.cos(a1) + v * math.sin(a1)) * (R - 0.035), hw * 0.4, 5)
    for k in range(8):
        a = 2 * math.pi * k / 8
        p = c + (u * math.cos(a) + v * math.sin(a)) * R * 0.11 + ax * hw * 1.8
        K.cyl_bm(bm, p, p + ax * 0.03, R * 0.015 + 0.01, 6)
    K.part(bm, 'steel_galv', name=name + '_groove', smooth=True, mat_tint=(0.78, 0.78, 0.76), grime=0.2)
    return ob


_orig_sod = F.sod_roof


def sod_roof(*a, **kw):
    """Sod roof + winter tuning: a thinner blanket sitting just on the turf, so tussocks and the lumpy sod poke
    through in the thin spots and the roof keeps its torvtak character under snow."""
    R = _orig_sod(*a, **kw)
    R.snow_off = kw.get('turf_th', 0.2) + 0.06
    R.snow_th = 0.17
    R.snow_patchy = 0.12
    return R


F.sod_roof = sod_roof
