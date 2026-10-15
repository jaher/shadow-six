"""M10 bomb store `store` (dossier §5.3 `domed_block`, the objective, 10 x 9 x 4 + a dome 4.5 x 2.5 on the NW roof corner):
a heavy flat-roofed mud-brick magazine under a worn ochre mud render patched with limewash, battered corner buttresses,
small barred vents high up (no windows), an iron-strapped double door mid-W between sandbag blast cheeks, a lime-screed
roof behind a low rounded parapet, a domed qubba on the NW corner (the old marabout's tomb the Germans turned into the
store), palm-log spouts, stencilled warning boards, bomb crates and a bomb trolley rail by the door, sand at every foot.
destroyed: roof caved in, dome split, two breaches (S, E), charred door, rubble, soot.
Front (Blender -Y) = game S; the door faces game W (-X). Usage: blender -b --python ic_store.py -- outdir [a|a_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('a')
DEST = VAR.endswith('destroyed')
NAME = 'store_domed_ic' + ('_destroyed' if DEST else '')
K.begin(NAME, 10601 + SEED + (5 if DEST else 0), theater='desert')
r = K.rng()
W, D, H1, T = 10.0, 9.0, 3.6, 0.6
HW, HD = W / 2, D / 2
poly = rect(-HW, -HD, HW, HD)
REND, REND_T = 'mud_render', (0.98, 0.9, 0.78)
DOOR_C = (0.36, 0.33, 0.27)
# ---------------------------------------------------------------- walls: door mid-W (edge 3 runs N -> S? use dz.edge)
door = K.opening(poly, 3, HD, 1.9, 2.5, 0.0, T, 'rect', 'door')
vents = []
for e, ts in ((0, (2.0, 5.0, 8.0)), (1, (2.5, 6.5)), (2, (2.0, 5.0, 8.0)), (3, (1.6, 7.4))):
    for t in ts:
        vents.append(K.opening(poly, e, t, 0.55, 0.35, 2.75, T, 'rect'))
breach = []
if DEST:
    breach = [dz.RagFrame(K.opening(poly, 0, 6.4, 3.0, 2.8, 0.0, T, 'rect', 'breach'), seed=SEED),
              dz.RagFrame(K.opening(poly, 1, 5.5, 2.4, 2.4, 0.4, T, 'rect', 'breach'), seed=SEED + 1)]
    vents = [v for k, v in enumerate(vents) if k % 3 != 0]
K.wall_ring(poly, H1, T, REND, [door] + vents + breach, plinth=('fieldstone', 0.5, 0.05), name='walls', mat_tint=REND_T)
for k, f in enumerate(vents):
    K.window(f, 'fixed', (1, 1), frame=(0.5, 0.45, 0.38), sill=None, shutters=None, bars=True, curtain=0.0, streak=True, name='v%d' % k)
K.door(door, 'main', 'double', DOOR_C if not DEST else (0.18, 0.17, 0.16), step='ashlar', hinge='left', node='door_main', open_deg=0 if not DEST else 70)
# battered buttresses at the four corners (mud brick under render)
bm = bmesh.new()
for (x, y) in poly:
    sx, sy = (1 if x > 0 else -1), (1 if y > 0 else -1)
    C.box_bm(bm, (x + sx * 0.05, y + sy * 0.05, (H1 - 0.4) / 2), (1.1, 1.1, H1 - 0.4), taper=(0.7, 0.7))
K.part(bm, REND, name='buttress', mat_tint=(0.94, 0.86, 0.74), grime=0.9, bisect=False)
# limewash patches on the render (old whitewash peeling) + streaks under the spouts
for e in range(4):
    a, b, rr_, n, L = dz.edge(poly, e)
    for k in range(3):
        t = r.uniform(1.2, L - 1.2)
        dz.spall2(a + rr_ * t + n * 0.01 + V((0, 0, r.uniform(0.9, 2.6))), n, r.uniform(0.6, 1.3), r.uniform(0.4, 0.9), mid='mudbrick', skin=REND,
                  skin_tint=REND_T, seed=SEED + 7 * e + k, name='spall%d_%d' % (e, k))
    if e != 3:                             # (not across the W door)
        K.decal('damp_base', tuple((a + b) / 2 + n * 0.008 + V((0, 0, 0.45))), tuple(n), L * 0.95, 0.7, alpha=0.45)
    K.decal('streak_long', tuple(a + rr_ * (L * 0.3) + n * 0.01 + V((0, 0, H1 - 1.0))), tuple(n), 0.6, 1.8, alpha=0.4)
ZT = H1 + 0.25
QX, QY, QS = -HW + 2.2, HD - 2.2, 4.0         # the qubba: NW roof corner (game N = Blender +Y)
if not DEST:
    dz.roof_slab(poly, ZT, 0.28, 'screed_lime', oh=0.05, name='roof', tint=(0.9, 0.86, 0.78))
    dz.parapet(poly, ZT, 0.55, 0.32, REND, style='round', mat_tint=REND_T, climb=False, name='parapet')
    dz.spouts(poly, ZT + 0.05, every=4.0, mid='palm_log', skip=(3,))
    dz.roof_patches(rect(-HW + 0.5, -HD + 0.5, HW - 0.5, HD - 0.5), ZT, n=3, seed=SEED)
    q = rect(QX - QS / 2, QY - QS / 2, QX + QS / 2, QY + QS / 2)
    K.wall_ring(q, 0.6, 0.35, REND, [], z0=ZT, name='qubba_drum', mat_tint=(1.0, 0.97, 0.92), footprint=False)
    dz.roof_slab(q, ZT + 0.7, 0.14, REND, oh=0.08, name='qubba_cap', tint=(1.0, 0.97, 0.92))
    dz.dome(V((QX, QY, 0)), QS / 2 - 0.25, ZT + 0.7, mid='limewash_worn', drum_h=0.2, segs=20, rings=8, finial=False, name='dome', tint=(1.0, 0.98, 0.94))
    # the ventilator cowl + a whip aerial on the roof, a hatch
    dz.hatch((HW - 1.6, -HD + 1.6), ZT + 0.14, w=0.8, mid='timber_grey', curb=REND, tint=(0.8, 0.74, 0.64), name='hatch')
else:
    dz.roof_slab(rect(-HW, 0.8, -0.2, HD), ZT, 0.28, 'screed_lime', oh=0.05, name='roof_nw', tint=(0.78, 0.74, 0.66))
    q = rect(QX - QS / 2, QY - QS / 2, QX + QS / 2, QY + QS / 2)
    K.wall_ring(q, 0.6, 0.35, REND, [], z0=ZT, name='qubba_drum', mat_tint=(0.86, 0.82, 0.76), footprint=False)
    dz.dome(V((QX, QY, 0)), QS / 2 - 0.25, ZT + 0.7, mid='limewash_worn', drum_h=0.25, segs=20, rings=8, finial=False, name='dome', tint=(0.82, 0.8, 0.76))
    dz.safe_bite(V((QX + QS * 0.35, QY - QS * 0.3, ZT + 1.6)), QS * 0.45, seed=SEED + 4)
    bm = bmesh.new()
    for k in range(7):
        x = -HW + 1.0 + k * 1.4
        C.cyl_bm(bm, V((x, -HD + 0.4, H1 - r.uniform(0.2, 1.6))), V((x + r.uniform(-0.6, 0.6), 0.9, ZT - r.uniform(0, 0.6))), 0.09, 6)
    K.part(bm, 'timber_beam', name='beams_charred', mat_tint=(0.3, 0.26, 0.22), grime=1.0, bisect=False)
    K.rubble((1.5, -1.2, 0), radius=3.6, height=1.5, mids=('mudbrick', 'screed_lime'), n=60, beams=6, tiles=None, seed=SEED, name='rubble_in')
    K.rubble((6.3, -2.0, 0), radius=1.6, height=0.7, mids=('mudbrick', 'fieldstone'), n=24, beams=2, tiles=None, seed=SEED + 1, name='rubble_e')
    K.rubble((1.0, -5.6, 0), radius=1.8, height=0.7, mids=('mudbrick', 'fieldstone'), n=24, beams=2, tiles=None, seed=SEED + 2, name='rubble_s')
    K.scorch_openings(1.0, 0.8)
    for e in range(4):
        a, b, rr_, n, L = dz.edge(poly, e)
        K.decal('soot', tuple(a + rr_ * (L * 0.55) + n * 0.012 + V((0, 0, 2.6))), tuple(n), L * 0.7, 2.4, alpha=0.7)
    C.A.meta['notes'].append('destroyed: roof caved in (NW quarter left), dome split, S + E breaches, rubble, soot')
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_store_b.py')).read())
