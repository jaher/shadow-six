# German pain cries, stage 2: measure every Chatterbox candidate and pick the takes per voice and category.
# usage: pick.py WORK_DIR   (reads WORK/cand/index.json -> WORK/metrics.json, WORK/pick.json)
# Env: WHISPER_DIR = faster-whisper small (CTranslate2) folder, the QA model of the voice packs.
# A good cry: ONE burst (no "ah-ah-ah", no runaway), strongly voiced, a moving pitch (a flat F0 sounds synthetic), no
# word heard by free-language Whisper, no clipping, active length near the category's target.
import json, os, re, sys
import numpy as np, soundfile as sf, librosa
from scipy.signal import find_peaks
from faster_whisper import WhisperModel
from common import main_burst

WANT = {'stab': 4, 'shot': 3, 'blast': 3, 'ko': 3}  # variants shipped per voice
VOICED_MIN = {'stab': 0.35, 'shot': 0.4, 'blast': 0.4, 'ko': 0.15}
# every word Whisper hears must be an interjection (a cry, not a word); "mm-hmm" / "uh-huh" read as agreement
CRY_TOKEN = re.compile(r"^(?:a+h*|a+r+g*h*|o+h*|o+w+|o+f+|u+h*|u+g+h*|u+f+|o+u+f+|a+u+h*|a+c+h|h+m+|m+|u+m+p*f*|h+m+p*f*|h+u+h|h+a+h*|n+g+h*|h+n+g+h*|o+m+p+f*|[ぁあアァ啊哇]+)$", re.I)
def nonword(heard):
    if re.search(r"mm-?hmm|uh-?huh|h[ae]h?[\s,.!-]*h[ae]|haha|hehe", heard, re.I): return False  # agreement, laughter
    return all(CRY_TOKEN.match(w) for w in re.split(r"[\s,.!?…'\-—！、。]+", heard) if w)

def voicing(y16, sr=16000, win=0.04, hop=0.01):
    """Share of the loud frames (> -18 dB re max RMS) that are periodic (normalised autocorrelation peak > 0.45 at a
    60-600 Hz lag; pYIN's voicing rejects rough, screamed phonation), and the F0 track of those frames."""
    n, h = int(win * sr), int(hop * sr); lo, hi = int(sr / 600), int(sr / 60)
    fr = [y16[i:i + n] for i in range(0, len(y16) - n, h)]
    if not fr: return 0.0, np.array([])
    e = np.array([np.sqrt(np.mean(f ** 2)) for f in fr]); loud = e > e.max() * 10 ** (-18 / 20)
    v, f0 = [], []
    for f, l in zip(fr, loud):
        if not l: continue
        f = f - f.mean(); ac = np.correlate(f, f, 'full')[n - 1:]; ac /= ac[0] + 1e-12
        k = lo + int(np.argmax(ac[lo:hi])); v.append(ac[k] > 0.45)
        if ac[k] > 0.45: f0.append(sr / k)
    return float(np.mean(v)) if v else 0.0, np.array(f0)

