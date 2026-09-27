"""Kit bridges. Convention: road along Blender X (centred on x=0), river flowing along Y, banks/ground at z=0,
water at z=water (negative), deck top follows a parabolic camber. Parts are composable; stone_arch_bridge()
assembles a complete masonry bridge."""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix
import kit_core as C
from kit_core import part, box_bm, beam_bm, cyl_bm, rng


class Deck:
    """Road deck profile: z(x) = z_end + camber * (1 - (x/half)^2) between x0..x1."""

    def __init__(s, x0, x1, z_end=0.05, camber=0.5):
        s.x0, s.x1, s.z_end, s.camber = x0, x1, z_end, camber
        s.half = max(abs(x0), abs(x1))

    def z(s, x):
        u = max(-1.0, min(1.0, x / s.half))
        return s.z_end + s.camber * (1 - u * u)


def arch_profile(xc, span, spring, rise, n=24):
    """Intrados points (x,z) of a segmental/semicircular arch from left springing to right springing."""
    h = span / 2
    if abs(rise - h) < 1e-3:
        return [(xc - h * math.cos(math.pi * i / n), spring + h * math.sin(math.pi * i / n)) for i in range(n + 1)]
    R = (h * h + rise * rise) / (2 * rise)
    cz = spring + rise - R
    a0 = math.asin(max(-1, min(1, h / R)))
    return [(xc + R * math.sin(-a0 + 2 * a0 * i / n), cz + R * math.cos(-a0 + 2 * a0 * i / n)) for i in range(n + 1)]


