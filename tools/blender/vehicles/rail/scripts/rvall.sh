#!/bin/bash
# rvall.sh <root: out|fast> <views> name1 name2 ... -> review renders (sequential, background-safe), log ../logs/rvall.log
D=$(cd "$(dirname "$0")" && pwd); R=$1; V=$2; shift 2
for n in "$@"; do a=$(echo $n | sed -E 's/_(dr|winter|burnt|grey|dak|brown|green|rust|black|wood)$//')
  echo "$(date +%T) $n" >> $D/../logs/rvall.log
  bash $D/review.sh $D/../$R/$a/$n.glb $V >> $D/../logs/rvall.log 2>&1; done
echo "$(date +%T) ALLDONE" >> $D/../logs/rvall.log
