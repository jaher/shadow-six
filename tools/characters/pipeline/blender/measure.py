# measure.py - anatomical landmarks measured from the finished MPFB mesh (Blender Z-up, character faces -Y, +X = left)
import bpy
from mathutils import Vector
from common import *

RIG_BONES = None


def body_verts(human):
    """indices of visible (non-helper) body vertices"""
    gi = human.vertex_groups['body'].index
    return [v.index for v in human.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]


def group_verts(human, name, thr=0.5):
    g = human.vertex_groups.get(name)
    if not g:
        return []
    gi = g.index
    return [v.index for v in human.data.vertices if any(x.group == gi and x.weight > thr for x in v.groups)]


def dominant(human, rig):
    bones = set(b.name for b in rig.data.bones)
    names = {g.index: g.name for g in human.vertex_groups}
    out = []
    for v in human.data.vertices:
        best, bw = None, 0.0
        for g in v.groups:
            n = names.get(g.group)
            if n in bones and g.weight > bw:
                best, bw = n, g.weight
        out.append(best)
    return out


def measure(human, rig, parts):
    V = human.data.vertices
    bv = body_verts(human)
    bset = set(bv)
    dom = dominant(human, rig)
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    m = {'bones': {k: [list(h), list(t)] for k, (h, t) in B.items()}}
    zs = [V[i].co.z for i in bv]
    H = max(zs)
    m['height'] = H
    # crotch: lowest body vertex near x=0 dominated by pelvis/thigh between the legs
    cz = [V[i].co.z for i in bv if abs(V[i].co.x) < 0.02 and dom[i] in ('pelvis', 'thigh_l', 'thigh_r') and V[i].co.z > 0.3 * H]
    m['crotch_z'] = min(cz)
    m['knee_z'] = B['calf_l'][0].z
    m['ankle_z'] = B['foot_l'][0].z
    m['pelvis_z'] = B['pelvis'][0].z
    m['belt_z'] = B['spine_01'][0].z + 0.35 * (B['spine_02'][0].z - B['spine_01'][0].z)
    m['neck_base_z'] = B['neck_01'][0].z
    m['head_z'] = B['head'][0].z
    # ---- head / skull
    head = [i for i in bv if dom[i] in ('head',)]
    hz = [V[i].co.z for i in head]
    m['crown_z'] = max(hz)
    eyes = parts.get('eyes')
    if eyes:
        L = [v.co for v in eyes.data.vertices if v.co.x > 0]
        R = [v.co for v in eyes.data.vertices if v.co.x < 0]
        cl = sum(L, Vector()) / len(L); cr = sum(R, Vector()) / len(R)
        m['eye_l'] = list(cl); m['eye_r'] = list(cr)
        m['eye_top_z'] = max(v.co.z for v in eyes.data.vertices)
        m['eye_front_y'] = min(v.co.y for v in eyes.data.vertices)
    brows = parts.get('brows')
    if brows:
        m['brow_top_z'] = max(v.co.z for v in brows.data.vertices)
        m['brow_front_y'] = min(v.co.y for v in brows.data.vertices)
    else:
        m['brow_top_z'] = m['eye_top_z'] + 0.02
    ears = [i for i in group_verts(human, 'ears') if i in bset]
    if ears:
        el = [V[i].co for i in ears if V[i].co.x > 0]
        m['ear_top_z'] = max(c.z for c in el); m['ear_bot_z'] = min(c.z for c in el)
        m['ear_x'] = max(c.x for c in el)
        m['ear_y'] = sum(c.y for c in el) / len(el)
    # skull ellipse slices (for headgear inner surface): per z level the x/y extents of head+ears-free scalp
    ear_set = set(ears)
    sk = [i for i in head if i not in ear_set]
    slices = []
    z0 = m['eye_top_z'] - 0.03
    z = z0
    while z < m['crown_z']:
        pts = [V[i].co for i in sk if abs(V[i].co.z - z) < 0.006]
        if len(pts) > 6:
            xs = [p.x for p in pts]; ys = [p.y for p in pts]
            slices.append([z, min(xs), max(xs), min(ys), max(ys)])
        z += 0.01
    m['skull_slices'] = slices
    front = [V[i].co for i in sk if abs(V[i].co.z - m['brow_top_z']) < 0.01]
    m['forehead_front_y'] = min(p.y for p in front)
    m['skull_back_y'] = max(V[i].co.y for i in sk)
    m['skull_center'] = [0.0, (m['forehead_front_y'] + m['skull_back_y']) / 2, m['brow_top_z']]
    # nape: back of the neck where the skull meets the neck (for helmet skirt / cap band at the back)
    # nape line (back hairline) ~ just below the ear lobes' top: helmet skirts / cap bands at the back key off it
    m['nape_z'] = m.get('ear_bot_z', m['brow_top_z'] - 0.06) - 0.008
    m['occiput_z'] = m['brow_top_z'] - 0.005
    log('measure: H %.3f crotch %.3f belt %.3f knee %.3f brow %.3f eyeTop %.3f crown %.3f ear %.3f..%.3f' % (
        H, m['crotch_z'], m['belt_z'], m['knee_z'], m['brow_top_z'], m['eye_top_z'], m['crown_z'], m.get('ear_bot_z', 0), m.get('ear_top_z', 0)))
    return m, dom
