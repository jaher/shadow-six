"""multi.py out.jpg name1 name2 ... : one row per asset = game1 (native crop), game2 crop, close, close_se (review PNGs)."""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
OUT = os.environ.get('MULTI_ROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out')
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
views = os.environ.get('VIEWS', 'game1,game2,close,close_se').split(',')
rows = []
for n in sys.argv[2:]:
    a = n.rsplit('_', 1)[0]
    cells = []
    for v in views:
        p = glob.glob(os.path.join(OUT, '*', 'review', '%s_%s.png' % (n, v)))
        if not p:
            continue
        im = Image.open(p[0]).convert('RGB'); w, h = im.size
        if v == 'game1':
            im = im.crop((w // 2 - 130, h // 2 - 170, w // 2 + 130, h // 2 + 170))
        elif v == 'game2':
            im = im.crop((w // 2 - 200, h // 2 - 260, w // 2 + 200, h // 2 + 260))
        else:
            im = im.crop((int(w * 0.06), int(h * 0.1), int(w * 0.94), int(h * 0.96)))
        cells.append((v, im))
    H = 300
    cells = [(v, im.resize((int(im.size[0] * H / im.size[1]), H), Image.LANCZOS)) for v, im in cells]
    rows.append((n, cells))
W = max(sum(im.size[0] for _, im in c) for _, c in rows)
S = Image.new('RGB', (W, 300 * len(rows)), (20, 20, 20)); d = ImageDraw.Draw(S)
for k, (n, cells) in enumerate(rows):
    x = 0
    for v, im in cells:
        S.paste(im, (x, 300 * k)); x += im.size[0]
    d.rectangle((0, 300 * k, 8 * len(n) + 10, 300 * k + 18), fill=(0, 0, 0)); d.text((4, 300 * k + 2), n, font=f, fill=(255, 225, 90))
if S.size[0] > 1280:
    S = S.resize((1280, int(S.size[1] * 1280 / S.size[0])), Image.LANCZOS)
S.save(sys.argv[1], quality=85); print(sys.argv[1], S.size, os.path.getsize(sys.argv[1]))
