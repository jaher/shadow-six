"""Kit details: quoins, string courses / cornices, stairs, ladders, balconies, railings, signs, wall lanterns."""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix
import kit_core as C
from kit_core import part, box_bm, beam_bm, cyl_bm, rng


def quoins(poly, z0, z1, mid='ashlar_limestone', block_h=0.3, long=0.5, short=0.28, proud=0.018, depth=0.12, name='quoins',
           corners=None):
    """Dressed corner stones (alternating long/short) at every convex corner of CCW footprint `poly`
    (or only at vertex indices `corners`)."""
    poly = C.ccw(poly)
    bm = bmesh.new()
    n = len(poly)
    r = rng()
    for i in range(n):
        p = V((*poly[i], 0))
        a = (V((*poly[i - 1], 0)) - p).normalized()
        b = (V((*poly[(i + 1) % n], 0)) - p).normalized()
        if a.cross(b).z > 0 or (corners is not None and i not in corners):   # reflex / not requested
            continue
        k = 0
        z = z0
        while z < z1 - 0.05:
            h = min(block_h * r.uniform(0.9, 1.1), z1 - z)
            la, lb = (long, short) if k % 2 == 0 else (short, long)
            na, nb = V((-a.y, a.x, 0)), V((b.y, -b.x, 0))      # outward normals of the two faces
            for d, L, nn in ((a, la, na), (b, lb, nb)):
                q = [p - d * proud + nn * proud, p + d * L + nn * proud, p + d * L - nn * depth, p - d * proud - nn * depth]
                C.hexa_bm(bm, [x + V((0, 0, z + 0.006)) for x in q] + [x + V((0, 0, z + h - 0.006)) for x in q])
            z += h
            k += 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return part(bm, mid, name=name)


def course(poly, z, h, proj, mid='ashlar_limestone', inset=0.05, name='course'):
    """Projecting band (string course, plinth, eaves cornice) around CCW footprint."""
    import kit_arch as KA
    poly = C.ccw(poly)
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(poly, proj), C.poly_offset(poly, -inset), z, z + h)
    return part(bm, mid, name=name)


def cornice(poly, z, mid='ashlar_limestone', steps=((0.06, 0.08), (0.12, 0.07), (0.2, 0.1)), name='cornice'):
    """Stepped moulded cornice: list of (projection, height) from bottom to top."""
    zz = z
    for i, (pj, h) in enumerate(steps):
        course(poly, zz, h, pj, mid, name='%s_%d' % (name, i))
        zz += h
    return zz


