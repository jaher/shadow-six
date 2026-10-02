# German pain cries, stage 3: vocal processing of the picked Chatterbox takes and packing into assets/audio/voice.
# usage: post.py WORK_DIR VOICE_DIR   (WORK/pick.json from pick.py; VOICE_DIR = assets/audio/voice)
#   -> WORK/master/<voice>/<rec>.wav (48 kHz 16-bit), VOICE_DIR/<voice>/pain/<rec>.{ogg,mp3,json}, rows merged into
#      VOICE_DIR/lines.json (speaker 'ger', voice 1-3, nonverbal, kind cry_<cat>).
# Env: FFMPEG = ffmpeg 7 with libopus + libmp3lame; PM_PY = a python with praat-parselmouth (psola.py: every pitch bend
# below is a formant-preserving PSOLA bend, so a vowel never turns into a diphthong).
#
# Every take keeps its guard's voice chain (70 Hz high-pass; the NCO's +2 dB @150 Hz) and the pack's finishing (trim
# -45 dB rel with 30 ms / 120 ms margins, active RMS -18 dBFS, tanh soft limit -1 dBFS, 8 ms fades, Opus 40 kbps +
# MP3 64 kbps). On top, per category (deterministic per take):
#   stab  - the shock: on half the takes a sharp intake of breath at the blow (50-70 ms of air hissing in, then a 20-30 ms
#           beat, then the cry), the pitch jumps up at the onset; then the cut-off: the throat closes - a
#           glottal stop (gain falls with a 15 ms time constant), a low-pass sweep 7 kHz -> 700 Hz, and a short choked
#           residue: creak (glottal fry, irregular 28-45 Hz pulses) and a wet breath through the closed throat.
#   shot  - a pained shout: the pitch sags at the end, vocal fry as the voice dies, an exhale (noise through the man's own
#           vocal tract: LPC of his loudest voiced frame).
#   blast - a scream: strained (soft saturation), a pitch fall at the end, fry tail.
#   ko    - the wind knocked out: pitch falls, fry, a long exhale as he goes limp.
import json, os, subprocess, sys
import numpy as np, soundfile as sf, librosa
from scipy.signal import lfilter, butter, sosfilt
from common import main_burst

SR = 48000
CHAIN = {'german_1': 'highpass=f=70', 'german_2': 'highpass=f=70,equalizer=f=150:t=q:w=1:g=2', 'german_3': 'highpass=f=70'}
VOICE_N = {'german_1': 1, 'german_2': 2, 'german_3': 3}

def ff(args):
    subprocess.run([os.environ['FFMPEG'], '-hide_banner', '-loglevel', 'error', '-y'] + args, check=True)

def load_chain(src, voice, tmp):
    ff(['-i', src, '-af', CHAIN[voice], '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_f32le', tmp])
    y, _ = sf.read(tmp, dtype='float32'); os.remove(tmp)
    return y

def env_rms(y, hop=240):
    return librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0]

def onset_peak(y):
    e = env_rms(y); hop = 240
    on = int(np.argmax(e > 0.12 * e.max())) * hop
    pk = int(np.argmax(e)) * hop
    a = np.abs(y); nz = np.nonzero(a > 0.03 * a.max())[0]
    return on, pk, (nz[-1] if len(nz) else len(y) - 1)

def lpc_noise(y_seg, n, rng, order=20):
    """White noise through the vocal tract of y_seg (LPC all-pole): a breath that has the man's own formants."""
    seg = y_seg * np.hanning(len(y_seg))
    try: a = librosa.lpc(seg.astype(np.float64) + 1e-9 * rng.standard_normal(len(seg)), order=order)
    except Exception: a = np.array([1.0])
    if not np.all(np.isfinite(a)): a = np.array([1.0])
    x = lfilter([1.0], a, rng.standard_normal(n))
    x = sosfilt(butter(2, [300, 9000], btype='band', fs=SR, output='sos'), x)
    return (x / (np.sqrt(np.mean(x ** 2)) + 1e-12)).astype(np.float32)

def fry_env(n, rng, rate=(28, 45), jitter=0.3, floor=0.15, width=(0.45, 0.7)):
    """Creaky voice (glottal fry): an irregular 28-45 Hz train of smooth (Hann) glottal pulses with period jitter, as an
    amplitude envelope between `floor` and 1. Smooth pulses: the creak is a pulsing of the voice, never a click."""
    out = np.zeros(n, np.float32); t = 0
    while t < n:
        per = int(SR / rng.uniform(*rate) * (1 + jitter * (rng.random() - 0.5)))
        L = max(8, int(per * rng.uniform(*width))); k = np.hanning(L).astype(np.float32) * (0.6 + 0.4 * rng.random())
        m = min(L, n - t); out[t:t + m] = np.maximum(out[t:t + m], k[:m])
        t += per
    return floor + (1 - floor) * out

