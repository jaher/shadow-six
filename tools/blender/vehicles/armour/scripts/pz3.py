# pz3.py - Panzerkampfwagen III.
#  'l' = Ausf. L (mid 1942): 5 cm KwK 39 L/60, 20 mm Vorpanzer spaced plates on the mantlet and on the driver's front
#        plate (brackets, cut-outs for visor + Kugelblende), headlamp on the glacis, Notek on the left fender.
#  'j' = Ausf. J (early 1942, as issued before the J1/L upgrade): short 5 cm KwK 38 L/42, no spaced plates, twin
#        fender headlamps, turret-side vision ports on both doors, holed-disc idler.
# Silhouette cues vs the Pz IV: shorter wider hull, 6 large (520 mm) twin road wheels on torsion-bar swing arms with
# shock absorbers on the end stations, 3 return rollers, low wide turret with a sloped front roof plate and a rear
# overhang carrying the Gepaeckkasten stowage bin, raised louvred side intakes on the engine deck, transverse muffler.
# Dimensions: hull 5.52 m (incl. muffler), 6.28 m with the L/60 gun (J: 5.52 m), width 2.95 m, height 2.50 m.
# Run: blender -b --factory-startup --python-use-system-env --python pz3.py -- [l|j] [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
AUSF = argv[0] if argv else 'l'
PREVIEW = 'preview' in argv
L = AUSF == 'l'
NAME = 'panzer3_' + AUSF
V.begin(NAME, seed=3 if L else 7)
Y = lambda s: s - 2.76            # station from the front (m) -> Blender Y

# ------------------------------------------------------------------ lower hull
T_W, SUP_W, FEN_W, ROOF, DECK = 0.95, 1.17, 1.475, 1.60, 1.53
low = [(Y(0.55), 0.39), (Y(4.95), 0.39), (Y(5.30), 0.55), (Y(5.32), 1.0), (Y(0.92), 1.0), (Y(0.92), 1.08),
       (Y(0.10), 0.88), (Y(0.05), 0.64)]
P(T.side_prism('lower_hull', low, -T_W, T_W, bevel=0.01), uv=0.6)
for s0, z0, s1, z1 in ((0.05, 0.64, 0.10, 0.88), (0.10, 0.88, 0.92, 1.08), (0.55, 0.39, 0.05, 0.64)):
    for sx in (-1, 1):
        V.weld((sx * T_W, Y(s0), z0), (sx * T_W, Y(s1), z1))
    V.weld((-T_W, Y(s0), z0), (T_W, Y(s0), z0))
V.bolt_row((-0.8, Y(0.08), 0.85), (0.8, Y(0.08), 0.85), (0, -1, 0.2), 0.16)
# glacis: two large brake-access hatches with central ventilator cowls, hinged at the front
gv = Vector((0, 0.82, 0.20)).normalized(); gn = Vector((0, -gv.z, gv.y))
for sx in (-1, 1):
    c = Vector((sx * 0.45, Y(0.52), 0.985))
    P(T.plate_on('brake_hatch', c, (1, 0, 0), gv, 0.70, 0.60, 0.022, 0.006), 'hull', 'paint', 1)
    T.hinge((sx * 0.15, Y(0.20), 0.915), (sx * 0.75, Y(0.20), 0.915))
    P(T.plate_on('vent_cowl', c + gv * 0.08 + gn * 0.035, (1, 0, 0), gv, 0.26, 0.22, 0.07, 0.025), 'hull', 'paint', 1)
    V.bolt_row(c - gv * 0.27 + gn * 0.022 - Vector((0.3, 0, 0)), c - gv * 0.27 + gn * 0.022 + Vector((0.3, 0, 0)), gn, 0.1)
    P(B.box('hatch_handle', (0.12, 0.025, 0.03), tuple(c + gv * 0.25 + gn * 0.035)), 'hull', 'steel', 0)
    T.tow_shackle((sx * 0.60, Y(0.02), 0.56), rz=math.pi / 2)
    T.tow_shackle((sx * 0.60, Y(5.34), 0.66), rz=math.pi / 2)
# spare links on the nose plate
V.spare_links((0, Y(0.05), 0.76), 10, pitch=0.12, width=0.40, rz=math.pi / 2, ry=-(math.pi / 2 - 0.2))
P(B.box('link_rack', (1.3, 0.04, 0.05), (0, Y(0.06), 0.90)), 'hull', 'steel', 1)

