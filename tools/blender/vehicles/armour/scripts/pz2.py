# pz2.py - Panzerkampfwagen II Ausf. F (1941-42): 2 cm KwK 30/38 + coax MG 34, commander's cupola (8 periscopes).
# Ausf. F cues: flat 35 mm superstructure front plate with the real Fahrersehklappe (left) and the cast dummy visor
# (right), flat stepped nose (vertical nose plate -> short glacis with brake hatches), superstructure set inboard of
# the fender line so the 5 large (550 mm) road wheels, the quarter-elliptic leaf springs and the 4 return rollers
# stay visible; fenders at track-top level with a stowage bin (left) and tools (right).
# Dimensions: 4.81 x 2.28 x 2.15 m, track 300 mm (Kgs 67/300/90), ground clearance 0.34 m.
# Run: blender -b --factory-startup --python-use-system-env --python pz2.py -- [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector, Matrix
import bmesh

PREVIEW = 'preview' in sys.argv
V.begin('panzer2_f', seed=2)
Y = lambda s: s - 2.40            # station from the front (m) -> Blender Y

# ------------------------------------------------------------------ hull
T_W, SUP_W, FEN_W, FZ, ROOF, DECK = 0.78, 0.93, 1.14, 0.84, 1.42, 1.36
low = [(Y(0.28), 0.36), (Y(4.40), 0.36), (Y(4.62), 0.50), (Y(4.62), FZ), (Y(0.40), FZ), (Y(0.40), 0.88),
       (Y(0.02), 0.80), (Y(0.02), 0.50)]
P(T.side_prism('lower_hull', low, -T_W, T_W, bevel=0.01), uv=0.6)
for s0, z0, s1, z1 in ((0.02, 0.50, 0.02, 0.80), (0.02, 0.80, 0.40, 0.88), (0.28, 0.36, 0.02, 0.50)):
    for sx in (-1, 1):
        V.weld((sx * T_W, Y(s0), z0), (sx * T_W, Y(s1), z1))
    V.weld((-T_W, Y(s0), z0), (T_W, Y(s0), z0))
V.bolt_row((-0.65, Y(0.015), 0.76), (0.65, Y(0.015), 0.76), (0, -1, 0), 0.13)
V.bolt_row((-0.65, Y(0.015), 0.54), (0.65, Y(0.015), 0.54), (0, -1, 0), 0.13)
gv = Vector((0, 0.38, 0.08)).normalized(); gn = Vector((0, -gv.z, gv.y))
for sx in (-1, 1):                  # brake-access hatches on the short glacis
    c = Vector((sx * 0.38, Y(0.21), 0.845))
    P(T.plate_on('brake_hatch', c, (1, 0, 0), gv, 0.56, 0.30, 0.02, 0.005), 'hull', 'paint', 1)
    T.hinge((sx * 0.14, Y(0.07), 0.82), (sx * 0.62, Y(0.07), 0.82))
    T.tow_shackle((sx * 0.52, Y(0.0), 0.44), rz=math.pi / 2)
    T.tow_shackle((sx * 0.52, Y(4.64), 0.58), rz=math.pi / 2)
V.spare_links((0, Y(-0.01), 0.66), 8, pitch=0.09, width=0.30, rz=math.pi / 2, ry=-math.pi / 2)
# superstructure: set inboard of the fender edge, low, flat full-width front plate at station 0.40
sup = [(Y(0.40), FZ), (Y(4.62), FZ), (Y(4.62), 1.22), (Y(4.35), DECK), (Y(2.72), DECK), (Y(2.68), ROOF), (Y(0.40), ROOF)]
P(T.side_prism('superstructure', sup, -SUP_W, SUP_W, bevel=0.008))
for sx in (-1, 1):
    V.weld((sx * SUP_W, Y(0.40), FZ), (sx * SUP_W, Y(0.40), ROOF))
    V.weld((sx * SUP_W, Y(0.40), ROOF), (sx * SUP_W, Y(2.68), ROOF))
    V.weld((sx * SUP_W, Y(0.5), FZ), (sx * SUP_W, Y(4.5), FZ))
    V.bolt_row((sx * (SUP_W - 0.04), Y(0.5), ROOF), (sx * (SUP_W - 0.04), Y(2.6), ROOF), (0, 0, 1), 0.15)
    V.bolt_row((sx * (SUP_W + 0.002), Y(0.55), FZ + 0.05), (sx * (SUP_W + 0.002), Y(4.5), FZ + 0.05), (sx, 0, 0), 0.22)
