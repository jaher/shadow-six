# morser18.py - 21 cm Moerser 18 heavy howitzer in firing position: firing platform (Bettung) lowered, wheels
# raised clear of the ground, box trail on its rear support roller with spades.
# Double-recoil carriage: the barrel recoils in the cradle (recuperator above, recoil brake below), and the whole upper
# carriage (Oberlafette) recoils on slide rails on the lower carriage, braked by two carriage-recoil cylinders.
# Massive L/31 tube (6.51 m, 0.58 m over the breech jacket), horizontal sliding breech + loading tray and rammer,
# two tall equilibrators, toothed elevation quadrant, layers' handwheels and platforms, disc wheels with solid tyres.
# Firing position approx. 11.0 x 2.8 x 3.1 m (barrel level), elevation 0..70 deg, traverse 16 deg on the carriage /
# 360 deg on the platform. Run: blender ... --python morser18.py -- [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector
import bmesh

PREVIEW = 'preview' in sys.argv
V.begin('morser18_21cm', seed=21)

def handwheel(c, r=0.2, node_='mount'):
    rim = B.lathe('hw_rim', [(r - 0.02, 0.014), (r, 0.014), (r, -0.014), (r - 0.02, -0.014)], segs=14, axis='X')
    P(V._xf(rim, c), node_, 'steel', 1)
    for k in range(4):
        a = k * math.pi / 2
        P(B.beam('hw_spoke', Vector(c), Vector(c) + Vector((0, math.cos(a), math.sin(a))) * (r - 0.01), 0.02, 0.014, up=(1, 0, 0)), node_, 'steel', 0)

# ------------------------------------------------------------------ firing platform (Bettung) + box trail (static)
P(B.cylinder('platform', 1.10, 0.14, (0, 0.2, 0.07), 'Z', 32, bevel=0.01), 'hull', 'paint_dark', uv=0.5)
for i in range(12):
    a = i * math.pi / 6
    P(B.box('platform_rib', (0.07, 0.95, 0.10), (0.52 * math.sin(a), 0.2 + 0.52 * math.cos(a), 0.18), rot=('Z', -math.degrees(a))), 'hull', 'paint_dark', 1)
    D(B.cylinder('platform_bolt', 0.03, 0.03, (1.0 * math.sin(a + 0.26), 0.2 + 1.0 * math.cos(a + 0.26), 0.145), 'Z', 6), 'steel')
P(B.cylinder('platform_pivot', 0.48, 0.30, (0, 0.2, 0.28), 'Z', 24, bevel=0.01), 'hull', 'paint')
V.contact('platform', (0, 0.2, 0.0), 'platform', radius=1.10)
for sx in (-1, 1):                    # box trail: two tapering girders converging to the rear support
    tr = V.hexa('trail', [(sx * 0.40, 0.35, 0.40), (sx * 0.72, 0.35, 0.40), (sx * 0.34, 5.6, 0.20), (sx * 0.14, 5.6, 0.20),
                          (sx * 0.40, 0.35, 0.86), (sx * 0.72, 0.35, 0.86), (sx * 0.34, 5.6, 0.46), (sx * 0.14, 5.6, 0.46)], bevel=0.012)
    P(tr, 'hull', 'paint')
    V.weld((sx * 0.72, 0.4, 0.86), (sx * 0.34, 5.5, 0.46)); V.weld((sx * 0.72, 0.4, 0.40), (sx * 0.34, 5.5, 0.20))
    V.bolt_row((sx * 0.70, 0.6, 0.80), (sx * 0.34, 5.3, 0.42), (sx, 0.07, 0), 0.25)
    P(B.beam('handspike', (sx * 0.3, 5.5, 0.52), (sx * 0.85, 6.15, 0.95), 0.05, 0.05), 'hull', 'steel', 1)
for y in (1.6, 3.0, 4.4):
    w = 0.56 - (y - 0.35) / 5.25 * 0.32
    P(B.box('trail_cross', (2 * w, 0.14, 0.24), (0, y, 0.62 - (y - 0.35) * 0.05)), 'hull', 'paint', 1)
