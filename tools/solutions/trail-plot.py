#!/usr/bin/env python3
"""
Top-down trail plot of a recorded solution run (tools/solutions/trail.mjs --out trail.json): the map drawn from the
run's own nav grid (terrain, water, walls and buildings, raised floors) with every commando's trail on foot as a line,
one colour per man. Two or more trails side by side (before / after); --crop x0,z0,x1,z1 for a stretch in detail.

  python3 tools/solutions/trail-plot.py before.json after.json --labels before,after --out plot.png [--crop 70,0,148,70]
    [--from s --to s] [--ppm 6]
"""
import argparse, base64, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

COLORS = {'greenberet': (46, 160, 67), 'diver': (31, 111, 235), 'sapper': (230, 120, 20), 'spy': (200, 40, 160),
          'sniper': (150, 90, 30), 'driver': (110, 110, 110), 'thief': (0, 160, 170), 'guest': (90, 60, 180)}
FALLBACK = [(220, 50, 50), (60, 60, 200), (20, 150, 150), (160, 140, 20)]


def dec(s, dt):
    return np.frombuffer(base64.b64decode(s), dtype=dt)


def load(path):
    r = json.load(open(path))
    n, L = r['n'], r['len']
    t = dec(r['t'], np.float32)
    x = dec(r['x'], np.float32).reshape(L, n)
    z = dec(r['z'], np.float32).reshape(L, n)
    f = dec(r['f'], np.uint8).reshape(L, n)
    g = r['grid']
    G = {k: dec(g[k], np.uint8).reshape(g['rows'], g['cols']) for k in ('terrain', 'block', 'bridge')}
    G['navBlock'] = dec(g['navBlock'], np.uint8).reshape(g['rows'], g['cols']) if g.get('navBlock') else np.zeros_like(G['block'])
    G['elev'] = dec(g['elev'], np.float32).reshape(g['rows'], g['cols'])
    G['cell'] = g['cell']
    return r, t, x, z, f, G


def map_image(G, ppm, crop):
    rows, cols = G['block'].shape
    img = np.zeros((rows, cols, 3), np.float32)
    img[:] = (236, 236, 230)  # ground / snow
    terr = G['terrain']
    img[terr == 1] = (205, 200, 190)  # road
    img[terr == 4] = (214, 226, 200)  # grass
    img[terr == 2] = (232, 220, 186)  # sand
    img[terr == 7] = (200, 190, 170)  # mud
    img[terr == 6] = (170, 205, 230)  # shallow
    img[terr == 5] = (110, 160, 210)  # water
    e = G['elev']
    raised = e > 0.05
    shade = np.clip(1.0 - e / 14.0, 0.55, 1.0)[..., None]
    img[raised] = (img[raised] * 0.75 + np.array([180, 175, 165]) * 0.25) * shade[raised]
    img[G['bridge'] == 1] = (180, 160, 130)
    img[G['navBlock'] == 1] = (175, 175, 170)
    blk = G['block']
    img[blk == 3] = (150, 110, 70)  # fence
    img[blk == 1] = (130, 130, 125)  # low
    img[blk == 2] = (70, 70, 72)  # high
    im = Image.fromarray(img.clip(0, 255).astype(np.uint8), 'RGB')
    c = G['cell']
    x0, z0, x1, z1 = crop if crop else (0, 0, cols * c, rows * c)
    im = im.crop((int(x0 / c), int(z0 / c), int(math.ceil(x1 / c)), int(math.ceil(z1 / c))))
    W, H = int((x1 - x0) * ppm), int((z1 - z0) * ppm)
    return im.resize((W, H), Image.NEAREST), (x0, z0)


def draw_trails(im, origin, roles, t, x, z, f, ppm, t0, t1, ss=3):
    x0, z0 = origin
    big = im.resize((im.width * ss, im.height * ss), Image.NEAREST)
    d = ImageDraw.Draw(big)
    for u, role in enumerate(roles):
        col = COLORS.get(role, FALLBACK[u % len(FALLBACK)])
        pts = []

        def flush():
            if len(pts) > 1:
                d.line(pts, fill=col, width=max(2, int(1.6 * ss)), joint='curve')
            pts.clear()
        last = None
        for k in range(0, len(t)):
            if t[k] < t0 or t[k] > t1 or (f[k, u] & 2) or (f[k, u] & 128):
                flush(); last = None
                continue
            px, pz = float(x[k, u]), float(z[k, u])
            if last is not None and math.hypot(px - last[0], pz - last[1]) > 0.75:
                flush()
            if last is None or math.hypot(px - last[0], pz - last[1]) > 0.04:
                pts.append(((px - x0) * ppm * ss, (pz - z0) * ppm * ss))
                last = (px, pz)
        flush()
    return big.resize(im.size, Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('trails', nargs='+')
    ap.add_argument('--labels', default='', help='panel titles, comma-separated (no commas inside a title)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--ppm', type=float, default=6)
    ap.add_argument('--crop', default='')
    ap.add_argument('--from', dest='t0', type=float, default=-1e9)
    ap.add_argument('--to', dest='t1', type=float, default=1e9)
    ap.add_argument('--notes', default='', help='one caption line per trail, separated by |')
    a = ap.parse_args()
    crop = tuple(float(v) for v in a.crop.split(',')) if a.crop else None
    labels = a.labels.split(',') if a.labels else [p.split('/')[-1] for p in a.trails]
    notes = a.notes.split('|') if a.notes else [''] * len(a.trails)
    panels = []
    roles = None
    for p in a.trails:
        r, t, x, z, f, G = load(p)
        roles = r['roles']
        im, origin = map_image(G, a.ppm, crop)
        panels.append(draw_trails(im, origin, roles, t, x, z, f, a.ppm, a.t0, a.t1))
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
        small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
    except OSError:
        font = small = ImageFont.load_default()
    pad, head = 12, 64
    W = sum(p.width for p in panels) + pad * (len(panels) + 1)
    H = max(p.height for p in panels) + head + 40
    out = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(out)
    xx = pad
    for p, lab, note in zip(panels, labels, notes):
        out.paste(p, (xx, head))
        d.text((xx, 8), lab, fill=(20, 20, 20), font=font)
        d.text((xx, 36), note, fill=(60, 60, 60), font=small)
        xx += p.width + pad
    lx = pad
    for role in roles:
        col = COLORS.get(role, (0, 0, 0))
        d.rectangle((lx, H - 28, lx + 22, H - 16), fill=col)
        d.text((lx + 28, H - 32), role, fill=(30, 30, 30), font=small)
        lx += 150
    out.save(a.out, quality=88)
    print(a.out, out.size)


if __name__ == '__main__':
    main()