V.weld((-SUP_W, Y(0.40), ROOF), (SUP_W, Y(0.40), ROOF))
V.bolt_row((-0.85, Y(0.46), ROOF), (0.85, Y(0.46), ROOF), (0, 0, 1), 0.17)
# front plate: Fahrersehklappe 30 (left, +X) and the cast dummy visor (right); twin periscope holes above the real one
for sx, real in ((1, True), (-1, False)):
    vp = Vector((sx * 0.44, Y(0.40), 1.16))
    P(B.box('visor_frame', (0.42, 0.03, 0.22), tuple(vp + Vector((0, -0.015, 0))), bevel=0.008, segs=1), 'hull', 'paint', 1)
    P(B.box('visor_block', (0.32, 0.07, 0.14), tuple(vp + Vector((0, -0.05, 0))), bevel=0.02, segs=1), 'hull', 'paint', 1)
    if real:
        P(B.box('visor_slit', (0.22, 0.01, 0.012), tuple(vp + Vector((0, -0.09, 0.01)))), 'hull', 'black', 1)
        for dx in (-0.07, 0.07):
            P(B.cylinder('kff_hole', 0.026, 0.02, tuple(vp + Vector((dx, -0.005, 0.17))), 'Y', 8), 'hull', 'black', 1)
    else:
        V.plate_edge(vp + Vector((-0.11, -0.086, 0.01)), vp + Vector((0.11, -0.086, 0.01)), (0, -1, 0), 0.012, 0.003)
    V.bolt_row(vp + Vector((-0.18, -0.03, 0.09)), vp + Vector((0.18, -0.03, 0.09)), (0, -1, 0), 0.09)
for sx in (-1, 1):
    T.vision_port((sx * SUP_W, Y(0.95), 1.18), (sx, 0, 0), 0.24, 0.10)
    T.lift_hook((sx * 0.86, Y(0.6), ROOF)); T.lift_hook((sx * 0.86, Y(4.3), DECK))
# roof: driver's escape hatch front left, radio operator hatch right
node('hatch_driver', (0.84, Y(0.95), ROOF + 0.02), 'hull', 'hatch', (0, 1, 0), open_deg=-110)
P(B.box('hatch_driver', (0.42, 0.44, 0.03), (0.62, Y(0.95), ROOF + 0.02), bevel=0.008, segs=1), 'hatch_driver', 'paint')
T.hinge((0.84, Y(0.76), ROOF + 0.02), (0.84, Y(1.14), ROOF + 0.02))
# engine deck: two hatches, left air intake louvres, fan cover, radiator outlet at the rear
for sx in (-1, 1):
    P(B.box('engine_hatch', (0.62, 0.9, 0.025), (sx * 0.40, Y(3.30), DECK + 0.012), bevel=0.006, segs=1), 'hull', 'paint')
    T.hinge((sx * 0.07, Y(2.9), DECK + 0.03), (sx * 0.07, Y(3.7), DECK + 0.03))
    P(B.box('deck_handle', (0.12, 0.025, 0.035), (sx * 0.55, Y(3.6), DECK + 0.04)), 'hull', 'steel', 0)
    V.bolt_row((sx * 0.4 - 0.26, Y(3.77), DECK + 0.02), (sx * 0.4 + 0.26, Y(3.77), DECK + 0.02), (0, 0, 1), 0.13)
T.grille((0.62, Y(4.10), DECK), 0.36, 0.34, 4)
T.grille((-0.30, Y(4.12), DECK), 0.72, 0.30, 5)
V.weld((-SUP_W, Y(2.72), DECK), (SUP_W, Y(2.72), DECK))
# rear: muffler, exhaust, smoke-candle rack, tail light
P(B.cylinder('muffler', 0.10, 0.85, (0.1, Y(4.71), 0.70), 'X', 12, bevel=0.012), 'hull', 'steel')
for dx in (-0.25, 0.4):
    P(B.box('muffler_strap', (0.03, 0.22, 0.24), (dx, Y(4.71), 0.70)), 'hull', 'paint', 0)
