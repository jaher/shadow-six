# human.py - photoreal hands (open palm, grab, fist, on lever), eye (open/closed) and the stance-button figures from the
# MakeHuman (MPFB, CC0) character already built for the game (realism/characters/out/mh_*.blend).
import sys, os, math, bmesh
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy, studio as S, mats as M, mdl as D
from mathutils import Vector, Matrix
from guns import MM

CHAR = os.path.join(os.path.dirname(S.SCRATCH), 'realism', 'characters', 'out')
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')


def load(name='mh_beret', keep_masks=False):
    S.reset(os.path.join(CHAR, name + '.blend'))
    rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    body = bpy.data.objects['Human']
    for m in [m for m in body.modifiers if m.type == 'MASK']:
        if keep_masks and 'elper' in (m.vertex_group or '') + m.name: continue
        body.modifiers.remove(m)
    print('MASKS', [(m.name, m.vertex_group) for m in body.modifiers if m.type == 'MASK'])
    return rig, body


def pose_hand(rig, side='r', curl=(0, 0, 0, 0, 0), spread=0.0, thumb=(0, 0, 0), axis='Z'):
    """curl: per finger (thumb..pinky) degrees applied to each of the 3 joints; spread: degrees fan between fingers."""
    pb = rig.pose.bones
    for fi, f in enumerate(FINGERS):
        for j in (1, 2, 3):
            b = pb.get(f'{f}_0{j}_{side}')
            if not b: continue
            b.rotation_mode = 'XYZ'
            a = curl[fi] * {1: 0.95, 2: 1.15, 3: 0.8}[j]
            e = [0.0, 0.0, 0.0]
            e['XYZ'.index(axis)] = math.radians(a)
            if f == 'thumb':
                e = [math.radians(v) for v in thumb] if j == 1 else e
            elif j == 1 and spread:
                e['XYZ'.index('X' if axis != 'X' else 'Z')] += math.radians(spread * (fi - 2.5) / 2)
            b.rotation_euler = e
    bpy.context.view_layer.update()