def psola(y, cents, tag='p'):
    """Formant-preserving pitch bend (psola.py under PM_PY = a python with praat-parselmouth); same length as y."""
    work = os.environ.get('CRIES_TMP', '/tmp'); a, b, c = f'{work}/_ps_{tag}_in.wav', f'{work}/_ps_{tag}_out.wav', f'{work}/_ps_{tag}.json'
    sf.write(a, y, SR, subtype='FLOAT')
    t = np.arange(0, len(y), int(0.005 * SR))
    json.dump([[float(i / SR), float(cents[i])] for i in t], open(c, 'w'))
    subprocess.run([os.environ['PM_PY'], os.path.join(os.path.dirname(os.path.abspath(__file__)), 'psola.py'), a, b, c],
                   check=True, capture_output=True)
    z, _ = sf.read(b, dtype='float32')
    for f in (a, b, c): os.remove(f)
    return z[:len(y)] if len(z) >= len(y) else np.pad(z, (0, len(y) - len(z)))

def sweep_lowpass(y, fc_of_t):
    """Time-varying low-pass in the STFT domain: fc_of_t(t seconds) -> cutoff Hz (4th-order-like magnitude)."""
    n_fft, hop = 1024, 128
    S = librosa.stft(y, n_fft=n_fft, hop_length=hop)
    f = librosa.fft_frequencies(sr=SR, n_fft=n_fft)[:, None]
    t = librosa.frames_to_time(np.arange(S.shape[1]), sr=SR, hop_length=hop)
    fc = np.array([fc_of_t(x) for x in t])[None, :]
    S *= 1.0 / np.sqrt(1.0 + (f / fc) ** 8)
    return librosa.istft(S, hop_length=hop, length=len(y)).astype(np.float32)

def decay_env(n, fade_in=0.01, p=1.2):
    """Breath / creak envelope: a short raised-cosine fade-in, then a half-Hann decay to zero."""
    e = np.hanning(2 * n)[n:] ** p; k = min(n, int(fade_in * SR))
    e[:k] *= np.sin(np.linspace(0, np.pi / 2, k)) ** 2
    return e.astype(np.float32)

def smooth_step(n, a, b):
    """0 before sample a, 1 after b, raised cosine between."""
    x = np.clip((np.arange(n) - a) / max(1, b - a), 0, 1)
    return (0.5 - 0.5 * np.cos(np.pi * x)).astype(np.float32)

def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)

