"""Hair as Cycles curves grown on the posed, subdivided skin: roots sampled by area x a vertex-group density, each
strand bent from the skin normal toward a flow direction (lying down along the scalp, down the jaw, out along the
brows), with per-strand length, curl and radius jitter. Made after posing, so nothing has to follow a deformation."""
import numpy as np
import bpy
from mathutils import Vector


def surface(ob, group, levels=None):
    """Triangles (posed, world space) of the evaluated object with per-corner density from a vertex group."""
    sub = ob.modifiers.get('sub')
    keep = None
    if sub and levels is not None:
        keep = sub.levels; sub.levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh(preserve_all_data_layers=True, depsgraph=dg)
    me.calc_loop_triangles()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world, np.float64)
    co = co @ M[:3, :3].T + M[:3, 3]
    gi = ob.vertex_groups[group].index
    w = np.zeros(n, np.float32)
    for v in me.vertices:
        for g in v.groups:
            if g.group == gi: w[v.index] = g.weight; break
    tri = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('vertices', tri); tri = tri.reshape(-1, 3)
    ev.to_mesh_clear()
    if keep is not None: sub.levels = keep
    return co, tri, w


def grow(name, co, tri, w, count, length, flow, mat, lie=0.6, pts=5, root_r=4e-5, tip_r=1.2e-5, curl=0.0,
         jitter=0.25, len_jitter=0.35, seed=1, min_w=0.05, len_w=True, parent=None):
    """count strands; length (m) or callable(p, wt) -> length; flow(p, n) -> unit tangent direction (array ops);
    lie 0 = straight out of the skin, 1 = flat along flow."""
    rng = np.random.default_rng(seed)
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    tw = (w[tri[:, 0]] + w[tri[:, 1]] + w[tri[:, 2]]) / 3
    pdf = area * np.where(tw > min_w, tw, 0)
    if pdf.sum() <= 0: return None
    pdf /= pdf.sum()
    k = rng.choice(len(tri), size=count, p=pdf)
    r1, r2 = rng.random(count), rng.random(count)
    s = np.sqrt(r1)
    u, v = 1 - s, s * (1 - r2)
    q = 1 - u - v
    P = a[k] * u[:, None] + b[k] * v[:, None] + c[k] * q[:, None]
    wt = w[tri[k, 0]] * u + w[tri[k, 1]] * v + w[tri[k, 2]] * q
    N = np.cross(b[k] - a[k], c[k] - a[k]); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    F = flow(P, N)
    F = F - N * np.sum(F * N, 1, keepdims=True)
    F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-12
    # jitter the flow inside the tangent plane
    T2 = np.cross(N, F)
    ang = rng.normal(0, jitter, count)
    F = F * np.cos(ang)[:, None] + T2 * np.sin(ang)[:, None]
    L = length(P, wt) if callable(length) else np.full(count, length)
    L = L * (1 + rng.uniform(-len_jitter, len_jitter, count)) * (np.clip(wt, 0.3, 1) if len_w else 1)
    lie_s = np.clip(lie + rng.normal(0, 0.08, count), 0, 0.98)
    out = np.empty((count, pts, 3), np.float32)
    out[:, 0] = P - N * 2e-4                              # root just under the skin
    d0 = N * (1 - lie_s)[:, None] + F * lie_s[:, None]
    d0 /= np.linalg.norm(d0, axis=1, keepdims=True)
    seg = L / (pts - 1)
    d = d0.copy()
    ph = rng.uniform(0, 6.283, count)
    for i in range(1, pts):
        t = i / (pts - 1)
        # bend further toward the flow along the strand, plus a little curl around N
        d = d * 0.7 + F * 0.3 * lie_s[:, None]
        if curl:
            cw = np.cos(ph + t * 4.0)[:, None] * T2 + np.sin(ph + t * 4.0)[:, None] * N
            d = d + cw * curl
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        out[:, i] = out[:, i - 1] + d * seg[:, None]
    crv = bpy.data.hair_curves.new(name)
    crv.add_curves([pts] * count)
    crv.position_data.foreach_set('vector', out.reshape(-1))
    if 'radius' not in crv.attributes: crv.attributes.new('radius', 'FLOAT', 'POINT')
    rad = np.linspace(root_r, tip_r, pts, dtype=np.float32)[None, :] * rng.uniform(0.75, 1.25, (count, 1)).astype(np.float32)
    crv.attributes['radius'].data.foreach_set('value', rad.reshape(-1))
    crv.materials.append(mat)
    ob = bpy.data.objects.new(name, crv)
    bpy.context.scene.collection.objects.link(ob)
    print('HAIR', name, count, 'strands')
    return ob


# ---- flow fields (world space, the posed head frame from the head bone)
def head_frame(rig):
    pb = rig.pose.bones['head']
    M = rig.matrix_world @ pb.matrix
    R = np.array(M.to_3x3(), np.float64)
    # bone Y runs up the head; the face looks along -(world) y in rest -> use the rest-to-pose rotation
    rest = rig.matrix_world @ pb.bone.matrix_local
    Q = np.array((M.to_3x3() @ rest.to_3x3().inverted()), np.float64)
    return np.array(M.translation), Q


def flow_down_back(rig, back=0.35):
    c, Q = head_frame(rig)
    down = Q @ np.array([0, 0, -1.0]); bk = Q @ np.array([0, 1.0, 0])
    def f(P, N):
        return np.tile(down + back * bk, (len(P), 1))
    return f


def flow_beard(rig):
    """Stubble grows down and slightly forward on the chin, down the jaw line, down-and-out on the cheeks."""
    c, Q = head_frame(rig)
    down = Q @ np.array([0, 0, -1.0])
    side = Q @ np.array([1.0, 0, 0])
    def f(P, N):
        x = (P - c) @ side
        return down[None, :] + np.outer(np.tanh(x / 0.05) * 0.25, side)
    return f


def flow_brow(rig):
    c, Q = head_frame(rig)
    side = Q @ np.array([1.0, 0, 0]); up = Q @ np.array([0, 0, 1.0])
    def f(P, N):
        x = (P - c) @ side
        s = np.sign(x)[:, None]
        # medial hairs point up, lateral ones out and slightly down
        k = np.clip(np.abs(x) / 0.045, 0, 1)[:, None]
        return s * side[None, :] * (0.4 + k) + up[None, :] * (0.7 - 0.9 * k)
    return f


def flow_arm(rig, side_suffix):
    """Forearm hair runs from the wrist toward the elbow and round toward the ulnar side."""
    def f(P, N):
        out = np.zeros_like(P)
        for s in ('l', 'r'):
            el = np.array(rig.matrix_world @ rig.pose.bones['lowerarm_' + s].head)
            ha = np.array(rig.matrix_world @ rig.pose.bones['hand_' + s].head)
            ax = (el - ha); ax /= np.linalg.norm(ax)
            dl = np.linalg.norm(P - (el + ha) / 2, axis=1)
            sel = dl < 0.2
            out[sel] = ax
        return out
    return f
