# BMW R75 with BW 43 sidecar (1941-44) + MG34 on the sidecar pintle.
# blender -b --factory-startup --python r75.py -- <variant>[,...]   variants: grey | dak | winter | burnt
# Real dims (combination): L 2.40 m, W 1.73 m, H 1.00 m (bars), wheelbase 1.444 m, sidecar track ~1.13 m,
# tyres 4.50-16 on interchangeable wire wheels (spare on the sidecar tail), 745 cc OHV flat twin, sidecar wheel driven
# (coaxial with the rear wheel). Tropical air filter on the tank, telescopic fork, high exhaust on the left.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt']
XB = -0.40                               # bike centreline
XS = XB + 1.13                           # sidecar wheel centre x
YF, YR = -0.80, 0.644                    # axles (wheelbase 1.444)
RT, RIM, TW = 0.32, 0.203, 0.115
HEAD = V((XB, -0.50, 0.98))              # steering head (top), raked axis through the front axle
RAKE = math.atan2(HEAD.y - YF, HEAD.z - RT)


def finned_cyl(p0, p1, r, fins, fin_r, name):
    """Air-cooled cylinder barrel with cooling fins (rings)."""
    p0, p1 = V(p0), V(p1)
    P('metal', cyl, p0, p1, r, 12, name=name)
    for k in range(fins):
        t = (k + 0.5) / fins
        c = p0.lerp(p1, t)
        d = (p1 - p0).normalized() * 0.006
        P('metal', cyl, c - d, c + d, fin_r, 12, name=name + '_fin')


def guard_prof(hw, crown, depth, t=0.004, n=5):
    """Thin pressed-steel mudguard section: rounded crown + deep valances, sheet thickness t (dx across, dn radial)."""
    out = [(-hw, -depth)]
    for i in range(n + 1):
        a = math.pi * i / n
        out.append((-hw * math.cos(a), crown * math.sin(a)))
    out.append((hw, -depth))
    hi = hw - t
    inner = [(hi, -depth)] + [(hi * math.cos(math.pi * i / n), (crown - t) * math.sin(math.pi * i / n)) for i in range(n + 1)] + [(-hi, -depth)]
    return out + inner


