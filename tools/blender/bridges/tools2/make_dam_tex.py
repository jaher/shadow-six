"""concrete_dam (own work, CC0; derived from the CC0 lib 'concrete_board'): 6.4 m square tile for mass-concrete dam
faces. Four 1.6 m lifts: dark cold-joint line, pale laitance + patchy efflorescence bloom under each joint, faint
formwork panel joints (1.6 m) and per-panel tone, vertical leaching streaks (grime / rust / calcite) hanging from the
lift joints and from weep holes. Blender UV convention: v = (z - z_joint) / 6.4 -> joints at image rows 0,512,1024,1536
(v = 1, .75, .5, .25); 'below' a joint = larger row index. Usage: python3 make_dam_tex.py"""
import sys, os
import numpy as np
sys.path.insert(0, '<claude-tmp>')
import mtex_util as U
from mtex_util import fbm, blur, normal_from_height, blend_normals, N
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LIFT = N // 4


def tile4(a):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'RGB').resize((N // 4, N // 4), Image.LANCZOS)
    s = np.asarray(im, np.float32) / 255
    return np.tile(s, (4, 4, 1))


def make():
    rng = np.random.default_rng(641)
    col = tile4(U.load('concrete_board', 'diff'))
    nor = tile4(U.load('concrete_board', 'nor'))
    arm = tile4(U.load('concrete_board', 'arm'))
    col = col * 0.55 + col.mean((0, 1), keepdims=True) * 0.45          # calm the busy source a little
    rows = np.arange(N)[:, None]
    cols = np.arange(N)[None, :]
    # per-lift / per-panel tone (1.6 x 1.6 m pours), soft edges
    tone = np.ones((N, N), np.float32)
    for i in range(4):
        for j in range(4):
            tone[i * LIFT:(i + 1) * LIFT, j * LIFT:(j + 1) * LIFT] = 0.93 + 0.12 * rng.random()
    tone = blur(tone, 5)
    big = fbm(N, 4, 3, 642)
    col = col * (tone * (0.92 + 0.14 * big))[..., None]
    h = np.zeros((N, N), np.float32)
    # faint vertical formwork panel joints
    for i in range(4):                               # staggered per lift (not a tile grid), faint
        band = ((rows >= i * LIFT) & (rows < (i + 1) * LIFT)).astype(np.float32)
        off = int(rng.integers(0, LIFT))
        for j in range(3):
            x = (off + j * 683) % N
            d = np.minimum(np.abs(cols - x), N - np.abs(cols - x))
            m = np.exp(-(d / 1.4) ** 2) * band
            col = col * (1 - 0.1 * m)[..., None]
            h -= 0.2 * m
    bd = (rows % 64).astype(np.float32)             # horizontal formwork board marks (0.2 m boards)
    bm_ = np.exp(-(np.minimum(bd, 64 - bd) / 1.2) ** 2) * (0.6 + 0.4 * fbm(N, 3, 16, 645))
    btone = np.repeat(rng.uniform(0.96, 1.04, N // 64), 64)[:, None]
    col = col * ((1 - 0.07 * bm_) * btone)[..., None]
    h -= 0.35 * bm_
    patch = fbm(N, 5, 10, 643)
    for i in range(4):
        y = i * LIFT
        d = (rows - y) % N                       # distance below the joint (rows)
        up = (y - rows) % N                      # distance above
        line = np.exp(-(np.minimum(d, up) / 2.2) ** 2)
        lait = ((d > 3) & (d < 26)).astype(np.float32) * 0.07
        bloom = np.exp(-d / 70.0) * np.clip((patch - 0.35) * 2.2, 0, 1) * (d > 3)
        col = col * (1 - 0.5 * line)[..., None] * (1 + lait)[..., None]
        col = col * (1 - 0.5 * bloom[..., None]) + np.array([0.86, 0.85, 0.8]) * 0.5 * bloom[..., None]
        h -= 1.0 * line
    # leaching streaks from the joints and weep holes
    noise = fbm(N, 4, 40, 644, aniso=(1, 8))
    for k in range(34):
        i = rng.integers(0, 4)
        y0 = (i * LIFT + 5) % N
        x0 = rng.integers(0, N)
        L = int(rng.uniform(140, 900))
        w = rng.uniform(5, 22)
        kind = rng.choice(['dark', 'rust', 'calc'], p=[0.5, 0.18, 0.32])
        cc = {'dark': (0.3, 0.29, 0.26), 'rust': (0.44, 0.31, 0.21), 'calc': (0.9, 0.89, 0.85)}[kind]
        a0 = {'dark': 0.55, 'rust': 0.45, 'calc': 0.5}[kind]
        weep = kind != 'calc' and rng.random() < 0.45
        if weep:
            y0 = (y0 + int(rng.uniform(40, 200))) % N
        ys = (y0 + np.arange(L)) % N
        t = np.arange(L) / L
        xc = x0 + 5 * np.sin(np.arange(L) / rng.uniform(40, 90)) + np.cumsum(rng.normal(0, 0.15, L))
        wid = w * (1 + 1.2 * t) * (0.7 if kind == 'calc' else 1)
        span = int(w * 3 + 8)
        xs = (np.arange(-span, span + 1)[None, :] + xc.astype(int)[:, None]) % N
        dx = (np.arange(-span, span + 1)[None, :] + xc.astype(int)[:, None] - xc[:, None]) / wid[:, None]
        al = a0 * np.exp(-dx ** 2) * ((1 - t) ** 1.3)[:, None] * (0.55 + 0.6 * noise[ys[:, None], xs])
        al = np.clip(al, 0, 1)
        sub = col[ys[:, None], xs]
        col[ys[:, None], xs] = sub * (1 - al[..., None]) + np.array(cc) * al[..., None]
        if weep:                                   # weep hole: small dark round opening at the streak head
            rr = (rows - y0) ** 2 + ((cols - int(xc[0]) + N // 2) % N - N // 2) ** 2
            m = np.clip(1.2 - np.sqrt(rr) / 7.0, 0, 1)
            col = col * (1 - 0.8 * m)[..., None]
            h -= 2.0 * m
    nor = blend_normals(nor, normal_from_height(blur(h, 1.2), 1.4))
    return np.clip(col, 0, 1), nor, arm


if __name__ == '__main__':
    import json
    d, n, a = make()
    U.register('concrete_dam', 'Mass-concrete dam face: 1.6 m lifts, efflorescence, leaching streaks, weep holes (6.4 m tile)',
               d, n, a, 6.4, 0.86, grime=0.4)
    p = os.path.join(U.LIB, 'materials.json')
    MJ = json.load(open(p))
    MJ['materials']['concrete_dam']['source'] = {'source': 'procedural (art/bridges/tools2/make_dam_tex.py, own work)',
                                                 'license': 'CC0-1.0', 'derived_from': 'concrete_board (lib, CC0 Poly Haven)'}
    json.dump(MJ, open(p + '.tmp_br', 'w'), indent=1)
    os.replace(p + '.tmp_br', p)
