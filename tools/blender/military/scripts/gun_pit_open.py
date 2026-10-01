"""Open coastal gun pit (M14 gun 4; also M7/M8 coastal guns, B1 flak pits): a 9 x 9 m raised concrete apron (walkable
0.55 m step) carrying a Kreisbettung - circular concrete gun bed with a central pivot and an outer steel traverse rail -
and a 155 mm K 418(f) (French GPF, the gun the Germans emplaced along the Calvados coast) on its split-trail carriage,
trail spades riding the rail; ready-use ammunition lockers on two corners, shell and cartridge stacks, a sod bank round
the apron, sand drifting in. Variants: a, destroyed (barrel burst, gun knocked off the pivot, scorched bed).
Footprint = the 9 x 9 apron; the gun points along Blender -Y (game +z, local south).
Usage: blender -b --factory-startup --python gun_pit_open.py -- [a|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 1444)
DEAD = VAR == 'destroyed'
K.begin('gun_pit_open' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='coast')
r = K.rng()
H, ZA, ZB = 4.5, 0.5, 0.56                       # half size, apron top, bed top
CT = (0.84, 0.84, 0.81)

# ------------------------------------------------------------------ apron slab + circular bed + rail + pivot
bm = bmesh.new()
M.chamfer_block(bm, -H, -H, H, H, -0.1, ZA, ch=0.12, top_ch=True)
apron = M.conc_part(bm, 'apron', 'concrete_bunker', (0.82, 0.82, 0.8))
bm = bmesh.new()
K.cyl_bm(bm, (0, 0, ZA - 0.05), (0, 0, ZB), 4.25, 40)
bed = M.conc_part(bm, 'bed', 'concrete_board', CT)
bm = bmesh.new()                                 # traverse rail on sleepers + degree ring marks
N = 48
for i in range(N):
    a0, a1 = 2 * math.pi * i / N, 2 * math.pi * (i + 1) / N
    K.beam_bm(bm, (math.cos(a0) * 3.7, math.sin(a0) * 3.7, ZB + 0.06), (math.cos(a1) * 3.7, math.sin(a1) * 3.7, ZB + 0.06), 0.12, 0.1)
K.part(bm, 'steel_painted', name='rail', mat_tint=(0.45, 0.4, 0.35), grime=0.9, bisect=False)
bm = bmesh.new()
for i in range(24):
    a = 2 * math.pi * i / 24
    K.box_bm(bm, (math.cos(a) * 3.7, math.sin(a) * 3.7, ZB + 0.005), (0.5, 0.2, 0.02), a + math.pi / 2)
K.part(bm, 'timber_tarred', name='sleepers', grime=0.6, bisect=False, lod='drop')
bm = bmesh.new()
K.cyl_bm(bm, (0, 0, ZB), (0, 0, ZB + 0.28), 0.75, 20, r1=0.6)
K.part(bm, 'cast_iron', name='pivot', mat_tint=(0.5, 0.48, 0.45), smooth=True, bisect=False)

# ------------------------------------------------------------------ 155 mm GPF on its split trail
yaw = math.radians(r.uniform(-10, 10))
Rg = Matrix.Rotation(yaw, 3, 'Z')
def g(x, y, z):
    return V((0, 0, ZB)) + Rg @ V((x, y, z))
g0 = len(K.A().parts)
bm = bmesh.new()
for s in (-1, 1):                                # box trails from the axle back to the rail, spades on the rail
    K.beam_bm(bm, g(s * 0.35, -0.2, 0.75), g(s * 1.55, 3.45, 0.2), 0.26, 0.32)
    K.box_bm(bm, tuple(g(s * 1.6, 3.6, 0.25)), (0.7, 0.12, 0.45), yaw)
    K.cyl_bm(bm, g(s * 1.05, -0.25, 0.95), g(s * 1.3, -0.25, 0.95), 0.95, 20)            # steel road wheels
K.beam_bm(bm, g(-1.1, -0.25, 0.95), g(1.1, -0.25, 0.95), 0.16, 0.16)
K.part(bm, 'steel_painted', name='gun_carriage', mat_tint=(0.47, 0.5, 0.4), grime=0.8, bisect=False)
bm = bmesh.new()
BL = 3.2 if DEAD else 6.2
el = math.radians(8 if not DEAD else -3)
bd = Rg @ V((0, -math.cos(el), math.sin(el)))
b0 = g(0, -0.1, 1.55)
K.box_bm(bm, tuple(g(0, 0.2, 1.4)), (0.55, 1.6, 0.42), yaw)                              # cradle + recuperator
K.cyl_bm(bm, b0 - bd * 0.9, b0 + bd * 0.4, 0.27, 14)                                      # breech ring
K.cyl_bm(bm, b0 + bd * 0.4, b0 + bd * BL, 0.17, 14, r1=0.12)                              # tube
if not DEAD:
    K.cyl_bm(bm, b0 + bd * (BL - 0.3), b0 + bd * BL, 0.15, 14)
K.part(bm, 'steel_painted', name='gun_barrel', mat_tint=(0.46, 0.48, 0.4), smooth=True, grime=0.6, bisect=False)
K.anchor('gun_muzzle', tuple(b0 + bd * BL), tuple(bd), kind='coastal_gun')
K.anchor('bomb_target', tuple(g(0, 0.3, 1.0)), (0, -1, 0), kind='gun_breech')
bm = bmesh.new()                                 # small shield, handwheels, sight
K.box_bm(bm, tuple(g(0, -0.55, 1.6)), (1.6, 0.05, 0.9), yaw)
for s in (-1, 1):
    K.cyl_bm(bm, g(s * 0.45, 0.4, 1.3), g(s * 0.52, 0.4, 1.3), 0.2, 12)
K.box_bm(bm, tuple(g(-0.4, 0.0, 1.95)), (0.1, 0.4, 0.14), yaw)
K.part(bm, 'steel_painted', name='gun_detail', mat_tint=(0.5, 0.52, 0.45), bisect=False, lod='drop')

# ------------------------------------------------------------------ ready-use lockers, shells, sod bank
bm = bmesh.new()
for sx, sy in ((-1, 1), (1, 1)):                 # concrete lockers on the rear corners (outside the bed)
    M.chamfer_block(bm, sx * (H - 0.15) - 0.55, sy * (H - 0.15) - 0.45, sx * (H - 0.15) + 0.55, sy * (H - 0.15) + 0.45, ZA - 0.02, ZA + 0.85, ch=0.05)
M.conc_part(bm, 'lockers', 'concrete_board', CT)
bm = bmesh.new()
for sx, sy in ((-1, 1), (1, 1)):
    K.box_bm(bm, (sx * (H - 0.15), sy * (H - 0.15) - 0.455, ZA + 0.45), (0.8, 0.03, 0.6))
K.part(bm, 'steel_painted', name='locker_doors', mat_tint=(0.48, 0.5, 0.44), grime=0.7, bisect=False)
bm = bmesh.new()                                 # shells (with driving bands) and cartridge bags stacked by the trail
for i in range(5):
    p = V((-3.1 + i * 0.32, 3.4, ZA))
    K.cyl_bm(bm, p, p + V((0, 0, 0.62)), 0.078, 10, r1=0.05)
K.part(bm, 'steel_painted', name='shells', mat_tint=(0.9, 0.8, 0.55), smooth=True, bisect=False, lod='drop')
bm = bmesh.new()
for i in range(3):
    K.cyl_bm(bm, V((2.4 + i * 0.36, 3.1, ZA + 0.16)), V((2.4 + i * 0.36, 3.75, ZA + 0.16)), 0.15, 10)
K.part(bm, 'canvas', name='charges', grime=0.6, bisect=False, lod='drop')
inn, outl = M.berm_outline([(-H - 0.02, -H - 0.02), (H + 0.02, -H - 0.02), (H + 0.02, H + 0.02), (-H - 0.02, H + 0.02), (-H - 0.02, -H - 0.02)],
                           1.8, side=1, step=1.3, var=0.18, seed=SEED % 11)
M.berm(inn, outl, lambda si, t: 0.5 + 0.08 * math.sin(si * 1.3 + t), 'sod', 'bank', rows=6, step=0.6)
for i in range(10):                              # sand blown onto the apron, oil and wear on the bed
    a = r.uniform(0, 2 * math.pi)
    K.decal(r.choice(['stain_blotch', 'moss_patch', 'lichen']), (math.cos(a) * r.uniform(1.0, 3.6), math.sin(a) * r.uniform(1.0, 3.6), ZB + 0.004), (0, 0, 1),
            r.uniform(0.8, 1.5), r.uniform(0.6, 1.2), up=(0, 1, 0), alpha=0.5)
for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
    K.decal('stain_blotch', (sx * 3.9, sy * 3.9, ZA + 0.004), (0, 0, 1), 1.4, 1.4, up=(0, 1, 0), alpha=0.5)
for nrm, c in (((0, -1, 0), (0, -H - 0.005)), ((0, 1, 0), (0, H + 0.005)), ((-1, 0, 0), (-H - 0.005, 0)), ((1, 0, 0), (H + 0.005, 0))):
    K.decal('damp_base', (c[0], c[1], 0.2), nrm, 8.0, 0.4, alpha=0.6)

if DEAD:
    gun = K.A().parts[g0:g0 + 3]
    piv = V((0, 0, ZB))
    T = Matrix.Translation(V((0.6, 0.3, -0.05))) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(12), 4, 'Y') @ \
        Matrix.Rotation(math.radians(-22), 4, 'Z') @ Matrix.Translation(-piv)
    M.xform_parts(gun, T)
    K.bite((0, -1.2, ZB), 1.4, (1.2, 1.0, 0.5), seed=7, parts=[bed])
    M.rubble((-2.0, -2.6, ZA), 1.0, 0.35, mids=('concrete_board',), n=12, beams=0, tiles=None)
    K.decal('soot', (0, 0, ZB + 0.01), (0, 0, 1), 8.0, 8.0, up=(0, 1, 0), alpha=0.95)
    K.anchor('fire', (0, 0, ZB + 1.0), kind='smoulder')

K.footprint([(-H, -H), (H, -H), (H, H), (-H, H)], 'HIGH', 'casemate')
K.roof_meta([(-H, -H), (H, -H), (H, H), (-H, H)], ZB, walkable=True, kind='gun_apron')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
