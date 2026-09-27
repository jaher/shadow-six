# ca_skin.py - commandos_a skin extensions (monkey-patched onto pipeline skin.py; pipeline files untouched)
#  - skin.blend: {"base": "old_caucasian_male", "f": 0.3}  mixes a second MakeHuman diffuse (same UVs) -> lines/age
#  - hair.style == 'shaved': scalp stubble in masks.B (feathered) + skin.scalp_stubble amount, hair.color tint
#  - skin.under_eye: darkening under the eyes (Marine's "morning after"), skin.lines: extra crease darkening
import bpy, os, glob
from mathutils import Vector
from common import *
from uniform import lin
import skin

SPEC = {}
_orig_masks = skin.masks
_orig_tweak = skin.tweak_skin_material


def masks(ctx, parts):
    _orig_masks(ctx, parts)
    h, m = ctx.human, ctx.m
    me = h.data
    attr = me.color_attributes['masks']
    hs = SPEC.get('hair', {})
    if hs.get('style') != 'shaved':
        if SPEC.get('skin', {}).get('under_eye', 0) > 0:   # B = under-eye socket shadow (Marine)
            el, er = Vector(m['eye_l']), Vector(m['eye_r'])
            for i, v in enumerate(me.vertices):
                if ctx.dom[i] != 'head':
                    continue
                b = 0.0
                for e in (el, er):
                    q = v.co - Vector((e.x * 1.05, e.y - 0.004, e.z - 0.017))
                    d = (Vector((q.x, q.y, q.z * 1.8))).length
                    b = max(b, max(0.0, 1 - d / 0.02))
                if b > 0:
                    c = attr.data[i].color
                    attr.data[i].color = (c[0], c[1], b, 1.0)
        return
    g = h.vertex_groups.get('scalp')
    sc = {}
    if g:
        for v in me.vertices:
            w = next((x.weight for x in v.groups if x.group == g.index), 0.0)
            if w > 0.0:
                sc[v.index] = w
    # feather the (stair-stepped) scalp border over 3 rings of neighbours
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b); nb[b].append(a)
    val = [1.0 if sc.get(i, 0) > 0.5 else 0.0 for i in range(len(me.vertices))]
    for it in range(3):
        nv = val[:]
        for i, ns in enumerate(nb):
            if ns and ctx.dom[i] in ('head', 'neck_01'):
                nv[i] = 0.5 * val[i] + 0.5 * sum(val[j] for j in ns) / len(ns)
        val = nv
    n = 0
    for i, v in enumerate(me.vertices):
        if val[i] > 0.01:
            c = attr.data[i].color
            attr.data[i].color = (c[0], c[1], min(1.0, val[i] * 1.15), 1.0)
            n += 1
    log('ca_skin: scalp stubble verts', n)


def _diffuse_node(nt):
    return next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and 'diffuse' in n.image.name.lower()), None)


