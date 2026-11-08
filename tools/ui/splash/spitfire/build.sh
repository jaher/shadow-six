#!/bin/bash
# Rebuilds the title splash's Spitfire sprite atlas: model + dusk render (Blender 4.x, Cycles on the CPU, ~2 min),
# then pack (python3 with Pillow + numpy) -> assets/ui/keyart/spitfires.webp + src/ui/spitfire-atlas.js, and a
# contact sheet of the sprites and the neutral reference views in <outdir>/contact.jpg.
#   tools/ui/splash/spitfire/build.sh [outdir=/tmp/spitfire_render] [samples=128]
set -e
D=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-/tmp/spitfire_render}
"${BLENDER:-blender}" -b --factory-startup --python-use-system-env --python "$D/render.py" -- "$OUT" all "${2:-128}"
python3 "$D/pack.py" "$OUT" --sheet "$OUT/contact.jpg"
