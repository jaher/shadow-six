"""Norwegian timber road bridge (M1/M3 hinterland), reworked: cambered deck (0.45 m rise) on tarred trestle bents
(plumb + battered posts, caps, sills, heavy weathered-grey X-bracing and girts), plank-sheathed ice-breakers with
framed raked noses and iron nosing, log-crib abutments filled with stone, stringers following the camber, grey plank
deck with running boards and wheel guards, lattice railings with tall capped posts on outrigger knee braces.
Variants: bridge_timber_road | bridge_timber_road_snow (drifted deck with ruts, caps on caps/braces/rails, ice collars,
icicles)."""
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
name = a[0] if a else 'bridge_timber_road'
snow = name.endswith('_snow')
WATER, BED, ZD, WID = -2.4, -4.2, 0.55, 4.6
HALF = 15.0
X0, X1 = -HALF - 3.0, HALF + 3.0
CAM = 0.45
zd = lambda x: ZD + CAM * max(0.0, 1 - (x / X1) ** 2)
K.begin(name, 7, theater='snow' if snow else 'temperate', snow=snow, water_level=WATER)
r = K.rng()
bx = [-10.0, -5.0, 0.0, 5.0, 10.0]
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
part(bm, 'timber_tarred', name='bents', uv='beam', axis=(0, 0, 1), grime=0.9, tint=(0.95, 0.92, 0.88))
part(br, 'timber_grey', name='bracing', uv='beam', axis=(0, 1, 0), grime=0.8, tint=(0.9, 0.88, 0.84))
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
# ---- ice breakers (starlings) upstream of every bent: framed raked nose, horizontal plank sheathing, iron nosing
for x in bx:
    y0 = -(WID / 2 + 0.2)
    Ln = 3.4
    zt = WATER + 1.3
    ztop = lambda z: z
    ynose = lambda z: (y0 - Ln) + (Ln - 0.5) * (z - BED) / (zt + 0.25 - BED)
    bm = bmesh.new()                                         # dark core (seen between planks)
    p8 = [V((x - 0.4, y0, BED)), V((x + 0.4, y0, BED)), V((x + 0.08, y0 - Ln + 0.1, BED)), V((x - 0.08, y0 - Ln + 0.1, BED)),
          V((x - 0.4, y0, zt + 0.35)), V((x + 0.4, y0, zt + 0.35)), V((x + 0.08, y0 - 0.55, zt + 0.2)), V((x - 0.08, y0 - 0.55, zt + 0.2))]
    C.hexa_bm(bm, p8)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part(bm, 'timber_tarred', name='icebreaker_core', uv='beam', axis=(0, 1, 0), tint=(0.6, 0.58, 0.55))
    bm = bmesh.new()
    z = WATER - 0.9
    while z < zt + 0.1:
        yn = ynose(z + 0.13)
        for sx in (-1, 1):
            pa, pb = V((x + sx * 0.47, y0, z + 0.13)), V((x + sx * 0.14, yn + 0.06, z + 0.13))
            beam_bm(bm, pa, pb, 0.07, 0.25, up=(0, 0, 1))
        z += 0.27
    for sx in (-1, 1):                                       # frame: corner post at the bent + raked rafter
        beam_bm(bm, (x + sx * 0.45, y0, BED), (x + sx * 0.45, y0, zt + 0.42), 0.2, 0.2)
        beam_bm(bm, (x + sx * 0.3, y0 - 0.1, zt + 0.42), (x + sx * 0.08, y0 - 0.6, zt + 0.25), 0.14, 0.14)
    beam_bm(bm, (x, y0, zt + 0.45), (x, y0 - 0.6, zt + 0.28), 0.8, 0.1)                   # top plank cap
    part(bm, 'timber_grey', name='icebreaker_planks', uv='beam', axis=(0, 1, 0), grime=1.0, tint=(0.72, 0.68, 0.62))
    bm = bmesh.new()
    beam_bm(bm, (x, y0 - Ln - 0.02, BED), (x, y0 - 0.55, zt + 0.3), 0.16, 0.08)            # iron-shod nose
    for k in range(4):
        t = (k + 0.5) / 4
        p = V((x, y0 - Ln - 0.02, BED)).lerp(V((x, y0 - 0.55, zt + 0.3)), t)
        for sx in (-1, 1):
            cyl_bm(bm, p + V((sx * 0.08, 0, 0)), p + V((sx * 0.1, 0, 0)), 0.025, 5)
    part(bm, 'cast_iron', name='icebreaker_nose', grime=0.9)
    BL.water_obstacle([(x, y0 - Ln), (x + 0.6, y0), (x + 0.6, WID / 2 + 0.7), (x - 0.6, WID / 2 + 0.7), (x - 0.6, y0)], 'bent', 1.0)
