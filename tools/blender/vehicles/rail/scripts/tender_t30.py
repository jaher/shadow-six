# DR 2'2' T30 "Wannentender" (tub tender) for the BR 52 Kriegslok: self-supporting trough tank (30 m3 water),
# coal bunker (10 t) on the front half, two 2-axle bogies. blender -b ... --python tender_t30.py -- dr|winter|burnt|all
# Dims: LuP 9.875 m (loco+tender 22.975), width 3.0 m, height 3.95 m (bunker), bogie wheelbase 1.8 m, wheels 1.0 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['dr', 'winter', 'burnt']
YF, YB = -3.75, 3.7            # tub front / rear (before the dished rear end)
HW, ZT0, ZT1 = 1.5, 1.15, 3.3  # tub half width, bottom, top


def pal():
    return dict(R.DR, wheel=R.DR['red'], frame=R.DR['red'], body=(27, 26, 25), buffer=R.DR['black'], white=(200, 196, 186),
                plate=(24, 23, 22))


ZC = 2.3                        # tub section centre height (widest point)


def zbot(y):
    """Tub bottom: sags down between the bogies (the 'Wanne'), clears the bogie bolsters over them."""
    d = abs(y - 0.05)
    t = min(1.0, max(0.0, (d - 0.55) / 0.9))
    return 0.82 + (1.32 - 0.82) * (t * t * (3 - 2 * t))


def tub_ring(y, k=1.0, n=24):
    """Trough section: superellipse (exp 2.6) - rounded shoulders to a narrow flat top, bulging sides, deep round
    bottom; k < 1 shrinks it toward the section centre for the dished rear end."""
    ring = []
    hw = HW * k
    hu = (ZT1 + 0.12 - ZC) * k
    hl = (ZC - zbot(y)) * k
    top = ZC + (ZT1 - ZC) * k
    e = 2.0 / 2.6
    for i in range(n):
        a = 2 * math.pi * i / n
        c, sn = math.cos(a), math.sin(a)
        x = hw * math.copysign(abs(c) ** e, c)
        z = ZC + (hu if sn > 0 else hl) * math.copysign(abs(sn) ** e, sn)
        ring.append(V((x, y, min(z, top))))
    return ring


