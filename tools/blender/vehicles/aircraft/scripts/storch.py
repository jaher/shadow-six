# Fieseler Fi 156 C-3 Storch (1941-43) - liaison / STOL aircraft, parked, three-point attitude.
# blender -b --factory-startup --python storch.py -- grey|dak|winter|burnt|all
# Real: span 14.25 m, length 9.90 m, height 3.05 m, wing 26 m2 (constant chord ~2.1 m), Argus As 10 C inverted V8
# (240 hp) with a 2-blade wooden prop (2.6 m), welded steel-tube fuselage + wooden wing, all fabric covered; full-span
# fixed leading-edge slat, slotted flaps + drooping ailerons, strut-braced high wing, extensively glazed cabin with
# bulged side windows (3 seats in tandem, rear MG 15), long-stroke oleo main gear, sprung tail wheel.
# Burnt: fabric burnt away -> bare tube frame fuselage + charred wing ribs / spars (as photographed wrecks).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ac as AC
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
R = AC.RLM
SCHEME = {'grey': {'top': ('splinter', R['70'], R['71']), 'side': ('splinter', R['70'], R['71']), 'bottom': ('solid', R['65'])},
          'dak': {'top': ('solid', R['79']), 'side': ('solid', R['79']), 'bottom': ('solid', R['78'])}}
SCHEME['winter'] = SCHEME['grey']
PLANES = [((0, -3.0, 0), (0.6, 0.75, 0.3)), ((0, 0.5, 0), (-0.65, 0.7, 0.3)), ((0, 3.0, 0), (0.5, 0.85, 0.2)),
          ((3.2, -2.4, 0), (0.95, 0.3, 0.05)), ((-3.5, -2.4, 0), (0.9, -0.4, 0.05)), ((5.6, -2.0, 0), (0.7, 0.7, 0.05)),
          ((-5.8, -2.2, 0), (0.75, -0.62, 0.05))]
BANDS = [(1, 1.8, 2.3, R['white'], ('top', 'side', 'bottom'), ('dak',))]
ZT = 1.56
FUS = [(-4.78, ZT, 0.60, 0.66, 2.4), (-4.3, ZT + 0.02, 0.80, 0.90, 3.0), (-3.55, ZT + 0.02, 0.90, 1.08, 3.6),
       (-3.35, ZT - 0.10, 0.96, 0.90, 3.8), (-1.0, ZT - 0.08, 0.92, 0.86, 3.6), (0.5, ZT + 0.08, 0.76, 0.96, 3.0),
       (2.0, ZT + 0.24, 0.52, 0.76, 2.6), (4.2, ZT + 0.44, 0.22, 0.44, 2.2), (4.8, ZT + 0.50, 0.06, 0.24, 2.0)]
WZ, WY, WC = ZT + 1.42, -3.30, 2.10           # wing chord line z, LE y, chord
TIP = 7.12


def wst(x0, x1, f0=0.0, f1=1.0, s=1, n=2):
    out = []
    for k in range(n):
        x = x0 + (x1 - x0) * k / (n - 1)
        out.append((V((s * x, WY, WZ + 0.015 * x)), WC, 0.14, 0.0))
    return out


