#!/bin/bash
# docs.sh: refresh docs/screenshots/veh-naval-{lineup,variants,elevations,closeups}.jpg from the review renders + Blender close-ups
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
D=$(cd "$(dirname "$0")/.." && pwd); O=$D/out; R=$D/review_rd; SS=$REPO/docs/screenshots
c() { echo "$O/$1/review/$1_$2_$3.png"; }
python3 $D/scripts/compose.py $SS/veh-naval-lineup.jpg "SHADOW SIX - naval craft (review renderer, close view, 1.8 m figure on the quay)" 4 320 close \
  "Bismarck grey=$(c battleship_bismarck grey close_se)" "Type VIIC=$(c uboat_viic grey close_se)" "harbour tug=$(c harbour_tug civil close_se)" \
  "HS 114 patrol boat=$(c patrol_boat grey close_se)" "fishing cutter=$(c fishing_boat white close_se)" "Biber=$(c minisub_biber grey close_se)" \
  "rowboat=$(c rowboat wood close_se)" "raft=$(c raft deployed close_se)"
python3 $D/scripts/compose.py $SS/veh-naval-variants.jpg "SHADOW SIX - naval variants (burnt = wrecked + fire field on paint, winter = snow)" 4 320 close \
  "Bismarck burnt=$(c battleship_bismarck burnt close_se)" "Bismarck camo=$(c battleship_bismarck camo close_se)" "VIIC burnt=$(c uboat_viic burnt close_se)" \
  "VIIC winter=$(c uboat_viic winter close_se)" "tug burnt=$(c harbour_tug burnt close_se)" "tug grey=$(c harbour_tug grey close_se)" \
  "patrol burnt=$(c patrol_boat burnt close_se)" "patrol winter=$(c patrol_boat winter close_se)" "fishing burnt=$(c fishing_boat burnt close_se)" \
  "fishing tarred=$(c fishing_boat tarred close_se)" "Biber burnt=$(c minisub_biber burnt close_se)" "tug winter=$(c harbour_tug winter close_se)"
python3 $D/scripts/compose.py $SS/veh-naval-elevations.jpg "SHADOW SIX - naval side elevations (orthographic, seen from starboard, bow to the right)" 2 640 none \
  "Bismarck 251 m=$(c battleship_bismarck grey elev)" "Type VIIC 67.1 m=$(c uboat_viic grey elev)" \
  "HS 114 13.5 m=$(c patrol_boat grey elev)" "Biber 9.04 m=$(c minisub_biber grey elev)" \
  "fishing cutter 12 m=$(c fishing_boat white elev)" "harbour tug 26 m=$(c harbour_tug civil elev)"
python3 $D/scripts/compose.py $SS/veh-naval-closeups.jpg "SHADOW SIX - naval close-ups (Blender EEVEE, no AO)" 3 420 none \
  "Bismarck bridge + tower=$R/d_s2.png" "38 cm turrets, blast bags=$R/d_s3.png" "Bismarck Atlantic bow=$R/d_s1.png" \
  "Bismarck burnt (final battle)=$R/d_s5.png" "VIIC Turm II=$R/d_ut.png" "VIIC knife stern + screws=$R/d_us.png" \
  "VIIC burnt stern breach=$R/d_ub.png" "Biber=$R/d_b1.png" "HS 114=$R/d_p1.png" \
  "fishing cutter stern gear=$R/d_f1.png" "tug stern gear=$R/d_t1.png" "tug burnt wheelhouse=$R/d_t2.png"
