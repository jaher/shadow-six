# eyeball.py - anatomical procedural eyeball for the HUD eye (Blender 4.2, Cycles): sclera with veins, layered iris
# (radial fibres, crypts, collarette, contraction furrows, limbal ring, pupillary ruff), pupil, refracting cornea.
# Built at real scale (R 12 mm) in a local frame looking down -Y; `build()` returns the rig empty (rotate it for gaze)
# and the iris material's pupil Value node (pupil radius / iris radius).
import math, bmesh, bpy
from mathutils import Vector

R = 0.012          # globe radius
RL = 0.0060        # limbus (iris) radius
RC = 0.0078        # corneal curvature radius
YL = -math.sqrt(R * R - RL * RL)            # limbus plane
YC = YL + math.sqrt(RC * RC - RL * RL)      # corneal sphere centre


def configure(rl):
    """Limbus radius (globe units, R = 12 mm): MakeHuman's globe is large for its lid opening, so the iris is sized to
    the opening instead (about 0.4 x fissure width). The cornea keeps the human 7.8 / 6.0 curvature-to-limbus ratio."""
    global RL, RC, YL, YC
    RL = rl; RC = rl * 1.30; YL = -math.sqrt(R * R - RL * RL); YC = YL + math.sqrt(RC * RC - RL * RL)


