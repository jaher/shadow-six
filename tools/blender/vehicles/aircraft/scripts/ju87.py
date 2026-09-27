# Junkers Ju 87 B-2 "Stuka" (1940-42), M10 airfield (El Agheila) - parked, three-point attitude, bombed up.
# blender -b --factory-startup --python ju87.py -- grey|dak|winter|burnt|all
# Real: length 11.10 m, span 13.80 m, height 4.01 m, wing 31.9 m2, Jumo 211 Da with chin radiator, 3-blade VS 5 prop
# 3.40 m. Inverted gull wing, fixed trousered + spatted main gear at the gull break (with the "Jericho" siren),
# Junkers double-wing flaps/ailerons hung below/behind the trailing edge, slatted dive brakes under the outer wings,
# long framed greenhouse (pilot hood slides aft, gunner hood forward), rear MG 15, 2x MG 17 wing guns,
# SC 250 on the swing-arm crutch + 4x SC 50 under the wings.
# Schemes: grey = RLM 70/71 splinter over RLM 65; dak = RLM 79/78 + white theatre band; winter = distemper; burnt.
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
PLANES = [((0, -3.6, 0), (0.62, 0.72, 0.3)), ((0, -1.0, 0), (-0.75, 0.6, 0.25)), ((3.4, -2.0, 0), (0.95, 0.3, 0.05)),
          ((-3.6, -1.5, 0), (0.92, -0.38, 0.05)), ((0, 1.6, 0), (0.55, 0.8, 0.35)), ((0, 3.8, 0), (-0.4, 0.9, 0.3)),
          ((5.4, -1.8, 0), (0.7, 0.7, 0.1)), ((-5.6, -2.2, 0), (0.75, -0.6, 0.1))]
BANDS = [(1, 3.35, 3.8, R['white'], ('top', 'side', 'bottom'), ('dak',))]
ZT = 1.95
MWZ, TWZ = 0.30, ZT - 0.42        # main / tail wheel centre heights (body frame)
FUS = [(-5.18, ZT, 0.66, 0.72, 2.2), (-4.9, ZT - 0.03, 0.88, 1.10, 2.4), (-4.2, ZT - 0.06, 0.98, 1.36, 2.6),
       (-3.3, ZT - 0.08, 1.02, 1.46, 2.8), (-2.4, ZT - 0.10, 1.04, 1.50, 2.9), (-0.6, ZT - 0.13, 1.00, 1.44, 2.8),
       (1.0, ZT - 0.08, 0.86, 1.26, 2.6), (3.0, ZT + 0.04, 0.60, 0.96, 2.4), (4.6, ZT + 0.16, 0.34, 0.66, 2.2),
       (5.35, ZT + 0.22, 0.12, 0.40, 2.0), (5.52, ZT + 0.24, 0.04, 0.2, 2.0)]
# wing stations: x, y_le, z (chord line), chord, t/c  (root, gull break, tip)
W = [(0.30, -3.05, 1.18, 2.80, 0.18), (1.85, -2.98, 0.72, 2.62, 0.165), (6.35, -2.40, 1.50, 1.62, 0.11),
     (6.90, -2.20, 1.58, 1.05, 0.09)]


def wat(x):
    for a, b in zip(W[:-1], W[1:]):
        if x <= b[0] or b is W[-1]:
            t = (x - a[0]) / (b[0] - a[0])
            return [a[i] + (b[i] - a[i]) * t for i in range(5)]


def wst(xs, s, f0=0.0, f1=1.0):
    out = []
    for x in xs:
        _, y, z, ch, t = wat(x)
        out.append((V((s * x, y, z)), ch, t, 0.0))
    return out