# ---- log-crib abutments filled with stone, toe boulders against the crib face, approach ramps
for side in (-1, 1):
    xf = side * HALF
    D = 4.0
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
    part(bm, 'timber_tarred', name='crib%d' % side, uv='beam', axis=(0, 1, 0), smooth=True, grime=0.8, tint=(0.9, 0.86, 0.8))
    BL.riprap(xf + side * D / 2, 0, D / 2 - 0.3, WID / 2 + 0.4, ZD - 0.9, n=22, smin=0.25, smax=0.5, mid='fieldstone_grey', name='crib_fill%d' % side)
    F.riprap_ring([(xf - side * 0.25, -WID / 2 - 1.2), (xf - side * 0.25, WID / 2 + 1.2)], WATER, n=14, smin=0.3, smax=0.55,
                  off=(0.0, 0.5), name='toe%d' % side, mid='granite', out_dir=(-side, 0, 0))
    BL.water_obstacle([(xf, -WID / 2 - 0.9), (xf + side * D, -WID / 2 - 0.9), (xf + side * D, WID / 2 + 0.9), (xf, WID / 2 + 0.9)], 'abutment', 0.5)
    bm = bmesh.new()
    xa, xb = xf + side * (D - 0.2), xf + side * (D + 3.5)
    q = [bm.verts.new((xa, -WID / 2, zd(xa) - 0.04)), bm.verts.new((xa, WID / 2, zd(xa) - 0.04)),
         bm.verts.new((xb, WID / 2, 0.02)), bm.verts.new((xb, -WID / 2, 0.02))]
    f = bm.faces.new(q)
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    part(bm, 'snow' if snow else 'gravel', name='ramp%d' % side, grime=0.3, bisect=False, lod='keep',
         tint=(0.9, 0.92, 0.95) if snow else None)
K.sign((-HALF - 2.4, -(WID / 2 + 0.45), ZD + 1.7), (0, -1, 0), 0.9, 'brucke_12t', 'timber_grey')
K.bridge_meta(K.Deck(X0 - 3.5, X1 + 3.5, ZD, 0.0), X0 - 3.5, X1 + 3.5, WID, WATER, 2 * HALF,
              {'kind': 'timber_trestle', 'bents': bx, 'destructible': True, 'deck_z': ZD, 'deck_camber': CAM,
               'deck_z_mid': round(zd(0), 3)})
C.anchor('demolition', (0, 0, zd(0)), kind='charge_marker')
if snow:
    caps = [o for o in C.A.parts if o.name.startswith(('bents', 'bracing', 'railings', 'running_boards', 'icebreaker_planks'))]
    F.snow_caps(caps, thick=0.09, min_nz=0.35)
    XA, XB = HALF + 3.8, HALF + 7.3                     # approach pads: the snow sheet runs on down the ramps
    zr = lambda x: zd(x) if abs(x) <= XA else (zd(XA) - 0.04) + (0.02 - (zd(XA) - 0.04)) * min(1.0, (abs(x) - XA) / (XB - XA))
    F.RUT_WANDER, F.RUT_COL, F.TRODDEN = 0.08, (0.5, 0.47, 0.42), 0.6
    F.road_snow(zr, -XB, XB, WID - 0.8, crown=0.0, ruts=(-0.95, 0.95), rut_w=0.3, base=0.1, drift=0.18, step=0.9)
    for x in bx:
        for yy in (-WID / 2 - 0.3, -0.45, 0.45, WID / 2 + 0.3):
            F.ice_shelf([(x - 0.25, yy - 0.25), (x + 0.25, yy - 0.25), (x + 0.25, yy + 0.25), (x - 0.25, yy + 0.25)], WATER,
                        reach=(0.25, 0.7), name='ice_collar', m=16)
        F.ice_shelf([(x, -(WID / 2 + 0.2) - 3.0), (x + 0.5, -(WID / 2 + 0.2)), (x - 0.5, -(WID / 2 + 0.2))], WATER, reach=(0.3, 0.9),
                    name='ice_breaker_ice')
    for side in (-1, 1):
        F.ice_shelf([(side * HALF - side * 0.3, -WID / 2 - 1.2), (side * HALF - side * 0.3, WID / 2 + 1.2), (side * HALF, 0)], WATER,
                    reach=(0.6, 1.6), name='ice_bank', floes=3, bounds=(-HALF + 2, -9, HALF - 2, 9))
    ic = []
    for x in [X0 + (X1 - X0) * i / 13 for i in range(14)]:
        for s in (-1, 1):
            ic.append((x + r.uniform(-0.3, 0.3), s * (WID / 2 + 0.02), zd(x) - 0.12))
    for x in bx:
        for yy in (-1.6, 0.0, 1.6):
            ic.append((x, yy, zd(x) - 0.84))
    F.icicles(ic, (0.12, 0.5))
F.weather(mids=('timber_tarred', 'timber_grey', 'timber_beam', 'fieldstone_grey'), theme='temperate', deck=K.Deck(X0, X1, ZD + CAM, 0.0),
          step=99, lichen=0.35, moss=0.6, base=0.95, skip=('decal', 'snow', 'ice', 'icicles', 'sign'))
F2.cull_decals()
F2.trim_to(24300, ('snow_caps', 'bracing', 'bents', 'ice_', 'crib', 'toe', 'crib_fill', 'icicles'))
K.finalize(os.path.join(BL.OUTROOT, name), ao_res=1024, ao_samples=64, lods=((0.45, 0.30, 3.0), (0.3, 0.9, 3.0)))
