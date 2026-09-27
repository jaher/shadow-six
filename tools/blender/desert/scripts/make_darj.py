"""darj_panel: own-work procedural texture (CC0) for Hafsid/Zitouna minaret panels: ochre sandstone ashlar field
(0.3 m courses) carved with a white-limestone 'darj wa ktaf' lozenge net of cusped arcs, in low relief.
Writes kit/src/raw/darj_panel/{diff,nor,rough,ao}.jpg + lib_config/credits entries (tile 2.4 m, 3 lozenges across)."""
import os, json
import numpy as np
from PIL import Image, ImageFilter
KIT = '<claude-tmp>'
D = KIT + '/src/raw/darj_panel'
os.makedirs(D, exist_ok=True)
N = 2048
TILE = 2.4
y, x = np.mgrid[0:N, 0:N].astype(np.float32) / N * TILE        # metres, y down
# lozenge net: 3 cells across, cell 0.8 m wide, 1.2 m tall; sides are cusped arcs (sinusoid + small cusps)
cw, ch = TILE / 3, TILE / 2
u = (x % cw) / cw * 2 - 1          # -1..1 across the cell
v = (y % ch) / ch                  # 0..1 down the cell
# the two diagonal strips of a lozenge: |u| = 1 - 2|v-0.5| offset by a lobed wobble
lobe = 0.06 * np.abs(np.sin(v * np.pi * 6))
d1 = np.abs(np.abs(u) - (1 - np.abs(v - 0.5) * 2) - lobe)
strip = np.clip(1 - d1 / 0.07, 0, 1)
# vertical colonnette at the cell edges and small circles (cusps) at the lozenge tips
edge = np.clip(1 - np.abs(np.abs(u) - 1) / 0.04, 0, 1) * (v < 0.55) * (v > 0.05)
tip = np.clip(1 - (np.sqrt((u * cw / 2) ** 2 + ((v - 0.5) * ch) ** 2) - 0.05) / 0.02, 0, 1) * 0
h = np.clip(np.maximum(strip, edge), 0, 1)
h = np.asarray(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
# ashlar coursing in the field
rng = np.random.default_rng(3)
course = (y % 0.3) < 0.012
joint = np.zeros_like(x, bool)
for k in range(int(TILE / 0.3)):
    off = rng.uniform(0, 0.6)
    band = (y >= k * 0.3) & (y < (k + 1) * 0.3)
    joint |= band & (((x + off) % 0.62) < 0.012)
mort = (course | joint).astype(np.float32)
noise = np.asarray(Image.fromarray((rng.random((N // 16, N // 16)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)).astype(np.float32) / 255
fine = rng.random((N, N)).astype(np.float32)
och = np.array([0.72, 0.58, 0.40]) * (0.88 + 0.2 * noise[..., None] + 0.05 * fine[..., None])
wht = np.array([0.84, 0.81, 0.73]) * (0.92 + 0.1 * noise[..., None])
col = och * (1 - h[..., None]) + wht * h[..., None]
col = col * (1 - 0.35 * mort[..., None] * (1 - h[..., None]))
Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(D + '/diff.jpg', quality=92)
hh = h * 1.0 - mort * 0.3 + noise * 0.1
gy, gx = np.gradient(hh * 6.0)
nrm = np.stack([-gx, gy, np.ones_like(gx)], -1)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(D + '/nor.jpg', quality=92)
Image.fromarray(((0.82 + 0.1 * noise - 0.1 * h) * 255).astype(np.uint8)).save(D + '/rough.jpg', quality=92)
ao = 1 - 0.5 * mort - 0.25 * np.clip(np.asarray(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32) / 255 - h, 0, 1)
Image.fromarray((np.clip(ao, 0, 1) * 255).astype(np.uint8)).save(D + '/ao.jpg', quality=92)
cfgp, credp = KIT + '/src/lib_config.json', KIT + '/src/credits_raw.json'
cfg = json.load(open(cfgp))
cfg['darj_panel'] = {'label': 'Ochre ashlar panel carved with a white darj-wa-ktaf lozenge net (Zitouna/Hafsid minarets)', 'tile_m': TILE,
                     'rough': 0.85, 'grime': 0.8}
json.dump(cfg, open(cfgp, 'w'), indent=1)
cred = json.load(open(credp))
cred['darj_panel'] = {'source': 'procedural (own work, SHADOW SIX art pass)', 'id': 'darj_panel', 'url': None, 'authors': ['SHADOW SIX'],
                      'license': 'CC0-1.0', 'dimensions_mm': [2400, 2400], 'name': 'darj wa ktaf panel'}
json.dump(cred, open(credp, 'w'), indent=1)
print('ok')