P(B.cylinder('exhaust', 0.035, 0.18, (-0.40, Y(4.72), 0.70), 'X', 8), 'hull', 'steel', 1)
P(B.box('tail_light', (0.09, 0.05, 0.07), (0.72, Y(4.645), 1.05), bevel=0.008, segs=1), 'hull', 'red', 1)
P(B.box('smoke_rack', (0.42, 0.12, 0.12), (-0.42, Y(4.67), 1.12), bevel=0.01, segs=1), 'hull', 'paint', 1)
for i in range(5):
    D(B.cylinder('smoke_candle', 0.03, 0.12, (-0.58 + i * 0.08, Y(4.68), 1.21), 'Z', 8), 'steel')
V.bolt_row((-0.7, Y(4.62), 1.20), (0.7, Y(4.62), 1.20), (0, 1, 0), 0.14)
V.emitter('exhaust_main', (-0.52, Y(4.72), 0.70), 'hull', (-0.5, 1, 0.2), 'exhaust')

# ------------------------------------------------------------------ running gear: 5 x 550 mm wheels, leaf springs
XC, R_RW, THK = 0.99, 0.275, 0.045
def single_wheel(name, r, w, segs=12):
    """Pz II F road wheel: single wide rubber tyre on a dished disc, domed hub cap with bolt ring (axis X, +X out)."""
    h = w / 2
    prof = [(0.0, h + 0.07), (0.05, h + 0.07), (0.075, h + 0.035), (0.12, h + 0.02), (r - 0.07, h + 0.0),
            (r - 0.06, h + 0.012), (r, h - 0.02), (r, -h + 0.02), (r - 0.05, -h)]
    ob = V.lathe_mat(name, prof, segs, 'X', split_r=r - 0.058)
    B.auto_smooth(ob.data, 40)
    return ob
rw = V.set_mats(single_wheel('rw', R_RW, 0.13, 12), ['paint', 'rubber'])
spr = V.set_mats(V.sprocket2('spr', 0.29, 0.22, teeth=22, hub=0.1, holes=6, capz=0.05), ['paint', 'black'])
idl = V.set_mats(V.spoked_idler('idl', 0.25, 0.18, spokes=6, hub=0.08, rim_w=0.045), ['paint'])
rol = V.set_mats(V.return_roller('rol', 0.08, 0.12, segs=8, hub=0.035), ['paint', 'rubber'])
RS = (0.92, 1.57, 2.22, 2.87, 3.52)
V.running_gear(XC, [(Y(s), R_RW + THK) for s in RS], dict(ob=rw, r=R_RW), (Y(0.32), 0.60, 0.26), dict(ob=spr, r=0.29),
               (Y(4.24), 0.50, 0.22), dict(ob=idl, r=0.25), rollers=[(Y(s), 0.70, 0.075) for s in (1.25, 1.90, 2.55, 3.20)],
               roll_src=dict(ob=rol, r=0.08), track_w=0.30, thick=THK, pitch=0.09, sag=0.015)
