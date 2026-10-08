"""Harbour motor launch hauled out on a slip trolley (M13 Le Havre dock decor; reusable at any port / boatyard):
 a   boat_on_cradle   9 m grey Kriegsmarine harbour launch (Hafenschutzboot type) on a timber-and-steel slip trolley
     with four flanged wheels on a short hauling-out track bedded in the paving (buffer stops at both ends):
     lofted hull (round bilge aft, fine flared V bow, rising sheer, raked forefoot) with a rubbing strake and gunwale
     capping, boot-top and antifouling, rudder + propeller, low wheelhouse under a lashed canvas tarpaulin, bow fender, mooring cleats,
     wedges and shores, a drip of rust from the hawse. Bow along local +X.
Footprint = 10 x 5 rect (HIGH).
Usage: blender -b --factory-startup --python boat_cradle.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1351)
K.begin('boat_on_cradle', SEED, theater='coast')
r = K.rng()
L, BEAM, ZK = 9.0, 2.7, 0.95          # length, beam, keel height on the trolley
GREY = (0.45, 0.47, 0.48)

# ------------------------------------------------------------------ rails, trolley, wheels, shores
bm = bmesh.new()                                          # a short hauling-out track: rails on sleepers bedded in the
for y in (-1.0, 1.0):                                     # paving, timber buffer stops at both ends
    K.box_bm(bm, (0, y, 0.05), (8.6, 0.07, 0.1))
    K.box_bm(bm, (0, y, 0.015), (8.6, 0.16, 0.03))
for k in range(8):
    K.box_bm(bm, (-3.85 + k * 1.1, 0, 0.015), (0.24, 2.5, 0.03))
K.part(bm, 'steel_painted', name='rails', mat_tint=(0.3, 0.27, 0.24), grime=1.0, bisect=False)
bm = bmesh.new()
for x in (-3.4, -1.2, 1.0, 3.0):
    K.box_bm(bm, (x, 0, 0.5), (0.3, 2.4, 0.22))          # cross bearers
    for y in (-0.55, 0.55):                              # V-blocks under the hull
        K.box_bm(bm, (x, y, 0.75), (0.28, 0.5, 0.3), rot_z=0)
for y in (-1.0, 1.0):
    K.box_bm(bm, (0, y, 0.38), (7.4, 0.25, 0.16))         # side beams
for x in (-4.45, 4.45):                                   # buffer stops (baulk on two posts, iron straps)
    K.box_bm(bm, (x, 0, 0.36), (0.32, 2.5, 0.3))
    for y in (-1.0, 1.0):
        K.box_bm(bm, (x, y, 0.12), (0.3, 0.3, 0.24))
K.part(bm, 'timber_beam', name='trolley', grime=0.9, bisect=False)
bm = bmesh.new()
for x in (-3.0, 2.6):
    for y in (-1.0, 1.0):
        K.cyl_bm(bm, V((x, y - 0.07, 0.24)), V((x, y + 0.07, 0.24)), 0.22, 14)
for x in (-2.0, 0.5, 2.6):
    for s in (-1, 1):
        K.beam_bm(bm, V((x, s * 1.75, 0.0)), V((x, s * 1.22, 1.55)), 0.09, 0.09)   # shores
K.part(bm, 'cast_iron', name='wheels_shores', grime=0.8, bisect=False)

# ------------------------------------------------------------------ hull (lofted round bilge), strake, boot-top
def section(t):
    """Half-breadth, sheer height and keel height along the hull (t: 0 transom -> 1 stem)."""
    if t < 0.45:
        hb = BEAM / 2 * (0.84 + 0.16 * math.sin(math.pi / 2 * t / 0.45))
    else:
        hb = max(0.03, BEAM / 2 * math.cos(math.pi / 2 * (t - 0.45) / 0.55) ** 0.75)
    sheer = ZK + 1.55 + (0.5 * ((t - 0.3) / 0.7) ** 2 if t > 0.3 else 0.0)
    keel = ZK + (0.0 if t < 0.62 else (sheer - 0.45 - ZK) * ((t - 0.62) / 0.38) ** 2.2)
    return hb, sheer, keel


def hull_pt(x, t, u, s):
    """Point on the hull skin: u 0 keel -> 1 sheer, s = side sign. Round bilge aft, a fine flared V forward."""
    hb, sheer, keel = section(t)
    v = min(1.0, max(0.0, (t - 0.45) / 0.4))                            # 0 round bilge -> 1 V bow
    yr, zr = math.sin(math.pi / 2 * u), 1 - math.cos(math.pi / 2 * u)
    yv, zv = u ** 1.6, u                                               # V with flare: hollow low, wide at the sheer
    y = hb * ((1 - v) * yr + v * yv) * (1 - 0.06 * (1 - u) * (1 - t))   # slight tumblehome-free deadrise aft
    z = keel + (sheer - keel) * ((1 - v) * zr + v * zv)
    return V((x, s * y, z))


rings = []
NS, NR = 14, 29
for i in range(NR):
    t = i / (NR - 1)
    x = -L / 2 + L * t
    ring = [hull_pt(x, t, 1 - k / NS, -1) for k in range(NS)] + [hull_pt(x, t, k / NS, 1) for k in range(NS + 1)]
    rings.append(ring)
bm = bmesh.new()
K.loft_bm(bm, rings, closed=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
hull = K.part(bm, 'steel_painted', name='hull', mat_tint=GREY, grime=0.8, smooth=True, bisect=False)
bm = bmesh.new()                                          # deck / covering board, rubbing strake
deck = []
for i in range(NR):
    t = i / (NR - 1)
    hb, sheer, _ = section(t)
    deck.append((-L / 2 + L * t, hb, sheer))
K.loft_bm(bm, [[V((x, y - 0.06, z + 0.03)), V((x, -y + 0.06, z + 0.03))] for x, y, z in deck], close_start=False, close_end=False, closed=False)
K.part(bm, 'deck_planks', name='deck', uv='beam', axis=(1, 0, 0), grime=0.8, bisect=False)
bm = bmesh.new()
for s in (-1, 1):
    for i in range(NR - 1):
        a, b = deck[i], deck[i + 1]
        K.beam_bm(bm, V((a[0], s * (a[1] + 0.03), a[2] - 0.12)), V((b[0], s * (b[1] + 0.03), b[2] - 0.12)), 0.08, 0.1)
        K.beam_bm(bm, V((a[0], s * a[1], a[2] + 0.06)), V((b[0], s * b[1], b[2] + 0.06)), 0.1, 0.07)   # gunwale capping
K.part(bm, 'timber_tarred', name='strake', grime=0.6, bisect=False)
for s in (-1, 1):                                          # antifouling + boot-top read as decals along the bilge
    K.decal('waterline', (0, s * (BEAM / 2 - 0.02), ZK + 0.55), (0, s, 0), L * 0.85, 0.5, alpha=0.85)
    K.decal('streak_rust', (L / 2 - 1.3, s * (BEAM / 2 - 0.25), ZK + 1.35), (0, s, 0), 0.25, 0.8, alpha=0.6)

# ------------------------------------------------------------------ wheelhouse under a tarpaulin, fittings
bm = bmesh.new()
K.box_bm(bm, (-0.9, 0, ZK + 2.2), (3.0, 1.9, 1.2), taper=(0.92, 0.9))
K.part(bm, 'steel_painted', name='house', mat_tint=GREY, grime=0.8, bisect=False)
bm = bmesh.new()                                          # tarp: a sagging cover over house + cockpit, ropes over it
K.box_bm(bm, (-1.2, 0, ZK + 2.86), (4.3, 2.3, 0.12))
for s in (-1, 1):
    K.beam_bm(bm, V((-3.35, s * 1.15, ZK + 2.8)), V((-3.4, s * 1.25, ZK + 1.6)), 0.04, 4.3 if False else 0.04)
    K.box_bm(bm, (-1.2, s * 1.2, ZK + 2.3), (4.3, 0.06, 1.1))
K.part(bm, 'canvas', name='tarp', mat_tint=(0.48, 0.47, 0.38), grime=0.8, bisect=False)
bm = bmesh.new()
for x in (-2.8, -1.6, -0.4, 0.8):
    K.beam_bm(bm, V((x, -1.27, ZK + 1.75)), V((x, -1.21, ZK + 2.9)), 0.02, 0.02)
    K.beam_bm(bm, V((x, -1.21, ZK + 2.93)), V((x, 1.21, ZK + 2.93)), 0.02, 0.02)
    K.beam_bm(bm, V((x, 1.21, ZK + 2.9)), V((x, 1.27, ZK + 1.75)), 0.02, 0.02)
K.part(bm, 'hessian', name='lashings', grime=0.5, bisect=False, lod='drop')
bm = bmesh.new()
K.box_bm(bm, (-L / 2 + 0.35, 0, ZK + 0.35), (0.5, 0.06, 0.7))                        # rudder
for k in range(3):
    a = k * 2 * math.pi / 3
    K.box_bm(bm, (-L / 2 + 0.85, 0.18 * math.cos(a), ZK + 0.55 + 0.18 * math.sin(a)), (0.05, 0.12, 0.3), rot_z=0)
K.cyl_bm(bm, V((-L / 2 + 0.9, 0, ZK + 0.55)), V((-L / 2 + 1.6, 0, ZK + 0.6)), 0.04, 6)
for x in (L / 2 - 0.6, -L / 2 + 0.6):                                                  # cleats
    K.box_bm(bm, (x, 0, deck[-1][2] + 0.08 if x > 0 else deck[0][2] + 0.08), (0.3, 0.08, 0.08))
K.part(bm, 'cast_iron', name='fittings', grime=0.4, bisect=False)
bm = bmesh.new()
K.cyl_bm(bm, V((L / 2 - 0.15, 0, ZK + 1.75)), V((L / 2 + 0.02, 0, ZK + 1.75)), 0.2, 12)          # bow fender
K.part(bm, 'hessian', name='fender', mat_tint=(0.4, 0.33, 0.24), grime=0.6, smooth=True, bisect=False)

K.footprint([(-5, -2.5), (5, -2.5), (5, 2.5), (-5, 2.5)], 'HIGH', 'building')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
