"""The green beret: an analytic felt shell round a band fitted to the rest-pose head (the band is the head's section
by a tilted plane, pushed out 4 mm), the crown pulled down over the right ear and tight over the left eye where a
brass cap badge sits (a generic badge: crowned oval with a dagger, no real regiment's), a black leather binding with
the drawstring bow at the back. Built on the rest-pose head; dress.py carries it into the pose with the head bone."""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
import mats


def head_points(body):
    co = np.array([v.co for v in body.data.vertices]) @ np.array(body.matrix_world)[:3, :3].T + np.array(body.matrix_world)[:3, 3]
    gi = body.vertex_groups['head'].index
    w = np.zeros(len(co))
    for v in body.data.vertices:
        for g in v.groups:
            if g.group == gi: w[v.index] = g.weight
    return co, w


def band_ring(bvh, c, n_, n=128, offset=0.004):
    """Skull contour in the plane (c, n_) by ray casts from the centre (the first hit is the scalp, never an ear),
    smoothed and pushed out by offset."""
    ex = np.array([1.0, 0, 0]) - n_ * n_[0]; ex /= np.linalg.norm(ex)
    ey = np.cross(n_, ex)
    th = -math.pi + 2 * math.pi * np.arange(n) / n
    rr = np.zeros(n)
    for k in range(n):
        d = ex * math.cos(th[k]) + ey * math.sin(th[k])
        hit = bvh.ray_cast(Vector(c), Vector(d), 0.3)[0]
        rr[k] = (Vector(c) - hit).length if hit is not None else 0.08
    for _ in range(3): rr = 0.25 * np.roll(rr, 1) + 0.5 * rr + 0.25 * np.roll(rr, -1)
    rr += offset
    pts = c + np.outer(rr * np.cos(th), ex) + np.outer(rr * np.sin(th), ey)
    return pts, th, rr, ex, ey


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return (u ** 3)[:, None] * p0 + (3 * u * u * t)[:, None] * p1 + (3 * u * t * t)[:, None] * p2 + (t ** 3)[:, None] * p3


