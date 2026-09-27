# Horch 901 Typ 40 "mittlerer Einheits-Pkw" as Kfz 15 staff car (1937-43).
# blender -b --factory-startup --python horch.py -- <variant>[,...]   variants: grey | dak | winter | burnt | grey_top
# Real dims: L 4.80 m, W 1.85 m, H 1.73 m (screen up) / ~1.95 m (top up), wheelbase 3.10 m, track 1.40 m, tyres 6.50-18
# (D ~0.80 m), V8 3.5 l, all-wheel drive; free-turning spare wheels at both sides behind the front wings (belly rollers).
# White blackout markings on the wing edges and bumper ends (period practice).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt', 'grey_top']
YF, YR, XW = -1.45, 1.65, 0.71
RT, RIM, TW = 0.40, 0.235, 0.165
BW, BELT = 0.86, 1.30
Y0, Y1 = -2.40, 2.40
# side spare wheels: centre height / fore-aft / outboard position, and the recess (well) wall they hang from
SP_X, SP_Y, SP_Z, WELL = 0.795, -0.52, 0.80, 0.64


def bonnet_front(burnt):
    bm = bmesh.new()
    VH.body_loft(bm, [(-2.19, 0.40, 0.86, 1.46, 0.14), (-1.60, 0.44, 0.86, 1.48, 0.13), (-0.95, 0.47, 0.86, 1.50, 0.12)], n=3)
    VH.vp(bm, 'paint', 'bonnet', smooth=False)
    P('paint_under', beam, (0, -2.19, 1.49), (0, -0.95, 1.515), 0.02, 0.012, name='bonnet_hinge')
    for sx in (-1, 1):                                  # side louvres
        for i in range(9):
            y = -1.70 + i * 0.075
            P('paint', beam, (sx * 0.452, y, 1.08), (sx * 0.452, y + 0.02, 1.32), 0.012, 0.02, name='louvre')
        P('black', box, (sx * 0.45, -1.2, 1.36), (0.02, 0.10, 0.02), name='bonnet_catch')
    # radiator shell + vertical slats + badge, crank hole
    # tall radiator shell with a rounded (arched) top, slightly proud of the bonnet line
    bm = bmesh.new()
    VH.body_loft(bm, [(-2.27, 0.30, 0.72, 1.53, 0.21), (-2.25, 0.315, 0.72, 1.545, 0.22), (-2.18, 0.315, 0.72, 1.545, 0.22)], n=4)
    VH.vp(bm, 'paint', 'grille_shell', smooth=True)
    bm = bmesh.new()
    VH.body_loft(bm, [(-2.285, 0.245, 0.78, 1.47, 0.16), (-2.27, 0.245, 0.78, 1.47, 0.16)], n=4)
    VH.vp(bm, 'black', 'grille_core')
    for i in range(15):
        x = -0.224 + i * 0.032
        ax_ = abs(x)
        zt = 1.46 if ax_ <= 0.085 else 1.47 - 0.16 + math.sqrt(max(0.0, 0.16 ** 2 - (ax_ - 0.085) ** 2)) - 0.01
        P('paint', box, (x, -2.287, (0.80 + zt) / 2), (0.008, 0.012, zt - 0.80), name='slat')
    P('chrome' if VH.paint_base() == 'black' else 'paint', cyl, (0, -2.26, 0.90), (0, -2.275, 0.90), 0.025, 10, name='badge')
    # front apron + bumper with white blackout ends, tow shackles, number plate
    P('paint_under', box, (0, -2.12, 0.72), (0.90, 0.12, 0.22), name='apron')
    P('paint', VH.bevel_box, (0, -2.36, 0.62), (1.70, 0.08, 0.14), 0.02, 1, name='bumper')
    if not burnt:
        for sx in (-1, 1):
            P('white', box, (sx * 0.76, -2.402, 0.62), (0.18, 0.006, 0.13), name='bumper_white', lod='drop2')
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.50, -2.26, 0.62), (0.06, 0.16, 0.08), name='bumper_arm')
        P('metal', VH.ring_torus, (sx * 0.30, -2.41, 0.62), 0.035, 0.01, (1, 0, 0), 10, 4, name='shackle')
    VH.tac_number((0.45, -2.405, 0.78), (0, -1, 0), 0.40, 0.15)
    # cowl / scuttle between bonnet and windscreen
    bm = bmesh.new()
    VH.body_loft(bm, [(-0.96, 0.84, 1.20, 1.30, 0.05), (-0.62, 0.86, 1.20, 1.32, 0.05)], n=2)
    VH.vp(bm, 'paint', 'scuttle')
    P('paint_under', box, (0, -0.79, 0.91), (2 * WELL - 0.04, 0.34, 0.58), name='toe_board')   # footwell between the wells


