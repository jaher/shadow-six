# Mission films

A film of a mission is the art opening plus the full scripted solution (`tools/solutions/<id>.solution.mjs`), played in the real game with player orders only, captioned, with a soundtrack built from the game's own audio. The M3 film (`m03.cut.mjs`) was the first; every mission with a solution can be filmed the same way.

Videos never go into the repository (the asset budget): they live in `commandos-shots/videos/`.

## Film a mission

```sh
# from a checkout nobody else is driving (it uses the GPU for minutes); run it in the background and poll the log
node tools/solutions/film-mission.mjs m01 --sheet
#   ffmpeg: --ffmpeg <bin>, else $FFMPEG, else `ffmpeg` on the PATH, else the imageio_ffmpeg build in the uv / micromamba caches
#   (film-ffmpeg.mjs; the Playwright copy cannot encode H.264)
#   -> ../commandos-shots/videos/m01.mp4   (+ m01-sheet.jpg, work/m01/timeline.json, work/m01.capture.log, work/m01.mix.log)
```

`film-mission.mjs` runs the three steps below and checks the result; the last line is `FILM_RESULT {json}` and the exit code is 0 only when every check passed. Options: `--videos <dir>` (default `../commandos-shots/videos`, or `$FILM_VIDEOS`), `--mp4 <file>`, `--crf 26` instead of `--bitrate`, `--no-opening`, `--opening-sec 17`, `--keep-frames` (the JPEG frames, ~220 KB each, are removed after a good mix; keep them to mix again), `--mix-only` (mix again from an existing capture whose frames were kept; `mix-video.mjs <work dir> --audio-only x.m4a` needs no frames).

The steps one by one:

```sh
node tools/solutions/capture-video.mjs m01 --out <work dir> [--no-opening] [--opening-sec 17] [--dry]   # frames + timeline.json
node tools/solutions/mix-video.mjs <work dir> <out.mp4> [--bitrate 1400k] [--audio-only out.m4a]
node tools/solutions/contact-sheet.mjs <work dir> <sheet.jpg>                                            # 4x4 key frames
```

`--dry` plays both passes without drawing and prints the film's length per checkpoint step (to tune a cut).

## What the capture does (`capture-video.mjs`)

- **Pass 1** plays the solution logic-only (~15–60 s) to learn when things happen (kills, objectives, checkpoints).
- **Art opening** (`film-opening.mjs`, at most 19.5 s, `--no-opening` to skip): the game's briefing tour (`src/ui/tour.js` `tourStops`: objectives, the densest guard cluster, the extraction, the team's start) turned round into a slow pan — a zoom-2 close-up of the first objective under the mission's title card (mission number and name, place and date, objective, "never spotted" when pass 1 had no detection), then the game's default zoom over the danger and the extraction, then the team's start at the film zoom, where the solution begins. Each stop has a short caption. It runs in a world of its own that is stepped in real time (patrols walk, water flows) and thrown away; the solution then starts on a fresh load, so the run is exactly the scripted one.
- **Pass 2** reloads and plays the same run drawn: every tick is `Game.step(dt)`, a frame is rendered and grabbed every N ticks, N set by a speed director (4× while someone walks, 8× while only crawling, 16× while everyone waits and up to 32× once a wait has run past 16 s of film; real time around kills and blasts it knows from pass 1). The camera follows the commando last ordered (his vehicle when aboard). Stage title, step caption, game clock and speed are a DOM layer captured with the canvas.
- **Cards and captions without a cut**: title card and end card are built from the mission's briefing data and the run (`Mission complete`, objectives ticked, game time, detections, kills, commandos alive). The stage title is the walkthrough's chapter (`<id>.walkthrough.mjs`) or the solution's own stage title; the step caption is the walkthrough step's text (its first sentences while they fit 160 characters) or the checkpoint's name. A step is the stretch that ENDS at its checkpoint (`docs/walkthrough-format.md`), so its caption goes up when the step begins (the stage starts, or the checkpoint before is reached) and stays until the next one (`film-captions.mjs`); each caption is given its reading time (24 characters a second, 2.2 to 6.5 s) before the next may replace it, a caption overtaken while it waits is dropped. A cut that words most of the checkpoints (`m03.cut.mjs`: `CAPTIONS`, keyed by checkpoint, worded for what has just happened) keeps the older rule: its caption goes up at the checkpoint and stays for a while; one that words only a few (`m01.cut.mjs`: D4) mends those and leaves the rest to the walkthrough. A `tools/solutions/<id>.cut.mjs` is optional and overrides all of it (`TITLES`, `CAPTIONS`, `TITLE_CARD`, `END_CARD`) and adds fixed camera `shots`, speed `windows`, `follows`, timed captions `notes(cp, objT)` (`{ t0, t1, text }` in game time: the step captions only change at checkpoints, so a long stretch between two of them needs its own) and a `pitchAt` (see `m03.cut.mjs`). `m01.cut.mjs` is the small kind: it mends the one stretch the generic director leaves quiet (M1's raft, parked 6½ minutes of game time waiting for a gap on the north beach, shown from the beach at 40× instead) and leaves the rest to the director. A film should have no stretch of 5 s or more in which nothing moves: look at the contact sheet and at the sampled frames of any run of 16× or faster before it is called done.
- **The ground under the camera** (`film-camera.mjs`): the view is centred on a point at the height of the ground there. `world.groundY` is the terrain relief alone — 0 on a deck such as M5's summit (16 m) or M3's dam crest (7.3 m) — which put the view `y·cot(pitch)` (19 m on the summit) short of the barracks the film was about to blow up and of the opening's first stop. `standHeight(world, x, z)` takes the highest of the relief and the game's walking surface (`grid.surfaceY`) at the point and on rings round it (a structure's footprint has no walking surface); the opening's pan, the blast shots and any cut shot without a `y` use it (a man or a vehicle carries his own `y`).
- **The Sniper's scope** (the user's standing request for the walkthrough, 2026-10-22: "we should see the sniper scope moving around before sniper hits target"): when the squad carries the sniper rifle, the game's own scope show (`src/debug/walkthrough-scope.js` `ScopeShow`) runs on the film's clock — at the Sniper's order the scope comes up off the man, searches round him, finds him and settles with its sway; the film slows (down to 0.15×, with frames between ticks) to the pace that lands the shot at the end of the show, the recoil, the scope comes down. The camera stays on the man in the glass; the run is untouched.
- **The cue sheet**: the game's own audio handlers (`src/audio/event-map.js` `installHandlers`) listen to the filmed run through a recorder in place of the audio engine, so `timeline.json` carries what the game would have played — one-shots `{t, id, x, z, g, rate}`, loops, automatic-fire bursts, bomb ticks, the siren — plus the threat log the score follows (enemy states, deaths, the alarm) and each frame's camera (`cx, cz, vw`), the listener of the game's distance model.
- The result checks that both passes won and that their checkpoints are identical (drawing did not change the run).

