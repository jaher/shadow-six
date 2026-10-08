"""Mosan (Liege / Maas valley, Belgium) village houses for the M16/M18 Maas bridge map, 1944.
Red or dark-red brick with blue-grey 'pierre bleue' (petit granit) plinth, sills, lintels and quoins, wrought-iron wall
anchors (ancres), slate or black glazed pantile roofs, dormers, chimney stacks at the gables. Door centred on the front.
 a  8 x 8   two-storey brick house, slate roof, front dormer, estaminet sign      (house_belgian_brick)
 b  10 x 8  two-storey dark brick house, black pantiles, bluestone quoins, anchors   (house_belgian_brick)
 c  9 x 8   two-storey brick house, red flat tiles, epicerie shop window           (house_belgian_brick)
 w  = b turned so the door faces W (8 x 10)                                       (house_belgian_brick, door W)
 f  10 x 8  whitewashed brick farmhouse, black tarred base, red pantiles, hay door  (farmhouse_normandy -> Mosan farm)
 g  9 x 8   brick farmhouse, black pantiles, oxblood shutters                      (farmhouse)
 s  6 x 10  three-storey grey rendered townhouse, cornice, slate, dormers           (townhouse_stucco)
 q  8 x 8   three-storey grey rendered townhouse (garrison), rusticated ground floor (townhouse_stucco)
usage: blender -b --python maas_house.py -- outroot variant seed"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import (K, V, SHUTTER, DOOR, finish, roof_tone, roof_decals, eave_streaks, use_cheap_windows, use_cheap_doors,
                       ridge_tiles)
import bmesh
use_cheap_windows()
use_cheap_doors()

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT, VAR, SEED = (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else 'a'), (int(a[2]) if len(a) > 2 else 1)
BLUE = 'ashlar'                       # pierre bleue: the ashlar tinted blue-grey
BLUE_T = (0.52, 0.56, 0.6)
CFG = {
    'a': dict(L=8.0, W=8.0, wall='brick_red', wt=(0.92, 0.82, 0.78), floors=2, roof='roof_slate', rt=(0.86, 0.88, 0.94), pitch=48,
              dormer=True, sign='estaminet', shut='green', door='green', name='house_belgian_brick_a'),
    'b': dict(L=10.0, W=8.0, wall='brick_dark', wt=(0.95, 0.86, 0.82), floors=2, roof='roof_pantile_black', rt=(0.9, 0.9, 0.92), pitch=45,
              quoins=True, anchors=True, shut='oxblood', door='brown', name='house_belgian_brick_b'),
    'c': dict(L=9.0, W=8.0, wall='brick_red', wt=(0.86, 0.74, 0.68), floors=2, roof='roof_tile_flat', rt=(0.92, 0.78, 0.7), pitch=50,
              shop='epicerie', anchors=True, shut='grey', door='blue', name='house_belgian_brick_c'),
    'f': dict(L=10.0, W=8.0, wall='limewash_worn', wt=(0.96, 0.95, 0.9), floors=1, roof='roof_terracotta', rt=(0.86, 0.68, 0.58), pitch=50,
              tar=True, hay=True, shut='green', door='green', name='farmhouse_mosan_a'),
    'g': dict(L=9.0, W=8.0, wall='brick_red', wt=(0.8, 0.68, 0.62), floors=1, roof='roof_pantile_black', rt=(0.88, 0.88, 0.9), pitch=50,
              hay=True, shut='oxblood', door='brown', name='farmhouse_mosan_b'),
    's': dict(L=6.0, W=10.0, wall='plaster_rough', wt=(0.7, 0.71, 0.72), floors=3, roof='roof_slate', rt=(0.84, 0.86, 0.92), pitch=42,
              stucco=True, dormer=True, shut='grey', door='black', name='townhouse_stucco_be_a'),
    'q': dict(L=8.0, W=8.0, wall='plaster_rough', wt=(0.66, 0.68, 0.7), floors=3, roof='roof_slate', rt=(0.84, 0.86, 0.92), pitch=40,
              stucco=True, dormer=True, shut='grey', door='black', name='townhouse_stucco_be_b'),
}
cfg = dict(CFG['b' if VAR == 'w' else VAR])
NAME = 'house_belgian_brick_w' if VAR == 'w' else cfg['name']
K.begin(NAME, SEED, theater='temperate')
r = K.rng()
L, W, NF = cfg['L'], cfg['W'], cfg['floors']
T = 0.4
FH = 3.15 if not cfg.get('stucco') else 3.25
ZE = (NF * FH + 0.35) if NF > 1 else 3.3          # eave (wall top)
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
ZP = 0.55                                          # bluestone plinth top
wt = cfg['wt']

# ---- openings -----------------------------------------------------------------------------------------------
def bays(n_span, w_open, gap):
    """x offsets (from the edge start) of n openings centred on a span."""
    tot = n_span * w_open + (n_span - 1) * gap
    return [(L - tot) / 2 + w_open / 2 + k * (w_open + gap) for k in range(n_span)]

shape = 'rect' if cfg.get('stucco') else 'segment'
front, wins, doors = [], [], []
door_f = K.opening(poly, 0, L / 2, 1.1 if not cfg.get('shop') else 1.0, 2.3, 0.2, T, shape, 'door')
front.append(door_f)
gx = [L / 2 - 2.0, L / 2 + 2.0] if L < 9.5 else [L / 2 - 3.6, L / 2 - 1.8, L / 2 + 1.8, L / 2 + 3.6]
if L <= 6.5:
    gx = [L / 2 - 1.85, L / 2 + 1.85]
shopwin = None
for k, x in enumerate(gx):
    if cfg.get('shop') and k == len(gx) - 1:
        shopwin = K.opening(poly, 0, x - 0.3, 2.0, 1.9, 0.75, T, 'rect'); front.append(shopwin); continue
    f = K.opening(poly, 0, x, 0.95 if L > 6.5 else 0.85, 1.55 if NF > 1 else 1.3, 1.0, T, shape); front.append(f); wins.append(f)
up = []
for fl in range(1, NF):
    zs = fl * FH + 0.85
    xs = ([L / 2 - 2.0, L / 2, L / 2 + 2.0] if L < 9.5 else [L / 2 - 3.6, L / 2 - 1.8, L / 2, L / 2 + 1.8, L / 2 + 3.6])
    if L <= 6.5:
        xs = [L / 2 - 1.85, L / 2, L / 2 + 1.85]
    for x in xs:
        f = K.opening(poly, 0, x, 0.95 if L > 6.5 else 0.85, 1.6 - 0.12 * (fl - 1), zs, T, shape); front.append(f); wins.append(f); up.append(f)
# back: a back door + windows; sides: one window per floor on the E side, a small one on the W
back = []
door_b = K.opening(poly, 2, L / 2 + (1.2 if L > 7 else 0.0), 0.95, 2.1, 0.2, T, 'rect', 'door'); back.append(door_b)
for fl in range(NF):
    for x in ([L / 2 - 1.9] if fl == 0 else [L / 2 - 1.9, L / 2 + 1.9]):
        f = K.opening(poly, 2, x, 0.9, 1.3, fl * FH + 1.0, T, shape); back.append(f); wins.append(f)
side = []
for fl in range(NF):
    f = K.opening(poly, 1, W / 2 + (0.8 if fl % 2 else -0.8), 0.85, 1.25, fl * FH + 1.0, T, shape); side.append(f); wins.append(f)
hayf = None
if cfg.get('hay'):          # hay-loft hatch in the W gable
    hayf = K.opening(poly, 3, W / 2, 1.2, 1.3, ZE - 0.2, T, 'rect', 'door')
for fl in range(NF):        # the W side too: a narrow window per floor, so no gable end is a blank brick plane
    f = K.opening(poly, 3, W / 2 + (-0.9 if fl % 2 else 0.9), 0.7, 1.1, fl * FH + 1.1, T, shape); side.append(f); wins.append(f)
attic = []                  # a small attic light high in each gable (not over the hay hatch)
for e in ((1,) if hayf else (1, 3)):
    attic.append((e, K.opening(poly, e, W / 2, 0.55, 0.75, ZE + 0.55, T, 'rect')))
K.wall_ring(poly, ZE, T, cfg['wall'], front + back + side, z0=0.0, name='walls', mat_tint=wt, grime=0.7)

# ---- bluestone plinth, string courses, quoins, tarred base ------------------------------------------------------
bm = bmesh.new()
K.prism_bm(bm, K.poly_offset(K.ccw(poly), 0.05), -0.1, ZP)
K.part(bm, BLUE, name='plinth', mat_tint=BLUE_T, grime=0.6)
if cfg.get('tar'):          # the black tarred band of a Walloon farm (anti-damp), over the plinth
    bm = bmesh.new()
    K.prism_bm(bm, K.poly_offset(K.ccw(poly), 0.03), ZP, 0.95)
    K.part(bm, 'bitumen_felt', name='tar_band', mat_tint=(0.25, 0.25, 0.26), grime=0.3)
for fl in range(1, NF):
    K.course(poly, fl * FH + 0.55, 0.16, 0.05, BLUE, name='course%d' % fl)
if cfg.get('stucco'):
    K.cornice(poly, ZE - 0.05, 'plaster_white', name='cornice')
    K.quoins(poly, ZP, FH, 'plaster_rough', block_h=0.4, long=0.7, short=0.45, proud=0.03, name='rustic')
elif cfg.get('quoins'):
    K.quoins(poly, ZP, ZE, BLUE, name='quoins')
else:
    K.course(poly, ZE - 0.3, 0.12, 0.06, 'brick_dark', name='eave_dentil')

# ---- gables, roof ---------------------------------------------------------------------------------------------
pitch = cfg['pitch']
zr = ZE + (W / 2) * math.tan(math.radians(pitch))
for e, fr in ((1, []), (3, [hayf] if hayf else [])):
    K.gable(poly, e, ZE, zr, T, cfg['wall'], fr + [f for (ea, f) in attic if ea == e], name='gable%d' % e, mat_tint=wt)
for k, (e, f) in enumerate(attic):
    K.window(f, 'casement', (1, 2), frame='white' if cfg['wall'] != 'limewash_worn' else (0.32, 0.4, 0.33), sill=BLUE,
             lintel=BLUE, shutters=None, curtain=0.0, name='attic%d' % k)
bm = bmesh.new()                                       # gable ancres: iron S-anchors at the purlin and ridge-beam ends
for xg, sg in ((x1, 1), (x0, -1)):
    for (yy, zz) in ((-W / 4, ZE + 0.25 * (zr - ZE) + 0.1), (W / 4, ZE + 0.25 * (zr - ZE) + 0.1), (0.0, zr - 0.75)):
        K.box_bm(bm, (xg + sg * 0.03, yy, zz), (0.04, 0.05, 0.6))
        K.box_bm(bm, (xg + sg * 0.03, yy, zz + 0.27), (0.04, 0.2, 0.05))
        K.box_bm(bm, (xg + sg * 0.03, yy, zz - 0.27), (0.04, 0.2, 0.05))
K.part(bm, 'cast_iron', name='gable_ancres', mat_tint=(0.25, 0.24, 0.23), lod='drop')
R = K.roof_gable(0, 0, L, W, ZE, pitch, cfg['roof'], eave_oh=0.35, gable_oh=0.12, thick=0.12,
                 fascia='timber_beam', barge='timber_beam', gutters=True, sag=0.03, wobble=0.01)
for o in R.parts:
    if 'slope' in o.name:
        o.data.materials[0] = K.mat(cfg['roof'], cfg['rt'])
ridge_tiles((x0 - 0.12, 0, zr + 0.02), (x1 + 0.12, 0, zr + 0.02), mid='roof_tile_flat' if 'pantile' not in cfg['roof'] else cfg['roof'],
            tint=(0.35, 0.36, 0.38) if 'slate' in cfg['roof'] or 'black' in cfg['roof'] else (0.8, 0.55, 0.45), finials=False)
# stone copings on the gable rakes (parapeted Mosan gables)
bm = bmesh.new()
for xg in (x0, x1):
    for s in (-1, 1):
        K.beam_bm(bm, (xg, s * (W / 2 + 0.05), ZE + 0.1), (xg, 0, zr + 0.18), T + 0.12, 0.12)
K.part(bm, BLUE, name='gable_coping', mat_tint=BLUE_T, uv='beam', axis=(0, 1, 0), grime=0.5)
for xg in (x0 + 0.45, x1 - 0.45):                      # chimney stacks on both gables
    K.chimney(xg, 0.6 * (1 if xg > 0 else -1), zr - 1.2, zr + 1.0, 0.8, 0.55, 'brick_red' if cfg['wall'] != 'brick_dark' else 'brick_dark',
              cap=BLUE, pots=1 + (xg > 0), name='chimney%s' % ('E' if xg > 0 else 'W'))
if cfg.get('dormer'):
    K.dormer(R, 0.0, -1, w=1.0 if L < 7 else 1.15, h=1.2, wall='plaster_white' if cfg.get('stucco') else cfg['wall'], roof=cfg['roof'],
             pitch=52, window_kw=dict(frame='white', shutters=None))
K.anchor('roof_ridge', (0, 0, zr))
if VAR == 'q':                                          # garrison: a flagpole slanting out of the first-floor facade
    bm = bmesh.new()
    zb = FH + 1.0
    K.cyl_bm(bm, (x1 - 1.0, y0 + 0.05, zb), (x1 - 1.0, y0 - 1.6, zb + 1.6), 0.04, 6)
    K.box_bm(bm, (x1 - 1.0, y0 - 0.04, zb), (0.22, 0.08, 0.3))
    K.part(bm, 'cast_iron', name='flagpole', mat_tint=(0.3, 0.3, 0.3), bisect=False)
    K.anchor('flag', (x1 - 0.95, y0 - 1.6, zb + 1.55), (1, 0, 0), kind='flag', w=1.4, h=0.95)
# ---- windows, doors -------------------------------------------------------------------------------------------
sc = SHUTTER[cfg['shut']]
for k, f in enumerate(wins):
    ground = f.z0 < 1.5 if hasattr(f, 'z0') else False
    st = None if cfg.get('stucco') and k % 3 else ('closed' if k % 5 == 4 else 'open' if k % 2 == 0 else None)
    K.window(f, 'casement', (2, 3), frame='white' if cfg['wall'] != 'limewash_worn' else (0.32, 0.4, 0.33),
             sill=BLUE, lintel=None if shape == 'segment' else BLUE, shutters=st if not cfg.get('stucco') else None,
             shutter_color=sc, shutter_style='louvred' if cfg.get('stucco') else 'plank', curtain=0.6, name='w%d' % k)
    if shape == 'segment':
        K.voussoirs(f, 'brick_dark' if cfg['wall'] != 'brick_dark' else 'brick_red', key=False, name='arch%d' % k)
if shopwin:
    K.window(shopwin, 'fixed', (3, 2), frame=DOOR['blue'], sill=BLUE, lintel=BLUE, streak=False, name='shopwin')
    K.sign((shopwin.o.x, y0 - 0.06, 2.95), (0, -1, 0), 2.2, cfg['shop'], board='wood_paint')
K.door(door_f, 'front', 'panel' if not cfg.get('tar') else 'plank', DOOR[cfg['door']], step=BLUE, lintel=BLUE if shape == 'rect' else None)
K.door(door_b, 'back', 'plank', DOOR['brown'], step=None)
if hayf:
    K.door(hayf, 'hay', 'plank', DOOR['brown'], step=None)
    bm = bmesh.new()                                   # hoist beam over the hay door
    K.beam_bm(bm, (x0 + 0.1, 0, zr - 0.6), (x0 - 0.9, 0, zr - 0.6), 0.16, 0.18)
    K.part(bm, 'timber_beam', name='hoist', uv='beam', axis=(1, 0, 0), mat_tint=(0.4, 0.33, 0.26))
if cfg.get('sign'):
    K.sign((L / 2 - L / 2 + 0.0, y0 - 0.06, 2.75), (0, -1, 0), 1.6, cfg['sign'], board='wood_paint')
K.wall_lantern((door_f.o.x + 0.95, y0, 0), (0, -1, 0), 2.45)

# ---- wrought-iron wall anchors (ancres) at the floor levels ------------------------------------------------------
if cfg.get('anchors') or cfg.get('quoins'):
    bm = bmesh.new()
    for fl in range(1, NF + 1):
        z = fl * FH - 0.1 if fl < NF + 1 else ZE - 0.4
        for x in (x0 + 0.9, -1.0, 1.0, x1 - 0.9):
            K.box_bm(bm, (x, y0 - 0.03, z), (0.05, 0.04, 0.55))
            K.box_bm(bm, (x, y0 - 0.03, z), (0.28, 0.04, 0.05))
    K.part(bm, 'cast_iron', name='ancres', mat_tint=(0.25, 0.24, 0.23), lod='drop')

# ---- weathering ---------------------------------------------------------------------------------------------
for i in range(5):
    K.decal('damp_base', (r.uniform(x0 + 0.8, x1 - 0.8), y0 - 0.21, 0.75), (0, -1, 0), r.uniform(1.2, 2.2), 0.7, alpha=0.5)
    K.decal('moss_patch', (r.uniform(x0 + 1, x1 - 1), y1 + 0.21, 0.5), (0, 1, 0), r.uniform(0.8, 1.4), 0.5, alpha=0.45)
if not cfg.get('stucco'):
    K.decal('efflorescence', (x1 + 0.21, r.uniform(-2, 2), 1.2), (1, 0, 0), 1.6, 1.0, alpha=0.35)
else:
    K.decal('stain_blotch', (x1 + 0.21, r.uniform(-2, 2), 2.0), (1, 0, 0), 2.0, 1.6, alpha=0.3)
K.decal('poster_fr', (x1 + 0.21, -W / 2 + 1.0, 1.7), (1, 0, 0), 0.6, 0.85, alpha=0.8)
eave_streaks([((x0, y0), (x1, y0)), ((x1, y1), (x0, y1))], ZE - 0.3, n=3, seed=SEED, alpha=0.3)
roof_tone(R, seed=SEED)
roof_decals(R, 3, seed=SEED)
K.footprint_rect(0, 0, L, W, 0, 'HIGH')
if VAR == 'w':
    from eu_common import rotate_asset_cw90
    rotate_asset_cw90()
finish(os.path.join(ROOT, NAME))
