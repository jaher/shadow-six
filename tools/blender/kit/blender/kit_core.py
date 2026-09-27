"""SHADOW SIX building kit - core: scene, materials from the shared library, parts, UVs, vertex grime, metadata.
Conventions (Blender side): Z up, metres, ground z=0, asset pivot at ground centre.
Front of an asset faces Blender -Y (= glTF/three +Z = game 'south' at rot 0). North = Blender +Y.
All component functions build geometry directly in WORLD coordinates (no object transforms).
"""
import bpy, bmesh, math, random, json, os
from mathutils import Vector, Matrix

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(KIT, 'lib')
V = Vector
UP = V((0, 0, 1))


def log(*a):
    print('[kit]', *a, flush=True)


def load_materials():
    p = os.path.join(LIB, 'materials.json')
    return json.load(open(p))['materials'] if os.path.exists(p) else {}


MATS = load_materials()


class Asset:
    def __init__(s, name, seed=1, theater='temperate', snow=False, water_level=None):
        s.name, s.seed, s.theater, s.snow = name, seed, theater, snow
        s.rng = random.Random(seed)
        s.parts = []          # blender objects (node 'main' unless noted)
        s.water = water_level
        s.meta = {'asset': name, 'footprints': [], 'doors': [], 'roofs': [], 'climb': [], 'ladders': [],
                  'anchors': [], 'windows': [], 'bridge': None, 'notes': []}
        s.grime_heights = [0.12, 0.35, 0.7, 1.2]
        s.grime = {'base': 1.0, 'moss': 1.0 if theater in ('temperate', 'coast', 'snow') else 0.0,
                   'dust': 1.0 if theater == 'desert' else 0.3}


A = None


def begin(name, seed=1, theater='temperate', snow=False, water_level=None):
    """Start a new asset: clears the scene. theater: temperate|coast|snow|desert|frost."""
    global A
    bpy.ops.wm.read_factory_settings(use_empty=True)
    A = Asset(name, seed, theater, snow, water_level)
    return A


def rng():
    return A.rng


# ------------------------------------------------------------------ materials
_MCACHE = {}


def mat(mid, tint=None):
    """Blender material bound to shared-library entry `mid` (placeholder shading; the real PBR is
    written by glb_post.py from lib/materials.json). tint: optional (r,g,b) multiplier -> distinct material."""
    key = mid if tint is None else '%s~%02x%02x%02x' % ((mid,) + tuple(int(c * 255) for c in tint))
    if key in _MCACHE and _MCACHE[key].name in bpy.data.materials:
        return _MCACHE[key]
    m = bpy.data.materials.new('kit:' + key)
    m.use_nodes = True
    e = MATS.get(mid, {})
    c = e.get('mean', [0.5, 0.5, 0.5])
    if tint:
        c = [c[i] * tint[i] for i in range(3)]
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*[x ** 2.2 for x in c], 1)
    bs.inputs['Roughness'].default_value = e.get('roughness', 0.8)
    bs.inputs['Metallic'].default_value = e.get('metallic', 0.0)
    m['kit_id'] = mid
    if tint:
        m['kit_tint'] = list(tint)
    if TEXTURED and mid in MATS:
        mat_textured(mid, tint, m=m)
    _MCACHE[key] = m
    return m


TEXTURED = os.environ.get('KIT_TEXTURED', '0') == '1'   # build full textured node trees (Blender renders / atlas bakes)


