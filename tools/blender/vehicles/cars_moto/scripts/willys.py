# Willys MB 1/4-ton 4x4 (1942-45), US Army olive drab - Allied escape vehicle (M8).
# blender -b --factory-startup --python willys.py -- od|burnt
# Real dims: L 3.33 m, W 1.57 m, H 1.32 m (screen up, top down), wheelbase 2.03 m, track 1.24 m, tyres 6.00-16 (D ~0.72 m),
# 9-slot pressed grille with the headlights behind it, flat wings, no doors (side cut-outs), fold-flat split windscreen,
# spare wheel + jerrycan on the rear panel, pioneer tools on the left side. Allied white star on the bonnet (not an Axis insignia).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh as VH
from veh import P, box, beam, cyl, V
import bmesh
from mathutils import Matrix

ALL = ['od', 'burnt']
YF, YR, XW = -1.015, 1.015, 0.62
RT, RIM, TW = 0.36, 0.205, 0.16
SW = 0.64                               # tub side half width


def front(burnt):
    # bonnet (flat top, vertical sides) + cowl
    bm = bmesh.new()
    VH.body_loft(bm, [(-1.47, 0.38, 0.62, 1.00, 0.04), (-0.56, 0.40, 0.62, 1.02, 0.04)], n=2)
    VH.vp(bm, 'paint', 'bonnet', smooth=True)
    for sx in (-1, 1):
        P('black', box, (sx * 0.39, -1.0, 0.99), (0.03, 0.04, 0.03), name='bonnet_clamp')
    # pressed-steel grille: 9 vertical slots, headlights behind the outer openings, blackout marker lamps on top
    P('paint', VH.bevel_box, (0, -1.50, 0.78), (0.80, 0.05, 0.46), 0.03, 1, name='grille')
    for i in range(9):
        x = -0.24 + i * 0.06
        P('black', box, (x, -1.527, 0.76), (0.028, 0.01, 0.30), name='slot')
    for sx in (-1, 1):
        VH.headlight('headlight_%s' % ('l' if sx < 0 else 'r'), (sx * 0.31, -1.53, 0.80), 0.085, 0.10, cover=False)
        P('paint', cyl, (sx * 0.30, -1.53, 0.99), (sx * 0.30, -1.56, 0.99), 0.035, 10, name='blackout_marker')
        VH.light('blackout_marker_%s' % ('l' if sx < 0 else 'r'), (sx * 0.30, -1.565, 0.99), (0, -1, 0), True, kind='blackout_marker')
    # flat front wings with a rolled front lip
    path = [(-1.63, 0.66), (-1.60, 0.76), (-1.54, 0.80), (-0.74, 0.80), (-0.60, 0.76), (-0.52, 0.62), (-0.50, 0.50)]
    prof = [(0.0, 0.0), (0.37, 0.0), (0.385, -0.02), (0.385, -0.06), (0.375, -0.06), (0.372, -0.018), (0.0, -0.014)]
    for sx in (-1, 1):
        bm = bmesh.new()
        VH.sweep_bm(bm, path, prof, x0=sx * 0.40, mirror=sx < 0)
        VH.vp(bm, 'paint', 'wing')
        P('paint', box, (sx * 0.42, -1.05, 0.70), (0.02, 0.9, 0.18), name='wing_inner')
    VH.light('blackout_tail', (0, 1.555, 0.70), (0, 1, 0), True, kind='taillight')
    # front bumper channel + tow hooks, rear pintle
    P('paint', VH.bevel_box, (0, -1.60, 0.55), (1.50, 0.06, 0.12), 0.01, 1, name='bumper')
    for sx in (-1, 1):
        P('paint', VH.ring_torus, (sx * 0.48, -1.615, 0.55), 0.035, 0.012, (1, 0, 0), 10, 4, name='tow_hook')
        P('paint', box, (sx * 0.52, 1.575, 0.50), (0.14, 0.08, 0.10), name='bumperette')
    P('metal', VH.ring_torus, (0, 1.60, 0.48), 0.04, 0.014, (0, 0, 1), 10, 4, name='pintle')
    VH.tac_number((-0.52, -1.635, 0.55), (0, -1, 0), 0.28, 0.08)
    # Allied white star on the bonnet (plain five-point star)
    if not burnt:
        star(V((0, -1.02, 1.024)), 0.26)


def star(c, R):
    bm = bmesh.new()
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        r = R if k % 2 == 0 else R * 0.382
        pts.append(bm.verts.new(c + V((r * math.cos(a), -r * math.sin(a), 0))))
    cv = bm.verts.new(c)
    for k in range(10):
        bm.faces.new((cv, pts[k], pts[(k + 1) % 10]))
    VH.vp(bm, 'white', 'star', recalc=False, lod='drop2')


