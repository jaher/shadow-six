# Opel Blitz 3.6-36S 3-ton truck (1937-44): cargo (dropside bed + canvas tarp on bows) or fuel tanker (Tankkraftwagen,
# elliptical tank). Refines the realism/blender-modeling/truck.py prototype (same stations/dimensions) in the kit pipeline.
# blender -b --factory-startup --python blitz.py -- <body>:<variant>[,...]  body cargo|tanker; variant grey|dak|winter|burnt
# Real dims: L 6.02 m, W 2.27 m, H 2.18 m (cab) / 2.84 m (tarp), wheelbase 3.60 m, track 1.65 / 1.63 m, 7.50-20 tyres
# (twin rear), 3.6 l six, all-steel cab with split raked windscreen, Notek + blackout headlight covers.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
L0 = -3.01                                   # front bumper face


def Y(s):
    return L0 + s


YF, YR = Y(0.62), Y(4.22)
RT, RIM, TW = 0.455, 0.254, 0.20
XF, XR_IN, XR_OUT = 0.825, 0.69, 0.94
CAB0, CAB1, CAB_W = 1.62, 2.98, 1.90


def chassis():
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.43, Y(3.02), 0.70), (0.07, 5.75, 0.20), name='rail')
    for s in (0.35, 1.9, 3.3, 4.4, 5.85):
        P('paint_under', box, (0, Y(s), 0.68), (0.86, 0.08, 0.12), name='xmember')
    for y in (YF, YR):
        P('paint_under', cyl, (-0.80, y, RT), (0.80, y, RT), 0.055, 10, name='axle')
        for sx in (-1, 1):
            P('paint_under', box, (sx * 0.43, y, 0.56), (0.08, 1.05, 0.07), name='leaf_spring')
    P('paint_under', VH.bevel_box, (0, YR, RT), (0.32, 0.28, 0.30), 0.06, 2, name='diff')
    P('paint_under', cyl, (0, Y(1.9), 0.55), (0, YR, 0.50), 0.04, 8, name='propshaft')
    P('paint', cyl, (0.66, Y(2.35) - 0.42, 0.72), (0.66, Y(2.35) + 0.42, 0.72), 0.19, 14, name='fuel_tank')
    P('paint', VH.bevel_box, (-0.66, Y(2.35), 0.72), (0.34, 0.50, 0.28), 0.02, 1, name='battery_box')
    P('metal', cyl, (0.25, Y(1.2), 0.50), (0.25, Y(4.8), 0.48), 0.04, 8, name='exhaust')
    P('metal', cyl, (0.25, Y(3.0), 0.49), (0.25, Y(3.7), 0.49), 0.09, 10, name='silencer')
    VH.emitter('exhaust', (0.25, Y(4.82), 0.48), (0.3, 1, -0.1))


