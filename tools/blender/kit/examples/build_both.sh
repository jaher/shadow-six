#!/bin/bash
B42=<claude-tmp>
export PYTHONPATH=<claude-tmp> BAKE_DEVICE=${BAKE_DEVICE:-GPU}
cd "$(dirname "$0")"
for s in "$@"; do timeout 400 $B42 -b --factory-startup --python-use-system-env --python $s > ${s%.py}.log 2>&1; grep -E "kit\] (LOD0|AO)|Error|Traceback" ${s%.py}.log; done
echo ALLDONE
