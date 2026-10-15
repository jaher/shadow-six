"""M10 El Agheila small structures. Variants:
  pump   windpump_ic (dossier §5.3 `windpump`, 3 x 3 x 9, building-inventory: a lattice windmill water pump, not a radio
         mast): a four-leg tapering angle-iron tower on concrete footings, a ladder and a small platform under the head,
         an 18-blade 2.6 m wheel on the gearbox, a tail vane, the pump rod down to a cast-iron pump head on the well
         cap, a delivery pipe to a timber-staved trough between the legs, wet sand round it.
  revet  revetment_ic (§5.4 `blast_wall_revetment`, a 2 m module tiled along the apron's blast walls, 2.0 x 1.0 x 2.4):
         a precast concrete splinter-wall panel with a battered back buttress, chipped arrises, form-board marks,
         shell splinter pocks, stains, sand drifted against its foot. Local X runs along the wall.
  hut    sentry_hut_ic (§5.1 `sentry_box_sandbag`, 3 x 3 x 2.4 at the ramp head): a plank hut on a sandbag skirt, a flat
         corrugated roof weighted with bags, a hatch-like view slit S, door N (shelf side), a field telephone box.
Front (Blender -Y) = game S. Usage: blender -b --python ic_misc.py -- outdir VAR [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ic_common import *

OUT, VAR, SEED = args('pump')
NAME = {'pump': 'windpump_ic', 'revet': 'revetment_ic', 'hut': 'sentry_hut_ic'}[VAR]
K.begin(NAME, 10801 + SEED + 13 * len(VAR), theater='desert')
r = K.rng()

if VAR == 'pump':
    B, Tp, H = 1.25, 0.32, 7.6
    bot = [(-B, -B), (B, -B), (B, B), (-B, B)]
    top = [(-Tp, -Tp), (Tp, -Tp), (Tp, Tp), (-Tp, Tp)]
    footings(bot, s=0.5, h=0.35)
    lattice_tower(bot, top, 0.15, H, levels=5, w=0.1, name='tower', tint=(0.6, 0.57, 0.5))
    bm = bmesh.new()                       # platform round the head + ladder up the S leg pair
    C.box_bm(bm, (0, 0, H - 0.75), (1.4, 1.4, 0.06))
    K.part(bm, 'deck_planks', name='platform', mat_tint=(0.72, 0.64, 0.52), grime=0.9)
    K.ladder((0, -B * 0.55 - 0.12, 0.0), H - 0.8, (0, -1, 0), width=0.4, lean=0.0, mid='paint_metal', name='ladder', meta=False)
    bm = bmesh.new()                       # gearbox, wheel hub, 18 blades on two rims, tail boom + vane
    hz = H + 0.45
    C.box_bm(bm, (0, 0.05, hz), (0.35, 0.7, 0.4))
    C.cyl_bm(bm, V((0, -0.3, hz)), V((0, -0.55, hz)), 0.12, 10)
    for rr_ in (0.75, 1.3):
        for k in range(24):
            a0, a1 = 2 * math.pi * k / 24, 2 * math.pi * (k + 1) / 24
            C.beam_bm(bm, (rr_ * math.cos(a0), -0.5, hz + rr_ * math.sin(a0)), (rr_ * math.cos(a1), -0.5, hz + rr_ * math.sin(a1)), 0.03, 0.03)
    for k in range(6):
        a = 2 * math.pi * k / 6
        C.beam_bm(bm, (0, -0.5, hz), (1.3 * math.cos(a), -0.5, hz + 1.3 * math.sin(a)), 0.03, 0.03)
    C.beam_bm(bm, (0, 0.35, hz), (0, 2.3, hz + 0.1), 0.06, 0.06)
    K.part(bm, 'paint_metal', name='head', mat_tint=(0.55, 0.53, 0.47), grime=0.8, bisect=False)
    bm = bmesh.new()
    for k in range(18):
        a = 2 * math.pi * k / 18
        c, s_ = math.cos(a), math.sin(a)
        p = [V((0.45 * c - 0.11 * s_, -0.48, hz + 0.45 * s_ + 0.11 * c)), V((1.3 * c - 0.2 * s_, -0.52, hz + 1.3 * s_ + 0.2 * c)),
             V((1.3 * c + 0.12 * s_, -0.45, hz + 1.3 * s_ - 0.12 * c)), V((0.45 * c + 0.05 * s_, -0.46, hz + 0.45 * s_ - 0.05 * c))]
        bm.faces.new([bm.verts.new(tuple(v)) for v in p])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    K.part(bm, 'steel_galv', name='blades', mat_tint=(0.8, 0.78, 0.72), grime=0.7, bisect=False)
    bm = bmesh.new()
    p = [V((0, 1.6, hz - 0.35)), V((0, 2.6, hz - 0.25)), V((0, 2.6, hz + 0.6)), V((0, 1.6, hz + 0.3))]
    bm.faces.new([bm.verts.new(tuple(v)) for v in p])
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    K.part(bm, 'paint_metal', name='vane', mat_tint=(0.86, 0.8, 0.66), grime=0.6, bisect=False)
    pipe([(0, 0.05, hz - 0.2), (0, 0.05, 0.9)], r=0.03, name='pump_rod', tint=(0.45, 0.42, 0.38), flanges=False, segs=6)
    bm = bmesh.new()                       # well cap, pump head, spout
    C.cyl_bm(bm, V((0, 0.05, 0)), V((0, 0.05, 0.3)), 0.5, 14)
    K.part(bm, 'concrete_aggregate', name='well_cap', mat_tint=(0.86, 0.8, 0.7), grime=1.0, bisect=False)
    pipe([(0, 0.05, 0.3), (0, 0.05, 1.0)], r=0.09, name='pump_head', tint=(0.32, 0.3, 0.28), flanges=True, segs=10)
    pipe([(0, 0.05, 0.85), (0.75, 0.05, 0.85), (0.75, 0.05, 0.75)], r=0.04, name='spout', tint=(0.32, 0.3, 0.28), flanges=False, segs=6)
    bm = bmesh.new()                       # a timber-staved trough under the spout
    C.box_bm(bm, (0.75, 0.05, 0.25), (0.6, 1.5, 0.5))
    K.part(bm, 'timber_beam', name='trough', mat_tint=(0.6, 0.52, 0.42), grime=1.0, bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0.75, 0.05, 0.47), (0.48, 1.38, 0.02))
    K.part(bm, 'paint_metal', name='water', mat_tint=(0.25, 0.28, 0.27), grime=0.0, bisect=False)
    K.decal('stain_blotch', (0.6, 0.0, 0.012), (0, 0, 1), 2.2, 2.0, alpha=0.5)
    for (x, y) in bot:
        K.footprint(rect(x - 0.25, y - 0.25, x + 0.25, y + 0.25), 'HIGH', 'post')
    K.footprint(rect(0.45, -0.7, 1.05, 0.8), 'LOW', 'prop')
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ic_misc_b.py')).read())
