# uniform.py - parametric period garments built as body shells (shell.py). Presets live in outfits.py.
import bpy, bmesh, math
from mathutils import Vector
from common import *
from shell import make_shell, ring_convexify, centroid, slice_convexify
import materials as MT

TORSO = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'}
UPPER = {'upperarm_l', 'upperarm_r'}
LOWER = {'lowerarm_l', 'lowerarm_r'}
THIGH = {'thigh_l', 'thigh_r'}
CALF = {'calf_l', 'calf_r'}
FOOT = {'foot_l', 'foot_r', 'ball_l', 'ball_r'}


def lin(c):
    return tuple(x ** 2.2 for x in c)


def levels(ctx):
    m = ctx.m
    H = m['height']
    L = dict(m)
    L['waist_z'] = m['belt_z']
    L['hip_z'] = m['crotch_z'] + 0.04
    L['thigh_z'] = m['crotch_z'] - 0.16 * H / 1.8
    L['knee_top_z'] = m['knee_z'] + 0.05
    L['shorts_z'] = m['crotch_z'] - 0.12 * H / 1.8
    L['jack_z'] = m['knee_z'] - 0.10 * H / 1.8        # Marschstiefel shaft top
    L['riding_z'] = m['knee_z'] + 0.02                # officer riding boots (just below the knee pit)
    L['ankle_top_z'] = m['ankle_z'] + 0.05            # ammo boots
    L['gaiter_z'] = m['ankle_z'] + 0.13
    L['lace_high_z'] = m['ankle_z'] + 0.12            # DAK canvas/leather lace-ups
    L['collar_z'] = m['neck_base_z'] + 0.055
    L['chest_z'] = ctx.bone['spine_03'][0].z
    return L


