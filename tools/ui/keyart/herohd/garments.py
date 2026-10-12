"""Garments for the hero, built around the rest-pose body and then cloth-simulated into the pose:
  torso / skirt  = a loft of the body's horizontal convex-hull slices (arms excluded) + ease, so the skirt below the
                   crotch spans both thighs like a real smock;
  sleeves        = tubes along the upper-arm bones, radius from the arm skin + ease, started inside the torso;
  union          = voxel remesh of the closed tubes (uniform quads, a clean armpit), then openings cut by planes;
  skinning       = weights copied from the nearest body surface; the cloth runs while the armature moves from the
                   rest pose into pose B, with the waist ring pinned to a cinch target under the belt.
"""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def body_rest(body):
    """Rest-pose world coordinates of the body (no modifiers) and dominant-bone names per vertex."""
    M = np.array(body.matrix_world)
    co = np.array([v.co for v in body.data.vertices]) @ M[:3, :3].T + M[:3, 3]
    gi = {g.index: g.name for g in body.vertex_groups}
    dom = []
    for v in body.data.vertices:
        best, bw = None, 0.0
        for g in v.groups:
            nm = gi.get(g.group, '')
            if g.weight > bw and not nm.startswith('k_'): best, bw = nm, g.weight
        dom.append(best or '')
    return co, np.array(dom)


def dense_points(body, co, dom, n=400000, seed=0):
    """Area-uniform random points on the rest body surface + the dominant bone of the nearest corner, so horizontal
    slices are dense (vertex loops alone give terraced hulls)."""
    me = body.data
    me.calc_loop_triangles()
    tri = np.array([t.vertices[:] for t in me.loop_triangles])
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    rng = np.random.default_rng(seed)
    k = rng.choice(len(tri), size=n, p=area / area.sum())
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1); u, v = 1 - s, s * (1 - r2); w = 1 - u - v
    P = a[k] * u[:, None] + b[k] * v[:, None] + c[k] * w[:, None]
    corner = np.argmax(np.stack([u, v, w], 1), 1)
    D = dom[tri[k, corner]]
    return P, D


def hull2d(pts):
    """Convex hull (Andrew's monotone chain) of 2D points -> CCW array."""
    P = sorted(map(tuple, pts))
    if len(P) < 3: return np.array(P)
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return np.array(lo[:-1] + up[:-1])


def ring_from_hull(h, c, n=72, ease=0.02, ease_fn=None):
    """Sample a convex polygon radially round centre c (n angles) and push it out by ease (m)."""
    out = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = np.array([math.cos(a), math.sin(a)])
        # ray from c along d against the polygon edges
        best = None
        for i in range(len(h)):
            p, q = h[i] - c, h[(i + 1) % len(h)] - c
            e = q - p
            den = d[0] * (-e[1]) + d[1] * e[0]
            if abs(den) < 1e-12: continue
            t = (p[0] * (-e[1]) + p[1] * e[0]) / den
            s = (d[0] * p[1] - d[1] * p[0]) / den
            if t > 0 and -1e-9 <= s <= 1 + 1e-9:
                best = t if best is None else max(best, t)
        r = (best or 0.05) + (ease_fn(a) if ease_fn else ease)
        out.append(c + d * r)
    return np.array(out)


def smooth_rings(R, it=2):
    """Smooth ring radii along the loft (vertical) and round each ring."""
    for _ in range(it):
        R[1:-1] = 0.25 * R[:-2] + 0.5 * R[1:-1] + 0.25 * R[2:]
        R = 0.25 * np.roll(R, 1, 1) + 0.5 * R + 0.25 * np.roll(R, -1, 1)
    return R