def airframe(burnt):
    skins = []
    if not burnt:
        bm = bmesh.new()
        AC.fus_bm(bm, FUS[3:], segs=20)
        skins += AC.skin(bm, 'fuselage', 'air_fabric', axis=(0, 1, 0))
        # rear cabin fairing: from the wing trailing edge sloping down to the rear fuselage
        bm = bmesh.new()
        AC.fus_bm(bm, [(-1.25, WZ - 0.25, 0.86, 0.34, 2.6), (0.4, ZT + 0.62, 0.68, 0.30, 2.6), (2.0, ZT + 0.56, 0.36, 0.18, 2.2)],
                  segs=14)
        skins += AC.skin(bm, 'fuselage_deck', 'air_fabric')
    else:
        skeleton()
    bm = bmesh.new()
    AC.fus_bm(bm, FUS[:3], segs=20)
    skins += AC.skin(bm, 'cowl', 'air_skin', uv='aligned')
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        if burnt:
            wing_skeleton(s)
            continue
        bm = bmesh.new()
        AC.wing_bm(bm, wst(0.0, TIP - 0.3, s=s, n=4), f1=0.70, n=12, camber=0.04)
        skins += AC.skin(bm, 'wing', 'air_fabric')
        bm = bmesh.new()
        tp = wst(TIP - 0.3, TIP, s=s)
        AC.wing_bm(bm, [(tp[0][0], WC, 0.12, 0), (tp[1][0] + V((0, 0.35, 0.02)), WC * 0.62, 0.10, 0)], n=10, camber=0.03)
        skins += AC.skin(bm, 'wingtip', 'air_fabric')
        # fixed full-span slat ahead of the leading edge (the Storch signature)
        bm = bmesh.new()
        AC.wing_bm(bm, [(q[0] + V((0, -0.16, 0.05)), 0.30, 0.16, -8) for q in wst(0.5, TIP - 0.35, s=s)], n=6, camber=0.08)
        AC.skin(bm, 'slat', 'air_skin')
        for x in (1.5, 3.5, 5.5):
            P('paint', box, (s * x, WY - 0.05, WZ + 0.03), (0.03, 0.2, 0.06), name='slat_bracket')
        # slotted flap (inner) + drooping aileron (outer), behind a slot
        for nm, x0, x1, lim in (('flap', 0.55, 4.0, (0, 40)), ('aileron', 4.05, TIP - 0.35, (-25, 20))):
            node = '%s_%s' % (nm, side)
            st = [(q[0] + V((0, WC * 0.71, -0.06)), WC * 0.30, 0.12, -2) for q in wst(x0, x1, s=s)]
            piv = AC.hinge(node, st[0][0] + V((0, 0.06, 0)), st[1][0] + V((0, 0.06, 0)), nm, lim)
            bm = bmesh.new()
            AC.wing_bm(bm, st, n=7, camber=0.04)
            AC.skin(bm, node, 'air_fabric', node=node, pivot=piv)
        # wing struts (V from the lower longeron to the spars) + jury struts
        for yb, yw in ((-2.95, -3.02), (-2.05, -1.95)):
            AC.strut((s * 0.46, yb, ZT - 0.42), (s * 3.05, yw, WZ - 0.12), 0.09, name='wing_strut')
        AC.strut((s * 1.7, -2.55, ZT + 0.35), (s * 1.75, -2.9, WZ - 0.12), 0.04, name='jury_strut')
    return skins


def skeleton():
    """Burnt fuselage: bare welded tube frame (longerons, verticals, diagonals) from the cabin back."""
    st = FUS[3:-1]
    ys = []
    for a, b in zip(st[:-1], st[1:]):
        for k in range(3):
            f = k / 3
            ys.append(tuple(a[i] + (b[i] - a[i]) * f for i in range(5)))
    ys.append(st[-1])
    def corners(s):
        y, zc, w, h = s[:4]
        return [V((-w / 2, y, zc - h / 2)), V((w / 2, y, zc - h / 2)), V((w / 2, y, zc + h / 2)), V((-w / 2, y, zc + h / 2))]
    cs = [corners(s) for s in ys]
    for i in range(4):
        for a, b in zip(cs[:-1], cs[1:]):
            P('paint', cyl, a[i], b[i], 0.018, 6, name='longeron')
    for k, c in enumerate(cs):
        for i in range(4):
            P('paint', cyl, c[i], c[(i + 1) % 4], 0.012, 5, name='frame')
            if k + 1 < len(cs):
                P('paint', cyl, c[i], cs[k + 1][(i + 1) % 4], 0.01, 5, name='diagonal')
    P('soot', box, (0, -2.2, ZT - 0.45), (0.8, 2.0, 0.05), name='floor_ash')


def wing_skeleton(s):
    """Burnt wooden wing: charred spars + broken ribs, sagging towards the tip."""
    for f, t in ((0.18, 0.08), (0.62, 0.06)):
        P('soot', beam, (s * 0.4, WY + WC * f, WZ), (s * (TIP - 0.6), WY + WC * f, WZ - 0.25), t, 0.16, name='spar')
    for k in range(18):
        x = 0.6 + k * 0.35
        if k % 4 == 3:
            continue
        sag = -0.25 * (x / TIP) ** 2
        P('soot', beam, (s * x, WY + 0.05, WZ + sag), (s * x, WY + WC * (0.95 - 0.3 * (k % 3 == 0)), WZ + sag - 0.02), 0.02, 0.12,
          name='rib')
    for yb, yw in ((-2.95, -3.02), (-2.05, -1.95)):
        AC.strut((s * 0.46, yb, ZT - 0.42), (s * 3.05, yw, WZ - 0.2), 0.08, name='wing_strut')


