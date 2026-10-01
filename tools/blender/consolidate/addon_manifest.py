"""Ship one art pass's new assets without rebuilding the whole library: pack the named GLBs (pack.py's meshopt +
quantisation + per-LOD AO), write their sidecars next to them and write an ADD-ON manifest
assets/models/buildings/<addon>.json (same entry schema as build_manifest.py, `assets` + `types` only). The runtime
merges every add-on listed in building-library.js EXTRA_MANIFESTS after manifest.json, so parallel art passes never
edit the same one-line manifest.

  python3 addon_manifest.py <art_root> <repo_root> <addon> <group> type=name1,name2 ... [--extra name3 ...]
    art_root:  folder holding <group>/out/<asset>/ (Blender build outputs); env GLTFPACK = gltfpack binary, PACK_TMP = scratch
    type=...:  catalogue type -> the intact variants it lists (destroyed / snow variants are found by name)
"""
import os, sys, json, glob
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack
from catalogue import THEATERS, REGION

ZOOM = [{'lod': 0, 'minZoom': 0.8}, {'lod': 1, 'minZoom': 0.4}, {'lod': 2, 'minZoom': 0}]
KEEP = ('bbox_game', 'height', 'footprints', 'doors', 'roofs', 'climb', 'ladders', 'anchors', 'nodes')


def main(argv):
    art, repo, addon, group = argv[:4]
    types = {}
    for a in argv[4:]:
        t, names = a.split('=')
        types[t] = names.split(',')
    pack.ART = os.path.abspath(art)
    pack.STAGE = os.path.join(os.path.abspath(repo), 'assets', 'models')
    pack.GP = os.environ.get('GLTFPACK', pack.GP)               # gltfpack binary (npm i gltfpack)
    pack.TMP = os.environ.get('PACK_TMP', pack.TMP)
    os.makedirs(pack.TMP, exist_ok=True)
    intact = sorted({n for l in types.values() for n in l})
    names = []
    for n in intact:
        for v in (n, n + '_destroyed', n + '_snow'):
            if os.path.exists(os.path.join(pack.ART, group, 'out', v, v + '.glb')):
                names.append(v)
    dd = pack.dest_dir(group)
    os.makedirs(dd, exist_ok=True)
    with Pool(6) as p:
        for r in p.imap_unordered(pack.pack_one, [(group, n, s) for n in names for s in pack.AO]):
            print(*r, flush=True)
    assets = {}
    for n in names:
        src = os.path.join(pack.ART, group, 'out', n)
        k = json.load(open(os.path.join(src, n + '.kit.json')))
        for l in k.get('lods', []):
            l['bytes_src'] = l['bytes']; l['bytes'] = os.path.getsize(os.path.join(dd, l['file']))
        k['group'] = group
        json.dump(k, open(os.path.join(dd, n + '.kit.json'), 'w'), separators=(',', ':'))
        json.dump(json.load(open(os.path.join(src, n + '.credits.json'))), open(os.path.join(dd, n + '.credits.json'), 'w'), indent=1)
        rel = os.path.relpath(dd, pack.STAGE)
        destroyed = n.endswith('_destroyed')
        base = n[:-len('_destroyed')] if destroyed else (n[:-5] if n.endswith('_snow') else n)
        tl = [t for t, l in types.items() if base in l] + (['ruins'] if destroyed else [])
        roofs = k.get('roofs', [])
        e = {'group': group, 'region': REGION.get(group), 'theater': k['theater'], 'theaters': THEATERS[k['theater']],
             'snow': n.endswith('_snow'), 'destroyed': destroyed, 'type': tl[0], 'types': tl, 'base': base,
             'lods': [dict(l, url=f"{rel}/{l['file']}", **ZOOM[i]) for i, l in enumerate(k['lods'])],
             'sidecar': f'{rel}/{n}.kit.json', 'credits': f'{rel}/{n}.credits.json',
             'bbox': k['bbox_game'], 'height': k['height'], 'footprints': k['footprints'], 'doors': k['doors'],
             'roofs': roofs, 'roofElev': max([r['elev'] for r in roofs], default=None),
             'walkableRoofs': [r for r in roofs if r.get('walkable')],
             'climbEdges': k['climb'], 'ladders': k['ladders'], 'anchors': k['anchors'], 'nodes': k['nodes']}
        if destroyed:
            e['destroyedOf'] = base
        assets[n] = e
    for n, e in assets.items():
        if e.get('destroyedOf') in assets:
            assets[e['destroyedOf']]['destroyedVariant'] = n
    out_types = {}
    for t, lst in types.items():
        allv = sorted(n for n, e in assets.items() if t in e['types'])
        out_types[t] = {'source': 'extra', 'variants': lst, 'all': allv,
                        'byTheater': {th: [n for n in allv if th in assets[n]['theaters'] and not assets[n]['destroyed']]
                                      for th in ('temperate', 'coast', 'snow', 'desert', 'night')}}
    out = os.path.join(pack.STAGE, 'buildings', addon + '.json')
    json.dump({'version': 1, 'addon': addon, 'types': out_types, 'assets': assets}, open(out, 'w'), separators=(',', ':'))
    print(len(assets), 'assets ->', out, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1:])
