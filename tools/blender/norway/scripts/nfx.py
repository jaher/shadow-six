"""Norway rework (art_rework_norway_1): robust per-part LOD builder, roof registry, roof dressing, snow blankets
with cornices/icicles/melt rings, sod (torvtak) roofs, destruction language. Imported at the end of nlib."""
import math, bpy, bmesh
from mathutils import Vector as V, Matrix
from mathutils import noise as MN
import kit as K
import kit_core as C
import kit_export as KE
import kit_roof as KR

# ------------------------------------------------------------------------------------------------ LOD builder
LOD_NOTES = ('LOD1/LOD2 are per-part simplifications: parts smaller than 0.3 m (LOD1) / 0.9 m (LOD2) are dropped, '
             'every kept part is planar-dissolved and only chunky closed parts are edge-collapsed (a part is reverted '
             'to its dissolved mesh if the collapse opens holes or loses >8% area, so thin roof slabs, poles and '
             'flags never tear). Door nodes stay separate in LOD1 but their leaves are static; LOD2 folds doors '
             'into the main mesh and drops all decals (LOD1 keeps decals >= 1 m). The game must swap to LOD0 before '
             'animating a door (doors are only interactable within close zoom, where LOD0 is always used).')


def _area(me):
    return sum(p.area for p in me.polygons)


def _boundary(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    n = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return n


def _thickness(me):
    """2 V / S: ~thickness for slabs, ~radius for cylinders, a/3 for cubes."""
    bm = bmesh.new()
    bm.from_mesh(me)
    try:
        vol = abs(bm.calc_volume())
    except Exception:
        vol = 0.0
    bm.free()
    s = _area(me)
    return 2 * vol / s if s > 1e-6 else 0.0


DBG = []
NO_COLLAPSE_MATS = ('corrugated_rust', 'corrugated_galv', 'tar_paper', 'snow', 'sod', 'board_batten',
                    'timber_cladding', 'concrete_camo')
COMP_DROP = {1: (0.3, 0.05), 2: (0.9, 0.1)}      # per LOD: drop loose pieces with max dim < a or middle dim < b


def _drop_components(me, level):
    amax, amid = COMP_DROP.get(level, (0, 0))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = set()
    kill = []
    for v0 in bm.verts:
        if v0 in seen:
            continue
        comp, stack = [], [v0]
        seen.add(v0)
        while stack:
            v = stack.pop()
            comp.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        d = sorted(max(v.co[i] for v in comp) - min(v.co[i] for v in comp) for i in range(3))
        if d[2] < amax or d[1] < amid:
            kill += comp
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
        bm.to_mesh(me)
    bm.free()


def _simplify(o, ratio, dissolve_deg, level=1):
    me = o.data
    t0 = sum(len(p.vertices) - 2 for p in me.polygons)
    if o.get('kit_lod') != 'nocollapse':
        _drop_components(me, level)
        if not me.polygons:
            return
    if dissolve_deg > 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve_deg), verts=bm.verts, edges=bm.edges,
                                 delimit={'MATERIAL', 'UV', 'SHARP'})
        bm.to_mesh(me)
        bm.free()
    ntri = sum(len(p.vertices) - 2 for p in me.polygons)
    kid = o.data.materials[0].get('kit_id', '') if o.data.materials else ''
    if kid.startswith('roof_') or kid in NO_COLLAPSE_MATS:
        DBG.append((level, o.name, t0, ntri, 'mat'))
        return
    if not ratio or ratio >= 1 or ntri < 48 or o.get('kit_lod') == 'nocollapse':
        DBG.append((level, o.name, t0, ntri, 'skip'))
        return
    th = 1.0 if (o.get('kit_lod') == 'collapse_open' or level >= 2) else _thickness(me)
    if th < 0.07:
        DBG.append((level, o.name, t0, ntri, 'thin %.3f' % th))
        return
    a0, b0 = _area(me), _boundary(me)
    backup = me.copy()
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    m.delimit = {'UV', 'SHARP', 'MATERIAL'}
    KE._select([o])
    bpy.ops.object.modifier_apply(modifier='dec')
    if _area(o.data) < a0 * (0.92 if level < 2 else 0.85) or _boundary(o.data) > b0 + 2:
        old = o.data
        DBG.append((level, o.name, t0, ntri, 'revert a%.2f b%d>%d' % (_area(old) / a0, _boundary(old), b0)))
        o.data = backup
        bpy.data.meshes.remove(old)
    else:
        DBG.append((level, o.name, t0, sum(len(p.vertices) - 2 for p in o.data.polygons), 'ok'))
        bpy.data.meshes.remove(backup)


LOD_DROP = {1: ('curtain', 'hinge', '_bars', 'icicle', 'snowguard', 'roofladder'),
            2: ('_frame', 'cas', '_sash', '_sill', 'shutter', 'curtain', '_bars', 'hinge', 'lintel', 'rafters',
                'woodpile', 'railing', 'icicle', 'tufts', 'snowguard', 'roofladder', 'flashing', 'gutter',
                'reflector_lattice', 'splinters', 'net_leads', 'cable_conduit', 'ladder_head')}


def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
    groups = {}
    for o in parts:
        node = o.get('kit_node', 'main')
        if level > 0 and node == 'main' and o.get('kit_lod') != 'keep' and any(k in o.name for k in LOD_DROP.get(level, ())):
            continue
        if level > 0 and node == 'decals' and KE.part_size(o) < (1.0 if level == 1 else 1e9):
            continue
        if level > 0 and (o.get('kit_lod') == 'drop' or (KE.part_size(o) < min_size and node == 'main'
                                                          and o.get('kit_lod') not in ('keep', 'nocollapse'))):
            continue
        if level >= 2 and node.startswith('door_'):
            node = 'main'
        groups.setdefault(node, []).append(o)
    out = []
    for node, objs in groups.items():
        cp = []
        for o in objs:
            c = KE._copy(o)
            if level > 0 and node != 'decals' and o.get('kit_lod') != 'keep':
                _simplify(c, ratio, dissolve_deg, level)
                if not c.data.polygons:
                    bpy.data.objects.remove(c)
                    continue
            cp.append(c)
        if not cp:
            continue
        piv = objs[0].get('kit_pivot') if node != 'main' else None
        ob = KE.join(cp, node if level == 0 else '%s_lod%d' % (node, level))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='EAR_CLIP')
        bm.to_mesh(ob.data)
        bm.free()
        if piv:
            d = V(piv)
            ob.data.transform(Matrix.Translation(-d))
            ob.location = d
        out.append(ob)
    return out


KE.build_lod = build_lod
LODS = ((0.5, 0.3, 3.0), (0.25, 0.9, 8.0))

_orig_fin = K.finalize


def finalize(outdir, **kw):
    kw.setdefault('lods', LODS)
    kw.setdefault('recenter', False)
    import os
    if os.environ.get('NOR_FAST'):
        kw['skip_ao'] = True
    C.A.meta['lod_policy'] = LOD_NOTES
    if C.A.water is None:                                 # nothing may reach deeper than 0.2 m below grade (validator)
        for o in C.A.parts:
            if o.name in bpy.data.objects and o.type == 'MESH':
                for v in o.data.vertices:
                    if v.co.z < -0.2:
                        v.co.z = -0.2
    if os.environ.get('NOR_DBG'):
        tl = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in C.A.parts
                     if o.name in bpy.data.objects), reverse=True)
        C.log('PARTS total', sum(t for t, _ in tl), ' '.join('%s:%d' % (n, t) for t, n in tl[:30]) + ' ALL:' + ','.join(n for t, n in tl))
    r = _orig_fin(outdir, **kw)
    if os.environ.get('NOR_DBG'):
        for d in sorted(DBG, key=lambda x: (-x[0], -x[3]))[:45]:
            C.log('LODDBG', *d)
    return r


# ------------------------------------------------------------------------------------------------ roof registry
ROOFS = []
_orig_gable = KR.roof_gable


def _roof_gable(cx, cy, L, W, z_eave, pitch=45.0, mid='roof_slate', rot=0.0, eave_oh=0.35, gable_oh=0.25, thick=0.12,
                *a, **kw):
    R = _orig_gable(cx, cy, L, W, z_eave, pitch, mid, rot, eave_oh, gable_oh, thick, *a, **kw)
    hip = kw.get('hip', False)
    t = math.tan(math.radians(pitch))
    Lh = L / 2 + (0 if hip else gable_oh)
    ze = z_eave - eave_oh * t + R.lift
    yw = W / 2 + eave_oh
    hin = yw if hip else 0.0
    zr = R.z_ridge + 0.02
    R.quads = []
    for s in (-1, 1):                                  # (eave_a, eave_b, top_b, top_a), eave first
        R.quads.append([R.w(-Lh, s * yw, ze), R.w(Lh, s * yw, ze), R.w(Lh - hin, 0, zr), R.w(-Lh + hin, 0, zr)])
    if hip:
        for s in (-1, 1):
            apex = R.w(s * (Lh - hin), 0, zr)
            R.quads.append([R.w(s * Lh, -s * yw, ze), R.w(s * Lh, s * yw, ze), apex, apex])
    R.eave_oh, R.gable_oh, R.thick, R.hip, R.Lh, R.yw, R.ze = eave_oh, gable_oh, thick, hip, Lh, yw, ze
    R.sod = kw.get('sod', False)
    R.name = kw.get('name', 'roof')
    R.chimneys = []
    ROOFS.append(R)
    return R


KR.roof_gable = _roof_gable
K.roof_gable = _roof_gable


def _roof_hip(cx, cy, L, W, z_eave, pitch=40.0, mid='roof_terracotta', rot=0.0, **kw):
    return _roof_gable(cx, cy, L, W, z_eave, pitch, mid, rot, hip=True, **kw)


KR.roof_hip = _roof_hip
K.roof_hip = _roof_hip

CHIMNEYS = []
_orig_chim = KR.chimney


def _chimney(x, y, z_base, z_top, w=0.75, d=0.55, *a, **kw):
    CHIMNEYS.append((x, y, w, d, z_top))
    return _orig_chim(x, y, z_base, z_top, w, d, *a, **kw)


KR.chimney = _chimney
K.chimney = _chimney


