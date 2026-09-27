"""Rework round 1: desert materials with real albedo breakup (the first set was graded almost flat).
CC0 Poly Haven sources -> kit/src/raw/<id>; merges credits_raw.json + lib_config.json (re-read right before write)."""
import json, os, urllib.request, time, sys
KIT = '<claude-tmp>'
SRC = KIT + '/src'
NEW = {'limewash_worn': 'plastered_stone_wall', 'mud_render': 'clay_plaster', 'mudbrick': 'clay_block_wall',
       'sandstone_ochre': 'sandstone_blocks_04', 'bitumen_felt': 'bitumen', 'corrugated_galv': 'worn_corrugated_iron',
       'screed_roof': 'cracked_concrete', 'patio_flags': 'floor_tiles_04', 'palm_log': 'bark_brown_01'}
CFG = {
 'limewash_worn': {'label': 'Worn lime-wash over rubble (Tunis medina; peeling, stone showing)', 'tile_m': 2.5, 'target': [0.76, 0.74, 0.69], 'col': 0.75, 'lum': 1.15, 'rough': 0.92, 'grime': 1.0},
 'mud_render': {'label': 'Mud/straw render, Libyan-Tunisian (darker, redder than sand)', 'tile_m': 2.0, 'target': [0.47, 0.35, 0.24], 'col': 0.6, 'lum': 1.6, 'rough': 0.95, 'grime': 0.9},
 'mudbrick': {'label': 'Exposed sun-dried mud brick', 'tile_m': 2.0, 'target': [0.52, 0.40, 0.28], 'col': 0.55, 'lum': 1.3, 'rough': 0.95, 'grime': 0.9},
 'sandstone_ochre': {'label': 'Ochre sandstone ashlar (Zitouna drum/minaret)', 'tile_m': 3.0, 'target': [0.70, 0.57, 0.40], 'col': 0.6, 'lum': 1.2, 'rough': 0.85, 'grime': 1.0},
 'bitumen_felt': {'label': 'Tarred roofing felt / bitumen patches', 'tile_m': 2.5, 'target': [0.17, 0.17, 0.16], 'col': 0.8, 'lum': 1.3, 'rough': 0.75, 'grime': 0.3},
 'corrugated_galv': {'label': 'Worn galvanised corrugated iron', 'tile_m': 1.8, 'grain': 'v', 'target': [0.52, 0.51, 0.49], 'col': 0.4, 'lum': 1.2, 'rough': 0.6, 'metal': 0.6, 'grime': 0.7},
 'screed_roof': {'label': 'Cracked lime/cement roof screed', 'tile_m': 2.5, 'target': [0.60, 0.57, 0.51], 'col': 0.6, 'lum': 1.7, 'rough': 0.92, 'grime': 1.0},
 'patio_flags': {'label': 'Worn limestone patio flags', 'tile_m': 3.0, 'target': [0.62, 0.58, 0.52], 'col': 0.6, 'lum': 1.2, 'rough': 0.85, 'grime': 0.6},
 'palm_log': {'label': 'Palm trunk / rough log (joists, beams)', 'tile_m': 1.0, 'target': [0.40, 0.33, 0.25], 'col': 0.6, 'lum': 1.2, 'rough': 0.95, 'grime': 0.8},
}
def get(url):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 shadow-six-kit'}), timeout=90).read()
        except Exception as e:
            print('retry', url, e, flush=True); time.sleep(2)
    raise RuntimeError(url)
ids = sys.argv[1:] or list(NEW)
newcred = {}
for mid in ids:
    pid = NEW[mid]
    d = os.path.join(SRC, 'raw', mid); os.makedirs(d, exist_ok=True)
    info = json.loads(get('https://api.polyhaven.com/info/' + pid)); files = json.loads(get('https://api.polyhaven.com/files/' + pid))
    for k, key in {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough', 'ao': 'AO'}.items():
        if key in files and not os.path.exists(d + '/' + k + '.jpg'):
            open(d + '/' + k + '.jpg', 'wb').write(get(files[key]['2k']['jpg']['url']))
    newcred[mid] = {'source': 'Poly Haven', 'id': pid, 'url': 'https://polyhaven.com/a/' + pid, 'authors': list(info.get('authors', {}).keys()),
                    'license': 'CC0-1.0', 'dimensions_mm': info.get('dimensions', [2000, 2000]), 'name': info.get('name')}
    print('ok', mid, sorted(os.listdir(d)), info.get('dimensions'), flush=True)
cred = json.load(open(SRC + '/credits_raw.json')); cred.update(newcred)
json.dump(cred, open(SRC + '/credits_raw.json', 'w'), indent=1)
cfg = json.load(open(SRC + '/lib_config.json'))
for mid in ids:
    cfg[mid] = CFG[mid]
json.dump(cfg, open(SRC + '/lib_config.json', 'w'), indent=1)
