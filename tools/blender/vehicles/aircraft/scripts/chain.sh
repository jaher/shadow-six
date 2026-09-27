#!/bin/bash
# chain.sh "script:variants" ... -> sequential background builds (one Blender at a time), logs in ../logs/
D=$(cd "$(dirname "$0")" && pwd)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
for job in "$@"; do
  sc=${job%%:*}; va=${job#*:}
  LOG=$D/../logs/$(basename $sc .py)_$(echo $va | tr ',' '-').log
  PYTHONPATH=$S/realism/blender-modeling/pydeps42 BAKE_DEVICE=${BAKE_DEVICE:-GPU} timeout 2400 $B -b --factory-startup --python-use-system-env --python $D/$sc -- $va > $LOG 2>&1
done
