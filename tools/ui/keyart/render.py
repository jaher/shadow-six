"""Menu key art (review fix: the S03 hero and the S20 figure were flat SVG clip-art): offline Cycles renders of the
project's Green Beret character model (the character pipeline's chars/commandos_a/out/greenberet.blend, CPU Cycles,
Blender 4.0; reproduces the shipped tiny-portrait.webp bit for bit).
  blender -b <greenberet.blend> --python tools/ui/keyart/render.py -- hero <out.png> 1800 2700 160 tools/ui/keyart/pose_hero.json
  blender -b <greenberet.blend> --python tools/ui/keyart/render.py -- portrait <out.png> 1200 1680 160 tools/ui/keyart/pose_portrait.json
then  python3 tools/ui/keyart/grade.py <out.png> assets/ui/keyart/hero.webp 900 1350 hero   (tiny-portrait: 600 840 muted)
Check modes, same pose and lights with the camera on the shooting hand: hand (the hero camera's side), hand_far (the
pistol's thumb side, body masked to the forearm), hand_top, e.g.
  blender -b <greenberet.blend> --python tools/ui/keyart/render.py -- hand /tmp/hand.png 600 600 32 tools/ui/keyart/pose_hero.json
Pose JSON:
  bones     {bone: [x, y, z] euler degrees, local}   finger curls, rest of the body
  aim       [[bone, direction | point, is_point, twist], ...] aim a bone's Y axis in armature space
  palm      {"dir": world direction, "split": k}      solves the right forearm/hand twist (k on the forearm) so the
                                                      palm faces dir
  pistol    {"loc": [a, n, b] m, "rot": euler deg, "scale"}   the Colt M1911A1 from colt1911.py, its web point (grip
            safety curve) placed in the right palm frame: a wrist -> middle knuckle, n out of the palm, b toward the
            thumb; the barrel runs along a, the slide toward b, the pistol's left side along n
  aim_gun   [[bone, direction in the pistol frame], ...]  trigger finger straight along the frame, thumb on the safety
  grasp     [finger | {"f": finger, wrap() overrides}]  curls each finger round the grip until the skin meets it
            (BVH contact search over the pistol parts + a convex hull of the grip, no sinking in)
  gun_lights {name: {"off", "energy", "color", "size"}}  accents light-linked to the pistol only
  cam, lights   framing and the fire / moon light energies
Prints CLIP lines: finger skin vs the pistol and the pistol vs the torso (webbing, chest). The model's UV nodes name a
layer 'atlas' the mesh calls 'UVMap', so the script clears the node's uv_map (default layer).
"""# blender -b greenberet.blend --python render.py -- <mode:hero|portrait|hand|hand_far|hand_top> <out.png> [W H samples pose.json]
import bpy, sys, os, math, json
from mathutils import Vector, Euler, Matrix
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
mode, out = argv[0], argv[1]
W = int(argv[2]) if len(argv) > 2 else 900
H = int(argv[3]) if len(argv) > 3 else 1300
SPP = int(argv[4]) if len(argv) > 4 else 64
POSE = json.loads(open(argv[5]).read()) if len(argv) > 5 else {}
HERE = os.path.dirname(os.path.abspath(__file__))
sc = bpy.context.scene
for vl in sc.view_layers:
    vl.material_override = None
for n in ('LOD1', 'LOD2'):
    o = bpy.data.objects.get(n)
    if o: o.hide_render = True
rig = bpy.data.objects['body.rig']
body = bpy.data.objects['LOD0']
# ---- pose (euler degrees per bone, local XYZ)
bpy.context.view_layer.objects.active = rig
for b in rig.pose.bones: b.rotation_mode = 'XYZ'
for name, rot in POSE.get('bones', {}).items():
    pb = rig.pose.bones.get(name)
    if pb: pb.rotation_euler = Euler([math.radians(v) for v in rot], 'XYZ')
bpy.context.view_layer.update()


def upd():
    bpy.context.view_layer.update()


def aim_bone(pb, d, twist=0.0):
    M = pb.matrix.copy(); loc = M.translation.copy()
    q = M.col[1].xyz.normalized().rotation_difference(Vector(d).normalized())
    N = q.to_matrix().to_4x4() @ M
    if twist: N = N @ Matrix.Rotation(math.radians(twist), 4, 'Y')
    N.translation = loc; pb.matrix = N; upd()


def P(n):
    return rig.matrix_world @ rig.pose.bones[n].head


