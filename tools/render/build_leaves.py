#!/usr/bin/env python3
"""
Bake the broadleaf foliage atlas (own procedural work, CC0): leaf sprays per species, bare twig sprays for winter
crowns, marcescent brown leaves, ivy, gorse, acacia and hawthorn.

  python3 tools/render/build_leaves.py      # -> assets/terrain/foliage.webp, foliage_n.webp, foliage.json

Every layer is one card: v runs from the twig base (v=0, image row 0) to the tip (v=1), the twig axis on u=0.5.
Leaves are rasterised at 4x supersampling as two half-blade polygons (left / right of the midrib, each with its own
tilted normal: the fold), on twigs with side shoots, then box-filtered down.

  foliage.webp    sRGB albedo, opaque, layers in a grid of 512 px tiles (colour bled into the gaps so mips never
                  darken; the gaps hold a darker bleed = shaded crown interior)
  foliage_n.webp  256 px tiles: R,G tangent-space normal xy (z rebuilt in the shader), B coverage. The shader
                  derives the leaf mass from a blurred mip of B (crown AO, translucency through thin edges).

The conifer and palm tiles of the previous atlas (ambientCG LeafSet / PineNeedles scans, CC0, and procedural palm
fronds) are carried over unchanged from git (`git show <rev>:assets/terrain/foliage.webp`): their old alpha becomes
the coverage channel.
"""
import io, json, math, os, random, subprocess
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'terrain')
T = 512          # albedo tile
TN = 256         # normal / coverage tile
SS = 4           # supersampling
N = T * SS
GAP = 0.55       # albedo of the bled gap texels relative to the leaves
COLS = 8         # grid columns (WebP max side 16383)
OLD_REV = os.environ.get('OLD_FOLIAGE_REV', '670816bd')
KEEP = ['spruce', 'fir', 'pine', 'palm', 'palmdry']


