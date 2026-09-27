"""contact.py out.jpg cols path1 path2 ... -> grid contact sheet <=1200x1200 with labels"""
import sys, os
from PIL import Image, ImageDraw
out, cols, paths = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(p).convert('RGB') for p in paths]
rows = (len(ims) + cols - 1) // cols
tw = 1200 // cols
th = min(1200 // rows, int(tw * max(i.size[1] / i.size[0] for i in ims)))
sheet = Image.new('RGB', (tw * cols, th * rows), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for k, (im, p) in enumerate(zip(ims, paths)):
    im.thumbnail((tw, th))
    x, y = (k % cols) * tw, (k // cols) * th
    sheet.paste(im, (x, y))
    d.text((x + 4, y + 2), os.path.basename(p)[:-4], fill=(255, 255, 0))
sheet.save(out, quality=86)
print(sheet.size, os.path.getsize(out))
