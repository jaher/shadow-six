"""Kit weathering: decals (shared atlas), snow caps, moss, damage / ruin generator, rubble."""
import bpy, bmesh, math, json, os
from mathutils import Vector as V, Matrix
import kit_core as C
from kit_core import part, rng

_RECTS = None


def rects():
    global _RECTS
    if _RECTS is None:
        p = os.path.join(C.LIB, 'decals.json')
        _RECTS = json.load(open(p)) if os.path.exists(p) else {'decals': {}, 'signs': {}}
    return _RECTS


def decal(kind, center, normal, w, h, up=(0, 0, 1), offset=0.006, flip=False, name=None, node='decals', alpha=0.85):
    """Alpha-blended decal quad from the shared atlas (kinds: see lib/decals.json 'decals').
    center = world centre ON the surface; normal = surface normal; w x h metres."""
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
    rc = list(rects()['decals'].get(kind, [0, 0, 0.25, 0.25]))
    if flip:
        rc[0], rc[2] = rc[2], rc[0]
    C.uv_rect(bm, f, rc)
    return part(bm, 'decals', name=name or 'decal_' + kind, uv='keep', grime=0, node=node, bisect=False, jitter=0.0, alpha=alpha)


def decal_on_frame(fr, kind, x, z, w, h, d=0.0, alpha=0.7):
    return decal(kind, fr.p(x, z, d), fr.n, w, h, alpha=alpha)


SKIP_SNOW = ('glass_dirty', 'decals', 'interior_dark', 'curtain', 'signs', 'snow', 'sod')


def snow_pass(thick=0.09, min_nz=0.45, noise=0.35, parts=None, skip=SKIP_SNOW, min_area=0.004):
    """Top-facing snow layer: for every part, faces with normal.z > min_nz get a snow slab extruded upward
    (thicker on flatter faces, noisy drifts). Call after all geometry, before finalize()."""
    from mathutils import noise as N
    src = [o for o in (parts or C.A.parts) if o.get('kit_node', 'main') == 'main' and o.data.materials
           and o.data.materials[0].get('kit_id') not in skip]
    out = bmesh.new()
    for o in src:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        kill = [f for f in bm.faces if f.normal.z <= min_nz or f.calc_area() < min_area]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        if not bm.faces:
            bm.free()
            continue
        faces = bm.faces[:]
        nz = {v: max((f.normal.z for f in v.link_faces), default=1) for v in bm.verts}
        ext = bmesh.ops.extrude_face_region(bm, geom=faces)
        top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        for v in top:
            n = nz.get(v, 1.0)
            k = 1 + noise * N.noise(v.co * 1.3)
            v.co.z += thick * (0.35 + 0.65 * n) * max(0.2, k)
        bmesh.ops.delete(bm, geom=faces, context='FACES')
        tmp = bpy.data.meshes.new('snowtmp')
        bm.to_mesh(tmp)
        bm.free()
        out.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    for l in list(out.loops.layers.uv):
        pass
    return part(out, 'snow', name='snow', grime=0, bisect=False, jitter=0.02)


def _blob_bm(center, radius, seed, squash=(1, 1, 1), subdiv=2, rough=0.35):
    from mathutils import noise as N
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    c = V(center)
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + rough * N.noise(d * 2.2 + V((seed * 1.7, seed * 0.3, 0)))
        v.co = c + V((v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2])) * k
    return bm


def bite(center, radius, squash=(1, 0.8, 1.2), seed=1, parts=None):
    """Blast damage: subtract a noisy blob from every intersecting part; window/door bits whose centre falls inside
    are removed (glass blown out). Use for ruined variants (then add rubble() below)."""
    import kit_arch as KA
    c = V(center)
    R = radius * max(squash) * 1.4
    for o in list(parts or C.A.parts):
        if o.name not in bpy.data.objects:
            continue
        bb = [o.matrix_world @ V(b) for b in o.bound_box]
        mn = V([min(p[i] for p in bb) for i in range(3)])
        mx = V([max(p[i] for p in bb) for i in range(3)])
        near = V([max(mn[i], min(c[i], mx[i])) for i in range(3)])
        if (near - c).length > R:
            continue
        mid = (mn + mx) / 2
        kid = o.data.materials[0].get('kit_id') if o.data.materials else ''
        if (mid - c).length < radius * 0.9 and ((mx - mn).length < 2.5 or kid in ('glass_dirty', 'interior_dark', 'curtain', 'decals')):
            C.A.parts.remove(o)
            bpy.data.objects.remove(o)
            continue
        KA.cut_object(o, _blob_bm(c, radius, seed, squash))


