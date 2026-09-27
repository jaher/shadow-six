# pz4.py - Panzerkampfwagen IV Ausf. G (mid 1942, 7.5 cm KwK 40 L/43, double-baffle muzzle brake, Rommelkiste,
# single headlight, gunner-side turret visor only) and Ausf. F2 (spring 1942: single-chamber ball brake, twin
# headlights, both turret front visors + KFF2 twin periscope holes, smoke-candle rack, spare road wheels on the rear).
# Dimensions: hull 5.92 m (incl. muffler / nose links), 6.62 m with gun, width 2.88 m, height 2.68 m, track 400 mm
# (Kgs 61/400/120, 99 links), 8 twin road wheels 470 mm per side in 4 leaf-spring bogies, 4 return rollers, front
# sprocket, rear spoked idler; turret offset 67 mm to the left; gun: breech face 3.45 m behind the brake tip.
# Stepped front: lower glacis -> near-vertical nose plate (spare links) -> 18 deg upper glacis (brake hatches with
# tropical vent hoods) -> 10 deg driver front plate (Fahrersehklappe 50 + Kugelblende 50).
# Run: blender -b --factory-startup --python-use-system-env --python pz4.py -- [f2|g] [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
GUNV = argv[0] if argv else 'g'
PREVIEW = 'preview' in argv
G = GUNV == 'g'
NAME = 'panzer4_g' if G else 'panzer4_f2'
V.begin(NAME, seed=4 if G else 5)
Y = lambda s: s - 2.96            # station from the front (m) -> Blender Y (-Y = forward)

# ------------------------------------------------------------------ lower hull (between the tracks)
T_W, SUP_W, FEN_W, ROOF, DECK = 0.935, 1.14, 1.44, 1.66, 1.57
low = [(Y(0.62), 0.40), (Y(5.40), 0.40), (Y(5.60), 0.52), (Y(5.62), 1.0), (Y(0.78), 1.0), (Y(0.78), 1.16),
       (Y(0.13), 0.97), (Y(0.08), 0.70)]
P(T.side_prism('lower_hull', low, -T_W, T_W, bevel=0.01), uv=0.6)
# nose plate + glacis joints, bottom plate joint (welds), nose/glacis bolts
for s0, z0, s1, z1 in ((0.08, 0.70, 0.13, 0.97), (0.13, 0.97, 0.78, 1.16), (0.62, 0.40, 0.08, 0.70)):
    for sx in (-1, 1):
        V.weld((sx * T_W, Y(s0), z0), (sx * T_W, Y(s1), z1))
    V.weld((-T_W, Y(s0), z0), (T_W, Y(s0), z0))
V.weld((-T_W, Y(0.13), 0.97), (T_W, Y(0.13), 0.97))
V.bolt_row((-0.8, Y(0.105), 0.93), (0.8, Y(0.105), 0.93), (0, -1, 0.2), 0.16)
# brake access hatches on the upper glacis, with tropical vent hoods and hinges at the front edge
gv = Vector((0, Y(0.78) - Y(0.13), 1.16 - 0.97)).normalized(); gn = Vector((0, -gv.z, gv.y))
for sx in (-1, 1):
    c = Vector((sx * 0.43, Y(0.44), 1.06))
    P(T.plate_on('brake_hatch', c, (1, 0, 0), gv, 0.66, 0.44, 0.022, 0.006), 'hull', 'paint', 1)
    T.hinge((sx * 0.2, Y(0.22), 1.03), (sx * 0.66, Y(0.22), 1.03))
    V.bolt_row(c + Vector((-0.3, 0, 0)) - gv * 0.2 + gn * 0.02, c + Vector((0.3, 0, 0)) - gv * 0.2 + gn * 0.02, gn, 0.1)
    hood = c + gv * 0.05 + gn * 0.06
    P(T.plate_on('vent_hood', hood, (1, 0, 0), gv, 0.34, 0.16, 0.08, 0.02), 'hull', 'paint', 1)
    P(T.plate_on('vent_slot', hood + gn * 0.045 - gv * 0.075, (1, 0, 0), (0, 0, 1), 0.28, 0.035, 0.01), 'hull', 'black', 1)
    T.tow_shackle((sx * 0.62, Y(0.02), 0.62), rz=math.pi / 2)
    T.tow_shackle((sx * 0.58, Y(5.66), 0.70), rz=math.pi / 2)
# spare track links on the nose plate (rack bar + 9 links)
V.spare_links((0, Y(0.07), 0.84), 9 if G else 7, pitch=0.12, width=0.40, rz=math.pi / 2, ry=-(math.pi / 2 - 0.18))
P(B.box('link_rack', (1.2, 0.04, 0.05), (0, Y(0.07), 0.96)), 'hull', 'steel', 1)
if G:                               # extra links stood on the left front fender (period photos)
    V.spare_links((1.30, Y(0.78), 1.20), 5, pitch=0.12, width=0.40, ry=math.pi / 2)
    P(B.box('link_bracket', (0.30, 0.04, 0.24), (1.29, Y(1.10), 1.12)), 'hull', 'paint', 1)

