"""Norway group helpers on top of the shared kit: painted board walls, white trims/casings, log (laft) walls,
stone plinths, porches, flagpoles with a Balkenkreuz banner (no swastika, spec 10.6), drying racks."""
import sys, os, math
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/blender')
import bpy, bmesh
from mathutils import Vector as V
import kit as K
import kit_core as C
from kit_arch import lbox, lpoly
import kit_export as _KE

# KIT BUG WORKAROUND: Blender 4.2's glTF exporter only writes COLOR_0 for export_vertex_color='ACTIVE' when the
# mesh has a render colour attribute set (render_color_index != -1); bmesh-created 'Col' layers are not flagged, so
# the kit's vertex grime / decal alpha never reached the GLB. Flag 'Col' as active+render colour before export.
_orig_export = _KE.export_glb


def _export_with_colors(path, objs):
    for o in objs:
        me = getattr(o, 'data', None)
        if me is None or not hasattr(me, 'color_attributes') or not len(me.color_attributes):
            continue
        names = [a.name for a in me.color_attributes]
        i = names.index('Col') if 'Col' in names else 0
        me.color_attributes.active_color_index = i
        me.color_attributes.render_color_index = i
    return _orig_export(path, objs)


_KE.export_glb = _export_with_colors

OUT = '<claude-tmp>'
WHITE = None                                   # wood_paint untinted = weathered white paint
OCHRE = (0.99, 0.72, 0.36)                     # oker / gul
GREYGREEN = (0.62, 0.70, 0.62)
FIELDGREY = (0.55, 0.58, 0.52)
FALU = (1.0, 1.0, 1.0)


def args(default_name):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = a[0] if a else OUT
    var = a[1] if len(a) > 1 else 'a'
    seed = int(a[2]) if len(a) > 2 else 1
    snow = a[3] == 'snow' if len(a) > 3 else False
    return out, var, seed, snow


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def trim_mat(tint):
    return dict(mat_tint=tint) if tint else {}


def clad(cladding='red', tint=None):
    """(mid, part kwargs) for a cladding: 'red' Falu-red horizontal weatherboards, 'vert' vertical boards painted
    `tint` on the pale base, 'horiz' horizontal painted boards, 'tar' tarred, 'grey' bare weathered, 'siding'."""
    mid, kw = {'red': ('timber_cladding', {}), 'vert': ('wood_paint', {}), 'horiz': ('weatherboard_paint', {}), 'weathered': ('boards_weathered', {}),
               'redv': ('timber_cladding', {'rot90': True}),
               'tar': ('timber_tarred', {}), 'grey': ('timber_grey', {}), 'siding': ('timber_siding', {}),
               'batten': ('board_batten', {})}[cladding]
    if tint:
        kw['mat_tint'] = tint
    return mid, kw


def board_walls(poly, z0, h, thick, frames, cladding='red', tint=None, name='walls', footprint=True):
    mid, kw = clad(cladding, tint)
    return K.wall_ring(poly, h, thick, mid, frames, z0=z0, name=name, footprint=footprint, **kw)


def board_gable(poly, edge, ze, zr, thick, frames=(), cladding='red', tint=None, name='gable'):
    mid, kw = clad(cladding, tint)
    return K.gable(poly, edge, ze, zr, thick, mid, list(frames), name=name, **kw)


def corner_boards(poly, z0, z1, w=0.15, proud=0.035, tint=WHITE, name='cornerb'):
    """White L-shaped corner boards (hjornekasser) on every convex corner of CCW poly."""
    poly = C.ccw(poly)
    bm = bmesh.new()
    n = len(poly)
    for i in range(n):
        p = V((*poly[i], 0))
        b = (V((*poly[(i + 1) % n], 0)) - p).normalized()       # along next edge
        a = (V((*poly[i - 1], 0)) - p).normalized()             # along previous edge (backwards)
        if a.x * b.y - a.y * b.x > 0:                             # reflex corner
            continue
        nb = V((b.y, -b.x, 0))                                    # outward normal of next edge
        na = V((-a.y, a.x, 0))                                    # outward normal of previous edge
        for d, nn in ((b, nb), (a, na)):
            c = p + d * (w - proud) / 2 + nn * proud / 2
            K.box_bm(bm, (c.x, c.y, (z0 + z1) / 2), (w + proud, proud, z1 - z0), rot_z=math.atan2(d.y, d.x))
    return K.part(bm, 'wood_paint', name=name, uv='beam', axis=(0, 0, 1), **trim_mat(tint))


