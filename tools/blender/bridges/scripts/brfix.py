"""Bridges rework (art director round 1) - bridge-only overrides on top of the shared kit, WITHOUT editing the kit:
material aliases (the granite_wall texture reads as plank courses -> dressed ashlar tinted granite-grey), battered
stepped retaining wing walls, voussoir rings with a smooth extrados + archivolt and arc-length soffit UVs, pier-hugging
riprap, vertex-colour weathering (tide mark, algae, efflorescence, lichen, soot, sun bleaching, dust), snow v2, ice."""
import math
import bpy, bmesh
from mathutils import Vector as V, noise as N
import brlib as BL
from brlib import K, C
import kit_bridge as KB
import kit_weather as W

# ------------------------------------------------------------------ material aliases (bridge assets only)
ALIAS = {
    'granite': ('ashlar', (0.60, 0.61, 0.63), 1.0),          # dressed grey granite blocks (~0.3 m courses)
    'granite_dark': ('ashlar', (0.50, 0.51, 0.52), 1.0),
    'sandstone_red': ('sandstone_ochre', (0.74, 0.47, 0.41), 0.8),
    'deck_planks': ('deck_planks', (0.74, 0.76, 0.8), 1.0),         # de-pinked plank decks   # Old Red Sandstone (bedded, warm, not salmon)
}
_orig_part = C.part


def part2(bm, mid, *a, **kw):
    if mid in ALIAS:
        base, mt, sc = ALIAS[mid]
        if kw.get('mat_tint') is None:
            kw['mat_tint'] = mt
        kw['uv_scale'] = kw.get('uv_scale', 1.0) * sc
        mid = base
    return _orig_part(bm, mid, *a, **kw)


def tile(mid):
    if mid in ALIAS:
        return C.tile_of(ALIAS[mid][0]) * ALIAS[mid][2]
    return C.tile_of(mid)


for _m in (C, KB, W, BL, K):
    if hasattr(_m, 'part'):
        _m.part = part2
import kit_arch as _KA, kit_detail as _KD, kit_roof as _KR
for _m in (_KA, _KD, _KR):
    if hasattr(_m, 'part'):
        _m.part = part2
part = part2
_orig_railing = _KD.railing


def _railing(p0, p1, h=1.0, style='iron', *a, **kw):
    return _orig_railing(p0, p1, h, 'iron' if style == 'pipe' else style, *a, **kw)


_KD.railing = _railing


WING_OVS = 1.6


# ------------------------------------------------------------------ wing walls: battered, stepped retaining walls
def retaining_wings(deck, xe, side, width, bed, water, length=5.5, mid='fieldstone', coping='ashlar', dressed='ashlar',
                    parapet_h=0.95, steps=3, thick=0.75, batter=0.11, name='wing'):
    """Wing walls along the river bank at the abutment face xe (side=-1 west bank, +1 east bank). The river face is
    battered (1:9) from a projecting footing at the bed up to a coping that steps down from parapet height at the bridge
    to 0.35 m above the bank; each step has coping stones, the run ends in a pier with a pyramidal cap."""
    zt0 = deck.z(xe) + parapet_h - 0.05
    tops = [zt0 + (0.35 - zt0) * k / (steps - 1) for k in range(steps)] if steps > 1 else [zt0]
    for s in (-1, 1):
        y0 = s * width / 2
        seg = length / steps
        bm = bmesh.new()
        cp = bmesh.new()
        for k in range(steps):
            ya, yb = y0 + s * seg * k, y0 + s * seg * (k + 1)
            zt = tops[k]
            H = zt - bed
            xf_top = xe - side * 0.12
            xf_bot = xf_top - side * batter * H
            xb = xe + side * thick
            p8 = [V((xf_bot, ya, bed)), V((xf_bot, yb, bed)), V((xb, yb, bed)), V((xb, ya, bed)),
                  V((xf_top, ya, zt)), V((xf_top, yb, zt)), V((xb, yb, zt)), V((xb, ya, zt))]
            C.hexa_bm(bm, p8)
            nb = max(2, int(seg / 0.85))                   # coping stones, oversailing the river face
            ybc = yb - s * 0.36 if k == steps - 1 else yb    # last run stops at the terminal pier's face
            for i in range(nb):
                a_ = ya + (ybc - ya) * i / nb + s * 0.01
                b_ = ya + (ybc - ya) * (i + 1) / nb - s * 0.01
                C.box_bm(cp, ((xf_top + xb) / 2 - side * 0.03 * WING_OVS, (a_ + b_) / 2, zt + 0.08),
                         (abs(xb - xf_top) + 0.1 * WING_OVS, abs(b_ - a_), 0.16 + BL.rng().uniform(-0.01, 0.01)))
            if zt > 0.3:
                C.footprint([(xe, ya), (xe, yb), (xb, yb), (xb, ya)], 'HIGH' if zt > 1.05 else 'LOW', 'wing_wall')
        # footing / plinth at the bed up to just above the water (reads as the wall stepping into the river)
        yl = y0 + s * length
        C.box_bm(bm, (xe - side * (batter * (water + 0.4 - bed) + 0.35), (y0 + yl) / 2, (bed + water + 0.4) / 2),
                 (0.5, length + 0.4, water + 0.4 - bed))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        part(bm, mid, name='%s_%d_%d' % (name, side, s))
        # terminal pier with cap
        xc = xe + side * thick / 2 - side * 0.06
        zt = tops[-1]
        C.box_bm(cp, (xc, yl + s * 0.1, (zt + 0.3) / 2), (thick + 0.24, 0.9, zt + 0.9))
        b0 = [V((xc - (thick + 0.36) / 2, yl + s * 0.1 - 0.52, zt + 0.6)), V((xc + (thick + 0.36) / 2, yl + s * 0.1 - 0.52, zt + 0.6)),
              V((xc + (thick + 0.36) / 2, yl + s * 0.1 + 0.52, zt + 0.6)), V((xc - (thick + 0.36) / 2, yl + s * 0.1 + 0.52, zt + 0.6))]
        C.hexa_bm(cp, b0 + [p + V((0, 0, 0.12)) for p in b0])
        vs = [cp.verts.new(p + V((0, 0, 0.12))) for p in b0]
        ap = cp.verts.new(V((xc, yl + s * 0.1, zt + 1.0)))
        for i in range(4):
            cp.faces.new((vs[i], vs[(i + 1) % 4], ap))
        bmesh.ops.recalc_face_normals(cp, faces=cp.faces)
        part(cp, coping, name='%s_cop_%d_%d' % (name, side, s))
        # quoins on the wall's river-side arris at the bridge corner
        q = bmesh.new()
        z, k = bed, 0
        while z < tops[0] - 0.3:
            h = 0.42
            L = 0.6 if k % 2 == 0 else 0.38
            xf = xe - side * (0.12 + batter * (tops[0] - z - h / 2))
            C.box_bm(q, (xf - side * 0.02 + side * 0.25, y0 + s * L / 2, z + h / 2), (0.54, L, h - 0.014))
            z += h
            k += 1
        part(q, dressed, name='%s_quoin_%d_%d' % (name, side, s))


_orig_sab = KB.stone_arch_bridge


