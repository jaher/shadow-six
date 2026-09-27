# Messerschmitt Bf 109 E-4 "Emil" (1940-41), parked airfield dressing, three-point attitude.
# blender -b --factory-startup --python bf109.py -- grey|dak|winter|burnt|all
# Real: length 8.64 m, span 9.87 m, height 2.60 m (3-point), wing 16.35 m2, track 1.97 m, VDM 3-blade 3.10 m prop,
# ground angle ~13 deg. Squared wing tips, underwing radiators, chin oil cooler, strut-braced tailplane, framed canopy
# hinged to starboard, supercharger intake on the port cowl, 2x MG 17 cowl + 2x MG FF wing cannon.
# Schemes: grey = RLM 02/71 splinter over RLM 65 with mottled sides (1940); dak = RLM 79/78 + white theatre band,
# white wing-tip undersides and spinner tip (E-7/trop); winter = white distemper; burnt = gear collapsed wreck.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ac as AC
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
R = AC.RLM
TS = 0.955                     # tail-group compression (fin / stab / tail wheel spacing)
TM = 0.77                      # rework 2: rear fuselage 0.5..3.2 compressed harder (body length 9.19 -> ~8.70 m)


def ty(y):
    """Stations aft of the wing root are compressed so the overall length matches the E-4 (8.64 m): the mid rear
    fuselage (0.5..3.2) by TM, the tail group beyond it keeps its proportions (TS) and just moves forward."""
    if y < 0.5:
        return y
    if y <= 3.2:
        return 0.5 + (y - 0.5) * TM
    return 0.5 + 2.7 * TM + (y - 3.2) * TS


SCHEME = {'grey': {'top': ('splinter', R['02'], R['71']), 'side': ('solid', R['65']), 'bottom': ('solid', R['65']),
                   'mottle': (R['02'], 0.8)},
          'dak': {'top': ('solid', R['79']), 'side': ('solid', R['79']), 'bottom': ('solid', R['78'])}}
SCHEME['winter'] = SCHEME['grey']
PLANES = [((0, -1.0, 0), (0.82, 0.5, 0.25)), ((0, 0.6, 0), (-0.7, 0.62, 0.2)), ((2.5, -0.8, 0), (0.95, -0.25, 0.1)),
          ((-2.6, -0.4, 0), (0.9, 0.35, 0.1)), ((0, 2.4, 0), (0.45, 0.9, 0.3)), ((0, -3.0, 0), (0.3, 0.95, 0.1))]
BANDS = [(1, ty(2.45), ty(2.95), R['white'], ('top', 'side', 'bottom'), ('dak',)),
         (0, 4.25, 9.0, R['white'], ('bottom',), ('dak',))]
ZT = 1.55                      # thrust line (body frame)
CAMBER = 8.0                   # main wheel camber (deg, tops inward), follows the splayed legs
CPY = (-1.72, -0.86)           # hood (cockpit opening) y range
HINGE = ((-0.35, -1.72, 2.05), (-0.34, -0.86, 2.04))
FUS = [(-3.95, ZT, 0.56, 0.60, 2.2), (-3.7, ZT - 0.02, 0.78, 0.92, 2.3), (-3.3, ZT - 0.03, 0.86, 1.10, 2.4),
       (-3.0, ZT - 0.04, 0.88, 1.18, 2.5), (-2.55, ZT - 0.05, 0.91, 1.24, 2.7), (-2.1, ZT - 0.06, 0.92, 1.28, 2.8),
       (-1.2, ZT - 0.10, 0.90, 1.22, 2.8), (0.0, ZT - 0.10, 0.82, 1.12, 2.6), (ty(0.75), ZT - 0.06, 0.73, 1.03, 2.45),
       (ty(1.5), ZT - 0.02, 0.62, 0.92, 2.3), (ty(2.25), ZT + 0.04, 0.50, 0.79, 2.25), (ty(3.0), ZT + 0.10, 0.38, 0.66, 2.2),
       (ty(3.5), ZT + 0.16, 0.28, 0.56, 2.1), (ty(4.0), ZT + 0.22, 0.18, 0.46, 2.0), (ty(4.34), ZT + 0.26, 0.05, 0.26, 2.0)]
