# DR Baureihe 52 "Kriegslok" 2-10-0 (1'E h2) freight locomotive, 1942-45. Loco only; tender = tender_t30.py.
# blender -b ... --python loco_br52.py -- dr|winter|burnt|all
# Dims: LuP loco+tender 22.975 m (this loco 13.10 m), coupled wheels 1400 mm at 1.65 m pitch, leading 850 mm,
# wheelbase 9.2 m, cylinders 600 x 660 mm, boiler axis 3.05 m, chimney top 4.55 m, width 3.1 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['dr', 'winter', 'burnt']
RD, RL = 0.70, 0.425                          # driver / leading wheel radius
AX = [-2.35, -0.70, 0.95, 2.60, 4.25]         # coupled axles (front -> rear); main rod drives axle 3 (index 2)
YL = -4.95                                    # leading (Bissel) axle
ZB, RB = 3.05, 0.86                           # boiler axis height, barrel radius (cladding)
CR = 0.33                                     # crank radius (stroke 660 / 2)
YC = -3.75                                    # cylinder centre
XC, ZCY = 1.08, 0.98                          # cylinder x, axis height
PH = 0.6                                      # crank phase of the LEFT side (+X); the RIGHT side (-X) leads by 90 deg (DR practice)
# HANDEDNESS (kit convention): Blender/glTF +X = loco LEFT (fireman), -X = loco RIGHT (driver: DR locos are right-hand drive)
X0 = R.GAUGE[0] / 2 + 0.0675                  # wheel tread centre x
XR = X0 + 0.2                                 # rod plane (outside the wheels)


def pal():
    return dict(R.DR, wheel=R.DR['red'], frame=R.DR['red'], body=(27, 26, 25), smokebox=R.DR['smokebox'],
                buffer=R.DR['black'], white=(200, 196, 186), brass=(150, 118, 60), boiler=(30, 29, 28),
                scale=(98, 94, 86), dust=(64, 58, 50), wear=(92, 88, 82),
                ashpan=(62, 46, 38), pipe=(48, 46, 44), copper=(120, 70, 44), plate=(24, 23, 22))


def crank(s):
    """Crank angle of side s (+1 = +X = left, -1 = -X = right, leading): angle measured from -Y (front) toward +Z (up)."""
    return PH + (math.pi / 2 if s < 0 else 0.0)


def cpin(s, y):
    a = crank(s)
    return V((s * XR, y, RD)) + V((0, -math.cos(a), math.sin(a))) * CR


def running_gear():
    for i, y in enumerate(AX):
        R.wheelset('ws%d' % (i + 1), y, RD, 'spoked', spokes=12, segs=16, cw=100 if i != 2 else 140, crank=(CR, PH),
                   key='wheel', axle_key='frame')
        R.brake_blocks(y, RD, RD, X0 - 0.02, 'dark') if i < 4 else None
    # leading Bissel truck (pivots about Z behind the axle)
    R.wheelset('ws0', YL, RL, 'disc', segs=16, key='wheel', parent='bissel', axle_key='frame')
    kw = dict(node='bissel', pivot=(0, YL + 1.6, 0.6))
    for s in (-1, 1):
        RP('frame', VH.bevel_box, (s * 0.62, YL, RL + 0.02), (0.18, 0.3, 0.3), r=0.02, name='bissel_axlebox', bisect=False, **kw)
        RP('frame', beam, (s * 0.62, YL, RL + 0.1), (s * 0.15, YL + 1.6, 0.6), 0.12, 0.14, name='bissel_arm', bisect=False, **kw)
    RP('frame', box, (0, YL, RL + 0.25), (1.35, 0.25, 0.14), name='bissel_cross', bisect=False, **kw)
    VH.moving('bissel', 'bogie_yaw', (0, YL + 1.6, 0.6), (0, 0, 1), limits=(-7, 7), note='Bissel truck swings about its rear pivot')
    VH.emitter('rail_dust', (0, YL, 0.05), (0, 0, 1))
    VH.emitter('rail_dust', (0, AX[-1], 0.05), (0, 0, 1))


def frames():
    """Open bar frames inside the wheels (top bar, horn cheeks + horn stays round every axlebox, lower bars with
    open windows between the axles), the firebox foundation ring + ashpan hopper visible between the frames,
    buffer beam, drawbar, running boards + valances."""
    for s in (-1, 1):
        x = s * 0.6
        bm = bmesh.new()                                       # front plate (cylinder saddle area) + rear cab plate
        VH.side_prism(bm, [(-5.95, 0.85), (-5.95, 1.45), (-2.75, 1.45), (-2.75, 0.95), (-3.3, 0.8)], x - 0.05, x + 0.05)
        VH.side_prism(bm, [(4.7, 0.95), (4.7, 1.45), (5.9, 1.45), (5.9, 0.95)], x - 0.05, x + 0.05)
        rp_(bm, 'frame', 'bar_frame_plate')
        RP('frame', box, (x, (-2.75 + 4.7) / 2, 1.32), (0.1, 7.45, 0.26), name='bar_frame_top')
        for i, y in enumerate(AX):
            for dy in (-0.3, 0.3):                             # horn cheeks
                RP('frame', box, (x, y + dy, 0.8), (0.1, 0.12, 0.8), name='horn_cheek', bisect=False)
            RP('frame', box, (x, y, 0.36), (0.12, 0.72, 0.08), name='horn_stay', bisect=False)
            RP('frame', box, (s * 0.72, y, RD + 0.02), (0.14, 0.44, 0.36), name='axlebox', bisect=False)
            RP('dark', box, (s * 0.63, y, RD + 0.48), (0.12, 1.0, 0.1), name='frame_spring', bisect=False)
            if i < 4:                                          # lower bar + diagonal between the horn gaps: open windows
                ya, yb = y + 0.36, AX[i + 1] - 0.36
                RP('frame', box, (x, (ya + yb) / 2, 0.62), (0.1, yb - ya, 0.14), name='bar_frame_low', bisect=False)
                RP('frame', beam, (x, ya, 0.7), (x, yb, 1.19), 0.1, 0.09, name='bar_frame_diag', up=V((1, 0, 0)), bisect=False)
        RP('frame', beam, (x, -2.75, 0.95), (x, AX[0] - 0.36, 0.62), 0.1, 0.12, name='bar_frame_low', up=V((1, 0, 0)), bisect=False)
    for y in (-3.6, -1.52, 0.12, 1.77):
        RP('frame', box, (0, y, 1.12), (1.1, 0.14, 0.42), name='frame_stretcher', bisect=False)
    # firebox foundation ring + ashpan hopper with damper doors, seen through the frame windows
    RP('dark', box, (0, 3.5, 1.62), (1.9, 2.1, 0.22), name='foundation_ring')
    bm = bmesh.new()
    VH.side_prism(bm, [(2.55, 1.52), (4.45, 1.52), (4.25, 0.72), (3.85, 0.5), (3.05, 0.5), (2.7, 0.72)], -0.52, 0.52)
    rp_(bm, 'ashpan', 'ashpan')
    RP('dark', box, (0, 2.53, 1.0), (0.9, 0.04, 0.5), name='ashpan_damper', lod='drop')
    RP('dark', cyl, (0, 1.2, 0.95), (0, 1.9, 0.95), 0.2, 10, name='brake_cylinder', bisect=False)
    R.headstock(-5.95, 1.06, 3.0, 0.46, -1, 'frame', blen=0.6)
    for s in (-1, 1):                                          # buffer beam corner angles + lamp brackets
        RP('dark', box, (s * 1.47, -6.05, 1.06), (0.06, 0.04, 0.46), name='beam_angle', lod='drop')
    RP('frame', box, (0, 6.05, 1.06), (2.6, 0.2, 0.45), name='rear_beam')
    RP('dark', beam, (0, 6.1, 1.0), (0, 6.5, 1.0), 0.12, 0.1, name='drawbar', bisect=False)
    VH.socket('coupler_rear', (0, 6.55, 1.0), (0, 1, 0), note='drawbar to the tender (tender_t30 coupler_front)')
    for s in (-1, 1):
        RP('body', box, (s * 1.3, -0.6, 1.62), (0.5, 10.2, 0.04), name='running_board', uv='beam', axis=(0, 1, 0))
        RP('body', box, (s * 1.54, -0.6, 1.53), (0.03, 10.2, 0.16), name='valance')
        RP('dark', box, (s * 1.3, -0.6, 1.645), (0.46, 10.1, 0.008), name='running_board_chequer', lod='drop')
        for yy in (-4.6, -1.9, 0.8, 3.6):          # running-board brackets from the frame
            RP('frame', beam, (s * 0.66, yy, 1.3), (s * 1.5, yy, 1.58), 0.04, 0.06, name='rb_bracket', bisect=False, lod='drop')
        R.step(s * 1.45, -5.2, 1.5, 0.35, 0.22, 'frame', 0.55)
    RP('body', box, (0, -5.55, 1.62), (3.0, 0.8, 0.04), name='front_platform')


