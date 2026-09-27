# Luftwaffe airfield props (1940-43): fuel bowser trailer, bomb trolley with SC 250, wheel chocks, windsock, starter
# (battery) cart. blender -b --factory-startup --python props.py -- <asset>[:variants] ... | all
#   fuel_bowser  : 2-axle Kesselanhaenger for aviation fuel (B4, yellow '87' triangle), 4.6 m tank body, turntable
#                  front axle + drawbar, pump cabinet, hose reel, filler domes, catwalk + rail; ~5.8 x 2.0 x 2.3 m
#                  (the pushable B6 fuel tank). Burnt = ruptured, charred.
#   bomb_trolley : low 4-wheel bomb carrier (steerable front axle, T-handle drawbar) with cradle + SC 250.
#   chocks       : pair of hardwood wheel chocks joined by a rope.
#   windsock     : 6 m mast, guy wires, slewing ring, red/white 5-band sock as 4 chained bendable segments.
#   starter_cart : 2-wheel 24 V battery starter cart (Anlasswagen) with cable coil and plug, towing handle.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ac as AC
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

GREY, DAK = (58, 60, 59), (160, 132, 88)
SCHEME = {'grey': {'top': ('solid', GREY), 'side': ('solid', GREY), 'bottom': ('solid', GREY)},
          'dak': {'top': ('solid', DAK), 'side': ('solid', DAK), 'bottom': ('solid', DAK)}}
SCHEME['winter'] = SCHEME['grey']
VARS = {'fuel_bowser': ['grey', 'dak', 'winter', 'burnt'], 'bomb_trolley': ['grey', 'dak', 'winter', 'burnt'],
        'chocks': ['grey', 'winter'], 'windsock': ['grey', 'dak', 'winter'], 'starter_cart': ['grey', 'dak', 'winter', 'burnt']}


HOLE = V((0.95, 0.4, 1.70))                           # blow-out centre on the +x (left) upper flank
RIM = []                                              # torn-edge points (filled while building the burnt tank)


def heat_rgb(p, nrm, inner=False):
    """Heat-scaled steel of a burnt-out fuel tank (sRGB): ash-grey / rust-orange / bluish temper colours, a narrow
    soot band around the blow-out rim; the inside is scaled dark rust-brown with pale ash on the floor, so the hole
    reads as an opening (not black on black)."""
    p = V(p)
    n1, n2 = VH._n(p, 1.3), VH._n(p + V((5, 1, 2)), 3.1)
    dr = min(((p - q).length for q in RIM), default=9.0)
    if dr < 0.05:                                         # torn lip: bright bare / oxidised steel, reads against the hole
        return (178, 156, 126) if n1 > 0.45 else (164, 110, 66)
    if inner:
        c = V((78, 50, 34)).lerp(V((40, 30, 24)), max(0.0, min(1.0, n2)))
        return tuple(c.lerp(V((128, 122, 112)), max(0.0, min(1.0, (1.25 - p.z) / 0.3))))   # ash lying on the floor
    e = math.sqrt(((p.y - HOLE.y) / 0.95) ** 2 + ((p.z - 1.62) / 0.5) ** 2) if p.x > 0.2 else 9.0
    col = V((122, 116, 108))                              # ash grey (paint burnt off, oxide scale)
    col = col.lerp(V((156, 82, 40)), max(0.0, min(1.0, (n1 - 0.5) * 2.5)))            # rust-orange scale
    col = col.lerp(V((78, 84, 108)), max(0.0, min(0.85, 1.0 - abs(e - 1.75) / 0.4)) * (0.5 + n2))   # blue temper ring
    col = col.lerp(V((30, 27, 25)), max(0.0, min(1.0, 1.0 - (dr - 0.05) / 0.25)))      # narrow soot band at the rim
    if nrm.z > 0.5:                                       # soot / ash streaks on the roof
        col = col.lerp(V((52, 48, 44)), max(0.0, min(0.6, (n2 - 0.45) * 2.0)))
    return tuple(col)


