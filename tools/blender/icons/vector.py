# vector.py - pure-graphic cursors (arrow, crosshair, target, tracking arrows, forbidden overlay, move sparkle, scope
# reticle) and portrait-state ink stamps, drawn at 16x (stamps 48x) and Lanczos-downsampled. Writes
# out/<cls>/<id>@<tier>.webp|png (lossless WebP) and merges entries into out/manifest.json.  usage: python3 vector.py
import os, json, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import post as P

SS = 16            # supersampling per ref px
STAMP_SS = 48      # stamps: a 16-ref-px stamp is drawn up to 40 ref px (the dead man's skull, the cell bars: 2.5x) -> tiers to 16x
STAMP_TIERS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16]
OUT = P.OUT


def canvas(n):
    return Image.new('RGBA', (n * SS, n * SS), (0, 0, 0, 0))


def outline(im, px, col=(10, 8, 6), alpha=0.85):
    """Dark keyline under the drawing: dilated alpha (px in ref units)."""
    a = im.split()[3]
    k = int(px * SS) * 2 + 1
    d = a.filter(ImageFilter.MaxFilter(k if k % 2 else k + 1)).filter(ImageFilter.GaussianBlur(SS * 0.25))
    base = Image.new('RGBA', im.size, col + (0,)); base.putalpha(d.point(lambda v: int(v * alpha)))
    base.alpha_composite(im)
    return base


def S(v): return [(x * SS, y * SS) for x, y in v]


# One cursor family (review): the graphic cursors are brass / vitreous-enamel badges, shaded like the rendered
# props and finished by post.compose with the same crisp dark + light double outline as every rendered cursor.
BRASS = ((0.98, 0.86, 0.52), (0.52, 0.36, 0.14))
ENAMEL = {'red': ((0.86, 0.16, 0.12), (0.46, 0.04, 0.03)), 'orange': ((0.98, 0.58, 0.14), (0.62, 0.28, 0.04)),
          'brass': BRASS, 'gold': ((1.0, 0.92, 0.62), (0.70, 0.50, 0.18))}


def badge(mask, fill='brass', rim=0.9):
    """mask: L image (SS res). Enamel body with a top-left light gradient + specular sheen, polished brass rim band
    (rim ref px wide; 0 = solid brass). Returns straight-alpha float RGBA."""
    m = np.asarray(mask, np.float32) / 255
    h, w = m.shape; yy, xx = np.mgrid[0:h, 0:w]
    g = np.clip(((xx / w) + (yy / h)) / 2, 0, 1)[..., None]            # 0 top-left .. 1 bottom-right
    hi, lo = (np.array(c, np.float32) for c in ENAMEL[fill])
    body = hi * (1 - g) + lo * g
    if rim > 0:
        er = np.asarray(mask.filter(ImageFilter.MinFilter(int(rim * SS) * 2 + 1)), np.float32) / 255
        band = np.clip(m - er, 0, 1)[..., None]
        bh, bl = (np.array(c, np.float32) for c in BRASS)
        brass = bh * (1 - g) + bl * g
        body = body * (1 - band) + brass * band
    sheen = np.clip(1 - np.abs((xx / w + yy / h) - 0.55) * 6, 0, 1)[..., None] * 0.18      # glossy streak
    body = np.clip(body + sheen, 0, 1)
    return np.dstack([P.l2s(P.s2l(body)), m])


def finish(arr, box):
    """Same finish as the rendered cursors: edge light + dark keyline inside a light one (post.compose)."""
    meta = {'master': [arr.shape[1], arr.shape[0]], 'box': list(box)}
    out = P.compose(meta, arr, None, 'cursor', None)
    return Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8), 'RGBA')


def mask(n):
    return Image.new('L', (n * SS, n * SS), 0)


def arrow():
    m = mask(32); d = ImageDraw.Draw(m)
    d.polygon(S([(3, 2), (24, 15), (15, 17), (20, 27), (16.5, 28.5), (11.5, 18.5), (4.5, 25)]), fill=255)
    return finish(badge(m, 'brass', rim=0), (32, 32)), (3, 2)


