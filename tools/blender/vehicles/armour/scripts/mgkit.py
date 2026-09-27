# mgkit.py - MG 34 / MG 42 on the MG-Lafette 34 (sMG role) + sandbag helpers, shared by mg_tripod.py and mg_nest.py.
# Built facing -Y (front), ground z=0 at the feet unless z0 given.
# Lafette 34: long tubular top frame (Lafettenrahmen); single telescopic front leg hinged at its front end; rear leg
# pair splayed from the rear hinge block, with broad feet and the padded carrying cushion on the rear cross-bar;
# traverse dial on the frame; spring-buffered cradle (Wiege) with the buffer housing; traverse + elevation
# mechanism (elevation screw housing, handwheel, traverse lever) and the trigger frame with twin grips at the rear;
# MG-Zieleinrichtung 34 periscopic optical sight on its bracket, left side.
import math
from mathutils import Vector, Matrix
import vlib as V
from vlib import B, P, node, D

def _tube(name, a, b, r, parent, key='paint', lod=2, segs=8):
    return P(B.log_cyl(name, Vector(a), Vector(b), r, segs=segs), parent, key, lod)

def mg_gun(kind, loc, parent):
    """Detailed MG 34 / MG 42 (1.22 m), receiver rear-centre at loc, muzzle towards -Y. Returns muzzle point."""
    x, y, z = loc
    at = lambda dx, dy, dz: (x + dx, y + dy, z + dz)
    parts = []
    def add(key, ob, lod=2):
        P(ob, parent, key, lod)
    if kind == 'mg34':
        # tubular receiver + feed cover, perforated round jacket with front bearing, cone muzzle booster
        add('gunmetal', B.cylinder('rec', 0.03, 0.34, at(0, -0.17, 0), 'Y', 12))
        add('gunmetal', B.box('feed_cover', (0.07, 0.20, 0.035), at(0, -0.22, 0.038), bevel=0.006, segs=1))
        add('gunmetal', B.box('feed_tray', (0.12, 0.07, 0.03), at(0.03, -0.22, 0.01)), 1)
        add('gunmetal', B.cylinder('jacket', 0.026, 0.46, at(0, -0.58, 0), 'Y', 14))
        add('gunmetal', B.cylinder('jacket_front', 0.03, 0.05, at(0, -0.82, 0), 'Y', 14))
        for k in range(8):           # rows of round cooling holes (dark dots on the visible upper half)
            for a in (-0.9, 0.0, 0.9, 1.8, -1.8):
                c = Vector((x + 0.0265 * math.sin(a), y - 0.39 - k * 0.052, z + 0.0265 * math.cos(a)))
                o = B.cylinder('jhole', 0.008, 0.004, (0, 0, 0), 'Z', 6); B.apply_all(o)
                o.data.transform(Matrix.Translation(c) @ Vector((0, 0, 1)).rotation_difference(Vector((math.sin(a), 0, math.cos(a)))).to_matrix().to_4x4())
                add('black', o, 1)
        add('gunmetal', B.cylinder('booster', 0.028, 0.07, at(0, -0.88, 0), 'Y', 12, r2=0.02))
        add('gunmetal', B.cylinder('muzzle_cone', 0.017, 0.06, at(0, -0.94, 0), 'Y', 10, r2=0.024))
        add('gunmetal', B.box('front_sight', (0.008, 0.02, 0.045), at(0, -0.83, 0.045)), 1)
        add('gunmetal', B.box('rear_sight', (0.02, 0.05, 0.03), at(0, -0.36, 0.045)), 1)
        stock = [(0.0, 0.025), (0.12, 0.01), (0.30, -0.005), (0.31, -0.11), (0.27, -0.12), (0.14, -0.06), (0.0, -0.035)]
        add('wood', B.prism('stock', [(y + a, z + b) for a, b in stock], 0.045, plane='YZ', offset=x, bevel=0.006, segs=1))
        grip = [(-0.035, -0.02), (-0.085, -0.02), (-0.075, -0.15), (-0.035, -0.15)]
        add('wood', B.prism('grip', [(y + a, z + b) for a, b in grip], 0.035, plane='YZ', offset=x, bevel=0.006, segs=1))
        add('gunmetal', B.box('trigger_guard', (0.012, 0.07, 0.03), at(0, -0.10, -0.05)), 1)
    else:
        # stamped rectangular receiver, square jacket with oval slots + big right-side barrel-change slot
        add('gunmetal', B.box('rec', (0.058, 0.40, 0.078), at(0, -0.20, 0), bevel=0.006, segs=1))
        add('gunmetal', B.box('feed_cover', (0.07, 0.22, 0.03), at(0, -0.25, 0.052), bevel=0.005, segs=1))
        add('gunmetal', B.box('feed_tray', (0.13, 0.08, 0.03), at(0.03, -0.25, 0.02)), 1)
        J0, J1, js = -0.40, -0.84, 0.056
        jl = J0 - J1
        add('gunmetal', B.box('jacket_top', (js, jl, 0.004), at(0, (J0 + J1) / 2, js / 2)))
        add('gunmetal', B.box('jacket_bot', (js, jl, 0.004), at(0, (J0 + J1) / 2, -js / 2)))
        add('gunmetal', B.box('jacket_l', (0.004, jl, js), at(js / 2, (J0 + J1) / 2, 0)))
        add('gunmetal', B.box('jacket_r', (0.004, 0.14, js), at(-js / 2, J1 + 0.07, 0)))       # right side: slot 0.26
        add('gunmetal', B.box('jacket_r', (0.004, 0.04, js), at(-js / 2, J0 - 0.02, 0)))
        add('black', B.box('jacket_inside', (js - 0.01, jl - 0.01, js - 0.01), at(0, (J0 + J1) / 2, 0)), 1)
        add('gunmetal', B.cylinder('bbl', 0.012, jl, at(0, (J0 + J1) / 2, 0), 'Y', 8))
        add('gunmetal', B.box('barrel_catch', (0.02, 0.05, 0.03), at(-js / 2 - 0.01, J0 - 0.03, 0.0)), 1)
        for k in range(6):           # oval cooling slots: top + left side (dark stadium plates)
            yy = J0 - 0.05 - k * 0.062
            add('black', B.box('jslot', (0.034, 0.028, 0.002), at(0, yy, js / 2 + 0.002), bevel=0.006, segs=1), 1)
            add('black', B.box('jslot', (0.002, 0.028, 0.03), at(js / 2 + 0.002, yy, 0), bevel=0.006, segs=1), 1)
        add('gunmetal', B.cylinder('booster', 0.024, 0.08, at(0, -0.88, 0), 'Y', 12, r2=0.02))
        add('gunmetal', B.cylinder('muzzle_cone', 0.016, 0.05, at(0, -0.94, 0), 'Y', 10, r2=0.022))
        add('gunmetal', B.box('front_sight', (0.01, 0.02, 0.05), at(0, -0.83, js / 2 + 0.025)), 1)
        add('gunmetal', B.box('rear_sight', (0.02, 0.06, 0.035), at(0, -0.44, 0.06)), 1)
        stock = [(0.0, 0.03), (0.12, 0.012), (0.28, -0.005), (0.29, -0.11), (0.25, -0.125), (0.12, -0.07), (0.0, -0.04)]
        add('black', B.prism('stock', [(y + a, z + b) for a, b in stock], 0.045, plane='YZ', offset=x, bevel=0.006, segs=1))
        grip = [(-0.045, -0.035), (-0.095, -0.035), (-0.08, -0.16), (-0.04, -0.16)]
        add('black', B.prism('grip', [(y + a, z + b) for a, b in grip], 0.035, plane='YZ', offset=x, bevel=0.006, segs=1))
        add('gunmetal', B.box('trigger_guard', (0.012, 0.07, 0.03), at(0, -0.12, -0.055)), 1)
    # belt: 50-round link belt from the feed tray (left) down towards the ammunition can
    for k in range(6):
        add('brass', B.box('belt', (0.028, 0.012, 0.075), at(0.085 + k * 0.03, -0.25, 0.0 - k * 0.028), rot=('Y', -40)), 1)
    return (x, y - 0.97, z)

