"""M11 Maradah stores (the camp's crate stacks are HIGH cover, ~2 m): stacked supply crates on dunnage timbers, two tiers
with a third crate or two on top, sand-yellow and bare-pine boxes in three sizes with end battens and rope handles, a
tarpaulin lashed over part of the stack, jerrycans and ammo boxes at the foot.
  a: 4 x 4 x 2.1   b: 3 x 3.8 x 2.1   c: 2.6 x 4 x 2.2   d: 2.4 x 2.6 x 2.0   e: 3 x 3 x 2.0
  drums: two-high blue-grey 200 l drums on a timber skid, 2 x 1.2 x 1.8 (not explosive: decor / cover)
Front (Blender -Y) = game S. Usage: blender -b --python ms_props.py -- outdir [a|b|c|d|drums] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ms_common import *

OUT, VAR, SEED = args('a')
NAME = 'drum_stack_ms' if VAR == 'drums' else 'crate_stack_ms_' + VAR
K.begin(NAME, 11801 + SEED + 31 * 'abcdex'.index(VAR[0] if VAR != 'drums' else 'x'), theater='desert')
r = K.rng()
PINE = (0.86, 0.74, 0.55)

if VAR != 'drums':
    W, D, H = {'a': (4, 4, 2.1), 'b': (3, 3.8, 2.1), 'c': (2.6, 4, 2.2), 'd': (2.4, 2.6, 2.0), 'e': (3, 3, 2.0)}[VAR]
    hw, hd = W / 2 - 0.08, D / 2 - 0.08
    bm = bmesh.new()                                      # dunnage: three timbers under the stack
    for x in (-hw + 0.25, 0, hw - 0.25):
        C.box_bm(bm, (x, 0, 0.06), (0.14, 2 * hd, 0.12))
    K.part(bm, 'timber_beam', name='dunnage', mat_tint=(0.62, 0.52, 0.4), grime=0.9, bisect=False)
    tiers = [(0.12, 0.85, 1.0), (0.97, 0.8, 0.86)]          # z0, crate height, fraction of the footprint used
    boxes_y, boxes_p, boxes_g = bmesh.new(), bmesh.new(), bmesh.new()
    for ti, (z0, ch, frac) in enumerate(tiers):
        nx = max(1, int(round(2 * hw * frac / 0.95)))
        ny = max(1, int(round(2 * hd * frac / 0.68)))
        cw, cd = 2 * hw * frac / nx, 2 * hd * frac / ny
        ox, oy = -hw * frac + (0.06 if ti else 0), -hd * frac + (0.05 if ti else 0)
        for i in range(nx):
            for j in range(ny):
                if ti == 1 and r.random() < 0.18:
                    continue
                c = (ox + cw * (i + 0.5) + r.uniform(-0.04, 0.04), oy + cd * (j + 0.5) + r.uniform(-0.04, 0.04), z0)
                dz.crate([boxes_y, boxes_p, boxes_g][(i * 2 + j + ti) % 3], c, (cw - 0.06, cd - 0.05, ch - 0.02), r.uniform(-0.04, 0.04))
    for k in range(1 + (W * D > 9)):                           # a crate or two on top
        dz.crate(boxes_p, (r.uniform(-hw * 0.4, hw * 0.4), r.uniform(-hd * 0.3, hd * 0.3), 1.77), (0.9, 0.6, 0.45), r.uniform(-0.3, 0.3))
    K.part(boxes_y, 'wood_paint', name='crates_dak', mat_tint=DAK, grime=0.8, bisect=False)
    K.part(boxes_p, 'wood_paint', name='crates_pine', mat_tint=PINE, grime=0.7, bisect=False)
    K.part(boxes_g, 'wood_paint', name='crates_grey', mat_tint=(0.56, 0.58, 0.5), grime=0.8, bisect=False)
    # tarpaulin draped over the N half, roped down
    bm = bmesh.new()
    nx, ny = 6, 4
    ztop = 1.79
    vv = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            x = -hw - 0.05 + (2 * hw + 0.1) * i / nx
            y = 0.1 + (hd + 0.05 - 0.1) * j / ny
            z = ztop + 0.03 + r.uniform(-0.03, 0.04)
            if j == ny:
                y += 0.06; z = ztop - 0.65 - 0.2 * math.sin(math.pi * i / nx)
            if i in (0, nx):
                x += (-0.06 if i == 0 else 0.06); z = min(z, ztop - 0.5)
            row.append(bm.verts.new(V((x, y, z))))
        vv.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vv[i][j], vv[i + 1][j], vv[i + 1][j + 1], vv[i][j + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    K.part(bm, 'canvas', name='tarp', mat_tint=(0.66, 0.6, 0.44), grime=0.6, bisect=False, smooth=True)
    for x in (-hw * 0.5, hw * 0.5):
        wire((x, 0.1, ztop + 0.06), (x, hd + 0.12, ztop - 0.7), sag=0.02, name='rope', r=0.012)
    jerrycans((hw - 0.2, -hd - 0.25, 0), n=3, rot=math.pi / 2)
    K.decal('stain_blotch', (0, 0, 0.01), (0, 0, 1), W + 0.6, D + 0.6, alpha=0.3)
    K.footprint(rect(-W / 2, -D / 2, W / 2, D / 2), 'HIGH', 'building')
else:
    bm = bmesh.new()
    for x in (-0.55, 0.55):
        C.box_bm(bm, (x, 0, 0.07), (0.16, 1.15, 0.14))
    C.box_bm(bm, (0, 0, 0.16), (1.9, 1.15, 0.05))
    K.part(bm, 'timber_beam', name='skid', mat_tint=(0.62, 0.52, 0.4), grime=0.9, bisect=False)
    pts = [(x, y, 0.19) for x in (-0.65, 0, 0.65) for y in (-0.28, 0.28)] + [(x, 0, 1.08) for x in (-0.33, 0.33)]
    drums(pts, tint=(0.34, 0.4, 0.44))
    drums([(0.75, -0.75, 0)], tint=(0.34, 0.4, 0.44), lying=(0,))
    for k in range(3):
        K.decal('streak_rust', (-0.65 + 0.65 * k, -0.59, 0.6), (0, -1, 0), 0.3, 0.6, alpha=0.5)
    K.decal('stain_blotch', (0, 0, 0.01), (0, 0, 1), 2.4, 1.8, alpha=0.4)
    K.footprint(rect(-1.0, -0.6, 1.0, 0.6), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=32)
