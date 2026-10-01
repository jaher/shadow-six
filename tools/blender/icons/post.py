# post.py - masters (Blender renders) -> shipped icons: grade, contact shadow, soft dark halo, Lanczos in linear light,
# unsharp per tier, WebP (alpha) + PNG fallback.  usage: python3 post.py [id-glob ...]   (system python: numpy + Pillow)
import os, sys, json, glob, fnmatch
import numpy as np
from PIL import Image, ImageFilter

SCRATCH = os.environ.get('ICON_SCRATCH', os.path.expanduser('~/.cache/shadow-six/icons'))
MASTERS = os.path.join(SCRATCH, 'masters'); OUT = os.path.join(SCRATCH, 'out')
TIERS = {'item': [2, 3, 4, 6], 'tool': [2, 3, 4, 6], 'badge': [2, 3, 4, 6], 'cursor': [1, 1.5, 2, 3, 4]}   # cursors scale with the UI
SHADOW = {'item': 0.42, 'tool': 0.30, 'badge': 0.0, 'cursor': 0.30}


def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def l2s(x): x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def load(p):
    return np.asarray(Image.open(p).convert('RGBA'), dtype=np.float32) / 255.0


def blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), 'L')
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0


def dilate(a, px):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), 'L')
    k = int(px) * 2 + 1
    return np.asarray(im.filter(ImageFilter.MaxFilter(k)), dtype=np.float32) / 255.0 if px >= 1 else a


def grade(rgb, sat=0.9, black=14 / 255, white=245 / 255, warm=0.03):
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rgb = lum[..., None] + (rgb - lum[..., None]) * sat
    mid = 4 * lum * (1 - lum)
    rgb = rgb * (1 + np.stack([warm * mid, warm * 0.5 * mid, -warm * mid], -1))
    return black + np.clip(rgb, 0, 1) * (white - black)


def erode(a, px):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), 'L')
    k = int(px) * 2 + 1
    return np.asarray(im.filter(ImageFilter.MinFilter(k)), dtype=np.float32) / 255.0 if px >= 1 else a


def edge_light(rgb, a, unit, amount=0.20):
    """Thin inner highlight on the silhouette edges that face the key light (screen upper-left): the prop pops off
    the dark pack the way painted game icons do, without a glow."""
    ab = blur(a, 0.9 * unit)
    gy, gx = np.gradient(ab)
    mag = np.sqrt(gx * gx + gy * gy) + 1e-6
    face = np.clip((gx + gy) / (1.41421 * mag), 0, 1)            # alpha rises towards +x,+y = edge faces upper-left
    band = np.clip(a - erode(a, max(1, 1.2 * unit)), 0, 1)
    band = blur(band, 0.5 * unit) * a
    k = (amount * band * face ** 1.5)[..., None]
    return rgb + (1 - rgb) * k


EDGE = {  # (dark contour width, opacity) in @2x device px; light outer contour (width, opacity) for cursors
    'item': ((0.9, 0.80), None), 'tool': ((0.9, 0.70), None), 'badge': ((0.0, 0.0), None),
    'cursor': ((1.1, 0.95), (1.2, 0.85)),
}


def compose(meta, obj, sh, cls, px_per_ref, halo=None):
    """Object over (contact shadow + crisp dark contour [+ light outer contour for cursors]).
    Straight-alpha sRGB float arrays at master size. `halo` = (width, opacity) overrides the dark contour."""
    rgb, a = grade(obj[..., :3]), obj[..., 3]
    unit = meta['master'][0] / meta['box'][0] / 2.0         # master px per @2x device px (ref px / 2)
    if cls in ('item', 'tool', 'cursor') and not meta.get('vignette'):
        rgb = edge_light(rgb, a, unit, meta.get('edge_light', 0.22 if cls != 'tool' else 0.16))
    if sh is not None:
        s = np.clip((sh[..., 3] - a) / np.maximum(1 - a, 1e-3), 0, 1) * SHADOW[cls]
    else:
        s = np.zeros_like(a)
    (dw, do), light = EDGE.get(cls, EDGE['item'])
    if halo is not None: dw, do = halo
    ha = np.clip(blur(dilate(a, max(dw * unit, 0)), 0.35 * unit) * 1.15, 0, 1) * do if dw > 0 else np.zeros_like(a)
    under_a = 1 - (1 - s) * (1 - ha)
    col = np.array([10, 8, 5], np.float32) / 255
    if light:   # cursor: dark contour inside a light one -> reads on grass, snow and dark water alike
        lw, lo = light
        la = np.clip(blur(dilate(a, (dw + lw) * unit), 0.35 * unit) * 1.15, 0, 1) * lo
        la = np.clip(la - ha, 0, 1)
        out_a = ha + la * (1 - ha)
        lc = np.array([236, 226, 200], np.float32) / 255
        under = (lc * (la * (1 - ha))[..., None] + col * ha[..., None]) / np.maximum(out_a[..., None], 1e-4)
        under_a = out_a
    else:
        under = np.broadcast_to(col, rgb.shape)
    A = a + under_a * (1 - a)
    C = (rgb * a[..., None] + under * (under_a * (1 - a))[..., None]) / np.maximum(A[..., None], 1e-4)
    return np.dstack([C, A])


