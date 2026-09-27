# mats.py - icon materials (Cycles). CC0 Poly Haven textures from studio.TEX + procedural wear (bevel-normal edge mask).
import bpy, os
import studio as S

_cache = {}


def lin(c):
    """sRGB 0..1 (tuple of 3) -> linear."""
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


def hexc(h):
    h = h.lstrip('#'); return lin(tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))


class NT:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True
        self.nt = self.m.node_tree; self.p = self.nt.nodes['Principled BSDF']
        self.x = -300

    def n(self, t, **kw):
        nd = self.nt.nodes.new(t)
        for k, v in kw.items():
            if k.startswith('i_'):
                key = k[2:].replace('_', ' ')
                nd.inputs[key].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def L(self, a, b):
        self.nt.links.new(a, b)

    def set(self, key, v):
        self.p.inputs[key].default_value = v

    def coords(self, scale, kind='Object'):
        tc = self.n('ShaderNodeTexCoord'); mp = self.n('ShaderNodeMapping')
        s = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
        mp.inputs['Scale'].default_value = tuple(1 / v for v in s)
        self.L(tc.outputs[kind], mp.inputs['Vector'])
        return mp.outputs['Vector']

    def img(self, tex_id, ch, vec, noncolor=False, box=True):
        path = os.path.join(S.TEX, tex_id, ch + '.jpg')
        im = bpy.data.images.load(path, check_existing=True)
        if noncolor: im.colorspace_settings.name = 'Non-Color'
        t = self.n('ShaderNodeTexImage', image=im)
        if box: t.projection = 'BOX'; t.projection_blend = 0.35
        self.L(vec, t.inputs['Vector'])
        return t.outputs['Color']

    def math(self, op, a, b=None, c=None):
        m = self.n('ShaderNodeMath', operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None: continue
            if isinstance(v, (int, float)): m.inputs[i].default_value = v
            else: self.L(v, m.inputs[i])
        return m.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        for idx, v in ((0, fac), (6, a), (7, b)):      # sockets: 0 Factor(float), 6 A(color), 7 B(color)
            sk = m.inputs[idx]
            if isinstance(v, (int, float)): sk.default_value = v if idx == 0 else (v, v, v, 1)
            elif isinstance(v, tuple): sk.default_value = (*v[:3], 1) if len(v) == 3 else v
            else: self.L(v, sk)
        return m.outputs[2]

    def edge(self, radius=0.0012, gain=6.0, noise=0.5, nscale=900.0):
        """Convex-edge mask 0..1 from the Bevel shader node, broken up with noise (edge wear)."""
        bv = self.n('ShaderNodeBevel', samples=8); bv.inputs['Radius'].default_value = radius
        g = self.n('ShaderNodeNewGeometry')
        dp = self.n('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.L(bv.outputs['Normal'], dp.inputs[0]); self.L(g.outputs['Normal'], dp.inputs[1])
        e = self.math('MULTIPLY', self.math('SUBTRACT', 1.0, dp.outputs['Value']), gain)
        if noise > 0:
            nz = self.n('ShaderNodeTexNoise', i_Scale=nscale, i_Detail=8.0, i_Roughness=0.65)
            self.L(self.coords(1.0), nz.inputs['Vector'])
            e = self.math('MULTIPLY', e, self.math('ADD', self.math('MULTIPLY', nz.outputs['Fac'], 2 * noise), 1 - noise))
        return self.math('MINIMUM', self.math('MAXIMUM', e, 0.0), 1.0), bv.outputs['Normal']

    def noise(self, scale, detail=6.0, rough=0.55, space=1.0):
        nz = self.n('ShaderNodeTexNoise', i_Scale=scale, i_Detail=detail, i_Roughness=rough)
        self.L(self.coords(space), nz.inputs['Vector'])
        return nz.outputs['Fac']

    def normal_map(self, tex_id, vec, strength=0.5):
        c = self.img(tex_id, 'nor', vec, noncolor=True)
        nm = self.n('ShaderNodeNormalMap', i_Strength=strength)
        self.L(c, nm.inputs['Color'])
        return nm.outputs['Normal']

    def bump(self, height, strength=0.2, dist=0.0005, normal=None):
        b = self.n('ShaderNodeBump', i_Strength=strength, i_Distance=dist)
        self.L(height, b.inputs['Height'])
        if normal is not None: self.L(normal, b.inputs['Normal'])
        return b.outputs['Normal']


def _get(key, fn):
    if key not in _cache: _cache[key] = fn()
    return _cache[key]


def metal(name, color, rough=0.32, wear=0.5, wear_color=None, wear_rough=0.2, bevel=0.0008, grain=0.25, tex_scale=0.08):
    """Metal with bevel-rounded edges, edge wear towards bright steel, rust/grime-textured roughness."""
    def mk():
        t = NT(name)
        edge, bn = t.edge(radius=bevel * 1.5, gain=5.0)
        vec = t.coords(tex_scale)
        rtex = t.img('rusty_metal_02', 'rough', vec, noncolor=True)
        r = t.math('MULTIPLY_ADD', t.math('SUBTRACT', rtex, 0.5), grain, rough)
        wc = wear_color or tuple(min(1.0, c * 3.2 + 0.18) for c in color)
        w = t.math('MULTIPLY', edge, wear)
        t.L(t.mix(w, color, wc), t.p.inputs['Base Color'])
        rr = t.math('ADD', t.math('MULTIPLY', r, t.math('SUBTRACT', 1.0, w)), t.math('MULTIPLY', w, wear_rough))
        t.L(t.math('MAXIMUM', rr, 0.05), t.p.inputs['Roughness'])
        t.set('Metallic', 1.0)
        nb = t.bump(t.noise(2500.0, 4.0, 0.5), strength=0.04, normal=bn)
        t.L(nb, t.p.inputs['Normal'])
        return t.m
    return _get(name, mk)


def paint(name, color, rough=0.62, wear=0.6, under=None, bevel=0.0008, chips=0.35, sheen_var=0.12):
    """Painted steel/wood: dielectric paint, chipped at the edges to `under` (metal) colour."""
    def mk():
        t = NT(name)
        edge, bn = t.edge(radius=bevel * 1.5, gain=4.5, noise=0.7, nscale=500.0)
        var = t.noise(60.0, 6.0, 0.6)
        base = t.mix(sheen_var, color, t.mix(1.0, color, (0.5, 0.5, 0.5), 'MULTIPLY'))
        base = t.mix(t.math('MULTIPLY', var, 0.35), base, tuple(c * 0.7 for c in color))
        uc = under or (0.30, 0.30, 0.31)
        w = t.math('MULTIPLY', t.math('GREATER_THAN', t.math('MULTIPLY', edge, wear), chips), 1.0)
        t.L(t.mix(w, base, uc), t.p.inputs['Base Color'])
        t.L(t.math('ADD', t.math('MULTIPLY', w, 0.6), t.math('MULTIPLY', t.math('SUBTRACT', 1.0, w), t.math('MULTIPLY_ADD', var, 0.2, rough - 0.1))), t.p.inputs['Metallic'])
        # roughness: paint rough, chips shinier
        t.L(t.math('MULTIPLY_ADD', w, -0.3, t.math('MULTIPLY_ADD', var, 0.15, rough)), t.p.inputs['Roughness'])
        t.L(t.bump(t.noise(400.0, 6.0, 0.6), strength=0.06, normal=bn), t.p.inputs['Normal'])
        return t.m
    return _get(name, mk)


def wood(name, tint=(1, 1, 1), tex='fine_grained_wood', scale=0.18, rough=0.45, coat=0.35, bevel=0.0012, stretch=(1, 1, 1)):
    def mk():
        t = NT(name)
        edge, bn = t.edge(radius=bevel * 1.5, gain=4.0, noise=0.6)
        vec = t.coords(tuple(scale * s for s in stretch))
        c = t.img(tex, 'diff', vec)
        c = t.mix(1.0, c, tint, 'MULTIPLY')
        c = t.mix(t.math('MULTIPLY', edge, 0.5), c, t.mix(1.0, c, (0.55, 0.55, 0.55), 'MULTIPLY'))  # darker handled edges
        t.L(c, t.p.inputs['Base Color'])
        r = t.img(tex, 'rough', vec, noncolor=True)
        t.L(t.math('MULTIPLY_ADD', r, 0.4, rough - 0.2), t.p.inputs['Roughness'])
        # no UVs on procedural meshes -> no tangent-space normal maps; bump from the albedo luminance instead
        t.L(t.bump(t.math('MULTIPLY', t.img(tex, 'rough', vec, noncolor=True), 1.0), strength=0.15, dist=0.0003, normal=bn), t.p.inputs['Normal'])
        t.set('Coat Weight', coat); t.set('Coat Roughness', 0.25)
        return t.m
    return _get(name, mk)


def textured(name, tex, tint=(1, 1, 1), scale=0.1, rough_add=0.0, nstrength=0.7, metal=0.0, coat=0.0, sheen=0.0, bevel=0.0):
    """Generic PBR from a downloaded Poly Haven set (leather, fabric, rubber...)."""
    def mk():
        t = NT(name)
        vec = t.coords(scale)
        c = t.img(tex, 'diff', vec)
        t.L(t.mix(1.0, c, tint, 'MULTIPLY'), t.p.inputs['Base Color'])
        t.L(t.math('ADD', t.img(tex, 'rough', vec, noncolor=True), rough_add), t.p.inputs['Roughness'])
        hp = os.path.join(S.TEX, tex, 'disp.jpg')
        h = t.img(tex, 'disp' if os.path.exists(hp) else 'rough', vec, noncolor=True)
        bn = None
        if bevel > 0:
            bv = t.n('ShaderNodeBevel', samples=8); bv.inputs['Radius'].default_value = bevel; bn = bv.outputs['Normal']
        t.L(t.bump(h, strength=nstrength * 0.5, dist=0.0004, normal=bn), t.p.inputs['Normal'])
        t.set('Metallic', metal); t.set('Coat Weight', coat)
        if sheen: t.set('Sheen Weight', sheen); t.set('Sheen Roughness', 0.6)
        return t.m
    return _get(name, mk)


def solid(name, color, rough=0.4, metal=0.0, coat=0.0, bevel=0.0008, var=0.08, vscale=40.0, bump=0.03, spec=0.5):
    """Bakelite / rubber / enamel / plastic: plain dielectric with subtle mottling and rounded edges."""
    def mk():
        t = NT(name)
        bv = t.n('ShaderNodeBevel', samples=8); bv.inputs['Radius'].default_value = bevel
        v = t.noise(vscale, 6.0, 0.6)
        t.L(t.mix(t.math('MULTIPLY', v, var * 2), color, tuple(c * 0.6 for c in color)), t.p.inputs['Base Color'])
        t.L(t.math('MULTIPLY_ADD', v, 0.12, rough - 0.06), t.p.inputs['Roughness'])
        t.set('Metallic', metal); t.set('Coat Weight', coat); t.set('Coat Roughness', 0.08)
        t.set('Specular IOR Level', spec)
        t.L(t.bump(t.noise(700.0, 5.0, 0.6), strength=bump, normal=bv.outputs['Normal']), t.p.inputs['Normal'])
        return t.m
    return _get(name, mk)


def glass(name, color=(0.95, 0.97, 0.96), rough=0.03, ior=1.5, tint_depth=None):
    def mk():
        t = NT(name)
        t.set('Base Color', (*color, 1)); t.set('Transmission Weight', 1.0); t.set('Roughness', rough); t.set('IOR', ior)
        bv = t.n('ShaderNodeBevel', samples=8); bv.inputs['Radius'].default_value = 0.0005
        t.L(bv.outputs['Normal'], t.p.inputs['Normal'])
        return t.m
    return _get(name, mk)


def emission(name, color, strength=8.0, base=None):
    def mk():
        t = NT(name)
        t.set('Base Color', (*(base or color), 1)); t.set('Emission Color', (*color, 1)); t.set('Emission Strength', strength)
        t.set('Roughness', 0.2)
        return t.m
    return _get(name, mk)


def image(name, path, rough=0.5, alpha=False, coat=0.0, uvmap=True):
    """UV-mapped image (labels, dials, printed papers)."""
    def mk():
        t = NT(name)
        im = bpy.data.images.load(path, check_existing=True)
        tx = t.n('ShaderNodeTexImage', image=im, interpolation='Cubic', extension='CLIP')
        t.L(tx.outputs['Color'], t.p.inputs['Base Color'])
        if alpha:
            t.L(tx.outputs['Alpha'], t.p.inputs['Alpha']); t.m.blend_method = 'HASHED'
        t.set('Roughness', rough); t.set('Coat Weight', coat)
        return t.m
    return _get(name, mk)


def gunmetal(name, coat, coat_metal=0.35, rough=0.45, wear=0.85, steel=None, var=0.35, bevel=0.0012, tex_scale=0.05, fine=0.05):
    """Gun finish (Parkerized / blued): a thin conversion coat over steel. Low-frequency mottling (bluing variation),
    texture-driven specular breakup, bright bare steel on handled edges (bevel-normal edge mask), fine machining bump."""
    def mk():
        t = NT(name)
        edge, bn = t.edge(radius=bevel * 1.5, gain=5.5, noise=0.6, nscale=700.0)
        vec = t.coords(tex_scale)
        rtex = t.img('rusty_metal_02', 'rough', vec, noncolor=True)
        mot = t.noise(45.0, 4.0, 0.5)
        base = t.mix(t.math('MULTIPLY', mot, var), coat, tuple(c * 0.55 for c in coat))
        base = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', rtex, 0.35), 0.5), base, tuple(min(1, c * 1.5) for c in coat))
        st = steel or lin((0.66, 0.66, 0.68))
        w = t.math('MINIMUM', t.math('MULTIPLY', edge, wear), 1.0)
        t.L(t.mix(w, base, st), t.p.inputs['Base Color'])
        t.L(t.math('ADD', t.math('MULTIPLY', w, 1.0 - coat_metal), coat_metal), t.p.inputs['Metallic'])
        r = t.math('MULTIPLY_ADD', t.math('SUBTRACT', rtex, 0.5), 0.35, rough)
        rr = t.math('ADD', t.math('MULTIPLY', r, t.math('SUBTRACT', 1.0, w)), t.math('MULTIPLY', w, 0.2))
        t.L(t.math('MAXIMUM', rr, 0.08), t.p.inputs['Roughness'])
        t.set('Specular IOR Level', 0.6)
        t.L(t.bump(t.noise(1800.0, 4.0, 0.5), strength=fine, normal=bn), t.p.inputs['Normal'])
        return t.m
    return _get(name, mk)
