"""compose_docs.py out.jpg title cols 'label=path[@crop x0,y0,x1,y1]' ... : labelled docs sheet, 1280 px wide JPEG."""
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, cols = sys.argv[1], sys.argv[2], int(sys.argv[3])
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
W = 1280 // cols
cells = []
for a in sys.argv[4:]:
    lab, _, p = a.partition('=')
    p, _, crop = p.partition('@')
    im = Image.open(p).convert('RGB')
    if crop:
        im = im.crop(tuple(int(v) for v in crop.split(',')))
    im = im.resize((W, int(im.size[1] * W / im.size[0])), Image.LANCZOS)
    cells.append((lab, im))
rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
H = 28 + sum(max(im.size[1] for _, im in r) for r in rows)
S = Image.new('RGB', (W * cols, H), (20, 20, 20))
d = ImageDraw.Draw(S)
d.text((8, 5), title, font=fb, fill=(235, 235, 235))
y = 28
for r in rows:
    for i, (lab, im) in enumerate(r):
        S.paste(im, (i * W, y))
        d.rectangle((i * W, y, i * W + len(lab) * 8 + 10, y + 20), fill=(0, 0, 0))
        d.text((i * W + 5, y + 2), lab, font=f, fill=(255, 220, 90))
    y += max(im.size[1] for _, im in r)
S.save(out, quality=86)
print(out, S.size)
