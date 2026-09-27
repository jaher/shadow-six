"""Kit architecture: walls with true openings (reveals), gables, window & door assemblies."""
import bpy, bmesh, math
from mathutils import Vector as V, Matrix
import kit_core as C
from kit_core import part, box_bm, beam_bm, cyl_bm, prism_bm, hexa_bm, quad, rng


class Frame:
    """An opening in a wall. o = centre of the opening's bottom edge on the OUTER wall plane (world),
    n = outward normal (horizontal), r = right vector (along the wall, seen from outside), w/h opening size,
    depth = wall thickness, shape = rect|arch|segment."""

    def __init__(s, o, n, r, w, h, depth, shape='rect', kind='window', rise=None):
        s.o, s.n, s.r, s.w, s.h, s.depth, s.shape, s.kind = V(o), V(n), V(r), w, h, depth, shape, kind
        s.rise = rise if rise is not None else (w / 2 if shape == 'arch' else (w * 0.14 if shape == 'segment' else 0))

    def p(s, x, z, d=0.0):
        """Point at local (x along r from centre, z up from sill, d outward along n)."""
        return s.o + s.r * x + V((0, 0, z)) + s.n * d

    def outline(s, n_arc=10, inset=0.0):
        """2D outline (x,z) of the opening, CCW, for cutters and frames."""
        w2 = s.w / 2 - inset
        if s.shape == 'rect' or s.rise <= 1e-3:
            return [(-w2, inset), (w2, inset), (w2, s.h - inset), (-w2, s.h - inset)]
        spring = s.h - s.rise
        R = (w2 ** 2 + (s.rise - inset) ** 2) / (2 * max(s.rise - inset, 1e-3))
        cz = s.h - inset - R
        a0 = math.atan2(spring - cz, w2)
        pts = [(-w2, inset), (w2, inset)]
        for i in range(n_arc + 1):
            a = a0 + (math.pi - 2 * a0) * i / n_arc
            pts.append((R * math.cos(a), cz + R * math.sin(a)))
        return pts


def _edge(poly, i):
    a, b = V((*poly[i], 0)), V((*poly[(i + 1) % len(poly)], 0))
    r = (b - a).normalized()
    n = V((r.y, -r.x, 0))              # outward for CCW polygons
    return a, b, r, n


def opening(poly, edge, t, w, h, sill, thick, shape='rect', kind='window', rise=None, anchor='centre'):
    """Frame for an opening on edge `edge` of CCW footprint `poly`, `t` metres from the edge start."""
    a, b, r, n = _edge(poly, edge)
    return Frame(a + r * t + V((0, 0, sill)), n, r, w, h, thick, shape, kind, rise)


def _cutter_bm(frames, extra=0.25):
    bm = bmesh.new()
    for f in frames:
        ol = f.outline(12)
        ring0 = [f.p(x, z, extra) for x, z in ol]
        ring1 = [f.p(x, z, -f.depth - extra) for x, z in ol]
        C.loft_bm(bm, [ring0, ring1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def boolean_cut(bm, frames):
    """Cut the opening prisms of `frames` out of bm (EXACT boolean). Returns a new bmesh."""
    if not frames:
        return bm
    me = bpy.data.meshes.new('tmp_target')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('tmp_target', me)
    bpy.context.scene.collection.objects.link(ob)
    cb = _cutter_bm(frames)
    cme = bpy.data.meshes.new('tmp_cut')
    cb.to_mesh(cme)
    cb.free()
    cob = bpy.data.objects.new('tmp_cut', cme)
    bpy.context.scene.collection.objects.link(cob)
    m = ob.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.solver = 'EXACT'
    m.object = cob
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    out = bmesh.new()
    out.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.objects.remove(cob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(cme)
    return out


def ring_bm(bm, outer, inner, z0, z1):
    """Closed ring solid between CCW polygons outer/inner (same vertex count)."""
    n = len(outer)
    ob = [bm.verts.new((*p, z0)) for p in outer]
    ot = [bm.verts.new((*p, z1)) for p in outer]
    ib = [bm.verts.new((*p, z0)) for p in inner]
    it = [bm.verts.new((*p, z1)) for p in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))
        bm.faces.new((ib[j], ib[i], it[i], it[j]))
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))


