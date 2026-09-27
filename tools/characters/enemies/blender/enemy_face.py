# enemy_face.py - facial hair for the enemy set (replaces skin.facial_hair for enemies).
# Moustache: a trimmed chevron that follows the upper lip to the mouth corners (half-width 3.0 cm at the lip line,
# 1.9 cm under the nose). HARD RULE kept: never a narrow block under the nose (toothbrush) - the lip-line half-width
# is clamped >= 3.0 cm, i.e. the full mouth width. Thin feathered shell + vertical strand noise, colour from the hair
# (lifted so it reads as hair, not a painted black block). Beard: short full beard (U-boat / remote posts).
import bpy, math
from mathutils import Vector
from common import *
from shell import make_shell
from uniform import lin
import materials as MT


def hair_material(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; p = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (900, 900, 90)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 4
    nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.55; mr.inputs['To Max'].default_value = 1.45
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'
    sc.inputs[0].default_value = col
    nt.links.new(mr.outputs[0], sc.inputs['Scale'])
    nt.links.new(sc.outputs[0], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.62
    m['kind'] = 'cloth'
    return m


def facial_hair(ctx, spec):
    fh = spec.get('facial_hair', 'none')
    if fh in ('none', 'stubble'):
        return None
    m = ctx.m
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    eye_z = (el.z + er.z) / 2
    nose_bot = eye_z - 0.043
    mouth_z = eye_z - 0.066
    front = m['eye_front_y']
    hc = spec.get('facial_hair_color', spec.get('hair', {}).get('color', (0.2, 0.15, 0.1)))
    hc = [c * 1.15 + 0.02 for c in hc]            # hue-preserving: lift dark hair so it reads as hair, cap blond
    mx = max(hc)
    k = 0.32 / mx if mx < 0.32 else (0.62 / mx if mx > 0.62 else 1.0)
    hc = [c * k for c in hc]
    col = lin(hc)
    lips = set()
    g = ctx.human.vertex_groups.get('lips')
    if g:
        lips = set(v.index for v in ctx.human.data.vertices if any(x.group == g.index and x.weight > 0.3 for x in v.groups))
    # width from the measured mouth: to the mouth corners and beyond (>= 3.2 cm half-width), >= 2.2 cm under the nose
    lip_hw = max((abs(ctx.human.data.vertices[i].co.x) for i in lips), default=0.024)
    HW_LIP, HW_NOSE = max(0.032, lip_hw + 0.007), 0.022
    assert HW_LIP >= 0.032 and HW_NOSE >= 0.02   # never a toothbrush block

    def pred(c, d, idx):
        if d not in ('head', 'neck_01') or c.y > front + 0.035:
            return False
        if fh == 'moustache':
            t = max(0.0, min(1.0, (c.z - (mouth_z - 0.003)) / max(0.005, nose_bot + 0.003 - (mouth_z - 0.003))))
            half_w = HW_LIP - (HW_LIP - HW_NOSE) * t
            return mouth_z - 0.004 < c.z < nose_bot + 0.003 and abs(c.x) < half_w and not any(i in lips for i in idx)
        return c.z < nose_bot + 0.003 and c.z > m['neck_base_z'] + 0.035 and c.y < m.get('ear_y', front + 0.08) - 0.02 and not any(i in lips for i in idx)

    def off(co, d):
        if fh == 'moustache':
            return 0.0008 + 0.0022 * max(0.0, 1 - abs(co.x) / HW_LIP)
        return 0.0035

    def taper(bm, ctx_, oi):
        bnd = [v.co.copy() for v in bm.verts if v.is_boundary]
        for v in bm.verts:
            dd = min((v.co - b).length for b in bnd) if bnd else 1.0
            loc, n, i, _ = ctx.bvh.find_nearest(v.co)
            if loc is not None:
                v.co = loc + (v.co - loc) * (0.1 + 0.9 * min(1.0, dd / 0.005))
    return make_shell(ctx, 'facial_hair', pred, offset_fn=off, smooth=2, shape_fn=taper, mat=hair_material('facial_hair', col),
                      rim=0, cover=False, target_tris=260, min_off=0.0005)