def cylinders():
    """Outside cylinders (600 mm bore): lagged barrel with clad bands, domed front/rear covers with stud rings,
    piston-valve chest above with its own covers, drain cocks + pipes, tail rods, steam + exhaust pipes."""
    for s in (-1, 1):
        x = s * XC
        RP('body', cyl, (x, YC - 0.55, ZCY), (x, YC + 0.55, ZCY), 0.45, 20, name='cylinder', smooth=True, bisect=False)
        for dy in (-0.3, 0.3):
            RP('dark', cyl, (x, YC + dy - 0.02, ZCY), (x, YC + dy + 0.02, ZCY), 0.46, 16, caps=False, name='cyl_band', bisect=False, lod='drop')
        for f in (-1, 1):
            y1 = YC + f * 0.55
            RP('smokebox', cyl, (x, y1, ZCY), (x, y1 + f * 0.05, ZCY), 0.47, 16, name='cyl_cover', bisect=False)
            RP('smokebox', cyl, (x, y1 + f * 0.05, ZCY), (x, y1 + f * 0.13, ZCY), 0.36, 12, r1=0.22, name='cyl_cover_dome', bisect=False)
            if False:
                bm = bmesh.new()
                for k in range(10):                            # cover stud ring (front covers)
                    a = 2 * math.pi * k / 10
                    q = V((x + math.cos(a) * 0.41, y1 + f * 0.05, ZCY + math.sin(a) * 0.41))
                    C.cyl_bm(bm, q, q + V((0, f * 0.035, 0)), 0.02, 4, caps=False)
                rp_(bm, 'dark', 'cover_studs', bisect=False, lod='drop')
        RP('body', VH.bevel_box, (x, YC, ZCY + 0.66), (0.5, 1.15, 0.42), r=0.08, name='valve_chest', bisect=False)
        for f in (-1, 1):
            RP('smokebox', cyl, (x, YC + f * 0.58, ZCY + 0.66), (x, YC + f * 0.66, ZCY + 0.66), 0.19, 12, name='valve_cover', bisect=False)
        RP('dark', cyl, (x, YC - 0.66, ZCY), (x, YC - 0.95, ZCY), 0.06, 8, name='tail_rod_guard', bisect=False)
        RP('body', box, (x - s * 0.1, YC, ZCY + 0.38), (0.35, 0.95, 0.2), name='cyl_saddle')
        for dy in (-0.45, 0.45):                               # drain cocks + pipes forward
            RP('brass', cyl, (x, YC + dy, ZCY - 0.45), (x, YC + dy, ZCY - 0.55), 0.035, 6, name='drain_cock', bisect=False, lod='drop')
        RP('dark', cyl, (x, YC + 0.45, ZCY - 0.55), (x, YC - 1.0, ZCY - 0.62), 0.025, 6, name='drain_pipe', bisect=False, lod='drop')
        for dz in (0.14, -0.14):
            RP('dark', box, (s * XR, -2.35 - 0.55, ZCY + dz), (0.07, 1.6, 0.06), name='slide_bar', bisect=False)
        RP('frame', box, (s * (XR - 0.12), -1.95, ZCY + 0.35), (0.28, 0.16, 0.95), name='motion_bracket', bisect=False)
        VH.emitter('steam_cocks', (x, YC - 0.9, ZCY - 0.6), (0, -0.7, -0.3), note='cylinder drain cocks: white steam at start-up')
    for s in (-1, 1):                                          # outside steam pipes smokebox -> valve chest (lagged)
        RP('body', cyl, (s * 0.72, -4.4, ZB - 0.35), (s * XC, YC - 0.2, ZCY + 0.85), 0.13, 10, name='steam_pipe', smooth=True, bisect=False)
        RP('dark', cyl, (s * 0.9, -4.1, ZB - 0.66), (s * 0.9, -4.1, ZB - 0.6), 0.16, 10, name='steam_pipe_flange', bisect=False, lod='drop')


