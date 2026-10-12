#!/usr/bin/env python3
"""Seam check of the streamed music (audio footprint pass): compare what the game's chunk player renders
(tools/audio/stream-render.mjs: ChunkCue + StreamVoice in an OfflineAudioContext) with the 24-bit WAV master played
the same way (loop body repeated after the intro), window by window. A gap, click or misplaced chunk shows as an
error spike at a chunk start, the seam or the loop point; codec noise is the same everywhere.

    python3 tools/audio/stream_check.py --render DIR [--scratch DIR] [--clips DIR] [--cues menu,mission_alert]

Prints, per cue: overall noise-to-signal (dB), the worst 10 ms window at a chunk boundary / at the loop point, and the
same percentile elsewhere; with --old renders (stream-render.mjs --old) the previous release's whole-file player is
measured the same way. --clips writes listening A/B excerpts (old vs new, FLAC) around the first loop point.
"""
import argparse, json, os, subprocess, sys, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from web_formats import find_ffmpeg, music_master, SCRATCH  # noqa: E402

WIN = 0.010


def read_wav_f32(p):
    with open(p, 'rb') as f:
        b = f.read()
    ch = int.from_bytes(b[22:24], 'little'); sr = int.from_bytes(b[24:28], 'little')
    i = b.find(b'data') + 8
    return np.frombuffer(b[i:], dtype=np.float32).reshape(-1, ch), sr


def run(ff, *a):
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)


def pcm(ff, src, sr, ch=2):
    p = subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-i', src, '-ac', str(ch), '-ar', str(sr), '-af', 'aresample=resampler=soxr',
                        '-f', 'f32le', '-'], check=True, capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, ch)


def reference(ff, master, meta, n_out, sr, looped):
    """The master played like the game: intro, then the loop body over and over, at the render rate."""
    x = pcm(ff, master, 48000)
    N48 = int(np.ceil(n_out * 48000 / sr)) + 4800
    if looped:
        ls, le = round(meta['loopStart'] * 48000), round(meta['loopEnd'] * 48000)
        idx = np.arange(N48)
        idx = np.where(idx < le, idx, ls + (idx - le) % (le - ls))
    else:
        idx = np.arange(min(N48, len(x)))
    y = x[np.minimum(idx, len(x) - 1)]
    with tempfile.TemporaryDirectory() as t:
        raw = os.path.join(t, 'r.f32')
        y.astype(np.float32).tofile(raw)
        p = subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, '-af',
                            'aresample=resampler=soxr', '-ar', str(sr), '-f', 'f32le', '-'], check=True, capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2)[:n_out]


def align(a, ref, sr, search=0.01):
    """Lag (samples) of a against ref over the first 20 s, by cross-correlation."""
    n = min(len(a), len(ref), 20 * sr)
    m = int(search * sr)
    a0, r0 = a[:n].mean(1), ref[:n].mean(1)
    best, lag = -1e9, 0
    for L in range(-m, m + 1):
        if L >= 0:
            c = float(np.dot(a0[L:], r0[:n - L]))
        else:
            c = float(np.dot(a0[:n + L], r0[-L:]))
        if c > best:
            best, lag = c, L
    return lag


def windows(a, ref, sr):
    w = int(WIN * sr)
    n = min(len(a), len(ref)) // w * w
    e = (a[:n] - ref[:n]).reshape(-1, w, 2)
    s = ref[:n].reshape(-1, w, 2)
    er = np.sqrt((e ** 2).mean((1, 2)) + 1e-20)
    sr_ = np.sqrt((s ** 2).mean((1, 2)) + 1e-20)
    return er, sr_


