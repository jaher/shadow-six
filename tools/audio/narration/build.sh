#!/usr/bin/env bash
# Newsreel narration build: text -> Kokoro TTS -> PSOLA cadence -> period chain -> QA (+ slower retry of failures)
# -> OGG/MP3 + manifest.
# usage: tools/audio/narration/build.sh WORK_DIR [mission,ids]   (see docs/narration.md for the environment)
#   PY       python with kokoro, librosa, scipy, pyloudnorm, faster-whisper, num2words
#   PM_PY    python with praat-parselmouth        FFMPEG  ffmpeg binary (libopus + libmp3lame)
#   KOKORO_DIR, WHISPER_DIR as in tts.py / qa.py
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
W="$1"; ONLY="${2:-}"
mkdir -p "$W/raw" "$W/x" "$W/proc"
node "$HERE/dump-text.mjs" > "$W/lines.json"
"$PY" "$HERE/tts.py" "$W/lines.json" "$W/raw" "$ONLY"
for f in "$W"/raw/*.wav; do
  n="$(basename "$f" .wav)"
  [ -n "$ONLY" ] && ! [[ ",$ONLY," == *",${n%%_*},"* ]] && continue
  "$PM_PY" "$HERE/prosody.py" "$f" "$W/x/$n.wav" 1.6 1.5 >/dev/null
  echo "{\"pad_in\":0.12,\"pad_out\":0.3,\"seed\":$(( $(printf '%s' "$n" | cksum | cut -d' ' -f1) % 100000 ))}" > "$W/x/$n.preset.json"
  "$PY" "$HERE/period.py" "$W/x/$n.wav" "$W/proc/$n.wav" "$W/x/$n.preset.json"
  cp "$W/raw/$n.json" "$W/proc/$n.json"
done
"$PY" "$HERE/qa.py" "$W/proc" "$W/qa.json"
"$HERE/retry.sh" "$W" 1.0    # fresh noise seed, same pace
"$HERE/retry.sh" "$W" 0.92   # then 8 % slower
node "$HERE/package.mjs" "$W" "$ROOT/assets/audio/narration"
