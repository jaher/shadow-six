# Motor fishing cutter (Norwegian / Channel coast, 1930s-40s, KFK-like canoe stern), dressing for M7 marina, M13, M4.
# blender -b ... --python fishing_boat.py -- white|tarred|winter|burnt|all
# Dims: L 12.0 m, B 4.0 m, draft 1.5 m, freeboard 1.1 m (midships) rising to 1.9 m at the stem, mast 8 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['white', 'tarred', 'winter', 'burnt']
ST = [(-6.0, 0.04, 1.95, 1.2, 1.3), (-5.5, 0.75, 1.80, -0.55, 1.45), (-4.4, 1.55, 1.55, -1.25, 1.8), (-2.5, 1.95, 1.30, -1.4, 2.1),
      (0.0, 2.0, 1.15, -1.4, 2.3), (2.5, 1.9, 1.15, -1.3, 2.1), (4.4, 1.45, 1.25, -0.85, 1.8), (5.3, 1.0, 1.38, -0.5, 1.6),
      (6.1, 0.4, 1.55, 0.25, 1.4), (6.4, 0.05, 1.65, 0.95, 1.3)]
KZ = -1.62        # keel line (draft 1.5 m + keel shoe)
H = N.Hull(ST, res=26, m=9)
YW = 3.0          # wheelhouse centre


def pal(var):
    if var in ('tarred', 'burnt'):
        return {'hull': (26, 25, 24), 'trim': (120, 36, 28), 'house': (150, 118, 80), 'below': (70, 36, 28), 'dark': (36, 34, 32),
                'roof': (60, 58, 54)}
    return {'hull': (206, 204, 196), 'trim': (40, 84, 70), 'house': (190, 186, 172), 'below': (100, 44, 34), 'dark': (40, 40, 38),
            'roof': (120, 60, 44)}


def dz(y):
    return H.at(y)[2] - 0.45


def hull(var):
    N.WOODY.update({'hull', 'trim', 'house', 'roof', 'below'})
    H.shell(below_key='below', above_key='hull', name='hull', smooth=True)
    H.deck('planks', bulwark=0.45, camber=0.08, name='deck', inner_key='trim', rail_w=0.08, uv_scale=0.8)
    for zo, key in ((-0.10, 'trim'), (-0.75, 'dark')):     # sheer strake + rubbing strake
        for sx in (-1, 1):
            pts = [V((sx * (H.hb_at(s[0], s[2] + zo) + 0.035), s[0], s[2] + zo)) for s in H.S[1:-1]]
            bm = bmesh.new()
            for a, b in zip(pts[:-1], pts[1:]):
                C.beam_bm(bm, a, b, 0.07, 0.12)
            np_(bm, key, 'strake')
    # stem (raked, into the forefoot) + canoe-stern post; full-length keel, deadwood, prop aperture, sole piece, rudder
    bm = bmesh.new()
    C.beam_bm(bm, V((0, -5.35, -1.05)), V((0, -5.75, 0.4)), 0.14, 0.16)
    C.beam_bm(bm, V((0, -5.75, 0.4)), V((0, -6.05, 2.05)), 0.14, 0.16)
    C.beam_bm(bm, V((0, 6.1, 0.3)), V((0, 6.45, 1.75)), 0.14, 0.16)
    np_(bm, 'dark', 'stem_sternpost')
    G = N.stern_gear(H, KZ, -5.3, 4.5, 5.2, 5.85, t=0.22, kd=0.3, sole=0.14, rpm=400)
    rp = G['rudder_pivot']
    zdk = H.at(rp.y)[2] - 0.45
    NP('metal', cyl, V((0, rp.y, G['rudder_top'])), V((0, rp.y, zdk + 0.35)), 0.06, 8, name='rudder_head', node='rudder', pivot=tuple(rp))
    NP('dark', beam, (0, rp.y, zdk + 0.32), (0, rp.y - 1.0, zdk + 0.55), 0.08, 0.08, name='tiller', node='rudder', pivot=tuple(rp))


