# guest_skin.py - guest face/skin extras (bible §6: prisoners have dirt + bruise decals at ~50 %, McRae freckles + sunburnt
# nose, Gilbert grey walrus moustache, McRae pencil moustache).
# 'masks3' colour attribute: R = bruise, G = sunburn (nose, cheekbones, forehead), B = dirt, A = freckle region.
import math, random
from mathutils import Vector
from common import *
import materials as MT
from uniform import lin
from shell import make_shell
import skin as SK

BRUISE_AT = {   # offsets from the eye centre (x mirrored by side), metres
    'cheek_l': (1, 0.018, 0.0, -0.03, 0.02), 'cheek_r': (-1, 0.018, 0.0, -0.03, 0.02),
    'brow_l': (1, 0.012, -0.004, 0.022, 0.014), 'brow_r': (-1, 0.012, -0.004, 0.022, 0.014),
    'eye_l': (1, 0.004, 0.004, -0.006, 0.018), 'eye_r': (-1, 0.004, 0.004, -0.006, 0.018),
    'jaw_l': (1, 0.03, 0.03, -0.075, 0.022), 'jaw_r': (-1, 0.03, 0.03, -0.075, 0.022),
    'lip': (0, 0.0, -0.005, -0.07, 0.01)}


def masks3(ctx, spec):
    sk = spec.get('skin', {})
    if not (sk.get('bruises') or sk.get('sunburn') or sk.get('dirt') or sk.get('freckles')):
        return
    h, m = ctx.human, ctx.m
    me = h.data
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    front = m['eye_front_y']
    ex = abs(el.x)
    rnd = random.Random(sk.get('seed', 7))
    dirt_c = [(Vector((rnd.uniform(-0.07, 0.07), front + rnd.uniform(0.0, 0.05), eye_z + rnd.uniform(-0.09, 0.05))), rnd.uniform(0.02, 0.04)) for _ in range(5)]
    attr = me.color_attributes.get('masks3') or me.color_attributes.new('masks3', 'FLOAT_COLOR', 'POINT')
    bz = []
    for b in sk.get('bruises', []):
        s, dx, dy, dz, r = BRUISE_AT[b]
        bz.append((Vector((s * ex + s * dx if s else 0.0, front + 0.01 + dy, eye_z + dz)), r))
    for v in me.vertices:
        c = v.co
        d = ctx.dom[v.index]
        br = 0.0
        if d in ('head', 'neck_01'):
            for p, r in bz:
                br = max(br, max(0.0, 1 - (c - p).length / r) ** 0.7)
        sb = 0.0
        fr = 0.0
        if d == 'head' and c.y < front + 0.03:
            dn = (c - Vector((0, front - 0.028, eye_z - 0.022))).length    # nose bridge + tip
            sb = max(0.0, 1 - dn / 0.03)
            for e in (el, er):
                sb = max(sb, 0.7 * max(0.0, 1 - (c - Vector((e.x * 1.35, e.y, e.z - 0.028))).length / 0.028))
            if c.z > eye_z + 0.03:
                sb = max(sb, 0.35 * min(1.0, (c.z - eye_z - 0.03) / 0.02))
            fr = 1.0 if eye_z - 0.05 < c.z < eye_z + 0.02 else 0.3
        if d.startswith('lowerarm') or d.startswith('hand'):
            fr = 0.6
        dt = 0.0
        if d in ('head', 'neck_01'):
            for p, r in dirt_c:
                dt = max(dt, max(0.0, 1 - (c - p).length / r))
        elif d.startswith('hand') or d.startswith('lowerarm'):
            dt = 0.7
        attr.data[v.index].color = (br, sb, dt, fr)


