"""Bridges rework round 4 (art director review 3) - overrides on top of brfix/brfix2 (kit NOT edited):
- cutwater v3: coursed ashlar (real course grooves, per-course tone), plinth/starling with a sloped weathering,
  projecting drip course and stepped cap stones; painted waterline: wet foot, ragged algae band, pale tide line,
  damp fade (the old band sat below the starling top and was invisible)
- riprap v3: rounded boulders heaped against the plinth, 25-60 % out of the water, dry grey tops
- AO: soffit barrels get an AO floor (they only receive indirect light; the bake crushed them to black)
- LOD: per-level triangle targets (LOD1 40 %, LOD2 12 %) enforced with an extra collapse pass
- tide band heights parameterised (brfix.TIDE) so the algae band is visible above the starling"""
import math
import bpy, bmesh
from mathutils import Vector as V, noise as N, Matrix
import brlib as BL
from brlib import K, C
import kit_bridge as KB
import kit_weather as W
import kit_export as KE
import brfix as F
import brfix2 as F2

part = F.part2
BAND = {'wet': 0.06, 'algae': 0.92, 'tide': 1.16, 'damp': 2.6}     # heights above the water line


def band_col(p, water, c):
    """Waterline colouring for a vertex at p (world) on masonry: c = base tone (Vector rgb)."""
    h = p.z - water
    rag = 0.13 * N.noise(V((p.x * 1.9, p.y * 1.9, 0.3))) + 0.06 * N.noise(V((p.x * 6.1, p.y * 6.1, 2.1)))
    a_top, t_top = BAND['algae'] + rag, BAND['tide'] + rag * 0.7
    if h < BAND['wet']:
        return F._mul(c, (0.30, 0.33, 0.24))
    if h < a_top:
        k = (h - BAND['wet']) / max(0.05, a_top - BAND['wet'])
        g = F._mul(c, (0.30, 0.40, 0.18)).lerp(F._mul(c, (0.5, 0.6, 0.3)), k ** 1.6)
        return g * (0.9 + 0.2 * (0.5 + 0.5 * N.noise(p * 2.7)))
    if h < t_top:
        return c.lerp(V((0.95, 0.95, 0.88)), 0.55)
    if h < BAND['damp']:
        k = 1 - (h - t_top) / (BAND['damp'] - t_top)
        return F._mul(c, (1 - 0.26 * k, 1 - 0.22 * k, 1 - 0.3 * k))
    return c


def _offset_chain(pts, d, cen, y0):
    """Offset an open plan chain (ends on the pier face line y=y0) outward (away from cen) by d, miter joints."""
    P = [V((x, y, 0)) for x, y in pts]
    segs = []
    for a, b in zip(P, P[1:]):
        t = (b - a).normalized()
        n = V((t.y, -t.x, 0))
        mid = (a + b) / 2
        if n.dot(mid - V((cen[0], cen[1], 0))) < 0:
            n = -n
        segs.append((t, n))
    out = []
    for i, p in enumerate(P):
        if i == 0 or i == len(P) - 1:
            t, n = segs[0] if i == 0 else segs[-1]
            q = p + n * d
            tt = (y0 - q.y) / t.y if abs(t.y) > 1e-6 else 0.0
            q = q + t * tt
        else:
            n1, n2 = segs[i - 1][1], segs[i][1]
            q = p + (n1 + n2) * (d / max(0.2, 1 + n1.dot(n2)))
        out.append((q.x, q.y))
    return out


def _dense(pts, step=0.6):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        k = max(1, int(L / step))
        out += [(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k) for i in range(1, k + 1)]
    return out


def _loft(bm, col, chain, levels, cen, y0, colf):
    """levels: [(z, offset, tone)] rings of the chain -> quads between consecutive rings, coloured by colf."""
    rings = []
    for z, d, tone in levels:
        ch = _offset_chain(chain, d, cen, y0) if abs(d) > 1e-6 else chain
        rings.append(([bm.verts.new((x, y, z)) for x, y in ch], tone))
    for (r0, t0), (r1, t1) in zip(rings, rings[1:]):
        for i in range(len(r0) - 1):
            f = bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
            for l in f.loops:
                cc = colf(l.vert.co, t0 if l.vert in r0 else t1)
                l[col] = (min(1, cc.x), min(1, cc.y), min(1, cc.z), 1.0)
    return rings


def _cap_face(bm, col, ring, colf, tone, apex=None):
    vs = ring[0]
    if apex is None:
        f = bm.faces.new(vs)
        fs = [f]
    else:
        va = bm.verts.new(apex)
        fs = [bm.faces.new((vs[i], vs[i + 1], va)) for i in range(len(vs) - 1)]
    for f in fs:
        for l in f.loops:
            cc = colf(l.vert.co, tone)
            l[col] = (min(1, cc.x), min(1, cc.y), min(1, cc.z), 1.0)


