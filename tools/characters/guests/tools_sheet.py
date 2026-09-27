# usage: python3 tools_sheet.py out.jpg maxw cols img1 img2 ...   (grid contact sheet, labels, JPEG q85)
import sys
from PIL import Image, ImageDraw
out, maxw, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
w = max(i.width for i in ims); h = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (w * cols, h * rows), (40, 40, 40))
d = ImageDraw.Draw(S)
for k, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (k % cols) * w, (k // cols) * h
    S.paste(im, (x, y)); d.text((x + 6, y + 4), p.split('/')[-1].rsplit('.', 1)[0], fill=(255, 255, 0))
if S.width > maxw:
    S = S.resize((maxw, int(S.height * maxw / S.width)), Image.LANCZOS)
S.save(out, quality=85); print(out, S.size)
