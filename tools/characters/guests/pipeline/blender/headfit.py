# headfit.py - HEADGEAR FIT core: skull measurement, radial construction, clearance push-out, eye-visibility check.
# Guarantee: the lowest front edge of any headgear sits >= brow line + gap, and rays from both eyes (forward,
# elevations 0..10 deg, yaw -25..25 deg) never hit the headgear. Violations are auto-corrected by lifting.
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from common import *
import geo


class HeadFit:
    def __init__(self, ctx, parts):
        self.ctx, self.m = ctx, ctx.m
        m = self.m
        V = ctx.human.data.vertices
        vis = ctx.visible
        pts = [V[i].co.copy() for i in vis if ctx.dom[i] in ('head', 'neck_01') and V[i].co.z > m['neck_base_z']]
        hair = parts.get('hair')
        if hair:
            pts += [v.co.copy() for v in hair.data.vertices]
        self.pts = pts
        self.yc = m['skull_center'][1]
        self.brow = m['brow_top_z']
        self.eye_top = m['eye_top_z']
        self.crown = m['crown_z']
        self.ear_top = m.get('ear_top_z', self.brow - 0.01)
        self.ear_bot = m.get('ear_bot_z', self.brow - 0.06)
        self.nape = m['nape_z']
        # polar table: bins of 10 deg x 1 cm -> max radius
        self.tab = {}
        for p in pts:
            th = math.degrees(math.atan2(p.x, -(p.y - self.yc)))    # 0 = front (-y), +90 = left (+x)
            r = math.hypot(p.x, p.y - self.yc)
            k = (int(round(th / 10)) % 36, int(round(p.z / 0.01)))
            self.tab[k] = max(self.tab.get(k, 0.0), r)
        # head surface BVH (skin + hair) for push-out
        bm = bmesh.new()
        me = ctx.human.data
        b2 = bmesh.new(); b2.from_mesh(me)
        b2.verts.ensure_lookup_table()
        keep = set(i for i in vis if ctx.dom[i] in ('head', 'neck_01'))
        bmesh.ops.delete(b2, geom=[f for f in b2.faces if not all(v.index in keep for v in f.verts)], context='FACES_ONLY')
        self.tree = BVHTree.FromBMesh(b2)
        b2.free(); bm.free()
        self.hair_tree = geo.bvh_of([hair]) if hair else None

    def req(self, th_deg, z, win_th=1, win_z=1):
        """max skull(+ears,+hair) radius around angle th (deg, 0=front) and height z"""
        k0, z0 = int(round(th_deg / 10)), int(round(z / 0.01))
        r = 0.0
        for dk in range(-win_th, win_th + 1):
            for dz in range(-win_z, win_z + 1):
                r = max(r, self.tab.get(((k0 + dk) % 36, z0 + dz), 0.0))
        return r

    def req_max(self, th_deg, z0, z1):
        r = 0.0
        z = z0
        while z <= z1:
            r = max(r, self.req(th_deg, z))
            z += 0.01
        return r

    def pt(self, th_deg, r, z, cx=0.0, cy=None):
        a = math.radians(th_deg)
        return Vector((cx + math.sin(a) * r, (self.yc if cy is None else cy) - math.cos(a) * r, z))


def blend(a, b, t):
    t = max(0.0, min(1.0, t))
    t = t * t * (3 - 2 * t)
    return a + (b - a) * t


def rim_profile(fit, front, side, back, a_front=30, a_side=80):
    """smooth rim height as a function of |theta|: front plateau, drop behind the temple, side->back."""
    def z(th):
        a = abs(((th + 180) % 360) - 180)
        if a <= a_front:
            return front
        if a <= a_side:
            return blend(front, side, (a - a_front) / (a_side - a_front))
        return blend(side, back, (a - a_side) / (180 - a_side))
    return z


def rows_mesh(bm, rows, segs, close_top=True):
    """rows: list of lists (len segs) of Vector, top->bottom. The first row may be a single pole point."""
    R = []
    for row in rows:
        if isinstance(row, Vector):
            R.append([bm.verts.new(row)])
        else:
            R.append([bm.verts.new(p) for p in row])
    for i in range(len(R) - 1):
        a, b = R[i], R[i + 1]
        for k in range(segs):
            # winding: outward normals (rings run counter-clockwise seen from above, rows top -> bottom)
            if len(a) == 1:
                bm.faces.new((a[0], b[k], b[(k + 1) % segs]))
            elif len(b) == 1:
                bm.faces.new((a[k], b[0], a[(k + 1) % segs]))
            else:
                bm.faces.new((a[k], b[k], b[(k + 1) % segs], a[(k + 1) % segs]))
    return R


def strip_mesh(bm, rows, flip=False):
    """open strip (visor, brim segment): rows of equal length, not wrapped."""
    R = [[bm.verts.new(p) for p in row] for row in rows]
    for i in range(len(R) - 1):
        for k in range(len(R[i]) - 1):
            f = (R[i][k], R[i][k + 1], R[i + 1][k + 1], R[i + 1][k])
            bm.faces.new(f[::-1] if flip else f)
    return R


def apply_offset(bm, fit, ov):
    """per-character overrides: up/fwd (m), pitch/roll/yaw (deg), scale. Pivot = skull centre at brow height."""
    piv = Vector((0, fit.yc, fit.brow + 0.04))
    M = Matrix.Translation(piv)
    M = M @ Matrix.Rotation(math.radians(ov.get('yaw_deg', 0)), 4, 'Z')
    M = M @ Matrix.Rotation(math.radians(ov.get('pitch_deg', 0)), 4, 'X')
    M = M @ Matrix.Rotation(math.radians(ov.get('roll_deg', 0)), 4, 'Y')
    s = ov.get('scale', 1.0)
    M = M @ Matrix.Scale(s, 4) @ Matrix.Translation(-piv)
    M = Matrix.Translation((0, -ov.get('fwd', 0.0), ov.get('up', 0.0))) @ M
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)


def push_out(bm, fit, clearance=0.004, verts=None):
    n = 0
    for v in (verts or bm.verts):
        for tree in (fit.tree, fit.hair_tree):
            if tree is None:
                continue
            loc, nrm, i, d = tree.find_nearest(v.co, 0.05)
            if loc is None:
                continue
            s = (v.co - loc).dot(nrm)
            if s < clearance:
                v.co = loc + nrm * clearance
                n += 1
    return n


def eye_check(tree, fit, elev=(0, 5, 10), yaws=(-25, -12, 0, 12, 25)):
    """rays from the top of each eyeball, forward; returns (ok, min_hit_distance or None)"""
    m = fit.m
    hits = []
    for key in ('eye_l', 'eye_r'):
        e = Vector(m[key]); o = Vector((e.x, m['eye_front_y'] - 0.002, m['eye_top_z']))
        for el in elev:
            for yw in yaws:
                a, b = math.radians(yw), math.radians(el)
                d = Vector((math.sin(a) * math.cos(b), -math.cos(a) * math.cos(b), math.sin(b)))
                hit, n, i, dist = tree.ray_cast(o, d, 0.6)
                if hit is not None:
                    hits.append(dist)
    return (len(hits) == 0), (min(hits) if hits else None)


def front_edge_z(obj, fit):
    """lowest headgear point in front of the eyes (|x| < eye x + 2 cm, y < eye front y + 3 cm)"""
    ex = max(abs(fit.m['eye_l'][0]), abs(fit.m['eye_r'][0])) + 0.02
    zs = [v.co.z for v in obj.data.vertices if abs(v.co.x) < ex and v.co.y < fit.m['eye_front_y'] + 0.03]
    return min(zs) if zs else None
