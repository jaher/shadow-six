#!/usr/bin/env bash
# rev.sh <name> [theater] [views] -> out/<name>/review/*.png (kit review renderer, headless GPU)
HERE="$(cd "$(dirname "$0")" && pwd)"
n=$1; th=${2:-temperate}; v=${3:-game1,game2,close,top}
timeout 200 node "$HERE/../kit/review/render.mjs" "$HERE/out/$n/$n.glb" "${4:-$HERE/out/$n/review}" --theater "$th" --views "$v" --yaw "${YAW:-0}" 2>&1 | tail -5
