# sdkfz231.py - schwerer Panzerspähwagen (8-Rad) Sd.Kfz. 231 (Büssing-NAG GS, 1938-43): double-ended faceted hull,
# all-wheel steering (axles 1+2 / 3+4 opposed), low faceted open-topped turret with folding wire-mesh anti-grenade
# screens, 2 cm KwK 30/38 + coax MG 34 in a faceted mantlet, spaced Bugpanzer plate on brackets at the upper nose,
# continuous mudguards over both wheel pairs with stowage boxes on them.
# Dimensions: 5.85 x 2.20 x 2.35 m, axle spacing 1.35 / 1.40 / 1.35 m, 210-18 cross-country tyres, clearance 0.27 m.
# Run: blender -b --factory-startup --python-use-system-env --python sdkfz231.py -- [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node, D
import tankparts as T
from mathutils import Vector, Matrix
import bmesh

PREVIEW = 'preview' in sys.argv
V.begin('sdkfz231_8rad', seed=231)
Y = lambda s: s - 2.925
AX = (0.95, 2.30, 3.70, 5.05)
R_T, W_T, XW = 0.46, 0.23, 0.90           # tyre radius / width, wheel centre |x|
DECK = 1.58

# ------------------------------------------------------------------ hull: loft of faceted cross-sections along Y
def sec(wb, wl, wt, zb=0.30, zl=1.08, zt=DECK):
    """8-sided section: belly half-width wb, waist half-width wl at zl, deck half-width wt at zt."""
    return [(-wb, zb), (wb, zb), (wl, zl - 0.14), (wl, zl), (wt, zt), (-wt, zt), (-wl, zl), (-wl, zl - 0.14)]
stations = [(0.12, sec(0.34, 0.48, 0.30, 0.56, 0.98, 1.16)), (0.72, sec(0.46, 0.86, 0.56, 0.32, 1.06, DECK - 0.02)),
            (1.40, sec(0.48, 0.96, 0.76)), (4.45, sec(0.48, 0.96, 0.76)), (5.15, sec(0.46, 0.86, 0.56, 0.32, 1.06, DECK - 0.04)),
            (5.78, sec(0.34, 0.48, 0.32, 0.56, 0.98, 1.2))]
for (s0, a), (s1, b) in zip(stations[:-1], stations[1:]):
    hs = V.slab('hull_seg', Y(s0), Y(s1), a, b)           # rework2: flat-shaded facets + crisp small bevel on every
    for pg in hs.data.polygons:                             # plate joint (was smooth -> soft rounded nose)
        pg.use_smooth = False
    B.add_bevel(hs, 0.007, 1, angle=4, harden=False)
    P(hs, 'hull', 'paint')
    for (xa, za), (xb, zb) in zip(a, b):                      # welded facet seams
        if za > 0.5:
            V.weld((xa, Y(s0), za), (xb, Y(s1), zb))
for s, sc in stations[1:-1]:
    for (xa, za), (xb, zb) in zip(sc, sc[1:] + sc[:1]):
        if min(za, zb) > 0.5:
            V.weld((xa, Y(s), za), (xb, Y(s), zb))
# Bugpanzer: bent 8 mm spaced plate on four brackets at the upper nose (top edge level with the nose deck edge)
top, bot = (Y(0.06), 1.19), (Y(-0.02), 0.64)
for x0, x1, xa, xb in ((-0.50, 0.50, -0.56, 0.56),):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((x0, top[0], top[1]), (x1, top[0], top[1]), (xb, bot[0], bot[1]), (xa, bot[0], bot[1]))]
    bm.faces.new(vs)
    pl = B.obj_from_bm('bow_plate', bm); B.solidify(pl, 0.015, offset=1); P(pl, 'hull', 'paint')
for sx in (-1, 1):                  # side wings bent back to the nose
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((sx * 0.50, top[0], top[1]), (sx * 0.56, bot[0], bot[1]), (sx * 0.66, Y(0.30), 0.70), (sx * 0.56, Y(0.30), 1.10))]
    bm.faces.new(vs)
    pl = B.obj_from_bm('bow_wing', bm); B.solidify(pl, 0.012, offset=1); P(pl, 'hull', 'paint')
    for z, s in ((1.08, 0.13), (0.78, 0.13)):
        P(B.beam('bow_bracket', (sx * 0.30, Y(0.05), z), (sx * 0.30, Y(s + 0.06), z), 0.05, 0.05), 'hull', 'paint', 1)
