#!/usr/bin/env python3
"""Web audio formats (audio footprint pass, 2026-10): every shipped sound exists as Opus in Ogg (.ogg: Chrome, Edge,
Firefox, Android) and AAC-LC in MP4 (.m4a: Safari on macOS / iOS and every iOS browser — WebKit's Opus support has
differed between <audio> and decodeAudioData from version to version). The MP3 twins are gone: a client downloads one
format (src/audio/formats.js picks it) and the build ships no unused duplicate.

    python3 tools/audio/web_formats.py [--only music,narration,voice,sfx,sfxsrc] [--scratch DIR] [--ffmpeg PATH] [--keep-mp3]

Sources (the best one available; never a second lossy generation where a lossless master exists):
  music      24-bit / 48 kHz WAV masters (scratchpad music/a/cues: route-A cues; music/now/out: the mission score) →
             chunked (see CHUNK_S): Opus 96 kb/s stereo + AAC 128 kb/s. mission_tension_a has no surviving master: its
             chunks come from the shipped Vorbis q5 (≈160 kb/s) at Opus 128 kb/s / AAC 160 kb/s.
  narration  WAV masters (scratchpad narr2/all/proc, period-processed, before the codec) → Opus 32 kb/s mono + AAC
             40 kb/s mono at 24 kHz (the period chain leaves nothing above 11 kHz), each through the same 4x-oversampled
             limiter as tools/audio/narration/package.mjs so the shipped clip peaks at or below -1 dBTP.
  voice      the shipped Opus takes stay as they are (≈38 kb/s mono); AAC 40 kb/s mono at 24 kHz from the WAV master
             (scratchpad voices/final) when it exists, else from the Opus take (Kokoro / Chatterbox speech: < 12 kHz).
  sfx        (--only sfx) AAC twins of the shipped Opus files (96 kb/s mono, 128 kb/s stereo); a stereo file whose
             channels are the same to within -45 dB (side / total) is flagged `mono`.
  sfxsrc     (--only sfxsrc, run with the R&D venv python: soundfile + scipy) the SFX rebuilt from their sources, one
             generation like the first build: the CC0 Freesound previews through the R&D cutter (sfx_build.py: the same
             events, loops and excerpts), the Kenney originals, the procedural beds; each rebuilt take must match the
             shipped one (correlation > 0.97, level within 1 dB) or it is kept as it was (gate smash, bomb ticks).
             Then: one channel when the two are the same (`mono`: the engine plays it as two equal channels, the same
             panning as before), leading / trailing silence below -60 dB of the peak trimmed off one-shots, and the
             Opus rate matched to the sound's bandwidth (mono 40 / 48 / 64 kb/s, stereo 64 / 80 / 96); AAC 1.5x.
Writes the manifests' `files` as [ogg, m4a] and deletes the MP3s (unless --keep-mp3).
"""
import argparse, glob, json, math, os, shutil, subprocess, sys, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
AUD = os.path.join(REPO, 'assets', 'audio')
SCRATCH = '<claude-tmp>'
SR = 48000
CHUNK_S = 8.0  # music chunk length (s): ~2 MB of decoded PCM per chunk at 32 kHz stereo
OVERLAP_S = 0.1  # each chunk carries the next 0.1 s: consecutive chunks crossfade over it (no seam, no codec edge)
SEAM_S = 0.4  # looped cues: the seam file = the last 0.4 s of the loop body + the first OVERLAP_S of the body
AAC_DELAY = 1024  # ffmpeg's native AAC encoder priming (samples at 48 kHz): the m4a edit list trims it; the player re-checks
NEAR_MONO_DB = -45.0


def find_ffmpeg(arg):
    for c in [arg, os.environ.get('FFMPEG'), shutil.which('ffmpeg')]:
        if c and os.path.exists(c):
            return c
    for d, _, fs in os.walk(os.path.expanduser('~/.cache/uv/archive-v0')):
        for f in fs:
            if f.startswith('ffmpeg-linux') and 'imageio_ffmpeg' in d:
                return os.path.join(d, f)
    sys.exit('ffmpeg with libopus + aac not found (--ffmpeg PATH)')


