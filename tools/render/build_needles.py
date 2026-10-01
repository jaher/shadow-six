#!/usr/bin/env python3
"""
Bake the conifer needle-spray atlas (own procedural work, CC0).

  python3 tools/render/build_needles.py            # -> assets/terrain/needles.webp, needles_n.webp, needles.json

Every layer is one card: v runs from the branch base (v=0, image row 0 = top of the tile) to the tip (v=1), the
twig axis on u=0.5. Individual needles are rasterised as tapered three-strip polygons at 4x supersampling (left / centre / right
strip carry a cylindrical normal), on twigs with side shoots, then box-filtered down.

  needles.webp    sRGB albedo, opaque (colour bled into the transparent texels so mips never darken)
  needles_n.webp  R,G tangent-space normal xy (z rebuilt in the shader), B coverage alpha. The shader derives the
                  needle mass (snow fill, crown AO) from a blurred mip of B and the translucency from 1 - mass, so
                  thin needle edges glow when back-lit and dense twig cores do not. Both images are opaque.
"""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'terrain')
T = 512          # tile
SS = 4           # supersampling
N = T * SS
GAP = 0.62     # albedo of the bled gap texels relative to the needles


class Canvas:
    def __init__(self):
        self.alb = Image.new('RGB', (N, N), (0, 0, 0))
        self.nor = Image.new('RGB', (N, N), (128, 128, 0))   # B = translucency
        self.a = Image.new('L', (N, N), 0)
        self.d = [ImageDraw.Draw(i) for i in (self.alb, self.nor, self.a)]

    def needle(self, b, d, L, w, col, trans=0.8, flat=0.6):
        """Tapered needle from base b along unit dir d (pixel units at SS)."""
        p = (-d[1], d[0])
        hw = lambda t: (0.35 + 0.65 * min(1, t / 0.3)) * (1 - max(0, (t - 0.3) / 0.7) ** 1.6) * w * 0.5
        ts = (0.0, 0.3, 0.7, 1.0)
        for k, (s0, s1) in enumerate(((-1, -1 / 3), (-1 / 3, 1 / 3), (1 / 3, 1))):
            left = [(b[0] + d[0] * L * t + p[0] * s0 * hw(t), b[1] + d[1] * L * t + p[1] * s0 * hw(t)) for t in ts]
            right = [(b[0] + d[0] * L * t + p[0] * s1 * hw(t), b[1] + d[1] * L * t + p[1] * s1 * hw(t)) for t in reversed(ts)]
            poly = left + right
            sx = (k - 1) * flat                     # strip normal: -flat, 0, +flat across the needle
            nx, ny = p[0] * sx, p[1] * sx
            nz = 1.0 / math.sqrt(1 + nx * nx + ny * ny)
            # image row 0 = texture v 0 (DataArrayTexture, no flip): +x = +u, +y (down) = +v (base -> tip)
            nrm = (int(128 + 127 * nx * nz), int(128 + 127 * ny * nz), int(255 * trans))
            sh = 0.88 + 0.12 * (1 - abs(k - 1))      # tiny centre highlight baked in albedo
            self.d[0].polygon(poly, fill=tuple(int(min(255, c * sh)) for c in col))
            self.d[1].polygon(poly, fill=nrm)
            self.d[2].polygon(poly, fill=255)

    def twig(self, pts, w0, w1, col):
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            t = i / max(1, len(pts) - 2)
            w = w0 + (w1 - w0) * t
            dx, dy = b[0] - a[0], b[1] - a[1]
            l = math.hypot(dx, dy) or 1
            d = (dx / l, dy / l)
            self.needle(a, d, l * 1.15, w, col, trans=0.08, flat=0.75)

    def finish(self):
        """Downsample and bleed. Returns (albedo RGB, normal+alpha RGB) at T, both opaque images so the browser's
        premultiplied 2D-canvas decode cannot zero the colour of transparent texels (dark mip fringes)."""
        A = np.asarray(self.a, dtype=np.float32) / 255
        C = np.asarray(self.alb, dtype=np.float32) * A[..., None]
        Nn = np.asarray(self.nor, dtype=np.float32)[..., :2] * A[..., None]
        def box(x):
            s = x.shape
            return x.reshape(T, SS, T, SS, *s[2:]).mean(axis=(1, 3))
        a, c, n = box(A), box(C), box(Nn)
        def blur(x, r):
            # three box passes per axis ~ gaussian (float, any channel count)
            k = max(1, int(r))
            for ax in (0, 1):
                for _ in range(3):
                    pad = [(0, 0)] * x.ndim; pad[ax] = (k + 1, k)
                    cs = np.cumsum(np.pad(x, pad, mode='edge'), axis=ax)
                    x = (np.take(cs, range(2 * k + 1, cs.shape[ax]), axis=ax) - np.take(cs, range(0, cs.shape[ax] - 2 * k - 1), axis=ax)) / (2 * k + 1)
            return x
        # colour/normal = coverage-weighted average, then bled outward with growing blurs (mips stay needle-coloured)
        out_c = c / np.maximum(a[..., None], 1e-4); out_n = n / np.maximum(a[..., None], 1e-4)
        have = a > 0.02
        for r in (2, 5, 12, 30):
            bc = blur(np.dstack([c, a[..., None]]).astype(np.float32), r); bn = blur(n.astype(np.float32), r)
            w = np.maximum(bc[..., 3:4], 1e-6)
            fill = (~have) & (bc[..., 3] > 1e-4)
            out_c[fill] = (bc[..., :3] / w)[fill]; out_n[fill] = (bn / w)[fill]
            have = have | fill
        out_c[~have] = c.sum(axis=(0, 1)) / max(a.sum(), 1e-4)
        # gaps hold a darker bleed: under minification the space between shoots reads as the shaded crown interior
        # (shoot structure stays visible at the game's zooms instead of averaging into a flat smear)
        out_c = out_c * (GAP + (1 - GAP) * np.clip(a[..., None] * 2.5, 0, 1))
        out_n[~have] = 128
        # outside the needles the normal relaxes to flat
        out_n = out_n * a[..., None] ** 0.25 + 128 * (1 - a[..., None] ** 0.25)
        alb = np.clip(out_c, 0, 255).astype(np.uint8)
        nor = np.dstack([np.clip(out_n, 0, 255), a * 255]).astype(np.uint8)
        return Image.fromarray(alb, 'RGB'), Image.fromarray(nor, 'RGB')


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def jit(col, r, k=0.12):
    s = 1 + (r.random() - 0.5) * 2 * k
    return tuple(max(0, min(255, c * s * (1 + (r.random() - 0.5) * 0.06))) for c in col)