# ------------------------------------------------------------------ superstructure (overhangs the tracks)
sup = [(Y(0.70), 1.0), (Y(5.40), 1.0), (Y(5.40), DECK), (Y(3.66), DECK), (Y(3.62), ROOF), (Y(0.80), ROOF)]
P(T.side_prism('superstructure', sup, -SUP_W, SUP_W, bevel=0.008))
rear = [(Y(5.40), 1.0), (Y(5.62), 1.0), (Y(5.60), 1.46), (Y(5.40), DECK)]
P(T.side_prism('rear_deck', rear, -SUP_W, SUP_W, bevel=0.008))
fp_n = Vector((0, -0.48, 0.10)).normalized(); fp_u = Vector((0, 0.10, 0.48)).normalized()
for sx in (-1, 1):                  # plate joints: welded sides, front plate corners, roof edge, rear plate
    V.weld((sx * SUP_W, Y(0.70), 1.0), (sx * SUP_W, Y(0.80), ROOF))
    V.weld((sx * SUP_W, Y(0.80), ROOF), (sx * SUP_W, Y(3.62), ROOF))
    V.weld((sx * SUP_W, Y(5.40), 1.0), (sx * SUP_W, Y(5.40), DECK))
    V.weld((sx * SUP_W, Y(0.9), 1.0), (sx * SUP_W, Y(5.4), 1.0))
    V.bolt_row((sx * (SUP_W - 0.05), Y(0.95), ROOF), (sx * (SUP_W - 0.05), Y(3.5), ROOF), (0, 0, 1), 0.18)
    V.bolt_row((sx * (SUP_W - 0.05), Y(3.8), DECK), (sx * (SUP_W - 0.05), Y(5.3), DECK), (0, 0, 1), 0.2)
V.weld((-SUP_W, Y(0.80), ROOF), (SUP_W, Y(0.80), ROOF))
V.bolt_row((-1.0, Y(0.9), ROOF), (1.0, Y(0.9), ROOF), (0, 0, 1), 0.2)
V.bolt_row((-1.0, Y(3.58), ROOF), (1.0, Y(3.58), ROOF), (0, 0, 1), 0.2)
# driver front plate: Fahrersehklappe 50 visor (vehicle left = +X) with armoured slide, KFF2 holes on F2
vp = Vector((0.52, Y(0.76), 1.40))
P(T.plate_on('visor_frame', vp, (1, 0, 0), fp_u, 0.40, 0.20, 0.03, 0.008), 'hull', 'paint', 1)
P(T.plate_on('visor_block', vp + fp_n * 0.03, (1, 0, 0), fp_u, 0.30, 0.13, 0.07, 0.02), 'hull', 'paint', 1)
P(T.plate_on('visor_slit', vp + fp_n * 0.10, (1, 0, 0), fp_u, 0.20, 0.012, 0.004), 'hull', 'black', 1)
V.bolt_row(vp + fp_u * 0.09 + fp_n * 0.03 - Vector((0.17, 0, 0)), vp + fp_u * 0.09 + fp_n * 0.03 + Vector((0.17, 0, 0)), fp_n, 0.085)
if not G:
    for dx in (-0.08, 0.08):
        P(B.cylinder('kff_hole', 0.03, 0.02, tuple(vp + fp_u * 0.17 + Vector((dx, 0, 0))), 'Y', 8), 'hull', 'black', 1)
# Kugelblende 50: collar ring, ball, MG 34 muzzle
bc = Vector((-0.50, Y(0.77), 1.38))
col = B.lathe('kb_collar', [(0.16, 0.0), (0.2, 0.0), (0.2, -0.04), (0.16, -0.06)], segs=12, axis='Y')
P(V._xf(col, bc), 'hull', 'paint', 1)
ball = B.lathe('kugelblende', [(0.0, -0.13), (0.07, -0.12), (0.13, -0.06), (0.15, 0.0), (0.0, 0.02)], segs=12, axis='Y')
P(V._xf(ball, bc), 'hull', 'paint', 2)
V.bolt_row(bc + Vector((-0.18, -0.04, 0.12)), bc + Vector((0.18, -0.04, 0.12)), (0, -1, 0), 0.09)
mz_hull = V.mg('mg34', (bc.x, Y(1.40), bc.z), 'hull', full=False, jacket_only=True)
# side vision ports on the superstructure (driver / radio operator)
for sx in (-1, 1):
    T.vision_port((sx * SUP_W, Y(1.30), 1.42), (sx, 0, 0), 0.24, 0.10)
