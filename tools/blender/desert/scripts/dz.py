"""Desert / North-Africa helpers on top of the SHADOW SIX kit (Tunis medina + Western Desert camps).
Parapets with gaps (round / crenel / stepped merlons), sand drifts, horseshoe-arch openings with striped
voussoirs, studded doors, projecting iron grilles, timber window boxes, rooftop domes, guy ropes."""
import sys, os, math
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/blender')
import bmesh
from mathutils import Vector as V, Matrix
import kit as K
import kit_core as C
import kit_arch as KA
import kit_export as KE
import bpy

_orig_bake = KE.bake_ao

# Near-black decal cells (soot rgb ~10, crack ~17) stacked at high alpha rendered as pure-black voids at game zoom:
# cap their opacity so a scorch reads as charred sand/plaster (dark brown-grey), never as a hole.
_DECAL_CAP = {'soot': 0.5, 'crack': 0.7, 'streak_long': 0.7, 'streak_rain': 0.75, 'damp_base': 0.75}
_orig_decal = K.decal


def _decal_capped(kind, *a, **kw):
    cap = _DECAL_CAP.get(kind)
    if cap is not None:
        kw['alpha'] = min(kw.get('alpha', 0.85), cap)
    return _orig_decal(kind, *a, **kw)


K.decal = _decal_capped


def fast_bake(objs, res=1024, samples=96, dist=2.0, out=None):
    """Bake AO on ONE joined copy of all parts (Blender re-syncs the whole scene per object in a multi-object
    bake: O(n^2) with 300+ parts). Same 'AO' UVs -> same image. Hides the originals during the bake.
    Thin overlays laid a few mm over a wall/roof (render spalls, lime patches, repairs: ob['dz_noao']) are left out
    of the bake and their AO UVs point at a reserved white texel, so they are not blackened by the surface under them."""
    over = [o for o in objs if o.get('dz_noao')]
    objs = [o for o in objs if not o.get('dz_noao')]
    for o in over:
        o.hide_render = True
    cps = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        cps.append(c)
    for o in objs:
        o.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    for c in cps:
        c.select_set(True)
    bpy.context.view_layer.objects.active = cps[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    try:
        p = _orig_bake([j], res, samples, dist, out)
        _fill_ao(p, white_corner=bool(over))
        for o in over:
            uvl = o.data.uv_layers.get('AO')
            if uvl:
                for d_ in uvl.data:
                    d_.uv = (2.0 / res, 2.0 / res)
    finally:
        for o in over:
            o.hide_render = False
        me = j.data
        bpy.data.objects.remove(j)
        bpy.data.meshes.remove(me)
        for o in objs:
            o.hide_render = False
    return p


def _fill_ao(path, iters=24, white_corner=False):
    """Dilate the baked AO islands into the unbaked (black) background so mip-mapping never averages thin parts
    (lattice members, wires, railings) with black - that turned the whole derrick black at game zoom."""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    v = px[..., 0].copy()
    valid = v > 0.006
    if valid.mean() > 0.995 and not white_corner:
        bpy.data.images.remove(img)
        return
    fill_default = float(v[valid].mean()) if valid.any() else 1.0
    for _ in range(iters):
        acc = np.zeros_like(v)
        cnt = np.zeros_like(v)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            vv = np.roll(np.roll(valid, dy, 0), dx, 1)
            acc += np.where(vv, np.roll(np.roll(v, dy, 0), dx, 1), 0)
            cnt += vv
        grow = (~valid) & (cnt > 0)
        v[grow] = acc[grow] / cnt[grow]
        valid = valid | grow
    v[~valid] = fill_default
    if white_corner:
        v[:5, :5] = 1.0            # reserved white texels for overlay parts (image row 0 = v 0)
    for c in range(min(3, img.channels)):
        px[..., c] = v
    img.pixels[:] = px.ravel()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


KE.bake_ao = fast_bake
_orig_mat = C.mat


def _mat_clamped(mid, tint=None):
    """kit tints are encoded as 2-digit hex per channel: values > 1 overflow (renders wrong colours). Clamp."""
    if tint is not None:
        m = max(tint)
        tint = tuple(x / m for x in tint) if m > 1.0 else tuple(tint)
    return _orig_mat(mid, tint)


C.mat = _mat_clamped
_orig_export = KE.export_glb


def _export_with_colors(path, objs):
    """kit bug workaround: the 'Col' corner attribute is never made active, so Blender 4.2 exported no COLOR_0
    (grime + decal alpha lost). Activate it on every object before export."""
    for o in objs:
        ca = getattr(o.data, 'color_attributes', None)
        if ca and len(ca):
            ca.active_color_index = 0
            ca.render_color_index = 0
    return _orig_export(path, objs)


KE.export_glb = _export_with_colors

BLUE = (0.22, 0.36, 0.52)
DOORS = {'blue': (0.20, 0.34, 0.50), 'green': (0.22, 0.38, 0.30), 'yellow': (0.66, 0.52, 0.22), 'brown': (0.34, 0.24, 0.16),
         'teal': (0.18, 0.40, 0.40), 'red': (0.46, 0.18, 0.12)}
WASH = {'white': None, 'cream': (1.0, 0.96, 0.87), 'bone': (0.96, 0.95, 0.9), 'ochre': (1.0, 0.88, 0.7), 'pink': (1.0, 0.92, 0.86)}


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def edge(poly, i):
    a, b = V((*poly[i], 0)), V((*poly[(i + 1) % len(poly)], 0))
    r = (b - a).normalized()
    return a, b, r, V((r.y, -r.x, 0)), (b - a).length


def segs_minus(L, gaps):
    """[0,L] minus gap intervals -> list of (t0,t1)."""
    out, t = [], 0.0
    for g0, g1 in sorted(gaps):
        if g0 > t + 0.05:
            out.append((t, g0))
        t = max(t, g1)
    if L > t + 0.05:
        out.append((t, L))
    return out


def parapet(poly, z, h=0.8, t=0.3, mid='plaster_white', gaps=None, style='round', mat_tint=None, climb=True, name='parapet', mspace=0.9):
    """Parapet on each edge of CCW `poly` (outer face line) from z to z+h. gaps={edge: [(t0,t1)]}.
    style: round (bullnose lime coping) | crenel (square merlons) | merlon (stepped/pointed Maghreb merlons) | plain."""
    gaps = gaps or {}
    bm, bc = bmesh.new(), bmesh.new()
    for i in range(len(poly)):
        a, b, r, n, L = edge(poly, i)
        for t0, t1 in segs_minus(L, gaps.get(i, [])):
            e0 = -t if t0 < 0.01 else 0.0           # overlap into the corner
            p0, p1 = a + r * (t0 + e0), a + r * t1
            mid_in = -n * t / 2
            if style in ('crenel', 'merlon'):
                hb = h * 0.55
                C.beam_bm(bm, p0 + mid_in + V((0, 0, z + hb / 2)), p1 + mid_in + V((0, 0, z + hb / 2)), t, hb)
                seg = t1 - t0
                nm = max(1, int(seg / mspace))
                for k in range(nm):
                    c = a + r * (t0 + (k + 0.5) * seg / nm) + mid_in
                    mw = seg / nm * 0.55
                    if style == 'crenel':
                        C.box_bm(bm, tuple(c + V((0, 0, z + hb + (h - hb) / 2))), (mw, t, h - hb), math.atan2(r.y, r.x))
                    else:           # stepped merlon with pointed cap
                        C.box_bm(bm, tuple(c + V((0, 0, z + hb + (h - hb) * 0.3))), (mw, t, (h - hb) * 0.6), math.atan2(r.y, r.x))
                        C.box_bm(bc, tuple(c + V((0, 0, z + hb + (h - hb) * 0.6 + 0.12))), (mw * 0.8, t * 0.8, 0.24),
                                 math.atan2(r.y, r.x), taper=(0.15, 0.3))
            else:
                if style == 'mud':      # eroded, hand-rounded mud parapet: one organic loft, no separate coping
                    mud_wall_bm(bm, p0 + mid_in, p1 + mid_in, z, h, t, seed=i * 7 + int(t0 * 3))
                    if climb:
                        C.climb_meta(tuple(p0)[:2], tuple(p1)[:2], z + h, 'parapet')
                    continue
                C.beam_bm(bm, p0 + mid_in + V((0, 0, z + h / 2)), p1 + mid_in + V((0, 0, z + h / 2)), t, h)
                if style in ('round', 'lime'):   # plastered lime coping: low crowned cap with drip lips (NOT a pipe)
                    coping_bm(bc, p0 + mid_in, p1 + mid_in, z + h, t, seed=i * 5 + int(t0 * 3))
                elif style == 'plain':
                    C.beam_bm(bc, p0 + mid_in + V((0, 0, z + h + 0.03)), p1 + mid_in + V((0, 0, z + h + 0.03)), t + 0.06, 0.06)
            if climb:
                C.climb_meta(tuple(p0)[:2], tuple(p1)[:2], z + h, 'parapet')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name, mat_tint=mat_tint)
    if bc.verts:
        bmesh.ops.recalc_face_normals(bc, faces=bc.faces)
        K.part(bc, mid, name=name + '_cope', mat_tint=tuple(min(1.0, c * 1.04) for c in (mat_tint or (0.96, 0.96, 0.96))), smooth=False)
    else:
        bc.free()


def roof_slab(poly, z, thick=0.3, mid='plaster_rough', oh=0.0, name='roofslab', tint=None):
    bm = bmesh.new()
    C.prism_bm(bm, C.poly_offset(C.ccw(poly), oh), z - thick, z)
    K.part(bm, mid, name=name, mat_tint=tint)


def spouts(poly, z, every=4.5, mid='ashlar_limestone', skip=(), name='spouts'):
    """Projecting gargoyle spouts (half pipe / stone channel) + water-stain decals below them."""
    bm = bmesh.new()
    for i in range(len(poly)):
        if i in skip:
            continue
        a, b, r, n, L = edge(poly, i)
        k = max(1, int(L / every))
        for j in range(k):
            p = a + r * (L * (j + 0.5) / k) + V((0, 0, z + 0.04))
            C.beam_bm(bm, p - n * 0.15, p + n * 0.42, 0.14, 0.1)
            K.decal('streak_rust' if mid == 'cast_iron' else 'streak_long', tuple(p + n * 0.001 - V((0, 0, 0.9))), tuple(n), 0.5, 1.7, alpha=0.6)
    if bm.verts:
        K.part(bm, mid, name=name)


def sand_drift(p0, p1, n, h=0.3, w=0.9, seed=0, name='sand'):
    """Wind-blown sand heaped against a wall base from p0 to p1 (Blender XY), n = outward normal of the wall."""
    p0, p1, n = V((*p0[:2], 0)), V((*p1[:2], 0)), V((*n[:2], 0)).normalized()
    L = (p1 - p0).length
    ns = max(3, int(L / 0.9))
    from mathutils import noise
    rings = []
    for i in range(ns + 1):
        u = i / ns
        taper = math.sin(math.pi * u) ** 0.6
        k = (0.6 + 0.8 * noise.noise(V((u * L * 0.7 + seed, seed * 1.3, 0)))) * taper
        c = p0.lerp(p1, u)
        hh, ww = h * max(0.05, k), w * max(0.2, k)
        rings.append([c - n * 0.05 + V((0, 0, -0.02)), c - n * 0.05 + V((0, 0, hh)), c + n * ww * 0.35 + V((0, 0, hh * 0.55)),
                      c + n * ww + V((0, 0, -0.02))])
    bm = bmesh.new()
    C.loft_bm(bm, rings, closed=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'sand', name=name, grime=0, smooth=True, bisect=False, lod='drop')


class HFrame(KA.Frame):
    """Horseshoe-arch opening (Maghreb): circle radius R > w/2, centre at spring height; arc wraps below the centre."""

    def __init__(s, fr, over=0.18):
        KA.Frame.__init__(s, fr.o, fr.n, fr.r, fr.w, fr.h, fr.depth, 'arch', fr.kind)
        s.R = fr.w / 2 * (1 + over)
        s.zc = fr.h - s.R
        s.rise = s.R + math.sqrt(s.R ** 2 - (fr.w / 2) ** 2)
        s.spring = s.zc - math.sqrt(s.R ** 2 - (fr.w / 2) ** 2)

    def outline(s, n_arc=10, inset=0.0):
        w2, R = s.w / 2 - inset, s.R - inset
        a0 = -math.asin(min(0.999, math.sqrt(max(0.0, R ** 2 - w2 ** 2)) / R))
        pts = [(-w2, inset), (w2, inset)]
        n = n_arc + 6
        for i in range(n + 1):
            a = a0 + (math.pi - 2 * a0) * i / n
            pts.append((R * math.cos(a), s.zc + R * math.sin(a)))
        return pts


