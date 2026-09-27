"""sheet.py out.jpg views name... : grid, one column per asset, rows = views (game2c = 400x300 centre crop of game2)."""
import sys
from PIL import Image, ImageDraw, ImageFont
D = '<claude-tmp>'
out, views, names = sys.argv[1], sys.argv[2].split(','), sys.argv[3:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
import os
W = int(os.environ.get('SW', 400))
H = {v: int(W * 0.75) if v.endswith('c') else int(W * 0.667) for v in views}
S = Image.new('RGB', (W * len(names), 16 + sum(H.values())), (24, 24, 24))
d = ImageDraw.Draw(S)
for i, n in enumerate(names):
    x = i * W
    d.text((x + 4, 2), n, font=f, fill=(255, 255, 255))
    y = 16
    for v in views:
        if v.endswith('c'):
            im = Image.open(f'{D}/{n}/review/{n}_{v[:-1]}.png').convert('RGB')
            cx, cy = im.size[0] // 2, im.size[1] // 2
            t = im.crop((cx - W // 2, cy - int(W * 0.375), cx + W // 2, cy + int(W * 0.375)))
        else:
            t = Image.open(f'{D}/{n}/review/{n}_{v}.png').convert('RGB').resize((W, int(W * 0.667)), Image.LANCZOS)
        S.paste(t, (x, y)); d.text((x + 4, y + 2), v, font=f, fill=(255, 255, 0)); y += t.size[1]
S.save(out, quality=86)
print(S.size)
