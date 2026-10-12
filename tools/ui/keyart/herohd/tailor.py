"""Tailoring on the simulated garments (world space, pose B): the smock's fold-down collar and the opened zip along the
V, rolled sleeves (two turns of fabric showing the paler inside), patch pockets with flaps and press studs, the knit
jersey neckband under the V. Pieces are built from the garment's boundary loops and surface (kit.Surface)."""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
import kit, mats


def boundary_loops(ob):
    """Ordered boundary loops of a mesh: list of vertex-index lists."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    nb = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts[0].index, e.verts[1].index
            nb.setdefault(a, []).append(b); nb.setdefault(b, []).append(a)
    bm.free()
    loops, seen = [], set()
    for start in nb:
        if start in seen: continue
        loop = [start]; seen.add(start); prev, cur = None, start
        while True:
            nxt = [x for x in nb[cur] if x != prev and x not in seen]
            if not nxt: break
            prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    return loops


def loop_frames(ob, loop):
    """Per loop vertex: position, outward surface normal N, 'up' U (from the cloth toward the edge, in the surface)."""
    me = ob.data
    M = ob.matrix_world
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.normal_update()
    P, N, U = [], [], []
    inset = set(loop)
    for i in loop:
        v = bm.verts[i]
        p = np.array(M @ v.co)
        n = np.array(M.to_3x3() @ v.normal); n /= np.linalg.norm(n) + 1e-12
        inner = [np.array(M @ e.other_vert(v).co) for e in v.link_edges if e.other_vert(v).index not in inset]
        u = p - np.mean(inner, 0) if inner else np.array([0, 0, 1.0])
        u -= n * (u @ n); u /= np.linalg.norm(u) + 1e-12
        P.append(p); N.append(n); U.append(u)
    bm.free()
    return np.array(P), np.array(N), np.array(U)


def resample_loop(P, N, U, step, closed=True):
    Q = np.vstack([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    n = max(8, int(s[-1] / step))
    t = np.linspace(0, s[-1], n, endpoint=not closed)
    def interp(A):
        A2 = np.vstack([A, A[:1]]) if closed else A
        return np.stack([np.interp(t, s, A2[:, i]) for i in range(3)], 1)
    P2, N2, U2 = interp(P), interp(N), interp(U)
    N2 /= np.linalg.norm(N2, axis=1, keepdims=True); U2 /= np.linalg.norm(U2, axis=1, keepdims=True)
    return P2, N2, U2, t


def strip_mesh(name, rows, closed=True, coll=None, uv_scale=1.0):
    """Quad strip from rows (n, k, 3): n along the loop, k across the profile; UV U = arc, V = profile index."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    n, k = rows.shape[:2]
    V = [[bm.verts.new(tuple(rows[i, j])) for j in range(k)] for i in range(n)]
    m = n if closed else n - 1
    for i in range(m):
        i2 = (i + 1) % n
        for j in range(k - 1):
            f = bm.faces.new((V[i][j], V[i2][j], V[i2][j + 1], V[i][j + 1]))
            for lp, (a, b) in zip(f.loops, ((i, j), (i2, j), (i2, j + 1), (i, j + 1))):
                lp[uvl].uv = (a * uv_scale, b / (k - 1))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob


def collar(smock, mat, neck_z, eye_y, coll=None, rng=None):
    """Fold-down collar along the neckline + V: a stand rising up the neck, folded over and lying on the shoulders;
    along the V it narrows into the zip facings, turned slightly out."""
    loops = boundary_loops(smock)
    M = smock.matrix_world
    best = None
    for L in loops:
        z = np.mean([(M @ smock.data.vertices[i].co).z for i in L])
        if best is None or abs(z - neck_z) < abs(best[0] - neck_z): best = (z, L)
    P, N, U = loop_frames(smock, best[1])
    P, N, U, t = resample_loop(P, N, U, 0.004)
    # smooth frames
    for _ in range(6):
        N = 0.25 * np.roll(N, 1, 0) + 0.5 * N + 0.25 * np.roll(N, -1, 0)
        U = 0.25 * np.roll(U, 1, 0) + 0.5 * U + 0.25 * np.roll(U, -1, 0)
    N /= np.linalg.norm(N, axis=1, keepdims=True); U /= np.linalg.norm(U, axis=1, keepdims=True)
    zmax = P[:, 2].max()
    rows = []
    for i in range(len(P)):
        depth = np.clip((zmax - P[i, 2]) / 0.12, 0, 1)          # 0 round the neck, 1 at the V bottom
        stand = 0.026 * (1 - depth) ** 1.5 + 0.002
        fall = 0.048 * (1 - depth) + 0.012 * depth
        out = 0.004 + 0.003 * (1 - depth)
        p, n, u = P[i], N[i], U[i]
        prof = [p - u * 0.002,
                p + u * stand * 0.5 + n * 0.0015,
                p + u * stand + n * 0.003,
                p + u * (stand + 0.002) + n * (out + 0.002),        # the fold
                p + u * stand * 0.6 + n * (out + 0.006),
                p - u * (fall - stand) * 0.5 + n * (out + 0.006),
                p - u * (fall - stand) + n * (out + 0.004)]          # collar point / edge lying on the cloth
        rows.append(prof)
    ob = strip_mesh('collar', np.array(rows), coll=coll)
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.0022; sd.offset = 1
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    ob.data.materials.append(mat)
    # seam along the collar edge: stitched 4 mm in from the outer (fall) edge
    a = ob.data.attributes.new('seam', 'FLOAT', 'POINT'); st = ob.data.attributes.new('stitch', 'FLOAT', 'POINT')
    k = 7
    for i in range(len(P)):
        for j in range(k):
            a.data[i * k + j].value = 0.45 if j in (5,) else (0.2 if j == 6 else 0.0)
            st.data[i * k + j].value = t[i]
    return ob, (P, N, U, t)


