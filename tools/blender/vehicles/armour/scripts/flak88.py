# flak88.py - 8.8 cm Flak 18/36 emplaced on its cruciform platform (Kreuzlafette 36, Sonderanhaenger removed), with
# the field shield (Schutzschild: main plate with barrel slot, folding upper section, side wings) for the ground role.
# Mechanism modelled: box-section main beam + hinged outriggers with screw levelling jacks and foot pads, ribbed conical
# pedestal with toothed traverse ring, upper carriage side walls with lightening holes, the two tall equilibrator
# spring cylinders ahead of the trunnions, cradle with the recuperator above and the recoil brake below the barrel,
# breech ring + horizontal sliding block, loading tray with rammer, traverse (left) and elevation (right) handwheels
# with the two layers' seats, toothed elevation arc, Zielfernrohr sight, Zuenderstellmaschine fuze setter.
# Dimensions: barrel L/56 = 4.93 m, cruciform 5.2 x 4.6 m, trunnions 1.72 m, overall height 2.45 m (shield).
# Run: blender ... --python flak88.py -- [noshield] [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector, Matrix
import bmesh

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SHIELD = 'noshield' not in argv
PREVIEW = 'preview' in argv
V.begin('flak88' if SHIELD else 'flak88_noshield', seed=88)
C = Vector((0, 0.1, 0))              # pedestal centre

def handwheel(c, axis_x, r=0.17, node_='mount'):
    """Handwheel: rim, 3 spokes, hub, crank knob. Plane normal along X (axis_x = +1/-1 outward)."""
    rim = B.lathe('hw_rim', [(r - 0.018, 0.012), (r, 0.012), (r, -0.012), (r - 0.018, -0.012)], segs=14, axis='X')
    P(V._xf(rim, c), node_, 'steel', 1)
    for k in range(3):
        a = k * 2 * math.pi / 3
        P(B.beam('hw_spoke', Vector(c), Vector(c) + Vector((0, math.cos(a), math.sin(a))) * (r - 0.01), 0.018, 0.012, up=(1, 0, 0)), node_, 'steel', 0)
    P(B.cylinder('hw_hub', 0.035, 0.12, (c[0] - axis_x * 0.05, c[1], c[2]), 'X', 8), node_, 'steel', 1)
    P(B.cylinder('hw_knob', 0.018, 0.08, (c[0] + axis_x * 0.04, c[1], c[2] + r - 0.01), 'X', 6), node_, 'black', 0)

