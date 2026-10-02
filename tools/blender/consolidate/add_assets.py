"""Ship NEW kit assets into the game without re-staging the whole library (incremental pack.py + sidecars.py +
build_manifest.py for a few assets): meshopt-pack LOD0-2 with gltfpack, copy the sidecar + credits, and add the
manifest entries. New assets join their type's `all` list only (not `variants` / `byTheater`), so the type's
random pick in other missions is unchanged; missions name them through VARIANT_HINTS or `asset`.

usage: python3 add_assets.py <group> <type> <asset_out_dir | shipped asset name> [...]
  e.g. add_assets.py europe hut .../out/hut_timber_barrack_a .../out/hut_timber_barrack_b
  A bare name that is not a directory re-indexes the shipped asset (assets/models/buildings/<group>/<name>.kit.json):
  after a merge that kept the other side's one-line manifest.json, re-run with names only.
env: GLTFPACK (default: the scratch cons/node gltfpack)"""
import io, json, os, sys, subprocess, tempfile
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glbio
from catalogue import THEATERS, REGION

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MODELS = os.path.join(REPO, 'assets', 'models')
GP = os.environ.get('GLTFPACK', '<claude-tmp>')
AO = {'': (1024, 74), '_lod1': (512, 74), '_lod2': (256, 74)}
ZOOM = [{'lod': 0, 'minZoom': 0.8}, {'lod': 1, 'minZoom': 0.4}, {'lod': 2, 'minZoom': 0}]


def dest(group):
    return os.path.join(MODELS, 'bridges') if group == 'bridges' else os.path.join(MODELS, 'buildings', group)


def pack(src, out, suf, group):
    j, b = glbio.read(src)
    size, q = AO[suf]; repl = {}
    for im in j.get('images', []):
        if 'bufferView' not in im: continue
        bv = j['bufferViews'][im['bufferView']]
        img = Image.open(io.BytesIO(b[bv.get('byteOffset', 0):][:bv['byteLength']])).convert('RGB')
        if max(img.size) > size: img = img.resize((size, size * img.size[1] // img.size[0]), Image.LANCZOS)
        r, g, bl = img.split()
        if list(r.getdata())[::97] == list(g.getdata())[::97] == list(bl.getdata())[::97]: img = r
        bio = io.BytesIO(); img.save(bio, 'JPEG', quality=q, optimize=True); repl[im['bufferView']] = bio.getvalue(); im['mimeType'] = 'image/jpeg'
    b = glbio.replace_views(j, b, repl)
    glbio.rewrite_uris(j, lambda u: 'LIBRES/' + os.path.basename(u))
    with tempfile.TemporaryDirectory() as td:
        t1, t2 = os.path.join(td, 'in.glb'), os.path.join(td, 'out.glb')
        glbio.write(t1, j, b)
        r = subprocess.run([GP, '-i', t1, '-o', t2, '-cc', '-tr', '-kn', '-km', '-ke', '-vp', '15', '-vtf'], capture_output=True, text=True)
        if r.returncode or not os.path.exists(t2): raise SystemExit('gltfpack failed: ' + r.stderr[-400:])
        j2, b2 = glbio.read(t2)
    pre = '../../textures/lib/1k/' if group == 'bridges' else '../../../textures/lib/1k/'
    glbio.rewrite_uris(j2, lambda u: pre + u.split('/', 1)[1])
    glbio.write(out, j2, b2)
    return os.path.getsize(out)


def main():
    group, typ, dirs = sys.argv[1], sys.argv[2], sys.argv[3:]
    dd = dest(group); os.makedirs(dd, exist_ok=True)
    mpath = os.path.join(MODELS, 'buildings', 'manifest.json')
    man = json.load(open(mpath))
    rel = os.path.relpath(dd, MODELS)
    lib1k = os.path.join(REPO, 'assets', 'textures', 'lib', '1k')
    for d in dirs:
        n = os.path.basename(d.rstrip('/'))
        shipped = not os.path.isdir(d)   # re-index an already shipped asset (merges: manifest.json is one line)
        k = json.load(open(os.path.join(dd if shipped else d, n + '.kit.json')))
        if not shipped:
            for l in k['lods']:
                l['bytes_src'] = l['bytes']
                l['bytes'] = pack(os.path.join(d, l['file']), os.path.join(dd, l['file']), l['file'][len(n):-4], group)
        k['group'] = group
        missing = sorted({str(m).split('~')[0] for m in k.get('materials', [])} - {f.rsplit('_', 1)[0] for f in os.listdir(lib1k)}
                         - {f.rsplit('.', 1)[0].replace('_rgba', '') for f in os.listdir(lib1k)})
        if missing: print('WARNING textures not shipped:', n, missing)
        if not shipped:
            json.dump(k, open(os.path.join(dd, n + '.kit.json'), 'w'), separators=(',', ':'))
            json.dump(json.load(open(os.path.join(d, n + '.credits.json'))), open(os.path.join(dd, n + '.credits.json'), 'w'), indent=1)
        destroyed = n.endswith('_destroyed') or n.endswith('_ruin')
        base = n.rsplit('_', 1)[0] if destroyed else n
        roofs = k.get('roofs', [])
        e = {'group': group, 'region': REGION[group], 'theater': k['theater'], 'theaters': THEATERS[k['theater']],
             'snow': bool(k.get('snow')), 'destroyed': destroyed, 'type': typ, 'types': [typ] + (['ruins'] if destroyed else []),
             'base': base, 'lods': [dict(l, url=f"{rel}/{l['file']}", **ZOOM[i]) for i, l in enumerate(k['lods'])],
             'sidecar': f'{rel}/{n}.kit.json', 'credits': f'{rel}/{n}.credits.json', 'bbox': k['bbox_game'], 'height': k['height'],
             'footprints': k['footprints'], 'doors': k['doors'], 'roofs': roofs, 'roofElev': max([r['elev'] for r in roofs], default=None),
             'walkableRoofs': [r for r in roofs if r.get('walkable')], 'climbEdges': k['climb'], 'ladders': k['ladders'],
             'anchors': k['anchors'], 'nodes': k['nodes']}
        if destroyed:
            e['destroyedOf'] = base
            if base in man['assets']: man['assets'][base]['destroyedVariant'] = n
        elif man['assets'].get(n + '_destroyed'): e['destroyedVariant'] = n + '_destroyed'
        man['assets'][n] = e
        t = man['types'].setdefault(typ, {'source': 'extra', 'variants': [], 'all': [], 'byTheater': {th: [] for th in ('temperate', 'coast', 'snow', 'desert', 'night')}})
        if n not in t['all']: t['all'] = sorted(t['all'] + [n])
        if destroyed and 'ruins' in man['types'] and n not in man['types']['ruins']['all']: man['types']['ruins']['all'] = sorted(man['types']['ruins']['all'] + [n])
        print('added', n, [l['bytes'] for l in k['lods']])
    json.dump(man, open(mpath, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main()
