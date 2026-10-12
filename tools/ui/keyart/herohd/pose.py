"""Pose B ("muzzle up by the head") for the detailed hero: the pose JSON format and solver of tools/ui/keyart/render.py
(aims in armature space, palm twist solve, Colt in the palm frame, trigger finger / thumb aimed along the frame, the
other fingers curled round the grip by a BVH contact search), generalised to any rig + skin with the game-engine
bone names. The rest pose differs from the game model, so the hero pose file is pose_herohd.json."""
import bpy, sys, os, math
from mathutils import Vector, Euler, Matrix
from mathutils.bvhtree import BVHTree

FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')


class Poser:
    def __init__(self, rig, body):
        self.rig, self.body = rig, body
        bpy.context.view_layer.objects.active = rig
        for b in rig.pose.bones: b.rotation_mode = 'XYZ'

    def upd(self):
        bpy.context.view_layer.update()

    def P(self, n):
        return self.rig.matrix_world @ self.rig.pose.bones[n].head

    def aim_bone(self, pb, d, twist=0.0):
        """Aim a bone's Y axis along d (armature space), optional twist about Y (degrees)."""
        M = pb.matrix.copy(); loc = M.translation.copy()
        q = M.col[1].xyz.normalized().rotation_difference(Vector(d).normalized())
        N = q.to_matrix().to_4x4() @ M
        if twist: N = N @ Matrix.Rotation(math.radians(twist), 4, 'Y')
        N.translation = loc; pb.matrix = N; self.upd()

    def palm_frame(self, side='r'):
        """Wrist origin + palm axes: a (wrist -> middle knuckle), b (toward the thumb), n (out of the palm, the side
        the fingers curl to)."""
        P = self.P
        w = P('hand_' + side)
        a = (P('middle_01_' + side) - w).normalized()
        n = a.cross(P('index_01_' + side) - P('pinky_01_' + side)).normalized()
        curl = (self.rig.matrix_world.to_3x3() @ self.curl_axis_world('middle_02_' + side))
        if n.dot(curl) < 0: n = -n
        return w, a, a.cross(n).normalized(), n

    def curl_axis_world(self, bn):
        """Direction the finger bone's tail moves when the bone curls (+X rotation)."""
        pb = self.rig.pose.bones[bn]
        M = pb.matrix.to_3x3()
        y = M.col[1].xyz; x = M.col[0].xyz
        return Matrix.Rotation(math.radians(10), 3, x) @ y - y

    @staticmethod
    def signed_angle(u, v, axis):
        u = (u - axis * u.dot(axis)).normalized(); v = (v - axis * v.dot(axis)).normalized()
        return math.degrees(math.atan2(axis.dot(u.cross(v)), u.dot(v)))

    def apply(self, POSE):
        rig = self.rig
        for name, rot in POSE.get('bones', {}).items():
            pb = rig.pose.bones.get(name)
            if pb: pb.rotation_euler = Euler([math.radians(v) for v in rot], 'XYZ')
        self.upd()
        steps = POSE.get('aim', [])
        palm_goal = POSE.get('palm')
        inc = {}
        for it in range(8 if palm_goal else 1):
            for step in steps:
                pb = rig.pose.bones[step[0]]
                tgt = step[1]
                d = Vector(tgt) - pb.head if (step[2] if len(step) > 2 else False) else Vector(tgt)
                self.aim_bone(pb, d, ((step[3] if len(step) > 3 else 0.0) if it == 0 else 0.0) + inc.get(step[0], 0.0))
            if not palm_goal: break
            w, a, b, n = self.palm_frame('r')
            axis = (self.P('hand_r') - self.P('lowerarm_r')).normalized()
            phi = self.signed_angle(n, Vector(palm_goal['dir']).normalized(), axis)
            k = palm_goal.get('split', 0.5)
            inc = {'lowerarm_r': phi * k, 'hand_r': phi * (1 - k)}
            print('PALM it', it, 'phi', round(phi, 2))
            if abs(phi) < 0.2: break
        for name, rot in POSE.get('post', {}).items():     # extra local rotations after the aims (degrees, XYZ)
            pb = rig.pose.bones[name]
            pb.rotation_euler = (Euler(pb.rotation_euler) .to_matrix() @ Euler([math.radians(v) for v in rot], 'XYZ').to_matrix()).to_euler()
        self.upd()

    # ---- skin helpers
    def skin_of(self, bone_names, obj=None):
        obj = obj or self.body
        gi = {g.index: g.name for g in obj.vertex_groups}
        sel = []
        for v in obj.data.vertices:
            best, bw = None, 0.0
            for g in v.groups:
                if g.weight > bw and gi.get(g.group) in self.rig.data.bones:
                    best, bw = gi[g.group], g.weight
            if best in bone_names: sel.append(v.index)
        return sel

    def eval_coords(self, idx, obj=None):
        obj = obj or self.body
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        M = obj.matrix_world
        co = [M @ me.vertices[i].co for i in idx]
        ev.to_mesh_clear()
        return co


RAY = Vector((0.31, 0.53, 0.79)).normalized()


def inside(bvh, p):
    hits, o = 0, p.copy()
    for _ in range(32):
        loc, _, _, _ = bvh.ray_cast(o, RAY, 1.0)
        if loc is None: break
        hits += 1; o = loc + RAY * 1e-6
    return hits % 2 == 1


def sdist(colliders, p, reach=0.03):
    best = reach
    for bvh in colliders:
        loc, nrm, _, dist = bvh.find_nearest(p, reach)
        if loc is not None:
            best = min(best, -dist if (p - loc).dot(nrm) < 0 and inside(bvh, p) else dist)
    return best