def nose(burnt):
    hub = V((0, -4.98, ZT))
    AC.prop('prop', hub, (0, 1, 0), 1.30, 2, chord=0.20, spin_r=0.12, spin_len=0.2, kind='prop' if not burnt else 'soot',
            bent=0.0, phase=0.5)
    if burnt:                                           # wooden prop burnt to stubs
        for o in [o for o in VH.C.A.parts if o.name.startswith('prop_blade')]:
            for v in o.data.vertices:
                d = (v.co - hub)
                if d.length > 0.45:
                    v.co = hub + d.normalized() * 0.45
    P('black', box, (0, -4.74, ZT - 0.18), (0.36, 0.02, 0.14), name='cooling_intake')
    for s in (-1, 1):
        P('soot', beam, (s * 0.36, -4.2, ZT - 0.34), (s * 0.40, -3.3, ZT - 0.45), 0.07, 0.06, name='exhaust_manifold')
        VH.emitter('exhaust', (s * 0.40, -3.3, ZT - 0.45), (0, 1, -0.3), bank='l' if s > 0 else 'r')
    VH.emitter('prop_wash', (0, -4.4, 0.05), (0, 1, 0), radius=2.6)
    VH.emitter('fire', (0, -4.0, ZT), (0, 0, 1), when='destroyed')


def cabin(burnt):
    zs, zt = ZT + 0.33, WZ - 0.13
    pts = [V((-0.47, -3.5, zs)), V((0.47, -3.5, zs)), V((-0.40, -3.25, zt)), V((0.40, -3.25, zt)),
           V((-0.62, -3.1, ZT + 0.85)), V((0.62, -3.1, ZT + 0.85)), V((-0.62, -1.2, ZT + 0.85)), V((0.62, -1.2, ZT + 0.85)),
           V((-0.46, -0.9, zs)), V((0.46, -0.9, zs)), V((-0.46, -1.1, zt)), V((0.46, -1.1, zt))]
    AC.G_(AC.hull_bm, pts, name='cabin_glass')
    for s in (-1, 1):
        for y in (-3.1, -2.45, -1.8, -1.2):             # vertical window frames following the bulge
            AC.frame_bars([V((s * 0.47, y, zs)), V((s * 0.62, y, ZT + 0.85)), V((s * 0.45, y, zt))], 0.035, closed=False)
        AC.frame_bars([V((s * 0.62, -3.1, ZT + 0.85)), V((s * 0.62, -1.2, ZT + 0.85))], 0.03, closed=False)
        AC.frame_bars([V((s * 0.47, -3.5, zs)), V((s * 0.40, -3.25, zt))], 0.04, closed=False)
    AC.frame_bars([V((-0.47, -3.5, zs)), V((0.47, -3.5, zs))], 0.04, closed=False)
    piv = AC.hinge('door_cabin', (-0.64, -2.45, zs + 0.05), (-0.64, -2.45, zt - 0.05), 'door', (0, 100),
                   note='starboard glazed door, opens outward about its forward edge')
    AC.frame_bars([V((-0.63, -2.45, zs + 0.05)), V((-0.63, -1.8, zs + 0.05)), V((-0.63, -1.8, zt - 0.05)),
                   V((-0.63, -2.45, zt - 0.05))], 0.035, node='door_cabin', name='door_frame')
    AC.G_(AC.hull_bm, [V((-0.64, -2.43, zs + 0.07)), V((-0.64, -1.82, zs + 0.07)), V((-0.64, -2.43, zt - 0.07)),
                       V((-0.64, -1.82, zt - 0.07)), V((-0.625, -2.1, ZT + 0.85))], name='door_glass', node='door_cabin', pivot=piv)
    for k, (y, role) in enumerate(((-2.95, 'pilot'), (-2.1, 'observer'), (-1.35, 'passenger'))):
        P('black', box, (0, y, ZT - 0.2), (0.42, 0.42, 0.28), name='seat')
        VH.socket(role, (0, y, ZT - 0.05), (0, -1, 0), pose='sit_pilot' if k == 0 else 'sit', role=role)
    P('black', box, (0, -3.42, ZT + 0.35), (0.6, 0.05, 0.14), name='panel')
    gp = V((0, -1.0, ZT + 0.9))                         # rear MG 15 on the cabin rear frame
    P('gunmetal', cyl, gp, gp + V((0, 0.75, 0.05)), 0.018, 6, name='mg15', node='gun_rear', pivot=tuple(gp))
    VH.moving('gun_rear', 'gun_yaw_pitch', gp, (0, 0, 1), (-30, 30), elev_deg=[-10, 45])
    VH.socket('muzzle_mg15_rear', gp + V((0, 0.76, 0.05)), (0, 1, 0.05), node='gun_rear', kind='muzzle', weapon='MG 15 7.92 mm')
    VH.socket('exit_door', (-1.4, -2.1, 0.0), (-1, 0, 0), pose='stand', role='exit')