def curve(p0, d0, length, n, bend, r):
    """Polyline from p0 heading d0 (unit), turning by `bend` rad in total with a little wobble."""
    pts, a = [p0], math.atan2(d0[1], d0[0])
    for i in range(n):
        a += bend / n + (r.random() - 0.5) * 0.06
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


def rot(d, ang):
    c, s = math.cos(ang), math.sin(ang)
    return (d[0] * c - d[1] * s, d[0] * s + d[1] * c)


SPRUCE = dict(old=(36, 60, 32), mid=(54, 84, 42), new=(108, 140, 60), yel=(104, 104, 52), twig=(108, 74, 48))
# Scots pine needles are a light grey/yellow-green (not the dark blue-green of spruce)
SCOTS = dict(old=(58, 74, 44), mid=(82, 104, 58), new=(124, 144, 76), yel=(146, 132, 64), twig=(150, 96, 56))
STONE = dict(old=(34, 52, 26), mid=(62, 90, 40), new=(104, 130, 58), yel=(126, 118, 52), twig=(120, 84, 52))


def needled_shoot(cv, pts, pal, r, L, w, spacing, ang=(0.95, 1.3), top=0.5, age0=0.0):
    """Bottle-brush shoot: needles left/right of the shoot (and some foreshortened on top), older at the base."""
    tot = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    n = max(2, int(tot / spacing))
    for i in range(n):
        t = (i + r.random() * 0.6) / n
        b, d = along(pts, t)
        age = min(1, age0 + (1 - t))                       # 1 = old (shoot base) .. 0 = this year's growth
        col = mix(pal['new'], pal['mid'], min(1, age * 1.6)) if age < 0.6 else mix(pal['mid'], pal['old'], (age - 0.6) / 0.4)
        for side in (-1, 1):
            if r.random() < 0.08: continue
            c = pal['yel'] if r.random() < 0.025 else col
            a = side * (ang[0] + (ang[1] - ang[0]) * r.random())
            cv.needle(b, rot(d, a), L * (0.8 + 0.35 * r.random()) * (0.75 + 0.25 * (1 - t * 0.5)), w, jit(c, r), trans=0.85)
        if r.random() < top:                              # needle pointing at the viewer: foreshortened
            a = (r.random() - 0.5) * 1.2
            cv.needle(b, rot(d, a), L * (0.35 + 0.3 * r.random()), w * 1.1, jit(mix(col, pal['new'], 0.25), r), trans=0.7)


