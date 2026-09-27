import json, struct, sys, collections
f = open(sys.argv[1], 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + jl])
c = collections.Counter(); tot = 0; col = False
for m in J['meshes']:
    for p in m['primitives']:
        n = J['accessors'][p['indices']]['count'] // 3
        c[J['materials'][p['material']]['name']] += n; tot += n
        col |= 'COLOR_0' in p['attributes']
        if 'COLOR_0' in p['attributes']: ct = J['accessors'][p['attributes']['COLOR_0']]['componentType']
print('total', tot, 'COLOR_0', col, ct if col else '')
for k, v in c.most_common(12): print(' ', k, v)