WR, WT = (0.44, -2.02, 1.02, 2.02), (4.93, -1.52, 1.53, 1.10)      # wing root / tip: x, y_le, z, chord


def wst(x0, x1, f0=0.0, f1=1.0, side=1, xs=None):
    """Wing stations over span x0..x1 (or at xs): linear taper / dihedral, thinning section, 1.5 deg washout."""
    out = []
    for x in (xs or (x0, x1)):
        t = (x - WR[0]) / (WT[0] - WR[0])
        le = V((side * x, WR[1] + (WT[1] - WR[1]) * t, WR[2] + (WT[2] - WR[2]) * t))
        ch = WR[3] + (WT[3] - WR[3]) * t
        out.append((le, ch, 0.142 - 0.03 * t, -1.5 * max(0.0, t)))
    return out


def airframe(burnt):
    skins = []
    bm = bmesh.new()
    AC.fus_bm(bm, AC.insert_stations(FUS, CPY), segs=32)
    if not burnt:
        AC.cut_opening(bm, CPY[0], CPY[1], 0.34)
    skins += AC.skin(bm, 'fuselage', 'air_skin')
    for s in (-1, 1):
        # wing: main box LE..0.72 chord, flap (inner) / aileron (outer) nodes behind
        bm = bmesh.new()
        AC.wing_bm(bm, wst(0, 0, side=s, xs=[0.3, 0.8, 1.4, 2.0, 2.7, 3.4, 4.1, 4.75]), f1=0.74, n=16)
        skins += AC.skin(bm, 'wing', 'air_skin', camo_cut=True)
        tip = wst(0, 0, side=s, xs=[4.75, 4.84, 4.90, 4.94])  # squared E tip with rounded corners
        bm = bmesh.new()
        AC.wing_bm(bm, [(tip[0][0], tip[0][1], 0.11, tip[0][3]), (tip[1][0] + V((0, 0.03, 0)), tip[1][1] * 0.94, 0.10, tip[1][3]),
                        (tip[2][0] + V((0, 0.08, 0)), tip[2][1] * 0.84, 0.09, tip[2][3]),
                        (tip[3][0] + V((0, 0.16, 0)), tip[3][1] * 0.66, 0.07, tip[3][3])], n=14)
        skins += AC.skin(bm, 'wingtip', 'air_skin')
        # MG FF ammunition-drum blister under the wing, aileron mass balance, flap / radiator hinge detail
        P('paint_under', AC.spinner_bm, (s * 2.35, -1.55, 1.13), (0, 1, 0), 0.10, 0.5, 12, 4, 0.25, name='mgff_blister', smooth=True)
        P('paint', beam, (s * 3.9, -0.64, 1.36), (s * 3.9, -0.86, 1.27), 0.025, 0.025, name='aileron_balance', node='aileron_' + ('l' if s > 0 else 'r'))
        P('paint', cyl, (s * 3.9, -0.84, 1.28), (s * 3.9, -0.94, 1.25), 0.03, 8, name='aileron_balance_wt', node='aileron_' + ('l' if s > 0 else 'r'))
        side = 'l' if s > 0 else 'r'
        for nm, x0, x1, lim in (('flap', 0.5, 3.0, (0, 42)), ('aileron', 3.05, 4.72, (-22, 22))):
            st = wst(x0, x1, 0.74, 1.0, s)
            node = '%s_%s' % (nm, side)
            h0 = st[0][0] + V((0, st[0][1] * 0.74, 0))
            h1 = st[1][0] + V((0, st[1][1] * 0.74, 0))
            piv = AC.hinge(node, h0, h1, nm, lim)
            bm = bmesh.new()
            AC.wing_bm(bm, st, f0=0.745, f1=1.0, n=4)
            AC.skin(bm, node, 'air_fabric' if nm == 'aileron' else 'air_skin', node=node, pivot=piv)
        # automatic leading-edge slat (outer wing)
        st = wst(2.9, 4.7, 0.0, 0.14, s)
        bm = bmesh.new()
        AC.wing_bm(bm, [(q[0] + V((0, -0.01, 0.005)), q[1], 0.15, 0) for q in st], f1=0.12, n=5)
        sp = tuple((st[0][0] + st[1][0]) / 2)            # pivot on the slat's own leading edge, mid-span
        AC.skin(bm, 'slat_%s' % side, 'air_skin', node='slat_%s' % side, pivot=sp)
        VH.moving('slat_%s' % side, 'slat', sp, (0, -0.966, -0.259), None, travel_m=0.08, motion='translate',
                  note='extends forward-down along its tracks by travel_m (node-local axis)')
        # wheel well (dark recess outline on the wing underside, gear retracts outward)
        P('black', box, (s * 0.95, -1.45, 0.87), (0.62, 0.40, 0.01), name='wheel_well', lod='drop')
        # wing-root fillet
        bm = bmesh.new()
        AC.wing_bm(bm, [(V((s * 0.36, -2.05, 1.05)), 2.2, 0.16, 0), (V((s * 0.62, -1.98, 1.06)), 2.05, 0.15, 0)], n=8)
        AC.skin(bm, 'fillet', 'air_skin')
        # underwing radiator
        P('paint', VH.bevel_box, (s * 1.75, -1.05, 0.86), (0.52, 0.95, 0.20), 0.05, 1, name='radiator')
        P('black', box, (s * 1.75, -1.53, 0.86), (0.44, 0.02, 0.12), name='radiator_mouth')
        P('paint', box, (s * 1.75, -0.52, 0.84), (0.48, 0.12, 0.03), name='radiator_flap')
        # MG FF cannon barrel in the wing
        P('gunmetal', cyl, (s * 2.35, -2.02 + 0.08 * 0.5, 1.10), (s * 2.35, -2.28, 1.10), 0.028, 8, name='mgff')
        VH.socket('muzzle_mgff_%s' % side, (s * 2.35, -2.29, 1.10), (0, -1, 0), kind='muzzle', weapon='MG FF 20 mm')
    # tailplane + elevators, fin + rudder
    for s in (-1, 1):
        st = [(V((s * 0.15, ty(3.30), 2.05)), 0.95, 0.10, 0), (V((s * 1.52, ty(3.55), 2.08)), 0.55, 0.08, 0)]
        bm = bmesh.new()
        AC.wing_bm(bm, st, f1=0.66, camber=0.0)
        skins += AC.skin(bm, 'stab', 'air_skin')
        node = 'elevator_%s' % ('l' if s > 0 else 'r')
        piv = AC.hinge(node, st[0][0] + V((0, 0.95 * 0.66, 0)), st[1][0] + V((0, 0.55 * 0.66, 0)), 'elevator', (-30, 25))
        bm = bmesh.new()
        AC.wing_bm(bm, st, f0=0.665, f1=1.0, n=4, camber=0.0)
        AC.skin(bm, node, 'air_fabric', node=node, pivot=piv)
        AC.strut((s * 0.18, ty(3.55), 1.45), (s * 0.95, ty(3.62), 2.03), 0.05, name='stab_strut')
    fin = [(V((0, ty(3.28), 1.95)), 1.05, 0.11, 0), (V((0, ty(3.78), 2.95)), 0.42, 0.08, 0)]
    bm = bmesh.new()
    AC.wing_bm(bm, fin, f1=0.62, camber=0.0, cdir=(0, 1, 0), udir=(1, 0, 0))
    skins += AC.skin(bm, 'fin', 'air_skin')
    piv = AC.hinge('rudder', fin[0][0] + V((0, 1.05 * 0.62, -0.35)), fin[1][0] + V((0, 0.42 * 0.62, 0.02)), 'rudder', (-30, 30))
    bm = bmesh.new()
    AC.wing_bm(bm, [(fin[0][0] + V((0, 0.0, -0.40)), 1.12, 0.10, 0), fin[1]], f0=0.62, f1=1.0, n=4, camber=0.0, cdir=(0, 1, 0), udir=(1, 0, 0))
    AC.skin(bm, 'rudder', 'air_fabric', node='rudder', pivot=piv)
    return skins


