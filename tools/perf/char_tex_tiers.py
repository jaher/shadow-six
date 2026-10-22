#!/usr/bin/env python3
"""Character texture tiers (perf/download-speed-2): what a mission must download before play, without quality loss.

  python3 tools/perf/char_tex_tiers.py <glb>...            # tier the character body GLBs among the paths
  python3 tools/perf/char_tex_tiers.py --check <glb>...    # list body GLBs not tiered / HD files missing, exit 1 if any

Do not run this by hand after an art export: `node tools/perf/glb_gzip.mjs <paths>` (the one entry point for new or
re-exported GLBs) runs it on the character bodies among its paths before wrapping them.

Every character body GLB (assets/characters/{enemies,commandos,guests}/*.glb: one 1k atlas — albedo, normal — and a
512 ORM, plus a small alpha PNG) embedded its full-size atlas: 0.55 MB of the 0.8 MB file, and a mission loads 10-26
of them before its briefing. The game camera never needs those sizes before play: the bodies draw at LOD1/LOD2 below
120 px/m (enemies) or 60 px/m (commandos, guests), where the GPU samples the atlas' half-size mip level or smaller.
So:
  - the original images move, byte for byte, to `<dir>/hd/<image name>.jpg` (the HD tier);
  - the GLB embeds a half-size copy of each (2 x 2 box filter = what the GPU's own mip 1 of the original holds:
    albedo averaged in linear light, normal / ORM as stored; JPEG q90 4:2:0 like the originals);
  - each texture that samples one gets `extras: {hd: 'hd/<name>.jpg', hdSize: [w, h]}`, read at load by
    src/engine/texture-memory.js (registerHdTexture, src/engine/hd-textures.js): once the mission's loading screen has
    closed, the HD images download in the background and replace the half-size ones in place (same Texture objects:
    every body drawn from the template sharpens at once). Nothing gameplay reads depends on textures.
Geometry, skins, names, materials, the alpha PNG and every other byte range are kept as they are; the GLB's binary
chunk is re-laid out around the smaller images (meshopt streams copied verbatim). Idempotent: a GLB whose textures
already carry `extras.hd` is left alone (`--check` then only verifies its HD files exist).
Output GLBs are plain (glb_gzip.mjs wraps them); a gzip-wrapped input is read through.
"""
import gzip, io, json, os, struct, sys

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
GROUPS = ('enemies', 'commandos', 'guests')
SKIP = {'colonel_bust'}  # the briefing's close-up bust: keeps its full atlas in the GLB
SLOTS = ('_albedo', '_normal', '_orm')
MIN_SIDE = {'_albedo': 1024, '_normal': 1024, '_orm': 512}
QUALITY = 90


def is_body(path):
    p = os.path.abspath(path).replace('\\', '/')
    parts = p.split('/')
    if len(parts) < 3 or parts[-3] != 'characters' or parts[-2] not in GROUPS or not p.endswith('.glb'):
        return False
    return os.path.basename(p)[:-4] not in SKIP