def palm_frame(side='r'):
    """Wrist origin + orthonormal palm axes: a (wrist -> middle knuckle), n (out of the palm, the side the fingers
    curl to), b = a x n (radial, toward the thumb, for the right hand)."""
    w = P('hand_' + side)
    a = (P('middle_01_' + side) - w).normalized()
    n = a.cross(P('index_01_' + side) - P('pinky_01_' + side)).normalized()
    curl = (rig.matrix_world.to_3x3() @ rig.pose.bones['middle_01_' + side].matrix.to_3x3()).col[2]
    if n.dot(curl) < 0: n = -n
    return w, a, a.cross(n).normalized(), n


def signed_angle(u, v, axis):
    u = (u - axis * u.dot(axis)).normalized(); v = (v - axis * v.dot(axis)).normalized()
    return math.degrees(math.atan2(axis.dot(u.cross(v)), u.dot(v)))


steps = POSE.get('aim', [])
palm_goal = POSE.get('palm')          # {"dir": [x,y,z], "split": 0.5}  world direction the right palm faces
inc = {}
for it in range(8 if palm_goal else 1):
    for step in steps:                # re-aiming an aimed bone is a no-op rotation, so only the increment twists
        pb = rig.pose.bones[step[0]]
        tgt = step[1]
        d = Vector(tgt) - pb.head if (step[2] if len(step) > 2 else False) else Vector(tgt)
        aim_bone(pb, d, ((step[3] if len(step) > 3 else 0.0) if it == 0 else 0.0) + inc.get(step[0], 0.0))
    if not palm_goal:
        break
    w, a, b, n = palm_frame('r')
    axis = (P('hand_r') - P('lowerarm_r')).normalized()
    phi = signed_angle(n, Vector(palm_goal['dir']).normalized(), axis)
    k = palm_goal.get('split', 0.5)
    inc = {'lowerarm_r': phi * k, 'hand_r': phi * (1 - k)}
    print('PALM it', it, 'phi', round(phi, 2))
    if abs(phi) < 0.2:
        break
for step in steps:
    pb = rig.pose.bones[step[0]]
    print('BONE', step[0], 'head', tuple(round(v, 3) for v in pb.head), 'tail', tuple(round(v, 3) for v in pb.tail))


# ---- the Colt M1911A1 in the right hand
def skin_of(obj, bone_names):
    """Indices of the vertices whose dominant deform weight is one of bone_names."""
    gi = {g.index: g.name for g in obj.vertex_groups}
    sel = []
    for v in obj.data.vertices:
        best, bw = None, 0.0
        for g in v.groups:
            if g.weight > bw and gi.get(g.group) in rig.data.bones:
                best, bw = gi[g.group], g.weight
        if best in bone_names: sel.append(v.index)
    return sel


def eval_coords(obj, idx):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    M = obj.matrix_world
    co = [M @ me.vertices[i].co for i in idx]
    ev.to_mesh_clear()
    return co


RAY = Vector((0.31, 0.53, 0.79)).normalized()


def inside(bvh, p):
    """Ray parity (closed mesh): an odd number of crossings along a fixed ray means p is inside."""
    hits, o = 0, p.copy()
    for _ in range(32):
        loc, _, _, _ = bvh.ray_cast(o, RAY, 1.0)
        if loc is None: break
        hits += 1; o = loc + RAY * 1e-6
    return hits % 2 == 1


def sdist(colliders, p, reach=0.03):
    """Signed distance to the nearest collider surface (negative inside: nearest-face normal, confirmed by parity)."""
    best = reach
    for bvh in colliders:
        loc, nrm, _, dist = bvh.find_nearest(p, reach)
        if loc is not None:
            best = min(best, -dist if (p - loc).dot(nrm) < 0 and inside(bvh, p) else dist)
    return best


def finger_state(chain, colliders, segs, base_skip):
    """Signed distances of a finger's skin, per segment (proximal base skin near the knuckle excluded)."""
    out = []
    for k in range(len(chain)):
        co = eval_coords(body, segs[k])
        if k == 0:
            h = P(chain[0])
            co = [c for c in co if (c - h).length > base_skip]
        out.append([sdist(colliders, c) for c in co] or [1.0])
    return out