def tweak_skin_g(human, spec):
    sk = spec.get('skin', {})
    if not (sk.get('bruises') or sk.get('sunburn') or sk.get('dirt') or sk.get('freckles')):
        return
    for mat in human.data.materials:
        if not mat or mat.get('kind') != 'skin':
            continue
        nt = mat.node_tree
        p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        cur = p.inputs['Base Color'].links[0].from_socket
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'masks3'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sep.inputs['Color'])
        tc = nt.nodes.new('ShaderNodeTexCoord')

        def noise(scale, lo, hi, detail=3):
            nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = detail
            nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
            mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = lo; mr.inputs['From Max'].default_value = hi
            nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
            return mr.outputs[0]

        def mul(a, b):
            n = nt.nodes.new('ShaderNodeMath'); n.operation = 'MULTIPLY'
            for i, x in enumerate((a, b)):
                if isinstance(x, (int, float)):
                    n.inputs[i].default_value = x
                else:
                    nt.links.new(x, n.inputs[i])
            return n.outputs[0]

        def mix(fac, col, blend='MIX'):
            nonlocal cur
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = blend
            nt.links.new(fac, mx.inputs['Factor']); nt.links.new(cur, mx.inputs['A']); mx.inputs['B'].default_value = (*col, 1)
            cur = mx.outputs['Result']
        if sk.get('sunburn'):
            mix(mul(sep.outputs['Green'], sk['sunburn']), lin((1.0, 0.66, 0.58)), 'MULTIPLY')
        if sk.get('freckles'):
            mix(mul(mul(at.outputs['Alpha'], noise(420.0, 0.6, 0.68, 2)), sk['freckles']), lin((0.62, 0.38, 0.24)), 'MULTIPLY')
        if sk.get('dirt'):
            mix(mul(mul(sep.outputs['Blue'], noise(40.0, 0.35, 0.65, 4)), sk['dirt']), lin((0.62, 0.55, 0.46)), 'MULTIPLY')
        if sk.get('bruises'):
            f = mul(sep.outputs['Red'], noise(70.0, 0.25, 0.6, 3))
            mix(mul(f, 0.85), lin((0.72, 0.50, 0.58)), 'MULTIPLY')    # purple-brown core
            mix(mul(sep.outputs['Red'], 0.25), lin((0.92, 0.86, 0.55)), 'MULTIPLY')   # yellowing halo
        nt.links.new(cur, p.inputs['Base Color'])


_orig_fh = SK.facial_hair


def facial_hair(ctx, spec):
    fh = spec.get('facial_hair', 'none')
    if fh not in ('pencil', 'walrus'):
        return _orig_fh(ctx, spec)
    m = ctx.m
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    nose_bot = eye_z - 0.043
    mouth_z = eye_z - 0.068 + spec.get('mouth_dz', 0.0)
    front = m['eye_front_y']
    hc = spec.get('facial_hair_color', spec.get('hair', {}).get('color', (0.2, 0.15, 0.1)))
    k_ = max(1.25, 0.30 / max(1e-3, max(hc)))
    col = lin([min(1.0, c * k_) for c in hc])
    lips = set()
    g = ctx.human.vertex_groups.get('lips')
    if g:
        lips = set(v.index for v in ctx.human.data.vertices if any(x.group == g.index and x.weight > 0.3 for x in v.groups))

    def pred(c, d, idx):
        if d not in ('head',) or c.y > front + 0.03:
            return False
        if fh == 'pencil':   # thin trimmed line along the upper lip edge, wide (never a block under the nose)
            return mouth_z + 0.004 < c.z < mouth_z + 0.012 and abs(c.x) < 0.027 - 0.4 * (c.z - mouth_z - 0.004) and not any(i in lips for i in idx)
        # walrus: heavy, droops over the upper lip and past the mouth corners
        t = max(0.0, min(1.0, (c.z - (mouth_z - 0.014)) / max(0.005, nose_bot + 0.004 - (mouth_z - 0.014))))
        half_w = 0.042 - 0.016 * t
        return mouth_z - 0.014 < c.z < nose_bot + 0.004 and abs(c.x) < half_w and (c.z > mouth_z or abs(c.x) > 0.02)

    def off(co, d):
        if fh == 'pencil':
            return 0.0012
        return 0.003 + 0.006 * max(0.0, 1 - abs(co.x) / 0.045)

    mat = MT.fabric('facial_hair', col, kind='wool', rough=0.8, contrast=0.6, dirt=0.0)
    return make_shell(ctx, 'facial_hair', pred, offset_fn=off, smooth=2, mat=mat, rim=0, cover=False, target_tris=220 if fh == 'walrus' else 120, min_off=0.0006)


SK.facial_hair = facial_hair


_orig_hcb = SK.hair_cap_b


def hair_cap_b(ctx, spec):
    """spec.hair.lower (m): bring the front hairline DOWN the forehead (MakeHuman's scalp group sits high on some heads)."""
    hs = spec.get('hair', {})
    low = hs.get('lower', 0.0)
    g = ctx.human.vertex_groups.get('scalp')
    if low and g:
        V = ctx.human.data.vertices
        m = ctx.m
        yc = m['skull_center'][1]
        sc = [v for v in V if any(x.group == g.index and x.weight > 0.5 for x in v.groups)]
        bins = {}
        for v in sc:
            if v.co.y < yc:
                k = int(round(v.co.x / 0.006))
                bins[k] = min(bins.get(k, 9.0), v.co.z)
        add = []
        scs = set(v.index for v in sc)
        for v in V:
            if v.index in scs or ctx.dom[v.index] != 'head' or v.co.y > yc:
                continue
            k = int(round(v.co.x / 0.006))
            if k in bins and v.co.z > bins[k] - low and v.co.z > m['brow_top_z'] + 0.028:
                add.append(v.index)
        g.add(add, 1.0, 'REPLACE')
        log(f'hairline lowered: +{len(add)} scalp verts')
    return _orig_hcb(ctx, spec)


SK.hair_cap_b = hair_cap_b