def ammo_can(loc, parent, rz=0.0, open_=False):
    """Patronenkasten 34: pressed-steel belt can 0.28 x 0.10 x 0.17 m, hinged lid, carrying handle, latch."""
    x, y, z = loc
    body = B.box('ammo_box', (0.10, 0.28, 0.16), (0, 0, 0.08), bevel=0.008, segs=1); B.apply_all(body)
    P(V._xf(body, loc, rz), parent, 'paint', 2)
    lid = B.box('ammo_lid', (0.106, 0.286, 0.018), (0, 0, 0.169), bevel=0.004, segs=1); B.apply_all(lid)
    P(V._xf(lid, loc, rz), parent, 'paint', 1)
    h = B.beam('ammo_handle', (0, -0.07, 0.19), (0, 0.07, 0.19), 0.012, 0.012); B.apply_all(h)
    P(V._xf(h, loc, rz), parent, 'steel', 1)
    for dy in (-0.07, 0.07):
        s = B.box('handle_post', (0.01, 0.01, 0.025), (0, dy, 0.18)); B.apply_all(s)
        D(V._xf(s, loc, rz), 'steel')
    lt = B.box('ammo_latch', (0.012, 0.04, 0.04), (0.055, 0, 0.15)); B.apply_all(lt)
    D(V._xf(lt, loc, rz), 'steel')
    rib = B.box('ammo_rib', (0.104, 0.01, 0.12), (0, 0, 0.07)); B.apply_all(rib)
    D(V._xf(rib, loc, rz), 'paint')

