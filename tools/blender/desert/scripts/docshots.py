"""Compose docs/screenshots/art-desert-*.jpg from the review renders (labels in the corner)."""
from PIL import Image, ImageDraw, ImageFont
D = '<claude-tmp>'
O = '<repo>/docs/screenshots'
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)


def tile(n, view, w, h, crop=1.0):
    im = Image.open(f'{D}/{n}/review/{n}_{view}.png').convert('RGB')
    W, H = im.size
    tw, th = W * crop, W * crop * h / w
    if th > H * crop:
        th, tw = H * crop, H * crop * w / h
    return im.crop((int(W / 2 - tw / 2), int(H / 2 - th / 2), int(W / 2 + tw / 2), int(H / 2 + th / 2))).resize((w, h), Image.LANCZOS)


def sheet(name, rows):
    Wt = 1200
    Ht = sum(r[0] for r in rows)
    S = Image.new('RGB', (Wt, Ht), (18, 18, 18))
    d = ImageDraw.Draw(S)
    y = 0
    for h, cells in rows:
        w = Wt // len(cells)
        for i, (n, v, c) in enumerate(cells):
            S.paste(tile(n, v, w, h, c), (i * w, y))
            d.text((i * w + 5, y + 4), f'{n} ({v})', font=f, fill=(255, 240, 120), stroke_width=2, stroke_fill=(0, 0, 0))
        y += h
    S.save(f'{O}/art-desert-{name}.jpg', quality=86)
    print(name, S.size)


H = ['house_flat_white_a', 'house_flat_white_b', 'house_flat_white_c']
sheet('medina-house', [(400, [(n, 'close_se', 1.0) for n in H]), (400, [(n, 'game2', 0.55) for n in H])])
sheet('village', [(300, [(n, 'close_se', 1.0) for n in ('house_adobe_a', 'house_adobe_b', 'house_adobe_c')]),
                  (300, [('compound_courtyard_a', 'close_se', 1.0), ('compound_courtyard_b', 'close_se', 1.0), ('house_adobe_c', 'game2', 0.5)])])
sheet('mosque', [(520, [('mosque_tunis', 'close_se', 1.0), ('mosque_tunis', 'game1', 0.62)]),
                 (440, [('minaret_tunis', 'close_se', 0.8), ('mosque_tunis', 'game2', 0.5), ('mosque_tunis', 'lod2@05x', 0.5)])])
sheet('camp', [(300, [(n, 'close_se', 1.0) for n in ('barracks_desert_a', 'barracks_desert_a_destroyed', 'barracks_desert_b', 'barracks_desert_b_destroyed', 'tent_command')]),
               (300, [(n, 'close_se', 1.0) for n in ('tent_command_destroyed', 'fuel_depot', 'fuel_depot_destroyed', 'drilling_rig', 'drilling_rig_destroyed')])])
sheet('walls-wells', [(300, [(n, 'close_se', 1.0) for n in ('wall_octagon_seg', 'wall_octagon_corner', 'wall_octagon_gate')]),
                      (300, [('wall_octagon_breach', 'close_se', 1.0), ('well_desert_a', 'close_se', 1.0), ('well_desert_b', 'close_se', 1.0)])])
