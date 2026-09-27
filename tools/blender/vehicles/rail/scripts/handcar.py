# Railway pump handcar (Handhebeldraisine / track inspection handcar): timber platform on two wheelsets, A-frame with a
# see-saw pump beam geared to the rear axle, brake lever. blender -b ... --python handcar.py -- wood|winter|all
# Dims: 2.6 m long, 1.7 m wide, wheels 0.5 m, pump beam pivot 1.4 m above the rail, beam 2.0 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['wood', 'winter']
ZD = 0.5                       # deck top (wheel tops stand 0.1 m proud)


def pal():
    return {'frame': (40, 38, 36), 'wheel': (112, 34, 26), 'dark': (32, 30, 29), 'yellow': (176, 142, 58), 'red': (120, 30, 24),
            'iron': (44, 42, 40)}


def main(var, out_root):
    R.setup('handcar', var, pal(), seed=9)
    RW = 0.3                                                            # 600 mm spoked wheels, tops stand proud of the deck
    for i, y in enumerate((-0.7, 0.7)):
        R.wheelset('ws%d' % i, y, RW, 'spoked', spokes=10, segs=18, key='wheel', axle_key='dark')
    xs = 0.55                                                           # sills run INSIDE the wheels (wheels fully visible)
    for s in (-1, 1):
        RP('yellow', box, (s * xs, 0, ZD - 0.1), (0.1, 2.5, 0.18), name='sill', uv='beam', axis=(0, 1, 0))
        RP('iron', box, (s * (xs + 0.052), 0, ZD - 0.1), (0.008, 2.5, 0.06), name='sill_strap', lod='drop')
        for y in (-0.7, 0.7):                                           # pedestal bearings bolted under the sills
            RP('iron', VH.bevel_box, (s * xs, y, RW), (0.12, 0.2, 0.16), r=0.015, name='bearing', bisect=False)
            RP('iron', box, (s * xs, y, RW + 0.12), (0.1, 0.28, 0.08), name='bearing_hanger', bisect=False)
            RP('iron', box, (s * (xs + 0.25), y, RW + 0.33), (0.36, 0.7, 0.02), name='wheel_guard', bisect=False)
            RP('iron', beam, (s * (xs + 0.42), y - 0.34, RW + 0.33), (s * (xs + 0.42), y - 0.34, RW + 0.12), 0.03, 0.01, name='guard_stay', bisect=False, lod='drop')
    for y in (-1.2, 0.0, 1.2):
        RP('yellow', box, (0, y, ZD - 0.1), (2 * xs, 0.1, 0.14), name='cross_sill', uv='beam', axis=(1, 0, 0))
    RP('planks', box, (0, 0, ZD - 0.005), (1.3, 2.5, 0.05), name='deck', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()                                                    # deck bolt heads over the sills
    for s in (-1, 1):
        for k in range(7):
            C.cyl_bm(bm, V((s * xs, -1.15 + k * 0.383, ZD + 0.02)), V((s * xs, -1.15 + k * 0.383, ZD + 0.035)), 0.02, 5)
    rp_(bm, 'iron', 'deck_bolts', lod='drop', bisect=False)
    for f in (-1, 1):                                                   # end beams with iron caps + push handles
        RP('yellow', box, (0, f * 1.3, ZD - 0.08), (1.4, 0.12, 0.2), name='end_beam')
        RP('iron', box, (0, f * 1.365, ZD - 0.08), (1.42, 0.012, 0.22), name='end_cap')
        for s in (-1, 1):
            R.handrail([(s * 0.45, f * 1.33, ZD + 0.02), (s * 0.45, f * 1.45, ZD + 0.1), (s * 0.3, f * 1.45, ZD + 0.1), (s * 0.3, f * 1.33, ZD + 0.02)], r=0.015, key='iron')
    # A-frame: iron-strapped timber posts, diagonal knee braces, bearing caps at the pivot
    zp = 1.3
    for s in (-1, 1):
        for dy in (-0.4, 0.4):
            RP('yellow', beam, (s * 0.28, dy, ZD), (s * 0.13, 0.0, zp - 0.04), 0.09, 0.09, name='a_frame')
            RP('iron', beam, (s * 0.28, dy * 0.95, ZD + 0.02), (s * 0.25, dy * 0.8, ZD + 0.2), 0.1, 0.1, name='a_frame_shoe', lod='drop')
        RP('yellow', box, (s * 0.2, 0, ZD + 0.45), (0.06, 0.62, 0.07), name='a_frame_tie')
        RP('iron', VH.bevel_box, (s * 0.13, 0, zp), (0.1, 0.2, 0.16), r=0.02, name='pivot_bearing', bisect=False)
        for dy in (-0.07, 0.07):
            RP('iron', cyl, (s * 0.13, dy, zp + 0.08), (s * 0.13, dy, zp + 0.12), 0.015, 5, name='bearing_bolt', bisect=False, lod='drop')
    RP('iron', cyl, (-0.22, 0, zp), (0.22, 0, zp), 0.035, 8, name='pivot_shaft', bisect=False)
    piv = (0, 0, zp)
    kw = dict(node='pump', pivot=piv)
    ang = math.radians(10)
    d = V((0, math.cos(ang), math.sin(ang)))
    RP('yellow', beam, V(piv) - d * 1.0, V(piv) + d * 1.0, 0.1, 0.12, name='pump_beam', **kw)
    RP('iron', box, tuple(V(piv)), (0.14, 0.3, 0.18), name='beam_boss', **kw)
    for e in (-1, 1):
        c = V(piv) + d * e * 1.0
        RP('yellow', cyl, c + V((-0.6, 0, 0)), c + V((0.6, 0, 0)), 0.035, 8, name='pump_handle', bisect=False, **kw)
        RP('iron', box, tuple(c), (0.14, 0.12, 0.14), name='handle_socket', **kw)
    # drive: pitman (connecting rod) from the beam arm down to a crank on the countershaft; pinion on the countershaft
    # meshes the big spur gear on the rear axle (ws1)
    cs = V((0, 0.36, RW + 0.12))                                        # countershaft (hung under the deck)
    crank_r = 0.12
    RP('iron', cyl, cs - V((0.5, 0, 0)), cs + V((0.5, 0, 0)), 0.03, 8, name='countershaft', bisect=False)
    for s in (-1, 1):
        RP('iron', box, tuple(cs + V((s * 0.5, 0, 0.05))), (0.08, 0.14, 0.16), name='countershaft_bearing', bisect=False)
    pin = cs + V((0.08, -crank_r * math.sin(0.4), crank_r * math.cos(0.4)))
    RP('iron', box, tuple((cs + pin) / 2 + V((0.08, 0, 0))), (0.03, 0.06, crank_r + 0.06), name='crank_arm', bisect=False)
    arm = V(piv) + d * 0.32 + V((0.08, 0, -0.04))
    RP('iron', beam, arm, pin + V((0.02, 0, 0)), 0.035, 0.05, name='pitman_rod', bisect=False)
    RP('iron', cyl, pin + V((-0.02, 0, 0)), pin + V((0.06, 0, 0)), 0.03, 6, name='crank_pin', bisect=False, lod='drop')
    R.gear(cs + V((-0.3, 0, 0)), 0.1, 0.05, 10, 'iron', 'pinion', dict(node='main'))
    R.gear(V((-0.3, 0.7, RW)), 0.26, 0.05, 26, 'iron', 'axle_gear', dict(node='ws1', pivot=(0, 0.7, RW)))
    VH.moving('pump', 'pump_beam', piv, (1, 0, 0), limits=(-16, 16), gear_ratio=2.6,
              note='see-saw: beam angle = 16*sin(countershaft angle); countershaft turns 2.6x per wheel revolution (pinion 10 / axle gear 26)')
    # brake: long hand lever at the rear pulling a rod to a shoe on the rear wheel
    RP('iron', cyl, (0.45, 1.0, ZD), (0.5, 1.12, ZD + 0.85), 0.022, 6, name='brake_lever', node='brake', pivot=(0.45, 1.0, ZD))
    RP('iron', box, (0.5, 1.12, ZD + 0.86), (0.05, 0.05, 0.12), name='brake_grip', node='brake', pivot=(0.45, 1.0, ZD), lod='drop')
    RP('iron', box, (0.45, 1.0, ZD + 0.02), (0.1, 0.16, 0.05), name='brake_quadrant', bisect=False)
    xt = R.GAUGE[0] / 2 + 0.0675                                        # wheel tread centre: the shoe bears on the tread
    bm = bmesh.new()                                                    # curved cast shoe hugging the rear tread (arc +-20 deg)
    for a0, a1 in ((-0.35, 0.0), (0.0, 0.35)):
        pa = V((xt, 0.7 + (RW + 0.03) * math.cos(a0), RW + (RW + 0.03) * math.sin(a0)))
        pb = V((xt, 0.7 + (RW + 0.03) * math.cos(a1), RW + (RW + 0.03) * math.sin(a1)))
        C.beam_bm(bm, pa, pb, 0.11, 0.05, up=V((1, 0, 0)))
    rp_(bm, 'iron', 'brake_shoe', bisect=False)
    RP('iron', beam, (xs + 0.06, 0.7 + RW + 0.06, ZD - 0.14), (xt, 0.7 + RW + 0.06, RW + 0.06), 0.03, 0.02, name='brake_shoe_hanger', bisect=False)
    RP('iron', beam, (0.45, 1.0, ZD - 0.05), (xt - 0.04, 0.7 + RW + 0.07, RW), 0.02, 0.02, name='brake_rod', bisect=False, lod='drop')
    VH.moving('brake', 'lever', (0.45, 1.0, ZD), (1, 0, 0), limits=(-20, 20), note='pulls brake_rod -> curved shoe (main node) on the rear wheel tread at x %.3f' % xt)
    RP('wood', VH.bevel_box, (-0.4, -1.0, ZD + 0.15), (0.45, 0.35, 0.28), r=0.02, name='tool_box')
    RP('iron', box, (-0.4, -1.18, ZD + 0.22), (0.08, 0.02, 0.08), name='tool_box_hasp', lod='drop')
    R.lamp((0.45, -1.28, ZD + 0.2), (0, -1, 0), 'lamp', key='iron', r=0.08)
    for e, sd in ((-1, 'f'), (1, 'b')):
        for s in (-1, 1):
            VH.socket('pumper_%s_%s' % (sd, 'r' if s < 0 else 'l'), (s * 0.35, e * 0.95, ZD), (0, -e, 0), pose='pump_handcar')
    VH.socket('push', (0, 1.8, 0.0), (0, -1, 0), pose='push')
    if var == 'winter':
        R.snow_cover(min_z=0.3, cover=0.2)
    dims = {'length': 2.73, 'width': 1.7, 'wheel_d': 2 * RW, 'deck': ZD, 'pump_pivot': zp}
    R.finalize(out_root, 'handcar', 'handcar', dims, var, ALL, 'Railway pump handcar (Draisine)',
               extra={'crew': 4, 'speed_kmh': 15, 'side': 'neutral'}, ao_dist=0.5)


if __name__ == '__main__':
    R.run(main, ALL)
