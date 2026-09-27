import sys
from PIL import Image, ImageDraw
# usage: csheet.py out.jpg cols cellw cellh img1 img2 ...   (images: path[:crop=x0,y0,x1,y1 fractions])
out, cols, cw, ch = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
ims = sys.argv[5:]
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * cw, rows * ch), (25, 25, 25)); d = ImageDraw.Draw(S)
for k, p in enumerate(ims):
    crop = None
    if '@@' in p:
        p, c = p.split('@@'); crop = [float(x) for x in c.split(',')]
    im = Image.open(p).convert('RGB')
    if crop:
        W, H = im.size; im = im.crop((int(crop[0]*W), int(crop[1]*H), int(crop[2]*W), int(crop[3]*H)))
    im.thumbnail((cw, ch))
    x, y = (k % cols) * cw, (k // cols) * ch
    S.paste(im, (x, y)); d.text((x + 4, y + 4), p.split('/')[-1][:-4], fill=(255, 255, 0))
S.save(out, quality=85); print(S.size)
