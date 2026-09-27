"""Refresh docs/screenshots/art-bridges-*.jpg from the review renders + an overview sheet of all reworked assets."""
import os, shutil
from PIL import Image, ImageDraw
OUT = '<claude-tmp>'
DOC = '<repo>/docs/screenshots'
for doc, n in (('art-bridges-stone-arch3.jpg', 'bridge_stone_arch3_a'), ('art-bridges-truss-maas.jpg', 'bridge_truss_maas'),
               ('art-bridges-stone-arch3b.jpg', 'bridge_stone_arch3_b'), ('art-bridges-stone-arch5.jpg', 'bridge_stone_arch5_a'),
               ('art-bridges-stone-arch3-destroyed.jpg', 'bridge_stone_arch3_a_destroyed'), ('art-bridges-stone-arch3-snow.jpg', 'bridge_stone_arch3_a_snow'),
               ('art-bridges-timber-road-snow.jpg', 'bridge_timber_road_snow'), ('art-bridges-truss-maas-destroyed.jpg', 'bridge_truss_maas_destroyed'),
               ('art-bridges-dam.jpg', 'dam_arch'), ('art-bridges-dam-snow.jpg', 'dam_arch_snow'), ('art-bridges-dam-destroyed.jpg', 'dam_arch_destroyed')):
    shutil.copy(os.path.join(OUT, n, 'review', n + '_sheet.jpg'), os.path.join(DOC, doc))
names = ['bridge_stone_arch1_a', 'bridge_stone_arch1_b', 'bridge_stone_arch3_a', 'bridge_stone_arch3_b', 'bridge_stone_arch5_a',
         'bridge_stone_arch3_a_destroyed', 'bridge_stone_arch3_a_snow', 'bridge_timber_road', 'bridge_timber_road_snow',
         'bridge_rail_trestle', 'bridge_rail_trestle_snow', 'bridge_truss_maas', 'bridge_truss_maas_destroyed', 'bridge_lift_lever',
         'bridge_bascule_double', 'lock_gates', 'lock_gates_open', 'dam_arch', 'dam_arch_snow', 'dam_arch_destroyed',
         'footbridge_plank', 'footbridge_plank_snow', 'moat_bridge_draw', 'moat_bridge_fixed']
cols, tw, th = 4, 400, 267
sheet = Image.new('RGB', (cols * tw, ((len(names) + cols - 1) // cols) * th), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for k, n in enumerate(names):
    p = os.path.join(OUT, n, 'review', n + '_close.png')
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert('RGB')
    im.thumbnail((tw, th))
    x, y = (k % cols) * tw, (k // cols) * th
    sheet.paste(im, (x, y))
    d.text((x + 4, y + 3), n, fill=(255, 230, 60))
sheet.save(os.path.join(DOC, 'art-bridges-overview.jpg'), quality=84)
for n in names:                                   # per-family sheets
    pass
print(sheet.size)
