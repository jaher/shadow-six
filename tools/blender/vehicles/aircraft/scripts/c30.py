# Focke-Wulf C 30 "Heuschrecke" = licence-built Cierva C.30A autogiro (Luftwaffe liaison/observation, 1935-45):
# the rotorcraft for the M5 summit escape (Norway, May 1941). Parked, three-point, rotor spread (blades droop at rest).
# blender -b --factory-startup --python c30.py -- grey|dak|winter|burnt|all
# Real (C.30A): rotor 11.28 m (3 blades, chord 0.254 m, flapping hinges, droop at rest), length 6.01 m, height 3.38 m,
# empty 553 kg; Siemens-Halske Sh 14A 7-cyl radial (Fw C 30; Genet Major IA on the British C.30A), 2-blade wooden prop
# ~2.4 m, fabric over steel tube, two open tandem cockpits (passenger front under the tripod pylon, pilot rear flying
# with the hanging 'direct control' column that tilts the rotor head), tailplane with upturned tip fins, long-stroke
# wide-track main gear, tail wheel. No ailerons / elevators: control is rotor tilt (+ small rudder).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ac as AC
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
R = AC.RLM
# grey: RLM 71/02 splinter over 65 (the lighter 1939-41 scheme; reads at 2x zoom, 70/71 went black-on-black)
SCHEME = {'grey': {'top': ('splinter', R['71'], R['02']), 'side': ('splinter', R['71'], R['02']), 'bottom': ('solid', R['65'])},
          'dak': {'top': ('solid', R['79']), 'side': ('solid', R['79']), 'bottom': ('solid', R['78'])}}
SCHEME['winter'] = SCHEME['grey']
PLANES = [((0, -1.8, 0), (0.6, 0.75, 0.3)), ((0, 0.4, 0), (-0.65, 0.7, 0.3)), ((0, 2.0, 0), (0.5, 0.85, 0.2)),
          ((0.8, 0.0, 0), (0.95, 0.3, 0.05))]
BANDS = [(1, 1.95, 2.22, R['white'], ('top', 'side', 'bottom'), ('dak',))]
ZT = 1.25
FUS = [(-2.62, ZT, 0.78, 0.86, 3.0), (-2.2, ZT + 0.02, 0.86, 0.98, 3.4), (-1.3, ZT + 0.04, 0.88, 1.02, 3.6),
       (0.0, ZT + 0.06, 0.80, 0.96, 3.4), (1.4, ZT + 0.14, 0.54, 0.74, 2.8), (2.75, ZT + 0.24, 0.20, 0.40, 2.2),
       (3.05, ZT + 0.27, 0.06, 0.20, 2.0)]
HUB = V((0, -1.30, ZT + 2.16))        # rotor head: 3.38 m overall height (to the hub cap) at rest
MWZ, MY, TWZ, TY = 0.32, -1.45, ZT - 0.08, 2.85
PITS = [(-1.75, -1.05), (-0.45, 0.25)]           # front (passenger) / rear (pilot) cockpit y ranges
KY = 0.925                                        # body-axis scale (6.5 -> 6.01 m)
MY_S, TY_S = HUB.y + (MY - HUB.y) * KY, HUB.y + (TY - HUB.y) * KY