def wrap(chain, colliders, segs, ratio=0.35, touch=0.001, tol=0.0008, base_skip=0.016, rng1=(-10, 100), rng2=(0, 115), only1=False):
    """Curl a finger round the grip: search MCP (t1) and PIP (t2) angles (DIP = ratio * t2) for the most closed
    pose whose skin does not sink into the pistol, with the middle / distal pads touching it."""
    pbs = [rig.pose.bones[b] for b in chain]
    base = [list(pb.rotation_euler) for pb in pbs]
    def setp(t1, t2):
        for pb, b0, t in zip(pbs, base, (t1, t2, t2 * ratio)):
            r = list(b0); r[0] = b0[0] + math.radians(t); pb.rotation_euler = r
        upd()
    def cost(t1, t2):
        setp(t1, t2)
        st = finger_state(chain, colliders, segs, base_skip)
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


gun = None
if POSE.get('pistol'):
    sys.path.insert(0, HERE)
    import colt1911
    gun, parts = colt1911.build()
    p = POSE['pistol']
    w, a, b, n = palm_frame('r')
    # pistol frame in the palm frame: barrel (X) along the hand, left side (Y) out of the palm, slide top (Z) toward
    # the thumb; 'rot' turns it further (pistol-local euler)
    R = Matrix((a, n, b)).transposed()
    R = R @ Euler([math.radians(v) for v in p.get('rot', (0, 0, 0))], 'XYZ').to_matrix()
    off = p.get('loc', (0.072, 0.03, 0.035))                   # web point: along a, along n, along b (metres)
    at = w + a * off[0] + n * off[1] + b * off[2]
    M = R.to_4x4(); M.translation = at
    gun.matrix_world = M @ Matrix.Scale(p.get('scale', 1.0), 4)
    upd()
    for step in POSE.get('aim_gun', []):     # [bone, direction in the pistol frame, twist]: trigger finger, thumb
        aim_bone(rig.pose.bones[step[0]], rig.matrix_world.inverted().to_3x3() @ (gun.matrix_world.to_3x3() @ Vector(step[1])),
                 step[2] if len(step) > 2 else 0.0)
    Gi = gun.matrix_world.inverted()
    for bn in ('hand_r', 'thumb_01_r', 'thumb_03_r', 'index_01_r', 'index_03_r', 'middle_01_r', 'ring_01_r', 'pinky_01_r'):
        q = Gi @ P(bn)
        print('HANDPT %-11s gun mm x %6.1f y %6.1f z %6.1f' % (bn, q.x * 1000, q.y * 1000, q.z * 1000))
    names = [o.name for o in gun.children if o.type == 'MESH' and not o.get('cutter')]
    dg = bpy.context.evaluated_depsgraph_get()
    def bvh_of(o):
        ev = o.evaluated_get(dg); me = ev.to_mesh()
        verts = [o.matrix_world @ v.co for v in me.vertices]; polys = [tuple(pl.vertices) for pl in me.polygons]
        t = BVHTree.FromPolygons(verts, polys); ev.to_mesh_clear(); return t
    cnames = [nm for nm in names if not nm.startswith(('screw', 'lanyard', 'bore', 'hood', 'barrel', 'front_sight', 'rear_sight', 'magazine'))]
    colliders = [bvh_of(bpy.data.objects[nm]) for nm in cnames] + [BVHTree.FromBMesh(colt1911.grip_hull(gun))]
    cnames.append('grip_hull')
    # skin vertices per finger segment (dominant weight)
    fing = {}
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        chain = [f'{f}_0{i}_r' for i in (1, 2, 3)]
        fing[f] = (chain, [skin_of(body, chain[k:]) for k in range(3)])
    for f in POSE.get('grasp', []):           # name | {"f": name, ...wrap() keyword overrides}
        f = {'f': f} if isinstance(f, str) else dict(f)
        chain, idx = fing[f.pop('f')]
        for k2 in ('rng1', 'rng2'):
            if k2 in f: f[k2] = tuple(f[k2])
        wrap(chain, colliders, idx, **f)
    # report: skin inside the pistol, pistol inside the torso
    hand_idx = skin_of(body, {'hand_r'} | {f'{f}_0{i}_r' for f in ('index', 'middle', 'ring', 'pinky', 'thumb') for i in (1, 2, 3)})
    co = eval_coords(body, hand_idx)
    sds = [sdist(colliders, c) for c in co]
    print('CLIP hand-in-pistol: %d verts < -1 mm, min %.1f mm' % (sum(1 for s in sds if s < -0.001), min(sds) * 1000))
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        c = eval_coords(body, fing[f][1][0]); s = [sdist(colliders, x) for x in c]
        if os.environ.get('KEYART_DEBUG'):            # which part the deepest skin vertex is inside
            x = c[s.index(min(s))]
            for nm, bvh in zip(cnames, colliders):
                loc, nrm, _, dist = bvh.find_nearest(x, 0.03)
                if loc is not None and (x - loc).dot(nrm) < 0 and inside(bvh, x):
                    print('DBG', f, nm, 'p', tuple(round(v * 1000, 1) for v in Gi @ x), 'loc', tuple(round(v * 1000, 1) for v in Gi @ loc), 'n', tuple(round(v, 2) for v in Gi.to_3x3() @ nrm))
        print('CLIP %-6s min %.1f mm  touching(<2mm) %d/%d' % (f, min(s) * 1000, sum(1 for x in s if x < 0.002), len(s)))
    # pistol and shooting arm vs the rest of the figure (torso, webbing, head) and the beret: nearest distance plus
    # surface crossings along every pistol / arm edge (a crossing = interpenetration)
    arm = {'lowerarm_r', 'hand_r'} | {f'{f}_0{i}_r' for f in ('index', 'middle', 'ring', 'pinky', 'thumb') for i in (1, 2, 3)}
    aset = set(skin_of(body, arm))
    ev = body.evaluated_get(dg); me = ev.to_mesh()
    bv = [body.matrix_world @ v.co for v in me.vertices]
    rest = BVHTree.FromPolygons(bv, [tuple(pl.vertices) for pl in me.polygons if not any(i in aset for i in pl.vertices)])
    head = BVHTree.FromPolygons(bv, [tuple(pl.vertices) for pl in me.polygons if all(i in hset for i in pl.vertices)]) if (hset := set(skin_of(body, {'head', 'neck_01'}))) else None
    arm_edges = [(bv[e.vertices[0]], bv[e.vertices[1]]) for e in me.edges if e.vertices[0] in aset and e.vertices[1] in aset]
    arm_pts = [bv[i] for i in aset]
    ev.to_mesh_clear()
    hg = bpy.data.objects.get('headgear')
    if hg:
        e3 = hg.evaluated_get(dg); m3 = e3.to_mesh()
        beret = BVHTree.FromPolygons([hg.matrix_world @ v.co for v in m3.vertices], [tuple(pl.vertices) for pl in m3.polygons]); e3.to_mesh_clear()
    gpts, gedges = [], []
    for nm in names:
        o = bpy.data.objects[nm]; e2 = o.evaluated_get(dg); m2 = e2.to_mesh()
        vs = [o.matrix_world @ v.co for v in m2.vertices]
        gpts += vs; gedges += [(vs[e.vertices[0]], vs[e.vertices[1]]) for e in m2.edges]; e2.to_mesh_clear()
    def crossings(bvh, edges):
        n = 0
        for a0, a1 in edges:
            d = a1 - a0; L = d.length
            if L > 1e-9 and bvh.ray_cast(a0, d / L, L)[0] is not None: n += 1
        return n
    def nearest(bvh, pts):
        return min((bvh.find_nearest(x, 0.2)[3] or 0.2) if bvh.find_nearest(x, 0.2)[0] is not None else 0.2 for x in pts)
    targets = [('torso/webbing/head', rest)] + ([('beret', beret)] if hg else [])
    for nm, bvh in targets:
        print('CLIP pistol vs %-18s nearest %5.1f mm, crossing edges %d' % (nm, nearest(bvh, gpts) * 1000, crossings(bvh, gedges)))
    for nm, bvh in ([('head/neck', head)] if head else []) + ([('beret', beret)] if hg else []):
        print('CLIP arm    vs %-18s nearest %5.1f mm, crossing edges %d' % (nm, nearest(bvh, arm_pts) * 1000, crossings(bvh, arm_edges)))
