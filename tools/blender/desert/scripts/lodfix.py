"""Shape-preserving LOD1/LOD2 for the desert kit assets (replaces kit_export.build_lod for level > 0).

Why: the kit LOD joins every part per node and runs ONE collapse decimation on the joined mesh. At ~12 % that
collapses thin wall slabs across their thickness (walls vanish, sliver/fan triangles, holes) and merges vertices
across world-projected UV seams (tan smears on the darj panels, tank -> cone).

Here every part is reduced ON ITS OWN:
 1. drop decals / parts smaller than min_size (as the kit does), plus the least important small parts if needed;
 2. planar dissolve per part, delimited by MATERIAL + UV + SEAM, where edges between vertex-colour bands are marked
    as seams (keeps the damp band / tone at LOD1). Coplanar faces with continuous world UVs merge: this is lossless
    for walls, slabs, parapets (the bulk of an adobe / limewash building);
 3. only 'heavy' parts (curved: domes, drums, jars, rubble, sandbags) are collapse-decimated, per part, with a floor
    of tris per part so a cylinder stays a prism and a dome stays a dome;
 4. join per node + triangulate + door pivots (same contract as the kit)."""
import bpy, bmesh, math
from mathutils import Vector as V
import kit_export as KE

_orig_build_lod = KE.build_lod
STATS = {}


def _tris_me(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def _dissolve(ob, deg, col_thr):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    col = bm.loops.layers.color.active or bm.loops.layers.float_color.active
    if col is not None and col_thr is not None:
        vc = {}
        for f in bm.faces:
            for l in f.loops:
                vc.setdefault(l.vert.index, []).append(V(l[col][:4]))
        avg = {k: sum(v, V((0, 0, 0, 0))) / len(v) for k, v in vc.items()}
        for e in bm.edges:
            a, b = avg.get(e.verts[0].index), avg.get(e.verts[1].index)
            if a is not None and b is not None and max(abs(a[i] - b[i]) for i in range(4)) > col_thr:
                e.seam = True
    orig = []
    if col is not None:
        for f in bm.faces:
            c = sum((V(l[col][:4]) for l in f.loops), V((0, 0, 0, 0))) / len(f.loops)
            orig.append((f.calc_center_median().copy(), f.normal.copy(), f.calc_area(), c))
    nf0 = len(bm.faces)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(deg), verts=bm.verts, edges=bm.edges,
                             delimit={'MATERIAL', 'UV', 'SEAM'})
    for e in bm.edges:
        e.seam = False
    if orig and len(bm.faces) < nf0:
        # merged faces would interpolate the few surviving corner colours over metres (dark gradients):
        # give every merged face the area-weighted mean colour of the original faces it covers
        from mathutils.kdtree import KDTree
        kd = KDTree(len(orig))
        for i, o in enumerate(orig):
            kd.insert(o[0], i)
        kd.balance()
        for f in bm.faces:
            if len(f.verts) <= 4:
                continue
            fc = f.calc_center_median()
            r = max((v.co - fc).length for v in f.verts)
            acc, wsum = V((0, 0, 0, 0)), 0.0
            for co, i, dist in kd.find_range(fc, r):
                c0, n0, a0, col0 = orig[i]
                if n0.dot(f.normal) > 0.9 and abs((c0 - fc).dot(f.normal)) < 0.05:
                    acc += col0 * a0
                    wsum += a0
            if wsum > 0:
                m = acc / wsum
                for l in f.loops:
                    l[col] = m
    bm.to_mesh(ob.data)
    bm.free()


def _decimate(ob, ratio):
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    m.delimit = {'UV', 'MATERIAL', 'SHARP'}
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.remove(m)
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)


