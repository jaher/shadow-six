# The newsreel narrator

Before each mission, a 1940s newsreel announcer reads the briefing aloud: first the title card ("Mission 1. Baptism of
Fire. Sola, near Stavanger, Norway. February 20, 1941."), then the mission's wartime background, then each paragraph
of the briefing screen. The words appear on screen as he reads them, the slides turn with his lines, and the music
ducks under his voice. He then reads the Colonel's captions on the map tour, and the camera waits for him at each stop.

The voice is an original synthetic voice. It is a blend of stock Kokoro-82M voicepacks with a pitch-contour
expansion and a period audio chain on top. No real person's voice was cloned or imitated, and no recording of a real
person was used as a reference.

## In the game

- **Part 1 of the briefing** (`src/ui/briefing.js`). The narration starts 1.6 s after the screen opens, once the
  music intro and projector sound have played. Each line is one clip:
  - `head`: the title card. Campaign missions only.
  - `hist`: the wartime background (`briefing.historical` in the mission file, written by us: a month and year, then
    30 to 60 words). The screen shows it as a typed news-wire slip under the place line, with a small red
    BACKGROUND stamp. The screen used to look for `briefing.history`, so this paragraph never appeared before.
  - `p0`, `p1`, `p2`: the paragraphs.
  - `rules`: the standing orders, for a mission that forces house rules.
- **Text in step with the voice.** Each paragraph's words are wrapped in spans, and the text content stays the same.
  A word appears once the voice has read that share of the line's letters, using the clip's word timings
  (`src/ui/briefing-narration.js`). Paragraphs he has finished dim a little. With reduced motion, the unread words
  are dimmed rather than hidden.
- **Slides follow the lines.** Line *i* shows slide *i*. While the narrator speaks, the 6 s auto-rotation waits, and
  it resumes when he finishes.
- **Controls:**
  - Space, →, or a tap on the photo goes to his next line.
  - ← goes back to the previous line.
  - Esc or Enter goes to the Colonel's tour and stops the narration.
  - N, or the speaker button at the top right, switches the narrator on or off. Switching on reads the briefing again
    from the top. The text column scrolls to keep the line he is reading in view. On a phone, upright or sideways, the
    column ends above the fixed PREV / NEXT / CONTINUE buttons, so neither the line he is reading nor the last
    paragraph ever sits under them.
- **Part 2, the Colonel's tour.** The camera flies to each stop (start, objectives, the guarded spot, extraction) and
  the narrator reads its caption from a recorded clip. The browser's own speech synthesis is no longer used.
  - Each stop waits for him: he starts 0.3 s after the camera sets off, and the camera moves on 0.6 s after his line
    ends, holding a stop for at least 2.5 s (`TOUR_TIMING` in `src/ui/briefing-narration.js`). After the last stop he
    reads the sign-off, "That is all, officer. Good luck."
  - The music stays ducked from his first caption to the sign-off, between captions too (`narrator.session`).
  - The captions come from `tourStops` (`src/ui/tour.js`), and the clips are found by their exact text. A caption with
    no clip, a clip that fails to decode within 2.5 s, NARRATION off, or a game nobody can hear (muted or a volume at
    0) leaves the caption on screen alone, paced by its length as before. Muting mid-caption stops him at once. N
    switches him off or on during the tour too; on reads the current caption again.
  - The tour's clips are decoded while the newsreel plays, or when the tour opens if the newsreel did not play.
- **Options → Sound:**
  - NARRATION is on by default, in both rules presets and with either mission-music setting.
  - NARRATION VOLUME sets the narrator's own level. The VOICES and MASTER volumes also apply to him.
- **Audio** (`src/audio/narration.js`):
  - The `Narrator` fetches `assets/audio/narration/manifest.json` on the first briefing and decodes that mission's
    clips: Opus/OGG, or MP3 on Safari.
  - The clips play through the narrator's own gain into the voice bus. `audio._musicTick` ducks the music director
    for the whole reading, from his first line to the end of the last: the briefing sets `narrator.session`, so the
    music stays down through the 0.45 s pauses between lines instead of pumping back up at every one.
  - There is no narration when audio is still locked, when nobody could hear him (the game is muted, or MASTER, VOICES
    or NARRATION VOLUME is at 0: `narrationAudible`), in deterministic test mode (`manualTick`), when the mission has
    no clips, or when a clip's text no longer matches the screen. The briefing then behaves as before and shows the
    whole text at once. Muting during a reading stops it and shows the text.
- **The text is identical by construction.** `src/ui/briefing-text.js` is the only source of the briefing's words,
  and `tourStops` in `src/ui/tour.js` is the only source of the tour captions. The screen renders them, and the build
  reads them (`tools/audio/narration/dump-text.mjs`). For the tour, the build loads each mission's grid-only world
  with its units placed as the game places them (`tools/audio/narration/tour-world.mjs`). The unit test checks that
  every manifest line's `text` equals the screen text and that every tour caption of every mission has a clip with
  exactly its text. Edit a briefing, an objective or a squad and that test fails until the narration is rebuilt.
  The tour clips are shared by all missions (`manifest.tour`, one clip per distinct caption, file id = a hash of the
  text): "Watch this spot: 5 guards cover it." is recorded once.

## The voice

| Stage | Setting |
|---|---|
| Engine | Kokoro-82M (`hexgrad/Kokoro-82M` @ f3ff357), misaki G2P with British rules (`lang_code='b'`). A US-heavy blend on British vowels gives the mid-Atlantic sound. |
| Blend | `am_onyx:.4 + bm_lewis:.3 + am_eric:.3` |
| Pace | Speed 1.20, about 170 wpm. The title card is read at 1.05. 0.05 s between sentences and 0.45 s between lines (set in the UI). The Mission 1 study chose 1.30, but the 20-mission batch check showed that at 1.30 sentence-initial consonants get swallowed ("Power from" was heard as "How often", "Get down" as "It down"). 1.20 fixed most of those. A check with a second recogniser (faster-whisper medium.en) still heard m03/p0's "Power from the Sysen dam" as "How often season damn" and m04/p1's "Wreck it" as "Check" and "It will" as "We'll", so those two clips are rendered 8 % slower (`NARR_SLOW=0.92`), and medium.en now hears them right apart from the place name. At 1.20 it also drops a few unstressed short words ("their", "your", "our") and hears "oil" as "all" in m08/p2. |
| Cadence | `prosody.py` uses Praat PSOLA: f' = med·2^(1.5/12)·(f/med)^1.6. Every rise and fall is 1.6× wider and the voice is 1.5 st higher. Durations are unchanged. |
| Period chain | `period.py`, in order: <ul><li>Booth reverb with an RT60 of 0.32 s, 10 % wet.</li><li>Band-pass from 200 Hz to 5.75 kHz.</li><li>+6 dB presence at 2.5 kHz and −4 dB at 330 Hz.</li><li>Asymmetric tanh "tube" saturation.</li><li>4:1 compressor.</li><li>Optical-soundtrack band-pass from 250 Hz to 5 kHz.</li><li>Pink hiss at −53 dBFS gated at 24 fps, plus crackle.</li><li>Wow and flutter at 0.55 Hz and 7.8 Hz.</li><li>−18 LUFS, with a soft limit at −1 dBFS sample peak.</li></ul> Each clip gets its own noise seed, 0.12 s of film run-in and 0.3 s of run-out. |
| Pronunciation | `pron.json` holds IPA hints. A few common words get a rhotic hint because the British G2P's dropped *r* merged them into the next word: "near" ("Sola, near Stavanger" was heard as "Solenius de Vanga") and "dearly". The rest of the hints are for place names (Stavanger, Lofoten, Sysendam, Eidfjord, El Agheila, Compiègne, Liège, Riquewihr, Gundelfingen and others) and for German terms (Luftwaffe, Junkers, Gruppenführer, Afrika Korps). They are applied to the TTS input only, so the spoken words stay the on-screen words. `tts.py` also reads dates as "February the twentieth, 1941". |
| Delivery | Opus/OGG at 40 kbps and MP3 at 64 kbps, mono. Each clip comes with word timings from Kokoro's duration predictor. The codecs overshoot between samples (Opus by up to 1.5 dB), so `package.mjs` puts each file through a 4×-oversampled limiter at −2.5 dBTP before encoding, measures the encoded file with an EBU R128 meter, and encodes it again 1 dB lower while it reads above −1 dBTP. The limiter takes 0.3 to 0.9 LU off: the 168 shipped files measure −18.2 to −19.5 LUFS integrated (158 of them within −18.4 to −19.0) and all peak at or below −1 dBTP. |

The design study is summarised here. Its measurements were taken on the Mission 1 text with faster-whisper small and
librosa pyin:

- **The chosen blend** scored WER .021, 187 wpm and an F0 IQR of 7.2 st on the dry voice. Its maximum speaker
  similarity to any commando's voice was .31 (SpeechBrain ECAPA), so he does not sound like one of the six.
- **Chatterbox candidates**, using exaggeration 0.8 to 1.1 with references rendered only from these synthetic
  blends, were slower (144–173 wpm), flatter (F0 IQR ≤ 4.4 st) and repeated words. Kokoro with PSOLA gives the
  newsreel cadence deterministically.
- **PSOLA widening of up to 1.7×** did not change recognition (WER held at .021), while the F0 IQR rose from 4.5 to
  7.45 st.

## Building

```
PY=<python with kokoro, librosa, scipy, pyloudnorm, faster-whisper, num2words> \
PM_PY=<python with praat-parselmouth> FFMPEG=<ffmpeg with libopus + libmp3lame> \
KOKORO_DIR=<Kokoro-82M snapshot> WHISPER_DIR=<faster-whisper small> HF_HUB_OFFLINE=1 \
tools/audio/narration/build.sh /path/to/workdir [m01,m02]
```

The build runs these stages:

1. `dump-text.mjs` writes the lines: each mission's briefing lines, and under `tour` every distinct caption of every
   mission's tour (the mission list `tour` re-renders just those, as in `build.sh WORK_DIR tour`).
2. `tts.py` renders the raw speech and word timings.
3. `prosody.py` applies the PSOLA cadence.
4. `period.py` applies the period chain.
5. `qa.py` runs the speech-recognition check: faster-whisper transcribes each processed clip, and the transcript is
   compared with the text after normalising numbers, dropping hints, joining compounds and dropping "the", "and" and
   "a".
6. `package.mjs` encodes the clips and writes the manifest. The Opus files differ byte for byte from run to run (Ogg
   stream serials), so when only some clips are new, package into a scratch directory and copy just the new files and
   the manifest.

`package.mjs` refuses a clip that has more than one wrong word and a WER above 0.10, unless `qa-accept.json` lists it
with a reason. Before refusing, the build retries each failed clip twice: once at normal speed with a fresh noise
seed, then 8 % slower. Each time it keeps whichever take has fewer errors.

The current set ships 148 clips (21.8 MB): 104 briefing lines (title cards, the 20 backgrounds, paragraphs) and 44
tour captions. 12 of them are in `qa-accept.json`. The 64 clips added for the backgrounds and the tour all pass the
check; the closest is m08/hist (WER 0.10: "burn it" heard as "Burnett"; a slower take scored worse). The hint
`"guards": "ɡˈɑːɹdz"` gives the word its *r*: without it the recogniser heard "gods" in four of the seven captions
that say "guards", and with it in none. `"sortie"` got the same kind of hint, and `"V2"` the one `"V2s"` already had.
Both recognisers heard "destroy the oil-barrel store" as "the old barrel store" (and m08/p2's "all-barrel"): the
G2P ran the compound together with "oil" unstressed, and `"oil-barrel": "ˈYl bˈaɹəl"` fixed both clips. No hint fixed
"1 sentry covers it", which both heard as "one century" in every take tried (six hints and a slower pace), so the
one-guard tour caption now says "1 guard covers it" (ui/tour.js, with a `"guard"` hint like "guards"), on screen and
in his voice. medium.en hears every tour caption with "guard(s)" or "oil" right.

Most of the 12 accepted clips differ only in names the recogniser cannot spell: places such as Stamsund, Sysendam,
El Agheila, Le Havre and Maas, and German names and ranks such as Stukas, Junkers and Gruppenführer. A few also have
a word that runs into its neighbour in connected speech: "Blind it and" was transcribed as "Blinded and", "Reich" as
"right", "Their detonators" as "The detonators", and "forward fuel dump" as "forward-fueled dump". These reasons come
from the recogniser's transcripts; nobody has yet listened to every clip.

To fix a mispronunciation, add the word to `pron.json` and re-render that clip with
`NARR_KEEP=1 NARR_ONLY=m07_p2 tools/audio/narration/retry.sh WORK_DIR 1.0`, then run `package.mjs`. Without
`NARR_KEEP=1` the retry keeps the new take only when the recogniser finds fewer errors, and the check cannot always
hear a mispronunciation. "V2s" is the example: the British G2P split it into V / 2 / s and read "vee-tu-ESS", and the
check still scored both clips perfect because its normaliser turned the transcript "V2S" back into the right words.
A second recogniser (faster-whisper medium.en) heard "vituests". The hint `"V2s": "vˈiː tˈuːz"` fixed it, and
medium.en now hears "V-2s" and "two V2s" in m19/p0 and m20/p0. So confirm a pronunciation fix by listening or with a
second recogniser, not with the build's own check. Hints added after the batch render are "after", "marked",
"store(s)", "Informer", "airman", "D-Day", "V2s", "guard" and "oil-barrel". They affect only the clips that were
re-rendered; a full rebuild applies them everywhere.

## Licences

- Kokoro-82M and its voicepacks: Apache-2.0.
- praat-parselmouth: GPL. It is an offline tool only and is not shipped.
- pyloudnorm: MIT.
- faster-whisper: MIT. It is used for QA only.

The speech is AI-generated, and CREDITS.md says so.