def airframe(burnt):
    skins = []
    bm = bmesh.new()
    AC.fus_bm(bm, FUS, segs=24)
    skins += AC.skin(bm, 'fuselage', 'air_skin')
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        bm = bmesh.new()
        AC.wing_bm(bm, wst([0.2, 1.0, 1.85, 3.0, 4.5, 6.35, 6.9], s), n=12)
        skins += AC.skin(bm, 'wing', 'air_skin')
        # Junkers double wing: flap sections (inner, incl. centre section) + aileron (outer), hung below the TE
        for nm, x0, x1, lim in (('flap_in', 0.55, 1.8, (0, 40)), ('flap_out', 1.9, 4.2, (0, 40)), ('aileron', 4.3, 6.5, (-25, 20))):
            node = '%s_%s' % (nm, side)
            st = []
            for x in (x0, (x0 + x1) / 2, x1):
                _, y, z, ch, t = wat(x)
                c2 = ch * 0.26
                st.append((V((s * x, y + ch * 0.97, z - 0.10)), c2, 0.12, -4.0))
            piv = AC.hinge(node, st[0][0] + V((0, st[0][1] * 0.25, 0)), st[-1][0] + V((0, st[-1][1] * 0.25, 0)),
                           'aileron' if nm == 'aileron' else 'flap', lim)
            bm = bmesh.new()
            AC.wing_bm(bm, st, n=7, camber=0.03)
            AC.skin(bm, node, 'air_skin', node=node, pivot=piv)
            for x in (x0 + 0.15, x1 - 0.15):       # hinge brackets
                _, y, z, ch, t = wat(x)
                P('paint', box, (s * x, y + ch * 0.98, z - 0.07), (0.03, 0.22, 0.10), name='flap_bracket')
        # dive brake: slatted plate under the outer wing, hinged at its front edge (swings down 90 deg)
        node = 'dive_brake_' + side
        _, y, z, ch, t = wat(3.7)
        hz = z - ch * t * 0.5 - 0.02
        piv = AC.hinge(node, (s * 2.75, y + 0.28, hz), (s * 4.65, y + 0.33, hz + 0.08), 'dive_brake', (0, 90))
        for k in range(4):
            P('paint', box, (s * 3.7, y + 0.33 + k * 0.045, hz - 0.01), (1.85, 0.03, 0.01), name='dive_brake_slat',
              node=node, pivot=piv)
        for x in (2.9, 3.7, 4.5):
            P('paint', box, (s * x, y + 0.40, hz - 0.03), (0.03, 0.22, 0.03), name='dive_brake_rib', node=node, pivot=piv)
        # wing guns (MG 17, just outboard of the gear)
        _, y, z, ch, t = wat(2.55)
        P('gunmetal', cyl, (s * 2.55, y + 0.05, z), (s * 2.55, y - 0.16, z), 0.018, 6, name='mg17')
        VH.socket('muzzle_mg17_' + side, (s * 2.55, y - 0.17, z), (0, -1, 0), kind='muzzle', weapon='MG 17 7.92 mm')
        # pitot / landing light (port wing LE)
        if s > 0:
            _, y, z, ch, t = wat(5.2)
            P('lens', cyl, (5.2, y + 0.02, z), (5.2, y - 0.01, z), 0.09, 12, name='landing_light')
            VH.light('landing_light', (5.2, y - 0.02, z), (0, -1, -0.1), blackout=False, kind='landing')
            _, y, z, ch, t = wat(6.0)
            P('alu', cyl, (6.0, y + 0.1, z - 0.05), (6.0, y - 0.45, z - 0.05), 0.012, 6, name='pitot')
    # tailplane (strut braced) + elevators, fin + rudder
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        st = [(V((s * 0.2, 3.90, ZT + 0.34)), 1.55, 0.11, 0), (V((s * 2.45, 4.30, ZT + 0.38)), 0.92, 0.09, 0)]
        bm = bmesh.new()
        AC.wing_bm(bm, st, f1=0.68, camber=0.0)
        skins += AC.skin(bm, 'stab', 'air_skin')
        node = 'elevator_' + side
        piv = AC.hinge(node, st[0][0] + V((0, 1.55 * 0.68, 0)), st[1][0] + V((0, 0.92 * 0.68, 0)), 'elevator', (-30, 25))
        bm = bmesh.new()
        AC.wing_bm(bm, st, f0=0.685, f1=1.0, n=4, camber=0.0)
        AC.skin(bm, node, 'air_skin', node=node, pivot=piv)
        AC.strut((s * 0.25, 4.3, ZT - 0.2), (s * 1.3, 4.45, ZT + 0.33), 0.06, name='stab_strut')
    fin = [(V((0, 3.75, ZT + 0.35)), 1.85, 0.11, 0), (V((0, 4.45, ZT + 1.85)), 0.85, 0.08, 0)]
    bm = bmesh.new()
    AC.wing_bm(bm, fin, f1=0.60, camber=0.0, udir=(1, 0, 0))
    skins += AC.skin(bm, 'fin', 'air_skin')
    h0, h1 = fin[0][0] + V((0, 1.85 * 0.60, -0.3)), fin[1][0] + V((0, 0.85 * 0.60, 0.05))
    piv = AC.hinge('rudder', h0, h1, 'rudder', (-28, 28))
    bm = bmesh.new()
    AC.wing_bm(bm, [(fin[0][0] + V((0, 0.05, -0.35)), 1.85, 0.10, 0), (fin[1][0] + V((0, 0, 0.1)), 0.95, 0.07, 0)],
               f0=0.60, f1=1.0, n=4, camber=0.0, udir=(1, 0, 0))
    AC.skin(bm, 'rudder', 'air_skin', node='rudder', pivot=piv)
    return skins