def tub(burnt):
    rings = []
    ys = [YF, -2.9, -2.0, -1.2, -0.4, 0.4, 1.2, 2.0, 2.9, YB, YB + 0.25, YB + 0.45, YB + 0.55]
    ks = [1] * 10 + [0.93, 0.78, 0.55]
    for y, k in zip(ys, ks):
        rings.append(tub_ring(y, k))
    bm = bmesh.new()
    C.loft_bm(bm, rings, True, True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if burnt:                                                # split, bulged tank wall on the left (+X)
        dead = [f for f in bm.faces if f.calc_center_median().x > 0.9 and abs(f.calc_center_median().y - 1.2) < 0.8 and 1.9 < f.calc_center_median().z < 3.0]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        for v in bm.verts:
            if v.co.x > 0.8 and abs(v.co.y - 1.2) < 1.4:
                v.co.x += 0.1 * (1 - abs(v.co.y - 1.2) / 1.4)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    rp_(bm, 'body', 'tub', smooth=True)
    # welded construction: circumferential seams + a longitudinal seam along the bulge, stiffening ribs
    for y in (-2.45, -0.8, 0.8, 2.45):
        bm = bmesh.new()
        r = tub_ring(y, 1.0, 20)
        pts = [p * 1.0 for p in r]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            if min(a.z, b.z) < ZT1 - 0.02:
                C.cyl_bm(bm, a + (a - V((0, y, ZC))).normalized() * 0.005, b + (b - V((0, y, ZC))).normalized() * 0.005, 0.011, 4, caps=False)
        rp_(bm, 'body', 'weld_seam', lod='drop', bisect=False)
    for s in (-1, 1):
        RP('body', cyl, (s * (HW + 0.004), YF + 0.1, ZC + 0.05), (s * (HW + 0.004), YB, ZC + 0.05), 0.012, 4, caps=False, name='weld_seam_long', lod='drop', bisect=False)
    # (no external ribs: the real welded tub is smooth - only the fine weld seams above read)
    # lettering panel (DR / number / weights) + data panel, both sides
    for s in (-1, 1):
        if not burnt:
            R.label_block((s * (HW + 0.02), 1.6 + 0.9, 2.45), (s, 0, 0), 1.3, 0.42, 3)
            R.label_block((s * (HW + 0.02), -0.2, 2.0), (s, 0, 0), 0.7, 0.3, 3)
            RP('plate', box, (s * (HW - 0.02), 2.5, 1.85), (0.03, 0.7, 0.2), name='data_panel', lod='drop')
    # top: walkway plates, water filler with hatch, tool boxes at the rear
    RP('body', box, (0, 2.3, ZT1 + 0.01), (1.7, 2.6, 0.03), name='tub_top_plate')
    fz = ZT1
    RP('body', cyl, (0, 2.6, fz), (0, 2.6, fz + 0.3), 0.33, 14, name='water_filler', bisect=False)
    RP('body', cyl, (0, 2.6, fz + 0.3), (0, 2.6, fz + 0.36), 0.36, 14, name='filler_lid', node='filler_hatch', pivot=(0, 2.24, fz + 0.33), bisect=False)
    RP('dark', box, (0, 2.95, fz + 0.4), (0.12, 0.08, 0.06), name='filler_handle', node='filler_hatch', pivot=(0, 2.24, fz + 0.33), bisect=False, lod='drop')
    RP('dark', cyl, (-0.1, 2.24, fz + 0.33), (0.1, 2.24, fz + 0.33), 0.04, 6, name='filler_hinge', bisect=False, lod='drop')
    VH.moving('filler_hatch', 'hatch', (0, 2.24, fz + 0.33), (1, 0, 0), limits=(0, 100))
    for s in (-1, 1):                                        # tool boxes: lid (bevelled, overhanging), hasp, hinges
        bx = V((s * 0.55, 3.35, fz + 0.02))
        RP('body', VH.bevel_box, tuple(bx + V((0, 0, 0.2))), (0.6, 0.5, 0.4), r=0.02, name='tool_box')
        RP('body', VH.bevel_box, tuple(bx + V((0, 0, 0.43))), (0.66, 0.56, 0.06), r=0.02, name='tool_box_lid')
        RP('dark', box, tuple(bx + V((0, -0.285, 0.33))), (0.08, 0.02, 0.12), name='tool_box_hasp', lod='drop')
        for dx in (-0.2, 0.2):
            RP('dark', box, tuple(bx + V((dx, 0.285, 0.42))), (0.08, 0.02, 0.06), name='tool_box_hinge', lod='drop')
    for s in (-1, 1):                                        # tank-top grab rails
        R.handrail([(s * 0.85, 1.2, fz + 0.02), (s * 0.85, 1.2, fz + 0.25), (s * 0.85, 3.6, fz + 0.25), (s * 0.85, 3.6, fz + 0.02)], r=0.015)
    VH.socket('tender_top', (0, 2.2, fz + 0.02), (0, -1, 0), pose='kneel', note='water filler (taking water)')


def bunker(burnt):
    y0, y1, zt = YF + 0.05, 0.7, 3.95
    for s in (-1, 1):
        bm = bmesh.new()
        prof = [(y0, ZT1 - 0.2), (y1, ZT1 - 0.2), (y1, ZT1 + 0.2), (y1 - 0.4, zt), (y0 + 0.5, zt), (y0, zt - 0.2)]
        VH.side_prism(bm, prof, s * 1.3, s * 1.34)
        rp_(bm, 'body', 'bunker_side')
        RP('body', box, (s * 1.32, (y0 + y1) / 2, zt), (0.08, y1 - y0 - 0.6, 0.06), name='bunker_rim')
    RP('body', box, (0, y1, ZT1 + 0.3), (2.64, 0.05, 0.6), name='bunker_back')
    # loco-facing end: bulkhead with the coal-shovelling opening at footplate level (coal slope visible inside), a
    # vertical SLIDING shovel door on guides (node coal_door, half raised), water valve handwheels, tool lockers
    zo0, zo1, xo = 1.7, 2.45, 0.4
    yb = y0 - 0.02
    for s in (-1, 1):
        RP('body', box, (s * (xo + (HW - xo) / 2), yb, (1.7 + zt) / 2), (HW - xo, 0.05, zt - 1.7), name='bulkhead')
    RP('body', box, (0, yb, (zo1 + zt) / 2), (2 * xo + 0.02, 0.05, zt - zo1), name='bulkhead')
    RP('dark', box, (0, yb - 0.03, zo1 + 0.03), (2 * xo + 0.16, 0.05, 0.06), name='opening_lintel', lod='drop')
    bm = bmesh.new()                                          # coal slope inside the opening (runs up into the heap)
    vs = [bm.verts.new(V(p)) for p in ((-xo, yb + 0.03, zo0 + 0.02), (xo, yb + 0.03, zo0 + 0.02), (xo, yb + 1.1, zt - 0.4), (-xo, yb + 1.1, zt - 0.4))]
    bm.faces.new(vs)
    rp_(bm, 'coal', 'coal_slope', bisect=False)
    for s in (-1, 1):
        RP('dark', box, (s * (xo + 0.05), yb - 0.05, (zo0 + zo1 + 0.5) / 2), (0.06, 0.06, zo1 - zo0 + 0.5), name='door_guide', bisect=False)
    dkw = dict(node='coal_door', pivot=(0, yb - 0.09, zo1 + 0.1))
    RP('dark', box, (0, yb - 0.09, zo1 - 0.12 + 0.1), (2 * xo + 0.06, 0.03, 0.44), name='coal_door', **dkw)
    RP('dark', box, (0, yb - 0.12, zo1 - 0.3 + 0.1), (0.3, 0.04, 0.04), name='coal_door_handle', lod='drop', **dkw)
    VH.moving('coal_door', 'slide', (0, yb - 0.09, zo1 + 0.1), (0, 0, 1), travel_m=[-0.5, 0.2],
              note='vertical sliding shovel door: shown half raised; translate along local Y(glTF up) -0.5 = closed, +0.2 = fully open')
    RP('planks', box, (0, YF - 0.25, 1.66), (2.6, 0.5, 0.04), name='tender_floor')
    RP('dark', cyl, (0.82, YF - 0.2, 1.66), (0.82, YF - 0.2, 2.6), 0.03, 6, name='tender_brake_column')
    RP('dark', VH.ring_torus, (0.82, YF - 0.2, 2.62), 0.16, 0.014, (0, 0, 1), 12, 4, name='tender_brake_wheel', lod='drop')
    for s in (-1, 1):
        RP('brass', cyl, (s * 0.62, yb, 1.95), (s * 0.62, yb - 0.18, 1.95), 0.035, 6, name='water_valve_spindle', lod='drop', bisect=False)
        RP('brass', cyl, (s * 0.62, yb - 0.02, 1.8), (s * 0.62, yb - 0.1, 1.8), 0.07, 8, name='water_valve', bisect=False)
        RP('dark', VH.ring_torus, (s * 0.62, yb - 0.19, 1.95), 0.11, 0.013, (0, 1, 0), 12, 4, name='water_valve_handwheel', bisect=False)
        # tool locker (hinged door, hasp) each side of the opening
        lx = s * 1.27
        RP('body', box, (lx, yb - 0.16, 2.2), (0.36, 0.3, 0.9), name='tool_locker')
        RP('body', box, (lx, yb - 0.32, 2.2), (0.32, 0.02, 0.84), name='tool_locker_door', lod='drop')
        RP('dark', box, (lx - s * 0.12, yb - 0.34, 2.3), (0.03, 0.02, 0.12), name='locker_hasp', lod='drop')
        RP('body', box, (lx, yb - 0.17, 2.67), (0.4, 0.34, 0.04), name='tool_locker_lid')
    # coal heap (node 'load')
    if not burnt:
        def zf(x, y, u, v):
            ex = 1 - (2 * u - 1) ** 4
            ey = 1 - (2 * v - 1) ** 4
            return zt - 0.32 + 0.5 * ex * ey
        R.coal_heap(-1.27, 1.27, y0 + 0.06, y1 - 0.05, zf, node='load', lumps=120)
        VH.VM['toggles']['load'] = {'default': True, 'note': 'coal in the bunker'}


def frame_end():
    for yb in (-2.2, 2.3):                                   # bogie cradles: tub rests on the bogie centre plates
        RP('frame', box, (0, yb, 1.2), (1.9, 0.6, 0.36), name='bogie_cradle')
        for s in (-1, 1):
            RP('frame', beam, (s * 0.9, yb - 0.3, 1.38), (s * 1.25, yb - 0.3, 1.75), 0.08, 0.06, name='cradle_gusset', bisect=False, lod='drop')
            RP('frame', beam, (s * 0.9, yb + 0.3, 1.38), (s * 1.25, yb + 0.3, 1.75), 0.08, 0.06, name='cradle_gusset', bisect=False, lod='drop')
    RP('frame', box, (0, YF - 0.3, 1.2), (2.4, 0.9, 0.35), name='front_frame')
    RP('dark', beam, (0, YF - 0.5, 1.0), (0, YF - 0.95, 1.0), 0.12, 0.1, name='drawbar_pocket', bisect=False)
    VH.socket('coupler_front', (0, YF - 0.95, 1.0), (0, -1, 0), note='drawbar to loco_br52 coupler_rear')
    for s in (-1, 1):
        RP('frame', box, (s * 1.2, YF - 0.72, 1.06), (0.35, 0.3, 0.3), name='front_buffer_block', lod='drop')
        R.step(s * 1.35, YF - 0.3, 1.2, 0.4, 0.22, 'frame', 0.45)
        R.handrail([(s * 1.52, YF - 0.2, 1.7), (s * 1.52, YF - 0.2, 3.0)])
    RP('frame', box, (0, YB + 0.35, 1.2), (2.5, 0.8, 0.3), name='rear_frame')
    yr = R.headstock(YB + 0.7, 1.06, 3.0, 0.38, 1, 'frame', blen=0.6)
    # rear ladder (stiles + rungs) up the dished end to the tank top, stirrup steps on the buffer beam
    for dx in (-0.22, 0.22):
        RP('dark', beam, (-0.4 + dx, YB + 0.72, 1.3), (-0.4 + dx, YB + 0.3, ZT1 + 0.5), 0.05, 0.03, name='rear_ladder_stile', up=V((1, 0, 0)), bisect=False)
    for k in range(6):
        t = (k + 0.5) / 6
        RP('dark', cyl, (-0.62, YB + 0.72 - 0.42 * t, 1.3 + (ZT1 - 0.8) * t), (-0.18, YB + 0.72 - 0.42 * t, 1.3 + (ZT1 - 0.8) * t), 0.016, 5, name='rear_ladder_rung', bisect=False, lod='drop')
    for s in (-1, 1):
        R.step(s * 0.4, YB + 0.95, 0.95, 0.4, 0.22, 'frame', 0.35)
    # rear grab rail on the dished end (+X side), held on stand-offs welded to the dish (mirrors the ladder)
    R.handrail([(0.95, YB + 0.62, 1.95), (0.95, YB + 0.62, 2.95)], r=0.017)
    for z in (1.95, 2.95):
        RP('dark', cyl, (0.95, YB + 0.47, z), (0.95, YB + 0.63, z), 0.02, 5, name='grab_standoff', bisect=False, lod='drop')
    for s in (-1, 1):
        R.lamp((s * 0.85, YB + 0.82, 1.55), (0, 1, 0), 'rear_lamp_' + ('r' if s < 0 else 'l'))
    return yr


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('tender_t30', var, pal(), seed=53, sooty=0.35)
    R.bogie('bogie_f', -2.2, 1.8, 0.5, key='frame', wkey='wheel')
    R.bogie('bogie_r', 2.3, 1.8, 0.5, key='frame', wkey='wheel')
    tub(burnt)
    bunker(burnt)
    yr = frame_end()
    VH.emitter('rail_dust', (0, 2.3, 0.05), (0, 0, 1))
    if var == 'winter':
        R.snow_cover(min_z=1.5, cover=0.25, min_area=0.05)
        R.snow_heap(-0.8, 0.8, 0.85, 3.0, lambda x, y: ZT1 + 0.03, step=0.25, name='snow_tank_top', lift=0.0)
    if burnt:
        VH.emitter('smoke', (0, -1.5, 3.5), (0, 0, 1), kind2='wreck_smoulder')
        pv = Matrix.Translation((0, 0, 1.3))               # tub slumps on the burnt bogie springs, lists to the left
        R.wreck_pose(Matrix.Translation((0, 0, -0.05)) @ pv @ Matrix.Rotation(math.radians(2.5), 4, 'Y') @ pv.inverted())
    dims = {'length_over_buffers': round(yr - (YF - 0.95), 3), 'width': 3.0, 'height': 3.95, 'bogie_wheelbase': 1.8,
            'wheel_d': 1.0, 'water_m3': 30, 'coal_t': 10}
    R.finalize(out_root, 'tender_t30', 'tender', dims, var, ALL, 'DR 2\'2\' T30 Wannentender (BR 52 tub tender)',
               extra={'loco': 'loco_br52', 'mass_t': 58.7})


if __name__ == '__main__':
    R.run(main, ALL)
