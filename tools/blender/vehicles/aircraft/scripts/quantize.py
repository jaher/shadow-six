"""quantize.py <glb>... : lossless-enough vertex quantization for the big aircraft (three.js GLTFLoader supports it):
NORMAL float3 -> int8 normalized (KHR_mesh_quantization), TEXCOORD_1 (AO atlas, 0..1) -> uint16 normalized,
COLOR_0 stays 16 bit (kit: dark paints band at 8 bit). ~48 -> ~36 bytes / vertex. Positions and tiling TEXCOORD_0 stay float."""
import sys, os, struct
import numpy as np
sys.path.insert(0, '<claude-tmp>')
from glb_post import read_glb, write_glb

NC = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NN = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quantize(p):
    js, b = read_glb(p)
    noao = {i for i, m in enumerate(js.get('materials', [])) if m.get('name', '').endswith('~fffffd')}
    for i in noao:                                       # corrugation overlays: no baked AO (lightmap too coarse)
        js['materials'][i].pop('occlusionTexture', None)
    # rework 2: matt RLM finish on the corrugated airframe (no specular zebra / moire under the panning ortho camera):
    # uniform roughness 0.85, no metal chips, dielectric specular halved, overlay ridge normals softened
    for i, m in enumerate(js.get('materials', [])):
        if (m.get('extras') or {}).get('kit_id') in ('air_skin', 'air_corr'):
            pb = m.setdefault('pbrMetallicRoughness', {})
            pb.pop('metallicRoughnessTexture', None)
            pb['metallicFactor'] = 0.0
            pb['roughnessFactor'] = 0.85
            m.setdefault('extensions', {})['KHR_materials_specular'] = {'specularFactor': 0.5}
            if i in noao and 'normalTexture' in m:
                m['normalTexture']['scale'] = 0.4
            eu = js.setdefault('extensionsUsed', [])
            if 'KHR_materials_specular' not in eu:
                eu.append('KHR_materials_specular')
    for m in js['meshes']:
        for pr in m['primitives']:
            if pr.get('material') in noao:
                pr['attributes'].pop('TEXCOORD_1', None)
    role = {}
    for m in js['meshes']:
        for pr in m['primitives']:
            for k, i in pr['attributes'].items():
                role[i] = k
    views, out, vmap = [], bytearray(), {}

    def add(data, stride=None, target=None):
        while len(out) % 4:
            out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if stride:
            v['byteStride'] = stride
        if target:
            v['target'] = target
        out.extend(data)
        views.append(v)
        return len(views) - 1

    used_q = False
    used = {i for m in js['meshes'] for pr in m['primitives'] for i in list(pr['attributes'].values()) + [pr.get('indices')]}
    used |= {i for sk in js.get('skins', []) for i in [sk.get('inverseBindMatrices')]}
    used |= {c.get(k) for an in js.get('animations', []) for c in an.get('samplers', []) for k in ('input', 'output')}
    for i, a in enumerate(js['accessors']):
        if 'bufferView' not in a:
            continue
        if i not in used:                                # orphaned (stripped TEXCOORD_1): keep a tiny valid view
            a['count'] = 1
            a.pop('min', None), a.pop('max', None)
            a['bufferView'] = add(bytes(NN[a['type']] * np.dtype(NC[a['componentType']]).itemsize))
            a['byteOffset'] = 0
            continue
        bv = js['bufferViews'][a['bufferView']]
        n, ct = NN[a['type']], a['componentType']
        dt = NC[ct]
        st = bv.get('byteStride', 0) or n * np.dtype(dt).itemsize
        raw = bytes(b[bv.get('byteOffset', 0) + a.get('byteOffset', 0):][:st * (a['count'] - 1) + n * np.dtype(dt).itemsize])
        arr = np.ndarray((a['count'], n), dtype=dt, buffer=raw, strides=(st, np.dtype(dt).itemsize)).copy()
        r = role.get(i)
        tgt = bv.get('target')
        if r == 'NORMAL' and ct == 5126:
            q = np.clip(np.round(arr * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((a['count'], 1), np.int8)], axis=1)
            a.update({'bufferView': add(q.tobytes(), 4, tgt), 'componentType': 5120, 'normalized': True, 'byteOffset': 0})
            a.pop('min', None), a.pop('max', None)
            used_q = True
        elif r == 'TEXCOORD_1' and ct == 5126 and arr.min() >= -1e-4 and arr.max() <= 1 + 1e-4:
            q = np.clip(np.round(arr * 65535), 0, 65535).astype(np.uint16)
            a.update({'bufferView': add(q.tobytes(), 4, tgt), 'componentType': 5123, 'normalized': True, 'byteOffset': 0})
            a.pop('min', None), a.pop('max', None)
        else:
            key = a['bufferView']
            a['bufferView'] = add(arr.tobytes(), None if r is None else (st if st % 4 == 0 and st != n * np.dtype(dt).itemsize else None), tgt)
            a['byteOffset'] = 0
    for im in js.get('images', []):
        if 'bufferView' in im:
            bv = js['bufferViews'][im['bufferView']]
            data = bytes(b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])
            if im.get('mimeType') == 'image/jpeg' and len(data) > 120000:     # per-asset AO: re-encode q70
                import io
                from PIL import Image
                buf = io.BytesIO()
                im0 = Image.open(io.BytesIO(data)).convert('L')
                if im0.size[0] > 768:
                    im0 = im0.resize((768, 768), Image.LANCZOS)
                im0.save(buf, 'JPEG', quality=72, optimize=True)
                data = buf.getvalue() if len(buf.getvalue()) < len(data) else data
            im['bufferView'] = add(data)
    js['bufferViews'] = views
    if used_q:
        for k in ('extensionsUsed', 'extensionsRequired'):
            js.setdefault(k, [])
            if 'KHR_mesh_quantization' not in js[k]:
                js[k].append('KHR_mesh_quantization')
    n0 = os.path.getsize(p)
    write_glb(p, js, out)
    return n0, os.path.getsize(p)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, *quantize(p))
