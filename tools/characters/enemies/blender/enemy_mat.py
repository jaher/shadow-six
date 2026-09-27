# enemy_mat.py - per-variant material variation for the German enemy set (bible §5.2 "uniform variation"):
# cloth tint +-6 %, wear/dirt, helmet paint wear, and a per-face complexion layer (freckles, moles, scar,
# age lines, broken veins) so variants that share a MakeHuman skin texture still read as different men.
import bpy, math, random
from mathutils import Vector
from common import *
import materials as MT

_orig_fabric = MT.fabric
_orig_paint = MT.paint
CLOTH = ('tunic', 'trousers', 'breeches', 'smock', 'coat', 'shirt')


def install(spec):
    oo = spec.get('outfit_opts', {})
    tm = oo.get('tint_mul')
    wear = oo.get('wear')
    hwear = min(0.6, (spec.get('headgear') or {}).get('wear', 0.3))   # > 0.6 read as torn silhouettes

    def fabric(name, color, kind='wool', rough=0.85, contrast=0.8, dirt=0.15, sheen=0.3, camo=None):
        if tm and name in CLOTH:
            color = tuple(c * m for c, m in zip(color, tm))
        if wear is not None and not name.startswith(('hg_', 'litzen', 'tresse')):
            dirt = wear if name in CLOTH else max(dirt, wear * 0.7)
        return _orig_fabric(name, color, kind=kind, rough=rough, contrast=contrast, dirt=dirt, sheen=sheen, camo=camo)

    def paint(name, color, rough=0.7):
        m = _orig_paint(name, color, rough)
        if name.startswith('hg_') and hwear > 0.05:
            worn_paint(m, color, hwear)
        return m
    MT.fabric = fabric
    MT.paint = paint


