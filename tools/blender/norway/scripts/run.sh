#!/bin/bash
# usage: run.sh script.py variant seed [snow]   -> logs/<script>_<variant>[_snow].log
S=<claude-tmp>
B42=$S/realism/characters/blender-4.2.9-linux-x64/blender
export PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=${BAKE_DEVICE:-CPU}
D=$(dirname "$0"); mkdir -p $D/logs
LOG=$D/logs/$(basename ${1%.py})_$2${4:+_$4}.log
timeout 600 $B42 -b --factory-startup --python-use-system-env --python $D/$1 -- $S/art/norway/out $2 $3 $4 > $LOG 2>&1
grep -E "kit\] (LOD|AO)|Error|Traceback" $LOG | head -8; echo "DONE $1 $2 $4"
