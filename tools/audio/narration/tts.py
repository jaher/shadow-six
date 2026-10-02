# Newsreel narrator, stage 1: Kokoro-82M TTS of every briefing line, with word timings.
# usage: tts.py lines.json out_dir [only: mission ids or mission_line names, comma separated]
#   env NARR_SLOW: speed factor for a retry of clips that failed the speech-recognition check (e.g. 0.93)
#   lines.json from dump-text.mjs: {mission: [{id, text}]}  ->  out_dir/<mission>_<id>.wav (24 kHz) + .json (words)
# Voice (docs/narration.md): blend am_onyx .4 + bm_lewis .3 + am_eric .3, British G2P, speed 1.20,
# 0.05 s between sentences (the 'head' title card at 1.05). Pronunciation hints from pron.json are applied to the TTS input only.
# Env: KOKORO_DIR = local snapshot of hexgrad/Kokoro-82M (config.json, kokoro-v1_0.pth, voices/).
import json, os, re, sys
import numpy as np, soundfile as sf, torch
from kokoro import KModel, KPipeline

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.environ['KOKORO_DIR']
VOICE = 'am_onyx:.4+bm_lewis:.3+am_eric:.3'
SPEED, HEAD_SPEED, GAP, SR = 1.20, 1.05, 0.05, 24000  # the title card is declaimed a little slower
SLOW = float(os.environ.get('NARR_SLOW', '1'))
PRON = {k: v for k, v in json.load(open(os.path.join(HERE, 'pron.json'))).items() if k != '_'}
ORD = {1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth', 12: 'twelfth', 20: 'twentieth', 30: 'thirtieth'}
UNITS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']
TEENS = {10: 'tenth', 11: 'eleventh', 13: 'thirteenth', 14: 'fourteenth', 15: 'fifteenth', 16: 'sixteenth', 17: 'seventeenth', 18: 'eighteenth', 19: 'nineteenth'}


def ordinal(d):
    if d in ORD: return ORD[d]
    if d in TEENS: return TEENS[d]
    if d < 10: return UNITS[d]
    return {2: 'twenty', 3: 'thirty'}[d // 10] + '-' + UNITS[d % 10]


def speech_form(t):
    """Screen text -> what the TTS is given: dates read 'February the twentieth, 1941', phoneme hints marked."""
    t = re.sub(r'\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})',
               lambda m: f'{m[1]} the {ordinal(int(m[2]))}, {m[3]}', t)
    for w, ipa in PRON.items():
        t = re.sub(r'(?<![\w-])' + re.escape(w) + r'(?![\w-])', f'[{w}](/{ipa}/)', t)
    return t


def blend(spec):
    acc, tot = 0, 0
    for part in spec.split('+'):
        n, w = (part.split(':') + ['1'])[:2]
        acc = acc + torch.load(f'{K}/voices/{n}.pt', weights_only=True) * float(w); tot += float(w)
    return (acc / tot).float()


def main():
    lines, out = json.load(open(sys.argv[1])), sys.argv[2]
    only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else None
    os.makedirs(out, exist_ok=True)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = KModel(repo_id='hexgrad/Kokoro-82M', config=K + '/config.json', model=K + '/kokoro-v1_0.pth').to(dev).eval()
    pipe = KPipeline(lang_code='b', repo_id='hexgrad/Kokoro-82M', model=model)
    v = blend(VOICE)
    for mid, rows in lines.items():
        for row in rows:
            if only and mid not in only and f'{mid}_{row["id"]}' not in only: continue
            chunks, words, t = [], [], 0.0
            for r in pipe(speech_form(row['text']), voice=v, speed=(HEAD_SPEED if row['id'] == 'head' else SPEED) * SLOW, split_pattern=r'(?<=[.;!?])\s+'):
                a = r.audio.cpu().numpy()
                for tok in (r.tokens or []):
                    if tok.start_ts is not None and re.search(r'\w', tok.text):
                        words.append({'w': tok.text, 's': round(t + tok.start_ts, 3), 'e': round(t + (tok.end_ts or tok.start_ts), 3)})
                chunks += [a, np.zeros(int(SR * GAP), np.float32)]
                t += (len(a) + int(SR * GAP)) / SR
            base = f'{out}/{mid}_{row["id"]}'
            sf.write(base + '.wav', np.concatenate(chunks), SR, subtype='PCM_16')
            json.dump({'mission': mid, 'id': row['id'], 'text': row['text'], 'tts': speech_form(row['text']), 'words': words},
                      open(base + '.json', 'w'), ensure_ascii=False)
            print(mid, row['id'], round(t, 2), 's', len(words), 'words', flush=True)


if __name__ == '__main__':
    main()
