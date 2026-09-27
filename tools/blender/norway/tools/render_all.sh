#!/bin/bash
# render review sheets for every asset whose GLB is newer than its sheet
O=<claude-tmp>
KIT=<claude-tmp>
cd $O
for d in */; do
  n=${d%/}; g=$n/$n.glb; s=$n/review/${n}_sheet.jpg
  [ -f $g ] || continue
  if [ ! -f $s ] || [ $g -nt $s ]; then
    th=""; [[ $n == *_snow ]] && th="--theater snow"
    timeout 100 node $KIT/review/render.mjs $g $n/review --views game1,game2,close,close_se,front,top --lod $th > /dev/null 2>&1 &
    while [ $(jobs -r | wc -l) -ge 3 ]; do sleep 1; done
  fi
done
wait
echo RENDERED
