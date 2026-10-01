# face.py - the periocular region for the HUD eye: the game's MakeHuman (MPFB, CC0) head cropped around the right eye,
# with MakeHuman expression targets as shape keys (blink, wide, squint), a moist lid margin extruded onto the globe,
# caruncle, tear meniscus, strand eyelashes regrown from the lid margin for every lid pose, and strand eyebrow hairs
# scattered over the MPFB eyebrow card. Skin: MPFB albedo + procedural pores, fine wrinkles, SSS, lid-margin flush.
import os, math, random, gzip, bmesh, bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import eyeball as E

SP = os.environ.get('EYE_SCRATCH_ROOT', os.path.dirname(os.environ.get('ICON_SCRATCH', os.path.expanduser('~/.cache/shadow-six/icons')).rstrip('/')))
CHAR = os.environ.get('EYE_CHAR', os.path.join(SP, 'realism', 'characters', 'out', 'mh_beret.blend'))
MPFB = os.environ.get('EYE_MPFB', os.path.join(SP, 'realism', 'characters', 'bl_user', 'extensions', '.user', 'user_default', 'mpfb', 'data'))
TARGETS = os.path.join(MPFB.replace('/.user/', '/'), 'targets', 'expression', 'units', 'caucasian')
SKIN = os.path.join(MPFB, 'skins', 'young_caucasian_male', 'young_lightskinned_male_diffuse.png')
KEYS = {'blink': 'eye-right-closure', 'wide': 'eye-right-opened-up', 'squint': 'eye-right-slit'}
CROP = 0.056


def _target(rel):
    d = {}
    for line in gzip.open(os.path.join(TARGETS, rel + '.target.gz'), 'rt'):
        p = line.split()
        if len(p) != 4 or p[0].startswith('#'): continue
        d[int(p[0])] = Vector((float(p[1]), -float(p[3]), float(p[2]))) * 0.1
    return d


def load():
    """Open the character, return (face object with shape keys, eye centre, eye radius, eyebrow object copy)."""
    bpy.ops.wm.open_mainfile(filepath=CHAR)
    body = bpy.data.objects['Human']
    for m in body.modifiers:
        if m.type == 'MASK': m.show_viewport = m.show_render = False
    dg = bpy.context.evaluated_depsgraph_get()
    low = bpy.data.objects['Human.low-poly']
    pts = [low.matrix_world @ v.co for v in low.evaluated_get(dg).to_mesh().vertices]
    right = [p for p in pts if p.x < 0]
    c, er = sphere_fit(right)                    # the MPFB eye proxy is a sphere (+ corneal bulge points): its globe
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    face = bpy.data.objects.new('face', me); bpy.context.scene.collection.objects.link(face)
    face.matrix_world = body.matrix_world.copy()
    keep_g = body.vertex_groups.get('body').index
    inside = [any(g.group == keep_g for g in v.groups) for v in body.data.vertices]
    face.shape_key_add(name='Basis')
    for k, rel in KEYS.items():
        sk = face.shape_key_add(name=k, from_mix=False)
        for i, dv in _target(rel).items():
            if i < len(sk.data): sk.data[i].co += dv
    brow = bpy.data.objects['Human.eyebrow001']
    bme = bpy.data.meshes.new_from_object(brow.evaluated_get(dg))
    bro = bpy.data.objects.new('browcard', bme); bpy.context.scene.collection.objects.link(bro); bro.matrix_world = brow.matrix_world.copy()
    bimg = None
    for n in (brow.active_material.node_tree.nodes if brow.active_material and brow.active_material.use_nodes else []):
        if n.type == 'TEX_IMAGE' and n.image: bimg = n.image; break
    for o in list(bpy.data.objects):
        if o not in (face, bro): bpy.data.objects.remove(o, do_unlink=True)
    # crop: helpers out, then everything farther than CROP from the eye centre
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    mw = face.matrix_world
    kill = [v for v in bm.verts if not inside[v.index] or (mw @ v.co - c).length > CROP]
    bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(me); bm.free()
    bm = bmesh.new(); bm.from_mesh(bme)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (bro.matrix_world @ v.co - c).length > CROP * 1.4], context='VERTS'); bm.to_mesh(bme); bm.free()
    print('FACE', len(me.vertices), 'eye', tuple(round(x, 4) for x in c), round(er, 4), 'brow img', bimg and bimg.filepath)
    return face, c, er, bro, bimg



def sphere_fit(pts):
    import numpy as np
    P = np.array([tuple(p) for p in pts]); A = np.c_[2 * P, np.ones(len(P))]; b = (P ** 2).sum(1)
    x = np.linalg.lstsq(A, b, rcond=None)[0]; cc = x[:3]
    return Vector(cc.tolist()), float(np.sqrt(x[3] + (cc ** 2).sum()))


