"""Cable-car stations for M5 (Herdla): at rotation 0 the line leaves the station to the SOUTH (-Y, toward the game
camera; rotate the prop to align the anchors with the line). Timber-framed station hall with board-and-batten walls
on three sides and an open rope portal at the south gable, steel rope gantry with sheaves outside the portal, gable
roof over the landing bay, timber landing platform with
railings, horizontal bull wheel (return wheel) at the south end with track-rope anchors, machine / operator room in
concrete. Variants:
  lower = valley station: tension station with counterweight in a pit, ticket/guard room, stairs to the platform
  upper = summit station: raised on a concrete substructure against the rock, drive motor house + gearbox,
          steel stair, no counterweight
Anchors: 'cable_track_w/e' + 'cable_haul_w/e' (rope exit points), 'cabin_stop' (where the cabin halts).
Usage: blender -b --python cable_station.py -- outdir lower|upper seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C

OUT, VAR, SEED, SNOW = N.args('cable_station')
name = 'cable_station_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
UP = VAR == 'upper'
ZP = 3.2 if UP else 1.2                        # platform level
L, W = 11.0, 7.0                               # hall along Y (line axis), across X
x0, x1, y0, y1 = -W / 2, W / 2, -L / 2, L / 2
ZE = ZP + 4.0
PITCH = 30
RY = ZP + 2.8                                  # rope height at the exit
# ---- substructure ---------------------------------------------------------------------------------------------
sub = N.rect(x0, y0, x1, y1)
CT = (0.62, 0.17, 0.12) if not UP else (0.64, 0.62, 0.57)
if UP:
    sdoor = K.opening(sub, 2, W / 2, 1.0, 2.0, 0.0, 0.5, 'rect', 'door')
    K.wall_ring(sub, ZP, 0.5, 'concrete_formwork', [sdoor], z0=-0.15, name='substructure')
    K.door(sdoor, 'machine', 'plank', (0.35, 0.38, 0.33), step='concrete_bunker')
    bm = K.bm_new()                            # rock plinth blending into the summit (north end)
    K.box_bm(bm, (0, y1 - 1.0, 0.5), (W + 2.4, 3.2, 1.2), taper=(0.8, 0.9))
    K.part(bm, 'granite', name='rock_bed', jitter=0.1)
else:
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, ZP / 2 - 0.1), (W, L, ZP + 0.2))
    K.part(bm, 'concrete_formwork', name='substructure')
    K.footprint(sub, 'HIGH')
    # open counterweight pit behind the station (north): concrete kerb ring, weight stack on guide rails, rope up
    import kit_arch as KA
    pc = V((0, y1 + 1.5, 0))
    bm = K.bm_new()
    KA.ring_bm(bm, N.rect(-1.4, y1 + 0.3, 1.4, y1 + 2.7), N.rect(-1.1, y1 + 0.6, 1.1, y1 + 2.4), -0.6, 0.35)
    K.part(bm, 'concrete_bunker', name='pit_rim')
    bm = K.bm_new()
    K.box_bm(bm, (0, y1 + 1.5, -0.6), (2.2, 1.8, 0.05))
    K.part(bm, 'mud', name='pit_floor', mat_tint=(0.35, 0.32, 0.3))
    bm = K.bm_new()
    for k in range(5):
        K.box_bm(bm, (0, y1 + 1.5, -0.3 + k * 0.28), (1.2, 1.0, 0.26))
    K.part(bm, 'cast_iron', name='counterweight', mat_tint=(0.5, 0.45, 0.4))
    bm = K.bm_new()
    for sx in (-0.75, 0.75):
        K.box_bm(bm, (sx, y1 + 1.5, 1.6), (0.12, 0.12, 4.0))
    K.box_bm(bm, (0, y1 + 1.5, 3.6), (1.7, 0.2, 0.2))
    K.part(bm, 'steel_painted', name='cw_guides', mat_tint=(0.5, 0.55, 0.5))
    bm = K.bm_new()
    K.cyl_bm(bm, (0, y1 + 1.5, 1.1), (0, y1 + 1.5, 3.5), 0.03, 6)
    K.cyl_bm(bm, (0, y1 + 1.5, 3.5), (0, y1 - 1.6, RY), 0.03, 6)
    K.part(bm, 'cast_iron', name='cw_ropes')
    K.footprint(N.rect(-1.4, y1 + 0.3, 1.4, y1 + 2.7), 'HIGH', 'counterweight')
# ---- platform deck (extends out of the portal as a landing apron) -----------------------------------------------
bm = K.bm_new()
n = int((L + 1.2) / 0.2)
for k in range(n):
    yy = y0 - 1.2 + (k + 0.5) * (L + 1.2) / n
    K.box_bm(bm, (r.uniform(-0.02, 0.02), yy, ZP + 0.03), (W - 0.1, 0.18, 0.06))
K.part(bm, 'deck_planks', name='deck', uv='beam', axis=(1, 0, 0), mat_tint=(0.85, 0.8, 0.74))
bm = K.bm_new()
for sx in (-1, 1):
    K.box_bm(bm, (sx * (W / 2 - 0.3), y0 - 0.6, ZP / 2), (0.25, 0.25, ZP))
K.part(bm, 'timber_beam', name='apron_posts')
K.roof_meta(N.rect(x0, y0 - 1.2, x1, y1), ZP, walkable=True, kind='platform')
for sx in (-1, 1):
    K.railing((sx * (W / 2 - 0.1), y0 - 1.1, ZP + 0.06), (sx * (W / 2 - 0.1), y0 + 1.5, ZP + 0.06), 1.0, 'pipe')
bm = K.bm_new()                                   # cabin bay: steel plate + yellow/black edge where the cabin halts
K.box_bm(bm, (0, y0 + 0.4, ZP + 0.09), (2.4, 3.0, 0.03))
K.part(bm, 'steel_grating', name='bay_plate', mat_tint=(0.7, 0.7, 0.68))
bm = K.bm_new()
for k in range(12):
    K.box_bm(bm, (-1.1 + k * 0.2, y0 - 1.05, ZP + 0.1), (0.1, 0.1, 0.02))
K.part(bm, 'wood_paint', name='bay_edge', mat_tint=(0.95, 0.75, 0.1))
K.anchor('cabin_stop', (0, y0 + 0.4, ZP + 0.1), (0, -1, 0))
# ---- station hall: board-and-batten walls, big rope portal in the south gable, side windows, staff door (east) ----
hall = N.rect(x0, y0, x1, y1)
ZH = ZE - ZP
portal = K.opening(hall, 0, W / 2, W - 0.7, ZH - 0.35, ZP, 0.12, 'rect', 'door')
sdoor2 = K.opening(hall, 3, L - 1.6, 1.0, 2.1, ZP, 0.12, 'rect', 'door') if UP else K.opening(hall, 1, 2.0, 1.0, 2.1, ZP, 0.12, 'rect', 'door')
wall_w = [K.opening(hall, 1, 8.0, 1.8, 1.1, ZP + 1.1, 0.12), K.opening(hall, 3, 2.5, 1.8, 1.1, ZP + 1.1, 0.12),
          K.opening(hall, 1, 4.8, 1.8, 1.1, ZP + 1.1, 0.12), K.opening(hall, 3, 5.5, 1.8, 1.1, ZP + 1.1, 0.12)]
if not UP:
    wall_w.append(K.opening(hall, 3, 8.6, 1.4, 1.1, ZP + 1.1, 0.12))
N.board_walls(hall, ZP, ZH, 0.12, [portal, sdoor2] + wall_w, 'batten', CT, footprint=False)
N.corner_boards(hall, ZP, ZE, w=0.2, proud=0.05, tint=(0.9, 0.9, 0.86) if not UP else (0.5, 0.48, 0.45))
N.band(hall, ZP - 0.05, 0.2, 0.05, tint=(0.35, 0.3, 0.26), name='sill_band')
K.door(sdoor2, 'station', 'plank', (0.35, 0.3, 0.26), step=None)
for k, f in enumerate(wall_w):
    K.window(f, 'fixed', (4, 2), frame='white', recess=0.02, sill='wood_paint', curtain=0, streak=k % 2 == 0,
             interior=False, name='w%d' % k)
R = K.roof_gable(0, 0, L, W, ZE, PITCH, 'roof_slate' if not UP else 'corrugated_galv', rot=math.pi / 2, eave_oh=0.45,
                 gable_oh=0.7, thick=0.1, fascia='wood_paint', barge='wood_paint', gutters=not UP, sag=0.02)
zr = R.z_ridge - R.lift
N.board_gable(hall, 0, ZE, zr, 0.12, [], 'batten', CT, name='gable_s')
N.board_gable(hall, 2, ZE, zr, 0.12, [], 'batten', CT, name='gable_n')
if UP:
    N.dress_roof(R, moss=0.1, guards=False, ridge=('steel_galv', (0.6, 0.6, 0.6)), rafters=True, rafter_mid='timber_beam', seed=SEED)
    N.rust_patches(R, seed=SEED)
else:
    N.dress_roof(R, moss=0.5, guards=True, ridge=('steel_galv', (0.42, 0.44, 0.46)), rafters=True, seed=SEED)
bm = K.bm_new()                                   # portal lintel beam + posts framing the rope opening
K.box_bm(bm, (0, y0 - 0.08, ZE - 0.2), (W + 0.1, 0.22, 0.34))
for sx in (-1, 1):
    K.box_bm(bm, (sx * (W / 2 - 0.2), y0 - 0.08, (ZP + ZE) / 2), (0.3, 0.24, ZE - ZP))
K.part(bm, 'timber_beam', name='portal_frame', uv='beam', axis=(1, 0, 0), mat_tint=(0.8, 0.76, 0.7))
# ---- return / drive bull wheel just inside the portal (seen through it), sheave gantry outside -------------------
BW = V((0, y0 + 3.4, ZP + 1.25))
N.spoked_wheel(BW, (0, 0, 1), 1.7, width=0.24, spokes=10, rim_tint=(0.46, 0.52, 0.46), name='bull_wheel')
bm = K.bm_new()
K.box_bm(bm, (0, BW.y, (ZP + BW.z) / 2 - 0.3), (0.9, 0.9, BW.z - ZP - 0.5))
K.box_bm(bm, (0, BW.y + 0.9, ZP + 0.35), (1.2, 2.6, 0.7))                       # tension carriage on rails
for sx in (-0.5, 0.5):
    K.box_bm(bm, (sx, BW.y + 1.2, ZP + 0.08), (0.1, 4.0, 0.1))
K.part(bm, 'steel_painted', name='wheel_frame', mat_tint=(0.5, 0.56, 0.5))
if UP:
    # drive house annex on the east side: concrete, flat roof, big motor + gearbox visible through a wide opening
    ax0, ax1, ay0, ay1 = x1, x1 + 3.2, y0 + 3.0, y0 + 7.0
    ap = N.rect(ax0, ay0, ax1, ay1)
    aw = K.opening(ap, 0, 1.6, 2.2, 2.0, ZP + 0.2, 0.3, 'rect', 'door')
    K.wall_ring(ap, ZP + 3.0, 0.3, 'concrete_formwork', [aw], z0=-0.15, name='drive_house')
    K.roof_flat(ap, ZP + 3.2, 'concrete_bunker', parapet_h=0.3, parapet_t=0.2, parapet_mid='concrete_formwork',
                coping='concrete_slab', walkable=True, spouts=False, name='drive_roof')
    N.flat_roof_dress(ap, ZP + 3.2, 0.2, seed=SEED, vents=[(ax0 + 1.0, ay1 - 1.0)], moss=0.2, name='drive_deck')
    bm = K.bm_new()
    K.box_bm(bm, (ax0 + 1.6, ay0 + 1.6, ZP + 0.7), (1.4, 1.0, 1.0))                 # gearbox
    K.cyl_bm(bm, (ax0 + 0.6, ay0 + 1.6, ZP + 0.8), (ax0 + 2.6, ay0 + 1.6, ZP + 0.8), 0.42, 14)   # motor
    K.cyl_bm(bm, (ax0 + 0.2, ay0 + 1.6, ZP + 0.8), (ax0 - 1.2, ay0 + 1.6, ZP + 0.8), 0.08, 8)     # shaft to the wheel
    K.part(bm, 'steel_painted', name='drive', mat_tint=(0.42, 0.52, 0.42))
    for k in range(3):
        K.decal('stain_blotch', (ax0 + 1.0 + k * 0.7, ay0 - 0.6, 0.02), (0, 0, 1), 1.1, 0.8, alpha=0.7)   # oil stains
    K.footprint(ap, 'HIGH', 'drive_house')
    K.anchor('motor', (ax0 + 1.6, ay0 + 1.6, ZP + 0.7))
    # steel stair up the west side to a landing at the staff door on the east... (east is the annex): use the west
    run = round(ZP / 0.18) * 0.27
    K.stairs((x0 - 0.8, y0 + 0.8 - run, 0), (0, 1, 0), 1.0, ZP, round(ZP / 0.18), 'steel_galv', solid=False, name='stair')
    bm = K.bm_new()
    K.box_bm(bm, (x0 - 0.75, y0 + 1.6, ZP - 0.05), (1.5, 1.6, 0.1))
    for yy in (y0 + 0.9, y0 + 2.3):
        K.box_bm(bm, (x0 - 1.4, yy, ZP / 2), (0.1, 0.1, ZP))
    K.part(bm, 'steel_galv', name='stair_landing')
    K.railing((x0 - 1.35, y0 + 0.8 - run, 0.9), (x0 - 1.35, y0 + 0.8, ZP + 0.9), 1.0, 'pipe')
    K.railing((x0 - 1.45, y0 + 0.8, ZP + 0.05), (x0 - 1.45, y0 + 2.4, ZP + 0.05), 1.0, 'pipe')
else:
    K.stairs((x1 + 0.9, y0 + 1.5 + ZP / 0.17 * 0.28, 0), (0, -1, 0), 1.4, ZP, round(ZP / 0.17), 'concrete_bunker', name='stair')
    # ticket / guard booth at the foot of the stair
    bm = K.bm_new()
    K.box_bm(bm, (x1 + 1.3, y0 + 5.5, 1.2), (1.6, 1.8, 2.4))
    K.part(bm, 'board_batten', name='booth', mat_tint=CT)
    K.roof_shed(x1 + 0.4, y0 + 4.5, x1 + 2.2, y0 + 6.5, 2.4, 2.7, 'roof_slate', thick=0.06, oh=0.12, low_side='+x', name='booth_roof', gutters=False)
    C.A.meta['roofs'].pop()
    K.footprint(N.rect(x1 + 0.5, y0 + 4.6, x1 + 2.1, y0 + 6.4), 'HIGH', 'booth')
gx = y0 - 2.4                                     # steel rope gantry with sheaves outside the portal
bm = K.bm_new()
for sx in (-1, 1):
    K.ibeam_bm(bm, (sx * 2.3, gx, 0 if not UP else 0), (sx * 2.3, gx, RY + 0.6), 0.3, 0.2, up=(1, 0, 0))
K.ibeam_bm(bm, (-2.5, gx, RY + 0.6), (2.5, gx, RY + 0.6), 0.3, 0.2)
K.part(bm, 'steel_painted', name='rope_gantry', uv='beam', axis=(0, 0, 1), mat_tint=(0.5, 0.56, 0.5))
bm = K.bm_new()
for sx in (-1.1, 1.1):                           # fork brackets + spoked rope sheaves
    for dx in (-0.1, 0.1):
        K.box_bm(bm, (sx + dx, gx, RY + 0.38), (0.03, 0.18, 0.5))
    K.cyl_bm(bm, (sx - 0.14, gx, RY + 0.2), (sx + 0.14, gx, RY + 0.2), 0.04, 8)
K.part(bm, 'cast_iron', name='portal_sheaves', smooth=True)
for sx in (-1.1, 1.1):
    N.spoked_wheel((sx, gx, RY + 0.2), (1, 0, 0), 0.34, width=0.12, spokes=6, segs=24, rim_tint=(0.46, 0.52, 0.46),
                   name='sheave%d' % (1 if sx > 0 else 0), inner_ring=False)
K.footprint(N.rect(-2.6, gx - 0.3, 2.6, gx + 0.3), 'FENCE', 'gantry')
ropes = K.bm_new()
for nm, sx, rr in (('cable_track_w', -1.1, 0.03), ('cable_track_e', 1.1, 0.03), ('cable_haul_w', -1.6, 0.018), ('cable_haul_e', 1.6, 0.018)):
    zz = RY + (0.25 if 'track' in nm else -0.3)
    a = V((sx if 'track' in nm else sx * 1.05, BW.y + (0 if 'haul' in nm else 1.8), BW.z if 'haul' in nm else zz))
    m_ = V((sx, gx, zz))
    b = V((sx, gx - 3.0, zz + (1.2 if not UP else -1.2)))
    K.cyl_bm(ropes, a, m_, rr, 6)
    K.cyl_bm(ropes, m_, b, rr, 6)
    K.anchor(nm, tuple(b), (0, -1, 0))
K.part(ropes, 'cast_iron', name='ropes', smooth=True, grime=0.1)
K.sign((W / 2 - 0.9, y0 - 0.2, ZE - 0.7), (0, -1, 0), 1.2, 'halt_sperrgebiet')
K.wall_lantern((0, y0, 0), (0, -1, 0), ZE - 0.55)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=1024, ao_samples=48, recenter=False)
