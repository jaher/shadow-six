"""Desert timber trestle road bridge (M8 Tell el Eisa, the wadi crossing and the extraction point): sun-bleached
trestle bents (plumb + battered posts, caps, sills, X-bracing and girts) standing on stone footing pads in a dry gravel
wadi bed, stringers under a slightly cambered plank deck with running boards and wheel guards, lattice railings on
knee-braced outriggers, timber-crib abutments filled with limestone rubble on the wadi banks, gravel approach ramps,
a load board. Deck 19 m over all (ramps included) x 4.6 m; bed 2.6 m below the road. No water.
Usage: blender -b --python bridge_timber_trestle.py -- [bridge_timber_trestle]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brlib as BL
import brfix as F
import brfix2 as F2   # round-2: COLOR_0 export, bridge-aware AO ground, decal culling, LOD2 delimit
import brfix3 as F3   # round-4: ice v3 collars, LOD triangle targets
F3.RATIO_FLOOR[2] = 0.03   # beam/box assemblies survive deep collapse (checked at 0.5x)
from brlib import K, C, V, box_bm, beam_bm, cyl_bm
import bmesh
import kit_weather as W
part = F.part

a = BL.args()
name = a[0] if a else 'bridge_timber_trestle'
snow = name.endswith('_snow')
WATER, BED, ZD, WID = -3.6, -2.6, 0.42, 4.6
HALF = 5.6
X0, X1 = -HALF - 2.4, HALF + 2.4
CAM = 0.12
zd = lambda x: ZD + CAM * max(0.0, 1 - (x / X1) ** 2)
K.begin(name, 7, theater='desert', snow=False, water_level=WATER)
r = K.rng()
bx = [-2.8, 0.0, 2.8]
# ---- bents: 4 posts (outer battered), cap, sill, X-bracing on both faces, girt
bm, br = bmesh.new(), bmesh.new()
for x in bx:
    zc = zd(x) - 0.53
    H = zc - BED
    bat = 0.12 * H
    tops = [-WID / 2 + 0.2, -0.45, 0.45, WID / 2 - 0.2]
    bots = [tops[0] - bat, tops[1], tops[2], tops[3] + bat]
    for yt, yb in zip(tops, bots):
        beam_bm(bm, (x, yb, BED), (x, yt, zc - 0.15), 0.3, 0.3)
    beam_bm(bm, (x, tops[0] - 0.35, zc - 0.15), (x, tops[3] + 0.35, zc - 0.15), 0.36, 0.32)
    beam_bm(bm, (x, bots[0] - 0.35, BED + 0.15), (x, bots[3] + 0.35, BED + 0.15), 0.34, 0.3)
    yl = lambda z: (tops[0] - bat * (1 - (z - BED) / H), tops[3] + bat * (1 - (z - BED) / H))
    for za, zb in ((BED + 0.3, BED + H * 0.48), (BED + H * 0.48, zc - 0.35)):
        (l0, r0), (l1, r1) = yl(za), yl(zb)
        for sx in (-1, 1):
            xo = x + sx * 0.21
            beam_bm(br, (xo, l0, za), (xo, r1, zb), 0.1, 0.26, up=(1, 0, 0))
            beam_bm(br, (xo, r0, za), (xo, l1, zb), 0.1, 0.26, up=(1, 0, 0))
    l0, r0 = yl(BED + H * 0.48)
    for sx in (-1, 1):
        beam_bm(br, (x + sx * 0.21, l0 - 0.15, BED + H * 0.48), (x + sx * 0.21, r0 + 0.15, BED + H * 0.48), 0.1, 0.26, up=(1, 0, 0))
part(bm, 'timber_tarred', name='bents', uv='beam', axis=(0, 0, 1), grime=0.9, tint=(1.45, 1.3, 1.1))
part(br, 'timber_grey', name='bracing', uv='beam', axis=(0, 1, 0), grime=0.8, tint=(1.25, 1.15, 1.0))
# ---- stringers, cambered plank deck, running boards, wheel guards
xs = [X0 - 0.3] + bx + [X1 + 0.3]
bm = bmesh.new()
for xa, xb in zip(xs[:-1], xs[1:]):
    for yy in (-1.5, -0.5, 0.5, 1.5):
        beam_bm(bm, (xa - 0.25, yy, zd(xa) - 0.32), (xb + 0.25, yy, zd(xb) - 0.32), 0.26, 0.4)
part(bm, 'timber_beam', name='stringers', uv='beam', axis=(1, 0, 0), tint=(0.78, 0.74, 0.7))
bm = bmesh.new()
n = int((X1 - X0 + 0.6) / 0.26)
for i in range(n):
    x = X0 - 0.3 + (i + 0.5) * (X1 - X0 + 0.6) / n
    box_bm(bm, (x, r.uniform(-0.06, 0.06), zd(x) - 0.075 + r.uniform(-0.008, 0.008)), ((X1 - X0 + 0.6) / n - 0.014, WID + r.uniform(-0.1, 0.1), 0.09))
part(bm, 'timber_grey', name='deck', uv='beam', axis=(0, 1, 0), grime=0.6, bisect=False, tint=(0.86, 0.84, 0.8))
bm = bmesh.new()
for yy in (-0.95, 0.95):
    for k in range(12):
        xa = X0 + (X1 - X0) * k / 12 + 0.02
        xb = X0 + (X1 - X0) * (k + 1) / 12 - 0.02
        beam_bm(bm, (xa, yy + r.uniform(-0.03, 0.03), zd(xa)), (xb, yy, zd(xb)), 0.85, 0.06)
for s in (-1, 1):
    for xa, xb in zip(xs[:-1], xs[1:]):
        beam_bm(bm, (xa, s * (WID / 2 - 0.3), zd(xa) + 0.08), (xb, s * (WID / 2 - 0.3), zd(xb) + 0.08), 0.2, 0.22)
part(bm, 'timber_beam', name='running_boards', uv='beam', axis=(1, 0, 0), grime=0.7, bisect=False, tint=(0.8, 0.76, 0.7))
# ---- outriggers, knee braces, tall capped rail posts, top / mid rails and flat-bar lattice following the camber
bm, lat = bmesh.new(), bmesh.new()
bays = 18
px_ = [X0 + (X1 - X0) * i / bays for i in range(bays + 1)]
for x in px_:
    for s in (-1, 1):
        yp = s * (WID / 2 + 0.25)
        z = zd(x)
        beam_bm(bm, (x, s * (WID / 2 - 0.4), z - 0.3), (x, s * (WID / 2 + 0.45), z - 0.3), 0.2, 0.2)
        box_bm(bm, (x, yp, z + 0.55), (0.18, 0.18, 1.62))
        box_bm(bm, (x, yp, z + 1.42), (0.24, 0.24, 0.12), 0, (0.3, 0.3))                    # pyramidal post cap
        beam_bm(bm, (x, yp - s * 0.02, z + 0.5), (x, s * (WID / 2 + 0.35), z - 0.4), 0.1, 0.12)
for s in (-1, 1):
    yp = s * (WID / 2 + 0.25)
    for xa, xb in zip(px_[:-1], px_[1:]):
        beam_bm(bm, (xa, yp, zd(xa) + 1.12), (xb, yp, zd(xb) + 1.12), 0.14, 0.13)
        beam_bm(bm, (xa, yp, zd(xa) + 0.2), (xb, yp, zd(xb) + 0.2), 0.1, 0.1)
        a0, b0 = V((xa + 0.09, yp, zd(xa) + 0.25)), V((xb - 0.09, yp, zd(xb) + 1.06))
        a1, b1 = V((xb - 0.09, yp, zd(xb) + 0.25)), V((xa + 0.09, yp, zd(xa) + 1.06))
        for pa, pb in ((a0, b0), (a1, b1)):
            d = (pb - pa).normalized()
            sd = V((0, 1, 0)).cross(d).normalized() * 0.045
            q = [pa - sd, pb - sd, pb + sd, pa + sd]
            for off in (0.03, -0.03):
                f = lat.faces.new([lat.verts.new(p + V((0, off, 0))) for p in q])
                f.normal_update()
                if f.normal.y * off < 0:
                    f.normal_flip()
part(bm, 'timber_grey', name='railings', uv='beam', axis=(1, 0, 0), grime=0.7, lod='keep', tint=(0.82, 0.8, 0.76))
part(lat, 'timber_grey', name='rail_lattice', uv='beam', axis=(1, 0, 0), grime=0.7, bisect=False, lod='drop', tint=(0.78, 0.76, 0.72))
C.A.meta.setdefault('parapets', []).extend([{'a': C.g2((X0, s * (WID / 2 + 0.25))), 'b': C.g2((X1, s * (WID / 2 + 0.25))), 'h': 1.2, 'block': 'FENCE'} for s in (-1, 1)])
# ---- footing pads under the bents (dressed limestone blocks bedded in the gravel)
bm = bmesh.new()
for x in bx:
    box_bm(bm, (x, 0, BED + 0.12), (0.9, WID + 1.0, 0.36))
part(bm, 'sandstone_ochre', name='footings', grime=0.6, tint=(0.95, 0.9, 0.82))
# ---- log-crib abutments filled with stone, toe boulders against the crib face, approach ramps
for side in (-1, 1):
    xf = side * HALF
    D = 2.2
    bm = bmesh.new()
    z, k = BED, 0
    while z < ZD - 0.6:
        rr = 0.16
        zc = z + rr
        if k % 2 == 0:
            for xx in (xf + side * 0.2, xf + side * (D - 0.2)):
                cyl_bm(bm, (xx, -WID / 2 - 0.9 - r.uniform(0, 0.15), zc), (xx, WID / 2 + 0.9 + r.uniform(0, 0.15), zc), rr * r.uniform(0.9, 1.1), 7)
        else:
            for yy in (-WID / 2 - 0.6, WID / 2 + 0.6):
                cyl_bm(bm, (xf - side * (0.2 + r.uniform(0, 0.15)), yy, zc), (xf + side * (D + 0.2), yy, zc), rr, 7)
        z += rr * 1.75
        k += 1
    part(bm, 'timber_tarred', name='crib%d' % side, uv='beam', axis=(0, 1, 0), smooth=True, grime=0.8, tint=(1.4, 1.25, 1.05))
    BL.riprap(xf + side * D / 2, 0, D / 2 - 0.3, WID / 2 + 0.4, ZD - 0.9, n=22, smin=0.25, smax=0.5, mid='sandstone_ochre', name='crib_fill%d' % side)
    F.riprap_ring([(xf - side * 0.25, -WID / 2 - 1.2), (xf - side * 0.25, WID / 2 + 1.2)], BED + 0.1, n=14, smin=0.3, smax=0.55,
                  off=(0.0, 0.5), name='toe%d' % side, mid='sandstone_ochre', out_dir=(-side, 0, 0))
    bm = bmesh.new()
    xa, xb = xf + side * (D - 0.2), side * 9.5
    q = [bm.verts.new((xa, -WID / 2, zd(xa) - 0.04)), bm.verts.new((xa, WID / 2, zd(xa) - 0.04)),
         bm.verts.new((xb, WID / 2, 0.02)), bm.verts.new((xb, -WID / 2, 0.02))]
    f = bm.faces.new(q)
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    part(bm, 'gravel', name='ramp%d' % side, grime=0.3, bisect=False, lod='keep',
         tint=(1.05, 0.98, 0.86))
K.sign((-HALF - 3.6, -(WID / 2 + 0.45), ZD + 1.7), (0, -1, 0), 0.9, 'brucke_12t', 'timber_grey')
K.bridge_meta(K.Deck(-9.5, 9.5, ZD, 0.0), -9.5, 9.5, WID, WATER, 2 * HALF,
              {'kind': 'timber_trestle', 'bents': bx, 'destructible': True, 'deck_z': ZD, 'deck_camber': CAM,
               'deck_z_mid': round(zd(0), 3)})
C.anchor('demolition', (0, 0, zd(0)), kind='charge_marker')
F.weather(mids=('timber_tarred', 'timber_grey', 'timber_beam', 'sandstone_ochre'), theme='desert', deck=K.Deck(X0, X1, ZD + CAM, 0.0),
          step=99, lichen=0.0, moss=0.0, base=0.95, skip=('decal', 'sign'))
F2.cull_decals()
F2.trim_to(24300, ('bracing', 'bents', 'crib', 'toe', 'crib_fill'))
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
