# German pain cries, stage 1: Chatterbox-Multilingual (language_id=de) candidates for each German guard voice.
# Pipeline (2026-10-01, 906 candidates -> 39 shipped takes): gen.py WORK 8; gen.py WORK 20 all stab; gen.py WORK 14 all
#   shot,blast,ko -> pick.py WORK -> post.py WORK assets/audio/voice -> qa.py WORK assets/audio/voice.
#   PY (gen/pick/post/qa): torch + chatterbox-tts + faster-whisper + librosa + scipy; PM_PY: praat-parselmouth + soundfile.
# usage: gen.py WORK_DIR [N=8] [voice,voice|all] [cat,cat]   ->  WORK/cand/<voice>/<cat>_<prompt>_<k>.wav (24 kHz) + WORK/cand/index.json
# Env: CB_DIR = local snapshot of ResembleAI/chatterbox (t3_mtl23ls_v2, s3gen, ve, conds.pt);
#      DE_REFS = folder with de_low.wav / de_high.wav: the v1 voice set's references (renders of Chatterbox's own builtin
#      German voice, tape-shifted -3 / +2 semitones). No real person is cloned: german_1 IS the builtin voice, german_2/3
#      clone only those synthetic renders (as their barks do; CREDITS.md voice line). Then pick.py, then post.py.
# Same engine and settings family as the guards' barks (v1: exag 0.7 / 0.75 / 0.7) and the commandos' pain grunts (v2:
# exag 0.9, cfg 0.3): high exaggeration + low cfg give the model room for a raw, non-verbal cry.
import copy, json, os, sys, time
os.environ.setdefault('TQDM_DISABLE', '1')
import numpy as np, soundfile as sf, torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

VOICES = {  # the three guards of assets/audio/voice/german_{1,2,3} (v1 cast.py)
    'german_1': dict(ref=None, exag=0.95),        # soldier A: Chatterbox builtin German voice
    'german_2': dict(ref='de_low', exag=1.0),     # NCO B: low, gravelly
    'german_3': dict(ref='de_high', exag=0.95),   # private C: young, high
}
# category -> [(prompt id, text, target active seconds)]. German interjections a 1940s soldier would make: a stab is a
# short shocked cry that the knife cuts off, a bullet a pained shout, a blast a scream, a knock-out the wind knocked out.
PROMPTS = {
    'stab': [('agh', 'Agh!', 0.45), ('ah', 'Ah!', 0.45), ('uh', 'Uhh!', 0.5), ('ach', 'Ach!', 0.45), ('hk', 'Hkk!', 0.35), ('au', 'Au!', 0.4)],
    'shot': [('aagh', 'Aagh!', 0.6), ('argh', 'Argh!', 0.6), ('auu', 'Auuh!', 0.6), ('ugh', 'Ugh!', 0.5)],
    'blast': [('aaargh', 'Aaaargh!', 0.95), ('aaah', 'Aaaaah!', 0.95), ('waah', 'Waaah!', 0.9), ('ahhh', 'Ahhhhhhh!', 1.0),
              ('uaah', 'Uaaaaah!', 0.95)],
    'ko': [('umpf', 'Umpf!', 0.3), ('uff', 'Uff!', 0.3), ('hmpf', 'Hmpf!', 0.3), ('oh', 'Ohh…', 0.45)],
}

def main():
    work = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] != 'all' else set(VOICES)
    cats = set(sys.argv[4].split(',')) if len(sys.argv) > 4 else set(PROMPTS)
    m = ChatterboxMultilingualTTS.from_local(os.environ['CB_DIR'], 'cuda'); builtin = copy.deepcopy(m.conds)
    idx_path = f'{work}/cand/index.json'
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    done = {r['file'] for r in index}; t0 = time.time()
    for v, cfg in VOICES.items():
        if v not in only: continue
        if cfg['ref']: m.prepare_conditionals(f"{os.environ['DE_REFS']}/{cfg['ref']}.wav", exaggeration=cfg['exag'])
        else: m.conds = copy.deepcopy(builtin)
        for cat, prompts in PROMPTS.items():
            if cat not in cats: continue
            for pid, text, tgt in prompts:
                for k in range(N):
                    rel = f'cand/{v}/{cat}_{pid}_{k}.wav'
                    if rel in done: continue
                    torch.manual_seed(7919 * k + 31 * len(text) + ord(pid[0]))
                    w = m.generate(text, language_id='de', exaggeration=cfg['exag'], cfg_weight=0.3, temperature=0.8)
                    w = w.squeeze().cpu().numpy().astype(np.float32)
                    os.makedirs(f'{work}/cand/{v}', exist_ok=True); sf.write(f'{work}/{rel}', w, m.sr, subtype='PCM_16')
                    index.append(dict(file=rel, voice=v, cat=cat, prompt=pid, text=text, target=tgt, k=k, sr=m.sr,
                                      exag=cfg['exag'], cfg=0.3, temp=0.8, ref=cfg['ref'] or 'builtin'))
            json.dump(index, open(idx_path, 'w'), indent=0)
            print(v, cat, f'{time.time() - t0:.0f}s', flush=True)
    json.dump(index, open(idx_path, 'w'), indent=0)

if __name__ == '__main__':
    main()