def ring_ticks(d, c, r, w, gap=(11, 21), lo=2.5, hi=29.5):
    d.ellipse((c - r, c - r, c + r, c + r), outline=255, width=w)
    for a, b in (((16, lo), (16, gap[0])), ((16, gap[1]), (16, hi)), ((lo, 16), (gap[0], 16)), ((gap[1], 16), (hi, 16))):
        d.line(S([a, b]), fill=255, width=w)


def crosshair():
    m = mask(32); d = ImageDraw.Draw(m)
    ring_ticks(d, 16 * SS, 9.5 * SS, int(3.0 * SS))
    return finish(badge(m, 'red', rim=0.8), (32, 32)), (16, 16)


def target():
    m = mask(32); d = ImageDraw.Draw(m)
    ring_ticks(d, 16 * SS, 10 * SS, int(2.8 * SS), gap=(10, 22))
    return finish(badge(m, 'brass', rim=0), (32, 32)), (16, 16)


def track():
    m = mask(32); d = ImageDraw.Draw(m)
    for tri in ([(16, 1.5), (22, 8.5), (10, 8.5)], [(16, 30.5), (22, 23.5), (10, 23.5)], [(1.5, 16), (8.5, 10), (8.5, 22)], [(30.5, 16), (23.5, 10), (23.5, 22)]):
        d.polygon(S(tri), fill=255)
    d.ellipse(S([(13.2, 13.2), (18.8, 18.8)]), fill=255)
    return finish(badge(m, 'orange', rim=0.8), (32, 32)), (16, 16)


def forbidden():
    m = mask(32); d = ImageDraw.Draw(m); c = 16 * SS; r = 11.5 * SS; w = int(4.2 * SS)
    d.ellipse((c - r, c - r, c + r, c + r), outline=255, width=w)
    d.line(S([(8.2, 8.2), (23.8, 23.8)]), fill=255, width=w)
    return finish(badge(m, 'red', rim=0.8), (32, 32)), (16, 16)


def star(d, cx, cy, r0, r1, fill):
    pts = [(cx + (r1 if i % 2 == 0 else r0) * math.cos(math.radians(-90 + i * 45)), cy + (r1 if i % 2 == 0 else r0) * math.sin(math.radians(-90 + i * 45))) for i in range(8)]
    d.polygon(S(pts), fill=fill)


def sparkle(frame):
    m = mask(28); d = ImageDraw.Draw(m)
    k = 1.0 if frame == 'a' else 0.75
    star(d, 11, 10, 2.2 * k, 9 * k, 255); star(d, 22, 20, 1.5, 6 * (1.75 - k), 255)
    im = finish(badge(m, 'gold', rim=0), (28, 28))
    glow = im.filter(ImageFilter.GaussianBlur(SS * 1.6))
    g = Image.new('RGBA', im.size, (255, 220, 120, 0)); g.putalpha(glow.split()[3].point(lambda v: int(v * 0.6)))
    g.alpha_composite(im)
    return g, (14, 14)


def reticle(col):
    """No.32 scope: pointed post from below + horizontal wire with thick outer bars (88 ref px)."""
    im = canvas(88); d = ImageDraw.Draw(im); c = 44
    d.line(S([(8, c), (80, c)]), fill=col, width=int(0.9 * SS))
    d.line(S([(8, c), (30, c)]), fill=col, width=int(3.2 * SS)); d.line(S([(58, c), (80, c)]), fill=col, width=int(3.2 * SS))
    d.polygon(S([(c - 2.2, 82), (c + 2.2, 82), (c + 2.2, 52), (c, 45.5), (c - 2.2, 52)]), fill=col)
    return outline(im, 0.9, alpha=0.7)