def gear(burnt):
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        hub = V((s * 1.45, -3.05, MWZ))
        if burnt:
            hub = hub + V((-s * 0.3, 0.3, 0.2))
        for yb in (-3.35, -2.55):                        # lower V (hinged at the fuselage bottom)
            AC.strut((s * 0.30, yb, ZT - 0.52), hub + V((-s * 0.06, 0, 0.02)), 0.06, name='gear_v', segs=8)
        top = V((s * 0.52, -3.05, ZT + 0.25))           # long-stroke oleo in its streamlined sleeve
        P('paint', cyl, top, top.lerp(hub, 0.62), 0.07, 10, name='oleo_sleeve')
        P('alu', cyl, top.lerp(hub, 0.62), hub + V((-s * 0.06, 0, 0.05)), 0.04, 8, name='oleo_piston')
        VH.wheel('wheel_' + side, hub, 0.33, 0.17, 0.18, s, style='disc', lug=0.0)
        VH.emitter('dust', (s * 1.45, -2.6, 0.05), (0, 1, 0.3))
    tw = V((0, 4.25, TWZ))
    P('paint', cyl, (0, 4.05, ZT + 0.28), tw + V((0, 0, 0.08)), 0.035, 8, name='tailwheel_leg', node='tailwheel_fork',
      pivot=(0, 4.15, ZT + 0.1))
    VH.moving('tailwheel_fork', 'castor', (0, 4.15, ZT + 0.1), (0, 0, 1), (-180, 180))
    VH.wheel('tailwheel', tw, 0.12, 0.07, 0.06, 1, style='disc', lug=0.0)
    AC.PARENTS['tailwheel'] = 'tailwheel_fork'


MWZ, TWZ = 0.33, ZT - 0.06


def tail(burnt):
    skins = []
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        st = [(V((s * 0.1, 3.75, ZT + 0.58)), 1.05, 0.10, 0), (V((s * 1.75, 3.95, ZT + 0.60)), 0.75, 0.08, 0)]
        node = 'elevator_' + side
        piv = AC.hinge(node, st[0][0] + V((0, 1.05 * 0.62, 0)), st[1][0] + V((0, 0.75 * 0.62, 0)), 'elevator', (-30, 25))
        if not burnt:
            bm = bmesh.new()
            AC.wing_bm(bm, st, f1=0.62, camber=0.0)
            skins += AC.skin(bm, 'stab', 'air_fabric')
            bm = bmesh.new()
            AC.wing_bm(bm, st, f0=0.625, f1=1.0, n=4, camber=0.0)
            AC.skin(bm, node, 'air_fabric', node=node, pivot=piv)
        else:
            P('soot', beam, st[0][0] + V((0, 0.15, 0)), st[1][0] + V((0, 0.15, -0.05)), 0.04, 0.06, name='stab_spar')
        AC.strut((s * 0.2, 4.0, ZT + 0.2), (s * 0.9, 4.1, ZT + 0.56), 0.04, name='stab_strut')
    fin = [(V((0, 3.65, ZT + 0.62)), 1.05, 0.10, 0), (V((0, 4.25, ZT + 1.72)), 0.55, 0.08, 0)]
    h0, h1 = fin[0][0] + V((0, 1.05 * 0.6, -0.4)), fin[1][0] + V((0, 0.55 * 0.6, 0.05))
    piv = AC.hinge('rudder', h0, h1, 'rudder', (-30, 30))
    if not burnt:
        bm = bmesh.new()
        AC.wing_bm(bm, fin, f1=0.60, camber=0.0, udir=(1, 0, 0))
        skins += AC.skin(bm, 'fin', 'air_fabric')
        bm = bmesh.new()
        AC.wing_bm(bm, [(fin[0][0] + V((0, 0.05, -0.42)), 1.1, 0.09, 0), (fin[1][0] + V((0, 0, 0.08)), 0.62, 0.07, 0)],
                   f0=0.60, f1=1.0, n=4, camber=0.0, udir=(1, 0, 0))
        AC.skin(bm, 'rudder', 'air_fabric', node='rudder', pivot=piv)
    else:
        P('paint', cyl, fin[0][0] + V((0, 0.4, 0)), fin[1][0] + V((0, 0.3, 0)), 0.015, 6, name='fin_post')
    return skins


