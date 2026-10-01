#!/bin/bash
# review.sh <glb> [views]  -> renders game1,game2,close,close_se with a real 1.8 m soldier (theater + uniform by variant)
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
T=$REPO/tools/blender/vehicles/cars_moto/review_tool
E=$REPO/assets/characters/enemies
G=$(readlink -f $1); D=$(dirname $G); N=$(basename $G .glb)
TH=temperate; FIG=$E/rifleman_v00.glb
case $N in *_dak*) TH=desert; FIG=$E/afrika_v00.glb;; *_winter*) TH=snow; FIG=$E/winter_v00.glb;; esac
V=${2:-game1,game2,close,close_se}
timeout 150 node $T/render.mjs $G $D/review --views $V --theater $TH --fig $FIG 2>&1 | grep -vE "^HTTP|^sheet" | tail -2
python3 $(dirname $0)/sheet.py $D/review/$N "$N" $V
