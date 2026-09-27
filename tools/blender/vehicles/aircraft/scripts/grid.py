"""grid.py out.jpg cols img1 img2 ... : tile review PNGs (each scaled to 1280/cols wide) with labels."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, cols, fs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
W = 1280 // cols
ims = []
for p in fs:
    im = Image.open(p).convert('RGB')
    im = im.resize((W, int(im.size[1] * W / im.size[0])), Image.LANCZOS)
    ims.append((os.path.basename(p).replace('.png', ''), im))
H = max(im.size[1] for _, im in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (W * cols, H * rows), (22, 22, 22))
d = ImageDraw.Draw(S)
for i, (n, im) in enumerate(ims):
    x, y = (i % cols) * W, (i // cols) * H
    S.paste(im, (x, y))
    d.text((x + 5, y + 4), n, font=f, fill=(255, 255, 0))
S.save(out, quality=85)
print(out, S.size)