def front():
    P('paint', VH.bevel_box, (0, Y(0.05), 0.52), (1.92, 0.10, 0.17), 0.015, 1, name='bumper')
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.43, Y(0.25), 0.56), (0.08, 0.35, 0.10), name='bumper_arm')
        P('paint_under', VH.ring_torus, (sx * 0.62, Y(-0.03), 0.44), 0.05, 0.015, (1, 0, 0), 10, 4, name='tow_hook')
    # bonnet (rounded top), hinge, side louvres
    bm = bmesh.new()
    VH.body_loft(bm, [(Y(0.22), 0.42, 0.86, 1.55, 0.16), (Y(1.66), 0.42, 0.86, 1.56, 0.16)], n=4)
    VH.vp(bm, 'paint', 'bonnet', smooth=True)
    P('paint', cyl, (0, Y(0.22), 1.56), (0, Y(1.66), 1.565), 0.018, 8, name='bonnet_hinge')
    for sx in (-1, 1):
        for i in range(7):
            s = 0.62 + i * 0.11
            P('paint', box, (sx * 0.428, Y(s), 1.22), (0.02, 0.07, 0.30), name='louvre')
        P('black', box, (sx * 0.43, Y(1.1), 0.95), (0.03, 0.12, 0.03), name='bonnet_catch')
    # radiator shell with vertical bars + Opel emblem disc
    bm = bmesh.new()
    VH.body_loft(bm, [(Y(0.18), 0.41, 0.76, 1.54, 0.20), (Y(0.25), 0.41, 0.76, 1.55, 0.20)], n=4)
    VH.vp(bm, 'paint', 'grille_shell')
    P('black', box, (0, Y(0.172), 1.12), (0.66, 0.01, 0.62), name='radiator_core')
    for i in range(13):
        x = -0.30 + i * 0.05
        h = 0.62 if abs(x) < 0.2 else 0.62 - (abs(x) - 0.2) * 0.9
        P('paint', box, (x, Y(0.165), 1.12 - (0.62 - h) / 2), (0.014, 0.02, h), name='grille_bar')
    P('paint', cyl, (0, Y(0.16), 1.47), (0, Y(0.15), 1.47), 0.045, 12, name='emblem')
    P('paint_under', box, (0, Y(0.28), 0.76), (0.84, 0.20, 0.22), name='apron')
    VH.tac_number((0.55, Y(0.0) - 0.002, 0.52), (0, -1, 0), 0.36, 0.12)
    # front wings (crowned mudguards) sweeping down into the running boards
    path = [(Y(0.62) - 0.555, 0.53)] + VH.arc_path(YF, RT, 0.56, 168, 40, 12) + [(Y(1.62), 0.72), (Y(1.95), 0.62)]
    prof = [(-0.29, -0.012), (-0.28, 0.0), (-0.11, 0.035), (0.12, 0.032), (0.24, 0.012), (0.285, -0.01), (0.295, -0.07),
            (0.283, -0.07), (0.275, -0.014), (0.23, 0.0), (0.12, 0.02), (-0.11, 0.022), (-0.27, -0.012)]
    for sx in (-1, 1):
        bm = bmesh.new()
        VH.sweep_bm(bm, path, prof, x0=sx * 0.72, mirror=sx < 0)
        VH.vp(bm, 'paint', 'front_wing', smooth=True)
        P('paint', box, (sx * 0.82, Y(2.46), 0.61), (0.30, 1.05, 0.03), name='running_board')
        P('paint_under', box, (sx * 0.44, Y(0.95), 0.92), (0.02, 0.55, 0.30), name='splash')
        P('paint', cyl, (sx * 0.66, Y(0.36), 0.98), (sx * 0.66, Y(0.36), 1.12), 0.02, 6, name='hl_stalk')
        VH.headlight('headlight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.66, Y(0.30), 1.22), 0.115, 0.16, cover=True)
    VH.notek('notek', (-0.62, Y(0.40), 1.00))


def cab(burnt):
    hw = CAB_W / 2
    bm = bmesh.new()
    # cab = solid lower body up to the belt + roof shell + pillars; the window apertures are OPEN so the interior (seat,
    # wheel, dash) reads through the tinted glass instead of a painted/black slab
    VH.body_loft(bm, [(Y(CAB0), hw, 0.92, 1.60, 0.06), (Y(CAB0 + 0.09), hw, 0.92, 1.64, 0.08), (Y(CAB1 - 0.02), hw, 0.92, 1.64, 0.08),
                      (Y(CAB1), hw, 0.92, 1.64, 0.06)], n=3)
    VH.vp(bm, 'paint', 'cab_lower', smooth=True)
    bm = bmesh.new()
    VH.body_loft(bm, [(Y(CAB0 + 0.075), hw, 2.02, 2.07, 0.04, 0.002), (Y(CAB0 + 0.18), hw, 2.03, 2.17, 0.14, 0.01),
                      (Y(CAB1 - 0.12), hw, 2.03, 2.19, 0.14, 0.01), (Y(CAB1 - 0.02), hw, 2.03, 2.10, 0.06, 0.004),
                      (Y(CAB1), hw, 2.03, 2.06, 0.02, 0.002)], n=3)
    VH.vp(bm, 'paint', 'cab_roof', smooth=True)
    P('paint', box, (0, Y(CAB1) - 0.02, 1.84), (CAB_W, 0.04, 0.42), name='cab_back')
    for sx in (-1, 1):
        P('paint', beam, (sx * (hw - 0.03), Y(CAB0 + 0.005), 1.62), (sx * (hw - 0.03), Y(CAB0 + 0.095), 2.04), 0.06, 0.05, name='a_pillar')
        P('paint', box, (sx * (hw - 0.03), Y(CAB1) - 0.12, 1.84), (0.06, 0.24, 0.42), name='c_pillar')
    P('paint', beam, (0, Y(CAB0 + 0.005), 1.62), (0, Y(CAB0 + 0.095), 2.04), 0.05, 0.04, name='ws_post')
    P('paint', box, (0, Y(CAB0 + 0.35), 1.68), (CAB_W - 0.12, 0.28, 0.10), name='dash')
    for x in (-0.55, -0.35, 0.3):
        P('black', cyl, (x, Y(CAB0 + 0.49), 1.70), (x, Y(CAB0 + 0.495), 1.70), 0.04, 10, name='gauge')
    P('paint', box, (0, Y(CAB0 - 0.02), 1.58), (CAB_W - 0.1, 0.10, 0.06), name='cowl')
    # split raked windscreen: two panes in slim frames
    rake = math.atan2(0.09, 0.47)
    for sx in (-1, 1):
        c = V((sx * 0.43, Y(CAB0 + 0.045) - 0.004, 1.84))
        R = Matrix.Rotation(-rake, 4, 'X')
        bm = bmesh.new()
        VH.box(bm, (0, 0, 0), (0.78, 0.012, 0.40))
        VH.xf_bm(bm, Matrix.Translation(c) @ R)
        VH.vp(bm, 'glass_cab', 'windscreen')
        for a_, b_ in (((-0.41, 0.21), (0.41, 0.21)), ((-0.41, -0.21), (0.41, -0.21)), ((-0.41, -0.21), (-0.41, 0.21)), ((0.41, -0.21), (0.41, 0.21))):
            P('paint_under', beam, Matrix.Translation(c) @ R @ V((a_[0], 0.006, a_[1])), Matrix.Translation(c) @ R @ V((b_[0], 0.006, b_[1])),
              0.03, 0.02, name='ws_frame')
        P('black', beam, c + V((sx * -0.1, -0.02, 0.18)), c + V((sx * 0.15, -0.03, 0.02)), 0.012, 0.006, name='wiper')
    bm = bmesh.new()
    VH.box(bm, (0, Y(CAB1) + 0.002, 1.86), (0.60, 0.004, 0.22))
    VH.vp(bm, 'black', 'rear_window_recess')
    P('glass_cab', box, (0, Y(CAB1) + 0.008, 1.86), (0.60, 0.006, 0.22), name='rear_window')
    # doors (front-hinged) with drop windows, handles; mirrors on arms
    for sx in (-1, 1):
        node = 'door_%s' % ('l' if sx < 0 else 'r')
        y0, y1 = Y(CAB0 + 0.14), Y(CAB0 + 1.10)
        piv = (sx * (hw + 0.012), y0, 1.40)
        kw = dict(node=node, pivot=piv)
        P('paint', VH.bevel_box, (sx * (hw + 0.004), (y0 + y1) / 2, 1.30), (0.02, y1 - y0, 0.72), 0.01, 1, name='door_skin', **kw)
        ym, zc, hl = (y0 + y1) / 2, 1.86, (y1 - y0) / 2 - 0.02
        P('glass_cab', box, (sx * (hw + 0.004), ym, zc), (0.008, 2 * hl - 0.04, 0.34), name='door_glass', **kw)
        for a_, b_ in (((ym - hl, zc + 0.19), (ym + hl, zc + 0.19)), ((ym - hl, zc - 0.19), (ym - hl, zc + 0.19)),
                       ((ym + hl, zc - 0.19), (ym + hl, zc + 0.19))):
            P('paint', beam, (sx * (hw + 0.004), a_[0], a_[1]), (sx * (hw + 0.004), b_[0], b_[1]), 0.035, 0.03, name='door_frame', **kw)
        P('black', box, (sx * (hw + 0.022), y1 - 0.10, 1.55), (0.03, 0.14, 0.025), name='handle', **kw)
        VH.moving(node, 'door', piv, (0, 0, 1), limits=(0, 75) if sx < 0 else (-75, 0), hinge='front')
        P('paint_under', beam, (sx * 0.95, Y(CAB0 + 0.1), 1.75), (sx * 1.18, Y(CAB0 - 0.02), 1.95), 0.018, 0.018, name='mirror_arm')
        P('paint_under', VH.bevel_box, (sx * 1.18, Y(CAB0 - 0.02), 1.98), (0.03, 0.16, 0.12), 0.01, 1, name='mirror')
        P('black', box, (sx * (hw + 0.004), Y(CAB0 + 0.13), 1.28), (0.006, 0.012, 0.72), name='seam')
    # interior hint: seat back + steering wheel visible through the glass
    P('seat', VH.bevel_box, (0, Y(CAB1 - 0.25), 1.45), (1.70, 0.12, 0.55), 0.04, 2, name='cab_seat')
    VH.steering_wheel('steering_wheel', (-0.45, Y(CAB0 + 0.55), 1.62), (0, 0.45, 0.89), R=0.23)
    VH.socket('seat_driver', (-0.45, Y(CAB1 - 0.55), 1.30), role='driver')
    VH.socket('seat_codriver', (0.45, Y(CAB1 - 0.55), 1.30), role='passenger')


def wheels():
    for node, x, y in (('wheel_fl', -XF, YF), ('wheel_fr', XF, YF)):
        VH.wheel(node, (x, y, RT), RT, TW, RIM, 1 if x > 0 else -1, lug=0.016)
        VH.VM['moving'][-1]['steer'] = True
        VH.VM['moving'][-1]['steer_limits_deg'] = [-35, 35]
    for sx in (-1, 1):                     # twin rear wheels: one node per side, both tyres
        node = 'wheel_r%s' % ('l' if sx < 0 else 'r')
        VH.wheel(node, (sx * XR_OUT, YR, RT), RT, TW, RIM, sx, lug=0.016)
        nm, nc = len(VH.VM['moving']), len(VH.VM['contacts'])
        VH.wheel(node, (sx * XR_IN, YR, RT), RT, TW, RIM, -sx, lug=0.016)
        del VH.VM['moving'][nm:]
        del VH.VM['contacts'][nc:]
        VH.VM['moving'][-1]['pivot'] = VH.G((sx * (XR_IN + XR_OUT) / 2, YR, RT))
        VH.VM['moving'][-1]['twin'] = True
        VH.VM['contacts'][-1].update(pos=VH.G((sx * (XR_IN + XR_OUT) / 2, YR, 0)), width=round(XR_OUT - XR_IN + TW, 3))
        for o in VH.C.A.parts:
            if o.get('kit_node') == node:
                o['kit_pivot'] = [sx * (XR_IN + XR_OUT) / 2, YR, RT]
        VH.emitter('dust', (sx * 0.8, YR + 0.5, 0.05), (0, 1, 0.4))
        # rear mudguard over the twins
        prof = [(-0.28, -0.03), (-0.27, 0.0), (0.27, 0.0), (0.28, -0.03), (0.28, -0.035), (-0.28, -0.035)]
        bm = bmesh.new()
        VH.sweep_bm(bm, VH.arc_path(YR, RT, 0.57, 160, 20, 10), prof, x0=sx * 0.82, center=(YR, RT))
        VH.vp(bm, 'paint', 'rear_guard', smooth=True)
    VH.emitter('mud', (0, 0, 0.1), (0, 0, 1), note='spray from all wheels on mud/snow')


S_BED0, S_BED1, BED_W, BED_Z = 3.04, 6.02, 2.26, 1.10


def cargo(burnt):
    rnd = VH.C.rng()
    yc, L = Y((S_BED0 + S_BED1) / 2), S_BED1 - S_BED0
    if not burnt:
        P('wood', box, (0, yc, BED_Z - 0.03), (BED_W, L, 0.06), name='bed_floor', uv='beam', axis=(0, 1, 0))
    else:                                                     # floor planks burnt through: charred strips with gaps
        pw = BED_W / 9
        for i in range(9):
            if i in (2, 5, 6):
                continue
            ln = L * rnd.uniform(0.55, 0.95)
            P('wood', box, (-BED_W / 2 + pw * (i + 0.5), yc + rnd.uniform(-0.3, 0.3) * (L - ln), BED_Z - 0.03), (pw - 0.02, ln, 0.04),
              name='bed_plank', uv='beam', axis=(0, 1, 0))
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.45, yc, 0.91), (0.10, L, 0.26), name='sill')
    for s in (3.2, 3.9, 4.6, 5.3, 5.9):
        P('paint_under', box, (0, Y(s), 0.995), (BED_W - 0.04, 0.08, 0.09), name='bearer')
    ph, n = 0.15, 3
    top = BED_Z + ph * n

    def boards(center, size_long, along_y, nn, node='main', pivot=None):
        for i in range(nn):
            ln = size_long
            if burnt:                                         # wooden sides burnt away: a few charred bottom-board stubs
                if i > 0 or rnd.random() < 0.5:
                    continue
                ln = size_long * rnd.uniform(0.25, 0.6)
            z = BED_Z + 0.005 + ph * (i + 0.5)
            sz = (0.035, ln, ph - 0.008) if along_y else (ln, 0.035, ph - 0.008)
            P('wood', box, (center[0], center[1], z), sz, name='board', uv='beam', axis=(0, 1, 0) if along_y else (1, 0, 0),
              node=node, pivot=pivot)
    for sx in (-1, 1):
        boards((sx * (BED_W / 2 - 0.018), yc), L, True, n)
        P('paint_under', box, (sx * (BED_W / 2 - 0.02), yc, top + 0.02), (0.05, L, 0.04), name='side_rail')
        for s in (3.1, 4.05, 5.02, 5.97):
            P('paint_under', box, (sx * (BED_W / 2 + 0.004), Y(s), (BED_Z + top) / 2), (0.03, 0.07, top - BED_Z + 0.08), name='stake')
    boards((0, Y(S_BED0 + 0.018)), BED_W, False, n + 1)
    # tailgate (hinged at the bottom edge) + tactical number, tail lights, towing jaw
    tg, piv = 'tailgate', (0, Y(S_BED1), BED_Z)
    boards((0, Y(S_BED1 - 0.018)), BED_W - 0.08, False, n, node=tg, pivot=piv)
    P('paint_under', box, (0, Y(S_BED1) + 0.002, top - 0.02), (BED_W - 0.08, 0.04, 0.04), name='tg_rail', node=tg, pivot=piv)
    VH.tac_number((0.62, Y(S_BED1) + 0.01, BED_Z + 0.22), (0, 1, 0), 0.34, 0.18, node=tg)
    VH.moving(tg, 'tailgate', piv, (1, 0, 0), limits=(0, 95), note='drops down/back about the bottom hinge')
    # canvas tarp on bows: sagging between bows, lacing at the rear, rolled front
    if burnt:          # rw2: the wooden sides that held the bows burnt away -> the steel bows sag, lean, fall
        base = [(-1.12, top), (-1.12, 2.5), (-0.9, 2.78), (0.9, 2.78), (1.12, 2.5), (1.12, top)]

        def bow_pts(s, sag, splay=0.0):
            pts = []
            for a, b in zip(base[:-1], base[1:]):
                for t in (0.0, 0.34, 0.67):
                    pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            pts.append(base[-1])
            out = []
            for x, z in pts:
                h = max(0.0, (z - top) / (2.78 - top))
                x2 = x * (1 + splay * h)
                z2 = z - sag * h ** 2 * (1 - 0.6 * (x / 1.12) ** 2)
                out.append(V((x2, Y(s), z2)))
            return out

        def draw(pts, T=Matrix.Identity(4)):
            for a, b in zip(pts[:-1], pts[1:]):
                P('metal', cyl, T @ a, T @ b, 0.016, 6, name='bow_bare')
        s0, s3 = S_BED0 + 0.06, S_BED1 - 0.03
        fa = V((1.12, Y(4.05), top))
        draw(bow_pts(s0, 0.10, 0.03), Matrix.Translation(V((-1.12, Y(s0), top))) @ Matrix.Rotation(math.radians(-4), 4, 'Y')
             @ Matrix.Translation(-V((-1.12, Y(s0), top))))                                    # front: still in its pockets
        draw(bow_pts(4.05, 0.22), Matrix.Translation(fa) @ Matrix.Rotation(math.radians(-16), 4, 'Y')
             @ Matrix.Translation(-fa))                                                           # toppled sideways
        fc = V((0, Y(5.02), top))
        draw(bow_pts(5.02, 0.30), Matrix.Translation((0, 0, 1.00 - top)) @ Matrix.Translation(fc)
             @ Matrix.Rotation(math.radians(74), 4, 'X') @ Matrix.Translation(-fc))              # fell forward onto the frame
        draw(bow_pts(s3, 0.42, 0.06))                                                            # rear: ridge kinked down
        r0, r3 = V((0.0, Y(s0), 2.68)), V((0.0, Y(s3), 2.78 - 0.42))
        ridge = [r0.lerp(r3, t) - V((0.0, 0.0, 0.38 * math.sin(math.pi * t) ** 1.5)) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        draw(ridge)                                                                              # bent ridge bar, sagging
        for sx in (-1, 1):                                                                       # charred stake-pocket stubs
            for s_ in (s0, s3):
                P('paint_under', box, (sx * 1.12, Y(s_), top - 0.05), (0.06, 0.06, 0.16), name='stake_pocket')
        return
    st = []
    bows = [S_BED0 + 0.06, 4.05, 5.02, S_BED1 - 0.03]
    for k in range(13):
        s = S_BED0 + 0.03 + (S_BED1 - S_BED0 - 0.05) * k / 12
        d = min(abs(s - b) for b in bows)
        sag = 0.045 * min(1.0, d / 0.45) * (1 + 0.3 * math.sin(k * 1.7))
        st.append((Y(s), 1.135, top - 0.08, 2.84 - sag, 0.30, 0.03 - sag * 0.5))
    bm = bmesh.new()
    VH.body_loft(bm, st, n=4)
    VH.vp(bm, 'canvas', 'tarp', smooth=True)
    for x in (-0.8, -0.4, 0.0, 0.4, 0.8):
        P('leather', box, (x, Y(S_BED1) + 0.012, 2.1), (0.02, 0.01, 0.9), name='lacing')
    P('canvas', cyl, (-1.1, Y(S_BED1) + 0.03, 2.62), (1.1, Y(S_BED1) + 0.03, 2.62), 0.07, 10, name='rolled_flap')
    VH.socket('cargo_bay', (0, Y(4.5), BED_Z + 0.05), role='passenger', capacity=12, note='troop bench area')


def stencil(text, c, side, size, kind='white', name='stencil'):
    """Flat stencilled lettering (Blender text -> mesh) on a vertical panel facing +X (side=1) or -X (side=-1),
    centred at c. Dropped from LOD1+ (unreadable there)."""
    import bpy
    cu = bpy.data.curves.new('txt', type='FONT')
    cu.body = text
    cu.size = size
    cu.resolution_u = 1
    cu.align_x, cu.align_y = 'CENTER', 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    # text is in XY (reads along +X, up +Y) -> onto the YZ plane, reading front-to-back on the right, back-to-front on the left
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        v.co = V((c.x, c.y + (x if side > 0 else -x), c.z + y))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for f in bm.faces:
        if (f.normal.x > 0) != (side > 0):
            f.normal_flip()
    ob = VH.vp(bm, kind, name, grime=0.6, lod='drop', recalc=False)
    ob['kit_text'] = True                    # rw2: veh._mirror_lr re-mirrors text so it never reads backwards


T0, T1, TZ, TW_, TH = 3.12, 5.92, 1.08, 2.02, 1.16          # tank stations, bottom z, width, height


def bulge(co):
    """Burnt tanker: overpressure bulge of the shell around the rupture (in place on a vertex position)."""
    g = math.exp(-((co.y - Y(4.45)) / 1.1) ** 2)
    hz = max(0.0, (co.z - TZ) / TH)
    co.x *= 1.0 + 0.085 * g * (0.4 + hz)
    co.z += 0.07 * g * hz


def tank_ring(s, k=1.0, n=2.6, segs=28):
    return VH.superellipse(0, TZ + TH * (1 - k) / 2, TW_ * k, TH * k, n=n, segs=segs, y=Y(s), flat_bottom=False)


def tanker(burnt):
    # subframe + saddles
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.45, Y(4.5), 0.88), (0.10, 3.0, 0.14), name='subframe')
    for s in (3.35, 4.5, 5.65):
        P('paint_under', box, (0, Y(s), 1.0), (1.6, 0.10, 0.16), name='saddle')
    # shell: dished ends, elliptical section; burnt: ruptured top with petals peeled outward
    rings = [tank_ring(T0 - 0.10, 0.80), tank_ring(T0 - 0.05, 0.95), tank_ring(T0), tank_ring((T0 + T1) / 2), tank_ring(T1),
             tank_ring(T1 + 0.05, 0.95), tank_ring(T1 + 0.10, 0.80)]
    bm = bmesh.new()
    VH.C.loft_bm(bm, rings, True, True)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > 1.0], cuts=5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    hole = None
    if burnt:
        # 3500 l went up: the shell is bulged out by the overpressure, the top is blown open and one flank is split
        hole = (Y(4.40), 0.98, 0.84)
        tear = (Y(3.75), 0.42, TZ + 0.62, 0.26)                  # right flank split (y centre, half length, z centre, half height)
        for v in bm.verts:
            bulge(v.co)
        def dead(c):
            top = c.z > TZ + TH * 0.40 and ((c.y - hole[0]) / hole[1]) ** 2 + (c.x / hole[2]) ** 2 < 1.0
            side = c.x > 0.7 and ((c.y - tear[0]) / tear[1]) ** 2 + ((c.z - tear[2]) / tear[3]) ** 2 < 1.0
            return top or side
        kill = [f for f in bm.faces if dead(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    rim = []
    if burnt:                                                 # rupture rim (boundary verts of the blown-open top)
        bm.normal_update()
        rim = [(v.co.copy(), v.normal.copy()) for v in bm.verts if v.is_boundary and v.co.z > TZ + TH * 0.45]
    VH.vp(bm, 'paint', 'tank_shell', smooth=True, recalc=not burnt)
    if burnt:
        rnd = VH.C.rng()

        def petal_v2(base, nrm, out, w, L, curl, name='petal'):
            """rw2: torn shell plate - starts ON the rupture rim (slightly overlapping it), 4 segments that bend
            progressively outward/down (curl along its length), cupped across, ragged tapering edges, 7 mm thick."""
            nrm, out = nrm.normalized(), out.normalized()
            side_ = nrm.cross(out).normalized()
            segs, p, a0 = 4, base - out * 0.012, 0.85
            left, right = [], []
            for i in range(segs + 1):
                t = i / segs
                ww = w * (1 - 0.5 * t) * rnd.uniform(0.8, 1.15)
                j1, j2 = rnd.uniform(-0.3, 0.3) * w * t, rnd.uniform(-0.3, 0.3) * w * t
                left.append(p - side_ * (ww * 0.5 + j1) + nrm * 0.012 * (1 - t))
                right.append(p + side_ * (ww * 0.5 + j2) + nrm * 0.012 * (1 - t))
                a = a0 + curl * 1.7 * t
                d = (nrm * math.cos(a) + out * math.sin(a)).normalized()
                p = p + d * (L / segs)
            bm2 = bmesh.new()
            vl = [bm2.verts.new(q) for q in left]
            vr_ = [bm2.verts.new(q) for q in right]
            vm = [bm2.verts.new((l_ + r_) / 2 + (nrm * 0.018 if 0 < i < segs else V((0, 0, 0)))) for i, (l_, r_) in enumerate(zip(left, right))]
            for i in range(segs):
                bm2.faces.new((vl[i], vm[i], vm[i + 1], vl[i + 1]))
                bm2.faces.new((vm[i], vr_[i], vr_[i + 1], vm[i + 1]))
            tip = bm2.verts.new(p + side_ * rnd.uniform(-0.3, 0.3) * w * 0.3)
            bm2.faces.new((vl[-1], vm[-1], tip))
            bm2.faces.new((vm[-1], vr_[-1], tip))
            bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces[:])
            bmesh.ops.solidify(bm2, geom=bm2.faces[:], thickness=0.007)
            VH.vp(bm2, 'paint', name, recalc=True, smooth=True)

        cx = V((0.0, hole[0], TZ + TH))
        rim.sort(key=lambda q: math.atan2(q[0].y - cx.y, q[0].x))
        step = max(1, len(rim) // 10)
        for k in range(0, len(rim), step):
            if rnd.random() < 0.15:
                continue                                      # some petals blown off entirely
            co, nr = rim[k]
            out = V((co.x, (co.y - cx.y) * 0.8, 0.0))
            if out.length < 1e-3:
                continue
            petal_v2(co, nr, out, rnd.uniform(0.18, 0.32), rnd.uniform(0.16, 0.34), rnd.uniform(0.5, 1.1))   # peeled back over the shell

        def petal(base, out, up, w, l1, l2, curl):
            side_ = out.cross(up).normalized() * w
            mid = base + out * l1 * 0.55 + up * l1 * 0.75
            tip = mid + out * l2 * (0.8 + curl) + up * l2 * (0.5 - curl)
            bm2 = bmesh.new()
            VH.C.quad(bm2, [base - side_, base + side_, mid + side_ * 0.8, mid - side_ * 0.8])
            VH.C.quad(bm2, [mid - side_ * 0.8, mid + side_ * 0.8, tip + side_ * 0.25, tip - side_ * 0.25])
            VH.vp(bm2, 'paint', 'petal', recalc=False)
        for k in range(7):                                    # flank split: lips bent outward
            a = 2 * math.pi * k / 7
            base = V((1.06, tear[0] + math.cos(a) * tear[1], tear[2] + math.sin(a) * tear[3]))
            radial = V((0, math.cos(a), math.sin(a)))
            petal_v2(base - V((0.02, 0, 0)), V((1, 0, 0)), radial, rnd.uniform(0.06, 0.10), rnd.uniform(0.10, 0.18), 0.5, name='lip')
        P('soot', box, (0, hole[0], TZ + 0.12), (1.8, 2.4, 0.02), name='tank_inside_soot')
    # reinforcing bands, top walkway + rails, manhole domes with hinged lids
    for s in (T0 + 0.7, (T0 + T1) / 2, T1 - 0.7):
        bm = bmesh.new()
        VH.C.loft_bm(bm, [tank_ring(s - 0.03, 1.012), tank_ring(s + 0.03, 1.012)], True, True)
        if burnt:
            for v in bm.verts:
                bulge(v.co)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z > TZ + TH * 0.45 and
                                       abs(f.calc_center_median().y - Y(4.40)) < 0.95], context='FACES')
        VH.vp(bm, 'paint', 'band', recalc=not burnt)
    if not burnt:                                             # walkway, domes and rails went with the blown-out top
        P('metal', box, (0, Y(4.52), TZ + TH + 0.02), (0.36, 2.5, 0.025), name='walkway')
    for k, s in enumerate((3.75, 5.25)):
        c = V((0, Y(s), TZ + TH - 0.02))
        if not burnt:
            P('paint', cyl, c, c + V((0, 0, 0.16)), 0.26, 16, name='dome')
        node = 'hatch_%d' % (k + 1)
        piv = c + V((0, 0.24, 0.17))
        if not burnt:
            P('paint', cyl, c + V((0, 0, 0.16)), c + V((0, 0, 0.19)), 0.24, 16, name=node + '_lid', node=node, pivot=piv)
            P('metal', cyl, c + V((-0.08, 0.0, 0.20)), c + V((0.08, 0.0, 0.20)), 0.015, 6, name=node + '_handle', node=node, pivot=piv)
            VH.moving(node, 'hatch', piv, (1, 0, 0), limits=(0, 110))
        if not burnt:
            VH.emitter('fuel_vapour', c + V((0, 0, 0.2)), (0, 0, 1), when='hit')
    if burnt:                                                 # rw2: ONE fuel fire in the rupture (was two at the vanished domes)
        VH.emitter('fire', (0, Y(4.40), TZ + TH * 0.9), (0, 0, 1), when='always', scale=1.6, note='residual fuel burning in the ruptured tank')
    for sx in (-1, 1):
        for s in ((3.3, 4.1, 4.9, 5.7) if not burnt else ()):
            P('metal', cyl, (sx * 0.30, Y(s), TZ + TH), (sx * 0.30, Y(s), TZ + TH + 0.40), 0.012, 6, name='rail_post')
        if not burnt:
            P('metal', cyl, (sx * 0.30, Y(3.3), TZ + TH + 0.40), (sx * 0.30, Y(5.7), TZ + TH + 0.40), 0.014, 6, name='rail')
        elif sx > 0:                                          # rw2: one bent handrail thrown down, lying on the ground and
            pts = [(1.55, 4.0, 0.015), (1.42, 4.6, 0.02), (1.30, 5.0, 0.03), (1.22, 5.3, 0.16), (1.17, 5.45, 0.34)]   # leaning on the tyre
            for a_, b_ in zip(pts[:-1], pts[1:]):
                P('metal', cyl, (a_[0], Y(a_[1]), a_[2]), (b_[0], Y(b_[1]), b_[2]), 0.014, 6, name='rail_wreck')['kit_ground'] = True
            for s_ in (4.3, 4.85):                                # two posts still on it
                P('metal', cyl, (1.47 if s_ < 4.5 else 1.36, Y(s_), 0.02), (1.47 if s_ < 4.5 else 1.36, Y(s_ - 0.12), 0.36), 0.012, 6,
                  name='rail_post_wreck')['kit_ground'] = True
        # hose tubes (Schlauchrohre) along the lower tank sides, extinguisher, warning plate
        P('paint', cyl, (sx * 1.02, Y(3.3), 1.12), (sx * 1.02, Y(5.8), 1.12), 0.075, 12, name='hose_tube')
        P('paint_under', cyl, (sx * 1.02, Y(5.8), 1.12), (sx * 1.02, Y(5.83), 1.12), 0.08, 12, name='hose_cap')
        P('red', cyl, (sx * 1.03, Y(3.55), 0.93), (sx * 1.03, Y(3.55), 1.03), 0.06, 10, name='extinguisher')
        if not burnt:                                         # stencilled fuel warning (replaces the old flag-like placard)
            stencil('FEUERGEF\u00c4HRLICH', V((sx * 1.016, Y(4.5), TZ + TH * 0.60)), sx, 0.15, name='stencil_warning')
            stencil('Kraftstoff', V((sx * 1.016, Y(4.5), TZ + TH * 0.60 - 0.17)), sx, 0.11, name='stencil_fuel')
    # rear: valve/pump cabinet, outlet valves, ladder, earthing chain, tail lights, number
    P('paint', VH.bevel_box, (0, Y(5.97), 0.88), (1.5, 0.22, 0.40), 0.02, 1, name='valve_cabinet')
    for x in (-0.4, 0.4):
        P('metal', cyl, (x, Y(6.08), 0.80), (x, Y(6.16), 0.80), 0.045, 10, name='outlet_valve')
        VH.emitter('fuel_leak', (x, Y(6.16), 0.80), (0, 1, -0.5), when='hit')
    if not burnt:
        for z in (1.2, 1.5, 1.8, 2.1):
            P('metal', cyl, (-0.75, Y(6.02), z), (-0.45, Y(6.02), z), 0.012, 6, name='ladder_rung')
        for x in (-0.75, -0.45):
            P('metal', cyl, (x, Y(6.02), 1.05), (x, Y(5.97), TZ + TH + 0.1), 0.015, 6, name='ladder_rail')
    else:                                                     # rw2: blast bent the ladder back over the rear, hanging down
        kink = [(1.05, 6.02), (1.55, 6.02), (1.72, 6.20), (1.62, 6.42)]
        for x in (-0.75, -0.45):
            for a_, b_ in zip(kink[:-1], kink[1:]):
                P('metal', cyl, (x, Y(a_[1]), a_[0]), (x + 0.03, Y(b_[1]), b_[0]), 0.015, 6, name='ladder_rail')
        for z, yy in ((1.2, 6.02), (1.5, 6.02), (1.68, 6.30)):
            P('metal', cyl, (-0.75, Y(yy), z), (-0.45, Y(yy), z), 0.012, 6, name='ladder_rung')
    for k in range(6 if not burnt else 4):                     # rw2: wreck chain shorter (sank 6.5 cm into the ground)
        P('metal', VH.ring_torus, (0.6, Y(6.0), 0.62 - k * 0.09), 0.03, 0.008, (1 if k % 2 else 0, 0 if k % 2 else 1, 0), 8, 4, name='earth_chain')
    VH.tac_number((0.35, Y(6.085), 0.92), (0, 1, 0), 0.34, 0.16)
    VH.VM['explosive'] = {'hits_to_explode': 1, 'fuel_l': 3500, 'fireball_radius_m': 9.0, 'burn_s': 45,
                          'note': 'Opel Blitz Kfz 385 Tankkraftwagen - explodes from one shot (gameplay)'}