def rods():
    """Coupling rods (node rod_c_<s>: translates with the crank, no rotation), main rod (rod_m_<s>: big end on the
    driving crankpin, small end on the crosshead), crosshead (xhead_<s>: slides along Y), simplified Walschaerts gear."""
    L_main = None
    for s in (-1, 1):
        sd = 'r' if s < 0 else 'l'                              # -X = right, +X = left
        pins = [cpin(s, y) for y in AX]
        xr = s * (XR + 0.05)
        nc = 'rod_c_' + sd
        kw = dict(node=nc, pivot=tuple(pins[2]))
        for a, b in zip(pins[:-1], pins[1:]):
            RP('dark', beam, (xr, a.y, a.z), (xr, b.y, b.z), 0.05, 0.13, name='coupling_rod', bisect=False, **kw)
        for p in pins:
            RP('dark', cyl, (xr - s * 0.04, p.y, p.z), (xr + s * 0.04, p.y, p.z), 0.1, 6, name='rod_boss', bisect=False, **kw)
        VH.moving(nc, 'rod_coupling', pins[2], (1, 0, 0), crank_radius=CR, phase_deg=round(math.degrees(crank(s)), 1),
                  axle=list(VH.G((0, AX[2], RD))), note='translate by crank vector (R cos, R sin) of ws3; keeps orientation')
        # crosshead on the slide bars
        dp = pins[2]
        L_main = 3.25
        xy = dp.y - math.sqrt(max(0.1, L_main ** 2 - (dp.z - ZCY) ** 2))
        nx = 'xhead_' + sd
        RP('dark', box, (s * XR, xy, ZCY), (0.1, 0.34, 0.24), name='crosshead', node=nx, pivot=(s * XR, xy, ZCY), bisect=False)
        VH.moving(nx, 'crosshead', (s * XR, xy, ZCY), (0, 1, 0), slide_axis='z', main_rod=L_main, note='slides along the loco axis')
        nm = 'rod_m_' + sd
        xm = s * (XR + 0.13)
        RP('dark', beam, (xm, xy, ZCY), (xm, dp.y, dp.z), 0.06, 0.16, name='main_rod', node=nm, pivot=(xm, dp.y, dp.z), bisect=False)
        RP('dark', cyl, (xm - s * 0.04, dp.y, dp.z), (xm + s * 0.05, dp.y, dp.z), 0.13, 10, name='big_end', node=nm, pivot=(xm, dp.y, dp.z), bisect=False)
        VH.moving(nm, 'rod_main', (xm, dp.y, dp.z), (1, 0, 0), length=L_main, small_end=VH.G((xm, xy, ZCY)),
                  note='big end follows the ws3 crankpin; rotate about local X so the small end stays on the crosshead line')
        RP('dark', cyl, (s * XR, YC + 0.55, ZCY), (s * XR, xy, ZCY), 0.05, 8, name='piston_rod', node=nx, pivot=(s * XR, xy, ZCY), bisect=False)
        # Walschaerts valve gear (all LOD0-visible): return crank on the ws3 crankpin -> eccentric rod -> expansion
        # link (node exlink_<s>, rocks about its trunnion) -> radius rod -> combination lever (on the crosshead node,
        # union link to the crosshead drop arm) -> valve spindle crosshead behind the valve chest.
        xg = s * (XR + 0.2)
        ec = dp + V((s * 0.2, 0, 0)) + V((0, -0.22, 0.3))
        RP('dark', beam, dp + V((s * 0.12, 0, 0)), ec, 0.05, 0.1, name='return_crank', node=nc, pivot=tuple(pins[2]), bisect=False)
        lk = V((xg, -1.62, ZCY + 0.62))
        ne = 'exlink_' + sd
        ekw = dict(node=ne, pivot=tuple(lk))
        bm = bmesh.new()                                       # curved slotted link: two cheeks
        for dx in (-0.035, 0.035):
            pts = [lk + V((dx, -0.07 * (1 - t * t), 0.32 * t)) for t in (-1.0, 0.0, 1.0)]
            for a, b in zip(pts[:-1], pts[1:]):
                C.beam_bm(bm, a, b, 0.03, 0.1, up=V((1, 0, 0)))
        rp_(bm, 'dark', 'expansion_link', bisect=False, **ekw)
        RP('frame', box, tuple(lk + V((-s * 0.1, 0, 0))), (0.2, 0.18, 0.12), name='link_trunnion', bisect=False)
        RP('dark', beam, ec, lk + V((0, 0, -0.32)), 0.045, 0.09, name='eccentric_rod', node=nc, pivot=tuple(pins[2]), bisect=False)
        vs = V((xg, YC + 0.9, ZCY + 0.66))                     # valve spindle crosshead
        RP('dark', box, tuple(vs), (0.07, 0.16, 0.14), name='valve_crosshead', bisect=False)
        RP('dark', cyl, (s * XC, YC + 0.66, ZCY + 0.66), vs, 0.035, 8, name='valve_spindle', bisect=False)
        RP('dark', beam, lk + V((0, 0, 0.05)), vs + V((0, 0.12, 0.08)), 0.045, 0.1, name='radius_rod', bisect=False)
        RP('dark', beam, (xg, xy - 0.05, ZCY + 0.72), (xg, xy - 0.05, ZCY - 0.34), 0.045, 0.1, name='combination_lever',
           node=nx, pivot=(s * XR, xy, ZCY), bisect=False)
        RP('dark', beam, (xg, xy - 0.05, ZCY - 0.3), (s * XR, xy + 0.05, ZCY - 0.2), 0.04, 0.07, name='union_link',
           node=nx, pivot=(s * XR, xy, ZCY), bisect=False)
        RP('dark', beam, (s * XR, xy + 0.05, ZCY - 0.1), (s * XR, xy + 0.05, ZCY - 0.24), 0.06, 0.08, name='drop_arm',
           node=nx, pivot=(s * XR, xy, ZCY), bisect=False)
        VH.moving(ne, 'expansion_link', tuple(lk), (1, 0, 0), limits=(-14, 14), phase_deg=round(math.degrees(crank(s)) + 90, 1),
                  note='rocks +-14 deg about local X once per wheel revolution, 90 deg behind the crank (return crank)')
        # reversing (reach) rod from the cab to the lifting arm + weigh-shaft arm
        if s < 0:                                              # driver's side (right, -X): horizontal, just under the running board
            RP('dark', cyl, (s * 1.12, -1.6, 1.74), (s * 1.12, 4.7, 1.74), 0.028, 6, name='reach_rod', bisect=False)
            RP('dark', box, (s * 1.12, 4.75, 1.8), (0.06, 0.12, 0.22), name='reach_rod_screw', bisect=False, lod='drop')
        RP('dark', beam, (s * 1.12, -1.6, 1.74), lk + V((0, 0.05, 0.3)), 0.04, 0.06, name='lifting_arm', bisect=False, lod='drop')


