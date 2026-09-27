# Harbour steam tug (1920s-30s North Sea/Channel type, 26 m), dressing for M13 Le Havre, M7, M12.
# blender -b ... --python tug.py -- civil|grey|winter|burnt|all  (grey = requisitioned by the Kriegsmarine)
# Dims: L 26.0 m, B 6.8 m, draft 2.9 m aft, freeboard 1.05 m aft / 2.4 m at the stem, funnel top ~9.5 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav as N
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from nav import NP, np_
import bmesh
from mathutils import Matrix

ALL = ['civil', 'grey', 'winter', 'burnt']
# pronounced sheer: bulwark top sweeps from ~1.65 m aft of midships up to 3.7 m at the stem (high bow), flared V bow
ST = [(-13.0, 0.05, 3.7, 1.6, 1.2), (-12.3, 1.5, 3.4, -1.6, 1.3), (-10.0, 2.95, 2.8, -2.4, 1.7), (-6.0, 3.4, 2.15, -2.6, 2.1),
      (0.0, 3.4, 1.8, -2.65, 2.3), (5.0, 3.35, 1.68, -2.6, 2.2), (8.0, 3.05, 1.70, -2.2, 2.0), (10.0, 2.6, 1.78, -1.0, 1.8),
      (12.2, 1.8, 2.0, -0.25, 1.7), (13.3, 0.9, 2.15, 0.45, 1.6)]
KZ = -2.95        # keel line (draft 2.9 m aft)
H = N.Hull(ST, res=28, m=10)
BW = 0.75


def pal(var):
    if var == 'burnt':      # fire-gutted: panelling charred, light paint scorched to brown-grey
        return {'boat': (60, 52, 44), 'mast': (40, 36, 32), 'hull': (30, 30, 31), 'below': (112, 42, 32), 'house': (52, 40, 30), 'super': (86, 78, 68),
                'funnel': (30, 30, 31), 'band': (84, 40, 30), 'trim': (70, 64, 56), 'dark': (38, 36, 34), 'deck': (50, 46, 42), 'boot': (30, 30, 31),
                'char': (30, 25, 21)}
    if var == 'grey':
        return dict(N.KM, house=N.KM['super'], funnel=N.KM['super'], band=(40, 42, 42), trim=N.KM['hull'], below=N.KM['below'],
                    mast=(128, 131, 131), boat=N.KM['super'])
    return {'boat': (200, 196, 186), 'mast': (176, 150, 110), 'hull': (30, 30, 31), 'below': (112, 42, 32), 'house': (170, 132, 88), 'super': (196, 192, 180), 'funnel': (30, 30, 31),
            'band': (150, 40, 32), 'trim': (190, 186, 176), 'dark': (40, 40, 40), 'deck': (70, 70, 68), 'boot': (30, 30, 31)}


def dz(y):
    return H.at(y)[2] - BW


