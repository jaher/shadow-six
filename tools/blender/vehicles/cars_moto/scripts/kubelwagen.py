# VW Kubelwagen Typ 82 (1940-45). Blender 4.2: blender -b --factory-startup --python kubelwagen.py -- <variant>[,<variant>...]
# variants: grey | dak | winter | burnt | grey_top | dak_top (canvas top up).
# Real dims: L 3.74 m, W 1.60 m, H 1.11 m (screen folded) / 1.35 m screen up / 1.65 m top up, wheelbase 2.40 m,
# track 1.356/1.360 m, ground clearance 0.29 m, tyres 5.25-16 (D ~0.67 m). Left-hand drive, 4 doors, rear air-cooled engine.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['grey', 'dak', 'winter', 'burnt', 'grey_top', 'dak_top']
YF, YR, XW = -1.20, 1.20, 0.68           # axles, wheel centre x
RT, RIM, TW = 0.335, 0.205, 0.14         # tyre radius, rim radius, tyre width
BW, BELT = 0.70, 0.98                    # body half width, belt line


CROWN, CROWN_W, RIDGE = 0.028, 0.62, 0.028


def crown_nose(bm):
    """rw2: the Typ 82 bonnet is crowned side to side and the pressed front apron has a central vertical ridge.
    Add vertex columns across the width (bisect), then lift the up-facing skin by a parabolic crown and push the
    forward-facing apron out into a V ridge along the centreline."""
    for x in (-0.52, -0.38, -0.24, -0.12, 0.0, 0.12, 0.24, 0.38, 0.52):
        g = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=g, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    bm.normal_update()
    for v in bm.verts:
        n = v.normal
        wc = VH._sm(0.35, 0.85, n.z)
        wr = VH._sm(0.35, 0.8, -n.y) * (1 - wc)
        v.co.z += wc * CROWN * max(0.0, 1 - (v.co.x / CROWN_W) ** 2)
        v.co.y -= wr * RIDGE * max(0.0, 1 - abs(v.co.x) / 0.50)


def build(var):
    VH.setup('kubelwagen', var, seed=82)
    burnt = var == 'burnt'
    top = var.endswith('_top')
    # ---------------------------------------------------------------- nose (luggage + fuel tank), spare wheel on the bonnet
    bm = bmesh.new()
    # 'boat bow': the bonnet falls continuously to a crease, then the front apron is raked ~45 deg down to the bumper
    VH.body_loft(bm, [(-1.80, 0.53, 0.45, 0.52, 0.03), (-1.73, 0.56, 0.45, 0.585, 0.05), (-1.62, 0.595, 0.47, 0.69, 0.06),
                      (-1.52, 0.62, 0.52, 0.775, 0.07), (-1.40, 0.645, 0.62, 0.81, 0.07),
                      (-0.95, 0.70, 0.78, 0.93, 0.06), (-0.60, 0.70, 0.78, 0.985, 0.05)], n=2)
    crown_nose(bm)
    VH.vp(bm, 'paint', 'nose', smooth=True)
    bm = bmesh.new()
    VH.body_loft(bm, [(-1.77, 0.50, 0.44, 0.52, 0.02), (-1.60, 0.52, 0.40, 0.68, 0.02), (-0.60, 0.52, 0.40, 0.79, 0.02)], n=1)
    VH.vp(bm, 'paint', 'nose_low')
    # bonnet seam + handles, front panel ribs
    xs = [-0.60 + 0.1 * i for i in range(13)]                     # bonnet/apron crease, following the crown
    for x0, x1 in zip(xs[:-1], xs[1:]):
        P('paint_under', beam, (x0, -1.527, 0.776 + CROWN * max(0.0, 1 - (x0 / CROWN_W) ** 2)),
          (x1, -1.527, 0.776 + CROWN * max(0.0, 1 - (x1 / CROWN_W) ** 2)), 0.012, 0.01, name='seam')
    P('black', box, (0, -1.70, 0.63), (0.10, 0.02, 0.03), name='bonnet_catch')
    # spare wheel lying on the bonnet slope, in its recess, with a clamp
    ang = math.atan2(0.93 - 0.775, 0.57)
    bm = bmesh.new()
    VH.tyre_bm(bm, V((0, 0, 0)), RT, TW, RIM, 48, 0.014)
    xf = Matrix.Translation((0, -1.20, 0.775 + 0.32 * math.tan(ang) + TW * 0.5 + 0.005 + 0.02)) @ Matrix.Rotation(ang, 4, 'X') @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    VH.xf_bm(bm, xf)
    if not burnt:
        VH.vp(bm, 'tyre', 'spare_tyre', smooth=True, uv='keep')
    bm = bmesh.new()
    VH.rim_bm(bm, V((0, 0, 0)), RIM, TW, -1, segs=28)
    VH.xf_bm(bm, xf)
    VH.vp(bm, 'rust' if burnt else 'paint', 'spare_rim')
    P('paint_under', beam, (0, -1.20, 0.88), (0, -1.20, 0.88 + TW + 0.03), 0.03, name='spare_clamp')
    # ---------------------------------------------------------------- tub: floor, tunnel, firewall, dash
    P('paint_under', box, (0, 0.15, 0.42), (1.38, 1.52, 0.04), name='floor')
    P('paint_under', box, (0, 0.10, 0.49), (0.20, 1.40, 0.12), name='tunnel')
    P('paint', box, (0, -0.60, 0.79), (1.38, 0.03, 0.38), name='firewall')
    P('paint', box, (0, -0.55, 0.93), (1.36, 0.10, 0.10), name='dash')
    for x in (-0.36, -0.22, 0.15):
        P('black', cyl, (x, -0.50, 0.93), (x, -0.495, 0.93), 0.035, 10, name='gauge')
        P('lens', cyl, (x, -0.495, 0.93), (x, -0.49, 0.93), 0.03, 10, name='gauge_glass')
    VH.steering_wheel('steering_wheel', (-0.33, -0.33, 0.95), (0, 0.55, 0.83))
    P('black', cyl, (-0.33, -0.56, 0.72), (-0.33, -0.33, 0.95), 0.02, 6, name='column')
    return burnt, top