def build(body, rig, eyes_z, brow_front_y, coll=None, seed=3):
    """Returns (beret_obj, band_obj, badge_root, info). eyes_z: rest z of the eye centres."""
    from mathutils.bvhtree import BVHTree
    co, w = head_points(body)
    me0 = body.data; me0.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([Vector(p) for p in co], [t.vertices[:] for t in me0.loop_triangles])
    hp = co[w > 0.5]
    top = hp[np.argmax(hp[:, 2])]
    # band plane: ~5 cm above the eyes at the front, above the ears at the sides, low at the back
    # band plane through the forehead (2.5 cm above the brows) and the occiput (just above eye level, behind)
    yf = brow_front_y - 0.01
    yb = top[1] + 0.09
    zf, zb = eyes_z + 0.047, eyes_z + 0.004
    c = np.array([0.0, 0.5 * (yf + yb), 0.5 * (zf + zb)])
    n_ = np.array([0.0, (zf - zb) / (yb - yf), 1.0]); n_ /= np.linalg.norm(n_)
    ring, th, rr, ex, ey = band_ring(bvh, c, n_)
    n = len(th)
    K = 30
    # th: 0 = +x (character's left), +90deg = +y (back), -90 = front
    right = 0.5 * (1 - np.cos(th)) ** 1.0                # 1 on the character's right
    back = 0.5 * (1 + np.sin(th))
    badge = np.exp(-((np.angle(np.exp(1j * (th - math.radians(-62))))) / 0.6) ** 2)
    pouf = 0.008 + 0.075 * right ** 1.5 + 0.022 * back * (1 - right) + 0.012 * (1 - badge)   # outward fullness
    phi0 = 0.30 + 0.10 * right                           # elevation (rad) of the fullest point
    droop = 0.030 * right ** 2                           # the fullness sags down on the right
    ctr = c + n_ * 0.02
    G = np.zeros((n, K, 3))
    for k in range(n):
        rad = (ring[k] - c); rad /= np.linalg.norm(rad)
        for j in range(K):
            phi = (math.pi / 2) * (j / (K - 1)) ** 0.9
            d = rad * math.cos(phi) + n_ * math.sin(phi)
            if j == K - 1: d = n_ + rad * 1e-3
            hit, nrm, _, _ = bvh.ray_cast(Vector(ctr), Vector(d / np.linalg.norm(d)), 0.3)
            if j == 0 or hit is None:
                S = ring[k] + n_ * 0.002 if j == 0 else ctr + d * 0.1
                N = rad
            else:
                S = np.array(hit); N = np.array(nrm)
            bump = math.exp(-((phi - phi0[k]) / 0.42) ** 2) * min(1.0, phi / 0.16)
            if phi > phi0[k]: bump = max(bump, 0.75 * math.exp(-((phi - phi0[k]) / 0.9) ** 2))
            clr = 0.003 + 0.006 * min(1.0, phi / 0.3) + pouf[k] * bump
            P = S + N * clr - n_ * droop[k] * bump
            G[k, j] = P
    # the crown is a stretched felt disc: a smooth min against a plane tilted down to the right
    tn = n_ + ex * 0.42 + ey * 0.05; tn /= np.linalg.norm(tn)
    sk = np.array([np.array(bvh.ray_cast(Vector(ctr), Vector(n_), 0.3)[0])])[0]
    tp = sk + tn * 0.014
    kk = 0.012
    for k in range(n):
        for j in range(K):
            h = (G[k, j] - tp) @ tn
            hm = 0.5 * (h + 0.0) - 0.5 * math.sqrt(h * h + kk * kk)          # smooth min(h, 0)
            G[k, j] -= tn * (h - hm) * min(1.0, j / 6)
    # felt: gentle irregular folds from the gathered band (low amplitude, mixed frequencies)
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 8)
    for k in range(n):
        rad = (ring[k] - c); rad /= np.linalg.norm(rad)
        for j in range(1, K - 1):
            s_ = j / (K - 1)
            f = (math.sin(th[k] * 7 + ph[0] + s_ * 3) * 0.5 + math.sin(th[k] * 3 + ph[1] - s_ * 2) * 0.7
                 + math.sin(th[k] * 13 + ph[2] + s_ * 6) * 0.25)
            amp = 0.0016 * math.sin(math.pi * min(1.0, s_ * 1.4)) * (0.3 + 0.7 * right[k]) * (1 - 0.7 * badge[k])
            G[k, j] += rad * amp * f
    # mesh: grid (n around x K up), the centre closed with a fan
    bm = bmesh.new()
    V = [[bm.verts.new(tuple(G[k, j])) for j in range(K)] for k in range(n)]
    for k in range(n):
        for j in range(K - 2):
            bm.faces.new((V[k][j], V[(k + 1) % n][j], V[(k + 1) % n][j + 1], V[k][j + 1]))
    cen = bm.verts.new(tuple(G[:, -1].mean(0)))
    for k in range(n):
        bm.faces.new((V[k][K - 2], V[(k + 1) % n][K - 2], cen))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('beret'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('beret', me); (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    # make normals point outward (away from the head centre)
    hc = c + n_ * 0.02
    me.calc_loop_triangles() if hasattr(me, 'calc_loop_triangles') else None
    out = sum(1 for p in me.polygons if (np.array(p.center) - hc) @ np.array(p.normal) > 0)
    if out < len(me.polygons) / 2:
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.reverse_faces(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    smo = ob.modifiers.new('smooth', 'SMOOTH'); smo.factor = 0.6; smo.iterations = 3
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.003; sd.offset = -1
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    ob.data.materials.append(mats.felt())
    # leather binding: a strip round the band ring, 12 mm tall, 1.5 mm proud
    bm = bmesh.new()
    lo = [bm.verts.new(tuple(ring[k] + (ring[k] - c) / np.linalg.norm(ring[k] - c) * 0.0012 - n_ * 0.001)) for k in range(n)]
    hi = [bm.verts.new(tuple(ring[k] + (ring[k] - c) / np.linalg.norm(ring[k] - c) * 0.0015 + n_ * 0.012)) for k in range(n)]
    for k in range(n):
        bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me2 = bpy.data.meshes.new('beret_band'); bm.to_mesh(me2); bm.free()
    band = bpy.data.objects.new('beret_band', me2); (coll or bpy.context.scene.collection).objects.link(band)
    for p in me2.polygons: p.use_smooth = True
    sd = band.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = 0.0018; sd.offset = 1
    bv = band.modifiers.new('bv', 'BEVEL'); bv.width = 0.0006; bv.segments = 2
    band.data.materials.append(mats.leather('beret_leather', (22, 18, 16)))
    # drawstring bow at the back
    kb = int(np.argmin(np.abs(np.angle(np.exp(1j * (th - math.pi / 2))))))
    pb = ring[kb] + (ring[kb] - c) / np.linalg.norm(ring[kb] - c) * 0.003 + n_ * 0.006
    tails = []
    for s, ang in ((1, 0.25), (-1, -0.2)):
        p = pb.copy(); dirv = -n_ * 0.9 + ex * s * 0.25 + (ring[kb] - c) / np.linalg.norm(ring[kb] - c) * 0.15
        dirv /= np.linalg.norm(dirv)
        pts = [p + dirv * 0.012 * i + ex * s * 0.004 * i * (1 + 0.3 * i) * 0.2 for i in range(7)]
        tails.append(ribbon('beret_tie', pts, 0.006, 0.0008, n_ * 0 + (ring[kb] - c) / np.linalg.norm(ring[kb] - c), coll))
    for tl in tails: tl.data.materials.append(band.data.materials[0])
    # badge over the left eye (front-left of the band)
    kf = int(np.argmin(np.abs(np.angle(np.exp(1j * (th - math.radians(-62)))))))
    bpos = ring[kf] + (ring[kf] - c) / np.linalg.norm(ring[kf] - c) * 0.004 + n_ * 0.026
    bn = (ring[kf] - c) / np.linalg.norm(ring[kf] - c) + n_ * 0.18; bn /= np.linalg.norm(bn)
    badge_root = cap_badge(bpos, bn, n_, coll)
    return ob, band, badge_root, dict(c=c, n=n_, ring=ring, th=th, ex=ex, ey=ey, G=G, tails=tails)


def ribbon(name, pts, width, thick, side, coll=None):
    bm = bmesh.new()
    pts = [np.array(p) for p in pts]
    L, R = [], []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]; t /= np.linalg.norm(t) + 1e-9
        s = np.cross(t, side); s /= np.linalg.norm(s) + 1e-9
        wv = width * (1 - 0.3 * i / len(pts))
        L.append(bm.verts.new(tuple(p - s * wv / 2))); R.append(bm.verts.new(tuple(p + s * wv / 2)))
    for i in range(len(pts) - 1):
        bm.faces.new((L[i], R[i], R[i + 1], L[i + 1]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    sd = ob.modifiers.new('sd', 'SOLIDIFY'); sd.thickness = thick
    for p in me.polygons: p.use_smooth = True
    return ob


def cap_badge(pos, normal, up, coll=None):
    """Generic brass cap badge, ~38 mm tall: an oval garter ring on a pierced backing, a dagger point-up through it,
    a simple crown above. Extruded outlines with bevels; local +Z = out of the beret."""
    root = bpy.data.objects.new('badge', None); (coll or bpy.context.scene.collection).objects.link(root)
    z = np.array(normal, float); z /= np.linalg.norm(z)
    y = np.array(up, float); y = y - z * (y @ z); y /= np.linalg.norm(y)
    x = np.cross(y, z)
    M = Matrix(((x[0], y[0], z[0], pos[0]), (x[1], y[1], z[1], pos[1]), (x[2], y[2], z[2], pos[2]), (0, 0, 0, 1)))
    root.matrix_world = M
    br = mats.brass('badge_brass', 0.45)
    mm = 0.001

    def prism(name, outline, z0, z1, bev=0.35):
        bm = bmesh.new()
        lo = [bm.verts.new((px * mm, py * mm, z0 * mm)) for px, py in outline]
        hi = [bm.verts.new((px * mm, py * mm, z1 * mm)) for px, py in outline]
        nn = len(outline)
        bm.faces.new(lo[::-1]); bm.faces.new(hi)
        for i in range(nn):
            bm.faces.new((lo[i], lo[(i + 1) % nn], hi[(i + 1) % nn], hi[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(o)
        o.parent = root
        bv = o.modifiers.new('bv', 'BEVEL'); bv.width = bev * mm; bv.segments = 3; bv.limit_method = 'ANGLE'
        o.data.materials.append(br)
        for p in me.polygons: p.use_smooth = True
        return o

    def ring_pts(rx, ry, n=64, cy=0.0):
        return [(rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]

    # backing oval + garter ring (outer and inner rims as separate raised bands)
    prism('badge_back', ring_pts(13.5, 15.5), 0.0, 0.8)
    # raised garter: a flat ring between two ovals, walls inside and out
    bm = bmesh.new()
    nseg = 64
    o_ring = []
    for (rx, ry) in ((13.3, 15.3), (10.3, 12.3)):
        o_ring.append([(rx * math.cos(2 * math.pi * i / nseg), ry * math.sin(2 * math.pi * i / nseg)) for i in range(nseg)])
    vs = {}
    for li, z0 in enumerate((0.8, 2.2)):
        for ri in range(2):
            vs[(li, ri)] = [bm.verts.new((px * mm, py * mm, z0 * mm)) for px, py in o_ring[ri]]
    for i in range(nseg):
        j = (i + 1) % nseg
        bm.faces.new((vs[(1, 0)][i], vs[(1, 0)][j], vs[(1, 1)][j], vs[(1, 1)][i]))      # top
        bm.faces.new((vs[(0, 0)][j], vs[(0, 0)][i], vs[(0, 1)][i], vs[(0, 1)][j]))      # bottom
        bm.faces.new((vs[(0, 0)][i], vs[(0, 0)][j], vs[(1, 0)][j], vs[(1, 0)][i]))      # outer wall
        bm.faces.new((vs[(0, 1)][j], vs[(0, 1)][i], vs[(1, 1)][i], vs[(1, 1)][j]))      # inner wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('badge_garter'); bm.to_mesh(me); bm.free()
    g = bpy.data.objects.new('badge_garter', me); (coll or bpy.context.scene.collection).objects.link(g); g.parent = root
    bv = g.modifiers.new('bv', 'BEVEL'); bv.width = 0.4 * mm; bv.segments = 3
    sub = g.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    g.data.materials.append(br)
    for p in me.polygons: p.use_smooth = True
    # dagger, point up: blade (diamond section), guard, grip with rings, pommel
    blade = [(0, 15.0), (1.6, 3.0), (1.9, -2.0), (-1.9, -2.0), (-1.6, 3.0)]
    prism('badge_blade', blade, 0.8, 2.6, 0.5)
    prism('badge_guard', [(-5.5, -2.0), (5.5, -2.0), (5.8, -3.3), (-5.8, -3.3)], 0.8, 3.0, 0.5)
    prism('badge_grip', [(-1.6, -3.3), (1.6, -3.3), (1.9, -10.0), (-1.9, -10.0)], 0.8, 2.8, 0.5)
    prism('badge_pommel', ring_pts(2.2, 1.8, 24, -11.5), 0.8, 2.8, 0.6)
    # crown above the oval
    crown = [(-7.5, 15.0), (7.5, 15.0), (8.5, 18.5), (6.0, 21.5), (4.0, 19.5), (2.0, 23.0), (0, 21.0), (-2.0, 23.0), (-4.0, 19.5), (-6.0, 21.5), (-8.5, 18.5)]
    prism('badge_crown', crown, 0.4, 2.6, 0.5)
    prism('badge_cross', [(-1.2, 22.0), (1.2, 22.0), (1.2, 23.5), (2.8, 23.5), (2.8, 25.0), (1.2, 25.0), (1.2, 26.5), (-1.2, 26.5), (-1.2, 25.0), (-2.8, 25.0), (-2.8, 23.5), (-1.2, 23.5)], 0.4, 2.2, 0.35)
    root.scale = (0.9, 0.9, 0.9)
    return root


