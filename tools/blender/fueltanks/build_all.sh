#!/usr/bin/env bash
# Rebuild the whole fuel-tank family (docs/fuel-tanks.md), 4 Blender jobs at a time, then ship (pack + manifest).
#   B42=<blender 4.2> PYD=<pydeps with Pillow/numpy> tools/blender/fueltanks/build_all.sh
HERE="$(cd "$(dirname "$0")" && pwd)"
jobs=()
for a in fuel_tank_h_cradle fuel_tank_h_cradle_m; do
  for st in intact destroyed; do jobs+=("$a $st 11" "$a $st 11 snow"); done
done
for a in fuel_tank_farm_9x7 fuel_tank_farm_85x63 fuel_tank_quay_12 fuel_tank_quay_11 fuel_tank_elevated oil_tank_column; do
  for st in intact destroyed; do jobs+=("$a $st 11"); done
done
for st in intact destroyed; do jobs+=("oil_tank_column_b $st 12" "fuel_tank_vertical_t $st 13"); done
n=0
for j in "${jobs[@]}"; do
  "$HERE/run1.sh" $j &
  n=$((n + 1)); if (( n % 4 == 0 )); then wait; fi
done
wait
grep -l Traceback "$HERE"/out/logs/*.log && exit 1
python3 "$HERE/ship.py"
