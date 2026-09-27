# bake.py - budget pass: hidden-face culling, decimation, atlas UVs, Cycles bake (albedo*AO, normal, roughness), LODs.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from common import *
import geo
from shell import decimate


def strip_helpers(human):
    """remove MakeHuman helper geometry (tights/skirt/hair helpers, joint cubes) for good"""
    gi = human.vertex_groups['body'].index
    bm = bmesh.new(); bm.from_mesh(human.data)
    dl = bm.verts.layers.deform.active
    kill = [v for v in bm.verts if v[dl].get(gi, 0.0) < 0.5]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(human.data); bm.free()
    for md in list(human.modifiers):
        if md.type == 'MASK':
            human.modifiers.remove(md)


def cull_hidden(obj, covers, dist=0.05, min_hits=1):
    """delete faces of obj whose outward normal ray hits one of `covers` within dist (hair/scalp under a helmet)."""
    if not covers:
        return 0
    tree = geo.bvh_of(covers)
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.normal_update()
    kill = []
    for f in bm.faces:
        c = f.calc_center_median(); n = f.normal
        hits = 0
        for d in (n, (n + Vector((0, 0, 0.6))).normalized(), (n + Vector((0.4, 0, 0))).normalized(), (n - Vector((0.4, 0, 0))).normalized()):
            h = tree.ray_cast(c + d * 0.001, d, dist)[0]
            hits += h is not None
        if hits >= 4:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data); bm.free()
    return len(kill)