def main(body, var, out_root):
    name = 'opel_blitz_' + body
    VH.setup(name, var, seed=36 if body == 'cargo' else 385)
    burnt = var == 'burnt'
    chassis()
    front()
    cab(burnt)
    wheels()
    (cargo if body == 'cargo' else tanker)(burnt)
    for sx in (-1, 1):
        VH.taillight('taillight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.85, Y(6.02) + 0.03, 0.93), (0, 1, 0))
    VH.light('convoy_light', (0, Y(6.02) + 0.04, 0.95), (0, 1, 0), True, kind='convoy')
    if burnt:
        VH.rotate_node('door_r', -35, (0, 0, 1))
        VH.emitter('smoke', (0, Y(3.0), 2.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(1.5), 4, 'Y'))
    VH.emitter('fire', (0, Y(1.0), 1.5), (0, 0, 1), when='destroyed', note='engine fire')
    dims = {'length': 6.02, 'width': 2.27, 'height_cab': 2.19, 'height': 2.84 if body == 'cargo' else 2.62, 'wheelbase': 3.60,
            'track_front': 1.65, 'track_rear': 1.63, 'tyre_d': round(2 * RT, 3)}
    VH.vfinalize(os.path.join(out_root, name), 'truck' if body == 'cargo' else 'opel_blitz_tanker', dims,
                 variants=ALL, lods=((0.42, 0.15), (0.21, 0.45)), clamp_half_w=1.195 if burnt else None,
                 extra={'real_name': 'Opel Blitz 3.6-36S ' + ('3 t cargo (Pritsche + Plane)' if body == 'cargo' else 'Tankkraftwagen (Kfz 385)'),
                        'destroyed': burnt, 'rotation_order': 'YXZ'})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for spec in (argv[0] if argv else 'cargo:grey').split(','):
        b, v = spec.split(':')
        for vv in (ALL if v == 'all' else [v]):
            main(b, vv, VH.OUT_ROOT)
