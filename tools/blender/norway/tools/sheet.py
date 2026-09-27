"""sheet.py out.jpg cols name:view[:crop] ... -> contact sheet (<=1200 px), crop = centre fraction kept."""
import sys, os
from PIL import Image, ImageDraw
O = '<claude-tmp>'
out, cols, items = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
cw = 1200 // cols
cells = []
for it in items:
    b = it.split(':'); n, v = b[0], b[1]; cr = float(b[2]) if len(b) > 2 else 1.0
    p = os.path.join(O, n, 'review', '%s_%s.png' % (n, v))
    im = Image.open(p).convert('RGB') if os.path.exists(p) else Image.new('RGB', (960, 640), (80, 0, 0))
    w, h = im.size; cwid, chei = int(w * cr), int(h * cr)
    im = im.crop(((w - cwid) // 2, (h - chei) // 2, (w + cwid) // 2, (h + chei) // 2)).resize((cw, int(cw * 2 / 3)), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 7 * len(it) + 6, 13), fill=(0, 0, 0)); d.text((3, 1), it, fill=(255, 230, 0))
    cells.append(im)
ch = cells[0].size[1]; rows = (len(cells) + cols - 1) // cols
S = Image.new('RGB', (cw * cols, ch * rows), (20, 20, 20))
for k, c in enumerate(cells):
    S.paste(c, ((k % cols) * cw, (k // cols) * ch))
S.thumbnail((1200, 1200)); S.save(out, quality=85); print(S.size, os.path.getsize(out))
