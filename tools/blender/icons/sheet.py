# sheet.py - contact sheets: every icon at 1:1 device px on the real HUD background (pack for items, top bar for tools,
# snow + mud for cursors) for one tier, plus a solid-silhouette row at 32 px.
# usage: python3 sheet.py <out.png> <tier-tag e.g. 2x> [cls ...] [--ids a,b] [--sil]
import os, sys, glob, json
from PIL import Image, ImageDraw, ImageFont
SCR = os.environ.get('ICON_SCRATCH', os.path.expanduser('~/.cache/shadow-six/icons'))
OUT = os.path.join(SCR, 'out')


def tile(bg, w, h):
    t = Image.new('RGB', (w, h))
    for y in range(0, h, bg.height):
        for x in range(0, w, bg.width): t.paste(bg, (x, y))
    return t


def main():
    a = sys.argv[1:]; out, tag = a[0], a[1]
    tags = dict(kv.split('=') for kv in tag.split(',')) if '=' in tag else {}
    ids = None; sil = '--sil' in a
    if '--ids' in a: ids = a[a.index('--ids') + 1].split(',')
    classes = [x for x in a[2:] if not x.startswith('--') and (ids is None or x not in ids and ',' not in x)] or ['item', 'tool', 'cursor', 'stamp']
    bgs = {'item': Image.open(os.path.join(SCR, 'bg_pack.png')), 'tool': Image.open(os.path.join(SCR, 'bg_bar.png')),
           'badge': Image.open(os.path.join(SCR, 'bg_bar.png')), 'stamp': Image.new('RGB', (8, 8), (168, 164, 154))}
    font = ImageFont.load_default()
    rows = []
    for cls in classes:
        files = sorted(glob.glob(os.path.join(OUT, cls, f"*@{tags.get(cls, tag)}.webp")))
        ims = [(os.path.basename(f).split("@")[0], Image.open(f).convert("RGBA")) for f in files]
        if ids: ims = [x for x in ims if x[0] in ids]
        if ims: rows.append((cls, ims))
    W = int(os.environ.get('SHEET_W', '1800')); pad = 12; y = pad; placed = []
    for cls, ims in rows:
        x = pad; rh = 0
        for name, im in ims:
            cw = max(im.width, 70) + pad
            if x + cw > W: x = pad; y += rh + 22; rh = 0
            placed.append((cls, name, im, x, y)); x += cw; rh = max(rh, im.height)
        y += rh + 34
    H = y + (60 if sil else 0)
    sheet = Image.new('RGB', (W, H), (26, 24, 20)); d = ImageDraw.Draw(sheet)
    for cls, name, im, x, y in placed:
        if cls == 'cursor':
            half = im.height // 2
            bg = Image.new('RGB', im.size, (225, 228, 230)); bg.paste((74, 62, 44), (0, half, im.width, im.height))
        else:
            bg = tile(bgs[cls], im.width, im.height)
        bg = bg.convert('RGBA'); bg.alpha_composite(im); sheet.paste(bg.convert('RGB'), (x, y))
        d.text((x, y + im.height + 3), name, fill=(200, 190, 160), font=font)
    if sil:
        x = pad; y = H - 50
        for cls, name, im, _, _ in placed:
            s = im.copy(); s.thumbnail((32, 32), Image.LANCZOS)
            a_ = s.split()[3].point(lambda v: 255 if v > 110 else 0)
            blk = Image.new('RGB', s.size, (0, 0, 0)); cell = Image.new('RGB', (34, 34), (235, 232, 222))
            cell.paste(blk, ((34 - s.width) // 2, (34 - s.height) // 2), a_); sheet.paste(cell, (x, y)); x += 38
            if x > W - 40: break
    sheet.save(out); print(out, sheet.size)


main()
