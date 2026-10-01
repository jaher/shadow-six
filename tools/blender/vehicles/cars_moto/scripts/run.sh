#!/bin/bash
# run.sh <script.py> <variants(comma)>  -> background Blender build, log in ../logs/
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
S="${VEH_WORK:-$REPO/tools/blender/vehicles/.work}"
B=${B42:-blender}
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/$(basename $1 .py)_$(echo $2 | tr ',' '-').log
PYTHONPATH=${PYDEPS42:-$REPO/tools/blender/vehicles/pydeps42} BAKE_DEVICE=CPU nohup timeout 2400 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
