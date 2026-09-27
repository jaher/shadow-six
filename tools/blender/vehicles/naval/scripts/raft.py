# The Marine's inflatable assault boat (rubberised-fabric dinghy, 3-man, black), paddles, lifeline.
# Variants: deployed | deflated (shot: collapsed tubes awash, spec 4.3) | packed (rolled bundle carried / pickup).
# blender -b ... --python raft.py -- deployed|deflated|packed|all      Dims: L 2.70, B 1.30, tube D 0.38, draft 0.08 m.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix, noise

ALL = ['deployed', 'deflated', 'packed']
L, B, R = 2.70, 1.30, 0.19
ZC = R - 0.08                     # tube centre height (draft 8 cm)
ZF = 0.02                         # floor (just above the waterline)
PAL = {'dark': (30, 30, 30), 'patch': (58, 56, 52)}


def loop_path(n=40, zc=ZC):
    """Stadium centreline of the buoyancy tube, bow (-Y) raised and pointed a little."""
    a, b = L / 2 - R, B / 2 - R
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = b * math.cos(t), a * math.sin(t)
        s = abs(math.sin(t)) ** 0.35 * (1 if math.sin(t) >= 0 else -1)
        y = a * s
        x = b * math.copysign(abs(math.cos(t)) ** 0.8, math.cos(t))
        if y < 0:
            x *= 1 - 0.18 * (-y / a) ** 3          # bow narrows
        z = zc + (0.14 * max(0.0, (-y - a * 0.4) / (a * 0.6)) ** 2 if y < 0 else 0.0)
        pts.append(V((x, y, z)))
    return pts


