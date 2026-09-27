# French provincial 2-axle motor tram (motrice, c.1910-30, metre gauge) for M15 Compiegne: saloon with clerestory,
# enclosed vestibules, green/cream livery, lyre-bow pantograph ("archet"). blender ... --python tram_fr.py -- green|burnt|all
# Dims: 9.0 m over fenders, body 2.1 m wide, wheelbase 2.8 m, wheels 0.8 m, floor 0.92 m, roof 3.25 m, bow raised to 5.5 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['green', 'burnt']
LS, LV, WB = 5.6, 1.45, 2.1        # saloon length, vestibule length, width
HX = WB / 2
ZF, ZW0, ZW1, ZE, ZR = 0.92, 1.55, 2.66, 2.9, 3.12   # tall saloon windows over a low green dado
YV = LS / 2 + LV                   # vestibule nose
WINS = [-2.15, -1.29, -0.43, 0.43, 1.29, 2.15]


def pal():
    return {'green': (44, 78, 52), 'cream': (196, 184, 150), 'frame': (30, 30, 29), 'dark': (32, 32, 32), 'roof': (60, 58, 54),
            'wheel': (36, 34, 33), 'red': (120, 30, 24), 'white': (200, 196, 186), 'buffer': (30, 30, 29), 'gold': (160, 130, 60),
            'keep_int': (92, 64, 40), 'sash': (96, 62, 36), 'number': (230, 226, 214), 'keep_tray': (78, 60, 44)}


def nose_poly(z, inset=0.0):
    """Plan outline of the car body (rounded vestibule ends) at height z; returns list of (x, y)."""
    pts = []
    for f in (-1, 1):
        for i in range(7):
            a = math.pi * i / 6
            x = (HX - inset) * math.cos(a) * (1 if f < 0 else -1)
            y = f * (LS / 2 + (LV - 0.1) * 0.55 + (0.45 * LV) * math.sin(a)) - f * inset
            pts.append((x, y))
    return pts[::-1]                  # CCW seen from above


