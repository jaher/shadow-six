# Kriegsmarine Hafenschutzboot HS 114 (harbour-defence patrol boat, requisitioned motor launch, ref Bundesarchiv 101II-MW-2105-23):
# long lean low-freeboard hull, straight raked stem, sheer rising to the bow, long foredeck with the MG 34 on a shielded
# pedestal, tall pole mast well forward, low deckhouse (rubber dinghy on its roof) with a small round-fronted steering
# shelter aft, transom stern. M2/M4 river & fjord.
# blender -b --factory-startup --python patrol_boat.py -- grey|winter|burnt|all
# Dims: L 13.5, B 3.0 (L/B 4.5), draft 1.05, freeboard 0.87 aft -> 1.6 at the stem, mast 7.5 m above the deck.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['grey', 'winter', 'burnt']
ST = [(-6.75, 0.02, 1.60, 1.52, 1.2), (-6.2, 0.55, 1.50, 0.62, 1.25), (-5.4, 0.98, 1.38, -0.45, 1.5), (-4.2, 1.32, 1.24, -0.72, 1.9),
      (-2.5, 1.48, 1.10, -0.80, 2.3), (0.0, 1.50, 0.98, -0.80, 2.6), (2.5, 1.46, 0.92, -0.72, 2.8), (4.8, 1.36, 0.88, -0.45, 3.0),
      (6.3, 1.22, 0.87, -0.20, 3.2), (6.75, 1.15, 0.87, -0.10, 3.3)]
H = N.Hull(ST, res=30, m=9)
KZ = -1.05
YD0, YD1 = -1.4, 4.3          # low deckhouse
YS0, YS1 = 2.3, 3.9           # steering shelter (round front) on the aft end of the deckhouse
YM = -2.9                     # pole mast


def dz(y):
    return H.at(y)[2]


def hull(burnt):
    H.shell(below_key='below', above_key='hull', name='hull', smooth=True)
    H.deck('planks', bulwark=0.0, camber=0.06, name='deck', uv_scale=1.0)
    for sx in (-1, 1):                                          # rubbing strake + boot-top band line
        pts = [V((sx * (H.hb_at(s[0], s[2] - 0.12) + 0.03), s[0], s[2] - 0.12)) for s in H.S[1:]]
        bm = bmesh.new()
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.07, 0.09)
        np_(bm, 'dark', 'rubbing_strake')
        pts = [V((sx * (H.hb_at(s[0], s[2] - 0.01) + 0.02), s[0], s[2] - 0.01)) for s in H.S[1:]]
        bm = bmesh.new()
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.05, 0.05)
        np_(bm, 'super', 'gunwale_capping')
    bm = bmesh.new()                                            # straight raked stem bar
    C.beam_bm(bm, V((0, -5.42, -0.55)), V((0, -6.82, 1.64)), 0.1, 0.12)
    np_(bm, 'dark', 'stem_bar')
    G = N.stern_gear(H, KZ, -5.3, 4.55, 5.3, 6.05, t=0.15, kd=0.22, sole=0.08, blades=3, rpm=900)
    NP('metal', cyl, V((0, G['rudder_pivot'].y, dz(5.3))), V((0, G['rudder_pivot'].y, dz(5.3) + 0.12)), 0.05, 8, name='rudder_head',
       node='rudder', pivot=tuple(G['rudder_pivot']))
    N.PROP_C = G['prop']
    VH.contact('keel_fwd', (0, -4.0, KZ + 0.2), width=0.12)
    VH.contact('keel_aft', (0, 4.0, KZ), width=0.12)


def prism(bm, outline, z0, z1):
    """Vertical prism from a closed plan outline [(x, y)] (CCW seen from above)."""
    lo = [bm.verts.new(V((x, y, z0))) for x, y in outline]
    hi = [bm.verts.new(V((x, y, z1))) for x, y in outline]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def d_plan(y0, y1, hw, n=10, grow=0.0):
    """D-shaped plan: semicircular front at y0, straight sides/back to y1."""
    r = hw + grow
    pts = [(r * math.cos(math.pi * k / n), y0 + hw - r * math.sin(math.pi * k / n)) for k in range(n + 1)]   # +X -> -X via the front
    return pts + [(-r, y1 + grow), (r, y1 + grow)]


