"""Shared helpers for the 'europe' asset group (France / Belgium / Netherlands). Imported by every europe script.
argv after '--': outdir variant seed"""
import sys, os, math
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/blender')
import kit as K
from mathutils import Vector as V


def args(default_name):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = a[0] if a else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', default_name)
    var = a[1] if len(a) > 1 else 'a'
    seed = int(a[2]) if len(a) > 2 else 1
    return out, var, seed


def pick(r, seq):
    return seq[int(r.random() * len(seq)) % len(seq)]


# period paint colours (sRGB multipliers on the pale wood_paint base)
SHUTTER = {'grey': (0.52, 0.56, 0.55), 'green': (0.30, 0.42, 0.33), 'blue': (0.36, 0.45, 0.55), 'oxblood': (0.48, 0.25, 0.20),
           'cream': (0.82, 0.78, 0.66), 'olive': (0.45, 0.46, 0.33), 'brown': (0.38, 0.28, 0.20), 'teal': (0.26, 0.42, 0.42)}
DOOR = {'green': (0.22, 0.33, 0.26), 'brown': (0.32, 0.24, 0.17), 'blue': (0.24, 0.30, 0.40), 'oxblood': (0.40, 0.18, 0.15),
        'black': (0.12, 0.12, 0.12), 'grey': (0.40, 0.42, 0.41), 'varnish': (0.45, 0.30, 0.18)}


def ruin_pass(hits, rubble_at=(), holes=None, R=None, scorch=0.9, mids=('fieldstone', 'ashlar'), tiles='roof_slate'):
    """Shell / bomb damage: hits = [(center, radius, squash)], rubble_at = [(center, radius, height)],
    holes = roof-local [(lx, ly, r)] on roof R."""
    for i, (c, rad, sq) in enumerate(hits):
        K.bite(c, rad, sq, seed=i + 3)
    if R is not None and holes:
        K.roof_holes(R, holes)
    for i, (c, rad, h) in enumerate(rubble_at):
        K.rubble(c, rad, h, mids=mids, tiles=tiles, name='rubble%d' % i, n=int(10 + rad * 6))
    if scorch:
        K.scorch_openings(1.0, scorch)


def floor_slab(poly, z, t=0.22, mid='deck_planks', name='floor', joists=True, tint=None):
    """Interior timber floor (planks on joists) inside wall poly (inner line) at top height z. tint = vertex tint
    (ruins: dusty / smoke-darkened so a floor seen through a breach does not read as a bright board)."""
    bm = K.bm_new() if hasattr(K, 'bm_new') else __import__('bmesh').new()
    K.prism_bm(bm, poly, z - 0.04, z)
    K.part(bm, mid, name=name, grime=0.4, tint=tint)
    if joists:
        import bmesh
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        bm = bmesh.new()
        n = int((max(xs) - min(xs)) / 0.6)
        for i in range(1, n):
            x = min(xs) + i * (max(xs) - min(xs)) / n
            K.beam_bm(bm, (x, min(ys), z - 0.04 - 0.1), (x, max(ys), z - 0.04 - 0.1), 0.08, 0.2)
        K.part(bm, 'timber_beam', name=name + '_joists', uv='beam', axis=(0, 1, 0))


