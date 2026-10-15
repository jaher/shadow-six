"""M11 central garrison `bunker_sandbag_timber` (Maradah inner yard, "the middle bunker"): 13 x 8 m, a timber-framed
block house (horizontal plank cladding on squared posts) behind a stretcher-bond sandbag skirt to 1.55 m, firing slits
with timber box frames above the skirt (S x2, E, W, N x2), a plank door mid S face with a lintel and a hessian blackout
curtain, a flat roof of log joists and planks whose deck top is the walkable roof (gameplay roofY 3.5) behind two
courses of sandbags with gaps at both ladder heads (S x -1.8, N x -2.5: the mission's ld_bunker / ld_scarp), a tarpaulin
patch, loose bags, a stovepipe and a periscope, telephone wire, sand drifts, ammo boxes by the door.
_destroyed: the deck collapsed into the room (two slabs at angles), cladding burst and charred round the breach, the bag
skirt blown down to stubs with burst bags flung round, rubble LOW. Never a black box.
Front (Blender -Y) = game S. Usage: blender -b --python ms_bunker.py -- outdir [c|c_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('c')
DEST = VAR.endswith('destroyed')
NAME = 'bunker_sandbag_timber_ms' + ('_destroyed' if DEST else '')
K.begin(NAME, 11301 + SEED + (5 if DEST else 0), theater='desert')
r = K.rng()

HW, HD = 6.5, 4.0                       # outer bag line = gameplay footprint 13 x 8
CW, CD = HW - 0.36, HD - 0.36           # timber core (outer cladding face)
ZR = 3.5                                # deck top = walkable roof
ZW = ZR - 0.3                           # wall plate
outer, core = rect(-HW, -HD, HW, HD), rect(-CW, -CD, CW, CD)       # edges 0 S, 1 E, 2 N, 3 W
TIMBER = (0.66, 0.56, 0.44)

door = K.opening(core, 0, CW, 1.2, 2.15, 0.0, 0.2, 'rect', 'door')   # centred on x 0 (map-builder doorPoint)
slit_spec = [(0, CW - 3.8), (0, CW + 3.8), (1, CD), (3, CD), (2, CW - 3.2), (2, CW + 3.4)]
slits = [K.opening(core, e, t, 1.3, 0.38, 1.75, 0.2, 'rect') for e, t in slit_spec]
breach = []
if DEST:
    breach = [dz.RagFrame(K.opening(core, 0, CW + 3.6, 2.8, 2.6, 0.0, 0.2, 'rect', 'breach'), seed=SEED),
              dz.RagFrame(K.opening(core, 1, CD + 1.0, 2.2, 2.4, 0.3, 0.2, 'rect', 'breach'), seed=SEED + 1)]
    slits = [s for k, s in enumerate(slits) if k not in (1, 2)]
K.wall_ring(core, ZW, 0.2, 'boards_weathered', [door] + slits + breach, name='cladding', mat_tint=(0.86, 0.77, 0.62) if not DEST else (0.62, 0.55, 0.46))
# squared corner + intermediate posts, the wall plate (log ends out on S and N)
bm = bmesh.new()
for x in (-CW, -CW / 2, 0.75, CW / 2, CW):
    for y in (-CD, CD):
        if DEST and x == CW / 2 and y == -CD:
            continue
        C.box_bm(bm, (x, y, ZW / 2), (0.22, 0.24, ZW))
for y in (-CD / 3, CD / 3):
    for x in (-CW, CW):
        C.box_bm(bm, (x, y, ZW / 2), (0.24, 0.22, ZW))
C.box_bm(bm, (-0.75, -CD - 0.02, ZW / 2), (0.22, 0.24, ZW))
K.part(bm, 'timber_beam', name='posts', mat_tint=TIMBER, grime=0.8, bisect=False)

# sandbag skirt: one bag deep, its centre line 0.18 m inside the footprint edge; gap at the door, low where blown out
BAGL = rect(-HW + 0.18, -HD + 0.18, HW - 0.18, HD - 0.18)
SK_ROWS = [11, 11, 11, 11] if not DEST else [4, 3, 6, 5]
for i in range(4):
    a, b = V((*BAGL[i], 0)), V((*BAGL[(i + 1) % 4], 0))
    L = (b - a).length
    d = (b - a) / L
    gaps = {0: [(L / 2 - 0.85, L / 2 + 0.85)] + ([(L / 2 + 2.2, L / 2 + 5.0)] if DEST else []), 1: [(2.2, 5.2)] if DEST else []}.get(i, [])
    for k, (t0, t1) in enumerate(dz.segs_minus(L, gaps)):
        if t1 - t0 > 0.5:
            bagwall(tuple(a + d * t0), tuple(a + d * t1), rows=SK_ROWS[i], name='skirt%d_%d' % (i, k), vary=0.22)
sand_feet(outer, h=0.3, w=0.7, seed=SEED)

# ---- roof: log joists across the short span (ends out 0.25 m on S and N), plank deck, two courses of bags round the edge
LADDER_S, LADDER_N = -1.8, -2.5                 # ladder heads (x) on the S / N edges
if not DEST:
    bm = bmesh.new()
    x = -HW + 0.4
    while x < HW:
        C.cyl_bm(bm, V((x, -HD - 0.25, ZW + 0.12)), V((x, HD + 0.25, ZW + 0.12)), 0.12, 7)
        x += 1.15
    K.part(bm, 'palm_log', name='joists', mat_tint=(0.8, 0.7, 0.58), grime=0.8, bisect=False)
    bm = bmesh.new()
    C.prism_bm(bm, rect(-HW + 0.05, -HD + 0.05, HW - 0.05, HD - 0.05), ZR - 0.06, ZR)
    K.part(bm, 'deck_planks', name='deck', uv='beam', axis=(0, 1, 0), mat_tint=(0.8, 0.72, 0.6), grime=0.9, bisect=False)
    C.roof_meta(rect(-HW, -HD, HW, HD), ZR, walkable=True)
    RP = rect(-HW + 0.25, -HD + 0.25, HW - 0.25, HD - 0.25)
    for i in range(4):
        a, b = V((*RP[i], ZR)), V((*RP[(i + 1) % 4], ZR))
        L = (b - a).length
        d = (b - a) / L
        gaps = {0: [(LADDER_S + HW - 0.25 - 0.7, LADDER_S + HW - 0.25 + 0.7)], 2: [(HW - 0.25 - LADDER_N - 0.7, HW - 0.25 - LADDER_N + 0.7)]}.get(i, [])
        for k, (t0, t1) in enumerate(dz.segs_minus(L, gaps)):
            if t1 - t0 > 0.6:
                bagwall(tuple(a + d * t0), tuple(a + d * t1), rows=2, name='roofbags%d_%d' % (i, k), vary=0.22)
    for o in [o for o in C.A.parts if o.name.startswith('roofbags')]:
        o.location.z += ZR                       # sandbags() builds on the ground: lift the roof courses
    # tarpaulin over the NE quarter, loose bags, stovepipe, periscope, a telephone wire to the scarp
    # the tarp is thrown over a stack of ammo / ration boxes: a draped sheet with sags, wind ripples and a turned-back
    # corner, its hem lashed down by ropes to sandbag weights
    TX0, TY0, TX1, TY1 = 1.3, 0.35, 5.75, 3.35
    def heap(x, y):                                       # rounded box stack under the sheet (0 off it)
        dx, dy = max(abs(x - 3.7) - 1.0, 0), max(abs(y - 1.95) - 0.6, 0)
        dd = math.hypot(dx, dy)
        return max(0.0, 0.62 - 0.55 * dd - 0.9 * dd * dd)
    NX, NY = 30, 20
    bm = bmesh.new()
    grid = []
    for j in range(NY + 1):
        row = []
        for i in range(NX + 1):
            x, y = TX0 + (TX1 - TX0) * i / NX, TY0 + (TY1 - TY0) * j / NY
            z = ZR + 0.035 + heap(x, y)
            z += 0.035 * math.sin(2.1 * x + 1.3 * y) * math.sin(3.3 * y - 0.7 * x) + 0.02 * math.sin(7.0 * x + 2.0 * y)
            if x > 5.0 and y < 1.2:                       # SE corner turned back on itself: a raised fold
                z += 0.09 * math.sin(min(1.0, (x - 5.0) / 0.75) * math.pi) * min(1.0, (1.2 - y) / 0.5)
            row.append(bm.verts.new((x, y, max(z, ZR + 0.015))))
        grid.append(row)
    for j in range(NY):
        for i in range(NX):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    for jj in (0, NY):                                    # a thin hem so the sheet has an edge, not a paper cut
        for i in range(NX):
            a, b = grid[jj][i], grid[jj][i + 1]
            bm.faces.new((a, b, bm.verts.new(b.co - V((0, 0, 0.03))), bm.verts.new(a.co - V((0, 0, 0.03)))))
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.7, 0.64, 0.46), grime=0.9, bisect=False, smooth=True)
    bm = bmesh.new()                                      # tie-down ropes from the eyelets to sandbag weights
    ties = [((TX0 + 0.1, TY0 + 0.1), (TX0 - 0.35, TY0 - 0.3)), ((3.0, TY0 + 0.05), (2.9, TY0 - 0.45)), ((4.6, TY0 + 0.05), (4.8, TY0 - 0.45)),
            ((TX0 + 0.1, TY1 - 0.1), (TX0 - 0.4, TY1 + 0.15)), ((3.6, TY1 - 0.05), (3.5, TY1 + 0.25)), ((TX1 - 0.1, TY1 - 0.15), (TX1 + 0.2, TY1 + 0.2)),
            ((TX1 - 0.05, 2.0), (TX1 + 0.3, 2.1))]
    for (ax_, ay_), (bx_, by_) in ties:
        za = ZR + 0.06 + heap(ax_, ay_)
        C.cyl_bm(bm, V((ax_, ay_, za)), V((bx_, by_, ZR + 0.12)), 0.012, 4, caps=False)
    for x, y in ((3.7 - 1.1, 1.95), (3.7 + 1.1, 1.95)):    # a rope over the top of the heap
        C.cyl_bm(bm, V((x, TY0 - 0.2, ZR + 0.1)), V((x, 1.95 - 0.6, ZR + 0.62)), 0.012, 4, caps=False)
        C.cyl_bm(bm, V((x, 1.95 - 0.6, ZR + 0.62)), V((x, 1.95 + 0.6, ZR + 0.62)), 0.012, 4, caps=False)
        C.cyl_bm(bm, V((x, 1.95 + 0.6, ZR + 0.62)), V((x, TY1 + 0.2, ZR + 0.1)), 0.012, 4, caps=False)
    K.part(bm, 'hessian', name='tarp_ties', mat_tint=(0.62, 0.55, 0.42), grime=0.6, bisect=False)
    for k, (_, (bx_, by_)) in enumerate(ties[:5]):          # sandbag weights on the rope ends
        bagwall((bx_ - 0.28, by_), (bx_ + 0.32, by_), rows=1, name='tarpweight%d' % k, vary=0.22)
        C.A.parts[-1].location.z += ZR
    for k, (x, y) in enumerate(((3.0, -1.5), (3.6, -1.4), (-4.8, 1.8))):
        dz.sandbags((x - 0.3, y), (x + 0.3, y), rows=1 + (k == 0), name='loose%d' % k, thick=1, footprint=False)
        C.A.parts[-1].location.z += ZR
    bm = bmesh.new()
    C.cyl_bm(bm, V((4.6, 2.6, ZR)), V((4.6, 2.6, ZR + 1.3)), 0.08, 8)
    C.cyl_bm(bm, V((4.6, 2.6, ZR + 1.3)), V((4.6, 2.6, ZR + 1.36)), 0.16, 8)
    C.cyl_bm(bm, V((-3.6, -1.2, ZR)), V((-3.6, -1.2, ZR + 0.7)), 0.05, 6)
    C.box_bm(bm, (-3.6, -1.27, ZR + 0.74), (0.12, 0.2, 0.14))
    K.part(bm, 'cast_iron', name='pipes', mat_tint=(0.36, 0.34, 0.3), grime=0.9, bisect=False)
    K.decal('soot', (4.6, 2.6, ZR + 0.02), (0, 0, 1), 0.9, 0.9, alpha=0.4)
    wire((-HW + 0.3, HD - 0.3, ZR + 1.2), (-HW + 0.6, HD + 3.0, ZR + 3.2), sag=0.3, name='tel_wire', r=0.008)
    posts([(-HW + 0.3, HD - 0.3)], ZR, ZR + 1.25, s=0.07, name='tel_post')
else:   # the deck caved in: the W half hangs from the N wall plate into the room, the E end still on its joists
    bm = bmesh.new()
    for x in (-5.7, -4.5, 4.4, 5.6):
        C.cyl_bm(bm, V((x, -HD - 0.2, ZW + 0.12)), V((x, HD + 0.2, ZW + 0.12)), 0.12, 7)
    C.cyl_bm(bm, V((-2.0, HD + 0.2, ZW + 0.1)), V((-1.2, -HD + 0.6, 0.6)), 0.12, 7)
    C.cyl_bm(bm, V((1.5, HD + 0.1, ZW)), V((2.6, -HD + 1.0, 0.4)), 0.12, 7)
    K.part(bm, 'palm_log', name='joists', mat_tint=(0.45, 0.38, 0.3), grime=1.0, bisect=False)
    bm = bmesh.new()
    C.prism_bm(bm, rect(3.9, -HD + 0.05, HW - 0.05, HD - 0.05), ZR - 0.06, ZR)
    C.prism_bm(bm, rect(-HW + 0.05, 1.2, -4.0, HD - 0.05), ZR - 0.06, ZR)
    for (x0, x1, zs) in ((-3.0, -1.6, 0.5), (0.6, 2.2, 0.8)):      # two plank sheets fallen from the N plate to the floor
        C.hexa_bm(bm, [V((x0, -1.2, zs)), V((x1, -1.0, zs - 0.1)), V((x1, HD - 0.3, ZW - 0.4)), V((x0, HD - 0.3, ZW - 0.3)),
                       V((x0, -1.2, zs + 0.07)), V((x1, -1.0, zs - 0.03)), V((x1, HD - 0.3, ZW - 0.33)), V((x0, HD - 0.3, ZW - 0.23))])
    K.part(bm, 'deck_planks', name='deck', uv='beam', axis=(0, 1, 0), mat_tint=(0.6, 0.53, 0.44), grime=1.0, bisect=False)
    dz.patch_quad([(-CW + 0.2, -CD + 0.2, 0), (CW - 0.2, -CD + 0.2, 0), (CW - 0.2, CD - 0.2, 0), (-CW + 0.2, CD - 0.2, 0)], 'sand', 'room_floor',
                  tint=(0.55, 0.5, 0.44), lift=0.03)
    dz.debris_timber((-0.5, 0.0, 0), 3.5, 2.2, seed=SEED + 2, planks=16, felt=0, studs=5, name='planks_in', mid='deck_planks', charred=0.5)
    dz.debris_timber((0.4, -HD - 0.9, 0), 1.6, 0.7, seed=SEED, planks=10, felt=0, studs=3, name='planks_out', mid='boards_weathered', charred=0.3)
    K.rubble((3.6, -HD - 0.8, 0), radius=1.6, height=0.5, mids=('hessian', 'timber_beam'), n=26, beams=4, tiles=None, seed=SEED, name='rubble_s')
    K.rubble((HW + 0.6, 0.6, 0), radius=1.3, height=0.45, mids=('hessian', 'timber_beam'), n=20, beams=3, tiles=None, seed=SEED + 3, name='rubble_e')
    K.scorch_openings(0.8, 0.55)
    C.A.meta['notes'].append('destroyed: deck collapsed into the room, S and E walls blown in, bag skirt down to 3-6 courses; soot only round the openings')

# ---- the door: plank door ajar, frame + lintel, blackout curtain; slit frames; ammo boxes and a water can by the door
K.door(door, 'main', 'plank', (0.5, 0.42, 0.32) if not DEST else (0.22, 0.2, 0.18), step=None, hinge='left', node='door_main',
       open_deg=20 if not DEST else 75)
bm = bmesh.new()
for f in slits:
    rz = math.atan2(f.r.y, f.r.x)
    for zz in (-0.06, f.h + 0.06):
        C.box_bm(bm, tuple(f.p(0, zz - 0.05, 0.08)), (1.5, 0.36, 0.1), rz)
    for s_ in (-1, 1):
        C.box_bm(bm, tuple(f.p(s_ * 0.7, -0.1, 0.08)), (0.1, 0.36, f.h + 0.25), rz)
K.part(bm, 'timber_beam', name='slit_frames', mat_tint=TIMBER, grime=0.8, bisect=False)
for f in slits:
    K.anchor('embrasure', tuple(f.p(0, f.h / 2, 0.4)), tuple(f.n), kind='embrasure')
if not DEST:
    bm = bmesh.new()
    for k, (x, y, z) in enumerate(((2.0, -HD - 0.0, 0), (2.65, -HD + 0.02, 0), (2.3, -HD + 0.0, 0.34))):
        dz.crate(bm, (x, y - 0.0, z), (0.6, 0.38, 0.34), r.uniform(-0.08, 0.08))
    K.part(bm, 'wood_paint', name='boxes', mat_tint=DAK, grime=0.8, bisect=False)
    sign_board((-1.6, -CD - 0.03, 2.6), (0, -1, 0), 0.8, 0.45, name='door_sign', post=False)
K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
