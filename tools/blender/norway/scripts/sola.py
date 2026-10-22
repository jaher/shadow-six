"""M1 Sola (Stavanger, February 1941) art pass builds (norway family; own types only, M1 picks them by `asset`).
 relay   relay_station_no        6 x 5 x 3.5: the Luftwaffe signals relay hut, grey-green painted board-and-batten on a
                                 fieldstone plinth, tar-paper gable roof with battens, blackout-shuttered windows,
                                 HALT board by the door, a wire dipole between two ridge poles, a lead-in insulator
                                 board and post on the NE corner (towards the mast), a petrol generator set under a
                                 lean-to on the E end, cable drums and a jerrycan rack; `relayd` = blown (_destroyed)
 stabbur stabbur_no              4 x 3.5 x 4.6: farm storehouse on stilts (stolper on granite pads with rat stones),
                                 tarred laft lower storey, Falu-red boarded overhanging loft, slate roof, free stair
 lumber  timber_stack_no         3 x 2 x 1: sawn planks stacked on bearers with stickers, a tarpaulin half over
                                 them, loose offcuts and a broken beam
rubble  rubble_fieldstone_low_no 3.5 x 2 x 1: the tumbled corner of a fieldstone byre by the road, wall stubs at
                                 most 1 m high (crawl cover) and the stones spilled forward, a charred joist across
usage: blender -b --python sola.py -- outroot variant seed [snow]"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('sola')
BASE = {'relay': 'relay_station_no', 'relayd': 'relay_station_no', 'stabbur': 'stabbur_no', 'lumber': 'timber_stack_no',
        'rubble': 'rubble_fieldstone_low_no'}[VAR]
DEST = VAR.endswith('d')
NAME = BASE + ('_destroyed' if DEST else '') + ('_snow' if SNOW and not DEST else '')
K.begin(NAME, SEED, theater='snow' if (SNOW or DEST) else 'temperate', snow=SNOW or DEST)
rq = random.Random(SEED * 37 + len(VAR))
GREEN = (0.56, 0.6, 0.5)           # faded field-grey-green paint (light enough to read against the snow)
FALU = (0.62, 0.2, 0.14)
TAR = (0.42, 0.34, 0.28)


def insulator(bm, p, r=0.035, h=0.1):
    """Porcelain pin insulator (bell) standing at p."""
    x, y, z = p
    K.cyl_bm(bm, (x, y, z), (x, y, z + h * 0.45), r * 1.25, 8, r1=r * 0.9)
    K.cyl_bm(bm, (x, y, z + h * 0.45), (x, y, z + h), r * 0.9, 8, r1=r * 0.5)


def wire(bm, a, b, r=0.009, sag=0.0, n=6):
    """Thin conductor from a to b (optionally sagging), as short beams."""
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)))
    for p, q in zip(pts, pts[1:]):
        K.cyl_bm(bm, p, q, r, 4, caps=False)


# ------------------------------------------------------------------------------------------------ relay station
if VAR in ('relay', 'relayd'):
    x0, x1, y0, y1 = -2.45, 1.85, -2.45, 2.45          # main hut; the generator lean-to fills x 1.85..3.0
    Z0, ZE, PITCH, T = 0.38, 2.6, 28, 0.14
    poly = N.rect(x0, y0, x1, y1)
    zr = ZE + (y1 - y0) / 2 * math.tan(math.radians(PITCH))
    door = K.opening(poly, 0, 2.75, 0.95, 1.95, Z0 + 0.02, T, 'rect', 'door')
    wins = [K.opening(poly, 0, 1.0, 0.85, 0.75, Z0 + 1.0, T), K.opening(poly, 2, 1.2, 0.85, 0.75, Z0 + 1.0, T),
            K.opening(poly, 2, 3.1, 0.85, 0.75, Z0 + 1.0, T), K.opening(poly, 3, 2.45, 0.7, 0.65, Z0 + 1.05, T)]
    N.plinth(poly, Z0, mid='fieldstone_grey', proj=0.05, thick=0.4, frames=[door])
    N.board_walls(poly, Z0, ZE - Z0, T, [door] + wins, cladding='batten', tint=GREEN, name='walls')
    for e, fy in ((1, 1), (3, 1)):                     # gable triangles (E and W)
        N.board_gable(poly, e, ZE, zr, T, cladding='batten', tint=GREEN, name='gable%d' % e)
    N.corner_boards(poly, Z0, ZE, w=0.14, tint=(0.36, 0.38, 0.33), name='corners')
    for k, f in enumerate(wins):
        K.window(f, 'casement', (2, 2), frame=(0.82, 0.8, 0.74), recess=0.06, sill=None, curtain=0.0, streak=False,
                 shutters='open' if k != 1 else 'closed', shutter_color=(0.3, 0.33, 0.28), name='w%d' % k)
    K.door(door, 'front', 'plank', (0.33, 0.36, 0.3), step='granite')
    K.sign((x0 + 1.95, y0 - T / 2 - 0.03, Z0 + 1.6), (0, -1, 0), 0.95, 'halt_sperrgebiet', board='timber_grey')
    R = K.roof_gable((x0 + x1) / 2, 0, x1 - x0, y1 - y0, ZE, PITCH, 'tar_paper', eave_oh=0.4, gable_oh=0.3, thick=0.08,
                     gutters=False)
    N.roof_battens(R, spacing=0.8)
    N.stovepipe(x0 + 0.9, 0.9, ZE - 0.2, zr + 0.75)
    zr2 = R.z_ridge
    # the dipole: two ridge poles (gable ends), spreader cross-arms, the wire span with end insulators, the feeder down
    bm = K.bm_new()
    poles = [(x0 + 0.25, 0.0), (x1 - 0.25, 0.0)]
    for (px, py) in poles:
        K.cyl_bm(bm, (px, py, zr2 - 0.25), (px, py, zr2 + 2.1), 0.055, 8, r1=0.04)
        K.beam_bm(bm, (px, py - 0.45, zr2 + 1.95), (px, py + 0.45, zr2 + 1.95), 0.05, 0.05)
    if not DEST:
        K.part(bm, 'timber_creosote', name='aerial_poles', uv='beam', axis=(0, 0, 1))
    bm = K.bm_new()
    for (px, py) in poles:
        for s in (-0.38, 0.38):
            insulator(bm, (px, py + s, zr2 + 1.98))
    insulator(bm, (x1 + 0.12, y1 - 0.25, ZE - 0.45), r=0.04)
    insulator(bm, (x1 + 0.12, y1 - 0.55, ZE - 0.45), r=0.04)
    if not DEST:
        K.part(bm, 'plaster_white', name='insulators', smooth=True, mat_tint=(0.95, 0.93, 0.88), lod='drop')
    bm = K.bm_new()
    for s in (-0.38, 0.38):
        wire(bm, (poles[0][0], s, zr2 + 2.07), (poles[1][0], s, zr2 + 2.07), sag=0.1, n=8)
    wire(bm, ((x0 + x1) / 2, -0.38, zr2 + 1.95), (x1 + 0.12, y1 - 0.25, ZE - 0.33), sag=0.15, n=8)   # feeder to lead-in
    wire(bm, ((x0 + x1) / 2, 0.38, zr2 + 1.95), (x1 + 0.12, y1 - 0.55, ZE - 0.33), sag=0.15, n=8)
    # lead-in post at the NE corner (towards the mast) with its two insulators and the run down into the hut
    K.cyl_bm(bm, (2.75, y1 - 0.2, ZE + 0.9), (x1 + 0.12, y1 - 0.25, ZE - 0.33), 0.009, 4, caps=False)
    if not DEST:
        K.part(bm, 'cast_iron', name='wires', mat_tint=(0.12, 0.12, 0.12), lod='drop')
    bm = K.bm_new()
    K.cyl_bm(bm, (2.75, y1 - 0.2, 0.0), (2.75, y1 - 0.2, ZE + 1.1), 0.075, 8, r1=0.06)
    K.beam_bm(bm, (2.75, y1 - 0.5, ZE + 0.95), (2.75, y1 + 0.1, ZE + 0.95), 0.06, 0.06)
    K.box_bm(bm, (x1 + 0.03, y1 - 0.4, ZE - 0.45), (0.05, 0.6, 0.35))                     # lead-in board
    K.part(bm, 'timber_creosote', name='leadin', uv='beam', axis=(0, 0, 1))
    bm = K.bm_new()
    insulator(bm, (2.75, y1 - 0.45, ZE + 0.98), r=0.04)
    insulator(bm, (2.75, y1 + 0.05, ZE + 0.98), r=0.04)
    K.part(bm, 'plaster_white', name='insulators2', smooth=True, mat_tint=(0.95, 0.93, 0.88), lod='drop')
    # generator lean-to on the E end: two posts, a shed roof off the gable, a petrol generator set on skids
    gx0, gx1, gy0, gy1 = x1, 3.0, -1.9, 1.5
    bm = K.bm_new()
    for py in (gy0 + 0.08, gy1 - 0.08):
        K.box_bm(bm, (gx1 - 0.08, py, 1.05), (0.12, 0.12, 2.1))
    K.beam_bm(bm, (gx1 - 0.08, gy0, 2.12), (gx1 - 0.08, gy1, 2.12), 0.12, 0.12)
    K.part(bm, 'timber_creosote', name='lean_posts', uv='beam', axis=(0, 0, 1))
    K.roof_shed(gx0, gy0, gx1, gy1, 2.15, 2.5, 'tar_paper_batten', low_side='+x', name='lean_roof', gutters=False, oh=0.08)
    C.A.meta['roofs'].pop()
    bm = K.bm_new()
    K.box_bm(bm, (2.4, -0.35, 0.06), (0.9, 1.5, 0.12))                       # skid frame
    for sx in (2.05, 2.75):
        K.box_bm(bm, (sx, -0.35, 0.12), (0.08, 1.6, 0.08))
    K.part(bm, 'steel_painted', name='gen_skid', mat_tint=(0.25, 0.27, 0.24))
    bm = K.bm_new()
    K.box_bm(bm, (2.4, -0.75, 0.48), (0.62, 0.62, 0.62), taper=(0.95, 0.95))  # engine block
    K.cyl_bm(bm, (2.4, -0.08, 0.5), (2.4, 0.52, 0.5), 0.27, 16)              # alternator drum
    K.box_bm(bm, (2.4, -1.12, 0.62), (0.56, 0.08, 0.7))                       # radiator
    K.cyl_bm(bm, (2.4, -0.62, 0.84), (2.4, -0.62, 1.05), 0.12, 10)            # tank cap / fuel tank
    K.box_bm(bm, (2.4, -0.45, 0.98), (0.4, 0.55, 0.22))
    K.part(bm, 'paint_metal', name='generator', mat_tint=(0.36, 0.4, 0.32), grime=0.8)
    bm = K.bm_new()
    K.cyl_bm(bm, (2.62, -0.9, 0.8), (2.62, -0.9, 2.3), 0.035, 6)             # exhaust up through the lean-to roof
    K.cyl_bm(bm, (2.62, -0.9, 2.3), (2.62, -0.9, 2.62), 0.055, 6)
    K.cyl_bm(bm, (2.4, 0.52, 0.5), (2.4, 0.75, 0.5), 0.05, 8)
    K.beam_bm(bm, (2.4, 0.75, 0.5), (gx0 + 0.02, 0.9, 1.6), 0.025, 0.025)     # cable into the hut
    K.part(bm, 'cast_iron', name='gen_pipes', mat_tint=(0.18, 0.17, 0.16))
    # cable drums and a jerrycan rack against the W gable; a fuel drum by the generator
    bm = K.bm_new()
    for (cx, cy, rr) in ((x0 - 0.3, -1.5, 0.34), (x0 - 0.3, -0.7, 0.3)):
        for s in (-0.17, 0.17):
            K.cyl_bm(bm, (cx + s, cy, rr), (cx + s + 0.04 * (1 if s > 0 else -1), cy, rr), rr, 14)
    K.part(bm, 'boards_weathered', name='drum_cheeks', smooth=False)
    bm = K.bm_new()
    for (cx, cy, rr) in ((x0 - 0.3, -1.5, 0.34), (x0 - 0.3, -0.7, 0.3)):
        K.cyl_bm(bm, (cx - 0.17, cy, rr), (cx + 0.17, cy, rr), rr * 0.72, 12)
    K.part(bm, 'cast_iron', name='drum_cable', smooth=True, mat_tint=(0.1, 0.1, 0.09))
    bm = K.bm_new()
    for k in range(3):
        K.box_bm(bm, (x0 - 0.25, 0.45 + k * 0.38, 0.35), (0.16, 0.34, 0.47))
    K.part(bm, 'paint_metal', name='jerrycans', mat_tint=(0.33, 0.36, 0.26), grime=0.7)
    K.P('paint_metal', K.cyl_bm, (2.75, 1.05, 0.0), (2.75, 1.05, 0.88), 0.29, 14, name='fuel_drum', mat_tint=(0.3, 0.33, 0.24))
    K.footprint(N.rect(-3.0, -2.5, 3.0, 2.5), 'HIGH', 'hut')
    if VAR == 'relayd':
        K.bite((x1 - 0.5, y0, 1.5), 1.9, seed=SEED)
        K.bite((x0 + 1.0, y1, 2.0), 1.6, seed=SEED + 1)
        K.bite((x0, -0.4, 1.3), 1.3, seed=SEED + 2)
        K.bite((x1, 0.6, 2.2), 1.2, seed=SEED + 4)
        K.roof_holes(R, [(0.6, -1.0, 1.5), (-1.0, 1.0, 1.3), (1.5, 1.1, 0.9), (-1.6, -1.2, 0.8)])
        K.rubble((x1 + 0.4, -1.5, 0), 1.4, 0.6, mids=('timber_creosote', 'fieldstone_grey'), n=26, beams=6, tiles='tar_paper', seed=SEED)
        K.rubble((x0 + 1.2, y1 + 0.3, 0), 1.2, 0.5, mids=('timber_creosote', 'boards_weathered'), n=18, beams=5, tiles='tar_paper', seed=SEED + 3)
        K.rubble((x0 + 0.6, y0 - 0.1, 0), 0.9, 0.4, mids=('boards_weathered', 'timber_creosote'), n=12, beams=3, tiles='tar_paper', seed=SEED + 5)
        bm = K.bm_new()                                # the two aerial poles thrown down across the debris
        K.cyl_bm(bm, (x0 + 0.3, y1 + 0.2, 0.15), (x0 + 2.4, y1 - 0.3, 0.45), 0.055, 8, r1=0.04)
        K.cyl_bm(bm, (x1 + 0.9, -1.0, 0.12), (x1 - 0.9, -2.3, 0.6), 0.055, 8, r1=0.04)
        K.part(bm, 'timber_creosote', name='poles_down', uv='beam', axis=(1, 0, 0))
    K.anchor('roof_ridge', (0, 0, zr))

# ------------------------------------------------------------------------------------------------ stabbur
if VAR == 'stabbur':
    ZF, LX, LY = 0.95, 1.35, 1.15                       # floor height, lower storey half-extents
    UX, UY, ZU, ZE = 1.7, 1.5, 2.5, 3.3                  # overhanging loft half-extents, its sill and eave
    bm = K.bm_new()
    for px in (-LX + 0.15, 0.0, LX - 0.15):
        for py in (-LY + 0.15, LY - 0.15):
            K.box_bm(bm, (px, py, 0.12), (0.42, 0.42, 0.3), rot_z=rq.uniform(-0.3, 0.3), taper=(0.8, 0.8))
    K.part(bm, 'granite', name='pads', jitter=0.1)
    bm = K.bm_new()
    for px in (-LX + 0.15, 0.0, LX - 0.15):
        for py in (-LY + 0.15, LY - 0.15):
            K.box_bm(bm, (px, py, 0.5), (0.2, 0.2, 0.62), taper=(0.75, 0.75))   # stolpe
    K.part(bm, 'log_hewn', name='stolper', uv='beam', axis=(0, 0, 1), mat_tint=(0.5, 0.42, 0.34))
    bm = K.bm_new()
    for px in (-LX + 0.15, 0.0, LX - 0.15):
        for py in (-LY + 0.15, LY - 0.15):
            K.box_bm(bm, (px, py, 0.84), (0.5, 0.46, 0.08), rot_z=rq.uniform(-0.2, 0.2))   # rat stones
    K.part(bm, 'fieldstone_grey', name='ratstones', jitter=0.1)
    door = K.opening(N.rect(-LX, -LY, LX, LY), 0, LX - 0.1, 0.8, 1.35, ZF + 0.05, 0.22, 'rect', 'door')
    N.log_walls(-LX, -LY, LX, LY, ZF, ZU - ZF, 0.22, 'timber_tarred', [door], ext=0.2)
    K.door(door, 'front', 'plank', (0.3, 0.24, 0.18), step=None)
    upoly = N.rect(-UX, -UY, UX, UY)
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, ZU - 0.07), (2 * UX + 0.1, 2 * UY + 0.1, 0.14))           # loft floor / sill frame
    K.part(bm, 'timber_creosote', name='loft_sill', uv='beam', axis=(1, 0, 0))
    lw = K.opening(upoly, 0, UX, 0.45, 0.35, ZU + 0.35, 0.08)
    N.board_walls(upoly, ZU, ZE - ZU, 0.08, [lw], cladding='redv', tint=None, name='loft')
    K.window(lw, 'fixed', (2, 1), frame=(0.85, 0.84, 0.8), recess=0.03, sill=None, curtain=0, streak=False, name='lw')
    for e in (1, 3):
        N.board_gable(upoly, e, ZE, ZE + UY * math.tan(math.radians(36)), 0.08, cladding='redv', name='g%d' % e)
    N.corner_boards(upoly, ZU, ZE, w=0.12, tint=(0.88, 0.86, 0.8), name='corners')
    R = K.roof_gable(0, 0, 2 * UX, 2 * UY, ZE, 36, 'roof_slate', eave_oh=0.35, gable_oh=0.3, thick=0.1, gutters=False)
    # the free stair (never touching the sill: rats) and its granite landing block
    bm = K.bm_new()
    K.box_bm(bm, (-0.1, -LY - 0.35, 0.43), (0.9, 0.5, 0.86))                       # landing block, a hand's gap off the sill
    for k in range(3):
        K.box_bm(bm, (0.62 + k * 0.3, -LY - 0.35, (0.66 - k * 0.22) / 2), (0.3, 0.5, 0.66 - k * 0.22))
    K.part(bm, 'granite', name='stair', jitter=0.08)
    K.footprint(N.rect(-2.0, -1.75, 2.0, 1.75), 'HIGH', 'hut')
    K.anchor('roof_ridge', (0, 0, R.z_ridge))

# ------------------------------------------------------------------------------------------------ lumber stack
if VAR == 'lumber':
    bm = K.bm_new()
    for bx in (-0.95, 0.0, 0.95):                       # bearers (old sleepers) across the stack
        K.box_bm(bm, (bx, 0, 0.07), (0.16, 1.5, 0.14), rot_z=rq.uniform(-0.04, 0.04))
    K.part(bm, 'timber_creosote', name='bearers', uv='beam', axis=(0, 1, 0))
    bm, bs = K.bm_new(), K.bm_new()
    z = 0.14
    for layer in range(5):
        n = 6 - (layer // 3)
        for k in range(n):
            y = -0.62 + k * (1.24 / (n - 1))
            L = 2.5 - rq.uniform(0, 0.25)
            K.box_bm(bm, (rq.uniform(-0.06, 0.06), y, z + 0.025), (L, 0.19, 0.05), rot_z=rq.uniform(-0.015, 0.015))
        z += 0.05
        if layer < 4:
            for bx in (-0.95, 0.0, 0.95):               # stickers between the layers
                K.box_bm(bs, (bx, 0, z + 0.012), (0.04, 1.35, 0.025))
            z += 0.025
    K.part(bm, 'boards_weathered', name='planks', uv='beam', axis=(1, 0, 0), mat_tint=(0.9, 0.82, 0.7))
    K.part(bs, 'timber_grey', name='stickers', lod='drop')
    ztop = z
    # tarpaulin draped over the W half, hanging down the sides, weighted with a plank
    bm = K.bm_new()
    xs, ys = [-1.3, -0.9, -0.5, -0.1, 0.25], [-0.95, -0.72, -0.4, 0.0, 0.4, 0.72, 0.95]
    def tz(x, y):
        ay = abs(y)
        top = ztop + 0.03 + 0.02 * math.sin(x * 5 + y * 3)
        if ay > 0.68:
            top -= (ay - 0.68) / 0.27 * (ztop - 0.1) * (0.6 + 0.4 * (x + 1.3) / 1.55)
        if x < -1.2:
            top -= (ztop - 0.2) * 0.8
        return top
    vs = [[bm.verts.new((x if abs(y) <= 0.68 else x, y, tz(x, y))) for y in ys] for x in xs]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.42, 0.44, 0.34), grime=0.6)
    bm = K.bm_new()
    K.box_bm(bm, (-0.55, 0.05, ztop + 0.07), (0.2, 1.6, 0.05), rot_z=0.15)
    for k in range(5):                                  # offcuts and a broken beam at the foot
        x, y = rq.uniform(-1.3, 1.3), rq.choice((-1, 1)) * rq.uniform(0.8, 0.95)
        a = rq.uniform(-0.5, 0.5)
        L = rq.uniform(0.4, 0.9)
        K.box_bm(bm, (x, y, 0.03), (L, 0.15, 0.05), rot_z=a)
    K.beam_bm(bm, (0.6, 0.86, 0.05), (1.4, 0.55, 0.22), 0.16, 0.16)
    K.part(bm, 'timber_beam', name='offcuts', uv='beam', axis=(1, 0, 0))
    K.footprint(N.rect(-1.5, -1.0, 1.5, 1.0), 'LOW', 'crates')

# ------------------------------------------------------------------------------------------------ low fieldstone rubble
if VAR == 'rubble':
    bm = K.bm_new()
    def stub(x0, x1, y, t, hlo, hhi, along_x=True):
        x = x0
        while x < x1 - 0.05:
            L = rq.uniform(0.28, 0.5)
            top = hlo + (hhi - hlo) * rq.random()
            z = 0.0
            while z < top:
                sh = rq.uniform(0.14, 0.22)
                c = (x + L / 2, y + rq.uniform(-0.04, 0.04)) if along_x else (y + rq.uniform(-0.04, 0.04), x + L / 2)
                sz = (L * 0.95, t * rq.uniform(0.85, 1.0), sh) if along_x else (t * rq.uniform(0.85, 1.0), L * 0.95, sh)
                K.box_bm(bm, (c[0], c[1], z + sh / 2), sz, rot_z=rq.uniform(-0.12, 0.12), taper=(0.9, 0.9))
                z += sh * 0.96
            x += L
    stub(-1.65, 1.2, 0.7, 0.5, 0.55, 0.95)            # the back wall, broken down to knee / hip height
    stub(-0.6, 0.65, -1.4, 0.45, 0.45, 0.75, along_x=False)   # the W return
    K.part(bm, 'fieldstone_grey', name='stubs', jitter=0.12)
    K.rubble((0.55, -0.2, 0), 1.0, 0.55, mids=('fieldstone_grey', 'fieldstone'), n=26, beams=1, tiles=None, seed=SEED, footprint=False)
    K.rubble((-0.7, -0.1, 0), 0.8, 0.45, mids=('fieldstone', 'fieldstone_grey'), n=16, beams=0, tiles=None, seed=SEED + 1, footprint=False,
             name='rubble2')
    K.P('timber_tarred', K.beam_bm, (-1.2, 0.55, 0.85), (1.1, -0.6, 0.12), 0.16, 0.18, name='joist')
    K.footprint(N.rect(-1.75, -1.0, 1.75, 1.0), 'LOW', 'rubble')
    N.char(0.35, seed=SEED)

# ------------------------------------------------------------------------------------------------ finish
if DEST:
    N.char(0.75, seed=SEED)
if SNOW and not DEST:                                 # the blown hut: the blast and the fire took the snow off
    import nfx2
    nfx2.PATCHY = 0.3 if VAR == 'relay' else 0.12     # the relay's tar paper and battens show through in patches
    # (no ground drifts under the stabbur: on its stilts the eave-drip mounds of nfx2.snow_drifts read as flat boxy
    #  slabs around the posts — M3 review; the snowy terrain itself carries the ground snow)
    N.snow(drifts=VAR != 'stabbur')
K.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48, recenter=False)
print('finalized', NAME)
