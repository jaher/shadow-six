"""Europe rework: robust battle damage. Replaces kit bite()/roof_holes()/rubble() for the europe group.
- carve(boxes): subtract a union of oriented boxes (stepped, course-aligned = masonry breaking along its joints).
  Closed parts -> EXACT boolean with a marker material; every cutter face that is NOT inside the original solid is
  deleted afterwards (kills the 'left-behind cutter blob' failure). Open / thin parts (glass, cards, decals, planes)
  -> faces whose centre falls inside the cut are deleted (never boolean).
- blast(): stepped jagged hole boxes + loose stones / hanging bricks / broken studs at the break edges.
- ragged_top(): stepped, broken wall tops for roofless shells.
- roof_breach(): stepped hole along slate courses + splintered / charred / fallen rafters, broken battens, hanging slates.
- heap(): rubble heap of stones, bricks, tile shards, beams and planks on a low irregular debris bed."""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree
import kit as K
import kit_core as C

MARK = 'EU_CUTMARK'
THIN = ('glass_dirty', 'interior_dark', 'curtain', 'decals', 'signs')
STATS = {'boolean': 0, 'facedel': 0, 'removed': 0, 'remnant_faces_deleted': 0}


class Box:
    def __init__(s, c, ax, ay, az, h):
        s.c, s.a, s.h = V(c), (V(ax).normalized(), V(ay).normalized(), V(az).normalized()), tuple(h)

    def inside(s, p, pad=0.0):
        d = V(p) - s.c
        return all(abs(d.dot(s.a[i])) <= s.h[i] + pad for i in range(3))

    def corners(s):
        a, h = s.a, s.h
        out = []
        for z in (-1, 1):
            for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                out.append(s.c + a[0] * x * h[0] + a[1] * y * h[1] + a[2] * z * h[2])
        return out


def _box_bm(bm, b):
    v = [bm.verts.new(p) for p in b.corners()]
    fs = [bm.faces.new([v[i] for i in f]) for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))]
    bmesh.ops.recalc_face_normals(bm, faces=fs)            # outward whatever the handedness of the box frame


def _mark_mat():
    m = bpy.data.materials.get(MARK) or bpy.data.materials.new(MARK)
    return m


def _aabb(pts):
    return V([min(p[i] for p in pts) for i in range(3)]), V([max(p[i] for p in pts) for i in range(3)])