def nose(burnt):
    hub = (0, -5.22, ZT)
    AC.prop('prop', hub, (0, 1, 0), 1.70, 3, chord=0.30, spin_r=0.27, spin_len=0.42, kind='prop', bent=0.4 if burnt else 0.0)
    # chin radiator bath (the Stuka "beard") with cooling gills
    bm = bmesh.new()
    AC.fus_bm(bm, [(-5.0, ZT - 0.62, 0.52, 0.32, 2.4), (-4.7, ZT - 0.72, 0.66, 0.58, 3.0), (-3.9, ZT - 0.70, 0.66, 0.56, 3.0),
                   (-3.4, ZT - 0.62, 0.56, 0.36, 2.6)], segs=16)
    AC.skin(bm, 'radiator_bath', 'air_skin')
    P('black', box, (0, -5.02, ZT - 0.66), (0.44, 0.02, 0.24), name='radiator_mouth')
    for i in range(5):
        P('black', box, (0, -5.035, ZT - 0.76 + i * 0.05), (0.44, 0.01, 0.012), name='radiator_vane', lod='drop')
    for s in (-1, 1):
        P('paint', box, (s * 0.26, -3.55, ZT - 0.70), (0.02, 0.25, 0.30), name='radiator_gill')
        for i in range(6):                      # exhaust stubs (Jumo 211: 6 per bank)
            y = -4.55 + i * 0.16
            P('soot', beam, (s * 0.48, y, ZT + 0.05), (s * 0.60, y + 0.06, ZT - 0.02), 0.06, 0.045, name='exhaust')
        P('soot', box, (s * 0.51, -3.9, ZT - 0.05), (0.02, 1.2, 0.18), name='exhaust_stain')
        VH.emitter('exhaust', (s * 0.6, -4.1, ZT - 0.02), (s, 0.3, -0.2), bank='l' if s > 0 else 'r')
        P('paint', VH.bevel_box, (s * 0.46, -4.35, ZT + 0.42), (0.10, 0.5, 0.12), 0.03, 1, name='cowl_intake')
    P('paint', VH.bevel_box, (0.0, -4.3, ZT + 0.66), (0.22, 0.6, 0.1), 0.04, 1, name='sc_intake_top')
    VH.emitter('prop_wash', (0, -4.8, 0.05), (0, 1, 0), radius=3.4)


