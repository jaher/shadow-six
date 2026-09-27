"""Rework round 2: sharper mud render, lumpy lime render, patchy lime roof screed, galvanised corrugated iron (CC0 Poly Haven).
CC0 Poly Haven sources -> kit/src/raw/<id>; merges credits_raw.json + lib_config.json (re-read right before write)."""
import json, os, urllib.request, time, sys
KIT = '<claude-tmp>'
SRC = KIT + '/src'
NEW = {'mud_render2': 'dirt_floor', 'limewash_lumpy': 'medieval_wall_01', 'screed_lime': 'grey_plaster_02', 'corrugated_zinc': 'corrugated_iron_02'}
CFG = {
 'mud_render2': {'label': 'Mud/straw render (hand-thrown, grit + straw), darker/redder than sand', 'tile_m': 1.6, 'target': [0.42, 0.30, 0.20], 'col': 0.55, 'lum': 1.9, 'rough': 0.96, 'grime': 0.9},
 'limewash_lumpy': {'label': 'Lumpy lime render over rubble (whitewashed, hand-applied)', 'tile_m': 2.2, 'target': [0.78, 0.76, 0.71], 'col': 0.7, 'lum': 1.25, 'rough': 0.92, 'grime': 1.0},
 'screed_lime': {'label': 'Patchy lime/cement roof screed (trowelled repairs, no craze)', 'tile_m': 4.0, 'target': [0.66, 0.63, 0.57], 'col': 0.6, 'lum': 1.6, 'rough': 0.93, 'grime': 1.0},
 'corrugated_zinc': {'label': 'Galvanised corrugated iron (76 mm pitch)', 'tile_m': 1.5, 'grain': 'v', 'target': [0.55, 0.55, 0.53], 'col': 0.5, 'lum': 1.3, 'rough': 0.55, 'metal': 0.7, 'grime': 0.6},
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
