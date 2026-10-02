"""Ship the fuel-tank family into the game: pack (AO -> JPEG per LOD, gltfpack meshopt + quantisation, library texture
URIs -> ../../../textures/lib/1k/), stage GLB + sidecar + credits into assets/models/buildings/fuel/, then MERGE the
entries into assets/models/buildings/manifest.json (same schema as consolidate/build_manifest.py; other assets untouched).
Usage: python3 ship.py [asset ...]   (default: every out/<name>/<name>.glb)"""
import os, sys, io, json, glob, subprocess, datetime
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'consolidate'))
import glbio  # noqa: E402

OUT = os.path.join(HERE, 'out')
DEST = os.path.join(REPO, 'assets', 'models', 'buildings', 'fuel')
MAN = os.path.join(REPO, 'assets', 'models', 'buildings', 'manifest.json')
GP = os.environ.get('GLTFPACK') or next((p for p in (os.path.join(REPO, 'node_modules/.bin/gltfpack'),
                                                      '<repo>/node_modules/.bin/gltfpack',
                                                      os.path.join(HERE, '..', 'cons', 'node', 'node_modules', '.bin', 'gltfpack'),
                                                      '<claude-tmp>')
                                         if os.path.exists(p)), 'gltfpack')
AO = {'': (512, 74), '_lod1': (256, 70), '_lod2': (128, 70)}
ZOOM = [{'lod': 0, 'minZoom': 0.8}, {'lod': 1, 'minZoom': 0.4}, {'lod': 2, 'minZoom': 0}]
THEATERS = {'temperate': ['temperate', 'night'], 'coast': ['coast', 'temperate', 'night'], 'snow': ['snow'],
            'desert': ['desert']}
DROP = {'auto_cells_0p5', 'notes', 'lod_policy', 'revision', 'review', 'recentered_by', 'vertex_colors', 'materials',
        'windows', 'pivot', 'asset', 'group', 'theater', 'snow', 'lods', 'footprints', 'doors', 'roofs', 'climb',
        'ladders', 'anchors', 'bridge', 'bbox_game', 'height', 'nodes', 'anim', 'mission_use'}


