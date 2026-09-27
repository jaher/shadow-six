"""Norwegian naust (boathouse) on the shore: gable end with the big boat doors faces the water (-Y = front),
ridge runs inland (+Y). Variants:
  a = Vestland type: thick dry-stone side/back walls, tarred board gables, slate roof, log slipway (stoer) into the water
  b = all-timber type: weathered grey vertical boards on a low stone footing, sod roof with eave log, plank slipway
Usage: blender -b --python naust.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('naust')
name = 'naust_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'coast', snow=SNOW, water_level=-0.45)
r = K.rng()

Wd, Ln = (5.6, 9.0) if VAR == 'a' else (4.8, 7.6)
ZE = 2.3 if VAR == 'a' else 2.1
PITCH = 42 if VAR == 'a' else 30
x0, x1, y0, y1 = -Wd / 2, Wd / 2, -Ln / 2, Ln / 2
poly = N.rect(x0, y0, x1, y1)
zr = ZE + (Wd / 2) * math.tan(math.radians(PITCH))
TS = 0.75 if VAR == 'a' else 0.16                   # side wall thickness

# boat door (double leaves) in the front gable wall
if VAR == 'a':
    big = K.opening(poly, 0, Wd / 2, Wd - 2 * TS, ZE, 0.0, TS, 'rect', 'door')     # full opening between stone jambs
    K.wall_ring(poly, ZE, TS, 'fieldstone_grey', [big], name='stonewalls', grime=1.0)
    K.wall_ring(C.poly_offset(poly, 0.06), 0.35, TS + 0.1, 'fieldstone_grey', [big], z0=-0.9, name='footing', footprint=False)
    # timber infill wall inside the front opening, with the boat doors
    yi = y0 + 0.25
    ipoly = N.rect(x0 + TS - 0.02, yi, x1 - TS + 0.02, yi + 0.12)
    bd = K.opening(ipoly, 0, (Wd - 2 * TS) / 2 + 0.02, 2.9, 2.15, 0.0, 0.12, 'rect', 'door')
    bm = K.bm_new()
    K.box_bm(bm, (0, yi + 0.06, ZE / 2), (Wd - 2 * TS + 0.04, 0.12, ZE))
    bm = K.boolean_cut(bm, [bd])
    K.part(bm, 'timber_tarred', name='front_infill', rot90=True)
    for e in (0, 2):
        K.gable(poly, e, ZE, zr - 0.0, 0.14, 'timber_tarred', [], name='gable%d' % e, rot90=True)
    for sx in (-1, 1):                                     # dry-stone wing walls stepping down the foreshore
        bm = K.bm_new()
        xc = sx * (Wd / 2 - TS / 2)
        for k in range(3):
            K.box_bm(bm, (xc + sx * 0.05 * k, y0 - 0.55 - k * 0.9, (1.0 - k * 0.3) / 2 - 0.25),
                     (TS + 0.1 - k * 0.05, 0.95, 1.0 - k * 0.3 + 0.5), taper=(0.92, 1.0))
        K.part(bm, 'fieldstone_grey', name='wing%d' % (sx + 1), grime=1.0)
        K.footprint(N.rect(xc - TS / 2, y0 - 3.0, xc + TS / 2, y0), 'HIGH', 'wall')
        bm = K.bm_new()
        K.box_bm(bm, (sx * (Wd / 2 - TS / 2), y0 + 0.02, ZE + 0.06), (TS + 0.12, 0.5, 0.16), taper=(0.9, 0.9))
        K.part(bm, 'granite', name='wallhead%d' % (sx + 1))
    K.climb_meta((x0, y0 + 0.3), (x0, y1 - 0.3), ZE)       # GB can climb the dry-stone side walls
    K.climb_meta((x1, y0 + 0.3), (x1, y1 - 0.3), ZE)
else:
    bd = K.opening(poly, 0, Wd / 2, 2.8, 2.0, 0.0, TS, 'rect', 'door')
    side = K.opening(poly, 1, 2.2, 0.9, 1.9, 0.0, TS, 'rect', 'door')
    win = K.opening(poly, 3, Ln - 2.5, 0.6, 0.5, 1.3, TS)
    WB = N.board_walls(poly, 0.0, ZE, TS, [bd, side, win], 'weathered')
    N.plinth(poly, 0.25, 'fieldstone_grey', frames=[bd, side], thick=0.3)
    for e in (0, 2):
        N.board_gable(poly, e, ZE, zr, TS, [], 'weathered', name='gable%d' % e)
    K.door(side, 'side', 'plank', (0.5, 0.47, 0.42), step=None)
    K.window(win, 'fixed', (2, 2), frame=(0.5, 0.48, 0.44), sill=None, streak=False, curtain=0, name='w0')
    N.corner_boards(poly, 0.0, ZE, tint=(0.62, 0.6, 0.56))
K.door(bd, 'boat', 'barn', (0.42, 0.38, 0.33) if VAR == 'b' else (0.36, 0.3, 0.26), step=None,
       open_deg=0 if VAR == 'b' else 0)
# loft hatch in the front gable
bm = K.bm_new()
hz = ZE + 0.35
K.box_bm(bm, (0, y0 - 0.05, hz + 0.45), (0.9, 0.06, 0.9))
K.part(bm, 'door_planks', name='loft_hatch', mat_tint=(0.7, 0.66, 0.6))
bm = K.bm_new()
for dz in (0.15, 0.75):
    K.box_bm(bm, (0.05, y0 - 0.09, hz + dz), (0.6, 0.02, 0.05))
K.part(bm, 'cast_iron', name='hatch_hinges', grime=0.2)

# roof
if VAR == 'a':
    R = K.roof_gable(0, 0, Ln, Wd, ZE, PITCH, 'roof_slate', rot=math.pi / 2, eave_oh=0.25, gable_oh=0.3, thick=0.12,
                     fascia='wood_paint', barge='wood_paint', gutters=False, sag=0.08, wobble=0.03)
    N.dress_roof(R, moss=0.8, guards=False, ridge=('timber_tarred', (0.8, 0.75, 0.7)), rafters=False, seed=SEED)
    R.snow_patchy = 0.1
else:
    R = N.sod_roof(0, 0, Ln, Wd, ZE, PITCH, rot=math.pi / 2, eave_oh=0.4, gable_oh=0.3, seed=SEED, shrubs=1)
K.anchor('roof_ridge', (0, 0, R.z_ridge))
if VAR == 'b':
    # tar soaked up from the footing + salt-silvered upper boards; cover battens every 0.4 m for plank relief
    N.weather_gradient(('walls', 'gable'), 0.0, 1.5, low=(0.42, 0.38, 0.33), high=(1.05, 1.05, 1.05), seed=SEED)
    N.battens((x0, y0), (x1, y0), (0, -1, 0), 0.3, lambda t: ZE + (Wd / 2 - abs(t - Wd / 2)) * math.tan(math.radians(PITCH)) - 0.15,
              spacing=0.4, holes=[(Wd / 2 - 1.5, Wd / 2 + 1.5, 0, 2.1), (Wd / 2 - 0.55, Wd / 2 + 0.55, ZE + 0.3, ZE + 1.3)],
              mid='boards_weathered', name='battens_front')
    for sx in (-1, 1):
        xx = sx * Wd / 2
        N.battens((xx, y0 if sx > 0 else y1), (xx, y1 if sx > 0 else y0), (sx, 0, 0), 0.3, lambda t: ZE - 0.05,
                  spacing=0.4, holes=([(2.2 - 0.55, 2.2 + 0.55, 0, 2.0)] if sx > 0 else [(2.5 - 0.4, 2.5 + 0.4, 1.2, 1.9)]),
                  mid='boards_weathered', name='battens_%d' % (sx + 1))
    for k in range(7):
        sx = r.choice((-1, 1))
        K.decal('streak_long', (sx * (Wd / 2 + 0.01), r.uniform(y0 + 0.6, y1 - 0.6), ZE - 0.7), (sx, 0, 0),
                r.uniform(0.4, 0.8), 1.3, alpha=0.8)
    for k in range(3):
        K.decal('stain_blotch', (r.uniform(x0 + 0.4, x1 - 0.4), y0 - 0.02, r.uniform(0.3, 0.9)), (0, -1, 0), 0.9, 0.7, alpha=0.7)

# slipway (stoer): log rails on stone sleepers running down into the water
bm, bm2 = K.bm_new(), K.bm_new()

def slz(yy):                                   # slipway top: level through the doors, then down the foreshore
    return 0.16 if yy > y0 - 1.8 else 0.16 - (y0 - 1.8 - yy) * 0.3
for sx in (-0.75, 0.75):
    K.cyl_bm(bm, (sx, y0 + 1.6, slz(0) ), (sx, y0 - 1.8, slz(y0 - 1.8)), 0.11, 8)
    K.cyl_bm(bm, (sx, y0 - 1.8, slz(y0 - 1.8)), (sx, y0 - 6.0, slz(y0 - 6.0)), 0.11, 8)
for k in range(8):
    yy = y0 + 1.2 - k * 0.95
    zz = slz(yy) - 0.17
    K.cyl_bm(bm, (-1.15, yy, zz), (1.15, yy, zz), 0.08, 6)
    if yy < y0 - 0.3:
        K.box_bm(bm2, (-0.75, yy, zz - 0.22), (0.45, 0.4, 0.4))
        K.box_bm(bm2, (0.75, yy - 0.1, zz - 0.22), (0.4, 0.45, 0.4))
K.part(bm, 'timber_tarred', name='slip_rails', uv='beam', axis=(0, 1, 0), smooth=True)
K.part(bm2, 'granite', name='slip_stones')
K.footprint(N.rect(-1.3, y0 - 6.0, 1.3, y0), 'NONE', 'slipway')
# faering hauled up on the slipway, bow to the water
N.rowboat((0, y0 - 3.2, slz(y0 - 3.2) + 0.08), (0, -1, 0), tilt=-math.atan(0.3), paint=(0.86, 0.84, 0.78) if VAR == 'a' else (0.45, 0.62, 0.72))
# mooring post, oars, net floats
bm = K.bm_new()
K.cyl_bm(bm, (x1 + 0.8, y0 - 1.6, -1.0), (x1 + 0.8, y0 - 1.6, 1.0), 0.13, 8, r1=0.11)
K.part(bm, 'timber_tarred', name='mooring_post', uv='beam', axis=(0, 0, 1), smooth=True)
K.footprint_rect(x1 + 0.8, y0 - 1.6, 0.4, 0.4, 0, 'LOW', 'post')
bm = K.bm_new()
for k in range(2):
    xx = x1 + 0.12
    K.cyl_bm(bm, (xx, y0 + 1.2 + k * 0.35, 0.02), (xx + 0.05, y0 + 1.5 + k * 0.35, 2.4), 0.025, 5)
    K.box_bm(bm, (xx + 0.01, y0 + 1.25 + k * 0.35, 0.35), (0.03, 0.13, 0.6))
K.part(bm, 'timber_grey', name='oars', uv='beam', axis=(0, 0, 1))
# peg rail on the west wall with two float lines hanging in catenaries against the wall + a net heap below
xw = x0 - (0.02 if VAR == 'b' else 0.0)
bm = K.bm_new()
K.box_bm(bm, (xw - 0.03, y0 + 2.0, 1.95), (0.06, 2.4, 0.12))
for k in range(4):
    K.cyl_bm(bm, (xw - 0.05, y0 + 0.95 + k * 0.7, 1.95), (xw - 0.22, y0 + 0.95 + k * 0.7, 1.99), 0.025, 5)
K.part(bm, 'timber_grey', name='peg_rail', uv='beam', axis=(0, 1, 0))
# net hung to dry from the peg rail: cork head-rope floats + lead line give the floats their context
N.hanging_net((xw - 0.12, y0 + 0.75), (xw - 0.12, y0 + 3.3), 1.9, 1.45, seed=SEED)
N.naust_props(x0, x1, y0, y1, xw, VAR, SEED)
import kit_weather as KW
nb = KW._blob_bm((x0 - 0.45, y0 + 2.0, 0.12), 0.45, 5.0, (1.0, 1.6, 0.45), 2, 0.35)
K.part(nb, 'hessian', name='net_heap', mat_tint=(0.42, 0.45, 0.4), grime=0.4)
K.footprint(N.rect(x0 - 0.9, y0 + 1.2, x0, y0 + 2.8), 'LOW', 'nets')
# seaweed / wet weed on the lower slipway and the stone sleepers
sw = K.bm_new()
for k in range(26):
    yy = y0 - 1.9 - r.uniform(0, 4.0)
    xx = r.choice((-0.75, 0.75)) + r.uniform(-0.25, 0.25)
    b_ = KW._blob_bm((xx, yy, slz(yy) - 0.05), r.uniform(0.12, 0.25), r.random() * 9, (1.4, 1.0, 0.35), 1, 0.4)
    tmp = __import__('bpy').data.meshes.new('sw'); b_.to_mesh(tmp); b_.free(); sw.from_mesh(tmp)
    __import__('bpy').data.meshes.remove(tmp)
K.part(sw, 'mud', name='seaweed', grime=0, mat_tint=(0.35, 0.38, 0.18), jitter=0.15)

for i in range(4):
    K.decal('lichen', (r.uniform(x0 + 0.5, x1 - 0.5), y1 + 0.001, r.uniform(0.3, 1.6)), (0, 1, 0), 1.0, 0.8)
K.decal('waterline', (0, y0 - 0.03, 0.1), (0, -1, 0), Wd, 0.6)
for sx in (-1, 1):
    K.decal('waterline', (sx * (Wd / 2 + 0.01), 0, 0.15), (sx, 0, 0), Ln, 0.7, alpha=0.7)
for rail in N.C.A.parts:
    if rail.name.startswith('slip_'):
        N.recolor(rail, lambda p, n, c: (c[0] * (0.55 if p.z < 0.0 else 0.8), c[1] * (0.62 if p.z < 0.0 else 0.82),
                                         c[2] * (0.45 if p.z < 0.0 else 0.75)) if p.y < y0 - 1.0 else None)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
