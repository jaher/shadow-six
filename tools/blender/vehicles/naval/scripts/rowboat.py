# Wooden rowboat: Norwegian clinker-built faering / oselvar type (double-ended, high stems), 2 oars on thole pins.
# M7, M14, M19 (Marine rows, 2.5 m/s) + dressing in the M7 marina. blender -b ... --python rowboat.py -- wood|painted|winter|burnt|all
# Dims: L 3.9 m, B 1.40 m, depth amidships 0.70 m (keel to gunwale), draft 0.20 m light, oars 2.6 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['wood', 'painted', 'winter', 'burnt']
ST = [(-1.95, 0.02, 0.80, 0.36, 1.2), (-1.70, 0.30, 0.66, -0.08, 1.3), (-1.2, 0.58, 0.56, -0.17, 1.6),
      (-0.4, 0.70, 0.50, -0.20, 1.9), (0.4, 0.70, 0.50, -0.20, 1.9), (1.2, 0.58, 0.55, -0.17, 1.6),
      (1.70, 0.30, 0.65, -0.08, 1.3), (1.95, 0.02, 0.78, 0.35, 1.2)]
H = N.Hull(ST, res=22, m=12, lap=0.012)
PAL = {'hull': (206, 204, 194), 'trim': (52, 82, 64), 'below': (70, 44, 34), 'dark': (40, 36, 32)}
N.WOODY.update({'hull', 'trim', 'below', 'dark'})
ZF = 0.03                                   # floorboards just above the waterline (hides the water plane inside the hull)


def hull(var):
    out = 'hull' if var == 'painted' else 'wood'
    inn = 'wood' if var != 'burnt' else 'wood'
    H.shell(below_key='below' if var == 'painted' else 'tarred', above_key=out, name='hull', smooth=False)
    H.shell(below_key=inn, above_key=inn, name='hull_inner', smooth=False, inset=0.022, split=-50)
    # gunwale cap (+ painted trim strip) and stem/stern posts
    for sx in (-1, 1):
        bm = bmesh.new()
        pts = [(V((sx * s[1], s[0], s[2])), V((sx * max(0.0, s[1] - 0.05), s[0], s[2] + 0.005))) for s in H.S]
        N._strip(bm, [[a, b] if sx > 0 else [b, a] for a, b in pts])
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        np_(bm, 'trim' if var == 'painted' else 'wood', 'gunwale')
        bm = bmesh.new()
        prev = None
        for s in H.S[1:-1]:
            p = V((sx * (s[1] + 0.012), s[0], s[2] - 0.035))
            if prev:
                C.beam_bm(bm, prev, p, 0.03, 0.05)
            prev = p
        np_(bm, 'trim' if var == 'painted' else 'tarred', 'rubbing_strip')
    for y, zt, sgn in ((-1.95, 0.92, -1), (1.95, 0.90, 1)):
        bm = bmesh.new()
        C.beam_bm(bm, V((0, y - sgn * 0.25, -0.2)), V((0, y + sgn * 0.02, zt)), 0.05, 0.06)
        np_(bm, 'tarred' if var != 'painted' else 'trim', 'stem_post')
    bm = bmesh.new()
    C.beam_bm(bm, V((0, -1.7, -0.24)), V((0, 1.7, -0.24)), 0.06, 0.08)
    np_(bm, 'tarred', 'keel_below')
    VH.contact('keel', (0, 0, -0.27), width=0.06)


