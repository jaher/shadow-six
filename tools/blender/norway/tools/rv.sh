#!/bin/bash
# rv.sh name [views]  -> render review sheet for out/<name>
O=<claude-tmp>
KIT=<claude-tmp>
n=$1; v=${2:-game1,game2,close,close_se,front,top}
th=""; [[ $n == *_snow ]] && th="--theater snow"
cd $O && timeout 110 node $KIT/review/render.mjs $n/$n.glb $n/review --views $v --lod $th > $n/review/render.log 2>&1; echo "RV $n $?"