def house(burnt):
    zd = dz(0.0)
    zr = zd + 0.78
    bm = bmesh.new()
    VH.body_loft(bm, [(YD0, 0.80, dz(YD0) - 0.05, dz(YD0) + 0.74, 0.14), (YD0 + 0.5, 0.95, dz(YD0 + 0.5) - 0.05, zr, 0.10),
                      (YD1 - 0.3, 0.95, dz(YD1 - 0.3) - 0.05, zr, 0.10), (YD1, 0.90, dz(YD1) - 0.05, zr - 0.02, 0.10)], n=2)
    np_(bm, 'super', 'deckhouse', smooth=True)
    NP('super', box, (0, (YD0 + YD1) / 2 + 0.1, zr + 0.02), (1.84, YD1 - YD0 - 0.5, 0.05), name='deckhouse_roof')
    for y in (-0.9, 0.0, 0.9, 1.8, 3.3):                          # portholes
        for sx in (-1, 1):
            NP('brass' if not burnt else 'dark', cyl, (sx * 0.945, y, zd + 0.42), (sx * 0.975, y, zd + 0.42), 0.095, 10, name='porthole_rim', lod='drop')
            NP('glass' if not burnt else 'black', cyl, (sx * 0.95, y, zd + 0.42), (sx * 0.98, y, zd + 0.42), 0.07, 10, name='porthole', lod='drop')
    NP('super', box, (0, 1.55, zr + 0.1), (0.62, 0.56, 0.14), name='skylight')
    if not burnt:
        for sx in (-1, 1):
            NP('glass', box, (sx * 0.16, 1.55, zr + 0.175), (0.24, 0.46, 0.012), name='skylight_glass', lod='drop')
    else:
        NP('black', box, (0, 1.55, zr + 0.175), (0.5, 0.46, 0.012), name='skylight_hole', lod='drop')
    # steering shelter: D-plan, round front, window band, flat roof = open upper steering position with rail
    zs = zr + 1.02
    hw = 0.85
    bm = bmesh.new()
    prism(bm, d_plan(YS0, YS1, hw, 12), zr - 0.02, zs if not burnt else zr + 0.55)
    np_(bm, 'super', 'shelter', smooth=False)
    wz0, wz1 = zr + 0.42, zr + 0.82
    if not burnt:
        for k in range(12):                                      # window panes round the front + sides (dark glass, frames between)
            a0, a1 = math.pi * (k + 0.12) / 12, math.pi * (k + 0.88) / 12
            bm = bmesh.new()
            q = [V(((hw + 0.012) * math.cos(a), YS0 + hw - (hw + 0.012) * math.sin(a), z)) for a, z in ((a0, wz0), (a1, wz0), (a1, wz1), (a0, wz1))]
            C.quad(bm, q)
            VH.vp(bm, 'glass', 'window', lod='drop')
        for sx in (-1, 1):
            NP('glass', box, (sx * (hw + 0.012), YS0 + hw + 0.35, (wz0 + wz1) / 2), (0.012, 0.5, wz1 - wz0), name='window_side', lod='drop')
        NP('super', box, (0, (YS0 + YS1) / 2 + 0.05, zs + 0.03), (2 * hw + 0.12, YS1 - YS0 + 0.1, 0.06), name='shelter_roof')
        N.rail([(hw, YS1, zs + 0.06), (hw, YS0 + hw, zs + 0.06), (0, YS0 - 0.02, zs + 0.06), (-hw, YS0 + hw, zs + 0.06), (-hw, YS1, zs + 0.06)],
               0.85, 0.7, key='dark', wires=2)
        NP('canvas', box, (0, YS0 + 0.1, zs + 0.45), (1.2, 0.03, 0.55), name='dodger', lod='drop')
    else:
        for k in range(12):                                      # empty, blackened window openings in the burnt stump
            a = math.pi * (k + 0.5) / 12
            NP('black', box, ((hw + 0.01) * math.cos(a), YS0 + hw - (hw + 0.01) * math.sin(a), zr + 0.4), (0.18, 0.18, 0.25), name='window_hole', lod='drop')
        NP('black', box, (0, (YS0 + YS1) / 2, zr + 0.2), (2 * hw - 0.1, YS1 - YS0 - 0.1, 0.02), name='shelter_ash', lod='drop')
    dp = V((hw + 0.01, YS1 - 0.75, zr))
    NP('super', box, (hw + 0.02, YS1 - 0.45, zr + 0.45 if not burnt else zr + 0.3), (0.03, 0.55, 0.85 if not burnt else 0.5), name='door_sh',
       node='door_wheelhouse', pivot=tuple(dp))
    VH.moving('door_wheelhouse', 'door', dp, (0, 0, 1), limits=(0, 100))
    VH.steering_wheel('helm_wheel', (0, YS0 + 0.55, zr + 0.35), (0, -1, 0.35), R=0.28, spokes=8)
    VH.socket('helm', (0, YS0 + 0.95, zd), (0, -1, 0), node=None, role='driver', pose='stand_helm')
    if not burnt:
        sp = V((0, YS1 - 0.35, zs + 0.06))
        NP('dark', cyl, sp, sp + V((0, 0, 0.3)), 0.05, 8, name='searchlight_post')
        kw = dict(node='searchlight', pivot=tuple(sp))
        NP('super', cyl, sp + V((0, 0.12, 0.42)), sp + V((0, -0.22, 0.42)), 0.16, 12, name='searchlight_drum', **kw)
        NP('dark', cyl, sp + V((0, -0.22, 0.42)), sp + V((0, -0.245, 0.42)), 0.165, 12, name='searchlight_shutter', **kw)
        VH.moving('searchlight', 'gun_yaw', sp, (0, 0, 1), limits=(-180, 180), note='searchlight yaw')
        VH.light('searchlight', sp + V((0, -0.25, 0.42)), (0, -1, 0), True, kind='searchlight', node='searchlight')
        for sx, col in ((1, 'red'), (-1, 'green')):   # port (+X = left) red, starboard green
            N.nav_light('nav_' + col, (sx * (hw + 0.08), YS0 + hw + 0.2, zs - 0.15), col, (sx, 0, 0))
    return zd, zr, zs


