"""Footbridges over streams (path along X, stream along Y).
  footbridge_plank(_snow): two debarked log stringers on dry-stone sills + a mid trestle bent in the stream,
                           nailed transverse planks (irregular), single handrail on posts with knee braces.
  footbridge_arch        : cambered timber footbridge (curved stringers in segments, planks following the curve,
                           lattice railings with capped newel posts), stone springer blocks at both banks."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
from brlib import K, C, V, part, box_bm, beam_bm, cyl_bm
import bmesh
import kit_weather as W
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
part = F.part

a = BL.args()
name = a[0] if a else 'footbridge_plank'
snow = name.endswith('_snow')
arch = 'arch' in name
WATER, BED = -0.8, -1.7
K.begin(name, 30 if not arch else 31, theater='snow' if snow else 'temperate', snow=snow, water_level=WATER)
r = K.rng()
if not arch:
    HALF, W_ = 4.0, 1.2
    ZD = 0.35
    X0, X1 = -HALF - 1.4, HALF + 1.4
    bm = bmesh.new()
    for yy in (-0.4, 0.4):                                       # one continuous debarked log per stringer (sag + taper)
        rings = []
        for i in range(9):
            t = i / 8
            x = X0 + (X1 - X0) * t
            rad = 0.165 - 0.035 * t + 0.008 * math.sin(t * 13 + yy)
            zc = ZD - 0.2 - 0.05 * math.sin(math.pi * t)
            rings.append([V((x, yy + rad * math.cos(2 * math.pi * k / 8) + 0.01 * math.sin(t * 7), zc + rad * math.sin(2 * math.pi * k / 8)))
                          for k in range(8)])
        C.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, 'timber_grey', name='stringers', uv='beam', axis=(1, 0, 0), smooth=True, grime=0.8, tint=(0.82, 0.78, 0.72))
    bm = bmesh.new()                                             # cross-bearers, mid bent (posts, cap, sill, X brace)
    for x in (X0 + 0.35, X1 - 0.35):
        beam_bm(bm, (x, -0.8, ZD - 0.42), (x, 0.8, ZD - 0.42), 0.2, 0.18)
    for yy in (-0.62, 0.62):
        beam_bm(bm, (0, yy * 1.25, BED), (0, yy, ZD - 0.5), 0.18, 0.18)
    beam_bm(bm, (0, -0.95, ZD - 0.46), (0, 0.95, ZD - 0.46), 0.22, 0.18)
    beam_bm(bm, (0, -0.95, BED + 0.1), (0, 0.95, BED + 0.1), 0.22, 0.18)
    for sx in (-1, 1):
        beam_bm(bm, (sx * 0.1, -0.74, WATER - 0.3), (sx * 0.1, 0.66, ZD - 0.6), 0.05, 0.14, up=(1, 0, 0))
        beam_bm(bm, (sx * 0.1, 0.74, WATER - 0.3), (sx * 0.1, -0.66, ZD - 0.6), 0.05, 0.14, up=(1, 0, 0))
    part(bm, 'timber_beam', name='bent', uv='beam', axis=(0, 0, 1), grime=0.9, tint=(0.75, 0.7, 0.64))
    bm = bmesh.new()
    n = int((X1 - X0) / 0.22)
    for k in range(n):
        x = X0 + (k + 0.5) * (X1 - X0) / n
        if r.random() < 0.04:
            continue                                                  # a missing board
        box_bm(bm, (x, r.uniform(-0.06, 0.06), ZD - 0.04 + r.uniform(-0.01, 0.01)), (0.2, W_ + r.uniform(-0.1, 0.12), 0.05), rot_z=r.uniform(-0.03, 0.03))
    part(bm, 'timber_grey', name='planks', uv='beam', axis=(0, 1, 0), grime=0.7, bisect=False, tint=(0.85, 0.82, 0.78))
    bm, irn, rope = bmesh.new(), bmesh.new(), bmesh.new()
    posts = [X0 + 0.4 + (X1 - X0 - 0.8) * i / 5 for i in range(6)]
    for s in (-1, 1):
        y = s * 0.66
        for x in posts:
            box_bm(bm, (x, y, ZD + 0.5), (0.12, 0.12, 1.08))
            beam_bm(bm, (x, y, ZD + 0.4), (x, s * 0.42, ZD - 0.28), 0.08, 0.1)            # knee brace to the stringer
            cyl_bm(irn, (x - 0.08, y, ZD + 0.97), (x + 0.08, y, ZD + 0.97), 0.022, 5)        # bolt through rail + post
            cyl_bm(irn, (x, y - s * 0.08, ZD - 0.12), (x, y + s * 0.08, ZD - 0.12), 0.02, 5)
            for k in range(3):                                                           # rope lashing at the knee
                zc = ZD + 0.36 + k * 0.04
                cyl_bm(rope, (x, y, zc), (x, y, zc + 0.03), 0.085, 6, caps=False)
        for xa, xb in zip(posts[:-1], posts[1:]):
            beam_bm(bm, (xa - 0.02, y, ZD + 1.0 + r.uniform(-0.01, 0.01)), (xb + 0.02, y, ZD + 1.0), 0.11, 0.09)
            beam_bm(bm, (xa, y, ZD + 0.52), (xb, y, ZD + 0.52), 0.07, 0.07)
    part(bm, 'timber_grey', name='handrail', uv='beam', axis=(1, 0, 0), grime=0.6, tint=(0.8, 0.77, 0.72))
    part(irn, 'cast_iron', name='bolts', grime=0.4, bisect=False)
    part(rope, 'hessian', name='lashings', grime=0.5, bisect=False, tint=(0.62, 0.52, 0.38))
    for side in (-1, 1):                                          # dry-stone sills: stacked flat stones under the logs
        bm = bmesh.new()
        xc = side * (HALF + 0.95)
        z = BED + 0.4
        k = 0
        while z < ZD - 0.5:
            for yy in (-0.55, 0.0, 0.55):
                h = r.uniform(0.16, 0.24)
                box_bm(bm, (xc + r.uniform(-0.08, 0.08), yy + (0.25 if k % 2 else 0) * (1 if yy < 0.5 else 0), z + h / 2),
                       (r.uniform(0.9, 1.2), r.uniform(0.5, 0.62), h - 0.02), rot_z=r.uniform(-0.12, 0.12))
            z += 0.21
            k += 1
        part(bm, 'fieldstone_grey', name='sill%d' % side, tint=(0.62, 0.62, 0.6))
        F.riprap_ring([(side * (HALF + 0.35), -1.2), (side * (HALF + 0.35), 1.2)], WATER, n=8, smin=0.25, smax=0.4,
                      off=(0.0, 0.4), name='toe%d' % side, mid='fieldstone_grey', out_dir=(-side, 0, 0))
    BL.water_obstacle([(-0.15, -0.9), (0.15, -0.9), (0.15, 0.9), (-0.15, 0.9)], 'bent', 1.0)
    WD = W_
    rw = 2 * HALF
else:
    HALF, W_ = 4.8, 1.6
    RISE = 1.1
    zf = lambda x: 0.15 + RISE * (1 - (x / (HALF + 0.3)) ** 2)
    N = 12
    xs = [-HALF - 0.3 + (2 * HALF + 0.6) * i / N for i in range(N + 1)]
    bm = bmesh.new()
    for yy in (-W_ / 2 + 0.1, W_ / 2 - 0.1):
        for x0, x1 in zip(xs[:-1], xs[1:]):
            beam_bm(bm, (x0, yy, zf(x0) - 0.28), (x1, yy, zf(x1) - 0.28), 0.14, 0.36)
    for x in xs[1:-1:2]:
        beam_bm(bm, (x, -W_ / 2, zf(x) - 0.4), (x, W_ / 2, zf(x) - 0.4), 0.1, 0.12)
    part(bm, 'timber_beam', name='stringers', uv='beam', axis=(1, 0, 0), grime=0.7)
    bm = bmesh.new()
    n = int((2 * HALF + 0.6) / 0.2)
    for k in range(n):
        x = -HALF - 0.3 + (k + 0.5) * (2 * HALF + 0.6) / n
        sl = math.atan(-2 * RISE * x / (HALF + 0.3) ** 2)
        c = V((x, 0, zf(x) - 0.05))
        d = V((math.cos(sl), 0, math.sin(sl))) * 0.09
        beam_bm(bm, c - V((0, W_ / 2 + 0.05, 0)), c + V((0, W_ / 2 + 0.05, 0)), 0.18, 0.05, up=tuple(V((-math.sin(sl), 0, math.cos(sl)))))
    part(bm, 'deck_planks', name='planks', uv='beam', axis=(0, 1, 0), grime=0.6, bisect=False)
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * (W_ / 2 + 0.02)
        for x in xs[::2]:
            box_bm(bm, (x, y, zf(x) + 0.5), (0.1, 0.1, 1.05))
            box_bm(bm, (x, y, zf(x) + 1.06), (0.15, 0.15, 0.06))
        for x0, x1 in zip(xs[:-1:2], xs[2::2]):
            beam_bm(bm, (x0, y, zf(x0) + 1.0), (x1, y, zf(x1) + 1.0), 0.09, 0.07)
            beam_bm(bm, (x0, y, zf(x0) + 0.12), (x1, y, zf(x1) + 0.12), 0.06, 0.06)
            beam_bm(bm, (x0 + 0.06, y, zf(x0) + 0.16), (x1 - 0.06, y, zf(x1) + 0.95), 0.04, 0.06, up=(0, 1, 0))
            beam_bm(bm, (x1 - 0.06, y, zf(x1) + 0.16), (x0 + 0.06, y, zf(x0) + 0.95), 0.04, 0.06, up=(0, 1, 0))
    part(bm, 'wood_paint', name='railings', uv='beam', axis=(1, 0, 0), tint=(0.35, 0.42, 0.33), grime=0.6)
    for side in (-1, 1):
        bm = bmesh.new()
        box_bm(bm, (side * (HALF + 0.3), 0, (BED + 0.1) / 2), (1.0, W_ + 0.6, 0.1 - BED))
        part(bm, 'ashlar', name='springer%d' % side)
        W.decal('waterline', (side * (HALF - 0.21), 0, WATER + 0.25), (-side, 0, 0), W_ + 0.4, 1.0)
        BL.water_obstacle([(side * (HALF - 0.2), -W_ / 2 - 0.3), (side * (HALF + 0.8), -W_ / 2 - 0.3), (side * (HALF + 0.8), W_ / 2 + 0.3), (side * (HALF - 0.2), W_ / 2 + 0.3)], 'abutment', 0.3, block=None)
    X0, X1, WD = -HALF - 0.3, HALF + 0.3, W_
    rw = 2 * HALF - 0.4
K.bridge_meta(K.Deck(X0, X1, 0.35, 0.0), X0, X1, WD, WATER, rw, {'kind': 'footbridge_arch' if arch else 'footbridge_plank',
              'deck_profile': 'parabolic rise 1.1' if arch else 'flat', 'vehicles': False})
if snow:
    caps = [o for o in C.A.parts if o.name.startswith(('handrail', 'stringers', 'bent', 'sill', 'railings', 'springer'))]
    F.snow_caps(caps, thick=0.07, min_nz=0.35)
    F.road_snow(lambda x: 0.35 - 0.02 if not arch else zf(x), X0, X1, WD - 0.1, crown=0.0, ruts=(0.05,), rut_w=0.28, base=0.08,
                drift=0.1, step=0.5, name='snow_path')
    F.ice_shelf([(-0.2, -0.9), (0.2, -0.9), (0.2, 0.9), (-0.2, 0.9)], WATER, reach=(0.2, 0.6), name='ice_collar')
    for side in (-1, 1):
        F.ice_shelf([(side * (rw / 2 - 0.1), -2.0), (side * (rw / 2 - 0.1), 2.0), (side * rw / 2, 0)], WATER, reach=(0.3, 0.9), name='ice_bank')
    F.icicles([(x, s * (WD / 2 + 0.05), 0.3) for x in [X0 + (X1 - X0) * k / 14 for k in range(15)] for s in (-1, 1)], (0.08, 0.3))
F.weather(mids=('timber_grey', 'timber_beam', 'fieldstone_grey', 'ashlar', 'wood_paint', 'deck_planks'), theme='temperate', lichen=0.45,
          moss=0.7, base=0.95, step=99, skip=('decal', 'snow', 'ice', 'icicles'))
F2.cull_decals()
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=512, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