def engine_frame():
    x = XB
    # duplex cradle frame: top tube, down tubes, lower rails, seat stays (painted tube)
    tubes = [((x, HEAD.y, HEAD.z - 0.02), (x, 0.10, 0.80)), ((x, 0.10, 0.80), (x, YR, 0.62)), ((x, 0.10, 0.80), (x, 0.12, 0.30)),
             ((x, 0.12, 0.30), (x, YR, 0.36))]
    for sx in (-1, 1):
        tubes += [((x, HEAD.y + 0.02, HEAD.z - 0.12), (x + sx * 0.10, -0.40, 0.30)), ((x + sx * 0.10, -0.40, 0.30), (x + sx * 0.10, 0.14, 0.24)),
                  ((x + sx * 0.10, 0.14, 0.24), (x + sx * 0.08, YR, RT)), ((x + sx * 0.08, 0.30, 0.74), (x + sx * 0.08, YR, RT))]
    for a, b in tubes:
        P('paint', cyl, a, b, 0.017, 8, name='frame')
    # boxer twin: crankcase, finned barrels, heads + rocker covers, carburettors, gearbox, final drive shaft housing
    P('metal', VH.bevel_box, (x, -0.28, 0.36), (0.26, 0.36, 0.26), 0.05, 2, name='crankcase')
    # the R75's signature: two horizontally opposed finned cylinders + alloy heads/rocker covers sticking out ~0.3 m
    # either side of the frame, just ahead of the rider's footboards
    for sx in (-1, 1):
        finned_cyl((x + sx * 0.11, -0.33, 0.42), (x + sx * 0.29, -0.35, 0.44), 0.058, 8, 0.088, 'barrel')
        P('alu', VH.bevel_box, (x + sx * 0.33, -0.35, 0.44), (0.08, 0.21, 0.20), 0.035, 2, name='head')
        for dz in (-0.06, 0.0, 0.06):
            P('alu', box, (x + sx * 0.33, -0.35, 0.44 + dz), (0.086, 0.23, 0.008), name='head_fin')
        P('alu', VH.bevel_box, (x + sx * 0.395, -0.35, 0.44), (0.05, 0.165, 0.155), 0.02, 2, name='rocker_cover')
        P('black', cyl, (x + sx * 0.33, -0.46, 0.46), (x + sx * 0.33, -0.49, 0.47), 0.012, 6, name='spark_plug')
        P('metal', cyl, (x + sx * 0.14, -0.20, 0.47), (x + sx * 0.22, -0.20, 0.47), 0.03, 8, name='carb')
        P('metal', cyl, (x + sx * 0.14, -0.20, 0.47), (x + sx * 0.06, -0.12, 0.62), 0.016, 6, name='intake')
    P('metal', VH.bevel_box, (x, 0.02, 0.38), (0.20, 0.24, 0.22), 0.04, 2, name='gearbox')
    P('metal', cyl, (x + 0.07, 0.10, 0.36), (x + 0.07, YR, RT), 0.035, 8, name='driveshaft')
    P('metal', VH.bevel_box, (x + 0.07, YR, RT), (0.10, 0.18, 0.18), 0.05, 2, name='final_drive')
    # sidecar drive: shaft from the final drive to the sidecar wheel hub (the R75 sidecar wheel is driven, lockable diff)
    P('metal', cyl, (x + 0.12, YR, RT), (XS - 0.08, YR, RT), 0.022, 8, name='sc_driveshaft')
    # exhaust: headers sweep up and back to one high silencer on the left, fishtail outlet
    for sx in (-1, 1):
        a = V((x + sx * 0.34, -0.46, 0.40))
        b = V((x + sx * 0.30, -0.10, 0.26)) if sx > 0 else V((x - 0.26, -0.10, 0.30))
        P('metal', cyl, a, b, 0.021, 8, name='header')
    P('metal', cyl, (x + 0.30, -0.10, 0.26), (x - 0.22, 0.02, 0.32), 0.021, 8, name='crossover')
    P('metal', cyl, (x - 0.26, -0.10, 0.30), (x - 0.23, 0.40, 0.46), 0.021, 8, name='header_up')
    P('metal', cyl, (x - 0.23, 0.36, 0.45), (x - 0.23, 0.92, 0.52), 0.048, 10, name='silencer')
    VH.emitter('exhaust', (x - 0.23, 0.94, 0.52), (0, 1, 0.05))
    # fuel tank with the knee pads, tropical air filter canister on top, tool box lid
    bm = bmesh.new()
    VH.body_loft(bm, [(-0.52, 0.09, 0.80, 0.90, 0.05), (-0.46, 0.14, 0.72, 0.95, 0.09), (-0.20, 0.155, 0.70, 0.96, 0.10),
                      (0.02, 0.13, 0.72, 0.92, 0.08), (0.08, 0.08, 0.76, 0.86, 0.04)], n=3, rb=0.04)
    VH.xf_bm(bm, Matrix.Translation((x, 0, 0)))
    VH.vp(bm, 'paint', 'tank', smooth=True)
    for sx in (-1, 1):
        P('black', VH.bevel_box, (x + sx * 0.155, -0.12, 0.82), (0.02, 0.16, 0.10), 0.02, 1, name='kneepad')
    P('paint', cyl, (x, -0.24, 0.955), (x, -0.24, 1.06), 0.075, 14, name='air_filter')
    P('paint', cyl, (x, -0.24, 1.06), (x, -0.24, 1.075), 0.082, 14, name='air_filter_lid')
    P('chrome', cyl, (x + 0.06, -0.44, 0.93), (x + 0.06, -0.44, 0.95), 0.03, 10, name='filler_cap')
    # footboards (rider) + pillion footrests, crash bars
    for sx in (-1, 1):
        P('black', box, (x + sx * 0.26, -0.10, 0.25), (0.14, 0.30, 0.02), name='footboard')
        P('black', cyl, (x + sx * 0.12, 0.40, 0.33), (x + sx * 0.22, 0.40, 0.33), 0.015, 6, name='pillion_peg')
        cb = [(x + sx * 0.10, -0.60, 0.72), (x + sx * 0.40, -0.56, 0.52), (x + sx * 0.48, -0.50, 0.40), (x + sx * 0.46, -0.44, 0.30),
              (x + sx * 0.12, -0.40, 0.25)]
        for a, b in zip(cb[:-1], cb[1:]):
            P('paint', cyl, a, b, 0.016, 8, name='crash_bar')


