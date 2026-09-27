"""Castle kit helpers (M20 octagonal castle): battered talus, crenellated parapets on machicolation corbels, arrow slits,
octagonal towers with slate spires and lucarnes. All geometry in world coordinates (kit conventions)."""
import math
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

STONE, DRESS, ROOF = 'fieldstone_grey', 'ashlar', 'roof_slate'


def seg_frame(p0, p1, out_n):
    p0, p1 = V((*p0[:2], 0)), V((*p1[:2], 0))
    d = (p1 - p0)
    L = d.length
    t = d.normalized()
    n = V((*out_n[:2], 0)).normalized()
    return p0, t, n, L


def quad_block(bm, p0, t, n, a, b, d0, d1, z0, z1):
    """Box aligned to a wall segment: along t from a..b, along n from d0..d1 (outward positive), z0..z1."""
    pts = []
    for z in (z0, z1):
        for (u, w) in ((a, d0), (b, d0), (b, d1), (a, d1)):
            pts.append(p0 + t * u + n * w + V((0, 0, z)))
    fs = K.hexa_bm(bm, pts)
    return fs


def talus(p0, p1, out_n, z_bot, z_top, proj, thick, mid=STONE, name='talus'):
    """Battered base (sloping plinth) on the outer face of a wall segment."""
    p0, t, n, L = seg_frame(p0, p1, out_n)
    bm = bmesh.new()
    pts = [p0 + n * proj + V((0, 0, z_bot)), p0 + t * L + n * proj + V((0, 0, z_bot)), p0 + t * L - n * thick + V((0, 0, z_bot)), p0 - n * thick + V((0, 0, z_bot)),
           p0 + V((0, 0, z_top)), p0 + t * L + V((0, 0, z_top)), p0 + t * L - n * thick + V((0, 0, z_top)), p0 - n * thick + V((0, 0, z_top))]
    K.hexa_bm(bm, pts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name)


