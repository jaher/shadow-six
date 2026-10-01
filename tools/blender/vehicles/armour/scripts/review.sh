#!/bin/bash
# review.sh <name> [extra render args]: renders grey game1/game2/close/close_se + dak/winter/burnt closes + LODs,
# composes review/<name>/<name>_review.jpg (<=1280 px). Usage from vehicles/armour.
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
N=$1; shift
cd $REPO/tools/blender/vehicles/armour
FIG=$REPO/assets/characters/enemies/crew_v00.glb
O=review/$N; mkdir -p $O
R="timeout 170 node review_tool/render.mjs"
$R out/$N/${N}_lod0.glb $O --views game1,game2,close,close_se --fig $FIG "$@" | grep -v HTTP | tail -1
$R out/$N/${N}_lod0.glb $O --views close --variant dak --theater desert --tag _dak --fig $FIG "$@" | tail -1
$R out/$N/${N}_lod0.glb $O --views close_se --variant winter --theater snow --tag _winter --fig $FIG "$@" | tail -1
[ -f out/$N/${N}_burnt_lod0.glb ] && $R out/$N/${N}_burnt_lod0.glb $O --views close --tag _burnt --fig $FIG "$@" | tail -1
$R out/$N/${N}_lod1.glb $O --views game1 --tag _lod1 "$@" | tail -1
$R out/$N/${N}_lod2.glb $O --views game05 --tag _lod2 "$@" | tail -1
python3 scripts/compose.py $O/${N}_review.jpg "$N" $O/${N}_lod0_game1.png $O/${N}_lod0_game2.png $O/${N}_lod0_close.png $O/${N}_lod0_close_se.png \
  $O/${N}_lod0_dak_close.png $O/${N}_lod0_winter_close_se.png $O/${N}_burnt_lod0_burnt_close.png $O/${N}_lod1_lod1_game1.png