V.bolt_row((-0.42, Y(0.055), 1.15), (0.42, Y(0.055), 1.15), (0, -1, 0.15), 0.12)
# decks: engine louvres at the rear, hatches, driver visors front and rear (double-ended vehicle)
T.grille((0, Y(4.95), DECK - 0.05), 1.0, 0.7, 7)
P(B.box('rear_hatch', (1.0, 0.5, 0.025), (0, Y(4.3), DECK + 0.01), bevel=0.006, segs=1), 'hull', 'paint', 1)
T.hinge((-0.45, Y(4.06), DECK + 0.025), (0.45, Y(4.06), DECK + 0.025))
for sgn, s, z in ((-1, 0.60, 1.49), (1, 5.28, 1.48)):
    for sx in (-1, 1):
        T.vision_port((sx * 0.25, Y(s), z), (0, sgn * 0.55, 0.83), 0.30, 0.12)
    V.bolt_row((-0.4, Y(s - sgn * 0.1), z + 0.07), (0.4, Y(s - sgn * 0.1), z + 0.07), (0, sgn * 0.55, 0.83), 0.1)
UPN = Vector((0.52, 0, 0.20)).normalized()                     # upper side facet normal (left)
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'door_{S}'
    node(nm, (sx * 0.90, Y(2.62), 1.26), 'hull', 'door', (0, 0, 1), open_deg=sx * 95)
    P(T.plate_on(nm, (sx * 0.88, Y(3.0), 1.28), (0, sx, 0), (-sx * UPN.z, 0, UPN.x), 0.70, 0.46, 0.025, 0.006), nm, 'paint')
    T.vision_port((sx * 0.875, Y(3.0), 1.36), (sx * UPN.x, 0, UPN.z), 0.18, 0.07, nm)
    T.hinge((sx * 0.94, Y(2.62), 1.10), (sx * 0.86, Y(2.62), 1.46))
    for s in (1.55, 4.35):
        T.vision_port((sx * 0.87, Y(s), 1.30), (sx * UPN.x, 0, UPN.z), 0.2, 0.08)
    V.decal('bk', (sx * 0.905, Y(3.0), 1.21), (sx * UPN.x, 0, UPN.z), (-sx * UPN.z, 0, UPN.x), 0.24, 0.24)
V.decal('bk', (0.0, Y(5.72), 1.02), (0, 1, 0.6), (0, -0.6, 1), 0.24, 0.24)

# ------------------------------------------------------------------ wheels: cross-country tyres, all-wheel steering
def xc_tyre(name, r, w, rim_r, segs=28):
    """210-18 Gelaendereifen: lathe tyre + disc wheel + hub cap; alternate tread rings pushed out (lugs) so the tread
    reads in silhouette and in shading. Axis X, outer face +X, slot 1 = tyre."""
    h = w / 2
    prof = [(0.0, h + 0.05), (0.06, h + 0.05), (0.08, h + 0.02), (0.13, h + 0.015), (rim_r - 0.02, h - 0.04), (rim_r, h - 0.01),
            (rim_r + 0.01, h + 0.005), (r - 0.06, h + 0.012), (r - 0.015, h - 0.03), (r, h - 0.07), (r, -h + 0.07),
            (r - 0.015, -h + 0.03), (r - 0.06, -h - 0.012), (rim_r + 0.01, -h)]
    prof.insert(prof.index((r, -h + 0.07)), (r, 0.0))           # tread centre ring -> staggered lug halves
    ob = V.lathe_mat(name, prof, segs, 'X', split_r=rim_r + 0.005)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for v in bm.verts:
        rr = math.hypot(v.co.y, v.co.z)
        if rr > r - 0.02:
            a = math.atan2(v.co.z, v.co.y)
            k = int(round(a / (2 * math.pi / segs)))
            side = 0 if v.co.x > 0.01 else 1 if v.co.x < -0.01 else None
            if (side is not None and k % 2 == side) or (side is None and k % 4 == 0):   # staggered lugs, 30 mm
                f = (rr + 0.03) / rr
                v.co.y *= f; v.co.z *= f
    bm.to_mesh(ob.data); bm.free()
    B.auto_smooth(ob.data, 35)
    return ob
