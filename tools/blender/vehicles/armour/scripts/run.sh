#!/bin/bash
# usage: run.sh script.py [args...]  -> logs/<script>_<args>.log (background)
S=<claude-tmp>
cd $S/vehicles/armour/scripts; mkdir -p logs
LOG=logs/$(basename $1 .py)_$(echo "${@:2}" | tr ' ' '_').log
PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=${BAKE_DEVICE:-GPU} timeout ${TMO:-1500} <claude-tmp> -b --factory-startup --python-use-system-env --python $1 -- "${@:2}" > $LOG 2>&1
echo EXIT $? >> $LOG