class FF:
    def __init__(self, exe):
        self.exe = exe

    def run(self, *a):
        subprocess.run([self.exe, '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)

    def pcm(self, src, ch=None, sr=SR):
        """Decode to float32 (n, ch)."""
        info = subprocess.run([self.exe, '-hide_banner', '-i', src], capture_output=True, text=True).stderr
        if ch is None:
            ch = 2 if (' stereo' in info or '2 channels' in info) else 1
        p = subprocess.run([self.exe, '-hide_banner', '-loglevel', 'error', '-i', src, '-ac', str(ch), '-ar', str(sr),
                            '-f', 'f32le', '-'], check=True, capture_output=True)
        return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, ch)

    def write_wav(self, path, x, sr=SR):
        x = np.ascontiguousarray(x, dtype=np.float32)
        ch = 1 if x.ndim == 1 else x.shape[1]
        raw = path + '.f32'
        x.tofile(raw)
        self.run('-f', 'f32le', '-ar', str(sr), '-ac', str(ch), '-i', raw, '-c:a', 'pcm_f32le', path)
        os.remove(raw)

    def opus(self, src, dst, kbps, ch, af=None):
        self.run('-i', src, *(['-af', af] if af else []), '-ac', str(ch), '-ar', str(SR), '-c:a', 'libopus',
                 '-b:a', f'{kbps}k', '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-map_metadata', '-1', dst)

    def aac(self, src, dst, kbps, ch, sr=SR, af=None):
        self.run('-i', src, *(['-af', af] if af else []), '-ac', str(ch), '-ar', str(sr), '-c:a', 'aac', '-b:a', f'{kbps}k',
                 '-movflags', '+faststart', '-map_metadata', '-1', dst)

    def true_peak(self, f):
        out = subprocess.run([self.exe, '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
        s = out[out.rfind('Summary:'):]
        for line in s.splitlines():
            if 'Peak:' in line:
                return float(line.split('Peak:')[1].split('dBFS')[0])
        return 0.0

    def channels(self, f):
        info = subprocess.run([self.exe, '-hide_banner', '-i', f], capture_output=True, text=True).stderr
        return 2 if (' stereo' in info or '2 channels' in info) else 1


def rel_mp3_to(f, ext):
    return f[:-4] + ext


def size(paths):
    return sum(os.path.getsize(p) for p in paths if os.path.exists(p))


# ------------------------------------------------------------------------------------------------ sfx
def do_sfx(ff, args):
    man_p = os.path.join(AUD, 'sfx', 'manifest.json')
    man = json.load(open(man_p))
    flagged = 0
    for s in man['sounds']:
        ogg = next(f for f in s['files'] if f.endswith('.ogg'))
        src = os.path.join(AUD, 'sfx', ogg)
        m4a = rel_mp3_to(ogg, '.m4a')
        if s.get('opus_kbps') and os.path.exists(os.path.join(AUD, 'sfx', m4a)):
            continue  # rebuilt from its source by --only sfxsrc: both files are first generation already
        ch = ff.channels(src)
        if ch == 2:
            x = ff.pcm(src, 2)
            side = (x[:, 0] - x[:, 1]) / 2
            r = 10 * math.log10(float((side ** 2).sum()) / (float((x ** 2).sum()) / 2 + 1e-12) + 1e-20)
            if r < NEAR_MONO_DB:
                s['mono'] = True  # channels equal to < -45 dB: one decoded channel, up-mixed at playback
                flagged += 1
            else:
                s.pop('mono', None)
        ff.aac(src, os.path.join(AUD, 'sfx', m4a), 128 if ch == 2 else 96, ch)
        s['files'] = [ogg, m4a]
    json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)
    print(f'sfx: {len(man["sounds"])} sounds, {flagged} near-mono stereo flagged')


# ------------------------------------------------------------------------------------------------ sfx from sources
SILENCE_DB = -60.0  # one-shots: leading / trailing audio below this (re the take's peak) is trimmed
LEAD_KEEP, TAIL_KEEP, TAIL_FADE = 0.005, 0.03, 0.02


def band_width(x, sr=SR):
    """Highest frequency (Hz) whose 1/3-octave band is within 50 dB of the loudest band (the sound's useful bandwidth)."""
    m = x.mean(1) if x.ndim == 2 else x
    n = 1 << int(np.ceil(np.log2(max(2048, min(len(m), 1 << 18)))))
    seg = np.zeros(n); seg[:min(n, len(m))] = m[:n]
    spec = np.abs(np.fft.rfft(seg * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    centres = 1000 * 2 ** (np.arange(-17, 14) / 3)  # 20 Hz … 20 kHz
    lv = []
    for c in centres:
        k = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))
        lv.append(10 * np.log10(spec[k].sum() + 1e-20))
    lv = np.array(lv)
    ok = np.flatnonzero(lv > lv.max() - 50)
    return float(centres[ok[-1]]) if len(ok) else 20000.0


def opus_rate(x, stereo):
    """Opus kb/s matched to the sound: the shipped rates (64 mono / 96 stereo) for full-band sounds, less for sounds
    with nothing in the top octaves (Opus spends its bits where the energy is; a dull thud needs fewer)."""
    bw = band_width(x)
    if stereo:
        return (64 if bw < 8000 else 80 if bw < 12500 else 96), bw
    return (40 if bw < 6300 else 48 if bw < 10000 else 64), bw


def trim(x, sr=SR):
    """Cut leading / trailing silence (below SILENCE_DB re peak) off a one-shot; short fades at the new edges."""
    a = np.abs(x).max(1) if x.ndim == 2 else np.abs(x)
    thr = a.max() * 10 ** (SILENCE_DB / 20)
    idx = np.flatnonzero(a > thr)
    if not len(idx):
        return x, 0.0, 0.0
    i0 = max(0, idx[0] - int(LEAD_KEEP * sr))
    i1 = min(len(x), idx[-1] + int(TAIL_KEEP * sr))
    y = x[i0:i1].copy()
    fi, fo = min(int(0.002 * sr), len(y) // 4), min(int(TAIL_FADE * sr), len(y) // 4)
    sh = (slice(None), None) if y.ndim == 2 else (slice(None),)
    if i0 > 0 and fi:
        y[:fi] *= np.linspace(0, 1, fi)[sh]
    if i1 < len(x) and fo:
        y[-fo:] *= np.linspace(1, 0, fo)[sh]
    return y, i0 / sr, (len(x) - i1) / sr


def match(ff, shipped, y):
    """Does a regenerated source sound like the shipped take? (correlation at the best lag within ±10 ms, level)
    → (ok, corr, dB)"""
    ch = 2 if (y.ndim == 2 and y.shape[1] == 2) else 1
    z = ff.pcm(shipped, ch)
    a = (y.mean(1) if y.ndim == 2 else y).astype(np.float64)
    b = (z.mean(1) if z.ndim == 2 else z).astype(np.float64)
    n = min(len(a), len(b))
    m = min(n, 20 * SR)
    N = 1 << int(np.ceil(np.log2(2 * m)))
    c = np.fft.irfft(np.fft.rfft(a[:m], N) * np.conj(np.fft.rfft(b[:m], N)), N)  # c[L] = sum a[i + L] b[i]
    W = 480
    cand = np.concatenate([c[:W + 1], c[-W:]])
    k = int(np.argmax(cand))
    lag = k if k <= W else k - len(cand)
    u, v = (a[lag:n], b[:n - lag]) if lag >= 0 else (a[:n + lag], b[-lag:n])
    best = float(np.dot(u, v) / (np.sqrt(np.dot(u, u) * np.dot(v, v)) + 1e-20))
    db = 20 * np.log10((np.sqrt((b[:n] ** 2).mean()) + 1e-12) / (np.sqrt((a[:n] ** 2).mean()) + 1e-12))
    return best > 0.97 and abs(db) < 1.0, best, db


def sfx_sources(args):
    """{shipped id: float array (n,) or (n,2) at 48 kHz}: the pre-codec signal of every take that can be rebuilt
    losslessly from its source — the CC0 previews through the R&D cutter (sfx_build.py: same events, loops and
    excerpts), the Kenney originals, the procedural beds. Others (gate smash, bomb ticks) are not rebuilt."""
    import importlib.util
    rnd = os.path.join(args.scratch, 'realism', 'audio')
    out = {}
    cwd = os.getcwd()
    try:
        spec = importlib.util.spec_from_file_location('sfx_build', os.path.join(rnd, 'tools', 'sfx_build.py'))
        sb = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sb)  # chdir()s into the R&D folder
        for fn in sorted(glob.glob(os.path.join(rnd, 'src', 'freesound', '*.mp3'))):
            cat, sid = os.path.basename(fn)[:-4].split('__')
            mode, p = sb.PLAN[cat]
            x = sb.load(fn)
            ys = []
            if mode == 'shot':
                ev = sb.events(x)
                ev.sort(key=lambda ab: -np.max(np.abs(x[ab[0]:ab[1]])))
                for a, b in sorted(ev[:p]):
                    ys.append(sb.peaknorm(sb.fade(x[a:b].mean(1)), -3.0))
            elif mode == 'loop':
                y = sb.make_loop(x, p)
                y = sb.peaknorm(y, -6.0) if cat == 'bomb_tick' else sb.rmsnorm(y, -24 if cat not in ('tank_engine', 'truck_engine') else -20)
                if np.max(np.abs(y)) > 10 ** (-3 / 20):
                    y = sb.peaknorm(y, -3.0)
                ys.append(y)
            else:
                e = sb.env_db(x.mean(1), 0.5)
                c = int(np.argmax(e)); n = int(p * sb.SR)
                a = max(0, min(len(x) - n, c - n // 3))
                ys.append(sb.peaknorm(sb.fade(x[a:a + n], 0.01, 0.8), -3.0))
            for j, y in enumerate(ys):
                out[f'{cat}/{cat}_{sid}_{j}'] = np.asarray(y, dtype=np.float32)
    finally:
        os.chdir(cwd)
    kdir = os.path.join(rnd, 'src', 'kenney')
    kenney = {}
    for f in glob.glob(os.path.join(kdir, '**', '*.ogg'), recursive=True):
        if 'Preview' not in f:
            kenney.setdefault(os.path.basename(f)[:-4], []).append(f)
    out['__kenney__'] = kenney
    sys.path.insert(0, HERE)
    from procedural_beds import BEDS
    for name, (fn, _) in BEDS.items():
        out[f'{name}/{name}_proc_0'] = np.asarray(fn(), dtype=np.float32)
    return out


def do_sfx_sources(ff, args):
    """Re-encode the SFX from their sources: one channel where the two are the same, silence trimmed off one-shots,
    the Opus rate matched to each sound; the AAC twin from the same source."""
    man_p = os.path.join(AUD, 'sfx', 'manifest.json')
    man = json.load(open(man_p))
    src = sfx_sources(args)
    kenney = src.pop('__kenney__')
    rows, kept = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for s in man['sounds']:
            ogg = next(f for f in s['files'] if f.endswith('.ogg'))
            shipped = os.path.join(AUD, 'sfx', ogg)
            if s.get('opus_kbps'):  # rebuilt by an earlier (interrupted) run
                rows.append((s['id'], f'done earlier ({s["opus_kbps"]} kb/s)'))
                continue
            y = src.get(s['id'])
            if y is None and s['category'].startswith('k_'):
                name = s['id'].split('/', 1)[1]
                for cand in kenney.get(name, []):
                    z = ff.pcm(cand, 1)[:, 0]
                    if match(ff, shipped, z)[0]:
                        y = z
                        break
            was_stereo = ff.channels(shipped) == 2 or s.get('mono')
            if y is None:
                kept += 1
                rows.append((s['id'], 'kept (no lossless source)'))
                continue
            ok, corr, db = match(ff, shipped, y if not (y.ndim == 2 and not was_stereo) else y.mean(1))
            if not ok:
                kept += 1
                rows.append((s['id'], f'kept (rebuilt source differs: r={corr:.3f}, {db:+.1f} dB)'))
                continue
            stereo = y.ndim == 2 and y.shape[1] == 2
            if stereo:
                side = (y[:, 0] - y[:, 1]) / 2
                r = 10 * math.log10(float((side.astype(np.float64) ** 2).sum()) / (float((y.astype(np.float64) ** 2).sum()) / 2 + 1e-12) + 1e-20)
                if r < NEAR_MONO_DB:
                    y = y.mean(1)
                    stereo = False
            if not stereo and y.ndim == 2:
                y = y.mean(1)
            cut0 = cut1 = 0.0
            if s['mode'] in ('shot', 'long'):
                y, cut0, cut1 = trim(y)
            kb, bw = opus_rate(y, stereo)
            wav = os.path.join(tmp, 'x.wav')
            ff.write_wav(wav, y)
            m4a = ogg[:-4] + '.m4a'
            ff.opus(wav, shipped, kb, 2 if stereo else 1)
            ff.aac(wav, os.path.join(AUD, 'sfx', m4a), round(kb * 1.5) if not stereo else 128, 2 if stereo else 1)
            s['files'] = [ogg, m4a]
            if was_stereo and not stereo:
                s['mono'] = True  # was a stereo take: up-mixed to two equal channels at playback (same panning as before)
            else:
                s.pop('mono', None)
            s['duration'] = round(len(y) / SR, 3)
            s['opus_kbps'] = kb
            json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)  # resumable: an interrupted run skips it
            rows.append((s['id'], f'{"stereo" if stereo else "mono"} {kb} kb/s (band {bw / 1000:.1f} kHz), r={corr:.3f}'
                         + (f', trimmed {cut0:.2f}+{cut1:.2f} s' if cut0 + cut1 > 0.001 else '')))
    for s in man['sounds']:
        s['bytes'] = sum(os.path.getsize(os.path.join(AUD, 'sfx', f)) for f in s['files'])
    json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)
    with open(os.path.join(args.log_dir or tempfile.gettempdir(), 'sfx_sources.log'), 'w') as f:
        for r in rows:
            f.write(f'{r[0]}: {r[1]}\n')
    print(f'sfx from sources: {len(rows) - kept} rebuilt, {kept} kept')


# ------------------------------------------------------------------------------------------------ voice
def do_voice(ff, args):
    man_p = os.path.join(AUD, 'voice', 'lines.json')
    man = json.load(open(man_p))
    from_master = 0
    n = 0

    def m4a_for(files):
        nonlocal from_master, n
        ogg = next(f for f in files if f.endswith('.ogg'))
        src = os.path.join(AUD, 'voice', ogg)
        master = os.path.join(args.scratch, 'voices', 'final', ogg[:-4] + '.wav')
        use = src
        if os.path.exists(master):
            a, b = ff.pcm(master, 1), ff.pcm(src, 1)
            if abs(len(a) - len(b)) < 0.03 * SR:
                use = master
                from_master += 1
        out = rel_mp3_to(ogg, '.m4a')
        ff.aac(use, os.path.join(AUD, 'voice', out), 40, 1, sr=24000)
        n += 1
        return [ogg, out]

    for l in man['lines']:
        if l.get('files'):
            l['files'] = m4a_for(l['files'])
        if l.get('alt'):
            l['alt'] = m4a_for(l['alt'])
    fmt = man.get('format')
    if isinstance(fmt, str):
        man['format'] = fmt.replace('[ogg,mp3]', '[ogg,m4a]').replace('ogg,mp3', 'ogg,m4a')
    json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)
    print(f'voice: {n} takes → m4a ({from_master} from WAV masters)')


# ------------------------------------------------------------------------------------------------ narration
LIM_CEIL, MAX_TP = -2.5, -1.0


def lim(ceil, sr):
    return f'aresample={sr * 4},alimiter=limit={10 ** (ceil / 20):.4f}:attack=1:release=60:level=0:latency=1,aresample={sr}'


def do_narration(ff, args):
    man_p = os.path.join(AUD, 'narration', 'manifest.json')
    man = json.load(open(man_p))
    proc = os.path.join(args.scratch, 'narr2', 'all', 'proc')
    lines = [(mid, l) for mid, v in man['missions'].items() for l in v['lines']] + [('tour', l) for l in man.get('tour', {}).get('lines', [])]
    worst, from_master = -99.0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for mid, l in lines:
            ogg = next(f for f in l['files'] if f.endswith('.ogg'))  # 'narration/m01/head.ogg'
            master = os.path.join(proc, f'{mid}_{l["id"]}.wav')
            src = os.path.join(AUD, ogg) if ogg.startswith('narration/') else os.path.join(AUD, 'narration', ogg)
            use = src
            if os.path.exists(master):
                with wave.open(master) as w:
                    dur = w.getnframes() / w.getframerate()
                if abs(dur - (l.get('duration') or dur)) < 0.06:
                    use = master
                    from_master += 1
            if use == src:  # re-encoding the old Opus: copy it aside first (it is overwritten)
                tmp_src = os.path.join(tmp, os.path.basename(src))
                shutil.copyfile(src, tmp_src)
                use = tmp_src
            out_ogg, out_m4a = src, src[:-4] + '.m4a'
            for codec in ('opus', 'aac'):
                dst = out_ogg if codec == 'opus' else out_m4a
                for ceil in (LIM_CEIL, LIM_CEIL - 1, LIM_CEIL - 2, LIM_CEIL - 3, LIM_CEIL - 4, LIM_CEIL - 5):
                    if codec == 'opus':
                        ff.opus(use, dst, 32, 1, af=lim(ceil, SR))
                    else:
                        ff.aac(use, dst, 40, 1, sr=24000, af=lim(ceil, 24000))
                    tp = ff.true_peak(dst)
                    if tp <= MAX_TP:
                        break
                worst = max(worst, tp)
            l['files'] = [ogg, ogg[:-4] + '.m4a']
    if isinstance(man.get('format'), str):
        man['format'] = man['format'].replace('files:[ogg,mp3]', 'files:[ogg,m4a]')
    json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)
    print(f'narration: {len(lines)} clips ({from_master} from WAV masters), worst true peak {worst:.2f} dBTP')


