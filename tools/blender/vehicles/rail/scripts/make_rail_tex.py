"""Procedural CC0 coal-lump texture set (own work) -> vehicles/rail/lib/coal_{diff,nor,arm}.jpg (tileable, 1024 px).
Voronoi lumps (2 scales), faceted per-lump planes + domed height, very dark albedo with rare glossy facets."""
import numpy as np
from PIL import Image
import os
N = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib')
rng = np.random.default_rng(52)


def voronoi(cells):
    c = N / cells
    pts = rng.random((cells, cells, 2))
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / c
    gi, gj = np.floor(yy).astype(int), np.floor(xx).astype(int)
    d1 = np.full((N, N), 9.0, np.float32); d2 = d1.copy(); idx = np.zeros((N, N), np.int32)
    vx = np.zeros((N, N), np.float32); vy = vx.copy()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci, cj = gi + di, gj + dj
            p = pts[ci % cells, cj % cells]
            py, px = ci + p[..., 0], cj + p[..., 1]
            dy, dx = yy - py, xx - px
            d = np.sqrt(dx * dx + dy * dy)
            nearer = d < d1
            d2 = np.where(nearer, d1, np.minimum(d2, d))
            vx = np.where(nearer, dx, vx); vy = np.where(nearer, dy, vy)
            idx = np.where(nearer, (ci % cells) * cells + (cj % cells), idx)
            d1 = np.where(nearer, d, d1)
    return d1, d2, idx, vx, vy


def lumps(cells, seedk):
    d1, d2, idx, vx, vy = voronoi(cells)
    r = np.random.default_rng(seedk).random((cells * cells, 4))
    edge = np.clip((d2 - d1) * 3.0, 0, 1)                    # 0 at the crack between lumps
    ax, ay = (r[idx, 0] - 0.5) * 1.6, (r[idx, 1] - 0.5) * 1.6  # faceted tilt of each lump face
    h = np.sqrt(edge) * 0.8 + (ax * vx + ay * vy) * 0.35 + r[idx, 2] * 0.3
    return h, edge, r[idx, 3], r[idx, 2]


h1, e1, g1, t1 = lumps(14, 1)
h2, e2, g2, t2 = lumps(38, 2)
h = h1 * 1.0 + h2 * 0.35
edge = np.minimum(e1, 0.35 + 0.65 * e2)
# albedo: coal black-brown, faint grey dust in the cracks, rare glassy facets slightly brighter
alb = 0.045 + 0.03 * t1 + 0.015 * t2
alb = alb * (0.55 + 0.45 * np.sqrt(edge))
dust = (1 - np.clip(edge * 4, 0, 1)) * 0.035
rgb = np.stack([alb + dust * 1.05, alb + dust, alb * 0.97 + dust * 0.95], -1)
srgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
Image.fromarray((srgb * 255).astype(np.uint8)).save(os.path.join(OUT, 'coal_diff.jpg'), quality=90)
# normal from height (tileable gradient)
s = 6.0
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * s
gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * s
n = np.stack([-gx, gy, np.ones_like(h)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, 'coal_nor.jpg'), quality=92)
# ARM: ao in cracks, roughness 0.55 (bright facets) .. 0.85, no metal
ao = 0.45 + 0.55 * np.sqrt(edge)
rough = np.where(g1 > 0.8, 0.5, 0.82) - 0.1 * (g2 > 0.9)
arm = np.stack([ao, rough, np.zeros_like(h)], -1)
Image.fromarray((np.clip(arm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, 'coal_arm.jpg'), quality=90)
print('mean albedo linear', rgb.reshape(-1, 3).mean(0))
