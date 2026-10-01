#!/bin/bash
# docs.sh : refresh docs/screenshots/veh-aircraft-{lineup,gamecam,rework}.jpg from the review renders
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
cd $(dirname $0)/../out
D=$REPO/docs/screenshots
r() { echo "$1=$2/review/$2_$3.png"; }
python3 ../scripts/compose_docs.py $D/veh-aircraft-lineup.jpg "SHADOW SIX aircraft group - grey (temperate) close 3/4 views" 4 \
  "$(r 'Ju 52/3m' ju52_3m grey_close_se)" "$(r 'Ju 87 B' ju87_b grey_close_se)" "$(r 'Bf 109 E' bf109_e grey_close_se)" \
  "$(r 'Fi 156 Storch' fi156_storch grey_close_se)" "$(r 'Fw C 30 autogiro' fw_c30_autogiro grey_close_se)" \
  "$(r 'fuel bowser' fuel_bowser grey_close_se)" "$(r 'bomb trolley' bomb_trolley grey_close_se)" "$(r 'starter cart' starter_cart grey_close_se)"
python3 ../scripts/compose_docs.py $D/veh-aircraft-gamecam.jpg "SHADOW SIX aircraft group - game camera (ortho 40 deg, 1x)" 4 \
  "$(r 'Ju 52/3m' ju52_3m grey_game1)" "$(r 'Ju 87 B' ju87_b grey_game1)" "$(r 'Bf 109 E' bf109_e grey_game1)" \
  "$(r 'Fi 156 Storch' fi156_storch grey_game1)" "$(r 'Fw C 30' fw_c30_autogiro grey_game1)" \
  "$(r 'fuel bowser' fuel_bowser grey_game1)" "$(r 'bomb trolley' bomb_trolley grey_game1)" "$(r 'starter cart' starter_cart grey_game1)"
python3 ../scripts/compose_docs.py $D/veh-aircraft-variants.jpg "SHADOW SIX aircraft rework 2 - dak / winter / burnt" 4 \
  "$(r 'Ju 52 dak' ju52_3m dak_close_se)" "$(r 'Ju 52 winter' ju52_3m winter_close_se)" "$(r 'Ju 52 burnt' ju52_3m burnt_close_se)" \
  "$(r 'Bf 109 E-7 trop (dak)' bf109_e dak_close_se)" "$(r 'Bf 109 winter' bf109_e winter_close_se)" "$(r 'Bf 109 burnt' bf109_e burnt_close_se)" \
  "$(r 'C 30 dak' fw_c30_autogiro dak_close_se)" "$(r 'C 30 burnt' fw_c30_autogiro burnt_close_se)" \
  "$(r 'bowser burnt' fuel_bowser burnt_close_se)" "$(r 'bowser burnt (game cam)' fuel_bowser burnt_game1)" \
  "$(r 'C 30 winter' fw_c30_autogiro winter_close_se)" "$(r 'bowser dak' fuel_bowser dak_close_se)"
