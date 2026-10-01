#!/usr/bin/env bash
# ship.sh - after compose.py and `post.py 'eye.*'`: copy the eye's files from the icon scratch into the repo, merge
# their manifest entries into assets/ui/icons/manifest.json (other icons untouched) and regenerate icon-manifest.js.
#   ICON_SCRATCH=<scratch>/icons tools/blender/hud/eye/ship.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="${ICON_SCRATCH:?set ICON_SCRATCH}/out"
cp "$OUT"/tool/eye.open*.* "$OUT"/tool/eye.closed@*.* "$OUT"/tool/eye.anim@*.webp "$ROOT/assets/ui/icons/tool/"
cp "$OUT"/cursor/eye.open@*.* "$OUT"/cursor/eye.closed@*.* "$ROOT/assets/ui/icons/cursor/"
python3 - "$OUT/manifest.json" "$ROOT/assets/ui/icons/manifest.json" <<'PY'
import json, sys
src, dst = (json.load(open(p)) for p in sys.argv[1:3])
keys = [k for k in src if k.split('/', 1)[1].startswith(('eye.open', 'eye.closed')) and k.split('/')[0] in ('tool', 'cursor')]
for k in keys: dst[k] = src[k]
json.dump(dst, open(sys.argv[2], 'w'), indent=1, sort_keys=True)
print('merged', sorted(keys))
PY
node "$ROOT/tools/blender/icons/gen-manifest.mjs"