def pistol(ps, POSE, here):
    """Build the Colt, put it in the right palm, aim the trigger finger + thumb, curl the rest round the grip."""
    rig, body = ps.rig, ps.body
    sys.path.insert(0, here)
    import colt1911
    gun, parts = colt1911.build()
    p = POSE['pistol']
    w, a, b, n = ps.palm_frame('r')
    R = Matrix((a, n, b)).transposed()
    R = R @ Euler([math.radians(v) for v in p.get('rot', (0, 0, 0))], 'XYZ').to_matrix()
    off = p.get('loc', (0.072, 0.03, 0.035))
    at = w + a * off[0] + n * off[1] + b * off[2]
    M = R.to_4x4(); M.translation = at
    gun.matrix_world = M @ Matrix.Scale(p.get('scale', 1.0), 4)
    ps.upd()
    for step in POSE.get('aim_gun', []):
        ps.aim_bone(rig.pose.bones[step[0]], rig.matrix_world.inverted().to_3x3() @ (gun.matrix_world.to_3x3() @ Vector(step[1])),
                    step[2] if len(step) > 2 else 0.0)
    names = [o.name for o in gun.children if o.type == 'MESH' and not o.get('cutter')]
    dg = bpy.context.evaluated_depsgraph_get()
    def bvh_of(o):
        ev = o.evaluated_get(dg); me = ev.to_mesh()
        verts = [o.matrix_world @ v.co for v in me.vertices]; polys = [tuple(pl.vertices) for pl in me.polygons]
        t = BVHTree.FromPolygons(verts, polys); ev.to_mesh_clear(); return t
    cnames = [nm for nm in names if not nm.startswith(('screw', 'lanyard', 'bore', 'hood', 'barrel', 'front_sight', 'rear_sight', 'magazine'))]
    colliders = [bvh_of(bpy.data.objects[nm]) for nm in cnames] + [BVHTree.FromBMesh(colt1911.grip_hull(gun))]
    fing = {}
    for f in FINGERS:
        chain = [f'{f}_0{i}_r' for i in (1, 2, 3)]
        fing[f] = (chain, [ps.skin_of(chain[k:]) for k in range(3)])

    def finger_state(chain, segs, base_skip):
        out = []
        for k in range(len(chain)):
            co = ps.eval_coords(segs[k])
            if k == 0:
                h = ps.P(chain[0])
                co = [c for c in co if (c - h).length > base_skip]
            out.append([sdist(colliders, c) for c in co] or [1.0])
        return out

    def wrap(chain, segs, ratio=0.35, touch=0.001, tol=0.0008, base_skip=0.016, rng1=(-10, 100), rng2=(0, 115), only1=False):
        pbs = [rig.pose.bones[b_] for b_ in chain]
        base = [list(pb.rotation_euler) for pb in pbs]
        def setp(t1, t2):
            for pb, b0, t in zip(pbs, base, (t1, t2, t2 * ratio)):
                r = list(b0); r[0] = b0[0] + math.radians(t); pb.rotation_euler = r
            ps.upd()
        def cost(t1, t2):
            setp(t1, t2)
            st = finger_state(chain, segs, base_skip)
            pen = sum(max(0.0, -d - tol) ** 2 for seg in st for d in seg)
            gap = sum(max(0.0, min(seg) - touch) ** 2 for seg in st[1:]) if not only1 else max(0.0, min(min(seg) for seg in st) - touch) ** 2
            return 1e7 * pen + 1e3 * gap - 1e-6 * (t1 + t2) + 1e-7 * (t1 - 0.75 * t2) ** 2 * (not only1), st
        best = None
        t2s = [0.0] if only1 else range(int(rng2[0]), int(rng2[1]) + 1, 10)
        for t1 in range(int(rng1[0]), int(rng1[1]) + 1, 10):
            for t2 in t2s:
                c, _ = cost(t1, t2)
                if best is None or c < best[0]: best = (c, t1, t2)
        for stepd in (4.0, 1.5):
            c0, a1, a2 = best
            for d1 in (-2, -1, 0, 1, 2):
                for d2 in ((0,) if only1 else (-2, -1, 0, 1, 2)):
                    c, _ = cost(a1 + d1 * stepd, a2 + d2 * stepd)
                    if c < best[0]: best = (c, a1 + d1 * stepd, a2 + d2 * stepd)
        c, st = cost(best[1], best[2])
        print('WRAP %-10s t1 %5.1f t2 %5.1f  min/seg mm %s  cost %.3g' % (chain[0], best[1], best[2], [round(min(x) * 1000, 1) for x in st], c))

    for f in POSE.get('grasp', []):
        f = {'f': f} if isinstance(f, str) else dict(f)
        chain, idx = fing[f.pop('f')]
        for k2 in ('rng1', 'rng2'):
            if k2 in f: f[k2] = tuple(f[k2])
        wrap(chain, idx, **f)
    hand_idx = ps.skin_of({'hand_r'} | {f'{f}_0{i}_r' for f in FINGERS for i in (1, 2, 3)})
    sds = [sdist(colliders, c) for c in ps.eval_coords(hand_idx)]
    print('CLIP hand-in-pistol: %d verts < -1 mm, min %.1f mm' % (sum(1 for s in sds if s < -0.001), min(sds) * 1000))
    for f in FINGERS:
        s = [sdist(colliders, x) for x in ps.eval_coords(fing[f][1][0])]
        print('CLIP %-6s min %.1f mm  touching(<2mm) %d/%d' % (f, min(s) * 1000, sum(1 for x in s if x < 0.002), len(s)))
    return gun
