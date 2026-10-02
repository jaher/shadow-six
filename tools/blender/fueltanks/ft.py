"""Fuel-tank family helpers (docs/fuel-tanks.md) on top of the SHADOW SIX kit + the desert helpers (dz).
Blender coords: x = long axis, y = north (game -z), z up; 1 unit = 1 m; pivot = footprint centre (no recentre).
Shells: cylinder + 2:1 dished heads with raised seam strips; cribs/saddles fitted to the shell arc; crown fittings
(manhole, filler, flame-arrestor vent, dip hatch); tube railings, caged ladders, gate valves with handwheels, wing
pump, drums, hose coils, stencils (own atlas `fuel_stencils`), snow caps + icicles, petal-burst wrecks."""
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('FT_KIT') or os.path.join(os.path.dirname(HERE), 'kit')
sys.path.insert(0, os.path.join(KIT, 'blender'))
sys.path.insert(0, os.path.join(KIT, 'tools'))
import kit as K                     # noqa: E402  (repo kit first: dz reuses the cached module)
sys.path.append(os.path.join(os.path.dirname(HERE), 'desert', 'scripts'))
import dz                           # noqa: E402
import bmesh                        # noqa: E402
import bpy                          # noqa: E402
from mathutils import Vector as V, Matrix   # noqa: E402
C, KA = dz.C, dz.KA

# ---------------------------------------------------------------- per-theater palettes (sRGB multipliers)
def srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


# paint_metal mean albedo is ~0.79, so tint = target / 0.79 (clamped by dz to <= 1 per channel)
def pm(h, k=1.0):
    return tuple(min(1.0, c / 0.79 * k) for c in srgb(h))


PAL = {
    'cream': pm('#CFC6AE'), 'grey': pm('#4C4F52'), 'oxide': pm('#4a352f'), 'ivory': pm('#D9D3C2'),
    'teal': pm('#56706B'), 'fieldgrey': pm('#5B6152'), 'rustroof': pm('#6A4632'), 'sandsteel': pm('#B49C6E'),
    'blackgrey': pm('#3A3A37'), 'red': pm('#8E2A22'), 'primer': pm('#7A3B28'), 'soot': pm('#2A2724'),
    'dunkelgelb': pm('#9C8B5E'), 'pipe': pm('#B8B6AE'),
}
TIMBER = (0.82, 0.74, 0.62)
TARRED = (0.6, 0.55, 0.5)
CHAR = (0.22, 0.19, 0.17)
BURNT_MAT, BURNT = 'concrete_slab', (0.02, 0.018, 0.017) # matte soot-black (glTF factor is linear; glossy paint reads grey)
BURNT_RUST = (0.085, 0.05, 0.035)


def argv():
    """outdir asset [intact|destroyed] [seed] [snow]"""
    a = dz.argv()
    out, asset = a[0], a[1]
    dest = len(a) > 2 and a[2] == 'destroyed'
    seed = int(a[3]) if len(a) > 3 else 11
    snow = len(a) > 4 and a[4] == 'snow'
    return out, asset, dest, seed, snow


def bmn():
    return bmesh.new()


def P(bm, mid, name, **kw):
    """kit part with sane defaults for steel/timber hardware (no wall bisect, light grime)."""
    kw.setdefault('bisect', False)
    if not bm.verts:
        bm.free()
        return None
    return K.part(bm, mid, name=name, **kw)


def g2b(x, z, y=0.0):
    """game-local (x east, z south, y up) -> Blender (x, y north, z up)."""
    return V((x, -z, y))