def tub(burnt):
    # sides with the characteristic door cut-outs and the rear wheel arches
    cut = [(-0.46, 0.95)] + [(-0.40 + 0.72 * t, 0.95 - 0.24 * math.sin(math.pi * t) ** 0.6) for t in [i / 8 for i in range(9)]]
    for sx in (-1, 1):
        prof = [(-0.56, 0.44), (0.585, 0.44)] + VH.arc_path(YR, RT, 0.43, 172, 8, 12)[1:-1] + [(1.445, 0.44), (1.535, 0.44),
                (1.535, 0.93)] + [(y, z) for y, z in reversed(cut[1:])] + [(-0.56, 1.00)]
        bm = bmesh.new()
        VH.side_prism(bm, prof, sx * (SW - 0.012), sx * SW)
        VH.vp(bm, 'paint', 'tub_side')
        P('paint', cyl, (sx * SW, 0.35, 0.93), (sx * SW, 1.51, 0.93), 0.014, 6, name='rim_roll')
        P('paint', beam, (sx * (SW + 0.01), 0.45, 0.80), (sx * (SW + 0.01), 0.45, 1.05), 0.02, 0.02, name='grab_handle')
    P('paint', box, (0, 1.535, 0.685), (2 * SW, 0.012, 0.49), name='rear_panel')
    P('paint', box, (0, -0.52, 0.80), (2 * SW, 0.04, 0.42), name='dash_panel')
    bm = bmesh.new()
    VH.body_loft(bm, [(-0.58, SW, 0.62, 1.02, 0.02), (-0.44, SW, 0.62, 1.00, 0.02)], n=1)
    VH.vp(bm, 'paint', 'cowl')
    P('paint_under', box, (0, 0.55, 0.45), (2 * SW - 0.02, 2.2, 0.02), name='floor')
    for sx in (-1, 1):
        P('paint', VH.bevel_box, (sx * 0.52, YR, 0.66), (0.24, 0.86, 0.44), 0.05, 1, name='wheel_well')
    P('paint', box, (0, 0.15, 0.52), (0.26, 1.2, 0.14), name='tunnel')
    for x in (-0.36, -0.20, 0.0):
        P('black', cyl, (x, -0.495, 0.90), (x, -0.49, 0.90), 0.03, 10, name='gauge')
    VH.steering_wheel('steering_wheel', (-0.33, -0.28, 1.04), (0, 0.5, 0.86), R=0.2)
    P('black', cyl, (-0.33, -0.52, 0.72), (-0.33, -0.28, 1.04), 0.02, 6, name='column')
    # seats: two front buckets + rear bench over the wheel wells (canvas cushions on steel pans)
    for x in (-0.33, 0.33):
        P('paint', box, (x, -0.02, 0.56), (0.42, 0.40, 0.20), name='seat_pan')
        P('seat', VH.bevel_box, (x, -0.04, 0.70), (0.44, 0.42, 0.08), 0.03, 2, name='seat')           # burnt: springs
        P('seat', VH.bevel_box, (x, 0.20, 0.90), (0.44, 0.07, 0.36), 0.03, 2, name='seat_back')
    P('paint', box, (0, 1.12, 0.66), (1.00, 0.34, 0.06), name='bench_pan')
    P('seat', VH.bevel_box, (0, 1.12, 0.73), (1.00, 0.36, 0.07), 0.03, 2, name='bench')
    P('seat', VH.bevel_box, (0, 1.40, 0.92), (1.00, 0.06, 0.30), 0.03, 2, name='bench_back')
    for nm, x, y, z in (('seat_driver', -0.33, -0.04, 0.74), ('seat_codriver', 0.33, -0.04, 0.74), ('seat_rear_l', -0.30, 1.12, 0.78),
                        ('seat_rear_r', 0.30, 1.12, 0.78)):
        VH.socket(nm, (x, y, z), role='driver' if nm == 'seat_driver' else 'passenger')
    # fold-flat split windscreen (two panes) on the cowl, folded top bows at the rear
    ws, piv = 'windscreen', (0, -0.46, 1.02)
    kw = dict(node=ws, pivot=piv)
    fr = [(-0.64, -0.46, 1.02), (-0.64, -0.455, 1.33), (0.64, -0.455, 1.33), (0.64, -0.46, 1.02)]
    for a, b in zip(fr[:-1], fr[1:]):
        P('paint', beam, a, b, 0.028, 0.028, name='ws_frame', **kw)
    P('paint', beam, (0, -0.46, 1.02), (0, -0.455, 1.33), 0.03, 0.03, name='ws_post', **kw)
    for sx in (-1, 1):
        if not burnt:
            P('glass', box, (sx * 0.32, -0.458, 1.175), (0.58, 0.006, 0.27), name='ws_glass', **kw)
        P('black', beam, (sx * 0.5, -0.49, 1.32), (sx * 0.3, -0.49, 1.20), 0.012, 0.006, name='wiper', **kw)
    VH.moving(ws, 'toggle', piv, (1, 0, 0), limits=(-88, 0), note='folds flat forward onto the bonnet (hood-mounted rests)')
    for sx in (-1, 1):
        P('metal', beam, (sx * 0.62, 1.30, 0.95), (sx * 0.62, 1.49, 1.12), 0.02, 0.02, name='bow_folded')
    P('metal', cyl, (-0.62, 1.49, 1.12), (0.62, 1.49, 1.12), 0.012, 6, name='bow_folded')
    if not burnt:
        P('canvas', VH.bevel_box, (0, 1.44, 1.02), (1.20, 0.18, 0.14), 0.05, 2, name='top_stowed')


