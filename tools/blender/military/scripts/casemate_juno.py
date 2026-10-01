"""Juno-sector gun casemates (M14 La Riviere / Courseulles; Regelbau H612 and H679 types): board-formed concrete
block with a FLAT walkable roof at 3.5 m (sentries walk it), stepped (graduated) embrasure, projecting anti-blast
canopy, flanking wing walls (H679), rear entrance with a steel door, gun inside (7.5 cm field gun on its carriage /
7.5 cm PaK 40 with shield), sand drifted against the flanks, rear sod bank, roof vents and a rear pipe rail.
 h612 = 8 x 9 m (g1), h679 = 12 x 9 m (g2); suffix _destroyed: embrasure blown, gun wrecked, soot and rubble.
Footprint = the body exactly (gameplay rect), front = Blender -Y = game +z (local south).
Usage: blender -b --factory-startup --python casemate_juno.py -- [h612|h679|h612_destroyed|h679_destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('h612', 1412)
BASE = VAR.split('_')[0]
DEAD = VAR.endswith('destroyed')
K.begin('casemate_' + VAR, SEED, theater='coast')
r = K.rng()
WIDE = BASE == 'h679'
HW = 6.0 if WIDE else 4.0                      # half width (game w 12 / 8)
Y0, Y1 = -4.5, 4.5                             # front (Blender -Y) .. rear
ZR = 3.5                                       # walkable roof top
ZS = ZR - 0.9                                  # soffit of the roof slab inside
CT = (0.86, 0.86, 0.83)
EMB = (5.4, 2.2) if WIDE else (3.6, 1.5)       # embrasure width at the face / at the throat
EZ0, EZ1 = (0.75, 2.3) if WIDE else (0.85, 2.15)

# ------------------------------------------------------------------ body, embrasure, gun room, corridor
bm = bmesh.new()
M.chamfer_block(bm, -HW, Y0, HW, Y1, -0.1, ZR - 0.25, ch=0.22, top_ch=False)
body = M.conc_part(bm, 'body', 'concrete_board', CT)
c = bmesh.new()
rings = []
steps = ((Y0 - 0.3, EMB[0], EZ0 - 0.1, EZ1 + 0.2), (Y0 + 0.45, EMB[0] - 0.5, EZ0, EZ1 + 0.05),
         (Y0 + 0.5, EMB[0] * 0.72, EZ0 + 0.05, EZ1), (Y0 + 1.1, EMB[0] * 0.6, EZ0 + 0.1, EZ1 - 0.1),
         (Y0 + 1.15, EMB[1] * 1.15, EZ0 + 0.15, EZ1 - 0.2), (Y0 + 1.7, EMB[1], EZ0 + 0.2, EZ1 - 0.25))
for y, w, z0, z1 in steps:                     # graduated (stepped) embrasure: ricochet steps on the cheeks
    rings.append([V((-w / 2, y, z0)), V((w / 2, y, z0)), V((w / 2, y, z1)), V((-w / 2, y, z1))])
K.loft_bm(c, rings)
bmesh.ops.recalc_face_normals(c, faces=c.faces)
K.cut_object(body, c)
GRW = HW * 2 - 2.4
K.cut_object(body, M.cutter_box(-GRW / 2, Y0 + 1.6, 0.0, GRW / 2, Y1 - 2.6, ZS))           # gun room
K.cut_object(body, M.cutter_box(-0.65, Y1 - 2.7, 0.0, 0.65, Y1 + 1, 2.2))                   # rear corridor
NOTCH = 1.4 if WIDE else 0.0                   # H679: open MG position let into the rear-east corner (M14 mg2 sits there)
if NOTCH:
    K.cut_object(body, M.cutter_box(HW - NOTCH, Y1 - NOTCH, -0.5, HW + 1, Y1 + 1, ZR + 1))
bm = bmesh.new()
K.box_bm(bm, (0, (Y0 + Y1) / 2 - 0.5, 0.02), (GRW, Y1 - Y0 - 4.0, 0.04))
K.part(bm, 'concrete_bunker', name='room_floor', tint=(0.5, 0.5, 0.5), grime=0.2, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (0, Y1 - 2.62, ZS / 2), (GRW, 0.04, ZS))
K.box_bm(bm, (0, Y1 - 1.0, 1.1), (1.25, 0.04, 2.2))
K.part(bm, 'interior_dark', name='room_dark', grime=0, bisect=False, jitter=0.1)

# ------------------------------------------------------------------ roof slab (flat, walkable) + canopy
bm = bmesh.new()
M.chamfer_block(bm, -HW - 0.12, Y0 - 0.05, HW + 0.12, Y1 + 0.12, ZR - 0.3, ZR, ch=0.1, top_ch=True)
roof = M.conc_part(bm, 'roof', 'concrete_bunker', CT)
if NOTCH:
    K.cut_object(roof, M.cutter_box(HW - NOTCH, Y1 - NOTCH, ZR - 1, HW + 1, Y1 + 1, ZR + 1))
    bm = bmesh.new()                           # parapet lip round the notch
    K.box_bm(bm, (HW - NOTCH - 0.12, Y1 - NOTCH / 2, ZR + 0.25), (0.24, NOTCH, 0.5))
    K.box_bm(bm, (HW - NOTCH / 2, Y1 - NOTCH - 0.12, ZR + 0.25), (NOTCH, 0.24, 0.5))
    M.conc_part(bm, 'notch_lip', 'concrete_board', CT)
bm = bmesh.new()                               # anti-blast canopy over the embrasure, chamfered, drip groove
cw = EMB[0] / 2 + 0.9
rings = [[V((-cw, Y0 + 0.2, ZR - 0.75)), V((cw, Y0 + 0.2, ZR - 0.75)), V((cw, Y0 + 0.2, ZR - 0.02)), V((-cw, Y0 + 0.2, ZR - 0.02))],
         [V((-cw + 0.3, Y0 - 1.25, ZR - 0.62)), V((cw - 0.3, Y0 - 1.25, ZR - 0.62)), V((cw - 0.3, Y0 - 1.25, ZR - 0.3)), V((-cw + 0.3, Y0 - 1.25, ZR - 0.3))]]
K.loft_bm(bm, rings)
canopy = M.conc_part(bm, 'canopy', 'concrete_board', CT)
cheeks = None
if WIDE:                                       # splayed wing walls flanking the embrasure, tops stepping down
    bm = bmesh.new()
    for s in (-1, 1):
        xi = s * (EMB[0] / 2 + 1.0)
        p = [V((xi, Y0 + 0.1, -0.1)), V((xi + s * 0.7, Y0 - 2.0, -0.1)), V((xi + s * 1.4, Y0 - 1.8, -0.1)), V((xi + s * 0.75, Y0 + 0.1, -0.1))]
        if s > 0:
            p = [p[0], p[3], p[2], p[1]]
        hs = [ZR - 0.4, 1.1, 1.1, ZR - 0.4] if s < 0 else [ZR - 0.4, ZR - 0.4, 1.1, 1.1]
        K.hexa_bm(bm, p + [V((q.x, q.y, h)) for q, h in zip(p, hs)])
    cheeks = M.conc_part(bm, 'cheeks', 'concrete_board', CT)
bm = bmesh.new()                               # apron in front of the embrasure
M.chamfer_block(bm, -EMB[0] / 2 - 0.6, Y0 - 2.2, EMB[0] / 2 + 0.6, Y0 + 0.05, -0.1, 0.05, ch=0.05)
M.conc_part(bm, 'apron', 'concrete_bunker', (0.88, 0.88, 0.86))

# ------------------------------------------------------------------ rear entrance: blast wall, steel door, lamp
bm = bmesh.new()
for s in (-1, 1):
    M.chamfer_block(bm, s * 0.65 + (0 if s > 0 else -0.45), Y1, s * 0.65 + (0.45 if s > 0 else 0), Y1 + 1.6, -0.1, 2.5, ch=0.06)
M.conc_part(bm, 'rear_walls', 'concrete_board', CT)
hinge = V((-0.55, Y1 - 0.15, 0.02))
bm = bmesh.new()
K.box_bm(bm, (0.55, 0.0, 1.0), (1.08, 0.06, 1.96))
for z in (0.35, 1.0, 1.65):
    K.box_bm(bm, (0.55, 0.045, z), (1.0, 0.025, 0.08))
Rz = Matrix.Rotation(math.radians(95 if DEAD else 8), 3, 'Z')
for v in bm.verts:
    v.co = hinge + Rz @ v.co
dp = K.part(bm, 'steel_painted', name='door_rear_leaf', node='door_rear', mat_tint=(0.55, 0.58, 0.52))
dp['kit_pivot'] = list(hinge)
K.door_meta('rear', (0.0, Y1 - 0.15, 0.0), (0, 1, 0), 1.1, 2.0, kind='bunker_door', node='door_rear')
K.wall_lantern((1.0, Y1 + 0.01, 0), (0, 1, 0), 2.25, name='rear_lamp')

# ------------------------------------------------------------------ the gun (shielded 7.5 cm), muzzle in the throat
GY = Y0 + 2.9
yaw = math.radians(r.uniform(-8, 8))
Rg = Matrix.Rotation(yaw, 3, 'Z')
GS = 1.15 if WIDE else 1.0
def g(x, y, z):
    return V((0, GY, 0)) + Rg @ (V((x, y, z)) * GS)
gun0 = len(K.A().parts)
bm = bmesh.new()
for s in (-1, 1):                                                       # split trails + wheels (field carriage)
    K.beam_bm(bm, g(s * 0.3, 0.2, 0.45), g(s * 1.1, 2.4, 0.08), 0.14, 0.18)
    K.cyl_bm(bm, g(s * 0.95, -0.1, 0.62), g(s * 1.13, -0.1, 0.62), 0.62, 18)
K.beam_bm(bm, g(-0.9, -0.1, 0.62), g(0.9, -0.1, 0.62), 0.12, 0.12)
K.part(bm, 'steel_painted', name='gun_carriage', mat_tint=(0.5, 0.53, 0.44), grime=0.7, bisect=False)
bm = bmesh.new()                                                        # bent shield plates
prof = [(-1.0, -0.55, 0.5), (-0.35, -0.75, 0.5), (0.35, -0.75, 0.5), (1.0, -0.55, 0.5)]
for (ax, ay, az), (bx, by, bz) in zip(prof[:-1], prof[1:]):
    K.hexa_bm(bm, [g(ax, ay, az), g(bx, by, bz), g(bx, by + 0.03, bz), g(ax, ay + 0.03, az),
                   g(ax, ay + 0.12, az + 1.05), g(bx, by + 0.12, bz + 1.05), g(bx, by + 0.15, bz + 1.05), g(ax, ay + 0.15, az + 1.05)])
K.part(bm, 'steel_painted', name='gun_shield', mat_tint=(0.52, 0.55, 0.46), grime=0.8, bisect=False)
bm = bmesh.new()
L_B = 3.4 if WIDE else 2.9
b0 = g(0, -0.6, 1.08)
bdir = Rg @ V((0, -1, 0.02))
K.cyl_bm(bm, b0 + bdir * 0.0, b0 + bdir * 1.0, 0.13 * GS, 12, r1=0.11 * GS)        # recoil sleeve
K.cyl_bm(bm, b0 + bdir * 1.0, b0 + bdir * L_B, 0.075 * GS, 12, r1=0.06 * GS)      # tube
K.cyl_bm(bm, b0 + bdir * (L_B - 0.32), b0 + bdir * L_B, 0.11 * GS, 12)            # muzzle brake
K.box_bm(bm, tuple(g(0, 0.35, 1.0)), (0.32, 0.6, 0.3), yaw)                         # breech + cradle
K.part(bm, 'steel_painted', name='gun_barrel', mat_tint=(0.48, 0.5, 0.42), smooth=True, grime=0.6, bisect=False)
K.anchor('gun_muzzle', tuple(b0 + bdir * L_B), tuple(bdir), kind='casemate_gun')
K.anchor('bomb_target', tuple(g(0, 0.4, 0.9)), (0, -1, 0), kind='gun_breech')
bm = bmesh.new()                                                        # ready-use ammo racks along the room walls
for s in (-1, 1):
    K.box_bm(bm, (s * (GRW / 2 - 0.35), GY + 0.2, 0.55), (0.55, 1.6, 1.1))
K.part(bm, 'timber_grey', name='ammo_racks', grime=0.5, bisect=False, lod='drop')

# ------------------------------------------------------------------ roof furniture (kept to the edges: sentries walk it)
bm = bmesh.new()
for x, y in ((-HW + 0.6, Y1 - 0.6), (HW - 0.6 - NOTCH, Y1 - 0.6), (-HW + 0.6, Y0 + 0.7)):
    K.cyl_bm(bm, (x, y, ZR - 0.02), (x, y, ZR + 0.32), 0.16, 10)                    # ventilation stacks
    K.cyl_bm(bm, (x, y, ZR + 0.32), (x, y, ZR + 0.38), 0.24, 10)
K.part(bm, 'steel_painted', name='vents', mat_tint=(0.42, 0.42, 0.4), grime=0.8, bisect=False)
K.railing((-HW + 0.25, Y1 + 0.02, ZR), (-1.4, Y1 + 0.02, ZR), 0.9, style='pipe')
K.railing((1.4, Y1 + 0.02, ZR), (HW - 0.25 - NOTCH, Y1 + 0.02, ZR), 0.9, style='pipe')
bm = bmesh.new()                                                        # iron rungs up the W wall (the GB's climb)
for k in range(7):
    z = 0.5 + k * 0.42
    K.beam_bm(bm, (-HW - 0.12, -0.3, z), (-HW - 0.12, 0.3, z), 0.03, 0.03)
    for yy in (-0.3, 0.3):
        K.beam_bm(bm, (-HW - 0.01, yy, z), (-HW - 0.13, yy, z), 0.03, 0.03)
K.part(bm, 'cast_iron', name='rungs', bisect=False, lod='drop')

# ------------------------------------------------------------------ sand / sod banked against the flanks and the rear
BANKS = [('bank_w', [(-HW - 0.02, Y0 + 1.2), (-HW - 0.02, Y1 + 0.02), (-1.25, Y1 + 0.02)], 1.7, 'sand')]
if not WIDE:                                   # (the wide type's rear-east corner holds the MG position)
    BANKS.append(('bank_e', [(1.25, Y1 + 0.02), (HW + 0.02, Y1 + 0.02), (HW + 0.02, Y0 + 1.2)], 1.5, 'sod'))
for nm, poly, h0, mid in BANKS:
    inn, outl = M.berm_outline(poly, 2.2, side=-1, step=1.2, var=0.18, seed=len(nm) * 1.7 + SEED % 7)
    hfun = lambda si, t, h0=h0: h0 * (0.75 + 0.25 * math.sin(si * 0.9 + t))
    M.berm(inn, outl, hfun, mid, nm, taper_end=0.35, rows=7, step=0.7)

# ------------------------------------------------------------------ weathering
for i in range(10):                                                     # roof: lichen, damp, tar-sealed cracks
    K.decal(r.choice(['moss_patch', 'lichen', 'stain_blotch', 'crack']), (r.uniform(-HW + 0.8, HW - 0.8), r.uniform(Y0 + 0.8, Y1 - 0.8), ZR + 0.004),
            (0, 0, 1), r.uniform(0.9, 2.0), r.uniform(0.7, 1.4), up=(0, 1, 0), alpha=0.45)
for i in range(int(HW * 2)):                                            # front face: rain streaks from the canopy drip
    x = r.uniform(-HW + 0.4, HW - 0.4)
    if abs(x) < EMB[0] / 2 + 0.1:
        continue
    K.decal(r.choice(['streak_long', 'streak_rain', 'streak_rust', 'efflorescence']), (x, Y0 - 0.005, ZR - 1.2), (0, -1, 0), r.uniform(0.5, 1.1), 1.8, alpha=0.55)
for s in (-1, 1):
    K.decal('damp_base', (s * HW * 0.5, Y0 - 0.005, 0.35), (0, -1, 0), HW, 0.7, alpha=0.7)
    K.decal('streak_long', (s * (HW + 0.005), 0.0, 2.0), (s, 0, 0), 3.0, 1.8, alpha=0.5)
    K.decal('lichen', (s * (HW + 0.005), Y0 + 1.0, 0.8), (s, 0, 0), 1.2, 0.9, alpha=0.6)
K.decal('soot', (0, Y0 + 0.3, EZ1 + 0.2), (0, -1, 0), EMB[0] * 0.8, 0.6, alpha=0.45)     # muzzle blast staining
K.decal('stain_blotch', (0, Y0 - 1.2, 0.055), (0, 0, 1), EMB[0], 1.8, up=(0, 1, 0), alpha=0.6)

# ------------------------------------------------------------------ destroyed: embrasure blown out, gun wrecked
if DEAD:
    gun = K.A().parts[gun0:gun0 + 3]
    piv = V((0, GY, 0.6))
    T = Matrix.Translation(V((0.3, -0.25, -0.15))) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-14), 4, 'Y') @ \
        Matrix.Rotation(math.radians(18), 4, 'Z') @ Matrix.Translation(-piv)
    M.xform_parts(gun, T)
    K.bite((0.4, Y0 - 0.4, EZ1 + 0.3), EMB[0] * 0.42, (1.4, 1.0, 0.8), seed=12, parts=[body, roof, canopy])
    K.bite((-HW + 1.2, Y0, ZR - 0.4), 1.2, (1.0, 1.0, 0.9), seed=5, parts=[body, roof])
    M.rubble((-EMB[0] * 0.3, Y0 - 1.6, 0), 1.6, 0.6, mids=('concrete_board', 'concrete_bunker'), n=26, beams=0, tiles=None)
    M.rubble((EMB[0] * 0.4, Y0 - 1.2, 0), 1.1, 0.4, mids=('concrete_bunker',), n=14, beams=0, tiles=None)
    for p, n, w, h in (((0, Y0 - 0.02, 2.0), (0, -1, 0), EMB[0] + 2, 2.6), ((0, Y0 - 0.7, ZR - 0.6), (0, 0, -1), EMB[0], 1.4),
                       ((0, Y0 + 1.5, 0.06), (0, 0, 1), GRW, 3.0), ((0.4, -0.5, ZR + 0.01), (0, 0, 1), 3.0, 2.4)):
        K.decal('soot', p, n, w, h, up=(0, 1, 0) if n[2] else (0, 0, 1), alpha=0.95)
    K.anchor('fire', (0, GY, 1.4), kind='smoulder')

# ------------------------------------------------------------------ metadata (footprint = the gameplay rect)
K.footprint([(-HW, Y0), (HW, Y0), (HW, Y1), (-HW, Y1)], 'HIGH', 'casemate')
K.roof_meta([(-HW, Y0), (HW, Y0), (HW, Y1), (-HW, Y1)], ZR, walkable=True, kind='casemate_roof')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=40)
