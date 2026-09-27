# Rail-mounted steam crane (Dampf-Eisenbahndrehkran, ~10 t, 1920s-30s): 2-axle carriage with screw outriggers,
# slewing superstructure (vertical boiler + chimney, machinery house, cast counterweight), lattice jib that luffs,
# hook block on a pendulum node. blender -b ... --python rail_crane.py -- black|winter|all
# Dims: carriage 7.4 m over buffers, wheelbase 3.6 m, jib 10 m (pivot 1.9 m), house 3.4 x 2.6 m, chimney 4.7 m.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rail as R
import veh as VH
import kit_core as C
from veh import box, beam, cyl, V
from rail import RP, rp_
import bmesh
from mathutils import Matrix

ALL = ['black', 'winter']
ZS = 1.5                        # slewing ring top
JL, JA = 10.0, 12.0             # jib length, modelled luff angle: travel pose, jib lowered onto the idler's jib rest


def pal():
    return dict(R.DR, body=(30, 29, 28), frame=R.DR['red'], wheel=(66, 54, 46), weight=(74, 72, 68), yellow=(170, 140, 50),
                white=(200, 196, 186), gearing=(58, 56, 52), wire=(70, 66, 58))


def carriage():
    yf, yr = R.two_axle_underframe(6.0, 3.6, 0.5, 1.2, 'frame', 'wheel', blen=0.55, hand_brake=False)
    RP('frame', box, (0, 0, 1.3), (2.4, 6.0, 0.2), name='deck_plate')
    for f in (-1, 1):                                            # box-section outrigger beams (run out), screw jacks, pads
        for s in (-1, 1):
            RP('frame', box, (s * 1.25, f * 2.2, 1.18), (0.7, 0.34, 0.26), name='outrigger_housing')
            # node outrigger_<f><s>: beam + jack, STOWED (run in, flush with the housing) for travel; deployed = slide out
            # 0.45 m. Child node jack_<f><s>: screw + foot + timber pads, wound UP for travel; deployed = lowered 0.97 m
            # so the pads stand on the ground beside the ballast (y -0.45)
            no, nj = 'outrigger_%s%s' % ('f' if f < 0 else 'b', 'r' if s < 0 else 'l'), 'jack_%s%s' % ('f' if f < 0 else 'b', 'r' if s < 0 else 'l')
            p = V((s * 1.57, f * 2.2, 1.08))
            okw = dict(node=no, pivot=tuple(p))
            jkw = dict(node=nj, pivot=tuple(p))
            RP('frame', box, (s * 1.3, f * 2.2, 1.18), (0.7, 0.26, 0.2), name='outrigger_beam', **okw)
            RP('dark', cyl, p + V((0, 0, 0.2)), p + V((0, 0, 0.34)), 0.16, 6, name='jack_nut', bisect=False, **okw)
            RP('dark', cyl, p + V((0, 0, 1.22)), p - V((0, 0, 0.28)), 0.1, 10, name='outrigger_screw', bisect=False, **jkw)
            RP('dark', VH.ring_torus, p + V((0, 0, 1.24)), 0.2, 0.018, (0, 0, 1), 12, 3, name='jack_handwheel', bisect=False, lod='drop', **jkw)
            RP('dark', cyl, p - V((0, 0, 0.28)), p - V((0, 0, 0.36)), 0.2, 10, name='jack_foot', bisect=False, **jkw)
            RP('wood', box, (p.x, p.y, p.z - 0.41), (0.55, 0.55, 0.1), name='outrigger_pad', **jkw)
            RP('wood', box, (p.x, p.y, p.z - 0.51), (0.6, 0.3, 0.1), name='outrigger_pad_low', lod='drop', **jkw)
            VH.moving(no, 'slide', tuple(p), (s, 0, 0), travel_m=[0.0, 0.45], note='outrigger beam: 0 = stowed (travel), 0.45 = run out (working)')
            VH.moving(nj, 'slide', tuple(p), (0, 0, -1), travel_m=[0.0, 0.97], parent=no,
                      note='jack screw: 0 = wound up (travel), 0.97 = pads on the ground (y -0.45) when the beam is run out')
    VH.VM['toggles']['outriggers_deployed'] = {'default': False, 'nodes': ['outrigger_*: +0.45 m along local X (outward)', 'jack_*: -0.97 m along local Y (down)'],
                                               'note': 'working pose: run out the beams and screw the pads down to the ground; travel pose = default'}
    RP('dark', cyl, (0, 0, 1.4), (0, 0, ZS), 1.25, 24, name='slewing_ring', bisect=False)
    RP('dark', cyl, (0, 0, 1.41), (0, 0, 1.46), 1.32, 24, name='slewing_rack', bisect=False, lod='drop')
    return yf, yr


