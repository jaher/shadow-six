#!/bin/bash
# fast.sh <script.py> <variants> -> quick build without AO into ../fast/, log ../logs/fast_<script>.log (background)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$(cd "$(dirname "$0")" && pwd)
LOG=$D/../logs/fast_$(basename $1 .py).log
RAIL_FAST=1 PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=CPU nohup timeout 900 $B -b --factory-startup --python-use-system-env --python $D/$1 -- $2 > $LOG 2>&1 &
echo $LOG
