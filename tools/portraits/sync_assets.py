#!/usr/bin/env python3
"""Copy the HUD tier of the talking-portrait set (docs/talking-portraits.md §2) into assets/portraits/.

  python3 tools/portraits/sync_assets.py [SRC_CLIPS_DIR]

SRC defaults to the faces pipeline output (faces/final/clips/ in the scratchpad).  Ships only the 256 px tier:
<char>/<clip>_256.{webm,mp4,jpg} for every line, its urgent `alt` take, `idle` and `talk_loop`; the 512 px
tier, 1024 stills, raw renders and keys stay in the pipeline.  Voices are not duplicated: the game's audio pack
(assets/audio/voice/<char>/{primary,alt}/<line>.ogg) holds byte-identical files, so manifest voice paths point
there (checked by hash; a mismatching file is copied into <char>/voice/ instead).  Writes manifest.json (sizes
[256]) and LICENSES.json.  Idempotent.
"""
import hashlib, json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SP = '<claude-tmp>'
SRC = sys.argv[1] if len(sys.argv) > 1 else f'{SP}/faces/final/clips'
DST = f'{ROOT}/assets/portraits'
VOICE = f'{ROOT}/assets/audio/voice'
SIZE = 256


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest() if os.path.exists(p) else None


def copy(rel):
    s, d = f'{SRC}/{rel}', f'{DST}/{rel}'
    if not os.path.exists(s): raise SystemExit(f'missing {s}')
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if md5(s) != md5(d): shutil.copyfile(s, d)
    return os.path.getsize(d)


def clip(info):
    """copy one clip's 256 tier; returns the trimmed manifest entry"""
    base = info['clip'].replace('{size}', str(SIZE))
    n = sum(copy(f'{base}.{ext}') for ext in ('webm', 'mp4', 'jpg'))
    out = {k: v for k, v in info.items() if k not in ('kb', 'voice', 'voice_mp3', 'alt')}
    out['kb'] = {str(SIZE): info['kb'][str(SIZE)]}
    return out, n


def voice(char, take, line, info, out):
    """point the entry's voice at the audio pack when identical, else ship a copy"""
    for key, ext in (('voice', 'ogg'), ('voice_mp3', 'mp3')):
        if key not in info: continue
        pack = f'{VOICE}/{char}/{take}/{line}.{ext}'
        if md5(pack) and md5(pack) == md5(f"{SRC}/{info[key]}"):
            out[key] = f'../audio/voice/{char}/{take}/{line}.{ext}'
        else:
            copy(info[key]); out[key] = info[key]


def main():
    man = json.load(open(f'{SRC}/manifest.json'))
    total, nclips = 0, 0
    for c, e in man['characters'].items():
        e.pop('still', None)
        for k in ('idle', 'talk_loop'):
            e[k], n = clip(e[k]); total += n; nclips += 1
        for ln, info in e['lines'].items():
            out, n = clip(info); total += n; nclips += 1
            voice(c, 'primary', ln, info, out)
            if info.get('alt'):
                a, n = clip(info['alt']); total += n; nclips += 1
                voice(c, 'alt', ln, info['alt'], a)
                out['alt'] = a
            e['lines'][ln] = out
    man['sizes'] = [SIZE]
    man['note'] = man['note'].replace('256 (HUD) or 512 (character select)', f'{SIZE} (HUD tier; 512 stays in the faces pipeline)')
    man['voices'] = 'voice paths are relative to this folder; ../audio/voice/ = the audio pack (identical files)'
    json.dump(man, open(f'{DST}/manifest.json', 'w'), indent=1)
    if os.path.exists(f'{SRC}/licenses.json'): shutil.copyfile(f'{SRC}/licenses.json', f'{DST}/LICENSES.json')
    print(f'{nclips} clips, {total / 1e6:.2f} MB -> {DST}')


if __name__ == '__main__':
    main()