def mat_textured(mid, tint=None, mapping='UV', res='2k', m=None):
    """Full Principled material from lib/materials.json: base colour (x tint), ARM -> roughness/metal, normal map.
    mapping 'UV' uses the kit's world-scale UVMap; 'BOX' = object-space box projection (blend 0.2) at tile_m scale."""
    e = MATS[mid]
    m = m or bpy.data.materials.new('kit:' + mid)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes.get('Principled BSDF')
    maps = e['maps']
    coord = None
    if mapping == 'BOX':
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / e['tile_m'],) * 3
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        coord = mp.outputs['Vector']

    def img(key, noncolor):
        ext = '.png' if e.get('alpha') else '.jpg'
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(os.path.join(LIB, maps[key][res] + ext), check_existing=True)
        if noncolor:
            n.image.colorspace_settings.name = 'Non-Color'
        if coord is not None:
            n.projection = 'BOX'
            n.projection_blend = 0.2
            nt.links.new(coord, n.inputs['Vector'])
        return n
    d = img('diff', False)
    out = d.outputs['Color']
    if tint:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(out, mix.inputs[6])
        mix.inputs[7].default_value = (*[c ** 2.2 for c in tint], 1)
        out = mix.outputs[2]
    nt.links.new(out, bs.inputs['Base Color'])
    if e.get('alpha'):
        nt.links.new(d.outputs['Alpha'], bs.inputs['Alpha'])
    if 'arm' in maps:
        a = img('arm', True)
        sp = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(a.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], bs.inputs['Roughness'])
        bs.inputs['Metallic'].default_value = e.get('metallic', 0.0)
    if 'nor' in maps:
        nn = img('nor', True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    m['kit_id'] = mid
    return m


def tile_of(mid):
    return MATS.get(mid, {}).get('tile_m', 2.0)


# ------------------------------------------------------------------ bmesh helpers
def bm_new():
    return bmesh.new()


def quad(bm, pts, flip=False):
    vs = [bm.verts.new(V(p)) for p in pts]
    if flip:
        vs.reverse()
    return bm.faces.new(vs)


def box_bm(bm, center, size, rot_z=0.0, taper=None):
    """Axis box (optionally rotated about Z) into bm; returns faces. taper=(sx,sy) top scale."""
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    R = Matrix.Rotation(rot_z, 3, 'Z')
    tx, ty = taper if taper else (1, 1)
    pts = []
    for z, sx, sy in ((-hz, 1, 1), (hz, tx, ty)):
        for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)):
            pts.append(V((cx, cy, cz)) + R @ V((x * sx, y * sy, z)))
    v = [bm.verts.new(p) for p in pts]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return [bm.faces.new([v[i] for i in f]) for f in F]


def hexa_bm(bm, p8):
    """Arbitrary hexahedron from 8 points: bottom 0-3 CCW (seen from above), top 4-7."""
    v = [bm.verts.new(V(p)) for p in p8]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return [bm.faces.new([v[i] for i in f]) for f in F]


def beam_bm(bm, p0, p1, w, h=None, up=UP, roll=0.0):
    """Rectangular beam from p0 to p1 (section w x h)."""
    p0, p1 = V(p0), V(p1)
    h = h or w
    ax = (p1 - p0).normalized()
    u = up if abs(ax.dot(up)) < 0.95 else V((1, 0, 0))
    side = ax.cross(u).normalized()
    upv = side.cross(ax).normalized()
    if roll:
        R = Matrix.Rotation(roll, 3, ax)
        side, upv = R @ side, R @ upv
    pts = []
    for p in (p0, p1):
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts.append(p + side * (a * w / 2) + upv * (b * h / 2))
    v = [bm.verts.new(x) for x in pts]
    F = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return [bm.faces.new([v[i] for i in f]) for f in F]


def cyl_bm(bm, p0, p1, r, segs=8, r1=None, caps=True):
    p0, p1 = V(p0), V(p1)
    ax = (p1 - p0).normalized()
    a = ax.orthogonal().normalized()
    b = ax.cross(a)
    r1 = r if r1 is None else r1
    ring0, ring1 = [], []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        d = a * math.cos(t) + b * math.sin(t)
        ring0.append(bm.verts.new(p0 + d * r))
        ring1.append(bm.verts.new(p1 + d * r1))
    fs = []
    for i in range(segs):
        j = (i + 1) % segs
        fs.append(bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i])))
    if caps:
        fs.append(bm.faces.new(list(reversed(ring0))))
        if r1 > 1e-4:
            fs.append(bm.faces.new(ring1))
    return fs


def prism_bm(bm, poly2d, z0, z1, plane_xy=True):
    """Extrude a CCW 2D polygon (x,y) from z0 to z1."""
    n = len(poly2d)
    bot = [bm.verts.new(V((x, y, z0))) for x, y in poly2d]
    top = [bm.verts.new(V((x, y, z1))) for x, y in poly2d]
    fs = [bm.faces.new(list(reversed(bot))), bm.faces.new(top)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((bot[i], bot[j], top[j], top[i])))
    return fs


def loft_bm(bm, rings, close_start=True, close_end=True, closed=True):
    """Connect a list of equal-length vertex rings (lists of Vector)."""
    vr = [[bm.verts.new(V(p)) for p in r] for r in rings]
    n = len(rings[0])
    fs = []
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    if close_start and closed:
        fs.append(bm.faces.new(list(reversed(vr[0]))))
    if close_end and closed:
        fs.append(bm.faces.new(vr[-1]))
    return fs


# ------------------------------------------------------------------ UVs
def _face_basis(n):
    if abs(n.z) > 0.97:
        return V((1, 0, 0)), V((0, 1, 0))
    u = UP.cross(n).normalized()
    return u, n.cross(u).normalized()


