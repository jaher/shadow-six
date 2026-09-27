#!/bin/bash
# build.sh <out_dir> <spec.json>...   (JOBS parallel Blender builds of enemies/blender/build_enemy.py; logs next to outputs)
E=$(cd "$(dirname "$0")/.." && pwd); OUT=$1; shift; mkdir -p "$OUT"
printf '%s\n' "$@" | xargs -P ${JOBS:-4} -I{} sh -c 'n=$(basename {} .json); BL_TIMEOUT=400 '"$E"'/../pipeline/tools/bl.sh '"$E"'/blender/build_enemy.py {} '"$OUT"' > '"$OUT"'/$n.log 2>&1; rm -f '"$OUT"'/$n.raw.glb '"$OUT"'/$n.blend1; echo "$n $(grep -o "DONE.*" '"$OUT"'/$n.log || echo FAILED)"'
