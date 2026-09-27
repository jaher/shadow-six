# hgcol.py <glb>: per headgear island (merged by position) mean atlas colour at its face-corner UVs + mean normal
import bpy, sys, bmesh
from mathutils import Vector
p = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=p)
h = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'headgear' in o.name.lower()][0]
mat = h.data.materials[0]; imgs = [n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]; print('IMGS', [i.name for i in imgs]); img = imgs[0]
W, H = img.size; px = img.pixels[:]
print('IMG', img.name, W, H)
bm = bmesh.new(); bm.from_mesh(h.data); bm.transform(h.matrix_world)
uvl = bm.loops.layers.uv.active
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5); bm.faces.ensure_lookup_table()
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
for k, comp in enumerate(isl[:12]):
    cs = []; nz = Vector()
    for f in comp:
        nz += f.normal * f.calc_area()
        for l in f.loops:
            u, v = l[uvl].uv; x = min(W - 1, max(0, int(u * W))); y = min(H - 1, max(0, int(v * H))); i = (y * W + x) * 4
            cs.append(px[i:i + 3])
    m = [sum(c[i] for c in cs) / len(cs) for i in range(3)]
    mx = max(cs, key=lambda c: sum(c))
    c = sum((v.co for f in comp for v in f.verts), Vector()) / sum(len(f.verts) for f in comp)
    print(f'isl{k} nf={len(comp)} c=({c.x:.3f},{c.y:.3f},{c.z:.3f}) mean=({m[0]:.2f},{m[1]:.2f},{m[2]:.2f}) max=({mx[0]:.2f},{mx[1]:.2f},{mx[2]:.2f}) nrm=({nz.normalized().x:.2f},{nz.normalized().y:.2f},{nz.normalized().z:.2f})')