# ------------------------------------------------------------------ superstructure (full width over the tracks)
FRONT = 0.92
sup = [(Y(FRONT - 0.02), 1.0), (Y(5.30), 1.0), (Y(5.30), 1.46), (Y(4.95), DECK), (Y(3.40), DECK), (Y(3.36), ROOF),
       (Y(FRONT), ROOF)]
P(T.side_prism('superstructure', sup, -SUP_W, SUP_W, bevel=0.008))
for sx in (-1, 1):
    V.weld((sx * SUP_W, Y(FRONT), 1.0), (sx * SUP_W, Y(FRONT), ROOF))
    V.weld((sx * SUP_W, Y(FRONT), ROOF), (sx * SUP_W, Y(3.36), ROOF))
    V.weld((sx * SUP_W, Y(1.0), 1.0), (sx * SUP_W, Y(5.3), 1.0))
    V.bolt_row((sx * (SUP_W - 0.05), Y(1.0), ROOF), (sx * (SUP_W - 0.05), Y(3.3), ROOF), (0, 0, 1), 0.18)
V.weld((-SUP_W, Y(FRONT), ROOF), (SUP_W, Y(FRONT), ROOF))
V.bolt_row((-1.0, Y(FRONT + 0.08), ROOF), (1.0, Y(FRONT + 0.08), ROOF), (0, 0, 1), 0.2)
# driver front plate: Fahrersehklappe 50 (left), Kugelblende 50 (right)
vp = Vector((0.50, Y(FRONT), 1.36)); bc = Vector((-0.48, Y(FRONT), 1.30))
P(B.box('visor_frame', (0.40, 0.03, 0.2), tuple(vp + Vector((0, -0.015, 0)))), 'hull', 'paint', 1)
P(B.box('visor_block', (0.30, 0.07, 0.12), tuple(vp + Vector((0, -0.05, 0))), bevel=0.015, segs=1), 'hull', 'paint', 1)
P(B.box('visor_slit', (0.20, 0.01, 0.012), tuple(vp + Vector((0, -0.09, 0)))), 'hull', 'black', 1)
col = B.lathe('kb_collar', [(0.16, 0.0), (0.2, 0.0), (0.2, -0.04), (0.16, -0.06)], segs=12, axis='Y')
P(V._xf(col, bc), 'hull', 'paint', 1)
ball = B.lathe('kugelblende', [(0.0, -0.13), (0.07, -0.12), (0.13, -0.06), (0.15, 0.0), (0.0, 0.02)], segs=12, axis='Y')
P(V._xf(ball, bc), 'hull', 'paint', 2)
mz_hull = V.mg('mg34', (bc.x, Y(FRONT + 0.62), bc.z), 'hull', full=False, jacket_only=True)
if L:   # 20 mm Vorpanzer on four brackets ~0.1 m ahead of the driver plate, cut-outs for visor + ball mount
    SP = FRONT - 0.11
    for (x0, x1) in ((-1.05, -0.70), (-0.26, 0.32), (0.70, 1.05)):
        P(B.box('spaced_plate', (x1 - x0, 0.02, 0.50), ((x0 + x1) / 2, Y(SP), 1.33)), 'hull', 'paint')
    for (x0, x1, z0, z1) in ((-0.70, -0.26, 1.08, 1.13), (-0.70, -0.26, 1.48, 1.58), (0.32, 0.70, 1.08, 1.29), (0.32, 0.70, 1.43, 1.58)):
        P(B.box('spaced_plate', (x1 - x0, 0.02, z1 - z0), ((x0 + x1) / 2, Y(SP), (z0 + z1) / 2)), 'hull', 'paint')
    for x in (-0.9, -0.1, 0.1, 0.9):
        P(B.box('spacer', (0.06, 0.10, 0.08), (x, Y(SP + 0.055), 1.52)), 'hull', 'paint', 0)
        P(B.box('spacer', (0.06, 0.10, 0.08), (x, Y(SP + 0.055), 1.14)), 'hull', 'paint', 0)
        V.bolt_row((x, Y(SP - 0.012), 1.50), (x, Y(SP - 0.012), 1.16), (0, -1, 0), 0.34)
    V.bolt_row((-1.0, Y(SP - 0.012), 1.56), (1.0, Y(SP - 0.012), 1.56), (0, -1, 0), 0.25)
for sx in (-1, 1):
    T.vision_port((sx * SUP_W, Y(1.30), 1.38), (sx, 0, 0), 0.24, 0.10)
    T.lift_hook((sx * 1.08, Y(1.0), ROOF)); T.lift_hook((sx * 1.08, Y(5.1), DECK))
