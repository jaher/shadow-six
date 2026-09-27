"""Compose docs/screenshots/art-europe-*.jpg (1278 x 640, 3 x 2 labelled review renders)."""
import os
from PIL import Image, ImageDraw
O = '<claude-tmp>'
D = '<repo>/docs/screenshots'
SETS = {
    'art-europe-village.jpg': [('farmhouse_normandy_b', 'close', .85), ('house_halftimber_a', 'close', .85),
                               ('house_halftimber_b', 'close_se', .85), ('house_halftimber_c', 'game1', .7),
                               ('townhouse_row_b', 'close', .85), ('church_village_a', 'close', .8)],
    'art-europe-mills-ruins.jpg': [('watermill_a', 'game1', .75), ('mill_old_b', 'close_se', .85), ('townhouse_row_a_ruin', 'close_se', .85),
                                   ('church_village_a_ruin', 'close', .8), ('house_bombed_a', 'close_se', .85),
                                   ('farmhouse_normandy_a_ruin', 'close', .85)],
    'art-europe-town.jpg': [('station_rail_b', 'game1', .75), ('station_rail_goods', 'close', .85), ('cemetery_a', 'game1', .6),
                            ('townhouse_row_c', 'game1', .7), ('garden_wall_c', 'close', .9), ('house_halftimber_c_ruin', 'close_se', .85)],
    'art-europe-landmarks.jpg': [('station_rail_a', 'detail', .9), ('station_rail_b', 'close_se', .8), ('watermill_a', 'close', .8),
                                 ('watermill_b', 'close_se', .8), ('mill_old_a', 'close', .85), ('mill_old_b', 'close', .85)],
}


def cell(n, v, fr, w=426, h=320):
    p = f'{O}/{n}/review/{n}_{v}.png'
    im = Image.open(p).convert('RGB')
    W, H = im.size
    cw, ch = int(W * fr), int(W * fr * h / w)
    ch = min(ch, H)
    x, y = (W - cw) // 2, (H - ch) // 2
    im = im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle((0, h - 16, len(n) * 7 + 8, h), fill=(0, 0, 0))
    d.text((4, h - 14), n, fill=(255, 235, 150))
    return im


for fn, items in SETS.items():
    sh = Image.new('RGB', (1278, 640), (20, 20, 20))
    for k, (n, v, fr) in enumerate(items):
        sh.paste(cell(n, v, fr), ((k % 3) * 426, (k // 3) * 320))
    sh.save(os.path.join(D, fn), quality=86)
    print(fn, os.path.getsize(os.path.join(D, fn)))
