# animal_lib.py - shared Blender toolkit for the e03 circus animals (lion, lioness, ostrich, hen): skin-modifier
# bodies, shaggy shells (mane, plumes, feathers), rigid parts, armatures, per-vertex coat paint, the coat bake
# (vertex colour x strand noise into a small atlas), LODs, GLB + sidecar export, and a Poser for keyframed clips.
# Project-authored geometry, rig and clips (CC0). Forward = -Y, Z up, metres (like the guard dog, dog_geo.py): the
# exported model faces +Z in three.js. Run inside Blender 4.0+ (build_animal.py).
import bpy, bmesh, os, sys, json, math, random
from mathutils import Vector, Matrix, Quaternion, noise


def log(*a):
    print('[animals]', *a, flush=True)


def clean_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for d in list(coll):
            coll.remove(d)


def activate(o):
    for x in bpy.context.scene.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


def new_obj(name, me):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def apply_mods(o):
    activate(o)
    for md in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


# ------------------------------------------------------------------ bodies
def skin_body(name, J, RAD, EDGES, root, levels=2):
    """A skin-modifier body: joints J {key: (x, y, z)}, radii RAD {key: (w, h)}, EDGES [(a, b)], `root` the root vertex."""
    keys = list(J.keys())
    me = bpy.data.meshes.new(name)
    me.from_pydata([J[k] for k in keys], [(keys.index(a), keys.index(b)) for a, b in EDGES], [])
    o = new_obj(name, me)
    sk = o.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    for i, k in enumerate(keys):
        r = RAD[k]
        o.data.skin_vertices[0].data[i].radius = (r[0], r[1]) if isinstance(r, (tuple, list)) else (r, r)
    o.data.skin_vertices[0].data[keys.index(root)].use_root = True
    ss = o.modifiers.new('sub', 'SUBSURF')
    ss.levels = levels
    apply_mods(o)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def displace(o, amp, freq, seed=0, octaves=3, region=None):
    """Push the vertices along their normals by fractal noise (muscle / fur lumps): amp m, freq 1/m."""
    me = o.data
    me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
    off = Vector((seed * 7.13, seed * 3.71, seed * 5.19))
    for v in me.vertices:
        if region and not region(v.co):
            continue
        n = noise.fractal(v.co * freq + off, 0.6, 2.0, octaves)
        v.co += v.normal * (amp * n)


def shaggy_shell(name, center, radii, subdiv=4, seed=1, amp=0.06, freq=6.0, droop=0.0, cut=None, tuft=0.0, tuft_freq=14.0,
                 back=0.0, scale_fn=None, dent=None):
    """A shaggy shell (a mane, a plume, a feather coat): an ellipsoid icosphere around `center` with `radii`, pushed out
    by clumped noise (turbulence: tufts and partings), the parts below the centre drooping by `droop` (hair hangs),
    `back` sweeping the outer layer backwards (+Y), `cut(co)` removing the faces whose centres it accepts (the face
    opening). Returns the object (smooth shaded)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    c = Vector(center)
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    for v in bm.verts:
        d = v.co.normalized()
        p = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2]))
        k = 1.0 if scale_fn is None else scale_fn(d)
        t = noise.turbulence(d * freq + off, 4, False)          # 0..~1.5 clumps
        f = noise.fractal(d * tuft_freq + off * 1.7, 0.5, 2.0, 2)  # finer tufts
        push = amp * k * (0.35 + 0.65 * t) + tuft * k * max(0.0, f)
        q = c + p + d * push
        if d.z < 0:                                               # hair hangs: the lower half pulled down
            q.z -= droop * k * (-d.z) * (0.6 + 0.4 * t)
        q.y += back * k * max(0.0, 0.3 + d.y) * (0.5 + 0.5 * t)
        v.co = q
    if dent:   # a dish pressed into the front (the face's place): a closed surface, no opening to see into
        for v in bm.verts:
            v.co = dent(v.co)
    if cut:
        dead = [f for f in bm.faces if cut(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def hair_clumps(name, roots, seed=1, length=(0.10, 0.2), width=(0.025, 0.045), back=0.5, down=0.35, curl=0.25, lift=1.0, flat=0.6):
    """Hair clumps (a mane's silhouette): for each root (point, outward normal) a 4-sided tapered spike, its axis the
    normal swept `back` towards +Y and `down`, bent by `curl` along its length (two segments). One object; each clump's
    root ring sits just under the surface it grows from."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for p, n in roots:
        L = rnd.uniform(*length); w = rnd.uniform(*width)
        ax = (Vector(n) * lift + Vector((0, back, 0)) + Vector((0, 0, -down))).normalized()
        side = ax.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize(); up = side.cross(ax).normalized()
        base = Vector(p) - ax * (0.25 * w)
        mid = base + ax * (L * 0.55) + Vector((0, 0, -curl * L * 0.25)) + side * rnd.uniform(-0.2, 0.2) * L * 0.3
        tip = mid + (ax + Vector((0, curl * 0.3, -curl))).normalized() * (L * 0.45)
        ring0 = [bm.verts.new(base + (side * math.cos(a) + up * math.sin(a) * flat) * w) for a in (0.0, math.pi / 2, math.pi, 1.5 * math.pi)]
        ring1 = [bm.verts.new(mid + (side * math.cos(a) + up * math.sin(a) * flat) * w * 0.6) for a in (0.0, math.pi / 2, math.pi, 1.5 * math.pi)]
        t = bm.verts.new(tip)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
            bm.faces.new((ring1[i], ring1[j], t))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = new_obj(name, me)
    for pp in o.data.polygons:
        pp.use_smooth = True
    return o


def surface_roots(o, count, pred=None, seed=1):
    """`count` random (point, normal) samples of a mesh object's vertices (accepted by pred(co, normal))."""
    rnd = random.Random(seed)
    vs = [(v.co.copy(), v.normal.copy()) for v in o.data.vertices if not pred or pred(v.co, v.normal)]
    rnd.shuffle(vs)
    return vs[:count]


def bm_sphere(bm, r, M, u=8, v=6):
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=u, v_segments=v, radius=r, matrix=M)
    me = bpy.data.meshes.new('_t'); tmp.to_mesh(me); tmp.free()
    bm.from_mesh(me); bpy.data.meshes.remove(me)


