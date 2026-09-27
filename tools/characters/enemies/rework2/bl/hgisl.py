# hgisl.py <glb>...: headgear islands, material, centroid, gap to the rest of the headgear (BVH), inside-ness
import bpy, sys, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
for p in sys.argv[sys.argv.index('--') + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=p)
    hg = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'headgear' in o.name.lower()]
    h = hg[0]; bm = bmesh.new(); bm.from_mesh(h.data); bm.transform(h.matrix_world); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    seen = set(); isl = []
    for f0 in bm.faces:
        if f0.index in seen: continue
        st = [f0]; comp = []; seen.add(f0.index)
        while st:
            f = st.pop(); comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); st.append(g)
        isl.append(comp)
    isl.sort(key=len, reverse=True)
    mats = [m.name for m in h.data.materials]
    print('FILE', p.split('/')[-1], 'islands', len(isl), 'mats', mats)
    for k, comp in enumerate(isl[1:], 1):
        vs = {v for f in comp for v in f.verts}
        rest = bmesh.new()
        others = [f for c in isl if c is not comp for f in c]
        vmap = {}
        for f in others:
            for v in f.verts:
                if v not in vmap: vmap[v] = rest.verts.new(v.co)
            try: rest.faces.new([vmap[v] for v in f.verts])
            except ValueError: pass
        tree = BVHTree.FromBMesh(rest)
        dmin = min(tree.find_nearest(v.co)[3] for v in vs)
        c = sum((v.co for v in vs), Vector()) / len(vs)
        mi = comp[0].material_index
        lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs))); hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
        print(f'  isl{k} nv={len(vs)} c=({c.x:.3f},{c.y:.3f},{c.z:.3f}) size=({(hi-lo).x*1000:.0f},{(hi-lo).y*1000:.0f},{(hi-lo).z*1000:.0f})mm gap={dmin*1000:.1f}mm')
        rest.free()
        if k > 30: break
