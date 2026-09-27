"""Assemble cons/ship/ (only shipped files) + assets/models/vehicles/manifest.json + credits.json.
Shipped per model: LOD0 + LOD2 GLB (LOD1 stays in the Blender outputs: size budget), <model>.json sidecar.
Usage: python3 build_manifest_veh.py"""
import os, sys, json, glob, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); VEH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import normalize as NZ
from types_map import TYPES, PAINT_ORDER
STAGE = os.path.join(HERE, 'stage/assets'); SHIP = os.path.join(HERE, 'ship/assets')
MV = os.path.join(SHIP, 'models/vehicles')
PRUNE = json.load(open(os.path.join(HERE, 'prune.json')))
SHIP_LODS = ['', None, '_lod2']

def dump(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(o, open(p, 'w'), separators=(',', ':'))

def theater_pick(variants):
    """variant names -> {temperate, desert, snow}"""
    base = next((v for v in PAINT_ORDER if v in variants), None) or next(v for v in variants if v != 'burnt')
    return {'temperate': base, 'desert': 'dak' if 'dak' in variants else base,
            'snow': 'winter' if 'winter' in variants else base}

def main():
    shutil.rmtree(os.path.join(HERE, 'ship'), ignore_errors=True)
    models, assets, tris = {}, {}, {}
    def ship_model(group, asset, model, meta, tri):
        lods = []
        for i, suf in enumerate(SHIP_LODS):
            if suf is None: lods.append(None); continue
            src = os.path.join(STAGE, 'models/vehicles', group, model + suf + '.glb')
            assert os.path.exists(src), src
            dst = os.path.join(MV, group, os.path.basename(src)); os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy(src, dst); lods.append(f'{group}/{os.path.basename(src)}')
        dump(os.path.join(MV, group, model + '.json'), meta)
        models[model] = {'asset': asset, 'group': group, 'variant': meta['variant'], 'destroyed': meta['destroyed'],
                         'lods': lods, 'meta': f'{group}/{model}.json', 'tris': [tri[0], None, tri[2]]}
    # kit groups
    for g in ['cars_moto', 'aircraft', 'naval', 'rail']:
        for d in sorted(glob.glob(os.path.join(VEH, g, 'out', '*', ''))):
            a = os.path.basename(d.rstrip('/')); A = None
            for k in sorted(glob.glob(d + '*.kit.json')):
                sc = json.load(open(k)); v = sc['vehicle']; model = sc['asset']
                if A is None:
                    A = assets[a] = {'group': g, 'type': v['type'], 'real_name': v.get('real_name'), 'variants': {},
                                     'destroyed': None, 'unshipped': {}, 'dims': v.get('dims_m')}
                if model in PRUNE: A['unshipped'][v['variant']] = PRUNE[model]; continue
                tri = [l['tris'] for l in sc['lods']]
                ship_model(g, a, model, NZ.from_kit(sc, g, a), tri)
                if v['destroyed'] or v['variant'] in ('burnt', 'deflated'):
                    A['destroyed'] = model
                    if v['variant'] == 'deflated': A['variants']['deflated'] = model
                else: A['variants'][v['variant']] = model
    # armour: one geometry per asset, paint = texture swap
    for d in sorted(glob.glob(os.path.join(VEH, 'armour/out/*/*.veh.json'))):
        sc = json.load(open(d)); a = sc['name']
        tri = {(l['variant'], l['lod']): l['tris'] for l in sc['lods']}
        paints = [k for k in sc['variants'] if k != 'burnt']
        ship_model('armour', a, a, NZ.from_armour(sc, a, False), [tri.get(('grey', i)) for i in range(3)])
        ship_model('armour', a, a + '_burnt', NZ.from_armour(sc, a, True), [tri.get(('burnt', i)) for i in range(3)])
        assets[a] = {'group': 'armour', 'type': a, 'real_name': (sc.get('info') or {}).get('model'),
                     'variants': {p: a for p in paints}, 'texture_swap': {p: None if p == 'grey' else ['_grey_', f'_{p}_'] for p in paints},
                     'destroyed': a + '_burnt', 'unshipped': {}, 'dims': sc.get('dims_real')}
    for a, A in assets.items():
        A['byTheater'] = theater_pick(list(A['variants']))
        if not A['unshipped']: del A['unshipped']
    # sanity: every type target exists
    for t, T in TYPES.items():
        for a in T.get('assets', []): assert a in assets, (t, a)
    man = {
        'version': 1, 'generator': 'tools/blender/vehicles/consolidate (pack_veh.py, stage_tex.py, build_manifest_veh.py)',
        'coords': NZ.COORDS, 'lodPolicy': {'shipped': [0, 2], 'lod0MinZoom': 0.75,
                                          'note': 'LOD1 (~40%) is built by the scripts but not shipped (60 MB budget); zoom >= lod0MinZoom -> LOD0, else LOD2'},
        'theaters': {'temperate': 'temperate', 'europe': 'temperate', 'coast': 'temperate', 'night': 'temperate',
                     'desert': 'desert', 'snow': 'snow', 'winter': 'snow'},
        'textures': {'lib': 'textures/lib/1k/', 'armour': 'models/vehicles/armour/tex/'},
        'types': TYPES, 'assets': assets, 'models': models,
    }
    dump(os.path.join(MV, 'manifest.json'), man)
    # credits: group tables + armour per-asset lists
    cred = {'license_summary': 'geometry + procedural textures: own work (CC0); photo textures: Poly Haven / ambientCG, CC0-1.0'}
    for g in ['cars_moto', 'aircraft', 'naval', 'rail']:
        cred[g] = json.load(open(os.path.join(VEH, g, 'out', f'credits_{g}.json')))
    cred['armour'] = {os.path.basename(p)[:-13]: json.load(open(p)).get('credits') for p in sorted(glob.glob(os.path.join(VEH, 'armour/out/*/*.credits.json')))}
    dump(os.path.join(MV, 'credits.json'), cred)
    # textures
    for sub in ['textures/lib/1k', 'models/vehicles/armour/tex']:
        s = os.path.join(STAGE, sub)
        if os.path.isdir(s): shutil.copytree(s, os.path.join(SHIP, sub), dirs_exist_ok=True)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(SHIP) for f in fs)
    print('models', len(models), 'assets', len(assets), 'types', len(TYPES), 'ship MB', round(tot / 1e6, 2))

if __name__ == '__main__':
    main()