def bm_cone(bm, r1, r2, depth, M, segs=8):
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth, matrix=M)
    me = bpy.data.meshes.new('_t'); tmp.to_mesh(me); tmp.free()
    bm.from_mesh(me); bpy.data.meshes.remove(me)


def frame(z_axis, up=Vector((0, 0, 1))):
    z = Vector(z_axis).normalized()
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


def seg_matrix(a, b):
    """Matrix placing a +Z-axis primitive of length |b-a| centred between a and b."""
    a, b = Vector(a), Vector(b)
    M = frame(b - a)
    M.translation = (a + b) / 2
    return M


def parts_object(name, builders):
    """Rigid parts in one object: builders = [(group, fn(bm))]; each part's verts land in vertex group `group`."""
    bm = bmesh.new()
    groups = {}
    for g, fn in builders:
        n0 = len(bm.verts)
        fn(bm)
        bm.verts.ensure_lookup_table()
        groups.setdefault(g, []).extend(range(n0, len(bm.verts)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me)
    for g, idx in groups.items():
        vg = o.vertex_groups.new(name=g)
        vg.add(idx, 1.0, 'REPLACE')
    for p in o.data.polygons:
        p.use_smooth = True
    return o


# ------------------------------------------------------------------ rig
def armature(name, BONES, J):
    """BONES {name: (head, tail, parent)}; head / tail a joint key or a coordinate."""
    P = lambda k: Vector(J[k]) if isinstance(k, str) else Vector(k)
    arm = bpy.data.armatures.new(name)
    rig = new_obj(name, arm)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, (h, t, par) in BONES.items():
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = P(h), P(t)
        eb.roll = 0.0
        if par:
            eb.parent = arm.edit_bones[par]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def auto_weights(body, rig, nondeform=()):
    for n in nondeform:
        rig.data.bones[n].use_deform = False
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for n in nondeform:
        rig.data.bones[n].use_deform = True


def rigid_bind(o, rig):
    """Parent `o` (its vertex groups named after bones) to the rig with an Armature modifier."""
    o.parent = rig
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = rig


def weight_by(o, fn):
    """Vertex weights from fn(co) -> {bone: w} (replaces every group)."""
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    groups = {}
    for v in o.data.vertices:
        ws = fn(v.co)
        tot = sum(ws.values()) or 1.0
        for b, w in ws.items():
            if w <= 0:
                continue
            if b not in groups:
                groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([v.index], w / tot, 'REPLACE')


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = objs[0]
    o.name = name
    return o


# ------------------------------------------------------------------ paint and bake
def paint(o, fn):
    """Per-vertex coat colour (sRGB tuple) and strand contrast: fn(co, groups) -> (r, g, b, contrast)."""
    me = o.data
    at = me.color_attributes.get('coat') or me.color_attributes.new('coat', 'FLOAT_COLOR', 'POINT')
    names = {g.index: g.name for g in o.vertex_groups}
    for v in me.vertices:
        gs = {names[g.group]: g.weight for g in v.groups if g.group in names}
        r, g, b, k = fn(v.co, gs)
        at.data[v.index].color = (max(0, r) ** 2.2, max(0, g) ** 2.2, max(0, b) ** 2.2, k)


def bake(o, out_dir, did, scale=(160, 60, 160), size=512, rough=0.85, sheen=0.35, margin=5):
    """The coat albedo: every UV triangle rasterised in Python (this host's headless Cycles bakes nothing): the vertex
    colour times the strand noise (object-space fractal noise stretched by `scale`, its contrast the colour's alpha)
    times a coarse patch noise (dust, sun-bleach), then the islands grown `margin` px against seams."""
    import numpy as np
    activate(o)
    for uv in list(o.data.uv_layers):
        o.data.uv_layers.remove(uv)
    uvl = o.data.uv_layers.new(name='UVMap')
    o.data.uv_layers.active = uvl
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = o.data
    me.calc_loop_triangles()
    ca = me.color_attributes['coat']
    cols = np.array([c.color[:] for c in ca.data], dtype=np.float64)
    co = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    uvd = me.uv_layers.active.data
    acc = np.zeros((size, size, 3), np.float64)
    filled = np.zeros((size, size), bool)
    sx, sy, sz = scale
    for tri in me.loop_triangles:
        uv = np.array([uvd[i].uv[:] for i in tri.loops]) * size - 0.5
        P = co[list(tri.vertices)]
        C = cols[list(tri.vertices)]
        x0, y0 = np.floor(uv.min(0)).astype(int); x1, y1 = np.ceil(uv.max(0)).astype(int)
        x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(size - 1, x1), min(size - 1, y1)
        if x1 < x0 or y1 < y0:
            continue
        (ax, ay), (bx, by), (cx, cy) = uv
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
                w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
                w2 = 1 - w0 - w1
                if w0 < -0.02 or w1 < -0.02 or w2 < -0.02:
                    continue
                p = w0 * P[0] + w1 * P[1] + w2 * P[2]
                c = w0 * C[0] + w1 * C[1] + w2 * C[2]
                n = noise.fractal(Vector((p[0] * sx, p[1] * sy, p[2] * sz)), 0.62, 2.0, 4)
                pt = 0.9 + 0.18 * (0.5 + 0.5 * noise.noise(Vector((p[0] * 3.1, p[1] * 3.1, p[2] * 3.1))))
                k = max(0.05, 1.0 + c[3] * max(-1.0, min(1.0, n * 1.6))) * pt
                acc[py, px] = c[:3] * k
                filled[py, px] = True
    for _ in range(margin):   # grow the islands: empty texels next to filled ones take their neighbours' mean
        sm_ = np.zeros_like(acc); cnt = np.zeros((size, size))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(acc, dy, 0), dx, 1); fh = np.roll(np.roll(filled, dy, 0), dx, 1)
            sm_ += sh * fh[..., None]; cnt += fh
        grow = (~filled) & (cnt > 0)
        acc[grow] = sm_[grow] / cnt[grow][:, None]
        filled |= grow
    srgb = np.clip(acc, 0, 1) ** (1 / 2.2)
    rgba = np.concatenate([srgb, np.ones((size, size, 1))], axis=2).astype(np.float32)
    img = bpy.data.images.new(did + '_albedo', size, size)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(out_dir, did + '_albedo.png'); img.file_format = 'PNG'; img.save()
    fm = bpy.data.materials.new(did + '_coat'); fm.use_nodes = True
    pr = fm.node_tree.nodes['Principled BSDF']
    t = fm.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    fm.node_tree.links.new(t.outputs['Color'], pr.inputs['Base Color'])
    pr.inputs['Roughness'].default_value = rough
    # the fur's sheen, tinted with the coat (the glTF exporter writes the Sheen Tint as sheenColorFactor and drops the
    # weight: a white tint is a full-strength white fuzz that bleaches a tawny coat or a black plumage in the game)
    mean = acc[filled].mean(axis=0) if filled.any() else np.array([0.3, 0.3, 0.3])
    tint = np.clip(sheen * 1.5 * mean, 0.0, 1.0)
    try:
        pr.inputs['Sheen Weight'].default_value = sheen; pr.inputs['Sheen Roughness'].default_value = 0.6
        pr.inputs['Sheen Tint'].default_value = (float(tint[0]), float(tint[1]), float(tint[2]), 1.0)
    except Exception:
        pass
    o.data.materials.clear(); o.data.materials.append(fm)
    o.data.color_attributes.remove(o.data.color_attributes['coat'])
    log('baked coat', did, 'texels', int(filled.sum()))