def band(poly, z, h=0.16, proud=0.04, tint=WHITE, name='band'):
    """Horizontal painted board band (vannbord / storey band) around the walls."""
    import kit_arch as KA
    poly = C.ccw(poly)
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(poly, proud), C.poly_offset(poly, -0.02), z, z + h)
    return K.part(bm, 'wood_paint', name=name, **trim_mat(tint))


def casing(fr, w=0.11, proud=0.03, crown=True, apron=True, tint=WHITE, name='casing'):
    """Wide flat painted casing around an opening with a moulded crown board (klassisk vindusomramming)."""
    bm = bmesh.new()
    x0, x1, top = -fr.w / 2, fr.w / 2, fr.h
    lbox(bm, fr, x0 - w, x0, (0 if fr.kind == 'door' else -0.02), top, 0.0, proud)
    lbox(bm, fr, x1, x1 + w, (0 if fr.kind == 'door' else -0.02), top, 0.0, proud)
    lbox(bm, fr, x0 - w, x1 + w, top, top + w * 1.1, 0.0, proud)
    if crown:
        lbox(bm, fr, x0 - w - 0.05, x1 + w + 0.05, top + w * 1.1, top + w * 1.1 + 0.05, 0.0, proud + 0.05)
        lbox(bm, fr, x0 - w - 0.02, x1 + w + 0.02, top + w * 1.1 + 0.05, top + w * 1.1 + 0.08, 0.0, proud + 0.03)
    if apron and fr.kind != 'door':
        lbox(bm, fr, x0 - w * 0.6, x1 + w * 0.6, -0.16, -0.05, 0.0, proud)
    return K.part(bm, 'wood_paint', name=name, uv='beam', axis=(0, 0, 1), grime=0.5, **trim_mat(tint))


def plinth(poly, z1, mid='fieldstone_grey', proj=0.05, thick=0.45, frames=(), name='plinth'):
    """Dry-stone / mortared foundation wall (grunnmur) from below ground to z1."""
    out = C.poly_offset(C.ccw(poly), proj)
    return K.wall_ring(out, z1 + 0.1, thick, mid, list(frames), z0=-0.1, name=name, footprint=False)


def log_walls(x0, y0, x1, y1, z0, h, d=0.24, mid='timber_tarred', frames=(), ext=0.28, pitch=0.86, name='logs',
              gable_x=None):
    """Norwegian laft: round-ish logs alternating X/Y courses, notched corners with projecting log heads (ext).
    gable_x: (z_eave, z_ridge) -> log gables on the two X-end (east/west) walls stepping up to the ridge."""
    r = K.rng()
    bmx, bmy = bmesh.new(), bmesh.new()
    k, z = 0, z0 + d / 2
    ztop = z0 + h
    while z < ztop:
        rr = d / 2 * r.uniform(0.93, 1.05)
        if k % 2 == 0:
            for y in (y0 + d / 2, y1 - d / 2):
                K.cyl_bm(bmx, (x0 - ext * r.uniform(0.85, 1.1), y, z), (x1 + ext * r.uniform(0.85, 1.1), y, z), rr, 8)
        else:
            for x in (x0 + d / 2, x1 - d / 2):
                K.cyl_bm(bmy, (x, y0 - ext * r.uniform(0.85, 1.1), z + d * pitch / 2), (x, y1 + ext * r.uniform(0.85, 1.1), z + d * pitch / 2), rr, 8)
        z += d * pitch / 2
        k += 1
    if gable_x:
        ze, zr = gable_x
        zz = ztop + d / 2
        W = y1 - y0
        while zz < zr - 0.15:
            half = (W / 2) * (1 - (zz - ze) / (zr - ze)) + 0.05
            for x in (x0 + d / 2, x1 - d / 2):
                yc = (y0 + y1) / 2
                K.cyl_bm(bmy, (x, yc - half, zz), (x, yc + half, zz), d / 2 * r.uniform(0.93, 1.03), 8)
            zz += d * pitch
    fr = list(frames)
    obs = []
    for bm, ax, nm in ((bmx, (1, 0, 0), '_x'), (bmy, (0, 1, 0), '_y')):
        if fr:
            bm = K.boolean_cut(bm, fr)
        obs.append(K.part(bm, mid, name=name + nm, uv='beam', axis=ax, smooth=True, jitter=0.1))
    # inner chinking/backing so no light leaks between logs
    inner = [(x0 + d * 0.5, y0 + d * 0.5), (x1 - d * 0.5, y0 + d * 0.5), (x1 - d * 0.5, y1 - d * 0.5), (x0 + d * 0.5, y1 - d * 0.5)]
    bm = bmesh.new()
    K.ring_bm(bm, C.poly_offset(inner, 0.04), C.poly_offset(inner, -0.04), z0, ztop)
    bm = K.boolean_cut(bm, fr) if fr else bm
    obs.append(K.part(bm, 'timber_tarred', name=name + '_back', grime=0.2, lod='drop'))
    K.footprint(rect(x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05), 'HIGH')
    return obs


