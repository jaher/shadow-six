# geo.py - small geometry toolkit: primitives, surface-conforming patches/ribbons, skin-weight transfer, object ops.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from common import *


def bvh_of(objs):
    bm = bmesh.new()
    for o in objs:
        t = bmesh.new(); t.from_mesh(o.data); t.transform(o.matrix_world)
        me = bpy.data.meshes.new('_tmp'); t.to_mesh(me); t.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def frame(z_axis, up=Vector((0, 0, 1))):
    """rotation matrix whose local Z = z_axis, local Y ~ up"""
    z = Vector(z_axis).normalized()
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def obj_from_bm(name, bm, mat=None, smooth=True, recalc=True):
    if recalc:   # consistent outward normals for patches, ribbons and primitives
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = new_obj(name, me)
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def add_box(bm, size, M, bevel=0.0, segs=1):
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
    _merge(bm, tmp)


def add_cyl(bm, r1, r2, depth, M, segs=12, cap=True, bevel=0.0):
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    if bevel > 0:
        cap_edges = [e for e in tmp.edges if all(abs(abs(v.co.z) - depth / 2) < 1e-6 for v in e.verts)]
        bmesh.ops.bevel(tmp, geom=cap_edges, offset=bevel, segments=1, affect='EDGES')
    bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
    _merge(bm, tmp)


def add_lathe(bm, profile, M, segs=16, sx=1.0, sy=1.0, close_top=True):
    """profile: list of (r, z) from top (r=0) to bottom; revolved around Z; optional elliptic scale."""
    tmp = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring.append(tmp.verts.new((math.sin(a) * r * sx, -math.cos(a) * r * sy, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            a, b = rings[i][k], rings[i][(k + 1) % segs]
            c, d = rings[i + 1][(k + 1) % segs], rings[i + 1][k]
            tmp.faces.new((a, b, c, d))
    bmesh.ops.remove_doubles(tmp, verts=tmp.verts, dist=1e-6)
    bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
    _merge(bm, tmp)


def _merge(bm, tmp):
    me = bpy.data.meshes.new('_m'); tmp.to_mesh(me); tmp.free()
    bm.from_mesh(me); bpy.data.meshes.remove(me)


def M_at(loc, rot=None):
    M = rot.to_4x4() if rot is not None else Matrix.Identity(4)
    M.translation = Vector(loc)
    return M


def project(tree, p, d, far=0.5, fallback=True):
    """ray from p - d*far along d; returns (hit, normal) or (None, None)"""
    d = Vector(d).normalized()
    hit, n, i, dist = tree.ray_cast(Vector(p) - d * far, d, far * 2)
    if hit is None and fallback:
        # missed (edge of the garment): nearest surface point to the ray's closest approach of the body
        hit, n, i, dist = tree.find_nearest(Vector(p) + d * far * 0.8)
    return hit, n


def conform_patch(bm, tree, center, inward, up, w, h, offset, thick, nu=4, nv=3, shape=None):
    """flat w×h patch centred on `center` (world), projected onto the surface along `inward`; thickness `thick`.
    shape(u,v)->(du,dv,dz) optional per-grid-vertex tweak (flap scallops, pleats). Returns created verts."""
    inward = Vector(inward).normalized()
    R = frame(-inward, up)
    xa, ya = R.col[0], R.col[1]
    top, bot = [], []
    for j in range(nv + 1):
        rt, rb = [], []
        for i in range(nu + 1):
            u, v = i / nu - 0.5, j / nv - 0.5
            du = dv = dz = 0.0
            if shape:
                du, dv, dz = shape(u, v)
            p = Vector(center) + xa * (u * w + du) + ya * (v * h + dv)
            hit, n = project(tree, p, inward)
            if hit is None:
                hit, n = p, -inward
            rt.append(bm.verts.new(hit + n * (offset + thick + dz)))
            rb.append(bm.verts.new(hit + n * (offset * 0.5)))
        top.append(rt); bot.append(rb)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]))
    # sides
    ring = [(j, 0) for j in range(nv + 1)] + [(nv, i) for i in range(1, nu + 1)] + [(j, nu) for j in range(nv - 1, -1, -1)] + [(0, i) for i in range(nu - 1, 0, -1)]
    for k in range(len(ring)):
        (j0, i0), (j1, i1) = ring[k], ring[(k + 1) % len(ring)]
        try:
            bm.faces.new((top[j0][i0], bot[j0][i0], bot[j1][i1], top[j1][i1]))
        except ValueError:
            pass
    return [v for r in top for v in r] + [v for r in bot for v in r]


def ribbon(bm, tree, pts, width, offset, thick, towards=None, closed=False, twist_up=None):
    """strap along world points `pts`, each re-projected onto the surface (ray towards the body axis or `towards` fn)."""
    P, N = [], []
    for p in pts:
        d = towards(p) if towards else (Vector((0, p.y * 0 + 0, p.z)) - Vector((p.x, p.y, p.z)))
        hit, n = project(tree, p, d)
        if hit is None:
            hit, n = Vector(p), -Vector(d).normalized()
        P.append(hit); N.append(n)
    L = len(P)
    rows = []
    for k in range(L):
        a = P[(k + 1) % L] if (closed or k < L - 1) else P[k]
        b = P[k - 1] if (closed or k > 0) else P[k]
        t = (a - b).normalized()
        side = N[k].cross(t).normalized()
        c = P[k] + N[k] * offset
        rows.append([bm.verts.new(c - side * width / 2), bm.verts.new(c + side * width / 2),
                     bm.verts.new(c + side * width / 2 + N[k] * thick), bm.verts.new(c - side * width / 2 + N[k] * thick)])
    segs = L if closed else L - 1
    for k in range(segs):
        r0, r1 = rows[k], rows[(k + 1) % L]
        for q in range(3):
            try:
                bm.faces.new((r0[q], r1[q], r1[(q + 1) % 4], r0[(q + 1) % 4]))
            except ValueError:
                pass
    return P, N


def transfer_weights(o, src, rig):
    """copy skin weights from the nearest surface of `src` (garment or body), keep the armature modifier."""
    for g in src.vertex_groups:
        if g.name not in o.vertex_groups:
            o.vertex_groups.new(name=g.name)
    md = o.modifiers.new('DT', 'DATA_TRANSFER')
    md.object = src
    md.use_vert_data = True
    md.data_types_verts = {'VGROUP_WEIGHTS'}
    md.vert_mapping = 'POLYINTERP_NEAREST'
    md.layers_vgroup_select_src = 'ALL'
    md.layers_vgroup_select_dst = 'NAME'
    activate(o)
    bpy.ops.object.datalayout_transfer(modifier=md.name)
    bpy.ops.object.modifier_apply(modifier=md.name)
    bind_rig(o, rig)


def rigid_weights(o, bone, rig):
    g = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    bind_rig(o, rig)


def bind_rig(o, rig):
    o.parent = rig
    if not any(m.type == 'ARMATURE' for m in o.modifiers):
        am = o.modifiers.new('Armature', 'ARMATURE'); am.object = rig