def pack(name, suf):
    src = os.path.join(OUT, name, name + suf + '.glb')
    dst = os.path.join(DEST, name + suf + '.glb')
    j, b = glbio.read(src)
    size, q = AO[suf]
    repl = {}
    for im in j.get('images', []):
        if 'bufferView' not in im:
            continue
        bv = j['bufferViews'][im['bufferView']]
        img = Image.open(io.BytesIO(b[bv.get('byteOffset', 0):][:bv['byteLength']])).convert('L')
        if max(img.size) > size:
            img = img.resize((size, size * img.size[1] // img.size[0]), Image.LANCZOS)
        bio = io.BytesIO()
        img.save(bio, 'JPEG', quality=q, optimize=True)
        repl[im['bufferView']] = bio.getvalue()
        im['mimeType'] = 'image/jpeg'
    b = glbio.replace_views(j, b, repl)
    glbio.rewrite_uris(j, lambda u: 'LIBRES/' + os.path.basename(u))
    t1 = os.path.join(OUT, '_tmp_' + name + suf + '.glb')
    t2 = t1.replace('.glb', '.out.glb')
    glbio.write(t1, j, b)
    r = subprocess.run([GP, '-i', t1, '-o', t2, '-cc', '-tr', '-kn', '-km', '-ke', '-vp', '15', '-vtf'], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(t2):
        raise SystemExit('gltfpack failed %s%s: %s' % (name, suf, r.stderr[-400:]))
    j2, b2 = glbio.read(t2)
    glbio.rewrite_uris(j2, lambda u: '../../../textures/lib/1k/' + u.split('/', 1)[1])
    for im in j2.get('images', []):                       # every library map must exist in the shipped 1k set
        if im.get('uri') and not os.path.exists(os.path.join(REPO, 'assets/textures/lib/1k', os.path.basename(im['uri']))):
            raise SystemExit('missing shipped texture %s (%s)' % (im['uri'], name))
    glbio.write(dst, j2, b2)
    os.remove(t1)
    os.remove(t2)
    return os.path.getsize(src), os.path.getsize(dst)


def intact_of(n):
    s = n[:-5] if n.endswith('_snow') else n
    return s[:-len('_destroyed')] if s.endswith('_destroyed') else None


def base_of(n):
    s = n[:-5] if n.endswith('_snow') else n
    return intact_of(n) or s


def entry(n, k):
    """Manifest entry (schema of consolidate/build_manifest.py) for staged sidecar k."""
    roofs = k.get('roofs', [])
    destroyed = intact_of(n) is not None
    e = {'group': 'fuel', 'region': None, 'theater': k['theater'], 'theaters': THEATERS[k['theater']],
         'snow': bool(k.get('snow')), 'destroyed': destroyed, 'type': 'fueltank', 'types': ['fueltank'] + (['ruins'] if destroyed else []),
         'base': base_of(n),
         'lods': [dict(l, url='buildings/fuel/' + l['file'], **ZOOM[i]) for i, l in enumerate(k['lods'])],
         'sidecar': 'buildings/fuel/%s.kit.json' % n, 'credits': 'buildings/fuel/%s.credits.json' % n,
         'bbox': k['bbox_game'], 'height': k['height'], 'footprints': k['footprints'], 'doors': k['doors'],
         'roofs': roofs, 'roofElev': max([r['elev'] for r in roofs], default=None),
         'walkableRoofs': [r for r in roofs if r.get('walkable')], 'climbEdges': k['climb'], 'ladders': k['ladders'],
         'anchors': k['anchors'], 'nodes': k['nodes']}
    extra = {x: v for x, v in k.items() if x not in DROP and not x.startswith('rework')}
    if extra:
        e['extra'] = extra
    return e


def merge(names):
    man = json.load(open(MAN))
    A = man['assets']
    for n in names:
        k = json.load(open(os.path.join(DEST, n + '.kit.json')))
        A[n] = entry(n, k)
    fam = sorted(n for n, e in A.items() if e.get('group') == 'fuel')
    for n in fam:                                           # snow / destroyed links (re-derived for the family)
        e = A[n]
        e.pop('snowOf', None), e.pop('destroyedOf', None)
        if n.endswith('_snow') and n[:-5] in A:
            e['snowOf'] = n[:-5]
            A[n[:-5]]['snowVariant'] = n
        io_ = intact_of(n)
        if io_:
            tgt = io_ + '_snow' if n.endswith('_snow') and io_ + '_snow' in A else io_
            if tgt in A:
                e['destroyedOf'] = tgt
                A[tgt]['destroyedVariant'] = n
    t = man['types']['fueltank']
    intact = [n for n in fam if not A[n]['destroyed'] and not A[n]['snow']]
    t['variants'] = sorted(set(t['variants']) | set(intact))
    allv = sorted({n for n, e in A.items() if 'fueltank' in e['types']})
    t['all'] = allv
    t['byTheater'] = {th: [n for n in allv if th in A[n]['theaters'] and not A[n]['destroyed']]
                      for th in ('temperate', 'coast', 'snow', 'desert', 'night')}
    man['types']['ruins']['all'] = sorted(n for n, e in A.items() if 'ruins' in e['types'])
    json.dump(man, open(MAN, 'w'), separators=(',', ':'))
    return fam


if __name__ == '__main__':
    os.makedirs(DEST, exist_ok=True)
    names = sys.argv[1:] or sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(OUT, '*', '*.glb'))
                                   if os.path.basename(p)[:-4] == os.path.basename(os.path.dirname(p)))
    rep = []
    for n in names:
        k = json.load(open(os.path.join(OUT, n, n + '.kit.json')))
        for l in k['lods']:
            suf = l['file'][len(n):-4]
            a, b = pack(n, suf)
            l['bytes_src'], l['bytes'] = a, b
        k['group'] = 'fuel'
        json.dump(k, open(os.path.join(DEST, n + '.kit.json'), 'w'), separators=(',', ':'))
        c = json.load(open(os.path.join(OUT, n, n + '.credits.json')))
        json.dump(c, open(os.path.join(DEST, n + '.credits.json'), 'w'), indent=1)
        rep.append((n, [l['tris'] for l in k['lods']], [l['bytes'] for l in k['lods']]))
        print('%-40s tris %s  bytes %s' % rep[-1], flush=True)
    fam = merge(names)
    print(len(fam), 'fuel assets in the manifest; total shipped %.2f MB' % (sum(sum(r[2]) for r in rep) / 2 ** 20))
