# Citroen Traction Avant 11 B "Normale" (1938-40s) - civilian black, or requisitioned by the Wehrmacht (grey, blackout
# covers, Notek, white bumper ends). blender -b --factory-startup --python citroen.py -- black|grey|burnt
# Real dims: L 4.62 m (11 B normale), W 1.79 m, H 1.52 m, wheelbase 3.09 m, track 1.46 / 1.34 m, tyres 165x400 (D ~0.69 m),
# monocoque, front-wheel drive, running boards, suicide front doors (all doors hinge on the B pillar), spare wheel on the boot.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['black', 'grey', 'burnt']
YF, YR = -1.55, 1.54
XF, XR = 0.73, 0.67
RT, RIM, TW = 0.345, 0.20, 0.165
BW = 0.80


def civil():
    return VH.paint_base() == 'black'


def body(burnt):
    # lower body: full width between the wings, narrowing between the rear wheels; rounded boot
    bm = bmesh.new()
    VH.body_loft(bm, [(-0.74, 0.74, 0.34, 0.42, 0.03), (-0.40, BW - 0.02, 0.32, 0.42, 0.03), (0.60, BW - 0.02, 0.32, 0.42, 0.03),
                      (1.36, BW - 0.02, 0.34, 0.42, 0.03)], n=1, rb=0.04)
    VH.vp(bm, 'paint_under', 'underbody')                   # the cabin is an open tub: floor + door skins + quarters
    P('paint', box, (0, -0.70, 0.70), (1.46, 0.06, 0.60), name='firewall')
    for sx in (-1, 1):
        bm = bmesh.new()                                      # rear quarter below the quarter window, behind the rear door
        VH.side_prism(bm, [(1.02, 0.34), (1.36, 0.34), (1.36, 0.98), (1.02, 0.98)], sx * (BW - 0.02), sx * (BW - 0.002))
        VH.vp(bm, 'paint', 'rear_quarter')
        bm = bmesh.new()                                      # scuttle side ahead of the front door
        VH.side_prism(bm, [(-0.74, 0.40), (-0.665, 0.40), (-0.665, 1.00), (-0.74, 1.00)], sx * (BW - 0.06), sx * (BW - 0.002))
        VH.vp(bm, 'paint', 'cowl_side')
        P('paint', box, (sx * (BW - 0.01), 0.33, 0.66), (0.022, 0.02, 0.62), name='bpillar_low')
        P('paint', beam, (sx * (BW - 0.004), -0.70, 0.975), (sx * (BW - 0.004), 1.36, 0.975), 0.02, 0.012, name='belt_moulding')
    bm = bmesh.new()
    VH.body_loft(bm, [(1.02, BW, 0.72, 0.98, 0.12), (1.60, 0.79, 0.72, 0.99, 0.14), (2.00, 0.74, 0.70, 0.88, 0.16),
                      (2.18, 0.66, 0.62, 0.74, 0.12), (2.26, 0.56, 0.52, 0.60, 0.05)], n=3)
    VH.vp(bm, 'paint', 'boot', smooth=True)
    bm = bmesh.new()
    VH.body_loft(bm, [(1.02, 0.56, 0.34, 0.74, 0.04), (2.10, 0.56, 0.40, 0.74, 0.06), (2.25, 0.50, 0.48, 0.60, 0.04)], n=2)
    VH.vp(bm, 'paint_under', 'rear_low')
    # greenhouse: low, rounded roof that curves down into the rear bustle; OPEN window apertures (pillars + roof), so
    # the interior reads through the tinted glass. Everything above the belt leans inward (tumblehome, th()).
    bm = bmesh.new()
    VH.body_loft(bm, [(-0.52, 0.60, 1.37, 1.405, 0.03, 0.005), (-0.34, 0.62, 1.38, 1.455, 0.06, 0.02), (0.10, 0.63, 1.39, 1.485, 0.08, 0.03),
                      (0.80, 0.63, 1.385, 1.48, 0.08, 0.03), (1.20, 0.63, 1.36, 1.445, 0.08, 0.02), (1.40, 0.63, 1.33, 1.40, 0.06, 0.02)], n=3)
    for v in bm.verts:
        v.co.x *= th(v.co.z) / th(1.38) * 0.99
    VH.vp(bm, 'paint', 'roof', smooth=True)
    bm = bmesh.new()                                          # fastback bustle: roof falls into the boot
    VH.body_loft(bm, [(1.34, 0.72, 0.97, 1.40, 0.24, 0.02), (1.55, 0.725, 0.97, 1.31, 0.25, 0.02), (1.75, 0.73, 0.97, 1.16, 0.18, 0.01),
                      (1.92, 0.74, 0.97, 1.01, 0.08, 0.004)], n=4)
    for v in bm.verts:
        v.co.x *= th(v.co.z)
    VH.vp(bm, 'paint', 'bustle', smooth=True)
    for sx in (-1, 1):                                        # A, B, C pillars
        for (ya, za), (yb, zb) in (((-0.72, 1.00), (-0.50, 1.39)), ((0.335, 0.97), (0.335, 1.40)), ((1.00, 0.97), (1.00, 1.39))):
            P('paint', beam, (sx * 0.715 * th(za), ya, za), (sx * 0.715 * th(zb), yb, zb), 0.045 if ya > -0.7 else 0.035, 0.06, name='pillar')
        for (y0, y1) in ((-0.62, 0.32), (0.35, 0.99), (1.01, 1.36)):   # drip rail over the doors
            P('paint', beam, (sx * 0.70 * th(1.39) + sx * 0.01, y0, 1.385), (sx * 0.70 * th(1.39) + sx * 0.01, y1, 1.375), 0.012, 0.018, name='drip_rail')
    for sx in (-1, 1):
        # windscreen: two flat panes either side of the centre bar
        nrm = V((0, -0.45, 0.25)).normalized() * 0.02
        q = [V((sx * 0.03, -0.715, 1.03)) + nrm, V((sx * 0.64, -0.705, 1.03)) + nrm, V((sx * 0.60 * th(1.38), -0.515, 1.38)) + nrm,
             V((sx * 0.03, -0.51, 1.39)) + nrm]
        bm = bmesh.new()
        C_quad(bm, q, flip=sx > 0)
        VH.vp(bm, 'glass_cab', 'windscreen', recalc=False)
        P('paint', beam, (0, -0.715, 1.03), (0, -0.51, 1.39), 0.03, 0.02, name='ws_bar')
    P('paint', beam, (-0.66, -0.72, 1.01), (0.66, -0.72, 1.01), 0.03, 0.04, name='scuttle_lip')
    # rear window: small oval-ish pane in the bustle over a dark recess
    rw = [V((-0.34, 1.715, 1.18)), V((0.34, 1.715, 1.18)), V((0.30, 1.50, 1.335)), V((-0.30, 1.50, 1.335))]
    n_rw = V((0, 0.59, 0.81)) * 0.012
    bm = bmesh.new()
    C_quad(bm, [p + n_rw * 0.5 for p in rw])
    VH.vp(bm, 'black', 'rear_window_recess', recalc=False)
    bm = bmesh.new()
    C_quad(bm, [p + n_rw for p in rw])
    VH.vp(bm, 'glass_cab', 'rear_window', recalc=False)
    # drip rail, door seams (panels are the door nodes), handles, chrome belt strip (civilian)
    for sx in (-1, 1):
        for nm, y0, y1, hinge in (('door_f', -0.66, 0.32, 'rear'), ('door_r', 0.34, 1.02, 'front')):
            node = nm + ('l' if sx < 0 else 'r')
            yh = y1 if hinge == 'rear' else y0
            piv = (sx * (BW + 0.01), yh, 0.70)
            kw = dict(node=node, pivot=piv)
            P('paint', VH.bevel_box, (sx * (BW - 0.005), (y0 + y1) / 2, 0.66), (0.02, y1 - y0 - 0.012, 0.62), 0.008, 1, name='door_skin', **kw)
            P('paint_under', box, (sx * (BW - 0.03), (y0 + y1) / 2, 0.68), (0.012, y1 - y0 - 0.06, 0.52), name='door_card', **kw)
            # window frame + drop glass travel with the door (the whole door opens, not just the skin)
            z0, z1 = 0.985, 1.375
            ya, yb = y0 + 0.02, y1 - 0.02
            fx = lambda z: sx * (0.715 * th(z) - 0.005)
            fr = [(fx(z0), ya, z0), (fx(z1), ya, z1), (fx(z1), yb, z1), (fx(z0), yb, z0)]
            for a_, b_ in zip(fr[:-1], fr[1:]):
                P('chrome' if civil() else 'paint', beam, a_, b_, 0.018, 0.018, name='window_frame', **kw)
            q = [V((fx(z0) + sx * 0.002, ya + 0.01, z0)), V((fx(z0) + sx * 0.002, yb - 0.01, z0)), V((fx(z1) + sx * 0.002, yb - 0.01, z1 - 0.01)),
                 V((fx(z1) + sx * 0.002, ya + 0.01, z1 - 0.01))]
            bm = bmesh.new()
            C_quad(bm, q, flip=sx < 0)
            VH.vp(bm, 'glass_cab', 'side_glass', recalc=False, **kw)
            # period pull handle: chrome (civilian) / black T-handle on an escutcheon, at the door's free edge
            hy = (y1 - 0.09) if hinge == 'front' else (y0 + 0.09)
            P('chrome' if civil() else 'black', box, (sx * (BW + 0.012), hy, 0.90), (0.012, 0.06, 0.05), name='handle_plate', **kw)
            P('chrome' if civil() else 'black', beam, (sx * (BW + 0.03), hy - 0.06, 0.905), (sx * (BW + 0.03), hy + 0.06, 0.905), 0.018, 0.02,
              name='handle', **kw)
            P('chrome' if civil() else 'black', box, (sx * (BW + 0.02), hy, 0.905), (0.02, 0.02, 0.02), name='handle_stem', **kw)
            VH.moving(node, 'door', piv, (0, 0, 1), limits=(0, 75) if (sx < 0) == (hinge == 'front') else (-75, 0), hinge=hinge)
        q = [V((sx * (0.715 * th(0.985) - 0.003), 1.03, 0.985)), V((sx * (0.715 * th(0.985) - 0.003), 1.35, 0.985)),
             V((sx * (0.715 * th(1.30) - 0.003), 1.35, 1.30)), V((sx * (0.715 * th(1.37) - 0.003), 1.03, 1.37))]
        bm = bmesh.new()
        C_quad(bm, q, flip=sx < 0)
        VH.vp(bm, 'glass_cab', 'quarter_glass', recalc=False)
        if civil():
            P('chrome', box, (sx * (BW + 0.006), 0.20, 0.97), (0.01, 2.2, 0.012), name='belt_chrome')


