#!/bin/bash
# usage: run.sh script.py variant [seed] [--theater X] -> builds, validates, renders review
S=<claude-tmp>
KIT=$S/art/kit; MIL=$S/art/military
B42=$S/realism/characters/blender-4.2.9-linux-x64/blender
PP=$S/realism/blender-modeling/pydeps42; export BAKE_DEVICE=CPU
scr=$1; var=$2; seed=$3; th=${4:-temperate}; budget=${5:-15000}; extra=$6
base=$(basename $scr .py); tag=${base}_${var}
mkdir -p $MIL/logs
PYTHONPATH=$PP timeout 900 $B42 -b --factory-startup --python-use-system-env --python $MIL/scripts/$scr -- $var $seed > $MIL/logs/$tag.log 2>&1
grep -E "kit\] (LOD|AO|recent)|Error|Traceback|line [0-9]+" $MIL/logs/$tag.log | tail -15
name=$(grep -oE "finalized [a-z0-9_]+" $MIL/logs/$tag.log | awk '{print $2}')
[ -z "$name" ] && { echo "BUILD FAILED $tag"; exit 1; }
o=$MIL/out/$name
python3 $KIT/tools/validate.py $o/$name.glb --budget $budget $extra 2>&1 | tail -12
timeout 300 node $KIT/review/render.mjs $o/$name.glb $o/review --views ${VIEWS:-game1,game2,close,close_se,front,top} --lod --theater $th > $MIL/logs/${tag}_review.log 2>&1
tail -3 $MIL/logs/${tag}_review.log
echo "DONE $name"