def heat_part(bm, name, fn=heat_rgb):
    """Burnt steel part: pale veh_paint base (matte, see vfin matfix) + heat-scale COLOR_0 per loop."""
    ob = VH.C.part(bm, 'veh_paint', name, uv='aligned', grime=0, smooth=False, bisect=False)
    mean = VH.C.MATS['veh_paint']['mean']
    me = ob.data
    b2 = bmesh.new()
    b2.from_mesh(me)
    col = b2.loops.layers.color.get('Col') or b2.loops.layers.color.new('Col')
    for f in b2.faces:
        c = f.calc_center_median()
        inner = f.normal.dot(c - V((0, 0.1, 1.40))) < 0 and name == 'tank'
        for l in f.loops:
            rgb = fn(l.vert.co, f.normal, inner)
            l[col] = tuple(min(1.0, rgb[i] / 255.0 / mean[i]) for i in range(3)) + (1.0,)   # as AC.recolor
    b2.to_mesh(me)
    b2.free()
    return ob


def fuel_bowser(burnt):
    L, TW, TH, ZC = 4.6, 1.90, 1.30, 1.40            # tank length, width, height, centre height
    y0, y1 = -2.2, 2.4
    bm = bmesh.new()
    mid = [y0 + 0.12 + (y1 - y0 - 0.24) * k / 22 for k in range(23)] if burnt else [y0 + 0.12, y1 - 0.12]
    AC.fus_bm(bm, [(y0, ZC, TW * 0.92, TH * 0.92, 2.6)] + [(y, ZC, TW, TH, 2.6) for y in mid] +
              [(y1, ZC, TW * 0.92, TH * 0.92, 2.6)], segs=40 if burnt else 24)   # burnt: dense shell (buckles, ragged hole)
    if burnt:
        # burst tank: the +x upper flank is blown out, the rest of the shell stays (heat-buckled, roof sagging a little
        # beside the hole) and carries the catwalk / filler domes; solidified so the charred inside shows through the hole
        from mathutils import noise
        def hole_e(c):                                # ragged elliptic blow-out outline
            return math.sqrt(((c.y - HOLE.y) / 0.95) ** 2 + ((c.z - 1.62) / 0.5) ** 2) + (noise.noise(c * 3.0) * 0.35)
        hole = [f for f in bm.faces if f.calc_center_median().x > 0.35 and hole_e(f.calc_center_median()) < 1.0]
        bmesh.ops.delete(bm, geom=hole, context='FACES')
        import random
        rj = random.Random(4)
        RIM.clear()
        for v in [v for v in bm.verts if v.is_boundary and y0 + 0.2 < v.co.y < y1 - 0.2]:
            r = V((v.co.x, 0, v.co.z - ZC)).normalized()   # torn edges curl outward, jagged
            v.co += r * rj.uniform(0.03, 0.16) + V((0, rj.uniform(-0.04, 0.04), rj.uniform(-0.05, 0.02)))
            RIM.append(V(v.co))
        for v in bm.verts:
            if y0 + 0.15 < v.co.y < y1 - 0.15:
                r = V((v.co.x, 0, v.co.z - ZC))
                # heat buckling (rework 2: reads in the silhouette): dents / bulges, roof sagging beside the hole,
                # a slumped belly between the saddles
                k = noise.noise(v.co * 1.7) * 0.085 + noise.noise(v.co * 4.0) * 0.025
                dh = (V(v.co) - HOLE).length
                if v.co.z > ZC + 0.2:
                    k -= 0.16 * max(0.0, 1.0 - dh / 1.6)
                v.co += r.normalized() * k
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=-0.015)
    if burnt:
        heat_part(bm, 'tank')
    else:
        AC.skin(bm, 'tank', 'veh_paint', uv='aligned', recalc=not burnt)
    if burnt:
        # curled-out petals along the rim of the hole (kept within ~0.12 m of the flank)
        xr = TW / 2 - 0.02
        for (pa, pb, pc, pd) in (
                ((xr, -0.4, ZC - 0.3), (xr, 0.35, ZC - 0.3), (xr + 0.10, 0.30, ZC - 0.52), (xr + 0.09, -0.35, ZC - 0.5)),
                ((xr, 0.45, ZC - 0.3), (xr, 1.2, ZC - 0.3), (xr + 0.12, 1.1, ZC - 0.48), (xr + 0.08, 0.5, ZC - 0.46)),
                ((xr, -0.5, ZC - 0.25), (xr - 0.02, -0.5, ZC + 0.35), (xr + 0.10, -0.68, ZC + 0.25), (xr + 0.11, -0.66, ZC - 0.15)),
                ((xr, 1.3, ZC - 0.25), (xr - 0.02, 1.3, ZC + 0.35), (xr + 0.09, 1.48, ZC + 0.2), (xr + 0.12, 1.47, ZC - 0.1))):
            bmp = bmesh.new()
            VH.C.quad(bmp, [V(pa), V(pb), V(pc), V(pd)])
            bmesh.ops.solidify(bmp, geom=bmp.faces[:], thickness=0.012)
            # torn petal lips: bright bare / oxidised steel so the rim of the hole reads against the black interior
            heat_part(bmp, 'petal', lambda p, n, i: (172, 150, 124) if V(p).x > xr + 0.05 else (150, 96, 58))
        VH.emitter('fire', (0.6, 0.4, ZC + 0.5), (0, 0, 1), when='destroyed', kind2='fuel_fire_large')
    zt = ZC + TH / 2 - (0.10 if burnt else 0.0)       # burnt: roof sagged
    for y in (-1.2, 0.2, 1.5):                        # filler domes + lids (hatch nodes)
        P('paint', cyl, (0, y, zt - 0.05), (0, y, zt + 0.12), 0.26, 16, name='dome')
        node = 'hatch_%d' % (1 + int((y + 1.2) / 1.3 + 0.1))
        piv = AC.hinge(node, (-0.24, y + 0.22, zt + 0.14), (0.24, y + 0.22, zt + 0.14), 'hatch', (0, 110))
        P('heat_steel' if burnt else 'paint', cyl, (0, y, zt + 0.12), (0, y, zt + 0.16), 0.24, 16, name='lid', node=node, pivot=piv)
        if burnt:                                     # charred, scorched rim; the middle lid was blown open
            P('soot', cyl, (0, y, zt + 0.155), (0, y, zt + 0.165), 0.17, 12, name='lid_char', node=node, pivot=piv)
            if node == 'hatch_2':
                VH.rotate_node(node, -75, (1, 0, 0))
    import random
    rng = random.Random(87)
    for sx in (-1, 1):                                # catwalk rails (burnt: heat-warped, sagging, scorched)
        if not burnt:
            P('metal', cyl, (sx * 0.45, -1.8, zt + 0.45), (sx * 0.45, 2.0, zt + 0.45), 0.018, 6, name='rail')
        else:
            pts = []
            for k in range(9):
                y = -1.8 + 3.8 * k / 8
                near = max(0.0, 1.0 - abs(y - HOLE.y) / 1.4) if sx > 0 else 0.3 * max(0.0, 1.0 - abs(y - HOLE.y) / 1.6)
                pts.append(V((sx * (0.45 + 0.28 * near) + rng.uniform(-0.03, 0.03), y,
                              zt + 0.45 - 0.30 * near - 0.06 * math.sin(k * 1.3) + rng.uniform(-0.02, 0.02))))
            for a, b in zip(pts[:-1], pts[1:]):
                P('heat_steel', cyl, a, b, 0.018, 6, name='rail')
        for y in (-1.8, -0.5, 0.8, 2.0):
            lean = V((sx * 0.22, rng.uniform(-0.1, 0.1), -0.12)) if burnt and abs(y - HOLE.y) < 1.4 and sx > 0 else \
                V((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0)) if burnt else V((0, 0, 0))
            P('heat_steel' if burnt else 'metal', cyl, (sx * 0.45, y, zt - 0.02), V((sx * 0.45, y, zt + 0.45)) + lean, 0.015, 6,
              name='stanchion')
    P('metal', box, (0, 0.1, zt + 0.01), (0.5, 3.8, 0.03), name='catwalk')
    for k in range(7):                                # rear ladder
        P('metal', box, (0, y1 + 0.28, 0.55 + k * 0.22), (0.45, 0.03, 0.03), name='ladder_rung')
    for sx in (-1, 1):
        P('metal', box, (sx * 0.24, y1 + 0.28, 1.2), (0.04, 0.04, 1.5), name='ladder_side')
    # chassis: frame rails, rear axle on leaf springs, front turntable axle + drawbar (steer node)
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.55, 0.2, 0.62), (0.1, 5.0, 0.16), name='frame_rail')
        for y in (-1.5, 0.0, 1.5):
            P('paint_under', box, (sx * 0.6, y, ZC - TH / 2 + 0.02), (0.22, 0.12, 0.28), name='saddle')
    P('paint_under', box, (0, 1.75, 0.46), (1.4, 0.1, 0.1), name='rear_axle')
    tt = V((0, -1.75, 0.62))
    P('paint_under', cyl, tt, tt + V((0, 0, 0.08)), 0.5, 18, name='turntable', node='steer_front', pivot=tuple(tt))
    P('paint_under', box, (0, -1.75, 0.46), (1.4, 0.1, 0.1), name='front_axle', node='steer_front', pivot=tuple(tt))
    P('paint_under', beam, (0, -2.1, 0.5), (0, -3.5, 0.52), 0.07, 0.07, name='drawbar', node='steer_front', pivot=tuple(tt))
    P('metal', VH.ring_torus, (0, -3.58, 0.52), 0.07, 0.015, (0, 0, 1), 10, 4, name='tow_eye', node='steer_front', pivot=tuple(tt))
    VH.moving('steer_front', 'steer', tt, (0, 0, 1), (-60, 60), note='turntable front axle; drawbar steers')
    # group convention (as the aircraft): model front = +Z (Blender -Y), +x = LEFT -> wheel_fl / wheel_rl at +x
    for node, x, y in (('wheel_fl', 0.82, -1.75), ('wheel_fr', -0.82, -1.75), ('wheel_rl', 0.82, 1.75), ('wheel_rr', -0.82, 1.75)):
        VH.wheel(node, (x, y, 0.45), 0.45, 0.2, 0.27, 1 if x > 0 else -1, lug=0.012, steer='steer_front' if y < 0 else None)
        if y < 0:
            AC.PARENTS[node] = 'steer_front'
    for sx in (-1, 1):
        P('paint', box, (sx * 0.82, 1.75, 0.98), (0.3, 1.0, 0.03), name='mudguard')
    # pump cabinet at the rear + hose reel + yellow '87' aviation-fuel triangle
    P('paint', VH.bevel_box, (0.72, 2.15, 0.85), (0.5, 0.55, 0.6), 0.03, 1, name='pump_cabinet')
    reel = V((-0.62, 2.2, 0.95))
    P('black', cyl, reel - V((0.25, 0, 0)), reel + V((0.25, 0, 0)), 0.30, 16, name='hose_reel')
    for sx in (-1, 1):
        P('metal', cyl, reel + V((sx * 0.27, 0, 0)), reel + V((sx * 0.29, 0, 0)), 0.34, 16, name='reel_flange')
    P('black', beam, reel + V((0.1, 0.25, -0.2)), (0.4, 3.0, 0.03), 0.06, 0.06, name='hose_run')
    P('metal', cyl, (0.4, 3.0, 0.05), (0.45, 3.3, 0.05), 0.04, 8, name='nozzle')
    VH.socket('hose_nozzle', (0.45, 3.3, 0.05), (0, 1, 0), kind='interaction', role='refuel')
    if not burnt:
        for sx in (-1, 1):
            AC.letters(VH.C.A.parts[:1], '87', (sx * TW / 2, 1.3, ZC + 0.02), (sx, 0, 0), 0.26, up=(0, 0, 1), kind='black', stroke=0.18)
            bm = bmesh.new()
            c = V((sx * (TW / 2 + 0.006), 1.3, ZC + 0.1))
            vs = [bm.verts.new(c + V((0, -0.34 * sx, -0.25))), bm.verts.new(c + V((0, 0.34 * sx, -0.25))), bm.verts.new(c + V((0, 0, 0.34)))]
            bm.faces.new(vs)
            VH.vp(bm, 'yellow', 'fuel_triangle', lod='drop')
        AC.letters(VH.C.A.parts[:1], 'B4', (0, y1 + 0.02, ZC + 0.25), (0, 1, 0), 0.3, up=(0, 0, 1), kind='white')
    VH.socket('push_rear', (0, 3.2, 0.0), (0, -1, 0), pose='push', role='pusher')
    VH.socket('push_front', (0, -3.9, 0.0), (0, 1, 0), pose='tow', role='pusher')
    VH.emitter('fuel_leak', (0, 0.0, ZC - TH / 2), (0, 0, -1), when='damaged')
    VH.emitter('explosion', (0, 0.1, ZC), (0, 0, 1), when='destroyed', radius=6.0, kind2='fuel_tank')
    if burnt:                                         # tyres burnt away: the wreck settles onto its rims (hub 0.45 -> 0.29)
        AC.transform_all(Matrix.Translation((0, 0, -0.16)))
        for o in VH.C.A.parts:                        # hose / nozzle / drawbar eye lying on the ground: no sinking in
            if not o.get('kit_node', 'main').startswith('wheel'):
                for v in o.data.vertices:
                    if v.co.z < 0.0:
                        v.co.z = 0.0
        for d in VH.VM['contacts']:
            d['pos'][1] = 0.0
        for d in VH.VM['sockets']:
            if d.get('role') in ('pusher', 'refuel'):
                d['pos'][1] = max(0.0, d['pos'][1])
    return {'length': 5.8, 'width': 2.0, 'height': 2.3, 'tank_l': L, 'capacity_l': 5000, 'side_convention': '+x = left'}