def spruce_spray(seed, narrow=1.0, droop=0.0):
    r = random.Random(seed)
    cv, pal = Canvas(), SPRUCE
    ax = curve((N * 0.5, N * 0.015), (0.0, 1.0), N * 0.95, 14, (r.random() - 0.5) * 0.25, r)
    hw = lambda t: N * 0.45 * narrow * math.sin(math.pi * min(1, 0.12 + 0.88 * t)) ** 0.75 * (1 - 0.4 * t)
    shoots, k = [], 0
    t = 0.04
    while t < 0.93:
        side = 1 if k % 2 else -1
        k += 1
        b, d = along(ax, t)
        a = side * (0.75 + 0.3 * r.random())
        dl = rot(d, -a)                                    # image space: rotate toward +x / -x
        ln = hw(t) / max(0.4, math.sin(abs(a))) * (0.85 + 0.35 * r.random())
        sp = curve(b, dl, ln, 6, side * (0.25 + 0.2 * r.random()) + droop * side, r)
        shoots.append((sp, t))
        if ln > N * 0.1:                                   # tertiary shoots
            for j in range(3 + int(r.random() * 3)):
                tt = 0.2 + 0.6 * (j + r.random() * 0.5) / 3
                bb, dd = along(sp, tt)
                s2 = 1 if j % 2 else -1
                shoots.append((curve(bb, rot(dd, -s2 * (0.8 + 0.3 * r.random())), ln * (0.25 + 0.15 * r.random()) * (1 - tt * 0.5), 3, s2 * 0.2, r), t + 0.2))
        t += 0.022 + 0.012 * r.random()
    cv.twig(ax, N * 0.012, N * 0.004, pal['twig'])
    for sp, t0 in shoots:
        cv.twig(sp, N * 0.005, N * 0.0025, mix(pal['twig'], (70, 52, 36), 0.3))
    for sp, t0 in shoots:                                  # needles last so they cover the twigs
        needled_shoot(cv, sp, pal, r, N * 0.024, N * 0.0036, N * 0.0058, age0=max(0, 0.4 - t0 * 0.4))
    needled_shoot(cv, ax, pal, r, N * 0.024, N * 0.0038, N * 0.0058, age0=0.3)
    return cv.finish()


def spruce_curtain(seed):
    """Hanging branchlets (Norway spruce 'comb' habit): the branch runs down the left edge (u=0.04), the curtain
    hangs toward u=1. v still runs base -> tip along the branch."""
    r = random.Random(seed)
    cv, pal = Canvas(), SPRUCE
    ax = curve((N * 0.04, 0), (0.0, 1.0), N * 0.98, 10, 0.0, r)
    t = 0.03
    hangs = []
    while t < 0.95:
        b, d = along(ax, t)
        ln = N * (0.5 + 0.42 * r.random()) * (1 - 0.35 * t)
        hangs.append(curve(b, rot(d, -(1.3 + 0.25 * r.random())), ln, 7, 0.12 + 0.12 * r.random(), r))
        t += 0.032 + 0.025 * r.random()
    cv.twig(ax, N * 0.01, N * 0.005, pal['twig'])
    for hp in hangs:
        cv.twig(hp, N * 0.005, N * 0.002, mix(pal['twig'], (70, 52, 36), 0.3))
    for hp in hangs:
        needled_shoot(cv, hp, pal, r, N * 0.022, N * 0.0034, N * 0.006, age0=0.15)
    return cv.finish()