# roof: driver / radio operator escape hatches (open sideways, hinge along Y at the outer edge)
for sx, nm in ((1, 'hatch_driver'), (-1, 'hatch_radio')):
    x0, x1 = sx * 0.42, sx * 0.98
    node(nm, (x1, Y(1.30), ROOF + 0.02), 'hull', 'hatch', (0, 1, 0), open_deg=-sx * 110)
    P(B.box(nm, (0.54, 0.50, 0.035), ((x0 + x1) / 2, Y(1.30), ROOF + 0.02), bevel=0.01, segs=1), nm, 'paint')
    P(B.box('hatch_grip', (0.12, 0.03, 0.03), ((x0 + x1) / 2, Y(1.30), ROOF + 0.05)), nm, 'steel', 0)
    V.bolt_row(((x0 + x1) / 2 - 0.2, Y(1.08), ROOF + 0.037), ((x0 + x1) / 2 + 0.2, Y(1.08), ROOF + 0.037), (0, 0, 1), 0.1)
    T.hinge((x1, Y(1.12), ROOF + 0.025), (x1, Y(1.48), ROOF + 0.025))
    T.lift_hook((sx * 1.08, Y(1.0), ROOF)); T.lift_hook((sx * 1.08, Y(5.3), DECK))
# engine deck: two access hatches with intake grilles, radiator louvres at the sides, hinges, handles
for sx in (-1, 1):
    P(B.box('engine_hatch', (0.60, 1.0, 0.03), (sx * 0.43, Y(4.35), DECK + 0.015), bevel=0.008, segs=1))
    T.grille((sx * 0.43, Y(4.25), DECK + 0.03), 0.40, 0.40, 4)
    T.grille((sx * 0.86, Y(4.85), DECK), 0.34, 0.9, 6, along='Y')
    T.hinge((sx * 0.14, Y(3.9), DECK + 0.035), (sx * 0.14, Y(4.8), DECK + 0.035))
    V.bolt_row((sx * 0.43 - 0.26, Y(4.83), DECK + 0.03), (sx * 0.43 + 0.26, Y(4.83), DECK + 0.03), (0, 0, 1), 0.13)
    P(B.box('deck_handle', (0.14, 0.025, 0.04), (sx * 0.62, Y(4.6), DECK + 0.05)), 'hull', 'steel', 0)
V.weld((-SUP_W, Y(3.66), DECK), (SUP_W, Y(3.66), DECK))
V.plate_edge((-0.13, Y(3.86), DECK + 0.005), (-0.13, Y(5.35), DECK + 0.005), (0, 0, 1))
V.plate_edge((0.13, Y(3.86), DECK + 0.005), (0.13, Y(5.35), DECK + 0.005), (0, 0, 1))
# rear: muffler + stubs, auxiliary generator exhaust, inertia-starter cover, idler cranks, tail + convoy light
muf = B.cylinder('muffler', 0.14, 1.0, (0.06, Y(5.76), 0.84), 'X', 12, bevel=0.015)
P(muf, 'hull', 'steel')
for dx in (-0.3, 0.42):
    P(B.box('muffler_strap', (0.035, 0.3, 0.32), (0.06 + dx, Y(5.76), 0.84)), 'hull', 'paint', 0)
P(B.cylinder('exhaust', 0.045, 0.40, (0.45, Y(5.78), 1.04), 'Z', 8), 'hull', 'steel', 1)
P(B.cylinder('aux_exhaust', 0.06, 0.26, (-0.62, Y(5.72), 0.86), 'X', 8), 'hull', 'steel', 1)
P(B.cylinder('starter_cover', 0.1, 0.03, (0.0, Y(5.63), 1.22), 'Y', 10), 'hull', 'paint', 1)
V.bolt_row((-0.9, Y(5.61), 1.40), (0.9, Y(5.61), 1.40), (0, 1, 0.1), 0.18)
P(B.box('tail_light', (0.1, 0.06, 0.08), (0.9, Y(5.64), 1.22), bevel=0.01, segs=1), 'hull', 'red', 1)
if not G:                           # F2: smoke-candle rack across the upper rear plate
    P(B.box('smoke_rack', (0.52, 0.14, 0.12), (0.0, Y(5.66), 1.36), bevel=0.01, segs=1), 'hull', 'paint', 1)
    for i in range(5):
        D(B.cylinder('smoke_candle', 0.035, 0.14, (-0.2 + i * 0.1, Y(5.67), 1.46), 'Z', 8), 'steel')
V.emitter('exhaust_main', (0.45, Y(5.78), 1.26), 'hull', (0, 0.2, 1), 'exhaust')
V.emitter('exhaust_aux', (-0.76, Y(5.72), 0.86), 'hull', (-1, 0.2, 0.3), 'exhaust')

