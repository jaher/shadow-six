"""docsheet.py out.jpg "title" cols (label=img.png)... : captioned grid, width 1280, <= 300 KB JPEG."""
import sys, os, math
from PIL import Image, ImageDraw, ImageFont
out, title, cols = sys.argv[1], sys.argv[2], int(sys.argv[3])
items = [a.split('=', 1) for a in sys.argv[4:]]
W = 1280; cw = W // cols
ims = [Image.open(p).convert('RGB') for _, p in items]
ch = int(cw * ims[0].size[1] / ims[0].size[0])
rows = math.ceil(len(ims) / cols)
H = rows * ch + 30
sh = Image.new('RGB', (W, H), (20, 20, 20)); d = ImageDraw.Draw(sh)
fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
d.text((8, 6), title, font=fb, fill=(240, 240, 240))
for k, ((lab, _), im) in enumerate(zip(items, ims)):
    x, y = (k % cols) * cw, 30 + (k // cols) * ch
    sh.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    d.rectangle((x, y, x + len(lab) * 8 + 10, y + 18), fill=(0, 0, 0))
    d.text((x + 5, y + 2), lab, font=f, fill=(255, 225, 90))
q = 88
while True:
    sh.save(out, quality=q)
    if os.path.getsize(out) < 300000 or q < 50: break
    q -= 6
print(out, sh.size, os.path.getsize(out) // 1024, 'KB')
