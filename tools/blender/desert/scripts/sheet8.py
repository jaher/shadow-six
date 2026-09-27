"""sheet8.py out.jpg name... : up to 8 assets, 2 tiles each (game2 centre crop | close_se), 4x4 grid of 300x300 = 1200x1200."""
import sys
from PIL import Image, ImageDraw, ImageFont
D = '<claude-tmp>'
out, names = sys.argv[1], sys.argv[2:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
S = Image.new('RGB', (1200, 1200), (20, 20, 20))
d = ImageDraw.Draw(S)
T = 300
for i, n in enumerate(names[:8]):
    x0, y0 = (i % 2) * 600, (i // 2) * 300
    g = Image.open(f'{D}/{n}/review/{n}_game2.png').convert('RGB')
    W, H = g.size
    c = min(W, H) * 0.62
    g = g.crop((int(W / 2 - c / 2), int(H / 2 - c / 2), int(W / 2 + c / 2), int(H / 2 + c / 2))).resize((T, T), Image.LANCZOS)
    s = Image.open(f'{D}/{n}/review/{n}_close_se.png').convert('RGB')
    W, H = s.size
    s = s.crop((int(W / 2 - H / 2), 0, int(W / 2 + H / 2), H)).resize((T, T), Image.LANCZOS)
    S.paste(g, (x0, y0)); S.paste(s, (x0 + T, y0))
    d.text((x0 + 3, y0 + 2), n, font=f, fill=(255, 255, 0), stroke_width=2, stroke_fill=(0, 0, 0))
S.save(out, quality=84)
print(out)
