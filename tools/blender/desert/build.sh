#!/bin/bash
# build.sh script.py name [args...] -> out/<name>/ ; logs in logs/
S=<claude-tmp>
B42=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$S/art/desert
export PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=${BAKE_DEVICE:-CPU}
export DZ_LOD2=${DZ_LOD2:-0.12,1.2,6}
mkdir -p $D/logs
scr=$1; name=$2; shift 2
timeout 600 $B42 -b --factory-startup --python-use-system-env --python $D/scripts/$scr -- $D/out/$name "$@" > $D/logs/$name.log 2>&1
echo "EXIT $? $name" >> $D/logs/$name.log
