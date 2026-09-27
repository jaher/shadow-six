#!/bin/bash
# revnew.sh: review every LOD0 glb whose sheet is missing or older than the glb (skips files still being written: <20 s old)
D=$(cd "$(dirname "$0")/.." && pwd)
for g in $D/out/*/*.glb; do
  case $g in *_lod1.glb|*_lod2.glb) continue;; esac
  n=$(basename $g .glb); s=$(dirname $g)/review/${n}_sheet.jpg
  [ -f $(dirname $g)/$n.credits.json ] || continue
  [ $(( $(date +%s) - $(stat -c %Y $(dirname $g)/$n.credits.json) )) -lt 20 ] && continue
  if [ ! -f $s ] || [ $s -ot $g ]; then bash $D/scripts/review.sh $g 2>&1 | tail -1; fi
done
