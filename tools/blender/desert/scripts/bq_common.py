"""Shared helpers for the M9 Bab el Qattara assets (21st Panzer Division forward camp, Egyptian desert, Oct 1942):
sun-bleached whitewash and mud render, wind-blown sand at every foot, DAK sand-yellow paint. argv after '--':
outroot variant seed."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dz
from dz import K, C, KA, V, bmesh
import kit_roof as KR

DAK = (0.78, 0.66, 0.46)             # RAL 8020 sand-yellow, faded
DAK_GREY = (0.47, 0.47, 0.44)        # the grey showing where the yellow is worn
WASH = (0.97, 0.95, 0.9)
SHUT_GREEN = (0.24, 0.38, 0.3)


def args(default='a'):
    a = dz.argv()
    return (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else default), (int(a[2]) if len(a) > 2 else 1)


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def posts(pts, z0, z1, s=0.2, mid='timber_beam', name='posts', tint=(0.72, 0.62, 0.5)):
    bm = bmesh.new()
    for (x, y) in pts:
        C.box_bm(bm, (x, y, (z0 + z1) / 2), (s, s, z1 - z0))
    K.part(bm, mid, name=name, mat_tint=tint, uv='beam', axis=(0, 0, 1), grime=0.6)


def beams(pairs, s=0.16, mid='timber_beam', name='beams', tint=(0.72, 0.62, 0.5), h=None):
    bm = bmesh.new()
    for a, b in pairs:
        C.beam_bm(bm, a, b, s, h or s)
    K.part(bm, mid, name=name, mat_tint=tint, uv='beam', axis=(1, 0, 0), grime=0.6)


def whip(x, y, z0, h=4.5, name='whip'):
    """Whip aerial on a base insulator with a spring foot (a bracket on the wall head)."""
    bm = bmesh.new()
    C.cyl_bm(bm, V((x, y, z0)), V((x, y, z0 + 0.25)), 0.05, 6)
    C.cyl_bm(bm, V((x, y, z0 + 0.25)), V((x + 0.04, y, z0 + h)), 0.012, 4, r1=0.006)
    K.part(bm, 'cast_iron', name=name, mat_tint=(0.35, 0.34, 0.3), bisect=False)


def wire(p0, p1, sag=0.25, name='wire', r=0.01):
    bm = bmesh.new()
    p0, p1 = V(p0), V(p1)
    n = 8
    pts = [p0.lerp(p1, i / n) - V((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
    for a, b in zip(pts, pts[1:]):
        C.cyl_bm(bm, a, b, r, 3, caps=False)
    K.part(bm, 'cast_iron', name=name, mat_tint=(0.2, 0.2, 0.2), bisect=False)


def jerrycans(c, n=6, rot=0.0, name='jerry', tint=DAK):
    """A neat row / stack of Wehrmacht 20 l cans (0.35 x 0.16 x 0.47)."""
    bm = bmesh.new()
    rr = K.rng()
    d = V((math.cos(rot), math.sin(rot), 0))
    for k in range(n):
        row, col = divmod(k, 4)
        p = V(c) + d * (col * 0.19) + V((0, 0, row * 0.48))
        dz.jerrycan(bm, tuple(p + V((rr.uniform(-0.02, 0.02), rr.uniform(-0.02, 0.02), 0))), rot + math.pi / 2 + rr.uniform(-0.08, 0.08))
    K.part(bm, 'paint_metal', name=name, mat_tint=tint, grime=0.7, bisect=False)


def drums(pts, tint=(0.33, 0.36, 0.3), name='drums', lying=()):
    bm = bmesh.new()
    for i, p in enumerate(pts):
        dz.drum(bm, p, lying=i in lying)
    K.part(bm, 'paint_metal', name=name, mat_tint=tint, grime=0.8, bisect=False, smooth=True)


def sand_feet(poly, h=0.22, w=0.8, seed=1, skip=()):
    """Wind-blown sand heaped along every outer wall foot of CCW poly (skip edges by index)."""
    for i in range(len(poly)):
        if i in skip:
            continue
        a, b, r, n, L = dz.edge(poly, i)
        dz.sand_drift(a + r * 0.2, b - r * 0.2, n, h=h, w=w, seed=seed + i, name='sand%d' % i)


def sign_board(c, normal, w, h, text_kind='plate', name='sign', post=True):
    """A painted board on two posts (or flat on a wall when post=False); the face is the kit's sign atlas plate."""
    n = V(normal).normalized()
    t = V((-n.y, n.x, 0))
    bm = bmesh.new()
    cc = V(c)
    C.box_bm(bm, tuple(cc), (w, 0.04, h) if abs(n.y) > 0.5 else (0.04, w, h))
    K.part(bm, 'wood_paint', name=name, mat_tint=(0.9, 0.86, 0.74), grime=0.5, bisect=False)
    if post:
        posts([tuple(cc - t * (w / 2 - 0.08))[:2], tuple(cc + t * (w / 2 - 0.08))[:2]], 0, cc.z + h / 2, s=0.08, name=name + '_posts')
    K.decal('stain_blotch', tuple(cc + n * 0.025), tuple(n), w * 0.9, h * 0.8, alpha=0.25)
