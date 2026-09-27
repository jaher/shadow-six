"""Atlantic Wall coastal gun casemate (M14; Regelbau 671/679 type as at Longues-sur-Mer): massive board-formed
concrete block, wide splayed embrasure under a projecting stepped anti-ricochet visor, flanking cheek walls,
15 cm naval gun with armoured shield on a pedestal mount, rear entrance with steel doors, sod cover on the roof,
earth banks on the flanks, concrete apron. Variants: a (grey), camo (painted ochre/green bands), destroyed (gun
blown: barrel knocked askew, shield torn, visor corner broken, rubble, scorch).
Usage: blender -b --factory-startup --python casemate.py -- [a|camo|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 31)
K.begin('casemate' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='coast')
r = K.rng()
DEAD = VAR == 'destroyed'
CT = (0.92, 0.92, 0.9) if VAR == 'camo' else (0.86, 0.87, 0.85)
if VAR == 'camo':
    M.CONC_WALL = M.CONC_TOP = 'concrete_camo_heer'
X0, X1, Y0, Y1 = -6.0, 6.0, -4.5, 5.5
ZW, ZR = 3.5, 4.4
from mathutils import noise as NZ                       # rework 2: earth cover = a mounded turf layer over the WHOLE
TX0, TX1, TY0, TY1 = X0 - 0.4, X1 + 0.4, Y0 + 0.5, Y1 - 0.45   # slab, 0.8 m in the middle, overhanging and draping
def turf_z(x, y):                                       # 0.45 m down over the W / E edges, thinning at the front and
    sm = lambda u: 0.0 if u <= 0 else (1.0 if u >= 1 else u * u * (3 - 2 * u))      # rear, dished round the obs. pit
    if x < X0 or x > X1:
        o = (X0 - x) if x < X0 else (x - X1)
        return ZR + 0.12 - 0.5 * min(1.0, o / 0.4) ** 1.5
    u = min((x - X0) / 2.4, (X1 - x) / 2.4, (y - TY0) / 1.8, (TY1 - y) / 1.4)
    th = 0.14 + 0.66 * sm(u)
    d = math.hypot(x + 3.4, y - 3.2)
    th *= 0.25 + 0.75 * sm((d - 0.9) / 0.9)
    z = ZR - 0.02 + th + 0.1 * NZ.noise(V((x * 0.6, y * 0.6, 2.2))) * sm(u * 2)
    for cx, cy, cr, cd in CRATERS:                     # R4 destroyed: shell craters blown through the turf to the slab
        d = math.hypot(x - cx, y - cy) * (1 + 0.12 * NZ.noise(V((x * 1.3, y * 1.3, 5.5))))
        if d < cr:
            z -= cd * (1 - (d / cr) ** 2)
        z += 0.22 * math.exp(-((d - cr) / 0.4) ** 2)
    return z
CRATERS = [(2.4, 1.3, 1.8, 1.05), (-1.9, -1.7, 1.3, 0.7), (4.6, -2.9, 0.9, 0.4)] if DEAD else []

# ------------------------------------------------------------------ main block with embrasure + gun room cavity
bm = bmesh.new()
M.chamfer_block(bm, X0, Y0, X1, Y1, -0.08, ZW, ch=0.3, top_ch=False)
body = M.conc_part(bm, 'body', 'concrete_board', CT)
c = bmesh.new()
rings = []
for y, w, z0, z1 in ((Y0 - 0.3, 7.6, 0.85, ZW + 0.2), (Y0 + 0.9, 5.0, 0.95, 3.25), (Y0 + 2.4, 2.6, 0.95, 3.1)):
    rings.append([V((-w / 2, y, z0)), V((w / 2, y, z0)), V((w / 2, y, z1)), V((-w / 2, y, z1))])
K.loft_bm(c, rings)
bmesh.ops.recalc_face_normals(c, faces=c.faces)
K.cut_object(body, c)
K.cut_object(body, M.cutter_box(-3.2, Y0 + 2.2, 0.0, 3.2, 3.2, 3.2))            # gun room
K.cut_object(body, M.cutter_box(-0.7, 3.0, 0.0, 0.7, Y1 + 1, 2.2))               # rear corridor / entrance
# gun-room floor (dark, worn) and back-wall darkness
bm = bmesh.new()
K.box_bm(bm, (0, 0.0, 0.02), (6.3, 5.2, 0.04))
K.part(bm, 'concrete_bunker', name='room_floor', tint=(0.55, 0.55, 0.55), grime=0.2, bisect=False)
bm = bmesh.new()
K.box_bm(bm, (0, 3.15, 1.6), (6.3, 0.04, 3.2))
K.part(bm, 'interior_dark', name='room_dark', grime=0, bisect=False, jitter=0.1)

# ------------------------------------------------------------------ roof slab + stepped visor + cheek walls
bm = bmesh.new()
M.chamfer_block(bm, X0 - 0.2, Y0 + 0.4, X1 + 0.2, Y1 + 0.2, ZW - 0.02, ZR, ch=0.25, top_ch=True)
roof = M.conc_part(bm, 'roof', 'concrete_bunker', CT)
visors = []                                      # curved anti-ricochet visor (Longues M272): the roof slab runs out
# forward as a thick lip, D-shaped in plan, chamfered top edge, undercut drip on the soffit
ARC = [(math.sin(a) * 6.1, Y0 + 0.5 - math.cos(a) * 2.5) for a in [(-math.pi / 2) + math.pi * i / 16 for i in range(17)]]
def ring(off, z):
    out = []
    for x, y in ARC:
        d = V((x / 6.1, (y - (Y0 + 0.5)) / 2.5, 0)).normalized()
        out.append(V((x - d.x * off, y - d.y * off, z)))
    return out
bm = bmesh.new()
back = [V((x, Y0 + 0.6, 0)) for x, y in ARC]
rings = [ring(0.12, ZW - 0.55), ring(0.0, ZW - 0.42), ring(0.0, ZR - 0.3), ring(0.28, ZR)]
vr = [[bm.verts.new(p) for p in rr] for rr in rings]
vb_top = [bm.verts.new((p.x, Y0 + 0.6, ZR)) for p in back]
vb_bot = [bm.verts.new((p.x, Y0 + 0.6, ZW - 0.55)) for p in back]
for a_, b_ in zip(vr[:-1], vr[1:]):
    for i in range(16):
        bm.faces.new((a_[i], a_[i + 1], b_[i + 1], b_[i]))
for i in range(16):
    bm.faces.new((vr[-1][i], vr[-1][i + 1], vb_top[i + 1], vb_top[i]))
    bm.faces.new((vb_bot[i], vb_bot[i + 1], vr[0][i + 1], vr[0][i]))
    bm.faces.new((vb_top[i], vb_top[i + 1], vb_bot[i + 1], vb_bot[i]))
bm.faces.new([vr[k][0] for k in range(4)] + [vb_top[0], vb_bot[0]])
bm.faces.new([vb_bot[16], vb_top[16]] + [vr[k][16] for k in reversed(range(4))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
visors.append(M.conc_part(bm, 'visor', 'concrete_board', CT))
# R4: the visor read as a smooth pale bathtub rim -> board-formed texture (plain variant; camo keeps its paint) at a
# darker tint, vertex-colour AO gradient (dark under the drip, lighter towards the chamfered top), black soffit,
# spalled rim (small blast bites), cracks / rust bleed / efflorescence / damp on the face.
vis = visors[-1]
vb2 = bmesh.new()
vb2.from_mesh(vis.data)
vb2.normal_update()
VM = 'concrete_camo_heer' if VAR == 'camo' else 'concrete_formwork'
vt_ = K.tile_of(VM) * (1.0 if VAR == 'camo' else 0.7)
uvl = vb2.loops.layers.uv.get('UVMap') or vb2.loops.layers.uv.new('UVMap')
for f in vb2.faces:                                # arc-length UVs round the curve: paint / boards continuous across facets
    for l in f.loops:
        p_ = l.vert.co
        if abs(f.normal.z) > 0.7:
            l[uvl].uv = (p_.x / vt_ + 0.37, p_.y / vt_ + 0.11)
        else:
            a_ = math.atan2(p_.x / 6.1, -(p_.y - (Y0 + 0.5)) / 2.5)
            l[uvl].uv = (a_ * 4.4 / vt_ + 0.37, p_.z / vt_)
vis.data.materials[0] = K.mat(VM, CT if VAR == 'camo' else (0.74, 0.73, 0.7))
vis['conc_fixed'] = 1
cl = vb2.loops.layers.color.get('Col')
zlo, zhi = ZW - 0.55, ZR
for f in vb2.faces:
    for l in f.loops:
        t = max(0.0, min(1.0, (l.vert.co.z - zlo) / (zhi - zlo)))
        k = 0.34 if f.normal.z < -0.5 else (0.5 + 0.5 * t ** 0.8) * (0.92 if f.normal.z > 0.5 else 1.0)
        c0 = l[cl]
        l[cl] = (c0[0] * k, c0[1] * k, c0[2] * k, c0[3])
vb2.to_mesh(vis.data)
vb2.free()
def arcp(a, z, off=0.0):
    n = V((math.sin(a) / 6.1, -math.cos(a) / 2.5, 0)).normalized()
    return V((math.sin(a) * 6.1, Y0 + 0.5 - math.cos(a) * 2.5, z)) + n * off, n
for k, a in enumerate((-1.25, -0.7, -0.15, 0.45, 0.95, 1.35)):
    p_, n_ = arcp(a + r.uniform(-0.1, 0.1), ZR - 0.12)
    K.bite(tuple(p_ + n_ * 0.12), r.uniform(0.22, 0.34), (1.2, 0.9, 0.8), seed=40 + k, parts=[vis])
for k in range(10):
    a = r.uniform(-1.4, 1.4)
    p_, n_ = arcp(a, r.uniform(ZW - 0.2, ZR - 0.5), 0.004)
    kind = ['crack', 'crack', 'stain_rust_blotch', 'efflorescence', 'stain_blotch'][k % 5]
    K.decal(kind, tuple(p_), tuple(n_), r.uniform(0.6, 1.2), r.uniform(0.5, 0.9), alpha=0.65)
for a in (-1.0, 0.0, 1.0):
    p_, n_ = arcp(a, ZW - 0.3, 0.004)
    K.decal('damp_base', tuple(p_), tuple(n_), 4.0, 0.5, alpha=0.7)
bm = bmesh.new()                                 # flanking cheek walls, splayed outward, top sloping down
for s in (-1, 1):
    x_in = s * 5.2
    p = [V((x_in, Y0 + 0.2, 0)), V((x_in + s * 0.9, Y0 - 1.9, 0)), V((x_in + s * 1.9, Y0 - 1.6, 0)), V((x_in + s * 1.0, Y0 + 0.2, 0))]
    if s > 0:
        p = [p[0], p[3], p[2], p[1]]
    hs = [ZR - 0.1, 1.2, 1.2, ZR - 0.1] if s < 0 else [ZR - 0.1, ZR - 0.1, 1.2, 1.2]
    K.hexa_bm(bm, [q + V((0, 0, -0.08)) for q in p] + [q + V((0, 0, h)) for q, h in zip(p, hs)])
cheeks = M.conc_part(bm, 'cheeks', 'concrete_board', CT)
bm = bmesh.new()                                 # apron in front of the embrasure
M.chamfer_block(bm, -4.6, Y0 - 3.2, 4.6, Y0 + 0.1, -0.08, 0.05, ch=0.05)
M.conc_part(bm, 'apron', 'concrete_bunker', (0.9, 0.9, 0.88))
# rear entrance: door, frame, wing walls
bm = bmesh.new()
for s in (-1, 1):
    M.chamfer_block(bm, s * 0.7 + (0 if s > 0 else -0.5), Y1, s * 0.7 + (0.5 if s > 0 else 0), Y1 + 2.4, -0.08, 2.6, ch=0.06)
M.conc_part(bm, 'rear_walls', 'concrete_board', CT)
hinge = V((-0.55, 3.7, 0.02))
ang = math.radians(15 if not DEAD else 95)
bm = bmesh.new()
K.box_bm(bm, (0.55, 0.0, 1.0), (1.08, 0.06, 1.98))
for z in (0.35, 1.0, 1.65):
    K.box_bm(bm, (0.55, 0.045, z), (1.0, 0.025, 0.08))
Rz = Matrix.Rotation(ang, 3, 'Z')
for v in bm.verts:
    v.co = hinge + Rz @ v.co
dp = K.part(bm, 'steel_painted', name='door_rear_leaf', node='door_rear', mat_tint=(0.62, 0.64, 0.6))
dp['kit_pivot'] = list(hinge)
K.door_meta('rear', (0.0, 3.7, 0.0), (0, 1, 0), 1.1, 2.0, kind='bunker_door', node='door_rear')
bm = bmesh.new()
K.box_bm(bm, (0, 3.2, 1.0), (1.3, 0.04, 2.0))
K.part(bm, 'interior_dark', name='corridor_dark', grime=0, bisect=False)

# ------------------------------------------------------------------ the gun: 15 cm SK C/28 in shielded pedestal mount
GY = -0.7                                 # pivot of the mount (well forward: shield fills the embrasure mouth)
yaw = math.radians(r.uniform(-12, 12))
gun_parts0 = len(K.A().parts)
Rg = Matrix.Rotation(yaw, 3, 'Z')
def g(x, y, z):
    return V((0, GY, 0)) + Rg @ V((x, y, z))
bm = bmesh.new()
K.cyl_bm(bm, g(0, 0, 0.02), g(0, 0, 0.55), 1.05, 16, r1=0.95)          # pedestal / racer ring
K.part(bm, 'steel_painted', name='gun_base', mat_tint=(0.75, 0.78, 0.74), smooth=True)
bm = bmesh.new()                                                       # shield: faceted front, sloped roof, open rear
prof = [(-1.3, -1.0, 0.55), (1.3, -1.0, 0.55), (1.45, 0.2, 0.55), (1.45, 1.6, 0.55), (-1.45, 1.6, 0.55), (-1.45, 0.2, 0.55)]
top = [(-1.05, -0.75, 2.45), (1.05, -0.75, 2.45), (1.25, 0.2, 2.55), (1.25, 1.6, 2.55), (-1.25, 1.6, 2.55), (-1.25, 0.2, 2.55)]
vb = [bm.verts.new(g(*p)) for p in prof]
vt = [bm.verts.new(g(*p)) for p in top]
for i in range(6):
    j = (i + 1) % 6
    if i == 3:
        continue                                                       # open back
    bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
bm.faces.new(vt)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
# thicken shield plates
ret = bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.06)
shield = K.part(bm, 'steel_painted', name='gun_shield', mat_tint=(0.62, 0.64, 0.5) if VAR == 'camo' else (0.72, 0.75, 0.7), grime=0.7)
bm = bmesh.new()
K.box_bm(bm, tuple(g(0, -1.02, 1.6)), (0.7, 0.1, 0.8), yaw)             # mantlet
K.part(bm, 'steel_painted', name='gun_mantlet', mat_tint=(0.7, 0.72, 0.68))
bm = bmesh.new()
elev = math.radians(3 if not DEAD else -2)
bdir = Rg @ V((0, -math.cos(elev), math.sin(elev)))
b0 = g(0, -0.9, 1.6)
K.cyl_bm(bm, b0 + bdir * 0.1, b0 + bdir * 2.4, 0.42, 14, r1=0.37)     # reinforce jacket (R4: girth x1.4 -> reads at 1x)
CH = 4.3 if DEAD else 7.6                                              # destroyed: chase burst at 4.3 m
K.cyl_bm(bm, b0 + bdir * 2.4, b0 + bdir * CH, 0.31, 16, r1=0.31 - 0.09 * (CH - 2.4) / 5.2)       # chase
if not DEAD:
    K.cyl_bm(bm, b0 + bdir * 7.4, b0 + bdir * 7.8, 0.25, 16, r1=0.3)  # muzzle swell
    K.cyl_bm(bm, b0 + bdir * 7.8, b0 + bdir * 7.86, 0.3, 16, r1=0.14) # crown
else:                                                                 # burst end: petalled, torn outwards
    for k in range(7):
        a = k * 2 * math.pi / 7 + 0.3
        side = Rg @ V((math.cos(a), 0, math.sin(a)))
        K.box_bm(bm, tuple(b0 + bdir * (CH + 0.2) + side * 0.3), (0.12, 0.45, 0.05), yaw)
K.cyl_bm(bm, b0 + bdir * 2.25, b0 + bdir * 2.5, 0.45, 14)             # jacket collar
K.cyl_bm(bm, g(0, -0.7, 1.95), g(0, 1.4, 1.95), 0.09, 8)              # recuperator
K.cyl_bm(bm, g(0, 0.2, 1.6), g(0, 1.5, 1.6), 0.25, 12)                 # breech ring
K.part(bm, 'steel_painted', name='gun_barrel', mat_tint=(0.66, 0.68, 0.6), smooth=True, grime=0.5)
bm = bmesh.new()                                                       # rivets on the shield front
for i in range(9):
    for zz in (0.75, 2.3):
        K.box_bm(bm, tuple(g(-1.2 + i * 0.3, -1.03 - (0.0 if zz < 1 else 0.24), zz)), (0.04, 0.03, 0.04), yaw)
K.part(bm, 'cast_iron', name='gun_rivets', bisect=False, lod='drop')
K.anchor('gun_muzzle', tuple(b0 + bdir * 7.85), tuple(bdir), kind='coastal_gun')
K.anchor('bomb_target', tuple(g(0, 0.6, 1.0)), (0, -1, 0), kind='gun_breech')
# shell racks + ammo boxes along the room wall
bm = bmesh.new()
for i in range(6):
    K.cyl_bm(bm, (-3.0 + i * 0.26, 2.9, 0.1), (-3.0 + i * 0.26, 2.9, 0.75), 0.075, 8, r1=0.05)
K.box_bm(bm, (2.4, 2.7, 0.2), (0.9, 0.5, 0.4))
K.part(bm, 'steel_painted', name='shells', mat_tint=(0.95, 0.85, 0.6), bisect=False, lod='drop')

# gun detail: training / elevation handwheels, sight, breech block, deck plates, ready-use niches
bm = bmesh.new()
for sx in (-1, 1):
    hc = g(sx * 0.75, 0.3, 1.25)
    K.cyl_bm(bm, hc, hc + Rg @ V((sx * 0.05, 0, 0)), 0.22, 12)
    K.cyl_bm(bm, hc, g(sx * 0.35, 0.3, 1.4), 0.03, 6)
K.box_bm(bm, tuple(g(-0.45, -0.3, 2.1)), (0.12, 0.5, 0.14), yaw)              # sight housing
K.box_bm(bm, tuple(g(0, 1.55, 1.6)), (0.42, 0.18, 0.42), yaw)                 # breech block
K.cyl_bm(bm, g(0, 0, 0.56), g(0, 0, 0.6), 1.5, 20)                            # deck plate
K.part(bm, 'steel_painted', name='gun_detail', mat_tint=(0.6, 0.62, 0.58), smooth=False)
bm = bmesh.new()
for i in range(4):
    for s in (-1, 1):
        x = s * 3.2
        K.box_bm(bm, (x, -0.6 + i * 1.0, 1.1), (0.04, 0.7, 0.9))
K.part(bm, 'interior_dark', name='niches', grime=0, bisect=False)
# embrasure lip armour angle + rear vents, lamp, ammo trolley rails
bm = bmesh.new()
K.beam_bm(bm, (-3.8, Y0 - 0.32, 0.86), (3.8, Y0 - 0.32, 0.86), 0.12, 0.1)
for x in (-3.5, 3.5):
    K.box_bm(bm, (x, Y1 + 0.03, 2.9), (0.6, 0.06, 0.35))
for x in (-0.25, 0.25):
    K.beam_bm(bm, (x, 3.4, 0.02), (x, Y1 + 2.4, 0.02), 0.06, 0.04)
K.part(bm, 'cast_iron', name='steelwork', grime=0.4)
K.wall_lantern((1.2, Y1 + 0.0, 0), (0, 1, 0), 2.3, name='rear_lamp')
# front wire + camouflage-net poles on the roof
bm = bmesh.new()
M.concertina(bm, (-8.5, Y0 - 5.2, 0), (8.5, Y0 - 5.2, 0), radius=0.4)
for x in (-8.3, -4.2, 0.0, 4.2, 8.3):
    K.cyl_bm(bm, (x, Y0 - 5.2, 0), (x, Y0 - 5.2, 1.0), 0.015, 4)
M.wire_part(bm, 'wire')
K.footprint([(-8.7, Y0 - 5.7), (8.7, Y0 - 5.7), (8.7, Y0 - 4.7), (-8.7, Y0 - 4.7)], 'FENCE', 'wire')
K.railing((X0 + 0.3, Y1 - 0.1, ZR), (-1.6 if not DEAD else -3.2, Y1 - 0.1, ZR), 1.0, style='pipe')     # rear roof-edge guard rails
if not DEAD:
    K.railing((1.6, Y1 - 0.1, ZR), (X1 - 0.3, Y1 - 0.1, ZR), 1.0, style='pipe')
else:                                                  # R4: blast-bent rail: stanchions leaning, pipe kinked, a length on the turf
    bm = bmesh.new()
    pts = [V((1.6, Y1 - 0.1, ZR + 1.0)), V((2.6, Y1 - 0.2, ZR + 0.95)), V((3.3, Y1 - 0.6, ZR + 0.55)), V((3.6, Y1 - 1.3, ZR + 0.3))]
    for a_, b_ in zip(pts[:-1], pts[1:]):
        K.cyl_bm(bm, a_, b_, 0.024, 6)
    for x0, lean in ((1.6, 0.0), (2.6, 0.25), (3.3, 0.6)):
        K.cyl_bm(bm, (x0, Y1 - 0.1, ZR), (x0 + lean * 0.3, Y1 - 0.1 - lean, ZR + 1.0 - lean * 0.45), 0.022, 6)
    K.cyl_bm(bm, (4.4, Y1 - 1.6, ZR + 0.72), (5.8, Y1 - 2.3, ZR + 0.7), 0.024, 6)          # torn-off length on the turf
    K.cyl_bm(bm, (5.0, Y1 - 0.1, ZR), (5.3, Y1 - 0.5, ZR + 0.35), 0.022, 6)                  # snapped stanchion stub
    K.part(bm, 'steel_painted', name='rail_bent', mat_tint=(0.42, 0.4, 0.36), bisect=False)
if VAR != 'destroyed':                                   # garnished net over the rear roof, draping onto the east berm
    M.camo_net(0.8, 0.6, X1 + 2.6, Y1 + 2.4, lambda x, y: turf_z(x, min(y, TY1)) + 0.1 if (x < X1 + 0.3 and y < Y1) else max(0.1, (ZW - 0.2) * max(0.0, 1 - max(x - X1, y - Y1, 0) / 4.5)) + 0.15,
               drop=lambda x, y: ZR + 0.3 if (x < X1 and y < Y1) else max(0.1, (ZW - 0.2) * max(0.0, 1 - max(x - X1, y - Y1, 0) / 4.5) - 0.05), tint=(0.52, 0.56, 0.4),
               poles=[(2.4, 2.2, ZR + 1.6), (X1 - 1.0, -0.6, ZR + 1.5), (X1 + 1.6, Y1 + 1.2, 2.6)], sag=0.25)
bm = bmesh.new()                                 # sandbagged observation pit on the roof (range-taker)
M.sandbag_ring(bm, (-3.4, 3.2, 0), 0.9, courses=3, gap_ang=math.radians(90), gap_w=0.7, z0=ZR + 0.15, r=r)
M.sandbags_part(bm, 'roof_obs_bags')
bm = bmesh.new()
K.cyl_bm(bm, (-3.4, 3.2, ZR + 0.2), (-3.4, 3.2, ZR + 1.1), 0.04, 6)
K.beam_bm(bm, (-3.9, 3.2, ZR + 1.15), (-2.9, 3.2, ZR + 1.15), 0.08, 0.1)
K.part(bm, 'steel_painted', name='rangefinder', mat_tint=(0.6, 0.62, 0.58), bisect=False, lod='drop')
K.anchor('observer', (-3.4, 3.2, ZR + 0.2), (0, -1, 0), kind='lookout')
# ------------------------------------------------------------------ sod cover on the roof + earth flanks
bm = bmesh.new()
NXT, NYT = (38, 20) if DEAD else (30, 16)
g = [[bm.verts.new((TX0 + (TX1 - TX0) * i / NXT, TY0 + (TY1 - TY0) * j / NYT, 0)) for i in range(NXT + 1)] for j in range(NYT + 1)]
for row in g:
    for v in row:
        v.co.x += NZ.noise(V((v.co.x * 0.5, v.co.y * 0.5, 9.1))) * 0.12 * (1 if 0 < v.co.y - TY0 < TY1 - TY0 - 0.01 else 0)
        v.co.z = turf_z(v.co.x, v.co.y)
for j in range(NYT):
    for i in range(NXT):
        bm.faces.new((g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]))
for f in bm.faces:
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
M.planar_uv(K.part(bm, 'sod', name='roof_sod', grime=0.3, smooth=True, bisect=False), 'sod')
for nm, poly, hf in (('berm_w', [(X0 - 0.02, Y0 + 0.4), (X0 - 0.02, Y1 + 0.02), (-1.2, Y1 + 0.02)],
                     lambda x: (ZW - 0.2) if x < X0 + 0.1 else (ZW - 0.2) * (1 - 0.7 * (x - X0) / (-1.2 - X0))),
                    ('berm_e', [(1.2, Y1 + 0.02), (X1 + 0.02, Y1 + 0.02), (X1 + 0.02, Y0 + 0.4)],
                     lambda x: (ZW - 0.2) if x > X1 - 0.1 else (ZW - 0.2) * (0.3 + 0.7 * (x - 1.2) / (X1 - 1.2)))):
    inn, outl = M.berm_outline(poly, 4.4, side=-1, step=1.5, var=0.2, seed=len(nm) * 1.3 + (0 if nm[-1] == 'w' else 5))
    hfun = lambda si, t, inn=inn, hf=hf: hf(inn[si][0] + (inn[min(si + 1, len(inn) - 1)][0] - inn[si][0]) * t)
    M.berm(inn, outl, hfun, 'sod', nm, taper_end=0.3, rows=9, step=0.7)

# ------------------------------------------------------------------ weathering / camo
for i in range(8):
    K.decal(r.choice(['moss_patch', 'lichen', 'stain_blotch']), (r.uniform(-5.5, 5.5), r.uniform(-5.8, -2.0), ZR + 0.004), (0, 0, 1),
            r.uniform(1.2, 2.4), r.uniform(0.8, 1.6), up=(0, 1, 0), alpha=0.4)
for i in range(14):
    x = r.uniform(-5.2, 5.2)
    K.decal(r.choice(['streak_long', 'streak_rain', 'streak_rust']), (x, Y0 + 0.5 - 2.5 * math.sqrt(max(0.0, 1 - (x / 6.1) ** 2)) - 0.03, ZW - 0.1), (0, -1, 0), r.uniform(0.8, 1.6), 0.7, alpha=0.5)
for s in (-1, 1):
    K.decal('streak_long', (s * 5.9, Y0 - 1.0, 2.4), (s * 0.9, -0.43, 0), 1.5, 2.0, alpha=0.5)
    K.decal('lichen', (s * 5.6, Y0 - 1.3, 0.9), (s * 0.9, -0.43, 0), 1.3, 1.0, alpha=0.6)
    K.decal('damp_base', (s * 5.8, Y0 - 1.1, 0.35), (s * 0.9, -0.43, 0), 2.2, 0.8, alpha=0.6)

# ------------------------------------------------------------------ destroyed
if DEAD:
    gun = K.A().parts[gun_parts0:gun_parts0 + 5]
    piv = V((0, GY, 0.55))
    # R4: mount blown off its racer ring: shield / mantlet / barrel slewed and dumped 0.5 m lower, rolled 16 deg
    T = Matrix.Translation(V((0.35, -0.2, -0.12))) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-12), 4, 'Y') @ \
        Matrix.Rotation(math.radians(-9), 4, 'X') @ Matrix.Rotation(math.radians(14), 4, 'Z') @ Matrix.Translation(-piv)
    M.xform_parts(gun[1:], T)
    K.bite((-4.6, Y0 - 1.2, ZR - 0.2), 1.7, (1.3, 1.0, 0.9), seed=2, parts=visors + [cheeks, roof])
    K.bite((0.6, Y0 - 1.4, ZW - 0.3), 2.1, (1.5, 1.0, 0.75), seed=12, parts=visors + [roof, body])     # embrasure blown open
    K.bite((-2.6, Y0 - 0.1, 1.4), 1.3, (1.0, 1.0, 1.3), seed=13, parts=[body])
    bm = bmesh.new()                                   # rebar sprung from the blown lip / jamb
    for cx, cy, cz, rad in ((0.6, Y0 - 1.4, ZW - 0.3, 2.1), (-4.6, Y0 - 1.2, ZR - 0.2, 1.7), (-2.6, Y0 - 0.1, 1.4, 1.3)):
        for i in range(12):
            a = r.uniform(0, 2 * math.pi)
            p = V((cx + math.cos(a) * rad * 0.9, cy + r.uniform(-0.3, 0.3), cz + math.sin(a) * rad * 0.6))
            d = (p - V((cx, cy, cz))).normalized()
            q = p - d * r.uniform(0.35, 0.9) + V((r.uniform(-0.2, 0.2), r.uniform(-0.3, 0.1), r.uniform(-0.35, 0.2)))
            K.cyl_bm(bm, p + d * 0.25, q, 0.014, 4)
    K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.55, 0.38, 0.26), grime=0, bisect=False, lod='drop')
    bm = bmesh.new()                                   # burst muzzle half of the barrel lying on the apron
    fa, fb = V((1.8, Y0 - 3.3, 0.3)), V((4.9, Y0 - 2.4, 0.26))
    K.cyl_bm(bm, fa, fb, 0.27, 14, r1=0.23)
    K.cyl_bm(bm, fb - (fb - fa).normalized() * 0.35, fb, 0.25, 14, r1=0.3)
    K.part(bm, 'steel_painted', name='barrel_fragment', mat_tint=(0.5, 0.5, 0.45), smooth=True, grime=0.8)
    for k in range(3):                                 # spalled slabs with rebar ends
        M.rubble((r.uniform(-3.5, 3.5), Y0 - r.uniform(3.4, 5.0), 0), r.uniform(0.5, 0.9), 0.25, mids=('concrete_board',), n=5, beams=0, tiles=None, footprint=False, name='spall')
    K.bite((1.0, Y0 - 0.9, 1.6), 1.0, (1.0, 1.0, 1.0), seed=6, parts=[shield])
    K.bite((3.8, Y0, 1.4), 1.2, (1.0, 1.0, 1.0), seed=9, parts=[body])
    M.rubble((-4.2, Y0 - 2.4, 0), 2.0, 0.8, mids=('concrete_board', 'concrete_bunker'), n=34, beams=0, tiles=None)
    M.rubble((2.8, Y0 - 2.0, 0), 1.4, 0.45, mids=('concrete_bunker', 'concrete_board'), n=16, beams=0, tiles=None)
    for p, n, w, h in (((0, Y0 - 2.04, 3.45), (0, -1, 0), 5.5, 0.9), ((0, Y0 - 0.9, ZW - 0.565), (0, 0, -1), 7.0, 2.4),    # visor face + soffit
                       ((-4.8, Y0 - 0.01, 2.0), (0, -1, 0), 1.7, 3.2), ((4.8, Y0 - 0.01, 2.0), (0, -1, 0), 1.7, 3.2),       # jambs
                       ((-3.2, Y0 + 1.0, 2.2), (0.95, 0.3, 0), 2.2, 2.6), ((3.2, Y0 + 1.0, 2.2), (-0.95, 0.3, 0), 2.2, 2.6),  # splays
                       ((3.8, Y0 - 0.01, 2.4), (0, -1, 0), 2.0, 2.2), ((0, Y0 - 0.9, ZR + 0.02), (0, 0, 1), 6.0, 2.6),
                       ((0, 0.4, 0.06), (0, 0, 1), 5.5, 4.0), ((-2.6, Y0 - 0.01, 1.8), (0, -1, 0), 3.0, 3.0),
                       ((2.4, 1.3, ZR + 0.05), (0, 0, 1), 3.8, 3.8), ((-1.9, -1.7, ZR + 0.12), (0, 0, 1), 2.6, 2.6)):
        K.decal('soot', p, n, w, h, up=(0, 1, 0) if n[2] else (0, 0, 1), alpha=0.95)
    K.decal('soot', (0, Y0 - 1.6, 0.07), (0, 0, 1), 6, 3.5, up=(0, 1, 0), alpha=0.9)
    K.anchor('fire', (0, GY, 1.5), kind='smoulder')

# ------------------------------------------------------------------ metadata
K.footprint([(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)], 'HIGH', 'casemate')
K.footprint([(-6.1, Y0 - 1.9), (-5.2, Y0 - 1.9), (-5.2, Y0 + 0.2), (-6.1, Y0 + 0.2)], 'HIGH', 'cheek')
K.footprint([(5.2, Y0 - 1.9), (6.1, Y0 - 1.9), (6.1, Y0 + 0.2), (5.2, Y0 + 0.2)], 'HIGH', 'cheek')
K.roof_meta([(X0, Y0 - 1.0), (-3.0, Y0 - 1.8), (3.0, Y0 - 1.8), (X1, Y0 - 1.0), (X1, Y1 + 0.2), (X0, Y1 + 0.2)], ZR, walkable=True, kind='casemate_roof')
K.climb_meta((X0, Y1), (X0, 0.0), ZR, 'berm')
K.climb_meta((X1, 0.0), (X1, Y1), ZR, 'berm')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48)
