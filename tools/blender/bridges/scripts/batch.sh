#!/bin/bash
# batch.sh script.py v1[:theater] v2 ...  -> sequential run.sh, summary in tmp/batch_<first>.txt
D=<claude-tmp>
scr=$1; shift
for vt in "$@"; do
  v=${vt%%:*}; th=${vt#*:}; [ "$th" = "$vt" ] && th=temperate
  echo "=== $v ($th)"; bash $D/scripts/run.sh $scr $v 25000 --theater $th 2>&1 | grep -E "LOD0|tris|Error|Traceback|DONE" | head -8
done
