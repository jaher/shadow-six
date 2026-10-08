#!/usr/bin/env python3
"""Building texture library housekeeping (art integration 2, step 4 — asset size).

  python3 tools/perf/lib_textures.py            # 512 set for preset 'low' + dedupe identical 1k files
  python3 tools/perf/lib_textures.py --tiers    # 256 + 128 sets (texel-density tiers, src/engine/texel-budget.js)

- assets/textures/lib/512/<name>: every 1k map downscaled (Lanczos) to 512, same name and format (JPEG q85, PNG
  optimised). src/art/building-library.js swaps 1k → 512 URIs at quality 'low' (buildings then fetch a quarter).
- Byte-identical 1k files are removed; the survivor is recorded in models/buildings/manifest.json
  textures.aliases {removed: kept}, which the loader applies to every GLB image URI (one fetch, one GPU upload).
"""
import hashlib, json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '../../assets')
LIB = os.path.join(ROOT, 'textures/lib')
MAN = os.path.join(ROOT, 'models/buildings/manifest.json')

def main():
    src, out = os.path.join(LIB, '1k'), os.path.join(LIB, '512')
    os.makedirs(out, exist_ok=True)
    seen, aliases = {}, {}
    for n in sorted(os.listdir(src)):
        p = os.path.join(src, n)
        h = hashlib.md5(open(p, 'rb').read()).hexdigest()
        if h in seen:
            aliases[n] = seen[h]
            os.remove(p)
            continue
        seen[h] = n
        im = Image.open(p)
        if im.width > 512:
            im = im.resize((512, max(1, im.height * 512 // im.width)), Image.LANCZOS)
        if n.endswith('.png'):
            im.save(os.path.join(out, n), 'PNG', optimize=True)
        else:
            im.convert('RGB').save(os.path.join(out, n), 'JPEG', quality=85, optimize=True, subsampling=2)
    for a in aliases:
        q = os.path.join(out, a)
        if os.path.exists(q): os.remove(q)
    m = json.load(open(MAN))
    m['textures'].setdefault('aliases', {}).update(aliases)
    m['textures']['low'] = '512'
    open(MAN, 'w').write(json.dumps(m, separators=(',', ':'), ensure_ascii=False))
    tot = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f'512 set: {len(os.listdir(out))} files, {tot / 1e6:.1f} MB; aliases {aliases}')

def tiers(sizes=(256, 128)):
    """Smaller copies of every 1k map (Lanczos from the 1k original, same name / format / encoder settings as the 512
    set). The loaders pick, per map, the smallest size whose texels per metre on its most stretched surface still
    cover the closest view (assets/textures/lib/density.json), so these draw the same picture as the 1k map."""
    src = os.path.join(LIB, '1k')
    for size in sizes:
        out = os.path.join(LIB, str(size))
        os.makedirs(out, exist_ok=True)
        for n in sorted(os.listdir(src)):
            im = Image.open(os.path.join(src, n))
            if im.width > size:
                im = im.resize((size, max(1, im.height * size // im.width)), Image.LANCZOS)
            if n.endswith('.png'):
                im.save(os.path.join(out, n), 'PNG', optimize=True)
            else:
                im.convert('RGB').save(os.path.join(out, n), 'JPEG', quality=85, optimize=True, subsampling=2)
        tot = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
        print(f'{size} set: {len(os.listdir(out))} files, {tot / 1e6:.1f} MB')

if __name__ == '__main__':
    import sys
    if '--tiers' in sys.argv:
        tiers()
    else:
        main()