def nose(burnt):
    hub = (0, -3.98, ZT)
    AC.prop('prop', hub, (0, 1, 0), 1.55, 3, chord=0.24, spin_r=0.29, spin_len=0.43, kind='prop', bent=0.35 if burnt else 0.0,
            spin_kind='paint')
    if AC.CUR['var'] == 'dak':          # white spinner tip (Mediterranean theatre)
        P('white', AC.spinner_bm, (0, -4.24, ZT), (0, -1, 0), 0.17, 0.18, 12, 4, name='spinner_tip', node='prop', pivot=hub)
    for s in (-1, 1):
        # 6 separate ejector stubs per bank (DB 601A inverted V12), on a dark exhaust plate, spaced 0.135 m, each a
        # short flattened tube raked aft and down, with a black mouth; light soot streak on the cowl aft of them
        P('soot', box, (s * 0.445, -3.08, ZT - 0.06), (0.012, 0.86, 0.10), name='exhaust_plate')
        for i in range(6):
            y = -3.44 + i * 0.135
            b0 = V((s * 0.445, y, ZT - 0.05))
            b1 = V((s * 0.545, y + 0.05, ZT - 0.10))
            # rework 2: round-section, heat-blued / sooted steel stubs (not saturated rust) with a black bore
            P('heat_steel', cyl, b0, b1, 0.030, 8, name='exhaust_stub')
            P('black', cyl, b1 - (b1 - b0).normalized() * 0.004, b1 + (b1 - b0).normalized() * 0.003, 0.021, 8,
              name='exhaust_mouth', lod='drop')
        VH.emitter('exhaust', (s * 0.55, -3.1, ZT - 0.1), (s, 0.3, -0.2), node=None, bank='l' if s > 0 else 'r')
    # supercharger air intake: a round scoop on the PORT (+x) side only, above/behind the exhausts
    ic = V((0.46, -2.72, ZT + 0.13))
    bm = bmesh.new()
    AC.fus_bm(bm, [(-2.98, ic.z, 0.15, 0.15, 2.0, 0.515), (-2.90, ic.z, 0.19, 0.19, 2.0, 0.515),
                   (-2.62, ic.z, 0.17, 0.17, 2.0, 0.50), (-2.42, ic.z - 0.01, 0.08, 0.08, 2.0, 0.465)], segs=14)
    AC.skin(bm, 'sc_intake', 'air_skin', uv='aligned', camo_cut=False, sharp=60)
    P('black', cyl, (0.515, -2.99, ic.z), (0.515, -2.95, ic.z), 0.068, 14, name='sc_intake_mouth')
    if AC.CUR['var'] == 'dak':          # E-7/Trop: tropical sand filter housing over the supercharger intake
        fx = 0.535
        bm = bmesh.new()
        AC.fus_bm(bm, [(-3.30, ic.z, 0.20, 0.22, 3.0, fx), (-3.26, ic.z, 0.25, 0.27, 3.5, fx),
                       (-2.80, ic.z, 0.25, 0.27, 3.5, fx), (-2.62, ic.z - 0.01, 0.20, 0.20, 2.6, 0.51),
                       (-2.45, ic.z - 0.01, 0.09, 0.09, 2.0, 0.47)], segs=16)
        AC.skin(bm, 'trop_filter', 'air_skin', uv='aligned', camo_cut=False, sharp=40)
        P('black', box, (fx, -3.305, ic.z), (0.17, 0.01, 0.19), name='trop_filter_grille')
        for k in range(4):                               # grille bars + clamp band
            P('paint', box, (fx, -3.31, ic.z - 0.075 + k * 0.05), (0.18, 0.012, 0.012), name='trop_filter_bar', lod='drop')
        P('black', box, (fx + 0.12, -3.0, ic.z), (0.01, 0.03, 0.26), name='trop_filter_clamp', lod='drop')
    P('paint', VH.bevel_box, (0, -3.15, ZT - 0.62), (0.34, 0.55, 0.16), 0.05, 1, name='oil_cooler')
    P('black', box, (0, -3.43, ZT - 0.62), (0.28, 0.01, 0.1), name='oil_cooler_mouth')
    for s in (-1, 1):
        P('gunmetal', cyl, (s * 0.16, -3.55, ZT + 0.46), (s * 0.16, -3.78, ZT + 0.40), 0.018, 6, name='mg17')
        P('black', box, (s * 0.16, -3.2, ZT + 0.58), (0.06, 0.8, 0.02), name='mg17_trough')
        VH.socket('muzzle_mg17_%s' % ('l' if s > 0 else 'r'), (s * 0.16, -3.8, ZT + 0.40), (0, -1, 0), kind='muzzle', weapon='MG 17 7.92 mm')
    VH.emitter('prop_wash', (0, -3.5, 0.05), (0, 1, 0), radius=3.0, note='dust/snow blown aft while the engine runs')


