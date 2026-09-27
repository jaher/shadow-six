import json, struct, sys
f = open(sys.argv[1], 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + jl])
rows = []
for m in J['meshes']:
    n = sum(J['accessors'][p['indices']]['count'] // 3 for p in m['primitives'])
    rows.append((n, m.get('name', '?')))
rows.sort(reverse=True); print('meshes', len(rows), 'tot', sum(r[0] for r in rows))
for n, nm in rows[:int(sys.argv[2]) if len(sys.argv) > 2 else 20]: print(' ', n, nm)