def rot2(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


class NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


# ---------------------------------------------------------------- frames along an axis
class Ax:
    """Orthonormal frame for a horizontal or vertical tank: point(s, ang, r) on/around the shell.
    s = distance along the axis from the centre, ang = 0 at the crown (top for horizontal tanks / +x side for vertical)."""

    def __init__(self, c, axis, up=(0, 0, 1)):
        self.c = V(c)
        self.a = V(axis).normalized()
        u = V(up)
        if abs(self.a.dot(u)) > 0.9:
            u = V((1, 0, 0))
        self.v = (u - self.a * self.a.dot(u)).normalized()      # 'crown' direction
        self.w = self.a.cross(self.v).normalized()

    def dir(self, ang):
        return self.v * math.cos(ang) + self.w * math.sin(ang)

    def p(self, s, ang=0.0, r=0.0):
        return self.c + self.a * s + self.dir(ang) * r


# ---------------------------------------------------------------- shells
def head_profile(R, hd, n=7):
    """2:1-ish dished head: (s, r) from the tangent line (s=0, r=R) to the apex (s=hd, r=0); knuckle-dense spacing."""
    out = []
    for i in range(n + 1):
        t = math.sin(i / n * math.pi / 2)            # 0..1, dense near the rim
        s = hd * t
        r = R * math.sqrt(max(0.0, 1 - t * t))
        out.append((s, r))
    return out


def shell_bm(bm, ax, R, Lc, hd, segs=32, courses=4, open_top=None, ragged=0.0, seed=0, drop_head=0):
    """Closed tank shell along ax: cylinder Lc between the tangent lines + dished heads hd deep.
    Returns ring list (for wrecks). open_top=(s0, s1, a0, a1) skips faces inside that window (burst hole)."""
    rings, ss = [], []
    prof = head_profile(R, hd)
    for s, r in reversed(prof):                      # -X head apex -> tangent
        ss.append((-Lc / 2 - s, max(r, 0.0)))
    for k in range(1, courses):
        ss.append((-Lc / 2 + Lc * k / courses, R))
    for s, r in prof:
        ss.append((Lc / 2 + s, max(r, 0.0)))
    for s, r in ss:
        if r < 1e-4:
            rings.append([ax.p(s)])
        else:
            rings.append([ax.p(s, 2 * math.pi * i / segs, r) for i in range(segs)])
    vr = [[bm.verts.new(p) for p in rg] for rg in rings]
    nh = len(prof) - 1
    for ri, (a, b) in enumerate(zip(vr[:-1], vr[1:])):
        if (drop_head < 0 and ri < nh) or (drop_head > 0 and ri >= len(vr) - 1 - nh):
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if open_top:
                sm = (ax.a.dot(a[0].co - ax.c) + ax.a.dot(b[0].co - ax.c)) / 2 if len(a) > 1 and len(b) > 1 else None
                am = 2 * math.pi * (i + 0.5) / segs
                am = am if am <= math.pi else am - 2 * math.pi
                e = _rr(seed, i, ri) * ragged if ragged else 0.0
                if sm is not None and open_top[0] - e < sm < open_top[1] + e and open_top[2] - e / R < am < open_top[3] + e / R:
                    continue
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return ss


def _rr(seed, i, j):
    return random.Random(seed * 7919 + i * 131 + j).random()


def inner_skin(bm_src, t=0.015):
    """Inside face of an open shell (burst wrecks): copy offset inward along the vertex normals, flipped."""
    bm = bm_src.copy()
    bm.normal_update()
    for v in bm.verts:
        v.co -= v.normal * t
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def band_bm(bm, ax, s, R, w=0.04, proud=0.008, segs=32, a0=None, a1=None):
    """Raised seam / hoop strip around the shell at s (full ring, or the arc a0..a1 for a hold-down strap)."""
    r = R + proud
    full = a0 is None
    n = segs if full else max(4, int(segs * (a1 - a0) / (2 * math.pi)) + 1)
    angs = [2 * math.pi * i / segs for i in range(segs)] if full else [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]
    out = []
    for dr, ds in ((0, -w / 2), (proud, -w / 2), (proud, w / 2), (0, w / 2)):
        out.append([ax.p(s + ds, a, R + dr) for a in angs])
    vr = [[bm.verts.new(p) for p in rg] for rg in out]
    m = len(angs)
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(m if full else m - 1):
            j = (i + 1) % m
            bm.faces.new((a[i], a[j], b[j], b[i]))


def long_seam_bm(bm, ax, s0, s1, R, ang, w=0.04, proud=0.008):
    """Longitudinal seam strip at angle ang from s0 to s1."""
    da = w / R / 2
    pts = [ax.p(s0, ang - da, R), ax.p(s0, ang + da, R), ax.p(s1, ang + da, R), ax.p(s1, ang - da, R)]
    d = ax.dir(ang) * proud
    lo = [bm.verts.new(p) for p in pts]
    hi = [bm.verts.new(p + d) for p in pts]
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))


