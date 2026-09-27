# Junkers Ju 52/3m g4e (1940-42) "Tante Ju" transport - M10 escape aircraft (flown by McRae), three-point attitude.
# blender -b --factory-startup --python ju52.py -- grey|dak|winter|burnt|all
# Real: span 29.25 m, length 18.90 m, height 4.50 m, wing 110.5 m2, 3x BMW 132 T radials (nose NACA cowl, wing engines
# in Townend rings, canted outward), 3-blade props ~2.9 m, corrugated duralumin skin everywhere, Junkers double-wing
# flaps/ailerons below the trailing edge full span, strut-braced tailplane, split-axle main gear (spats removed, as in
# the field), tail wheel, dorsal MG 15 position, cabin door on the port side, 5 cabin windows a side.
# Schemes: grey = RLM 70/71 splinter over RLM 65; dak = RLM 79/78 + white theatre band; winter; burnt (gear collapsed).
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
PLANES = [((0, -6.5, 0), (0.6, 0.75, 0.3)), ((0, -2.5, 0), (-0.7, 0.62, 0.3)), ((0, 2.0, 0), (0.55, 0.8, 0.3)),
          ((0, 6.0, 0), (-0.5, 0.85, 0.25)), ((6.0, -2.0, 0), (0.92, 0.35, 0.05)), ((-6.5, -1.5, 0), (0.9, -0.42, 0.05)),
          ((10.5, -2.2, 0), (0.75, 0.66, 0.05)), ((-10.5, -2.0, 0), (0.8, -0.6, 0.05)), ((3.2, -4.0, 0), (0.3, 0.95, 0.05))]
BANDS = [(1, 6.65, 7.30, R['white'], ('top', 'side', 'bottom'), ('dak',))]   # 0.9 m band between 'AK' and tailplane
ZT = 2.45                               # nose engine thrust line / cabin centre (body frame)
FUS = [(-8.35, ZT, 1.30, 1.30, 2.2), (-7.9, ZT + 0.02, 1.52, 1.62, 2.6), (-7.2, ZT + 0.10, 1.80, 2.10, 3.4),
       (-6.4, ZT + 0.12, 1.92, 2.40, 4.5), (-5.0, ZT + 0.10, 1.96, 2.52, 6.0), (-1.0, ZT + 0.08, 1.96, 2.50, 6.0),
       (2.5, ZT + 0.12, 1.80, 2.26, 6.0), (5.5, ZT + 0.36, 1.30, 1.66, 5.0), (7.8, ZT + 0.62, 0.74, 1.04, 4.0),
       (9.2, ZT + 0.80, 0.30, 0.56, 3.0), (9.62, ZT + 0.84, 0.08, 0.30, 2.0)]   # y, zc, w, h, roof exponent
# wing stations: x, y_le, z (chord line), chord, t/c
W = [(0.5, -4.55, 1.62, 5.60, 0.19), (3.0, -4.35, 1.66, 5.05, 0.18), (9.0, -3.75, 1.92, 3.55, 0.15),
     (14.0, -3.05, 2.14, 2.20, 0.11), (14.62, -2.80, 2.17, 1.30, 0.09)]
ENG = 4.55                              # wing engine x
YJ = 5.5                                # fore body / tail cone skin joint


def wat(x):
    for a, b in zip(W[:-1], W[1:]):
        if x <= b[0] or b is W[-1]:
            t = (x - a[0]) / (b[0] - a[0])
            return [a[i] + (b[i] - a[i]) * t for i in range(5)]


NBOT, TAPER = 3.0, 0.13                 # belly exponent, side tumblehome (top narrower than the slab sides)


