"""Military procedural textures part 2 (own work, CC0): steel_grating, tent_canvas, corrugated_galv, timber_creosote.
Usage: python3 make_mil_tex2.py [ids...]"""
import sys
import numpy as np
from mtex_util import *


def steel_grating(seed=21, tile=0.6):
    """Pressure-locked floor grating: bearing bars every 30 mm (along x), cross bars every 100 mm, dark voids."""
    n = N
    yy, xx = np.mgrid[0:n, 0:n] / n * tile
    pb, pc = 0.03, 0.1
    db = np.abs(((yy / pb) % 1) - 0.5) * pb          # distance to bearing-bar centre line (m)
    dc = np.abs(((xx / pc) % 1) - 0.5) * pc
    bar = np.clip((0.0035 - (pb / 2 - db)) / 0.001, 0, 1)            # 1 on the bar (5 mm thick)
    bar = (pb / 2 - db) < 0.003
    cross = (pc / 2 - dc) < 0.0025
    solid = (bar | cross).astype(np.float32)
    rust = np.clip(fbm(n, 5, 6, seed) * 2 - 1.0, 0, 1)
    metal = np.array([0.42, 0.43, 0.42]) * (1 - rust[..., None] * 0.4) + rust[..., None] * 0.4 * np.array([0.38, 0.22, 0.12])
    wear = fbm(n, 4, 16, seed + 1)[..., None] * 0.15
    void = np.array([0.08, 0.075, 0.065])
    col = metal * (0.9 + wear) * solid[..., None] + void * (1 - solid[..., None])
    h = blur(solid, 1.5)
    nor = normal_from_height(h, 3.0)
    ao = np.clip(0.35 + solid * 0.65, 0, 1)
    return col, nor, arm_map(ao, np.clip(0.55 + rust * 0.3, 0, 1), 0.6)