def extract(body, rig, side='r', keep_arm=0.09):
    """Evaluated (posed) mesh of one hand + a stub of forearm, as a new object. Returns (obj, wrist, fwd, palm_n)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    o = bpy.data.objects.new('hand', me); bpy.context.scene.collection.objects.link(o)
    o.matrix_world = body.matrix_world.copy()
    names = {f'hand_{side}'} | {f'{f}_0{j}_{side}' for f in FINGERS for j in (1, 2, 3)}
    arm = {f'lowerarm_{side}', f'lowerarm_twist_01_{side}'}
    gi = {g.index: g.name for g in body.vertex_groups}
    pb = rig.pose.bones; M_ = rig.matrix_world
    wrist = M_ @ pb[f'hand_{side}'].head
    elbow = M_ @ pb[f'lowerarm_{side}'].head
    axis = (wrist - elbow).normalized()
    bm = bmesh.new(); bm.from_mesh(me)
    dl = bm.verts.layers.deform.active
    kill = []
    for v, vo in zip(bm.verts, body.data.vertices):
        w = sum(g.weight for g in vo.groups if gi.get(g.group) in names)
        wa = sum(g.weight for g in vo.groups if gi.get(g.group) in arm)
        p = o.matrix_world @ v.co
        along = (p - wrist).dot(axis)
        if not (w > 0.2 or (wa > 0.2 and along > -keep_arm)):
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(me); bm.free()
    mid = M_ @ pb[f'middle_01_{side}'].head; idx = M_ @ pb[f'index_01_{side}'].head; pk = M_ @ pb[f'pinky_01_{side}'].head
    fwd = (mid - wrist).normalized()
    across = (idx - pk).normalized()
    palm = fwd.cross(across).normalized()
    return o, wrist, fwd, across, palm


def orient(o, wrist, fwd, palm, flip=False):
    """Move the hand so the wrist is at the origin, fingers point +Z and the palm faces -Y (the camera)."""
    z = fwd.normalized(); y = (-palm if not flip else palm).normalized(); y = (y - z * y.dot(z)).normalized(); x = y.cross(z)
    A = Matrix((x, y, z))            # rows: maps world vectors into (x, y, z) coords
    R = A.to_4x4()
    o.matrix_world = R @ Matrix.Translation(-wrist) @ o.matrix_world
    bpy.context.view_layer.update()
    return o


def skin_mat(img_path):
    def mk():
        t = M.NT('skin')
        im = bpy.data.images.load(img_path, check_existing=True)
        tx = t.n('ShaderNodeTexImage', image=im, interpolation='Cubic')
        pores = t.noise(900.0, 8.0, 0.6); blot = t.noise(30.0, 4.0, 0.5)
        # weathered field skin (tanned, blotchy), not a pale mannequin: stronger albedo variation, shallower SSS, drier
        c = t.mix(1.0, tx.outputs['Color'], (0.70, 0.54, 0.42), 'MULTIPLY')
        c = t.mix(t.math('MULTIPLY', blot, 0.45), c, (0.36, 0.20, 0.13), 'MULTIPLY')
        t.L(c, t.p.inputs['Base Color'])
        t.set('Subsurface Weight', 0.18); t.p.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.18)
        t.set('Subsurface Scale', 0.0025)
        t.L(t.math('MULTIPLY_ADD', pores, 0.22, 0.46), t.p.inputs['Roughness'])
        wr = t.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', i_Scale=160.0); t.L(t.coords(1.0), wr.inputs['Vector'])
        h = t.math('ADD', t.math('MULTIPLY', pores, 0.5), t.math('MULTIPLY', t.math('POWER', wr.outputs['Distance'], 0.25), 0.5))
        t.L(t.bump(h, strength=0.12, dist=0.0003), t.p.inputs['Normal'])
        return t.m
    return M._get('skin', mk)


SKIN = os.path.join(os.path.dirname(S.SCRATCH), 'realism', 'characters', 'bl_user', 'extensions', '.user', 'user_default', 'mpfb',
                    'data', 'skins', 'middleage_caucasian_male', 'middleage_lightskinned_male_diffuse.png')


def make_hand(curl, spread=0.0, thumb=(0, 0, 0), side='r', axis='X', keep_arm=0.07, sub=2, flip=False):
    rig, body = load()
    pose_hand(rig, side, curl, spread, thumb, axis)
    o, wrist, fwd, across, palm = extract(body, rig, side, keep_arm)
    for ob in list(bpy.data.objects):
        if ob is not o: bpy.data.objects.remove(ob, do_unlink=True)
    orient(o, wrist, fwd, palm, flip)
    o.data.materials.clear(); o.data.materials.append(skin_mat(SKIN))
    for p in o.data.polygons: p.use_smooth = True
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = sub; m.render_levels = sub
    return o


def cuff(o, length=0.085, r=(0.041, 0.034)):
    """Battledress sleeve cuff (open tube, turned-back hem) over the forearm stub (runs down -Z from the wrist at the origin)."""
    from misc import wool
    bd = M.textured('battledress2', 'hessian_230', tint=(0.66, 0.56, 0.36), scale=0.025, nstrength=1.2, sheen=0.3, rough_add=0.1)
    top = 0.014
    c = D.lathe('cuff', [(1.0, top - length), (1.02, top - length * 0.5), (1.0, top - 0.012)], bd, segs=64, cap=False, smooth_angle=80)
    c.scale = (r[0], r[1], 1.0)
    so = c.modifiers.new('solid', 'SOLIDIFY'); so.thickness = 0.0035
    tx = bpy.data.textures.new('fold', 'CLOUDS'); tx.noise_scale = 0.3
    dp = c.modifiers.new('disp', 'DISPLACE'); dp.texture = tx; dp.strength = 0.003
    hem = D.lathe('hem', [(1.0, top - 0.014), (1.06, top - 0.008), (1.06, top), (1.0, top + 0.002)], bd, segs=64, cap=False, smooth_angle=80)
    hem.scale = (r[0], r[1], 1.0)
    so2 = hem.modifiers.new('solid', 'SOLIDIFY'); so2.thickness = 0.003
    return [c, hem]


@S.shot('hand')
def _hand(mode):
    # relaxed reaching hand, fingers together and gently curled (no fanned "salute"), sleeve with button tab
    o = make_hand((14, 12, 14, 17, 21), spread=-1.5, thumb=(16, 0, 0), flip=True)
    parts = [o] + cuff(o)
    parts.append(D.box('cufftab', (0.032, 0.006, 0.016), parts[-1].data.materials[0], loc=(0.018, -0.040, -0.012), bevel=0.003))
    parts.append(D.lathe('cuffbtn', [(0, 0), (0.0048, 0), (0.0045, 0.002), (0, 0.0026)], M.solid('bd_button', M.lin((0.28, 0.20, 0.10)), rough=0.3, coat=0.6), segs=24,
                         loc=(0.026, -0.0435, -0.012), rot=(90, 0, 0)))
    D.group('handg', parts, rot=(0, 0, -8))
    S.shoot('hand', 'tool', box=(50, 65), preset='front', elev=6, margin=0.16, shadow=False, light={'key': 0.7, 'rim': 0.9, 'fill': 0.16})


@S.shot('fist')
def _fist(mode):
    o = make_hand((25, 88, 95, 95, 95), thumb=(0, 0, 0))
    parts = [o] + cuff(o)
    D.group('fistg', parts, rot=(18, 0, -20))
    S.shoot('fist', 'cursor', box=(32, 32), preset='front', elev=0, margin=0.04, shadow=False)


@S.shot('grab')
def _grab(mode):
    o = make_hand((20, 50, 55, 60, 65), spread=3, thumb=(0, 0, 0), flip=True)
    parts = [o] + cuff(o)
    D.group('grabg', parts, rot=(0, 0, 0))
    S.shoot('grab', 'cursor', box=(32, 32), preset='front', elev=10, margin=0.04, shadow=False)
    o = make_hand((6, 4, 4, 5, 8), spread=7, thumb=(10, 0, 0), flip=True)
    parts = [o] + cuff(o)
    D.group('handg', parts)
    S.shoot('hand.open', 'cursor', box=(32, 32), preset='front', elev=6, margin=0.04, shadow=False)


MPFB = os.path.join(os.path.dirname(S.SCRATCH), 'realism', 'characters', 'bl_user', 'extensions', '.user', 'user_default', 'mpfb', 'data')
TARGETS = os.path.join(os.path.dirname(S.SCRATCH), 'realism', 'characters', 'bl_user', 'extensions', 'user_default', 'mpfb', 'data', 'targets')


def apply_target(body, rel, w=1.0):
    """MakeHuman .target.gz (idx dx dy dz, decimetres, Y-up) -> Blender local deltas; returns {idx: delta}."""
    import gzip
    d = {}
    for line in gzip.open(os.path.join(TARGETS, rel), 'rt'):
        p = line.split()
        if len(p) != 4 or p[0].startswith('#'): continue
        i, dx, dy, dz = int(p[0]), float(p[1]), float(p[2]), float(p[3])
        d[i] = Vector((dx, -dz, dy)) * 0.1 * w
    vs = body.data.vertices
    for i, dv in d.items():
        if i < len(vs): vs[i].co += dv
    body.data.update()
    return d


def eye_region(close=0.0, opened=0.25, radius=0.05, iris='green_eye.png'):
    rig, body = load(keep_masks=True)
    if close: apply_target(body, 'expression/units/caucasian/eye-right-closure.target.gz', close)
    if opened: apply_target(body, 'expression/units/caucasian/eye-right-opened-up.target.gz', opened)
    eye = [o for o in bpy.data.objects if o.name.endswith('low-poly')][0]
    dg = bpy.context.evaluated_depsgraph_get()
    em = eye.evaluated_get(dg).to_mesh()
    pts = [eye.matrix_world @ v.co for v in em.vertices]
    right = [p for p in pts if p.x < 0] or pts     # character's right eye is at -X in MPFB space
    c = sum(right, Vector()) / len(right); er = max((p - c).length for p in right)
    keep = []
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or o is eye or o.name.endswith(('casualsuit01', 'shoes03', 'short04')):
            if o.type == 'MESH' and o is not eye: bpy.data.objects.remove(o, do_unlink=True)
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        n = bpy.data.objects.new(o.name + '_x', me); bpy.context.scene.collection.objects.link(n); n.matrix_world = o.matrix_world.copy()
        bm = bmesh.new(); bm.from_mesh(me)
        kill = [v for v in bm.verts if ((n.matrix_world @ v.co) - c).length > radius]
        bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(me); bm.free()
        keep.append((o.name, n))
    # high-poly eyeball fitted to the low-poly right eye
    bpy.ops.wm.obj_import(filepath=os.path.join(MPFB, 'eyes', 'high-poly', 'high-poly.obj'))
    hp = bpy.context.selected_objects[0]
    bpy.context.view_layer.update()
    hv = [hp.matrix_world @ v.co for v in hp.data.vertices]
    hr = [p for p in hv if p.x < (min(q.x for q in hv) + max(q.x for q in hv)) / 2]
    hc = sum(hr, Vector()) / len(hr); hrr = max((p - hc).length for p in hr)
    bm = bmesh.new(); bm.from_mesh(hp.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (hp.matrix_world @ v.co - hc).length > hrr * 1.05], context='VERTS'); bm.to_mesh(hp.data); bm.free()
    k = er / hrr
    print('EYEFIT', tuple(round(v, 4) for v in c), round(er, 4), tuple(round(v, 4) for v in hc), round(hrr, 4), len(hr), len(right))
    hp.matrix_world = Matrix.Translation(c) @ Matrix.Scale(k, 4) @ Matrix.Translation(-hc) @ hp.matrix_world
    for o in [rig, eye] + [o for n_, o in [(0, bpy.data.objects[n]) for n, _ in keep]]:
        bpy.data.objects.remove(o, do_unlink=True)
    return c, hp, dict((nm, ob) for nm, ob in keep)


def eye_mat(tex):
    def mk():
        t = M.NT('eyeball')
        im = bpy.data.images.load(os.path.join(MPFB, 'eyes', 'materials', tex), check_existing=True)
        tx = t.n('ShaderNodeTexImage', image=im, interpolation='Cubic')
        t.L(t.mix(1.0, tx.outputs['Color'], (1.9, 1.85, 1.8), 'MULTIPLY'), t.p.inputs['Base Color'])
        t.set('Roughness', 0.35); t.set('Coat Weight', 0.6); t.set('Coat Roughness', 0.02); t.set('Coat IOR', 1.376)
        t.set('Subsurface Weight', 0.1); t.set('Subsurface Scale', 0.002)
        return t.m
    return M._get('eyeball', mk)


FACE = os.path.join(MPFB, 'skins', 'young_caucasian_male', 'young_lightskinned_male_diffuse.png')


def build_eye(close):
    c, hp, parts = eye_region(close=close, opened=0.0 if close else 0.55)
    hp.data.materials.clear(); hp.data.materials.append(eye_mat('green_eye.png'))
    hp.data.materials.append(M.glass('cornea', color=(1, 1, 1), rough=0.0, ior=1.376))
    # loose parts: the outer shell (cornea) gets the clear material
    bpy.context.view_layer.objects.active = hp; hp.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    shells = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    def rad(o):
        vs = [o.matrix_world @ v.co for v in o.data.vertices]; cc = sum(vs, Vector()) / len(vs)
        return sum((v - cc).length for v in vs) / len(vs)
    shells.sort(key=rad)
    print('SHELLS', [(o.name, len(o.data.vertices), round(rad(o), 5)) for o in shells])
    for o in shells:
        for p in o.data.polygons: p.use_smooth = True; p.material_index = 0
    if len(shells) > 1:
        for p in shells[-1].data.polygons: p.material_index = 1
    body = parts.get('Human')
    body.data.materials.clear(); body.data.materials.append(skin_mat(FACE))
    for p in body.data.polygons: p.use_smooth = True
    m = body.modifiers.new('sub', 'SUBSURF'); m.levels = 2; m.render_levels = 2
    D.empty('eyec', c)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and not o.name.startswith('high-poly'): o['no_frame'] = True
        if close and o.type == 'MESH' and 'lash' in o.name.lower():   # closed lid: lashes read as stitches -> drop them
            bpy.data.objects.remove(o, do_unlink=True)
    return c


@S.shot('eye')
def _eye(mode):
    for close, tag in ((0.0, 'open'), (1.0, 'closed')):
        if close: S.reset()
        build_eye(close)
        # raw eye (cls 'raw', not shipped): hudtools 'eyeport' mounts it behind glass in a brass porthole
        S.shoot(f'eye.{tag}', 'raw', box=(52, 45), preset='front', elev=4, azim=-8, lens=100, margin=0.06, shadow=False)


def figure(name='mh_beret', pose='stand'):
    rig, body = load(name, keep_masks=True)
    pb = rig.pose.bones
    for b in pb: b.rotation_mode = 'XYZ'
    def R(bn, x=0, y=0, z=0):
        if bn in pb: pb[bn].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    print('BONES', [b.name for b in rig.data.bones][:60])
    return rig, body, R


DEC = os.path.join(S.SCRATCH, 'dec')   # decoded (non-meshopt) copies of the game GLBs (see gt/decode.mjs)


def load_commando(who='greenberet'):
    """In-game commando GLB (decoded), LOD0 only."""
    bpy.ops.import_scene.gltf(filepath=os.path.join(DEC, who + '.glb'))
    chars = list(bpy.context.selected_objects)
    arm = [o for o in chars if o.type == 'ARMATURE'][0]
    for o in chars:
        if o.type == 'MESH' and ('LOD1' in o.name or 'LOD2' in o.name or o.parent is None): bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return arm


def wrot(arm, bone, axis, deg):
    """Rotate a pose bone about a WORLD axis through its head (children follow)."""
    b = arm.pose.bones[bone]; aw = arm.matrix_world
    head = aw @ b.head
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    b.matrix = aw.inverted() @ R @ aw @ b.matrix
    bpy.context.view_layer.update()


def aim(arm, bone, d):
    """Rotate a pose bone about its head so it points along world direction d."""
    b = arm.pose.bones[bone]; aw = arm.matrix_world
    head, tail = aw @ b.head, aw @ b.tail
    q = (tail - head).normalized().rotation_difference(Vector(d).normalized())
    R = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    b.matrix = aw.inverted() @ R @ aw @ b.matrix
    bpy.context.view_layer.update()


# --- stance button (bottom HUD, left of the hand): a soldier CRAWLING (shown while upright) / STANDING (shown while
# crawling). The old 40x41 top-bar figurines on plinths read as a knife at game size, so the stance button is a bigger
# plaque in the "?" plaque's family (die-struck brass rim, vitreous enamel field) with the posed game commando in
# strict profile in front of it: the crawler propped on his elbows, head up, legs out; the stander upright. Ivory
# enamel behind the olive figure keeps the silhouette legible on snow, grass and dark ground alike.
STANCE_BOX = (64, 48)
STANCE_VIEW = dict(elev=float(os.environ.get('STANCE_ELEV', '6')), azim=float(os.environ.get('STANCE_AZIM', '4')))
LIE = Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Rotation(math.radians(90), 4, 'X')   # standing -> face down, head +X, left side +Y


def _fig_points():
    """Evaluated vertices of the commando meshes (world)."""
    dg = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or not (o.name.startswith('LOD0') or o.name.startswith('headgear')): continue
        e = o.evaluated_get(dg); me = e.to_mesh()
        pts += [o.matrix_world @ v.co for v in me.vertices]
        e.to_mesh_clear()
    return pts


def stance_plaque(pts, crawl):
    """Brass-rimmed ivory enamel plaque in the XZ plane behind the figure (camera at -Y), box aspect, centred on it,
    with an olive-earth enamel band below his lowest point: he visibly lies on / stands on the ground."""
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts); z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
    y1 = max(p.y for p in pts)
    asp = STANCE_BOX[0] / STANCE_BOX[1]
    # the ground line sits at GROUND of the plaque height for both icons; the crawler (long) sizes the plaque by his
    # length (toes and fists just reach the rim), the stander by his height (beret just under the rim): the figure is
    # as big as the plaque allows, which is what makes it legible at 64 ref px
    GROUND = 0.24
    zg = z0 + (0.09 if crawl else 0.015)   # crawler: belly on the ground line, elbows and toes dug in
    if crawl: W = (x1 - x0) / 0.97; H = W / asp
    else: H = (z1 - zg) / (1 - GROUND - 0.035); W = H * asp
    cx, cz = (x0 + x1) / 2, zg - GROUND * H + H / 2
    br = M.metal('stance_brass', M.lin((0.80, 0.63, 0.32)), rough=0.24, wear=0.9, wear_color=M.lin((0.98, 0.88, 0.6)), grain=0.3)
    en = M.solid('stance_enamel', M.lin((0.80, 0.76, 0.60)), rough=0.14, coat=1.0, var=0.06, vscale=4.0, bevel=0.003)
    earth = M.solid('stance_earth', M.lin((0.33, 0.29, 0.17)), rough=0.2, coat=1.0, var=0.10, vscale=6.0, bevel=0.003)
    def rr(w, h):
        r = [(cx - w / 2, cz - h / 2), (cx + w / 2, cz - h / 2), (cx + w / 2, cz + h / 2), (cx - w / 2, cz + h / 2)]
        return [(v[0], v[1]) for v in D.chaikin(r, 4, True)]
    rim = W * 0.04; t = W * 0.03
    yb = y1 + 0.25
    inner = rr(W - 2 * rim, H - 2 * rim)
    plate = D.slab('stance_plate', rr(W, H), t, br, y=yb, bevel=t * 0.3, plane='XZ')
    field = D.slab('stance_field', inner, t * 0.4, en, y=yb - t * 0.55, bevel=t * 0.1, plane='XZ')
    band = []
    for x, z in inner:
        q = (x, min(z, zg))
        if not band or (abs(band[-1][0] - q[0]) > 1e-4 or abs(band[-1][1] - q[1]) > 1e-4): band.append(q)
    ground = D.slab('stance_ground', band, t * 0.4, earth, y=yb - t * 0.75, bevel=t * 0.1, plane='XZ')
    return [plate, field, ground]


def _crawl_pose(arm):
    """Low crawl, propped on the elbows. Directions are given in the LYING frame (head +X, up +Z, his left +Y) and
    mapped back to the standing rig, which is then laid down."""
    Li = LIE.to_3x3().inverted()
    def A(bone, d):
        if bone in arm.pose.bones: aim(arm, bone, Li @ Vector(d))
    for b in ('spine_01', 'spine_02', 'spine_03'): A(b, (1, 0, 0.42))
    A('neck_01', (1, 0, 0.75)); A('Head', (0.45, 0, 1))
    A('upperarm_l', (0.3, 0.12, -1)); A('upperarm_r', (0.3, -0.12, -1))
    A('lowerarm_l', (1, -0.38, -0.04)); A('lowerarm_r', (1, 0.38, -0.04))
    A('hand_l', (1, -0.3, -0.1)); A('hand_r', (1, 0.3, -0.1))
    A('thigh_l', (-1, 0.13, -0.06)); A('calf_l', (-1, 0.08, 0.0)); A('foot_l', (-0.85, 0.05, -0.5))
    A('thigh_r', (-0.7, -0.6, -0.04)); A('calf_r', (-0.8, 0.55, 0.0)); A('foot_r', (-0.8, 0.3, -0.5))
    for side in ('l', 'r'):   # loose fists, not open palms (open hands read as swimming)
        pose_hand(arm, side, curl=(20, 75, 80, 85, 85), thumb=(0, 0, 25), axis=os.environ.get('STANCE_FAXIS', 'Z'))
    arm.matrix_world = LIE @ arm.matrix_world
    bpy.context.view_layer.update()


@S.shot('stance')
def _stance(mode):
    which = os.environ.get('STANCE_ONLY', 'crawl,stand').split(',')
    samples = int(os.environ['STANCE_SAMPLES']) if os.environ.get('STANCE_SAMPLES') else None
    for k, tag in enumerate(which):
        if k: S.reset()
        arm = load_commando()
        for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Icosphere')]:
            bpy.data.objects.remove(o, do_unlink=True)   # invisible 2 m helper sphere in the GLB: would skew framing
        if tag == 'stand':
            for sd, sx in (('l', 1), ('r', -1)):   # at attention: arms straight down his sides (reads in profile)
                aim(arm, f'upperarm_{sd}', (0.12 * sx, 0.02, -1)); aim(arm, f'lowerarm_{sd}', (0.05 * sx, -0.06, -1))
                aim(arm, f'hand_{sd}', (0.02 * sx, -0.04, -1))
                pose_hand(arm, sd, curl=(20, 60, 65, 70, 70), thumb=(0, 0, 20), axis=os.environ.get('STANCE_FAXIS', 'Z'))
            arm.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'Z') @ arm.matrix_world   # profile, facing +X
            bpy.context.view_layer.update()
        else:
            _crawl_pose(arm)
        stance_plaque(_fig_points(), tag == 'crawl')
        S.shoot(f'stance.{tag}', 'tool', box=STANCE_BOX, preset='badge', margin=0.02, shadow=False, light={'rim': 1.3},
                scale=12, samples=samples, **STANCE_VIEW)