def boiler(burnt):
    rn = C.rng()
    # barrel (smooth cladding, 3 boiler bands) + firebox wrapper
    bm = bmesh.new()
    C.cyl_bm(bm, V((0, -3.85, ZB)), V((0, 2.3, ZB)), RB, 24)
    if burnt:
        dead = [f for f in bm.faces if f.calc_center_median().x < -0.3 and abs(f.calc_center_median().y + 1.0) < 0.9 and f.calc_center_median().z > ZB - 0.4]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.03)
    rp_(bm, 'boiler', 'boiler_barrel', smooth=True, bisect=False)
    for y in (-3.3, -2.0, -0.75, 0.55, 1.8):
        RP('dark', cyl, (0, y - 0.045, ZB), (0, y + 0.045, ZB), RB + 0.014, 24, caps=False, name='boiler_band', smooth=True, bisect=False)
    # round-top firebox (sits above the rear coupled wheels, between them and the cab)
    rings = []
    for y in (2.3, 4.55):
        ring = []
        for i in range(13):
            a = math.pi * i / 12
            ring.append(V((-math.cos(a) * 0.95, y, ZB + math.sin(a) * RB * (1.0 if y < 3 else 0.98))))
        ring += [V((0.95, y, 1.75)), V((-0.95, y, 1.75))]
        rings.append(ring)
    bm = bmesh.new()
    C.loft_bm(bm, rings, False, True)
    rp_(bm, 'boiler', 'firebox', smooth=True)
    # smokebox (graphite) with dished door, dart handle, hinges
    RP('smokebox', cyl, (0, -5.3, ZB), (0, -3.8, ZB), RB + 0.05, 24, name='smokebox', smooth=True, bisect=False)
    RP('smokebox', cyl, (0, -5.28, 1.85), (0, -3.85, 1.85), 0.45, 4, name='smokebox_saddle', bisect=False)
    # smokebox door: dished pressing (lofted), heavy hinge straps across it, central handwheel + dart (T) handle,
    # number plate above the centre; node smokebox_door hinged on the loco's left (+X; right as seen from the front)
    nd = 'smokebox_door'
    dkw = dict(node=nd, pivot=(0.8, -5.36, ZB))
    RP('dark', cyl, (0, -5.29, ZB), (0, -5.33, ZB), RB + 0.07, 24, name='smokebox_front_ring', bisect=False)
    prof = [(RB - 0.01, -5.31), (RB - 0.01, -5.36), (RB - 0.05, -5.39), (RB - 0.16, -5.43), (0.5, -5.47), (0.3, -5.49), (0.001, -5.5)]
    rings = [[V((r * math.cos(2 * math.pi * i / 24), y, ZB + r * math.sin(2 * math.pi * i / 24))) for i in range(24)] for r, y in prof]
    bm = bmesh.new()
    C.loft_bm(bm, rings, False, False)
    rp_(bm, 'smokebox', 'door_dish', smooth=True, bisect=False, **dkw)
    for dz in (-0.42, 0.42):                                   # hinge straps (right side hinge -> across the door)
        zz = ZB + dz
        bm = bmesh.new()
        pts = [V((RB + 0.02, -5.36, zz)), V((0.5, -5.44, zz)), V((0.0, -5.5, zz)), V((-0.45, -5.47, zz))]
        for a, b in zip(pts[:-1], pts[1:]):
            C.beam_bm(bm, a, b, 0.1, 0.03, up=V((0, -1, 0)))
        rp_(bm, 'dark', 'door_strap', bisect=False, **dkw)
        RP('dark', cyl, (RB + 0.02, -5.36, zz - 0.08), (RB + 0.02, -5.36, zz + 0.08), 0.045, 8, name='door_hinge_knuckle', bisect=False, lod='drop')
    RP('dark', cyl, (0, -5.5, ZB), (0, -5.62, ZB), 0.05, 8, name='door_dart_spindle', bisect=False, **dkw)
    RP('dark', VH.ring_torus, (0, -5.6, ZB), 0.15, 0.018, (0, 1, 0), 12, 3, name='door_handwheel', bisect=False, **dkw)
    for a in (0.0, math.pi / 2):
        RP('dark', beam, (0.14 * math.cos(a), -5.6, ZB + 0.14 * math.sin(a)), (-0.14 * math.cos(a), -5.6, ZB - 0.14 * math.sin(a)), 0.02, 0.02, name='handwheel_spoke', bisect=False, lod='drop', **dkw)
    RP('dark', beam, (-0.22, -5.66, ZB), (0.22, -5.66, ZB), 0.05, 0.035, name='door_dart_handle', bisect=False, **dkw)
    RP('dark', beam, (-0.22, -5.63, ZB), (-0.22, -5.69, ZB), 0.045, 0.045, name='door_dart_grip', bisect=False, lod='drop', **dkw)
    if not burnt:
        RP('plate', box, (0, -5.47, ZB + 0.52), (0.72, 0.03, 0.18), name='smokebox_number_plate', **dkw)
        RP('white', box, (0, -5.49, ZB + 0.52), (0.68, 0.01, 0.015), name='plate_border', lod='drop', **dkw)
        R.label_block((0, -5.495, ZB + 0.52), (0, -1, 0), 0.56, 0.1, 1, 'white')
    VH.moving(nd, 'door', (0.8, -5.36, ZB), (0, 0, 1), limits=(0, 100), note='smokebox door hinged on the loco left (+X), i.e. on the right as seen from the front')
    # chimney (short Kriegslok stack) + smoke emitter
    if not burnt:
        RP('body', cyl, (0, -4.55, ZB + RB - 0.1), (0, -4.55, 4.5), 0.3, 16, r1=0.27, name='chimney', smooth=True, bisect=False)
        RP('body', cyl, (0, -4.55, 4.46), (0, -4.55, 4.55), 0.34, 16, name='chimney_lip', bisect=False)
    else:
        RP('body', cyl, (0, -4.55, ZB + RB - 0.1), (0, -4.55, 4.0), 0.3, 12, name='chimney_stump', bisect=False)
    VH.emitter('chimney_smoke', (0, -4.55, 4.56), (0, 0, 1), rate='exhaust beats: 4 per wheel revolution', note='coal smoke; black when firing')
    VH.emitter('sparks', (0, -4.55, 4.56), (0, 0, 1), when='night / hard working')
    # sand dome + steam dome (Kriegslok: low, plain domes)
    for y, h, r in ((-2.4, 0.36, 0.4), (-0.4, 0.42, 0.5)):
        if burnt and y > -1:                                 # steam dome blown off: torn skirt + peeled petals
            z0 = ZB + RB - 0.25
            RP('body', cyl, (0, y, z0), (0, y, z0 + 0.34), r * 1.05, 16, name='dome_torn_skirt', bisect=False)
            RP('dark', cyl, (0, y, z0 + 0.3), (0, y, z0 + 0.36), r * 0.7, 12, name='dome_regulator_seat', bisect=False)
            for k in range(6):
                a = 2 * math.pi * k / 6 + 0.3
                d = V((math.cos(a), math.sin(a), 0))
                b0 = V((0, y, z0 + 0.34)) + d * r
                RP('body', beam, b0, b0 + d * (0.25 + 0.1 * (k % 2)) + V((0, 0, 0.12 - 0.05 * (k % 3))), 0.22, 0.02,
                   up=V((0, 0, 1)), name='dome_petal', bisect=False)
            continue
        bm = bmesh.new()
        rings = []
        z0 = ZB + RB - 0.25
        for k in range(6):                                   # low dome: straight skirt + rounded cap
            t = k / 5
            rr = r * (1.0 if t < 0.5 else math.cos((t - 0.5) * 2 * math.pi / 2 * 0.9))
            zz = z0 + 0.25 + h * (t if t < 0.5 else 0.5 + 0.5 * math.sin((t - 0.5) * 2 * math.pi / 2))
            if k == 0:
                rr, zz = r * 1.15, z0
            rings.append([V((rr * math.cos(2 * math.pi * i / 14), y + rr * math.sin(2 * math.pi * i / 14), zz)) for i in range(14)])
        C.loft_bm(bm, rings, False, True)
        rp_(bm, 'boiler', 'dome', smooth=True, bisect=False)
    # Mischvorwaermer (mixing feed-water heater) box across the smokebox top ahead of the chimney
    RP('body', VH.bevel_box, (0, -5.0, ZB + RB + 0.12), (1.0, 0.5, 0.4), r=0.06, name='feedwater_heater', bisect=False)
    bm = bmesh.new()                                          # heater overflow pipe: down the smokebox side (on it)
    hp = [V(((RB + 0.1) * math.cos(math.radians(a_)), -4.75, ZB + (RB + 0.1) * math.sin(math.radians(a_)))) for a_ in (68, 45, 20, -5)]
    hp = [V((0.5, -4.75, ZB + RB + 0.1))] + hp + [V((RB + 0.1, -4.2, ZB - 0.09))]
    for a_, b_ in zip(hp[:-1], hp[1:]):
        C.cyl_bm(bm, a_, b_, 0.045, 5, caps=False)
    rp_(bm, 'dark', 'heater_pipe', bisect=False, lod='drop')
    # safety valves + whistle ahead of the cab
    for dx in (-0.15, 0.15):
        RP('brass', cyl, (dx, 1.9, ZB + RB - 0.05), (dx, 1.9, ZB + RB + 0.3), 0.07, 8, name='safety_valve', bisect=False, lod='drop')
    RP('brass', cyl, (0.35, 2.4, ZB + RB - 0.1), (0.35, 2.4, ZB + RB + 0.45), 0.04, 8, name='whistle', bisect=False, lod='drop')
    VH.emitter('steam_safety', (0, 1.9, ZB + RB + 0.32), (0, 0, 1), when='blowing off')
    VH.emitter('steam_whistle', (0.35, 2.4, ZB + RB + 0.45), (0, 0, 1), when='horn_train')