def timber_face(a, b, z0, z1, frames=(), ztop=None, style='close', mid='timber_beam', tint=None, post=0.18, depth=0.09,
                stud_gap=0.34, braces=True, name='timbers', seed=0):
    """Half-timbering (pan de bois / Fachwerk) on the outer face of wall segment a->b (2D, CCW so outward normal is
    right of travel). z0/z1 = sole plate / wall plate heights; ztop(t) optional top line (gables). frames = openings on
    this face. style: 'close' (Norman close studding), 'cross' (Alsatian St Andrew's crosses), 'square' (posts+rails+braces)."""
    import bmesh, random
    rr = random.Random(seed)
    a, b = V((*a, 0)), V((*b, 0))
    L = (b - a).length
    r = (b - a).normalized()
    n = V((r.y, -r.x, 0))
    top = ztop or (lambda t: z1)
    P = lambda t, z: a + r * t + n * (depth / 2 - 0.035) + V((0, 0, z))
    bm, bmh = bmesh.new(), bmesh.new()                      # vertical/diagonal members | horizontal rails (grain along r)
    beam = lambda p, q, w=post: K.beam_bm(bmh if abs((q - p).z) < 0.3 * (q - p).length else bm, p, q, w, depth, up=n)
    ops = []
    for f in frames:
        t = (f.o - a).dot(r)
        ops.append((t - f.w / 2, t + f.w / 2, f.o.z, f.o.z + f.h))
    inside = lambda t, z: any(o0 - 0.02 < t < o1 + 0.02 and s0 - 0.02 < z < s1 + 0.02 for o0, o1, s0, s1 in ops)
    beam(P(0, z0 + post / 2), P(L, z0 + post / 2))                  # sole plate
    if ztop is None:
        beam(P(0, z1 - post / 2), P(L, z1 - post / 2))              # wall plate
    else:                                                           # rakes of a gable
        tm = max(range(21), key=lambda i: top(L * i / 20)) * L / 20
        beam(P(0, top(0) - post / 2), P(tm, top(tm) - post / 2)); beam(P(tm, top(tm) - post / 2), P(L, top(L) - post / 2))
    zm = z0 + (z1 - z0) * 0.45 if ztop is None else z0 + 1.1
    posts = {0.1, L - 0.1}
    for o0, o1, s0, s1 in ops:
        posts.add(o0 - post / 2); posts.add(o1 + post / 2)
        beam(P(o0 - post, s1 + post / 2), P(o1 + post, s1 + post / 2), post * 0.9)   # head rail
        if s0 > z0 + 0.3:
            beam(P(o0 - post, s0 - post / 2), P(o1 + post, s0 - post / 2), post * 0.9)   # sill rail
    posts = sorted(posts)
    for t in posts:                                                  # principal posts
        zt = top(t) - (post if ztop is None else 0.12)
        if zt > z0 + 0.3:
            beam(P(t, z0 + post), P(t, zt))
    gap = stud_gap if style == 'close' else 0.75
    t = 0.1 + gap
    while t < L - 0.2:                                              # studs
        if min(abs(t - p) for p in posts) > gap * 0.6:
            zt = top(t) - (post if ztop is None else 0.1)
            segs, zc = [], z0 + post
            for o0, o1, s0, s1 in ops:
                if o0 - 0.1 < t < o1 + 0.1:
                    segs.append((zc, s0 - post)); zc = s1 + post
            segs.append((zc, zt))
            for za, zb in segs:
                if zb - za > 0.25:
                    beam(P(t, za), P(t, zb), post * (0.8 if style == 'close' else 0.9))
        t += gap
    # mid rail between openings
    if style != 'close' or ztop is None:
        xs = [0] + [x for o0, o1, s0, s1 in ops if s0 < zm < s1 for x in (o0 - post, o1 + post)] + [L]
        if ztop is not None:                                   # clip the rail to where the gable is tall enough
            ok = [L * i / 40 for i in range(41) if top(L * i / 40) > zm + post * 1.5]
            ta, tb = (min(ok), max(ok)) if ok else (L, 0)
            xs = [min(max(x, ta), tb) for x in xs]
        for k in range(0, len(xs), 2):
            if xs[k + 1] - xs[k] > 0.3:
                beam(P(xs[k], zm), P(xs[k + 1], zm), post * 0.85)
    if braces:                                                       # braces in open panels
        cand = [(posts[i], posts[i + 1]) for i in range(len(posts) - 1)]
        for k, (pa, pb) in enumerate(cand):
            if pb - pa < 0.6 or any(o0 < pb and o1 > pa for o0, o1, s0, s1 in ops):
                continue
            w = min(pb - pa, 1.3)
            for (za, zb) in ((z0 + post, zm), (zm, min(top(pa), top(pb)) - post)):
                if zb - za < 0.6:
                    continue
                if style == 'cross':
                    beam(P(pa + (pb - pa - w) / 2, za), P(pa + (pb + w - pa) / 2, zb), post * 0.8)
                    beam(P(pa + (pb + w - pa) / 2, za), P(pa + (pb - pa - w) / 2, zb), post * 0.8)
                else:
                    if (k + seed) % 2:
                        beam(P(pa + 0.05, za), P(pa + w, zb), post * 0.85)
                    else:
                        beam(P(pb - 0.05, za), P(pb - w, zb), post * 0.85)
    K.part(bmh, mid, name=name + '_rails', uv='beam', axis=tuple(r), tint=tint, grime=0.6)
    return K.part(bm, mid, name=name, uv='beam', axis=(0, 0, 1), tint=tint, grime=0.6)


def compact(small=0.3, medium=0.9, large=4.5, verbose=True):
    """Join small/medium 'main' parts per material before finalize(): Blender bakes selected objects one by one with a
    full scene sync each (cost ~ N^2), so hundreds of window bits made AO bakes crawl. Parts < `small` are merged into
    'drop' groups (removed in LOD1+, as the kit would do), parts < `medium` into plain groups. Doors, wheels, decals,
    pivoted and 'keep' parts are left alone."""
    import bpy
    import kit_core as C
    import kit_export as KE
    groups = {}
    for o in list(C.A.parts):
        if o.name in bpy.data.objects and len(o.data.polygons) == 0:      # emptied by bite()
            C.A.parts.remove(o); bpy.data.objects.remove(o); continue
        if o.name not in bpy.data.objects or o.get('kit_node', 'main') != 'main' or o.get('kit_pivot') or o.get('kit_lod'):
            continue
        s = KE.part_size(o)
        if s >= large:
            continue
        m = o.data.materials[0].name if o.data.materials else ''
        pol = o.get('eu_lod', '')
        cls = 's' if (s < small and not pol) else ('m' if s < medium else 'l')
        groups.setdefault((m, cls, pol), []).append(o)
    n0 = len(C.A.parts)
    import os
    if os.environ.get('EU_VCOL', '1') == '1':       # kit bug: bmesh colour layer is not the render/active colour ->
        for o in C.A.parts:                          # glTF exporter ('ACTIVE') silently drops COLOR_0 (grime, tint jitter)
            ca = o.data.color_attributes
            if len(ca):
                ca.active_color_index = 0
                ca.render_color_index = 0
    for (m, cls, pol), objs in groups.items():
        if len(objs) < 2:
            continue
        for o in objs:
            C.A.parts.remove(o)
        ob = KE.join(objs, 'g_%s_%s%s' % (m.replace('kit:', '')[:24], cls, pol))
        ob['kit_node'] = 'main'
        if pol:
            ob['eu_lod'] = pol
        if cls == 's':
            ob['kit_lod'] = 'drop'
        C.A.parts.append(ob)
    if verbose:
        C.log('compact: parts %d -> %d' % (n0, len(C.A.parts)))


def iron_fence(p0, p1, z=0.0, h=1.2, spacing=0.2, name='fence', mid='cast_iron', tips=True):
    """Light cast-iron railing (square bars, 2 rails, spear tips) - ~16 tris per bar, much cheaper than kit railing()."""
    import bmesh
    a, b = V((p0[0], p0[1], z)), V((p1[0], p1[1], z))
    L = (b - a).length
    d = (b - a).normalized()
    bm = bmesh.new()
    for zz in (0.12, h - 0.1):
        K.beam_bm(bm, a + V((0, 0, zz)), b + V((0, 0, zz)), 0.03, 0.04)
    n = max(1, int(L / spacing))
    for k in range(n + 1):
        p = a + d * (L * k / n)
        K.beam_bm(bm, p + V((0, 0, 0.02)), p + V((0, 0, h)), 0.018, 0.018, up=V((d.y, -d.x, 0)))
        if tips:
            K.cyl_bm(bm, p + V((0, 0, h)), p + V((0, 0, h + 0.09)), 0.025, 4, r1=0.0)
    return K.part(bm, mid, name=name, grime=0.15)