def _offset_closed(pts, d):
    """Miter offset of a closed convex plan polygon (CCW) outward by d."""
    P = [V((x, y, 0)) for x, y in pts]
    n = len(P)
    cen = sum(P, V()) / n
    nor = []
    for i in range(n):
        t = (P[(i + 1) % n] - P[i]).normalized()
        m = V((t.y, -t.x, 0))
        if m.dot((P[i] + P[(i + 1) % n]) / 2 - cen) < 0:
            m = -m
        nor.append(m)
    out = []
    for i in range(n):
        n1, n2 = nor[i - 1], nor[i]
        q = P[i] + (n1 + n2) * (d / max(0.2, 1 + n1.dot(n2)))
        out.append((q.x, q.y))
    return out


def _fix_normals(bm, cen_of):
    for f in bm.faces:
        f.normal_update()
        n = f.normal
        if abs(n.z) > 0.7:
            if n.z < 0:
                f.normal_flip()
        else:
            c = f.calc_center_median()
            cx, cy = cen_of(c)
            if n.x * (c.x - cx) + n.y * (c.y - cy) < 0:
                f.normal_flip()


def cutwater(x, pier_w, width, z_bot, z_top, mid='ashlar', upstream=-1, nose=None, cap_h=None, round_down=True,
             starling=0.32, name='cutwater', course=0.42, tone=1.0):
    """Coursed cutwaters (pointed upstream, rounded downstream) on a plinth, drip course and stepped cap stones.
    COLOR_0 painted here (per-course tone, dark joints, waterline band) - do not re-weather these parts."""
    water = C.A.water if C.A.water is not None else z_bot + 1.0
    nose = nose or pier_w * 0.9
    h = pier_w / 2
    y0, yd = upstream * width / 2, -upstream * width / 2
    r = BL.rng()
    zc0 = water + 0.40
    ncour = max(1, round((z_top - zc0) / course))
    ch = (z_top - zc0) / ncour
    tones = [tone * (0.9 + 0.16 * r.random()) for _ in range(ncour)]
    extra = [water + v for v in (0.62, BAND['algae'] - 0.1, BAND['algae'] + 0.06, BAND['tide'], BAND['tide'] + 0.12, 1.7)]

    def course_levels():
        L = [(zc0 - 0.7, 0.0, tones[0])]
        for k in range(ncour):
            a, b = zc0 + k * ch, zc0 + (k + 1) * ch
            L += [(a + 0.012, 0.0, tones[k]), (b - 0.012, 0.0, tones[k])]
            L += [(z, 0.0, tones[k]) for z in extra if a + 0.05 < z < b - 0.05]
            if k < ncour - 1:
                L += [(b - 0.004, -0.013, 0.5), (b + 0.004, -0.013, 0.5)]
        return sorted(L)

    colf = lambda p, t: band_col(p, water, V((t, t * 0.99, t * 0.965)))
    capf = lambda p, t: V((t, t * 0.985, t * 0.95))
    chains = [(_dense([(x - h, y0), (x, y0 + upstream * nose), (x + h, y0)], 0.55), (x, y0), y0)]
    if round_down:
        n = 10
        semi = [(x + h * math.cos(math.pi * i / n), yd - upstream * h * math.sin(math.pi * i / n)) for i in range(n + 1)]
        chains.append((semi, (x, yd), yd))
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    for ch_, cen, yy in chains:
        _loft(bm, col, ch_, course_levels(), cen, yy, colf)
        # drip course + three stepped cap stones + apex stone
        drip = [(z_top - 0.02, 0.0, 0.95), (z_top - 0.02, 0.085, 1.02), (z_top + 0.17, 0.085, 1.02), (z_top + 0.17, 0.0, 1.0)]
        _loft(bm, col, ch_, drip, cen, yy, capf)
        z = z_top + 0.17
        prev = ch_
        for k, s in enumerate((0.97, 0.66, 0.36)):
            sc = [(cen[0] + (px - cen[0]) * s, cen[1] + (py - cen[1]) * s) for px, py in ch_]
            ring0 = [bm.verts.new((px, py, z)) for px, py in prev]
            ring1 = [bm.verts.new((px, py, z)) for px, py in sc]
            ring2 = [bm.verts.new((px, py, z + 0.2 + 0.04 * k)) for px, py in sc]
            tn = 1.04 - 0.05 * k + 0.05 * r.random()
            for ra, rb in ((ring0, ring1), (ring1, ring2)):
                for i in range(len(ra) - 1):
                    f = bm.faces.new((ra[i], ra[i + 1], rb[i + 1], rb[i]))
                    for l in f.loops:
                        l[col] = (*capf(l.vert.co, tn), 1.0)
            z += 0.2 + 0.04 * k
            prev = sc
            last = ring2
        _cap_face(bm, col, (last, 0), capf, 1.0, apex=(cen[0], cen[1], z + 0.34))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    _fix_normals(bm, lambda c: (x, y0) if (c.y - 0) * upstream > 0 else (x, yd))
    ob = part(bm, mid, name=name, bisect=False, grime=0, jitter=0.0)
    F.apply_col2(ob)
    # plinth / starling: whole pier outline, battered sloping weathering to the pier face
    outl = BL.pier_outline(x, pier_w, width, nose=nose, upstream=upstream, n=10)
    rings = [(_offset_closed(outl, starling), water - 0.8, 0.78), (_offset_closed(outl, starling), water + 0.05, 0.8),
             (_offset_closed(outl, starling), water + 0.22, 0.84), (_offset_closed(outl, 0.01), water + 0.40, 0.88)]
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    RV = [[bm.verts.new((px, py, z)) for px, py in pl] for pl, z, _ in rings]
    for k in range(len(RV) - 1):
        a, b = RV[k], RV[k + 1]
        for i in range(len(a)):
            f = bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i]))
            for l in f.loops:
                t = rings[k][2] if l.vert in a else rings[k + 1][2]
                l[col] = (*colf(l.vert.co, t * (0.95 + 0.1 * r.random())), 1.0)
    _fix_normals(bm, lambda c: (x, 0.0))
    F.apply_col2(part(bm, mid, name=name + '_starling', bisect=False, grime=0, jitter=0.0))


