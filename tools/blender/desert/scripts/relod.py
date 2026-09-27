"""blender -b out/<n>/<n>.blend --python relod.py -- out/<n> [ratio1,min1,deg1 ratio2,min2,deg2]
Rebuild LOD1/LOD2 GLBs from a finalized .blend with lodfix.build_lod_v2 (no re-modelling, no re-bake)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import dz
import kit_export as KE
import lodfix

argv = sys.argv[sys.argv.index('--') + 1:]
outdir = argv[0]
name = os.path.basename(outdir.rstrip('/'))
lods = [(0.4, 0.3, 4.0), (0.12, 1.2, 6.0)]
if len(argv) > 2:
    lods = [tuple(float(x) for x in a.split(',')) for a in argv[1:3]]
sp = os.path.join(outdir, name + '.kit.json')
sc = json.load(open(sp))
nodes = set(sc['nodes'])
parts = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in nodes and 'kit_node' in o]
import glb_post
ao = os.path.join(outdir, name + '_ao.png')
for lvl in (1, 2):
    r, ms, dd = lods[lvl - 1]
    objs = lodfix.build_lod_v2(lvl, parts, r, ms, dd)
    fn = '%s_lod%d.glb' % (name, lvl)
    p = os.path.join(outdir, fn)
    KE.export_glb(p, objs)
    glb_post.rewrite(p, ao_png=ao if os.path.exists(ao) else None, lib_res='1k')
    dz.colors_to_ubyte(p)
    dz.quantize_glb(p)
    from albedo_floor import albedo_floor
    from vcol_floor import vcol_floor
    albedo_floor(p, 0.045)
    vcol_floor(p, 0.03)
    t = KE.tris(objs)
    for l in sc['lods']:
        if l['file'] == fn:
            l['tris'] = t
            l['bytes'] = os.path.getsize(p)
    for o in objs:
        bpy.data.objects.remove(o)
json.dump(sc, open(sp, 'w'), indent=1)
print('RELOD', name, [(l['file'], l['tris']) for l in sc['lods']])
