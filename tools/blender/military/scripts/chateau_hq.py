"""Neo-Gothic chateau HQ (M20 Gundelfingen castle, building-inventory `chateau_hq`, the mission's objective o1):
a three-storey limestone corps de logis under a steep slate hip roof with Gothic dormers, a tall round SW tower with a
slate candle-snuffer spire and finial (the flag), a smaller NW tower, an octagonal stair turret, a low SE wing whose
flat roof is a crenellated walk (the roof ledge under the castle turret), a two-storey NE wing, a Gothic porch with
steps and lanterns on the S front, pointed-arch ground-floor windows, cross-mullioned upper windows, quoins, string
courses, corbel-table cornice, chimneys. Footprint 22 x 24 m (game x x z), front = south (+Z) at rot 0.
Variants: a (grey-buff limestone), destroyed (bombed: blast holes, roof holes, rubble, soot, fire).
Usage: blender -b --factory-startup --python chateau_hq.py -- [a|destroyed] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mil as M
K = M.K
import bmesh
from mathutils import Vector as V

VAR, SEED = M.args('a', 61)
K.begin('chateau_hq' + ('' if VAR == 'a' else '_' + VAR), SEED, theater='frost')
r = K.rng()
DEAD = VAR == 'destroyed'
STONE, TRIM, PLINTH, SLATE = 'ashlar_limestone', 'limestone_smooth', 'rubble_stone', 'roof_slate'
ST = (0.84, 0.82, 0.76)
T = 0.6
ZP, Z1, Z2, ZE = 0.7, 4.3, 7.7, 11.0               # plinth, 1st, 2nd floor, main eave
ZL, ZN = 7.0, 8.2                                   # SE wing flat roof (the walk), NE wing eave
main = [(-11, -12), (3.5, -12), (3.5, 12), (-11, 12)]   # Blender x east, y north (game z = -y); front edge 0 = south
sew = [(3.5, -12), (11, -12), (11, 2), (3.5, 2)]
new_ = [(3.5, 2), (11, 2), (11, 12), (3.5, 12)]

def win(poly, e, t, lvl, w=1.15):
    sill, h, shape = [(ZP + 0.8, 2.3, 'arch'), (Z1 + 0.85, 2.0, 'rect'), (Z2 + 0.8, 1.9, 'rect')][lvl]
    return K.opening(poly, e, t, w, h, sill, T, shape)

fm, fs, fn = [], [], []
door = K.opening(main, 0, 7.5, 1.8, 3.1, ZP, T, 'arch', 'door')
fm.append(door)
for t in (5.0, 10.4, 12.8):
    fm += [win(main, 0, t, 0), win(main, 0, t, 1), win(main, 0, t, 2)]
fm += [win(main, 0, 7.5, 1, 1.4), win(main, 0, 7.5, 2)]
for t in (3.0, 7.0, 11.0, 15.0):                             # west front (edge 3: from (-11,12) down to (-11,-12))
    fm += [win(main, 3, t, 0), win(main, 3, t, 1), win(main, 3, t, 2)]
for t in (2.5, 6.5, 10.0):                                   # north
    fm += [win(main, 2, t, 1), win(main, 2, t, 2)]
for t in (1.6, 4.4):
    fs += [win(sew, 0, t, 0, 1.0), win(sew, 0, t, 1, 1.0)]
fs.append(win(sew, 1, 1.5, 1, 1.0))
fs.append(K.opening(sew, 1, 12.0, 1.2, 2.4, ZP, T, 'arch', 'door'))
for t in (2.5, 6.0):
    fn += [win(new_, 1, t, 0, 1.0), win(new_, 1, t, 1, 1.0)]

K.wall_ring(main, ZE, T, STONE, fm, plinth=(PLINTH, ZP, 0.08), name='walls_main', mat_tint=ST)
K.wall_ring(sew, ZL, T, STONE, fs, plinth=(PLINTH, ZP, 0.08), name='walls_se', mat_tint=ST)
K.wall_ring(new_, ZN, T, STONE, fn, plinth=(PLINTH, ZP, 0.08), name='walls_ne', mat_tint=ST)
for poly, nm, zt in ((main, 'main', ZE), (sew, 'se', ZL), (new_, 'ne', ZN)):
    K.quoins(poly, ZP, zt - 0.4, TRIM, name='quoins_' + nm, block_h=0.5, long=0.6, short=0.34)
    K.course(poly, Z1 - 0.12, 0.22, 0.08, TRIM, name='course1_' + nm)
    if zt > Z2:
        K.course(poly, Z2 - 0.12, 0.2, 0.07, TRIM, name='course2_' + nm)
K.cornice(main, ZE - 0.55, TRIM, steps=((0.06, 0.15), (0.14, 0.12), (0.26, 0.18)), name='cornice_main')
K.cornice(new_, ZN - 0.45, TRIM, steps=((0.06, 0.12), (0.16, 0.14)), name='cornice_ne')
for k, f in enumerate(fm + fs + fn):
    if f.kind == 'door':
        continue
    south = f.n.y < -0.5
    K.window(f, 'casement', (1, 3) if f.o.z < Z1 else (2, 2), frame=(0.82, 0.8, 0.74), sill=TRIM, lintel=TRIM,
             surround=TRIM if south else None, shutters=None, curtain=0.75, bars=f.o.z < Z1 and not south, name='w%d' % k)
K.door(door, 'front', 'double', (0.3, 0.21, 0.14), surround=TRIM, lintel=TRIM, step=None)
K.door(fs[-1], 'east', 'plank', (0.28, 0.22, 0.17), lintel=TRIM, step=PLINTH)

# ------------------------------------------------------------------ roofs: main hip + dormers, NE hip, SE flat walk
R = K.roof_hip(-3.75, 0, 24, 14.5, ZE, 52, SLATE, rot=math.pi / 2, eave_oh=0.45, thick=0.16, fascia=None, sag=0.02, wobble=0.008)
for lx, side in ((-7.0, -1), (0.0, -1), (7.0, -1), (-5.0, 1), (5.0, 1)):
    K.dormer(R, lx, side, 1.3, 1.7, wall=STONE, roof=SLATE, pitch=62,
             window_kw=dict(style='casement', panes=(1, 2), frame=(0.82, 0.8, 0.74), sill=None, streak=False, curtain=0.5))
Rn = K.roof_hip(7.25, 7.0, 7.5, 10.0, ZN, 48, SLATE, eave_oh=0.4, thick=0.14, fascia=None, sag=0.02, wobble=0.01, name='roof_ne')
K.roof_flat(sew, ZL, 'concrete_slab', parapet_h=1.1, parapet_t=0.45, parapet_mid=STONE, coping=TRIM, walkable=True, name='se_walk')
bm = bmesh.new()                                               # merlons on the SE wing parapet (south + east faces)
for x in [3.9 + k * 1.5 for k in range(5)]:
    K.box_bm(bm, (x + 0.35, -12 + 0.22, ZL + 1.45), (0.75, 0.46, 0.7))
for y in [-11.4 + k * 1.5 for k in range(9)]:
    K.box_bm(bm, (11 - 0.22, y + 0.35, ZL + 1.45), (0.46, 0.75, 0.7))
K.part(bm, STONE, name='se_merlons', mat_tint=ST)
for (x, y, z0, z1, w, d) in ((-2.0, 5.0, ZE, R.z_ridge + 1.6, 1.0, 0.8), (-6.5, -5.0, ZE, R.z_ridge + 1.2, 1.0, 0.8), (8.5, 9.5, ZN, Rn.z_ridge + 1.0, 0.8, 0.7)):
    K.chimney(x, y, z0, z1, w, d, STONE, cap=TRIM, pots=2)

# ------------------------------------------------------------------ towers: SW round + spire, NW round, octagonal stair turret
def tower(c, rad, z_top, cone_h, segs=20, name='tower', flag=False):
    bm = bmesh.new()
    K.cyl_bm(bm, (c[0], c[1], -0.1), (c[0], c[1], z_top), rad, segs)
    K.part(bm, STONE, name=name, mat_tint=ST, uv='aligned')
    bm = bmesh.new()
    for z in (Z1 - 0.12, Z2 - 0.12, z_top - 0.5):
        K.cyl_bm(bm, (c[0], c[1], z), (c[0], c[1], z + 0.24), rad + 0.1, segs)
    for k in range(segs):                                        # corbel table under the eave
        a = 2 * math.pi * k / segs
        K.box_bm(bm, (c[0] + math.cos(a) * (rad + 0.08), c[1] + math.sin(a) * (rad + 0.08), z_top - 0.8), (0.25, 0.25, 0.4), a)
    K.part(bm, TRIM, name=name + '_trim')
    bm = bmesh.new()
    K.cyl_bm(bm, (c[0], c[1], z_top - 0.05), (c[0], c[1], z_top + cone_h), rad + 0.45, segs, r1=0.03)
    K.part(bm, SLATE, name=name + '_spire', smooth=True)
    bm = bmesh.new()
    apex = V((c[0], c[1], z_top + cone_h))
    K.cyl_bm(bm, apex - V((0, 0, 0.3)), apex + V((0, 0, 0.9)), 0.07, 8)
    K.cyl_bm(bm, apex + V((0, 0, 0.3)), apex + V((0, 0, 0.55)), 0.16, 8, r1=0.03)
    if flag and not DEAD:
        K.cyl_bm(bm, apex + V((0, 0, 0.9)), apex + V((0, 0, 3.4)), 0.035, 6)
    K.part(bm, 'cast_iron', name=name + '_finial', bisect=False)
    if flag and not DEAD:
        K.anchor('flag', tuple(apex + V((0.05, 0, 3.3))), (1, 0, 0), kind='flag', w=1.8, h=1.2)
    bm = bmesh.new()                                             # narrow lancet lights round the shaft
    for k in range(4):
        a = math.pi * (0.25 + 0.5 * k) + 0.3
        for z in (Z1 + 0.9, Z2 + 0.9, ZE + 0.9) if z_top > ZE + 2 else (Z1 + 0.9, Z2 + 0.9):
            K.box_bm(bm, (c[0] + math.cos(a) * (rad + 0.01), c[1] + math.sin(a) * (rad + 0.01), z + 0.6), (0.28, 0.28, 1.3), a)
    K.part(bm, 'interior_dark', name=name + '_lights', bisect=False)
tower((-9.6, -9.6), 2.7, 16.0, 8.8, name='tower_sw', flag=True)
tower((-9.8, 10.0), 2.2, 13.5, 6.2, name='tower_nw')
tower((3.5, 2.0), 1.6, 14.2, 4.6, segs=8, name='stair_turret')
K.footprint([(-9.6 + 2.8 * math.cos(a), -9.6 + 2.8 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]], 'HIGH', 'tower')

# ------------------------------------------------------------------ porch: landing, steps, gablet, lanterns, sign
bm = bmesh.new()
K.box_bm(bm, (-3.5, -12.9, ZP / 2), (3.6, 1.8, ZP))
K.part(bm, PLINTH, name='porch_landing')
K.stairs((-3.5, -14.6, 0), (0, 1, 0), 3.0, ZP, 3, TRIM, name='porch_steps')
for s in (-1, 1):
    K.wall_lantern((-3.5 + s * 1.6, -12, 0), (0, -1, 0), 3.0)
K.sign((0.6, -12.02, 2.6), (0, -1, 0), 1.3, 'kommandantur', 'timber_grey')

# ------------------------------------------------------------------ weathering, damage, metadata
for i in range(10):
    K.decal('moss_patch', (r.uniform(-10, 3), -12.01, r.uniform(0.3, 0.6)), (0, -1, 0), r.uniform(0.8, 1.6), 0.6, alpha=0.6)
for x in (-10.0, -6.0, 1.0):
    K.decal('streak_long', (x, -12.01, ZE - 1.6), (0, -1, 0), 0.9, 2.6, alpha=0.45)
if DEAD:
    K.bite((-3.0, -12.0, 8.5), 2.6, (1.3, 1.0, 1.2), seed=4)
    K.bite((-11.0, 2.0, 5.0), 2.2, (1.0, 1.2, 1.3), seed=7)
    K.bite((7.0, -12.0, 3.5), 2.0, (1.2, 1.0, 1.2), seed=9)
    K.roof_holes(R, [(-6.0, 0.0, 3.0), (4.0, 2.5, 2.8), (9.0, -1.5, 2.0)])
    M.rubble((-3.5, -14.5, 0.05), 3.4, 1.4, mids=(STONE, TRIM), n=26, beams=5, tiles=SLATE)
    M.rubble((-12.6, 1.0, 0.05), 2.6, 1.0, mids=(STONE, SLATE), n=18, beams=2, tiles=SLATE)
    K.scorch_openings(1.2, 0.8)
    K.anchor('fire', (-4.0, 0.0, ZE), kind='fire_large')
    K.anchor('fire2', (6.0, -6.0, ZL), kind='fire_large')
K.anchor('roof_ridge', (-3.75, 0, R.z_ridge))
K.anchor('charge', (-3.5, -13.5, 0.3), (0, -1, 0), kind='explosive_target')
M.finalize(M.outdir(K.A().name), ao_res=1024, ao_samples=48, recenter=False)
