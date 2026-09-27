"""compose.py out.jpg title img... : 2-column contact sheet, labels from file names, max 1280 px wide/high, <=300 KB."""
import sys, os, math, json
from PIL import Image, ImageDraw, ImageFont
out, title, files = sys.argv[1], sys.argv[2], [f for f in sys.argv[3:] if os.path.exists(f)]
W = 1280; cw = W // 2
ims = [Image.open(f).convert('RGB') for f in files]
th = [int(im.size[1] * cw / im.size[0]) for im in ims]
rows = math.ceil(len(ims) / 2); rh = [max(th[r * 2:(r + 1) * 2]) for r in range(rows)]
H = sum(rh) + 24
sh = Image.new('RGB', (W, H), (22, 22, 22)); d = ImageDraw.Draw(sh)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
d.text((8, 4), title, font=f, fill=(240, 240, 240))
y = 24
for r in range(rows):
    for c in range(2):
        k = r * 2 + c
        if k < len(ims):
            sh.paste(ims[k].resize((cw, th[k]), Image.LANCZOS), (c * cw, y))
            lab = os.path.basename(files[k]).replace('.png', '').split('lod0_')[-1].split('lod1_')[-1]
            d.text((c * cw + 8, y + 6), lab, font=f, fill=(255, 230, 60))
    y += rh[r]
if H > 1280:
    sh = sh.resize((int(W * 1280 / H), 1280), Image.LANCZOS)
q = 85
while True:
    sh.save(out, quality=q)
    if os.path.getsize(out) < 300000 or q < 50: break
    q -= 7
print('sheet', out, sh.size, os.path.getsize(out) // 1024, 'KB')
