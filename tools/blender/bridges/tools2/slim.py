"""Bridges: post-export GLB slimming (copied from art/desert/scripts/dz.py, same precedent):
COLOR_0 -> ubyte VEC4; KHR_mesh_quantization NORMAL/TANGENT byte, TEXCOORD_1 ushort. Also updates sidecar 'bytes'.
CLI: python3 slim.py outdir/<asset>   (all .glb in dir)"""
import sys, os, json
KIT = '<claude-tmp>'


def colors_to_ubyte(glb):
    """Repack COLOR_0 (float/ushort from Blender) as normalized UNSIGNED_BYTE VEC4 (core glTF) to save bytes."""
    sys.path.insert(0, KIT + '/tools')
    import glb_post as G, struct as S
    js, b = G.read_glb(glb)
    nb = bytearray()
    views = js['bufferViews']
    remap = {}
    for m in js['meshes']:
        for p in m['primitives']:
            ai = p['attributes'].get('COLOR_0')
            if ai is None or ai in remap:
                continue
            a = js['accessors'][ai]
            bv = views[a['bufferView']]
            n, comps = a['count'], {'VEC3': 3, 'VEC4': 4}[a['type']]
            fmt = {5126: ('f', 4, 1.0), 5123: ('H', 2, 65535.0), 5121: ('B', 1, 255.0)}[a['componentType']]
            if a['componentType'] == 5121:
                continue
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride', fmt[1] * comps)
            out = bytearray()
            for i in range(n):
                vals = S.unpack_from('<%d%s' % (comps, fmt[0]), b, off + i * stride)
                q = [max(0, min(255, int(round(v / fmt[2] * 255)))) for v in vals] + ([255] if comps == 3 else [])
                out += bytes(q)
            remap[ai] = out
    if not remap:
        return
    for ai, out in remap.items():        # append new views at the end of the BIN chunk
        while len(b) % 4:
            b.append(0)
        views.append({'buffer': 0, 'byteOffset': len(b), 'byteLength': len(out)})
        b += out
        a = js['accessors'][ai]
        a.update({'bufferView': len(views) - 1, 'componentType': 5121, 'normalized': True, 'type': 'VEC4'})
        a.pop('byteOffset', None)
        a.pop('min', None); a.pop('max', None)
    # compact: drop now-unused views by rebuilding the buffer
    used = sorted({a['bufferView'] for a in js['accessors'] if 'bufferView' in a} | {i['bufferView'] for i in js.get('images', []) if 'bufferView' in i})
    nb, newidx = bytearray(), {}
    for vi in used:
        v = views[vi]
        while len(nb) % 4:
            nb.append(0)
        chunk = b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        nv = dict(v, byteOffset=len(nb))
        newidx[vi] = len(newidx)
        nb += chunk
        views[vi] = nv
    js['bufferViews'] = [views[vi] for vi in used]
    for a in js['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = newidx[a['bufferView']]
    for i in js.get('images', []):
        if 'bufferView' in i:
            i['bufferView'] = newidx[i['bufferView']]
    G.write_glb(glb, js, nb)


def quantize_glb(glb):
    """KHR_mesh_quantization (core three.js GLTFLoader support, no decoder): NORMAL -> BYTE norm (stride 4),
    TANGENT -> BYTE norm, TEXCOORD_1 (AO atlas, 0..1) -> UNSIGNED_SHORT norm. ~40 % smaller geometry."""
    sys.path.insert(0, KIT + '/tools')
    import glb_post as G, struct as S
    js, b = G.read_glb(glb)
    views = js['bufferViews']
    done = {}
    def rd(a):
        bv = views[a['bufferView']]
        n, comps = a['count'], {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 4 * comps)
        return [S.unpack_from('<%df' % comps, b, off + i * stride) for i in range(n)]
    for m in js['meshes']:
        for p in m['primitives']:
            for att, (ct, fmt, scale, pad) in {'NORMAL': (5120, 'b', 127.0, 1), 'TANGENT': (5120, 'b', 127.0, 0),
                                              'TEXCOORD_1': (5123, 'H', 65535.0, 0)}.items():
                ai = p['attributes'].get(att)
                if ai is None or ai in done:
                    continue
                a = js['accessors'][ai]
                if a['componentType'] != 5126:
                    continue
                vals = rd(a)
                out = bytearray()
                for v in vals:
                    if att == 'TEXCOORD_1':
                        q = [max(0, min(65535, int(round(min(1.0, max(0.0, c)) * scale)))) for c in v]
                    else:
                        q = [max(-127, min(127, int(round(c * scale)))) for c in v]
                    out += S.pack('<%d%s' % (len(q), fmt), *q) + (b'\0' * pad)
                while len(b) % 4:
                    b.append(0)
                nv = {'buffer': 0, 'byteOffset': len(b), 'byteLength': len(out), 'target': 34962}
                if pad:
                    nv['byteStride'] = 4
                views.append(nv)
                b += out
                a.update({'bufferView': len(views) - 1, 'componentType': ct, 'normalized': True})
                a.pop('byteOffset', None); a.pop('min', None); a.pop('max', None)
                done[ai] = 1
    if not done:
        return
    for k in ('extensionsUsed', 'extensionsRequired'):
        js.setdefault(k, [])
        if 'KHR_mesh_quantization' not in js[k]:
            js[k].append('KHR_mesh_quantization')
    used = sorted({a['bufferView'] for a in js['accessors'] if 'bufferView' in a} | {i['bufferView'] for i in js.get('images', []) if 'bufferView' in i})
    nb, newidx = bytearray(), {}
    for vi in used:
        v = views[vi]
        while len(nb) % 4:
            nb.append(0)
        chunk = b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        views[vi] = dict(v, byteOffset=len(nb))
        newidx[vi] = len(newidx)
        nb += chunk
    js['bufferViews'] = [views[vi] for vi in used]
    for a in js['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = newidx[a['bufferView']]
    for i in js.get('images', []):
        if 'bufferView' in i:
            i['bufferView'] = newidx[i['bufferView']]
    G.write_glb(glb, js, nb)



def slim_dir(d):
    for f in sorted(os.listdir(d)):
        if f.endswith('.glb'):
            p = os.path.join(d, f); s0 = os.path.getsize(p)
            colors_to_ubyte(p); quantize_glb(p)
            print('slim %s %dK -> %dK' % (f, s0 // 1024, os.path.getsize(p) // 1024))
    for f in os.listdir(d):
        if f.endswith('.kit.json'):
            sp = os.path.join(d, f); sc = json.load(open(sp))
            for l in sc.get('lods', []):
                if os.path.exists(os.path.join(d, l['file'])):
                    l['bytes'] = os.path.getsize(os.path.join(d, l['file']))
            sc['vertex_colors'] = 'COLOR_0 ubyte (weathering/tide/grime x base colour)'
            sc['quantized'] = 'KHR_mesh_quantization (NORMAL/TANGENT byte, TEXCOORD_1 ushort)'
            json.dump(sc, open(sp, 'w'), indent=1)


if __name__ == '__main__':
    for d in sys.argv[1:]:
        slim_dir(d)
