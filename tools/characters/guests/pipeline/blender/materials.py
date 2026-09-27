# materials.py - bake-source materials (object-space box mapped CC0 fabrics, leather, metal, camo). Baked into the atlas later.
import bpy, os
from common import *

BM = os.path.join(SCRATCH, 'realism', 'blender-modeling', 'tex')
FABRIC = {  # name: (folder, LINEAR mean luminance of diff (shader sees linear texels; was sRGB = 2.2x too dark), texture repeat size in metres)
    'wool': ('Fabric030', 0.104, 0.10),
    'canvas': ('Fabric045', 0.557, 0.16),
    'rubber': ('Rubber004', 0.021, 0.25),
}
_imgs = {}


def img(path, noncolor=False):
    if path not in _imgs:
        im = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        _imgs[path] = im
    return _imgs[path]


def _node(nt, t, loc, **kw):
    n = nt.nodes.new(t); n.location = loc
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def _coords(nt, scale):
    tc = _node(nt, 'ShaderNodeTexCoord', (-1200, 0))
    mp = _node(nt, 'ShaderNodeMapping', (-1000, 0))
    mp.inputs['Scale'].default_value = (1 / scale,) * 3
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    return mp.outputs['Vector']


def fabric(name, color, kind='wool', rough=0.85, contrast=0.8, dirt=0.15, sheen=0.3, camo=None):
    """color: linear RGB of the finished cloth. camo: list of 3-4 colours -> brushstroke pattern (noise, box mapped)."""
    folder, mean, rep = FABRIC[kind]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    vec = _coords(nt, rep)
    tex = _node(nt, 'ShaderNodeTexImage', (-800, 200), projection='BOX', projection_blend=0.3)
    tex.image = img(os.path.join(BM, folder, 'diff.jpg'))
    nt.links.new(vec, tex.inputs['Vector'])
    bw = _node(nt, 'ShaderNodeRGBToBW', (-600, 200))
    nt.links.new(tex.outputs['Color'], bw.inputs['Color'])
    # rel = 1 + contrast*(bw/mean - 1)
    div = _node(nt, 'ShaderNodeMath', (-450, 200), operation='MULTIPLY_ADD')
    div.inputs[1].default_value = contrast / mean; div.inputs[2].default_value = 1 - contrast
    nt.links.new(bw.outputs['Val'], div.inputs[0])
    base = _node(nt, 'ShaderNodeRGB', (-600, 400)); base.outputs[0].default_value = (*color, 1)
    col_out = base.outputs[0]
    if camo:
        # brushstroke camo: two stretched noise fields thresholded into colour patches
        tc = _node(nt, 'ShaderNodeTexCoord', (-1200, 600))
        mp2 = _node(nt, 'ShaderNodeMapping', (-1000, 600)); mp2.inputs['Scale'].default_value = (9, 9, 4)
        nt.links.new(tc.outputs['Object'], mp2.inputs['Vector'])
        prev = base.outputs[0]
        for k, c in enumerate(camo):
            nz = _node(nt, 'ShaderNodeTexNoise', (-800, 600 + 200 * k)); nz.inputs['Scale'].default_value = 1.3 + 0.4 * k
            nz.inputs['Detail'].default_value = 3; nz.inputs['Roughness'].default_value = 0.55
            nz.noise_dimensions = '4D'; nz.inputs['W'].default_value = k * 7.3
            nt.links.new(mp2.outputs['Vector'], nz.inputs['Vector'])
            ramp = _node(nt, 'ShaderNodeValToRGB', (-600, 600 + 200 * k))
            ramp.color_ramp.interpolation = 'CONSTANT'
            ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[1].position = 0.56
            ramp.color_ramp.elements[0].color = (0, 0, 0, 1); ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
            nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
            mx = _node(nt, 'ShaderNodeMix', (-400, 600 + 200 * k), data_type='RGBA')
            mx.inputs['B'].default_value = (*c, 1)
            nt.links.new(ramp.outputs['Color'], mx.inputs['Factor'])
            nt.links.new(prev, mx.inputs['A'])
            prev = mx.outputs['Result']
        col_out = prev
    mul = _node(nt, 'ShaderNodeVectorMath', (-250, 300), operation='SCALE')
    nt.links.new(col_out, mul.inputs[0]); nt.links.new(div.outputs[0], mul.inputs['Scale'])
    out = mul.outputs[0]
    if dirt > 0:  # large-scale dirt/fade blotches + darker towards the ground
        tc = _node(nt, 'ShaderNodeTexCoord', (-1200, -500))
        nz = _node(nt, 'ShaderNodeTexNoise', (-800, -500)); nz.inputs['Scale'].default_value = 4.0; nz.inputs['Detail'].default_value = 4
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        sep = _node(nt, 'ShaderNodeSeparateXYZ', (-800, -700)); nt.links.new(tc.outputs['Object'], sep.inputs[0])
        # f = 1 - dirt*(noise-0.5)*0.6 - dirt*max(0, 0.6 - z)*0.7
        a = _node(nt, 'ShaderNodeMath', (-600, -500), operation='MULTIPLY_ADD'); a.inputs[1].default_value = -0.6 * dirt; a.inputs[2].default_value = 1 + 0.3 * dirt
        nt.links.new(nz.outputs['Fac'], a.inputs[0])
        g = _node(nt, 'ShaderNodeMapRange', (-600, -700)); g.inputs['From Min'].default_value = 0.0; g.inputs['From Max'].default_value = 0.6
        g.inputs['To Min'].default_value = 1 - 0.45 * dirt; g.inputs['To Max'].default_value = 1.0
        nt.links.new(sep.outputs['Z'], g.inputs['Value'])
        f = _node(nt, 'ShaderNodeMath', (-400, -600), operation='MULTIPLY')
        nt.links.new(a.outputs[0], f.inputs[0]); nt.links.new(g.outputs[0], f.inputs[1])
        mul2 = _node(nt, 'ShaderNodeVectorMath', (-150, 100), operation='SCALE')
        nt.links.new(out, mul2.inputs[0]); nt.links.new(f.outputs[0], mul2.inputs['Scale'])
        out = mul2.outputs[0]
    nt.links.new(out, p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    # normal map
    nrm_path = os.path.join(BM, folder, 'nor.jpg')
    if os.path.exists(nrm_path):
        nx = _node(nt, 'ShaderNodeTexImage', (-800, -200), projection='BOX', projection_blend=0.3)
        nx.image = img(nrm_path, True)
        nt.links.new(vec, nx.inputs['Vector'])
        nm = _node(nt, 'ShaderNodeNormalMap', (-400, -200)); nm.inputs['Strength'].default_value = 0.6
        nt.links.new(nx.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    m['kind'] = 'cloth'
    m['sheen'] = sheen
    return m


def solid(name, color, rough=0.5, metal=0.0, bump=0.0, kind='hard', noise_scale=60.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if bump > 0:
        tc = _node(nt, 'ShaderNodeTexCoord', (-900, -200))
        nz = _node(nt, 'ShaderNodeTexNoise', (-700, -200)); nz.inputs['Scale'].default_value = noise_scale; nz.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        bp = _node(nt, 'ShaderNodeBump', (-400, -200)); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = 0.002
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], p.inputs['Normal'])
        # subtle colour variation
        mx = _node(nt, 'ShaderNodeMix', (-300, 200), data_type='RGBA', blend_type='MULTIPLY')
        mx.inputs['Factor'].default_value = 0.35
        mx.inputs['A'].default_value = (*color, 1)
        nt.links.new(nz.outputs['Color'], mx.inputs['B'])
        nt.links.new(mx.outputs['Result'], p.inputs['Base Color'])
    m['kind'] = kind
    return m


def leather(name, color, rough=0.45):
    return solid(name, color, rough=rough, bump=0.25, kind='leather', noise_scale=180.0)


def metal(name, color, rough=0.45, metal=0.8):
    return solid(name, color, rough=rough, metal=metal, bump=0.08, kind='metal', noise_scale=90.0)


def paint(name, color, rough=0.7):
    """painted steel (helmets): matte paint with slight grain"""
    return solid(name, color, rough=rough, metal=0.0, bump=0.12, kind='paint', noise_scale=120.0)


def check_fabric(name, color, cols, pitch=0.014, kind='wool', rough=0.95):
    """wool check (tattersall/plaid): base colour + two crossing stripe sets (cols[0] dark, cols[1] light over-check)."""
    m = fabric(name, color, kind=kind, rough=rough, dirt=0.05)
    nt = m.node_tree
    base = next(n for n in nt.nodes if n.type == 'RGB')
    links = [l.to_socket for l in nt.links if l.from_node == base]
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    prev = base.outputs[0]
    for k, (col, per, width) in enumerate(((cols[0], pitch, 0.35), (cols[1], pitch * 2.0, 0.12))):
        stripes = []
        for axis in ('X', 'Z'):
            mt = nt.nodes.new('ShaderNodeMath'); mt.operation = 'PINGPONG'; mt.inputs[1].default_value = per / 2
            nt.links.new(sep.outputs[axis], mt.inputs[0])
            if k == 1:   # offset the over-check
                ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'; ad.inputs[1].default_value = per * 0.25
                nt.links.new(sep.outputs[axis], ad.inputs[0]); nt.links.new(ad.outputs[0], mt.inputs[0])
            lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = per / 2 * width
            nt.links.new(mt.outputs[0], lt.inputs[0]); stripes.append(lt)
        mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'ADD'
        nt.links.new(stripes[0].outputs[0], mx.inputs[0]); nt.links.new(stripes[1].outputs[0], mx.inputs[1])
        fac = nt.nodes.new('ShaderNodeMath'); fac.operation = 'MULTIPLY'; fac.inputs[1].default_value = 0.5 if k == 0 else 0.6
        fac.use_clamp = True
        nt.links.new(mx.outputs[0], fac.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        nt.links.new(fac.outputs[0], mix.inputs['Factor']); nt.links.new(prev, mix.inputs['A']); mix.inputs['B'].default_value = (*col, 1)
        prev = mix.outputs['Result']
    for s in links:
        nt.links.new(prev, s)
    return m
