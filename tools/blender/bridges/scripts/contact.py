"""contact.py out.jpg cols tile_w tile_h img1 img2 ... (label = filename stem)"""
import sys
from PIL import Image, ImageDraw
out, cols, tw, th = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
ims = sys.argv[5:]
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for k, p in enumerate(ims):
    im = Image.open(p).convert('RGB')
    im.thumbnail((tw, th))
    x, y = (k % cols) * tw, (k // cols) * th
    sheet.paste(im, (x + (tw - im.width) // 2, y + (th - im.height) // 2))
    d.text((x + 4, y + 2), p.split('/')[-1][:60], fill=(255, 255, 0))
sheet.save(out, quality=85)
print(sheet.size)
