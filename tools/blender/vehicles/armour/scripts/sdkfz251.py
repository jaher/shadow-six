# sdkfz251.py - mittlerer Schützenpanzerwagen Sd.Kfz. 251/1 Ausf. C (1940-43): open-top armoured personnel
# half-track, front MG 34 behind a shield, rear AA mount, 10 troops on side benches, rear double doors.
# Dimensions: 5.80 x 2.10 x 1.75 m (hull top edge; ~2.15 m over the MG shield), front tyres 190-18,
# Schachtellaufwerk: 6 interleaved road-wheel stations per side, rubber-padded tracks 280 mm (Zpw 51/290/160).
# Run: blender -b --factory-startup --python-use-system-env --python sdkfz251.py -- [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node
import tankparts as T
from mathutils import Vector, Matrix

PREVIEW = 'preview' in sys.argv
V.begin('sdkfz251_c', seed=251)
Y = lambda s: s - 2.90
TOP = 1.74

# ------------------------------------------------------------------ crew compartment tub (walls + floor, open top)
# faceted armoured body: upper plates lean inward ~17 deg from the waist (z 1.0, widest), lower plates slope back in
WT, TT = 1.03, 0.80                               # waist / top-edge half widths
out = [(TT, TOP), (WT, 1.0), (0.66, 0.72), (0.64, 0.34), (-0.64, 0.34), (-0.66, 0.72), (-WT, 1.0), (-TT, TOP)]
inn = [(-TT + 0.015, TOP), (-WT + 0.018, 1.0), (-0.64, 0.74), (-0.62, 0.62), (0.62, 0.62), (0.64, 0.74), (WT - 0.018, 1.0), (TT - 0.015, TOP)]
UPN = Vector((0.74, 0, 0.23)).normalized()        # upper plate outward normal (left side)
wall_x = lambda z: WT - (z - 1.0) / (TOP - 1.0) * (WT - TT)
S0, S1 = 2.02, 5.66
tub = B.prism('tub', out + inn, S1 - S0, plane='XZ', offset=Y((S0 + S1) / 2))
P(tub, 'hull', ['paint', 'interior'])
# interior faces (normals pointing inward / up, inside the tub) painted ivory
for p in tub.data.polygons:
    c, n = p.center, p.normal
    inside = abs(c.x) < 1.0 and c.z > 0.6 and ((c.z < 0.63 and n.z > 0.5) or (abs(c.x) > 0.5 and n.x * c.x < 0))
    p.material_index = 1 if inside and abs(n.y) < 0.5 else 0
# rear wall (sloped outward at the bottom) with double doors
rear = [(TT, TOP), (WT, 1.0), (0.66, 0.72), (0.64, 0.40), (-0.64, 0.40), (-0.66, 0.72), (-WT, 1.0), (-TT, TOP)]
P(B.prism('rear_wall', rear, 0.015, plane='XZ', offset=Y(S1 + 0.01)), 'hull', 'paint')
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'door_rear_{S}'
    node(nm, (sx * 0.47, Y(S1 + 0.03), 1.05), 'hull', 'door', (0, 0, 1), open_deg=sx * 100)
    P(B.box(nm, (0.44, 0.02, 1.08), (sx * 0.245, Y(S1 + 0.03), 1.18)), nm, 'paint')
    P(B.box('door_grip', (0.03, 0.04, 0.14), (sx * 0.07, Y(S1 + 0.055), 1.25)), nm, 'steel', 0)
    P(B.box('door_inner', (0.42, 0.01, 1.04), (sx * 0.245, Y(S1 + 0.018), 1.18)), nm, 'interior', 1)
    for z in (0.8, 1.55):
        T.hinge((sx * 0.47, Y(S1 + 0.045), z - 0.08), (sx * 0.47, Y(S1 + 0.045), z + 0.08))
