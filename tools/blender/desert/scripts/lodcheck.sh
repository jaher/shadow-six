#!/bin/bash
# lodcheck.sh name... : render game05 + LOD1/LOD2 @0.5x, print mean abs diff (x100/255) LOD0-LOD1, LOD0-LOD2, LOD1-LOD2
D=<claude-tmp>
K=<claude-tmp>
for n in "$@"; do
  [ -n "$NORENDER" ] || timeout 120 node $K/review/render.mjs $D/out/$n/$n.glb $D/out/$n/review --views game05 --theater desert --lod > $D/logs/lodc_$n.log 2>&1
  python3 - $D/out/$n/review $n <<'PY'
import sys
from PIL import Image
import numpy as np
d, n = sys.argv[1:]
L = [np.asarray(Image.open(f'{d}/{n}_{s}.png').convert('RGB')).astype(float) for s in ('game05', 'lod1@05x', 'lod2@05x')]
def df(a, b):
    e = np.abs(a - b).max(-1)
    return '%5.2f/%5.2f%%' % (e.mean() / 2.55, (e > 50).mean() * 100)
print('%-28s L0-L1 %s  L0-L2 %s  L1-L2 %s  (mean/%%px>50)' % (n, df(L[0], L[1]), df(L[0], L[2]), df(L[1], L[2])))
PY
done
