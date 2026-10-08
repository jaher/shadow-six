"""Procedural, seamless 1k PBR maps (own work, CC0) for long-abandoned plant (M16 bulldozer_rusty):
  paint_rust_ochre  faded yellow-ochre enamel worn through to red-oxide primer and rust: blotchy chalking, peeled chips
                    with a primer rim, rust patches with orange cores and dark scale, pitting, rain runs (1.6 m tile)
  rust_heavy        steel corroded right through: orange-brown scale, dark pits, flaking crust, black mill-scale
                    remnants, grit (1.2 m tile; track shoes, blade face, undercarriage)
Writes <out>/<name>_{diff,nor,arm}.jpg (ARM = AO, roughness, metal). usage: python3 make_rust_tex.py <out_dir> [px]
Ship: copy the maps to assets/textures/lib/1k/ plus Lanczos 512 px twins in lib/512/ (loading-int2 test)."""
import sys, os
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rust_tex'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(16)


def fnoise(beta=2.0, lo=2, hi=None, aniso=(1.0, 1.0)):
    """Periodic (tileable) 1/f^beta noise, normalised to 0..1. lo/hi band-limit in cycles per tile;
    aniso stretches the spectrum (x, y) so features elongate (runs, grain)."""
    w = rng.standard_normal((N, N))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(N)[:, None] * N * aniso[1]
    fx = np.fft.fftfreq(N)[None, :] * N * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    amp = 1 / f ** (beta / 2)
    amp[f < lo] = 0
    if hi:
        amp[f > hi] *= np.exp(-(f[f > hi] - hi) / (hi * 0.25))
    r = np.real(np.fft.ifft2(F * amp))
    r -= r.min()
    return r / r.max()


def smooth(x, sig):
    """Periodic gaussian blur (FFT)."""
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi * sig) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(x) * g))


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def col(c):
    return np.array(c, dtype=np.float32)[None, None, :] / 255.0


def lerp(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


def normal_from(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save(name, diff, nor, ao, rough, metal):
    q = dict(quality=88, subsampling=0)
    Image.fromarray((np.clip(diff, 0, 1) ** (1 / 1.0) * 255).astype(np.uint8)).save(os.path.join(OUT, name + '_diff.jpg'), **q)
    Image.fromarray((np.clip(nor, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name + '_nor.jpg'), **q)
    arm = np.stack([ao, rough, metal], -1)
    Image.fromarray((np.clip(arm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name + '_arm.jpg'), **q)
    m = diff.reshape(-1, 3).mean(0)
    print(name, 'mean', [round(float(v), 4) for v in m])


# ---------------------------------------------------------------- paint_rust_ochre
big = fnoise(2.2, 2, 40)                      # large wear zones
mid = fnoise(2.0, 6, 160)
fine = fnoise(1.4, 30, None)
grain = fnoise(1.0, 120, None)
runs = fnoise(2.0, 3, 300, aniso=(1.0, 0.08))  # vertically elongated rain/rust runs (v = up the face)
wear = big * 0.55 + mid * 0.33 + fine * 0.12
Q = lambda q: float(np.quantile(wear, q))
cn = fnoise(1.2, 60, None) * 0.7 + fine * 0.3
chips = sstep(0.9, 0.93, cn)                                                  # small scattered chips in sound paint
paint_cov = (1 - sstep(Q(0.62), Q(0.64), wear)) * (1 - chips)                # ~62 % of the face still painted
primer = np.maximum(sstep(Q(0.57), Q(0.6), wear) * (1 - sstep(Q(0.64), Q(0.68), wear)), sstep(0.87, 0.9, cn) - chips)
rust = np.maximum(sstep(Q(0.63), Q(0.66), wear), chips)
rust_core = sstep(Q(0.8), Q(0.9), wear + fine * 0.05)
chalk = smooth(big, 6)
paint = lerp(col((170, 128, 44)), col((192, 160, 86)), sstep(0.3, 0.8, chalk))          # Hi-way-yellow faded to chalky ochre
paint = lerp(paint, col((150, 122, 66)), sstep(0.55, 0.9, mid) * 0.5)
paint *= (0.93 + 0.12 * grain)[..., None]
prim = col((128, 62, 34)) * (0.9 + 0.2 * fine)[..., None]
rcol = lerp(col((92, 54, 28)), col((148, 86, 40)), sstep(0.25, 0.85, fine * 0.6 + mid * 0.4))
rcol = lerp(rcol, col((66, 40, 24)), rust_core * sstep(0.4, 0.8, grain) * 0.8)            # dark scale in the cores
pits = sstep(0.82, 0.9, grain) * rust
rcol = lerp(rcol, col((40, 28, 22)), pits)
diff = lerp(paint, prim, primer * 0.85)
diff = lerp(diff, rcol, rust)
streak = sstep(0.62, 0.85, runs) * (0.35 + 0.65 * sstep(0.35, 0.6, smooth(rust, 10))) * paint_cov
diff = lerp(diff, col((120, 78, 44)), streak * 0.45)                                         # rust bleeding over the paint
dirt = sstep(0.55, 0.95, fnoise(2.0, 4, 80))
diff = lerp(diff, col((92, 80, 62)), dirt * 0.25)
h = paint_cov * 0.6 + primer * 0.4 + rust * (0.25 + 0.35 * fine) - pits * 0.3 + grain * 0.04
save('paint_rust_ochre', diff, normal_from(smooth(h, 0.7), 9.0), 1 - pits * 0.35 - (1 - paint_cov) * 0.08,
     0.55 * paint_cov + 0.88 * (1 - paint_cov) + 0.05 * grain, rust * 0.0 + paint_cov * 0.12)

# ---------------------------------------------------------------- rust_heavy
big = fnoise(2.2, 2, 40)
mid = fnoise(1.9, 8, 200)
fine = fnoise(1.3, 40, None)
grain = fnoise(1.0, 150, None)
flake = sstep(0.58, 0.63, mid * 0.7 + fine * 0.3)            # raised crust flakes
mill = sstep(0.66, 0.72, big * 0.8 + fine * 0.2) * (1 - flake)   # black mill-scale remnants
rc = lerp(col((96, 52, 30)), col((158, 84, 38)), sstep(0.2, 0.8, big * 0.5 + mid * 0.5))
rc = lerp(rc, col((176, 104, 50)), sstep(0.7, 0.95, fine) * 0.6)      # bright orange bloom
rc = lerp(rc, col((70, 40, 26)), flake * 0.55)
rc = lerp(rc, col((46, 40, 36)), mill * 0.8)
pits = sstep(0.8, 0.9, grain)
rc = lerp(rc, col((34, 24, 18)), pits * 0.8)
rc *= (0.9 + 0.2 * grain)[..., None]
h = big * 0.2 + flake * 0.5 + fine * 0.25 - pits * 0.35
save('rust_heavy', rc, normal_from(smooth(h, 0.6), 12.0), 1 - pits * 0.4, 0.86 + 0.1 * fine - mill * 0.25, mill * 0.35)
