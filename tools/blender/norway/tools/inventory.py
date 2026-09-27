"""Validate every Norway asset and print an inventory table (JSON lines + summary)."""
import os, json, subprocess, glob
O = '<claude-tmp>'
V = '<claude-tmp>'
WATER = ('naust', 'fishing_shed', 'cable_car_cabin', 'cable_station_lower')
rows = []
for d in sorted(glob.glob(O + '/*/')):
    n = os.path.basename(d.rstrip('/'))
    g = os.path.join(d, n + '.glb')
    if not os.path.exists(g):
        continue
    budget = 15000
    args = ['python3', V, g, '--budget', str(budget)] + (['--bridge'] if n.startswith(WATER) else [])
    out = subprocess.run(args, capture_output=True, text=True).stdout.strip().splitlines()
    res = json.loads(out[-1]) if out else {'errors': ['no output']}
    meta = json.load(open(os.path.join(d, n + '.kit.json')))
    lods = [(l['tris'], l['bytes']) for l in meta.get('lods', [])]
    rows.append(dict(name=n, tris=[t for t, _ in lods], ratio=[round(t / max(1, lods[0][0]), 2) for t, _ in lods], kb=[round(b / 1024) for _, b in lods], errors=res.get('errors'),
                     doors=len(meta.get('doors', [])), roofs=len(meta.get('roofs', [])), fp=len(meta.get('footprints', [])),
                     anchors=[a['name'] for a in meta.get('anchors', [])][:6]))
for r in rows:
    print(json.dumps(r))
print('assets', len(rows), 'with errors', sum(1 for r in rows if r['errors']))