# side escape hatches in the superstructure sides (Ausf. J / L), hinged at the top
for sx in (-1, 1):
    P(T.plate_on('escape_hatch', (sx * SUP_W, Y(2.45), 1.22), (0, -sx, 0), (0, 0, 1), 0.62, 0.34, 0.03, 0.008), 'hull', 'paint', 1)
    T.hinge((sx * (SUP_W + 0.03), Y(2.20), 1.40), (sx * (SUP_W + 0.03), Y(2.70), 1.40))
    P(B.box('esc_handle', (0.03, 0.12, 0.025), (sx * (SUP_W + 0.04), Y(2.45), 1.12)), 'hull', 'steel', 0)
# engine deck: two large hinged hatches, raised louvred side intakes, rear sloping outlet grilles
for sx in (-1, 1):
    P(B.box('engine_hatch', (0.64, 1.10, 0.03), (sx * 0.38, Y(4.05), DECK + 0.015), bevel=0.008, segs=1), 'hull', 'paint')
    T.hinge((sx * 0.07, Y(3.55), DECK + 0.035), (sx * 0.07, Y(4.55), DECK + 0.035))
    P(B.box('deck_handle', (0.14, 0.025, 0.04), (sx * 0.55, Y(4.4), DECK + 0.05)), 'hull', 'steel', 0)
    P(V.hexa('intake', [(sx * 0.83, Y(3.5), DECK), (sx * 1.14, Y(3.5), DECK), (sx * 1.14, Y(4.75), DECK), (sx * 0.83, Y(4.75), DECK),
                         (sx * 0.86, Y(3.6), DECK + 0.13), (sx * 1.12, Y(3.6), DECK + 0.13), (sx * 1.12, Y(4.65), DECK + 0.13),
                         (sx * 0.86, Y(4.65), DECK + 0.13)], bevel=0.01), 'hull', 'paint')
    T.grille((sx * 0.99, Y(4.12), DECK + 0.13), 0.22, 0.95, 6, along='Y')
    rg = Vector((0, 0.35, -0.07)).normalized()
    P(T.plate_on('outlet_grille', (sx * 0.5, Y(5.12), 1.495), (1, 0, 0), rg, 0.8, 0.30, 0.02), 'hull', 'black', 1)
    for k in range(5):
        P(T.plate_on('outlet_slat', Vector((sx * 0.5, Y(4.99 + k * 0.065), 1.52 - k * 0.013)), (1, 0, 0), (0, 0.5, 0.86), 0.78, 0.05, 0.012), 'hull', 'paint', 0)
V.weld((-SUP_W, Y(3.40), DECK), (SUP_W, Y(3.40), DECK))
V.plate_edge((0, Y(3.5), DECK + 0.004), (0, Y(4.9), DECK + 0.004), (0, 0, 1), 0.06)
# rear: transverse muffler, twin exhaust stubs, smoke-candle rack, tail light, towing pintle
P(B.cylinder('muffler', 0.15, 1.5, (0, Y(5.36), 0.78), 'X', 12, bevel=0.015), 'hull', 'steel')
for dx in (-0.55, 0.55):
    P(B.box('muffler_strap', (0.035, 0.32, 0.34), (dx, Y(5.36), 0.78)), 'hull', 'paint', 0)
    P(B.cylinder('exhaust', 0.04, 0.16, (dx * 0.6, Y(5.42), 0.99), 'Z', 8), 'hull', 'steel', 1)
P(B.box('smoke_rack', (0.56, 0.14, 0.13), (0.0, Y(5.34), 1.36), bevel=0.01, segs=1), 'hull', 'paint', 1)
for i in range(5):
    D(B.cylinder('smoke_candle', 0.035, 0.14, (-0.2 + i * 0.1, Y(5.35), 1.46), 'Z', 8), 'steel')
P(B.box('tail_light', (0.1, 0.06, 0.08), (0.85, Y(5.34), 1.20), bevel=0.01, segs=1), 'hull', 'red', 1)
P(B.box('pintle', (0.14, 0.12, 0.1), (0, Y(5.36), 0.55)), 'hull', 'steel', 1)
V.bolt_row((-0.95, Y(5.315), 1.30), (0.95, Y(5.315), 1.30), (0, 1, 0), 0.19)
V.emitter('exhaust_main', (0.33, Y(5.42), 1.08), 'hull', (0, 0.2, 1), 'exhaust')
V.emitter('exhaust_muffler', (-0.33, Y(5.42), 1.08), 'hull', (0, 0.2, 1), 'exhaust')

