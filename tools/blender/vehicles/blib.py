# blib.py - shared helpers for scripted WWII asset production in Blender 4.0 (headless)
# Geometry helpers (bmesh), box-mapped UVs, PBR+grime node materials (Cycles bake),
# atlas baking (albedo / normal / ORM), glTF export and EEVEE preview renders.
import bpy, bmesh, math, os, time, json
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(ROOT, 'tex')
HDRI = os.path.join(ROOT, 'hdri')
T0 = time.time()

def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)

# ----------------------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(c):
            c.remove(d)

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj

def obj_from_bm(name, bm, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    auto_smooth(me, 40)
    ob = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    return ob

def auto_smooth(me, deg):
    """Blender 4.0: mesh auto-smooth; 4.1+: auto smooth was removed -> mark sharp edges by angle."""
    if hasattr(me, 'use_auto_smooth'):
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(deg)
    else:
        me.set_sharp_from_angle(angle=math.radians(deg))

def set_mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob

# ----------------------------------------------------------------------------- primitives
def box(name, size, loc=(0, 0, 0), mat=None, bevel=0.0, segs=2, rot=None):
    """Axis aligned box, size (x,y,z) meters, loc = center."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(rot[1]), 3, rot[0]), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = obj_from_bm(name, bm, mat)
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    return ob

def add_bevel(ob, width, segs=2, angle=40, harden=True):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = harden
    m.miter_outer = 'MITER_ARC'
    return m

def weighted_normals(ob):
    m = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
    m.keep_sharp = True
    return m

def cylinder(name, r, depth, loc=(0, 0, 0), axis='Z', segs=16, mat=None, r2=None, bevel=0.0, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = obj_from_bm(name, bm, mat, smooth=True)
    if bevel > 0:
        add_bevel(ob, bevel, 1, angle=60)
    return ob

def beam(name, p0, p1, w, h=None, mat=None, bevel=0.0, up=(0, 0, 1)):
    """Rectangular beam (w x h cross-section) from p0 to p1."""
    h = w if h is None else h
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, h, L)), verts=bm.verts)
    # local z -> d
    z = d.normalized()
    upv = Vector(up)
    if abs(z.dot(upv)) > 0.99:
        upv = Vector((0, 1, 0)) if abs(z.y) < 0.99 else Vector((1, 0, 0))
    x = upv.cross(z).normalized()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed()
    bmesh.ops.transform(bm, matrix=M.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=bm.verts)
    ob = obj_from_bm(name, bm, mat)
    if bevel > 0:
        add_bevel(ob, bevel, 1)
    return ob

def log_cyl(name, p0, p1, r, mat=None, segs=10):
    """Round timber (pole) from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r * 0.92, depth=d.length)
    z = d.normalized()
    q = Vector((0, 0, 1)).rotation_difference(z)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=bm.verts)
    return obj_from_bm(name, bm, mat, smooth=True)

def prism(name, pts2d, depth, plane='YZ', offset=0.0, mat=None, bevel=0.0, segs=2):
    """Extrude a 2D polygon. plane 'YZ': pts=(y,z), extruded along X from offset-depth/2..offset+depth/2.
    plane 'XZ': pts=(x,z) extruded along Y. plane 'XY': pts=(x,y) extruded along Z."""
    bm = bmesh.new()
    vs = []
    for a, b in pts2d:
        if plane == 'YZ':
            co = (offset - depth / 2, a, b)
        elif plane == 'XZ':
            co = (a, offset - depth / 2, b)
        else:
            co = (a, b, offset - depth / 2)
        vs.append(bm.verts.new(co))
    f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    ax = {'YZ': Vector((depth, 0, 0)), 'XZ': Vector((0, depth, 0)), 'XY': Vector((0, 0, depth))}[plane]
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=ax, verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm, mat)
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    return ob

def rounded_rect(w, h, r, n=4, cx=0.0, cy=0.0, rtop=None, rbot=None):
    """2D rounded rectangle points (CCW). rtop/rbot override radius for top/bottom corners."""
    rt = r if rtop is None else rtop
    rb = r if rbot is None else rbot
    pts = []
    corners = [((w / 2 - rb, -h / 2 + rb), rb, -90), ((w / 2 - rt, h / 2 - rt), rt, 0),
               ((-w / 2 + rt, h / 2 - rt), rt, 90), ((-w / 2 + rb, -h / 2 + rb), rb, 180)]
    for (x, y), rr, a0 in corners:
        if rr <= 1e-6:
            pts.append((cx + x, cy + y))
            continue
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + x + rr * math.cos(a), cy + y + rr * math.sin(a)))
    return pts

