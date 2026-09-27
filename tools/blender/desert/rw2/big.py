import bpy, json, sys
sys.path.insert(0, 'scripts')
import dz, kit_export as KE
n = sys.argv[-1]
sc = json.load(open(f'out/{n}/{n}.kit.json')); nodes = set(sc['nodes'])
for o in bpy.data.objects:
    if o.type == 'MESH' and o.name not in nodes and 'kit_node' in o:
        s = KE.part_size(o)
        if s > float(sys.argv[-2]):
            print('PP', o.name, round(s, 1), o.get('kit_node'), o.get('kit_lod'), len(o.data.polygons), [m.name for m in o.data.materials][:2])
