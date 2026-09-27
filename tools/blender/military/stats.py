import json, glob, os, subprocess
rows = []
for d in sorted(glob.glob('out/*/')):
    n = os.path.basename(d.rstrip('/'))
    sc = os.path.join(d, n + '.kit.json')
    if not os.path.exists(sc):
        continue
    m = json.load(open(sc))
    l = m.get('lods', [])
    glb = os.path.join(d, n + '.glb')
    import struct
    b = open(glb, 'rb').read(); ln = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + ln])
    col = any('COLOR_0' in pr['attributes'] for mm in js['meshes'] for pr in mm['primitives'])
    t0 = l[0]['tris'] if l else 0
    rows.append((n, t0, l[1]['tris'] if len(l) > 1 else 0, l[2]['tris'] if len(l) > 2 else 0, round(l[0]['bytes'] / 1e6, 2) if l else 0,
                 len(m['doors']), len(m['footprints']), col, os.path.getmtime(glb)))
for r in rows:
    print('%-26s %6d %6d %6d  %.2fMB doors=%d fp=%d col=%s lod2=%.0f%%' % (r[:8] + (100 * r[3] / max(1, r[1]),)))