# rw2: thin pressed sheet (~1.2 cm) with a short turned edge and a narrow beaded lip (was a 10 cm deep rolled skirt that
# read as rubber tubing at close zoom)
FPROF = [(0.0, 0.0), (0.08, 0.03), (0.18, 0.05), (0.29, 0.052), (0.37, 0.036), (0.43, 0.012), (0.456, -0.012), (0.461, -0.03),
         (0.467, -0.035), (0.466, -0.045), (0.456, -0.045), (0.451, -0.02), (0.424, 0.0), (0.365, 0.024), (0.29, 0.04), (0.18, 0.038),
         (0.08, 0.018), (0.0, -0.012)]
# deep-crowned front wing: an ellipse around the front wheel that keeps curving DOWN ahead of the tyre (no flat end plate)
WPATH = [(YF + 0.64 * math.cos(math.radians(a)), RT + 0.52 * math.sin(math.radians(a))) for a in
         [192, 180, 168, 156, 144, 132, 120, 106, 92, 78, 64, 50, 38, 27]] + [(-0.92, 0.66), (-0.84, 0.62)]


def wings(burnt):
    path = WPATH
    for sx in (-1, 1):
        bm = bmesh.new()
        VH.sweep_bm(bm, path, FPROF, x0=sx * 0.46, mirror=sx < 0)
        VH.vp(bm, 'paint', 'front_wing', grime=1.0, smooth=True)
        if not burnt:                                         # white blackout edge on the wing tip
            bm = bmesh.new()
            VH.sweep_bm(bm, path[1:5], [(0.431, 0.016), (0.459, -0.009), (0.465, -0.03), (0.471, -0.034), (0.469, -0.042), (0.461, -0.036), (0.455, -0.014), (0.428, 0.01)], x0=sx * 0.46, mirror=sx < 0)
            VH.vp(bm, 'white', 'wing_white', lod='drop2')
        # inner splash valance between wing and bonnet
        P('paint_under', box, (sx * 0.50, -1.45, 0.98), (0.02, 1.0, 0.24), name='valance')
        # rear wings
        bm = bmesh.new()
        VH.sweep_bm(bm, VH.arc_path(YR, RT, 0.53, 168, 12, 14), [(a * 0.68, b) for a, b in FPROF], x0=sx * 0.615,
                    mirror=sx < 0, center=(YR, RT))
        VH.vp(bm, 'paint', 'rear_wing', grime=1.0, smooth=True)
        # free-turning side spare wheel (belly roller) hung in a recess in the body side between the front wing and the
        # front door, on a stub axle from the recess wall. USER CORRECTION (do not revert): the Horch 901 has FOUR road
        # wheels; the spares hang clearly ABOVE the ground (bottom SP_Z-RT = 0.40 m, road-wheel hubs at 0.40 m) and
        # only touch when bellying over an obstacle. No contact point / no 'wheel' moving part for them.
        node = 'spare_%s' % ('l' if sx < 0 else 'r')
        sp = (sx * SP_X, SP_Y, SP_Z)
        VH.wheel(node, sp, RT, TW, RIM, sx, spare=True, lug=0.016, segs=39)
        VH.moving(node, 'wheel_free', sp, (1, 0, 0), note='free-turning spare on a stub axle, 0.40 m above ground: rolls only when bellying')
        P('paint_under', cyl, (sx * (WELL + 0.01), sp[1], sp[2]), sp, 0.045, 8, name='spare_stub')
        P('paint_under', cyl, (sx * (WELL + 0.01), sp[1], sp[2]), (sx * (WELL + 0.03), sp[1], sp[2]), 0.12, 10, name='spare_hub_plate')
        # headlights on the wings beside the bonnet, horn
        P('paint', cyl, (sx * 0.64, -2.02, 0.69), (sx * 0.64, -2.02, 1.02), 0.022, 8, name='hl_post')
        VH.headlight('headlight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.64, -2.10, 1.12), 0.11, 0.16, cover=True)
        VH.taillight('taillight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.70, 2.40, 0.98), (0, 1, 0))
    VH.notek('notek', (-0.74, -2.26, 0.74))
    VH.light('convoy_light', (0, 2.41, 0.90), (0, 1, 0), True, kind='convoy')
    P('black', cyl, (0.40, -2.20, 0.90), (0.40, -2.28, 0.90), 0.05, 10, name='horn')


def body(burnt, top):
    for sx in (-1, 1):
        xo, xi = sx * (BW + 0.012), sx * (BW - 0.01)
        bm = bmesh.new()
        VH.side_prism(bm, [(-0.96, 1.22), (-0.12, 1.22), (-0.12, BELT), (-0.96, BELT)], xi, xo)
        VH.vp(bm, 'paint', 'side_front')                   # lip over the spare-wheel recess
        bm = bmesh.new()                                    # recess (well) wall the spare stub axle hangs from
        VH.side_prism(bm, [(-0.96, 0.62), (-0.12, 0.62), (-0.12, 1.24), (-0.96, 1.24)], sx * (WELL - 0.02), sx * WELL)
        VH.vp(bm, 'paint', 'spare_well')
        P('paint', box, (sx * (WELL + BW) / 2, -0.54, 1.225), (BW - WELL + 0.01, 0.84, 0.02), name='spare_well_top')
        P('paint', box, (sx * (WELL + BW) / 2, -0.125, 0.92), (BW - WELL + 0.01, 0.02, 0.60), name='spare_well_back')
        rear = [(1.10, 0.62), (1.14, 0.62)] + VH.arc_path(YR, RT, 0.52, 168, 12, 12)[1:-1] + [(2.16, 0.62), (2.40, 0.72),
                (2.40, 1.20), (2.32, BELT), (1.10, BELT)]
        bm = bmesh.new()
        VH.side_prism(bm, rear, xi, xo)
        VH.vp(bm, 'paint', 'side_rear')
        P('paint', box, (sx * BW, 0.42, 0.95), (0.03, 0.04, 0.66), name='bpillar')
        P('paint', cyl, (sx * (BW + 0.02), -0.96, BELT), (sx * (BW + 0.02), 2.36, BELT), 0.018, 6, name='belt_rail')
        for nm, y0, y1 in (('door_f', -0.11, 0.40), ('door_r', 0.44, 1.09)):
            node = nm + ('l' if sx < 0 else 'r')
            piv = (sx * (BW + 0.02), y0, 0.95)
            bm = bmesh.new()
            VH.bevel_box(bm, (sx * BW, (y0 + y1) / 2, 0.955), (0.028, y1 - y0 - 0.01, 0.64), 0.01, 1)
            VH.vp(bm, 'paint', node + '_panel', node=node, pivot=piv)
            P('paint', beam, (sx * (BW + 0.016), y0 + 0.05, 0.80), (sx * (BW + 0.016), y1 - 0.05, 0.80), 0.01, 0.025, name='swage', node=node, pivot=piv)
            P('chrome' if VH.paint_base() == 'black' else 'black', box, (sx * (BW + 0.022), y1 - 0.10, 1.18), (0.02, 0.09, 0.02),
              name='handle', node=node, pivot=piv)
            P('paint_under', box, (sx * (BW - 0.018), (y0 + y1) / 2, 0.95), (0.006, y1 - y0 - 0.06, 0.58), name='door_card', node=node, pivot=piv)
            for z in (0.75, 1.15):                                          # exposed door hinges on the front edge
                P('paint_under', cyl, (sx * (BW + 0.03), y0 - 0.005, z - 0.05), (sx * (BW + 0.03), y0 - 0.005, z + 0.05), 0.013, 6, name='hinge')
                P('paint_under', box, (sx * (BW + 0.022), y0 + 0.04, z), (0.006, 0.08, 0.05), name='hinge_leaf', node=node, pivot=piv)
            VH.moving(node, 'door', piv, (0, 0, 1), limits=(0, 75) if sx < 0 else (-75, 0), hinge='front')
        P('paint', box, (sx * (BW + 0.02), 0.52, 0.60), (0.12, 1.20, 0.03), name='step')      # short step: ends behind the spare
        for k in range(4):                                                  # ribbed rubber tread strips
            P('rubber', box, (sx * (BW - 0.02 + k * 0.028), 0.52, 0.618), (0.012, 1.12, 0.008), name='step_rib', lod='drop')
        for z in (0.80, 1.10):                                              # pressed beading on the rear body flank
            P('paint', beam, (sx * (BW + 0.014), 1.14, z), (sx * (BW + 0.014), 2.34, z), 0.012, 0.02, name='beading')
    # floor, tunnel, rear body (deck over the rear axle) - wide top, narrow between the wheels
    P('paint_under', box, (0, 0.60, 0.62), (1.70, 1.42, 0.04), name='floor')
    P('paint_under', box, (0, -0.37, 0.62), (2 * WELL - 0.04, 0.54, 0.04), name='floor_front')   # between the spare wells
    P('paint_under', box, (0, 0.10, 0.70), (0.26, 1.50, 0.14), name='tunnel')
    bm = bmesh.new()
    VH.body_loft(bm, [(1.30, BW, 0.95, BELT, 0.03), (2.22, BW, 0.95, BELT, 0.06), (2.40, BW - 0.03, 0.95, 1.22, 0.10)], n=2)
    VH.vp(bm, 'paint', 'rear_deck')
    bm = bmesh.new()
    VH.body_loft(bm, [(1.30, 0.60, 0.62, 0.96, 0.02), (2.38, 0.60, 0.70, 0.96, 0.03)], n=1)
    VH.vp(bm, 'paint_under', 'rear_low')
    P('paint', box, (0, 1.30, 0.97), (1.70, 0.03, 0.66), name='rear_bulkhead')
    P('black', box, (0, 2.405, 0.86), (0.50, 0.01, 0.20), name='rear_panel_seam')
    VH.tac_number((-0.45, 2.41, 0.88), (0, 1, 0), 0.34, 0.20)
    # dashboard, steering, seats
    P('paint', box, (0, -0.64, 1.20), (2 * WELL - 0.02, 0.10, 0.14), name='dash')
    for x in (-0.50, -0.34, -0.18, 0.2):
        P('black', cyl, (x, -0.59, 1.20), (x, -0.585, 1.20), 0.035, 10, name='gauge')
    VH.steering_wheel('steering_wheel', (-0.42, -0.36, 1.22), (0, 0.6, 0.8), R=0.21)
    P('black', cyl, (-0.42, -0.62, 0.95), (-0.42, -0.36, 1.22), 0.022, 6, name='column')
    for x in (-0.40, 0.40):
        P('paint_under', box, (x, -0.02, 0.73), (0.44, 0.46, 0.18), name='seat_base')
        P('leather', VH.bevel_box, (x, -0.04, 0.86), (0.46, 0.50, 0.10), 0.04, 2, name='seat')          # burnt: springs
        P('leather', VH.bevel_box, (x, 0.24, 1.12), (0.46, 0.09, 0.50), 0.04, 2, name='seat_back')
    P('paint_under', box, (0, 0.95, 0.74), (1.60, 0.42, 0.20), name='bench_base')
    P('leather', VH.bevel_box, (0, 0.93, 0.88), (1.60, 0.46, 0.10), 0.04, 2, name='bench')
    P('leather', VH.bevel_box, (0, 1.25, 1.10), (1.60, 0.08, 0.40), 0.04, 2, name='bench_back')
    fittings(burnt)
    for nm, x, y in (('seat_driver', -0.42, -0.04), ('seat_codriver', 0.42, -0.04), ('seat_rear_l', -0.50, 0.93),
                     ('seat_rear_c', 0.0, 0.93), ('seat_rear_r', 0.50, 0.93)):
        VH.socket(nm, (x, y, 0.92), role='driver' if nm == 'seat_driver' else 'passenger')


def fittings(burnt):
    """Field kit: pioneer tools (shovel + axe) clamped on the right rear flank, a jerrycan in its bracket on the left
    rear flank, two Kar 98k in a rack on the backs of the front seats. Burnt: wooden handles + rifles gone."""
    x = BW + 0.03
    P('paint', box, (x + 0.004, 1.32, 0.99), (0.008, 0.24, 0.19), name='shovel_blade')
    if not burnt:
        P('wood', cyl, (x + 0.02, 1.44, 0.99), (x + 0.02, 2.18, 0.99), 0.017, 6, name='shovel_handle')
        P('wood', cyl, (x + 0.02, 1.52, 0.88), (x + 0.02, 2.10, 0.88), 0.016, 6, name='axe_handle')
    P('metal', box, (x + 0.018, 1.48, 0.89), (0.02, 0.07, 0.15), name='axe_head')
    for y in (1.65, 2.0):
        P('black', box, (x + 0.02, y, 0.94), (0.03, 0.03, 0.18), name='tool_clamp')
    # jerrycan (Wehrmacht-Einheitskanister 20 l) in a strap bracket on the left rear flank
    jx = -0.862                             # rw2: tucked in against the flank (outer face 0.955 m -> overall width ~1.91 m)
    P('paint', VH.bevel_box, (jx, 1.80, 0.96), (0.165, 0.345, 0.47), 0.02, 1, name='jerrycan')
    for d in (-1, 1):
        P('paint', beam, (jx - 0.084, 1.80 - 0.14, 0.96 - d * 0.19), (jx - 0.084, 1.80 + 0.14, 0.96 + d * 0.19), 0.02, 0.008, name='jerry_x')
    for y in (1.66, 1.94):
        P('paint_under', cyl, (jx, y, 1.19), (jx, y, 1.23), 0.012, 6, name='jerry_handle')
    P('paint_under', box, (jx, 1.80, 0.72), (0.18, 0.37, 0.02), name='jerry_bracket')
    P('black', box, (jx - 0.086, 1.80, 1.02), (0.006, 0.37, 0.04), name='jerry_strap')
    if not burnt:
        for sx in (-1, 1):
            rx = sx * 0.42 + 0.12
            P('wood', box, (rx, 0.31, 0.86), (0.05, 0.035, 0.30), name='k98_stock')
            P('gunmetal', cyl, (rx, 0.31, 1.01), (rx, 0.32, 1.62), 0.012, 6, name='k98_barrel')
            P('wood', box, (rx, 0.312, 1.22), (0.035, 0.03, 0.36), name='k98_handguard')
            P('black', box, (rx, 0.30, 1.30), (0.10, 0.03, 0.03), name='rifle_clip')


def screen_top(burnt, top):
    ws, piv = 'windscreen', (0, -0.63, 1.33)
    kw = dict(node=ws, pivot=piv)
    fr = [(-0.82, -0.63, 1.33), (-0.82, -0.60, 1.76), (0.82, -0.60, 1.76), (0.82, -0.63, 1.33)]
    for a, b in zip(fr[:-1], fr[1:]):
        P('paint', beam, a, b, 0.035, 0.03, name='ws_frame', **kw)
    P('paint', beam, fr[0], fr[3], 0.035, 0.025, name='ws_frame', **kw)
    P('paint', beam, (0, -0.63, 1.33), (0, -0.60, 1.76), 0.03, 0.025, name='ws_post', **kw)
    if not burnt:
        for sx in (-1, 1):
            P('glass', box, (sx * 0.41, -0.615, 1.545), (0.76, 0.006, 0.40), name='ws_glass', **kw)
    for sx in (-1, 1):
        P('black', beam, (sx * 0.55, -0.64, 1.73), (sx * 0.30, -0.645, 1.58), 0.012, 0.006, name='wiper', **kw)
    VH.moving(ws, 'toggle', piv, (1, 0, 0), limits=(-85, 0), note='windscreen folds forward onto the bonnet')
    P('paint', beam, (-0.86, -0.66, 1.34), (-0.89, -0.72, 1.46), 0.015, 0.015, name='mirror_arm')
    P('chrome', cyl, (-0.89, -0.72, 1.48), (-0.89, -0.70, 1.48), 0.05, 12, name='mirror')
    if burnt:
        for y in (1.75, 1.85):
            P('metal', VH.ring_torus, (0, y, BELT), 0.82, 0.012, (0, 1, 0), 18, 4, name='bow_wreck')
    elif not top:
        bm = bmesh.new()
        VH.body_loft(bm, [(1.62, 0.80, BELT - 0.01, 1.44, 0.08), (1.70, 0.84, BELT - 0.01, 1.52, 0.10), (2.02, 0.84, BELT - 0.01, 1.52, 0.10),
                          (2.14, 0.80, BELT - 0.01, 1.40, 0.08)], n=3)
        VH.vp(bm, 'canvas', 'top_folded', smooth=True)
        for x in (-0.6, 0.0, 0.6):
            P('leather', beam, (x, 1.64, 1.53), (x, 2.12, 1.43), 0.05, 0.01, name='strap')
    else:
        bm = bmesh.new()
        VH.body_loft(bm, [(-0.61, 0.81, 1.70, 1.78, 0.04), (-0.45, 0.84, 1.78, 1.92, 0.12, 0.015), (0.40, 0.86, 1.80, 1.95, 0.14, 0.02),
                          (1.30, 0.86, 1.78, 1.94, 0.14, 0.02), (1.90, 0.86, 1.30, 1.86, 0.18, 0.01), (2.22, 0.84, BELT, 1.60, 0.22),
                          (2.34, 0.82, BELT, 1.34, 0.10)], n=3)
        VH.vp(bm, 'canvas', 'top_up', smooth=True)
        for sx in (-1, 1):
            P('glass', box, (sx * 0.865, 1.62, 1.58), (0.006, 0.40, 0.18), name='quarter_window')
            for y0, y1 in ((-0.28, 0.40), (0.44, 1.08)):                       # celluloid side curtains
                P('glass', box, (sx * 0.87, (y0 + y1) / 2, 1.55), (0.006, y1 - y0 - 0.04, 0.34), name='side_curtain')
                P('canvas', box, (sx * 0.872, (y0 + y1) / 2, 1.55), (0.004, y1 - y0, 0.40), name='curtain_frame', lod='drop')
        P('glass', box, (0, 2.20, 1.48), (0.60, 0.006, 0.14), name='rear_window')


def running(burnt):
    for node, x, y in (('wheel_fl', -XW, YF), ('wheel_fr', XW, YF), ('wheel_rl', -XW, YR), ('wheel_rr', XW, YR)):
        VH.wheel(node, (x, y, RT), RT, TW, RIM, 1 if x > 0 else -1, lug=0.018)
        if y < 0:
            VH.VM['moving'][-1]['steer'] = True
            VH.VM['moving'][-1]['steer_limits_deg'] = [-30, 30]
        else:
            VH.emitter('dust', (x, y + 0.45, 0.05), (0, 1, 0.4))
    # ladder chassis, independent suspension (double wishbones), coil springs, diffs, exhaust
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.42, 0.0, 0.52), (0.08, 4.2, 0.16), name='rail')
        for y in (YF, YR):
            P('paint_under', beam, (sx * 0.40, y - 0.12, 0.45), (sx * 0.60, y, RT), 0.05, 0.04, name='wishbone')
            P('paint_under', beam, (sx * 0.40, y + 0.12, 0.62), (sx * 0.58, y, RT + 0.18), 0.04, 0.03, name='wishbone')
            P('metal', cyl, (sx * 0.50, y + 0.05, 0.50), (sx * 0.50, y + 0.05, 0.78), 0.055, 8, name='coil')
    for y in (YF, YR):
        P('metal', VH.bevel_box, (0, y, 0.42), (0.30, 0.28, 0.26), 0.05, 2, name='diff')
        P('metal', cyl, (-0.58, y, RT), (0.58, y, RT), 0.03, 8, name='halfshaft')
    P('metal', cyl, (0, -0.8, 0.40), (0, YR - 0.15, 0.40), 0.04, 8, name='propshaft')
    P('metal', cyl, (0.30, -1.0, 0.42), (0.30, 2.30, 0.42), 0.035, 8, name='exhaust')
    P('metal', cyl, (0.30, 0.8, 0.42), (0.30, 1.4, 0.42), 0.08, 10, name='silencer')
    VH.emitter('exhaust', (0.30, 2.42, 0.42), (0, 1, -0.05))
    P('black', box, (0.60, 1.9, 0.62), (0.26, 0.40, 0.30), name='fuel_tank')