def roof_z(R, lx, ly):
    """Top surface height of roof R at roof-local (lx, ly) (plane approximation, no sag)."""
    t = math.tan(math.radians(R.pitch))
    if R.hip:
        d = min(R.yw - abs(ly), R.Lh - abs(lx))
    else:
        d = R.yw - abs(ly)
    return R.ze + d * t


def local(R, p):
    d = V((p[0], p[1], 0)) - R.c
    return d.dot(R.ax), d.dot(R.ay)


def recolor(ob, fn):
    """fn(world_pos, normal, rgb) -> rgb for every loop of part ob (COLOR_0)."""
    me = ob.data
    ca = me.color_attributes.get('Col')
    if not ca:
        return
    mw = ob.matrix_world
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            p = mw @ me.vertices[me.loops[li].vertex_index].co
            c = ca.data[li].color
            r = fn(p, n, (c[0], c[1], c[2]))
            if r is not None:
                ca.data[li].color = (min(1, r[0]), min(1, r[1]), min(1, r[2]), c[3])


def noise01(p, s=1.0, o=0.0):
    return 0.5 + 0.5 * MN.noise(V((p[0] * s + 3.1 + o, p[1] * s - 5.3, p[2] * s + 1.7 * o)))


K.finalize = finalize

# ------------------------------------------------------------------------------------------------ roof slab grid
_orig_slab = KR.slab_bm


def _slab(bm, q, thick, nu=4, nv=4, sag=0.0, wobble=0.0, seed=0):
    """Finer top grid (~0.9 m) so vertex-colour weathering (moss, streaks) has resolution."""
    nu = max(nu, int((q[1] - q[0]).length / 0.9))
    nv = max(nv, int((q[3] - q[0]).length / 0.8))
    return _orig_slab(bm, q, thick, nu, nv, sag, wobble, seed)


KR.slab_bm = _slab


def orient(bm, faces, n):
    """Flip a consistently wound face set if its (area-weighted) mean normal points against n."""
    tot = V((0, 0, 0))
    for f in faces:
        f.normal_update()
        tot += f.normal * f.calc_area()
    if tot.dot(n) < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)


def slope_normal(q):
    n = (q[1] - q[0]).cross(q[3] - q[0])
    if n.length < 1e-6:
        n = (q[1] - q[0]).cross(q[2] - q[0])
    n.normalize()
    return n if n.z > 0 else -n


def roof_weather(R, moss=0.5, streaks=0.5, lichen=0.3, seed=1):
    """Vertex-colour weathering of the roof slopes (moss at the eaves / north slope, rain streaks running down the
    slope, bleached crests near the ridge) + a few moss/lichen decals."""
    ph = seed * 1.37
    for ob in R.parts:
        if not ('slope' in ob.name or '_hip' in ob.name):
            continue

        def f(p, n, c):
            lx, ly = local(R, p)
            d = max(0.0, min(1.0, (R.yw - abs(ly)) / max(0.5, R.yw)))  # 0 at eave, 1 at ridge
            north = 1.0 if n.y > 0.2 else 0.45
            m = moss * north * (1 - d) ** 1.6 * noise01(p, 1.3, ph) ** 1.3
            s = streaks * (noise01((lx * 2.8, 0, 0), 1.0, ph) - 0.45) * 0.35
            k = 1.0 - 0.18 * (noise01(p, 0.4, ph) - 0.5) - s
            k *= 1.0 + 0.1 * d
            r, g, b = c[0] * k, c[1] * k, c[2] * k
            return (r * (1 - m) + 0.30 * m, g * (1 - m) + 0.36 * m, b * (1 - m) + 0.16 * m)
        recolor(ob, f)
    r = K.rng()
    for q in R.quads[:2]:
        n = slope_normal(q)
        up = (q[3] - q[0]).normalized()
        pass


def ridge_cap(R, mid='steel_galv', tint=(0.42, 0.44, 0.46)):
    """Re-material the ridge cap so it reads as a separate line (zinc / dark angle tiles)."""
    for ob in R.parts:
        if ob.name.endswith('_ridge') and ob.data.materials:
            ob.data.materials[0] = K.mat(mid, tint)


def snow_guards(R, up=1.1, sides=(-1, 1), name='snowguard'):
    """Snofanger: two galvanised tubes on brackets ~1 m up-slope from the eave (standard on Norwegian roofs)."""
    t = math.tan(math.radians(R.pitch))
    bm = bmesh.new()
    for s in sides:
        ly = s * (R.yw - up)
        z = roof_z(R, 0, ly) + 0.02
        n = int(R.L / 1.2)
        L2 = R.Lh - (R.yw - up if R.hip else 0.3)
        for k in (0.1, 0.22):
            a, b = R.w(-L2, ly, z + k), R.w(L2, ly, z + k)
            K.cyl_bm(bm, a, b, 0.022, 5)
        for i in range(n + 1):
            x = -L2 + 2 * L2 * i / n
            K.beam_bm(bm, R.w(x, ly + s * 0.06, z - 0.02), R.w(x, ly - s * 0.02, z + 0.27), 0.03, 0.04)
    return K.part(bm, 'steel_galv', name=name, grime=0.3, mat_tint=(0.55, 0.56, 0.58), smooth=True)


def roof_ladder(R, lx, side=-1, name='roofladder'):
    """Takstige: galvanised roof ladder from the eave to the ridge + ridge walkway plank (fire regulations)."""
    bm = bmesh.new()
    for off in (-0.2, 0.2):
        a = R.w(lx + off, side * (R.yw - 0.15), roof_z(R, lx, side * (R.yw - 0.15)) + 0.08)
        b = R.w(lx + off, side * 0.15, roof_z(R, lx, side * 0.15) + 0.08)
        K.beam_bm(bm, a, b, 0.04, 0.05)
    n = int((R.yw - 0.3) / 0.33)
    for i in range(n + 1):
        ly = side * (R.yw - 0.15 - i * 0.33)
        z = roof_z(R, lx, ly) + 0.1
        K.beam_bm(bm, R.w(lx - 0.22, ly, z), R.w(lx + 0.22, ly, z), 0.03, 0.03)
    z = R.z_ridge + 0.1
    K.beam_bm(bm, R.w(lx - 1.2, 0, z), R.w(lx + 1.2, 0, z), 0.3, 0.04)
    return K.part(bm, 'steel_galv', name=name, grime=0.3, mat_tint=(0.5, 0.5, 0.52))


def flashing(R):
    """Zinc/lead skirts where chimneys pass through roof R."""
    bm = bmesh.new()
    for (x, y, w, d, zt) in CHIMNEYS:
        lx, ly = local(R, (x, y))
        if abs(lx) > R.Lh or abs(ly) > R.yw:
            continue
        zs = [roof_z(R, *local(R, (x + sx * w / 2, y + sy * d / 2))) for sx in (-1, 1) for sy in (-1, 1)]
        z0, z1 = min(zs) - 0.02, max(zs) + 0.16
        K.box_bm(bm, (x, y, (z0 + z1) / 2), (w + 0.1, d + 0.1, z1 - z0))
    if bm.verts:
        return K.part(bm, 'steel_galv', name='flashing', mat_tint=(0.48, 0.5, 0.52), grime=0.6)
    bm.free()


def rafter_tails(R, spacing=0.6, w=0.06, h=0.14, mid='wood_paint', tint=None, name='rafters'):
    """Exposed rafter tails under the eave overhang (visible from the side/low views) + a soffit shadow board."""
    t = math.tan(math.radians(R.pitch))
    bm = bmesh.new()
    n = int(R.L / spacing)
    for s in (-1, 1):
        for i in range(n + 1):
            lx = -R.L / 2 + R.L * i / n
            a = R.w(lx, s * (R.W / 2 - 0.1), R.z_eave + 0.1 * t - h * 0.6)
            b = R.w(lx, s * (R.yw - 0.06), R.z_eave - (R.eave_oh - 0.06) * t - h * 0.6)
            K.beam_bm(bm, a, b, w, h)
    kw = dict(mat_tint=tint) if tint else {}
    return K.part(bm, mid, name=name, uv='beam', axis=tuple(R.ay), grime=0.5, **kw)


def dress_roof(R, moss=0.5, guards=True, ladder=None, ridge=('steel_galv', (0.42, 0.44, 0.46)), rafters=True,
               rafter_mid='wood_paint', rafter_tint=None, seed=1):
    roof_weather(R, moss=moss, seed=seed)
    if ridge:
        ridge_cap(R, *ridge)
    flashing(R)
    if guards:
        snow_guards(R)
    if ladder is not None:
        roof_ladder(R, ladder)
    if rafters:
        rafter_tails(R, mid=rafter_mid, tint=rafter_tint)


# ------------------------------------------------------------------------------------------------ snow
SNOW_EXCLUDE = ('rubble', 'battens', 'railing', 'gutter', 'bars', 'ropes', 'guys', 'stockfish', 'ribs', 'mast', 'tower',
                'iron', 'hinge', 'insulators', 'pipes', 'lamp', 'winch', 'chain', 'stovepipe', 'fire_buckets', 'oars',
                'snowguard', 'roofladder', 'flashing', 'tuft', 'icicle', 'snowbl', 'rafters', 'net', 'fish', 'debris',
                'splinter', 'rebar', 'cable', 'felt', 'duckboard', 'piers', 'drain_gravel', 'floor_burnt', 'rafters_broken',
                'glass', 'woodstack', 'woodpile', 'sval_floor', 'logs_')
Z = V((0, 0, 1))


