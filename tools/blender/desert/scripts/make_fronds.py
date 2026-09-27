"""'palm_frond_dz' alpha-tested atlas (own work, CC0): 4 vertical cells (u 0-.25 dry grey frond, .25-.5 brown
frond, .5-.75 olive frond, .75-1 reed/cane mat strip). Each frond: midrib along v, pinnate leaflets splayed at
~35 deg with gaps, ragged tips, colour jitter per leaflet. Writes kit/lib/{1k,2k}/palm_frond_dz_{diff(.png RGBA),nor,arm}
and merges the 'palm_frond_dz' material entry (MASK, doubleSided)."""
import json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

KIT = '<claude-tmp>'
W, H = 2048, 2048
CW = W // 4
img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
rng = np.random.RandomState(5)


def frond(x0, base, seed):
    r = np.random.RandomState(seed)
    cx = x0 + CW / 2
    # midrib (petiole at the bottom = v 0 = image bottom)
    for y in range(40, H - 20, 4):
        t = 1 - y / H
        w = 5 + 9 * (1 - t)
        c = tuple(int(v * (0.9 + 0.1 * r.rand())) for v in base)
        d.ellipse((cx - w / 2, y - 3, cx + w / 2, y + 3), fill=c + (255,))
    for side in (-1, 1):
        y = H - 200
        while y > 60:
            t = 1 - y / H                       # 0 at base (bottom), 1 at tip (top)
            L = CW * (0.46 * math.sin(math.pi * min(0.97, 0.12 + 0.88 * t)) + 0.05) * r.uniform(0.85, 1.08)
            ang = math.radians(r.uniform(28, 42))
            x1 = cx + side * L * math.sin(ang)
            y1 = y - L * math.cos(ang) * 0.9
            k = r.uniform(0.75, 1.1)
            c = tuple(int(min(255, v * k)) for v in base)
            wlf = r.uniform(7, 12)
            n = 8
            pts_a, pts_b = [], []
            for i in range(n + 1):
                s = i / n
                px, py = cx + (x1 - cx) * s, y + (y1 - y) * s + 10 * math.sin(s * 3)
                ww = wlf * math.sin(math.pi * min(0.95, 0.1 + s * 0.9)) * (0.4 if s > 0.85 and r.rand() < 0.4 else 1)
                pts_a.append((px, py - ww / 2))
                pts_b.append((px, py + ww / 2))
            if r.rand() < 0.12:                 # broken leaflet
                cut = r.randint(3, 7)
                pts_a, pts_b = pts_a[:cut], pts_b[:cut]
            d.polygon(pts_a + pts_b[::-1], fill=c + (255,))
            d.line(pts_a[:1] + pts_a[-1:], fill=tuple(int(v * 0.7) for v in c) + (255,), width=2)
            y -= r.uniform(16, 26)


frond(0, (150, 140, 118), 1)
frond(CW, (128, 102, 72), 2)
frond(2 * CW, (112, 112, 78), 3)
# reed mat strip: horizontal canes (v across) with gaps and ragged ends
x0 = 3 * CW
y = 30
r = np.random.RandomState(9)
while y < H - 30:
    th = r.uniform(9, 15)
    k = r.uniform(0.8, 1.1)
    c = (int(170 * k), int(150 * k), int(108 * k))
    xa, xb = x0 + r.uniform(4, 30), x0 + CW - r.uniform(4, 30)
    d.rounded_rectangle((xa, y, xb, y + th), radius=th / 2, fill=c + (255,))
    d.line((xa, y + th * 0.3, xb, y + th * 0.3), fill=(min(255, int(c[0] * 1.15)), min(255, int(c[1] * 1.15)), min(255, int(c[2] * 1.1)), 255), width=2)
    y += th + r.uniform(1, 5)
for yy in (H * 0.25, H * 0.5, H * 0.75):       # binding cords
    d.rectangle((x0 + 20, yy, x0 + CW - 20, yy + 7), fill=(90, 72, 50, 255))
a = np.asarray(img).astype(np.float32)
a[..., :3] = np.where(a[..., 3:] > 0, a[..., :3], 0)
# bleed colour into transparent texels (no dark fringes under mip-mapping)
rgb = Image.fromarray(a[..., :3].astype(np.uint8))
mask = Image.fromarray(a[..., 3].astype(np.uint8))
bled = rgb.filter(ImageFilter.GaussianBlur(6))
mb = np.asarray(mask.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255
bl = np.asarray(bled).astype(np.float32) / np.maximum(mb, 1e-3)
out = np.where(a[..., 3:] > 0, a[..., :3], np.clip(bl, 0, 255))
full = np.concatenate([out, a[..., 3:]], -1).astype(np.uint8)
lum = full[..., :3].mean(-1)
nor = np.zeros((H, W, 3), np.uint8)
nor[..., 0], nor[..., 1], nor[..., 2] = 128, 128, 255
arm = np.stack([np.full((H, W), 255, np.uint8), np.full((H, W), 225, np.uint8), np.zeros((H, W), np.uint8)], -1)
for res, px in (('2k', 2048), ('1k', 1024)):
    Image.fromarray(full).resize((px, px), Image.LANCZOS).save(f'{KIT}/lib/{res}/palm_frond_dz_diff.png', optimize=True)
    Image.fromarray(full).resize((px, px), Image.LANCZOS).save(f'{KIT}/lib/{res}/palm_frond_dz_diff.webp', quality=90)
    for nm, arr in (('nor', nor), ('arm', arm)):
        Image.fromarray(arr).resize((px // 4, px // 4)).save(f'{KIT}/lib/{res}/palm_frond_dz_{nm}.jpg', quality=90)
        Image.fromarray(arr).resize((px // 4, px // 4)).save(f'{KIT}/lib/{res}/palm_frond_dz_{nm}.webp', quality=90)
mj = json.load(open(KIT + '/lib/materials.json'))
m = full[..., 3] > 128
mean = [round(float((full[..., i][m] / 255.0).mean()), 4) for i in range(3)]
mj['materials']['palm_frond_dz'] = {
    'label': 'Palm frond / reed mat atlas 4x1 (dry grey | brown | olive frond | cane mat), alpha-tested cards',
    'tile_m': 1.0, 'grain': 'v', 'rot90': False, 'roughness': 0.9, 'metallic': 0.0, 'grime': 0.2, 'mean': mean,
    'normalScale': 0.5, 'alpha': 'MASK', 'alphaCutoff': 0.5, 'doubleSided': True, 'specular': 0.1,
    'maps': {'diff': {'1k': '1k/palm_frond_dz_diff', '2k': '2k/palm_frond_dz_diff'},
             'nor': {'1k': '1k/palm_frond_dz_nor', '2k': '2k/palm_frond_dz_nor'},
             'arm': {'1k': '1k/palm_frond_dz_arm', '2k': '2k/palm_frond_dz_arm'}},
    'source': {'source': 'procedural (art/desert/scripts/make_fronds.py, own work)', 'license': 'CC0-1.0'}}
json.dump(mj, open(KIT + '/lib/materials.json', 'w'), indent=1)
print('ok', mean)
