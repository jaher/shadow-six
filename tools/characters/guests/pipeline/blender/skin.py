# skin.py - per-character skin look: tint, ruddiness, stubble/beard shadow, crop hair cap (geometry), brow tint.
# Masks are vertex colours computed from measured landmarks; the material mixes them and the atlas bake flattens it.
import bpy, bmesh, math
from mathutils import Vector
from common import *
import materials as MT
from uniform import lin
from shell import make_shell


def masks(ctx, parts):
    """color attribute 'masks' on the body: R = beard/stubble, G = flush (cheeks, nose, ears), B = hairline shadow"""
    h, m = ctx.human, ctx.m
    me = h.data
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    front_y = m['eye_front_y']
    lips = set()
    g = h.vertex_groups.get('lips')
    if g:
        lips = set(v.index for v in me.vertices if any(x.group == g.index and x.weight > 0.3 for x in v.groups))
    ear_y = m.get('ear_y', front_y + 0.08)
    attr = me.color_attributes.get('masks') or me.color_attributes.new('masks', 'FLOAT_COLOR', 'POINT')
    nose_bot = eye_z - 0.045
    for v in me.vertices:
        c = v.co
        beard = 0.0
        if ctx.dom[v.index] in ('head', 'neck_01') and c.y < ear_y - 0.012 and c.z < nose_bot + 0.006 and c.z > m['neck_base_z'] + 0.02:
            beard = 1.0
            beard *= min(1.0, (nose_bot + 0.006 - c.z) / 0.012)                  # soft upper edge (cheek line)
            if c.z < eye_z - 0.02 and abs(c.x) > 0.055:                             # sideburn/cheek fade
                beard *= max(0.0, 1 - (abs(c.x) - 0.055) / 0.02) if c.z > nose_bot - 0.01 else 1.0
            if v.index in lips:
                beard = 0.0
        flush = 0.0
        for e in (el, er):
            d = (c - Vector((e.x * 1.25, e.y - 0.005, e.z - 0.03))).length
            flush = max(flush, max(0.0, 1 - d / 0.035))
        dn = (c - Vector((0, front_y - 0.03, eye_z - 0.03))).length
        flush = max(flush, max(0.0, 1 - dn / 0.03) * 0.8)
        attr.data[v.index].color = (beard, flush, 0.0, 1.0)


def tweak_skin_material(human, spec):
    sk = spec.get('skin', {})
    tint = sk.get('tint', [1, 1, 1])
    stub = sk.get('stubble', 0.0)
    ruddy = sk.get('ruddy', 0.0)
    hair_col = lin(spec.get('hair', {}).get('color', (0.2, 0.15, 0.1)))
    for mat in human.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not p or not p.inputs['Base Color'].is_linked:
            continue
        src = p.inputs['Base Color'].links[0].from_socket
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'masks'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sep.inputs['Color'])
        tn = nt.nodes.new('ShaderNodeMix'); tn.data_type = 'RGBA'; tn.blend_type = 'MULTIPLY'; tn.inputs['Factor'].default_value = 1.0
        nt.links.new(src, tn.inputs['A']); tn.inputs['B'].default_value = (*tint, 1)
        rd = nt.nodes.new('ShaderNodeMix'); rd.data_type = 'RGBA'; rd.blend_type = 'MULTIPLY'
        mulr = nt.nodes.new('ShaderNodeMath'); mulr.operation = 'MULTIPLY'; mulr.inputs[1].default_value = ruddy
        nt.links.new(sep.outputs['Green'], mulr.inputs[0]); nt.links.new(mulr.outputs[0], rd.inputs['Factor'])
        nt.links.new(tn.outputs['Result'], rd.inputs['A']); rd.inputs['B'].default_value = (1.0, 0.55, 0.5, 1)
        # stubble: speckled darkening in the beard mask
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900.0; nz.inputs['Detail'].default_value = 1
        tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        gm = nt.nodes.new('ShaderNodeMapRange'); gm.inputs['From Min'].default_value = 0.35; gm.inputs['From Max'].default_value = 0.65
        gm.inputs['To Min'].default_value = 0.55; gm.inputs['To Max'].default_value = 1.0
        nt.links.new(nz.outputs['Fac'], gm.inputs['Value'])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'MULTIPLY'; f.inputs[1].default_value = min(1.0, stub * 1.6)
        nt.links.new(sep.outputs['Red'], f.inputs[0])
        f2 = nt.nodes.new('ShaderNodeMath'); f2.operation = 'MULTIPLY'
        nt.links.new(f.outputs[0], f2.inputs[0]); nt.links.new(gm.outputs[0], f2.inputs[1])
        st = nt.nodes.new('ShaderNodeMix'); st.data_type = 'RGBA'; st.blend_type = 'MIX'
        nt.links.new(f2.outputs[0], st.inputs['Factor']); nt.links.new(rd.outputs['Result'], st.inputs['A'])
        st.inputs['B'].default_value = (*[c * 0.55 for c in hair_col], 1)
        nt.links.new(st.outputs['Result'], p.inputs['Base Color'])
        p.inputs['Roughness'].default_value = 0.55
        mat['kind'] = 'skin'


