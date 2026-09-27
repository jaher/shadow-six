"""Norwegian log cabin with sod roof (laftet stue / seter hut, torvtak): round-hewn tarred logs with projecting
notched corners (laftehoder), log gables, corner stones, small windows with plain casings, plank door, fieldstone
chimney through the turf, birch-bark edge / eave logs. Variants:
  a = small 5 x 4 m hut, one room (spec log_cabin 5x4x3.5)
  b = 7 x 5 m cabin with svalgang (roofed open porch on posts at the east gable), two windows each side
Usage: blender -b --python log_cabin.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('log_cabin')
name = 'log_cabin_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
L, W = (5.0, 4.0) if VAR == 'a' else (7.0, 5.0)
D = 0.24
Z0 = 0.3                                       # sill log level (on corner stones)
ZE = Z0 + (2.1 if VAR == 'a' else 2.3)
PITCH = 27
x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
poly = N.rect(x0, y0, x1, y1)
zr = ZE + (W / 2) * math.tan(math.radians(PITCH)) + 0.1

fr = []
door = K.opening(poly, 0, (1.2 if VAR == 'a' else 1.4), 0.85, 1.75, Z0 + 0.12, D, 'rect', 'door')
fr.append(door)
wins = [K.opening(poly, 0, L - 1.5, 0.7, 0.7, Z0 + 1.0, D)]
if VAR == 'b':
    wins += [K.opening(poly, 0, 3.6, 0.7, 0.7, Z0 + 1.0, D), K.opening(poly, 2, 2.0, 0.7, 0.7, Z0 + 1.0, D),
             K.opening(poly, 2, 5.0, 0.7, 0.7, Z0 + 1.0, D)]
else:
    wins += [K.opening(poly, 3, W / 2, 0.6, 0.6, Z0 + 1.05, D)]
wins.append(K.opening(poly, 1, W / 2, 0.5, 0.45, ZE + 0.3, D))            # gable loft window
fr += wins
N.log_walls(x0, y0, x1, y1, Z0, ZE - Z0, D, 'log_hewn', fr, ext=0.3, gable_x=(ZE, zr),
            tint=(0.62, 0.5, 0.4) if VAR == 'a' else (0.7, 0.58, 0.46))
for k, f in enumerate(wins):
    K.window(f, 'casement' if f.w > 0.65 else 'single', (1, 2), frame=(0.82, 0.8, 0.74), recess=0.08, sill=None,
             curtain=0.5, streak=False, name='w%d' % k)
    N.casing(f, w=0.09, crown=False, apron=False, tint=(0.62, 0.58, 0.5), name='cas%d' % k)
K.door(door, 'front', 'plank', (0.45, 0.38, 0.3), step='granite')
N.casing(door, w=0.1, crown=False, tint=(0.55, 0.5, 0.42), name='cas_door')

# corner stones + low dry-stone fill under the sill logs
bm = K.bm_new()
for (cx, cy) in ((x0 + 0.1, y0 + 0.1), (x1 - 0.1, y0 + 0.1), (x1 - 0.1, y1 - 0.1), (x0 + 0.1, y1 - 0.1)):
    K.box_bm(bm, (cx, cy, 0.1), (0.62, 0.6, 0.5), rot_z=r.uniform(-0.2, 0.2), taper=(0.85, 0.8))
if VAR == 'b':
    for t in (0.35, 0.65):
        K.box_bm(bm, (x0 + L * t, y0 + 0.1, 0.1), (0.5, 0.5, 0.42), rot_z=r.uniform(-0.3, 0.3), taper=(0.8, 0.8))
        K.box_bm(bm, (x0 + L * t, y1 - 0.1, 0.1), (0.5, 0.5, 0.42), rot_z=r.uniform(-0.3, 0.3), taper=(0.8, 0.8))
K.part(bm, 'granite', name='corner_stones', jitter=0.1)
K.wall_ring(C.poly_offset(poly, -0.04), Z0 + 0.02, 0.3, 'fieldstone_grey', [door], z0=-0.05, name='fill', footprint=False)

# sod roof (svalgang extension over the east gable for variant b)
ext = 1.8 if VAR == 'b' else 0.0
R = N.sod_roof(ext / 2, 0, L + ext, W, ZE, PITCH, eave_oh=0.4, gable_oh=0.35, seed=SEED, shrubs=2 if VAR == 'a' else 3)
if VAR == 'b':
    bm = K.bm_new()
    px = x1 + ext - 0.15
    for yy in (y0 + 0.15, 0.0, y1 - 0.15):
        K.box_bm(bm, (px, yy, (ZE + 0.25) / 2 + 0.1), (0.16, 0.16, ZE - 0.05))            # squared posts
        for s in (-1, 1):                                                              # knee braces
            if abs(yy + s * 0.7) < W / 2:
                K.beam_bm(bm, (px, yy, ZE - 0.75), (px, yy + s * 0.6, ZE - 0.05), 0.09, 0.09)
        K.beam_bm(bm, (px, yy, ZE - 0.2), (x1 + 0.1, yy, ZE - 0.2), 0.1, 0.12)          # tie beams to the wall
    K.beam_bm(bm, (px, y0 - 0.25, ZE + 0.02), (px, y1 + 0.25, ZE + 0.02), 0.2, 0.2)       # wall plate
    K.part(bm, 'log_hewn', name='sval_posts', uv='beam', axis=(0, 0, 1), mat_tint=(0.62, 0.5, 0.4))
    bm = K.bm_new()
    for yy in (y0 + 0.15, 0.0, y1 - 0.15):
        K.box_bm(bm, (px, yy, 0.12), (0.42, 0.42, 0.34), rot_z=r.uniform(-0.3, 0.3), taper=(0.8, 0.8))
    K.part(bm, 'granite', name='sval_stones', jitter=0.1)
    bm = K.bm_new()
    K.box_bm(bm, (x1 + ext / 2, 0, Z0 - 0.06), (ext, W - 0.1, 0.12))
    for yy in (y0 + 0.3, 0.0, y1 - 0.3):                                               # joists under the floor
        K.box_bm(bm, (x1 + ext / 2, yy, Z0 - 0.2), (ext, 0.12, 0.16))
    K.part(bm, 'deck_planks', name='sval_floor', uv='beam', axis=(1, 0, 0), mat_tint=(0.72, 0.68, 0.62))
    K.railing((px, y0 + 0.2, Z0), (px, -0.75, Z0), 0.9, 'timber')
    K.railing((px, 0.75, Z0), (px, y1 - 0.2, Z0), 0.9, 'timber')
    K.railing((x1 + 0.2, y0 + 0.12, Z0), (px - 0.1, y0 + 0.12, Z0), 0.9, 'timber')
    K.stairs((px + 0.75, 0, 0), (-1, 0, 0), 1.1, Z0, 2, 'granite', solid=True, name='sval_steps')
    K.footprint(N.rect(x1, y0, x1 + ext, y1), 'NONE', 'porch')
    # a pair of skis and a bench in the porch
    bm = K.bm_new()
    K.box_bm(bm, (x1 + 0.9, y1 - 0.5, Z0 + 0.25), (1.2, 0.35, 0.05))
    for sx in (-0.45, 0.45):
        K.box_bm(bm, (x1 + 0.9 + sx, y1 - 0.5, Z0 + 0.12), (0.06, 0.3, 0.24))
    K.part(bm, 'timber_grey', name='bench')
# chimney: fieldstone stack with a slate cap slab
K.chimney(x0 + 1.0, 0.45, ZE - 0.4, R.z_ridge + 0.7, 0.75, 0.7, 'fieldstone_grey', cap='roof_slate', pots=0)
K.anchor('roof_ridge', (0, 0, R.z_ridge))

# lean-to vedskjul on the west gable: posts, shed roof of boards, stacked split wood inside
if VAR == 'a':
    bm = K.bm_new()
    for yy in (y0 + 0.4, y1 - 0.4):
        K.box_bm(bm, (x0 - 1.25, yy, 0.95), (0.12, 0.12, 1.9))
    K.part(bm, 'log_hewn', name='shelter_posts', uv='beam', axis=(0, 0, 1), mat_tint=(0.55, 0.47, 0.4))
    K.roof_shed(x0 - 1.45, y0 + 0.2, x0 - 0.05, y1 - 0.2, 1.85, 2.25, 'timber_tarred', thick=0.05, oh=0.12, low_side='-x',
                name='shelter_roof', gutters=False)
    C.A.meta['roofs'].pop()
    # board-on-board roof (tarred boards running down the slope, top layer over the joints) in the same dark
    # brown as the log walls, a sod-roof style eave log and moss creeping over from the main roof
    N.board_roof(N.ROOFS[-1], seed=SEED, tint=(0.62, 0.52, 0.44))
    bm = K.bm_new()
    for k in range(40):
        rr_ = r.uniform(0.06, 0.085)
        zz = 0.1 + (k // 10) * 0.16
        yy = y0 + 0.55 + (k % 10) * ((W - 1.1) / 10) + (0.08 if (k // 10) % 2 else 0)
        K.cyl_bm(bm, (x0 - 0.25, yy, zz), (x0 - 1.1, yy, zz), rr_, 6)
    K.part(bm, 'timber_beam', name='woodstack', uv='beam', axis=(1, 0, 0), grime=0.3, mat_tint=(0.95, 0.85, 0.7))
    K.footprint(N.rect(x0 - 1.5, y0 + 0.2, x0, y1 - 0.2), 'HIGH', 'woodshed')
    bm = K.bm_new()
    K.cyl_bm(bm, (x1 - 0.45, y0 - 0.45, 0), (x1 - 0.45, y0 - 0.45, 0.8), 0.3, 12)
    K.part(bm, 'timber_tarred', name='rain_barrel', uv='beam', axis=(0, 0, 1), smooth=True, mat_tint=(0.6, 0.5, 0.42))
    bm = K.bm_new()
    for rz in (0.12, 0.68):
        K.cyl_bm(bm, (x1 - 0.45, y0 - 0.45, rz), (x1 - 0.45, y0 - 0.45, rz + 0.05), 0.31, 12)
    K.part(bm, 'steel_galv', name='barrel_hoops', mat_tint=(0.4, 0.38, 0.36))
    bm = K.bm_new()
    K.box_bm(bm, (-0.2, y0 - 0.45, 0.45), (1.3, 0.34, 0.06))
    for sx in (-0.5, 0.5):
        K.box_bm(bm, (-0.2 + sx, y0 - 0.45, 0.21), (0.08, 0.3, 0.42))
    K.part(bm, 'timber_grey', name='bench_front')
    K.footprint(N.rect(x1 - 0.8, y0 - 0.8, x1 - 0.1, y0 - 0.1), 'LOW', 'barrel')
# chopping block + axe-split firewood
bm = K.bm_new()
K.cyl_bm(bm, (x0 - 1.0, y0 - 1.0, 0), (x0 - 1.0, y0 - 1.0, 0.5), 0.23, 9)
K.part(bm, 'timber_beam', name='chop_block', uv='beam', axis=(0, 0, 1))
if VAR == 'b':
    bm = K.bm_new()
    for k in range(16):
        rr = r.uniform(0.06, 0.08)
        zz = 0.08 + (k // 8) * 0.15
        yy = y0 + 0.6 + (k % 8) * 0.17
        K.cyl_bm(bm, (x0 - 0.35, yy, zz), (x0 - 0.8, yy, zz), rr, 6)
    K.part(bm, 'timber_beam', name='woodpile', uv='beam', axis=(1, 0, 0), grime=0.3)
    K.footprint(N.rect(x0 - 0.9, y0 + 0.4, x0 - 0.3, y0 + 2.0), 'LOW', 'woodpile')
K.decal('moss_patch', (x0 + 0.1, y1 + 0.13, 0.4), (0, 1, 0), 1.5, 0.5)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