def canopy(burnt):
    zs = 2.05
    ws = [(-0.31, -2.05, zs + 0.02), (0.31, -2.05, zs + 0.02), (0.21, -1.72, 2.40), (-0.21, -1.72, 2.40)]
    hood = [(-0.35, -1.72, zs), (0.35, -1.72, zs), (0.21, -1.72, 2.40), (-0.21, -1.72, 2.40),
            (-0.34, -0.86, zs - 0.01), (0.34, -0.86, zs - 0.01), (0.19, -0.86, 2.36), (-0.19, -0.86, 2.36)]
    rear = [(-0.34, -0.86, zs - 0.01), (0.34, -0.86, zs - 0.01), (0.19, -0.86, 2.36), (-0.19, -0.86, 2.36),
            (-0.30, -0.25, zs - 0.03), (0.30, -0.25, zs - 0.03), (-0.1, -0.25, zs + 0.02), (0.1, -0.25, zs + 0.02)]
    # windscreen (fixed): front armoured glass + side panes
    AC.G_(AC.hull_bm, [V(p) for p in ws] + [V((-0.35, -1.72, zs)), V((0.35, -1.72, zs))], name='windscreen')
    AC.frame_bars([V(p) for p in ws], 0.035, name='ws_frame')
    for s in (-1, 1):
        AC.frame_bars([V((s * 0.31, -2.05, zs + 0.02)), V((s * 0.35, -1.72, zs)), V((s * 0.21, -1.72, 2.40))], 0.035, closed=False)
    piv = AC.hinge('canopy', HINGE[0], HINGE[1], 'canopy', (0, 100), rest_deg=100,
                   note='hinged to starboard; REST POSE = OPEN (parked). Rotate -100 deg about local X to close.')
    AC.G_(AC.hull_bm, [V(p) for p in hood], name='hood_glass', node='canopy', pivot=piv)
    for a, b in ((2, 3), (6, 7), (2, 6), (3, 7), (0, 4), (1, 5), (0, 3), (1, 2), (4, 7), (5, 6)):
        P('paint', beam, hood[a], hood[b], 0.04, 0.025, name='hood_frame', node='canopy', pivot=piv)
    for s in (-1, 1):                    # horizontal glazing bar on each side panel
        P('paint', beam, (s * 0.29, -1.72, 2.22), (s * 0.28, -0.86, 2.19), 0.03, 0.02, name='hood_bar', node='canopy', pivot=piv)
    P('paint', box, (0, -0.93, 2.20), (0.34, 0.025, 0.30), name='head_armour', node='canopy', pivot=piv)
    P('black', box, (0, -0.915, 2.20), (0.36, 0.01, 0.32), name='head_armour_rim', node='canopy', pivot=piv)
    AC.G_(AC.hull_bm, [V(p) for p in rear], name='rear_glass')
    AC.frame_bars([V(rear[2]), V(rear[6]), V(rear[7]), V(rear[3])], 0.035, closed=False)
    # cockpit (RLM 02 tub): armoured seat with harness, panel with dials, Revi C/12C reflector sight, stick, pedals
    AC.cockpit_tub(FUS, CPY[0] - 0.08, CPY[1] + 0.1, 0.33, shrink=0.93, segs=24)
    P('rlm02', box, (0, -1.08, 1.66), (0.40, 0.40, 0.05), name='seat_pan')
    P('rlm02', box, (0, -0.90, 1.84), (0.42, 0.05, 0.40), name='seat_back')
    for sx in (-1, 1):
        P('rlm02', box, (sx * 0.2, -1.0, 1.76), (0.02, 0.32, 0.22), name='seat_side')
        P('webbing', box, (sx * 0.09, -0.93, 1.90), (0.05, 0.02, 0.28), name='harness')
    P('webbing', box, (0, -1.08, 1.70), (0.06, 0.34, 0.02), name='harness')
    P('black', box, (0, -1.70, 1.95), (0.46, 0.04, 0.22), name='panel')
    for dx, dz in ((-0.14, 2.02), (-0.04, 2.03), (0.07, 2.02), (0.17, 2.0), (-0.1, 1.92), (0.03, 1.92), (0.13, 1.91)):
        P('lens', cyl, (dx, -1.675, dz - 0.03), (dx, -1.68, dz - 0.03), 0.026, 8, name='dial', lod='drop')
    P('rlm02', box, (0, -1.74, 2.07), (0.46, 0.10, 0.04), name='panel_coaming')
    P('black', box, (0, -1.68, 2.13), (0.07, 0.13, 0.09), name='revi_sight')
    P('lens', box, (0, -1.71, 2.22), (0.09, 0.008, 0.09), name='revi_reflector')
    P('black', cyl, (0, -1.46, 1.52), (0, -1.50, 1.86), 0.016, 6, name='stick')
    P('black', box, (0, -1.50, 1.88), (0.05, 0.04, 0.07), name='stick_grip')
    for sx in (-1, 1):
        P('black', box, (sx * 0.12, -1.68, 1.58), (0.08, 0.03, 0.12), name='rudder_pedal')
    # modelled with the hood swung OPEN to starboard (parked): rotate every hood part about the hinge
    Rh = Matrix.Rotation(math.radians(-100), 4, V(HINGE[1]) - V(HINGE[0]))
    Th = Matrix.Translation(V(HINGE[0])) @ Rh @ Matrix.Translation(-V(HINGE[0]))
    for o in VH.C.A.parts:
        if o.get('kit_node') == 'canopy':
            o.data.transform(Th)
    P('paint', beam, (0, -0.10, 2.02), (0, 0.02, 2.60), 0.05, 0.02, name='antenna_mast')
    P('black', beam, (0, 0.02, 2.58), (0, ty(3.80), 2.93), 0.008, 0.008, name='antenna_wire', lod='drop')
    VH.socket('pilot', (0, -1.10, 1.95), (0, -1, 0), node=None, pose='sit_pilot', role='pilot')
    VH.socket('mechanic_wingroot', (0.75, -1.2, 1.25), (0, -1, 0), pose='stand', role='ground_crew')


