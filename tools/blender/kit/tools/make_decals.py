"""Own-work (CC0) weathering decal atlas (RGBA, 4x4 cells) + period sign atlas. Writes lib/decals.json rects
(Blender UV space, v up) and merges 'decals' / 'signs' entries into lib/materials.json."""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from make_procedural import fbm, save_rgb, LIB, flat_normal

N = 512           # cell size
G = 4             # grid


def cell_rgba(col, alpha):
    a = np.clip(alpha, 0, 1)
    rgb = np.broadcast_to(np.array(col, np.float32), a.shape + (3,)) if np.ndim(col) == 1 else col
    return np.concatenate([rgb, a[..., None]], -1)


yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N


def streaks(seed, col, dens=0.9, length=0.95, width=0.012, n=26):
    r = np.random.default_rng(seed)
    a = np.zeros((N, N), np.float32)
    for _ in range(n):
        x0 = r.uniform(0.08, 0.92)
        w = width * r.uniform(0.5, 2.2)
        L = length * r.uniform(0.3, 1.0)
        wob = 0.01 * np.sin(yy * r.uniform(8, 20) + r.uniform(0, 6))
        prof = np.exp(-((xx - x0 - wob) / w) ** 2)
        fade = np.clip(1 - yy / L, 0, 1) ** 1.4
        a = np.maximum(a, prof * fade * r.uniform(0.35, 0.9))
    top = np.exp(-(yy / 0.05)) * 0.6 * np.exp(-((xx - 0.5) / 0.35) ** 6)
    a = np.clip(a + top, 0, 1) * dens * (0.7 + 0.3 * fbm(N, 4, 8, seed))
    return cell_rgba(col, a)


def blotch(seed, col, scale=3, thr=0.52, soft=0.12, edge=0.42):
    f = fbm(N, 6, scale, seed)
    rad = np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2)
    m = np.clip((f - thr + (edge - rad) * 0.9) / soft, 0, 1)
    return m


def moss(seed):
    m = blotch(seed, None, 4, 0.5, 0.15)
    f = fbm(N, 6, 16, seed + 1)
    col = np.stack([0.20 + 0.1 * f, 0.26 + 0.12 * f, 0.10 + 0.04 * f], -1)
    return cell_rgba(col, m * (0.55 + 0.45 * f))


def band(seed, col, h0=0.45, wav=0.06, drips=True, dens=0.8):
    r = np.random.default_rng(seed)
    f = fbm(N, 5, 6, seed)
    edge = h0 + wav * (f - 0.5) * 2 + 0.03 * np.sin(xx * 30 + r.uniform(0, 6))
    a = np.clip((yy - edge) / 0.08, 0, 1)
    if drips:
        for _ in range(18):
            x0 = r.uniform(0.02, 0.98)
            L = r.uniform(0.05, 0.25)
            a = np.maximum(a, np.exp(-((xx - x0) / 0.006) ** 2) * np.clip((yy - edge + L) / L, 0, 1) * (yy < edge + 0.02))
    a *= dens * (0.75 + 0.25 * fbm(N, 4, 20, seed + 3))
    return cell_rgba(col, a)


def crack(seed):
    r = np.random.default_rng(seed)
    im = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(im)

    def br(x, y, ang, L, w, depth):
        for _ in range(int(L / 6)):
            ang += r.normal(0, 0.35)
            nx, ny = x + math.cos(ang) * 6, y + math.sin(ang) * 6
            d.line((x, y, nx, ny), fill=230, width=max(1, int(w)))
            x, y = nx, ny
            w *= 0.985
            if depth < 3 and r.random() < 0.05:
                br(x, y, ang + r.choice([-1, 1]) * r.uniform(0.5, 1.1), L * 0.45, w * 0.7, depth + 1)
    br(N * 0.5, 10, math.pi / 2, N * 0.95, 4, 0)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    return cell_rgba((0.07, 0.06, 0.05), a)


def soot(seed):
    m = blotch(seed, None, 3, 0.45, 0.25, 0.45)
    up = np.clip(1.0 - yy * 1.1, 0, 1) ** 0.7        # stronger at top (above openings)
    return cell_rgba((0.045, 0.04, 0.035), m * up * 0.95)


def lichen(seed):
    r = np.random.default_rng(seed)
    a = np.zeros((N, N), np.float32)
    col = np.zeros((N, N, 3), np.float32)
    for _ in range(90):
        cx, cy, rr = r.uniform(0.05, 0.95), r.uniform(0.05, 0.95), r.uniform(0.008, 0.04)
        m = np.clip(1 - np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rr, 0, 1) ** 0.4
        c = [(0.55, 0.55, 0.30), (0.62, 0.62, 0.58), (0.45, 0.50, 0.25)][r.integers(3)]
        col = np.where(m[..., None] > a[..., None], np.array(c, np.float32), col)
        a = np.maximum(a, m * 0.85)
    return cell_rgba(col, a)


