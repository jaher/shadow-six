#!/bin/bash
# review_all.sh: waits for rebuild_all, then reviews every armour asset in two chains -> logs/review_all.done
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
cd $REPO/tools/blender/vehicles/armour
until [ -f scripts/logs/rebuild_all.done ]; do sleep 5; done
( for n in sdkfz251_c flak88 mgnest_ring panzer4_g panzer3_l mg42_tripod morser18_21cm; do bash scripts/review.sh $n > scripts/logs/rev_$n.log 2>&1; done ) &
( for n in sdkfz231_8rad mgnest_horseshoe panzer4_f2 panzer3_j panzer2_f mg34_tripod; do bash scripts/review.sh $n > scripts/logs/rev_$n.log 2>&1; done ) &
wait
echo DONE > scripts/logs/review_all.done