def tube_mesh(name, rings, cap=True):
    """Closed tube from rings (k, n, 3)."""
    bm = bmesh.new()
    K, N = rings.shape[:2]
    vs = [[bm.verts.new(tuple(rings[k, i])) for i in range(N)] for k in range(K)]
    for k in range(K - 1):
        for i in range(N):
            bm.faces.new((vs[k][i], vs[k][(i + 1) % N], vs[k + 1][(i + 1) % N], vs[k + 1][i]))
    if cap:
        bm.faces.new(vs[0][::-1]); bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def torso_loft(co, dom, z_top, z_bot, ease_fn, step=0.008, n=72, exclude=('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'), sl=0.008, zsmooth=6):
    keep = np.array([not any(d.startswith(e) for e in exclude) for d in dom])
    zs = np.arange(z_top, z_bot - 1e-6, -step)
    rings = []
    for z in zs:
        s = keep & (np.abs(co[:, 2] - z) < sl)
        pts = co[s][:, :2]
        h = hull2d(pts)
        c = np.array([0.5 * (pts[:, 0].min() + pts[:, 0].max()) if len(pts) else 0.0, pts[:, 1].mean() if len(pts) else 0.0])
        r = ring_from_hull(h, c, n, ease_fn=(lambda a, z=z: ease_fn(z, a)))
        rings.append(np.c_[r, np.full(n, z)])
    R = np.array(rings)
    # smooth radially (relative to the per-ring centre)
    cen = R.mean(1, keepdims=True)
    rad = np.linalg.norm(R[:, :, :2] - cen[:, :, :2], axis=2)
    ang = np.arctan2(R[:, :, 1] - cen[:, :, 1], R[:, :, 0] - cen[:, :, 0])
    rad = smooth_rings(rad, zsmooth)
    R[:, :, 0] = cen[:, :, 0] + rad * np.cos(ang); R[:, :, 1] = cen[:, :, 1] + rad * np.sin(ang)
    return R


def arm_tube(co, dom, rig, side, t0=-0.06, t1=0.8, ease=0.018, n=40, step=0.012, end_flare=0.0):
    """Sleeve tube along upperarm_<side>: t in bone-length fractions (t0 < 0 starts inside the torso)."""
    b = rig.data.bones['upperarm_' + side]
    M = rig.matrix_world
    h, tl = np.array(M @ b.head_local), np.array(M @ b.tail_local)
    ax = tl - h; L = np.linalg.norm(ax); ax /= L
    u = np.cross(ax, [0, 0, 1.0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
    sel = np.array([d.startswith('upperarm_' + side) or d.startswith('lowerarm_' + side) or d.startswith('clavicle_' + side) for d in dom])
    P = co[sel]
    ts = np.arange(t0, t1 + 1e-6, step / L)
    rings = []
    for t in ts:
        c = h + ax * t * L
        d = P - c
        along = d @ ax
        m = np.abs(along) < 0.012
        if m.sum() < 6:
            r = 0.055
            rads = np.full(n, r)
        else:
            q = d[m] - np.outer(along[m], ax)
            ang = np.arctan2(q @ v, q @ u); rr = np.linalg.norm(q, axis=1)
            rads = np.zeros(n)
            for k in range(n):
                a = 2 * math.pi * k / n
                dd = np.abs(np.angle(np.exp(1j * (ang - a))))
                w = dd < 0.45
                rads[k] = rr[w].max() if w.any() else rr.max()
        flare = end_flare * max(0.0, (t - (t1 - 0.15)) / 0.15)
        rads = rads + ease + flare
        ring = [c + (math.cos(2 * math.pi * k / n) * u + math.sin(2 * math.pi * k / n) * v) * rads[k] for k in range(n)]
        rings.append(ring)
    R = np.array(rings)
    cen = R.mean(1, keepdims=True)
    rad = np.linalg.norm(R - cen, axis=2)
    rad = smooth_rings(rad, 3)
    dirs = (R - cen) / (np.linalg.norm(R - cen, axis=2, keepdims=True) + 1e-12)
    R = cen + dirs * rad[:, :, None]
    return R, (h, ax, L, u, v)


def body_shell(body, name, sel_fn, ease_fn):
    """Closed shell over part of the rest body: vertices with sel_fn(p, dominant bone) are pushed out along their
    normals by ease_fn(p) and solidified inward to the skin -> a volume the voxel remesh can union."""
    co, dom = body_rest(body)
    me = body.data
    nrm = np.array([v.normal for v in me.vertices]) @ np.array(body.matrix_world)[:3, :3].T
    keep = np.array([bool(sel_fn(co[i], dom[i])) for i in range(len(co))])
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context='VERTS')
    M = np.array(body.matrix_world)
    newme = bpy.data.meshes.new(name); bm.to_mesh(newme); bm.free()
    ob = bpy.data.objects.new(name, newme); bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = body.matrix_world.copy()
    # positions: original index map is lost by delete -> recompute by nearest original
    from mathutils.kdtree import KDTree
    kd = KDTree(len(co))
    for i, p in enumerate(co): kd.insert(Vector(p), i)
    kd.balance()
    Mi = np.linalg.inv(M)
    for v in newme.vertices:
        pw = np.array(body.matrix_world @ v.co)
        _, i, _ = kd.find(Vector(pw))
        e = ease_fn(co[i])
        q = pw + nrm[i] / (np.linalg.norm(nrm[i]) + 1e-12) * e
        v.co = Vector((Mi[:3, :3] @ q + Mi[:3, 3]).tolist())
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.03; sd.offset = -1.0; sd.use_rim = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=sd.name)
    ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    return ob


