#!/bin/bash
# review_all.sh [types...] - per soldierType review renders into review/<type>/ (faces, lineup, lineup_back, game1x, game2x
# for all variants; turnaround + strips walk/run/crawl/shoot/die for the type's first variant). Needs serve.mjs on $PORT.
E=$(cd "$(dirname "$0")/.." && pwd); P=$E/../pipeline; export PORT=${PORT:-8797}
TYPES=${@:-rifleman trooper sentry sergeant officer mg engineer crew afrika winter general}
for t in $TYPES; do
  mkdir -p $E/review/$t
  CH=$(python3 - "$t" <<'PY'
import json, sys
t = sys.argv[1]; idx = json.load(open('<claude-tmp>'))[t]
W = {'rifleman': 'kar98k', 'trooper': 'mp40', 'sentry': 'kar98k', 'sergeant': 'luger', 'officer': 'walther_p38', 'mg': 'mg34', 'engineer': None, 'crew': 'walther_p38', 'afrika': 'kar98k', 'winter': 'kar98k', 'general': None}[t]
CL = {'sentry': 'smoke', 'general': 'idle_hands_back', 'officer': 'idle', 'sergeant': 'idle'}
out = []
for k, v in enumerate(idx):
    d = {'url': '/chars/enemies/out/' + v['id'] + '.glb', 'name': v['id']}
    if W: d['weapon'] = W
    out.append(d)
print(json.dumps(out))
PY
)
  N=$(echo "$CH" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
  COLS=$(( N > 8 ? 8 : N )); ROWS=$(( (N + COLS - 1) / COLS ))
  LH=$(python3 -c "print(int(1600 * ($ROWS * 2.25) / ($COLS * 0.95 + 0.2)))")
  FH=$(( 1600 * ROWS * 2 * 10 / (COLS * 8) ))
  cd $P
  JOB_ARGS="{\"chars\":$CH,\"views\":[\"faces\"],\"cols\":$COLS}" timeout 170 node tools/run_page.mjs ../enemies/web/review_enemies.js $E/review/$t/$t 1600 $FH > /dev/null 2>&1
  JOB_ARGS="{\"chars\":$CH,\"views\":[\"lineup\",\"lineup_back\"],\"cols\":$COLS}" timeout 170 node tools/run_page.mjs ../enemies/web/review_enemies.js $E/review/$t/$t 1600 $LH > /dev/null 2>&1
  JOB_ARGS="{\"chars\":$CH,\"views\":[\"game1x\",\"game2x\"]}" timeout 170 node tools/run_page.mjs ../enemies/web/review_enemies.js $E/review/$t/$t 1600 900 > /dev/null 2>&1
  C1=$(echo "$CH" | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin)[:1]))")
  JOB_ARGS="{\"chars\":$C1,\"weapons\":\"/chars/out/weapons.glb\",\"views\":[\"turn\"]}" timeout 120 node tools/run_page.mjs web/jobs/review.js $E/review/$t/$t 1600 700 > /dev/null 2>&1
  JOB_ARGS="{\"chars\":$C1,\"views\":[\"strip\"],\"clips\":[\"walk\",\"run\",\"crawl\",\"rifle_shoot\",\"die\"],\"frames\":6}" timeout 150 node tools/run_page.mjs ../enemies/web/review_enemies.js $E/review/$t/$t 1500 420 > /dev/null 2>&1
  echo "$t: $(ls $E/review/$t | wc -l) images"
done
