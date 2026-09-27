# DR Omm 33 "Linz" open goods wagon (offener Gueterwagen, steel sides), coal load node.
# blender -b ... --python wagon_open.py -- brown|winter|burnt|all
# Dims: LuP 10.10 m, wheelbase 6.0 m, wheels 1.0 m, body 8.7 x 2.9 m, side walls 1.55 m above the floor (floor 1.28 m).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['brown', 'winter', 'burnt']
LB, WB, ZF, HW = 8.7, 2.9, 1.28, 1.55
HX = WB / 2
ZT = ZF + HW


def pal():
    return dict(R.DR, body=R.DR['brown'], wheel=(70, 56, 46), white=(214, 210, 198), plate=(24, 23, 22))


def body(burnt):
    rn = C.rng()
    RP('planks' if not burnt else 'boards', box, (0, 0, ZF - 0.03), (WB - 0.1, LB, 0.06), name='floor')
    stakes = [-4.1, -3.2, -2.3, -1.0, 1.0, 2.3, 3.2, 4.1]
    for s in (-1, 1):
        x = s * (HX - 0.02)
        for ya, yb in ((-LB / 2, -0.95), (0.95, LB / 2)):
            RP('body', box, (x, (ya + yb) / 2, ZF + HW / 2), (0.02, yb - ya, HW), name='side_sheet')
        for y in stakes:                                        # pressed U-stakes
            RP('body', box, (x + s * 0.05, y, ZF + HW / 2 - 0.05), (0.08, 0.12, HW + 0.1), name='side_stake')
        RP('body', box, (x + s * 0.03, 0, ZT - 0.03), (0.08, LB, 0.08), name='top_rail')
        RP('body', box, (x + s * 0.03, 0, ZF + 0.62), (0.05, LB, 0.06), name='mid_rib', lod='drop')
        # double doors in the middle (node per leaf, hinged at the stakes)
        for f, nm in ((-1, 'door_%s_f' % ('r' if s < 0 else 'l')), (1, 'door_%s_b' % ('r' if s < 0 else 'l'))):
            hy = f * 0.95
            kw = dict(node=nm, pivot=(x + s * 0.03, hy, ZF))
            ang = 0.0
            if burnt and s > 0 and f < 0:
                ang = 70.0
            RP('body', box, (x + s * 0.02, hy - f * 0.47, ZF + HW / 2), (0.03, 0.92, HW - 0.06), name='door_sheet', **kw)
            for z in (ZF + 0.25, ZF + HW / 2, ZF + HW - 0.25):  # strap hinges: strap + knuckle + pin on the stake
                RP('dark', box, (x + s * 0.045, hy - f * 0.36, z), (0.02, 0.72, 0.08), name='door_hinge', **kw)
                RP('dark', box, (x + s * 0.045, hy - f * 0.7, z), (0.022, 0.06, 0.12), name='hinge_bolt_plate', lod='drop', **kw)
                RP('dark', cyl, (x + s * 0.05, hy, z - 0.07), (x + s * 0.05, hy, z + 0.07), 0.025, 6, name='hinge_knuckle', **kw)
            RP('body', beam, (x + s * 0.05, hy - f * 0.05, ZF + 0.1), (x + s * 0.05, hy - f * 0.9, ZT - 0.12), 0.07, 0.04, name='door_brace', up=V((1, 0, 0)), **kw)
            if f < 0:                                         # latch: drop bar across both leaves + keeper + handle
                RP('dark', box, (x + s * 0.06, 0, ZF + 0.95), (0.03, 0.5, 0.06), name='door_latch_bar', **kw)
                RP('dark', cyl, (x + s * 0.06, -0.2, ZF + 0.92), (x + s * 0.12, -0.2, ZF + 0.82), 0.018, 6, name='latch_handle', **kw)
            else:
                RP('dark', box, (x + s * 0.06, hy - 0.22, ZF + 0.95), (0.04, 0.1, 0.12), name='latch_keeper', **kw)
                RP('dark', box, (x + s * 0.06, hy - 0.3, ZF + 0.12), (0.04, 0.06, 0.1), name='door_foot_catch', lod='drop', **kw)
            VH.moving(nm, 'door', (x + s * 0.03, hy, ZF), (0, 0, 1), limits=(0, 170) if f * s < 0 else (-170, 0))
            if ang:
                VH.rotate_node(nm, ang * (1 if f * s < 0 else -1), (0, 0, 1))
        if not burnt:
            # stencilled DR markings between the stakes: owner / wagon number block, black data panel with
            # Gattungszeichen + weights, load-limit grid on the far panel (abstract bars, no readable text)
            R.label_block((x + s * 0.035, -2.75, ZF + 1.12), (s, 0, 0), 0.66, 0.42, 2)
            RP('plate', box, (x + s * 0.02, -1.65, ZF + 1.05), (0.02, 1.0, 0.56), name='data_panel')
            R.label_block((x + s * 0.035, -1.65, ZF + 1.05), (s, 0, 0), 0.86, 0.46, 4)
            R.label_block((x + s * 0.035, 1.65, ZF + 1.05), (s, 0, 0), 0.9, 0.3, 2)
            R.label_block((x + s * 0.035, 3.65, ZF + 0.95), (s, 0, 0), 0.5, 0.3, 1)
    for f in (-1, 1):                                           # end walls with a top-hinged tipping flap
        y = f * (LB / 2 - 0.02)
        RP('body', box, (0, y, ZF + HW / 2 + 0.05), (WB - 0.04, 0.02, HW + 0.1), name='end_sheet')
        for xx in (-0.9, 0.0, 0.9):
            RP('body', box, (xx, y + f * 0.05, ZF + HW / 2), (0.12, 0.08, HW), name='end_stake')
        RP('body', box, (0, y + f * 0.03, ZT + 0.03), (WB, 0.08, 0.08), name='end_rail')
        R.handrail([(1.3, y + f * 0.1, ZF + 0.1), (1.3, y + f * 0.1, ZT - 0.1)])
    if burnt:                                                   # bulged, buckled sheet + ash heap
        RP('body', box, (HX + 0.08, -2.4, ZF + 0.9), (0.08, 1.2, 0.8), name='bulge', lod='drop')
    return stakes


