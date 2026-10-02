#!/usr/bin/env bash
# Studio renders (kit review renderer, ortho game view zoom 1 by default (VIEW=game2 for zoom 2), yaw 15) of every fuel-tank type: snow, desert, destroyed.
HERE="$(cd "$(dirname "$0")" && pwd)"; O=${1:-$HERE/out/studio}; mkdir -p "$O"
T="fuel_tank_h_cradle fuel_tank_h_cradle_m fuel_tank_farm_9x7 fuel_tank_farm_85x63 fuel_tank_quay_12 fuel_tank_quay_11 fuel_tank_elevated oil_tank_column oil_tank_column_b fuel_tank_vertical_t"
for n in $T; do
  s=$n; [ -d "$HERE/out/${n}_snow" ] && s=${n}_snow
  YAW=15 "$HERE/rev.sh" $s snow ${VIEW:-game1} "$O/snow" > /dev/null
  YAW=15 "$HERE/rev.sh" $n desert ${VIEW:-game1} "$O/desert" > /dev/null
  d=${n}_destroyed; th=desert; [ -d "$HERE/out/${n}_destroyed_snow" ] && d=${n}_destroyed_snow && th=snow
  YAW=15 "$HERE/rev.sh" $d $th ${VIEW:-game1} "$O/destroyed" > /dev/null
  echo "$n done"
done
