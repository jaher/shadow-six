#!/usr/bin/env bash
# Point the asset scripts at this checkout. They were written in a scratch workspace and hard-code its path
# (ORIG below). This rewrites ORIG -> tools/blender in every script (in place) and links kit/lib/1k to the
# shipped 1K texture library so kit builds find the shared maps. Re-running is harmless.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
ORIG='<claude-tmp>'
grep -rlF "$ORIG" "$HERE" --include='*.py' --include='*.sh' --include='*.mjs' --exclude=relocate.sh | while read -r f; do
  sed -i "s#$ORIG#$HERE#g" "$f"; done
ln -sfn "$REPO/assets/textures/lib/1k" "$HERE/kit/lib/1k"
echo "scripts now use $HERE (outputs go to $HERE/<group>/out). Blender: set B42=<blender 4.2 binary> (4.0 works for most)."