def metrics(path, asr, heard=None):
    y, sr = sf.read(path, dtype='float32')
    a = np.abs(y); nz = np.nonzero(a > 0.03 * a.max())[0]
    act = (nz[-1] - nz[0]) / sr if len(nz) else 0.0
    b0, b1 = main_burst(y, sr); ym = y[b0:b1]
    am = np.abs(ym); nzm = np.nonzero(am > 0.03 * am.max())[0]
    act_main = (nzm[-1] - nzm[0]) / sr if len(nzm) else 0.0
    y16 = librosa.resample(y, orig_sr=sr, target_sr=16000)
    voiced, fv = voicing(librosa.resample(ym, orig_sr=sr, target_sr=16000))
    # pitch movement: pYIN where it tracks (accurate), else the autocorrelation track's IQR (octave-error proof)
    f0p, vfp, _ = librosa.pyin(librosa.resample(ym, orig_sr=sr, target_sr=16000), fmin=60, fmax=700, sr=16000, frame_length=1024, hop_length=160)
    fp = f0p[vfp] if vfp is not None and vfp.any() else np.array([])
    if len(fp) >= 10: rng = float(12 * np.log2(np.percentile(fp, 95) / np.percentile(fp, 5)))
    else: rng = float(12 * np.log2(np.percentile(fv, 75) / np.percentile(fv, 25))) if len(fv) > 4 else 0.0
    e = librosa.feature.rms(y=y, frame_length=1024, hop_length=240)[0]; e = np.convolve(e, np.ones(7) / 7, 'same')
    pk, _ = find_peaks(e, prominence=0.3 * e.max(), distance=int(0.12 * sr / 240))
    if heard is None:
        pad = np.zeros(4800, np.float32)
        segs, info = asr.transcribe(np.concatenate([pad, y16, pad]), beam_size=5)
        heard = (' '.join(s.text for s in segs).strip(), info.language)
    return dict(dur=round(len(y) / sr, 3), active=round(act, 3), active_main=round(act_main, 3), voiced=round(voiced, 2), f0=round(float(np.median(fv)), 1) if len(fv) else 0,
                f0_range_st=round(rng, 1), bursts=int(len(pk)), clipped=int((a >= 0.99).sum()), heard=heard[0],
                nonword=nonword(heard[0]), lang=heard[1])

def score(c, mt):
    act = mt['active_main'] if c['cat'] != 'ko' else mt['active']
    if mt['dur'] > 2.4 or act < 0.12: return -9
    s = -abs(act - c['target']) / c['target']
    s -= 0.8 * max(0, mt['bursts'] - (1 if c['cat'] == 'ko' else 2)) + (0.3 if mt['bursts'] > 1 else 0)  # one cry, not "oh, oh!"
    s -= 2.0 * max(0, VOICED_MIN[c['cat']] - mt['voiced'])
    s += 0.08 * min(mt['f0_range_st'], 6) if c['cat'] != 'ko' else 0
    s -= 0.0 if mt['nonword'] else 0.6
    s -= 0.01 * mt['clipped']
    return round(s, 3)

def main():
    work = sys.argv[1]
    index = json.load(open(f'{work}/cand/index.json'))
    mp = f'{work}/metrics.json'; M = json.load(open(mp)) if os.path.exists(mp) else {}
    asr = WhisperModel(os.environ['WHISPER_DIR'], device='cuda', compute_type='float16')
    for c in index:  # the acoustic measures are cheap and always redone; the Whisper transcription is cached
        old = M.get(c['file'])
        M[c['file']] = metrics(f"{work}/{c['file']}", asr, (old['heard'], old.get('lang')) if old else None)
    json.dump(M, open(mp, 'w'), indent=0, ensure_ascii=False)
    pick = {}
    for v in sorted({c['voice'] for c in index}):
        for cat, n in WANT.items():
            cs = sorted([dict(c, **M[c['file']], score=score(c, M[c['file']])) for c in index if c['voice'] == v and c['cat'] == cat],
                        key=lambda c: -c['score'])
            # hard rejects: a word heard, too little voice (a hiss is not a cry), a runaway
            ok = [c for c in cs if c['nonword'] and c['voiced'] >= VOICED_MIN[cat] and c['score'] > -0.5
                  and (cat == 'ko' or c['f0_range_st'] >= 2.5)]  # a monotone cry sounds synthetic
            out = []
            while len(out) < n and ok:  # greedy, a repeated prompt costs 0.25: distinct cries unless a prompt failed
                best = max(ok, key=lambda c: c['score'] - 0.25 * sum(o['prompt'] == c['prompt'] for o in out)
                           - (1 if any(abs(c['active'] - o['active']) < 0.03 and c['prompt'] == o['prompt'] for o in out) else 0))
                out.append(best); ok.remove(best)
            pick[f'{v}/{cat}'] = out
            print(v, cat, [(c['prompt'], c['k'], c['score'], c['active'], c['voiced'], c['f0_range_st'], c['bursts'], c['heard']) for c in out], flush=True)
    json.dump(pick, open(f'{work}/pick.json', 'w'), indent=1, ensure_ascii=False)

if __name__ == '__main__':
    main()