def process(y, cat, rng, idx):
    on, pk, end = onset_peak(y)
    n = len(y); rec = {}
    vseg = y[pk:pk + int(0.03 * SR)] if pk + int(0.03 * SR) < n else y[-int(0.03 * SR):]
    loud = rms(y[on:end + 1])
    if cat == 'stab':
        active = (end - on) / SR
        cut = on + int(SR * float(np.clip(rng.uniform(0.55, 0.72) * active, (pk - on) / SR + 0.07, 0.42)))
        cut = min(cut, n - int(0.05 * SR))
        jump = rng.uniform(120, 260); fall = rng.uniform(-320, -180)
        cents = jump * (1 - 0.6 * smooth_step(n, on + int(0.03 * SR), cut))  # the shock: high at once, relaxing
        cents += fall * smooth_step(n, cut - int(0.08 * SR), cut + int(0.04 * SR))
        yb = psola(y, cents, 'stab')
        cut2, on2 = cut, on
        # the throat closes: glottal stop + low-pass sweep from just before the cut
        tc = cut2 / SR
        yb = sweep_lowpass(yb, lambda x: 7000.0 if x < tc - 0.03 else max(700.0, 7000.0 * np.exp(-(x - (tc - 0.03)) / 0.025)))
        g = np.ones(len(yb), np.float32)
        tt = (np.arange(len(yb)) - cut2) / SR
        g[tt > 0] = np.maximum(10 ** (-34 / 20), np.exp(-tt[tt > 0] / 0.015))
        out = yb * g
        # choked residue: creak + wet breath through the closed throat
        rlen = int(SR * rng.uniform(0.09, 0.16)); blen = int(SR * rng.uniform(0.12, 0.2))
        cont = yb[cut2:cut2 + rlen]
        if len(cont) < rlen: cont = np.pad(cont, (0, rlen - len(cont)))
        cont = sosfilt(butter(2, 1100, fs=SR, output='sos'), cont).astype(np.float32)
        creak = cont / (rms(cont)) * fry_env(rlen, rng, floor=0.05) * decay_env(rlen, 0.004)
        breath = lpc_noise(vseg, blen, rng) * decay_env(blen, 0.015)
        breath = sosfilt(butter(2, 2500, fs=SR, output='sos'), breath).astype(np.float32)
        tail = np.zeros(max(rlen, blen) + int(0.02 * SR), np.float32)
        tail[:rlen] += creak * loud * 10 ** (rng.uniform(-19, -15) / 20)
        tail[int(0.015 * SR):int(0.015 * SR) + blen] += breath * loud * 10 ** (rng.uniform(-27, -23) / 20)
        keep = min(len(out), cut2 + int(0.09 * SR))  # 6 time constants: the closed throat is silent before the end
        out = out[:keep].copy(); fd = int(0.02 * SR); out[-fd:] *= np.cos(np.linspace(0, np.pi / 2, fd)) ** 2
        out = np.concatenate([out, np.zeros(max(0, cut2 + len(tail) - len(out)), np.float32)])
        out[cut2:cut2 + len(tail)] += tail
        rec.update(cut_s=round(cut2 / SR, 3), jump_cents=round(jump), fall_cents=round(fall))
        if idx % 2 == 1:  # a sharp intake of breath before the cry (ingressive: air hissing in, then a beat, then the cry)
            glen = int(SR * rng.uniform(0.05, 0.07)); gsp = rng.standard_normal(glen)
            gsp = sosfilt(butter(2, [1400, 7500], btype='band', fs=SR, output='sos'), gsp)
            gsp = sosfilt(butter(1, [2200, 3400], btype='band', fs=SR, output='sos'), gsp) * 0.6 + gsp * 0.4  # a soft teeth/palate peak
            gsp = (gsp / (rms(gsp) + 1e-12)).astype(np.float32)
            env = smooth_step(glen, 0, int(0.035 * SR)) * (1 - smooth_step(glen, glen - int(0.02 * SR), glen))
            gsp *= env * np.linspace(0.6, 1, glen) * loud * 10 ** (rng.uniform(-19, -15) / 20)
            gap = int(SR * rng.uniform(0.02, 0.03)); shift = glen + gap  # no splice: the cry is only delayed
            out = np.concatenate([np.zeros(shift, np.float32), out])
            o = on2  # the intake ends `gap` before the cry's onset, now at on2 + shift
            out[o:o + glen] += gsp
            rec['gasp_s'] = round(glen / SR, 3)
        return out, rec
    if cat in ('shot', 'blast', 'ko'):
        x = y.copy()
        if cat == 'blast':  # strain: soft saturation of the scream, a touch more pitch at the peak
            drive = rng.uniform(1.6, 2.2); x = np.tanh(drive * x / (np.abs(x).max() + 1e-9)) * np.abs(x).max() / np.tanh(drive)
            rec['drive'] = round(drive, 2)
        fall = {'shot': rng.uniform(-300, -150), 'blast': rng.uniform(-400, -200), 'ko': rng.uniform(-450, -250)}[cat]
        start = on + int((end - on) * {'shot': 0.55, 'blast': 0.6, 'ko': 0.35}[cat])
        cents = fall * smooth_step(n, start, end)
        if cat == 'blast': cents += rng.uniform(60, 140) * smooth_step(n, on, pk) * (1 - smooth_step(n, pk, start))
        x = psola(x, cents, cat); end2 = end
        # vocal fry as the voice dies + an exhale (his own vocal tract)
        flen = int(SR * {'shot': 0.12, 'blast': 0.15, 'ko': 0.16}[cat]); f0 = max(0, end2 - flen)
        seg = x[f0:end2]
        if len(seg) > 10:
            fr = fry_env(len(seg), rng, rate=(30, 50), floor=0.35, width=(0.6, 0.85)); mix = smooth_step(len(seg), 0, len(seg) // 2)
            x[f0:end2] = seg * (1 - mix + mix * fr)
        blen = int(SR * {'shot': 0.16, 'blast': 0.2, 'ko': 0.26}[cat])
        br = lpc_noise(vseg, blen, rng) * decay_env(blen, 0.03, 1.1) * loud * 10 ** ({'shot': -24, 'blast': -26, 'ko': -20}[cat] / 20)
        br = sosfilt(butter(2, 3000, fs=SR, output='sos'), br).astype(np.float32)
        o = max(0, end2 - int(0.04 * SR)); out = np.concatenate([x, np.zeros(blen, np.float32)])
        out[o:o + blen] += br
        rec.update(fall_cents=round(fall))
        return out.astype(np.float32), rec
    raise ValueError(cat)

def level(y, target=-18.0):
    a = np.abs(y); th = 10 ** (-45 / 20) * a.max(); nz = np.nonzero(a > th)[0]
    y = y[max(0, nz[0] - int(.03 * SR)):min(len(y), nz[-1] + int(.12 * SR))].copy()
    fr = librosa.feature.rms(y=y, frame_length=1024, hop_length=256)[0]; act = fr[fr > fr.max() * 0.1]
    y = y * (10 ** (target / 20) / max(1e-6, np.sqrt(np.mean(act ** 2))))
    lim = 10 ** (-1 / 20); k = 0.7 * lim
    y = np.where(np.abs(y) > k, np.sign(y) * (k + 0.3 * lim * np.tanh((np.abs(y) - k) / (0.3 * lim))), y)
    fd = int(.008 * SR); y[:fd] *= np.linspace(0, 1, fd); y[-fd:] *= np.linspace(1, 0, fd)
    return y.astype(np.float32)

def energy_visemes(y, open_v='aa'):
    hop = int(.04 * SR); fr = librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0]; mx = fr.max(); out = []
    for i, e in enumerate(fr):
        v = 'sil' if e < 0.12 * mx else (open_v if e > 0.5 * mx else ('E' if e > 0.25 * mx else 'ou'))
        a = round(i * hop / SR, 3); b = round(min(len(y) / SR, (i + 1) * hop / SR), 3)
        if out and out[-1][0] == v: out[-1][2] = b
        else: out.append([v, a, b])
    return out

