"""sheet.py <prefix> <title> <views(comma)>: compact review sheet (game views cropped around the vehicle, native pixels)."""
import sys
from PIL import Image, ImageDraw, ImageFont
pre, title, views = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
import os
CW1, CH1 = [int(x) for x in os.environ.get("C1", "240,190").split(",")]
CW2, CH2 = [int(x) for x in os.environ.get("C2", "480,320").split(",")]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
cells = []
for v in views:
    im = Image.open('%s_%s.png' % (pre, v)).convert('RGB')
    w, h = im.size
    if v == 'game1':
        im = im.crop((w // 2 - CW1, h // 2 - CH1, w // 2 + CW1, h // 2 + CH1))
    elif v == 'game2':
        im = im.crop((w // 2 - CW2, h // 2 - CH2, w // 2 + CW2, h // 2 + CH2))
    cells.append((v, im))
W = 1280
row1 = [c for c in cells if c[0].startswith('game')]
row2 = [c for c in cells if not c[0].startswith('game')]
def fit(row, H):
    return [(v, im.resize((max(1, int(im.size[0] * H / im.size[1])), H), Image.LANCZOS) if v != 'game1' else im) for v, im in row]
out = []
for row, H in ((row1, 420), (row2, 400)):
    if not row:
        continue
    r = fit(row, H)
    tw = sum(im.size[0] for _, im in r)
    if tw > W:
        s = W / tw
        r = [(v, im.resize((int(im.size[0] * s), int(im.size[1] * s)), Image.LANCZOS)) for v, im in r]
    out.append(r)
Ht = 22 + sum(max(im.size[1] for _, im in r) for r in out)
S = Image.new('RGB', (W, Ht), (22, 22, 22))
d = ImageDraw.Draw(S)
d.text((6, 4), title, font=f, fill=(240, 240, 240))
y = 22
for r in out:
    x = 0
    for v, im in r:
        S.paste(im, (x, y))
        d.text((x + 6, y + 4), v + (' (1x, native px)' if v == 'game1' else ''), font=f, fill=(255, 255, 0))
        x += im.size[0]
    y += max(im.size[1] for _, im in r)
S.save(pre + '_sheet.jpg', quality=85)
print(pre + '_sheet.jpg', S.size)