def make_lod(src, name, target):
    me = src.data.copy(); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.parent = src.parent
    for md in src.modifiers:
        if md.type == 'ARMATURE':
            a = o.modifiers.new('Armature', 'ARMATURE'); a.object = md.object
    activate(o)
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = min(1.0, target / max(1, tri_count(o)))
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    bpy.ops.object.modifier_apply(modifier='dec')
    return o


def export(o, rig, out_dir, did, kind, meta, var, lods=(1800, 700), extra=None):
    o.name = 'LOD0'
    l1 = make_lod(o, 'LOD1', lods[0]); l2 = make_lod(o, 'LOD2', lods[1])
    tris = {x.name: tri_count(x) for x in (o, l1, l2)}
    for x in bpy.data.objects:
        x.select_set(x in (o, l1, l2, rig))
    path = os.path.join(out_dir, did + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
        export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_range=False, export_skins=True, export_yup=True,
        export_image_format='JPEG', export_jpeg_quality=86, export_texcoords=True, export_normals=True, export_def_bones=False,
        export_extras=True, export_optimize_animation_size=True)
    sc = {'id': did, 'kind': kind, 'glb': did + '.glb', 'bytes': os.path.getsize(path), 'tris': tris, 'materials': 1,
          'lods': ['LOD0', 'LOD1', 'LOD2'], 'lod_rule': 'LOD0 >= 60 px/m, LOD1 >= 28 px/m, else LOD2',
          'skeleton': ', '.join(b.name for b in rig.data.bones), 'clips': meta, 'variation': var,
          'licence': 'project-authored geometry, rig and clips (CC0)'}
    if extra:
        sc.update(extra)
    with open(os.path.join(out_dir, did + '.sidecar.json'), 'w') as f:
        json.dump(sc, f, indent=1)
    log('EXPORTED', path, sc['bytes'], tris)
    return sc