def _face_colors(ob, fn):
    """Override COLOR_0 per face: fn(face_centre_world) -> (r,g,b) or None (keep)."""
    me = ob.data
    ca = me.color_attributes.get('Col') or me.color_attributes[0]
    for poly in me.polygons:
        c = fn(poly.center)
        if c is None:
            continue
        for li in poly.loop_indices:
            a = ca.data[li].color[3]
            ca.data[li].color = (c[0], c[1], c[2], a)


def banner(p_top, fw=1.8, fh=1.2, heading=(1, 0, 0), nu=24, nv=16, wave=0.12, name='flag'):
    """Cloth banner hanging from a pole at p_top (hoist edge), flying along `heading`: dark red field with a
    Balkenkreuz (black cross, white edging). Separate node 'flag' for cloth animation. No swastika (spec 10.6)."""
    hd = V(heading).normalized()
    side = V((-hd.y, hd.x, 0))
    bm = bmesh.new()
    for j in range(nv):
        for i in range(nu):
            q = []
            for (u, v) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                s, t = u / nu, v / nv
                off = wave * s * math.sin(s * 7.0 + t * 1.3) - 0.03 * s
                q.append(bm.verts.new(V(p_top) + hd * (s * fw) + side * off + V((0, 0, -(1 - t) * fh - 0.04 * s * s))))
            bm.faces.new(q)
            bm.faces.new([bm.verts.new(v.co + side * 0.006) for v in reversed(q)])      # back side
    for f in bm.faces:
        f.normal_update()
    ob = K.part(bm, 'snow', name=name, node='flag', grime=0, bisect=False, jitter=0.0, uv='aligned')
    ob['kit_lod'] = 'keep'
    P0 = V(p_top)

    def col(c):
        d = c - P0
        u = d.dot(hd) / fw * nu - nu / 2
        v = (d.z + fh) / fh * nv - nv / 2
        bl = (abs(u) < 1.9 and abs(v) < 5.6) or (abs(v) < 1.9 and abs(u) < 5.6)
        wh = (abs(u) < 2.9 and abs(v) < 6.6) or (abs(v) < 2.9 and abs(u) < 6.6)
        return (0.03, 0.03, 0.03) if bl else ((0.92, 0.92, 0.9) if wh else (0.5, 0.06, 0.05))
    _face_colors(ob, col)
    K.anchor('flag', P0, heading, width=fw, height=fh, node='flag')
    return ob


def flagpole(base, h=7.0, heading=(1, 0, 0), stays=True, name='flagpole'):
    """Painted timber flagpole on a concrete/stone footing with guy stays, finial and halyard; banner at the top."""
    x, y = base[0], base[1]
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, 0), (x, y, h), 0.085, 10, r1=0.05)
    K.part(bm, 'wood_paint', name=name, uv='beam', axis=(0, 0, 1), smooth=True, grime=0.4)
    bm = bmesh.new()
    K.box_bm(bm, (x, y, 0.15), (0.7, 0.7, 0.4), taper=(0.8, 0.8))
    K.part(bm, 'concrete_bunker', name=name + '_foot')
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, h), (x, y, h + 0.14), 0.07, 8)        # finial (truck)
    hd = V(heading).normalized()
    K.cyl_bm(bm, (x + hd.x * 0.07, y + hd.y * 0.07, h - 0.1), (x + hd.x * 0.07, y + hd.y * 0.07, 1.3), 0.008, 4)
    K.cyl_bm(bm, (x + hd.x * 0.1, y + hd.y * 0.1, 1.2), (x + hd.x * 0.1, y + hd.y * 0.1, 1.45), 0.03, 6)   # cleat
    if stays:
        for a in (0.6, 2.7, 4.8):
            gx, gy = x + math.cos(a) * 2.2, y + math.sin(a) * 2.2
            K.cyl_bm(bm, (x, y, h * 0.62), (gx, gy, 0.05), 0.01, 4)
            K.box_bm(bm, (gx, gy, 0.04), (0.14, 0.14, 0.12))
    K.part(bm, 'steel_galv', name=name + '_iron', grime=0.2)
    banner((x + hd.x * 0.09, y + hd.y * 0.09, h - 0.2), heading=heading)
    K.footprint_rect(x, y, 0.8, 0.8, 0, 'HIGH', 'flagpole')
    return h


