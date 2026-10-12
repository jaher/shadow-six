#!/bin/bash
# Detailed hero key art (S03 title splash), all stages:
#   BLENDER=<blender >= 4.2> PY=<python with Pillow >= 11.3> tools/ui/keyart/herohd/make.sh <data dir> <work dir> [stages]
# stages (default all): build dress render variants plate
#   plate: the splash background (backdrop.py ground plate over sky.svg minus its flat tank) -> assets/ui/keyart/sky-*
#   data dir: the CC0 MakeHuman data (mh.py docstring); work dir: char.blend, hero.blend, master.png
# Output: assets/ui/keyart/hero-{900,1350,1800,2700}.{avif,webp}
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DATA="$1"; WORK="$2"; STAGES="${3:-build dress render variants plate}"
B="${BLENDER:-blender}"; PY="${PY:-python3}"
mkdir -p "$WORK"
for s in $STAGES; do
  case $s in
    build)    "$B" -b --factory-startup --python "$HERE/build.py" -- "$DATA" "$WORK/char.blend" "${VOXEL:-0.007}" ;;
    dress)    "$B" -b "$WORK/char.blend" --python "$HERE/dress.py" -- "$DATA" "$WORK/hero.blend" ;;
    render)   "$B" -b "$WORK/hero.blend" --python "$HERE/render_hd.py" -- "$WORK/master.png" 1800 2700 "${SPP:-1024}" ${FOG:+--fog} ;;
    variants) "$PY" "$HERE/variants.py" "$WORK/master.png" "$REPO/assets/ui/keyart" ;;
    plate)    "$B" -b --factory-startup --python "$HERE/backdrop.py" -- "$WORK/ground.png" 3200 1800 "${PLATE_SPP:-256}"
              "$PY" - "$REPO/assets/ui/keyart/sky.svg" "$WORK/sky-notank.svg" <<'PYEOF'
import sys
s = open(sys.argv[1]).read(); a = s.index('<path d="M0 735 L1600 720'); open(sys.argv[2], 'w').write(s[:a] + '</svg>\n')
PYEOF
              node "$HERE/rasterize_svg.mjs" "$WORK/sky-notank.svg" "$WORK/sky-notank.png" 3200 1800
              "$PY" "$HERE/variants.py" --plate "$WORK/sky-notank.png" "$WORK/ground.png" "$REPO/assets/ui/keyart" ;;
  esac
done
