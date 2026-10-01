"""Gate smash one-shots (design-spec §3.7 ramming addendum): fetch the CC0 Freesound HQ previews, cut single takes,
loudness-normalise, encode Opus + MP3 into assets/audio/sfx/<category>/ and register them in the sfx manifest and
assets/audio/CREDITS.md (idempotent: re-running replaces this script's own entries).

    python3 tools/audio/gate_smash_sfx.py [--ffmpeg PATH] [--cache DIR]

Categories: gate_splinter (breaking / splintering wooden posts, a chair smashed), gate_debris (planks tossed down).
Licences were checked on the live Freesound pages (2026-09-27): all CC0-1.0.
"""
import argparse, json, os, subprocess, tempfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SFX = os.path.join(REPO, 'assets', 'audio', 'sfx')
CC0 = ('CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/')
USC = ' (1930s-40s Hollywood nitrate FX library donated to USC, released CC0)'

# (category, freesound id, author, title, preview path, [(start s, end s), ...])
SOURCES = [
    ('gate_splinter', 481936, 'craigsmith', 'R29-30-Breaking Wooden Poles.wav' + USC, '481/481936_2524442',
     [(2.08, 4.4), (5.45, 7.1), (16.3, 17.6), (18.47, 20.6)]),
    ('gate_splinter', 438322, 'craigsmith', 'G26-05-Wooden Chair Break.wav' + USC, '438/438322_2524442', [(0.0, 2.6)]),
    ('gate_debris', 589866, 'TheLittleCrow', 'Wooden Planks Dropping on Concrete, Breaking Wood', '589/589866_5672786',
     [(0.62, 1.4), (2.86, 4.15), (5.3, 6.08), (8.43, 9.05), (10.75, 11.33), (12.41, 13.0), (13.78, 14.43)]),
]


def ffmpeg_path(arg):
    for c in [arg, os.environ.get('FFMPEG')]:
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
    raise SystemExit('ffmpeg not found')


def run(ff, *args):
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ffmpeg')
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'gate_smash_sfx'))
    a = ap.parse_args()
    ff = ffmpeg_path(a.ffmpeg)
    os.makedirs(a.cache, exist_ok=True)
    man_path = os.path.join(SFX, 'manifest.json')
    man = json.load(open(man_path))
    cats = {s[0] for s in SOURCES}
    man['sounds'] = [s for s in man['sounds'] if s['category'] not in cats]
    rows = []
    for cat, sid, author, title, prev, takes in SOURCES:
        url = f'https://cdn.freesound.org/previews/{prev}-hq.mp3'
        src = os.path.join(a.cache, f'{sid}.mp3')
        if not os.path.exists(src):
            urllib.request.urlretrieve(url, src)
        os.makedirs(os.path.join(SFX, cat), exist_ok=True)
        for k, (t0, t1) in enumerate(takes):
            base = os.path.join(SFX, cat, f'{cat}_{sid}_{k}')
            dur = round(t1 - t0, 3)
            wav = os.path.join(a.cache, f'{cat}_{sid}_{k}.wav')
            fade = min(0.35, dur * 0.3)
            # cut the take, high-pass the tape rumble, short fades, loudness-normalise (one-shot level)
            run(ff, '-ss', str(t0), '-t', str(dur), '-i', src, '-af',
                f'highpass=f=70,afade=t=in:d=0.006,afade=t=out:st={dur - fade:.3f}:d={fade:.3f},loudnorm=I=-16:TP=-1.5:LRA=11',
                '-ac', '1', '-ar', '48000', wav)
            run(ff, '-i', wav, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', base + '.ogg')
            run(ff, '-i', wav, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', base + '.mp3')
            rel = f'{cat}/{cat}_{sid}_{k}'
            man['sounds'].append({
                'id': rel, 'category': cat, 'mode': 'shot', 'files': [rel + '.ogg', rel + '.mp3'], 'loop': False, 'duration': dur,
                'source': {'site': 'freesound.org', 'id': sid, 'title': title, 'author': author,
                           'url': f'https://freesound.org/people/{author}/sounds/{sid}/', 'license': CC0[0], 'license_url': CC0[1],
                           'fetched': url, 'note': 'HQ preview (no-login CDN) of CC0 sound; take cut + loudness-normalised by tools/audio/gate_smash_sfx.py'},
                'bytes': os.path.getsize(base + '.ogg'),
            })
        rows.append(f'| {cat} | {len(takes)} | {title} | {author} | https://freesound.org/people/{author}/sounds/{sid}/ | CC0-1.0 |')
    json.dump(man, open(man_path, 'w'), indent=1)
    # assets/audio/CREDITS.md: replace this script's rows (inserted in category order)
    cred_path = os.path.join(REPO, 'assets', 'audio', 'CREDITS.md')
    lines = open(cred_path).read().split('\n')
    lines = [l for l in lines if not any(l.startswith(f'| {c} |') for c in cats)]
    head = next(i for i, l in enumerate(lines) if l.startswith('| --- |'))
    end = head + 1
    while end < len(lines) and lines[end].startswith('| '):
        end += 1
    table = lines[head + 1:end]
    for r in rows:  # insert in category order, existing rows untouched
        cat = r.split('|')[1].strip()
        at = next((i for i, l in enumerate(table) if l.split('|')[1].strip() > cat), len(table))
        while at < len(table) and table[at].split('|')[1].strip() == cat:
            at += 1
        table.insert(at, r)
    open(cred_path, 'w').write('\n'.join(lines[:head + 1] + table + lines[end:]))
    print(f'{sum(len(s[5]) for s in SOURCES)} takes written ({", ".join(sorted(cats))})')


if __name__ == '__main__':
    main()
