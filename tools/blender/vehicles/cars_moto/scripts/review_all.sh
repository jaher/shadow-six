#!/bin/bash
# review_all.sh -> review.sh on every LOD0 variant GLB in ../out (game1,game2,close,close_se), sequential
D=$(cd "$(dirname "$0")" && pwd)
for g in $D/../out/*/*.glb; do
  case $g in *_lod1.glb|*_lod2.glb) continue;; esac
  echo "== $(basename $g)"; $D/review.sh $g 2>&1 | tail -1
done
echo REVIEW_ALL_DONE
