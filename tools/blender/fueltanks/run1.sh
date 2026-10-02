#!/usr/bin/env bash
# run1.sh <asset> [intact|destroyed] [seed] [snow] -> out/<name>/ ; log in out/logs/
HERE="$(cd "$(dirname "$0")" && pwd)"
B42=${B42:-<claude-tmp>
PYD=${PYD:-<claude-tmp>
mkdir -p "$HERE/out/logs"
tag="$1_${2:-intact}${4:+_$4}"
# wrecks: soot-black shells may go darker than the kit albedo floor (0.045 linear) without reading as a void
AF=0.045; [ "${2:-intact}" = destroyed ] && AF=0.022
DZ_AFLOOR=$AF PYTHONPATH=$PYD BAKE_DEVICE=CPU timeout 900 "$B42" -b --factory-startup --python-use-system-env \
  --python "$HERE/fuel_tanks.py" -- "$HERE/out" "$@" > "$HERE/out/logs/$tag.log" 2>&1
echo "$tag rc=$?"
