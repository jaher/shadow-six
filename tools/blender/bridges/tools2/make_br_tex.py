"""Bridges rework-2 procedural textures (own work, CC0): snow_soft (matte wind-packed snow, no veining),
water_flow (flow-aligned streaked white water for spillway nappes, v = flow direction), concrete_aggregate
(fractured mass concrete: cement matrix + exposed river-gravel aggregate).  Usage: python3 make_br_tex.py [ids]"""
import sys, os
import numpy as np
sys.path.insert(0, '<claude-tmp>')
import mtex_util as U
from mtex_util import fbm, blur, normal_from_height, arm_map, N
U_SRC = 'procedural (art/bridges/tools2/make_br_tex.py, own work)'


def reg(mid, label, d, n, a, tile, rough, grime=0.0):
    e = U.register(mid, label, d, n, a, tile, rough, grime=grime)
    import json
    p = os.path.join(U.LIB, 'materials.json'); MJ = json.load(open(p))
    MJ['materials'][mid]['source']['source'] = U_SRC
    json.dump(MJ, open(p + '.tmp_br', 'w'), indent=1); os.replace(p + '.tmp_br', p)


def snow_soft():
    low = fbm(N, 4, 3, 71)                 # wind-packed undulation
    mid = fbm(N, 4, 16, 72)
    grain = fbm(N, 2, 400, 73)
    h = low * 0.7 + mid * 0.25 + grain * 0.05
    shade = 0.93 + 0.05 * (mid - 0.5) + 0.04 * (grain - 0.5)
    col = np.stack([shade * 0.93, shade * 0.95, shade * 0.99], -1)
    nor = normal_from_height(blur(h, 2.0), 0.8)
    ao = np.clip(0.9 + 0.1 * mid, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, np.full_like(ao, 0.88))


def water_flow():
    s1 = fbm(N, 5, 12, 81, aniso=(1, 10))   # long streaks down the rows (v = flow)
    s2 = fbm(N, 4, 40, 82, aniso=(1, 6))
    foam = fbm(N, 5, 6, 83, aniso=(1, 3))
    w = np.clip((s1 * 0.6 + s2 * 0.4 - 0.35) * 1.8, 0, 1) * (0.5 + 0.7 * foam)
    w = np.clip(w, 0, 1)
    deep = np.array([0.16, 0.24, 0.24]); white = np.array([0.86, 0.9, 0.9])
    col = deep[None, None] * (1 - w[..., None]) + white[None, None] * w[..., None]
    nor = normal_from_height(blur(s1 * 0.7 + s2 * 0.3, 1.0), 1.4)
    return np.clip(col, 0, 1), nor, arm_map(np.ones_like(w), np.clip(0.15 + 0.5 * w, 0, 1))


def concrete_aggregate():
    cem = fbm(N, 6, 8, 91)
    peb = fbm(N, 3, 70, 92)
    peb2 = fbm(N, 3, 150, 93)
    tone = fbm(N, 3, 60, 94)
    m1 = np.clip((peb - 0.58) * 9, 0, 1)
    m2 = np.clip((peb2 - 0.62) * 9, 0, 1) * (1 - m1)
    base = np.array([0.52, 0.51, 0.48]) * (0.85 + 0.3 * cem[..., None])
    pc = np.stack([0.35 + 0.35 * tone, 0.33 + 0.3 * tone, 0.29 + 0.26 * tone], -1)
    col = base * (1 - m1[..., None]) + pc * m1[..., None]
    col = col * (1 - m2[..., None]) + (pc * 0.8 + 0.1) * m2[..., None]
    pits = np.clip((fbm(N, 2, 200, 95) - 0.8) * 6, 0, 1)
    col = col * (1 - 0.45 * pits[..., None])
    h = m1 * 0.8 + m2 * 0.4 + cem * 0.3 - pits * 0.5
    nor = normal_from_height(blur(h, 0.8), 2.2)
    ao = np.clip(1 - pits * 0.5 - (1 - m1) * 0.08, 0, 1)
    return np.clip(col, 0, 1), nor, arm_map(ao, np.full_like(ao, 0.9))


GEN = {'snow_soft': (snow_soft, 'Matte wind-packed snow (no veining)', 3.0, 0.88, 0.0),
       'water_flow': (water_flow, 'Spillway white water, streaks along v (flow)', 4.0, 0.2, 0.0),
       'concrete_aggregate': (concrete_aggregate, 'Fractured mass concrete, exposed gravel aggregate', 1.2, 0.9, 0.3)}
if __name__ == '__main__':
    for mid in (sys.argv[1:] or GEN):
        f, label, tile, rough, grime = GEN[mid]
        d, n, a = f()
        reg(mid, label, d, n, a, tile, rough, grime)