def fork_front():
    """Steering assembly (node 'fork', raked head axis): telescopic legs, bars, headlight, front mudguard, Notek."""
    x, n = XB, 'fork'
    ax = V((0, math.sin(RAKE), math.cos(RAKE)))
    piv = HEAD
    kw = dict(node=n, pivot=piv)
    for sx in (-1, 1):
        a = V((x + sx * 0.085, YF, RT))
        b = a + ax * 0.62
        P('metal', cyl, a, a + ax * 0.30, 0.024, 8, name='slider', **kw)
        P('paint', cyl, a + ax * 0.28, b, 0.03, 8, name='fork_leg', **kw)
    top = V((x, YF, RT)) + ax * 0.62
    P('paint', box, top, (0.22, 0.07, 0.04), name='crown', **kw)
    P('paint', box, top - ax * 0.12, (0.22, 0.07, 0.035), name='crown_low', **kw)
    # handlebars: wide swept bars with rubber grips, levers, mirror-less (military)
    hb = top + V((0, 0.10, 0.10))
    bars = [(hb + V((-0.40, 0.10, 0.02)), hb + V((-0.20, 0.02, 0.0))), (hb + V((-0.20, 0.02, 0.0)), hb + V((0.20, 0.02, 0.0))),
            (hb + V((0.20, 0.02, 0.0)), hb + V((0.40, 0.10, 0.02)))]
    for a, b in bars:
        P('chrome' if VH.paint_base() == 'black' else 'paint', cyl, a, b, 0.012, 6, name='bar', **kw)
    for sx in (-1, 1):
        g = hb + V((sx * 0.40, 0.10, 0.02))
        P('rubber', cyl, g - V((sx * 0.12, 0.02, 0.0)) * 0.0 + V((-sx * 0.0, 0, 0)), g + V((sx * 0.02, 0.005, 0)), 0.017, 8, name='grip', **kw)
        P('black', beam, g + V((-sx * 0.05, -0.02, 0.0)), g + V((-sx * 0.12, -0.10, -0.01)), 0.012, 0.006, name='lever', **kw)
    P('paint', cyl, hb, top, 0.02, 6, name='bar_clamp', **kw)
    P('black', cyl, hb + V((0, 0.0, 0.02)), hb + V((0, 0.0, 0.05)), 0.035, 10, name='speedo', **kw)
    # headlight nacelle with blackout cover, Notek on the front mudguard
    hl = top + V((0, -0.14, -0.06))
    VH.headlight('headlight', hl, 0.085, 0.14, cover=True, node=n)
    for sx in (-1, 1):
        P('paint', beam, hl + V((sx * 0.08, 0.10, 0.0)), top + V((sx * 0.1, 0, -0.03)), 0.015, 0.02, name='hl_bracket', **kw)
    # front mudguard: deep valanced guard following the tyre (sweep), stays to the sliders
    bm = bmesh.new()                        # thin, round-crowned, deep-valanced pressed guard
    VH.sweep_bm(bm, VH.arc_path(YF, RT, RT + 0.035, 208, 42, 22), guard_prof(0.078, 0.024, 0.075), x0=x, center=(YF, RT))
    VH.vp(bm, 'paint', 'front_guard', smooth=True, **kw)
    for sx in (-1, 1):
        P('paint', beam, (x + sx * 0.078, YF - 0.25, 0.30), (x + sx * 0.085, YF + 0.05, RT + 0.05), 0.012, 0.006, name='guard_stay', **kw)
    VH.notek('notek', (x, YF - 0.33, 0.62), node=n)
    VH.wheel('wheel_f', (x, YF, RT), RT, TW, RIM, 1, style='spoke', steer=n, lug=0.010)
    VH.VM['moving'].append({'node': n, 'kind': 'steer', 'pivot': VH.G(piv), 'axis': VH.Gd(ax), 'parent': None,
                            'limits_deg': [-35, 35], 'note': 'node frame is rotated so its local +Y is the raked head axis'})
    return {n: Matrix.Rotation(-RAKE, 3, 'X')}


