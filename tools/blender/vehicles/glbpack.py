#!/usr/bin/env python3
"""glbpack.py - re-encode / downsize the embedded textures of a GLB (pure Python + PIL, no Node needed).
Usage: glbpack.py in.glb out.glb [--albedo 2048] [--normal 2048] [--orm 1024] [--q 85] [--webp]
Images are classified by name suffix (_albedo/_normal/_orm, as written by blib.bake_atlas).
--webp re-encodes as WebP and declares EXT_texture_webp (three.js GLTFLoader supports it natively)."""
import json, struct, sys, io, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--albedo', type=int, default=2048); ap.add_argument('--normal', type=int, default=2048)
ap.add_argument('--orm', type=int, default=1024); ap.add_argument('--q', type=int, default=85)
ap.add_argument('--webp', action='store_true')
a = ap.parse_args()

f = open(a.src, 'rb').read()
magic, ver, total = struct.unpack('<III', f[:12])
assert magic == 0x46546C67
jl, jt = struct.unpack('<II', f[12:20]); J = json.loads(f[20:20 + jl])
off = 20 + jl
bl, bt = struct.unpack('<II', f[off:off + 8]); BIN = f[off + 8:off + 8 + bl]

views = [BIN[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in J['bufferViews']]
for im in J.get('images', []):
    name = im.get('name', '')
    kind = 'normal' if 'normal' in name else 'orm' if 'orm' in name else 'albedo'
    lim = getattr(a, kind)
    pim = Image.open(io.BytesIO(views[im['bufferView']]))
    alpha = 'A' in pim.mode
    pim = pim.convert('RGBA' if alpha else 'RGB')
    if max(pim.size) > lim:
        pim = pim.resize((lim, lim * pim.size[1] // pim.size[0]), Image.LANCZOS)
    out = io.BytesIO()
    if a.webp:
        pim.save(out, 'WEBP', quality=a.q, method=6)
        im['mimeType'] = 'image/webp'
    elif alpha:
        pim.save(out, 'PNG', optimize=True)
        im['mimeType'] = 'image/png'
    else:
        pim.save(out, 'JPEG', quality=a.q, optimize=True, subsampling=0 if kind != 'albedo' else 2)
        im['mimeType'] = 'image/jpeg'
    old = len(views[im['bufferView']])
    views[im['bufferView']] = out.getvalue()
    print(f'{name:28s} {kind:6s} -> {pim.size[0]}px {old // 1024} KB -> {len(out.getvalue()) // 1024} KB')
if a.webp:
    for t in J.get('textures', []):
        if 'source' in t:
            t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': t.pop('source')}
    for k in ('extensionsUsed', 'extensionsRequired'):
        J[k] = sorted(set(J.get(k, [])) | {'EXT_texture_webp'})
# rebuild BIN with 4-byte alignment
nb = bytearray()
for v, data in zip(J['bufferViews'], views):
    while len(nb) % 4: nb.append(0)
    v['byteOffset'] = len(nb); v['byteLength'] = len(data); nb += data
while len(nb) % 4: nb.append(0)
J['buffers'][0]['byteLength'] = len(nb)
js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(nb)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
    + struct.pack('<II', len(nb), 0x004E4942) + bytes(nb)
open(a.dst, 'wb').write(glb)
print(f'{a.src} {len(f) // 1024} KB -> {a.dst} {len(glb) // 1024} KB')
