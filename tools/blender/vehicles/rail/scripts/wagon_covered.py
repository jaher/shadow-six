# DR G10 covered goods wagon (Gedeckter Güterwagen, Verbandsbauart / DR 1927-1944), standard gauge.
# blender -b ... --python wagon_covered.py -- brown|winter|burnt|all
# Dims: LuP 9.10 m, wheelbase 4.0 m, wheels 1.0 m, body 7.72 x 2.9 m, roof 3.93 m above rail, floor 1.24 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['brown', 'winter', 'burnt']
LB, WB, ZF, ZE, ZR = 7.72, 2.9, 1.24, 3.35, 3.93      # body length/width, floor, eaves, roof crown
HX = WB / 2


def pal():
    return dict(R.DR, body=R.DR['brown'], steel=R.DR['brown'], wheel=R.DR['dark'], white=(200, 196, 186))


def roof_ring(y, over=0.06, lift=0.0):
    pts = []
    n = 10
    hw = HX + over
    for i in range(n + 1):                         # circular arc through (+-hw, ZE) and (0, ZR)
        t = -1 + 2 * i / n
        x = hw * t
        z = ZE + (ZR - ZE) * (1 - t * t) + lift
        pts.append(V((x, y, z)))
    return pts


def body(burnt):
    kb = 'body'
    y0, y1 = -LB / 2, LB / 2
    rn = C.rng()
    # side walls: boards between the frame members (door opening 2.0 m in the middle)
    for s in (-1, 1):
        for ya, yb in ((y0, -1.0), (1.0, y1)):
            if burnt:
                for k in range(3):
                    h = 0.2 + 0.5 * rn.random()
                    yy = ya + (yb - ya) * (0.15 + 0.3 * k)
                    RP('boards', box, (s * (HX - 0.03), yy, ZF + h / 2), (0.04, 0.5 + 0.4 * rn.random(), h), name='burnt_board')
                continue
            RP(kb, box, (s * (HX - 0.03), (ya + yb) / 2, (ZF + ZE) / 2), (0.04, yb - ya, ZE - ZF), name='side_boards')
    for f in (-1, 1):                               # end walls
        y = f * (LB / 2 - 0.03)
        if burnt:
            RP('boards', box, (0.4, y, ZF + 0.3), (1.2, 0.04, 0.5), name='burnt_board')
            continue
        bm = bmesh.new()
        ring = roof_ring(y, 0.0)
        pts = [V((HX, y, ZF)), V((HX, y, ZE))] + [p for p in reversed(ring)][1:-1] + [V((-HX, y, ZE)), V((-HX, y, ZF))]
        a = [bm.verts.new(p) for p in pts]
        b = [bm.verts.new(p + V((0, -f * 0.04, 0))) for p in pts]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new((a[i], a[j], b[j], b[i]))
        rp_(bm, kb, 'end_boards')
    # floor
    RP('planks' if not burnt else 'boards', box, (0, 0, ZF - 0.03), (WB - 0.1, LB, 0.06), name='floor')
    # steel frame: corner posts, stanchions, diagonal braces, top/bottom rails
    ks = 'steel'
    for s in (-1, 1):
        x = s * (HX + 0.02)
        for y in (y0 + 0.04, y1 - 0.04):
            RP(ks, box, (x, y, (ZF + ZE) / 2 - 0.02), (0.1, 0.1, ZE - ZF + 0.04), name='corner_post')
        for y in (-2.9, -1.95, -1.05, 1.05, 1.95, 2.9):
            RP(ks, box, (x, y, (ZF + ZE) / 2), (0.08, 0.1, ZE - ZF), name='stanchion')
        for ya, yb in ((-3.8, -2.9), (2.9, 3.8)):
            RP(ks, beam, (x, ya, ZF + 0.05), (x, yb, ZE - 0.05), 0.08, 0.07, name='brace', up=V((1, 0, 0)))
        RP(ks, box, (x, 0, ZE - 0.04), (0.1, LB, 0.1), name='cant_rail')
        RP(ks, box, (x, 0, ZF + 0.02), (0.1, LB, 0.1), name='bottom_rail')
        if not burnt:
            RP(ks, box, (x + s * 0.06, 0, ZE + 0.02), (0.05, 4.4, 0.08), name='door_rail_top', lod='drop')
            RP(ks, box, (x + s * 0.06, 0, ZF - 0.05), (0.05, 4.4, 0.06), name='door_rail_bottom', lod='drop')
            for y in (-2.45, 2.45):                   # ventilation flaps high in the corner panels
                RP(ks, box, (x + s * 0.03, y, ZE - 0.35), (0.04, 0.55, 0.3), name='vent_flap')
    for f in (-1, 1):                               # end frame: posts + X braces
        y = f * (LB / 2 + 0.01)
        for x in (-0.55, 0.55):
            RP(ks, box, (x, y, (ZF + ZE) / 2 + 0.1), (0.1, 0.08, ZE - ZF + 0.3), name='end_post')
        if not burnt:
            RP(ks, beam, (-HX + 0.08, y, ZF + 0.1), (-0.6, y, ZE - 0.1), 0.08, 0.06, name='end_brace', up=V((0, 1, 0)))
            RP(ks, beam, (HX - 0.08, y, ZF + 0.1), (0.6, y, ZE - 0.1), 0.08, 0.06, name='end_brace', up=V((0, 1, 0)))
    # roof
    if not burnt:
        bm = bmesh.new()
        rings = [roof_ring(-LB / 2 - 0.08, 0.07), roof_ring(LB / 2 + 0.08, 0.07)]
        top = [[p + V((0, 0, 0.05)) for p in r] for r in rings]
        vs0 = [bm.verts.new(p) for p in top[0]]
        vs1 = [bm.verts.new(p) for p in top[1]]
        for i in range(len(vs0) - 1):
            bm.faces.new((vs0[i], vs0[i + 1], vs1[i + 1], vs1[i]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.05)
        rp_(bm, 'felt', 'roof', uv='aligned')
        for yy in (-LB / 2 - 0.06, LB / 2 + 0.06):
            bm = bmesh.new()
            r0 = roof_ring(yy, 0.08, 0.02)
            for a, b in zip(r0[:-1], r0[1:]):
                C.beam_bm(bm, a, b, 0.05, 0.06)
            rp_(bm, 'steel', 'roof_barge', lod='drop')
    else:
        for yy in (-2.9, -1.05, 1.95):              # bare, sagging roof hoops
            bm = bmesh.new()
            r0 = roof_ring(yy, 0.0)
            r0 = [p - V((0, 0, 0.25 * (1 - abs(p.x) / HX) * rn.random())) for p in r0]
            for a, b in zip(r0[:-1], r0[1:]):
                C.beam_bm(bm, a, b, 0.05, 0.05)
            rp_(bm, 'steel', 'roof_hoop')


def doors(burnt):
    """Sliding doors (one per side) as nodes door_l / door_r: slide toward the rear (+Y) up to 2.0 m."""
    for s, nm in ((-1, 'door_l'), (1, 'door_r')):
        x = s * (HX + 0.09)
        kw = dict(node=nm, pivot=(x, 0.0, ZF))
        if burnt:
            if s < 0:                                 # one door fell off / hangs skewed on the bottom rail
                RP('steel', beam, (x, -0.9, ZF), (x, 0.9, ZF + 1.1), 0.05, 0.06, name='door_frame', **kw)
            continue
        RP('body', box, (x, 0.0, (ZF + ZE) / 2 - 0.02), (0.04, 2.0, ZE - ZF - 0.12), name='door_boards', **kw)
        for y in (-0.98, 0.98):
            RP('steel', box, (x + s * 0.025, y, (ZF + ZE) / 2 - 0.02), (0.05, 0.08, ZE - ZF - 0.1), name='door_stile', **kw)
        for z in (ZF + 0.08, (ZF + ZE) / 2, ZE - 0.12):
            RP('steel', box, (x + s * 0.025, 0, z), (0.05, 2.0, 0.08), name='door_rail', **kw)
        RP('steel', beam, (x + s * 0.03, -0.95, ZF + 0.12), (x + s * 0.03, 0.95, ZE - 0.16), 0.08, 0.05, name='door_brace', up=V((1, 0, 0)), **kw)
        for y in (-0.8, 0.8):
            RP('dark', cyl, (x + s * 0.05, y, ZE - 0.1), (x + s * 0.09, y, ZE - 0.1), 0.05, 8, name='door_roller', lod='drop', **kw)
        RP('dark', beam, (x + s * 0.08, -0.88, ZF + 0.9), (x + s * 0.08, -0.88, ZF + 1.4), 0.03, 0.03, name='door_handle', lod='drop', **kw)
        VH.moving(nm, 'door_slide', (x, 0.0, ZF), (0, 1, 0), limits=(0.0, 2.0), note='translate along +Z(game back) metres')
        VH.socket('%s_entry' % nm, (s * (HX + 0.7), 0.0, ZF - 1.2), (-s, 0, 0), node=None, pose='climb_in', note='ground level, rail top -0.0')


def details(burnt):
    for s in (-1, 1):
        x = s * (HX + 0.07)
        if not burnt:
            R.label_block((x, -3.0, ZF + 1.55), (s, 0, 0), 1.3, 0.36, 3)        # 'Deutsche Reichsbahn / Kassel / 47 093'
            R.label_block((x, 2.7, ZF + 0.55), (s, 0, 0), 0.7, 0.2, 2)
            R.label_block((x, 3.3, ZF + 1.5), (s, 0, 0), 0.25, 0.3, 1)         # big class letter 'G'
        for f in (-1, 1):                                                       # shunters' handrails at the corners
            y = f * (LB / 2 - 0.25)
            R.handrail([(x, y, ZF + 0.1), (x + s * 0.07, y, ZF + 0.15), (x + s * 0.07, y, ZF + 1.0), (x, y, ZF + 1.05)])
    for f in (-1, 1):                                                           # lamp brackets on the ends
        for s in (-1, 1):
            RP('dark', box, (s * 1.25, f * (LB / 2 + 0.06), 1.45), (0.08, 0.06, 0.12), name='lamp_bracket', lod='drop')
    VH.socket('cargo', (0, 0, ZF), (0, -1, 0), note='floor centre (inside); hiding place for units', capacity=6)
    VH.socket('roof_guard', (0, 1.5, ZR), (0, -1, 0), pose='sit', note='brakeman/guard on the roof')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('wagon_covered', var, pal(), seed=31, woody=('body',))
    yf, yr = R.two_axle_underframe(7.6, 4.0, 0.5, 1.22, 'frame', 'wheel', blen=0.55)
    body(burnt)
    doors(burnt)
    details(burnt)
    if var == 'winter':
        R.snow_cover(min_z=1.0, cover=0.25)
    if burnt:
        VH.emitter('smoke', (0, 0, ZF + 0.5), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('fire', (0.4, 1.0, ZF + 0.2), (0, 0, 1), when='destroyed')
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 4.0, 'wheel_d': 1.0, 'body_length': LB, 'width': WB,
            'height': ZR, 'floor': ZF, 'buffer_height': 1.06}
    R.finalize(out_root, 'wagon_covered', 'rail_wagon', dims, var, ALL, 'DR G10 covered goods wagon (Gedeckter Gueterwagen)',
               extra={'class': 'G10', 'mass_t': 10.0, 'payload_t': 15.0, 'hide_inside': True})


if __name__ == '__main__':
    R.run(main, ALL)
