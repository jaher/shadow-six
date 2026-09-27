"""Lift near-black materials: effective linear albedo luminance (baseColorFactor x mean lib texture) is floored at
FLOOR (0.04 = darkest real paint/charcoal/tar) so painted steel, cast iron, tar and char never render as a black
void under the game's NW sun + sky ambient. Hue is kept; factor channels capped at 1. Pure GLB-JSON edit."""
import os, sys, json
KIT = '<claude-tmp>'
sys.path.insert(0, KIT + '/tools')
_cache = {}
W = (0.2126, 0.7152, 0.0722)
DIELECTRIC_IRON = ('steel_painted', 'cast_iron', 'corrugated_rust')


def _texlin(path):
    if path not in _cache:
        from PIL import Image
        import numpy as np
        a = np.asarray(Image.open(path).convert('RGB').resize((64, 64))).astype(float) / 255
        _cache[path] = list((a ** 2.2).mean((0, 1)))
    return _cache[path]


def albedo_floor(glb, floor=0.045, glass_floor=0.03):
    import glb_post as G
    js, b = G.read_glb(glb)
    imgs, tex, n = js.get('images', []), js.get('textures', []), 0
    for m in js.get('materials', []):
        p = m.setdefault('pbrMetallicRoughness', {})
        # painted / rusted / charred iron is a dielectric surface: metalness here only killed the diffuse term and
        # turned dark paint into black mirrors in shade (bare galvanised zinc keeps its metalness)
        if any(k in m.get('name', '') for k in DIELECTRIC_IRON) and p.get('metallicFactor', 1.0) > 0.15:
            p['metallicFactor'] = 0.15
            n += 1
        fac = list((p.get('baseColorFactor') or [1, 1, 1, 1]))
        t = p.get('baseColorTexture')
        tl = [1, 1, 1]
        if t is not None:
            uri = imgs[tex[t['index']]['source']].get('uri')
            if not uri:
                continue
            tl = _texlin(os.path.normpath(os.path.join(os.path.dirname(glb), uri)))
        eff = [fac[i] * tl[i] for i in range(3)]
        lum = sum(eff[i] * W[i] for i in range(3))
        fl = glass_floor if 'glass' in m.get('name', '') else floor
        if 'decal' in m.get('name', '') or lum >= fl:
            continue
        if lum < 1e-4:
            fac[:3] = [fl / max(1e-4, sum(tl[i] * W[i] for i in range(3)))] * 3
        else:
            k = fl / lum
            fac[:3] = [min(1.0, c * k) for c in fac[:3]]
            # capped channels: add grey to reach the floor
            for _ in range(4):
                lum2 = sum(fac[i] * tl[i] * W[i] for i in range(3))
                if lum2 >= fl * 0.98:
                    break
                fac[:3] = [min(1.0, c + (fl - lum2)) for c in fac[:3]]
        p['baseColorFactor'] = [round(c, 5) for c in fac[:3]] + [fac[3]]
        n += 1
    G.write_glb(glb, js, b)
    return n


if __name__ == '__main__':
    for g in sys.argv[1:]:
        print(os.path.basename(g), 'lifted', albedo_floor(g))