def tripod(kind='mg42', base=(0.0, 0.0, 0.0), parent='hull', low=True, cans=2):
    """MG-Lafette 34 in the low (prone) or medium position. Nodes: mount (traverse, axis Z) -> gun (elevation, X).
    Returns bore height (world)."""
    x0, y0, z0 = base
    hz = z0 + (0.36 if low else 0.58)                     # traverse dial / cradle pivot height
    fh = Vector((x0, y0 - 0.30, hz - 0.06))               # front hinge (front leg)
    rh = Vector((x0, y0 + 0.30, hz - 0.14))               # rear hinge block (rear legs)
    _tube('frame', fh, rh, 0.022, parent, 'paint', 2, 10)
    _tube('frame_lower', fh + Vector((0, 0.05, -0.05)), rh + Vector((0, -0.05, -0.03)), 0.014, parent, 'paint', 1)
    P(B.box('front_hinge', (0.07, 0.07, 0.07), tuple(fh), bevel=0.008, segs=1), parent, 'paint', 1)
    P(B.box('rear_hinge', (0.14, 0.09, 0.08), tuple(rh), bevel=0.01, segs=1), parent, 'paint', 1)
    # telescopic front leg: outer sleeve + inner tube + clamp, spiked foot plate
    ff = Vector((x0, y0 - 0.95 if low else y0 - 0.80, z0))
    _tube('front_leg', fh, fh.lerp(ff, 0.55), 0.021, parent, 'paint', 2, 10)
    _tube('front_leg_inner', fh.lerp(ff, 0.5), ff + Vector((0, 0, 0.03)), 0.015, parent, 'paint', 2, 8)
    _tube('leg_clamp', fh.lerp(ff, 0.52), fh.lerp(ff, 0.58), 0.028, parent, 'steel', 1, 8)
    P(B.box('front_foot', (0.10, 0.08, 0.02), (ff.x, ff.y, z0 + 0.01)), parent, 'paint', 1)
    P(B.cylinder('front_spike', 0.012, 0.08, (ff.x, ff.y, z0 - 0.02), 'Z', 5), parent, 'steel', 0)
    V.contact('tripod_foot_front', tuple(ff), 'foot', node=parent)
    # rear legs splayed back, broad feet, cross-bar with the padded carrying cushion
    feet = []
    for sx in (-1, 1):
        rf = Vector((x0 + sx * 0.42, y0 + (0.78 if low else 0.70), z0))
        top = rh + Vector((sx * 0.06, 0, 0))
        _tube('rear_leg', top, top.lerp(rf, 0.6), 0.02, parent, 'paint', 2, 10)
        _tube('rear_leg_inner', top.lerp(rf, 0.55), rf + Vector((0, 0, 0.03)), 0.015, parent, 'paint', 2, 8)
        _tube('leg_clamp', top.lerp(rf, 0.57), top.lerp(rf, 0.63), 0.026, parent, 'steel', 1, 8)
        P(B.box('rear_foot', (0.12, 0.10, 0.02), (rf.x, rf.y, z0 + 0.01), rot=('Z', sx * 20)), parent, 'paint', 1)
        V.contact(f'tripod_foot_{"L" if sx > 0 else "R"}', tuple(rf), 'foot', node=parent)
        feet.append(top.lerp(rf, 0.45))
    _tube('cross_bar', feet[0], feet[1], 0.014, parent, 'paint', 1)
    mid = (feet[0] + feet[1]) / 2
    P(B.box('carry_pad', (0.30, 0.07, 0.10), tuple(mid + Vector((0, 0.02, 0.03))), bevel=0.025, segs=2), parent, 'canvas', 1)
    # traverse dial on the frame + mount node
    node('mount', (x0, y0 - 0.12, hz), parent, 'weapon_traverse', (0, 0, 1), traverse_deg=(-30, 30))
    P(B.cylinder('traverse_dial', 0.075, 0.03, (x0, y0 - 0.12, hz - 0.02), 'Z', 16), 'mount', 'paint', 1)
    D(B.cylinder('dial_ring', 0.078, 0.008, (x0, y0 - 0.12, hz - 0.005), 'Z', 16), 'steel')
    # spring-buffered cradle: channel + buffer housing below its rear, locking lever
    gz = hz + 0.12
    node('gun', (x0, y0 - 0.12, gz - 0.04), 'mount', 'weapon_elev', (1, 0, 0), elev=(-15, 20))
    P(B.box('cradle', (0.075, 0.70, 0.04), (x0, y0 + 0.02, gz - 0.06), bevel=0.006, segs=1), 'gun', 'paint')
    for sx in (-1, 1):
        P(B.box('cradle_side', (0.008, 0.66, 0.05), (x0 + sx * 0.04, y0 + 0.02, gz - 0.03)), 'gun', 'paint', 1)
    P(B.cylinder('buffer', 0.028, 0.26, (x0, y0 + 0.20, gz - 0.10), 'Y', 10), 'gun', 'paint', 1)
    D(B.cylinder('buffer_ring', 0.031, 0.015, (x0, y0 + 0.10, gz - 0.10), 'Y', 10), 'steel')
    P(B.box('gun_latch', (0.03, 0.04, 0.05), (x0, y0 - 0.30, gz - 0.02)), 'gun', 'steel', 1)
    # T&E: elevation screw housing (from the rear hinge up to the cradle), handwheel, traverse lever
    _tube('elev_housing', rh + Vector((0, -0.02, 0.04)), Vector((x0, y0 + 0.22, gz - 0.10)), 0.02, 'mount', 'paint', 1)
    hw = B.lathe('elev_wheel', [(0.045, 0.006), (0.055, 0.006), (0.055, -0.006), (0.045, -0.006)], segs=12, axis='X')
    P(V._xf(hw, (x0 - 0.07, y0 + 0.26, hz - 0.06)), 'mount', 'steel', 1)
    P(B.beam('elev_crank', (x0 - 0.075, y0 + 0.26, hz - 0.06), (x0 - 0.075, y0 + 0.26, hz - 0.01), 0.01, 0.01), 'mount', 'black', 0)
    P(B.beam('traverse_lever', (x0 + 0.04, y0 + 0.28, hz - 0.10), (x0 + 0.16, y0 + 0.36, hz - 0.12), 0.012, 0.012), 'mount', 'steel', 1)
    # trigger frame with twin grips at the rear of the cradle
    P(B.box('trigger_frame', (0.16, 0.035, 0.035), (x0, y0 + 0.40, gz - 0.07)), 'gun', 'paint', 1)
    for sx in (-1, 1):
        P(B.box('frame_grip', (0.03, 0.035, 0.10), (x0 + sx * 0.08, y0 + 0.41, gz - 0.12), rot=('X', -10)), 'gun', 'black', 1)
    # MG-Zieleinrichtung 34: bracket arm (left), periscopic sight body, objective head, eyepiece
    P(B.box('sight_bracket', (0.09, 0.03, 0.03), (x0 + 0.075, y0 + 0.02, gz + 0.02)), 'gun', 'paint', 1)
    P(B.box('sight_body', (0.05, 0.16, 0.08), (x0 + 0.135, y0 + 0.04, gz + 0.06), bevel=0.008, segs=1), 'gun', 'gunmetal', 1)
    P(B.box('sight_head', (0.05, 0.06, 0.07), (x0 + 0.135, y0 - 0.02, gz + 0.13), bevel=0.008, segs=1), 'gun', 'gunmetal', 1)
    P(B.cylinder('sight_eyepiece', 0.018, 0.06, (x0 + 0.135, y0 + 0.14, gz + 0.07), 'Y', 8), 'gun', 'black', 1)
    mz = mg_gun(kind, (x0, y0 + 0.30, gz), 'gun')
    V.muzzle(kind, mz, 'gun', (0, -1, 0), kind)
    for i in range(cans):            # belt cans beside the gun (left), lid-up can feeding the belt
        ammo_can((x0 + 0.30 + i * 0.14, y0 - 0.10, z0), parent)
    V.socket('gunner', (x0, y0 + 1.25, z0), parent, heading=0.0, pose='prone_mg' if low else 'kneel_mg')
    V.socket('loader', (x0 + 0.65, y0 + 0.9, z0), parent, heading=0.0, pose='prone' if low else 'kneel')
    return gz