def sides(burnt):
    # side panels: front section (with arch) and rear quarter (with arch), doors separate nodes
    for sx in (-1, 1):
        xo, xi = sx * (BW + 0.012), sx * (BW - 0.008)
        front = [(-1.80, 0.46), (-1.64, 0.46)] + VH.arc_path(YF, RT, 0.44, 172, 8, 12)[1:-1] + [(-0.775, 0.50), (-0.60, 0.44),
                 (-0.60, 0.985), (-0.95, 0.93), (-1.40, 0.81), (-1.52, 0.775), (-1.62, 0.69), (-1.73, 0.585), (-1.80, 0.52)]
        bm = bmesh.new()
        VH.side_prism(bm, front, xi, xo)
        VH.vp(bm, 'paint', 'side_front')
        rear = [(0.72, 0.40), (0.765, 0.40)] + VH.arc_path(YR, RT, 0.44, 172, 8, 12)[1:-1] + [(1.635, 0.40), (1.79, 0.46),
                (1.79, 0.84), (1.62, 0.90), (1.25, 0.98), (0.72, 0.985)]
        bm = bmesh.new()
        VH.side_prism(bm, rear, xi, xo)
        VH.vp(bm, 'paint', 'side_rear')
        # sill between the wheel arches (under the doors) and the B-pillar
        P('paint', box, (sx * BW, 0.06, 0.42), (0.03, 1.34, 0.05), name='sill')
        P('paint', box, (sx * BW, 0.125, 0.70), (0.028, 0.05, 0.58), name='bpillar')
        # doors: pressed panel with three horizontal stiffening swages, hinge at the front edge
        for nm, y0, y1 in (('door_f', -0.595, 0.095), ('door_r', 0.155, 0.715)):
            node = '%s%s' % (nm, 'l' if sx < 0 else 'r')
            piv = (sx * (BW + 0.02), y0, 0.70)
            bm = bmesh.new()
            VH.bevel_box(bm, (sx * BW, (y0 + y1) / 2, 0.705), (0.025, y1 - y0 - 0.008, 0.54), 0.008, 1)
            VH.vp(bm, 'paint', node + '_panel', node=node, pivot=piv)
            for z in (0.56, 0.70, 0.84):
                P('paint', beam, (sx * (BW + 0.014), y0 + 0.07, z), (sx * (BW + 0.014), y1 - 0.07, z), 0.012, 0.03, name='swage', node=node, pivot=piv)
            P('paint_under', box, (sx * (BW - 0.014), (y0 + y1) / 2, 0.705), (0.006, y1 - y0 - 0.06, 0.48), name='door_inner', node=node, pivot=piv)
            P('black', box, (sx * (BW + 0.02), y1 - 0.12, 0.90), (0.02, 0.10, 0.02), name='handle', node=node, pivot=piv)
            P('paint', beam, (sx * (BW + 0.004), y0 + 0.004, 0.978), (sx * (BW + 0.004), y1 - 0.004, 0.978), 0.035, 0.02, name='door_lip', node=node, pivot=piv)
            for z in (0.52, 0.88):
                P('paint_under', cyl, (sx * (BW + 0.018), y0 - 0.005, z - 0.04), (sx * (BW + 0.018), y0 - 0.005, z + 0.04), 0.012, 6, name='hinge')
            ang = (-1 if sx > 0 else 1) * (0 if not (burnt and node == 'door_fr') else 38)
            VH.moving(node, 'door', piv, (0, 0, 1), limits=(0, 75) if sx < 0 else (-75, 0), hinge='front')
            if ang:
                pass
        # fenders: crowned mudguards following the arch, lip turned down
        prof = [(0.52 - BW, 0.0), (0.0, 0.006), (0.055, 0.0), (0.09, -0.03), (0.098, -0.075), (0.086, -0.075), (0.08, -0.034),
                (0.05, -0.012), (0.52 - BW, -0.012)]
        for cy, a0, a1 in ((YF, 162, 16), (YR, 164, 18)):
            bm = bmesh.new()
            VH.sweep_bm(bm, VH.arc_path(cy, RT, 0.43, a0, a1, 16), prof, x0=sx * BW, mirror=sx < 0, center=(cy, RT))
            VH.vp(bm, 'paint', 'fender', grime=1.0, smooth=True)


