#!/usr/bin/env python3
"""
Texture-repetition metric for tileshot frames (tools/perf/tileshot.mjs).

  python3 tools/perf/tilemetric.py <frames.json> <view> <x0,z0,x1,z1> <period_m> [--angle=deg] [--slab=n]

The luminance inside the world rectangle (projected through the frame's per-metre screen vectors) is high-passed
(minus a ~1.5 m box blur: lighting and macro tint are not repetition), then correlated with itself shifted by whole
texture periods T along the pattern's two axes (R_T). The baseline R_B is the same correlation at lags that are not
texture periods: 0.75 T and 1.25 T (with --slab=n those are whole slabs, so a regular joint grid, which real paving
has, counts in the baseline too). excess = max(R_T) - max(R_B): ~0 for a pattern that does not repeat at T.
"""
import json, math, sys
import numpy as np
from PIL import Image


def box_blur(a, r):
    if r < 1:
        return a
    k = 2 * r + 1
    c = np.cumsum(np.pad(a, ((r + 1, r), (0, 0)), mode='edge'), axis=0)
    a = (c[k:] - c[:-k]) / k
    c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r)), mode='edge'), axis=1)
    return (c[:, k:] - c[:, :-k]) / k


def corr_at(I, M, d):
    dx, dy = int(round(d[0])), int(round(d[1]))
    H, W = I.shape
    ys, ye = max(0, -dy), min(H, H - dy)
    xs, xe = max(0, -dx), min(W, W - dx)
    if ye - ys < 8 or xe - xs < 8:
        return float('nan')
    a = I[ys:ye, xs:xe]; b = I[ys + dy:ye + dy, xs + dx:xe + dx]
    m = M[ys:ye, xs:xe] & M[ys + dy:ye + dy, xs + dx:xe + dx]
    if m.sum() < 500:
        return float('nan')
    a = a[m]; b = b[m]
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / math.sqrt((a * a).sum() * (b * b).sum() + 1e-9))


def measure(img_path, px, rect, T, angle=0.0, slab=0):
    im = np.asarray(Image.open(img_path).convert('RGB')).astype(np.float64) / 255.0
    L = im @ np.array([0.2126, 0.7152, 0.0722])
    c = np.array(px['c']); vx = np.array(px['x']); vz = np.array(px['z'])
    H, W = L.shape
    # pixel → world (inverse of the 2x2 projection around the view centre)
    A = np.stack([vx, vz], axis=1)
    Ai = np.linalg.inv(A)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.stack([xx - c[0], yy - c[1]], axis=-1) @ Ai.T
    wx, wz = d[..., 0] + px['wx'], d[..., 1] + px['wz']
    x0, z0, x1, z1 = rect
    M = (wx > x0) & (wx < x1) & (wz > z0) & (wz < z1)
    ppm = math.sqrt(abs(np.linalg.det(A)))  # pixels per metre (geometric mean)
    hp = L - box_blur(L, max(1, int(ppm * 0.75)))
    ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    axes = [ca * vx + sa * vz, -sa * vx + ca * vz]   # screen px per metre along the pattern's u and v
    base = [0.75, 1.25] if not slab else [(slab - 1) / slab, (slab + 1) / slab]
    RT, RB = [], []
    for ax in axes:
        RT.append(max(corr_at(hp, M, ax * T * n) for n in (1, 2)))
        RB.append(max(corr_at(hp, M, ax * T * f) for f in base))
    RT = [r for r in RT if r == r]; RB = [r for r in RB if r == r]
    return {'R_T': round(max(RT), 3), 'R_B': round(max(RB), 3), 'excess': round(max(RT) - max(RB), 3), 'px': int(M.sum()), 'ppm': round(ppm, 1)}


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
    meta = json.load(open(args[0]))
    v = meta['views'][int(args[1])]
    px = dict(v['px']); px['wx'] = v['x']; px['wz'] = v['z']
    rect = [float(t) for t in args[2].split(',')]
    print(json.dumps(measure(v['file'], px, rect, float(args[3]), float(opt.get('angle', 0)), int(opt.get('slab', 0)))))