def gear(burnt):
    if burnt:
        for s in (-1, 1):                 # legs sheared, stubs only
            P('paint', cyl, (s * 0.52, -1.55, 1.02), (s * 0.62, -1.62, 0.78), 0.05, 8, name='leg_stub')
        return
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        hub = V((s * 0.99, -1.66, 0.32))
        top = V((s * 0.52, -1.55, 1.02))
        P('paint', cyl, top, hub + V((-s * 0.10, 0, 0.12)), 0.05, 10, name='oleo')
        P('alu', cyl, hub + V((-s * 0.10, 0, 0.12)), hub + V((-s * 0.13, 0, 0.0)), 0.035, 8, name='oleo_slider')
        # leg fairing plate (gear door) outboard of the leg
        d = (hub - top).normalized()
        bm = bmesh.new()
        n = V((s, 0, 0)).cross(d).cross(d).normalized() * -1
        c = (top + hub) / 2 + V((s * 0.05, -0.03, 0.06))
        u = d
        w = V((0, 1, 0))
        pts = [c - u * 0.42 - w * 0.17, c + u * 0.30 - w * 0.19, c + u * 0.30 + w * 0.19, c - u * 0.42 + w * 0.17]
        VH.C.quad(bm, pts)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
        AC.skin(bm, 'gear_door', 'air_skin', sharp=60)
        VH.wheel('wheel_' + side, hub, 0.325, 0.15, 0.20, s, style='disc', lug=0.0)
        # rework 2: splayed legs -> wheel camber (tops lean in toward the fuselage, like the leg), axle frame tilted
        cam = math.radians(-s * CAMBER)
        Rc = Matrix.Translation(hub) @ Matrix.Rotation(cam, 4, 'Y') @ Matrix.Translation(-hub)
        for o in VH.C.A.parts:
            if o.get('kit_node') == 'wheel_' + side:
                o.data.transform(Rc)
        ax = Matrix.Rotation(cam, 3, 'Y') @ V((1, 0, 0))
        AC.FRAMES['wheel_' + side] = AC.frame_for(ax)
        VH.VM['moving'][-1]['axis_world'] = VH.Gd(ax)
        VH.VM['moving'][-1]['camber_deg'] = CAMBER
    # tail wheel (castoring)
    tw = V((0, ty(3.97), 1.42))
    P('paint', cyl, (0, ty(3.92), 1.62), (0, ty(3.95), 1.46), 0.035, 8, name='tailwheel_leg', node='tailwheel_fork', pivot=(0, ty(3.92), 1.5))
    VH.moving('tailwheel_fork', 'castor', (0, ty(3.92), 1.5), (0, 0, 1), (-180, 180))
    VH.wheel('tailwheel', tw, 0.145, 0.11, 0.08, 1, style='disc', lug=0.0)
    AC.PARENTS['tailwheel'] = 'tailwheel_fork'
    for p in ('wheel_l', 'wheel_r'):
        VH.emitter('dust', V(VH.VM['contacts'][0]['pos']) * 0 + V((0.99 if p == 'wheel_l' else -0.99, -1.3, 0.05)), (0, 1, 0.3))


