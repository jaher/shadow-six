"""Add Poly Haven CC0 textures to the shared kit lib (additive: raw download, lib_config/credits entries, build_lib)."""
import json, os, sys, urllib.request, subprocess
KIT = '<claude-tmp>'
SRC = KIT + '/src'
NEW = {
  'scree_grey': ('gray_rocks', {'label': 'Grey broken-stone scree / masonry rubble (ruin debris mounds)', 'target': [0.44, 0.44, 0.43], 'col': 0.35, 'lum': 1.15, 'rough': 0.92, 'grime': 0.8, 'tile_m': 1.8}),
  'setts_granite': ('cobblestone_floor_03', {'label': 'Granite setts in courses (bridge decks, gate passages)', 'target': [0.42, 0.41, 0.39], 'col': 0.3, 'lum': 1.3, 'rough': 0.85, 'grime': 1.0, 'tile_m': 2.4}),
}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 shadow-six-kit'}), timeout=60).read()
for mid, (pid, cfg) in NEW.items():
    d = os.path.join(SRC, 'raw', mid); os.makedirs(d, exist_ok=True)
    info = json.loads(get('https://api.polyhaven.com/info/' + pid)); files = json.loads(get('https://api.polyhaven.com/files/' + pid))
    for k, key in {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough', 'ao': 'AO'}.items():
        fp = os.path.join(d, k + '.jpg')
        if not os.path.exists(fp):
            open(fp, 'wb').write(get(files[key]['2k']['jpg']['url']))
    for fn, entry in (('lib_config.json', cfg), ('credits_raw.json', {'source': 'Poly Haven', 'id': pid, 'url': 'https://polyhaven.com/a/' + pid,
            'authors': list(info.get('authors', {}).keys()), 'license': 'CC0-1.0', 'dimensions_mm': info.get('dimensions'), 'name': info.get('name')})):
        p = os.path.join(SRC, fn); j = json.load(open(p)); j[mid] = entry
        json.dump(j, open(p + '.tmp', 'w'), indent=1); os.replace(p + '.tmp', p)
    print('raw ok', mid, os.listdir(d))
subprocess.run(['python3', KIT + '/tools/build_lib.py'] + list(NEW), check=True)
