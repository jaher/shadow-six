"""compose.py out.jpg title cols cell_w crop(game2|none) label=png ... : labelled grid sheet (<=1280 px wide)."""
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, cols, cw, crop = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
items = [a.split('=', 1) for a in sys.argv[6:]]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
ims = []
for lab, p in items:
    im = Image.open(p).convert('RGB')
    w, h = im.size
    if crop == 'game2':
        im = im.crop((w // 2 - 250, h // 2 - 270, w // 2 + 250, h // 2 + 250))
    elif crop == 'close':
        im = im.crop((int(w * 0.08), int(h * 0.12), int(w * 0.92), int(h * 0.98)))
    im = im.resize((cw, int(im.size[1] * cw / im.size[0])), Image.LANCZOS)
    ims.append((lab, im))
ch = max(im.size[1] for _, im in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * cw, 26 + rows * ch), (20, 20, 20))
d = ImageDraw.Draw(S)
d.text((8, 5), title, font=f, fill=(235, 235, 235))
for k, (lab, im) in enumerate(ims):
    x, y = (k % cols) * cw, 26 + (k // cols) * ch
    S.paste(im, (x, y))
    d.rectangle((x, y, x + 8 + 8 * len(lab), y + 20), fill=(0, 0, 0))
    d.text((x + 5, y + 3), lab, font=f, fill=(255, 225, 90))
if S.size[0] > 1280:
    S = S.resize((1280, int(S.size[1] * 1280 / S.size[0])), Image.LANCZOS)
S.save(out, quality=86, optimize=True)
print(out, S.size)