# ------------------------------------------------------------------ clips
FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def sm(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


class Poser:
    """Rotations about ARMATURE axes (X lateral: pitch, Y back: roll, Z up: yaw; the animal faces -Y), converted to each
    bone's rest frame, so the signs do not depend on the bone rolls."""
    def __init__(self, rig):
        self.rig = rig
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones}
        self.rest3 = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def clear(self):
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)

    def rot(self, bone, ax=0.0, ay=0.0, az=0.0):
        if bone not in self.rest:
            return
        q = Quaternion(Z, math.radians(az)) @ Quaternion(Y, math.radians(ay)) @ Quaternion(X, math.radians(ax))
        r = self.rest[bone]
        self.rig.pose.bones[bone].rotation_quaternion = r.inverted() @ q @ r

    def loc(self, bone, v):
        self.rig.pose.bones[bone].location = self.rest3[bone].inverted() @ Vector(v)

    def key(self, frame):
        for pb in self.rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if pb.name == 'root':
                pb.keyframe_insert('location', frame=frame)


def make_clip(P, name, dur, fn, loop=True):
    rig = P.rig
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    n = max(2, int(round(dur * FPS)))
    for f in range(n + 1):
        P.clear()
        fn(f / n, f / FPS)
        P.key(f)
    act['loop'] = loop
    return act


def ground_speed(rig, act, feet, dur):
    """The planted foot's backward speed under the body, median over the cycle (m/s at timeScale 1)."""
    rig.animation_data.action = act
    sc = bpy.context.scene
    n = max(8, int(round(dur * FPS)))
    prev, v = None, []
    for f in range(n + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ro = rig.evaluated_get(dg)
        now = [(ro.matrix_world @ ro.pose.bones[b].tail) for b in feet]
        if prev:
            k = min(range(len(now)), key=lambda i: now[i].z)
            v.append(abs(now[k].y - prev[k].y) * FPS)
        prev = now
    v.sort()
    return round(v[len(v) // 2], 3) if v else 0.0


def render_preview(objs, out, views=((35, 30), (90, 15), (200, 25)), dist=3.0, target=(0, 0, 0.5), size=(640, 480)):
    """Quick Eevee turnaround of `objs` (sun + sky) into out-<k>.png: for the builder's own eyes."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = size
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.7, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5
    so = new_obj('sun', sun); so.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    ground = bpy.data.meshes.new('g'); bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6); bm.to_mesh(ground); bm.free()
    go = new_obj('ground', ground); gm = bpy.data.materials.new('gm'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.30, 0.25, 1); ground.materials.append(gm)
    cam = bpy.data.cameras.new('cam'); cam.lens = 50; co = new_obj('cam', cam); sc.camera = co
    t = Vector(target)
    for i, (az, el) in enumerate(views):
        a, e = math.radians(az), math.radians(el)
        co.location = t + Vector((math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e))) * dist
        d = t - co.location
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{out}-{i}.png'
        bpy.ops.render.render(write_still=True)
    for o in (so, go, co):
        bpy.data.objects.remove(o, do_unlink=True)
