"""Desert rework 2 overrides (imported at the end of dz.py; rebinds dz module functions so every script and every
dz helper picks them up):
- decals: weathering kinds remapped to the soft desert atlas 'decals_dz' (make_decals_dz.py) with 2 variants + random
  mirror, so no hard-edged dark quads and no identical repeated blotches;
- materials: mud_render -> mud_render2 (sharper, darker/redder than sand), screed_roof -> screed_lime (patchy lime
  screed, no crazing), corrugated_galv -> corrugated_zinc (real galvanised sheet), canvas_camo -> tent_canvas;
- roof_patches: no dark tar / white blob polygons; soft stains + one low trowelled repair with a feathered skirt;
- lime_patch: pale dust wash decal instead of a white 'paper' polygon; spall2: never orange brick, deeper broken edge;
- stronger warm bounce in shade (no blue limewash); lathe water jars; irregular sandbags; low wind-blown sand;
  debris mounds with a soft toe (no 'tart' rim), sunk/tilted bricks + clods + earth spill."""
import math, os, json, random
import bmesh
from mathutils import Vector as V, Matrix
import dz
from dz import K, C, KA
import kit_core
import kit_arch, kit_roof, kit_detail, kit_weather, kit_bridge

KIT = dz.KIT
# ------------------------------------------------------------------ material remap (at part() entry)
REMAP = {'mud_render': 'mud_render2', 'screed_roof': 'screed_lime', 'corrugated_galv': 'corrugated_zinc',
         'canvas_camo': 'tent_canvas'}
if os.environ.get('DZ_NOREMAP'):
    REMAP = {}
_orig_part = kit_core.part


def part(bm, mid, *a, **kw):
    return _orig_part(bm, REMAP.get(mid, mid), *a, **kw)


for _m in (kit_core, kit_arch, kit_roof, kit_detail, kit_weather, kit_bridge, K, C):
    if getattr(_m, 'part', None) is _orig_part:
        _m.part = part

# ------------------------------------------------------------------ decals -> soft desert atlas
_DZR = json.load(open(KIT + '/lib/decals.json'))['decals_dz']
DMAP = {'soot': ['soot_a', 'soot_b'], 'stain_blotch': ['roof_stain_a', 'roof_stain_b'], 'damp_base': ['damp_rise'],
        'crack': ['crack_fine'], 'efflorescence': ['dust_wash'], 'streak_rain': ['grime_a', 'grime_b'],
        'streak_long': ['grime_a', 'grime_b'], 'streak_rust': ['rust_run'], 'stain_rust_blotch': ['rust_run'],
        'moss_patch': ['roof_stain_b'], 'lichen': ['roof_stain_a'], 'dirt_splash': None}
CAP = {'soot_a': 0.75, 'soot_b': 0.75, 'grime_a': 0.7, 'grime_b': 0.7, 'damp_rise': 0.7, 'crack_fine': 0.6,
       'roof_stain_a': 0.8, 'roof_stain_b': 0.8, 'dust_wash': 0.75, 'scorch_a': 0.95, 'scorch_b': 0.95}
_drng = random.Random(4242)


def decal_dz(kind, center, normal, w, h, up=(0, 0, 1), offset=0.006, flip=None, name=None, node='decals', alpha=0.85):
    n = V(normal).normalized()
    u = V(up)
    r = u.cross(n)
    if r.length < 1e-4:
        r = V((1, 0, 0))
    r.normalize()
    u = n.cross(r).normalized()
    c = V(center) + n * offset
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    rc = list(_DZR[kind])
    if flip if flip is not None else _drng.random() < 0.5:
        rc[0], rc[2] = rc[2], rc[0]
    C.uv_rect(bm, f, rc)
    a = min(alpha, CAP.get(kind, 1.0))
    return part(bm, 'decals_dz', name=name or 'decal_' + kind, uv='keep', grime=0, node=node, bisect=False,
                jitter=0.0, alpha=a)


def decal(kind, center, normal, w, h, up=(0, 0, 1), offset=0.006, flip=False, name=None, node='decals', alpha=0.85):
    if kind in _DZR:
        return decal_dz(kind, center, normal, w, h, up, offset, None, name, node, alpha)
    if kind in DMAP:
        vs = DMAP[kind]
        if vs is None:
            vs = ['roof_stain_a', 'roof_stain_b'] if abs(V(normal).normalized().z) > 0.6 else ['damp_rise']
        k = vs[_drng.randrange(len(vs))]
        # soft cells need a bit more coverage than the old hard ones to read at game zoom
        s = 1.0 if k.startswith(('crack', 'grime', 'damp')) else 1.15
        a = alpha * (1.5 if k.startswith(('roof_stain', 'dust')) else 0.8 if k.startswith(('grime', 'damp')) else 1.15)
        return decal_dz(k, center, normal, w * s, h * s, up, offset, None, name, node, a)
    return dz._orig_decal(kind, center, normal, w, h, up, offset, flip, name, node, alpha)


K.decal = decal
kit_weather.decal = decal
dz.decal = decal


# ------------------------------------------------------------------ warm bounce in shade (stronger than round 1)
def desert_tone(strength=1.0):
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
            side = (1 - abs(n.z)) * 0.35                     # every wall gets some ground bounce
            up = max(0.0, n.z)
            for li in poly.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co
                hk = max(0.25, 1 - max(0.0, p.z) / 11.0)
                k = strength * (away + side) * hk
                col = list(ca.data[li].color)
                col[1] *= 1 - 0.05 * k
                col[2] *= 1 - 0.2 * k
                if up > 0.7:
                    col[2] *= 1 - 0.04 * strength
                ca.data[li].color = col


dz.desert_tone = desert_tone


# ------------------------------------------------------------------ roofs: soft stains + one feathered trowelled repair
def repair_patch(c, z, w, h, seed=0, mid='screed_lime', tint=(0.97, 0.955, 0.93), name='repair'):
    """Low trowelled screed repair: an irregular raised pad (2.5 cm) whose edge feathers down to the roof
    (a skirt ring at roof level) - reads as a relief patch with a soft shadow, not a pasted polygon."""
    cc = V((c[0], c[1], z))
    inner = dz._blob_outline(cc, V((1, 0, 0)), V((0, 1, 0)), w, h, seed, 14, 0.4)
    outer = [cc + (p - cc) * 1.18 for p in inner]
    bm = bmesh.new()
    vi = [bm.verts.new(p + V((0, 0, 0.025))) for p in inner]
    vo = [bm.verts.new(p + V((0, 0, 0.004))) for p in outer]
    bm.faces.new(vi)
    m = len(vi)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = K.part(bm, mid, name=name, grime=0.5, bisect=False, lod='drop', mat_tint=tint)
    o['dz_noao'] = 1
    return o


