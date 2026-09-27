"""cgrid.py out.jpg view crop cols name1 name2 ... -> grid of centre-cropped `view` renders (crop = fraction kept)."""
import sys, os
from PIL import Image, ImageDraw
O = '<claude-tmp>'
out, view, crop, cols, names = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), sys.argv[5:]
cw = 1200 // cols
cells = []
for n in names:
    p = os.path.join(O, n, 'review', '%s_%s.png' % (n, view))
    im = Image.open(p).convert('RGB') if os.path.exists(p) else Image.new('RGB', (400, 300), (80, 0, 0))
    w, h = im.size
    cwid, chei = int(w * crop), int(h * crop)
    im = im.crop(((w - cwid) // 2, (h - chei) // 2, (w + cwid) // 2, (h + chei) // 2)).resize((cw, int(cw * chei / cwid)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 7 * len(n) + 6, 13), fill=(0, 0, 0))
    d.text((3, 1), n, fill=(255, 230, 0))
    cells.append(im)
ch = max(c.size[1] for c in cells)
rows = (len(cells) + cols - 1) // cols
S = Image.new('RGB', (cw * cols, ch * rows), (20, 20, 20))
for k, c in enumerate(cells):
    S.paste(c, ((k % cols) * cw, (k // cols) * ch))
S.thumbnail((1200, 1200))
S.save(out, quality=85)
print(S.size, os.path.getsize(out))
