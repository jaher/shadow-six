"""Example: Normandy stone farmhouse (Bessin type, c. 1850): two storeys of warm fieldstone with Caen-limestone quoins,
window surrounds and string course; steep slate roof with three wall dormers and gable-end chimneys; lean-to
annexe with barn door and corrugated roof; front steps, lantern, shutters. Usage:
  blender -b --factory-startup --python farmhouse_normandy.py -- [outdir] [variant: intact|snow] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'blender'))
import kit as K

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'farmhouse_normandy')
VAR = argv[1] if len(argv) > 1 else 'intact'
SEED = int(argv[2]) if len(argv) > 2 else 7
K.begin('farmhouse_normandy' + ('' if VAR == 'intact' else '_' + VAR), SEED, theater='temperate', snow=VAR == 'snow')

L, W, T = 12.4, 6.8, 0.6           # main house: length (x), depth (y), wall thickness
ZE = 5.4                           # eave / wall-plate height (two storeys)
PITCH = 50
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
STONE, DRESS = 'fieldstone', 'ashlar_limestone'

# ---- openings -------------------------------------------------------------------------------------------
bays = [-4.6, -2.4, 0.0, 2.4, 4.6]
fr_front, win_front = [], []
for i, bx in enumerate(bays):
    t = bx - x0
    if i == 2:
        door = K.opening(poly, 0, t, 1.15, 2.3, 0.32, T, 'segment', 'door')
        fr_front.append(door)
    else:
        f = K.opening(poly, 0, t, 1.0, 1.55, 1.15, T)
        fr_front.append(f); win_front.append(f)
    f = K.opening(poly, 0, t, 0.95, 1.4, 3.3, T)
    fr_front.append(f); win_front.append(f)
fr_back = [K.opening(poly, 2, 3.0, 0.9, 1.3, 1.2, T), K.opening(poly, 2, 9.4, 0.9, 1.3, 1.2, T),
           K.opening(poly, 2, 6.2, 1.0, 2.1, 0.0, T, 'rect', 'door'), K.opening(poly, 2, 3.0, 0.8, 1.2, 3.4, T)]
fr_west = [K.opening(poly, 3, 2.0, 0.8, 1.1, 1.3, T), K.opening(poly, 3, W / 2, 0.7, 0.9, ZE + 0.9, T, 'arch')]

K.wall_ring(poly, ZE, T, STONE, fr_front + fr_back + fr_west, plinth=(DRESS, 0.45, 0.05), name='walls')
K.gable(poly, 1, ZE, ZE + (W / 2) * math.tan(math.radians(PITCH)), T, STONE, name='gable_e')
K.gable(poly, 3, ZE, ZE + (W / 2) * math.tan(math.radians(PITCH)), T, STONE, [fr_west[1]], name='gable_w')
K.quoins(poly, 0.45, ZE, DRESS)
K.course(poly, 3.05, 0.16, 0.05, DRESS, name='string_course')
K.cornice(poly, ZE - 0.3, DRESS, steps=((0.05, 0.1), (0.1, 0.1), (0.16, 0.1)))

shut_cols = ['grey', 'grey', 'grey']
for k, f in enumerate(win_front):
    upper = f.o.z > 2
    K.window(f, 'casement', (1, 3 if not upper else 3), frame='white', surround=DRESS, lintel=DRESS, sill=DRESS,
             shutters='open' if (k % 3) else ('ajar' if upper else 'closed'), shutter_color=(0.52, 0.56, 0.55),
             shutter_style='plank', curtain=0.7, name='wf%d' % k)
for k, f in enumerate(fr_back):
    if f.kind == 'door':
        K.door(f, 'back', 'plank', (0.32, 0.26, 0.2), lintel='timber_beam', step=DRESS)
    else:
        K.window(f, 'casement', (1, 2), frame=(0.62, 0.6, 0.55), lintel='timber_beam', sill=DRESS, shutters='closed' if k == 3 else None,
                 shutter_color=(0.45, 0.5, 0.45), name='wb%d' % k)
K.window(fr_west[0], 'single', (1, 2), frame='white', surround=DRESS, sill=DRESS, bars=True, name='ww0')
K.window(fr_west[1], 'fixed', (1, 1), frame='white', sill=DRESS, streak=False, name='ww1')
K.door(door, 'front', 'panel', (0.30, 0.36, 0.34), surround=DRESS, lintel=DRESS, step=None)
K.stairs((0, y0 - 0.95, 0), (0, 1, 0), 1.7, 0.32, 2, DRESS, name='front_steps')
K.wall_lantern((1.05, y0, 0), (0, -1, 0), 2.65)

# ---- roof, dormers, chimneys -------------------------------------------------------------------------------
R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'roof_slate', eave_oh=0.3, gable_oh=0.12, thick=0.14, fascia=None,
                 barge=None, gutters=True, sag=0.05, wobble=0.015)
for lx in (-3.5, 0.0, 3.5):
    K.dormer(R, lx, -1, 1.25, 1.5, wall=STONE, roof='roof_slate',
             window_kw=dict(style='casement', panes=(1, 2), frame='white', sill=None, streak=False, curtain=0.5))
for sx in (-1, 1):
    K.chimney(sx * (L / 2 - 0.45), 0.0, ZE, R.z_ridge + 1.1, 0.95, 0.75, DRESS if sx < 0 else STONE, cap=DRESS, pots=2 if sx < 0 else 1)
K.anchor('roof_ridge', (0, 0, R.z_ridge))

# ---- lean-to annexe on the east gable (cart shed / cellier) ------------------------------------------------
ax0, ax1, ay0, ay1 = x1 - 0.05, x1 + 4.2, y0 + 0.4, y1 - 0.2
apoly = [(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]
barn = K.opening(apoly, 0, 2.15, 2.5, 2.35, 0.0, 0.45, 'rect', 'door')
aw = K.opening(apoly, 1, 3.1, 0.7, 0.6, 1.9, 0.45)
K.wall_ring(apoly, 2.9, 0.45, STONE, [barn, aw], name='annexe_walls')
K.quoins(apoly, 0.0, 2.9, DRESS, name='annexe_quoins', corners=(1, 2))
K.door(barn, 'barn', 'barn', (0.36, 0.33, 0.27), lintel='timber_beam', step=None, open_deg=0)
K.window(aw, 'fixed', (1, 1), frame=(0.5, 0.48, 0.44), sill=None, lintel='timber_beam', streak=True, name='aw')
K.roof_shed(ax0 + 0.3, ay0, ax1, ay1, 3.0, 4.3, 'corrugated_rust', low_side='+x', oh=0.3, name='annexe_roof')
K.ladder((ax1 + 0.55, ay1 - 1.2, 0), 3.0, (1, 0, 0))

# ---- weathering decals ------------------------------------------------------------------------------------
r = K.rng()
for i in range(6):
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), y1 + 0.001, r.uniform(0.1, 0.6)), (0, 1, 0), r.uniform(0.8, 1.6), r.uniform(0.4, 0.8))
for i in range(4):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y0 - 0.001, 0.55), (0, -1, 0), r.uniform(1.5, 2.6), 1.1)
K.decal('lichen', (x0 + 0.8, y0 - 0.02, 2.0), (0, -1, 0), 1.2, 1.2)
if VAR == 'snow':
    K.snow_pass()
K.finalize(OUT, ao_res=1024, ao_samples=64)
