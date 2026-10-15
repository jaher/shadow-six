"""Shared helpers for the M10 El Agheila camp + airfield assets (Libya, Nov 1942): on top of the M9 bq_common / dz desert kit.
Lattice steel (angle iron), riveted tanks, pipe runs. argv after '--': outroot variant seed."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bq_common import *          # noqa: F401,F403  (dz, K, C, KA, V, bmesh, rect, posts, beams, wire, drums, ...)

STEEL = (0.6, 0.58, 0.53)          # weathered grey lattice steel
RUST = (0.55, 0.36, 0.24)
TANKW = (0.9, 0.88, 0.82)          # sun-bleached white tank paint


def lattice_tower(legs_bot, legs_top, z0, z1, levels=4, w=0.12, name='lattice', tint=STEEL, mid='paint_metal', x_brace=True):
    """Four (or n) angle-iron legs from legs_bot (at z0) to legs_top (at z1), horizontal girts at `levels` and X bracing."""
    bm = bmesh.new()
    n = len(legs_bot)
    pts = []
    for i in range(levels + 1):
        t = i / levels
        z = z0 + (z1 - z0) * t
        ring = [V((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z)) for a, b in zip(legs_bot, legs_top)]
        pts.append(ring)
    for k in range(n):
        dz.angle_bm(bm, pts[0][k], pts[-1][k], w=w, t=0.014)
    for i in range(1, levels + 1):
        for k in range(n):
            dz.angle_bm(bm, pts[i][k], pts[i][(k + 1) % n], w=w * 0.6, t=0.01)
    if x_brace:
        for i in range(levels):
            for k in range(n):
                a, b = pts[i][k], pts[i][(k + 1) % n]
                c, d = pts[i + 1][k], pts[i + 1][(k + 1) % n]
                dz.angle_bm(bm, a, d, w=w * 0.45, t=0.008)
                dz.angle_bm(bm, b, c, w=w * 0.45, t=0.008)
    K.part(bm, mid, name=name, mat_tint=tint, uv='keep', grime=0.7, bisect=False)
    return pts


def footings(pts, s=0.55, h=0.35, name='footings'):
    bm = bmesh.new()
    for p in pts:
        C.box_bm(bm, (p[0], p[1], h / 2 - 0.1), (s, s, h), taper=(0.85, 0.85))
    K.part(bm, 'concrete_aggregate', name=name, mat_tint=(0.86, 0.8, 0.7), grime=0.8, bisect=False)


def pipe(pts, r=0.08, name='pipe', tint=(0.5, 0.46, 0.4), mid='paint_metal', flanges=True, segs=8):
    """A pipe run through 3D points with flanges at every joint."""
    bm = bmesh.new()
    pts = [V(p) for p in pts]
    for a, b in zip(pts, pts[1:]):
        C.cyl_bm(bm, a, b, r, segs)
    if flanges:
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            C.cyl_bm(bm, p - d * 0.03, p + d * 0.03, r * 1.6, segs)
    K.part(bm, mid, name=name, mat_tint=tint, grime=0.8, bisect=False, smooth=True)


def valve(p, axis=(1, 0, 0), r=0.08, name='valve'):
    """Gate valve: a body on the pipe, a stem and a red hand wheel on top."""
    p = V(p)
    bm = bmesh.new()
    a = V(axis).normalized()
    C.cyl_bm(bm, p - a * 0.15, p + a * 0.15, r * 1.9, 8)
    C.cyl_bm(bm, p, p + V((0, 0, 0.45)), 0.025, 6)
    K.part(bm, 'cast_iron', name=name, mat_tint=(0.35, 0.34, 0.32), grime=0.8, bisect=False)
    bm = bmesh.new()
    C.cyl_bm(bm, p + V((0, 0, 0.44)), p + V((0, 0, 0.48)), 0.2, 12)
    K.part(bm, 'paint_metal', name=name + '_wheel', mat_tint=(0.62, 0.16, 0.12), grime=0.5, bisect=False)


def cage_ladder(x, y, z0, z1, normal=(0, -1, 0), name='ladder', cage_from=2.2):
    """Steel rung ladder against a structure with a safety cage from `cage_from` m up."""
    n = V(normal).normalized()
    t = V((-n.y, n.x, 0))
    base = V((x, y, 0))
    bm = bmesh.new()
    for s in (-1, 1):
        C.cyl_bm(bm, base + t * 0.22 * s + V((0, 0, z0)), base + t * 0.22 * s + V((0, 0, z1 + 0.9)), 0.022, 5)
    z = z0 + 0.3
    while z < z1:
        C.cyl_bm(bm, base - t * 0.22 + V((0, 0, z)), base + t * 0.22 + V((0, 0, z)), 0.012, 4)
        z += 0.3
    z = z0 + cage_from
    while z < z1 + 0.8:
        pts = [base + t * (0.32 * math.cos(a)) + n * (0.38 + 0.36 * math.sin(a)) + V((0, 0, z)) for a in [math.pi * i / 6 for i in range(7)]]
        for a, b in zip(pts, pts[1:]):
            C.cyl_bm(bm, a, b, 0.012, 4, caps=False)
        z += 0.9
    for a in (0, math.pi / 2, math.pi):
        p = base + t * (0.32 * math.cos(a)) + n * (0.38 + 0.36 * math.sin(a))
        C.cyl_bm(bm, p + V((0, 0, z0 + cage_from)), p + V((0, 0, z1 + 0.8)), 0.012, 4)
    K.part(bm, 'paint_metal', name=name, mat_tint=STEEL, grime=0.6, bisect=False)


def riveted_tank(c, r, z0, h, tint=TANKW, name='tank', segs=24, bands=3, roof='cone', mid='paint_metal'):
    """Riveted steel cylinder with seam bands, a cone or flat roof with a hatch; returns the roof top z."""
    c = V((c[0], c[1], 0))
    bm = bmesh.new()
    C.cyl_bm(bm, c + V((0, 0, z0)), c + V((0, 0, z0 + h)), r, segs)
    K.part(bm, mid, name=name, mat_tint=tint, grime=0.9, smooth=True, bisect=False)
    bm = bmesh.new()
    for k in range(bands + 1):
        z = z0 + h * k / bands
        C.cyl_bm(bm, c + V((0, 0, z - 0.03)), c + V((0, 0, z + 0.03)), r + 0.015, segs, caps=False)
    K.part(bm, mid, name=name + '_seams', mat_tint=tuple(v * 0.85 for v in tint), grime=0.9, smooth=True, bisect=False)
    top = z0 + h
    bm = bmesh.new()
    if roof == 'cone':
        C.cyl_bm(bm, c + V((0, 0, top)), c + V((0, 0, top + r * 0.35)), r + 0.06, segs, r1=0.2)
        top += r * 0.35
    else:
        C.cyl_bm(bm, c + V((0, 0, top)), c + V((0, 0, top + 0.06)), r + 0.04, segs)
        top += 0.06
    C.box_bm(bm, tuple(c + V((r * 0.35, 0, top - r * 0.12 + 0.08))), (0.5, 0.5, 0.16))
    K.part(bm, mid, name=name + '_roof', mat_tint=tuple(v * 0.92 for v in tint), grime=1.0, smooth=True, bisect=False)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.4
        p = c + V((math.cos(a) * (r + 0.02), math.sin(a) * (r + 0.02), z0 + h * 0.75))
        K.decal('streak_rust', tuple(p), (math.cos(a), math.sin(a), 0), 0.35, h * 0.6, alpha=0.5)
    return top


def bagwall(p0, p1, rows=4, name='bags', z0=0.0, bl=0.6, bw=0.34, bh=0.15, vary=0.0, tint=(1.0, 0.95, 0.85)):
    """Light stretcher-bond sandbag course (one bag deep): plain boxes, the unseen bottoms dropped (~10 tris a bag).
    vary > 0: per-bag tone (old/new hessian, damp, sun-bleached) and a shaded underside/seam baked into the vertex colours."""
    rr = K.rng()
    p0, p1 = V((*p0[:2], 0)), V((*p1[:2], 0))
    d = p1 - p0
    L = d.length
    d.normalize()
    ang = math.atan2(d.y, d.x)
    bm = bmesh.new()
    tl = bm.faces.layers.float.new('bag_tone') if vary else None
    cl = bm.faces.layers.float.new('bag_cz') if vary else None
    for row in range(rows):
        off = (bl / 2) * (row % 2)
        k = int((L - off) / bl)
        for j in range(k):
            c = p0 + d * (off + bl * (j + 0.5)) + V((rr.uniform(-0.02, 0.02), rr.uniform(-0.02, 0.02), z0 + row * 0.14 + bh / 2))
            ll = bl - 0.04 + (rr.uniform(0.02, 0.07) if vary else 0)      # varied bags squash against each other
            fs = C.box_bm(bm, tuple(c), (ll, bw - 0.03 + rr.uniform(-0.02, 0.02), bh + (rr.uniform(-0.015, 0.02) if vary else 0)),
                          ang + rr.uniform(-0.05, 0.05) * (2 if vary else 1), taper=(0.9, 0.78))
            bot = min(fs, key=lambda f: f.calc_center_median().z) if fs else None
            if bot is not None:
                bm.faces.remove(bot)
            if vary:
                q = rr.random()
                tone = 1 - vary * rr.random() if q < 0.7 else (1 - vary * 1.4 if q < 0.85 else 1 + vary * 0.25)
                for f in fs:
                    if f.is_valid:
                        f[tl] = tone; f[cl] = c.z
    ob = K.part(bm, 'hessian', name=name, grime=0.6, mat_tint=tint, bisect=False)
    if vary:
        me = ob.data
        col = me.color_attributes.get('Col') or me.color_attributes[0]
        tone, cz = me.attributes['bag_tone'].data, me.attributes['bag_cz'].data
        for poly in me.polygons:
            t, zc = tone[poly.index].value, cz[poly.index].value
            for li in poly.loop_indices:
                z = me.vertices[me.loops[li].vertex_index].co.z
                sh = 0.62 if z < zc - 0.02 else (0.86 if z < zc + 0.02 else 1.0)    # tucked underside / bulge / top
                cc = col.data[li].color
                col.data[li].color = (cc[0] * t * sh, cc[1] * t * sh, cc[2] * t * sh * (0.97 if t < 1 else 1.0), cc[3])
        for a in ('bag_tone', 'bag_cz'):
            me.attributes.remove(me.attributes[a])
    return ob
