# compose.py out.jpg width title rows_json - grid of frames (rows = views) with a title bar, JPEG <= ~300 KB
import sys, json
from PIL import Image, ImageDraw
out, width, title, rows = sys.argv[1], int(sys.argv[2]), sys.argv[3], json.loads(sys.argv[4])
ims = [[Image.open(f).convert('RGB') for f in r] for r in rows]
w, h = ims[0][0].size; cols = max(len(r) for r in ims); bar = 22
canvas = Image.new('RGB', (w * cols, h * len(ims) + bar), (30, 30, 30))
d = ImageDraw.Draw(canvas); d.text((6, 5), title, fill=(235, 235, 235))
for y, r in enumerate(ims):
    for x, im in enumerate(r): canvas.paste(im, (x * w, bar + y * h))
if canvas.width > width: canvas = canvas.resize((width, int(canvas.height * width / canvas.width)), Image.LANCZOS)
q = 88
while True:
    canvas.save(out, quality=q, optimize=True)
    import os
    if os.path.getsize(out) <= 300_000 or q <= 50: break
    q -= 8