def pine_tuft(seed, pal, L, w, forks, spread=1.0):
    """Twig ending in a brush of needles (Pinus): the older part of the twig is bare, the last ~70 % carries paired
    needles splaying outward-forward at varied lengths, so the outline is a spiky starburst with sky showing between
    the needles (a smooth dense envelope read as a broad leaf), lighter new shoots at the tip."""
    r = random.Random(seed)
    cv = Canvas()
    main = curve((N * 0.5, N * 0.0), (0.0, 1.0), N * (0.5 if forks else 0.58), 8, (r.random() - 0.5) * 0.3, r)
    twigs = [main]
    for f in range(forks):
        b, d = along(main, 0.4 + 0.3 * r.random())
        s = 1 if f % 2 else -1
        twigs.append(curve(b, rot(d, -s * (0.6 + 0.4 * r.random())), N * (0.3 + 0.12 * r.random()), 5, s * 0.3, r))
    for tw in twigs:
        cv.twig(tw, N * 0.016, N * 0.009, pal['twig'])
    for tw in twigs:
        tot = sum(math.dist(tw[i], tw[i + 1]) for i in range(len(tw) - 1))
        n = int(tot / (N * 0.0056))
        order = []
        for i in range(n):
            t = 0.28 + 0.72 * (i + r.random()) / n
            order.append((r.random(), t))
        order.sort()
        for _, t in order:
            b, d = along(tw, t)
            age = 1 - t
            col = mix(pal['new'], pal['mid'], min(1, age * 3)) if age < 0.33 else mix(pal['mid'], pal['old'], min(1, (age - 0.33) / 0.25))
            if r.random() < 0.05: col = pal['yel']
            fan = (0.35 + 0.65 * (1 - t) ** 0.5) * spread       # tip needles point forward, base ones splay wide
            a0 = (r.random() - 0.5) * 2 * (0.35 + 1.05 * fan)
            for pair in (-0.09, 0.09):                          # needles come in pairs (fascicles), slightly twisted
                ln = L * (0.6 + 0.75 * r.random()) * (0.75 + 0.25 * t)
                cv.needle(b, rot(d, a0 + pair + (r.random() - 0.5) * 0.18), ln, w, jit(col, r, 0.22), trans=0.9, flat=0.5)
        # this year's terminal bud + candle of short bright needles
        b, d = along(tw, 1.0)
        for k in range(12):
            cv.needle(b, rot(d, (r.random() - 0.5) * 2.0), L * (0.3 + 0.3 * r.random()), w, jit(pal['new'], r), trans=0.9)
    return cv.finish()


def pine_cluster(seed, pal, L, w, laterals, spread=1.0):
    """A pine branchlet: a twig with alternating side shoots, every shoot ending in its own small brush of paired
    needles. One card then carries many 10–20 cm brushes, so a crown reads as pine foliage texture at the game
    zooms; one big brush per card read as a lobed broad leaf."""
    r = random.Random(seed)
    cv = Canvas()
    main = curve((N * 0.5, N * 0.0), (0.0, 1.0), N * 0.82, 9, (r.random() - 0.5) * 0.3, r)
    shoots = [(main, 1.0)]
    for k in range(laterals):
        t = 0.22 + 0.62 * (k + r.random() * 0.6) / laterals
        b, d = along(main, t)
        s = 1 if k % 2 else -1
        ln = N * (0.27 + 0.16 * r.random()) * (1.15 - 0.45 * t)
        shoots.append((curve(b, rot(d, -s * (0.7 + 0.4 * r.random())), ln, 4, s * 0.25, r), 0.75))
    for sp, wk in shoots:
        cv.twig(sp, N * 0.012 * wk, N * 0.006 * wk, pal['twig'])
    order = []
    for sp, wk in shoots:
        tot = sum(math.dist(sp[i], sp[i + 1]) for i in range(len(sp) - 1))
        n = int(tot / (N * 0.0052))
        for i in range(n):
            t = (i + r.random()) / n
            if t < (0.55 if wk == 1.0 else 0.25):           # needles on the outer part of each shoot only
                continue
            order.append((r.random(), sp, t))
    order.sort()                                            # interleave shoots so none sits wholly on top
    for _, sp, t in order:
        b, d = along(sp, t)
        age = 1 - t
        col = mix(pal['new'], pal['mid'], min(1, age * 3)) if age < 0.33 else mix(pal['mid'], pal['old'], min(1, (age - 0.33) / 0.3))
        if r.random() < 0.05: col = pal['yel']
        fan = (0.4 + 0.6 * (1 - t) ** 0.5) * spread
        a0 = (r.random() - 0.5) * 2 * (0.35 + 1.0 * fan)
        for pair in (-0.09, 0.09):
            ln = L * (0.6 + 0.7 * r.random()) * (0.75 + 0.25 * t)
            cv.needle(b, rot(d, a0 + pair + (r.random() - 0.5) * 0.18), ln, w, jit(col, r, 0.22), trans=0.9, flat=0.5)
    for sp, wk in shoots:                                   # bright candle at every shoot tip
        b, d = along(sp, 1.0)
        for k in range(6):
            cv.needle(b, rot(d, (r.random() - 0.5) * 1.8), L * (0.3 + 0.3 * r.random()), w, jit(pal['new'], r), trans=0.9)
    return cv.finish()


