# before_after.py - docs/screenshots/hud-eye-before-after.jpg: real-game HUD crops (1080p DPR 1 and 4K-class DPR 2,
# before and after), an enlarged view of the old and new eye, and a strip of animation frames from the sprite sheet.
# usage: python3 before_after.py <shots_dir> <old_eye_6x.webp> <new_master.png> <sheet@6x.webp> <out.jpg>
import sys, json
from PIL import Image, ImageDraw, ImageFont

shots, old6, newm, sheet, out = sys.argv[1:6]
BG = (28, 24, 20); INK = (236, 214, 160)
try:
    F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
except OSError:
    F = f = ImageFont.load_default()


def label(im, xy, t, font=None):
    ImageDraw.Draw(im).text(xy, t, fill=INK, font=font or f)


crops = {k: Image.open(f'{shots}/{k}.png').convert('RGB') for k in ('before-dpr1', 'after-dpr1', 'before-dpr2', 'after-dpr2')}
W = 1600
rows = []
# row 1: 1080p crops at 2x zoom (nearest, so the device pixels are visible); row 2: DPR 2 crops at 1x
r1 = [crops['before-dpr1'].resize((crops['before-dpr1'].width * 2, crops['before-dpr1'].height * 2), Image.NEAREST),
      crops['after-dpr1'].resize((crops['after-dpr1'].width * 2, crops['after-dpr1'].height * 2), Image.NEAREST)]
r2 = [crops['before-dpr2'], crops['after-dpr2']]
big_old = Image.open(old6).convert('RGBA'); big_new = Image.open(newm).convert('RGBA')
H = 560
big_old = big_old.resize((int(big_old.width * H / big_old.height), H), Image.LANCZOS)
big_new = big_new.resize((int(big_new.width * H / big_new.height), H), Image.LANCZOS)
sh = Image.open(sheet).convert('RGBA')
data = json.load(open(sheet.rsplit('@', 1)[0] + '.json'))
cw, ch = sh.width // data['cols'], sh.height // data['rows']
names = [x['name'] for x in data['frames']]
pick = ['g00n', 'g09n', 'g11n', 'g13n', 'g15n', 'g00d', 'b1g14n', 'b2g14n', 'blink3']
pick = [n for n in pick if n in names]
y_r1, y_r2 = 50, 50 + r1[0].height + 50
y_big = y_r2 + r2[0].height + 50
y_strip = y_big + H + 50
total = y_strip + ch + 50
im = Image.new('RGB', (W, total), BG)
label(im, (20, 12), 'HUD top-right at 1080p (uiScale 2, DPR 1), shown 2x  -  BEFORE  |  AFTER', F)
im.paste(r1[0], (20, y_r1)); im.paste(r1[1], (W // 2 + 10, y_r1))
label(im, (20, y_r2 - 34), 'Same HUD on a 4K-class screen (DPR 2, @4x tier), 1:1  -  BEFORE  |  AFTER', F)
im.paste(r2[0], (20, y_r2)); im.paste(r2[1], (W // 2 + 10, y_r2))
label(im, (20, y_big - 34), 'Enlarged: old render (@6x)  |  new photoreal eye (master)', F)
bg = Image.new('RGBA', (W, H), BG + (255,)); bg.alpha_composite(big_old, (20, 0)); bg.alpha_composite(big_new, (W - big_new.width - 20, 0))
im.paste(bg.convert('RGB'), (0, y_big))
label(im, (20, y_strip - 34), '@6x cells: ahead, right, up, left, down, dilated; a blink over a down-left look: half / nearly shut / shut', F)
x = 20
for n in pick:
    i = names.index(n); c, r = i % data['cols'], i // data['cols']
    cell = sh.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
    tile = Image.new('RGBA', cell.size, BG + (255,)); tile.alpha_composite(cell)
    k = min(1.0, (W - 40 - 8 * 8) / (len(pick) * cw))
    tile = tile.resize((int(cw * k), int(ch * k)), Image.LANCZOS)
    im.paste(tile.convert('RGB'), (x, y_strip)); label(im, (x + 4, y_strip + tile.height + 4), n); x += tile.width + 8
im.save(out, quality=86, optimize=True)
print(out, im.size)