# ------------------------------------------------------------------ running gear: torsion bars, 6 twin wheels
XC, R_RW, THK = 1.26, 0.26, 0.05
rw = V.set_mats(V.road_wheel2('rw', R_RW, 0.09, 0.08, segs=10, cap=0.065), ['paint', 'rubber'])
spr = V.set_mats(V.sprocket2('spr', 0.36, 0.30, teeth=21), ['paint', 'black'])
if L:
    idl = V.set_mats(V.spoked_idler('idl', 0.30, 0.22, spokes=8), ['paint'])
else:
    idl = V.set_mats(V.sprocket2('idl', 0.30, 0.22, teeth=0, holes=8), ['paint', 'black'])
rol = V.set_mats(V.return_roller('rol', 0.13, 0.17), ['paint', 'rubber'])
ST = (0.98, 1.66, 2.34, 3.02, 3.70, 4.38)
road = [(Y(s), R_RW + THK) for s in ST]
V.running_gear(XC, road, dict(ob=rw, r=R_RW), (Y(0.42), 0.80, 0.31), dict(ob=spr, r=0.36), (Y(5.02), 0.62, 0.26),
               dict(ob=idl, r=0.30), rollers=[(Y(s), 0.87, 0.13) for s in (1.30, 2.68, 4.05)],
               roll_src=dict(ob=rol, r=0.13), track_w=0.40, thick=THK, pitch=0.12, sag=0.035)
for sx in (-1, 1):
    for i, s in enumerate(ST):      # trailing swing arm from the torsion-bar hub, bump stop above
        piv = Vector((sx * 1.02, Y(s - 0.30), 0.50)); hub = Vector((sx * 1.05, Y(s), R_RW + THK))
        P(B.beam('swing_arm', piv, hub, 0.08, 0.07), 'hull', 'paint_dark', 1)
        P(B.cylinder('tb_hub', 0.075, 0.08, tuple(piv), 'X', 8), 'hull', 'paint_dark', 1)
        V.bolt_row(piv + Vector((sx * 0.04, 0, 0.05)), piv + Vector((sx * 0.04, 0, -0.05)), (sx, 0, 0), 0.05)
        P(B.box('bumpstop', (0.08, 0.1, 0.07), (sx * 0.99, Y(s + 0.08), 0.62)), 'hull', 'paint_dark', 0)
        if i in (0, 5):             # shock absorbers on the first and last stations
            a = Vector((sx * 1.0, Y(s + (0.25 if i == 0 else -0.35)), 0.82))
            P(B.beam('shock', a, piv.lerp(hub, 0.6) + Vector((0, 0, 0.03)), 0.07, 0.07), 'hull', 'paint_dark', 1)
    fd = B.lathe('final_drive', [(0.24, 0.0), (0.24, 0.1), (0.2, 0.16), (0.12, 0.2), (0.0, 0.21)], segs=12, axis='X')
    P(V._xf(fd, (sx * T_W, Y(0.42), 0.80), rz=0 if sx > 0 else math.pi), 'hull', 'paint_dark', 1)
    P(B.cylinder('idler_crank', 0.1, 0.2, (sx * 1.05, Y(5.02), 0.62), 'X', 10), 'hull', 'paint_dark', 1)
    # fenders at track-top level, front sections sloped down to the nose, rear flaps
    x0, x1 = sx * SUP_W, sx * FEN_W
    P(B.box('fender', (FEN_W - SUP_W + 0.02, 4.75, 0.012), ((x0 + x1) / 2, Y(2.88), 0.995), bevel=0.004, segs=1))
    P(T.side_prism('fender_front', [(Y(0.50), 0.99), (Y(0.50), 1.002), (Y(0.02), 0.84), (Y(0.02), 0.828)], x0, x1))
    T.hinge((x0, Y(0.50), 1.0), (x1, Y(0.50), 1.0))
    P(B.box('fender_lip', (0.012, 4.75, 0.04), (x1, Y(2.88), 0.98)), 'hull', 'paint', 1)
    P(B.box('mudflap', (FEN_W - SUP_W, 0.012, 0.2), ((x0 + x1) / 2, Y(5.24), 0.89)), 'hull', 'paint', 1)
    for s in (1.1, 2.2, 3.3, 4.4):
        P(B.box('fender_bracket', (0.28, 0.03, 0.08), ((x0 + x1) / 2, Y(s), 0.95)), 'hull', 'paint', 0)
    V.bolt_row((x1 - 0.03, Y(0.6), 1.0), (x1 - 0.03, Y(5.1), 1.0), (0, 0, 1), 0.3)
    V.weld((x0, Y(0.6), 1.0), (x0, Y(5.2), 1.0), n=(sx, 0, 1))
    if not L:                       # J: twin Bosch headlamps on the front fenders
        V.headlight((sx * 1.05, Y(0.62), 1.10), cover=True)
