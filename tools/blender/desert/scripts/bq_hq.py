"""M9 garrison block `hq_domed_terraced` (Bab el Qattara; building-inventory: whitewashed, flagged command post,
terraced, with a dome and outside stairs): 12 x 15 m, one tall storey (4 m) whose flat roof is the walkable terrace
(gameplay roofY 4) behind a lime-coped parapet. Rubble-stone walls under lime render, an ochre-washed dado, a W loggia
of five round arches on square piers (the arcade, 2.2 m deep), green shutters, a double plank door mid S face under a
timber canopy with sandbag cheeks, a steep masonry stair at the SE corner up to a gap in the parapet (the mission's
stair link: foot 2 m S of the wall, x +4.5), a white-domed kiosk (qubba) on the terrace's N end (game (89, 46)),
a water tank on a stand, field-telephone wires, a whip aerial; spouts, sand drifts, flaking render.
_destroyed: the terrace slab caved in over the middle, the SE and S walls breached, dome split, soot only round the
openings and the blast, rubble heaps (LOW) — never a charred black box.
Front (Blender -Y) = game S. Usage: blender -b --python bq_hq.py -- outdir [hq|hq_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *

OUT, VAR, SEED = args('hq')
DEST = VAR.endswith('destroyed')
NAME = 'hq_domed_terraced_bq' + ('_destroyed' if DEST else '')
K.begin(NAME, 9041 + SEED, theater='desert')
r = K.rng()
HW, HD, T, H = 6.0, 7.5, 0.5, 3.75          # walls to 3.75, slab top 4.0 (terrace), parapet to 4.85
LX = -HW + 2.2                              # the loggia's back wall (x); the arcade piers stand on x = -HW
REND, DADO = 'limewash_worn', (0.93, 0.8, 0.6)
poly = rect(-HW, -HD, HW, HD)               # edges 0 S, 1 E, 2 N, 3 W
core = rect(LX, -HD, HW, HD)

# ---- openings (core walls: the W face of the core is the loggia's back wall)
door = K.opening(core, 0, -LX, 1.8, 2.5, 0.0, T, 'rect', 'door')          # centred on x = 0 (map-builder doorPoint)
wins = [K.opening(core, 0, -LX - 3.0, 0.9, 1.3, 1.1, T, 'arch'), K.opening(core, 0, -LX + 3.0, 0.9, 1.3, 1.1, T, 'arch'),
        K.opening(core, 1, 3.0, 0.9, 1.3, 1.1, T, 'arch'), K.opening(core, 1, 7.5, 0.9, 1.3, 1.1, T, 'arch'),
        K.opening(core, 1, 12.0, 0.9, 1.3, 1.1, T, 'arch'),
        K.opening(core, 2, 2.5, 0.8, 1.0, 1.5, T, 'rect'), K.opening(core, 2, 6.5, 0.8, 1.0, 1.5, T, 'rect'),
        K.opening(core, 3, 4.0, 0.9, 1.3, 1.1, T, 'arch'), K.opening(core, 3, 11.0, 0.9, 1.3, 1.1, T, 'arch')]
door_w = K.opening(core, 3, 7.5, 1.1, 2.3, 0.0, T, 'arch', 'door')
breach = []
if DEST:
    breach = [dz.RagFrame(K.opening(core, 1, 9.6, 2.6, 2.7, 0.0, T, 'rect', 'breach'), seed=SEED),
              dz.RagFrame(K.opening(core, 0, -LX + 4.6, 1.8, 2.3, 0.3, T, 'rect', 'breach'), seed=SEED + 1)]
    wins = [w for k, w in enumerate(wins) if k not in (1, 3)]
K.wall_ring(core, H, T, REND, [door, door_w] + wins + breach, plinth=('fieldstone', 0.5, 0.04), name='walls', mat_tint=WASH)
# ochre dado band (a wash, not a plinth) on the camera faces
for nm, a, b, nrm in (('dado_s', (LX + 0.05, -HD - 0.03), (HW - 0.05, -HD - 0.03), (0, -1, 0)), ('dado_e', (HW + 0.03, -HD + 0.05), (HW + 0.03, HD - 0.05), (1, 0, 0))):
    bm = bmesh.new()
    C.box_bm(bm, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.85), (max(0.02, abs(b[0] - a[0])), max(0.02, abs(b[1] - a[1])), 0.7))
    K.part(bm, 'limewash_worn', name=nm, mat_tint=DADO, grime=0.6, bisect=False)['dz_noao'] = 1

# ---- the W loggia: five round arches on square piers, a vaulted gallery roof carried on to the core's slab
bm = bmesh.new()
NA = 5
pw = 0.7
span = (2 * HD - pw) / NA
for k in range(NA + 1):
    y = -HD + pw / 2 + k * span
    C.box_bm(bm, (-HW + pw / 2, y, (H - 0.9) / 2), (pw, pw, H - 0.9))
for k in range(NA):                                       # arch spandrels: the wall over each arch, cut as a half-disc
    y0, y1 = -HD + pw + k * span, -HD + k * span + span
    yc, rr_ = (y0 + y1) / 2, (y1 - y0) / 2
    zs = H - 0.9 - rr_ + 0.35
    n = 10
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        ya, yb = yc - rr_ * math.cos(a0), yc - rr_ * math.cos(a1)
        za, zb = zs + rr_ * math.sin(a0), zs + rr_ * math.sin(a1)
        C.hexa_bm(bm, [V((-HW, ya, za)), V((-HW + pw, ya, za)), V((-HW + pw, yb, zb)), V((-HW, yb, zb)),
                       V((-HW, ya, H)), V((-HW + pw, ya, H)), V((-HW + pw, yb, H)), V((-HW, yb, H))])
C.box_bm(bm, (-HW + pw / 2, 0, H - 0.05), (pw, 2 * HD, 0.1))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, REND, name='arcade', mat_tint=WASH, grime=0.8)
bm = bmesh.new()                                          # loggia floor of beaten earth + flag pavers, a bench, water jars
C.box_bm(bm, ((-HW + LX) / 2, 0, 0.06), (LX + HW, 2 * HD, 0.12))
K.part(bm, 'patio_flags', name='loggia_floor', mat_tint=(0.9, 0.84, 0.74), grime=0.5, bisect=False)
bm = bmesh.new()
C.box_bm(bm, (LX - 0.3, -3.0, 0.35), (0.45, 2.6, 0.12))
for y in (-4.1, -1.9):
    C.box_bm(bm, (LX - 0.3, y, 0.15), (0.35, 0.08, 0.3))
K.part(bm, 'timber_grey', name='bench', grime=0.6, bisect=False)

# ---- terrace roof: slab on palm-log joists (ends out under the loggia), lime parapet with a gap at the stair head
ZT = H + 0.25
if not DEST:
    dz.roof_slab(poly, ZT, 0.25, 'screed_lime', oh=0.05, name='terrace', tint=(0.92, 0.88, 0.8))
else:   # the slab caved in over the middle-east: two pieces left, the middle hangs into the room
    dz.roof_slab(rect(-HW, -HD, HW, -1.2), ZT, 0.25, 'screed_lime', oh=0.05, name='terrace_s', tint=(0.86, 0.82, 0.74))
    dz.roof_slab(rect(-HW, 3.4, HW, HD), ZT, 0.25, 'screed_lime', oh=0.05, name='terrace_n', tint=(0.86, 0.82, 0.74))
    dz.roof_slab(rect(-HW, -1.2, LX + 1.0, 3.4), ZT, 0.25, 'screed_lime', oh=0.05, name='terrace_w', tint=(0.86, 0.82, 0.74))
    bm = bmesh.new()
    C.hexa_bm(bm, [V((LX + 1.0, -1.2, ZT - 0.25)), V((HW, -1.2, 1.2)), V((HW, 3.4, 0.9)), V((LX + 1.0, 3.4, ZT - 0.25)),
                   V((LX + 1.0, -1.2, ZT)), V((HW, -1.2, 1.45)), V((HW, 3.4, 1.15)), V((LX + 1.0, 3.4, ZT))])
    K.part(bm, 'screed_lime', name='slab_down', mat_tint=(0.7, 0.66, 0.6), grime=1.0)
    dz.patch_quad([(LX + 0.3, -HD + 0.5, 0), (HW - 0.3, -HD + 0.5, 0), (HW - 0.3, HD - 0.5, 0), (LX + 0.3, HD - 0.5, 0)], 'patio_flags', 'room_floor',
                  tint=(0.66, 0.62, 0.56), lift=0.04)
dz.joists(poly, ZT - 0.3, [3], 0.6, r=0.08, out=0.3, mid='palm_log', name='joists')
gx0, gx1 = 4.5 + HW - 0.65, 4.5 + HW + 0.65              # stair head gap on the S edge (t from x = -HW)
dz.parapet(poly, ZT, 0.85, 0.3, REND, gaps={0: [(gx0, gx1)]}, style='round', mat_tint=WASH, climb=False, name='parapet')
dz.spouts(poly, ZT + 0.05, every=5.0, mid='palm_log', skip=(2,))
dz.roof_patches(rect(-HW + 0.4, -HD + 0.4, HW - 0.4, HD - 0.4), ZT, n=3, seed=SEED)
C.roof_meta(rect(-HW, -HD, HW, HD), ZT, walkable=True)

# ---- the domed kiosk (qubba) on the terrace's N end, game (89, 46) = local (+2, -6.5)
QX, QY, QS = 2.0, 6.4 - 0.4, 2.6
if True:
    q = rect(QX - QS / 2, QY - QS / 2, QX + QS / 2, QY + QS / 2)
    qd = K.opening(q, 0, QS / 2, 0.8, 1.7, 0.0, 0.3, 'arch', 'door')
    K.wall_ring(q, 1.9, 0.3, REND, [qd], z0=ZT, name='qubba', mat_tint=WASH, footprint=False)
    dz.roof_slab(q, ZT + 2.0, 0.12, REND, oh=0.06, name='qubba_cap', tint=WASH)
    if not DEST:
        dz.dome(V((QX, QY, 0)), QS / 2 - 0.1, ZT + 2.0, mid='plaster_white', drum_h=0.25, segs=18, rings=7, finial=True, name='dome', tint=(1.0, 0.99, 0.96))
    else:     # split dome: a half shell left standing, the rest in lumps on the terrace
        dz.dome(V((QX, QY, 0)), QS / 2 - 0.1, ZT + 2.0, mid='plaster_white', drum_h=0.25, segs=18, rings=7, finial=False, name='dome', tint=(0.86, 0.84, 0.8))
        dz.safe_bite(V((QX - 0.8, QY - 0.9, ZT + 2.9)), 1.1, seed=SEED + 4)
    K.door(qd, 'qubba', 'plank', SHUT_GREEN, step=None, hinge='left', open_deg=25)
    whip(QX + QS / 2 - 0.15, QY + QS / 2 - 0.15, ZT + 2.0, 5.0, name='whip_q')
# water tank on a timber stand at the terrace's NW, a drum, jerrycans by the stair head
bm = bmesh.new()
for (x, y) in ((-4.4, 5.4), (-3.2, 5.4), (-4.4, 6.6), (-3.2, 6.6)):
    C.box_bm(bm, (x, y, ZT + 0.5), (0.12, 0.12, 1.0))
C.box_bm(bm, (-3.8, 6.0, ZT + 1.02), (1.5, 1.5, 0.08))
K.part(bm, 'timber_beam', name='tank_stand', mat_tint=(0.7, 0.6, 0.48), grime=0.7, bisect=False)
bm = bmesh.new()
C.cyl_bm(bm, V((-3.8, 6.0, ZT + 1.06)), V((-3.8, 6.0, ZT + 2.1)), 0.65, 14)
K.part(bm, 'paint_metal', name='tank', mat_tint=(0.8, 0.72, 0.55), grime=0.9, bisect=False, smooth=True)
if not DEST:
    jerrycans((3.2, -6.6, ZT), n=4, rot=0.0)
    drums([(-4.8, -6.2, ZT)], tint=(0.36, 0.38, 0.32), name='roof_drum')
    # field-telephone wires from the parapet to a pole at the NE corner (the camp's line), aerial on the parapet
    wire((QX + QS / 2 - 0.15, QY + QS / 2 - 0.15, ZT + 4.6), (-HW + 0.3, -HD + 0.3, ZT + 4.5), sag=0.6, name='aerial_wire', r=0.006)
    whip(-HW + 0.3, -HD + 0.3, ZT + 0.85, 4.0, name='whip_sw')

# ---- the outside stair at the SE corner: foot 2+ m S of the wall at x +4.5, up to the parapet gap
if not DEST:
    dz.stair_flight((4.5, -HD - 3.6, 0), (0, 1, 0), 1.2, ZT, 14, mid='limewash_worn', tint=WASH, cheek=1, rail_h=0.8, niche=True, name='stair', seed=SEED)
else:   # the stair torn from the wall: its lower half stands, the top lies broken on the sand
    dz.stair_flight((4.5, -HD - 3.6, 0), (0, 1, 0), 1.2, ZT * 0.55, 8, mid='limewash_worn', tint=(0.86, 0.83, 0.78), cheek=1, rail_h=0.6, niche=False,
                    name='stair', seed=SEED)
# ---- the main door: double plank door, timber canopy on brackets, a sandbag cheek each side, a sign board
K.door(door, 'main', 'double', SHUT_GREEN if not DEST else (0.2, 0.2, 0.18), step='ashlar', hinge='left', node='door_main',
       open_deg=0 if not DEST else 80)
bm = bmesh.new()
C.box_bm(bm, (0, -HD - 0.55, 2.85), (2.8, 1.1, 0.08))
for s in (-1, 1):
    C.beam_bm(bm, (s * 1.3, -HD - 0.02, 2.2), (s * 1.3, -HD - 1.0, 2.8), 0.1, 0.1)
K.part(bm, 'boards_weathered', name='canopy', mat_tint=(0.82, 0.74, 0.62), grime=0.7, bisect=False)
if not DEST:
    for s in (-1, 1):
        dz.sandbags((s * 1.25, -HD - 0.45), (s * 2.6, -HD - 0.45), rows=6, name='bags_door%d' % (s + 1), thick=2, footprint=False)
    sign_board((-1.6, -HD - 0.03, 2.35), (0, -1, 0), 0.9, 0.5, name='door_sign', post=False)
# ---- windows (green shutters), the loggia door, iron bars on the N side
for k, f in enumerate(wins):
    K.window(f, 'casement', (1, 2), frame=(0.84, 0.8, 0.72), sill='ashlar_limestone', shutters=None if DEST else ['open', 'ajar', 'closed'][(k + SEED) % 3],
             shutter_color=SHUT_GREEN, bars=f.n.y > 0.5, curtain=0.2, streak=True, name='w%d' % k)
K.door(door_w, 'loggia', 'plank', SHUT_GREEN, step=None, hinge='right')
# ---- weathering: flaking render showing the stone, damp foot, rust streaks under spouts, sand drifts
for k in range(7):
    e = [0, 1, 0, 1, 2, 1, 0][k]
    a, b, rr_, n, L = dz.edge(core, e)
    p = a + rr_ * r.uniform(0.6, L - 0.6)
    dz.spall2(V((p.x, p.y, r.uniform(0.7, 3.1))) + n * 0.005, n, r.uniform(0.5, 1.1), r.uniform(0.35, 0.8), mid='fieldstone', skin=REND,
              skin_tint=WASH, seed=SEED + k, name='spall%d' % k)
for e in range(4):
    a, b, rr_, n, L = dz.edge(core, e)
    K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.4))), tuple(n), L * 0.95, 0.7, alpha=0.45)
sand_feet(core, h=0.25, w=0.9, seed=SEED, skip=(3,))
if DEST:
    K.rubble((HW + 1.2, 1.6, 0), radius=2.0, height=0.8, mids=('fieldstone', 'limewash_worn'), n=36, beams=3, tiles=None, seed=SEED, name='rubble_e')
    K.rubble((1.2, -HD - 1.1, 0), radius=1.5, height=0.55, mids=('fieldstone', 'limewash_worn'), n=24, beams=2, tiles=None, seed=SEED + 1, name='rubble_s')
    K.scorch_openings(0.9, 0.6)
    C.A.meta['notes'].append('destroyed variant: terrace caved in over the middle, E and S breaches, dome split, rubble LOW; soot round the openings only')
K.footprint(poly, 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