KB.cutwater = cutwater


# ------------------------------------------------------------------ riprap v3: boulders heaped against the plinth
def riprap_ring(outline, water, n=22, smin=0.38, smax=0.8, off=(0.3, 1.1), mid='granite', name='riprap', tint=None,
                out_dir=None, emerge=(0.28, 0.62), **kw):
    """Rounded, lumpy boulders (squash 0.72-0.95) around a plan outline, each standing 28-62 % of its height out of
    the water; dry weathered grey above a thin dark wet line - reads as stones breaking the surface, not discs."""
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
        out = p - c
        out.z = 0
        out = out.normalized() if out.length > 1e-6 else V((1, 0, 0))
        if out_dir is not None:
            out = V(out_dir)
        o = r.uniform(*off)
        s = r.uniform(smin, smax) * (1.15 if o < (off[0] + off[1]) / 2 else 0.85)
        sq = (1, r.uniform(0.75, 0.95), r.uniform(0.72, 0.95))
        hz = s * sq[2]
        top = water + 2 * hz * r.uniform(*emerge) * (1.0 - 0.35 * (o - off[0]) / max(1e-6, off[1] - off[0]))
        q = p + out * (o + s * 0.4) + V((0, 0, top - hz))
        cb = W._blob_bm(q, s, r.random() * 10, sq, 2, 0.24)
        bmesh.ops.rotate(cb, verts=cb.verts, cent=q, matrix=Matrix.Rotation(r.uniform(0, 6.3), 3, 'Z'))
        tmp = bpy.data.meshes.new('rr')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    kill = [f for f in bm.faces if all(v.co.z < water - 0.25 for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    col = bm.loops.layers.color.new('Col2')
    bm.normal_update()
    for f in bm.faces:
        for l in f.loops:
            pp = l.vert.co
            hh = pp.z - water
            k = max(0.0, min(1.0, (hh - 0.03) / 0.12))
            nz = max(0.0, l.vert.normal.z)
            dry = V((0.9, 0.88, 0.82)) * (0.82 + 0.3 * (0.5 + 0.5 * N.noise(pp * 2.3))) * (0.85 + 0.2 * nz)
            wet = V((0.2, 0.23, 0.17))
            cc = wet.lerp(dry, k)
            if 0.03 < hh < 0.3:
                cc = F._mul(cc, (0.8, 0.88, 0.7))
            l[col] = (min(1, cc.x), min(1, cc.y), min(1, cc.z), 1.0)
    ob = part(bm, mid, name=name, grime=0, tint=tint, bisect=False, smooth=True, jitter=0.0)
    return F.apply_col2(ob)


F.riprap_ring = riprap_ring
F2.riprap_ring = riprap_ring


# ------------------------------------------------------------------ AO: floor for soffits (indirect light only)
AO_FLOOR = {'prefixes': ('voussoirs_soffit',), 'floor': 0.58}
_bake2 = KE.bake_ao


def bake_ao(objs, res=1024, samples=96, dist=2.0, out=None):
    out = _bake2(objs, res, samples, dist, out)
    try:
        from PIL import Image, ImageDraw, ImageFilter
        import numpy as np
    except Exception as e:
        C.log('AO floor skipped: %s' % e)
        return out
    im = Image.open(out).convert('L')
    W_, H_ = im.size
    mask = Image.new('L', (W_, H_), 0)
    dr = ImageDraw.Draw(mask)
    nf = 0
    for o in objs:
        if not o.name.startswith(tuple(AO_FLOOR['prefixes'])) or 'AO' not in o.data.uv_layers:
            continue
        uv = o.data.uv_layers['AO'].data
        for p in o.data.polygons:
            pts = [(uv[li].uv[0] * W_, (1 - uv[li].uv[1]) * H_) for li in p.loop_indices]
            dr.polygon(pts, fill=255)
            nf += 1
    mask = mask.filter(ImageFilter.MaxFilter(7))
    a = np.asarray(im).astype(np.float32) / 255
    m = np.asarray(mask) > 0
    fl = AO_FLOOR['floor']
    a[m] = fl + (1 - fl) * a[m]
    Image.fromarray((a * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(out)
    C.log('AO floor %.2f on %d soffit faces' % (fl, nf))
    return out


KE.bake_ao = bake_ao


# ------------------------------------------------------------------ LOD triangle targets
LOD_TARGET = {1: 0.40, 2: 0.115}
MIN_PART_TRIS = 60
RATIO_FLOOR = {1: 0.25, 2: 0.06}     # below this the collapse tears big flat masonry / dam faces (timber/truss beams: 0.01)
_blod2 = KE.build_lod
_T = {}


def _tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def _per_part(level, parts, r, min_size, dissolve_deg, force_keep=False):
    """Decimate a COPY of every part on its own (each keeps ~r of its triangles - the joined collapse starved the big
    finely-tessellated surfaces: rock walls, masonry bodies, snow sheets), then let the kit join them undecimated."""
    cps = []
    for o in parts:
        if o.name not in bpy.data.objects:
            continue
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        node = o.get('kit_node', 'main')
        keep = o.get('kit_lod') == 'keep' and not (force_keep and len(o.data.polygons) > 300)
        nt = sum(len(p_.vertices) - 2 for p_ in c.data.polygons)
        if node != 'decals' and not keep and r < 1 and nt > MIN_PART_TRIS:
            m = c.modifiers.new('pp', 'DECIMATE')
            m.ratio = max(r, MIN_PART_TRIS / nt)     # simple parts (pier prisms, caps) keep their shape
            m.use_collapse_triangulate = True
            m.delimit = LOD_DELIMIT3.get(level, {'MATERIAL'})
            KE._select([c])
            bpy.context.view_layer.objects.active = c
            bpy.ops.object.modifier_apply(modifier='pp')
        cps.append(c)
    objs = _blod2(level, cps, None, min_size, dissolve_deg)
    for c in cps:
        if c.name in bpy.data.objects:
            bpy.data.objects.remove(c)
    return objs


LOD_DELIMIT3 = {1: {'UV', 'MATERIAL'}, 2: {'MATERIAL'}}


def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    """r4: per-part decimation (proportional), ratio lowered until the LOD triangle goal is met (floor RATIO_FLOOR),
    big 'keep' sheets decimated too on retries; if still over, only tiny loose pieces (< 0.9 m) are culled."""
    if level == 0 or not ratio:
        objs = _blod2(level, parts, ratio, min_size, dissolve_deg)
        if level == 0:
            _T[0] = _tris(objs)
        return objs
    tgt = LOD_TARGET.get(level)
    goal = tgt * _T[0] if tgt and _T.get(0) else None
    r_ = ratio
    objs = _per_part(level, parts, r_, min_size, dissolve_deg)
    for it in range(5):
        t = _tris(objs)
        floor = RATIO_FLOOR.get(level, 0.1)
        if goal is None or t <= goal * 1.04 or r_ <= floor * 1.01:
            break
        r2 = max(floor, r_ * max(0.3, min(0.95, goal / t)))
        C.log('LOD%d pass %d: %d tris at ratio %.3f -> %.3f (goal %d)' % (level, it, t, r_, r2, goal))
        for o in objs:
            bpy.data.objects.remove(o)
        r_ = r2
        objs = _per_part(level, parts, r_, min_size, dissolve_deg, force_keep=it >= 1)
    t = _tris(objs)
    if goal and t > goal * 1.08:
        _cull_islands([o for o in objs if not o.name.startswith("decals")], t - goal, max_diag=1.2)
    C.log('LOD%d final %d tris (goal %s) ratio %.3f' % (level, _tris(objs), goal and int(goal), r_))
    return objs


def _key(co):
    return (round(co.x * 2000), round(co.y * 2000), round(co.z * 2000))


def _cull_islands(objs, excess, max_diag=1.2):
    """Delete the smallest loose pieces (pickets, lattice bars, icicles, spalls) until `excess` triangles are gone."""
    cands = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        pos_faces = {}
        for f in bm.faces:
            for v in f.verts:
                pos_faces.setdefault(_key(v.co), []).append(f)
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                isl.append(g.index)
                for v in g.verts:
                    for h in pos_faces[_key(v.co)]:          # welded by position (LOD meshes have split verts)
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            vs = {v.co.copy().freeze() for i in isl for v in bm.faces[i].verts} if len(isl) < 400 else None
            if vs:
                mn = V((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
                mx = V((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
                d = (mx - mn).length
                if d < max_diag:
                    cands.append((d, o.name, isl, sum(len(bm.faces[i].verts) - 2 for i in isl)))
        bm.free()
    cands.sort(key=lambda c: c[0])
    kill, got = {}, 0
    for d, nm, isl, nt in cands:
        if got >= excess:
            break
        kill.setdefault(nm, []).extend(isl)
        got += nt
    for o in objs:
        if o.name in kill:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bm.faces.ensure_lookup_table()
            ks = set(kill[o.name])
            bmesh.ops.delete(bm, geom=[bm.faces[i] for i in ks], context='FACES')
            bm.to_mesh(o.data)
            bm.free()
    C.log('LOD cull: removed %d small islands (%d tris, excess %d)' % (sum(len(v) for v in kill.values()), got, excess))


KE.build_lod = build_lod


F.TIDE_FN = band_col
F.DENSE_CUTS = (-0.25, 0.06, 0.4, 0.8, 0.98, 1.16, 1.3, 1.8, 2.6)


# ------------------------------------------------------------------ demolition v3: supported edge blocks, slumped talus
def ragged_edge(poly, width, mid='ashlar', body='fieldstone', n_per_m=1.7, hang=0, xc=None, z_ring=None, name='breach_blocks'):
    """Loose blocks on the tear, kept only where they are bedded in / resting on masonry: centre within 0.3 m of a
    solid surface AND a solid surface within 0.7 m below (no blocks in the air above the deck or in the arch opening)."""
    bvh = F2._solid_bvh()
    r = BL.rng()
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    segs = [(V((poly[i - 1][0], 0, poly[i - 1][1])), V((poly[i][0], 0, poly[i][1]))) for i in range(len(poly))]
    kept = drop = 0
    for a, b in segs:
        L = (b - a).length
        m = max(1, int(L * n_per_m))
        for k in range(m):
            p = a.lerp(b, (k + r.random()) / m)
            for yy in (-width / 2 + 0.25, width / 2 - 0.25, r.uniform(-width / 3, width / 3)):
                if r.random() < 0.3:
                    continue
                sz = V((r.uniform(0.32, 0.7), r.uniform(0.3, 0.55), r.uniform(0.22, 0.38)))
                c = V((p.x, yy + (0.02 if yy > 0 else -0.02), p.z + r.uniform(-0.1, 0.05)))
                near = bvh.find_nearest(c)
                down = bvh.ray_cast(c + V((0, 0, 0.05)), V((0, 0, -1)), 0.7 + sz.z)
                if near[0] is None or near[3] > 0.3 or down[0] is None:
                    drop += 1
                    continue
                kept += 1
                rot = Euler((r.uniform(-0.3, 0.3), r.uniform(-0.4, 0.4), r.uniform(-0.3, 0.3))).to_matrix()
                F2._block(bm, col, c, rot, sz / 2, 0.62 + 0.3 * r.random())
    C.log('ragged_edge kept %d dropped %d (unsupported)' % (kept, drop))
    if not bm.faces:
        return None
    return F.apply_col2(part(bm, mid, name=name, grime=0, bisect=False, jitter=0.0))


from mathutils import Euler


def debris_pile(xc, yc, rx, ry, z_base, z_top, mids=('ashlar', 'fieldstone'), n=60, name='debris', tint=None,
                slabs=2, slab_mid=None, water=None, fan=1.7, steel=0, setts=0, fill_mid='scree_grey', flow=1,
                lobes=None, bonded=4, mound=True):
    """Demolition talus v3: NOT a dome. A low, lumpy fill (ridged fbm, several slump lobes - heaped against the
    stumps / piers at `lobes` and a long tongue carried downstream) whose crest barely breaks the water, covered by a
    jumble of blocks resting on it (big spandrel lumps, bonded chunks of arch ring, wedges, spalls, setts), with
    blocks and slabs scattered into the current; optional torn steel sections lying on the heap."""
    r = BL.rng()
    water = C.A.water if water is None else water
    lobes = lobes or [(xc - rx * 0.55, yc - ry * 0.1, 0.9), (xc + rx * 0.5, yc + ry * 0.05, 0.75)]
    H = z_top - z_base

    def hgt(x, y):
        v = -1e9
        for lx, ly, lh in lobes:
            dy = (y - ly) / (ry * (fan if (y - ly) * flow > 0 else 0.8))
            d = math.sqrt(((x - lx) / (rx * 0.9)) ** 2 + dy ** 2)
            v = max(v, lh * max(0.0, 1 - d) ** 0.9)
        ty = (y - yc) * flow / (ry * fan * 1.6)                  # downstream tongue
        if 0 < ty < 1:
            v = max(v, (water + 0.08 - z_base) / H * (1 - ty) ** 0.7 * max(0.0, 1 - abs(x - xc) / (rx * (0.8 + 0.5 * ty))))
        rid = 1 - abs(N.noise(V((x * 0.7, y * 0.7, 1.9))))
        v *= 0.75 + 0.35 * rid + 0.12 * N.noise(V((x * 2.1, y * 2.1, 4.4)))
        return z_base + H * v

    Rx, Ry = rx * 1.3, ry * max(1.0, fan) * 1.5
    m_ = 26
    bm = bmesh.new()
    colm = bm.loops.layers.color.new('Col2')
    g = [[bm.verts.new((xc - Rx + 2 * Rx * i / m_, yc - Ry * 0.6 + 1.6 * Ry * j / m_, 0)) for j in range(m_ + 1)] for i in range(m_ + 1)]
    for row in g:
        for v in row:
            v.co.z = hgt(v.co.x, v.co.y)
    for i in range(m_):
        for j in range(m_):
            q = (g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])
            if all(v.co.z <= water - 0.35 for v in q):
                continue
            f = bm.faces.new(q)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for f in bm.faces:
        for l in f.loops:
            p = l.vert.co
            t = (0.4 + 0.12 * N.noise(p * 1.4)) * (0.45 if p.z < water + 0.06 else (0.72 if p.z < water + 0.25 else 1.0))
            l[colm] = (t, t * 0.95, t * 0.87, 1.0)
    if mound:
        F.apply_col2(part(bm, fill_mid, name=name + '_mound', grime=0, bisect=False, jitter=0.0, smooth=False, lod='keep'))
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')

    def rest(x, y, half):
        return max(hgt(x, y), water - 0.2) - half.z * r.uniform(0.25, 0.6)

    def place(x, y, half, rot, tone, taper=1.0):
        """Blocks on the heap rest on it; blocks off the heap (deep water) are mostly skipped, the rest sunk and
        tipped so only an edge / corner breaks the surface (no plates floating flat on the water)."""
        hh = hgt(x, y)
        if hh < water - 0.1:
            if r.random() < 0.8:
                return
            rot = Euler((r.uniform(0.6, 1.1) * r.choice((-1, 1)), r.uniform(-0.8, 0.8), r.uniform(0, 3.14))).to_matrix()
            z = water - half.z * 0.2
        else:
            z = hh - half.z * r.uniform(0.2, 0.55)
        F2._block(bm, col, V((x, y, z)), rot, half, tone, taper=taper, wet_z=water)

    for i in range(n):
        lx, ly, lh = lobes[i % len(lobes)] if r.random() < 0.7 else (xc, yc + ry * fan * 0.8 * flow, 0.4)
        a, d = r.uniform(0, 2 * math.pi), r.random() ** 0.8
        x, y = lx + math.cos(a) * rx * 0.85 * d, ly + math.sin(a) * ry * d * (fan if math.sin(a) * flow > 0 else 0.45)
        u = r.random()
        if u < 0.14:
            half = V((r.uniform(0.6, 1.0), r.uniform(0.4, 0.7), r.uniform(0.3, 0.5)))       # spandrel lumps
        elif u < 0.5:
            half = V((r.uniform(0.25, 0.45), r.uniform(0.16, 0.28), r.uniform(0.14, 0.22)))
        else:
            half = V((r.uniform(0.09, 0.2), r.uniform(0.07, 0.15), r.uniform(0.06, 0.12)))
        rot = Euler((r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(0, 3.14))).to_matrix()
        tap = r.uniform(0.6, 0.9) if r.random() < 0.3 else 1.0
        place(x, y, half, rot, (0.55 + 0.35 * r.random()) * (tint[0] if tint else 1.0), tap)
    for i in range(bonded):                                   # bonded chunks of arch ring: 3-5 wedges on a curve
        lx, ly, lh = lobes[i % len(lobes)]
        x0, y0 = lx + r.uniform(-rx * 0.4, rx * 0.4), ly + r.uniform(-ry * 0.5, ry * 0.5)
        yaw, rad = r.uniform(0, 6.28), r.uniform(3.0, 6.0)
        tilt = r.uniform(-0.5, 0.5)
        k = r.randint(3, 5)
        for j in range(k):
            ang = (j - k / 2) * 0.36 / rad * 2.2
            loc = V((math.sin(ang) * rad, 0, rad * (math.cos(ang) - 1)))
            M = Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(tilt, 3, 'X')
            p = V((x0, y0, 0)) + M @ loc
            half = V((0.17, 0.5, 0.3))
            if hgt(p.x, p.y) < water - 0.1:
                continue
            p.z = rest(p.x, p.y, half) + 0.08
            F2._block(bm, col, p, M @ Matrix.Rotation(-ang, 3, 'Y'), half, 0.7 + 0.2 * r.random(), taper=0.8, wet_z=water)
    for i in range(setts):
        a, d = r.uniform(0, 2 * math.pi), math.sqrt(r.random()) * 0.8
        x, y = xc + math.cos(a) * rx * d, yc + math.sin(a) * ry * d
        F2._block(bm, col, V((x, y, max(hgt(x, y), water - 0.1) + 0.03)), Euler((r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(0, 3))).to_matrix(),
                  V((0.09, 0.07, 0.07)), 0.35 + 0.2 * r.random(), wet_z=water, tint=(1.0, 1.0, 1.02))
    for i in range(slabs):
        s = -1 if i % 2 == 0 else 1
        lx, ly, lh = lobes[i % len(lobes)]
        x, y = lx + r.uniform(-rx * 0.3, rx * 0.3), ly + s * ry * 0.35
        half = V((r.uniform(1.1, 1.6), 0.22, 0.45))
        place(x, y, half, Euler((s * r.uniform(0.3, 0.6), r.uniform(-0.25, 0.25), r.uniform(-0.4, 0.4))).to_matrix(), 0.75)
    F.apply_col2(part(bm, mids[0], name=name + '_blocks', grime=0, bisect=False, jitter=0.0))
    if steel:
        bm = bmesh.new()
        for i in range(steel):
            lx, ly, lh = lobes[i % len(lobes)]
            x, y = lx + r.uniform(-rx * 0.5, rx * 0.5), ly + r.uniform(-ry * 0.6, ry * 0.6)
            L, ang = r.uniform(1.5, 3.5), r.uniform(0, 3.14)
            p0 = V((x, y, max(hgt(x, y), water - 0.3) + 0.05))
            x1, y1 = x + math.cos(ang) * L, y + math.sin(ang) * L
            p1 = V((x1, y1, max(hgt(x1, y1), water - 0.3) + r.uniform(0.0, 0.8)))
            if r.random() < 0.65:
                KB.ibeam_bm(bm, p0, p1, r.uniform(0.25, 0.4), r.uniform(0.14, 0.2))
            else:
                KB.beam_bm(bm, p0, p1, r.uniform(0.6, 1.2), 0.02, up=(r.uniform(-1, 1), r.uniform(-1, 1), 1))
        part(bm, 'steel_painted', name=name + '_steel', grime=1.0, bisect=False, tint=(0.42, 0.4, 0.37), mat_tint=(0.48, 0.46, 0.42))


F.debris_pile = debris_pile
F2.debris_pile = debris_pile
F2.ragged_edge = ragged_edge


# ------------------------------------------------------------------ ice v3: thick rounded collars, grey-blue, tapered lips
def ice_shelf(outline, water, reach=(0.5, 1.8), thick=0.26, name='ice', floes=0, bounds=None, seed=1, m=44):
    """Shore-fast ice collar: a rounded, lumpy rim (4 rings: against the wall at +0.9 thick, crest, shoulder, lip
    sunk to the water) with a smooth noisy outline - no vertical white edges. Colour: grey-blue ice, darker and
    wetter toward the lip, snow dusting only in patches near the wall. Floes: domed plates tapering into the water."""
    r = BL.rng()
    bm = bmesh.new()
    col = bm.loops.layers.color.new('Col2')
    per = [V((*p, 0)) for p in outline]
    c = sum(per, V()) / len(per)
    L = len(per)
    rings = [[], [], [], []]
    for i in range(m):
        t = i / m * L
        a, b = per[int(t) % L], per[(int(t) + 1) % L]
        p = a.lerp(b, t - int(t))
        d = p - c
        d.z = 0
        d.normalize()
        k = 0.5 + 0.5 * N.noise(p * 0.55 + V((seed, 0, 0)))
        rr = reach[0] + (reach[1] - reach[0]) * k
        z0 = water + 0.02
        rings[0].append(p - d * 0.04 + V((0, 0, z0 + thick * 0.9)))
        rings[1].append(p + d * rr * 0.3 + V((0, 0, z0 + thick * (0.75 + 0.3 * N.noise(p * 2.1)))))
        rings[2].append(p + d * rr * 0.72 + V((0, 0, z0 + thick * 0.45)))
        rings[3].append(p + d * rr * (0.95 + 0.1 * N.noise(p * 3.0)) + V((0, 0, water - 0.03)))
    RV = [[bm.verts.new(q) for q in ring] for ring in rings]
    for k in range(3):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((RV[k][i], RV[k][j], RV[k + 1][j], RV[k + 1][i]))
    for k in range(floes):
        if bounds:
            fx, fy = r.uniform(bounds[0], bounds[2]), r.uniform(bounds[1], bounds[3])
        else:
            a = r.uniform(0, 6.28)
            fx, fy = c.x + math.cos(a) * r.uniform(3, 7), c.y + math.sin(a) * r.uniform(3, 7)
        sz = r.uniform(*F.FLOE)
        nv = r.randint(8, 11)
        rim = [V((fx + math.cos(2 * math.pi * i / nv + r.uniform(-0.2, 0.2)) * sz * r.uniform(0.7, 1.1),
                  fy + math.sin(2 * math.pi * i / nv + r.uniform(-0.2, 0.2)) * sz * r.uniform(0.55, 0.95), water - 0.02)) for i in range(nv)]
        cen = sum(rim, V()) / nv
        mid = [bm.verts.new(cen.lerp(q, 0.7) + V((0, 0, thick * 0.55))) for q in rim]
        lo = [bm.verts.new(q) for q in rim]
        top = bm.verts.new(cen + V((0, 0, thick * 0.75)))
        for i in range(nv):
            j = (i + 1) % nv
            bm.faces.new((lo[i], lo[j], mid[j], mid[i]))
            bm.faces.new((mid[i], mid[j], top))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    bm.normal_update()
    for f in bm.faces:
        for l in f.loops:
            q = l.vert.co
            h = max(0.0, min(1.0, (q.z - water) / max(0.05, thick)))
            ice = V((0.3, 0.39, 0.45)).lerp(V((0.5, 0.6, 0.66)), h) * (0.9 + 0.12 * N.noise(q * 1.7))
            sn = max(0.0, min(1.0, -0.6 + 1.8 * N.noise(q * 0.8 + V((2, 3, 4))))) * h
            cc = ice.lerp(V((0.82, 0.85, 0.9)), 0.65 * sn)
            l[col] = (min(1, cc.x), min(1, cc.y), min(1, cc.z), 1.0)
    return F.apply_col2(part(bm, 'snow', name=name, uv='aligned', grime=0, bisect=False, jitter=0.0, smooth=True))


F.ice_shelf = ice_shelf
F2.ice_col = lambda ob, *a, **k: ob


# ------------------------------------------------------------------ lamp standard v2: painted, bigger lantern, scrolls
LAMP_SNOW = [False]


def lamp_post(p, h=4.2, name='lamp', arm=False, snow=None):
    """Cast-iron lamp standard, painted dark green-grey (not a black stick): stepped plinth, fluted-look shaft with
    three collars, ladder bar with ball ends, four scroll brackets under a larger lantern, pagoda cap + finial;
    with snow=True snow cones on the cap, collars and plinth."""
    cyl = KB.cyl_bm if hasattr(KB, 'cyl_bm') else C.cyl_bm
    snow = LAMP_SNOW[0] if snow is None else snow
    p = V(p)
    bm = bmesh.new()
    cyl(bm, p, p + V((0, 0, 0.16)), 0.27, 8, r1=0.25)
    cyl(bm, p + V((0, 0, 0.16)), p + V((0, 0, 0.62)), 0.21, 8, r1=0.15)
    cyl(bm, p + V((0, 0, 0.62)), p + V((0, 0, 0.74)), 0.19, 8, r1=0.12)
    cyl(bm, p + V((0, 0, 0.74)), p + V((0, 0, h - 0.6)), 0.1, 8, r1=0.065)
    for zc in (1.1, 2.2, h - 0.95):
        cyl(bm, p + V((0, 0, zc)), p + V((0, 0, zc + 0.09)), 0.115, 8, r1=0.1)
    cyl(bm, p + V((-0.38, 0, h - 0.8)), p + V((0.38, 0, h - 0.8)), 0.022, 6)
    for sx in (-1, 1):
        C.box_bm(bm, p + V((sx * 0.4, 0, h - 0.8)), (0.07, 0.07, 0.07))
    top = p + V((0, 0, h - 0.6))
    cyl(bm, top, top + V((0, 0, 0.1)), 0.12, 8, r1=0.2)
    lz = top + V((0, 0, 0.1))
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        d0 = V((math.cos(ang), math.sin(ang), 0))
        cyl(bm, top - V((0, 0, 0.25)) + d0 * 0.06, lz + d0 * 0.24, 0.018, 4)          # scroll brackets
        cyl(bm, lz + d0 * 0.2, lz + d0 * 0.3 + V((0, 0, 0.62)), 0.016, 4)              # lantern corner bars
    cyl(bm, lz + V((0, 0, 0.62)), lz + V((0, 0, 0.7)), 0.34, 4, r1=0.36)
    cyl(bm, lz + V((0, 0, 0.7)), lz + V((0, 0, 0.92)), 0.36, 4, r1=0.05)
    cyl(bm, lz + V((0, 0, 0.92)), lz + V((0, 0, 1.08)), 0.03, 6, r1=0.006)
    part(bm, 'steel_painted', name=name, smooth=False, grime=0.35, mat_tint=(0.4, 0.48, 0.43))
    bm = bmesh.new()
    cyl(bm, lz + V((0, 0, 0.01)), lz + V((0, 0, 0.62)), 0.24, 4, r1=0.32, caps=False)
    part(bm, 'glass_dirty', name=name + '_glass', grime=0, bisect=False)
    if snow:
        bm = bmesh.new()
        cyl(bm, lz + V((0, 0, 0.72)), lz + V((0, 0, 0.9)), 0.36, 8, r1=0.1)
        cyl(bm, p + V((0, 0, 0.72)), p + V((0, 0, 0.8)), 0.16, 8, r1=0.1)
        cyl(bm, p + V((0, 0, 0.14)), p + V((0, 0, 0.2)), 0.27, 8, r1=0.22)
        part(bm, 'snow', name='snow_lamp_' + name, grime=0, bisect=False, smooth=True)
    C.anchor('light', tuple(lz + V((0, 0, 0.35))), kind='lamp', radius=9.0)


KB.lamp_post = lamp_post