def hull(var):
    H.shell(below_key='below', above_key='hull', name='hull', smooth=True)
    H.deck('planks', bulwark=BW, camber=0.12, name='deck', inner_key='trim', rail_w=0.12, uv_scale=0.8)
    for sx in (-1, 1):                                   # belting (heavy rubbing band) + tyre fenders
        pts = [V((sx * (H.hb_at(s[0], s[2] - 0.9) + 0.06), s[0], s[2] - 0.9)) for s in H.S[1:-1]]
        bm = bmesh.new()
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.26, 0.34)
        np_(bm, 'dark', 'belting')
        pts = [V((sx * (H.hb_at(s[0], s[2] - 0.05) + 0.05), s[0], s[2] - 0.05)) for s in H.S[1:-1]]
        bm = bmesh.new()
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.12, 0.14)
        np_(bm, 'trim', 'gunwale_strake')
        for y in (-8.0, -4.0, 0.0, 4.0, 8.0):
            x = sx * (H.hb_at(y, 1.0) + 0.25)
            NP('rubber', VH.ring_torus, (x, y, 0.9), 0.36, 0.14, (1, 0, 0), 8, 4, name='tyre_fender', lod='drop')
            NP('rope', cyl, (x * 0.97, y, 1.2), (x * 0.95, y, dz(y) + BW), 0.02, 4, name='fender_rope', lod='drop')
    # bow pudding: heavy rope fender draped round the stem head, with a 'beard' running down the stem
    bm = bmesh.new()
    arc = []
    for k in range(13):
        t = -1 + 2 * k / 12
        y = -12.2 - 1.05 * (1 - t * t)
        x = 1.35 * t
        arc.append(V((x, y + 0.02, 3.05 - 0.25 * t * t)))
    for a, b in zip(arc[:-1], arc[1:]):
        C.cyl_bm(bm, a, b, 0.34, 10)
    for k in range(6):
        a = V((0, -13.25 + 0.06 * k, 2.8 - 0.42 * k))
        b = V((0, -13.25 + 0.06 * (k + 1), 2.8 - 0.42 * (k + 1)))
        C.cyl_bm(bm, a, b, 0.3 - 0.02 * k, 10)
    np_(bm, 'net', 'bow_pudding', smooth=True)
    for k in (1, 5, 9):                                   # lashings
        NP('dark', VH.ring_torus, tuple(arc[k].lerp(arc[k + 1], 0.5)), 0.35, 0.03, tuple(arc[k + 1] - arc[k]), 10, 4, name='pudding_lashing', lod='drop')
    # bar stem, full-length keel + deep deadwood aft, propeller aperture, sole piece carrying the rudder heel bearing,
    # unbalanced rudder hung on the sternpost under the counter (stock up through the counter to the steering quadrant)
    bm = bmesh.new()
    C.beam_bm(bm, V((0, -12.35, -1.7)), V((0, -13.05, 1.6)), 0.2, 0.22)
    np_(bm, 'dark', 'stem_bar')
    G = N.stern_gear(H, KZ, -12.0, 9.55, 11.05, 12.45, t=0.34, kd=0.35, sole=0.26, blades=4, prop_key='brass', rpm=160)
    N.PROP_C = G['prop']


def gutted_wheelhouse(zc):
    """Fire-gutted wheelhouse: roof fallen in, charred corner posts and wall stumps with empty window frames,
    black interior; the wheel pedestal stands in the ash."""
    y0, hw, hl = -4.0, 1.8, 1.3
    bm = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            C.beam_bm(bm, V((sx * hw, y0 + sy * hl, zc)), V((sx * hw, y0 + sy * hl, zc + (2.25 if sx * sy > 0 else 1.6))), 0.12, 0.12)
    for k, x in enumerate((-0.74, 0.0, 0.74)):              # front window mullions (empty frames), some burnt short
        C.beam_bm(bm, V((x, y0 - hl, zc + 0.9)), V((x, y0 - hl, zc + (2.2 if k != 1 else 1.45))), 0.06, 0.06)
    C.beam_bm(bm, V((-hw, y0 - hl, zc + 0.95)), V((hw, y0 - hl, zc + 0.95)), 0.08, 0.1)      # sill rail
    np_(bm, 'soot', 'wheelhouse_frame')
    # wall stumps up to the sill, jagged tops; everything above is gone
    bm = bmesh.new()
    for (a, b) in (((-hw, y0 - hl), (hw, y0 - hl)), ((hw, y0 - hl), (hw, y0 + hl)), ((hw, y0 + hl), (-hw, y0 + hl)), ((-hw, y0 + hl), (-hw, y0 - hl))):
        a, b = V((a[0], a[1], 0)), V((b[0], b[1], 0))
        n = 7
        for k in range(n):
            p0, p1 = a.lerp(b, k / n), a.lerp(b, (k + 1) / n)
            h0 = 0.75 + 0.35 * ((k * 37) % 5) / 4
            C.quad(bm, [V((p0.x, p0.y, zc)), V((p1.x, p1.y, zc)), V((p1.x, p1.y, zc + h0 * 0.8)), V((p0.x, p0.y, zc + h0))])
    _t = N._thicken(bm, 0.06)
    np_(bm, 'char', 'wheelhouse_stumps')
    NP('black', box, (0, y0, zc + 0.03), (3.5, 2.5, 0.04), name='wheelhouse_ash', lod='drop')
    bm = bmesh.new()                                     # roof beams collapsed inside, one end still on the aft wall
    for k, x in enumerate((-1.2, -0.2, 0.9)):
        C.beam_bm(bm, V((x, y0 + hl, zc + 1.0)), V((x + 0.3, y0 - hl + 0.4, zc + 0.12 + 0.1 * k)), 0.1, 0.14)
    C.quad(bm, [V((-1.5, y0 + hl - 0.2, zc + 0.95)), V((0.6, y0 + hl - 0.2, zc + 0.9)), V((0.9, y0 - 0.2, zc + 0.3)), V((-1.3, y0 - 0.3, zc + 0.25))])
    np_(bm, 'char', 'roof_collapsed')
    NP('metal', cyl, (0, y0 - 0.6, zc), (0, y0 - 0.6, zc + 1.0), 0.09, 8, name='wheel_pedestal')
    NP('metal', VH.ring_torus, (0, y0 - 0.7, zc + 1.05), 0.35, 0.03, (0, 1, 0.3), 12, 4, name='wheel_rim_bare', lod='drop')


