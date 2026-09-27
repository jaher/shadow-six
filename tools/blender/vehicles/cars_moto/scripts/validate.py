"""validate.py [dir=out]: rw2 checks on every vehicle variant (wreck metadata, contacts, LOD node names, handedness, dims)."""
import json, glob, os, sys, struct
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
def nodes(p):
    b = open(p, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + n])
    return [nd.get('name', '') for nd in js['nodes']]
bad = 0
for f in sorted(glob.glob(os.path.join(D, '*', '*.kit.json'))):
    m = json.load(open(f)); v = m['vehicle']; a = m['asset']; errs = []
    if v.get('destroyed'):
        if [e for e in v['emitters'] if e['kind'] in ('exhaust', 'dust', 'mud', 'snow_spray')]: errs.append('wreck emitters')
        if v['lights'] or v['contacts']: errs.append('wreck lights/contacts')
        if [x for x in v['moving'] if x['kind'] in ('wheel', 'steer', 'steering_wheel', 'wheel_free')]: errs.append('wreck wheel moving')
    cn = [c['name'] for c in v['contacts']]
    if len(cn) != len(set(cn)): errs.append('dup contacts %s' % cn)
    for lvl in ('', '_lod1', '_lod2'):
        nm = nodes(f.replace('.kit.json', lvl + '.glb'))
        if [x for x in nm if '.' in x]: errs.append('suffix names ' + lvl)
        if lvl and not [x for x in nm if x.startswith('seat') or x.startswith('muzzle') or x.startswith('cargo')] and not v.get('destroyed'): errs.append('no sockets ' + lvl)
    sw = [x for x in v['moving'] if x['kind'] == 'steering_wheel']
    if sw and sw[0]['pivot'][0] <= 0: errs.append('steering wheel not on the left (+X)')
    drv = [s for s in v['sockets'] if s.get('role') == 'driver']
    if drv and 'r75' not in a and drv[0]['pos'][0] <= 0: errs.append('driver not left')
    if 'r75' in a:
        ws = [x for x in v['moving'] if x['node'] == 'wheel_s']
        if ws and ws[0]['pivot'][0] >= 0: errs.append('sidecar not right')
        nt = [l for l in v['lights'] if l['kind'] == 'notek']
        if nt and nt[0]['node'] != 'fork': errs.append('notek node %s' % nt[0]['node'])
    if m['bbox_game']['min'][1] < -0.03: errs.append('sinks %.3f' % m['bbox_game']['min'][1])
    print('%-28s %s L%.2f W%.2f H%.2f %s' % (a, 'OK ' if not errs else 'ERR', v['measured_m']['length'], v['measured_m']['width'],
                                           v['measured_m']['height'], '; '.join(errs)))
    bad += bool(errs)
print('bad', bad)
