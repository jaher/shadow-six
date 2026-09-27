# mdl.py - small procedural modelling kit for hero icon props (metres, Blender Z-up).
# Convention for long objects: length along +X (muzzle/tip at +X), up = +Z, thickness along Y.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler


def link(o):
    bpy.context.scene.collection.objects.link(o); return o


def finish(o, mat=None, bevel=0.0, segs=3, angle=35, smooth=True, wn=True, sub=0, limit='ANGLE'):
    if mat is not None:
        o.data.materials.clear(); o.data.materials.append(mat)
    if smooth and o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = True
        try: o.data.set_sharp_from_angle(angle=math.radians(angle))
        except Exception: pass
    if sub:
        m = o.modifiers.new('sub', 'SUBSURF'); m.levels = sub; m.render_levels = sub
    if bevel > 0:
        m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = segs
        m.limit_method = limit; m.angle_limit = math.radians(angle); m.harden_normals = wn; m.miter_outer = 'MITER_ARC'
    if wn and o.type == 'MESH':
        m = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True
    return o


def from_bm(name, bm, mat=None, **kw):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    return finish(o, mat, **kw)


def chaikin(pts, it=2, closed=True, keep=()):
    """Corner-cutting smoothing; indices in `keep` stay sharp corners (open curves keep their ends)."""
    pts = [Vector(p) for p in pts]; n0 = len(pts)
    flags = [(i in keep) or (not closed and i in (0, n0 - 1)) for i in range(n0)]
    for _ in range(it):
        n = len(pts); out = []; of = []
        for i in range(n if closed else n - 1):
            j = (i + 1) % n; a, b = pts[i], pts[j]
            if flags[i]: out.append(a); of.append(True)
            else: out.append(a.lerp(b, 0.25)); of.append(False)
            if not flags[j]: out.append(a.lerp(b, 0.75)); of.append(False)
        if not closed: out.append(pts[-1]); of.append(True)
        pts, flags = out, of
    return [tuple(p) for p in pts]


def arc(cx, cy, r, a0, a1, n=12, ry=None):
    ry = r if ry is None else ry
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def slab(name, pts, thick, mat, y=0.0, bevel=0.0008, segs=3, plane='XZ', angle=35, taper=None, **kw):
    """Extrude a closed 2D outline (in XZ, X fwd / Z up) by `thick` along Y, centred at y."""
    bm = bmesh.new()
    def P(u, v, w):
        return (u, w, v) if plane == 'XZ' else (u, v, w)
    vs = [bm.verts.new(P(u, v, y - thick / 2)) for u, v in pts]
    f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    ax = 1 if plane == 'XZ' else 2
    for v in top:
        co = list(v.co); co[ax] += thick; v.co = co
    if taper:   # scale the +Y cap about its centroid (rounded look)
        c = sum((v.co for v in top), Vector()) / len(top)
        for v in top: v.co = c + (v.co - c) * taper
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4 and not _convex(f)])
    return from_bm(name, bm, mat, bevel=bevel, segs=segs, angle=angle, **kw)


def _convex(f):
    n = f.normal; vs = [v.co for v in f.verts]; k = len(vs)
    s = [((vs[(i + 1) % k] - vs[i]).cross(vs[(i + 2) % k] - vs[(i + 1) % k])).dot(n) for i in range(k)]
    return all(x >= -1e-12 for x in s) or all(x <= 1e-12 for x in s)


def lathe(name, prof, mat, segs=48, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, cap=True, smooth_angle=60, **kw):
    """Revolve [(r, z), ...] about local Z. r == 0 points collapse to the axis."""
    bm = bmesh.new(); rings = []
    for r, z in prof:
        if r <= 1e-7:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1: continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1: bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1: bm.faces.new((a[i], b[0], a[j]))
            else: bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        for ring in (rings[0], rings[-1]):
            if len(ring) > 2: bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = from_bm(name, bm, mat, bevel=bevel, angle=smooth_angle, **kw)
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    return o


def cyl(name, r, h, mat, loc=(0, 0, 0), rot=(0, 0, 0), segs=40, r2=None, bevel=0.0004, **kw):
    """Cylinder along local Z from -h/2..h/2 (rot in degrees)."""
    r2 = r if r2 is None else r2
    return lathe(name, [(0, -h / 2), (r, -h / 2), (r2, h / 2), (0, h / 2)], mat, segs, loc, rot, bevel=bevel, cap=False, smooth_angle=40, **kw)