def tube(pts, r, rz=1.0, wr=0.0, name='tube', segs=12, key='rubberfab'):
    bm = bmesh.new()
    n = len(pts)
    rings = []
    for i in range(n):
        p = pts[i]
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        nn = t.cross(V((0, 0, 1))).normalized()
        ring = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            d = nn * math.cos(th) + V((0, 0, 1)) * math.sin(th) * rz
            q = p + d * r
            if wr:
                q += V((0, 0, 1)) * wr * noise.noise(q * 4.0) + nn * wr * 0.6 * noise.noise(q * 3.0 + V((5, 1, 2)))
            ring.append(q)
        rings.append(ring)
    vr = [[bm.verts.new(q) for q in r_] for r_ in rings]
    for i in range(n):
        a, b = vr[i], vr[(i + 1) % n]
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((a[k], a[j], b[j], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return np_(bm, key, name, smooth=True, grime=0.5)


def floor_poly(pts, z, wr=0.0, name='floor'):
    bm = bmesh.new()
    inner = [V((p.x * 0.8, p.y * 0.93, z)) for p in pts]
    if wr:
        inner = [q + V((0, 0, wr * noise.noise(q * 3.0))) for q in inner]
    bm.faces.new([bm.verts.new(q) for q in inner])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return np_(bm, 'rubberfab', name, grime=0.6)


def paddle(node, piv, d, up):
    kw = dict(node=node, pivot=tuple(piv))
    a, b = piv - d * 0.55, piv + d * 0.6
    NP('wood', cyl, a, b, 0.017, 6, name='paddle_shaft', **kw)
    NP('wood', beam, a - d * 0.02, a - d * 0.02 + up * 0.001 + (d.cross(up)).normalized() * 0.001, 0.12, 0.03, name='paddle_tgrip', lod='drop', **kw) if False else None
    bm = bmesh.new()
    C.beam_bm(bm, b - d * 0.02, b + d * 0.45, 0.17, 0.014, up=up)
    np_(bm, 'wood', 'paddle_blade', **kw)
    VH.moving(node, 'paddle', piv, (0, 0, 1), limits=(-50, 50), note='stroke cycle: yaw + roll the node about its pivot')
    VH.emitter('paddle_splash', b + d * 0.4, (0, 0, 1), node=node)


def deployed():
    pts = loop_path()
    tube(pts, R)
    floor_poly(pts, ZF)
    # cross thwart tube, lifeline with loops along the tube, valve caps, repair patches, rubbing strake
    tube_seg = [V((x, 0.25, ZC + 0.02)) for x in (-0.46, 0.46)]
    NP('rubberfab', cyl, (-0.47, 0.25, ZC), (0.47, 0.25, ZC), 0.11, 10, name='thwart_tube', smooth=True)
    bm = bmesh.new()
    lp = [p + (p - V((0, 0, p.z))).normalized() * (R * 0.92) + V((0, 0, R * 0.25)) for p in pts]
    for i in range(len(lp)):
        a, b = lp[i], lp[(i + 1) % len(lp)]
        if i % 5 == 2:
            b = a.lerp(b, 0.5) + V((0, 0, -0.07))
        C.cyl_bm(bm, a, b, 0.008, 4, caps=False)
    np_(bm, 'rope', 'lifeline', lod='drop')
    for i in range(0, len(pts), 5):
        p = pts[i]
        o = (p - V((0, 0, p.z))).normalized()
        NP('rubberfab', box, p + o * (R * 0.93) + V((0, 0, R * 0.25)), (0.05, 0.05, 0.05), name='lifeline_patch', lod='drop')
    for i in (7, 29):
        p = pts[i]
        NP('black', cyl, p + V((0, 0, R * 0.95)), p + V((0, 0, R * 1.07)), 0.035, 8, name='valve_cap', lod='drop')
    NP('patch', box, pts[14] + V((0.1, 0, R * 0.7)), (0.10, 0.16, 0.02), name='repair_patch', lod='drop')
    bm = bmesh.new()
    rp = [p + (p - V((0, 0, p.z))).normalized() * (R * 0.98) + V((0, 0, -0.03)) for p in pts]
    for i in range(len(rp)):
        C.beam_bm(bm, rp[i], rp[(i + 1) % len(rp)], 0.03, 0.05)
    np_(bm, 'rubberfab', 'rubbing_strake', grime=0.9)
    # paddles resting across the tubes, blades out (operator strokes them)
    for sx in (-1, 1):
        piv = V((sx * (B / 2 - 0.05), 0.55, ZC + R + 0.02))
        d = V((sx * 0.85, 0.3, -0.42)).normalized()
        paddle('paddle_' + ('l' if sx > 0 else 'r'), piv, d, V((0, 0, 1)))
    NP('rope', cyl, (0, -L / 2 + 0.05, ZC + 0.3), (0, -L / 2 - 0.2, 0.02), 0.01, 4, name='bow_line', lod='drop')
    VH.socket('marine', (0.25, 0.75, ZF), (0, -1, 0), role='driver', pose='kneel_paddle')
    VH.socket('passenger_0', (-0.25, 0.75, ZF), (0, -1, 0), pose='kneel_paddle')
    VH.socket('passenger_1', (0.0, -0.35, ZF), (0, -1, 0), pose='kneel')
    VH.socket('carry_pickup', (0, 0, ZF), (0, -1, 0), note='H: deflate + pack (2.0 s) swaps to raft_packed')
    N.wake((0, L / 2, 0.0), (0, -L / 2 + 0.05, 0.02), B)


def deflated():
    """Shot through (3 hits): tubes collapsed and wrinkled, floor sagging awash; stays as a pickup (spec 4.3)."""
    pts = loop_path(40, zc=0.02)
    pts = [V((p.x * 1.06, p.y * 1.02, 0.02 + (p.z - 0.02) * 0.3)) for p in pts]
    tube(pts, R * 1.1, rz=0.26, wr=0.035)
    floor_poly(pts, -0.01, wr=0.03)
    NP('rubberfab', cyl, (-0.45, 0.25, 0.02), (0.45, 0.25, 0.03), 0.09, 8, name='thwart_tube_flat', smooth=True)
    for sx, (x, y) in ((1, (0.2, 0.3)), (-1, (-0.6, -0.4))):          # loose paddles floating
        paddle('paddle_' + ('l' if sx > 0 else 'r'), V((x, y, 0.04)), V((0.3 * sx, 0.95, 0.0)).normalized(), V((0, 0, 1)))
    for i in (9, 23, 31):
        p = pts[i]
        NP('black', cyl, p + V((0, 0, 0.03)), p + V((0, 0, 0.05)), 0.03, 6, name='bullet_hole', lod='drop')
    VH.socket('carry_pickup', (0, 0, 0.02), (0, -1, 0), note='pickup: H packs it again (spec 4.3)')
    VH.emitter('bubbles', (0.3, 0.1, 0.0), (0, 0, 1), when='deflating', duration_s=2.0)


def packed():
    """Rolled and strapped bundle (carried on the Marine's back: walk 1.35 m/s) with the two paddles strapped on top.
    Origin: bottom centre on the ground (not a waterline asset)."""
    Lr, r = 0.62, 0.20
    bm = bmesh.new()
    C.cyl_bm(bm, V((-Lr / 2, 0, r)), V((Lr / 2, 0, r)), r, 16)
    np_(bm, 'rubberfab', 'roll', smooth=True)
    for k in range(3):                                     # visible fabric layers at the roll ends
        NP('rubberfab', VH.ring_torus, (Lr / 2 + 0.005, 0, r), r * (0.35 + 0.22 * k), 0.012, (1, 0, 0), 14, 4, name='roll_layer', lod='drop')
        NP('rubberfab', VH.ring_torus, (-Lr / 2 - 0.005, 0, r), r * (0.35 + 0.22 * k), 0.012, (1, 0, 0), 14, 4, name='roll_layer', lod='drop')
    for x in (-0.18, 0.18):
        NP('canvas', VH.ring_torus, (x, 0, r), r + 0.008, 0.012, (1, 0, 0), 16, 4, name='strap')
        NP('metal', box, (x, -r - 0.01, r), (0.05, 0.015, 0.04), name='buckle', lod='drop')
    for sx in (-1, 1):
        NP('wood', cyl, (-0.55, sx * 0.05, 2 * r + 0.02), (0.45, sx * 0.05, 2 * r + 0.02), 0.017, 6, name='paddle_shaft')
        NP('wood', box, (0.62, sx * 0.05, 2 * r + 0.02), (0.36, 0.15, 0.014), name='paddle_blade')
    NP('canvas', cyl, (-0.2, 0.0, 2 * r + 0.06), (0.2, 0.0, 2 * r + 0.06), 0.012, 5, name='carry_handle', lod='drop')
    VH.socket('back_attach', (0, 0.0, r), (0, -1, 0), note='attach to the carrier spine: roll axis across the shoulders')
    VH.socket('hand_grip', (0, 0.0, 2 * r + 0.06), (0, -1, 0))


def main(var, out_root):
    N.setup('raft', var, PAL, scale=0.3, seed=31)
    {'deployed': deployed, 'deflated': deflated, 'packed': packed}[var]()
    dims = {'length': L, 'beam': B, 'tube_diameter': 2 * R, 'draft': 0.08, 'packed_size': [0.62, 0.40, 0.44]}
    m = N.finalize(out_root, 'raft', 'raft', dims, 0.08, var, ALL,
                   'Commando inflatable assault boat (rubberised fabric, 3-man)',
                   extra={'side': 'allied', 'state': var, 'water_mask_y': ZF,
                          'note': 'deployed/deflated: origin at the waterline; packed: origin on the ground (carried / pickup)'},
                   ao_dist=0.3)
    if var == 'packed':
        import json
        f = os.path.join(out_root, 'raft', 'raft_packed.kit.json')
        j = json.load(open(f))
        j.pop('review_water', None)
        j['pivot'] = 'bottom centre on the ground; roll axis = X'
        j['vehicle']['origin'] = 'ground'
        json.dump(j, open(f, 'w'), indent=1)


if __name__ == '__main__':
    N.run(main, ALL)