def top_z(y):
    for a, b in zip(FUS[:-1], FUS[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return a[1] + (b[1] - a[1]) * t + (a[3] + (b[3] - a[3]) * t) / 2
    return ZT


def fuselage(burnt):
    skins = []
    if burnt:
        st = FUS[1:-1]
        cs = [[V((sx * s[2] / 2, s[0], s[1] + sz * s[3] / 2)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for s in st]
        for i in range(4):
            for a, b in zip(cs[:-1], cs[1:]):
                P('paint', cyl, a[i], b[i], 0.02, 6, name='longeron')
        for k, c in enumerate(cs):
            for i in range(4):
                P('paint', cyl, c[i], c[(i + 1) % 4], 0.014, 5, name='frame')
                if k + 1 < len(cs):
                    P('paint', cyl, c[i], cs[k + 1][(i + 1) % 4], 0.012, 5, name='diagonal')
        return skins
    bm = bmesh.new()
    AC.fus_bm(bm, AC.insert_stations(FUS, [y for p in PITS for y in p]), segs=24)
    # open cockpits: cut the decking, lay a padded leather coaming exactly on the cut edge, inner tub (a shrunk copy
    # of the fuselage section, so nothing can poke through the fabric), small curved celluloid windscreens
    rims = []
    for y0, y1 in PITS:
        rims += AC.cut_opening(bm, y0, y1, 0.27, nz=0.35)
    skins += AC.skin(bm, 'fuselage', 'air_fabric')
    for a, b in rims:
        P('leather', beam, a, b, 0.05, 0.035, name='coaming')
    for y0, y1 in PITS:
        zt = top_z((y0 + y1) / 2)
        AC.cockpit_tub(FUS, y0 - 0.06, y1 + 0.06, 0.27, shrink=0.93, kind='rlm02', segs=20, nz=0.35)
        windscreen(y0 - 0.03)
        P('leather', box, (0, y0 + 0.40, zt - 0.46), (0.40, 0.34, 0.12), name='seat')
        P('leather', box, (0, y1 - 0.10, zt - 0.36), (0.40, 0.07, 0.34), name='seat_back')
        P('black', box, (0, y0 + 0.06, zt - 0.16), (0.36, 0.03, 0.14), name='panel')
    return skins


def windscreen(y):
    """Small curved celluloid screen on the decking ahead of a cockpit: 7-post arc bulging forward, raked aft."""
    import bmesh as _bm
    st = [s for s in FUS if s[0] <= y][-1]
    bm = _bm.new()
    bot, top = [], []
    for i in range(7):
        a = math.radians(-62 + 124 * i / 6)
        x = 0.21 * math.sin(a)
        yy = y + 0.10 - 0.12 * math.cos(a)
        w2 = st[2] / 2
        zs = top_z(yy) - (st[3] / 2) * (1 - (1 - min(0.99, abs(x) / w2) ** st[4]) ** (1 / st[4])) - 0.01
        bot.append(bm.verts.new((x, yy, zs)))
        top.append(bm.verts.new((x * 0.9, yy + 0.09, zs + 0.16)))
    for i in range(6):
        bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    tp, bp = [v.co.copy() for v in top], [v.co.copy() for v in bot]
    _bm.ops.solidify(bm, geom=bm.faces[:], thickness=0.006)
    VH.vp(bm, 'glass', 'windscreen', smooth=True, recalc=False) if AC.CUR['var'] != 'burnt' else bm.free()
    for i in range(6):
        P('black', beam, tp[i], tp[i + 1], 0.014, 0.01, name='ws_frame')
    for i in (0, 6):
        P('black', beam, bp[i], tp[i], 0.014, 0.01, name='ws_frame')


def engine(burnt):
    hub = V((0, -3.22, ZT))
    AC.radial_engine('main', (0, -2.85, ZT), (0, -1, 0), 0.52, ncyl=7, cyl_r=0.065, burnt=burnt)
    P('paint', cyl, (0, -2.66, ZT), (0, -2.60, ZT), 0.42, 20, name='firewall_ring')
    AC.prop('prop', hub, (0, 1, 0), 1.20, 2, chord=0.17, spin_r=0.09, spin_len=0.12, kind='prop' if not burnt else 'soot',
            phase=0.3)
    if burnt:
        for o in [o for o in VH.C.A.parts if o.name.startswith('prop_blade')]:
            for v in o.data.vertices:
                d = v.co - hub
                if d.length > 0.35:
                    v.co = hub + d.normalized() * 0.35
    P('soot', VH.ring_torus, (0, -2.68, ZT), 0.46, 0.035, (0, 1, 0), 20, 5, name='exhaust_collector')
    P('soot', beam, (0.3, -2.68, ZT - 0.35), (0.35, -1.2, ZT - 0.5), 0.06, 0.06, name='exhaust_pipe')
    VH.emitter('exhaust', (0.35, -1.2, ZT - 0.5), (0, 1, -0.2))
    VH.emitter('prop_wash', (0, -2.8, 0.05), (0, 1, 0), radius=2.4)
    VH.emitter('fire', (0, -2.4, ZT), (0, 0, 1), when='destroyed')


def rotor(burnt):
    # tripod pylon (streamlined struts) + rotor head + hanging control column
    for p0 in ((0.40, -1.80, top_z(-1.80) - 0.08), (-0.40, -1.80, top_z(-1.80) - 0.08), (0, -0.95, top_z(-0.95) - 0.02)):
        AC.strut(p0, HUB - V((0, 0, 0.14)), 0.075, name='pylon_leg')
    P('paint', cyl, HUB - V((0, 0, 0.18)), HUB - V((0, 0, 0.02)), 0.09, 12, name='rotor_bearing')
    P('black', beam, HUB - V((0, -0.05, 0.12)), (0, -0.15, top_z(-0.15) + 0.42), 0.035, 0.035, name='control_column')
    P('black', cyl, (-0.12, -0.15, top_z(-0.15) + 0.42), (0.12, -0.15, top_z(-0.15) + 0.42), 0.02, 6, name='column_grip')
    node = 'rotor'
    P('metal', cyl, HUB - V((0, 0, 0.02)), HUB + V((0, 0, 0.14)), 0.12, 14, name='rotor_hub', node=node, pivot=tuple(HUB))
    P('metal', AC.spinner_bm, HUB + V((0, 0, 0.14)), (0, 0, 1), 0.12, 0.1, 12, 3, name='hub_cap', node=node, pivot=tuple(HUB))
    droop = 1.5                                         # coning of the flapping hinges at rest (deg) + blade sag
    for b in range(3):
        a = math.radians(90 + 120 * b)
        rd = V((math.cos(a), math.sin(a), -math.tan(math.radians(droop)))).normalized()
        P('metal', beam, HUB + V((0, 0, 0.06)), HUB + V((0, 0, 0.06)) + rd * 0.42, 0.08, 0.06, name='blade_hinge', node=node, pivot=tuple(HUB))
        rr = (3.9, 1.4, 2.6)[b] if burnt else 5.64     # burnt: all three broken (charred wooden ribs + steel spar)
        bm = bmesh.new()                                # C.30A blade: 0.254 m chord, root cuff, thick section
        AC.blade_bm(bm, HUB + V((0, 0, 0.06)), (0, 0, 1), rd, 0.40, rr, 0.22, 0.26, 3.0, 1.0, n=9, t=0.14, tip_round=False)
        def sag(r):                                     # parked sag, identical on all blades (~0.55 m at the tip);
            q = max(0.0, r - 0.4)                       # burnt: charred blades hang ~18 deg + bend
            return 0.55 * (q / 5.24) ** 2 if not burnt else q * 0.325 + 0.05 * q * q
        for v in bm.verts:
            v.co.z -= sag((v.co - HUB).length)
        if burnt:                                       # bare steel spar sticking out of the broken end, drooping
            e0 = HUB + V((0, 0, 0.06)) + rd * (rr - 0.05)
            e0.z -= sag(rr - 0.05)
            e1 = HUB + V((0, 0, 0.06)) + rd * (rr + 0.45)
            e1.z -= sag(rr + 0.45) + 0.12
            P('heat_steel', cyl, e0, e1, 0.022, 6, name='blade_spar', node=node, pivot=tuple(HUB))
        VH.vp(bm, 'paint' if not burnt else 'soot', 'rotor_blade', node=node, pivot=tuple(HUB), smooth=True, grime=0.5)
        P('metal', beam, HUB + V((0, 0, 0.06)) + rd * 0.40, HUB + V((0, 0, 0.06)) + rd * 0.75, 0.10, 0.05, name='blade_cuff',
          node=node, pivot=tuple(HUB))
    AC.FRAMES[node] = AC.frame_for((0, 0, 1), (0, -1, 0))
    VH.moving(node, 'rotor', HUB, (1, 0, 0), None, axis_world=VH.Gd((0, 0, 1)), radius=5.64, blades=3, rpm_flight=180,
              note='autorotation: spin-up by the engine clutch before take-off, then free-wheeling')
    VH.emitter('rotor_wash', (0, -1.3, 0.05), (0, 0, 1), radius=5.6, note='dust / snow downwash while the rotor turns')


def gear(burnt):
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        hub = V((s * 1.22, MY, MWZ if not burnt else MWZ + 0.14))
        for yb in (MY - 0.4, MY + 0.35):
            AC.strut((s * 0.32, yb, ZT - 0.46), hub + V((-s * 0.07, 0, 0.02)), 0.055, name='gear_v', segs=8)
        top = V((s * 0.44, MY, ZT + 0.38))
        P('paint', cyl, top, top.lerp(hub, 0.6), 0.065, 10, name='oleo_sleeve')
        P('alu', cyl, top.lerp(hub, 0.6), hub + V((-s * 0.07, 0, 0.05)), 0.04, 8, name='oleo_piston')
        VH.wheel('wheel_' + side, hub, 0.32 if not burnt else 0.2, 0.15, 0.17, s, style='disc', lug=0.0)
        VH.emitter('dust', (s * 1.22, MY + 0.4, 0.05), (0, 1, 0.3))
    tw = V((0, TY, TWZ))
    P('paint', cyl, (0, TY - 0.15, ZT + 0.12), tw + V((0, 0, 0.06)), 0.03, 8, name='tailwheel_leg', node='tailwheel_fork',
      pivot=(0, TY - 0.1, ZT))
    VH.moving('tailwheel_fork', 'castor', (0, TY - 0.1, ZT), (0, 0, 1), (-180, 180))
    VH.wheel('tailwheel', tw, 0.11, 0.06, 0.05, 1, style='disc', lug=0.0)
    AC.PARENTS['tailwheel'] = 'tailwheel_fork'


def skel(st0, st1, f0=0.0, f1=1.0, ribs=3, node='main', pivot=None, sag=0.0):
    """Burnt tail surface: fabric gone, charred steel-tube outline (LE / TE spars) + ribs; sag (m) droops the tip."""
    def pt(st, f, t):
        return st[0] + V((0, st[1] * f, 0)) + V((0, 0, -sag * t))
    a0, a1, b0, b1 = pt(st0, f0, 0), pt(st0, f1, 0), pt(st1, f0, 1), pt(st1, f1, 1)
    kw = dict(node=node, pivot=pivot) if pivot else {}
    P('paint', cyl, a0, b0, 0.018, 6, name='skel_spar', **kw)
    P('paint', cyl, a1, b1, 0.014, 6, name='skel_spar', **kw)
    for k in range(ribs + 1):
        t = k / ribs
        P('paint', cyl, a0.lerp(b0, t), a1.lerp(b1, t), 0.011, 5, name='skel_rib', **kw)
        if k < ribs:
            P('paint', cyl, a0.lerp(b0, t), a1.lerp(b1, t + 1 / ribs), 0.009, 5, name='skel_diag', **kw)


def tail(burnt):
    skins = []
    mid = 'air_fabric'
    for s in (-1, 1):
        st = [(V((s * 0.08, 2.25, ZT + 0.30)), 0.80, 0.10, 0), (V((s * 1.30, 2.40, ZT + 0.30)), 0.62, 0.09, 0)]
        bm = bmesh.new()
        AC.wing_bm(bm, st, camber=0.03 * s)            # port half inverted camber (anti-torque)
        if burnt:
            bm.free()
            skel(st[0], st[1], ribs=4, sag=0.06)
        else:
            skins += AC.skin(bm, 'tailplane', mid)
        bm = bmesh.new()                                # upturned tip fin
        AC.wing_bm(bm, [(V((s * 1.30, 2.40, ZT + 0.28)), 0.62, 0.08, 0), (V((s * 1.42, 2.50, ZT + 0.70)), 0.42, 0.07, 0)],
                   camber=0.0, cdir=(0, 1, 0), udir=(1, 0, 0))
        if burnt:
            bm.free()
            skel((V((s * 1.30, 2.40, ZT + 0.28)), 0.62), (V((s * 1.42, 2.50, ZT + 0.70)), 0.42), ribs=2)
        else:
            skins += AC.skin(bm, 'tip_fin', mid)
    fin = [(V((0, 2.35, ZT + 0.40)), 0.72, 0.09, 0), (V((0, 2.72, ZT + 1.0)), 0.36, 0.07, 0)]
    bm = bmesh.new()
    AC.wing_bm(bm, fin, f1=0.62, camber=0.0, udir=(1, 0, 0))
    if burnt:
        bm.free()
        skel(fin[0], fin[1], 0.0, 0.62, ribs=3)
    else:
        skins += AC.skin(bm, 'fin', mid)
    h0, h1 = fin[0][0] + V((0, 0.72 * 0.62, -0.3)), fin[1][0] + V((0, 0.36 * 0.62, 0.03))
    piv = AC.hinge('rudder', h0, h1, 'rudder', (-25, 25))
    if not burnt:
        bm = bmesh.new()
        AC.wing_bm(bm, [(fin[0][0] + V((0, 0.03, -0.32)), 0.78, 0.09, 0), fin[1]], f0=0.62, f1=1.0, n=4, camber=0.0, udir=(1, 0, 0))
        AC.skin(bm, 'rudder', mid, node='rudder', pivot=piv)
    else:                                               # charred rudder frame (fabric gone)
        skel((fin[0][0] + V((0, 0.03, -0.32)), 0.78), fin[1], 0.62, 1.0, ribs=3, node='rudder', pivot=piv)
    return skins


def markings(skins):
    fus = [o for o in skins if o.name.startswith('fuselage')]
    for s in (-1, 1):
        AC.cross(fus, (s * 0.4, 0.80, ZT + 0.08), (s, 0, 0), 0.52, up=(0, 0, 1))   # flatter, taller section
        AC.letters(fus, 'CF', (s * 0.44, 0.02, ZT - 0.05), (s, 0, 0), 0.30, up=(0, 0, 1), kind='black')
        AC.letters(fus, 'HA', (s * 0.33, 1.5, ZT + 0.12), (s, 0, 0), 0.26, up=(0, 0, 1), kind='black')
    tails = [o for o in skins if o.name.startswith('tailplane')]
    for s in (-1, 1):
        AC.cross(tails, (s * 0.8, 2.6, ZT + 0.6), (0, 0, 1), 0.42, up=(0, 1, 0))


def main(var, out_root):
    AC.setup('fw_c30_autogiro', var, SCHEME, PLANES, BANDS, seed=30)
    burnt = var == 'burnt'
    skins = fuselage(burnt)
    skins += tail(burnt)
    engine(burnt)
    rotor(burnt)
    gear(burnt)
    if not burnt:
        markings(skins)
    AC.nav_lights((1.44, 2.5, ZT + 0.5), (-1.44, 2.5, ZT + 0.5), (0, 3.06, ZT + 0.3))
    VH.socket('pilot', (0, -0.1, ZT + 0.2), (0, -1, 0), pose='sit_pilot', role='pilot', note='rear cockpit, flies it')
    VH.socket('passenger', (0, -1.4, ZT + 0.2), (0, -1, 0), pose='sit', role='passenger', note='front cockpit under the pylon')
    VH.socket('board_step', (0.9, -0.8, 0.0), (1, 0, 0), pose='stand', role='exit')
    VH.emitter('fuel_leak', (0, -1.9, ZT - 0.3), (0, 0, -1), when='damaged')
    if burnt:
        VH.emitter('smoke', (0, -1.5, 1.2), (0, 0, 1), kind2='wreck_smoulder')
    # length correction (+8 % in the first build): scale the airframe along the body axis about the rotor mast so the
    # fuselage incl. prop is 6.01 m; the rotor (centred on the mast) keeps its 11.28 m diameter
    AC.scale_y(KY, HUB.y, skip_nodes=('rotor',))
    ang = AC.level((1.22, MY_S, MWZ + (0.14 if burnt else 0)), 0.32 if not burnt else 0.2, (0, TY_S, TWZ), 0.11, sym=True)
    # rework 2: levelling tilted the rotor with the airframe (15 deg aft, aft tip down at 1.2 m). Parked pose: head
    # tilted 4 deg aft, spin axis near vertical, identical sag on the three blades.
    AC.reaim('rotor', (0, math.sin(math.radians(4.0)), math.cos(math.radians(4.0))))
    dims = {'rotor_d': 11.28, 'length': 6.01, 'height': 3.38, 'prop_d': 2.40, 'track': 2.44}
    AC.vfin(os.path.join(out_root, 'fw_c30_autogiro'), 'autogyro', dims, variants=ALL,
            extra={'real_name': 'Focke-Wulf C 30 Heuschrecke (licence Cierva C.30A autogiro)', 'destroyed': burnt,
                   'ground_angle_deg': round(ang, 2), 'rotation_order': 'YXZ', 'side': 'axis',
                   'role': 'M5 summit escape rotorcraft', 'capacity': {'crew': 1, 'passengers': 1},
                   'paint_scheme': {'grey': 'RLM 70/71 splinter over RLM 65', 'dak': 'RLM 79/78 + white band',
                                    'winter': 'white distemper over 70/71', 'burnt': 'fabric burnt off, broken rotor'}[var]})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))