def mast(burnt):
    mp = V((0, YM, dz(YM)))
    NP('dark', box, mp + V((0, 0, 0.2)), (0.22, 0.22, 0.4), name='mast_tabernacle')
    if burnt:                                                  # mast burnt through at the tabernacle, fallen over the side
        NP('mast' if 'mast' in N.PAL else 'dark', cyl, mp + V((0, 0, 0.35)), mp + V((1.9, 1.6, 0.9)), 0.07, 8, r1=0.055, name='mast_fallen')
        NP('dark', cyl, mp + V((1.9, 1.6, 0.9)), mp + V((3.4, 3.4, -0.2)), 0.055, 8, r1=0.04, name='mast_fallen')
        return
    top = mp + V((0, 0.25, 7.5))                               # slight rake aft
    NP('mast', cyl, mp, top, 0.075, 8, r1=0.035, name='mast')
    at = lambda h: mp.lerp(top, h / 7.5)
    NP('mast', cyl, at(5.2) + V((-1.0, 0, 0)), at(5.2) + V((1.0, 0, 0)), 0.03, 6, name='yard')
    NP('mast', cyl, at(3.0), at(3.0) + V((0, 1.6, 0.9)), 0.03, 6, name='signal_gaff')
    for p in ((0, -6.72, dz(-6.72) + 0.05),):                   # forestay to the stem head
        NP('dark', cyl, at(7.2), p, 0.007, 4, name='stay', lod='drop')
    for sx in (-1, 1):
        NP('dark', cyl, at(5.4), V((sx * (H.hb_at(YM + 0.6, dz(YM + 0.6)) - 0.02), YM + 0.6, dz(YM + 0.6) + 0.05)), 0.006, 4, name='shroud', lod='drop')
        NP('dark', cyl, at(5.2) + V((sx * 0.95, 0, 0)), V((sx * 0.3, YM + 1.8, dz(YM + 1.8) + 0.1)), 0.004, 4, name='halyard', lod='drop')
    NP('white', cyl, at(7.0), at(7.12), 0.04, 8, name='masthead_light', lod='drop')
    VH.light('masthead', at(7.06) + V((0, -0.05, 0)), (0, -1, 0), True, kind='nav_white')
    VH.emitter('pennant', at(7.5), (0, 1, 0), note='plain commissioning pennant only (no ensign, spec 10.6)')


