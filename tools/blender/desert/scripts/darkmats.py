import json,struct,sys,os
from PIL import Image; import numpy as np
LIB='<claude-tmp>'
cache={}
def texlin(name):
    if name not in cache:
        a=np.asarray(Image.open(LIB+name).convert('RGB').resize((64,64))).astype(float)/255
        cache[name]=((a**2.2).mean((0,1)))
    return cache[name]
for n in sys.argv[1:]:
    f=open(f'out/{n}/{n}.glb','rb').read(); l=struct.unpack('<I',f[12:16])[0]; j=json.loads(f[20:20+l])
    imgs=j.get('images',[]); tex=j.get('textures',[])
    out=[]
    for m in j['materials']:
        p=m.get('pbrMetallicRoughness',{}); fac=np.array((p.get('baseColorFactor') or [1,1,1,1])[:3])
        t=p.get('baseColorTexture')
        if t is not None:
            uri=imgs[tex[t['index']]['source']].get('uri')
            if uri: fac=fac*texlin(os.path.basename(uri))
        lum=fac@[0.2126,0.7152,0.0722]
        if lum<0.06: out.append('%s=%.3f'%(m['name'],lum))
    print(n,' '.join(out))
