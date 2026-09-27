# islnear.py <glb> <objsubstr> x y z r : islands (merged by position) of that object with centroid within r of (x,y,z) (Blender coords):
# gap to the rest of the object's surface + which island is nearest
import bpy, sys, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]; p, sub = a[0], a[1]; P = Vector(tuple(map(float, a[2:5]))); R = float(a[5])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=p)
o = [x for x in bpy.context.scene.objects if x.type == 'MESH' and sub in x.name][0]
bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(o.matrix_world); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5); bm.faces.ensure_lookup_table()
lab = {}; isl = []
for f0 in bm.faces:
    if f0.index in lab: continue
    st = [f0]; k = len(isl); comp = []; lab[f0.index] = k
    while st:
        f = st.pop(); comp.append(f)
        for e in f.edges:
            for g in e.link_faces:
                if g.index not in lab: lab[g.index] = k; st.append(g)
    isl.append(comp)
print('OBJ', o.name, 'islands', len(isl))
for k, comp in enumerate(isl):
    vs = {v for f in comp for v in f.verts}; c = sum((v.co for v in vs), Vector()) / len(vs)
    if (c - P).length > R: continue
    tb = bmesh.new(); vm = {}
    owner = []
    for f in bm.faces:
        if lab[f.index] == k: continue
        for v in f.verts:
            if v not in vm: vm[v] = tb.verts.new(v.co)
        try: tb.faces.new([vm[v] for v in f.verts]); owner.append(lab[f.index])
        except ValueError: pass
    tree = BVHTree.FromBMesh(tb)
    best = min(((tree.find_nearest(v.co)[3], tree.find_nearest(v.co)[2]) for v in vs), key=lambda t: t[0])
    oi = owner[best[1]] if best[1] is not None and best[1] < len(owner) else -1
    ov = {v for f in isl[oi] for v in f.verts} if oi >= 0 else set()
    print(f'isl{k} nv={len(vs)} c=({c.x:.3f},{c.y:.3f},{c.z:.3f}) gap={best[0]*1000:.1f}mm nearest_isl={oi} (nv={len(ov)})')
    tb.free()
# ray from P backwards (+y, into the body): successive hits with island ids and sizes
tree = BVHTree.FromBMesh(bm); o0 = P.copy(); d = Vector((0, 1, 0)); t = 0
for _ in range(8):
    loc, n, fi, dist = tree.ray_cast(o0, d, 0.3)
    if loc is None: break
    k = lab[fi]; t += dist
    print(f'  hit y={loc.y:.4f} isl{k} (nf={len(isl[k])}) n=({n.x:.2f},{n.y:.2f},{n.z:.2f})')
    o0 = loc + d * 1e-4
