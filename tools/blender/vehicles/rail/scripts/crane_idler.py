# Idler (match) wagon for the rail steam crane: short flat wagon with a jib-rest trestle that carries the lowered
# jib in the travel pose (rail_crane JA 12 deg, coupled at the crane's coupler_front). blender ... -- black|winter|all
# Dims: frame 6.0 m, LuP 7.24 m, wheelbase 3.6 m, rest saddle 3.25 m above rail at local y -1.0.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['black', 'winter']
ZD = 1.3
YR, ZR = -1.0, 3.25


def pal():
    return dict(R.DR, frame=R.DR['red'], wheel=(66, 54, 46), body=(30, 29, 28), white=(200, 196, 186), keep_rope=(64, 60, 52))


def main(var, out_root):
    R.setup('rail_crane_idler', var, pal(), seed=28)
    yf, yr = R.two_axle_underframe(6.0, 3.6, 0.5, 1.2, 'frame', 'wheel', blen=0.55)
    RP('planks', box, (0, 0, ZD - 0.03), (2.7, 6.0, 0.06), name='deck')
    for s in (-1, 1):                                           # trestle: timber baulk legs braced in an A
        RP('wood', beam, (s * 1.1, YR - 0.6, ZD), (s * 0.55, YR, ZR - 0.25), 0.2, 0.2, name='rest_leg')
        RP('wood', beam, (s * 1.1, YR + 0.6, ZD), (s * 0.55, YR, ZR - 0.25), 0.2, 0.2, name='rest_leg')
        RP('dark', beam, (s * 1.1, YR - 0.6, ZD + 0.05), (s * 1.1, YR + 0.6, ZD + 0.05), 0.08, 0.06, name='leg_shoe', bisect=False)
    RP('wood', box, (0, YR, ZR - 0.18), (1.5, 0.3, 0.26), name='rest_beam')
    for s in (-1, 1):                                           # V-saddle cheeks + chain lashing to the jib
        RP('dark', beam, (s * 0.7, YR, ZR - 0.05), (s * 0.35, YR, ZR - 0.3), 0.08, 0.3, name='rest_saddle', up=V((0, 1, 0)), bisect=False)
        RP('dark', beam, (s * 0.7, YR, ZR), (s * 1.1, YR, ZD + 0.2), 0.03, 0.03, name='lashing_chain', bisect=False, lod='drop')
    RP('wood', box, (0, YR - 0.9, ZD + 0.12), (1.2, 0.3, 0.2), name='diagonal_brace_foot', lod='drop')
    RP('wood', beam, (0, YR - 0.9, ZD + 0.2), (0, YR, ZR - 0.3), 0.14, 0.14, name='rest_brace')
    for k, (x, y) in enumerate(((0.7, 1.8), (-0.7, 1.8))):     # tool / slinging-gear boxes + spare rope drum
        RP('body', VH.bevel_box, (x, y, ZD + 0.28), (0.9, 0.7, 0.55), r=0.03, name='tool_box')
        RP('dark', box, (x, y - 0.36, ZD + 0.4), (0.1, 0.02, 0.12), name='tool_box_hasp', lod='drop')
    RP('dark', cyl, (-0.6, 0.6, ZD + 0.4), (0.6, 0.6, ZD + 0.4), 0.35, 14, name='rope_drum', bisect=False)
    RP('keep_rope', cyl, (-0.5, 0.6, ZD + 0.4), (0.5, 0.6, ZD + 0.4), 0.38, 14, caps=False, name='rope_coil', bisect=False)
    for y in (-2.6, 2.6):
        RP('wood', box, (0, y, ZD + 0.1), (2.2, 0.25, 0.2), name='packing_baulk')
    VH.socket('jib_rest', (0, YR, ZR), (0, 0, 1), note='jib bottom chord rests here in the crane travel pose (rail_crane JA 12 deg)')
    # hook-lashing eye on the crane-end of the deck (glTF z +2.85) + a short lashing chain that is shackled to the crane
    # hook block (hoisted to 0.8 m rope in the travel pose, block bottom ~2.2 m above the rail) so it cannot swing
    ye = -2.85
    RP('dark', box, (0, ye, ZD + 0.01), (0.3, 0.2, 0.03), name='lash_eye_plate', bisect=False)
    RP('dark', VH.ring_torus, (0, ye, ZD + 0.1), 0.07, 0.018, (1, 0, 0), 10, 4, name='lash_eye', bisect=False)
    bm = bmesh.new()
    for k in range(6):                                        # chain links rising toward the hook (alternating planes)
        c = V((0, ye - 0.05 * k, ZD + 0.2 + 0.13 * k))
        VH.ring_torus(bm, c, 0.05, 0.012, (1, 0, 0) if k % 2 else (0, 0.4, 1), 8, 3)
    rp_(bm, 'dark', 'hook_lashing_chain', bisect=False, lod='drop', node='lashing', pivot=(0, ye, ZD + 0.1))
    VH.socket('hook_lash', (0, ye - 0.3, ZD + 0.95), (0, 0, 1), note='shackle the rail_crane hook block here in the travel pose')
    VH.VM['toggles']['hook_lashing'] = {'default': True, 'node': 'lashing', 'note': 'chain to the crane hook (travel); hide when working'}
    if var == 'winter':
        R.snow_cover(min_z=1.0, cover=0.3)
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 3.6, 'wheel_d': 1.0, 'rest_height': ZR}
    R.finalize(out_root, 'rail_crane_idler', 'rail_wagon', dims, var, ALL, 'Idler (match) wagon with jib rest for the rail steam crane',
               extra={'pairs_with': 'rail_crane', 'coupling': 'rear coupler to rail_crane coupler_front'})


if __name__ == '__main__':
    R.run(main, ALL)
