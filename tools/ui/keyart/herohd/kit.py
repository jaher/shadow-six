"""1937-pattern web equipment and personal kit, laid onto the simulated smock in pose B:
  belt (57 mm, brass buckle and end tips), two basic pouches (flap, press stud, brass top buckle and belt hooks),
  braces (25 mm) from the pouch buckles over the shoulders, a water bottle in its webbing cradle on the right hip,
  the Fairbairn-Sykes fighting knife in its leather sheath (brass chape, elastic retaining tab) on the left hip, a Mills
  bomb hooked on the left brace and the toggle rope round the waist. Straps are ribbons following a path projected
  onto the cloth (+ clearance), UV U = metres along, V = across, so the weave shader runs with the strap."""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import mats

MM = 0.001


class Surface:
    """Closest-point projection onto an object's base surface (modifiers off: a garment's solidify shell would hide it),
    world space; normals turned away from the vertical body axis (x = 0, y = axis_y) so a flipped cloth face still
    points out."""
    def __init__(self, ob, axis_y=-0.025, raw=True):
        vis = [m.show_viewport for m in ob.modifiers]
        if raw:                                  # the rendered surface: subdivision on, the solidify shell off
            for m in ob.modifiers:
                if m.type == 'SUBSURF': m.levels = m.render_levels
                else: m.show_viewport = False
        dg = bpy.context.evaluated_depsgraph_get(); dg.update()
        ev = ob.evaluated_get(dg); me = ev.to_mesh()
        M = ob.matrix_world
        self.verts = [M @ v.co for v in me.vertices]
        me.calc_loop_triangles()
        self.tris = [t.vertices[:] for t in me.loop_triangles]
        ev.to_mesh_clear()
        for m, v in zip(ob.modifiers, vis): m.show_viewport = v
        self.bvh = BVHTree.FromPolygons(self.verts, self.tris)
        self.axis_y = axis_y

    def _out(self, loc, n):
        r = np.array([loc[0], loc[1] - self.axis_y, 0.0])
        return n if n @ r >= 0 else -n

    def near(self, p):
        loc, n, i, d = self.bvh.find_nearest(Vector(p))
        loc, n = np.array(loc), np.array(n)
        return loc, self._out(loc, n)

    def ray(self, o, d, dist=1.0):
        loc, n, i, t = self.bvh.ray_cast(Vector(o), Vector(d), dist)
        if loc is None: return None, None
        loc, n = np.array(loc), np.array(n)
        return loc, self._out(loc, n)


def resample(pts, step):
    pts = np.asarray(pts, float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    n = max(2, int(s[-1] / step) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, i]) for i in range(3)], 1)


