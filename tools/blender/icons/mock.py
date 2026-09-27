# mock.py - before/after mock of the 1080p HUD: new @2x icons composited onto the real screenshots (top-right bar,
# knapsack of three commandos). Old SVG glyphs are painted over with clean bar / pack texture first.
# usage: python3 mock.py <out.png>
import os, sys
from PIL import Image, ImageDraw, ImageFont
SCR = os.environ.get('ICON_SCRATCH', os.path.expanduser('~/.cache/shadow-six/icons'))
OUT = os.path.join(SCR, 'out'); SH = os.path.join(SCR, 'shots')


def icon(cls, iid, tag='2x'):
    return Image.open(os.path.join(OUT, cls, f'{iid}@{tag}.webp')).convert('RGBA')


def put(canvas, im, cx, cy):
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def topbar():
    full = Image.open(os.path.join(SH, 'm01_full.png')).convert('RGBA')
    before = full.crop((1300, 0, 1920, 170))
    after = before.copy()
    bar = full.crop((700, 0, 1060, 88))                      # clean webbing strip
    after.paste(bar, (130, 0)); after.paste(bar.crop((0, 0, 30, 88)), (490, 0))
    game = full.crop((1000, 100, 1360, 170)); after.paste(game.crop((0, 0, 360, 70)), (130, 88))
    eyebox = full.crop((1830, 60, 1840, 88)).resize((100, 88)); after.paste(eyebox, (520, 0))
    put(after, icon('tool', 'posture.prone'), 225, 50)
    put(after, icon('tool', 'help'), 305, 46)
    put(after, icon('tool', 'camera'), 385, 72)
    put(after, icon('tool', 'lamp.off'), 470, 48)
    put(after, icon('tool', 'eye.open'), 570, 44)
    return before, after


SLOTS = [[10, 30], [42, 26], [70, 32], [14, 54], [44, 52], [72, 56], [18, 76], [48, 76], [74, 78], [30, 40], [58, 42], [36, 64]]


def inpaint(im, box):
    """Paint the old flat glyphs out of the pack: pixels far from the local median are replaced by pack texture
    (bg tile) re-lit to the local median brightness."""
    import numpy as np
    from PIL import ImageFilter
    reg = im.crop(box).convert('RGB'); a = np.asarray(reg, np.float32)
    med = np.asarray(reg.filter(ImageFilter.MedianFilter(31)), np.float32)
    diff = np.abs(a - med).max(-1)
    m = Image.fromarray(((diff > 18) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(2))
    m = np.asarray(m, np.float32)[..., None] / 255
    tile = Image.open(os.path.join(SCR, 'bg_pack.png')).convert('RGB'); T = Image.new('RGB', reg.size)
    for y in range(0, reg.height, tile.height):
        for x in range(0, reg.width, tile.width): T.paste(tile, (x, y))
    t = np.asarray(T, np.float32); t = t / t.mean((0, 1)) * med.mean(-1, keepdims=True).clip(1) / 1.0
    t = t * (med.mean((0, 1)) / t.mean((0, 1)))
    blend = np.asarray(Image.fromarray(med.astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32)
    fill = blend * 0.55 + t * 0.45
    out = a * (1 - m) + fill * m
    im.paste(Image.fromarray(out.clip(0, 255).astype(np.uint8)).convert('RGBA'), box[:2])


def pack(shot, items):
    im = Image.open(os.path.join(SH, shot)).convert('RGBA')
    before = im.copy(); after = im.copy()
    px0, py0, pw, ph = 104, 0, 224, 298                     # pack rect inside the crop
    inpaint(after, (px0 + 8, 70, px0 + pw - 6, ph - 8))
    inpaint(after, (0, 150, px0 - 2, ph))
    for i, iid in enumerate(items):
        x, y = SLOTS[i]; cx, cy = px0 + pw * x / 100 + 34, py0 + ph * y / 100 + 34
        put(after, icon('item', iid), cx, cy)
    put(after, icon('tool', 'hand'), 50, 238)
    return before, after


def main(out):
    rows = [topbar()]
    rows.append(pack('m01_greenberet_pack.png', ['knife', 'pistol.colt1911', 'decoy', 'shovel']))
    for shot, items in (('m00_sapper_pack.png', ['pistol.p38', 'grenade', 'timeBomb', 'remoteBomb', 'bearTrap', 'wireCutters']),
                        ('m00_sniper_pack.png', ['pistol.colt1911', 'sniperRifle', 'firstAid'])):
        if os.path.exists(os.path.join(SH, shot)): rows.append(pack(shot, items))
    W = max(b.width + a.width for b, a in rows) + 30; H = sum(max(b.height, a.height) for b, a in rows) + 20 * len(rows) + 30
    sheet = Image.new('RGBA', (W, H), (18, 17, 15, 255)); d = ImageDraw.Draw(sheet); y = 24
    d.text((10, 6), 'BEFORE (current SVG)', fill=(200, 190, 160)); d.text((rows[0][0].width + 20, 6), 'AFTER (photoreal @2x, 1080p)', fill=(200, 190, 160))
    for b, a in rows:
        sheet.alpha_composite(b, (10, y)); sheet.alpha_composite(a, (b.width + 20, y)); y += max(b.height, a.height) + 20
    sheet.convert('RGB').save(out); print(out, sheet.size)


main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(SCR, 'sheet_hud_mock.png'))
