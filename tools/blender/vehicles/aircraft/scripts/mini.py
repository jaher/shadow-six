"""mini.py out.jpg cols img[@x0,y0,x1,y1]... -> <=1000 px wide JPEG grid (review budget)."""
import sys
from PIL import Image
out, cols = sys.argv[1], int(sys.argv[2])
ims = []
for a in sys.argv[3:]:
    p, _, c = a.partition('@')
    im = Image.open(p).convert('RGB')
    if c:
        im = im.crop(tuple(int(v) for v in c.split(',')))
    ims.append(im)
W = 1000 // cols
ims = [im.resize((W, int(im.size[1] * W / im.size[0])), Image.LANCZOS) for im in ims]
H = max(i.size[1] for i in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (W * cols, H * rows), (0, 0, 0))
for k, im in enumerate(ims):
    S.paste(im, ((k % cols) * W, (k // cols) * H))
S.save(out, quality=80)
print(out, S.size)