def smooth_path(P, it=3, closed=False):
    P = P.copy()
    for _ in range(it):
        if closed:
            P = 0.25 * np.roll(P, 1, 0) + 0.5 * P + 0.25 * np.roll(P, -1, 0)
        else:
            P[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    return P


def drape(surf, pts, clear, step=0.006, it=4, closed=False, bridge=6):
    """Path laid on the surface: resampled, projected, pushed out by clear, smoothed so it bridges folds (a strap under
    tension spans the hollows), re-projected so it never sinks below surface + clear."""
    P = resample(pts, step)
    N = np.zeros_like(P)
    for _ in range(it):
        for i, p in enumerate(P):
            loc, n = surf.near(p)
            N[i] = n
            if (p - loc) @ n < clear: P[i] = loc + n * clear
        P = smooth_path(P, bridge, closed)
    for i, p in enumerate(P):
        loc, n = surf.near(p); N[i] = n
        if (p - loc) @ n < clear: P[i] = loc + n * clear
    N = smooth_path(N, 3, closed); N /= np.linalg.norm(N, axis=1, keepdims=True)
    return P, N


def ribbon(name, P, N, width, thick, mat, closed=False, coll=None, twist_free=True, edge_stitch=True):
    """Strap mesh from a path + surface normals: width across, thickness out of the surface; UV U = arc length (m),
    V = across (m); attributes seam/stitch draw edge stitching rows."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    n = len(P)
    T = np.gradient(P, axis=0)
    if closed:
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    S = np.cross(N, T); S /= np.linalg.norm(S, axis=1, keepdims=True) + 1e-12
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    cols = [-0.5, -0.42, 0.42, 0.5]
    V = []
    for i in range(n):
        row = []
        for c in cols:
            row.append(bm.verts.new(tuple(P[i] + S[i] * c * width)))
        V.append(row)
    m = n if closed else n - 1
    for i in range(m):
        j = (i + 1) % n
        for c in range(len(cols) - 1):
            f = bm.faces.new((V[i][c], V[i][c + 1], V[j][c + 1], V[j][c]))
            for lp, (ii, cc) in zip(f.loops, ((i, c), (i, c + 1), (j, c + 1), (j, c))):
                lp[uvl].uv = (arc[ii] if not (closed and ii == 0 and i == n - 1) else arc[-1] + np.linalg.norm(P[0] - P[-1]), cols[cc] * width)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    # seam (stitch rows ~3 mm inside each edge) + stitch running coordinate
    sa = me.attributes.new('seam', 'FLOAT', 'POINT'); st = me.attributes.new('stitch', 'FLOAT', 'POINT')
    for i in range(n):
        for k, c in enumerate(cols):
            vi = i * len(cols) + k
            sa.data[vi].value = 0.45 if (edge_stitch and k in (1, 2)) else 0.0
            st.data[vi].value = arc[i]
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = thick; sd.offset = 1.0; sd.use_quality_normals = True
    bv = ob.modifiers.new('bv', 'BEVEL'); bv.width = min(thick * 0.35, 0.0009); bv.segments = 2; bv.limit_method = 'ANGLE'
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    ob.data.materials.append(mat)
    return ob


def frame_at(surf, p, up=(0, 0, 1)):
    """Local frame on the surface at p: z = surface normal, y = up projected, x = y cross z."""
    loc, n = surf.near(p)
    z = n / np.linalg.norm(n)
    y = np.array(up, float) - z * (np.array(up, float) @ z); y /= np.linalg.norm(y)
    x = np.cross(y, z)
    return loc, x, y, z


def mat4(o, x, y, z):
    return Matrix(((x[0], y[0], z[0], o[0]), (x[1], y[1], z[1], o[1]), (x[2], y[2], z[2], o[2]), (0, 0, 0, 1)))


def rounded_box(name, sx, sy, sz, r, mat, coll=None, bulge=0.0, seg=3, stitch=False, cuts=0):
    """Box centred on x/y, from z=0 (back) to z=sz (front), rounded edges (bevel) + a soft front bulge; stitch=True
    writes seam/stitch attributes for a row of stitching 4 mm in from every edge (webbing pouches, lids)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts or stitch:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts or 10, use_grid_fill=True)
    for v in bm.verts:
        v.co.x *= sx; v.co.y *= sy; v.co.z = (v.co.z + 0.5) * sz
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    bv = ob.modifiers.new('bv', 'BEVEL'); bv.width = r; bv.segments = seg
    ob.data.materials.append(mat)
    if bulge or stitch:
        bpy.context.view_layer.objects.active = ob
        for m_ in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m_.name)
        if stitch:
            sa = ob.data.attributes.new('seam', 'FLOAT', 'POINT'); st = ob.data.attributes.new('stitch', 'FLOAT', 'POINT')
            for v in ob.data.vertices:
                d = sorted((sx / 2 - abs(v.co.x), sy / 2 - abs(v.co.y), min(v.co.z, sz - v.co.z)))
                e = d[1]
                sa.data[v.index].value = max(0.0, 0.45 - abs(e - 0.0045) * 70) if e < 0.008 else 0.0
                st.data[v.index].value = v.co.x + v.co.y + v.co.z
        if bulge:
            for v in ob.data.vertices:
                u, w = v.co.x / (sx / 2), v.co.y / (sy / 2)
                f = max(0.0, 1 - u * u) * max(0.0, 1 - w * w)
                if v.co.z > sz * 0.5: v.co.z += bulge * f
        sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    else:
        sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
    for p in ob.data.polygons: p.use_smooth = True
    return ob


