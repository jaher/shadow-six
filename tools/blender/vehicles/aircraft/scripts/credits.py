"""credits.py: merge out/*/*.credits.json into out/credits_aircraft.json (textures CC0 + geometry own work) and list
the reference images used (internal only, not shipped)."""
import json, glob, os
D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, '..', 'out')
tex, assets = {}, []
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.credits.json'))):
    c = json.load(open(f))
    assets.append(c['asset'])
    for k, v in c['textures'].items():
        tex.setdefault(k, v)
refs = json.load(open(os.path.join(D, '..', '..', 'refs', 'aircraft', 'refs.json')))
res = {'group': 'aircraft', 'geometry': 'procedural Blender scripts vehicles/aircraft/scripts (own work, CC0-1.0)',
       'new_library_materials': {m: 'procedural, own work, CC0-1.0 (scripts/make_air_tex.py)' for m in ('air_corr', 'air_fabric', 'air_skin')},
       'textures': tex, 'assets': assets,
       'references_internal_only': {k: v['page'] for k, v in refs.items()}}
json.dump(res, open(os.path.join(OUT, 'credits_aircraft.json'), 'w'), indent=1)
print(len(assets), 'assets', len(tex), 'materials')
