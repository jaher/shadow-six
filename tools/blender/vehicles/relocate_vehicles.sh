#!/usr/bin/env bash
# Point the vehicle scripts at this checkout. They were written in a scratch workspace and hard-code its paths.
# Rewrites (in place): <scratch>/vehicles -> tools/blender/vehicles, <scratch>/art/kit -> tools/blender/kit,
# <scratch>/realism/blender-modeling -> tools/blender/vehicles (same blib.py). Re-running is harmless.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; TB="$(cd "$HERE/.." && pwd)"
ORIG='<claude-tmp>'
grep -rlF "$ORIG" "$HERE" --include='*.py' --include='*.sh' --include='*.mjs' --include='*.js' --exclude=relocate_vehicles.sh | while read -r f; do
  sed -i -e "s#$ORIG/vehicles#$HERE#g" -e "s#$ORIG/art/kit#$TB/kit#g" -e "s#$ORIG/realism/blender-modeling#$HERE#g" "$f"; done
cp -n "$HERE/kit_materials.json" "$TB/kit/lib/materials.vehicles.json" 2>/dev/null || true
echo "vehicle scripts now use $HERE (outputs: $HERE/<group>/out). Merge kit_materials.json into kit/lib/materials.json to rebuild."