def fst(y):
    """Interpolated fuselage station (y, zc, w, h, ntop)."""
    for a, b in zip(FUS[:-1], FUS[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(5))
    return FUS[0] if y < FUS[0][0] else FUS[-1]


def _sx(zr, n, w):
    """Half-width at relative height zr (-1 belly .. +1 roof) of the slab-sided section."""
    zr = max(-1.0, min(1.0, zr))
    return (1 - abs(zr) ** n) ** (1 / n) * w / 2 * (1 - TAPER * max(0.0, zr))


def side_x(y, z):
    st = fst(y)
    zr = (z - st[1]) / (st[3] / 2)
    return _sx(zr, st[4] if zr > 0 else NBOT, st[2])


def slab_ring(st, N, depth):
    """Ju 52 section: flat roof deck with a tight top corner, near-vertical slab sides with slight tumblehome, rounded
    belly; resampled to N points by arc length from the roof centre (N even: symmetric, ridge-aligned between
    stations). Odd points are pushed out by `depth` -> corrugation ridges running fore-aft."""
    y, zc, w, h, nt = st
    M = 720
    dense = []
    for i in range(M):
        t = math.pi / 2 - 2 * math.pi * i / M      # start at roof centre, go over the +x side first
        ct, s_ = math.cos(t), math.sin(t)
        n = nt if s_ > 0 else NBOT
        x = (abs(ct) ** (2 / n)) * (1 if ct >= 0 else -1) * w / 2
        z = (abs(s_) ** (2 / n)) * (1 if s_ >= 0 else -1) * h / 2
        x *= 1 - TAPER * max(0.0, z / (h / 2))
        dense.append(V((x, y, zc + z)))
    L = [0.0]
    for a, b in zip(dense, dense[1:] + dense[:1]):
        L.append(L[-1] + (b - a).length)
    tot = L[-1]
    out, j = [], 0
    for k in range(N):
        d = tot * k / N
        while L[j + 1] < d:
            j += 1
        a, b = dense[j], dense[(j + 1) % M]
        f = (d - L[j]) / max(1e-9, L[j + 1] - L[j])
        p = a.lerp(b, f)
        if k % 2 and depth:
            tg = (b - a).normalized()
            nrm = V((tg.z, 0, -tg.x))               # outward for a clockwise (seen from -Y... ) walk
            if nrm.dot(p - V((0, y, zc))) < 0:
                nrm = -nrm
            p = p + nrm * depth
        out.append(p)
    return out


CORR = 0.015                             # ridge height (rework 2: shallower + smooth-shaded, no specular zebra)


def fuselage_bm(bm, ys, N, fade0=False, fade1=False, cap0=True, cap1=True, depth=None):
    rings = []
    for i, y in enumerate(ys):
        d = CORR if depth is None else depth
        if (fade0 and i == 0) or (fade1 and i == len(ys) - 1):
            d = 0.0
        rings.append(slab_ring(fst(y), N, d))
    VH.C.loft_bm(bm, rings, cap0, cap1)


def airframe(burnt):
    skins = []
    # corrugated slab-sided fuselage: fore body (200 pts / ring, ~75-90 mm pitch) + tail cone (100 pts), the ridges
    # fade to zero at the joint frame so the two lofts meet without cracks
    bm = bmesh.new()
    fuselage_bm(bm, [-8.35, -7.9, -7.2, -6.4, -5.0, -1.0, 2.5, 5.2, YJ], 144, fade0=True, fade1=True, cap1=False)
    skins += AC.skin(bm, 'fuselage', 'air_skin', sharp=80, cls_smooth=True)
    bm = bmesh.new()
    fuselage_bm(bm, [YJ, 5.8, 6.6, 7.8, 8.5, 9.2, 9.62], 72, fade0=True, cap0=False)
    skins += AC.skin(bm, 'fuselage_tail', 'air_skin', sharp=80, cls_smooth=True)
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        xs = [0.3, 1.8, 3.0, ENG - 0.9, ENG + 0.9, 6.5, 9.0, 11.5, 14.0, 14.62]
        st = [(V((s * x, wat(x)[1], wat(x)[2])), wat(x)[3], wat(x)[4], 0.0) for x in xs]
        bm = bmesh.new()
        AC.wing_bm(bm, st, n=12, camber=0.03)
        bm.normal_update()                             # upper skin is replaced by the corrugated sheet below
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z > 0.2 and abs(f.calc_center_median().x) < xs[-2] - 0.01],
                         context='FACES')
        skins += AC.skin(bm, 'wing', 'air_corr', sharp=50, recalc=False)
        bm = bmesh.new()                               # corrugated upper skin (ridges streamwise, ~100 mm pitch)
        for a, b in zip(xs[:-2], xs[1:-1]):
            wa, wb = wat(a), wat(b)
            AC.corr_surface(bm, (V((s * a, wa[1], wa[2])), wa[3], wa[4]), (V((s * b, wb[1], wb[2])), wb[3], wb[4]),
                            pitch=0.16, depth=CORR, camber=0.03, trap=True, uv_off=a, lift=0.0,
                            fs=[0.0, 0.04, 0.13, 0.28, 0.5, 0.75, 1.0])
        AC.skin(bm, 'corr_wing', 'air_skin', sharp=45, recalc=False, cls_smooth=True, uv='keep', no_ao=True)
        # double wing: flap (inner) + aileron (outer) hung below/behind the TE, with brackets
        for nm, x0, x1, lim in (('flap', 1.1, 8.6, (0, 40)), ('aileron', 8.8, 14.3, (-25, 20))):
            node = '%s_%s' % (nm, side)
            st = []
            for x in (x0, (x0 + x1) / 2, x1):
                _, y, z, ch, t = wat(x)
                st.append((V((s * x, y + ch * 0.985, z - 0.16)), ch * 0.22, 0.13, -3.0))
            piv = AC.hinge(node, st[0][0] + V((0, st[0][1] * 0.25, 0)), st[-1][0] + V((0, st[-1][1] * 0.25, 0)),
                           'aileron' if nm == 'aileron' else 'flap', lim)
            bm = bmesh.new()
            AC.wing_bm(bm, st, n=7, camber=0.03)
            AC.skin(bm, node, 'air_corr', node=node, pivot=piv, sharp=50)
            for k in range(4):
                x = x0 + 0.2 + (x1 - x0 - 0.4) * k / 3
                _, y, z, ch, t = wat(x)
                P('paint', box, (s * x, y + ch * 0.99, z - 0.12), (0.04, 0.34, 0.12), name='flap_bracket')
    # tailplane (strut braced), elevators, fin, rudder
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        st = [(V((s * 0.3, 7.25, ZT + 0.95)), 2.25, 0.11, 0), (V((s * 4.1, 7.85, ZT + 1.05)), 1.25, 0.08, 0)]
        bm = bmesh.new()
        AC.wing_bm(bm, st, f1=0.66, camber=0.0)
        skins += AC.skin(bm, 'stab', 'air_corr')
        node = 'elevator_' + side
        piv = AC.hinge(node, st[0][0] + V((0, 2.25 * 0.66, 0)), st[1][0] + V((0, 1.25 * 0.66, 0)), 'elevator', (-30, 25))
        bm = bmesh.new()
        AC.wing_bm(bm, st, f0=0.665, f1=1.0, n=4, camber=0.0)
        AC.skin(bm, node, 'air_corr', node=node, pivot=piv)
        AC.strut((s * 0.35, 7.6, ZT + 0.2), (s * 2.0, 7.95, ZT + 0.98), 0.08, name='stab_strut')
        bm = bmesh.new()
        AC.corr_surface(bm, (st[0][0], 2.25, 0.11), (st[1][0], 1.25, 0.08), pitch=0.16, depth=CORR * 0.8, f0=0.04, f1=0.64,
                        k=4, camber=0.0, trap=True, lift=0.022)
        AC.skin(bm, 'corr_stab', 'air_skin', sharp=45, recalc=False, cls_smooth=True, uv='keep', no_ao=True)
    fin = [(V((0, 6.5, ZT + 0.9)), 2.7, 0.12, 0), (V((0, 7.95, ZT + 3.05)), 1.1, 0.08, 0)]
    bm = bmesh.new()
    AC.wing_bm(bm, fin, f1=0.62, camber=0.0, udir=(1, 0, 0))
    skins += AC.skin(bm, 'fin', 'air_corr')
    for sf in (1, -1):
        bm = bmesh.new()
        AC.corr_surface(bm, (fin[0][0].lerp(fin[1][0], 0.163), 2.7 - 1.6 * 0.163, 0.12), (fin[1][0], 1.1, 0.08), pitch=0.16,
                        depth=CORR * 0.8, f0=0.04, f1=0.60, k=4, camber=0.0, udir=(1, 0, 0), surf=sf, trap=True, lift=0.022)
        AC.skin(bm, 'corr_fin', 'air_skin', sharp=45, recalc=False, cls_smooth=True, uv='keep', no_ao=True)
    h0, h1 = fin[0][0] + V((0, 2.6 * 0.62, -0.35)), fin[1][0] + V((0, 1.1 * 0.62, 0.05))
    piv = AC.hinge('rudder', h0, h1, 'rudder', (-28, 28))
    bm = bmesh.new()
    AC.wing_bm(bm, [(fin[0][0] + V((0, 0.08, -0.45)), 2.6, 0.10, 0), (fin[1][0] + V((0, 0.0, 0.1)), 1.25, 0.07, 0)],
               f0=0.62, f1=1.0, n=4, camber=0.0, udir=(1, 0, 0))
    AC.skin(bm, 'rudder', 'air_corr', node='rudder', pivot=piv)
    return skins