def canopy(burnt):
    zs = ZT + 0.56                                  # sill
    zt = ZT + 1.16                                  # canopy top
    ys = [-2.45, -2.05, -1.2, -0.4, 0.35, 0.95]     # windscreen base, ws top, pilot hood end, fixed mid, gunner hood, end
    def ring(y, k=1.0):
        return [V((-0.49 * k, y, zs)), V((-0.31 * k, y, zt)), V((0.31 * k, y, zt)), V((0.49 * k, y, zs))]
    # windscreen (sloped), pilot hood (slides aft), fixed centre, gunner hood (slides forward), tail cone glazing
    ws = [V((-0.44, ys[0], zs)), V((0.44, ys[0], zs)), V((-0.20, ys[0] + 0.05, zs + 0.2))] + ring(ys[1])
    AC.G_(AC.hull_bm, ws, name='windscreen')
    AC.frame_bars([V((-0.28, ys[1], zt)), V((0.28, ys[1], zt)), V((0.44, ys[0], zs)), V((-0.44, ys[0], zs))], 0.04)
    secs = [('canopy_pilot', ys[1] + 0.01, ys[2], (0, 0.75)), (None, ys[2], ys[3], None), ('canopy_gunner', ys[3], ys[4], (-0.6, 0)),
            (None, ys[4], ys[5], None)]
    for node, y0, y1, lim in secs:
        nd = node or 'main'
        k1 = 0.97 if y1 == ys[5] else 1.0
        pts = ring(y0) + ring(y1, k1)
        if y1 == ys[5]:
            pts = ring(y0) + [V((-0.40, y1, zs)), V((0.40, y1, zs)), V((0, y1, zs + 0.25))]
        piv = (0, (y0 + y1) / 2, zs) if node else None
        AC.G_(AC.hull_bm, pts, name=(node or 'glass') + '_glass', node=nd, pivot=piv)
        for yy in (y0, y1) if y1 != ys[5] else (y0,):
            AC.frame_bars(ring(yy), 0.045, node=nd, closed=False, name='hoop')
        for a, b in ((1, 1), (2, 2)):
            P('paint', beam, ring(y0)[a], (ring(y1, k1)[b] if y1 != ys[5] else V((0, y1, zs + 0.25))), 0.04, 0.03,
              name='rail', node=nd, pivot=piv)
        for sx in (-1, 1):
            P('paint', beam, (sx * 0.39, y0, zs + 0.22), (sx * 0.39, y1, zs + 0.2), 0.03, 0.02, name='side_bar', node=nd, pivot=piv)
        if node:
            VH.moving(node, 'canopy_slide', piv, (0, 1, 0), None, travel_m=list(lim))
    # cockpit content, rear MG 15 on its ring mount
    P('black', box, (0, -1.7, ZT + 0.35), (0.42, 0.45, 0.35), name='pilot_seat')
    P('black', box, (0, 0.1, ZT + 0.35), (0.40, 0.40, 0.30), name='gunner_seat')
    P('paint', box, (0, -1.25, ZT + 0.75), (0.5, 0.03, 0.55), name='armour_bulkhead')
    gp = V((0, 0.9, zs + 0.2))
    P('gunmetal', cyl, gp, gp + V((0, 0.85, 0.12)), 0.02, 6, name='mg15', node='gun_rear', pivot=tuple(gp))
    P('gunmetal', cyl, gp + V((0, 0.10, 0.02)), gp + V((0, 0.3, 0.04)), 0.045, 8, name='mg15_body', node='gun_rear', pivot=tuple(gp))
    P('black', cyl, gp + V((0.07, 0.15, -0.02)), gp + V((0.07, 0.15, 0.14)), 0.06, 8, name='mg15_drum', node='gun_rear', pivot=tuple(gp))
    VH.moving('gun_rear', 'gun_yaw_pitch', gp, (0, 0, 1), (-40, 40), elev_deg=[-10, 60])
    VH.socket('muzzle_mg15_rear', gp + V((0, 0.86, 0.12)), (0, 1, 0.14), node='gun_rear', kind='muzzle', weapon='MG 15 7.92 mm')
    VH.socket('pilot', (0, -1.7, ZT + 0.5), (0, -1, 0), pose='sit_pilot', role='pilot')
    VH.socket('gunner', (0, 0.1, ZT + 0.45), (0, 1, 0), pose='sit_rear_gunner', role='radio_gunner')


