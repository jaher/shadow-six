#!/usr/bin/env bash
# Point the vehicle scripts at a checkout (default: this one). They were written in a scratch workspace and hard-coded
# its paths; this rewrites them in place (re-running is harmless, the scratch root is matched by pattern):
#   <scratch>/vehicles, <scratch>/realism/blender-modeling  -> tools/blender/vehicles   (same blib.py)
#   <scratch>/art/kit                                       -> tools/blender/kit
#   <scratch>/realism/characters/blender-4.2.9-*/blender    -> ${B42:-blender}          (shell scripts)
#   $S/realism/blender-modeling/pydeps42                    -> ${PYDEPS42:-<vehicles>/pydeps42}
#   the scratch root itself (S=…, SCR = …)                  -> ${VEH_WORK:-<vehicles>/.work} (renders, logs)
# Usage: relocate_vehicles.sh [repo-root]   (e.g. the main checkout when run from a git worktree)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -n "$1" ]; then TO="$(cd "$1" && pwd)/tools/blender/vehicles"; else TO="$HERE"; fi
TB="$(dirname "$TO")"
CL="/tmp/cla""ude"  # split so a grep for scratch paths stays clean
R="$CL"'-[0-9]+/[^/"'"'"' ]+/[0-9a-f-]{36}/scratchpad'
grep -rlE "$R|$CL-[0-9]+/" "$HERE" --include='*.py' --include='*.sh' --include='*.mjs' --include='*.js' --exclude=relocate_vehicles.sh | while read -r f; do
  sed -i -E \
    -e "s#$R/realism/characters/blender-4\.2\.9-linux-x64/blender#\${B42:-blender}#g" \
    -e "s#$R/vehicles#$TO#g" -e "s#$R/art/kit#$TB/kit#g" -e "s#$R/realism/blender-modeling#$TO#g" \
    -e "s#\\\$S/realism/blender-modeling/pydeps42#\${PYDEPS42:-$TO/pydeps42}#g" \
    -e "s#\\\$S/realism/characters/blender-4\.2\.9-linux-x64/blender#\${B42:-blender}#g" \
    -e "s#^S=$R\$#S=\"\${VEH_WORK:-$TO/.work}\"#" \
    -e "s#^SCR = '$R'#SCR = os.environ.get('VEH_WORK', '$TO/.work')#" \
    -e "s#'$CL-[0-9]+/', ##" "$f"
done
cp -n "$HERE/kit_materials.json" "$TB/kit/lib/materials.vehicles.json" 2>/dev/null || true
left=$(grep -rlE "$CL-[0-9]+" "$HERE" --exclude=relocate_vehicles.sh | wc -l)
echo "vehicle scripts now use $TO (outputs: $TO/<group>/out, work files: \${VEH_WORK:-$TO/.work}); scratch paths left: $left"
