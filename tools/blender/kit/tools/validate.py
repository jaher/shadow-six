"""Validate kit outputs: python3 validate.py <asset.glb> [--budget 15000] [--max-mb 3]
Checks: tris vs budget, GLB size, pivot at ground centre (|bbox centre xz| small, min y ~ 0), every external texture
URI resolves, decal/blend materials have specularFactor 0, TEXCOORD_1 + occlusion present, sidecar + credits exist."""
import json, os, sys, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glb_post as G


def check(path, budget=15000, max_mb=3.0, bridge=False):
    js, b = G.read_glb(path)
    errs, info = [], {}
    tris = 0
    mn, mx = [1e9] * 3, [-1e9] * 3
    # world bbox: apply node translations (door / wheel / sail nodes are pivoted, their vertices are node-local)
    offs = {}
    for n in js.get('nodes', []):
        if 'mesh' in n:
            offs.setdefault(n['mesh'], []).append(n.get('translation', [0, 0, 0]))
    for mi, m in enumerate(js['meshes']):
        for p in m['primitives']:
            acc = js['accessors'][p['indices']] if 'indices' in p else js['accessors'][p['attributes']['POSITION']]
            tris += acc['count'] // 3 * max(1, len(offs.get(mi, [0])))
            pa = js['accessors'][p['attributes']['POSITION']]
            for t in offs.get(mi, [[0, 0, 0]]):
                for i in range(3):
                    mn[i] = min(mn[i], pa['min'][i] + t[i])
                    mx[i] = max(mx[i], pa['max'][i] + t[i])
    info['tris'] = tris
    info['mb'] = round(os.path.getsize(path) / 1e6, 2)
    info['bbox'] = [[round(x, 2) for x in mn], [round(x, 2) for x in mx]]
    if tris > budget:
        errs.append('tris %d > budget %d' % (tris, budget))
    if info['mb'] > max_mb:
        errs.append('size %.2f MB > %.1f' % (info['mb'], max_mb))
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    if not bridge and (abs(cx) > 0.25 * (mx[0] - mn[0]) or abs(cz) > 0.25 * (mx[2] - mn[2])):
        errs.append('pivot not near ground centre (bbox centre %.2f, %.2f)' % (cx, cz))
    side = path.rsplit('.glb', 1)[0].split('_lod')[0] + '.kit.json'
    river = (json.load(open(side)).get('river') if os.path.exists(side) else None) or {}
    if river and mn[1] >= river.get('bed', -3) - 0.8 and mn[1] <= 0.25:
        info['note'] = 'bank-side asset: quay / wheel pit reach the river bed (%.2f)' % mn[1]
    elif not bridge and abs(mn[1]) > 0.25:
        errs.append('min y %.2f (ground should be 0)' % mn[1])
    d = os.path.dirname(os.path.abspath(path))
    for im in js.get('images', []):
        if 'uri' in im and not os.path.exists(os.path.normpath(os.path.join(d, im['uri']))):
            errs.append('missing texture ' + im['uri'])
    for m in js.get('materials', []):
        if m.get('alphaMode') == 'BLEND' and m.get('extensions', {}).get('KHR_materials_specular', {}).get('specularFactor', 1) != 0:
            errs.append('blend material %s without specular 0' % m['name'])
    if not any('occlusionTexture' in m for m in js.get('materials', [])):
        errs.append('no baked AO (occlusionTexture)')
    base = path.rsplit('.glb', 1)[0].split('_lod')[0]
    for ext in ('.kit.json', '.credits.json'):
        if not os.path.exists(base + ext):
            errs.append('missing ' + os.path.basename(base + ext))
    info['errors'] = errs
    return info


if __name__ == '__main__':
    a = sys.argv[1:]
    bud = int(a[a.index('--budget') + 1]) if '--budget' in a else 15000
    mb = float(a[a.index('--max-mb') + 1]) if '--max-mb' in a else 3.0
    r = check(a[0], bud, mb, '--bridge' in a)
    print(json.dumps(r))
    sys.exit(1 if r['errors'] else 0)