P(B.box('trail_deck', (0.62, 1.8, 0.02), (0, 2.3, 0.80)), 'hull', 'steel', 1)
# rear support: roller carriage + two spades driven into the ground
P(B.box('rear_support', (0.95, 0.55, 0.14), (0, 5.8, 0.14), bevel=0.02, segs=1), 'hull', 'paint_dark')
P(B.cylinder('support_roller', 0.17, 0.75, (0, 5.8, 0.17), 'X', 14), 'hull', 'steel')
for sx in (-1, 1):
    P(B.box('spade', (0.40, 0.05, 0.50), (sx * 0.24, 6.12, 0.12), rot=('X', -28)), 'hull', 'paint_dark')
    P(B.beam('spade_brace', (sx * 0.24, 5.95, 0.40), (sx * 0.24, 6.20, 0.25), 0.05, 0.05), 'hull', 'paint_dark', 1)
V.contact('rear_support', (0, 5.8, 0.0), 'foot')
# lower carriage (Unterlafette) on the platform pivot: saddle, slide rails for the recoiling upper carriage,
# carriage-recoil cylinders, axle with the raised wheels (disc wheels, 6 holes, solid rubber) under big mudguards
P(B.box('lower_carriage', (1.36, 1.5, 0.55), (0, 0.35, 0.75), bevel=0.03, segs=1), 'hull', 'paint')
for sx in (-1, 1):
    P(B.box('slide_rail', (0.14, 3.0, 0.10), (sx * 0.36, 0.30, 1.08), bevel=0.01, segs=1), 'hull', 'steel')
    V.bolt_row((sx * 0.36, -1.1, 1.13), (sx * 0.36, 1.7, 1.13), (0, 0, 1), 0.25)
    P(B.cylinder('carriage_recoil', 0.09, 1.9, (sx * 0.14, 0.55, 0.98), 'Y', 14), 'hull', 'paint')
    P(B.cylinder('carriage_recoil_cap', 0.1, 0.06, (sx * 0.14, 1.52, 0.98), 'Y', 14), 'hull', 'paint', 1)
    P(B.box('rail_stop', (0.18, 0.12, 0.16), (sx * 0.36, 1.82, 1.1)), 'hull', 'paint', 1)
P(B.cylinder('axle', 0.10, 2.3, (0, 0.6, 0.95), 'X', 12), 'hull', 'paint_dark', 1)
def disc_wheel(name, r, w, segs=28):
    h = w / 2
    prof = [(0.0, h + 0.06), (0.09, h + 0.06), (0.12, h + 0.02), (0.2, h + 0.01), (r - 0.13, h - 0.02), (r - 0.11, h + 0.01),
            (r - 0.1, h + 0.015), (r - 0.02, h), (r, h - 0.03), (r, -h + 0.03), (r - 0.02, -h), (r - 0.1, -h - 0.015)]
    ob = V.lathe_mat(name, prof, segs, 'X', split_r=r - 0.105)
    B.auto_smooth(ob.data, 35)
    parts = [V.set_mats(ob, ['paint', 'tyre'])]
    for k in range(6):
        a = k * math.pi / 3
        rr = (0.2 + r - 0.13) / 2
        o = B.cylinder('hole', 0.085, 0.02, (h + 0.0, rr * math.cos(a), rr * math.sin(a)), 'X', 10)
        parts.append(V.set_mats(o, ['black']))
    return B.join(parts, name)