def uv_faces(bm, faces, mid, mode='aligned', axis=None, rot90=False, scale=1.0, offset=None):
    """World-scale UVs (1 UV unit = one texture tile of `tile_m` metres).
    mode 'aligned': u horizontal along the face, v up the face (roof slopes: v up-slope).
    mode 'beam': texture grain along `axis` (for timbers, rails, planks)."""
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    e = MATS.get(mid, {})
    t = tile_of(mid) * scale
    ou, ov = offset if offset else (rng().random() * 7.3, rng().random() * 5.1)
    grain_u = e.get('grain', 'u') == 'u'
    for f in faces:
        n = f.normal if f.normal.length > 0.5 else UP
        if mode == 'beam' and axis is not None:
            ax = V(axis).normalized()
            if abs(n.dot(ax)) > 0.9:          # end grain face
                bu, bv = _face_basis(n)
            else:
                perp = n.cross(ax).normalized()
                bu, bv = (ax, perp) if grain_u else (perp, ax)
        else:
            bu, bv = _face_basis(n)
        if rot90 ^ bool(e.get('rot90', False)):
            bu, bv = bv, -bu
        for l in f.loops:
            p = l.vert.co
            l[lay].uv = (p.dot(bu) / t + ou, p.dot(bv) / t + ov)


def uv_rect(bm, face, rect):
    """Map a quad face to an atlas rectangle (u0,v0,u1,v1), loop order = BL,BR,TR,TL."""
    lay = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    u0, v0, u1, v1 = rect
    for l, uv in zip(face.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        l[lay].uv = uv


# ------------------------------------------------------------------ vertex grime
_DIRT = V((0.50, 0.43, 0.34))
_MOSS = V((0.62, 0.70, 0.42))
_WET = V((0.42, 0.44, 0.38))


def _noise(p, s=1.0):
    from mathutils import noise
    return 0.5 + 0.5 * noise.noise(V((p.x * s + 11.3, p.y * s - 7.1, p.z * s + 3.7)))


def grime_color(p, n, amt=1.0, tint=(1, 1, 1)):
    c = V(tint)
    if amt <= 0:
        return c
    h = max(0.0, p.z)
    g = A.grime
    nz = _noise(p, 1.7)
    # rising damp / splash-back dirt at the base
    d = max(0.0, 1 - h / 0.95) ** 1.5 * 0.55 * g['base'] * amt * (0.55 + 0.9 * nz)
    c = c.lerp(V((c.x * _DIRT.x, c.y * _DIRT.y, c.z * _DIRT.z)), min(d, 0.85))
    # moss / algae on the shaded (north, +Y) and lower faces, and on up-facing ledges
    if g['moss'] > 0:
        north = max(0.0, n.y * 0.7 + 0.3)
        m = g['moss'] * amt * (max(0.0, 1 - h / 0.6) * 0.45 * north + max(0.0, n.z - 0.6) * 0.25) * _noise(p, 2.9) ** 1.5
        c = c.lerp(V((c.x * _MOSS.x, c.y * _MOSS.y, c.z * _MOSS.z)), min(m, 0.6))
    # large-scale tonal variation (weather exposure)
    c *= 0.9 + 0.14 * _noise(p, 0.35)
    # water line on bridges / quays
    if A.water is not None:
        w = A.water
        if h < w + 0.9:
            k = 1.0 if h < w + 0.05 else max(0.0, 1 - (h - w - 0.05) / 0.85) ** 1.3 * 0.8
            c = c.lerp(V((c.x * _WET.x, c.y * _WET.y, c.z * _WET.z)), k * 0.75)
    return c


# ------------------------------------------------------------------ parts
def part(bm, mid, name=None, uv='aligned', axis=None, rot90=False, uv_scale=1.0, node='main',
         grime=None, tint=None, smooth=False, bisect=True, jitter=0.06, mat_tint=None, alpha=1.0, lod=None):
    """Turn a world-space bmesh into a kit part. Assigns library material `mid`, world-scale UVs
    (unless uv='keep'), per-part colour jitter and vertex grime (COLOR_0). Returns the object."""
    e = MATS.get(mid, {})
    amt = e.get('grime', 1.0) if grime is None else grime
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if bisect and amt > 0 and bm.edges and max(e.calc_length() for e in bm.edges) > 1.0:
        zs = [v.co.z for v in bm.verts]
        cuts = list(A.grime_heights)
        if A.water is not None:
            cuts += [A.water + 0.05, A.water + 0.45]
        for hz in cuts:
            if min(zs) + 0.03 < hz < max(zs) - 0.03 and (max(zs) - min(zs)) > 0.4:
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, hz), plane_no=(0, 0, 1))
    bm.normal_update()
    if uv != 'keep':
        uv_faces(bm, bm.faces, mid, mode=uv, axis=axis, rot90=rot90, scale=uv_scale)
    col = bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    r = rng()
    j = 1 + (r.random() - 0.5) * 2 * jitter
    t = V(tint) * j if tint else V((j * (1 + (r.random() - 0.5) * jitter * 0.4), j, j * (1 + (r.random() - 0.5) * jitter * 0.4)))
    for f in bm.faces:
        f.smooth = smooth
        for l in f.loops:
            c = grime_color(l.vert.co, f.normal, amt, t)
            l[col] = (min(c.x, 1), min(c.y, 1), min(c.z, 1), alpha)
    me = bpy.data.meshes.new(name or mid)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name or mid, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat(mid, mat_tint))
    ob['kit_node'] = node
    if lod:
        ob['kit_lod'] = lod          # 'keep' = never simplified in LODs, 'drop' = removed from LOD1+
    A.parts.append(ob)
    return ob