def distress(im, seed, amount=0.28):
    """Rubber-stamp ink: uneven density + speckle voids + slightly rough edges (the same pattern at any SS)."""
    rnd = np.random.default_rng(seed); w, h = im.size; q = SS / 16
    n = rnd.random((int(h // (48 * q)) + 1, int(w // (48 * q)) + 1)).astype(np.float32)
    n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    sp = (rnd.random((int(h // (6 * q)), int(w // (6 * q)))) > 0.992).astype(np.uint8) * 255
    sp = np.asarray(Image.fromarray(sp).resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(4 * q)), np.float32) / 255
    a = np.asarray(im.split()[3], np.float32) / 255
    a = a * np.clip(1 - amount * (1 - n) - 0.8 * sp, 0, 1)
    im = im.copy(); im.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return im


def stamp(name, ink=(34, 28, 24)):
    im = canvas(16); d = ImageDraw.Draw(im); f = ink + (240,)
    qw = lambda v: int(v * 16) * SS // 16   # line widths quantised as at 16x: the same stamps at any supersampling
    if name == 'vehicle':
        d.polygon(S([(1, 10), (1, 5), (9, 5), (9, 7), (12, 7), (15, 9.5), (15, 12), (1, 12)]), fill=f)
        for x in (4, 12): d.ellipse(S([(x - 2, 10.5), (x + 2, 14.5)]), fill=f)
        d.rectangle(S([(10, 7.8), (12.3, 9.3)]), fill=(0, 0, 0, 0))
    elif name == 'house':
        d.polygon(S([(1, 8), (8, 1.5), (15, 8), (13.5, 8), (13.5, 15), (2.5, 15), (2.5, 8)]), fill=f)
        d.rectangle(S([(6.5, 10), (9.5, 15)]), fill=(0, 0, 0, 0)); d.rectangle(S([(10.5, 3), (12, 6)]), fill=f)
    elif name == 'shovel':
        d.polygon(S([(6, 9), (10, 9), (10, 13), (8, 15.5), (6, 13)]), fill=f)
        d.rectangle(S([(7.4, 2.5), (8.6, 9)]), fill=f); d.rectangle(S([(5.5, 1), (10.5, 2.8)]), fill=f)
    elif name == 'bubbles':
        for cx, cy, r in ((6, 11, 3.2), (11, 6, 2.4), (5, 4, 1.6), (12, 12, 1.3)):
            d.ellipse(S([(cx - r, cy - r), (cx + r, cy + r)]), outline=f, width=qw(1.3))
            d.ellipse(S([(cx - r * 0.45, cy - r * 0.6), (cx - r * 0.05, cy - r * 0.2)]), fill=f)      # ink highlight tick
    elif name == 'skull':
        d.ellipse(S([(2.5, 1), (13.5, 11.5)]), fill=f); d.rectangle(S([(5, 9), (11, 14)]), fill=f)
        for x in (4.5, 8.8): d.ellipse(S([(x, 5), (x + 2.8, 8.2)]), fill=(0, 0, 0, 0))
        d.polygon(S([(8, 8.6), (7, 10.4), (9, 10.4)]), fill=(0, 0, 0, 0))
        for x in (6.2, 8.0, 9.8): d.line(S([(x, 11.6), (x, 14)]), fill=(0, 0, 0, 0), width=qw(0.6))
    elif name == 'bars':      # cell window: frame + bars, stamped in the same black ink
        d.rectangle(S([(0.5, 0.5), (15.5, 15.5)]), outline=f, width=qw(1.6))
        for x in (4.2, 7.3, 10.4):
            d.rectangle(S([(x, 0.5), (x + 1.5, 15.5)]), fill=f)
        d.rectangle(S([(0.5, 7.0), (15.5, 8.6)]), fill=f)
    return distress(im, sum(map(ord, name)))


def emit(cls, iid, im, box, hot=None, tiers=None, ss_min=2):
    """Downsample the SS-res drawing to each tier (Lanczos, linear light) and save + manifest entry."""
    arr = np.asarray(im, np.float32) / 255
    tiers = tiers or P.TIERS[cls if cls in P.TIERS else 'item']
    top = min(im.width / box[0], im.height / box[1]) / ss_min + 0.02     # ImageDraw is aliased: keep >= 2x supersampling
    tiers = [t for t in tiers if t <= top]
    os.makedirs(os.path.join(OUT, cls), exist_ok=True); res = []
    for t in tiers:
        w, h = P.tier_px(box[0], t), P.tier_px(box[1], t)
        pim = P.to_pil(P.resize(arr, w, h), sharpen=False)
        tag = P.tier_tag(t); base = os.path.join(OUT, cls, f'{iid}@{tag}')
        P.save_webp(pim, base + '.webp')
        png = t in P.PNG_TIERS.get(cls if cls in P.PNG_TIERS else 'item', ())
        if png: P.save_png(pim, base + '.png')
        elif os.path.exists(base + '.png'): os.remove(base + '.png')
        res.append((tag, w, h, os.path.getsize(base + '.webp'), os.path.getsize(base + '.png') if png else 0))
    meta = {'cls': cls, 'box': list(box), 'master': [im.width, im.height]}
    if hot: meta['hot'] = [hot[0] * im.width / box[0], hot[1] * im.height / box[1]]
    e = P.manifest_entry(meta, res); e['vector'] = True
    return e


def scope(col, tag):
    ring = P.load(os.path.join(P.MASTERS, 'cursor', 'scope.ring.png'))
    meta = json.load(open(os.path.join(P.MASTERS, 'cursor', 'scope.ring.json')))
    full = P.compose(meta, ring, None, 'cursor', None, (1.0, 0.6))
    n = full.shape[0]; yy, xx = np.mgrid[0:n, 0:n]; d = np.hypot(xx - n / 2, yy - n / 2) / (n / 2)
    inside = d < 0.86
    # coated lens: blue-green tint that deepens to the rim (clear-ish centre) + a soft reflection crescent upper-left
    tint = (0.10 + np.clip((d - 0.35) / 0.5, 0, 1) ** 2 * 0.45) * inside
    ang = np.arctan2(yy - n / 2, xx - n / 2)
    cres = np.clip(1 - np.abs(d - 0.70) / 0.06, 0, 1) * np.clip(np.cos(ang + 2.36), 0, 1) ** 3 * 0.45 * inside
    lens = np.array([0.10, 0.20, 0.22]) * (1 - cres[..., None]) + np.array([0.92, 0.96, 1.0]) * cres[..., None]
    under_a = np.clip(tint + cres, 0, 1); A = full[..., 3] + under_a * (1 - full[..., 3])
    C = (full[..., :3] * full[..., 3:4] + lens * (under_a * (1 - full[..., 3]))[..., None]) / np.maximum(A[..., None], 1e-4)
    base = Image.fromarray((np.dstack([C, A]) * 255).clip(0, 255).astype(np.uint8), 'RGBA')
    ret = reticle(col).resize(base.size, Image.LANCZOS)
    m = Image.fromarray(((d < 0.80) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
    ra = ImageChops.multiply(ret.split()[3], m); ret.putalpha(ra)
    base.alpha_composite(ret)
    return emit('cursor', f'scope.{tag}', base, (88, 88), hot=(44, 44), ss_min=1)   # rendered ring: already anti-aliased


if __name__ == '__main__':
    mpath = os.path.join(OUT, 'manifest.json'); man = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for iid, fn in (('arrow', arrow), ('crosshair', crosshair), ('target', target), ('track', track), ('forbidden', forbidden)):
        im, hot = fn(); man[f'cursor/{iid}'] = emit('cursor', iid, im, (32, 32), hot)
    for fr in 'ab':
        im, hot = sparkle(fr); man[f'cursor/sparkle.{fr}'] = emit('cursor', f'sparkle.{fr}', im, (28, 28), hot)
    man['cursor/scope.ok'] = scope((57, 211, 83, 255), 'ok')
    man['cursor/scope.bad'] = scope((226, 40, 34, 255), 'bad')
    SS = STAMP_SS
    for s_ in ('vehicle', 'house', 'shovel', 'bubbles', 'skull', 'bars'):
        man[f'stamp/{s_}'] = emit('stamp', s_, stamp(s_), (16, 16), tiers=STAMP_TIERS)
    json.dump(man, open(mpath, 'w'), indent=1, sort_keys=True)
    print('vector icons ->', OUT)