def engines(burnt):
    # nose engine: deep long-chord NACA cowl enclosing the BMW 132 completely, cooling gills at the back
    hub = V((0, -9.30, ZT))
    AC.radial_engine('main', (0, -8.78, ZT), (0, -1, 0), 0.60, burnt=burnt, fins=0, seg=6)   # hidden in the cowl
    bm = bmesh.new()
    AC.cowl_bm(bm, (0, -7.95, ZT), (0, -1, 0), [(1.16, 0.69), (1.05, 0.735), (0.55, 0.75), (0.0, 0.725), (0.02, 0.66),
                                               (1.10, 0.62)], segs=28)
    AC.skin(bm, 'nose_cowl', 'air_skin', uv='aligned')
    bm = bmesh.new()                                   # cooling gills (slightly open) + dark gap
    AC.cowl_bm(bm, (0, -7.72, ZT), (0, -1, 0), [(0.24, 0.725), (0.0, 0.775), (0.0, 0.76), (0.24, 0.71)], segs=28)
    AC.skin(bm, 'cowl_gills', 'air_skin', uv='aligned', sharp=30)
    AC.prop('prop_c', hub, (0, 1, 0), 1.45, 3, chord=0.26, spin_r=0.18, spin_len=0.25, kind='prop', bent=0.35 if burnt else 0.0)
    VH.emitter('exhaust', (0.45, -7.9, ZT - 0.7), (0.3, 0.5, -0.6), engine='c')
    VH.emitter('prop_wash', (0, -8.5, 0.05), (0, 1, 0), radius=3.0, engine='c')
    VH.emitter('fire', (0, -8.0, ZT), (0, 0, 1), when='destroyed', engine='c')
    P('soot', beam, (0.52, -7.55, ZT - 0.52), (0.55, -6.6, ZT - 0.75), 0.12, 0.10, name='exhaust_pipe')
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        _, y, z, ch, t = wat(ENG)
        zc = z + 0.05
        hubw = V((s * ENG, -6.45, zc))
        # wing engines: narrow-chord Townend ring ahead of the cylinders, heads exposed behind it (tell-tale g4e look)
        AC.radial_engine('main', (s * ENG, -5.76, zc), (0, -1, 0), 0.58, burnt=burnt, fins=2, seg=6)
        bm = bmesh.new()
        AC.cowl_bm(bm, (s * ENG, -5.88, zc), (0, -1, 0), [(0.30, 0.655), (0.20, 0.70), (0.06, 0.70), (0.0, 0.675),
                                                          (0.01, 0.63), (0.28, 0.615)], segs=24)
        AC.skin(bm, 'townend_ring', 'air_skin', uv='aligned')
        for k in range(4):                             # ring support struts to the crankcase
            a = math.radians(45 + 90 * k)
            d = V((math.cos(a), 0, math.sin(a)))
            P('black', beam, V((s * ENG, -5.95, zc)) + d * 0.2, V((s * ENG, -5.95, zc)) + d * 0.62, 0.03, 0.03, name='ring_strut')
        bm = bmesh.new()                               # nacelle: accessory section behind the cylinders into the wing
        AC.fus_bm(bm, [(-5.62, zc, 0.46, 0.46, 2.2, s * ENG), (-5.3, zc, 0.86, 0.86, 2.4, s * ENG),
                       (-4.1, zc - 0.02, 0.92, 0.88, 2.6, s * ENG), (-2.2, zc + 0.02, 0.60, 0.5, 2.4, s * ENG),
                       (-0.6, zc + 0.10, 0.20, 0.16, 2.0, s * ENG)], segs=18)
        AC.skin(bm, 'nacelle', 'air_corr')
        AC.prop('prop_' + side, hubw, (0, 1, 0), 1.45, 3, chord=0.26, spin_r=0.16, spin_len=0.22, kind='prop',
                bent=0.35 if burnt else 0.0, phase=0.6 * s)
        P('soot', beam, (s * (ENG + 0.35), -5.4, zc - 0.5), (s * (ENG + 0.45), -3.4, zc - 0.55), 0.12, 0.10, name='exhaust_pipe')
        VH.emitter('exhaust', (s * (ENG + 0.45), -3.4, zc - 0.55), (0, 1, -0.2), engine=side)
        VH.emitter('prop_wash', (s * ENG, -5.8, 0.05), (0, 1, 0), radius=3.0, engine=side)
        VH.emitter('fire', (s * ENG, -5.2, zc), (0, 0, 1), when='destroyed', engine=side)
        VH.emitter('fuel_leak', (s * 2.2, -2.5, 1.2), (0, 0, -1), when='damaged')