def fittings(burnt, zd, zr):
    yb = -4.7                                                   # bow MG 34 on a shielded pedestal
    z0 = dz(yb) + 0.04
    N.pedestal((0, yb, z0), 0.98, 0.08, key='hull')
    N.mg34('mg', V((0, yb, z0 + 1.05)), 0.0, shield=True, key='hull', limits=(-150, 150))
    NP('dark', box, (0, -5.6, dz(-5.6) + 0.12), (0.42, 0.30, 0.22), name='windlass')
    NP('dark', cyl, (-0.28, -5.6, dz(-5.6) + 0.14), (0.28, -5.6, dz(-5.6) + 0.14), 0.07, 8, name='windlass_drum')
    bm = bmesh.new()
    a = V((0.32, -5.95, dz(-5.95) + 0.05))
    C.beam_bm(bm, a, a + V((0.15, -0.35, 0.0)), 0.05, 0.05)
    C.beam_bm(bm, a + V((0.15, -0.35, 0.0)), a + V((0.0, -0.36, 0.0)), 0.04, 0.04)
    C.beam_bm(bm, a + V((0.15, -0.35, 0.0)), a + V((0.27, -0.22, 0.0)), 0.04, 0.04)
    np_(bm, 'dark', 'anchor', lod='drop')
    for y in (-3.8, 5.9):
        for sx in (-1, 1):
            N.bollard((sx * (H.hb_at(y, dz(y)) - 0.25), y, dz(y)), 0.05, 0.18, 0.2, yaw=90)
    for sx in (-1, 1):                                          # guard rails fore + aft
        fwd = [(sx * (H.hb_at(y, dz(y)) - 0.06), y, dz(y)) for y in (-6.1, -5.2, -4.2, -3.2, -2.2)]
        aft = [(sx * (H.hb_at(y, dz(y)) - 0.06), y, dz(y)) for y in (4.5, 5.5, 6.6)]
        if not burnt:
            N.rail(fwd, 0.75, 0.9, wires=2)
            N.rail(aft, 0.75, 0.9, wires=2)
        else:
            N.buckled_rail(fwd, 0.75, 0.9, seed=3 + sx)
            N.buckled_rail(aft, 0.75, 0.9, seed=7 + sx)
    if not burnt:
        N.rail([(-1.05, 6.66, dz(6.66)), (1.05, 6.66, dz(6.66))], 0.75, 0.9, wires=2)
    for sx in (-1, 1):
        N.life_ring((sx * 0.975, 0.5, zd + 0.42), (sx, 0, 0), 0.26, key='white' if not burnt else 'soot')
        for y in (-3.0, 1.0, 4.4):
            x = sx * (H.hb_at(y, 0.45) + 0.08)
            N.fender((x, y, 0.35), (x, y, 0.75), 0.09)
    for sx in (-1, 1):                                          # vents, exhausts, depth charges, smoke generator
        N.cowl_vent((sx * 0.6, YD1 + 0.35, dz(YD1 + 0.35)), 0.09, 0.55, yaw=0, key='super')
        NP('metal', cyl, (sx * 0.55, YD1 - 0.2, zr), (sx * 0.55, YD1 - 0.2, zr + 0.55), 0.055, 8, name='exhaust_stack')
        VH.emitter('exhaust', (sx * 0.55, YD1 - 0.2, zr + 0.57), (0, 0.3, 1), kind2='diesel')
        for k in range(2):
            y = 5.1 + k * 0.55
            NP('dark', box, (sx * 0.78, y, dz(y) + 0.06), (0.08, 0.5, 0.06), name='dc_rail', lod='drop')
            NP('hull', cyl, (sx * 0.78 - 0.26, y, dz(y) + 0.30), (sx * 0.78 + 0.26, y, dz(y) + 0.30), 0.22, 12, name='depth_charge')
    NP('dark', cyl, (0, 6.2, dz(6.2)), (0, 6.2, dz(6.2) + 0.5), 0.14, 10, name='smoke_generator')
    VH.emitter('smoke_screen', (0, 6.2, dz(6.2) + 0.55), (0, 0.5, 1), when='scripted')
    zc = zr + 0.2                                               # Schlauchboot on chocks on the deckhouse roof, lashed down
    if not burnt:
        bm = N.oval_tube_bm(bmesh.new(), (0, 0.1, zc), 1.45, 0.62, 0.19, n=30, m=7)
        np_(bm, 'rubberfab', 'dinghy_tube', smooth=True)
        NP('rubberfab', box, (0, 0.1, zc - 0.15), (0.95, 2.6, 0.03), name='dinghy_floor')
        for y in (-0.8, 1.0):
            NP('dark', box, (0, y, zr + 0.06), (1.4, 0.12, 0.08), name='dinghy_chock')
            bm = bmesh.new()
            pts = [V((-0.86, y, zr + 0.05)), V((-0.7, y, zc + 0.14)), V((0.7, y, zc + 0.14)), V((0.86, y, zr + 0.05))]
            for a_, b_ in zip(pts[:-1], pts[1:]):
                C.beam_bm(bm, a_, b_, 0.02, 0.02)
            np_(bm, 'rope', 'lashing', lod='drop')
        NP('wood', cyl, (-0.7, -1.2, zr + 0.08), (-0.7, 2.0, zr + 0.08), 0.02, 5, name='boathook', lod='drop')
    else:                                                       # dinghy burnt to a shrivelled black skin on the chocks
        bm = N.oval_tube_bm(bmesh.new(), (0, 0.1, zr + 0.1), 1.3, 0.5, 0.08, n=24, m=5)
        for v in bm.verts:
            v.co.z -= 0.06 * abs(math.sin(v.co.y * 3.1 + v.co.x * 5.0))
        np_(bm, 'char', 'dinghy_remains')
        NP('black', box, (0.2, -0.4, zr + 0.045), (1.1, 1.4, 0.01), name='roof_burn_hole', lod='drop')
    for i, (x, y) in enumerate(((-0.7, 4.9), (0.7, 4.9), (-0.7, 5.7), (0.7, 5.7))):
        VH.socket('passenger_%d' % i, (x, y, dz(y)), (0, -1, 0), pose='stand_boat')
    VH.socket('crew_stern', (0, 6.3, dz(6.3)), (0, 1, 0), pose='stand_lookout')


