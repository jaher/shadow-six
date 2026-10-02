#!/usr/bin/env bash
# Re-render the clips that failed the speech-recognition check: a little slower and with a fresh noise seed. Each
# clip keeps whichever take is recognised with fewer errors. Run it before package.mjs, with the same environment as
# build.sh. usage: tools/audio/narration/retry.sh WORK_DIR [slow factor, default 0.92]
# env NARR_ONLY=m07_p2,... re-renders those clips instead (after a pron.json fix).
# env NARR_KEEP=1 keeps every retry take, even one the check scores no better (a pron.json fix the recogniser's
#   normaliser cannot see, such as "V2s" read as letters; confirm it by listening or with a second recogniser).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$1"; SLOW="${2:-0.92}"; R="$W/retry"
FAILS="${NARR_ONLY:-}"
[ -z "$FAILS" ] && FAILS="$("$PY" -c 'import json,sys; d=json.load(open(sys.argv[1])); print(",".join(k for k,v in d.items() if not (v["errors"]<=1 or v["wer"]<=0.1)))' "$W/qa.json")"
[ -z "$FAILS" ] && { echo "no clip failed the check"; exit 0; }
echo "retrying: $FAILS"
rm -rf "$R"; mkdir -p "$R/raw" "$R/x" "$R/proc"
NARR_SLOW="$SLOW" "$PY" "$HERE/tts.py" "$W/lines.json" "$R/raw" "$FAILS"
for f in "$R"/raw/*.wav; do
  n="$(basename "$f" .wav)"
  "$PM_PY" "$HERE/prosody.py" "$f" "$R/x/$n.wav" 1.6 1.5 >/dev/null
  echo "{\"pad_in\":0.12,\"pad_out\":0.3,\"seed\":$(( ($(printf '%s' "$n" | cksum | cut -d' ' -f1) + 7) % 100000 ))}" > "$R/x/$n.preset.json"
  "$PY" "$HERE/period.py" "$R/x/$n.wav" "$R/proc/$n.wav" "$R/x/$n.preset.json"
  cp "$R/raw/$n.json" "$R/proc/$n.json"
done
"$PY" "$HERE/qa.py" "$R/proc" "$R/qa.json"
"$PY" - "$W" <<'PYEOF'
import json, os, shutil, sys
W = sys.argv[1]; a = json.load(open(f'{W}/qa.json')); b = json.load(open(f'{W}/retry/qa.json'))
for k, v in b.items():
    if os.environ.get('NARR_KEEP') or v['errors'] < a[k]['errors']:
        for ext in ('wav', 'json'): shutil.copy(f'{W}/retry/proc/{k}.{ext}', f'{W}/proc/{k}.{ext}')
        print('kept the retry of', k, a[k]['errors'], '->', v['errors']); a[k] = v
json.dump(a, open(f'{W}/qa.json', 'w'), indent=1, ensure_ascii=False)
PYEOF
