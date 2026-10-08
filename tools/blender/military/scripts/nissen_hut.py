"""Nissen hut (M13 Le Havre dock garrison / stores; reusable on any 1940-44 coast or airfield):
 a   nissen_hut   12 x 6 m: corrugated-steel half-cylinder shell (r 2.85 m) on a 0.3 m concrete kerb, olive paint
     weathered to galvanising and rust, lap seams every 1.83 m, timber end walls (door + 2 windows W, 2 windows +
     stove E), 3 small dormer windows per side, stove pipe with rain cap, door step, rain streaks and moss.
Footprint = 12 x 6 rect (HIGH); front = Blender -Y = game +z; the door is on the W gable (game -x).
Usage: blender -b --factory-startup --python nissen_hut.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1301)
# b = nissen_hut_b: the 10 m (five-bay) hut
K.begin('nissen_hut' if VAR == 'a' else 'nissen_hut_b', SEED, theater='coast')
r = K.rng()
HW, HD = (6.0 if VAR == 'a' else 5.0), 3.0
Z0, R, TH = 0.3, 2.85, 0.06           # kerb top, shell outer radius, shell thickness
OLIVE = (0.52, 0.55, 0.44)
poly = [(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)]      # edges 0 S, 1 E, 2 N, 3 W
N_ARC = 28


def arc(rad, a0=0.0, a1=math.pi, n=N_ARC):
    return [(rad * math.cos(a0 + (a1 - a0) * i / n), Z0 + rad * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ------------------------------------------------------------------ concrete kerb / floor slab + door step
bm = bmesh.new()
M.chamfer_block(bm, -HW - 0.1, -HD, HW + 0.1, HD, -0.15, Z0, ch=0.04)
M.chamfer_block(bm, -HW - 0.75, -0.9, -HW - 0.1, 0.9, -0.15, 0.16, ch=0.03)
M.conc_part(bm, 'kerb', 'concrete_bunker', (0.82, 0.82, 0.79))

# ------------------------------------------------------------------ corrugated shell (annular half-cylinder along X)
x0, x1 = -HW + 0.12, HW - 0.12
prof = arc(R) + list(reversed(arc(R - TH)))
bm = bmesh.new()
K.loft_bm(bm, [[V((x, y, z)) for y, z in prof] for x in (x0, x1)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shell = K.part(bm, 'corrugated_galv', name='shell', uv='beam', axis=(1, 0, 0), rot90=True, mat_tint=OLIVE, grime=0.9, smooth=True, bisect=False)
# lap seams / ribs: raised strips round the arc every 1.83 m, end trims
bm = bmesh.new()
xs = [x0 + 0.04] + [x0 + 1.83 * k for k in range(1, int((x1 - x0) / 1.83) + 1)] + [x1 - 0.04]
for x in xs:
    if x > x1:
        continue
    pr = arc(R + 0.025) + list(reversed(arc(R - 0.01)))
    K.loft_bm(bm, [[V((x + dx, y, z)) for y, z in pr] for dx in (-0.04, 0.04)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'steel_painted', name='seams', mat_tint=(0.42, 0.44, 0.36), grime=1.0, smooth=True, bisect=False)

# ------------------------------------------------------------------ timber end walls with openings
def end_wall(x_out, sgn, openings):
    """Planked gable at x_out (outer face), wall inward by 0.12; openings = [(y, sill, w, h, kind)]."""
    pr = [(-R + TH, 0.0), (R - TH, 0.0)] + arc(R - TH, 0.0, math.pi)[1:-1]
    bm = bmesh.new()
    K.loft_bm(bm, [[V((x_out, y, z)) for y, z in pr], [V((x_out - sgn * 0.12, y, z)) for y, z in pr]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    frames = []
    n = (sgn, 0, 0)
    for (y, sill, w, h, kind) in openings:
        rr = V((0, -sgn, 0))           # right vector seen from outside
        frames.append(K.Frame(V((x_out, y, sill)), V(n), rr, w, h, 0.12, 'rect', kind))
    bm = K.boolean_cut(bm, frames)
    K.part(bm, 'weatherboard_paint', name='gable', uv='aligned', mat_tint=(0.36, 0.4, 0.33), grime=0.8, bisect=False)
    return frames


fw = end_wall(-HW - 0.02, -1, [(0.0, Z0, 1.2, 2.05, 'door'), (-1.75, Z0 + 0.95, 0.75, 0.9, 'window'), (1.75, Z0 + 0.95, 0.75, 0.9, 'window')])
fe = end_wall(HW + 0.02, 1, [(-1.3, Z0 + 0.95, 0.8, 0.9, 'window'), (1.3, Z0 + 0.95, 0.8, 0.9, 'window')])
K.door(fw[0], 'main', 'plank', (0.3, 0.33, 0.27), step=None, node='door_main')
for f in fw[1:] + fe:
    K.window(f, 'casement', (2, 2), frame=(0.75, 0.74, 0.68), sill='timber_grey', lintel=None, surround=None, shutters=None,
             curtain=0.4, name='win')
# blackout boards over the E windows' upper halves (tarred), window boards / trims
bm = bmesh.new()
for f in fe:
    K.box_bm(bm, tuple(f.p(0, f.h + 0.08, 0.03)), (0.06, f.w + 0.2, 0.08))
K.box_bm(bm, tuple(fw[0].p(0, fw[0].h + 0.1, 0.03)), (0.06, 1.5, 0.1))
K.part(bm, 'timber_grey', name='trims', grime=0.7, bisect=False)

# ------------------------------------------------------------------ dormer windows on the sides (3 per side)
for side in (-1, 1):
    for x in ((-3.6, 0.0, 3.6) if VAR == 'a' else (-2.9, 0.0, 2.9)):
        zc = Z0 + 1.15
        yo = math.sqrt(R * R - (zc - Z0) ** 2) * side
        fr = K.Frame(V((x, yo + side * 0.32, zc - 0.32)), V((0, side, 0)), V((-side, 0, 0)), 0.9, 0.62, 0.3, 'rect', 'window')
        bm = bmesh.new()                                 # cheeks + pent roof of the dormer box
        K.box_bm(bm, (x - 0.5, yo + side * 0.05, zc), (0.05, 0.62, 0.78))
        K.box_bm(bm, (x + 0.5, yo + side * 0.05, zc), (0.05, 0.62, 0.78))
        K.part(bm, 'weatherboard_paint', name='dormer_cheek', mat_tint=(0.36, 0.4, 0.33), grime=0.8, bisect=False)
        bm = bmesh.new()
        K.box_bm(bm, (x, yo + side * 0.12, zc + 0.43), (1.12, 0.78, 0.05))
        K.part(bm, 'corrugated_galv', name='dormer_roof', mat_tint=OLIVE, grime=0.9, bisect=False)
        K.window(fr, 'fixed', (2, 1), frame=(0.75, 0.74, 0.68), sill=None, lintel=None, surround=None, shutters=None, curtain=0.0,
                 interior=True, streak=False, name='dwin')

# ------------------------------------------------------------------ stove pipe, rain cap, guy wires; lamp over the door
bm = bmesh.new()
px, py = HW - 2.2, -0.9
pz = Z0 + math.sqrt(R * R - py * py)
K.cyl_bm(bm, V((px, py, pz - 0.2)), V((px, py, pz + 1.3)), 0.075, 10)
K.cyl_bm(bm, V((px, py, pz + 1.36)), V((px, py, pz + 1.5)), 0.2, 12, r1=0.02)
K.cyl_bm(bm, V((px, py, pz - 0.05)), V((px, py, pz + 0.08)), 0.2, 12)
K.part(bm, 'steel_painted', name='stove_pipe', mat_tint=(0.22, 0.21, 0.2), grime=1.0, bisect=False)
K.anchor('smoke', (px, py, pz + 1.45), (0, -1, 0), kind='chimney')
K.wall_lantern(fw[0].p(0.0, fw[0].h + 0.35, 0.0), fw[0].n, 0)

# ------------------------------------------------------------------ weathering
for x in [x0 + 0.9 + 2.05 * k for k in range(int((x1 - x0 - 0.9) / 2.05) + 1)]:
    for side in (-1, 1):
        K.decal(r.choice(['streak_rust', 'streak_long', 'stain_rust_blotch']), (x + r.uniform(-0.5, 0.5), side * (R * 0.72 + 0.02), Z0 + R * 0.7),
                (0, side * 0.7, 0.7), r.uniform(0.6, 1.1), 1.4, alpha=0.55)
        K.decal('damp_base', (x, side * (R + 0.01), Z0 + 0.3), (0, side, 0), 2.0, 0.6, alpha=0.6)
for k in range(5):
    K.decal(r.choice(['moss_patch', 'lichen', 'stain_blotch']), (r.uniform(-HW + 1, HW - 1), R * 0.25, Z0 + R * 0.98), (0, 0.25, 0.97),
            r.uniform(0.8, 1.5), r.uniform(0.6, 1.0), alpha=0.45)
for x, s in ((-HW - 0.03, -1), (HW + 0.03, 1)):
    K.decal('streak_rain', (x, r.uniform(-1, 1), Z0 + 2.0), (s, 0, 0), 1.2, 1.4, alpha=0.5)
    K.decal('damp_base', (x, 0, Z0 + 0.25), (s, 0, 0), 5.2, 0.5, alpha=0.6)

K.footprint(poly, 'HIGH', 'building')
K.roof_meta(poly, Z0 + R, walkable=False, kind='roof')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48)