tyre = V.set_mats(xc_tyre('tyre', R_T, W_T, 0.26, segs=32), ['paint', 'tyre'])
tyreL = V.mirrored_mesh(tyre, 'tyre_L')
def burnt_rim(name, r, rim_r, w, segs=20):
    """rework2: burnt-out wheel - tyre burnt off: bare pressed-steel disc + rim flanges, charred bead remnants and
    loose steel-wire cord loops sagging from the rim (slot 0 = rim paint, slot 1 = steel wire)."""
    h = w / 2
    prof = [(0.0, h + 0.05), (0.06, h + 0.05), (0.08, h + 0.02), (0.13, h + 0.015), (rim_r - 0.02, h - 0.04), (rim_r, h - 0.01),
            (rim_r + 0.025, h + 0.005), (rim_r + 0.03, h - 0.02), (rim_r + 0.005, h - 0.035), (rim_r + 0.005, -h + 0.035),
            (rim_r + 0.03, -h + 0.02), (rim_r + 0.025, -h - 0.005), (rim_r, -h)]
    ob = V.lathe_mat(name, prof, segs, 'X')
    parts = [ob]
    for k in range(7):              # broken cord / bead wire loops hanging off the rim
        a0 = k * 0.9 + 0.3
        pts = [((-1) ** k * (h - 0.03), (rim_r + 0.02 + 0.05 * math.sin(t * math.pi)) * math.cos(a0 + t * 0.7),
                (rim_r + 0.02 + 0.05 * math.sin(t * math.pi)) * math.sin(a0 + t * 0.7)) for t in (0, 0.33, 0.66, 1.0)]
        for p0, p1 in zip(pts, pts[1:]):
            wv = B.beam('cord', p0, p1, 0.007, 0.007); wv.data.materials.clear()
            parts.append(wv)
    n0 = len(ob.data.polygons)
    j = B.join(parts, name)
    for pg in j.data.polygons:
        pg.material_index = 1 if pg.index >= n0 else 0
    return j
rimR = burnt_rim('rim_burnt', R_T, 0.26, W_T)
rimR = V.set_mats(rimR, ['paint', 'steel'])
rimL = V.mirrored_mesh(rimR, 'rim_burnt_L')
V.burnt_swap(tyre, rimR); V.burnt_swap(tyreL, rimL)
for i, s in enumerate(AX):
    ratio = (1.0, 0.6, -0.6, -1.0)[i]
    for sx, S, mesh in ((1, 'L', tyreL), (-1, 'R', tyre)):
        st = node(f'steer_{S}{i + 1}', (sx * XW, Y(s), R_T), 'hull', 'steer', (0, 0, 1), steer_max_deg=round(30 * abs(ratio)),
                  steer_ratio=ratio)
        wn = node(f'wheel_{S}{i + 1}', (sx * XW, Y(s), R_T), st, 'wheel', (1, 0, 0), radius=R_T)
        V.instance(mesh, wn, (sx * XW, Y(s), R_T), wn)
        V.contact(f'wheel_{S}{i + 1}', (sx * XW, Y(s), 0.0), 'wheel', width=W_T)
        P(B.beam('susp_arm', (sx * 0.48, Y(s), R_T + 0.1), (sx * (XW - 0.14), Y(s), R_T), 0.1, 0.08), 'hull', 'paint_dark', 1)
        P(B.cylinder('hub_housing', 0.1, 0.1, (sx * (XW - 0.16), Y(s), R_T), 'X', 8), 'hull', 'paint_dark', 1)
    P(B.beam('axle', (-0.48, Y(s), R_T + 0.08), (0.48, Y(s), R_T + 0.08), 0.12, 0.12), 'hull', 'paint_dark', 1)
