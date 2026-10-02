"""Fuel-tank stencil + sign atlas (own work, CC0): plain block lettering, no emblems.
Writes <lib>/1k/fuel_stencils_rgba.png (1024 x 1024, RGBA) + fuel_stencils.json (UV rects, v up like decals.json).
Rows 0-11: stencil words (white on transparent, worn spray edges; tinted per tank via the decal vertex colour).
Rows 12-15: opaque sign boards (black on cream with a red border): RAUCHEN VERBOTEN!, FEUERGEFÄHRLICH, ...
Usage: python3 make_stencils.py [libdir]"""
import sys, os, json, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'kit', 'lib')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
S, ROW = 1024, 64
WORDS = ['KRAFTSTOFF', 'BENZIN', 'HEIZÖL', 'DIESEL', 'ÖL 1', 'ÖL 2', 'FEUERGEFÄHRLICH', 'BEHÄLTER 1', 'BEHÄLTER 2',
         'BEHÄLTER 3', '27 000 L', '45 000 L']
SIGNS = [('rauchen_verboten', ['RAUCHEN', 'VERBOTEN!']), ('feuer_verboten', ['FEUER UND OFFENES', 'LICHT VERBOTEN']),
         ('feuergefaehrlich', ['FEUER-', 'GEFÄHRLICH!']), ('kraftstoff_lager', ['KRAFTSTOFF-', 'LAGER'])]
key = lambda w: w.lower().replace(' ', '_').replace('ö', 'oe').replace('ä', 'ae').replace('!', '').replace('_000_l', '000l')

im = Image.new('RGBA', (S, S), (240, 236, 222, 0))   # letter colour under alpha 0: no dark mip fringes
d = ImageDraw.Draw(im)
rects = {}
rnd = random.Random(7)
f = ImageFont.truetype(FONT, 52)
for i, w in enumerate(WORDS):
    y0 = i * ROW
    mask = Image.new('L', (S, ROW), 0)
    md = ImageDraw.Draw(mask)
    tw = md.textlength(w, font=f)
    md.text((8, 4), w, font=f, fill=255)
    # stencil bridges: a thin vertical gap through each letter's middle, then spray softness + wear speckle
    x = 8.0
    for ch in w:
        cw = md.textlength(ch, font=f)
        if ch in 'OABDPRÖÄQ0469':        # letters with counters get the stencil bridges
            md.rectangle([x + cw / 2 - 1.5, 4, x + cw / 2 + 1.5, ROW - 4], fill=0)
        x += cw
    mask = mask.filter(ImageFilter.GaussianBlur(0.9))
    px = mask.load()
    for _ in range(int(tw * 3)):
        px[rnd.randrange(8, int(8 + tw)), rnd.randrange(4, ROW - 4)] = 0
    im.paste(Image.new('RGBA', (S, ROW), (240, 236, 222, 255)), (0, y0), mask)
    rects[key(w)] = [0, 1 - (y0 + ROW) / S, (tw + 16) / S, 1 - y0 / S]
fs = ImageFont.truetype(FONT, 40)
for k, (name, lines) in enumerate(SIGNS):              # opaque boards 512 x 128 (4:1), two per row pair
    col, row = k % 2, 12 + (k // 2) * 2
    x0, y0, w, h = col * 512, row * ROW, 512, 128
    d.rectangle([x0, y0, x0 + w - 1, y0 + h - 1], fill=(214, 204, 178, 255))
    d.rectangle([x0 + 6, y0 + 6, x0 + w - 7, y0 + h - 7], outline=(140, 34, 26, 255), width=7)
    for j, t in enumerate(lines):
        tw = d.textlength(t, font=fs)
        d.text((x0 + (w - tw) / 2, y0 + 14 + j * 50), t, font=fs, fill=(24, 22, 20, 255))
    for _ in range(900):                                  # paint wear
        px, py = x0 + rnd.randrange(w), y0 + rnd.randrange(h)
        c = im.getpixel((px, py))
        im.putpixel((px, py), (min(255, c[0] + 18), min(255, c[1] + 16), min(255, c[2] + 12), 255))
    rects['sign_' + name] = [x0 / S, 1 - (y0 + h) / S, (x0 + w) / S, 1 - y0 / S]
os.makedirs(os.path.join(LIB, '1k'), exist_ok=True)
out = os.path.join(LIB, '1k', 'fuel_stencils_rgba.png')
im.save(out, optimize=True)
json.dump(rects, open(os.path.join(HERE, 'fuel_stencils.json'), 'w'), indent=1)
print(out, os.path.getsize(out), len(rects), 'rects')