V.socket('exit_rear', (0, Y(S1 + 0.6), 0.0), 'hull', heading=0)
# lower hull under the engine + driver compartment (solid), belly plate
P(T.side_prism('lower_front', [(Y(0.25), 0.40), (Y(S0), 0.34), (Y(S0), 0.72), (Y(0.05), 0.72), (Y(0.0), 0.55)], -0.62, 0.62), 'hull', 'paint_dark')
# engine bonnet: loft from the narrow nose to the wide cowl (armoured hood, sloped sides)
nose = [(-0.44, 0.55), (0.44, 0.55), (0.47, 0.98), (0.30, 1.06), (-0.30, 1.06), (-0.47, 0.98)]
cowl = [(-0.66, 0.72), (0.66, 0.72), (1.02, 1.0), (0.72, 1.38), (-0.72, 1.38), (-1.02, 1.0)]
P(V.slab('bonnet', Y(0.02), Y(1.72), nose, cowl, bevel=0.008), 'hull', 'paint')
# armoured radiator louvres in the nose, bonnet hatches, air vents
P(B.box('nose_louvre', (0.62, 0.02, 0.3), (0, Y(0.01), 0.80)), 'hull', 'black', 1)
for i in range(5):
    P(B.box('louvre_bar', (0.64, 0.03, 0.02), (0, Y(0.0), 0.68 + i * 0.06), rot=('X', 30)), 'hull', 'paint', 0)
for sx in (-1, 1):
    P(B.box('air_vent', (0.36, 0.3, 0.06), (sx * 0.8, Y(1.55), 1.05)), 'hull', 'paint', 1)
P(B.box('bonnet_top_hatch', (0.62, 0.8, 0.02), (0, Y(1.1), 1.275), rot=('X', 10.7)), 'hull', 'paint', 1)
T.hinge((-0.3, Y(0.72), 1.215), (0.3, Y(0.72), 1.215))
# driver plate (windscreen area) with two visors; commander/driver sockets
P(V.slab('driver_plate', Y(1.72), Y(2.05), [(-1.02, 1.0), (1.02, 1.0), (0.72, 1.38), (-0.72, 1.38)],
         [(-WT, 1.0), (WT, 1.0), (TT, TOP), (-TT, TOP)], bevel=0.006), 'hull', 'paint')
for sx in (-1, 1):
    T.vision_port((sx * 0.42, Y(1.92), 1.60), (0, -0.6, 0.8), 0.36, 0.14)
    T.vision_port((sx * wall_x(1.40), Y(2.3), 1.40), (sx * UPN.x, 0, UPN.z), 0.2, 0.08)
P(B.box('dash', (1.7, 0.25, 0.3), (0, Y(2.12), 1.2)), 'hull', 'interior', 1)
P(B.cylinder('steering_wheel', 0.2, 0.03, (0.42, Y(2.35), 1.3), 'Y', 14), 'hull', 'black', 1)
V.socket('driver', (0.42, Y(2.55), 0.95), 'hull', pose='seated_drive')
V.socket('commander', (-0.42, Y(2.55), 0.95), 'hull', pose='seated')

# ------------------------------------------------------------------ front axle: steering + wheels
R_T, W_T, FS, FTR = 0.42, 0.19, 0.80, 0.80        # tyre radius/width, axle station, half track
tyre = V.set_mats(V.pneu_tyre('tyre', R_T, W_T, 0.26, segs=18), ['paint', 'tyre'])
tyreL = V.mirrored_mesh(tyre, 'tyre_L')
P(B.beam('front_axle', (-FTR + 0.1, Y(FS), R_T), (FTR - 0.1, Y(FS), R_T), 0.1, 0.1), 'hull', 'paint_dark', 1)
P(B.box('leaf_front', (0.08, 0.9, 0.08), (0, Y(FS), R_T + 0.1)), 'hull', 'paint_dark', 1)
for sx, S, mesh in ((1, 'L', tyreL), (-1, 'R', tyre)):
    st = node(f'steer_{S}', (sx * (FTR - 0.12), Y(FS), R_T), 'hull', 'steer', (0, 0, 1), steer_max_deg=32)
    P(B.cylinder('kingpin', 0.05, 0.2, (sx * (FTR - 0.12), Y(FS), R_T), 'Z', 8), st, 'paint_dark', 1)
    wn = node(f'wheel_F{S}', (sx * FTR, Y(FS), R_T), st, 'wheel', (1, 0, 0), radius=R_T)
    V.instance(mesh, wn, (sx * FTR, Y(FS), R_T), wn)
    V.contact(f'wheel_F{S}', (sx * FTR, Y(FS), 0.0), 'wheel', width=W_T)
    # front mudguard: swept arc over the wheel, flat run back to the track guard
    path = []
    for i in range(11):
        a = math.radians(165 - i * 125 / 10)
        path.append((Y(FS) + (R_T + 0.1) * math.cos(a), R_T + (R_T + 0.1) * math.sin(a)))
    y0, z0 = path[-1]
    path += [(y0 + 0.2, 0.912), (Y(2.0), 0.912)]
    mg = B.sweep_yz('mudguard', path, [(-0.23, -0.035), (-0.22, 0.0), (0.22, 0.0), (0.23, -0.035)], sx * 0.86)
    B.solidify(mg, 0.01)
    P(mg, 'hull', 'paint')
    V.headlight((sx * 0.72, Y(0.35), 1.12), r=0.08, cover=True)