for sx in (-1, 1):
    for s in RS:                    # swing arm + quarter-elliptic leaf spring (3 curved leaves) per wheel
        hub = Vector((sx * 0.86, Y(s), R_RW + THK)); piv = Vector((sx * 0.83, Y(s - 0.30), 0.44))
        P(B.beam('swing_arm', piv, hub, 0.07, 0.06), 'hull', 'paint_dark', 1)
        P(B.cylinder('arm_pivot', 0.05, 0.08, tuple(piv), 'X', 8), 'hull', 'paint_dark', 1)
        anchor = Vector((sx * 0.84, Y(s + 0.22), 0.66)); tip = Vector((sx * 0.85, Y(s - 0.08), 0.42))
        for k in range(3):
            dz = -0.022 * k; f = 1.0 - 0.28 * k
            mid = anchor.lerp(tip, 0.5 * f) + Vector((0, 0, 0.05 + dz))
            end = anchor.lerp(tip, f) + Vector((0, 0, dz))
            P(B.beam('leaf', anchor + Vector((0, 0, dz)), mid, 0.065, 0.02), 'hull', 'steel' if k == 0 else 'paint_dark', 1 if k < 2 else 0)
            P(B.beam('leaf', mid, end, 0.065, 0.02), 'hull', 'steel' if k == 0 else 'paint_dark', 1 if k < 2 else 0)
        P(B.box('spring_bracket', (0.1, 0.14, 0.12), tuple(anchor + Vector((-sx * 0.02, 0.02, 0.03)))), 'hull', 'paint_dark', 1)
        V.bolt_row(anchor + Vector((sx * 0.035, -0.04, 0.06)), anchor + Vector((sx * 0.035, 0.08, 0.06)), (sx, 0, 0), 0.06)
    fd = B.lathe('final_drive', [(0.20, 0.0), (0.20, 0.08), (0.16, 0.13), (0.1, 0.16), (0.0, 0.17)], segs=12, axis='X')
    P(V._xf(fd, (sx * T_W, Y(0.32), 0.60), rz=0 if sx > 0 else math.pi), 'hull', 'paint_dark', 1)
    P(B.cylinder('idler_crank', 0.08, 0.16, (sx * 0.85, Y(4.24), 0.50), 'X', 10), 'hull', 'paint_dark', 1)
    # fenders at track-top level from the nose to the rear, sloped front sections, rear flaps, brackets
    x0, x1 = sx * SUP_W, sx * FEN_W
    P(B.box('fender', (FEN_W - SUP_W + 0.02, 3.95, 0.01), ((x0 + x1) / 2, Y(2.46), FZ + 0.005), bevel=0.003, segs=1))
    P(T.side_prism('fender_front', [(Y(0.49), FZ), (Y(0.49), FZ + 0.012), (Y(0.0), FZ - 0.16), (Y(0.0), FZ - 0.172)], x0, x1))
    P(B.box('fender_lip', (0.01, 3.95, 0.035), (x1, Y(2.46), FZ - 0.01)), 'hull', 'paint', 1)
    P(B.box('mudflap', (FEN_W - SUP_W, 0.01, 0.18), ((x0 + x1) / 2, Y(4.43), FZ - 0.09)), 'hull', 'paint', 1)
    for s in (1.0, 2.0, 3.0, 4.0):
        P(B.box('fender_bracket', (0.2, 0.025, 0.07), ((x0 + x1) / 2, Y(s), FZ - 0.04)), 'hull', 'paint', 0)
    V.bolt_row((x1 - 0.025, Y(0.6), FZ + 0.01), (x1 - 0.025, Y(4.3), FZ + 0.01), (0, 0, 1), 0.25)
    V.headlight((sx * 0.86, Y(0.20), 0.98), r=0.075, cover=True)
V.notek((1.03, Y(0.55), FZ + 0.05))
# left fender: stowage bin (Balkenkreuz on its side), jack; right fender: shovel, crowbar, axe, wire cutter
P(B.box('stowage_bin', (0.21, 1.1, 0.34), (1.035, Y(3.55), FZ + 0.18), bevel=0.01, segs=1), 'hull', 'paint')
P(B.box('bin_lid', (0.22, 1.11, 0.02), (1.035, Y(3.55), FZ + 0.355)), 'hull', 'paint', 0)
T.hinge((0.93, Y(3.02), FZ + 0.36), (0.93, Y(4.08), FZ + 0.36))
for dy in (-0.35, 0.35):
    P(B.box('bin_clasp', (0.02, 0.05, 0.07), (1.145, Y(3.55 + dy), FZ + 0.3)), 'hull', 'steel', 0)
V.decal('bk', (1.146, Y(3.55), FZ + 0.17), (1, 0, 0), (0, 0, 1), 0.26, 0.26)
V.tool('jack', (1.04, Y(1.2), FZ + 0.06), (1.04, Y(1.7), FZ + 0.06))
V.tool('cable', (1.07, Y(1.9), FZ + 0.03), (1.07, Y(2.9), FZ + 0.03))
V.tool('shovel', (-1.04, Y(0.7), FZ + 0.03), (-1.04, Y(1.9), FZ + 0.03))
V.tool('crowbar', (-1.10, Y(2.1), FZ + 0.03), (-1.10, Y(3.4), FZ + 0.03))
V.tool('axe', (-1.02, Y(3.5), FZ + 0.03), (-1.02, Y(4.1), FZ + 0.03))
V.antenna((-0.86, Y(2.6), ROOF), 1.8)
P(B.box('ant_trough', (0.08, 1.9, 0.07), (-0.975, Y(2.2), FZ + 0.25)), 'hull', 'wood', 1)
V.decal('bk', (-SUP_W, Y(2.0), 1.08), (-1, 0, 0), (0, 0, 1), 0.30, 0.30)
V.decal('bk', (0.40, Y(4.625), 1.05), (0, 1, 0), (0, 0, 1), 0.22, 0.22)

