# dog_bake.py - coat albedo bake (vertex colour x directional fur noise) into a 512 atlas, LOD1/2, GLB export + sidecar.
import bpy, os, math
from common import *


def activate(o, select_only=True):   # scene-object based (view_layer iteration can hold stale None after clean_scene)
    for x in bpy.context.scene.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


def _fur_material(dog):
    m = bpy.data.materials.new('dog_bake'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'coat'
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (220, 70, 220)   # fur strands run along the body (Y)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 6
    nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.72; mr.inputs['To Max'].default_value = 1.18
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    nt.links.new(vc.outputs['Color'], mul.inputs['A']); nt.links.new(mr.outputs[0], mul.inputs['B'])
    nt.links.new(mul.outputs['Result'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
    img = bpy.data.images.new('dog_albedo', 512, 512)
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; nt.nodes.active = tx
    return m, img


def bake(dog, out_dir, did, seed):
    activate(dog)
    dog.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')
    m, img = _fur_material(dog)
    dog.data.materials.clear(); dog.data.materials.append(m)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'; prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        log('cycles GPU unavailable', e)
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=6)
    img.filepath_raw = os.path.join(out_dir, did + '_albedo.png'); img.file_format = 'PNG'; img.save()
    fm = bpy.data.materials.new(did + '_coat'); fm.use_nodes = True
    p = fm.node_tree.nodes['Principled BSDF']
    t = fm.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
    fm.node_tree.links.new(t.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.82
    try:
        p.inputs['Sheen Weight'].default_value = 0.4; p.inputs['Sheen Roughness'].default_value = 0.5
    except Exception:
        pass
    dog.data.materials.clear(); dog.data.materials.append(fm)
    dog.data.color_attributes.remove(dog.data.color_attributes['coat'])
    log('baked coat', did)


def make_lod(src, name, target):
    me = src.data.copy(); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.parent = src.parent
    for md in src.modifiers:
        if md.type == 'ARMATURE':
            a = o.modifiers.new('Armature', 'ARMATURE'); a.object = md.object
    activate(o)
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = target / max(1, tri_count(o))
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    bpy.ops.object.modifier_apply(modifier='dec')
    return o


def export(dog, rig, out_dir, did, meta, var, size):
    dog.name = 'LOD0'
    l1 = make_lod(dog, 'LOD1', 1600); l2 = make_lod(dog, 'LOD2', 600)
    rig.scale = (size, size, size)
    tris = {o.name: tri_count(o) for o in (dog, l1, l2)}
    for o in bpy.data.objects:
        o.select_set(o in (dog, l1, l2, rig))
    path = os.path.join(out_dir, did + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
        export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_range=False, export_skins=True, export_yup=True,
        export_image_format='JPEG', export_jpeg_quality=86, export_texcoords=True, export_normals=True, export_def_bones=False,
        export_extras=True, export_optimize_animation_size=True)
    sc = {'id': did, 'kind': 'dog', 'glb': did + '.glb', 'bytes': os.path.getsize(path), 'tris': tris, 'materials': 1,
          'lods': ['LOD0', 'LOD1', 'LOD2'], 'lod_rule': 'LOD0 >= 60 px/m, LOD1 >= 28 px/m, else LOD2',
          'skeleton': 'project dog rig (root, pelvis, spine, chest, neck, head, jaw, ear_l/r, tail1-3, upperarm/forearm/fpaw_l/r, thigh/shin/hpaw_l/r)',
          'clips': meta, 'variation': var, 'withers_m': round(0.62 * size, 3), 'mass_kg': round(34 * size ** 3, 1),
          'sockets': {'mouth': {'bone': 'jaw', 'pos': [0, -0.6, 0.72]}, 'collar': {'bone': 'neck', 'pos': [0, -0.3, 0.66]}},
          'licence': 'project-authored geometry, rig and clips (CC0)', 'notes': 'bible 6.5 Alsatian; spec 4.1 dog unit (bite 25 dmg/1.0 s; bark alerts)'}
    save_json(os.path.join(out_dir, did + '.sidecar.json'), sc)
    log('EXPORTED', path, sc['bytes'], tris)
