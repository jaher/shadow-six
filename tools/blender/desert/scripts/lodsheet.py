"""lodsheet.py out.jpg name... : rows = assets, cols = LOD0/LOD1/LOD2 @0.5x, cropped to object bbox (diff vs ground)."""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageChops
import numpy as np
D = '<claude-tmp>'
out, names = sys.argv[1], sys.argv[2:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
cw, ch = 400, int(1200 / max(3, len(names)) * 0.9) if len(names) > 3 else 300
rows = []
for n in names:
    ims = [Image.open(f'{D}/{n}/review/{n}_{s}.png').convert('RGB') for s in ('game05', 'lod1@05x', 'lod2@05x')]
    a = np.asarray(ims[0]).astype(int)
    bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)]), 0)
    m = np.abs(a - bg).max(-1) > 30
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 6
    box = (max(0, x0 - pad), max(0, y0 - pad), min(a.shape[1], x1 + pad), min(a.shape[0], y1 + pad))
    rows.append((n, [im.crop(box) for im in ims]))
H = ch
S = Image.new('RGB', (cw * 3, H * len(rows)), (20, 20, 20))
d = ImageDraw.Draw(S)
for r, (n, ims) in enumerate(rows):
    for c, im in enumerate(ims):
        sc = min(cw / im.size[0], H / im.size[1])
        t = im.resize((int(im.size[0] * sc), int(im.size[1] * sc)), Image.LANCZOS)
        S.paste(t, (c * cw, r * H))
        d.text((c * cw + 4, r * H + 3), f'{n} LOD{c}', font=f, fill=(255, 255, 0), stroke_width=2, stroke_fill=(0, 0, 0))
S.save(out, quality=82)
print(out, S.size)