def porch(fr, depth=1.5, width=None, rise=None, roof=True, tint=WHITE, stairs_dir=None, mid='deck_planks', name='porch',
          roof_mid='roof_slate'):
    """Norwegian entrance porch (inngangsparti) in front of door frame `fr`: timber landing at the threshold,
    steps down, turned posts, balustrade and a small gabled roof with white bargeboards."""
    w = width or fr.w + 1.1
    z = fr.o.z
    rise = z if rise is None else rise
    n, r = fr.n, fr.r
    c = fr.o + n * (depth / 2)
    bm = bmesh.new()
    K.box_bm(bm, (c.x, c.y, z - 0.06), (abs(r.x) * w + abs(n.x) * depth, abs(r.y) * w + abs(n.y) * depth, 0.12))
    K.part(bm, mid, name=name + '_deck', grime=0.5)
    bm = bmesh.new()
    for s in (-1, 1):
        for dd in (depth - 0.08,):
            p = fr.o + r * (s * (w / 2 - 0.08)) + n * dd
            K.box_bm(bm, (p.x, p.y, z / 2 - 0.06), (0.14, 0.14, z - 0.1))       # under-post
            if roof:
                K.box_bm(bm, (p.x, p.y, z + 1.3), (0.12, 0.12, 2.6))
    K.part(bm, 'wood_paint', name=name + '_posts', uv='beam', axis=(0, 0, 1), **trim_mat(tint))
    sd = V(stairs_dir) if stairs_dir else n
    if rise > 0.2:
        p0 = fr.o + n * depth + sd * (rise / 0.18 * 0.28) if sd == n else fr.o + n * (depth / 2) + sd * (w / 2 + rise / 0.18 * 0.28)
        K.stairs((p0.x, p0.y, 0), (-sd.x, -sd.y, 0), min(1.1, w - 0.3), rise, max(2, round(rise / 0.18)), mid, solid=True, name=name + '_steps')
    for s in (-1, 1):
        a = fr.o + r * (s * (w / 2 - 0.06)) + n * 0.1
        b = fr.o + r * (s * (w / 2 - 0.06)) + n * (depth - 0.08)
        K.railing((a.x, a.y, z), (b.x, b.y, z), 0.9, 'timber')
    if roof == 'shed':
        z0 = z + 2.55
        a = fr.o + r * (-w / 2 - 0.25) + n * (depth + 0.3)
        b = fr.o + r * (w / 2 + 0.25)
        xs, ys = sorted((a.x, b.x)), sorted((a.y, b.y))
        low = {(0, -1): '-y', (0, 1): '+y', (1, 0): '+x', (-1, 0): '-x'}[(round(n.x), round(n.y))]
        K.roof_shed(xs[0], ys[0], xs[1], ys[1], z0, z0 + 0.55, roof_mid, thick=0.08, oh=0.0, low_side=low,
                    name=name + '_roof')
        C.A.meta['roofs'].pop()
        bm = bmesh.new()
        p0, p1 = fr.o + r * (-w / 2) + n * (depth - 0.08), fr.o + r * (w / 2) + n * (depth - 0.08)
        K.beam_bm(bm, (p0.x, p0.y, z0 - 0.08), (p1.x, p1.y, z0 - 0.08), 0.14, 0.2)
        for s in (-1, 1):
            p = fr.o + r * (s * (w / 2 - 0.08))
            K.beam_bm(bm, (p.x, p.y, z0 + 0.5), (p.x + n.x * (depth - 0.08), p.y + n.y * (depth - 0.08), z0 - 0.02), 0.1, 0.16)
        K.part(bm, 'wood_paint', name=name + '_beam', uv='beam', axis=tuple(r), **trim_mat(tint))
        return None
    if roof:
        ang = math.atan2(n.y, n.x)
        R = K.roof_gable(c.x, c.y, depth + 0.15, w + 0.1, z + 2.6, 38, roof_mid, rot=ang, eave_oh=0.2, gable_oh=0.1,
                         thick=0.08, fascia='wood_paint', barge='wood_paint', gutters=False, name=name + '_roof')
        A = C.A.meta['roofs'].pop()           # porch roof is not a gameplay roof
        return R