def bomb_trolley(burnt):
    # low tubular frame on 4 small solid-tyred wheels; steerable front axle with T-handle drawbar; two cradle arms
    for sx in (-1, 1):
        P('paint', box, (sx * 0.38, 0.1, 0.36), (0.07, 2.0, 0.08), name='frame_rail')
    for y in (-0.8, 0.1, 1.0):
        P('paint', box, (0, y, 0.36), (0.83, 0.07, 0.07), name='cross_member')
    for y in (-0.35, 0.55):                           # cradles (curved: two angled plates each)
        for sx in (-1, 1):
            P('paint', beam, (sx * 0.34, y, 0.40), (sx * 0.10, y, 0.30 + 0.12), 0.06, 0.12, name='cradle_arm')
        P('leather', box, (0, y, 0.43), (0.24, 0.1, 0.03), name='cradle_pad')
    pv = V((0, -0.9, 0.36))
    P('paint', box, (0, -0.9, 0.3), (0.9, 0.08, 0.08), name='front_axle', node='steer_front', pivot=tuple(pv))
    P('paint', beam, (0, -0.95, 0.32), (0, -1.9, 0.72), 0.05, 0.05, name='drawbar', node='steer_front', pivot=tuple(pv))
    P('paint', cyl, (-0.25, -1.92, 0.73), (0.25, -1.92, 0.73), 0.025, 8, name='t_handle', node='steer_front', pivot=tuple(pv))
    VH.moving('steer_front', 'steer', pv, (0, 0, 1), (-70, 70))
    for node, x, y in (('wheel_fl', -0.5, -0.9), ('wheel_fr', 0.5, -0.9), ('wheel_rl', -0.5, 1.0), ('wheel_rr', 0.5, 1.0)):
        VH.wheel(node, (x, y, 0.2), 0.2, 0.1, 0.12, 1 if x > 0 else -1, lug=0.0)
        if y < 0:
            AC.PARENTS[node] = 'steer_front'
    if not burnt:
        AC.bomb('bomb', (0, 0.1, 0.58), 1.64, 0.184, name='sc250')
        VH.VM['toggles']['bomb'] = 'SC 250 load (hide when empty)'
        VH.emitter('explosion', (0, 0.1, 0.6), (0, 0, 1), when='destroyed', radius=8.0, kind2='bomb_sc250')
    else:
        VH.emitter('smoke', (0, 0.1, 0.4), (0, 0, 1), kind2='wreck_smoulder')
    VH.socket('push_handle', (0, -2.1, 0.0), (0, 1, 0), pose='tow', role='pusher')
    return {'length': 2.9, 'width': 1.1, 'height': 0.95}