# ------------------------------------------------------------------ running gear
XC, R_RW, THK = 1.22, 0.235, 0.05
rw = V.set_mats(V.road_wheel2('rw', R_RW, 0.085, 0.09, segs=10), ['paint', 'rubber'])
spr = V.set_mats(V.sprocket2('spr', 0.36, 0.30, teeth=20), ['paint', 'black'])
idl = V.set_mats(V.spoked_idler('idl', 0.30, 0.22, spokes=8), ['paint'])
rol = V.set_mats(V.return_roller('rol', 0.125, 0.16), ['paint', 'rubber'])
BOG = (1.00, 1.95, 2.90, 3.85)
road = []
for b0 in BOG:
    road += [(Y(b0), R_RW + THK), (Y(b0 + 0.52), R_RW + THK)]
V.running_gear(XC, road, dict(ob=rw, r=R_RW), (Y(0.36), 0.78, 0.31), dict(ob=spr, r=0.36), (Y(5.30), 0.60, 0.27),
               dict(ob=idl, r=0.30), rollers=[(Y(s), 0.86, 0.125) for s in (1.45, 2.40, 3.35, 4.30)],
               roll_src=dict(ob=rol, r=0.125), track_w=0.40, thick=THK, pitch=0.12, sag=0.03)
for sx in (-1, 1):
    for b0 in BOG:
        T.bogie(sx * 1.03, Y(b0 + 0.26), 0.42, sx, span=0.52)
    fd = B.lathe('final_drive', [(0.24, 0.0), (0.24, 0.1), (0.2, 0.16), (0.12, 0.2), (0.0, 0.21)], segs=12, axis='X')
    V._xf(fd, (sx * 0.935, Y(0.36), 0.78), rz=0 if sx > 0 else math.pi)
    P(fd, 'hull', 'paint_dark', 1)
    V.bolt_row((sx * 1.05, Y(0.36) - 0.2, 0.78 + 0.05), (sx * 1.05, Y(0.36) + 0.2, 0.78 + 0.05), (sx, 0, 0), 0.1)
    P(B.cylinder('idler_crank', 0.1, 0.22, (sx * 1.0, Y(5.30), 0.60), 'X', 10), 'hull', 'paint_dark', 1)
    # fenders: flat run at track-top level, hinged front section sloping down, rear mud flap, brackets
    x0, x1 = sx * SUP_W, sx * FEN_W
    P(B.box('fender', (FEN_W - SUP_W + 0.02, 5.0, 0.012), ((x0 + x1) / 2, Y(2.95), 0.995), bevel=0.004, segs=1))
    P(T.side_prism('fender_front', [(Y(0.45), 0.99), (Y(0.45), 1.002), (Y(-0.0), 0.86), (Y(-0.0), 0.848)], x0, x1))
    T.hinge((x0, Y(0.45), 1.0), (x1, Y(0.45), 1.0))
    P(B.box('fender_lip', (0.012, 5.0, 0.04), (x1, Y(2.95), 0.98)), 'hull', 'paint', 1)
    P(B.box('mudflap', (FEN_W - SUP_W, 0.012, 0.22), ((x0 + x1) / 2, Y(5.46), 0.88)), 'hull', 'paint', 1)
    for s in (1.2, 2.4, 3.6, 4.8):
        P(B.box('fender_bracket', (0.28, 0.03, 0.08), ((x0 + x1) / 2, Y(s), 0.95)), 'hull', 'paint', 0)
    V.bolt_row((x1 - 0.03, Y(0.6), 1.0), (x1 - 0.03, Y(5.3), 1.0), (0, 0, 1), 0.3)
    V.weld((x0, Y(0.5), 1.0), (x0, Y(5.4), 1.0), n=(sx, 0, 1))
    if sx > 0 or not G:             # G: one Bosch headlamp (left); F2: two
        V.headlight((sx * 1.00, Y(0.62), 1.10), cover=True)