def arch_surround(fr, mid='ashlar_limestone', width=0.24, proud=0.04, stripes=True, jambs=True, name='asur', n_arc=18):
    """Carved-stone (kadhal) surround following the opening outline: jamb pilasters + voussoir band whose stones
    alternate dark/light (ablaq) when stripes=True. Works for rect/arch/horseshoe frames."""
    ol_i = fr.outline(n_arc, -0.01)
    ol_o = fr.outline(n_arc, -width)
    # jambs: from sill to spring
    spring = fr.h - fr.rise if fr.shape != 'rect' else fr.h
    bmj = bmesh.new()
    if jambs:
        for sx in (-1, 1):
            x0, x1 = sx * (fr.w / 2 + 0.005), sx * (fr.w / 2 + width)
            KA.lbox(bmj, fr, min(x0, x1), max(x0, x1), 0.0 if fr.kind == 'door' else -0.08, spring, -0.05, proud)
            KA.lbox(bmj, fr, min(x0, x1) - 0.03 * sx * 0, max(x0, x1) + 0.02 * sx, spring - 0.12, spring, -0.05, proud + 0.03)  # impost
    K.part(bmj, mid, name=name + '_jamb')
    # arch band split into voussoirs
    idx = [i for i, (x, z) in enumerate(ol_i) if i >= 2]
    bl, bd = bmesh.new(), bmesh.new()
    nv = len(idx) - 1
    for k in range(nv):
        i0, i1 = idx[k], idx[k + 1]
        q = [ol_i[i0], ol_i[i1], ol_o[i1], ol_o[i0]]
        pts = [fr.p(x, z, -0.05) for x, z in q] + [fr.p(x, z, proud) for x, z in q]
        C.hexa_bm(bd if (stripes and (k // 2) % 2) else bl, [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]])
    for b, nm, t in ((bl, '_vl', None), (bd, '_vd', (0.45, 0.42, 0.4))):
        if b.verts:
            bmesh.ops.recalc_face_normals(b, faces=b.faces)
            K.part(b, mid, name=name + nm, mat_tint=t)
        else:
            b.free()


def studded_door(fr, did, color='blue', studs=True, open_deg=0.0, step='ashlar_limestone', wicket=True, tymp='grille'):
    """Tunis door: rectangular painted plank leaf up to the springing (studded with black nail heads in a border +
    diamond pattern), fixed tympanum above in the arch (iron grille fanlight or plain boards). node door_<did>."""
    col = DOORS.get(color, color)
    tint = tuple(min(1.0, x / 0.62) for x in col)
    node = 'door_' + did
    spring = fr.h - fr.rise if fr.shape != 'rect' else fr.h
    fw, rec = 0.09, 0.12
    d0, d1 = -rec - 0.1, -rec
    bm = bmesh.new()
    lw = fr.w - 2 * fw
    KA.lbox(bm, fr, -fr.w / 2, -fr.w / 2 + fw, 0, spring, d0, d1)
    KA.lbox(bm, fr, fr.w / 2 - fw, fr.w / 2, 0, spring, d0, d1)
    KA.lbox(bm, fr, -fr.w / 2, fr.w / 2, spring - 0.02, spring + 0.1, d0, d1)
    K.part(bm, 'timber_beam', name=node + '_frame', uv='beam', axis=(0, 0, 1))
    top = spring - 0.02
    if fr.shape != 'rect':      # tympanum
        ol = [(x, z) for x, z in fr.outline(18, 0.005)[2:]]
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(fr.p(x, max(z, spring + 0.1), d0 + 0.03)) for x, z in ol])
        # tympanum = painted boarded fanlight panel (a lighter wash of the door colour) behind the grille; never a void
        K.part(bm, 'door_planks', name=node + '_tymp', grime=0.3, bisect=False, uv='beam', axis=(0, 0, 1),
               mat_tint=tuple(min(1.0, c * (1.25 if tymp == 'grille' else 1.0)) for c in tint))
        if tymp == 'grille':
            bm = bmesh.new()
            nb = int(fr.w / 0.12)
            for i in range(1, nb):
                x = -fr.w / 2 + fr.w * i / nb
                zt = max([z for xx, z in ol if abs(xx - x) < fr.w / nb] + [spring + 0.15])
                C.box_bm  # (bars are square wrought iron 2 cm)
                C.beam_bm(bm, fr.p(x, spring + 0.1, d0 + 0.08), fr.p(x, zt, d0 + 0.08), 0.022, 0.022)
            for zz in (0.35, 0.65):
                z = spring + 0.1 + (fr.h - spring - 0.1) * zz
                xs = [x for x, zz2 in ol if zz2 >= z]
                if xs:
                    C.beam_bm(bm, fr.p(min(xs), z, d0 + 0.1), fr.p(max(xs), z, d0 + 0.1), 0.022, 0.022)
            hub = fr.p(0, spring + 0.1, d0 + 0.11)               # half sunburst + hub ring (typical Tunis fanlight)
            for k in range(1, 8):
                a = math.pi * k / 8
                C.beam_bm(bm, hub, fr.p(math.cos(a) * fr.w * 0.34, spring + 0.1 + math.sin(a) * fr.w * 0.34 * 0.9, d0 + 0.11), 0.016, 0.016)
            C.cyl_bm(bm, hub - fr.n * 0.02, hub + fr.n * 0.02, 0.09, 10)
            K.part(bm, 'cast_iron', name=node + '_fan', mat_tint=(0.22, 0.24, 0.26), grime=0.2)
    # leaf (closed, flush boards on a frame, outer face at d0+0.01+...)
    hp = fr.p(-lw / 2, 0.01, d0 + 0.02)
    bm = bmesh.new()
    nb = max(3, int(lw / 0.16))
    r = K.rng()
    for i in range(nb):
        x0 = -lw / 2 + lw * i / nb + 0.003
        x1 = -lw / 2 + lw * (i + 1) / nb - 0.003
        KA.lbox(bm, fr, x0, x1, 0.01, top, d0 + 0.02 - 0.06 + r.uniform(-0.002, 0.002), d0 + 0.02)
    # raised border battens (Tunis doors carry studs along them)
    for x0, x1, z0, z1 in ((-lw / 2, -lw / 2 + 0.1, 0.01, top), (lw / 2 - 0.1, lw / 2, 0.01, top),
                           (-lw / 2, lw / 2, top - 0.1, top), (-lw / 2, lw / 2, 0.01, 0.13), (-lw / 2, lw / 2, top * 0.42, top * 0.42 + 0.08)):
        KA.lbox(bm, fr, x0, x1, z0, z1, d0 + 0.02, d0 + 0.035)
    if wicket and lw > 1.0:     # small inner door (khoukha) outline
        KA.lbox(bm, fr, -0.34, 0.3, top * 0.42 + 0.08, top * 0.42 + 0.14, d0 + 0.02, d0 + 0.033)
    ang = -math.radians(open_deg)
    KA._place_leaf_rot(bm, hp, ang)
    ob = K.part(bm, 'door_planks', name=node + '_leaf', node=node, mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.6)
    ob['kit_pivot'] = list(hp)
    bm = bmesh.new()
    if studs:
        pts = []
        for z in [0.25 + i * 0.3 for i in range(int((top - 0.4) / 0.3) + 1)]:
            pts += [(-lw / 2 + 0.05, z), (lw / 2 - 0.05, z)]
        for x in [-lw / 2 + 0.2 + i * 0.18 for i in range(int((lw - 0.35) / 0.18) + 1)]:
            pts += [(x, top - 0.05), (x, 0.07), (x, top * 0.42 + 0.04)]
        cz = top * 0.7
        for k in range(8):       # diamond on the upper panel
            a = 2 * math.pi * k / 8
            pts.append((math.cos(a) * lw * 0.22, cz + math.sin(a) * lw * 0.22))
        for x, z in pts:
            c = fr.p(x, z, d0 + 0.035)
            C.cyl_bm(bm, c, c + fr.n * 0.018, 0.02, 4, r1=0.01)
    c = fr.p(lw / 2 - 0.15, 1.05, d0 + 0.035)
    C.cyl_bm(bm, c + fr.n * 0.03 + V((0, 0, -0.08)), c + fr.n * 0.03 + V((0, 0, 0.08)), 0.05, 8)   # knocker ring (flat)
    KA._place_leaf_rot(bm, hp, ang)
    ob2 = K.part(bm, 'cast_iron', name=node + '_iron', node=node, mat_tint=(0.35, 0.35, 0.35), grime=0.1)
    ob2['kit_pivot'] = list(hp)
    if step:
        bm = bmesh.new()
        KA.lbox(bm, fr, -fr.w / 2 - 0.1, fr.w / 2 + 0.1, -0.14, 0.0, d1 - 0.02, 0.32)
        K.part(bm, step, name=node + '_step')
    C.A.__dict__.setdefault('frames', []).append(fr)
    C.door_meta(did, tuple(fr.o), fr.n, fr.w, spring, kind='door', node=node)
    return node


def bow_grille(fr, color=BLUE, bulge=0.22, name='grille'):
    """Projecting 'shebbek' iron grille: vertical bars bowing outward at the bottom, rails, scroll-ish top."""
    bm = bmesh.new()
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    nb = max(3, int(fr.w / 0.12))
    xs = [-fr.w / 2 - 0.04 + (fr.w + 0.08) * i / nb for i in range(nb + 1)]
    prof = [(-0.05, 0.02), (0.1, bulge * 0.95), (0.35, bulge), (0.75, bulge * 0.6), (1.0, 0.03)]
    for x in xs:
        pts = [fr.p(x, -0.05 + (top + 0.1) * t, d) for t, d in prof]
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.013, 4, caps=False)
    for t, d in prof[1:4]:
        C.cyl_bm(bm, fr.p(xs[0], -0.05 + (top + 0.1) * t, d), fr.p(xs[-1], -0.05 + (top + 0.1) * t, d), 0.015, 4, caps=False)
    for x in (xs[0], xs[-1]):     # side brackets back into the wall
        for t, d in prof[1:3]:
            C.cyl_bm(bm, fr.p(x, -0.05 + (top + 0.1) * t, d), fr.p(x, -0.05 + (top + 0.1) * t, 0.0), 0.014, 4, caps=False)
    K.part(bm, 'cast_iron', name=name, mat_tint=tuple(min(1, c / 0.5) for c in color), smooth=True, grime=0.25)


def window_box(fr, color=(0.24, 0.36, 0.3), depth=0.45, name='mashr'):
    """Timber window box (kneeling screen / mashrabiya): corbels, floor, lattice sides and front, little hood."""
    top = fr.h + 0.25
    w = fr.w + 0.3
    tint = tuple(min(1, c / 0.62) for c in color)
    bm = bmesh.new()
    KA.lbox(bm, fr, -w / 2, w / 2, -0.12, 0.0, 0.0, depth)                     # floor
    KA.lbox(bm, fr, -w / 2 - 0.06, w / 2 + 0.06, top, top + 0.08, 0.0, depth + 0.1)   # hood
    for x in (-w / 2, w / 2 - 0.05):
        KA.lbox(bm, fr, x, x + 0.05, 0.0, top, depth - 0.05, depth)        # front posts
        KA.lbox(bm, fr, x, x + 0.05, 0.0, top, 0.0, 0.05)
    KA.lbox(bm, fr, -w / 2, w / 2, 0.0, 0.06, depth - 0.05, depth)
    KA.lbox(bm, fr, -w / 2, w / 2, top - 0.06, top, depth - 0.05, depth)
    for c in (-w / 2 + 0.08, w / 2 - 0.08):   # corbels
        KA.lbox(bm, fr, c - 0.04, c + 0.04, -0.4, -0.12, 0.0, depth * 0.35)
        KA.lbox(bm, fr, c - 0.04, c + 0.04, -0.22, -0.12, 0.0, depth * 0.8)
    K.part(bm, 'wood_paint', name=name, mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.6)
    bm = bmesh.new()     # lattice
    n = int(w / 0.09)
    for i in range(1, n):
        x = -w / 2 + w * i / n
        KA.lbox(bm, fr, x - 0.012, x + 0.012, 0.06, top - 0.06, depth - 0.035, depth - 0.015)
    for k in range(1, int(top / 0.12)):
        z = top * k / int(top / 0.12)
        KA.lbox(bm, fr, -w / 2 + 0.05, w / 2 - 0.05, z - 0.01, z + 0.01, depth - 0.04, depth - 0.02)
        for x in (-w / 2 + 0.01, w / 2 - 0.035):
            KA.lbox(bm, fr, x, x + 0.025, z - 0.01, z + 0.01, 0.05, depth - 0.05)
    K.part(bm, 'wood_paint', name=name + '_lat', mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.4)
    bm = bmesh.new()
    KA.lbox(bm, fr, -w / 2 + 0.05, w / 2 - 0.05, 0.05, top - 0.05, depth - 0.08, depth - 0.07)
    K.part(bm, 'interior_dark', name=name + '_dark', grime=0, bisect=False)


