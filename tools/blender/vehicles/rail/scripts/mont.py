# mont.py out.jpg cols w img1 img2 ... -> simple montage (each tile w px wide, aspect kept), labels = file stems
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = []
for p in sys.argv[4:]:
    im = Image.open(p).convert('RGB'); h = int(im.height * w / im.width); im = im.resize((w, h))
    ImageDraw.Draw(im).text((4, 4), p.split('/')[-1][:-4], fill=(255, 255, 0)); ims.append(im)
rows = (len(ims) + cols - 1) // cols
H = max(i.height for i in ims)
M = Image.new('RGB', (cols * w, rows * H), (40, 40, 40))
for k, im in enumerate(ims):
    M.paste(im, ((k % cols) * w, (k // cols) * H))
M.save(out, quality=82); print(out, M.size)
