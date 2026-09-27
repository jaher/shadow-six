"""Masonry moat bridge for the castle gate (built road-along-X in local coords, x = s - SC where s = distance south of
the gatehouse front; turned to run south at the end). Two segmental arches, pointed cutwaters on BOTH faces that rise
to pedestrian refuges (parapet bulges) over each pier, starlings at the water line, humped deck, setts carriageway with
granite kerbs and flagged footways, coursed-ashlar parapets with projecting coping + drip, splayed wing parapets and
a ramped, bell-mouthed approach at the south end, lamp standards on the refuges, chasse-roue bollards."""
import math
import mil as M
import castle_lib as CL
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

SC = 16.5                       # s of the local origin
S_N, S_PIER, S_CS, S_AB, S_RAMP = 8.7, (16.4, 17.8), 24.0, 26.0, 29.6
W = 5.1                         # between parapet outer faces
PT = 0.45                       # parapet thickness
PAR_H = 1.0
PAR_MID, COP_MID = CL.STONE, 'ashlar'           # rework 2: same warm grey rubble stone as the gatehouse, dressed copings
COP_TINT = (0.86, 0.84, 0.79)
ALGAE = (0.36, 0.42, 0.3)


def zd(x):
    """Deck (road crown) height at local x: hump from the drawbridge landing to the south abutment, then ramp."""
    s = x + SC
    if s <= 25.4:
        t = min(1.0, max(0.0, (s - 9.0) / 16.4))
        return 0.05 + 0.72 * math.sin(math.pi * t) + 0.3 * t
    u = min(1.0, (s - 25.4) / (S_RAMP - 25.4))
    return 0.35 * (1 - (3 * u * u - 2 * u ** 3))


class Deck(K.Deck):
    def __init__(s, x0, x1):
        super().__init__(x0, x1, 0.05, 0.0)

    def z(s, x):
        return zd(x)


def lx(s):
    return s - SC


def _wall_poly(bm, pts, zb, zt, t, inward):
    """Wall of thickness t along the 2D polyline pts (outer face), inner face offset toward `inward` (unit 2D)."""
    n = len(pts)
    P = [V((p[0], p[1], 0)) for p in pts]
    offs = []
    for i in range(n):
        ns = []
        for a, b in ((i - 1, i), (i, i + 1)):
            if 0 <= a and b < n:
                d = (P[b] - P[a]).normalized()
                nn = V((-d.y, d.x, 0))
                if nn.dot(V((*inward, 0))) < 0:
                    nn = -nn
                ns.append(nn)
        m = (ns[0] + ns[-1]).normalized()
        k = 1.0 / max(0.35, m.dot(ns[0]))
        offs.append(m * t * k)
    rows = []
    for p, o in zip(P, offs):
        x = p.x
        rows.append([bm.verts.new((p.x, p.y, zb(x))), bm.verts.new((p.x, p.y, zt(x))),
                     bm.verts.new((p.x + o.x, p.y + o.y, zt(x + o.x))), bm.verts.new((p.x + o.x, p.y + o.y, zb(x + o.x)))])
    for i in range(n - 1):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    return P, offs


def _densify(pts, step=1.2):
    out = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(round(L / step)))
        for i in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    return out


def parapet_line(pts, side, h_fn, name):
    """Coursed-ashlar parapet along pts (outer face) + individual coping stones overhanging both faces + drip."""
    pts = _densify(pts)
    inward = (0, -side)
    bm = bmesh.new()
    P, offs = _wall_poly(bm, pts, lambda x: zd(x) - 0.5, lambda x: zd(x) + h_fn(x), PT, inward)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, PAR_MID, name=name + '_wall', uv_scale=1.0)
    # coping: one continuous loft per run, profile = weathered top (falls 2 cm to the road), 8 cm overhang both
    # sides, throated drip lip under the outer overhang; stone joints come from the ashlar_limestone texture
    # coping: INDIVIDUAL dressed stones (one per ~0.95 m segment, 12 mm joints), weathered top falling 3 cm to the
    # road, 9 cm overhang both faces with a throated drip; flat shaded, three tone lots so the joints read from above
    prof = [(-0.09, -0.2), (-0.09, -0.05), (-0.02, 0.0), (PT + 0.09, -0.06), (PT + 0.09, -0.16), (PT + 0.03, -0.2)]                          # (inward offset along normal, dz), outer face at 0
    rr = K.rng()
    lots = [bmesh.new() for _ in range(3)]
    for i in range(len(P) - 1):
        rings = []
        for p, o, e in ((P[i], offs[i], 0.006), (P[i + 1], offs[i + 1], -0.006)):
            q = P[i] + (P[i + 1] - P[i]) * (0.0 if e > 0 else 1.0)
            dd = (P[i + 1] - P[i]).normalized()
            q = q + dd * e
            nrm = o.normalized()
            k = o.length / PT
            zt = zd(q.x) + h_fn(q.x) + 0.2
            rings.append([V((q.x, q.y, 0)) + nrm * (d * k) + V((0, 0, zt + dz)) for d, dz in prof])
        bm = lots[rr.randint(0, 2)]
        K.loft_bm(bm, rings, closed=True)
    for k, bm in enumerate(lots):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, COP_MID, name=name + '_coping', mat_tint=tuple(c * (0.94, 1.0, 1.05)[k] for c in COP_TINT), grime=0.8,
               uv_scale=0.8, smooth=False)
    return P


