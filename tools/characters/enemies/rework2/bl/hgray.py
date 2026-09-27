# hgray.py <glb> y0 z0 z1 dz: rays from (0,y0,z) toward -y through the headgear; all hits (y) per z
import bpy, sys, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
h = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'headgear' in o.name.lower()][0]
bm = bmesh.new(); bm.from_mesh(h.data); bm.transform(h.matrix_world); tree = BVHTree.FromBMesh(bm)
y0, z0, z1, dz = map(float, a[1:5]); z = z0
zs = [v.co.z for v in bm.verts]; print('HG z range', round(min(zs), 3), round(max(zs), 3))
while z <= z1 + 1e-6:
    o = Vector((0, y0, z)); hits = []
    for _ in range(6):
        loc, n, fi, d = tree.ray_cast(o, Vector((0, -1, 0)), 0.4)
        if loc is None: break
        hits.append(f'{loc.y:.3f}({n.y:+.1f})'); o = loc + Vector((0, -1e-4, 0))
    print(f'z={z:.3f}', ' '.join(hits)); z += dz