def _closed(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    ok = len(bm.edges) > 0 and all(len(e.link_faces) == 2 for e in bm.edges)
    bm.free()
    return ok


def _kid(o):
    return o.data.materials[0].get('kit_id', '') if o.data.materials and o.data.materials[0] else ''


def _inside_any(boxes, p, pad=0.0):
    return any(b.inside(p, pad) for b in boxes)


def _triplanar(bm, faces, mid, col_mul=(0.8, 0.76, 0.7)):
    uv = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    col = bm.loops.layers.color.get('Col')
    t = C.tile_of(mid)
    for f in faces:
        n = f.normal
        k = max(range(3), key=lambda i: abs(n[i]))
        i, j = [(1, 2), (0, 2), (0, 1)][k]
        for l in f.loops:
            p = l.vert.co
            l[uv].uv = (p[i] / t + 0.37, p[j] / t + 0.61)
            if col is not None:
                g = 0.85 + 0.3 * C._noise(p, 3.0)
                l[col] = (col_mul[0] * g, col_mul[1] * g, col_mul[2] * g, 1.0)


def carve(boxes, parts=None, only=None, skip=None, min_island=0.1, cut_col=(0.8, 0.76, 0.7)):
    """Subtract the union of `boxes` from every part it touches. only/skip: predicates on the object.
    Closed parts get one EXACT difference PER BOX (a single union cutter with coplanar seams between boxes left whole
    regions uncut - review 1 bombed-house gable); open / thin parts get face deletion."""
    if not boxes:
        return
    pts = [p for b in boxes for p in b.corners()]
    bmn, bmx = _aabb(pts)
    cobs = []
    for b in boxes:
        cbm = bmesh.new()
        _box_bm(cbm, b)
        cme = bpy.data.meshes.new('eu_cut')
        cbm.to_mesh(cme)
        cbm.free()
        cme.materials.append(_mark_mat())
        cob = bpy.data.objects.new('eu_cut', cme)
        bpy.context.scene.collection.objects.link(cob)
        cobs.append((cob,) + _aabb(b.corners()))
    for o in list(parts or C.A.parts):
        if o.name not in bpy.data.objects or (only and not only(o)) or (skip and skip(o)):
            continue
        if o.get('kit_pivot'):                 # doors / wheels: keep whole (pivoted nodes)
            continue
        mw = o.matrix_world
        vs = [mw @ v.co for v in o.data.vertices]
        if not vs:
            continue
        mn, mx = _aabb(vs)
        if any(mx[i] < bmn[i] or mn[i] > bmx[i] for i in range(3)):
            continue
        if all(_inside_any(boxes, p, 0.01) for p in vs):
            C.A.parts.remove(o); bpy.data.objects.remove(o); STATS['removed'] += 1
            continue
        kid = _kid(o)
        if kid in THIN or o.get('kit_node') == 'decals' or not _closed(o.data):
            bm = bmesh.new(); bm.from_mesh(o.data)
            kill = [f for f in bm.faces if _inside_any(boxes, mw @ f.calc_center_median(), 0.0)]
            if kill:
                bmesh.ops.delete(bm, geom=kill, context='FACES'); STATS['facedel'] += 1
            empty = len(bm.faces) == 0
            bm.to_mesh(o.data); bm.free()
            if empty:
                C.A.parts.remove(o); bpy.data.objects.remove(o)
            continue
        for cob, cmn, cmx in cobs:
            if any(mx[i] < cmn[i] or mn[i] > cmx[i] for i in range(3)):
                continue
            if not o.data.polygons:
                break
            _boolean(o, cob, kid, min_island, cut_col)
        if not o.data.polygons:
            C.A.parts.remove(o); bpy.data.objects.remove(o)
    for cob, _, _ in cobs:
        me = cob.data
        bpy.data.objects.remove(cob)
        bpy.data.meshes.remove(me)


def _boolean(o, cob, kid, min_island, cut_col):
    fix = bmesh.new(); fix.from_mesh(o.data)             # closed target with inverted winding (some beam parts) -> make
    bmesh.ops.recalc_face_normals(fix, faces=fix.faces)  # outward, else EXACT treats it inside-out (difference -> union)
    fix.to_mesh(o.data); fix.free()
    ob = bmesh.new(); ob.from_mesh(o.data)
    ob.transform(o.matrix_world)
    tree = BVHTree.FromBMesh(ob)
    ob.free()
    m = o.modifiers.new('eucut', 'BOOLEAN')
    m.operation, m.solver, m.object = 'DIFFERENCE', 'EXACT', cob
    m.use_self, m.use_hole_tolerant = True, True
    try:
        m.material_mode = 'TRANSFER'
    except Exception:
        pass
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='eucut')
    STATS['boolean'] += 1
    mats = [mm.name if mm else '' for mm in o.data.materials]
    bm = bmesh.new(); bm.from_mesh(o.data)
    mi = mats.index(MARK) if MARK in mats else -1
    mw = o.matrix_world
    newf = [f for f in bm.faces if f.material_index == mi] if mi >= 0 else []
    kill, keep = [], []
    for f in newf:
        c = mw @ f.calc_center_median()
        loc, nor, idx, dist = tree.find_nearest(c)
        if loc is None or (c - loc).dot(nor) > 0.004:
            kill.append(f)
        else:
            keep.append(f)
    if kill:
        STATS['remnant_faces_deleted'] += len(kill)
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    keep = [f for f in keep if f.is_valid]
    for f in keep:
        f.material_index = 0
    bm.normal_update()
    _triplanar(bm, keep, kid.split('~')[0] or 'fieldstone', cut_col)
    # drop tiny loose slivers left floating by the cut
    seen, isl = set(), []
    for f in bm.faces:
        if f in seen:
            continue
        stack, grp = [f], []
        seen.add(f)
        while stack:
            g = stack.pop(); grp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h); stack.append(h)
        isl.append(grp)
    if len(isl) > 1:
        small = []
        for grp in isl:
            ps = [v.co for g in grp for v in g.verts]
            mn, mx = _aabb(ps)
            if max(mx - mn) < min_island:
                small += grp
        if small:
            bmesh.ops.delete(bm, geom=small, context='FACES')
    bm.to_mesh(o.data); bm.free()
    if mi >= 0:
        o.data.materials.pop(index=mi)


