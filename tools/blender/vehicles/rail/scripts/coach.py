# DR "Donnerbuechse" 2-axle 3rd-class passenger coach (Einheits-Nebenbahnwagen C4 / Ci 28 style), open end platforms.
# blender -b ... --python coach.py -- green|winter|burnt|all
# Dims: LuP 13.92 m, wheelbase 8.0 m, wheels 1.0 m, body 10.8 m + 2 x 0.95 m platforms, width 2.9 m, roof 3.9 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['green', 'winter', 'burnt']
LB, WB, ZF, ZE, ZR = 10.8, 2.9, 1.28, 3.3, 3.92
HX = WB / 2
LP = 0.95                                  # platform length
WIN = [-4.5, -3.35, -2.2, -1.05, 1.05, 2.2, 3.35, 4.5]


def pal():
    return dict(R.DR, body=R.DR['green'], roof=(78, 76, 72), wheel=R.DR['dark'], white=(200, 196, 186), yellow=(170, 140, 60),
                keep_int=(60, 48, 38), leather=(58, 38, 26), sash=(74, 50, 32))


def arc(y, hw, ze, zr, n=12):
    return [V((-hw * math.cos(math.pi * i / n), y, ze + (zr - ze) * math.sin(math.pi * i / n) ** 0.8)) for i in range(n + 1)]


def side_wall(s, burnt):
    """Body side with 8 window openings: panels between windows, belt rail, glazing (droplights), frames."""
    x = s * HX
    y0, y1 = -LB / 2, LB / 2
    zw0, zw1 = ZF + 1.0, ZF + 1.85
    RP('body', box, (x, 0, (ZF + zw0) / 2), (0.04, LB, zw0 - ZF), name='side_lower')
    RP('body', box, (x, 0, (zw1 + ZE) / 2), (0.04, LB, ZE - zw1), name='side_upper')
    edges = [y0] + sum([[w - 0.45, w + 0.45] for w in WIN], []) + [y1]
    for a, b in zip(edges[0::2], edges[1::2]):
        RP('body', box, (x, (a + b) / 2, (zw0 + zw1) / 2), (0.04, b - a, zw1 - zw0), name='pier')
    for w in WIN:
        if not burnt:
            RP('glass', box, (x - s * 0.015, w, (zw0 + zw1) / 2), (0.01, 0.9, zw1 - zw0), name='window_glass', lod='drop')
            RP('keep_int', box, (x - s * 0.3, w, (zw0 + zw1) / 2 - 0.1), (0.02, 0.9, 0.7), name='seat_backs', lod='drop')
            # drop-light sash (lowered 0.12 on some windows), its leather strap hanging inside, top-light bar
            dl = 0.12 if (int(w * 10) % 3 == 0) else 0.0
            for dz in (zw0 + 0.03 - dl, zw0 + 0.55 - dl):
                RP('sash', box, (x - s * 0.005, w, dz), (0.03, 0.86, 0.045), name='sash_rail')
            for dy in (-0.41, 0.41):
                RP('sash', box, (x - s * 0.005, w + dy, zw0 + 0.29 - dl), (0.03, 0.045, 0.56), name='sash_stile')
            RP('sash', box, (x - s * 0.005, w, zw1 - 0.2), (0.03, 0.88, 0.04), name='toplight_bar')
            RP('leather', box, (x - s * 0.03, w, zw0 + 0.2 - dl), (0.01, 0.06, 0.4), name='droplight_strap', lod='drop')
        for dz in (zw0, zw1):                                   # outer window frame (beading) + drip moulding
            RP('body', box, (x + s * 0.02, w, dz), (0.03, 0.98, 0.05), name='window_frame')
        for dy in (-0.47, 0.47):
            RP('body', box, (x + s * 0.02, w + dy, (zw0 + zw1) / 2), (0.03, 0.05, zw1 - zw0 + 0.05), name='window_frame')
        RP('dark', box, (x + s * 0.035, w, zw1 + 0.09), (0.04, 1.02, 0.03), name='drip_strip', lod='drop')
    for yy in [-LB / 2 + 0.02] + [w + f * 0.575 for w in WIN for f in (-1, 1) if abs(w + f * 0.575) < LB / 2 - 0.1] + [LB / 2 - 0.02]:
        RP('dark', box, (x + s * 0.022, yy, (ZF + zw0) / 2), (0.01, 0.025, zw0 - ZF - 0.1), name='panel_seam', lod='drop')
    RP('dark', box, (x + s * 0.03, 0, ZE - 0.04), (0.05, LB + 0.1, 0.05), name='cantrail_rain_strip')
    RP('body', box, (x + s * 0.03, 0, zw0 - 0.05), (0.04, LB, 0.07), name='belt_rail')
    RP('body', box, (x + s * 0.03, 0, ZF + 0.05), (0.05, LB, 0.1), name='bottom_rail')
    for w in (-5.2, 0.0, 5.2):
        RP('body', box, (x + s * 0.02, w, (ZF + ZE) / 2), (0.03, 0.06, ZE - ZF), name='pilaster', lod='drop')
    if not burnt:
        R.label_block((x + s * 0.03, 0.0, ZF + 0.55), (s, 0, 0), 1.4, 0.18, 1, 'yellow')   # 'Deutsche Reichsbahn'
        R.label_block((x + s * 0.03, -3.9, ZF + 0.6), (s, 0, 0), 0.22, 0.28, 1, 'yellow')   # class '3'
        R.label_block((x + s * 0.03, 3.9, ZF + 0.6), (s, 0, 0), 0.22, 0.28, 1, 'yellow')