def chocks(burnt):
    for sx in (-1, 1):
        bm = bmesh.new()
        VH.side_prism(bm, [(-0.25, 0.0), (0.25, 0.0), (0.25, 0.05), (-0.05, 0.22), (-0.25, 0.22)], sx * 0.45 - 0.11, sx * 0.45 + 0.11)
        VH.vp(bm, 'wood', 'chock', smooth=False, grime=1.0)
        P('rope', VH.ring_torus, (sx * 0.45, -0.25, 0.12), 0.05, 0.012, (0, 1, 0), 8, 4, name='rope_eye')
    P('rope', beam, (-0.45, -0.28, 0.08), (0.0, -0.36, 0.015), 0.02, 0.02, name='rope')
    P('rope', beam, (0.0, -0.36, 0.015), (0.45, -0.28, 0.08), 0.02, 0.02, name='rope')
    VH.socket('grab', (0, -0.4, 0.0), (0, 1, 0), pose='crouch', role='ground_crew')
    return {'length': 0.5, 'width': 1.12, 'height': 0.22}


def windsock(burnt):
    VH.P('paint_under', box, (0, 0, 0.1), (0.8, 0.8, 0.2), name='footing')
    P('paint', cyl, (0, 0, 0.2), (0, 0, 6.0), 0.07, 10, name='mast')
    P('paint', cyl, (0, 0, 0.2), (0, 0, 1.2), 0.1, 10, name='mast_base')
    for k in range(3):                                # guy wires + ground anchors
        a = math.radians(90 + 120 * k)
        g = V((math.cos(a) * 3.0, math.sin(a) * 3.0, 0.05))
        P('black', beam, (0, 0, 4.2), g, 0.01, 0.01, name='guy_wire', lod='drop')
        P('metal', box, g, (0.15, 0.15, 0.1), name='anchor')
    top = V((0, 0, 6.0))
    node = 'sock_yaw'
    P('metal', cyl, top - V((0, 0, 0.05)), top + V((0, 0, 0.1)), 0.09, 10, name='slew_ring', node=node, pivot=tuple(top))
    P('metal', beam, top + V((0, 0, 0.05)), top + V((0, -0.35, 0.05)), 0.03, 0.03, name='sock_arm', node=node, pivot=tuple(top))
    throat = top + V((0, -0.35, -0.05))
    P('metal', VH.ring_torus, throat, 0.45, 0.015, (0, 1, 0), 18, 4, name='throat_ring', node=node, pivot=tuple(throat))
    VH.moving(node, 'windsock_yaw', top, (0, 0, 1), None, note='turn so the sock trails downwind (+Y local = downwind)')
    # sock: 4 segments (chained nodes), 5 alternating bands, hanging limp in a light breeze
    L, n = 3.6, 4
    prev = node
    for k in range(n):
        f0, f1 = k / n, (k + 1) / n
        r0, r1 = 0.45 - 0.3 * f0, 0.45 - 0.3 * f1
        p0 = throat + V((0, -L * f0, 0))
        p1 = throat + V((0, -L * f1, 0))
        seg = 'sock_seg%d' % (k + 1)
        for b in range(5):                          # band colour alternates along the whole sock
            g0, g1 = f0 + (f1 - f0) * b / 5, f0 + (f1 - f0) * (b + 1) / 5
            q0, q1 = throat + V((0, -L * g0, 0)), throat + V((0, -L * g1, 0))
            band = int(g0 * 5 + 1e-6) % 2
            bm = bmesh.new()
            VH.C.cyl_bm(bm, q0, q1, 0.45 - 0.3 * g0, 16, r1=0.45 - 0.3 * g1, caps=False)
            VH.vp(bm, 'red' if band == 0 else 'white', seg + '_cloth', node=seg, pivot=tuple(p0), smooth=True, grime=0.4)
        AC.FRAMES[seg] = AC.frame_for((1, 0, 0))
        AC.PARENTS[seg] = prev
        VH.moving(seg, 'sock_bend', p0, (1, 0, 0), (-80, 5), parent=prev, note='droop: rotate down when the wind drops')
        prev = seg
    VH.emitter('wind_ref', tuple(top), (0, -1, 0), note='sock points downwind along its local -Y (model front)')
    return {'mast_h': 6.0, 'sock_l': 3.6, 'throat_d': 0.9}


