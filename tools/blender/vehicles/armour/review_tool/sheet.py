"""Contact sheet maker: python3 sheet.py out.jpg "title" img1.png img2.png ... (max 1200x1200, 2 columns)."""
import sys, math
from PIL import Image, ImageDraw, ImageFont
out, title, files = sys.argv[1], sys.argv[2], sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in files]
cols = 2 if len(ims) > 1 else 1
cw = 1200 // cols
th = [int(im.size[1] * cw / im.size[0]) for im in ims]
rows = math.ceil(len(ims) / cols)
rh = [max(th[r * cols:(r + 1) * cols]) for r in range(rows)]
H = sum(rh) + 22
sheet = Image.new('RGB', (1200, H), (24, 24, 24))
d = ImageDraw.Draw(sheet)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
d.text((6, 4), title, font=f, fill=(240, 240, 240))
y = 22
for r in range(rows):
    for c in range(cols):
        k = r * cols + c
        if k < len(ims):
            sheet.paste(ims[k].resize((cw, th[k]), Image.LANCZOS), (c * cw, y))
            d.text((c * cw + 6, y + 4), files[k].rsplit('_', 1)[-1].split('.')[0], font=f, fill=(255, 255, 0))
    y += rh[r]
if H > 1200:
    sheet = sheet.resize((int(1200 * 1200 / H), 1200), Image.LANCZOS)
sheet.save(out, quality=86)
