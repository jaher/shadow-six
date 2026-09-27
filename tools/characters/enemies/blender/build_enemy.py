# build_enemy.py - German enemy spec JSON -> <out>/<id>.glb (UAL skeleton, atlas, LOD0/1/2) + <id>.report.json + <id>.json sidecar
# = pipeline/blender/build_char.py + enemy hooks (enemy_mat: cloth tint/wear, helmet wear, complexion; enemy_outfits:
#   greatcoat/general_coat; enemy_kit: NCO/officer/MG/engineer/crew kit; enemy_headgear: cords/goggles).
# usage: ../pipeline/tools/bl.sh blender/build_enemy.py specs/<id>.json <out_dir>
import sys, os, time, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'pipeline', 'blender'))
sys.path.insert(1, HERE)
from common import *
import body, measure, shell, outfits, kit, headgear, skin, bake, geo
import enemy_mat, enemy_outfits, enemy_kit, enemy_headgear
import numpy as np

a = args()
spec = json.load(open(a[0])); out_dir = os.path.abspath(a[1]); preview_on = '--preview' in a
os.makedirs(out_dir, exist_ok=True)
cid = spec['id']
BUDGET = spec.get('budget', {'lod0': 12000, 'lod1': 5000, 'lod2': 2000})
T0 = time.time()
clean_scene()
enemy_mat.install(spec)
h = body.calibrated_body(spec)
human, rig, parts = body.finalize_body(h, spec)
enemy_mat.iris(parts, spec)
m, dom = measure.measure(human, rig, parts)
ctx = shell.BodyCtx(human, rig, dom, m)
skin.masks(ctx, parts)
skin.tweak_skin_material(human, spec)
enemy_mat.complexion(human, spec, m)
if spec['outfit'] in enemy_outfits.EXT:
    garments = enemy_outfits.build_outfit(ctx, spec['outfit'], spec.get('outfit_opts', {}))
else:
    garments = outfits.build_outfit(ctx, spec['outfit'], spec.get('outfit_opts', {}))
kit_objs = kit.build_kit(ctx, garments, spec)
if spec['outfit'] in ('greatcoat', 'general_coat'):
    kit_objs += enemy_kit.coat_details(ctx, garments, spec, collar_col=(0.22, 0.28, 0.21) if spec['outfit'] == 'greatcoat' else (0.36, 0.37, 0.35))
kit_objs += enemy_kit.build_extra(ctx, garments, spec)
kit_objs = enemy_kit.fix_collar_tabs(ctx, garments, kit_objs, spec)
enemy_kit.fix_buckles(ctx, kit_objs)
if spec['outfit'] == 'officer_heer':
    _nz = m['neck_base_z']
    enemy_kit.trim_covered(garments, margin=0.045, keep_box=((-0.11, 0.11), (-1.0, 1.0), (_nz - 0.24, _nz + 0.12)))
enemy_kit.smooth_hems(garments)
enemy_kit.snap_islands(ctx, kit_objs, garments)
enemy_kit.rigidify_islands(ctx, kit_objs, garments)
hair = skin.hair_cap(ctx, spec)
import enemy_face
fhair = enemy_face.facial_hair(ctx, spec)
if fhair:
    kit_objs.append(fhair)
if spec.get('glasses'):
    kit_objs.append(kit.glasses(ctx))
if hair:
    parts['hair'] = hair        # headgear fit clears the hair as well as the scalp
hg, fit_rep = headgear.build_headgear(ctx, parts, spec)
fit_rep = enemy_headgear.extras(ctx, parts, hg, spec, fit_rep) if hg else fit_rep
if hg:
    fit_rep = dict(fit_rep); fit_rep['hair_clamped'] = enemy_headgear.clamp_hair(ctx, parts, hg)
shell.delete_covered(ctx)
bake.strip_helpers(human)
log('stage geometry', round(time.time() - T0, 1), 's')

# ---------------- budget ----------------
opaque = [human] + garments + kit_objs + [o for o in (hair, parts.get('eyes')) if o]
alpha = [o for o in (parts.get('brows'), parts.get('lashes') if spec.get('lashes_mesh') else None) if o]
if parts.get('lashes') and not spec.get('lashes_mesh'):
    bpy.data.objects.remove(parts['lashes'], do_unlink=True)
rest = sum(tri_count(o) for o in opaque[1:]) + sum(tri_count(o) for o in alpha) + (tri_count(hg) if hg else 0)
over = rest - (BUDGET['lod0'] - 3800 - 150)
if over > 0:   # layered outfits (smock over tunic, shirt under tunic, gloves): thin the biggest garments, not the body
    big = sorted([o for o in garments if tri_count(o) > 900], key=tri_count, reverse=True)
    tot = sum(tri_count(o) for o in big)
    for o in big:
        shell.decimate(o, int(tri_count(o) * max(0.45, 1 - over / max(1, tot))))
    rest = sum(tri_count(o) for o in opaque[1:]) + sum(tri_count(o) for o in alpha) + (tri_count(hg) if hg else 0)
    log(f'budget: garments thinned by {over} tris -> rest {rest}')
body_target = max(3800, BUDGET['lod0'] - rest - 150)
b0 = tri_count(human)
if b0 > body_target:
    shell.decimate(human, body_target)
log(f'budget: body {b0} -> {tri_count(human)}, rest {rest}')
parts_tris = {o.name: tri_count(o) for o in opaque + alpha + ([hg] if hg else [])}

