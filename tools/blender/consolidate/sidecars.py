import json, os, glob
from pack import assets, dest_dir, ART
n = 0
for g, a in assets():
    src = os.path.join(ART, g, 'out', a); dd = dest_dir(g)
    k = json.load(open(os.path.join(src, a + '.kit.json')))
    for l in k.get('lods', []):
        l['bytes_src'] = l['bytes']; l['bytes'] = os.path.getsize(os.path.join(dd, l['file']))
    k['group'] = g
    json.dump(k, open(os.path.join(dd, a + '.kit.json'), 'w'), separators=(',', ':'))
    c = json.load(open(os.path.join(src, a + '.credits.json')))
    json.dump(c, open(os.path.join(dd, a + '.credits.json'), 'w'), indent=1)
    n += 1
print(n, 'assets')