def topsides(var):
    burnt = var == 'burnt'
    z = dz(YW)
    # wheelhouse aft (planked, windows all round, door to starboard) + engine casing
    zt = z + (2.1 if not burnt else 1.3)
    NP('house', VH.bevel_box, (0, YW, (z + zt) / 2), (2.1, 1.9, zt - z), 0.04, 1, name='wheelhouse')
    if not burnt:
        NP('tarcanvas', VH.bevel_box, (0, YW, zt + 0.06), (2.4, 2.2, 0.12), 0.04, 1, name='wheelhouse_roof', uv_scale=0.6)
        for sx in (-1, 1):
            NP('dark', box, (sx * 1.2, YW, zt + 0.05), (0.06, 2.24, 0.10), name='roof_trim')
            NP('dark', box, (0, YW + sx * 1.1, zt + 0.05), (2.44, 0.06, 0.10), name='roof_trim')
    for x in (-0.55, 0.0, 0.55):
        NP('glass' if not burnt else 'soot', box, (x, YW - 0.955, z + 1.5), (0.42, 0.03, 0.5), name='window', lod='drop')
    for sx in (-1, 1):
        NP('glass' if not burnt else 'soot', box, (sx * 1.055, YW - 0.3, z + 1.5), (0.03, 0.6, 0.5), name='window', lod='drop')
    dp = V((1.055, YW + 0.05, z))
    NP('house', box, (1.07, YW + 0.45, z + 0.9), (0.04, 0.72, 1.7), name='door', node='door_wheelhouse', pivot=tuple(dp))
    VH.moving('door_wheelhouse', 'door', dp, (0, 0, 1), limits=(0, 100))
    NP('house', box, (0, YW - 1.9, z + 0.35), (1.6, 1.9, 0.7), name='engine_casing')
    NP('metal', cyl, (0.5, YW - 1.4, z + 0.7), (0.5, YW - 1.4, z + 3.2), 0.07, 8, name='exhaust_pipe')
    VH.emitter('exhaust', (0.5, YW - 1.4, z + 3.25), (0, 0, 1), kind2='hot-bulb engine (dunk-dunk)')
    VH.socket('helm', (0, YW, z), (0, -1, 0), role='driver', pose='stand_helm')
    # fish hold hatch, fish boxes, barrels, net pile, anchor, mast + boom with furled riding sail
    NP('trim', box, (0, -0.8, dz(-0.8) + 0.2), (1.5, 1.6, 0.4), name='hold_coaming')
    NP('planks', box, (0, -0.8, dz(-0.8) + 0.42), (1.4, 1.5, 0.05), name='hatch_boards', node='hatch_hold', pivot=(0, -1.55, dz(-0.8) + 0.42))
    VH.moving('hatch_hold', 'hatch', (0, -1.55, dz(-0.8) + 0.42), (1, 0, 0), limits=(0, 100))
    for i, (x, y) in enumerate(((1.2, 0.8), (1.2, 1.3), (-1.2, 0.9))):
        NP('wood', box, (x, y, dz(y) + 0.14 + (0.28 if i == 1 else 0)), (0.6, 0.42, 0.26), name='fish_box', lod='drop')
    NP('wood', cyl, (-1.25, 1.7, dz(1.7)), (-1.25, 1.7, dz(1.7) + 0.7), 0.26, 10, name='barrel', lod='drop')
    net_pile(V((0.45, -3.2, 0)), 0.95, 0.62, 0.5, burnt)
    NP('dark', box, (0, -5.2, dz(-5.2) + 0.25), (0.5, 0.35, 0.3), name='windlass')
    if not burnt:
        mp = V((0, -2.2, dz(-2.2)))
        NP('wood', cyl, mp, mp + V((0, 0, 8.0)), 0.11, 8, r1=0.06, name='mast')
        NP('wood', cyl, mp + V((0, 0, 1.4)), mp + V((0, 3.5, 1.75)), 0.06, 6, name='boom', node='boom', pivot=tuple(mp + V((0, 0, 1.4))))
        NP('canvas', cyl, mp + V((0, 0.4, 1.55)), mp + V((0, 3.3, 1.72)), 0.16, 8, name='furled_sail', node='boom', pivot=tuple(mp + V((0, 0, 1.4))))
        VH.moving('boom', 'boom', mp + V((0, 0, 1.4)), (0, 0, 1), limits=(-60, 60))
        for a in ((-1.9, -1.2), (1.9, -1.2), (0, -5.95)):
            NP('dark', cyl, mp + V((0, 0, 7.6)), (a[0], a[1] if a[0] else a[1], dz(a[1]) + (0.45 if a[0] else 1.5)), 0.008, 4, name='stay', lod='drop')
        NP('white', cyl, mp + V((0, -0.12, 5.0)), mp + V((0, -0.12, 5.2)), 0.07, 8, name='mast_lamp', lod='drop')
        VH.light('mast_lamp', mp + V((0, -0.15, 5.1)), (0, -1, 0), True, kind='nav_white')
    else:
        NP('wood', cyl, V((0, -2.2, dz(-2.2))), V((0.3, -2.0, dz(-2.2) + 2.2)), 0.1, 8, name='mast_stump')
    for sx in (-1, 1):
        for y in (-3.0, 0.5, 3.8):
            x = sx * (H.hb_at(y, 0.5) + 0.12)
            N.fender((x, y, 0.4), (x, y, 0.85), 0.1)
    for sx in (-1, 1):                                   # scuppers at the foot of the bulwark (rust bleeds below)
        for y in (-3.6, -2.0, -0.4, 1.2, 2.8, 4.2):
            x = sx * (H.hb_at(y, dz(y) + 0.1) + 0.004)
            NP('black', box, (x, y, dz(y) + 0.1), (0.03, 0.24, 0.09), name='scupper', lod='drop')
    for i, (x, y) in enumerate(((0.6, 0.2), (-0.6, 0.2))):
        VH.socket('crew_%d' % i, (x, y, dz(y)), (0, -1, 0), pose='stand')