def main(var, out_root):
    burnt = var == 'burnt'
    pal = dict(N.KM, mast=(118, 121, 121), char=(30, 25, 21), num=(190, 188, 180) if not burnt else (92, 90, 86))
    N.setup('patrol_boat', var, pal, scale=1.0, seed=11)
    zd = dz(0.0)
    zr = zd + 0.78
    # burnt: engine-room fire under the deckhouse spread fore and aft; the bow was raked by fire from the shelter + hit
    N.FIRE[:] = [(0, 3.1, zr + 0.4, 1.7), (0, 1.0, zd + 0.4, 1.9), (0, -1.2, zd + 0.3, 1.4), (1.4, -4.3, 0.9, 1.3),
                 (-1.4, -4.1, 0.8, 1.2), (0, 5.5, zd, 1.2)] if burnt else []
    hull(burnt)
    zd, zr, zs = house(burnt)
    mast(burnt)
    fittings(burnt, zd, zr)
    N.hull_text('HS 114', H.hb_at, -4.3, 0.55, 0.34, key='num')
    if burnt:                        # scorched paint over the number: blistered patches break the letters up
        for sx in (-1, 1):
            for k, (dy, dzz, w, h) in enumerate(((-0.55, 0.12, 0.35, 0.22), (0.1, 0.02, 0.45, 0.3), (0.62, 0.2, 0.3, 0.2))):
                y = -4.3 + dy * sx
                z = 0.55 + dzz + h / 2
                bm = bmesh.new()
                C.quad(bm, [V((sx * (H.hb_at(y + a, z + b) + 0.02), y + a, z + b)) for a, b in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))],
                       flip=sx < 0)
                VH.vp(bm, 'soot', 'scorch', lod='drop')
    N.wake((0, 6.8, 0.0), (0, -6.7, 0.02), 3.0, prop=tuple(N.PROP_C))
    VH.emitter('fire', (0, 1.2, zd + 0.9), (0, 0, 1), when='destroyed', note='engine room under the deckhouse')
    if burnt:
        VH.emitter('smoke', (0, 1.0, 2.0), (0, 0, 1), kind2='wreck_smoulder')
        # half-swamped: settled 0.5 m, listing 8 deg to starboard (-X), down by the stern 2 deg
        VH.apply_T(Matrix.Translation((0, 0, -0.5)) @ Matrix.Rotation(math.radians(8), 4, 'Y') @ Matrix.Rotation(math.radians(-2.0), 4, 'X'))
    if var == 'winter':
        N.snow_cover(min_z=0.3)
    dims = {'length': 13.5, 'beam': 3.0, 'draft': 1.05, 'freeboard_bow': 1.6, 'freeboard_stern': 0.87,
            'air_draft_mast': round(dz(YM) + 7.5, 2)}
    N.finalize(out_root, 'patrol_boat', 'patrolboat', dims, 1.05, var, ALL,
               'Kriegsmarine Hafenschutzboot HS 114 (requisitioned motor launch) with MG 34',
               extra={'gameplay_size_suggest': [13.5, 3.0], 'speed_kn_real': 11, 'crew': 5})


if __name__ == '__main__':
    N.run(main, ALL)
