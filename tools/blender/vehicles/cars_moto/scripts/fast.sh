#!/bin/bash
# fast.sh <script.py> <variants> [outsub] -> quick build without AO into ../fast/ (geometry checks)
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
S="${VEH_WORK:-$REPO/tools/blender/vehicles/.work}"
B=${B42:-blender}
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/fast_$(basename $1 .py)_$(echo $2 | tr ',' '-').log
VEH_FAST=1 VEH_OUT=$D/../fast PYTHONPATH=${PYDEPS42:-$REPO/tools/blender/vehicles/pydeps42} nohup timeout 900 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