def hair_cap(ctx, spec, hide_above=None):
    """cropped 'short back and sides' hair as a thin shell over the MPFB 'scalp' group (bakes into the atlas)."""
    hs = spec.get('hair', {})
    if hs.get('style', 'crop') in ('none', 'shaved'):
        return None
    g = ctx.human.vertex_groups.get('scalp')
    if not g:
        return None
    sc = set(v.index for v in ctx.human.data.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups))
    top_len = hs.get('length', 0.006)
    crown = ctx.m['crown_z']; ear = ctx.m.get('ear_top_z', crown - 0.1)

    def pred(c, d, idx):
        return all(i in sc for i in idx) and (hide_above is None or c.z < hide_above)

    def off(co, d):
        t = max(0.0, min(1.0, (co.z - ear) / max(0.01, crown - ear)))
        return 0.0015 + top_len * t       # short at the sides, a little longer on top

    col = lin(hs.get('color', (0.2, 0.15, 0.1)))
    mat = MT.fabric('hair', col, kind='wool', rough=0.7, contrast=0.6, dirt=0.0)
    def taper(bm, ctx_, oi):   # hairline: thickness fades to ~0 over 1.5 cm from the border (no jagged step)
        bm.normal_update()
        bv = [v for v in bm.verts if v.is_boundary]
        for it in range(8):   # smooth the hairline (MakeHuman scalp group border is stair-stepped)
            new = {}
            for v in bv:
                nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                if len(nb) == 2:
                    new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
            for v, c in new.items():
                loc, n, i, dd = ctx.bvh.find_nearest(c)
                v.co = loc + n * 0.0008 if loc is not None else c
        bnd = [v.co.copy() for v in bv]
        for v in bm.verts:
            d = min((v.co - b).length for b in bnd) if bnd else 1.0
            f = min(1.0, d / 0.015)
            loc, n, i, dd = ctx.bvh.find_nearest(v.co)
            if loc is not None:
                v.co = loc + (v.co - loc) * (0.25 + 0.75 * f)
    o = make_shell(ctx, 'hair_cap', pred, offset_fn=off, smooth=2, shape_fn=taper, mat=mat, rim=0, cover=False, target_tris=520, min_off=0.0008)
    return o


def facial_hair(ctx, spec):
    """moustache / beard as thin shells over the face (bible: brush moustache for the Sapper, NCO 30 %, U-boat beards)."""
    fh = spec.get('facial_hair', 'none')
    if fh in ('none', 'stubble'):
        return None
    m = ctx.m
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    nose_bot = eye_z - 0.043
    mouth_z = eye_z - 0.068
    front = m['eye_front_y']
    hc = spec.get('facial_hair_color', spec.get('hair', {}).get('color', (0.2, 0.15, 0.1)))
    k_ = max(1.25, 0.34 / max(1e-3, max(hc)))
    hc = [min(1.0, c * k_) for c in hc]  # never flat black: lift the value, keep the hue (reads as a hair mass, not a painted block)
    col = lin(hc)
    lips = set()
    g = ctx.human.vertex_groups.get('lips')
    if g:
        lips = set(v.index for v in ctx.human.data.vertices if any(x.group == g.index and x.weight > 0.3 for x in v.groups))

    def pred(c, d, idx):
        if d not in ('head', 'neck_01') or c.y > front + 0.035:
            return False
        if fh == 'moustache':
            # full chevron/brush moustache covering the whole upper lip and running past the mouth corners.
            # HARD RULE: never a narrow 'toothbrush' block under the nose (min half-width 3.4 cm at the lip line).
            t = max(0.0, min(1.0, (c.z - (mouth_z - 0.004)) / max(0.005, nose_bot + 0.004 - (mouth_z - 0.004))))
            half_w = 0.036 - 0.012 * t
            return mouth_z - 0.006 < c.z < nose_bot + 0.004 and abs(c.x) < half_w and not any(i in lips for i in idx)
        # full beard: jaw/chin/cheeks below the cheekbones + moustache, not the lips
        return c.z < nose_bot + 0.003 and c.z > m['neck_base_z'] + 0.03 and c.y < m.get('ear_y', front + 0.08) - 0.015 and not any(i in lips for i in idx)

    def off(co, d):
        if fh == 'moustache':   # thicker in the middle, feathered at the ends
            return 0.0018 + 0.0045 * max(0.0, 1 - abs(co.x) / 0.04)   # brush: bushy, 6 mm at the centre
        return 0.005

    mat = MT.fabric('facial_hair', col, kind='wool', rough=0.8, contrast=0.6, dirt=0.0)

    def taper(bm, ctx_, oi):   # feathered edges: thickness fades to the skin over 6 mm from the border
        bnd = [v.co.copy() for v in bm.verts if v.is_boundary]
        for v in bm.verts:
            d = min((v.co - b).length for b in bnd) if bnd else 1.0
            loc, n, i, dd = ctx.bvh.find_nearest(v.co)
            if loc is not None:
                v.co = loc + (v.co - loc) * (0.15 + 0.85 * min(1.0, d / 0.006))
    return make_shell(ctx, 'facial_hair', pred, offset_fn=off, smooth=2, shape_fn=taper, mat=mat, rim=0, cover=False, target_tris=260, min_off=0.0006)