# ------------------------------------------------------------------ turret (offset left), faceted, no side doors
TX, TS, Z0, Z1, F = 0.08, 1.72, 1.44, 1.90, 1.08
node('turret', (TX, Y(TS), ROOF), 'hull', 'turret', (0, 0, 1), traverse_deg_s=20)
tp = lambda pts: [(TX + x, Y(F + s)) for x, s in pts][::-1]
base = tp([(0.40, 0.0), (0.64, 0.26), (0.66, 1.08), (0.46, 1.36), (-0.46, 1.36), (-0.66, 1.08), (-0.64, 0.26), (-0.40, 0.0)])
roof = tp([(0.34, 0.10), (0.48, 0.32), (0.48, 1.06), (0.36, 1.24), (-0.36, 1.24), (-0.48, 1.06), (-0.48, 0.32), (-0.34, 0.10)])
P(T.loft_z('turret_body', base, Z0, roof, Z1, bevel=0.008), 'turret')
P(B.cylinder('turret_collar', 0.60, 0.04, (TX, Y(TS), ROOF + 0.015), 'Z', 24), 'turret')
P(B.cylinder('ring_guard', 0.66, 0.025, (TX, Y(TS), ROOF + 0.008), 'Z', 24), 'hull', 'paint', 1)
for a, b in zip(base, base[1:] + base[:1]):
    V.weld((a[0], a[1], Z0 + 0.01), (b[0], b[1], Z0 + 0.01))
for a, b in zip(roof, roof[1:] + roof[:1]):
    V.weld((a[0], a[1], Z1), (b[0], b[1], Z1))
for a, b in zip(base, roof):
    V.weld((a[0], a[1], Z0), (b[0], b[1], Z1))
V.bolt_row((TX - 0.36, Y(F + 0.45), Z1), (TX + 0.36, Y(F + 0.45), Z1), (0, 0, 1), 0.12)
for sx in (-1, 1):                  # side vision flaps + cheek visors, lifting hooks, pistol port
    n = Vector((sx * 0.46, 0, 0.18)).normalized()
    T.vision_port((TX + sx * 0.60, Y(F + 0.68), 1.68), tuple(n), 0.16, 0.07, 'turret')
    T.vision_port((TX + sx * 0.54, Y(F + 0.14), 1.66), (sx * 0.72, -0.62, 0.2), 0.12, 0.06, 'turret')
    T.lift_hook((TX + sx * 0.36, Y(F + 0.3), Z1), 'turret'); T.lift_hook((TX + sx * 0.36, Y(F + 1.1), Z1), 'turret')
    P(B.cylinder('pistol_port', 0.04, 0.025, (TX + sx * 0.25, Y(F + 1.345), 1.62), 'Y', 8), 'turret', 'paint', 0)
    V.decal('num:213:w', (TX + sx * 0.60, Y(F + 1.0), 1.64), tuple(n), (-sx * 0.36, 0, 0.93), 0.30, 0.15, 'turret')
# cupola (rear, left of centre): drum with 8 periscopes under armoured hood, split lids
CX, CS = TX - 0.04, F + 0.92
P(B.cylinder('cupola', 0.27, 0.13, (CX, Y(CS), Z1 + 0.065), 'Z', 16, bevel=0.008), 'turret')
P(B.cylinder('cupola_hood', 0.29, 0.03, (CX, Y(CS), Z1 + 0.135), 'Z', 16), 'turret', 'paint', 1)
for i in range(8):
    a = math.radians(i * 45 + 22.5); d = Vector((math.cos(a), math.sin(a), 0))
    p = Vector((CX, Y(CS), Z1 + 0.08)) + d * 0.27
    P(B.box('cup_block', (0.08, 0.02, 0.05), tuple(p), rot=('Z', math.degrees(a) + 90)), 'turret', 'glass', 1)
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'hatch_cmdr_{S}'
    node(nm, (CX + sx * 0.2, Y(CS), Z1 + 0.16), 'turret', 'hatch', (0, 1, 0), open_deg=sx * 105)
    lid = B.cylinder(nm, 0.21, 0.03, (CX, Y(CS), Z1 + 0.165), 'Z', 16)
    bm = bmesh.new(); bm.from_mesh(lid.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(CX, 0, 0), plane_no=(sx, 0, 0), clear_inner=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary]); bm.to_mesh(lid.data); bm.free()
    P(lid, nm, 'paint')
    P(B.box('lid_grip', (0.025, 0.1, 0.025), (CX + sx * 0.1, Y(CS), Z1 + 0.19)), nm, 'steel', 0)
