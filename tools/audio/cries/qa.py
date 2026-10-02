# German pain cries, stage 4: QA of the shipped takes (WORK/master/<voice>/<rec>.wav and the packed .ogg).
# usage: qa.py WORK_DIR VOICE_DIR  -> WORK/qa.jsonl + a summary on stdout. Env: FFMPEG, WHISPER_DIR.
# Per take: duration, integrated loudness (EBU R128 on a looped copy), sample peak, clipped samples, clicks (a 1 ms
# frame above -60 dBFS whose 2nd difference is > 14 dB over its 30 ms neighbourhood median while the voice does not
# jump; the intended creak of the fry tails also counts, so a raw Chatterbox take scores about 0.5 per clip),
# voiced share and pitch movement (common.voicing-style autocorrelation), free-language Whisper (must hear no word),
# and the .ogg decode length vs the master.
import json, os, re, subprocess, sys
import numpy as np, soundfile as sf, librosa
from faster_whisper import WhisperModel
from pick import voicing, nonword

def lufs(y, sr, tmp):
    sf.write(tmp, np.tile(y, int(np.ceil(1.5 * sr / len(y)))) if len(y) < 1.5 * sr else y, sr)
    r = subprocess.run([os.environ['FFMPEG'], '-hide_banner', '-nostats', '-i', tmp, '-af', 'ebur128', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    m = re.findall(r'I:\s+(-?[\d.]+) LUFS', r); os.remove(tmp)
    return float(m[-1]) if m else None

def clicks(y, sr):
    d = np.diff(y, 2); h = int(0.001 * sr)
    e = np.array([np.mean(d[i:i + h] ** 2) for i in range(0, len(d) - h, h)]) + 1e-14
    v = np.array([np.mean(y[i:i + h] ** 2) for i in range(0, len(d) - h, h)]) + 1e-14
    n = 0
    for i in range(15, len(e) - 15):
        nb = np.median(e[i - 15:i + 15]); vb = np.median(v[i - 15:i + 15])
        if 10 * np.log10(e[i] / nb) > 14 and 10 * np.log10(v[i] / vb) < 6 and 10 * np.log10(v[i]) > -60: n += 1  # audible only
    return n

def main():
    work, vdir = sys.argv[1], sys.argv[2]
    asr = WhisperModel(os.environ['WHISPER_DIR'], device='cuda', compute_type='float16')
    rows = []
    for voice in sorted(os.listdir(f'{work}/master')):
        for f in sorted(os.listdir(f'{work}/master/{voice}')):
            rec = f[:-4]; y, sr = sf.read(f'{work}/master/{voice}/{f}', dtype='float32')
            y16 = librosa.resample(y, orig_sr=sr, target_sr=16000)
            vo, f0 = voicing(y16)
            segs, info = asr.transcribe(np.concatenate([np.zeros(4800, np.float32), y16, np.zeros(4800, np.float32)]), beam_size=5)
            heard = ' '.join(s.text for s in segs).strip()
            og, osr = librosa.load(f'{vdir}/{voice}/pain/{rec}.ogg', sr=None)
            r = dict(voice=voice, rec=rec, dur=round(len(y) / sr, 3), lufs=lufs(y, sr, f'{work}/_q.wav'),
                     peak_db=round(float(20 * np.log10(np.abs(y).max() + 1e-12)), 2), clipped=int((np.abs(y) >= 0.999).sum()),
                     clicks=clicks(y, sr), voiced=round(vo, 2), f0=round(float(np.median(f0)), 1) if len(f0) else 0,
                     heard=heard, nonword=nonword(heard), ogg_dur=round(len(og) / osr, 3),
                     ogg_kb=round(os.path.getsize(f'{vdir}/{voice}/pain/{rec}.ogg') / 1024, 1),
                     mp3_kb=round(os.path.getsize(f'{vdir}/{voice}/pain/{rec}.mp3') / 1024, 1))
            rows.append(r); print(json.dumps(r, ensure_ascii=False), flush=True)
    with open(f'{work}/qa.jsonl', 'w') as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    L = [r['lufs'] for r in rows if r['lufs'] is not None]
    print(f"takes {len(rows)}; LUFS {min(L):.1f}..{max(L):.1f}; max peak {max(r['peak_db'] for r in rows)} dBFS; clipped {sum(r['clipped'] for r in rows)}; "
          f"clicks {sum(r['clicks'] for r in rows)}; words heard {[r['rec'] + '@' + r['voice'] + ':' + r['heard'] for r in rows if not r['nonword']]}; "
          f"ogg {sum(r['ogg_kb'] for r in rows):.0f} KB, mp3 {sum(r['mp3_kb'] for r in rows):.0f} KB")

if __name__ == '__main__':
    main()