# ====================================================================== rework 1 (art director pass)
# ---- LOD policy: glazing never decimated (no torn white shards), shutters kept in LOD1 (no colour pop) and replaced
#      by flat oriented proxies in LOD2, window frames kept undecimated in LOD1 and dropped in LOD2.
#      eu_lod: 'all' | 'not2' (LOD0+1 only) | 'only2' (LOD2 proxy) | 'only0'
def _obb_proxy(o, pad=0.0):
    import bmesh, bpy
    import kit_core as C
    me = o.data
    if not me.polygons:
        return None
    big = max(me.polygons, key=lambda p: p.area)
    n = (o.matrix_world.to_3x3() @ big.normal).normalized()
    u = V((0, 0, 1)) - n * n.z
    u = u.normalized() if u.length > 1e-3 else V((1, 0, 0))
    w = n.cross(u)
    vs = [o.matrix_world @ v.co for v in me.vertices]
    rng_ = lambda ax: (min(p.dot(ax) for p in vs), max(p.dot(ax) for p in vs))
    (a0, a1), (b0, b1), (c0, c1) = rng_(w), rng_(u), rng_(n)
    bm = bmesh.new()
    pts = []
    for cc in (c0, c1):
        for aa, bb in ((a0, b0), (a1, b0), (a1, b1), (a0, b1)):
            pts.append(w * aa + u * bb + n * cc)
    vv = [bm.verts.new(p) for p in pts]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vv[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kid = o.data.materials[0].get('kit_id')
    tint = o.data.materials[0].get('kit_tint')
    ob = C.part(bm, kid, name=o.name + '_px', mat_tint=tuple(tint) if tint else None, uv='beam', axis=tuple(u), grime=0.5,
                bisect=False)
    ob['eu_lod'] = 'only2'
    return ob


def tag_lod():
    import kit_core as C
    for o in list(C.A.parts):
        if o.get('kit_node', 'main') != 'main' or o.get('eu_lod'):
            continue
        kid = o.data.materials[0].get('kit_id', '') if o.data.materials else ''
        if kid in ('glass_dirty', 'interior_dark', 'curtain', 'signs'):       # atlas / card quads: never decimated (smears)
            o['eu_lod'] = 'all'
        elif '_shut_' in o.name:
            o['eu_lod'] = 'not2'
            _obb_proxy(o)
        elif o.name.endswith('_frame') and kid == 'wood_paint':
            o['eu_lod'] = 'not2'


def _install_lod_patch():
    import kit_export as KE
    if getattr(KE, '_eu_patched', False):
        return
    orig = KE.build_lod

    def build_lod(level, parts, ratio=None, min_size=0.0, dissolve_deg=0.0):
        sel, saved = [], {}
        for o in parts:
            pol = o.get('eu_lod', '')
            if level == 0 and pol in ('only2', 'only12'):
                continue
            if level == 1 and pol in ('only0', 'only2'):
                continue
            if level >= 2 and pol in ('only0', 'not2'):
                continue
            if level >= 1 and pol in ('all', 'not2', 'only2', 'only12'):
                saved[o.name] = o.get('kit_lod')
                o['kit_lod'] = 'keep'
            sel.append(o)
        out = orig(level, sel, ratio, min_size, dissolve_deg)
        for o in sel:
            if o.name in saved:
                if saved[o.name] is None:
                    del o['kit_lod']
                else:
                    o['kit_lod'] = saved[o.name]
        return out
    KE.build_lod = build_lod
    orig_bake = KE.bake_ao

    def bake_ao(objs, *a, **kw):             # LOD2 proxies must not occlude the real shutters in the AO bake
        import bpy
        px = [o for o in bpy.data.objects if o.get('eu_lod') in ('only2', 'only12')]
        for o in px:
            o.location.z += 1000
        try:
            return orig_bake(objs, *a, **kw)
        finally:
            for o in px:
                o.location.z -= 1000
    KE.bake_ao = bake_ao
    KE._eu_patched = True


_install_lod_patch()


def _install_tint_clamp():
    """Material tints are encoded as ~rrggbb: a component > 1.0 overflowed to 3 hex digits and glb_post mis-parsed it
    (teal plaster, blue slate). Clamp every material tint to [0, 1]."""
    import kit_core as C
    if getattr(C, '_eu_tint', False):
        return
    orig = C.mat

    def mat(mid, tint=None):
        if tint is not None:
            tint = tuple(min(1.0, max(0.0, float(c))) for c in tint)
        return orig(mid, tint)
    C.mat = mat
    K.mat = mat
    C._eu_tint = True


_install_tint_clamp()


def finish(out, ao_res=1024, ao_samples=64, lods=((0.38, 0.3, 4.0), (0.3, 1.2, 6.0)), **kw):
    """Standard europe ending: LOD tags, compact, finalize, remnant check."""
    import kit_core as C
    tag_lod()
    compact()
    bad = [o.name for o in C.A.parts if any(m and m.name == 'EU_CUTMARK' for m in o.data.materials)]
    if bad:
        C.log('WARNING cut marker left on', bad)
    try:
        import eu_dmg
        C.log('damage stats', eu_dmg.STATS)
    except Exception:
        pass
    return K.finalize(out, ao_res=ao_res, ao_samples=ao_samples, lods=lods, **kw)


# ---- damage (new robust pass; see eu_dmg.py)
def ruin_pass(hits, rubble_at=(), holes=None, R=None, scorch=0.9, mids=('fieldstone', 'ashlar'), tiles='roof_slate',
              brick=None, timber=None, seed=3, only=None, skip=None):
    """Shell / bomb damage: hits = [(center, radius, squash)] stepped blast holes (no cutter remnants), holes = roof-local
    [(lx, ly, r)] on roof R (splintered rafters), rubble_at = [(center, radius, height)] realistic heaps."""
    import eu_dmg as D
    for i, (c, rad, sq) in enumerate(hits):
        D.blast(c, rad, 0.0, sq, seed + i, mids=mids, brick=bool(brick), timber=timber, only=only, skip=skip)
    if R is not None and holes:
        D.roof_breach(R, holes, seed=seed)
    for i, (c, rad, h) in enumerate(rubble_at):
        D.heap(c, rad, h, stone=mids[0], dress=mids[1] if len(mids) > 1 and mids[1] != mids[0] else None, brick=brick,
               tiles=tiles, seed=seed + 11 * i, name='heap%d' % i)
    if scorch:
        scorch_openings(scorch)


def _surface_hit(p, n, dist=0.25):
    import bpy
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, nor, idx, ob, M = bpy.context.scene.ray_cast(dg, V(p) + V(n) * 0.1, -V(n), distance=dist)
    if not ok or ob is None:
        return False
    kid = ob.data.materials[0].get('kit_id', '') if ob.data.materials else ''
    return kid not in ('decals', 'glass_dirty', 'interior_dark', 'curtain') and ob.get('kit_node', 'main') == 'main' \
        and abs(V(nor).dot(V(n))) > 0.6


def scorch_openings(prob=0.7, scale=0.9, seed=5):
    """Soot plumes above openings, only where there is still WALL behind the whole decal (never on roofs / in holes)."""
    import bpy, random
    import kit_core as C
    bpy.context.view_layer.update()
    rr = random.Random(seed)
    for fr in getattr(C.A, 'frames', []):
        if rr.random() > prob:
            continue
        w = fr.w * 1.6 * scale
        z0 = fr.h - 0.15
        best = 0.0
        for h in (1.6, 1.3, 1.0, 0.75, 0.5):
            pts = [(x, z0 + h * f) for x in (-w * 0.45, 0, w * 0.45) for f in (0.3, 0.95)]
            if all(_surface_hit(fr.p(x, z, 0.0), fr.n) for x, z in pts):
                best = h
                break
        if best:
            K.decal('soot', fr.p(0, z0 + best / 2, 0.0), fr.n, w * 0.85, best * scale, alpha=0.6)


def eave_streaks(edges, z_top, n=4, seed=3, alpha=0.4, kinds=('streak_long', 'streak_rain')):
    """Soft rain run-off streaks hanging from under the eaves / cornice. edges = [(a2, b2)] CCW wall segments."""
    import random
    rr = random.Random(seed)
    for a, b in edges:
        a, b = V((a[0], a[1], 0)), V((b[0], b[1], 0))
        d = (b - a).normalized()
        nn = V((d.y, -d.x, 0))
        L = (b - a).length
        for k in range(n):
            h = rr.uniform(1.0, 2.2)
            p = a + d * rr.uniform(0.6, L - 0.6) + V((0, 0, z_top - h / 2 - 0.05)) + nn * 0.004
            if _surface_hit(p + V((0, 0, h * 0.4)), nn) and _surface_hit(p - V((0, 0, h * 0.4)), nn):
                K.decal(rr.choice(kinds), p, nn, rr.uniform(0.5, 1.0), h, alpha=alpha * rr.uniform(0.7, 1.1))


# ---- roof dressing: breaks the 'one vast uniform plane' read from the game camera
def roof_tone(R, amp=0.16, scale=0.45, streak=0.08, seed=1):
    """Multiply the slope vertex colours with a large-scale tone field + down-slope streaking (weathering, re-slating)."""
    import bmesh
    from mathutils import noise as N
    for o in R.parts:
        if not ('slope' in o.name or 'hip' in o.name):
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        col = bm.loops.layers.color.get('Col')
        if col is None:
            bm.free(); continue
        for f in bm.faces:
            for l in f.loops:
                p = l.vert.co
                lx = (p - R.c).dot(R.ax)
                k = 1 + amp * N.noise(V((p.x * scale + seed, p.y * scale, p.z * scale))) \
                    + streak * N.noise(V((lx * 1.7 + seed * 3, 0.5, 0.2)))
                c = l[col]
                l[col] = (c[0] * k, c[1] * k, c[2] * k, c[3])
        bm.to_mesh(o.data); bm.free()


def roof_patches(R, n=4, mid='roof_slate_b', tint=(0.9, 0.91, 0.93), seed=1, avoid=(), size=((0.7, 1.8), (0.6, 1.3)), side=(-1, 1)):
    """Re-slated / repaired patches: thin slabs of a second covering just above the slope (different slate size & tone)."""
    import bmesh, random
    rr = random.Random(seed)
    p = math.radians(R.pitch)
    t = math.tan(p)
    bm = bmesh.new()
    tries = 0
    while n > 0 and tries < 60:
        tries += 1
        s = rr.choice(side)
        w, h = rr.uniform(*size[0]), rr.uniform(*size[1])
        lx = rr.uniform(-R.L / 2 + w / 2 + 0.4, R.L / 2 - w / 2 - 0.4)
        ly = s * rr.uniform(0.6 + h / 2 * math.cos(p), R.W / 2 - h / 2 * math.cos(p) - 0.2)
        if any(abs(lx - a) < w / 2 + 1.0 for a in avoid):
            continue
        up = (R.ay * (-s) * math.cos(p) + V((0, 0, math.sin(p)))).normalized()
        nrm = R.ax.cross(up).normalized()
        nrm = nrm if nrm.z > 0 else -nrm
        c = R.w(lx, ly, R.z_eave + (R.W / 2 - abs(ly)) * t + R.lift) + nrm * 0.012
        # flush, ragged-edged overlay (no box sides: those read as objects lying on the roof)
        q = [c - R.ax * w / 2 - up * h / 2, c + R.ax * w / 2 - up * h / 2, c + R.ax * (w / 2 - 0.2) + up * h / 2,
             c - R.ax * (w / 2 - 0.35) + up * h / 2]
        f = bm.faces.new([bm.verts.new(x) for x in q])
        if f.normal.dot(nrm) < 0:
            f.normal_flip()
        n -= 1
    if bm.verts:
        return K.part(bm, mid, name='roof_patches', mat_tint=tint, grime=0.3, bisect=False)


def ridge_tiles(a, b, mid='roof_tile_flat', tint=(0.95, 0.9, 0.85), r=0.15, seg=0.42, crest=False, finials=True,
                name='ridge_tiles'):
    """Mortared half-round ridge tiles (faitieres) a->b with visible joints; crest = decorative crest fins (crete);
    finials = terracotta epis at both ends."""
    import bmesh
    a, b = V(a), V(b)
    L = (b - a).length
    d = (b - a).normalized()
    side = d.cross(V((0, 0, 1))).normalized()
    nseg = max(2, int(L / seg))
    bm = bmesh.new()
    for i in range(nseg):
        p0, p1 = a.lerp(b, i / nseg), a.lerp(b, (i + 1) / nseg)
        rings = []
        for p, rr in ((p0, r * 1.1), (p0 + d * 0.035, r), (p1, r * 0.95)):        # socket lip + barrel (joint shadow)
            ring = []
            for k in range(5):
                ang = math.pi * k / 4
                ring.append(p + side * math.cos(ang) * rr + V((0, 0, math.sin(ang) * rr * 0.9 - r * 0.25)))
            rings.append(ring)
        K.loft_bm(bm, rings, closed=False)
    if crest:
        for i in range(nseg):
            p = a.lerp(b, (i + 0.5) / nseg) + V((0, 0, r * 0.62))
            K.hexa_bm(bm, [p - d * 0.16 - side * 0.02, p + d * 0.16 - side * 0.02, p + d * 0.16 + side * 0.02, p - d * 0.16 + side * 0.02,
                           p - d * 0.05 - side * 0.015 + V((0, 0, 0.16)), p + d * 0.05 - side * 0.015 + V((0, 0, 0.16)),
                           p + d * 0.05 + side * 0.015 + V((0, 0, 0.16)), p - d * 0.05 + side * 0.015 + V((0, 0, 0.16))])
    if finials:
        for p in (a, b):
            K.cyl_bm(bm, p + V((0, 0, r * 0.5)), p + V((0, 0, 0.55)), 0.07, 8, r1=0.05)
            K.cyl_bm(bm, p + V((0, 0, 0.55)), p + V((0, 0, 0.78)), 0.09, 8, r1=0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K.part(bm, mid, name=name, mat_tint=tint, grime=0.5, smooth=True, bisect=False, lod='keep')


def roof_ridge(R, eave_oh=0.3, **kw):
    """ridge_tiles along gable roof R's ridge; hip roofs: shortened ridge + the four hip lines (aretiers)."""
    Lh = R.L / 2 + (kw.pop('overhang', 0.25))
    hip = kw.pop('hip', False)
    z = R.z_ridge + 0.04
    if not hip:
        return ridge_tiles(R.w(-Lh, 0, z), R.w(Lh, 0, z), **kw)
    t = math.tan(math.radians(R.pitch))
    yw = R.W / 2 + eave_oh
    ax_ = R.L / 2 - yw
    ze = R.z_eave - eave_oh * t + R.lift + 0.06
    ridge_tiles(R.w(-ax_, 0, z), R.w(ax_, 0, z), **kw)
    kw['finials'] = False
    for sx in (-1, 1):
        for sy in (-1, 1):
            ridge_tiles(R.w(sx * ax_, 0, z - 0.02), R.w(sx * (R.L / 2 + 0.02), sy * yw, ze), name='hip_tiles', **kw)


def roof_decals(R, n=5, seed=2, kinds=('lichen',), alpha=0.32, avoid=()):
    """Moss colonies on thatch only - lichen decals read as dark smudges on slate / tile from the game camera (review 1)."""
    import random
    if 'moss_patch' not in kinds:
        return
    rr = random.Random(seed)
    p = math.radians(R.pitch)
    t = math.tan(p)
    for i in range(n):
        s = 1 if rr.random() < 0.65 else -1
        lx = rr.uniform(-R.L / 2 + 1, R.L / 2 - 1)
        if any(abs(lx - a) < 1.2 for a in avoid):
            continue
        ly = s * rr.uniform(0.8, R.W / 2 - 0.4)
        up = (R.ay * (-s) * math.cos(p) + V((0, 0, math.sin(p)))).normalized()
        nrm = R.ax.cross(up).normalized()
        nrm = nrm if nrm.z > 0 else -nrm
        c = R.w(lx, ly, R.z_eave + (R.W / 2 - abs(ly)) * t + R.lift) + nrm * 0.01
        K.decal(rr.choice(kinds), c, nrm, rr.uniform(0.9, 2.0), rr.uniform(0.7, 1.4), up=tuple(up), alpha=alpha)


# ---- budget window (same signature as kit window): box frame + glazing bars + one glass ngon + interior card,
#      3-stone lintel instead of full voussoir rings. ~90 tris instead of 250-450 (terraces: 30+ windows per row).
def cheap_window(fr, style='casement', panes=(1, 3), frame='white', recess=0.1, sill='ashlar_limestone', lintel=None,
                 surround=None, shutters=None, shutter_color='green', shutter_style='plank', curtain=0.6, bars=False,
                 streak=True, interior=True, name='win'):
    import kit_arch as KA
    import kit_core as C
    import kit_weather as W
    r = C.rng()
    tint = KA._paint(frame)
    fw, fd = 0.07, 0.08
    d0, d1 = -recess - fd, -recess
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    out = []
    bm = K.bm_new()
    KA.lbox(bm, fr, -fr.w / 2, fr.w / 2, 0, fw, d0, d1)                      # sill rail
    for sx in (-1, 1):                                                       # jambs
        KA.lbox(bm, fr, sx * fr.w / 2 - (fw if sx > 0 else 0), sx * fr.w / 2 + (fw if sx < 0 else 0), 0, top, d0, d1)
    if fr.shape == 'rect':
        KA.lbox(bm, fr, -fr.w / 2, fr.w / 2, top - fw, top, d0, d1)
    else:                                                                    # arched head: 4 straight pieces
        ol = [p for p in fr.outline(4) if p[1] > top - 1e-3]
        ol.sort(key=lambda p: p[0])
        for a, b in zip(ol[:-1], ol[1:]):
            K.beam_bm(bm, fr.p(a[0], a[1] - fw / 2, (d0 + d1) / 2), fr.p(b[0], b[1] - fw / 2, (d0 + d1) / 2), fw, fd, up=V(fr.n))
    cols, rows = panes
    nl = 1 if style in ('single', 'fixed') or fr.w < 0.7 else 2
    gb = 0.03
    xs = [(-fr.w / 2 + fw) + (fr.w - 2 * fw) * k / (nl * cols) for k in range(1, nl * cols)]
    for x in xs:                                                             # glazing bars: front-facing strips (2 tris)
        KA.lpoly(bm, fr, [(x - gb / 2, fw), (x + gb / 2, fw), (x + gb / 2, top - fw), (x - gb / 2, top - fw)], d1 - 0.012)
    for q in range(1, rows):
        z = fw + (top - 2 * fw) * q / rows
        KA.lpoly(bm, fr, [(-fr.w / 2 + fw, z - gb / 2), (fr.w / 2 - fw, z - gb / 2), (fr.w / 2 - fw, z + gb / 2), (-fr.w / 2 + fw, z + gb / 2)], d1 - 0.011)
    out.append(K.part(bm, 'wood_paint', name=name + '_frame', mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.5, bisect=False))
    bm = K.bm_new()
    KA.lpoly(bm, fr, fr.outline(4, fw), d0 + fd * 0.5)
    out.append(K.part(bm, 'glass_dirty', name=name + '_glass', grime=0, bisect=False, jitter=0.1))
    if interior:
        bm = K.bm_new()
        KA.lpoly(bm, fr, [(-fr.w / 2 - 0.2, -0.2), (fr.w / 2 + 0.2, -0.2), (fr.w / 2 + 0.2, fr.h + 0.2), (-fr.w / 2 - 0.2, fr.h + 0.2)], -fr.depth - 0.02)
        out.append(K.part(bm, 'interior_dark', name=name + '_int', grime=0, bisect=False, jitter=0.2))
        if r.random() < curtain:
            bm = K.bm_new()
            cw = fr.w * r.uniform(0.25, 0.4)
            KA.lpoly(bm, fr, [(-fr.w / 2, 0.02), (-fr.w / 2 + cw, 0.02), (-fr.w / 2 + cw, top - 0.02), (-fr.w / 2, top - 0.02)], d0 - 0.04)
            KA.lpoly(bm, fr, [(fr.w / 2 - cw, 0.02), (fr.w / 2, 0.02), (fr.w / 2, top - 0.02), (fr.w / 2 - cw, top - 0.02)], d0 - 0.04)
            out.append(K.part(bm, 'curtain', name=name + '_curtain', grime=0, bisect=False, jitter=0.1))
    if sill:
        bm = K.bm_new()
        KA.lbox(bm, fr, -fr.w / 2 - 0.07, fr.w / 2 + 0.07, -0.08, 0.0, d1 - 0.02, 0.07)
        out.append(K.part(bm, sill, name=name + '_sill'))
    lm = lintel or (sill if fr.shape != 'rect' else None)
    if lm:
        bm = K.bm_new()
        zt = fr.h
        if fr.shape == 'rect':
            KA.lbox(bm, fr, -fr.w / 2 - 0.12, fr.w / 2 + 0.12, zt, zt + 0.22, -0.02, 0.02)
        else:
            KA.lbox(bm, fr, -0.1, 0.1, zt - 0.06, zt + 0.24, -0.02, 0.035)             # keystone
            for sx in (-1, 1):
                xa_, xb_ = (-fr.w / 2 - 0.16, -fr.w / 2 + 0.02) if sx < 0 else (fr.w / 2 - 0.02, fr.w / 2 + 0.16)
                KA.lbox(bm, fr, xa_, xb_, zt - fr.rise - 0.05, zt - fr.rise + 0.2, -0.02, 0.02)   # springer blocks
        out.append(K.part(bm, lm, name=name + '_lintel'))
    if surround:
        out.append(KA.jamb_blocks(fr, surround, name=name + '_surround'))
    if shutters:
        out += KA.shutter_pair(fr, shutters, KA._paint(shutter_color), shutter_style, name + '_shut')
    if streak:
        W.decal_on_frame(fr, r.choice(['streak_rain', 'streak_long']), 0, -0.55, fr.w * 0.8, 0.9, alpha=0.4)
    C.A.__dict__.setdefault('frames', []).append(fr)
    C.A.meta['windows'].append({'pos': [round(fr.o.x, 3), round(fr.o.z, 3), round(-fr.o.y, 3)], 'w': fr.w, 'h': fr.h})
    return out


def use_cheap_windows():
    """Route K.window and dormer windows (kit_roof -> kit_arch.window) to cheap_window."""
    import kit_arch as KA
    KA.window = cheap_window
    K.window = cheap_window


def rotate_asset_cw90():
    """Rotate every part (and all sidecar metadata, door / wheel pivots) 90 deg clockwise seen from above:
    Blender (x, y) -> (y, -x); game (x, z) -> (-z, x), headings + pi/2. Used to present a river-side feature
    (water wheel) to the fixed south-facing game camera."""
    import bpy
    import kit_core as C
    from mathutils import Matrix
    M = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    for o in C.A.parts:
        if o.name not in bpy.data.objects:
            continue
        o.data.transform(M)
        if o.get('kit_pivot'):
            p = list(o['kit_pivot'])
            o['kit_pivot'] = [p[1], -p[0], p[2]]
    m = C.A.meta
    r2 = lambda p: [round(-p[1], 3), round(p[0], 3)]
    r3 = lambda p: [round(-p[2], 3), p[1], round(p[0], 3)]
    rh = lambda h: round(math.atan2(math.sin(h + math.pi / 2), math.cos(h + math.pi / 2)), 4)
    for f in m['footprints'] + m['roofs']:
        f['points'] = [r2(p) for p in f['points']]
    for c in m['climb'] + m['ladders'] + (m.get('parapets') or []):
        c['a'], c['b'] = r2(c['a']), r2(c['b'])
    for d in m['doors']:
        d['pos'] = r3(d['pos']); d['approach'] = r2(d['approach']); d['heading'] = rh(d['heading'])
    for a in m['anchors']:
        a['pos'] = r3(a['pos'])
        if 'heading' in a:
            a['heading'] = rh(a['heading'])
    for w in m['windows']:
        w['pos'] = r3(w['pos'])
    m.setdefault('notes', []).append('rotated 90 deg clockwise at build time (river-side feature faces the game camera)')


def cheap_door(fr, did='door', style='plank', color='brown', open_deg=0.0, hinge='left', recess=0.12, step='ashlar',
               lintel=None, surround=None, fanlight=False, name=None, node=None, handle=True):
    """Budget door (same contract as kit door: node 'door_<did>' pivoted at the hinge + door meta): box frame, one leaf with
    ledges (plank) / raised fields (panel) / upper glazing (glazed), strap hinges + knob. ~80 tris instead of ~300-500."""
    import kit_arch as KA
    import kit_core as C
    name = name or 'door_' + did
    node = node or name
    tint = KA._paint(color)
    fw, fd = 0.085, 0.1
    d0, d1 = -recess - fd, -recess
    top = fr.h - (fr.rise if fr.shape != 'rect' else 0)
    bm = K.bm_new()
    for sx in (-1, 1):
        KA.lbox(bm, fr, sx * fr.w / 2 - (fw if sx > 0 else 0), sx * fr.w / 2 + (fw if sx < 0 else 0), 0, top, d0, d1)
    if fr.shape == 'rect':
        KA.lbox(bm, fr, -fr.w / 2, fr.w / 2, top - fw, top, d0, d1)
    else:
        ol = sorted([p for p in fr.outline(4) if p[1] > top - 1e-3], key=lambda p: p[0])
        for a, b in zip(ol[:-1], ol[1:]):
            K.beam_bm(bm, fr.p(a[0], a[1] - fw / 2, (d0 + d1) / 2), fr.p(b[0], b[1] - fw / 2, (d0 + d1) / 2), fw, fd, up=V(fr.n))
        bmf = K.bm_new()                                     # fanlight glass in the arch head
        KA.lpoly(bmf, fr, [(x, max(z, top)) for x, z in fr.outline(4, fw) if z >= top - 1e-3], d0 + 0.03)
        K.part(bmf, 'glass_dirty', name=name + '_fan', grime=0, bisect=False)
    K.part(bm, 'timber_beam' if style in ('barn', 'plank') else 'wood_paint', name=name + '_frame',
           mat_tint=None if style in ('barn', 'plank') else tint, uv='beam', axis=(0, 0, 1), bisect=False)
    w = fr.w - 2 * fw
    hs = -1 if hinge == 'left' else 1
    hp = fr.p(hs * w / 2, 0.01, d0 + 0.01)
    right = -fr.r * hs
    ang = -hs * math.radians(open_deg)
    from mathutils import Matrix
    Rm = Matrix.Rotation(ang, 3, 'Z')
    L = lambda x, z, d: hp + Rm @ (right * x + V((0, 0, z)) + fr.n * d)      # leaf-local -> world (x from hinge)
    bm = K.bm_new()
    lh = top - fw - 0.02

    def lb(x0, x1, z0, z1, e0, e1):
        pts = [L(x, z, e) for z in (z0, z1) for x, e in ((x0, e0), (x1, e0), (x1, e1), (x0, e1))]
        K.hexa_bm(bm, pts)
    lb(0.0, w, 0.0, lh, 0.0, 0.05)
    if style in ('plank', 'barn'):
        for z in (0.3, lh - 0.35):
            lb(0.05, w - 0.05, z - 0.08, z + 0.08, -0.03, 0.0)
    else:
        for z0, z1 in ((0.2, lh * 0.42), (lh * 0.5, lh - 0.18)):
            if style == 'glazed' and z0 > 0.5:
                continue
            for x0, x1 in ((0.1, w / 2 - 0.05), (w / 2 + 0.05, w - 0.1)):
                lb(x0, x1, z0, z1, 0.05, 0.075)
    bmesh_ = __import__('bmesh')
    bmesh_.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = K.part(bm, 'door_planks' if style in ('plank', 'barn') else 'wood_paint', name=name + '_leaf', node=node, mat_tint=tint,
                uv='beam', axis=(0, 0, 1), grime=0.6, bisect=False)
    ob['kit_pivot'] = list(hp)
    if style == 'glazed':
        bmg = K.bm_new()
        q = [L(0.12, lh * 0.5, 0.06), L(w - 0.12, lh * 0.5, 0.06), L(w - 0.12, lh - 0.15, 0.06), L(0.12, lh - 0.15, 0.06)]
        bmg.faces.new([bmg.verts.new(p) for p in q])
        og = K.part(bmg, 'glass_dirty', name=name + '_leafglass', node=node, grime=0, bisect=False)
        og['kit_pivot'] = list(hp)
    bm = K.bm_new()
    for z in (0.35, lh - 0.4):
        a = L(0, z, 0.062)
        K.beam_bm(bm, a, a + Rm @ right * w * 0.55, 0.012, 0.045, up=Rm @ V(fr.n))
    if handle:
        c = L(w - 0.1, 1.0, 0.06)
        K.cyl_bm(bm, c, c + Rm @ V(fr.n) * 0.04, 0.035, 6)
    ob2 = K.part(bm, 'cast_iron', name=name + '_iron', node=node, grime=0.1, bisect=False)
    ob2['kit_pivot'] = list(hp)
    if step:
        bm = K.bm_new()
        KA.lbox(bm, fr, -fr.w / 2 - 0.12, fr.w / 2 + 0.12, -0.16, 0.0, d1 - 0.02, 0.38)
        K.part(bm, step, name=name + '_step')
    if lintel:
        bm = K.bm_new()
        KA.lbox(bm, fr, -fr.w / 2 - 0.14, fr.w / 2 + 0.14, fr.h, fr.h + 0.24, -0.02, 0.025)
        K.part(bm, lintel, name=name + '_lintel')
    if surround:
        KA.jamb_blocks(fr, surround, name=name + '_surround')
    C.A.__dict__.setdefault('frames', []).append(fr)
    C.door_meta(did, tuple(fr.o), fr.n, fr.w, fr.h, kind='barn' if style == 'barn' else 'door', node=node)
    return node


def use_cheap_doors():
    import kit_arch as KA
    KA.door = cheap_door
    K.door = cheap_door


def skylights(R, spots, w=0.6, h=0.85, name='skylights'):
    """Cast-iron roof lights (tabatieres) lying on slope R at roof-local spots [(lx, ly)]: raised frame + dirty glass."""
    import bmesh
    p = math.radians(R.pitch)
    t = math.tan(p)
    bf, bg = K.bm_new(), K.bm_new()
    for lx, ly in spots:
        s = 1 if ly > 0 else -1
        up = (R.ay * (-s) * math.cos(p) + V((0, 0, math.sin(p)))).normalized()
        nrm = R.ax.cross(up).normalized()
        nrm = nrm if nrm.z > 0 else -nrm
        c = R.w(lx, ly, R.z_eave + (R.W / 2 - abs(ly)) * t + R.lift)
        for a, b in (((-w / 2, -h / 2), (w / 2, -h / 2)), ((w / 2, -h / 2), (w / 2, h / 2)), ((w / 2, h / 2), (-w / 2, h / 2)), ((-w / 2, h / 2), (-w / 2, -h / 2))):
            pa = c + R.ax * a[0] + up * a[1] + nrm * 0.05
            pb = c + R.ax * b[0] + up * b[1] + nrm * 0.05
            K.beam_bm(bf, pa, pb, 0.06, 0.1, up=nrm)
        q = [c + R.ax * x + up * y + nrm * 0.085 for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
        f = bg.faces.new([bg.verts.new(x) for x in q])
        if f.normal.dot(nrm) < 0:
            f.normal_flip()
    K.part(bf, 'cast_iron', name=name + '_frame', mat_tint=(0.4, 0.42, 0.42), grime=0.3, bisect=False)
    K.part(bg, 'glass_dirty', name=name + '_glass', grime=0.0, bisect=False)


# ---- rework 2: alpha-tested foliage clumps (lib 'foliage_atlas': 0 iris | 1 grass tuft | 2 broadleaf weeds | 3 fern) ---
def foliage(spots, cell=1, name='foliage', tint=None, lod='drop', cards=2, seed=7, lean=0.18, node=None):
    """spots = [(x, y, z, h)] or [(x, y, z, h, w)]: crossed vertical alpha cards (2-3 per clump), base at z.
    Leaves read as leafy green-grey clumps with alpha instead of solid spikes."""
    import bmesh, random
    rr = random.Random(seed)
    bm = K.bm_new()
    lay = bm.loops.layers.uv.new('UVMap')
    cells = cell if isinstance(cell, (list, tuple)) else (cell,)
    for s in spots:
        x, y, z, h = s[:4]
        w = s[4] if len(s) > 4 else h * 1.0
        c = cells[rr.randrange(len(cells))]
        u0, v0 = (c % 2) * 0.5 + 0.004, (0.5 - (c // 2) * 0.5) + 0.002
        u1, v1 = u0 + 0.492, v0 + 0.494
        if rr.random() < 0.5:
            u0, u1 = u1, u0
        a0 = rr.uniform(0, math.pi)
        for k in range(cards):
            a = a0 + k * math.pi / cards
            d = V((math.cos(a), math.sin(a), 0)) * (w / 2)
            tl = V((rr.uniform(-lean, lean), rr.uniform(-lean, lean), 0)) * h
            b = V((x, y, z - 0.03))
            vs = [bm.verts.new(p) for p in (b - d, b + d, b + d + tl + V((0, 0, h)), b - d + tl + V((0, 0, h)))]
            f = bm.faces.new(vs)
            for l, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                l[lay].uv = uv
    kw = dict(name=name, uv='keep', grime=0.0, bisect=False, jitter=0.08, mat_tint=tint, lod=lod)
    if node:
        kw['node'] = node
    ob = K.part(bm, 'foliage_atlas', **kw)
    return ob


def foliage_line(xa, xb, y, z, n, h=(0.25, 0.5), cell=(1, 2), jit=0.08, rr=None, **kw):
    """n clumps scattered along x in [xa, xb] at y (+-jit), base height z (float or callable(x))."""
    import random
    rr = rr or random.Random(kw.get('seed', 3))
    sp = []
    for _ in range(n):
        x = rr.uniform(xa, xb)
        zz = z(x) if callable(z) else z
        sp.append((x, y + rr.uniform(-jit, jit), zz, rr.uniform(*h)))
    return foliage(sp, cell=cell, **kw)