def stairs(p0, direction, width, rise, n=None, mid='ashlar', solid=True, cheek=None, name='stairs', meta=True):
    """Straight flight: bottom front edge centre p0, climbing along `direction`. rise = total height.
    solid=True: masonry steps on a solid base (+ optional cheek walls material `cheek`); False: timber treads on stringers.
    Registers a ladder/stair nav link. Returns top landing centre (world)."""
    d = V(direction).normalized()
    s = V((d.y, -d.x, 0))
    n = n or max(2, int(round(rise / 0.18)))
    rh = rise / n
    go = 0.28
    bm = bmesh.new()
    p0 = V(p0)
    for i in range(n):
        c = p0 + d * (go * i + go / 2)
        h = (i + 1) * rh
        if solid:
            q = [c - d * (go / 2 + 0.03) - s * width / 2, c + d * go / 2 - s * width / 2, c + d * go / 2 + s * width / 2, c - d * (go / 2 + 0.03) + s * width / 2]
            q = q if (q[1] - q[0]).cross(q[3] - q[0]).z > 0 else [q[0], q[3], q[2], q[1]]
            base = 0.0 if i == 0 else h - rh - 0.02
            C.hexa_bm(bm, [x + V((0, 0, base)) for x in q] + [x + V((0, 0, h)) for x in q])
        else:
            beam_bm(bm, c - s * width / 2 + V((0, 0, h - 0.02)), c + s * width / 2 + V((0, 0, h - 0.02)), go + 0.03, 0.04)
    if solid:       # solid masonry base under the flight
        q = [p0 - s * width / 2, p0 + d * go * n - s * width / 2, p0 + d * go * n + s * width / 2, p0 + s * width / 2]
        q = q if (q[1] - q[0]).cross(q[3] - q[0]).z > 0 else [q[0], q[3], q[2], q[1]]
        tops = [0.0, rise - rh, rise - rh, 0.0]
        C.hexa_bm(bm, [x for x in q] + [x + V((0, 0, max(0.01, tz - 0.01))) for x, tz in zip(q, tops)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, mid, name=name, uv='beam' if not solid else 'aligned', axis=tuple(s))
    top = p0 + d * (go * n) + V((0, 0, rise))
    if not solid:
        bm = bmesh.new()
        for k in (-1, 1):
            a = p0 + s * k * (width / 2 + 0.03) + V((0, 0, 0.0))
            beam_bm(bm, a, a + d * go * n + V((0, 0, rise)), 0.05, 0.25)
        part(bm, 'timber_beam', name=name + '_stringers', uv='beam', axis=tuple(d))
    if cheek:
        bm = bmesh.new()
        for k in (-1, 1):
            a = p0 + s * k * (width / 2 + 0.12)
            pts = [a, a + d * go * n, a + d * go * n + V((0, 0, rise + 0.9)), a + V((0, 0, 0.9))]
            r0 = [x - s * 0.12 for x in pts]
            r1 = [x + s * 0.12 for x in pts]
            C.loft_bm(bm, [r0, r1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        part(bm, cheek, name=name + '_cheeks')
    if meta:
        C.ladder_meta((p0 - d * 0.4).to_tuple(), (top + d * 0.4).to_tuple(), rise)
        C.footprint([(p0 - s * width / 2).to_tuple()[:2], (p0 + s * width / 2).to_tuple()[:2],
                     (p0 + s * width / 2 + d * go * n).to_tuple()[:2], (p0 - s * width / 2 + d * go * n).to_tuple()[:2]], 'LOW', 'stairs')
    return top


def railing(p0, p1, h=1.0, style='iron', spacing=None, z=None, name='railing', mid=None):
    """Railing from p0 to p1 (world points, z = base height). style iron (bars, top rail, dog bars) | timber | pipe."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    L = d.length
    bm = bmesh.new()
    up = V((0, 0, 1))
    if style == 'timber':
        spacing = spacing or 1.5
        n = max(1, int(round(L / spacing)))
        for i in range(n + 1):
            c = p0.lerp(p1, i / n)
            box_bm(bm, tuple(c + up * h / 2), (0.1, 0.1, h), math.atan2(d.y, d.x))
        for zz, hh in ((h - 0.05, 0.1), (h * 0.5, 0.08)):
            beam_bm(bm, p0 + up * zz, p1 + up * zz, 0.06, hh)
        return part(bm, mid or 'timber_grey', name=name, uv='beam', axis=tuple(d.normalized()))
    spacing = spacing or (0.13 if style == 'iron' else 1.8)
    n = max(1, int(round(L / spacing)))
    for i in range(n + 1):
        c = p0.lerp(p1, i / n)
        thick = 0.012 if style == 'iron' and i % 10 else 0.03
        cyl_bm(bm, c, c + up * h, thick if style == 'iron' else 0.024, 6)
    cyl_bm(bm, p0 + up * h, p1 + up * h, 0.028, 8)
    cyl_bm(bm, p0 + up * 0.1, p1 + up * 0.1, 0.015, 6)
    if style == 'pipe':
        cyl_bm(bm, p0 + up * h * 0.5, p1 + up * h * 0.5, 0.022, 8)
    return part(bm, mid or 'cast_iron', name=name, smooth=True, grime=0.3)


def balcony(o, n, w, d, z, slab='ashlar', rail='iron', brackets=2, name='balcony'):
    """Balcony slab projecting d from wall point o (on outer face, at floor level z) along normal n, width w;
    stone brackets (consoles) below and a railing on 3 sides."""
    o, n = V(o), V(n).normalized()
    r = V((-n.y, n.x, 0))
    bm = bmesh.new()
    c = o + n * d / 2
    box_bm(bm, (c.x, c.y, z - 0.08), (w, d, 0.16), math.atan2(r.y, r.x))
    part(bm, slab, name=name + '_slab')
    bm = bmesh.new()
    for i in range(brackets):
        x = (i / max(1, brackets - 1) - 0.5) * (w - 0.4) if brackets > 1 else 0
        b = o + r * x
        pts = [b + V((0, 0, z - 0.16)), b + n * (d - 0.1) + V((0, 0, z - 0.16)), b + V((0, 0, z - 0.75))]
        C.loft_bm(bm, [[p - r * 0.1 for p in pts], [p + r * 0.1 for p in pts]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, slab, name=name + '_brackets')
    corners = [o - r * (w / 2 - 0.05), o - r * (w / 2 - 0.05) + n * (d - 0.05), o + r * (w / 2 - 0.05) + n * (d - 0.05), o + r * (w / 2 - 0.05)]
    for i in range(3):
        railing(corners[i] + V((0, 0, z)), corners[i + 1] + V((0, 0, z)), 1.0, rail, name='%s_rail%d' % (name, i))
    C.roof_meta([(p.x, p.y) for p in corners], z, walkable=True, kind='balcony')


def ladder(bottom, top_z, normal, width=0.45, lean=0.25, mid='timber_grey', name='ladder', meta=True):
    """Wooden ladder leaning against a wall: bottom (world, on ground, in front of the wall), top at height top_z."""
    b = V(bottom)
    n = V(normal).normalized()
    s = V((-n.y, n.x, 0))
    t = b - n * lean + V((0, 0, top_z + 0.6))
    bm = bmesh.new()
    for k in (-1, 1):
        beam_bm(bm, b + s * k * width / 2, t + s * k * width / 2, 0.06, 0.08)
    nr = int(top_z / 0.3)
    for i in range(1, nr + 1):
        p = b.lerp(t, i / (nr + 2))
        cyl_bm(bm, p - s * width / 2, p + s * width / 2, 0.018, 6)
    part(bm, mid, name=name, uv='beam', axis=tuple((t - b).normalized()))
    if meta:
        C.ladder_meta(tuple(b + n * 0.4), tuple(b - n * (lean + 0.5)), top_z)


def sign(center, normal, w, kind='kommandantur', board='timber_grey', hanging=False, name='sign'):
    """Painted sign board: text face from the shared sign atlas (lib/decals.json 'signs'), board edge + frame.
    hanging=True: projecting bracket sign (face along the normal)."""
    import kit_weather as W
    c, n = V(center), V(normal).normalized()
    r = V((-n.y, n.x, 0))
    h = w / 4.0
    if hanging:
        face_n = r
        arm = c + n * (w / 2 + 0.15)
        bm = bmesh.new()
        beam_bm(bm, c + V((0, 0, h / 2 + 0.1)), arm + n * 0.1 + V((0, 0, h / 2 + 0.1)), 0.03, 0.04)
        beam_bm(bm, c - V((0, 0, h / 2 - 0.2)), c + n * (w * 0.6) + V((0, 0, h / 2 + 0.08)), 0.02, 0.02)
        part(bm, 'cast_iron', name=name + '_bracket')
        c = c + n * (w / 2 + 0.1)
        rr, nn = n, face_n
    else:
        rr, nn = r, n
    bm = bmesh.new()
    box_bm(bm, tuple(c + (nn * -0.02 if not hanging else V())), (w + 0.08, 0.04 if not hanging else 0.035, h + 0.08), math.atan2(rr.y, rr.x))
    part(bm, board, name=name + '_board', uv='beam', axis=tuple(rr))
    rc = W.rects()['signs'].get(kind, [0, 0.9375, 1, 1])
    for side in ((1,) if not hanging else (1, -1)):
        nn2 = nn * side
        rr2 = rr * side
        q = [c - rr2 * w / 2 - V((0, 0, h / 2)), c + rr2 * w / 2 - V((0, 0, h / 2)), c + rr2 * w / 2 + V((0, 0, h / 2)), c - rr2 * w / 2 + V((0, 0, h / 2))]
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(p + nn2 * (0.004 if not hanging else 0.02)) for p in q])
        C.uv_rect(bm, f, rc)
        part(bm, 'signs', name=name + '_face', uv='keep', grime=0.35, bisect=False)


def wall_lantern(o, n, z, name='lantern'):
    """Cast-iron wall bracket lantern; registers a 'light' anchor."""
    o, n = V(o), V(n).normalized()
    bm = bmesh.new()
    a = o + V((0, 0, z))
    beam_bm(bm, a, a + n * 0.4, 0.03, 0.03)
    beam_bm(bm, a - V((0, 0, 0.25)), a + n * 0.3, 0.02, 0.02)
    lamp = a + n * 0.42 - V((0, 0, 0.1))
    cyl_bm(bm, lamp - V((0, 0, 0.2)), lamp + V((0, 0, 0.1)), 0.09, 6, r1=0.12)
    cyl_bm(bm, lamp + V((0, 0, 0.1)), lamp + V((0, 0, 0.22)), 0.14, 6, r1=0.02)
    part(bm, 'cast_iron', name=name, grime=0.2)
    C.anchor('light', tuple(lamp), tuple(n), kind='lantern')