def rear_bike():
    x = XB
    VH.wheel('wheel_r', (x, YR, RT), RT, TW, RIM, 1, style='spoke', lug=0.012)
    VH.emitter('dust', (x, YR + 0.3, 0.05), (0, 1, 0.4))
    bm = bmesh.new()
    VH.sweep_bm(bm, VH.arc_path(YR, RT, RT + 0.035, 150, -20, 18), guard_prof(0.08, 0.024, 0.07), x0=x, center=(YR, RT))
    VH.vp(bm, 'paint', 'rear_guard', smooth=True)
    # sprung saddles (rider + pillion) on coil springs
    burnt = VH.paint_base() == 'burnt'
    for y, z, nm in ((0.08, 0.80, 'saddle'), (0.47, 0.80, 'pillion')):
        if True:                            # burnt: leather + padding gone -> spring frame (veh.spring_frame)
            bm = bmesh.new()
            VH.body_loft(bm, [(y - 0.17, 0.07, z - 0.03, z + 0.02, 0.03), (y - 0.08, 0.13, z - 0.04, z + 0.045, 0.05),
                              (y + 0.10, 0.15, z - 0.04, z + 0.05, 0.05), (y + 0.14, 0.13, z - 0.03, z + 0.03, 0.04)], n=3)
            VH.xf_bm(bm, Matrix.Translation((x, 0, 0)))
            VH.vp(bm, 'leather', nm, smooth=True)
        for sx in (-1, 1):
            P('chrome', cyl, (x + sx * 0.08, y + 0.1, z - 0.05), (x + sx * 0.08, y + 0.1, z - 0.18), 0.018, 8, name='spring')
    P('paint', beam, (x - 0.1, 0.62, 0.76), (x + 0.1, 0.62, 0.76), 0.02, 0.02, name='grab_rail')
    # steel panniers (Packtaschen) either side of the rear wheel, rear rack, tail light + number plate
    for sx in (-1, 1):
        P('paint', VH.bevel_box, (x + sx * 0.20, YR + 0.02, 0.50), (0.10, 0.34, 0.28), 0.025, 2, name='pannier')
        P('paint', box, (x + sx * 0.255, YR + 0.02, 0.60), (0.01, 0.30, 0.03), name='pannier_lid')
        P('leather', box, (x + sx * 0.256, YR + 0.02, 0.52), (0.008, 0.03, 0.22), name='pannier_strap')
    P('paint', box, (x, YR + 0.36, 0.60), (0.20, 0.03, 0.14), name='plate_holder')
    VH.tac_number((x, YR + 0.378, 0.60), (0, 1, 0), 0.19, 0.12)
    VH.taillight('taillight', (x, YR + 0.33, 0.72), (0, 1, 0))
    VH.socket('seat_rider', (x, 0.08, 0.82), role='driver')
    VH.socket('seat_pillion', (x, 0.47, 0.82), role='passenger')
    # (ground contact added by VH.wheel - an explicit VH.contact here duplicated it: 5 contacts for 3 wheels)


XC = 0.36                                  # sidecar boat centreline


