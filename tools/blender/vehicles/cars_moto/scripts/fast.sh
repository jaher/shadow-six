#!/bin/bash
# fast.sh <script.py> <variants> [outsub] -> quick build without AO into ../fast/ (geometry checks)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/fast_$(basename $1 .py)_$(echo $2 | tr ',' '-').log
VEH_FAST=1 VEH_OUT=$D/../fast PYTHONPATH=$S/realism/blender-modeling/pydeps42 nohup timeout 900 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