def poster(seed, lines, bg, fg):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = 70, 40, N - 70, N - 30
    d.rectangle((x0, y0, x1, y1), fill=bg + (255,))
    fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 44)
    fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 17)
    d.text(((x0 + x1) / 2, y0 + 45), lines[0], font=fb, fill=fg + (255,), anchor='mm')
    d.line((x0 + 30, y0 + 80, x1 - 30, y0 + 80), fill=fg + (255,), width=3)
    r = np.random.default_rng(seed)
    y = y0 + 105
    for t in lines[1:]:
        d.text(((x0 + x1) / 2, y), t, font=fs, fill=fg + (255,), anchor='mm')
        y += 26
    while y < y1 - 30:                     # small-print body (illegible at game scale)
        w = r.integers(150, 330)
        d.line(((x0 + x1) / 2 - w / 2, y, (x0 + x1) / 2 + w / 2, y), fill=fg + (200,), width=5)
        y += 17
    a = np.asarray(im, np.float32) / 255
    wear = fbm(N, 6, 6, seed)                # torn / faded edges and paper staining
    a[..., 3] *= np.clip((wear - 0.22) * 4, 0, 1)
    a[..., :3] *= (0.8 + 0.2 * wear)[..., None]
    return a


CELLS = [
    ('streak_rain', lambda: streaks(1, (0.10, 0.09, 0.075), 0.85)),
    ('streak_rust', lambda: streaks(2, (0.33, 0.14, 0.05), 0.8, 0.7, 0.01, 14)),
    ('moss_patch', lambda: moss(3)),
    ('damp_base', lambda: band(4, (0.13, 0.12, 0.09), 0.55, 0.08, False, 0.75)),
    ('soot', lambda: soot(5)),
    ('crack', lambda: crack(6)),
    ('waterline', lambda: band(7, (0.12, 0.14, 0.10), 0.35, 0.04, True, 0.85)),
    ('lichen', lambda: lichen(8)),
    ('efflorescence', lambda: streaks(9, (0.86, 0.85, 0.80), 0.7, 0.8, 0.02, 16)),
    ('stain_blotch', lambda: cell_rgba((0.17, 0.14, 0.10), blotch(10, None, 3, 0.5, 0.2) * 0.6)),
    ('dirt_splash', lambda: band(11, (0.20, 0.16, 0.11), 0.6, 0.12, False, 0.7)[::-1].copy()),
    ('streak_long', lambda: streaks(12, (0.08, 0.075, 0.06), 0.9, 1.0, 0.03, 8)),
    ('poster_fr', lambda: poster(13, ['AVIS', 'A LA POPULATION', 'Couvre-feu 22 h'], (222, 214, 190), (30, 28, 26))),
    ('poster_de', lambda: poster(14, ['BEKANNTMACHUNG', 'Der Ortskommandant', 'Sperrstunde 22 Uhr'], (228, 200, 120), (25, 22, 20))),
    ('poster_no', lambda: poster(15, ['KUNNGJORING', 'Til befolkningen', 'Portforbud kl. 22'], (210, 206, 196), (40, 20, 18))),
    ('stain_rust_blotch', lambda: cell_rgba((0.30, 0.13, 0.05), blotch(16, None, 5, 0.5, 0.2, 0.35) * 0.7)),
]

SIGNS = [  # (name, text, sub, bg, fg, font, border)
    ('kommandantur', 'KOMMANDANTUR', '', (232, 228, 214), (18, 18, 18), 'NimbusSansNarrow-Bold', True),
    ('achtung_minen', 'ACHTUNG! MINEN', '', (226, 196, 60), (20, 18, 14), 'NimbusSansNarrow-Bold', True),
    ('halt_sperrgebiet', 'HALT! SPERRGEBIET', 'Betreten verboten', (236, 234, 226), (150, 20, 18), 'NimbusSansNarrow-Bold', True),
    ('cafe_gare', 'CAFE DE LA GARE', 'Vins - Liqueurs', (40, 62, 52), (226, 210, 160), 'C059-Bold', False),
    ('boulangerie', 'BOULANGERIE', 'Patisserie', (110, 28, 26), (236, 222, 180), 'C059-Bold', False),
    ('mairie', 'MAIRIE', '', (214, 206, 186), (30, 30, 30), 'P052-Bold', False),
    ('landhandel', 'LANDHANDEL', 'O. Haugen', (238, 232, 212), (30, 40, 70), 'P052-Bold', True),
    ('fjordheim', 'HOTEL FJORDHEIM', '', (26, 44, 58), (230, 226, 210), 'C059-Bold', False),
    ('brucke_12t', 'BRUCKE 12 t', 'Hochstgewicht', (236, 234, 226), (20, 20, 20), 'NimbusSansNarrow-Bold', True),
    ('pont', 'PONT DE ST-ANDRE', 'Route Nationale 13', (40, 70, 140), (240, 240, 236), 'NimbusSans-Bold', True),
    ('garage', 'GARAGE', 'Reparations - Essence', (200, 180, 120), (60, 20, 16), 'NimbusSans-Bold', False),
    ('post', 'POSTKONTOR', '', (160, 30, 26), (238, 226, 190), 'P052-Bold', False),
    ('epicerie', 'EPICERIE - TABAC', '', (224, 214, 186), (20, 50, 90), 'C059-Bold', False),
    ('wache', 'WACHE', '', (60, 60, 56), (230, 230, 226), 'NimbusSansNarrow-Bold', True),
    ('estaminet', 'ESTAMINET', 'Biere - Cafe', (70, 36, 24), (230, 200, 130), 'P052-Bold', False),
    ('ferme', 'FERME DU MOULIN', '', (230, 222, 200), (50, 70, 40), 'C059-Bold', False),
]


