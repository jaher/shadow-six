# Talking portraits

Status: final asset set rendered and validated on 2026-09-26. Supersedes the A/B comparison (`faces_judge` notes).
**Integrated in the game** (2026-09-26, "Art integration: portraits"): `src/ui/talking-portraits.js`, mounted by the HUD per mission; clips in `assets/portraits/`; see §4.0.

![in game](screenshots/int-portraits-m2.jpg)

![cast](screenshots/faces-final-cast.jpg)

## 1. Decision

**Ship the pre-rendered neural clips (option A). Retire the real-time 3D head (option B) as a visual.**

- At HUD size, A looks like a filmed person. B looks like a 2010-era game character: one generic face for everyone, grey teeth, toy-like headgear.
- The user asked for extremely realistic graphics, which rules B out.
- A's weakness was flexibility: it only covers lines rendered in advance. That is cheap to fix, because a clip takes about 3 s to render and about 27 KB to store at 256 px.
- B's viseme and coarticulation model (`th-anim.js`) survives: it now runs offline to drive A's mouth shapes (§3).

B's code and notes stay archived outside the build.

| Criterion (0–10) | A neural (final) | B real-time |
|---|---|---|
| Photorealism | 8.5 | 3 |
| Lip-sync | 8 (real closures and rounding now) | 6 |
| Identity consistency | 9 (six clearly different men) | 4 |
| Runtime cost | 9 (one small video decode) | 6 |
| Flexibility | 5 (generic talk loop for unrendered lines) | 9 |

## 2. What ships

The asset root is `faces/final/clips/` in the scratchpad pipeline. It is meant to be copied to `assets/portraits/`.

```
manifest.json            characters -> lines/idle/talk_loop, per-clip key, lead, voice, sizes
licenses.json            components, licenses, credits line, synthetic-face policy
<char>/still_1024.jpg    full-resolution portrait (character select, briefing dossier)
<char>/<name>_{256,512}.{webm,mp4,jpg}   muted clip (VP9 / H.264) + poster frame
<char>/voice/<line>.{ogg,mp3}            the voice line each clip was rendered from
```

There are six characters: `green_beret`, `sniper`, `marine` (game role `diver`), `sapper`, `driver`, `spy`. Each character has:

- **8 voiced lines:** `yes_sir`, `what_now`, `ready`, `right_away`, `understood`, `on_my_way`, `consider_it_done`, `i_m_hit`. These are every line in `voices/final/<char>/primary/`, so the set covers selection, acknowledgement and hurt.
- **`idle`:** a 4.28 s seamless loop with two blinks and natural head drift.
- **`talk_loop`:** a 3.9–4.8 s seamless loop of generic speech. It is the fallback for any line that has no rendered clip.