def crenellation(p0, p1, out_n, z, thick=0.6, h_low=1.1, h_mer=1.0, merlon=1.7, crenel=0.8, mach=0.45, corbel_step=1.25,
                 mid=STONE, dress=DRESS, name='parapet', slits=True, ends=(True, True)):
    """Machicolated crenellated parapet along the outer edge of a wall top at height z (outer face line p0-p1).
    The parapet projects `mach` beyond the wall face on 3-stepped corbels (open slots between them)."""
    p0, t, n, L = seg_frame(p0, p1, out_n)
    zb = z - 0.55 if mach > 0 else z
    bm = bmesh.new()
    ext0 = -mach if ends[0] else 0.0
    ext1 = L + mach if ends[1] else L
    quad_block(bm, p0, t, n, ext0, ext1, mach - thick, mach, zb, z + h_low)          # breastwork
    nm = max(1, int(round((L + 2 * mach) / (merlon + crenel))))
    step = (ext1 - ext0) / nm
    rj = K.rng()
    mj = [(rj.uniform(-0.09, 0.09), rj.uniform(-0.09, 0.09), rj.uniform(-0.1, 0.06)) for i in range(nm)]
    for i in range(nm):
        a = ext0 + i * step + crenel / 2 + mj[i][0]
        b = a + step - crenel + mj[i][1] - mj[i][0]
        quad_block(bm, p0, t, n, a, b, mach - thick, mach, z + h_low, z + h_low + h_mer + mj[i][2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    par = K.part(bm, mid, name=name)
    bm = bmesh.new()                                    # copings on merlons and crenel sills
    for i in range(nm):
        a = ext0 + i * step + crenel / 2 + mj[i][0]
        b = a + step - crenel + mj[i][1] - mj[i][0]
        zc = z + h_low + h_mer + mj[i][2]                # saddle-back coping: sloped both ways, 5 cm overhang
        cb = [p0 + t * (a - 0.05) + n * (mach - thick - 0.06), p0 + t * (b + 0.05) + n * (mach - thick - 0.06),
              p0 + t * (b + 0.05) + n * (mach + 0.07), p0 + t * (a - 0.05) + n * (mach + 0.07)]
        mid_in, mid_out = (cb[0] + cb[1]) / 2, (cb[2] + cb[3]) / 2
        lo = [q + V((0, 0, zc)) for q in cb] + [q + V((0, 0, zc + 0.1)) for q in cb]
        K.hexa_bm(bm, lo)
        rl = [cb[0] + (cb[3] - cb[0]) * 0.5, cb[1] + (cb[2] - cb[1]) * 0.5]
        v4 = [bm.verts.new(q + V((0, 0, zc + 0.1))) for q in cb]
        vr = [bm.verts.new(q + V((0, 0, zc + 0.22))) for q in rl]
        bm.faces.new((v4[0], v4[1], vr[1], vr[0]))
        bm.faces.new((v4[2], v4[3], vr[0], vr[1]))
        bm.faces.new((v4[1], v4[2], vr[1]))
        bm.faces.new((v4[3], v4[0], vr[0]))
        c0, c1 = b, b + crenel + (mj[i + 1][0] if i + 1 < nm else 0)
        quad_block(bm, p0, t, n, c0, c1, mach - thick - 0.05, mach + 0.06, z + h_low, z + h_low + 0.08)
    if mach > 0:                                        # corbels (3 stepped stones) with slots between
        nc = max(2, int(L / corbel_step))
        for i in range(nc + 1):
            u = L * i / nc
            for k, (dz, pj) in enumerate(((0.0, 0.15), (0.22, 0.3), (0.44, mach + 0.02))):
                quad_block(bm, p0, t, n, u - 0.22, u + 0.22, -0.05, pj, zb - 0.66 + dz, zb - 0.44 + dz)
        quad_block(bm, p0, t, n, ext0, ext1, mach - 0.1, mach + 0.08, zb - 0.18, zb)       # moulded string under parapet
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, dress, name=name + '_dress')
    if slits:                                           # dark arrow-slit cards on merlons
        bm = bmesh.new()
        for i in range(nm):
            u = ext0 + i * step + step / 2
            q = [p0 + t * (u - 0.05) + n * (mach + 0.005) + V((0, 0, z + h_low + 0.15)), p0 + t * (u + 0.05) + n * (mach + 0.005) + V((0, 0, z + h_low + 0.15)),
                 p0 + t * (u + 0.05) + n * (mach + 0.005) + V((0, 0, z + h_low + 0.8)), p0 + t * (u - 0.05) + n * (mach + 0.005) + V((0, 0, z + h_low + 0.8))]
            bm.faces.new([bm.verts.new(x) for x in q])
        K.part(bm, 'interior_dark', name=name + '_slits', grime=0, bisect=False, lod='drop')
    return par


def slit_cards(p0, p1, out_n, zs, spacing=4.0, w=0.14, h=1.4, name='slits'):
    """Arrow slits on a wall face (dark recessed cards + dressed jambs)."""
    p0, t, n, L = seg_frame(p0, p1, out_n)
    bm, bj = bmesh.new(), bmesh.new()
    k = max(1, int(L / spacing))
    for z in zs:
        for i in range(k):
            u = L * (i + 0.5) / k
            q = [p0 + t * (u - w / 2) + n * 0.01 + V((0, 0, z)), p0 + t * (u + w / 2) + n * 0.01 + V((0, 0, z)),
                 p0 + t * (u + w / 2) + n * 0.01 + V((0, 0, z + h)), p0 + t * (u - w / 2) + n * 0.01 + V((0, 0, z + h))]
            bm.faces.new([bm.verts.new(x) for x in q])
            quad_block(bj, p0, t, n, u - w / 2 - 0.18, u - w / 2, -0.05, 0.03, z - 0.1, z + h + 0.1)
            quad_block(bj, p0, t, n, u + w / 2, u + w / 2 + 0.18, -0.05, 0.03, z - 0.1, z + h + 0.1)
            quad_block(bj, p0, t, n, u - w / 2 - 0.18, u + w / 2 + 0.18, -0.05, 0.03, z + h, z + h + 0.18)
    K.part(bm, 'interior_dark', name=name, grime=0, bisect=False, lod='drop')
    bmesh.ops.recalc_face_normals(bj, faces=bj.faces)
    K.part(bj, DRESS, name=name + '_jambs', lod='drop')


def octagon(cx, cy, R, rot=math.pi / 8):
    return [(cx + math.cos(rot + k * math.pi / 4) * R, cy + math.sin(rot + k * math.pi / 4) * R) for k in range(8)]


def spire(cx, cy, R, z0, h, mid=ROOF, flare=0.45, lucarnes=(0, 4), name='spire'):
    """Octagonal slate spire with a bell-cast kick at the eaves, lucarnes on chosen faces, finial + vane."""
    bm = bmesh.new()
    rings = []
    for k, (rr, zz) in enumerate(((R + flare + 0.25, z0 - 0.35), (R + 0.1, z0 + 0.45), (R * 0.55, z0 + h * 0.45), (0.12, z0 + h))):
        rings.append([V((x, y, zz)) for x, y in octagon(cx, cy, rr)])
    K.loft_bm(bm, rings, close_start=True, close_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sp = K.part(bm, mid, name=name, grime=0.6)
    bm = bmesh.new()                                   # lucarnes: small gabled dormers with a dark louvre
    for f in lucarnes:
        a = math.pi / 8 + (f + 0.5) * math.pi / 4
        n = V((math.cos(a), math.sin(a), 0))
        tt = V((-n.y, n.x, 0))
        base = V((cx, cy, 0)) + n * (R * 0.78) + V((0, 0, z0 + h * 0.2))
        w, hh, d = 0.9, 1.1, 1.3
        pts = [base - tt * w / 2, base + tt * w / 2, base + tt * w / 2 - n * d, base - tt * w / 2 - n * d]
        K.hexa_bm(bm, pts + [p + V((0, 0, hh)) for p in pts])
        ridge0, ridge1 = base + V((0, 0, hh + 0.55)) + n * 0.15, base + V((0, 0, hh + 0.55)) - n * d
        for s in (-1, 1):
            e0, e1 = base + tt * s * (w / 2 + 0.12) + n * 0.15 + V((0, 0, hh - 0.05)), base + tt * s * (w / 2 + 0.12) - n * d + V((0, 0, hh - 0.05))
            q = [e0, e1, ridge1, ridge0] if s > 0 else [e1, e0, ridge0, ridge1]
            f_ = bm.faces.new([bm.verts.new(x) for x in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name + '_lucarnes')
    bm = bmesh.new()
    for f in lucarnes:
        a = math.pi / 8 + (f + 0.5) * math.pi / 4
        n = V((math.cos(a), math.sin(a), 0))
        tt = V((-n.y, n.x, 0))
        c = V((cx, cy, 0)) + n * (R * 0.78 + 0.01) + V((0, 0, z0 + h * 0.2 + 0.55))
        q = [c - tt * 0.3 - V((0, 0, 0.4)), c + tt * 0.3 - V((0, 0, 0.4)), c + tt * 0.3 + V((0, 0, 0.4)), c - tt * 0.3 + V((0, 0, 0.4))]
        bm.faces.new([bm.verts.new(x) for x in q])
    K.part(bm, 'interior_dark', name=name + '_louvres', grime=0, bisect=False)
    bm = bmesh.new()
    top = V((cx, cy, z0 + h))
    K.cyl_bm(bm, top - V((0, 0, 0.3)), top + V((0, 0, 1.6)), 0.04, 6)
    K.cyl_bm(bm, top + V((0, 0, 0.5)), top + V((0, 0, 0.75)), 0.14, 8)
    q = [top + V((0.05, 0, 1.15)), top + V((0.75, 0, 1.15)), top + V((0.75, 0, 1.45)), top + V((0.05, 0, 1.45))]
    f_ = bm.faces.new([bm.verts.new(x) for x in q])
    K.part(bm, 'cast_iron', name=name + '_finial', grime=0, bisect=False)
    return sp


def tower(cx, cy, R, h, z_bot=0.0, door_n=None, quoin_dir=None, windows=((4.5, 0.18, 1.5), (8.5, 0.18, 1.5), (12.0, 0.7, 1.8)), talus_h=2.5,
          roof=True, name='tower'):
    """Octagonal tower: battered base, stone shaft, slits / lancet windows on the outer faces, machicolated crenellated
    parapet at h, slate spire. door_n: outward normal (x,y) of the face that gets a ground door (courtyard side)."""
    poly = octagon(cx, cy, R)
    bm = bmesh.new()
    K.prism_bm(bm, K.ccw(poly), z_bot, h)
    body = K.part(bm, STONE, name=name + '_shaft')
    bm = bmesh.new()                                    # talus: frustum from R+0.9 at the bottom to R at talus_h
    K.loft_bm(bm, [[V((x, y, z_bot)) for x, y in octagon(cx, cy, R + 0.9)], [V((x, y, talus_h)) for x, y in octagon(cx, cy, R + 0.02)]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, STONE, name=name + '_talus')
    bm = bmesh.new()
    K.loft_bm(bm, [[V((x, y, talus_h - 0.02)) for x, y in octagon(cx, cy, R + 0.12)], [V((x, y, talus_h + 0.22)) for x, y in octagon(cx, cy, R + 0.12)]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, DRESS, name=name + '_torus')
    # quoins on the octagon corners
    bm = bmesh.new()
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        if quoin_dir and math.cos(a) * quoin_dir[0] + math.sin(a) * quoin_dir[1] < -0.2:
            continue
        c = V((cx + math.cos(a) * R, cy + math.sin(a) * R, 0))
        z = talus_h + 0.25
        i = 0
        while z < h - 0.7:
            hh = 0.74 + (0.08 if i % 3 == 0 else 0.0)
            sz = 0.56 if i % 2 == 0 else 0.4                 # long-and-short work, nearly flush (4 cm proud)
            rin = sz / math.sqrt(2) - 0.04
            K.box_bm(bm, (c.x - math.cos(a) * rin, c.y - math.sin(a) * rin, z + hh / 2), (sz, sz, hh - 0.025), a + math.pi / 4)
            z += hh
            i += 1
    K.part(bm, DRESS, name=name + '_quoins', lod='drop')
    ws = []
    for k in range(8):
        a0, a1 = math.pi / 8 + k * math.pi / 4, math.pi / 8 + (k + 1) * math.pi / 4
        p0 = V((cx + math.cos(a0) * R, cy + math.sin(a0) * R, 0))
        p1 = V((cx + math.cos(a1) * R, cy + math.sin(a1) * R, 0))
        mid = (p0 + p1) / 2
        n = V((mid.x - cx, mid.y - cy, 0)).normalized()
        if door_n and n.dot(V((*door_n, 0))) > 0.9:
            f = K.Frame(mid + n * 0.01, n, (p1 - p0).normalized(), 1.4, 2.6, 1.2, 'arch', 'door')
            K.cut_object(body, _frame_cutter(f))
            K.door(f, name + '_door', 'plank', (0.3, 0.25, 0.2), step=DRESS, lintel=DRESS, surround=DRESS, name=name + '_door')
            continue
        if door_n and n.dot(V((*door_n, 0))) > 0.5:
            continue                                     # faces bound to curtain walls: no windows
        for z, wf, hh in windows:
            if z + hh > h - 1.0 or (wf > 0.4 and k % 2):
                continue
            f = K.Frame(mid + n * 0.01 + V((0, 0, z)), n, (p1 - p0).normalized(), wf, hh, 1.2, 'pointed' if wf > 0.4 else 'rect')
            ws.append(f)
    if ws:
        K.cut_object(body, _frames_cutter(ws))
        for f in ws:
            if f.w > 0.4:
                K.window(f, 'casement', (1, 3), frame=(0.3, 0.26, 0.2), sill=DRESS, lintel=DRESS, surround=None, curtain=0.3,
                         bars=f.o.z < 6, streak=True, name=name + '_win')
            else:
                bm = bmesh.new()
                q = [f.p(-f.w / 2, 0, -0.3), f.p(f.w / 2, 0, -0.3), f.p(f.w / 2, f.h, -0.3), f.p(-f.w / 2, f.h, -0.3)]
                bm.faces.new([bm.verts.new(x) for x in q])
                K.part(bm, 'interior_dark', name=name + '_slit', grime=0, bisect=False, lod='drop')
    for k in range(8):
        a0, a1 = math.pi / 8 + k * math.pi / 4, math.pi / 8 + (k + 1) * math.pi / 4
        p0 = (cx + math.cos(a0) * R, cy + math.sin(a0) * R)
        p1 = (cx + math.cos(a1) * R, cy + math.sin(a1) * R)
        mid = ((p0[0] + p1[0]) / 2 - cx, (p0[1] + p1[1]) / 2 - cy)
        crenellation(p0, p1, mid, h, thick=0.55, merlon=1.3, crenel=0.6, mach=0.4, corbel_step=1.1, name=name + '_par%d' % k,
                     ends=(False, False), slits=k % 2 == 0)
    bm = bmesh.new()                                     # wall-walk floor inside the parapet
    K.prism_bm(bm, K.ccw(octagon(cx, cy, R - 0.1)), h - 0.2, h + 0.02)
    K.part(bm, 'cobblestone', name=name + '_floor', grime=0.3)
    if roof:
        spire(cx, cy, R - 1.4, h + 0.4, R * 2.15, flare=0.3, name=name + '_spire')
    K.footprint(octagon(cx, cy, R + 0.9), 'HIGH', 'tower')
    return poly


def _frame_cutter(f):
    import kit_arch as KA
    return KA._cutter_bm([f])


def _frames_cutter(fs):
    import kit_arch as KA
    return KA._cutter_bm(fs)


def loops(wall, p0, p1, out_n, specs, depth=0.55, splay=0.22, name='loops'):
    """Arrow loops with splayed reveals: for each (u, z, w, h) a frustum (w + 2 splay wide at the face, w at `depth`)
    is boolean-cut into `wall` (the reveal faces are re-textured by mil.fix_cut_faces), a dark card closes the back,
    dressed stones frame the slit (cross-slit oillet at the foot)."""
    p0, t, n, L = seg_frame(p0, p1, out_n)
    c = bmesh.new()
    bm, bj = bmesh.new(), bmesh.new()
    for u, z, w, h in specs:
        def P(du, dz, d):
            return p0 + t * (u + du) + n * d + V((0, 0, z + dz))
        outer = [P(-w / 2 - splay, -splay * 0.6, 0.05), P(w / 2 + splay, -splay * 0.6, 0.05), P(w / 2 + splay, h + splay * 0.6, 0.05), P(-w / 2 - splay, h + splay * 0.6, 0.05)]
        inner = [P(-w / 2, 0, -depth), P(w / 2, 0, -depth), P(w / 2, h, -depth), P(-w / 2, h, -depth)]
        K.loft_bm(c, [outer, inner])
        q = [P(-w / 2 - 0.01, -0.01, -depth + 0.02), P(w / 2 + 0.01, -0.01, -depth + 0.02), P(w / 2 + 0.01, h + 0.01, -depth + 0.02), P(-w / 2 - 0.01, h + 0.01, -depth + 0.02)]
        bm.faces.new([bm.verts.new(x) for x in q])
        quad_block(bj, p0, t, n, u - w / 2 - splay - 0.16, u - w / 2 - splay, -0.05, 0.035, z - 0.25, z + h + 0.25)
        quad_block(bj, p0, t, n, u + w / 2 + splay, u + w / 2 + splay + 0.16, -0.05, 0.035, z - 0.25, z + h + 0.25)
        quad_block(bj, p0, t, n, u - w / 2 - splay - 0.16, u + w / 2 + splay + 0.16, -0.05, 0.035, z + h + splay * 0.6, z + h + splay * 0.6 + 0.2)
    bmesh.ops.recalc_face_normals(c, faces=c.faces)
    K.cut_object(wall, c)
    K.part(bm, 'interior_dark', name=name, grime=0, bisect=False, lod='drop')
    bmesh.ops.recalc_face_normals(bj, faces=bj.faces)
    K.part(bj, DRESS, name=name + '_jambs', lod='drop')
