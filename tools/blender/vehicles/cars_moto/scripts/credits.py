"""credits.py: merge out/*/*.credits.json into out/credits_cars_moto.json (per-asset + group texture credits)."""
import json, glob, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
assets, tex = [], {}
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.credits.json'))):
    if '/smoke/' in f:
        continue
    c = json.load(open(f))
    assets.append(c['asset'])
    for k, v in c['textures'].items():
        tex.setdefault(k.replace('kit:', ''), v)
d = {'group': 'cars_moto', 'assets': assets,
     'geometry': 'procedural Blender 4.2 scripts (own work, CC0-1.0): vehicles/cars_moto/scripts/*.py (veh.py helper)',
     'textures': tex,
     'new_library_materials': {
         'veh_paint': 'procedural, scripts/make_veh_tex.py (own work, CC0-1.0) - art/kit/lib (unchanged)',
         'veh_burnt': 'procedural, scripts/make_burnt_tex.py (own work, CC0-1.0) - art/kit/lib (no longer used by cars_moto)',
         'veh_tyre': 'procedural, scripts/make_cm_tex.py (own work, CC0-1.0) - vehicles/cars_moto/lib/veh_tyre_{diff,nor,arm}.jpg',
         'veh_paintc': 'procedural, scripts/make_paintc_tex.py (own work, CC0-1.0) - vehicles/cars_moto/lib/veh_paintc_{diff,nor,arm}.jpg (chip-free paint; replaces veh_paint in the GLBs)',
         'veh_wreck': 'procedural, scripts/make_cm_tex.py (own work, CC0-1.0) - vehicles/cars_moto/lib/veh_wreck_{diff,nor,arm}.jpg'},
     'note': 'GLBs reference kit lib textures (../../../../art/kit/lib/1k) and group textures (../../lib) by relative URI; '
             'on consolidation copy vehicles/cars_moto/lib/*.jpg next to the kit lib and merge lib/materials_add.json.'}
json.dump(d, open(os.path.join(OUT, 'credits_cars_moto.json'), 'w'), indent=1)
print(len(assets), 'assets,', len(tex), 'texture entries')
