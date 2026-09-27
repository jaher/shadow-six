"""Norwegian painted timber house (c. 1900-1940, sveitser/empire-influenced vernacular): stone grunnmur, board
cladding (Falu red / ochre / white), wide white window casings with crown boards, corner boards, storey band,
entrance porch with gabled roof, plastered chimney. Variants:
  a = 2 storeys, red horizontal weatherboards, dark slate roof
  b = 1.5 storeys (knee wall), ochre vertical boards, red tile roof, front dormer
  c = 2 storeys, white horizontal boards, black glazed tile roof, glazed side porch
Usage: blender -b --python house_timber.py -- outdir a|b|c seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V

OUT, VAR, SEED, SNOW = N.args('house_timber')
name = 'house_timber_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()

cfg = {'a': dict(L=10.0, W=7.2, storeys=2, clad='red', tint=None, roof='roof_slate', rtint=(0.75, 0.75, 0.78), pitch=36, zp=0.6),
       'b': dict(L=9.0, W=7.0, storeys=1.5, clad='vert', tint=N.OCHRE, roof='roof_terracotta', rtint=(0.9, 0.8, 0.75), pitch=42, zp=0.55),
       'c': dict(L=11.0, W=7.6, storeys=2, clad='horiz', tint=(0.94, 0.92, 0.86), roof='roof_pantile_black', rtint=None, pitch=34, zp=0.7)}[VAR]
L, W, ZP = cfg['L'], cfg['W'], cfg['zp']
T = 0.22
ZE = ZP + (5.2 if cfg['storeys'] == 2 else 3.4)
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
CL, TI = cfg['clad'], cfg['tint']
zr = ZE + (W / 2) * math.tan(math.radians(cfg['pitch']))

# ---- openings ----------------------------------------------------------------------------------------------
wins, frames = [], []
nb = 4 if L > 9.5 else 3
bays = [x0 + L * (i + 0.5) / nb for i in range(nb)]
door_bay = 1
for i, bx in enumerate(bays):
    t = bx - x0
    if i == door_bay:
        d = K.opening(poly, 0, t, 1.0, 2.1, ZP, T, 'rect', 'door'); frames.append(d); door = d
    else:
        f = K.opening(poly, 0, t, 0.95, 1.35, ZP + 0.85, T); frames.append(f); wins.append(f)
    if cfg['storeys'] == 2:
        f = K.opening(poly, 0, t, 0.95, 1.3, ZP + 3.45, T); frames.append(f); wins.append(f)
for t in ([2.2, L - 2.2] if L > 9.5 else [2.0, L - 2.4]):                         # back
    f = K.opening(poly, 2, t, 0.95, 1.35, ZP + 0.85, T); frames.append(f); wins.append(f)
    if cfg['storeys'] == 2:
        f = K.opening(poly, 2, t, 0.95, 1.3, ZP + 3.45, T); frames.append(f); wins.append(f)
kd = K.opening(poly, 2, L / 2, 0.9, 2.0, ZP, T, 'rect', 'door'); frames.append(kd)  # kitchen door
gfr = {1: [], 3: []}
for e in (1, 3):
    for t in (W / 2 - 1.1, W / 2 + 1.1):
        f = K.opening(poly, e, t, 0.9, 1.3, ZP + 0.85, T); frames.append(f); wins.append(f)
    gz = ZE + 0.25 if cfg['storeys'] == 2 else ZE + 0.35
    f = K.opening(poly, e, W / 2, 0.85, 1.15, gz, T); gfr[e].append(f); wins.append(f)
    if cfg['storeys'] != 2:
        for t in (W / 2 - 1.3, W / 2 + 1.3):
            pass

N.board_walls(poly, ZP, ZE - ZP, T, frames, CL, TI)
for e in (1, 3):
    N.board_gable(poly, e, ZE, zr, T, gfr[e], CL, TI, name='gable%d' % e)
N.plinth(poly, ZP, 'fieldstone_grey', frames=[])
N.band(poly, ZP - 0.02, 0.2, 0.05, name='vannbord')
if cfg['storeys'] == 2:
    N.band(poly, ZP + 2.95, 0.18, 0.05, name='storey_band')
N.corner_boards(poly, ZP, ZE, w=0.2 if VAR == 'c' else 0.15, proud=0.05 if VAR == 'c' else 0.035)
N.band(poly, ZE - 0.3, 0.3, 0.06 if VAR == 'c' else 0.04, name='frieze')

frame_col = 'white' if VAR != 'c' else (0.26, 0.34, 0.28)
for k, f in enumerate(wins):
    K.window(f, 'casement', (1, 3) if VAR != 'b' else (1, 2), frame=frame_col, recess=0.06, sill='wood_paint',
             lintel=None, curtain=0.8, streak=(r.random() < (0.8 if VAR != 'c' else 0.35)), name='w%d' % k)
    N.casing(f, crown=VAR != 'b' or f.o.z < 2, name='cas%d' % k)
col = {'a': (0.22, 0.30, 0.26), 'b': (0.36, 0.20, 0.14), 'c': (0.30, 0.34, 0.40)}[VAR]
K.door(door, 'front', 'panel', col, step=None)
N.casing(door, name='cas_door')
K.door(kd, 'back', 'plank', (0.55, 0.50, 0.42), step=None)
N.casing(kd, crown=False, name='cas_kd')

# ---- porches ----------------------------------------------------------------------------------------------
N.porch(door, depth=1.6 if VAR != 'c' else 1.9, rise=ZP, width=None if VAR != 'c' else 3.0,
        roof=True if VAR != 'c' else 'shed', roof_mid=cfg['roof'])   # porch roof matches the main roof
N.porch(kd, depth=1.1, roof=False, rise=ZP, name='backstoop')

# ---- roof, chimney, dormer --------------------------------------------------------------------------------
R = K.roof_gable(0, 0, L, W, ZE, cfg['pitch'], cfg['roof'], eave_oh=0.45, gable_oh=0.35, thick=0.12,
                 fascia='wood_paint', barge='wood_paint', gutters=True, sag=0.04, wobble=0.01,
                 ridge='round' if VAR == 'c' else 'auto')
if cfg['rtint']:
    for p in R.parts:
        if p.data.materials and p.data.materials[0].get('kit_id') == cfg['roof']:
            p.data.materials[0] = K.mat(cfg['roof'], cfg['rtint'])
K.chimney(0.9 if VAR != 'b' else -0.6, 0.35, ZE - 0.5, R.z_ridge + 0.85, 0.7, 0.6, 'plaster_white', cap='concrete_bunker', pots=0)
if VAR == 'b':
    K.dormer(R, 1.8, -1, 1.3, 1.25, wall='wood_paint', roof=cfg['roof'],
             window_kw=dict(style='casement', panes=(1, 2), frame='white', sill=None, streak=False, curtain=0.5))
K.anchor('roof_ridge', (0, 0, R.z_ridge))
N.dress_roof(R, moss={'a': 0.55, 'b': 0.7, 'c': 0.25}[VAR], ladder=(0.9 if VAR != 'b' else -0.6),
             ridge=('steel_galv', (0.42, 0.44, 0.46)) if VAR == 'a' else None, seed=SEED)
R.snow_patchy = 0.4 if VAR == 'c' else 0.3
if VAR == 'c':
    R.snow_off = 0.1                                    # blanket floats clear of the pantile wave crests

# ---- life & weathering ------------------------------------------------------------------------------------
# woodpile against the west gable
bm = K.bm_new()
for k in range(30):
    rr = r.uniform(0.06, 0.09)
    zz = 0.08 + (k // 10) * 0.15 + r.uniform(-0.01, 0.01)
    yy = y0 + 1.0 + (k % 10) * 0.19 + (0.09 if (k // 10) % 2 else 0)
    K.cyl_bm(bm, (x0 - 0.1, yy, zz), (x0 - 0.55 - r.uniform(0, 0.08), yy, zz), rr, 6)
K.part(bm, 'timber_beam', name='woodpile', uv='beam', axis=(1, 0, 0), grime=0.3)
K.footprint(N.rect(x0 - 0.7, y0 + 0.8, x0, y0 + 3.0), 'LOW', 'woodpile')
for i in range(3):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y1 + 0.001, ZP + 0.35), (0, 1, 0), r.uniform(1.4, 2.4), 0.7)
K.decal('moss_patch', (x0 + 0.8, y0 - 0.051, 0.35), (0, -1, 0), 1.2, 0.5)
for (cx, cy, nx, ny, span) in ((0, y0 - 0.06, 0, -1, L), (x1 + 0.06, 0, 1, 0, W), (x0 - 0.06, 0, -1, 0, W)):
    for k in range(3):                                   # splash-back zone above the plinth
        t = (k + 0.5) / 3 - 0.5 + r.uniform(-0.08, 0.08)
        K.decal('dirt_splash', (cx + abs(ny) * t * span, cy + abs(nx) * t * span, ZP + 0.3), (nx, ny, 0),
                span / 3 * 1.1, 0.55, alpha=0.6)
K.decal('streak_rain', (x1 - 0.5, y0 - 0.001, ZE - 0.9), (0, -1, 0), 1.0, 1.6)
import kit_core as _C
for p in _C.A.parts:                                      # porch/dormer roofs share the main roof's tinted material
    if p.name in N.bpy.data.objects and p.data.materials and p.data.materials[0].get('kit_id') == cfg['roof'] and cfg['rtint']:
        p.data.materials[0] = K.mat(cfg['roof'], cfg['rtint'])
# weathering that reads at game zoom: damp/darker base of the walls, silvered upper boards, extra rain streaks
N.weather_gradient(('walls', 'gable'), z0=ZP, z1=ZP + 2.2, low=(0.72, 0.72, 0.66) if VAR == 'b' else (0.82, 0.82, 0.78),
                   high=(1.0, 1.0, 1.0), seed=SEED)
if VAR == 'b':
    for k, f in enumerate(wins):
        if f.o.z < 3 and abs(f.o.y) > W / 2 - 0.3 and r.random() < 0.8:
            K.decal('streak_rain', (f.o.x, f.o.y + (0.001 if f.o.y > 0 else -0.001), f.o.z - 0.55), (0, 1 if f.o.y > 0 else -1, 0), 0.8, 1.1, alpha=0.8)
    K.decal('moss_patch', (x1 - 0.6, y0 - 0.051, ZP + 0.2), (0, -1, 0), 1.6, 0.6)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
