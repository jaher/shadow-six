"""Timber jetties / piers on pile bents. Local convention: shoreline along Y at x=0 (land x>0), jetty runs out
along -X over the water; pivot = root of the jetty on the shoreline, deck top at ZD above bank level.
Round piles (tarred, algae band at the waterline), cap beams, X cross-bracing between piles, stringers, transverse
deck planks with gaps, rub rails, fender piles, timber bollards + iron cleats, iron ladder at the head, lamp,
barrels/crate. Variants: jetty_timber_small (M1, 2.6x8 m) | jetty_timber_small_snow | pier_timber_t (M4 HQ pier,
T-head, lamp) | pier_timber_t_snow."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V, part, box_bm, beam_bm, cyl_bm
import bmesh
import kit_weather as W
from kit_bridge import deck_planks, lamp_post

a = BL.args()
name = a[0] if a else 'jetty_timber_small'
snow = name.endswith('_snow')
big = name.startswith('pier_timber_t')
WATER, BED, ZD = -1.4, -4.2, 0.25
K.begin(name, 12 if big else 11, theater='snow' if snow else 'frost', snow=snow, water_level=WATER)
r = K.rng()
if big:
    rects = [(-22.0, 0.0, -1.8, 1.8), (-27.0, -22.0, -5.5, 5.5)]      # (x0, x1, y0, y1) walkway + T-head
else:
    rects = [(-8.0, 0.0, -1.3, 1.3)]
piles, bm_p, bm_c, bm_x = [], bmesh.new(), bmesh.new(), bmesh.new()
for x0, x1, y0, y1 in rects:
    nb = max(1, round((x1 - x0) / 2.4))
    ny = max(1, math.ceil((y1 - y0) / 2.3))
    for i in range(nb + 1):
        x = x0 + 0.2 + (x1 - x0 - 0.4) * i / nb
        if big and x0 == rects[0][0] and i == 0:
            continue                                                  # walkway meets the head
        ys = [y0 + 0.15 + (y1 - y0 - 0.3) * j / ny for j in range(ny + 1)]
        for y in ys:
            lean = r.uniform(-0.04, 0.04)
            cyl_bm(bm_p, (x + lean, y + r.uniform(-0.03, 0.03), BED), (x, y, ZD - 0.28), 0.15, 8, r1=0.14)
            piles.append((x, y))
        beam_bm(bm_c, (x, y0 - 0.05, ZD - 0.4), (x, y1 + 0.05, ZD - 0.4), 0.26, 0.24)                  # cap
        for ya, yb in zip(ys[:-1], ys[1:]):                                                       # X bracing
            for s in (-1, 1):
                xo = x + s * 0.17
                beam_bm(bm_x, (xo, ya, WATER - 0.2), (xo, yb, ZD - 0.55), 0.06, 0.18, up=(1, 0, 0))
            beam_bm(bm_x, (x + 0.17, yb, WATER - 0.2), (x + 0.17, ya, ZD - 0.55), 0.06, 0.18, up=(1, 0, 0))
    for y in (y0 + 0.3, (y0 + y1) / 2, y1 - 0.3) if (y1 - y0) < 4 else [y0 + 0.3 + (y1 - y0 - 0.6) * k / 4 for k in range(5)]:
        beam_bm(bm_c, (x0, y, ZD - 0.2), (x1, y, ZD - 0.2), 0.18, 0.2)                            # stringers
part(bm_p, 'timber_tarred', name='piles', uv='beam', axis=(0, 0, 1), grime=1.0, smooth=True)
part(bm_c, 'timber_beam', name='caps_stringers', uv='beam', axis=(1, 0, 0), grime=0.8)
part(bm_x, 'timber_tarred', name='bracing', uv='beam', axis=(0, 1, 0), grime=0.9)
# deck planks (transverse) + rub rails
for x0, x1, y0, y1 in rects:
    n0 = len(C.A.parts)
    deck_planks(x0, x1, ZD, (y1 - y0) + 0.1, 'deck_planks', plank=0.28)
    if y0 != -y1:
        for o in C.A.parts[n0:]:
            o.data.transform(__import__('mathutils').Matrix.Translation((0, (y0 + y1) / 2, 0)))
    bm = bmesh.new()
    for y in (y0 - 0.04, y1 + 0.04):
        beam_bm(bm, (x0, y, ZD - 0.02), (x1, y, ZD - 0.02), 0.12, 0.2)
    beam_bm(bm, (x0 - 0.04, y0, ZD - 0.02), (x0 - 0.04, y1, ZD - 0.02), 0.12, 0.2)
    part(bm, 'timber_grey', name='rubrails', uv='beam', axis=(1, 0, 0))
# fender piles (outside the head / end), bollards + cleats
hx0, hx1, hy0, hy1 = rects[-1]
bm = bmesh.new()
fend = [(hx0 - 0.25, hy0 + 0.4 + (hy1 - hy0 - 0.8) * k / (3 if big else 1)) for k in range((4 if big else 2))]
if big:
    fend += [(hx0 + 1.2 + k * 1.6, s * (hy1 + 0.25)) for k in range(3) for s in (-1, 1)]
for fx, fy in fend:
    cyl_bm(bm, (fx, fy, BED), (fx, fy, ZD + 0.55), 0.16, 8, r1=0.14)
part(bm, 'timber_tarred', name='fenders', uv='beam', axis=(0, 0, 1), smooth=True, grime=1.0)
bm, cl = bmesh.new(), bmesh.new()
bol = [(hx0 + 0.5, hy0 + 0.35), (hx0 + 0.5, hy1 - 0.35)] + ([(-10.0, 1.45), (-16.0, -1.45)] if big else [(-4.0, 0.95)])
for bx, by in bol:
    cyl_bm(bm, (bx, by, ZD - 0.2), (bx, by, ZD + 0.55), 0.17, 8, r1=0.15)
    cyl_bm(cl, (bx - 0.22, by, ZD + 0.4), (bx + 0.22, by, ZD + 0.4), 0.035, 6)
part(bm, 'timber_tarred', name='bollards', smooth=True)
part(cl, 'cast_iron', name='cleats', bisect=False)
BL.iron_ladder(hx0 - 0.02, (hy0 + hy1) / 2 + (1.2 if big else 0.3), WATER - 0.6, ZD, (-1, 0, 0), meta=True)
if big:
    lamp_post((hx0 + 0.6, 0.0, ZD), 4.0, name='pier_lamp')
    C.anchor('boat_berth', (hx0 - 3.0, 0, WATER), (0, 1, 0), kind='patrol_boat', length=12)
else:
    C.anchor('boat_berth', (-5.0, -2.8, WATER), (1, 0, 0), kind='raft')
# cargo: barrels + crate, coiled rope drum
bm = bmesh.new()
for k, (bx, by) in enumerate([(-2.0, 0.7), (-2.55, 0.85)] + ([(-24.0, 4.5), (-24.6, 4.6), (-24.3, 3.9)] if big else [])):
    cyl_bm(bm, (bx, by, ZD), (bx, by, ZD + 0.88), 0.29, 10, r1=0.29)
part(bm, 'steel_painted', name='drums', tint=(0.45, 0.5, 0.35), smooth=True, grime=0.8)
bm = bmesh.new()
box_bm(bm, (-1.4, -0.6, ZD + 0.3), (0.9, 0.7, 0.6), rot_z=0.2)
if big:
    box_bm(bm, (-25.8, -4.2, ZD + 0.35), (1.2, 0.9, 0.7), rot_z=-0.1)
    box_bm(bm, (-25.7, -4.1, ZD + 0.95), (0.9, 0.7, 0.5), rot_z=0.15)
part(bm, 'door_planks', name='crates', uv='aligned')
# shore abutment: timber crib sill into the bank
bm = bmesh.new()
y0, y1 = rects[0][2], rects[0][3]
box_bm(bm, (0.8, 0, (BED + ZD - 0.25) / 2), (1.6, y1 - y0 + 1.2, ZD - 0.25 - BED))
part(bm, 'fieldstone_grey', name='shore_abut')
W.decal('waterline', (-0.01, 0, WATER + 0.3), (-1, 0, 0), y1 - y0 + 1.0, 1.3)
BL.riprap(-0.6, 0, 1.0, (y1 - y0) / 2 + 1.5, WATER, n=16, tint=(0.55, 0.56, 0.54), name='shore_riprap')
# metadata
for x, y in piles:
    BL.water_obstacle([(x - 0.16, y - 0.16), (x + 0.16, y - 0.16), (x + 0.16, y + 0.16), (x - 0.16, y + 0.16)], 'pile', 0.5, block=None)
for fx, fy in fend:
    BL.water_obstacle([(fx - 0.17, fy - 0.17), (fx + 0.17, fy - 0.17), (fx + 0.17, fy + 0.17), (fx - 0.17, fy + 0.17)], 'pile', 0.5, block=None)
xmin = min(r_[0] for r_ in rects)
K.bridge_meta(K.Deck(xmin, 0, ZD, 0.0), xmin, 0.0, rects[0][3] - rects[0][2], WATER, 60.0,
              {'kind': 'jetty', 'shore_x': 0.0, 'axis': 'jetty runs along -X (game -x) from the shoreline at x=0',
               'water_x': [-200.0, 0.0], 'deck_z': ZD})
if big:
    hx0, hx1, hy0, hy1 = rects[1]
    C.footprint([(hx0, hy0), (hx1, hy0), (hx1, hy1), (hx0, hy1)], 'NONE', 'bridge_deck')
C.A.meta['bridge']['deck_top'] = ZD
if snow:
    W.snow_pass()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
