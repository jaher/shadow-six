"""German concrete garrison bunker (Regelbau-style group shelter, 1942-44): board-formed concrete block with chamfered
edges and a projecting roof slab, recessed entrance with armoured steel door covered by a flanking MG embrasure
(stepped reveal), observation slit, Tobruk ring pit on the roof with sandbags, periscope, vent + stove pipes,
earth berms banked on the sides/back, concertina wire. Variants: a (grey), desert (ochre wash, sand berms),
snow, destroyed (blast bites, rubble, rebar, scorch, blown door).
Usage: blender -b --factory-startup --python bunker.py -- [a|desert|snow|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V, Matrix

VAR, SEED = M.args('a', 21)
theater = {'snow': 'snow', 'desert': 'desert'}.get(VAR, 'temperate')
K.begin('bunker' + ('' if VAR == 'a' else '_' + VAR), SEED, theater=theater, snow=VAR == 'snow')
r = K.rng()
DEAD = VAR == 'destroyed'
CT = {'desert': (1.08, 0.98, 0.8), 'a': (0.92, 0.92, 0.9)}.get(VAR, (0.9, 0.9, 0.88))       # concrete tint
if VAR == 'a':                                             # 1944 three-colour disruptive paint on walls and roof
    M.CONC_WALL = M.CONC_TOP = 'concrete_camo_heer'
EARTH = {'desert': 'gravel', 'snow': 'mud'}.get(VAR, 'sod')        # desert: same gravel as the reg ground (no pink sheet)

X0, X1, Y0, Y1 = -4.4, 4.4, -3.4, 3.4
ZT = 2.35                    # top of walls
ZR = 2.85                    # top of roof slab
# ------------------------------------------------------------------ main block + roof slab (one solid, cut later)
bm = bmesh.new()
M.chamfer_block(bm, X0, Y0, X1, Y1, -0.08, ZT, ch=0.2, top_ch=False)
body = M.conc_part(bm, 'body', 'concrete_board', CT)
bm = bmesh.new()
M.chamfer_block(bm, X0 - 0.35, Y0 - 0.45, X1 + 0.35, Y1 + 0.3, ZT - 0.02, ZR, ch=0.22, top_ch=True)
roof = M.conc_part(bm, 'roof_slab', 'concrete_bunker', CT)

# entrance recess (open to the front) + door opening, embrasure (stepped, splayed), observation slit, Tobruk pit
EX0, EX1, EY = 0.9, 2.7, -1.75            # recess x-range, back wall y
def cutter_box(x0, y0, z0, x1, y1, z1):
    c = bmesh.new()
    K.box_bm(c, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0))
    return c
K.cut_object(body, cutter_box(EX0, Y0 - 1, -0.1, EX1, EY, 2.15))
K.cut_object(roof, cutter_box(EX0 + 0.05, Y0 - 1, ZT - 0.1, EX1 - 0.05, Y0 + 0.05, ZT + 0.05))
DX = (EX0 + EX1) / 2
K.cut_object(body, cutter_box(DX - 0.5, EY - 0.1, 0.0, DX + 0.5, EY + 0.9, 1.95))       # door passage
# embrasure: frustum from 1.3 x 0.7 at the face to 0.36 x 0.22 at 1.1 m depth (3 steps)
EMX, EMZ = -1.9, 1.15
c = bmesh.new()
steps = [(Y0 - 0.2, 1.9, 1.05), (Y0 + 0.22, 1.5, 0.85), (Y0 + 0.25, 1.2, 0.68), (Y0 + 0.55, 1.05, 0.6), (Y0 + 0.58, 0.86, 0.5), (Y0 + 1.6, 0.86, 0.5)]
rings = [[V((EMX + sx * w / 2, y, EMZ + sz * h / 2)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for y, w, h in steps]
K.loft_bm(c, rings)
bmesh.ops.recalc_face_normals(c, faces=c.faces)
K.cut_object(body, c)
K.cut_object(body, cutter_box(X1 - 0.3, -1.2, 1.35, X1 + 1, 0.6, 1.55))                # side observation slit
TX, TY = -2.6, 1.6
c = bmesh.new()
K.cyl_bm(c, (TX, TY, ZT - 1.0), (TX, TY, ZR + 0.5), 0.55, 16)
K.cut_object(roof, c)
c = bmesh.new()
K.cyl_bm(c, (TX, TY, ZT - 1.2), (TX, TY, ZT + 0.2), 0.55, 16)
K.cut_object(body, c)

# dark interior cards behind openings
bm = bmesh.new()
K.box_bm(bm, (EMX, Y0 + 1.62, EMZ), (0.9, 0.02, 0.55))
K.box_bm(bm, (X1 - 0.32, -0.3, 1.45), (0.02, 1.9, 0.3))
K.cyl_bm(bm, (TX, TY, ZT - 0.95), (TX, TY, ZT - 0.93), 0.56, 16)
K.part(bm, 'interior_dark', name='interior', grime=0, bisect=False)

# embrasure armour plate + MG barrel, steel shutter for the slit
bm = bmesh.new()                                         # armour plate (Panzerplatte) with bolts and a ball mount
K.box_bm(bm, (EMX, Y0 + 0.62, EMZ), (0.92, 0.06, 0.56))
for sx in (-1, 1):
    for sz in (-1, 1):
        K.box_bm(bm, (EMX + sx * 0.38, Y0 + 0.585, EMZ + sz * 0.21), (0.05, 0.03, 0.05))
K.cyl_bm(bm, (EMX + 0.1, Y0 + 0.59, EMZ), (EMX + 0.1, Y0 + 0.5, EMZ), 0.16, 10, r1=0.12)
K.box_bm(bm, (EMX - 0.25, Y0 + 0.585, EMZ + 0.06), (0.16, 0.03, 0.05))           # vision slit block
K.part(bm, 'steel_painted', name='embrasure_plate', mat_tint=(0.55, 0.57, 0.52), bisect=False, grime=0.6)
bm = bmesh.new()
K.box_bm(bm, (EMX - 0.25, Y0 + 0.568, EMZ + 0.06), (0.1, 0.005, 0.015))
K.part(bm, 'interior_dark', name='emb_slit', grime=0, bisect=False)
K.decal('streak_rust', (EMX, Y0 - 0.21, EMZ - 0.75), (0, -1, 0), 0.9, 0.8, alpha=0.7)
if not DEAD:
    bm = bmesh.new()
    K.cyl_bm(bm, (EMX + 0.1, Y0 + 0.5, EMZ), (EMX + 0.1, Y0 + 0.05, EMZ), 0.03, 6)
    K.cyl_bm(bm, (EMX + 0.1, Y0 + 0.05, EMZ), (EMX + 0.1, Y0 - 0.08, EMZ), 0.016, 6)
    K.part(bm, 'cast_iron', name='mg_barrel', bisect=False, lod='drop')
    K.anchor('mg', (EMX + 0.1, Y0 + 0.5, EMZ), (0, -1, 0), kind='embrasure', arc=70)

# ------------------------------------------------------------------ armoured door (separate node, hinge pivot)
hinge = V((DX - 0.5, EY - 0.05, 0.02))
ang = math.radians(-100 if DEAD else 0)
bm = bmesh.new()
K.box_bm(bm, (0.5, 0.0, 0.97), (0.98, 0.06, 1.92))
for z in (0.3, 0.97, 1.64):
    K.box_bm(bm, (0.5, -0.04, z), (0.9, 0.025, 0.08))
K.box_bm(bm, (0.86, -0.07, 1.0), (0.05, 0.05, 0.22))
Rz = Matrix.Rotation(ang, 3, 'Z')
for v in bm.verts:
    v.co = hinge + Rz @ v.co
dp = K.part(bm, 'steel_painted', name='door_main_leaf', node='door_main', mat_tint=(0.62, 0.64, 0.6), grime=0.5)
dp['kit_pivot'] = list(hinge)
bm = bmesh.new()                      # rivets on the leaf, same node
for i in range(6):
    for z in (0.3, 0.97, 1.64):
        p = V((0.08 + i * 0.165, -0.06, z))
        K.box_bm(bm, tuple(hinge + Rz @ p), (0.03, 0.02, 0.03))
rv = K.part(bm, 'cast_iron', name='door_main_rivets', node='door_main', bisect=False)
rv['kit_pivot'] = list(hinge)
K.door_meta('main', (DX, EY - 0.05, 0.0), (0, -1, 0), 1.0, 1.95, kind='bunker_door', node='door_main')
bm = bmesh.new()                      # steel door frame (angle iron) + step
K.box_bm(bm, (DX, EY - 0.03, 1.98), (1.2, 0.08, 0.08))
for s in (-1, 1):
    K.box_bm(bm, (DX + s * 0.55, EY - 0.03, 0.99), (0.08, 0.08, 1.98))
K.part(bm, 'cast_iron', name='door_frame', grime=0.3)

# ------------------------------------------------------------------ roof furniture
bm = bmesh.new()
K.cyl_bm(bm, (TX, TY, ZR - 0.05), (TX, TY, ZR + 0.12), 0.72, 16)            # Tobruk collar
K.part(bm, 'concrete_bunker', name='tobruk_collar', mat_tint=CT)
bm = bmesh.new()
M.sandbag_ring(bm, (TX, TY, 0), 1.15, courses=3, gap_ang=math.radians(-90), gap_w=0.9, z0=ZR, r=r)
M.sandbags_part(bm, 'tobruk_bags', tint={'desert': (1.1, 1.0, 0.85), 'snow': (0.85, 0.85, 0.82)}.get(VAR))
bm = bmesh.new()
K.cyl_bm(bm, (2.9, 1.8, ZR), (2.9, 1.8, ZR + 0.75), 0.09, 8)                # vent mushroom
K.cyl_bm(bm, (2.9, 1.8, ZR + 0.75), (2.9, 1.8, ZR + 0.9), 0.22, 8, r1=0.05)
K.cyl_bm(bm, (-0.6, 2.4, ZR), (-0.6, 2.4, ZR + 1.1), 0.07, 8)               # stove pipe with rain cap
K.cyl_bm(bm, (-0.6, 2.4, ZR + 1.1), (-0.6, 2.4, ZR + 1.2), 0.16, 8, r1=0.02)
K.cyl_bm(bm, (0.9, -1.2, ZR), (0.9, -1.2, ZR + 0.35), 0.1, 8)               # periscope cupola stub
K.cyl_bm(bm, (0.9, -1.2, ZR + 0.35), (0.9, -1.2, ZR + 0.7), 0.035, 6)
K.part(bm, 'steel_painted', name='roof_pipes', mat_tint=(0.6, 0.6, 0.55), bisect=False, smooth=True)
K.anchor('smoke', (-0.6, 2.4, ZR + 1.3), kind='stove')

# ------------------------------------------------------------------ earth berms banked against sides and back
from mathutils import noise as NZ                         # rework 2: rounded, irregular outline (no rectangle)
corner, out = [], []
def _ring(p, n, d):
    corner.append(p)
    out.append((p[0] + n[0] * d, p[1] + n[1] * d))
def _D(p):
    return 3.2 + 0.7 * NZ.noise(V((p[0] * 0.35, p[1] * 0.35, 4.2)))
for k in range(4):                                        # west side, front end swept forward
    p = (X0 - 0.02, Y0 + 0.9 + (Y1 - Y0 - 0.9) * k / 4)
    _ring(p, (-1, -0.35 * (1 - k / 3)) if k < 3 else (-1, 0), _D(p) * (0.75 + 0.25 * k / 3 if k < 3 else 1))
for k in range(1, 4):                                     # NW corner fan
    a = math.pi - math.pi / 2 * k / 4
    _ring((X0 - 0.02, Y1 + 0.02), (math.cos(a), math.sin(a)), _D((X0, Y1)) * 1.05)
for k in range(5):                                        # back
    p = (X0 + (X1 - X0) * k / 4, Y1 + 0.02)
    _ring(p, (0, 1), _D(p))
for k in range(1, 4):                                     # NE corner fan
    a = math.pi / 2 - math.pi / 2 * k / 4
    _ring((X1 + 0.02, Y1 + 0.02), (math.cos(a), math.sin(a)), _D((X1, Y1)) * 1.05)
for k in range(4):                                        # east side (observation slit kept clear)
    p = (X1 + 0.02, Y1 - (Y1 - Y0 - 0.9) * (k + 1) / 4)
    _ring(p, (1, -0.35 * (k + 1) / 4), _D(p) * (1 - 0.25 * (k + 1) / 4))
def bh(si, t):
    x = corner[si][0] + (corner[min(si + 1, len(corner) - 1)][0] - corner[si][0]) * t
    y = corner[si][1] + (corner[min(si + 1, len(corner) - 1)][1] - corner[si][1]) * t
    return 1.1 if (x > X1 - 0.1 and y < 1.0) else ZT - 0.5
M.berm(corner, out, bh, EARTH, 'berm', taper_end=0.3, rows=9, step=0.6, undulate=0.18)
# entrance: splinter-proof wing walls (stepped tops, chamfered) + a detached baffle wall screening the door
# rework 2: ONE continuous dog-leg entrance: east wing runs out from the facade and turns west as the baffle, west wing
# runs out and flares; tops step down in poured lifts (2.25 -> 1.75 -> 1.35 m) with sloped transitions
bm = bmesh.new()
def lift(s_, steps):
    h = steps[0][1]
    for s0, hh in steps:
        if s_ >= s0:
            h = hh
    for (s0, h0), (s1, h1) in zip(steps[:-1], steps[1:]):
        if s1 - 0.35 <= s_ < s1:
            return h0 + (h1 - h0) * (s_ - (s1 - 0.35)) / 0.35
    return h
M.wall_strip(bm, [(EX1 + 0.25, Y0 + 0.2), (EX1 + 0.25, Y0 - 3.05), (EX0 - 0.15, Y0 - 3.05)], lambda s_: lift(s_, [(0, 2.25), (1.0, 1.75), (3.2, 1.45)]), 0.5, -1)
M.wall_strip(bm, [(EX0 - 0.25, Y0 + 0.2), (EX0 - 0.25, Y0 - 1.45), (EX0 - 1.45, Y0 - 2.0)], lambda s_: lift(s_, [(0, 2.25), (1.0, 1.55), (1.9, 0.95)]), 0.5, 1)
M.conc_part(bm, 'entrance_walls', 'concrete_board', CT)
bm = bmesh.new()                                         # steel angle nosing on the wall heads + drain gully
for x0_, x1_, z in ((EX1, EX1 + 0.6, 1.6), (EX0 - 0.6, EX0, 1.6), (EX0 + 0.25, EX1 - 0.25, 1.9)):
    pass
K.box_bm(bm, ((EX0 + EX1) / 2, Y0 - 0.9, 0.01), (EX1 - EX0 - 0.1, 0.35, 0.03))
K.part(bm, 'cast_iron', name='gully_grate', grime=0.2, bisect=False)
K.footprint([(EX1, Y0), (EX1 + 0.5, Y0), (EX1 + 0.5, Y0 - 3.3), (EX0 - 0.15, Y0 - 3.3), (EX0 - 0.15, Y0 - 2.8), (EX1, Y0 - 2.8)], 'HIGH', 'baffle')
K.footprint([(EX0 - 0.5, Y0), (EX0, Y0), (EX0, Y0 - 1.5), (EX0 - 1.4, Y0 - 2.25), (EX0 - 1.6, Y0 - 1.8), (EX0 - 0.5, Y0 - 1.3)], 'HIGH', 'wing_wall')
# concertina wire arc in front + steel pickets
bm = bmesh.new()
M.concertina(bm, (-6.5, -6.2, 0), (-1.0, -6.6, 0), radius=0.42)
M.concertina(bm, (3.8, -6.6, 0), (7.0, -5.4, 0), radius=0.42)
for x, y in ((-6.3, -6.2), (-3.8, -6.4), (-1.2, -6.6), (4.0, -6.6), (6.8, -5.5)):
    K.cyl_bm(bm, (x, y, 0), (x, y, 1.0), 0.015, 4)
M.wire_part(bm, 'wire')
K.footprint([(-6.6, -6.9), (-0.9, -6.9), (-0.9, -5.9), (-6.6, -5.9)], 'FENCE', 'wire')
K.footprint([(3.7, -6.9), (7.2, -5.9), (7.0, -5.0), (3.7, -6.2)], 'FENCE', 'wire')

# ------------------------------------------------------------------ weathering
for i in range(5):
    x = r.uniform(X0 + 0.5, X1 - 0.5)
    if EX0 - 0.3 < x < EX1 + 0.3:
        continue
    K.decal(r.choice(['streak_long', 'streak_rain']), (x, Y0 - 0.001, ZT - 0.8), (0, -1, 0), r.uniform(0.8, 1.6), 1.5, alpha=0.55)
K.decal('streak_rust', (EMX, Y0 - 0.002, EMZ - 0.55), (0, -1, 0), 0.6, 0.7, alpha=0.6)
K.decal('damp_base', (-2.5, Y0 - 0.002, 0.4), (0, -1, 0), 3.0, 0.9, alpha=0.6)
for i in range(9):                                   # roof: moss, stains, puddle marks, leaf litter
    K.decal(r.choice(['moss_patch', 'stain_blotch', 'lichen', 'dirt_splash']) if theater != 'desert' else r.choice(['stain_blotch', 'dirt_splash']),
            (r.uniform(X0, X1 - 0.5), r.uniform(Y0 - 0.2, Y1), ZR + 0.004), (0, 0, 1), r.uniform(1.2, 2.6), r.uniform(1.0, 2.2), up=(0, 1, 0), alpha=0.4)
for i in range(6):                                   # streaks down from the roof-slab lip
    K.decal('streak_long', (r.uniform(X0, X1), Y0 - 0.452, ZR - 0.5), (0, -1, 0), r.uniform(0.6, 1.4), 0.9, alpha=0.5)
K.decal('crack', (3.4, Y0 - 0.002, 1.4), (0, -1, 0), 1.0, 1.0, alpha=0.6)
if theater != 'desert':
    K.decal('lichen', (X0 + 0.9, Y0 - 0.002, 1.7), (0, -1, 0), 1.2, 1.0, alpha=0.6)

# ------------------------------------------------------------------ destroyed variant
if DEAD:
    K.bite((X0 + 0.9, Y0 + 0.2, ZT), 1.9, (1.2, 1.0, 0.9), seed=3)
    K.bite((DX, Y0, 1.2), 1.1, (1.0, 1.0, 1.0), seed=5)
    K.bite((X1 - 0.5, Y1 - 0.8, ZR), 1.3, (1.0, 1.0, 0.8), seed=8)
    bm = bmesh.new()                              # exposed rebar at the bite rims
    for cx, cy, cz, rad in ((X0 + 0.9, Y0 + 0.2, ZT, 1.9), (X1 - 0.5, Y1 - 0.8, ZR, 1.3)):
        for i in range(14):
            a = r.uniform(0, 2 * math.pi)
            p = V((cx + math.cos(a) * rad * 0.85, cy + math.sin(a) * rad * 0.5, cz + r.uniform(-0.5, 0.3)))
            d = (p - V((cx, cy, cz))).normalized()
            q = p - d * r.uniform(0.3, 0.8) + V((r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2), r.uniform(-0.3, 0.3)))
            K.cyl_bm(bm, p + d * 0.2, q, 0.012, 4)
    K.part(bm, 'steel_galv', name='rebar', mat_tint=(0.6, 0.42, 0.3), grime=0, bisect=False, lod='drop')
    M.rubble((X0 + 0.2, Y0 - 1.2, 0), 2.4, 0.9, mids=('concrete_bunker', 'concrete_board'), n=46, beams=2, tiles=None)
    M.rubble((DX + 0.4, Y0 - 1.8, 0), 1.5, 0.5, mids=('concrete_board', 'concrete_bunker'), n=20, beams=0, tiles=None)
    K.scorch_openings(1.3, 1.0)
    for p, n, w in (((EMX, Y0 - 0.01, EMZ + 0.7), (0, -1, 0), 1.8), ((X1 + 0.01, -0.3, 2.0), (1, 0, 0), 1.8), ((DX, Y0 - 0.01, 2.2), (0, -1, 0), 1.8),
                    ((X0 + 1.2, Y0 - 0.01, 1.55), (0, -1, 0), 3.0), ((X0 - 0.01, Y0 + 1.2, 1.6), (-1, 0, 0), 2.8), ((X0 + 1.0, Y0 + 0.4, ZR + 0.01), (0, 0, 1), 4.0),
                    ((X1 - 0.5, Y1 - 0.8, ZR + 0.01), (0, 0, 1), 3.2), ((X0 + 0.9, Y0 - 1.6, 0.03), (0, 0, 1), 4.5)):
        K.decal('soot', p, n, w, w * 0.9, up=(0, 1, 0) if n[2] else (0, 0, 1), alpha=0.95)
    K.decal('soot', (DX, Y0 - 1.5, 0.03), (0, 0, 1), 3.5, 3.0, up=(0, 1, 0), alpha=0.9)
    K.anchor('fire', (DX, Y0 + 0.5, 0.6), kind='smoulder')
    K.A().meta['doors'] = []

# ------------------------------------------------------------------ gameplay metadata
K.footprint([(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)], 'HIGH', 'bunker')
K.footprint([(X0 - 3.0, Y0 + 0.3), (X0, Y0 + 0.3), (X0, Y1), (X1, Y1), (X1, Y0 + 0.3), (X1 + 3.0, Y0 + 0.3), (X1 + 3.0, Y1 + 3.0), (X0 - 3.0, Y1 + 3.0)], 'NONE', 'berm_slope')
K.roof_meta([(X0 - 0.3, Y0 - 0.4), (X1 + 0.3, Y0 - 0.4), (X1 + 0.3, Y1 + 0.25), (X0 - 0.3, Y1 + 0.25)], ZR, walkable=True, kind='bunker_roof')
K.climb_meta((X0, Y1), (X1, Y1), ZR, 'berm')          # berm-side access to the roof
K.anchor('garrison_spawn', (DX, EY + 0.6, 0.0), (0, -1, 0), kind='garrison')
if not DEAD:                                              # garnished camouflage net over the east roof and berm
    def sup(x, y):
        dx = max(0.0, X0 - 0.35 - x, x - X1 - 0.35)
        dy = max(0.0, Y0 - 0.45 - y, y - Y1 - 0.3)
        d = math.hypot(dx, dy)
        return ZR + 0.35 if d == 0 else max(0.1, (ZT - 0.5) * max(0.0, 1 - d / 3.4) ** 1.3) + 0.2
    M.camo_net(0.3, Y0 + 1.0, X1 + 1.5, Y1 + 1.8, sup, drop=lambda x, y: max(0.05, sup(x, y) - 0.25),
               tint={'desert': (1.0, 0.9, 0.7), 'snow': (0.92, 0.93, 0.92)}.get(VAR, (0.56, 0.6, 0.42)),
               poles=[(1.4, Y1 - 0.4, ZR + 1.05), (X1 - 0.5, 0.0, ZR + 1.15), (X1 + 0.9, Y1 + 0.9, 2.1)], sag=0.25)
if VAR == 'snow':
    K.snow_pass(thick=0.1)
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48)