V.notek((0.52, Y(0.05), 1.0))

# ------------------------------------------------------------------ tracks: Schachtellaufwerk (interleaved, overlapping)
# 6 stations per side at 0.46 m pitch with 560 mm wheels: outer row (odd stations) and inner row (even stations)
# overlap by ~0.1 m; a third, hidden row is implied. Rubber-padded Zpw 51/290/160 track.
XC, R_RW, THK = 0.80, 0.28, 0.045
def disc_wheel(name, r, w, segs=12):
    """Pressed-steel disc road wheel with solid rubber tyre (slot 1), raised hub cap; axis X, +X outer."""
    h = w / 2
    prof = [(0.0, h + 0.05), (0.05, h + 0.05), (0.07, h + 0.02), (0.13, h + 0.025), (0.17, h + 0.005), (r - 0.06, h),
            (r - 0.05, h + 0.01), (r, h - 0.015), (r, -h + 0.015), (r - 0.05, -h)]
    ob = V.lathe_mat(name, prof, segs, 'X', split_r=r - 0.055)
    B.auto_smooth(ob.data, 40)
    return ob
rw = V.set_mats(disc_wheel('rw', R_RW, 0.10), ['paint', 'rubber'])
spr = V.set_mats(V.sprocket2('spr', 0.27, 0.18, teeth=12, hub=0.09, holes=6, capz=0.05), ['paint', 'black'])
idl = V.set_mats(disc_wheel('idl', 0.26, 0.12), ['paint', 'rubber'])
meshes = {k: (o, V.mirrored_mesh(o, o.name + '_L')) for k, o in (('rw', rw), ('spr', spr), ('idl', idl))}
ST = [2.42, 2.88, 3.34, 3.80, 4.26, 4.72]
for sx, S in ((1, 'L'), (-1, 'R')):
    mi = 0 if sx > 0 else 1
    circ = []
    for i, s in enumerate(ST):
        x = sx * (XC + (0.065 if i % 2 == 0 else -0.055))
        nn = node(f'wheel_{S}{i + 1}', (x, Y(s), R_RW + THK), 'hull', 'wheel', (1, 0, 0), radius=R_RW)
        V.instance(meshes['rw'][mi], nn, (x, Y(s), R_RW + THK), nn)
        circ.append((Y(s), R_RW + THK, R_RW))
        P(B.beam('swing_arm', (sx * 0.66, Y(s), R_RW + THK), (sx * 0.62, Y(s - 0.26), R_RW + THK + 0.12), 0.06, 0.06), 'hull', 'paint_dark', 1)
        V.D(B.cylinder('tb_cap', 0.05, 0.03, (sx * 0.645, Y(s - 0.26), R_RW + THK + 0.12), 'X', 8), 'paint_dark')
    for nm, s, z, r, key in (('sprocket', 1.98, 0.52, 0.24, 'spr'), ('idler', 5.25, 0.54, 0.26, 'idl')):
        nn = node(f'{nm}_{S}', (sx * XC, Y(s), z), 'hull', 'wheel', (1, 0, 0), radius=r, drives_track=nm == 'sprocket')
        V.instance(meshes[key][mi], nn, (sx * XC, Y(s), z), nn)
        circ.append((Y(s), z, r))
    tn = node(f'track_{S}', (sx * XC, 0, 0), 'hull', 'track')
    belt, _, _ = V.track_belt(tn, sx * XC, circ, 0.28, THK, 4, 0.16, 0.03)
    P(belt, tn, 'track')
    V.contact(f'track_{S}_front', (sx * XC, Y(ST[0]), 0.0), 'track', track_w=0.28)
    V.contact(f'track_{S}_rear', (sx * XC, Y(ST[-1]), 0.0), 'track', track_w=0.28)
    V.emitter(f'dust_{S}', (sx * XC, Y(5.3), 0.1), 'hull', (0, 1, 0.4), 'dust')
    V.emitter(f'mud_{S}', (sx * XC, Y(1.98), 0.52), f'sprocket_{S}', (0, -0.3, 1), 'mud')
    P(B.cylinder('idler_crank', 0.07, 0.14, (sx * 0.68, Y(5.25), 0.54), 'X', 8), 'hull', 'paint_dark', 1)
    # continuous fender line: flat track guard from the front mudguard to the rear, with three stowage lockers
    # sitting on it under the hull waist (outer faces flush with the waist), hinged lids, hasps
    P(B.box('track_guard', (0.46, 3.62, 0.012), (sx * 0.86, Y(3.76), 0.905)), 'hull', 'paint')
    P(B.box('guard_lip', (0.012, 3.62, 0.05), (sx * 1.085, Y(3.76), 0.89)), 'hull', 'paint', 1)
    for k in range(5):
        P(B.box('guard_bracket', (0.30, 0.03, 0.08), (sx * 0.84, Y(2.2 + k * 0.8), 0.86)), 'hull', 'paint', 0)
    # rework2: stowage lockers made readable - 0.26 m tall steel bins on the guard, outer face 0.1 m proud of the
    # waist, lid sloping up to the upper plate, dark lid seam, top hinge line, two hasps + a padlock each
    for s0, s1 in ((2.12, 3.02), (3.10, 4.30), (4.38, 5.46)):
        xo, xi, z0, z1, z2 = sx * 1.085, sx * 0.93, 0.918, 1.13, 1.19
        lk = V.hexa('locker', [(xi, Y(s0), z0), (xo, Y(s0), z0), (xo, Y(s1), z0), (xi, Y(s1), z0),
                               (xi, Y(s0), z2), (xo, Y(s0), z1), (xo, Y(s1), z1), (xi, Y(s1), z2)], bevel=0.008)
        P(lk, 'hull', 'paint')
        P(B.box('locker_seam', (0.006, s1 - s0 - 0.04, 0.012), (sx * 1.088, Y((s0 + s1) / 2), z1 - 0.035)), 'hull', 'black', 1)
        V.plate_edge((sx * 1.09, Y(s0 + 0.02), z1 - 0.012), (sx * 1.09, Y(s1 - 0.02), z1 - 0.012), (sx, 0, 0), 0.025)
        for f in (0.25, 0.75):
            yy = Y(s0 + (s1 - s0) * f)
            P(B.box('locker_hasp', (0.022, 0.05, 0.075), (sx * 1.096, yy, z1 - 0.05)), 'hull', 'steel', 1)
            V.D(B.cylinder('hasp_pin', 0.009, 0.03, (sx * 1.105, yy, z1 - 0.065), 'X', 6), 'steel')
        T.hinge((sx * 0.95, Y(s0 + 0.08), z2 - 0.005), (sx * 0.95, Y(s1 - 0.08), z2 - 0.005))
        V.bolt_row((sx * 1.09, Y(s0 + 0.04), z0 + 0.03), (sx * 1.09, Y(s1 - 0.04), z0 + 0.03), (sx, 0, 0), 0.15)
    V.weld((sx * WT, Y(1.8), 1.0), (sx * WT, Y(5.6), 1.0))
    V.weld((sx * TT, Y(2.05), TOP), (sx * TT, Y(5.6), TOP))
    V.bolt_row((sx * wall_x(1.66), Y(2.2), 1.66), (sx * wall_x(1.66), Y(5.5), 1.66), (sx * UPN.x, 0, UPN.z), 0.3)