def _n(nt, t, **kw):
    n = nt.nodes.new(t)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def worn_paint(m, color, wear):
    """helmet: scuffed paint -> darker bare steel on edges/patches + dusty lighter blotches"""
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    src = p.inputs['Base Color'].links[0].from_socket if p.inputs['Base Color'].is_linked else None
    tc = _n(nt, 'ShaderNodeTexCoord')
    nz = _n(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 38.0; nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = 0.7
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    # soft-edged scuffs (a 0.04 threshold band baked into the 1024 atlas as hard, near-black jagged patches on the skirt)
    ramp = _n(nt, 'ShaderNodeMapRange'); ramp.inputs['From Min'].default_value = 0.74 - 0.08 * wear; ramp.inputs['From Max'].default_value = 0.86 - 0.08 * wear
    ramp.inputs['To Max'].default_value = 0.75
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Value'])
    mx = _n(nt, 'ShaderNodeMix', data_type='RGBA')
    if src:
        nt.links.new(src, mx.inputs['A'])
    else:
        mx.inputs['A'].default_value = (*color, 1)
    mx.inputs['B'].default_value = (0.12, 0.12, 0.112, 1)   # worn grey steel, not black
    nt.links.new(ramp.outputs[0], mx.inputs['Factor'])
    nz2 = _n(nt, 'ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 6.0; nz2.inputs['Detail'].default_value = 3
    nt.links.new(tc.outputs['Object'], nz2.inputs['Vector'])
    dust = _n(nt, 'ShaderNodeMix', data_type='RGBA')
    nt.links.new(mx.outputs['Result'], dust.inputs['A'])
    dust.inputs['B'].default_value = (0.42, 0.38, 0.31, 1)
    df = _n(nt, 'ShaderNodeMath', operation='MULTIPLY'); df.inputs[1].default_value = 0.45 * wear
    nt.links.new(nz2.outputs['Fac'], df.inputs[0]); nt.links.new(df.outputs[0], dust.inputs['Factor'])
    nt.links.new(dust.outputs['Result'], p.inputs['Base Color'])


def _surf(human, x, z, band=0.005, front=True):
    """frontmost (or backmost) head vertex near (x, z)"""
    best = None
    for v in human.data.vertices:
        c = v.co
        if abs(c.x - x) < band and abs(c.z - z) < band and (best is None or (c.y < best.y if front else c.y > best.y)):
            best = c.copy()
    return best


def complexion(human, spec, m):
    cx = (spec.get('skin') or {}).get('complexion')
    if not cx:
        return
    rnd = random.Random(cx.get('seed', 1))
    eye = Vector(m['eye_l']); ez = eye.z; ex = abs(eye.x)
    feats = []   # (center, half-axes (along, across, depth), axis dir, colour multiplier, strength)
    for k in range(cx.get('moles', 0)):
        s = rnd.choice((1, -1))
        p = _surf(human, s * rnd.uniform(0.02, 0.055), ez - rnd.uniform(0.02, 0.07))
        if p:
            r = rnd.uniform(0.0016, 0.0026)
            feats.append((p, (r, r, 0.01), Vector((1, 0, 0)), (0.42, 0.30, 0.24), 0.85))
    if cx.get('scar'):
        s = rnd.choice((1, -1))
        if rnd.random() < 0.5:   # cheek scar
            p = _surf(human, s * 0.045, ez - 0.045); d = Vector((s * 0.3, 0, -1)).normalized(); L = 0.018
        else:                    # eyebrow / forehead nick
            p = _surf(human, s * (ex + 0.004), m['brow_top_z'] + 0.008); d = Vector((s * 0.4, 0, 1)).normalized(); L = 0.012
        if p:
            feats.append((p, (L, 0.0022, 0.012), d, (1.18, 0.93, 0.92), 0.8))
    lines = cx.get('lines', 0.0)
    if lines > 0.05:             # nasolabial folds: nose wing -> mouth corner
        for s in (1, -1):
            a = _surf(human, s * 0.021, ez - 0.045); b = _surf(human, s * 0.03, ez - 0.078)
            if a and b:
                feats.append(((a + b) / 2, ((b - a).length / 2 + 0.004, 0.0035, 0.015), (b - a).normalized(), (0.72, 0.62, 0.58), 0.55 * lines))
            c = _surf(human, s * (ex + 0.03), ez - 0.002)   # crow's feet
            if c:
                feats.append((c, (0.009, 0.006, 0.015), Vector((0, 0, 1)), (0.8, 0.7, 0.66), 0.5 * lines))
    for mat in human.data.materials:
        if mat and mat.get('kind') == 'skin':
            _apply(mat, feats, cx, m)
    log('complexion', {k: cx.get(k) for k in ('freckles', 'moles', 'scar', 'lines', 'veins')}, len(feats), 'features')


def _apply(mat, feats, cx, m):
    nt = mat.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    cur = p.inputs['Base Color'].links[0].from_socket
    tc = _n(nt, 'ShaderNodeTexCoord')
    obj = tc.outputs['Object']
    sep = _n(nt, 'ShaderNodeSeparateXYZ'); nt.links.new(obj, sep.inputs[0])
    head = _n(nt, 'ShaderNodeMapRange'); head.inputs['From Min'].default_value = m['neck_base_z'] + 0.03; head.inputs['From Max'].default_value = m['neck_base_z'] + 0.06
    nt.links.new(sep.outputs['Z'], head.inputs['Value'])

    def mult(col, fac):
        nonlocal cur
        mx = _n(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        nt.links.new(cur, mx.inputs['A']); mx.inputs['B'].default_value = (*col, 1)
        nt.links.new(fac, mx.inputs['Factor'])
        cur = mx.outputs['Result']

    fr = cx.get('freckles', 0.0)
    if fr > 0.05:
        nz = _n(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 420.0; nz.inputs['Detail'].default_value = 0.0
        nt.links.new(obj, nz.inputs['Vector'])
        th = _n(nt, 'ShaderNodeMapRange'); th.inputs['From Min'].default_value = 0.66 - 0.06 * fr; th.inputs['From Max'].default_value = 0.72 - 0.06 * fr
        th.inputs['To Max'].default_value = 0.5 * fr
        nt.links.new(nz.outputs['Fac'], th.inputs['Value'])
        f = _n(nt, 'ShaderNodeMath', operation='MULTIPLY'); nt.links.new(th.outputs[0], f.inputs[0]); nt.links.new(head.outputs[0], f.inputs[1])
        mult((0.62, 0.45, 0.33), f.outputs[0])
    if cx.get('veins', 0) > 0:
        nz = _n(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 160.0; nz.inputs['Detail'].default_value = 6
        nt.links.new(obj, nz.inputs['Vector'])
        vc = _n(nt, 'ShaderNodeVertexColor'); vc.layer_name = 'masks'
        sc = _n(nt, 'ShaderNodeSeparateColor'); nt.links.new(vc.outputs['Color'], sc.inputs['Color'])
        th = _n(nt, 'ShaderNodeMapRange'); th.inputs['From Min'].default_value = 0.5; th.inputs['From Max'].default_value = 0.62
        nt.links.new(nz.outputs['Fac'], th.inputs['Value'])
        f = _n(nt, 'ShaderNodeMath', operation='MULTIPLY'); nt.links.new(th.outputs[0], f.inputs[0]); nt.links.new(sc.outputs['Green'], f.inputs[1])
        f2 = _n(nt, 'ShaderNodeMath', operation='MULTIPLY'); f2.inputs[1].default_value = 0.6 * cx['veins']; nt.links.new(f.outputs[0], f2.inputs[0])
        mult((1.0, 0.55, 0.55), f2.outputs[0])
    for c, (a, b, dpt), d, col, strength in feats:
        # ellipsoid mask: TEXTURE mapping = inverse transform -> |q| < 1 inside
        mp = _n(nt, 'ShaderNodeMapping', vector_type='TEXTURE')
        rot = d.to_track_quat('X', 'Z').to_euler()
        mp.inputs['Location'].default_value = c; mp.inputs['Rotation'].default_value = rot
        mp.inputs['Scale'].default_value = (a, b, dpt)
        nt.links.new(obj, mp.inputs['Vector'])
        ln = _n(nt, 'ShaderNodeVectorMath', operation='LENGTH'); nt.links.new(mp.outputs[0], ln.inputs[0])
        mr = _n(nt, 'ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 1.0; mr.inputs['From Max'].default_value = 0.45
        mr.inputs['To Max'].default_value = strength
        nt.links.new(ln.outputs['Value'], mr.inputs['Value'])
        mult(col, mr.outputs[0])
    nt.links.new(cur, p.inputs['Base Color'])


def iris(parts, spec):
    """recolour the MakeHuman eye texture's iris (saturated, non-white pixels) to spec['eyes']['iris'] (sRGB)"""
    col = (spec.get('eyes') or {}).get('iris')
    eyes = parts.get('eyes')
    if not col or not eyes:
        return
    lc = [c ** 2.2 for c in col]
    n = 0
    for mat in eyes.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        p = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if not p or not p.inputs['Base Color'].is_linked:
            continue
        src = p.inputs['Base Color'].links[0].from_socket
        hsv = _n(nt, 'ShaderNodeSeparateColor', mode='HSV'); nt.links.new(src, hsv.inputs['Color'])
        fac = _n(nt, 'ShaderNodeMapRange'); fac.inputs['From Min'].default_value = 0.12; fac.inputs['From Max'].default_value = 0.3
        nt.links.new(hsv.outputs[1], fac.inputs['Value'])
        val = _n(nt, 'ShaderNodeMath', operation='MULTIPLY'); val.inputs[1].default_value = 2.2
        nt.links.new(hsv.outputs[2], val.inputs[0])
        tint = _n(nt, 'ShaderNodeVectorMath', operation='SCALE'); tint.inputs[0].default_value = lc
        nt.links.new(val.outputs[0], tint.inputs['Scale'])
        mx = _n(nt, 'ShaderNodeMix', data_type='RGBA')
        nt.links.new(src, mx.inputs['A']); nt.links.new(tint.outputs[0], mx.inputs['B']); nt.links.new(fac.outputs[0], mx.inputs['Factor'])
        nt.links.new(mx.outputs['Result'], p.inputs['Base Color'])
        n += 1
    log('iris', col, n, 'materials')