# ------------------------------------------------------------------ shape generators
def _frame(rot):
    return V((math.cos(rot), math.sin(rot), 0)), V((-math.sin(rot), math.cos(rot), 0)), V((0, 0, 1))


def blast_boxes(c, r, rot=0.0, squash=(1, 1, 1), course=0.3, jag=0.35, seed=1, notches=6):
    """Stepped hole: one box per masonry course, chord of an ellipsoid with jittered left/right/front/back ends.
    Returns (boxes, edges) - edges = [(point, side_dir, z_row_bottom)] step corners for debris."""
    rr = __import__('random').Random(seed)
    c = V(c)
    ax, ay, az = _frame(rot)
    sx, sy, sz = r * squash[0], r * squash[1], r * squash[2]
    boxes, edges = [], []
    z = c.z - sz
    while z < c.z + sz:
        h = course * rr.uniform(0.75, 1.3)
        zm = z + h / 2
        t = (zm - c.z) / sz
        if abs(t) < 1:
            ch = math.sqrt(1 - t * t) ** 0.8
            l, rt = sx * ch * rr.uniform(1 - jag, 1 + jag * 0.5), sx * ch * rr.uniform(1 - jag, 1 + jag * 0.5)
            f, b = sy * ch * rr.uniform(1 - jag, 1 + jag * 0.5), sy * ch * rr.uniform(1 - jag, 1 + jag * 0.5)
            if l + rt > 0.25:
                cc = c + ax * (rt - l) / 2 + ay * (b - f) / 2 + V((0, 0, zm - c.z))
                boxes.append(Box(cc, ax, ay, az, ((l + rt) / 2, (f + b) / 2, h / 2 + 0.015)))
                for sgn, d in ((-1, l), (1, rt)):
                    edges.append((c + ax * sgn * d + V((0, 0, z - c.z)), ax * sgn, z))
        z += h
    for i in range(notches):                             # brick-sized bites off the rim (less regular outline)
        if not boxes:
            break
        bx = boxes[rr.randrange(len(boxes))]
        sgn = rr.choice((-1, 1))
        p = bx.c + ax * sgn * bx.h[0] + V((0, 0, rr.uniform(-1, 1) * bx.h[2]))
        boxes.append(Box(p, ax, ay, az, (rr.uniform(0.12, 0.3), bx.h[1], rr.uniform(0.08, 0.16))))
    return boxes, edges


def ragged_boxes(a, b, z_hi, z_lo, z_top=None, thick=1.6, seed=1, seg=(0.35, 1.3), keep_ends=0.0, step=0.9):
    """Broken wall top along wall a->b (2D): stepped random walk of break heights between z_lo..z_hi; everything above is
    cut away (boxes reach z_top). keep_ends: length at each end kept a bit higher (corners survive)."""
    rr = __import__('random').Random(seed)
    a, b = V((a[0], a[1], 0)), V((b[0], b[1], 0))
    L = (b - a).length
    d = (b - a).normalized()
    n = V((d.y, -d.x, 0))
    z_top = z_top or z_hi + 12
    boxes, tops = [], []
    t, z = -0.3, rr.uniform(z_lo, z_hi)
    while t < L + 0.3:
        w = rr.uniform(*seg)
        z = min(z_hi, max(z_lo, z + rr.uniform(-1, 1) * step))
        zz = z + (0.8 if (t < keep_ends or t > L - keep_ends) else 0.0)
        cc = a + d * (t + w / 2) + V((0, 0, (zz + z_top) / 2))
        boxes.append(Box(cc, d, n, (0, 0, 1), (w / 2 + 0.01, thick / 2, (z_top - zz) / 2)))
        tops.append((a + d * (t + w / 2) + V((0, 0, zz)), w, zz))
        t += w
    return boxes, tops


