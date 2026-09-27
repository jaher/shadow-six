# dog_geo.py - German shepherd (Alsatian) body + armature, project-authored (CC0). Skin-modifier skeleton -> subsurf ->
# decimate; separate jaw, ears, eyes, nose rigidly weighted. Faces -Y (like the humans), Z up, metres.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix
from common import *


def activate(o, select_only=True):   # scene-object based (view_layer iteration can hold stale None after clean_scene)
    for x in bpy.context.scene.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)

# ---- joints (x, y, z); forward = -Y ------------------------------------------------------------
J = {
    'hip': (0, 0.30, 0.54), 'loin': (0, 0.12, 0.57), 'back': (0, -0.06, 0.575), 'chest': (0, -0.20, 0.545), 'wither': (0, -0.27, 0.60),
    'neck1': (0, -0.33, 0.68), 'head': (0, -0.42, 0.78), 'stop': (0, -0.50, 0.785), 'nose': (0, -0.65, 0.745),
    'tail0': (0, 0.37, 0.545), 'tail1': (0, 0.47, 0.46), 'tail2': (0, 0.54, 0.34), 'tail3': (0, 0.575, 0.22),
}
for s, x in (('l', 1), ('r', -1)):
    J.update({f'shoulder_{s}': (x * 0.078, -0.21, 0.45), f'elbow_{s}': (x * 0.075, -0.17, 0.30), f'wrist_{s}': (x * 0.068, -0.19, 0.09),
              f'fpaw_{s}': (x * 0.068, -0.235, 0.022),
              f'hipj_{s}': (x * 0.085, 0.27, 0.47), f'knee_{s}': (x * 0.09, 0.16, 0.31), f'hock_{s}': (x * 0.08, 0.34, 0.135),
              f'hpaw_{s}': (x * 0.075, 0.31, 0.022)})
# skin radii (width, height)
RAD = {'hip': (0.095, 0.11), 'loin': (0.09, 0.10), 'back': (0.108, 0.15), 'chest': (0.118, 0.19), 'wither': (0.10, 0.14),
       'neck1': (0.08, 0.098), 'head': (0.07, 0.074), 'stop': (0.048, 0.052), 'nose': (0.023, 0.025),
       'tail0': (0.04, 0.04), 'tail1': (0.052, 0.052), 'tail2': (0.05, 0.05), 'tail3': (0.032, 0.032)}
for s in 'lr':
    RAD.update({f'shoulder_{s}': (0.066, 0.09), f'elbow_{s}': (0.052, 0.055), f'wrist_{s}': (0.031, 0.031), f'fpaw_{s}': (0.037, 0.024),
                f'hipj_{s}': (0.074, 0.115), f'knee_{s}': (0.06, 0.066), f'hock_{s}': (0.032, 0.033), f'hpaw_{s}': (0.036, 0.024)})
EDGES = [('hip', 'loin'), ('loin', 'back'), ('back', 'chest'), ('chest', 'wither'), ('wither', 'neck1'), ('neck1', 'head'), ('head', 'stop'), ('stop', 'nose'),
         ('hip', 'tail0'), ('tail0', 'tail1'), ('tail1', 'tail2'), ('tail2', 'tail3')]
for s in 'lr':
    EDGES += [('chest', f'shoulder_{s}'), (f'shoulder_{s}', f'elbow_{s}'), (f'elbow_{s}', f'wrist_{s}'), (f'wrist_{s}', f'fpaw_{s}'),
              ('hip', f'hipj_{s}'), (f'hipj_{s}', f'knee_{s}'), (f'knee_{s}', f'hock_{s}'), (f'hock_{s}', f'hpaw_{s}')]

# bones: name -> (head joint, tail joint, parent)
BONES = {'root': ((0, 0.05, 0.0), (0, -0.15, 0.0), None),
         'pelvis': ('hip', 'loin', 'root'), 'spine': ('loin', 'back', 'pelvis'), 'chest': ('back', 'wither', 'spine'),
         'neck': ('wither', 'head', 'chest'), 'head': ('head', 'nose', 'neck'), 'jaw': ((0, -0.45, 0.735), (0, -0.62, 0.715), 'head'),
         'ear_l': ((0.042, -0.425, 0.83), (0.065, -0.415, 0.94), 'head'), 'ear_r': ((-0.042, -0.425, 0.83), (-0.065, -0.415, 0.94), 'head'),
         'tail1': ('tail0', 'tail1', 'pelvis'), 'tail2': ('tail1', 'tail2', 'tail1'), 'tail3': ('tail2', 'tail3', 'tail2')}
