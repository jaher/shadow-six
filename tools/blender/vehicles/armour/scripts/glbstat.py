import sys, json, struct, collections
d = open(sys.argv[1], 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; J = json.loads(d[20:20 + jl])
c = collections.Counter(); tot = 0
for n in J['nodes']:
    if 'mesh' in n:
        t = sum(J['accessors'][p['indices']]['count'] // 3 for p in J['meshes'][n['mesh']]['primitives'])
        k = n['name'].rstrip('0123456789').rstrip('_LR') if len(sys.argv) < 3 else n['name']
        c[k] += t; tot += t
print(tot, c.most_common(25))
print('nodes', len(J['nodes']), 'materials', [m['name'] for m in J['materials']])
