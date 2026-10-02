"""Open steel floor grating tile (own work, CC0) for decks the tanks show through (M8 farm, M17 platform):
1024 x 1024 px RGBA = 0.6 m: load + cross bars every 100 mm (~55 % cover: opaque at a distance through the
mip chain, open close up), alpha 0 in the openings (glTF alphaMode MASK). Writes 1k + 512 into the library."""
import os, sys
from PIL import Image, ImageDraw, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
N, TILE = 1024, 0.6
px = N / TILE
im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
col, edge = (122, 120, 112, 255), (78, 76, 70, 255)
for k in range(7):                                    # load bars every 100 mm, 40 mm wide (reads at game zoom)
    y = k * 0.1 * px
    d.rectangle([0, y - 34, N, y + 34], fill=edge)
    d.rectangle([0, y - 26, N, y + 22], fill=col)
for k in range(7):                                    # cross bars every 100 mm, 25 mm
    x = k * 0.1 * px
    d.rectangle([x - 21, 0, x + 21, N], fill=edge)
    d.rectangle([x - 14, 0, x + 12, N], fill=(140, 137, 128, 255))
a = im.split()[3].filter(ImageFilter.MaxFilter(3))
im.putalpha(a)
for res, sub in ((1024, '1k'), (512, '512')):
    out = os.path.join(REPO, 'assets', 'textures', 'lib', sub, 'fuel_grating_rgba.png')
    (im if res == N else im.resize((res, res), Image.LANCZOS)).save(out, optimize=True)
    print(out, os.path.getsize(out))
