import sys, os
from PIL import Image, ImageDraw, ImageFont
out, W, cols, title = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
items = sys.argv[5:]                      # path=label
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
cw = W // cols
ims = []
for it in items:
    p, lab = it.split('=')
    im = Image.open(p).convert('RGB'); im = im.resize((cw, int(cw * im.size[1] / im.size[0])), Image.LANCZOS); ims.append((im, lab))
ch = max(im.size[1] for im, _ in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (W, rows * ch + 30), (22, 22, 22)); d = ImageDraw.Draw(S)
d.text((8, 6), title, font=ft, fill=(235, 235, 235))
for i, (im, lab) in enumerate(ims):
    x, y = (i % cols) * cw, 30 + (i // cols) * ch
    S.paste(im, (x, y)); d.rectangle((x, y, x + 8 + 8.5 * len(lab), y + 22), fill=(0, 0, 0)); d.text((x + 5, y + 3), lab, font=f, fill=(255, 220, 90))
if max(S.size) > 1280:
    k = 1280 / max(S.size); S = S.resize((int(S.size[0] * k), int(S.size[1] * k)), Image.LANCZOS)
S.save(out, quality=86, optimize=True); print(out, S.size, os.path.getsize(out))
