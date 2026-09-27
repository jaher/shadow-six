# ca_outfit.py - commandos_a garment tweaks (monkey-patched; pipeline files untouched)
#  - diver fullsuit: hood with an oval face opening sized to sit under the mask skirt, smoothed border (no stair steps)
import math
from mathutils import Vector
from common import *
import uniform as U
from shell import make_shell

_orig_fullsuit = U.fullsuit


def fullsuit(ctx, name, mat, target=4200, hood=True):
    m = ctx.m
    hand = {s: ctx.bone['hand_' + s][0] for s in 'lr'}
    el, er = Vector(m['eye_l']), Vector(m['eye_r'])
    ez = (el.z + er.z) / 2
    zc, a, b = ez - 0.048, 0.056, 0.074
    sy = m['skull_center'][1]

    def in_face(c):
        return c.y < sy - 0.01 and (c.x / a) ** 2 + ((c.z - zc) / b) ** 2 < 1.0

    def pred(c, d, idx):
        if d in ('hand_l', 'hand_r') or d.startswith(('index', 'middle', 'ring', 'pinky', 'thumb')):
            return False
        if d in U.LOWER:
            return (c - hand[d[-1]]).length > 0.03
        if d == 'head':
            return not in_face(c)
        return True

    def smooth_border(bm, ctx_, oi):
        bm.normal_update()
        bv = [v for v in bm.verts if v.is_boundary and v.co.z > m['neck_base_z']]
        for it in range(12):
            new = {}
            for v in bv:
                nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                if len(nb) == 2:
                    new[v] = v.co * 0.3 + (nb[0].co + nb[1].co) * 0.35
            for v, c in new.items():
                loc, n, i, dd = ctx.bvh.find_nearest(c)
                v.co = loc + n * 0.0035 if loc is not None else c

    o = make_shell(ctx, name, pred, offset=0.0035, smooth=2, mat=mat, target_tris=target, min_off=0.002, shape_fn=smooth_border)
    o['garment'] = 'fullsuit'
    log('ca_outfit: fullsuit with smoothed face opening')
    return o


def install():
    U.fullsuit = fullsuit
