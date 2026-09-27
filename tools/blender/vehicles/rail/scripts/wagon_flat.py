# DR R10 stake wagon (Rungenwagen, flat) with a military load: tarpaulined crate stack + ammunition boxes (node 'load').
# blender -b ... --python wagon_flat.py -- brown|winter|burnt|all
# Dims: LuP 10.8 m, wheelbase 6.0 m, wheels 1.0 m, deck 9.3 x 2.77 m at 1.25 m, stakes 1.0 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh

ALL = ['brown', 'winter', 'burnt']
LB, WB, ZF = 9.3, 2.77, 1.25
HX = WB / 2


def pal():
    return dict(R.DR, body=R.DR['brown'], wheel=R.DR['dark'], white=(200, 196, 186), crate=(92, 84, 60), crate_g=(70, 72, 60))


def deck(burnt):
    RP('planks' if not burnt else 'boards', box, (0, 0, ZF - 0.04), (WB, LB, 0.08), name='deck', uv='beam', axis=(0, 1, 0))
    for s in (-1, 1):
        x = s * (HX + 0.02)
        RP('frame', box, (x, 0, ZF - 0.12), (0.06, LB, 0.2), name='deck_edge')
        for k, y in enumerate((-3.9, -2.35, -0.8, 0.8, 2.35, 3.9)):
            RP('frame', box, (x + s * 0.06, y, ZF - 0.12), (0.1, 0.16, 0.16), name='stake_pocket', lod='drop')
            tilt = 0.12 * (1 if (burnt and k % 2) else 0)
            RP('wood' if not burnt else 'boards', beam, (x + s * 0.06, y, ZF - 0.2), (x + s * (0.06 + tilt), y, ZF + 1.0), 0.1, 0.1, name='stake')
        if not burnt:
            R.label_block((x + s * 0.04, -3.2, ZF - 0.12), (s, 0, 0), 1.2, 0.14, 1)
    for f in (-1, 1):
        RP('wood' if not burnt else 'boards', box, (0, f * (LB / 2 - 0.03), ZF + 0.2), (WB, 0.06, 0.4), name='end_board')
        RP('dark', box, (0, f * (LB / 2 - 0.01), ZF + 0.2), (WB, 0.08, 0.05), name='end_board_strap', lod='drop')


def crate(c, size, key='crate', node='load', rope=False):
    RP(key, box, c, size, name='crate', node=node)
    x, y, z = c
    for dy in (-size[1] / 2 + 0.06, size[1] / 2 - 0.06):          # end battens
        RP(key, box, (x, y + dy, z), (size[0] + 0.02, 0.06, size[2] + 0.02), name='crate_batten', node=node, lod='drop')
    if rope:
        RP('rope', cyl, (x - size[0] / 2 - 0.01, y, z + size[2] / 2 + 0.01), (x + size[0] / 2 + 0.01, y, z + size[2] / 2 + 0.01), 0.015, 5, name='rope', node=node, lod='drop')


def load(var, burnt):
    """Tarpaulin-covered crate stack (front half) + open stacks of ammunition boxes (rear) lashed to the stakes."""
    rn = C.rng()
    if burnt:
        for i in range(5):
            RP('boards', box, (rn.uniform(-0.9, 0.9), rn.uniform(0.5, 3.8), ZF + 0.1), (0.7, 0.5, 0.2), name='charred_crate', node='load')
        return
    # tarp over a 2.3 x 4.0 x 1.4 stack: lofted sections with sag between ropes
    bm = bmesh.new()
    rings = []
    for j in range(9):
        y = -4.2 + 4.0 * j / 8
        sag = 0.05 if j % 2 else 0.0
        ring = []
        for i in range(9):
            t = i / 8
            a = math.pi * t
            x = -1.2 * math.cos(a) * (1.0 if 0.1 < t < 0.9 else 1.05)
            z = ZF + 0.02 + (1.45 - sag) * min(1.0, math.sin(a) * 2.2) - 0.08 * abs(math.cos(a)) ** 6
            ring.append(V((x, y, z)))
        rings.append(ring)
    C.loft_bm(bm, rings, False, False, closed=False)
    for r in (rings[0], rings[-1]):                              # tarp end flaps (closed ends)
        vs = [bm.verts.new(p) for p in r] + [bm.verts.new(V((r[-1].x, r[-1].y, ZF + 0.02))), bm.verts.new(V((r[0].x, r[0].y, ZF + 0.02)))]
        bm.faces.new(vs)
    rp_(bm, 'tarp', 'tarpaulin', node='load', uv='aligned')
    for y in (-3.7, -2.7, -1.7, -0.7):
        bm = bmesh.new()
        pts = [V((-1.38, y, ZF + 0.3)), V((-1.24, y, ZF + 1.2)), V((-0.9, y, ZF + 1.5)), V((0.9, y, ZF + 1.5)), V((1.24, y, ZF + 1.2)), V((1.38, y, ZF + 0.3))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.014, 5)
        rp_(bm, 'rope', 'lashing', node='load', lod='drop')
    # ammunition boxes (dunkelgrau / field grey) in rows, rear half
    for r_, y in enumerate((0.4, 1.2, 2.0, 2.8, 3.6)):
        for i, x in enumerate((-0.85, 0.0, 0.85)):
            nz = 2 if (i + r_) % 3 else 3
            for k in range(nz):
                crate((x, y, ZF + 0.16 + k * 0.32), (0.8, 0.62, 0.3), 'crate_g' if (i + k) % 2 else 'crate', rope=(k == nz - 1))
    VH.VM['toggles']['load'] = {'default': True, 'note': 'military load (hide = empty flat)'}


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('wagon_flat', var, pal(), seed=41)
    yf, yr = R.two_axle_underframe(9.3, 6.0, 0.5, 1.13, 'frame', 'wheel', blen=0.62)
    deck(burnt)
    load(var, burnt)
    if burnt:
        VH.emitter('smoke', (0, 1.5, ZF + 0.4), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('fire', (0, -2.0, ZF + 0.2), (0, 0, 1), when='destroyed', note='ammunition cook-off')
    if var == 'winter':
        R.snow_cover(min_z=1.0, cover=0.2)
    VH.socket('cargo', (0, 1.5, ZF), (0, -1, 0), note='deck (cover between the load stacks)', capacity=4)
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 6.0, 'wheel_d': 1.0, 'deck_length': LB, 'width': WB,
            'height_loaded': round(ZF + 1.5, 3), 'floor': ZF, 'buffer_height': 1.06}
    R.finalize(out_root, 'wagon_flat', 'rail_wagon', dims, var, ALL, 'DR R10 stake wagon (Rungenwagen) with military load',
               extra={'class': 'R10', 'mass_t': 11.5, 'payload_t': 15.0})


if __name__ == '__main__':
    R.run(main, ALL)
