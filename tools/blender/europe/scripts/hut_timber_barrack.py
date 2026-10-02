"""German wooden barrack hut (Mannschaftsbaracke / RAD hut) for the M20 castle courts and B5 (building-inventory
`hut_timber_barrack`): a timber frame on a low rubble plinth, small casement windows with plank shutters, a door on each
long side with timber steps, a stovepipe through the roof, firewood, a rain butt and a notice board.
 a = vertical board-and-batten, creosote brown, grey tar-paper roof on battens
 b = horizontal weatherboard painted field grey-green, grey shingle roof
 c = dark-stained siding, slate roof, a lean-to woodshed on the east gable
 d = small 8 x 5 m hut (latrine / store / guard room): board-and-batten, field grey, tar-paper roof
suffix '-ruin': shelled (destroyed variant)
usage: blender -b --python hut_timber_barrack.py -- outdir variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, SHUTTER, DOOR, ruin_pass, finish, roof_tone, roof_decals, eave_streaks, use_cheap_windows
use_cheap_windows()
import bmesh

OUT, VAR, SEED = args('hut_timber_barrack_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('hut_timber_barrack_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
CFG = {
    'a': dict(wall='board_batten', wt=(0.64, 0.53, 0.41), roof='tar_paper_batten', rt=(0.76, 0.77, 0.8), pitch=26,
              shut='brown', door='brown', wins=(-3.2, -1.1, 2.6), back=(-2.8, -1.2, 2.6), frame=(0.82, 0.8, 0.74)),
    'b': dict(wall='weatherboard_paint', wt=(0.68, 0.72, 0.62), roof='roof_shingle', rt=(0.72, 0.74, 0.78), pitch=32,
              shut='grey', door='green', wins=(-3.4, -1.2, 2.2), back=(-3.0, -0.6, 1.8), frame=(0.86, 0.85, 0.8)),
    'c': dict(wall='timber_siding', wt=(0.56, 0.45, 0.35), roof='roof_slate', rt=(0.88, 0.9, 0.96), pitch=34,
              shut='oxblood', door='black', wins=(-3.0, 2.4), back=(-2.6, -1.0, 2.8), frame=(0.75, 0.72, 0.65)),
    'd': dict(wall='board_batten', wt=(0.62, 0.64, 0.57), roof='tar_paper_batten', rt=(0.74, 0.76, 0.78), pitch=28,
              shut='grey', door='grey', wins=(-2.4, 2.3), back=(-2.2, 2.0), frame=(0.8, 0.8, 0.76), L=8.0, W=5.0),
}[base]
L, W, T, ZP, ZE = CFG.get('L', 10.0), CFG.get('W', 6.0), 0.18, 0.45, 2.75   # plinth top ZP, eave ZE (walls on the plinth)
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

# ---- plinth (rubble + mortar), the frame stands on it ---------------------------------------------------------
bm = bmesh.new()
K.prism_bm(bm, K.poly_offset(K.ccw(poly), 0.06), -0.1, ZP)
K.part(bm, 'rubble_stone', name='plinth', tint=(0.82, 0.8, 0.76), grime=0.7)

# ---- walls with openings ------------------------------------------------------------------------------------
DX = 1.1 if base not in ('b', 'd') else 0.4 if base == 'b' else 0.0
door_f = K.opening(poly, 0, L / 2 + DX, 1.0, 2.05, ZP + 0.02, T, 'rect', 'door')
fr_front, wins = [door_f], []
for wx in CFG['wins']:
    f = K.opening(poly, 0, wx - x0, 0.9, 1.0, ZP + 0.95, T); fr_front.append(f); wins.append(f)
door_b = K.opening(poly, 2, L / 2 - 0.5 if base != 'd' else L / 2, 0.95, 2.0, ZP + 0.02, T, 'rect', 'door')
fr_back = [door_b]
for wx in CFG['back']:
    f = K.opening(poly, 2, L - (wx - x0), 0.9, 1.0, ZP + 0.95, T); fr_back.append(f); wins.append(f)
gw = K.opening(poly, 3, W / 2, 0.6, 0.6, ZE + 0.35, T)
K.wall_ring(poly, ZE, T, CFG['wall'], fr_front + fr_back + [gw], z0=0.0, name='walls', mat_tint=CFG['wt'], grime=0.6)
zr = ZE + (W / 2) * math.tan(math.radians(CFG['pitch']))
for e, extra in ((1, []), (3, [gw])):
    K.gable(poly, e, ZE, zr, T, CFG['wall'], extra, name='gable%d' % e, mat_tint=CFG['wt'])
# corner boards + sill plate + eave plate (the timber frame showing)
bm = bmesh.new()
for (cx, cy) in poly:
    K.box_bm(bm, (cx, cy, (ZP + ZE) / 2), (0.24, 0.24, ZE - ZP))
for a, b in zip(poly, poly[1:] + poly[:1]):
    K.beam_bm(bm, (a[0], a[1], ZP + 0.08), (b[0], b[1], ZP + 0.08), 0.24, 0.16)
K.part(bm, 'timber_beam', name='frame', mat_tint=(0.36, 0.29, 0.22), uv='beam', axis=(1, 0, 0), grime=0.6)

sc = SHUTTER[CFG['shut']]
for k, f in enumerate(wins):
    st = 'closed' if k % 4 == 3 else ('ajar' if k % 3 == 2 else 'open')
    K.window(f, 'casement', (2, 2), frame=CFG['frame'], sill='timber_beam', lintel='timber_beam', shutters=st,
             shutter_color=sc, shutter_style='plank', curtain=0.5, name='w%d' % k)
K.window(gw, 'fixed', (1, 1), frame=CFG['frame'], sill=None, streak=False, name='wg')
K.door(door_f, 'front', 'plank', DOOR[CFG['door']], lintel='timber_beam', step=None)
K.door(door_b, 'back', 'plank', DOOR[CFG['door']], lintel='timber_beam', step=None)
for f, n in ((door_f, (0, -1, 0)), (door_b, (0, 1, 0))):   # timber steps up to the raised floor
    o = f.o
    K.stairs((o.x, o.y + n[1] * 0.85, 0), (0, -n[1], 0), 1.3, 0.22, 2, 'timber_beam', name='steps', solid=True)
K.wall_lantern((door_f.o.x - 0.85, y0, 0), (0, -1, 0), 2.35)

# ---- roof + stovepipe ---------------------------------------------------------------------------------------
R = K.roof_gable(0, 0, L, W, ZE, CFG['pitch'], CFG['roof'], eave_oh=0.45, gable_oh=0.35, thick=0.1,
                 fascia='timber_beam', barge='timber_beam', gutters=base != 'a' and not RUIN, sag=0.04, wobble=0.012)
for o in R.parts:
    if 'slope' in o.name:
        o.data.materials[0] = K.mat(CFG['roof'], CFG['rt'])
sx = -L / 2 + 2.2
bm = bmesh.new()
K.cyl_bm(bm, (sx, 0.9, ZE + 0.6), (sx, 0.9, zr + 0.9), 0.1, 10)
K.cyl_bm(bm, (sx, 0.9, zr + 0.9), (sx, 0.9, zr + 1.05), 0.17, 10, r1=0.05)    # rain hat
K.part(bm, 'cast_iron', name='stovepipe', mat_tint=(0.34, 0.32, 0.3), smooth=True, grime=0.8)
K.anchor('smoke', (sx, 0.9, zr + 1.1), (0, 0, 1), kind='smoke')
K.anchor('roof_ridge', (0, 0, zr))

# ---- dressing: firewood under the west eave, rain butt, notice board -----------------------------------------
bm = bmesh.new()
for row in range(5):
    for k in range(9):
        y = -1.9 + k * 0.42 + (row % 2) * 0.2
        if y > 1.9:
            continue
        z = 0.15 + row * 0.26
        K.cyl_bm(bm, (x0 - 0.25, y, z), (x0 - 0.85, y, z), 0.12 + r.uniform(-0.02, 0.02), 7)
K.part(bm, 'log_hewn', name='firewood', uv='beam', axis=(1, 0, 0), mat_tint=(0.8, 0.72, 0.6), lod='drop')
bm = bmesh.new()
K.cyl_bm(bm, (x1 + 0.45, y0 + 0.6, 0.0), (x1 + 0.45, y0 + 0.6, 0.95), 0.36, 14)
K.part(bm, 'boards_weathered', name='rain_butt', mat_tint=(0.55, 0.45, 0.35), smooth=True, lod='drop')
if base != 'c':
    K.sign((door_f.o.x + 1.0, y0 - 0.04, 1.75), (0, -1, 0), 0.7, 'wache', board='timber_beam')

if base == 'c' and not RUIN:     # lean-to woodshed on the east gable
    bm = bmesh.new()
    for yy in (y0 + 0.5, y1 - 0.5):
        K.box_bm(bm, (x1 + 1.8, yy, 1.1), (0.14, 0.14, 2.2))
    K.part(bm, 'timber_beam', name='shed_posts', mat_tint=(0.4, 0.32, 0.25))
    K.roof_shed(x1, y0 + 0.3, x1 + 2.0, y1 - 0.3, 2.2, 2.6, 'tar_paper', low_side='+x', oh=0.2, name='shed_roof', thick=0.06)

# ---- weathering -------------------------------------------------------------------------------------------
for i in range(4):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y0 - 0.12, 0.7), (0, -1, 0), r.uniform(1.4, 2.4), 0.8)
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), y1 + 0.12, 0.5), (0, 1, 0), r.uniform(0.8, 1.4), 0.5)
eave_streaks([((x0, y0), (x1, y0)), ((x1, y1), (x0, y1))], ZE - 0.3, n=2, seed=SEED, alpha=0.3)
roof_tone(R, seed=SEED)
roof_decals(R, 3, seed=SEED)
if RUIN:
    ruin_pass(hits=[((x0 + 3.0, y0, 2.2), 1.8, (1.2, 1.1, 1.3)), ((x1 - 2.0, y1, 2.6), 1.4, (1, 1, 1))],
              rubble_at=[((x0 + 3.0, y0 - 1.2, 0), 1.8, 0.7)], holes=[(-2.5, -1.0, 1.4), (2.0, 1.0, 1.2)], R=R,
              mids=('board_batten', 'rubble_stone'), tiles=CFG['roof'], seed=SEED)
finish(OUT)
