import json, struct, sys, collections
f = open(sys.argv[1], 'rb').read()
jl = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + jl])
c = collections.Counter()
used=set()
for m in J['meshes']:
    for p in m['primitives']:
        for k,a in list(p['attributes'].items())+[('IDX',p['indices'])]:
            bv=J['accessors'][a].get('bufferView'); 
            if bv in used: continue
            used.add(bv); c[k]+=J['bufferViews'][bv]['byteLength']
for im in J.get('images',[]):
    if 'bufferView' in im: c['IMG']+=J['bufferViews'][im['bufferView']]['byteLength']
print(sys.argv[1].split('/')[-1], 'total %dK'%(len(f)//1024), ' '.join('%s=%dK'%(k,v//1024) for k,v in c.most_common()), 'ext', J.get('extensionsUsed'))
