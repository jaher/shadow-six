#!/bin/bash
E=<claude-tmp>
for n in "$@"; do timeout 300 env -u PYTHONPATH node $E/review_eu/render.mjs $E/out/$n/$n.glb $E/out/$n/review --views ${VIEWS:-game1,game2,close,close_se,front,top} --lod > $E/logs/$n.review.log 2>&1; echo "REV $n rc=$?"; done
