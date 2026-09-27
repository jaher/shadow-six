"""credits.py: merge per-asset *.credits.json into out/credits_naval.json (CC0 library textures + own procedural geometry)."""
import json, glob, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
allc = {'geometry': 'procedural Blender scripts (own work, CC0) - vehicles/naval/scripts', 'assets': {}, 'textures': {}}
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.credits.json'))):
    c = json.load(open(f))
    allc['assets'][c['asset']] = sorted(c['textures'])
    allc['textures'].update(c['textures'])
json.dump(allc, open(os.path.join(OUT, 'credits_naval.json'), 'w'), indent=1)
lic = {v.get('license', v.get('licence', '?')) for v in allc['textures'].values()}
print(len(allc['assets']), 'assets;', len(allc['textures']), 'materials; licences:', lic)
