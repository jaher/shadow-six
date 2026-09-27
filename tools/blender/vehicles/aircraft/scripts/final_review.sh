#!/bin/bash
# final_review.sh <asset> <C1> <C2> : grey review sheet (game1/game2/close/close_se + soldier) + variant closes grid
cd $(dirname $0)
A=$1; O=../out/$A/review
C1=$2 C2=$3 bash review.sh ../out/$A/${A}_grey.glb game1,game2,close,close_se | tail -1
L=""
for v in dak winter burnt; do
  [ -f ../out/$A/${A}_$v.glb ] && ./rv.sh ../out/$A/${A}_$v.glb close_se > /dev/null && L="$L $O/${A}_${v}_close_se.png"
done
./rv.sh ../out/$A/${A}_grey_lod1.glb game1 > /dev/null; ./rv.sh ../out/$A/${A}_grey_lod2.glb game05 > /dev/null
python3 grid.py $O/${A}_variants.jpg 3 $O/${A}_grey_close_se.png $L $O/${A}_grey_lod1_game1.png $O/${A}_grey_lod2_game05.png | tail -1