def body(burnt):
    rn = C.rng()
    # dash panels (lower body, green) as a prism of the outline, waist to floor
    bm = bmesh.new()
    C.prism_bm(bm, nose_poly(0), ZF - 0.25, ZW0)
    rp_(bm, 'green', 'lower_body')
    RP('cream', box, (0, 0, ZW0 + 0.03), (WB + 0.04, LS, 0.06), name='waist_rail')
    RP('dark', box, (0, 0, ZF - 0.22), (WB + 0.06, LS + 2 * (LV - 0.1) * 0.55, 0.06), name='rubbing_strip')   # straight sides only
    # saloon upper: window piers + glass, letterboard, clerestory
    for s in (-1, 1):
        x = s * HX
        edges = [-LS / 2] + sum([[w - 0.38, w + 0.38] for w in WINS], []) + [LS / 2]
        for a, b in zip(edges[0::2], edges[1::2]):
            RP('cream', box, (x, (a + b) / 2, (ZW0 + ZW1) / 2), (0.04, b - a, ZW1 - ZW0), name='pier')
        for w in WINS:                                        # varnished wooden window frames: drop sash + top light
            if not burnt:
                RP('glass', box, (x - s * 0.01, w, (ZW0 + ZW1) / 2), (0.01, 0.76, ZW1 - ZW0), name='window_glass', lod='drop')
            if not burnt or w > 0:
                for dz in (ZW0 + 0.03, ZW1 - 0.3, ZW1 - 0.03):
                    RP('sash', box, (x + s * 0.005, w, dz), (0.035, 0.76, 0.05), name='window_sash')
                for dy in (-0.36, 0.36):
                    RP('sash', box, (x + s * 0.005, w + dy, (ZW0 + ZW1) / 2), (0.035, 0.05, ZW1 - ZW0), name='window_sash')
                RP('sash', box, (x + s * 0.008, w, ZW1 - 0.16), (0.02, 0.03, 0.26), name='toplight_bar', lod='drop')
            RP('cream', box, (x + s * 0.02, w, ZW0 - 0.03), (0.05, 0.84, 0.05), name='window_sill')
        for yy in (-1.68, 0.0, 1.68):                          # dado panel mouldings (lined-out panels)
            RP('gold', box, (x + s * 0.022, yy, (ZF + ZW0) / 2 - 0.08), (0.01, 1.5, 0.02), name='lining', lod='drop')
        RP('cream', box, (x, 0, (ZW1 + ZE) / 2), (0.04, LS, ZE - ZW1), name='letterboard')
        if not burnt:
            R.label_block((x + s * 0.025, 0, (ZW1 + ZE) / 2), (s, 0, 0), 2.2, 0.1, 1, 'gold')       # 'TRAMWAYS DE COMPIEGNE'
            R.label_block((x + s * 0.02, 0.0, ZF + 0.5), (s, 0, 0), 0.28, 0.24, 1, 'gold')           # fleet number
    # vestibules: 3-pane windscreen around the rounded nose, side entrance openings (right side of travel = both sides)
    for f in (-1, 1):
        for k in range(5):
            a0, a1 = math.pi * k / 5, math.pi * (k + 1) / 5
            p0 = V((HX * math.cos(a0), f * (LS / 2 + 0.55 * LV + 0.45 * LV * math.sin(a0)), 0))
            p1 = V((HX * math.cos(a1), f * (LS / 2 + 0.55 * LV + 0.45 * LV * math.sin(a1)), 0))
            if k in (0, 4):
                continue                              # side entrances (open)
            m = (p0 + p1) / 2
            L = (p1 - p0).length
            rz = math.atan2(p1.y - p0.y, p1.x - p0.x)
            if not burnt:
                RP('glass', box, (m.x, m.y, (ZW0 + ZW1) / 2), (L, 0.01, ZW1 - ZW0), rot_z=rz, name='windscreen', lod='drop')
            for dz in (ZW0 + 0.03, ZW1 - 0.03, ZW0 + 0.7):          # windscreen sash rails (drop sash in the middle)
                RP('sash', box, (m.x, m.y + f * 0.012, dz), (L, 0.04, 0.05), rot_z=rz, name='windscreen_sash')
            for p in (p0, p1):
                RP('cream', cyl, (p.x, p.y, ZW0), (p.x, p.y, ZE), 0.04, 6, name='vestibule_post', bisect=False)
        RP('cream', box, (0, f * (LS / 2 + 0.02), (ZW0 + ZE) / 2), (WB, 0.05, ZE - ZW0), name='bulkhead')
        nd = 'door_' + ('f' if f < 0 else 'b')
        RP('cream', box, (0, f * (LS / 2 + 0.05), (ZF + ZE) / 2 - 0.1), (0.62, 0.04, ZE - ZF - 0.3), name='sliding_door', node=nd, pivot=(0, f * (LS / 2 + 0.05), ZF))
        VH.moving(nd, 'door_slide', (0, f * (LS / 2 + 0.05), ZF), (1, 0, 0), limits=(0, 0.6), note='bulkhead door slides sideways')
        for s in (-1, 1):
            yy = f * (LS / 2 + 0.45)
            RP('dark', box, (s * (HX - 0.05), yy, ZF - 0.45), (0.25, 0.6, 0.03), name='entrance_step')
            for dy in (-0.26, 0.26):                         # step hangers: flat bars bolted to the platform bearer
                RP('dark', box, (s * (HX - 0.1), yy + dy, ZF - 0.24), (0.05, 0.03, 0.42), name='step_hanger', bisect=False)
            RP('dark', box, (s * (HX - 0.12), yy, ZF - 0.05), (0.1, 0.7, 0.08), name='step_bearer', bisect=False, lod='drop')
            R.handrail([(s * (HX + 0.02), f * (LS / 2 + 0.12), ZF - 0.2), (s * (HX + 0.02), f * (LS / 2 + 0.12), ZW1)])
            VH.socket('entrance_%s_%s' % ('f' if f < 0 else 'b', 'r' if s < 0 else 'l'), (s * (HX + 0.5), yy, 0.0), (-s, 0, 0), pose='climb_in')
        # controller + handbrake column (driver's position), headlight on the dash, destination box on the canopy
        yc = f * (YV - 0.45)
        xc = -f * 0.4                                       # controller on the wattman's left, handbrake on his right
        yk = f * (YV - 0.62)                                  # controller: slim drum below the windscreen sill line
        RP('dark', box, (xc, yk, ZF + 0.42), (0.22, 0.2, 0.84), name='controller', bisect=False)
        RP('gold', cyl, (xc, yk, ZF + 0.84), (xc, yk, ZF + 0.87), 0.1, 10, name='controller_top', bisect=False, lod='drop')
        RP('gold', beam, (xc, yk, ZF + 0.9), (xc + 0.12, yk + f * 0.08, ZF + 0.92), 0.03, 0.02, name='controller_handle', bisect=False, lod='drop')
        RP('dark', cyl, (-xc, yc, ZF), (-xc, yc, ZF + 1.0), 0.03, 6, name='brake_column', bisect=False)
        RP('dark', VH.ring_torus, (-xc, yc, ZF + 1.02), 0.12, 0.012, (0, 0, 1), 12, 4, name='brake_wheel', lod='drop')
        VH.socket('driver_' + ('f' if f < 0 else 'b'), (0.0, yc + f * -0.2, ZF), (0, f, 0), pose='stand', note='wattman')
        R.lamp((0, f * (YV + 0.1), ZF + 0.2), (0, f, 0), 'headlight_' + ('f' if f < 0 else 'b'), r=0.1)   # on the dash, below the windscreen
        RP('dark', box, (0, f * (YV - 0.3), ZE + 0.16), (0.9, 0.1, 0.22), name='destination_box')
        if not burnt:
            RP('white', box, (0, f * (YV - 0.24), ZE + 0.16), (0.8, 0.01, 0.16), name='destination_blind', lod='drop')
            R.label_block((0, f * (YV - 0.235), ZE + 0.16), (0, f, 0), 0.62, 0.1, 1, 'dark')
        # route-number board on a stalk above the canopy (white square, black route number)
        yb = f * (YV - 0.55)
        RP('dark', box, (0, yb, ZR + 0.3), (0.05, 0.05, 0.3), name='route_board_stalk')
        RP('dark', box, (0, yb, ZR + 0.62), (0.5, 0.06, 0.42), name='route_board')
        if not burnt:
            RP('number', box, (0, yb + f * 0.035, ZR + 0.62), (0.44, 0.01, 0.36), name='route_board_face')
            for dx in (-0.1, 0.1):
                RP('dark', box, (dx, yb + f * 0.042, ZR + 0.62), (0.08, 0.005, 0.24), name='route_number', lod='drop')
        # lifeguard (chasse-corps): hinged gate bar + slatted tray, low ahead of the wheels
        RP('dark', box, (0, f * (YV + 0.02), 0.34), (1.7, 0.05, 0.06), name='lifeguard_gate')
        for dx in (-0.8, -0.4, 0.0, 0.4, 0.8):
            RP('dark', beam, (dx, f * (YV + 0.02), 0.34), (dx, f * (YV - 0.12), 0.1), 0.04, 0.02, name='lifeguard_hanger', bisect=False, lod='drop')
        for k in range(5):
            RP('keep_tray', box, (0, f * (YV - 0.35 - 0.12 * k), 0.1 + 0.015 * k), (1.6, 0.07, 0.025), name='lifeguard_slat')
        RP('dark', box, (0, f * (YV - 0.6), 0.1), (1.66, 0.7, 0.03), name='lifeguard_frame', lod='drop')
        RP('dark', box, (0, f * (YV - 0.05), ZF - 0.3), (0.3, 0.3, 0.2), name='buffer_block')
        RP('dark', cyl, (0, f * (YV - 0.05), ZF - 0.3), (0, f * (YV + 0.25), ZF - 0.3), 0.08, 8, name='central_buffer', bisect=False)
        VH.socket('coupler_' + ('front' if f < 0 else 'rear'), (0, f * (YV + 0.25), ZF - 0.3), (0, f, 0), note='central buffer (trailer)')
    # floor + longitudinal benches inside
    bm = bmesh.new()                                       # floor follows the rounded vestibule outline (no corners)
    poly = nose_poly(ZF, 0.04)
    lo = [bm.verts.new(V((x, y, ZF - 0.02))) for x, y in poly]
    hi = [bm.verts.new(V((x, y, ZF + 0.02))) for x, y in poly]
    bm.faces.new(hi)
    bm.faces.new(list(reversed(lo)))
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    rp_(bm, 'planks', 'floor')
    if not burnt:
        for s in (-1, 1):
            RP('keep_int', box, (s * 0.8, 0, ZF + 0.45), (0.42, LS - 0.2, 0.08), name='bench', lod='drop')
            RP('keep_int', box, (s * 0.99, 0, ZF + 0.75), (0.06, LS - 0.2, 0.5), name='bench_back', lod='drop')
        for i, y in enumerate((-1.5, 0.0, 1.5)):
            VH.socket('seat_%d' % i, (0.8, y, ZF + 0.45), (-1, 0, 0), pose='sit')
        VH.socket('hide', (0, 0, ZF), (0, -1, 0), note='M15: hide inside the tram', capacity=6)


