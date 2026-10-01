#!/bin/bash
# fast.sh <script.py> <variants> -> quick build without AO into ../fast/, log ../logs/fast_<script>.log (background)
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
S="${VEH_WORK:-$REPO/tools/blender/vehicles/.work}"
B=${B42:-blender}
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/fast_$(basename $1 .py).log
RAIL_FAST=1 PYTHONPATH=${PYDEPS42:-$REPO/tools/blender/vehicles/pydeps42} BAKE_DEVICE=CPU nohup timeout 900 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