def topsides(var):
    burnt = var == 'burnt'
    z = dz(0.0)
    zc = z + 2.2
    # engine casing / deckhouse with skylights and doors, wheelhouse on top forward, funnel, lifeboat
    NP('house', VH.bevel_box, (0, -0.5, (z + zc) / 2), (4.4, 10.0, zc - z), 0.08, 1, name='deckhouse')
    NP('dark', box, (0, -0.5, zc + 0.04), (4.6, 10.2, 0.08), name='deckhouse_roof')
    for sx in (-1, 1):
        for y in (-3.5, -1.0, 1.5, 3.4):
            NP('brass', cyl, (sx * 2.2, y, z + 1.4), (sx * 2.24, y, z + 1.4), 0.17, 10, name='porthole', lod='drop')
            NP('glass' if not burnt else 'black', cyl, (sx * 2.22, y, z + 1.4), (sx * 2.25, y, z + 1.4), 0.13, 10, name='porthole_glass', lod='drop')
        dp = V((sx * 2.22, 2.0, z))
        n = 'door_' + ('l' if sx > 0 else 'r')
        NP('house', box, (sx * 2.25, 2.45, z + 0.95), (0.05, 0.85, 1.8), name='door', node=n, pivot=tuple(dp))
        VH.moving(n, 'door', dp, (0, 0, 1), limits=(0, 100 * sx))
    NP('super', box, (0, 2.0, zc + 0.35), (1.8, 2.2, 0.55), name='skylight')
    zw = zc + 2.3
    if not burnt:
        NP('super' if var != 'grey' else 'house', VH.bevel_box, (0, -4.0, (zc + zw) / 2), (3.6, 2.6, zw - zc), 0.06, 1, name='wheelhouse')
        NP('dark', box, (0, -4.0, zw + 0.05), (4.0, 3.0, 0.1), name='wheelhouse_roof')
        for x in (-1.1, -0.37, 0.37, 1.1):
            NP('glass', box, (x, -5.31, zc + 1.55), (0.6, 0.03, 0.75), name='window', lod='drop')
    else:
        gutted_wheelhouse(zc)
    for sx in (-1, 1):
        if not burnt:
            NP('glass', box, (sx * 1.81, -4.2, zc + 1.55), (0.03, 1.4, 0.75), name='window', lod='drop')
        if not burnt:
            N.nav_light('nav_' + ('red' if sx > 0 else 'green'), (sx * 2.1, -4.6, zc + 1.2), 'red' if sx > 0 else 'green', (sx, 0, 0))
    VH.socket('helm', (0, -4.0, zc), (0, -1, 0), role='driver', pose='stand_helm')
    # funnel (raked, band + black top), whistle, big cowl ventilators
    bm = bmesh.new()
    rk = 0.12
    rings = [[V((0.85 * math.cos(t), -0.2 + 1.1 * math.sin(t) + rk * (hz - zc), hz)) for t in (2 * math.pi * k / 16 for k in range(16))]
             for hz in (zc, zc + 3.5, zc + 6.8)]
    C.loft_bm(bm, rings, close_start=False, close_end=False)
    np_(bm, 'funnel', 'funnel', smooth=True)
    for z0, z1, key in ((zc + 5.2, zc + 5.9, 'band'), (zc + 6.3, zc + 6.85, 'dark' if var == 'grey' else 'funnel')):
        bm = bmesh.new()
        rr = [[V((0.87 * math.cos(t), -0.2 + 1.12 * math.sin(t) + rk * (hz - zc), hz)) for t in (2 * math.pi * k / 16 for k in range(16))] for hz in (z0, z1)]
        C.loft_bm(bm, rr, close_start=False, close_end=False)
        np_(bm, key, 'funnel_band', smooth=True)
    VH.emitter('funnel_smoke', (0, -0.2 + rk * 6.8, zc + 6.9), (0, 0.4, 1), kind2='coal smoke')
    ft = V((0, -0.2 + rk * 6.8, zc + 6.8))                # funnel-top rim (rolled lip) + dark inside
    bm = bmesh.new()
    rim = [ft + V((0.9 * math.cos(t), 1.15 * math.sin(t), 0.02)) for t in (2 * math.pi * k / 20 for k in range(21))]
    for a, b in zip(rim[:-1], rim[1:]):
        C.cyl_bm(bm, a, b, 0.06, 6, caps=False)
    np_(bm, 'dark', 'funnel_rim')
    NP('black', cyl, ft - V((0, 0, 0.5)), ft - V((0, 0, 0.45)), 0.8, 16, name='funnel_throat', lod='drop')
    # steam pipe up the funnel's forward face to the whistle + siren, waste-steam pipe aft
    sp0, sp1 = V((0, -1.25, zc)), V((0, -1.25 + rk * 7.3, zc + 7.3))
    NP('metal', cyl, sp0, sp1, 0.075, 8, name='steam_pipe')
    NP('metal', cyl, V((0, 0.95, zc)), V((0, 0.95 + rk * 7.1, zc + 7.1)), 0.06, 8, name='waste_steam_pipe')
    NP('brass', cyl, sp1, sp1 + V((0, 0, 0.45)), 0.1, 8, r1=0.07, name='siren')
    NP('brass', cyl, sp1 + V((0, -0.05, 0.45)), sp1 + V((0, -0.3, 0.55)), 0.09, 8, r1=0.14, name='siren_bell')
    for zz in (1.5, 3.5, 5.5):
        NP('dark', beam, (0, -1.25 + rk * zz, zc + zz), (0, -1.08 + rk * zz, zc + zz), 0.05, 0.05, name='pipe_clamp', lod='drop')
    # engine-room skylight: pitched glazed lids with protection bars
    for sx in (-1, 1):
        bm = bmesh.new()
        C.quad(bm, [V((0, 1.0, zc + 0.8)), V((0, 3.0, zc + 0.8)), V((sx * 0.9, 3.0, zc + 0.6)), V((sx * 0.9, 1.0, zc + 0.6))], flip=sx < 0)
        N._thicken(bm, 0.03)
        np_(bm, 'super' if var != 'grey' else 'house', 'skylight_lid')
        for k in range(3 if not burnt else 0):            # burnt: glazing burst, bars left over the black hole
            y = 1.25 + 0.65 * k
            NP('glass' if not burnt else 'soot', box, (sx * 0.45, y + 0.2, zc + 0.73), (0.7, 0.45, 0.02), name='skylight_glass', lod='drop')
        for k in range(5):
            y = 1.1 + 0.45 * k
            NP('brass', beam, (0, y, zc + 0.83), (sx * 0.9, y, zc + 0.63), 0.02, 0.02, name='skylight_bar', lod='drop')
    # handrail round the casing roof, ladders, lifebuoys, coal scuttles on deck
    if burnt:
        NP('black', box, (0, 2.0, zc + 0.62), (1.7, 2.0, 0.02), name='skylight_hole', lod='drop')
    for sx in (-1, 1):
        if not burnt:
            N.rail([(sx * 2.15, -2.5, zc + 0.08), (sx * 2.15, 4.4, zc + 0.08)], 0.9, 1.15, key='dark', wires=2)
        else:                                              # heat-buckled stanchions, rails sagging / gone in places
            bm = bmesh.new()
            for k, y in enumerate((-2.5, -1.35, -0.2, 0.95, 2.1, 3.25, 4.4)):
                lean = (0.35 if (k + (sx > 0)) % 3 == 0 else 0.08) * sx
                top = V((sx * 2.15 + lean, y + 0.2 * math.sin(k * 2.1), zc + 0.08 + (0.55 if k % 3 == 1 else 0.85)))
                C.cyl_bm(bm, V((sx * 2.15, y, zc + 0.08)), top, 0.022, 5)
            for a, b in ((-2.5, 0.95), (2.1, 4.4)) if sx > 0 else ((-1.35, 2.1),):
                pts = [V((sx * (2.2 + 0.1 * math.sin(t * 3)), a + (b - a) * t, zc + 0.9 - 0.45 * math.sin(math.pi * t))) for t in (k / 6 for k in range(7))]
                for p0, p1 in zip(pts[:-1], pts[1:]):
                    C.cyl_bm(bm, p0, p1, 0.02, 4)
            np_(bm, 'dark', 'rail_buckled', lod='drop')
    for sx in (-1, 1):
        bm = bmesh.new()
        for zz in [z + 0.3 * k for k in range(1, 8)]:
            C.beam_bm(bm, V((sx * 2.27, -2.35, zz)), V((sx * 2.27, -1.95, zz)), 0.03, 0.03)
        for yy in (-2.35, -1.95):
            C.beam_bm(bm, V((sx * 2.27, yy, z)), V((sx * 2.27, yy, zc + 0.9)), 0.04, 0.04)
        np_(bm, 'dark', 'ladder', lod='drop')
        N.life_ring((sx * 1.82, -3.2, zc + 1.2), (sx, 0, 0), 0.33, key='white' if not burnt else 'soot')
        for y in (-5.8, 5.8):
            NP('dark', cyl, (sx * 2.6, y, dz(y) + 0.1), (sx * 2.6, y, dz(y) + 0.13), 0.24, 12, name='coal_scuttle', lod='drop')
    NP('brass', cyl, (0, -1.1 + rk * 4.5, zc + 4.2), (0, -1.1 + rk * 4.5, zc + 5.0), 0.08, 8, name='whistle', lod='drop')
    VH.emitter('whistle_steam', (0, -1.1 + rk * 4.5, zc + 5.05), (0, 0, 1), when='scripted')
    for sx in (-1, 1):
        N.cowl_vent((sx * 1.4, 1.2, zc), 0.28, 1.6, yaw=0, key='super' if var != 'grey' else 'house')
    # lifeboat in davits on the casing roof aft
    if burnt:                                             # boat burnt out of its chocks: one davit bent over, the other cut
        for y in (3.4, 5.9):
            NP('dark', box, (0, y, zc + 0.3), (1.4, 0.2, 0.25), name='boat_chock')
        bm = bmesh.new()
        pts = [V((1.95, 2.9, zc)), V((1.95, 2.9, zc + 1.5)), V((2.4, 3.2, zc + 1.9)), V((2.9, 3.4, zc + 1.4))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.07, 8)
        C.cyl_bm(bm, V((1.95, 6.4, zc)), V((1.95, 6.4, zc + 0.9)), 0.07, 8)
        np_(bm, 'dark', 'davit_wreck')
        NP('black', box, (0, 4.6, zc + 0.12), (1.6, 3.6, 0.04), name='boat_ash', lod='drop')
    if not burnt:     # 4.6 m ship's boat on chocks on the casing roof aft, under radial davits with falls
        bm = bmesh.new()
        VH.body_loft(bm, [(2.4, 0.15, zc + 0.5, zc + 1.2, 0.1), (3.0, 0.8, zc + 0.35, zc + 1.25, 0.3), (4.8, 0.85, zc + 0.35, zc + 1.25, 0.3),
                          (5.9, 0.6, zc + 0.4, zc + 1.2, 0.2), (6.9, 0.12, zc + 0.5, zc + 1.2, 0.1)], n=2)
        np_(bm, 'boat', 'lifeboat', smooth=True)
        NP('dark', box, (0, 4.6, zc + 1.2), (1.72, 4.3, 0.06), name='lifeboat_gunwale')
        NP('canvas', box, (0, 4.6, zc + 1.26), (1.5, 3.9, 0.06), name='lifeboat_cover')
        for y in (3.4, 5.9):
            NP('dark', box, (0, y, zc + 0.3), (1.4, 0.2, 0.25), name='boat_chock')
        for y in (2.9, 6.4):
            bm = bmesh.new()
            pts = [V((1.95, y, zc)), V((1.95, y, zc + 1.9)), V((1.6, y, zc + 2.5)), V((0.9, y, zc + 2.6))]
            for a, b in zip(pts[:-1], pts[1:]):
                C.cyl_bm(bm, a, b, 0.07, 8)
            np_(bm, 'dark', 'davit')
            NP('rope', cyl, (0.9, y, zc + 2.55), (0.6, y, zc + 1.25), 0.02, 4, name='davit_fall', lod='drop')
    # foremast, towing hook, towing bows, bitts, capstan, searchlight
    mp = V((0, -8.5, dz(-8.5)))
    rake = V((0, 0.10, 1.0))                              # mast raked aft ~6 deg; buff/light so it does not draw a black line
    NP('mast' if not burnt else 'dark', cyl, mp, mp + rake * (8.0 if not burnt else 3.0), 0.085, 8, r1=0.05, name='foremast')
    if not burnt:
        NP('white', cyl, mp + rake * 6.6 + V((0, -0.12, 0)), mp + rake * 6.85 + V((0, -0.12, 0)), 0.08, 8, name='masthead_light', lod='drop')
        VH.light('masthead', mp + rake * 6.7 + V((0, -0.18, 0)), (0, -1, 0), True, kind='nav_white')
        NP('dark', cyl, mp + rake * 7.8, (0, -0.6 + 0.12 * 6.6, zc + 6.6), 0.01, 4, name='stay', lod='drop')
    hp = V((0, 6.2, dz(6.2)))
    NP('dark', cyl, hp, hp + V((0, 0, 1.3)), 0.2, 10, name='hook_post')
    NP('dark', beam, hp + V((0, 0, 1.2)), hp + V((0, 1.2, 1.1)), 0.14, 0.2, name='towing_hook', node='towing_hook', pivot=tuple(hp + V((0, 0, 1.2))))
    VH.moving('towing_hook', 'tow_hook', hp + V((0, 0, 1.2)), (0, 0, 1), limits=(-90, 90))
    VH.socket('tow_point', tuple(hp + V((0, 1.3, 1.1))), (0, 1, 0), node='towing_hook', note='tow line attach')
    for y in (8.5, 10.6):
        pts = [V((2.6 * math.cos(t), y, dz(y) + 1.6 * math.sin(t))) for t in (math.pi * k / 10 for k in range(11))]
        bm = bmesh.new()
        for a, b in zip(pts[:-1], pts[1:]):
            C.cyl_bm(bm, a, b, 0.07, 6)
        np_(bm, 'dark', 'towing_bow')
    for y in (-10.0, 11.5):
        N.bollard((0, y, dz(y)), 0.18, 0.5, 0.6, yaw=90)
    NP('dark', cyl, (0, -11.3, dz(-11.3)), (0, -11.3, dz(-11.3) + 0.7), 0.4, 12, name='capstan')
    for i, (x, y) in enumerate(((1.8, 7.5), (-1.8, 7.5), (0.0, -10.5))):
        VH.socket('crew_%d' % i, (x, y, dz(y)), (0, -1, 0), pose='stand')


