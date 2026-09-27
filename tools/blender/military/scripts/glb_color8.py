"""Repack COLOR_n vertex colours of a GLB from unsigned-short / float to normalized unsigned byte (glTF-legal, halves or
quarters the colour stream; the kit grime colours are 8-bit sRGB-ish data anyway). Pure python, in place.
Usage: python3 glb_color8.py a.glb [b.glb ...]"""
import sys, os, json, struct, array
sys.path.insert(0, '<claude-tmp>')
import glb_post as G

NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
SZ = {5121: 1, 5123: 2, 5126: 4}


def pack(path):
    js, bin_ = G.read_glb(path)
    col_acc = set()
    for m in js.get('meshes', []):
        for pr in m['primitives']:
            for k, a in pr['attributes'].items():
                if k.startswith('COLOR_'):
                    col_acc.add(a)
    views = js['bufferViews']
    repl = {}
    for ai in col_acc:
        a = js['accessors'][ai]
        ct = a['componentType']
        if ct == 5121 or 'bufferView' not in a:
            continue
        bv = views[a['bufferView']]
        nc = NC[a['type']]
        stride = bv.get('byteStride', nc * SZ[ct])
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        out = bytearray(a['count'] * 4)
        fmt = '<' + ('H' if ct == 5123 else 'f') * nc
        for i in range(a['count']):
            vals = struct.unpack_from(fmt, bin_, base + i * stride)
            for c in range(4):
                v = vals[c] if c < nc else (65535 if ct == 5123 else 1.0)
                out[i * 4 + c] = max(0, min(255, int(round(v / 257.0 if ct == 5123 else v * 255.0))))
        repl[a['bufferView']] = bytes(out)
        a['componentType'] = 5121
        a['normalized'] = True
        a['type'] = 'VEC4'
        a.pop('byteOffset', None)
    if not repl:
        return 0
    nb = bytearray()
    for i, bv in enumerate(views):
        while len(nb) % 4:
            nb += b'\0'
        chunk = repl.get(i)
        if chunk is None:
            chunk = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        else:
            bv.pop('byteStride', None)
        bv['byteOffset'] = len(nb)
        bv['byteLength'] = len(chunk)
        nb += chunk
    before = os.path.getsize(path)
    G.write_glb(path, js, nb)
    return before - os.path.getsize(path)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, 'saved', pack(p))