def cab(burnt):
    """Closed Kriegslok cab (y 4.55..6.25): sheet sides with 2 windows, spectacle plate with round windows, arched roof
    with vent, open rear to the tender; cab doors are side openings with grab rails."""
    y0, y1, zf, ze, zr, hw = 4.55, 6.25, 1.62, 3.55, 4.25, 1.45
    for s in (-1, 1):
        x = s * hw
        # side sheet: lower panel, window posts, door opening at the rear
        RP('body', box, (x, (y0 + y1) / 2 - 0.2, zf + 0.6), (0.04, y1 - y0 - 0.4, 1.2), name='cab_side_low')
        for yy in (y0 + 0.05, y0 + 0.75, y1 - 0.55):
            RP('body', box, (x, yy, zf + 1.6), (0.04, 0.12, 0.8), name='cab_window_post')
        RP('body', box, (x, (y0 + y1) / 2 - 0.2, ze - 0.15), (0.04, y1 - y0 - 0.4, 0.3), name='cab_side_top')
        for yy, w in ((y0 + 0.4, 0.6), (y0 + 1.07, 0.52)):
            RP('glass', box, (x, yy, zf + 1.6), (0.02, w, 0.72), name='cab_glass', lod='drop')
            xo = x + s * 0.035                                  # window frame (bead) + sliding-sash rail + divider
            for dz in (-0.38, 0.38):
                RP('dark', box, (xo, yy, zf + 1.6 + dz), (0.03, w + 0.08, 0.05), name='cab_window_frame')
            for dy in (-w / 2 - 0.02, w / 2 + 0.02):
                RP('dark', box, (xo, yy + dy, zf + 1.6), (0.03, 0.05, 0.8), name='cab_window_frame')
            RP('dark', box, (xo + s * 0.01, yy, zf + 1.6), (0.02, 0.035, 0.72), name='cab_window_sash', lod='drop')
            RP('dark', box, (xo + s * 0.02, yy, zf + 1.2), (0.04, w + 0.3, 0.03), name='cab_window_rail', lod='drop')
        # cab-side number plate (raised, bordered) + class plate below the windows
        if not burnt:
            RP('plate', box, (x + s * 0.03, y0 + 0.75, zf + 0.85), (0.02, 1.0, 0.24), name='cab_number_plate')
            R.label_block((x + s * 0.045, y0 + 0.75, zf + 0.85), (s, 0, 0), 0.8, 0.13, 1, 'white')
            RP('plate', box, (x + s * 0.03, y0 + 0.75, zf + 0.45), (0.02, 0.5, 0.14), name='cab_class_plate', lod='drop')
        # rain strip (gutter) along the roof edge + cab side hand grab over the door
        RP('dark', box, (x + s * 0.03, (y0 + y1) / 2, ze + 0.05), (0.04, y1 - y0 + 0.2, 0.04), name='rain_strip')
        RP('body', box, (x, y1 - 0.06, (zf + ze) / 2), (0.04, 0.12, ze - zf), name='cab_rear_post')
        R.handrail([(x + s * 0.06, y1 - 0.35, zf - 0.3), (x + s * 0.06, y1 - 0.35, zf + 1.3)])
        R.step(x + s * 0.02, y1 - 0.3, zf - 0.1, 0.4, 0.25, 'frame', 0.45)
        R.step(x + s * 0.02, y1 - 0.3, zf - 0.1, 0.4, 0.25, 'frame', 0.95)
        VH.socket('cab_door_' + ('r' if s < 0 else 'l'), (x + s * 0.8, y1 - 0.3, -0.0), (-s, 0, 0), pose='climb_in',
                  note='ground level beside the cab steps')
    # spectacle plate (front wall) over the firebox, with round lookouts
    bm = bmesh.new()
    pts = [V((-hw, y0, zf)), V((-0.95, y0, zf)), V((-0.95, y0, ZB))] + \
          [V((-math.cos(math.pi * i / 10) * 0.95, y0, ZB + math.sin(math.pi * i / 10) * RB)) for i in range(1, 10)] + \
          [V((0.95, y0, ZB)), V((0.95, y0, zf)), V((hw, y0, zf)), V((hw, y0, ze)), V((0, y0, zr)), V((-hw, y0, ze))]
    a = [bm.verts.new(p) for p in pts]
    try:
        bm.faces.new(a)
    except ValueError:
        pass
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
    rp_(bm, 'body', 'spectacle_plate')
    for s in (-1, 1):
        RP('glass', cyl, (s * 1.12, y0 - 0.03, 3.45), (s * 1.12, y0 - 0.06, 3.45), 0.2, 12, name='lookout', lod='drop', bisect=False)
    # roof (arched, overhanging) + roof vent
    if not burnt:
        bm = bmesh.new()
        rings = []
        for y in (y0 - 0.1, y1 + 0.15):
            rings.append([V((-(hw + 0.08) * math.cos(math.pi * i / 10), y, ze + (zr - ze) * math.sin(math.pi * i / 10))) for i in range(11)])
        vs = [[bm.verts.new(p) for p in r] for r in rings]
        for i in range(10):
            bm.faces.new((vs[0][i], vs[0][i + 1], vs[1][i + 1], vs[1][i]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
        rp_(bm, 'body', 'cab_roof', smooth=True)
        # raised roof ventilator (Dachluefter): coaming with louvred sides + hinged lid (node roof_vent)
        yv = (y0 + y1) / 2
        RP('body', box, (0, yv, zr + 0.06), (0.8, 1.0, 0.16), name='roof_vent_coaming')
        for sx in (-1, 1):
            for k in range(3):
                RP('dark', box, (sx * 0.405, yv - 0.3 + k * 0.3, zr + 0.07), (0.02, 0.2, 0.03), name='roof_vent_louvre', lod='drop')
        RP('body', box, (0, yv, zr + 0.17), (0.9, 1.1, 0.04), name='roof_vent_lid', node='roof_vent', pivot=(0, yv + 0.55, zr + 0.17))
        RP('dark', box, (0, yv - 0.56, zr + 0.14), (0.9, 0.04, 0.05), name='roof_vent_lip', node='roof_vent', pivot=(0, yv + 0.55, zr + 0.17), lod='drop')
        for sx in (-1, 1):
            RP('dark', beam, (sx * 1.2, y0 - 0.05, 4.0), (sx * 1.2, y1 + 0.1, 4.0), 0.03, 0.03, name='roof_rain_strip', bisect=False)
        VH.moving('roof_vent', 'hatch', (0, yv + 0.55, zr + 0.17), (1, 0, 0), limits=(0, 40))
    RP('planks', box, (0, (y0 + y1) / 2, zf + 0.02), (2.8, y1 - y0, 0.04), name='cab_floor')
    # backhead: firehole door glow, gauges
    RP('dark', box, (0, y0 + 0.08, 2.1), (0.5, 0.06, 0.4), name='firehole')
    VH.light('firebox_glow', (0, y0 + 0.2, 2.1), (0, 1, 0), False, kind='fire_glow')
    VH.socket('driver', (-0.8, y0 + 0.9, zf), (0, -1, 0), pose='stand', note='Lokfuehrer: right-hand drive (DR), -X = loco right')
    VH.socket('fireman', (0.6, y0 + 0.9, zf), (0, -1, 0), pose='stand_shovel', note='Heizer: loco left (+X), firehole door + injector side')


def fittings(burnt):
    """Handedness: +X = loco LEFT (fireman), -X = loco RIGHT (driver; DR right-hand drive).
    Right (-X): two-stage Knorr air pump beside the smokebox, reach rod. Left (+X): Knorr-Nielebock feed-water pump,
    injector under the cab, turbo-generator on the boiler top. Both: main air reservoirs, Both sides: washout plugs, boiler pipework on clips,
    sand pipes to the drivers, boiler handrails. Front: buffer-beam lamps + top lamp (blackout covers), pilot."""
    # --- Knorr two-stage air pump (RIGHT = -X, driver's side, beside the smokebox, on the running board)
    ap = V((-1.28, -4.35, 1.64))
    RP('dark', cyl, ap + V((0.0, 0.0, 0.0)), ap + V((0.0, 0.0, 0.5)), 0.2, 12, name='air_pump_lp', smooth=True, bisect=False)
    RP('dark', cyl, ap + V((0.0, 0.0, 0.5)), ap + V((0.0, 0.0, 0.58)), 0.23, 12, name='air_pump_flange', bisect=False)
    RP('dark', cyl, ap + V((0.0, 0.0, 0.58)), ap + V((0.0, 0.0, 1.05)), 0.16, 12, name='air_pump_hp', smooth=True, bisect=False)
    RP('dark', cyl, ap + V((0.0, 0.0, 1.05)), ap + V((0.0, 0.0, 1.12)), 0.19, 12, name='air_pump_cap', bisect=False)
    RP('dark', cyl, ap + V((0.14, 0.18, 0.2)), ap + V((0.14, 0.18, 1.0)), 0.06, 8, name='air_pump_valvebox', bisect=False, lod='drop')
    RP('dark', VH.bevel_box, ap + V((0.3, 0.0, 0.75)), (0.16, 0.3, 0.16), r=0.03, name='air_pump_bracket', bisect=False)
    bm = bmesh.new()
    for a, b in (((-1.28, -4.35, 2.8), (-1.0, -4.6, ZB + 0.2)), ((-1.2, -4.2, 1.7), (-1.25, -3.2, 1.45)), ((-1.35, -4.5, 1.8), (-1.35, -5.4, 1.5))):
        C.cyl_bm(bm, V(a), V(b), 0.03, 6)
    rp_(bm, 'pipe', 'air_pump_pipes', bisect=False)
    # --- Knorr-Nielebock feed-water pump (LEFT = +X, fireman's side, mid-boiler on the running board); its delivery
    # pipe climbs the barrel side and runs forward ALONG the barrel (clipped) to the Mischvorwaermer on the smokebox
    fp = V((1.3, -1.35, 1.64))
    RP('dark', cyl, fp, fp + V((0, 0, 0.55)), 0.15, 12, name='feed_pump_water', smooth=True, bisect=False)
    RP('dark', cyl, fp + V((0, 0, 0.55)), fp + V((0, 0, 0.62)), 0.18, 12, name='feed_pump_flange', bisect=False)
    RP('dark', cyl, fp + V((0, 0, 0.62)), fp + V((0, 0, 0.98)), 0.12, 12, name='feed_pump_steam', smooth=True, bisect=False)
    bm = bmesh.new()
    a40 = math.radians(40)
    pr = RB + 0.07
    run = V((pr * math.cos(a40), 0, ZB + pr * math.sin(a40)))
    for a_, b_ in (((1.3, -1.35, 2.62), (1.0, -1.35, 2.62)), ((1.0, -1.35, 2.62), (run.x, -1.35, run.z)),
                   ((run.x, -1.35, run.z), (run.x, -4.6, run.z)), ((run.x, -4.6, run.z), (0.45, -4.85, ZB + RB + 0.12)),
                   ((1.3, -1.2, 1.7), (1.3, 3.9, 1.5))):
        C.cyl_bm(bm, V(a_), V(b_), 0.04, 5, caps=False)
    for yb in (-3.3, -2.0):                                    # pipe clips on the boiler bands
        C.box_bm(bm, (run.x - 0.02, yb, run.z - 0.02), (0.06, 0.06, 0.08))
    rp_(bm, 'pipe', 'feed_pipes', bisect=False)
    # --- LEFT (+X): turbo-generator on the boiler top ahead of the cab (lighting), steam + exhaust stubs
    RP('dark', cyl, (0.35, -3.2, ZB + RB - 0.05), (0.35, -3.2, ZB + RB + 0.15), 0.07, 8, name='turbo_stand', bisect=False, lod='drop')
    RP('dark', cyl, (0.35, -3.45, ZB + RB + 0.22), (0.35, -2.95, ZB + RB + 0.22), 0.13, 12, name='turbo_generator', smooth=True, bisect=False)
    for s in (-1, 1):
        RP('frame', cyl, (s * 1.3, 0.5, 1.38), (s * 1.3, 3.8, 1.38), 0.21, 12, name='air_reservoir', smooth=True, bisect=False)
        R.handrail([(s * (RB + 0.14), -5.0, ZB + 0.25), (s * (RB + 0.14), 2.2, ZB + 0.25)], r=0.018, key='wear')
        # pipework along the boiler side (clipped at every band)
        bm = bmesh.new()
        for k, (a, dz) in enumerate(((0.28, 0.0), (-0.2, 0.0))):
            rr = RB + 0.05 + 0.012 * k
            p0 = V((s * rr * math.cos(a), -4.0, ZB + rr * math.sin(a)))
            p1 = V((s * rr * math.cos(a), 2.25, ZB + rr * math.sin(a)))
            C.cyl_bm(bm, p0, p1, 0.022 if k else 0.03, 5, caps=False)
            for yb in (-3.3, -0.75, 1.8):
                C.box_bm(bm, (s * (rr + 0.01) * math.cos(a), yb + 0.12, ZB + (rr + 0.01) * math.sin(a)), (0.05, 0.05, 0.07))
        rp_(bm, 'pipe', 'boiler_pipes', bisect=False)
        # washout plugs: firebox shoulders + barrel front ring
        bm = bmesh.new()
        for y in (2.6, 3.05, 3.5, 3.95, 4.35):
            for a in (math.radians(62),):
                d = V((s * math.cos(a), 0, math.sin(a)))
                q = V((s * 0.95 * math.cos(a), y, ZB + RB * math.sin(a)))
                C.cyl_bm(bm, q - d * 0.01, q + d * 0.06, 0.05, 6)
        for y in ():
            for a in (math.radians(40),):
                d = V((s * math.cos(a), 0, math.sin(a)))
                q = V((0, y, ZB)) + d * RB
                C.cyl_bm(bm, q - d * 0.01, q + d * 0.06, 0.05, 6)
        rp_(bm, 'smokebox', 'washout_plugs', bisect=False)
        # sand pipes: three per side from the sand-dome base, laid ON the barrel (short fan, clipped) down to the
        # running board, then straight down outside the frame to just ahead of drivers 1-3
        bm = bmesh.new()
        for k, y in enumerate(AX[:3]):
            yd = -2.4 + (k - 1) * 0.12
            pts = []
            for j in range(4):                                   # arc on the barrel: 62 deg -> -30 deg, y dome -> ahead of the wheel
                t = j / 3
                a_ = math.radians(62 - 92 * t)
                rr = RB + 0.035
                pts.append(V((s * rr * math.cos(a_), yd + (y - 0.8 - yd) * t ** 1.5, ZB + rr * math.sin(a_))))
            pts += [V((s * 1.12, y - 0.8, 1.7)), V((s * 1.12, y - 0.8, 1.2)), V((s * 0.84, y - 0.74, 0.2))]
            for a_, b_ in zip(pts[:-1], pts[1:]):
                C.cyl_bm(bm, a_, b_, 0.022, 4, caps=False)
        rp_(bm, 'pipe', 'sand_pipe', bisect=False)
    # injector (LEFT, fireman's side) under the cab; delivery pipe up the firebox side and forward along the barrel
    # (clipped at the bands) to the top clack valve ahead of the steam dome
    RP('brass', cyl, (1.2, 5.2, 1.3), (1.2, 5.6, 1.3), 0.08, 8, name='injector', bisect=False, lod='drop')
    bm = bmesh.new()
    zr = ZB - 0.28
    xr = 1.0
    xb = math.sqrt(max(0.0, (RB + 0.06) ** 2 - (zr - ZB) ** 2))
    for a_, b_ in (((1.2, 5.2, 1.35), (1.2, 4.45, 1.66)), ((1.2, 4.45, 1.66), (xr, 4.4, zr)), ((xr, 4.4, zr), (xr, 2.3, zr)),
                   ((xr, 2.3, zr), (xb, 2.0, zr)), ((xb, 2.0, zr), (xb, -0.95, zr)),
                   ((xb, -0.95, zr), (RB * 0.72, -0.95, ZB + RB * 0.72)), ((RB * 0.72, -0.95, ZB + RB * 0.72), (0.2, -0.95, ZB + RB + 0.08))):
        C.cyl_bm(bm, V(a_), V(b_), 0.035, 5, caps=False)
    for yb in (1.8, 0.55, -0.75):
        C.box_bm(bm, (xb - 0.03, yb, zr), (0.07, 0.06, 0.07))
    rp_(bm, 'pipe', 'injector_delivery', bisect=False, lod='drop')
    RP('brass', cyl, (0.0, -0.95, ZB + RB + 0.02), (0.0, -0.95, ZB + RB + 0.14), 0.09, 8, name='clack_valve', bisect=False, lod='drop')
    # --- front: DR headlamps (2 on the buffer beam + 1 on the smokebox), blackout covers
    for s in (-1, 1):
        R.lamp((s * 0.85, -6.02, 1.52), (0, -1, 0), 'headlamp_' + ('r' if s < 0 else 'l'))
    R.lamp((0, -5.42, ZB + RB + 0.2), (0, -1, 0), 'headlamp_top')
    R.handrail([(-1.2, -5.85, 1.64), (-1.2, -5.85, 2.3), (1.2, -5.85, 2.3), (1.2, -5.85, 1.64)], r=0.018)
    # pilot: V plough of vertical plates under the buffer beam (bolted to it) + rail guards before the Bissel wheels
    for s in (-1, 1):
        bm = bmesh.new()
        VH.side_prism(bm, [(0.0, 0.12), (0.0, 0.8), (1.25, 0.8), (1.25, 0.12)], -0.012, 0.012)
        bm.transform(Matrix.Translation((0, -6.42, 0)) @ Matrix.Rotation(math.radians(-75 * s), 4, 'Z'))   # side_prism plate lies along +Y
        rp_(bm, 'dark', 'pilot_plate', bisect=False)
        RP('dark', beam, (s * 1.2, -6.1, 0.8), (s * 0.3, -6.35, 0.2), 0.05, 0.05, name='pilot_brace', bisect=False, lod='drop')
        RP('dark', beam, (s * 0.78, -5.4, 0.9), (s * 0.78, -5.45, 0.1), 0.08, 0.03, name='rail_guard', up=V((1, 0, 0)), bisect=False)


def streaks(var):
    """Value breaks for the 40 deg camera: limescale (white-grey) runs below the domes, safety valves and washout
    plugs, grey-brown dust/ash runs down the barrel, worn (lighter) running-board edges."""
    if var == 'burnt':
        return
    rn = C.rng()
    if var == 'winter':                                        # streaks hidden under snow/rime: keep only the edge wear
        for s in (-1, 1):
            RP('wear', box, (s * 1.555, -0.6, 1.6), (0.012, 10.1, 0.05), name='running_board_edge_wear', lod='drop')
        return
    out = lambda c: V((c.x, 0, c.z - ZB))
    rr = RB + 0.02
    for s in (-1, 1):
        for y0, n in ((-2.4, 3), (-0.4, 4), (1.9, 2)):                     # sand dome, steam dome, safety valves
            for k in range(n):
                y = y0 + (k - (n - 1) / 2) * 0.16 + (rn.random() - 0.5) * 0.06
                a0, a1 = math.radians(72 + rn.random() * 8), math.radians(-5 - rn.random() * 30)
                L = 0.8 + 0.6 * rn.random()
                R.streak(None, (0, 0, -1), L, 0.08 + 0.06 * rn.random(), 'scale' if k % 2 == 0 else 'dust', 'limescale_streak',
                         n=3, out=out, bulge=lambda t, a0=a0, a1=a1, y=y: V((s * rr * math.cos(a0 + (a1 - a0) * t), y, ZB + rr * math.sin(a0 + (a1 - a0) * t))))
        for y in (2.6, 3.05, 3.5, 3.95, 4.35):                               # washout plugs on the firebox shoulders
            a0 = math.radians(60)
            R.streak(None, (0, 0, -1), 1.0, 0.07, 'scale', 'washout_streak', n=3, out=out,
                     bulge=lambda t, a0=a0, y=y: V((s * 0.975 * math.cos(a0 * (1 - t)), y, ZB + (RB + 0.02) * math.sin(a0 * (1 - t)))) if t < 0.99 else V((s * 0.975, y, ZB - 0.25)))
        RP('wear', box, (s * 1.54, -0.6, 1.643), (0.03, 10.1, 0.008), name='running_board_edge_wear', lod='drop')
        RP('wear', box, (s * 1.555, -0.6, 1.6), (0.012, 10.1, 0.05), name='running_board_edge_wear', lod='drop')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('loco_br52', var, pal(), seed=52, sooty=0.8)
    R.SHEEN.add('boiler')                                   # oily boiler cladding vs matt cab/tender (value break)
    running_gear()
    frames()
    cylinders()
    rods()
    boiler(burnt)
    cab(burnt)
    fittings(burnt)
    streaks(var)
    if var == 'winter':
        R.snow_cover(min_z=0.3, cover=0.3, min_area=0.3, skip=('boiler', 'smokebox', 'firebox', 'running_board', 'wheel', 'rod', 'lamp', 'handrail', 'pipe', 'plug', 'band', 'snow', 'icicle', 'glass', 'lens'))
        R.snow_cap_cyl(-3.8, 2.3, ZB, RB + 0.016, 0.8, 0.07, 6, 10, name='snow_boiler')
        R.snow_cap_cyl(-5.3, -3.8, ZB, RB + 0.055, 0.7, 0.06, 6, 3, name='snow_smokebox')
        R.snow_cap_cyl(2.3, 4.5, ZB, 0.97, 0.7, 0.06, 6, 4, name='snow_firebox')
        for s in (-1, 1):
            R.snow_heap(min(s * 1.08, s * 1.52), max(s * 1.08, s * 1.52), -5.6, 4.4, lambda x, y: 1.64, step=0.45, name='snow_running_board', lift=0.02)
        for s in (-1, 1):                                    # icicles under the running boards, cab roof, buffer beam
            R.icicles((s * 1.55, -5.6, 1.45), (s * 1.55, 4.4, 1.45), 12)
            R.icicles((s * 1.55, 4.5, 3.52), (s * 1.55, 6.3, 3.52), 9, (0.08, 0.35))
        R.icicles((-0.3, -5.6, 4.0), (0.3, -5.6, 4.0), 4, (0.05, 0.14))
    if burnt:
        # crushed cab (roof driven down and toward the left, sides buckled in), sagging running boards,
        # bent boiler handrails
        def crush(v):
            if v.y > 4.4 and v.z > 2.55:
                t = min(1.0, (v.z - 2.55) / 1.7)
                v.z -= t * (0.35 + 0.28 * (1.5 - v.x) / 3.0) + 0.1 * t * math.sin(v.y * 3.0)
                v.x *= 1 - 0.1 * t
                v.x -= 0.12 * t
            return v
        R.deform(('cab_', 'roof_', 'spectacle', 'lookout', 'rain_strip'), crush)

        def sag(v):
            if -5.7 < v.y < 4.6:
                k = math.sin(math.pi * (v.y + 5.7) / 10.3)
                v.z -= k * (0.24 if v.x < 0 else 0.1)
                v.x += (0.05 * k if v.x > 0 else -0.08 * k)
            return v
        R.deform(('running_board', 'valance', 'rb_bracket', 'air_reservoir', 'reservoir_strap'), sag)

        def bend(v):
            if v.z > 3.0 and v.y < 2.3:
                v.z += 0.12 * math.sin(v.y * 1.7)
                v.x *= 1 + 0.06 * math.sin(v.y * 2.3)
            return v
        R.deform('handrail', bend)
        VH.emitter('smoke', (0, 0, ZB + 1.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('steam_leak', (-0.9, -1.0, ZB + 0.3), (-1, 0, 0.3), when='destroyed', note='blown boiler barrel')
        # wreck stays ON the rails: burnt-out springs let the sprung mass slump 6 cm and list 3 deg to the right (-X, the
        # blown side); wheelsets, Bissel, coupling rods, axleboxes and brake blocks keep the treads on the rail heads
        piv = Matrix.Translation((0, 0, RD))
        R.wreck_pose(Matrix.Translation((0.0, 0, -0.06)) @ piv @ Matrix.Rotation(math.radians(-3), 4, 'Y') @ piv.inverted(),
                     unsprung=('ws', 'bissel', 'rod_c', 'rod_m'))
    dims = {'length_over_buffers_loco': 13.1, 'length_loco_plus_tender': 22.975, 'wheelbase': 9.2, 'driver_d': 1.4,
            'leading_d': 0.85, 'width': 3.1, 'height': 4.55, 'boiler_axis': ZB, 'cylinders_mm': [600, 660]}
    R.finalize(out_root, 'loco_br52', 'locomotive', dims, var, ALL, 'DR Baureihe 52 Kriegslok 2-10-0 (1\'E h2)',
               extra={'mass_t': 84.0, 'vmax_kmh': 80, 'tender': 'tender_t30', 'driving_axle': 'ws3',
                      'rod_notes': 'rods: ws1..ws5 share one crank angle; left side (+X, rod_*_l) at phase, right side (-X, rod_*_r) leads by 90 deg',
                      'drive': 'right', 'handedness': 'glTF +X = loco left (fireman: injector, feed pump, turbo-generator); -X = loco right (driver, air pump, reach rod)'}, ao_dist=1.0)


if __name__ == '__main__':
    R.run(main, ALL)
