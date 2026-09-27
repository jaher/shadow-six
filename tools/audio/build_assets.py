"""Build the shipped audio set (assets/audio/) from the verified R&D outputs (docs/realism-pipeline.md §1.5).

    python3 tools/audio/build_assets.py [--scratch DIR] [--ffmpeg PATH]

Inputs (the R&D scratchpad; restore from commandos-rnd-backup if /tmp was cleared):
    realism/audio/out/web/sfx/   sfx_build.py output: 512 CC0 files + manifest.json (Freesound CC0 + Kenney CC0)
    voices/final/ + manifest.json  Kokoro-82M (Apache-2.0) / Chatterbox (MIT) barks with word/viseme timing
Outputs:
    assets/audio/sfx/manifest.json + <category>/*.{ogg,mp3}   one-shots, loops, streamed beds (mode 'bed')
    assets/audio/voice/lines.json + <speaker>/<take>/*.{ogg,mp3,json}
    assets/audio/CREDITS.md                                     one row per shipped source sound
Licence gate (realism-pipeline v2 §1.5.1 "Provenance rejects"): EXCLUDE_IDS never ship.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from procedural_beds import BEDS as PROC_BEDS, SR  # noqa: E402

EXCLUDE_IDS = {
    177556: 'Hugofski: derived from CC BY-NC 4.0 / CC BY 3.0 sources the uploader could not relicense',
    410442: 'SuperPhat Lee-Enfield: "stacked" recordings, source unstated (uncertain provenance)',
    387508: 'morganpurkis MG42: edit of Day of Infamy game SFX',
    390663: 'morganpurkis SMG: edit of Day of Infamy game SFX',
}
SKIP_CATEGORIES = {'morse', 'radio_static', 'shell_casings', 'kenney:voiceover-pack'}  # unused in BEL missions
BED_CATEGORIES = {'birds', 'crickets', 'wind_desert', 'wind_snow', 'artillery_period'}  # streamed, never decoded
STEP_MAX_S = 1.3  # single footfalls only (the multi-step takes would double-trigger)
# Kenney file prefix → shipped category (only what the game maps; see src/audio/manifest.js ALIASES).
KENNEY = {
    'footstep_concrete': 'k_step_concrete', 'footstep_grass': 'k_step_grass', 'footstep_snow': 'k_step_snow',
    'footstep_wood': 'k_step_wood', 'impactMetal_light': 'k_hit_metal', 'impactWood_light': 'k_hit_wood',
    'impactSoft_medium': 'k_hit_soft', 'impactPunch_medium': 'k_hit_flesh', 'impactPlate_heavy': 'k_barrel_set',
    'impactWood_heavy': 'k_thud_wood', 'impactMining': 'k_dig', 'impactGlass_light': 'k_glass',
    'cloth': 'k_cloth', 'creak': 'k_creak', 'doorOpen': 'k_door_open', 'doorClose': 'k_door_close',
    'knifeSlice': 'k_knife', 'drawKnife': 'k_draw', 'metalClick': 'k_metal_click', 'metalLatch': 'k_metal_latch',
    'beltHandle': 'k_belt', 'bookFlip': 'k_page', 'bookOpen': 'k_book_open', 'bookPlace': 'k_stamp',
    'dropLeather': 'k_drop_leather', 'handleSmallLeather': 'k_pouch',
    'select': 'k_ui_select', 'error': 'k_ui_error', 'toggle': 'k_ui_toggle', 'switch': 'k_ui_switch',
    'tick': 'k_ui_tick', 'scratch': 'k_ui_scratch', 'confirmation': 'k_ui_confirm', 'click': 'k_ui_click',
}
VOICE_SPEAKERS = {'green_beret': 'greenberet', 'sniper': 'sniper', 'marine': 'diver', 'sapper': 'sapper',
                  'driver': 'driver', 'spy': 'spy', 'german_1': 'ger', 'german_2': 'ger', 'german_3': 'ger'}


def find_ffmpeg(arg):
    for c in [arg, os.environ.get('FFMPEG'), shutil.which('ffmpeg')]:
        if c and os.path.exists(c):
            return c
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    root = os.path.expanduser('~/.cache/uv/archive-v0')
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.startswith('ffmpeg-linux') and 'imageio_ffmpeg' in d:
                return os.path.join(d, f)
    sys.exit('ffmpeg not found (pip install imageio-ffmpeg, or pass --ffmpeg)')


class Enc:
    def __init__(self, ff):
        self.ff = ff

    def run(self, *args):
        subprocess.run([self.ff, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)

    def encode(self, src, dst_base, stereo=False, kbps=None):
        """src (any format) → dst_base.ogg (Opus) + dst_base.mp3; returns [ogg, mp3] basenames."""
        ch = '2' if stereo else '1'
        ob = kbps or (96 if stereo else 64)
        self.run('-i', src, '-ac', ch, '-ar', '48000', '-c:a', 'libopus', '-b:a', f'{ob}k', '-vbr', 'on', dst_base + '.ogg')
        self.run('-i', src, '-ac', ch, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', f'{ob + (32 if stereo else 0)}k', dst_base + '.mp3')
        return [os.path.basename(dst_base) + '.ogg', os.path.basename(dst_base) + '.mp3']

    def decode(self, src):
        p = subprocess.run([self.ff, '-hide_banner', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(SR),
                            '-f', 'f32le', '-'], check=True, capture_output=True)
        return np.frombuffer(p.stdout, dtype=np.float32)

    def write_wav(self, path, x):
        """float (n,) or (n,2) → 16-bit wav through ffmpeg (no scipy dependency)."""
        x = np.asarray(x, dtype=np.float32)
        ch = 1 if x.ndim == 1 else x.shape[1]
        raw = path + '.f32'
        x.tofile(raw)
        self.run('-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', raw, path)
        os.remove(raw)


def kenney_category(path):
    name = os.path.basename(path).rsplit('.', 1)[0]
    stem = name.rstrip('0123456789').rstrip('_')
    return KENNEY.get(stem), name


def build_sfx(src, out, enc, credits):
    man = json.load(open(os.path.join(src, 'manifest.json')))
    sounds, dropped = [], []
    for s in man['sounds']:
        cat, sid = s['category'], (s.get('source') or {}).get('id')
        if cat in SKIP_CATEGORIES:
            continue
        if sid in EXCLUDE_IDS:
            dropped.append((s['id'], EXCLUDE_IDS[sid]))
            continue
        if cat.startswith('fs_') and (s.get('duration') or 0) > STEP_MAX_S:
            continue
        ogg = next(f for f in s['files'] if f.endswith('.ogg'))
        if cat.startswith('kenney'):
            kcat, name = kenney_category(ogg)
            if not kcat:
                continue
            os.makedirs(os.path.join(out, kcat), exist_ok=True)
            files = enc.encode(os.path.join(src, ogg), os.path.join(out, kcat, name))
            e = {'id': f'{kcat}/{name}', 'category': kcat, 'mode': 'shot', 'files': [f'{kcat}/{f}' for f in files]}
        else:
            os.makedirs(os.path.join(out, cat), exist_ok=True)
            files = []
            for f in s['files']:
                shutil.copyfile(os.path.join(src, f), os.path.join(out, f))
                files.append(f)
            if not any(f.endswith('.mp3') for f in files):
                base = os.path.join(out, ogg[:-4])
                enc.run('-i', os.path.join(src, ogg), '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', base + '.mp3')
                files.append(ogg[:-4] + '.mp3')
            mode = 'bed' if cat in BED_CATEGORIES else s['mode']
            e = {'id': s['id'], 'category': cat, 'mode': mode, 'files': files, 'loop': mode in ('loop', 'bed')}
        e['duration'] = s.get('duration')
        e['source'] = s['source']
        sounds.append(e)
        credits.append(s['source'])
    return sounds, dropped


def build_ticks(out, enc, src_ogg, source, credits):
    """Single clockwork ticks cut from a CC0 ticking loop (one tick per bomb_tick request, 2→4 Hz)."""
    x = enc.decode(src_ogg)
    env = np.convolve(np.abs(x), np.ones(96) / 96, 'same')
    thr = 0.35 * env.max()
    onsets, last = [], -SR
    for i in np.flatnonzero((env[1:] >= thr) & (env[:-1] < thr)):
        if i - last > 0.12 * SR:
            onsets.append(int(i))
            last = i
    os.makedirs(os.path.join(out, 'bomb_tick1'), exist_ok=True)
    sounds = []
    with tempfile.TemporaryDirectory() as tmp:
        for k, o in enumerate(onsets[:4]):
            a = max(0, o - int(0.004 * SR))
            seg = x[a:a + int(0.11 * SR)].copy()
            seg *= np.minimum(1, np.linspace(1.6, 0, len(seg))) ** 2
            seg *= 0.89 / (np.abs(seg).max() + 1e-9)
            wav = os.path.join(tmp, f'{k}.wav')
            enc.write_wav(wav, seg)
            name = f'bomb_tick1_{source["id"]}_{k}'
            files = enc.encode(wav, os.path.join(out, 'bomb_tick1', name))
            sounds.append({'id': f'bomb_tick1/{name}', 'category': 'bomb_tick1', 'mode': 'shot', 'duration': 0.11,
                           'files': [f'bomb_tick1/{f}' for f in files], 'source': {**source, 'note': 'single ticks cut from the loop'}})
    return sounds


def build_proc_beds(out, enc, credits):
    sounds = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, (fn, desc) in PROC_BEDS.items():
            x = fn()
            wav = os.path.join(tmp, name + '.wav')
            enc.write_wav(wav, x)
            os.makedirs(os.path.join(out, name), exist_ok=True)
            files = enc.encode(wav, os.path.join(out, name, f'{name}_proc_0'), stereo=True)
            src = {'site': 'project', 'title': desc, 'author': 'SHADOW SIX contributors (tools/audio/procedural_beds.py)',
                   'license': 'CC0-1.0', 'url': 'tools/audio/procedural_beds.py'}
            sounds.append({'id': f'{name}/{name}_proc_0', 'category': name, 'mode': 'bed', 'loop': True,
                           'duration': round(len(x) / SR, 3), 'files': [f'{name}/{f}' for f in files], 'source': src})
            credits.append(src)
    return sounds


def build_voices(src, out, credits):
    man = json.load(open(os.path.join(src, 'manifest.json')))
    base = os.path.join(src, man['format'].get('base', 'final/')) if not os.path.isdir(os.path.join(src, 'green_beret')) else src
    if not os.path.isdir(base):
        base = os.path.join(src, 'final')
    lines = []
    for char, c in man['characters'].items():
        speaker = VOICE_SPEAKERS.get(char)
        if not speaker:
            continue
        voice = int(char.rsplit('_', 1)[1]) if speaker == 'ger' else 1
        prim = c['files'].get('primary', {})
        alt = c['files'].get('alt', {})
        for rec, f in prim.items():
            row = {'speaker': speaker, 'voice': voice, 'rec': rec, 'text': f['text'], 'lang': c.get('lang', 'en'),
                   'duration': f.get('duration'), 'asr_sim': (f.get('qa') or {}).get('asr_sim')}
            for take, ff in (('primary', f), ('alt', alt.get(rec))):
                if not ff:
                    continue
                d = os.path.join(out, char, take)
                os.makedirs(d, exist_ok=True)
                for k in ('ogg', 'mp3', 'timing'):
                    shutil.copyfile(os.path.join(base, ff[k]), os.path.join(d, os.path.basename(ff[k])))
                key = 'files' if take == 'primary' else 'alt'
                row[key] = [f'{char}/{take}/{os.path.basename(ff["ogg"])}', f'{char}/{take}/{os.path.basename(ff["mp3"])}']
                if take == 'primary':
                    row['timing'] = f'{char}/{take}/{os.path.basename(ff["timing"])}'
            lines.append(row)
        credits.append({'site': 'tts', 'title': f'{c["name"]}: {c.get("voice", "")}', 'author': 'SHADOW SIX (TTS)',
                        'license': 'project output of Apache-2.0 / MIT models', 'url': 'docs/realism-pipeline.md §1.5.2'})
    return {'format': 'rec lines: {speaker, voice, rec, text, files:[ogg,mp3], alt?, timing}; see src/audio/voice-lines.js REC',
            'engines': man.get('licenses', {}), 'lines': lines}


def write_credits(path, sfx_sounds, dropped):
    by = {}
    for s in sfx_sounds:
        src = s['source']
        k = src.get('url')
        r = by.setdefault(k, {'src': src, 'cats': set(), 'n': 0})
        r['cats'].add(s['category'])
        r['n'] += 1
    L = ['# Audio credits (generated by tools/audio/build_assets.py)', '',
         'Every shipped sound, one row per source recording. All sources are CC0-1.0 (Freesound pages were',
         're-checked live on 2026-09-26, including the description for derived material) or project output.',
         'Freesound files are the HQ previews, trimmed / split / loudness-normalised and re-encoded to Opus + MP3.', '',
         '| Categories | Files | Title | Author | Source | Licence |', '| --- | --- | --- | --- | --- | --- |']
    for k, r in sorted(by.items(), key=lambda kv: sorted(kv[1]['cats'])[0]):
        s = r['src']
        note = ''
        if s.get('author') == 'craigsmith':
            note = ' (1930s-40s Hollywood nitrate FX library donated to USC, released CC0)'
        if s.get('author') == 'qubodup' and 'sniper' in ''.join(r['cats']):
            note = ' (from US-military public-domain video, DVIDS)'
        title = str(s.get('title', '')).replace('|', '/')
        L.append(f"| {', '.join(sorted(r['cats']))} | {r['n']} | {title}{note} | {s.get('author', '')} | {k} | {s.get('license', '')} |")
    L += ['', '## Voices', '',
          'AI-generated with Kokoro-82M (hexgrad, Apache-2.0) and Chatterbox-Multilingual (Resemble AI, MIT; outputs',
          'carry an imperceptible PerTh watermark). No real person was cloned: English timbres are stock or blended',
          'Kokoro voicepacks; German guards use Chatterbox\'s built-in synthetic voice (B and C tape-shifted).',
          'Offline tools (not shipped): misaki G2P (Apache-2.0), espeak-ng (GPL-3.0), wav2vec2 alignment (Apache-2.0),',
          'faster-whisper QA (MIT), ffmpeg (imageio-ffmpeg static build).', '',
          '## Excluded (licence / provenance gate, realism-pipeline v2 §1.5.1)', '']
    L += [f'- `{i}`: {why}' for i, why in dropped] or ['- none']
    open(path, 'w').write('\n'.join(L) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scratch', default='<claude-tmp>')
    ap.add_argument('--ffmpeg')
    a = ap.parse_args()
    enc = Enc(find_ffmpeg(a.ffmpeg))
    out = os.path.join(REPO, 'assets', 'audio')
    sfx_src = os.path.join(a.scratch, 'realism/audio/out/web/sfx')
    for d in ('sfx', 'voice'):
        shutil.rmtree(os.path.join(out, d), ignore_errors=True)
        os.makedirs(os.path.join(out, d))
    credits = []
    sounds, dropped = build_sfx(sfx_src, os.path.join(out, 'sfx'), enc, credits)
    tick = next(s for s in sounds if s['category'] == 'bomb_tick' and '487730' in s['id'])
    sounds += build_ticks(os.path.join(out, 'sfx'), enc, os.path.join(sfx_src, tick['files'][0]), tick['source'], credits)
    sounds = [s for s in sounds if s['category'] != 'bomb_tick']  # the loops are replaced by single ticks
    shutil.rmtree(os.path.join(out, 'sfx', 'bomb_tick'), ignore_errors=True)
    sounds += build_proc_beds(os.path.join(out, 'sfx'), enc, credits)
    for s in sounds:
        s['bytes'] = sum(os.path.getsize(os.path.join(out, 'sfx', f)) for f in s['files'])
    json.dump({'generated_by': 'tools/audio/build_assets.py', 'sounds': sounds},
              open(os.path.join(out, 'sfx', 'manifest.json'), 'w'), indent=1)
    vox = build_voices(os.path.join(a.scratch, 'voices'), os.path.join(out, 'voice'), credits)
    json.dump(vox, open(os.path.join(out, 'voice', 'lines.json'), 'w'), indent=1, ensure_ascii=False)
    write_credits(os.path.join(out, 'CREDITS.md'), sounds, dropped)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(out) for f in fs)
    print(f'sfx {len(sounds)} sounds, voices {len(vox["lines"])} lines, dropped {len(dropped)}, total {tot / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