class Surf:
    """World-space triangles of the evaluated face (shape keys + subdivision): BVH, barycentric binding, aperture."""
    def __init__(self, face):
        dg = bpy.context.evaluated_depsgraph_get(); ev = face.evaluated_get(dg); me = ev.to_mesh()
        me.calc_loop_triangles(); mw = face.matrix_world
        self.v = [mw @ v.co for v in me.vertices]
        self.t = [tuple(t.vertices) for t in me.loop_triangles]
        self.e = [tuple(e.vertices) for e in me.edges]
        ev.to_mesh_clear()
        self.bvh = BVHTree.FromPolygons(self.v, self.t)

    def frame(self, ti):
        a, b, c = (self.v[i] for i in self.t[ti])
        n = (b - a).cross(c - a).normalized(); t = (b - a).normalized(); return t, n.cross(t), n

    def bind(self, p):
        loc, nrm, ti, d = self.bvh.find_nearest(p)
        a, b, c = (self.v[i] for i in self.t[ti])
        from mathutils.geometry import barycentric_transform
        bc = barycentric_transform(loc, a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        return ti, tuple(bc)

    def at(self, bind):
        ti, bc = bind; a, b, c = (self.v[i] for i in self.t[ti])
        return a * bc[0] + b * bc[1] + c * bc[2]

    def aperture(self, c, r, n=120):
        """Where the skin meets the globe (front half), ordered round the gaze axis: [(angle, point)]."""
        pts = []
        for i, j in self.e:
            p0, p1 = self.v[i], self.v[j]
            d0, d1 = (p0 - c).length - r, (p1 - c).length - r
            if d0 * d1 >= 0: continue
            q = p0 + (p1 - p0) * (d0 / (d0 - d1))
            if q.y - c.y > -r * 0.25: continue
            pts.append(q)
        if len(pts) < 8: return []
        m = sum(pts, Vector()) / len(pts)
        return sorted(((math.atan2(q.z - m.z, q.x - m.x), q) for q in pts), key=lambda t: t[0])


def skin_mat(c, r, name='eye_skin'):
    """Close-up skin. Everything is placed in the rest pose (the baked restp position, and the margin / brow attributes from
    margin_attrs), so pores and lines stay on the skin while the lids move. MPFB albedo (desaturated to a natural
    tone) with blotchy redness; pores (cellular), fine crossing micro-wrinkles, crow's-feet, under-eye arcs; on the
    upper lid fine crinkles parallel to the margin and the lid crease; a faint brow shadow; SSS and oily/rough
    specular breakup. Only a narrow band along the lid margin is wet and pink."""
    T = E.N(name); k = r / 0.012                                                      # MakeHuman globe -> real mm
    def attr(nm, out='Fac'): return T.n('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=nm).outputs[out]
    P0 = attr('restp', 'Vector')                                                      # rest pose: masks ride with the lids
    P = T.obj()            # fine detail in the posed skin: a shut lid stretches its little rest area, so rest-pose pores would smear
    mup, mlo, brow = attr('mup'), attr('mlo'), attr('brow')
    im = bpy.data.images.load(SKIN, check_existing=True)
    tx = T.n('ShaderNodeTexImage', image=im, interpolation='Cubic')
    mrg = T.m_('MINIMUM', mup, mlo)
    rim = T.m_('SUBTRACT', 1.0, T.smooth(mrg, 0.00045 * k, 0.0015 * k))             # wet lid margin, ~1 mm
    upper = T.smooth(T.m_('SUBTRACT', mlo, mup), 0.0, 0.002 * k)                       # 1 on the upper lid
    d = T.m_('SUBTRACT', T.v_('LENGTH', T.v_('SUBTRACT', P0, tuple(c))), r)         # rest distance outside the globe
    rel = T.v_('SUBTRACT', P0, tuple(c)); s = T.sep(rel)
    lateral = T.smooth(T.m_('MULTIPLY', s[0], -1.0), 0.010, 0.022)                     # outer canthus side (-X)
    pore_v = T.n('ShaderNodeTexVoronoi', i_Scale=3600.0, i_Randomness=1.0); T.L(P, pore_v.inputs['Vector'])
    pores = T.m_('ADD', T.smooth(pore_v.outputs['Distance'], 0.05, 0.42), T.smooth(T.noise(P, 140.0, 3.0), 0.35, 0.7))   # pores fade in patches
    micro = T.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=2300.0); T.L(P, micro.inputs['Vector'])
    mic = T.smooth(micro.outputs['Distance'], 0.0, 0.16)
    # crow's feet: lines fanning from the outer canthus; under-eye: arcs concentric with the globe
    ang = T.m_('ARCTAN2', s[2], T.m_('MULTIPLY', s[0], -1.0))
    fan = T.noise(T.comb(T.m_('MULTIPLY', ang, 9.0), 0.0, 0.0), 1.0, 2.0, 0.5, 0.0, '3D')
    crow = T.m_('MULTIPLY', T.smooth(T.m_('ABSOLUTE', T.m_('SINE', T.m_('MULTIPLY_ADD', ang, 38.0, T.m_('MULTIPLY', fan, 5.0)))), 0.0, 0.25), lateral)
    crow = T.m_('SUBTRACT', 1.0, T.m_('MULTIPLY', crow, 0.45))
    under = T.smooth(T.m_('MULTIPLY', s[2], -1.0), 0.004 * k, 0.012 * k)
    arcs = T.smooth(T.m_('ABSOLUTE', T.m_('SINE', T.m_('MULTIPLY_ADD', d, 2300.0, T.m_('MULTIPLY', T.noise(P0, 300.0, 2.0), 3.0)))), 0.0, 0.35)
    lines = T.m_('MINIMUM', crow, T.m_('ADD', arcs, T.m_('SUBTRACT', 1.0, T.m_('MULTIPLY', under, 0.8))))
    # upper lid: fine crinkles running with the margin (arcs round a point below the eye, broken up by noise), and a
    # soft crease (supratarsal fold); both show on the closed lid
    lidz = T.m_('MULTIPLY', T.m_('MULTIPLY', upper, T.smooth(mup, 0.0012 * k, 0.0024 * k)), T.m_('SUBTRACT', 1.0, T.smooth(mup, 0.008 * k, 0.012 * k)))
    q = T.v_('LENGTH', T.v_('SUBTRACT', P, tuple(c - Vector((0, 0, 0.02 * k)))))
    crk = T.smooth(T.m_('ABSOLUTE', T.m_('SINE', T.m_('MULTIPLY_ADD', q, 6500.0 / k, T.m_('MULTIPLY', T.noise(P, 380.0, 3.0), 5.0)))), 0.0, 0.45)
    crk = T.m_('MULTIPLY', T.m_('SUBTRACT', 1.0, crk), T.m_('MULTIPLY', lidz, T.smooth(T.noise(P, 220.0, 3.0), 0.40, 0.66)))
    crease = T.m_('MULTIPLY', T.m_('SUBTRACT', 1.0, T.smooth(T.m_('ABSOLUTE', T.m_('SUBTRACT', mup, 0.0074 * k)), 0.0, 0.0018 * k)), upper)
    crease = T.m_('MULTIPLY', crease, T.smooth(T.noise(P0, 120.0, 2.0), 0.3, 0.6))
    shut = T.m_('MULTIPLY', upper, T.m_('SUBTRACT', 1.0, T.smooth(mup, 0.010 * k, 0.014 * k)))   # lid skin stretched when shut
    blot = T.noise(P, 90.0, 4.0, 0.55)
    col = T.mix(T.m_('MULTIPLY', shut, 0.35), tx.outputs['Color'], (0.70, 0.52, 0.46))       # the stretched albedo -> an even lid tone
    col = T.mix(1.0, col, (0.86, 0.80, 0.77), 'MULTIPLY')
    col = T.mix(T.m_('MULTIPLY', T.smooth(blot, 0.45, 0.75), 0.30), col, (0.66, 0.44, 0.40), 'MULTIPLY')
    col = T.mix(T.m_('MULTIPLY', under, 0.22), col, (0.60, 0.50, 0.52), 'MULTIPLY')         # slight bluish under-eye shadow
    col = T.mix(T.m_('MULTIPLY', lidz, 0.18), col, (0.86, 0.72, 0.74), 'MULTIPLY')          # thin lid skin, a little violet
    lv = T.n('ShaderNodeTexNoise', i_Scale=160.0, i_Detail=3.0, i_Roughness=0.5); T.L(P, lv.inputs['Vector'])
    lv = T.m_('SUBTRACT', 1.0, T.smooth(T.m_('ABSOLUTE', T.m_('SUBTRACT', lv.outputs['Fac'], 0.5)), 0.0, 0.03))
    col = T.mix(T.m_('MULTIPLY', T.m_('MULTIPLY', lv, lidz), 0.16), col, (0.62, 0.52, 0.64), 'MULTIPLY')   # faint lid veins
    col = T.mix(T.m_('ADD', T.m_('MULTIPLY', crease, 0.30), T.m_('MULTIPLY', crk, 0.16)), col, (0.62, 0.52, 0.50), 'MULTIPLY')
    col = T.mix(T.m_('MULTIPLY', brow, 0.30), col, (0.62, 0.56, 0.52), 'MULTIPLY')          # brow: follicles and fine hairs
    col = T.mix(T.m_('MULTIPLY', T.m_('SUBTRACT', 1.0, pores), 0.16), col, (0.45, 0.32, 0.29))
    hs = T.n('ShaderNodeHueSaturation', i_Saturation=0.80, i_Value=1.0); T.L(col, hs.inputs['Color']); col = hs.outputs['Color']
    col = T.mix(T.m_('MULTIPLY', rim, 0.75), col, (0.64, 0.33, 0.31))                        # moist pink margin
    T.L(col, T.p.inputs['Base Color'])
    h = T.m_('ADD', T.m_('MULTIPLY', T.m_('MINIMUM', pores, 1.0), 0.4), T.m_('ADD', T.m_('MULTIPLY', mic, 0.07), T.m_('MULTIPLY', lines, 0.28)))
    h = T.m_('SUBTRACT', h, T.m_('ADD', T.m_('MULTIPLY', crk, 0.4), T.m_('MULTIPLY', crease, 0.5)))
    h = T.m_('MULTIPLY', h, T.m_('SUBTRACT', 1.0, T.m_('MULTIPLY', rim, 0.8)))
    b = T.n('ShaderNodeBump', i_Strength=0.7, i_Distance=0.00012); T.L(h, b.inputs['Height']); T.L(b.outputs['Normal'], T.p.inputs['Normal'])
    rough = T.m_('MULTIPLY_ADD', T.noise(P, 60.0, 3.0), 0.24, 0.36)
    rough = T.m_('ADD', T.m_('MULTIPLY', T.m_('SUBTRACT', 1.0, pores), 0.14), rough)
    rough = T.m_('ADD', rough, T.m_('MULTIPLY', T.m_('ADD', crk, crease), 0.15))
    T.L(T.m_('MAXIMUM', T.m_('SUBTRACT', rough, T.m_('MULTIPLY', rim, 0.42)), 0.06), T.p.inputs['Roughness'])
    T.L(T.m_('MULTIPLY', rim, 1.0), T.p.inputs['Coat Weight']); T.set('Coat Roughness', 0.05)
    T.set('Subsurface Weight', 0.5); T.p.inputs['Subsurface Radius'].default_value = (1.0, 0.37, 0.18); T.set('Subsurface Scale', 0.0026)
    T.set('Specular IOR Level', 0.5)
    return T.m


def _resample(pts, n):
    """Polyline -> n points evenly spaced by arc length."""
    d = [0.0]
    for a, b in zip(pts, pts[1:]): d.append(d[-1] + (b - a).length)
    out, j = [], 0
    for i in range(n):
        s = d[-1] * i / (n - 1)
        while j < len(d) - 2 and d[j + 1] < s: j += 1
        t = (s - d[j]) / max(d[j + 1] - d[j], 1e-9)
        out.append(pts[j].lerp(pts[j + 1], t))
    return out


def _sphere_t(o, d, c, r):
    oc = o - c; b = oc.dot(d); q = oc.dot(oc) - r * r; h = b * b - q
    return None if h < 0 else -b - math.sqrt(h)


def lids(surf, c, r, cam=None, n=64):
    """Visible upper and lower lid margins, lateral (-X) corner first: for rays fanned round the eye in the camera's
    view, the first point outwards where the skin occludes the globe (the lid edge as seen, not the hidden place where
    MakeHuman's socket skin cuts through the globe behind the lids). Returns ([Vector]*n, [Vector]*n) or (None, None)."""
    cam = cam or bpy.context.scene.camera
    O = cam.matrix_world.translation; R3 = cam.matrix_world.to_3x3()
    X, Z = R3 @ Vector((1, 0, 0)), R3 @ Vector((0, 1, 0))
    front = c + (O - c).normalized() * r                  # globe pole facing the camera
    def skin_first(p):
        d = (p - O).normalized(); hit = surf.bvh.ray_cast(O, d)
        ts = _sphere_t(O, d, c, r)
        if hit[0] is None: return None
        ds = (hit[0] - O).length
        return hit[0] if ts is None or ds < ts - 1e-6 else None
    rim = []
    if skin_first(front) is not None: return None, None              # lids closed over the pole
    for k in range(180):
        th = 2 * math.pi * k / 180; u = X * math.cos(th) + Z * math.sin(th)
        lo, hi = 0.0, r * 1.2
        if skin_first(front + u * hi) is None: continue
        for _ in range(22):
            mid = (lo + hi) / 2
            if skin_first(front + u * mid) is None: lo = mid
            else: hi = mid
        rim.append((th, skin_first(front + u * (hi + 0.00005)) or skin_first(front + u * hi * 1.01)))
    rim = [(t, p) for t, p in rim if p is not None]
    if len(rim) < 20: return None, None
    pts = [p for _, p in rim]
    i0 = min(range(len(pts)), key=lambda i: (pts[i] - c).dot(X)); i1 = max(range(len(pts)), key=lambda i: (pts[i] - c).dot(X))
    a, b = pts[i0], pts[i1]
    def above(q):
        f = (q - a).dot(X) / max((b - a).dot(X), 1e-9)
        return (q - a).dot(Z) - f * (b - a).dot(Z) >= 0
    up = sorted([q for q in pts if above(q)] + [a, b], key=lambda q: (q - c).dot(X))
    lo_ = sorted([q for q in pts if not above(q)] + [a, b], key=lambda q: (q - c).dot(X))
    return _resample(up, n), _resample(lo_, n)


def _strand(root, d0, side, length, curl, n=7):
    pts, p, d = [root], root.copy(), d0.normalized()
    for k in range(1, n):
        d = (d + side * curl * 1.7 / n).normalized()
        p = p + d * (length / (n - 1)); pts.append(p)
    return pts


def lash_spec(surf, c, r, seed=7):
    """Lashes bound to the lid skin (rest pose): [(bind, [local offsets], radius0)]. Upper: ~180 in 2-3 staggered
    rows, longest just lateral of centre, curling up and sweeping out at the lateral end; lower: ~35, shorter, finer,
    pointing down and out. Clumps never mix the two lids."""
    rnd = random.Random(seed); spec = []
    import numpy as np
    from bpy_extras.object_utils import world_to_camera_view as w2c
    sc = bpy.context.scene; cam = sc.camera
    up, lo = lids(surf, c, r)
    for lid, count, Lmax, sgn in ((up, 260, 0.0074, 1.0), (lo, 80, 0.0029, -1.0)):
        dense = _resample(lid, 200)
        proj = sorted((w2c(sc, cam, q_).x, w2c(sc, cam, q_).y) for q_ in dense)
        edge_y = lambda x, P_=proj: float(np.interp(x, [a for a, _ in P_], [b for _, b in P_]))
        for k in range(count):
            t = min(0.985, max(0.015, (k + rnd.random()) / count))
            if t > (0.9 if sgn > 0 else 0.84) or t < 0.035: continue
            q = dense[int(t * 199)]
            radial = (q - c).normalized()
            vert = Vector((0, 0, sgn)); vert = (vert - radial * vert.dot(radial)).normalized()
            row = rnd.random()
            # root on the outer lid skin, just past the visible margin as the camera sees it (a root on the inner
            # margin would show as a stub or a hair rising over the white of the eye): nudged a little, else dropped
            off = 0.00015 + 0.0005 * row
            for _ in range(3):
                bind = surf.bind(q + radial * 0.0002 + vert * off); root = surf.at(bind)
                v = w2c(sc, cam, root); ok = (v.y - edge_y(v.x)) * sgn > 0.001
                if sgn < 0 and (root - q).length > 0.0009: ok = False          # bound onto the cheek side of the lid
                if ok: break
                off += 0.0001
            if not ok: continue
            prof = math.sin(math.pi * min(1.0, t * 1.05)) ** 0.55 * (0.55 + 0.45 * t if sgn > 0 else 1.0)   # lateral (t~0) shorter at the very corner
            prof = max(0.28, prof) * (0.82 + 0.3 * rnd.random())
            length = Lmax * prof
            sweep = Vector((-1, 0, 0)) * (0.55 * (1 - t) ** 2 - 0.15 * t ** 2)          # lateral lashes fan outward
            if sgn > 0:
                d0 = radial * 1.0 + vert * 0.05 + sweep + Vector((rnd.gauss(0, 0.08), 0, rnd.gauss(0, 0.06)))
                pts = _strand(root, d0, vert + sweep * 0.3, length, 1.15)
            else:   # lower lashes: down and out, away from the globe, never back over the cornea
                d0 = radial * 0.55 + vert * 0.85 + sweep * 1.2 + Vector((rnd.gauss(0, 0.06), 0, rnd.gauss(0, 0.04)))
                pts = _strand(root, d0, vert * 0.6 + radial * 0.4, length, 0.35)
            tt, bb, nn = surf.frame(bind[0])
            spec.append((bind, pts, 0.00007 if sgn > 0 else 0.00005, (tt, bb, nn), root, sgn))
    print('LASHES', sum(1 for x in spec if x[5] > 0), 'upper', sum(1 for x in spec if x[5] < 0), 'lower')
    # clumps of 3-5 neighbours on the same lid: tips drawn towards the clump's mean tip (real lashes clump)
    out = []
    i = 0
    while i < len(spec):
        n_ = rnd.randint(3, 5); g = [spec[i]]
        while len(g) < n_ and i + len(g) < len(spec) and spec[i + len(g)][5] == spec[i][5]: g.append(spec[i + len(g)])
        i += len(g)
        g = [s_[:5] for s_ in g]
        tip = sum((s_[1][-1] for s_ in g), Vector()) / len(g)
        for bind, pts, r0, (tt, bb, nn), root in g:
            m = len(pts) - 1
            pts = [p + (tip - pts[-1]) * (0.55 * (j / m) ** 2) for j, p in enumerate(pts)]
            out.append((bind, [((p - root).dot(tt), (p - root).dot(bb), (p - root).dot(nn)) for p in pts], r0))
    return out


def brow_spec(surf, card, img, c, n=1700, seed=3):
    """Eyebrow hairs over the MPFB eyebrow card (where its texture is opaque, so the density follows the card), rooted on
    the skin and lying almost flat along a smooth flow field: rising at the medial head, running laterally through the
    body (lower rows tilted up, upper rows down, so they meet in a soft herringbone) and dropping along the tail."""
    import numpy as np
    rnd = random.Random(seed)
    W, H = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, img.channels)
    me = card.data; me.calc_loop_triangles(); uvl = me.uv_layers.active.data; mw = card.matrix_world
    tris = [(tuple(mw @ me.vertices[i].co for i in t.vertices), tuple(Vector(uvl[l].uv) for l in t.loops)) for t in me.loop_triangles]
    areas = [((P[1] - P[0]).cross(P[2] - P[0])).length / 2 for P, _ in tris]
    roots, tries = [], 0
    while len(roots) < n and tries < n * 40:
        tries += 1
        P, U = rnd.choices(tris, weights=areas)[0]
        a, b = rnd.random(), rnd.random()
        if a + b > 1: a, b = 1 - a, 1 - b
        p = P[0] + (P[1] - P[0]) * a + (P[2] - P[0]) * b
        uv = U[0] + (U[1] - U[0]) * a + (U[2] - U[0]) * b
        al = px[min(H - 1, int(uv.y % 1 * H)), min(W - 1, int(uv.x % 1 * W)), 3]
        if rnd.random() > al ** 1.3: continue
        roots.append(p)
    X = np.array([p.x for p in roots]); Z = np.array([p.z for p in roots]); x0, x1 = X.min(), X.max()
    nb = 14; edges = np.linspace(x0, x1, nb + 1); mid = (edges[:-1] + edges[1:]) / 2
    Y = np.array([p.y for p in roots]); zc, zh, yc = [], [], []
    for i in range(nb):
        m_ = (X >= edges[i]) & (X <= edges[i + 1]); sel = Z[m_]
        zc.append(np.median(sel) if len(sel) else np.nan); zh.append((np.percentile(sel, 90) - np.percentile(sel, 10)) / 2 if len(sel) > 4 else np.nan)
        yc.append(np.median(Y[m_]) if m_.any() else np.nan)
    zc, zh, yc = np.array(zc), np.array(zh), np.array(yc); ok = ~np.isnan(zc) & ~np.isnan(zh) & ~np.isnan(yc)
    sm3 = lambda a: np.convolve(np.pad(np.interp(mid, mid[ok], a[ok]), 1, mode='edge'), np.ones(3) / 3, 'valid')
    zc, yc = sm3(zc), sm3(yc); zh = np.interp(mid, mid[ok], zh[ok])
    def centre(x): return Vector((x, float(np.interp(x, mid, yc)), float(np.interp(x, mid, zc))))
    dx = (x1 - x0) / nb
    def sm(x, e0, e1):
        t = min(1.0, max(0.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
    spec = []
    for p in roots:
        bind = surf.bind(p); root = surf.at(bind); tt, bb, nn = surf.frame(bind[0])
        f = (root.x - x0) / max(x1 - x0, 1e-9)                         # 0 lateral tail .. 1 medial head
        v = (root.z - float(np.interp(root.x, mid, zc))) / max(float(np.interp(root.x, mid, zh)), 1e-4)   # -1 below .. +1 above
        body = 1.0 - sm(f, 0.72, 0.92)
        ang = -24 + 34 * sm(f, 0.0, 0.5) + 58 * sm(f, 0.7, 1.0) - 16 * max(-1.2, min(1.2, v)) * body + rnd.gauss(0, 5.5)
        ang = math.radians(ang)
        lat = centre(root.x - dx) - centre(root.x + dx)                   # along the brow, towards the tail
        lat = (lat - nn * lat.dot(nn)).normalized(); up = nn.cross(lat).normalized()
        if up.z < 0: up = -up
        d = (lat * math.cos(ang) + up * math.sin(ang)).normalized() + nn * 0.10
        edge = sm(abs(v), 0.6, 1.3)
        L = (0.0062 + 0.0032 * rnd.random()) * (1.0 - 0.35 * edge) * (0.7 + 0.3 * sm(f, 0.0, 0.25)) * (1.0 - 0.3 * sm(f, 0.85, 1.0))
        pts = _strand(root, d, -nn * 0.9 + d * 0.1, L, 0.45, 8)
        spec.append((bind, [((q - root).dot(tt), (q - root).dot(bb), (q - root).dot(nn)) for q in pts], 0.000036 * (0.8 + 0.4 * rnd.random())))
    print('BROW', len(spec), 'of', tries)
    return spec


def hair_mat(name, melanin=0.88, rough=0.32, redness=0.15):
    T = E.N(name); out = T.t.nodes['Material Output']
    h = T.n('ShaderNodeBsdfHairPrincipled'); h.parametrization = 'MELANIN'
    h.inputs['Melanin'].default_value = melanin; h.inputs['Melanin Redness'].default_value = redness
    h.inputs['Roughness'].default_value = rough; h.inputs['Radial Roughness'].default_value = 0.35
    T.L(h.outputs[0], out.inputs['Surface'])
    return T.m


def wet_mat(name, color, sss=0.4):
    T = E.N(name); T.set('Base Color', (*color, 1)); T.set('Roughness', 0.35); T.set('Coat Weight', 1.0); T.set('Coat Roughness', 0.02)
    T.set('Subsurface Weight', sss); T.p.inputs['Subsurface Radius'].default_value = (1.0, 0.3, 0.2); T.set('Subsurface Scale', 0.0015)
    b = T.n('ShaderNodeBump', i_Strength=0.25, i_Distance=0.0001); nz = T.noise(T.obj(), 3500.0, 3.0); T.L(nz, b.inputs['Height'])
    T.L(b.outputs['Normal'], T.p.inputs['Normal'])
    return T.m


def curves(name, spec, surf, mat):
    """(Re)build a hair-curves object from bound strands."""
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    hc = bpy.data.hair_curves.new(name); hc.add_curves([len(s[1]) for s in spec])
    k = 0
    for bind, offs, r0 in spec:
        root = surf.at(bind); t, b, n = surf.frame(bind[0])
        m = len(offs)
        for j, (x, y, z) in enumerate(offs):
            pt = hc.points[k]; pt.position = root + t * x + b * y + n * z
            pt.radius = r0 * (1.0 - 0.92 * (j / (m - 1)) ** 0.9); k += 1
    hc.materials.append(mat)
    o = bpy.data.objects.new(name, hc); bpy.context.scene.collection.objects.link(o)
    return o


def tube(name, pts, radius, mat, taper=True):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = 4
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1.0)
        sp.points[i].radius = math.sin(math.pi * i / (len(pts) - 1)) ** 0.5 if taper else 1.0
    cu.materials.append(mat)
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
    return o


def _seg_dist(P, line):
    """Distance from each point of P (N x 3) to the polyline (list of Vector)."""
    import numpy as np
    L = np.array([tuple(q) for q in line]); A, B = L[:-1], L[1:]; AB = B - A
    best = np.full(len(P), np.inf)
    for a, ab in zip(A, AB):
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        best = np.minimum(best, np.linalg.norm(P - (a + t[:, None] * ab), axis=1))
    return best


def margin_attrs(face, up, lo, brow_roots=()):
    """Skin attributes that ride with the lids (computed once in the rest pose, interpolated by the subdivision):
    'restp' rest position, 'mup' / 'mlo' distance (m) to the upper / lower visible lid margin, 'brow' eyebrow root
    density 0..1. The shader
    uses them for the narrow wet margin, the lid crinkles and crease, and the faint brow shadow, so a closed lid keeps
    dry, textured skin (a distance to the globe would make the whole closed lid wet)."""
    import numpy as np
    sub = face.modifiers.get('sub'); was = sub.show_viewport if sub else None
    if sub: sub.show_viewport = False
    bpy.context.view_layer.update()
    ev = face.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh(); mw = face.matrix_world
    P = np.array([tuple(mw @ v.co) for v in me.vertices]); ev.to_mesh_clear()
    if sub: sub.show_viewport = was
    vals = {'mup': _seg_dist(P, up), 'mlo': _seg_dist(P, lo)}
    if brow_roots:
        R = np.array([tuple(q) for q in brow_roots]); dens = np.zeros(len(P))
        for i in range(0, len(P), 512):
            d2 = ((P[i:i + 512, None, :] - R[None]) ** 2).sum(-1)
            dens[i:i + 512] = np.exp(-d2 / (2 * 0.0018 ** 2)).sum(1)
        vals['brow'] = np.clip(dens / max(np.percentile(dens[dens > 0.5], 90) if (dens > 0.5).any() else 1.0, 1e-6), 0, 1)
    for k, arr in vals.items():
        at = face.data.attributes.get(k) or face.data.attributes.new(k, 'FLOAT', 'POINT')
        at.data.foreach_set('value', arr.astype(np.float32).tolist())
    at = face.data.attributes.get('restp') or face.data.attributes.new('restp', 'FLOAT_VECTOR', 'POINT')
    at.data.foreach_set('vector', P.astype(np.float32).ravel().tolist())
    face.data.update(); bpy.context.view_layer.update()
    print('MARGIN attrs', {k: (round(float(v.min()), 4), round(float(v.max()), 4)) for k, v in vals.items()})


def grow(S, fr):
    """Per-frame hair, tear meniscus and caruncle for the Scene in render_eye.py (lid pose already set)."""
    if S.lash_spec is None:
        kv = {k.name: k.value for k in S.keys}
        for k in S.keys: k.value = 0.0
        S.keys['wide'].value = float(os.environ.get('EYE_WIDE', 0.0))
        bpy.context.view_layer.update()
        rest = Surf(S.face)
        S.lash_spec = lash_spec(rest, S.c, S.r)
        S.brow_spec = brow_spec(rest, S.browcard, S.bimg, S.c) if S.bimg else []
        up, lo = lids(rest, S.c, S.r)
        S.rest_lids = (up, lo)
        # an upper lash bound to skin that is folded away in the rest pose would end up in the middle of the shut lid:
        # keep only the lashes whose roots close onto the lower lid margin
        for k in S.keys: k.value = 0.0
        S.keys['blink'].value = 1.0; bpy.context.view_layer.update()
        shut = Surf(S.face); n0 = len(S.lash_spec)
        S.lash_spec = [l for l in S.lash_spec if l[2] < 6e-5 or min((shut.at(l[0]) - q).length for q in lo) < 0.0035]
        print('LASHES kept', len(S.lash_spec), 'of', n0)
        for k in S.keys: k.value = 0.0
        S.keys['wide'].value = float(os.environ.get('EYE_WIDE', 0.0)); bpy.context.view_layer.update()
        margin_attrs(S.face, up, lo, [rest.at(b) for b, _o, _r in S.brow_spec])
        med = lo[-1]; inward = (S.c - med).normalized()
        car = bpy.data.objects.new('caruncle', bpy.data.meshes.new('caruncle')); bpy.context.scene.collection.objects.link(car)
        import bmesh as _bm
        bm = _bm.new(); _bm.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0); bm.to_mesh(car.data); bm.free()
        for p in car.data.polygons: p.use_smooth = True
        car.scale = (0.0022, 0.0016, 0.0018); car.location = med + Vector((0.0004, 0.0016, 0.0002))   # tucked in the medial canthus, behind the lid line
        car.data.materials.append(wet_mat('caruncle', (0.72, 0.30, 0.28)))
        S.mats = {'lash': hair_mat('lash', 0.985, 0.25, 0.05), 'brow': hair_mat('brow', 0.90, 0.40, 0.12),
                  'tear': E.clear_mat('tear', 1.333, (0.98, 0.97, 0.96))}
        for k in S.keys: k.value = kv[k.name]
        bpy.context.view_layer.update()
    surf = Surf(S.face)
    curves('lashes', S.lash_spec, surf, S.mats['lash'])
    if S.brow_spec: curves('brows', S.brow_spec, surf, S.mats['brow'])
    up, lo = lids(surf, S.c, S.r)
    for nm in ('meniscus_lo', 'meniscus_up'):
        o = bpy.data.objects.get(nm)
        if o: bpy.data.objects.remove(o, do_unlink=True)
    if up and fr['blink'] < 0.8:
        tube('meniscus_lo', lo[2:-2], 0.00028, S.mats['tear'])
        tube('meniscus_up', up[3:-3], 0.00016, S.mats['tear'])