def rear(burnt):
    # engine compartment: upper deck full width above the wheels, narrow lower box between them
    bm = bmesh.new()
    VH.body_loft(bm, [(0.72, 0.70, 0.78, 0.985, 0.04), (1.25, 0.70, 0.78, 0.98, 0.05), (1.62, 0.685, 0.78, 0.90, 0.06),
                      (1.79, 0.665, 0.78, 0.84, 0.05)], n=2)
    VH.vp(bm, 'paint', 'deck')
    bm = bmesh.new()
    VH.body_loft(bm, [(0.72, 0.52, 0.40, 0.79, 0.02), (1.62, 0.52, 0.40, 0.79, 0.02), (1.79, 0.50, 0.46, 0.79, 0.02)], n=1)
    VH.vp(bm, 'paint', 'deck_low')
    # engine lid outline + cooling-air louvres (two banks of pressed slats on the rear deck)
    for sx in (-1, 1):
        for i in range(7):
            y = 1.31 + i * 0.05
            z = 0.98 - (y - 1.25) * (0.08 / 0.45) + 0.008
            P('paint', beam, (sx * 0.12, y, z), (sx * 0.52, y, z), 0.028, 0.012, name='louvre')
    P('paint_under', beam, (-0.58, 1.27, 0.985), (0.58, 1.27, 0.985), 0.012, 0.012, name='lid_seam')
    P('black', box, (0.0, 1.795, 0.72), (0.14, 0.03, 0.03), name='lid_handle')
    # rear seat backrest bulkhead
    P('paint', box, (0, 0.73, 0.73), (1.38, 0.03, 0.52), name='bulkhead')