def roof_boxes(R, lx, ly, rad, course=0.32, jag=0.4, seed=1, depth=0.9):
    """Stepped roof hole on roof R at roof-local (lx, ly): rows follow the slate courses (along the ridge)."""
    rr = __import__('random').Random(seed)
    s = 1 if ly >= 0 else -1
    p = math.radians(R.pitch)
    up = (R.ay * (-s) * math.cos(p) + V((0, 0, math.sin(p)))).normalized()     # up-slope
    nrm = R.ax.cross(up).normalized()
    if nrm.z < 0:
        nrm = -nrm
    t = math.tan(p)
    zs = lambda y: R.z_eave + (R.W / 2 - abs(y)) * t + R.lift
    c = R.w(lx, ly, zs(ly))
    boxes, rows = [], []
    v = -rad
    while v < rad:
        h = course * rr.uniform(0.8, 1.25)
        tv = (v + h / 2) / rad
        ch = math.sqrt(max(0.0, 1 - tv * tv)) ** 0.7
        l, r2 = rad * 1.25 * ch * rr.uniform(1 - jag, 1 + jag * 0.4), rad * 1.25 * ch * rr.uniform(1 - jag, 1 + jag * 0.4)
        if l + r2 > 0.3:
            cc = c + up * (v + h / 2) + R.ax * (r2 - l) / 2
            boxes.append(Box(cc, R.ax, up, nrm, ((l + r2) / 2, h / 2 + 0.01, depth / 2)))
            rows.append((v, h, -l, r2))
            for sgn, e in ((-1, -l), (1, r2)):               # single missing slates / tiles around the rim
                for k in range(rr.choice((0, 1, 1, 2))):
                    sw = rr.uniform(0.2, 0.34)
                    pc = c + up * (v + h * rr.choice((0.25, 0.75))) + R.ax * (e + sgn * (sw / 2 + rr.uniform(0.0, 0.35) * k))
                    boxes.append(Box(pc, R.ax, up, nrm, (sw / 2, h * 0.3, depth / 2)))
        v += h
    return boxes, rows, (c, up, nrm)


# ------------------------------------------------------------------ debris primitives
def rock_bm(bm, p, size, rr, irr=0.3, basis=None, tilt=0.5):
    """Irregular stone / brick chunk: a jittered box (12 tris) with a random orientation (or basis = 3x3 frame + tilt)."""
    sx, sy, sz = size
    M = (Matrix.Rotation(rr.uniform(0, 6.3) if basis is None else rr.uniform(-0.4, 0.4), 3, 'Z') @
         Matrix.Rotation(rr.uniform(-tilt, tilt), 3, 'X') @ Matrix.Rotation(rr.uniform(-tilt, tilt), 3, 'Y'))
    if basis is not None:
        M = basis @ M
    pts = []
    for z in (-1, 1):
        for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            q = V((x * sx / 2 * rr.uniform(1 - irr, 1), y * sy / 2 * rr.uniform(1 - irr, 1), z * sz / 2 * rr.uniform(1 - irr, 1)))
            pts.append(V(p) + M @ q)
    v = [bm.verts.new(q) for q in pts]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])


def splinter_bm(bm, p0, p1, w, h, rr, tip=0.35):
    """Beam p0->p1 whose p1 end is snapped: tapered, split tip (charred splinters)."""
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0)
    L = d.length
    K.beam_bm(bm, p0, p0 + d * (1 - tip * 0.5 / max(L, 0.01) * 0 - 0.0) - d.normalized() * min(tip, L * 0.4), w, h)
    q = p1 - d.normalized() * min(tip, L * 0.4)
    for k in range(2):
        off = V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * w * 0.25
        K.cyl_bm(bm, q + off * 0.3, p1 + off + d.normalized() * rr.uniform(-0.1, 0.1), w * 0.32, 3, r1=0.0, caps=False)