# ---------------- commandos_b extensions: scars/burns, grey temples, sallow desaturation, slick hair ----------------
def masks2(ctx, spec):
    """second color attribute 'masks2' on the body (inherited by every shell made afterwards):
    R = grey temples, G = scar/burn mask (mottled in the shader), B = spare."""
    h, m = ctx.human, ctx.m
    me = h.data
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    front = m['eye_front_y']
    ear_y = m.get('ear_y', front + 0.08)
    sk = spec.get('skin', {})
    burns = sk.get('burns')
    scars = sk.get('scars', [])
    hand_l = ctx.bone['hand_l'][0]
    fin_l = ctx.bone.get('middle_01_l', (hand_l,))[0] if hasattr(ctx.bone, 'get') else hand_l
    attr = me.color_attributes.get('masks2') or me.color_attributes.new('masks2', 'FLOAT_COLOR', 'POINT')
    cnt = [0, 0]
    for v in me.vertices:
        c = v.co
        d = ctx.dom[v.index]
        grey = 0.0
        if d == 'head' and abs(c.x) > 0.045 and c.z < eye_z + 0.07 and c.y > front + 0.01:
            grey = min(1.0, (abs(c.x) - 0.045) / 0.02) * min(1.0, (eye_z + 0.07 - c.z) / 0.03)
        sc = 0.0
        if burns:   # Driver M8+: left side of neck and jaw up to the ear, back of the left hand (bible 1.5)
            if d in ('head', 'neck_01') and c.x > 0.025 and c.z < eye_z - 0.015 and c.z > m['neck_base_z'] - 0.03:
                t = min(1.0, (c.x - 0.025) / 0.03)
                if d == 'head':
                    t *= min(1.0, max(0.0, (c.y - (front + 0.02)) / 0.03))   # jaw angle backwards, not the chin/mouth
                sc = max(sc, t)
            if d in ('head',) and c.x > 0.06 and abs(c.y - ear_y) < 0.03 and c.z < eye_z + 0.02:
                sc = max(sc, 0.9)   # lower ear
            if d.startswith('hand_l') or d in ('hand_l',):
                if c.z > hand_l.z - 0.12 and (c - hand_l).length < 0.11:
                    sc = max(sc, 0.8)
        for s in scars:
            if s == 'burn_cheek_r':   # small pale flash-burn on the right cheekbone
                p = Vector((er.x * 1.35, er.y + 0.0, er.z - 0.028))
                sc = max(sc, max(0.0, 1 - (c - p).length / 0.011))
            if s == 'burn_hands':
                for side in 'lr':
                    if d == 'hand_' + side:
                        sc = max(sc, 0.5)
        attr.data[v.index].color = (grey, sc, 0.0, 1.0)
        cnt[0] += grey > 0.05; cnt[1] += sc > 0.05
    log(f'masks2: grey verts {cnt[0]}, scar/burn verts {cnt[1]}, doms near left hand: {sorted(set(ctx.dom[v.index] for v in me.vertices if (v.co - hand_l).length < 0.06))[:8]}')