def cutwater_refuge(xp, pw, side, nose, z_bot, water, name):
    """Pointed cutwater on face `side` rising to deck level (refuge), sloped weathering at the starling."""
    y0 = side * W / 2
    tri = K.ccw([(xp - pw / 2, y0 - side * 0.3), (xp + pw / 2, y0 - side * 0.3), (xp + pw / 2, y0), (xp, y0 + side * nose), (xp - pw / 2, y0)])
    bm = bmesh.new()
    K.prism_bm(bm, tri, z_bot, zd(xp) - 0.12)
    K.part(bm, CL.STONE, name=name)
    st = 0.45                                             # starling: wider pointed footing to just above the water
    tri2 = K.ccw([(xp - pw / 2 - st, y0 - side * 0.3), (xp + pw / 2 + st, y0 - side * 0.3), (xp + pw / 2 + st, y0),
                  (xp, y0 + side * (nose + st * 1.7)), (xp - pw / 2 - st, y0)])
    bm = bmesh.new()
    K.prism_bm(bm, tri2, z_bot, water + 0.3)
    vs = [bm.verts.new((px, py, water + 0.3)) for px, py in tri2]           # sloped cap up to the cutwater
    top = [bm.verts.new((px, py, water + 0.75)) for px, py in tri]
    for i in range(len(tri)):
        j = (i + 1) % len(tri)
        bm.faces.new((vs[i], vs[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'ashlar', name=name + '_starling', mat_tint=(0.8, 0.8, 0.78))
    band = bmesh.new()                                    # waterline: dark algae band + paler lime tide mark above it
    K.prism_bm(band, offset_poly(tri2, 0.018), water - 0.25, water + 0.26)
    K.part(band, 'fieldstone_grey', name=name + '_algae', mat_tint=ALGAE, grime=0.2, bisect=False)
    zt = zd(xp) - 0.12                                    # stepped corbel courses capping the cutwater under the refuge
    bm = bmesh.new()
    for k, (d, z0, z1) in enumerate(((0.07, zt - 0.62, zt - 0.4), (0.15, zt - 0.4, zt - 0.16))):
        K.prism_bm(bm, offset_poly(tri, d), z0, z1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'ashlar', name=name + '_corbel', mat_tint=COP_TINT, smooth=False)
    return [(xp - pw / 2, y0), (xp, y0 + side * nose), (xp + pw / 2, y0)]


def offset_poly(poly, d):
    """Offset a convex CCW polygon outward by d (mitred corners)."""
    P = [V((x, y, 0)) for x, y in poly]
    n = len(P)
    out = []
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        n1 = V(((b - a).y, -(b - a).x, 0)).normalized()
        n2 = V(((c - b).y, -(c - b).x, 0)).normalized()
        m = (n1 + n2).normalized()
        k = d / max(0.3, m.dot(n1))
        out.append((b.x + m.x * k, b.y + m.y * k))
    return out


def road():
    """Setts carriageway (crowned, 0.15-0.2 m setts), granite kerbs, flagged footways; bell-mouth at the south ramp."""
    xa, xb = lx(9.0), lx(S_RAMP + 0.6)
    steps = 30
    cw = lambda x: 2.6 + max(0.0, (x + SC - 24.6) / (S_RAMP + 0.6 - 24.6)) * 3.4
    bm = bmesh.new()
    grid = []
    for i in range(steps + 1):
        x = xa + (xb - xa) * i / steps
        w = cw(x)
        grid.append([bm.verts.new((x, -w / 2 + w * j / 6, zd(x) + 0.07 * (1 - (2 * (-0.5 + j / 6)) ** 2))) for j in range(7)])
    for i in range(steps):
        for j in range(6):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'setts_granite', name='bridge_setts', grime=0.45, bisect=False, uv_scale=1.1, lod='keep', mat_tint=(0.95, 0.94, 0.92))
    xr = lx(27.0)                                        # worn wheel tracks (polished, darker) + dirty gutters by the kerbs
    for yy, w, tn, nm in ((-0.72, 0.34, 0.66, 'ruts'), (0.72, 0.34, 0.66, 'ruts'), (None, 0.16, 0.5, 'gutter'), (None, -0.16, 0.5, 'gutter')):
        bm = bmesh.new()
        rows = []
        for i in range(13):
            x = xa + (xr - xa) * i / 12
            if yy is None:
                g = cw(x) / 2 - 0.08
                ya, yb = (g - abs(w), g) if w > 0 else (-g, -g + abs(w))
            else:
                ya, yb = yy - w / 2, yy + w / 2
            crown = lambda y: 0.07 * (1 - (2 * y / cw(x)) ** 2)
            rows.append([bm.verts.new((x, y, zd(x) + crown(y) + 0.012)) for y in (ya, yb)])
        for i in range(12):
            for k in range(1):
                bm.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]))
        for f in bm.faces:
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
        K.part(bm, 'setts_granite', name='bridge_' + nm, grime=0.2, bisect=False, uv_scale=1.1, lod='drop', mat_tint=(tn, tn * 0.99, tn * 0.97))
    r = K.rng()                                          # wheel ruts / horse-dung streaks and puddle stains on the setts
    for i in range(9):
        x = xa + (xb - xa) * (i + 0.5) / 9
        if i % 3 == 1:
            K.decal('stain_blotch', (x, r.uniform(-0.8, 0.8), zd(x) + 0.078), (0, 0, 1), 1.2, 0.9, up=(0, 1, 0), alpha=0.45)
    bm = bmesh.new()                                     # kerbs
    xk = lx(27.1)                                        # kerbs stop at the wing-wall ends (no strip onto the grass)
    n = int((xk - xa) / 0.85)
    for s in (-1, 1):
        for i in range(n):
            x0_, x1_ = xa + (xk - xa) * i / n + 0.006, xa + (xk - xa) * (i + 1) / n - 0.006
            y0_, y1_ = s * (cw(x0_) / 2 + 0.12), s * (cw(x1_) / 2 + 0.12)
            sink = 0.14 if i == n - 1 else 0.0                # last stone dips into the approach setts
            K.beam_bm(bm, (x0_, y0_, zd(x0_) + 0.03), (x1_, y1_, zd(x1_) + 0.03 - sink), 0.24, 0.26)
    K.part(bm, 'granite', name='bridge_kerbs', mat_tint=(0.98, 0.97, 0.94))
    bm = bmesh.new()                                     # footways (flags) between kerb and parapet
    xe = lx(24.6)
    for s in (-1, 1):
        rows = []
        for i in range(31):
            x = xa + (xe - xa) * i / 30
            rows.append([bm.verts.new((x, s * 1.54, zd(x) + 0.15)), bm.verts.new((x, s * (W / 2 - PT + 0.02), zd(x) + 0.15))])
        for i in range(30):
            q = (rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1])
            bm.faces.new(q if s > 0 else tuple(reversed(q)))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'setts_granite', name='bridge_flags', uv_scale=1.6, mat_tint=(1.0, 0.98, 0.94), bisect=False, lod='keep')
    bm = bmesh.new()                                     # sub-base closing all gaps under the surfacing
    rows = []
    for i in range(steps + 1):
        x = xa + (xb - xa) * i / steps
        w = max(W, cw(x) + 1.0) / 2
        z = zd(x)
        rows.append([bm.verts.new((x, -w, z + 0.02)), bm.verts.new((x, w, z + 0.02)), bm.verts.new((x, w, z - 0.6)), bm.verts.new((x, -w, z - 0.6))])
    for i in range(steps):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'gravel', name='bridge_subbase', mat_tint=(0.7, 0.7, 0.7), grime=0, bisect=False)