whl = V.set_mats(disc_wheel('wheel', 0.68, 0.30), ['paint', 'tyre', 'black'])
whlL = V.mirrored_mesh(whl, 'wheel_Lm')
for sx, S, mesh in ((1, 'L', whlL), (-1, 'R', whl)):
    wn = node(f'wheel_{S}', (sx * 1.14, 0.6, 0.95), 'hull', 'wheel', (1, 0, 0), radius=0.68, raised=True)
    V.instance(mesh, wn, (sx * 1.14, 0.6, 0.95), wn)
    path = [(0.6 + 0.80 * math.cos(math.radians(a)), 0.95 + 0.80 * math.sin(math.radians(a))) for a in range(172, 4, -12)]
    mg = B.sweep_yz('mudguard', path, [(-0.21, -0.035), (-0.2, 0), (0.2, 0), (0.21, -0.035)], sx * 1.14)
    B.solidify(mg, 0.012); P(mg, 'hull', 'paint')
    for a in (40, 140):
        c = Vector((sx * 0.9, 0.6 + 0.8 * math.cos(math.radians(a)), 0.95 + 0.8 * math.sin(math.radians(a))))
        P(B.beam('guard_bracket', c, Vector((sx * 0.62, 0.6 + 0.4 * math.cos(math.radians(a)), 1.0)), 0.07, 0.07), 'hull', 'paint', 1)
    P(B.cylinder('hub_cap', 0.12, 0.1, (sx * 1.34, 0.6, 0.95), 'X', 12), 'hull', 'paint_dark', 1)

# ------------------------------------------------------------------ upper carriage (traverses and recoils on the rails)
TY, TZ = 0.95, 2.15
node('mount', (0, 0.4, 1.13), 'hull', 'turret', (0, 0, 1), traverse_deg=(-8, 8), note='360 deg via platform + trail',
     recoil_m=0.75, recoil_axis_game=[0, 0, -1])
P(B.box('upper_sled', (0.95, 2.6, 0.14), (0, 0.35, 1.2), bevel=0.02, segs=1), 'mount', 'paint')
for sx in (-1, 1):
    side = [(1.75, 1.2), (-1.05, 1.2), (-0.75, 1.75), (0.35, TZ + 0.22), (1.35, TZ + 0.22), (1.75, 1.75)]
    P(B.prism('side_wall', side, 0.06, plane='YZ', offset=sx * 0.50, bevel=0.008), 'mount', 'paint')
    for a, b in zip(side[1:], side[2:5]):
        P(B.beam('wall_flange', (sx * 0.535, a[0], a[1]), (sx * 0.535, b[0], b[1]), 0.07, 0.025, up=(1, 0, 0)), 'mount', 'paint', 1)
    P(B.cylinder('lightening_hole', 0.14, 0.07, (sx * 0.50, 1.0, 1.55), 'X', 12), 'mount', 'black', 1)
    P(B.cylinder('trunnion_bearing', 0.18, 0.12, (sx * 0.55, TY, TZ), 'X', 16), 'mount', 'paint', 1)
    V.bolt_row((sx * 0.61, TY - 0.12, TZ + 0.1), (sx * 0.61, TY + 0.12, TZ - 0.1), (sx, 0, 0), 0.08)
    # equilibrators: tall slanted spring cylinders ahead of the trunnions
    lo, hi = Vector((sx * 0.42, -0.85, 1.3)), Vector((sx * 0.42, -0.35, TZ + 0.55))
    eq = B.cylinder('equilibrator', 0.12, (hi - lo).length, (0, 0, 0), 'Z', 16, bevel=0.01); B.apply_all(eq)
    P(V._xf(eq, tuple((lo + hi) / 2), rx=-math.atan2(hi.y - lo.y, hi.z - lo.z)), 'mount', 'paint')
    for f in (0.15, 0.85):
        D(B.cylinder('eq_band', 0.125, 0.03, tuple(lo.lerp(hi, f)), 'Z', 16), 'paint')
    P(B.cylinder('eq_cap', 0.09, 0.08, tuple(hi + Vector((0, 0, 0.04))), 'Z', 12), 'mount', 'paint', 1)
    handwheel((sx * 0.62, 0.05, 1.62))
    P(B.box('layer_platform', (0.5, 0.8, 0.04), (sx * 0.85, 0.5, 1.12)), 'mount', 'steel', 1)
    V.socket(f'layer_{"L" if sx > 0 else "R"}', (sx * 0.85, 0.5, 1.14), 'mount', heading=0.0, pose='standing_gun')