def ends_and_platforms(burnt):
    for f in (-1, 1):
        y = f * LB / 2
        bm = bmesh.new()
        pts = [V((HX, y, ZF)), V((HX, y, ZE))] + [p for p in reversed(arc(y, HX, ZE, ZR))][1:-1] + [V((-HX, y, ZE)), V((-HX, y, ZF))]
        a = [bm.verts.new(p) for p in pts]
        bm.faces.new(a)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.05)
        rp_(bm, 'body', 'end_wall')
        nd = 'door_' + ('f' if f < 0 else 'b')
        hx = -0.35
        kw = dict(node=nd, pivot=(hx, y + f * 0.04, ZF))
        RP('body', box, (0, y + f * 0.05, ZF + 1.0), (0.7, 0.04, 1.95), name='end_door', **kw)
        if not burnt:
            RP('glass', box, (0, y + f * 0.075, ZF + 1.45), (0.5, 0.01, 0.6), name='end_door_glass', lod='drop', **kw)
        VH.moving(nd, 'door', (hx, y + f * 0.04, ZF), (0, 0, 1), limits=(0, 100 * -f))
        # platform deck, railings with gates, steps down both sides, roof overhang supported by posts
        yp = y + f * LP / 2
        RP('planks', box, (0, yp, ZF - 0.03), (WB - 0.2, LP, 0.06), name='platform_deck')
        ye = y + f * LP
        for s in (-1, 1):                                       # end railing panels (tube frame + bars) beside the gangway
            R.handrail([(s * 0.4, ye, ZF), (s * 0.4, ye, ZF + 1.0), (s * (HX - 0.05), ye, ZF + 1.0)], r=0.024, lod=None)
            R.handrail([(s * 0.4, ye, ZF + 0.5), (s * (HX - 0.05), ye, ZF + 0.5)], r=0.016)
            for k in range(1, 5):
                xx = s * (0.4 + (HX - 0.45) * k / 5)
                R.handrail([(xx, ye, ZF + 0.02), (xx, ye, ZF + 1.0)], r=0.01)
        # gangway: hinged bridge plate (node, folded up in travel) + folding gate with a chain
        nb = 'bridge_' + ('f' if f < 0 else 'b')
        RP('dark', box, (0, ye + f * 0.02, ZF + 0.34), (0.78, 0.03, 0.62), name='bridge_plate', node=nb, pivot=(0, ye, ZF + 0.02))
        RP('dark', box, (0, ye + f * 0.05, ZF + 0.34), (0.7, 0.02, 0.04), name='bridge_plate_rib', node=nb, pivot=(0, ye, ZF + 0.02), lod='drop')
        VH.moving(nb, 'hatch', (0, ye, ZF + 0.02), (1, 0, 0), limits=(0, 90 * -f), note='gangway bridge plate: travel = folded up; lowered 90 deg it spans to the next coach')
        ng = 'gate_' + ('f' if f < 0 else 'b')
        R.handrail([(-0.38, ye - f * 0.02, ZF + 0.95), (0.3, ye - f * 0.02, ZF + 0.95)], r=0.018)
        RP('dark', box, (-0.05, ye - f * 0.03, ZF + 0.75), (0.6, 0.02, 0.35), name='gate_panel', node=ng, pivot=(-0.38, ye, ZF + 0.75), lod='drop')
        VH.moving(ng, 'door', (-0.38, ye, ZF + 0.75), (0, 0, 1), limits=(0, 90))
        for s in (-1, 1):
            RP('dark', cyl, (s * (HX - 0.05), y + f * LP, ZF), (s * (HX - 0.05), y + f * LP, ZE + 0.1), 0.03, 6, name='platform_post', bisect=False)
            R.handrail([(s * (HX - 0.05), y + f * 0.05, ZF + 1.0), (s * (HX - 0.05), y + f * 0.4, ZF + 1.0)])
            for k, dz in enumerate((0.36, 0.74)):               # step boards: timber treads on iron hangers
                xs = s * (HX - 0.12 + 0.08 * k)
                RP('wood', box, (xs, yp, ZF - dz), (0.3, 0.7, 0.045), name='step_board')
                RP('dark', box, (xs + s * 0.15, yp, ZF - dz + 0.02), (0.02, 0.72, 0.07), name='step_edge', lod='drop')
                for dy in (-0.33, 0.33):
                    RP('dark', beam, (s * (HX - 0.2), yp + dy, ZF - 0.02), (xs, yp + dy, ZF - dz - 0.02), 0.04, 0.015, name='step_hanger', bisect=False, lod='drop')
            R.handrail([(s * (HX + 0.02), yp - f * 0.4, ZF - 0.6), (s * (HX + 0.02), yp - f * 0.4, ZF + 0.95)], r=0.017)
            VH.socket('platform_%s_%s' % ('f' if f < 0 else 'b', 'r' if s < 0 else 'l'), (s * (HX + 0.5), yp, 0.0), (-s, 0, 0), pose='climb_in')
        VH.socket('platform_' + ('f' if f < 0 else 'b'), (0.4, yp, ZF), (0, f, 0), pose='stand', note='guard / sentry on the platform')