def rubble(center, radius=2.0, height=0.9, mids=('fieldstone', 'ashlar'), n=40, beams=3, tiles='roof_slate', seed=None,
           name='rubble', footprint=True):
    """Rubble pile: noisy earth/debris mound + scattered stone chunks + broken beams + roof-tile shards.
    Registers a LOW footprint (crawl cover)."""
    from mathutils import noise as N
    r = rng()
    c = V(center)
    bm = bmesh.new()                                     # mound
    rings, segs = 5, 14
    verts = [[None] * segs for _ in range(rings)]
    for i in range(rings):
        t = i / (rings - 1)
        for j in range(segs):
            a = 2 * math.pi * j / segs
            rr = radius * (1 - t) * (1 + 0.25 * N.noise(V((math.cos(a) * 2, math.sin(a) * 2, t * 3 + (seed or 0)))))
            z = height * (1 - (1 - t) ** 2) * (0.8 + 0.4 * r.random())
            verts[i][j] = bm.verts.new(c + V((math.cos(a) * rr, math.sin(a) * rr, z - 0.05)))
    for i in range(rings - 1):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((verts[i][j], verts[i][k], verts[i + 1][k], verts[i + 1][j]))
    part(bm, 'gravel', name=name + '_mound', grime=0.5)
    bm = bmesh.new()
    for i in range(n):
        a, d = r.uniform(0, 2 * math.pi), radius * math.sqrt(r.random()) * 0.95
        p = c + V((math.cos(a) * d, math.sin(a) * d, 0))
        z = height * (1 - (d / radius) ** 2) * 0.8
        s = r.uniform(0.15, 0.45)
        cb = _blob_bm(p + V((0, 0, z + s * 0.2)), s, r.random() * 10, (1, r.uniform(0.6, 1), r.uniform(0.4, 0.8)), 1, 0.3)
        tmp = bpy.data.meshes.new('ch')
        cb.to_mesh(tmp)
        cb.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    part(bm, mids[0], name=name + '_stones')
    bm = bmesh.new()
    for i in range(beams):
        a = r.uniform(0, math.pi)
        L = r.uniform(1.5, radius * 1.8)
        p = c + V((r.uniform(-0.5, 0.5) * radius, r.uniform(-0.5, 0.5) * radius, height * 0.5))
        d = V((math.cos(a), math.sin(a), r.uniform(-0.35, 0.35))).normalized()
        beam_bm = __import__('kit_core').beam_bm
        beam_bm(bm, p - d * L / 2, p + d * L / 2, 0.18, 0.2, roll=r.uniform(0, 1))
    part(bm, 'timber_tarred', name=name + '_beams', uv='beam', axis=(1, 0, 0))
    if tiles:
        bm = bmesh.new()
        box = __import__('kit_core').box_bm
        for i in range(n // 2):
            a, d = r.uniform(0, 2 * math.pi), radius * r.uniform(0.3, 1.1)
            p = c + V((math.cos(a) * d, math.sin(a) * d, max(0.02, height * (1 - (d / radius) ** 2) * 0.8)))
            box(bm, tuple(p), (r.uniform(0.2, 0.35), r.uniform(0.15, 0.25), 0.02), r.uniform(0, 3))
        part(bm, tiles, name=name + '_shards', grime=0.3)
    if footprint:
        C.footprint([(c.x + math.cos(a) * radius * 0.8, c.y + math.sin(a) * radius * 0.8) for a in [2 * math.pi * k / 8 for k in range(8)]], 'LOW', 'rubble')


def roof_holes(R, holes, battens=True, name='roofdmg'):
    """Missing roof covering: cut holes [(lx, ly, radius), ...] (roof-local) through the slopes of roof R and expose the
    rafters/battens underneath (rafters are full length; they only show through the holes)."""
    import kit_arch as KA
    t = math.tan(math.radians(R.pitch))
    for lx, ly, rad in holes:
        cut = _blob_bm(R.w(lx, ly, R.z_eave + (R.W / 2 - abs(ly)) * t + R.lift), rad, lx + ly, (1.3, 1.0, 0.7), 2, 0.4)
        for ob in list(getattr(R, 'parts', [])):
            if 'slope' in ob.name or 'hip' in ob.name:
                KA.cut_object(ob, cut)
        cut.free()
    if battens:
        bm = bmesh.new()
        from kit_core import beam_bm as bb
        n = int(R.L / 0.6)
        for s in (-1, 1):
            for i in range(n + 1):
                lx = -R.L / 2 + R.L * i / n
                bb(bm, R.w(lx, s * (R.W / 2 + 0.2), R.z_eave + R.lift * 0.3 - 0.2 * t), R.w(lx, 0, R.z_ridge - R.lift * 0.9), 0.08, 0.16)
            for k in range(1, int(R.W / 2 / 0.35)):
                ly = s * (R.W / 2 - k * 0.35)
                z = R.z_eave + (R.W / 2 - abs(ly)) * t + R.lift - 0.2
                bb(bm, R.w(-R.L / 2, ly, z), R.w(R.L / 2, ly, z), 0.05, 0.03)
        part(bm, 'timber_beam', name=name + '_rafters', uv='beam', axis=tuple(R.ax))


def scorch_openings(scale=1.0, prob=0.8):
    """Soot plumes above window/door openings (burnt / shelled variants). Uses the frames recorded by window()/door()."""
    r = rng()
    for fr in getattr(C.A, 'frames', []):
        if r.random() < prob:
            decal('soot', fr.p(0, fr.h + 0.55 * scale, 0.0), fr.n, fr.w * 1.7 * scale, 1.5 * scale, alpha=0.9)