def tweak_skin_b(human, spec):
    """desaturation (sallow) + scar/burn layer on top of tweak_skin_material."""
    sk = spec.get('skin', {})
    burns = sk.get('burns')
    if not (sk.get('desat') or burns or sk.get('scars')):
        return
    scol = (0.72, 0.32, 0.29) if burns else (0.84, 0.66, 0.60)
    for mat in human.data.materials:
        if not mat or mat.get('kind') != 'skin':
            continue
        nt = mat.node_tree
        p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        src = p.inputs['Base Color'].links[0].from_socket
        cur = src
        if sk.get('desat'):
            hsv = nt.nodes.new('ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = 1 - sk['desat']
            nt.links.new(cur, hsv.inputs['Color']); cur = hsv.outputs['Color']
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'masks2'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sep.inputs['Color'])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 90.0; nz.inputs['Detail'].default_value = 5
        tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.3; mr.inputs['From Max'].default_value = 0.7
        mr.inputs['To Min'].default_value = 0.8 if burns else 0.8; mr.inputs['To Max'].default_value = 1.0
        nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'MULTIPLY'
        nt.links.new(sep.outputs['Green'], f.inputs[0]); nt.links.new(mr.outputs[0], f.inputs[1])
        # mottled scar colour: blotches of pink and pale
        c2 = nt.nodes.new('ShaderNodeMix'); c2.data_type = 'RGBA'
        nt.links.new(nz.outputs['Fac'], c2.inputs['Factor'])
        c2.inputs['A'].default_value = (*lin(scol), 1); c2.inputs['B'].default_value = (*lin((0.90, 0.72, 0.68)), 1)
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(f.outputs[0], mx.inputs['Factor']); nt.links.new(cur, mx.inputs['A']); nt.links.new(c2.outputs['Result'], mx.inputs['B'])
        nt.links.new(mx.outputs['Result'], p.inputs['Base Color'])
        # glossy scar tissue
        rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.55; rr.inputs['To Max'].default_value = 0.28
        nt.links.new(f.outputs[0], rr.inputs['Value']); nt.links.new(rr.outputs[0], p.inputs['Roughness'])


def hair_material(spec):
    """hair: comb-line streaks running front->back, optional grey temples (masks2.R), gloss for oiled hair."""
    hs = spec.get('hair', {})
    col = lin(hs.get('color', (0.2, 0.15, 0.1)))
    m = bpy.data.materials.new('hair_b'); m.use_nodes = True
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 0.08, 1.0)   # stretched along y (front->back)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 260.0; nz.inputs['Detail'].default_value = 6
    nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.55; mr.inputs['To Max'].default_value = 1.45
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    base = nt.nodes.new('ShaderNodeMix'); base.data_type = 'RGBA'; base.blend_type = 'MIX'
    at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'masks2'
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sep.inputs['Color'])
    g = nt.nodes.new('ShaderNodeMath'); g.operation = 'MULTIPLY'; g.inputs[1].default_value = hs.get('grey_temples', 0.0)
    nt.links.new(sep.outputs['Red'], g.inputs[0]); nt.links.new(g.outputs[0], base.inputs['Factor'])
    base.inputs['A'].default_value = (*col, 1); base.inputs['B'].default_value = (*lin((0.52, 0.50, 0.47)), 1)
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'SCALE'
    nt.links.new(base.outputs['Result'], mul.inputs[0]); nt.links.new(mr.outputs[0], mul.inputs['Scale'])
    nt.links.new(mul.outputs[0], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.75 - hs.get('gloss', 0.0)
    m['kind'] = 'hair'
    return m


def hair_cap_b(ctx, spec):
    """hair_cap + receding temples (M-shaped hairline) for spec.hair.recede, slick/grey material."""
    hs = spec.get('hair', {})
    rec = hs.get('recede', 0.0)
    if rec:
        g = ctx.human.vertex_groups.get('scalp')
        sc = [v.co for v in ctx.human.data.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups)]
        ymin = min(c.y for c in sc)
        # temporarily shrink the scalp group: drop the front corners (temples) -> M-shaped hairline
        drop = [v.index for v in ctx.human.data.vertices
                if any(x.group == g.index and x.weight > 0.5 for x in v.groups)
                and (v.co.y - ymin) < rec * min(1.0, abs(v.co.x) / 0.035) + 0.003 * (1 if abs(v.co.x) > 0.015 else 0)]
        g.remove(drop)
        log(f'hair recede: dropped {len(drop)} scalp verts')
    o = hair_cap(ctx, spec)
    if o and (hs.get('style') == 'slick' or hs.get('grey_temples') or hs.get('gloss')):
        o.data.materials.clear(); o.data.materials.append(hair_material(spec))
    return o