def resize(img, w, h):
    """Lanczos in linear light on premultiplied alpha."""
    a = img[..., 3]; lin = s2l(img[..., :3]) * a[..., None]
    ch = []
    for c in [lin[..., 0], lin[..., 1], lin[..., 2], a]:
        ch.append(np.asarray(Image.fromarray(c.astype(np.float32), 'F').resize((w, h), Image.LANCZOS)))
    A = np.clip(ch[3], 0, 1)
    rgb = np.stack(ch[:3], -1) / np.maximum(A[..., None], 1e-5)
    return np.dstack([l2s(rgb), A])


def to_pil(img, sharpen=True):
    im = Image.fromarray(np.clip(np.round(img * 255), 0, 255).astype(np.uint8), 'RGBA')
    if sharpen:
        r, g, b, a = im.split()
        rgb = Image.merge('RGB', (r, g, b)).filter(ImageFilter.UnsharpMask(radius=0.5, percent=60, threshold=2))
        im = Image.merge('RGBA', (*rgb.split(), a))
    return im


def autocrop(img, meta, margin=0.035):
    """Crop to the alpha bbox and pad back to the box aspect with a uniform margin (consistent framing for every icon).
    Knapsack items (meta.slot) keep their own tight aspect instead; mass_box then sizes their ref box."""
    a = img[..., 3]; ys, xs = np.nonzero(a > 0.02)
    if len(xs) == 0: return img, meta
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    bw, bh = meta['box']; asp = bw / bh
    if meta.get('slot'):
        m = margin * max(x1 - x0, y1 - y0)
        asp = (x1 - x0 + 2 * m) / (y1 - y0 + 2 * m)
    w, h = (x1 - x0), (y1 - y0)
    W = max(w, h * asp) / (1 - 2 * margin); H = W / asp
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    X0, Y0 = int(round(cx - W / 2)), int(round(cy - H / 2)); Wi, Hi = int(round(W)), int(round(H))
    out = np.zeros((Hi, Wi, 4), np.float32)
    sx0, sy0 = max(0, X0), max(0, Y0); sx1, sy1 = min(img.shape[1], X0 + Wi), min(img.shape[0], Y0 + Hi)
    out[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = img[sy0:sy1, sx0:sx1]
    meta = dict(meta); meta['master'] = [Wi, Hi]
    if meta.get('hot'): meta['hot'] = [meta['hot'][0] - X0, meta['hot'][1] - Y0]
    return out, meta


# Knapsack rule (review): every item carries the same visual mass (opaque ref px^2) whatever its shape; long guns
# (slot 2) span two pack slots. Caps keep an icon inside its slot.
MASS = {1: 640.0, 2: 1150.0}
CAP = {1: (48.0, 34.0), 2: (100.0, 34.0)}


def mass_box(img, meta):
    """Tight crop already done: size the ref box so the opaque area equals MASS[slot] (ref px^2), capped by CAP."""
    slot = meta.get('slot')
    if not slot: return meta
    H, W = img.shape[:2]
    cover = float((img[..., 3] > 0.5).sum())               # opaque master px (prop + contour)
    k = (MASS[slot] / max(cover, 1.0)) ** 0.5               # ref px per master px
    cw, ch = CAP[slot]
    k = min(k, cw / W, ch / H)
    meta = dict(meta); meta['box'] = [max(1, int(round(W * k))), max(1, int(round(H * k)))]
    meta['mass'] = round(cover * k * k, 1)
    return meta


def glow(img, color, radius, strength):
    """Soft coloured glow under the icon (radius in master px)."""
    a = img[..., 3]
    g = np.clip(blur(dilate(a, radius * 0.35), radius) * strength, 0, 1)
    ga = g * (1 - a)
    A = a + ga
    C = (img[..., :3] * a[..., None] + np.array(color, np.float32) * ga[..., None]) / np.maximum(A[..., None], 1e-4)
    return np.dstack([C, A])


def fx_scale(img, k, dy):
    h, w = img.shape[:2]
    out = np.zeros_like(img)
    im = resize(img, max(1, int(w * k)), max(1, int(h * k)))
    y0 = (h - im.shape[0]) // 2 + int(dy * h); x0 = (w - im.shape[1]) // 2
    out[y0:y0 + im.shape[0], x0:x0 + im.shape[1]] = im[:max(0, min(im.shape[0], h - y0))]
    return out


def tint(img, mul=1.0, sat=1.0, alpha=1.0):
    rgb = img[..., :3]; lum = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    rgb = np.clip((lum + (rgb - lum) * sat) * mul, 0, 1)
    return np.dstack([rgb, img[..., 3] * alpha])


VARIANTS = {
    # review: hover and pressed must read apart at a glance: hover lifts + brass glow, pressed sinks darker and smaller
    'hover': lambda im, u: glow(tint(im, 1.2, 1.05), (0.90, 0.72, 0.34), 6 * u, 0.8),
    'pressed': lambda im, u: fx_scale(tint(im, 0.66, 0.9), 0.9, 0.035),
    'active': lambda im, u: glow(tint(im, 1.06), (1.0, 0.56, 0.10), 6 * u, 0.8),
    'disabled': lambda im, u: tint(im, 0.62, 0.15, 0.85),
}
STATEFUL = ('camera', 'help', 'hand', 'notebook', 'stance.crawl', 'stance.stand', 'eye.open')


def save_png(im, path):
    """PNG fallback (8-bit RGBA). WebP is primary; fallbacks ship only for the two base tiers (see build)."""
    im.save(path, optimize=True)


def build(meta_path, variant_fx=None, suffix='', tiers=None):
    meta = json.load(open(meta_path)); cls = meta['cls']; iid = meta['id']
    obj = load(meta_path[:-5] + '.png')
    shp = meta_path[:-5] + '.sh.png'
    sh = load(shp) if os.path.exists(shp) else None
    if meta.get('vignette'):   # feathered ellipse: the eye peeks out of the dark HUD box
        h_, w_ = obj.shape[:2]; yy, xx = np.mgrid[0:h_, 0:w_]
        d = np.sqrt(((xx - w_ / 2) / (w_ / 2)) ** 2 + ((yy - h_ / 2) / (h_ / 2)) ** 2)
        obj = obj.copy(); fall = np.clip((1.0 - d) / 0.55, 0, 1) ** 1.3
        obj[..., :3] *= fall[..., None]; obj[..., 3] *= np.clip((1.0 - d) / 0.06, 0, 1)
    full = compose(meta, obj, sh, cls, None, meta.get('halo') or ((0.0, 0.0) if meta.get('vignette') else None))
    if not meta.get('vignette') and not meta.get('nocrop'):
        full, meta = autocrop(full, meta, 0.07 if cls == 'tool' else 0.035)
        meta = mass_box(full, meta)
    if meta.get('glow'):
        full = glow(full, meta['glow'], full.shape[1] * 0.05, 0.9)
    if variant_fx: full = variant_fx(full)
    os.makedirs(os.path.join(OUT, cls), exist_ok=True)
    res = []
    for t in tiers or meta.get('tiers', TIERS[cls]):
        w, h = int(round(meta['box'][0] * t)), int(round(meta['box'][1] * t))
        im = to_pil(resize(full, w, h))
        tag = ('%gx' % t).replace('.', 'p')
        base = os.path.join(OUT, cls, f'{iid}{suffix}@{tag}')
        im.save(base + '.webp', 'WEBP', quality=90, method=6, exact=False)
        tl = tiers or meta.get('tiers', TIERS[cls])
        png = t in sorted(tl)[:2]
        if png: save_png(im, base + '.png')
        elif os.path.exists(base + '.png'): os.remove(base + '.png')
        res.append((tag, w, h, os.path.getsize(base + '.webp'), os.path.getsize(base + '.png') if png else 0))
    return meta, res


def manifest_entry(meta, res):
    e = {'class': meta['cls'], 'box': meta['box'], 'files': {}}
    if meta.get('slot'): e['slot'] = meta['slot']
    for tag, w, h, wb, pb in res:
        f = {'w': w, 'h': h, 'webp': wb}
        if pb: f['png'] = pb
        if meta.get('hot'):
            k = w / meta['master'][0]
            f['hot'] = [round(meta['hot'][0] * k, 1), round(meta['hot'][1] * k, 1)]
        e['files'][tag] = f
    return e


if __name__ == '__main__':
    pats = sys.argv[1:] or ['*']
    mpath = os.path.join(OUT, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for mp in sorted(glob.glob(os.path.join(MASTERS, '*', '*.json'))):
        iid = os.path.basename(mp)[:-5]
        if any(fnmatch.fnmatch(iid, p) for p in pats):
            if os.path.basename(os.path.dirname(mp)) == 'raw': continue     # intermediate renders (eye before its porthole)
            meta, res = build(mp)
            man[f"{meta['cls']}/{iid}"] = manifest_entry(meta, res)
            if meta['cls'] == 'tool' and iid in STATEFUL:
                u = meta['master'][0] / meta['box'][0] / 2.0
                for vn, fx in VARIANTS.items():
                    m2, r2 = build(mp, lambda im, fx=fx: fx(im, u), suffix='.' + vn, tiers=[2, 3, 4])
                    man[f"tool/{iid}.{vn}"] = manifest_entry(m2, r2)
            print(meta['cls'], iid, ' '.join(f'{t}:{w}x{h}:{wb // 1024}k' for t, w, h, wb, pb in res))
    json.dump(man, open(mpath, 'w'), indent=1, sort_keys=True)
