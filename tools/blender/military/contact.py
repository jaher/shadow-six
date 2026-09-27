import sys, os
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
W = 1200; cw = W // cols
ims = [Image.open(f).convert('RGB') for f in files]
ch = int(cw * ims[0].size[1] / ims[0].size[0])
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (W, rows * ch), (20, 20, 20)); d = ImageDraw.Draw(S)
for i, (f, im) in enumerate(zip(files, ims)):
    im = im.resize((cw, int(cw * im.size[1] / im.size[0])))
    x, y = (i % cols) * cw, (i // cols) * ch
    S.paste(im.crop((0, 0, cw, ch)), (x, y)); d.text((x + 5, y + 4), os.path.basename(f)[:-4], fill=(255, 255, 0))
if S.size[1] > 1200: S = S.resize((int(W * 1200 / S.size[1]), 1200))
S.save(out, quality=84); print(out, S.size, os.path.getsize(out))
