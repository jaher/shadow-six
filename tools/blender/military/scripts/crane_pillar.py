"""Quay pillar slewing crane (M13 Le Havre docks; reusable on any 1930s harbour quay):
 a   crane_pillar   riveted steel pillar crane: 1.2 m square base on a granite pad, tapering lattice pillar to the
     slewing ring at 8.5 m, machinery house (riveted plates, windows, door, catwalk with railings, ladder), concrete
     counterweight box at the back, A-frame gantry, 15 m luffing lattice jib raised 38 deg along local +X with tip
     sheaves, hoist and luffing ropes, hook block on a hanging rope. Rust-red lead paint, weathered.
Footprint = the 1.2 m base (HIGH); the jib points along local +X (= the structure's heading).
Usage: blender -b --factory-startup --python crane_pillar.py -- [a] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 1331)
K.begin('crane_pillar', SEED, theater='coast')
r = K.rng()
RED = (0.55, 0.24, 0.16)
DARK = (0.2, 0.2, 0.19)
ZS = 8.5                                               # slewing ring height


def lattice(bm, corners_bot, corners_top, n, w=0.09, diag=True):
    """Four-chord lattice between two rings of 4 corners, n panels, chords + girts + X diagonals."""
    for i in range(4):
        K.beam_bm(bm, corners_bot[i], corners_top[i], w, w)
    for k in range(n + 1):
        t = k / n
        ring = [corners_bot[i].lerp(corners_top[i], t) for i in range(4)]
        for i in range(4):
            K.beam_bm(bm, ring[i], ring[(i + 1) % 4], w * 0.6, w * 0.6)
        if diag and k < n:
            t1 = (k + 1) / n
            ring1 = [corners_bot[i].lerp(corners_top[i], t1) for i in range(4)]
            for i in range(4):
                K.beam_bm(bm, ring[i], ring1[(i + 1) % 4], w * 0.45, w * 0.45)


# ------------------------------------------------------------------ granite pad, pillar base, lattice pillar
bm = bmesh.new()
M.chamfer_block(bm, -0.6, -0.6, 0.6, 0.6, -0.1, 0.25, ch=0.04)
K.part(bm, 'granite', name='pad', grime=0.6, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (0, 0, 0.75), (0.95, 0.95, 1.0), taper=(0.85, 0.85))
for sx in (-1, 1):
    for sy in (-1, 1):
        K.cyl_bm(bm, V((sx * 0.5, sy * 0.5, 0.25)), V((sx * 0.5, sy * 0.5, 0.33)), 0.05, 6)
K.part(bm, 'steel_painted', name='base', mat_tint=RED, grime=1.0, bisect=False)
bot = [V((x, y, 1.25)) for x, y in ((-0.42, -0.42), (0.42, -0.42), (0.42, 0.42), (-0.42, 0.42))]
top = [V((x, y, ZS - 0.4)) for x, y in ((-0.7, -0.7), (0.7, -0.7), (0.7, 0.7), (-0.7, 0.7))]
bm = bmesh.new()
lattice(bm, bot, top, 6, 0.12)
K.box_bm(bm, (0, 0, ZS - 0.2), (1.9, 1.9, 0.4))       # slewing ring housing
K.cyl_bm(bm, V((0, 0, ZS)), V((0, 0, ZS + 0.25)), 1.3, 24)
K.part(bm, 'steel_painted', name='pillar', mat_tint=RED, grime=0.9, bisect=False)
# pillar ladder (W face) with safety hoops
bm = bmesh.new()
for y in (-0.22, 0.22):
    K.beam_bm(bm, V((-0.75, y, 0.3)), V((-0.8, y, ZS - 0.3)), 0.04, 0.04)
for k in range(int((ZS - 0.6) / 0.3)):
    z = 0.45 + k * 0.3
    K.beam_bm(bm, V((-0.77, -0.22, z)), V((-0.77, 0.22, z)), 0.025, 0.025)
K.part(bm, 'steel_painted', name='ladder', mat_tint=DARK, grime=0.6, bisect=False, lod='drop')

# ------------------------------------------------------------------ machinery house, catwalk, counterweight, gantry
Z1 = ZS + 0.25
bm = bmesh.new()
M.chamfer_block(bm, -2.6, -1.3, 1.0, 1.3, Z1, Z1 + 0.22, ch=0.02)   # deck
K.part(bm, 'steel_grating', name='deck', grime=0.6, bisect=False)
bm = bmesh.new()
M.chamfer_block(bm, -2.3, -1.1, 0.9, 1.1, Z1 + 0.22, Z1 + 2.5, ch=0.05)
house = K.part(bm, 'steel_painted', name='house', mat_tint=(0.5, 0.48, 0.42), grime=1.0, bisect=False)
fr_w = [K.Frame(V((0.9, y, Z1 + 1.2)), V((1, 0, 0)), V((0, 1, 0)), 0.8, 0.75, 0.1, 'rect', 'window') for y in (-0.5, 0.5)]
fr_s = K.Frame(V((-0.6, -1.1, Z1 + 1.25)), V((0, -1, 0)), V((1, 0, 0)), 0.9, 0.7, 0.1, 'rect', 'window')
fr_d = K.Frame(V((-1.5, -1.1, Z1 + 0.22)), V((0, -1, 0)), V((1, 0, 0)), 0.7, 1.85, 0.1, 'rect', 'door')
for f in fr_w + [fr_s]:
    K.window(f, 'fixed', (2, 1), frame=DARK, sill=None, lintel=None, surround=None, curtain=0.0, streak=False, name='cab_win')
bm = bmesh.new()                                         # door leaf, roof cap, riveted plate seams
K.box_bm(bm, tuple(fr_d.p(0, 0.93, 0.02)), (0.72, 0.04, 1.85))
K.box_bm(bm, (-0.7, 0, Z1 + 2.58), (3.5, 2.5, 0.16))
for x in (-1.9, -1.1, -0.3, 0.5):
    for y in (-1.12, 1.12):
        K.box_bm(bm, (x, y, Z1 + 1.36), (0.05, 0.03, 2.2))
K.part(bm, 'steel_painted', name='house_trim', mat_tint=(0.42, 0.4, 0.36), grime=1.0, bisect=False)
bm = bmesh.new()
M.chamfer_block(bm, -3.6, -1.0, -2.3, 1.0, Z1 + 0.1, Z1 + 1.9, ch=0.06)
M.conc_part(bm, 'counterweight', 'concrete_bunker', (0.7, 0.7, 0.68))
K.railing((-2.6, -1.3, Z1 + 0.22), (1.0, -1.3, Z1 + 0.22), 1.0, style='pipe')
K.railing((-2.6, 1.3, Z1 + 0.22), (1.0, 1.3, Z1 + 0.22), 1.0, style='pipe')
bm = bmesh.new()                                         # A-frame gantry on the house roof
for y in (-0.9, 0.9):
    K.beam_bm(bm, V((-1.9, y, Z1 + 2.6)), V((-0.9, y * 0.5, Z1 + 5.2)), 0.14, 0.14)
    K.beam_bm(bm, V((0.3, y, Z1 + 2.6)), V((-0.9, y * 0.5, Z1 + 5.2)), 0.12, 0.12)
K.beam_bm(bm, V((-0.9, -0.5, Z1 + 5.2)), V((-0.9, 0.5, Z1 + 5.2)), 0.18, 0.18)
for y in (-0.3, 0.3):
    K.cyl_bm(bm, V((-0.9, y - 0.06, Z1 + 5.32)), V((-0.9, y + 0.06, Z1 + 5.32)), 0.22, 14)
K.part(bm, 'steel_painted', name='gantry', mat_tint=RED, grime=0.9, bisect=False)

# ------------------------------------------------------------------ luffing lattice jib along +X
JL, ANG = 15.0, math.radians(38)
foot = V((0.9, 0, Z1 + 0.6))
tipc = foot + V((math.cos(ANG) * JL, 0, math.sin(ANG) * JL))
ax = (tipc - foot).normalized()
up = V((-math.sin(ANG), 0, math.cos(ANG)))
side = V((0, 1, 0))
cb = [foot + side * s * 0.6 + up * u * 0.55 for s, u in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
ct = [tipc + side * s * 0.22 + up * u * 0.22 for s, u in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
bm = bmesh.new()
lattice(bm, cb, ct, 9, 0.1)
for y in (-0.62, 0.62):                                  # jib foot pins
    K.cyl_bm(bm, foot + V((0, y, -0.4)), foot + V((0, y * 1.1, -0.4)), 0.12, 10)
K.cyl_bm(bm, tipc - side * 0.3, tipc + side * 0.3, 0.32, 16)   # tip sheave
K.part(bm, 'steel_painted', name='jib', mat_tint=RED, grime=0.8, bisect=False)
# ropes: luffing (gantry -> jib head), hoist (house -> tip -> hook), hook block
bm = bmesh.new()
for y in (-0.3, 0.3):
    K.cyl_bm(bm, V((-0.9, y, Z1 + 5.3)), tipc + V((0, y * 0.5, 0.2)), 0.02, 4)
K.cyl_bm(bm, V((0.6, 0, Z1 + 1.8)), tipc + V((0, 0, -0.2)), 0.018, 4)
hook_z = tipc.z - 3.4                                     # hoisted up under the jib head (crane at rest)
K.cyl_bm(bm, tipc + V((0.25, 0, -0.3)), V((tipc.x + 0.25, 0, hook_z + 0.6)), 0.02, 4)
K.part(bm, 'cast_iron', name='ropes', grime=0.3, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (tipc.x + 0.25, 0, hook_z + 0.35), (0.28, 0.22, 0.5))
for k in range(8):                                        # the hook (a curved chain of beams)
    a0, a1 = k * math.pi * 1.4 / 8, (k + 1) * math.pi * 1.4 / 8
    K.beam_bm(bm, V((tipc.x + 0.25 + 0.16 * math.sin(a0), 0, hook_z - 0.16 + 0.16 * math.cos(a0) - 0.1)),
              V((tipc.x + 0.25 + 0.16 * math.sin(a1), 0, hook_z - 0.16 + 0.16 * math.cos(a1) - 0.1)), 0.06, 0.06)
K.part(bm, 'steel_painted', name='hook', mat_tint=(0.75, 0.6, 0.1), grime=0.7, bisect=False)

# weathering
for k in range(6):
    z = r.uniform(1.5, ZS - 1)
    K.decal('streak_rust', (r.choice((-0.62, 0.62)), r.uniform(-0.5, 0.5), z), (r.choice((-1, 1)), 0, 0), 0.25, 1.0, alpha=0.6)
for nrm, c in (((0, -1, 0), (-0.7, -1.11)), ((0, 1, 0), (-0.7, 1.11)), ((-1, 0, 0), (-2.31, 0))):
    K.decal(r.choice(['streak_rust', 'streak_long']), (c[0], c[1], Z1 + 1.4), nrm, 1.2, 1.6, alpha=0.55)
K.decal('stain_rust_blotch', (0, 0, 0.26), (0, 0, 1), 1.4, 1.4, up=(0, 1, 0), alpha=0.5)

K.footprint([(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)], 'HIGH', 'tower_leg')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
