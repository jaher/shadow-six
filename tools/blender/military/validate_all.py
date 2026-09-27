import glob, os, json, subprocess, sys
sys.path.insert(0, 'scripts')
import glb_color8
KIT = '../kit'
def budget(n):
    if n.startswith(('villa', 'castle_gate', 'uboat')): return 30000
    if n.startswith('watchtower') or n.startswith('stockade_fence'): return 8000
    if n.startswith('mg_nest'): return 15000
    if n.startswith('castle_wall'): return 12000
    return 15000
bad = []
for d in sorted(glob.glob('out/*/')):
    n = os.path.basename(d.rstrip('/'))
    sc = os.path.join(d, n + '.kit.json')
    if not os.path.exists(sc): continue
    m = json.load(open(sc))
    for l in m['lods']:
        p = os.path.join(d, l['file']); glb_color8.pack(p); l['bytes'] = os.path.getsize(p)
    json.dump(m, open(sc, 'w'), indent=1)
    ex = ['--bridge'] if n.startswith(('uboat', 'castle_gate')) or n.endswith('_moat') else []
    r = subprocess.run(['python3', KIT + '/tools/validate.py', os.path.join(d, n + '.glb'), '--budget', str(budget(n))] + ex, capture_output=True, text=True)
    line = [x for x in r.stdout.splitlines() if x.startswith('{')]
    js = json.loads(line[-1]) if line else {'errors': ['no output: ' + r.stdout[-200:] + r.stderr[-200:]]}
    print('%-24s %6s %5s %s' % (n, js.get('tris'), js.get('mb'), js['errors']))
    if js['errors']: bad.append(n)
print('BAD', bad)
