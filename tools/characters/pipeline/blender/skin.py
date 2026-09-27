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
    mat = MT.fabric('hair', col, kind='wool', rough=0.7, contrast=1.6, dirt=0.0)
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
    hc = [max(c * 1.25, 0.2) for c in hc]  # never flat black: reads as a hair mass, not a painted block
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
            return 0.0012 + 0.003 * max(0.0, 1 - abs(co.x) / 0.036)
        return 0.005

    mat = MT.fabric('facial_hair', col, kind='wool', rough=0.8, contrast=1.2, dirt=0.0)

    def taper(bm, ctx_, oi):   # feathered edges: thickness fades to the skin over 6 mm from the border
        bnd = [v.co.copy() for v in bm.verts if v.is_boundary]
        for v in bm.verts:
            d = min((v.co - b).length for b in bnd) if bnd else 1.0
            loc, n, i, dd = ctx.bvh.find_nearest(v.co)
            if loc is not None:
                v.co = loc + (v.co - loc) * (0.15 + 0.85 * min(1.0, d / 0.006))
    return make_shell(ctx, 'facial_hair', pred, offset_fn=off, smooth=2, shape_fn=taper, mat=mat, rim=0, cover=False, target_tris=260, min_off=0.0006)