def superstructure():
    kw = dict(node='slew', pivot=(0, 0, ZS))
    y0, y1, hw, zt = -0.6, 2.8, 1.3, 3.45
    RP('body', box, (0, (y0 + y1) / 2, ZS + 0.1), (2.7, y1 - y0 + 0.4, 0.2), name='revolving_bed', **kw)
    # machinery house: framed sheet sides with a big open sliding-door bay (machinery visible), windows at the rear,
    # low pitched roof with a raised ventilator; open front for the operator and jib foot
    for s in (-1, 1):
        x = s * hw
        RP('body', box, (x, 2.0, (ZS + zt) / 2 + 0.1), (0.04, 1.6, zt - ZS - 0.2), name='house_side', **kw)
        RP('body', box, (x, -0.35, (ZS + zt) / 2 + 0.1), (0.04, 0.5, zt - ZS - 0.2), name='house_side', **kw)
        RP('body', box, (x, 0.6, zt - 0.3), (0.04, 1.4, 0.4), name='house_header', **kw)
        RP('glass', box, (x + s * 0.005, 2.0, ZS + 1.35), (0.01, 0.8, 0.5), name='house_window', lod='drop', **kw)
        for dz in (-0.27, 0.27):
            RP('dark', box, (x + s * 0.025, 2.0, ZS + 1.35 + dz), (0.03, 0.88, 0.04), name='window_frame', lod='drop', **kw)
        RP('body', box, (x + s * 0.05, 1.45, (ZS + zt) / 2 - 0.05), (0.03, 0.9, zt - ZS - 0.55), name='sliding_door', **kw)
        RP('dark', box, (x + s * 0.07, 1.0, zt - 0.08), (0.04, 2.4, 0.05), name='door_track', lod='drop', **kw)
        for yy in (-0.6, 1.2, 2.8):
            RP('dark', box, (x + s * 0.03, yy, (ZS + zt) / 2 + 0.1), (0.05, 0.06, zt - ZS - 0.2), name='house_post', **kw)
    RP('body', box, (0, y1, (ZS + zt) / 2 + 0.1), (2 * hw, 0.04, zt - ZS - 0.2), name='house_back', **kw)
    bm = bmesh.new()
    rings = [[V((-(hw + 0.1) * (1 - 2 * i / 4), y, zt + 0.35 * (1 - abs(1 - 2 * i / 4)))) for i in range(5)] for y in (y0 - 0.25, y1 + 0.12)]
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(4):
        bm.faces.new((vs[0][i], vs[0][i + 1], vs[1][i + 1], vs[1][i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.04)
    rp_(bm, 'body', 'house_roof', **kw)
    RP('body', box, (0, 0.8, zt + 0.42), (0.7, 1.4, 0.2), name='roof_ventilator', **kw)
    RP('body', box, (0, 0.8, zt + 0.54), (0.9, 1.6, 0.04), name='roof_ventilator_cap', **kw)
    # vertical boiler (fittings, gauge glass) + chimney through the roof
    RP('body', cyl, (0, 1.9, ZS + 0.2), (0, 1.9, zt), 0.6, 16, name='boiler', smooth=True, bisect=False, **kw)
    for z in (ZS + 0.8, ZS + 1.5):
        RP('dark', cyl, (0, 1.9, z - 0.03), (0, 1.9, z + 0.03), 0.62, 16, caps=False, name='boiler_band', bisect=False, lod='drop', **kw)
    RP('brass', cyl, (0.45, 1.4, ZS + 1.1), (0.45, 1.4, ZS + 1.5), 0.03, 6, name='gauge_glass', bisect=False, lod='drop', **kw)
    RP('body', cyl, (0, 1.9, zt), (0, 1.9, 4.75), 0.18, 12, name='chimney', bisect=False, **kw)
    RP('body', cyl, (0, 1.9, 4.7), (0, 1.9, 4.78), 0.23, 12, name='chimney_cap', bisect=False, lod='drop', **kw)
    VH.emitter('chimney_smoke', (0, 1.9, 4.8), (0, 0, 1), node='slew', note='vertical-boiler smoke')
    # cast counterweight: three stacked slabs with lifting eyes, hung off the rear of the bed
    for k in range(3):
        RP('weight', VH.bevel_box, (0, y1 + 0.45, ZS + 0.3 + k * 0.42), (2.5, 0.75, 0.38), r=0.04, name='counterweight', **kw)
    for s in (-1, 1):
        RP('dark', VH.ring_torus, (s * 0.8, y1 + 0.45, ZS + 1.4), 0.07, 0.018, (0, 1, 0), 8, 3, name='weight_eye', bisect=False, lod='drop', **kw)
    # machinery: hoist + luffing drums with rope wraps, spur gears + pinions, twin engine cylinders + crank discs
    RP('dark', cyl, (-0.85, 0.3, ZS + 0.75), (0.85, 0.3, ZS + 0.75), 0.33, 16, name='hoist_drum', smooth=True, bisect=False, **kw)
    RP('wire', cyl, (-0.7, 0.3, ZS + 0.75), (0.7, 0.3, ZS + 0.75), 0.36, 16, caps=False, name='drum_rope_wrap', bisect=False, **kw)
    RP('dark', cyl, (-0.85, 1.0, ZS + 0.62), (0.85, 1.0, ZS + 0.62), 0.24, 14, name='luff_drum', smooth=True, bisect=False, **kw)
    RP('wire', cyl, (-0.6, 1.0, ZS + 0.62), (0.6, 1.0, ZS + 0.62), 0.265, 14, caps=False, name='drum_rope_wrap', bisect=False, **kw)
    R.gear((0.95, 0.3, ZS + 0.75), 0.55, 0.08, 30, 'gearing', 'hoist_gear', kw)
    R.gear((-0.95, 1.0, ZS + 0.62), 0.42, 0.07, 24, 'gearing', 'luff_gear', kw)
    R.gear((0.95, 1.05, ZS + 1.06), 0.16, 0.08, 10, 'gearing', 'pinion', kw)
    for s in (-1, 1):
        RP('frame', box, (s * 1.12, 0.65, ZS + 0.6), (0.06, 1.3, 0.9), name='machinery_frame', **kw)
        RP('body', cyl, (s * 1.0, 2.1, ZS + 1.05), (s * 1.0, 1.3, ZS + 1.05), 0.15, 10, name='engine_cylinder', bisect=False, **kw)
        RP('dark', cyl, (s * 1.0, 1.3, ZS + 1.05), (s * 1.0, 1.05, ZS + 1.05), 0.03, 6, name='piston_rod', bisect=False, **kw)
        RP('dark', cyl, (s * 1.05, 1.05, ZS + 1.05), (s * 0.95, 1.05, ZS + 1.05), 0.2, 12, name='crank_disc', bisect=False, **kw)
    RP('dark', cyl, (-1.1, 1.05, ZS + 1.05), (1.1, 1.05, ZS + 1.05), 0.05, 8, name='crankshaft', bisect=False, **kw)
    for k, x in enumerate((-0.35, -0.15, 0.15, 0.35)):     # control levers at the operator's stand
        RP('dark', beam, (x, -0.2, ZS + 0.3), (x, -0.35, ZS + 1.1), 0.03, 0.03, name='control_lever', bisect=False, lod='drop', **kw)
    # A-frame gantry over the house for the luffing tackle (lower block on the gantry head)
    for s in (-1, 1):
        RP('body', beam, (s * 1.2, y1 - 0.2, zt), (s * 0.3, 1.0, 5.0), 0.12, 0.12, name='gantry_leg', **kw)
        RP('body', beam, (s * 1.2, -0.3, zt), (s * 0.3, 1.0, 5.0), 0.12, 0.12, name='gantry_leg', **kw)
    RP('body', cyl, (-0.4, 1.0, 5.0), (0.4, 1.0, 5.0), 0.09, 8, name='gantry_head', bisect=False, **kw)
    for dx in (-0.12, 0.12):
        RP('dark', cyl, (dx - 0.03, 1.0, 5.0), (dx + 0.03, 1.0, 5.0), 0.16, 12, name='gantry_sheave', bisect=False, **kw)
    VH.socket('operator', (0.6, -0.3, ZS + 0.2), (0, -1, 0), node='slew', pose='sit')
    VH.moving('slew', 'crane_slew', (0, 0, ZS), (0, 0, 1), limits=(-360, 360))
    return V((0, -0.9, ZS + 0.4))


def jib(foot):
    """Lattice jib (two tapering side trusses of angle chords + N lacing, cross ties), node 'jib' pivots at the foot
    (rotation about X). Head: twin sheaves between side plates; hoist rope reeved 2-fall to a sheave hook block."""
    kw = dict(node='jib', pivot=tuple(foot))
    a = math.radians(JA)
    d = V((0, -math.cos(a), math.sin(a)))
    up = V((0, math.sin(a), math.cos(a)))
    head = foot + d * JL
    bm = bmesh.new()
    n = 10
    for s in (-1, 1):
        chord = []
        for k in range(n + 1):
            t = k / n
            w = 0.55 * (1 - 0.6 * t)
            h = 0.45 * (1 - 0.55 * t) * (1 if 0.1 < t < 0.95 else 0.6)
            base = foot + d * (JL * t)
            chord.append((base + V((s * w, 0, 0)) + up * h, base + V((s * w, 0, 0)) - up * h))
        for k, ((ta, ba), (tb, bb)) in enumerate(zip(chord[:-1], chord[1:])):
            C.beam_bm(bm, ta, tb, 0.1, 0.1)
            C.beam_bm(bm, ba, bb, 0.1, 0.1)
            C.beam_bm(bm, ta, bb, 0.05, 0.05) if k % 2 == 0 else C.beam_bm(bm, ba, tb, 0.05, 0.05)
        for t_, b_ in chord:
            C.beam_bm(bm, t_, b_, 0.05, 0.05)
    rp_(bm, 'body', 'jib_truss', bisect=False, **kw)
    for k in range(0, n + 1, 2):
        t = k / n
        base = foot + d * (JL * t)
        w = 0.55 * (1 - 0.6 * t)
        h = 0.45 * (1 - 0.55 * t) * (1 if 0.1 < t < 0.95 else 0.6)
        for sg in (-1, 1):
            RP('body', beam, base + V((-w, 0, 0)) + up * sg * h, base + V((w, 0, 0)) + up * sg * h, 0.05, 0.05, name='jib_tie', bisect=False, **kw)
    for s in (-1, 1):                                             # head side plates + twin sheaves + foot pin bosses
        RP('body', box, tuple(head + V((s * 0.24, 0, 0))), (0.03, 0.7, 0.7), name='jib_head_plate', bisect=False, **kw)
        RP('dark', cyl, head + V((s * 0.13 - 0.04, 0, 0)), head + V((s * 0.13 + 0.04, 0, 0)), 0.3, 16, name='jib_sheave', bisect=False, **kw)
        RP('dark', cyl, foot + V((s * 0.55, 0, 0)), foot + V((s * 0.7, 0, 0)), 0.14, 10, name='jib_foot_boss', bisect=False, **kw)
    RP('dark', cyl, head + V((-0.28, 0, 0)), head + V((0.28, 0, 0)), 0.05, 8, name='jib_head_pin', bisect=False, **kw)
    RP('dark', cyl, foot + V((-0.72, 0, 0)), foot + V((0.72, 0, 0)), 0.08, 8, name='jib_foot_pin', bisect=False, **kw)
    RP('dark', cyl, foot + V((0, 0.2, 0.35)), foot + V((0, 0.2, 0.75)), 0.18, 12, name='foot_guide_sheave', bisect=False, **kw)
    VH.moving('jib', 'jib_luff', tuple(foot), (1, 0, 0), limits=(-JA + 2, 72 - JA), parent='slew',
              note='luff about the foot pin; 0 = modelled travel pose %.0f deg (jib on the idler rest); working 25-60 deg' % JA)
    VH.socket('jib_head', tuple(head), (0, 0, -1), node='jib', note='hoist rope leaves the head sheaves here')
    # luffing tackle: 3 falls from the gantry sheaves to the jib head bridle (static rope on the slew node, re-aim in game)
    g = V((0, 1.0, 5.0))
    bm = bmesh.new()
    for dx in (-0.14, 0.0, 0.14):
        C.cyl_bm(bm, g + V((dx, 0, 0)), head + up * 0.25 + V((dx, 0, 0)), 0.018, 4, caps=False)
    rp_(bm, 'wire', 'luff_rope', bisect=False, node='slew', pivot=(0, 0, ZS))
    RP('dark', box, tuple(head + up * 0.28), (0.4, 0.12, 0.1), name='luff_bridle', bisect=False, **kw)
    # hoist: two falls to a sheave hook block (pendulum node, kept world-vertical by the game)
    drop = 0.8                                                  # travel: block hoisted close under the head (clears the idler)
    hk = head - V((0, 0, drop))
    hkw = dict(node='hook', pivot=tuple(head))
    bm = bmesh.new()
    for dx in (-0.13, 0.13):
        C.cyl_bm(bm, head + V((dx, 0, -0.3)), hk + V((dx, 0, 0.1)), 0.016, 4, caps=False)
    rp_(bm, 'wire', 'hoist_rope', bisect=False, **hkw)
    for s in (-1, 1):
        RP('body', box, tuple(hk + V((s * 0.13, 0, -0.1))), (0.03, 0.42, 0.5), name='hook_block_cheek', bisect=False, **hkw)
    RP('dark', cyl, hk + V((-0.1, 0, 0)), hk + V((0.1, 0, 0)), 0.18, 12, name='hook_block_sheave', bisect=False, **hkw)
    RP('weight', box, tuple(hk - V((0, 0, 0.4))), (0.3, 0.3, 0.14), name='hook_crosshead', bisect=False, **hkw)
    RP('dark', cyl, hk - V((0, 0, 0.46)), hk - V((0, 0, 0.6)), 0.04, 6, name='hook_shank', bisect=False, **hkw)
    bm = bmesh.new()
    pts = [hk - V((0, 0, 0.6))] + [hk - V((0, 0, 0.78)) + V((0, 0.14 * math.sin(t), -0.14 * math.cos(t) + 0.0)) for t in [math.radians(-10 + 30 * k) for k in range(9)]]
    for a_, b_ in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, a_, b_, 0.035, 6)
    rp_(bm, 'dark', 'hook', bisect=False, **hkw)
    VH.moving('hook', 'pendulum', tuple(head), (1, 0, 0), parent='jib', rope_m=drop, keep_world_vertical=True, pay_out='working: lower the block by translating the hook node down and scaling hoist_rope (travel default 0.8 m); in travel the block is lashed to the idler eye (rail_crane_idler socket hook_lash)',
              counter_rotate='hook.rotation.x = -jib.rotation.x every frame (the node hangs from the jib head pin; without it the block would tilt with the luff)',
              note='hook block hangs vertically from the jib head; add swing on top of the counter-rotation')
    VH.socket('hook_load', tuple(hk - V((0, 0, 0.95))), (0, 0, -1), node='hook', note='load attach point')
    return head


def main(var, out_root):
    R.setup('rail_crane', var, pal(), seed=27, sooty=0.5)
    yf, yr = carriage()
    foot = superstructure()
    jib(foot)
    if var == 'winter':
        R.snow_cover(min_z=1.3, cover=0.3)
    dims = {'length_over_buffers': round(yr - yf, 3), 'wheelbase': 3.6, 'wheel_d': 1.0, 'jib_m': JL, 'capacity_t': 10,
            'height_chimney': 4.78, 'width': 2.7}
    R.finalize(out_root, 'rail_crane', 'rail_crane', dims, var, ALL, 'Rail-mounted steam crane (10 t Dampfdrehkran)',
               extra={'side': 'axis', 'dressing': True, 'idler_wagon': 'rail_crane_idler (couple at coupler_front; its jib_rest carries the jib in the travel pose)',
                      'hook_orientation': 'hook node is a child of jib: counter-rotate hook.rotation.x = -jib.rotation.x so the block stays vertical'}, ao_dist=1.0,
               parents={'jib': 'slew', 'hook': 'jib'})


if __name__ == '__main__':
    R.run(main, ALL)