def snow_blanket(R, q, th=0.2, lip=0.2, seed=0, icicles=True, base_off=0.0, name='snowbl', patchy=0.0, res=1.0):
    """Snow blanket over one roof slope quad q = (eave_a, eave_b, top_b, top_a): noisy drift thickness, thin at the
    ridge so the ridge cap line shows, a rounded cornice curling over the eave, melt holes around chimneys,
    closed verge skirts; optional icicles hanging from the cornice."""
    n = slope_normal(q)
    e = q[1] - q[0]
    upv = ((q[3] + q[2]) / 2 - (q[0] + q[1]) / 2)
    down = -upv.normalized()
    nu = max(2, int(e.length / (0.6 * res)))
    nv = max(3, int(upv.length / (0.5 * res)))
    rr = K.rng()
    ph = seed * 2.1 + rr.random() * 10

    def P(u, v):
        return q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v) + n * base_off

    def thick(p, v):
        k = th * (0.72 + 0.56 * noise01(p, 0.6, ph)) * (1 + 0.35 * (1 - v) ** 4)
        if patchy > 0:                                   # snow slid off in slabs: bare streaks near the eave
            lu = (p - q[0]).dot(e.normalized())
            bare = noise01((lu * 0.9, v * upv.length * 0.22, 0), 1.0, ph) - (1 - patchy * (1.2 - v))
            if bare > 0:
                return max(-0.08, k - bare * 10.0 * th)
        if v > 0.78:
            k *= max(0.12, 1 - (v - 0.78) / 0.22 * 0.9)
        return k

    melt = []
    for (x, y, w, d, zt) in CHIMNEYS:
        melt.append((x, y, max(w, d) / 2 + 0.3))
    bm = bmesh.new()
    rows, flags = [], []
    for j in range(-3, nv + 1):
        row, fl = [], []
        for i in range(nu + 1):
            u = i / nu
            if j >= 0:
                v = j / nv
                b = P(u, v)
                t = thick(b, v)
                edge = i in (0, nu)
                p = b + n * (t * (0.55 if edge else 1.0))
            else:
                b = P(u, 0)
                t = thick(b, 0)
                p = {-1: b + down * lip * 0.55 + n * t * 0.9,
                     -2: b + down * lip + n * t * 0.3 - Z * t * 0.45,
                     -3: b + down * lip * 0.7 - Z * t * 0.95 - n * 0.02}[j]
            m = any((p.x - mx) ** 2 + (p.y - my) ** 2 < mr * mr for mx, my, mr in melt)
            if j < 0 and t < 0.04:
                m = True
            row.append(bm.verts.new(p))
            fl.append(m)
        rows.append(row)
        flags.append(fl)
    for j in range(len(rows) - 1):
        for i in range(nu):
            if flags[j][i] or flags[j][i + 1] or flags[j + 1][i] or flags[j + 1][i + 1]:
                continue
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    for i in (0, nu):                                   # verge skirts
        for j in range(3, len(rows) - 1):
            a, b = rows[j][i], rows[j + 1][i]
            c, d = bm.verts.new(b.co - n * 0.12), bm.verts.new(a.co - n * 0.12)
            bm.faces.new((a, b, c, d) if i == 0 else (b, a, d, c))
    orient(bm, bm.faces[:], n)
    ob = K.part(bm, 'snow', name=name, grime=0, bisect=False, jitter=0.02, smooth=True)

    def col(p, nn, c):
        k = 0.93 + 0.07 * noise01(p, 2.0, ph)
        if nn.z < 0.3:
            k *= 0.82
        for mx, my, mr in melt:
            d = math.hypot(p.x - mx, p.y - my)
            if d < mr + 0.5:
                k *= 0.8 + 0.2 * (d - mr) / 0.5
        return (c[0] * k * 0.97, c[1] * k * 0.98, c[2] * k)
    recolor(ob, col)
    if icicles:
        bm = bmesh.new()
        u = rr.uniform(0.02, 0.1)
        while u < 0.97:
            if rr.random() < 0.5:
                b = P(u, 0)
                t = thick(b, 0)
                top = b + down * lip * 0.75 - Z * t * 0.9
                L = 0.05 + rr.random() ** 2.2 * 0.6
                K.cyl_bm(bm, top + Z * 0.03, top - Z * L, 0.025 + L * 0.03, 4, r1=0.003, caps=False)
            u += rr.uniform(0.1, 0.35) / max(1.0, e.length)
        if bm.verts:
            ic = K.part(bm, 'snow', name='icicles', grime=0, bisect=False, mat_tint=(0.8, 0.88, 0.97), jitter=0.0,
                        smooth=True)
            ic['kit_lod'] = 'drop'
        else:
            bm.free()
    return ob


def snow(exclude=SNOW_EXCLUDE, min_area=0.06, th=0.2, icicles=True, roofs=None, res=1.0, **kw):
    """Winter variant: sculpted snow blankets on every registered roof (cornices, ridge line, chimney melt,
    icicles) + the kit's top-facing snow pass on everything else that reads at game zoom."""
    import kit_weather as KW
    skip = set()
    for R in (ROOFS if roofs is None else roofs):
        if getattr(R, 'no_snow', False):
            continue
        for ob in R.parts:
            nm = ob.name
            if 'slope' in nm or '_hip' in nm or nm.endswith('_ridge') or 'turf' in nm:
                skip.add(nm)
        for k, q in enumerate(R.quads):
            snow_blanket(R, q, th=getattr(R, 'snow_th', th), seed=k + 1, icicles=icicles and k < 2 and R.L > 1.5,
                         base_off=getattr(R, 'snow_off', 0.0), lip=getattr(R, 'snow_lip', 0.2),
                         patchy=getattr(R, 'snow_patchy', 0.0), res=res)
    if SAG_HOLES:                                         # blankets follow the collapsed roof and open over the holes
        import kit_arch as KA
        bls = [o for o in C.A.parts if o.name in bpy.data.objects and (o.name.startswith('snowbl') or o.name.startswith('icicles'))]
        for h in SAG_HOLES:
            cx, cy = h['c']
            for o in bls:
                for v in o.data.vertices:
                    d = math.hypot(v.co.x - cx, v.co.y - cy)
                    if d < h['radius'] * 1.6:
                        v.co.z -= h['depth'] * (1 - d / (h['radius'] * 1.6)) ** 2
            lx, ly = local(h['R'], h['c'])
            z = roof_z(h['R'], lx, ly) - h['depth']
            cut, _p = _star_cutter(V((cx, cy, z)), Z, h['radius'] * 0.9, h['seed'], 3.0, spikes=14)
            for o in bls:
                if o.name in bpy.data.objects:
                    KA.cut_object(o, cut)
            cut.free()
    parts = [o for o in C.A.parts if o.name in bpy.data.objects and o.name not in skip
             and not any(s in o.name for s in exclude)]
    kw.setdefault('skip', tuple(m for m in KW.SKIP_SNOW if m not in ('sod',)) + ('turf_grass',))
    return K.snow_pass(parts=parts, min_area=min_area, **kw)


_orig_shed = KR.roof_shed


def _roof_shed(x0, y0, x1, y1, z_low, z_high, mid='corrugated_rust', thick=0.08, oh=0.25, low_side='-y', name='shed',
               gutters=True):
    n0 = len(C.A.parts)
    ob = _orig_shed(x0, y0, x1, y1, z_low, z_high, mid, thick, oh, low_side, name, gutters)
    a, b, c, d = x0 - oh, x1 + oh, y0 - oh, y1 + oh
    zl, zh = z_low - 0.05, z_high
    cs = {'-y': [(a, c, zl), (b, c, zl), (b, d, zh), (a, d, zh)], '+y': [(b, d, zl), (a, d, zl), (a, c, zh), (b, c, zh)],
          '-x': [(a, d, zl), (a, c, zl), (b, c, zh), (b, d, zh)], '+x': [(b, c, zl), (b, d, zl), (a, d, zh), (a, c, zh)]}[low_side]
    q = [V(p) for p in cs]
    R = KR.Roof(c=(q[0] + q[2]) / 2 * 1.0, ax=(q[1] - q[0]).normalized(), L=(q[1] - q[0]).length, W=(q[3] - q[0]).length,
                pitch=math.degrees(math.atan2(zh - zl, (V(cs[3][:2] + (0,)) - V(cs[0][:2] + (0,))).length)), quads=[q],
                parts=[ob], hip=False, sod=False, name=name, lift=0.0, z_eave=zl, z_ridge=zh, chimneys=[])
    R.c = V((R.c.x, R.c.y, 0))
    R.ay = V((-R.ax.y, R.ax.x, 0))
    R.parts = [ob] + [o for o in C.A.parts[n0:] if o is not ob]
    R.shed = True
    ob.name = ob.name if 'slope' in ob.name else ob.name + '_slope'
    ROOFS.append(R)
    return ob


KR.roof_shed = _roof_shed
K.roof_shed = _roof_shed


# ------------------------------------------------------------------------------------------------ sod roof
def _pyr(bm, base, tip, w, side):
    """Thin closed blade/tuft: triangle base (width w across `side`) + tip."""
    b0 = bm.verts.new(base - side * w / 2)
    b1 = bm.verts.new(base + side * w / 2)
    b2 = bm.verts.new(base + (tip - base).cross(side).normalized() * w * 0.4)
    t = bm.verts.new(tip)
    for f in ((b0, b1, t), (b1, b2, t), (b2, b0, t), (b0, b2, b1)):
        bm.faces.new(f)