def sandbag_mesh(name='sandbag', L=0.58, W=0.3, H=0.14, slump=0.0, bend=0.0, seed=0):
    """One filled sandbag: subdivided box with pinched, tapered ends, a tied end, slumped belly (slump: sag of the top
    and bulge of the sides) and optional bend (draped over an edge: ends drop by `bend`). Origin-centred."""
    import random
    rng = random.Random(seed)
    import bmesh
    o = B.box(name, (L, W, H), (0, 0, 0), bevel=0.045, segs=1)
    B.apply_all(o)
    bm = bmesh.new(); bm.from_mesh(o.data)                 # centre loop so the belly can slump / the bag can bend
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(1, 0, 0))
    bm.to_mesh(o.data); bm.free()
    for v in o.data.vertices:
        t = abs(v.co.x) / (L / 2)
        v.co.z *= 1.0 - 0.35 * t ** 3
        v.co.y *= 1.0 - 0.18 * t ** 3
        if slump:
            v.co.z -= slump * H * (1 - t * t) * (0.5 + v.co.z / H)
            v.co.y *= 1.0 + slump * 0.25 * (1 - t * t)
        if bend:
            v.co.z -= bend * t * t
        if v.co.x > L * 0.44:          # tied neck at +X end
            v.co.y *= 0.8; v.co.z *= 0.8
        v.co.z += rng.uniform(-0.004, 0.004)
    # rework2: tied ears at the neck (+X): gathered fabric cone + two flattened ear flaps, a stitched fold at -X
    bm = bmesh.new(); bm.from_mesh(o.data)
    x0, x1, e = L / 2 - 0.01, L / 2 + 0.095, 0.034
    base = [bm.verts.new((x0, sy * e, sz * e * 0.8)) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    tip = bm.verts.new((x1, rng.uniform(-0.01, 0.01), 0.01))
    for k in range(4):
        bm.faces.new((base[k], base[(k + 1) % 4], tip))
    for sy in (-1, 1):                 # ear flaps fanning out sideways, slightly drooping
        pa, pb, pc = (x1 - 0.015, 0.0, 0.014), (x1 + 0.04, sy * 0.075, -0.015 + rng.uniform(-0.012, 0.012)), (x1 + 0.06, sy * 0.025, 0.0)
        for dz, flip in ((0.0, False), (-0.004, True)):      # front + back face (thin flap visible from both sides)
            a, b, c = (bm.verts.new((p[0], p[1], p[2] + dz)) for p in (pa, pb, pc))
            bm.faces.new((a, b, c) if (sy > 0) != flip else (a, c, b))
    fold = [bm.verts.new((-L / 2 + 0.012, sy * W * 0.36, sz * H * 0.3)) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    fold2 = [bm.verts.new((-L / 2 - 0.006, sy * W * 0.36, sz * H * 0.3)) for sy, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    bm.faces.new(fold2[::-1])
    for k in range(4):
        bm.faces.new((fold[k], fold[(k + 1) % 4], fold2[(k + 1) % 4], fold2[k]))
    bm.to_mesh(o.data); bm.free()
    V.set_mats(o, ['sandbag'])
    return o

def bag_set():
    """Five bag meshes for variety: standard, long, short/fat, slumped, draped (bent over the top course)."""
    return dict(std=sandbag_mesh('bag_std', seed=1), long=sandbag_mesh('bag_long', L=0.64, H=0.13, slump=0.15, seed=2),
                short=sandbag_mesh('bag_short', L=0.50, W=0.32, H=0.15, slump=0.1, seed=3),
                slump=sandbag_mesh('bag_slump', L=0.58, W=0.33, H=0.12, slump=0.35, seed=4),
                drape=sandbag_mesh('bag_drape', L=0.58, W=0.3, H=0.12, slump=0.25, bend=0.07, seed=5))

def bag_course(bags, path, z, node_='hull', rng=None, lod=2, name='bag', lengths=0.55, top=False, header=False):
    """Lay one course of bags along a polyline path [(x, y)] (bags tangent, or headers across it). Random mesh choice,
    yaw/tilt jitter, slight height scatter; top course: some bags draped / askew."""
    import random
    rng = rng or random.Random(1)
    pts = [Vector((p[0], p[1], 0)) for p in path]
    segs = list(zip(pts[:-1], pts[1:]))
    total = sum((b - a).length for a, b in segs)
    step = 0.33 if header else lengths
    n = max(1, int(total / step))
    out = []
    for i in range(n):
        s = (i + 0.5) * total / n
        for a, b in segs:
            L = (b - a).length
            if s <= L:
                break
            s -= L
        p = a.lerp(b, s / L); d = (b - a).normalized()
        yaw = math.atan2(d.y, d.x) + (math.pi / 2 if header else 0)
        k = rng.random()
        mesh = bags['drape'] if (top and k < 0.25) else bags['slump'] if k < 0.35 else bags['long'] if k < 0.55 else bags['short'] if k < 0.7 else bags['std']
        o = V.instance(mesh, name, (p.x + rng.uniform(-0.03, 0.03), p.y + rng.uniform(-0.03, 0.03), z + rng.uniform(-0.012, 0.01)),
                       node_, rot=(rng.uniform(-0.07, 0.07), rng.uniform(-0.06, 0.06), yaw + rng.uniform(-0.12, 0.12)),
                       key='sandbag', lod=lod, merge=True)
        out.append(o)
    return out

def arc(r, a0, a1, n=24, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

def earth_apron(name, inner, r_in, r_out, h, seed=3, n_a=48, n_r=7, a0=0.0, a1=2 * math.pi, closed=True):
    """Spoil bank around an emplacement: grid in (angle, radius), height falls from h at r_in to 0 at a noisy outer
    radius (irregular, not a circle), lumpy surface; open ends taper to the ground. inner(a) -> radius multiplier."""
    import random
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(64)]
    def nz(a, f=1.0):
        t = (a / (2 * math.pi) * 16 * f) % 16
        i = int(t); u = t - i
        return noise[i % 64] * (1 - u) + noise[(i + 1) % 64] * u
    def fn(u, v):
        a = a0 + (a1 - a0) * u
        ri = r_in * inner(a)
        ro = r_out * (1 + 0.16 * nz(a) + 0.07 * nz(a, 3.1))
        r = ri + (ro - ri) * v
        end = 1.0 if closed else min(1.0, min(u, 1 - u) * 6)
        clod = 0.035 * nz(a * 11 + v * 29) * nz(a * 5.7 + v * 17 + 3.1) * (1 - v) ** 0.7     # rework2: lumpy spoil clods
        zz = h * end * (1 - v) ** 1.6 * (1 + 0.18 * nz(a, 5.3) * (1 - v)) + 0.02 * nz(a * 7 + v * 13) * (1 - v) + clod
        f = min(1.0, max(0.0, (v - 0.55) / 0.45)); sink = 0.02 * f * f * (3 - 2 * f)   # edge fades out via COLOR_0 alpha
        return (r * math.cos(a), r * math.sin(a), max(0.0, zz) - sink)   # outer rim sinks below grade: no hard edge
    return B.grid_surface(name, fn, n_a, n_r)
