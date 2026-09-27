# grade.py in.png out.webp W H mode  — downscale (noise ↓), filmic grade, grain; alpha kept
import sys, numpy as np
from PIL import Image, ImageFilter
src, out, W, H, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
im = Image.open(src).convert('RGBA')
im = im.filter(ImageFilter.MedianFilter(3)).resize((W, H), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
rgb, al = a[..., :3], a[..., 3:]
if mode == 'hero':
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rgb = np.clip((rgb - 0.02) * 1.12, 0, 1) ** 1.05                    # crush the blacks a touch
    warm = np.array([1.06, 0.97, 0.86], np.float32); cool = np.array([0.86, 0.93, 1.08], np.float32)
    k = np.clip(lum * 1.6, 0, 1)[..., None]
    rgb = rgb * (cool * (1 - k) + warm * k)                               # split tone: cool shadows, fire highlights
elif mode == 'sepia':
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum = np.clip((lum - 0.03) * 1.15, 0, 1) ** 0.95
    rgb = lum[..., None] * np.array([1.0, 0.9, 0.74], np.float32) + (1 - lum[..., None]) * 0.0
if mode == 'muted':
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    rgb = lum * 0.4 + rgb * 0.6
    rgb = np.clip((rgb - 0.03) * 1.1, 0, 1) ** 1.12 * np.array([1.04, 0.99, 0.86], np.float32)
rng = np.random.default_rng(6)
rgb = np.clip(rgb + rng.normal(0, 0.012, rgb.shape[:2])[..., None], 0, 1)
o = np.concatenate([rgb, al], -1)
Image.fromarray((o * 255).astype(np.uint8), 'RGBA').save(out, quality=86, method=6)
print(out, W, H)
