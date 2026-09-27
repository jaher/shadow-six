"""Libyan / southern-Tunisian mud-brick house (M8-M11), rework 1. Red-brown mud/straw render (darker than the sand,
so it reads at 1x), eroded sloping mud skirt at the wall foot, gypsum/lime repair patches and whitened door
surrounds, rain-cut rounded mud parapets (no rolls), palm-trunk joists (rough, irregular, barely protruding), small
flush openings with palm-wood lintels, frond-roofed arbour, bread oven, jars, fodder on the roof.
  a: single-storey house + mud-walled yard with a gate, arbour, oven.
  b: two-storey block + single-storey store, external mud stair along the store's EAST side, ladder to the top roof.
  c: SHELLED RUIN of an L-plan house (different plan): east half collapsed to ragged wall stumps, roof fallen in
     with broken/sagging palm joists, slumped mud-brick rubble, fire-scorched openings.
Usage: blender -b --python house_adobe.py -- outdir [a|b|c] [seed]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh

av = dz.argv()
OUT = av[0]
VAR = av[1] if len(av) > 1 else 'a'
SEED = int(av[2]) if len(av) > 2 else {'a': 5, 'b': 17, 'c': 29}[VAR]
K.begin('house_adobe_' + VAR, SEED, theater='desert')
r = K.rng()
MUD, TIM = 'mud_render', 'palm_log'
TINT = {'a': (1.0, 1.0, 1.0), 'b': (0.94, 0.9, 0.87), 'c': (0.96, 0.94, 0.92)}[VAR]
ROOF = (1.0, 0.97, 0.93)
BAT, T = 0.14, 0.55
WOOD = (0.5, 0.42, 0.33)


def lintel(f, over=0.22):
    """Palm-wood lintel: two rough logs over the opening, ends buried in the wall."""
    bm = bmesh.new()
    for k, dd in enumerate((-0.12, -0.36)):
        a = f.p(-f.w / 2 - over, f.h + 0.07, dd)
        b = f.p(f.w / 2 + over, f.h + 0.07 + r.uniform(-0.02, 0.02), dd)
        C.cyl_bm(bm, a, b, 0.065, 6)
    K.part(bm, TIM, name='lint%d' % int(abs(f.o.x * 10 + f.o.y * 7)), uv='beam', axis=tuple(f.r), grime=0.6)


def opening_dress(f, bi, surround=False):
    if f.kind == 'door':
        K.door(f, 'd%d' % len(C.A.meta['doors']), 'plank', WOOD, step=None, hinge=r.choice(['left', 'right']))
        if surround:        # whitened door surround (lime) - a strong read at 1x
            dz.lime_patch(f.p(0, f.h * 0.55, 0.0), f.n, f.w + 0.9, f.h + 0.7, seed=int(f.o.x * 3), name='limedoor%d' % bi)
    else:
        K.window(f, 'fixed', (1, 1), frame=WOOD, sill=None, lintel=None, shutters=r.choice(['closed', 'ajar', None]),
                 shutter_color=WOOD, bars=f.o.z < 2, curtain=0.2, streak=False, name='w%d_%d' % (bi, int(f.o.x * 10)))
        K.decal('streak_long', tuple(f.p(0, -0.55, 0.012)), tuple(f.n), f.w + 0.1, 0.9, alpha=0.2)
    lintel(f)


def mud_block(poly, h, frs, bi, par_h=0.6, gaps=None, joist_edges=(0,), lime=3, spout_skip=()):
    for f in frs:
        dz.lean_in(f, BAT, h)
    dz.battered_ring(poly, h, T, BAT, MUD, frs, name='walls%d' % bi, mat_tint=TINT)
    inner = C.poly_offset(poly, -BAT - 0.22)
    dz.roof_slab(inner, h + 0.06, 0.3, MUD, name='roof%d' % bi, tint=ROOF)
    K.roof_meta(inner, h + 0.06, walkable=True, kind='flat')
    top = C.poly_offset(poly, -BAT)
    dz.parapet(top, h, par_h, 0.34, MUD, gaps=gaps or {}, style='mud', mat_tint=TINT, name='par%d' % bi)
    dz.joists(top, h - 0.2, list(joist_edges), 0.75, r=0.085, out=0.14, mid=TIM, name='joists%d' % bi)
    dz.mud_apron(poly, 0.55, 0.3, seed=SEED + bi, name='apron%d' % bi)
    dz.spouts(top, h + 0.02, 3.5, TIM, skip=spout_skip)
    for f in frs:
        if f.kind != 'breach':
            opening_dress(f, bi, surround=(f.kind == 'door' and bi == 0))
    for i in range(len(poly)):          # weathering: exposed brick, lime repairs, rain gullies, cracks
        a, b, rv, n, Le = dz.edge(poly, i)
        for k in range(max(1, int(Le / 2.6))):
            z = r.uniform(0.7, h - 0.7)
            p = a + rv * r.uniform(0.6, Le - 0.6) + V((0, 0, z)) - n * BAT * (z / h)
            dz.spall2(p, n, r.uniform(0.5, 1.1), r.uniform(0.3, 0.6), 'mudbrick', MUD, TINT, seed=SEED + i * 5 + k, name='sp%d_%d_%d' % (bi, i, k))
            K.decal('crack', tuple(a + rv * r.uniform(0.6, Le - 0.6) + V((0, 0, r.uniform(1.0, h - 0.5))) - n * (BAT * 0.6 - 0.012)), tuple(n),
                    r.uniform(0.5, 1.0), r.uniform(0.8, 1.4), alpha=0.5)
        for k in range(max(1, int(Le / 3.2))):
            p = a + rv * r.uniform(0.5, Le - 0.5) + V((0, 0, h - 0.7)) - n * (BAT * 0.85 - 0.012)
            K.decal('streak_long', tuple(p), tuple(n), r.uniform(0.25, 0.45), 1.3, alpha=0.18)
    for k in range(lime):
        i = r.randrange(len(poly))
        a, b, rv, n, Le = dz.edge(poly, i)
        z = r.uniform(0.8, h - 1.0)
        p = a + rv * r.uniform(0.8, Le - 0.8) + V((0, 0, z)) - n * BAT * (z / h)
        dz.lime_patch(p, n, r.uniform(0.6, 1.4), r.uniform(0.4, 0.9), seed=SEED + 40 + k, name='lime%d_%d' % (bi, k))
    return inner


def roof_life(inner, z, fodder=True, hatch=True):
    xs, ys = [p[0] for p in inner], [p[1] for p in inner]
    if hatch:
        dz.hatch((max(xs) - 1.0, max(ys) - 1.0), z, 0.6, curb=MUD, tint=ROOF, name='hatch%d' % int(z))
    if fodder:          # bundles of palm fronds / fodder drying on the roof
        bm = bmesh.new()
        for i in range(5):
            p = V((min(xs) + 0.9 + 0.25 * i, min(ys) + 0.8 + r.uniform(-0.1, 0.1), z + 0.08))
            C.cyl_bm(bm, p - V((0, 0.7, 0)), p + V((r.uniform(-0.15, 0.15), 0.7, 0.05)), 0.1, 6)
        K.part(bm, 'roof_thatch', name='fodder%d' % int(z), uv='beam', axis=(0, 1, 0), mat_tint=(0.9, 0.82, 0.6), grime=0.3, lod='drop')
    dz.roof_patches(inner, z, 3, SEED + int(z), lime=True, tar=False, lime_mat='mudbrick', lime_tint=(0.97, 0.93, 0.88))


# ================================================================== a: single storey + yard
if VAR == 'a':
    W, D, H = 8.4, 5.6, 3.3
    main = [(-W / 2, -D / 2), (W / 2, -D / 2), (W / 2, D / 2), (-W / 2, D / 2)]
    fr = [K.opening(main, 0, 2.0, 1.1, 2.05, 0.0, T, 'rect', 'door'), K.opening(main, 0, 4.4, 0.5, 0.6, 1.45, T),
          K.opening(main, 0, 6.6, 0.5, 0.6, 1.45, T), K.opening(main, 1, 2.8, 0.45, 0.55, 1.55, T),
          K.opening(main, 3, 2.0, 0.45, 0.55, 1.5, T)]
    inner = mud_block(main, H, fr, 0, joist_edges=(0, 2), lime=1)
    roof_life(inner, H + 0.06)
    K.ladder((W / 2 + 0.55, 0.8, 0), H + 0.06, (1, 0, 0), mid='timber_grey')
    YW = -D / 2 - 3.6
    ypoly = [(-W / 2, YW), (W / 2, YW), (W / 2, -D / 2), (-W / 2, -D / 2)]
    dz.parapet(ypoly, 0.0, 1.8, 0.42, MUD, gaps={0: [(W / 2 + 0.6, W / 2 + 2.0)], 2: [(-1, W + 1)]}, style='mud', mat_tint=TINT, name='yardwall')
    for i, gp in ((0, [(W / 2 + 0.6, W / 2 + 2.0)]), (1, []), (3, [])):
        a, b, rv, n, Le = dz.edge(ypoly, i)
        for t0, t1 in dz.segs_minus(Le, gp):
            p0, p1 = a + rv * t0, a + rv * t1
            K.footprint([tuple(p0)[:2], tuple(p1)[:2], tuple(p1 - n * 0.42)[:2], tuple(p0 - n * 0.42)[:2]], 'HIGH', 'wall')
    dz.mud_apron([(-W / 2, YW), (W / 2, YW), (W / 2, -D / 2 - 0.3), (-W / 2, -D / 2 - 0.3)], 0.35, 0.22, seed=SEED + 9, name='yapron', skip=(2,))
    bm = bmesh.new()      # palm-trunk gate posts
    for x in (0.6, 2.0):
        C.cyl_bm(bm, (x, YW - 0.2, 0), (x, YW - 0.2, 2.1), 0.11, 7)
    C.cyl_bm(bm, (0.45, YW - 0.2, 2.05), (2.15, YW - 0.2, 2.08), 0.09, 7)
    K.part(bm, TIM, name='gateposts', uv='beam', axis=(0, 0, 1))
    dz.frond_shade(-W / 2 + 0.6, -D / 2 - 2.6, -W / 2 + 4.2, -D / 2 - 0.4, 2.3)
    dz.tabouna((W / 2 - 1.2, -D / 2 - 1.6), 0.55)
    jars = [(-W / 2 + 4.8 + 0.5 * k, -D / 2 - 0.55) for k in range(3)]
    dz.lime_patch((0.0, YW - 0.215, 1.0), (0, -1, 0), 1.3, 0.8, seed=3, name='yardlime')
    blocks = [(main, H)]

# ================================================================== b: two storeys + store + stair on the store's EAST side
if VAR == 'b':
    H, H2 = 5.8, 2.9
    main = [(-3.6, -1.2), (2.8, -1.2), (2.8, 4.0), (-3.6, 4.0)]
    store = [(-3.6, -4.8), (0.6, -4.8), (0.6, -1.0), (-3.6, -1.0)]
    fr = [K.opening(main, 1, 1.5, 1.05, 2.0, 0.0, T, 'rect', 'door'), K.opening(main, 0, 5.2, 0.5, 0.65, 3.7, T),
          K.opening(main, 1, 3.8, 0.45, 0.55, 1.5, T), K.opening(main, 1, 3.8, 0.45, 0.6, 3.9, T),
          K.opening(main, 2, 2.0, 0.45, 0.55, 4.0, T), K.opening(main, 3, 3.5, 0.45, 0.55, 3.9, T)]
    fs = [K.opening(store, 0, 1.6, 1.3, 1.9, 0.0, 0.5, 'rect', 'door'), K.opening(store, 3, 2.0, 0.4, 0.45, 1.6, 0.5)]
    inner = mud_block(main, H, fr, 0, par_h=0.7, gaps={0: [(1.2, 2.2)]}, joist_edges=(0, 2), lime=2)
    inner2 = mud_block(store, H2, fs, 1, gaps={1: [(2.3, 3.8)], 2: [(-1, 5)]}, joist_edges=(3,), lime=1, spout_skip=(2,))
    roof_life(inner, H + 0.06, fodder=True)
    roof_life(inner2, H2 + 0.06, fodder=False, hatch=False)
    n = 16
    L = 0.28 * n
    dz.stair_flight((1.25, -5.75, 0.0), (0, 1, 0), 0.95, H2 + 0.06, n, MUD, TINT, cheek=-1, name='stair', seed=SEED, niche=False)
    K.decal('damp_base', (1.25 + 0.48, -5.75 + L * 0.45, 0.45), (1, 0, 0), L * 0.8, 0.9, alpha=0.5)
    dz.spall2(V((1.25 + 0.477, -5.75 + L * 0.7, 1.1)), (1, 0, 0), 0.55, 0.4, 'mudbrick', MUD, TINT, seed=SEED + 60, name='stair_sp2')
    K.ladder_meta((1.25, -6.15), (0.1, -2.4), H2 + 0.06)
    K.footprint([(0.75, -5.75), (1.95, -5.75), (1.95, -5.75 + L), (0.75, -5.75 + L)], 'LOW', 'stairs')
    K.ladder((-1.9, -1.55, H2 + 0.06), H - H2, (0, -1, 0), meta=False)
    K.ladder_meta((-1.9, -2.0), (-1.9, -0.6), H + 0.06)
    dz.tabouna((-2.8, -5.8), 0.5)
    jars = [(-3.9 - 0.1 * k, -4.0 + 0.55 * k) for k in range(2)]
    dz.frond_shade(3.1, 0.2, 5.2, 3.6, 2.2)
    blocks = [(main, H), (store, H2)]


BR = []
H_FULL = 3.4


def ragged_walls(poly, hfun, t, mid, openings, name, bat=0.1, full=None):
    """Walls as runs of masonry boxes whose tops follow hfun(x, y) quantised to 0.12 m mud-brick courses (stepped
    broken tops read as brick, not as a boolean blob). openings = {edge: [(t0, t1, z0, z1)]} leave true holes.
    Registers HIGH (>1.3 m) / LOW footprints per run."""
    from mathutils import noise as N
    poly = C.ccw(poly)
    bm = bmesh.new()
    for i in range(len(poly)):
        a, b, rv, n, L = dz.edge(poly, i)
        cuts = {0.0, L}
        for t0, t1, z0, z1 in openings.get(i, []):
            cuts |= {t0, t1}
        u = 0.0
        while u < L:
            p = a + rv * u
            step = 0.32 if hfun(p.x, p.y) < 2.6 else 1.4
            u += step * (0.8 + 0.4 * (0.5 + 0.5 * N.noise(V((u, i, 1.7)))))
            if u < L - 0.1:
                cuts.add(u)
        cuts = sorted(cuts)
        runs = []
        for u0, u1 in zip(cuts[:-1], cuts[1:]):
            if u1 - u0 < 0.02:
                continue
            m = a + rv * ((u0 + u1) / 2)
            h = max(0.24, round(hfun(m.x, m.y) / 0.12) * 0.12)
            spans = [(0.0, h)]
            for t0, t1, z0, z1 in openings.get(i, []):
                if u0 >= t0 - 1e-4 and u1 <= t1 + 1e-4:
                    spans = [(zz0, zz1) for zz0, zz1 in ((0.0, min(h, z0)), (z1, h)) if zz1 - zz0 > 0.05]
            e0 = -t if u0 < 1e-3 else 0.0
            broken = h < (full or H_FULL) - 0.15
            for si, (z0, z1) in enumerate(spans):
                q0, q1 = a + rv * (u0 + e0), a + rv * u1
                bo = [q0, q1, q1 - n * t, q0 - n * t]
                top_span = si == len(spans) - 1
                zb = z1 - 0.12 * r.randint(2, 3) if (broken and top_span and z1 - z0 > 0.5) else z1
                k0, kb = bat * z0 / 3.4, bat * zb / 3.4
                C.hexa_bm(bm, [p_ - n * k0 + V((0, 0, z0)) for p_ in bo[:2]] + [p_ + V((0, 0, z0)) for p_ in bo[2:]] +
                          [p_ - n * kb + V((0, 0, zb)) for p_ in bo[:2]] + [p_ + V((0, 0, zb)) for p_ in bo[2:]])
                if zb < z1:     # render lost at the broken head: exposed mud-brick courses, ragged uneven top
                    ins = 0.03
                    jt = [r.uniform(-0.07, 0.05) for _ in range(4)]
                    k1 = bat * z1 / 3.4
                    BR.append([p_ - n * (kb - ins) + V((0, 0, zb)) for p_ in bo[:2]] + [p_ + n * ins + V((0, 0, zb)) for p_ in bo[2:]] +
                              [p_ - n * (k1 - ins) + V((0, 0, z1 + jt[j])) for j, p_ in enumerate(bo[:2])] +
                              [p_ + n * ins + V((0, 0, z1 + jt[j + 2])) for j, p_ in enumerate(bo[2:])])
            runs.append((u0, u1, max(z1 for z0, z1 in spans) if spans else 0.0))
        cur = None
        for u0, u1, h in runs + [(L, L, -1)]:
            blk = 'HIGH' if h > 1.3 else 'LOW'
            if cur and (h < 0 or blk != cur[2]):
                p0, p1 = a + rv * cur[0], a + rv * cur[1]
                K.footprint([tuple(p0)[:2], tuple(p1)[:2], tuple(p1 - n * t)[:2], tuple(p0 - n * t)[:2]], cur[2], 'wall')
                cur = None
            if h >= 0:
                cur = [cur[0], u1, blk] if cur else [u0, u1, blk]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = K.part(bm, mid, name=name, mat_tint=TINT)
    if BR:
        bm = bmesh.new()
        for p8 in BR:
            C.hexa_bm(bm, p8)
        BR.clear()
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        K.part(bm, 'mudbrick', name=name + '_brickheads', mat_tint=(0.88, 0.8, 0.72), grime=0.8)
    return ob


# ================================================================== c: shelled ruin, L-plan (main + west wing), east half collapsed
if VAR == 'c':
    from mathutils import noise as NZ
    H, HW, X0 = 3.4, 2.9, 0.2
    main = [(-3.5, -2.4), (3.7, -2.4), (3.7, 2.4), (-3.5, 2.4)]
    wing = [(-6.9, -2.4), (-3.3, -2.4), (-3.3, 1.0), (-6.9, 1.0)]

    def hmain(x, y):
        k = min(1.0, max(0.0, (x - X0) / 1.4))
        k = k * k * (3 - 2 * k)
        stump = 0.5 + 1.1 * (0.5 + 0.5 * NZ.noise(V((x * 0.8, y * 0.8, 3.1)))) + (0.5 if y > 1.5 else 0.0)
        jag = 0.35 * NZ.noise(V((x * 2.3, y * 2.3, 7.7))) * k
        return H * (1 - k) + stump * k + jag
    fm = [K.opening(main, 0, 1.7, 1.1, 2.05, 0.0, T, 'rect', 'door'), K.opening(main, 2, 5.5, 0.45, 0.55, 1.5, T),
          K.opening(main, 3, 1.4, 0.45, 0.55, 1.5, T)]
    fw = [K.opening(wing, 0, 1.6, 1.0, 1.9, 0.0, T, 'rect', 'door'), K.opening(wing, 3, 1.7, 0.45, 0.55, 1.4, T)]
    def ops(poly, frs):
        o = {}
        for f in frs:
            for i in range(4):
                a, b, rv, n, Le = dz.edge(poly, i)
                if (f.n - n).length < 1e-3 and abs((f.o - a).dot(n)) < 0.05:
                    t = (f.o - a).dot(rv)
                    o.setdefault(i, []).append((t - f.w / 2, t + f.w / 2, f.o.z, f.o.z + f.h))
        return o
    ragged_walls(main, hmain, T, MUD, ops(main, fm), 'walls0')
    ragged_walls(wing, lambda x, y: HW, T, MUD, ops(wing, fw), "walls1", full=HW)
    dz.mud_apron(main, 0.5, 0.3, seed=SEED, name='apron0')
    dz.mud_apron(wing, 0.5, 0.3, seed=SEED + 1, name='apron1', skip=(1,))
    # surviving roof over the west part: ragged broken east edge, joists sticking out of it and hanging into the room
    xe = X0 - 0.7
    edge_pts = [(xe + 0.35 * NZ.noise(V((0, y * 1.7, 5))) + (0.25 if 0 < y < 1 else 0), y) for y in [1.95 - 0.55 * k for k in range(8)]]
    rp = [(-3.05, -1.95)] + [(x, y) for x, y in edge_pts[::-1]] + [(-3.05, 1.95)]
    rp = [(-3.05, -1.95), (edge_pts[-1][0], -1.95)] + list(reversed(edge_pts[:-1]))[::-1][::-1] + [(-3.05, 1.95)]
    rp = [(-3.05, -1.95)] + [p for p in reversed(edge_pts)] + [(-3.05, 1.95)]
    dz.roof_slab(rp, H + 0.06, 0.3, MUD, name='roof0', tint=ROOF)
    K.roof_meta(rp, H + 0.06, walkable=True, kind='flat')
    top = C.poly_offset(main, -0.03)
    dz.parapet(top, H, 0.55, 0.34, MUD, gaps={0: [(X0 + 3.0, 9)], 1: [(-1, 9)], 2: [(-1, 3.5 - X0 + 1.3)]}, style='mud', mat_tint=TINT, name='par0')
    dz.parapet(C.poly_offset(wing, -0.03), HW, 0.55, 0.34, MUD, gaps={1: [(-1, 9)]}, style='mud', mat_tint=TINT, name='par1')
    dz.roof_slab(C.poly_offset(wing, -0.3), HW + 0.06, 0.3, MUD, name='roof1', tint=ROOF)
    K.roof_meta(C.poly_offset(wing, -0.3), HW + 0.06, walkable=True, kind='flat')
    bm = bmesh.new()
    for k in range(7):          # joists: intact under the roof ends, broken/sagging beyond the edge
        y = -1.8 + 0.6 * k
        ex = [p[0] for p in edge_pts if abs(p[1] - y) < 0.3] or [xe]
        x_end = ex[0]
        z = H - 0.12
        if k in (1, 4):        # hanging: one end still in the roof edge, the other down on the rubble
            dz.broken_log(bm, (x_end - 0.4, y, z), (x_end + 1.6, y + 0.2 * (k - 3), 0.9), 0.085, 7)
        elif k in (2, 5):      # snapped stub
            dz.broken_log(bm, (x_end - 0.4, y, z), (x_end + 0.55, y, z - 0.18), 0.085, 7)
        else:
            dz.broken_log(bm, (x_end - 0.4, y, z), (x_end + 0.2, y, z - 0.03), 0.085, 7)
    for k in range(3):          # collapsed-room joists lying across the heap
        y = -1.2 + 1.1 * k
        dz.broken_log(bm, (1.0, y, 0.9 + 0.2 * k), (3.2, y + 0.4, 0.45), 0.08, 7)
    K.part(bm, TIM, name='joists_broken', uv='beam', axis=(1, 0, 0), grime=0.7, mat_tint=(0.8, 0.72, 0.64))
    for f in fm + fw:
        if f.kind == 'door':
            K.door(f, 'd%d' % len(C.A.meta['doors']), 'plank', (0.24, 0.2, 0.17), open_deg=55 if f in fm else 0, step=None)
        else:
            K.window(f, 'fixed', (1, 1), frame=(0.25, 0.22, 0.2), sill=None, shutters=None, bars=True, curtain=0.0, streak=False, name='w%d' % int(f.o.x * 10))
        lintel(f)
        K.decal('soot', tuple(f.p(0, f.h + 0.3, 0.02)), tuple(f.n), f.w + 0.3, 0.9, alpha=0.45)
        K.decal('soot', tuple(f.p(0, f.h * 0.6, -T + 0.03)), tuple(-f.n), f.w + 0.6, f.h + 0.4, alpha=0.6)
    dz.rubble_mud((2.1, 0.0, 0), 2.1, 1.9, 1.25, seed=SEED, bricks=46, logs=2, reeds=2, name='rub0', slump=(0.4, -0.5))
    dz.rubble_mud((2.2, -3.2, 0), 1.7, 0.9, 0.5, seed=SEED + 3, bricks=22, logs=1, reeds=1, name='rub1')
    dz.rubble_mud((4.5, 0.6, 0), 0.9, 1.4, 0.45, seed=SEED + 5, bricks=14, logs=0, reeds=0, name='rub2')
    bm = bmesh.new()           # smashed jars in the open room
    for k in range(6):
        c = V((0.9 + r.uniform(-0.4, 0.4), 1.6 + r.uniform(-0.3, 0.3), 0.05))
        dz.chunk_bm(bm, c, (r.uniform(0.15, 0.3), r.uniform(0.1, 0.2), 0.05), (r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(0, 3)), k)
    K.part(bm, 'roof_terracotta', name='shards', mat_tint=(1.0, 0.9, 0.8), lod='drop')
    for (x, y, nx, ny) in ((-2.0, -2.4, 0, -1), (-5.2, -2.4, 0, -1), (-3.5, 0.0, -1, 0), (2.0, 2.4, 0, 1)):
        dz.spall2((x + r.uniform(-0.5, 0.5), y + ny * 0.004, r.uniform(0.9, 2.0)), (nx, ny, 0), r.uniform(0.6, 1.2), r.uniform(0.4, 0.7), 'mudbrick', MUD, TINT, seed=int(x * 7))
    dz.lime_patch((-3.2, -2.405, 1.2), (0, -1, 0), 0.9, 0.7, seed=4, name='lime0')
    K.decal('scorch_a', (-1.0, 0.0, H + 0.37), (0, 0, 1), 3.2, 2.8, up=(0, 1, 0), alpha=0.7)
    K.decal('dirt_splash', (1.5, -1.5, 0.04), (0, 0, 1), 5.0, 4.0, up=(0, 1, 0), alpha=0.5)
    K.ladder((-6.9 - 0.55, -0.6, 0), HW + 0.06, (-1, 0, 0), mid='timber_grey')
    jars, blocks = [(-6.3, -2.95)], [(wing, HW)]
    C.A.meta['notes'].append('ruin: east half of the main room collapsed to stumps 0.5-1.7 m (LOW cover), rubble heaps LOW, west roof walkable')

dz.jars([(x, y, 0.0) for x, y in jars], name='jars', s=1.15, seed=SEED)
for poly, h in blocks:
    for i in range(4):
        a, b, rv, n, Le = dz.edge(poly, i)
        if r.random() < 0.6:
            dz.sand_drift(tuple(a + rv * 0.6), tuple(a + rv * min(Le - 0.6, 0.6 + r.uniform(1.2, 2.5))), tuple(n), r.uniform(0.15, 0.3),
                          r.uniform(0.5, 0.9), seed=SEED + i * 7, name='sand%d' % i)
dz.finalize(OUT, ao_res=1024, ao_samples=48)
