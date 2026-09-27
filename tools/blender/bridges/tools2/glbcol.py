import json, struct, sys, numpy as np
f = open(sys.argv[1], 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + jl]); binoff = 20 + jl + 8
CT = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    o = binoff + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]; dt = CT[a['componentType']]
    arr = np.frombuffer(f[o:o + n * np.dtype(dt).itemsize], dt).reshape(a['count'], NC[a['type']]).astype(np.float32)
    if a.get('normalized'): arr /= np.iinfo(dt).max
    return arr
pat = sys.argv[2]; water = float(sys.argv[3])
for ni, nd in enumerate(J['nodes']):
    if 'mesh' not in nd: continue
    m = J['meshes'][nd['mesh']]
    for pi, p in enumerate(m['primitives']):
        mat = J['materials'][p['material']]['name']
        if pat not in mat and pat not in nd.get('name', ''): continue
        P = acc(p['attributes']['POSITION'])
        if 'COLOR_0' not in p['attributes']: print(nd.get('name'), mat, 'NO COLOR'); continue
        Cc = acc(p['attributes']['COLOR_0'])
        y = P[:, 1]; t = nd.get('translation', [0, 0, 0])[1]; y = y + t
        bands = [(-9, water - .3), (water - .3, water + .15), (water + .15, water + .45), (water + .45, water + .7), (water + .7, water + 2), (water + 2, 99)]
        s = ' '.join('%.1f:%d:%.2f' % (a, ((y >= a) & (y < b)).sum(), Cc[(y >= a) & (y < b), :3].mean() if ((y >= a) & (y < b)).any() else -1) for a, b in bands)
        print(nd.get('name'), mat[:30], len(P), s)