V.notek((1.28, Y(0.40), 0.98))
# fender stowage. left: extinguisher, spare links (G) / tow cable, jack block; right: shovel, pick, axe, crowbar,
# wire cutters, track tool box; tow cables along both superstructure sides with eye ends at the front
P(B.box('toolbox', (0.26, 0.62, 0.24), (1.29, Y(4.9), 1.12), bevel=0.012, segs=1))
P(B.box('toolbox_lid', (0.27, 0.63, 0.02), (1.29, Y(4.9), 1.245)), 'hull', 'paint', 0)
T.hinge((1.16, Y(4.62), 1.245), (1.16, Y(5.18), 1.245))
P(B.cylinder('extinguisher', 0.06, 0.55, (1.30, Y(1.6), 1.07), 'Y', 8), 'hull', 'red' if not G else 'paint', 1)
V.tool('jack', (1.24, Y(3.3), 1.07), (1.24, Y(3.8), 1.07))
P(B.box('jack_block', (0.22, 0.30, 0.10), (1.30, Y(4.2), 1.05)), 'hull', 'wood', 1)
V.tool('shovel', (-1.28, Y(0.9), 1.02), (-1.28, Y(2.1), 1.02))
P(B.cylinder('rod_tube', 0.05, 1.1, (-1.30, Y(2.75), 1.05), 'Y', 8), 'hull', 'paint', 1)   # gun cleaning rods
V.tool('axe', (-1.24, Y(3.3), 1.02), (-1.24, Y(4.0), 1.02))
V.tool('crowbar', (-1.36, Y(3.4), 1.02), (-1.36, Y(5.0), 1.02))
V.tool('wire_cutter', (-1.2, Y(4.3), 1.03), (-1.2, Y(4.9), 1.03))
for sx in (-1, 1):                  # tow cables clipped along the superstructure sides
    V.tool('cable', (sx * (SUP_W + 0.03), Y(1.7), 1.18), (sx * (SUP_W + 0.03), Y(4.8), 1.18), up=(sx, 0, 0))
    P(B.cylinder('cable_eye', 0.06, 0.025, (sx * (SUP_W + 0.03), Y(1.62), 1.18), 'X', 8), 'hull', 'steel', 1)
V.antenna((-1.02, Y(3.6), ROOF), 2.0)
P(B.box('ant_trough', (0.1, 2.3, 0.08), (-1.20, Y(2.5), 1.10)), 'hull', 'wood', 1)
if not G:                           # F2: two spare road wheels in holders on the upper rear plate
    for sx in (-1, 1):
        o = V.road_wheel2('spare_rw', R_RW, 0.085, 0.09, segs=8)
        V._xf(o, (sx * 0.78, Y(5.70), 1.20), rz=math.pi / 2 * (1 if sx > 0 else -1))
        P(V.set_mats(o, ['paint', 'rubber']), 'hull', ['paint', 'rubber'], 1)
        P(B.box('rw_holder', (0.05, 0.06, 0.34), (sx * 0.78, Y(5.63), 1.20)), 'hull', 'steel', 0)

# ------------------------------------------------------------------ turret (traverse node, offset 67 mm left)
TX, TS, Z0, Z1, F = 0.067, 2.46, 1.68, 2.30, 1.62
node('turret', (TX, Y(TS), ROOF), 'hull', 'turret', (0, 0, 1), traverse_deg_s=14)
tp = lambda pts: [(TX + x, Y(F + s)) for x, s in pts]
base = tp([(0.56, 0.0), (0.88, 0.36), (0.88, 1.42), (0.64, 1.68), (-0.64, 1.68), (-0.88, 1.42), (-0.88, 0.36), (-0.56, 0.0)])[::-1]
roof = tp([(0.50, 0.11), (0.62, 0.44), (0.62, 1.40), (0.52, 1.60), (-0.52, 1.60), (-0.62, 1.40), (-0.62, 0.44), (-0.50, 0.11)])[::-1]
P(T.loft_z('turret_body', base, Z0, roof, Z1, bevel=0.01), 'turret')
P(B.cylinder('turret_collar', 0.90, 0.05, (TX, Y(TS), ROOF + 0.02), 'Z', 28), 'turret', 'paint')
P(B.cylinder('ring_guard', 0.98, 0.03, (TX, Y(TS), ROOF + 0.01), 'Z', 28), 'hull', 'paint', 1)
for a, b in zip(base, base[1:] + base[:1]):             # base / roof plate joints
    V.weld((a[0], a[1], Z0 + 0.01), (b[0], b[1], Z0 + 0.01))
for a, b in zip(roof, roof[1:] + roof[:1]):
    V.weld((a[0], a[1], Z1), (b[0], b[1], Z1))
for a, b in zip(base, roof):
    V.weld((a[0], a[1], Z0), (b[0], b[1], Z1))
V.bolt_row((TX - 0.45, Y(F + 0.3), Z1), (TX + 0.45, Y(F + 0.3), Z1), (0, 0, 1), 0.15)
V.bolt_row((TX - 0.45, Y(F + 1.2), Z1), (TX + 0.45, Y(F + 1.2), Z1), (0, 0, 1), 0.15)
fn = Vector((0, -0.62, 0.11)).normalized(); fu = Vector((0, 0.11, 0.62)).normalized()
# front visors: gunner (left) on both; loader (right) front + cheek visors only on the F2
for sx in ((1,) if G else (-1, 1)):
    T.vision_port((TX + sx * 0.42, Y(F + 0.035), 1.88), tuple(fn), 0.16, 0.08, 'turret')
    if not G:
        T.vision_port((TX + sx * 0.72, Y(F + 0.2), 1.88), (sx * 0.75, -0.62, 0.25), 0.14, 0.07, 'turret')