def gear(burnt):
    for s in (-1, 1):
        side = 'l' if s > 0 else 'r'
        _, y, z, ch, t = wat(1.85)
        hub = V((s * 1.85, y + 0.25, MWZ))
        top = V((s * 1.85, y + 0.62, z - 0.1))
        if burnt:
            hub = hub + V((s * 0.25, 0.25, 0.25))     # buckled leg
        # trouser fairing (streamlined, from the wing down to the spat)
        bm = bmesh.new()
        rings = []
        for k in range(5):
            f = k / 4
            c = top.lerp(hub + V((0, 0, 0.35)), f)
            rings.append([c + V((0.10 * math.cos(a) * (1 - 0.15 * f), 0.42 * math.sin(a) + 0.12 * (1 - abs(math.sin(a))) *
                                 (-1 if math.sin(a) < 0 else 1) * 0, 0)) for a in [2 * math.pi * i / 12 for i in range(12)]])
        VH.C.loft_bm(bm, rings, True, True)
        AC.skin(bm, 'trouser', 'air_skin')
        # spat around the wheel (open at the bottom slot)
        bm = bmesh.new()
        AC.fus_bm(bm, [(hub.y - 0.62, hub.z + 0.05, 0.10, 0.22, 2.2, hub.x), (hub.y - 0.40, hub.z + 0.05, 0.28, 0.66, 2.3, hub.x),
                       (hub.y, hub.z + 0.08, 0.34, 0.86, 2.4, hub.x), (hub.y + 0.40, hub.z + 0.10, 0.26, 0.62, 2.2, hub.x),
                       (hub.y + 0.72, hub.z + 0.14, 0.06, 0.18, 2.0, hub.x)], segs=16)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < hub.z - 0.30], context='FACES')
        AC.skin(bm, 'spat', 'air_skin')
        VH.wheel('wheel_' + side, hub, 0.42, 0.20, 0.24, s, style='disc', lug=0.0)
        VH.emitter('dust', (hub.x, hub.y + 0.6, 0.05), (0, 1, 0.3))
        # Jericho siren on the leg leading edge (wind-driven: spins)
        sp = top.lerp(hub, 0.25) + V((0, -0.45, 0))
        P('paint', cyl, sp, sp + V((0, 0.25, 0)), 0.085, 12, name='siren_body')
        if not burnt:
            AC.prop('siren_' + side, sp - V((0, 0.02, 0)), (0, 1, 0), 0.14, 3, chord=0.05, spin_r=0.04, spin_len=0.06,
                    kind='prop', spinner=True)
    tw = V((0, 5.05, TWZ))
    P("paint", cyl, (0, 4.95, ZT - 0.02), tw + V((0, 0, 0.1)), 0.05, 8, name='tailwheel_leg', node='tailwheel_fork', pivot=(0, 4.95, ZT - 0.3))
    P('paint', box, tw + V((0, -0.05, 0.12)), (0.14, 0.34, 0.08), name='tailwheel_guard', node='tailwheel_fork', pivot=(0, 4.95, ZT - 0.3))
    VH.moving('tailwheel_fork', 'castor', (0, 4.95, ZT - 0.3), (0, 0, 1), (-180, 180))
    VH.wheel('tailwheel', tw, 0.19, 0.10, 0.10, 1, style='disc', lug=0.0)
    AC.PARENTS['tailwheel'] = 'tailwheel_fork'


def bomb(node, c, L, r, kind='paint_under', fins=True, name='bomb'):
    """German SC-series bomb along Y (nose -Y): ogive nose, cylindrical body, tapered tail, box fin with struts."""
    c = V(c)
    bm = bmesh.new()
    AC.fus_bm(bm, [(c.y - L * 0.5, c.z, r * 0.25, r * 0.25, 2.0, c.x), (c.y - L * 0.42, c.z, r * 1.5, r * 1.5, 2.0, c.x),
                   (c.y - L * 0.30, c.z, r * 2, r * 2, 2.0, c.x), (c.y + L * 0.10, c.z, r * 2, r * 2, 2.0, c.x),
                   (c.y + L * 0.30, c.z, r * 1.1, r * 1.1, 2.0, c.x), (c.y + L * 0.36, c.z, r * 0.5, r * 0.5, 2.0, c.x)], segs=12)
    VH.vp(bm, kind, name, node=node, smooth=True)
    if fins:
        for a in (0, 90):
            ca, sa = math.cos(math.radians(a + 45)), math.sin(math.radians(a + 45))
            P(kind, box, (c.x, c.y + L * 0.42, c.z), (0.0, 0.0, 0.0), name=name + '_fin', node=node) if False else None
            bmf = bmesh.new()
            VH.C.box_bm(bmf, (0, 0, 0), (r * 2.4, L * 0.22, 0.008))
            for v in bmf.verts:
                v.co = Matrix.Rotation(math.radians(a + 45), 3, 'Y') @ v.co + V((c.x, c.y + L * 0.40, c.z))
            VH.vp(bmf, kind, name + '_fin', node=node)
        P(kind, cyl, (c.x, c.y + L * 0.46, c.z), (c.x, c.y + L * 0.51, c.z), r * 1.2, 12, name=name + '_ring', node=node)
    P('yellow' if False else 'black', box, (c.x, c.y + L * 0.05, c.z + r * 1.0), (0.02, L * 0.3, 0.004), name=name + '_stencil', node=node)