def char(strength=0.75, z0=0.3, seed=3, skip=('glass_dirty', 'decals', 'snow', 'signs')):
    """Burnt / blasted look for destroyed variants: darken vertex colours (soot, charring) with a noisy mask that
    grows with height; glass parts are removed by bite(), this handles the rest."""
    import random
    rr = random.Random(seed)
    ph = [rr.uniform(0, 6.28) for _ in range(4)]
    for ob in C.A.parts:
        if ob.name not in bpy.data.objects or not ob.data.materials:
            continue
        if ob.data.materials[0].get('kit_id') in skip or ob.get('kit_node') == 'decals':
            continue
        ca = ob.data.color_attributes.get('Col')
        if not ca:
            continue
        me = ob.data
        for poly in me.polygons:
            for li in poly.loop_indices:
                p = me.vertices[me.loops[li].vertex_index].co
                n = 0.5 + 0.25 * math.sin(p.x * 1.3 + ph[0]) * math.sin(p.y * 1.1 + ph[1]) + 0.25 * math.sin(p.z * 2.1 + p.x * 0.7 + ph[2])
                k = max(0.0, min(1.0, (p.z - z0) / 2.0)) * strength * (0.55 + 0.6 * n)
                c = ca.data[li].color
                f = 1 - min(0.88, k)
                ca.data[li].color = (c[0] * f, c[1] * f * 0.97, c[2] * f * 0.95, c[3])


def roof_battens(R, spacing=0.9, mid='timber_tarred', name='battens'):
    """Tar-paper roof: vertical batten strips running down each slope every `spacing` m (roll overlaps)."""
    import kit_roof as KR
    bm = bmesh.new()
    t = math.tan(math.radians(R.pitch))
    yw = R.W / 2 + 0.3
    n = int(R.L / spacing)
    for s in (-1, 1):
        for i in range(n + 1):
            lx = -R.L / 2 + R.L * i / n
            a = R.w(lx, s * yw, R.z_eave - 0.3 * t + R.lift + 0.02)
            b = R.w(lx, 0, R.z_ridge + 0.0)
            K.beam_bm(bm, a, b, 0.05, 0.035)
    return K.part(bm, mid, name=name, uv='beam', axis=(0, 1, 0), grime=0.4)


def stovepipe(x, y, z0, z1, name='stovepipe'):
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, z0), (x, y, z1), 0.08, 10)
    K.cyl_bm(bm, (x, y, z1 + 0.12), (x, y, z1 + 0.14), 0.2, 10, r1=0.02)
    for a in (0, 2.1, 4.2):
        K.cyl_bm(bm, (x + math.cos(a) * 0.07, y + math.sin(a) * 0.07, z1 - 0.02), (x + math.cos(a) * 0.12, y + math.sin(a) * 0.12, z1 + 0.13), 0.008, 4)
    K.part(bm, 'steel_galv', name=name, smooth=True, grime=0.8, mat_tint=(0.55, 0.52, 0.5))
    K.anchor('smoke', (x, y, z1 + 0.2))


