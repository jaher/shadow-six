"""Atlantic Wall turret block (M14 gun 3): an 11 x 10 m board-formed concrete block, flat walkable roof at 3.5 m,
carrying a 5 m armoured naval-type turret (faceted riveted drum, sloped roof plates, mantlet, 10.5 cm barrel trained
NE out to sea, rangefinder ears, periscope hood, hatch) seated in a raised concrete collar on the SE half of the roof
(the NW half stays clear for the roof sentry). Steel ladder on the W wall, steel door on the S face, sand banks.
Variants: a, destroyed (turret blown off its ring and tilted, barrel split, soot, rubble).
Footprint = the body (gameplay rect); front = Blender -Y = game +z.
Usage: blender -b --factory-startup --python gun_turret_block.py -- [a|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 1433)
DEAD = VAR == 'destroyed'
K.begin('gun_turret_block' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='coast')
r = K.rng()
HW, HD, ZR = 5.5, 5.0, 3.5
CT = (0.85, 0.85, 0.82)
TC = V((1.2, -1.6, ZR))                         # turret centre on the roof (SE half; Blender +Y = game north)
TR = 2.3
# barrel bearing: game NE = (+x, -z) -> Blender (+x, +y)
AIM = math.atan2(1.0, 1.0) + math.radians(r.uniform(-6, 6))

# ------------------------------------------------------------------ block, plinth, roof slab, door, ladder
bm = bmesh.new()
M.chamfer_block(bm, -HW, -HD, HW, HD, -0.1, ZR - 0.3, ch=0.25, top_ch=False)
body = M.conc_part(bm, 'body', 'concrete_board', CT)
bm = bmesh.new()
M.chamfer_block(bm, -HW - 0.15, -HD - 0.15, HW + 0.15, HD + 0.15, -0.1, 0.35, ch=0.08)
M.conc_part(bm, 'plinth', 'concrete_bunker', (0.78, 0.78, 0.76))
bm = bmesh.new()
M.chamfer_block(bm, -HW - 0.1, -HD - 0.1, HW + 0.1, HD + 0.1, ZR - 0.32, ZR, ch=0.1, top_ch=True)
roof = M.conc_part(bm, 'roof', 'concrete_bunker', CT)
bm = bmesh.new()                                # entrance porch: recess cut + blast wall
K.cut_object(body, M.cutter_box(-2.6, -HD - 0.5, 0.0, -1.3, -HD + 0.6, 2.2))
M.chamfer_block(bm, -3.4, -HD - 1.8, -0.6, -HD - 1.3, -0.1, 2.3, ch=0.05)
M.conc_part(bm, 'blast_wall', 'concrete_board', CT)
hinge = V((-2.5, -HD + 0.55, 0.02))
bm = bmesh.new()
K.box_bm(bm, (0.55, 0.0, 1.0), (1.1, 0.06, 1.96))
for z in (0.4, 1.0, 1.6):
    K.box_bm(bm, (0.55, -0.045, z), (1.0, 0.025, 0.08))
Rz = Matrix.Rotation(math.radians(-100 if DEAD else -6), 3, 'Z')
for v in bm.verts:
    v.co = hinge + Rz @ v.co
dp = K.part(bm, 'steel_painted', name='door_main_leaf', node='door_main', mat_tint=(0.52, 0.55, 0.5))
dp['kit_pivot'] = list(hinge)
K.door_meta('main', (-1.95, -HD + 0.55, 0.0), (0, -1, 0), 1.1, 2.0, kind='bunker_door', node='door_main')
K.wall_lantern((-0.9, -HD - 0.01, 0), (0, -1, 0), 2.3, name='door_lamp')
K.ladder((-HW - 0.05, 0.0, 0.0), ZR + 0.9, (-1, 0, 0), width=0.5, lean=0.0, mid='steel_painted', name='ladder_w', meta=False)
bm = bmesh.new()                                # firing loopholes (dark slots) on the W and E faces
for s in (-1, 1):
    for y in (-2.8, 2.6):
        K.box_bm(bm, (s * (HW + 0.004), y, 1.6), (0.02, 0.9, 0.18))
K.part(bm, 'interior_dark', name='loopholes', grime=0, bisect=False)

# ------------------------------------------------------------------ turret collar + armoured turret
bm = bmesh.new()
K.cyl_bm(bm, TC - V((0, 0, 0.05)), TC + V((0, 0, 0.45)), TR + 0.55, 28, r1=TR + 0.35)
M.conc_part(bm, 'collar', 'concrete_bunker', (0.8, 0.8, 0.78))
t0 = len(K.A().parts)
Rt = Matrix.Rotation(AIM - math.pi / 2, 3, 'Z')  # turret local -y... barrel along local +y rotated to AIM
def tp(x, y, z):
    return TC + Rt @ V((x, y, z))
bm = bmesh.new()
N = 10
rings = []
for z, rr in ((0.4, TR), (1.35, TR), (1.9, TR - 0.55)):
    rings.append([tp(math.cos(2 * math.pi * (i + 0.5) / N) * rr * (1.0 if math.sin(2 * math.pi * (i + 0.5) / N) > -0.3 else 0.92),
                     math.sin(2 * math.pi * (i + 0.5) / N) * rr, z) for i in range(N)])
K.loft_bm(bm, rings)
drum = K.part(bm, 'steel_painted', name='turret_drum', mat_tint=(0.55, 0.57, 0.5), grime=0.9, bisect=False)
bm = bmesh.new()                                # mantlet + barrel + muzzle
K.box_bm(bm, tuple(tp(0, TR - 0.05, 1.05)), (1.0, 0.5, 0.8), AIM - math.pi / 2)
K.part(bm, 'steel_painted', name='turret_mantlet', mat_tint=(0.5, 0.52, 0.46), grime=0.8, bisect=False)
bm = bmesh.new()
BL = 2.6 if DEAD else 5.4
d = Rt @ V((0, 1, 0.03))
b0 = tp(0, TR + 0.15, 1.05)
K.cyl_bm(bm, b0, b0 + d * 1.2, 0.2, 14, r1=0.17)
K.cyl_bm(bm, b0 + d * 1.2, b0 + d * BL, 0.12, 14, r1=0.1)
if not DEAD:
    K.cyl_bm(bm, b0 + d * (BL - 0.25), b0 + d * BL, 0.14, 14)
K.part(bm, 'steel_painted', name='turret_barrel', mat_tint=(0.48, 0.5, 0.44), smooth=True, grime=0.6, bisect=False)
K.anchor('gun_muzzle', tuple(b0 + d * BL), tuple(d), kind='turret_gun')
bm = bmesh.new()                                # rangefinder ears, periscope hood, hatch, rivet bands, lifting eyes
for s in (-1, 1):
    K.cyl_bm(bm, tp(s * (TR - 0.25), 0.2, 1.55), tp(s * (TR + 0.35), 0.2, 1.55), 0.13, 10)
K.box_bm(bm, tuple(tp(-0.6, -0.3, 2.0)), (0.35, 0.45, 0.28), AIM - math.pi / 2)
K.cyl_bm(bm, tp(0.6, -0.6, 1.9), tp(0.6, -0.6, 1.98), 0.38, 14)
for i in range(N * 3):
    a = 2 * math.pi * i / (N * 3)
    for z in (0.55, 1.25):
        K.box_bm(bm, tuple(tp(math.cos(a) * (TR + 0.01), math.sin(a) * (TR + 0.01), z)), (0.05, 0.05, 0.05))
K.part(bm, 'cast_iron', name='turret_detail', mat_tint=(0.5, 0.5, 0.45), bisect=False, lod='drop')
K.anchor('bomb_target', tuple(tp(0, -TR - 0.3, 0.6)), (0, 1, 0), kind='turret_ring')

# ------------------------------------------------------------------ roof edge rail (N), vents, sand banks
K.railing((-HW + 0.3, HD + 0.02, ZR), (HW - 0.3, HD + 0.02, ZR), 0.9, style='pipe')
bm = bmesh.new()
for x, y in ((-HW + 0.7, -HD + 0.7), (HW - 0.7, HD - 0.7)):
    K.cyl_bm(bm, (x, y, ZR - 0.02), (x, y, ZR + 0.3), 0.15, 10)
    K.cyl_bm(bm, (x, y, ZR + 0.3), (x, y, ZR + 0.36), 0.23, 10)
K.part(bm, 'steel_painted', name='vents', mat_tint=(0.42, 0.42, 0.4), grime=0.8, bisect=False)
for nm, poly, h0, mid in (('bank_e', [(HW + 0.02, HD + 0.02), (HW + 0.02, -HD + 0.6)], 1.8, 'sand'),
                          ('bank_n', [(-HW + 1.0, HD + 0.02), (HW + 0.02, HD + 0.02)], 1.4, 'sod')):
    inn, outl = M.berm_outline(poly, 2.0, side=-1, step=1.2, var=0.2, seed=SEED % 9 + len(nm))
    M.berm(inn, outl, lambda si, t, h0=h0: h0 * (0.8 + 0.2 * math.sin(si + t)), mid, nm, taper_end=0.4, rows=7, step=0.7)

# ------------------------------------------------------------------ weathering
for i in range(9):
    K.decal(r.choice(['moss_patch', 'lichen', 'stain_blotch', 'crack']), (r.uniform(-HW + 0.8, -0.8), r.uniform(-HD + 0.8, HD - 0.8), ZR + 0.004),
            (0, 0, 1), r.uniform(0.9, 1.8), r.uniform(0.7, 1.3), up=(0, 1, 0), alpha=0.45)
for nrm, (cx, cy), w in (((0, -1, 0), (0, -HD - 0.005), 2 * HW), ((-1, 0, 0), (-HW - 0.005, 0), 2 * HD), ((1, 0, 0), (HW + 0.005, 0), 2 * HD)):
    for k in range(5):
        t = (k + 0.5) / 5 - 0.5
        p = (cx + (t * w if nrm[0] == 0 else 0), cy + (t * w if nrm[1] == 0 else 0), ZR - 1.1)
        K.decal(r.choice(['streak_long', 'streak_rain', 'streak_rust']), p, nrm, r.uniform(0.6, 1.2), 1.9, alpha=0.5)
    K.decal('damp_base', (cx, cy, 0.6), nrm, w * 0.9, 0.6, alpha=0.65)
for k in range(4):                                # rust bleeding from the turret ring onto the collar / roof
    a = AIM + math.pi + r.uniform(-1.2, 1.2)
    K.decal('stain_rust_blotch', (TC.x + math.cos(a) * (TR + 0.7), TC.y + math.sin(a) * (TR + 0.7), ZR + 0.005), (0, 0, 1), 0.9, 0.7, alpha=0.6)

# ------------------------------------------------------------------ destroyed
if DEAD:
    tur = K.A().parts[t0:t0 + 4]
    piv = TC + V((0, 0, 0.4))
    T = Matrix.Translation(V((0.4, -0.3, -0.35))) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(17), 4, 'X') @ \
        Matrix.Rotation(math.radians(-9), 4, 'Y') @ Matrix.Rotation(math.radians(25), 4, 'Z') @ Matrix.Translation(-piv)
    M.xform_parts(tur, T)
    K.bite(tuple(TC + V((-1.8, 1.2, 0))), 1.4, (1.0, 1.0, 0.8), seed=3, parts=[roof])
    K.bite((-2.0, -HD, 1.0), 1.3, (1.0, 1.0, 1.0), seed=4, parts=[body])
    M.rubble((-1.0, -HD - 1.0, 0), 1.4, 0.5, mids=('concrete_board', 'concrete_bunker'), n=22, beams=0, tiles=None)
    for p, n, w, h in (((TC.x, TC.y, ZR + 0.02), (0, 0, 1), 6.5, 6.5), ((-2.0, -HD - 0.01, 1.4), (0, -1, 0), 3.5, 2.6)):
        K.decal('soot', p, n, w, h, up=(0, 1, 0) if n[2] else (0, 0, 1), alpha=0.95)
    K.anchor('fire', tuple(TC + V((0, 0, 1.0))), kind='smoulder')

# ------------------------------------------------------------------ metadata
K.footprint([(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)], 'HIGH', 'casemate')
K.roof_meta([(-HW, -HD), (HW, -HD), (HW, HD), (-HW, HD)], ZR, walkable=True, kind='turret_block_roof')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
