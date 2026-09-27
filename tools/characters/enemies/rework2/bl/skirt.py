# skirt.py <glb>...: rays from outside at the helmet skirt (every 3 deg, 8 heights over the lower 4 cm, elev 0/-20/+20):
# count first hits that land on a BACK face (liner / inner shell seen from outside)
import bpy, sys, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
for p in sys.argv[sys.argv.index('--') + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=p)
    h = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'headgear' in o.name.lower()][0]
    bm = bmesh.new(); bm.from_mesh(h.data); bm.transform(h.matrix_world); bm.faces.ensure_lookup_table(); tree = BVHTree.FromBMesh(bm)
    xs = [v.co for v in bm.verts]; zmin = min(c.z for c in xs); cx = sum(c.x for c in xs) / len(xs); cy = sum(c.y for c in xs) / len(xs)
    top = max(bm.faces, key=lambda f: f.calc_center_median().z); sgn = 1 if top.normal.z > 0 else -1
    n = bad = 0; where = {}; hj = {}; rr = []
    for k in range(120):
        a = math.radians(3 * k); d0 = Vector((math.sin(a), -math.cos(a), 0))
        for j in range(1, 8):
            z = zmin + 0.005 * j
            for el in (0, 20):
                e = math.radians(el); d = Vector((d0.x * math.cos(e), d0.y * math.cos(e), math.sin(e)))
                o = Vector((cx, cy, z)) + d * 0.3
                loc, nrm, fi, dist = tree.ray_cast(o, -d, 0.6)
                if loc is None: continue
                n += 1
                if sgn * nrm.dot(d) < 0:
                    bad += 1; where[3 * k // 45 * 45] = where.get(3 * k // 45 * 45, 0) + 1
                    if 3 * k < 25 or 3 * k > 335: hj[(j, el)] = hj.get((j, el), 0) + 1; rr.append(round((loc - Vector((cx, cy, loc.z))).length, 3))
    print(f'SKIRT {p.split("/")[-1]} rays {n} backface_hits {bad} by_sector {where} front_by_(j,el) {hj} r {sorted(rr)[:3]}..{sorted(rr)[-3:]}')