if L:                               # L: single headlamp moved onto the glacis, Notek on the left fender
    V.headlight((0.78, Y(0.30), 1.02), cover=True)
V.notek((1.32, Y(0.45), 0.98))
# stowage: left fender = jack + block, extinguisher, shovel; right fender = tool box, pick, crowbar, wire cutter;
# antenna on the right rear with the wooden antenna trough along the right superstructure side
V.tool('jack', (1.30, Y(3.4), 1.07), (1.30, Y(3.9), 1.07))
P(B.box('jack_block', (0.22, 0.30, 0.10), (1.32, Y(4.3), 1.05)), 'hull', 'wood', 1)
P(B.cylinder('extinguisher', 0.06, 0.55, (1.32, Y(1.4), 1.07), 'Y', 8), 'hull', 'paint', 1)
V.tool('shovel', (1.30, Y(2.0), 1.02), (1.30, Y(3.2), 1.02))
P(B.box('toolbox', (0.26, 0.60, 0.22), (-1.32, Y(4.6), 1.11), bevel=0.012, segs=1))
P(B.box('toolbox_lid', (0.27, 0.61, 0.02), (-1.32, Y(4.6), 1.225)), 'hull', 'paint', 0)
V.tool('axe', (-1.30, Y(1.0), 1.02), (-1.30, Y(1.7), 1.02))
V.tool('crowbar', (-1.36, Y(1.9), 1.02), (-1.36, Y(3.4), 1.02))
V.tool('wire_cutter', (-1.26, Y(3.6), 1.03), (-1.26, Y(4.2), 1.03))
P(B.box('ant_trough', (0.1, 2.4, 0.08), (-1.21, Y(2.4), 1.10)), 'hull', 'wood', 1)
V.antenna((-1.05, Y(4.9), DECK), 2.0)
for sx in (-1, 1):
    V.tool('cable', (sx * (SUP_W + 0.03), Y(3.0), 1.30), (sx * (SUP_W + 0.03), Y(5.0), 1.30), up=(sx, 0, 0))

# ------------------------------------------------------------------ turret: low, wide, sloped front roof, rear bin
TX, TS, Z0, Z1, F = 0.0, 2.44, 1.62, 2.20, 1.55
node('turret', (TX, Y(TS), ROOF), 'hull', 'turret', (0, 0, 1), traverse_deg_s=14)
tp = lambda pts: [(TX + x, Y(F + s)) for x, s in pts]
base = tp([(0.62, 0.0), (0.86, 0.30), (0.86, 1.40), (0.66, 1.72), (-0.66, 1.72), (-0.86, 1.40), (-0.86, 0.30), (-0.62, 0.0)])[::-1]
roof = tp([(0.52, 0.12), (0.59, 0.38), (0.59, 1.38), (0.50, 1.64), (-0.50, 1.64), (-0.59, 1.38), (-0.59, 0.38), (-0.52, 0.12)])[::-1]
tb = T.loft_z('turret_body', base, Z0, roof, Z1)
import bmesh
bm = bmesh.new(); bm.from_mesh(tb.data)                 # lower the front roof edge -> sloped front roof plate
top = [v for v in bm.verts if abs(v.co.z - Z1) < 1e-4]
for v in top:
    if v.co.y < Y(F + 0.2):
        v.co.z -= 0.10
fold = [v for v in top if abs(v.co.y - Y(F + 0.38)) < 1e-3]
bmesh.ops.connect_verts(bm, verts=fold)
bm.to_mesh(tb.data); bm.free()
B.add_bevel(tb, 0.01, 1, angle=25)
P(tb, 'turret')
P(B.cylinder('turret_collar', 0.82, 0.05, (TX, Y(TS), ROOF + 0.02), 'Z', 28), 'turret', 'paint')
P(B.cylinder('ring_guard', 0.90, 0.03, (TX, Y(TS), ROOF + 0.01), 'Z', 28), 'hull', 'paint', 1)
for a, b in zip(base, base[1:] + base[:1]):
    V.weld((a[0], a[1], Z0 + 0.01), (b[0], b[1], Z0 + 0.01))