# ------------------------------------------------------------------ interior: benches, backrests, racks, kit
for sx in (-1, 1):
    P(B.box('bench', (0.34, 2.9, 0.05), (sx * 0.72, Y(4.05), 0.98)), 'hull', 'wood', 1)
    P(B.box('bench_box', (0.30, 2.9, 0.33), (sx * 0.74, Y(4.05), 0.785)), 'hull', 'interior', 1)
    P(B.box('backrest', (0.05, 2.9, 0.22), (sx * (wall_x(1.3) - 0.05), Y(4.05), 1.3), rot=('Y', -sx * 17)), 'hull', 'canvas', 1)
    for i in range(4):
        P(B.beam('rifle', (sx * 0.88, Y(2.6 + i * 0.12), 1.05), (sx * 0.72, Y(2.62 + i * 0.12), 1.62), 0.03, 0.05), 'hull', 'wood', 0)
    for i in range(5):
        V.socket(f'troop_{"L" if sx > 0 else "R"}{i + 1}', (sx * 0.72, Y(2.9 + i * 0.55), 1.0), 'hull',
                 heading=math.pi if sx > 0 else 0.0, pose='bench_seated')
P(B.box('floor_plate', (1.1, 3.4, 0.01), (0, Y(3.85), 0.625)), 'hull', 'steel', 1)
for i, s in enumerate((3.0, 3.4, 4.6)):
    P(B.box('ammo_box', (0.28, 0.16, 0.18), (0.05 * (i - 1), Y(s), 0.72), rot=('Z', 15 * i)), 'hull', 'paint', 1)
