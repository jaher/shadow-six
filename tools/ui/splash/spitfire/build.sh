#!/bin/bash
# Rebuilds the Spitfire sprite atlases: model + dusk render (Blender 4.x, Cycles on the CPU, ~2 min), then pack
# (python3 with Pillow + numpy) -> assets/ui/keyart/spitfires.webp + src/ui/spitfire-atlas.js (the title splash),
# and a contact sheet of the sprites and the neutral reference views in <outdir>/contact.jpg; then the daylight
# render -> assets/ui/keyart/spitfires-day.webp + src/ui/spitfire-day.js (the main menu's flyover).
#   tools/ui/splash/spitfire/build.sh [outdir=/tmp/spitfire_render] [samples=128]
set -e
D=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-/tmp/spitfire_render}
"${BLENDER:-blender}" -b --factory-startup --python-use-system-env --python "$D/render.py" -- "$OUT" all "${2:-128}"
python3 "$D/pack.py" "$OUT" --sheet "$OUT/contact.jpg"
"${BLENDER:-blender}" -b --factory-startup --python-use-system-env --python "$D/render.py" -- "$OUT" day "${2:-128}"
python3 "$D/pack.py" "$OUT" --day --sheet "$OUT/contact-day.jpg"