def dome(c, r, z0, mid='plaster_white', drum_h=0.3, segs=16, rings=6, ribbed=False, finial=True, name='dome', tint=None, bulb=0.0):
    """Hemispherical (optionally slightly pointed / bulbous) lime dome on a short drum. ribbed = melon ribs."""
    cx, cy = c[:2]
    bm = bmesh.new()
    rr = []
    ring = lambda rad, z: [V((cx + rad * math.cos(2 * math.pi * i / segs), cy + rad * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)]
    rr.append(ring(r + 0.05, z0))
    rr.append(ring(r + 0.05, z0 + drum_h))
    rr.append(ring(r, z0 + drum_h + 0.02))
    for k in range(1, rings + 1):
        a = (math.pi / 2) * k / (rings + 0.35)
        rad = r * math.cos(a) * (1 + bulb * math.sin(2 * a))
        z = z0 + drum_h + 0.02 + r * math.sin(a) * 1.08
        pts = ring(rad, z)
        if ribbed:
            pts = [p if i % 2 == 0 else V((cx + (p.x - cx) * 0.95, cy + (p.y - cy) * 0.95, p.z)) for i, p in enumerate(pts)]
        rr.append(pts)
    C.loft_bm(bm, rr, close_start=True, close_end=False)
    top = V((cx, cy, z0 + drum_h + 0.02 + r * 1.1))
    last = [v for v in bm.verts][-segs:]
    tv = bm.verts.new(top)
    for i in range(segs):
        bm.faces.new((last[i], last[(i + 1) % segs], tv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name, smooth=True, mat_tint=tint, lod='keep', bisect=False)
    if finial:
        bm = bmesh.new()
        C.cyl_bm(bm, top - V((0, 0, 0.05)), top + V((0, 0, 0.5)), 0.025, 6)
        for k, (zz, rad) in enumerate(((0.12, 0.07), (0.26, 0.06), (0.38, 0.045))):
            C.cyl_bm(bm, top + V((0, 0, zz - rad)), top + V((0, 0, zz + rad)), rad, 8, r1=rad * 0.4)
        K.part(bm, 'steel_galv', name=name + '_finial', mat_tint=(1.1, 0.95, 0.6), smooth=True, grime=0.2)
    return top.z


def rope(p0, p1, sag=0.05, r=0.012, n=5, bm=None):
    p0, p1 = V(p0), V(p1)
    own = bm is None
    bm = bm or bmesh.new()
    pts = [p0.lerp(p1, i / n) - V((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
    for a, b in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, a, b, r, 4, caps=False)
    return bm


def drum(bm, c, r=0.3, h=0.88, lying=False, axis=(1, 0, 0)):
    """200 l oil drum with rolling hoops."""
    c = V(c)
    if lying:
        ax = V(axis).normalized()
        a, b = c - ax * h / 2, c + ax * h / 2
    else:
        a, b = c, c + V((0, 0, h))
    d = (b - a)
    C.cyl_bm(bm, a, b, r, 12)
    for t in (0.33, 0.66):
        m = a + d * t
        C.cyl_bm(bm, m - d.normalized() * 0.015, m + d.normalized() * 0.015, r + 0.012, 12)
    C.cyl_bm(bm, a - d.normalized() * 0.0, a + d.normalized() * 0.02, r + 0.008, 12)
    C.cyl_bm(bm, b - d.normalized() * 0.02, b, r + 0.008, 12)


def jerrycan(bm, c, rot=0.0):
    c = V(c)
    C.box_bm(bm, tuple(c + V((0, 0, 0.235))), (0.345, 0.165, 0.47), rot)
    C.box_bm(bm, tuple(c + V((0, 0, 0.49))), (0.2, 0.04, 0.05), rot)


def crate(bm, c, size=(0.9, 0.6, 0.55), rot=0.0):
    c = V(c)
    sx, sy, sz = size
    C.box_bm(bm, tuple(c + V((0, 0, sz / 2))), size, rot)
    R = Matrix.Rotation(rot, 3, 'Z')
    for sgn in (-1, 1):      # end battens
        o = c + R @ V((sgn * (sx / 2 + 0.01), 0, sz / 2))
        C.box_bm(bm, tuple(o), (0.025, sy + 0.02, sz + 0.02), rot)


def spall(center, normal, w, h, mid='fieldstone', seed=0, name='spall'):
    """Patch where the lime render has fallen off, exposing the rubble/brick behind (irregular outline)."""
    from mathutils import noise
    n = V(normal).normalized()
    rr = V((0, 0, 1)).cross(n).normalized()
    u = n.cross(rr)
    c = V(center) + n * 0.005
    pts = []
    for i in range(14):
        a = 2 * math.pi * i / 14
        k = 0.65 + 0.5 * noise.noise(V((math.cos(a) * 1.7 + seed, math.sin(a) * 1.7, seed * 0.37)))
        pts.append(c + rr * math.cos(a) * w / 2 * k + u * math.sin(a) * h / 2 * k)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    K.part(bm, mid, name=name, grime=0.5, bisect=False, lod='drop')


def laundry(p0, p1, z=1.7, n=4, name='laundry'):
    """Two posts, a line and hanging cloths (roof terraces)."""
    p0, p1 = V((*p0[:2], p0[2])), V((*p1[:2], p1[2]))
    bm = bmesh.new()
    for p in (p0, p1):
        C.cyl_bm(bm, p, p + V((0, 0, z + 0.1)), 0.035, 6)
    K.part(bm, 'timber_beam', name=name + '_posts', uv='beam', axis=(0, 0, 1))
    bm = rope(p0 + V((0, 0, z)), p1 + V((0, 0, z)), 0.08, 0.007, 6)
    K.part(bm, 'cast_iron', name=name + '_line', grime=0)
    r = K.rng()
    bm = bmesh.new()
    d = p1 - p0
    for i in range(n):
        t0 = (i + 0.6) / (n + 0.5)
        a = p0.lerp(p1, t0) + V((0, 0, z - 0.08 * 4 * t0 * (1 - t0)))
        wdt, hh = r.uniform(0.4, 0.8), r.uniform(0.5, 0.9)
        b = a + d.normalized() * wdt
        sw = V((d.y, -d.x, 0)).normalized() * r.uniform(-0.05, 0.05)
        bm.faces.new([bm.verts.new(q) for q in (a, b, b - V((0, 0, hh)) + sw, a - V((0, 0, hh)) + sw)])
        bm.faces.new([bm.verts.new(q) for q in (a - V((0, 0, hh)) + sw + V((0, 0, 0)) , b - V((0, 0, hh)) + sw, b, a)][::1][::-1])
    tints = [(1.05, 1.05, 1.05), (0.7, 0.8, 1.1), (1.1, 0.95, 0.75)]
    K.part(bm, 'canvas', name=name + '_cloth', mat_tint=r.choice(tints), grime=0, bisect=False, lod='drop')


def course(poly, z, h, proj, mid, inset=0.05, name='course', mat_tint=None):
    poly = C.ccw(poly)
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(poly, proj), C.poly_offset(poly, -inset), z, z + h)
    return K.part(bm, mid, name=name, mat_tint=mat_tint)


def chamfer(poly, c=0.18):
    """Soften the corners of a CCW polygon (hand-plastered mud corners): each corner -> 2 vertices."""
    out = []
    n = len(poly)
    for i in range(n):
        p, a, b = V((*poly[i], 0)), V((*poly[i - 1], 0)), V((*poly[(i + 1) % n], 0))
        out.append(tuple((p + (a - p).normalized() * c)[:2]))
        out.append(tuple((p + (b - p).normalized() * c)[:2]))
    return out


def battered_ring(poly, h, thick, batter, mid, frames=(), z0=0.0, name='walls', mat_tint=None, footprint=True, chamf=0.2):
    """Mud-brick wall ring on the (sharp-cornered) CCW footprint `poly`: outer face leans in by `batter` over height h,
    corners softened by `chamf`. Offsets are taken from the sharp polygon, then chamfered, so the inner ring never
    self-intersects (a chamfer-then-offset ring did, and made EXACT booleans collapse)."""
    poly = C.ccw(poly)
    ob_, ot_ = chamfer(poly, chamf), chamfer(C.poly_offset(poly, -batter), chamf * 0.9)
    ib_ = chamfer(C.poly_offset(poly, -thick - batter * 0.3), 0.04)
    it_ = ib_
    poly = ob_
    bm = bmesh.new()
    n = len(poly)
    vo = [bm.verts.new((*p, z0)) for p in ob_]
    vt = [bm.verts.new((*p, z0 + h)) for p in ot_]
    wi = [bm.verts.new((*p, z0)) for p in ib_]
    wt = [bm.verts.new((*p, z0 + h)) for p in it_]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vo[i], vo[j], vt[j], vt[i]))
        bm.faces.new((wi[j], wi[i], wt[i], wt[j]))
        bm.faces.new((vt[i], vt[j], wt[j], wt[i]))
        bm.faces.new((vo[j], vo[i], wi[i], wi[j]))
    bm = KA.boolean_cut(bm, [f for f in frames if f.o.z < z0 + h])
    ob = K.part(bm, mid, name=name, mat_tint=mat_tint)
    if footprint:
        C.footprint(poly, 'HIGH')
    return ob


def lean_in(fr, batter, h):
    """Move a Frame onto a battered wall face (inset by the lean at its mid height)."""
    fr.o = fr.o - fr.n * batter * min(1.0, (fr.o.z + fr.h * 0.5) / h)
    return fr


def joists(poly, z, edges, spacing=0.6, r=0.085, out=0.35, mid='timber_beam', name='joists'):
    """Palm-trunk / pole joist ends protruding from the wall head along the given edges."""
    rr = K.rng()
    bm = bmesh.new()
    for i in edges:
        a, b, rv, n, L = edge(poly, i)
        k = int(L / spacing)
        for j in range(1, k):
            p = a + rv * (L * j / k) + V((0, 0, z + rr.uniform(-0.03, 0.03)))
            C.cyl_bm(bm, p - n * 0.3, p + n * (out + rr.uniform(-0.08, 0.08)), r * rr.uniform(0.8, 1.15), 6)
    K.part(bm, mid, name=name, uv='beam', axis=(1, 0, 0), grime=0.7, mat_tint=(0.9, 0.76, 0.6))


def tabouna(c, r=0.55, name='oven'):
    """Clay bread oven (tabouna): squat dome with a mouth, on a low plinth."""
    cx, cy = c[:2]
    dome((cx, cy), r, 0.0, 'adobe_ochre', drum_h=0.25, segs=12, rings=4, finial=False, name=name, tint=(0.95, 0.88, 0.8))
    K.decal('soot', (cx, cy - r - 0.05, 0.45), (0, -1, 0), 0.5, 0.6, alpha=0.8)
    bm = bmesh.new()
    C.box_bm(bm, (cx, cy - r - 0.02, 0.28), (0.34, 0.12, 0.3))
    K.part(bm, 'interior_dark', name=name + '_mouth', grime=0, bisect=False)


def shade(x0, y0, x1, y1, z, mid_posts='timber_beam', name='shade'):
    """Palm-log shade (arbour): 4-6 posts, beams, slat/frond cover."""
    rr = K.rng()
    bm = bmesh.new()
    nx = 2 if x1 - x0 < 3.5 else 3
    for i in range(nx):
        x = x0 + (x1 - x0) * i / (nx - 1)
        for y in (y0, y1):
            C.cyl_bm(bm, (x, y, 0), (x + rr.uniform(-0.04, 0.04), y, z), 0.08, 6)
    for y in (y0, y1):
        C.beam_bm(bm, (x0 - 0.2, y, z + 0.06), (x1 + 0.2, y, z + 0.06), 0.14, 0.12)
    K.part(bm, mid_posts, name=name + '_frame', uv='beam', axis=(0, 0, 1))
    bm = bmesh.new()
    k = int((x1 - x0 + 0.4) / 0.4)
    for i in range(k):
        x = x0 - 0.2 + (x1 - x0 + 0.4) * (i + 0.5) / k
        C.cyl_bm(bm, (x, y0 - 0.25, z + 0.19), (x + rr.uniform(-0.05, 0.05), y1 + 0.25, z + 0.19), 0.05, 5)
    K.part(bm, 'timber_beam', name=name + '_poles', uv='beam', axis=(0, 1, 0), grime=0.4, mat_tint=(0.9, 0.78, 0.62))
    bm = bmesh.new()      # palm-frond / reed thatch mat with ragged edges
    nx, ny = 6, 4
    vv = [[bm.verts.new(V((x0 - 0.35 + (x1 - x0 + 0.7) * i / nx + rr.uniform(-0.08, 0.08), y0 - 0.4 + (y1 - y0 + 0.8) * j / ny + rr.uniform(-0.08, 0.08),
                           z + 0.26 + rr.uniform(-0.03, 0.05)))) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.07)
    K.part(bm, 'roof_thatch', name=name + '_thatch', grime=0.3, mat_tint=(0.95, 0.88, 0.72))


def well_head(c, r=0.75, h=0.8, mid='ashlar_limestone', frame='stone', name='well', lod_keep=True):
    """Octagonal masonry well curb with dark shaft, coping, two posts (stone or timber) + cross beam, pulley,
    rope and bucket; stone trough beside it is up to the caller. Registers LOW footprint."""
    cx, cy = c[:2]
    oct_ = [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), cy + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    inn = C.poly_offset(oct_, -0.22)
    bm = bmesh.new()
    KA.ring_bm(bm, oct_, inn, 0.0, h)
    K.part(bm, mid, name=name + '_curb')
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(oct_, 0.05), C.poly_offset(inn, -0.03), h, h + 0.1)
    K.part(bm, mid, name=name + '_cope', mat_tint=(1.05, 1.03, 1.0))
    bm = bmesh.new()          # shaft lining going down + dark water surface far below
    KA.ring_bm(bm, inn, C.poly_offset(inn, -0.02), -0.05, 0.0)     # (kept above -0.06: the pivot/ground contract)
    K.part(bm, mid, name=name + '_lining', mat_tint=(0.35, 0.33, 0.3), grime=1.0, lod='drop')
    bm = bmesh.new()
    C.prism_bm(bm, inn, -0.05, -0.04)
    K.part(bm, 'glass_dirty', name=name + '_water', grime=0, bisect=False, mat_tint=(0.22, 0.27, 0.25))
    bm = bmesh.new()
    zt = h + 1.7
    for s in (-1, 1):
        p = V((cx + s * (r + 0.05), cy, 0))
        if frame == 'stone':
            C.box_bm(bm, tuple(p + V((0, 0, zt / 2))), (0.3, 0.3, zt))
        else:
            C.cyl_bm(bm, p, p + V((0, 0, zt)), 0.09, 6)
    K.part(bm, mid if frame == 'stone' else 'timber_beam', name=name + '_posts', uv='aligned' if frame == 'stone' else 'beam', axis=(0, 0, 1))
    bm = bmesh.new()
    C.beam_bm(bm, (cx - r - 0.3, cy, zt + 0.08), (cx + r + 0.3, cy, zt + 0.08), 0.16, 0.16)
    K.part(bm, 'timber_beam', name=name + '_beam', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    C.cyl_bm(bm, (cx, cy - 0.05, zt - 0.12), (cx, cy + 0.05, zt - 0.12), 0.16, 10)      # pulley wheel
    C.cyl_bm(bm, (cx, cy, zt), (cx, cy, zt - 0.1), 0.02, 4)
    K.part(bm, 'timber_grey', name=name + '_pulley', smooth=True)
    bm = rope((cx + 0.15, cy, zt - 0.12), (cx + 0.15, cy, h + 0.55), 0.0, 0.012, 2)
    rope((cx - 0.15, cy, zt - 0.12), (cx - r - 0.2, cy + 0.05, 1.0), 0.0, 0.012, 2, bm=bm)
    K.part(bm, 'hessian', name=name + '_rope', grime=0)
    bm = bmesh.new()      # leather/iron bucket resting on the coping
    b0 = V((cx + 0.15, cy, h + 0.25))
    C.cyl_bm(bm, b0, b0 + V((0, 0, 0.3)), 0.12, 10, r1=0.15)
    K.part(bm, 'steel_galv', name=name + '_bucket', smooth=True)
    C.footprint(oct_, 'LOW', 'well')
    C.anchor('well', (cx, cy, h))


def trough(p, L=1.8, w=0.55, h=0.55, rot=0.0, mid='ashlar_limestone', name='trough'):
    bm = bmesh.new()
    cx, cy = p[:2]
    c, s = math.cos(rot), math.sin(rot)
    R = lambda x, y: (cx + x * c - y * s, cy + x * s + y * c)
    for (x0, x1, y0, y1, z1) in ((-L / 2, L / 2, -w / 2, -w / 2 + 0.1, h), (-L / 2, L / 2, w / 2 - 0.1, w / 2, h),
                                 (-L / 2, -L / 2 + 0.1, -w / 2, w / 2, h), (L / 2 - 0.1, L / 2, -w / 2, w / 2, h), (-L / 2, L / 2, -w / 2, w / 2, 0.15)):
        C.prism_bm(bm, [R(x0, y0), R(x1, y0), R(x1, y1), R(x0, y1)], 0.0, z1)
    K.part(bm, mid, name=name)
    bm = bmesh.new()
    C.prism_bm(bm, [R(-L / 2 + 0.1, -w / 2 + 0.1), R(L / 2 - 0.1, -w / 2 + 0.1), R(L / 2 - 0.1, w / 2 - 0.1), R(-L / 2 + 0.1, w / 2 - 0.1)], 0.3, 0.42)
    K.part(bm, 'glass_dirty', name=name + '_water', grime=0, bisect=False, mat_tint=(0.5, 0.6, 0.55))
    C.footprint([R(-L / 2, -w / 2), R(L / 2, -w / 2), R(L / 2, w / 2), R(-L / 2, w / 2)], 'LOW', 'trough')


def finalize(outdir, soften=True, tone=1.0, quantize=True, **kw):
    """Drop empty parts (after bite()/booleans), flatten debris that sank below the ground plane, then the kit finalize."""
    for o in list(C.A.parts):
        if o.name in bpy.data.objects and o.type == 'MESH' and not o.get('dz_keep_z'):
            for v in o.data.vertices:
                if v.co.z < -0.06:
                    v.co.z = -0.06
        if o.name not in bpy.data.objects or len(o.data.polygons) == 0:
            C.A.parts.remove(o)
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o)
    if soften:
        soften_interiors()
    if tone:
        desert_tone(tone)
    l2 = os.environ.get('DZ_LOD2')
    if l2 and 'lods' not in kw:
        a, b_, c_ = (float(x) for x in l2.split(','))
        kw['lods'] = ((0.4, 0.3, 4.0), (a, b_, c_))
    meta = K.finalize(outdir, **kw)
    for f in os.listdir(outdir):
        if f.endswith('.glb'):
            colors_to_ubyte(os.path.join(outdir, f))
            if quantize:
                quantize_glb(os.path.join(outdir, f))
            # effective-albedo floor (no pure-black charcoal/iron/tar under the game's sun + sky)
            from albedo_floor import albedo_floor
            from vcol_floor import vcol_floor
            albedo_floor(os.path.join(outdir, f), float(os.environ.get('DZ_AFLOOR', 0.045)))
            vcol_floor(os.path.join(outdir, f), float(os.environ.get('DZ_VFLOOR', 0.03)))
    import json
    sp = os.path.join(outdir, C.A.name + '.kit.json')
    sc = json.load(open(sp))
    for l in sc.get('lods', []):
        l['bytes'] = os.path.getsize(os.path.join(outdir, l['file']))
    sc['vertex_colors'] = 'COLOR_0 ubyte (grime x base colour; alpha = decal opacity)'
    json.dump(sc, open(sp, 'w'), indent=1)
    return meta


def sandbags(p0, p1, rows=4, name='sandbags', thick=2, footprint=True):
    """Stretcher-bond sandbag wall from p0 to p1 (ground, Blender XY): pillow-shaped bags (bevelled boxes),
    `thick` bags deep, `rows` high (0.14 m per row). Registers a LOW footprint (crouch cover)."""
    rr = K.rng()
    p0, p1 = V((*p0[:2], 0)), V((*p1[:2], 0))
    d = p1 - p0
    Lw = d.length
    d.normalize()
    n = V((d.y, -d.x, 0))
    ang = math.atan2(d.y, d.x)
    bl, bw, bh = 0.6, 0.34, 0.15
    bm = bmesh.new()
    for row in range(rows):
        off = (bl / 2) * (row % 2)
        k = int((Lw - off) / bl)
        for j in range(k):
            for t in range(thick):
                c = p0 + d * (off + bl * (j + 0.5)) + n * ((t - (thick - 1) / 2) * bw * 1.02) + V((0, 0, row * 0.14 + bh / 2))
                c += V((rr.uniform(-0.02, 0.02), rr.uniform(-0.02, 0.02), 0))
                fs = C.box_bm(bm, tuple(c), (bl - 0.03, bw - 0.02, bh), ang + rr.uniform(-0.06, 0.06), taper=(0.9, 0.82))
                bot = min(fs, key=lambda f: f.calc_center_median().z) if fs else None      # unseen bottom face
                if bot is not None and row > 0:
                    bm.faces.remove(bot)
    K.part(bm, 'hessian', name=name, grime=0.6, mat_tint=(1.0, 0.95, 0.85), bisect=False)
    if footprint:
        w = bw * thick / 2 + 0.05
        C.footprint([tuple(p0 - n * w)[:2], tuple(p1 - n * w)[:2], tuple(p1 + n * w)[:2], tuple(p0 + n * w)[:2]], 'LOW', 'sandbags')


def flagpole(base, h=7.0, name='flagpole'):
    """Steel flagpole on a concrete block with halyard; the flag itself is animated cloth in-game (anchor 'flag')."""
    b = V(base)
    bm = bmesh.new()
    C.cyl_bm(bm, b, b + V((0, 0, h)), 0.05, 8, r1=0.03)
    C.cyl_bm(bm, b + V((0, 0, h)), b + V((0, 0, h + 0.1)), 0.06, 8)
    C.cyl_bm(bm, b + V((0.06, 0, 1.0)), b + V((0.06, 0, h)), 0.004, 3, caps=False)
    K.part(bm, 'steel_painted', name=name, smooth=True, grime=0.3, mat_tint=(0.75, 0.72, 0.62))
    bm = bmesh.new()
    C.box_bm(bm, tuple(b + V((0, 0, 0.2))), (0.6, 0.6, 0.4), taper=(0.8, 0.8))
    K.part(bm, 'concrete_bunker', name=name + '_base')
    C.anchor('flag', tuple(b + V((0, 0, h - 0.05))), (1, 0, 0), size=[1.5, 1.0], node='flag',
             note='static stand-in flag node; hide it when the animated cloth is spawned')
    halyard(b, b + V((0, 0, h)), name + '_halyard')
    flag_balken(b + V((0, 0, h - 0.08)), 1.5, 1.0, name='flag', seed=h)


def colors_to_ubyte(glb):
    """Repack COLOR_0 (float/ushort from Blender) as normalized UNSIGNED_BYTE VEC4 (core glTF) to save bytes."""
    sys.path.insert(0, KIT + '/tools')
    import glb_post as G, struct as S
    js, b = G.read_glb(glb)
    nb = bytearray()
    views = js['bufferViews']
    remap = {}
    for m in js['meshes']:
        for p in m['primitives']:
            ai = p['attributes'].get('COLOR_0')
            if ai is None or ai in remap:
                continue
            a = js['accessors'][ai]
            bv = views[a['bufferView']]
            n, comps = a['count'], {'VEC3': 3, 'VEC4': 4}[a['type']]
            fmt = {5126: ('f', 4, 1.0), 5123: ('H', 2, 65535.0), 5121: ('B', 1, 255.0)}[a['componentType']]
            if a['componentType'] == 5121:
                continue
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride', fmt[1] * comps)
            out = bytearray()
            for i in range(n):
                vals = S.unpack_from('<%d%s' % (comps, fmt[0]), b, off + i * stride)
                q = [max(0, min(255, int(round(v / fmt[2] * 255)))) for v in vals] + ([255] if comps == 3 else [])
                out += bytes(q)
            remap[ai] = out
    if not remap:
        return
    for ai, out in remap.items():        # append new views at the end of the BIN chunk
        while len(b) % 4:
            b.append(0)
        views.append({'buffer': 0, 'byteOffset': len(b), 'byteLength': len(out)})
        b += out
        a = js['accessors'][ai]
        a.update({'bufferView': len(views) - 1, 'componentType': 5121, 'normalized': True, 'type': 'VEC4'})
        a.pop('byteOffset', None)
        a.pop('min', None); a.pop('max', None)
    # compact: drop now-unused views by rebuilding the buffer
    used = sorted({a['bufferView'] for a in js['accessors'] if 'bufferView' in a} | {i['bufferView'] for i in js.get('images', []) if 'bufferView' in i})
    nb, newidx = bytearray(), {}
    for vi in used:
        v = views[vi]
        while len(nb) % 4:
            nb.append(0)
        chunk = b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        nv = dict(v, byteOffset=len(nb))
        newidx[vi] = len(newidx)
        nb += chunk
        views[vi] = nv
    js['bufferViews'] = [views[vi] for vi in used]
    for a in js['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = newidx[a['bufferView']]
    for i in js.get('images', []):
        if 'bufferView' in i:
            i['bufferView'] = newidx[i['bufferView']]
    G.write_glb(glb, js, nb)


def safe_bite(center, radius, squash=(1, 0.8, 1.2), seed=1):
    """K.bite, but a part whose EXACT boolean collapsed (lost > 70 % of its faces, e.g. on thin/battered shells)
    gets its pre-bite mesh back instead of vanishing."""
    saved = {}
    for o in C.A.parts:
        if o.name in bpy.data.objects and o.type == 'MESH' and len(o.data.polygons) > 40:
            saved[o.name] = (o, o.data.copy(), len(o.data.polygons))
    K.bite(center, radius, squash, seed)
    for nm, (o, me, n0) in saved.items():
        if nm in bpy.data.objects and len(o.data.polygons) < 0.3 * n0:
            print('[dz] safe_bite: restoring', nm, len(o.data.polygons), '/', n0, flush=True)
            o.data = me
        else:
            bpy.data.meshes.remove(me)


class RagFrame(KA.Frame):
    """Blast breach through a wall: ragged outline (wider low, jagged crown), cut like an opening."""

    def __init__(s, fr, seed=0):
        KA.Frame.__init__(s, fr.o, fr.n, fr.r, fr.w, fr.h, fr.depth, 'rect', 'breach')
        s.seed = seed

    def outline(s, n_arc=10, inset=0.0):
        from mathutils import noise
        w2, h = s.w / 2 - inset, s.h - inset
        pts = [(-w2 * 0.85, -0.05), (w2 * 0.85, -0.05)]
        n = 7
        for i in range(1, n):                       # right flank up
            t = i / n
            pts.append((w2 * (0.85 + 0.15 * t) + 0.12 * noise.noise(V((t * 3, s.seed, 1))), h * t * 0.8))
        for i in range(n + 1):                      # crown, right -> left
            t = i / n
            x = w2 * (1 - 2 * t)
            pts.append((x, h * (0.8 + 0.2 * math.sin(math.pi * t)) + 0.25 * noise.noise(V((t * 5, s.seed, 2)))))
        for i in range(n - 1, 0, -1):               # left flank down
            t = i / n
            pts.append((-w2 * (0.85 + 0.15 * t) + 0.12 * noise.noise(V((t * 3, s.seed, 3))), h * t * 0.8))
        return pts


# ====================================================================== REWORK 1 helpers (art director round 1)
def _seg_frame(p0, p1):
    p0, p1 = V(p0), V(p1)
    d = V((p1.x - p0.x, p1.y - p0.y, 0))
    L = d.length
    d = d / max(L, 1e-6)
    return p0, p1, d, V((d.y, -d.x, 0)), L


def _loft_profile(bm, p0, p1, prof_fn, step=0.6):
    """Loft a closed cross-section along p0->p1 (horizontal). prof_fn(u, L) -> [(x across, z)] CCW seen from p0."""
    p0, p1, d, n, L = _seg_frame(p0, p1)
    k = max(1, int(round(L / step)))
    rings = []
    for i in range(k + 1):
        u = i / k
        c = p0.lerp(p1, u)
        rings.append([c + n * x + V((0, 0, zz)) for x, zz in prof_fn(u, L)])
    C.loft_bm(bm, rings, close_start=True, close_end=True)


def coping_bm(bm, p0, p1, z, t, seed=0, over=0.05):
    """Lime-plastered coping on a wall/parapet top: low crowned cap, overhanging drip lips both sides, gently
    irregular (hand-floated). ~0.11 m tall above the wall top."""
    from mathutils import noise as N
    def prof(u, L):
        j = 0.012 * N.noise(V((u * L * 0.9 + seed, seed * 0.7, 0.3)))
        h = t / 2
        return [(-h, 0.0), (h, 0.0), (h + over, -0.025), (h + over, 0.035 + j), (0.0, 0.105 + j), (-h - over, 0.035 + j), (-h - over, -0.025)]
    _loft_profile(bm, V(p0) + V((0, 0, z)), V(p1) + V((0, 0, z)), prof, 1.3)


def mud_wall_bm(bm, p0, p1, z, h, t, seed=0, erosion=1.0):
    """Hand-built mud parapet / wall head: battered sides, rounded eroded crown, height wandering +-6 cm with
    occasional rain-eroded dips."""
    from mathutils import noise as N
    def prof(u, L):
        x = u * L
        e = 0.06 * N.noise(V((x * 0.8 + seed, seed * 1.3, 0.1))) + 0.04 * N.noise(V((x * 2.6, seed, 0.7)))
        dip = max(0.0, N.noise(V((x * 0.45 + seed * 2.1, 3.3, seed))) - 0.35) * 0.45 * erosion
        end = min(1.0, min(u, 1 - u) * L / 0.35)          # slumped ends
        hh = max(0.25, (h + e - dip) * (0.75 + 0.25 * end))
        b = t / 2
        bu = 0.01 * N.noise(V((x * 1.7, seed, 2.0)))
        return [(-b, -0.02), (b, -0.02), (b - 0.02 + bu, hh * 0.55), (b * 0.62, hh * 0.9), (b * 0.2, hh), (-b * 0.2, hh * 0.99),
                (-b * 0.62, hh * 0.9), (-b + 0.02 - bu, hh * 0.55)]
    _loft_profile(bm, V(p0) + V((0, 0, z)), V(p1) + V((0, 0, z)), prof, 0.5)


def soften_interiors(tint=(0.62, 0.57, 0.5), mid='plaster_rough'):
    """Replace every flat 'interior_dark' card (near-black 14/255 albedo) by dim plaster so openings read as a shaded
    room, not a void. Call just before finalize."""
    import bpy
    m = C.mat(mid, tint)
    for o in C.A.parts:
        if o.name in bpy.data.objects and o.type == 'MESH' and o.data.materials and o.data.materials[0].get('kit_id') == 'interior_dark':
            o.data.materials[0] = m


def recess_room(fr, depth=2.0, mid='plaster_rough', tint=(0.62, 0.58, 0.53), floor='patio_flags', name='room', back=None,
                ceil=True, margin=0.35):
    """Modelled room volume behind an opening (back wall, side walls, floor, ceiling) so arcades/gates/breaches show
    real depth lit by bounce + AO instead of a black card. Frame-local: d negative = into the wall."""
    d0 = -fr.depth + 0.02
    d1 = -fr.depth - depth
    x0, x1 = -fr.w / 2 - margin, fr.w / 2 + margin
    top = fr.h + 0.15
    bm = bmesh.new()
    KA.lbox(bm, fr, x0 - 0.2, x1 + 0.2, 0.0, top + 0.2, d1 - 0.2, d1)          # back wall
    KA.lbox(bm, fr, x0 - 0.2, x0, 0.0, top, d1, d0)                            # side walls
    KA.lbox(bm, fr, x1, x1 + 0.2, 0.0, top, d1, d0)
    if ceil:
        KA.lbox(bm, fr, x0 - 0.2, x1 + 0.2, top, top + 0.2, d1, d0)
    K.part(bm, mid, name=name + '_walls', mat_tint=tint, grime=0.8, lod='drop')
    bm = bmesh.new()
    KA.lbox(bm, fr, x0, x1, -0.02, 0.005, d1, d0)
    K.part(bm, floor, name=name + '_floor', mat_tint=(0.8, 0.78, 0.74), grime=0.5, lod='drop')
    if back:
        back(fr, d1)


def _blob_outline(c, rr, u, w, h, seed, n=16, rough=0.5):
    from mathutils import noise as N
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 0.7 + rough * N.noise(V((math.cos(a) * 1.6 + seed * 0.71, math.sin(a) * 1.6, seed * 0.37)))
        pts.append(c + rr * math.cos(a) * w / 2 * k + u * math.sin(a) * h / 2 * k)
    return pts


def spall2(center, normal, w, h, mid='fieldstone', skin='limewash_worn', skin_tint=None, seed=0, name='spall', rim=0.018):
    """Render fallen off a wall: exposed rubble/brick patch + a raised broken-render rim (lit edge, shadow line) so
    the loss reads as depth, not a sticker. Up to ~40 tris."""
    n = V(normal).normalized()
    rr = V((0, 0, 1)).cross(n).normalized() if abs(n.z) < 0.9 else V((1, 0, 0))
    u = n.cross(rr)
    c = V(center)
    inner = _blob_outline(c + n * 0.004, rr, u, w, h, seed, 14, 0.55)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in inner])
    K.part(bm, mid, name=name, grime=0.6, bisect=False, lod='drop', mat_tint=(0.92, 0.88, 0.84))['dz_noao'] = 1
    outer = [c + (p - c) * 1.12 + n * 0.0 for p in inner]
    bm = bmesh.new()
    vi = [bm.verts.new(p + n * rim) for p in inner]
    vo = [bm.verts.new(p + n * 0.002) for p in outer]
    m = len(vi)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
        bm.faces.new((vi[i], vi[j], bm.verts.new(inner[j] + n * 0.004), bm.verts.new(inner[i] + n * 0.004)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, skin, name=name + '_rim', grime=0.4, bisect=False, lod='drop', mat_tint=skin_tint)['dz_noao'] = 1


def patch_quad(poly3, mid, name, tint=None, lift=0.012):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(V(p) + V((0, 0, lift))) for p in poly3])
    ob = K.part(bm, mid, name=name, grime=0.3, bisect=False, lod='drop', mat_tint=tint)
    ob['dz_noao'] = 1
    return ob


