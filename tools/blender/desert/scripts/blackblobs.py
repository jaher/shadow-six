import sys
from PIL import Image
import numpy as np
from scipy import ndimage
p=sys.argv[1]
a=np.asarray(Image.open(p).convert('RGB')).astype(int)
H,W=a.shape[:2]
m=a.max(-1)<20
lab,n=ndimage.label(m)
s=ndimage.sum(m,lab,range(1,n+1))
o=ndimage.find_objects(lab)
idx=np.argsort(-s)[:8]
print(p.split('/')[-1],W,H,'blobs',n,'total%.2f'%(m.mean()*100))
for i in idx:
    sl=o[i]; y0,y1=sl[0].start,sl[0].stop; x0,x1=sl[1].start,sl[1].stop
    # colour of ring around blob
    ring=ndimage.binary_dilation(lab==i+1,iterations=4)&~(lab==i+1)
    print(' px%6d  x%.2f-%.2f y%.2f-%.2f  ring rgb %s'%(s[i],x0/W,x1/W,y0/H,y1/H,a[ring].mean(0).astype(int)))