def markings(skins):
    fus = [o for o in skins if o.name.startswith(('fuselage', 'turtledeck'))]
    wings = [o for o in VH.C.A.parts if o.name.startswith(('wing', 'aileron', 'flap'))]
    for s in (-1, 1):
        AC.cross(fus, (s * 0.5, 1.35, ZT + 0.28), (s, 0, 0), 0.62, up=(0, 0, 1))
        AC.cross(wings, (s * 5.3, -2.3, WZ + 0.5), (0, 0, 1), 1.2, up=(0, 1, 0))
        AC.cross(wings, (s * 5.3, -2.3, WZ - 0.5), (0, 0, -1), 1.3, up=(0, 1, 0))
        AC.letters(fus, 'NM', (s * 0.44, 0.35, ZT + 0.12), (s, 0, 0), 0.38, up=(0, 0, 1), kind='black')
        AC.letters(fus, 'GK', (s * 0.3, 2.55, ZT + 0.36), (s, 0, 0), 0.32, up=(0, 0, 1), kind='black')


def main(var, out_root):
    AC.setup('fi156_storch', var, SCHEME, PLANES, BANDS, seed=156)
    burnt = var == 'burnt'
    skins = airframe(burnt)
    skins += tail(burnt)
    nose(burnt)
    cabin(burnt)
    gear(burnt)
    if not burnt:
        markings(skins)
    AC.nav_lights((TIP, -2.4, WZ + 0.1), (-TIP, -2.4, WZ + 0.1), (0, 4.8, ZT + 0.5))
    VH.emitter('fuel_leak', (0.6, -2.2, WZ - 0.1), (0, 0, -1), when='damaged', note='wing-root tanks')
    VH.socket('mechanic', (1.2, -4.2, 0.0), (0, -1, 0), pose='stand', role='ground_crew')
    if burnt:
        VH.emitter('smoke', (0, -2.0, 1.5), (0, 0, 1), kind2='wreck_smoulder')
    ang = AC.level((1.45, -3.05 + (0.3 if burnt else 0), MWZ + (0.2 if burnt else 0)), 0.33 if not burnt else 0.19,
                   (0, 4.25, TWZ), 0.12)
    dims = {'length': 9.90, 'span': 14.25, 'height': 3.05, 'prop_d': 2.60}
    AC.vfin(os.path.join(out_root, 'fi156_storch'), 'storch', dims, variants=ALL,
            extra={'real_name': 'Fieseler Fi 156 C-3 Storch', 'destroyed': burnt, 'ground_angle_deg': round(ang, 2),
                   'rotation_order': 'YXZ', 'side': 'axis', 'role': 'liaison / STOL (take-off run ~65 m)',
                   'capacity': {'crew': 1, 'passengers': 2},
                   'paint_scheme': {'grey': 'RLM 70/71 splinter over RLM 65', 'dak': 'RLM 79/78 + white theatre band',
                                    'winter': 'white distemper over 70/71', 'burnt': 'fabric burnt off, tube frame'}[var]})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))
