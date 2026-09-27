#!/bin/bash
# fast.sh <script.py> <variants> -> no-AO build into ../fast/<asset>/ (log logs/fast_<script>_<vars>.log)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/fast_$(basename $1 .py)_$(echo $2 | tr ',' '-').log
NAV_FAST=1 PYTHONPATH=$S/realism/blender-modeling/pydeps42 nohup timeout 900 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
