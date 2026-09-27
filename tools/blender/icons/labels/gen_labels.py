# gen_labels.py - own-design printed textures for icon props (no real brands). python3 gen_labels.py <outdir>
import sys, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
FS = '/usr/share/fonts/truetype/dejavu/'
ANTON = os.path.join(os.path.dirname(__file__), '../../../../assets/fonts/Anton-Regular.ttf')
def F(name, size):
    return ImageFont.truetype(name if name.startswith('/') else FS + name, size)


def aged(im, amount=18, seed=1):
    import random
    random.seed(seed)
    px = im.load(); w, h = im.size
    for _ in range(w * h // 60):
        x, y = random.randrange(w), random.randrange(h); d = random.randint(-amount, amount // 2)
        c = px[x, y]; px[x, y] = tuple(max(0, min(255, v + d)) for v in c[:3]) + tuple(c[3:])
    return im.filter(ImageFilter.GaussianBlur(0.6))


def dial(S=1024):
    im = Image.new('RGB', (S, S), (236, 230, 212)); d = ImageDraw.Draw(im); c = S / 2
    d.ellipse((S * 0.03, S * 0.03, S * 0.97, S * 0.97), outline=(40, 34, 28), width=int(S * 0.012))
    for i in range(60):
        a = math.radians(i * 6 - 90); r0 = S * (0.40 if i % 5 else 0.37); r1 = S * 0.44
        d.line((c + r0 * math.cos(a), c + r0 * math.sin(a), c + r1 * math.cos(a), c + r1 * math.sin(a)), fill=(25, 22, 20), width=int(S * (0.012 if i % 5 == 0 else 0.005)))
    f = F('DejaVuSerif-Bold.ttf', int(S * 0.085))
    for n in range(1, 13):
        a = math.radians(n * 30 - 90); r = S * 0.30
        d.text((c + r * math.cos(a), c + r * math.sin(a)), str(n), font=f, fill=(25, 22, 20), anchor='mm')
    def hand(ang, L, W, col):
        a = math.radians(ang - 90); p = (c + L * math.cos(a), c + L * math.sin(a)); q = (c - 0.12 * L * math.cos(a), c - 0.12 * L * math.sin(a))
        d.line((q, p), fill=col, width=W)
    hand(305, S * 0.26, int(S * 0.028), (20, 18, 16)); hand(60, S * 0.38, int(S * 0.018), (20, 18, 16)); hand(160, S * 0.40, int(S * 0.006), (170, 30, 20))
    d.ellipse((c - S * 0.025, c - S * 0.025, c + S * 0.025, c + S * 0.025), fill=(20, 18, 16))
    return aged(im)


def cig_front(W=512, H=800):
    """Own-design generic 1940s pack: cream paper, green band, 'VIRGINIA' + crest-less rosette."""
    im = Image.new('RGB', (W, H), (226, 214, 180)); d = ImageDraw.Draw(im)
    d.rectangle((0, int(H * 0.30), W, int(H * 0.62)), fill=(34, 78, 52))
    d.rectangle((0, int(H * 0.30), W, int(H * 0.315)), fill=(190, 150, 60)); d.rectangle((0, int(H * 0.605), W, int(H * 0.62)), fill=(190, 150, 60))
    fa = ImageFont.truetype(ANTON, int(H * 0.11)) if os.path.exists(ANTON) else F('DejaVuSans-Bold.ttf', int(H * 0.1))
    d.text((W / 2, H * 0.46), 'VIRGINIA', font=fa, fill=(236, 222, 180), anchor='mm')
    d.ellipse((W * 0.34, H * 0.08, W * 0.66, H * 0.26), outline=(150, 40, 30), width=10); d.ellipse((W * 0.42, H * 0.13, W * 0.58, H * 0.21), fill=(150, 40, 30))
    fs = F('DejaVuSerif-Bold.ttf', int(H * 0.045))
    d.text((W / 2, H * 0.72), 'TWENTY', font=fs, fill=(60, 40, 30), anchor='mm'); d.text((W / 2, H * 0.79), 'CIGARETTES', font=fs, fill=(60, 40, 30), anchor='mm')
    d.rectangle((W * 0.06, H * 0.02, W * 0.94, H * 0.98), outline=(150, 120, 60), width=6)
    return aged(im, 22, 3)


def chloro(W=600, H=360):
    im = Image.new('RGB', (W, H), (232, 222, 196)); d = ImageDraw.Draw(im)
    d.rectangle((10, 10, W - 10, H - 10), outline=(40, 30, 25), width=5); d.rectangle((22, 22, W - 22, H - 22), outline=(40, 30, 25), width=2)
    d.text((W / 2, H * 0.36), 'CHLOROFORM', font=F('DejaVuSerif-Bold.ttf', 60), fill=(30, 22, 18), anchor='mm')
    d.text((W / 2, H * 0.62), 'POISON', font=F('DejaVuSerif-Bold.ttf', 48), fill=(150, 26, 20), anchor='mm')
    d.text((W / 2, H * 0.82), 'B.P.  —  4 FL. OZ.', font=F('DejaVuSerif.ttf', 30), fill=(40, 30, 25), anchor='mm')
    return aged(im, 25, 5)


def stencil(text, W=512, H=160, col=(236, 232, 214)):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    fa = ImageFont.truetype(ANTON, int(H * 0.7)) if os.path.exists(ANTON) else F('DejaVuSans-Bold.ttf', int(H * 0.6))
    d.text((W / 2, H / 2), text, font=fa, fill=col + (235,), anchor='mm')
    return im


_d = dial().convert('RGBA'); _m = Image.new('L', _d.size, 0); ImageDraw.Draw(_m).ellipse((4, 4, _d.width - 4, _d.height - 4), fill=255)
_d.putalpha(_m); _d.save(os.path.join(OUT, 'dial.png'))
cig_front().save(os.path.join(OUT, 'cig_front.png'))
chloro().save(os.path.join(OUT, 'chloro_label.png'))
stencil('TNT').save(os.path.join(OUT, 'stencil_tnt.png'))
print('labels ->', OUT)
