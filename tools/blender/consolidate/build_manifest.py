"""Write stage/assets/models/buildings/manifest.json from the staged sidecars + catalogue.py."""
import json, os, glob, datetime
from catalogue import TYPES, DESTROYED_OF, THEATERS, REGION
HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(HERE, 'stage', 'assets', 'models')
DROP = {'auto_cells_0p5', 'notes', 'lod_policy', 'revision', 'review', 'review_water', 'recentered_by', 'vertex_colors',
        'gltf_extensions_required', 'quantized', 'materials', 'windows', 'pivot', 'asset', 'group', 'theater', 'snow',
        'mission_use', 'lods', 'footprints', 'doors', 'roofs', 'climb', 'ladders', 'anchors', 'bridge', 'bbox_game',
        'height', 'nodes', 'anim'}
ZOOM = [{'lod': 0, 'minZoom': 0.8}, {'lod': 1, 'minZoom': 0.4}, {'lod': 2, 'minZoom': 0}]

side = {}
for f in sorted(glob.glob(os.path.join(M, '**', '*.kit.json'), recursive=True)):
    k = json.load(open(f)); side[k['asset']] = (k, os.path.relpath(os.path.dirname(f), M))
names = set(side)

def intact_of(n):
    s = n[:-5] if n.endswith('_snow') else n
    if s in DESTROYED_OF: return DESTROYED_OF[s]
    for suf in ('_destroyed', '_ruin'):
        if s.endswith(suf): return s[:-len(suf)]
    return None

def base_of(n):   # intact, non-snow name
    s = n[:-5] if n.endswith('_snow') else n
    return intact_of(n) or s

type_of = {}
for t, (src, lst) in TYPES.items():
    for n in lst:
        assert n in names, (t, n)
        type_of.setdefault(n, []).append(t)

assets = {}
for n, (k, rel) in sorted(side.items()):
    b = base_of(n); destroyed = intact_of(n) is not None; snow = n.endswith('_snow')
    types = list(type_of.get(b, []))
    if destroyed or b in ('house_bombed_a', 'house_bombed_b'):
        if 'ruins' not in types: types.append('ruins')
    assert types, n
    roofs = k.get('roofs', [])
    e = {
        'group': k['group'], 'region': REGION[k['group']], 'theater': k['theater'], 'theaters': THEATERS[k['theater']],
        'snow': bool(k.get('snow')), 'destroyed': destroyed, 'type': types[0], 'types': types, 'base': b,
        'lods': [dict(l, url=f"{rel}/{l['file']}", **ZOOM[i]) for i, l in enumerate(k['lods'])],
        'sidecar': f'{rel}/{n}.kit.json', 'credits': f'{rel}/{n}.credits.json',
        'bbox': k['bbox_game'], 'height': k['height'],
        'footprints': k['footprints'], 'doors': k['doors'],
        'roofs': roofs, 'roofElev': max([r['elev'] for r in roofs], default=None),
        'walkableRoofs': [r for r in roofs if r.get('walkable')],
        'climbEdges': k['climb'], 'ladders': k['ladders'], 'anchors': k['anchors'], 'nodes': k['nodes'],
    }
    if k.get('bridge'): e['bridge'] = k['bridge']
    if k.get('anim'): e['anim'] = k['anim']
    if k.get('mission_use'): e['missionUse'] = k['mission_use']
    extra = {x: v for x, v in k.items() if x not in DROP and not x.startswith('rework')}
    if extra: e['extra'] = extra
    if snow and n[:-5] in names: e['snowOf'] = n[:-5]
    if destroyed: e['destroyedOf'] = (intact_of(n) + '_snow') if snow and intact_of(n) + '_snow' in names else intact_of(n)
    assets[n] = e
for n, e in assets.items():
    if 'snowOf' in e: assets[e['snowOf']]['snowVariant'] = n
    if 'destroyedOf' in e and e['destroyedOf'] in assets: assets[e['destroyedOf']].setdefault('destroyedVariant', n)

types = {}
for t, (src, lst) in TYPES.items():
    allv = sorted({n for n, e in assets.items() if t in e['types']})
    types[t] = {'source': src, 'variants': lst, 'all': allv,
                'byTheater': {th: [n for n in allv if th in assets[n]['theaters'] and not assets[n]['destroyed']]
                              for th in ('temperate', 'coast', 'snow', 'desert', 'night')}}
types['ruins']['all'] = sorted(n for n, e in assets.items() if 'ruins' in e['types'])
ultra = json.load(open(os.path.join(HERE, 'ultra2k.json')))['ultra2k']
man = {
    'version': 1, 'generated': datetime.date.today().isoformat(),
    'about': 'SHADOW SIX buildings & bridges (scripted Blender kit, tools/blender). URLs are relative to assets/models/. '
             'Game coords: x east, y up, z south, metres; pivot = ground centre, front faces +Z (south) at rot 0. '
             'LOD i is the first whose minZoom < zoom (realism-pipeline: zoom <= 0.8 uses LOD1). GLBs use EXT_meshopt_compression + KHR_mesh_quantization '
             '(GLTFLoader.setMeshoptDecoder) and reference shared textures by relative URI ../(..)/textures/lib/1k/.',
    'textures': {'base': 'textures/lib/', 'default': '1k', 'ultra': '2k', 'ultraFormat': 'webp',
                 'ultraMaps': 'albedo (diff/rgba) only; normal + ARM stay 1k', 'ultra2k': ultra,
                 'materials': 'textures/lib/materials.json', 'decals': 'textures/lib/decals.json'},
    'catalogueSources': {'architecture': 'docs/ARCHITECTURE.md prop catalogue', 'spec': 'docs/design-spec.md §7.7',
                         'extra': 'new kit types (not yet in either list)'},
    'types': types, 'assets': assets,
}
out = os.path.join(M, 'buildings', 'manifest.json')
json.dump(man, open(out, 'w'), separators=(',', ':'))
print(len(assets), 'assets', len(types), 'types', os.path.getsize(out) // 1024, 'KB')
print('no destroyedVariant link:', [n for n, e in assets.items() if e['destroyed'] and e['destroyedOf'] not in assets])
