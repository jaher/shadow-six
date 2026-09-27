"""Add desert materials (canvas, hessian, sand) to the shared kit library. CC0 Poly Haven. Merges into
src/credits_raw.json + src/lib_config.json, then run tools/build_lib.py canvas hessian sand."""
import json, os, urllib.request, time
KIT = '<claude-tmp>'
SRC = KIT + '/src'
NEW = {'canvas': 'rough_linen', 'hessian': 'hessian_230', 'sand': 'dense_sand'}
CFG = {
 'canvas': {'label': 'Army canvas / tent duck (khaki-sand)', 'tile_m': 1.2, 'target': [0.56, 0.5, 0.38], 'col': 0.85, 'lum': 1.4, 'rough': 0.92, 'grime': 0.8},
 'hessian': {'label': 'Hessian sandbag cloth', 'tile_m': 0.6, 'target': [0.55, 0.47, 0.34], 'col': 0.7, 'lum': 1.0, 'rough': 0.95, 'grime': 0.6},
 'sand': {'label': 'Desert sand drift', 'tile_m': 1.8, 'target': [0.6, 0.5, 0.37], 'col': 0.5, 'lum': 1.0, 'rough': 0.95, 'grime': 0.0},
}
def get(url):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 shadow-six-kit'}), timeout=60).read()
        except Exception as e:
            print('retry', url, e, flush=True); time.sleep(2)
    raise RuntimeError(url)
cred = json.load(open(SRC + '/credits_raw.json'))
cfg = json.load(open(SRC + '/lib_config.json'))
for mid, pid in NEW.items():
    d = os.path.join(SRC, 'raw', mid); os.makedirs(d, exist_ok=True)
    info = json.loads(get('https://api.polyhaven.com/info/' + pid)); files = json.loads(get('https://api.polyhaven.com/files/' + pid))
    for k, key in {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough', 'ao': 'AO'}.items():
        if key in files and not os.path.exists(d + '/' + k + '.jpg'):
            open(d + '/' + k + '.jpg', 'wb').write(get(files[key]['2k']['jpg']['url']))
    cred[mid] = {'source': 'Poly Haven', 'id': pid, 'url': 'https://polyhaven.com/a/' + pid, 'authors': list(info.get('authors', {}).keys()),
                 'license': 'CC0-1.0', 'dimensions_mm': info.get('dimensions', [2000, 2000]), 'name': info.get('name')}
    cfg[mid] = CFG[mid]
    print('ok', mid, sorted(os.listdir(d)), info.get('dimensions'), flush=True)
json.dump(cred, open(SRC + '/credits_raw.json', 'w'), indent=1)
json.dump(cfg, open(SRC + '/lib_config.json', 'w'), indent=1)