def box(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0006, segs=3, **kw):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = from_bm(name, bm, mat, bevel=bevel, segs=segs, **kw)
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    return o


def tube(name, pts, r, mat, segs=16, closed=False, res=12, taper=None, **kw):
    """Round wire/tube along 3D points (poly spline smoothed as NURBS-like bezier)."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = max(2, segs // 4); cu.resolution_u = res; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    sp.use_cyclic_u = closed
    o = link(bpy.data.objects.new(name, cu))
    if taper:
        for bp, t in zip(sp.bezier_points, taper): bp.radius = t
    return to_mesh(o, mat, **kw)


def to_mesh(o, mat=None, **kw):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    name = o.name; bpy.data.objects.remove(o, do_unlink=True)
    no = link(bpy.data.objects.new(name, me))
    kw.setdefault('bevel', 0.0); kw.setdefault('angle', 60)
    return finish(no, mat, **kw)


def empty(name, loc=(0, 0, 0)):
    e = link(bpy.data.objects.new(name, None)); e.location = loc; return e


def group(name, objs, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """Parent objs to a new empty, then place/rotate the whole group (rot in degrees, XYZ)."""
    root = empty(name)
    for o in objs:
        o.parent = root
    root.location = loc; root.rotation_euler = [math.radians(a) for a in rot]; root.scale = (scale,) * 3
    bpy.context.view_layer.update()
    return root


def hot(loc, parent=None):
    e = empty('hot', loc)
    if parent: e.parent = parent
    return e


def text(name, s, size, mat, loc=(0, 0, 0), rot=(0, 0, 0), extrude=0.0, font=None, align='CENTER', bevel=0.0):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = s; cu.size = size; cu.extrude = extrude
    cu.align_x = align; cu.align_y = 'CENTER'; cu.bevel_depth = bevel
    if font: cu.font = bpy.data.fonts.load(font, check_existing=True)
    o = link(bpy.data.objects.new(name, cu)); o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    o.data.materials.append(mat)
    return o


def join(objs, name):
    """Apply modifiers is not needed; join keeps per-object materials. Returns the joined object."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); objs[0].name = name
    return objs[0]


def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear(); old = o.data; o.data = me
    return o


def deform(o, fn):
    """Apply fn(Vector)->Vector to every vertex (after applying modifiers)."""
    apply_mods(o)
    for v in o.data.vertices: v.co = fn(v.co.copy())
    o.data.update()
    return o


def bend(o, axis_len, angle_deg, axis='X', up='Z'):
    """Bend along X by total angle (deg) over axis_len (simple deform)."""
    m = o.modifiers.new('bend', 'SIMPLE_DEFORM'); m.deform_method = 'BEND'; m.angle = math.radians(angle_deg); m.deform_axis = up
    return o


def decal(name, mat, w, h, loc=(0, 0, 0), rot=(0, 0, 0), bend=None):
    """UV-mapped quad (w x h, metres) facing +Z before rotation; for printed labels/dials. bend=(radius) wraps around Y axis."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=24 if bend else 1, y_subdivisions=1, size=1.0)
    o = bpy.context.active_object; o.name = name
    for v in o.data.vertices:
        v.co.x *= w; v.co.y *= h
        if bend:
            a = v.co.x / bend; v.co.x = bend * math.sin(a); v.co.z = bend * math.cos(a) - bend
    o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = True
    return o


def squash(o, s):
    """Scale the mesh about its own bounding-box centre (s = (sx, sy, sz)); keeps it where it was built."""
    apply_mods(o) if False else None
    vs = o.data.vertices
    lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
    hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
    c = (lo + hi) / 2
    for v in vs:
        d = v.co - c; v.co = c + Vector((d.x * s[0], d.y * s[1], d.z * s[2]))
    o.data.update()
    return o


def cut(target, cutters, solver='EXACT'):
    """Boolean-difference `cutters` (objects, removed afterwards) out of `target`; modifiers applied in place."""
    for c in cutters:
        m = target.modifiers.new('cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.solver = solver; m.object = c
        c.hide_render = True; c['no_frame'] = True
        c.parent = target; c.matrix_parent_inverse = target.matrix_world.inverted()   # follows D.group transforms
    # boolean must run before bevel/weighted normals: move the new modifiers to the top of the stack
    for i, m in enumerate([m for m in target.modifiers if m.type == 'BOOLEAN']):
        with bpy.context.temp_override(object=target):
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=i)
    return target