def roof_patches(poly, z, n=4, seed=0, name='rpatch', lime=True, tar=True, lime_mat='limewash_worn', lime_tint=(1.0, 0.98, 0.95)):
    """Irregular screed repairs on a flat roof: fresh lime (pale) and tarred (dark) patches, cracks, stain decals."""
    rr = K.rng()
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    for i in range(n):
        cx, cy = rr.uniform(min(xs) + 0.8, max(xs) - 0.8), rr.uniform(min(ys) + 0.8, max(ys) - 0.8)
        w, h = rr.uniform(0.7, 2.2), rr.uniform(0.5, 1.6)
        pts = _blob_outline(V((cx, cy, z)), V((1, 0, 0)), V((0, 1, 0)), w, h, seed + i * 3, 12, 0.45)
        kind = 'bitumen_felt' if (tar and (not lime or i == 1)) else lime_mat
        if kind == 'bitumen_felt':
            pts = [V((cx, cy, z)) + (p - V((cx, cy, z))) * 0.55 for p in pts]
        patch_quad(pts, kind, '%s%d' % (name, i), tint=None if kind == 'bitumen_felt' else lime_tint, lift=0.008 + 0.002 * i)
    for i in range(n + 1):
        cx, cy = rr.uniform(min(xs) + 0.5, max(xs) - 0.5), rr.uniform(min(ys) + 0.5, max(ys) - 0.5)
        K.decal(rr.choice(['stain_blotch', 'crack', 'dirt_splash', 'efflorescence']), (cx, cy, z + 0.02), (0, 0, 1),
                rr.uniform(0.8, 2.0), rr.uniform(0.8, 2.0), up=(rr.uniform(-1, 1), 1, 0), alpha=0.35)


