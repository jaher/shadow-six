# shell.py - garment shells grown from the MPFB body surface: perfect fit + inherited skin weights.
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from common import *


class BodyCtx:
    """body surface data shared by all garments of one character"""
    def __init__(self, human, rig, dom, m):
        self.human, self.rig, self.dom, self.m = human, rig, dom, m
        gi = human.vertex_groups['body'].index
        self.visible = set(v.index for v in human.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups))
        bm = bmesh.new(); bm.from_mesh(human.data)
        bm.verts.ensure_lookup_table()
        kill = [f for f in bm.faces if not all(v.index in self.visible for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()
        self.covered = set()   # body vertex indices hidden under garments (deleted at the end)
        B = m['bones']
        self.bone = {k: (Vector(h), Vector(t)) for k, (h, t) in B.items()}

    def dist_to_bone(self, co, name, end='head'):
        h, t = self.bone[name]
        return (co - (h if end == 'head' else t)).length


def make_shell(ctx, name, face_pred, offset=0.008, offset_fn=None, smooth=4, smooth_pred=None, min_off=0.003,
               shape_fn=None, rim=0.004, mat=None, target_tris=None, cover=True, cover_pred=None, cuts=()):
    """face_pred(center, dom_bone, face_vert_indices) -> bool selects body faces for the garment.
    offset_fn(co, dom) -> metres outward (overrides offset). shape_fn(bm, ctx, orig_index_layer) for custom shaping.
    Returns the new object (parented to the rig with an Armature modifier, weights inherited)."""
    human = ctx.human
    me = human.data.copy(); me.name = name
    o = new_obj(name, me)
    o.parent = ctx.rig
    for g in human.vertex_groups:          # vertex-group NAMES live on the object: replicate in the same order
        o.vertex_groups.new(name=g.name)
    for md in list(o.modifiers):
        o.modifiers.remove(md)
    am = o.modifiers.new('Armature', 'ARMATURE'); am.object = ctx.rig
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    oi = bm.verts.layers.int.new('orig')
    for v in bm.verts:
        v[oi] = v.index
    dom = ctx.dom
    keep = []
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        if not all(i in ctx.visible for i in idx):
            continue
        c = f.calc_center_median()
        ds = [dom[i] for i in idx]
        d = max(set(ds), key=ds.count)
        if face_pred(c, d, idx):
            keep.append(f)
    ks = set(keep)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in ks], context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.verts.ensure_lookup_table()
    if cover:
        cvs = [(Vector(c[0]), Vector(c[1])) for c in cuts if len(c) < 4]   # 4th element: edge-trim only (no cover)
        for f in bm.faces:
            if cover_pred is None or cover_pred(f.calc_center_median()):
                if not any(e.is_boundary for e in f.edges):
                    for v in f.verts:
                        if all((v.co - c).dot(n) < -0.012 for c, n in cvs):
                            ctx.covered.add(v[oi])
    bm.normal_update()
    normals = {v: v.normal.copy() for v in bm.verts}
    # offset along normals
    for v in bm.verts:
        d = offset_fn(v.co, dom[v[oi]]) if offset_fn else offset
        v.co += normals[v] * d
    if shape_fn:
        shape_fn(bm, ctx, oi)
    # smooth (anatomy -> cloth) with push-out constraint against the body surface
    interior = [v for v in bm.verts if not v.is_boundary and (smooth_pred is None or smooth_pred(v.co, dom[v[oi]]))]
    for it in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=interior, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        push_out(bm, ctx, min_off)
    push_out(bm, ctx, min_off)
    # clean hems: bisect with planes (co, normal) and drop the side the normal points to
    for cut in cuts:
        co, no = cut[0], cut[1]
        sel = cut[2] if len(cut) > 2 else None
        if sel:   # local cut (armholes): only faces selected by sel(center)
            fs = [f for f in bm.faces if sel(f.calc_center_median())]
            geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
        else:
            geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no), clear_outer=True, dist=0.0005)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    # rim: fold the open border inward so the gap to the skin is closed (visible cloth thickness)
    if rim:
        bnd = [e for e in bm.edges if e.is_boundary]
        if bnd:
            bverts = set(v for e in bnd for v in e.verts)
            info = {tuple(round(x, 6) for x in v.co): (v.co.copy(), v.normal.copy()) for v in bverts}
            r = bmesh.ops.extrude_edge_only(bm, edges=bnd)
            nv = [x for x in r['geom'] if isinstance(x, bmesh.types.BMVert)]
            for v in nv:
                k = tuple(round(x, 6) for x in v.co)
                if k in info:
                    co, n = info[k]
                    loc, fn, i, dist = ctx.bvh.find_nearest(co)
                    depth = ((co - loc).dot(fn) if loc is not None else rim) + 0.0015
                    v.co = co - n * depth
    bm.to_mesh(me); bm.free()
    me.update()
    if mat:
        me.materials.clear(); me.materials.append(mat)
        for p in me.polygons:
            p.material_index = 0
    for p in me.polygons:
        p.use_smooth = True
    if target_tris:
        decimate(o, target_tris)
    log(f'shell {name}: {tri_count(o)} tris')
    return o