# ---------------- join + atlas ----------------
if hg:
    g = hg.vertex_groups.new(name='is_hg'); g.add(list(range(len(hg.data.vertices))), 1.0, 'REPLACE')
main_objs = opaque + ([hg] if hg else [])
lod0 = bake.join(main_objs, 'LOD0')
lod0['neck_z'] = m['neck_base_z']
bake.atlas_uv(lod0)
# headgear goes back to its own mesh (hideable: dead bodies, disguises) but shares the atlas
A, N, O = bake.bake_atlas(lod0, out_dir, cid, size=spec.get('bake_size', 2048), out_size=spec.get('atlas_size', 1024))
amat = bake.atlas_material(cid + '_atlas', A, N, O)
bake.finalize_atlas_mesh(lod0, amat)
if hg:   # headgear back to its own mesh (hideable: dead bodies, disguises) but sharing the atlas material
    activate(lod0)
    gi = lod0.vertex_groups['is_hg'].index
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in lod0.data.vertices:
        v.select = any(g.group == gi and g.weight > 0.5 for g in v.groups)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    hg = [o for o in bpy.context.selected_objects if o is not lod0][0]
    hg.name = 'headgear'
    for o in (lod0, hg):
        o.vertex_groups.remove(o.vertex_groups['is_hg'])
log('stage atlas', round(time.time() - T0, 1), 's')

# ---------------- alpha parts (brows, lashes): small combined RGBA atlas ----------------
if alpha:
    ims = []
    for o in alpha:
        mt = o.data.materials[0]
        im = next((n.image for n in mt.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'diffuse' in n.image.name.lower()), None)
        im = im or next((n.image for n in mt.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
        ims.append(im)
    S = 256
    canvas = np.zeros((S, S * len(alpha), 4), np.float32)
    for k, (o, im) in enumerate(zip(alpha, ims)):
        im.scale(S, S)
        px = np.array(im.pixels[:], np.float32).reshape(S, S, 4)
        if o is parts.get('brows'):
            col = np.array(lin_c := [c ** 2.2 for c in spec.get('brows', {}).get('color', (0.12, 0.09, 0.06))], np.float32)
            px[..., :3] = col
        canvas[:, k * S:(k + 1) * S] = px
        uv = o.data.uv_layers.active
        for l in uv.data:
            l.uv = ((l.uv.x % 1.0 + k) / len(alpha), l.uv.y)
    ai = bpy.data.images.new(cid + '_alpha', S * len(alpha), S, alpha=True)
    ai.pixels[:] = canvas.ravel()
    ai.filepath_raw = os.path.join(out_dir, cid + '_alpha.png'); ai.file_format = 'PNG'; ai.save()
    am = bpy.data.materials.new(cid + '_alpha')
    am.use_nodes = True
    nt = am.node_tree; p = nt.nodes['Principled BSDF']
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = ai
    nt.links.new(tx.outputs['Color'], p.inputs['Base Color']); nt.links.new(tx.outputs['Alpha'], p.inputs['Alpha'])
    p.inputs['Roughness'].default_value = 0.8
    am.blend_method = 'CLIP'; am.alpha_threshold = 0.4
    for o in alpha:
        o.data.materials.clear(); o.data.materials.append(am)
    lod0a = bake.join(alpha, 'LOD0_alpha')
    for n in [uv.name for uv in lod0a.data.uv_layers][1:]:
        lod0a.data.uv_layers.remove(lod0a.data.uv_layers[n])

# ---------------- LODs ----------------
lod1 = bake.make_lod(lod0, 'LOD1', BUDGET['lod1'])
lod2 = bake.make_lod(lod0, 'LOD2', BUDGET['lod2'])
tris = {o.name: tri_count(o) for o in bpy.data.objects if o.type == 'MESH'}
log('LOD tris', tris)

# ---------------- report + export + rebind ----------------
report = {'id': cid, 'height_m': m['height'], 'tris': tris, 'parts_tris_before_join': parts_tris, 'headgear_fit': fit_rep,
          'measure': {k: m[k] for k in ('height', 'crotch_z', 'belt_z', 'knee_z', 'brow_top_z', 'eye_top_z', 'crown_z', 'neck_base_z')},
          'spec': spec, 'build_s': round(time.time() - T0, 1)}
save_json(os.path.join(out_dir, cid + '.report.json'), report)
extras = {'id': cid, 'heightM': m['height'], 'headgear': fit_rep, 'lods': ['LOD0', 'LOD1', 'LOD2'], 'parts': ['LOD0', 'LOD0_alpha', 'LOD1', 'LOD2', 'headgear'],
          'eyeL': m['eye_l'], 'eyeR': m['eye_r'], 'browZ': m['brow_top_z'], 'beltZ': m['belt_z'],
          'enemy': spec.get('enemy', {}), 'weapon': spec.get('weapon', {}), 'kit': spec.get('kit', []), 'outfit': spec['outfit']}
save_json(os.path.join(out_dir, cid + '.extras.json'), extras)
if '--keep-blend' in a:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, cid + '.blend'))
import export_raw
raw = os.path.join(out_dir, cid + '.raw.glb')
export_raw.export_raw(raw)
r = subprocess.run(['python3', os.path.join(HERE, '..', '..', 'pipeline', 'tools', 'rebind.py'), raw, os.path.join(out_dir, cid + '.glb'),
                    '--extras', os.path.join(out_dir, cid + '.extras.json')], capture_output=True, text=True)
log('rebind:', r.stdout.strip(), r.stderr.strip()[-500:])
log('DONE', cid, round(time.time() - T0, 1), 's')