def hatch(c, z, w=0.7, mid='timber_grey', curb='plaster_rough', tint=None, name='hatch', lid_open=False):
    """Roof access / cistern hatch: plastered curb + boarded lid with iron straps and ring."""
    cx, cy = c[:2]
    bm = bmesh.new()
    KA.ring_bm(bm, [(cx - w / 2 - 0.12, cy - w / 2 - 0.12), (cx + w / 2 + 0.12, cy - w / 2 - 0.12), (cx + w / 2 + 0.12, cy + w / 2 + 0.12),
                    (cx - w / 2 - 0.12, cy + w / 2 + 0.12)], [(cx - w / 2, cy - w / 2), (cx + w / 2, cy - w / 2), (cx + w / 2, cy + w / 2),
                                                                (cx - w / 2, cy + w / 2)], z, z + 0.2)
    K.part(bm, curb, name=name + '_curb', mat_tint=tint)
    bm = bmesh.new()
    nb = 5
    for i in range(nb):
        x0 = cx - w / 2 - 0.05 + (w + 0.1) * i / nb
        C.box_bm(bm, (x0 + (w + 0.1) / nb / 2, cy, z + 0.225), ((w + 0.1) / nb - 0.012, w + 0.1, 0.05))
    K.part(bm, mid, name=name + '_lid', uv='beam', axis=(0, 1, 0), grime=0.6)
    bm = bmesh.new()
    for yy in (-w * 0.3, w * 0.3):
        C.box_bm(bm, (cx, cy + yy, z + 0.255), (w + 0.12, 0.05, 0.012))
    C.cyl_bm(bm, (cx - 0.06, cy, z + 0.26), (cx + 0.06, cy, z + 0.26), 0.05, 8)
    K.part(bm, 'cast_iron', name=name + '_iron', grime=0.2, mat_tint=(0.4, 0.36, 0.33))


def vault_dome(c, w, d, z, mid='limewash_worn', tint=None, name='qubba', kind='dome'):
    """Low rooftop vault over a room (Tunisian qubba or barrel vault) - breaks up big flat roofs."""
    cx, cy = c[:2]
    if kind == 'dome':
        return dome((cx, cy), min(w, d) / 2 * 0.92, z, mid, drum_h=0.22, segs=16, rings=5, finial=False, name=name, tint=tint)
    bm = bmesh.new()
    rings = []
    for i in range(9):
        a = math.pi * i / 8
        yy = cy - d / 2 * math.cos(a)
        zz = z + 0.15 + d / 2 * 0.55 * math.sin(a)
        rings.append([V((cx - w / 2, yy, z if i in (0, 8) else zz)), V((cx + w / 2, yy, z if i in (0, 8) else zz))])
    for i in range(8):
        a0, a1 = rings[i], rings[i + 1]
        bm.faces.new([bm.verts.new(a0[0]), bm.verts.new(a0[1]), bm.verts.new(a1[1]), bm.verts.new(a1[0])])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, mid, name=name, smooth=True, mat_tint=tint, lod='keep')
    bm = bmesh.new()
    for sx in (-1, 1):   # end tympana (flat-shaded, separate part so the shell normals stay soft)
        pts = [V((cx + sx * w / 2, r_[0].y, r_[0].z)) for r_ in rings]
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.normal_update()
        if f.normal.x * sx < 0:
            f.normal_flip()
    K.part(bm, mid, name=name + '_ends', mat_tint=tint)


def stair_flight(p0, direction, width, rise, n, mid='limewash_worn', tint=None, cheek=1, rail_h=0.8, niche=True,
                 name='stair', seed=0):
    """External masonry stair: solid treads + a plastered cheek wall (trapezoid down to the ground) with a sloping
    lime coping (drip lips), a square newel with a capped top at the foot, an arched storage niche under the flight
    and a broken-render patch. Returns top landing centre."""
    d = V(direction).normalized()
    s = V((d.y, -d.x, 0)) * cheek
    p0 = V(p0)
    top = K.stairs(tuple(p0), tuple(d), width, rise, n, mid, solid=True, name=name, meta=False)
    go = 0.28
    L = go * n
    t = 0.22
    a = p0 + s * (width / 2 + t / 2)
    b = a + d * L
    bm = bmesh.new()
    # cheek wall as a prism: 2D outline in (along, up), extruded across s
    ol = [(0.0, 0.0), (L, 0.0), (L, rise + rail_h), (0.0, rail_h)]
    q = [[a + d * u + V((0, 0, zz)) - s * t / 2 for u, zz in ol], [a + d * u + V((0, 0, zz)) + s * t / 2 for u, zz in ol]]
    C.loft_bm(bm, q, close_start=True, close_end=True)
    fr = None
    if niche and L > 2.0:
        fr = KA.Frame(a + d * (L * 0.55) + s * t / 2, s, -d if cheek > 0 else d, min(1.0, L * 0.3), min(1.3, rise * 0.45), t + 0.4, 'arch', 'window')
        bm = KA.boolean_cut(bm, [fr])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name + '_cheek', mat_tint=tint)
    if fr is not None:          # niche back + floor (dim), pots stored inside
        bm = bmesh.new()
        KA.lbox(bm, fr, -fr.w / 2 - 0.05, fr.w / 2 + 0.05, 0.0, fr.h + 0.05, -t - 0.5, -t - 0.3)
        K.part(bm, 'plaster_rough', name=name + '_niche', mat_tint=(0.7, 0.66, 0.6), lod='drop')
    bm = bmesh.new()
    coping_bm(bm, a + V((0, 0, rail_h)), b + V((0, 0, rise + rail_h)), 0.0, t, seed=seed, over=0.04)
    K.part(bm, mid, name=name + '_cope', mat_tint=tint)
    bm = bmesh.new()      # square newel with a stepped cap
    nc = a - d * 0.05
    C.box_bm(bm, tuple(nc + V((0, 0, (rail_h + 0.25) / 2))), (0.34, 0.34, rail_h + 0.25), math.atan2(d.y, d.x))
    C.box_bm(bm, tuple(nc + V((0, 0, rail_h + 0.29))), (0.42, 0.42, 0.08), math.atan2(d.y, d.x))
    C.box_bm(bm, tuple(nc + V((0, 0, rail_h + 0.38))), (0.28, 0.28, 0.1), math.atan2(d.y, d.x), taper=(0.55, 0.55))
    K.part(bm, mid, name=name + '_newel', mat_tint=tint)
    spall2(a + d * (L * 0.25) + s * (t / 2 + 0.001) + V((0, 0, 0.5)), s, 0.6, 0.4, 'fieldstone', mid, tint, seed=seed + 5, name=name + '_sp')
    K.decal('dirt_splash', tuple(a + d * (L * 0.5) + s * (t / 2 + 0.004) + V((0, 0, 0.35))), tuple(s), L * 0.8, 0.7, alpha=0.5)
    return top