def coal(var):
    """Heaped lump-coal load (node 'load', toggle): three loading-chute humps, rim held below the wall tops."""
    def zf(x, y, u, v):
        ex = 1 - (2 * u - 1) ** 4
        ey = 1 - (2 * v - 1) ** 6
        hump = sum(0.3 * math.exp(-((y - c) / 1.2) ** 2) for c in (-2.6, 0.0, 2.6))
        return ZT - 0.22 + (0.12 + hump) * ex * ey
    R.coal_heap(-HX + 0.06, HX - 0.06, -LB / 2 + 0.06, LB / 2 - 0.06, zf, node='load', lumps=150)
    VH.VM['toggles']['load'] = {'default': True, 'note': 'coal load (hide = empty wagon)'}


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('wagon_open', var, pal(), seed=37)
    yf, yr = R.two_axle_underframe(8.64, 6.0, 0.5, 1.26, 'frame', 'wheel', blen=0.62)
    body(burnt)
    if not burnt:
        coal(var)
    else:
        RP('coal', box, (0, 0.5, ZF + 0.12), (WB - 0.2, LB * 0.7, 0.2), name='ash_bed')
        VH.emitter('smoke', (0, 0, ZF + 0.5), (0, 0, 1), kind2='wreck_smoulder')
    if var == 'winter':
        R.snow_cover(min_z=1.0, cover=0.3)
    VH.socket('cargo', (0, 0, ZF), (0, -1, 0), note='floor centre (inside); hide in an empty wagon', capacity=6)
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 6.0, 'wheel_d': 1.0, 'body_length': LB, 'width': WB,
            'height': round(ZT + 0.07, 3), 'floor': ZF, 'buffer_height': 1.06}
    R.finalize(out_root, 'wagon_open', 'rail_wagon', dims, var, ALL, 'DR Omm 33 "Linz" open goods wagon (steel sides)',
               extra={'class': 'Omm 33', 'mass_t': 11.0, 'payload_t': 21.0})


if __name__ == '__main__':
    R.run(main, ALL)