def roof(burnt):
    if burnt:
        for y in (-4.0, -1.5, 2.0, 4.5):
            bm = bmesh.new()
            r0 = arc(y, HX, ZE, ZR, 8)
            for a, b in zip(r0[:-1], r0[1:]):
                C.beam_bm(bm, a, b, 0.05, 0.05)
            rp_(bm, 'body', 'roof_hoop')
        return
    bm = bmesh.new()
    rings = [[p + V((0, 0, 0.0)) for p in arc(-LB / 2 - LP - 0.05, HX + 0.06, ZE, ZR)], arc(LB / 2 + LP + 0.05, HX + 0.06, ZE, ZR)]
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(len(rings[0]) - 1):
        bm.faces.new((vs[0][i], vs[0][i + 1], vs[1][i + 1], vs[1][i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.05)
    rp_(bm, 'felt', 'roof', smooth=True)
    for y in (-4.0, -2.0, 0.0, 2.0, 4.0):                       # torpedo roof ventilators (Torpedoluefter) on a foot
        xv = 0.35 if int(y) % 4 == 0 else -0.35
        zz = ZR - 0.03 - 0.8 * (xv / HX) ** 2 * (ZR - ZE)
        RP('roof', cyl, (xv, y - 0.32, zz + 0.2), (xv, y + 0.32, zz + 0.2), 0.14, 10, r1=0.1, name='roof_vent', smooth=True, bisect=False)
        RP('roof', cyl, (xv, y - 0.32, zz + 0.2), (xv, y - 0.42, zz + 0.2), 0.14, 10, r1=0.03, name='roof_vent_nose', bisect=False, lod='drop')
        RP('roof', box, (xv, y, zz + 0.06), (0.14, 0.34, 0.14), name='roof_vent_foot')
    RP('dark', cyl, (0.7, -4.9, ZR - 0.15), (0.7, -4.9, ZR + 0.25), 0.06, 8, name='stove_chimney', bisect=False)
    RP('dark', cyl, (0.7, -4.9, ZR + 0.25), (0.7, -4.9, ZR + 0.32), 0.12, 8, r1=0.02, name='stove_chimney_cap', bisect=False, lod='drop')
    VH.emitter('stove_smoke', (0.7, -4.9, ZR + 0.33), (0, 0, 1), when='winter / occupied')
    for s in (-1, 1):                                          # rain gutters
        RP('dark', box, (s * (HX + 0.07), 0, ZE + 0.02), (0.05, LB + 2 * LP, 0.05), name='gutter')
    RP('dark', box, (0, 0, ZR + 0.02), (0.3, LB, 0.02), name='roof_walk', lod='drop')


def interior(burnt):
    RP('planks', box, (0, 0, ZF - 0.02), (WB - 0.1, LB, 0.04), name='floor')
    if burnt:
        return
    for w in WIN:                                               # wooden bench seats (3rd class)
        for s in (-1, 1):
            RP('wood', box, (s * 0.85, w, ZF + 0.45), (0.9, 0.45, 0.06), name='bench', lod='drop')
    for i, w in enumerate(WIN[::2]):
        VH.socket('seat_%d' % i, (0.85, w, ZF + 0.45), (0, -1, 0), pose='sit')
    VH.socket('cargo', (0, 0, ZF), (0, -1, 0), note='aisle (hide inside)', capacity=10)
    VH.light('interior', (0, 0, ZE), (0, 0, -1), True, kind='interior_lamp')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('coach', var, pal(), seed=61)
    yf, yr = R.two_axle_underframe(LB + 2 * LP, 8.0, 0.5, 1.22, 'frame', 'wheel', blen=0.62)
    interior(burnt)
    for s in (-1, 1):
        side_wall(s, burnt)
    ends_and_platforms(burnt)
    roof(burnt)
    RP('dark', box, (0.6, 1.5, 0.85), (0.9, 0.7, 0.45), name='battery_box')
    if var == 'winter':
        R.snow_cover(min_z=1.1, cover=0.25)
    if burnt:
        VH.emitter('smoke', (0, 0, ZE), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('fire', (0, -2.0, ZF + 0.5), (0, 0, 1), when='destroyed')
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 8.0, 'wheel_d': 1.0, 'body_length': LB, 'width': WB,
            'height': ZR, 'floor': ZF, 'buffer_height': 1.06}
    R.finalize(out_root, 'coach', 'rail_coach', dims, var, ALL, 'DR "Donnerbuechse" 2-axle 3rd-class coach',
               extra={'class': 'C / Ci 28', 'seats': 56, 'mass_t': 18.0, 'hide_inside': True})


if __name__ == '__main__':
    R.run(main, ALL)
