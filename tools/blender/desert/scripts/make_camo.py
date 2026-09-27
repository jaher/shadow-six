"""canvas_camo: army tent duck with a painted disruptive pattern (sand base, brown + olive-drab blotches, 4 m repeat).
Derived from the CC0 Poly Haven rough_linen scans already in kit/src/raw/canvas (3x3 tiled) + own-work pattern."""
import os, json
import numpy as np
from PIL import Image, ImageFilter
KIT = '<claude-tmp>'
S, D = KIT + '/src/raw/canvas', KIT + '/src/raw/canvas_camo'
os.makedirs(D, exist_ok=True)
N = 2048
def tile3(p, mode):
    im = Image.open(p).convert(mode).resize((N // 3 + 1, N // 3 + 1), Image.LANCZOS)
    out = Image.new(mode, (N, N))
    for i in range(3):
        for j in range(3):
            out.paste(im, (i * (N // 3), j * (N // 3)))
    return out
rng = np.random.default_rng(7)
def field(scale, seed):
    r = np.random.default_rng(seed).random((N // scale, N // scale)).astype(np.float32)
    im = Image.fromarray((r * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC).filter(ImageFilter.GaussianBlur(scale * 0.6))
    a = np.asarray(im).astype(np.float32) / 255.0
    # seamless: blend with rolled copy
    return a
def seamless(a):
    h = N // 2
    w = np.abs(np.linspace(-1, 1, N))[None, :]
    b = np.roll(a, h, 1)
    a = a * (1 - w) + b * w
    w2 = np.abs(np.linspace(-1, 1, N))[:, None]
    return a * (1 - w2) + np.roll(a, h, 0) * w2
f1 = seamless(field(64, 1) * 0.7 + field(16, 2) * 0.3)
f2 = seamless(field(48, 3) * 0.7 + field(12, 4) * 0.3)
def norm(a):
    return (a - a.mean()) / a.std()
m1 = np.clip((norm(f1) - 0.55) * 6, 0, 1)            # brown blotches
m2 = np.clip((norm(f2) - 0.75) * 6, 0, 1) * (1 - m1)  # olive blotches
base = np.asarray(tile3(S + '/diff.jpg', 'RGB')).astype(np.float32) / 255.0
L = base.mean(-1, keepdims=True)
L = L / L.mean()
sand, brown, olive = np.array([0.64, 0.555, 0.41]), np.array([0.50, 0.41, 0.29]), np.array([0.47, 0.45, 0.33])
col = sand[None, None] * (1 - m1 - m2)[..., None] + brown[None, None] * m1[..., None] + olive[None, None] * m2[..., None]
out = np.clip(col * (0.75 + 0.25 * L), 0, 1)
Image.fromarray((out * 255).astype(np.uint8)).save(D + '/diff.jpg', quality=92)
for k in ('nor', 'rough', 'ao'):
    if os.path.exists(S + '/%s.jpg' % k):
        tile3(S + '/%s.jpg' % k, 'RGB' if k == 'nor' else 'L').save(D + '/%s.jpg' % k, quality=92)
cfgp, credp = KIT + '/src/lib_config.json', KIT + '/src/credits_raw.json'
cfg = json.load(open(cfgp))
cfg['canvas_camo'] = {'label': 'Tent duck with painted disruptive camouflage (sand/brown/olive, 4 m repeat)', 'tile_m': 4.0,
                      'col': 0.0, 'lum': 1.0, 'rough': 0.92, 'grime': 0.8}
json.dump(cfg, open(cfgp, 'w'), indent=1)
cred = json.load(open(credp))
c = dict(cred['canvas']); c['name'] = (c.get('name') or '') + ' + own-work camouflage pattern (CC0)'; c['dimensions_mm'] = [4000, 4000]
cred['canvas_camo'] = c
json.dump(cred, open(credp, 'w'), indent=1)
print('camo ok', out.mean((0, 1)))
