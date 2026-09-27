"""Stage shared library textures actually referenced by the packed GLBs: 1k (JPEG q80 / PNG) + 2k ultra (albedo only, WebP q75)."""
import json, io, os, shutil
from PIL import Image
from multiprocessing import Pool
L = '../kit/lib/'; O = 'stage/assets/textures/lib/'
refs = json.load(open('texrefs.json'))
def one(f):
    src = L + '1k/' + f; dst = O + '1k/' + f
    if f.endswith('.jpg'):
        b = io.BytesIO(); Image.open(src).convert('RGB').save(b, 'JPEG', quality=80, optimize=True)
        d = b.getvalue()
        if len(d) < os.path.getsize(src): open(dst, 'wb').write(d)
        else: shutil.copy(src, dst)
    else: shutil.copy(src, dst)
    kind = f.rsplit('_', 1)[1].split('.')[0]
    if kind in ('diff', 'rgba'):
        im = Image.open(L + '2k/' + f)
        w = O + '2k/' + f.rsplit('.', 1)[0] + '.webp'
        im.save(w, 'WEBP', quality=70, method=5)
        return f, os.path.getsize(dst), os.path.getsize(w)
    return f, os.path.getsize(dst), 0
if __name__ == '__main__':
    os.makedirs(O + '1k', exist_ok=True); os.makedirs(O + '2k', exist_ok=True)
    with Pool(8) as p: R = p.map(one, refs)
    print('1k MB', sum(r[1] for r in R) / 2**20, '2k MB', sum(r[2] for r in R) / 2**20, 'n2k', sum(1 for r in R if r[2]))
    json.dump({'ultra2k': sorted(r[0] for r in R if r[2])}, open('ultra2k.json', 'w'))
