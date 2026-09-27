"""hero.py out.jpg title name:view name:view ... -> 3-column labelled sheet, 1280 px wide JPEG"""
import sys, os
from PIL import Image, ImageDraw
O = '<claude-tmp>'
out, title, items = sys.argv[1], sys.argv[2], sys.argv[3:]
cw, ch, hd = 426, 284, 30
rows = (len(items) + 2) // 3
S = Image.new('RGB', (1280, hd + rows * ch), (24, 24, 24))
d = ImageDraw.Draw(S)
d.text((8, 8), title, fill=(240, 240, 240))
for k, it in enumerate(items):
    b_ = it.split(':'); n, v = b_[0], b_[1]; cr = float(b_[2]) if len(b_) > 2 else 1.0
    im = Image.open(os.path.join(O, n, 'review', '%s_%s.png' % (n, v))).convert('RGB')
    w_, h_ = im.size; cw_, chh = int(w_ * cr), int(h_ * cr)
    im = im.crop(((w_ - cw_) // 2, (h_ - chh) // 2, (w_ + cw_) // 2, (h_ + chh) // 2)).resize((cw, ch), Image.LANCZOS)
    x, y = (k % 3) * (cw + 1), hd + (k // 3) * ch
    S.paste(im, (x, y))
    d.rectangle((x, y + ch - 16, x + 7 * len(n) + 8, y + ch), fill=(0, 0, 0))
    d.text((x + 4, y + ch - 14), n, fill=(255, 230, 120))
S.save(out, quality=88)
print(S.size, os.path.getsize(out))