for im in bpy.data.images:
    if im.source == 'FILE':
        try: im.reload(); im.pack()
        except Exception as e: print('IMGERR', im.name, e)
# ---- material fixes: the model's UV map nodes point at a layer name the mesh doesn't have
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for nd in m.node_tree.nodes:
        if nd.type == 'UVMAP': nd.uv_map = ''
# ---- world + lights
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SPP
sc.cycles.use_denoising = False
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = 'Filmic'
sc.view_settings.look = 'Medium Contrast' if mode == 'portrait' else 'Medium High Contrast'
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.012, 0.012, 0.01, 1) if mode == 'portrait' else (0.012, 0.014, 0.022, 1)
bg.inputs[1].default_value = 1.0


def light(name, kind, loc, rot, energy, color, size=1.0):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if kind == 'AREA': d.size = size
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o)
    o.location = loc; o.rotation_euler = Euler([math.radians(v) for v in rot])
    return o


def aim(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()


head = Vector((0, -0.08, 1.86))
if mode != 'portrait':
    L = POSE.get('lights', {})
    g = lambda k, d: L.get(k, d)
    a_ = light('rimR', 'AREA', (1.2, 1.5, 1.8), (0, 0, 0), g('rimR', 2600), (1.0, 0.42, 0.12), 1.0); aim(a_, head)
    b_ = light('rimL', 'AREA', (-1.3, 1.3, 1.4), (0, 0, 0), g('rimL', 1100), (1.0, 0.5, 0.16), 0.8); aim(b_, head)
    c_ = light('bounce', 'AREA', (1.1, -1.5, 0.5), (0, 0, 0), g('bounce', 170), (1.0, 0.45, 0.16), 1.2); aim(c_, head)
    d_ = light('moon', 'AREA', (-1.9, -1.2, 3.0), (0, 0, 0), g('moon', 70), (0.5, 0.64, 1.0), 1.5); aim(d_, head)
    e_ = light('key', 'AREA', (0.5, -2.6, 1.2), (0, 0, 0), g('key', 22), (1.0, 0.6, 0.32), 0.8); aim(e_, head)
    for nm, spec in POSE.get('gun_lights', {}).items():     # accents linked to the pistol only (Cycles light linking):
        if gun is None: break                                  # 'off' is an offset from the pistol, world metres
        c0 = gun.matrix_world.translation
        o = light(nm, 'AREA', tuple(c0 + Vector(spec['off'])), (0, 0, 0), spec['energy'], spec.get('color', (1, 1, 1)), spec.get('size', 0.3))
        aim(o, c0)
        o.light_linking.receiver_collection = bpy.data.collections[gun.users_collection[0].name]
    cam_loc, cam_tgt, lens = Vector((0.05, -2.9, 1.05)), Vector((0, 0, 1.38)), 50
else:
    k = light('key', 'AREA', (1.5, -1.9, 2.7), (0, 0, 0), 300, (1.0, 0.9, 0.76), 1.2); aim(k, head)
    f = light('fill', 'AREA', (-1.8, -1.5, 1.5), (0, 0, 0), 35, (0.8, 0.88, 1.0), 2.0); aim(f, head)
    r = light('rim', 'AREA', (-1.0, 1.5, 2.3), (0, 0, 0), 420, (1, 0.95, 0.85), 1.0); aim(r, head)
    sc.view_settings.look = 'Medium High Contrast'
    cam_loc, cam_tgt, lens = Vector((-0.55, -2.2, 1.62)), Vector((0.02, 0, 1.58)), 70
for k2, v in POSE.get('cam', {}).items():
    if k2 == 'loc': cam_loc = Vector(v)
    if k2 == 'tgt': cam_tgt = Vector(v)
    if k2 == 'lens': lens = v
if mode.startswith('hand') and gun is not None:      # check views on the shooting hand
    c = gun.matrix_world @ Vector((0.03, 0, -0.02))
    if mode == 'hand': cam_loc, cam_tgt, lens = c + (cam_loc - c).normalized() * 0.9, c, 135
    elif mode == 'hand_far': cam_loc, cam_tgt, lens = c + gun.matrix_world.to_3x3() @ Vector((0.15, 0.75, 0.2)), c, 135
    else: cam_loc, cam_tgt, lens = c + Vector((-0.55, -0.35, 0.45)), c, 135
    sc.render.film_transparent = False
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.03, 0.035, 0.05, 1)
    fl = light('checkfill', 'AREA', tuple(cam_loc + Vector((0.2, 0, 0.3))), (0, 0, 0), 25, (1, 1, 1), 0.6); aim(fl, c)
cd = bpy.data.cameras.new('cam'); cd.lens = lens
if mode == 'hand_far' and gun is not None:       # the pistol's left (thumb) side: show only the right forearm + hand
    vg = body.vertex_groups.new(name='keyart_armmask')
    vg.add(skin_of(body, {'lowerarm_r', 'hand_r'} | {f'{f}_0{i}_r' for f in ('index', 'middle', 'ring', 'pinky', 'thumb') for i in (1, 2, 3)}), 1.0, 'REPLACE')
    mk = body.modifiers.new('keyart_mask', 'MASK'); mk.vertex_group = vg.name
    for o in (bpy.data.objects.get('headgear'), bpy.data.objects.get('LOD0_alpha')):
        if o: o.hide_render = True
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); cam.location = cam_loc; aim(cam, cam_tgt)
sc.camera = cam
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