def _obj(name, bm, mat, parent=None, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    if parent: o.parent = parent
    return o


def _cap(radius, cy, ang_max, ang_min=0.0, segs=192, rings=64):
    """Spherical zone around -Y between polar angles ang_min..ang_max (radians), sphere centre (0, cy, 0)."""
    bm = bmesh.new(); rows = []
    for i in range(rings + 1):
        a = ang_min + (ang_max - ang_min) * i / rings
        if a == 0.0:
            rows.append([bm.verts.new((0, cy - radius, 0))]); continue
        row = []
        for j in range(segs):
            t = 2 * math.pi * j / segs
            row.append(bm.verts.new((radius * math.sin(a) * math.cos(t), cy - radius * math.cos(a), radius * math.sin(a) * math.sin(t))))
        rows.append(row)
    for i in range(rings):
        A, B = rows[i], rows[i + 1]
        for j in range(segs):
            j2 = (j + 1) % segs
            if len(A) == 1: bm.faces.new((A[0], B[j2], B[j]))
            else: bm.faces.new((A[j], A[j2], B[j2], B[j]))
    c = Vector((0, cy, 0)); bm.normal_update()
    for f in bm.faces:                      # outward normals (refraction and SSS depend on them)
        if f.normal.dot(f.calc_center_median() - c) < 0: f.normal_flip()
    return bm


class N:
    """Tiny node-tree helper (self-contained so the eye scripts don't depend on the icon studio)."""
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True
        self.t = self.m.node_tree; self.p = self.t.nodes['Principled BSDF']

    def n(self, kind, **kw):
        nd = self.t.nodes.new(kind)
        for k, v in kw.items():
            if k.startswith('i_'): nd.inputs[k[2:].replace('_', ' ')].default_value = v
            else: setattr(nd, k, v)
        return nd

    def L(self, a, b): self.t.links.new(a, b)

    def set(self, k, v): self.p.inputs[k].default_value = v

    def m_(self, op, a, b=None, c=None, clamp=False):
        nd = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b, c)):
            if v is None: continue
            if isinstance(v, (int, float)): nd.inputs[i].default_value = v
            else: self.L(v, nd.inputs[i])
        return nd.outputs[0]

    def v_(self, op, a, b=None, scale=None):
        nd = self.n('ShaderNodeVectorMath', operation=op)
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, tuple): nd.inputs[i].default_value = v
            else: self.L(v, nd.inputs[i])
        if scale is not None: nd.inputs[3].default_value = scale
        return nd.outputs['Vector'] if op not in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else nd.outputs['Value']

    def mix(self, fac, a, b, blend='MIX'):
        nd = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=True)
        for idx, v in ((0, fac), (6, a), (7, b)):
            s = nd.inputs[idx]
            if isinstance(v, (int, float)): s.default_value = v if idx == 0 else (v, v, v, 1)
            elif isinstance(v, tuple): s.default_value = (*v[:3], 1)
            else: self.L(v, s)
        return nd.outputs[2]

    def obj(self):
        return self.n('ShaderNodeTexCoord').outputs['Object']

    def comb(self, x, y, z):
        nd = self.n('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            if isinstance(v, (int, float)): nd.inputs[i].default_value = v
            else: self.L(v, nd.inputs[i])
        return nd.outputs[0]

    def sep(self, v):
        nd = self.n('ShaderNodeSeparateXYZ'); self.L(v, nd.inputs[0]); return nd.outputs

    def noise(self, vec, scale, detail=4.0, rough=0.5, dist=0.0, dims='3D'):
        nd = self.n('ShaderNodeTexNoise', noise_dimensions=dims, i_Scale=scale, i_Detail=detail, i_Roughness=rough, i_Distortion=dist)
        self.L(vec, nd.inputs['Vector']); return nd.outputs['Fac']

    def smooth(self, x, e0, e1):
        nd = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        for k, v in (('Value', x), ('From Min', e0), ('From Max', e1)):
            if isinstance(v, (int, float)): nd.inputs[k].default_value = v
            else: self.L(v, nd.inputs[k])
        return nd.outputs['Result']


def iris_mat(name='iris', pupil=0.30, seed=0.0):
    """Layered procedural iris in the iris object's local XZ plane. Hazel collarette zone fading to a grey-blue stroma
    of radial fibres, dark crypts around the collarette, contraction furrows, limbal ring and pupillary ruff.
    The pupil (radius `pupil` x iris radius) is a smooth black disc; tissue coordinate u is (r - p) / (1 - p) so the
    pattern compresses as the pupil dilates, like a real stroma."""
    T = N(name); p = T.n('ShaderNodeValue', label='pupil', name='pupil'); p.outputs[0].default_value = pupil; P = p.outputs[0]
    s = T.sep(T.obj()); x, z = s[0], s[2]
    rr = T.m_('SQRT', T.m_('ADD', T.m_('MULTIPLY', x, x), T.m_('MULTIPLY', z, z)))
    r = T.m_('DIVIDE', rr, RL)
    dx = T.m_('DIVIDE', x, T.m_('MAXIMUM', rr, 1e-6)); dz = T.m_('DIVIDE', z, T.m_('MAXIMUM', rr, 1e-6))
    u = T.m_('DIVIDE', T.m_('SUBTRACT', r, P), T.m_('SUBTRACT', 1.0, P), clamp=True)
    pol = lambda ka, kr, off=0.0: T.comb(T.m_('MULTIPLY_ADD', dx, ka, off + seed), T.m_('MULTIPLY', dz, ka), T.m_('MULTIPLY', u, kr))
    fib = T.noise(pol(26.0, 1.6), 1.0, 8.0, 0.62)              # coarse radial fibre bundles
    fine = T.noise(pol(95.0, 4.0, 7.0), 1.0, 6.0, 0.55)         # fine trabeculae
    fib2 = T.m_('MULTIPLY_ADD', fib, 0.65, T.m_('MULTIPLY', fine, 0.35))
    zig = T.noise(pol(3.2, 0.0, 3.0), 1.0, 3.0, 0.6)
    uc = T.m_('MULTIPLY_ADD', T.m_('SUBTRACT', zig, 0.5), 0.20, 0.27)          # zig-zag collarette radius
    inner = T.m_('SUBTRACT', 1.0, T.smooth(T.m_('SUBTRACT', u, uc), -0.035, 0.05))
    ring = T.m_('SUBTRACT', 1.0, T.smooth(T.m_('ABSOLUTE', T.m_('SUBTRACT', u, uc)), 0.0, 0.03))
    vo = T.n('ShaderNodeTexVoronoi', i_Scale=1.0, i_Randomness=0.9); T.L(pol(7.5, 3.4, 11.0), vo.inputs['Vector'])
    crypt = T.m_('SUBTRACT', 1.0, T.smooth(vo.outputs['Distance'], 0.10, 0.30))
    band = T.m_('MULTIPLY', T.smooth(u, 0.18, 0.32), T.m_('SUBTRACT', 1.0, T.smooth(u, 0.62, 0.80)))
    crypt = T.m_('MULTIPLY', T.m_('MULTIPLY', crypt, band), T.smooth(T.noise(pol(4.0, 1.0, 19.0), 1.0, 2.0), 0.42, 0.6))
    furrow = T.smooth(T.m_('SINE', T.m_('MULTIPLY_ADD', u, 34.0, T.m_('MULTIPLY', zig, 6.0))), 0.86, 0.99)
    furrow = T.m_('MULTIPLY', furrow, T.smooth(u, 0.55, 0.75))
    lim = T.m_('POWER', T.smooth(u, 0.74, 1.0), 1.4)
    ruff = T.m_('SUBTRACT', 1.0, T.smooth(u, 0.0, 0.05))
    pup = T.m_('SUBTRACT', 1.0, T.smooth(r, T.m_('SUBTRACT', P, 0.006), T.m_('ADD', P, 0.004)))
    # colour: grey-blue stroma (dark crypts between pale fibre bundles), hazel-amber around the pupil
    c = T.mix(T.smooth(fib2, 0.3, 0.72), (0.085, 0.13, 0.17), (0.40, 0.50, 0.55))
    c = T.mix(T.m_('MULTIPLY', T.smooth(fine, 0.55, 0.8), 0.5), c, (0.62, 0.68, 0.70))
    hz = T.mix(T.smooth(fib2, 0.25, 0.8), (0.045, 0.025, 0.01), (0.30, 0.19, 0.065))
    c = T.mix(T.m_('MULTIPLY', inner, T.m_('MULTIPLY_ADD', T.noise(pol(14.0, 2.0, 23.0), 1.0, 3.0), 0.6, 0.45)), c, hz)
    c = T.mix(T.m_('MULTIPLY', ring, 0.45), c, (0.58, 0.48, 0.30))
    c = T.mix(T.m_('MULTIPLY', crypt, 0.85), c, (0.025, 0.03, 0.035))
    c = T.mix(T.m_('MULTIPLY', furrow, 0.35), c, (0.04, 0.05, 0.06))
    c = T.mix(lim, c, (0.018, 0.024, 0.032))
    c = T.mix(T.m_('MULTIPLY', ruff, 0.9), c, (0.06, 0.03, 0.012))
    c = T.mix(pup, c, (0.0025, 0.0025, 0.0028))
    T.L(c, T.p.inputs['Base Color'])
    h = T.m_('SUBTRACT', T.m_('ADD', T.m_('MULTIPLY', fib2, 0.6), T.m_('MULTIPLY', ring, 0.5)), T.m_('MULTIPLY', crypt, 0.9))
    b = T.n('ShaderNodeBump', i_Strength=0.7, i_Distance=0.00012); T.L(T.m_('MULTIPLY', h, T.m_('SUBTRACT', 1.0, pup)), b.inputs['Height'])
    T.L(b.outputs['Normal'], T.p.inputs['Normal'])
    T.set('Roughness', 0.55); T.set('Subsurface Weight', 0.15); T.set('Subsurface Scale', 0.0006)
    return T.m, p


def sclera_mat(name='sclera'):
    T = N(name); pos = T.obj(); s = T.sep(pos)
    cosa = T.m_('DIVIDE', s[1], -R)                       # 1 at the corneal axis
    side = T.smooth(T.m_('ABSOLUTE', T.m_('DIVIDE', s[0], R)), 0.12, 0.55)
    away = T.m_('SUBTRACT', 1.0, T.smooth(cosa, 0.55, 0.86))
    warp = T.n('ShaderNodeTexNoise', i_Scale=420.0, i_Detail=4.0); T.L(pos, warp.inputs['Vector'])
    wv = T.v_('ADD', pos, T.v_('SCALE', warp.outputs['Color'], scale=0.0012))
    def veins(scale, w0, w1):
        v = T.n('ShaderNodeTexNoise', i_Scale=scale, i_Detail=3.0, i_Roughness=0.45); T.L(wv, v.inputs['Vector'])
        return T.m_('SUBTRACT', 1.0, T.smooth(T.m_('ABSOLUTE', T.m_('SUBTRACT', v.outputs['Fac'], 0.5)), w0, w1))
    vm = T.m_('MULTIPLY', T.m_('ADD', T.m_('MULTIPLY', away, 0.75), T.m_('MULTIPLY', T.m_('MULTIPLY', away, side), 0.6)),
              T.smooth(T.noise(pos, 300.0, 3.0), 0.35, 0.65))
    big = T.m_('MULTIPLY', veins(110.0, 0.0, 0.009), vm)
    small = T.m_('MULTIPLY', veins(330.0, 0.0, 0.016), T.m_('MULTIPLY', vm, 0.6))
    c = T.mix(T.smooth(T.noise(pos, 180.0, 5.0, 0.6), 0.3, 0.75), (0.58, 0.55, 0.50), (0.53, 0.47, 0.39))
    c = T.mix(T.m_('MULTIPLY', T.m_('MULTIPLY', away, side), 0.55), c, (0.66, 0.40, 0.36))
    c = T.mix(T.m_('MULTIPLY', T.smooth(cosa, 0.80, 0.87), 0.35), c, (0.46, 0.50, 0.55))   # translucent limbal blue-grey
    c = T.mix(T.m_('MULTIPLY', small, 0.35), c, (0.58, 0.16, 0.12))
    c = T.mix(T.m_('MULTIPLY', big, 0.45), c, (0.50, 0.10, 0.08))
    ao = T.n('ShaderNodeAmbientOcclusion', samples=16, inside=False, only_local=False); ao.inputs['Distance'].default_value = 0.004
    c = T.mix(T.m_('SUBTRACT', 1.0, ao.outputs['AO']), c, (0.16, 0.11, 0.10), 'MULTIPLY')     # contact darkening under the lids
    T.L(c, T.p.inputs['Base Color'])
    b = T.n('ShaderNodeBump', i_Strength=0.08, i_Distance=0.00005); T.L(T.m_('ADD', big, small), b.inputs['Height'])
    T.L(b.outputs['Normal'], T.p.inputs['Normal'])
    T.set('Roughness', 0.35); T.set('Subsurface Weight', 0.3); T.p.inputs['Subsurface Radius'].default_value = (1.0, 0.45, 0.3)
    T.set('Subsurface Scale', 0.0012); T.set('Coat Weight', 1.0); T.set('Coat Roughness', 0.03); T.set('Coat IOR', 1.336)
    return T.m


def clear_mat(name, ior=1.376, color=(1.0, 1.0, 1.0)):
    """Clear refracting surface (cornea, tear film) that lets shadow rays through so the iris behind it is lit
    without caustics."""
    T = N(name); T.set('Base Color', (*color, 1)); T.set('Transmission Weight', 1.0); T.set('Roughness', 0.0); T.set('IOR', ior)
    lp = T.n('ShaderNodeLightPath'); tr = T.n('ShaderNodeBsdfTransparent'); mx = T.n('ShaderNodeMixShader')
    out = T.t.nodes['Material Output']
    T.L(lp.outputs['Is Shadow Ray'], mx.inputs[0]); T.L(T.p.outputs[0], mx.inputs[1]); T.L(tr.outputs[0], mx.inputs[2])
    T.L(mx.outputs[0], out.inputs['Surface'])
    return T.m


def build(name='eye', pupil=0.30):
    """Eyeball at the origin looking down -Y. Returns (rig empty, pupil value node, [objects])."""
    rig = bpy.data.objects.new(name + '_rig', None); bpy.context.scene.collection.objects.link(rig)
    a_lim = math.asin(RL / R)
    sc = _obj(name + '_sclera', _cap(R, 0.0, math.pi * 0.98, a_lim - 0.004, 256, 96), sclera_mat(), rig)
    # iris: gently domed disc slightly behind the limbus, pupil hole done in the shader
    bm = bmesh.new(); rows = []
    for i in range(65):
        rr = RL * 1.02 * i / 64
        y = -0.00035 * (1 - (rr / RL) ** 2)
        rows.append([bm.verts.new((0, y, 0))] if i == 0 else [bm.verts.new((rr * math.cos(2 * math.pi * j / 256), y, rr * math.sin(2 * math.pi * j / 256))) for j in range(256)])
    for i in range(64):
        A, B = rows[i], rows[i + 1]
        for j in range(256):
            j2 = (j + 1) % 256
            bm.faces.new((A[0], B[j2], B[j]) if len(A) == 1 else (A[j], A[j2], B[j2], B[j]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y > 0: f.normal_flip()
    im, pv = iris_mat(pupil=pupil)
    ir = _obj(name + '_iris', bm, im, rig); ir.location = (0, YL + 0.0006, 0)
    # dark eye interior behind the pupil
    ins = _obj(name + '_inside', _cap(R * 0.985, 0.0, math.pi * 0.999, a_lim + 0.02, 96, 32), _dark(), rig)
    co = _obj(name + '_cornea', _cap(RC, YC, math.asin(RL / RC) + 0.02, 0.0, 256, 64), clear_mat('cornea'), rig)
    for o in (sc, ir, ins, co):
        o.visible_shadow = o is not co
    return rig, pv, [sc, ir, ins, co]


def _dark():
    T = N('eye_inside'); T.set('Base Color', (0.004, 0.002, 0.002, 1)); T.set('Roughness', 0.9)
    return T.m
