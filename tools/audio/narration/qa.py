# Newsreel narrator, stage 4: speech-recognition check of every processed clip against its on-screen text.
# usage: qa.py clips_dir out.json   (clips_dir holds <mission>_<id>.json from tts.py and <mission>_<id>.wav, processed)
# Env: WHISPER_DIR = a faster-whisper "small" model directory. Writes {clip: {wer, errors, words, hyp}}.
import json, os, re, sys, glob
import librosa
from num2words import num2words
from faster_whisper import WhisperModel


def numword(tok):
    m = re.fullmatch(r'(\d+)(st|nd|rd|th)?', tok)
    if not m: return tok
    n = int(m[1])
    if m[2]: return num2words(n, to='ordinal')
    if 1900 <= n <= 1999 and len(m[1]) == 4: return num2words(n, to='year')
    return num2words(n)


def norm(t):
    t = re.sub(r'\[([^\]]+)\]\(/[^)]*/\)', r'\1', t)  # drop phoneme hints
    t = t.lower().replace('’', "'").replace("'s", 's').replace("'", '')
    t = re.sub(r'(\d)([a-z])', r'\1 \2', re.sub(r'([a-z])(\d)', r'\1 \2', t))  # v2 -> v 2
    t = re.sub(r'(\d+) (st|nd|rd|th)\b', r'\1\2', t)
    toks = re.sub(r'[^a-z0-9àâçèéêëîïôûùüÿœæ]+', ' ', t).split()
    out = []
    for w in toks: out += re.sub(r'[^a-z ]', ' ', numword(w).replace('-', ' ')).split() if w[0].isdigit() else [w]
    return [w for w in out if w not in ('the', 'and', 'a')]  # function words the recogniser drops at random


def errors(r, h):
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        p = d[:]; d[0] = i
        for j in range(1, len(h) + 1): d[j] = min(p[j] + 1, d[j - 1] + 1, p[j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(h)]


def main():
    clips, out = sys.argv[1], sys.argv[2]
    asr = WhisperModel(os.environ['WHISPER_DIR'], device=os.environ.get('QA_DEVICE', 'cuda'), compute_type='float16' if os.environ.get('QA_DEVICE', 'cuda') == 'cuda' else 'int8')
    res = json.load(open(out)) if os.path.exists(out) else {}
    for meta in sorted(glob.glob(f'{clips}/*.json')):
        name = os.path.basename(meta)[:-5]
        wav = f'{clips}/{name}.wav'
        if not os.path.exists(wav): continue
        m = json.load(open(meta))
        y, _ = librosa.load(wav, sr=16000)
        segs, _ = asr.transcribe(y, language='en', beam_size=5, condition_on_previous_text=False)
        hyp = ' '.join(s.text for s in segs).strip()
        # compounds: 'north-west' / 'northwest' both count as right
        r, h = norm(m['tts']), norm(hyp)
        joined = {a + b: [a, b] for a, b in zip(r, r[1:])}  # hyp 'northwest' for ref 'north west'
        h = [x for w in h for x in joined.get(w, [w])]
        rset, k, hh = set(r), 0, []  # hyp 'auto gyro' for ref 'autogyro'
        while k < len(h):
            if k + 1 < len(h) and h[k] + h[k + 1] in rset and h[k] not in rset: hh.append(h[k] + h[k + 1]); k += 2
            else: hh.append(h[k]); k += 1
        h = hh
        e = errors(r, h)
        res[name] = {'wer': round(e / max(1, len(r)), 3), 'errors': e, 'words': len(r), 'hyp': hyp}
        print(name, res[name]['wer'], e, '/', len(r), flush=True)
        json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
