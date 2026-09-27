"""Build the shared material library: src/raw/<id>/{diff,nor,rough,ao,arm}.jpg -> lib/{2k,1k}/<id>_{diff,nor,arm}.{jpg,webp}
+ lib/materials.json (+ credits). Grades albedo (tint / luminance breakup / target mean), multiplies tiling AO into
albedo (cavity), packs ARM (R=ao, G=rough, B=metal). Usage: python3 build_lib.py [id ...]"""
import json, os, sys
import numpy as np
from PIL import Image

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, LIB = os.path.join(KIT, 'src'), os.path.join(KIT, 'lib')
cfg = json.load(open(os.path.join(SRC, 'lib_config.json')))
cred = json.load(open(os.path.join(SRC, 'credits_raw.json')))
for r in ('1k', '2k'):
    os.makedirs(os.path.join(LIB, r), exist_ok=True)
mj_path = os.path.join(LIB, 'materials.json')
MJ = json.load(open(mj_path)) if os.path.exists(mj_path) else {'version': 1, 'materials': {}}


def load(p, mode='RGB', size=2048):
    im = Image.open(p).convert(mode)
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def save(arr, base, q=88):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    out = {}
    for res, sz in (('2k', 2048), ('1k', 1024)):
        x = im if sz == im.size[0] else im.resize((sz, sz), Image.LANCZOS)
        pj = os.path.join(LIB, res, base + '.jpg')
        x.save(pj, quality=q, optimize=True)
        x.save(os.path.join(LIB, res, base + '.webp'), quality=q - 4, method=5)
        out[res] = res + '/' + base
    return out


def build(mid, c):
    src_id = c.get('from', mid)
    d = os.path.join(SRC, 'raw', src_id)
    diff = load(os.path.join(d, 'diff.jpg'))
    ao = load(os.path.join(d, 'ao.jpg'), 'L') if os.path.exists(os.path.join(d, 'ao.jpg')) else np.ones((2048, 2048), np.float32)
    rough = load(os.path.join(d, 'rough.jpg'), 'L')
    nor = load(os.path.join(d, 'nor.jpg'))
    lin = s2l(diff)
    if c.get('target'):
        tgt = s2l(np.array(c['target'], np.float32))
        L = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        mL = L.mean()
        rel = 1 + (L / max(mL, 1e-4) - 1) * c.get('lum', 1.0)
        colz = tgt[None, None, :] * rel[..., None]
        orig = lin * (tgt @ np.array([0.2126, 0.7152, 0.0722]) / max(mL, 1e-4)) * (1 + (L / max(mL, 1e-4) - 1) * (c.get('lum', 1.0) - 1))[..., None]
        k = c.get('col', 0.5)
        lin = orig * (1 - k) + colz * k
        # re-hit the target mean per channel
        lin = lin * (tgt / np.maximum(lin.reshape(-1, 3).mean(0), 1e-4))[None, None, :]
    lin = lin * (0.55 + 0.45 * ao[..., None])            # cavity AO in albedo (45%)
    lin = np.minimum(lin, s2l(np.float32(0.80)))         # clamp albedo (verifier: whites <= ~0.75-0.8 sRGB)
    diff_s = l2s(lin)
    metal = c.get('metal', 0.0)
    arm = np.stack([ao, rough, np.full_like(ao, 1.0 if metal > 0 else 0.0)], -1)
    files = {'diff': save(diff_s, mid + '_diff'), 'nor': save(nor, mid + '_nor', 92), 'arm': save(arm, mid + '_arm')}
    cr = cred.get(src_id, {})
    tile = c.get('tile_m') or round(cr.get('dimensions_mm', [2000])[0] / 1000.0, 3)
    mean = [round(float(x), 4) for x in diff_s.reshape(-1, 3).mean(0)]
    MJ['materials'][mid] = {
        'label': c.get('label', mid), 'tile_m': tile, 'grain': c.get('grain', 'u'), 'rot90': c.get('rot90', False),
        'roughness': c.get('rough', 0.85), 'metallic': metal, 'grime': c.get('grime', 1.0), 'mean': mean,
        'normalScale': c.get('nstr', 1.0), 'maps': files,
        'source': {k: cr.get(k) for k in ('source', 'id', 'url', 'authors', 'license', 'name')},
        'texel_density_px_per_m': {'1k': round(1024 / tile), '2k': round(2048 / tile)}}
    print('built', mid, 'tile', tile, 'mean', mean, flush=True)


if __name__ == '__main__':
    ids = sys.argv[1:] or [k for k in cfg if not k.startswith('_')]
    for mid in ids:
        build(mid, cfg[mid])
        json.dump(MJ, open(mj_path, 'w'), indent=1)
    print('DONE')