def tweak_skin_material(human, spec):
    sk = spec.get('skin', {})
    bl = sk.get('blend')
    if bl:
        d = os.path.join(ASSETS, 'skins', bl['base'])
        f = glob.glob(os.path.join(d, '*diffuse*.png'))[0]
        im = bpy.data.images.load(f, check_existing=True)
        for mat in human.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nt = mat.node_tree
            dn = _diffuse_node(nt)
            if not dn:
                continue
            links = [l for l in nt.links if l.from_node == dn and l.from_socket.name == 'Color']
            t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = im
            if dn.inputs['Vector'].is_linked:
                nt.links.new(dn.inputs['Vector'].links[0].from_socket, t2.inputs['Vector'])
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs['Factor'].default_value = bl.get('f', 0.25)
            nt.links.new(dn.outputs['Color'], mx.inputs['A']); nt.links.new(t2.outputs['Color'], mx.inputs['B'])
            for l in links:
                to = l.to_socket
                nt.links.remove(l)
                nt.links.new(mx.outputs['Result'], to)
            log('ca_skin: blended diffuse', os.path.basename(f), bl.get('f', 0.25))
    _orig_tweak(human, spec)
    amt = sk.get('scalp_stubble', 0.0)
    ue = sk.get('under_eye', 0.0)
    if amt <= 0 and ue <= 0:
        return
    hc = lin(spec.get('hair', {}).get('color', (0.3, 0.26, 0.22)))
    for mat in human.data.materials:
        if not mat or mat.get('kind') != 'skin':
            continue
        nt = mat.node_tree
        p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        src = p.inputs['Base Color'].links[0].from_socket
        at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'masks'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sep.inputs['Color'])
        out = src
        if amt > 0:   # speckled stubble over the shaved scalp + a slight grey-blue shadow of the hair roots
            nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1100.0; nz.inputs['Detail'].default_value = 1
            tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
            gm = nt.nodes.new('ShaderNodeMapRange'); gm.inputs['From Min'].default_value = 0.35; gm.inputs['From Max'].default_value = 0.65
            gm.inputs['To Min'].default_value = 0.45; gm.inputs['To Max'].default_value = 1.0
            nt.links.new(nz.outputs['Fac'], gm.inputs['Value'])
            f = nt.nodes.new('ShaderNodeMath'); f.operation = 'MULTIPLY'; f.inputs[1].default_value = amt
            nt.links.new(sep.outputs['Blue'], f.inputs[0])
            f2 = nt.nodes.new('ShaderNodeMath'); f2.operation = 'MULTIPLY'
            nt.links.new(f.outputs[0], f2.inputs[0]); nt.links.new(gm.outputs[0], f2.inputs[1])
            st = nt.nodes.new('ShaderNodeMix'); st.data_type = 'RGBA'; st.blend_type = 'MIX'
            nt.links.new(f2.outputs[0], st.inputs['Factor']); nt.links.new(out, st.inputs['A'])
            st.inputs['B'].default_value = (*[c * 0.8 for c in hc], 1)
            out = st.outputs['Result']
        if ue > 0 and amt <= 0:   # under-eye socket shadow (masks.B when not shaved): darken + cool
            f3 = nt.nodes.new('ShaderNodeMath'); f3.operation = 'MULTIPLY'; f3.inputs[1].default_value = ue
            nt.links.new(sep.outputs['Blue'], f3.inputs[0])
            dk = nt.nodes.new('ShaderNodeMix'); dk.data_type = 'RGBA'; dk.blend_type = 'MULTIPLY'
            nt.links.new(f3.outputs[0], dk.inputs['Factor']); nt.links.new(out, dk.inputs['A'])
            dk.inputs['B'].default_value = (0.62, 0.52, 0.52, 1)
            out = dk.outputs['Result']
        nt.links.new(out, p.inputs['Base Color'])


def install(spec):
    SPEC.clear(); SPEC.update(spec)
    skin.masks = masks
    skin.tweak_skin_material = tweak_skin_material


_orig_hair = skin.hair_cap


def hair_cap(ctx, spec, hide_above=None):
    """under a cap/beret only the short back-and-sides show: drop crop hair above the brow line (the headgear covers it)"""
    if (spec.get('headgear') or {}).get('type') and hide_above is None:
        hide_above = ctx.m['brow_top_z'] + spec.get('hair', {}).get('hide_above_brow', 0.004)
    o = _orig_hair(ctx, spec, hide_above)
    if o is None or hide_above is None:
        return o
    # no crop fragments in front of the ears under a cap (they poked out as dark triangles at the temples),
    # and no islands smaller than 16 faces
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    ey = ctx.m.get('ear_y', 0.0)
    kill = set(f for f in bm.faces if f.calc_center_median().y < ey - 0.004)
    seen = set()
    for f in bm.faces:
        if f in seen or f in kill:
            continue
        isl, st = [], [f]
        seen.add(f)
        while st:
            g = st.pop(); isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen and h not in kill:
                        seen.add(h); st.append(h)
        if len(isl) < 16:
            kill.update(isl)
    bmesh.ops.delete(bm, geom=list(kill), context='FACES')
    bm.to_mesh(o.data); bm.free()
    log('ca_skin: hair under headgear trimmed, faces removed', len(kill))
    return o


_install0 = install


def install(spec):
    _install0(spec)
    skin.hair_cap = hair_cap
