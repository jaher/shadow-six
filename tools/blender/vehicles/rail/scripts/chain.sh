#!/bin/bash
# chain.sh "script.py:variants" ... -> sequential background builds (one Blender at a time), log logs/chain_<pid>.log
D=$(cd "$(dirname "$0")" && pwd)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
( for j in "$@"; do sc=${j%%:*}; v=${j##*:}; LOG=$D/../logs/$(basename $sc .py)_$(echo $v | tr ',' '-').log
  echo "$(date +%T) start $j" >> $D/../logs/chain.log
  PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=CPU timeout 2400 $B -b --factory-startup --python-use-system-env --python $D/$sc -- $v > $LOG 2>&1
  echo "$(date +%T) done $j $(grep -c finalized $LOG) $(grep -c Traceback $LOG)" >> $D/../logs/chain.log; done ) > /dev/null 2>&1 &
echo chain started