def zip_teeth(smock, collar_frames, metal, coll=None, below=0.15):
    """Brass zip: teeth along both V edges, then closed down the front below the V, with the slider at the V bottom."""
    P, N, U, t = collar_frames
    zmax = P[:, 2].max()
    bm = bmesh.new()
    sel = [i for i in range(len(P)) if zmax - P[i, 2] > 0.03]
    tooth = 0.0032
    last = None
    acc = 0.0
    for i in sel:
        if last is not None:
            acc += np.linalg.norm(P[i] - P[last])
            if acc < tooth: continue
            acc = 0.0
        last = i
        c = P[i] + N[i] * 0.0012 - U[i] * 0.001
        tv = np.cross(N[i], U[i])
        verts = [bm.verts.new(tuple(c + tv * sx * 0.0011 + U[i] * sy * 0.0022 + N[i] * sz * 0.0016))
                 for sx, sy, sz in ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([verts[j] for j in f])
    # V bottom: slider + pull
    ib = max(range(len(P)), key=lambda i: zmax - P[i, 2])
    vb = P[ib] + N[ib] * 0.002
    me = bpy.data.meshes.new('zip'); bm.to_mesh(me); bm.free()
    z = bpy.data.objects.new('zip', me); (coll or bpy.context.scene.collection).objects.link(z)
    z.data.materials.append(metal)
    bv = z.modifiers.new('bv', 'BEVEL'); bv.width = 0.0004; bv.segments = 2
    # closed zip down the front below the V: a row of interlocked teeth on the cloth surface
    surf = kit.Surface(smock)
    path = [vb - np.array([0, 0, d]) for d in np.linspace(0.0, below, 40)]
    Pz, Nz = kit.drape(surf, path, 0.0015, step=0.0032, bridge=4)
    tape = kit.ribbon('zip_tape', Pz, Nz, 0.009, 0.0012, metal, coll=coll, edge_stitch=False)
    slider = kit.rounded_box('zip_slider', 0.009, 0.016, 0.004, 0.0015, metal, coll)
    n0 = Nz[0]; y0 = np.array([0, 0, 1.0]) - n0 * n0[2]; y0 /= np.linalg.norm(y0); x0 = np.cross(y0, n0)
    slider.matrix_world = kit.mat4(Pz[0] - y0 * 0.006, x0, y0, n0)
    pull = kit.rounded_box('zip_pull', 0.007, 0.022, 0.0015, 0.0006, metal, coll)
    pull.matrix_world = kit.mat4(Pz[0] - y0 * 0.024 + n0 * 0.004, x0, y0, n0)
    return z, tape


def rolled_sleeve(smock, arm_axis, mat, coll=None, seed=0):
    """Two turns of rolled fabric at a sleeve end (the loop nearest the elbow end of arm_axis = (head, dir, L))."""
    loops = boundary_loops(smock)
    M = smock.matrix_world
    h, ax, L = arm_axis
    end = h + ax * L * 0.74
    best = None
    for lp in loops:
        c = np.mean([np.array(M @ smock.data.vertices[i].co) for i in lp], 0)
        d = np.linalg.norm(c - end)
        if best is None or d < best[0]: best = (d, lp)
    P, N, U = loop_frames(smock, best[1])
    P, N, U, t = resample_loop(P, N, U, 0.004)
    for _ in range(4):
        N = 0.25 * np.roll(N, 1, 0) + 0.5 * N + 0.25 * np.roll(N, -1, 0)
        U = 0.25 * np.roll(U, 1, 0) + 0.5 * U + 0.25 * np.roll(U, -1, 0)
    N /= np.linalg.norm(N, axis=1, keepdims=True); U /= np.linalg.norm(U, axis=1, keepdims=True)
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 4)
    obs = []
    for layer, (off_u, r0) in enumerate(((-0.010, 0.0078), (-0.026, 0.0064))):
        K = 16
        rows = []
        n = len(P)
        for i in range(n):
            a = 2 * math.pi * i / n
            lump = 1 + 0.22 * math.sin(a * 3 + ph[0] + layer) + 0.12 * math.sin(a * 7 + ph[1]) + 0.08 * math.sin(a * 13 + ph[2])
            ru, rn = r0 * 1.5 * lump, r0 * 0.6 * lump
            c = P[i] + U[i] * off_u + N[i] * (rn + 0.0015)
            ring = [c + U[i] * ru * math.cos(2 * math.pi * j / K) + N[i] * rn * math.sin(2 * math.pi * j / K) for j in range(K)]
            rows.append(ring)
        R = np.array(rows)
        bm = bmesh.new()
        V = [[bm.verts.new(tuple(R[i, j])) for j in range(K)] for i in range(n)]
        for i in range(n):
            for j in range(K):
                bm.faces.new((V[i][j], V[(i + 1) % n][j], V[(i + 1) % n][(j + 1) % K], V[i][(j + 1) % K]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('roll'); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new('sleeve_roll', me); (coll or bpy.context.scene.collection).objects.link(ob)
        for p in me.polygons: p.use_smooth = True
        # creases: the rolled cloth folds over itself every few cm (a cellular dent pattern)
        sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
        tex = bpy.data.textures.get('roll_creases') or bpy.data.textures.new('roll_creases', 'VORONOI')
        tex.noise_scale = 0.012
        dp = ob.modifiers.new('creases', 'DISPLACE'); dp.texture = tex; dp.strength = -0.0025; dp.mid_level = 0.0
        dp.texture_coords = 'GLOBAL'
        ob.data.materials.append(mat)
        obs.append(ob)
    return obs


def patch(name, surf, centre, w, h, mat, coll=None, up=(0, 0, 1), clear=0.0012, res=0.003, bulge=0.004, flap=False):
    """Patch pocket / flap laid on the cloth: a grid projected along the surface normal at its centre, a soft bulge,
    stitched 4 mm in from the edge (seam/stitch attributes)."""
    loc, x, y, z = kit.frame_at(surf, centre, up)
    nu, nv = max(4, int(w / res)), max(4, int(h / res))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    V = []
    seam_v, stitch_v = [], []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u, v = (i / nu - 0.5) * w, (j / nv - 0.5) * h
            if flap:                                              # flap: pointed bottom edge
                v_low = -h / 2 + 0.012 * (1 - abs(2 * i / nu - 1))
                v = v_low + (j / nv) * (h / 2 - v_low)
            p0 = loc + x * u + y * v + z * 0.05
            hit, n = surf.ray(p0, -z, 0.075)
            if hit is None or (hit - (loc + x * u + y * v)) @ z < -0.03: hit, n = surf.near(loc + x * u + y * v)
            b = bulge * max(0.0, 1 - (2 * i / nu - 1) ** 2) * max(0.0, 1 - (2 * j / nv - 1) ** 2)
            p = hit + n * (clear + b)
            row.append(bm.verts.new(tuple(p)))
            de = min(i / nu * w, (1 - i / nu) * w, j / nv * h, (1 - j / nv) * h)
            seam_v.append(max(0.0, 0.45 - abs(de - 0.004) * 40) if de < 0.012 else 0.0)
            stitch_v.append(u if min(j / nv * h, (1 - j / nv) * h) < min(i / nu * w, (1 - i / nu) * w) else v)
        V.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
            for lp, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uvl].uv = (a / nu * w, b / nv * h)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    sa = me.attributes.new('seam', 'FLOAT', 'POINT'); st = me.attributes.new('stitch', 'FLOAT', 'POINT')
    for k in range(len(seam_v)): sa.data[k].value = seam_v[k]; st.data[k].value = stitch_v[k]
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.0018; sd.offset = 1
    bv = ob.modifiers.new('bv', 'BEVEL'); bv.width = 0.0006; bv.segments = 2; bv.limit_method = 'ANGLE'
    ob.data.materials.append(mat)
    return ob, (loc, x, y, z)