def stones_at(points, mid, rr, n_each=2, size=(0.22, 0.34), name='loose', brick=False):
    """Loose stones / bricks resting on break ledges (points = [(p, outward_dir, z_floor)])."""
    bm = bmesh.new()
    for p, d, z in points:
        for k in range(n_each):
            s = rr.uniform(*size)
            dims = (s * 1.0, s * 0.48, s * 0.3) if brick else (s, s * rr.uniform(0.6, 0.9), s * rr.uniform(0.45, 0.7))
            q = V(p) + V(d) * rr.uniform(-0.15, 0.1) + V((rr.uniform(-0.12, 0.12), rr.uniform(-0.2, 0.2), dims[2] * 0.45))
            rock_bm(bm, q, dims, rr, 0.25)
    if bm.verts:
        return K.part(bm, mid, name=name, grime=0.6, uv='aligned')
    bm.free()


def remove_parts(pred):
    for o in list(C.A.parts):
        if o.name in bpy.data.objects and pred(o):
            C.A.parts.remove(o); bpy.data.objects.remove(o)


def strip_shutters(frac=0.5, seed=3, curtains=True):
    """Blown-off shutters / burnt curtains on shelled variants: remove a fraction of the shutter leaves."""
    import random
    rr = random.Random(seed)
    for o in list(C.A.parts):
        if o.name not in bpy.data.objects:
            continue
        if ('_shut_' in o.name and rr.random() < frac) or (curtains and _kid(o) == 'curtain'):
            C.A.parts.remove(o); bpy.data.objects.remove(o)


def blast(c, r, rot=0.0, squash=(1, 1, 1), seed=1, mids=('fieldstone',), course=0.3, only=None, skip=None, brick=False,
          timber=None, debris=True):
    """Stepped blast hole through walls / roofs around c (+ loose stones on the step ledges, broken studs if timber)."""
    import random
    rr = random.Random(seed * 7 + 1)
    boxes, edges = blast_boxes(c, r, rot, squash, course, 0.35, seed)
    carve(boxes, only=only, skip=skip)
    if debris:
        import bpy as _bpy
        _bpy.context.view_layer.update()
        dg = _bpy.context.evaluated_depsgraph_get()

        def supported(p):                                  # a ledge still exists under the stone after all the cuts
            ok, loc, nor, idx, ob, M = _bpy.context.scene.ray_cast(dg, V(p) + V((0, 0, 0.12)), V((0, 0, -1)), distance=0.3)
            return ok and ob is not None and ob.get('kit_node', 'main') == 'main'
        low = [e for e in edges if e[2] > 0.2 and supported(e[0] - e[1] * 0.12)]
        stones_at(rr.sample(low, min(len(low), 8)), mids[0], rr, 1, (0.18, 0.3) if not brick else (0.22, 0.24),
                  name='blast%d_loose' % seed, brick=brick)
    if timber:                                  # broken stud / rail ends sticking into the hole
        bm = bmesh.new()
        ax, ay, az = _frame(rot)
        for p, d, z in rr.sample(edges, min(len(edges), 5)):
            a = V(p) - d * 0.15 + V((0, 0, rr.uniform(0.0, 0.25)))
            b = a + d * rr.uniform(0.25, 0.5) + V((0, 0, rr.uniform(-0.35, 0.2)))
            splinter_bm(bm, a, b, 0.14, 0.12, rr, 0.18)
        K.part(bm, timber, name='blast%d_studs' % seed, uv='beam', axis=tuple(ax), grime=0.4)
    return boxes, edges