VH.FLAT['cork'] = ((150, 112, 66), 0.9, 0.0)
VH.FLAT['glassfloat'] = ((40, 92, 70), 0.1, 0.0)


def net_pile(c, a, b, h, burnt):
    """Heaped drift net on the foredeck: lumpy folded mound (tanned netting on the hessian weave), with the cork
    head-rope snaking over it in loops, a few green glass floats and the dark foot-rope."""
    def zf(x, y):
        r2 = (x / a) ** 2 + (y / b) ** 2
        if r2 >= 1:
            return 0.0
        fold = 0.30 * (abs(math.sin(5.5 * x + 1.6 * math.sin(3.0 * y))) - 0.5) + 0.10 * math.sin(13.0 * y + 3.0 * x)   # sharp flaked folds
        return h * (1 - r2) ** 0.6 * (1 + fold + 0.25 * (N._n(V((x, y, 0)), 3.0) - 0.5))
    nu, nv = 26, 16
    bm = bmesh.new()
    grid = [[bm.verts.new(V((c.x + a * 1.02 * (2 * i / nu - 1), c.y + b * 1.02 * (2 * j / nv - 1), 0))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu + 1):
        for j in range(nv + 1):
            v = grid[i][j]
            v.co.z = dz(v.co.y) + zf(v.co.x - c.x, v.co.y - c.y) - 0.02
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(zf(v.co.x - c.x, v.co.y - c.y) <= 0 for v in f.verts)], context='FACES')
    np_(bm, 'net' if not burnt else 'wood', 'net_pile', smooth=True, uv_scale=0.35)
    if burnt:
        return
    # cork head-rope: two loops draped over the heap
    for k, (ph, amp) in enumerate(((0.0, 0.55), (1.7, 0.4))):
        pts = []
        for t in range(26):
            u = -0.95 + 1.9 * t / 25
            x, y = u * a, (amp * math.sin(3.2 * u + ph) - 0.15 + 0.3 * k) * b
            pts.append(V((c.x + x, c.y + y, dz(c.y + y) + zf(x, y) + 0.03)))
        bm = bmesh.new()
        for p0, p1 in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, p0, p1, 0.016, 5, caps=False)
        np_(bm, 'dark', 'float_rope', lod='drop')
        bm = bmesh.new()
        for p0, p1 in zip(pts[2:-2:3], pts[3::3]):            # flat oval cork floats threaded on the head-rope
            d = (p1 - p0).normalized() * 0.03
            C.cyl_bm(bm, p0 - d, p0 + d, 0.055, 8)
        VH.vp(bm, 'cork', 'cork_floats', lod='drop2')
    for x, y in ((0.55, 0.35),):
        bm = bmesh.new()
        q = V((c.x + x * a, c.y + y * b, dz(c.y + y * b) + zf(x * a, y * b) + 0.03))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.1, matrix=Matrix.Translation(q))
        VH.vp(bm, 'glassfloat', 'glass_float', smooth=True, lod='drop')


def main(var, out_root):
    N.setup('fishing_boat', var, pal(var), scale=0.8, seed=71)
    N.FIRE[:] = [(0, YW, dz(YW) + 1.0, 1.7), (0, YW - 1.9, dz(YW) + 0.4, 1.4)] if var == 'burnt' else []
    hull(var)
    topsides(var)
    N.wake((0, 6.4, 0.0), (0, -5.95, 0.05), 4.0, prop=(0, 4.85, -1.1))
    VH.emitter('fire', (0, 2.0, 1.4), (0, 0, 1), when='destroyed')
    if var == 'winter':
        N.snow_cover(min_z=0.4, cover=0.22)
    if var == 'burnt':
        VH.emitter('smoke', (0, 2.0, 2.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -0.55)) @ Matrix.Rotation(math.radians(6), 4, 'Y') @ Matrix.Rotation(math.radians(-2.0), 4, 'X'))
    dims = {'length': 12.0, 'beam': 4.0, 'draft': 1.5, 'freeboard': 1.15, 'mast_height': 8.0}
    N.finalize(out_root, 'fishing_boat', 'fishing_boat', dims, 1.5, var, ALL, 'Motor fishing cutter (Norwegian / Channel coast)',
               extra={'side': 'civilian', 'dressing': True}, ao_dist=1.0)


if __name__ == '__main__':
    N.run(main, ALL)