- **Urgent `alt` takes:** the audio pack also has an urgent take of each line (played for `hurt` and while the alarm is up). Its timing differs (for example the Sapper's "On my way." is 0.76 s urgent vs 1.21 s primary), so each alt take has its own clip, `lines.<line>.alt` in the manifest.

That makes 108 clips in total (48 lines + 48 alt takes + 12 loops).

Sizes (bytes on disk):

| Set | Count | Average per clip | Total |
|---|---|---|---|
| 256 px WebM (HUD) | 60 | 26.8 KB (17–73 KB) | 1.6 MB |
| 256 px MP4 (Safari) | 60 | 30.3 KB | 1.8 MB |
| 512 px WebM (character select) | 60 | 73 KB (48–196 KB) | 4.3 MB |
| 512 px MP4 | 60 | – | 5.5 MB |
| Voices OGG+MP3 | 48 | – | 0.67 MB |
| Stills 1024 JPG | 6 | ~150 KB | 0.9 MB |

The recommended HUD tier (256 px WebM+MP4, posters and voices) is about 4.7 MB. `*_raw.mp4`, `*.key` and `*.enc.json` are build intermediates; do not ship the raw files.

## 3. Quality work done in this pass (the must-fix list)

| # | Must-fix | Result |
|---|---|---|
| 1 | Full line set, re-runnable, hash-keyed, validation | `build.py` renders every voiced line (48 + 12 loops). Each job has a sha1 key of portrait + wav + viseme timing + params + `PIPE_VERSION`, and only changed jobs re-render. `lead` is written per line into `manifest.json`. `validate.py` exits 1 on any voiced line without a clip, and on stale keys or missing files. Current result: **0 problems**. |
| 2 | Mouth shapes | `visemes.py` ports `th-anim.js`: the dominance blend, the bilabial/labiodental override and the 85 ms lip lead. It produces five tracks (open, press, labio, round, spread). "open" drives LivePortrait's lip retargeting. The others become per-frame LivePortrait expression-keypoint deltas (`EXP_ADD` patch). JoyVASA's own lip motion is muted during closures (`LIP_JOY_T`). Mouth opening is calibrated per face (`calibrate.py`), and the Driver's gain rose from 0.42 to 0.87. |
| 3 | Full blinks | Blink = LivePortrait eye retarget plus a direct eyelid keypoint delta, ×1.0–1.8 per face, with an 80 ms hold (2 frames). All six faces close fully (checked frame by frame; see the limits in §3.1). |
| 4 | Idle loop seam | Smoothstep crossfade that reaches 1.0 on the last frame. The talk loop is cut inside its silent rest padding, at the frame with the least motion. Loops get more bits. Measured seam jump / median frame step: **idle 0.0–0.19, talk loop 0.04–0.48** (target ≤ 2; the previous pass was about 7). |
| 5 | Portrait accuracy | Regenerated at 1024 px with headroom. All headgear is fully in frame. The Green Beret is now heavy, about 110 kg with a bull neck. The Sapper's helmet follows the character bible's decision: a domed Mk III-style helmet with a short brim, not the Brodie dish. |
| 6 | Break the "same face" | Prompts rewritten from `character-bible.md` §4 (apparent age, build, face shape, hair, facial hair, headgear, skin, eyes): gaunt bald Sniper, stubbled watch-cap Marine, moustached helmeted Sapper, jowly camo-cap Driver, bespectacled tweed-cap Spy. Seeds and prompts are in `portraits/final/seeds.json`. |
| 7 | Sync in game | Audio-clock seek plus `requestVideoFrameCallback` drift correction; `muted playsinline`; clips preloaded as blobs at mission load; WebM with MP4 fallback. Measured drift in headless Chromium: **−9 / +4 ms**. |
| 8 | HUD styling | CSS-only frame, vignette and grade over the baked studio background, with themes `desert` (warm), `night` (cool, darker), `snow`, `europe` and `none`. Readable at the 40 ref-px slot (60 px at 1080p) and in the 96×72 speaker card. |
| 9 | License bookkeeping | Licenses re-confirmed on the model cards on 2026-09-26 (§6). The policy line and the lookalike check are in `licenses.json`. No insignia issues: the Spy is in civilian tweed. |
| 10 | "Urgent" / "pain" variants | Not done. See §8. |

### 3.1 Objective metrics

Per-clip measurements are in `clips/metrics.json`, from `scripts/eval.py` using MediaPipe on the 768 px renders.

| Metric | Result |
|---|---|
| Phoneme sync: lip gap vs intended viseme opening (`corr_vis`) | median **0.94**; 47/48 at or above 0.7 |
| Audio-envelope correlation (`corr`) | median 0.73; 27/48 at or above 0.7 |
| Bilabial closure: lip gap at p/b/m ÷ 90th-percentile speech gap | median **0.024**, max 0.092 (pass ≤ 0.35) |
| Rounding contrast: mouthPucker on O/U/W minus on E/I/S | positive in 28/33 lines |
| Loop seams (jump ÷ median step) | idle ≤ 0.19, talk loop ≤ 0.48 |

Limits of these measurements:

- **`corr` is expected to fall.** It penalises correct behaviour: the lips are shut during voiced /m n/, which have a high audio level (for example "on my **w**ay", "I'**m** hit"). Short shouts barely move the jaw. `corr_vis` is the sync check that matters.
- **The Sapper's moustache hides his lip gap from MediaPipe.** That is why his "Understood" scores `corr_vis` 0.54.
- **MediaPipe cannot confirm full blinks.** Its eye-aperture landmarks bottom out at 0.2–0.45 of the open value even on a shut lid. Blink closure was therefore verified visually on all six faces.
- **Closed-lid frames are slightly soft.** This is a LivePortrait warp artefact. It lasts about 3 frames and is not visible at HUD size.

![mouth shapes](screenshots/faces-final-mouths.jpg)

## 4. Integration: the drop-in HUD module

### 4.0 As integrated in the game

- **Assets:** `python3 tools/portraits/sync_assets.py` copies the HUD tier (256 px WebM + MP4 + poster per clip; 108 clips, about 7.1 MB) from the pipeline's `clips/` into `assets/portraits/`, with `manifest.json` (`sizes: [256]`) and `LICENSES.json`. The voices are not duplicated. The audio pack `assets/audio/voice/<char>/{primary,alt}/` has byte-identical files (checked by hash), so the manifest's voice paths point there (`../audio/voice/...`). The 512 px tier and the 1024 stills stay in the pipeline.
- **Module:** `src/ui/talking-portraits.js` is the module below, with these changes:
  - **Clip choice:** it reads the `rec` and `take` stamps that the audio system puts on the bark, instead of matching text. Text matching is the fallback.
  - **Alt takes:** it plays `alt` clips.
  - **Silent lines:** a voiced speaker's unrecorded lines ("Aye?", "Can't do that one, sir.") get no talk loop, because the audio pack keeps them silent. They show a subtitle and the still. Placeholder voices, with no pack, still get the talk loop.
  - **Line timing:** each line keeps the clock it started on. A wall-clock safety timer ends a line even if the video stalls.
  - **Death:** a death stops that man's line.
- **HUD:** `HUD.onMissionLoaded → _mountPortraits` creates it after `topbar.build` and sets `hud.portraits` and `hud.portraitsReady`. It is disposed on the next mission or on `HUD.dispose`. `options.talkingPortraits = false` turns it off.
- **Stills:** `TalkingPortraits.probe()` runs once, when the HUD is constructed. It registers the posters with `art/portraits.js` (`registerPortraitPhoto`), so the briefing, knapsack, top bar and speaker card show the photo stills even when the clips cannot play. The procedural canvas portrait remains the last fallback.
- **Styling:**
  - `.tp-on` on the HUD root retires the placeholder mouths.
  - The name strip on the speaker card stays above the clip.
  - Stills and clips share the theater grade from `themeFor(def)`: snow, desert, europe, or night when the sun is below the horizon.
  - Unselected portraits are greyscale and the selected one is in colour (character bible [HUD]).
- **Tests:**
  - `tests/unit/talking-portraits.test.mjs`: coverage of every recorded take, voice paths, budget, clip choice, grade and fallback.
  - `tests/portraits.test.mjs` (GPU): M1–M3. It checks the mount, the photo stills, idle and grey states, the exact recorded clip on the card, drift against the AudioContext clock (−10 to −16 ms), line end, the alt clip, death, frame cost and the missing-manifest fallback.

The module is `faces/final/hud/talking-portraits.js`. Copy it to `src/ui/talking-portraits.js`. It has no dependencies; three.js is only needed for `videoTexture()`.

```js
import { TalkingPortraits } from './talking-portraits.js';
// at mission load (after the HUD has built its portrait row)
const tp = new TalkingPortraits({ events: game.events, hud: game.hud, audio: game.audio, base: 'assets/portraits/', size: 256 });
await tp.load(world.commandos);            // manifest + preload/decode every clip of these commandos
tp.setTheme(mission.theme);                // 'desert' | 'night' | 'snow' | 'europe' | null
// on mission end
tp.dispose();
```

### 4.1 Where the video goes

- **DOM `<video>` elements, not `renderer.overlayScene`.** The HUD is DOM. The overlay scene is drawn with the *world* orthographic camera, so it is not a screen-space layer. Browser-composited video also never passes through the renderer's ACES OutputPass, so there is no double tone mapping. The GPU cost in the three.js frame is zero.
- **Idle loop:** a host `div.tp-host` goes into `hud.portraitSlot(unit.id)`, which is the §6.3 cross-team hook. Only the first selected commando's idle loop plays. The other portraits show their first frame, greyscaled by the same `.hud-portrait:not(.selected)` rule as the static face.
- **Lines:** lines play in the speaker card (`hud.topbar.card`, 96×72 ref px, object-position 50% 28% so the headgear stays in view). When the HUD has no card, they play in the unit's slot. At most two small videos decode at once: one idle and one line.
- **CSS:** the module injects one style tag. `.hud-portrait-slot{z-index:0}` and the skull/glyph at `z-index:1` keep the death skull and state glyph above the video.

### 4.2 Events and clip choice

| Event | Behaviour |
|---|---|
| `unit:selected` | The selected commando's idle loop comes alive. |
| `bark` (from `audio.say` for `select` / `ack_move` / `ack_act` / `hurt` / …, or from any system) | The module reads the bark in a microtask, after the audio system has stamped `text` and `duration`. If `text` matches a rendered line, it plays that clip, seeked to its `lead`, so the mouth matches the voice that is starting now. Otherwise it plays the character's `talk_loop` for `duration` and fades back to idle. Enemy barks are ignored. |
| `unit:order`, `unit:selected` in own-voice mode (no `audio` passed) | The module picks a rendered line for the key itself (`KEY_LINES`: select → what_now / yes_sir / ready; ack_move → on_my_way / right_away / understood; ack_act → consider_it_done; hurt → i_m_hit) and plays the OGG (MP3 on Safari) on its own `AudioContext`, 120 ms after the clip, so the lips move just before the sound. |
| `unit:killed` | That portrait's host is hidden, so the HUD skull shows. |

### 4.3 Sync

- The audio clock is `AudioContext.currentTime`: the module's own context in own-voice mode, otherwise `audio.engine.ctx` or `audio.ctx`, falling back to `performance.now()`.
- The expected clip time is `lead + (now − voiceOnset)`.
- Each `requestVideoFrameCallback` compares the clip to that expected time. A drift above 100 ms seeks. A drift between 20 and 100 ms nudges `playbackRate` within 0.92–1.08.
- The line ends at `voice_seconds + 0.3 s`, and the clip then fades out over the idle loop in 120 ms.

### 4.4 Wiring the recorded lines into the game's audio

The game's `LINES` texts ("Aye?", "Woolridge.", …) are not voiced yet. Today `audio.say` synthesises placeholders, so every commando line falls back to `talk_loop`, which is correct but generic. There are two ways to get exact lip-sync:

- **Register the rendered lines as variants.** Add `assets/audio/voice/lines.json` entries `{speaker, key, n, text, file}` that point at `<char>/voice/<line>.ogg`, and add the same texts to `LINES`. The bark text then matches and the exact clip plays.
- **Voice the game's own `LINES` with the voice pipeline** (`voices/final/<char>/primary/<id>.{wav,json}`), then run `python build.py`. Only the new lines render, at about 3 s each; for example, the ~130 commando lines in `voice-lines.js` take about 7 minutes. Then run `validate.py`.

### 4.5 Fallback

Any of these leaves the HUD exactly as it is (static face plus placeholder mouth): `load()` resolves `false`, a codec is unsupported, autoplay is rejected, or a clip fails to load. This was tested: a missing manifest gives `ok:false` and zero attached hosts.

### 4.6 3D use

`videoTexture(THREE, url)` returns an sRGB `THREE.VideoTexture` on a muted looping video. Use it for the character-select table or a briefing prop, with 512 px clips. If you draw it in `renderer.overlayScene`, it comes after the OutputPass, so ACES is not applied twice.

### 4.7 Test bench

`faces/final/web/index.html` is a HUD replica with the real `.hud-portrait` / `.hud-portrait-slot` / speaker-card DOM. `web/check.mjs` drives it in headless GPU Chromium. Last run:

- loaded webm
- idle playing, others paused
- line drift +4 ms
- line ended on time
- talk loop for an unrecorded line, ended on time
- fallback OK

![HUD](screenshots/faces-final-hud.jpg)

*Top: desert grade, the Sapper acknowledging an order. Bottom: night grade, the Spy on the generic talk loop.*

## 5. Regeneration

The pipeline is in the scratchpad at `faces/final/scripts/`. It reuses `faces/neural/` (venv, JoyVASA/LivePortrait repo, weights), all on an RTX 5090. The whole set takes about 5 minutes to render and about 4 minutes to encode.

| Step | Command | Notes |
|---|---|---|
| Portraits | `SEEDS=101,202,303,404 python gen_portraits.py ../portraits/cand` | Z-Image-Turbo Q4_K_M GGUF, 9 steps, cfg 0, 1024², about 5 s per image. Prompts are in `prompts.py`. |
| Pick | `python finalize.py ../portraits/cand driver=606 green_beret=606 marine=101 sapper=202 sniper=202 spy=101` | Writes `<char>.png` (1024 still) and `<char>_src.png` (768 head-and-shoulders crop that drives the animation), and records seed and prompt in `seeds.json`. |
| Calibrate | `python calibrate.py 2` | Per-face `open_max` toward a vowel lip gap of 0.06 of face height. Blink gains are in `clips/calib.json`. |
| Render | `python build.py [--only spy] [--force]` | Hash-keyed: renders only new or changed lines, including the urgent `voices/final/<char>/alt/` takes (`<line>_alt` clips). JoyVASA motion + LivePortrait + viseme shapes + blinks, then `encode.py` (512/256, WebM VP9 CRF 33/28/31 for line/idle/loop, H.264 CRF 23, posters), then `manifest.json`. |
| Check | `python validate.py` | Exits 1 on any voiced line or urgent alt take without a clip, or on stale or missing files. |
| Ship | `python3 tools/portraits/sync_assets.py` (repo) | Copies the 256 px tier into `assets/portraits/` (§4.0). |
| Metrics | `python eval.py` | Writes `metrics.json`. `mouth_sheet.py LINE out.jpg` and `showcase.py DIR` make contact sheets. |

Patches in the vendored JoyVASA copy (`repos/JoyVASA/src/live_portrait_wmg_pipeline.py`; original saved as `.bak_final`):

- `VISEME_OPEN` (lip retarget)
- `EXP_ADD` (per-frame expression-keypoint deltas)
- `LIP_JOY` / `LIP_JOY_T` (JoyVASA lip residual, muted in closures)
- `EYE_CLOSE` / `EYE_GAIN` (blinks)
- MediaPipe in place of InsightFace

Keypoint directions are in `visemes.py:EXP_DIRS`. They were calibrated with `calib/jobs*.json`: round raises MediaPipe mouthPucker by 0.6, and spread widens the mouth by 9 %.

## 6. Licenses

Everything is redistributable. Full detail is in `clips/licenses.json`. Copy it to `docs/` and the credits screen.

| Component | Role | License |
|---|---|---|
| Z-Image-Turbo (Tongyi-MAI), unsloth GGUF Q4_K_M | portrait text-to-image | Apache-2.0 |
| Qwen3-4B (unsloth GGUF) | text encoder | Apache-2.0 |
| JoyVASA (jdh-algo) | audio → head/face motion | MIT |
| chinese-hubert-base (TencentGameMate) | audio features for JoyVASA | MIT (model card re-checked 2026-09-26) |
| LivePortrait (KwaiVGI / KlingTeam) | portrait animation renderer | MIT |
| MediaPipe FaceLandmarker | face crop and landmarks (replaces InsightFace, which is non-commercial) | Apache-2.0 |
| Kokoro-82M / Chatterbox-Multilingual | voices (Spy = Chatterbox) | Apache-2.0 / MIT |
| ffmpeg | encoding tool only | outputs unencumbered |

- **Excluded on purpose (non-commercial):** InsightFace weights, Wav2Lip, SadTalker/BFM, Sonic, FLOAT.
- **Policy:** synthetic faces, no real-person input. The portraits come from written descriptions only (seeds and prompts are in the repo), and no photo, likeness or voice of a real person was used. Before release, run a lookalike check (reverse image search of the six stills). Keep checking every uniform for Nazi insignia; there are none in this set.
- **Credits line:** "Talking portraits AI-generated with Z-Image-Turbo (Apache-2.0), JoyVASA and chinese-hubert-base (MIT), LivePortrait (MIT) and MediaPipe (Apache-2.0); voices AI-generated with Kokoro-82M (Apache-2.0) and Chatterbox (MIT)."

## 7. Runtime cost

- **Decoding:** one 256 px VP9 idle decode, plus one line decode while a man speaks.
- **Memory:** about 300 KB of blobs per commando.
- **Renderer:** no shader programs and no render-pass cost.
- **Load:** preload is a handful of 20–70 KB fetches at mission load.

## 8. Open items

1. **Voice the game's actual `LINES`** so that every bark gets an exact clip instead of the generic loop (§4.4). The pipeline is ready. As integrated, every *voiced* line in the game has its exact clip: the 8 recorded lines × primary + alt. The flavour lines are subtitle-only until the audio track voices them; then `build.py` renders only the new ones.
2. **"Urgent" and "pain" expression variants** (nice to have). Examples: a stronger JoyVASA `cfg` for alarm lines; a brow-down / squint `EXP_ADD` preset for `hurt` and `death`.
3. **Spy disguise variant** (German officer's cap, no swastika) for missions where he wears the uniform. It needs an img2img pass on his still and the same seed.
4. **Closed-lid softness** (a LivePortrait limit). If it ever shows at 512 px, add a two-frame lid-texture blend.
5. **Lookalike check** on the six stills before release.