## What the mix does (`mix-video.mjs`, `film-audio.mjs`, `film-mixer.mjs`)

Nothing is written for one mission; everything comes from the mission's data and the game's tables.

- **Music**: the mission's start stinger (`startCueFor`: Norway `start_1`, North Africa `start_2`, Normandy `start_3`, the Rhine `start_4`, Final Assault `start_5`, covert `start_6`), then the tension chain exactly as `MusicDirector` chains it (each segment from its own loop start at the previous one's body end, never repeating the one before), the alert layer (`mission_alert`) crossfaded in on a bar line while the game's `ThreatTracker` says guards are in combat or searching or the alarm runs and out after the calm hold, and the success cue at the win (`fail_*` for a lost run) with the score fading over a second.
- **Ambience**: the theatre's beds from `ambienceFor(def)` — snow and fjord wind, desert wind, surf, birds, crickets, town, the M2/M3/M19 rivers — at the game's gains scaled to the film's level and capped by each recording's loudness (no bed over −30 LUFS); positional layers (M3's waterfall) follow the camera and end when their structure is destroyed; sparse far barks.
- **Effects**: every cue of the sheet with the game's `SFX` gain and `spatialize` distance model from the view centre (culled when out of range, panned by screen side, far blasts as the distant recording), the game's recorded takes where it has them and its own synth recipes (`src/audio/synth.js`) where it has not (harpoon, raft hiss, decoy beep, trap snap…), de-duplicated like the game and limited to three of a kind per half second; footsteps, crawling and the ducks and fish only in the real-time stretches (at 16× they would rattle); one recording is never played twice at once; bomb ticks 2 Hz → 4 Hz; the siren fading over 25 s.
- The sum is made sample by sample in `film-mixer.mjs` (a film has thousands of effects: too many inputs for one ffmpeg graph), peak-limited (a shot is ten dB over the score) and loudness-normalised to −16 LUFS / −2 dBTP — one linear gain when the peaks allow it, the dynamic `loudnorm` of the M3 film when not — then limited again; video is x264 (`--crf`, or two-pass `--bitrate`) with AAC audio.
- An older timeline without the cue sheet (the October M3 captures) still mixes: its music and ambience come from the mission definition, with no effects.

## Tests

`node tests/run.mjs film-capture` (GPU, ~2 min) films the first 16 s of M1 and mixes it: the opening, the cue sheet, the camera in every frame, an MP4 that decodes with video and audio.

`node tests/unit/run.mjs mission-film` — the opening plan (≤ 20 s, continuous camera), the soundtrack plan (chain rule, alert layer, ambience caps, effects, loops, ticks), the mixer, and the data the films lean on (every cue and theatre bed has recorded assets).