def lathe(name, prof, segs=24, axis='X', mat=None, smooth=True):
    """Revolve profile [(r, a)] around axis (a = coordinate along axis). Returns object."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        ring = []
        for r, a in prof:
            c, s = r * math.cos(t), r * math.sin(t)
            if axis == 'X':
                co = (a, c, s)
            elif axis == 'Y':
                co = (c, a, s)
            else:
                co = (c, s, a)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for j in range(len(prof) - 1):
            try:
                bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, mat, smooth=smooth)

def sweep_yz(name, path, prof, x0, mat=None, smooth=True, closed_prof=False, caps=False):
    """Sweep a cross-section profile along a planar path in the YZ plane at X=x0.
    path: [(y,z)], prof: [(px, pn)] where px offsets along X and pn along the in-plane normal."""
    bm = bmesh.new()
    rows = []
    n = len(path)
    for i, (y, z) in enumerate(path):
        a = Vector(path[max(i - 1, 0)]); b = Vector(path[min(i + 1, n - 1)])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))  # left normal in (y,z)
        row = []
        P = prof(i / (n - 1)) if callable(prof) else prof
        for px, pn in P:
            row.append(bm.verts.new((x0 + px, y + nrm.x * pn, z + nrm.y * pn)))
        rows.append(row)
    m = len(rows[0])
    for i in range(n - 1):
        for j in range(m - 1 + (1 if closed_prof else 0)):
            j2 = (j + 1) % m
            bm.faces.new((rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]))
    if caps and closed_prof:
        bm.faces.new(rows[0][::-1])
        bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, mat, smooth=smooth)

def grid_surface(name, fn, nu, nv, mat=None, smooth=True):
    """Parametric surface: fn(u,v)->(x,y,z) with u,v in [0,1]."""
    bm = bmesh.new()
    V = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, mat, smooth=smooth)

def solidify(ob, t, offset=-1):
    m = ob.modifiers.new('Solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = offset
    m.use_even_offset = True
    return m

def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for m in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:
            log('modifier apply fail', ob.name, m.name, e)
    ob.select_set(False)

def apply_xform(ob):
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix()

def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        apply_all(o)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob.select_set(False)
    return ob

def mirror_x(ob):
    """Duplicate object mirrored across X=0 (flips normals back)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    o2 = link(bpy.data.objects.new(ob.name + '_mx', me))
    for m in ob.modifiers:
        m2 = o2.modifiers.new(m.name, m.type)
        for attr in ('width', 'segments', 'limit_method', 'angle_limit', 'harden_normals', 'thickness', 'offset', 'use_even_offset', 'keep_sharp', 'miter_outer'):
            if hasattr(m, attr):
                setattr(m2, attr, getattr(m, attr))
    return o2