def pine_rosette(seed, pal, L, w, twigs):
    """A branch end seen from above (pad cap): twigs radiating from the centre, each a brush of paired needles
    fanning outward, so a flat card reads as a needle cushion instead of a single tuft."""
    r = random.Random(seed)
    cv = Canvas()
    c = (N * 0.5, N * 0.5)
    tws = []
    for k in range(twigs):                                 # irregular lengths/angles: a fuzzy cushion, not a star
        a = k / twigs * 6.283 + (r.random() - 0.5) * 0.9
        ln = N * (0.1 + 0.22 * r.random())
        tws.append(curve(c, (math.cos(a), math.sin(a)), ln, 4, (r.random() - 0.5) * 0.4, r))
    for tw in tws:
        cv.twig(tw, N * 0.012, N * 0.007, pal['twig'])
    order = []
    for tw in tws:
        tot = sum(math.dist(tw[i], tw[i + 1]) for i in range(len(tw) - 1))
        n = int(tot / (N * 0.0042))
        for i in range(n):
            t = (i + r.random()) / n
            order.append((r.random(), tw, t))
    order.sort()                                           # interleave twigs so no twig sits wholly on top
    for _, tw, t in order:
        b, d = along(tw, t)
        age = 1 - t
        col = mix(pal['new'], pal['mid'], min(1, age * 2.5)) if age < 0.4 else mix(pal['mid'], pal['old'], (age - 0.4) / 0.6)
        if r.random() < 0.04: col = pal['yel']
        a0 = (r.random() - 0.5) * 2 * (0.7 + 1.0 * (1 - t))
        for pair in (-0.08, 0.08):
            cv.needle(b, rot(d, a0 + pair), L * (0.7 + 0.4 * r.random()), w, jit(col, r, 0.2), trans=0.9, flat=0.5)
    for k in range(24):                                    # centre: this year's candles
        cv.needle(c, rot((1, 0), r.random() * 6.283), L * (0.3 + 0.3 * r.random()), w * 1.1, jit(pal['new'], r), trans=0.9)
    return cv.finish()


LAYERS = [
    ('spruce_0', lambda: spruce_spray(11)),
    ('spruce_1', lambda: spruce_spray(23, narrow=0.85, droop=0.15)),
    ('spruce_curtain', lambda: spruce_curtain(37)),
    ('spruce_top', lambda: spruce_spray(41, narrow=0.6)),
    ('scots_0', lambda: pine_cluster(53, SCOTS, N * 0.085, N * 0.0055, 7, 1.3)),
    ('scots_1', lambda: pine_cluster(67, SCOTS, N * 0.09, N * 0.0055, 5, 1.4)),
    ('stone_0', lambda: pine_tuft(71, STONE, N * 0.16, N * 0.006, 2, 1.2)),
    ('stone_1', lambda: pine_tuft(89, STONE, N * 0.14, N * 0.006, 3, 1.35)),
    ('scots_pad', lambda: pine_rosette(97, SCOTS, N * 0.12, N * 0.0055, 14)),
    ('stone_pad', lambda: pine_rosette(103, STONE, N * 0.15, N * 0.006, 12)),
]


def main():
    import sys
    only = sys.argv[1:] or None
    albs, nors = [], []
    for name, fn in LAYERS:
        if only and name not in only: continue
        a, n = fn()
        albs.append(a); nors.append(n)
        print('baked', name, flush=True)
    if only:   # preview
        for (name, _), a, n in zip([l for l in LAYERS if l[0] in only], albs, nors):
            bg = Image.composite(a, Image.new('RGB', a.size, (215, 220, 228)), n.split()[2]); bg.save(os.path.join(os.environ.get('PREVIEW_DIR', '.'), f'needles_{name}.png'))
        return
    strip = lambda ims: (lambda s: ([s.paste(im, (0, i * T)) for i, im in enumerate(ims)], s)[1])(Image.new('RGB', (T, T * len(ims))))
    strip(albs).save(os.path.join(OUT, 'needles.webp'), lossless=False, quality=90, method=6)
    strip(nors).save(os.path.join(OUT, 'needles_n.webp'), lossless=True, method=6)
    json.dump({'size': T, 'layers': [l[0] for l in LAYERS], 'sources': 'procedural needle sprays (tools/render/build_needles.py), own work, CC0'},
              open(os.path.join(OUT, 'needles.json'), 'w'), indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