P(B.cylinder('signal_port', 0.05, 0.04, (TX + 0.22, Y(F + 0.45), Z1 + 0.02), 'Z', 8), 'turret', 'paint', 1)
V.socket('commander', (CX, Y(CS), Z1 + 0.17), 'turret', pose='cupola_standing')
V.socket('driver', (0.44, Y(0.95), ROOF), 'hull', pose='hatch_seated')
for i, (x, s) in enumerate(((0.45, 3.4), (-0.45, 3.4))):
    V.socket(f'rider_{i + 1}', (x, Y(s), DECK), 'hull', pose='deck_seated')

# ------------------------------------------------------------------ gun: rounded external mantlet, 2 cm KwK 30/38
GZ, GS = 1.68, F + 0.12
node('gun', (TX, Y(GS), GZ), 'turret', 'gun', (1, 0, 0), elev_min=-9, elev_max=20)
mant = B.cylinder('mantlet', 0.17, 0.62, (0, 0, 0), 'X', 14)
bm = bmesh.new(); bm.from_mesh(mant.data)            # half drum: rounded front, flat back
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0.04, 0), plane_no=(0, 1, 0), clear_outer=True)
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary]); bm.to_mesh(mant.data); bm.free()
P(V._xf(mant, (TX, Y(F - 0.02), GZ)), 'gun')
V.bolt_row((TX - 0.27, Y(F - 0.02), GZ + 0.175), (TX + 0.27, Y(F - 0.02), GZ + 0.175), (0, 0, 1), 0.09)
GX = TX + 0.09                      # 2 cm gun right of the MG (seen from the front)
P(B.cylinder('gun_sleeve', 0.05, 0.30, (GX, Y(F - 0.30), GZ), 'Y', 10, bevel=0.005), 'gun')
P(B.cylinder('recoil_ring', 0.056, 0.04, (GX, Y(F - 0.44), GZ), 'Y', 10), 'gun')
TIP = -0.02
P(B.cylinder('barrel', 0.024, (F - 0.45) - (TIP + 0.12), (GX, Y((F - 0.45 + TIP + 0.12) / 2), GZ), 'Y', 10, r2=0.021), 'gun')
P(B.cylinder('flash_hider', 0.03, 0.12, (GX, Y(TIP + 0.06), GZ), 'Y', 10, r2=0.034), 'gun')
P(B.cylinder('bore', 0.012, 0.01, (GX, Y(TIP - 0.002), GZ), 'Y', 8), 'gun', 'black', 1)
P(B.box('breech', (0.18, 0.5, 0.2), (GX, Y(F + 0.45), GZ)), 'gun', 'gunmetal', 0)
V.muzzle('main_gun', (GX, Y(TIP - 0.01), GZ), 'gun', (0, -1, 0), '20mm_kwk30', caliber=0.02)
mz = V.mg('mg34', (TX - 0.12, Y(F + 0.62), GZ), 'gun', full=False, jacket_only=True)
V.muzzle('coax_mg', mz, 'gun', (0, -1, 0), 'mg34')
P(B.box('sight_port', (0.05, 0.02, 0.035), (TX, Y(F - 0.17), GZ + 0.1)), 'gun', 'black', 1)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.0), dist=10, elev=32, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(length=4.81, width=2.28, height=2.15, track_width=0.30, ground_clearance=0.34, weight_t=9.5),
           burnt_pose={'turret': dict(rot=(0, 3, 31)), 'gun': dict(rot=(-5, 0, 0)), 'hatch_cmdr_L': dict(rot=(0, 105, 0)),
                       'hatch_driver': dict(rot=(0, -100, 0)), 'hull': dict(off=(0, 0, -0.03))},
           burnt_drop=('shovel', 'blade', 'head', 'cable', 'antenna', 'ant_', 'lens', 'bo_cover', 'mudflap', 'crowbar',
                       'bin_lid', 'axe'),
           track_style='kgs',
           info=dict(model='Panzerkampfwagen II Ausf. F', crew=3, main_gun='2 cm KwK 30/38 L/55', mg='MG 34 coax',
                     era='1941-42', identifiers='flat 35 mm front plate with real + dummy visor, stepped flat nose, '
                     'cupola with 8 periscopes, fender stowage bin', sources='vehicles/refs/armour/urls.json'))