def font(name, size):
    import glob
    fs = glob.glob('/usr/share/fonts/**/%s.*' % name, recursive=True)
    return ImageFont.truetype(fs[0], size) if fs else ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)


def sign_img(text, sub, bg, fg, fname, border, seed):
    W, H = 1024, 256
    im = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(im)
    if border:
        d.rectangle((10, 10, W - 11, H - 11), outline=fg, width=8)
    size = 120 if not sub else 104
    f = font(fname, size)
    while d.textlength(text, font=f) > W - 90:
        size -= 4
        f = font(fname, size)
    d.text((W / 2, H / 2 - (24 if sub else 0)), text, font=f, fill=fg, anchor='mm')
    if sub:
        d.text((W / 2, H - 50), sub, font=font(fname, 40), fill=fg, anchor='mm')
    a = np.asarray(im, np.float32) / 255
    wear = fbm(256, 6, 4, seed)
    wear = np.asarray(Image.fromarray((wear * 255).astype(np.uint8)).resize((W, H)), np.float32) / 255
    wood = 0.85 + 0.15 * np.asarray(Image.fromarray((fbm(256, 4, 32, seed + 1) * 255).astype(np.uint8)).resize((W, H)), np.float32)[..., None] / 255
    a = a * wood * (0.78 + 0.22 * wear[..., None])
    return a


if __name__ == '__main__':
    atlas = np.zeros((N * G, N * G, 4), np.float32)
    rects = {}
    for k, (name, fn) in enumerate(CELLS):
        r, c = divmod(k, G)
        atlas[r * N:(r + 1) * N, c * N:(c + 1) * N] = fn()
        rects[name] = [c / G, 1 - (r + 1) / G, (c + 1) / G, 1 - r / G]
    maps = {'diff': save_rgb(atlas, 'decals_rgba', ((1024, '1k'), (2048, '2k')), 'RGBA')}
    sig = np.zeros((256 * 16, 1024, 3), np.float32)
    srects = {}
    for k, s in enumerate(SIGNS):
        sig[k * 256:(k + 1) * 256] = sign_img(s[1], s[2], s[3], s[4], s[5], s[6], 20 + k)
        srects[s[0]] = [0, 1 - (k + 1) / 16, 1, 1 - k / 16]
    im = Image.fromarray((np.clip(sig, 0, 1) * 255).astype(np.uint8))
    smaps = {}
    for res, w in (('1k', 512), ('2k', 1024)):
        x = im.resize((w, w * 4), Image.LANCZOS)
        x.save(os.path.join(LIB, res, 'signs_diff.jpg'), quality=90)
        x.save(os.path.join(LIB, res, 'signs_diff.webp'), quality=88)
        smaps[res] = res + '/signs_diff'
    json.dump({'decals': rects, 'signs': srects, 'signs_aspect': 4.0}, open(os.path.join(LIB, 'decals.json'), 'w'), indent=1)
    mj = os.path.join(LIB, 'materials.json')
    MJ = json.load(open(mj))
    base = {'grain': 'u', 'rot90': False, 'metallic': 0.0, 'grime': 0.0, 'normalScale': 1.0,
            'source': {'source': 'procedural (tools/make_decals.py, own work)', 'license': 'CC0-1.0'}}
    MJ['materials']['decals'] = dict(base, label='Weathering decal atlas (alpha blend)', tile_m=1.0, roughness=0.95,
                                     mean=[0.2, 0.2, 0.2], maps={'diff': maps['diff']}, alpha='BLEND', specular=0.0, atlas='decals')
    MJ['materials']['signs'] = dict(base, label='Painted sign atlas', tile_m=1.0, roughness=0.8, mean=[0.5, 0.45, 0.4],
                                    maps={'diff': {'1k': smaps['1k'], '2k': smaps['2k']}}, atlas='signs', specular=0.3)
    json.dump(MJ, open(mj, 'w'), indent=1)
    print('decals done', len(rects), len(srects))