def fittings(burnt, top):
    # bumpers: pressed channel bars on brackets
    for y, s in ((-1.84, -1), (1.84, 1)):                         # bumper faces at +-1.865 -> overall 3.73 m (real 3.74)
        P('paint', VH.bevel_box, (0, y, 0.45), (1.30, 0.05, 0.10), 0.012, 1, name='bumper')
        for x in (-0.42, 0.42):
            P('paint_under', box, (x, y - s * 0.06, 0.45), (0.05, 0.10, 0.06), name='bumper_arm')
    for x in (-0.35, 0.35):
        P('paint_under', cyl, (x, -1.84, 0.37), (x, -1.84, 0.40), 0.022, 8, name='tow_eye')
    # lamps: fender-top headlights with blackout covers, Notek on the left wing, tail lights + Notek convoy light
    for sx in (-1, 1):
        P('paint', cyl, (sx * 0.62, -1.53, 0.745), (sx * 0.62, -1.53, 0.80), 0.03, 8, name='hl_stalk')
        VH.headlight('headlight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.62, -1.62, 0.86), 0.085, 0.13, cover=True)
        VH.taillight('taillight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.55, 1.765, 0.86), (0, 1, 0.3))
    VH.notek('notek', (-0.50, -1.66, 0.74))
    VH.light('convoy_light', (0, 1.80, 0.80), (0, 1, 0), True, kind='convoy')
    P('black', cyl, (0.34, -1.62, 0.70), (0.34, -1.67, 0.70), 0.045, 10, name='horn')
    P('paint_under', box, (0, -1.80, 0.555), (0.30, 0.03, 0.03), name='plate_bracket')
    VH.tac_number((0, -1.82, 0.56), (0, -1, 0), 0.46, 0.11)
    VH.tac_number((0.25, 1.797, 0.62), (0, 1, 0), 0.32, 0.16)
    if not burnt:
        VH.balkenkreuz((-0.30, 1.797, 0.64), (0, 1, 0), 0.20)          # small rear cross (common field practice)
    # exhaust silencer across the rear with twin tailpipes
    P('metal', cyl, (-0.45, 1.72, 0.50), (0.45, 1.72, 0.50), 0.07, 10, name='silencer')
    for x in (-0.3, 0.3):
        P('metal', cyl, (x, 1.72, 0.46), (x, 1.85, 0.44), 0.022, 8, name='tailpipe')
        VH.emitter('exhaust', (x, 1.86, 0.44), (0, 1, -0.1))
    # windscreen (folds forward onto the bonnet): tube frame + single flat pane + wiper
    ws = 'windscreen'
    piv = (0, -0.60, 0.99)
    fr = [(-0.67, -0.60, 0.99), (-0.67, -0.585, 1.36), (0.67, -0.585, 1.36), (0.67, -0.60, 0.99)]
    for a, b in zip(fr[:-1], fr[1:]):
        P('paint', beam, a, b, 0.022, 0.022, name='ws_frame', node=ws, pivot=piv)
    P('paint', beam, fr[0], fr[3], 0.022, 0.018, name='ws_frame', node=ws, pivot=piv)
    if not burnt:
        P('glass', box, (0, -0.592, 1.175), (1.30, 0.006, 0.34), name='ws_glass', node=ws, pivot=piv)
    P('black', beam, (-0.40, -0.62, 1.34), (-0.12, -0.62, 1.22), 0.012, 0.006, name='wiper', node=ws, pivot=piv)
    VH.moving(ws, 'toggle', piv, (1, 0, 0), limits=(-88, 0), note='fold flat forward onto the bonnet')
    for sx in (-1, 1):
        P('paint_under', cyl, (sx * 0.69, -0.62, 0.99), (sx * 0.69, -0.56, 0.99), 0.02, 6, name='ws_hinge')
    # seats: tube-framed front buckets, rear bench against the engine bulkhead
    for sx in (-1, 1):
        x = sx * 0.33
        P('paint_under', box, (x, -0.06, 0.52), (0.40, 0.40, 0.18), name='seat_base')
        P('seat', VH.bevel_box, (x, -0.08, 0.64), (0.44, 0.44, 0.08), 0.03, 2, name='seat_cushion')   # burnt: springs
        P('seat', VH.bevel_box, (x, 0.16, 0.88), (0.44, 0.07, 0.42), 0.03, 2, name='seat_back')
        P('paint_under', beam, (x - 0.21, 0.12, 0.62), (x - 0.21, 0.19, 1.10), 0.02, name='seat_frame')
        P('paint_under', beam, (x + 0.21, 0.12, 0.62), (x + 0.21, 0.19, 1.10), 0.02, name='seat_frame')
    P('paint_under', box, (0, 0.52, 0.53), (1.30, 0.34, 0.20), name='bench_base')
    P('seat', VH.bevel_box, (0, 0.50, 0.66), (1.30, 0.40, 0.08), 0.03, 2, name='bench')
    P('seat', VH.bevel_box, (0, 0.69, 0.92), (1.30, 0.07, 0.40), 0.03, 2, name='bench_back')
    VH.socket('seat_driver', (-0.33, -0.06, 0.68), node=None, role='driver')
    VH.socket('seat_codriver', (0.33, -0.06, 0.68), role='passenger')
    VH.socket('seat_rear_l', (-0.36, 0.48, 0.70), role='passenger')
    VH.socket('seat_rear_r', (0.36, 0.48, 0.70), role='passenger')
    # canvas top: folded bundle on the deck, or erected on three bows
    if burnt:
        for y in (0.78, 0.84):
            P('metal', VH.ring_torus, (0, y, 0.99), 0.66, 0.012, (0, 1, 0), 16, 4, name='bow_wreck')
    elif not top:
        bm = bmesh.new()
        VH.body_loft(bm, [(0.74, 0.66, 0.985, 1.12, 0.06), (0.80, 0.68, 0.985, 1.17, 0.08), (0.98, 0.68, 0.985, 1.16, 0.08),
                          (1.06, 0.66, 0.985, 1.08, 0.05)], n=3)
        VH.vp(bm, 'canvas', 'top_folded', smooth=True)
        for x in (-0.45, 0.0, 0.45):
            P('leather', beam, (x, 0.76, 1.18), (x, 1.05, 1.10), 0.04, 0.008, name='strap')
    else:
        bm = bmesh.new()
        VH.body_loft(bm, [(-0.59, 0.675, 1.33, 1.375, 0.03), (-0.45, 0.69, 1.43, 1.56, 0.10, 0.015), (0.10, 0.70, 1.44, 1.60, 0.12, 0.02),
                          (0.62, 0.70, 1.40, 1.59, 0.12, 0.02), (0.92, 0.70, 1.10, 1.50, 0.14, 0.01), (1.12, 0.70, 0.99, 1.28, 0.16),
                          (1.24, 0.69, 0.99, 1.06, 0.05)], n=3)
        VH.vp(bm, 'canvas', 'top_up', smooth=True)
        for sx in (-1, 1):
            P('glass', box, (sx * 0.705, 0.95, 1.24), (0.006, 0.26, 0.16), name='quarter_window')
        P('glass', box, (0, 1.17, 1.15), (0.50, 0.006, 0.12), name='rear_window')
        VH.VM['notes'].append('top_up: canvas hood erected (top-up variant)')


def running(burnt):
    for node, x, y in (('wheel_fl', -XW, YF), ('wheel_fr', XW, YF), ('wheel_rl', -XW, YR), ('wheel_rr', XW, YR)):
        VH.wheel(node, (x, y, RT), RT, TW, RIM, 1 if x > 0 else -1, lug=0.014)
        if y < 0:
            VH.VM['moving'][-1]['steer'] = True
            VH.VM['moving'][-1]['steer_limits_deg'] = [-32, 32]
        else:
            VH.emitter('dust', (x, y + 0.35, 0.05), (0, 1, 0.4), node=None)
    # chassis: central backbone tube, swing axles, torsion-bar tubes, trailing arms
    P('paint_under', cyl, (0, -1.5, 0.40), (0, 1.5, 0.40), 0.07, 8, name='backbone')
    for y in (YF, YR):
        P('paint_under', cyl, (-0.55, y + 0.12, 0.42), (0.55, y + 0.12, 0.42), 0.045, 8, name='torsion_tube')
        for sx in (-1, 1):
            P('paint_under', cyl, (sx * 0.1, y, 0.38), (sx * 0.58, y, RT), 0.035, 6, name='axle')
            P('paint_under', cyl, (sx * 0.48, y + 0.02, RT + 0.05), (sx * 0.48, y + 0.02, RT + 0.28), 0.03, 6, name='damper')
    VH.emitter('mud', (0, 0, 0.1), (0, 0, 1), note='spray from all wheels when on mud/snow')


def main(var, out_root):
    burnt, top = build(var)
    sides(burnt)
    rear(burnt)
    fittings(burnt, top)
    running(burnt)
    if burnt:
        VH.rotate_node('door_fr', 38, (0, 0, 1))
        VH.emitter('smoke', (0, 0.2, 1.1), (0, 0, 1), kind2='wreck_smoulder')
        T = Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(2.0), 4, 'Y') @ Matrix.Rotation(math.radians(-1.2), 4, 'X')
        VH.apply_T(T)
    VH.emitter('fire', (0, 1.4, 0.9), (0, 0, 1), when='destroyed', note='engine bay fire (rear-engined)')
    dims = {'length': 3.74, 'width': 1.60, 'height_screen_up': 1.35, 'height_top_up': 1.62, 'wheelbase': 2.40,
            'track': 1.36, 'tyre_d': round(2 * RT, 3), 'ground_clearance': 0.29}
    VH.vfinalize(os.path.join(out_root, 'kubelwagen'), 'kubelwagen', dims, variants=ALL,
                 extra={'rotation_order': 'YXZ (steer yaw, then wheel spin about X)', 'top': 'up' if top else ('none' if burnt else 'folded'),
                        'real_name': 'Volkswagen Typ 82 Kuebelwagen', 'destroyed': burnt})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'grey').split(',')
    out_root = VH.OUT_ROOT
    for v in (ALL if vs == ['all'] else vs):
        main(v, out_root)