def build(BED, WATER, ruin=False):
    """Build the bridge in local coords, turn it to run south; returns the list of created parts."""
    b0 = len(K.A().parts)
    Mt = K.A().meta
    n0 = {k: len(Mt.get(k, [])) for k in ('footprints', 'parapets', 'anchors')}
    x0, x1 = lx(S_N), lx(S_AB)
    deck = Deck(x0, x1)
    arches = [((lx(10.2) + lx(16.4)) / 2, 6.2, -3.0, 2.55), ((lx(17.8) + lx(24.0)) / 2, 6.2, -3.0, 2.55)]
    K.masonry_body(deck, arches, W - 0.1, BED, CL.STONE, name='bridge_body', steps=16)
    for a in arches:
        K.arch_ring(*a, W - 0.1, 'ashlar', depth=0.5, block=0.46)
    for s in (-1, 1):
        K.band(deck, s * (W / 2 - 0.05), x0, lx(S_CS), -0.62, 0.2, 0.09, 'ashlar', steps=12, name='bridge_band')
    refuges = {}
    for s in (-1, 1):
        refuges[s] = [cutwater_refuge((lx(S_PIER[0]) + lx(S_PIER[1])) / 2, 1.4, s, 1.5, BED, WATER, 'pier_cw'),
                      cutwater_refuge(lx(S_N) + 0.75, 1.5, s, 1.2, BED, WATER, 'npier_cw')]
    for s in (-1, 1):                                    # parapet outline incl. refuges + splayed south wing parapets
        y = s * W / 2
        mid = refuges[s][0]
        wing = [(lx(S_CS) + 0.4 + 2.8 * math.sin(a), s * (W / 2 + 2.3 * (1 - math.cos(a)))) for a in [math.pi / 2 * k / 5 for k in range(1, 6)]]
        nr = refuges[s][1]
        pts = [nr[0], nr[1], nr[2], mid[0], mid[1], mid[2], (lx(S_CS) + 0.4, y)] + wing
        xe = pts[-1][0]
        h = lambda x, xe=xe: PAR_H - 0.55 * max(0.0, min(1.0, (x - lx(S_CS)) / (xe - lx(S_CS))))
        parapet_line(pts, s, h, 'bridge_par')
        bm = bmesh.new()                                   # end piers with pyramid caps (north end + wing ends)
        for (px, py) in ((nr[0][0] + 0.2, y - s * PT / 2), (xe, pts[-1][1] - s * PT / 2)):
            z = zd(px) + h(px)
            K.box_bm(bm, (px, py, z / 2 - 0.25 + 0.15), (0.75, 0.75, z + 0.8))
            K.cyl_bm(bm, (px, py, z + 0.4), (px, py, z + 0.85), 0.5, 4, r1=0.02)
        K.part(bm, 'ashlar', name='bridge_endpier', mat_tint=COP_TINT, smooth=False)
        bm = bmesh.new()                                   # refuge floor flags
        a, b, c = mid
        K.prism_bm(bm, K.ccw([(a[0], a[1] - s * 0.62), (c[0], c[1] - s * 0.62), (c[0], c[1]), b]), zd(b[0]) - 0.2, zd(b[0]) + 0.15)
        K.part(bm, 'setts_granite', name='refuge_floor', uv_scale=1.1, mat_tint=(0.8, 0.79, 0.76))
        K.lamp_post((b[0], b[1] - s * 0.55, zd(b[0]) + 0.15), 4.0, name='bridge_lamp')
    bm = bmesh.new()                                      # chasse-roue bollards at the ramp foot and the drawbridge landing
    for x in (lx(S_N) + 1.8, lx(S_RAMP) - 0.3):
        for s in (-1, 1):
            yy = s * 1.45 if x < 0 else s * 3.0
            K.cyl_bm(bm, (x, yy, zd(x) - 0.1), (x, yy, zd(x) + 0.75), 0.2, 8, r1=0.12)
    K.part(bm, 'granite', name='bollards', mat_tint=(0.8, 0.8, 0.78), smooth=True)
    road()
    bm = bmesh.new()                                      # algae band on the pier / abutment faces between the arches
    for sa, sb in ((S_N, 10.2), S_PIER, (S_CS, S_AB)):
        for s in (-1, 1):
            y = s * ((W - 0.1) / 2 + 0.015)
            q = [bm.verts.new((lx(sa), y, WATER - 0.25)), bm.verts.new((lx(sb), y, WATER - 0.25)),
                 bm.verts.new((lx(sb), y, WATER + 0.26)), bm.verts.new((lx(sa), y, WATER + 0.26))]
            bm.faces.new(q if s < 0 else list(reversed(q)))
    K.part(bm, 'fieldstone_grey', name='pier_algae', mat_tint=ALGAE, grime=0.2, bisect=False)
    parts = K.A().parts[b0:]
    T = Matrix.Translation((0, -SC, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
    for o in parts:
        o.data.transform(T)
    tg = lambda p: [round(-p[1], 3), round(p[0] + SC, 3)]
    for f in Mt.get('footprints', [])[n0['footprints']:]:
        f['points'] = [tg(p) for p in f['points']]
    for pa in Mt.get('parapets', [])[n0['parapets']:]:
        pa['a'], pa['b'] = tg(pa['a']), tg(pa['b'])
    for an in Mt.get('anchors', [])[n0['anchors']:]:
        p = an['pos']
        an['pos'] = [round(-p[2], 3), p[1], round(p[0] + SC, 3)]
    return parts
