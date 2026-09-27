"""check.py <glb> : node names, overall bbox (game coords), sockets on/under ground, mesh-node pivots."""
import sys, json, numpy as np
sys.path.insert(0, 'rv3'); import glbinfo as G
p = sys.argv[1]; g = G.load(p); w = G.walk(g, 0)
k = json.load(open(p.replace('_lod1', '').replace('_lod2', '').replace('.glb', '.kit.json')))
names = [x[1] for x in w]
bad = [n for n in names if '.' in n]
mn = np.min([x[3][0] for x in w if x[3] is not None], 0); mx = np.max([x[3][1] for x in w if x[3] is not None], 0)
print('nodes', len(names), 'suffix-bad', bad, 'missing-in-glb', [n for n in k['nodes'] if n not in names])
print('bbox min', mn.round(3), 'max', mx.round(3), 'size', (mx - mn).round(3))
V = k['vehicle']
print('under-ground sockets', [(s['name'], s['pos']) for s in V['sockets'] if s['pos'][1] < -0.01])
print('exit sockets', [(s['name'], s['pos']) for s in V['sockets'] if s.get('role') == 'exit'])
for d in V['moving']:
    if d['kind'] in ('slat', 'rotor', 'wheel'):
        print('moving', d['node'], d['kind'], 'pivot', d['pivot'], 'axis_w', d.get('axis_world'), d.get('camber_deg', ''), d.get('head_tilt_deg', ''))
for x in w:
    if x[1].startswith(('slat', 'rotor', 'wheel')):
        print('node', x[1], 't', np.round(x[2], 3), 'bb', None if x[3] is None else (x[3][0].round(2), x[3][1].round(2)))
print('ground_angle', V.get('ground_angle_deg'), 'measured', V.get('measured_m'))