def P(mid, builder, *a, **kw):
    """Convenience: P('fieldstone', box_bm, center, size) -> part with one primitive."""
    pkw = {k: kw.pop(k) for k in list(kw) if k in ('name', 'uv', 'axis', 'rot90', 'uv_scale', 'node', 'grime',
                                                     'tint', 'smooth', 'bisect', 'jitter', 'mat_tint', 'alpha', 'lod')}
    bm = bm_new()
    builder(bm, *a, **kw)
    return part(bm, mid, **pkw)


# ------------------------------------------------------------------ gameplay metadata (sidecar JSON)
# Game coords: x east = Blender x; z south = -Blender y; y up = Blender z. Sidecar stores GAME coords.
def g2(p):
    return [round(p[0], 3), round(-p[1], 3)]


def footprint(poly, block='HIGH', kind='building', owner=None):
    """Register a nav-grid footprint polygon (Blender XY, any winding). block: HIGH|LOW|FENCE|NONE."""
    A.meta['footprints'].append({'shape': 'poly', 'points': [g2(p) for p in poly], 'block': block, 'kind': kind})


def footprint_rect(cx, cy, w, d, rot=0.0, block='HIGH', kind='building'):
    c, s = math.cos(rot), math.sin(rot)
    pts = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    footprint(pts, block, kind)


def door_meta(did, pos, normal, width, height, kind='door', node=None):
    """pos = centre of the threshold (Blender), normal = outward facing (Blender XY)."""
    n = V(normal).normalized()
    A.meta['doors'].append({'id': did, 'kind': kind, 'pos': [round(pos[0], 3), round(pos[2] if len(pos) > 2 else 0, 3), round(-pos[1], 3)],
                            'heading': round(math.atan2(-n.y, n.x), 4), 'width': round(width, 3),
                            'height': round(height, 3), 'node': node,
                            'approach': g2((pos[0] + n.x * 0.8, pos[1] + n.y * 0.8))})


def roof_meta(poly, elev, walkable=False, kind='roof'):
    A.meta['roofs'].append({'points': [g2(p) for p in poly], 'elev': round(elev, 3), 'walkable': walkable, 'kind': kind})


def climb_meta(p0, p1, top, kind='wall'):
    """A climbable edge (Green Beret): segment in Blender XY at height `top`."""
    A.meta['climb'].append({'a': g2(p0), 'b': g2(p1), 'top': round(top, 3), 'kind': kind})


def ladder_meta(bottom, top_pos, top_elev):
    A.meta['ladders'].append({'a': g2(bottom), 'b': g2(top_pos), 'y': round(top_elev, 3)})


def anchor(name, pos, heading_vec=(0, -1, 0), **extra):
    """Named point for gameplay/VFX (chimney smoke, lamp light, bomb target, flag...)."""
    n = V(heading_vec)
    d = {'name': name, 'pos': [round(pos[0], 3), round(pos[2], 3), round(-pos[1], 3)],
         'heading': round(math.atan2(-n.y, n.x), 4)}
    d.update(extra)
    A.meta['anchors'].append(d)


# ------------------------------------------------------------------ 2D polygon utils
def poly_offset(poly, d):
    """Offset a CCW polygon outward by d (miter). Returns list of (x,y)."""
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = V((*poly[i - 1], 0)), V((*poly[i], 0)), V((*poly[(i + 1) % n], 0))
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = V((e0.y, -e0.x, 0))
        n1 = V((e1.y, -e1.x, 0))
        bis = (n0 + n1)
        bis = bis.normalized() if bis.length > 1e-6 else n0
        k = d / max(0.2, bis.dot(n0))
        q = p1 + bis * k
        out.append((q.x, q.y))
    return out


def poly_area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def ccw(poly):
    return poly if poly_area(poly) > 0 else list(reversed(poly))