def main(var, out_root):
    VH.setup('horch901', var, seed=901)
    burnt, top = var == 'burnt', var.endswith('_top')
    bonnet_front(burnt)
    wings(burnt)
    body(burnt, top)
    screen_top(burnt, top)
    running(burnt)
    if burnt:
        VH.rotate_node('door_rl', -42, (0, 0, 1))
        VH.emitter('smoke', (0, 0.3, 1.3), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(-1.5), 4, 'Y')
                   @ Matrix.Rotation(math.radians(1.0), 4, 'X'))
    VH.emitter('fire', (0, -1.5, 1.3), (0, 0, 1), when='destroyed', note='engine bay fire')
    dims = {'length': 4.80, 'width': 1.85, 'height_screen_up': 1.76, 'height_top_up': 1.95, 'wheelbase': 3.10, 'track': 1.42,
            'tyre_d': round(2 * RT, 3), 'width_over_kit': 1.91, 'note': 'body/wings 1.85-1.87 m; jerrycan + mirror 1.91 m'}
    VH.vfinalize(os.path.join(out_root, 'horch901'), 'horch', dims, variants=ALL, clamp_half_w=0.935,
                 extra={'real_name': 'Horch 901 Typ 40 (Kfz 15)', 'destroyed': burnt, 'rotation_order': 'YXZ',
                        'top': 'up' if top else ('none' if burnt else 'folded')})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, VH.OUT_ROOT)