V.socket('loader', (0.0, 3.3, 0.0), 'mount', heading=0.0, pose='standing_load')
P(B.box('sight', (0.14, 0.34, 0.22), (0.66, TY - 0.1, TZ + 0.35)), 'mount', 'gunmetal', 1)
P(B.cylinder('sight_tube', 0.05, 0.45, (0.66, TY - 0.2, TZ + 0.5), 'Y', 10), 'mount', 'gunmetal', 1)
V.decal('num:2:w', (0.535, 0.1, 1.55), (1, 0, 0), (0, 0, 1), 0.24, 0.24, 'mount')

# ------------------------------------------------------------------ gun (elevation node at the trunnions)
node('gun', (0, TY, TZ), 'mount', 'gun', (1, 0, 0), elev_min=0, elev_max=70, barrel_recoil_m=1.25)
MZ = TY - 5.30                       # muzzle station; 6.51 m tube from the breech face at TY + 1.21
P(B.cylinder('cradle', 0.34, 3.3, (0, TY - 0.45, TZ), 'Y', 20, bevel=0.012), 'gun', 'paint')
P(B.box('cradle_keel', (0.30, 3.0, 0.20), (0, TY - 0.4, TZ - 0.32), bevel=0.015, segs=1), 'gun', 'paint', 1)
for sx in (-1, 1):
    P(B.cylinder('trunnion', 0.11, 0.16, (sx * 0.40, TY, TZ), 'X', 12), 'gun', 'steel', 1)
    V.bolt_row((sx * 0.33, TY - 1.9, TZ + 0.1), (sx * 0.33, TY + 1.0, TZ + 0.1), (sx, 0, 0.3), 0.3)
# two recuperators above, recoil brake below, with forward clamps and end caps
for sx in (-1, 1):
    P(B.cylinder('recuperator', 0.12, 3.0, (sx * 0.2, TY - 0.55, TZ + 0.42), 'Y', 16), 'gun', 'paint')
    P(B.cylinder('recup_cap', 0.13, 0.08, (sx * 0.2, TY + 0.98, TZ + 0.42), 'Y', 16), 'gun', 'paint', 1)
    P(B.cylinder('recup_front', 0.125, 0.1, (sx * 0.2, TY - 2.08, TZ + 0.42), 'Y', 16), 'gun', 'paint', 1)
P(B.cylinder('recoil_brake', 0.11, 2.7, (0, TY - 0.45, TZ - 0.47), 'Y', 16), 'gun', 'paint')
P(B.cylinder('brake_cap', 0.12, 0.08, (0, TY + 0.93, TZ - 0.47), 'Y', 16), 'gun', 'paint', 1)
for yy in (TY - 1.9, TY - 0.5):
    P(B.box('cyl_clamp', (0.66, 0.1, 1.1), (0, yy, TZ - 0.02), bevel=0.02, segs=1), 'gun', 'paint', 1)
# massive L/31 tube: breech jacket (0.58 m), reinforce hoops, tapered chase, muzzle swell
P(B.cylinder('barrel_jacket', 0.29, 2.3, (0, TY + 0.06, TZ), 'Y', 28, bevel=0.015), 'gun', 'paint')
for yy in (TY - 1.1, TY + 1.15):
    D(B.cylinder('jacket_hoop', 0.295, 0.08, (0, yy, TZ), 'Y', 28), 'paint')
P(B.cylinder('barrel_chase', 0.24, 0.5, (0, TY - 1.34, TZ), 'Y', 28, r2=0.22), 'gun', 'paint')
P(B.cylinder('barrel', 0.215, (TY - 1.59) - (MZ + 0.25), (0, ((TY - 1.59) + (MZ + 0.25)) / 2, TZ), 'Y', 26, r2=0.16), 'gun', 'paint')
P(B.cylinder('muzzle_swell', 0.175, 0.25, (0, MZ + 0.125, TZ), 'Y', 24, r2=0.18, bevel=0.012), 'gun', 'paint')
P(B.cylinder('bore', 0.1055, 0.01, (0, MZ - 0.004, TZ), 'Y', 16), 'gun', 'black', 1)
# breech: ring, horizontal sliding block + handle, loading tray with rammer, breech operating lever
P(B.box('breech_ring', (0.76, 0.55, 0.76), (0, TY + 1.45, TZ), bevel=0.05, segs=2), 'gun', 'gunmetal')
P(B.box('breech_block', (0.86, 0.18, 0.34), (0.06, TY + 1.72, TZ)), 'gun', 'gunmetal', 1)
P(B.beam('breech_handle', (0.45, TY + 1.75, TZ + 0.05), (0.62, TY + 1.95, TZ + 0.22), 0.04, 0.04), 'gun', 'steel', 0)
P(B.box('loading_tray', (0.34, 1.1, 0.04), (0, TY + 2.4, TZ - 0.2)), 'gun', 'steel', 1)
for sx in (-1, 1):
    P(B.box('tray_side', (0.02, 1.1, 0.12), (sx * 0.17, TY + 2.4, TZ - 0.15)), 'gun', 'steel', 1)
    P(B.beam('tray_arm', (sx * 0.3, TY + 1.7, TZ - 0.3), (sx * 0.17, TY + 2.0, TZ - 0.2), 0.05, 0.05), 'gun', 'paint', 1)