for sx in (-1, 1):
    T.lift_hook((TX + sx * 0.46, Y(F + 0.35), Z1), 'turret'); T.lift_hook((TX + sx * 0.45, Y(F + 1.5), Z1), 'turret')
    P(B.cylinder('pistol_port', 0.05, 0.03, (TX + sx * 0.5, Y(F + 1.66), 1.86), 'Y', 8), 'turret', 'paint', 0)
# side doors (two halves each side) on the sloped side plates; front half hinged at the front edge
side_n = Vector((0.62, 0, 0.27)).normalized()
for sx, S in ((1, 'L'), (-1, 'R')):
    n = Vector((sx * side_n.x, 0, side_n.z))
    up = Vector((-sx * 0.27, 0, 0.62)).normalized()
    def on_side(s, z):          # point on the side plate at station s (from F), height z
        t = (z - Z0) / (Z1 - Z0)
        return Vector((TX + sx * (0.88 - 0.26 * t), Y(F + s), z))
    for half, s0, s1, hs in (('f', 0.62, 0.92, 0.62), ('r', 0.92, 1.22, 1.22)):
        nm = f'hatch_side_{S}_{half}'
        hp = on_side(hs, 1.95)
        node(nm, tuple(hp), 'turret', 'hatch', tuple(up), open_deg=(100 if half == 'f' else -100) * sx)
        c = on_side((s0 + s1) / 2, 1.95)
        P(T.plate_on(nm, c, Vector((0, sx, 0)), up, s1 - s0 - 0.015, 0.44, 0.03, 0.006), nm, 'paint')
        T.vision_port(tuple(on_side((s0 + s1) / 2, 2.05) + n * 0.03), tuple(n), 0.12, 0.06, nm)
        T.hinge(tuple(on_side(hs, 1.78) + n * 0.03), tuple(on_side(hs, 2.12) + n * 0.03), 'turret')
        P(B.box('door_grip', (0.03, 0.03, 0.1), tuple(on_side((s0 + s1) / 2 + (0.1 if half == 'f' else -0.1), 1.9) + n * 0.04)), nm, 'steel', 0)
    if not G:                       # F2: number across the side doors, below the visors
        V.decal('num:614:r', tuple(on_side(0.92, 1.84)), tuple(n), tuple(up), 0.40, 0.20, 'turret')
# cupola (rear centre, overhanging the rear plate): drum, 5 vision blocks with sliding armour shutters, split lids
CX, CS = TX, F + 1.40
P(B.cylinder('cupola', 0.34, 0.25, (CX, Y(CS), Z1 + 0.125), 'Z', 20, bevel=0.01), 'turret')
P(B.cylinder('cupola_ring', 0.37, 0.05, (CX, Y(CS), Z1 + 0.025), 'Z', 20), 'turret')
V.weld((CX - 0.5, Y(CS - 0.1), Z1), (CX + 0.5, Y(CS - 0.1), Z1))
for i in range(5):
    a = math.radians(-90 + i * 72)
    d = Vector((math.cos(a), math.sin(a), 0))
    p = Vector((CX, Y(CS), Z1 + 0.14)) + d * 0.34
    P(B.box('cup_block', (0.12, 0.03, 0.07), tuple(p), rot=('Z', math.degrees(a) + 90)), 'turret', 'glass', 1)
    P(B.box('cup_visor', (0.16, 0.04, 0.03), tuple(p + d * 0.02 + Vector((0, 0, 0.06))), rot=('Z', math.degrees(a) + 90)), 'turret', 'paint', 1)
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'hatch_cmdr_{S}'
    node(nm, (CX + sx * 0.26, Y(CS), Z1 + 0.265), 'turret', 'hatch', (0, 1, 0), open_deg=sx * 105)
    lid = B.cylinder(nm, 0.27, 0.035, (CX, Y(CS), Z1 + 0.27), 'Z', 20)
    import bmesh as _bm
    bm = _bm.new(); bm.from_mesh(lid.data)
    _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(CX, 0, 0), plane_no=(sx, 0, 0), clear_inner=True)
    _bm.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(lid.data); bm.free()
    P(lid, nm, 'paint')
    P(B.box('lid_grip', (0.03, 0.14, 0.03), (CX + sx * 0.12, Y(CS), Z1 + 0.30)), nm, 'steel', 0)