def sidecar():
    """BMW BW 43 sidecar: boat body (nose, open cockpit, tail deck with spare wheel), driven wheel + mudguard, chassis."""
    burnt = VH.paint_base() == 'burnt'
    T = Matrix.Translation((XC, 0, 0))
    bm = bmesh.new()
    VH.body_loft(bm, [(-1.00, 0.07, 0.52, 0.60, 0.035), (-0.90, 0.20, 0.42, 0.69, 0.09), (-0.66, 0.28, 0.37, 0.77, 0.13),
                      (-0.36, 0.30, 0.35, 0.80, 0.14)], n=3, rb=0.08)
    VH.xf_bm(bm, T)
    VH.vp(bm, 'paint', 'boat_nose', smooth=True)
    bm = bmesh.new()
    VH.body_loft(bm, [(0.42, 0.30, 0.36, 0.80, 0.14), (0.80, 0.27, 0.40, 0.75, 0.13), (1.02, 0.17, 0.48, 0.66, 0.07)], n=3, rb=0.08)
    VH.xf_bm(bm, T)
    VH.vp(bm, 'paint', 'boat_tail', smooth=True)
    bm = bmesh.new()                        # cockpit tub: floor pan + low body, thin side walls up to the coaming
    VH.body_loft(bm, [(-0.37, 0.30, 0.35, 0.50, 0.02), (0.43, 0.30, 0.36, 0.50, 0.02)], n=1, rb=0.08)
    VH.xf_bm(bm, T)
    VH.vp(bm, 'paint', 'boat_tub')
    for sx in (-1, 1):
        P('paint', box, (XC + sx * 0.285, 0.03, 0.66), (0.03, 0.80, 0.30), name='boat_wall')
    # coaming (rolled rim), grab handle, seat + backrest, canvas apron rolled at the front of the cockpit
    rim = [(XC - 0.285, -0.36, 0.80), (XC + 0.285, -0.36, 0.80), (XC + 0.285, 0.42, 0.80), (XC - 0.285, 0.42, 0.80)]
    for a, b in zip(rim, rim[1:] + rim[:1]):
        P('paint', cyl, a, b, 0.018, 6, name='coaming')
    P('paint', cyl, (XC + 0.30, -0.10, 0.82), (XC + 0.30, 0.20, 0.82), 0.012, 6, name='grab')
    P('leather', VH.bevel_box, (XC, 0.18, 0.55), (0.46, 0.36, 0.08), 0.03, 2, name='sc_seat')
    P('leather', VH.bevel_box, (XC, 0.38, 0.72), (0.46, 0.07, 0.34), 0.03, 2, name='sc_back')
    if not burnt:
        P('canvas', cyl, (XC - 0.27, -0.33, 0.82), (XC + 0.27, -0.33, 0.82), 0.04, 10, name='apron_roll')
    # tail: spare wire wheel on the tail deck, tail light, luggage rack
    ax = V((0, 0.62, 0.78)).normalized()
    Rm = Matrix.Translation((XC, 0.78, 0.83)) @ ax.to_track_quat('X', 'Z').to_matrix().to_4x4()
    bm = bmesh.new()
    if not burnt:
        VH.tyre_bm(bm, V((0, 0, 0)), RT, TW, RIM, 48, 0.012)
        VH.xf_bm(bm, Rm)
        VH.vp(bm, 'tyre', 'spare_tyre', smooth=True, uv='keep')
    bm = bmesh.new()
    VH.spoke_rim_bm(bm, V((0, 0, 0)), RIM, TW, 1, 18, segs=28)
    VH.xf_bm(bm, Rm)
    VH.vp(bm, 'rust' if burnt else 'paint', 'spare_rim')
    VH.taillight('taillight_sc', (XC, 1.03, 0.60), (0, 1, 0))
    if not burnt:
        VH.balkenkreuz((XC + 0.296, -0.50, 0.60), (1, 0, 0), 0.16)   # small cross on the sidecar nose flank
    # sidecar wheel (driven) + mudguard, swing arm, chassis tubes to the bike
    VH.wheel('wheel_s', (XS, YR, RT), RT, TW, RIM, 1, style='spoke', lug=0.012)
    bm = bmesh.new()
    VH.sweep_bm(bm, VH.arc_path(YR, RT, RT + 0.035, 172, 8, 18), guard_prof(0.08, 0.024, 0.07), x0=XS, center=(YR, RT))
    VH.vp(bm, 'paint', 'sc_guard', smooth=True)
    P('paint', beam, (XS - 0.08, YR - 0.2, 0.58), (XC + 0.28, YR - 0.2, 0.62), 0.03, 0.012, name='guard_stay')
    P('paint', beam, (XS - 0.08, YR + 0.2, 0.58), (XC + 0.28, YR + 0.2, 0.62), 0.03, 0.012, name='guard_stay')
    for a, b in (((XB + 0.10, -0.38, 0.30), (XC, -0.60, 0.34)), ((XB + 0.08, YR, 0.36), (XS - 0.06, YR, RT)),
                 ((XC, -0.60, 0.34), (XC, 0.70, 0.36)), ((XB + 0.10, 0.10, 0.62), (XC - 0.2, 0.10, 0.62)),
                 ((XC, 0.70, 0.36), (XS - 0.05, YR + 0.1, 0.36))):
        P('paint_under', cyl, a, b, 0.022, 8, name='sc_frame')
    VH.socket('seat_sidecar', (XC, 0.12, 0.60), role='gunner')
    # (ground contact added by VH.wheel - an explicit VH.contact here duplicated it: 5 contacts for 3 wheels)
    VH.emitter('dust', (XS, YR + 0.3, 0.05), (0, 1, 0.4))