for a, b in zip(base, roof):
    V.weld((a[0], a[1], Z0), (b[0], b[1], Z1 - (0.1 if b[1] < Y(F + 0.2) else 0)))
V.weld((TX - 0.59, Y(F + 0.38), Z1), (TX + 0.59, Y(F + 0.38), Z1))
V.bolt_row((TX - 0.45, Y(F + 0.5), Z1), (TX + 0.45, Y(F + 0.5), Z1), (0, 0, 1), 0.15)
V.bolt_row((TX - 0.45, Y(F + 1.2), Z1), (TX + 0.45, Y(F + 1.2), Z1), (0, 0, 1), 0.15)
fn = Vector((0, -0.58, 0.14)).normalized()
for sx in ((1,) if L else (-1, 1)):          # front visors either side of the mantlet (L: gunner side only)
    T.vision_port((TX + sx * 0.46, Y(F + 0.02), 1.86), tuple(fn), 0.15, 0.075, 'turret')
for sx in (-1, 1):
    T.lift_hook((TX + sx * 0.45, Y(F + 0.45), Z1), 'turret'); T.lift_hook((TX + sx * 0.45, Y(F + 1.5), Z1), 'turret')
# side doors (two halves each side); J: vision ports in all halves; L: loader (right) side ports deleted
side_n = Vector((0.58, 0, 0.27)).normalized()
for sx, S in ((1, 'L'), (-1, 'R')):
    n = Vector((sx * side_n.x, 0, side_n.z))
    up = Vector((-sx * 0.27, 0, 0.58)).normalized()
    def on_side(s, z):
        t = (z - Z0) / (Z1 - Z0)
        return Vector((TX + sx * (0.86 - 0.27 * t), Y(F + s), z))
    for half, s0, s1, hs in (('f', 0.52, 0.82, 0.52), ('r', 0.82, 1.12, 1.12)):
        nm = f'hatch_side_{S}_{half}'
        node(nm, tuple(on_side(hs, 1.90)), 'turret', 'hatch', tuple(up), open_deg=(100 if half == 'f' else -100) * sx)
        P(T.plate_on(nm, on_side((s0 + s1) / 2, 1.90), Vector((0, sx, 0)), up, s1 - s0 - 0.015, 0.42, 0.03, 0.006), nm, 'paint')
        if not L or sx > 0:
            T.vision_port(tuple(on_side((s0 + s1) / 2, 1.99) + n * 0.03), tuple(n), 0.12, 0.06, nm)
        T.hinge(tuple(on_side(hs, 1.74) + n * 0.03), tuple(on_side(hs, 2.06) + n * 0.03), 'turret')
        P(B.box('door_grip', (0.03, 0.03, 0.1), tuple(on_side((s0 + s1) / 2 + (0.1 if half == 'f' else -0.1), 1.83) + n * 0.04)), nm, 'steel', 0)
    P(B.cylinder('pistol_port', 0.05, 0.03, tuple(on_side(1.30, 1.85) + n * 0.01), 'X', 8), 'turret', 'paint', 0)