# roof: ventilator dome (front right), signal-port flap (left), gun-sight hood
P(B.cylinder('vent_dome', 0.11, 0.06, (TX - 0.22, Y(F + 0.45), Z1 + 0.03), 'Z', 10, r2=0.07), 'turret', 'paint', 1)
P(B.cylinder('signal_port', 0.07, 0.05, (TX + 0.26, Y(F + 0.62), Z1 + 0.025), 'Z', 8), 'turret', 'paint', 1)
V.bolt_row((TX - 0.33, Y(F + 0.45), Z1), (TX - 0.11, Y(F + 0.45), Z1), (0, 0, 1), 0.055)
if G:   # Rommelkiste: stowage bin on the turret rear, on two brackets, hinged lid with two clasps
    RB = F + 1.70
    P(B.box('rommelkiste', (1.24, 0.44, 0.40), (TX, Y(RB + 0.24), 1.95), bevel=0.025, segs=2), 'turret', 'paint')
    P(B.box('bin_lid', (1.26, 0.46, 0.03), (TX, Y(RB + 0.24), 2.16), bevel=0.01, segs=1), 'turret', 'paint', 1)
    for dx in (-0.4, 0.4):
        P(B.box('bin_bracket', (0.06, 0.12, 0.3), (TX + dx, Y(RB + 0.0), 1.92)), 'turret', 'paint', 1)
        P(B.box('bin_clasp', (0.05, 0.02, 0.08), (TX + dx, Y(RB + 0.47), 2.1)), 'turret', 'steel', 0)
    T.hinge((TX - 0.55, Y(RB + 0.02), 2.17), (TX + 0.55, Y(RB + 0.02), 2.17), 'turret')
    V.plate_edge((TX - 0.6, Y(RB + 0.46), 1.95), (TX + 0.6, Y(RB + 0.46), 1.95), (0, 1, 0), 0.02)
    V.bolt_row((TX - 0.58, Y(RB + 0.465), 1.78), (TX + 0.58, Y(RB + 0.465), 1.78), (0, 1, 0), 0.145)
    for sx in (-1, 1):              # tactical number on the bin sides + rear (common G practice)
        V.decal('num:421:r', (TX + sx * 0.62, Y(RB + 0.24), 1.95), (sx, 0, 0), (0, 0, 1), 0.36, 0.18, 'turret')
    V.decal('num:421:r', (TX, Y(RB + 0.46), 1.92), (0, 1, 0), (0, 0, 1), 0.44, 0.22, 'turret')
V.socket('commander', (CX, Y(CS), Z1 + 0.3), 'turret', pose='cupola_standing')
V.socket('loader_hatch', (TX - 0.84, Y(F + 0.92), 1.95), 'turret')
V.socket('driver', (0.70, Y(1.30), ROOF), 'hull', pose='hatch_seated')
V.socket('radio_op', (-0.70, Y(1.30), ROOF), 'hull', pose='hatch_seated')
for i, (x, s) in enumerate(((0.5, 4.3), (-0.5, 4.3), (0.5, 5.1), (-0.5, 5.1))):
    V.socket(f'rider_{i + 1}', (x, Y(s), DECK), 'hull', pose='deck_seated')

# ------------------------------------------------------------------ gun: external mantlet + KwK 40 L/43
# (elevation node at the trunnions; brake tip at station -0.70 -> 6.62 m overall; breech face at 2.75, in the turret)
GZ, GS, TIP = 1.99, 1.80, -0.70
node('gun', (TX, Y(GS), GZ), 'turret', 'gun', (1, 0, 0), elev_min=-8, elev_max=20)
P(B.box('mantlet', (0.86, 0.12, 0.44), (TX, Y(1.555), GZ), bevel=0.03, segs=2), 'gun')
P(B.box('mantlet_cheek', (0.30, 0.10, 0.30), (TX - 0.02, Y(1.47), GZ), bevel=0.03, segs=1), 'gun')
V.bolt_row((TX - 0.38, Y(1.495), GZ + 0.17), (TX + 0.38, Y(1.495), GZ + 0.17), (0, -1, 0), 0.095)
V.bolt_row((TX - 0.38, Y(1.495), GZ - 0.17), (TX + 0.38, Y(1.495), GZ - 0.17), (0, -1, 0), 0.095)
P(B.cylinder('sleeve', 0.085, 0.30, (TX, Y(1.27), GZ), 'Y', 14, bevel=0.008), 'gun')
P(B.cylinder('sleeve_ring', 0.095, 0.04, (TX, Y(1.40), GZ), 'Y', 14), 'gun')
brake_len = 0.23
b0 = TIP + brake_len                      # brake rear face
P(B.cylinder('barrel', 0.052, 1.12 - b0, (TX, Y((1.12 + b0) / 2), GZ), 'Y', 12, r2=0.046), 'gun')
P(B.cylinder('barrel_collar', 0.058, 0.05, (TX, Y(b0 + 0.02), GZ), 'Y', 12), 'gun', 'paint', 1)
if G:      # double-baffle brake: rear collar, three baffle plates, top/bottom bridges, dark side windows
    P(B.cylinder('mb_core', 0.052, brake_len, (TX, Y(TIP + brake_len / 2), GZ), 'Y', 12), 'gun', 'black')
    for s, ln in ((b0 - 0.02, 0.04), (TIP + 0.13, 0.035), (TIP + 0.02, 0.04)):
        P(B.cylinder('mb_baffle', 0.098, ln, (TX, Y(s), GZ), 'Y', 14), 'gun')
    for dz in (-1, 1):
        P(B.box('mb_bridge', (0.12, brake_len - 0.02, 0.03), (TX, Y(TIP + brake_len / 2), GZ + dz * 0.082)), 'gun')
