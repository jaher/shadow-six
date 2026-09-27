"""Stage compressed vehicle GLBs into cons/stage/assets/models/vehicles/<group>/ (meshopt + quantisation, embedded AO
resized per LOD, texture URIs rewritten: shared lib -> ../../../textures/lib/1k/, armour atlases -> tex/).
Usage: python3 pack_veh.py [group|asset ...]"""
import os, sys, io, json, glob, subprocess
REPO = os.environ.get('SHADOW_REPO') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..'))
from multiprocessing import Pool
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, 'tools/blender/consolidate'))
import glbio
VEH = os.path.dirname(HERE)                      # scratchpad/vehicles
STAGE = os.path.join(HERE, 'stage', 'assets', 'models', 'vehicles')
TMP = os.path.join(HERE, 'tmp')
GP = os.environ.get('GLTFPACK', 'gltfpack')   # npm i gltfpack
FLAGS = os.environ.get('GPFLAGS', '-cc -tr -kn -km -ke -vp 14 -vtf').split()
GROUPS = ['cars_moto', 'armour', 'aircraft', 'naval', 'rail']
LODS = ['', '_lod1', '_lod2']
BIG = {'battleship_bismarck', 'uboat_viic', 'ju52_3m', 'loco_br52', 'tender_t30', 'railgun_k5', 'coach',
       'harbour_tug', 'patrol_boat', 'wagon_open', 'wagon_flat', 'wagon_covered', 'wagon_tank', 'rail_crane', 'tram_fr'}

def entries():
    """yield (group, asset, base, lod_suffix, src)"""
    for g in GROUPS:
        for d in sorted(glob.glob(os.path.join(VEH, g, 'out', '*', ''))):
            a = os.path.basename(d.rstrip('/'))
            if g == 'armour':
                if not os.path.exists(os.path.join(d, a + '.veh.json')): continue
                for base, stem in ((a, a), (a + '_burnt', a + '_burnt')):
                    for i, suf in enumerate(LODS):
                        p = os.path.join(d, f'{stem}_lod{i}.glb')
                        if os.path.exists(p): yield g, a, base, suf, p
            else:
                for k in sorted(glob.glob(os.path.join(d, '*.kit.json'))):
                    base = os.path.basename(k)[:-9]
                    for suf in LODS:
                        p = os.path.join(d, base + suf + '.glb')
                        if os.path.exists(p): yield g, a, base, suf, p

def replace_views(j, bin_, repl):
    """Like glbio.replace_views, but also relocates EXT_meshopt_compression payloads living in buffer 0."""
    out = io.BytesIO()
    def put(data):
        pad = (4 - out.tell() % 4) % 4; out.write(b'\0' * pad); o = out.tell(); out.write(data); return o
    for i, bv in enumerate(j['bufferViews']):
        ext = bv.get('extensions', {}).get('EXT_meshopt_compression')
        if ext is not None and ext.get('buffer', 0) == 0:
            o = ext.get('byteOffset', 0); ext['byteOffset'] = put(bin_[o:o + ext['byteLength']])
        if bv.get('buffer', 0) == 0:
            data = repl.get(i, bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
            bv['byteOffset'] = put(data); bv['byteLength'] = len(data)
    nb = out.getvalue(); j['buffers'][0]['byteLength'] = len(nb)
    return nb

def uri_tag(src_dir, u):
    f = os.path.normpath(os.path.join(src_dir, u))
    if '/armour/out/' in f and '/tex/' in f: return 'ATEX/' + os.path.basename(f), f
    return 'LIB/' + os.path.basename(f), f

def pack_one(e):
    g, a, base, suf, src = e
    out_dir = os.path.join(STAGE, g); out = os.path.join(out_dir, base + suf + '.glb')
    j, b = glbio.read(src)
    lod0 = 640 if a in BIG else 384
    size = {'': lod0, '_lod1': lod0 // 2, '_lod2': 128 if a in BIG else 96}[suf]
    blur = {'': 1.0, '_lod1': 0.7, '_lod2': 0.5}[suf]
    repl, refs = {}, []
    for im in j.get('images', []):
        if 'bufferView' in im:
            bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
            img = Image.open(io.BytesIO(b[o:o + bv['byteLength']]))
            if img.mode == 'L' or img.mode == 'I': img = img.convert('L')
            else:
                img = img.convert('RGB'); r, gg, bl = img.split()
                if list(r.getdata())[::97] == list(gg.getdata())[::97] == list(bl.getdata())[::97]: img = r
            if max(img.size) > size: img = img.resize((size, size * img.size[1] // img.size[0]), Image.LANCZOS)
            if img.mode == 'L': img = img.filter(ImageFilter.GaussianBlur(blur))   # baked AO: low-frequency, denoise
            bio = io.BytesIO(); img.save(bio, 'JPEG', quality=72, optimize=True)
            repl[im['bufferView']] = bio.getvalue(); im['mimeType'] = 'image/jpeg'
        elif 'uri' in im:
            t, f = uri_tag(os.path.dirname(src), im['uri']); im['uri'] = t; refs.append(f)
    b = replace_views(j, b, repl)
    t1 = os.path.join(TMP, f'{g}__{base}{suf}.in.glb'); t2 = t1.replace('.in.glb', '.out.glb')
    glbio.write(t1, j, b)
    r = subprocess.run([GP, '-i', t1, '-o', t2] + FLAGS,
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(t2): return [g, a, base, suf, 'ERR ' + r.stderr[-300:]]
    j2, b2 = glbio.read(t2)
    glbio.rewrite_uris(j2, lambda u: ('../../../textures/lib/1k/' if u.startswith('LIB/') else 'tex/') + u.split('/', 1)[1])
    os.makedirs(out_dir, exist_ok=True); glbio.write(out, j2, b2); os.remove(t1); os.remove(t2)
    return [g, a, base, suf, os.path.getsize(src), os.path.getsize(out), sorted(set(refs))]

if __name__ == '__main__':
    only = sys.argv[1:]
    os.makedirs(TMP, exist_ok=True)
    jobs = [e for e in entries() if not only or e[0] in only or e[1] in only]
    print(len(jobs), 'jobs', flush=True)
    res = []
    with Pool(12) as p:
        for r in p.imap_unordered(pack_one, jobs):
            res.append(r); print(*r[:6], flush=True)
    old = []
    rp = os.path.join(HERE, 'pack_result.json')
    if only and os.path.exists(rp):
        keys = {(r[0], r[2], r[3]) for r in res}
        old = [r for r in json.load(open(rp)) if (r[0], r[2], r[3]) not in keys]
    json.dump(old + res, open(rp, 'w'))
