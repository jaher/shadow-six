import json, os, sys
from PIL import Image, ImageDraw, ImageFont
KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = json.load(open(os.path.join(KIT, 'lib/materials.json')))['materials']
ids = [k for k in M if k not in ('decals', 'signs')]
T = 128; cols = 8
rows = (len(ids) + cols - 1) // cols
W = cols * T
sheet = Image.new('RGB', (W, rows * (T + 14) + 256 + 128), (30, 30, 30))
d = ImageDraw.Draw(sheet)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
for i, k in enumerate(ids):
    r, c = divmod(i, cols)
    p = os.path.join(KIT, 'lib', M[k]['maps']['diff']['1k'] + ('.jpg'))
    im = Image.open(p).convert('RGB').resize((T, T))
    sheet.paste(im, (c * T, r * (T + 14)))
    d.text((c * T + 2, r * (T + 14) + T), '%s %.1fm' % (k, M[k]['tile_m']), font=f, fill=(230, 230, 230))
y = rows * (T + 14)
dec = Image.open(os.path.join(KIT, 'lib/1k/decals_rgba.png')).convert('RGBA').resize((256, 256))
bg = Image.new('RGBA', (256, 256), (180, 170, 150, 255)); bg.alpha_composite(dec)
sheet.paste(bg.convert('RGB'), (0, y))
sg = Image.open(os.path.join(KIT, 'lib/1k/signs_diff.jpg')).convert('RGB')
for i in range(16):
    cell = sg.crop((0, i * 128, 512, (i + 1) * 128)).resize((192, 48))
    sheet.paste(cell, (260 + (i % 4) * 194, y + (i // 4) * 50))
sheet.save(sys.argv[1], quality=85)
print(sheet.size)
