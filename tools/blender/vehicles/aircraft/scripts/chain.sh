#!/bin/bash
# chain.sh "script:variants" ... -> sequential background builds (one Blender at a time), logs in ../logs/
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
D=$(cd "$(dirname "$0")" && pwd)
S="${VEH_WORK:-$REPO/tools/blender/vehicles/.work}"
B=${B42:-blender}
for job in "$@"; do
  sc=${job%%:*}; va=${job#*:}
  LOG=$D/../logs/$(basename $sc .py)_$(echo $va | tr ',' '-').log
  PYTHONPATH=${PYDEPS42:-$REPO/tools/blender/vehicles/pydeps42} BAKE_DEVICE=${BAKE_DEVICE:-GPU} timeout 2400 $B -b --factory-startup --python-use-system-env --python $D/$sc -- $va > $LOG 2>&1
done
