"""Normandy stone farmhouse, refined from the kit example; three regional facade variants + a shelled ruin.
 a = Bessin: warm fieldstone, Caen-limestone dressings, slate, 3 dormers, grey shutters, corrugated lean-to
 b = Pays d'Auge / Perche: limewashed rubble, red-brick quoins + surrounds, flat-tile hip roof, green shutters, 2 dormers
 c = Cotentin: grey granite rubble, granite dressings, slate, 1 dormer, oxblood shutters, attached stone barn
 suffix '-ruin' (e.g. a-ruin): shell hits, roof holes, rubble, scorched openings (destroyed variant)
usage: blender -b --python farmhouse_normandy.py -- outdir variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import K, V, args, SHUTTER, DOOR, ruin_pass, compact, finish, roof_tone, roof_patches, roof_ridge, roof_decals, eave_streaks

OUT, VAR, SEED = args('farmhouse_normandy_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('farmhouse_normandy_' + VAR.replace('-', '_'), SEED, theater='temperate')
if RUIN or base == 'b':          # budget windows on the reworked variants (a / c keep the approved kit windows)
    from eu_common import use_cheap_windows
    use_cheap_windows()
r = K.rng()
CFG = {
    'a': dict(L=12.4, W=6.8, bays=[-4.6, -2.4, 0.0, 2.4, 4.6], stone='fieldstone', dress='ashlar_limestone', roof='roof_slate',
              pitch=50, hip=False, dormers=(-3.5, 0.0, 3.5), shut='grey', door='green', annex='leanto', quo='ashlar_limestone'),
    'b': dict(L=10.6, W=6.4, bays=[-3.6, -1.2, 1.2, 3.6], stone='plaster_limewash', dress='brick_red', roof='roof_tile_flat',
              pitch=48, hip=True, dormers=(-1.8, 1.8), shut='green', door='oxblood', annex='leanto', quo='brick_red'),
    'c': dict(L=11.2, W=6.6, bays=[-4.0, -1.6, 1.2, 3.8], stone='fieldstone_grey', dress='granite', roof='roof_slate',
              pitch=52, hip=False, dormers=(0.0,), shut='oxblood', door='brown', annex='barn', quo='granite'),
}[base]
L, W, T, ZE, PITCH = CFG['L'], CFG['W'], 0.6, 5.4, CFG['pitch']
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
STONE, DRESS = CFG['stone'], CFG['dress']
ROOFTINT = None   # b: Norman petites tuiles plates (flat clay plain tiles, shared lib roof_tile_flat)

# ---- openings -------------------------------------------------------------------------------------------
bays = CFG['bays']
door_bay = len(bays) // 2 if len(bays) % 2 else len(bays) // 2 - 1
fr_front, win_front = [], []
for i, bx in enumerate(bays):
    t = bx - x0
    if i == door_bay:
        door = K.opening(poly, 0, t, 1.15, 2.3, 0.32, T, 'segment' if base != 'c' else 'rect', 'door')
        fr_front.append(door)
    else:
        f = K.opening(poly, 0, t, 1.0, 1.55, 1.15, T, 'segment' if base == 'b' else 'rect')
        fr_front.append(f); win_front.append(f)
    f = K.opening(poly, 0, t, 0.95, 1.4, 3.3, T)
    fr_front.append(f); win_front.append(f)
fr_back = [K.opening(poly, 2, 2.6, 0.9, 1.3, 1.2, T), K.opening(poly, 2, L - 2.6, 0.9, 1.3, 1.2, T),
           K.opening(poly, 2, L / 2, 1.0, 2.1, 0.0, T, 'rect', 'door'), K.opening(poly, 2, 2.6, 0.8, 1.2, 3.4, T)]
fr_west = [K.opening(poly, 3, 2.0, 0.8, 1.1, 1.3, T), K.opening(poly, 3, W / 2, 0.7, 0.9, ZE + 0.9, T, 'arch')]
if CFG['hip']:
    fr_west = fr_west[:1]

K.wall_ring(poly, ZE, T, STONE, fr_front + fr_back + fr_west, plinth=('ashlar' if base == 'b' else DRESS, 0.45, 0.05), name='walls')
if not CFG['hip']:
    zr = ZE + (W / 2) * math.tan(math.radians(PITCH))
    K.gable(poly, 1, ZE, zr, T, STONE, name='gable_e')
    K.gable(poly, 3, ZE, zr, T, STONE, [fr_west[1]], name='gable_w')
K.quoins(poly, 0.45, ZE, CFG['quo'], block_h=0.42 if RUIN else 0.3)
if base != 'b':
    K.course(poly, 3.05, 0.16, 0.05, DRESS, name='string_course')
K.cornice(poly, ZE - 0.3, 'ashlar_limestone' if base == 'b' else DRESS, steps=((0.05, 0.1), (0.1, 0.1), (0.16, 0.1)))

sc = SHUTTER[CFG['shut']]
for k, f in enumerate(win_front):
    upper = f.o.z > 2
    st = 'open' if (k % 3) else ('ajar' if upper else 'closed')
    if base == 'c' and k == len(win_front) - 1:
        st = 'closed'
    K.window(f, 'casement', (1, 3), frame='white' if base != 'c' else (0.8, 0.78, 0.72), surround=DRESS, lintel=DRESS,
             sill='ashlar_limestone' if base == 'b' else DRESS, shutters=st, shutter_color=sc,
             shutter_style='plank', curtain=0.7, name='wf%d' % k)
for k, f in enumerate(fr_back):
    if f.kind == 'door':
        K.door(f, 'back', 'plank', DOOR['brown'], lintel='timber_beam', step=DRESS)
    else:
        K.window(f, 'casement', (1, 2), frame=(0.62, 0.6, 0.55), lintel='timber_beam', sill=DRESS, shutters='closed' if k == 3 else None,
                 shutter_color=sc, name='wb%d' % k)
K.window(fr_west[0], 'single', (1, 2), frame='white', surround=DRESS, sill=DRESS, bars=True, name='ww0')
if len(fr_west) > 1:
    K.window(fr_west[1], 'fixed', (1, 1), frame='white', sill=DRESS, streak=False, name='ww1')
K.door(door, 'front', 'glazed' if base == 'b' else 'panel', DOOR[CFG['door']], surround=DRESS, lintel=DRESS, step=None)
K.stairs((door.o.x, y0 - 0.95, 0), (0, 1, 0), 1.7, 0.32, 2, 'ashlar_limestone' if base == 'b' else DRESS, name='front_steps')
K.wall_lantern((door.o.x + 1.05, y0, 0), (0, -1, 0), 2.65)

# ---- roof, dormers, chimneys -------------------------------------------------------------------------------
rkw = dict(eave_oh=0.3, gable_oh=0.12, thick=0.14, fascia=None, barge=None, gutters=not RUIN, sag=0.05, wobble=0.015)
if CFG['hip']:
    R = K.roof_hip(0, 0, L, W, ZE, PITCH, CFG['roof'], **rkw)
else:
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, CFG['roof'], **rkw)
if ROOFTINT:
    for o in R.parts:
        if 'slope' in o.name or 'hip' in o.name:
            o.data.materials[0] = K.mat(CFG['roof'], ROOFTINT)
for lx in (CFG['dormers'][1:] if RUIN else CFG['dormers']):      # ruin: west dormer blown away (hole below)
    K.dormer(R, lx, -1, 1.2 if base != 'c' else 1.35, 1.5, wall=STONE if base != 'b' else 'timber_siding',
             roof=CFG['roof'], window_kw=dict(style='casement', panes=(1, 2), frame='white', sill=None, streak=False, curtain=0.5))
if CFG['hip']:
    K.chimney(-L / 2 + 2.2, 0.9, ZE, R.z_ridge + 0.9, 0.9, 0.6, 'brick_red', cap='ashlar_limestone', pots=2)
    K.chimney(L / 2 - 2.2, -0.9, ZE, R.z_ridge + 0.7, 0.8, 0.6, 'brick_red', cap='ashlar_limestone', pots=1)
else:
    for sx in (-1, 1):
        if base == 'c' and sx > 0:
            continue
        K.chimney(sx * (L / 2 - 0.45), 0.0, ZE, R.z_ridge + 1.1, 0.95, 0.75, DRESS if sx < 0 else STONE, cap=DRESS, pots=2 if sx < 0 else 1)
K.anchor('roof_ridge', (0, 0, R.z_ridge))

# ---- annexe on the east gable -------------------------------------------------------------------------------
if CFG['annex'] == 'leanto':
    ax0, ax1, ay0, ay1 = x1 - 0.05, x1 + 4.2, y0 + 0.4, y1 - 0.2
    apoly = [(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]
    barn = K.opening(apoly, 0, 2.15, 2.5, 2.35, 0.0, 0.45, 'rect', 'door')
    aw = K.opening(apoly, 1, 3.1, 0.7, 0.6, 1.9, 0.45)
    K.wall_ring(apoly, 2.9, 0.45, STONE, [barn, aw], name='annexe_walls')
    K.quoins(apoly, 0.0, 2.9, CFG['quo'], name='annexe_quoins', corners=(1, 2))
    K.door(barn, 'barn', 'barn', (0.36, 0.33, 0.27) if base == 'a' else DOOR['green'], lintel='timber_beam', step=None, open_deg=65 if RUIN else 0)
    K.window(aw, 'fixed', (1, 1), frame=(0.5, 0.48, 0.44), sill=None, lintel='timber_beam', streak=True, name='aw')
    K.roof_shed(ax0 + 0.3, ay0, ax1, ay1, 3.0, 4.3, 'corrugated_rust' if base == 'a' else CFG['roof'], low_side='+x', oh=0.3, name='annexe_roof',
                thick=0.08 if base == 'a' else 0.12)
    if not RUIN:
        K.ladder((ax1 + 0.55, ay1 - 1.2, 0), 3.0, (1, 0, 0))
else:   # attached granite barn with its own low gable roof and cart arch
    ax0, ax1, ay0, ay1 = x1 - 0.05, x1 + 6.5, y0 + 0.2, y1 - 0.2
    apoly = [(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]
    arch = K.opening(apoly, 0, 3.3, 2.8, 3.0, 0.0, 0.55, 'segment', 'door')
    hay = K.opening(apoly, 1, (ay1 - ay0) / 2, 0.9, 1.0, 3.6, 0.55)
    zb = 3.4
    K.wall_ring(apoly, zb, 0.55, STONE, [arch, hay], name='barn_walls')
    Rb = K.roof_gable((ax0 + ax1) / 2 + 0.1, (ay0 + ay1) / 2, ax1 - ax0 - 0.1, ay1 - ay0, zb, 45, 'roof_slate', eave_oh=0.25, gable_oh=0.1,
                      fascia=None, barge=None, gutters=False, sag=0.08, wobble=0.02, name='barn_roof')
    K.gable(apoly, 1, zb, Rb.z_ridge - Rb.lift, 0.55, STONE, [hay], name='barn_gable')
    K.quoins(apoly, 0.0, zb, 'granite', name='barn_quoins', corners=(1, 2))
    K.voussoirs(arch, 'granite')
    K.door(arch, 'barn', 'double', (0.34, 0.30, 0.25), step=None, open_deg=35)
    K.window(hay, 'fixed', (1, 1), frame=(0.4, 0.36, 0.3), sill=None, lintel='timber_beam', name='hay')

# ---- weathering decals ------------------------------------------------------------------------------------
for i in range(6):
    mh = r.uniform(0.4, 0.8)
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), y1 + 0.001, mh / 2 + r.uniform(0.02, 0.3)), (0, 1, 0), r.uniform(0.8, 1.6), mh)
for i in range(4):
    K.decal('damp_base', (r.uniform(x0 + 1, x1 - 1), y0 - 0.001, 0.55), (0, -1, 0), r.uniform(1.5, 2.6), 1.1)
K.decal('lichen', (x0 + 0.8, y0 - 0.02, 2.0), (0, -1, 0), 1.2, 1.2)
if base == 'b':      # soft run-off under the eaves instead of blotches (AD rework)
    K.decal('poster_fr', (x0 + 0.9, y0 - 0.003, 1.6), (0, -1, 0), 0.7, 0.95)
eave_streaks([((x0, y0), (x1, y0)), ((x1, y1), (x0, y1))], ZE - 0.35, n=3 if base == 'b' else 2, seed=SEED, alpha=0.32)

# ---- roof dressing: tone field, repairs, mortared ridge tiles with finials, lichen
roof_tone(R, seed=SEED)
if not RUIN:
    roof_patches(R, 3, 'roof_slate_b' if CFG['roof'] == 'roof_slate' else CFG['roof'], (0.9, 0.85, 0.8) if CFG['roof'] != 'roof_slate' else None,
                 seed=SEED, avoid=CFG['dormers'])
roof_ridge(R, mid='roof_tile_flat', tint=(0.92, 0.82, 0.74), hip=CFG['hip'], finials=not CFG['hip'], overhang=0.12)
roof_decals(R, 4, seed=SEED, avoid=CFG['dormers'])

if RUIN:
    import eu_dmg
    from eu_common import floor_slab
    floor_slab(K.poly_offset(K.ccw(poly), -T), 0.08, name='floor0', joists=False, mid='floor_checker', tint=(0.55, 0.52, 0.48))
    floor_slab(K.poly_offset(K.ccw(poly), -T), 3.0, name='floor1', tint=(0.42, 0.38, 0.34))
    import eu_dmg as _D
    _D.heap(V((x0 + 2.4, y0 + 1.6, 0.1)), 1.5, 0.8, stone=STONE, dress=DRESS, tiles=CFG['roof'], seed=SEED + 21, name='heap_in', footprint=False, n=8, beams=2, planks=2, slabs=1)
    eu_dmg.strip_shutters(0.55, SEED)
    ruin_pass(hits=[((x0 + 2.4, y0, 3.9), 2.1, (1.2, 1.2, 1.25)), ((x1 - 0.4, 0.8, 6.6), 1.5, (1.0, 1.3, 1.2)), ((x1 - 3.0, y1, 1.6), 1.2, (1.1, 1, 1))],
              rubble_at=[((x0 + 2.3, y0 - 1.5, 0), 2.3, 1.0)],
              holes=[(-3.3, -W * 0.3, 1.5), (3.0, W * 0.2, 1.5), (L * 0.33, -W * 0.18, 1.1)], R=R,
              mids=(STONE, DRESS), tiles=CFG['roof'], seed=SEED)
finish(OUT)