# ------------------------------------------------------------------------------------------------ music
def music_master(args, cid):
    for p in (os.path.join(args.scratch, 'music', 'a', 'cues', cid + '.wav'), os.path.join(args.scratch, 'music', 'now', 'out', cid + '.wav')):
        if os.path.exists(p):
            return p, True
    old = os.path.join(AUD, 'music', cid + '.ogg')
    return (old, False) if os.path.exists(old) else (None, False)


def splits(a, b, target=CHUNK_S * SR):
    """Region [a, b) in equal chunks of ≈ target samples: list of (start, end)."""
    if b <= a:
        return []
    k = max(1, round((b - a) / target))
    edges = [a + round(i * (b - a) / k) for i in range(k + 1)]
    return list(zip(edges[:-1], edges[1:]))


def do_music(ff, args):
    man_p = os.path.join(AUD, 'music', 'manifest.json')
    man = json.load(open(man_p))
    O = round(OVERLAP_S * SR)
    out_cues = {}
    with tempfile.TemporaryDirectory() as tmp:
        for cid, entry in man['cues'].items():
            src, lossless = music_master(args, cid)
            if not src:
                print(f'music: {cid}: no source, skipped')
                continue
            if not lossless:  # keep the old file aside: the cue's folder replaces it
                keep = os.path.join(tmp, cid + '.src.ogg')
                shutil.copyfile(src, keep)
                src = keep
            x = ff.pcm(src, 2)
            meta = man['meta'].get(cid, {})
            N = len(x)
            if meta.get('lengthSamples') and abs(meta['lengthSamples'] - N) > 2 and lossless:
                sys.exit(f'music: {cid}: master length {N} != manifest {meta["lengthSamples"]}')
            ls = round(meta['loopStart'] * SR) if meta.get('loopEnd', 0) > meta.get('loopStart', 0) else None
            le = round(meta['loopEnd'] * SR) if ls is not None else None
            regions = splits(0, ls) + splits(ls, le) + splits(le, N) if ls is not None else splits(0, N)
            body_last = next((k for k, (a, b) in enumerate(regions) if b == le), None) if ls is not None else None
            d = os.path.join(AUD, 'music', cid)
            if os.path.isdir(d):
                shutil.rmtree(d)
            os.makedirs(d)
            kb_opus, kb_aac = (96, 128) if lossless else (128, 160)
            chunks = []

            def write(name, seg):
                wav = os.path.join(tmp, f'{cid}_{name}.wav')
                ff.write_wav(wav, seg)
                ff.opus(wav, os.path.join(d, name + '.ogg'), kb_opus, 2)
                ff.aac(wav, os.path.join(d, name + '.m4a'), kb_aac, 2)
                os.remove(wav)

            for k, (a, b) in enumerate(regions):
                o = min(O, N - b)  # the next O samples (none after the last chunk)
                write(str(k), x[a:b + o])
                chunks.append({'f': f'{cid}/{k}', 't': round(a / SR, 6), 'd': round((b - a) / SR, 6), 'o': round(o / SR, 6)})
            wrap = None
            if body_last is not None:  # the loop: a short seam file = the end of the body, then the start of the body
                a, b = regions[body_last]
                S = round(SEAM_S * SR)
                assert b - a > S + O, f'{cid}: loop body chunk shorter than the seam'
                write(f'{body_last}w', np.concatenate([x[le - S:le], x[ls:ls + O]]))
                wrap = {'k': body_last, 'f': f'{cid}/{body_last}w', 's': round(S / SR, 6), 'o': round(O / SR, 6)}
            out_cues[cid] = {'chunks': chunks, **({'wrap': wrap} if wrap else {}), 'source': 'wav master' if lossless else 'vorbis q5 (no master)'}
            meta['lengthSamples'] = N
            meta.pop('mp3LeadSec', None)
            meta['aacDelay'] = AAC_DELAY
            for ext in ('ogg', 'mp3'):
                p = os.path.join(AUD, 'music', f'{cid}.{ext}')
                if os.path.exists(p) and not (ext == 'mp3' and args.keep_mp3):
                    os.remove(p)
            print(f'music: {cid}: {len(chunks)} chunks{" + seam" if wrap else ""} ({out_cues[cid]["source"]})')
    man['cues'] = out_cues
    man['version'] = 4
    man['note'] = ('Original compositions for SHADOW SIX (route A: MIDI score + VSCO 2 CE / VSCO 1 samples, CC0). cues[id] = '
                   '{chunks:[{f, t, d, o}], wrap?}: the cue as consecutive chunks, each `<f>.ogg` (Opus 96 kb/s) and `<f>.m4a` '
                   '(AAC 128 kb/s) from the 24-bit master (tools/audio/web_formats.py); t = start (s), d = length (s), o = the '
                   'next o s it also carries (consecutive chunks crossfade over it); wrap = {k, f, s, o} (looped cues): seam file f '
                   '= the last s s of the loop body (chunk k ends there) + the first o s of the body, crossfaded the same way. '
                   'Streamed by audio/music-stream.js: three or four chunks are decoded at a time. meta: loopStart/loopEnd (s) = loop body after a play-once intro; '
                   'once; endSec = where a start stinger hands over; decodeRate = decode Hz; gain = linear trim; category; '
                   'aacDelay = AAC priming samples (trimmed by the m4a edit list; the player checks the decoded length).')
    json.dump(man, open(man_p, 'w'), indent=1, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='music,narration,voice,sfx')
    ap.add_argument('--scratch', default=SCRATCH)
    ap.add_argument('--ffmpeg')
    ap.add_argument('--keep-mp3', action='store_true')
    ap.add_argument('--log-dir', default='')
    args = ap.parse_args()
    ff = FF(find_ffmpeg(args.ffmpeg))
    before = size(glob.glob(os.path.join(AUD, '**', '*.*'), recursive=True))
    only = set(args.only.split(','))
    if 'sfx' in only:
        do_sfx(ff, args)
    if 'sfxsrc' in only:
        do_sfx_sources(ff, args)
    if 'voice' in only:
        do_voice(ff, args)
    if 'narration' in only:
        do_narration(ff, args)
    if 'music' in only:
        do_music(ff, args)
    if not args.keep_mp3:
        for kind in only & {'music', 'narration', 'voice', 'sfx'}:
            for p in glob.glob(os.path.join(AUD, kind, '**', '*.mp3'), recursive=True):
                os.remove(p)
    after = size(glob.glob(os.path.join(AUD, '**', '*.*'), recursive=True))
    ogg = size(glob.glob(os.path.join(AUD, '**', '*.ogg'), recursive=True))
    m4a = size(glob.glob(os.path.join(AUD, '**', '*.m4a'), recursive=True))
    print(f'assets/audio: {before / 1e6:.1f} → {after / 1e6:.1f} MB (Opus set {ogg / 1e6:.1f} MB, AAC set {m4a / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