# continuous mudguards over each wheel pair (flat top at 1.0 m, arched ends, outer lip) joined by a running board
FZ, F0, F1 = 1.00, 0.70, 1.10
for sx in (-1, 1):
    xm = sx * (F0 + F1) / 2
    for a, b in ((AX[0], AX[1]), (AX[2], AX[3])):
        path = [(Y(a) - 0.56, 0.70), (Y(a) - 0.51, 0.86), (Y(a) - 0.41, 0.96), (Y(a) - 0.28, FZ), (Y(b) + 0.28, FZ),
                (Y(b) + 0.41, 0.96), (Y(b) + 0.51, 0.86), (Y(b) + 0.56, 0.70)]
        mgd = B.sweep_yz('mudguard', path, [(-(F1 - F0) / 2 - 0.01, -0.04), (-(F1 - F0) / 2, 0.0), ((F1 - F0) / 2, 0.0), ((F1 - F0) / 2 + 0.01, -0.04)], xm)
        B.solidify(mgd, 0.008)
        P(mgd, 'hull', 'paint')
        V.bolt_row((sx * (F1 - 0.03), Y(a), FZ + 0.004), (sx * (F1 - 0.03), Y(b), FZ + 0.004), (0, 0, 1), 0.25)
    P(B.box('running_board', (F1 - F0, AX[2] - AX[1] - 0.9, 0.012), (xm, Y((AX[1] + AX[2]) / 2), FZ - 0.25)), 'hull', 'paint', 1)
    # stowage boxes on the mudguards: long box over the front pair, tool box + fuel cans over the rear pair
    P(B.box('stowage_box', (0.30, 0.95, 0.30), (sx * 0.93, Y(1.62), FZ + 0.15), bevel=0.012, segs=1), 'hull', 'paint')
    P(B.box('box_lid', (0.31, 0.96, 0.02), (sx * 0.93, Y(1.62), FZ + 0.305)), 'hull', 'paint', 0)
    T.hinge((sx * 0.79, Y(1.2), FZ + 0.31), (sx * 0.79, Y(2.05), FZ + 0.31))
    P(B.box('box_hasp', (0.02, 0.06, 0.06), (sx * 1.085, Y(1.62), FZ + 0.24)), 'hull', 'steel', 0)
    P(B.box('stowage_box', (0.30, 0.70, 0.26), (sx * 0.93, Y(4.60), FZ + 0.13), bevel=0.012, segs=1), 'hull', 'paint')
    V.jerrycan((sx * 0.93, Y(4.05), FZ), rz=0.0)
    V.headlight((sx * 0.80, Y(0.62), 1.30), r=0.08, cover=True)
    V.tool('shovel', (sx * 0.98, Y(2.4), FZ + 0.02), (sx * 0.98, Y(3.5), FZ + 0.02))
V.notek((0.52, Y(0.30), 1.18))
# deck details: engine side louvres, grab rails, pick, tow shackles, tail light, antenna (frame antenna omitted: 231)
for sx in (-1, 1):
    for i in range(4):
        P(B.box('side_louvre', (0.03, 0.14, 0.2), (sx * 0.82, Y(4.55 + i * 0.16), 1.34), rot=('Y', sx * 22)), 'hull', 'black', 1)
    P(B.beam('grab_rail', (sx * 0.6, Y(1.3), DECK + 0.04), (sx * 0.6, Y(2.0), DECK + 0.04), 0.02, 0.02), 'hull', 'steel', 0)
    V.tool('pick', (sx * 0.62, Y(3.6), DECK + 0.02), (sx * 0.62, Y(4.4), DECK + 0.02))
    T.tow_shackle((sx * 0.35, Y(0.08), 0.60), rz=math.pi / 2)
    T.tow_shackle((sx * 0.35, Y(5.80), 0.62), rz=math.pi / 2)
P(B.box('tail_light_bracket', (0.12, 0.06, 0.02), (0.36, Y(5.765), 0.955)), 'hull', 'paint', 1)   # rework2: was outside the hull
P(B.box('tail_light_body', (0.10, 0.05, 0.08), (0.36, Y(5.79), 1.0), bevel=0.01, segs=1), 'hull', 'paint', 1)
P(B.box('tail_light', (0.07, 0.012, 0.05), (0.36, Y(5.818), 1.0)), 'hull', 'red', 1)
V.emitter('exhaust', (-0.8, Y(5.6), 0.55), 'hull', (-0.3, 1, 0), 'exhaust')
V.emitter('dust_rear', (0, Y(5.85), 0.1), 'hull', (0, 1, 0.3), 'dust')
V.antenna((-0.6, Y(4.0), DECK), 1.8)
V.socket('driver_front', (0.30, Y(1.1), 1.0), 'hull', pose='inside')
V.socket('driver_rear', (-0.30, Y(4.8), 1.0), 'hull', pose='inside')
V.socket('exit_L', (1.8, Y(3.0), 0.0), 'hull'); V.socket('exit_R', (-1.8, Y(3.0), 0.0), 'hull')

