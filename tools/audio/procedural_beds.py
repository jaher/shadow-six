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


def lufs(x):
    """Ungated BS.1770 loudness (K-weighted, channels summed) of a (n,) or (n, 2) 48 kHz render, LUFS."""
    from scipy.signal import lfilter
    x = np.atleast_2d(np.asarray(x, dtype=np.float64).T).T
    ms = 0.0
    for c in range(x.shape[1]):
        y = lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x[:, c])
        y = lfilter([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621], y)
        ms += np.mean(y ** 2)
    return -0.691 + 10 * np.log10(ms + 1e-20)


def shaped(n, rng, gain):
    """Circular (seamlessly looping) Gaussian noise of length n with magnitude response gain(f), unit RMS."""
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = np.fft.rfft(rng.standard_normal(n)) * gain(np.maximum(f, 1e-3))
    spec[0] = 0
    out = np.fft.irfft(spec, n)
    return out / (np.std(out) + 1e-12)


def drift(n, rng, corner_hz, rate=100):
    """Slow circular random process (unit std): Gaussian-spectrum noise with corner `corner_hz` (no periodicity)."""
    m = int(n * rate / SR)
    f = np.fft.rfftfreq(m, 1 / rate)
    spec = np.fft.rfft(rng.standard_normal(m)) * np.exp(-0.5 * (f / corner_hz) ** 2)
    spec[0] = 0
    lo = np.fft.irfft(spec, m)
    lo /= np.std(lo) + 1e-12
    # circular linear interpolation up to audio rate
    xp = np.arange(m + 1) * (n / m)
    return np.interp(np.arange(n), xp, np.concatenate([lo, lo[:1]]))


def hp2(f, fc):
    return (f / fc) ** 2 / np.sqrt(1 + (f / fc) ** 4)


def lp(f, fc, order=1):
    return 1 / np.sqrt(1 + (f / fc) ** (2 * order))


# Wind beds (2026-10-02 "the wind sound is too intense, as if in a terror movie"): the recorded takes they replace
# (Freesound 185070 "howling_wind", 402710 desert wind) were all moaning resonances (narrow peaks gliding 450–2600 Hz)
# and 60 dB swells out of dead silence. These are soft broadband air: shaped noise with smooth, wide spectra (no
# resonant band, nothing pitched), two layers (low body, upper air) whose levels drift independently and slowly
# (corners 0.04–0.25 Hz, never periodic) so the timbre breathes a little brighter in a stronger spell — no swell
# deeper than a few dB. Rendered as exact circular loops (FFT noise), so the loop seam is invisible.
WIND = {
    # name: (body LP Hz, body tilt corner Hz, air band (lo, hi) Hz, air level dB, hiss band, hiss dB, body sd dB, air sd dB, seed)
    'wind_air': (900, 220, (450, 2600), -12, None, None, 1.6, 3.0, 41),         # temperate / coast / urban: a soft breeze
    'wind_cold': (1200, 260, (500, 3400), -10, (3000, 9000), -25, 1.8, 3.4, 43),  # snow / fjord: a little airier, faint spindrift
    'wind_sand': (750, 200, (400, 2200), -15, (2500, 9000), -26, 1.2, 2.2, 47),   # desert: steady low air, a light sand hiss
}


def wind(name, loop_s=40.0):
    lpf, tilt, air, air_db, hiss, hiss_db, sd_b, sd_a, seed = WIND[name]
    rng = np.random.default_rng(seed)
    n = int(loop_s * SR)
    env_rng = np.random.default_rng(seed + 1000)  # shared by both channels (one wind, two ears)
    k = np.log(10) / 20
    spell = drift(n, env_rng, 0.04)  # slow spells (≈ 25 s): both layers
    e_body = np.exp(k * sd_b * (0.7 * spell + 0.3 * drift(n, env_rng, 0.12)))
    e_air = np.exp(k * sd_a * (0.6 * spell + 0.4 * drift(n, env_rng, 0.25)))
    body_g = lambda f: hp2(f, 45) * lp(f, tilt) * lp(f, lpf, 2)
    air_g = lambda f: hp2(f, air[0]) * lp(f, air[0] * 1.6) * lp(f, air[1], 2)
    chans = []
    for ch in range(2):
        sh = int(0.21 * SR) * ch  # the right ear hears the same spell a moment later (width without phasing)
        sig = shaped(n, rng, body_g) * np.roll(e_body, sh)
        sig += 10 ** (air_db / 20) * shaped(n, rng, air_g) * np.roll(e_air, sh)
        if hiss:
            hiss_g = lambda f, h=hiss: hp2(f, h[0]) * lp(f, h[1], 2)
            sig += 10 ** (hiss_db / 20) * shaped(n, rng, hiss_g) * np.roll(e_air, sh) ** 1.5
        chans.append(sig)
    x = np.stack(chans, 1)
    return x * 10 ** ((WIND_LUFS - lufs(x)) / 20)


WIND_LUFS = -24.0  # mastering loudness of the wind beds (manifest `lufs`; src/audio/manifest.js sets the in-game level)

BEDS = {
    'surf': (surf, 'procedural shoreline: swells, crash and receding wash, small laps on rocks'),
    'river': (river, 'procedural fast shallow river: broadband rush plus bubble chirps'),
    'wind_air': (lambda: wind('wind_air'), 'procedural soft breeze: broadband air, slow natural drift, no howl'),
    'wind_cold': (lambda: wind('wind_cold'), 'procedural cold wind: broadband air with faint spindrift hiss, no howl'),
    'wind_sand': (lambda: wind('wind_sand'), 'procedural desert air: steady low wind with a light sand hiss, no whistle'),
}