def th(z):
    """Tumblehome: the greenhouse leans inward above the belt (0.97 m)."""
    return 1.0 - 0.17 * max(0.0, z - 0.97) / 0.52


def C_loft(bm, rings):
    import kit_core as C
    C.loft_bm(bm, rings, True, True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def C_quad(bm, q, flip=False):
    import kit_core as C
    C.quad(bm, q, flip)


# long flowing front wing (side profile y, z; width scale; crown scale): starts as a rounded point low at the bumper,
# climbs in one long curve over the wheel and sweeps back down into the running board at the front door
WING = [(-2.25, 0.45, 0.22, 0.4), (-2.21, 0.52, 0.45, 0.6), (-2.14, 0.60, 0.66, 0.8), (-2.04, 0.68, 0.82, 0.92), (-1.92, 0.75, 0.93, 1.0),
        (-1.78, 0.80, 1.0, 1.0), (-1.62, 0.83, 1.0, 1.0), (-1.46, 0.83, 1.0, 1.0), (-1.30, 0.80, 1.0, 1.0), (-1.15, 0.74, 1.0, 1.0),
        (-1.03, 0.665, 1.0, 1.0), (-0.93, 0.58, 1.0, 1.0), (-0.85, 0.50, 1.0, 1.0), (-0.78, 0.43, 1.0, 1.0), (-0.70, 0.385, 1.0, 0.8),
        (-0.62, 0.372, 1.0, 0.6)]


def flow_wing(bm, st, prof, x0, mirror):
    """Sweep with per-station width/crown scaling (tapered, rounded tip) - the profile narrows about its centre."""
    import kit_core as C
    rings = []
    wmid = 0.194
    for i, (y, z, ws, cs) in enumerate(st):
        a = st[max(0, i - 1)]
        b = st[min(len(st) - 1, i + 1)]
        t = V((0, b[0] - a[0], b[1] - a[1])).normalized()
        nrm = V((0, -t.z, t.y))
        if nrm.z < -0.2:
            nrm = -nrm
        ring = []
        for dx, dn in prof:
            xx = wmid + (dx - wmid) * ws + (1 - ws) * 0.05
            ring.append(V((x0 + (-xx if mirror else xx), y, z)) + nrm * dn * cs)
        rings.append(ring)
    C.loft_bm(bm, rings, True, True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def front(burnt):
    # bonnet: narrow at the grille, widening to the scuttle; vertical side vents
    bm = bmesh.new()
    VH.body_loft(bm, [(-2.10, 0.34, 0.52, 0.93, 0.10), (-1.70, 0.44, 0.50, 0.97, 0.13), (-1.10, 0.56, 0.48, 1.00, 0.14),
                      (-0.72, 0.64, 0.46, 1.01, 0.12)], n=3)
    VH.vp(bm, 'paint', 'bonnet', smooth=True)
    for sx in (-1, 1):
        for i in range(10):
            y = -1.55 + i * 0.06
            hw = 0.44 + (y + 1.70) / 0.6 * 0.12
            P('black', box, (sx * (hw + 0.003), y, 0.80), (0.008, 0.025, 0.20), name='vent')
    # rw2: tall, slightly V-ed (in plan) grille shield: recessed black core, horizontal bars following the V, the double
    # chevron formed BY the two upper grille bars, and a deep chrome surround standing proud of the bonnet nose
    rake = math.radians(9)
    VD = 0.035                                                  # V depth: centre line ahead of the edges

    def gp(x, z, proud=0.0):
        hw = 0.31 - (z - 0.47) * 0.09
        return V((x, -2.14 + (z - 0.47) * math.tan(rake) - VD * (1 - min(1.0, abs(x) / hw)) - proud, z))
    zb, zt = 0.47, 0.93
    bm = bmesh.new()
    for sx in (-1, 1):
        hb, ht = 0.31, 0.31 - (zt - zb) * 0.09
        q = [gp(sx * hb, zb), gp(0, zb), gp(0, zt), gp(sx * ht, zt)]
        C_quad(bm, [v + V((0, 0.012, 0)) for v in q], flip=sx > 0)
    VH.vp(bm, 'black', 'grille', recalc=False)
    bar = 'chrome' if civil() else 'paint'
    for k in range(6):                                          # plain horizontal bars (lower grille)
        z = 0.50 + k * 0.042
        hw = 0.31 - (z - 0.47) * 0.09 - 0.01
        for sx in (-1, 1):
            P(bar, beam, gp(sx * hw, z, 0.004), gp(0, z, 0.004), 0.008, 0.012, name='grille_bar')
    for z0 in (0.74, 0.83):                                      # the double chevron = the two upper grille bars
        hw = 0.31 - (z0 - 0.47) * 0.09 - 0.012
        for sx in (-1, 1):
            P('chrome' if not burnt else 'paint', beam, gp(sx * hw, z0, 0.008), gp(0, z0 + 0.075, 0.012), 0.034, 0.016, name='chevron')
    rim = [gp(-0.31, zb, 0.012), gp(0, zb, 0.012), gp(0.31, zb, 0.012), gp(ht, zt, 0.012), gp(0, zt + 0.012, 0.012), gp(-ht, zt, 0.012)]
    for a, b in zip(rim, rim[1:] + rim[:1]):
        P('chrome', beam, a, b, 0.03, 0.035, name='grille_surround')
    P('paint', box, (0, -2.12, zt + 0.012), (0.56, 0.06, 0.03), name='grille_top_fill')
    # front wings (long, flowing into the running boards), rear wings with skirts
    # rw2: thin elegant sheet (~1.2 cm) with a short turned edge + narrow bead (was a 9.5 cm deep, heavy rolled skirt)
    prof = [(0.0, 0.0), (0.06, 0.03), (0.15, 0.05), (0.25, 0.05), (0.33, 0.032), (0.37, 0.008), (0.386, -0.018), (0.39, -0.03),
            (0.395, -0.034), (0.394, -0.044), (0.385, -0.044), (0.379, -0.02), (0.362, 0.0), (0.323, 0.022), (0.25, 0.038),
            (0.15, 0.038), (0.06, 0.018), (0.0, -0.012)]
    wprof = [(0.33, 0.036), (0.37, 0.012), (0.389, -0.016), (0.398, -0.034), (0.392, -0.036), (0.382, -0.018), (0.365, 0.004), (0.33, 0.026)]
    for sx in (-1, 1):
        bm = bmesh.new()
        flow_wing(bm, WING, prof, sx * 0.505, sx < 0)
        VH.vp(bm, 'paint', 'front_wing', smooth=True)
        if not civil() and not burnt:                          # requisitioned: white blackout marking on the wing edge
            bm = bmesh.new()
            flow_wing(bm, WING[1:6], wprof, sx * 0.505, sx < 0)
            VH.vp(bm, 'white', 'wing_white', lod='drop2')
        P('black' if civil() else 'paint', box, (sx * 0.84, 0.10, 0.36), (0.14, 1.78, 0.03), name='running_board')
        for k in range(5):                                    # ribbed rubber mat + alloy edge strip
            P('rubber', box, (sx * (0.785 + k * 0.026), 0.10, 0.380), (0.014, 1.66, 0.010), name='board_rib', lod='drop')
        P('chrome' if civil() else 'paint', box, (sx * 0.912, 0.10, 0.365), (0.012, 1.78, 0.036), name='board_edge')
        P('paint_under', box, (sx * 0.80, -0.55, 0.30), (0.05, 0.05, 0.08), name='board_bracket')
        P('paint_under', box, (sx * 0.80, 0.75, 0.30), (0.05, 0.05, 0.08), name='board_bracket')
        bm = bmesh.new()
        rpath = [(0.96, 0.38)] + VH.arc_path(YR, RT, 0.44, 158, 25, 12) + [(2.06, 0.50)]
        VH.sweep_bm(bm, rpath, [(a * 0.62, b) for a, b in prof], x0=sx * 0.64, mirror=sx < 0)
        VH.vp(bm, 'paint', 'rear_wing', smooth=True)
        P('paint', box, (sx * 0.86, YR, 0.52), (0.02, 0.62, 0.30), name='wheel_skirt')
        # headlights on the cross bar between the wings, side lamps, trafficator
        VH.headlight('headlight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.50, -2.02, 0.98), 0.115, 0.17, cover=not civil(),
                     rim_kind='chrome' if civil() else 'paint')
        VH.taillight('taillight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.62, 2.10, 0.78), (0, 1, 0.4))
    P('chrome' if civil() else 'paint', cyl, (-0.50, -1.96, 0.94), (0.50, -1.96, 0.94), 0.018, 8, name='lamp_bar')
    if not civil():
        VH.notek('notek', (-0.62, -2.20, 0.66))
    # bumpers: twin-blade chrome (civilian) or painted with white ends (requisitioned)
    for sx in (-1, 1):                                          # rw2: chassis rails / subframe horns carry the bumper irons
        P('paint_under', box, (sx * 0.45, 0.0, 0.40), (0.07, 4.36, 0.10), name='chassis_rail')
    for y in (-2.17, 2.17):
        P('paint_under', box, (0, y, 0.40), (0.98, 0.06, 0.10), name='crossmember')
    for y in (-2.31, 2.31):
        for dz in (-0.03, 0.04):
            P('chrome' if civil() else 'paint', VH.bevel_box, (0, y, 0.44 + dz), (1.64, 0.04, 0.045), 0.012, 1, name='bumper')
        for sx in (-1, 1):
            P('paint_under', box, (sx * 0.45, math.copysign(2.235, y), 0.44), (0.05, 0.13, 0.06), name='bumper_arm')
            if not civil() and not burnt:
                P('white', box, (sx * 0.70, y + math.copysign(0.022, y), 0.445), (0.22, 0.006, 0.10), name='bumper_white', lod='drop2')
    VH.tac_number((0.0, -2.335, 0.33), (0, -1, 0), 0.44, 0.10)
    VH.tac_number((0.0, 2.275, 0.56), (0, 1, 0), 0.34, 0.16)


def rear_running(burnt):
    # spare wheel under its round cover on the boot
    ang = math.radians(58)
    c = V((0, 2.16, 0.84))
    ax = V((0, math.sin(ang), math.cos(ang)))
    bm = bmesh.new()                                          # domed spare-wheel cover standing proud of the boot lid
    rings = []
    for f, r in ((-0.08, 0.35), (0.02, 0.355), (0.07, 0.33), (0.11, 0.27), (0.135, 0.18), (0.145, 0.06)):
        u = ax.orthogonal().normalized()
        w_ = ax.cross(u)
        rings.append([c + ax * f + (u * math.cos(2 * math.pi * i / 24) + w_ * math.sin(2 * math.pi * i / 24)) * r for i in range(24)])
    C_loft(bm, rings)
    VH.vp(bm, 'paint', 'spare_cover', smooth=True)
    P('chrome' if civil() else 'paint', cyl, c + ax * 0.14, c + ax * 0.16, 0.08, 14, name='spare_badge')
    P('chrome' if civil() else 'paint', VH.ring_torus, c + ax * 0.03, 0.352, 0.01, ax, 24, 4, name='spare_band')
    for node, x, y in (('wheel_fl', -XF, YF), ('wheel_fr', XF, YF), ('wheel_rl', -XR, YR), ('wheel_rr', XR, YR)):
        VH.wheel(node, (x, y, RT), RT, TW, RIM, 1 if x > 0 else -1, lug=0.006, rim_kind='white' if civil() else 'paint')
        if y < 0:
            VH.VM['moving'][-1]['steer'] = True
            VH.VM['moving'][-1]['steer_limits_deg'] = [-35, 35]
        else:
            VH.emitter('dust', (x, y + 0.4, 0.05), (0, 1, 0.4))
    P('paint_under', box, (0, 0.0, 0.30), (1.20, 3.6, 0.06), name='floorpan')
    P('metal', cyl, (-0.72, YF, RT), (0.72, YF, RT), 0.03, 8, name='driveshafts')
    P('metal', cyl, (-0.6, YR, RT), (0.6, YR, RT), 0.04, 8, name='rear_axle')
    P('metal', cyl, (-0.3, -0.8, 0.26), (-0.3, 2.20, 0.26), 0.03, 8, name='exhaust')
    VH.emitter('exhaust', (-0.3, 2.28, 0.25), (0, 1, -0.05))
    VH.steering_wheel('steering_wheel', (-0.36, -0.42, 1.10), (0, 0.55, 0.83), R=0.2)
    for nm, x, y in (('seat_driver', -0.36, -0.05), ('seat_codriver', 0.36, -0.05), ('seat_rear_l', -0.40, 0.80), ('seat_rear_r', 0.40, 0.80)):
        VH.socket(nm, (x, y, 0.72), role='driver' if nm == 'seat_driver' else 'passenger')
    # interior (reads through the glass): dashboard + gauges, split front seats, rear bench, parcel shelf, headlining
    P('paint', box, (0, -0.62, 0.96), (1.40, 0.10, 0.12), name='dash')
    for x in (-0.36, -0.20, 0.05):
        P('black', cyl, (x, -0.57, 0.96), (x, -0.565, 0.96), 0.04, 10, name='gauge')
    P('black', cyl, (-0.36, -0.66, 0.80), (-0.36, -0.42, 1.10), 0.02, 6, name='column')
    for x in (-0.36, 0.36):
        P('seat', VH.bevel_box, (x, -0.05, 0.60), (0.56, 0.52, 0.12), 0.04, 2, name='seat')
        P('seat', VH.bevel_box, (x, 0.22, 0.86), (0.56, 0.10, 0.50), 0.04, 2, name='seat_back')
        P('paint_under', box, (x, -0.05, 0.49), (0.46, 0.44, 0.12), name='seat_base')
    P('seat', VH.bevel_box, (0, 0.80, 0.60), (1.36, 0.52, 0.12), 0.04, 2, name='bench')
    P('seat', VH.bevel_box, (0, 1.10, 0.86), (1.36, 0.12, 0.54), 0.04, 2, name='bench_back')
    P('paint_under', box, (0, 1.30, 1.00), (1.30, 0.28, 0.02), name='parcel_shelf')
    if not burnt:
        P('canvas', box, (0, 0.40, 1.365), (1.12, 1.70, 0.012), name='headlining', lod='drop')
    P('rubber', box, (0, 0.20, 0.425), (1.36, 1.70, 0.01), name='floor_mat', lod='drop')


def main(var, out_root):
    VH.setup('citroen11', var, seed=11)
    burnt = var == 'burnt'
    body(burnt)
    front(burnt)
    rear_running(burnt)
    if burnt:
        VH.rotate_node('door_fl', 40, (0, 0, 1))
        VH.emitter('smoke', (0, 0.3, 1.2), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(1.8), 4, 'Y'))
    VH.emitter('fire', (0, -1.4, 1.0), (0, 0, 1), when='destroyed', note='engine bay fire')
    dims = {'length': 4.62, 'width': 1.79, 'height': 1.52, 'wheelbase': 3.09, 'track_front': 1.46, 'track_rear': 1.34,
            'tyre_d': round(2 * RT, 3)}
    VH.vfinalize(os.path.join(out_root, 'citroen11'), 'citroen15', dims, variants=ALL,
                 extra={'real_name': 'Citroen Traction Avant 11 B (stands in for 15-Six)', 'destroyed': burnt,
                        'rotation_order': 'YXZ', 'civilian': var == 'black'})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'black').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, VH.OUT_ROOT)