def bisect(ob, plane_co, plane_no, region_fn, delete=True):
    """Cut the mesh along a plane, only within region_fn(p) (world), and delete what lies on the +normal side there:
    a clean straight edge (sleeve ends, hem, neckline) instead of the voxel stair-steps."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    M = ob.matrix_world; Mi = M.inverted()
    geom = [f for f in bm.faces if region_fn(np.array(M @ f.calc_center_median()))]
    gset = set()
    for f in geom:
        gset.add(f); gset.update(f.edges); gset.update(f.verts)
    pc = Mi @ Vector(plane_co); pn = (Mi.to_3x3() @ Vector(plane_no)).normalized()
    bmesh.ops.bisect_plane(bm, geom=list(gset), dist=1e-5, plane_co=pc, plane_no=pn, clear_outer=False, clear_inner=False)
    dead = [f for f in bm.faces if delete and (f.calc_center_median() - pc).dot(pn) > 0 and region_fn(np.array(M @ f.calc_center_median()))]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def remesh_union(objs, name, voxel=0.006, smooth=0):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    md = ob.modifiers.new('rm', 'REMESH'); md.mode = 'VOXEL'; md.voxel_size = voxel; md.adaptivity = 0.0
    md.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=md.name)
    if smooth:
        md = ob.modifiers.new('sm', 'SMOOTH'); md.factor = 0.5; md.iterations = smooth
        bpy.ops.object.modifier_apply(modifier=md.name)
    return ob


def cut(ob, keep_fn):
    """Delete faces whose centre fails keep_fn(p) (numpy (3,) world)."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    M = ob.matrix_world
    dead = [f for f in bm.faces if not keep_fn(np.array(M @ f.calc_center_median()))]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # drop small floating islands
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, isl = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop(); isl.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen: seen.add(o.index); stack.append(o)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    for isl in islands[1:]:
        bmesh.ops.delete(bm, geom=isl, context='VERTS')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def transfer_weights(dst, src, rig):
    """Bone weights from the nearest body surface (rest), normalised; bind to the rig."""
    for g in src.vertex_groups:
        if g.name in rig.data.bones and g.name not in dst.vertex_groups:
            dst.vertex_groups.new(name=g.name)
    dt = dst.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = src
    dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.modifier_apply(modifier=dt.name)
    for g in list(dst.vertex_groups):
        if g.name.startswith('k_'): dst.vertex_groups.remove(g)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    md = dst.modifiers.new('Armature', 'ARMATURE'); md.object = rig
    dst.parent = rig
    dst.matrix_parent_inverse = rig.matrix_world.inverted()