def stone_arch_bridge(**kw):
    """kit stone_arch_bridge with the new wing walls (the kit's flat splayed slabs are suppressed)."""
    wl = kw.get('wing_len', 5.5)
    ow = KB.wing_walls
    KB.wing_walls = lambda *a, **k: None
    try:
        B = _orig_sab(**kw)
    finally:
        KB.wing_walls = ow
    for side in (-1, 1):
        retaining_wings(B['deck'], side * B['tot'] / 2, side, kw.get('width', 7.6), kw.get('bed', -6.6), kw.get('water', -4.0),
                        wl, kw.get('body', 'fieldstone'), kw.get('coping', 'ashlar'), kw.get('dressed', 'ashlar'),
                        kw.get('parapet_h', 1.0))
    return B


# ------------------------------------------------------------------ voussoir rings: smooth extrados + archivolt, soffit courses
def _arch_sampler(xc, span, spring, rise):
    pts = KB.arch_profile(xc, span, spring, rise, 96)
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.dist(pts[i], pts[i + 1]))
    L = cum[-1]

    def at(t):
        d = max(0.0, min(1.0, t)) * L
        for i in range(len(pts) - 1):
            if cum[i + 1] >= d - 1e-9:
                u = (d - cum[i]) / max(1e-9, cum[i + 1] - cum[i])
                x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u
                z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u
                tx, tz = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
                ln = math.hypot(tx, tz)
                return x, z, -tz / ln, tx / ln
        return pts[-1][0], pts[-1][1], 1, 0
    return at, L


VGAP, VTONE = 0.014, 0.0


def arch_ring(xc, span, spring, rise, width, mid='ashlar', depth=0.55, proud=0.035, block=0.34, key=True, soffit=True,
              name='voussoirs', archivolt=True):
    """Voussoirs of equal depth (smooth extrados, keystone slightly deeper and prouder), a projecting archivolt band
    over the extrados (the coursed spandrel meets a clean line), and a barrel soffit mapped by arc length so the
    stone courses run along the barrel (no stretched stripes)."""
    at, L = _arch_sampler(xc, span, spring, rise)
    n = max(7, int(L / (block * 1.12))) | 1
    r = BL.rng()
    bm = bmesh.new()
    gap = VGAP
    vcol = bm.loops.layers.color.new('Col2') if VTONE else None
    for k in range(n):
        tone = 1 - VTONE * r.random()
        t0, t1 = (k + gap * n / L) / n, (k + 1 - gap * n / L) / n
        iskey = key and k == n // 2
        dd = depth * (1.16 if iskey else 1.0)
        x0, z0, nx0, nz0 = at(t0)
        x1, z1, nx1, nz1 = at(t1)
        for side in (-1, 1):
            yo = side * (width / 2 + proud + (0.03 if iskey else r.uniform(-0.006, 0.006)))
            yi = side * (width / 2 - 0.3)
            q = [(x0, z0), (x1, z1), (x1 + nx1 * dd, z1 + nz1 * dd), (x0 + nx0 * dd, z0 + nz0 * dd)]
            a = [bm.verts.new((x, yo, z)) for x, z in q]
            b = [bm.verts.new((x, yi, z)) for x, z in q]
            fs = [bm.faces.new(a)]
            for i in (1, 2, 3):                      # buried back face + intrados (under the soffit) omitted
                j = (i + 1) % 4
                fs.append(bm.faces.new((a[j], a[i], b[i], b[j])))
            cen = V(((x0 + x1) / 2 + (nx0 + nx1) * dd / 4, 0, (z0 + z1) / 2 + (nz0 + nz1) * dd / 4))
            for f in fs:
                f.normal_update()
                fc = f.calc_center_median()
                if f is fs[0]:
                    if f.normal.y * side < 0:
                        f.normal_flip()
                elif f.normal.dot(V((fc.x - cen.x, 0, fc.z - cen.z))) < 0:
                    f.normal_flip()
                if vcol:
                    for l in f.loops:
                        l[vcol] = (tone, tone * (1 - 0.1 * (1 - tone)), tone * (1 - 0.2 * (1 - tone)), 1.0)
    ob = part(bm, mid, name=name)
    if vcol:
        apply_col2(ob)
    if archivolt:                                          # continuous extrados moulding (hood) over the ring
        bm = bmesh.new()
        m = 22
        rows = []
        for i in range(m + 1):
            x, z, nx, nz = at(i / m)
            rows.append((x, z, nx, nz))
        for side in (-1, 1):
            yo, yi = side * (width / 2 + proud + 0.07), side * (width / 2 - 0.05)
            ring = []
            for x, z, nx, nz in rows:
                d0, d1 = depth + 0.01, depth + 0.17
                ring.append([bm.verts.new((x + nx * d0, yo, z + nz * d0)), bm.verts.new((x + nx * d1, yo, z + nz * d1)),
                             bm.verts.new((x + nx * d1, yi, z + nz * d1)), bm.verts.new((x + nx * d0, yi, z + nz * d0))])
            for i in range(m):
                a, b = ring[i], ring[i + 1]
                for k2 in (0, 1):                    # outer face + extrados top only (back / underside are buried)
                    f = bm.faces.new((a[k2], a[(k2 + 1) % 4], b[(k2 + 1) % 4], b[k2]))
                    f.normal_update()
                    want = V((0, side, 0)) if k2 == 0 else V((rows[i][2], 0, rows[i][3]))
                    if f.normal.dot(want) < 0:
                        f.normal_flip()
        part(bm, mid, name=name + '_archivolt')
    if soffit:
        bm = bmesh.new()
        lay = bm.loops.layers.uv.new('UVMap')
        m = 28
        ny = max(2, int(width / 1.9))
        tl = tile(mid)
        grid, nrm, vi = [], [], {}
        for i in range(m + 1):
            x, z, nx, nz = at(i / m)
            nrm.append((nx, nz))
            row = [bm.verts.new((x - nx * 0.015, -width / 2 + width * j / ny, z - nz * 0.015)) for j in range(ny + 1)]
            for v in row:
                vi[v] = i
            grid.append(row)
        for i in range(m):
            for j in range(ny):
                f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
                f.normal_update()
                inward = V((-(nrm[i][0] + nrm[i + 1][0]), 0, -(nrm[i][1] + nrm[i + 1][1])))
                if f.normal.dot(inward) < 0:
                    f.normal_flip()
        for f in bm.faces:
            for l in f.loops:
                l[lay].uv = (l.vert.co.y / tl + 0.37, (L * vi[l.vert] / m) / tl + 0.21)
        part(bm, mid, name=name + '_soffit', uv='keep', bisect=False)
    return ob


KB.arch_ring = arch_ring


