#!/bin/bash
# idblack.sh <glb> [view] : attribute near-black pixels of <view> render to materials via bit-plane emissive ID renders
D=<claude-tmp>
K=$D/../kit; G=$1; V=${2:-game2}; T=$D/out/_t; mkdir -p $T/id; rm -f $T/id/*.glb
python3 - "$G" <<'PY'
import sys,json,math
sys.path.insert(0,'<claude-tmp>')
import glb_post as G
js,b=G.read_glb(sys.argv[1]); n=len(js['materials']); nb=max(1,math.ceil(math.log2(n+1)))
T='<claude-tmp>'
json.dump([m.get('name') for m in js['materials']],open(T+'names.json','w'))
for bit in range(nb):
    j=json.loads(json.dumps(js))
    for i,m in enumerate(j['materials']):
        on=((i+1)>>bit)&1
        m['pbrMetallicRoughness']={'baseColorFactor':[0,0,0,1],'metallicFactor':0,'roughnessFactor':1}
        for k in ('normalTexture','occlusionTexture','emissiveTexture'): m.pop(k,None)
        m['emissiveFactor']=[on]*3; m.pop('extensions',None); m['alphaMode']=m.get('alphaMode','OPAQUE')
    G.write_glb(T+f'b{bit}.glb',j,b)
print(nb)
PY
for f in $T/id/b*.glb; do timeout 100 node $K/review/render.mjs $f $T/id/r --views $V --theater desert > /dev/null 2>&1; done
python3 - "$D/out/_t/id" "$V" "$G" <<'PY'
import sys,json,glob,os
from PIL import Image; import numpy as np
d,V,G=sys.argv[1:4]; names=json.load(open(d+'/names.json'))
n=os.path.basename(G)[:-4]
orig=np.asarray(Image.open(os.path.join(os.path.dirname(G),'review',f'{n}_{V}.png')).convert('RGB')).astype(int)
fs=sorted(glob.glob(d+f'/r/b*_{V}.png'),key=lambda p:int(os.path.basename(p)[1:].split('_')[0]))
code=np.zeros(orig.shape[:2],int)
for f in fs:
    bit=int(os.path.basename(f)[1:].split('_')[0]); a=np.asarray(Image.open(f).convert('L')).astype(int)
    code|=((a>128).astype(int)<<bit)
blk=orig.max(-1)<20
print('black%%=%.2f'%(blk.mean()*100))
ids,c=np.unique(code[blk],return_counts=True)
for i,k in sorted(zip(ids,c),key=lambda t:-t[1])[:8]:
    ys,xs=np.nonzero(blk&(code==i))
    print('  %5.2f%%  %s  x%.2f y%.2f'%(k/blk.size*100, names[i-1] if 0<i<=len(names) else 'none/ground', xs.mean()/blk.shape[1], ys.mean()/blk.shape[0]))
PY