# ---------------------------------------------------------------- crown fittings (vertical stacks on a point)
def stack_bm(bm, base, up, rings, segs=16):
    """Lathe a stack of (h, r) rings along `up` from `base` (e.g. manhole neck + flange + lid)."""
    base, up = V(base), V(up).normalized()
    a = up.orthogonal().normalized()
    b = up.cross(a)
    vr = []
    for h, r in rings:
        if r < 1e-4:
            vr.append([bm.verts.new(base + up * h)])
        else:
            vr.append([bm.verts.new(base + up * h + (a * math.cos(2 * math.pi * i / segs) + b * math.sin(2 * math.pi * i / segs)) * r)
                       for i in range(segs)])
    for p, q in zip(vr[:-1], vr[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            if len(p) == 1:
                bm.faces.new((p[0], q[j], q[i]))
            elif len(q) == 1:
                bm.faces.new((p[i], p[j], q[0]))
            else:
                bm.faces.new((p[i], p[j], q[j], q[i]))
    if len(vr[0]) > 1:
        bm.faces.new(list(reversed(vr[0])))
    if len(vr[-1]) > 1:
        bm.faces.new(vr[-1])


def manhole(bm, bolts, base, up, r=0.3, neck=0.18, nb=12, radial=False):
    """Manhole: neck, bolted flange ring, domed cover with hinge lugs; bolts go to `bolts` (dark steel)."""
    up = V(up).normalized()
    stack_bm(bm, base - up * 0.06, up, [(0, r - 0.02), (neck, r - 0.02), (neck, r + 0.06), (neck + 0.05, r + 0.06),
                                        (neck + 0.06, r + 0.02), (neck + 0.1, r * 0.75), (neck + 0.12, 0.0)], 20)
    a = up.orthogonal().normalized()
    b = up.cross(a)
    top = base + up * (neck + 0.05)
    for i in range(nb):
        t = 2 * math.pi * i / nb
        p = top + (a * math.cos(t) + b * math.sin(t)) * (r + 0.03)
        C.cyl_bm(bolts, p - up * 0.01, p + up * 0.03, 0.018, 6)
    C.box_bm(bolts, tuple(top + a * (r + 0.08) + up * 0.02), (0.08, 0.14, 0.06))
    if radial:                                   # M13 'radial ribbed' cover
        for i in range(8):
            t = 2 * math.pi * i / 8
            d = a * math.cos(t) + b * math.sin(t)
            C.beam_bm(bolts, top + up * 0.06 + d * 0.06, top + up * 0.02 + d * (r - 0.02), 0.025, 0.035, up=tuple(up))
    return top + up * 0.1


def vent(bm, base, up, h=0.7):
    """Vent pipe with finned flame arrestor + mushroom cap."""
    up = V(up).normalized()
    stack_bm(bm, base - up * 0.05, up, [(0, 0.06), (0.06, 0.06), (0.06, 0.09), (0.09, 0.09), (0.09, 0.04),
                                        (h - 0.3, 0.04), (h - 0.3, 0.08), (h - 0.08, 0.08), (h - 0.08, 0.04), (h - 0.04, 0.04),
                                        (h - 0.04, 0.14), (h, 0.12), (h + 0.05, 0.0)], 12)
    for k in range(4):                           # arrestor fins
        stack_bm(bm, base + up * (h - 0.27 + k * 0.05), up, [(0, 0.11), (0.015, 0.11)], 12)
    return base + up * (h + 0.05)


def filler(bm, base, up):
    up = V(up).normalized()
    stack_bm(bm, base - up * 0.04, up, [(0, 0.1), (0.14, 0.1), (0.14, 0.13), (0.18, 0.13), (0.2, 0.08), (0.21, 0.0)], 12)


def dip_hatch(bm, base, up):
    up = V(up).normalized()
    stack_bm(bm, base - up * 0.04, up, [(0, 0.075), (0.1, 0.075), (0.1, 0.1), (0.13, 0.1), (0.14, 0.0)], 10)


def handwheel(bm, c, n, r=0.125, t=0.016, spokes=4):
    """Valve handwheel in the plane normal to n (rim torus approximated by a 12-gon of beams + spokes + hub)."""
    c, n = V(c), V(n).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    pts = [c + (a * math.cos(2 * math.pi * i / 12) + b * math.sin(2 * math.pi * i / 12)) * r for i in range(12)]
    for i in range(12):
        C.beam_bm(bm, pts[i], pts[(i + 1) % 12], t * 1.6, t * 1.6, up=tuple(n))
    for k in range(spokes):
        C.beam_bm(bm, c, pts[k * 12 // spokes], t, t, up=tuple(n))
    C.cyl_bm(bm, c - n * 0.03, c + n * 0.03, 0.025, 8)


def gate_valve(body, wheel, c, axis, wheel_up=(0, 0, 1), r_pipe=0.08):
    """Flanged gate valve body on a pipe axis with a bonnet + handwheel above. Returns the wheel centre."""
    c, ax, up = V(c), V(axis).normalized(), V(wheel_up).normalized()
    C.cyl_bm(body, c - ax * 0.16, c + ax * 0.16, r_pipe * 1.35, 12)
    for s in (-1, 1):
        C.cyl_bm(body, c + ax * s * 0.16, c + ax * s * 0.2, r_pipe * 1.9, 12)
    C.cyl_bm(body, c, c + up * (r_pipe * 2.6), r_pipe * 0.9, 10)
    C.cyl_bm(body, c + up * r_pipe * 2.6, c + up * (r_pipe * 2.6 + 0.12), 0.02, 6)
    wc = c + up * (r_pipe * 2.6 + 0.12)
    handwheel(wheel, wc, up, r=max(0.1, r_pipe * 1.6))
    return wc


# ---------------------------------------------------------------- access: rails, ladders, decks
def tube(bm, p0, p1, r=0.022, segs=6):
    C.cyl_bm(bm, V(p0), V(p1), r, segs)


def railing(bm, pts, z0, h=1.0, step=1.0, r=0.022, knee=True, post_r=None, toe=None):
    """Tube handrail along a polyline (Blender xy at deck level z0): stanchions every `step`, top + knee rail.
    toe=(bm, h) adds a flat toe board."""
    post_r = post_r or r
    pts = [V((p[0], p[1], z0)) for p in pts]
    for a, b in zip(pts[:-1], pts[1:]):
        L = (b - a).length
        n = max(1, int(round(L / step)))
        for k in range(n + 1):
            if k == 0 and a is not pts[0]:
                continue
            q = a + (b - a) * (k / n)
            tube(bm, q, q + V((0, 0, h)), post_r)
        tube(bm, a + V((0, 0, h)), b + V((0, 0, h)), r)
        if knee:
            tube(bm, a + V((0, 0, h * 0.5)), b + V((0, 0, h * 0.5)), r * 0.85)
        if toe:
            tb, th = toe
            d = (b - a).normalized()
            C.beam_bm(tb, a + V((0, 0, th / 2)), b + V((0, 0, th / 2)), 0.008, th)


def ladder(bm, base, top_z, out, w=0.45, rung=0.30, r=0.02, cage_from=None, cage=None, over=1.0, hr=0.38):
    """Vertical rung ladder: base (x, y, z0) on the ground, `out` = horizontal unit vector away from the wall.
    Stringers rise `over` m past the top (grab rails curving over). cage_from: hoops from that height (into `cage`)."""
    base, out = V(base), V(out).normalized()
    side = V((0, 0, 1)).cross(out).normalized()
    z0 = base.z
    for s in (-1, 1):
        p = base + side * s * w / 2
        C.beam_bm(bm, p, V((p.x, p.y, top_z + over)), 0.06, 0.012, up=tuple(out))
        C.beam_bm(bm, V((p.x, p.y, top_z + over)), V((p.x, p.y, top_z + over)) - out * 0.35 + V((0, 0, 0.05)), 0.05, 0.012)
    n = int((top_z - z0) / rung)
    for k in range(1, n + 1):
        z = z0 + k * rung
        tube(bm, base - side * w / 2 + V((0, 0, z - z0)), base + side * w / 2 + V((0, 0, z - z0)), r, 6)
    if cage_from is not None and cage is not None:
        cc = base + out * hr
        z = z0 + cage_from
        hoops = []
        while z <= top_z + over - 0.05:
            ring = [cc + V((0, 0, z - z0)) + (out * math.cos(t) + side * math.sin(t)) * hr
                    for t in [math.pi * (-0.5 + i / 8) for i in range(9)]]
            ring = [base + side * (-w / 2) + V((0, 0, z - z0))] + ring[1:-1] + [base + side * (w / 2) + V((0, 0, z - z0))]
            for a, b in zip(ring[:-1], ring[1:]):
                C.beam_bm(cage, a, b, 0.05, 0.008, up=(0, 0, 1))
            hoops.append(ring)
            z += 0.9
        if len(hoops) > 1:
            for i in (1, 3, 5, 7):
                for h0, h1 in zip(hoops[:-1], hoops[1:]):
                    C.beam_bm(cage, h0[i], h1[i], 0.04, 0.008, up=tuple(out))


def plank_deck(bm, x0, x1, y0, y1, z, t=0.05, gap=0.012, along='x', seed=0):
    """Plank walkway between (x0, y0) and (x1, y1) at top z; planks run across the walk direction."""
    r = random.Random(seed)
    if along == 'x':
        n = max(1, int((x1 - x0) / 0.2))
        w = (x1 - x0) / n
        for k in range(n):
            x = x0 + (k + 0.5) * w
            C.box_bm(bm, (x, (y0 + y1) / 2, z - t / 2 - r.uniform(0, 0.006)), (w - gap, y1 - y0 + r.uniform(-0.02, 0.02), t))
    else:
        n = max(1, int((y1 - y0) / 0.2))
        w = (y1 - y0) / n
        for k in range(n):
            y = y0 + (k + 0.5) * w
            C.box_bm(bm, ((x0 + x1) / 2, y, z - t / 2 - r.uniform(0, 0.006)), (x1 - x0 + r.uniform(-0.02, 0.02), w - gap, t))


# ---------------------------------------------------------------- supports
def arc_block(bm, x0, x1, cy, cz, R, half_w, z0, clear=0.004, yc=None):
    """Saddle / bolster block spanning x0..x1 (along the tank axis = Blender x), |y - yc| <= half_w (yc defaults to
    the shell axis cy), from z0 up to the shell underside (arc of radius R about (cy, cz)): rests on it, never crosses."""
    yc = cy if yc is None else yc
    n = 10
    ys = [yc - half_w + 2 * half_w * i / n for i in range(n + 1)]
    def top(y):
        d = abs(y - cy)
        return cz - math.sqrt(max(0.0, R * R - d * d)) - clear if d < R else cz
    sec = [(y, top(y)) for y in ys]
    pts = [(yc + half_w, z0), (yc - half_w, z0)] + sec
    a = [bm.verts.new((x0, y, z)) for y, z in pts]
    b = [bm.verts.new((x1, y, z)) for y, z in pts]
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    m = len(pts)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ---------------------------------------------------------------- stencils, signs, decals
import json as _json
_ST = _json.load(open(os.path.join(HERE, 'fuel_stencils.json')))
WHITE_ST, BLACK_ST = (0.95, 0.93, 0.88), (0.09, 0.085, 0.08)


def stencil(word, ax, R, s0, ang0, h, mode='along', tint=WHITE_ST, alpha=0.9, off=0.014, flip=False, name=None):
    """Stencil word wrapped on a cylinder of radius R (frame ax): mode 'along' = text runs along the axis
    (horizontal tanks), 'around' = around the circumference (vertical tanks). (s0, ang0) = text centre."""
    rc = _ST[word]
    w = h * (rc[2] - rc[0]) / (rc[3] - rc[1])
    nu, nv = (2, 4) if mode == 'along' else (max(2, int(w / 0.25)), 2)
    sgn = -1 if flip else 1
    def pt(u, v):
        if mode == 'along':                 # texture-up must point to the crown on either side of the shell
            return ax.p(s0 + sgn * u, ang0 + (-1 if ang0 >= 0 else 1) * v / R, R + off)
        return ax.p(s0 + v, ang0 + sgn * u / (R + off), R + off)
    bm = bmn()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = [[bm.verts.new(pt(-w / 2 + w * i / (nu - 1), -h / 2 + h * j / (nv - 1))) for j in range(nv)] for i in range(nu)]
    for i in range(nu - 1):
        for j in range(nv - 1):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for lp, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uvl].uv = (rc[0] + (rc[2] - rc[0]) * a / (nu - 1), rc[1] + (rc[3] - rc[1]) * b / (nv - 1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:                      # face outward
        if f.normal.dot(f.calc_center_median() - ax.p(ax.a.dot(f.calc_center_median() - ax.c))) < 0:
            f.normal_flip()
    return K.part(bm, 'fuel_stencils', name=name or 'st_' + word, uv='keep', grime=0, node='decals', bisect=False,
                  jitter=0.0, alpha=alpha, mat_tint=tint)


def flat_stencil(word, center, normal, h, up=(0, 0, 1), tint=WHITE_ST, alpha=0.9, name=None):
    """Stencil / sign face on a flat surface (dished-head centre, board, deck end)."""
    rc = _ST[word]
    w = h * (rc[2] - rc[0]) / (rc[3] - rc[1])
    n = V(normal).normalized()
    r = V(up).cross(n).normalized()
    u = n.cross(r).normalized()
    c = V(center) + n * 0.006
    bm = bmn()
    f = bm.faces.new([bm.verts.new(p) for p in (c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2,
                                                c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2)])
    C.uv_rect(bm, f, rc)
    return K.part(bm, 'fuel_stencils', name=name or 'st_' + word, uv='keep', grime=0, node='decals', bisect=False,
                  jitter=0.0, alpha=alpha, mat_tint=tint)


def sign_board(center, normal, w, kind='sign_rauchen_verboten', post_h=None, board_bm=None):
    """Warning board (atlas sign face on a timber board); post_h adds a post down to the ground."""
    c, n = V(center), V(normal).normalized()
    r = V((0, 0, 1)).cross(n).normalized()
    h = w / 4
    bb = board_bm or bmn()
    C.box_bm(bb, tuple(c - n * 0.02), (w + 0.06, 0.03, h + 0.06), math.atan2(r.y, r.x))
    if post_h:
        C.box_bm(bb, (c.x - n.x * 0.06, c.y - n.y * 0.06, (c.z - h / 2) / 2 + 0.02), (0.08, 0.08, c.z - h / 2 + 0.04 + h), 0)
    if board_bm is None:
        P(bb, 'timber_grey', 'signboard', uv='beam', axis=tuple(r))
    flat_stencil(kind, c, n, h, alpha=1.0, tint=(1, 1, 1), name=kind)


def decal(kind, center, normal, w, h, up=(0, 0, 1), alpha=0.75):
    """Weathering decal (kit atlas or the desert atlas via dz.decal)."""
    return dz.decal(kind, tuple(center), tuple(normal), w, h, up=tuple(up), alpha=alpha)


def wrap_decal(kind, ax, R, s, ang, w, h, alpha=0.6, atlas='decals', off=0.012, nv=4, vert=False):
    """Atlas decal wrapped on a horizontal shell: w along the axis, h as arc length around it, centred at (s, ang)."""
    import dz2
    if atlas == 'decals' and kind not in K.rects()['decals'] and kind in dz2._DZR:
        atlas = 'decals_dz'                          # soft organic cells (soot_a/b, rust_run, grime_a/b ...)
    rc = inset((K.rects()['decals'] if atlas == 'decals' else dz2._DZR).get(kind, [0, 0, 0.25, 0.25]))
    bm = bmn()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [[bm.verts.new(ax.p(s + du, ang + (j / (nv - 1) - 0.5) * h / R, R + off)) for j in range(nv)] for du in (-w / 2, w / 2)]
    for j in range(nv - 1):
        f = bm.faces.new((vs[0][j], vs[1][j], vs[1][j + 1], vs[0][j + 1]))
        for lp, (i, jj) in zip(f.loops, ((0, j), (1, j), (1, j + 1), (0, j + 1))):
            if vert:                                 # texture-up along the axis (runs down a vertical tank)
                lp[uvl].uv = (rc[0] + (rc[2] - rc[0]) * jj / (nv - 1), rc[1] + (rc[3] - rc[1]) * i)
            else:
                lp[uvl].uv = (rc[0] + (rc[2] - rc[0]) * i, rc[1] + (rc[3] - rc[1]) * jj / (nv - 1))
    for f in bm.faces:
        cm = f.calc_center_median()
        if f.normal.dot(cm - ax.p(ax.a.dot(cm - ax.c))) < 0:
            f.normal_flip()
    return K.part(bm, atlas, name='wd_' + kind, uv='keep', grime=0, node='decals', bisect=False, jitter=0.0, alpha=alpha)


def shell_streaks(ax, R, s_list, ang=0.9, n_per=1, length=1.0, kind='streak_rust', alpha=0.6, seed=0):
    """Rust / grime runs wrapped down the shell side from fittings at s (ang = start angle from the crown)."""
    r = random.Random(seed)
    for s in s_list:
        for side in (1, -1):
            a0 = side * (ang + r.uniform(-0.15, 0.15))
            w = r.uniform(0.25, 0.45)
            bm = bmn()
            uvl = bm.loops.layers.uv.new('UVMap')
            rc = inset(K.rects()['decals'].get(kind, [0, 0, 0.25, 0.25]))
            nv = 4
            span = length / R
            vs = [[bm.verts.new(ax.p(s + du, a0 + side * span * j / (nv - 1), R + 0.011)) for j in range(nv)] for du in (-w / 2, w / 2)]
            for j in range(nv - 1):
                f = bm.faces.new((vs[0][j], vs[1][j], vs[1][j + 1], vs[0][j + 1]))
                for lp, (i, jj) in zip(f.loops, ((0, j), (1, j), (1, j + 1), (0, j + 1))):
                    lp[uvl].uv = (rc[0] + (rc[2] - rc[0]) * i, rc[3] - (rc[3] - rc[1]) * jj / (nv - 1))
            for f in bm.faces:
                cm = f.calc_center_median()
                if f.normal.dot(cm - ax.p(ax.a.dot(cm - ax.c))) < 0:
                    f.normal_flip()
            K.part(bm, 'decals', name='streak', uv='keep', grime=0, node='decals', bisect=False, jitter=0.0, alpha=alpha)


# ---------------------------------------------------------------- dressing
DRUM_COL = {'snow': [(0.36, 0.38, 0.36), (0.5, 0.2, 0.15), (0.3, 0.32, 0.28)],
            'desert': [(0.62, 0.55, 0.4), (0.5, 0.2, 0.15), (0.42, 0.4, 0.3)],
            'coast': [(0.3, 0.33, 0.33), (0.5, 0.2, 0.15), (0.14, 0.14, 0.14)],
            'temperate': [(0.36, 0.38, 0.3), (0.5, 0.2, 0.15), (0.14, 0.14, 0.14)]}


def drums(spots, theater, name='drums', burst=False, seed=0):
    """200 l drums: spots = [(x, y, z, lying, axis_angle)]. Rolling hoops + bungs; burst=True -> torn drums."""
    r = random.Random(seed)
    cols = DRUM_COL.get(theater, DRUM_COL['temperate'])
    bms = [bmn() for _ in cols]
    bb = bmn()
    for k, (x, y, z, lying, a) in enumerate(spots):
        ax = (math.cos(a), math.sin(a), 0)
        if burst and r.random() < 0.6:
            dz.burst_drum_bm(bb, (x, y, z), seed=seed + k, lying=lying, axis=ax)
            continue
        bm = bms[r.randrange(len(cols))] if not burst else bms[0]
        dz.drum(bm, (x, y, z), lying=lying, axis=ax)
        if not lying:
            for dx in (-0.16, 0.14):
                C.cyl_bm(bm, (x + dx, y + 0.1, z + 0.88), (x + dx, y + 0.1, z + 0.905), 0.03, 6)
    for i, bm in enumerate(bms):
        P(bm, 'paint_metal', '%s%d' % (name, i), smooth=True, mat_tint=cols[i] if not burst else CHAR, grime=0.6)
    P(bb, 'corrugated_rust', name + '_burst', mat_tint=(0.4, 0.33, 0.3), grime=0.5)


def hose_coil(bm, c, r=0.32, turns=3, rr=0.03):
    """Flat hose coil hung on a hook or lying (c = coil centre, axis z)."""
    c = V(c)
    pts = []
    for i in range(turns * 10 + 1):
        t = 2 * math.pi * i / 10
        rad = r - 0.035 * i / 10
        pts.append(c + V((math.cos(t) * rad, math.sin(t) * rad, 0.02 * (i % 2))))
    for a, b in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, a, b, rr, 6, caps=False)


def hose_run(bm, pts, rr=0.035):
    pts = [V(p) for p in pts]
    for a, b in zip(pts[:-1], pts[1:]):
        C.cyl_bm(bm, a, b, rr, 6, caps=False)


def wing_pump(iron, wood, base, facing=0.0):
    """Semi-rotary hand wing pump on a plank board: body drum, lever handle, inlet/outlet stubs."""
    b = V(base)
    C.box_bm(wood, (b.x, b.y, b.z + 0.03), (0.7, 0.45, 0.06), facing)
    c = b + V((0, 0, 0.36))
    d = V((math.cos(facing), math.sin(facing), 0))
    C.cyl_bm(iron, c - d.cross(V((0, 0, 1))) * 0.08, c + d.cross(V((0, 0, 1))) * 0.08, 0.15, 14)
    C.box_bm(iron, (b.x, b.y, b.z + 0.13), (0.3, 0.2, 0.14), facing)
    C.beam_bm(iron, c, c + V((0, 0, 0.55)) + d * 0.15, 0.03, 0.03)
    C.cyl_bm(iron, c + V((0, 0, 0.55)) + d * 0.15, c + V((0, 0, 0.55)) + d * 0.35, 0.02, 6)
    C.cyl_bm(iron, c - d * 0.14, c - d * 0.3 - V((0, 0, 0.3)), 0.035, 8)
    C.cyl_bm(iron, c + d * 0.14, c + d * 0.3, 0.035, 8)


def bucket(bm, c):
    C.cyl_bm(bm, V(c), V(c) + V((0, 0, 0.28)), 0.12, 10, r1=0.15)


# ---------------------------------------------------------------- snow (Norway)
def snow_cap_shell(ax, R, s0, s1, half_ang=0.9, thick=0.12, segs=20, skip=None, seed=0, rim_tint=None):
    """Snow lying on the upper arc of a horizontal shell from s0..s1 (skip = (s, half_w) gaps where fittings / catwalk
    brackets break it). A drape that follows the shell curvature: thickest at the crown, a smooth (not per-vertex
    random) surface, and a FEATHERED, wavy rim: each side's edge angle wanders along the axis (low-frequency sines,
    with tongues sliding further down), the last 25 % of the arc thins to a film hugging the paint, and the span ends
    taper the same way, so no straight cut edge or white sheet outline shows at zoom 2. rim_tint (the paint colour,
    linear) blends the thin rim film toward the shell so the white fades out instead of ending on a line."""
    r = random.Random(seed)
    ph = [r.uniform(0, 6.3) for _ in range(6)]
    rimw = {}
    bm = bmn()
    spans = [(s0, s1)]
    for (sc, hw) in (skip or []):
        nxt = []
        for a, b in spans:
            if sc + hw <= a or sc - hw >= b:
                nxt.append((a, b))
                continue
            if sc - hw > a:
                nxt.append((a, sc - hw))
            if sc + hw < b:
                nxt.append((sc + hw, b))
        spans = nxt

    def edge(s, side):                              # wandering rim angle on one side (fraction of half_ang)
        o = 0 if side < 0 else 3
        return (0.78 + 0.12 * math.sin(s * 1.9 + ph[o]) + 0.07 * math.sin(s * 4.3 + ph[o + 1])
                + 0.05 * math.sin(s * 9.1 + ph[o + 2]))

    def bump(s, t):                                 # gentle smooth surface undulation (wind-packed)
        return 1.0 + 0.08 * math.sin(s * 2.7 + t * 3.1 + ph[0]) + 0.05 * math.sin(s * 6.3 - t * 5.0 + ph[4])

    for a, b in spans:
        if b - a < 0.2:
            continue
        ns = max(3, int((b - a) / 0.2) + 1)
        rows = []
        for i in range(ns):
            s = a + (b - a) * i / (ns - 1)
            endf = min(1.0, (s - a) / 0.35, (b - s) / 0.35)
            endf = endf * endf * (3 - 2 * endf)     # smoothstep taper at the span ends
            lo, hi = -half_ang * edge(s, -1) * (0.6 + 0.4 * endf), half_ang * edge(s, 1) * (0.6 + 0.4 * endf)
            row = []
            for j in range(segs + 1):
                t = lo + (hi - lo) * j / segs
                e = (t / hi) if t >= 0 else (t / lo)            # 0 at the crown .. 1 at the rim
                k = max(0.0, math.cos(min(1.0, e) * math.pi / 2)) ** 1.6
                h = thick * k * endf * bump(s, t)
                v = bm.verts.new(ax.p(s, t, R + 0.003 + h))
                rimw[v.co.to_tuple(5)] = max(max(0.0, (min(1.0, e) - 0.55) / 0.45), 1.0 - endf)
                row.append(v)
            rows.append(row)
        for p, q in zip(rows[:-1], rows[1:]):
            for j in range(segs):
                bm.faces.new((p[j], p[j + 1], q[j + 1], q[j]))
    for f in bm.faces:
        cm = f.calc_center_median()
        if f.normal.dot(cm - ax.p(ax.a.dot(cm - ax.c))) < 0:
            f.normal_flip()
    o = P(bm, 'snow', 'snowcap', smooth=True, grime=0, jitter=0.0, lod='keep')
    if o and rim_tint:
        col = o.data.color_attributes.get('Col')
        me = o.data
        for poly in me.polygons:
            for li in poly.loop_indices:
                w = rimw.get(me.vertices[me.loops[li].vertex_index].co.to_tuple(5), 0.0)
                w = w * w * (3 - 2 * w)
                c = col.data[li].color
                col.data[li].color = tuple(c[i] * (1 - w) + rim_tint[i] * c[i] * w if i < 3 else c[i] for i in range(4))
    return o


def icicles(bm, p0, p1, n=6, seed=0, lmax=0.3):
    r = random.Random(seed)
    p0, p1 = V(p0), V(p1)
    for i in range(n):
        p = p0 + (p1 - p0) * ((i + r.uniform(0.2, 0.8)) / n)
        C.cyl_bm(bm, p, p - V((0, 0, r.uniform(0.08, lmax))), r.uniform(0.012, 0.025), 5, r1=0.002)


# ---------------------------------------------------------------- destruction
def petals(bm, ax, R, sc, ac, ls, la, n=9, curl=0.9, seed=0):
    """Plates peeled outward around a burst hole centred at (sc, ac) on the shell (ls x la = hole length along the
    axis x arc length). Each petal is a 3-row two-sided strip rooted on the hole rim, curling out and down."""
    r = random.Random(seed)
    for k in range(n):
        t0 = 2 * math.pi * k / n + r.uniform(-0.1, 0.1)
        t1 = t0 + 2 * math.pi / n * r.uniform(0.7, 0.95)
        def rim(t):
            return sc + math.cos(t) * ls / 2, ac + math.sin(t) * la / 2 / R
        (s0, a0), (s1, a1) = rim(t0), rim(t1)
        tm = (t0 + t1) / 2
        L = r.uniform(0.5, 1.1)
        rows = []
        for j in range(4):
            f = j / 3
            sm, am = rim(tm)
            out_s, out_a = math.cos(tm), math.sin(tm)
            width = (1 - f * 0.85)
            pa = []
            for (ss, aa) in ((s0, a0), (s1, a1)):
                s = sm + (ss - sm) * width + out_s * L * f * 0.6
                a = am + (aa - am) * width + out_a * L * f * 0.4 / R
                rad = R + math.sin(f * curl * 1.4) * L * 0.8
                pa.append(ax.p(s, a, rad))
            rows.append(pa)
        two_sided(bm, rows, 0.012)


def two_sided(bm, rows, t=0.012):
    """Strip of point rows as a thin two-sided plate (back face offset by t along the local normal)."""
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    fr = []
    for p, q in zip(vs[:-1], vs[1:]):
        fr.append(bm.faces.new((p[0], p[1], q[1], q[0])))
    bm.normal_update()
    nb = {}
    for f in fr:
        for v in f.verts:
            nb.setdefault(v, V((0, 0, 0)))
            nb[v] += f.normal
    bk = [[bm.verts.new(v.co - nb[v].normalized() * t) for v in row] for row in vs]
    for p, q in zip(bk[:-1], bk[1:]):
        bm.faces.new((q[0], q[1], p[1], p[0]))


def dish(bm, c, axis, R, hd, segs=24):
    """Loose dished head (blown off): open shell cap, two-sided, rim ring."""
    ax = Ax(c, axis)
    prof = head_profile(R, hd, 5)
    rings = [[ax.p(s, 2 * math.pi * i / segs, r) for i in range(segs)] if r > 1e-4 else [ax.p(s)] for s, r in prof]
    vr = [[bm.verts.new(p) for p in rg] for rg in rings]
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            if len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bk = [[bm.verts.new(v.co - ax.a * 0.012) for v in rg] for rg in vr]
    for a, b in zip(bk[:-1], bk[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            if len(b) == 1:
                bm.faces.new((b[0], a[j], a[i]))
            else:
                bm.faces.new((b[i], b[j], a[j], a[i]))


def scorch(c, w, h, alpha=0.8, seed=0, z=0.012):
    """Ground scorch: big soft scorch + oil-burn blotches (desert atlas cells via dz.decal)."""
    r = random.Random(seed)
    c = V(c)
    dz.decal('scorch_b', (c.x, c.y, z), (0, 0, 1), w, h, up=(0, 1, 0), alpha=alpha)   # w along x
    for k in range(4):
        m = min(w, h)                                      # blotches stay inside the scorch (w x h)
        dz.decal('oil_stain', (c.x + r.uniform(-w / 3, w / 3), c.y + r.uniform(-h / 6, h / 6), z + 0.004 + 0.001 * k), (0, 0, 1),
                 r.uniform(0.4, 0.6) * m, r.uniform(0.35, 0.5) * m, up=(0, 1, 0), alpha=0.7)


def _bake_without_decals():
    """The kit AO bake traces every object in the scene: decal / stencil quads 1 cm above a shell occlude it and bake
    hard dark rectangles into the shell AO (they read as grey boxes in game). Hide the decal node while baking."""
    import kit_export as KE
    if getattr(KE.bake_ao, '_ft', False):
        return
    orig = KE.bake_ao

    def bake(objs, *a, **kw):
        dec = [o for o in C.A.parts if o.name in bpy.data.objects and o.get('kit_node', 'main') == 'decals']
        for o in dec:
            o.hide_render = True
        try:
            return orig(objs, *a, **kw)
        finally:
            for o in dec:
                o.hide_render = False
    bake._ft = True
    KE.bake_ao = bake


def inset(rc, k=0.025):
    """Atlas cell rect shrunk by k of its size on each side (no bilinear / mip bleed from the neighbour cells)."""
    du, dv = (rc[2] - rc[0]) * k, (rc[3] - rc[1]) * k
    return [rc[0] + du, rc[1] + dv, rc[2] - du, rc[3] - dv]


def report_bounds(W, D, H, tol=0.3, r_round=None):
    """Log every part that leaves the gameplay footprint (+ tol dressing) or rises above H (docs/fuel-tanks.md §4)."""
    for o in C.A.parts:
        if o.name not in bpy.data.objects or o.type != 'MESH' or not len(o.data.vertices):
            continue
        xs = [abs(v.co.x) for v in o.data.vertices]
        ys = [abs(v.co.y) for v in o.data.vertices]
        zs = [v.co.z for v in o.data.vertices]
        if r_round:
            rr = max(math.hypot(v.co.x, v.co.y) for v in o.data.vertices)
            bad = rr > r_round + tol or max(zs) > H + 0.01
            msg = 'r %.2f' % rr
        else:
            bad = max(xs) > W / 2 + tol or max(ys) > D / 2 + tol or max(zs) > H + 0.01
            msg = 'hx %.2f hy %.2f' % (max(xs), max(ys))
        if bad:
            print('BOUNDS %s: %s top %.2f (limit %.2f x %.2f x %.2f)' % (o.name, msg, max(zs), W, D, H))


def report_overlaps(group_a, group_b):
    """Log interpenetrations (BVH triangle overlaps) between parts whose names start with any of group_a and any of
    group_b (OVERLAP lines in the build log): wreck self-clipping checks (deck vs tanks, debris vs plinth ...)."""
    from mathutils.bvhtree import BVHTree
    def pick(prefixes):
        return [o for o in C.A.parts if o.name in bpy.data.objects and o.type == 'MESH' and len(o.data.polygons)
                and o.name.split('.')[0] in prefixes]
    A, Bs = pick(group_a), pick(group_b)
    trees = {}
    def tree(o):
        if o.name not in trees:
            trees[o.name] = BVHTree.FromPolygons([o.matrix_world @ v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons])
        return trees[o.name]
    n = 0
    for a in A:
        for b in Bs:
            if a is b:
                continue
            k = len(tree(a).overlap(tree(b)))
            if k:
                n += 1
                print('OVERLAP %s x %s: %d tri pairs' % (a.name, b.name, k))
    print('OVERLAP check %s x %s: %d clashing pairs' % (','.join(group_a), ','.join(group_b), n))
    return n


def finalize(out, theater, ao=1024, samples=40, bounds=None, overlaps=()):
    """No recentre (the pivot is the gameplay footprint centre). LOD1 ~40 %, LOD2 ~12 %.
    bounds = (W, D, H[, r]) logs parts outside the footprint (BOUNDS lines in the build log)."""
    if bounds:
        report_bounds(*bounds[:3], r_round=bounds[3] if len(bounds) > 3 else None)
    for ga, gb in overlaps:
        report_overlaps(ga, gb)
    _bake_without_decals()
    return dz.finalize(out, tone=1.0 if theater == 'desert' else 0.0, soften=False, ao_res=ao, ao_samples=samples,
                       lods=((0.42, 0.22, 4.0), (0.16, 0.7, 10.0)), recenter=False)


def drift_bm(bm, p0, p1, n, h=0.3, w=0.9, seed=0):
    """Wind drift wedge against a wall foot (snow or sand), from dz.sand_drift but into a caller bmesh."""
    from mathutils import noise
    p0, p1, n = V((*p0[:2], 0)), V((*p1[:2], 0)), V((*n[:2], 0)).normalized()
    L = (p1 - p0).length
    ns = max(4, int(L / 1.2))
    rings = []
    for i in range(ns + 1):
        u = i / ns
        taper = math.sin(math.pi * u) ** 0.7
        k = (0.6 + 0.8 * max(0.0, noise.noise(V((u * L * 0.9 + seed, seed * 1.3, 0))) + 0.3)) * taper
        c = p0.lerp(p1, u)
        hh, ww = h * max(0.02, k), w * max(0.3, k)
        prof = [(0.0, -0.03), (0.0, hh), (ww * 0.15, hh * 0.8), (ww * 0.4, hh * 0.42), (ww * 0.7, hh * 0.14), (ww, -0.03)]
        rings.append([c + n * a + V((0, 0, z)) for a, z in prof])
    fs = C.loft_bm(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=fs)


def xform_new(bm, before, M):
    """Apply matrix M to the verts added to bm since `before` (= len(bm.verts) taken earlier)."""
    bm.verts.ensure_lookup_table()
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts[before:])


def rot_about(p, ang, axis='Z'):
    p = V(p)
    return Matrix.Translation(p) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-p)


def ibeam(bm, p0, p1, h=0.2, b=0.16, tf=0.014, tw=0.009, up=(0, 0, 1)):
    """Steel I-section between p0 and p1 (two flanges + web); `up` = web direction."""
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0).normalized()
    u = V(up)
    u = (u - d * d.dot(u)).normalized()
    for s in (-1, 1):
        C.beam_bm(bm, p0 + u * s * (h / 2 - tf / 2), p1 + u * s * (h / 2 - tf / 2), b, tf, up=tuple(u))
    C.beam_bm(bm, p0, p1, tw, h - 2 * tf, up=tuple(u))


def flatbar(bm, p0, p1, w=0.06, t=0.01, normal=(0, 1, 0)):
    p0, p1 = V(p0), V(p1)
    d = (p1 - p0).normalized()
    n = V(normal)
    up = d.cross(n).normalized()
    C.beam_bm(bm, p0, p1, t, w, up=tuple(up))