def analyse(name, a, ref, sr, marks, loud):
    lag = align(a, ref, sr)
    if lag > 0:
        a = a[lag:]
    elif lag < 0:
        ref = ref[-lag:]
    er, sg = windows(a, ref, sr)
    nsr = 20 * np.log10(er / sg)
    ok = sg > loud  # windows with music in them (silence makes a ratio meaningless)
    w = int(WIN * sr)
    near = np.zeros(len(er), bool)
    for t in marks:
        k = int(t * sr / w)
        near[max(0, k - 2):k + 3] = True
    base = nsr[ok & ~near]
    at = nsr[ok & near]
    tot = 20 * np.log10(np.sqrt(((a[:len(ref)] - ref[:len(a)]) ** 2).mean()) / np.sqrt((ref ** 2).mean()))
    return {'name': name, 'lag': int(lag), 'nsr_total_db': round(float(tot), 1), 'nsr_median_db': round(float(np.median(base)), 1),
            'nsr_p99_db': round(float(np.percentile(base, 99)), 1), 'nsr_max_elsewhere_db': round(float(base.max()), 1),
            'boundaries': int(len(marks)), 'nsr_max_at_boundaries_db': round(float(at.max()) if len(at) else -99.0, 1),
            'nsr_p99_at_boundaries_db': round(float(np.percentile(at, 99)) if len(at) else -99.0, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', required=True)
    ap.add_argument('--scratch', default=SCRATCH)
    ap.add_argument('--cues', default='')
    ap.add_argument('--ext', default='_ogg')
    ap.add_argument('--clips', default='')
    ap.add_argument('--ffmpeg')
    args = ap.parse_args()
    ff = find_ffmpeg(args.ffmpeg)
    man = json.load(open(os.path.join(os.path.dirname(HERE), '..', 'assets', 'audio', 'music', 'manifest.json')))
    cues = args.cues.split(',') if args.cues else sorted({f.split('_ogg')[0].split('_m4a')[0] for f in os.listdir(args.render) if f.endswith('.json')})
    rows = []
    for cid in cues:
        info_p = os.path.join(args.render, f'{cid}{args.ext}.json')
        if not os.path.exists(info_p):
            continue
        info = json.load(open(info_p))
        meta = man['meta'][cid]
        master, lossless = music_master(argparse.Namespace(scratch=args.scratch), cid)
        if not lossless:
            print(f'{cid}: no WAV master, skipped')
            continue
        a, sr = read_wav_f32(os.path.join(args.render, f'{cid}{args.ext}_stream.wav'))
        ref = reference(ff, master, meta, len(a), sr, info['looped'])
        # output times of every chunk start (each pass), the seam starts and the loop points
        marks = []
        cs = [c['t'] for c in man['cues'][cid]['chunks']]
        if info['looped']:
            ls, le = meta['loopStart'], meta['loopEnd']
            body = le - ls
            w = man['cues'][cid]['wrap']
            T = len(a) / sr
            marks += [t for t in cs if t <= le]
            k = 0
            while le + k * body < T:
                off = k * body
                marks += [le + off - w['s'], le + off]  # seam start, loop point
                marks += [t + body * (k + 1) for t in cs if ls <= t < le]
                k += 1
        else:
            marks = cs[1:]
        marks = sorted(m for m in marks if 0 < m < len(a) / sr - 0.05)
        loud = 10 ** (-50 / 20)
        r = analyse(f'{cid} stream{args.ext.replace("_", " ")}', a, ref, sr, marks, loud)
        rows.append(r)
        old_p = os.path.join(args.render, f'{cid}_old_whole.wav')
        if os.path.exists(old_p):
            o, _ = read_wav_f32(old_p)
            om = [meta['loopEnd'] + k * (meta['loopEnd'] - meta['loopStart']) for k in range(4)] if info['looped'] else []
            om = [m for m in om if m < len(o) / sr - 0.05]
            rows.append(analyse(f'{cid} old whole file (Vorbis)', o, ref, sr, om, loud))
            if args.clips and info['looped']:
                os.makedirs(args.clips, exist_ok=True)
                t0 = max(0.0, meta['loopEnd'] - 6)
                for tag, x in (('old', o), ('new', a)):
                    seg = x[int(t0 * sr):int((t0 + 12) * sr)]
                    with tempfile.TemporaryDirectory() as t:
                        raw = os.path.join(t, 'c.f32')
                        seg.astype(np.float32).tofile(raw)
                        run(ff, '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', raw, '-c:a', 'flac', '-sample_fmt', 's32', '-ar', '48000',
                            os.path.join(args.clips, f'music_{cid}_looppoint_{tag}.flac'))
    for r in rows:
        print(json.dumps(r))
    return rows


if __name__ == '__main__':
    main()
