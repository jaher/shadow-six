"""German guard hut / checkpoint (Wache) in occupied Norway.
  a = timber guard hut 3.0 x 2.4 m on sleepers: windows on three sides, door, shallow tar-paper roof with battens,
      stove pipe, WACHE sign, field telephone box, bench, sandbag breastwork on one side
  b = Schilderhaus sentry box 1.2 x 1.2 m on a concrete plinth: framed chevron-striped box (posts, panels, vision
      slits with reveals + flaps), frieze, overhanging steel pyramid roof with hip rolls/finial, bench, lantern,
      field telephone, duckboard
Usage: blender -b --python guard_hut.py -- outdir a|b seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C
import bmesh

OUT, VAR, SEED, SNOW = N.args('guard_hut')
name = 'guard_hut_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()

if VAR == 'a':
    L, W, ZF = 3.6, 2.8, 0.3
    ZE = ZF + 2.3
    x0, x1, y0, y1 = -L / 2, L / 2, -W / 2, W / 2
    poly = N.rect(x0, y0, x1, y1)
    T = 0.14
    PITCH = 32
    zr = ZE + (W / 2) * math.tan(math.radians(PITCH))
    door = K.opening(poly, 0, 0.75, 0.85, 1.95, ZF, T, 'rect', 'door')
    wins = [K.opening(poly, 0, L - 1.05, 1.2, 0.95, ZF + 1.0, T), K.opening(poly, 1, W / 2, 0.8, 0.9, ZF + 1.0, T),
            K.opening(poly, 3, W / 2, 0.8, 0.9, ZF + 1.0, T), K.opening(poly, 2, L / 2, 0.8, 0.8, ZF + 1.1, T)]
    N.board_walls(poly, ZF, ZE - ZF, T, [door] + wins, 'horiz', N.FIELDGREY)
    for e in (1, 3):
        N.board_gable(poly, e, ZE, zr, T, [], 'vert', N.FIELDGREY, name='gable%d' % e)
    N.corner_boards(poly, ZF, ZE, w=0.12, proud=0.04, tint=(0.4, 0.42, 0.38))
    N.band(poly, ZF - 0.06, 0.14, 0.04, tint=(0.35, 0.33, 0.3), name='sill_board')
    for k, f in enumerate(wins):
        K.window(f, 'casement' if f.w > 1 else 'single', (2, 2) if f.w > 1 else (1, 2), frame='white', recess=0.04,
                 sill='wood_paint', shutters=('open' if k < 3 else None), shutter_color=(0.32, 0.36, 0.3),
                 curtain=0, streak=False, name='w%d' % k)
    K.door(door, 'hut', 'plank', (0.3, 0.3, 0.27), step='concrete_bunker')
    N.casing(door, w=0.09, crown=False, tint=(0.75, 0.75, 0.72), name='cas_door')
    bm = K.bm_new()                                  # concrete pier footings under the sill beams
    for xx in (x0 + 0.25, 0, x1 - 0.25):
        for yy in (y0 + 0.25, y1 - 0.25):
            K.box_bm(bm, (xx, yy, ZF / 2 - 0.05), (0.35, 0.35, ZF + 0.1))
    K.part(bm, 'concrete_bunker', name='piers')
    bm = K.bm_new()
    import kit_arch as KA
    KA.ring_bm(bm, C.poly_offset(poly, -0.02), C.poly_offset(poly, -0.06), 0.0, ZF)
    bm = K.boolean_cut(bm, [door])
    K.part(bm, 'timber_tarred', name='skirting', rot90=True)
    # gabled felt roof with battens, generous overhang and a door canopy
    R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'tar_paper_batten', eave_oh=0.4, gable_oh=0.35, thick=0.08, fascia='timber_beam',
                     barge='timber_beam', gutters=False, sag=0.02, wobble=0.005)
    N.roof_battens(R, spacing=0.75)
    N.roof_weather(R, moss=0.08, streaks=0.8, seed=SEED)
    bm = K.bm_new()
    for sx in (-1, 1):
        K.beam_bm(bm, (door.o.x + sx * 0.6, y0 - 0.02, ZF + 2.1), (door.o.x + sx * 0.6, y0 - 0.75, ZF + 2.28), 0.07, 0.09)
    K.part(bm, 'timber_beam', name='canopy_brackets', uv='beam', axis=(0, 1, 0))
    K.roof_shed(door.o.x - 0.75, y0 - 0.85, door.o.x + 0.75, y0 - 0.02, ZF + 2.25, ZF + 2.45, 'tar_paper', thick=0.05,
                oh=0.0, low_side='-y', name='canopy', gutters=False)
    C.A.meta['roofs'].pop()
    N.stovepipe(x1 - 0.6, y1 - 0.5, ZE, R.z_ridge + 0.5)
    K.anchor('roof_ridge', (0, 0, R.z_ridge))
    K.sign((door.o.x, y0 - 0.02, ZF + 2.0 + 0.0), (0, -1, 0), 0.9, 'wache')
    K.wall_lantern((door.o.x + 0.65, y0, 0), (0, -1, 0), ZF + 1.95)
    # field telephone: wooden case on a post by the door, cable up to a telegraph pole with insulators
    tx, ty = x1 + 0.7, y0 - 0.5
    bm = K.bm_new()
    K.box_bm(bm, (tx, ty, 0.7), (0.1, 0.1, 1.4))
    K.cyl_bm(bm, (tx + 1.6, ty + 1.2, 0.0), (tx + 1.6, ty + 1.2, 5.2), 0.1, 8, r1=0.08)
    K.box_bm(bm, (tx + 1.6, ty + 1.2, 4.9), (0.9, 0.08, 0.08))
    K.part(bm, 'timber_creosote', name='phone_post', uv='beam', axis=(0, 0, 1))
    bm = K.bm_new()
    K.box_bm(bm, (tx, ty - 0.12, 1.25), (0.32, 0.18, 0.42))
    K.box_bm(bm, (tx, ty - 0.22, 1.3), (0.26, 0.03, 0.3))
    K.part(bm, 'wood_paint', name='phone_box', mat_tint=(0.36, 0.38, 0.3))
    bm = K.bm_new()
    K.cyl_bm(bm, (tx + 0.12, ty - 0.23, 1.38), (tx + 0.12, ty - 0.23, 1.5), 0.035, 6)          # handset
    K.cyl_bm(bm, (tx - 0.13, ty - 0.23, 1.28), (tx - 0.2, ty - 0.23, 1.28), 0.02, 5)          # crank
    for ix in (-0.35, 0.35):
        K.cyl_bm(bm, (tx + 1.6 + ix, ty + 1.2, 4.95), (tx + 1.6 + ix, ty + 1.2, 5.07), 0.04, 6)
    pts = [V((tx, ty - 0.05, 1.45))] + [V((tx + 1.6 * t, ty + 1.2 * t, 1.45 + 3.5 * t - 0.4 * math.sin(math.pi * t))) for t in (0.33, 0.66, 1.0)]
    for a_, b_ in zip(pts, pts[1:]):
        K.cyl_bm(bm, a_, b_, 0.01, 4)
    for ix in (-0.35, 0.35):                                                                  # line wires leaving
        K.cyl_bm(bm, (tx + 1.6 + ix, ty + 1.2, 5.07), (tx + 1.6 + ix + 3.0, ty + 1.2 + 2.5, 4.7), 0.008, 3)
    K.part(bm, 'cast_iron', name='phone_iron', grime=0.2)
    K.anchor('telephone', (tx, ty - 0.4, 0), (0, -1, 0))
    K.footprint(N.rect(tx - 0.2, ty - 0.35, tx + 0.2, ty + 0.1), 'LOW', 'phone')
    K.footprint_rect(tx + 1.6, ty + 1.2, 0.4, 0.4, 0, 'HIGH', 'pole')
    bm = K.bm_new()                                  # bench + fire bucket + rifle rack against the front
    K.box_bm(bm, (-0.5 + 1.2, y0 - 0.32, 0.45), (1.0, 0.32, 0.05))
    for sx in (-0.4, 0.4):
        K.box_bm(bm, (0.7 + sx, y0 - 0.32, 0.22), (0.06, 0.28, 0.44))
    K.box_bm(bm, (x0 - 0.06, 0.0, ZF + 1.1), (0.05, 1.0, 0.06))
    K.box_bm(bm, (x0 - 0.06, 0.0, ZF + 0.35), (0.05, 1.0, 0.08))
    K.part(bm, 'timber_grey', name='bench')
    bm = K.bm_new()
    for k in range(3):
        yy = -0.35 + k * 0.35
        K.cyl_bm(bm, (x0 - 0.1, yy, ZF + 0.3), (x0 - 0.13, yy + 0.03, ZF + 1.3), 0.025, 5)
    K.part(bm, 'timber_beam', name='rifles', mat_tint=(0.35, 0.28, 0.22))
    bm = K.bm_new()
    K.cyl_bm(bm, (door.o.x - 0.75, y0 - 0.16, ZF + 1.0), (door.o.x - 0.75, y0 - 0.16, ZF + 1.3), 0.11, 10, r1=0.13)
    K.part(bm, 'wood_paint', name='fire_bucket', mat_tint=(0.85, 0.12, 0.1), smooth=True)
    N.gravel_strip(poly, 0.4)
    # sandbag breastwork on the west side (L-shaped)
    bm = K.bm_new()
    for row in range(4):
        n = 7 - row % 2
        for i in range(n):
            yy = y0 - 0.6 + (W + 1.2) * (i + 0.5 * (row % 2) + 0.5) / 7.2
            K.box_bm(bm, (x0 - 1.1 + r.uniform(-0.03, 0.03), yy, 0.13 + row * 0.24), (0.36, 0.5, 0.2), rot_z=r.uniform(-0.1, 0.1), taper=(0.85, 0.9))
        for i in range(2 - row // 2):
            K.box_bm(bm, (x0 - 0.7 + i * 0.5, y0 - 0.75, 0.13 + row * 0.24), (0.5, 0.36, 0.2), rot_z=r.uniform(-0.1, 0.1), taper=(0.9, 0.85))
    K.part(bm, 'hessian', name='sandbags', mat_tint=(0.8, 0.72, 0.58), jitter=0.12)
    K.footprint(N.rect(x0 - 1.3, y0 - 0.95, x0 - 0.2, y1 + 0.6), 'LOW', 'sandbags')
else:
    import sentry_box                                # rework 2: real Schilderhaus geometry (see sentry_box.py)
    ZE = sentry_box.build(r, SNOW)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=512, ao_samples=48, recenter=False)