def truck():
    """Brill 21E-style rigid truck: outside side frames with the axleboxes, coil springs, two nose-suspended motors."""
    g = R.GAUGE[0]
    x0 = g / 2 + 0.0675 * g / 1.435 + 0.12
    for i, y in enumerate((-1.4, 1.4)):
        R.wheelset('ws%d' % i, y, 0.4, 'spoked', spokes=10, segs=18, key='wheel', axle_key='dark')
        RP('dark', cyl, (-0.25, y + (0.3 if y < 0 else -0.3), 0.4), (0.25, y + (0.3 if y < 0 else -0.3), 0.4), 0.26, 10, name='traction_motor', bisect=False)
        VH.emitter('rail_dust', (0, y, 0.05), (0, 0, 1))
        VH.emitter('sparks', (x0 - 0.1, y, 0.02), (0, 0, 1), when='braking / rail joints (night)')
    for s in (-1, 1):
        bm = bmesh.new()
        prof = [(-2.1, 0.55), (2.1, 0.55), (2.1, 0.75), (1.65, 0.75), (1.4, 0.62), (1.15, 0.75), (-1.15, 0.75), (-1.4, 0.62), (-1.65, 0.75), (-2.1, 0.75)]
        VH.side_prism(bm, prof, s * x0 - 0.03, s * x0 + 0.03)
        rp_(bm, 'frame', 'truck_side')
        for y in (-1.4, 1.4):
            RP('frame', VH.bevel_box, (s * x0, y, 0.42), (0.14, 0.26, 0.26), r=0.02, name='axlebox', bisect=False)
            for dy in (-0.55, 0.55):
                RP('dark', cyl, (s * x0, y + dy, 0.62), (s * x0, y + dy, ZF - 0.28), 0.07, 8, name='coil_spring', bisect=False, lod='drop')
        RP('frame', box, (s * x0, 0, 0.66), (0.1, 1.8, 0.1), name='truck_rail')
    RP('dark', box, (0, 0, ZF - 0.32), (WB - 0.3, 2 * YV - 1.6, 0.14), name='underframe')
    for f in (-1, 1):
        RP('dark', box, (0.7 * f, f * 2.2, 0.62), (0.3, 0.5, 0.3), name='sand_box', lod='drop')


