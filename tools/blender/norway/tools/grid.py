"""grid.py out.jpg cellw name1 [name2 ...] [--views game1,close,close_se]  -> contact sheet rows=assets cols=views"""
import sys, os
from PIL import Image, ImageDraw
O = '<claude-tmp>'
a = sys.argv[1:]
views = ['game1', 'close', 'close_se']
if '--views' in a:
    i = a.index('--views'); views = a[i + 1].split(','); a = a[:i] + a[i + 2:]
out, cw, names = a[0], int(a[1]), a[2:]
cells = []
for n in names:
    row = []
    for v in views:
        p = os.path.join(O, n, 'review', '%s_%s.png' % (n, v))
        im = Image.open(p).convert('RGB') if os.path.exists(p) else Image.new('RGB', (cw, cw), (60, 0, 0))
        im.thumbnail((cw, cw * 2))
        row.append(im)
    cells.append(row)
rh = [max(im.size[1] for im in row) for row in cells]
W = cw * len(views); H = sum(rh)
sheet = Image.new('RGB', (W, H), (20, 20, 20))
y = 0
d = ImageDraw.Draw(sheet)
for row, h, n in zip(cells, rh, names):
    for k, im in enumerate(row):
        sheet.paste(im, (k * cw, y))
    d.text((4, y + 2), n, fill=(255, 255, 0))
    y += h
sheet.thumbnail((1200, 1200))
sheet.save(out, quality=85)
print(sheet.size, os.path.getsize(out))