def tris(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    e = ob.evaluated_get(dg)
    me = e.to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    e.to_mesh_clear()
    return n

# ----------------------------------------------------------------------------- UVs
def box_uv(ob, scale=1.0, layer='UVMap', swap=False, world=True, jitter=True):
    """Box-projected UVs in meters/scale (consistent texel density). Per-face dominant axis.
    Random per-object offset hides tiling repeats."""
    me = ob.data
    uvl = me.uv_layers.get(layer) or me.uv_layers.new(name=layer)
    M = ob.matrix_world if world else Matrix()
    import random
    rnd = random.Random(hash(ob.name) & 0xffff)
    ou, ov = (rnd.random() * 7, rnd.random() * 7) if jitter else (0, 0)
    for p in me.polygons:
        n = (M.to_3x3() @ p.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = M @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y
            if swap:
                u, v = v, u
            uvl.data[li].uv = (u / scale + ou, v / scale + ov)
    return uvl

def cyl_uv(ob, axis='Z', scale=1.0, layer='UVMap', r=None):
    """Cylindrical UVs around object-local axis (for poles/logs): u = angle*r, v = along axis."""
    me = ob.data
    uvl = me.uv_layers.get(layer) or me.uv_layers.new(name=layer)
    for p in me.polygons:
        cs = [me.vertices[me.loops[li].vertex_index].co for li in p.loop_indices]
        c = sum(cs, Vector()) / len(cs)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if axis == 'Z':
                a, h = math.atan2(co.y, co.x), co.z
                ac = math.atan2(c.y, c.x)
            elif axis == 'X':
                a, h = math.atan2(co.z, co.y), co.x
                ac = math.atan2(c.z, c.y)
            else:
                a, h = math.atan2(co.x, co.z), co.y
                ac = math.atan2(c.x, c.z)
            if a - ac > math.pi: a -= 2 * math.pi
            if a - ac < -math.pi: a += 2 * math.pi
            rr = r or 0.15
            uvl.data[li].uv = (a * rr / scale, h / scale)
    return uvl

# ----------------------------------------------------------------------------- nodes
class NG:
    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.N = self.nt.nodes
        self.L = self.nt.links
        self.x = -1600

    def new(self, t, **kw):
        n = self.N.new(t)
        n.location = (self.x, len(self.N) * -40 % 1200)
        self.x += 40
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def s(self, node, ident, v):
        sock = node.inputs[ident] if isinstance(ident, int) else next((x for x in node.inputs if x.identifier == ident), None) or node.inputs[ident]
        if isinstance(v, bpy.types.NodeSocket):
            self.L.new(v, sock)
        elif v is not None:
            if hasattr(sock, 'default_value'):
                dv = sock.default_value
                if hasattr(dv, '__len__') and not hasattr(v, '__len__'):
                    v = [v] * len(dv)
                if hasattr(dv, '__len__') and len(v) == 3 and len(dv) == 4:
                    v = (*v, 1.0)
                sock.default_value = v
        return sock

    def out(self, node, ident=0):
        if isinstance(ident, int):
            return node.outputs[ident]
        return next((x for x in node.outputs if x.identifier == ident), None) or node.outputs[ident]

    # --- basic ops
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new('ShaderNodeMath', operation=op, use_clamp=bool(clamp))
        self.s(n, 0, a)
        if b is not None:
            self.s(n, 1, b)
        if c is not None:
            self.s(n, 2, c)
        return n.outputs[0]

    def mul(self, a, b, clamp=False): return self.math('MULTIPLY', a, b, clamp=clamp)
    def add(self, a, b, clamp=False): return self.math('ADD', a, b, clamp=clamp)
    def sub(self, a, b, clamp=False): return self.math('SUBTRACT', a, b, clamp=clamp)

    def smooth(self, x, lo, hi, tmin=0.0, tmax=1.0):
        n = self.new('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        self.s(n, 'Value', x); self.s(n, 'From Min', lo); self.s(n, 'From Max', hi)
        self.s(n, 'To Min', tmin); self.s(n, 'To Max', tmax)
        return n.outputs[0]

    def mixc(self, f, a, b, blend='MIX'):
        n = self.new('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self.s(n, 'Factor_Float', f); self.s(n, 'A_Color', a); self.s(n, 'B_Color', b)
        return self.out(n, 'Result_Color')

    def mixf(self, f, a, b):
        n = self.new('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self.s(n, 'Factor_Float', f); self.s(n, 'A_Float', a); self.s(n, 'B_Float', b)
        return self.out(n, 'Result_Float')

    def mixv(self, f, a, b):
        n = self.new('ShaderNodeMix', data_type='VECTOR', clamp_factor=True)
        self.s(n, 'Factor_Float', f); self.s(n, 'A_Vector', a); self.s(n, 'B_Vector', b)
        v = self.new('ShaderNodeVectorMath', operation='NORMALIZE'); self.L.new(self.out(n, 'Result_Vector'), v.inputs[0])
        return v.outputs[0]

    def rgb(self, c):
        n = self.new('ShaderNodeRGB')
        n.outputs[0].default_value = (*c, 1.0)
        return n.outputs[0]

    def bw(self, c):
        n = self.new('ShaderNodeRGBToBW'); self.s(n, 0, c); return n.outputs[0]

    def geo(self):
        return self.new('ShaderNodeNewGeometry')

    def sepxyz(self, v):
        n = self.new('ShaderNodeSeparateXYZ'); self.s(n, 0, v); return n.outputs

    def sepc(self, c):
        n = self.new('ShaderNodeSeparateColor'); self.s(n, 0, c); return n.outputs

    def noise(self, scale, detail=4.0, rough=0.55, vec=None, distortion=0.0, out='Fac', stretch=None):
        n = self.new('ShaderNodeTexNoise')
        if vec is None:
            vec = self.texcoord('Object')
        if stretch is not None:
            m = self.new('ShaderNodeMapping'); self.s(m, 'Vector', vec); self.s(m, 'Scale', stretch)
            vec = m.outputs[0]
        self.s(n, 'Vector', vec); self.s(n, 'Scale', scale); self.s(n, 'Detail', detail)
        self.s(n, 'Roughness', rough); self.s(n, 'Distortion', distortion)
        return n.outputs[out]

    def texcoord(self, which='Object'):
        if not hasattr(self, '_tc'):
            self._tc = self.new('ShaderNodeTexCoord')
        return self._tc.outputs[which]

    def ao(self, dist, inside=False, samples=16, only_local=False):
        n = self.new('ShaderNodeAmbientOcclusion', inside=inside, samples=samples, only_local=only_local)
        self.s(n, 'Distance', dist)
        return n.outputs['AO']

    def uv(self, layer='UVMap'):
        n = self.new('ShaderNodeUVMap', uv_map=layer)
        return n.outputs[0]

    def img(self, path, vec=None, noncolor=False, scale=1.0, interp='Linear'):
        im = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        n = self.new('ShaderNodeTexImage', image=im, interpolation=interp)
        if vec is None:
            vec = self.uv()
        if scale != 1.0:
            m = self.new('ShaderNodeMapping'); self.s(m, 'Vector', vec); self.s(m, 'Scale', (scale, scale, scale))
            vec = m.outputs[0]
        self.s(n, 'Vector', vec)
        return n

    def reroute(self, name, sock):
        if not isinstance(sock, bpy.types.NodeSocket):
            if hasattr(sock, '__len__'):
                sock = self.rgb(sock)
            else:
                v = self.new('ShaderNodeValue'); v.outputs[0].default_value = sock; sock = v.outputs[0]
        n = self.new('NodeReroute')
        n.name = name
        n.label = name
        self.L.new(sock, n.inputs[0])
        return n.outputs[0]

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, NG(m)

def finish(g, albedo, rough, metal, normal=None):
    """Connect final values through named reroutes so the baker can find them."""
    bsdf = g.N['Principled BSDF']
    a = g.reroute('OUT_albedo', albedo)
    r = g.reroute('OUT_rough', rough)
    m = g.reroute('OUT_metal', metal)
    g.L.new(a, bsdf.inputs['Base Color'])
    g.L.new(r, bsdf.inputs['Roughness'])
    g.L.new(m, bsdf.inputs['Metallic'])
    if normal is not None:
        g.L.new(normal, bsdf.inputs['Normal'])
    return g.mat

def srgb2lin(c):
    return tuple(((x / 255.0 + 0.055) / 1.055) ** 2.4 if x / 255.0 > 0.04045 else x / 255.0 / 12.92 for x in c)

# ----------------------------------------------------------------------------- materials
def pbr_layer(g, texname, scale=1.0, uv='UVMap', normal_strength=1.0, proj='UV', blend=0.3, bump_dist=0.01, rot=0.0):
    """Return (color, rough, normal) sockets for a CC0 texture set.
    proj='UV': sampled on uv layer with tangent-space normal map.
    proj='BOX': triplanar box projection in object space (no UVs needed, bake-only), height map -> Bump."""
    d = os.path.join(TEX, texname)
    if proj == 'BOX':
        vec = g.texcoord('Object')
    else:
        vec = g.uv(uv)
    if scale != 1.0 or rot:
        m = g.new('ShaderNodeMapping'); g.s(m, 'Vector', vec); g.s(m, 'Scale', (1 / scale, 1 / scale, 1 / scale))
        if rot:
            g.s(m, 'Rotation', (0, 0, math.radians(rot)) if proj == 'UV' else (0, 0, math.radians(rot)))
        vec = m.outputs[0]
    def im(fn, nc):
        n = g.img(os.path.join(d, fn), vec, noncolor=nc)
        if proj == 'BOX':
            n.projection = 'BOX'; n.projection_blend = blend
        return n.outputs[0]
    col = im('diff.jpg', False)
    rough = im('rough.jpg', True)
    if proj == 'BOX':
        h = im('disp.jpg', True)
        b = g.new('ShaderNodeBump'); g.s(b, 'Strength', normal_strength); g.s(b, 'Distance', bump_dist); g.s(b, 'Height', g.bw(h))
        return col, g.bw(rough), b.outputs[0]
    nrm = im('nor.jpg', True)
    nm = g.new('ShaderNodeNormalMap', uv_map=uv)
    g.s(nm, 'Strength', normal_strength); g.s(nm, 'Color', nrm)
    return col, g.bw(rough), nm.outputs[0]

def grime(g, albedo, rough, metal, dust_col=(0.42, 0.34, 0.23), dust=0.5, cavity=0.5, bottom=0.6,
          bottom_h=1.0, streaks=0.0, edge_wear=0.0, wear_col=(0.05, 0.045, 0.04), wear_metal=0.0,
          top_dust=0.5, ao_dist=0.25):
    """Weathering layer (Cycles bake only): cavity dirt, dust on top faces, splash dirt near ground,
    vertical streaks, convex edge wear. All positions in world/object meters."""
    geo = g.geo()
    pos = g.sepxyz(geo.outputs['Position'])
    nz = g.sepxyz(geo.outputs['Normal'])[2]
    # cavity (AO outside, short distance)
    ao = g.ao(ao_dist, samples=16)
    cav = g.smooth(ao, 0.25, 1.0, 1.0, 0.0)  # 1 in crevices
    n1 = g.noise(3.0, 6, 0.6)
    n2 = g.noise(0.6, 3, 0.5)
    # dust on up-facing
    up = g.smooth(nz, 0.35, 0.9)
    dust_top = g.mul(up, g.smooth(g.add(n1, g.mul(n2, 0.6)), 0.55, 1.05))
    dust_top = g.mul(dust_top, top_dust)
    # splash near ground
    bot = g.smooth(pos[2], bottom_h, 0.0)
    bot = g.mul(bot, g.smooth(g.add(g.mul(n1, 0.7), g.mul(bot, 0.6)), 0.45, 0.85))
    bot = g.mul(bot, bottom)
    m = g.add(g.add(dust_top, bot), g.mul(cav, cavity), clamp=True)
    if streaks > 0:
        sn = g.noise(4.0, 4, 0.6, stretch=(10.0, 10.0, 0.35))
        st = g.mul(g.smooth(sn, 0.55, 0.75), g.mul(g.smooth(nz, 0.3, -0.1), streaks))
        m = g.add(m, st, clamp=True)
    m = g.mul(m, dust)
    col = g.mixc(m, albedo, g.rgb(dust_col))
    r = g.mixf(m, rough, 0.95)
    met = metal
    if edge_wear > 0:
        edge = g.ao(0.025, inside=True, samples=16, only_local=True)
        e = g.smooth(edge, 0.85, 0.35)  # 1 on convex edges
        wn = g.noise(18.0, 8, 0.7)
        wm = g.smooth(g.add(g.mul(e, 1.2), g.mul(wn, 0.9)), 1.05, 1.25)
        wm = g.mul(wm, edge_wear)
        col = g.mixc(wm, col, g.rgb(wear_col))
        r = g.mixf(wm, r, 0.45)
        met = g.mixf(wm, met, wear_metal)
    return col, r, met

_MEAN = {}
def tex_mean(texname):
    """Mean linear luminance of a texture's albedo (to normalise luminance breakup)."""
    if texname not in _MEAN:
        from PIL import Image
        a = np.asarray(Image.open(os.path.join(TEX, texname, 'diff.jpg')).convert('RGB').resize((128, 128))).astype(np.float32) / 255
        a = np.where(a > 0.04045, ((a + 0.055) / 1.055) ** 2.4, a / 12.92)
        _MEAN[texname] = float((a @ np.array([0.2126, 0.7152, 0.0722])).mean())
    return _MEAN[texname]

def mat_paint(name, color_srgb, tex='green_metal_rust', tscale=1.0, variation=0.35, rough=(0.5, 0.8),
              edge_wear=0.6, dust=0.8, dust_col=None, nstr=0.6, uv='UVMap', bump=None, **gk):
    """Military matte paint over steel; CC0 texture used for luminance breakup/roughness/normal only,
    paint colour is ours (e.g. RAL 8000 Gelbbraun, RAL 7021 Dunkelgrau)."""
    m, g = new_mat(name)
    col, rr, nrm = pbr_layer(g, tex, tscale, uv, nstr)
    lum = g.bw(col)
    v = g.math('MULTIPLY_ADD', lum, variation / tex_mean(tex), 1.0 - variation)
    base = g.rgb(srgb2lin(color_srgb))
    alb = g.mixc(1.0, base, v, blend='MULTIPLY')
    r = g.math('MULTIPLY_ADD', rr, rough[1] - rough[0], rough[0])
    alb, r, met = grime(g, alb, r, 0.0, dust=dust, edge_wear=edge_wear, wear_metal=0.5,
                        dust_col=dust_col or (0.42, 0.34, 0.23), **gk)
    if bump is not None:
        nrm = bump(g, nrm)
    return finish(g, alb, r, met, nrm)

def mat_tex(name, tex, tscale=1.0, tint=None, tint_amt=1.0, rough_add=0.0, nstr=1.0, uv='UVMap', metal=0.0,
            dust=0.5, dust_col=None, sat=1.0, bright=1.0, bump=None, albedo_fn=None, proj='UV', blend=0.3, rot=0.0, **gk):
    """Photo texture material with optional tint + grime."""
    m, g = new_mat(name)
    col, rr, nrm = pbr_layer(g, tex, tscale, uv, nstr, proj=proj, blend=blend, rot=rot)
    if sat != 1.0 or bright != 1.0:
        h = g.new('ShaderNodeHueSaturation'); g.s(h, 'Color', col); g.s(h, 'Saturation', sat); g.s(h, 'Value', bright)
        col = h.outputs[0]
    if tint is not None:
        col = g.mixc(tint_amt, col, g.rgb(srgb2lin(tint)), blend='MULTIPLY')
    r = g.add(rr, rough_add, clamp=True) if rough_add else rr
    if albedo_fn is not None:
        col, r = albedo_fn(g, col, r)
    col, r, met = grime(g, col, r, metal, dust=dust, dust_col=dust_col or (0.42, 0.34, 0.23), **gk)
    if bump is not None:
        nrm = bump(g, nrm)
    return finish(g, col, r, met, nrm)

def mat_flat(name, color_srgb, rough=0.5, metal=0.0, dust=0.0, **gk):
    m, g = new_mat(name)
    col = g.rgb(srgb2lin(color_srgb))
    if dust > 0:
        col, r, met = grime(g, col, rough, metal, dust=dust, **gk)
    else:
        r, met = rough, metal
    return finish(g, col, r, met)

# ----------------------------------------------------------------------------- baking
def _bake_setup(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    if os.environ.get('BAKE_DEVICE') == 'GPU':      # Blender 4.2.9 runs Cycles on the RTX 5090 (4.0.2 has no sm_120 kernels)
        p = bpy.context.preferences.addons['cycles'].preferences
        p.compute_device_type = os.environ.get('BAKE_API', 'OPTIX'); p.get_devices()
        for d in p.devices:
            d.use = d.type == p.compute_device_type
        sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.threads_mode = 'AUTO'
    sc.render.bake.margin = 8
    sc.render.bake.use_clear = False
    sc.render.bake.margin_type = 'EXTEND'

def unwrap_atlas(objs, angle=62, margin=0.004, layer='bake'):
    bpy.ops.object.select_all(action='DESELECT')
    seen = set()
    for o in objs:
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        uvs = o.data.uv_layers
        l = uvs.get(layer) or uvs.new(name=layer)
        uvs.active = l
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, correct_aspect=True)
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')

def _target_nodes(objs, img):
    mats = set()
    for o in objs:
        for s in o.material_slots:
            if s.material:
                mats.add(s.material)
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE_TARGET'
        n.image = img
        nt.nodes.active = n
    return mats

def _emit_swap(mats, which):
    """Route OUT_<which> into an emission shader for baking; returns restore info."""
    saved = []
    for m in mats:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        prev = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
        em = nt.nodes.new('ShaderNodeEmission')
        src = nt.nodes.get('OUT_' + which)
        if src is not None:
            nt.links.new(src.outputs[0], em.inputs['Color'])
        em.inputs['Strength'].default_value = 1.0
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        saved.append((nt, out, prev, em))
    return saved

def _emit_restore(saved):
    for nt, out, prev, em in saved:
        nt.nodes.remove(em)
        if prev:
            nt.links.new(prev, out.inputs['Surface'])

def new_image(name, res, noncolor=False):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    im.generated_color = (0.5, 0.5, 1.0, 1.0) if name.endswith('normal') else (0.0, 0.0, 0.0, 1.0)
    return im

def bake_pass(objs, kind, img, samples=16, uv='bake', high=None):
    _bake_setup(samples)
    mats = _target_nodes(objs, img)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t = time.time()
    if high and kind == 'normal':
        for h in high:
            h.hide_render = False
            h.select_set(True)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', uv_layer=uv, use_clear=False, margin=8,
                            use_selected_to_active=True, cage_extrusion=0.04, max_ray_distance=0.12)
        for h in high:
            h.hide_render = True
            h.select_set(False)
        log('baked', kind, '(high->low)', img.name, '%.1fs' % (time.time() - t))
        return
    if kind in ('albedo', 'rough', 'metal'):
        saved = _emit_swap(mats, kind)
        bpy.ops.object.bake(type='EMIT', uv_layer=uv, use_clear=False, margin=8)
        _emit_restore(saved)
    elif kind == 'normal':
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', uv_layer=uv, use_clear=False, margin=8)
    elif kind == 'ao':
        bpy.ops.object.bake(type='AO', uv_layer=uv, use_clear=False, margin=8)
    log('baked', kind, img.name, '%.1fs' % (time.time() - t))

def bake_atlas(passes, name, res, outdir, samples=16, ao_samples=64, ao_dist=1.0, cavity_in_albedo=0.45):
    """passes: list of dict(targets=[objs], hide=[objs], ground=bool). Each pass bakes its targets into the
    shared atlas with 'hide' objects removed from render (e.g. wheels baked alone so AO is rotation invariant).
    Produces <name>_albedo.jpg, _normal.jpg, _orm.jpg in outdir. Returns dict of paths."""
    os.makedirs(outdir, exist_ok=True)
    imgs = {k: new_image(f'{name}_{k}', res, noncolor=(k != 'albedo')) for k in ('albedo', 'rough', 'metal', 'normal', 'ao')}
    imgs['normal'].generated_color = (0.5, 0.5, 1.0, 1.0)
    imgs['rough'].generated_color = (0.8, 0.8, 0.8, 1.0)
    imgs['ao'].generated_color = (1.0, 1.0, 1.0, 1.0)
    w = bpy.context.scene.world or bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    for n in list(w.node_tree.nodes):
        if n.type == 'TEX_ENVIRONMENT':
            w.node_tree.nodes.remove(n)
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    w.light_settings.distance = ao_dist
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    gp = obj_from_bm('__ground', bm)
    tb = time.time()
    for p in passes:
        for o in p.get('hide', []):
            o.hide_render = True
        gp.hide_render = not p.get('ground', True)
        for h in p.get('high', []):
            h.hide_render = True
        for k in ('albedo', 'rough', 'metal', 'normal'):
            bake_pass(p['targets'], k, imgs[k], samples, high=p.get('high'))
        bake_pass(p['targets'], 'ao', imgs['ao'], ao_samples)
        for o in p.get('hide', []):
            o.hide_render = False
    bpy.data.objects.remove(gp)
    log('bake passes total %.1fs' % (time.time() - tb))
    def px(im):
        a = np.empty(res * res * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(res, res, 4)
    alb, ro, me, nr, ao = (px(imgs[k]) for k in ('albedo', 'rough', 'metal', 'normal', 'ao'))
    from PIL import Image
    def save(arr, path, q=90):
        a = np.clip(arr[::-1, :, :3] * 255 + 0.5, 0, 255).astype(np.uint8)
        im = Image.fromarray(a)
        im.save(path, quality=q, optimize=True, subsampling=0 if ('normal' in path or 'orm' in path) else 2)
    orm = np.stack([ao[..., 0], ro[..., 0], me[..., 0], np.ones_like(ao[..., 0])], -1)
    albc = alb.copy()
    albc[..., :3] *= (1 - cavity_in_albedo + cavity_in_albedo * ao[..., :1]) ** 0.5
    paths = {k: os.path.join(outdir, f'{name}_{k}.jpg') for k in ('albedo', 'normal', 'orm')}
    save(albc, paths['albedo'], 88)
    save(nr, paths['normal'], 92)
    save(orm, paths['orm'], 90)
    save(ao, os.path.join(outdir, f'{name}_ao_raw.jpg'), 90)
    return paths

def final_material(name, paths):
    """Principled material using baked atlas on 'bake' UV + glTF occlusion."""
    m, g = new_mat(name)
    bsdf = g.N['Principled BSDF']
    uv = g.uv('bake')
    a = g.img(paths['albedo'], uv)
    orm = g.img(paths['orm'], uv, noncolor=True)
    n = g.img(paths['normal'], uv, noncolor=True)
    sep = g.sepc(orm.outputs[0])
    g.L.new(a.outputs[0], bsdf.inputs['Base Color'])
    g.L.new(sep[1], bsdf.inputs['Roughness'])
    g.L.new(sep[2], bsdf.inputs['Metallic'])
    nm = g.new('ShaderNodeNormalMap', uv_map='bake')
    g.L.new(n.outputs[0], nm.inputs['Color'])
    g.L.new(nm.outputs[0], bsdf.inputs['Normal'])
    # glTF occlusion via custom group
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = g.new('ShaderNodeGroup'); gn.node_tree = grp
    g.L.new(sep[0], gn.inputs['Occlusion'])
    return m

def finalize_objects(objs, mat):
    """Remove tiling UVs + old materials, keep baked UV as the only UV map, assign final material."""
    seen = set()
    for o in objs:
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        uvs = o.data.uv_layers
        for l in list(uvs):
            if l.name != 'bake':
                uvs.remove(l)
        o.data.materials.clear()
        o.data.materials.append(mat)
        o.data.uv_layers['bake'].active_render = True

def export_glb(path, objs=None, fmt='GLB', img_fmt='AUTO', draco=False, tangents=False):
    bpy.ops.object.select_all(action='DESELECT')
    if objs:
        for o in objs:
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format=fmt, use_selection=bool(objs), export_apply=True,
                              export_image_format=img_fmt, export_tangents=tangents, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_cameras=False,
                              export_lights=False, export_draco_mesh_compression_enable=draco,
                              export_yup=True)
    log('exported', path, '%.0f KB' % (os.path.getsize(path) / 1024))

# ----------------------------------------------------------------------------- preview render
def preview(path, target=(0, 0, 1), dist=14, elev=55, azim=35, res=(1280, 800), engine='BLENDER_EEVEE',
            hdri='goegap_2k.hdr', ground_tex='dense_sand', lens=50, samples=64, sun=True, capsule=True,
            ortho_scale=None, sun_rot=(50, 0, 140), strength=1.0):
    sc = bpy.context.scene
    if engine == 'BLENDER_EEVEE' and bpy.app.version >= (4, 2, 0):
        engine = 'BLENDER_EEVEE_NEXT'
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    sc.view_settings.look = 'None'
    if engine.startswith('BLENDER_EEVEE'):
        e = sc.eevee
        e.taa_render_samples = samples
        for k, v in (('use_gtao', True), ('gtao_distance', 1.0), ('use_soft_shadows', True), ('shadow_cube_size', '2048'),
                     ('shadow_cascade_size', '4096'), ('use_ssr', True), ('use_shadows', True), ('use_raytracing', True)):
            if hasattr(e, k):
                setattr(e, k, v)
    else:
        sc.cycles.device = 'CPU'; sc.cycles.samples = samples; sc.cycles.use_denoising = False
    w = sc.world or bpy.data.worlds.new('W'); sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_ENVIRONMENT':
            nt.nodes.remove(n)
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(HDRI, hdri), check_existing=True)
    bg = nt.nodes['Background']
    nt.links.new(env.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength * (0.6 if sun else 1.0)
    w.light_settings.distance = 1.0
    extra = []
    if sun:
        ld = bpy.data.lights.new('Sun', 'SUN'); ld.energy = 4.5 * strength; ld.angle = math.radians(1.5)
        ld.color = (1.0, 0.95, 0.86)
        so = link(bpy.data.objects.new('Sun', ld)); so.rotation_euler = [math.radians(a) for a in sun_rot]
        extra.append(so)
    if ground_tex:
        gm = bpy.data.materials.get('GROUND') or mat_tex('GROUND', ground_tex, tscale=1.8, dust=0.0)
        bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
        gpo = obj_from_bm('__preview_ground', bm, gm)
        box_uv(gpo, 1.0)
        extra.append(gpo)
    if capsule:
        cm = bpy.data.materials.get('CAPSULE') or mat_flat('CAPSULE', (90, 96, 70), rough=0.8)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.25)
        for v in bm.verts:
            if v.co.z > 0: v.co.z += 1.3
        bmesh.ops.translate(bm, vec=(target[0] + capsule[0], target[1] + capsule[1], 0.25), verts=bm.verts) if isinstance(capsule, tuple) else bmesh.ops.translate(bm, vec=(target[0] - 2.2, target[1] + 2.0, 0.25), verts=bm.verts)
        extra.append(obj_from_bm('__capsule', bm, cm, smooth=True))
    cd = bpy.data.cameras.new('Cam'); cd.lens = lens; cd.clip_end = 500
    if ortho_scale:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho_scale
    cam = link(bpy.data.objects.new('Cam', cd))
    t = Vector(target)
    el, az = math.radians(elev), math.radians(azim)
    cam.location = t + Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    extra.append(cam)
    sc.camera = cam
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log('render', os.path.basename(path), engine, '%.1fs' % (time.time() - t0))
    for o in extra:
        bpy.data.objects.remove(o)

# ----------------------------------------------------------------------------- directional UVs (added attempt 2)
def dir_uv(ob, along, scale=1.0, layer='UVMap', jitter=True, along_v=True):
    """Per-face planar UVs where one texture axis follows a direction: along(poly_normal_world)->Vector or None.
    Used for timber grain along beams (along=const beam axis) and corrugation/boards running down a roof slope.
    Faces where the direction is ~parallel to the normal (end caps) fall back to a projection on the other two axes."""
    import random
    me = ob.data
    uvl = me.uv_layers.get(layer) or me.uv_layers.new(name=layer)
    M = ob.matrix_world
    R = M.to_3x3()
    rnd = random.Random(hash(ob.name + str(len(me.polygons))) & 0xffff)
    ou, ov = (rnd.random() * 7, rnd.random() * 7) if jitter else (0, 0)
    for p in me.polygons:
        n = (R @ p.normal).normalized()
        d = along(n)
        if d is None or abs(d.normalized().dot(n)) > 0.8:
            a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
            s = n.cross(a).normalized(); t = n.cross(s)
        else:
            d = d.normalized()
            s = (d - n * d.dot(n)).normalized()   # in-plane 'along'
            t = n.cross(s)
        for li in p.loop_indices:
            co = M @ me.vertices[me.loops[li].vertex_index].co
            a_, b_ = co.dot(s), co.dot(t)
            u, v = (b_, a_) if along_v else (a_, b_)
            uvl.data[li].uv = (u / scale + ou, v / scale + ov)
    return uvl

def downslope(n):
    """Direction of steepest descent within the plane with normal n (None for flat/vertical faces)."""
    if abs(n.z) > 0.97 or abs(n.z) < 0.05:
        return None
    return Vector((0, 0, -1)) - n * (-n.z)
