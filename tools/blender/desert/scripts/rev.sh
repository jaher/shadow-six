#!/bin/bash
# rev.sh name... : render review views (desert) + near-black metric
D=<claude-tmp>
K=<claude-tmp>
for n in "$@"; do
  timeout 170 node $K/review/render.mjs $D/out/$n/$n.glb $D/out/$n/review --views game1,game2,close,close_se,detail,front,top --theater desert --lod > $D/logs/rev_$n.log 2>&1
  python3 - "$D/out/$n/review/${n}_game2.png" "$D/out/$n/review/${n}_game1.png" <<'PY'
import sys
from PIL import Image
import numpy as np
for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert('RGB')).astype(int)
    blk = (a.max(-1) < 20).mean() * 100
    dark = (a.max(-1) < 45).mean() * 100
    print(p.split('/')[-1], 'black<20: %.2f%%  dark<45: %.2f%%' % (blk, dark))
PY
  python3 $K/tools/validate.py $D/out/$n/$n.glb --budget ${BUDGET:-15000} 2>&1 | tail -4
done