# ------------------------------------------------------------------ turret: low 10-facet open-topped, sloped 30 deg
TS, Z0, Z1 = 2.72, DECK, 2.04
node('turret', (0, Y(TS), DECK), 'hull', 'turret', (0, 0, 1), traverse_deg_s=18)
tp = lambda pts: [(x, Y(s)) for x, s in pts][::-1]
base = [(0.30, 2.00), (0.62, 2.18), (0.78, 2.52), (0.78, 2.98), (0.52, 3.40), (-0.52, 3.40), (-0.78, 2.98), (-0.78, 2.52), (-0.62, 2.18), (-0.30, 2.00)]
roof = [(0.24, 2.18), (0.46, 2.32), (0.54, 2.58), (0.54, 2.96), (0.36, 3.20), (-0.36, 3.20), (-0.54, 2.96), (-0.54, 2.58), (-0.46, 2.32), (-0.24, 2.18)]
body = T.loft_z('turret_body', tp(base), Z0, tp(roof), Z1)
bm = bmesh.new(); bm.from_mesh(body.data)                      # open top: remove roof cap, give walls thickness
for f in [f for f in bm.faces if f.normal.z > 0.99]:
    bm.faces.remove(f)
bm.to_mesh(body.data); bm.free()
B.solidify(body, 0.02, offset=-1)
P(body, 'turret', 'paint')
P(T.loft_z('turret_floor', tp(roof), Z0 + 0.3, tp(roof), Z0 + 0.32), 'turret', 'interior', 1)
for a, b in zip(base, roof):
    V.weld((a[0], Y(a[1]), Z0), (b[0], Y(b[1]), Z1))
for a, b in zip(base, base[1:]):
    V.weld((a[0], Y(a[1]), Z0 + 0.01), (b[0], Y(b[1]), Z0 + 0.01))
for sx in (-1, 1):
    n = Vector((sx * 0.46, 0, 0.26)).normalized()
    T.vision_port((sx * 0.64, Y(2.76), 1.82), tuple(n), 0.16, 0.07, 'turret')
    T.vision_port((sx * 0.52, Y(2.28), 1.82), (sx * 0.5, -0.72, 0.3), 0.12, 0.06, 'turret')
    V.decal('num:132:b', (sx * 0.62, Y(3.12), 1.80), (sx * 0.8, 0.35, 0.45), (-sx * 0.45, 0, 0.9), 0.30, 0.15, 'turret')
# folding anti-grenade screens: tubular frame + wire mesh (bar grid), hinged on the turret centre line
for sx, S in ((1, 'L'), (-1, 'R')):
    nm = f'hatch_screen_{S}'
    node(nm, (0, Y(2.70), Z1 + 0.12), 'turret', 'hatch', (0, 1, 0), open_deg=sx * 120)
    x0, x1, y0, y1, zz = 0.0, sx * 0.60, Y(2.14), Y(3.26), Z1 + 0.08
    zo = lambda x: zz + 0.04 - abs(x) * 0.12               # screens slope down to the turret edge
    for p, q in (((x0, y0), (x1, y0)), ((x0, y1), (x1, y1)), ((x1, y0), (x1, y1)), ((x0, y0), (x0, y1))):
        P(B.beam('screen_frame', (p[0], p[1], zo(p[0])), (q[0], q[1], zo(q[0])), 0.025, 0.025), nm, 'paint', 2)
    for k in range(1, 9):           # longitudinal wires
        x = x1 * k / 9
        P(B.beam('screen_wire', (x, y0, zo(x)), (x, y1, zo(x)), 0.008, 0.008), nm, 'steel', 1 if k % 2 else 0)
    for k in range(1, 12):          # transverse wires
        y = y0 + (y1 - y0) * k / 12
        P(B.beam('screen_wire', (x0, y, zo(0)), (x1, y, zo(x1)), 0.008, 0.008), nm, 'steel', 1 if k % 2 else 0)
    for yy in (y0 + 0.1, y1 - 0.1):
        P(B.beam('screen_leg', (x1, yy, zo(x1)), (sx * 0.52, yy, Z1), 0.02, 0.02), nm, 'paint', 1)
