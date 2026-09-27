#!/usr/bin/env python3
"""sheet.py out.jpg --cols N --w MAXW [--crop l,t,r,b fractions] [--labels] img...  -> contact sheet JPEG (labels = file stem)"""
import sys, os, argparse
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('imgs', nargs='+')
ap.add_argument('--cols', type=int, default=4); ap.add_argument('--w', type=int, default=1000)
ap.add_argument('--crop', default=None); ap.add_argument('--labels', action='store_true'); ap.add_argument('--q', type=int, default=82)
a = ap.parse_args()
ims = []
for p in a.imgs:
    im = Image.open(p).convert('RGB')
    if a.crop:
        l, t, r, b = [float(x) for x in a.crop.split(',')]
        W, H = im.size
        im = im.crop((int(l * W), int(t * H), int(r * W), int(b * H)))
    ims.append((os.path.splitext(os.path.basename(p))[0], im))
cw = a.w // a.cols
ch = int(cw * ims[0][1].size[1] / ims[0][1].size[0])
rows = (len(ims) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (cw * a.cols, ch * rows), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(ims):
    x, y = (i % a.cols) * cw, (i // a.cols) * ch
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    if a.labels:
        d.rectangle((x, y, x + 7 * len(n) + 6, y + 14), fill=(0, 0, 0)); d.text((x + 3, y + 2), n, fill=(255, 255, 255))
sheet.save(a.out, quality=a.q)
print(a.out, sheet.size, os.path.getsize(a.out) // 1024, 'KB')