# ------------------------------------------------------------------ riprap that hugs the pier foot (no floating slabs)
def riprap_ring(outline, water, n=22, smin=0.35, smax=0.75, off=(0.05, 0.9), mid='granite', name='riprap', tint=None, out_dir=None):
    """Boulders piled against a pier / wall foot: rounded (not slab) stones sunk so only 10-35 cm break the surface,
    tallest against the masonry and dropping below the water away from it. outline = closed plan polygon."""
    r = BL.rng()
    per = [(V((*outline[i], 0)), V((*outline[(i + 1) % len(outline)], 0))) for i in range(len(outline))]
    L = sum((b - a).length for a, b in per)
    c = sum((a for a, _ in per), V()) / len(per)
    bm = bmesh.new()
    for i in range(n):
        d = r.uniform(0, L)
        for a, b in per:
            sl = (b - a).length
            if d <= sl:
                p = a.lerp(b, d / max(sl, 1e-6))
                break
            d -= sl
        out = (p - c)
        out.z = 0
        out = out.normalized() if out.length > 1e-6 else V((1, 0, 0))
        if out_dir is not None:
            out = V(out_dir)
        o = r.uniform(*off)
        s = r.uniform(smin, smax)
        emerge = (0.35 - 0.35 * (o - off[0]) / (off[1] - off[0])) * r.uniform(0.6, 1.1)
        q = p + out * (o + s * 0.5) + V((0, 0, water + emerge - s * 0.8))
        cb = W._blob_bm(q, s, r.random() * 10, (1, r.uniform(0.75, 1), r.uniform(0.75, 0.95)), 1, 0.28)
        tmp = bpy.data.meshes.new('rr')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return part(bm, mid, name=name, grime=1.0, tint=tint or (0.42, 0.42, 0.4), bisect=True)


def outline_rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# ------------------------------------------------------------------ vertex-colour weathering pass
MASONRY = ('fieldstone', 'fieldstone_grey', 'ashlar', 'ashlar_limestone', 'brick_red', 'brick_dark', 'sandstone_ochre',
           'concrete_bunker', 'concrete_formwork', 'concrete_board', 'concrete_slab', 'mudbrick', 'granite')


DENSE_CUTS = (-0.25, 0.12, 0.42, 0.62, 0.85, 1.25, 1.8, 2.6)
TIDE_FN = None


def _densify(bm, step, water, zmin, zmax, xr=None, yr=None):
    cuts = [water + d for d in DENSE_CUTS] if water is not None else []
    z = math.floor(zmin / step) * step
    while z < zmax:
        if all(abs(z - c) > 0.25 for c in cuts):
            cuts.append(z)
        z += step
    for hz in cuts:
        if zmin + 0.02 < hz < zmax - 0.02:
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, hz), plane_no=(0, 0, 1))
    for ax, rg in ((0, xr), (1, yr)):
        if rg and rg[1] - rg[0] > step * 1.5:
            k = int((rg[1] - rg[0]) / step)
            for i in range(1, k):
                co = [0, 0, 0]
                co[ax] = rg[0] + (rg[1] - rg[0]) * i / k
                no = [0, 0, 0]
                no[ax] = 1
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)


def _mul(c, m):
    return V((c[0] * m[0], c[1] * m[1], c[2] * m[2]))


TIDE_PALE = 0.1


def weather(parts=None, water=None, theme='temperate', deck=None, step=1.7, soot=None, patches=0.0, lichen=0.5,
            moss=0.5, base=0.92, skip=('decal', 'snow', 'lamp'), extra=None, noskip=('rubble', 'debris', 'toe', 'riprap'), mids=None):
    """Re-colour COLOR_0 of masonry parts: per-stone tone / hue breakup, lichen, north moss, deck run-off streaks,
    darker damp soffits, tide mark (dark algae band, pale line, damp fade) at the water line, patch repairs, soot
    (soot=(center, radius, up_bias)), desert sun bleaching + dust at the base. extra(p, n, c) -> c hook."""
    water = C.A.water if water is None else water
    for o in list(parts or C.A.parts):
        if o.name not in bpy.data.objects or not o.data.materials or o.name.startswith(tuple(skip) + tuple(noskip)):
            continue
        kid = o.data.materials[0].get('kit_id', '')
        if kid not in (mids or MASONRY):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        zs = [v.co.z for v in bm.verts]
        big = max((e.calc_length() for e in bm.edges), default=0) > step * 1.6
        if big:
            xs = [v.co.x for v in bm.verts]
            ys = [v.co.y for v in bm.verts]
            _densify(bm, step, water, min(zs), max(zs), (min(xs), max(xs)), (min(ys), max(ys)))
        bm.normal_update()
        col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
        for f in bm.faces:
            n = f.normal
            for l in f.loops:
                p = l.vert.co
                c = V(l[col][:3]) * base
                t = N.noise(p * 0.8 + V((3.1, 1.7, 0.3)))
                h = N.noise(p * 0.37 + V((9.2, 4.4, 1.1)))
                c = _mul(c, (1 + 0.13 * t + 0.05 * h, 1 + 0.13 * t, 1 + 0.13 * t - 0.05 * h))
                if lichen > 0 and theme != 'desert':
                    lk = max(0.0, N.noise(p * 1.1 + V((5, 5, 5))) - 0.25) * 1.8 * lichen
                    lk *= 0.5 + 0.5 * max(0.0, -n.y) + 0.4 * max(0.0, n.z)
                    c = c.lerp(_mul(c, (0.97, 0.98, 0.72)), min(0.8, lk))
                if moss > 0 and theme != 'desert':
                    mk = moss * max(0.0, n.y * 0.8 + 0.2) * max(0.0, N.noise(p * 0.9 + V((1, 7, 2))) + 0.2)
                    c = c.lerp(_mul(c, (0.66, 0.74, 0.5)), min(0.55, mk))
                if deck is not None and abs(n.z) < 0.5:
                    dz = deck.z(p.x) - p.z
                    if 0.3 < dz < 3.5:
                        st = max(0.0, N.noise(V((p.x * 0.9, p.y * 0.9, p.z * 0.3))) + 0.15)
                        c *= 1 - 0.22 * st * (1 - (dz - 0.3) / 3.2)
                if n.z < -0.35:
                    c = _mul(c, (0.74, 0.74, 0.72))
                if water is not None:
                    hw = p.z - water
                    if TIDE_FN is not None:
                        c = TIDE_FN(p, water, c)
                    elif hw < 0.42:
                        k = 1.0 if hw < 0.12 else 1 - (hw - 0.12) / 0.3
                        c = c.lerp(_mul(c, (0.36, 0.40, 0.28)), 0.9 * k)
                    elif hw < 0.62:
                        c = c.lerp(V((0.97, 0.96, 0.91)), TIDE_PALE)
                    elif hw < 2.6:
                        c *= 1 - 0.3 * (1 - (hw - 0.62) / 1.98) ** 1.4
                if patches > 0:
                    cx, cz = math.floor(p.x / 2.4 + 0.3 * math.floor(p.z / 1.5)), math.floor(p.z / 1.5)
                    hsh = (math.sin(cx * 12.9898 + cz * 78.233 + (p.y > 0) * 3.1) * 43758.5453) % 1.0
                    if hsh < patches:
                        c = _mul(c, (0.86, 0.82, 0.76) if hsh < patches / 2 else (1.0, 1.02, 1.06))
                if theme == 'desert':
                    bl = max(0.0, -n.y * 0.6 + n.z * 0.6)
                    c = c.lerp(V((1, 1, 1)) * (sum(c) / 3) * 1.12, min(0.55, bl * 0.6))
                    gz = p.z if water is None else max(p.z, 0)
                    du = max(0.0, 1 - (p.z - (0 if p.z > -0.2 else min(zs))) / 1.6) if p.z > -0.2 else 0.0
                    c = c.lerp(V((0.93, 0.82, 0.64)), min(0.6, du * 0.7))
                if soot is not None:
                    sc, sr, ub = soot
                    d = (p - V(sc))
                    d.z = d.z / (1.8 if d.z > 0 else 0.8)
                    k = max(0.0, 1 - d.length / sr) ** 1.2 * (0.7 + 0.3 * N.noise(p * 2.0))
                    c *= 1 - min(0.88, k)
                if extra:
                    c = extra(p, n, c)
                l[col] = (min(1, max(0, c.x)), min(1, max(0, c.y)), min(1, max(0, c.z)), l[col][3])
        bm.to_mesh(o.data)
        bm.free()