def main():
    work, vdir = sys.argv[1], sys.argv[2]
    pick = json.load(open(f'{work}/pick.json'))
    rows, info = [], {}
    for key, takes in sorted(pick.items()):
        voice, cat = key.split('/')
        for i, c in enumerate(takes):
            rec = f'cry_{cat}_{i + 1}'
            rng = np.random.default_rng(VOICE_N[voice] * 1000 + i * 17 + len(cat) * 101)  # deterministic per take
            y = load_chain(f"{work}/{c['file']}", voice, f'{work}/_t.wav')
            if cat != 'ko':  # only the loud cry: a second "ah" after a pause is dropped (pick.py scored this burst)
                b0, b1 = main_burst(y, SR); y = y[max(0, b0 - int(0.03 * SR)):b1 + int(0.04 * SR)].copy()
                fd = int(0.03 * SR); y[:fd] *= np.sin(np.linspace(0, np.pi / 2, fd)) ** 2; y[-fd:] *= np.cos(np.linspace(0, np.pi / 2, fd)) ** 2
            out, recipe = process(y, cat, rng, i)
            out = level(out)
            m = f'{work}/master/{voice}/{rec}.wav'; os.makedirs(os.path.dirname(m), exist_ok=True); sf.write(m, out, SR, subtype='PCM_16')
            base = f'{vdir}/{voice}/pain/{rec}'; os.makedirs(os.path.dirname(base), exist_ok=True)
            dur = round(len(out) / SR, 3)
            tj = dict(text='', lang='', duration=dur, timing_source='rms-envelope', nonverbal=True, loop=False, words=[], phones=[],
                      visemes=energy_visemes(out), kind=f'cry_{cat}',
                      source_take=dict(engine='chatterbox-multilingual', prompt=c['text'], ref=c['ref'], exag=c['exag'], cfg=c['cfg'],
                                       temp=c['temp'], seed_k=c['k']), processing=recipe)
            json.dump(tj, open(base + '.json', 'w'), ensure_ascii=False)
            ff(['-i', m, '-c:a', 'libopus', '-b:a', '40k', '-vbr', 'on', '-application', 'audio', '-ar', '48000', base + '.ogg'])
            ff(['-i', m, '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', base + '.mp3'])
            rows.append(dict(speaker='ger', voice=VOICE_N[voice], rec=rec, text='', lang='', nonverbal=True, kind=f'cry_{cat}', loop=False,
                             duration=dur, files=[f'{voice}/pain/{rec}.ogg', f'{voice}/pain/{rec}.mp3'], timing=f'{voice}/pain/{rec}.json'))
            info[f'{voice}/{rec}'] = dict(recipe, prompt=c['text'], k=c['k'], dur=dur, peak=round(float(np.abs(out).max()), 3))
            print(voice, rec, info[f'{voice}/{rec}'], flush=True)
    lp = f'{vdir}/lines.json'; L = json.load(open(lp))
    L['lines'] = [l for l in L['lines'] if not (l['speaker'] == 'ger' and str(l.get('kind', '')).startswith('cry_'))] + \
        sorted(rows, key=lambda r: (r['voice'], r['rec']))
    if 'German pain cries' not in L['format']:
        L['format'] += ' ; German pain cries: nonverbal rows kind cry_stab|cry_shot|cry_blast|cry_ko in german_<n>/pain/ (tools/audio/cries)'
    json.dump(L, open(lp, 'w'), ensure_ascii=False, indent=1)
    json.dump(info, open(f'{work}/post_info.json', 'w'), indent=1, ensure_ascii=False)

if __name__ == '__main__':
    main()