# cupola (rear centre, overhanging), 5 vision blocks, split lids
CX, CS = TX, F + 1.38
P(B.cylinder('cupola', 0.33, 0.24, (CX, Y(CS), Z1 + 0.12), 'Z', 20, bevel=0.01), 'turret')
P(B.cylinder('cupola_ring', 0.36, 0.05, (CX, Y(CS), Z1 + 0.025), 'Z', 20), 'turret')
for i in range(5):
    a = math.radians(-90 + i * 72)
    d = Vector((math.cos(a), math.sin(a), 0))
    p = Vector((CX, Y(CS), Z1 + 0.13)) + d * 0.33
    P(B.box('cup_block', (0.12, 0.03, 0.07), tuple(p), rot=('Z', math.degrees(a) + 90)), 'turret', 'glass', 1)
    P(B.box('cup_visor', (0.16, 0.04, 0.03), tuple(p + d * 0.02 + Vector((0, 0, 0.06))), rot=('Z', math.degrees(a) + 90)), 'turret', 'paint', 1)
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'hatch_cmdr_{S}'
    node(nm, (CX + sx * 0.25, Y(CS), Z1 + 0.255), 'turret', 'hatch', (0, 1, 0), open_deg=sx * 105)
    lid = B.cylinder(nm, 0.26, 0.035, (CX, Y(CS), Z1 + 0.26), 'Z', 20)
    bm = bmesh.new(); bm.from_mesh(lid.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(CX, 0, 0), plane_no=(sx, 0, 0), clear_inner=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    bm.to_mesh(lid.data); bm.free()
    P(lid, nm, 'paint')
    P(B.box('lid_grip', (0.03, 0.14, 0.03), (CX + sx * 0.12, Y(CS), Z1 + 0.29)), nm, 'steel', 0)
P(B.cylinder('vent_dome', 0.1, 0.05, (TX - 0.25, Y(F + 0.55), Z1 + 0.025), 'Z', 10, r2=0.065), 'turret', 'paint', 1)
P(B.cylinder('signal_port', 0.065, 0.05, (TX + 0.25, Y(F + 0.62), Z1 + 0.025), 'Z', 8), 'turret', 'paint', 1)
# Gepaeckkasten (rear stowage bin) with rounded top, brackets, lid hinge, clasps; tactical number on it
RB = F + 1.74
P(B.box('turret_bin', (1.28, 0.42, 0.34), (TX, Y(RB + 0.22), 1.90), bevel=0.06, segs=2), 'turret', 'paint')
for dx in (-0.45, 0.45):
    P(B.box('bin_bracket', (0.06, 0.12, 0.26), (TX + dx, Y(RB - 0.02), 1.88)), 'turret', 'paint', 1)
    P(B.box('bin_clasp', (0.05, 0.02, 0.08), (TX + dx, Y(RB + 0.435), 1.98)), 'turret', 'steel', 0)
T.hinge((TX - 0.55, Y(RB + 0.05), 2.07), (TX + 0.55, Y(RB + 0.05), 2.07), 'turret')
V.plate_edge((TX - 0.6, Y(RB + 0.43), 2.0), (TX + 0.6, Y(RB + 0.43), 2.0), (0, 1, 0), 0.02)
NUM = '734' if L else '512'
for sx in (-1, 1):
    V.decal(f'num:{NUM}:b', (TX + sx * 0.64, Y(RB + 0.22), 1.90), (sx, 0, 0), (0, 0, 1), 0.34, 0.17, 'turret')
V.decal(f'num:{NUM}:b', (TX, Y(RB + 0.43), 1.88), (0, 1, 0), (0, 0, 1), 0.42, 0.21, 'turret')
V.socket('commander', (CX, Y(CS), Z1 + 0.28), 'turret', pose='cupola_standing')
V.socket('loader_hatch', (TX - 0.82, Y(F + 0.82), 1.90), 'turret')
V.socket('driver', (0.50, Y(1.3), ROOF), 'hull', pose='inside')
V.socket('radio_op', (-0.50, Y(1.3), ROOF), 'hull', pose='inside')
for i, (x, s) in enumerate(((0.5, 4.0), (-0.5, 4.0), (0.5, 4.7), (-0.5, 4.7))):
    V.socket(f'rider_{i + 1}', (x, Y(s), DECK), 'hull', pose='deck_seated')

# ------------------------------------------------------------------ gun: external mantlet (+ L spaced plate)
# L: 5 cm KwK 39 L/60 (3.0 m tube from the breech face at station 2.24 -> muzzle at -0.76, 6.28 m overall)
# J: 5 cm KwK 38 L/42 (2.1 m tube -> muzzle at 0.14, barely past the nose)
GZ, GS, BREECH = 1.90, 1.80, 2.24
TIP = BREECH - (3.0 if L else 2.1)
node('gun', (TX, Y(GS), GZ), 'turret', 'gun', (1, 0, 0), elev_min=-10, elev_max=20)
P(B.box('mantlet', (0.92, 0.11, 0.40), (TX, Y(F - 0.05), GZ), bevel=0.03, segs=2), 'gun')
V.bolt_row((TX - 0.42, Y(F - 0.105), GZ + 0.15), (TX + 0.42, Y(F - 0.105), GZ + 0.15), (0, -1, 0), 0.105)
V.bolt_row((TX - 0.42, Y(F - 0.105), GZ - 0.15), (TX + 0.42, Y(F - 0.105), GZ - 0.15), (0, -1, 0), 0.105)
if L:      # Blendenvorpanzer: 20 mm plate ~0.1 m ahead of the mantlet, gun + coax holes
    P(B.box('mantlet_spaced', (0.90, 0.02, 0.42), (TX, Y(F - 0.21), GZ), bevel=0.008, segs=1), 'gun')
    for dx in (-0.36, 0.36):
        P(B.box('mantlet_spacer', (0.05, 0.10, 0.3), (TX + dx, Y(F - 0.155), GZ)), 'gun', 'paint', 0)
    V.bolt_row((TX - 0.4, Y(F - 0.222), GZ + 0.17), (TX + 0.4, Y(F - 0.222), GZ + 0.17), (0, -1, 0), 0.2)
    P(B.box('coax_hole', (0.06, 0.01, 0.06), (TX - 0.20, Y(F - 0.222), GZ)), 'gun', 'black', 1)
    s_face = F - 0.22
else:
    s_face = F - 0.105
P(B.cylinder('sleeve', 0.075 if L else 0.08, 0.22, (TX, Y(s_face - 0.11), GZ), 'Y', 12, bevel=0.006), 'gun')
r0, r1 = (0.045, 0.038) if L else (0.05, 0.045)
P(B.cylinder('barrel', r0, s_face - 0.22 - TIP, (TX, Y((s_face - 0.22 + TIP) / 2), GZ), 'Y', 12, r2=r1), 'gun')
P(B.cylinder('muzzle_ring', r1 + 0.008, 0.07, (TX, Y(TIP + 0.035), GZ), 'Y', 12), 'gun')
P(B.cylinder('bore', r1 - 0.016, 0.012, (TX, Y(TIP - 0.002), GZ), 'Y', 10), 'gun', 'black', 1)
P(B.box('breech', (0.26, 0.5, 0.26), (TX, Y(BREECH - 0.25), GZ)), 'gun', 'gunmetal', 0)
V.muzzle('main_gun', (TX, Y(TIP - 0.01), GZ), 'gun', (0, -1, 0), '50mm_kwk39' if L else '50mm_kwk38', caliber=0.05)
mz = V.mg('mg34', (TX - 0.20, Y(F + 0.72), GZ), 'gun', full=False, jacket_only=True)
V.muzzle('coax_mg', mz, 'gun', (0, -1, 0), 'mg34')
V.muzzle('hull_mg', mz_hull, 'hull', (0, -1, 0), 'mg34')
P(B.box('sight_port', (0.06, 0.02, 0.05), (TX + 0.20, Y(F - 0.108), GZ + 0.06)), 'gun', 'black', 1)

# ------------------------------------------------------------------ markings: Balkenkreuz on hull sides + rear
for sx in (-1, 1):
    V.decal('bk', (sx * SUP_W, Y(3.35), 1.24), (sx, 0, 0), (0, 0, 1), 0.36, 0.36)
V.decal('bk', (0.62, Y(5.305), 1.20), (0, 1, 0), (0, 0, 1), 0.26, 0.26)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.1), dist=12, elev=32, azim=-40, lens=50)
    sys.exit(0)

