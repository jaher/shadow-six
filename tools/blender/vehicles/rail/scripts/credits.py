"""credits.py: merge per-asset *.credits.json into out/credits_rail.json (CC0 library textures + own procedural geometry)."""
import json, glob, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
allc = {'geometry': 'procedural Blender scripts (own work, CC0) - vehicles/rail/scripts', 'assets': {}, 'textures': {}}
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.credits.json'))):
    c = json.load(open(f))
    allc['assets'][c['asset']] = sorted(c['textures'])
    allc['textures'].update(c['textures'])
LIB = json.load(open(os.path.join(OUT, '..', 'lib', 'materials_add.json')))['materials']
for k, e in LIB.items():                                   # group textures (vehicles/rail/lib, applied by rail.post_rail)
    allc['textures']['rail:' + k] = dict(e['source'], label=e['label'], files=e['maps'])
for f in sorted(glob.glob(os.path.join(OUT, '*', '*.kit.json'))):
    m = json.load(open(f))
    used = set()
    for lod in m['lods'][:1]:
        import struct
        b = open(os.path.join(os.path.dirname(f), lod['file']), 'rb').read()
        js = json.loads(b[20:20 + struct.unpack('<I', b[12:16])[0]])
        used |= {mt['name'] for mt in js.get('materials', []) if mt['name'].startswith('rail:')}
    a = m['asset']
    if a in allc['assets']:
        allc['assets'][a] = sorted(set(allc['assets'][a]) | used)
json.dump(allc, open(os.path.join(OUT, 'credits_rail.json'), 'w'), indent=1)
lic = {v.get('license', v.get('licence', '?')) for v in allc['textures'].values()}
print(len(allc['assets']), 'assets;', len(allc['textures']), 'materials; licences:', lic)