V.socket('commander', (0.2, Y(2.95), 1.9), 'turret', pose='turret_standing')
V.socket('gunner', (-0.2, Y(2.6), 1.9), 'turret', pose='turret_standing')

# ------------------------------------------------------------------ gun: faceted mantlet, 2 cm KwK 30/38 + coax MG 34
GZ, GS = 1.84, 2.18
node('gun', (0, Y(GS), GZ), 'turret', 'gun', (1, 0, 0), elev_min=-10, elev_max=26)
mh = V.hexa('mantlet', [(-0.26, Y(2.12), GZ - 0.15), (0.26, Y(2.12), GZ - 0.15), (0.26, Y(1.96), GZ - 0.12), (-0.26, Y(1.96), GZ - 0.12),
                        (-0.26, Y(2.12), GZ + 0.15), (0.26, Y(2.12), GZ + 0.15), (0.24, Y(1.98), GZ + 0.11), (-0.24, Y(1.98), GZ + 0.11)], bevel=0.008)
P(mh, 'gun')
V.bolt_row((-0.2, Y(1.97), GZ + 0.1), (0.2, Y(1.97), GZ + 0.1), (0, -1, 0.3), 0.1)
P(B.cylinder('gun_sleeve', 0.045, 0.30, (0.07, Y(1.82), GZ), 'Y', 10, bevel=0.005), 'gun')
P(B.cylinder('recoil_ring', 0.052, 0.04, (0.07, Y(1.68), GZ), 'Y', 10), 'gun')
P(B.cylinder('barrel', 0.024, 1.0, (0.07, Y(1.66 - 0.5), GZ), 'Y', 10, r2=0.021), 'gun')
P(B.cylinder('flash_hider', 0.03, 0.12, (0.07, Y(0.60), GZ), 'Y', 10, r2=0.034), 'gun')
P(B.cylinder('bore', 0.012, 0.01, (0.07, Y(0.538), GZ), 'Y', 8), 'gun', 'black', 1)
V.muzzle('main_gun', (0.07, Y(0.53), GZ), 'gun', (0, -1, 0), '20mm_kwk30', caliber=0.02)
mz = V.mg('mg34', (-0.11, Y(2.72), GZ), 'gun', full=False, jacket_only=True)
V.muzzle('coax_mg', mz, 'gun', (0, -1, 0), 'mg34')
P(B.box('sight_port', (0.05, 0.02, 0.035), (-0.02, Y(1.975), GZ + 0.07)), 'gun', 'black', 1)

if PREVIEW:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 1.0), dist=11, elev=35, azim=-40, lens=50)
    sys.exit(0)
V.finalize(2048, dims=dict(length=5.85, width=2.20, height=2.35, wheelbase=[1.35, 1.40, 1.35], ground_clearance=0.27, weight_t=8.3),
           burnt_pose={'turret': dict(rot=(0, 0, 38)), 'gun': dict(rot=(-9, 0, 0)), 'hatch_screen_L': dict(rot=(0, 110, 0)),
                       'door_L': dict(rot=(0, 0, 70)), 'steer_L1': dict(rot=(0, 0, 14)), 'steer_R1': dict(rot=(0, 0, 14)),
                       'hull': dict(off=(0, 0, -0.17))},      # rework2: sits on the bare rims (tyres burnt off)
           burnt_drop=('shovel', 'blade', 'antenna', 'ant_', 'lens', 'bo_cover', 'screen_wire', 'jerrycan', 'jc_', 'box_lid'),
           track_style='kgs',
           info=dict(model='Sd.Kfz. 231 (8-Rad)', crew=4, main_gun='2 cm KwK 30 L/55', mg='MG 34 coax', era='1938-43',
                     steering='all wheels: steer_ratio per axle (1, .6, -.6, -1) x steer angle',
                     identifiers='Bugpanzer spaced plate on the upper nose, continuous mudguards with stowage boxes, '
                                 'cross-country tread tyres, low faceted open turret with wire-mesh grenade screens',
                     sources='vehicles/refs/armour/urls.json'))
