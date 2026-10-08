"""Tunis harbour warehouse (M12 'Up on the Roof', the corrugated shed in the NW corner of the old port): a French-
protectorate dock magasin of the 1900s - ochre lime-rendered rubble walls with sandstone quoins and pilaster
buttresses, a low-pitched corrugated-iron gable roof (weathered zinc with rust runs) on a timber truss, ridge
ventilators, a big boarded sliding door on an iron track in the south gable plus a wicket, a round oculus vent,
high barred windows on the long sides, cast-iron downpipes, a brick boiler flue at the NE (the dossier's chimney),
a painted company band under the eaves, damp base, fallen render, rust streaks, posters.
Footprint 10 x 18 m (front = south gable). Backdrop: no walkable roof, no ladders.
Usage: blender -b --python warehouse_harbour_tunis.py -- outdir [a] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V

av = dz.argv()
OUT = av[0]
SEED = int(av[2]) if len(av) > 2 else 1907
K.begin('warehouse_harbour_tunis', SEED, theater='desert')
r = K.rng()
OCHRE = dz.WASH['ochre']
PL, STONE, OCH = 'limewash_worn', 'ashlar_limestone', 'sandstone_ochre'
DOOR = (0.42, 0.33, 0.24)
T, ZE, PITCH = 0.55, 4.6, 18.0
W, L = 9.6, 17.4
x0, x1, y0, y1 = -W / 2, W / 2, -L / 2, L / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

# ---- openings: south gable door + wicket + oculus, high windows on the long sides, a north door ------------
sdoor = K.opening(poly, 0, W / 2, 3.6, 3.7, 0.0, T, 'rect', 'door')
wick = K.opening(poly, 0, 1.4, 0.95, 2.1, 0.0, T, 'rect', 'door')
swin = K.opening(poly, 0, W - 1.4, 0.9, 1.1, 2.6, T)
east = [K.opening(poly, 1, t, 1.1, 0.9, 3.0, T, 'segment') for t in (2.4, 6.6, 10.8, 15.0)]
west = [K.opening(poly, 3, t, 1.1, 0.9, 3.0, T, 'segment') for t in (2.4, 6.6, 10.8, 15.0)]
ndoor = K.opening(poly, 2, W * 0.35, 1.6, 2.6, 0.0, T, 'segment', 'door')
K.wall_ring(poly, ZE, T, PL, [sdoor, wick, swin, ndoor] + east + west, plinth=(OCH, 0.6, 0.05), name='walls', mat_tint=OCHRE)
R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'corrugated_galv', rot=math.pi / 2, eave_oh=0.45, gable_oh=0.35, thick=0.1,
                 fascia='timber_grey', barge='timber_grey', gutters=True)
C.A.meta['roofs'].clear()                       # backdrop: the mission owns the nav, no walkable roof
zg = R.z_ridge - R.lift
oc = K.opening(poly, 0, W / 2, 0.9, 0.9, ZE + 0.35, T, 'arch')
K.gable(poly, 0, ZE, zg, T, PL, [oc], mat_tint=OCHRE)
K.gable(poly, 2, ZE, zg, T, PL, [], mat_tint=OCHRE)
# weathered sheets: rusty replacement panels and zinc-white oxide patches on both slopes
TP = math.tan(math.radians(PITCH))
zr = lambda x: R.z_ridge + 0.03 - abs(x) * TP
for k in range(7):
    sd = 1 if k % 2 else -1
    xa = sd * r.uniform(0.6, 2.4); xb = xa + sd * r.uniform(0.9, 2.0)
    ya = r.uniform(y0 + 0.5, y1 - 2.5); yb = ya + r.uniform(0.8, 2.2)
    q = [(xa, ya, zr(xa)), (xb, ya, zr(xb)), (xb, yb, zr(xb)), (xa, yb, zr(xa))]
    dz.patch_quad(q if sd > 0 else q[::-1], 'corrugated_rust' if k % 3 else 'corrugated_zinc', 'roofpatch%d' % k,
                  tint=None if k % 3 else (0.95, 0.95, 0.92), lift=0.05)
K.quoins(poly, 0.6, ZE, OCH)
dz.course(poly, ZE - 0.55, 0.42, 0.015, PL, name='name_band', mat_tint=(0.88, 0.8, 0.62))
dz.course(poly, ZE - 0.12, 0.12, 0.08, OCH, name='eave_course')

# pilaster buttresses along the long walls
bm = dz.bmesh.new()
for x, s in ((x1, 1), (x0, -1)):
    for y in (-4.35, 0.0, 4.35):
        C.box_bm(bm, (x + s * 0.17, y, ZE / 2 - 0.1), (0.34, 0.7, ZE - 0.2), taper=0.0)
K.part(bm, OCH, name='buttresses', grime=0.6)

# ---- doors, windows --------------------------------------------------------------------------------------
K.door(sdoor, 'main', 'barn', DOOR, step=None)
K.door(wick, 'wicket', 'plank', (0.3, 0.42, 0.5), step=STONE)
K.door(ndoor, 'north', 'double', DOOR, step=STONE)
bm = dz.bmesh.new()                                # sliding-door iron track + hangers over the main door
C.beam_bm(bm, (-2.9, y0 - 0.12, 3.85), (2.9, y0 - 0.12, 3.85), 0.12, 0.1)
for xx in (-2.6, -0.5, 0.5, 2.6):
    C.box_bm(bm, (xx, y0 - 0.12, 3.95), (0.12, 0.08, 0.22))
K.part(bm, 'cast_iron', name='door_track', grime=0.5)
K.window(swin, 'fixed', (2, 2), frame=(0.3, 0.42, 0.5), sill=STONE, bars=True, name='swin')
K.window(oc, 'fixed', (1, 1), frame=(0.3, 0.28, 0.25), sill=None, bars=True, streak=False, name='oculus')
for k, f in enumerate(east + west):
    K.window(f, 'fixed', (3, 2), frame=(0.3, 0.42, 0.5), sill=STONE, bars=True, name='lw%d' % k)
    KA.voussoirs(f, STONE)

# ---- roof: ridge ventilators, NE brick flue --------------------------------------------------------------
bm = dz.bmesh.new()
for y in (-5.0, 0.0, 5.0):
    C.box_bm(bm, (0, y, zg + 0.22), (0.9, 1.6, 0.38))
K.part(bm, 'corrugated_galv', name='vent_body', grime=0.6, mat_tint=(0.8, 0.78, 0.74))
for y in (-5.0, 0.0, 5.0):
    K.roof_shed(-0.75, y - 0.95, 0.75, y + 0.95, zg + 0.42, zg + 0.62, 'corrugated_galv', low_side='-x', oh=0.05,
                name='vent_cap', gutters=False)
    C.A.meta['roofs'].pop()
K.chimney(x1 - 1.6, y1 - 1.8, ZE, zg + 2.2, 0.7, 0.7, 'brick_red')

# ---- downpipes, rust and weathering ---------------------------------------------------------------------
bm = dz.bmesh.new()
for x in (x0 - 0.12, x1 + 0.12):
    for y in (y0 + 0.5, y1 - 0.5):
        C.cyl_bm(bm, (x, y, 0.15), (x, y, ZE - 0.1), 0.055, 8)
K.part(bm, 'cast_iron', name='downpipes', grime=0.4, smooth=True)
for i, (e, t, z) in enumerate([(0, 1.0, 0.8), (1, 4.0, 1.5), (1, 12.5, 0.7), (3, 8.0, 2.4), (3, 14.0, 0.9), (2, 6.5, 1.2)]):
    a, b, rr, nn, Le = dz.edge(poly, e)
    dz.spall2(a + rr * t + V((0, 0, z)), nn, r.uniform(0.6, 1.3), r.uniform(0.35, 0.7), 'fieldstone', PL, OCHRE, seed=SEED + i, name='sp%d' % i)
for i in range(4):
    a, b, rr, nn, Le = dz.edge(poly, i)
    for k in range(max(1, int(Le / 2.4))):
        t = r.uniform(0.5, Le - 0.5)
        K.decal('damp_base', tuple(a + rr * t + nn * 0.003 + V((0, 0, 0.5))), tuple(nn), r.uniform(1.8, 2.8), 0.9, alpha=0.4)
        K.decal('streak_rust', tuple(a + rr * r.uniform(0.4, Le - 0.4) + nn * 0.004 + V((0, 0, ZE - 0.9))), tuple(nn), 0.4, 1.3, alpha=0.35)
        if r.random() < 0.5:
            K.decal('crack', tuple(a + rr * r.uniform(0.6, Le - 0.6) + nn * 0.004 + V((0, 0, r.uniform(1, ZE - 1)))), tuple(nn), 1.0, 1.0, alpha=0.35)
K.decal('poster_fr', (x0 + 2.6, y0 - 0.006, 1.6), (0, -1, 0), 0.55, 0.75, alpha=0.85)
K.decal('poster_de', (x1 - 2.6, y0 - 0.006, 1.6), (0, -1, 0), 0.55, 0.75, alpha=0.85)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