def cockpit(burnt):
    zb, zt = ZT + 0.78, ZT + 1.40
    pts = [V((-0.74, -7.15, zb)), V((0.74, -7.15, zb)), V((-0.56, -6.55, zt)), V((0.56, -6.55, zt)),
           V((-0.56, -5.85, zt)), V((0.56, -5.85, zt)), V((-0.94, -5.85, zb + 0.1)), V((0.94, -5.85, zb + 0.1)),
           V((-0.94, -6.6, zb)), V((0.94, -6.6, zb))]
    AC.G_(AC.hull_bm, pts, name='cockpit_glass')
    for a, b in ((0, 1), (0, 2), (1, 3), (2, 3), (2, 4), (3, 5), (4, 5), (4, 6), (5, 7), (0, 8), (1, 9), (8, 6), (9, 7),
                 (2, 8), (3, 9)):
        P('paint', beam, pts[a], pts[b], 0.05, 0.035, name='cockpit_frame')
    P('paint', beam, (0, -7.15, zb), (0, -6.55, zt), 0.05, 0.035, name='cockpit_frame')
    for s in (-1, 1):                                  # 5 cabin windows each side (smooth panels, flush on the crests)
        for i in range(5):
            y = -4.3 + i * 0.95
            xw = side_x(y, ZT + 0.55) + CORR + 0.006
            P('paint', box, (s * (xw - 0.012), y, ZT + 0.55), (0.02, 0.66, 0.60), name='window_panel')
            P('glass', box, (s * xw, y, ZT + 0.55), (0.02, 0.50, 0.44), name='cabin_window') if not burnt else \
                P('soot', box, (s * xw, y, ZT + 0.55), (0.02, 0.50, 0.44), name='cabin_window_hole')
            AC.frame_bars([V((s * (xw + 0.006), y - 0.27, ZT + 0.31)), V((s * (xw + 0.006), y + 0.27, ZT + 0.31)),
                           V((s * (xw + 0.006), y + 0.27, ZT + 0.79)), V((s * (xw + 0.006), y - 0.27, ZT + 0.79))], 0.04,
                          name='window_frame')
    xd = side_x(3.3, ZT - 0.1) + CORR + 0.01
    piv = AC.hinge('door_cabin', (xd, 2.9, ZT - 0.85), (xd, 2.9, ZT + 0.62), 'door', (0, 105),
                   note='port side, opens outward about its forward edge')
    P('paint', box, (xd + 0.005, 3.3, ZT - 0.12), (0.03, 0.78, 1.46), name='door_panel', node='door_cabin', pivot=piv)
    P('glass', box, (xd + 0.025, 3.3, ZT + 0.32), (0.02, 0.36, 0.34), name='door_window', node='door_cabin', pivot=piv)
    P('black', box, (xd + 0.03, 3.62, ZT - 0.1), (0.03, 0.04, 0.16), name='door_handle', node='door_cabin', pivot=piv)
    VH.socket('exit_door', (1.7, 3.3, 0.0), (1, 0, 0), pose='stand', role='exit', note='foot of the boarding ladder')
    # dorsal MG 15 position with wind deflector
    gp = V((0, 1.1, ZT + 1.30))
    P('paint', VH.bevel_box, (0, 1.2, ZT + 1.28), (0.95, 1.2, 0.12), 0.04, 1, name='dorsal_ring')
    P('glass', box, (0, 0.62, ZT + 1.48), (0.6, 0.03, 0.3), name='dorsal_deflector')
    P('gunmetal', cyl, gp, gp + V((0, 0.9, 0.2)), 0.02, 6, name='mg15', node='gun_dorsal', pivot=tuple(gp))
    P('black', cyl, gp + V((0.07, 0.2, 0.0)), gp + V((0.07, 0.2, 0.16)), 0.06, 8, name='mg15_drum', node='gun_dorsal', pivot=tuple(gp))
    VH.moving('gun_dorsal', 'gun_yaw_pitch', gp, (0, 0, 1), (-150, 150), elev_deg=[-5, 70])
    VH.socket('muzzle_mg15_dorsal', gp + V((0, 0.92, 0.2)), (0, 1, 0.2), node='gun_dorsal', kind='muzzle', weapon='MG 15 7.92 mm')
    VH.socket('dorsal_gunner', (0, 1.4, ZT + 0.6), (0, 1, 0), pose='stand_gunner', role='gunner')
    VH.socket('pilot', (0.42, -6.3, ZT + 0.45), (0, -1, 0), pose='sit_pilot', role='pilot', note='McRae (spec 3.x)')
    VH.socket('copilot', (-0.42, -6.3, ZT + 0.45), (0, -1, 0), pose='sit_pilot', role='copilot')
    for i in range(16):                                # 2 x 8 folding bench seats along the cabin walls
        s = 1 if i % 2 == 0 else -1
        VH.socket('troop_%02d' % (i + 1), (s * 0.72, -4.6 + (i // 2) * 0.72, ZT - 0.55), (-s, 0, 0), pose='sit_bench', role='passenger')
    # mast + wire, D/F loop
    P('paint', beam, (0, -5.6, ZT + 1.35), (0, -5.5, ZT + 1.95), 0.06, 0.03, name='antenna_mast')
    P('black', beam, (0, -5.5, ZT + 1.93), (0, 7.8, ZT + 3.0), 0.01, 0.01, name='antenna_wire', lod='drop')
    P('paint', VH.ring_torus, (0, -4.2, ZT + 1.55), 0.17, 0.02, (1, 0, 0), 14, 4, name='df_loop')


MWZ, TWZ, MY, TY = 0.56, ZT - 0.22, -3.75, 8.55


# Length correction (rework 2): the body-axis length was 19.72 m against the real 18.90 m. The nose section ahead of
# the wing (fuselage only, |x| < 2.9 so the wing engines keep their place) is compressed 3.65 -> 3.30 m (the nose
# engine / NACA cowl / prop move 0.35 m aft), the cabin-to-tail cone 2.5..7.0 m is compressed 10 % (tail group moves
# 0.45 m forward). Body length ~18.92 m.
_NOSE = AC.pw_y([(-8.35, -8.00), (-4.70, -4.70)])
_TAIL = AC.pw_y([(2.50, 2.50), (7.00, 6.55)])


def FN(p):
    p = V(p)
    y = p.y
    if y < -4.7 and abs(p.x) < 2.9:
        y = _NOSE(y)
    elif y > 2.5:
        y = _TAIL(y)
    return V((p.x, y, p.z))


def zg(y):
    """Body-frame ground height under the (warped) station y, three-point attitude (main tyre / tail tyre bottoms)."""
    ty = FN((0, TY, 0)).y
    return (TWZ - 0.29) * (y - MY) / (ty - MY)


def ladder(burnt):
    """Hook-on boarding ladder under the port cabin door: two alu stringers, 3 treads, feet on the ground."""
    if burnt:
        return
    y0 = FN((0, 3.3, 0)).y
    xd = side_x(3.3, ZT - 0.1) + CORR + 0.01
    top_z = ZT - 0.86
    for dy in (-0.2, 0.2):
        yy = y0 + dy
        top, foot = V((xd + 0.04, yy, top_z)), V((xd + 0.42, yy, zg(yy)))
        P('alu', beam, top, foot, 0.035, 0.05, name='ladder_stringer')
        P('black', box, foot + V((0, 0, 0.015)), (0.08, 0.06, 0.03), name='ladder_foot')
        P('alu', box, top + V((-0.03, 0, 0.03)), (0.05, 0.05, 0.08), name='ladder_hook')
    for k in range(1, 4):
        f = k / 4.0
        zz = top_z + (zg(y0) - top_z) * f
        P('alu', box, (xd + 0.04 + 0.38 * f, y0, zz), (0.10, 0.44, 0.025), name='ladder_tread')


def gear(burnt):
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        hub = V((s * 2.75, MY, MWZ if not burnt else MWZ + 0.35))
        _, y, z, ch, t = wat(2.75)
        wb = z - ch * t * 0.45                         # wing underside at the leg
        P('paint', cyl, (s * 2.75, MY - 0.05, wb), hub + V((0, 0, 0.2)), 0.085, 10, name='oleo_leg')
        P('alu', cyl, hub + V((0, 0, 0.22)), hub + V((0, 0, 0.02)), 0.06, 8, name='oleo_slider')
        P('paint', cyl, hub + V((-s * 0.18, 0, 0.0)), (s * 0.35, MY + 0.05, 1.25), 0.06, 8, name='split_axle')
        P('paint', cyl, hub + V((-s * 0.18, 0.05, 0.05)), (s * 2.6, MY + 1.1, wb), 0.05, 8, name='drag_strut')
        if not burnt:
            bm = bmesh.new()                             # mudguard over the top of the tyre
            VH.sweep_bm(bm, VH.arc_path(hub.y, hub.z, 0.63, 20, 160, 8), [(-0.2, 0), (0.2, 0), (0.2, 0.01), (-0.2, 0.01)],
                        x0=hub.x, center=(hub.y, hub.z))
            VH.vp(bm, 'paint', 'mudguard')
        VH.wheel('wheel_' + side, hub, 0.56, 0.34, 0.30, s, style='disc', lug=0.0, segs=18)
        VH.emitter('dust', (s * 2.75, MY + 0.6, 0.05), (0, 1, 0.3))
    tw = V((0, TY, TWZ))
    P('paint', cyl, (0, TY - 0.1, ZT + 0.45), tw + V((0, 0, 0.12)), 0.06, 8, name='tailwheel_leg', node='tailwheel_fork',
      pivot=(0, TY - 0.1, ZT + 0.2))
    P('paint', box, tw + V((0, 0.0, 0.2)), (0.16, 0.5, 0.06), name='tailwheel_fork_plate', node='tailwheel_fork', pivot=(0, TY - 0.1, ZT + 0.2))
    VH.moving('tailwheel_fork', 'castor', (0, TY - 0.1, ZT + 0.2), (0, 0, 1), (-180, 180))
    VH.wheel('tailwheel', tw, 0.29, 0.16, 0.14, 1, style='disc', lug=0.0, segs=14)
    AC.PARENTS['tailwheel'] = 'tailwheel_fork'


def markings(skins):
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()                                   # smooth (un-corrugated) fuselage as the decal projection base
    fuselage_bm(bm, [-5.0, -3.0, -1.0, 0.75, 2.5, 4.0, 5.2, YJ, 5.8, 6.6, 7.8], 144, depth=0.0)
    for v in bm.verts:                                 # same length warp as the airframe
        v.co = FN(v.co)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    wings = [o for o in VH.C.A.parts if o.name.startswith(('wing', 'aileron', 'flap'))]
    lift = CORR + 0.006                                # paint sits on the ridge crests
    for s in (-1, 1):
        # fuselage cross aft of the cabin door + ladder (reads clear from the game camera)
        AC.cross(None, FN((s * 0.9, 4.5, ZT + 0.25)), (s, 0, 0), 1.25, up=(0, 0, 1), lift=lift, tree=tree)
        bmw = bmesh.new()                              # smooth upper-skin envelope (ridge crests) for the wing cross
        for a_, b_ in ((9.0, 11.5), (11.5, 14.0)):
            wa, wb = wat(a_), wat(b_)
            AC.corr_surface(bmw, (V((s * a_, wa[1], wa[2])), wa[3], wa[4]), (V((s * b_, wb[1], wb[2])), wb[3], wb[4]),
                            pitch=0.16, depth=0.0, camber=0.03, lift=CORR, fs=[0.0, 0.04, 0.13, 0.28, 0.5, 0.75, 1.0])
        wtree = BVHTree.FromBMesh(bmw)
        bmw.free()
        AC.cross(None, (s * 11.4, -2.0, 3.0), (0, 0, 1), 1.9, up=(0, 1, 0), lift=0.006, tree=wtree)
        # underwing cross: projected upward onto the real lower surface of the dihedral wing (smooth base wing)
        bmu = bmesh.new()
        xs = [6.5, 9.0, 11.5, 14.0]
        AC.wing_bm(bmu, [(V((s * x, wat(x)[1], wat(x)[2])), wat(x)[3], wat(x)[4], 0.0) for x in xs], n=12, camber=0.03)
        utree = BVHTree.FromBMesh(bmu)
        bmu.free()
        wu = wat(11.0)
        AC.cross(None, (s * 11.0, -2.0, wu[2]), (0, 0, -1), 2.1, up=(0, 1, 0), tree=utree)
        # Stammkennzeichen 1Z+AK (KGr.z.b.V.): block stencil letters, '1Z' ahead of the cross, 'AK' behind it
        AC.letters(None, '1Z', (s * 0.95, 2.2, ZT + 0.05), (s, 0, 0), 0.85, up=(0, 0, 1), kind='black', lift=lift, tree=tree)
        AC.letters(None, 'AK', FN((s * 0.8, 6.0, ZT + 0.40)), (s, 0, 0), 0.70, up=(0, 0, 1), kind='black', lift=lift, tree=tree)


def main(var, out_root):
    AC.setup('ju52_3m', var, SCHEME, PLANES, BANDS, seed=52)
    burnt = var == 'burnt'
    skins = airframe(burnt)
    engines(burnt)
    cockpit(burnt)
    gear(burnt)
    AC.warp(FN)
    ladder(burnt)
    markings(skins)
    AC.nav_lights((14.6, -2.2, 2.17), (-14.6, -2.2, 2.17), (0, 9.62, ZT + 0.84))
    _, y, z, ch, t = wat(7.5)
    for s in (-1, 1):
        P('lens', cyl, (s * 7.5, y + 0.03, z), (s * 7.5, y - 0.01, z), 0.13, 12, name='landing_light')
        VH.light('landing_light_' + ('l' if s > 0 else 'r'), (s * 7.5, y - 0.02, z), (0, -1, -0.1), blackout=False, kind='landing')
    VH.socket('mechanic_wing', (3.2, -3.0, 2.3), (0, -1, 0), pose='stand', role='ground_crew')
    if burnt:
        VH.emitter('smoke', (0, -2.0, 3.0), (0, 0, 1), kind2='wreck_smoulder')
    ang = AC.level((2.75, MY, MWZ + (0.35 if burnt else 0)), 0.56 if not burnt else 0.32, (0, FN((0, TY, 0)).y, TWZ), 0.29,
                   sym=True)
    if burnt:
        AC.transform_all(Matrix.Rotation(math.radians(-3.0), 4, 'Y'))
        zmin = min(v.co.z for o in VH.C.A.parts for v in o.data.vertices)
        AC.transform_all(Matrix.Translation((0, 0, -zmin - 0.02)))
    dims = {'length': 18.90, 'span': 29.25, 'height': 4.50, 'prop_d': 2.90, 'track': 5.5}
    AC.vfin(os.path.join(out_root, 'ju52_3m'), 'ju52', dims, variants=ALL, ao_res=1024, quant=True, lods=((0.5, 0.08), (0.25, 0.3)),
            extra={'real_name': 'Junkers Ju 52/3m g4e', 'destroyed': burnt, 'ground_angle_deg': round(ang, 2),
                   'rotation_order': 'YXZ', 'side': 'axis', 'role': 'M10 escape transport (McRae flies it)',
                   'capacity': {'crew': 3, 'troops': 16},
                   'paint_scheme': {'grey': 'RLM 70/71 splinter over RLM 65', 'dak': 'RLM 79/78 + white theatre band',
                                    'winter': 'white distemper over 70/71', 'burnt': 'wreck, gear collapsed'}[var]})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))
