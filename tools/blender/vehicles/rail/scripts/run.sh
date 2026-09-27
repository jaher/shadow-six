#!/bin/bash
# run.sh <script.py> <variants(comma)>  -> background Blender build, log in ../logs/
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/$(basename $1 .py)_$(echo $2 | tr ',' '-').log
PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=CPU nohup timeout 2400 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