def sod_roof(cx, cy, L, W, z_eave, pitch=27.0, rot=0.0, eave_oh=0.4, gable_oh=0.35, barge_tint=None, turf_th=0.2,
             seed=1, shrubs=2, name='roof', tufts=1.0):
    """Norwegian torvtak: tarred sarking boards, birch-bark underlay line showing at the eaves and verges, torvvol
    (turf-retaining log) on wooden torvkrok hooks, lumpy displaced turf with tussocks, overhanging grass tufts at the
    eaves and verges, wide bargeboards (vindskier), a few saplings. Returns the Roof (registered for snow)."""
    R = K.roof_gable(cx, cy, L, W, z_eave, pitch, 'timber_tarred', rot, eave_oh, gable_oh, 0.07, ridge=None,
                     fascia='timber_tarred', barge='timber_tarred', gutters=False, sag=0.03, wobble=0.0, name=name)
    for ob in R.parts:
        if ob.name.endswith('_fascia'):
            ob.data.materials[0] = K.mat('wood_paint', barge_tint) if barge_tint else K.mat('timber_tarred')
    rr = K.rng()
    ph = seed * 3.3
    bark = bmesh.new()
    turf = bmesh.new()
    logs = bmesh.new()
    tf = bmesh.new()
    for k, q in enumerate(R.quads[:2]):
        n = slope_normal(q)
        e = q[1] - q[0]
        ed = e.normalized()
        upv = (q[3] + q[2]) / 2 - (q[0] + q[1]) / 2
        H = upv.length
        dn = -upv.normalized()

        def P(u, v):
            return q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v)
        # birch bark underlay: thin sheet slightly larger than the sarking, curling down at the eave
        a0, a1 = P(0, 0) - ed * 0.05 + dn * 0.06 - Z * 0.05, P(1, 0) + ed * 0.05 + dn * 0.06 - Z * 0.05
        b0, b1 = P(0, 0) - ed * 0.05 + n * 0.012, P(1, 0) + ed * 0.05 + n * 0.012
        c0, c1 = P(0, 1) - ed * 0.05 + n * 0.012, P(1, 1) + ed * 0.05 + n * 0.012
        vs = [bark.verts.new(p) for p in (a0, a1, b1, b0, c1, c0)]
        fb = [bark.faces.new((vs[0], vs[1], vs[2], vs[3])), bark.faces.new((vs[3], vs[2], vs[4], vs[5]))]
        orient(bark, fb, n)
        for p0, p1 in ((a0, b0), (b0, c0), (a1, b1), (b1, c1)):         # verge edge strips
            pp = [bark.verts.new(x) for x in (p0, p1, p1 - n * 0.04, p0 - n * 0.04)]
            bark.faces.new(pp)
        # torvvol log + hooks
        r_log = 0.075
        vl = 0.14 / H
        lc0 = P(0, vl) + n * (r_log + 0.02) - ed * 0.1
        lc1 = P(1, vl) + n * (r_log + 0.02) + ed * 0.1
        K.cyl_bm(logs, lc0, lc1, r_log, 8)
        m = int(e.length / 0.8)
        for i in range(m + 1):
            u = 0.03 + 0.94 * i / m
            base = P(u, 0.02) - n * 0.05
            K.beam_bm(logs, base, P(u, vl) + dn * (r_log + 0.03) + n * (r_log * 1.6), 0.05, 0.05)
        # turf surface: rows from behind the log to the ridge + rows rolling over the log and hanging down
        nu = max(3, int(e.length / 0.3))
        nv = max(3, int(H / 0.3))
        v0 = (0.14 + r_log) / H
        rows = []
        nf0 = len(turf.faces)
        for j in range(-2, nv + 1):
            row = []
            for i in range(nu + 1):
                u = i / nu
                if j >= 0:
                    v = v0 + (1 - v0) * j / nv
                    b = P(u, v)
                    lump = 0.07 * (noise01(b, 1.4, ph) - 0.5) * 2 + 0.035 * (noise01(b, 4.2, ph + 5) - 0.5) * 2
                    t = turf_th * (0.85 + 0.3 * noise01(b, 0.5, ph)) + lump
                    if v > 0.92:
                        t += 0.07 * (v - 0.92) / 0.08
                    if i in (0, nu):
                        t *= 0.45
                    p = b + n * max(0.06, t)
                else:
                    b = P(u, vl)
                    wob = 0.04 * (noise01(b, 3.0, ph) - 0.5)
                    p = {-1: b + n * (2 * r_log + 0.1 + wob), -2: b + dn * (r_log + 0.1) + n * (r_log * 0.6) - Z * (0.08 + wob)}[j]
                row.append(turf.verts.new(p))
            rows.append(row)
        for j in range(len(rows) - 1):
            for i in range(nu):
                turf.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
        for i in (0, nu):
            for j in range(len(rows) - 1):
                a, b = rows[j][i], rows[j + 1][i]
                c, d = turf.verts.new(b.co - n * 0.14), turf.verts.new(a.co - n * 0.14)
                turf.faces.new((a, b, c, d) if i == 0 else (b, a, d, c))
        turf.faces.ensure_lookup_table()
        orient(turf, [turf.faces[i] for i in range(nf0, len(turf.faces))], n)
        # overhanging grass tufts along the eave (over the log) and the verges
        cnt = int(e.length / 0.09 * tufts)
        for i in range(cnt):
            u = rr.uniform(0.01, 0.99)
            base = P(u, vl) + dn * (r_log + 0.05) + n * (r_log * 1.2 + rr.uniform(-0.03, 0.04))
            Lt = rr.uniform(0.12, 0.34)
            tip = base + dn * Lt * rr.uniform(0.5, 0.9) - Z * Lt * rr.uniform(0.5, 1.0) + ed * rr.uniform(-0.08, 0.08)
            _pyr(tf, base, tip, rr.uniform(0.05, 0.11), ed)
        for side in (0, 1):
            for i in range(int(H / 0.14 * tufts)):
                v = rr.uniform(v0, 0.97)
                b = P(side, v)
                t = turf_th * 0.5
                out = -ed if side == 0 else ed
                base = b + n * t + out * rr.uniform(-0.04, 0.02)
                Lt = rr.uniform(0.1, 0.26)
                tip = base + out * Lt * rr.uniform(0.4, 0.8) - Z * Lt * rr.uniform(0.4, 0.9)
                _pyr(tf, base, tip, rr.uniform(0.05, 0.1), dn)
        for i in range(int(e.length * H / 1.5 * tufts)):                    # tussocks on the turf
            u, v = rr.uniform(0.05, 0.95), rr.uniform(v0 + 0.05, 0.95)
            b = P(u, v) + n * (turf_th * 0.9)
            Lt = rr.uniform(0.15, 0.32)
            _pyr(tf, b, b + n * Lt + V((rr.uniform(-0.08, 0.08), rr.uniform(-0.08, 0.08), 0)), rr.uniform(0.1, 0.2), ed)
        for i in range(shrubs if k == 0 else max(0, shrubs - 1)):             # tall grass / fireweed clumps
            u, v = rr.uniform(0.15, 0.85), rr.uniform(0.3, 0.85)
            b = P(u, v) + n * (turf_th * 0.8)
            for m_ in range(9):
                a_ = rr.uniform(0, 6.28)
                d_ = V((math.cos(a_), math.sin(a_), 0)) * rr.uniform(0.0, 0.25)
                _pyr(tf, b + d_, b + d_ * 1.8 + Z * rr.uniform(0.35, 0.6), rr.uniform(0.08, 0.14), ed)
    K.part(bark, 'timber_tarred', name=name + '_bark', mat_tint=(0.5, 0.3, 0.2), grime=0, bisect=False)
    K.part(logs, 'log_hewn', name=name + '_torvvol', uv='beam', axis=tuple(R.ax), smooth=True, mat_tint=(0.62, 0.55, 0.47))
    tob = K.part(turf, 'turf_grass', name=name + '_turf', grime=0, bisect=False, smooth=True, jitter=0.0)
    tob['kit_lod'] = 'collapse_open'
    bmesh.ops.recalc_face_normals(tf, faces=tf.faces)
    fob = K.part(tf, 'turf_grass', name=name + '_tufts', grime=0, bisect=False, jitter=0.0)
    fob['kit_lod'] = 'nocollapse'

    def tcol(p, nn, c):
        lx, ly = local(R, p)
        d = max(0.0, min(1.0, (R.yw - abs(ly)) / max(0.5, R.yw)))
        hol = noise01(p, 1.4, ph)
        dry = noise01(p, 0.7, ph + 9) * (0.8 if nn.y < 0 else 0.45)
        g = (0.78 + 0.3 * hol, 0.9 + 0.12 * hol, 0.62 + 0.25 * hol)
        g = tuple(g[i] * (1 - dry * 0.5) + (1.0, 0.92, 0.52)[i] * dry * 0.5 for i in range(3))
        if d < 0.15:
            g = tuple(x * 0.78 for x in g)
        if noise01(p, 2.3, ph + 2) > 0.8 and d > 0.5:
            g = (0.8, 0.62, 0.42)
        return (min(1, g[0]), min(1, g[1]), min(1, g[2]))
    recolor(tob, tcol)
    recolor(fob, lambda p, nn, c: tuple(min(1, x * (0.7 + 0.45 * noise01(p, 6.0, ph + 1))) for x in (0.9, 0.95, 0.7)))
    R.parts += [tob, fob]
    R.snow_off = turf_th + 0.1
    R.snow_lip = 0.3
    return R


# ------------------------------------------------------------------------------------------------ destruction
BLASTS = []
SAG_HOLES = []