def read_glb(path):
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    magic, version, length = struct.unpack_from('<4sII', raw, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError(f'{path}: not a glTF 2 binary')
    jlen, jtype = struct.unpack_from('<I4s', raw, 12)
    js = json.loads(raw[20:20 + jlen].decode('utf8'))
    off = 20 + jlen
    bin_ = b''
    if off < len(raw):
        blen, btype = struct.unpack_from('<I4s', raw, off)
        if btype == b'BIN\x00':
            bin_ = raw[off + 8:off + 8 + blen]
    return js, bin_


def write_glb(js, bin_):
    j = json.dumps(js, separators=(',', ':')).encode('utf8')
    j += b' ' * (-len(j) % 4)
    b = bin_ + b'\x00' * (-len(bin_) % 4)
    total = 12 + 8 + len(j) + (8 + len(b) if b else 0)
    out = io.BytesIO()
    out.write(struct.pack('<4sII', b'glTF', 2, total))
    out.write(struct.pack('<I4s', len(j), b'JSON'))
    out.write(j)
    if b:
        out.write(struct.pack('<I4s', len(b), b'BIN\x00'))
        out.write(b)
    return out.getvalue()


def slot_of(name):
    for s in SLOTS:
        if (name or '').endswith(s):
            return s
    return None


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def half(jpeg_bytes, srgb):
    """2 x 2 box filter of a JPEG (linear light for colour) → JPEG q90 4:2:0 bytes, and the new size."""
    im = Image.open(io.BytesIO(jpeg_bytes)).convert('RGB')
    a = np.asarray(im).astype(np.float64)
    h, w = a.shape[:2]
    if h % 2 or w % 2:
        raise ValueError(f'odd image size {w}x{h}')
    if srgb:
        a = srgb_to_lin(a)
    a = a.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
    if srgb:
        a = lin_to_srgb(a)
    out = Image.fromarray(np.clip(np.floor(a + 0.5), 0, 255).astype(np.uint8), 'RGB')
    buf = io.BytesIO()
    out.save(buf, 'JPEG', quality=QUALITY, subsampling=2, optimize=True)
    return buf.getvalue(), (w // 2, h // 2)


def hd_targets(js):
    """[(image index, slot)] of the atlas images that get an HD tier."""
    out = []
    for i, im in enumerate(js.get('images') or []):
        s = slot_of(im.get('name'))
        if s and im.get('mimeType') == 'image/jpeg' and 'bufferView' in im:
            out.append((i, s))
    return out


def tiered(js):
    return any((t.get('extras') or {}).get('hd') for t in js.get('textures') or [])


def relayout(js, bin_, replace):
    """New BIN with bufferView data replaced ({bufferView index: bytes}); every other range copied verbatim."""
    ranges = []  # (offset, length, kind, index)
    for i, bv in enumerate(js['bufferViews']):
        if bv.get('buffer', 0) == 0 and not ((js['buffers'][bv.get('buffer', 0)].get('extensions') or {}).get('EXT_meshopt_compression', {}).get('fallback')):
            ranges.append((bv.get('byteOffset', 0), bv['byteLength'], 'bv', i))
        mo = (bv.get('extensions') or {}).get('EXT_meshopt_compression')
        if mo and mo.get('buffer', 0) == 0:
            ranges.append((mo.get('byteOffset', 0), mo['byteLength'], 'mo', i))
    ranges.sort()
    for a, b in zip(ranges, ranges[1:]):
        if a[0] + a[1] > b[0]:
            raise ValueError('overlapping byte ranges in buffer 0')
    out = bytearray()
    for off, ln, kind, i in ranges:
        data = replace.get(i) if kind == 'bv' and i in replace else bin_[off:off + ln]
        align = 16 if off % 16 == 0 else 8 if off % 8 == 0 else 4 if off % 4 == 0 else 1
        out += b'\x00' * (-len(out) % align)
        if kind == 'bv':
            js['bufferViews'][i]['byteOffset'] = len(out)
            js['bufferViews'][i]['byteLength'] = len(data)
        else:
            js['bufferViews'][i]['extensions']['EXT_meshopt_compression']['byteOffset'] = len(out)
        out += data
    out += b'\x00' * (-len(out) % 4)
    js['buffers'][0]['byteLength'] = len(out)
    return bytes(out)


def tier_file(path):
    """Tier one body GLB in place (plain output). @returns (bytes before, bytes after, HD bytes) or None."""
    js, bin_ = read_glb(path)
    if tiered(js):
        return None
    targets = hd_targets(js)
    if not targets:
        return None
    hd_dir = os.path.join(os.path.dirname(path), 'hd')
    os.makedirs(hd_dir, exist_ok=True)
    srgb_images = set()
    for m in js.get('materials') or []:
        bc = ((m.get('pbrMetallicRoughness') or {}).get('baseColorTexture') or {}).get('index')
        if bc is not None:
            srgb_images.add(js['textures'][bc]['source'])
    replace, hd_bytes, done = {}, 0, {}
    for i, slot in targets:
        im = js['images'][i]
        bv = js['bufferViews'][im['bufferView']]
        data = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        w, h = Image.open(io.BytesIO(data)).size
        if min(w, h) < MIN_SIDE[slot]:
            continue
        small, _ = half(data, i in srgb_images)
        rel = f"hd/{im['name']}.jpg"
        with open(os.path.join(hd_dir, f"{im['name']}.jpg"), 'wb') as f:
            f.write(data)
        replace[im['bufferView']] = small
        done[i] = {'hd': rel, 'hdSize': [w, h]}
        hd_bytes += len(data)
    if not done:
        return None
    for t in js.get('textures') or []:
        if t.get('source') in done:
            t['extras'] = {**(t.get('extras') or {}), **done[t['source']]}
    before = os.path.getsize(path)
    out = write_glb(js, relayout(js, bin_, replace))
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(out)
    os.replace(tmp, path)
    return before, len(out), hd_bytes


def check_file(path):
    """Problems of one body GLB ([] = tiered, HD files present at their recorded size)."""
    js, _ = read_glb(path)
    targets = hd_targets(js)
    if not targets:
        return []
    if not tiered(js):
        return ['not tiered']
    bad = []
    for t in js.get('textures') or []:
        x = t.get('extras') or {}
        if not x.get('hd'):
            continue
        f = os.path.join(os.path.dirname(path), x['hd'])
        if not os.path.isfile(f):
            bad.append(f'missing {x["hd"]}')
        elif list(Image.open(f).size) != list(x.get('hdSize') or []):
            bad.append(f'{x["hd"]} is not {x.get("hdSize")}')
    return bad


def main(argv):
    check = '--check' in argv
    paths = [p for p in argv if not p.startswith('--')]
    files = []
    for p in paths:
        if os.path.isdir(p):
            for d, _, fs in os.walk(p):
                files += [os.path.join(d, f) for f in fs if f.endswith('.glb')]
        elif p.endswith('.glb'):
            files.append(p)
    files = sorted({os.path.abspath(f) for f in files if is_body(f)})
    if check:
        problems = [(f, check_file(f)) for f in files]
        problems = [(f, p) for f, p in problems if p]
        for f, p in problems:
            print(f'  {os.path.relpath(f, ROOT)}: {", ".join(p)}')
        print(f'{len(files) - len(problems)} of {len(files)} character body GLBs tiered (HD textures in hd/)')
        return 1 if problems else 0
    a = b = hd = n = 0
    for f in files:
        r = tier_file(f)
        if r:
            a += r[0]; b += r[1]; hd += r[2]; n += 1
    print(f'tiered {n} of {len(files)} character body GLBs: {a / 1e6:.1f} MB → {b / 1e6:.1f} MB plain (+ {hd / 1e6:.1f} MB HD in hd/)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