# ------------------------------------------------------------------ cruciform platform (static)
def taper_beam(name, p0, p1, w0, h0, w1, h1, z_top=True):
    """Box-section beam from p0 (w0 x h0) to p1 (w1 x h1), tops level if z_top."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0); d.z = 0; d.normalize(); s = Vector((-d.y, d.x, 0))
    pts = []
    for p, w, h in ((p0, w0, h0), (p1, w1, h1)):
        for sx, sz in ((-1, -1), (1, -1)):
            pts.append(p + s * sx * w / 2 + Vector((0, 0, -h)))
    pts = [pts[0], pts[1], pts[3], pts[2]]
    top = [p0 + s * -w0 / 2, p0 + s * w0 / 2, p1 + s * w1 / 2, p1 + s * -w1 / 2]
    return V.hexa(name, [tuple(v) for v in pts + top], bevel=0.01)
def box_beam(name, p0, p1, w0, h0, w1, h1):
    """rework2: riveted box-section girder that reads as such at close zoom: deep web + wider top and bottom flange
    plates (30 mm overhang), vertical stiffener ribs and rectangular lightening/inspection holes along the webs."""
    P(taper_beam(name, p0, p1, w0, h0, w1, h1), 'hull', 'paint')
    a, b = Vector(p0), Vector(p1)
    P(taper_beam(name + '_flange', a + Vector((0, 0, 0.018)), b + Vector((0, 0, 0.018)), w0 + 0.07, 0.022, w1 + 0.07, 0.022), 'hull', 'paint', 1)
    P(taper_beam(name + '_flange', a - Vector((0, 0, h0 - 0.02)), b - Vector((0, 0, h1 - 0.02)), w0 + 0.07, 0.022, w1 + 0.07, 0.022), 'hull', 'paint', 1)
    d = b - a; d.z = 0; L = d.length; d.normalize(); sv = Vector((-d.y, d.x, 0))
    n = max(2, int(L / 0.42))
    for k in range(1, n):
        f = k / n; c = a.lerp(b, f); w = w0 + (w1 - w0) * f; h = h0 + (h1 - h0) * f
        for sg in (-1, 1):
            q = c + sv * sg * (w / 2 + 0.01) - Vector((0, 0, h / 2))
            P(B.beam(name + '_rib', q - Vector((0, 0, h / 2 - 0.02)), q + Vector((0, 0, h / 2 - 0.02)), 0.02, 0.03, up=tuple(d)), 'hull', 'paint', 1)
            if k % 2 == 1 and k < n - 1:
                qh = c.lerp(a.lerp(b, (k + 1) / n), 0.5) + sv * sg * (w / 2 + 0.004) - Vector((0, 0, h / 2))
                P(B.beam(name + '_hole', qh - d * 0.1, qh + d * 0.1, 0.012, h * 0.45, up=(0, 0, 1)), 'hull', 'black', 1)
BZ = 0.50                            # top of the platform beams
for y in (-2.25, 2.95):              # main (longitudinal) beam: two tapered halves
    box_beam('main_beam', (0, C.y, BZ), (0, y, BZ - 0.08), 0.36, 0.34, 0.24, 0.22)
    V.weld((0.18, C.y, BZ), (0.11, y, BZ - 0.08)); V.weld((-0.18, C.y, BZ), (-0.11, y, BZ - 0.08))
for sx in (-1, 1):                   # hinged side outriggers (lowered)
    box_beam('outrigger', (sx * 0.30, C.y, BZ - 0.03), (sx * 2.28, C.y, BZ - 0.12), 0.30, 0.30, 0.22, 0.20)
    P(B.cylinder('outrigger_hinge', 0.075, 0.40, (sx * 0.30, C.y, BZ - 0.14), 'Y', 10), 'hull', 'steel', 1)
    P(B.beam('outrigger_brace', (sx * 0.22, C.y - 0.45, BZ - 0.05), (sx * 1.1, C.y, BZ - 0.08), 0.07, 0.06), 'hull', 'paint', 1)
    P(B.beam('outrigger_brace', (sx * 0.22, C.y + 0.45, BZ - 0.05), (sx * 1.1, C.y, BZ - 0.08), 0.07, 0.06), 'hull', 'paint', 1)
    V.bolt_row((sx * 0.5, C.y - 0.1, BZ - 0.03), (sx * 2.0, C.y - 0.07, BZ - 0.11), (0, 0, 1), 0.25)
for x, y in ((0, -2.2), (0, 2.9), (-2.25, C.y), (2.25, C.y)):     # screw levelling jacks: housing, crank, ribbed foot
    P(B.cylinder('jack_housing', 0.075, 0.30, (x, y, BZ - 0.02), 'Z', 10), 'hull', 'paint', 1)
    P(B.cylinder('jack_screw', 0.04, 0.34, (x, y, 0.20), 'Z', 8), 'hull', 'steel', 1)
    P(B.beam('jack_crank', (x, y, BZ + 0.15), (x + 0.16, y, BZ + 0.15), 0.025, 0.025), 'hull', 'steel', 0)
    P(B.cylinder('jack_cap', 0.05, 0.05, (x, y, BZ + 0.15), 'Z', 8), 'hull', 'steel', 0)
    P(B.cylinder('foot', 0.22, 0.05, (x, y, 0.025), 'Z', 14, r2=0.19), 'hull', 'paint')
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        D(B.beam('foot_rib', (x, y, 0.05), (x + 0.17 * math.cos(a), y + 0.17 * math.sin(a), 0.05), 0.02, 0.05), 'paint')
    V.contact('foot', (x, y, 0.0), 'foot')
    for dx, dy in ((0.28, 0), (-0.28, 0), (0, 0.28), (0, -0.28)):
        P(B.cylinder('stake', 0.02, 0.22, (x + dx, y + dy, 0.08), 'Z', 5), 'hull', 'steel', 0)
# ribbed conical pedestal + toothed traverse ring
P(B.cylinder('pedestal', 0.46, 0.44, (0, C.y, BZ + 0.18), 'Z', 28, r2=0.36, bevel=0.01), 'hull', 'paint')
for k in range(8):
    a = k * math.pi / 4 + math.pi / 8
    d = Vector((math.cos(a), math.sin(a), 0))
    P(B.beam('pedestal_rib', C + d * 0.30 + Vector((0, 0, BZ + 0.40)), C + d * 0.52 + Vector((0, 0, BZ - 0.02)), 0.03, 0.03, up=d), 'hull', 'paint', 1)
P(B.cylinder('traverse_ring', 0.50, 0.06, (0, C.y, BZ + 0.43), 'Z', 32, bevel=0.008), 'hull', 'paint')
for i in range(16):
    a = i * math.pi / 8
    D(B.cylinder('ring_bolt', 0.02, 0.03, (0.46 * math.cos(a), C.y + 0.46 * math.sin(a), BZ + 0.465), 'Z', 6), 'steel')
P(B.box('tow_eye', (0.12, 0.2, 0.12), (0, -2.33, BZ - 0.12)), 'hull', 'steel', 1)
TOPZ = BZ + 0.46                     # upper carriage sits on the traverse ring

# ------------------------------------------------------------------ upper carriage (traverse node)
TZ, TY = 1.72, C.y + 0.10            # trunnion height / station
node('mount', (0, C.y, TOPZ), 'hull', 'turret', (0, 0, 1), traverse_deg_s=30)
P(B.cylinder('carriage_base', 0.52, 0.10, (0, C.y, TOPZ + 0.05), 'Z', 32, bevel=0.01), 'mount', 'paint')
P(B.box('carriage_floor', (0.80, 1.7, 0.08), (0, C.y + 0.15, TOPZ + 0.12), bevel=0.01, segs=1), 'mount', 'paint')
for sx in (-1, 1):                   # side walls (Lafettenwaende) with flanges and lightening holes
    side = [(0.95, TOPZ + 0.08), (-0.80, TOPZ + 0.08), (-0.55, TOPZ + 0.5), (-0.12, TZ + 0.14), (0.32, TZ + 0.14), (0.95, TOPZ + 0.42)]
    P(B.prism('side_wall', [(C.y + y, z) for y, z in side], 0.03, plane='YZ', offset=sx * 0.36, bevel=0.004), 'mount', 'paint')
    for (a, b) in zip(side[1:], side[2:5]):
        P(B.beam('wall_flange', (sx * 0.39, C.y + a[0], a[1]), (sx * 0.39, C.y + b[0], b[1]), 0.05, 0.02, up=(1, 0, 0)), 'mount', 'paint', 1)
    for yy, zz, rr in ((0.45, TOPZ + 0.27, 0.09), (-0.25, TOPZ + 0.30, 0.1)):
        P(B.cylinder('lightening_hole', rr, 0.035, (sx * 0.36, C.y + yy, zz), 'X', 10), 'mount', 'black', 1)
    P(B.cylinder('trunnion_bearing', 0.12, 0.10, (sx * 0.40, TY, TZ), 'X', 12), 'mount', 'paint', 1)
    V.bolt_row((sx * 0.46, TY - 0.07, TZ + 0.07), (sx * 0.46, TY + 0.07, TZ - 0.07), (sx, 0, 0), 0.07)
    # equilibrators: tall spring cylinders ahead of the trunnions, lower pivot on the carriage, rod to the cradle
    lo, hi = Vector((sx * 0.30, C.y - 0.62, TOPZ + 0.12)), Vector((sx * 0.30, C.y - 0.52, TZ + 0.45))
    P(B.beam('eq_foot', lo - Vector((0, 0, 0.05)), lo + Vector((0, 0.1, 0.05)), 0.12, 0.1), 'mount', 'paint', 1)
    eq = B.cylinder('equilibrator', 0.095, (hi - lo).length, (0, 0, 0), 'Z', 18, bevel=0.01); B.apply_all(eq)
    V._xf(eq, tuple((lo + hi) / 2), rx=-math.atan2(hi.y - lo.y, hi.z - lo.z))
    P(eq, 'mount', 'paint')
    for f in (0.2, 0.5, 0.8):
        D(B.cylinder('eq_band', 0.1, 0.025, tuple(lo.lerp(hi, f)), 'Z', 14), 'paint')
    P(B.cylinder('eq_cap', 0.07, 0.06, tuple(hi + Vector((0, 0, 0.03))), 'Z', 10), 'mount', 'paint', 1)
# handwheels: traverse (left layer) + elevation (right layer), seats on arms, sight on the left
handwheel((0.52, C.y + 0.40, TOPZ + 0.62), 1)
handwheel((-0.52, C.y + 0.36, TOPZ + 0.66), -1)
P(B.box('traverse_gearbox', (0.14, 0.26, 0.30), (0.44, C.y + 0.40, TOPZ + 0.45)), 'mount', 'paint', 1)
P(B.box('elev_gearbox', (0.14, 0.26, 0.30), (-0.44, C.y + 0.36, TOPZ + 0.48)), 'mount', 'paint', 1)
for sx in (-1, 1):
    P(B.beam('seat_arm', (sx * 0.38, C.y + 0.62, TOPZ + 0.16), (sx * 0.78, C.y + 0.80, TOPZ + 0.12), 0.05, 0.05), 'mount', 'paint', 1)
    # rework2: pressed-steel pan seats with a low curved back rail (were black box + upright slab = 'laptop')
    P(B.cylinder('seat', 0.16, 0.04, (sx * 0.80, C.y + 0.80, TOPZ + 0.15), 'Z', 14, r2=0.14, bevel=0.01), 'mount', 'paint', 1)
    P(B.cylinder('seat_pan', 0.13, 0.012, (sx * 0.80, C.y + 0.80, TOPZ + 0.17), 'Z', 12), 'mount', 'paint_dark', 1)
    P(B.beam('seat_back', (sx * 0.68, C.y + 0.90, TOPZ + 0.22), (sx * 0.92, C.y + 0.90, TOPZ + 0.22), 0.03, 0.06), 'mount', 'paint', 1)
    P(B.box('footrest', (0.2, 0.12, 0.03), (sx * 0.72, C.y + 0.55, TOPZ + 0.02)), 'mount', 'steel', 0)
    V.socket(f'layer_{"L" if sx > 0 else "R"}', (sx * 0.80, C.y + 0.80, TOPZ + 0.16), 'mount', heading=0.0, pose='seated_gun')
P(B.cylinder('sight_tube', 0.045, 0.50, (0.54, TY - 0.05, TZ + 0.18), 'Y', 10), 'mount', 'gunmetal', 1)
P(B.box('sight_head', (0.10, 0.12, 0.16), (0.54, TY - 0.32, TZ + 0.22)), 'mount', 'gunmetal', 1)
P(B.box('sight_eyepiece', (0.08, 0.1, 0.1), (0.54, TY + 0.24, TZ + 0.16)), 'mount', 'black', 1)
P(B.box('sight_bracket', (0.18, 0.08, 0.35), (0.46, TY - 0.05, TZ - 0.05)), 'mount', 'paint', 1)
# rework2: Zuenderstellmaschine 36 (fuze setter) on the left of the carriage: two upright cylindrical setting drums
# (open cups at the top take the shell nose), joined by a round gear housing, crank handle with knob on the outboard
# side, setting dial on the front, mounting bracket to the side wall
FX, FY, FZ0 = 0.74, C.y - 0.30, TOPZ + 0.30
P(B.beam('fuze_bracket', (0.40, FY, FZ0), (FX - 0.05, FY, FZ0), 0.08, 0.06), 'mount', 'paint', 1)
P(B.box('fuze_base', (0.26, 0.42, 0.05), (FX, FY, FZ0 + 0.02), bevel=0.01, segs=1), 'mount', 'paint', 1)
for dy in (-0.11, 0.11):
    P(B.cylinder('fuze_drum', 0.095, 0.40, (FX, FY + dy, FZ0 + 0.25), 'Z', 16, bevel=0.008), 'mount', 'paint')
    P(B.cylinder('fuze_cup_rim', 0.075, 0.03, (FX, FY + dy, FZ0 + 0.46), 'Z', 14), 'mount', 'steel', 1)
    P(B.cylinder('fuze_cup', 0.058, 0.012, (FX, FY + dy, FZ0 + 0.47), 'Z', 12), 'mount', 'black', 1)
    D(B.cylinder('fuze_band', 0.1, 0.02, (FX, FY + dy, FZ0 + 0.14), 'Z', 16), 'paint')
P(B.cylinder('fuze_gearcase', 0.07, 0.20, (FX, FY, FZ0 + 0.30), 'X', 12), 'mount', 'paint', 1)
P(B.cylinder('fuze_dial', 0.06, 0.02, (FX, FY - 0.215, FZ0 + 0.32), 'Y', 14), 'mount', 'steel', 1)
P(B.beam('fuze_crank', (FX + 0.10, FY, FZ0 + 0.30), (FX + 0.12, FY + 0.02, FZ0 + 0.46), 0.025, 0.02), 'mount', 'steel', 1)
P(B.cylinder('fuze_knob', 0.018, 0.09, (FX + 0.165, FY + 0.02, FZ0 + 0.46), 'X', 8), 'mount', 'black', 1)
V.socket('loader', (0.0, C.y + 1.9, 0.0), 'mount', heading=0.0, pose='standing_load')
V.socket('fuze_setter', (0.95, C.y - 0.1, 0.0), 'mount', pose='standing')

# ------------------------------------------------------------------ gun (elevation node at the trunnions)
node('gun', (0, TY, TZ), 'mount', 'gun', (1, 0, 0), elev_min=-3, elev_max=85)
MZ = TY - 4.55                       # muzzle station (barrel 4.93 m from the breech face at TY + 0.38)
P(B.cylinder('cradle', 0.16, 2.3, (0, TY - 0.45, TZ), 'Y', 20), 'gun', 'paint')
P(B.box('cradle_keel', (0.14, 2.0, 0.12), (0, TY - 0.35, TZ - 0.17), bevel=0.01, segs=1), 'gun', 'paint', 1)
for sx in (-1, 1):
    P(B.cylinder('trunnion', 0.075, 0.12, (sx * 0.26, TY, TZ), 'X', 10), 'gun', 'steel', 1)
V.bolt_row((0.16, TY - 1.5, TZ + 0.02), (0.16, TY + 0.6, TZ + 0.02), (1, 0, 0), 0.2)
V.bolt_row((-0.16, TY - 1.5, TZ + 0.02), (-0.16, TY + 0.6, TZ + 0.02), (-1, 0, 0), 0.2)
# recuperator (Vorholer) above, recoil brake (Rohrbremse) below the barrel, with end caps
P(B.cylinder('recuperator', 0.075, 2.25, (0, TY - 0.55, TZ + 0.23), 'Y', 16), 'gun', 'paint')
P(B.cylinder('recup_cap', 0.085, 0.07, (0, TY + 0.56, TZ + 0.23), 'Y', 12), 'gun', 'paint', 1)
P(B.cylinder('recoil_brake', 0.068, 1.9, (0, TY - 0.45, TZ - 0.27), 'Y', 16), 'gun', 'paint')
P(B.cylinder('brake_cap', 0.078, 0.07, (0, TY + 0.49, TZ - 0.27), 'Y', 12), 'gun', 'paint', 1)
for yy in (TY - 1.55, TY - 0.2):
    P(B.box('cyl_clamp', (0.2, 0.06, 0.56), (0, yy, TZ)), 'gun', 'paint', 1)
# barrel: breech jacket, stepped tube tapering to the muzzle (no brake on the Flak 18/36)
P(B.cylinder('barrel_rear', 0.135, 1.1, (0, TY - 0.05, TZ), 'Y', 24, bevel=0.01), 'gun', 'paint')
P(B.cylinder('barrel_step', 0.118, 0.9, (0, TY - 1.55, TZ), 'Y', 24, r2=0.112), 'gun', 'paint')
P(B.cylinder('barrel', 0.105, (TY - 2.0) - (MZ + 0.12), (0, ((TY - 2.0) + (MZ + 0.12)) / 2, TZ), 'Y', 22, r2=0.088), 'gun', 'paint')
P(B.cylinder('muzzle', 0.098, 0.12, (0, MZ + 0.06, TZ), 'Y', 22, bevel=0.01), 'gun', 'paint')
P(B.cylinder('bore', 0.044, 0.01, (0, MZ - 0.004, TZ), 'Y', 12), 'gun', 'black', 1)
D(B.cylinder('barrel_collar', 0.125, 0.04, (0, TY - 2.0, TZ), 'Y', 18), 'paint')
# breech: ring, horizontal sliding block + lever, loading tray with rammer housing behind
P(B.box('breech_ring', (0.44, 0.34, 0.44), (0, TY + 0.55, TZ), bevel=0.04, segs=1), 'gun', 'gunmetal')
P(B.box('breech_block', (0.52, 0.12, 0.2), (0.05, TY + 0.72, TZ)), 'gun', 'gunmetal', 1)
P(B.beam('breech_lever', (0.26, TY + 0.7, TZ + 0.05), (0.36, TY + 0.95, TZ + 0.18), 0.03, 0.03), 'gun', 'steel', 0)
P(B.box('loading_tray', (0.26, 0.95, 0.03), (0, TY + 1.25, TZ - 0.12)), 'gun', 'steel', 1)
for sx in (-1, 1):
    P(B.box('tray_side', (0.02, 0.95, 0.10), (sx * 0.13, TY + 1.25, TZ - 0.08)), 'gun', 'steel', 1)
    P(B.beam('tray_arm', (sx * 0.2, TY + 0.6, TZ - 0.15), (sx * 0.14, TY + 1.0, TZ - 0.12), 0.04, 0.04), 'gun', 'paint', 1)
P(B.box('rammer_housing', (0.16, 0.9, 0.14), (0.22, TY + 1.25, TZ - 0.02), bevel=0.02, segs=1), 'gun', 'paint', 1)
# elevation arc (toothed sector) on the cradle, right side, meshing with the elevation gearbox
arc = [(0.0, 0.0)] + [(0.62 * math.sin(math.radians(a)), -0.62 * math.cos(math.radians(a))) for a in range(-25, 96, 12)]
P(B.prism('elev_arc', [(TY + y, TZ + z) for y, z in arc], 0.035, plane='YZ', offset=-0.30), 'gun', 'paint', 1)
for a in range(-25, 96, 6):
    D(B.box('arc_tooth', (0.04, 0.02, 0.03), (-0.30, TY + 0.63 * math.sin(math.radians(a)), TZ - 0.63 * math.cos(math.radians(a)))), 'steel')
V.muzzle('main_gun', (0, MZ - 0.01, TZ), 'gun', (0, -1, 0), '88mm_flak36', caliber=0.088)
V.emitter('muzzle_blast_dust', (0, MZ + 0.5, 0.05), 'mount', (0, -1, 0.2), 'blast_dust')
V.emitter('breech_smoke', (0, TY + 0.8, TZ), 'gun', (0, 1, 0.3), 'smoke')
V.emitter('casings', (0, TY + 1.0, TZ - 0.2), 'gun', (0, 1, -0.3), 'casings')
for i in range(4):                   # barrel kill rings (white bands)
    V.decal('ring', (0, TY - 2.7 - i * 0.07, TZ + 0.1), (0, 0, 1), (0, -1, 0), 0.2, 0.035, 'gun')

# ------------------------------------------------------------------ field shield (mount node, static)
def plate(name, pts, t=0.012, key='paint', lod=2):
    bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]; bm.faces.new(vs)
    o = B.obj_from_bm(name, bm); B.solidify(o, t, offset=-1); return P(o, 'mount', key, lod)
if SHIELD:
    # rework2: real Flak 36 field shield = ONE wide 10 mm plate (2.24 m) ahead of the cradle with a central barrel
    # slot (open to the top so the gun can elevate), a folding upper section hinged along its top edge (raised,
    # raked back 12 deg), short side wings angled back 25 deg, stiffening flange along the bottom, support struts.
    SY, ZB, ZS, ZT, SL, HW = C.y - 1.05, 1.02, 1.30, 2.10, 0.20, 1.12   # plane, bottom, slot bottom, top, slot/half width
    outline = [(-HW, ZB), (HW, ZB), (HW, ZT - 0.08), (HW - 0.08, ZT), (SL, ZT), (SL, ZS + 0.06), (SL - 0.06, ZS),
               (-SL + 0.06, ZS), (-SL, ZS + 0.06), (-SL, ZT), (-HW + 0.08, ZT), (-HW, ZT - 0.08)]
    sh = B.prism('shield', [(x, z) for x, z in outline], 0.012, plane='XZ', offset=SY, bevel=0.003)
    for pg in sh.data.polygons:
        pg.use_smooth = False
    P(sh, 'mount', 'paint')
    for sx in (-1, 1):
        tz = lambda k: (ZT + 0.02 + 0.30 * k, SY + 0.064 * k)                 # raked-back folding top
        (z0, y0), (z1, y1) = tz(0), tz(1)
        plate('shield_top', [(sx * SL, y0, z0), (sx * (HW - 0.08), y0, z0), (sx * (HW - 0.14), y1, z1), (sx * SL, y1, z1)])
        T.hinge((sx * (SL + 0.04), SY - 0.012, ZT + 0.01), (sx * (HW - 0.12), SY - 0.012, ZT + 0.01), 'mount')
        # side wings: hinged on the outer edge, angled back 25 deg
        wx, wy = sx * (HW + 0.40 * math.cos(math.radians(25))), SY + 0.40 * math.sin(math.radians(25))
        plate('shield_wing', [(sx * HW, SY, ZB + 0.04), (sx * HW, SY, ZT - 0.12), (wx, wy, ZT - 0.26), (wx, wy, ZB + 0.12)])
        for zz in (ZB + 0.22, ZT - 0.34):
            T.hinge((sx * (HW + 0.01), SY - 0.012, zz - 0.1), (sx * (HW + 0.01), SY - 0.012, zz + 0.1), 'mount')
        P(B.beam('shield_strut', (sx * 0.70, SY + 0.02, ZB + 0.10), (sx * 0.38, C.y - 0.30, TOPZ + 0.14), 0.05, 0.05), 'mount', 'paint', 1)
        P(B.beam('shield_strut', (sx * 0.62, SY + 0.02, ZS + 0.40), (sx * 0.40, C.y - 0.40, TOPZ + 0.50), 0.05, 0.05), 'mount', 'paint', 1)
        V.bolt_row((sx * 0.3, SY - 0.004, ZB + 0.05), (sx * (HW - 0.05), SY - 0.004, ZB + 0.05), (0, -1, 0), 0.13)
        V.bolt_row((sx * (HW - 0.04), SY - 0.004, ZB + 0.12), (sx * (HW - 0.04), SY - 0.004, ZT - 0.15), (0, -1, 0), 0.15)
        V.plate_edge((sx * (SL + 0.015), SY - 0.004, ZS + 0.05), (sx * (SL + 0.015), SY - 0.004, ZT), (0, -1, 0), 0.035)
    P(B.box('shield_flange', (2 * HW, 0.07, 0.012), (0, SY + 0.03, ZB + 0.006)), 'mount', 'paint', 1)   # bottom stiffener
    P(B.box('sight_window', (0.16, 0.02, 0.09), (0.54, SY - 0.005, TZ + 0.2)), 'mount', 'black', 1)
    P(B.box('sight_flap', (0.20, 0.012, 0.12), (0.54, SY - 0.03, TZ + 0.31), rot=('X', 40)), 'mount', 'paint', 1)
    V.plate_edge((-HW, SY - 0.004, ZB + 0.01), (HW, SY - 0.004, ZB + 0.01), (0, -1, 0), 0.04)
    V.decal('num:3:w', (0.70, SY - 0.006, 1.80), (0, -1, 0), (0, 0, 1), 0.22, 0.22, 'mount')
    # slot cover: small plate clamped to the cradle just ahead of the main shield, closes the barrel slot and
    # rides up/down with the gun (gun node) -> at rest the shield reads as one continuous wide plate
    P(B.prism('shield_slot_cover', [(-0.25, TZ - 0.44), (0.25, TZ - 0.44), (0.25, TZ + 0.34), (0.19, TZ + 0.40), (-0.19, TZ + 0.40),
                                     (-0.25, TZ + 0.34)], 0.012, plane='XZ', offset=SY - 0.035, bevel=0.003), 'gun', 'paint')
    V.bolt_row((-0.2, SY - 0.042, TZ + 0.3), (0.2, SY - 0.042, TZ + 0.3), (0, -1, 0), 0.1)
    P(B.cylinder('cover_collar', 0.19, 0.05, (0, SY - 0.06, TZ), 'Y', 16), 'gun', 'paint', 1)

# ------------------------------------------------------------------ ready ammunition beside the platform
def round88(loc, rz=0.0, rx=0.0):
    """8.8 cm Sprenggranate: brass case with rim + olive projectile with driving band and fuze tip, along -Y."""
    c = B.lathe('case', [(0.0, 0.0), (0.055, 0.0), (0.055, -0.012), (0.047, -0.02), (0.046, -0.50), (0.044, -0.57), (0.0, -0.57)], segs=10, axis='Y')
    P(V._xf(c, loc, rz, rx), 'hull', 'brass', 1)
    p = B.lathe('shell', [(0.0, -0.56), (0.044, -0.56), (0.046, -0.60), (0.044, -0.72), (0.036, -0.82), (0.02, -0.89), (0.0, -0.92)], segs=10, axis='Y')
    P(V._xf(p, loc, rz, rx), 'hull', 'paint_dark', 1)
AX_, AY_ = 1.55, 1.45
for k in range(3):                   # closed steel 3-round containers (Patronenkasten), stacked
    for j in range(2 if k < 2 else 1):
        P(B.box('ammo_case', (1.02, 0.36, 0.14), (AX_ + j * 0.02, AY_ + k * 0.0 + j * 0.4, 0.07 + k * 0.145), bevel=0.012, segs=1, rot=('Z', 90 + j * 3)), 'hull', 'paint')
        D(B.box('case_clasp', (0.06, 0.37, 0.05), (AX_ + j * 0.02, AY_ + j * 0.4 - 0.3, 0.1 + k * 0.145), rot=('Z', 90 + j * 3)), 'steel')
# one open container with its three rounds, two rounds lying ready on the ground
P(B.box('ammo_case_open', (0.36, 1.02, 0.10), (AX_ + 0.55, AY_ + 0.2, 0.05), bevel=0.01, segs=1), 'hull', 'paint')
P(B.box('ammo_lid', (0.36, 1.02, 0.02), (AX_ + 0.95, AY_ + 0.2, 0.01), rot=('Z', 8)), 'hull', 'paint', 1)
for i in range(3):
    round88((AX_ + 0.44 + i * 0.11, AY_ + 0.2 + 0.46, 0.105))
for i in range(2):
    round88((AX_ - 0.55 + i * 0.12, AY_ + 1.3, 0.05), rz=0.4 + i * 0.1)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, -0.5, 1.0), dist=12, elev=30, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(barrel_length=4.93, platform_length=5.2, platform_width=4.6, trunnion_height=1.72,
                            height=2.45 if SHIELD else 2.05, weight_t=5.0),
           burnt_pose={'mount': dict(rot=(0, 0, 28)), 'gun': dict(rot=(-4, 5, 0)), 'hull': dict(rot=(1.5, -2, 0))},
           burnt_drop=('case', 'shell', 'ammo_lid', 'shield_top', 'shield_wing', 'seat', 'sight', 'fuze_', 'hw_', 'loading_tray',
                       'tray_', 'footrest'),
           info=dict(model='8.8 cm Flak 18/36 on Kreuzlafette 36', crew='9 (2 layers, loader, fuze setter, ammunition)',
                     role='AA / anti-tank emplacement', shield=SHIELD, sources='vehicles/refs/armour/urls.json'))
