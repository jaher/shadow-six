"""veh.py - SHADOW SIX vehicle layer on top of the building kit (art/kit/blender/kit.py).
Blender convention (kit): Z up, metres, ground z=0, vehicle FRONT faces Blender -Y (= glTF +Z = game south at rot 0),
X = vehicle right... (Blender +X = game east). Pivot = ground centre of the wheelbase/bbox.
Variants: paint 'grey' (RAL 7021 Dunkelgrau), 'dak' (RAL 8000 Gelbbraun, DAK 1941-42), 'winter' (worn whitewash over grey),
'od' (US olive drab), 'black' (civilian gloss black), 'burnt' (destroyed). Weathering = vertex colour (COLOR_0):
mud splash low, dust on top faces, snow (winter), soot (burnt) - replaces the kit's building grime (no moss/damp).
"""
import sys, os, math, json, random
SCR = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(SCR, '..', '..', '..', 'art', 'kit'))
OUT_ROOT = os.environ.get('VEH_OUT') or os.path.join(SCR, '..', 'out')
sys.path.insert(0, os.path.join(KIT, 'blender'))
import bpy, bmesh
from mathutils import Vector as V, Matrix, noise
import kit as K
import kit_core as C
import kit_export as E

# ------------------------------------------------------------------ paints (sRGB 0-255, period colours, as seen weathered)
PAINT = {
    'grey':   (38, 41, 42),     # RAL 7021 Dunkelgrau (1937-43; ref #2F3234), near-black grey; texture mottling + dust lift it slightly
    'dak':    (126, 106, 66),   # RAL 8000 Gelbbraun (DAK 1941-42; ref #826C34 olive/ochre-brown); rw2: saturation -15% (read as mustard)
    'winter': (38, 41, 42),     # base grey under the whitewash
    'od':     (64, 66, 44),     # US Olive Drab No.9 (Willys)
    'black':  (24, 24, 26),     # civilian gloss black (Citroen)
    'burnt':  (60, 50, 44),
}
DIRT = {'grey': (0.42, 0.36, 0.28), 'dak': (0.78, 0.66, 0.48), 'winter': (0.40, 0.36, 0.30),
        'od': (0.42, 0.36, 0.28), 'black': (0.45, 0.40, 0.33), 'burnt': (0.10, 0.09, 0.08)}
VAR = None          # current variant name
THEATER = {'grey': 'temperate', 'dak': 'desert', 'winter': 'snow', 'od': 'temperate', 'black': 'temperate', 'burnt': 'temperate'}


def setup(name, variant, seed=7):
    """Start an asset for one paint variant; returns the kit Asset."""
    global VAR, VM
    VAR = variant
    base = variant.split('_')[0]
    a = K.begin('%s_%s' % (name, variant), seed=seed, theater=THEATER.get(base, 'temperate'))
    a.grime_heights = [0.25, 0.6]
    VM = {'sockets': [], 'emitters': [], 'contacts': [], 'moving': [], 'lights': [], 'toggles': {}, 'notes': []}
    a.meta['vehicle'] = VM
    C.grime_color = grime_vehicle          # part() looks this up at call time
    C._MCACHE.clear()
    return a


def paint_base():
    return VAR.split('_')[0]


def _n(p, s):
    return 0.5 + 0.5 * noise.noise(V((p.x * s + 3.1, p.y * s - 5.7, p.z * s + 1.3)))


# absolute weathering colours as vertex-colour multipliers of the pale library textures (sRGB / texture mean ~0.8)
DUSTC = {'grey': (0.74, 0.68, 0.58), 'dak': (0.78, 0.67, 0.50), 'winter': (0.70, 0.66, 0.60), 'od': (0.74, 0.68, 0.56),
         'black': (0.66, 0.61, 0.52), 'burnt': (0.50, 0.48, 0.45)}
MUDC = {'grey': (0.36, 0.31, 0.24), 'dak': (0.66, 0.57, 0.45), 'winter': (0.62, 0.61, 0.60), 'od': (0.36, 0.31, 0.24),
        'black': (0.40, 0.35, 0.28), 'burnt': (0.10, 0.09, 0.08)}


def grime_vehicle(p, n, amt=1.0, tint=(1, 1, 1)):
    """Vehicle weathering in vertex colour (COLOR_0 multiplies the pale texture): base = part colour (paint parts carry
    the paint colour here), mud/dust splash rising from the wheels, dust (brighter than dark paint) or snow settling on
    up-facing faces, soot + ash on wrecks, large-scale tonal variation."""
    c = V(tint)
    if amt <= 0:
        return c
    base = paint_base()
    h = max(0.0, p.z)
    nz = _n(p, 2.3)
    mud = max(0.0, 1 - h / 0.8) ** 1.4 * (0.3 + 0.9 * nz) * 0.8 * amt
    if n.z < -0.3:
        mud += 0.35 * amt                         # undersides caked
    c = c.lerp(V(MUDC.get(base, MUDC['grey'])), min(mud, 0.85))
    top = max(0.0, n.z - 0.3) / 0.7
    dk = {'dak': 0.15, 'winter': 0.0, 'burnt': 0.0}.get(base, 0.16)      # rw2: DAK dust 0.2 -> 0.15 (read as sand-yellow)
    if dk:
        c = c.lerp(V(DUSTC.get(base, DUSTC['grey'])), min(dk, top * dk * amt * (0.35 + 0.9 * _n(p, 3.2))))
        # vertical dust streaks on the sides
        c = c.lerp(V(DUSTC.get(base, DUSTC['grey'])), max(0.0, _n(V((p.x * 3, p.y * 9, 0)), 1.0) - 0.62) * 0.5 * (1 - abs(n.z)) * amt)
    if base == 'winter':
        c = c.lerp(V((1.0, 1.0, 1.0)), min(0.85, top ** 1.3 * 0.9 * amt * (0.4 + _n(p, 3.0))))
    elif base == 'burnt' and CUR_KIND in WRECK_KINDS:
        c = wreck_color(p, n, h, top, 1.0, V(tint))          # full burn pattern regardless of the material grime amount
    elif base == 'burnt':
        k = min(1.0, (0.3 + 0.5 * _n(p, 1.2) + 0.35 * max(0.0, h - 0.6)) * amt)
        c = c.lerp(V((0.03, 0.028, 0.026)), k * 0.45)
    c *= 0.9 + 0.16 * _n(p, 0.8)
    return V((min(c.x, 1.0), min(c.y, 1.0), min(c.z, 1.0)))


CUR_KIND = None                                      # semantic kind of the part being built (set by vp)
WRECK_KINDS = ('paint', 'paint_under', 'rust')
WRECK_MEAN = (0.6353, 0.59, 0.5492)                  # vehicles/cars_moto/lib/veh_wreck_diff mean (make_cm_tex.py)


