"""cs.py out.jpg asset:view[:crop] ...  -> 2-col contact sheet, each cell 600x450 (crop = centre fraction)"""
import sys, os
from PIL import Image, ImageDraw
out, items = sys.argv[1], sys.argv[2:]
D = '<claude-tmp>'
cw, ch = int(os.environ.get('CW', 600)), int(os.environ.get('CH', 450))
NC = int(os.environ.get('COLS', 2))
rows = (len(items) + NC - 1) // NC
sh = Image.new('RGB', (cw * NC, ch * rows), (30, 30, 30))
for i, it in enumerate(items):
    a, v, *c = it.split(':')
    im = Image.open('%s/%s/review/%s_%s.png' % (D, a, a, v)).convert('RGB')
    if c:
        f = float(c[0]); W, H = im.size; w, h = W * f, H * f
        im = im.crop((int((W - w) / 2), int((H - h) / 2), int((W + w) / 2), int((H + h) / 2)))
    im.thumbnail((cw, ch))
    x, y = (i % NC) * cw, (i // NC) * ch
    sh.paste(im, (x, y))
    ImageDraw.Draw(sh).text((x + 5, y + 5), a[-18:] + ' ' + v, fill=(255, 255, 0))
sh.save(out, quality=82)
print(sh.size)