def mg34():
    """MG34 on the sidecar pintle (Lafette-less pintle mount): yaw + pitch about the mount head."""
    n = 'mg34'
    piv = V((XC, -0.52, 0.97))
    kw = dict(node=n, pivot=piv)
    P('paint', cyl, (XC, -0.52, 0.78), (XC, -0.52, 0.93), 0.018, 8, name='pintle')          # stays with the boat
    if VH.paint_base() == 'burnt':          # wreck: the gun was salvaged by the crew / destroyed -> bare pintle only
        return
    P('paint', box, (XC, -0.52, 0.945), (0.05, 0.06, 0.04), name='pintle_head', **kw)
    g = 'gunmetal'
    P(g, box, (XC, -0.42, 0.985), (0.05, 0.34, 0.075), name='receiver', **kw)
    P(g, box, (XC, -0.46, 1.03), (0.052, 0.20, 0.02), name='feed_cover', **kw)
    P(g, cyl, (XC, -0.59, 0.985), (XC, -1.08, 0.985), 0.022, 10, name='barrel_jacket', **kw)
    for k in range(6):
        y = -0.65 - k * 0.07
        P('black', cyl, (XC, y, 0.985), (XC, y - 0.03, 0.985), 0.0225, 10, name='jacket_holes', **kw)
    P(g, cyl, (XC, -1.08, 0.985), (XC, -1.16, 0.985), 0.013, 8, name='barrel', **kw)
    P(g, cyl, (XC, -1.16, 0.985), (XC, -1.20, 0.985), 0.022, 10, r1=0.018, name='muzzle_booster', **kw)
    P(g, box, (XC, -1.02, 1.015), (0.006, 0.02, 0.03), name='front_sight', **kw)
    bm = bmesh.new()                        # bakelite butt stock
    VH.body_loft(bm, [(-0.25, 0.022, 0.95, 1.01, 0.01), (-0.10, 0.02, 0.90, 0.995, 0.01), (0.08, 0.021, 0.86, 0.99, 0.015)], n=1)
    VH.xf_bm(bm, Matrix.Translation((XC, 0, 0)))
    VH.vp(bm, 'black', 'stock', **kw)
    P('black', beam, (XC, -0.36, 0.95), (XC, -0.33, 0.85), 0.03, 0.022, name='grip', **kw)
    P(g, cyl, (XC - 0.03, -0.44, 0.97), (XC - 0.12, -0.44, 0.97), 0.055, 12, name='belt_drum', **kw)   # 50-rd Gurttrommel
    for sx in (-1, 1):
        P(g, beam, (XC + sx * 0.01, -0.95, 0.965), (XC + sx * 0.02, -0.70, 0.955), 0.01, 0.01, name='bipod', **kw)
    VH.socket('muzzle_mg34', (XC, -1.20, 0.985), (0, -1, 0), node=n, weapon='MG34', rpm=900)
    VH.moving(n, 'gun_yaw', piv, (0, 0, 1), limits=(-70, 70))
    VH.moving(n, 'gun_pitch', piv, (1, 0, 0), limits=(-12, 30), note='same node: yaw about local Y then pitch about local X (YXZ)')


def main(var, out_root):
    VH.setup('r75_sidecar', var, seed=75)
    engine_frame()
    frames = fork_front()
    rear_bike()
    sidecar()
    mg34()
    burnt = var == 'burnt'
    if burnt:
        VH.emitter('smoke', (XC, 0.0, 0.9), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(-2.5), 4, 'Y'))
    VH.emitter('fire', (XB, -0.25, 0.85), (0, 0, 1), when='destroyed', note='fuel tank fire')
    dims = {'length': 2.40, 'width': 1.73, 'height': 1.00, 'height_overall': 1.08, 'height_note': 'bars 1.00 m; MG34 feed cover / tank air-filter lid 1.03-1.08 m (measured; the old 1.28 m was a rotated-frame bbox artefact)', 'wheelbase': 1.444, 'sidecar_track': 1.13, 'tyre_d': round(2 * RT, 3)}
    VH.vfinalize(os.path.join(out_root, 'r75_sidecar'), 'motorcycle', dims, parents={'wheel_f': 'fork'}, frames=frames,
                 variants=ALL, extra={'real_name': 'BMW R75 with BW 43 sidecar + MG34', 'destroyed': burnt,
                                      'rotation_order': 'YXZ', 'sidecar_side': 'right (glTF -X; +X = vehicle left)'})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, VH.OUT_ROOT)
