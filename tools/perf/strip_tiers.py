#!/usr/bin/env python3
"""Vegetation atlas start tier (perf/download-speed-2): half-size copies of the tree layer strips.

  python3 tools/perf/strip_tiers.py            # (re)make assets/terrain/<strip>.half.webp where missing or stale
  python3 tools/perf/strip_tiers.py --check    # list strips whose half copy is missing / stale / mis-sized, exit 1

Do not run this by hand after an art change: `node tools/perf/glb_gzip.mjs` (the one entry point for asset post-
processing) runs it whenever its paths include assets/terrain (or default to assets/).

The tree strips (src/art/terrain/vegetation.js VEGETATION_STRIPS: leaf / bark / needle albedo + normal arrays, 5.95 MB)
are drawn far below their full size at every game zoom: a 512 px leaf tile spans a card of a few decimetres, so even
the closest view (120-160 px/m) samples mip level 1 or smaller. A mission loads the half-size copies — each 2 x 2
box-filtered = the GPU's own mip 1 of the original, tile grid unchanged — and the originals replace them in place
once the loading screen has closed (src/art/terrain/vegetation.js registerHdJob, src/engine/hd-textures.js).
Encoding follows the original (lossless stays lossless, lossy ones are re-encoded at q90, method 6). The leaf / needle
coverage maps (foliage_n, needles_n: alpha-tested) get no half copy: their thresholds flip on small value changes. assets/terrain/strip-tiers.json records the SHA-1 of the
source each half copy was made from: a copy is stale when its source changed (content, not file times).
"""
import hashlib, io, json, os, sys

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
TERRAIN = os.path.join(ROOT, 'assets/terrain')
# (not the leaf / needle coverage maps foliage_n / needles_n: alpha-tested thresholds — they always load full size)
STRIPS = ['foliage', 'bark_albedo', 'bark_normal', 'needles']
RECORD = os.path.join(TERRAIN, 'strip-tiers.json')


def sha1(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


def record():
    try:
        with open(RECORD) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}
SRGB = {'foliage', 'bark_albedo', 'needles'}


def is_lossless(path):
    with open(path, 'rb') as f:
        head = f.read(16)
    return head[12:16] == b'VP8L'


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def half_image(im, srgb):
    a = np.asarray(im).astype(np.float64)
    h, w, ch = a.shape
    if h % 2 or w % 2:
        raise ValueError(f'odd size {w}x{h}')
    if srgb:
        a[..., :3] = srgb_to_lin(a[..., :3])
    a = a.reshape(h // 2, 2, w // 2, 2, ch).mean(axis=(1, 3))
    if srgb:
        a[..., :3] = lin_to_srgb(a[..., :3])
    return Image.fromarray(np.clip(np.floor(a + 0.5), 0, 255).astype(np.uint8), im.mode)


def make(name):
    src = os.path.join(TERRAIN, name + '.webp')
    dst = os.path.join(TERRAIN, name + '.half.webp')
    im = Image.open(src)
    im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
    out = half_image(im, name in SRGB)
    buf = io.BytesIO()
    if is_lossless(src):
        out.save(buf, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    else:
        out.save(buf, 'WEBP', quality=90, method=6)
    tmp = dst + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(buf.getvalue())
    os.replace(tmp, dst)
    return os.path.getsize(src), os.path.getsize(dst)


def problems(name, rec=None):
    src = os.path.join(TERRAIN, name + '.webp')
    dst = os.path.join(TERRAIN, name + '.half.webp')
    if not os.path.isfile(dst):
        return 'missing'
    if (rec if rec is not None else record()).get(name, {}).get('source') != sha1(src):
        return 'made from another version of its source'
    a, b = Image.open(src).size, Image.open(dst).size
    if (a[0] // 2, a[1] // 2) != b:
        return f'{b} is not half of {a}'
    return None


def main(argv):
    if '--check' in argv:
        bad = [(n, p) for n in STRIPS for p in [problems(n)] if p]
        for n, p in bad:
            print(f'  assets/terrain/{n}.half.webp: {p}')
        print(f'{len(STRIPS) - len(bad)} of {len(STRIPS)} vegetation strips have their half-size copy')
        return 1 if bad else 0
    a = b = n = 0
    rec = record()
    for name in STRIPS:
        if problems(name, rec) is None and '--force' not in argv:
            continue
        x, y = make(name)
        rec[name] = {'source': sha1(os.path.join(TERRAIN, name + '.webp')), 'half': sha1(os.path.join(TERRAIN, name + '.half.webp'))}
        a += x; b += y; n += 1
    if n:
        with open(RECORD, 'w') as f:
            json.dump(dict(sorted(rec.items())), f, indent=1)
            f.write('\n')
    print(f'vegetation half strips: {n} made ({a / 1e6:.2f} MB of sources -> {b / 1e6:.2f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