class Canvas:
    def __init__(self):
        self.alb = Image.new('RGB', (N, N), (0, 0, 0))
        self.nor = Image.new('RGB', (N, N), (128, 128, 0))
        self.a = Image.new('L', (N, N), 0)
        self.idm = Image.new('L', (N, N), 255)   # per-leaf id (autumn turning leaf by leaf); 255 = twig / no leaf
        self.d = [ImageDraw.Draw(i) for i in (self.alb, self.nor, self.a, self.idm)]
        self.cur, self.hold, self.idr = None, False, random.Random(7)

    def new_id(self):
        return 160 + self.idr.randrange(90)

    def poly(self, pts, col, nrm):
        """Filled polygon with albedo col (0..255 rgb) and tangent normal nrm (x, y, z unit)."""
        nx, ny, nz = nrm
        l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
        self.d[0].polygon(pts, fill=tuple(int(max(0, min(255, c))) for c in col))
        self.d[1].polygon(pts, fill=(int(128 + 127 * nx / l), int(128 + 127 * ny / l), 255))
        self.d[2].polygon(pts, fill=255)
        self.d[3].polygon(pts, fill=255 if self.cur is None else self.cur)

    def stroke(self, pts, w0, w1, col, roundness=0.6):
        """Woody twig as a chain of quads (cylindrical: left / centre / right strip normals)."""
        cur, self.cur = self.cur, None
        self._stroke(pts, w0, w1, col, roundness)
        self.cur = cur

    def _stroke(self, pts, w0, w1, col, roundness):
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            t0, t1 = i / max(1, len(pts) - 1), (i + 1) / max(1, len(pts) - 1)
            wa, wb = (w0 + (w1 - w0) * t0) / 2, (w0 + (w1 - w0) * t1) / 2
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1
            px, py = -dy / L, dx / L
            ext = (dx / L * wb * 0.5, dy / L * wb * 0.5)  # overlap: no seams between segments
            for k, (s0, s1) in enumerate(((-1, -1 / 3), (-1 / 3, 1 / 3), (1 / 3, 1))):
                q = [(a[0] + px * s0 * wa, a[1] + py * s0 * wa), (b[0] + ext[0] + px * s0 * wb, b[1] + ext[1] + py * s0 * wb),
                     (b[0] + ext[0] + px * s1 * wb, b[1] + ext[1] + py * s1 * wb), (a[0] + px * s1 * wa, a[1] + py * s1 * wa)]
                sx = (k - 1) * roundness
                sh = 0.85 + 0.15 * (1 - abs(k - 1))
                self.poly(q, tuple(c * sh for c in col), (px * sx, py * sx, 1))

    def finish(self):
        """Downsample, bleed, return (albedo RGB at T, normal+coverage RGB at TN). Both opaque images."""
        A = np.asarray(self.a, dtype=np.float32) / 255
        C = np.asarray(self.alb, dtype=np.float32) * A[..., None]
        Nn = np.asarray(self.nor, dtype=np.float32)[..., :2] * A[..., None]

        def box(x, t):
            f = N // t
            return x.reshape(t, f, t, f, *x.shape[2:]).mean(axis=(1, 3))
        alb = bleed(box(C, T), box(A, T))
        n = box(Nn, TN); a = box(A, TN)
        out_n = n / np.maximum(a[..., None], 1e-4)
        out_n = out_n * a[..., None] ** 0.25 + 128 * (1 - a[..., None] ** 0.25)
        f = N // TN
        ids = np.asarray(self.idm, dtype=np.uint8)[f // 2::f, f // 2::f].copy()
        for _ in range(4):   # leaf ids bleed over the gaps / twigs so bilinear taps at a leaf rim keep the leaf's id
            gap = ids == 255
            if not gap.any():
                break
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nb = np.roll(np.roll(ids, dy, 0), dx, 1)
                take = gap & (nb != 255) & (ids == 255)
                ids[take] = nb[take]
        nor = np.dstack([np.clip(out_n, 0, 255), a * 255, ids]).astype(np.uint8)
        return Image.fromarray(alb, 'RGB'), Image.fromarray(nor, 'RGBA')


def blur(x, r):
    """Three box passes per axis ~ gaussian (float, any channel count)."""
    k = max(1, int(r))
    for ax in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * x.ndim; pad[ax] = (k + 1, k)
            cs = np.cumsum(np.pad(x, pad, mode='edge'), axis=ax)
            x = (np.take(cs, range(2 * k + 1, cs.shape[ax]), axis=ax) - np.take(cs, range(0, cs.shape[ax] - 2 * k - 1), axis=ax)) / (2 * k + 1)
    return x


def bleed(c, a):
    """Premultiplied colour c (HxWx3) + coverage a (HxW) -> opaque uint8 albedo with the colour bled outward."""
    out = c / np.maximum(a[..., None], 1e-4)
    have = a > 0.02
    for r in (2, 5, 12, 30):
        bc = blur(np.dstack([c, a[..., None]]).astype(np.float32), r)
        w = np.maximum(bc[..., 3:4], 1e-6)
        fill = (~have) & (bc[..., 3] > 1e-4)
        out[fill] = (bc[..., :3] / w)[fill]
        have = have | fill
    out[~have] = c.sum(axis=(0, 1)) / max(a.sum(), 1e-4)
    out = out * (GAP + (1 - GAP) * np.clip(a[..., None] * 2.5, 0, 1))
    return np.clip(out, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- leaf blades
def shape_fn(kind, lobes=0, r=None):
    """Half-width profile w(t) in 0..1 along the blade (t 0 = base, 1 = tip)."""
    if kind == 'ovate':
        return lambda t: math.sin(math.pi * min(1, t ** 0.8)) ** 0.85 * (1 - 0.15 * t)
    if kind == 'elliptic':
        return lambda t: math.sin(math.pi * t) ** 0.8
    if kind == 'lance':
        return lambda t: math.sin(math.pi * min(1, t ** 0.7)) ** 1.2
    if kind == 'delta':      # birch / poplar: broad near the base, long point
        return lambda t: (math.sin(t / 0.3 * math.pi / 2) ** 0.7 if t < 0.3 else ((1 - t) / 0.7) ** 0.9)
    if kind == 'obovate':
        return lambda t: math.sin(math.pi * min(1, t ** 1.25)) ** 0.8
    if kind == 'round':      # hazel / alder: cordate base, short point
        return lambda t: math.sin(math.pi * min(1, t ** 0.9)) ** 0.55 * (1 - 0.25 * max(0, t - 0.75) / 0.25)
    if kind == 'lobed':      # oak: obovate with rounded lobes
        base = shape_fn('obovate')
        ph = r.random() * 0.4 if r else 0.2
        return lambda t: base(t) * (0.5 + 0.5 * abs(math.sin((lobes + 0.5) * math.pi * t + ph))) if t < 0.92 else base(t)
    if kind == 'haw':        # hawthorn: deeply 3-5 lobed, wedge base
        base = shape_fn('obovate')
        return lambda t: base(t) * (0.3 + 0.7 * abs(math.sin(2.5 * math.pi * t))) * min(1, 0.4 + t * 1.2)
    raise ValueError(kind)


def draw_leaf(cv, b, d, L, wr, kind, col, r, lobes=0, serr=0.0, under=None, fold=0.45, ao=1.0, vein=0.12, curl=0.35):
    """One leaf blade from base b along unit dir d (pixel units at SS): 2 halves x 2 length segments, each with its own
    normal (midrib fold + curl). `under`: colour of the pale underside shown when the leaf is flipped."""
    own = not cv.hold
    if own:
        cv.cur = cv.new_id()
    f = shape_fn(kind, lobes, r)
    p = (-d[1], d[0])
    W = L * wr * 0.5
    flip = under is not None and r.random() < 0.3
    c0 = under if flip else col
    jit = 1 + (r.random() - 0.5) * 0.22
    hue = (r.random() - 0.5) * 0.12
    c0 = (c0[0] * jit * (1 + hue), c0[1] * jit, c0[2] * jit * (1 - hue)) 
    c0 = tuple(c * ao for c in c0)
    tilt = ((r.random() - 0.5) * 0.9, (r.random() - 0.5) * 0.9)
    K = 14
    ts = [i / K for i in range(K + 1)]
    teeth = lambda i: 1 - serr * (i % 2)
    edge = {s: [(b[0] + d[0] * L * t + p[0] * s * W * f(t) * teeth(i), b[1] + d[1] * L * t + p[1] * s * W * f(t) * teeth(i)) for i, t in enumerate(ts)] for s in (-1, 1)}
    mid = [(b[0] + d[0] * L * t, b[1] + d[1] * L * t) for t in ts]
    h = K // 2
    for s in (-1, 1):
        for seg, (i0, i1) in enumerate(((0, h), (h, K))):
            poly = mid[i0:i1 + 1] + list(reversed(edge[s][i0:i1 + 1]))
            fx = p[0] * s * fold + d[0] * (curl if seg else -curl * 0.3) + tilt[0]
            fy = p[1] * s * fold + d[1] * (curl if seg else -curl * 0.3) + tilt[1]
            sh = (0.9 if seg == 0 else 1.0) * (1.04 if s > 0 else 0.96)
            cv.poly(poly, tuple(c * sh for c in c0), (fx, fy, 1))
    if vein > 0 and L > 40:   # paler midrib
        vc = tuple(min(255, c * (1 + vein * 2.5)) for c in c0)
        cv.d[0].line([mid[0], mid[int(K * 0.85)]], fill=tuple(int(c) for c in vc), width=max(1, int(L * 0.025)))
    if own:
        cv.cur = None


def draw_palmate(cv, b, d, L, n, col, r, depth=0.45, ao=1.0, under=None):
    """Palmate leaf (plane, ivy): n lobes fanned around the petiole tip; drawn as n lobe blades."""
    spread = math.radians(150 if n >= 5 else 110)
    held = cv.hold
    if not held:
        cv.cur, cv.hold = cv.new_id(), True
    for k in range(n):
        a = (k / (n - 1) - 0.5) * spread if n > 1 else 0
        ld = rot(d, a)
        Lk = L * (1 - 0.35 * abs(k / (n - 1) - 0.5) * 2) if n > 1 else L
        draw_leaf(cv, b, ld, Lk, 0.55 + depth * 0.5, 'ovate', col, r, ao=ao, fold=0.3, vein=0.15 if k == n // 2 else 0, under=under)
    if not held:
        cv.cur, cv.hold = None, False


def rot(d, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (d[0] * c - d[1] * s, d[0] * s + d[1] * c)


def curve(p0, d0, length, n, bend, r, wob=0.08):
    """Polyline from p0 heading d0 (unit), turning by `bend` rad in total with a little wobble."""
    pts, a = [p0], math.atan2(d0[1], d0[0])
    for i in range(n):
        a += bend / n + (r.random() - 0.5) * wob
        x, y = pts[-1]
        pts.append((x + math.cos(a) * length / n, y + math.sin(a) * length / n))
    return pts


def along(pts, t):
    """Point and unit direction at fraction t of a polyline."""
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    tot, acc = sum(seg), 0
    for i, s in enumerate(seg):
        if acc + s >= t * tot or i == len(seg) - 1:
            f = (t * tot - acc) / (s or 1)
            a, b = pts[i], pts[i + 1]
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), ((b[0] - a[0]) / (s or 1), (b[1] - a[1]) / (s or 1))
        acc += s


# ---------------------------------------------------------------- sprays
def spray(seed, sp):
    """A leafy twig spray. sp keys: twig (rgb), tw (twig width px at SS), side (n side shoots), sang (deg), slen,
    bend (rad, main axis), pend (shoots curve down), nodes (leaves per unit shoot length), leaf(cv, b, d, ao, r),
    lspread (deg around the shoot), tipcluster (fraction of leaves bunched at the shoot tips), extra(cv, pts, r)."""
    r = random.Random(seed)
    cv = Canvas()
    shoots = []
    main = curve((N * (0.5 + (r.random() - 0.5) * 0.06), N * 0.02), (0, 1), N * sp.get('mlen', 0.9), 12, sp.get('bend', 0.25) * (1 if r.random() < 0.5 else -1), r)
    shoots.append((main, 1.0))
    ns = sp['side']
    for k in range(ns):
        t = 0.12 + 0.8 * (k + r.random() * 0.6) / ns
        p, d = along(main, t)
        side = 1 if k % 2 == 0 else -1
        ang = math.radians(sp['sang'] * (0.75 + 0.5 * r.random())) * side
        L = N * sp['slen'] * (1 - 0.45 * t) * (0.7 + 0.6 * r.random())
        bend = sp.get('pend', 0) * side * -0.9 + (r.random() - 0.5) * 0.4
        shoots.append((curve(p, rot(d, ang), L, 6, bend, r), 0.6))
        if sp.get('sub') and L > N * 0.18:          # tertiary shoots
            for j in range(sp['sub']):
                p2, d2 = along(shoots[-1][0], 0.35 + 0.5 * r.random())
                s2 = 1 if r.random() < 0.5 else -1
                shoots.append((curve(p2, rot(d2, math.radians(sp['sang'] * 0.8) * s2), L * 0.45, 4, (r.random() - 0.5) * 0.4, r), 0.35))
    for pts, w in shoots:
        cv.stroke(pts, sp['tw'] * w, sp['tw'] * w * 0.35, jit(sp['twig'], r))
    if sp.get('extra_under'):
        sp['extra_under'](cv, shoots, r)
    # leaves: collected, then drawn inner/back first with a darker (occluded) tone
    cmds = []
    for pts, w in shoots:
        length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        n = max(1, int(length / N * sp['nodes'] * (0.85 + 0.3 * r.random())))
        for i in range(n):
            t = 0.15 + 0.85 * (i + r.random() * 0.7) / n
            if r.random() < sp.get('tipcluster', 0):
                t = 0.8 + 0.2 * r.random()
            b, d = along(pts, min(1, t))
            s = 1 if (i % 2 == 0) else -1
            spread = math.radians(sp.get('lspread', 50) * (0.6 + 0.6 * r.random()))
            ld = rot(d, spread * s)
            ld = (ld[0], ld[1] + sp.get('ldroop', 0.0))
            ll = math.hypot(*ld) or 1
            ld = (ld[0] / ll, ld[1] / ll)
            out = abs(b[0] - N / 2) / (N / 2)
            cmds.append((r.random() * 0.6 + out * 0.4 + t * 0.2, b, ld))
    cmds.sort(key=lambda c: c[0])
    for i, (_, b, d) in enumerate(cmds):
        ao = 0.7 + 0.3 * (i / max(1, len(cmds) - 1))
        sp['leaf'](cv, b, d, ao, r)
    if sp.get('extra'):
        sp['extra'](cv, shoots, r)
    return cv.finish()


def jit(col, r, k=0.1):
    s = 1 + (r.random() - 0.5) * 2 * k
    return tuple(max(0, min(255, c * s)) for c in col)


def leafer(kind, L, wr, col, **kw):
    """Leaf callback: size jitter, optional yellowing / dead leaves (late summer: a few per spray)."""
    def f(cv, b, d, ao, r):
        c = col
        x = r.random()
        if x < kw.get('yellow', 0.04) * 0.5:
            c = (c[0] * 1.45 + 18, c[1] * 1.2 + 6, c[2] * 0.7)
        elif x < kw.get('yellow', 0.04) * 0.5 + kw.get('brownish', 0.02) * 0.5:
            c = (c[0] * 1.7 + 20, c[1] * 0.95, c[2] * 0.6)
        Ls = N * L * (0.75 + 0.45 * r.random())
        if kind == 'palm':
            draw_palmate(cv, b, d, Ls, kw.get('lobes', 5), c, r, depth=kw.get('depth', 0.45), ao=ao, under=kw.get('under'))
        else:
            # petiole
            pl = Ls * kw.get('pet', 0.12)
            cv.stroke([b, (b[0] + d[0] * pl, b[1] + d[1] * pl)], max(2, Ls * 0.03), max(1.5, Ls * 0.02), tuple(x * 0.85 for x in c), 0.3)
            b2 = (b[0] + d[0] * pl, b[1] + d[1] * pl)
            draw_leaf(cv, b2, d, Ls, wr * (0.85 + 0.3 * r.random()), kind, c, r, lobes=kw.get('lobes', 0), serr=kw.get('serr', 0),
                      under=kw.get('under'), fold=kw.get('fold', 0.45), ao=ao, curl=kw.get('curl', 0.35))
    return f


def pinnate(L, col, pairs=4, wr=0.32, under=None):
    """Compound leaf (ash): rachis with paired leaflets and a terminal one."""
    def f(cv, b, d, ao, r):
        Ls = N * L * (0.8 + 0.4 * r.random())
        cv.cur, cv.hold = cv.new_id(), True
        rach = curve(b, d, Ls, 6, (r.random() - 0.5) * 0.5, r, 0.03)
        cv.stroke(rach, max(2, Ls * 0.018), max(1.5, Ls * 0.01), (90, 100, 60), 0.3)
        for k in range(pairs):
            p, dd = along(rach, 0.18 + 0.75 * k / pairs)
            for s in (-1, 1):
                ld = rot(dd, s * math.radians(55 + 15 * r.random()))
                draw_leaf(cv, p, ld, Ls * 0.3, wr, 'lance', col, r, ao=ao, under=under, serr=0.08)
        p, dd = along(rach, 1)
        draw_leaf(cv, p, dd, Ls * 0.32, wr, 'lance', col, r, ao=ao, under=under)
        cv.cur, cv.hold = None, False
    return f


def bare_twigs(seed, col, w0, fork=3, depth=4, spread=38, fine=1.0):
    """Leafless twig spray for winter crowns: recursive forking twigs with buds (a soft haze from the game camera)."""
    r = random.Random(seed)
    cv = Canvas()

    def grow(p, d, L, w, lvl):
        pts = curve(p, d, L, 5, (r.random() - 0.5) * 0.5, r, 0.12)
        cv.stroke(pts, w, w * 0.55, jit(col, r, 0.08), 0.7)
        if lvl >= depth:
            q, dd = along(pts, 1)
            cv.d[0].ellipse([q[0] - w, q[1] - w, q[0] + w, q[1] + w], fill=tuple(int(c * 0.8) for c in col))
            return
        n = fork + (1 if r.random() < 0.4 else 0)
        for k in range(n):
            t = 0.3 + 0.7 * (k + r.random() * 0.5) / n
            q, dd = along(pts, t)
            s = 1 if (k + lvl) % 2 == 0 else -1
            grow(q, rot(dd, math.radians(spread * (0.6 + 0.7 * r.random())) * s), L * (0.5 + 0.2 * r.random()) * (1.1 - t * 0.4), w * 0.62, lvl + 1)
    grow((N / 2, N * 0.02), (0, 1), N * 0.55, w0, 0)
    return cv.finish()


def fruit(colr, rad, n):
    def f(cv, shoots, r):
        for _ in range(n):
            pts, _w = shoots[r.randrange(len(shoots))]
            p, d = along(pts, 0.4 + 0.6 * r.random())
            rr = N * rad * (0.8 + 0.4 * r.random())
            c = jit(colr, r, 0.15)
            for k in range(3):   # shaded sphere: 3 concentric discs with tilted normals
                s = rr * (1 - k * 0.3)
                cv.d[0].ellipse([p[0] - s, p[1] - s, p[0] + s, p[1] + s], fill=tuple(int(x * (0.75 + 0.15 * k)) for x in c))
                cv.d[1].ellipse([p[0] - s, p[1] - s, p[0] + s, p[1] + s], fill=(128 - 30 * (2 - k), 128 - 30 * (2 - k), 255))
                cv.d[2].ellipse([p[0] - s, p[1] - s, p[0] + s, p[1] + s], fill=255)
    return f


def blossom(colr, rad, n, petals=5):
    def f(cv, shoots, r):
        for _ in range(n):
            pts, _w = shoots[r.randrange(len(shoots))]
            p, d = along(pts, 0.3 + 0.7 * r.random())
            for _ in range(3 + r.randrange(5)):   # a small corymb
                q = (p[0] + (r.random() - 0.5) * N * rad * 5, p[1] + (r.random() - 0.5) * N * rad * 5)
                cv.cur, cv.hold = None, True
                for k in range(petals):
                    a = k / petals * 6.283 + r.random()
                    pd = (math.cos(a), math.sin(a))
                    draw_leaf(cv, q, pd, N * rad, 0.9, 'round', jit(colr, r, 0.05), r, fold=0.1, vein=0, curl=0.1)
                cv.hold = False
                cv.d[0].ellipse([q[0] - 4, q[1] - 4, q[0] + 4, q[1] + 4], fill=(200, 180, 90))
    return f


def thorns(colr, n, L):
    def f(cv, shoots, r):
        for pts, w in shoots:
            for _ in range(int(n * w)):
                p, d = along(pts, r.random())
                s = 1 if r.random() < 0.5 else -1
                td = rot(d, s * math.radians(60 + 30 * r.random()))
                Lt = N * L * (0.6 + 0.6 * r.random())
                cv.stroke([p, (p[0] + td[0] * Lt, p[1] + td[1] * Lt)], max(3, Lt * 0.12), 1.5, colr, 0.5)
    return f


def gorse_flowers(n):
    def f(cv, shoots, r):
        for _ in range(n):
            pts, _w = shoots[r.randrange(len(shoots))]
            p, d = along(pts, 0.2 + 0.8 * r.random())
            for k in range(2):
                q = (p[0] + (r.random() - 0.5) * N * 0.03, p[1] + (r.random() - 0.5) * N * 0.03)
                cv.cur, cv.hold = None, True
                draw_leaf(cv, q, rot(d, r.random() * 6.28), N * 0.035, 0.8, 'ovate', jit((236, 196, 48), r, 0.06), r, fold=0.5, vein=0)
                cv.hold = False
    return f


# ---------------------------------------------------------------- species
BARK_T = (92, 78, 62)
SP = {
    'oak': [dict(twig=BARK_T, tw=16, side=6, sang=55, slen=0.4, sub=1, nodes=34, tipcluster=0.55, lspread=60,
                 leaf=leafer('lobed', 0.15, 0.5, (58, 82, 34), lobes=4, yellow=0.03, brownish=0.03)),
            dict(twig=BARK_T, tw=15, side=5, sang=62, slen=0.45, sub=2, nodes=30, tipcluster=0.6, lspread=70, bend=0.5,
                 leaf=leafer('lobed', 0.14, 0.55, (64, 86, 36), lobes=3, yellow=0.03, brownish=0.04))],
    'beech': [dict(twig=(98, 88, 78), tw=11, side=7, sang=58, slen=0.42, sub=1, nodes=30, lspread=80, ldroop=0.15,
                   leaf=leafer('ovate', 0.11, 0.58, (72, 100, 38), serr=0.04, fold=0.35, yellow=0.03)),
              dict(twig=(98, 88, 78), tw=11, side=6, sang=52, slen=0.48, sub=2, nodes=28, lspread=85, bend=0.6,
                   leaf=leafer('ovate', 0.1, 0.6, (78, 106, 40), serr=0.04, fold=0.35, yellow=0.04))],
    'birch': [dict(twig=(88, 66, 58), tw=7, side=8, sang=55, slen=0.5, pend=0.45, nodes=34, lspread=55, ldroop=0.6, bend=0.3,
                   leaf=leafer('delta', 0.085, 0.75, (96, 124, 44), serr=0.18, yellow=0.08)),
              dict(twig=(88, 66, 58), tw=7, side=9, sang=50, slen=0.55, pend=0.6, nodes=30, lspread=50, ldroop=0.8,
                   leaf=leafer('delta', 0.08, 0.72, (102, 128, 48), serr=0.18, yellow=0.1))],
    'poplar': [dict(twig=(110, 108, 84), tw=12, side=6, sang=35, slen=0.35, sub=1, nodes=30, tipcluster=0.3, lspread=60,
                    leaf=leafer('delta', 0.11, 0.95, (66, 98, 38), serr=0.06, pet=0.35, under=(120, 140, 92), yellow=0.04)),
               dict(twig=(110, 108, 84), tw=12, side=7, sang=30, slen=0.32, sub=1, nodes=32, lspread=55,
                    leaf=leafer('delta', 0.1, 1.0, (72, 104, 40), serr=0.06, pet=0.35, under=(120, 140, 92), yellow=0.05))],
    'plane': [dict(twig=(104, 96, 72), tw=14, side=4, sang=55, slen=0.45, nodes=9, lspread=65,
                   leaf=leafer('palm', 0.2, 0, (74, 100, 44), lobes=5, depth=0.5, yellow=0.05)),
              dict(twig=(104, 96, 72), tw=14, side=5, sang=50, slen=0.4, nodes=8, lspread=60, bend=0.5,
                   leaf=leafer('palm', 0.19, 0, (80, 104, 46), lobes=5, depth=0.5, yellow=0.07))],
    'olive': [dict(twig=(118, 112, 96), tw=9, side=8, sang=40, slen=0.45, sub=1, nodes=46, lspread=40,
                   leaf=leafer('lance', 0.11, 0.2, (82, 94, 66), under=(158, 162, 142), fold=0.2, yellow=0)),
              dict(twig=(118, 112, 96), tw=9, side=9, sang=45, slen=0.4, sub=1, nodes=44, lspread=45, pend=0.4,
                   leaf=leafer('lance', 0.1, 0.22, (88, 98, 70), under=(158, 162, 142), fold=0.2, yellow=0))],
    'hedge': [dict(twig=(84, 72, 60), tw=9, side=9, sang=55, slen=0.45, sub=2, nodes=46, lspread=70,        # hawthorn
                   leaf=leafer('haw', 0.07, 0.8, (64, 98, 38), yellow=0.03), extra_under=thorns((90, 70, 56), 4, 0.03)),
              dict(twig=(60, 52, 50), tw=9, side=10, sang=60, slen=0.42, sub=2, nodes=52, lspread=60,      # blackthorn
                   leaf=leafer('elliptic', 0.06, 0.45, (60, 88, 40), serr=0.1, yellow=0.02), extra_under=thorns((50, 44, 42), 6, 0.035))],
    'scrub': [dict(twig=(130, 112, 92), tw=7, side=10, sang=50, slen=0.45, sub=2, nodes=30, lspread=60,
                   leaf=leafer('lance', 0.05, 0.3, (118, 120, 82), fold=0.2, yellow=0.1), extra_under=thorns((200, 190, 170), 6, 0.04)),
              dict(twig=(124, 106, 88), tw=7, side=9, sang=45, slen=0.5, sub=2, nodes=26, lspread=55,
                   leaf=leafer('elliptic', 0.045, 0.5, (122, 126, 92), fold=0.2, yellow=0.12))],
    'willow': [dict(twig=(130, 112, 62), tw=7, side=7, sang=30, slen=0.55, pend=1.2, nodes=40, lspread=25, ldroop=0.5,
                    leaf=leafer('lance', 0.15, 0.16, (98, 118, 72), under=(150, 160, 140), fold=0.25, serr=0.04, yellow=0.06)),
               dict(twig=(130, 112, 62), tw=7, side=6, sang=25, slen=0.6, pend=1.6, nodes=44, lspread=22, ldroop=0.7,
                    leaf=leafer('lance', 0.14, 0.15, (104, 124, 76), under=(150, 160, 140), fold=0.25, serr=0.04, yellow=0.08))],
    'ash': [dict(twig=(110, 108, 98), tw=13, side=3, sang=45, slen=0.42, nodes=6, lspread=55, leaf=pinnate(0.36, (74, 102, 42), 4)),
            dict(twig=(110, 108, 98), tw=13, side=4, sang=50, slen=0.4, nodes=6, lspread=50, leaf=pinnate(0.33, (80, 106, 44), 5))],
    'apple': [dict(twig=(96, 80, 66), tw=12, side=6, sang=50, slen=0.42, sub=1, nodes=26, tipcluster=0.4, lspread=55,
                   leaf=leafer('ovate', 0.1, 0.6, (70, 98, 46), serr=0.08, under=(120, 136, 100), yellow=0.04)),
              dict(twig=(96, 80, 66), tw=12, side=6, sang=55, slen=0.42, sub=1, nodes=24, tipcluster=0.4, lspread=60,
                   leaf=leafer('ovate', 0.1, 0.6, (72, 100, 46), serr=0.08, under=(120, 136, 100), yellow=0.05), extra=fruit((168, 74, 44), 0.028, 9))],
    'hazel': [dict(twig=(116, 90, 66), tw=10, side=6, sang=50, slen=0.45, nodes=20, lspread=75,
                   leaf=leafer('round', 0.14, 0.9, (80, 106, 44), serr=0.1, fold=0.3, yellow=0)),
              dict(twig=(116, 90, 66), tw=10, side=5, sang=55, slen=0.5, nodes=18, lspread=80, bend=0.5,
                   leaf=leafer('round', 0.13, 0.92, (86, 110, 46), serr=0.1, fold=0.3, yellow=0))],
    'acacia': [dict(twig=(98, 70, 54), tw=9, side=10, sang=55, slen=0.4, sub=2, nodes=14, lspread=70,
                    leaf=pinnate(0.12, (112, 124, 70), 6, 0.35), extra_under=thorns((226, 220, 200), 5, 0.05)),
               dict(twig=(98, 70, 54), tw=9, side=9, sang=60, slen=0.42, sub=2, nodes=12, lspread=70,
                    leaf=pinnate(0.11, (120, 128, 76), 6, 0.35), extra_under=thorns((226, 220, 200), 6, 0.05))],
    'brown': [dict(twig=BARK_T, tw=15, side=5, sang=55, slen=0.4, sub=1, nodes=16, tipcluster=0.6, lspread=60,   # marcescent oak
                   leaf=leafer('lobed', 0.13, 0.4, (118, 82, 46), lobes=4, fold=0.8, curl=0.7, yellow=0, brownish=0)),
              dict(twig=(98, 88, 78), tw=10, side=7, sang=58, slen=0.42, sub=1, nodes=20, lspread=80, ldroop=0.25,  # beech
                   leaf=leafer('ovate', 0.1, 0.5, (156, 100, 54), serr=0.04, fold=0.7, curl=0.6, yellow=0, brownish=0))],
    'ivy': [dict(twig=(80, 72, 56), tw=8, side=5, sang=60, slen=0.4, nodes=14, lspread=70, bend=0.7,
                 leaf=leafer('palm', 0.13, 0, (40, 62, 30), lobes=3, depth=0.4, yellow=0)),
            dict(twig=(80, 72, 56), tw=8, side=6, sang=65, slen=0.38, nodes=16, lspread=75, bend=0.9,
                 leaf=leafer('palm', 0.12, 0, (44, 66, 32), lobes=5, depth=0.35, yellow=0))],
    'gorse': [dict(twig=(70, 82, 44), tw=8, side=12, sang=45, slen=0.42, sub=2, nodes=0, lspread=40,
                   leaf=lambda *a: None, extra_under=thorns((54, 76, 36), 30, 0.035), extra=gorse_flowers(70)),
              dict(twig=(66, 80, 42), tw=8, side=12, sang=40, slen=0.45, sub=2, nodes=0, lspread=40,
                   leaf=lambda *a: None, extra_under=thorns((50, 72, 34), 34, 0.035), extra=gorse_flowers(18))],
}
TWIG = [((92, 70, 64), 30, 3, 5, 36), ((104, 96, 86), 38, 3, 4, 42)]   # birch-like purple-brown haze, oak/beech grey
ORDER = ['oak', 'beech', 'birch', 'poplar', 'plane', 'olive', 'hedge', 'scrub', 'spruce', 'fir', 'pine', 'palm', 'palmdry',
         'willow', 'ash', 'apple', 'hazel', 'acacia', 'brown', 'twig', 'ivy', 'gorse', 'palmleaf']


def leaflet(seed, col, dry):
    """One palm leaflet filling the tile (u across, v base -> tip): a V-folded lanceolate blade, so a thin quad per
    leaflet carries the taper, the fold shading and a split / frayed tip on the dead ones."""
    r = random.Random(seed)
    cv = Canvas()
    for k in range(3):   # three overlapping leaflets per tile, slightly offset (reads as a rank, not a single blade)
        x0 = N * (0.5 + (k - 1) * 0.18)
        b, d = (x0, N * 0.01), rot((0, 1), (k - 1) * 0.06)
        draw_leaf(cv, b, d, N * (0.97 - abs(k - 1) * 0.08), 0.16, 'lance', jit(col, r, 0.06), r, fold=0.9, vein=0.18, curl=0.1, ao=0.85 + 0.15 * (k == 1))
        if dry:   # frayed tip
            for j in range(4):
                q = (x0 + (r.random() - 0.5) * N * 0.05, N * (0.75 + 0.2 * r.random()))
                cv.d[2].line([q, (q[0] + (r.random() - 0.5) * N * 0.04, q[1] + N * 0.06)], fill=0, width=int(N * 0.012))
    return cv.finish()


def old_tiles():
    """The conifer / palm tiles of the previous atlas (RGBA strip of 512 px tiles) -> {name_v: (albedo, normal)}."""
    raw = subprocess.run(['git', 'show', f'{OLD_REV}:assets/terrain/foliage.webp'], cwd=ROOT, capture_output=True, check=True).stdout
    meta = json.loads(subprocess.run(['git', 'show', f'{OLD_REV}:assets/terrain/foliage.json'], cwd=ROOT, capture_output=True, check=True).stdout)
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    s = meta['size']
    out = {}
    for i, name in enumerate(meta['layers']):
        if name.rsplit('_', 1)[0] not in KEEP:
            continue
        t = np.asarray(im.crop((0, i * s, s, (i + 1) * s)).resize((T, T), Image.LANCZOS), dtype=np.float32)
        a = t[..., 3] / 255
        alb = bleed(t[..., :3] * a[..., None], a)
        an = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((TN, TN), Image.BILINEAR), dtype=np.uint8)
        nor = np.dstack([np.full((TN, TN), 128, np.uint8), np.full((TN, TN), 128, np.uint8), an, np.full((TN, TN), 255, np.uint8)])
        out[name] = (Image.fromarray(alb, 'RGB'), Image.fromarray(nor, 'RGBA'))
    return out


def bake(job):
    name, v = job
    seed = 1000 + ORDER.index(name) * 17 + v * 7
    if name == 'palmleaf':
        return leaflet(seed, [(128, 146, 104), (160, 132, 90)][v], v == 1)
    if name == 'twig':
        col, w, fork, depth, spread = TWIG[v]
        return bare_twigs(seed, col, w, fork, depth, spread)
    return spray(seed, SP[name][v])


def grid(imgs, t):
    rows = (len(imgs) + COLS - 1) // COLS
    g = Image.new(imgs[0].mode, (COLS * t, rows * t), (0, 0, 0, 255)[:len(imgs[0].mode)])
    for i, im in enumerate(imgs):
        g.paste(im, ((i % COLS) * t, (i // COLS) * t))
    return g


def main():
    from multiprocessing import Pool
    jobs = [(n, v) for n in ORDER if n not in KEEP for v in (0, 1)]
    only = os.environ.get('ONLY')
    if only:
        jobs = [j for j in jobs if j[0] in only.split(',')]
    with Pool(int(os.environ.get('PROCS', '8'))) as pool:
        res = dict(zip(jobs, pool.map(bake, jobs)))
    prev = os.environ.get('PREVIEW_DIR')
    if prev:
        for (n, v), (a, nn) in res.items():
            cov = nn.split()[2].resize((T, T))
            Image.composite(a, Image.new('RGB', a.size, (215, 220, 228)), cov).save(os.path.join(prev, f'leaf_{n}_{v}.png'))
    if only:
        return
    old = old_tiles()
    albs, nors, names = [], [], []
    for n in ORDER:
        for v in (0, 1):
            a, nn = old[f'{n}_{v}'] if n in KEEP else res[(n, v)]
            albs.append(a); nors.append(nn); names.append(f'{n}_{v}')
    grid(albs, T).save(os.path.join(OUT, 'foliage.webp'), quality=88, method=6)
    grid(nors, TN).save(os.path.join(OUT, 'foliage_n.webp'), lossless=True, exact=True, method=6)
    json.dump({'size': T, 'normalSize': TN, 'cols': COLS, 'layers': names,
               'sources': 'procedural leaf / twig sprays (tools/render/build_leaves.py), own work, CC0; conifer and palm tiles: '
                          'ambientCG LeafSet004/010/013/022/024/030, PineNeedles001 (CC0), palm fronds procedural'},
              open(os.path.join(OUT, 'foliage.json'), 'w'), indent=1)
    print('layers', len(names))


if __name__ == '__main__':
    main()
