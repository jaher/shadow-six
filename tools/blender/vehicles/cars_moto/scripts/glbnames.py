import sys, json, struct
for p in sys.argv[1:]:
    b = open(p, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + n])
    print(p.split('/')[-1], [nd.get('name') for nd in js['nodes']][:40], 'meshes:', [m.get('name') for m in js['meshes']][:5])