# ------------------------------------------------------------------ demolished span: block-level fracture, fill, debris
def _pip(pt, poly):
    x, z = pt
    ins = False
    for i in range(len(poly)):
        (x0, z0), (x1, z1) = poly[i], poly[i - 1]
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            ins = not ins
    return ins


def _dseg(pt, poly):
    best = 1e9
    p = V((pt[0], pt[1]))
    for i in range(len(poly)):
        a, b = V(poly[i - 1]), V(poly[i])
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
        best = min(best, (a + ab * t - p).length)
    return best


def breach_outline(xc, half_top, half_bot, z_top, z_bot, seed=1, step=0.45):
    """Jagged x-z outline of a blown arch crown: wide at the deck, narrowing (stepped, torn) toward the intrados."""
    r = BL.rng()
    left, right = [], []
    k = int((z_top - z_bot) / step)
    for i in range(k + 1):
        t = i / k
        z = z_top - (z_top - z_bot) * t
        hw = half_top + (half_bot - half_top) * t ** 0.8
        left.append((xc - hw - r.uniform(-0.35, 0.35), z))
        right.append((xc + hw + r.uniform(-0.35, 0.35), z))
    return left + [(xc + r.uniform(-0.5, 0.5), z_bot - r.uniform(0.2, 0.6))] + list(reversed(right))


def breach(poly, width, fill_mid='fieldstone', fill_tint=(0.55, 0.47, 0.38), hang=0.35, seed=1,
           solid=('bridge_body', 'parapet_', 'band_', 'voussoirs_archivolt')):
    """Cut the outline `poly` (x-z, extruded across Y) out of the whole bridge. Solid masses (body, parapet walls,
    string courses, archivolts) get an exact boolean and their fresh fracture faces are re-materialed as rubble
    fill; block-built parts (voussoirs, coping, kerbs, quoins) lose whole blocks and the blocks next to the tear are
    displaced / tilted (hanging masonry); open sheets (road, soffit, road base) and decals are trimmed by face."""
    import kit_arch as KA
    r = BL.rng()
    cut = bmesh.new()
    KB._prism_xz(cut, list(poly), -width / 2 - 3, width / 2 + 3)
    fillm = C.mat(fill_mid, fill_tint)
    for o in list(C.A.parts):
        if o.name not in bpy.data.objects or o.get('kit_node', 'main') != 'main' and not o.name.startswith('decal'):
            continue
        bb = [o.matrix_world @ V(b) for b in o.bound_box]
        xs = [p.x for p in bb]
        if max(xs) < min(p[0] for p in poly) - 0.6 or min(xs) > max(p[0] for p in poly) + 0.6:
            continue
        nm = o.name
        bm = bmesh.new()
        bm.from_mesh(o.data)
        is_solid = nm.startswith(tuple(solid)) and not nm.endswith('_coping')
        if is_solid:
            bm.free()
            c2 = cut.copy()
            KA.cut_object(o, c2)
            o.data.materials.append(fillm)
            for f in o.data.polygons:
                c = f.center
                if abs(f.normal.y) < 0.6 and _dseg((c.x, c.z), poly) < 0.12:
                    f.material_index = 1
            continue
        islands = []
        seen = set()
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, isl = [v], []
            seen.add(v.index)
            while stack:
                u = stack.pop()
                isl.append(u)
                for e in u.link_edges:
                    w = e.other_vert(u)
                    if w.index not in seen:
                        seen.add(w.index)
                        stack.append(w)
            islands.append(isl)
        kill = []
        block = len(islands) > 4
        for isl in islands:
            if not block:
                break
            c = sum((v.co for v in isl), V()) / len(isl)
            if _pip((c.x, c.z), poly):
                kill += isl
            elif _dseg((c.x, c.z), poly) < 0.55 and r.random() < hang:
                ang = r.uniform(-0.25, 0.25)
                m = __import__('mathutils').Matrix.Rotation(ang, 3, 'Y')
                d = V((0, 0, -r.uniform(0.04, 0.22)))
                for v in isl:
                    v.co = c + m @ (v.co - c) + d
        if block:
            bmesh.ops.delete(bm, geom=list(set(kill)), context='VERTS')
        else:
            fk = [f for f in bm.faces if _pip((f.calc_center_median().x, f.calc_center_median().z), poly)]
            bmesh.ops.delete(bm, geom=fk, context='FACES')
        if not bm.faces:
            bm.free()
            C.A.parts.remove(o)
            bpy.data.objects.remove(o)
            continue
        bm.to_mesh(o.data)
        bm.free()
    cut.free()


