#!/bin/bash
# usage: run.sh script.py variant [budget] [review-extra-args]   -> build (bg-safe), validate, render sheet
S=<claude-tmp>
KIT=$S/art/kit; D=$S/art/bridges; B42=$S/realism/characters/blender-4.2.9-linux-x64/blender
export PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=${BAKE_DEVICE:-CPU}
scr=$1; v=$2; bud=${3:-25000}; shift 3; mkdir -p $D/logs
timeout 900 $B42 -b --factory-startup --python-use-system-env --python $D/scripts/$scr -- $v > $D/logs/$v.log 2>&1
grep -E "kit\] (LOD|AO)|Error|Traceback" $D/logs/$v.log | head -20
env -u PYTHONPATH python3 $D/tools2/slim.py $D/out/$v > $D/logs/$v.slim 2>&1; tail -3 $D/logs/$v.slim
env -u PYTHONPATH python3 $KIT/tools/validate.py $D/out/$v/$v.glb --budget $bud --bridge > $D/logs/$v.val 2>&1; tail -15 $D/logs/$v.val
timeout 300 env -u PYTHONPATH node ${REV:-$D/review2}/render.mjs $D/out/$v/$v.glb $D/out/$v/review --views ${VIEWS:-game1,game05,close,close_se,detail,front,top} --lod "$@" > $D/logs/$v.rev 2>&1; tail -3 $D/logs/$v.rev
echo DONE $v