def brass_buckle(name, w, h, bar, thick, mat, coll=None):
    """Rectangular brass buckle frame (outer w x h, bar width), lying in x/y, z out."""
    bm = bmesh.new()
    outer = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    inner = [(-w / 2 + bar, -h / 2 + bar), (w / 2 - bar, -h / 2 + bar), (w / 2 - bar, h / 2 - bar), (-w / 2 + bar, h / 2 - bar)]
    lo_o = [bm.verts.new((x, y, 0)) for x, y in outer]; hi_o = [bm.verts.new((x, y, thick)) for x, y in outer]
    lo_i = [bm.verts.new((x, y, 0)) for x, y in inner]; hi_i = [bm.verts.new((x, y, thick)) for x, y in inner]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((hi_o[i], hi_o[j], hi_i[j], hi_i[i]))
        bm.faces.new((lo_o[j], lo_o[i], lo_i[i], lo_i[j]))
        bm.faces.new((lo_o[i], lo_o[j], hi_o[j], hi_o[i]))
        bm.faces.new((lo_i[j], lo_i[i], hi_i[i], hi_i[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    bv = ob.modifiers.new('bv', 'BEVEL'); bv.width = thick * 0.3; bv.segments = 3
    ob.data.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob


def cylinder(name, r, length, mat, coll=None, seg=24, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r2 if r2 is not None else r, depth=length)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    ob.data.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob


def place(ob, M):
    ob.matrix_world = M


# ---------------------------------------------------------------------------------------------- pieces
def ring_on(surf, centre, z, n=128, up=(0, 0, 1)):
    """Closed path round a body at height z: rays from centre outward (horizontal) to the surface."""
    pts, nrm = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = np.array([math.cos(a), math.sin(a), 0.0])
        o = np.array([centre[0], centre[1], z])
        loc, nn = surf.ray(o, d, 0.6)
        if loc is None:
            loc, nn = surf.near(o + d * 0.2)
        pts.append(loc); nrm.append(d)                      # a belt's normal stays horizontal (blousing above it is not)
    return np.array(pts), np.array(nrm)


def belt(surf, centre, z, mat, brass, coll=None, width=0.057, thick=0.0032, clear=0.0016):
    P, N = ring_on(surf, centre, z)
    P = P + N * clear
    P = smooth_path(P, 6, closed=True)
    # never inside the cloth after smoothing
    for i in range(len(P)):
        loc, n = surf.near(P[i])
        if (P[i] - loc) @ n < clear: P[i] = loc + n * clear
    ob = ribbon('belt', P, N, width, thick, mat, closed=True, coll=coll)
    # front: the brass buckle (frame + bar) a little left of centre, the belt end's brass tip beside it
    k = int(np.argmin(np.abs(np.arctan2(P[:, 1] - centre[1], P[:, 0] - centre[0]) + math.pi / 2 - 0.0)))
    front = P[k]
    t = P[(k + 1) % len(P)] - P[k - 1]; t /= np.linalg.norm(t)
    nz = N[k] / np.linalg.norm(N[k]); ny = np.array([0, 0, 1.0]); nx = np.cross(ny, nz)
    bk = brass_buckle('belt_buckle', 0.066, 0.05, 0.0075, 0.0035, brass, coll)
    bk.matrix_world = mat4(front + nz * (thick + 0.0004), nx, ny, nz)
    tip = rounded_box('belt_tip', 0.022, 0.054, 0.0018, 0.0006, brass, coll)
    tip.matrix_world = mat4(front + nx * 0.052 + nz * (thick + 0.0008), nx, ny, nz)
    return ob, (front, nx, ny, nz)


def flap(name, w, h, d, drop, mat, coll=None, r=0.018, thick=0.003):
    """Pouch lid: one piece of webbing from the pouch's back top edge, over the top and down the front (drop),
    corners rounded, the front standing a few mm off the pouch; stitched round its edge."""
    prof = [(h - 0.004, 0.006), (h + 0.002, 0.012), (h + 0.006, d * 0.35), (h + 0.007, d * 0.7), (h + 0.004, d - 0.004),
            (h - 0.004, d + 0.002), (h - 0.016, d + 0.004)]
    k = 10
    for i in range(1, k + 1):
        prof.append((h - 0.016 - (drop - 0.016) * i / k, d + 0.004 + 0.0015 * math.sin(math.pi * i / k)))
    nx = 32
    bm = bmesh.new()
    rows = []
    for j in range(nx + 1):
        xx = -w / 2 + w * j / nx
        cut = 0.0
        e = abs(xx) - (w / 2 - r)
        if e > 0: cut = r - math.sqrt(max(0.0, r * r - e * e))
        row = []
        for (yy, zz) in prof:
            if yy < h - 0.02: yy = max(yy, h - drop + cut)
            row.append(bm.verts.new((xx, yy, zz)))
        rows.append(row)
    for j in range(nx):
        for i in range(len(prof) - 1):
            bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    sa = me.attributes.new('seam', 'FLOAT', 'POINT'); st = me.attributes.new('stitch', 'FLOAT', 'POINT')
    for v in me.vertices:
        de = min(w / 2 - abs(v.co.x), v.co.y - (h - drop)) if v.co.z > d - 0.01 else 1.0
        sa.data[v.index].value = max(0.0, 0.45 - abs(de - 0.005) * 70) if de < 0.009 else 0.0
        st.data[v.index].value = v.co.x + v.co.y
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = thick; sd.offset = -1
    bv = ob.modifiers.new('bv', 'BEVEL'); bv.width = 0.0008; bv.segments = 2; bv.limit_method = 'ANGLE'
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    ob.data.materials.append(mat)
    return ob


def pouch(name, surf, at, side, mat, brass, coll=None, w=0.112, h=0.114, d=0.056, axis_y=-0.025):
    """P37 basic pouch hooked on the belt, its back on the chest: body + lid flap + press stud + top buckle.
    Sized to the real thing (~11 cm wide x ~15 cm tall on the man) — the first build's 150 x 190 mm read
    gigantic on screen (~13 x 28 cm in figure proportion)."""
    loc, x, y, z = frame_at(surf, at)
    out = np.array([loc[0], loc[1] - axis_y, 0.0]); out /= np.linalg.norm(out)
    # tilt with the chest: average outward normal over the pouch footprint
    ns = []
    for u in (-0.06, 0.0, 0.06):
        for v in (0.0, 0.045, 0.09):
            l2, n2 = surf.near(loc + x * u + y * v)
            ns.append(n2 if n2 @ out > 0 else -n2)
    z = np.mean(ns, 0); z /= np.linalg.norm(z)
    y = np.array([0, 0, 1.0]) - z * z[2]; y /= np.linalg.norm(y); x = np.cross(y, z)
    # sit the back on the cloth: push out until the back corners clear it
    o = loc.copy()
    for _ in range(12):
        worst = 0.0
        for u in (-w / 2, 0, w / 2):
            for v in (0.0, h / 2, h):
                p = o + x * u + y * v
                l2, n2 = surf.near(p)
                if n2 @ z < 0: n2 = -n2
                worst = min(worst, (p - l2) @ n2 - 0.0045)
        if worst >= 0: break
        o = o - z * worst
    boxm = bpy.data.materials.get('webbing_box') or mats.webbing_box()
    # each pouch settles differently under its load: stable per-side seed, a whisper of size difference
    rng = np.random.default_rng(7101 if side > 0 else 4102)
    w, h, d = w * (1 + 0.008 * (rng.random() - 0.5)), h * (1 + 0.008 * (rng.random() - 0.5)), d * (1 + 0.012 * (rng.random() - 0.5))
    box = rounded_box(name, w, h, d, 0.016, boxm, coll, bulge=0.006, stitch=True, cuts=16)
    # contents and gravity: two magazines stand in the pouch (soft ridges on the front); the loaded front bellies
    # low, the bottom swings off the body and dips between its corners, the sides crease and draw in a little
    ph = rng.uniform(0, 6.28, 4)
    belly = 0.006 + 0.002 * rng.random()
    sag = 0.0028 + 0.0018 * rng.random()
    hang = 0.0035 + 0.002 * rng.random()
    ridge_c = (-0.42 + 0.09 * (rng.random() - 0.5), 0.42 + 0.09 * (rng.random() - 0.5))
    ridge_a = 0.0034 + 0.0015 * rng.random()
    for v in box.data.vertices:
        u, t = v.co.x / (w / 2), v.co.y / (h / 2)
        low = max(0.0, (-t - 0.45) / 0.55)                       # 0 mid-height -> 1 at the bottom edge
        if v.co.z > d * 0.45:
            front = (v.co.z / d - 0.45) / 0.55
            ridge = sum(math.exp(-((u - c) / 0.3) ** 2) for c in ridge_c)
            v.co.z += ridge_a * ridge * max(0.0, 1 - t * t) ** 0.5
            v.co.z += belly * math.exp(-((t + 0.30) / 0.62) ** 2) * max(0.0, 1 - u * u) ** 0.6 * front
            v.co.z -= 0.0020 * math.exp(-((abs(u) - 0.86) / 0.09) ** 2) * max(0.0, -t) * front   # side creases
        v.co.z += 0.0021 * math.sin(u * 2.3 + ph[0]) * math.sin(t * 1.7 + ph[1])
        v.co.z += 0.0011 * math.sin(u * 5.1 + ph[2]) * math.sin(t * 3.9 + ph[3])
        v.co.z += hang * low * low * (v.co.z / d)                # the bottom swings out under its own weight
        if t < -0.5:
            v.co.y -= sag * ((-t - 0.5) / 0.5) ** 2 * (1 - u * u)   # bottom centre dips between the corners
            v.co.x *= 1 - 0.045 * low                            # sides draw in toward the bottom
    box.matrix_world = mat4(o + y * 0.0, x, y, z)
    for v in box.data.vertices: v.co.y += h / 2           # origin at the bottom centre
    lid = flap(name + '_lid', w + 0.008, h, d + 0.012, 0.048, boxm, coll)
    lid.matrix_world = box.matrix_world.copy()
    # the lid settles with the body: it follows the belly where it crosses the front, and its free edge dips
    # lowest mid-width and kicks off the front a little, like cloth held by the press stud
    for v in lid.data.vertices:
        u = v.co.x / (w / 2)
        tf = v.co.y / h
        front = max(0.0, (v.co.z / (d + 0.012) - 0.45) / 0.55)
        v.co.z += belly * math.exp(-((2 * tf - 1 + 0.30) / 0.62) ** 2) * max(0.0, 1 - u * u) ** 0.6 * front
        if v.co.y < h - 0.02:
            dropf = min(1.0, (h - 0.02 - v.co.y) / 0.048)
            v.co.y -= 0.0032 * dropf * (1 - u * u)
            v.co.z += 0.0022 * dropf * dropf
    stud = cylinder(name + '_stud', 0.0065, 0.004, brass, coll, seg=20)
    belly_s = belly * math.exp(-(((h - 0.040) / h * 2 - 1 + 0.30) / 0.62) ** 2)
    stud.matrix_world = mat4(o + y * (h - 0.040) + z * (d + 0.0205 + belly_s), x, y, z)
    bk = brass_buckle(name + '_buckle', 0.032, 0.03, 0.0045, 0.003, brass, coll)
    top = o + y * (h + 0.004) + z * (d * 0.35) + x * (side * w * 0.3)
    bk.matrix_world = mat4(top + y * 0.002, x, y, z)
    return box, lid, (o, x, y, z), top


def brace(name, surf, pts, mat, coll=None, width=0.025, thick=0.0028, clear=0.0018):
    P, N = drape(surf, pts, clear, step=0.006, bridge=8)
    return ribbon(name, P, N, width, thick, mat, coll=coll), P, N
