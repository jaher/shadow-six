import bpy, bmesh, math, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + '/../scripts')
import dz, kit_export as KE, lodfix
n = sys.argv[-1]
sc = json.load(open(f'out/{n}/{n}.kit.json')); nodes = set(sc['nodes'])
parts = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in nodes and 'kit_node' in o]
def cnt(o, delim, colthr=None, uvkeep=None):
    bm = bmesh.new(); bm.from_mesh(o.data)
    if uvkeep is not None:
        other = [k for k in bm.loops.layers.uv.keys() if k != uvkeep]
        for k in other: bm.loops.layers.uv.remove(bm.loops.layers.uv[k])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(6), verts=bm.verts, edges=bm.edges, delimit=delim)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    t = len(bm.faces); bm.free(); return t
rows = []
for o in parts:
    if o.get('kit_node', 'main') == 'decals': continue
    sz = KE.part_size(o)
    if sz < 1.2: continue
    t0 = lodfix._tris_me(o.data)
    rows.append((t0, o.name, round(sz, 1), cnt(o, {'MATERIAL'}), cnt(o, {'MATERIAL', 'UV'}), cnt(o, {'MATERIAL', 'UV'}, uvkeep='UVMap'), cnt(o, {'MATERIAL', 'UV'}, uvkeep='AO')))
rows.sort(reverse=True)
for r in rows[:30]: print('DG', r)
print('DGSUM', [sum(r[i] for r in rows) for i in (0, 3, 4, 5, 6)])
