"""Stage 4 of the detailed hero: grade the RGBA master and write the responsive variants the splash picks from
(src/ui/hero-art.js): hero-{900,1350,1800,2700}.{avif,webp}, 2:3, alpha kept.
  python3 tools/ui/keyart/herohd/variants.py <master.png> <out dir> [--q-webp 80] [--q-avif 60]
Needs Pillow >= 11.3 (AVIF). The grade: blacks crushed a touch, split tone (cool shadows, fire-warm highlights), a
faint film grain scaled to each size so it stays ~1 px."""
import sys, os
import numpy as np
from PIL import Image

HEIGHTS = [900, 1350, 1800, 2700]


def grade(rgba):
    a = np.asarray(rgba).astype(np.float32) / 255.0
    rgb, al = a[..., :3], a[..., 3:]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rgb = np.clip((rgb - 0.012) * 1.06, 0, 1) ** 1.03
    warm = np.array([1.04, 0.98, 0.9], np.float32); cool = np.array([0.9, 0.95, 1.06], np.float32)
    k = np.clip(lum * 1.5, 0, 1)[..., None]
    rgb = rgb * (cool * (1 - k) + warm * k)
    return np.concatenate([np.clip(rgb, 0, 1), al], -1)


def plate(sky_png, ground_png, out, qw=80, qa=58):
    """The splash background: sky.svg rasterised without its flat tank / ground (rasterize_svg.mjs), its colour taken
    from a heavily blurred copy (the SVG smoke's thin green fringes go, the fire glow stays), the rendered ground plate
    over it. Writes sky-{1600,3200}.{webp,avif}, 16:9, opaque."""
    from PIL import ImageFilter
    sky = Image.open(sky_png).convert('RGB')
    gp = Image.open(ground_png).convert('RGBA')
    sky = sky.resize(gp.size, Image.LANCZOS)
    a = np.asarray(sky).astype(np.float32) / 255
    blur = np.asarray(sky.filter(ImageFilter.GaussianBlur(radius=sky.width / 40))).astype(np.float32) / 255
    w = np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum, lumb = a @ w, blur @ w
    chroma = blur / np.maximum(lumb[..., None], 1e-3)
    a = np.clip(lum[..., None] * chroma, 0, 1)
    base = Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB').convert('RGBA')
    base.alpha_composite(gp)
    base = base.convert('RGB')
    rng = np.random.default_rng(3)
    for wd in (1600, 3200):
        v = base.resize((wd, wd * 9 // 16), Image.LANCZOS)
        arr = np.asarray(v).astype(np.float32) + rng.normal(0, 1.6, (wd * 9 // 16, wd, 1))
        v = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
        pw, pa = os.path.join(out, f'sky-{wd}.webp'), os.path.join(out, f'sky-{wd}.avif')
        v.save(pw, quality=qw, method=6); v.save(pa, quality=qa, speed=2)
        print(f'sky-{wd}: webp {os.path.getsize(pw) / 1024:.0f} KB  avif {os.path.getsize(pa) / 1024:.0f} KB')


def main():
    if '--plate' in sys.argv:
        a = [x for x in sys.argv[1:] if not x.startswith('--')]
        return plate(a[0], a[1], a[2])
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src, out = args[0], args[1]
    qw = int(sys.argv[sys.argv.index('--q-webp') + 1]) if '--q-webp' in sys.argv else 80
    qa = int(sys.argv[sys.argv.index('--q-avif') + 1]) if '--q-avif' in sys.argv else 60
    im = Image.open(src).convert('RGBA')
    assert abs(im.width / im.height - 2 / 3) < 0.01, im.size
    g = grade(im)
    master = Image.fromarray((g * 255 + 0.5).astype(np.uint8), 'RGBA')
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(6)
    for h in HEIGHTS:
        w = h * 2 // 3
        v = master if master.size == (w, h) else master.resize((w, h), Image.LANCZOS)
        arr = np.asarray(v).astype(np.float32)
        grain = rng.normal(0, 2.2, arr.shape[:2])[..., None]
        arr[..., :3] = np.clip(arr[..., :3] + grain * (arr[..., 3:] / 255.0), 0, 255)
        v = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        pw = os.path.join(out, f'hero-{h}.webp'); pa = os.path.join(out, f'hero-{h}.avif')
        v.save(pw, quality=qw, method=6, alpha_quality=90)
        v.save(pa, quality=qa, speed=2)
        print(f'hero-{h}: {w}x{h}  webp {os.path.getsize(pw) / 1024:.0f} KB  avif {os.path.getsize(pa) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