def interior(var):
    # floorboards (bottom boards) + ribs, 3 thwarts, stern sheets, thole pins
    for k in range(5):
        x = -0.40 + k * 0.2
        ys = [y / 50 for y in range(-100, 101) if H.hb_at(y / 50, ZF + 0.02) > abs(x) + 0.1]
        NP('planks' if var != 'burnt' else 'wood', box, (x, (ys[0] + ys[-1]) / 2, ZF), (0.17, ys[-1] - ys[0], 0.025), name='floorboard', uv_scale=0.6)
    for y in (-1.3, -0.9, -0.5, -0.1, 0.3, 0.7, 1.1, 1.5):
        bm = bmesh.new()
        s = H.at(y)
        pts = [V((-x * 0.965, y, z + 0.01)) for x, z in (H.half(s, u / 6) for u in range(7))]
        pts += [V((x * 0.965, y, z + 0.01)) for x, z in (H.half(s, u / 6) for u in reversed(range(6)))]
        for a, b in zip(pts[:-1], pts[1:]):
            if a.z > ZF or b.z > ZF:
                C.beam_bm(bm, a, b, 0.035, 0.03)
        np_(bm, 'wood', 'rib', lod='drop')
    for y, z in ((-1.05, 0.34), (0.15, 0.32), (1.2, 0.34)):
        w = H.hb_at(y, z) * 2 - 0.06
        NP('wood' if var != 'painted' else 'hull', box, (0, y, z), (w, 0.24, 0.035), name='thwart')
    for sx in (-1, 1):
        for y in (-0.30,):
            s = H.at(y)
            NP('wood', cyl, (sx * (s[1] - 0.02), y, s[2]), (sx * (s[1] - 0.02), y, s[2] + 0.16), 0.016, 6, name='thole_pin')
            NP('wood', cyl, (sx * (s[1] - 0.02), y + 0.08, s[2]), (sx * (s[1] - 0.02), y + 0.08, s[2] + 0.13), 0.013, 6, name='thole_pin')
    # bailer, rope coil, painter at the bow
    NP('wood', box, (0.3, 1.5, ZF + 0.05), (0.14, 0.2, 0.09), name='bailer', lod='drop')
    NP('rope', VH.ring_torus, (-0.15, -1.2, ZF + 0.03), 0.13, 0.025, (0, 0, 1), 12, 4, name='rope_coil', lod='drop')


def oars(var, shipped=False):
    for sx in (-1, 1):
        s = H.at(-0.26)
        piv = V((sx * (s[1] - 0.02), -0.26, s[2] + 0.07))
        n = 'oar_' + ('l' if sx > 0 else 'r')
        kw = dict(node=n, pivot=tuple(piv))
        d = V((sx * 0.94, 0.12, -0.34)).normalized() if not shipped else V((0.03 * sx, 1, 0)).normalized()
        a, b = piv - d * 0.75, piv + d * 1.55
        NP('wood', cyl, a, b, 0.024, 7, name='oar_loom', **kw)
        NP('wood', cyl, a, a - d * 0.15, 0.018, 6, name='oar_grip', **kw)
        up = d.cross(V((0, 1, 0))) if not shipped else V((1, 0, 0))
        bm = bmesh.new()
        C.beam_bm(bm, b - d * 0.05, b + d * 0.55, 0.13, 0.015, up=V((0, 0, 1)) if not shipped else V((0, 0, 1)))
        np_(bm, 'wood' if var != 'painted' else 'trim', 'oar_blade', **kw)
        NP('leather', cyl, piv - d * 0.08, piv + d * 0.1, 0.03, 7, name='oar_leather', lod='drop', **kw)
        VH.moving(n, 'oar', piv, (0, 0, 1), limits=(-35, 35), pitch_axis=VH.Gd((1, 0, 0)), pitch_limits=(-20, 25),
                  note='row cycle: sweep about local Y (yaw) + lift about local X; shipped = yaw %d deg' % (-80 * sx))
        VH.emitter('oar_splash', b + d * 0.5, (0, 0, 1), node=n)


def main(var, out_root):
    N.setup('rowboat', var, PAL, scale=0.45, seed=21)
    burnt = var == 'burnt'
    hull(var)
    interior(var)
    oars(var)
    VH.socket('rower', (0, 0.15, 0.36), (0, 1, 0), role='driver', pose='sit_row', note='rower faces aft')
    VH.socket('passenger_bow', (0, -1.05, 0.38), (0, -1, 0), pose='sit')
    VH.socket('passenger_stern', (0, 1.2, 0.38), (0, -1, 0), pose='sit')
    VH.socket('passenger_floor', (0, -0.55, ZF + 0.02), (0, -1, 0), pose='crouch')
    N.wake((0, 1.95, 0.0), (0, -1.9, 0.02), 1.3)
    if burnt:     # swamped wreck: gunwale nearly awash, heeled, one oar lost
        VH.apply_T(Matrix.Translation((0, 0, -0.34)) @ Matrix.Rotation(math.radians(9), 4, 'Y'))
    if var == 'winter':
        N.snow_cover(min_z=0.0, cover=0.2)
    dims = {'length': 3.9, 'beam': 1.40, 'depth': 0.70, 'draft': 0.20, 'freeboard': 0.50, 'oar_length': 2.6}
    N.finalize(out_root, 'rowboat', 'rowboat', dims, 0.20, var, ALL,
               'Norwegian clinker-built faering rowing boat (4 m)',
               extra={'side': 'neutral', 'water_mask_y': ZF,
                      'note': 'open boat: floorboards at y=%.2f hide the water plane inside; wreck = swamped' % ZF},
               ao_dist=0.4)


if __name__ == '__main__':
    N.run(main, ALL)