def chunk_bm(bm, c, size, rot, seed, chip=0.25):
    """Broken masonry block: a box with a few chipped (pulled-in) corners - reads as a dressed stone or brick
    fragment, never as an icosphere."""
    r = K.rng()
    sx, sy, sz = size
    R = Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X')
    c = V(c)
    vs = []
    for k, (x, y, z) in enumerate([(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]):
        p = V((x * sx / 2, y * sy / 2, z * sz / 2))
        if r.random() < chip:
            p *= r.uniform(0.55, 0.8)
        vs.append(bm.verts.new(c + R @ p))
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for f in fs:
        bm.faces.new([vs[i] for i in f])


def mound_bm(c, rx, ry, h, seed=0, rings=6, segs=18, slump=(0, 0)):
    """Smooth slumped earth / debris mound (subdivided dome with noise; slump shifts the crest)."""
    from mathutils import noise as N
    bm = bmesh.new()
    c = V(c)
    rows = []
    for i in range(rings + 1):
        t = i / rings
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            k = 1 + 0.22 * N.noise(V((math.cos(a) * 1.5 + seed, math.sin(a) * 1.5, t * 2)))
            rr = (1 - t) * k
            z = h * (1 - (1 - t) ** 1.8) * (0.85 + 0.3 * N.noise(V((math.cos(a) * 2.3, math.sin(a) * 2.3, seed + t * 4))))
            row.append(bm.verts.new(c + V((math.cos(a) * rx * rr + slump[0] * t, math.sin(a) * ry * rr + slump[1] * t, z - 0.04))))
        rows.append(row)
    for i in range(rings):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def broken_log(bm, p0, p1, r, seg=6, splinter=True):
    """Palm trunk / beam piece with a splintered (spiky) broken end at p1."""
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0)
    C.cyl_bm(bm, p0, p1, r, seg)
    if splinter:
        rr = K.rng()
        dn = d.normalized()
        s = dn.orthogonal().normalized()
        u = dn.cross(s)
        for k in range(3):
            a = 2 * math.pi * k / 3 + rr.uniform(0, 1)
            o = p1 + (s * math.cos(a) + u * math.sin(a)) * r * 0.45
            C.cyl_bm(bm, o, o + dn * rr.uniform(0.12, 0.3) + (s * math.cos(a) + u * math.sin(a)) * 0.03, r * 0.35, 4, r1=0.005)


def _merge_part(bms_fn, mid, name, **kw):
    bm = bmesh.new()
    bms_fn(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, **kw)