def group(ob, name, fn):
    """Vertex group from fn(p_world) -> weight (rest pose)."""
    vg = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    M = ob.matrix_world
    for v in ob.data.vertices:
        w = float(fn(np.array(M @ v.co)))
        if w > 1e-4: vg.add([v.index], min(1.0, w), 'REPLACE')
    return vg


def keyframe_pose(rig, frame_rest=1, frame_pose=20):
    """Key every pose bone at identity (rest) and at its current pose; quaternions so the blend is clean."""
    for pb in rig.pose.bones:
        q = pb.matrix_basis.to_quaternion()
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.keyframe_insert('rotation_quaternion', frame=frame_rest)
        pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=frame_pose)
    if rig.animation_data and rig.animation_data.action:
        for fc in _fcurves(rig.animation_data.action):
            for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'


def _fcurves(action):
    try:
        return list(action.fcurves)
    except AttributeError:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags: out += list(cb.fcurves)
        return out


def cloth(ob, pin=None, mass=0.35, tension=18, compression=18, shear=8, bending=1.2, quality=10, self_col=True,
          thick=0.004, self_dist=0.003, shrink=0.0, frames=(1, 45), pressure=0.0, gravity=1.0, damping=6.0):
    md = ob.modifiers.new('Cloth', 'CLOTH')
    s = md.settings
    s.quality = quality; s.mass = mass
    s.tension_stiffness = tension; s.compression_stiffness = compression; s.shear_stiffness = shear
    s.bending_stiffness = bending
    s.tension_damping = damping; s.compression_damping = damping; s.shear_damping = damping
    s.air_damping = 2.0
    s.shrink_min = shrink
    s.effector_weights.gravity = gravity
    if pin: s.vertex_group_mass = pin; s.pin_stiffness = 2.0
    if pressure:
        s.use_pressure = True; s.uniform_pressure_force = pressure
    c = md.collision_settings
    c.collision_quality = 4; c.distance_min = thick
    c.use_self_collision = self_col; c.self_distance_min = self_dist; c.self_friction = 5
    md.point_cache.frame_start, md.point_cache.frame_end = frames
    return md


def collider(ob, thick=0.004, friction=5.0):
    md = ob.modifiers.new('Collision', 'COLLISION')
    ob.collision.thickness_outer = thick; ob.collision.thickness_inner = 0.01
    ob.collision.cloth_friction = friction
    return md


def run_sim(f0, f1, report=None):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = f0, f1
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        if report and f % 5 == 0: print('SIM frame', f, flush=True)


