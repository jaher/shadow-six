"""Download + register new shared-library materials for the europe rework (merges into kit src/ + lib/)."""
import json, os, sys, urllib.request
KIT = '<claude-tmp>'
NEW = {
 'gravel_grey': ('gravel', {'label': 'Grey limestone gravel (cemetery / churchyard paths, grave infill)', 'tile_m': 2.0,
                  'target': [0.53, 0.52, 0.5], 'col': 0.25, 'lum': 1.05, 'rough': 0.95, 'grime': 0.3}),
}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 shadow-six-kit'}), timeout=90).read()
cr = json.load(open(KIT + '/src/credits_raw.json'))
for mid, (pid, cfg) in NEW.items():
    d = os.path.join(KIT, 'src/raw', mid); os.makedirs(d, exist_ok=True)
    info = json.loads(get('https://api.polyhaven.com/info/' + pid)); files = json.loads(get('https://api.polyhaven.com/files/' + pid))
    for k, key in {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough', 'ao': 'AO'}.items():
        if key in files and not os.path.exists(os.path.join(d, k + '.jpg')):
            open(os.path.join(d, k + '.jpg'), 'wb').write(get(files[key]['2k']['jpg']['url']))
    cr[mid] = {'source': 'Poly Haven', 'id': pid, 'url': 'https://polyhaven.com/a/' + pid, 'authors': list(info.get('authors', {}).keys()),
               'license': 'CC0-1.0', 'dimensions_mm': info.get('dimensions', [2000, 2000]), 'name': info.get('name')}
    print(mid, sorted(os.listdir(d)), cr[mid]['dimensions_mm'], flush=True)
json.dump(cr, open(KIT + '/src/credits_raw.json', 'w'), indent=1)
for fn, upd in (('sources.json', {m: {'ph': p} for m, (p, c) in NEW.items()}), ('lib_config.json', {m: c for m, (p, c) in NEW.items()})):
    j = json.load(open(KIT + '/src/' + fn)); j.update(upd); json.dump(j, open(KIT + '/src/' + fn, 'w'), indent=1)
print('OK')