def top(ctx, name, mat, hem='hip', sleeves='long', collar='stand', ease=0.014, flare=0.004, flare_frac=0.07, skirt_ease=0.012, open_v=False, target=2000, v_slope=0.38, v_w=0.016, v_z=0.02, inset_v=None, outer_v=(0.016, 0.38, 0.02), collar_dz=0.0):
    L = levels(ctx)
    hem_z = L[{'waist': 'waist_z', 'hip': 'hip_z', 'thigh': 'thigh_z', 'knee': 'knee_top_z'}[hem]]
    belt = L['belt_z']
    hand = {s: ctx.bone['hand_' + s][0] for s in 'lr'}
    sho = {s: ctx.bone['upperarm_' + s][0] for s in 'lr'}
    elbow = {s: ctx.bone['lowerarm_' + s][0] for s in 'lr'}
    collar_z = L['collar_z'] - (0.015 if collar == 'stand' else 0) if collar in ('stand', 'roll', 'hood') else L['neck_base_z'] - 0.01
    chest = L['chest_z']
    collar_z += collar_dz

    def vshape(c, w, sl, z0, grow=0.0):
        return c.y < -0.03 and c.z > chest + z0 - grow and abs(c.x) < w + grow + (c.z - (chest + z0)) * sl

    def in_v(c):   # open collar V (officer tunic / civilian jacket / waistcoat): front, above the chest
        return open_v and vshape(c, v_w, v_slope, v_z)

    def pred(c, d, idx):
        if inset_v is not None:   # inner layer (shirt/waistcoat): only what shows through the outer garment's V + collar
            if d == 'neck_01':
                return collar != 'none' and L['neck_base_z'] - 0.015 < c.z < collar_z + 0.02   # only above the outer neckline (no z-fight)
            return vshape(c, *outer_v, grow=inset_v) and not in_v(c)
        if in_v(c):
            return False
        if d in TORSO or d in THIGH:
            return c.z > hem_z - 0.03
        if d == 'neck_01':
            return c.z < collar_z + 0.02
        side = d[-1]
        if d in UPPER:
            if sleeves == 'none':
                return (c - sho[side]).length < 0.075
            if sleeves == 'short':
                return (c - sho[side]).length < 0.18
            return True
        if d in LOWER:
            if sleeves == 'long':
                return (c - hand[side]).length > 0.012
            if sleeves == 'rolled':
                return (c - elbow[side]).length < 0.06
        return False

    def off(co, d):
        e = ease
        if d in UPPER or d in LOWER:
            e = ease * 0.9
        if d == 'neck_01':
            e = ease * (1.5 if collar == 'roll' else 1.25)
        if co.z < belt and hem_z < belt:
            e += flare * min(1.0, (belt - co.z) / max(0.05, belt - hem_z))
        return e

    def shape(bm, ctx_, oi):
        # skirt drapes straight down from the belt line: radius(θ, z) >= belt radius(θ) * (1 + flare_frac * t)
        tv = [v for v in bm.verts if (ctx.dom[v[oi]] in TORSO or ctx.dom[v[oi]] in THIGH)]
        band = [v for v in tv if abs(v.co.z - belt) < 0.012]
        if not band or hem_z >= belt:
            return
        cy = sum(v.co.y for v in band) / len(band)
        NB = 36
        rb = [0.0] * NB
        for v in band:
            a = math.atan2(v.co.x, v.co.y - cy); k = int((a + math.pi) / (2 * math.pi) * NB) % NB
            rb[k] = max(rb[k], math.hypot(v.co.x, v.co.y - cy))
        for k in range(NB):   # fill empty bins
            if rb[k] == 0:
                rb[k] = max(rb[(k - 1) % NB], rb[(k + 1) % NB])
        rb = [(rb[(k - 1) % NB] + 2 * rb[k] + rb[(k + 1) % NB]) / 4 for k in range(NB)]
        for v in tv:
            if v.co.z >= belt:
                continue
            t = min(1.0, (belt - v.co.z) / max(0.05, belt - hem_z))
            a = math.atan2(v.co.x, v.co.y - cy)
            f = (a + math.pi) / (2 * math.pi) * NB - 0.5
            k0 = int(math.floor(f)) % NB; k1 = (k0 + 1) % NB; w = f - math.floor(f)
            R = (rb[k0] * (1 - w) + rb[k1] * w) * (1 + flare_frac * t) + skirt_ease * t
            r = math.hypot(v.co.x, v.co.y - cy)
            if r < R and r > 1e-6:
                s_ = R / r
                v.co.x *= s_; v.co.y = cy + (v.co.y - cy) * s_

    cuts = [((0, 0, hem_z), (0, 0, -1)), ((0, 0, collar_z), (0, 0, 1))]
    for s_ in 'lr':
        if sleeves == 'long':
            a = ctx.bone['lowerarm_' + s_][0]; b = hand[s_]; d = (b - a).normalized()
            cuts.append((tuple(b - d * 0.03), tuple(d)))
        else:   # clean armhole / short or rolled sleeve edge: plane across the arm
            a = sho[s_]; b = elbow[s_]; d = (b - a).normalized()
            k = {'none': 0.035, 'short': 0.14, 'rolled': 0.34}[sleeves]
            if sleeves == 'rolled':
                a = elbow[s_]; b = hand[s_]; d = (b - a).normalized(); k = 0.05
            side = 1 if s_ == 'l' else -1
            def sel(c, a=a, d=d, side=side):
                t = (c - a).dot(d)
                return t > -0.01 and (c - a - d * t).length < 0.085 and c.x * side > abs(a.x) - 0.03
            cuts.append((tuple(a + d * k), tuple(d), sel))
    o = make_shell(ctx, name, pred, offset_fn=off, smooth=10, shape_fn=shape, mat=mat, target_tris=target,
                   cover_pred=lambda c: True, cuts=cuts)
    o['garment'] = 'top'
    return o


def legs(ctx, name, mat, bottom='boot', style='trousers', ease=0.014, top_z=None, target=1100):
    L = levels(ctx)
    upper = top_z if top_z is not None else L['hip_z'] + 0.06
    low = {'boot': L['jack_z'] - 0.04, 'ankle': L['ankle_top_z'] - 0.01, 'gaiter': L['gaiter_z'] - 0.03,
           'riding': L['riding_z'] - 0.04, 'shorts': L['shorts_z'], 'shoe': L['ankle_z'] + 0.02, 'lace_high': L['lace_high_z'] - 0.03}[bottom]
    knee = L['knee_z']

    def pred(c, d, idx):
        if d in TORSO:
            return c.z < upper + 0.02 and c.z > low
        if d in THIGH or d in CALF:
            return low - 0.02 < c.z < upper
        return False

    def off(co, d):
        e = ease
        if style == 'breeches' and d in THIGH:   # riding breeches: flared thighs
            t = max(0.0, 1 - abs(co.z - (knee + 0.22)) / 0.2)
            side = 1 if co.x > 0 else -1
            return e + 0.035 * t
        if bottom in ('gaiter', 'boot', 'lace_high') and co.z < low + 0.06:   # bloused into the boot/gaiter
            e += 0.008
        return e

    o = make_shell(ctx, name, pred, offset_fn=off, smooth=8, mat=mat, target_tris=target, cuts=[((0, 0, low), (0, 0, -1)), ((0, 0, upper), (0, 0, 1))])
    o['garment'] = 'legs'
    return o