# toothed elevation quadrant under the cradle (right side), meshing with the elevation gear on the carriage
arc = [(0.0, 0.0)] + [(0.95 * math.sin(math.radians(a)), -0.95 * math.cos(math.radians(a))) for a in range(-50, 51, 10)]
P(B.prism('elev_arc', [(TY + y, TZ + z) for y, z in arc], 0.06, plane='YZ', offset=-0.30), 'gun', 'paint', 1)
for a in range(-50, 51, 5):
    D(B.box('arc_tooth', (0.07, 0.03, 0.04), (-0.30, TY + 0.96 * math.sin(math.radians(a)), TZ - 0.96 * math.cos(math.radians(a)))), 'steel')
V.muzzle('main_gun', (0, MZ - 0.01, TZ), 'gun', (0, -1, 0), '211mm_morser18', caliber=0.211)
V.emitter('muzzle_blast_dust', (0, MZ + 0.8, 0.05), 'mount', (0, -1, 0.2), 'blast_dust')
V.emitter('breech_smoke', (0, TY + 1.8, TZ), 'gun', (0, 1, 0.3), 'smoke')
# ready ammunition: 21 cm shells (121 kg) on a wooden rack + cartridge cases, shell tongs
P(B.box('shell_rack', (1.2, 0.9, 0.08), (1.9, 3.1, 0.12)), 'hull', 'wood', 1)
for k in (-0.4, 0.4):
    P(B.box('rack_leg', (1.2, 0.08, 0.12), (1.9, 3.1 + k, 0.06)), 'hull', 'wood', 1)
for i in range(4):
    sh = B.lathe('shell', [(0.0, 0.0), (0.105, 0.0), (0.108, -0.06), (0.105, -0.55), (0.08, -0.78), (0.035, -0.9), (0.0, -0.93)], segs=12, axis='Y')
    P(V._xf(sh, (1.45 + i * 0.25, 3.55, 0.27)), 'hull', 'paint_dark', 1)
    D(B.cylinder('driving_band', 0.11, 0.035, (1.45 + i * 0.25, 3.49, 0.27), 'Y', 12), 'brass')
for i in range(3):
    P(B.cylinder('cartridge', 0.12, 0.55, (1.5 + i * 0.27, 4.4, 0.12), 'Y', 12), 'hull', 'brass', 1)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.0), dist=16, elev=30, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(barrel_length=6.51, firing_length=11.0, width=2.8, height=3.1, weight_t=16.7, caliber_mm=211),
           burnt_pose={'mount': dict(rot=(0, 0, -7)), 'gun': dict(rot=(-2, 6, 0)), 'hull': dict(rot=(0, 3, 0))},
           burnt_drop=('shell', 'cartridge', 'sight', 'hw_', 'loading_tray', 'tray_', 'handspike', 'breech_handle'),
           info=dict(model='21 cm Moerser 18', crew=17, role='heavy howitzer emplacement (M7/M8 targets)',
                     recoil='double: barrel in cradle (gun.barrel_recoil_m) + upper carriage on the rails (mount.recoil_m)',
                     sources='vehicles/refs/armour/urls.json'))
