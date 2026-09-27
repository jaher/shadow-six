#!/bin/bash
# build_many.sh <out_dir> <spec.json>...   (4 parallel Blender builds; logs next to the outputs)
P=$(cd "$(dirname "$0")/.." && pwd); OUT=$1; shift; mkdir -p "$OUT"
printf '%s\n' "$@" | xargs -P ${JOBS:-4} -I{} sh -c 'n=$(basename {} .json); BL_TIMEOUT=600 '"$P"'/tools/bl.sh '"$P"'/blender/build_char.py {} '"$OUT"' > '"$OUT"'/$n.log 2>&1; echo "$n $(grep -o "DONE.*" '"$OUT"'/$n.log || echo FAILED)"'
