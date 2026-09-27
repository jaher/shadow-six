# Shared helpers for the SHADOW SIX character pipeline (run inside Blender 4.2 with MPFB 2.0.8 enabled).
import bpy, bmesh, os, sys, json, math
from mathutils import Vector, Matrix

PIPE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRATCH = '<claude-tmp>'
ASSETS = os.path.join(SCRATCH, 'realism', 'characters', 'bl_user', 'extensions', '.user', 'user_default', 'mpfb', 'data')
MPFB_SYS = os.path.join(SCRATCH, 'realism', 'characters', 'bl_user', 'extensions', 'user_default', 'mpfb', 'data')
TEX = os.path.join(SCRATCH, 'realism', 'pbr-hdri')


def log(*a):
    print('[pipe]', *a, flush=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return argv


def clean_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def activate(o, select_only=True):
    if select_only:
        for x in bpy.context.view_layer.objects:
            x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


def new_obj(name, me, coll=None):
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def mesh_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def dominant_bone(o):
    """per-vertex name of the vertex group with max weight (deform groups only)."""
    names = {g.index: g.name for g in o.vertex_groups}
    out = []
    for v in o.data.vertices:
        best, bw = None, 0.0
        for g in v.groups:
            n = names.get(g.group, '')
            if n.startswith(('joint-', 'helper', 'body', 'HelperGeometry', 'delete_')):
                continue
            if g.weight > bw:
                best, bw = n, g.weight
        out.append(best)
    return out


def mat_principled(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, image=None, normal=None, uv='UVMap'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def save_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