def markings(skins):
    fus = [o for o in skins if o.name.startswith('fuselage')]
    wings = [o for o in VH.C.A.parts if o.name.startswith(('wing', 'aileron', 'flap'))]
    for s in (-1, 1):
        AC.cross(fus, (s * 0.5, ty(1.15), ZT + 0.02), (s, 0, 0), 0.82, up=(0, 0, 1))
        AC.cross(wings, (s * 3.55, -1.05, 1.9), (0, 0, 1), 0.92, up=(0, 1, 0))
        AC.cross(wings, (s * 3.35, -1.05, 0.9), (0, 0, -1), 1.05, up=(0, 1, 0))
        # tactical number ahead of the cross (E-4 style: ~0.65 m block numeral with a thin contrasting outline) and the
        # II. Gruppe bar behind it. grey: black '7' outlined white (reads on the pale 65 / mottled sides);
        # dak: 3. Staffel yellow outlined black.
        col, out = {'dak': ('yellow', 'black')}.get(AC.CUR['var'], ('black', 'white'))
        AC.letters(fus, '7', (s * 0.5, 0.22, ZT - 0.02), (s, 0, 0), 0.66, up=(0, 0, 1), kind=col, outline=out, outline_w=0.2)
        if AC.CUR['var'] != 'burnt':               # exhaust soot stain streaking back along the cowl side
            AC._proj_quad(AC._bvh(fus), V((s * 0.47, -2.72, ZT - 0.09)), V((0, 1, 0)), V((0, 0, 1)), V((s, 0, 0)), 1.25,
                          0.13, 0.004, 'soot_stain', 'main', 8, 2, name='exhaust_stain')
        AC.letters(fus, '-', (s * 0.5, ty(2.1), ZT + 0.04), (s, 0, 0), 0.62, up=(0, 0, 1), kind=col, outline=out, outline_w=0.2)