def rowboat(c, heading=(0, -1, 0), Lb=5.4, B=1.45, D=0.55, tilt=0.0, paint=(0.86, 0.84, 0.78), name='boat'):
    """Norwegian faering (clinker rowboat): double-ended hull (outer painted, inner tarred), gunwale rails, 3 thwarts,
    keel, a pair of oars. c = keel midpoint on the ground/slip, heading = bow direction; tilt = pitch (rad, bow up)."""
    from mathutils import Matrix
    hd = V(heading).normalized()
    ang = math.atan2(hd.y, hd.x)
    M = Matrix.Translation(V(c)) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Rotation(-tilt, 4, 'Y')
    ns, npf = 9, 7
    outer, inner = [], []
    for i in range(ns + 1):
        u = i / ns                                   # 0 = stern, 1 = bow (local +X)
        x = (u - 0.5) * Lb
        w = max(0.03, math.sin(math.pi * u) ** 0.8) * B / 2
        sheer = D + 0.22 * (2 * u - 1) ** 4          # sheer rises towards the stems
        ring, ringi = [], []
        for k in range(npf):
            t = math.pi * k / (npf - 1)              # 0..pi from starboard gunwale to port gunwale
            y = math.cos(t) * w
            z = sheer - math.sin(t) * (sheer - 0.02) * (0.35 + 0.65 * (w / (B / 2)) ** 0.5)
            ring.append(M @ V((x, y, z)))
            ringi.append(M @ V((x, y * 0.9, z + (0.05 if 0 < k < npf - 1 else 0))))
        outer.append(ring)
        inner.append(ringi)
    bm = bmesh.new()
    vo = [[bm.verts.new(p) for p in ring] for ring in outer]
    for i in range(ns):
        for k in range(npf - 1):
            bm.faces.new((vo[i][k], vo[i + 1][k], vo[i + 1][k + 1], vo[i][k + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'wood_paint', name=name + '_hull', mat_tint=paint, uv='beam', axis=tuple(hd), bisect=False, grime=0.5)
    bm = bmesh.new()
    vi = [[bm.verts.new(p) for p in ring] for ring in inner]
    for i in range(ns):
        for k in range(npf - 1):
            bm.faces.new((vi[i][k + 1], vi[i + 1][k + 1], vi[i + 1][k], vi[i][k]))
    K.part(bm, 'timber_tarred', name=name + '_inside', uv='beam', axis=tuple(hd), bisect=False, grime=0.3)
    bm = bmesh.new()
    for side in (0, npf - 1):                        # gunwale rails
        for i in range(ns):
            K.beam_bm(bm, outer[i][side], outer[i + 1][side], 0.07, 0.06)
    for xx in (-0.9, 0.2, 1.2):                      # thwarts
        w = max(0.03, math.sin(math.pi * (xx / Lb + 0.5)) ** 0.8) * B / 2 * 0.9
        K.beam_bm(bm, M @ V((xx, -w, D - 0.18)), M @ V((xx, w, D - 0.18)), 0.22, 0.04)
    K.beam_bm(bm, M @ V((-Lb / 2, 0, 0.05)), M @ V((Lb / 2, 0, 0.05)), 0.08, 0.1)     # keel
    for s in (-1, 1):                                # oars resting across the thwarts
        K.cyl_bm(bm, M @ V((-1.6, s * 0.3, D - 0.1)), M @ V((1.7, s * 0.45, D - 0.08)), 0.025, 5)
        K.box_bm(bm, tuple(M @ V((1.85, s * 0.46, D - 0.08))), (0.5, 0.12, 0.02), rot_z=ang)
    K.part(bm, 'timber_grey', name=name + '_wood', uv='beam', axis=tuple(hd), bisect=False)
    return M


def prune_empty():
    """Drop parts left without faces (e.g. thin trims fully eaten by bite() booleans) - finalize/UV unwrap fail on them."""
    keep = []
    for ob in C.A.parts:
        if ob.name not in bpy.data.objects:
            continue
        if ob.type == 'MESH' and len(ob.data.polygons) == 0:
            bpy.data.objects.remove(ob)
            continue
        keep.append(ob)
    C.A.parts[:] = keep


_orig_finalize = _KE.finalize


def _finalize(*a, **kw):
    prune_empty()
    return _orig_finalize(*a, **kw)


K.finalize = _finalize


SNOW_EXCLUDE = ('rubble', 'battens', 'railing', 'gutter', 'bars', 'ropes', 'guys', 'stockfish', 'ribs', 'mast', 'tower',
                'iron', 'hinge', 'insulators', 'pipes', 'lamp', 'winch', 'chain', 'stovepipe', 'fire_buckets', 'oars')


def snow(exclude=SNOW_EXCLUDE, min_area=0.01, **kw):
    """Kit snow pass restricted to parts that read at game zoom (keeps snow variants inside the tri budget)."""
    parts = [o for o in C.A.parts if o.name in bpy.data.objects and not any(s in o.name for s in exclude)]
    import kit_weather as KW
    kw.setdefault('skip', tuple(m for m in KW.SKIP_SNOW if m != 'sod'))      # winter: turf roofs are snow-covered too
    return K.snow_pass(parts=parts, min_area=min_area, **kw)


_flagpole_orig = flagpole
from nfx import *            # rework: LOD builder, roof registry/dressing, snow blankets, sod roofs, destruction
from nfx2 import *           # rework 2: legible snow, drifts, cloth flag, hanging collapse rafters
