"""Effective-albedo floor, vertex-colour part: glTF COLOR_0 (linear, ubyte after colors_to_ubyte) multiplies the base
colour, so heavy grime/char vertex colours on an already-dark material gave pure-black pixels. Per primitive the
per-vertex effective luminance (material lum x vcol lum) is raised to FLOOR by scaling the vcol RGB (hue kept, alpha =
decal opacity untouched). Run after albedo_floor. In-place edit of the ubyte view (same size)."""
import os, sys, struct
sys.path.insert(0, os.path.dirname(__file__))
from albedo_floor import _texlin, W, KIT
sys.path.insert(0, KIT + '/tools')


def mat_lum(js, glb, m):
    p = m.get('pbrMetallicRoughness', {})
    fac = (p.get('baseColorFactor') or [1, 1, 1, 1])
    t = p.get('baseColorTexture')
    tl = [1, 1, 1]
    if t is not None:
        uri = js['images'][js['textures'][t['index']]['source']].get('uri')
        if uri:
            tl = _texlin(os.path.normpath(os.path.join(os.path.dirname(glb), uri)))
    return sum(fac[i] * tl[i] * W[i] for i in range(3))


def vcol_floor(glb, floor=0.03):
    import glb_post as G
    js, b = G.read_glb(glb)
    b = bytearray(b)
    done, nv = set(), 0
    for me in js['meshes']:
        for p in me['primitives']:
            ai = p['attributes'].get('COLOR_0')
            if ai is None or ai in done or p.get('material') is None:
                continue
            m = js['materials'][p['material']]
            if 'decal' in m.get('name', '') or 'glass' in m.get('name', ''):
                continue
            a = js['accessors'][ai]
            if a['componentType'] != 5121 or a['type'] != 'VEC4':
                continue
            done.add(ai)
            ml = max(1e-4, mat_lum(js, glb, m))
            need = floor / ml                      # min vcol luminance
            if need <= 0:
                continue
            bv = js['bufferViews'][a['bufferView']]
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            st = bv.get('byteStride', 4)
            for i in range(a['count']):
                o = off + i * st
                r, g, bb = b[o] / 255, b[o + 1] / 255, b[o + 2] / 255
                l = r * W[0] + g * W[1] + bb * W[2]
                if l >= need:
                    continue
                if l < 1e-3:
                    r = g = bb = min(1.0, need)
                else:
                    k = need / l
                    r, g, bb = min(1, r * k), min(1, g * k), min(1, bb * k)
                b[o], b[o + 1], b[o + 2] = int(r * 255 + .5), int(g * 255 + .5), int(bb * 255 + .5)
                nv += 1
    G.write_glb(glb, js, bytes(b))
    return nv


if __name__ == '__main__':
    fl = float(os.environ.get('VFLOOR', 0.03))
    for g in sys.argv[1:]:
        print(os.path.basename(g), 'vcol raised', vcol_floor(g, fl))
