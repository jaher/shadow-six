#!/bin/bash
# rvset.sh <root> "name:views" ... -> sequential review renders (background), log ../logs/rvset.log
D=$(cd "$(dirname "$0")" && pwd); R=$1; shift
for j in "$@"; do n=${j%%:*}; v=${j##*:}; a=$(echo $n | sed -E 's/_(dr|winter|burnt|grey|dak|brown|green|rust|black|wood)$//')
  echo "$(date +%T) $n $v" >> $D/../logs/rvset.log
  bash $D/review.sh $D/../$R/$a/$n.glb $v >> $D/../logs/rvset.log 2>&1; done
echo "$(date +%T) ALLDONE" >> $D/../logs/rvset.log