def boots(ctx, name, mat, style='jack', target=720):
    L = levels(ctx)
    top_z = {'jack': L['jack_z'], 'riding': L['riding_z'], 'ankle': L['ankle_top_z'], 'lace_high': L['lace_high_z'],
             'shoe': L['ankle_z'] + 0.015, 'flippers': L['ankle_z'] + 0.03}[style]
    ank = L['ankle_z']

    def pred(c, d, idx):
        if d in FOOT:
            return True
        if d in CALF:
            return c.z < top_z + 0.02
        return False

    def off(co, d):
        e = 0.006 if style in ('jack', 'riding') else 0.007
        if co.z > top_z - 0.03 and style in ('jack', 'riding'):
            e += 0.006   # shaft opening flares slightly
        return e

    def shape(bm, ctx_, oi):
        for side in (1, -1):
            foot = [v for v in bm.verts if v.co.x * side > 0 and v.co.z < ank + 0.04]
            slice_convexify(foot, axis=1, step=0.012, amount=1.0, grow=0.002)
        shaft = [v for v in bm.verts if v.co.z > ank + 0.03]
        for side in (1, -1):
            vs = [v for v in shaft if v.co.x * side > 0]
            if vs:
                ring_convexify(bm, vs, centroid, amount=0.85 if style in ('jack', 'riding') else 0.5)
        for v in bm.verts:   # flat sole + welt
            if v.co.z < 0.018:
                v.co.z = max(v.co.z, -0.004) if v.co.z > 0.004 else -0.004
        if style == 'flippers':
            for v in bm.verts:
                if v.co.z < 0.03 and v.co.y < ctx.bone['ball_l'][0].y + 0.02:
                    v.co.y -= 0.22 * min(1, (ctx.bone['ball_l'][0].y + 0.02 - v.co.y) / 0.08)
                    v.co.z = max(0.0, v.co.z * 0.3)

    o = make_shell(ctx, name, pred, offset_fn=off, smooth=12, shape_fn=shape, mat=mat, target_tris=target, min_off=0.005, cuts=[((0, 0, top_z), (0, 0, 1))])
    o['garment'] = 'boots'
    return o


def gaiters(ctx, name, mat, target=300):
    L = levels(ctx)
    lo, hi = L['ankle_top_z'] - 0.03, L['gaiter_z']

    def pred(c, d, idx):
        return d in CALF and lo - 0.02 < c.z < hi + 0.02

    def shape(bm, ctx_, oi):
        for side in (1, -1):
            vs = [v for v in bm.verts if v.co.x * side > 0]
            if vs:
                ring_convexify(bm, vs, centroid, amount=0.9)

    o = make_shell(ctx, name, pred, offset=0.016, smooth=3, shape_fn=shape, mat=mat, target_tris=target, cuts=[((0, 0, lo), (0, 0, -1)), ((0, 0, hi), (0, 0, 1))])
    o['garment'] = 'gaiters'
    return o


def fullsuit(ctx, name, mat, target=4200, hood=True):
    """diver's rubber suit: everything but face and hands, tight."""
    L = levels(ctx)
    hand = {s: ctx.bone['hand_' + s][0] for s in 'lr'}
    eye_z = ctx.m['eye_top_z']

    def pred(c, d, idx):
        if d in ('hand_l', 'hand_r') or d.startswith(('index', 'middle', 'ring', 'pinky', 'thumb')):
            return False
        if d in LOWER:
            return (c - hand[d[-1]]).length > 0.03
        if d == 'head':
            if not hood:
                return False
            # hood: everything except the face oval
            face = c.y < ctx.m['skull_center'][1] - 0.02 and c.z < eye_z + 0.045 and c.z > ctx.m['head_z'] - 0.03 and abs(c.x) < 0.062
            return not face
        return True

    o = make_shell(ctx, name, pred, offset=0.0035, smooth=2, mat=mat, target_tris=target, min_off=0.002)
    o['garment'] = 'fullsuit'
    return o