def rear_gear(burnt):
    # spare wheel (right) and jerrycan (left) on the rear panel, pioneer axe + shovel on the left side
    VH.wheel('spare', (0.30, 1.615, 0.78), RT, TW, RIM, 1, spare=True, lug=0.016, tread='ndt')
    for p in [VH.C.A.parts[-1], VH.C.A.parts[-2]]:                      # tyre + rim (burnt: bead wire + rim)
        p.data.transform(Matrix.Translation((0.30, 1.615, 0.78)) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation((-0.30, -1.615, -0.78)))
        p['kit_node'] = 'main'
        p.pop('kit_pivot', None)
    P('paint', VH.bevel_box, (-0.40, 1.61, 0.72), (0.33, 0.16, 0.47), 0.02, 1, name='jerrycan')
    P('paint', box, (-0.40, 1.69, 0.72), (0.30, 0.01, 0.02), name='jerrycan_weld')
    P('paint', box, (-0.40, 1.57, 0.72), (0.40, 0.04, 0.06), name='can_bracket')
    P('wood', beam, (-(SW + 0.03), -0.10, 0.62), (-(SW + 0.03), 0.60, 0.64), 0.035, 0.03, name='axe_haft')
    P('metal', box, (-(SW + 0.03), -0.14, 0.65), (0.02, 0.10, 0.16), name='axe_head')
    P('wood', beam, (-(SW + 0.03), 0.62, 0.55), (-(SW + 0.03), 1.30, 0.58), 0.035, 0.03, name='shovel_haft')
    P('metal', box, (-(SW + 0.03), 1.40, 0.56), (0.02, 0.22, 0.18), name='shovel_blade')
    VH.taillight('taillight_l', (-0.56, 1.545, 0.84), (0, 1, 0))
    VH.taillight('taillight_r', (0.56, 1.545, 0.84), (0, 1, 0))
    for node, x, y in (('wheel_fl', -XW, YF), ('wheel_fr', XW, YF), ('wheel_rl', -XW, YR), ('wheel_rr', XW, YR)):
        VH.wheel(node, (x, y, RT), RT, TW, RIM, 1 if x > 0 else -1, lug=0.016, tread='ndt')      # US NDT tread
        if y < 0:
            VH.VM['moving'][-1]['steer'] = True
            VH.VM['moving'][-1]['steer_limits_deg'] = [-32, 32]
        else:
            VH.emitter('dust', (x, y + 0.4, 0.05), (0, 1, 0.4))
    # ladder frame, leaf springs, solid axles with pumpkin diffs, exhaust
    for sx in (-1, 1):
        P('paint_under', box, (sx * 0.34, 0.0, 0.50), (0.06, 3.2, 0.13), name='rail')
        for y in (YF, YR):
            P('paint_under', box, (sx * 0.38, y, 0.46), (0.06, 0.95, 0.05), name='leaf_spring')
    for y in (YF, YR):
        P('paint_under', cyl, (-0.56, y, RT), (0.56, y, RT), 0.04, 8, name='axle')
        P('paint_under', VH.ring_torus, (0.12, y, RT), 0.08, 0.05, (0, 1, 0), 10, 6, name='diff')
    P('metal', cyl, (0.28, -0.6, 0.36), (0.28, 1.47, 0.36), 0.025, 8, name='exhaust')
    VH.emitter('exhaust', (0.28, 1.49, 0.36), (0, 1, -0.05))


def main(var, out_root):
    VH.setup('willys_mb', var, seed=42)
    burnt = var == 'burnt'
    front(burnt)
    tub(burnt)
    rear_gear(burnt)
    if burnt:
        VH.emitter('smoke', (0, 0.2, 1.0), (0, 0, 1), kind2='wreck_smoulder')
        VH.apply_T(Matrix.Translation((0, 0, -(RT - RIM - 0.02))) @ Matrix.Rotation(math.radians(-2.2), 4, 'Y'))
    VH.emitter('fire', (0, -1.0, 1.0), (0, 0, 1), when='destroyed', note='engine / fuel tank under the driver seat')
    dims = {'length': 3.33, 'width': 1.57, 'height_screen_up': 1.32, 'height_top_up': 1.77, 'wheelbase': 2.03, 'track': 1.24,
            'tyre_d': round(2 * RT, 3)}
    VH.vfinalize(os.path.join(out_root, 'willys_mb'), 'willys', dims, variants=ALL,
                 extra={'real_name': 'Willys MB 1/4-ton 4x4 (US Army)', 'destroyed': burnt, 'rotation_order': 'YXZ', 'side': 'allied'})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    vs = (argv[0] if argv else 'od').split(',')
    for v in (ALL if vs == ['all'] else vs):
        main(v, VH.OUT_ROOT)