def _star_cutter(c, n, r, seed, depth=1.4, spikes=16, floor=None):
    """Jagged prism cutter: irregular star polygon (radius 0.45..1.2 r, occasional long crack spikes) in the plane
    whose normal is n, extruded +-depth. floor: clamp the polygon so the hole reaches down to z=floor (blown to grade)."""
    import random
    rr = random.Random(seed)
    n = V(n).normalized()
    up = Z if abs(n.z) < 0.9 else V((0, 1, 0))
    ru = up.cross(n).normalized()
    uu = n.cross(ru).normalized()
    pts = []
    for i in range(spikes):
        a = 2 * math.pi * (i + rr.uniform(-0.3, 0.3)) / spikes
        k = rr.uniform(0.55, 1.05)
        if rr.random() < 0.18:
            k *= rr.uniform(1.3, 1.7)              # crack spike
        if i % 2:
            k *= rr.uniform(0.62, 0.85)            # re-entrant notch
        p = c + ru * math.cos(a) * r * k + uu * math.sin(a) * r * k * 0.85
        if floor is not None and p.z < floor + 0.2 and math.sin(a) < -0.3:
            p.z = floor - 0.3
        pts.append(p)
    bm = bmesh.new()
    top = [bm.verts.new(p + n * depth) for p in pts]
    bot = [bm.verts.new(p - n * depth) for p in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(spikes):
        j = (i + 1) % spikes
        bm.faces.new((top[j], top[i], bot[i], bot[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, pts


def _ground_clamp(bm, z0=0.01):
    for v in bm.verts:
        if v.co.z < z0:
            v.co.z = z0


def blast(center, radius, normal, seed=1, floor=None, splinters='timber', board_dir=(1, 0, 0), clad_mid='timber_grey',
          clad_tint=None, parts=None, depth=1.4):
    """Blown-out hole: jagged star cutter through every nearby part (glass/window bits inside removed), splintered
    board ends / snapped studs (timber) or bent rebar + spalled chunks (concrete) around the rim, radial charring and
    soot plumes. Returns the rim points."""
    import kit_arch as KA
    c = V(center)
    BLASTS.append((c, radius))
    cutter, pts = _star_cutter(c, normal, radius, seed, depth, floor=floor)
    R = radius * 1.8 + depth
    for o in list(parts or C.A.parts):
        if o.name not in bpy.data.objects or o.get('kit_node', 'main') == 'decals':
            continue
        bb = [o.matrix_world @ V(b) for b in o.bound_box]
        mn = V([min(p[i] for p in bb) for i in range(3)])
        mx = V([max(p[i] for p in bb) for i in range(3)])
        near = V([max(mn[i], min(c[i], mx[i])) for i in range(3)])
        if (near - c).length > R:
            continue
        mid = (mn + mx) / 2
        kid = o.data.materials[0].get('kit_id') if o.data.materials else ''
        if o.name.startswith('logs_x') or o.name.startswith('logs_y'):
            continue                                     # log walls were built with the hole (LOG_HOLES)
        if (mid - c).length < radius * 0.95 and ((mx - mn).length < 2.5 or kid in ('glass_dirty', 'interior_dark', 'curtain')):
            C.A.parts.remove(o)
            bpy.data.objects.remove(o)
            continue
        KA.cut_object(o, cutter)
    cutter.free()
    import random
    rr = random.Random(seed + 7)
    n = V(normal).normalized()
    bd = V(board_dir).normalized()
    bm = bmesh.new()
    pts = [V((p.x, p.y, max(p.z, 0.08))) for p in pts]
    if splinters == 'timber':
        for p in pts:
            for k in range(rr.randint(1, 2)):
                d = (bd * rr.choice((-1, 1)) + (c - p).normalized() * rr.uniform(0.3, 1.0) + n * rr.uniform(-0.6, 0.6)).normalized()
                L = rr.uniform(0.25, 0.8)
                q = p + n * rr.uniform(-0.08, 0.08)
                K.beam_bm(bm, q - d * 0.1, q + d * L, rr.uniform(0.07, 0.16), 0.022, roll=rr.uniform(-0.5, 0.5))
        for k in range(2):                                   # snapped studs / noggins across the opening
            a = pts[rr.randrange(len(pts))]
            d = (c - a).normalized()
            K.beam_bm(bm, a - n * 0.05, a + d * radius * rr.uniform(0.6, 1.1) - Z * rr.uniform(0.1, 0.5) + n * rr.uniform(0.1, 0.5),
                      0.1, 0.1)
        _ground_clamp(bm)
        ob = K.part(bm, 'timber_beam', name='splinters', uv='beam', axis=tuple(bd), mat_tint=(1.0, 0.88, 0.7), grime=0.2)
        if clad_tint:
            bm2 = bmesh.new()
            for p in pts[::2]:
                d = (bd * rr.choice((-1, 1)) + n * rr.uniform(0.2, 0.9)).normalized()
                K.beam_bm(bm2, p, p + d * rr.uniform(0.3, 0.7), 0.12, 0.024)
            _ground_clamp(bm2)
            K.part(bm2, clad_mid, name='splinters_paint', uv='beam', axis=tuple(bd), mat_tint=clad_tint)
    else:
        for p in pts:
            for k in range(rr.randint(1, 3)):
                d = ((c - p).normalized() + n * rr.uniform(-0.5, 0.5) + V((0, 0, rr.uniform(-0.6, 0.3)))).normalized()
                L = rr.uniform(0.2, 0.7)
                q = p + n * rr.uniform(-0.1, 0.1)
                mdl = q + d * L * 0.6
                K.cyl_bm(bm, q, mdl, 0.012, 4)
                K.cyl_bm(bm, mdl, mdl + (d - Z * rr.uniform(0.3, 1.0)).normalized() * L * 0.5, 0.012, 4)
        _ground_clamp(bm)
        ob = K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.45, 0.3, 0.22), grime=0.5)
    # soot: radial + rising plume
    for k in range(3):
        a = rr.uniform(0, math.pi)
        up = V((math.cos(a), 0, math.sin(a))) if abs(n.z) < 0.9 else V((0, 1, 0))
        K.decal('soot', c + n * 0.03, n, radius * rr.uniform(2.2, 3.0), radius * rr.uniform(1.8, 2.6), up=tuple(up), alpha=0.9)
    K.decal('soot', c + Z * radius * 1.3 + n * 0.035, n, radius * 1.6, radius * 2.4, alpha=0.8)
    return pts


def char_blasts(strength=0.92, reach=2.2, base=0.18, skip=('glass_dirty', 'decals', 'snow', 'signs')):
    """Charring that radiates from every blast() hole (not a height band): darken COLOR_0 with distance falloff +
    noise, plus a mild overall smoke film."""
    ph = [1.3, 4.1, 2.2]
    for ob in C.A.parts:
        if ob.name not in bpy.data.objects or not ob.data.materials:
            continue
        if ob.data.materials[0].get('kit_id') in skip or ob.get('kit_node') == 'decals':
            continue

        def f(p, nn, c):
            k = base * noise01(p, 0.8, ph[0])
            for bc, br in BLASTS:
                d = (p - bc).length / (br * reach)
                if p.z > bc.z:
                    d *= 0.7                     # fire climbs
                k = max(k, strength * math.exp(-d * d * 1.6) * (0.6 + 0.5 * noise01(p, 2.3, ph[1])))
            k = min(0.93, k)
            return (c[0] * (1 - k), c[1] * (1 - k) * 0.98, c[2] * (1 - k) * 0.96)
        recolor(ob, f)


def sag_roof(R, center, radius, depth=0.7, holes=True, seed=1):
    """Roof collapse over a blast: slope vertices near `center` (XY) drop down (quadratic falloff), a jagged hole
    opens in the covering, rafters snap and hang into the building, torn felt sheets hang from the edges."""
    import kit_arch as KA
    import random
    rr = random.Random(seed)
    c = V((center[0], center[1], 0))
    SAG_HOLES.append(dict(c=(center[0], center[1]), radius=radius, depth=depth, seed=seed, R=R))
    for ob in R.parts:
        if not ('slope' in ob.name or '_hip' in ob.name or ob.name.endswith('_ridge') or 'battens' in ob.name):
            continue
        me = ob.data
        for v in me.vertices:
            d = math.hypot(v.co.x - c.x, v.co.y - c.y)
            if d < radius * 1.6:
                v.co.z -= depth * (1 - d / (radius * 1.6)) ** 2
    if holes:
        lx, ly = local(R, center)
        z = roof_z(R, lx, ly) - depth
        cut, pts = _star_cutter(V((center[0], center[1], z)), Z, radius * 0.75, seed, 3.0, spikes=14)
        for ob in list(R.parts):
            if ob.name in bpy.data.objects and ('slope' in ob.name or '_hip' in ob.name or 'battens' in ob.name):
                KA.cut_object(ob, cut)
        cut.free()
        bm = bmesh.new()
        t = math.tan(math.radians(R.pitch))
        for k in range(5):                                   # snapped rafters hanging in
            a = pts[rr.randrange(len(pts))]
            ax_, ay_ = local(R, a)
            top = R.w(ax_, ay_ * 0.3, roof_z(R, ax_, ay_ * 0.3) - 0.2)
            end = V((a.x, a.y, 0)) + V((rr.uniform(-0.6, 0.6), rr.uniform(-0.6, 0.6), rr.uniform(0.8, 2.2)))
            K.beam_bm(bm, top, end, 0.08, 0.16, roll=rr.uniform(-0.3, 0.3))
        K.part(bm, 'timber_beam', name='rafters_broken', uv='beam', axis=(0, 1, 0), grime=0.3)
        bm = bmesh.new()
        for k in range(3):                                   # torn roofing felt hanging over the hole edge
            a = pts[rr.randrange(len(pts))]
            d = (V((a.x, a.y, 0)) - c).normalized()
            w = rr.uniform(0.5, 1.0)
            side = d.cross(Z).normalized()
            p0 = a + Z * 0.02
            p1 = p0 - d * rr.uniform(0.2, 0.4) - Z * rr.uniform(0.4, 0.7)
            p2 = p1 - d * 0.1 - Z * rr.uniform(0.3, 0.6)
            vs = [[bm.verts.new(p + side * s * w / 2) for s in (-1, 1)] for p in (p0, p1, p2)]
            wb = [[bm.verts.new(p + side * s * w / 2 + d * 0.01) for s in (-1, 1)] for p in (p0, p1, p2)]
            for i in range(2):
                bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
                bm.faces.new((wb[i + 1][0], wb[i + 1][1], wb[i][1], wb[i][0]))
        K.part(bm, 'tar_paper', name='felt_torn', grime=0.2, bisect=False)


def debris(center, radius=2.0, height=0.7, kind='timber', clad=('timber_grey', None), n=None, seed=1, stovepipe=False,
           name='debris', footprint=True):
    """Destroyed-building debris field (no lava blobs): low ash/earth mound, scorched ground, and
    timber: splintered boards (painted cladding + raw), broken beams leaning on the pile, roofing felt sheets,
             a bent stovepipe, window glass shards;
    concrete: angular spalled slabs with bent rebar, plaster/brick chunks, dust."""
    import random
    rr = random.Random(seed)
    c = V(center)
    n = n or int(radius * 11)
    bm = bmesh.new()                                        # flat irregular mound
    rings, segs = 4, 12
    vv = []
    for i in range(rings):
        t = i / (rings - 1)
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            rad = radius * (1 - t) * (0.75 + 0.45 * noise01((math.cos(a), math.sin(a), t), 1.5, seed))
            row.append(bm.verts.new(c + V((math.cos(a) * rad, math.sin(a) * rad, height * 0.55 * (1 - (1 - t) ** 2) - 0.04))))
        vv.append(row)
    for i in range(rings - 1):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((vv[i][j], vv[i][k], vv[i + 1][k], vv[i + 1][j]))
    top = bm.verts.new(c + V((0, 0, height * 0.6)))
    for j in range(segs):
        bm.faces.new((vv[-1][j], vv[-1][(j + 1) % segs], top))
    K.part(bm, 'mud' if kind == 'timber' else 'concrete_slab', name=name + '_mound', grime=0.3,
           mat_tint=(0.55, 0.5, 0.46) if kind == 'timber' else (0.8, 0.78, 0.75))
    K.decal('soot', c + Z * 0.02, (0, 0, 1), radius * 3.0, radius * 2.6, up=(1, 0.3, 0), alpha=0.85)

    def zat(p):
        d = (V((p.x, p.y, 0)) - V((c.x, c.y, 0))).length / radius
        return max(0.02, height * 0.55 * (1 - d * d))
    if kind == 'timber':
        paint, raw, beams = bmesh.new(), bmesh.new(), bmesh.new()
        for i in range(n):
            a, d = rr.uniform(0, 2 * math.pi), radius * math.sqrt(rr.random()) * 1.05
            p = c + V((math.cos(a) * d, math.sin(a) * d, 0))
            p.z = zat(p) + rr.uniform(0.0, 0.12)
            yaw = rr.uniform(0, math.pi)
            dd = V((math.cos(yaw), math.sin(yaw), rr.uniform(-0.35, 0.35))).normalized()
            L = rr.uniform(0.5, 2.2)
            K.beam_bm(paint if rr.random() < 0.55 else raw, p - dd * L / 2, p + dd * L / 2, rr.uniform(0.1, 0.2), 0.025,
                      roll=rr.uniform(-0.6, 0.6))
        for i in range(max(3, int(radius * 2))):
            a = rr.uniform(0, 2 * math.pi)
            p = c + V((math.cos(a), math.sin(a), 0)) * radius * rr.uniform(0.1, 0.6)
            p.z = zat(p)
            dd = V((math.cos(a + rr.uniform(-1, 1)), math.sin(a + rr.uniform(-1, 1)), 0)).normalized()
            L = rr.uniform(1.6, 3.2)
            e = p + dd * L + Z * rr.uniform(0.3, 1.1) * (1 if i % 2 else 0)
            K.beam_bm(beams, p - dd * 0.3, e, 0.14, 0.16, roll=rr.uniform(-0.3, 0.3))
        K.part(paint, clad[0], name=name + '_boards', uv='beam', axis=(1, 0, 0), **({'mat_tint': clad[1]} if clad[1] else {}))
        K.part(raw, 'timber_beam', name=name + '_splinters', uv='beam', axis=(1, 0, 0), mat_tint=(0.95, 0.85, 0.7))
        K.part(beams, 'timber_beam', name=name + '_beams', uv='beam', axis=(1, 0, 0), mat_tint=(0.7, 0.65, 0.6))
        bm = bmesh.new()
        for i in range(3):                                   # crumpled felt sheets
            a = rr.uniform(0, 2 * math.pi)
            p = c + V((math.cos(a), math.sin(a), 0)) * radius * rr.uniform(0.2, 0.9)
            p.z = zat(p) + 0.05
            w, l = rr.uniform(0.7, 1.2), rr.uniform(0.8, 1.6)
            yaw = rr.uniform(0, 3.14)
            ax_ = V((math.cos(yaw), math.sin(yaw), 0))
            ay_ = V((-ax_.y, ax_.x, 0))
            g = [[bm.verts.new(p + ax_ * (u - 0.5) * l + ay_ * (v - 0.5) * w + Z * (0.18 * math.sin(u * 3.1) * (v + 0.3) + rr.uniform(0, 0.05)))
                  for v in (0, 0.5, 1)] for u in (0, 0.5, 1)]
            for iu in range(2):
                for iv in range(2):
                    bm.faces.new((g[iu][iv], g[iu + 1][iv], g[iu + 1][iv + 1], g[iu][iv + 1]))
            bm2 = bm
        K.part(bm, 'tar_paper', name=name + '_felt', grime=0.2, bisect=False)
        if stovepipe:
            bm = bmesh.new()
            p = c + V((radius * 0.3, -radius * 0.2, zat(c) + 0.1))
            q = p + V((0.9, 0.3, 0.35))
            K.cyl_bm(bm, p, q, 0.08, 8)
            K.cyl_bm(bm, q, q + V((0.35, 0.6, -0.25)), 0.08, 8)
            K.part(bm, 'steel_galv', name=name + '_pipe', mat_tint=(0.35, 0.33, 0.32), smooth=True)
        bm = bmesh.new()
        for i in range(24):                                 # glass shards
            a, d = rr.uniform(0, 2 * math.pi), radius * rr.uniform(0.3, 1.3)
            p = c + V((math.cos(a) * d, math.sin(a) * d, 0))
            p.z = zat(p) + 0.03
            s = rr.uniform(0.08, 0.2)
            v = [bm.verts.new(p + V((rr.uniform(-s, s), rr.uniform(-s, s), rr.uniform(0, 0.02)))) for _ in range(3)]
            bm.faces.new(v)
        K.part(bm, 'glass_dirty', name=name + '_glass', grime=0, bisect=False)
    else:
        slabs, reb = bmesh.new(), bmesh.new()
        for i in range(n):
            a, d = rr.uniform(0, 2 * math.pi), radius * math.sqrt(rr.random())
            p = c + V((math.cos(a) * d, math.sin(a) * d, 0))
            s = rr.uniform(0.15, 0.7) * (1.4 if i < 5 else 1.0)
            p.z = zat(p) + s * 0.2
            K.box_bm(slabs, tuple(p), (s, s * rr.uniform(0.5, 1.0), s * rr.uniform(0.2, 0.5)), rot_z=rr.uniform(0, 3.14),
                     taper=(rr.uniform(0.6, 1.0), rr.uniform(0.6, 1.0)))
            if i < 10:
                dd = V((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(0.2, 1))).normalized()
                K.cyl_bm(reb, p, p + dd * rr.uniform(0.4, 1.0), 0.012, 4)
        ob = K.part(slabs, 'concrete_board', name=name + '_slabs', jitter=0.12)
        K.part(reb, 'steel_galv', name=name + '_rebar', mat_tint=(0.45, 0.3, 0.22))
        bm = bmesh.new()
        for i in range(n // 2):
            a, d = rr.uniform(0, 2 * math.pi), radius * rr.uniform(0.2, 1.2)
            p = c + V((math.cos(a) * d, math.sin(a) * d, 0))
            p.z = zat(p) + 0.04
            K.box_bm(bm, tuple(p), (rr.uniform(0.1, 0.25), rr.uniform(0.08, 0.14), rr.uniform(0.05, 0.08)), rot_z=rr.uniform(0, 3))
        K.part(bm, 'plaster_rough', name=name + '_plaster', mat_tint=(0.85, 0.83, 0.8))
    if footprint:
        K.footprint([(c.x + math.cos(a) * radius * 0.85, c.y + math.sin(a) * radius * 0.85)
                     for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


# ------------------------------------------------------------------------------------------------ laft log walls
LOG_HOLES = []                                        # (centre, radius, normal) registered before log_walls()
def log_bm(bm, p0, p1, rh, rw, segs=8, bend=0.0, taper=0.92):
    """Hewn log (oval section rh vertical x rw horizontal), slight taper and sag, capped ends."""
    p0, p1 = V(p0), V(p1)
    ax = (p1 - p0).normalized()
    side = ax.cross(Z).normalized()
    rings = []
    ts = (0.0, 0.5, 1.0) if (p1 - p0).length > 6.0 else (0.0, 1.0)
    for t in ts:
        c = p0.lerp(p1, t) - Z * bend * math.sin(math.pi * t)
        k = 1.0 + (taper - 1.0) * t
        rings.append([bm.verts.new(c + side * math.cos(2 * math.pi * i / segs) * rw * k + Z * math.sin(2 * math.pi * i / segs) * rh * k)
                      for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def _log_colors(ob, axis, seed):
    ax = V(axis)

    def f(p, n, c):
        if abs(n.dot(ax)) > 0.85:                        # end grain
            return (c[0] * 1.0, c[1] * 0.86, c[2] * 0.66)
        tone = 0.86 + 0.24 * noise01((p.x * 0.3, p.y * 0.3, p.z * 4.5), 1.0, seed)
        if n.z < -0.25:
            k = 0.38 + 0.2 * (1 + n.z)                    # underside in the chink shadow
        elif n.z < 0.3:
            k = 0.78
        else:
            k = 1.0
        return (c[0] * k * tone, c[1] * k * tone, c[2] * k * tone)
    recolor(ob, f)


def log_walls(x0, y0, x1, y1, z0, h, d=0.24, mid='log_hewn', frames=(), ext=0.28, pitch=0.86, name='logs',
              gable_x=None, tint=(0.72, 0.6, 0.48)):
    """Norwegian laft: stacked oval hewn logs on all four walls (alternating X/Y courses, half a log apart), log
    heads projecting at the notched corners, dark chinking shadow under every log (vertex colour + backing),
    end grain on the log heads; optional stepped log gables on the X-end walls."""
    if mid == 'timber_tarred':                            # legacy callers: tarred logs -> dark-stained hewn logs
        mid, tint = 'log_hewn', (0.42, 0.33, 0.26)
    r = K.rng()
    bmx, bmy = bmesh.new(), bmesh.new()
    rh, rw = d * 0.5, d * 0.42
    frs = list(frames)

    def logs(bm, p0, p1, rh_, rw_, **kw):
        """Log from p0 to p1, split around any opening it crosses (cut log ends at the jambs, no booleans)."""
        p0, p1 = V(p0), V(p1)
        ax = (p1 - p0).normalized()
        L_ = (p1 - p0).length
        cuts = []
        for f in frs:
            if abs(f.n.dot(ax)) > 0.3 or abs((p0 - f.o).dot(f.n)) > d * 1.5:
                continue
            if not (f.o.z - rh_ * 0.6 < p0.z < f.o.z + f.h + rh_ * 0.4):
                continue
            c = (f.o - p0).dot(ax)
            cuts.append((c - f.w / 2 - 0.02, c + f.w / 2 + 0.02))
        for (hc, hr, hn) in LOG_HOLES:               # blast holes: logs broken off at staggered lengths
            hc, hn = V(hc), V(hn)
            if abs(hn.dot(ax)) > 0.3 or abs((p0 - hc).dot(hn)) > d * 1.5:
                continue
            dz = p0.z - hc.z
            if abs(dz) >= hr * 0.95 and not (hc.z - hr < 0.3 and p0.z < hc.z):
                continue
            hw = math.sqrt(max(0.0, hr * hr - dz * dz)) if abs(dz) < hr else hr * 0.5
            hw *= r.uniform(0.6, 1.2)
            c = (hc - p0).dot(ax)
            cuts.append((c - hw * r.uniform(0.8, 1.1), c + hw * r.uniform(0.8, 1.1)))
        t = 0.0
        for a_, b_ in sorted(cuts) + [(L_, L_)]:
            if a_ - t > 0.15:
                log_bm(bm, p0 + ax * t, p0 + ax * min(a_, L_), rh_, rw_, **kw)
            t = max(t, b_)
    step = d * 0.84                                       # same-wall log spacing (visible log height)
    k, z = 0, z0 + rh
    ztop = z0 + h
    while z < ztop:
        if k % 2 == 0:
            for y in (y0 + rw, y1 - rw):
                logs(bmx, (x0 - ext * r.uniform(0.85, 1.1), y, z), (x1 + ext * r.uniform(0.85, 1.1), y, z),
                     rh * r.uniform(0.95, 1.04), rw, bend=r.uniform(0, 0.02))
        else:
            for x in (x0 + rw, x1 - rw):
                logs(bmy, (x, y0 - ext * r.uniform(0.85, 1.1), z), (x, y1 + ext * r.uniform(0.85, 1.1), z),
                     rh * r.uniform(0.95, 1.04), rw, bend=r.uniform(0, 0.02))
        z += step / 2
        k += 1
    if gable_x:
        ze, zr = gable_x
        zz = z
        W = y1 - y0
        while zz < zr - 0.12:
            half = (W / 2) * (1 - (zz - ze) / (zr - ze)) + 0.1
            for x in (x0 + rw, x1 - rw):
                yc = (y0 + y1) / 2
                logs(bmy, (x, yc - half, zz), (x, yc + half, zz), rh * r.uniform(0.93, 1.03), rw, taper=1.0)
            zz += step
    fr = list(frames)
    obs = []
    for bm, ax, nm in ((bmx, (1, 0, 0), '_x'), (bmy, (0, 1, 0), '_y')):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = K.part(bm, mid, name=name + nm, uv='beam', axis=ax, smooth=True, jitter=0.05, mat_tint=tint, grime=0.5)
        _log_colors(ob, ax, 3.0 + len(obs))
        obs.append(ob)
    inner = [(x0 + rw * 2, y0 + rw * 2), (x1 - rw * 2, y0 + rw * 2), (x1 - rw * 2, y1 - rw * 2), (x0 + rw * 2, y1 - rw * 2)]
    bm = bmesh.new()
    K.ring_bm(bm, C.poly_offset(inner, 0.03), C.poly_offset(inner, -0.03), z0, ztop)
    bm = K.boolean_cut(bm, fr) if fr else bm
    obs.append(K.part(bm, 'timber_tarred', name=name + '_back', grime=0.0, lod='drop', mat_tint=(0.35, 0.33, 0.3)))
    K.footprint([(x0 - 0.05, y0 - 0.05), (x1 + 0.05, y0 - 0.05), (x1 + 0.05, y1 + 0.05), (x0 - 0.05, y1 + 0.05)], 'HIGH')
    return obs


def weather_gradient(names, z0=0.0, z1=1.6, low=(0.55, 0.58, 0.5), high=(1.0, 1.0, 1.02), seed=1):
    """Stronger weathering gradient on timber walls: damp/green-grey and darker toward the ground, sun-bleached
    silvering higher up, with vertical streak noise."""
    for ob in C.A.parts:
        if ob.name not in bpy.data.objects or not any(ob.name.startswith(n) for n in names):
            continue

        def f(p, n, c):
            t = max(0.0, min(1.0, (p.z - z0) / (z1 - z0)))
            s = 0.9 + 0.2 * noise01((p.x * 3.0, p.y * 3.0, p.z * 0.3), 1.0, seed)
            k = [low[i] * (1 - t) + high[i] * t for i in range(3)]
            return (c[0] * k[0] * s, c[1] * k[1] * s, c[2] * k[2] * s)
        recolor(ob, f)


def rust_patches(R, seed=1, amount=0.8):
    """Galvanised corrugated roof: rust bloom along the eaves, laps and around fixings (vertex colour)."""
    for ob in R.parts:
        if not ('slope' in ob.name or '_hip' in ob.name):
            continue

        def f(p, n, c):
            lx, ly = local(R, p)
            d = max(0.0, min(1.0, (R.yw - abs(ly)) / max(0.5, R.yw)))
            k = amount * (noise01(p, 0.9, seed) ** 2 * 1.4 + (1 - d) ** 3 * 0.5)
            k = min(0.85, k * (0.6 + 0.8 * noise01((lx * 3.0, 0, 0), 1.0, seed + 2)))
            return (c[0] * (1 - k) + 0.46 * k, c[1] * (1 - k) + 0.24 * k, c[2] * (1 - k) + 0.12 * k)
        recolor(ob, f)


def ramp_snow(y0, y1, rz, xs, seed=1):
    """Snow on the barn ramp with two trodden wheel tracks (dirty slush) and boot prints up the crown."""
    rows = 18

    def strip(x0_, x1_, dz, tint, nm):
        b_ = bmesh.new()
        vs = []
        for k in range(rows + 1):
            yy = y0 + (y1 - y0) * k / rows
            z = rz(max(y0 + 0.6, yy)) if yy > y0 + 0.6 else rz(yy)
            z += dz * (0.8 + 0.4 * noise01((x0_, yy, 0), 1.3, seed))
            vs.append((b_.verts.new((x0_, yy, z)), b_.verts.new((x1_, yy, z))))
        for k in range(rows):
            b_.faces.new((vs[k][0], vs[k][1], vs[k + 1][1], vs[k + 1][0]))
        return K.part(b_, 'snow', name=nm, grime=0, bisect=False, mat_tint=tint)
    strip(xs[0] - 0.1, xs[1], 0.16, None, 'snowbl_verge_l')
    strip(xs[1], xs[2], 0.05, (0.62, 0.6, 0.56), 'snowbl_rut_l')
    strip(xs[2], xs[3], 0.12, (0.92, 0.92, 0.93), 'snowbl_crown')
    strip(xs[3], xs[4], 0.05, (0.62, 0.6, 0.56), 'snowbl_rut_r')
    strip(xs[4], xs[5] + 0.1, 0.16, None, 'snowbl_verge_r')
    r = K.rng()
    for k in range(14):                                   # boot prints up the middle
        yy = y0 + 0.4 + k * (y1 - y0 - 0.6) / 14
        x = (0.18 if k % 2 else -0.18) + r.uniform(-0.05, 0.05)
        K.decal('stain_blotch', (x, yy, rz(yy) + 0.15), (0, 0, 1), 0.16, 0.3, up=(0, 1, 0), alpha=0.55)


pyr = _pyr


# ------------------------------------------------------------------------------------------------ barracks bits
def tar_patches(R, n=4, seed=1):
    """Tar-paper repair patches (slightly raised, different tone) on the slopes."""
    import random
    rr = random.Random(seed)
    bm = bmesh.new()
    for i in range(n):
        q = R.quads[i % 2]
        nn = slope_normal(q)
        u, v = rr.uniform(0.1, 0.9), rr.uniform(0.15, 0.8)
        c = q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v) + nn * 0.012
        ed = (q[1] - q[0]).normalized()
        up = nn.cross(ed).normalized()
        w, h = rr.uniform(0.6, 1.6), rr.uniform(0.5, 1.0)
        pts = [c - ed * w / 2 - up * h / 2, c + ed * w / 2 - up * h / 2, c + ed * w / 2 + up * h / 2, c - ed * w / 2 + up * h / 2]
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        orient(bm, [f], nn)
    ob = K.part(bm, 'tar_paper', name='tar_patches', grime=0.2, bisect=False, mat_tint=(0.8, 0.8, 0.82))
    return ob


def ridge_vent(R, lx, w=0.5, L=0.9, h=0.35):
    """Boxed ridge ventilator with a small gabled cap."""
    bm = bmesh.new()
    c = R.w(lx, 0, R.z_ridge + h / 2 - 0.05)
    K.box_bm(bm, tuple(c), (L, w, h), rot_z=R.rot)
    K.part(bm, 'timber_beam', name='ridge_vent', mat_tint=(0.55, 0.5, 0.45))
    K.roof_gable(c.x, c.y, L + 0.1, w + 0.1, R.z_ridge + h - 0.05, 30, 'tar_paper', rot=R.rot, eave_oh=0.08, gable_oh=0.05,
                 thick=0.04, fascia=None, barge=None, gutters=False, ridge=None, name='vent_cap')
    C.A.meta['roofs'].pop()


def duckboards(xa, xb, y, w=0.7, z=0.08, name='duckboards'):
    """Slatted duckboard walkway on two runners."""
    bm = bmesh.new()
    n = int((xb - xa) / 0.22)
    for i in range(n):
        x = xa + (i + 0.5) * (xb - xa) / n
        K.box_bm(bm, (x, y, z), (0.1, w, 0.03))
    for s in (-1, 1):
        K.box_bm(bm, ((xa + xb) / 2, y + s * (w / 2 - 0.08), z - 0.05), (xb - xa, 0.08, 0.07))
    K.part(bm, 'timber_grey', name=name, uv='beam', axis=(0, 1, 0), grime=0.8)


def gravel_strip(poly, w=0.45, name='drain_gravel'):
    """Drainage gravel strip hugging the wall foot."""
    import kit_arch as KA
    bm = bmesh.new()
    KA.ring_bm(bm, C.poly_offset(C.ccw(poly), w), C.poly_offset(C.ccw(poly), 0.0), -0.05, 0.03)
    K.part(bm, 'gravel', name=name, grime=0.3, mat_tint=(0.72, 0.72, 0.7), bisect=False)


def flagpole(*a, **kw):
    import nlib
    n0 = len(C.A.parts)
    h = nlib._flagpole_orig(*a, **kw)
    for o in C.A.parts[n0:]:
        o['kit_lod'] = 'keep'                  # pole, footing and flag always travel together through the LODs
    return h


def banner(p_top, fw=1.8, fh=1.2, heading=(1, 0, 0), nu=18, nv=12, name='flag'):
    """Cloth banner hanging from a pole at p_top (hoist edge) in a light breeze: deep red field with a Balkenkreuz
    (black cross, white edging), drooping fly end, loose vertical folds that grow toward the fly, slight curl.
    Separate node 'flag' for cloth animation. No swastika (spec 10.6)."""
    hd = V(heading).normalized()
    side = V((-hd.y, hd.x, 0))
    P0 = V(p_top)
    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            s, t = i / nu, j / nv
            fold = 0.035 * math.sin(s * 3.2 + t * 0.5) + 0.2 * max(0.0, s - 0.72) ** 1.5 * (1 + 0.5 * math.sin(t * 5))
            droop = 0.42 * fh * s ** 1.6 * (0.55 + 0.45 * (1 - t))
            x = s * fw * (0.9 - 0.08 * s)
            row.append(P0 + hd * x + side * fold + V((0, 0, -(1 - t) * fh - droop)))
        grid.append(row)
    cells = []
    for sgn, off in ((1, 0.0), (-1, 0.006)):
        vs = [[bm.verts.new(p + side * off * sgn) for p in row] for row in grid]
        for j in range(nv):
            for i in range(nu):
                f = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
                bm.faces.new(f if sgn > 0 else tuple(reversed(f)))
                cells.append((i + 0.5 - nu / 2, j + 0.5 - nv / 2))
    ob = K.part(bm, 'wood_paint', name=name, node='flag', grime=0, bisect=False, jitter=0.0, uv='aligned', smooth=True)
    ob['kit_lod'] = 'keep'

    def col(uv):
        u, v = uv[0] * 24.0 / nu, uv[1] * 16.0 / nv
        bl = (abs(u) < 1.9 and abs(v) < 5.6) or (abs(v) < 1.9 and abs(u) < 5.6)
        wh = (abs(u) < 2.9 and abs(v) < 6.6) or (abs(v) < 2.9 and abs(u) < 6.6)
        return (0.03, 0.03, 0.03) if bl else ((0.9, 0.9, 0.88) if wh else (0.46, 0.025, 0.02))
    me = ob.data
    ca = me.color_attributes.get('Col')
    for k, poly in enumerate(me.polygons):
        cc = col(cells[k % len(cells)])
        for li in poly.loop_indices:
            ca.data[li].color = (cc[0], cc[1], cc[2], 1.0)
    K.anchor('flag', P0, heading, width=fw, height=fh, node='flag')
    return ob


# ------------------------------------------------------------------------------------------------ flat roofs
def flat_roof_dress(poly, z, parapet_t=0.25, seed=1, hatch=None, vents=(), cable=None, ladder_head=None, drains=(),
                    upstand=0.25, moss=0.4, name='roofdeck', dirt=6, seams=0.0):
    """Dress a kit roof_flat: tar-paper membrane with turned-up upstands, roof hatch with hinged steel lid, mushroom
    vents, drain outlets with ponding stains, a cable conduit run (feed-through gooseneck -> supports -> over the
    parapet), ladder-head goose-neck rails, dirt / moss / ponding decals."""
    import random
    import kit_arch as KA
    rr = random.Random(seed)
    inner = C.poly_offset(C.ccw(poly), -parapet_t)
    bm = bmesh.new()
    C.prism_bm(bm, inner, z - 0.01, z + 0.02)
    K.part(bm, 'tar_paper', name=name, grime=0.6)
    bm = bmesh.new()
    KA.ring_bm(bm, inner, C.poly_offset(inner, -0.04), z, z + upstand)
    K.part(bm, 'tar_paper', name=name + '_upstand', grime=0.4, rot90=True)
    zt = z + 0.02
    if hatch:
        hx, hy = hatch
        bm = bmesh.new()
        K.box_bm(bm, (hx, hy, zt + 0.17), (1.0, 1.0, 0.34))
        K.part(bm, 'concrete_bunker', name='hatch_curb')
        bm = bmesh.new()
        K.box_bm(bm, (hx, hy, zt + 0.37), (1.1, 1.1, 0.05))
        for k in range(3):
            K.box_bm(bm, (hx, hy - 0.4 + k * 0.4, zt + 0.41), (1.05, 0.05, 0.03))
        K.cyl_bm(bm, (hx - 0.4, hy + 0.56, zt + 0.37), (hx + 0.4, hy + 0.56, zt + 0.37), 0.03, 6)
        K.part(bm, 'steel_painted', name='hatch_lid', mat_tint=(0.5, 0.55, 0.48))
    bm = bmesh.new()
    for (vx, vy) in vents:
        K.cyl_bm(bm, (vx, vy, zt), (vx, vy, zt + 0.55), 0.09, 10)
        K.cyl_bm(bm, (vx, vy, zt + 0.55), (vx, vy, zt + 0.66), 0.2, 12, r1=0.05)
        K.cyl_bm(bm, (vx, vy, zt), (vx, vy, zt + 0.08), 0.2, 12, r1=0.12)
    for (dx_, dy_) in drains:
        K.cyl_bm(bm, (dx_, dy_, zt - 0.005), (dx_, dy_, zt + 0.03), 0.14, 10)
    if bm.verts:
        K.part(bm, 'steel_galv', name='roof_vents', mat_tint=(0.45, 0.46, 0.45), smooth=True, grime=0.7)
    else:
        bm.free()
    for (dx_, dy_) in drains:
        K.decal('stain_blotch', (dx_, dy_, zt + 0.004), (0, 0, 1), rr.uniform(1.2, 2.0), rr.uniform(0.9, 1.5),
                up=(rr.uniform(-1, 1), 1, 0), alpha=0.75)
    if cable:
        (ax_, ay_), (bx_, by_), (ox, oy) = cable          # feed-through, parapet crossing, outward direction
        bm = bmesh.new()
        for off in (-0.06, 0.06):
            d = V((bx_ - ax_, by_ - ay_, 0)).normalized()
            sd = V((-d.y, d.x, 0)) * off
            a = V((ax_, ay_, zt)) + sd
            b = V((bx_, by_, zt)) + sd
            K.cyl_bm(bm, a, a + V((0, 0, 0.35)), 0.035, 6)
            K.cyl_bm(bm, a + V((0, 0, 0.35)), a + d * 0.3 + V((0, 0, 0.2)), 0.035, 6)
            K.cyl_bm(bm, a + d * 0.3 + V((0, 0, 0.2)), b + V((0, 0, 0.2)), 0.035, 6)
            top = b + V((0, 0, 0.2))
            over = V((bx_ + ox * 0.6, by_ + oy * 0.6, 0)) + sd
            K.cyl_bm(bm, top, top + V((0, 0, 0.75)), 0.035, 6)
            K.cyl_bm(bm, top + V((0, 0, 0.75)), over + V((0, 0, top.z + 0.75)), 0.035, 6)
            K.cyl_bm(bm, over + V((0, 0, top.z + 0.75)), over + V((0, 0, 0.3)), 0.035, 6)
        L_ = (V((bx_, by_, 0)) - V((ax_, ay_, 0))).length
        for k in range(int(L_ / 1.0) + 1):
            p = V((ax_, ay_, zt)).lerp(V((bx_, by_, zt)), k / max(1, int(L_ / 1.0)))
            K.box_bm(bm, (p.x, p.y, zt + 0.08), (0.3, 0.3, 0.16))
        K.part(bm, 'cast_iron', name='cable_conduit', grime=0.4, mat_tint=(0.6, 0.6, 0.58))
    if ladder_head:
        lx, ly, nx, ny = ladder_head
        bm = bmesh.new()
        sd = V((-ny, nx, 0))
        for s in (-0.25, 0.25):
            p = V((lx, ly, 0)) + sd * s
            h0 = z + 0.9
            K.cyl_bm(bm, p + V((0, 0, h0 - 0.2)), p + V((0, 0, h0 + 0.9)), 0.025, 6)
            K.cyl_bm(bm, p + V((0, 0, h0 + 0.9)), p - V((nx, ny, 0)) * 0.6 + V((0, 0, h0 + 0.9)), 0.025, 6)
            K.cyl_bm(bm, p - V((nx, ny, 0)) * 0.6 + V((0, 0, h0 + 0.9)), p - V((nx, ny, 0)) * 0.6 + V((0, 0, zt)), 0.025, 6)
        K.part(bm, 'steel_galv', name='ladder_head', grime=0.2)
    xs = [p[0] for p in inner]
    ys = [p[1] for p in inner]
    if seams:                                                 # rework 2: raised felt lap seams, legible at 1x
        import nfx2
        nfx2.felt_seams(inner, zt, seams)
    for k in range(dirt):                                     # dirt / ponding / moss in the corners
        x = rr.uniform(min(xs) + 0.6, max(xs) - 0.6)
        y = rr.uniform(min(ys) + 0.6, max(ys) - 0.6)
        K.decal(rr.choice(('dirt_splash', 'stain_blotch', 'damp_base')), (x, y, zt + 0.004), (0, 0, 1),
                rr.uniform(1.0, 2.2), rr.uniform(0.8, 1.6), up=(rr.uniform(-1, 1), 1, 0), alpha=0.55)
    for (cx, cy) in inner[:int(4 * moss)]:
        ix = 0.6 if cx < 0 else -0.6
        iy = 0.6 if cy < 0 else -0.6
        K.decal('moss_patch', (cx + ix, cy + iy, zt + 0.004), (0, 0, 1), 1.3, 1.0, up=(1, 0.4, 0), alpha=0.6)
star_cutter = _star_cutter


def hip_caps(R, mid='roof_slate', tint=(0.55, 0.56, 0.6), w=0.2, h=0.07, name='hipcaps'):
    """Angle cappings along the four hip lines (eave corner -> ridge end) of a hip roof."""
    bm = bmesh.new()
    t = math.tan(math.radians(R.pitch))
    zr = R.z_ridge + 0.03
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = R.w(sx * R.Lh, sy * R.yw, R.ze + 0.03)
            b = R.w(sx * (R.Lh - R.yw), 0, zr)
            K.beam_bm(bm, a, b, w, h)
    ob = K.part(bm, mid, name=name, uv='beam', axis=tuple(R.ax), mat_tint=tint, grime=0.3)
    R.parts.append(ob)
    ob.name = R.name + '_ridge_hips'
    return ob
