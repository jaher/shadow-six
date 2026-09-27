"""Stage compressed GLBs + sidecars into cons/stage/assets/models/... (meshopt + quantization, AO resized per LOD)."""
import os, sys, io, json, glob, subprocess, shutil
from multiprocessing import Pool
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import glbio
ART = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONS = os.path.join(ART, 'cons'); STAGE = os.path.join(CONS, 'stage', 'assets', 'models')
TMP = os.path.join(CONS, 'tmp'); GP = os.path.join(CONS, 'node/node_modules/.bin/gltfpack')
GROUPS = ['norway', 'desert', 'europe', 'military', 'bridges']
AO = {'': (1024, 74), '_lod1': (512, 74), '_lod2': (256, 74)}

def dest_dir(group):
    return os.path.join(STAGE, 'bridges') if group == 'bridges' else os.path.join(STAGE, 'buildings', group)

def prefix(group):
    return '../../textures/lib/1k/' if group == 'bridges' else '../../../textures/lib/1k/'

def pack_one(args):
    group, name, suf = args
    src = os.path.join(ART, group, 'out', name, name + suf + '.glb')
    out = os.path.join(dest_dir(group), name + suf + '.glb')
    j, b = glbio.read(src)
    size, q = AO[suf]; repl = {}
    for im in j.get('images', []):
        if 'bufferView' not in im: continue
        img = Image.open(io.BytesIO(b[j['bufferViews'][im['bufferView']].get('byteOffset', 0):][:j['bufferViews'][im['bufferView']]['byteLength']]))
        img = img.convert('RGB')
        if max(img.size) > size: img = img.resize((size, size * img.size[1] // img.size[0]), Image.LANCZOS)
        r, g, bl = img.split()
        if list(r.getdata())[::97] == list(g.getdata())[::97] == list(bl.getdata())[::97]: img = r
        bio = io.BytesIO(); img.save(bio, 'JPEG', quality=q, optimize=True, progressive=False)
        repl[im['bufferView']] = bio.getvalue(); im['mimeType'] = 'image/jpeg'
    b = glbio.replace_views(j, b, repl)
    glbio.rewrite_uris(j, lambda u: 'LIBRES/' + os.path.basename(u))
    t1 = os.path.join(TMP, f'{group}__{name}{suf}.in.glb'); t2 = t1.replace('.in.glb', '.out.glb')
    glbio.write(t1, j, b)
    r = subprocess.run([GP, '-i', t1, '-o', t2, '-cc', '-tr', '-kn', '-km', '-ke', '-vp', '15', '-vtf'], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(t2): return (group, name, suf, 'ERR ' + r.stderr[-300:])
    j2, b2 = glbio.read(t2)
    pre = prefix(group)
    glbio.rewrite_uris(j2, lambda u: pre + u.split('/', 1)[1])
    glbio.write(out, j2, b2); os.remove(t1); os.remove(t2)
    return (group, name, suf, os.path.getsize(src), os.path.getsize(out))

def assets():
    for g in GROUPS:
        for d in sorted(glob.glob(os.path.join(ART, g, 'out', '*', ''))):
            n = os.path.basename(d.rstrip('/'))
            if os.path.exists(os.path.join(d, n + '.glb')): yield g, n

if __name__ == '__main__':
    only = sys.argv[1:]
    os.makedirs(TMP, exist_ok=True)
    jobs = []
    for g, n in assets():
        if only and n not in only and g not in only: continue
        os.makedirs(dest_dir(g), exist_ok=True)
        for suf in AO: jobs.append((g, n, suf))
    res = []
    with Pool(8) as p:
        for r in p.imap_unordered(pack_one, jobs):
            res.append(r); print(*r, flush=True)
    json.dump(res, open(os.path.join(CONS, 'pack_result.json'), 'w'))