def roof_patches(poly, z, n=4, seed=0, name='rpatch', lime=True, tar=True, lime_mat='limewash_worn', lime_tint=(1.0, 0.98, 0.95)):
    rr = random.Random(seed * 31 + 7)
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    W, D = max(xs) - min(xs), max(ys) - min(ys)
    if n >= 2 and min(W, D) > 2.4:
        cx, cy = rr.uniform(min(xs) + 1.2, max(xs) - 1.2), rr.uniform(min(ys) + 1.2, max(ys) - 1.2)
        repair_patch((cx, cy), z, rr.uniform(0.9, 1.6), rr.uniform(0.7, 1.2), seed, 'mud_render2' if lime_mat == 'mudbrick' else 'screed_lime',
                     (1.0, 0.97, 0.94) if lime_mat == 'mudbrick' else (0.99, 0.975, 0.95), name=name + '_rep')
    for i in range(n + 2):
        cx, cy = rr.uniform(min(xs) + 0.4, max(xs) - 0.4), rr.uniform(min(ys) + 0.4, max(ys) - 0.4)
        k = rr.choice(['roof_stain_a', 'roof_stain_b', 'roof_stain_a', 'roof_stain_b', 'dust_wash'])
        s = rr.uniform(1.2, 2.8)
        decal_dz(k, (cx, cy, z + 0.02), (0, 0, 1), s * rr.uniform(0.8, 1.3), s, up=(rr.uniform(-1, 1), 1, 0),
                 alpha=0.55 if k.startswith('roof') else 0.3)
    # drainage stains toward the spouts (along the low edges)
    for i in range(max(1, n // 2)):
        e = rr.randrange(len(poly))
        a, b = V((*poly[e][:2], z)), V((*poly[(e + 1) % len(poly)][:2], z))
        p = a.lerp(b, rr.uniform(0.2, 0.8))
        cen = V((sum(xs) / len(xs), sum(ys) / len(ys), z))
        p = p.lerp(cen, 0.12)
        decal_dz('grime_b', (p.x, p.y, z + 0.021), (0, 0, 1), 0.9, 1.6, up=tuple((cen - p).normalized()), alpha=0.35)


def lime_patch(center, normal, w, h, seed=0, name='lime', tint=(0.88, 0.85, 0.79)):
    """Round 2: whitened areas on mud walls are a soft pale wash (dust/lime bloom), not a white polygon."""
    decal_dz('dust_wash', center, normal, w * 1.3, h * 1.3, alpha=0.55)


def spall2(center, normal, w, h, mid='fieldstone', skin='limewash_worn', skin_tint=None, seed=0, name='spall', rim=0.018):
    """Fallen render: rubble (never bright brick) with a 3.5 cm broken render edge (lit lip + shadow line) and a
    soft grime halo, smaller than round 1 so it never reads as a pasted sticker."""
    if mid == 'brick_red':
        mid, t = 'mudbrick', (0.85, 0.78, 0.72)
    elif mid == 'mudbrick':
        t = (0.93, 0.88, 0.83)
    else:
        t = (0.78, 0.74, 0.68)
    w, h = w * 0.75, h * 0.75
    n = V(normal).normalized()
    rr = V((0, 0, 1)).cross(n).normalized() if abs(n.z) < 0.9 else V((1, 0, 0))
    u = n.cross(rr)
    c = V(center)
    inner = dz._blob_outline(c + n * 0.004, rr, u, w, h, seed, 14, 0.6)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in inner])
    K.part(bm, mid, name=name, grime=0.8, bisect=False, lod='drop', mat_tint=t)['dz_noao'] = 1
    rim = max(rim, 0.035)
    outer = [c + (p - c) * 1.15 for p in inner]
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


# ------------------------------------------------------------------ water jars (lathe, pale buff unglazed clay)
_JAR = [(0.075, 0.0), (0.17, 0.1), (0.225, 0.29), (0.18, 0.47), (0.075, 0.6), (0.092, 0.65)]


def jar_bm(bm, c, s=1.0, seed=0, segs=8, tilt=0.0, handles=True):
    rr = random.Random(seed)
    c = V(c)
    s *= rr.uniform(0.85, 1.1)
    R = Matrix.Rotation(tilt, 3, 'X') @ Matrix.Rotation(rr.uniform(0, 6.28), 3, 'Z')
    rings = []
    for (r_, z) in _JAR:
        rings.append([c + R @ V((math.cos(2 * math.pi * j / segs) * max(r_, 0.001) * s * (1 + 0.03 * math.sin(j * 1.7 + seed)),
                                 math.sin(2 * math.pi * j / segs) * max(r_, 0.001) * s, z * s)) for j in range(segs)])
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    for i in range(len(vs) - 1):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((vs[i][j], vs[i][k], vs[i + 1][k], vs[i + 1][j]))
    bm.faces.new(list(reversed(vs[-1])))
    bm.faces.new(list(vs[0]))
    if handles:
        for sgn in (-1, 1):
            a = c + R @ V((sgn * 0.08 * s, 0, 0.6 * s))
            b = c + R @ V((sgn * 0.2 * s, 0, 0.44 * s))
            C.beam_bm(bm, tuple(a), tuple(b), 0.03 * s, 0.03 * s)


def jars(points, name='jars', s=1.0, tint=None, seed=0):
    """Tunisian water jars (khabia / gargoulette): pale buff unglazed clay, bellied, narrow neck, lug handles."""
    bm = bmesh.new()
    for i, p in enumerate(points):
        jar_bm(bm, (p[0], p[1], p[2] if len(p) > 2 else 0.0), s, seed + i * 7, tilt=0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, 'plaster_rough', name=name, smooth=True, grime=0.5, mat_tint=tint or (0.98, 0.84, 0.68), bisect=False)