def ordnance(burnt):
    if burnt:
        return
    # SC 250 on the swing-arm crutch (trapeze swings the bomb clear of the prop in the dive)
    bc = V((0, -2.0, ZT - 0.72 - 0.2))
    piv = (0, -1.2, ZT - 0.75)
    bomb('bomb_crutch', bc, 1.64, 0.184, name='sc250')
    for sx in (-1, 1):
        P('paint', beam, (sx * 0.22, -1.2, ZT - 0.72), (sx * 0.22, -2.05, ZT - 0.72 - 0.05), 0.05, 0.03, name='crutch_arm',
          node='bomb_crutch', pivot=piv)
    AC.FRAMES['bomb_crutch'] = AC.frame_for((1, 0, 0))
    VH.moving('bomb_crutch', 'bomb_trapeze', piv, (1, 0, 0), (0, 70), toggle='bombed_up')
    for s in (-1, 1):
        for x in (3.3, 4.1):
            _, y, z, ch, t = wat(x)
            c = V((s * x, y + 0.9, z - ch * t * 0.5 - 0.22))
            bomb('bombs_wing', c, 1.09, 0.1, name='sc50')
            P('paint', box, (s * x, y + 0.9, z - ch * t * 0.5 - 0.07), (0.05, 0.5, 0.1), name='etc50_rack')
    VH.VM['toggles']['bombs_wing'] = 'SC 50 x4 (hide when unloaded)'


def markings(skins):
    fus = [o for o in skins if o.name.startswith('fuselage')]
    wings = [o for o in VH.C.A.parts if o.name.startswith(('wing', 'aileron', 'flap'))]
    for s in (-1, 1):
        AC.cross(fus, (s * 0.6, 1.75, ZT + 0.02), (s, 0, 0), 1.0, up=(0, 0, 1))
        AC.cross(wings, (s * 5.2, -1.6, 2.2), (0, 0, 1), 1.15, up=(0, 1, 0))
        AC.cross(wings, (s * 5.0, -1.6, 0.6), (0, 0, -1), 1.3, up=(0, 1, 0))
        # Stammkennzeichen / unit code T6+AK (II./StG 2): "T6" ahead of the cross, "AK" behind (read nose-first)
        AC.letters(fus, 'T6', (s * 0.6, 0.55, ZT + 0.0), (s, 0, 0), 0.55, up=(0, 0, 1), kind='black')
        AC.letters(fus, 'AK', (s * 0.6, 2.75, ZT + 0.06), (s, 0, 0), 0.50, up=(0, 0, 1), kind='black')


def main(var, out_root):
    AC.setup('ju87_b', var, SCHEME, PLANES, BANDS, seed=87)
    burnt = var == 'burnt'
    skins = airframe(burnt)
    nose(burnt)
    canopy(burnt)
    gear(burnt)
    ordnance(burnt)
    markings(skins)
    AC.nav_lights((6.9, -1.7, 1.58), (-6.9, -1.7, 1.58), (0, 5.55, ZT + 0.3))
    VH.emitter('fire', (0, -3.8, ZT), (0, 0, 1), when='destroyed', note='engine / wing fuel tanks')
    VH.emitter('fuel_leak', (2.5, -2.0, 0.8), (0, 0, -1), when='damaged')
    VH.socket('mechanic_wingroot', (1.2, -2.0, 1.45), (0, -1, 0), pose='stand', role='ground_crew')
    if burnt:
        VH.emitter('smoke', (0, -2.5, 1.5), (0, 0, 1), kind2='wreck_smoulder')
    ang = AC.level((1.85, -2.73 + (0.25 if burnt else 0), MWZ + (0.25 if burnt else 0)), 0.42 if not burnt else 0.26,
                   (0, 5.05, TWZ), 0.19)
    if burnt:
        AC.transform_all(Matrix.Rotation(math.radians(4.0), 4, 'Y'))
        zmin = min(v.co.z for o in VH.C.A.parts for v in o.data.vertices)
        AC.transform_all(Matrix.Translation((0, 0, -zmin - 0.02)))
    dims = {'length': 11.10, 'span': 13.80, 'height_3pt': 4.01, 'prop_d': 3.40}
    AC.vfin(os.path.join(out_root, 'ju87_b'), 'ju87', dims, variants=ALL,
            extra={'real_name': 'Junkers Ju 87 B-2 Stuka', 'destroyed': burnt, 'ground_angle_deg': round(ang, 2),
                   'rotation_order': 'YXZ', 'side': 'axis', 'role': 'M10 airfield (optional target), parked',
                   'paint_scheme': {'grey': 'RLM 70/71 splinter over RLM 65', 'dak': 'RLM 79/78 + white theatre band',
                                    'winter': 'white distemper over 70/71', 'burnt': 'wreck'}[var]})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, os.path.join(VH.SCR, '..', 'out'))