def join(objs, name):
    objs = [o for o in objs if o and o.type == 'MESH']
    for o in objs:
        activate(o)
        for md in list(o.modifiers):
            if md.type not in ('ARMATURE',):
                bpy.ops.object.modifier_apply(modifier=md.name)
    activate(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = name
    return j


def atlas_uv(obj, head_boost=2.2, margin=0.003):
    """'atlas' UV: skin faces keep the MakeHuman layout (islands), everything else smart-projected; texel density
    equalised then the face/hands boosted; islands packed."""
    me = obj.data
    if 'UVMap' not in me.uv_layers:
        me.uv_layers.new(name='UVMap')
    src = me.uv_layers['UVMap']
    at = me.uv_layers.get('atlas') or me.uv_layers.new(name='atlas')
    me.uv_layers.active = at
    at.active_render = False
    src.active_render = True
    for i, l in enumerate(src.data):
        at.data[i].uv = l.uv
    kinds = [(m.get('kind', '') if m else '') for m in me.materials]
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    for f in bm.faces:
        f.select = kinds[f.material_index] != 'skin'
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    # boost skin of the head (faces) and hands: scale their UVs about each island's centre
    bm = bmesh.from_edit_mesh(me)
    uvl = bm.loops.layers.uv['atlas']
    for f in bm.faces:
        f.select = kinds[f.material_index] == 'skin' and f.calc_center_median().z > obj.get('neck_z', 1.4)
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.select_all(action='DESELECT')
    bpy.ops.uv.select_linked() if False else None
    sel = [f for f in bm.faces if f.select]
    if sel:
        us = [l[uvl].uv for f in sel for l in f.loops]
        cx = sum(u.x for u in us) / len(us); cy = sum(u.y for u in us) / len(us)
        for f in sel:
            for l in f.loops:
                l[uvl].uv = Vector((cx, cy)) + (l[uvl].uv - Vector((cx, cy))) * head_boost
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def _img(name, size, color=(0, 0, 0, 1), noncolor=False):
    im = bpy.data.images.get(name) or bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    im.generated_color = color
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


def _target(obj, im):
    for m in obj.data.materials:
        nt = m.node_tree
        n = nt.nodes.get('__bake') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake'; n.image = im
        for x in nt.nodes:
            x.select = False
        n.select = True; nt.nodes.active = n


def bake_atlas(obj, out_dir, tag, size=2048, out_size=1024, samples_ao=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'; prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        sc.cycles.device = 'GPU'
    except Exception as e:
        log('cycles GPU unavailable', e)
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    activate(obj)
    res = {}
    for pass_, kw, cs in (('DIFFUSE', dict(pass_filter={'COLOR'}), False), ('NORMAL', {}, True), ('ROUGHNESS', {}, True), ('AO', {}, True)):
        im = _img(f'{tag}_{pass_}', size, noncolor=cs)
        _target(obj, im)
        sc.cycles.samples = samples_ao if pass_ == 'AO' else 1
        bpy.ops.object.bake(type=pass_, use_clear=True, margin=6, **kw)
        res[pass_] = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
        log('baked', pass_)
    alb = res['DIFFUSE'][..., :3]
    ao = res['AO'][..., :1]
    ao = 0.55 + 0.45 * ao                        # soft AO baked into albedo (folds, under belts)
    alb = alb * ao
    rough = res['ROUGHNESS'][..., :1]
    orm = np.concatenate([ao, rough, np.zeros_like(rough)], axis=2)

    def save(arr, name, noncolor, fmt='JPEG', osz=None):
        a = np.concatenate([np.clip(arr, 0, 1), np.ones(arr.shape[:2] + (1,), np.float32)], axis=2)
        im = bpy.data.images.new(name, size, size, alpha=False)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        im.pixels[:] = a.ravel()
        im.scale(osz or out_size, osz or out_size)
        path = os.path.join(out_dir, name + ('.jpg' if fmt == 'JPEG' else '.png'))
        im.filepath_raw = path; im.file_format = fmt
        sc.render.image_settings.quality = 88
        im.save()
        return im
    A = save(alb, f'{tag}_albedo', False)
    N = save(res['NORMAL'][..., :3], f'{tag}_normal', True)
    O = save(orm, f'{tag}_orm', True, osz=max(256, out_size // 2))
    return A, N, O


def atlas_material(name, A, N, O, uv='atlas'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    def tex(im, loc):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = im; n.location = loc
        u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uv; u.location = (loc[0] - 200, loc[1])
        nt.links.new(u.outputs['UV'], n.inputs['Vector'])
        return n
    a = tex(A, (-600, 300)); nt.links.new(a.outputs['Color'], p.inputs['Base Color'])
    o = tex(O, (-600, 0))
    sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], p.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], p.inputs['Metallic'])
    n = tex(N, (-600, -300))
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = uv
    nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m


def material_class_mask(obj):
    """per-vertex '_mask' (x = skin, y = cloth) for the runtime close-zoom shading (wrap/SSS on skin, sheen on cloth)"""
    me = obj.data
    kinds = [(m.get('kind', '') if m else '') for m in me.materials]
    sk = [0.0] * len(me.vertices); cl = [0.0] * len(me.vertices)
    for p in me.polygons:
        k = kinds[p.material_index]
        for vi in p.vertices:
            if k == 'skin':
                sk[vi] = 1.0
            elif k == 'cloth':
                cl[vi] = 1.0
    at = me.attributes.get('_mask') or me.attributes.new('_mask', 'FLOAT_VECTOR', 'POINT')
    for i in range(len(me.vertices)):
        at.data[i].vector = (sk[i], cl[i], 0.0)


def finalize_atlas_mesh(obj, mat):
    material_class_mask(obj)
    me = obj.data
    me.materials.clear(); me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    for n in [uv.name for uv in me.uv_layers if uv.name != 'atlas']:
        me.uv_layers.remove(me.uv_layers[n])
    me.uv_layers['atlas'].name = 'UVMap'
    for n in [ca.name for ca in me.color_attributes]:
        me.color_attributes.remove(me.color_attributes[n])


def make_lod(obj, name, tris, protect_head=True):
    me = obj.data.copy()
    o = new_obj(name, me)
    o.parent = obj.parent
    for md in obj.modifiers:
        if md.type == 'ARMATURE':
            am = o.modifiers.new('Armature', 'ARMATURE'); am.object = md.object
    for g in obj.vertex_groups:
        o.vertex_groups.new(name=g.name)
    decimate(o, tris)
    return o
