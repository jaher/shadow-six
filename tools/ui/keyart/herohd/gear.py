"""Personal kit modelled for the hero (own work, procedural; real WWII patterns, no markings):
  Fairbairn-Sykes fighting knife (3rd pattern: ringed grip, oval crossguard, ball pommel) in its leather sheath (brass
  chape, elastic retaining tab, side tabs), a No. 36M Mills bomb (segmented cast body, lever, ring and pin), the 1937
  water bottle in its felt cover and webbing cradle; and equip(): the whole 1937-pattern set laid on the smock."""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
import kit, mats
from kit import mat4

MM = 0.001


def lathe(name, prof, mat, seg=32, coll=None, smooth=True, scale_xy=(1.0, 1.0)):
    """Surface of revolution about local Z from a (r, z) profile (metres)."""
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * k / seg) * scale_xy[0], r * math.sin(2 * math.pi * k / seg) * scale_xy[1], z)) for k in range(seg)]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if prof[0][0] > 1e-6: bm.faces.new(rings[0][::-1])
    if prof[-1][0] > 1e-6: bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (coll or bpy.context.scene.collection).objects.link(ob)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob.data.materials.append(mat)
    return ob


def fs_knife(root_M, blacked, brass_m, leather, coll=None):
    """FS knife in its sheath; root frame: origin at the sheath mouth, -Z down the blade, +Y out of the body."""
    parts = []
    # grip: ringed, waisted ("coke bottle"), 115 mm; crossguard oval 50 x 12 mm; pommel nut
    prof = []
    for i in range(41):
        t = i / 40
        r = 0.0105 - 0.0035 * math.sin(math.pi * t) ** 1.2 + 0.0018 * math.sin(math.pi * t * 2.2)
        r += 0.0007 * (math.cos(t * 2 * math.pi * 13) > 0.3)        # the knurled rings
        prof.append((r * 0.95, 0.008 + t * 0.112))
    prof = [(0.0, 0.0065), (0.006, 0.0068)] + prof + [(0.0072, 0.121), (0.008, 0.124), (0.0085, 0.13), (0.006, 0.136), (0.0, 0.1365)]
    grip = lathe('fs_grip', prof, blacked, 40, coll)
    guard = lathe('fs_guard', [(0.0, 0.0), (0.024, 0.0), (0.025, 0.003), (0.024, 0.0065), (0.0, 0.0065)], blacked, 48, coll, scale_xy=(1.0, 0.25))
    for o in (grip, guard):
        o.matrix_world = root_M @ Matrix.Translation((0, 0, 0.004))
        bv = o.modifiers.new('bv', 'BEVEL'); bv.width = 0.0004; bv.segments = 2; bv.limit_method = 'ANGLE'
        parts.append(o)
    # sheath: tapered flat leather scabbard, 175 mm, with side tabs and a brass chape
    L = 0.178
    prof2 = []
    bm = bmesh.new()
    n = 24
    rows = []
    for i in range(n + 1):
        t = i / n
        wdt = 0.019 * (1 - t) + 0.006 * t
        th = 0.0075 * (1 - t) + 0.004 * t
        z = -t * L
        rows.append([bm.verts.new((x * wdt, y * th, z)) for x, y in ((-1, 0), (-0.7, 0.8), (0, 1), (0.7, 0.8), (1, 0), (0.7, -0.8), (0, -1), (-0.7, -0.8))])
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(8):
            bm.faces.new((a[k], a[(k + 1) % 8], b[(k + 1) % 8], b[k]))
    bm.faces.new(rows[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('fs_sheath'); bm.to_mesh(me); bm.free()
    sh = bpy.data.objects.new('fs_sheath', me); (coll or bpy.context.scene.collection).objects.link(sh)
    for p in me.polygons: p.use_smooth = True
    sub = sh.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    sh.data.materials.append(leather); sh.matrix_world = root_M
    parts.append(sh)
    tabs = kit.rounded_box('fs_tabs', 0.056, 0.05, 0.0025, 0.004, leather, coll)
    tabs.matrix_world = root_M @ Matrix.Translation((0, -0.002, -0.03)) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Translation((0, 0, -0.00125))
    parts.append(tabs)
    chape = lathe('fs_chape', [(0.0, -L - 0.004), (0.004, -L - 0.002), (0.0065, -L + 0.006), (0.0085, -L + 0.03), (0.0082, -L + 0.034), (0.0, -L + 0.034)], brass_m, 24, coll, scale_xy=(1.0, 0.6))
    chape.matrix_world = root_M
    parts.append(chape)
    # elastic retaining tab across the grip, with its press stud
    el = kit.rounded_box('fs_elastic', 0.03, 0.016, 0.0025, 0.002, leather, coll)
    el.matrix_world = root_M @ Matrix.Translation((0, 0.012, 0.05))
    stud = kit.cylinder('fs_stud', 0.004, 0.003, brass_m, coll, 16)
    stud.matrix_world = root_M @ Matrix.Translation((0, 0.0145, 0.05)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    parts += [el, stud]
    return parts


def mills(M, body_m, metal, coll=None):
    """No. 36M grenade: segmented ovoid 95 x 61 mm, base plug, fuze head with lever and ring pin; M = frame at the
    lever hook point, -Z down the grenade."""
    prof = []
    for i in range(33):
        t = i / 32
        z = -0.012 - t * 0.088
        r = 0.0305 * math.sin(math.pi * min(1.0, 0.08 + t * 0.92)) ** 0.75
        prof.append((max(r, 0.009), z))
    body = lathe('mills_body', prof, body_m, 48, coll)
    body.matrix_world = M
    # segment grooves: displace the surface in a 6 x 8 grid pattern — deep and wide enough to still read as
    # cast segmentation after the subsurf pass (the first cut smoothed away and the bomb read as a smooth blob)
    for v in body.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        g1 = abs(math.sin(a * 4)) ** 0.3
        g2 = abs(math.sin((v.co.z + 0.012) / 0.0885 * math.pi * 5.5)) ** 0.3
        f = min(g1, g2)
        rr = math.hypot(v.co.x, v.co.y)
        if rr > 0.012:
            k = (rr - 0.0052 * (1 - f)) / rr
            v.co.x *= k; v.co.y *= k
    sub = body.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    head = lathe('mills_fuze', [(0.0, 0.0), (0.009, 0.0), (0.0105, -0.004), (0.0105, -0.013), (0.0, -0.013)], metal, 32, coll)
    head.matrix_world = M
    lever = kit.rounded_box('mills_lever', 0.016, 0.075, 0.0016, 0.0007, metal, coll)
    lever.matrix_world = M @ Matrix.Translation((0.0, 0.031, -0.05)) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Rotation(math.radians(-4), 4, 'X')
    ring = bpy.data.objects.new('mills_ring', bpy.data.meshes.new('mills_ring')); (coll or bpy.context.scene.collection).objects.link(ring)
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=False, radius=0.011, segments=24); bm.to_mesh(ring.data); bm.free()
    ring.matrix_world = M @ Matrix.Translation((-0.016, 0.0, -0.006)) @ Matrix.Rotation(math.radians(80), 4, 'Y')
    sk = ring.modifiers.new('sk', 'SKIN')
    for v in ring.data.skin_vertices[0].data: v.radius = (0.0011, 0.0011)
    ring.modifiers.new('sub', 'SUBSURF').levels = 1
    ring.data.materials.append(metal)
    return [body, head, lever, ring]


def bottle(M, felt_m, web_m, brass_m, cork_m, coll=None):
    """1937 water bottle: flattened oval, 200 mm, felt cover; in a webbing cradle (girth band + two crossed straps under
    the base + the suspension strap with its brass buckle). M: origin at the bottle top centre, -Z down, +Y outward."""
    prof = [(0.0, -0.205), (0.04, -0.204), (0.066, -0.196), (0.076, -0.178), (0.078, -0.12), (0.075, -0.06), (0.064, -0.03),
            (0.042, -0.014), (0.018, -0.006), (0.0125, -0.004), (0.0125, 0.008), (0.0, 0.008)]
    b = lathe('bottle', prof, felt_m, 48, coll, scale_xy=(1.0, 0.48))
    b.matrix_world = M
    sub = b.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    cork = lathe('bottle_cork', [(0.0, 0.004), (0.011, 0.004), (0.012, 0.022), (0.0, 0.022)], cork_m, 24, coll)
    cork.matrix_world = M
    parts = [b, cork]
    # cradle straps as ribbons round the felt (in the bottle's local space, then transformed)
    def band(name, pts, normals, width):
        P = np.array([np.array(M @ Vector(p)) for p in pts]); N = np.array([np.array(M.to_3x3() @ Vector(n)) for n in normals])
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        return kit.ribbon(name, P, N, width, 0.0024, web_m, closed=name.endswith('girth'), coll=coll)
    k = 64
    g = [(0.0795 * math.cos(2 * math.pi * i / k), 0.0385 * math.sin(2 * math.pi * i / k), -0.11) for i in range(k)]
    gn = [(math.cos(2 * math.pi * i / k) / 0.0795, math.sin(2 * math.pi * i / k) / 0.0385, 0.0) for i in range(k)]
    parts.append(band('bottle_girth', g, gn, 0.03))
    for a in (0.0, math.pi / 2):
        pts, ns = [], []
        for i in range(41):
            t = -math.pi / 2 + math.pi * i / 40
            x, z = 0.079 * math.sin(t), -0.205 + 0.095 * (1 - math.cos(t)) - 0.0035
            p = (x * math.cos(a), x * math.sin(a) * 0.5, min(z, -0.11))
            pts.append(p); ns.append((math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), -math.cos(t)))
        parts.append(band('bottle_cross', pts, ns, 0.022))
    up = [(0.0, 0.0385 + 0.003, -0.11 + 0.012 * i) for i in range(0, 13)] + [(0.0, 0.0385 - 0.004, 0.044), (0.0, 0.0385 - 0.012, 0.05)]
    parts.append(band('bottle_strap', up, [(0, 1, 0)] * len(up), 0.022))
    bk = kit.brass_buckle('bottle_buckle', 0.03, 0.026, 0.004, 0.0028, brass_m, coll)
    bk.matrix_world = M @ Matrix.Translation((0, 0.042, -0.02)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    parts.append(bk)
    return parts


def tuck(smock, belt, zb, yc, half=0.034, inset=0.0045):
    """The belt holds the smock: cloth vertices inside the belt's band that stand proud of its inner face are pulled
    in under it (blending out over 1.5 cm above and below)."""
    co = np.array([belt.matrix_world @ v.co for v in belt.data.vertices])
    ang = np.arctan2(co[:, 1] - yc, co[:, 0]); rad = np.hypot(co[:, 0], co[:, 1] - yc)
    bins = np.linspace(-math.pi, math.pi, 181)
    rmin = np.full(180, 1.0)
    for a_, r_ in zip(ang, rad):
        k = min(179, int((a_ + math.pi) / (2 * math.pi) * 180)); rmin[k] = min(rmin[k], r_)
    for _ in range(3): rmin = np.minimum(rmin, 0.5 * (np.roll(rmin, 1) + np.roll(rmin, -1)) + 0.01)
    M = smock.matrix_world; Mi = M.inverted()
    n = 0
    for v in smock.data.vertices:
        p = M @ v.co
        dz = abs(p.z - zb)
        if dz > half + 0.015: continue
        a_ = math.atan2(p.y - yc, p.x); r = math.hypot(p.x, p.y - yc)
        k = min(179, int((a_ + math.pi) / (2 * math.pi) * 180))
        lim = rmin[k] - inset
        if r > lim:
            w = 1.0 if dz < half else 1 - (dz - half) / 0.015
            nr = r + (lim - r) * w
            v.co = Mi @ Vector((p.x * nr / r, yc + (p.y - yc) * nr / r, p.z)); n += 1
    smock.data.update()
    print('TUCK', n, 'cloth vertices under the belt')


def front_point(surf, x, z, y0=-1.0):
    loc, n = surf.ray((x, y0, z), (0, 1, 0), 2.0)
    if loc is None: loc, n = surf.near((x, -0.3, z))
    return loc, n


def equip(smock, rig, Z, coll=None):
    """Lay the 1937 set and the kit on the simulated smock (world space, pose B)."""
    web = mats.webbing()
    brass = bpy.data.materials.get('brass') or mats.brass('brass')
    surf = kit.Surface(smock)
    zb = rig['z_belt']
    yf = front_point(surf, 0.0, zb)[0][1]
    yb = surf.ray((0, 1.0, zb), (0, -1, 0), 2.0)[0][1]
    out = {}
    belt, bf = kit.belt(surf, (0.0, 0.5 * (yf + yb)), zb, web, brass, coll)
    out['belt'] = belt
    tuck(smock, belt, zb, 0.5 * (yf + yb))
    surf = kit.Surface(smock)
    # pouches on the belt either side of the buckle, their backs on the chest
    tops = {}
    for s in (1, -1):
        at, _ = front_point(surf, s * 0.098, zb - 0.026)
        box, lid, fr, top = kit.pouch('pouch_' + ('l' if s > 0 else 'r'), surf, at, s, web, brass, coll)
        tops[s] = (top, fr)
    braces = {}
    # braces: pouch buckle -> up the chest -> over the shoulder -> down the back, crossing to the far side
    for s in (1, -1):
        top, fr = tops[s]
        o, x, y, zz = fr
        def fp(xx, z, dy=0.012):
            l, n = front_point(surf, xx, z); return l + n * dy
        def bp(xx, z, dy=0.012):
            l, n = surf.ray((xx, 1.0, z), (0, -1, 0), 2.0); return l + n * dy
        sh = surf.near((s * 0.125, 0.0, Z['zs'] + 0.16))[0]
        pts = [top + zz * 0.004, fp(s * 0.13, Z['zs'] - 0.12), fp(s * 0.128, Z['zs'] - 0.04), sh + np.array([0, -0.035, 0.012]), sh + np.array([0, 0.0, 0.016]),
               sh + np.array([0, 0.04, 0.0]), bp(s * 0.11, Z['zs'] - 0.12), bp(0.0, zb + 0.16), bp(-s * 0.1, zb + 0.04)]
        _, BP, BN = kit.brace('brace_' + ('l' if s > 0 else 'r'), surf, pts, web, coll)
        braces[s] = (BP, BN)
        # the brace end through the pouch buckle, its brass tip hanging below
        tip = kit.rounded_box('brace_tip', 0.026, 0.02, 0.0016, 0.0006, brass, coll)
        tip.matrix_world = mat4(top + zz * 0.006 - y * 0.03, x, y, zz)
    blk = mats.blackened()
    lea = mats.leather('sheath_leather', (62, 38, 22))
    # Fairbairn-Sykes on the left brace, hilt up across the chest (sheath stitched to the strap)
    BP, BN = braces[1]
    sel = [i for i in range(len(BP)) if Z['zs'] - 0.26 < BP[i][2] < Z['zs'] - 0.02 and BP[i][1] < 0]
    i0, i1 = sel[0], sel[-1]
    lo, hi = (BP[i0], BP[i1]) if BP[i0][2] < BP[i1][2] else (BP[i1], BP[i0])
    up = hi - lo; up /= np.linalg.norm(up)
    nrm = np.mean([BN[i] for i in sel], 0); nrm -= up * (nrm @ up); nrm /= np.linalg.norm(nrm)
    xs = np.cross(up, nrm)
    mouth = lo + up * 0.185 + nrm * 0.011
    M = mat4(mouth, xs, nrm, up)
    out['knife'] = fs_knife(M, blk, brass, lea, coll)
    # Mills bomb hooked by its lever on the right brace, under the raised arm
    BP, BN = braces[-1]
    k = min((i for i in range(len(BP)) if BP[i][1] < 0), key=lambda i: abs(BP[i][2] - (Z['zs'] - 0.13)))
    hp, hn = BP[k], BN[k] / np.linalg.norm(BN[k])
    zx = np.cross(np.array([0, 0, 1.0]), hn); zx /= np.linalg.norm(zx)
    Mg = mat4(hp + hn * 0.036, zx, hn, np.array([0, 0, 1.0]))
    out['mills'] = mills(Mg, mats.mills(), mats.gunmetal(), coll)
    # water bottle on the right hip, hanging from the belt
    sp = surf.ray((-1.0, 0.5 * (yf + yb) - 0.02, zb - 0.02), (1, 0, 0), 2.0)[0]
    nb = np.array([-1.0, -0.75, 0.0]); nb /= np.linalg.norm(nb)
    xb = np.cross(np.array([0, 0, 1.0]), nb); xb /= np.linalg.norm(xb)
    Mb = mat4(sp + nb * 0.045 + np.array([0, 0, -0.035]), xb, nb, np.array([0, 0, 1.0]))
    out['bottle'] = bottle(Mb, mats.felt('bottle_felt', (84, 74, 50)), web, brass, mats.wood('cork', (150, 112, 70)), coll)
    return out
