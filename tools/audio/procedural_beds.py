"""Procedural ambience beds for the gaps the CC0 search left open (docs/realism-pipeline.md §1.5.1:
"coasts and harbors have no bed at all yet"; river rush for M2/M3/M19).

Pure numpy, deterministic (fixed seeds). Each bed is rendered longer than needed and folded into a
seamless loop with an equal-power crossfade. Output: 48 kHz stereo float32 arrays; the caller encodes.
    surf  - shoreline: rolling swells, crash + receding hiss wash, small laps on rocks
    river - fast shallow river: broadband rush plus a dense layer of bubble chirps
The output is project-generated (CC0).
"""
import numpy as np

SR = 48000


def band_noise(n, lo, hi, rng, tilt=0.0):
    """Gaussian noise band-limited to [lo, hi] Hz via FFT shaping; `tilt` dB/octave slope above lo."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    g = ((f >= lo) & (f <= hi)).astype(float)
    # soft edges (half-octave cosine skirts)
    for edge, sgn in ((lo, -1), (hi, 1)):
        w = (f > edge * (2 ** -0.5 if sgn < 0 else 1)) & (f < edge * (1 if sgn < 0 else 2 ** 0.5))
        x = np.log2(np.maximum(f[w], 1) / edge) * 2 * (-sgn)
        g[w] = np.maximum(g[w], 0.5 + 0.5 * np.cos(np.pi * np.clip(1 - x, 0, 1)))
    if tilt:
        g *= (np.maximum(f, lo) / max(lo, 1)) ** (tilt / 6.02)
    out = np.fft.irfft(spec * g, n)
    return out / (np.std(out) + 1e-9)


def smooth(x, sec):
    k = max(1, int(sec * SR))
    c = np.cumsum(np.concatenate([[0], x]))
    y = (c[k:] - c[:-k]) / k
    return np.concatenate([y, np.full(len(x) - len(y), y[-1])])


def loopify(x, loop_s, xfade_s=3.0):
    """Fold a (n, 2) render longer than loop+xfade into a seamless loop of loop_s seconds."""
    L, X = int(loop_s * SR), int(xfade_s * SR)
    body = x[:L].copy()
    tail = x[L:L + X]
    t = np.linspace(0, np.pi / 2, X)[:, None]
    body[:X] = body[:X] * np.sin(t) + tail * np.cos(t)
    return body


def norm(x, peak_db=-3.0):
    return x * (10 ** (peak_db / 20) / (np.max(np.abs(x)) + 1e-9))


def surf(loop_s=32.0, seed=11):
    rng = np.random.default_rng(seed)
    n = int((loop_s + 4) * SR)
    t = np.arange(n) / SR
    chans = []
    for ch in range(2):
        low = band_noise(n, 30, 260, rng, -3)
        mid = band_noise(n, 200, 1800, rng, -2)
        hiss = band_noise(n, 1500, 11000, rng, -4)
        env_l, env_m, env_h = np.full(n, 0.25), np.full(n, 0.12), np.full(n, 0.05)
        wrng = np.random.default_rng(seed + 100)  # same wave times on both channels
        at = 0.8
        while at < loop_s + 4:
            size = wrng.uniform(0.6, 1.0)
            dt = t - at - ch * 0.035  # small inter-channel delay → width
            rise = np.clip(dt / 2.2 + 1, 0, 1) * (dt < 0)
            crash = np.exp(-np.maximum(dt, 0) / 0.9) * (dt >= 0)
            wash = np.exp(-np.maximum(dt - 0.4, 0) / 2.8) * (dt >= 0) * np.clip(dt / 0.6, 0, 1)
            env_l += size * (0.55 * rise ** 2 + 0.8 * crash)
            env_m += size * (0.25 * rise ** 3 + 0.9 * crash + 0.35 * wash)
            env_h += size * (0.6 * crash + 0.55 * wash * (0.7 + 0.3 * np.sin(dt * 9) ** 2))
            at += wrng.uniform(6.5, 10.5)
        laps = np.zeros(n)
        for _ in range(int(loop_s * 1.4)):
            c = int(rng.uniform(0, n - SR))
            d = np.exp(-np.arange(int(0.25 * SR)) / (0.06 * SR))
            laps[c:c + len(d)] += rng.uniform(0.2, 0.6) * d
        env_m += smooth(laps, 0.01)
        sig = low * smooth(env_l, 0.05) + mid * smooth(env_m, 0.02) * 0.8 + hiss * smooth(env_h, 0.02) * 0.55
        chans.append(sig)
    return norm(loopify(np.stack(chans, 1), loop_s), -4)


def river(loop_s=24.0, seed=23):
    rng = np.random.default_rng(seed)
    n = int((loop_s + 4) * SR)
    t = np.arange(n) / SR
    chans = []
    for ch in range(2):
        rush = band_noise(n, 80, 6000, rng, -3.5)
        mod = 1 + 0.12 * np.sin(2 * np.pi * 0.13 * t + ch) + 0.08 * np.sin(2 * np.pi * 0.37 * t + 2 * ch)
        sig = rush * mod * 0.5
        bub = np.zeros(n)
        count = int(loop_s * 55)
        for _ in range(count):
            c = int(rng.uniform(0, n - 4000))
            f0 = rng.uniform(350, 1900)
            dur = rng.uniform(0.012, 0.045)
            k = np.arange(int(dur * SR)) / SR
            f = f0 * (1 + 1.8 * k / dur * 0.25)  # Minnaert bubble: pitch glides up as it rises
            ph = 2 * np.pi * np.cumsum(f) / SR
            bub[c:c + len(k)] += rng.uniform(0.1, 0.5) * np.sin(ph) * np.exp(-k / (dur * 0.35))
        chans.append(sig + bub * 0.9)
    return norm(loopify(np.stack(chans, 1), loop_s), -4)


BEDS = {
    'surf': (surf, 'procedural shoreline: swells, crash and receding wash, small laps on rocks'),
    'river': (river, 'procedural fast shallow river: broadband rush plus bubble chirps'),
}
