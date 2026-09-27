# lod.py - LOD chain from a finished asset .blend: Decimate(collapse) keeping UV seams/sharp edges, same atlas.
# blender -b out/X/X.blend -P lod.py -- out_prefix ratio1 ratio2 ...
import sys, os, bpy, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blib as B
argv = sys.argv[sys.argv.index('--') + 1:]
prefix, ratios = argv[0], [float(r) for r in argv[1:]]
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.name.startswith('scorch')]
base = {o.name: o.data.copy() for o in meshes}
for i, r in enumerate(ratios, 1):
    t = time.time()
    for o in meshes:
        o.data = base[o.name].copy()
        m = o.modifiers.new('Dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = r
        m.use_collapse_triangulate = True; m.delimit = {'UV', 'SHARP'}
    tot = sum(B.tris(o) for o in meshes if o.data.users)
    path = f'{prefix}_lod{i}.glb'
    B.export_glb(path, [o for o in bpy.context.scene.objects if o.type == 'MESH'])
    B.log('LOD%d ratio %.2f -> %d tris (all objects, instanced wheels counted once per object) %.1fs' % (i, r, tot, time.time() - t))
    for o in meshes:
        o.modifiers.clear()