def debris_pile(xc, yc, rx, ry, z_base, z_top, mids=('ashlar', 'fieldstone'), n=60, name='debris', tint=None,
                slabs=2, slab_mid=None, water=None):
    """Masonry debris in the river: a stone-fill mound (body stone texture, not gravel) under a jumble of dressed
    blocks and wedge voussoirs (random tilts), plus tilted wall / parapet slabs."""
    r = BL.rng()
    bm = bmesh.new()
    rings, segs = 6, 16
    rows = []
    for i in range(rings):
        t = i / (rings - 1)
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            k = 1 + 0.22 * N.noise(V((math.cos(a) * 1.7, math.sin(a) * 1.7, t * 2.1)))
            rr = (1 - t * 0.92) * k
            z = z_base + (z_top - z_base) * (1 - (1 - t) ** 1.7) * (0.85 + 0.3 * r.random())
            row.append(bm.verts.new((xc + math.cos(a) * rx * rr, yc + math.sin(a) * ry * rr, z)))
        rows.append(row)
    for i in range(rings - 1):
        for j in range(segs):
            k2 = (j + 1) % segs
            bm.faces.new((rows[i][j], rows[i][k2], rows[i + 1][k2], rows[i + 1][j]))
    top = bm.verts.new((xc, yc, z_top + 0.1))
    for j in range(segs):
        bm.faces.new((rows[-1][j], rows[-1][(j + 1) % segs], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.normal_update()
    if sum(f.normal.z for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    part(bm, mids[1], name=name + '_mound', tint=(0.44, 0.42, 0.39), grime=1.0)
    bm = bmesh.new()
    for i in range(n):
        a, d = r.uniform(0, 2 * math.pi), math.sqrt(r.random()) * 0.92
        x, y = xc + math.cos(a) * rx * d, yc + math.sin(a) * ry * d
        z = z_base + (z_top - z_base) * (1 - d ** 1.7) * 0.9
        L, Wd, H = r.uniform(0.45, 0.95), r.uniform(0.3, 0.55), r.uniform(0.25, 0.42)
        c = V((x, y, z + H * 0.25))
        vs = []
        tap = r.uniform(0.7, 1.0) if r.random() < 0.4 else 1.0          # wedge voussoirs
        for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
            vs.append(V((sx * L / 2 * (tap if sz > 0 else 1), sy * Wd / 2, sz * H / 2)))
        from mathutils import Euler
        rot = Euler((r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(0, 3.14))).to_matrix()
        C.hexa_bm(bm, [c + rot @ v for v in vs])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, mids[0], name=name + '_blocks', tint=tint or (0.66, 0.65, 0.62), grime=0.9)
    if slabs:
        bm = bmesh.new()
        for i in range(slabs):
            s = -1 if i % 2 == 0 else 1
            c = V((xc + r.uniform(-rx * 0.4, rx * 0.4), yc + s * ry * 0.55, z_base + (z_top - z_base) * 0.55))
            from mathutils import Euler
            rot = Euler((s * r.uniform(0.35, 0.6), r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3))).to_matrix()
            vs = []
            for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
                vs.append(c + rot @ V((sx * r.uniform(1.3, 1.8), sy * 0.25, sz * 0.55)))
            C.hexa_bm(bm, vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        part(bm, slab_mid or mids[1], name=name + '_slabs', tint=tint)


def apply_col2(ob):
    """part() rewrites COLOR_0 ('Col'); helpers that paint their own colours put them in 'Col2' -> copied here."""
    me = ob.data
    c2, c1 = me.color_attributes.get('Col2'), me.color_attributes.get('Col')
    if c2 and c1:
        for i in range(len(c1.data)):
            c1.data[i].color = c2.data[i].color
        me.color_attributes.remove(c2)
    return ob


# ------------------------------------------------------------------ snow v2: drifted road snow with ruts, caps, ice
DRIFT_W, RUT_DEPTH = 0.55, 0.85
RUT_WANDER, RUT_COL, TRODDEN = 0.0, (0.58, 0.55, 0.5), 0.0


def road_snow(z_of, x0, x1, width, crown=0.06, ruts=(-0.85, 0.85), rut_w=0.32, base=0.07, drift=0.16, step=1.4,
              name='snow_road', lanes=1):
    """Snow sheet on a road: thin, trodden centre, deep wheel ruts (slush-grey), drifts banked against the kerbs /
    parapets, noisy surface. z_of(x) = road surface height (camber)."""
    rw = width
    ys = sorted(set([-rw / 2, -rw / 2 + 0.18, -rw / 2 + 0.5, -rw / 2 + 0.9, rw / 2 - 0.9, rw / 2 - 0.5, rw / 2 - 0.18, rw / 2] +
                    [c + d for c in ruts for d in (-rut_w, 0, rut_w)] + [0.0]))
    ys = [y for y in ys if -rw / 2 <= y <= rw / 2]
    nx = max(2, int((x1 - x0) / step))
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    grid = []
    shade = {}
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        row = []
        for y in ys:
            e = min(y + rw / 2, rw / 2 - y)
            dr = drift * max(0.0, 1 - e / DRIFT_W) ** 1.5
            rd = min(abs(y - c - RUT_WANDER * N.noise(V((x * 0.13, c, 0.7)))) for c in ruts)
            rut = max(0.0, 1 - rd / rut_w)
            t = base * (1 + 0.45 * N.noise(V((x * 0.6, y * 0.9, 1.3)))) + dr
            t *= 1 - RUT_DEPTH * rut
            zc = z_of(x) + crown * (1 - (2 * y / rw) ** 2) + 0.005
            v = bm.verts.new((x, y, zc + max(0.012, t)))
            shade[v] = rut
            row.append(v)
        grid.append(row)
    for i in range(nx):
        for j in range(len(ys) - 1):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    for s_, j in ((0, 0), (1, len(ys) - 1)):
        for i in range(nx):
            a, b = grid[i][j], grid[i + 1][j]
            a2 = bm.verts.new((a.co.x, a.co.y, a.co.z - 0.2))
            b2 = bm.verts.new((b.co.x, b.co.y, b.co.z - 0.2))
            shade[a2] = shade[b2] = 0
            bm.faces.new((a, b, b2, a2) if s_ else (b, a, a2, b2))
    for f in bm.faces:
        for l in f.loops:
            v = l.vert
            rut = shade.get(v, 0)
            nn = N.noise(v.co * 0.8)
            c = V((0.97, 0.98, 1.0)) * (0.93 + 0.07 * nn)
            c = c.lerp(V(RUT_COL), min(0.85, rut * (0.8 + 0.3 * nn)))
            if TRODDEN and shade.get(v, None) is not None:
                tr = max(0.0, N.noise(V((v.co.x * 0.35, v.co.y * 0.6, 5.5))) - 0.1) * TRODDEN
                c = c.lerp(V((0.78, 0.78, 0.78)), min(0.35, tr))
            l[col] = (c.x, c.y, c.z, 1.0)
    return apply_col2(part(bm, 'snow', name=name, uv='aligned', grime=0, bisect=False, jitter=0.0, lod='keep'))


def snow_caps(parts, thick=0.1, min_nz=0.5, name='snow_caps'):
    """Pillowy snow on up-facing ledges of the given parts (coping, string courses, cutwater caps, lamp tops,
    starlings, wing copings): kit snow_pass + blue-grey shading on the cap sides."""
    ob = W.snow_pass(thick=thick, min_nz=min_nz, noise=0.45, parts=parts, min_area=0.004)
    if ob is None:
        return None
    ob.name = name
    me = ob.data
    ca = me.color_attributes.get('Col')
    if ca:
        for poly in me.polygons:
            k = 1.0 if poly.normal.z > 0.6 else 0.82
            for li in poly.loop_indices:
                c = ca.data[li].color
                ca.data[li].color = (c[0] * k * 0.98, c[1] * k * 0.99, c[2] * k, c[3])
    return ob


FLOE = (0.4, 1.1)


def ice_shelf(outline, water, reach=(0.5, 1.8), thick=0.07, name='ice', floes=0, bounds=None, seed=1, m=28):
    """Shore-fast ice around a pier / wall foot (irregular ring grown out of `outline`) + drifting floes (broken
    plates, some rafted), snow-dusted tops, dark wet-blue edges."""
    r = BL.rng()
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    per = [V((*p, 0)) for p in outline]
    c = sum(per, V()) / len(per)
    ring_in, ring_out = [], []
    L = len(per)
    for i in range(m):
        t = i / m * L
        a, b = per[int(t) % L], per[(int(t) + 1) % L]
        p = a.lerp(b, t - int(t))
        d = (p - c)
        d.z = 0
        d.normalize()
        rr = r.uniform(*reach) * (0.7 + 0.6 * (0.5 + 0.5 * N.noise(p * 0.7)))
        ring_in.append(p - d * 0.05)
        ring_out.append(p + d * rr)
    z = water + 0.02

    def slab(pts_out, pts_in=None):
        top = [bm.verts.new((p.x, p.y, z + thick * 0.6)) for p in pts_out]
        bot = [bm.verts.new((p.x, p.y, z - thick * 0.4)) for p in pts_out]
        n = len(pts_out)
        if pts_in is None:
            f = bm.faces.new(top)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
        else:
            ti = [bm.verts.new((p.x, p.y, z + thick * 0.7)) for p in pts_in]
            for i in range(n):
                j = (i + 1) % n
                f = bm.faces.new((ti[i], ti[j], top[j], top[i]))
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((top[i], top[j], bot[j], bot[i]))
            f.normal_update()
            mid = (top[i].co + top[j].co) / 2
            if f.normal.dot(V((mid.x - cc.x, mid.y - cc.y, 0))) < 0:
                f.normal_flip()
    cc = c
    slab(ring_out, ring_in)
    for k in range(floes):
        if bounds:
            fx, fy = r.uniform(bounds[0], bounds[2]), r.uniform(bounds[1], bounds[3])
        else:
            a = r.uniform(0, 6.28)
            fx, fy = c.x + math.cos(a) * r.uniform(3, 7), c.y + math.sin(a) * r.uniform(3, 7)
        cc = V((fx, fy, 0))
        sz = r.uniform(*FLOE)
        nv = r.randint(6, 9)
        pts = [cc + V((math.cos(2 * math.pi * i / nv + r.uniform(-0.3, 0.3)) * sz * r.uniform(0.6, 1.2),
                       math.sin(2 * math.pi * i / nv + r.uniform(-0.3, 0.3)) * sz * r.uniform(0.5, 1.0), 0)) for i in range(nv)]
        slab(pts)
    for f in bm.faces:
        for l in f.loops:
            up = f.normal.z > 0.5
            nn = N.noise(l.vert.co * 1.4)
            sn = max(0.0, min(1.0, -0.35 + 1.5 * N.noise(l.vert.co * 0.9 + V((2, 3, 4)))))
            cc2 = V((0.3, 0.4, 0.46)).lerp(V((0.88, 0.91, 0.95)), sn) * (0.9 + 0.1 * nn) if up else V((0.2, 0.27, 0.32))
            l[col] = (cc2.x, cc2.y, cc2.z, 1.0)
    return apply_col2(part(bm, 'snow', name=name, uv='aligned', grime=0, bisect=False, jitter=0.0))


def icicles(points, length=(0.2, 0.6), name='icicles'):
    """Hanging icicles (4-sided cones) under ledges at the given points (x, y, z_underside)."""
    r = BL.rng()
    bm = bmesh.new()
    for p in points:
        for k in range(r.randint(1, 3)):
            q = V(p) + V((r.uniform(-0.15, 0.15), r.uniform(-0.03, 0.03), 0))
            KB.cyl_bm(bm, q, q - V((0, 0, r.uniform(*length))), r.uniform(0.02, 0.045), 4, r1=0.002, caps=False)
    return part(bm, 'snow', name=name, grime=0, bisect=False, jitter=0.0, tint=(0.82, 0.9, 0.98))


# ------------------------------------------------------------------ modelled chain links, period railings
def chain_bm(bm, p0, p1, link=0.16, wire=0.018, sag=0.0):
    """Real chain: alternating oval links (6-segment wire rings, 90 deg apart) from p0 to p1, optional catenary sag."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    Lh = d.length
    n = max(2, int(Lh / (link * 0.72)))
    ax = d.normalized()
    side = ax.orthogonal().normalized()
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        a = p0.lerp(p1, t0) - V((0, 0, sag * 4 * t0 * (1 - t0)))
        b = p0.lerp(p1, t1) - V((0, 0, sag * 4 * t1 * (1 - t1)))
        u = (b - a).normalized()
        w = side if i % 2 == 0 else u.cross(side).normalized()
        c = (a + b) / 2
        hl, hw = (b - a).length / 0.72 / 2, link * 0.3
        nrm = w.cross(u).normalized()
        rings = []
        for k in range(6):
            ang = 2 * math.pi * k / 6
            pc = c + u * (hl - wire) * math.cos(ang) + w * (hw - wire) * math.sin(ang)
            radial = (u * math.cos(ang) * hw / hl + w * math.sin(ang)).normalized()
            rings.append([bm.verts.new(pc + (radial * math.cos(2 * math.pi * j / 3) + nrm * math.sin(2 * math.pi * j / 3)) * wire)
                          for j in range(3)])
        for k in range(6):
            ra, rb = rings[k], rings[(k + 1) % 6]
            for j in range(3):
                bm.faces.new((ra[j], ra[(j + 1) % 3], rb[(j + 1) % 3], rb[j]))
    return n


def chain(p0, p1, name='chain', link=0.16, wire=0.018, sag=0.0, mid='cast_iron', node=None, pivot=None):
    bm = bmesh.new()
    chain_bm(bm, p0, p1, link, wire, sag)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = part(bm, mid, name=name, grime=0.5, bisect=False, tint=(0.55, 0.5, 0.46))
    if node:
        BL.mark_node([ob], node, pivot)
    return ob


def period_railing(p0, p1, h=1.05, bay=1.6, mid='timber_grey', tint=None, name='rail', style='cross', post=0.13,
                   iron=None):
    """Period railing: square posts with chamfered caps, top + bottom rails, and per bay a St Andrew's cross
    (style 'cross', Dutch / Alsace timber bridges) or flat-bar balusters ('bars', painted iron)."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    n = max(1, int(round(d.length / bay)))
    ax = d.normalized()
    rz = math.atan2(d.y, d.x)
    bm = bmesh.new()
    for i in range(n + 1):
        c = p0.lerp(p1, i / n)
        C.box_bm(bm, tuple(c + V((0, 0, (h + 0.08) / 2))), (post, post, h + 0.08), rz)
        if style != 'flat':
            C.box_bm(bm, tuple(c + V((0, 0, h + 0.12))), (post + 0.04, post + 0.04, 0.05), rz, taper=(0.6, 0.6))
    KB.beam_bm(bm, p0 + V((0, 0, h)), p1 + V((0, 0, h)), post + 0.03, 0.09)
    if style != 'flat':
        KB.beam_bm(bm, p0 + V((0, 0, 0.18)), p1 + V((0, 0, 0.18)), post * 0.7, 0.08)
    for i in range(n):
        a, b = p0.lerp(p1, i / n) + ax * post / 2, p0.lerp(p1, (i + 1) / n) - ax * post / 2
        if style == 'flat':                          # lattice of flat bars (double-sided quads, cheap)
            nn = V((-ax.y, ax.x, 0)) * 0.004
            for pa, pb in ((a + V((0, 0, 0.22)), b + V((0, 0, h - 0.05))), (b + V((0, 0, 0.22)), a + V((0, 0, h - 0.05)))):
                dd = (pb - pa).normalized()
                sd = V((-ax.y, ax.x, 0)).cross(dd).normalized() * 0.03
                q = [pa - sd, pb - sd, pb + sd, pa + sd]
                for o_ in (nn, -nn):
                    f = bm.faces.new([bm.verts.new(x + o_) for x in q])
                    f.normal_update()
                    if f.normal.dot(o_) < 0:
                        f.normal_flip()
        elif style == 'cross':
            KB.beam_bm(bm, a + V((0, 0, 0.22)), b + V((0, 0, h - 0.05)), 0.07, 0.06)
            KB.beam_bm(bm, b + V((0, 0, 0.22)), a + V((0, 0, h - 0.05)), 0.07, 0.06)
        else:
            k = max(2, int((b - a).length / 0.14))
            for j in range(1, k):
                q = a.lerp(b, j / k)
                C.box_bm(bm, tuple(q + V((0, 0, (h + 0.18) / 2))), (0.018, 0.018, h - 0.2), rz)
    ob = part(bm, mid, name=name, uv='beam', axis=tuple(ax), tint=tint, grime=0.7, bisect=False)
    if iron:                                             # bolts + corner plates at post heads (rust bleed source)
        bm = bmesh.new()
        for i in range(n + 1):
            c = p0.lerp(p1, i / n)
            nn = V((-ax.y, ax.x, 0))
            for s in (-1, 1):
                KB.cyl_bm(bm, c + nn * s * (post / 2) + V((0, 0, h)), c + nn * s * (post / 2 + 0.02) + V((0, 0, h)), 0.022, 5)
                KB.cyl_bm(bm, c + nn * s * (post / 2) + V((0, 0, 0.18)), c + nn * s * (post / 2 + 0.02) + V((0, 0, 0.18)), 0.022, 5)
        part(bm, iron, name=name + '_bolts', grime=0.4, bisect=False)
    return ob


# ------------------------------------------------------------------ riveted Parker / Pratt through truss v2
def rivet3(bm, p, n, r=0.018, h=0.014):
    n = V(n).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    ring = [bm.verts.new(V(p) + (a * math.cos(2 * math.pi * i / 3) + b * math.sin(2 * math.pi * i / 3)) * r) for i in range(3)]
    tip = bm.verts.new(V(p) + n * h)
    for i in range(3):
        bm.faces.new((ring[i], ring[(i + 1) % 3], tip))


def rivet_row(bm, p0, p1, n, pitch):
    p0, p1 = V(p0), V(p1)
    k = max(1, int((p1 - p0).length / pitch))
    for i in range(k + 1):
        rivet3(bm, p0.lerp(p1, i / k), n)


def gusset_face(bm, c, n, w, h, t=0.014, rivets=None, grid=(3, 3)):
    """Single-sided-visible gusset: clipped plate outline extruded t, rivet grid on its face."""
    n = V(n).normalized()
    rr = V((1, 0, 0))
    u = n.cross(rr).normalized()
    k = 0.14
    ol = [(-w / 2 + k, -h / 2), (w / 2 - k, -h / 2), (w / 2, -h / 2 + k), (w / 2, h / 2 - k), (w / 2 - k, h / 2),
          (-w / 2 + k, h / 2), (-w / 2, h / 2 - k), (-w / 2, -h / 2 + k)]
    f = [bm.verts.new(V(c) + rr * x + u * y + n * t) for x, y in ol]
    g = [bm.verts.new(V(c) + rr * x + u * y) for x, y in ol]
    bm.faces.new(f)
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((f[j], f[i], g[i], g[j]))
    if rivets is not None:
        gx, gy = grid
        for i in range(gx):
            for j in range(gy):
                rivet3(rivets, V(c) + rr * ((i / (gx - 1) - 0.5) * (w - 0.24)) + u * ((j / (gy - 1) - 0.5) * (h - 0.24)) + n * t, n)

def _lace(bm, a, b, off, width, pitch=0.45, bar=0.05):
    """Zig-zag lacing bars (double-sided flat quads) between two parallel channel flanges along a-b,
    offset `off` (Vector, face normal * distance), flanges `width` apart (across = perpendicular in the face plane)."""
    a, b = V(a), V(b)
    ax = (b - a)
    L = ax.length
    ax.normalize()
    nrm = off.normalized()
    ac = nrm.cross(ax).normalized()
    k = max(2, int(L / pitch))
    for i in range(k):
        p = a + ax * (L * i / k) + off - ac * width / 2
        q = a + ax * (L * (i + 1) / k) + off + ac * width / 2
        if i % 2:
            p, q = p + ac * width, q - ac * width
        d = (q - p).normalized()
        sd = nrm.cross(d).normalized() * bar / 2
        for o_, sg in ((V(), 1), (-nrm * 0.004, -1)):
            f = bm.faces.new([bm.verts.new(x + o_) for x in (p - sd, q - sd, q + sd, p + sd)])
            f.normal_update()
            if f.normal.dot(nrm) * sg < 0:
                f.normal_flip()


def truss_span2(x0, x1, z_deck, h_end=5.6, h_mid=None, width=7.4, panels=8, mid='steel_painted', tint=(0.5, 0.56, 0.52),
                name='truss', i_range=None, sign=None, walk=True, detail=True):
    """Riveted Pratt / Parker (h_mid > h_end) through truss: box chords with cover plates, end posts, LACED
    built-up verticals (two channels + zig-zag lacing), doubled eye-bar diagonals + counters, big gusset plates on
    every node with rivet grids, rivet rows along the bottom chord, floor beams, stringers, footway brackets, top
    lateral bracing, portals with knee braces. Members keep full geometry in every LOD (no 'fence' at 0.5x);
    lacing / gussets / rivets are dropped from LOD1."""
    from kit_bridge import ibeam_bm, gusset_bm, rivet_bm, rivet_line
    h_mid = h_mid or h_end
    zb = z_deck - 0.45
    L = x1 - x0
    px = [x0 + L * i / panels for i in range(panels + 1)]
    ht = [h_end + (h_mid - h_end) * math.sin(math.pi * i / panels) for i in range(panels + 1)]
    ia, ib = i_range or (0, panels)
    n0 = len(C.A.parts)
    bm, gs, rv, lc = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    top = lambda i, y: V((px[i], y, zb + ht[i]))
    bot = lambda i, y: V((px[i], y, zb))
    for s in (-1, 1):
        y = s * width / 2
        out = V((0, s, 0))
        for i in range(ia, ib):
            KB.beam_bm(bm, bot(i, y) + V((0.02, 0, 0)), bot(i + 1, y) - V((0.02, 0, 0)), 0.42, 0.52)
            KB.beam_bm(bm, bot(i, y) + V((0, 0, 0.28)), bot(i + 1, y) + V((0, 0, 0.28)), 0.5, 0.04)
            # rivets / lacing only on the south (-Y) faces: the only ones the fixed yaw-0 camera sees
            rivet_row(rv, bot(i, y) + V((0.8, -0.215, 0.12)), bot(i + 1, y) + V((-0.8, -0.215, 0.12)), (0, -1, 0), 0.9)
            if 1 <= i < panels - 1:
                KB.beam_bm(bm, top(i, y), top(i + 1, y), 0.52, 0.5)
                KB.beam_bm(bm, top(i, y) + V((0, 0, 0.27)), top(i + 1, y) + V((0, 0, 0.27)), 0.64, 0.04)
            if i == 0:
                KB.beam_bm(bm, bot(0, y), top(1, y), 0.52, 0.52)
                KB.beam_bm(bm, bot(0, y) + V((0, 0, 0.29)), top(1, y) + V((0, 0, 0.29)), 0.64, 0.04)
            if i == panels - 1:
                KB.beam_bm(bm, bot(panels, y), top(panels - 1, y), 0.52, 0.52)
                KB.beam_bm(bm, bot(panels, y) + V((0, 0, 0.29)), top(panels - 1, y) + V((0, 0, 0.29)), 0.64, 0.04)
            if 1 <= i <= panels - 1:                        # laced vertical: two channels + lacing
                a, b = bot(i, y) + V((0, 0, 0.28)), top(i, y) - V((0, 0, 0.26))
                for dx in (-0.16, 0.16):
                    KB.beam_bm(bm, a + V((dx, 0, 0)), b + V((dx, 0, 0)), 0.3, 0.07, up=(1, 0, 0))
                _lace(lc, a, b, V((0, -0.155, 0)), 0.32, pitch=0.6)
            left = i < panels / 2
            if 1 <= i < panels - 1:
                a, b = (top(i, y), bot(i + 1, y)) if left else (top(i + 1, y), bot(i, y))
                for dy in (-0.13, 0.13):
                    KB.beam_bm(bm, a + V((0, dy, -0.2)), b + V((0, dy, 0.22)), 0.035, 0.26, up=(0, 1, 0))
                if i in (panels // 2 - 1, panels // 2):
                    a2, b2 = (top(i + 1, y), bot(i, y)) if left else (top(i, y), bot(i + 1, y))
                    KB.beam_bm(bm, a2 + V((0, 0, -0.2)), b2 + V((0, 0, 0.2)), 0.05, 0.06)
        nodes = [(bot(i, y), 1.3, 1.05) for i in range(ia, ib + 1)] + \
                [(top(i, y), 1.15, 0.95) for i in range(max(1, ia), min(panels - 1, ib) + 1)]
        for p, gw, gh in nodes:                         # gussets on the camera-side (-Y) face of each truss
            gusset_face(gs, p + V((0, -0.225, 0)), (0, -1, 0), gw, gh, rivets=rv, grid=(3, 2))
    part(bm, mid, name=name + '_members', uv='aligned', tint=tint, grime=0.7, bisect=False, lod='keep')
    part(gs, mid, name=name + '_gussets', uv='aligned', tint=tuple(c * 0.86 for c in tint), grime=0.8, bisect=False, lod='drop')
    if detail:
        part(rv, mid, name=name + '_rivets', tint=tuple(c * 0.8 for c in tint), grime=0.4, bisect=False, lod='drop')
        part(lc, mid, name=name + '_lacing', uv='aligned', tint=tint, grime=0.6, bisect=False, lod='drop')
    else:
        rv.free()
        lc.free()
    return _truss_floor(px, ht, zb, width, ia, ib, panels, mid, tint, name, sign, walk, n0)


def _truss_floor(px, ht, zb, width, ia, ib, panels, mid, tint, name, sign, walk, n0):
    from kit_bridge import ibeam_bm
    top = lambda i, y: V((px[i], y, zb + ht[i]))
    bm = bmesh.new()
    for i in range(ia, ib + 1):
        ibeam_bm(bm, (px[i], -width / 2 - (1.5 if walk else 0.2), zb + 0.05), (px[i], width / 2 + (1.5 if walk else 0.2), zb + 0.05), 0.6, 0.28)
        if walk:
            for s in (-1, 1):
                KB.beam_bm(bm, (px[i], s * (width / 2 + 0.2), zb - 0.5), (px[i], s * (width / 2 + 1.55), zb + 0.2), 0.12, 0.14)
    xa, xb2 = px[ia], px[ib]
    for yy in (-2.2, -0.75, 0.75, 2.2):
        ibeam_bm(bm, (xa, yy, zb + 0.45), (xb2, yy, zb + 0.45), 0.3, 0.16)
    if walk:
        for s in (-1, 1):
            ibeam_bm(bm, (xa, s * (width / 2 + 1.5), zb + 0.2), (xb2, s * (width / 2 + 1.5), zb + 0.2), 0.32, 0.15)
    for i in range(max(1, ia), min(panels - 1, ib) + 1):
        ibeam_bm(bm, top(i, -width / 2) + V((0, 0.26, 0)), top(i, width / 2) - V((0, 0.26, 0)), 0.34, 0.22)
        if i < min(panels - 1, ib):
            for s in (-1, 1):
                KB.beam_bm(bm, top(i, s * width / 2) + V((0, -s * 0.26, 0.05)), top(i + 1, -s * width / 2) + V((0, s * 0.26, 0.05)), 0.14, 0.1)
    for i, e in ((1, 0), (panels - 1, panels)):                       # portals with knee braces + name plate
        if not (ia <= i <= ib):
            continue
        zz = top(i, 0).z - 0.35 - (ht[i]) * 0.2
        xx = px[i] * 0.8 + px[e] * 0.2
        ibeam_bm(bm, (xx, -width / 2 + 0.26, zz - 0.55), (xx, width / 2 - 0.26, zz - 0.55), 0.6, 0.22)
        for s in (-1, 1):
            KB.beam_bm(bm, (xx, s * (width / 2 - 0.26), zz - 1.8), (xx, s * (width / 2 - 1.4), zz - 0.65), 0.12, 0.16)
        if sign:
            K.sign((xx - (0.3 if e == 0 else -0.3), 0, zz - 0.15), (-1 if e == 0 else 1, 0, 0), 1.4, sign, 'steel_painted')
    part(bm, mid, name=name + '_floor', uv='aligned', tint=tuple(c * 0.9 for c in tint), grime=0.8, bisect=False)
    bm = bmesh.new()                                                  # rocker bearings (sole plate, rocker, pin, masonry plate)
    for i in (ia, ib):
        if i not in (0, panels):
            continue
        for s in (-1, 1):
            x, y = px[i], s * width / 2
            C.box_bm(bm, (x, y, zb - 0.95), (1.0, 0.8, 0.08))
            C.box_bm(bm, (x, y, zb - 0.72), (0.45, 0.6, 0.4), 0, (0.55, 1.0))
            KB.cyl_bm(bm, (x, y - 0.38, zb - 0.45), (x, y + 0.38, zb - 0.45), 0.1, 8)
            C.box_bm(bm, (x, y, zb - 0.33), (0.8, 0.62, 0.1))
    if len(bm.verts):
        part(bm, 'cast_iron', name=name + '_bearings', grime=0.6, bisect=False)
    else:
        bm.free()
    return C.A.parts[n0:], {'zb': zb, 'px': px, 'ht': ht}


def erode_arris(parts, off=0.03, jitter=0.014):
    """Weathered / eroded arrises: 1-segment bevel on every block edge + random chipping of the bevel vertices."""
    r = BL.rng()
    for o in parts:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        res = bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=off, offset_type='OFFSET', segments=1,
                              profile=0.5, affect='EDGES', clamp_overlap=True)
        for v in res.get('verts', []):
            v.co += V((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * jitter
        bm.to_mesh(o.data)
        bm.free()