def roof_and_bow(burnt):
    rn = C.rng()
    # main roof: shallow arch over saloon + vestibule canopies (rounded plan), clerestory lantern with vents
    bm = bmesh.new()
    rings = []
    for y in [-(YV - 0.05) + (2 * YV - 0.1) * k / 10 for k in range(11)]:
        t = abs(y) - (LS / 2 + 0.55 * LV)
        hw = HX + 0.05 if t < 0 else (HX + 0.05) * math.sqrt(max(0.05, 1 - (t / (0.45 * LV + 0.05)) ** 2))
        rings.append([V((-hw * math.cos(math.pi * i / 8), y, ZE + (ZR - ZE) * math.sin(math.pi * i / 8))) for i in range(9)])
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    for a, b in zip(vs[:-1], vs[1:]):
        for i in range(8):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
    if burnt:
        dead = [f for f in bm.faces if abs(f.calc_center_median().y) < 1.8 and rn.random() < 0.7]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
    rp_(bm, 'felt' if not burnt else 'dark', 'roof', smooth=True)
    if not burnt:
        RP('roof', box, (0, 0, ZR + 0.14), (0.9, LS - 0.4, 0.28), name='clerestory')
        for s in (-1, 1):
            for k in range(8):
                RP('glass', box, (s * 0.455, -2.3 + k * 0.66, ZR + 0.14), (0.01, 0.5, 0.16), name='clerestory_light', lod='drop')
                RP('sash', box, (s * 0.46, -2.3 + k * 0.66 + 0.29, ZR + 0.14), (0.02, 0.06, 0.2), name='clerestory_post', lod='drop')
        RP('felt', box, (0, 0, ZR + 0.3), (1.1, LS - 0.2, 0.04), name='lantern_roof')
        for s in (-1, 1):                                  # roof boards (walkway) either side of the lantern
            RP('wood', box, (s * 0.72, -1.2, ZR + 0.06), (0.3, 2.4, 0.03), name='roof_boards')
        for s in (-1, 1):                                  # starting resistor grids: slatted cast-iron grid boxes
            c = V((s * 0.72, 1.6, ZR + 0.14))
            RP('dark', box, tuple(c), (0.42, 1.3, 0.04), name='resistor_frame')
            RP('dark', box, tuple(c + V((0, 0, 0.13))), (0.42, 1.3, 0.03), name='resistor_frame')
            for k in range(9):
                RP('rust', box, tuple(c + V((0, -0.58 + k * 0.145, 0.07))), (0.38, 0.05, 0.1), name='resistor_grid')
            for dy in (-0.64, 0.64):
                RP('dark', box, tuple(c + V((0, dy, 0.07))), (0.44, 0.03, 0.16), name='resistor_end', lod='drop')
        RP('dark', cyl, (0.3, -2.3, ZR + 0.05), (0.3, -2.3, ZR + 0.3), 0.06, 8, name='lightning_arrester', bisect=False, lod='drop')
    # trolley pole (perche): swivel spring base on the roof, 4.6 m pole trailing back up to the wire, trolley head +
    # wheel, rope down to the retriever on the rear dash. node trolley_pole: yaw about Z (base), pitch about X.
    bp = V((0, 0.9, ZR + 0.4))
    kwb = dict(node='trolley_pole', pivot=tuple(bp))
    RP('dark', box, tuple(bp - V((0, 0, 0.18))), (0.7, 0.9, 0.08), name='trolley_platform', bisect=False)
    RP('dark', cyl, bp - V((0, 0, 0.14)), bp + V((0, 0, 0.02)), 0.2, 12, name='trolley_base', bisect=False, **kwb)
    for s in (-1, 1):
        RP('dark', cyl, bp + V((s * 0.12, -0.3, 0.02)), bp + V((s * 0.12, 0.25, 0.02)), 0.05, 8, name='trolley_spring', bisect=False, **kwb)
    RP('dark', cyl, bp + V((s * 0.0, 0.28, 0.0)), bp + V((0, 0.28, 0.12)), 0.06, 8, name='trolley_harp_pivot', bisect=False, lod='drop', **kwb)
    VH.moving('trolley_pole', 'trolley_pole', tuple(bp), (1, 0, 0), limits=(-18, 0), yaw_limits=(-30, 30),
              note='pitch about local X: 0 = raised (head on the 5.5 m wire, trailing back), -18 = hooked down on the roof; swivels about Z on curves')
    if not burnt:
        ang = math.asin((5.5 - bp.z) / 4.6)                # pole trails toward +Y (rear), up to the wire
        top = bp + V((0, math.cos(ang) * 4.6, 5.5 - bp.z))
        RP('dark', cyl, bp + V((0, 0.1, 0.05)), top, 0.04, 8, r1=0.022, name='trolley_pole', bisect=False, **kwb)
        RP('dark', box, tuple(top + V((0, 0.02, 0.05))), (0.08, 0.2, 0.12), name='trolley_harp', bisect=False, **kwb)
        RP('galv', cyl, top + V((-0.03, 0.02, 0.08)), top + V((0.03, 0.02, 0.08)), 0.06, 10, name='trolley_wheel', bisect=False, **kwb)
        bm = bmesh.new()                                   # retriever rope: pole head -> rear dash
        rp0, rp1 = top - V((0, 0.2, 0.05)), V((0, YV + 0.1, ZF + 0.53))
        for k in range(6):
            a, b = rp0.lerp(rp1, k / 6), rp0.lerp(rp1, (k + 1) / 6)
            a.z -= 0.15 * math.sin(math.pi * k / 6); b.z -= 0.15 * math.sin(math.pi * (k + 1) / 6)
            C.cyl_bm(bm, a, b, 0.008, 4, caps=False)
        rp_(bm, 'rope', 'retriever_rope', lod='drop', bisect=False)
        VH.emitter('arc_flash', tuple(top + V((0, 0, 0.1))), (0, 0, 1), when='night / wire joints', note='blue sparks at the contact wire')
        VH.socket('wire_contact', tuple(top + V((0, 0, 0.14))), (0, 0, 1), note='overhead contact wire height 5.5 m above the rail')
    for f in (-1, 1):                                      # trolley retrievers (spring drums) on both dashes
        # spring-drum retriever on the dash panel BELOW the windscreen (above the headlamp), on a bracket
        RP('dark', cyl, (0.0, f * (YV + 0.02), ZF + 0.53), (0.0, f * (YV + 0.14), ZF + 0.53), 0.1, 10, name='retriever', bisect=False)
        RP('dark', box, (0.0, f * (YV - 0.01), ZF + 0.53), (0.16, 0.08, 0.06), name='retriever_bracket', bisect=False, lod='drop')


