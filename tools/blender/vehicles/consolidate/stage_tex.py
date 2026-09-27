"""Stage textures for the packed vehicle GLBs.
- shared lib (kit lib/1k + group libs): only files NOT already in the game's assets/textures/lib/1k (dedupe by name),
  JPEG q80 -> stage/assets/textures/lib/1k/
- armour per-asset atlases -> stage/assets/models/vehicles/armour/tex/: 2k dropped (LOD0 URIs rewritten to the 1k set),
  albedo 1k q76, normal 1k q85, ORM 512 px q80 (file name kept), track + 512 sets q80.
Writes tex_result.json."""
import os, io, sys, json, glob, shutil
REPO = os.environ.get('SHADOW_REPO') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..'))
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); VEH = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, 'tools/blender/consolidate'))
import glbio
GAME_LIB = os.path.join(REPO, 'assets/textures/lib/1k/')
OUT_LIB = os.path.join(HERE, 'stage/assets/textures/lib/1k/')
ARM = os.path.join(HERE, 'stage/assets/models/vehicles/armour/')

def jpg(src, dst, q, size=None):
    im = Image.open(src); im = im.convert('L' if im.mode == 'L' else 'RGB')
    if size and max(im.size) > size: im = im.resize((size, size * im.size[1] // im.size[0]), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True)
    d = b.getvalue()
    if size is None and len(d) >= os.path.getsize(src): shutil.copy(src, dst)
    else: open(dst, 'wb').write(d)
    return os.path.getsize(dst)

res = {'lib_new': {}, 'lib_reused': [], 'armour': {}}
R = json.load(open(os.path.join(HERE, 'pack_result.json')))
libs = {}
for r in R:
    for f in r[6]:
        if '/armour/out/' not in f: libs[os.path.basename(f)] = f
os.makedirs(OUT_LIB, exist_ok=True)
for bn, src in sorted(libs.items()):
    if os.path.exists(GAME_LIB + bn): res['lib_reused'].append(bn); continue
    res['lib_new'][bn] = [os.path.relpath(src, VEH), jpg(src, OUT_LIB + bn, 80)]

os.makedirs(ARM + 'tex', exist_ok=True)
for d in sorted(glob.glob(os.path.join(VEH, 'armour/out/*/tex'))):
    for p in sorted(glob.glob(d + '/*.jpg')):
        bn = os.path.basename(p)
        if '_2k' in bn or bn in res['armour']: continue
        if bn.startswith('track_'): q, s = 80, None
        elif '_normal_' in bn: q, s = 85, None
        elif '_orm_' in bn: q, s = 80, 512
        else: q, s = 72, None
        res['armour'][bn] = jpg(p, ARM + 'tex/' + bn, q, s)

# armour GLBs: point every 2k reference at the 1k file
for g in glob.glob(ARM + '*.glb'):
    j, b = glbio.read(g); ch = False
    for im in j.get('images', []):
        u = im.get('uri', '')
        if '_2k.' in u: im['uri'] = u.replace('_2k.', '_1k.'); ch = True
        if 'uri' in im: assert os.path.exists(ARM + im['uri']), (g, im['uri'])
    if ch: glbio.write(g, j, b)
json.dump(res, open(os.path.join(HERE, 'tex_result.json'), 'w'), indent=1)
print('lib new', len(res['lib_new']), round(sum(v[1] for v in res['lib_new'].values()) / 1e6, 2), 'MB; reused', len(res['lib_reused']),
      '| armour tex', len(res['armour']), round(sum(res['armour'].values()) / 1e6, 2), 'MB')