def _nbins(ob, frac=0.02):
    """Normal-direction spread (15 deg bins): returns (bins with >= frac of the area, share of the area in the 8
    biggest bins). Planar/boxy parts (walls, slabs, parapets, stairs, shutters) put most area in few bins; curved or
    finely faceted parts (domes, drums, jars, rubble, wire, sandbags) spread it."""
    acc, tot = {}, 0.0
    for p in ob.data.polygons:
        n = p.normal
        az = int((math.degrees(math.atan2(n.y, n.x)) + 367.5) // 15) % 24
        el = int((math.degrees(math.asin(max(-1, min(1, n.z)))) + 97.5) // 15)
        k = (0 if el in (0, 12) else az, el)
        acc[k] = acc.get(k, 0) + p.area
        tot += p.area
    if tot <= 0:
        return 0, 1.0
    vals = sorted(acc.values(), reverse=True)
    return sum(1 for v in vals if v >= frac * tot), sum(vals[:8]) / tot


def _geo(ob):
    """(area, volume if closed else 0, bbox) of a part mesh."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    closed = all(e.is_manifold for e in bm.edges)
    vol = bm.calc_volume(signed=False) if closed else 0.0
    area = sum(f.calc_area() for f in bm.faces)
    xs = [v.co for v in bm.verts]
    bb = [min(v[k] for v in xs) for k in range(3)] + [max(v[k] for v in xs) for k in range(3)] if xs else [0] * 6
    bm.free()
    return area, vol, bb


def _area(ob):
    return sum(p.area for p in ob.data.polygons)


def build_lod_v2(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    if level == 0:
        return _orig_build_lod(level, parts)
    base = sum(_tris_me(o.data) for o in parts)
    goal = (ratio or 1.0) * base
    tol = 1.2 if level == 1 else 1.4
    deg = max(dissolve_deg, 2.0)
    col_thr = 0.05 if level == 1 else 0.14
    floor_t = 24 if level == 1 else 14
    sel = []
    for o in parts:
        node = o.get('kit_node', 'main')
        sz = KE.part_size(o)
        if node == 'decals':
            if level == 1 and sz >= 1.0:
                sel.append((o, sz))
            continue
        # 'drop' = optional interior detail: keep at LOD1, and at LOD2 keep it when it is a cheap flat plane
        if o.get('kit_lod') == 'drop' and level == 2 and _tris_me(o.data) > 12:
            continue
        if sz < min_size and node == 'main' and o.get('kit_lod') not in ('keep', 'drop'):
            continue
        sel.append((o, sz))
    items = []
    for o, sz in sel:
        c = KE._copy(o)
        dec = c.get('kit_node', 'main') == 'decals'
        keep = c.get('kit_lod') == 'keep' and level == 1
        if not dec and not keep:
            _dissolve(c, deg, col_thr)
        t = _tris_me(c.data)
        sheet = any(k in o.name for k in ('roof_galv', 'roof_rust', 'cladding', 'gable_clad', 'sheets', 'hanging_sheet', 'ridge_flash', 'corrug'))
        nb, cov = _nbins(c) if (not dec and t > 40) else (0, 1.0)
        curved = (not dec) and not keep and t > 40 and (sheet or nb > 12 or cov < 0.75)
        if level == 2 and not dec and c.get('kit_lod') != 'keep' and c.get('kit_node', 'main') == 'main' and t > 60 and _area(c) / t < 0.003:
            bpy.data.objects.remove(c)             # wire, ladders, rope, lacing: sub-pixel at the LOD2 zoom
            continue
        items.append([c, sz, t, curved])
    heavy = [it for it in items if it[3]]
    light = sum(it[2] for it in items if not it[3])
    ht = sum(it[2] for it in heavy)
    f = 1.0
    if ht > 0 and light + ht > goal:
        f = max(0.3 if level == 1 else 0.2, min(1.0, (goal - light) / ht))
    for it in heavy:
        fl = max(floor_t, int((20 if level == 1 else 12) * it[1]))      # big curved parts (tanks, domes) keep their shape
        r = max(f, fl / it[2])
        if r < 0.97:
            _decimate(it[0], r)
            it[2] = _tris_me(it[0].data)
    # planar-but-dense parts (lumpy mud walls, lofted copings, parapets): try a per-part collapse and keep it only if
    # the shape survives (area, volume, bbox within tolerance) - otherwise keep the dissolved mesh
    tot = sum(it[2] for it in items)
    if tot > goal * tol:
        for it in sorted([it for it in items if not it[3]], key=lambda it: -it[2]):
            c = it[0]
            if it[2] < (150 if level == 2 else 300) or c.get('kit_node', 'main') == 'decals' or c.get('kit_lod') == 'keep':
                continue
            if tot <= goal * tol:
                break
            g0 = _geo(c)
            old = c.data.copy()
            _decimate(c, max(0.35 if level == 2 else 0.55, min(0.9, goal / max(1, tot))))
            g1 = _geo(c)
            ok = (abs(g1[0] - g0[0]) <= 0.08 * g0[0] and (g0[1] <= 0 or abs(g1[1] - g0[1]) <= 0.06 * abs(g0[1]))
                  and max(abs(g1[2][k] - g0[2][k]) for k in range(6)) < 0.04)
            if ok:
                t_new = _tris_me(c.data)
                tot -= it[2] - t_new
                it[2] = t_new
                bpy.data.meshes.remove(old)
            else:
                bad = c.data
                c.data = old
                bpy.data.meshes.remove(bad)
    # still over budget: drop the smallest non-structural parts (never >= big, never doors / keep)
    big = 2.0 if level == 1 else 4.0
    tot = sum(it[2] for it in items)
    if tot > goal * tol:
        for it in sorted(items, key=lambda it: it[1] / max(1.0, it[2]) ** 0.6):
            if tot <= goal * tol:
                break
            c = it[0]
            if it[1] >= big or c.get('kit_node', 'main') != 'main' or c.get('kit_lod') == 'keep' or it[2] <= 4:
                continue
            tot -= it[2]
            bpy.data.objects.remove(c)
            it[0] = None
        items = [it for it in items if it[0] is not None]
    print('LODTOP', level, [(it[0].name.split('.')[0], it[2], round(it[1], 1), 'C' if it[3] else '') for it in sorted(items, key=lambda it: -it[2])[:14]])
    groups = {}
    for it in items:
        groups.setdefault(it[0].get('kit_node', 'main'), []).append(it[0])
    out = []
    for node, objs in groups.items():
        piv = objs[0].get('kit_pivot')
        ob = KE.join(objs, '%s_lod%d' % (node, level))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(ob.data)
        bm.free()
        if ob.data.validate(verbose=True, clean_customdata=False):
            print('LODFIX validated/fixed', ob.name)
        if piv:
            d = V(piv)
            ob.data.transform(__import__('mathutils').Matrix.Translation(-d))
            ob.location = d
        out.append(ob)
    STATS[level] = dict(base=base, goal=int(goal), out=KE.tris(out), pct=round(100 * KE.tris(out) / max(1, base), 1), f=round(f, 3), heavy=len(heavy), n=len(items))
    print('LODFIX', level, STATS[level])
    return out


def install():
    KE.build_lod = build_lod_v2
