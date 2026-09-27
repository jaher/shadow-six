#!/bin/bash
# relod.sh name... : rebuild LOD1/LOD2 from the .blend (lodfix) + lodcheck metric
D=<claude-tmp>
B42=<claude-tmp>
cd $D
for n in "$@"; do
  PYTHONPATH=<claude-tmp> timeout 150 $B42 -b --python-use-system-env out/$n/$n.blend --python scripts/relod.py -- out/$n > logs/relod_$n.log 2>&1
  grep -E "LODFIX" logs/relod_$n.log | sed "s/^/$n /"; grep -E "Error" logs/relod_$n.log
  [ -n "$NOCHECK" ] || scripts/lodcheck.sh $n
done
