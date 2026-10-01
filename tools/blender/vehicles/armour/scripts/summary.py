import json, glob, os
R = os.path.join(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), *['..'] * 5)), 'tools/blender/vehicles/armour/out')
rows = []
for f in sorted(glob.glob(R + '/*/*.veh.json')):
    d = json.load(open(f)); n = d['name']
    L = {l['file']: (l['tris'], round(l['bytes'] / 1024)) for l in d['lods']}
    tex = sum(os.path.getsize(p) for p in glob.glob(os.path.dirname(f) + '/tex/*')) // 1024
    rows.append(dict(name=n, lod_tris=[L[f'{n}_lod{i}.glb'][0] for i in range(3)], lod_kb=[L[f'{n}_lod{i}.glb'][1] for i in range(3)],
                     burnt_tris=L.get(f'{n}_burnt_lod0.glb', (None,))[0], tex_kb=tex, variants=list(d['variants']),
                     nodes=len(d['nodes']), sockets=len(d['sockets']), muzzles=len(d['muzzles'])))
for r in rows:
    print(json.dumps(r))