P(B.box('radio', (0.36, 0.3, 0.26), (-0.60, Y(2.35), 1.28)), 'hull', 'paint_dark', 1)
V.jerrycan((0.0, Y(5.3), 0.63), rz=math.pi / 2)
V.antenna((-0.74, Y(2.3), TOP), 2.0)

# ------------------------------------------------------------------ front MG 34 behind the shield (traverse+elevation)
node('mg_front', (0.0, Y(2.12), TOP + 0.02), 'hull', 'weapon_traverse', (0, 0, 1), traverse_deg=(-30, 30))
P(B.box('mg_mount', (0.1, 0.1, 0.12), (0.0, Y(2.12), TOP + 0.06)), 'mg_front', 'paint', 1)
shield = [(-0.36, 0.0), (0.36, 0.0), (0.36, 0.38), (0.26, 0.48), (-0.26, 0.48), (-0.36, 0.38)]
P(B.prism('mg_shield', [(x, TOP - 0.04 + z) for x, z in shield], 0.012, plane='XZ', offset=Y(2.02), bevel=0.003), 'mg_front', 'paint')
for sx in (-1, 1):                  # folded side wings
    P(T.plate_on('shield_wing', (sx * 0.43, Y(2.07), TOP + 0.15), (sx * 0.6, 0.8, 0), (0, 0, 1), 0.17, 0.36, 0.012), 'mg_front', 'paint')
