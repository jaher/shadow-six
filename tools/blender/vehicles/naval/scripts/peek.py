# peek.py out.jpg img1 img2 ... [--w 1000] : tile images 2 per row into a <=1000 px jpg (<300 KB)
import sys
from PIL import Image
a = sys.argv[1:]
out, fs = a[0], a[1:]
ims = [Image.open(f).convert('RGB') for f in fs]
cols = 2 if len(ims) > 1 else 1
w = 1000 // cols
ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
rows = (len(ims) + cols - 1) // cols
h = max(im.height for im in ims)
S = Image.new('RGB', (w * cols, h * rows), (40, 40, 40))
for i, im in enumerate(ims):
    S.paste(im, ((i % cols) * w, (i // cols) * h))
S.save(out, quality=80)