def roof_breach(R, holes, seed=1, only=None, slate=None, rafter_mid='timber_beam', char_mid='timber_tarred', thick=None,
                fallen=0.2, broken=0.35):
    """Blast holes in roof R: holes = [(lx, ly, rad)]. Stepped outline along slate courses; exposed rafters (some snapped
    with charred splintered ends, some fallen into the attic), broken battens with gaps, slipped slates at the rim."""
    import random
    rr = random.Random(seed * 13 + 5)
    slate = slate or R.mid
    thick = thick or 0.14
    only = only or (lambda o: any(k in o.name for k in ('slope', 'hip', 'ridge', 'dormer', 'roof')))
    bmr, bmc, bmb, bms = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    for i, (lx, ly, rad) in enumerate(holes):
        boxes, rows, (c, up, nrm) = roof_boxes(R, lx, ly, rad, seed=seed + i)
        B = Matrix((R.ax, up, nrm)).transposed()
        carve(boxes, only=only)
        if not rows:
            continue
        v0, v1 = rows[0][0], rows[-1][0] + rows[-1][1]
        umin = min(r_[2] for r_ in rows); umax = max(r_[3] for r_ in rows)
        base = c - nrm * (thick + 0.09)                       # rafter centre line under the covering
        u = umin + rr.uniform(0.05, 0.3)
        while u < umax - 0.1:                                 # rafters (along the slope)
            a = base + R.ax * u + up * (v0 - 0.45)
            b = base + R.ax * u + up * (v1 + 0.45)
            k = rr.random()
            if k < fallen:                                    # snapped at the bottom, top end still on the purlin
                dz = rr.uniform(0.8, 1.8)
                a2 = b + (a - b).normalized() * (b - a).length * rr.uniform(0.55, 0.85) - V((0, 0, dz))
                splinter_bm(bmc, b, a2, 0.08, 0.16, rr, 0.3)
            elif k < fallen + broken:                        # snapped part-way: charred splinter tip
                m = a.lerp(b, rr.uniform(0.3, 0.65))
                K.beam_bm(bmr, b, m + (b - m).normalized() * 0.2, 0.08, 0.16)
                splinter_bm(bmc, m + (b - m).normalized() * 0.3, m - V((0, 0, rr.uniform(0.05, 0.3))), 0.08, 0.14, rr, 0.25)
                if rr.random() < 0.5:
                    K.beam_bm(bmr, a, a.lerp(b, rr.uniform(0.12, 0.25)), 0.08, 0.16)
            else:
                K.beam_bm(bmr if rr.random() < 0.6 else bmc, a, b, 0.08, 0.16)
            u += rr.uniform(0.42, 0.55)
        for (v, h, l, r2) in rows[1::2]:                      # battens with gaps, a few sagging
            zc = base + nrm * 0.1 + up * (v + h / 2)
            x = -l - 0.2
            while x < r2 + 0.2:
                seg = rr.uniform(0.4, 1.4)
                if rr.random() < 0.7:
                    p0, p1 = zc + R.ax * x, zc + R.ax * min(x + seg, r2 + 0.2)
                    if rr.random() < 0.25:
                        p1 = p1 - V((0, 0, rr.uniform(0.15, 0.4)))
                    K.beam_bm(bmb, p0, p1, 0.045, 0.028)
                x += seg + rr.uniform(0.1, 0.5)
        for (v, h, l, r2) in rows:                             # slipped / hanging slates on the rim
            for sgn, e in ((-1, -l), (1, r2)):
                if rr.random() < 0.3:
                    p = c + up * (v + h * rr.uniform(0.2, 0.8)) + R.ax * (e + sgn * rr.uniform(-0.05, 0.12)) - nrm * rr.uniform(0.0, 0.12)
                    rock_bm(bms, p, (rr.uniform(0.22, 0.34), rr.uniform(0.18, 0.26), 0.018), rr, 0.1, B, 0.6)
        for k in range(int(rad * 2.5)):                          # loose slates lying on the surrounding covering
            ang = rr.uniform(0, 6.283)
            d = rad * rr.uniform(1.0, 1.5)
            p = c + R.ax * math.cos(ang) * d * 1.2 + up * math.sin(ang) * d + nrm * 0.02
            qx, qy = (p - R.c).dot(R.ax), (p - R.c).dot(R.ay)
            if not (0.3 < abs(qy) < R.W / 2 - 0.1 and qy * ly > 0 and abs(qx) < R.L / 2 - 0.2):
                continue
            rock_bm(bms, p, (rr.uniform(0.2, 0.3), rr.uniform(0.15, 0.22), 0.016), rr, 0.1, B, 0.08)
    for bm, mid, nm in ((bmr, rafter_mid, 'rafters'), (bmc, char_mid, 'rafters_charred'), (bmb, rafter_mid, 'battens'),
                        (bms, slate, 'slipped_slates')):
        if bm.verts:
            K.part(bm, mid, name='roofdmg_' + nm, uv='beam' if 'slate' not in nm else 'aligned', axis=tuple(R.ax), grime=0.4)
        else:
            bm.free()