else:      # F2: single-chamber ball brake
    ball = B.lathe('mb_ball', [(0.0, 0.10), (0.05, 0.10), (0.085, 0.06), (0.095, 0.0), (0.085, -0.06), (0.05, -0.10), (0.0, -0.10)], segs=14, axis='Y')
    P(V._xf(ball, (TX, Y(TIP + 0.10), GZ)), 'gun')
    for sx in (-1, 1):
        P(B.box('mb_port', (0.02, 0.07, 0.08), (TX + sx * 0.088, Y(TIP + 0.10), GZ)), 'gun', 'black', 1)
P(B.cylinder('bore', 0.038, 0.012, (TX, Y(TIP - 0.002), GZ), 'Y', 10), 'gun', 'black', 1)
# breech + recoil guard inside the turret (hidden; gives the full 3.4 m gun length for recoil / damage anims)
P(B.box('breech', (0.30, 0.55, 0.30), (TX, Y(2.47), GZ)), 'gun', 'gunmetal', 0)
P(B.box('recoil_guard', (0.36, 0.60, 0.05), (TX + 0.05, Y(2.20), GZ - 0.2)), 'gun', 'gunmetal', 0)
V.muzzle('main_gun', (TX, Y(TIP - 0.01), GZ), 'gun', (0, -1, 0), '75mm_kwk40', caliber=0.075)
mz = V.mg('mg34', (TX - 0.22, Y(2.35), GZ - 0.03), 'gun', full=False, jacket_only=True)
V.muzzle('coax_mg', mz, 'gun', (0, -1, 0), 'mg34')
V.muzzle('hull_mg', mz_hull, 'hull', (0, -1, 0), 'mg34')
P(B.box('sight_port', (0.06, 0.02, 0.05), (TX + 0.20, Y(1.49), GZ + 0.07)), 'gun', 'black', 1)

# ------------------------------------------------------------------ markings: Balkenkreuz on hull sides + rear
for sx in (-1, 1):
    V.decal('bk', (sx * SUP_W, Y(2.75), 1.42), (sx, 0, 0), (0, 0, 1), 0.36, 0.36)
V.decal('bk', (-0.62, Y(5.605), 1.18), (0, 1, 0.05), (0, 0, 1), 0.28, 0.28)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.1), dist=13, elev=32, azim=-40, lens=50)
    sys.exit(0)

V.finalize(2048, dims=dict(length_hull=5.92, length_with_gun=6.62, width=2.88, height=2.68, track_width=0.40,
                            ground_clearance=0.40, weight_t=23.5 if G else 23.0),
           burnt_pose={'turret': dict(rot=(0, 1.5, 17)), 'gun': dict(rot=(-7, 0, 0)), 'hatch_cmdr_L': dict(rot=(0, 105, 0)),
                       'hatch_side_L_f': dict(rot=(0, 0, 70)), 'hatch_driver': dict(rot=(0, -100, 0)),
                       'hull': dict(off=(0, 0, -0.03))},
           burnt_drop=('shovel', 'pick', 'axe', 'blade', 'head', 'cable', 'antenna', 'ant_', 'toolbox', 'extinguisher', 'lens',
                       'bo_cover', 'smoke_candle', 'mudflap', 'jerrycan', 'bin_lid', 'jack_block', 'wire_cutter'),
           track_style='kgs',
           info=dict(model='Panzerkampfwagen IV Ausf. ' + ('G' if G else 'F2'), crew=5, main_gun='7.5 cm KwK 40 L/43',
                     muzzle_brake='double-baffle' if G else 'single-chamber ball',
                     mg='2x MG 34 (coax, hull Kugelblende 50)', era='1942',
                     identifiers=('Rommelkiste, single headlamp, gunner-side turret visor only, spare links on nose + '
                                  'left fender' if G else 'ball brake, twin headlamps, both turret front + cheek visors, '
                                  'KFF2 periscope holes, smoke-candle rack, spare road wheels on the rear plate'),
                     sources='vehicles/refs/armour/urls.json'))