def _prism_xz(bm, pts, y0, y1):
    """Extrude a CCW (x,z) polygon across Y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[j], a[i], b[i], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def masonry_body(deck, arches, width, z_found, mid='fieldstone', name='bridge_body', steps=10):
    """Solid bridge body: side profile from deck (cambered top) down to z_found, minus the arch openings
    (each arch = (xc, span, spring, rise)). Gives spandrels, piers, abutments and arch soffits in one mesh."""
    import kit_arch as KA
    xs = [deck.x0 + (deck.x1 - deck.x0) * i / (steps * 4) for i in range(steps * 4 + 1)]
    top = [(x, deck.z(x) - 0.28) for x in xs]           # body top sits under the road build-up
    prof = [(deck.x0, z_found), (deck.x1, z_found)] + list(reversed(top))
    bm = bmesh.new()
    _prism_xz(bm, prof, -width / 2, width / 2)
    cut = bmesh.new()
    for xc, span, spring, rise in arches:
        pts = arch_profile(xc, span, spring, rise, 28)
        poly = [(pts[0][0], z_found - 1.0), (pts[-1][0], z_found - 1.0)] + list(reversed(pts))
        _prism_xz(cut, poly, -width / 2 - 1, width / 2 + 1)
    bm = _bool(bm, cut)
    return part(bm, mid, name=name)


def _bool(bm, cutter_bm, op='DIFFERENCE'):
    me = bpy.data.meshes.new('tb')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('tb', me)
    bpy.context.scene.collection.objects.link(ob)
    cme = bpy.data.meshes.new('tc')
    cutter_bm.to_mesh(cme)
    cutter_bm.free()
    cob = bpy.data.objects.new('tc', cme)
    bpy.context.scene.collection.objects.link(cob)
    m = ob.modifiers.new('b', 'BOOLEAN')
    m.operation, m.solver, m.object = op, 'EXACT', cob
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    out = bmesh.new()
    out.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.objects.remove(cob)
    return out


def arch_ring(xc, span, spring, rise, width, mid='ashlar', depth=0.55, proud=0.035, block=0.34, key=True, soffit=True,
              name='voussoirs'):
    """Voussoir rings on both faces of an arch (individual dressed blocks, alternating depth, keystone),
    plus optional soffit ribs (arch barrel lining) in the same stone."""
    pts = arch_profile(xc, span, spring, rise, 64)
    L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    n = max(7, int(L / block)) | 1
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.dist(pts[i], pts[i + 1]))

    def at(t):
        d = t * L
        for i in range(len(pts) - 1):
            if cum[i + 1] >= d:
                u = (d - cum[i]) / max(1e-6, cum[i + 1] - cum[i])
                x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u
                z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u
                tx, tz = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
                ln = math.hypot(tx, tz)
                return x, z, -tz / ln, tx / ln          # point + outward (extrados) normal
        return pts[-1][0], pts[-1][1], 1, 0
    bm = bmesh.new()
    r = rng()
    gap = 0.012
    for k in range(n):
        t0, t1 = (k + gap * n / L) / n, (k + 1 - gap * n / L) / n
        iskey = key and k == n // 2
        dd = depth * (1.3 if iskey else (1.0 if k % 2 == 0 else 0.78)) * r.uniform(0.95, 1.05)
        x0, z0, nx0, nz0 = at(t0)
        x1, z1, nx1, nz1 = at(t1)
        for side in (-1, 1):
            yo = side * (width / 2 + proud + (0.015 if iskey else 0))
            yi = side * (width / 2 - 0.25)
            q = [(x0, z0), (x1, z1), (x1 + nx1 * dd, z1 + nz1 * dd), (x0 + nx0 * dd, z0 + nz0 * dd)]
            a = [bm.verts.new((x, yo, z)) for x, z in q]
            b = [bm.verts.new((x, yi, z)) for x, z in q]
            bm.faces.new(a)
            bm.faces.new(list(reversed(b)))
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((a[j], a[i], b[i], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = part(bm, mid, name=name)
    if soffit:          # arch barrel lining: courses of voussoir stones seen from below (slightly recessed ribs)
        bm = bmesh.new()
        m = 40
        for i in range(m):
            x0, z0, nx0, nz0 = at(i / m)
            x1, z1, nx1, nz1 = at((i + 1) / m)
            a = [bm.verts.new((x0 - nx0 * 0.02, y, z0 - nz0 * 0.02)) for y in (-width / 2, width / 2)]
            b = [bm.verts.new((x1 - nx1 * 0.02, y, z1 - nz1 * 0.02)) for y in (-width / 2, width / 2)]
            f = bm.faces.new((a[0], b[0], b[1], a[1]))
            f.normal_update()
            if f.normal.dot(V((-(nx0 + nx1), 0, -(nz0 + nz1)))) < 0:
                f.normal_flip()
        part(bm, mid, name=name + '_soffit', uv='beam', axis=(0, 1, 0), bisect=False)
    return ob


def cutwater(x, pier_w, width, z_bot, z_top, mid='ashlar', upstream=-1, nose=None, cap_h=None, round_down=True,
             starling=0.18, name='cutwater'):
    """Pointed cutwater on the upstream face (side `upstream` = -1 -> -Y) and rounded one downstream, each with a
    sloped weathering cap; wider starling footing up to just above the water line."""
    nose = nose or pier_w * 0.9
    cap_h = cap_h or pier_w * 0.55
    bm = bmesh.new()
    h = pier_w / 2
    y0 = upstream * width / 2
    tri = [(x - h, y0), (x + h, y0), (x, y0 + upstream * nose)]
    tri = C.ccw(tri)
    C.prism_bm(bm, tri, z_bot, z_top)
    apex = V((x, y0, z_top + cap_h))
    vs = [bm.verts.new((px, py, z_top)) for px, py in tri]
    va = bm.verts.new(apex)
    for i in range(3):
        bm.faces.new((vs[i], vs[(i + 1) % 3], va))
    if round_down:
        yd = -y0
        n = 10
        semi = [(x + h * math.cos(math.pi * i / n), yd - upstream * h * math.sin(math.pi * i / n) * 1.0) for i in range(n + 1)]
        semi = C.ccw(semi)
        C.prism_bm(bm, semi, z_bot, z_top)
        vs = [bm.verts.new((px, py, z_top)) for px, py in semi]
        va = bm.verts.new((x, yd, z_top + cap_h * 0.8))
        for i in range(len(vs)):
            bm.faces.new((vs[i], vs[(i + 1) % len(vs)], va))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, mid, name=name)
    if starling and C.A.water is not None:
        bm = bmesh.new()
        zt = C.A.water + 0.35
        pts = [(x - h - starling, -width / 2 - starling * 0.5), (x + h + starling, -width / 2 - starling * 0.5),
               (x + h + starling, width / 2 + starling * 0.5), (x - h - starling, width / 2 + starling * 0.5)]
        up = [(x - h - starling, y0), (x + h + starling, y0), (x, y0 + upstream * (nose + starling * 1.6))]
        C.prism_bm(bm, C.ccw(pts), z_bot, zt)
        C.prism_bm(bm, C.ccw(up), z_bot, zt)
        part(bm, mid, name=name + '_starling')


def wing_walls(x_end, side, width, z_bot, length=5.0, splay=35.0, thick=0.7, top=0.45, mid='fieldstone',
               coping='ashlar', name='wing'):
    """Splayed wing walls retaining the banks at a bridge end (side=-1 west end, +1 east end)."""
    import kit_arch as KA
    for s in (-1, 1):
        a = V((x_end, s * width / 2, 0))
        d = V((side * math.sin(math.radians(splay)), s * math.cos(math.radians(splay)), 0))
        nrm = V((d.y, -d.x, 0))
        if nrm.dot(V((-side, 0, 0))) < 0:
            nrm = -nrm                                     # face toward the river
        b = a + d * length
        pts = [a, b, b - nrm * thick, a - nrm * thick]
        bm = bmesh.new()
        tops = [top + 0.0, top * 0.35, top * 0.35, top]
        p8 = [p + V((0, 0, z_bot)) for p in pts] + [p + V((0, 0, t)) for p, t in zip(pts, tops)]
        fs = C.hexa_bm(bm, p8)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        part(bm, mid, name='%s_%d_%d' % (name, side, s))
        bm = bmesh.new()                                   # coping stones along the sloping top
        nb = max(2, int(length / 0.8))
        for i in range(nb):
            p0, p1 = a.lerp(b, i / nb) + d * 0.01, a.lerp(b, (i + 1) / nb) - d * 0.01
            z0, z1 = top + (top * 0.35 - top) * i / nb, top + (top * 0.35 - top) * (i + 1) / nb
            c0 = p0 - nrm * thick / 2 + V((0, 0, z0 + 0.07))
            c1 = p1 - nrm * thick / 2 + V((0, 0, z1 + 0.07))
            beam_bm(bm, c0, c1, thick + 0.1, 0.14)
        part(bm, coping, name='%s_cop_%d_%d' % (name, side, s))
        C.footprint([(p.x, p.y) for p in pts], 'LOW', 'wing_wall')


def parapet(deck, y_face, x0, x1, h=1.0, t=0.45, mid='fieldstone', coping='ashlar', steps=40, name='parapet', end_piers=True):
    """Solid parapet wall on the deck edge (outer face at y_face; inner face toward the road) following the camber,
    with individual coping stones and end piers with pyramidal caps."""
    s = 1 if y_face > 0 else -1
    ya, yb = y_face, y_face - s * t
    xs = [x0 + (x1 - x0) * i / steps for i in range(steps + 1)]
    bm = bmesh.new()
    rows = []
    for x in xs:
        zb, zt = deck.z(x) - 0.45, deck.z(x) + h
        rows.append([bm.verts.new((x, ya, zb)), bm.verts.new((x, ya, zt)), bm.verts.new((x, yb, zt)), bm.verts.new((x, yb, zb))])
    for i in range(steps):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, mid, name=name + '_wall')
    bm = bmesh.new()
    nb = max(2, int((x1 - x0) / 0.95))
    for i in range(nb):
        xa, xb = x0 + (x1 - x0) * i / nb + 0.008, x0 + (x1 - x0) * (i + 1) / nb - 0.008
        pa = V((xa, (ya + yb) / 2, deck.z(xa) + h + 0.07))
        pb = V((xb, (ya + yb) / 2, deck.z(xb) + h + 0.07))
        beam_bm(bm, pa, pb, t + 0.1, 0.14 + rng().uniform(-0.01, 0.01), up=(0, 0, 1))
    if end_piers:
        for x in (x0, x1):
            z = deck.z(x)
            box_bm(bm, (x, (ya + yb) / 2, z + (h + 0.3) / 2 - 0.2), (0.7, t + 0.2, h + 0.5))
            b0 = [V((x - 0.4, (ya + yb) / 2 - (t + 0.3) / 2, z + h + 0.3)), V((x + 0.4, (ya + yb) / 2 - (t + 0.3) / 2, z + h + 0.3)),
                  V((x + 0.4, (ya + yb) / 2 + (t + 0.3) / 2, z + h + 0.3)), V((x - 0.4, (ya + yb) / 2 + (t + 0.3) / 2, z + h + 0.3))]
            C.hexa_bm(bm, b0 + [p + V((0, 0, 0.12)) for p in b0])
            vs = [bm.verts.new(p + V((0, 0, 0.12))) for p in b0]
            ap = bm.verts.new(V((x, (ya + yb) / 2, z + h + 0.72)))
            for k in range(4):
                bm.faces.new((vs[k], vs[(k + 1) % 4], ap))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, coping, name=name + '_coping')
    C.A.meta.setdefault('parapets', []).append({'a': C.g2((x0, (ya + yb) / 2)), 'b': C.g2((x1, (ya + yb) / 2)), 'h': h, 'block': 'LOW'})


def band(deck, y_face, x0, x1, dz=-0.35, h=0.22, proj=0.1, mid='ashlar', steps=40, name='band'):
    """Projecting string course / cornice along a bridge face, following the camber (dz below deck line)."""
    s = 1 if y_face > 0 else -1
    bm = bmesh.new()
    rows = []
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        z = deck.z(x) + dz
        rows.append([bm.verts.new((x, y_face - s * 0.2, z)), bm.verts.new((x, y_face + s * proj, z + 0.03)),
                     bm.verts.new((x, y_face + s * proj, z + h)), bm.verts.new((x, y_face - s * 0.2, z + h))])
    for i in range(steps):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return part(bm, mid, name=name)


def road(deck, x0, x1, width, surface='cobblestone', kerb='granite', kerb_w=0.3, kerb_h=0.12, crown=0.06, steps=40,
         name='road'):
    """Road surface following camber with a crowned cross-section, plus individual kerb stones."""
    bm = bmesh.new()
    ny = 6
    rw = width - 2 * kerb_w
    grid = []
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        row = []
        for j in range(ny + 1):
            y = -rw / 2 + rw * j / ny
            row.append(bm.verts.new((x, y, deck.z(x) + crown * (1 - (2 * y / rw) ** 2))))
        grid.append(row)
    for i in range(steps):
        for j in range(ny):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    part(bm, surface, name=name, grime=0.3, bisect=False, lod='keep')
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * (rw / 2 + kerb_w / 2)
        n = max(2, int((x1 - x0) / 0.9))
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n + 0.005, x0 + (x1 - x0) * (i + 1) / n - 0.005
            beam_bm(bm, (xa, y, deck.z(xa) + kerb_h / 2 - 0.05), (xb, y, deck.z(xb) + kerb_h / 2 - 0.05), kerb_w, kerb_h + 0.1)
    part(bm, kerb, name=name + '_kerbs')
    # sub-base: hides the gap between the road and the parapets / body
    bm = bmesh.new()
    rows = []
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        z = deck.z(x)
        rows.append([bm.verts.new((x, -width / 2, z - 0.02)), bm.verts.new((x, width / 2, z - 0.02)),
                     bm.verts.new((x, width / 2, z - 0.35)), bm.verts.new((x, -width / 2, z - 0.35))])
    for i in range(steps):
        a, b = rows[i], rows[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, 'gravel', name=name + '_base', grime=0, bisect=False, lod='drop')


def lamp_post(p, h=4.2, name='lamp', arm=False):
    """Cast-iron lamp standard: octagonal plinth base, tapered fluted shaft with collars, ladder bar, lantern
    (glass panes, cap, finial). Registers a 'light' anchor."""
    p = V(p)
    bm = bmesh.new()
    cyl_bm(bm, p, p + V((0, 0, 0.45)), 0.2, 8, r1=0.16)
    cyl_bm(bm, p + V((0, 0, 0.45)), p + V((0, 0, 0.55)), 0.18, 8, r1=0.12)
    cyl_bm(bm, p + V((0, 0, 0.55)), p + V((0, 0, h - 0.5)), 0.085, 8, r1=0.055)
    for zc in (1.2, h - 0.9):
        cyl_bm(bm, p + V((0, 0, zc)), p + V((0, 0, zc + 0.07)), 0.1, 8)
    cyl_bm(bm, p + V((-0.32, 0, h - 0.75)), p + V((0.32, 0, h - 0.75)), 0.018, 6)
    top = p + V((0, 0, h - 0.5))
    cyl_bm(bm, top, top + V((0, 0, 0.08)), 0.1, 8, r1=0.16)
    lz = top + V((0, 0, 0.08))
    for a in range(4):                                   # lantern corner bars
        ang = a * math.pi / 2
        d0 = V((math.cos(ang), math.sin(ang), 0))
        cyl_bm(bm, lz + d0 * 0.17, lz + d0 * 0.23 + V((0, 0, 0.5)), 0.012, 4)
    cyl_bm(bm, lz + V((0, 0, 0.5)), lz + V((0, 0, 0.72)), 0.33, 4, r1=0.02)
    cyl_bm(bm, lz + V((0, 0, 0.72)), lz + V((0, 0, 0.86)), 0.02, 6, r1=0.005)
    part(bm, 'cast_iron', name=name, smooth=False, grime=0.3)
    bm = bmesh.new()
    cyl_bm(bm, lz + V((0, 0, 0.01)), lz + V((0, 0, 0.5)), 0.2 * 1.414 / 1.414, 4, r1=0.26, caps=False)
    part(bm, 'glass_dirty', name=name + '_glass', grime=0, bisect=False)
    C.anchor('light', tuple(lz + V((0, 0, 0.3))), kind='lamp', radius=9.0)


def pilaster(x, y_face, z0, z1, w=0.9, proj=0.12, mid='ashlar', name='pilaster'):
    s = 1 if y_face > 0 else -1
    bm = bmesh.new()
    box_bm(bm, (x, y_face + s * (proj / 2 - 0.1), (z0 + z1) / 2), (w, proj + 0.2, z1 - z0))
    part(bm, mid, name=name)


def bridge_meta(deck, x0, x1, width, water, river_width, extra=None):
    """Sidecar data for the nav grid: walkable deck polygon (grid.bridge=1), water level, river width."""
    poly = [(x0, -width / 2), (x1, -width / 2), (x1, width / 2), (x0, width / 2)]
    C.A.meta['bridge'] = {'axis': 'x (road east-west, river flows north-south)', 'deck': [C.g2(p) for p in poly],
                          'deck_top': round(deck.z(0), 3), 'deck_end': round(deck.z(x1), 3), 'water_level': water,
                          'river_width': river_width, 'camber': deck.camber}
    if extra:
        C.A.meta['bridge'].update(extra)
    C.A.meta['footprints'].append({'shape': 'poly', 'points': [C.g2(p) for p in poly], 'block': 'NONE', 'kind': 'bridge_deck'})


def stone_arch_bridge(spans=((10, 3.4), (12, 4.0), (10, 3.4)), pier_w=2.2, width=7.6, water=-4.0, bed=-6.6,
                      spring=-4.3, camber=0.9, abut=2.8, approach=3.5, body='fieldstone', dressed='ashlar',
                      coping='ashlar_limestone', parapet_h=1.0, road_mid='cobblestone', kerb='granite', wing_len=6.0,
                      lamps=True, upstream=-1, decals=True):
    """Complete masonry arch bridge: segmental arches (span, rise), piers with pointed/round cutwaters and starlings,
    pilasters, abutments + splayed wing walls, rubble spandrels, voussoir rings, string course, parapets with coping
    and end piers, cambered cobbled road with kerbs, cast-iron lamps, waterline / efflorescence / moss decals.
    Returns dict with deck + layout."""
    import kit_weather as W
    tot = sum(sp for sp, _ in spans) + pier_w * (len(spans) - 1)
    xa = -tot / 2
    x0, x1 = xa - abut, -xa + abut
    deck = Deck(x0, x1, 0.05, camber)
    arches, piers = [], []
    x = xa
    for i, (sp, rise) in enumerate(spans):
        arches.append((x + sp / 2, sp, spring, rise))
        x += sp
        if i < len(spans) - 1:
            piers.append(x + pier_w / 2)
            x += pier_w
    masonry_body(deck, arches, width, bed, body)
    for a in arches:
        arch_ring(*a, width, dressed, depth=0.6, block=0.36)
    for px in piers:
        cutwater(px, pier_w, width, bed, spring + 1.4, dressed, upstream=upstream)
        for s in (-1, 1):
            pilaster(px, s * width / 2, spring + 1.4, deck.z(px) - 0.45, pier_w * 0.75, 0.12, dressed)
    for s in (-1, 1):                                  # quoins on the abutment faces
        for side in (-1, 1):
            xe = side * tot / 2
            bm = bmesh.new()
            z = bed
            k = 0
            while z < deck.z(xe) - 0.5:
                h = 0.4
                L = 0.55 if k % 2 == 0 else 0.35
                box_bm(bm, (xe + side * L / 2, s * (width / 2 + 0.015), z + h / 2), (L, 0.5, h - 0.012))
                z += h
                k += 1
            part(bm, dressed, name='abut_quoins_%d_%d' % (s, side))
        band(deck, s * width / 2, x0, x1, -0.45, 0.24, 0.1, dressed, name='band_%d' % s)
        parapet(deck, s * width / 2, x0 - 0.4, x1 + 0.4, parapet_h, 0.45, body, coping, name='parapet_%d' % s)
    for side in (-1, 1):
        wing_walls(side * (tot / 2 + abut), side, width, bed, wing_len, 35.0, 0.8, 0.45, body, coping)
    road(deck, x0 - approach, x1 + approach, width - 0.9, road_mid, kerb)
    if lamps:
        for i, px in enumerate(piers):
            s = -1 if i % 2 == 0 else 1
            lamp_post((px, s * (width / 2 - 0.45 - 0.35), deck.z(px) + 0.07), 4.2, name='lamp_%d' % i)
    if decals:
        r = rng()
        for px in piers:
            for s in (-1, 1):
                W.decal('waterline', (px, s * (width / 2 + 0.2), water + 0.35), (0, s, 0), pier_w + 0.4, 1.4)
        for xc, sp, spz, rise in arches:
            for s in (-1, 1):
                W.decal('efflorescence', (xc + r.uniform(-1, 1), s * (width / 2 + 0.04), spz + rise + 0.25), (0, s, 0), sp * 0.3, 1.0, alpha=0.4)
                W.decal('streak_long', (xc + r.uniform(-2, 2), s * (width / 2 + 0.001), deck.z(xc) - 1.35), (0, s, 0), 1.6, 1.2, alpha=0.4)
        for side in (-1, 1):
            xe = side * tot / 2
            for s in (-1, 1):
                W.decal('moss_patch', (xe + side * 0.01, s * (width / 2 - 1.2), water + 0.6), (-side, 0, 0), 2.2, 1.2)
                W.decal('waterline', (xe + side * 0.01, s * (width / 2 - 1.8), water + 0.35), (-side, 0, 0), 3.5, 1.4)
    for px in piers:
        C.footprint_rect(px, 0, pier_w, width + 2 * pier_w, block='HIGH', kind='pier')
    bridge_meta(deck, x0 - approach, x1 + approach, width - 0.9, water, tot, {'spans': [list(a) for a in arches], 'piers': piers})
    return {'deck': deck, 'arches': arches, 'piers': piers, 'x0': x0, 'x1': x1, 'tot': tot}


# ------------------------------------------------------------------ steel
def ibeam_bm(bm, p0, p1, depth, fw, tw=0.014, tf=0.02, up=(0, 0, 1)):
    """Built-up I-section from p0 to p1; the web lies along `up` (depth), flanges width fw."""
    p0, p1 = V(p0), V(p1)
    ax = (p1 - p0).normalized()
    u = V(up)
    u = (u - ax * u.dot(ax)).normalized()
    beam_bm(bm, p0, p1, tw, depth - 2 * tf, up=u)
    for s in (-1, 1):
        o = u * s * (depth / 2 - tf / 2)
        beam_bm(bm, p0 + o, p1 + o, fw, tf, up=u)


def rivet_bm(bm, p, n, r=0.012, h=0.01):
    """Low-poly snap-head rivet (5-sided cone) at point p facing normal n."""
    n = V(n).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    ring = [bm.verts.new(V(p) + (a * math.cos(2 * math.pi * i / 5) + b * math.sin(2 * math.pi * i / 5)) * r) for i in range(5)]
    tip = bm.verts.new(V(p) + n * h)
    for i in range(5):
        bm.faces.new((ring[i], ring[(i + 1) % 5], tip))


def rivet_line(bm, p0, p1, n, pitch=0.12, off=None):
    p0, p1 = V(p0), V(p1)
    k = max(1, int((p1 - p0).length / pitch))
    for i in range(k + 1):
        rivet_bm(bm, p0.lerp(p1, i / k) + (V(off) if off else V()), n)


def gusset_bm(bm, c, n, w=0.7, h=0.6, t=0.012, right=(1, 0, 0), rivets=None, grid=(4, 3)):
    """Gusset plate (clipped rectangle) centred at c in the plane with normal n; optional rivet grid on bm `rivets`."""
    n, r = V(n).normalized(), V(right).normalized()
    u = n.cross(r).normalized()
    k = 0.12
    ol = [(-w / 2 + k, -h / 2), (w / 2 - k, -h / 2), (w / 2, -h / 2 + k), (w / 2, h / 2 - k), (w / 2 - k, h / 2),
          (-w / 2 + k, h / 2), (-w / 2, h / 2 - k), (-w / 2, -h / 2 + k)]
    f = [bm.verts.new(V(c) + r * x + u * y + n * t) for x, y in ol]
    g = [bm.verts.new(V(c) + r * x + u * y) for x, y in ol]
    bm.faces.new(f)
    bm.faces.new(list(reversed(g)))
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((f[j], f[i], g[i], g[j]))
    if rivets is not None:
        gx, gy = grid
        for i in range(gx):
            for j in range(gy):
                x = (i / (gx - 1) - 0.5) * (w - 0.18)
                y = (j / (gy - 1) - 0.5) * (h - 0.18)
                rivet_bm(rivets, V(c) + r * x + u * y + n * t, n)


def steel_truss(x0, x1, z_deck, height=5.0, width=6.0, panels=8, kind='pratt', mid='steel_painted', rivets=True,
                deck_mid='deck_planks', portal=True, name='truss'):
    """Riveted through-truss span between x0..x1 (bearings at x0/x1, deck at z_deck): two trusses (Pratt / Warren /
    Howe) of built-up I members, gusset plates with rivets, floor beams, stringers, plank deck with wheel guards,
    top lateral X-bracing and portal frames with knee braces."""
    zb, zt = z_deck - 0.35, z_deck - 0.35 + height
    L = x1 - x0
    px = [x0 + L * i / panels for i in range(panels + 1)]
    bm, rv = bmesh.new(), bmesh.new()
    for s in (-1, 1):
        y = s * width / 2
        n_out = V((0, s, 0))
        top_nodes = [(px[i], y, zt) for i in range(1, panels)] if kind != 'warren' else [((px[i] + px[i + 1]) / 2, y, zt) for i in range(panels)]
        for i in range(panels):
            ibeam_bm(bm, (px[i], y, zb), (px[i + 1], y, zb), 0.45, 0.3, up=(0, 0, 1))
        for a, b in zip(top_nodes[:-1], top_nodes[1:]):
            ibeam_bm(bm, a, b, 0.45, 0.35, up=(0, 0, 1))
        if kind == 'warren':
            for i in range(panels):
                ibeam_bm(bm, (px[i], y, zb), top_nodes[i], 0.3, 0.25, up=(0, 1, 0))
                ibeam_bm(bm, top_nodes[i], (px[i + 1], y, zb), 0.3, 0.25, up=(0, 1, 0))
        else:
            ibeam_bm(bm, (px[0], y, zb), top_nodes[0], 0.42, 0.32, up=(0, 1, 0))           # inclined end posts
            ibeam_bm(bm, (px[-1], y, zb), top_nodes[-1], 0.42, 0.32, up=(0, 1, 0))
            for i in range(1, panels):
                ibeam_bm(bm, (px[i], y, zb), (px[i], y, zt), 0.28, 0.22, up=(1, 0, 0))
            for i in range(1, panels - 1):
                left = px[i] < (x0 + x1) / 2 - 1e-3
                a, b = ((px[i], y, zt), (px[i + 1], y, zb)) if left else ((px[i + 1], y, zt), (px[i], y, zb))
                if kind == 'howe':
                    a, b = (a[0], y, zb), (b[0], y, zt)
                ibeam_bm(bm, a, b, 0.22, 0.2, up=(0, 1, 0))
        for p in [(x, y, zb) for x in px] + list(top_nodes):
            for side in (1, -1):
                gusset_bm(bm, V(p) + V((0, side * 0.12 * s, 0)), n_out * side, 0.8, 0.7, rivets=rv if (rivets and side == 1) else None)
        if rivets:
            for a, b in zip(top_nodes[:-1], top_nodes[1:]):
                rivet_line(rv, V(a) + V((0.4, s * 0.02, 0.2)), V(b) + V((-0.4, s * 0.02, 0.2)), (0, 0, 1), 0.2)
    part(bm, mid, name=name + '_members', uv='beam', axis=(1, 0, 0), grime=0.6)
    if rivets:
        part(rv, mid, name=name + '_rivets', grime=0.4, bisect=False)
    # floor system
    bm = bmesh.new()
    for x in px:
        ibeam_bm(bm, (x, -width / 2, zb + 0.1), (x, width / 2, zb + 0.1), 0.5, 0.25, up=(0, 0, 1))
    for yy in (-1.6, -0.55, 0.55, 1.6):
        ibeam_bm(bm, (x0, yy * width / 6.0, zb + 0.5), (x1, yy * width / 6.0, zb + 0.5), 0.3, 0.16, up=(0, 0, 1))
    if kind != 'warren':    # top lateral bracing + struts
        for i in range(1, panels):
            ibeam_bm(bm, (px[i], -width / 2, zt), (px[i], width / 2, zt), 0.25, 0.18, up=(0, 0, 1))
        for i in range(1, panels - 1):
            beam_bm(bm, (px[i], -width / 2, zt + 0.1), (px[i + 1], width / 2, zt + 0.1), 0.1, 0.1)
            beam_bm(bm, (px[i], width / 2, zt + 0.1), (px[i + 1], -width / 2, zt + 0.1), 0.1, 0.1)
    if portal and kind != 'warren':
        for i, x in ((1, px[1]), (panels - 1, px[-2])):
            for zz in (zt - 0.9,):
                ibeam_bm(bm, (x, -width / 2, zz), (x, width / 2, zz), 0.5, 0.2, up=(0, 0, 1))
                for s in (-1, 1):
                    beam_bm(bm, (x, s * width / 2, zz - 0.9), (x, s * (width / 2 - 0.9), zz), 0.12, 0.12)
    part(bm, mid, name=name + '_floor', uv='beam', axis=(0, 1, 0), grime=0.6)
    deck_planks(x0, x1, z_deck, width - 0.5, deck_mid)
    bm = bmesh.new()
    for s in (-1, 1):
        beam_bm(bm, (x0, s * (width / 2 - 0.5), z_deck + 0.1), (x1, s * (width / 2 - 0.5), z_deck + 0.1), 0.2, 0.2)
    part(bm, 'timber_tarred', name=name + '_guards', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    for x in (x0, x1):                                   # bearings (shoes) on the abutment seats
        for s in (-1, 1):
            box_bm(bm, (x, s * width / 2, zb - 0.3), (0.8, 0.6, 0.12))
            cyl_bm(bm, (x, s * width / 2 - 0.25, zb - 0.16), (x, s * width / 2 + 0.25, zb - 0.16), 0.08, 8)
    part(bm, 'cast_iron', name=name + '_bearings')
    return {'z_bottom': zb, 'z_top': zt, 'panels': px}


def deck_planks(x0, x1, z, width, mid='deck_planks', plank=0.25, gap=0.012, name='deck'):
    """Transverse plank deck: individual boards (random length offsets / heights) - for timber and truss bridges."""
    r = rng()
    bm = bmesh.new()
    n = int((x1 - x0) / plank)
    for i in range(n):
        xa = x0 + i * plank + gap / 2
        c = xa + (plank - gap) / 2
        dy = r.uniform(-0.08, 0.08)
        box_bm(bm, (c, dy, z - 0.04 + r.uniform(-0.006, 0.006)), (plank - gap, width + r.uniform(-0.1, 0.1), 0.08))
    part(bm, mid, name=name, uv='beam', axis=(0, 1, 0), grime=0.4, bisect=False)


def plate_girder(x0, x1, y, z_top, depth=1.4, fw=0.45, mid='steel_painted', stiff=1.3, rivets=True, name='girder'):
    """Riveted plate girder (deck or half-through): web plate, flange plates, stiffener angles, rivet rows."""
    bm, rv = bmesh.new(), bmesh.new()
    zc = z_top - depth / 2
    ibeam_bm(bm, (x0, y, zc), (x1, y, zc), depth, fw, 0.016, 0.03)
    n = max(2, int((x1 - x0) / stiff))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        for s in (-1, 1):
            beam_bm(bm, (x, y + s * 0.05, z_top - depth + 0.04), (x, y + s * 0.05, z_top - 0.04), 0.1, 0.1)
            if rivets:
                rivet_line(rv, (x + 0.06, y + s * 0.1, z_top - depth + 0.12), (x + 0.06, y + s * 0.1, z_top - 0.12), (0, s, 0), 0.16)
    if rivets:
        for s in (-1, 1):
            for zz in (z_top - 0.07, z_top - depth + 0.07):
                rivet_line(rv, (x0 + 0.1, y + s * 0.1, zz), (x1 - 0.1, y + s * 0.1, zz), (0, s, 0), 0.15)
        part(rv, mid, name=name + '_rivets', grime=0.4, bisect=False)
    return part(bm, mid, name=name, uv='beam', axis=(1, 0, 0), grime=0.6)


def timber_trestle(x0, x1, z_deck, width=4.2, bents=None, z_ground=None, spacing=4.5, mid='timber_tarred',
                   deck_mid='deck_planks', rails=True, name='trestle'):
    """Timber trestle bridge: bents of 4 posts (2 plumb + 2 battered) with cap, sill, X-bracing and girts, stringers,
    plank deck, guard rails. bents: list of (x, z_ground); default = evenly spaced with z_ground(x) (callable or float)."""
    if bents is None:
        n = max(1, int((x1 - x0) / spacing))
        zg = z_ground if callable(z_ground) else (lambda x, v=(z_ground if z_ground is not None else z_deck - 5): v)
        bents = [(x0 + (x1 - x0) * i / n, zg(x0 + (x1 - x0) * i / n)) for i in range(n + 1)]
    bm = bmesh.new()
    zc = z_deck - 0.55
    for x, zg in bents:
        H = zc - zg
        if H < 0.3:
            continue
        bat = 0.12 * H
        tops = [-width / 2 + 0.2, -0.45, 0.45, width / 2 - 0.2]
        bots = [tops[0] - bat, tops[1], tops[2], tops[3] + bat]
        for yt, yb in zip(tops, bots):
            beam_bm(bm, (x, yb, zg), (x, yt, zc - 0.15), 0.28, 0.28)
        beam_bm(bm, (x, tops[0] - 0.3, zc - 0.15), (x, tops[3] + 0.3, zc - 0.15), 0.32, 0.3)    # cap
        beam_bm(bm, (x, bots[0] - 0.3, zg + 0.15), (x, bots[3] + 0.3, zg + 0.15), 0.32, 0.3)    # sill
        levels = max(1, int(H / 3.5))
        for k in range(levels):
            za, zb2 = zg + 0.3 + (H - 0.5) * k / levels, zg + 0.3 + (H - 0.5) * (k + 1) / levels
            ya = lambda z: (tops[0] - bat * (1 - (z - zg) / H), tops[3] + bat * (1 - (z - zg) / H))
            (l0, r0), (l1, r1) = ya(za), ya(zb2)
            for s in (-1, 1):
                xo = x + s * 0.2
                beam_bm(bm, (xo, l0, za), (xo, r1, zb2), 0.08, 0.22, up=(1, 0, 0))
                beam_bm(bm, (xo, r0, za), (xo, l1, zb2), 0.08, 0.22, up=(1, 0, 0))
            if k > 0:
                beam_bm(bm, (x + 0.2, l0, za), (x + 0.2, r0, za), 0.08, 0.22, up=(1, 0, 0))
    part(bm, mid, name=name + '_bents', uv='beam', axis=(0, 0, 1))
    bm = bmesh.new()
    for yy in (-1.3, -0.45, 0.45, 1.3):
        beam_bm(bm, (x0 - 0.3, yy * width / 4.2, zc + 0.1), (x1 + 0.3, yy * width / 4.2, zc + 0.1), 0.25, 0.4)
    part(bm, 'timber_beam', name=name + '_stringers', uv='beam', axis=(1, 0, 0))
    deck_planks(x0 - 0.3, x1 + 0.3, z_deck, width, deck_mid)
    if rails:
        from kit_detail import railing
        for s in (-1, 1):
            railing((x0, s * (width / 2 - 0.1), z_deck), (x1, s * (width / 2 - 0.1), z_deck), 1.05, 'timber', 2.0, name='%s_rail%d' % (name, s))
    return bents


def abutment(x, side, width, z_top, z_bot, depth=3.0, mid='ashlar', coping='ashlar_limestone', wings=True, wing_len=5.0,
             name='abutment'):
    """Masonry abutment block (face toward the river at x, extending away on `side`), bearing seat and wing walls."""
    bm = bmesh.new()
    box_bm(bm, (x + side * depth / 2, 0, (z_top + z_bot) / 2), (depth, width + 1.2, z_top - z_bot))
    part(bm, mid, name=name + '_%d' % side)
    bm = bmesh.new()
    box_bm(bm, (x + side * 0.3, 0, z_top + 0.06), (0.8, width + 1.4, 0.12))
    part(bm, coping, name=name + '_seat%d' % side)
    if wings:
        wing_walls(x + side * depth, side, width + 1.2, z_bot, wing_len, 30.0, 0.8, 0.45, mid, coping, name='%s_wing' % name)