def _sm(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def wreck_color(p, n, h, top, amt, tint):
    """Fire-gutted steel as a continuous WORLD-SPACE field (no patches cut at face edges): rust-brown spreading over
    whole panels, heat-bleached primer (pale pink-grey) where the fire was hottest, soot-black upper surfaces and
    vent edges, soft grey-white ash settled on up-facing surfaces, mud/ash dirt low down."""
    rust_d, rust_o = V((0.17, 0.085, 0.045)), V((0.36, 0.17, 0.075))
    primer, soot, ash = V((0.50, 0.43, 0.39)), V((0.035, 0.032, 0.030)), V((0.52, 0.51, 0.49))
    n1, n2, n3 = _n(p, 0.55), _n(p + V((4.1, 1.7, 0.3)), 1.3), _n(p + V((-2.3, 5.1, 2.2)), 2.1)
    c = rust_d.lerp(rust_o, _sm(0.35, 0.8, n1))                                  # panel-scale rust (dark -> orange-brown)
    side = 1.0 - abs(n.z)
    c = c.lerp(primer, 0.7 * _sm(0.58, 0.8, n2) * side * _sm(0.35, 0.8, h))     # heat-bleached primer blooms (flanks)
    if CUR_KIND == 'rust':      # bare wheel rims: dull dark oxide (brown-grey), orange rust only in patches
        c = V((0.15, 0.125, 0.105)).lerp(V((0.30, 0.15, 0.07)), 0.75 * _sm(0.6, 0.85, _n(p + V((1.3, 2.9, 0.4)), 7.0)))
    # soot: everything is smoked; upper surfaces and the tops of the flanks go black (fire vents upward)
    sootk = 0.34 + 0.62 * top + 0.35 * _sm(0.55, 1.2, h) * side + 0.25 * (n3 - 0.5) + 0.2 * max(0.0, -n.z)
    if CUR_KIND == 'paint_under':
        sootk += 0.2
    if CUR_KIND == 'rust':
        sootk *= 0.8
    c = c.lerp(soot, max(0.0, min(0.94, sootk * amt)))
    c = c.lerp(ash, min(0.4, top * _sm(0.58, 0.72, _n(p + V((7.7, 0.0, 1.1)), 1.4)) * 0.5 * amt))   # settled ash drifts
    c = c.lerp(V((0.16, 0.14, 0.12)), min(0.5, max(0.0, 1 - h / 0.4) * 0.5))                      # ground dirt
    return V((min(1.0, c.x / WRECK_MEAN[0] * tint[0]), min(1.0, c.y / WRECK_MEAN[1] * tint[1]),
              min(1.0, c.z / WRECK_MEAN[2] * tint[2])))


# ------------------------------------------------------------------ materials
def flat(name, rgb, rough=0.8, metal=0.0):
    """Untextured PBR material (kept as exported by glb_post: not a 'kit:' material)."""
    key = 'veh:' + name
    m = bpy.data.materials.get(key)
    if m:
        return m
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*[(c / 255) ** 2.2 for c in rgb], 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    return m


def _tint_for(mid, rgb):
    mean = C.MATS[mid]['mean']
    return tuple(min(1.0, (rgb[i] / 255.0) / mean[i]) for i in range(3))


def M(kind):
    """(material id, tint) for a semantic surface in the current variant -> use with part(... mid, mat_tint)."""
    base = paint_base()
    if kind == 'paint':
        if base == 'winter':
            return 'limewash_worn', None
        return 'veh_paint', None                   # burnt: textures swapped to veh_wreck in _post_cm (same UV tile)
    if kind in ('paint_under', 'rust'):            # chassis / underside / inner faces: base paint, never whitewashed
        return 'veh_paint', None
    if kind == 'canvas' and base == 'winter':
        return 'limewash_worn', (0.93, 0.93, 0.90)             # whitewashed / snow-caked tarp
    if kind == 'wood' and base == 'burnt':
        return 'timber_creosote', (0.40, 0.36, 0.33)           # charred planks
    if kind == 'canvas':
        return 'canvas', {'grey': (0.62, 0.66, 0.6), 'dak': (1.0, 0.92, 0.8), 'winter': (0.75, 0.76, 0.72),
                          'od': (0.62, 0.66, 0.5), 'black': (0.3, 0.3, 0.3), 'burnt': (0.2, 0.18, 0.16)}[base]
    if kind == 'metal':
        return 'cast_iron', None
    if kind == 'wood':
        return 'timber_grey', (0.8, 0.75, 0.7)
    if kind == 'seat':
        if base == 'od':                                       # rw2: US OD canvas-covered cushions (not brown leather)
            return 'canvas', (0.47, 0.49, 0.33)
        return 'canvas', (0.45, 0.4, 0.33)
    raise KeyError(kind)


FLAT = {   # semantic flat materials
    'rubber': ((34, 33, 32), 0.92, 0.0), 'glass': ((20, 24, 26), 0.05, 0.0), 'lens': ((150, 150, 142), 0.15, 0.0),
    'chrome': ((170, 170, 165), 0.25, 1.0), 'red': ((110, 12, 10), 0.3, 0.0), 'black': ((14, 14, 14), 0.7, 0.0),
    'leather': ((52, 36, 24), 0.6, 0.0), 'brass': ((150, 118, 60), 0.35, 1.0), 'gunmetal': ((38, 38, 40), 0.45, 0.8),
    'soot': ((14, 12, 11), 0.95, 0.0), 'white': ((190, 188, 180), 0.6, 0.0), 'amber': ((140, 90, 20), 0.2, 0.0),
    'blue': ((30, 40, 60), 0.2, 0.0),
    'alu': ((150, 150, 144), 0.42, 0.6),                                                # cast aluminium (heads, covers)
    'glass_cab': ((18, 22, 24), 0.05, 0.0), 'tyre': ((255, 255, 255), 0.9, 0.0),   # textures/alpha set in _post_cm
    'tar': ((16, 14, 12), 0.3, 0.0), 'tar_halo': ((30, 27, 24), 0.95, 0.0),
}
GLASS_ALPHA = {'glass': 0.35, 'glass_cab': 0.55}      # open-car screens / closed cab windows (interior reads through)


def vp(bm, kind, name=None, node='main', pivot=None, uv='aligned', grime=None, smooth=False, lod=None, axis=None,
       rot90=False, uv_scale=None, jitter=0.04, recalc=True):
    """Make a part from bmesh with a semantic surface kind (see M() / FLAT). pivot -> node origin for animation.
    Burnt variant: glass is gone (returns None), upholstery burns down to its spring frame, rims are bare rust."""
    global CUR_KIND
    base = paint_base()
    if base == 'burnt' and kind in GLASS_ALPHA:
        bm.free()
        return None
    if base == 'burnt' and kind in ('seat', 'leather'):
        return spring_frame(bm, name, node, pivot)
    CUR_KIND = kind
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc and len(bm.faces) > 1:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if smooth:
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(35):
                e.smooth = False
    if kind in FLAT:
        rgb, r, m = FLAT[kind]
        if base == 'burnt' and kind in ('rubber', 'glass', 'lens', 'chrome', 'leather', 'red', 'amber', 'blue', 'white', 'alu', 'gunmetal'):
            rgb, r, m = FLAT['soot']
        ob = C.part(bm, 'paint_metal', name, uv=uv, node=node, grime=0.6 if grime is None else grime, smooth=smooth,
                    lod=lod, jitter=0.02)
        ob.data.materials.clear()
        ob.data.materials.append(flat(kind if base != 'burnt' or kind not in ('rubber', 'glass', 'lens') else 'soot', rgb, r, m))
    else:
        mid, tint = M(kind)
        if uv_scale is None:
            uv_scale = 1.0
        vc = None
        if kind in ('paint', 'paint_under') and base not in ('winter', 'burnt'):
            k = 1.0 if kind == 'paint' else 0.72
            vc = tuple(min(1.0, PAINT[base][i] * k / 255.0 / C.MATS['veh_paint']['mean'][i]) for i in range(3))
        elif kind == 'paint_under' and base == 'winter':
            vc = tuple(min(1.0, PAINT['grey'][i] * 0.72 / 255.0 / C.MATS['limewash_worn']['mean'][i]) for i in range(3))
        elif kind == 'paint_under' and base == 'burnt':
            vc = (0.75, 0.75, 0.75)
        ob = C.part(bm, mid, name, uv=uv, node=node, grime=grime, smooth=smooth, lod=lod, mat_tint=tint, axis=axis,
                    rot90=rot90, uv_scale=uv_scale, jitter=jitter, tint=vc)
    if kind == 'paint' and base != 'burnt':
        edge_wear(ob, base)
    if pivot is not None:
        ob['kit_pivot'] = list(pivot)
    return ob


# paint worn through on edges (sRGB): Dunkelgrau -> lighter steel, DAK -> the Dunkelgrau it was sprayed over,
# OD -> red-oxide primer, black -> scuffed grey, winter -> the grey paint under the whitewash
WEAR = {'grey': ((74, 74, 70), 0.55), 'dak': ((52, 54, 54), 0.6), 'od': ((78, 60, 44), 0.5), 'black': ((78, 76, 72), 0.5),
        'winter': ((44, 47, 48), 0.85)}


def edge_wear(ob, base):
    """rw2: paint chips only where paint really wears - convex edges (small bevel/rounding faces next to an edge
    sharper than ~25 deg), sills and steps - broken up by noise; big flat panel faces are never touched (so no
    polka dots and no vertex-colour smears across a bonnet)."""
    if base not in WEAR:
        return
    rgb, kmax = WEAR[base]
    mean = C.MATS['limewash_worn' if base == 'winter' else 'veh_paint']['mean']
    tgt = V([min(1.0, rgb[i] / 255.0 / mean[i]) for i in range(3)])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    col = bm.loops.layers.color.get('Col')
    if col is None:
        bm.free()
        return
    cv = {}
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a = e.calc_face_angle_signed(0.0)
            if a > math.radians(25):
                k = _sm(math.radians(25), math.radians(70), a)
                for v in e.verts:
                    cv[v.index] = max(cv.get(v.index, 0.0), k)
    for f in bm.faces:
        small = f.calc_area() < 0.006 or min(e.calc_length() for e in f.edges) < 0.035
        step = f.normal.z > 0.8 and f.calc_center_median().z < 0.75
        if not (small or step):
            continue
        for l in f.loops:
            p = l.vert.co
            w = cv.get(l.vert.index, 0.0) if small else 0.0
            if step:
                w = max(w, 0.6 * _n(p, 5.0))
            w *= _sm(0.42, 0.68, _n(p + V((9.1, 3.3, 7.7)), 7.0))          # broken, patchy chips along the edge
            if w > 0.01:
                c = V(l[col][:3]).lerp(tgt, min(kmax, w * kmax * 1.4))
                l[col] = (c.x, c.y, c.z, l[col][3])
    bm.to_mesh(ob.data)
    bm.free()


def spring_frame(bm, name, node, pivot):
    """Burnt upholstery: the padding is gone, leaving the seat's steel frame and zig-zag springs (in the seat's plane,
    at the middle of its thinnest axis). Thin leather parts (straps, lacing) simply burn away (None)."""
    vs = [v.co.copy() for v in bm.verts]
    bm.free()
    if not vs:
        return None
    mn = V([min(v[i] for v in vs) for i in range(3)])
    mx = V([max(v[i] for v in vs) for i in range(3)])
    ext = mx - mn
    ax = sorted(range(3), key=lambda i: ext[i])
    if ext[ax[1]] < 0.12 or ext[ax[2]] < 0.16:
        return None
    t, a, b = ax                                  # thin, short, long axes
    mid = (mn + mx) / 2

    def pt(ua, ub, sag=0.0):
        q = V(mid)
        q[a], q[b] = ua, ub
        q[t] = mid[t] - sag * (1 if t == 2 else 0)
        return q
    out = bmesh.new()
    ia, ib = 0.012, 0.012
    cs = [pt(mn[a] + ia, mn[b] + ib), pt(mx[a] - ia, mn[b] + ib), pt(mx[a] - ia, mx[b] - ib), pt(mn[a] + ia, mx[b] - ib)]
    for k in range(4):
        C.beam_bm(out, cs[k], cs[(k + 1) % 4], 0.014, 0.014)
    ns = max(2, int(ext[b] / 0.13))
    for i in range(ns):
        ub = mn[b] + ext[b] * (i + 0.5) / ns
        segs = 3
        pts = [pt(mn[a] + ia + (ext[a] - 2 * ia) * j / segs, ub + (0.018 if j % 2 else -0.018), 0.025 * math.sin(math.pi * j / segs))
               for j in range(segs + 1)]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            C.beam_bm(out, p0, p1, 0.006, 0.006)
    return vp(out, 'rust', (name or 'seat') + '_springs', node=node, pivot=pivot, lod='drop2')


def P(kind, builder, *a, **kw):
    pkw = {k: kw.pop(k) for k in list(kw) if k in ('name', 'node', 'pivot', 'uv', 'grime', 'smooth', 'lod', 'axis', 'rot90', 'uv_scale', 'recalc')}
    bm = bmesh.new()
    builder(bm, *a, **kw)
    return vp(bm, kind, **pkw)


box = C.box_bm
beam = C.beam_bm
cyl = C.cyl_bm
loft = C.loft_bm


def bevel_box(bm, center, size, r=0.02, segs=1, rot_z=0.0):
    """Box with bevelled edges (reads as pressed sheet metal instead of a hard block)."""
    tmp = bmesh.new()
    C.box_bm(tmp, center, size, rot_z)
    bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=r, segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
    _merge(bm, tmp)


def _merge(bm, tmp):
    me = bpy.data.meshes.new('_tmp')
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def xform(bm, verts, mat):
    for v in verts:
        v.co = mat @ v.co


def superellipse(cx, cz, w, h, n=4.0, segs=16, y=0.0, z0=None, flat_bottom=True):
    """Ring of points (x, y, z) for a rounded-rectangle section (half width w/2, height h, centre cx, bottom cz).
    Points CCW seen from -Y (front)."""
    pts = []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        ct, st = math.cos(t), math.sin(t)
        x = (abs(ct) ** (2 / n)) * (1 if ct >= 0 else -1) * w / 2
        z = (abs(st) ** (2 / n)) * (1 if st >= 0 else -1) * h / 2
        if flat_bottom and z < 0:
            z = max(z, -h / 2 * 0.98)
        pts.append(V((cx + x, y, cz + h / 2 + z)))
    return pts


def section(y, half_w_bot, half_w_top, z_bot, z_mid, z_top, crown=0.04, tumble=0.0, segs_top=4):
    """Car-body cross-section at station y: vertical-ish flanks, tumblehome above z_mid, crowned top.
    Returns ring (closed, CCW from front): bottom-left, left flank, top arc, right flank, bottom-right."""
    L = []
    L.append(V((-half_w_bot, y, z_bot)))
    L.append(V((-half_w_bot - tumble * 0.3, y, z_mid)))
    for i in range(segs_top + 1):
        t = i / segs_top
        x = -half_w_top + 2 * half_w_top * t
        z = z_top - crown * (2 * t - 1) ** 2
        L.append(V((x, y, z)))
    L.append(V((half_w_bot + tumble * 0.3, y, z_mid)))
    L.append(V((half_w_bot, y, z_bot)))
    return L


def mirror_x(bm, verts=None):
    """Duplicate + mirror geometry across X=0 (for symmetric parts built on +X)."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    r = bmesh.ops.duplicate(bm, geom=geom)
    vs = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in vs:
        v.co.x = -v.co.x
    fs = [e for e in r['geom'] if isinstance(e, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=fs)


# ------------------------------------------------------------------ metadata (stored in GAME coords: x east, y up, z south)
def G(p):
    return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]


def Gd(d):
    d = V(d).normalized()
    return [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]


def socket(name, pos, heading=(0, -1, 0), node=None, **extra):
    """Crew/passenger/weapon mount point (pos = hip/seat point or muzzle)."""
    d = {'name': name, 'pos': G(pos), 'dir': Gd(heading), 'node': node}
    d.update(extra)
    VM['sockets'].append(d)
    VM.setdefault('_blender', []).append((name, tuple(pos), node))


def emitter(kind, pos, direction=(0, 1, 0), node=None, **extra):
    """VFX emitter: exhaust, dust, mud, snow_spray, fire, smoke, fuel_leak..."""
    d = {'kind': kind, 'pos': G(pos), 'dir': Gd(direction), 'node': node}
    d.update(extra)
    VM['emitters'].append(d)


def light(name, pos, direction=(0, -1, 0), blackout=True, kind='headlight', node=None):
    VM['lights'].append({'name': name, 'kind': kind, 'pos': G(pos), 'dir': Gd(direction), 'blackout': blackout, 'node': node})


def moving(node, kind, pivot, axis=(1, 0, 0), limits=None, parent=None, **extra):
    """Animated node: kind wheel|steer|door|hatch|gun_yaw|gun_pitch|fork|toggle|tailgate. axis in Blender coords."""
    d = {'node': node, 'kind': kind, 'pivot': G(pivot), 'axis': Gd(axis), 'parent': parent}
    if limits:
        d['limits_deg'] = [round(limits[0], 1), round(limits[1], 1)]
    d.update(extra)
    VM['moving'].append(d)


def contact(name, pos, node=None, width=0.2):
    """Wheel/track ground contact (terrain trail stamper) - pos on the ground under the tyre."""
    VM['contacts'].append({'name': name, 'pos': G(pos), 'node': node, 'width': round(width, 3)})


# ------------------------------------------------------------------ wheels
def tyre_bm(bm, c, r, w, rim_r, segs=48, lug=0.012, sw_bulge=0.08, chevron=True, tread='xc'):
    """Tyre around axis X at centre c, with a UV tread strip (veh_tyre texture: u around, v across the profile;
    tread 'xc' = German cross-country bars, 'ndt' = US non-directional tread, None = no UVs).
    Geometric lugs: the two crown rings carry square-ish lug blocks (pattern high-high-low, staggered half a pitch
    between the shoulders) so the silhouette shows real tread, not a smooth disc."""
    c = V(c)
    segs = max(12, 3 * (segs // 3))
    nlug = segs // 3
    prof = [(rim_r, -0.40), (rim_r + (r - rim_r) * 0.55, -0.50 - sw_bulge), (r - (r - rim_r) * 0.12, -0.47),
            (r, -0.33), (r, 0.33), (r - (r - rim_r) * 0.12, 0.47), (rim_r + (r - rim_r) * 0.55, 0.50 + sw_bulge),
            (rim_r, 0.40)]
    pv = [0.0, 0.12, 0.2, 0.3, 0.7, 0.8, 0.88, 1.0]          # profile coordinate (matches the texture layout)
    rings = []
    for k, (rr, xa) in enumerate(prof):
        ring = []
        for i in range(segs + 1):                          # seam vertex duplicated for the wrapping UV
            ph = 1.5 if (chevron and k >= 4) else 0.0
            t = 2 * math.pi * (i + ph) / segs
            rad = rr
            if lug and k in (3, 4):
                rad = rr - (lug if (i % 3 == 2) else 0.0)
            elif lug and k in (2, 5):
                rad = rr - lug * (0.8 if (i % 3 == 2) else 0.35)
            ring.append(c + V((xa * w, rad * math.cos(t), rad * math.sin(t))))
        rings.append(ring)
    vr = [[bm.verts.new(p) for p in r_] for r_ in rings]
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    reps = nlug / 4.0                                        # texture tile = 4 lugs
    v0 = 0.5 if tread == 'ndt' else 0.0
    for k, (a, b) in enumerate(zip(vr[:-1], vr[1:])):
        for i in range(segs):
            f = bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
            if tread:
                for l, (ii, kk) in zip(f.loops, ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k))):
                    l[lay].uv = (reps * (ii + (1.5 if (chevron and kk >= 4) else 0.0)) / segs, v0 + 0.5 * pv[kk])
    return reps


def rim_bm(bm, c, rim_r, w, side=1, style='disc', segs=20, hub=0.35, nuts=5):
    """Pressed-steel disc wheel (dish + hub cap + wheel nuts) facing outward (side=+1 -> +X)."""
    c = V(c)
    s = side
    prof = [(rim_r * 1.02, -0.42), (rim_r * 1.02, 0.42), (rim_r * 0.93, 0.36), (rim_r * 0.80, 0.30), (rim_r * 0.62, 0.12),
            (rim_r * hub, 0.20), (rim_r * hub * 0.85, 0.36), (rim_r * hub * 0.45, 0.44), (0.0, 0.46)]
    rings = []
    for rr, xa in prof:
        rings.append([c + V((s * xa * w, rr * math.cos(2 * math.pi * i / segs), rr * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    vr = [[bm.verts.new(p) for p in r_] for r_ in rings]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            f = (a[i], b[i], b[j], a[j]) if s > 0 else (a[j], b[j], b[i], a[i])
            bm.faces.new(f)
    # inner closing disc
    inner = [bm.verts.new(c + V((-s * 0.42 * w, rim_r * math.cos(2 * math.pi * i / segs), rim_r * math.sin(2 * math.pi * i / segs)))) for i in range(segs)]
    bm.faces.new(inner if s > 0 else list(reversed(inner)))
    for k in range(nuts):
        t = 2 * math.pi * k / nuts
        p = c + V((s * 0.22 * w, rim_r * hub * 1.25 * math.cos(t), rim_r * hub * 1.25 * math.sin(t)))
        C.cyl_bm(bm, p, p + V((s * 0.03, 0, 0)), 0.012, 6)


def spoke_rim_bm(bm, c, rim_r, w, side=1, spokes=18, segs=20):
    """Wire-spoke motorcycle wheel: rim channel + hub + crossed spokes."""
    c = V(c)
    C.cyl_bm(bm, c + V((-0.35 * w, 0, 0)), c + V((0.35 * w, 0, 0)), rim_r, segs, caps=False)
    C.cyl_bm(bm, c + V((0.35 * w, 0, 0)), c + V((-0.35 * w, 0, 0)), rim_r * 0.94, segs, caps=False)
    C.cyl_bm(bm, c + V((-0.55 * w, 0, 0)), c + V((0.55 * w, 0, 0)), 0.055, 10)            # hub / brake drum
    C.cyl_bm(bm, c + V((-0.7 * w, 0, 0)), c + V((-0.45 * w, 0, 0)), 0.09, 12)               # brake drum
    for k in range(spokes):
        t = 2 * math.pi * k / spokes
        sgn = 1 if k % 2 == 0 else -1
        a = c + V((sgn * 0.4 * w, 0.05 * math.cos(t + 0.3 * sgn), 0.05 * math.sin(t + 0.3 * sgn)))
        b = c + V((0, rim_r * 0.94 * math.cos(t), rim_r * 0.94 * math.sin(t)))
        C.beam_bm(bm, a, b, 0.006, 0.006)


def wheel(node, c, r, w, rim_r, side, style='disc', steer=None, spare=False, segs=48, lug=0.014, rim_kind='paint',
          contact_pt=True, spokes=18, tread='xc', rim_segs=28):
    """Complete wheel = tyre (rubber, tread texture) + rim, one node pivoted at the hub. steer = name of the steering
    parent node. Burnt: the tyre has burnt away completely - bare heat-scaled rusty rim with a loose, sagging steel bead
    wire and a charred rubber puddle under it; the wreck (apply_T in the scripts) sits on its rims."""
    burnt = paint_base() == 'burnt'
    c = V(c)
    if not burnt:
        bm = bmesh.new()
        tyre_bm(bm, c, r, w, rim_r, segs, lug, tread=tread)
        vp(bm, 'tyre', node + '_tyre', node=node, pivot=c, smooth=True, grime=1.0, uv='keep')
    else:
        bm = bmesh.new()                                   # bead wire: thin, loose, partly unravelled
        for sx in (-0.38, 0.38):
            pts = []
            for i in range(19):
                t = 2 * math.pi * i / 18
                rr = rim_r * 1.03 + 0.012 * math.sin(3 * t + sx * 9)
                pts.append(c + V((sx * w + 0.01 * math.sin(5 * t), rr * math.cos(t), rr * math.sin(t))))
            for p0, p1 in zip(pts[:-1], pts[1:]):
                C.beam_bm(bm, p0, p1, 0.005, 0.005)
        vp(bm, 'soot', node + '_bead', node=node, pivot=c, lod='drop2')
        if not spare:                                      # melted rubber puddle where the tyre burnt on the ground
            melt_puddle(node, c, w, r)
    bm = bmesh.new()
    if style == 'spoke':
        spoke_rim_bm(bm, c, rim_r, w, side, spokes, segs=rim_segs)
    else:
        rim_bm(bm, c, rim_r, w, side, segs=rim_segs)
    vp(bm, 'rust' if burnt else rim_kind, node + '_rim', node=node, pivot=c, smooth=False, grime=1.0)
    if not spare:
        moving(node, 'wheel', c, (1, 0, 0), parent=steer, radius=round(r if not burnt else rim_r * 1.02, 3), width=round(w, 3))
        if contact_pt:
            contact('contact_' + node, (c.x, c.y, 0.0), node=node, width=w)


def melt_puddle(node, c, w, r):
    """rw2: molten tyre rubber as a ground decal, not a puck: flat irregular outline (noisy radius, lobes), ~zero
    thickness (single up-facing faces 3-4 mm above the ground), a glossy tar core and a matte soot halo whose vertex
    alpha fades to 0 at the rim (alphaMode BLEND) so it blends into the soil."""
    rnd = random.Random(hash(node) & 0xffff)
    segs = 22
    ph = [rnd.uniform(0, 6.28) for _ in range(3)]
    def rad(t):
        return 1.0 + 0.16 * math.sin(3 * t + ph[0]) + 0.1 * math.sin(5 * t + ph[1]) + 0.07 * math.sin(8 * t + ph[2]) + rnd.uniform(-0.05, 0.05)
    rx, ry = max(0.10, w * 0.62), max(0.16, r * 0.55)          # smeared along the tyre footprint
    def ring(k, z):
        return [V((c.x + rx * k * rad(2 * math.pi * i / segs) * math.cos(2 * math.pi * i / segs),
                   c.y + ry * k * rad(2 * math.pi * i / segs) * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)]
    rad_cache = [rad(2 * math.pi * i / segs) for i in range(segs)]
    rad = lambda t, _rc=rad_cache: _rc[int(round(t / (2 * math.pi) * segs)) % segs]
    bm = bmesh.new()
    ctr = bm.verts.new(V((c.x, c.y, 0.004)))
    core = [bm.verts.new(q) for q in ring(0.72, 0.004)]
    for i in range(segs):
        bm.faces.new((ctr, core[i], core[(i + 1) % segs]))
    ob = vp(bm, 'tar', node + '_melt', node='main', lod='drop2', recalc=False)
    ob['kit_ground'] = True                                       # stays on the ground (apply_T)
    bm = bmesh.new()
    a_ = [bm.verts.new(q) for q in ring(0.66, 0.003)]
    b_ = [bm.verts.new(q) for q in ring(1.18, 0.003)]
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((a_[i], b_[i], b_[j], a_[j]))
    ob = vp(bm, 'tar_halo', node + '_melt_halo', node='main', lod='drop2', recalc=False)
    ob['kit_ground'] = True
    ca = ob.data.color_attributes.get('Col')
    for f in ob.data.polygons:                                       # outer ring alpha 0 -> soft decal edge
        for li in f.loop_indices:
            v = ob.data.vertices[ob.data.loops[li].vertex_index].co
            d = math.hypot((v.x - c.x) / rx, (v.y - c.y) / ry)
            col = list(ca.data[li].color)
            col[3] = 0.85 if d < 0.9 else 0.0
            ca.data[li].color = col


def headlight(name, c, r, depth=0.14, cover=True, direction=(0, -1, 0), node='main', rim_kind='paint'):
    """Bowl + lens + WWII blackout cover (Tarnkappe: a cap with a narrow horizontal slit)."""
    c, d = V(c), V(direction).normalized()
    P(rim_kind, cyl, c - d * depth, c, r * 0.72, 14, r1=r, name=name + '_bowl', node=node)
    P('chrome', cyl, c, c + d * 0.012, r, 14, name=name + '_bezel', node=node)
    P('lens', cyl, c + d * 0.006, c + d * 0.016, r * 0.9, 14, name=name + '_lens', node=node)
    if cover and paint_base() != 'black':
        # cover cap with a slit: two half-discs above/below a thin slit strip
        # rw2: deeper, clearly visible Tarnkappe: a painted cap 4 cm proud of the lens with a hood over the slit and a
        # bright horizontal slit (reads from the 3/4 game views)
        side = d.cross(V((0, 0, 1))).normalized()
        up = side.cross(d).normalized()
        P('paint', cyl, c + d * 0.012, c + d * 0.05, r * 1.02, 14, r1=r * 0.94, name=name + '_cover', node=node)
        P('paint', box, c + d * 0.062 + up * r * 0.28, (r * 1.5, 0.05, 0.012), name=name + '_hood', node=node)
        P('amber', box, c + d * 0.052 + up * r * 0.12, (r * 1.2, 0.006, r * 0.16), name=name + '_slit', node=node)
    light(name, c + d * 0.03, d, blackout=cover and paint_base() != 'black', node=node if node != 'main' else None)


def notek(name, c, direction=(0, -1, 0), node='main'):
    """Notek blackout driving light (small hooded lamp on the left wing, standard on Wehrmacht vehicles from 1940)."""
    c, d = V(c), V(direction).normalized()
    P('paint', cyl, c - d * 0.07, c + d * 0.02, 0.055, 12, name=name + '_body', node=node)
    P('paint', box, c + d * 0.035 + V((0, 0, 0.03)), (0.12, 0.05, 0.02), name=name + '_hood', node=node)
    P('lens', box, c + d * 0.025, (0.08, 0.012, 0.02), name=name + '_lens', node=node)
    P('paint', cyl, c - V((0, 0, 0.06)), c - V((0, 0, 0.0)), 0.012, 6, name=name + '_stem', node=node)
    light(name, c + d * 0.03, d, blackout=True, kind='notek', node=node if node != 'main' else None)


def taillight(name, c, direction=(0, 1, 0), node='main', stop=True):
    c, d = V(c), V(direction).normalized()
    P('paint', box, c, (0.1, 0.06, 0.08), name=name + '_body', node=node)
    P('red', box, c + d * 0.032, (0.07, 0.01, 0.03), name=name + '_lens', node=node)
    light(name, c + d * 0.04, d, blackout=paint_base() != 'black', kind='taillight', node=node if node != 'main' else None)


def balkenkreuz(c, normal, size, node='main'):
    """Plain Balkenkreuz (white outline cross, black centre - 1940s style). Insignia only per spec 10.6."""
    c, n = V(c), V(normal).normalized()
    u = n.cross(V((0, 0, 1))).normalized() if abs(n.z) < 0.9 else V((1, 0, 0))
    v = u.cross(n).normalized() * -1 if abs(n.z) < 0.9 else V((0, 1, 0))
    if abs(n.z) < 0.9:
        v = V((0, 0, 1))
    s = size
    for kind, a, b, off in (('white', 1.0, 0.36, 0.004), ('black', 0.86, 0.2, 0.007)):
        for (du, dv) in ((a * s, b * s), (b * s, a * s)):
            bm = bmesh.new()
            p0 = c + n * off
            pts = [p0 - u * du / 2 - v * dv / 2, p0 + u * du / 2 - v * dv / 2, p0 + u * du / 2 + v * dv / 2, p0 - u * du / 2 + v * dv / 2]
            C.quad(bm, pts)
            vp(bm, kind, 'bk', node=node, grime=0.8, lod='drop')


def tac_number(c, normal, w, h, node='main'):
    """Tactical number plate / white number panel placeholder (plain white rectangle w/ dark digits bars)."""
    c, n = V(c), V(normal).normalized()
    u = n.cross(V((0, 0, 1))).normalized()
    v = V((0, 0, 1))
    bm = bmesh.new()
    p0 = c + n * 0.004
    C.quad(bm, [p0 - u * w / 2 - v * h / 2, p0 + u * w / 2 - v * h / 2, p0 + u * w / 2 + v * h / 2, p0 - u * w / 2 + v * h / 2])
    vp(bm, 'white', 'plate', node=node, grime=1.0, lod='drop')
    for k in range(5):
        bm = bmesh.new()
        q = p0 + n * 0.002 + u * (w * (-0.32 + 0.16 * k))
        C.quad(bm, [q - u * w * 0.04 - v * h * 0.3, q + u * w * 0.04 - v * h * 0.3, q + u * w * 0.04 + v * h * 0.3, q - u * w * 0.04 + v * h * 0.3])
        vp(bm, 'black', 'plate_digit', node=node, grime=0.3, lod='drop')


# ------------------------------------------------------------------ export
def _build_lod(level, parts, ratio, min_size):
    groups = {}
    for o in parts:
        node = o.get('kit_node', 'main')
        if level > 0 and (o.get('kit_lod') == 'drop' or (node == 'main' and E.part_size(o) < min_size)):
            continue
        if level > 1 and o.get('kit_lod') == 'drop2':
            continue
        groups.setdefault(node, []).append(o)
    out = {}
    for node, objs in groups.items():
        piv = next((o.get('kit_pivot') for o in objs if o.get('kit_pivot')), None)
        ob = E.join([E._copy(o) for o in objs], node)
        if ob.name != node:                          # rw2: a part/empty already holds the node name -> take it over
            other = bpy.data.objects.get(node)
            if other is not None:
                other.name = node + '_src'
            ob.name = node
        if level > 0 and ratio < 1:
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.0 if level == 1 else 6.0), verts=bm.verts, edges=bm.edges,
                                     delimit={'MATERIAL'})
            bm.to_mesh(ob.data)
            bm.free()
            m = ob.modifiers.new('dec', 'DECIMATE')
            m.ratio = ratio
            m.use_collapse_triangulate = True
            m.delimit = {'MATERIAL'}
            E._select([ob])
            bpy.ops.object.modifier_apply(modifier='dec')
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.validate(clean_customdata=False)
        ca = ob.data.color_attributes
        if 'Col' in ca:                                   # export COLOR_0 (the kit exporter silently drops it)
            ca.active_color = ca['Col']
            ca.render_color_index = list(ca).index(ca['Col'])
        if piv:
            d = V(piv)
            ob.data.transform(Matrix.Translation(-d))
            ob.location = d
        out[node] = ob
    return out


def _arrange(objs, parents, frames, sockets=False):
    """Node frames (rotated pivots, e.g. a raked motorcycle fork), parenting (wheel under steer), socket empties."""
    bpy.context.view_layer.update()
    for node, R in frames.items():
        ob = objs.get(node)
        if ob:
            ob.data.transform(R.to_4x4().inverted())
            ob.rotation_mode = 'QUATERNION'
            ob.rotation_quaternion = R.to_quaternion()
    bpy.context.view_layer.update()
    for child, par in parents.items():
        if child in objs and par in objs:
            mw = objs[child].matrix_world.copy()
            objs[child].parent = objs[par]
            objs[child].matrix_world = mw
    extra = []
    if sockets:
        for name, pos, node in VM.get('_blender', []):
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.1
            bpy.context.scene.collection.objects.link(e)
            e.location = pos
            bpy.context.view_layer.update()
            if node and node in objs:
                mw = e.matrix_world.copy()
                e.parent = objs[node]
                e.matrix_world = mw
            extra.append(e)
    return list(objs.values()) + extra


WRECK_DROP_EMIT = ('exhaust', 'dust', 'mud', 'snow_spray', 'fuel_vapour')
WRECK_DROP_MOVE = ('wheel', 'wheel_free', 'steer', 'steering_wheel', 'fork')


def _reground_wheels(target=-0.008):
    """rw2: after the wreck sag/tilt (apply_T) every road-wheel rim must sit on the ground / its rubber puddle:
    shift each wheel node (parts + pivot) vertically so its lowest point is `target` (a few mm into the soil)."""
    for d in VM['moving']:
        if d.get('kind') != 'wheel':
            continue
        obs = [o for o in C.A.parts if o.get('kit_node') == d['node'] and o.name in bpy.data.objects]
        if not obs:
            continue
        mz = min(v.co.z for o in obs for v in o.data.vertices)
        dz = target - mz
        if abs(dz) < 0.003:
            continue
        for o in obs:
            o.data.transform(Matrix.Translation((0, 0, dz)))
            if o.get('kit_pivot'):
                pv = list(o['kit_pivot'])
                pv[2] += dz
                o['kit_pivot'] = pv
        d['pivot'][1] = round(d['pivot'][1] + dz, 3)
        C.log('reground %s dz=%.3f' % (d['node'], dz))


def _strip_wreck_meta():
    """rw2: a burnt hulk has no running gear: no exhaust/dust/mud emitters, no lamps, no wheel spin/steer entries and
    no wheel contacts (terrain trail stamper). Smoke / fire / fuel_leak stay."""
    VM['emitters'] = [e for e in VM['emitters'] if e['kind'] not in WRECK_DROP_EMIT]
    VM['lights'] = []
    VM['contacts'] = []
    VM['moving'] = [m for m in VM['moving'] if m['kind'] not in WRECK_DROP_MOVE]


def _mirror_lr(frames):
    """rw2 HANDEDNESS FIX: the build scripts treated Blender +X as vehicle right, but with the front on Blender -Y
    (glTF +Z) +X is the vehicle LEFT. Mirror the whole build in X (driver / steering wheel / Notek to the left,
    R75 sidecar to the right): meshes (+ winding), pivots, node frames, all metadata positions/directions.
    Rotation axes keep their meaning (wheel spin, steer, gun yaw/pitch are symmetric); door limits are mirrored.
    Stencilled text (kit_text) is re-mirrored along its reading axis so it never reads backwards."""
    S = Matrix.Scale(-1, 4, (1, 0, 0))
    for o in C.A.parts:
        if o.name not in bpy.data.objects:
            continue
        o.data.transform(S)
        o.data.flip_normals()
        if o.get('kit_pivot'):
            pv = list(o['kit_pivot'])
            o['kit_pivot'] = [-pv[0], pv[1], pv[2]]
        if o.get('kit_text'):
            vs = [v.co for v in o.data.vertices]
            nrm = o.data.polygons[0].normal if o.data.polygons else V((1, 0, 0))
            i = 1 if abs(nrm.x) >= abs(nrm.y) else 0
            cc = (min(v[i] for v in vs) + max(v[i] for v in vs)) / 2
            T = Matrix.Translation(V([cc if k == i else 0 for k in range(3)])) @ Matrix.Scale(-1, 4, V([1 if k == i else 0 for k in range(3)])) \
                @ Matrix.Translation(V([-cc if k == i else 0 for k in range(3)]))
            o.data.transform(T)
            o.data.flip_normals()
    for key in ('sockets', 'emitters', 'contacts', 'lights'):
        for d in VM[key]:
            d['pos'][0] = round(-d['pos'][0], 3)
            if 'dir' in d:
                d['dir'][0] = round(-d['dir'][0], 4) + 0.0
    for d in VM['moving']:
        d['pivot'][0] = round(-d['pivot'][0], 3)
        if d['kind'] == 'door' and d.get('limits_deg'):
            lo, hi = d['limits_deg']
            d['limits_deg'] = [-hi + 0.0, -lo + 0.0]
    VM['_blender'] = [(n, (-p[0], p[1], p[2]), nd) for n, p, nd in VM.get('_blender', [])]
    Rm = Matrix.Scale(-1, 3, (1, 0, 0))
    VM['handedness'] = 'glTF +X = vehicle LEFT (front along +Z); left-hand drive / R75 sidecar on the right (rw2 fix)'
    return {k: (Rm @ (R.to_3x3() if len(R) == 4 else R) @ Rm) for k, R in frames.items()}


def vfinalize(outdir, vtype, dims, parents=None, frames=None, lods=((0.42, 0.12), (0.21, 0.40)), ao_res=1024,
              ao_samples=64, skip_ao=False, footprint=None, variants=None, extra=None, clamp_half_w=None):
    """AO bake + LOD0-2 GLBs (library-referenced materials) + sidecar <asset>.kit.json with a 'vehicle' block."""
    import glb_post
    A = C.A
    parents, frames = parents or {}, frames or {}
    if extra and extra.get('destroyed'):                   # a wreck carries no crew and cannot explode again
        crew = lambda n, r: n.startswith('seat') or r in ('driver', 'passenger', 'gunner', 'crew')
        VM['sockets'] = [d for d in VM['sockets'] if not crew(d['name'], d.get('role'))]
        keep = {d['name'] for d in VM['sockets']}
        VM['_blender'] = [t for t in VM.get('_blender', []) if t[0] in keep]
        for k in ('explosive', 'cargo', 'fuel'):
            VM.pop(k, None)
            extra.pop(k, None)
        _reground_wheels()
        _strip_wreck_meta()
    hw = (dims.get('width') or 9) / 2 + 0.02                   # rw2 diagnostics: parts beyond the declared width / below ground
    for o in A.parts:
        if o.name in bpy.data.objects and o.data.vertices:
            xs = [abs(v.co.x) for v in o.data.vertices]
            zs = [v.co.z for v in o.data.vertices]
            if max(xs) > hw or min(zs) < -0.02:
                C.log('DIAG %s node=%s max|x|=%.3f minz=%.3f' % (o.name, o.get('kit_node'), max(xs), min(zs)))
    frames = _mirror_lr(frames)
    if footprint:
        footprint = [(-q[0], q[1]) for q in footprint]
    os.makedirs(outdir, exist_ok=True)
    parts = [o for o in A.parts if o.name in bpy.data.objects]
    ao_path = os.path.join(outdir, A.name + '_ao.png')
    skip_ao = skip_ao or os.environ.get('VEH_FAST') == '1'     # quick geometry checks
    if not skip_ao:
        E.unwrap_ao(parts)
        E.bake_ao(parts, ao_res, ao_samples, dist=0.6, out=ao_path)
    info = []
    for lvl in range(3):
        r, ms = (1.0, 0.0) if lvl == 0 else lods[lvl - 1]
        objs = _build_lod(lvl, parts, r, ms)
        allo = _arrange(objs, parents, frames, sockets=True)        # rw2: socket empties in every LOD
        bad = [o.name for o in allo if '.' in o.name]
        if bad:
            C.log('WARN LOD%d node names with suffix: %s' % (lvl, bad[:6]))
        fn = A.name + ('' if lvl == 0 else '_lod%d' % lvl) + '.glb'
        p = os.path.join(outdir, fn)
        export_glb(p, allo)
        glb_post.rewrite(p, ao_png=None if skip_ao else ao_path, lib_res='1k', ao_px=(1024, 512, 256)[lvl])
        _post_flat_ao(p)
        _post_cm(p)
        # COLOR_0 stays 16-bit (Blender exports normalized ushort): paint colour lives in the vertex colours and dark
        # paints (Dunkelgrau, black) would band visibly at 8 bits in linear space.
        t = E.tris(list(objs.values()))
        info.append({'file': fn, 'tris': t, 'bytes': os.path.getsize(p)})
        C.log('LOD%d %s tris=%d %.0fKB' % (lvl, fn, t, os.path.getsize(p) / 1024))
        if lvl == 0:
            for o in allo:                     # rw2: free the node names so LOD1/2 nodes are not exported as 'main.001'
                o.name = o.name + '__lod0'
                if o.data is not None:
                    o.data.name = o.data.name + '__lod0'
            lod0 = list(objs.values())
            bpy.context.view_layer.update()      # rw2: true vertex bbox (a rotated node frame inflated the AABB, R75 1.28 m)
            bb = [o.matrix_world @ v.co for o in lod0 for v in o.data.vertices]
            mn = [min(q[i] for q in bb) for i in range(3)]
            mx = [max(q[i] for q in bb) for i in range(3)]
            nodes = sorted(objs.keys())
        else:
            for o in allo:
                bpy.data.objects.remove(o)
    meta = {k: v for k, v in A.meta.items() if k in ('asset', 'anchors', 'notes')}
    vm = {k: v for k, v in VM.items() if not k.startswith('_')}
    vm.update({'type': vtype, 'variant': VAR, 'dims_m': dims,
               'measured_m': {'length': round(mx[1] - mn[1], 3), 'width': round(mx[0] - mn[0], 3), 'height': round(mx[2], 3)},
               'paint_srgb': PAINT.get(paint_base()), 'variants_available': variants or []})
    if extra:
        vm.update(extra)
    meta['vehicle'] = vm
    fx0, fx1 = (mn[0], mx[0]) if clamp_half_w is None else (max(mn[0], -clamp_half_w), min(mx[0], clamp_half_w))
    fp = footprint or [(fx0, mn[1]), (fx1, mn[1]), (fx1, mx[1]), (fx0, mx[1])]     # wreck debris never widens the nav blocker
    meta['footprints'] = [{'shape': 'poly', 'points': [C.g2(p) for p in fp], 'block': 'HIGH', 'kind': 'vehicle'}]
    meta['bbox_game'] = {'min': [round(mn[0], 3), round(mn[2], 3), round(-mx[1], 3)], 'max': [round(mx[0], 3), round(mx[2], 3), round(-mn[1], 3)]}
    meta['height'] = round(mx[2], 3)
    meta['pivot'] = 'ground centre; model front faces +Z (game south at rot 0); wheels spin about local +X'
    meta['lods'] = info
    meta['materials'] = sorted({m.get('kit_id', m.name) if 'kit_id' in m else m.name for o in lod0 for m in o.data.materials if m})
    meta['nodes'] = nodes
    meta['group_textures'] = {'dir': 'vehicles/cars_moto/lib', 'materials_add': 'vehicles/cars_moto/lib/materials_add.json',
                              'used': ['veh_tyre'] + (['veh_wreck'] if paint_base() == 'burnt' else ['veh_paintc'])}
    for k in ('doors', 'roofs', 'climb', 'ladders', 'windows'):
        meta[k] = []
    json.dump(meta, open(os.path.join(outdir, A.name + '.kit.json'), 'w'), indent=1)
    cred = {'asset': A.name, 'geometry': 'procedural Blender script (own work, CC0) - vehicles/cars_moto/scripts',
            'textures': {}}
    for mid in meta['materials']:
        e = C.MATS.get(mid.replace('kit:', '').split('~')[0])
        if e:
            cred['textures'][mid] = dict(e.get('source', {}), label=e.get('label'), files=e.get('maps'))
        else:
            cred['textures'][mid] = {'source': 'flat colour (no texture)', 'license': 'CC0-1.0'}
    for t in ('veh_tyre', 'veh_wreck', 'veh_paintc'):
        if t == 'veh_tyre' or (t == 'veh_wreck') == (paint_base() == 'burnt'):
            cred['textures']['cm:' + t] = {'source': 'procedural (vehicles/cars_moto/scripts/%s, own work)' % ('make_paintc_tex.py' if t == 'veh_paintc' else 'make_cm_tex.py'),
                                           'license': 'CC0-1.0', 'files': 'vehicles/cars_moto/lib/%s_{diff,nor,arm}.jpg' % t}
    json.dump(cred, open(os.path.join(outdir, A.name + '.credits.json'), 'w'), indent=1)
    C.log('finalized', A.name, info)
    return meta


CM_LIB = os.path.abspath(os.path.join(SCR, '..', 'lib'))     # group textures (veh_tyre, veh_wreck), see make_cm_tex.py


def _post_cm(p):
    """Group material pass on an exported GLB:
    - veh:tyre  -> tread strip textures (vehicles/cars_moto/lib/veh_tyre_*), UVs from tyre_bm
    - veh:glass / veh:glass_cab -> real glass: alphaMode BLEND (0.35 open screens / 0.55 cab windows), roughness 0.05,
      dark tint, double sided, KHR specular 1 so the environment reflects in it
    - kit:veh_paint -> matt military paint: roughnessFactor 1.6 (texture ~0.52 -> ~0.83) + KHR specular 0.35, which
      stops the sky reflection that made Dunkelgrau read as a light blue-grey; burnt variants -> veh_wreck textures."""
    import glb_post
    js, bin_ = glb_post.read_glb(p)
    base = os.path.relpath(CM_LIB, os.path.dirname(os.path.abspath(p))).replace(os.sep, '/') + '/'
    js.setdefault('images', [])
    js.setdefault('textures', [])
    js.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}])
    idx = {}

    def tex(name):
        uri = base + name + '.jpg'
        if uri not in idx:
            js['images'].append({'uri': uri, 'name': name})
            js['textures'].append({'sampler': 0, 'source': len(js['images']) - 1})
            idx[uri] = len(js['textures']) - 1
        return idx[uri]
    ext = set(js.get('extensionsUsed', []))
    burnt = paint_base() == 'burnt'
    for mt in js.get('materials', []):
        nm = mt.get('name', '')
        pb = mt.setdefault('pbrMetallicRoughness', {})
        if nm == 'veh:tyre':
            pb.update(baseColorTexture={'index': tex('veh_tyre_diff')}, metallicRoughnessTexture={'index': tex('veh_tyre_arm')},
                      baseColorFactor=[1, 1, 1, 1], metallicFactor=0.0, roughnessFactor=1.0)
            mt['normalTexture'] = {'index': tex('veh_tyre_nor'), 'scale': 1.0}
            mt.setdefault('extras', {})['cm_tex'] = 'veh_tyre'
        elif nm in ('veh:tar', 'veh:tar_halo'):    # burnt-tyre puddle: glossy molten core, matte halo fading into the soil
            pb.update(metallicFactor=0.0, roughnessFactor=0.3 if nm == 'veh:tar' else 0.95)
            if nm == 'veh:tar_halo':
                mt['alphaMode'] = 'BLEND'
                mt.pop('occlusionTexture', None)
        elif nm[4:] in GLASS_ALPHA:
            rgb = FLAT[nm[4:]][0]
            pb.update(baseColorFactor=[(x / 255) ** 2.2 for x in rgb] + [GLASS_ALPHA[nm[4:]]], metallicFactor=0.0,
                      roughnessFactor=0.05)
            mt['alphaMode'] = 'BLEND'
            mt['doubleSided'] = True
            mt.pop('occlusionTexture', None)
            mt.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': 1.0}
            ext.add('KHR_materials_specular')
        elif nm == 'kit:veh_paint' and burnt:
            pb.update(baseColorTexture={'index': tex('veh_wreck_diff')}, metallicRoughnessTexture={'index': tex('veh_wreck_arm')},
                      metallicFactor=0.0, roughnessFactor=1.0)
            mt['normalTexture'] = {'index': tex('veh_wreck_nor'), 'scale': 0.45}
            mt['name'] = 'kit:veh_wreck'
            mt.setdefault('extras', {})['cm_tex'] = 'veh_wreck'
        elif nm == 'kit:veh_paint':
            pb.update(baseColorTexture={'index': tex('veh_paintc_diff')}, metallicRoughnessTexture={'index': tex('veh_paintc_arm')})
            mt['normalTexture'] = {'index': tex('veh_paintc_nor'), 'scale': mt.get('normalTexture', {}).get('scale', 0.6)}
            mt['name'] = 'kit:veh_paintc'          # rw2: chip-free paint (edge chips = vertex-colour edge_wear pass)
            mt.setdefault('extras', {})['cm_tex'] = 'veh_paintc'
            pb['roughnessFactor'] = 1.6
            mt.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': 0.35}
            ext.add('KHR_materials_specular')
    if ext:
        js['extensionsUsed'] = sorted(ext)
    glb_post.write_glb(p, js, bin_)


def _post_flat_ao(p):
    """glb_post only rebuilds 'kit:' materials: give the flat 'veh:' materials the baked AO (TEXCOORD_1) too."""
    import glb_post
    js, bin_ = glb_post.read_glb(p)
    ao = next((i for i, t in enumerate(js.get('textures', [])) if js['images'][t.get('source', -1)].get('name') == 'ao'), None) \
        if js.get('textures') else None
    if ao is None:
        return
    uv1 = set()
    for m in js.get('meshes', []):
        for pr in m['primitives']:
            if 'TEXCOORD_1' in pr['attributes'] and 'material' in pr:
                uv1.add(pr['material'])
    for i, mt in enumerate(js.get('materials', [])):
        if mt.get('name', '').startswith('veh:') and i in uv1:
            mt['occlusionTexture'] = {'index': ao, 'texCoord': 1, 'strength': 1.0}
            mt.setdefault('extras', {})['veh_id'] = mt['name'][4:]
    glb_post.write_glb(p, js, bin_)


# ------------------------------------------------------------------ body-building helpers
def rrect_ring(y, hw, zb, zt, r, n=3, rb=0.0, x0=0.0, crown=0.0):
    """Rounded-rectangle cross-section at station y (x across, z up): top corners radius r (n segs), bottom corners rb.
    crown lifts the middle of the top edge. Fixed vertex count for a given n."""
    r = min(r, hw * 0.98, (zt - zb) * 0.98)
    rb = min(rb, hw * 0.98, (zt - zb - r) * 0.98)
    pts = []
    nb = n if rb > 1e-4 else 0
    for i in range(nb + 1):                                  # bottom-right corner (single point when sharp)
        a = -math.pi / 2 + (math.pi / 2) * i / max(nb, 1)
        pts.append((x0 + hw - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    for i in range(n + 1):                                   # top-right
        a = (math.pi / 2) * i / n
        pts.append((x0 + hw - r + r * math.cos(a), zt - r + r * math.sin(a)))
    if crown:
        pts.append((x0, zt + crown))
    for i in range(n + 1):                                   # top-left
        a = math.pi / 2 + (math.pi / 2) * i / n
        pts.append((x0 - hw + r + r * math.cos(a), zt - r + r * math.sin(a)))
    for i in range(nb + 1):                                  # bottom-left
        a = math.pi + (math.pi / 2) * i / max(nb, 1)
        pts.append((x0 - hw + rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    return [V((x, y, z)) for x, z in pts]


def body_loft(bm, stations, n=3, rb=0.0, caps=True):
    """Loft rounded-rect sections: stations = [(y, hw, zb, zt, r[, crown])...] ordered front (-y) to rear."""
    rings = []
    for s in stations:
        crown = s[5] if len(s) > 5 else 0.0
        rings.append(rrect_ring(s[0], s[1], s[2], s[3], s[4], n, rb, crown=crown))
    fs = C.loft_bm(bm, rings, caps, caps)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return fs


def sweep_bm(bm, path, prof, x0=0.0, mirror=False, caps=True, center=None):
    """Sweep a closed cross-section along a path in the YZ plane. path = [(y, z)...]; prof = [(dx, dn)...] closed loop
    where dx is across X (added to x0, negated if mirror) and dn is along the path's up-normal."""
    rings = []
    for i, (y, z) in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        t = V((0, b[0] - a[0], b[1] - a[1])).normalized()
        nrm = V((0, -t.z, t.y))
        if center is not None:                                   # arcs: radial normal (outward from the wheel)
            nrm = V((0, y - center[0], z - center[1])).normalized()
        elif nrm.z < 0 and abs(nrm.z) > abs(nrm.y) * 0.2:
            nrm = -nrm
        ring = []
        for dx, dn in prof:
            x = x0 + (-dx if mirror else dx)
            ring.append(V((x, y, z)) + nrm * dn)
        rings.append(ring)
    fs = C.loft_bm(bm, rings, caps, caps)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return fs


def arc_path(cy, cz, R, a0, a1, segs):
    """Arc in the YZ plane around (cy, cz); angles in degrees, 0 = +Y (rear), 90 = up, 180 = -Y (front)."""
    return [(cy + R * math.cos(math.radians(a0 + (a1 - a0) * i / segs)), cz + R * math.sin(math.radians(a0 + (a1 - a0) * i / segs)))
            for i in range(segs + 1)]


def side_prism(bm, poly_yz, x_in, x_out):
    """Extrude a (y, z) side-profile polygon across X from x_in to x_out."""
    n = len(poly_yz)
    a = [bm.verts.new(V((x_in, y, z))) for y, z in poly_yz]
    b = [bm.verts.new(V((x_out, y, z))) for y, z in poly_yz]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def xf_bm(bm, Mx):
    bmesh.ops.transform(bm, matrix=Mx, verts=bm.verts[:])


def ring_torus(bm, c, R, r, axis=(0, 0, 1), segs=16, rsegs=6):
    """Torus (steering wheel rim, tyre bead...) around `axis` through c."""
    c, ax = V(c), V(axis).normalized()
    u = ax.orthogonal().normalized()
    w = ax.cross(u)
    rings = []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        d = u * math.cos(t) + w * math.sin(t)
        rings.append([c + d * (R + r * math.cos(2 * math.pi * k / rsegs)) + ax * (r * math.sin(2 * math.pi * k / rsegs)) for k in range(rsegs)])
    rings.append(rings[0])
    vr = [[bm.verts.new(p) for p in rr] for rr in rings[:-1]]
    vr.append(vr[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for k in range(rsegs):
            j = (k + 1) % rsegs
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def steering_wheel(node, c, axis, R=0.19, spokes=3):
    c, ax = V(c), V(axis).normalized()
    bm = bmesh.new()
    ring_torus(bm, c, R, 0.013, ax, 20, 5)
    u = ax.orthogonal().normalized()
    for k in range(spokes):
        t = 2 * math.pi * k / spokes + math.pi / 2
        d = (u * math.cos(t) + ax.cross(u) * math.sin(t))
        C.beam_bm(bm, c, c + d * R, 0.02, 0.008)
    C.cyl_bm(bm, c - ax * 0.02, c + ax * 0.02, 0.035, 8)
    vp(bm, 'black', node + '_rim', node=node, pivot=c)
    moving(node, 'steering_wheel', c, ax, limits=(-540, 540))


def apply_T(T):
    """Transform the whole built asset (wreck sink/tilt): meshes, node pivots and vehicle metadata."""
    for o in C.A.parts:
        if o.get('kit_ground'):
            continue
        o.data.transform(T)
        if o.get('kit_pivot'):
            o['kit_pivot'] = list(T @ V(o['kit_pivot']))
    def tg(p):
        b = T @ V((p[0], -p[2], p[1]))
        return G(b)
    for key in ('sockets', 'emitters', 'contacts', 'moving', 'lights'):
        for d in VM[key]:
            k = 'pivot' if 'pivot' in d else 'pos'
            d[k] = tg(d[k])
    VM['_blender'] = [(n, tuple(T @ V(p)), nd) for n, p, nd in VM.get('_blender', [])]


def rotate_node(node, deg, axis=(0, 0, 1)):
    """Pose a node (e.g. a wreck's door hanging open) by rotating its parts about the node pivot."""
    for o in C.A.parts:
        if o.get('kit_node') == node and o.get('kit_pivot'):
            pv = V(o['kit_pivot'])
            o.data.transform(Matrix.Translation(pv) @ Matrix.Rotation(math.radians(deg), 4, V(axis)) @ Matrix.Translation(-pv))


def export_glb(path, objs):
    """GLB with COLOR_0 (weathering) and without TANGENT (three.js derives tangent frames in the shader)."""
    E._select(objs)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
                              export_image_format='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False)


def _quantize_colors(p):
    """COLOR_0 float32 VEC4 -> normalized uint8 VEC4 (glTF-legal, 4x smaller); repacks the binary chunk."""
    import glb_post, struct
    js, bin_ = glb_post.read_glb(p)
    views = js.get('bufferViews', [])
    newdata = {}
    for m in js.get('meshes', []):
        for pr in m['primitives']:
            ai = pr['attributes'].get('COLOR_0')
            if ai is None:
                continue
            ac = js['accessors'][ai]
            if ac['componentType'] not in (5126, 5123) or ac['bufferView'] in newdata:
                continue
            bv = views[ac['bufferView']]
            nc = {'VEC3': 3, 'VEC4': 4}[ac['type']]
            off = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
            if ac['componentType'] == 5126:
                fl = struct.unpack_from('<%df' % (ac['count'] * nc), bin_, off)
            else:
                fl = [x / 65535.0 for x in struct.unpack_from('<%dH' % (ac['count'] * nc), bin_, off)]
            out = bytearray()
            for i in range(ac['count']):
                px = [max(0, min(255, int(round(fl[i * nc + k] * 255)))) for k in range(nc)] + ([255] if nc == 3 else [])
                out += bytes(px)
            newdata[ac['bufferView']] = bytes(out)
            ac.update(componentType=5121, normalized=True, type='VEC4')
            ac.pop('byteOffset', None)
            for k in ('min', 'max'):
                ac.pop(k, None)
    if not newdata:
        return
    nb = bytearray()
    for i, bv in enumerate(views):
        while len(nb) % 4:
            nb += b'\0'
        if i in newdata:
            chunk = newdata[i]
            bv.pop('byteStride', None)
        else:
            chunk = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        bv['byteOffset'] = len(nb)
        bv['byteLength'] = len(chunk)
        nb += chunk
    glb_post.write_glb(p, js, nb)
