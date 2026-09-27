#!/bin/bash
# rc.sh glb out.png cx cy cz dist az el [ortho]  (game coords; Blender EEVEE close-up, 900x600)
S=<claude-tmp>
B=$S/realism/characters/blender-4.2.9-linux-x64/blender
D=$(cd "$(dirname "$0")/.." && pwd)
timeout 110 $B -b --factory-startup --python $D/review_rd/rc.py -- "$1" "$2" $3 $4 $5 $6 $7 $8 ${9:-0} 2>&1 | grep -E "Saved|Error" | tail -1