def push_out(bm, ctx, min_off):
    for v in bm.verts:
        loc, n, i, dist = ctx.bvh.find_nearest(v.co)
        if loc is None:
            continue
        d = (v.co - loc).dot(n)
        if d < min_off:
            v.co = loc + n * min_off


def decimate(o, target_tris, vgroup=None, invert=False, factor=1.0):
    t = tri_count(o)
    if t <= target_tris:
        return
    md = o.modifiers.new('Dec', 'DECIMATE')
    md.ratio = max(0.02, target_tris / t)
    md.use_collapse_triangulate = True
    if vgroup:
        md.vertex_group = vgroup; md.invert_vertex_group = invert; md.vertex_group_factor = factor
    activate(o)
    bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
    bpy.ops.object.modifier_apply(modifier=md.name)


def ring_convexify(bm, verts, center_fn, amount=0.7, flare_fn=None):
    """pull each vertex's horizontal radius toward the ring's max-smoothed ellipse (boot shafts, skirts)."""
    rings = {}
    for v in verts:
        rings.setdefault(round(v.co.z / 0.01), []).append(v)
    for k, vs in rings.items():
        c = center_fn(vs)
        rs = [(Vector((v.co.x - c.x, v.co.y - c.y))).length for v in vs]
        rmax = max(rs); rmean = sum(rs) / len(rs)
        target = 0.5 * (rmax + rmean)
        for v, r in zip(vs, rs):
            if r < 1e-6:
                continue
            tr = target * (flare_fn(v.co) if flare_fn else 1.0)
            nr = r + (max(r, tr) - r) * amount
            d = Vector((v.co.x - c.x, v.co.y - c.y)) * (nr / r)
            v.co.x = c.x + d.x; v.co.y = c.y + d.y


def centroid(vs):
    c = Vector()
    for v in vs:
        c += v.co
    return c / len(vs)


def delete_covered(ctx, margin_faces=True):
    """remove body faces fully hidden under garments (saves ~40% of the body triangles)."""
    human = ctx.human
    bm = bmesh.new(); bm.from_mesh(human.data)
    bm.verts.ensure_lookup_table()
    kill = [f for f in bm.faces if all(v.index in ctx.covered for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
    bm.to_mesh(human.data); bm.free()
    log(f'body: removed {len(kill)} covered faces')


def hull2d(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def slice_convexify(verts, axis=2, step=0.01, amount=1.0, grow=0.0):
    """per slice along `axis`, push vertices out to the slice's 2D convex hull (removes toes, buttock clefts...)."""
    ax = [i for i in range(3) if i != axis]
    bins = {}
    for v in verts:
        bins.setdefault(int(math.floor(v.co[axis] / step)), []).append(v)
    for k, vs in bins.items():
        if len(vs) < 4:
            continue
        P = [(v.co[ax[0]], v.co[ax[1]]) for v in vs]
        H = hull2d([(round(a, 5), round(b, 5)) for a, b in P])
        if len(H) < 3:
            continue
        cx = sum(p[0] for p in P) / len(P); cy = sum(p[1] for p in P) / len(P)
        for v, (x, y) in zip(vs, P):
            dx, dy = x - cx, y - cy
            L = math.hypot(dx, dy)
            if L < 1e-7:
                continue
            ux, uy = dx / L, dy / L
            best = None
            for i in range(len(H)):   # ray from centroid vs hull edges
                ax_, ay_ = H[i]; bx, by = H[(i + 1) % len(H)]
                ex, ey = bx - ax_, by - ay_
                den = ux * ey - uy * ex
                if abs(den) < 1e-12:
                    continue
                t = ((ax_ - cx) * ey - (ay_ - cy) * ex) / den
                u = ((ax_ - cx) * uy - (ay_ - cy) * ux) / den
                if t > 0 and -1e-6 <= u <= 1 + 1e-6:
                    best = t if best is None else min(best, t)
            if best and best > L:
                nl = L + (best + grow - L) * amount
                v.co[ax[0]] = cx + ux * nl; v.co[ax[1]] = cy + uy * nl