def main(var, out_root):
    burnt = var == 'burnt'
    R.setup('tram_fr', var, pal(), seed=15, gauge=1.0)
    truck()
    body(burnt)
    roof_and_bow(burnt)
    if burnt:
        VH.emitter('smoke', (0, 0, ZR), (0, 0, 1), kind2='wreck_smoulder')
        VH.emitter('fire', (0, 1.0, ZF + 0.5), (0, 0, 1), when='destroyed', note='M15 tram vs tanker "accident"')
        pv = Matrix.Translation((0, 0, 0.6))                # body slumps on the burnt truck springs, wheels stay on the rails
        R.wreck_pose(Matrix.Translation((0, 0, -0.04)) @ pv @ Matrix.Rotation(math.radians(-2.5), 4, 'Y') @ pv.inverted(),
                     unsprung=('ws', 'truck'), names=('axlebox', 'brake_block', 'brake_hanger', 'truck_', 'motor', 'lifeguard'))
    dims = {'length_over_fenders': round(2 * YV + 0.1, 3), 'width': WB, 'wheelbase': 2.8, 'wheel_d': 0.8, 'floor': ZF,
            'roof': ZR + 0.34, 'trolley_wire': 5.5, 'gauge': 1.0}
    R.finalize(out_root, 'tram_fr', 'tram', dims, var, ALL, 'French 2-axle motor tram (motrice), metre gauge, trolley pole',
               extra={'side': 'civilian', 'seats': 20, 'standing': 16, 'hide_inside': True,
                      'collector_note': 'trolley pole (perche) with retriever = node trolley_pole (typical of French urban networks)'})


if __name__ == '__main__':
    R.run(main, ALL)