def main(var, out_root):
    AC.setup('bf109_e', var, SCHEME, PLANES, BANDS, seed=109)
    burnt = var == 'burnt'
    skins = airframe(burnt)
    nose(burnt)
    canopy(burnt)
    gear(burnt)
    markings(skins)
    if var != 'burnt':                     # yellow B4 '87' fuel triangle below the cockpit (port)
        bm = bmesh.new()
        c = V((0.445, -0.55, ZT + 0.05))
        vs = [bm.verts.new(c + V((0, -0.12, -0.1))), bm.verts.new(c + V((0, 0.12, -0.1))), bm.verts.new(c + V((0, 0, 0.12)))]
        bm.faces.new(vs)
        VH.vp(bm, 'yellow', 'fuel_triangle', lod='drop')
    P('alu', cyl, (0.3 + 4.3, -1.75, 1.47), (0.3 + 4.3, -2.25, 1.47), 0.012, 6, name='pitot')
    AC.nav_lights((4.93, -1.0, 1.53), (-4.93, -1.0, 1.53), (0, ty(4.36), 1.85))
    VH.emitter('fire', (0, -2.8, ZT), (0, 0, 1), when='destroyed', note='engine / fuel tank under the seat')
    VH.emitter('fuel_leak', (0, -0.8, 1.1), (0, 0, -1), when='damaged')
    if burnt:
        VH.emitter('smoke', (0, -2.5, 1.2), (0, 0, 1), kind2='wreck_smoulder')
        T = Matrix.Rotation(math.radians(3.5), 4, 'Y') @ Matrix.Rotation(math.radians(-2.0), 4, 'X')
        AC.transform_all(T)
        zmin = min(v.co.z for o in VH.C.A.parts for v in o.data.vertices)
        AC.transform_all(Matrix.Translation((0, 0, -zmin - 0.03)))
        AC.recentre(True)
        ang = 0.0
    else:
        ang = AC.level((0.99, -1.66, 0.32), 0.325, (0, ty(3.97), 1.42), 0.145, sym=True)
    dims = {'length': 8.64, 'span': 9.87, 'height_3pt': 2.60, 'track': 1.97, 'prop_d': 3.10}
    fp = [(-5.0, -2.2), (5.0, -2.2), (5.0, -0.2), (0.6, 0.2), (0.6, 4.4), (-0.6, 4.4), (-0.6, 0.2), (-5.0, -0.2)]
    AC.vfin(os.path.join(out_root, 'bf109_e'), 'bf109', dims, variants=ALL, footprint=None,
            extra={'real_name': 'Messerschmitt Bf 109 E-4', 'destroyed': burnt, 'ground_angle_deg': round(ang, 2),
                   'rotation_order': 'YXZ', 'side': 'axis', 'role': 'parked airfield dressing (not flyable)',
                   'paint_scheme': {'grey': 'RLM 02/71 splinter over RLM 65, mottled sides', 'dak': 'RLM 79/78, white band + tips',
                                    'winter': 'white distemper over 02/71', 'burnt': 'wreck'}[var]})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))