for s in 'lr':
    BONES.update({f'upperarm_{s}': (f'shoulder_{s}', f'elbow_{s}', 'chest'), f'forearm_{s}': (f'elbow_{s}', f'wrist_{s}', f'upperarm_{s}'),
                  f'fpaw_{s}': (f'wrist_{s}', f'fpaw_{s}', f'forearm_{s}'),
                  f'thigh_{s}': (f'hipj_{s}', f'knee_{s}', 'pelvis'), f'shin_{s}': (f'knee_{s}', f'hock_{s}', f'thigh_{s}'),
                  f'hpaw_{s}': (f'hock_{s}', f'hpaw_{s}', f'shin_{s}')})


def P(k):
    return Vector(J[k]) if isinstance(k, str) else Vector(k)


def body_mesh(seed=0):
    rnd = random.Random(seed)
    keys = list(J.keys())
    me = bpy.data.meshes.new('dog_skel')
    me.from_pydata([J[k] for k in keys], [(keys.index(a), keys.index(b)) for a, b in EDGES], [])
    o = new_obj('dog_body', me)
    sk = o.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    for i, k in enumerate(keys):
        r = RAD[k]
        o.data.skin_vertices[0].data[i].radius = (r[0], r[1])
    o.data.skin_vertices[0].data[keys.index('chest')].use_root = True
    ss = o.modifiers.new('sub', 'SUBSURF'); ss.levels = 2
    activate(o)
    for md in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)
    return o


def parts_mesh():
    """jaw, ears, eyes, nose as one bmesh object; each part tagged in a vertex group for rigid weights."""
    bm = bmesh.new()
    groups = {}

    def tag(name, n0):
        groups.setdefault(name, []).extend(range(n0, len(bm.verts)))
    import geo
    # lower jaw: tapered box-ish lathe under the muzzle
    n0 = len(bm.verts)
    a, b = Vector((0, -0.45, 0.728)), Vector((0, -0.625, 0.712))
    d = (b - a); L = d.length
    geo.add_cyl(bm, 0.03, 0.017, L, geo.M_at((a + b) / 2, geo.frame(d.normalized(), (0, 0, 1))) @ Matrix.Scale(1.0, 4), segs=8)
    tag('jaw', n0)
    for s in (1, -1):   # ears: erect, triangular, slightly cupped, tilted outwards
        n0 = len(bm.verts)
        base = Vector((s * 0.042, -0.43, 0.82))
        tip = Vector((s * 0.07, -0.415, 0.95))
        f = Vector((0, -1, 0.1)).normalized()
        w = Vector((1, 0, 0))
        v = [bm.verts.new(base - w * 0.036 + f * 0.004), bm.verts.new(base + w * 0.036 + f * 0.004), bm.verts.new(tip + f * 0.002),
             bm.verts.new(base - w * 0.034 - f * 0.012), bm.verts.new(base + w * 0.034 - f * 0.012), bm.verts.new(tip - f * 0.003), bm.verts.new(base + f * 0.012)]
        bm.faces.new((v[0], v[6], v[2])); bm.faces.new((v[6], v[1], v[2])); bm.faces.new((v[4], v[3], v[5]))
        bm.faces.new((v[0], v[2], v[5], v[3])); bm.faces.new((v[1], v[4], v[5], v[2])); bm.faces.new((v[0], v[3], v[4], v[1], v[6]))
        tag('ear_l' if s > 0 else 'ear_r', n0)
    for s in (1, -1):   # eyes (dark brown, glossy)
        n0 = len(bm.verts)
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.011,
                                  matrix=Matrix.Translation((s * 0.036, -0.492, 0.80)))
        tag('eyes', n0)
    n0 = len(bm.verts)
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.017, matrix=Matrix.Translation((0, -0.655, 0.75)) @ Matrix.Scale(1.25, 4, (1, 0, 0)))
    tag('nose', n0)
    me = bpy.data.meshes.new('dog_parts'); bm.to_mesh(me); bm.free()
    o = new_obj('dog_parts', me)
    for g, idx in groups.items():
        vg = o.vertex_groups.new(name=g); vg.add(idx, 1.0, 'REPLACE')
    return o


def armature():
    arm = bpy.data.armatures.new('dog_rig')
    rig = new_obj('dog_rig', arm)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, (h, t, par) in BONES.items():
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = P(h), P(t)
        eb.roll = 0.0
        if par:
            eb.parent = arm.edit_bones[par]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig
