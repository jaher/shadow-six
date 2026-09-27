"""Shared helpers for the military procedural textures (own work, CC0; derived from CC0 Poly Haven bases in lib/)."""
import json, os
import numpy as np
from PIL import Image, ImageFilter

KIT = '<claude-tmp>'
LIB = os.path.join(KIT, 'lib')
N = 2048


def load(mid, kind='diff', n=N):
    im = Image.open(os.path.join(LIB, '2k', '%s_%s.jpg' % (mid, kind))).convert('RGB')
    if im.size[0] != n:
        im = im.resize((n, n), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


def fbm(n=N, octaves=6, base=4, seed=0, gain=0.55, aniso=(1, 1)):
    """Tileable value-noise fBm in [0,1]. aniso=(ax, ay) stretches features (ax>1 -> streaks along x)."""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = base * 2 ** o
        sx, sy = max(1, s // aniso[0]), max(1, s // aniso[1])
        g = r.random((sy, sx)).astype(np.float32)
        g = np.concatenate([g, g[:1]], 0)
        g = np.concatenate([g, g[:, :1]], 1)
        im = Image.fromarray(g, 'F').resize((n + n // sx, n + n // sy), Image.BICUBIC)
        out += amp * np.asarray(im, np.float32)[:n, :n]
        tot += amp
        amp *= gain
    out /= tot
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / (hi - lo + 1e-6), 0, 1)


def blur(a, px):
    """Wrap-around gaussian blur via FFT (keeps tiling)."""
    if a.ndim == 3:
        return np.stack([blur(a[..., c], px) for c in range(a.shape[2])], -1)
    n0, n1 = a.shape
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    g = np.exp(-2 * (np.pi * px) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def normal_from_height(h, strength=2.0):
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    k = strength * h.shape[0] / 64
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L * 0.5 + 0.5, ny / L * 0.5 + 0.5, nz / L * 0.5 + 0.5], -1)


def blend_normals(a, b):
    """Whiteout blend of two tangent-space normal maps in [0,1] encoding."""
    a = a * 2 - 1
    b = b * 2 - 1
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
    return n * 0.5 + 0.5


def save(arr, name, q=88):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    out = {}
    for sz, res in ((1024, '1k'), (2048, '2k')):
        x = im.resize((sz, sz), Image.LANCZOS) if im.size[0] != sz else im
        x.save(os.path.join(LIB, res, name + '.jpg'), quality=q)
        x.save(os.path.join(LIB, res, name + '.webp'), quality=q - 4, method=5)
        out[res] = res + '/' + name
    return out


def register(mid, label, diff, nor, arm, tile, rough, metal=0.0, grime=1.0, grain='u', base=None, extra=None):
    """Write the three maps and merge the entry into lib/materials.json (re-read right before writing: other
    workflows share the file; entries are only ever added/replaced by id)."""
    maps = {'diff': save(diff, mid + '_diff'), 'nor': save(nor, mid + '_nor', 92), 'arm': save(arm, mid + '_arm')}
    src = {'source': 'procedural (art/military/tools/make_mil_tex.py, own work)', 'license': 'CC0-1.0'}
    if base:
        src['derived_from'] = base
    e = {'label': label, 'tile_m': tile, 'grain': grain, 'rot90': False, 'roughness': rough, 'metallic': metal,
         'grime': grime, 'mean': [round(float(x), 4) for x in diff.reshape(-1, 3).mean(0)], 'normalScale': 1.0,
         'maps': maps, 'source': src, 'texel_density_px_per_m': {'1k': round(1024 / tile), '2k': round(2048 / tile)}}
    if extra:
        e.update(extra)
    p = os.path.join(LIB, 'materials.json')
    MJ = json.load(open(p))
    MJ['materials'][mid] = e
    tmp = p + '.tmp_mil'
    json.dump(MJ, open(tmp, 'w'), indent=1)
    os.replace(tmp, p)
    print('registered', mid, e['mean'], 'tile', tile)
    return e


def arm_map(ao, rough, metal=0.0):
    return np.stack([ao, rough, np.full_like(ao, metal)], -1)
