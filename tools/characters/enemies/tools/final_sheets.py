#!/usr/bin/env python3
"""final_sheets.py - compose the two doc sheets (<=1280 px JPEG) from review/final renders:
  chars-enemies-roster.jpg : roster lineup (front) + game camera 1x (1:1 crop) + 2x crop
  chars-enemies-faces.jpg  : 24 heads front/side across all types"""
import os, sys
from PIL import Image, ImageDraw
# usage: final_sheets.py [renders_dir] [fixes_sheet.jpg]   (defaults: review/final, rework/sheets/sheet_static+poses)
F = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'final')
FIX = sys.argv[2] if len(sys.argv) > 2 else None
DOCS = '<repo>/docs/screenshots'
os.makedirs(DOCS, exist_ok=True)


def label(im, text, xy=(6, 6)):
    d = ImageDraw.Draw(im)
    w = 7 * len(text) + 10
    d.rectangle((xy[0], xy[1], xy[0] + w, xy[1] + 16), fill=(0, 0, 0)); d.text((xy[0] + 5, xy[1] + 2), text, fill=(255, 255, 255))


W = 1280
lu = Image.open(os.path.join(F, 'roster_lineup.png')).convert('RGB')
lu = lu.resize((W, int(lu.height * W / lu.width)), Image.LANCZOS)
label(lu, 'German enemy roster: rifleman, trooper, sentry (greatcoat), NCO, officer, MG, engineer / crew, Afrika Korps x3, winter x2, Schleper (M15)')
g1 = Image.open(os.path.join(F, 'g_game1x.png')).convert('RGB')
g2 = Image.open(os.path.join(F, 'g_game2x.png')).convert('RGB')
cw = W // 2
c1 = g1.crop(((g1.width - cw) // 2, (g1.height - 420) // 2, (g1.width + cw) // 2, (g1.height + 420) // 2))   # 1:1 pixels, 40 px/m
c2 = g2.crop(((g2.width - cw * 1) // 2, (g2.height - 420) // 2, (g2.width + cw) // 2, (g2.height + 420) // 2))
label(c1, 'game camera 1x (40 px/m, pitch 40 deg) - 1:1 pixels'); label(c2, 'game camera 2x (80 px/m) - 1:1 pixels')
out = Image.new('RGB', (W, lu.height + 420), (30, 30, 30))
out.paste(lu, (0, 0)); out.paste(c1, (0, lu.height)); out.paste(c2, (cw, lu.height))
out.save(os.path.join(DOCS, 'chars-enemies-roster.jpg'), quality=86)
fa = Image.open(os.path.join(F, 'f_faces.png')).convert('RGB')
fa = fa.resize((W, int(fa.height * W / fa.width)), Image.LANCZOS)
label(fa, '24 of 99 variants (front / side): 16 archetypes + proportion layer + resting expression, tones, iris, complexion, facial hair, glasses; headgear fit-checked (eyes clear)')
fa.save(os.path.join(DOCS, 'chars-enemies-faces.jpg'), quality=86)
for n in ('chars-enemies-roster.jpg', 'chars-enemies-faces.jpg'):
    p = os.path.join(DOCS, n); im = Image.open(p)
    print(p, im.size, os.path.getsize(p) // 1024, 'KB')
# chars-enemies-fixes.jpg : review-fix close-ups (rework/sheets: headgear extras, collars, kit, die; long-gun holds, die/dead, props)
RW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'rework', 'sheets')
if FIX:
    fx = Image.open(FIX).convert('RGB'); fx = fx.resize((W, int(fx.height * W / fx.width)), Image.LANCZOS)
    fx.save(os.path.join(DOCS, 'chars-enemies-fixes.jpg'), quality=85)
    p = os.path.join(DOCS, 'chars-enemies-fixes.jpg'); print(p, Image.open(p).size, os.path.getsize(p) // 1024, 'KB')
elif os.path.exists(os.path.join(RW, 'sheet_static.jpg')):
    parts = [Image.open(os.path.join(RW, n)).convert('RGB') for n in ('sheet_static.jpg', 'sheet_poses.jpg')]
    parts = [p.resize((W, int(p.height * W / p.width)), Image.LANCZOS) for p in parts]
    fx = Image.new('RGB', (W, sum(p.height for p in parts)), (30, 30, 30)); y = 0
    for p in parts:
        fx.paste(p, (0, y)); y += p.height
    fx.save(os.path.join(DOCS, 'chars-enemies-fixes.jpg'), quality=85)
    p = os.path.join(DOCS, 'chars-enemies-fixes.jpg'); print(p, Image.open(p).size, os.path.getsize(p) // 1024, 'KB')