def tent_canvas(seed=22, tile=4.0):
    """Heavy cotton duck: sewn panels 1 m wide (vertical seams = constant u), stitched patches, weathering blotches,
    faint weave. Neutral khaki; tinted per theatre via mat_tint."""
    n = N
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    ppm = n / tile
    weave = (np.sin(xx * np.pi / 2.0) * np.sin(yy * np.pi / 2.0)) * 0.03
    blot = fbm(n, 6, 4, seed)
    streak = fbm(n, 5, 6, seed + 1, aniso=(1, 10))
    base = np.array([0.60, 0.55, 0.42], np.float32)
    luma = 1 + (blot - 0.5) * 0.18 - np.clip(streak * 1.8 - 1.0, 0, 1) * 0.18 + weave
    h = weave * 2 + (blot - 0.5) * 0.3
    for k in range(4):                                   # seams: double-stitched lap, 30 mm, darker edge line
        x0 = (k + 0.5) * ppm
        d = xx - x0
        lap = (np.abs(d) < 0.015 * ppm)
        edge = np.exp(-((d - 0.015 * ppm) / 2.0) ** 2)
        stitch = (np.abs(np.abs(d) - 0.008 * ppm) < 1.2) & ((yy // 6) % 2 == 0)
        luma = luma - edge * 0.18 - stitch * 0.08 + lap * 0.03
        h = h + lap * 0.6 - edge * 0.4
    col = base * luma[..., None]
    for k in range(7):                                   # patches (repairs), some lighter newer cloth, some darker
        w, hh = r.uniform(0.3, 0.8) * ppm, r.uniform(0.25, 0.6) * ppm
        cx, cy = r.uniform(0, n), r.uniform(0, n)
        dx = np.abs((xx - cx + n / 2) % n - n / 2)
        dy = np.abs((yy - cy + n / 2) % n - n / 2)
        m = (dx < w / 2) & (dy < hh / 2)
        rim = m & ((w / 2 - dx < 4) | (hh / 2 - dy < 4))
        f = r.choice([0.9, 1.06, 0.94, 1.08])
        col[m] *= f
        col[rim] *= 0.86
        h = h + m * 0.3
    mould = np.clip(fbm(n, 5, 10, seed + 3) * 2.4 - 1.6, 0, 1)
    col = col * (1 - mould[..., None] * 0.35) + mould[..., None] * 0.35 * np.array([0.3, 0.3, 0.22])
    nor = normal_from_height(blur(h, 1.0), 1.5)
    ao = np.clip(1 - np.clip(-h, 0, 1) * 0.3, 0, 1)
    return col, nor, arm_map(ao, np.full((n, n), 0.95, np.float32))


def corrugated_galv(seed=23, tile=2.4):
    """Corrugated iron: 76 mm pitch vertical corrugations (constant u), 0.8 m sheets with side laps, end lap with bolt
    row at 1.2 m, galvanised grey with rust patches and rust runs from bolts."""
    n = N
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    ppm = n / tile
    pitch = 0.0762 * ppm * (tile / 0.0762 / round(tile / 0.0762))        # integer corrugations per tile
    ph = xx / pitch * 2 * np.pi
    hgt = np.sin(ph)
    sheet = (xx // (0.8 * ppm)).astype(int)
    lap = np.exp(-(((xx % (0.8 * ppm)) - 2) / 3.0) ** 2)
    endlap_y = [0.0, 0.5]
    rust = np.clip(fbm(n, 6, 5, seed, aniso=(1, 4)) * 2.0 - 1.05, 0, 1)
    runs = np.zeros((n, n), np.float32)
    for y0 in endlap_y:
        yl = y0 * n
        d = yy - yl
        dd = (d + n / 2) % n - n / 2
        line = np.exp(-(dd / 2.5) ** 2)
        hgt = hgt - line * 1.5
        for bx in np.arange(0, n, pitch * 2):                              # bolt on every 2nd crest
            dxx = (xx - bx - pitch * 0.25)
            b = np.exp(-((dxx ** 2 + dd ** 2) / 20.0))
            hgt = hgt + b * 1.5
            if r.random() < 0.3:
                L = r.uniform(0.1, 0.45) * ppm
                runs = np.maximum(runs, np.exp(-(dxx / 4) ** 2) * (dd > 0) * np.clip(1 - dd / L, 0, 1))
    tone = np.array([0.52, 0.53, 0.52])
    shade = 1 + (sheet % 3 - 1) * 0.04
    col = tone * (shade * (1 + hgt * 0.13))[..., None] * (0.92 + fbm(n, 4, 8, seed + 1) * 0.16)[..., None]
    rc = np.array([0.40, 0.23, 0.12])
    k = np.clip(rust * 0.9 + runs * 0.7, 0, 1)[..., None]
    col = col * (1 - k) + rc * k * (0.8 + 0.4 * fbm(n, 4, 24, seed + 2)[..., None])
    col = col * (1 - lap[..., None] * 0.3)
    nor = normal_from_height(hgt * 0.35, 2.5)
    ao = np.clip(0.8 + hgt * 0.2 - lap * 0.3, 0, 1)
    return col, nor, arm_map(ao, np.clip(0.55 + k[..., 0] * 0.35, 0, 1), 0.5)


def timber_creosote(seed=24):
    """Creosoted / weathered structural timber: timber_beam base darkened towards brown-black with streaky variation."""
    b = load('timber_beam')
    l = b.mean(2, keepdims=True)
    detail = (b - b.mean((0, 1))) * 1.6
    k = fbm(N, 5, 4, seed, aniso=(8, 1))[..., None]
    dark = np.array([0.20, 0.15, 0.11]) * (0.85 + k * 0.5)
    col = dark + detail * 0.8
    return col, load('timber_beam', 'nor'), load('timber_beam', 'arm')


def burlap_bag(seed=25):
    """Sandbag burlap: hessian weave re-graded to a light sand-khaki (theatre tints darken it), coarse weave contrast
    kept, soil smears and damp blotches, a faint stitched seam."""
    b = load('hessian')
    l = b.mean(2)
    weave = (l - l.mean()) / (l.std() + 1e-6)
    base = np.array([0.66, 0.6, 0.46], np.float32)
    soil = np.clip(fbm(N, 5, 6, seed) * 2.2 - 1.2, 0, 1)
    damp = np.clip(fbm(N, 4, 3, seed + 1) * 2 - 1.1, 0, 1)
    col = base[None, None] * (1 + weave[..., None] * 0.09) * (1 - damp[..., None] * 0.25)
    col = col * (1 - soil[..., None] * 0.5) + soil[..., None] * 0.5 * np.array([0.36, 0.3, 0.22])
    yy, xx = np.mgrid[0:N, 0:N]
    seam = (np.abs(xx - N * 0.5) < 3) & ((yy // 10) % 2 == 0)
    col[seam] *= 0.8
    return col, load('hessian', 'nor'), arm_map(np.clip(0.9 - soil * 0.2, 0, 1), np.full((N, N), 0.95, np.float32))


if __name__ == '__main__':
    want = sys.argv[1:] or ['steel_grating', 'tent_canvas', 'corrugated_galv', 'timber_creosote']
    if 'steel_grating' in want:
        register('steel_grating', 'Steel floor grating (30 x 100 mm)', *steel_grating(), 0.6, 0.6, 0.6, grime=0.3)
    if 'tent_canvas' in want:
        register('tent_canvas', 'Tent / hangar canvas with seams and patches', *tent_canvas(), 4.0, 0.95, grime=0.6)
    if 'corrugated_galv' in want:
        register('corrugated_galv', 'Galvanised corrugated iron, weathered', *corrugated_galv(), 2.4, 0.6, 0.5, grime=0.6)
    if 'burlap_bag' in want:
        register('burlap_bag', 'Sandbag burlap (light khaki, soiled)', *burlap_bag(), 0.5, 0.95, grime=1.0,
                 base={'source': 'Poly Haven', 'id': 'hessian_230', 'license': 'CC0-1.0'})
    if 'timber_creosote' in want:
        register('timber_creosote', 'Creosoted structural timber', *timber_creosote(), 1.5, 0.8, grime=0.8,
                 base={'source': 'Poly Haven', 'id': 'wood_planks_grey', 'license': 'CC0-1.0'})
