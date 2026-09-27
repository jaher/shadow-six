"""make_cm_tex.py - procedural CC0 textures for the cars_moto group (own work), written to vehicles/cars_moto/lib/:
veh_tyre_{diff,nor,arm}.jpg  tyre tread strip (u = around the tyre, one tile = 4 lugs; v = across the profile).
    Blender v 0.0-0.5 (image bottom half) = German cross-country bar tread (staggered slanted bars from each shoulder),
    Blender v 0.5-1.0 (image top half)    = US 'NDT' non-directional tread (alternating angled bars + centre blocks).
    Inside each half the profile runs sidewall (0-0.25) / tread (0.25-0.75) / sidewall (0.75-1).
veh_wreck_{diff,nor,arm}.jpg fire-gutted steel detail: LOW-contrast fine grain (heat scale, blistered primer, pitting,
    tiny rust flecks). The large-scale burn pattern (soot tops, ash, bleached primer, rust panels) is world-space
    vertex colour (veh.py grime_vehicle) so there are no texture patches that cut at face edges.
Plus materials_add.json (kit materials.json entries for consolidation into art/kit/lib)."""
import os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lib'))
os.makedirs(OUT, exist_ok=True)
N = 1024
rng = np.random.default_rng(1943)


def tile_noise(n, cells, octaves=3, pers=0.5):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = np.tile(rng.random((c, c)).astype(np.float32), (3, 3))
        a = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((n * 3, n * 3), Image.BICUBIC), np.float32)[n:2 * n, n:2 * n] / 255.0
        out += a * amp
        tot += amp
        amp *= pers
    return out / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def normal_from(h, k):
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)


def save(name, rgb, nor, rough):
    arm = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)
    for kind, arr in (('diff', rgb), ('nor', nor), ('arm', arm)):
        Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, '%s_%s.jpg' % (name, kind)), quality=90)


# ------------------------------------------------------------------ tyre tread
S = 4                                   # supersample for crisp lug edges
W = H = N * S
hm = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(hm)
half = H // 2


def prof(p, top):
    """profile coordinate (0..1 across the tyre) -> image row inside a half (top half = NDT)."""
    y = (1 - p) * half                  # Blender v up = image row down
    return y if top else half + y


def poly(pts, top, val=255):
    for off in (-W, 0, W):              # wrap around u
        d.polygon([(x * W / 4 + off, prof(p, top)) for x, p in pts], fill=val)


for k in range(5):                      # 4 lugs per tile (+1 for wrap)
    u = k - 0.5
    # cross-country: slanted bars from each shoulder, staggered half a pitch, reaching just past the centre line
    poly([(u + 0.00, 0.20), (u + 0.42, 0.20), (u + 0.62, 0.53), (u + 0.26, 0.53)], False)
    poly([(u + 0.50, 0.80), (u + 0.92, 0.80), (u + 1.12, 0.47), (u + 0.76, 0.47)], False)
    # NDT: full-width bars angled alternately + a centre block between them
    s = 0.14 if k % 2 == 0 else -0.14
    poly([(u + 0.05, 0.22), (u + 0.40, 0.22), (u + 0.40 + s, 0.78), (u + 0.05 + s, 0.78)], True)
    poly([(u + 0.62, 0.42), (u + 0.86, 0.42), (u + 0.86, 0.58), (u + 0.62, 0.58)], True)
hm = hm.filter(ImageFilter.GaussianBlur(S * 1.2)).resize((N, N), Image.LANCZOS)
lug = np.asarray(hm, np.float32) / 255.0
yy = np.linspace(0, 1, N, dtype=np.float32)[:, None] * np.ones((1, N), np.float32)
p = 1 - ((yy * 2) % 1.0)                # profile coordinate per row
side = ((p < 0.2) | (p > 0.8)).astype(np.float32)
grain = tile_noise(N, 64, 2, 0.6)
h = lug * 1.0 + side * (0.25 + 0.05 * np.sin(p * 90)) + 0.06 * grain
rgb = np.ones((N, N, 3), np.float32) * 0.075
rgb += (lug * 0.05)[..., None] + (side * 0.012)[..., None] + ((grain - 0.5) * 0.03)[..., None]
rgb += (smooth(0.7, 1.0, lug) * 0.03)[..., None]           # worn polished lug tops
rgb *= np.array([1.0, 0.98, 0.95], np.float32)
rough = np.clip(0.93 - 0.10 * lug + 0.04 * (grain - 0.5), 0.7, 1.0)
save('veh_tyre', rgb, normal_from(h, 5.0), rough)
print('veh_tyre mean', [round(float(rgb[..., i].mean()), 4) for i in range(3)])

# ------------------------------------------------------------------ wreck steel (fine detail, neutral, low contrast)
mf = tile_noise(N, 12, 3, 0.55)
hf = tile_noise(N, 64, 2, 0.6)
vf = tile_noise(N, 160, 1)
flake = smooth(0.55, 0.62, tile_noise(N, 24, 3, 0.6))           # small paint/primer flakes (sub-10 cm)
fleck = smooth(0.68, 0.74, tile_noise(N, 48, 2, 0.6))           # tiny rust flecks
base = np.array([0.66, 0.62, 0.58], np.float32)
rgb = base[None, None] * (0.86 + 0.22 * mf[..., None]) * (0.9 + 0.2 * hf[..., None])
rgb = rgb * (1 - 0.25 * flake[..., None]) + np.array([0.52, 0.50, 0.49], np.float32) * 0.25 * flake[..., None]
rgb = rgb * (1 - 0.35 * fleck[..., None]) + np.array([0.74, 0.50, 0.36], np.float32) * 0.35 * fleck[..., None]
rgb *= (0.94 + 0.12 * vf)[..., None]
h = 0.5 * hf + 0.35 * flake + 0.25 * smooth(0.6, 0.8, tile_noise(N, 40, 2)) + 0.1 * vf
rough = np.clip(0.9 + 0.06 * (hf - 0.5) - 0.08 * fleck, 0.7, 1.0)
save('veh_wreck', np.clip(rgb, 0, 1), normal_from(h, 7.0), rough)
wm = [round(float(rgb[..., i].mean()), 4) for i in range(3)]
print('veh_wreck mean', wm)

src = {'license': 'CC0-1.0', 'source': 'procedural (vehicles/cars_moto/scripts/make_cm_tex.py, own work)'}
add = {
    'veh_tyre': {'label': 'Military tyre rubber, tread strip (cross-country / NDT)', 'tile_m': None, 'uv': 'keep (tread strip)',
                 'maps': {k: {'1k': '1k/veh_tyre_' + k} for k in ('diff', 'nor', 'arm')}, 'metallic': 0.0, 'normalScale': 1.0,
                 'roughness': 0.9, 'source': src},
    'veh_wreck': {'label': 'Fire-gutted steel detail (low contrast; burn pattern in vertex colour)', 'tile_m': 1.5, 'mean': wm,
                  'maps': {k: {'1k': '1k/veh_wreck_' + k} for k in ('diff', 'nor', 'arm')}, 'metallic': 0.0, 'normalScale': 0.9,
                  'roughness': 0.92, 'source': src},
}
json.dump({'materials': add, 'note': 'files in vehicles/cars_moto/lib/*.jpg; merge into art/kit/lib (1k/) on consolidation'},
          open(os.path.join(OUT, 'materials_add.json'), 'w'), indent=1)
json.dump({'veh_wreck_mean': wm}, open(os.path.join(OUT, 'means.json'), 'w'))