V.finalize(2048, dims=dict(length_hull=5.52, length_with_gun=6.28 if L else 5.56, width=2.95, height=2.50, track_width=0.40,
                            ground_clearance=0.39, weight_t=22.7 if L else 21.5),
           burnt_pose={'turret': dict(rot=(0, -2, -24)), 'gun': dict(rot=(-8, 0, 0)), 'hatch_cmdr_R': dict(rot=(0, -105, 0)),
                       'hatch_side_R_f': dict(rot=(0, 0, -70)), 'hull': dict(off=(0, 0, -0.03))},
           burnt_drop=('shovel', 'axe', 'blade', 'head', 'cable', 'antenna', 'ant_', 'toolbox', 'extinguisher', 'lens',
                       'bo_cover', 'mudflap', 'jack_block', 'wire_cutter', 'mantlet_spacer'),
           track_style='kgs',
           info=dict(model='Panzerkampfwagen III Ausf. ' + AUSF.upper(), crew=5,
                     main_gun='5 cm KwK 39 L/60' if L else '5 cm KwK 38 L/42 (Ausf. J as built, early 1942)',
                     mg='2x MG 34 (coax, hull Kugelblende 50)', era='1942',
                     identifiers=('20 mm Vorpanzer on mantlet + driver plate, long L/60, glacis headlamp, loader-side '
                                  'visors deleted' if L else 'short L/42 gun, no spaced armour, twin fender headlamps, '
                                  'vision ports in all turret doors, holed-disc idler'),
                     sources='vehicles/refs/armour/urls.json'))
