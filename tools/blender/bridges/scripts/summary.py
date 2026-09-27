import json, os
D = '<claude-tmp>'
names = [l.strip() for l in open(D + '/tmp/names.txt') if l.strip()]
for n in names:
    try:
        v = [l for l in open('%s/logs/%s.val' % (D, n)) if l.startswith('{')][-1]
        j = json.loads(v)
        m = json.load(open('%s/out/%s/%s.kit.json' % (D, n, n)))
        lods = [l['tris'] for l in m.get('lods', [])]
        print('%-32s tris=%6d mb=%.2f lods=%s err=%s mtime=%s' % (n, j['tris'], j['mb'], lods, j['errors'],
              os.path.getmtime('%s/out/%s/%s.glb' % (D, n, n)) // 60 % 1440))
    except Exception as e:
        print(n, 'ERR', e)
