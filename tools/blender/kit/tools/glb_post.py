"""Rewrite a Blender-exported GLB so its materials reference the SHARED texture library by relative URI.
Materials named 'kit:<id>' or 'kit:<id>~rrggbb' (sRGB tint) are rebuilt from lib/materials.json:
  baseColor/normal/ARM(metallicRoughness) on TEXCOORD_0 (shared, external URI),
  occlusionTexture = per-asset baked AO on TEXCOORD_1 (embedded JPEG), KHR_materials_specular where set,
  alphaMode BLEND for decals. Pure Python (json/struct/PIL) - runs inside Blender or standalone.
CLI: python3 glb_post.py in.glb [--ao ao.png] [--res 1k|2k] [--webp] [--lib-url URL_PREFIX]"""
import json, os, struct, io, sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(KIT, 'lib')


def read_glb(p):
    b = open(p, 'rb').read()
    magic, ver, ln = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67
    off, js, bin_ = 12, None, b''
    while off < ln:
        cl, ct = struct.unpack_from('<II', b, off)
        chunk = b[off + 8: off + 8 + cl]
        if ct == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ct == 0x004E4942:
            bin_ = chunk
        off += 8 + cl
    return js, bytearray(bin_)


def write_glb(p, js, bin_):
    while len(bin_) % 4:
        bin_ += b'\0'
    if js.get('buffers'):
        js['buffers'][0]['byteLength'] = len(bin_)
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    while len(jb) % 4:
        jb += b' '
    total = 12 + 8 + len(jb) + (8 + len(bin_) if bin_ else 0)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A) + jb)
        if bin_:
            f.write(struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_))


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def ao_jpeg(png, max_px=1024, q=82):
    from PIL import Image, ImageFilter
    im = Image.open(png).convert('L')
    if im.size[0] > max_px:
        im = im.resize((max_px, max_px), Image.LANCZOS)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    bio = io.BytesIO()
    im.save(bio, 'JPEG', quality=q, optimize=True)
    return bio.getvalue()


def rewrite(glb, ao_png=None, lib_res='1k', webp=False, lib_url=None, ao_px=1024):
    M = json.load(open(os.path.join(LIB, 'materials.json')))['materials']
    js, bin_ = read_glb(glb)
    base = lib_url.rstrip('/') + '/' if lib_url else os.path.relpath(LIB, os.path.dirname(os.path.abspath(glb))).replace(os.sep, '/') + '/'
    # drop Blender-exported images and compact the binary buffer (keeps only geometry bufferViews)
    drop = {im['bufferView'] for im in js.get('images', []) if 'bufferView' in im}
    if drop:
        nb, remap, views = bytearray(), {}, []
        for i, bv in enumerate(js['bufferViews']):
            if i in drop:
                continue
            while len(nb) % 4:
                nb += b'\0'
            chunk = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
            bv = dict(bv, byteOffset=len(nb))
            nb += chunk
            remap[i] = len(views)
            views.append(bv)
        js['bufferViews'] = views
        for a in js.get('accessors', []):
            if 'bufferView' in a:
                a['bufferView'] = remap[a['bufferView']]
        bin_ = nb
    js['images'], js['textures'] = [], []
    js['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    ext_used = set(e for e in js.get('extensionsUsed', []) if e not in ('EXT_texture_webp',))
    img_idx = {}

    def tex(rel, alpha=False):
        ext = '.webp' if webp else ('.png' if alpha else '.jpg')
        uri = base + rel + ext
        if uri not in img_idx:
            js['images'].append({'uri': uri, 'name': os.path.basename(rel)})
            t = {'sampler': 0}
            if webp:
                t['extensions'] = {'EXT_texture_webp': {'source': len(js['images']) - 1}}
                ext_used.add('EXT_texture_webp')
            else:
                t['source'] = len(js['images']) - 1
            js['textures'].append(t)
            img_idx[uri] = len(js['textures']) - 1
        return img_idx[uri]

    ao_tex = None
    if ao_png and os.path.exists(ao_png):
        data = ao_jpeg(ao_png, ao_px)
        while len(bin_) % 4:
            bin_ += b'\0'
        js['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)})
        bin_ += data
        js['images'].append({'bufferView': len(js['bufferViews']) - 1, 'mimeType': 'image/jpeg', 'name': 'ao'})
        js['textures'].append({'sampler': 0, 'source': len(js['images']) - 1})
        ao_tex = len(js['textures']) - 1
    # which materials are used by primitives that carry TEXCOORD_1
    has_uv1 = set()
    for m in js.get('meshes', []):
        for pr in m['primitives']:
            if 'TEXCOORD_1' in pr['attributes'] and 'material' in pr:
                has_uv1.add(pr['material'])
    for i, mt in enumerate(js.get('materials', [])):
        nm = mt.get('name', '')
        if not nm.startswith('kit:'):
            continue
        key = nm[4:]
        mid, tint = (key.split('~') + [None])[:2]
        e = M.get(mid)
        if not e:
            print('glb_post: unknown material', mid)
            continue
        maps = e['maps']
        alpha = e.get('alpha')
        new = {'name': nm, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex(maps['diff'][lib_res], alpha in ('BLEND', 'MASK'))}}, 'extras': {'kit_id': mid}}
        pb = new['pbrMetallicRoughness']
        if tint:
            pb['baseColorFactor'] = [s2l(int(tint[j:j + 2], 16) / 255) for j in (0, 2, 4)] + [1.0]
        if 'arm' in maps:
            pb['metallicRoughnessTexture'] = {'index': tex(maps['arm'][lib_res])}
            pb['metallicFactor'] = e.get('metallic', 0.0)
            pb['roughnessFactor'] = e.get('rough_scale', 1.0)
        else:
            pb['metallicFactor'] = e.get('metallic', 0.0)
            pb['roughnessFactor'] = e.get('roughness', 0.9)
        if 'nor' in maps:
            new['normalTexture'] = {'index': tex(maps['nor'][lib_res]), 'scale': e.get('normalScale', 1.0)}
        if ao_tex is not None and i in has_uv1 and alpha != 'BLEND':
            new['occlusionTexture'] = {'index': ao_tex, 'texCoord': 1, 'strength': 1.0}
        if alpha:
            new['alphaMode'] = alpha
            if alpha == 'MASK':
                new['alphaCutoff'] = e.get('alphaCutoff', 0.5)
        if e.get('doubleSided'):
            new['doubleSided'] = True
        if 'specular' in e:
            new.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': e['specular']}
            ext_used.add('KHR_materials_specular')
        js['materials'][i] = new
    if ext_used:
        js['extensionsUsed'] = sorted(ext_used)
    else:
        js.pop('extensionsUsed', None)
    js.pop('extensionsRequired', None)
    write_glb(glb, js, bin_)
    return js


if __name__ == '__main__':
    a = sys.argv[1:]
    kw = {}
    if '--ao' in a:
        kw['ao_png'] = a[a.index('--ao') + 1]
    if '--res' in a:
        kw['lib_res'] = a[a.index('--res') + 1]
    if '--lib-url' in a:
        kw['lib_url'] = a[a.index('--lib-url') + 1]
    kw['webp'] = '--webp' in a
    rewrite(a[0], **kw)
    print('rewrote', a[0])