def wall_ring(poly, h, thick, mid, frames=(), z0=0.0, name='walls', footprint=True, plinth=None, **kw):
    """Closed wall ring on CCW footprint `poly` (outer face line), height h, thickness thick.
    frames: openings (see opening()); plinth=(mat, height, projection) adds a base course."""
    poly = C.ccw(poly)
    inner = C.poly_offset(poly, -thick)
    bm = bmesh.new()
    ring_bm(bm, poly, inner, z0, z0 + h)
    bm = boolean_cut(bm, [f for f in frames if f.o.z < z0 + h])
    ob = part(bm, mid, name=name, **kw)
    if footprint:
        C.footprint(poly, 'HIGH')
    if plinth:
        pm, ph, pp = plinth
        out = C.poly_offset(poly, pp)
        inn = C.poly_offset(poly, -min(thick * 0.5, 0.15))
        bm2 = bmesh.new()
        ring_bm(bm2, out, inn, z0 - 0.05, z0 + ph)
        bm2 = boolean_cut(bm2, [f for f in frames if f.kind == 'door'])
        part(bm2, pm, name=name + '_plinth')
    return ob


def gable(poly, edge, z_eave, z_ridge, thick, mid, frames=(), overhang=0.0, name='gable', **kw):
    """Triangular gable panel on top of wall edge `edge` (roof ridge perpendicular to this edge)."""
    a, b, r, n = _edge(C.ccw(poly), edge)
    L = (b - a).length
    prof = [(0, z_eave), (L, z_eave), (L / 2, z_ridge)]
    ring0 = [a + r * t + V((0, 0, z)) for t, z in prof]
    ring1 = [p - n * thick for p in ring0]
    bm = bmesh.new()
    C.loft_bm(bm, [ring0, ring1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm = boolean_cut(bm, list(frames))
    return part(bm, mid, name=name, **kw)


# ------------------------------------------------------------------ helpers in a Frame's local space
def frame_ring_bm(bm, fr, ol_out, ol_in, d0, d1):
    """Solid ring between two outlines (lists of (x,z), same length) from depth d0 to d1."""
    A = [fr.p(x, z, d0) for x, z in ol_out]
    B = [fr.p(x, z, d0) for x, z in ol_in]
    A1 = [fr.p(x, z, d1) for x, z in ol_out]
    B1 = [fr.p(x, z, d1) for x, z in ol_in]
    n = len(A)
    va, vb, va1, vb1 = ([bm.verts.new(p) for p in L] for L in (A, B, A1, B1))
    for i in range(n):
        j = (i + 1) % n
        for f in ((va[i], va[j], vb[j], vb[i]), (va1[j], va1[i], vb1[i], vb1[j]),
                  (va[j], va[i], va1[i], va1[j]), (vb[i], vb[j], vb1[j], vb1[i])):
            bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def lbox(bm, fr, x0, x1, z0, z1, d0, d1):
    """Box in frame-local coordinates."""
    p = [fr.p(x0, z0, d0), fr.p(x1, z0, d0), fr.p(x1, z0, d1), fr.p(x0, z0, d1),
         fr.p(x0, z1, d0), fr.p(x1, z1, d0), fr.p(x1, z1, d1), fr.p(x0, z1, d1)]
    fs = hexa_bm(bm, p)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def lpoly(bm, fr, ol, d):
    f = bm.faces.new([bm.verts.new(fr.p(x, z, d)) for x, z in ol])
    return f


def hexcol(c):
    return tuple(c)


def voussoirs(fr, mid, n=None, depth=0.25, proud=0.015, key=True, name='voussoirs', alt=0.06):
    """Ring of dressed voussoir blocks around an arched/segmental opening (or a flat lintel of blocks)."""
    bm = bmesh.new()
    if fr.shape == 'rect':
        lbox(bm, fr, -fr.w / 2 - 0.16, fr.w / 2 + 0.16, fr.h, fr.h + 0.24, -min(0.3, fr.depth), proud)
        return part(bm, mid, name=name)
    w2 = fr.w / 2
    R = (w2 ** 2 + fr.rise ** 2) / (2 * fr.rise)
    cz = fr.h - R
    a0 = math.atan2(fr.h - fr.rise - cz, w2)
    span = math.pi - 2 * a0
    n = n or max(5, int(round(span * R / 0.2)) | 1)
    gap = 0.008
    for i in range(n):
        t0, t1 = a0 + span * i / n + gap / R, a0 + span * (i + 1) / n - gap / R
        k = i == n // 2 and key
        dd = depth * (1.25 if k else (1.0 if i % 2 == 0 else 1.0 - alt / depth))
        ring = []
        for t in (t0, t1):
            ring.append((R * math.cos(t), cz + R * math.sin(t)))
        outer = [((R + dd) * math.cos(t), cz + (R + dd) * math.sin(t)) for t in (t1, t0)]
        ol = ring + outer
        f0 = lpoly(bm, fr, ol, proud + (0.01 if k else 0))
        f1 = lpoly(bm, fr, list(reversed(ol)), -min(0.3, fr.depth))
        vs0, vs1 = f0.verts[:], list(reversed(f1.verts[:]))
        for a in range(4):
            b = (a + 1) % 4
            bm.faces.new((vs1[a], vs1[b], vs0[b], vs0[a]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return part(bm, mid, name=name)


def jamb_blocks(fr, mid, block_h=0.28, wide=0.26, narrow=0.17, proud=0.012, name='surround'):
    """Dressed-stone window/door surround: alternating long/short jamb blocks on both sides."""
    bm = bmesh.new()
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    n = max(2, int(round(top / block_h)))
    bh = top / n
    for s in (-1, 1):
        for i in range(n):
            ww = wide if i % 2 == 0 else narrow
            x0 = s * fr.w / 2
            x1 = s * (fr.w / 2 + ww)
            lbox(bm, fr, min(x0, x1), max(x0, x1), i * bh + 0.006, (i + 1) * bh - 0.006, -min(0.3, fr.depth), proud)
    return part(bm, mid, name=name)


PAINT = {'white': (0.80, 0.79, 0.75), 'cream': (0.78, 0.72, 0.58), 'green': (0.30, 0.40, 0.30), 'blue': (0.34, 0.44, 0.52),
         'grey': (0.52, 0.53, 0.52), 'red': (0.50, 0.17, 0.12), 'brown': (0.36, 0.24, 0.16), 'oxblood': (0.34, 0.12, 0.10),
         'teal': (0.22, 0.38, 0.38), 'feldgrau': (0.36, 0.38, 0.33), 'black': (0.12, 0.12, 0.12)}


def _paint(c):
    if not c:
        return None
    c = PAINT.get(c, c)
    return tuple(min(1.0, x / 0.77) for x in c)


def window(fr, style='casement', panes=(1, 3), frame='white', recess=0.1, sill='ashlar_limestone', lintel=None,
           surround=None, shutters=None, shutter_color='green', shutter_style='plank', curtain=0.6, bars=False,
           streak=True, interior=True, name='win'):
    """Full window assembly in opening `fr`.
    style: casement (2 leaves) | single | fixed | sash (vertical sliding). panes=(cols per leaf, rows).
    sill/lintel/surround: library material ids (lintel=None -> none; arched frames get voussoirs).
    shutters: None | 'open' | 'closed' | 'ajar'. curtain: probability of a curtain hint. Returns list of parts."""
    r = rng()
    tint = _paint(frame)
    fw, fd = 0.065, 0.075
    d0, d1 = -recess - fd, -recess
    out = []
    bm = bmesh.new()
    frame_ring_bm(bm, fr, fr.outline(12), fr.outline(12, fw), d0, d1)
    # leaves / sashes
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    sw = 0.045
    nl = 1 if style in ('single', 'fixed') or fr.w < 0.7 else 2
    if style == 'sash':
        nl = 1
    lw = (fr.w - 2 * fw) / nl
    for k in range(nl):
        x0 = -fr.w / 2 + fw + k * lw
        x1 = x0 + lw
        z0, z1 = fw, top - (0 if fr.shape != 'rect' else fw)
        dd0, dd1 = d0 + 0.012, d1 - 0.012
        ol_o = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        ol_i = [(x0 + sw, z0 + sw * 1.4), (x1 - sw, z0 + sw * 1.4), (x1 - sw, z1 - sw), (x0 + sw, z1 - sw)]
        frame_ring_bm(bm, fr, ol_o, ol_i, dd0, dd1)
        cols, rows = panes
        gb = 0.022
        for c in range(1, cols):
            x = x0 + sw + (lw - 2 * sw) * c / cols
            lbox(bm, fr, x - gb / 2, x + gb / 2, z0 + sw, z1 - sw, dd0 + 0.01, dd1 - 0.006)
        for q in range(1, rows):
            z = z0 + sw * 1.4 + (z1 - z0 - sw * 2.4) * q / rows
            lbox(bm, fr, x0 + sw, x1 - sw, z - gb / 2, z + gb / 2, dd0 + 0.01, dd1 - 0.006)
    if fr.shape != 'rect':      # fanlight bars
        for a in (-0.5, 0.0, 0.5):
            lbox(bm, fr, a * fr.w * 0.5 - 0.011, a * fr.w * 0.5 + 0.011, top, fr.h - fw - abs(a) * fr.rise * 0.5, d0 + 0.02, d1 - 0.01)
    out.append(part(bm, 'wood_paint', name=name + '_frame', mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.5))
    # glass
    bm = bmesh.new()
    lpoly(bm, fr, fr.outline(12, fw), d0 + fd * 0.5)
    out.append(part(bm, 'glass_dirty', name=name + '_glass', grime=0, bisect=False, jitter=0.1))
    if interior:
        bm = bmesh.new()
        m = 0.25
        lbox(bm, fr, -fr.w / 2 - m, fr.w / 2 + m, -m, fr.h + m, -fr.depth - 0.03, -fr.depth - 0.01)
        out.append(part(bm, 'interior_dark', name=name + '_int', grime=0, bisect=False, jitter=0.2))
        if r.random() < curtain:
            bm = bmesh.new()
            side = r.choice([-1, 1, 0])
            cw = fr.w * r.uniform(0.3, 0.45)
            xs = [(-fr.w / 2, -fr.w / 2 + cw), (fr.w / 2 - cw, fr.w / 2)] if side == 0 else [(-fr.w / 2, -fr.w / 2 + cw) if side < 0 else (fr.w / 2 - cw, fr.w / 2)]
            for a, b in xs:
                lpoly(bm, fr, [(a, 0.02), (b, 0.02), (b, top - 0.02), (a, top - 0.02)], d0 - 0.04)
            out.append(part(bm, 'curtain', name=name + '_curtain', grime=0, bisect=False, jitter=0.1))
    if sill:
        bm = bmesh.new()
        lbox(bm, fr, -fr.w / 2 - 0.06, fr.w / 2 + 0.06, -0.07, 0.0, d1 - 0.02, 0.06)
        out.append(part(bm, sill, name=name + '_sill'))
    if lintel or fr.shape != 'rect':
        out.append(voussoirs(fr, lintel or sill or 'ashlar', name=name + '_lintel'))
    if surround:
        out.append(jamb_blocks(fr, surround, name=name + '_surround'))
    if bars:
        bm = bmesh.new()
        nb = max(2, int(fr.w / 0.13))
        for i in range(1, nb):
            x = -fr.w / 2 + fr.w * i / nb
            cyl_bm(bm, fr.p(x, 0.0, -0.05), fr.p(x, top, -0.05), 0.011, 6)
        out.append(part(bm, 'cast_iron', name=name + '_bars', smooth=True, grime=0.3))
    if shutters:
        out += shutter_pair(fr, shutters, _paint(shutter_color), shutter_style, name + '_shut')
    if streak:
        import kit_weather as W
        W.decal_on_frame(fr, r.choice(['streak_rain', 'streak_rain', 'streak_long']), 0, -0.55, fr.w + 0.25, 1.0)
    C.A.__dict__.setdefault('frames', []).append(fr)
    C.A.meta['windows'].append({'pos': [round(fr.o.x, 3), round(fr.o.z, 3), round(-fr.o.y, 3)], 'w': fr.w, 'h': fr.h})
    return out


def _leaf_bm(bm, w, h, t, style, r, arch=None):
    """Board leaf in its own local space: x 0..w (hinge at x=0), z 0..h, y 0..t (y=0 is the outer face side).
    style plank|louvred|panel. Returns bm with geometry (local)."""
    if style == 'louvred':
        for x0, x1 in ((0, 0.06), (w - 0.06, w)):
            box_bm(bm, ((x0 + x1) / 2, t / 2, h / 2), (x1 - x0, t, h))
        for z0, z1 in ((0, 0.08), (h - 0.08, h)):
            box_bm(bm, (w / 2, t / 2, (z0 + z1) / 2), (w - 0.12, t, z1 - z0))
        n = int((h - 0.16) / 0.055)
        for i in range(n):
            z = 0.08 + (i + 0.5) * (h - 0.16) / n
            beam_bm(bm, (0.06, t * 0.5, z), (w - 0.06, t * 0.5, z), 0.05, 0.008, up=V((0, -1, 0.9)))
        return
    nb = max(2, int(round(w / 0.15)))
    bw = w / nb
    for i in range(nb):
        x0, x1 = i * bw + 0.002, (i + 1) * bw - 0.002
        hh = h if not arch else min(arch((x0 + x1) / 2), h)
        box_bm(bm, ((x0 + x1) / 2, t / 2 + r.uniform(-0.003, 0.003), hh / 2), (x1 - x0, t, hh))
    # ledges + brace on the outer face (y<0 side)
    for z in (0.18, h - 0.22 if not arch else h * 0.62):
        box_bm(bm, (w / 2, -0.012, z), (w - 0.04, 0.024, 0.1))
    a = V((0.06, -0.012, 0.26))
    b = V((w - 0.06, -0.012, (h - 0.3) if not arch else h * 0.55))
    beam_bm(bm, a, b, 0.09, 0.024, up=V((0, 1, 0)))


def _place_leaf(bm, hinge, ang, right, n):
    """Transform local leaf (x along right, y along -n, z up) to world, rotated by ang about the hinge (z axis)."""
    R = Matrix.Rotation(ang, 3, 'Z')
    M = Matrix((right, -n, V((0, 0, 1)))).transposed()
    for v in bm.verts:
        v.co = hinge + R @ (M @ v.co)


def _place_leaf_rot(bm, hinge, ang):
    R = Matrix.Rotation(ang, 3, 'Z')
    for v in bm.verts:
        v.co = hinge + R @ (v.co - hinge)


def _panel_leaf_bm(bm, w, h, t, glazed=False):
    """Framed & panelled leaf (local space like _leaf_bm): stiles, rails, recessed panels with raised fields."""
    st, rb, rm, rt = 0.11, 0.22, 0.16, 0.11
    for x0, x1 in ((0, st), (w - st, w)):
        box_bm(bm, ((x0 + x1) / 2, t / 2, h / 2), (x1 - x0, t, h))
    zm = h * 0.42
    for z0, z1 in ((0, rb), (zm, zm + rm), (h - rt, h)):
        box_bm(bm, (w / 2, t / 2, (z0 + z1) / 2), (w - 2 * st, t, z1 - z0))
    mid = w / 2
    box_bm(bm, (mid, t / 2, (rb + zm) / 2), (0.08, t, zm - rb))
    box_bm(bm, (mid, t / 2, (zm + rm + h - rt) / 2), (0.08, t, h - rt - zm - rm))
    for (x0, x1) in ((st, mid - 0.04), (mid + 0.04, w - st)):
        for (z0, z1) in ((rb, zm), (zm + rm, h - rt)):
            cx, cz, pw, ph = (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0
            box_bm(bm, (cx, t * 0.55, cz), (pw, t * 0.4, ph))                         # recessed panel
            box_bm(bm, (cx, t * 0.3, cz), (pw * 0.7, 0.012, ph * 0.8))  # raised field


def shutter_pair(fr, state='open', tint=None, style='plank', name='shut'):
    r = rng()
    out = []
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    lw = fr.w / 2
    for s in (-1, 1):
        bm = bmesh.new()
        _leaf_bm(bm, lw, top, 0.03, style, r)
        if state == 'closed':
            hinge = fr.p(s * fr.w / 2, 0, 0.001)
            ang = 0.0
            right = -fr.r * s
        else:
            hinge = fr.p(s * (fr.w / 2 + 0.03), 0, 0.02)
            right = fr.r * s
            ang = -s * math.radians(r.uniform(3, 12) if state == 'open' else r.uniform(40, 70))
        if state != 'closed':
            # opened leaves lie against the wall: thickness grows outward, ledges face out
            for v in bm.verts:
                v.co.y = 0.03 - v.co.y
        _place_leaf(bm, hinge, ang, right, fr.n if state == 'closed' else -fr.n)
        out.append(part(bm, 'wood_paint', name='%s_%d' % (name, s), mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.6))
        # strap hinges / pintles
        bm = bmesh.new()
        for z in (0.2, top - 0.2):
            box_bm(bm, fr.p(s * (fr.w / 2 + 0.02), z, 0.02), (0.05, 0.05, 0.03))
        out.append(part(bm, 'cast_iron', name='%s_h%d' % (name, s), grime=0.2))
    return out


def door(fr, did='door', style='plank', color='brown', open_deg=0.0, hinge='left', recess=0.12, step='ashlar',
         lintel=None, surround=None, fanlight=False, name=None, node=None, handle=True):
    """Door assembly in opening `fr`: frame, leaf (separate node 'door_<did>' pivoted at the hinge), threshold step,
    ironmongery, metadata. style: plank | panel | glazed | double | barn. open_deg rotates the leaf inward."""
    r = rng()
    name = name or 'door_' + did
    node = node or name
    tint = _paint(color)
    fw, fd = 0.085, 0.1
    d0, d1 = -recess - fd, -recess
    bm = bmesh.new()
    ol = fr.outline(12)
    ol_in = fr.outline(12, fw)
    ol_in[0], ol_in[1] = (ol_in[0][0], 0.0), (ol_in[1][0], 0.0)      # no bottom rail (threshold)
    frame_ring_bm(bm, fr, ol, ol_in, d0, d1)
    part(bm, 'timber_beam' if style in ('barn', 'plank') else 'wood_paint', name=name + '_frame', mat_tint=None if style in ('barn', 'plank') else tint, uv='beam', axis=(0, 0, 1))
    top = fr.h - fw
    w = fr.w - 2 * fw
    leaves = [(-1, w)] if style not in ('double', 'barn') else [(-1, w / 2), (1, w / 2)]
    arch = None
    if fr.shape != 'rect':
        o2 = fr.outline(24, fw)

        def arch(x, o2=o2):
            best = max(z for xx, z in o2 if abs(xx - x) < w / 20 + 0.02) if any(abs(xx - x) < w / 20 + 0.02 for xx, z in o2) else top
            return best
    for s, lw in leaves:
        bm = bmesh.new()
        hs = s if len(leaves) > 1 else (-1 if hinge == 'left' else 1)
        st = 'plank' if style in ('plank', 'barn') else 'plank'
        if style in ('panel', 'glazed'):
            _panel_leaf_bm(bm, lw, top, 0.05, style == 'glazed')
        else:
            if arch:
                _leaf_bm(bm, lw, top + fr.rise, 0.05, st, r, arch=lambda x, hs=hs: arch(hs * (w / 2 - x)) - 0.0)
            else:
                _leaf_bm(bm, lw, top, 0.05, st, r)
        # leaf local x from hinge; hinge at opening side hs
        hp = fr.p(hs * w / 2, 0.01, d0 + 0.01)
        right = -fr.r * hs
        ang = -hs * math.radians(open_deg)
        _place_leaf(bm, hp, ang, right, fr.n)
        ob = part(bm, 'door_planks' if style in ('plank', 'barn') else 'wood_paint', name=name + '_leaf%d' % s, node=node + ('' if len(leaves) == 1 else str(s)),
                  mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.6)
        ob['kit_pivot'] = list(hp)
        # strap hinges + handle, same node
        bm = bmesh.new()
        for z in (0.35, top - 0.4):
            a = fr.p(hs * w / 2, z, d0 + 0.01) + fr.n * 0.012
            b = a + right * lw * 0.62
            beam_bm(bm, a, b, 0.012, 0.045, up=fr.n)
        if handle:
            c = fr.p(hs * w / 2, 1.0, d0) + right * (lw - 0.1) + fr.n * 0.03
            cyl_bm(bm, c, c + fr.n * 0.03, 0.035, 8)
        _place_leaf_rot(bm, hp, ang)
        ob2 = part(bm, 'cast_iron', name=name + '_iron%d' % s, node=node + ('' if len(leaves) == 1 else str(s)), grime=0.1)
        ob2['kit_pivot'] = list(hp)
    if step:
        bm = bmesh.new()
        lbox(bm, fr, -fr.w / 2 - 0.12, fr.w / 2 + 0.12, -0.16, 0.0, d1 - 0.02, 0.38)
        part(bm, step, name=name + '_step')
    if lintel or fr.shape != 'rect':
        voussoirs(fr, lintel or 'ashlar', name=name + '_lintel')
    if surround:
        jamb_blocks(fr, surround, name=name + '_surround')
    C.A.__dict__.setdefault('frames', []).append(fr)
    C.door_meta(did, tuple(fr.o), fr.n, fr.w, fr.h, kind='barn' if style == 'barn' else 'door', node=node)
    return node


def cut_object(ob, cutter_bm):
    """Boolean-subtract a closed bmesh from an existing part object (keeps UVs / vertex colours)."""
    cme = bpy.data.meshes.new('tmp_cut')
    cb = cutter_bm.copy()
    bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
    cb.to_mesh(cme)
    cb.free()
    cob = bpy.data.objects.new('tmp_cut', cme)
    bpy.context.scene.collection.objects.link(cob)
    m = ob.modifiers.new('cut', 'BOOLEAN')
    m.operation, m.solver, m.object = 'DIFFERENCE', 'EXACT', cob
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='cut')
    bpy.data.objects.remove(cob)
    bpy.data.meshes.remove(cme)
