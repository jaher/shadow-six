#!/bin/bash
# revall.sh glb... : sequential review sheets (background-friendly)
D=$(cd "$(dirname "$0")" && pwd)
for g in "$@"; do bash $D/review.sh $g ${VIEWS:-game1,game2,close,close_se} 2>&1 | tail -1; done