def main(var, out_root):
    N.setup('harbour_tug', var, pal(var), scale=1.2, seed=81)
    N.WOODY.clear()
    zc = dz(0.0) + 2.2
    N.FIRE[:] = [(0, 0.0, dz(0.0) + 1.5, 3.2), (0, -4.0, zc + 1.0, 2.2), (0, -0.2, zc + 1.0, 1.6)] if var == 'burnt' else []
    hull(var)
    topsides(var)
    N.wake((0, 13.3, 0.0), (0, -12.8, 0.05), 6.8, prop=tuple(N.PROP_C))
    VH.emitter('fire', (0, 0.0, 3.0), (0, 0, 1), when='destroyed', note='boiler room')
    if var == 'winter':
        N.snow_cover(min_z=0.8, cover=0.34)
    if var == 'burnt':
        VH.emitter('smoke', (0, 0.0, 4.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -0.9)) @ Matrix.Rotation(math.radians(-5), 4, 'Y') @ Matrix.Rotation(math.radians(-1.5), 4, 'X'))
    dims = {'length': 26.0, 'beam': 6.8, 'draft': 2.9, 'freeboard_aft': 1.05, 'freeboard_bow': 2.4, 'funnel_top': 9.5}
    N.finalize(out_root, 'harbour_tug', 'tug', dims, 2.9, var, ALL, 'Harbour steam tug (26 m, coal-fired, 1920s-30s)',
               extra={'side': 'civilian' if var != 'grey' else 'axis', 'dressing': True}, ao_dist=1.5, lods=((0.9, 0.02), (0.36, 0.18)))


if __name__ == '__main__':
    N.run(main, ALL)
