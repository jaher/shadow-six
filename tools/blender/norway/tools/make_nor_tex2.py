"""Norway rework 2 textures (own work, CC0): tar_paper_batten (Leistendach felt: rolls run ridge->eave between
battens, so NO horizontal laps; fine grit, rain streaks down-slope, small patches) and a reworked
roof_pantile_black (irregular per-tile wave, warmer glaze, stronger course shadows).
Usage: python3 make_nor_tex2.py [tar_paper_batten] [roof_pantile_black]"""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_nor_tex as T
from make_nor_tex import fbm, blur, normal_from_height, arm_map, N, register, xx, yy


def tar_paper_batten():
    grit = fbm(N, 3, 256, 71)
    streak = fbm(N, 6, 6, 72, aniso=(1, 14))            # down-slope rain streaks (along v)
    tone = fbm(N, 4, 3, 73)
    r = np.random.default_rng(74)
    patch = np.zeros((N, N), np.float32)
    edge = np.zeros((N, N), np.float32)
    for _ in range(7):                                    # small felt patches, stuck on
        cx, cy, w, hh = r.uniform(0, 1), r.uniform(0, 1), r.uniform(0.02, 0.05), r.uniform(0.02, 0.06)
        dx = np.abs(((xx - cx + 0.5) % 1) - 0.5)
        dy = np.abs(((yy - cy + 0.5) % 1) - 0.5)
        patch = np.maximum(patch, ((dx < w) & (dy < hh)).astype(np.float32))
        e = ((np.abs(dx - w) < 0.0015) & (dy < hh + 0.0015)) | ((np.abs(dy - hh) < 0.0015) & (dx < w + 0.0015))
        edge = np.maximum(edge, e.astype(np.float32))
    # staggered end laps: short horizontal overlaps only within one roll width (0.9 m of 3.6 m tile = 1/4)
    lane = np.floor(xx * 4).astype(int)
    endlap = np.zeros((N, N), np.float32)
    for k in range(4):
        y0 = r.uniform(0, 1)
        fy = ((yy - y0) % 1.0)
        endlap += (lane == k) * np.exp(-(fy * 220) ** 2)
    luma = 0.12 + 0.035 * grit + 0.03 * (tone - 0.5) + 0.05 * (streak - 0.5) + patch * 0.018 - endlap * 0.02 + edge * 0.03
    col = np.stack([luma * 1.0, luma * 0.985, luma * 0.96], -1)
    h = grit * 0.3 + patch * 0.5 + edge * 0.5 + endlap * 0.6 + streak * 0.1
    nor = normal_from_height(blur(h, 0.8), 1.2)
    rough = np.clip(0.8 + 0.1 * grit - 0.08 * streak, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(np.ones_like(h), rough)


def pantile():
    nc, nt = 6, 10                                       # courses (0.33 m) x tiles (0.2 m) per 2 m repeat
    ci = np.floor(yy * nc).astype(int)
    fy = (yy * nc) % 1.0
    r = np.random.default_rng(81)
    shift = r.uniform(-0.06, 0.06, (nc, nt))            # tiles laid slightly out of line
    xs = xx * nt
    ti = np.floor(xs).astype(int)
    xs = xs + shift[ci % nc, ti % nt]
    ti = np.floor(xs).astype(int)
    fx = xs % 1.0
    amp = r.uniform(0.75, 1.15, (nc, nt))[ci % nc, ti % nt]
    skew = r.uniform(0.15, 0.4, (nc, nt))[ci % nc, ti % nt]
    wave = amp * (0.6 * np.sin(2 * np.pi * fx) + skew * np.sin(4 * np.pi * fx + 0.6))
    tone = r.normal(0, 0.16, (nc, nt))[ci % nc, ti % nt]
    tilt = r.uniform(-0.25, 0.25, (nc, nt))[ci % nc, ti % nt]
    h = wave * 0.8 + fy * (0.9 + tilt * (fx - 0.5)) + tone * 0.3
    butt = np.exp(-((1 - fy) * 26) ** 2)
    shadow = np.exp(-(fy * 7) ** 1.4)
    h = h - shadow * 1.0
    crest = np.clip(wave, 0, 1)
    lich = (fbm(N, 5, 14, 82) > 0.86).astype(np.float32) * fbm(N, 4, 24, 83)
    lich = blur(lich, 1.5)
    dirt = fbm(N, 5, 3, 84)
    streak = fbm(N, 5, 5, 85, aniso=(1, 10))
    base = np.array([0.085, 0.074, 0.066])               # warm brown-black glaze, not blue
    col = base[None, None, :] * (1 + tone[..., None] * 0.8 + crest[..., None] * 0.7 + butt[..., None] * 0.6
                                 - shadow[..., None] * 0.7)
    col = col * (0.8 + 0.3 * dirt[..., None] + 0.15 * streak[..., None])
    col = col * (1 - lich[..., None] * 0.6) + np.array([0.45, 0.43, 0.33])[None, None] * lich[..., None] * 0.6
    nor = normal_from_height(blur(h, 1.2), 1.6)
    ao = np.clip(1 - shadow * 0.7, 0, 1)
    rough = np.clip(0.42 + 0.18 * dirt + lich * 0.4 - crest * 0.1, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, rough)


if __name__ == '__main__':
    ids = sys.argv[1:] or ['tar_paper_batten', 'roof_pantile_black']
    if 'tar_paper_batten' in ids:
        register('tar_paper_batten', 'Batten-roll tar paper (Leistendach; rolls run eave-ridge, streaks, patches)',
                 *tar_paper_batten(), 3.6, 0.85, grime=0.4)
    if 'roof_pantile_black' in ids:
        register('roof_pantile_black', 'Black glazed S-pantile roof (0.2 x 0.33 m), irregular laying',
                 *pantile(), 2.0, 0.45, grime=0.3)


def weatherboard_paint():
    """Painted horizontal lap siding (0.18 m boards): deep shadow line under every lap, bulged board face, paint
    wear along the lap edges showing grey wood, faint grain. Pale base, tinted per asset. Rows along v."""
    nb = 10                                               # 1.8 m tile
    fy = (yy * nb) % 1.0
    bi = np.floor(yy * nb).astype(int)
    r = np.random.default_rng(91)
    tone = r.normal(0, 0.035, nb)[bi % nb]
    grain = fbm(N, 5, 5, 92, aniso=(30, 1))
    gap = np.exp(-(fy / 0.045) ** 2) + np.exp(-((1 - fy) / 0.02) ** 2)      # shadow line at the lap
    face = np.sin(np.clip(fy, 0, 1) * np.pi * 0.5)                           # board thickens toward the lap edge
    wear = (fbm(N, 6, 10, 93, aniso=(6, 1)) > 0.8).astype(np.float32) * np.clip(1 - fy / 0.35, 0, 1)
    wear = blur(wear, 1.0)
    dirt = fbm(N, 5, 3, 94)
    luma = 0.8 + tone + 0.05 * (grain - 0.5) - 0.42 * np.clip(gap, 0, 1) + 0.05 * face - 0.06 * (dirt - 0.5)
    col = np.stack([luma, luma * 0.995, luma * 0.97], -1)
    wood = np.stack([0.4 + 0.1 * grain, 0.37 + 0.08 * grain, 0.33 + 0.06 * grain], -1)
    col = col * (1 - wear[..., None] * 0.6) + wood * wear[..., None] * 0.6
    h = face * 1.6 - gap * 1.2 + grain * 0.15
    nor = normal_from_height(blur(h, 0.9), 2.2)
    ao = np.clip(1 - np.clip(gap, 0, 1) * 0.6, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, np.clip(0.62 + wear * 0.2, 0, 1))


def boards_weathered():
    """Bare/tarred vertical boards (0.2 m) for naust and sheds: every plank a different age (silver grey -> brown),
    dark gaps, nail pairs, knots, tar staining creeping up from the ground and running down from the roof edge."""
    nb = 12                                               # 2.4 m tile
    fx = (xx * nb) % 1.0
    bi = np.floor(xx * nb).astype(int)
    r = np.random.default_rng(101)
    age = r.uniform(0, 1, nb)[bi % nb]
    tint = r.normal(0, 0.05, nb)[bi % nb]
    grain = fbm(N, 6, 4, 102, aniso=(1, 36))
    fine = fbm(N, 3, 48, 103, aniso=(1, 20))
    gap = np.exp(-(fx / 0.03) ** 2) + np.exp(-((1 - fx) / 0.03) ** 2)
    cup = np.sin(np.clip(fx, 0, 1) * np.pi)
    tarred = (r.uniform(0, 1, nb) < 0.3) * r.uniform(0.45, 0.8, nb)          # some planks re-tarred
    tar = tarred[bi % nb] * (0.75 + 0.25 * fbm(N, 5, 6, 104, aniso=(1, 4)))
    drip = (fbm(N, 5, 8, 105, aniso=(1, 12)) > 0.8).astype(np.float32)
    tar = np.clip(tar + blur(drip, 1.2) * 0.6, 0, 1)
    grey = np.array([0.5, 0.49, 0.46]); brown = np.array([0.36, 0.28, 0.2]); black = np.array([0.08, 0.065, 0.05])
    base = grey[None, None] * age[..., None] + brown[None, None] * (1 - age[..., None])
    base = base * (0.85 + 0.3 * grain[..., None] + 0.1 * fine[..., None]) * (1 + tint[..., None])
    col = base * (1 - tar[..., None] * 0.85) + black[None, None] * tar[..., None] * 0.85
    col = col * (1 - 0.6 * np.clip(gap, 0, 1)[..., None])
    h = cup * 0.6 + grain * 0.4 + fine * 0.2 - gap * 1.5
    nor = normal_from_height(blur(h, 0.8), 2.0)
    ao = np.clip(1 - np.clip(gap, 0, 1) * 0.6, 0, 1)
    rough = np.clip(0.85 - tar * 0.3, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, rough)


if __name__ == '__main__':
    if 'weatherboard_paint' in sys.argv[1:]:
        register('weatherboard_paint', 'Painted horizontal lap siding, 0.18 m boards (tint per asset)',
                 *weatherboard_paint(), 1.8, 0.62, grime=0.8)
    if 'boards_weathered' in sys.argv[1:]:
        register('boards_weathered', 'Weathered vertical boards 0.2 m, per-plank ageing + tar staining',
                 *boards_weathered(), 2.4, 0.85, grime=0.8, grain='v')


def paint_metal():
    """Smooth enamel-painted sheet metal, pale base for tinting (cable-car bodies): orange-peel, faint run-off
    streaks, small chips showing dark primer, very light grime."""
    peel = fbm(N, 3, 160, 111)
    streak = fbm(N, 5, 6, 112, aniso=(1, 14))
    tone = fbm(N, 4, 3, 113)
    chips = (fbm(N, 5, 40, 114) > 0.965).astype(np.float32)
    chips = blur(chips, 0.6)
    luma = 0.8 + 0.02 * (peel - 0.5) + 0.04 * (tone - 0.5) - 0.05 * np.clip(streak - 0.6, 0, 1)
    col = np.stack([luma, luma * 0.995, luma * 0.985], -1)
    col = col * (1 - chips[..., None] * 0.5) + np.array([0.3, 0.28, 0.26])[None, None] * chips[..., None] * 0.5
    h = peel * 0.15 - chips * 0.4
    nor = normal_from_height(blur(h, 0.8), 0.8)
    rough = np.clip(0.42 + 0.1 * tone + chips * 0.3, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(np.ones_like(h), rough)


if __name__ == '__main__' and 'paint_metal' in sys.argv[1:]:
    register('paint_metal', 'Smooth enamel-painted sheet metal (pale, tint per asset)', *paint_metal(), 2.0, 0.45, grime=0.4)