# ------------------------------------------------------------------ sandbags: irregular filled bags, not loaves / blocks
def bag_bm(bm, c, L, W, H, ang, rr):
    """One filled sandbag (32 tris): 6-point pillow section (flat seat, bulged flanks, rounded top) lofted over 3
    rings with pinched ends (one tied end narrower), random squash / sag / tilt - no two bags alike."""
    sq = rr.uniform(0.82, 1.15)
    H *= sq
    W *= 1 + (1 - sq) * 0.6
    R = Matrix.Rotation(ang, 3, 'Z') @ Matrix.Rotation(rr.uniform(-0.08, 0.08), 3, 'X') @ Matrix.Rotation(rr.uniform(-0.05, 0.05), 3, 'Y')
    top = 0.5 - rr.uniform(0.0, 0.1)
    prof = [(-0.46, -0.5), (0.46, -0.5), (0.6, 0.02), (0.32, top), (-0.32, top), (-0.6, 0.02)]
    ends = (rr.uniform(0.55, 0.7), rr.uniform(0.4, 0.6))
    rings = []
    for x, k in ((-0.5, ends[0]), (0.0, 1.0), (0.5, ends[1])):
        rings.append([bm.verts.new(c + R @ V((x * L, py * W * k, pz * H * (0.75 + 0.25 * k)))) for py, pz in prof])
    for i_ in range(2):
        for j in range(1, 6):                       # band 0 (the seat on the bag below) is never seen
            k = (j + 1) % 6
            bm.faces.new((rings[i_][j], rings[i_][k], rings[i_ + 1][k], rings[i_ + 1][j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[2])


def sandbags(p0, p1, rows=4, name='sandbags', thick=2, footprint=True, tint=(1.0, 0.95, 0.85)):
    rr = random.Random(hash(name) % 9973 + int(p0[0] * 10))
    p0, p1 = V((*p0[:2], 0)), V((*p1[:2], 0))
    d = p1 - p0
    Lw = d.length
    d.normalize()
    n = V((d.y, -d.x, 0))
    ang = math.atan2(d.y, d.x)
    bm = bmesh.new()
    zrow = 0.0
    for row in range(rows):
        top = row == rows - 1
        off = rr.uniform(0.15, 0.4) * (row % 2 * 2 - 1) * 0.5 + 0.3 * (row % 2)
        x = off - 0.3 + rr.uniform(-0.05, 0.05)
        hrow = rr.uniform(0.13, 0.16)
        while x < Lw - 0.25:
            bl = rr.uniform(0.52, 0.66)
            for t in range(thick):
                if top and thick > 1 and rr.random() < 0.08:
                    continue                                   # a missing bag on the top course
                cx = min(max(x + bl / 2, 0.3), Lw - 0.3)
                c = p0 + d * cx + n * ((t - (thick - 1) / 2) * 0.34 + rr.uniform(-0.03, 0.03)) + V((0, 0, zrow + hrow * 0.5 + rr.uniform(-0.01, 0.015)))
                bag_bm(bm, c, bl, 0.33, hrow * 1.12, ang + rr.uniform(-0.1, 0.1) + (math.pi if rr.random() < 0.5 else 0), rr)
            x += bl + rr.uniform(-0.03, 0.02)
        zrow += hrow * 0.92
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = K.part(bm, 'burlap_bag', name=name, grime=0.7, mat_tint=tint, bisect=False, smooth=True)
    if footprint:
        w = 0.34 * thick / 2 + 0.05
        C.footprint([tuple(p0 - n * w)[:2], tuple(p1 - n * w)[:2], tuple(p1 + n * w)[:2], tuple(p0 + n * w)[:2]], 'LOW', 'sandbags')
    return o


# ------------------------------------------------------------------ sand: low wind ramps that feather into the ground
def sand_drift(p0, p1, n, h=0.3, w=0.9, seed=0, name='sand'):
    p0, p1, n = V((*p0[:2], 0)), V((*p1[:2], 0)), V((*n[:2], 0)).normalized()
    L = (p1 - p0).length
    ns = max(4, int(L / 1.4))
    from mathutils import noise
    h, w = h * 0.55, w * 1.5
    rings = []
    for i in range(ns + 1):
        u = i / ns
        taper = math.sin(math.pi * u) ** 0.8
        k = (0.55 + 0.9 * max(0.0, noise.noise(V((u * L * 0.9 + seed, seed * 1.3, 0))) + 0.3)) * taper
        c = p0.lerp(p1, u)
        hh, ww = h * max(0.02, k), w * max(0.3, k)
        prof = [(-0.04, -0.03), (-0.04, hh), (ww * 0.15, hh * 0.8), (ww * 0.4, hh * 0.42), (ww * 0.7, hh * 0.14), (ww, -0.03)]
        rings.append([c + n * a + V((0, 0, z)) for a, z in prof])
    bm = bmesh.new()
    C.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'sand', name=name, grime=0, smooth=True, bisect=False, lod='drop', mat_tint=(0.97, 0.95, 0.93))


# ------------------------------------------------------------------ debris mound: soft toe, lumpy crest, no rim
def mound_bm(c, rx, ry, h, seed=0, rings=6, segs=18, slump=(0, 0)):
    from mathutils import noise as N
    bm = bmesh.new()
    c = V(c)
    rings = max(rings, 6) if h > 0.2 else rings
    rows = []
    for i in range(rings + 1):
        t = i / rings                                       # 0 = toe, 1 = crest
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            k = 1 + 0.42 * N.noise(V((math.cos(a) * 1.3 + seed, math.sin(a) * 1.3, t * 1.5))) + 0.12 * N.noise(V((math.cos(a) * 4 + seed, math.sin(a) * 4, 2.0)))
            rr = (1 - t) * k
            prof = (1 - (1 - t) ** 2) ** 1.6 if t < 1 else 1.0  # zero slope at the toe
            lump = 0.75 + 0.5 * N.noise(V((math.cos(a) * rr * 2.6 + seed, math.sin(a) * rr * 2.6, seed * 0.3)))
            z = h * prof * lump
            row.append(bm.verts.new(c + V((math.cos(a) * rx * rr * 1.15 + slump[0] * t, math.sin(a) * ry * rr * 1.15 + slump[1] * t, z - 0.05))))
        rows.append(row)
    for i in range(rings):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mound_h(c, rx, ry, h, x, y):
    """Approximate mound surface height at (x, y) for placing debris."""
    dd = math.sqrt(((x - c[0]) / (rx * 1.15)) ** 2 + ((y - c[1]) / (ry * 1.15)) ** 2)
    t = max(0.0, 1 - dd)
    return h * (1 - (1 - t) ** 2) ** 1.6


def rubble_mud(c, rx, ry, h, seed=0, bricks=34, logs=2, reeds=2, name='rub', footprint=True, slump=(0, 0)):
    """Slumped mud-brick collapse, round 2: lumpy soft-toed mound + a wide flat earth spill that melts into the
    ground, bricks SUNK into the slope at random tilts (whole, halves, bonded clumps), fist-to-head sized clods,
    broken palm joists and torn matting."""
    rr = random.Random(seed * 13 + 5)
    c = V(c)
    bm = mound_bm(c, rx, ry, h, seed, 7, 20, slump)
    K.part(bm, 'mud_render2', name=name + '_mound', smooth=True, grime=0.7, mat_tint=(0.97, 0.94, 0.92), lod='keep')

    def place(dmax=1.0):
        a, dd = rr.uniform(0, 2 * math.pi), math.sqrt(rr.random()) * dmax
        x, y = c.x + math.cos(a) * rx * dd + slump[0] * (1 - dd), c.y + math.sin(a) * ry * dd + slump[1] * (1 - dd)
        return x, y, mound_h(c, rx, ry, h, x, y) * 0.95

    def bricks_fn(bm):
        for i in range(int(bricks * 1.3)):
            x, y, z = place(1.08)
            if i % 9 == 0:
                rot, tilt = rr.uniform(0, math.pi), rr.uniform(-0.7, 0.7)
                for bx in range(rr.randint(2, 3)):
                    for bz in range(rr.randint(1, 3)):
                        o = V((x, y, z - 0.03)) + Matrix.Rotation(rot, 3, 'Z') @ V(((bx - 1 + 0.5 * (bz % 2)) * 0.37, 0, bz * 0.11 * math.cos(tilt)))
                        dz.chunk_bm(bm, o, (0.35, 0.17, 0.1), (tilt, rr.uniform(-0.2, 0.2), rot), seed + i, 0.15)
            else:
                half = rr.random() < 0.4
                sz = (rr.uniform(0.15, 0.2) if half else rr.uniform(0.3, 0.37), 0.17, rr.uniform(0.08, 0.11))
                dz.chunk_bm(bm, (x, y, z - sz[2] * rr.uniform(0.1, 0.5)), sz,
                            (rr.uniform(-1.1, 1.1), rr.uniform(-1.1, 1.1), rr.uniform(0, 3.14)), seed + i, 0.4)
    dz._merge_part(bricks_fn, 'mudbrick', name + '_bricks', grime=0.6, mat_tint=(0.92, 0.86, 0.8))

    def clods_fn(bm):
        for i in range(int(bricks * 1.1)):
            x, y, z = place(1.3)
            s = rr.uniform(0.06, 0.2)
            dz.chunk_bm(bm, (x, y, z - s * 0.3), (s * rr.uniform(0.8, 1.4), s, s * rr.uniform(0.5, 0.9)),
                        (rr.uniform(-0.8, 0.8), rr.uniform(-0.8, 0.8), rr.uniform(0, 3.14)), seed + 100 + i, 0.6)
    dz._merge_part(clods_fn, 'mud_render2', name + '_clods', grime=0.6, mat_tint=(0.9, 0.85, 0.8), lod='drop')
    if logs:
        def logs_fn(bm):
            for i in range(logs):
                a = rr.uniform(0, math.pi)
                L = rr.uniform(1.4, 2.6)
                x, y, z = place(0.5)
                p = V((x, y, z + 0.05))
                dd = V((math.cos(a), math.sin(a), rr.uniform(-0.3, 0.3))).normalized()
                dz.broken_log(bm, p - dd * L / 2, p + dd * L / 2, rr.uniform(0.08, 0.11), 7)
        dz._merge_part(logs_fn, 'palm_log', name + '_logs', uv='beam', axis=(1, 0, 0), grime=0.6)
    for k in range(reeds):
        a = rr.uniform(0, math.pi)
        x, y, z = place(0.6)
        p = V((x, y, z + 0.04))
        bm = bmesh.new()
        w, l = rr.uniform(0.6, 1.0), rr.uniform(0.7, 1.2)
        R = Matrix.Rotation(a, 3, 'Z')
        vv = [[bm.verts.new(p + R @ V(((i / 3 - 0.5) * l, (j / 2 - 0.5) * w, 0.1 * math.sin(i * 1.3 + j) + rr.uniform(-0.04, 0.04))))
               for j in range(3)] for i in range(4)]
        for i in range(3):
            for j in range(2):
                bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
        K.part(bm, 'roof_thatch', name='%s_reed%d' % (name, k), grime=0.5, mat_tint=(0.8, 0.72, 0.6), lod='drop')
    decal_dz('dust_wash', tuple(c + V((0, 0, 0.1))), (0, 0, 1), rx * 2.8, ry * 2.8, up=(0, 1, 0), alpha=0.45)
    if footprint:
        C.footprint([(c.x + math.cos(a) * rx * 0.85, c.y + math.sin(a) * ry * 0.85) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')



# ------------------------------------------------------------------ palm-frond / reed-mat cards (alpha-tested atlas)
FROND_CELLS = {'dry': (0.0, 0.25), 'brown': (0.25, 0.5), 'olive': (0.5, 0.75), 'reed': (0.75, 1.0)}


def card_bm(bm, p0, p1, width, droop=0.1, segs=4, twist=0.0, cell='dry', flipu=False, taper=None):
    """Bent alpha card from p0 (petiole, v=0) to p1 (tip, v=1), `width` across; UVs into the frond atlas cell."""
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0)
    L = d.length
    d.normalize()
    s = V((0, 0, 1)).cross(d)
    if s.length < 1e-4:
        s = V((1, 0, 0))
    s.normalize()
    u0, u1 = FROND_CELLS[cell]
    if flipu:
        u0, u1 = u1, u0
    uv = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    rows = []
    for j in range(segs + 1):
        t = j / segs
        c = p0 + d * (L * t) - V((0, 0, droop * (t ** 1.6) * 1.0))
        ww = width * (0.55 + 0.45 * math.sin(math.pi * min(0.97, 0.15 + 0.85 * t))) if (taper if taper is not None else cell != 'reed') else width
        tw = V((0, 0, twist * t))
        rows.append((bm.verts.new(c - s * ww / 2 - tw), bm.verts.new(c + s * ww / 2 + tw), t))
    for j in range(segs):
        a, b = rows[j], rows[j + 1]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        for l, (uu, vv) in zip(f.loops, ((u0, a[2]), (u1, a[2]), (u1, b[2]), (u0, b[2]))):
            l[uv].uv = (uu, vv)


def _frame(x0, y0, x1, y1, z, rr, pole_step=0.55, mid='palm_log'):
    bm = bmesh.new()
    nx = 2 if x1 - x0 < 3.5 else 3
    for i in range(nx):
        x = x0 + (x1 - x0) * i / (nx - 1)
        for y in (y0, y1):
            C.cyl_bm(bm, (x, y, 0), (x + rr.uniform(-0.05, 0.05), y + rr.uniform(-0.04, 0.04), z), rr.uniform(0.08, 0.1), 7, caps=False)
    for y in (y0, y1):
        C.cyl_bm(bm, (x0 - 0.25, y, z + 0.07), (x1 + 0.25, y + rr.uniform(-0.05, 0.05), z + 0.07 + rr.uniform(-0.04, 0.04)), 0.09, 6)
    k = int((x1 - x0 + 0.4) / pole_step)
    for i in range(k):
        x = x0 - 0.2 + (x1 - x0 + 0.4) * (i + 0.5) / k
        C.cyl_bm(bm, (x, y0 - 0.3, z + 0.2), (x + rr.uniform(-0.08, 0.08), y1 + 0.3, z + 0.2), 0.045, 5)
    return bm


def frond_shade(x0, y0, x1, y1, z, name='shade', seed=0, cells=('dry', 'dry', 'brown')):
    """Palm-log arbour roofed with overlapping palm fronds: alpha-tested pinnate frond cards (midrib + splayed
    leaflets, gaps, broken tips) laid across the poles, drooping at the ends, a few hanging over the edge."""
    rr = random.Random(seed * 7 + int(x0 * 10) + 3)
    K.part(_frame(x0, y0, x1, y1, z, rr), 'palm_log', name=name + '_frame', uv='beam', axis=(0, 0, 1), grime=0.5)
    bm = bmesh.new()
    y = y0 - 0.45
    i = 0
    while y < y1 + 0.45:
        for layer in range(2):
            a = rr.uniform(-0.35, 0.35) + (math.pi if (i + layer) % 2 else 0)
            L = rr.uniform(2.3, 3.2)
            xc = (x0 + x1) / 2 + rr.uniform(-0.5, 0.5) * (x1 - x0) * 0.5
            d = V((math.cos(a), math.sin(a), 0))
            zc = z + 0.26 + 0.04 * layer + rr.uniform(0, 0.03)
            p0 = V((xc, y + rr.uniform(-0.08, 0.08), zc)) - d * L / 2
            card_bm(bm, p0, p0 + d * L + V((0, 0, rr.uniform(-0.05, 0.05))), rr.uniform(0.75, 1.0), droop=rr.uniform(0.12, 0.3),
                    cell=rr.choice(cells), flipu=rr.random() < 0.5)
        y += rr.uniform(0.32, 0.45)
        i += 1
    for k in range(3):                        # fronds slipped over the edges
        side = rr.choice((-1, 1))
        yy = (y0 - 0.5) if side < 0 else (y1 + 0.5)
        x = rr.uniform(x0, x1)
        card_bm(bm, (x, (y0 + y1) / 2 + (yy - (y0 + y1) / 2) * 0.6, z + 0.32), (x + rr.uniform(-0.4, 0.4), yy, z - 0.2), rr.uniform(0.6, 0.9),
                droop=0.25, cell=rr.choice(cells))
    K.part(bm, 'palm_frond_dz', name=name + '_fronds', uv='keep', grime=0.2, bisect=False, lod='keep')


def shade(x0, y0, x1, y1, z, mid_posts='timber_beam', name='shade', seed=1):
    """Arbour roofed with rolled-out cane / reed mats (alpha-tested strips with gaps + ragged ends) over poles,
    plus a couple of fronds laid on top as weights."""
    rr = random.Random(seed * 5 + 11)
    K.part(_frame(x0, y0, x1, y1, z, rr, 0.45), 'palm_log', name=name + '_frame', uv='beam', axis=(0, 0, 1), grime=0.5)
    bm = bmesh.new()
    n = max(2, int((x1 - x0 + 0.6) / 0.95))
    for k in range(n):
        x = x0 - 0.3 + (x1 - x0 + 0.6) * (k + 0.5) / n + rr.uniform(-0.05, 0.05)
        card_bm(bm, (x, y0 - 0.45 - rr.uniform(0, 0.15), z + 0.26), (x + rr.uniform(-0.1, 0.1), y1 + 0.45 + rr.uniform(0, 0.2), z + 0.26),
                1.0, droop=rr.uniform(0.02, 0.06), segs=3, cell='reed')
    for k in range(2):
        x = rr.uniform(x0, x1)
        card_bm(bm, (x, y0 - 0.2, z + 0.3), (x + rr.uniform(-0.6, 0.6), y1 + 0.3, z + 0.3), 0.8, droop=0.15, cell='dry')
    K.part(bm, 'palm_frond_dz', name=name + '_mats', uv='keep', grime=0.2, bisect=False, lod='keep')


def qubba(c, base_w, z0, r=1.3, tint=None, mid='plaster_limewash', name='qubba', finial=True):
    """Tunisian qubba over a square room: square plastered base block with a two-step moulded cornice, an
    octagonal drum with four small arched vents and a torus-like base moulding, then a smooth, slightly pointed
    lime dome (24 x 9) and a brass finial. Returns the dome top z."""
    cx, cy = c[:2]
    bm = bmesh.new()
    C.box_bm(bm, (cx, cy, z0 + 0.3), (base_w, base_w, 0.6))
    C.box_bm(bm, (cx, cy, z0 + 0.63), (base_w + 0.12, base_w + 0.12, 0.08))
    C.box_bm(bm, (cx, cy, z0 + 0.71), (base_w + 0.04, base_w + 0.04, 0.08))
    K.part(bm, mid, name=name + '_base', mat_tint=tint)
    zd = z0 + 0.75
    rd = r + 0.12
    bm = bmesh.new()
    oct_ = [(cx + rd * math.cos(math.pi / 8 + k * math.pi / 4), cy + rd * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    C.prism_bm(bm, oct_, zd, zd + 0.55)
    oct2 = [(cx + (rd + 0.06) * math.cos(math.pi / 8 + k * math.pi / 4), cy + (rd + 0.06) * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    C.prism_bm(bm, oct2, zd + 0.55, zd + 0.63)
    K.part(bm, mid, name=name + '_drum', mat_tint=tint)
    bm = bmesh.new()                                  # four small arched vents (dark insets) on the drum faces
    for k in (0, 2, 4, 6):
        a = math.pi / 8 + k * math.pi / 4 + math.pi / 8
        n = V((math.cos(a), math.sin(a), 0))
        rr = V((-n.y, n.x, 0))
        o = V((cx, cy, zd + 0.12)) + n * (rd * math.cos(math.pi / 8) + 0.004)
        pts = [o - rr * 0.1, o + rr * 0.1, o + rr * 0.1 + V((0, 0, 0.2))] + \
              [o + rr * 0.1 * math.cos(t * math.pi / 6) + V((0, 0, 0.2 + 0.1 * math.sin(t * math.pi / 6))) for t in range(1, 6)] + \
              [o - rr * 0.1 + V((0, 0, 0.2))]
        bm.faces.new([bm.verts.new(p) for p in pts])
    K.part(bm, 'interior_dark', name=name + '_vents', grime=0, bisect=False, lod='drop')
    segs, rings = 24, 9
    zb = zd + 0.63
    bm = bmesh.new()
    rows = [[V((cx + (r + 0.02) * math.cos(2 * math.pi * i / segs), cy + (r + 0.02) * math.sin(2 * math.pi * i / segs), zb)) for i in range(segs)],
            [V((cx + (r + 0.06) * math.cos(2 * math.pi * i / segs), cy + (r + 0.06) * math.sin(2 * math.pi * i / segs), zb + 0.07)) for i in range(segs)],
            [V((cx + r * math.cos(2 * math.pi * i / segs), cy + r * math.sin(2 * math.pi * i / segs), zb + 0.13)) for i in range(segs)]]
    for k in range(1, rings + 1):
        a = (math.pi / 2) * k / (rings + 0.2)
        rad = r * math.cos(a)
        z = zb + 0.13 + r * math.sin(a) * 1.02 + 0.18 * r * (math.sin(a) ** 6)      # gentle point at the crown
        rows.append([V((cx + rad * math.cos(2 * math.pi * i / segs), cy + rad * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    C.loft_bm(bm, rows, close_start=False, close_end=False)
    top = V((cx, cy, zb + 0.13 + r * 1.02 + 0.18 * r + 0.02))
    last = [v for v in bm.verts][-segs:]
    tv = bm.verts.new(top)
    for i in range(segs):
        bm.faces.new((last[i], last[(i + 1) % segs], tv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name, smooth=True, mat_tint=tint, lod='keep', bisect=False, grime=0.5)
    if finial:
        bm = bmesh.new()
        C.cyl_bm(bm, top - V((0, 0, 0.05)), top + V((0, 0, 0.45)), 0.022, 6)
        for zz, rad in ((0.1, 0.06), (0.22, 0.05), (0.33, 0.04)):
            C.cyl_bm(bm, top + V((0, 0, zz - rad)), top + V((0, 0, zz + rad)), rad, 8, r1=rad * 0.4)
        K.part(bm, 'steel_galv', name=name + '_finial', mat_tint=(1.1, 0.95, 0.6), smooth=True, grime=0.2)
    decal_dz('grime_a', tuple(V((cx, cy - base_w / 2 - 0.004, z0 + 0.35))), (0, -1, 0), base_w * 0.8, 0.7, alpha=0.3)
    return top.z


# ------------------------------------------------------------------ broken concrete: jagged slabs + rebar, stone rubble v2
def jag_line(p0, p1, amp=0.18, step=0.22, seed=0):
    """Points from p0 to p1 (2D) with a zig-zag broken edge (perpendicular offsets up to amp)."""
    rr = random.Random(seed)
    p0, p1 = V((p0[0], p0[1], 0)), V((p1[0], p1[1], 0))
    d = p1 - p0
    L = d.length
    n = V((-d.y, d.x, 0)).normalized()
    k = max(2, int(L / step))
    out = []
    for i in range(k + 1):
        t = i / k
        off = 0.0 if i in (0, k) else rr.uniform(-amp, amp) * (0.5 + 0.5 * math.sin(t * math.pi))
        q = p0 + d * t + n * off
        out.append((q.x, q.y))
    return out


def jagged_slab(bm, c, w, d, t, rot, seed=0, broken=(0, 1, 2, 3), amp=0.2):
    """Broken slab piece: rectangle whose `broken` sides are jagged, extruded t, rotated rot=(rx, ry, rz) about c.
    Returns world points along the broken edges (mid-thickness) for rebar."""
    rr = random.Random(seed)
    cs = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    pts, edge_pts = [], []
    for e in range(4):
        a, b = cs[e], cs[(e + 1) % 4]
        seg = jag_line(a, b, amp, 0.2, seed * 7 + e) if e in broken else [a, b]
        pts += seg[:-1]
        if e in broken:
            edge_pts += seg[1:-1:2]
    R = Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X')
    c = V(c)
    lo = [bm.verts.new(c + R @ V((x, y, -t / 2 + rr.uniform(-0.02, 0.02)))) for x, y in pts]
    hi = [bm.verts.new(c + R @ V((x, y, t / 2))) for x, y in pts]
    bm.faces.new(hi)
    bm.faces.new(lo[::-1])
    m = len(pts)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return [c + R @ V((x, y, 0.0)) for x, y in edge_pts], R


def slab_with_rebar(c, w, d, t, rot, seed=0, broken=(0, 1, 2), mid='screed_lime', tint=(0.9, 0.87, 0.82), name='slab', nbar=8):
    bm = bmesh.new()
    ep, R = jagged_slab(bm, c, w, d, t, rot, seed, broken)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, mid, name=name, mat_tint=tint, grime=0.6)
    rr = random.Random(seed + 3)
    bm = bmesh.new()
    cc = V(c)
    for p in rr.sample(ep, min(nbar, len(ep))):
        out = (p - cc)
        out.z = 0
        out = out.normalized() if out.length > 1e-4 else V((1, 0, 0))
        dz.rebar_bm(bm, p, p + out * rr.uniform(0.3, 0.7) + V((0, 0, rr.uniform(-0.35, 0.1))), rr.uniform(-0.4, 0.6), r=0.014)
    K.part(bm, 'cast_iron', name=name + '_rebar', grime=0.1, mat_tint=(0.5, 0.3, 0.18), bisect=False)


def rubble_stone(c, rx, ry, h, seed=0, blocks=26, slabs=3, beams=2, rebar=4, plaster=10, name='rub', footprint=True,
                 stone='ashlar_limestone', dust_tint=(0.86, 0.82, 0.76), slump=(0, 0)):
    """Round 2: fractured-concrete / limestone heap with a soft toe (no smooth pink blob): mound in exposed
    aggregate, many sunk and tilted dressed blocks, render/plaster sheets, jagged screed slabs with rebar, clods,
    snapped beams, pale dust spill."""
    rr = random.Random(seed * 17 + 1)
    c = V(c)
    bm = mound_bm(c, rx, ry, h, seed, 6, 12, slump)
    K.part(bm, 'concrete_aggregate', name=name + '_mound', smooth=True, grime=0.5, mat_tint=(0.95, 0.92, 0.87), lod='keep')

    def place(dmax=1.0):
        a, dd = rr.uniform(0, 2 * math.pi), math.sqrt(rr.random()) * dmax
        x, y = c.x + math.cos(a) * rx * dd, c.y + math.sin(a) * ry * dd
        return x, y, mound_h(c, rx, ry, h, x, y) * 0.95

    def blocks_fn(bm):
        for i in range(int(blocks * 1.2)):
            x, y, z = place(1.1)
            sc = rr.uniform(0.5, 1.3)
            sz = (0.42 * sc, 0.26 * sc, 0.22 * sc)
            dz.chunk_bm(bm, (x, y, z - sz[2] * rr.uniform(0.1, 0.5)), sz, (rr.uniform(-0.9, 0.9), rr.uniform(-0.9, 0.9), rr.uniform(0, 3.14)), seed + i, 0.45)
    dz._merge_part(blocks_fn, stone, name + '_blocks', grime=0.7, mat_tint=(0.97, 0.95, 0.9))

    def clods_fn(bm):
        for i in range(int(blocks * 0.8)):
            x, y, z = place(1.3)
            sc = rr.uniform(0.06, 0.18)
            dz.chunk_bm(bm, (x, y, z - sc * 0.3), (sc * 1.3, sc, sc * 0.7), (rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(0, 3.14)), seed + 200 + i, 0.6)
    dz._merge_part(clods_fn, 'rubble_stone', name + '_clods', grime=0.6, mat_tint=(1.0, 0.97, 0.92), lod='drop')
    if plaster:
        def pl_fn(bm):
            for i in range(plaster):
                x, y, z = place(1.05)
                jagged_slab(bm, (x, y, z + 0.02), rr.uniform(0.3, 0.7), rr.uniform(0.25, 0.5), 0.05,
                            (rr.uniform(-0.6, 0.6), rr.uniform(-0.6, 0.6), rr.uniform(0, 3.14)), seed + 50 + i, amp=0.07)
        dz._merge_part(pl_fn, 'limewash_worn', name + '_plaster', grime=0.4)
    for i in range(slabs):
        a = rr.uniform(0, 2 * math.pi)
        x, y = c.x + math.cos(a) * rx * 0.35, c.y + math.sin(a) * ry * 0.35
        slab_with_rebar((x, y, mound_h(c, rx, ry, h, x, y) * 0.8 + 0.1), rr.uniform(1.0, 1.7), rr.uniform(0.8, 1.3), 0.16,
                        (rr.uniform(-0.5, 0.5), rr.uniform(-0.5, 0.5), a), seed + 90 + i, name='%s_slab%d' % (name, i), nbar=max(2, rebar))
    if beams:
        def bm_fn(bm):
            for i in range(beams):
                a = rr.uniform(0, math.pi)
                L = rr.uniform(1.5, 2.8)
                x, y, z = place(0.5)
                p = V((x, y, z + 0.1))
                dd = V((math.cos(a), math.sin(a), rr.uniform(-0.3, 0.3))).normalized()
                C.beam_bm(bm, p - dd * L / 2, p + dd * L / 2, 0.14, 0.2, roll=rr.uniform(0, 0.5))
                o = p + dd * L / 2
                for k in range(3):
                    C.cyl_bm(bm, o + V((0, 0, (k - 1) * 0.05)), o + dd * rr.uniform(0.1, 0.25) + V((0, 0, (k - 1) * 0.06)), 0.03, 4, r1=0.004)
        dz._merge_part(bm_fn, 'timber_beam', name + '_beams', uv='beam', axis=(1, 0, 0), grime=0.6)
    decal_dz('dust_wash', tuple(c + V((0, 0, 0.09))), (0, 0, 1), rx * 3.0, ry * 3.0, up=(0, 1, 0), alpha=0.5)
    if footprint:
        C.footprint([(c.x + math.cos(a) * rx * 0.85, c.y + math.sin(a) * ry * 0.85) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


def flag_balken(anchor_top, w=1.5, h=1.0, name='flag', wave=0.12, seed=0):
    """Round 2: the cross sat INSIDE the solidified cloth (blank grey card). Cloth is now a single-sided-per-face
    double quad set 0.004 apart, the Balkenkreuz 2 cm proud on both faces and larger."""
    top = V(anchor_top)
    nx, ny = 8, 5

    def P(u, v):
        return top + V((0.06 + u * w, wave * math.sin(u * 5.0 + seed) * u, -v * h - 0.05 * u * u))
    bm = bmesh.new()
    vv = [[bm.verts.new(P(i / nx, j / ny)) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vv[i][j], vv[i][j + 1], vv[i + 1][j + 1], vv[i + 1][j]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.006)
    K.part(bm, 'canvas', name=name + '_cloth', node=name, mat_tint=(0.56, 0.6, 0.52), smooth=True, grime=0.2, bisect=False)

    def cross(bm, s, off):
        cu, cv = 0.45, 0.5
        for (u0, u1, v0, v1) in ((cu - s * 0.1, cu + s * 0.1, cv - s * 0.38, cv + s * 0.38), (cu - s * 0.3, cu + s * 0.3, cv - s * 0.13, cv + s * 0.13)):
            for side in (-1, 1):
                q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]
                dd = V((0, side * (0.02 + off) - (0.003 if side < 0 else 0), 0))
                bm.faces.new([bm.verts.new(p + dd) for p in (q if side > 0 else q[::-1])])
    bw_, bb_ = bmesh.new(), bmesh.new()
    cross(bw_, 1.0, 0.0)
    cross(bb_, 0.68, 0.004)
    K.part(bw_, 'canvas', name=name + '_x_w', node=name, mat_tint=(0.97, 0.97, 0.95), grime=0, bisect=False)
    K.part(bb_, 'canvas', name=name + '_x_b', node=name, mat_tint=(0.1, 0.1, 0.1), grime=0, bisect=False)


# ------------------------------------------------------------------ fire / blast damage v2
def burst_drum_bm(bm, c, r_=0.29, h=0.88, seed=0, lying=False, axis=(1, 0, 0)):
    """200 l drum after a fuel fire: straight steel body with rolling hoops, domed (pressure-bulged) end, a dent,
    and ONE side torn open along a seam with 3-4 short petals peeled outward (no all-round starburst)."""
    rr = random.Random(seed * 31 + 7)
    c = V(c)
    if lying:
        ax = V(axis).normalized()
        base, up = c + V((0, 0, r_)) - ax * h / 2, ax
    else:
        base, up = c, V((0, 0, 1))
    s = up.orthogonal().normalized()
    t = up.cross(s)
    segs = 12
    tear = rr.randrange(segs)
    dent = rr.randrange(segs)

    def ring(z, rad, k0=0.0):
        out = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            rk = rad * (0.86 if (k - dent) % segs == 0 and 0.2 < z / h < 0.8 else 1.0)
            out.append(base + up * z + (s * math.cos(a) + t * math.sin(a)) * rk)
        return out
    zs = [(0.0, r_), (0.3 * h, r_ * 1.02), (0.33 * h, r_ * 1.05), (0.36 * h, r_ * 1.02), (0.63 * h, r_ * 1.03), (0.66 * h, r_ * 1.06),
          (0.69 * h, r_ * 1.03), (h, r_)]
    rings = [ring(z, rad) for z, rad in zs]
    vs = [[bm.verts.new(p) for p in rg] for rg in rings]
    for i_ in range(len(vs) - 1):
        for k in range(segs):
            if k == tear and 0.25 < zs[i_][0] / h < 0.9:
                continue                                   # the split
            j = (k + 1) % segs
            bm.faces.new((vs[i_][k], vs[i_][j], vs[i_ + 1][j], vs[i_ + 1][k]))
    bm.faces.new(vs[0][::-1])
    cap = bm.verts.new(base + up * (h + r_ * 0.35))        # pressure-domed lid
    for k in range(segs):
        bm.faces.new((vs[-1][k], vs[-1][(k + 1) % segs], cap))
    a0 = 2 * math.pi * (tear + 0.5) / segs
    out = (s * math.cos(a0) + t * math.sin(a0))
    for q in range(rr.randint(3, 4)):                      # petals along the split, bent outward
        z0, z1 = h * (0.3 + 0.15 * q), h * (0.42 + 0.15 * q)
        side = (s * math.cos(a0 + 0.3) + t * math.sin(a0 + 0.3)) * (1 if q % 2 else -1)
        a_ = base + up * z0 + out * r_
        b_ = base + up * z1 + out * r_
        tip = (a_ + b_) / 2 + out * rr.uniform(0.08, 0.2) + side * rr.uniform(0.04, 0.12)
        va = [bm.verts.new(a_), bm.verts.new(b_), bm.verts.new(tip)]
        bm.faces.new(va)
        bm.faces.new([bm.verts.new(a_ + out * 0.004), bm.verts.new(tip + out * 0.004), bm.verts.new(b_ + out * 0.004)])


def crumpled_sheet(bm, c, ang, w=0.9, l=1.8, seed=0, lean=None):
    """Blown-off corrugated sheet lying on the ground: real corrugation, crumpled (noise) and folded, never floating.
    lean=(p_top) props one end up against something."""
    from mathutils import noise as N
    rr = random.Random(seed)
    c = V(c)
    u = V((math.cos(ang), math.sin(ang), 0))
    v = V((-math.sin(ang), math.cos(ang), 0))
    b0 = len(bm.verts)
    dz.corrugated_bm(bm, c - u * w / 2 - v * l / 2, u, v if lean is None else (V(lean) - c).normalized(), w, l, 0.15, 0.02,
                     bend=rr.uniform(0.0, 0.35), twist=rr.uniform(-0.3, 0.3), nrows=5, under=False)
    bm.verts.ensure_lookup_table()
    fold = rr.uniform(-0.2, 0.3)                 # folded / kinked across the sheet + strong crumple noise
    fang = math.tan(math.radians(rr.uniform(25, 55)))
    for vtx in bm.verts[b0:]:
        q = vtx.co
        k = N.noise(V((q.x * 2.3 + seed, q.y * 2.3, 0.3)))
        along = (q - c).dot(v) / l
        vtx.co.z += 0.16 * k + (max(0.0, along - fold) * l * fang * 0.6 if lean is None else 0)
        vtx.co.z = max(0.02, vtx.co.z)


def crater(c, r_=2.4, depth_col=(0.3, 0.28, 0.26), seed=0, name='crater'):
    """Blast crater, round 2: lumpy ejecta rim with thrown clods and slab fragments, scorched bowl (irregular soft
    scorch cells) and uneven radial scorch tongues - no smooth blob."""
    from mathutils import noise as N
    rr = random.Random(seed * 3 + 11)
    c = V(c)
    bm = bmesh.new()
    segs = 28
    rings = []
    for rad, z in ((r_ * 0.5, 0.02), (r_ * 0.75, 0.16), (r_ * 0.92, 0.3), (r_ * 1.1, 0.2), (r_ * 1.35, 0.07), (r_ * 1.7, -0.02)):
        row = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            wob = 1 + 0.16 * N.noise(V((math.cos(a) * 2 + seed, math.sin(a) * 2, rad)))
            row.append(c + V((math.cos(a) * rad * wob, math.sin(a) * rad * wob, z * (0.6 + 0.8 * rr.random()))))
        rings.append(row)
    C.loft_bm(bm, rings, close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'sand', name=name + '_rim', smooth=True, grime=0.4, mat_tint=(0.84, 0.77, 0.68), lod='keep')

    def clods(bm):
        for k in range(40):
            a, d = rr.uniform(0, 6.283), r_ * rr.uniform(0.7, 2.2)
            sc = rr.uniform(0.07, 0.22) * (1.3 - 0.4 * d / (2.2 * r_))
            dz.chunk_bm(bm, (c.x + math.cos(a) * d, c.y + math.sin(a) * d, sc * 0.3), (sc * 1.3, sc, sc * 0.7),
                        (rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(0, 3.14)), seed + k, 0.6)
    dz._merge_part(clods, 'concrete_aggregate', name + '_clods', grime=0.6, mat_tint=(0.9, 0.84, 0.76), lod='drop')
    decal_dz('scorch_a', tuple(c + V((0, 0, 0.04))), (0, 0, 1), r_ * 2.0, r_ * 2.0, up=(0, 1, 0), alpha=0.95)
    decal_dz('ash', tuple(c + V((0, 0, 0.045))), (0, 0, 1), r_ * 1.3, r_ * 1.3, up=(1, 0.4, 0), alpha=0.7)
    for k in range(7):
        a = 2 * math.pi * k / 7 + rr.uniform(-0.3, 0.3)
        d = V((math.cos(a), math.sin(a), 0))
        L = rr.uniform(1.8, 3.8)
        decal_dz('scorch_b', tuple(c + d * (r_ * 0.9 + L / 2) + V((0, 0, 0.05 + 0.001 * k))), (0, 0, 1), rr.uniform(0.9, 1.6), L, up=tuple(d), alpha=0.6)

for _n in ('roof_patches', 'lime_patch', 'spall2', 'sandbags', 'sand_drift', 'mound_bm', 'rubble_mud', 'frond_shade', 'shade', 'rubble_stone', 'flag_balken', 'burst_drum_bm', 'crater'):
    setattr(dz, _n, globals()[_n])
dz.crumpled_sheet, dz.jag_line, dz.jagged_slab, dz.slab_with_rebar, dz.qubba, dz.card_bm, dz.jars, dz.jar_bm, dz.repair_patch, dz.decal_dz, dz.bag_bm, dz.mound_h = crumpled_sheet, jag_line, jagged_slab, slab_with_rebar, qubba, card_bm, jars, jar_bm, repair_patch, decal_dz, bag_bm, mound_h

# ------------------------------------------------------------------ shape-preserving LODs (lodfix.py)
import lodfix
lodfix.install()
