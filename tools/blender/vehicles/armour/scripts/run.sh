#!/bin/bash
# usage: run.sh script.py [args...]  -> logs/<script>_<args>.log (background)
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
S="${VEH_WORK:-$REPO/tools/blender/vehicles/.work}"
cd $S/vehicles/armour/scripts; mkdir -p logs
LOG=logs/$(basename $1 .py)_$(echo "${@:2}" | tr ' ' '_').log
PYTHONPATH=${PYDEPS42:-$REPO/tools/blender/vehicles/pydeps42} BAKE_DEVICE=${BAKE_DEVICE:-GPU} timeout ${TMO:-1500} ${B42:-blender} -b --factory-startup --python-use-system-env --python $1 -- "${@:2}" > $LOG 2>&1
echo EXIT $? >> $LOG