def bake_to_mesh(ob, name=None):
    """Freeze the evaluated (simulated) shape as a plain mesh in world space (no armature / cloth)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(ob.matrix_world)
    nob = bpy.data.objects.new(name or ob.name + '_baked', me)
    bpy.context.scene.collection.objects.link(nob)
    for p in me.polygons: p.use_smooth = True
    return nob


def cinch_shape(ob, body, group, offset=0.007, name='cinch'):
    """Shape key pulling the vertices of `group` onto the rest body surface + offset (weighted)."""
    dg = bpy.context.evaluated_depsgraph_get()
    co = np.array([v.co for v in body.data.vertices]) @ np.array(body.matrix_world)[:3, :3].T + np.array(body.matrix_world)[:3, 3]
    me = body.data; me.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([Vector(p) for p in co], [t.vertices[:] for t in me.loop_triangles])
    if not ob.data.shape_keys: ob.shape_key_add(name='Basis')
    sk = ob.shape_key_add(name=name, from_mix=False)
    gi = ob.vertex_groups[group].index
    M = ob.matrix_world; Mi = M.inverted()
    for v in ob.data.vertices:
        w = 0.0
        for g in v.groups:
            if g.group == gi: w = g.weight
        if w <= 0: continue
        p = M @ v.co
        loc, nrm, _, _ = bvh.find_nearest(p)
        if loc is None: continue
        tgt = loc + nrm.normalized() * offset
        sk.data[v.index].co = Mi @ (p.lerp(tgt, w))
    return sk


# ---------------------------------------------------------------------------------------------- the two garments
def landmarks_z(rig):
    B = lambda n, t='head': np.array(rig.matrix_world @ getattr(rig.data.bones[n], t + '_local'))
    arms = {}
    for s in ('l', 'r'):
        h, t = B('upperarm_' + s), B('upperarm_' + s, 'tail')
        arms[s] = (h, (t - h) / np.linalg.norm(t - h), np.linalg.norm(t - h))
    legs = {}
    for s in ('l', 'r'):
        h, t = B('thigh_' + s), B('thigh_' + s, 'tail')
        legs[s] = (h, (t - h) / np.linalg.norm(t - h), np.linalg.norm(t - h))
    return dict(zn=B('neck_01')[2], yn=B('neck_01')[1], zs=B('upperarm_r')[2], zw=B('spine_01')[2], zh=B('thigh_r')[2],
                arms=arms, legs=legs)


def _bodyfill(body):
    o = bpy.data.objects.new('bodyfill', body.data.copy()); bpy.context.scene.collection.objects.link(o)
    o.matrix_world = body.matrix_world.copy()
    for g in list(o.vertex_groups): o.vertex_groups.remove(g)
    o.data.materials.clear()
    return o


def make_smock(body, rig, voxel=0.008, ease_add=0.012, sleeve_t=0.74, hem=-0.20):
    """Denison smock in rest pose: roomy loft (chest down to mid-thigh) + body shell over the shoulders and upper arms
    + sleeve tubes, unioned with the body volume; neckline, sleeve ends (rolled above the elbow) and hem cut clean."""
    Z = landmarks_z(rig)
    zn, zs, zw, zh, yn, arms = Z['zn'], Z['zs'], Z['zw'], Z['zh'], Z['yn'], Z['arms']
    z_belt = zw - 0.02
    co, dom = body_rest(body)

    def ease(z, a):
        e = 0.024 + ease_add
        e += 0.02 * np.clip((zs - 0.05 - z) / 0.1, 0, 1)
        e += 0.014 * max(0.0, math.sin(a))
        e += 0.018 * np.clip((z_belt + 0.06 - z) / 0.06, 0, 1) * np.clip((z - (zh - 0.2)) / 0.1, 0, 1)
        return e
    Pd, Dd = dense_points(body, co, dom)
    R = torso_loft(Pd, Dd, zs - 0.06, zh + hem - 0.03, ease, sl=0.004, zsmooth=3)
    parts = [tube_mesh('smock_torso', R)]
    TB = ('spine_02', 'spine_03', 'clavicle', 'neck_01', 'upperarm', 'spine_01')

    def shell_sel(p, d):
        if not d.startswith(TB): return False
        if d.startswith('neck_01') and p[2] > zn - 0.01: return False
        if d.startswith('upperarm'):
            h, ax, L = arms[d[-1]]
            return (p - h) @ ax < 0.85 * L
        return p[2] > zw - 0.08

    def shell_ease(p):
        e = 0.016 + ease_add * 0.5
        if p[2] < zs - 0.02: e += 0.014 * np.clip((zs - 0.02 - p[2]) / 0.08, 0, 1)
        return e
    parts.append(body_shell(body, 'smock_shell', shell_sel, shell_ease))
    parts.append(_bodyfill(body))
    for s in ('l', 'r'):
        Ra, _ = arm_tube(co, dom, rig, s, t0=0.15, t1=sleeve_t + 0.06, ease=0.022 + ease_add * 0.5, end_flare=0.008)
        parts.append(tube_mesh('sleeve_' + s, Ra))
    sm = remesh_union(parts, 'smock', voxel=voxel, smooth=3)
    sm.data.materials.clear()
    nrm = np.array([0, -0.33, 1.0]); nrm /= np.linalg.norm(nrm)
    bisect(sm, (0, yn, zn + 0.012), tuple(nrm), lambda p: p[2] > zn - 0.12 and np.hypot(p[0], p[1] - yn) < 0.16)
    bisect(sm, (0, 0, zh + hem), (0, 0, -1), lambda p: p[2] < zh + hem + 0.1)
    # the zip opened part way: a V from the neckline down the front (clean edges from two bisects)
    zv, k = zn - 0.13, 0.034 / 0.11
    front = lambda p: p[1] < yn - 0.02 and p[2] > zv - 0.03 and abs(p[0]) < 0.08
    for sg in (1, -1):
        nn = np.array([sg * 1.0, 0, -k]); nn /= np.linalg.norm(nn)
        bisect(sm, (0, 0, zv), tuple(nn), front, delete=False)
    cut(sm, lambda p: not (front(p) and abs(p[0]) < k * (p[2] - zv) and p[2] > zv))
    for s, (h, ax, L) in arms.items():
        bisect(sm, tuple(h + ax * sleeve_t * L), tuple(ax), lambda p, h=h, ax=ax, L=L: (p - h) @ ax > 0.45 * L and np.linalg.norm((p - h) - ax * ((p - h) @ ax)) < 0.12)
    cut(sm, lambda p: True)
    store_rest(sm)
    transfer_weights(sm, body, rig)
    group(sm, 'belt', lambda p: np.clip(1 - abs(p[2] - z_belt) / 0.025, 0, 1) ** 0.5)
    sk = cinch_shape(sm, body, 'belt', 0.010)
    return sm, sk, dict(Z, z_belt=z_belt, sleeve_t=sleeve_t, hem=zh + hem)


def make_trousers(body, rig, voxel=0.008, z_top=None, knee=1.6):
    """Battledress trousers in rest pose: pelvis loft (waistband high, at the navel) + one loft per thigh, unioned with
    the body; waist and legs (below the knee, out of frame) cut clean."""
    Z = landmarks_z(rig)
    zw, zh, legs = Z['zw'], Z['zh'], Z['legs']
    co, dom = body_rest(body)
    Pd, Dd = dense_points(body, co, dom)
    z_top = z_top if z_top is not None else zw + 0.01
    crotch = zh - 0.085
    pel = torso_loft(Pd, Dd, z_top + 0.02, crotch + 0.01, lambda z, a: 0.014 + 0.01 * max(0.0, math.sin(a)) + 0.012 * np.clip((z_top - 0.05 - z) / 0.1, 0, 1), sl=0.004, zsmooth=3)
    parts = [tube_mesh('tr_pelvis', pel), _bodyfill(body)]
    for s in ('l', 'r'):
        sg = 1 if s == 'l' else -1
        keep = Pd[:, 0] * sg > 0.004
        h, ax, L = legs[s]
        zk = h[2] + ax[2] * L * knee
        R = torso_loft(Pd[keep], Dd[keep], crotch + 0.03, zk - 0.04, lambda z, a: 0.022 + 0.008 * max(0.0, math.sin(a)), sl=0.004, zsmooth=3,
                       exclude=('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))
        parts.append(tube_mesh('tr_leg_' + s, R))
    tr = remesh_union(parts, 'trousers', voxel=voxel, smooth=3)
    tr.data.materials.clear()
    bisect(tr, (0, 0, z_top), (0, 0, 1), lambda p: p[2] > z_top - 0.08)
    for s, (h, ax, L) in legs.items():
        zk = h[2] + ax[2] * L * knee
        bisect(tr, (h[0] + ax[0] * L * knee, 0, zk), (0, 0, -1), lambda p, zk=zk: p[2] < zk + 0.05)
    cut(tr, lambda p: True)
    store_rest(tr)
    transfer_weights(tr, body, rig)
    group(tr, 'waist', lambda p: np.clip(1 - (z_top - p[2]) / 0.05, 0, 1))
    sk = cinch_shape(tr, body, 'waist', 0.004)
    return tr, sk, dict(Z, z_top=z_top)


def store_rest(ob):
    a = ob.data.attributes.get('rest_co') or ob.data.attributes.new('rest_co', 'FLOAT_VECTOR', 'POINT')
    M = ob.matrix_world
    for i, v in enumerate(ob.data.vertices): a.data[i].vector = M @ v.co
