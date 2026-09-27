"""M4 fjord-inlet railway bridge: tall timber trestle approaches (4-post bents, two tiers of sway bracing, girts,
caps, sills on granite pedestals above the tide line) and a riveted deck plate-girder main span on two battered
granite pillars with cutwaters (iron ladder on the east pillar: refuge from trains / access to the water).
Single track: sleepers, rails with tie plates, guard timbers, plank walkway + handrail, refuge bays with water
barrels. Variants: bridge_rail_trestle | bridge_rail_trestle_snow."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V, part, box_bm, beam_bm, cyl_bm
import bmesh, math
import kit_weather as W
import brfix as F
import brfix2 as F2
part = F.part
from kit_bridge import plate_girder, ibeam_bm

a = BL.args()
name = a[0] if a else 'bridge_rail_trestle'
snow = name.endswith('_snow')
WATER, BED, ZR = -8.0, -10.5, 0.8           # ZR = top of sleepers
PED = WATER + 0.9                          # pedestal top
F.TIDE_PALE = 0.5
if snow:
    F2.snow_mode()
K.begin(name, 4, theater='snow' if snow else 'frost', snow=snow, water_level=WATER)
r = K.rng()
XE = 30.0                                  # abutment faces at +-XE
XP = 7.0                                   # pillar centres at +-XP, main span between
PW = 2.4
ZCAP = ZR - 2.41                           # top of the pillar coping (bearing seats)
F2.AO_GROUND.update({'banks': (-XE, XE), 'water': WATER})
bents = [-XE + 3.8 * (i + 1) for i in range(5)]
bents = [b for b in bents if b < -XP - PW / 2 - 1.2]
bents = bents + [-b for b in reversed(bents)]
ZC = ZR - 0.62                              # top of bent caps (stringers + tie on top)
bm, ped = bmesh.new(), bmesh.new()
for x in bents:
    H = ZC - PED
    bat = 0.1 * H
    tops = [-1.25, -0.42, 0.42, 1.25]
    bots = [tops[0] - bat, tops[1], tops[2], tops[3] + bat]
    for yt, yb in zip(tops, bots):
        beam_bm(bm, (x, yb, PED), (x, yt, ZC - 0.15), 0.3, 0.3)
    beam_bm(bm, (x, -1.7, ZC - 0.15), (x, 1.7, ZC - 0.15), 0.34, 0.3)
    beam_bm(bm, (x, bots[0] - 0.35, PED + 0.15), (x, bots[3] + 0.35, PED + 0.15), 0.34, 0.3)
    yat = lambda z: (tops[0] - bat * (1 - (z - PED) / H), tops[3] + bat * (1 - (z - PED) / H))
    lv = 2
    for k in range(lv):
        za, zb = PED + 0.3 + (H - 0.6) * k / lv, PED + 0.3 + (H - 0.6) * (k + 1) / lv
        (l0, r0), (l1, r1) = yat(za), yat(zb)
        for s in (-1, 1):
            xo = x + s * 0.21
            beam_bm(bm, (xo, l0, za), (xo, r1, zb), 0.08, 0.24, up=(1, 0, 0))
            beam_bm(bm, (xo, r0, za), (xo, l1, zb), 0.08, 0.24, up=(1, 0, 0))
        if k > 0:
            for s in (-1, 1):
                beam_bm(bm, (x + s * 0.21, l0 - 0.2, za), (x + s * 0.21, r0 + 0.2, za), 0.08, 0.24, up=(1, 0, 0))
    box_bm(ped, (x, 0, (BED + PED) / 2 - 0.1), (1.0, 3.8 + 2 * bat, PED - BED + 0.2), taper=None)
    BL.water_obstacle([(x - 0.5, -1.9 - bat), (x + 0.5, -1.9 - bat), (x + 0.5, 1.9 + bat), (x - 0.5, 1.9 + bat)], 'bent', 1.0)
# longitudinal sway bracing between bents (tower pairs) at mid height
for x0, x1 in zip(bents[:-1], bents[1:]):
    if x1 - x0 > 5:
        continue
    for yy in (-0.42, 0.42):
        zm = (PED + ZC) / 2
        beam_bm(bm, (x0 + 0.2, yy, zm - 1.2), (x1 - 0.2, yy, zm + 1.2), 0.08, 0.2, up=(0, 1, 0))
        beam_bm(bm, (x0 + 0.2, yy, zm + 1.2), (x1 - 0.2, yy, zm - 1.2), 0.08, 0.2, up=(0, 1, 0))
part(bm, 'timber_tarred', name='bents', uv='beam', axis=(0, 0, 1), grime=0.9, tint=(0.95, 0.92, 0.88))
part(ped, 'granite', name='pedestals')
# granite pillars (battered, cutwaters, coping) carrying the plate-girder span
for i, px in enumerate((-XP, XP)):
    bm = bmesh.new()
    lo = BL.pier_outline(px, PW + 0.6, 4.6, 1.8)
    hi = BL.pier_outline(px, PW, 3.6, 1.2)
    rings = [[(x, y, BED) for x, y in lo], [(x, y, ZCAP - 0.28) for x, y in hi]]
    if len(lo) == len(hi):
        C.loft_bm(bm, [[V(p) for p in rg] for rg in rings])
    part(bm, 'granite_dark', name='pillar%d' % i)
    bm = bmesh.new()
    box_bm(bm, (px, 0, ZCAP - 0.14), (PW + 0.5, 4.2, 0.28))
    part(bm, 'granite', name='pillar_cap%d' % i)
    bm = bmesh.new()                                     # back wall: carries the timber approach stringers
    so = -1 if px < 0 else 1
    box_bm(bm, (px + so * 0.65, 0, (ZCAP + ZC - 0.2) / 2), (1.0, 3.4, ZC - 0.2 - ZCAP))
    box_bm(bm, (px + so * 0.65, 0, ZC - 0.13), (1.2, 3.8, 0.16))
    part(bm, 'granite_dark', name='pillar_back%d' % i)
    BL.water_obstacle(lo, 'pier', 0.8)
    F.riprap_ring(BL.pier_outline(px, PW + 0.75, 4.75, 1.9), WATER, n=16, smin=0.4, smax=0.75, name='riprap%d' % i)
    for s in (-1, 1):
        W.decal('streak_rust', (px + 0.6, s * 1.85, ZR - 3.0), (0, s, 0), 0.6, 2.0, alpha=0.5)
BL.iron_ladder(XP + PW / 2 + 0.05, 0.6, WATER + 0.1, ZR - 2.15, (1, 0, 0), top_pos=(XP + PW / 2 + 0.3, 1.8, ZR))
# deck plate girders: web + flanges + cover plates, stiffener angles with rivet rows (camera side), bearing shoes
GT = (0.46, 0.5, 0.47)
bm, rv = bmesh.new(), bmesh.new()
for s in (-1, 1):
    y, zt, dp = s * 0.95, ZR - 0.62, 1.25
    ibeam_bm(bm, (-XP + 0.2, y, zt - dp / 2), (XP - 0.2, y, zt - dp / 2), dp, 0.42, 0.018, 0.035)
    C.box_bm(bm, (0, y, zt + 0.012), (2 * XP - 1.6, 0.46, 0.024))
    C.box_bm(bm, (0, y, zt - dp - 0.012), (2 * XP - 1.6, 0.46, 0.024))
    nst = 12
    for k in range(nst + 1):
        x = -XP + 0.25 + (2 * XP - 0.5) * k / nst
        for sd in (-1, 1):                              # angle stiffeners: plate + outstanding leg (T), clear of the web
            C.box_bm(bm, (x, y + sd * 0.1, zt - dp / 2), (0.022, 0.18, dp - 0.08))
            C.box_bm(bm, (x, y + sd * 0.19, zt - dp / 2), (0.12, 0.018, dp - 0.08))
        F.rivet_row(rv, (x + 0.07, y - 0.13, zt - dp + 0.1), (x + 0.07, y - 0.13, zt - 0.1), (0, -1, 0), 0.16)
    for zz in (zt - 0.05, zt - dp + 0.05):
        F.rivet_row(rv, (-XP + 0.2, y - 0.03, zz), (XP - 0.2, y - 0.03, zz), (0, -1, 0), 0.22)
part(bm, 'steel_painted', name='girders', uv='aligned', tint=GT, grime=0.7, bisect=False)
part(rv, 'steel_painted', name='girder_rivets', tint=tuple(c * 0.8 for c in GT), grime=0.4, bisect=False, lod='drop')
bm, bs = bmesh.new(), bmesh.new()
ZGB = ZR - 0.62 - 1.25 - 0.024                       # girder soffit
for px in (-XP, XP):
    for s in (-1, 1):
        x, y = px - math.copysign(0.3, px), s * 0.95
        C.box_bm(bs, (x, y, ZCAP + 0.07), (1.0, 0.9, 0.14))                     # dressed granite bed stone
        C.box_bm(bm, (x, y, ZCAP + 0.165), (0.82, 0.72, 0.05))                  # cast masonry plate
        for dx in (-0.33, 0.33):                                                # anchor bolts + nuts
            for dy in (-0.28, 0.28):
                cyl_bm(bm, (x + dx, y + dy, ZCAP + 0.19), (x + dx, y + dy, ZCAP + 0.25), 0.035, 6)
        zr0, zr1 = ZCAP + 0.19, ZGB - 0.09                                      # rocker: curved foot, flat head
        R = 0.34
        ring = [(x + R * math.sin(a), zr0 + R * (1 - math.cos(a))) for a in [math.radians(-38 + 76 * i / 8) for i in range(9)]]
        ring = ring + [(x + 0.15, zr1 - 0.04), (x + 0.07, zr1), (x - 0.07, zr1), (x - 0.15, zr1 - 0.04)]
        va = [bm.verts.new((px_, y - 0.26, pz)) for px_, pz in ring]
        vb = [bm.verts.new((px_, y + 0.26, pz)) for px_, pz in ring]
        bm.faces.new(va)
        bm.faces.new(list(reversed(vb)))
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            bm.faces.new((va[i], va[j], vb[j], vb[i]))
        cyl_bm(bm, (x, y - 0.36, zr1 + 0.01), (x, y + 0.36, zr1 + 0.01), 0.065, 10)     # pin
        for sd in (-1, 1):
            cyl_bm(bm, (x, y + sd * 0.36, zr1 + 0.01), (x, y + sd * 0.42, zr1 + 0.01), 0.09, 6)   # pin nuts
        C.box_bm(bm, (x, y, ZGB - 0.045), (0.62, 0.56, 0.09))                    # sole plate under the girder
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
part(bm, 'cast_iron', name='bearing_shoes', grime=0.3, bisect=False, mat_tint=(0.78, 0.76, 0.72))
part(bs, 'granite', name='bearing_stones', bisect=False)
for px in (-XP, XP):
    for s in (-1, 1):
        W.decal('streak_rust', (px - math.copysign(0.3, px) + s * 0.6, -2.12, ZR - 3.0), (0, -1, 0), 0.7, 1.8, alpha=0.55)
bm = bmesh.new()
for k in range(5):
    x = -XP + 0.6 + (2 * XP - 1.2) * k / 4
    beam_bm(bm, (x, -0.9, ZR - 1.7), (x, 0.9, ZR - 0.75), 0.08, 0.08)
    beam_bm(bm, (x, 0.9, ZR - 1.7), (x, -0.9, ZR - 0.75), 0.08, 0.08)
part(bm, 'steel_painted', name='cross_frames', uv='aligned', tint=(0.46, 0.5, 0.47))
# stringers on the timber approaches
bm = bmesh.new()
for x0, x1 in ((-XE, -XP + PW / 2), (XP - PW / 2, XE)):
    for yy in (-0.95, -0.55, 0.55, 0.95):
        beam_bm(bm, (x0, yy, ZC + 0.02), (x1, yy, ZC + 0.02), 0.22, 0.36)
part(bm, 'timber_beam', name='stringers', uv='beam', axis=(1, 0, 0))
# track: sleepers, guard timbers, rails, walkway + handrail
bm = bmesh.new()
n = int((2 * XE + 8) / 0.6)
for k in range(n):
    x = -XE - 4 + (k + 0.5) * 0.6
    box_bm(bm, (x, 0.35 + r.uniform(-0.03, 0.03), ZR - 0.1), (0.24, 3.3 if abs(x) < XE else 2.6, 0.2))
part(bm, 'timber_tarred', name='sleepers', uv='beam', axis=(0, 1, 0), grime=0.9, bisect=False)
bm = bmesh.new()
for yy in (-1.15, 1.15):
    beam_bm(bm, (-XE, yy, ZR + 0.07), (XE, yy, ZR + 0.07), 0.2, 0.15)
walk = bmesh.new()
box_bm(walk, (0, 1.65 + 0.35, ZR + 0.03), (2 * XE, 0.9, 0.06))
part(walk, 'deck_planks', name='walkway', uv='beam', axis=(0, 1, 0), grime=0.6, bisect=False)
part(bm, 'timber_grey', name='guard_timbers', uv='beam', axis=(1, 0, 0))
bm = bmesh.new()
for yy in (-0.72, 0.72):
    ibeam_bm(bm, (-XE - 4, yy, ZR + 0.08), (XE + 4, yy, ZR + 0.08), 0.15, 0.12, 0.018, 0.035)
part(bm, 'steel_galv', name='rails', uv='beam', axis=(1, 0, 0), tint=(0.55, 0.5, 0.45), grime=0.6, bisect=False, lod='keep')
from kit_detail import railing
F.period_railing((-XE, 2.4, ZR), (XE, 2.4, ZR), 1.0, 2.4, 'timber_grey', (0.8, 0.78, 0.74), name='handrail', style='flat', post=0.1)
# refuge bays with water barrels (on outriggers at the second bent from each end)
for x in (bents[1], bents[-2]):
    bm = bmesh.new()
    box_bm(bm, (x, -2.4, ZR - 0.05), (2.0, 1.6, 0.08))
    for dx in (-0.8, 0.8):
        beam_bm(bm, (x + dx, -1.2, ZR - 1.5), (x + dx, -3.1, ZR - 0.12), 0.14, 0.14)
    part(bm, 'deck_planks', name='refuge', uv='beam', axis=(1, 0, 0))
    bm = bmesh.new()
    cyl_bm(bm, (x - 0.45, -2.5, ZR), (x - 0.45, -2.5, ZR + 0.9), 0.3, 10, r1=0.28)
    part(bm, 'timber_tarred', name='water_barrel', smooth=True)
    railing((x - 1.0, -3.15, ZR), (x + 1.0, -3.15, ZR), 1.0, 'timber', name='refuge_rail')
    C.anchor('refuge', (x, -2.4, ZR), kind='train_refuge')
# stone abutments into the banks
for side in (-1, 1):
    xe = side * XE
    bm = bmesh.new()
    box_bm(bm, (xe + side * 2.0, 0, (BED + ZR - 0.3) / 2), (4.0, 5.2, ZR - 0.3 - BED))
    part(bm, 'fieldstone_grey', name='abut%d' % side)
    bm = bmesh.new()
    box_bm(bm, (xe + side * 0.3, 0, ZR - 0.27), (0.8, 5.4, 0.14))
    part(bm, 'granite', name='abut_seat%d' % side)
    BL.water_obstacle([(xe, -2.6), (xe + side * 4, -2.6), (xe + side * 4, 2.6), (xe, 2.6)], 'abutment', 0.5)
    bm = bmesh.new()                                         # ballast shoulder on the bank
    box_bm(bm, (xe + side * 4.0, 0.35, ZR - 0.35), (8.0, 3.6, 0.5), taper=None)
    part(bm, 'gravel', name='ballast%d' % side, bisect=False)
K.bridge_meta(K.Deck(-XE - 4, XE + 4, ZR, 0.0), -XE - 4, XE + 4, 3.0, WATER, 2 * XE,
              {'kind': 'rail_trestle', 'rail': True, 'track_y': [-0.72, 0.72], 'bents': bents, 'piers': [-XP, XP], 'deck_z': ZR})
C.anchor('train_path', (-XE - 4, 0, ZR + 0.15), (1, 0, 0), kind='rail', end=[round(XE + 4, 3), round(ZR + 0.15, 3), 0.0])
if snow:
    caps = [o for o in C.A.parts if o.name.startswith(('bents', 'pedestals', 'pillar', 'guard_timbers', 'handrail', 'stringers',
                                                        'refuge', 'water_barrel', 'abut', 'girders'))]
    F2.pillow(F.snow_caps(caps, thick=0.09, min_nz=0.35), lift=0.05, over=0.03)
    F.road_snow(lambda x: ZR - 0.02, -XE - 4, XE + 4, 2.5, crown=0.0, ruts=(-0.72, 0.72), rut_w=0.16, base=0.09, drift=0.12)
    for x in bents:
        F2.ice_col(F.ice_shelf([(x - 0.6, -2.3), (x + 0.6, -2.3), (x + 0.6, 2.3), (x - 0.6, 2.3)], WATER, reach=(0.5, 1.4), thick=0.16, name='ice_ped'))
    for px in (-XP, XP):
        F2.ice_col(F.ice_shelf(BL.pier_outline(px, PW + 0.75, 4.75, 1.9), WATER, reach=(0.8, 2.2), thick=0.18, name='ice_pillar',
                    floes=4, bounds=(-XE + 3, -12, XE - 3, 12)))
    ic = [(x + r.uniform(-0.2, 0.2), s * 1.7, ZC - 0.3) for x in bents for s in (-1, 1)]
    ic += [(x, -0.95 - 0.2, ZR - 1.9) for x in [-XP + 1 + k * (2 * XP - 2) / 9 for k in range(10)]]
    F.icicles(ic, (0.15, 0.6))
F.weather(theme='temperate', step=2.0, lichen=0.5, moss=0.5)
F.weather(mids=('timber_tarred', 'timber_grey', 'timber_beam', 'steel_painted'), theme='temperate', step=99, lichen=0.2, moss=0.4,
          base=0.95, skip=('decal', 'snow', 'ice', 'icicles'))
F2.cull_decals()
C.A.meta['review'] = {'detail': {'target': [round(XP - 0.3, 2), round(ZCAP + 0.3, 2), 0.95], 'dir': [-0.3, 0.32, 0.9], 'dist': 7.5}}
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