def heap(center, radius=2.0, height=0.9, stone='fieldstone', dress=None, brick=None, tiles='roof_slate', timber='timber_beam',
         char='timber_tarred', seed=1, n=None, name='heap', footprint=True, elong=1.0, rot=0.0, beams=4, planks=5, slabs=2):
    """Rubble heap (Caen / St-Lo): low irregular debris bed (gravel + mortar dust) buried under stones, dressed blocks,
    bricks, tile / slate shards, beams (charred, splintered) and floor planks. Nothing sinks > 5 cm below ground."""
    import random
    from mathutils import noise as N
    rr = random.Random(seed * 31 + 7)
    c = V(center); c.z = max(c.z, 0.0)
    ax, ay, _ = _frame(rot)
    rx, ry = radius * elong, radius / elong
    hgt = lambda q: height * max(0.0, 1 - ((q - c).dot(ax) / rx) ** 2 - ((q - c).dot(ay) / ry) ** 2) ** 0.8
    # debris bed: low noisy mound, max ~60% of the heap height, broken outline
    bm = bmesh.new()
    rings, segs = 4, 14
    vv = []
    for i in range(rings):
        t = i / (rings - 1)
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            k = 1 + 0.3 * N.noise(V((math.cos(a) * 1.7, math.sin(a) * 1.7, seed * 0.37 + t)))
            q = c + (ax * math.cos(a) * rx + ay * math.sin(a) * ry) * (1 - t) * k
            z = height * 0.62 * (1 - (1 - t) ** 1.6) * rr.uniform(0.75, 1.15) + (0.02 if i == 0 else 0)
            row.append(bm.verts.new(q + V((0, 0, z - 0.04))))
        vv.append(row)
    for i in range(rings - 1):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((vv[i][j], vv[i][k], vv[i + 1][k], vv[i + 1][j]))
    top = bm.verts.new(c + V((0, 0, height * 0.64)))
    for j in range(segs):
        bm.faces.new((vv[-1][j], vv[-1][(j + 1) % segs], top))
    _bed = K.part(bm, 'gravel', name=name + '_bed', grime=0.8, tint=(0.78, 0.74, 0.68))
    _bed['eu_lod'] = 'all'          # ~100 tris: never decimated (LOD2 collapse made brown 'parasol' fans, review 2)
    n = n or int(18 + radius * radius * 5)

    def spot(spread=1.0):
        a, d = rr.uniform(0, 6.283), math.sqrt(rr.random()) * spread
        q = c + ax * math.cos(a) * d * rx + ay * math.sin(a) * d * ry
        return q, hgt(q)
    groups = {}
    def add(mid, fn):
        bmx = groups.setdefault(mid, bmesh.new())
        fn(bmx)
    ns = n if not brick else int(n * 0.55)
    for i in range(ns):                                  # rubble stones (bigger ones lower, smaller on top)
        q, z = spot(1.05)
        s = rr.uniform(0.16, 0.42) * (1.2 if z < height * 0.3 else 0.9)
        dims = (s, s * rr.uniform(0.55, 0.9), s * rr.uniform(0.4, 0.7))
        add(stone, lambda b: rock_bm(b, q + V((0, 0, max(z * 0.85, dims[2] * 0.35))), dims, rr, 0.3))
    for i in range(n // 4 if dress else 0):             # dressed quoin / lintel blocks
        q, z = spot(0.9)
        dims = (rr.uniform(0.45, 0.8), rr.uniform(0.25, 0.35), rr.uniform(0.2, 0.3))
        add(dress, lambda b: rock_bm(b, q + V((0, 0, max(z * 0.8, 0.1))), dims, rr, 0.08))
    for i in range(int(n * 0.45) if brick else 0):       # bricks, whole and broken, and mortared lumps
        q, z = spot(1.1)
        if rr.random() < 0.8:
            dims = (rr.choice((0.22, 0.22, 0.12)), 0.105, 0.065)
        else:
            dims = (rr.uniform(0.35, 0.6), rr.uniform(0.2, 0.3), rr.uniform(0.13, 0.2))
        add(brick, lambda b: rock_bm(b, q + V((0, 0, max(z * 0.9, 0.04))), dims, rr, 0.05))
    for i in range(n // 2 if tiles else 0):             # tile / slate shards
        q, z = spot(1.2)
        dims = (rr.uniform(0.14, 0.3), rr.uniform(0.12, 0.22), 0.02)
        add(tiles, lambda b: rock_bm(b, q + V((0, 0, max(z * 0.95, 0.02))), dims, rr, 0.15, None, 0.9))
    for i in range(slabs):                              # chunks of wall still bonded
        q, z = spot(0.6)
        dims = (rr.uniform(0.8, 1.4), rr.uniform(0.45, 0.6), rr.uniform(0.4, 0.8))
        add(stone, lambda b: rock_bm(b, q + V((0, 0, max(z * 0.6, dims[2] * 0.3))), dims, rr, 0.18, None, 0.7))
    bt, bc = bmesh.new(), bmesh.new()
    for i in range(beams):                              # beams / joists: one end buried, one sticking up, split ends
        q, z = spot(0.7)
        a = rr.uniform(0, 6.283)
        L = rr.uniform(1.6, 3.2)
        d = V((math.cos(a), math.sin(a), 0))
        p0 = q - d * L * 0.45 + V((0, 0, max(0.05, hgt(q - d * L * 0.45) * 0.8)))
        p1 = q + d * L * 0.55 + V((0, 0, max(0.1, z * 0.9 + rr.uniform(0.1, 0.9))))
        (splinter_bm if rr.random() < 0.7 else (lambda b, x, y, w, h, r_, t: K.beam_bm(b, x, y, w, h)))(
            bc if i % 2 else bt, p0, p1, rr.uniform(0.14, 0.2), rr.uniform(0.16, 0.24), rr, 0.3)
    for i in range(planks):                             # floorboards / laths
        q, z = spot(1.0)
        a = rr.uniform(0, 6.283)
        L = rr.uniform(0.9, 2.2)
        d = V((math.cos(a), math.sin(a), rr.uniform(-0.3, 0.4)))
        p0 = q + V((0, 0, max(0.03, z * 0.9)))
        K.beam_bm(bt, p0, p0 + d.normalized() * L, 0.16, 0.025, roll=rr.uniform(-0.4, 0.4))
    for bmx, mid, nm in ((bt, timber, '_timber'), (bc, char, '_charred')):
        for v in bmx.verts:                                  # never below the ground / floor the heap sits on
            v.co.z = max(v.co.z, c.z - 0.04)
        if bmx.verts:
            K.part(bmx, mid, name=name + nm, uv='beam', axis=(1, 0, 0), grime=0.5)['eu_lod'] = 'not2'
        else:
            bmx.free()
    for mid, bmx in groups.items():
        # clamp everything to >= -0.05 m (validator: nothing buried deep below ground)
        for v in bmx.verts:
            v.co.z = max(v.co.z, c.z - 0.05)
        o_ = K.part(bmx, mid, name=name + '_' + mid, grime=0.5)
        o_['eu_lod'] = 'not2'
    # LOD2: a handful of chunky blocks on the bed instead of decimated shard soup
    bp = bmesh.new()
    for i in range(max(5, int(radius * 3))):
        q, z = spot(0.8)
        s = rr.uniform(0.35, 0.6) * max(0.8, radius / 2.2)
        rock_bm(bp, q + V((0, 0, max(z * 0.7, s * 0.25))), (s, s * 0.75, s * 0.5), rr, 0.2)
    for v in bp.verts:
        v.co.z = max(v.co.z, c.z - 0.05)
    o_ = K.part(bp, stone, name=name + '_lod2', grime=0.6)
    o_['eu_lod'] = 'only2'
    if footprint:
        C.footprint([tuple((c + ax * math.cos(a) * rx * 0.8 + ay * math.sin(a) * ry * 0.8)[:2]) for a in
                     [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')