P(B.box('shield_slot', (0.16, 0.02, 0.08), (0.0, Y(2.015), TOP + 0.16)), 'mg_front', 'black', 1)
V.bolt_row((-0.3, Y(2.0), TOP + 0.02), (0.3, Y(2.0), TOP + 0.02), (0, -1, 0), 0.1)
node('mg_front_gun', (0.0, Y(2.12), TOP + 0.16), 'mg_front', 'weapon_elev', (1, 0, 0), elev=(-10, 40))
mz = V.mg('mg34', (0.0, Y(2.35), TOP + 0.16), 'mg_front_gun', full=True)
V.muzzle('mg_front', mz, 'mg_front_gun', (0, -1, 0), 'mg34')
V.socket('mg_gunner', (0.0, Y(2.6), 0.62), 'hull', heading=0.0, pose='standing_mg')
# rear AA mount (pintle) with MG 34
node('mg_rear', (-0.6, Y(5.2), TOP + 0.05), 'hull', 'weapon_traverse', (0, 0, 1), traverse_deg=(-180, 180))
P(B.cylinder('pintle', 0.025, 0.3, (-0.6, Y(5.2), TOP - 0.1), 'Z', 8), 'mg_rear', 'steel', 1)
mz2 = V.mg('mg34', (-0.6, Y(5.2) + 0.2, TOP + 0.12), 'mg_rear', rx=-0.45, full=True, lod=1, bipod=False)   # AA pose, forward-up
V.muzzle('mg_rear', mz2, 'mg_rear', (0, -math.cos(0.45), math.sin(0.45)), 'mg34')
# exhaust (left, behind the front wheel), convoy tail light, tow hook, spare wheel? (not on Ausf. C)
P(B.cylinder('muffler', 0.08, 0.6, (0.66, Y(1.55), 0.55), 'Y', 10), 'hull', 'steel', 1)
P(B.cylinder('exhaust', 0.035, 0.25, (0.72, Y(1.9), 0.52), 'X', 8), 'hull', 'steel', 1)
V.emitter('exhaust', (0.85, Y(1.9), 0.52), 'hull', (1, 0.3, 0.1), 'exhaust')
P(B.box('tail_light', (0.09, 0.05, 0.07), (0.8, Y(S1 + 0.03), 1.0)), 'hull', 'red', 1)
T.tow_shackle((0.0, Y(S1 + 0.08), 0.5), rz=math.pi / 2)
T.tow_shackle((0.3, Y(0.0), 0.6), rz=math.pi / 2); T.tow_shackle((-0.3, Y(0.0), 0.6), rz=math.pi / 2)
V.tool('shovel', (wall_x(1.25) + 0.03, Y(2.3), 1.25), (wall_x(1.25) + 0.03, Y(3.4), 1.25), up=tuple(UPN))
V.tool('axe', (-wall_x(1.25) - 0.03, Y(2.5), 1.25), (-wall_x(1.25) - 0.03, Y(3.2), 1.25), up=(-UPN.x, 0, UPN.z))
# markings: Balkenkreuz on the upper sides, tactical number on the rear quarter
for sx in (-1, 1):
    V.decal('bk', (sx * wall_x(1.40), Y(4.4), 1.40), (sx * UPN.x, 0, UPN.z), (-sx * UPN.z, 0, UPN.x), 0.36, 0.36)
    V.decal('num:10:w', (sx * wall_x(1.40), Y(5.25), 1.40), (sx * UPN.x, 0, UPN.z), (-sx * UPN.z, 0, UPN.x), 0.3, 0.2)
V.decal('bk', (0.55, Y(S1 + 0.045), 1.5), (0, 1, 0), (0, 0, 1), 0.2, 0.2)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.0), dist=11, elev=40, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(length=5.80, width=2.10, height=1.75, height_mg_shield=2.12, track_width=0.28, weight_t=9.0),
           burnt_pose={'door_rear_L': dict(rot=(0, 0, 95)), 'steer_L': dict(rot=(0, 0, 18)), 'steer_R': dict(rot=(0, 0, 18)),
                       'mg_front': dict(rot=(0, 0, 25)), 'mg_front_gun': dict(rot=(-12, 0, 0)), 'hull': dict(off=(0, 0, -0.06))},
           burnt_drop=('shovel', 'pick', 'blade', 'head', 'antenna', 'ant_', 'lens', 'bo_cover', 'jerrycan', 'jc_', 'rifle',
                       'backrest', 'bench', 'radio', 'mg_rear', 'mg_front_gun', 'pintle'),
           track_style='zpw',
           info=dict(model='Sd.Kfz. 251/1 Ausf. C', crew='2 + 10', mg='MG 34 front shield + MG 34 rear AA', era='1940-43',
                     sources='vehicles/refs/armour/urls.json'))
