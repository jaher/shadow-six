# assets/audio — recorded sounds and voices

Built by `python3 tools/audio/build_assets.py` (about 5 s; needs numpy and an ffmpeg with libopus and
libmp3lame, found through `--ffmpeg`, `$FFMPEG`, `PATH` or imageio-ffmpeg). It reads the verified R&D outputs
(realism-pipeline v2 §1.5) and writes everything here. Do not hand-edit the generated files; change the
script and re-run it. Anything the manifests do not cover falls back to the procedural placeholders in
`src/audio/synth.js`. Total size ≈ 17 MB (budget 60 MB). Credits for every file: `CREDITS.md`.

## SFX: `sfx/manifest.json`
```json
{ "sounds": [ { "id": "fs_snow/fs_snow_432285_0", "category": "fs_snow", "mode": "shot",
                "files": ["fs_snow/fs_snow_432285_0.ogg", "fs_snow/fs_snow_432285_0.mp3"],
                "duration": 0.8, "bytes": 12000, "source": { "site": "freesound.org", "id": 432285, "author": "…",
                "url": "…", "license": "CC0-1.0" } } ] }
```
- Every sound has an Opus-in-OGG file and an MP3 twin (older Safari). One-shots are mono, loops and beds stereo.
- `mode`: `shot` (one-shot; several per category = round-robin variants), `loop`, `long` (e.g. sirens, MG
  bursts), `bed` (ambience: streamed through a media element, never decoded).
- A sound is used for design-spec §9.3 id `X` when its `category` is `X` or appears in X's alias list in
  `src/audio/manifest.js`. Categories: `fs_*` and named ones = Freesound CC0; `k_*` = Kenney CC0 packs;
  `surf` and `river` = procedural beds (`tools/audio/procedural_beds.py`); `bomb_tick1` = single ticks cut
  from a CC0 ticking loop.
- Licence gate: CC0 only. `EXCLUDE_IDS` in the build script holds the provenance rejects (Hugofski 177556,
  SuperPhat 410442, morganpurkis 387508 / 390663); `tests/unit/audio-assets.test.mjs` fails if one ships.

## Voices: `voice/lines.json`
```json
{ "lines": [ { "speaker": "ger", "voice": 2, "rec": "halt_wer_da", "text": "Halt! Wer da?",
               "files": ["german_2/primary/halt_wer_da.ogg", "german_2/primary/halt_wer_da.mp3"],
               "timing": "german_2/primary/halt_wer_da.json" } ] }
```
- `speaker` is a commando role (`greenberet`, `sniper`, `diver`, `sapper`, `driver`, `spy`) or `ger`.
  `rec` matches the `rec` field of a line in `src/audio/voice-lines.js`; the `text` must equal that line's text
  (it is the subtitle). German guards have voices 1–3 (picked per soldier); commandos have a `primary` take
  and an urgent `alt` take (pain, or while the alarm is up).
- `timing` JSON: `words`, `phones` and `visemes` (Oculus 15 set) in seconds, for the talking portraits.
- Legacy rows `{speaker, key, n, file}` (index into the key's lines) are still accepted.
- Engines: Kokoro-82M (Apache-2.0) and Chatterbox-Multilingual (MIT). No real person's voice is cloned.

## Music: `music/manifest.json`
```json
{ "cues": { "menu": ["menu.ogg", "menu.mp3"] } }
```
Cue ids are the §9.1 names. No recorded music ships yet (menus use the synth placeholder). Music never plays
during a mission; the exceptions are the start stinger and the optional `drone`.
