# wheelcheck.py <root out|fast> [names...] -> per variant: min/max (wheel pivot y - radius) = tread height over the rail head
import json, sys, glob, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', sys.argv[1])
pat = sys.argv[2:] or ['*']
for p in sorted(sum([glob.glob(os.path.join(root, '*', n + '.kit.json')) for n in pat], [])):
    m = json.load(open(p))
    v = m.get('vehicle', {})
    d = [round(w['pivot'][1] - w['radius'], 3) for w in v.get('moving', []) if w.get('kind') == 'wheel']
    socks = {s['name']: s['pos'] for s in v.get('sockets', []) if s['name'] in ('driver', 'fireman', 'muzzle')}
    print('%-28s wheels %2d tread-rail min %6.3f max %6.3f  %s %s' % (os.path.basename(p)[:-9], len(d), min(d or [0]), max(d or [0]),
          socks, v.get('wreck_pose', '')[:30]))
