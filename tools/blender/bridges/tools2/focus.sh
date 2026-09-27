#!/bin/bash
# focus.sh <asset> <tag> <tx> <ty> <tz> <dist> <dx> <dy> <dz>  -> tmp/focus/<asset>_<tag>.png (detail view re-aimed)
D=<claude-tmp>
a=$1; tag=$2; W=$D/tmp/f_$a.$tag; mkdir -p $W $D/tmp/focus
cp $D/out/$a/$a.glb $W/; cp $D/out/$a/$a.kit.json $W/ 2>/dev/null
python3 - "$W/$a.kit.json" $3 $4 $5 $6 $7 $8 $9 <<'PY'
import json,sys
p=sys.argv[1]; j=json.load(open(p)); v=[float(x) for x in sys.argv[2:]]
j.setdefault('review',{})['detail']={'target':v[0:3],'dist':v[3],'dir':v[4:7]}
json.dump(j,open(p,'w'))
PY
timeout 200 env -u PYTHONPATH node $D/review2/render.mjs $W/$a.glb $W --views detail > $W/log.txt 2>&1
cp $W/${a}_detail.png $D/tmp/focus/${a}_$tag.png 2>/dev/null; tail -1 $W/log.txt