def rubble_mud(c, rx, ry, h, seed=0, bricks=34, logs=2, reeds=2, name='rub', footprint=True, slump=(0, 0)):
    """Slumped mud-brick collapse: soft earth mound (mud render) + scattered and still-bonded mud bricks + broken
    palm-trunk joists + torn reed/palm-frond matting + dust skirt decal. LOW footprint."""
    rr = K.rng()
    c = V(c)
    bm = mound_bm(c, rx, ry, h, seed, 6, 18, slump)
    K.part(bm, 'mud_render', name=name + '_mound', smooth=True, grime=0.6, mat_tint=(0.95, 0.92, 0.9), lod='keep')
    def bricks_fn(bm):
        for i in range(bricks):
            a, dd = rr.uniform(0, 2 * math.pi), math.sqrt(rr.random()) * 0.95
            x, y = math.cos(a) * rx * dd, math.sin(a) * ry * dd
            z = h * (1 - dd ** 1.8) * 0.9
            if i % 7 == 0:    # still-bonded fragment of wall (3 x 2 bricks)
                rot = rr.uniform(0, math.pi)
                tilt = rr.uniform(-0.6, 0.6)
                for bx in range(3):
                    for bz in range(2):
                        o = V((x, y, z + 0.05)) + Matrix.Rotation(rot, 3, 'Z') @ V(((bx - 1 + 0.5 * (bz % 2)) * 0.37, 0, bz * 0.11 * math.cos(tilt)))
                        chunk_bm(bm, c + o, (0.35, 0.17, 0.1), (tilt, 0, rot), seed + i, 0.1)
            else:
                chunk_bm(bm, c + V((x, y, z + 0.02)), (rr.uniform(0.22, 0.36), 0.17, rr.uniform(0.08, 0.11)),
                         (rr.uniform(-0.5, 0.5), rr.uniform(-0.5, 0.5), rr.uniform(0, 3.14)), seed + i, 0.35)
    _merge_part(bricks_fn, 'mudbrick', name + '_bricks', grime=0.5, mat_tint=(1.0, 0.95, 0.9))
    if logs:
        def logs_fn(bm):
            for i in range(logs):
                a = rr.uniform(0, math.pi)
                L = rr.uniform(1.4, 2.6)
                p = c + V((rr.uniform(-0.4, 0.4) * rx, rr.uniform(-0.4, 0.4) * ry, h * rr.uniform(0.35, 0.8)))
                dd = V((math.cos(a), math.sin(a), rr.uniform(-0.35, 0.35))).normalized()
                broken_log(bm, p - dd * L / 2, p + dd * L / 2, rr.uniform(0.08, 0.11), 7)
        _merge_part(logs_fn, 'palm_log', name + '_logs', uv='beam', axis=(1, 0, 0), grime=0.6)
    for k in range(reeds):
        a = rr.uniform(0, math.pi)
        p = c + V((rr.uniform(-0.5, 0.5) * rx, rr.uniform(-0.5, 0.5) * ry, h * rr.uniform(0.3, 0.8)))
        bm = bmesh.new()
        w, l = rr.uniform(0.7, 1.2), rr.uniform(0.8, 1.4)
        R = Matrix.Rotation(a, 3, 'Z')
        vv = [[bm.verts.new(p + R @ V(((i / 3 - 0.5) * l, (j / 2 - 0.5) * w, 0.12 * math.sin(i * 1.3 + j) + rr.uniform(-0.03, 0.03))))
               for j in range(3)] for i in range(4)]
        for i in range(3):
            for j in range(2):
                bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
        K.part(bm, 'roof_thatch', name='%s_reed%d' % (name, k), grime=0.5, mat_tint=(0.82, 0.74, 0.62), lod='drop')
    K.decal('dirt_splash', tuple(c + V((0, 0, 0.03))), (0, 0, 1), rx * 1.7, ry * 1.7, up=(0, 1, 0), alpha=0.4)
    if footprint:
        C.footprint([(c.x + math.cos(a) * rx * 0.85, c.y + math.sin(a) * ry * 0.85) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


def rebar_bm(bm, p0, p1, bend=0.3, r=0.009):
    """Bent reinforcing bar sticking out of broken concrete."""
    p0, p1 = V(p0), V(p1)
    m = p0.lerp(p1, 0.55) + V((0, 0, bend * (p1 - p0).length * 0.3))
    for a, b in ((p0, m), (m, p1)):
        C.cyl_bm(bm, a, b, r, 4, caps=False)


def rubble_stone(c, rx, ry, h, seed=0, blocks=26, slabs=3, beams=2, rebar=4, plaster=10, name='rub', footprint=True,
                 stone='ashlar_limestone', dust_tint=(0.86, 0.82, 0.76), slump=(0, 0)):
    """Collapsed limestone/rendered building: pale dusty mound + dressed limestone blocks + lime-plaster chunks
    (white face) + broken roof-screed slabs with bent rebar + snapped beams + dust skirt. LOW footprint."""
    rr = K.rng()
    c = V(c)
    bm = mound_bm(c, rx, ry, h, seed, 5, 15, slump)
    K.part(bm, 'sand', name=name + '_mound', smooth=True, grime=0.4, mat_tint=dust_tint, lod='keep')
    def blocks_fn(bm):
        for i in range(blocks):
            a, dd = rr.uniform(0, 2 * math.pi), math.sqrt(rr.random()) * 1.0
            z = h * (1 - min(1, dd) ** 1.8) * 0.9
            s = rr.uniform(0.7, 1.3)
            chunk_bm(bm, c + V((math.cos(a) * rx * dd, math.sin(a) * ry * dd, z + 0.05)), (0.42 * s, 0.26 * s, 0.22 * s),
                     (rr.uniform(-0.6, 0.6), rr.uniform(-0.6, 0.6), rr.uniform(0, 3.14)), seed + i, 0.3)
    _merge_part(blocks_fn, stone, name + '_blocks', grime=0.6)
    if plaster:
        def pl_fn(bm):
            for i in range(plaster):
                a, dd = rr.uniform(0, 2 * math.pi), math.sqrt(rr.random()) * 1.05
                z = h * (1 - min(1, dd) ** 1.8) * 0.9
                chunk_bm(bm, c + V((math.cos(a) * rx * dd, math.sin(a) * ry * dd, z + 0.04)), (rr.uniform(0.25, 0.6), rr.uniform(0.2, 0.45), 0.05),
                         (rr.uniform(-0.4, 0.4), rr.uniform(-0.4, 0.4), rr.uniform(0, 3.14)), seed + 50 + i, 0.4)
        _merge_part(pl_fn, 'limewash_worn', name + '_plaster', grime=0.4)
    if slabs:
        def sl_fn(bm):
            for i in range(slabs):
                a = rr.uniform(0, 2 * math.pi)
                p = c + V((math.cos(a) * rx * 0.4, math.sin(a) * ry * 0.4, h * 0.6))
                chunk_bm(bm, p, (rr.uniform(0.9, 1.6), rr.uniform(0.7, 1.2), 0.14), (rr.uniform(-0.45, 0.45), rr.uniform(-0.45, 0.45), a), seed + 90 + i, 0.3)
        _merge_part(sl_fn, 'screed_roof', name + '_slabs', grime=0.6)
    if rebar:
        def rb_fn(bm):
            for i in range(rebar):
                a = rr.uniform(0, 2 * math.pi)
                p = c + V((math.cos(a) * rx * 0.35, math.sin(a) * ry * 0.35, h * 0.62))
                dd = V((math.cos(a + 1), math.sin(a + 1), rr.uniform(0.2, 0.9))).normalized()
                rebar_bm(bm, p, p + dd * rr.uniform(0.6, 1.2), rr.uniform(-0.5, 0.8))
        _merge_part(rb_fn, 'cast_iron', name + '_rebar', grime=0.1, mat_tint=(0.45, 0.28, 0.18), lod='drop')
    if beams:
        def bm_fn(bm):
            for i in range(beams):
                a = rr.uniform(0, math.pi)
                L = rr.uniform(1.5, 2.8)
                p = c + V((rr.uniform(-0.4, 0.4) * rx, rr.uniform(-0.4, 0.4) * ry, h * rr.uniform(0.4, 0.8)))
                dd = V((math.cos(a), math.sin(a), rr.uniform(-0.3, 0.3))).normalized()
                C.beam_bm(bm, p - dd * L / 2, p + dd * L / 2, 0.14, 0.2, roll=rr.uniform(0, 0.5))
                o = p + dd * L / 2
                for k in range(3):
                    C.cyl_bm(bm, o + V((0, 0, (k - 1) * 0.05)), o + dd * rr.uniform(0.1, 0.25) + V((0, 0, (k - 1) * 0.06)), 0.03, 4, r1=0.004)
        _merge_part(bm_fn, 'timber_beam', name + '_beams', uv='beam', axis=(1, 0, 0), grime=0.6)
    K.decal('dirt_splash', tuple(c + V((0, 0, 0.03))), (0, 0, 1), rx * 3.0, ry * 3.0, up=(0, 1, 0), alpha=0.55)
    if footprint:
        C.footprint([(c.x + math.cos(a) * rx * 0.85, c.y + math.sin(a) * ry * 0.85) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


def debris_timber(c, rx, ry, seed=0, planks=14, felt=3, studs=5, name='deb', mid='timber_siding', tint=None, charred=0.0,
                  footprint=True, h=0.5):
    """Wooden-hut collapse: low heap of broken boards and splintered studs, bent tar-felt sheets, a little earth."""
    rr = K.rng()
    c = V(c)
    bm = mound_bm(c, rx * 0.7, ry * 0.7, h * 0.45, seed, 4, 14)
    K.part(bm, 'sand', name=name + '_mound', smooth=True, grime=0.4, mat_tint=(0.8, 0.75, 0.68) if not charred else (0.45, 0.42, 0.4), lod='keep')
    def pl_fn(bm):
        for i in range(planks):
            a = rr.uniform(0, math.pi)
            L = rr.uniform(0.9, 2.6)
            dd = math.sqrt(rr.random())
            b = rr.uniform(0, 2 * math.pi)
            p = c + V((math.cos(b) * rx * dd, math.sin(b) * ry * dd, h * (1 - dd) * rr.uniform(0.3, 1.0) + 0.04))
            d3 = V((math.cos(a), math.sin(a), rr.uniform(-0.25, 0.25))).normalized()
            C.beam_bm(bm, p - d3 * L / 2, p + d3 * L / 2, rr.uniform(0.14, 0.2), 0.025, roll=rr.uniform(-0.5, 0.5))
    _merge_part(pl_fn, mid, name + '_planks', uv='beam', axis=(1, 0, 0), grime=0.6, mat_tint=tint)
    def st_fn(bm):
        for i in range(studs):
            a = rr.uniform(0, math.pi)
            L = rr.uniform(0.8, 2.0)
            p = c + V((rr.uniform(-0.6, 0.6) * rx, rr.uniform(-0.6, 0.6) * ry, h * rr.uniform(0.3, 0.9)))
            d3 = V((math.cos(a), math.sin(a), rr.uniform(-0.5, 0.6))).normalized()
            C.beam_bm(bm, p - d3 * L / 2, p + d3 * L / 2, 0.1, 0.05)
            o = p + d3 * L / 2
            for k in range(2):
                C.cyl_bm(bm, o + V((0, 0, (k - 0.5) * 0.03)), o + d3 * rr.uniform(0.12, 0.3), 0.022, 4, r1=0.003)
    _merge_part(st_fn, 'timber_beam', name + '_studs', uv='beam', axis=(1, 0, 0), grime=0.6,
                mat_tint=(0.35, 0.3, 0.27) if charred else None)
    for k in range(felt):
        a = rr.uniform(0, math.pi)
        p = c + V((rr.uniform(-0.5, 0.5) * rx, rr.uniform(-0.5, 0.5) * ry, h * rr.uniform(0.2, 0.7)))
        bm = bmesh.new()
        w, l = rr.uniform(0.8, 1.0), rr.uniform(1.2, 2.2)
        R = Matrix.Rotation(a, 3, 'Z')
        cur = rr.uniform(-0.35, 0.35)
        vv = [[bm.verts.new(p + R @ V(((i / 5 - 0.5) * l, (j - 0.5) * w, cur * ((i / 5 - 0.5) * 2) ** 2 + 0.06 * math.sin(i * 2.1 + j))))
               for j in range(2)] for i in range(6)]
        for i in range(5):
            bm.faces.new((vv[i][0], vv[i + 1][0], vv[i + 1][1], vv[i][1]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
        K.part(bm, 'bitumen_felt', name='%s_felt%d' % (name, k), grime=0.2, smooth=True, lod='drop')
    K.decal('dirt_splash', tuple(c + V((0, 0, 0.03))), (0, 0, 1), rx * 2.6, ry * 2.6, up=(0, 1, 0), alpha=0.5)
    if footprint:
        C.footprint([(c.x + math.cos(a) * rx * 0.85, c.y + math.sin(a) * ry * 0.85) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


def desert_tone(strength=1.0):
    """Vertex-colour pass for the desert sun (NW, fixed): faces turned away from the sun (S/E, the ones the game
    camera sees in shade) get a warm sand-bounce tint that fades with height, so shaded plaster does not go flat
    blue-grey; up-facing surfaces get a faint dust film. Multiplies the kit COLOR_0 (never brightens)."""
    import bpy
    sun = V((-0.7071, 0.7071, 0.0))
    for o in C.A.parts:
        if o.name not in bpy.data.objects or o.type != 'MESH' or o.get('kit_node') == 'decals':
            continue
        me = o.data
        ca = me.color_attributes.get('Col')
        if ca is None or ca.domain != 'CORNER':
            continue
        mw = o.matrix_world
        for poly in me.polygons:
            n = (mw.to_3x3() @ poly.normal).normalized()
            away = max(0.0, -(n.x * sun.x + n.y * sun.y)) * (1 - abs(n.z))
            up = max(0.0, n.z)
            for li in poly.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co
                k = strength * away * max(0.0, 1 - max(0.0, p.z) / 7.0)
                col = list(ca.data[li].color)
                col[1] *= 1 - 0.035 * k
                col[2] *= 1 - 0.13 * k
                if up > 0.7:
                    col[2] *= 1 - 0.04 * strength
                ca.data[li].color = col


def mud_apron(poly, h=0.5, w=0.32, seed=0, mid='mudbrick', tint=(0.9, 0.84, 0.78), name='apron', skip=(), step=0.7):
    """Sloping eroded mud skirt (dukkana) along the wall base: rain-cut, uneven, protects the wall foot."""
    from mathutils import noise as N
    poly = C.ccw(poly)
    bm = bmesh.new()
    for i in range(len(poly)):
        if i in skip:
            continue
        a, b, rr, n, L = edge(poly, i)
        def prof(u, L_, i=i):
            x = u * L_
            k = 0.75 + 0.45 * N.noise(V((x * 0.9 + seed + i * 3.1, 0.3, seed)))
            hh, ww = h * k, w * (0.7 + 0.5 * N.noise(V((x * 1.3, i + 0.7, seed))))
            return [(-0.12, -0.02), (ww, -0.02), (ww * 0.5, hh * 0.4), (0.0, hh)]
        _loft_profile(bm, a - rr * 0.05, b + rr * 0.05, prof, step)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name, mat_tint=tint, smooth=True, grime=0.8)


def lime_patch(center, normal, w, h, seed=0, name='lime', tint=(0.88, 0.85, 0.79)):
    """Gypsum / lime-wash repair patch or whitened band on a mud wall (thin raised skin, irregular edge)."""
    n = V(normal).normalized()
    rr = V((0, 0, 1)).cross(n).normalized()
    u = n.cross(rr)
    pts = _blob_outline(V(center) + n * 0.012, rr, u, w, h, seed, 14, 0.35)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    K.part(bm, 'limewash_worn', name=name, grime=0.6, bisect=False, lod='drop', mat_tint=tint)['dz_noao'] = 1


def frond_shade(x0, y0, x1, y1, z, name='shade', seed=0):
    """Palm-log arbour roofed with individual palm fronds (midrib + leaflet blade strips at varied angles)."""
    rr = K.rng()
    bm = bmesh.new()
    nx = 2 if x1 - x0 < 3.5 else 3
    for i in range(nx):
        x = x0 + (x1 - x0) * i / (nx - 1)
        for y in (y0, y1):
            C.cyl_bm(bm, (x, y, 0), (x + rr.uniform(-0.05, 0.05), y + rr.uniform(-0.04, 0.04), z), rr.uniform(0.08, 0.1), 6, caps=False)
    for y in (y0, y1):
        C.cyl_bm(bm, (x0 - 0.25, y, z + 0.07), (x1 + 0.25, y + rr.uniform(-0.05, 0.05), z + 0.07 + rr.uniform(-0.04, 0.04)), 0.09, 6)
    k = int((x1 - x0 + 0.4) / 0.55)
    for i in range(k):
        x = x0 - 0.2 + (x1 - x0 + 0.4) * (i + 0.5) / k
        C.cyl_bm(bm, (x, y0 - 0.3, z + 0.2), (x + rr.uniform(-0.08, 0.08), y1 + 0.3, z + 0.2), 0.05, 5)
    K.part(bm, 'palm_log', name=name + '_frame', uv='beam', axis=(0, 0, 1), grime=0.5)
    bm = bmesh.new()
    nf = int((y1 - y0 + 0.8) / 0.26)
    for i in range(nf):              # fronds laid ACROSS the poles (poles run N-S, fronds E-W), overlapping
        yc = y0 - 0.4 + (y1 - y0 + 0.8) * (i + 0.5) / nf + rr.uniform(-0.08, 0.08)
        a = rr.uniform(-0.2, 0.2)
        L = min(x1 - x0 + 0.8, rr.uniform(2.4, 3.4))
        x = x0 + (x1 - x0) * rr.uniform(0.3, 0.7)
        d = V((math.cos(a), math.sin(a), 0))
        s = V((d.y, -d.x, 0))
        zc = z + 0.27 + 0.03 * (i % 3)
        p0, p1 = V((x, yc, zc)) - d * L / 2, V((x, yc, zc)) + d * L / 2
        wd = rr.uniform(0.28, 0.42)
        vv = []
        for j in range(5):                     # blade, tapering to the tip, drooping at both ends
            t = j / 4
            c = p0.lerp(p1, t) - V((0, 0, 0.12 * (2 * t - 1) ** 2))
            ww = wd * (0.35 + 0.65 * math.sin(math.pi * min(0.999, 0.15 + t * 0.85)))
            vv.append((bm.verts.new(c - s * ww / 2 - V((0, 0, 0.03))), bm.verts.new(c + V((0, 0, 0.015))), bm.verts.new(c + s * ww / 2 - V((0, 0, 0.03)))))
        for j in range(4):
            bm.faces.new((vv[j][0], vv[j + 1][0], vv[j + 1][1], vv[j][1]))
            bm.faces.new((vv[j][1], vv[j + 1][1], vv[j + 1][2], vv[j][2]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'roof_thatch', name=name + '_fronds', uv='beam', axis=(0, 1, 0), grime=0.3, mat_tint=(0.86, 0.78, 0.58), smooth=True)


def agave(c, r=0.6, n=14, name='agave', tint=(0.55, 0.68, 0.6)):
    """Spiky agave / aloe: radial tapered blades (reads as a plant, not a blob)."""
    rr = K.rng()
    c = V(c)
    bm = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * i / n + rr.uniform(-0.15, 0.15)
        up = rr.uniform(0.35, 1.1)
        d = V((math.cos(a), math.sin(a), up)).normalized()
        L = r * rr.uniform(0.8, 1.2)
        s = V((-math.sin(a), math.cos(a), 0)) * 0.05
        tip = c + d * L
        b0, b1 = c - s + V((0, 0, 0.02)), c + s + V((0, 0, 0.02))
        m0, m1 = c + d * L * 0.4 - s * 1.2 + V((0, 0, 0.04)), c + d * L * 0.4 + s * 1.2 + V((0, 0, 0.04))
        vs = [bm.verts.new(p) for p in (b0, b1, m1, tip, m0)]
        bm.faces.new(vs)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'sod', name=name, mat_tint=tint, grime=0, bisect=False, lod='drop')


def planter(c, w=0.9, h=0.55, mid='limewash_worn', tint=None, name='planter', plant=True):
    bm = bmesh.new()
    cx, cy = c[:2]
    KA.ring_bm(bm, [(cx - w / 2, cy - w / 2), (cx + w / 2, cy - w / 2), (cx + w / 2, cy + w / 2), (cx - w / 2, cy + w / 2)],
               [(cx - w / 2 + 0.12, cy - w / 2 + 0.12), (cx + w / 2 - 0.12, cy - w / 2 + 0.12), (cx + w / 2 - 0.12, cy + w / 2 - 0.12),
                (cx - w / 2 + 0.12, cy + w / 2 - 0.12)], 0.0, h)
    C.box_bm(bm, (cx, cy, h - 0.1), (w - 0.2, w - 0.2, 0.02))
    K.part(bm, mid, name=name, mat_tint=tint)
    if plant:
        agave((cx, cy, h - 0.1), w * 0.75, name=name + '_agave')
    C.footprint([(cx - w / 2, cy - w / 2), (cx + w / 2, cy - w / 2), (cx + w / 2, cy + w / 2), (cx - w / 2, cy + w / 2)], 'LOW', 'planter')


def quantize_glb(glb):
    """KHR_mesh_quantization (core three.js GLTFLoader support, no decoder): NORMAL -> BYTE norm (stride 4),
    TANGENT -> BYTE norm, TEXCOORD_1 (AO atlas, 0..1) -> UNSIGNED_SHORT norm. ~40 % smaller geometry."""
    sys.path.insert(0, KIT + '/tools')
    import glb_post as G, struct as S
    js, b = G.read_glb(glb)
    views = js['bufferViews']
    done = {}
    def rd(a):
        bv = views[a['bufferView']]
        n, comps = a['count'], {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 4 * comps)
        return [S.unpack_from('<%df' % comps, b, off + i * stride) for i in range(n)]
    for m in js['meshes']:
        for p in m['primitives']:
            for att, (ct, fmt, scale, pad) in {'NORMAL': (5120, 'b', 127.0, 1), 'TANGENT': (5120, 'b', 127.0, 0),
                                              'TEXCOORD_1': (5123, 'H', 65535.0, 0)}.items():
                ai = p['attributes'].get(att)
                if ai is None or ai in done:
                    continue
                a = js['accessors'][ai]
                if a['componentType'] != 5126:
                    continue
                vals = rd(a)
                out = bytearray()
                for v in vals:
                    if att == 'TEXCOORD_1':
                        q = [max(0, min(65535, int(round(min(1.0, max(0.0, c)) * scale)))) for c in v]
                    else:
                        q = [max(-127, min(127, int(round(c * scale)))) for c in v]
                    out += S.pack('<%d%s' % (len(q), fmt), *q) + (b'\0' * pad)
                while len(b) % 4:
                    b.append(0)
                nv = {'buffer': 0, 'byteOffset': len(b), 'byteLength': len(out), 'target': 34962}
                if pad:
                    nv['byteStride'] = 4
                views.append(nv)
                b += out
                a.update({'bufferView': len(views) - 1, 'componentType': ct, 'normalized': True})
                a.pop('byteOffset', None); a.pop('min', None); a.pop('max', None)
                done[ai] = 1
    if not done:
        return
    for k in ('extensionsUsed', 'extensionsRequired'):
        js.setdefault(k, [])
        if 'KHR_mesh_quantization' not in js[k]:
            js[k].append('KHR_mesh_quantization')
    used = sorted({a['bufferView'] for a in js['accessors'] if 'bufferView' in a} | {i['bufferView'] for i in js.get('images', []) if 'bufferView' in i})
    nb, newidx = bytearray(), {}
    for vi in used:
        v = views[vi]
        while len(nb) % 4:
            nb.append(0)
        chunk = b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        views[vi] = dict(v, byteOffset=len(nb))
        newidx[vi] = len(newidx)
        nb += chunk
    js['bufferViews'] = [views[vi] for vi in used]
    for a in js['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = newidx[a['bufferView']]
    for i in js.get('images', []):
        if 'bufferView' in i:
            i['bufferView'] = newidx[i['bufferView']]
    G.write_glb(glb, js, nb)


def grille_window(fr, color=(0.3, 0.45, 0.4), back_tint=(0.55, 0.52, 0.47), name='gw', nb=4):
    """Cheap high window: painted frame, square iron bars, dim reveal panel behind (no glass, no black card)."""
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    bm = bmesh.new()
    KA.lpoly(bm, fr, fr.outline(6), -fr.depth * 0.6)
    K.part(bm, 'plaster_rough', name=name + '_back', mat_tint=back_tint, grime=0, bisect=False, lod='drop')
    bm = bmesh.new()
    for i in range(1, nb + 1):
        x = -fr.w / 2 + fr.w * i / (nb + 1)
        KA.lbox(bm, fr, x - 0.012, x + 0.012, 0.0, top + fr.rise * 0.6, -0.12, -0.096)
    KA.lbox(bm, fr, -fr.w / 2, fr.w / 2, top * 0.5 - 0.012, top * 0.5 + 0.012, -0.13, -0.106)
    K.part(bm, 'cast_iron', name=name + '_bars', mat_tint=tuple(min(1, c / 0.55) for c in color), grime=0.2, bisect=False)


def flag_balken(anchor_top, w=1.5, h=1.0, name='flag', wave=0.12, seed=0):
    """Static stand-in for the game's animated flag (spec 2.4/1.x: field-grey banner with a black-and-white
    Balkenkreuz; never a swastika). Separate node 'flag' so the game can hide it when it spawns the cloth."""
    top = V(anchor_top)
    nx, ny = 8, 5
    def P(u, v):
        x = u * w
        return top + V((0.06 + x, wave * math.sin(u * 5.0 + seed) * u, -v * h - 0.05 * u * u))
    bm = bmesh.new()
    vv = [[bm.verts.new(P(i / nx, j / ny)) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vv[i][j], vv[i][j + 1], vv[i + 1][j + 1], vv[i + 1][j]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    K.part(bm, 'canvas', name=name + '_cloth', node=name, mat_tint=(0.62, 0.64, 0.58), smooth=True, grime=0.2, bisect=False)
    def cross(bm, s, off):
        cu, cv = 0.5, 0.5
        for (u0, u1, v0, v1) in ((cu - s * 0.12, cu + s * 0.12, cv - s * 0.62, cv + s * 0.62), (cu - s * 0.42, cu + s * 0.42, cv - s * 0.18, cv + s * 0.18)):
            for side in (-1, 1):
                q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]
                d = V((0, side * (0.008 + off), 0))
                f = bm.faces.new([bm.verts.new(p + d) for p in (q if side > 0 else q[::-1])])
    bw_, bb_ = bmesh.new(), bmesh.new()
    cross(bw_, 1.0, 0.0)
    cross(bb_, 0.72, 0.002)
    K.part(bw_, 'canvas', name=name + '_x_w', node=name, mat_tint=(0.95, 0.95, 0.92), grime=0, bisect=False)
    K.part(bb_, 'canvas', name=name + '_x_b', node=name, mat_tint=(0.08, 0.08, 0.08), grime=0, bisect=False)


def halyard(base, top, name='halyard'):
    base, top = V(base), V(top)
    bm = bmesh.new()
    C.cyl_bm(bm, base + V((0.06, 0, 1.2)), top + V((0.06, 0, -0.1)), 0.006, 3, caps=False)
    C.cyl_bm(bm, base + V((0.06, 0, 1.2)), base + V((0.2, 0, 1.0)), 0.006, 3, caps=False)
    C.box_bm(bm, tuple(base + V((0.06, 0, 1.15))), (0.03, 0.08, 0.12))
    K.part(bm, 'hessian', name=name, grime=0, bisect=False, mat_tint=(0.85, 0.8, 0.7))


def corrugated_bm(bm, o, u, v, w, l, pitch=0.15, amp=0.022, seg=3, bend=0.0, twist=0.0, under=True, nrows=1):
    """Corrugated sheet as real geometry: sinusoidal profile across u (visible at eaves/edges), running along v.
    bend lifts the far end (curl) for blown-off sheets. Flat underside quad (cheap) when under=True."""
    o, u, v = V(o), V(u).normalized(), V(v).normalized()
    n = u.cross(v).normalized()
    if n.z < 0:
        n = -n
    nu = max(2, int(round(w / pitch * seg)))
    rows = []
    for j in range(nrows + 1):
        t = j / nrows
        row = []
        for i in range(nu + 1):
            x = w * i / nu
            h = amp * math.sin(2 * math.pi * x / pitch)
            p = o + u * x + v * (l * t) + n * (h + bend * t * t + twist * (x / w - 0.5) * t)
            row.append(bm.verts.new(p))
        rows.append(row)
    for j in range(nrows):
        for i in range(nu):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    if under:
        q = [o - n * (amp + 0.003), o + u * w - n * (amp + 0.003), o + u * w + v * l - n * (amp + 0.003) + n * bend, o + v * l - n * (amp + 0.003) + n * bend]
        f = bm.faces.new([bm.verts.new(p) for p in q])
        f.normal_update()
        if f.normal.dot(n) > 0:
            f.normal_flip()


def burst_drum_bm(bm, c, r_=0.29, h=0.88, seed=0, lying=False, axis=(1, 0, 0)):
    """200 l drum after a fuel fire/explosion: bulged, top torn open with steel petals peeled outward, one side split."""
    rr = K.rng()
    c = V(c)
    if lying:
        ax = V(axis).normalized()
        base, up = c + V((0, 0, r_)) - ax * h / 2, ax
    else:
        base, up = c, V((0, 0, 1))
    s = up.orthogonal().normalized()
    t = up.cross(s)
    segs, hb = 12, h * rr.uniform(0.55, 0.75)
    ring = lambda z, rad: [base + up * z + (s * math.cos(2 * math.pi * k / segs) + t * math.sin(2 * math.pi * k / segs)) * rad for k in range(segs)]
    rings = [ring(0.0, r_), ring(hb * 0.5, r_ * 1.06), ring(hb, r_ * 1.02)]
    C.loft_bm(bm, rings, close_start=True, close_end=False)
    top = rings[-1]
    for k in range(segs):          # petals: triangular strips bent outward/down
        a, b = top[k], top[(k + 1) % segs]
        m = (a + b) / 2
        out = (m - (base + up * hb)).normalized()
        L = rr.uniform(0.15, 0.45)
        tip = m + up * L * rr.uniform(0.1, 0.6) + out * L * rr.uniform(0.4, 1.0)
        vs = [bm.verts.new(a), bm.verts.new(b), bm.verts.new(tip)]
        bm.faces.new(vs)
        bm.faces.new([bm.verts.new(a + out * 0.004), bm.verts.new(tip + out * 0.004), bm.verts.new(b + out * 0.004)])   # back side (materials are single-sided)


def crater(c, r_=2.4, depth_col=(0.3, 0.28, 0.26), seed=0, name='crater'):
    """Blast crater on a flat site: raised ejecta rim of sand (the game ground cannot be cut) + dark scorched bowl
    decal + radial scorch streaks."""
    rr = K.rng()
    c = V(c)
    bm = bmesh.new()
    segs = 20
    rings = []
    for rad, z in ((r_ * 0.55, 0.02), (r_ * 0.8, 0.22), (r_ * 0.95, 0.28), (r_ * 1.25, 0.1), (r_ * 1.6, 0.0)):
        rings.append([c + V((math.cos(2 * math.pi * k / segs) * rad * (1 + 0.12 * math.sin(k * 1.7 + seed)),
                             math.sin(2 * math.pi * k / segs) * rad * (1 + 0.12 * math.sin(k * 1.7 + seed)), z * (0.8 + 0.4 * rr.random()))) for k in range(segs)])
    C.loft_bm(bm, rings, close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'sand', name=name + '_rim', smooth=True, grime=0.3, mat_tint=(0.8, 0.74, 0.66), lod='keep')
    K.decal('soot', tuple(c + V((0, 0, 0.03))), (0, 0, 1), r_ * 1.5, r_ * 1.5, up=(0, 1, 0), alpha=0.95)
    for k in range(9):
        a = 2 * math.pi * k / 9 + rr.uniform(-0.2, 0.2)
        d = V((math.cos(a), math.sin(a), 0))
        L = rr.uniform(2.5, 4.5)
        K.decal('soot', tuple(c + d * (r_ * 0.8 + L / 2) + V((0, 0, 0.04 + 0.001 * k))), (0, 0, 1), rr.uniform(0.9, 1.5), L, up=tuple(d), alpha=0.7)


def angle_bm(bm, p0, p1, w=0.18, t=0.022, out=None, tile=2.2):
    """Angle-iron (L profile) member p0->p1 with its own UVs (u along the member, no smearing on diagonals).
    out = direction the two flanges open toward (default: away from the Z axis through the origin)."""
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0)
    L = d.length
    if L < 1e-4:
        return
    d /= L
    mid = (p0 + p1) / 2
    o = V(out) if out is not None else V((mid.x, mid.y, 0))
    if o.length < 1e-3:
        o = d.orthogonal()
    a = (o - d * o.dot(d)).normalized()
    b = d.cross(a).normalized()
    # corner of the L at the member line; flange 1 along +a, flange 2 along +b (outward), thickness t
    prof = [V((0, 0, 0)), a * w, a * w + b * t, b * t + a * t, b * w, b * w - a * 0 + a * 0 + (a * t) * 0 + b * 0]
    prof = [V((0, 0, 0)), a * w, a * w + b * t, a * t + b * t, a * t + b * w, b * w]
    prof = [p - (a + b) * (w * 0.25) for p in prof]
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    r0 = [bm.verts.new(p0 + p) for p in prof]
    r1 = [bm.verts.new(p1 + p) for p in prof]
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
        side = (prof[j] - prof[i])
        for l in f.loops:
            q = l.vert.co
            l[uvl].uv = ((q - p0).dot(d) / tile, (q - p0).dot(side.normalized() if side.length > 1e-6 else a) / tile + i * 0.37)
    for ring, rev in ((r0, True), (r1, False)):
        f = bm.faces.new(ring[::-1] if rev else ring)
        for l in f.loops:
            l[uvl].uv = ((l.vert.co - p0).dot(a) / tile, (l.vert.co - p0).dot(b) / tile)


def gusset_bm(bm, c, n, s=0.34, t=0.012):
    """Square gusset plate (with four bolt heads) centred at c, facing n."""
    n = V(n).normalized()
    u = n.cross(V((0, 0, 1)))
    if u.length < 1e-3:
        u = V((1, 0, 0))
    u.normalize()
    v = n.cross(u)
    c = V(c) + n * 0.03
    q = [c - u * s / 2 - v * s / 2, c + u * s / 2 - v * s / 2, c + u * s / 2 + v * s / 2, c - u * s / 2 + v * s / 2]
    C.hexa_bm(bm, q + [p + n * t for p in q])
    for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        b = c + n * t + u * du * s * 0.3 + v * dv * s * 0.3
        C.box_bm(bm, tuple(b + n * 0.012), (0.035, 0.035, 0.03))


def barbed_bm(bm, a, b, sag=0.04, r=0.006, spacing=0.2, n=6):
    """Barbed-wire strand: twisted line (thin tube) + 4-point barbs every `spacing` metres (two crossed spikes)."""
    a, b = V(a), V(b)
    pts = [a.lerp(b, i / n) - V((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
    for p, q in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, p, q, r, 3, caps=False)
    L = sum((q - p).length for p, q in zip(pts[:-1], pts[1:]))
    k = int(L / spacing)
    for j in range(1, k):
        t = j / k
        f = t * n
        i = min(n - 1, int(f))
        c = pts[i].lerp(pts[i + 1], f - i)
        d = (pts[i + 1] - pts[i]).normalized()
        s = d.orthogonal().normalized()
        u = d.cross(s)
        for ax in (s + u, s - u):
            ax = ax.normalized() * 0.03
            e = d * 0.004
            bm.faces.new([bm.verts.new(c - ax - e), bm.verts.new(c + ax - e), bm.verts.new(c + ax + e), bm.verts.new(c - ax + e)])
            bm.faces.new([bm.verts.new(c - ax + e), bm.verts.new(c + ax + e), bm.verts.new(c + ax - e), bm.verts.new(c - ax - e)])


def hang_wire_bm(bm, a, ground, slack=0.4, r=0.006, n=6):
    """Broken wire strand hanging from a picket down to the ground (catenary-ish droop)."""
    a, g = V(a), V(ground)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(g, t)
        p.z = a.z * (1 - t) ** 1.8 + g.z - slack * math.sin(math.pi * t) * 0.3
        pts.append(V((p.x, p.y, max(0.03, p.z))))
    for p, q in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, p, q, r, 3, caps=False)

from dz2 import *  # noqa: rework-2 overrides (rebinds helpers in this module)
