"""M9 Bab el Qattara small military props. Variants:
  y: the yellow fuel-drum dump (the forecourt's "stack of yellow barrels", 5 x 4 x 1.2): twelve 200 l drums in the
     faded yellow of the Wehrmacht fuel drums on two plank pallets, two lying on timber chocks, a hand pump in one,
     a tarpaulin half over the back pallet, stencils, spilt-fuel stains, sand drifts
  a / b: Wehrmacht ammunition-box stacks (2 x 2 x 1.1): dark-yellow / field-grey boxes with rope handles and
     stencilled ends, a jerrycan row (a) or a tarp corner and a loose open box (b)
  g: the lattice A-frame gantry hoist (8 x 4 x 7) over a Maybach engine on its stand: riveted lattice legs splayed
     across the frame, an I-beam with a chain-hoist trolley, chain, hook and sling, tool chest, oil drum, drip tray
Footprints: drums / boxes LOW (body cover), gantry only its two leg feet. Front (Blender -Y) = game S.
Usage: blender -b --python bq_props.py -- outdir [y|a|b|g] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *

OUT, VAR, SEED = args('y')
NAME = {'y': 'drum_dump_yellow_bq', 'a': 'ammo_boxes_bq_a', 'b': 'ammo_boxes_bq_b', 'g': 'gantry_hoist_bq'}[VAR]
K.begin(NAME, SEED * 31 + ord(VAR), theater='desert')
r = K.rng()
YEL = (1.0, 0.84, 0.36)


def pallet(cx, cy, w, d, rot=0.0, name='pallet'):
    bm = bmesh.new()
    cs, sn = math.cos(rot), math.sin(rot)
    P = lambda x, y, z: (cx + x * cs - y * sn, cy + x * sn + y * cs, z)
    for y in (-d / 2 + 0.08, 0, d / 2 - 0.08):
        C.box_bm(bm, P(0, y, 0.045), (w, 0.1, 0.09), rot)
    n = int(w / 0.17)
    for k in range(n):
        C.box_bm(bm, P(-w / 2 + (k + 0.5) * w / n, 0, 0.11), (w / n - 0.03, d, 0.025), rot)
    K.part(bm, 'boards_weathered', name=name, mat_tint=(0.86, 0.78, 0.66), grime=0.7, bisect=False)


def tarp(pts_rows, name='tarp', tint=(0.62, 0.56, 0.42)):
    bm = bmesh.new()
    vv = [[bm.verts.new(p) for p in row] for row in pts_rows]
    for i in range(len(vv) - 1):
        for j in range(len(vv[0]) - 1):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.015)
    K.part(bm, 'canvas', name=name, mat_tint=tint, grime=0.6, bisect=False, smooth=True)


def box(bm, c, size, rot):
    dz.crate(bm, c, size, rot)


if VAR == 'y':
    pallet(-1.15, 0.55, 2.0, 1.35, 0.03, 'pallet_a')
    pallet(1.1, -0.35, 2.0, 1.35, -0.05, 'pallet_b')
    pts = []
    for (cx, cy, rot) in ((-1.15, 0.55, 0.03), (1.1, -0.35, -0.05)):
        for i in range(3):
            for j in range(2):
                x, y = (i - 1) * 0.63, (j - 0.5) * 0.63
                pts.append((cx + x * math.cos(rot) - y * math.sin(rot) + r.uniform(-0.03, 0.03),
                            cy + x * math.sin(rot) + y * math.cos(rot) + r.uniform(-0.03, 0.03), 0.125))
    drums(pts[:10] + [pts[11]], tint=YEL, name='drums_up')
    bm = bmesh.new()              # two lying drums on chocks in front, one dented stander apart
    for k, (x, y) in enumerate(((-1.3, -1.25), (-0.65, -1.3))):
        dz.drum(bm, (x, y, 0.31), lying=True, axis=(0.15, 1, 0))
    K.part(bm, 'paint_metal', name='drums_lying', mat_tint=(0.96, 0.8, 0.34), grime=0.9, bisect=False, smooth=True)
    beams([((-1.75, -1.15, 0.05), (-0.25, -1.2, 0.05)), ((-1.75, -1.5, 0.05), (-0.25, -1.55, 0.05))], s=0.1, name='chocks')
    drums([(2.05, 1.25, 0)], tint=(0.94, 0.78, 0.33), name='drum_loose')
    bm = bmesh.new()              # rotary hand pump in the end drum of the front pallet
    c = V(pts[9]) + V((0, 0, 0.88))
    C.cyl_bm(bm, c, c + V((0, 0, 0.75)), 0.035, 6)
    C.cyl_bm(bm, c + V((0, 0, 0.55)), c + V((0, 0, 0.75)), 0.09, 8)
    C.beam_bm(bm, c + V((0.09, 0, 0.65)), c + V((0.32, 0, 0.62)), 0.03, 0.03)
    C.cyl_bm(bm, c + V((0, 0.05, 0.6)), c + V((0.25, 0.45, 0.05)), 0.02, 5)
    K.part(bm, 'cast_iron', name='pump', mat_tint=(0.3, 0.32, 0.28), bisect=False)
    for k in range(4):
        K.decal('stain_blotch', (r.uniform(-1.8, 1.8), r.uniform(-1.5, 1.4), 0.015), (0, 0, 1), r.uniform(0.6, 1.2), r.uniform(0.5, 1.0), alpha=0.45)
    dz.sand_drift((-2.3, 1.5), (2.3, 1.5), (0, 1), h=0.18, w=0.7, seed=SEED)
    K.footprint(rect(-2.4, -1.9, 2.4, 1.9), 'LOW', 'drums')
elif VAR in ('a', 'b'):
    bm, bg = bmesh.new(), bmesh.new()
    lay = [(-0.48, -0.3, 0, 0.0), (0.48, -0.3, 0, 0.02), (-0.48, 0.38, 0, 0.0), (0.48, 0.38, 0, -0.03),
           (-0.45, -0.3, 1, 0.05), (0.5, -0.28, 1, 0.0), (-0.47, 0.36, 1, 0.0), (0.0, 0.05, 2, 0.08 if VAR == 'a' else -0.1)]
    if VAR == 'b':
        lay = lay[:6] + [(0.45, 0.4, 1, 0.1)]
    for k, (x, y, lvl, rot) in enumerate(lay):
        size = (0.9, 0.62, 0.36) if k % 3 else (0.95, 0.6, 0.4)
        box(bm if (k + VAR.count('b')) % 3 else bg, (x, y, lvl * 0.37), size, rot)
    K.part(bm, 'wood_paint', name='boxes', mat_tint=DAK, grime=0.8, bisect=False)
    K.part(bg, 'wood_paint', name='boxes_grey', mat_tint=(0.5, 0.52, 0.47), grime=0.8, bisect=False)
    bm = bmesh.new()              # rope handles on the camera-facing ends
    for (x, y, lvl, rot) in lay:
        for s in (-1, 1):
            p = V((x + s * 0.47, y, lvl * 0.37 + 0.22))
            C.cyl_bm(bm, p + V((s * 0.02, -0.12, 0)), p + V((s * 0.05, 0.12, 0)), 0.015, 4)
    K.part(bm, 'hessian', name='handles', mat_tint=(0.7, 0.6, 0.45), bisect=False)
    if VAR == 'a':
        jerrycans((-0.85, -0.9, 0), n=5, rot=0.0)
    else:
        bm = bmesh.new()          # an opened box on the sand, lid propped against it, straw packing
        box(bm, (0.6, -0.95, 0), (0.85, 0.55, 0.3), 0.4)
        C.box_bm(bm, (0.15, -1.15, 0.25), (0.85, 0.03, 0.55), 0.4)
        K.part(bm, 'wood_paint', name='open_box', mat_tint=DAK, grime=0.8, bisect=False)
        tarp([[V((-0.95 + 1.0 * i / 3, -0.05 + 0.75 * j / 2, 1.13 - 0.04 * (i + j) - (0.75 if i == 0 else 0))) for j in range(3)] for i in range(4)],
             tint=(0.55, 0.5, 0.38))
    dz.sand_drift((-1.0, 0.75), (1.0, 0.75), (0, 1), h=0.12, w=0.5, seed=SEED)
    K.footprint(rect(-1.0, -1.15, 1.0, 0.85), 'LOW', 'boxes')   # the stack + the jerrycans / opened box in front: 2 x 2 m
else:   # 'g' the gantry hoist
    HX, HY, TOP = 3.5, 1.8, 6.6
    bm = bmesh.new()
    for sx in (-1, 1):              # each end an A-frame of two lattice legs: angle-iron chords + zig-zag lacing
        x = sx * HX
        for sy in (-1, 1):
            foot, head = V((x, sy * HY, 0.0)), V((x, sy * 0.18, TOP))
            ax = (head - foot).normalized()
            side = V((0, 0, 1)).cross(ax).normalized() if abs(ax.z) < 0.99 else V((1, 0, 0))
            side = V((1, 0, 0))
            for c in (-0.16, 0.16):
                C.beam_bm(bm, foot + side * c, head + side * c * 0.6, 0.06, 0.06)
            n = 12
            for k in range(n):
                p0, p1 = foot.lerp(head, k / n), foot.lerp(head, (k + 1) / n)
                w0, w1 = 0.16 * (1 - 0.4 * k / n), 0.16 * (1 - 0.4 * (k + 1) / n)
                C.beam_bm(bm, p0 + side * (w0 if k % 2 else -w0), p1 + side * (-w1 if k % 2 else w1), 0.025, 0.025)
        for z in (1.6, 3.4):        # cross ties between the two legs of the A
            t = z / TOP
            C.beam_bm(bm, V((x, -HY * (1 - t) - 0.18 * t, z)), V((x, HY * (1 - t) + 0.18 * t, z)), 0.07, 0.07)
        C.box_bm(bm, (x, 0, TOP + 0.1), (0.5, 0.6, 0.2))            # head plate
        for sy in (-1, 1):
            C.box_bm(bm, (x, sy * HY, 0.03), (0.5, 0.5, 0.06))      # foot plates
    # the I-beam runway (flanges + web) end to end, with stiffeners
    C.box_bm(bm, (0, 0, TOP + 0.24), (2 * HX + 0.8, 0.22, 0.03))
    C.box_bm(bm, (0, 0, TOP + 0.56), (2 * HX + 0.8, 0.22, 0.03))
    C.box_bm(bm, (0, 0, TOP + 0.4), (2 * HX + 0.8, 0.025, 0.3))
    for k in range(-3, 4):
        C.box_bm(bm, (k * 1.1, 0, TOP + 0.4), (0.02, 0.2, 0.3))
    K.part(bm, 'paint_metal', name='gantry', mat_tint=(0.62, 0.55, 0.4), grime=0.9, bisect=False)
    # trolley, chain-hoist block, hand chain loop and the load chain to a hook over the engine
    bm = bmesh.new()
    tx = 0.4
    C.box_bm(bm, (tx, 0, TOP + 0.08), (0.42, 0.34, 0.16))
    C.cyl_bm(bm, V((tx, -0.17, TOP - 0.25)), V((tx, 0.17, TOP - 0.25)), 0.2, 12)
    C.box_bm(bm, (tx, 0, TOP - 0.55), (0.24, 0.2, 0.3))
    z = TOP - 0.7
    while z > 1.75:
        C.cyl_bm(bm, V((tx, 0, z)), V((tx, 0, z - 0.06)), 0.022, 4)
        z -= 0.075
    for k in range(18):               # hand chain hanging in a loop beside the block
        a = k / 18 * math.pi
        C.cyl_bm(bm, V((tx + 0.22, 0.2 * math.cos(a), TOP - 0.3 - 3.6 * math.sin(a / 2) ** 0.5)),
                 V((tx + 0.22, 0.2 * math.cos(a) + 0.01, TOP - 0.36 - 3.6 * math.sin(a / 2) ** 0.5)), 0.012, 3)
    C.cyl_bm(bm, V((tx, 0, 1.75)), V((tx, 0, 1.55)), 0.06, 6)
    for s in (-1, 1):                 # two-leg sling down to the engine's lifting eyes
        C.cyl_bm(bm, V((tx, 0, 1.55)), V((tx + s * 0.45, 0, 1.2)), 0.012, 4)
    K.part(bm, 'cast_iron', name='hoist', mat_tint=(0.32, 0.3, 0.27), bisect=False)
    # Maybach V12 engine block on a timber-and-steel stand under the hook (sump, rocker covers, flywheel, manifolds)
    bm = bmesh.new()
    C.box_bm(bm, (0.4, 0, 0.5), (1.4, 0.95, 0.12))
    for x in (-0.25, 1.05):
        for y in (-0.42, 0.42):
            C.box_bm(bm, (x, y, 0.22), (0.12, 0.12, 0.44))
    K.part(bm, 'timber_beam', name='stand', mat_tint=(0.7, 0.6, 0.48), grime=0.8, bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0.4, 0, 0.78), (1.2, 0.6, 0.45), taper=(1.0, 0.75))
    for s in (-1, 1):
        C.box_bm(bm, (0.4, s * 0.3, 1.05), (1.15, 0.28, 0.12), rot_z=0, taper=(0.95, 0.9))
        C.cyl_bm(bm, V((-0.2, s * 0.42, 0.95)), V((1.0, s * 0.42, 0.95)), 0.06, 6)
    C.cyl_bm(bm, V((1.0, 0, 0.82)), V((1.12, 0, 0.82)), 0.36, 16)
    C.box_bm(bm, (0.4, 0, 0.6), (1.1, 0.45, 0.12))
    K.part(bm, 'paint_metal', name='engine', mat_tint=(0.4, 0.42, 0.38), grime=1.0, bisect=False)
    drums([(-1.9, 1.0, 0)], tint=(0.5, 0.52, 0.46), name='oil_drum')
    bm = bmesh.new()
    C.box_bm(bm, (-1.6, -1.0, 0.25), (0.8, 0.45, 0.5))
    K.part(bm, 'paint_metal', name='toolchest', mat_tint=(0.55, 0.58, 0.5), grime=0.8, bisect=False)
    bm = bmesh.new()
    C.box_bm(bm, (0.4, 0, 0.02), (1.6, 1.2, 0.04))
    K.part(bm, 'steel_galv', name='driptray', mat_tint=(0.5, 0.48, 0.44), grime=1.0, bisect=False)
    for k in range(5):
        K.decal('stain_blotch', (r.uniform(-1.5, 2.2), r.uniform(-1.2, 1.2), 0.012), (0, 0, 1), r.uniform(0.6, 1.4), r.uniform(0.5, 1.0), alpha=0.6)
    for sx in (-1, 1):
        for sy in (-1, 1):
            K.footprint(rect(sx * HX - 0.3, sy * HY - 0.3, sx * HX + 0.3, sy * HY + 0.3), 'HIGH', 'gantry_leg')

dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=48)