def starter_cart(burnt):
    P('paint', VH.bevel_box, (0, 0, 0.72), (0.9, 1.3, 0.62), 0.03, 1, name='battery_box')
    piv = AC.hinge('lid', (-0.45, 0.65, 1.04), (0.45, 0.65, 1.04), 'hatch', (0, 100))
    P('paint', box, (0, 0, 1.05), (0.94, 1.34, 0.04), name='lid', node='lid', pivot=piv)
    for sx in (-1, 1):
        P('metal', box, (sx * 0.47, -0.2, 0.9), (0.02, 0.2, 0.05), name='handle_grip')
    P('paint_under', box, (0, 0, 0.38), (0.8, 1.2, 0.06), name='chassis')
    P('paint_under', cyl, (-0.62, 0.15, 0.3), (0.62, 0.15, 0.3), 0.03, 8, name='axle')
    for node, x in (('wheel_l', 0.6), ('wheel_r', -0.6)):
        VH.wheel(node, (x, 0.15, 0.3), 0.3, 0.12, 0.18, 1 if x > 0 else -1, lug=0.01)
        P('paint', box, (x, 0.15, 0.64), (0.18, 0.7, 0.03), name='mudguard')
    P('paint_under', cyl, (0, -0.65, 0.4), (0, -0.65, 0.1), 0.03, 8, name='prop_stand')
    pv = V((0, -0.62, 0.45))
    P('paint', beam, pv, (0, -1.7, 0.85), 0.04, 0.04, name='tow_handle', node='tow_handle', pivot=tuple(pv))
    P('paint', cyl, (-0.2, -1.72, 0.86), (0.2, -1.72, 0.86), 0.02, 8, name='tow_grip', node='tow_handle', pivot=tuple(pv))
    AC.FRAMES['tow_handle'] = AC.frame_for((1, 0, 0))
    VH.moving('tow_handle', 'hatch', pv, (1, 0, 0), (-40, 60))
    P('black', VH.ring_torus, (0.3, 0.72, 0.62), 0.2, 0.025, (0, 1, 0), 16, 5, name='cable_coil')
    P('black', VH.ring_torus, (0.3, 0.74, 0.62), 0.16, 0.025, (0, 1, 0), 16, 5, name='cable_coil')
    P('black', beam, (0.3, 0.75, 0.42), (0.6, 1.4, 0.03), 0.03, 0.03, name='cable')
    P('metal', cyl, (0.6, 1.4, 0.04), (0.62, 1.55, 0.04), 0.045, 8, name='plug')
    P('black', box, (-0.2, -0.66, 0.78), (0.3, 0.02, 0.18), name='switch_panel')
    P('white', box, (-0.2, -0.672, 0.82), (0.08, 0.01, 0.06), name='gauge')
    VH.socket('plug', (0.62, 1.55, 0.04), (0, 1, 0), kind='interaction', role='aircraft_start')
    VH.socket('tow', (0, -1.9, 0.0), (0, 1, 0), pose='tow', role='pusher')
    if burnt:
        VH.emitter('smoke', (0, 0, 1.0), (0, 0, 1), kind2='wreck_smoulder')
    return {'length': 1.8, 'width': 1.3, 'height': 1.1}


def main(asset, var, out_root):
    AC.setup(asset, var, SCHEME, seed=hash(asset) % 1000)
    dims = globals()[asset](var == 'burnt')
    AC.vfin(os.path.join(out_root, asset), 'airfield_prop', dims, variants=VARS[asset],
            extra={'real_name': asset.replace('_', ' '), 'destroyed': var == 'burnt', 'rotation_order': 'YXZ', 'side': 'axis'},
            lods=((0.6, 0.04), (0.3, 0.12)),
            matfix={'veh_paint': {'rough': 0.92, 'metal': 0.1, 'spec': 0.5}} if (var == 'burnt' and asset == 'fuel_bowser') else None)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    jobs = argv or ['all']
    if jobs == ['all']:
        jobs = list(VARS)
    for j in jobs:
        a, _, vs = j.partition(':')
        for v in (VARS[a] if vs in ('', 'all') else vs.split(',')):
            main(a, v, os.path.join(VH.SCR, '..', 'out'))
