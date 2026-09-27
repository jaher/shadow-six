#!/bin/bash
# rebuild every desert asset (4 in parallel) -> logs/rebuild_all.log
D=<claude-tmp>
cd $D
JOBS=(
"house_flat_white.py house_flat_white_a a" "house_flat_white.py house_flat_white_b b" "house_flat_white.py house_flat_white_c c"
"house_adobe.py house_adobe_a a" "house_adobe.py house_adobe_b b" "house_adobe.py house_adobe_c c"
"compound_courtyard.py compound_courtyard_a a" "compound_courtyard.py compound_courtyard_b b"
"mosque.py mosque_tunis all" "mosque.py minaret_tunis minaret"
"barracks_desert.py barracks_desert_a a" "barracks_desert.py barracks_desert_a_destroyed a_destroyed"
"barracks_desert.py barracks_desert_b b" "barracks_desert.py barracks_desert_b_destroyed b_destroyed"
"tent_command.py tent_command intact" "tent_command.py tent_command_destroyed destroyed"
"fuel_depot.py fuel_depot intact" "fuel_depot.py fuel_depot_destroyed destroyed"
"drilling_rig.py drilling_rig intact" "drilling_rig.py drilling_rig_destroyed destroyed"
"well_desert.py well_desert_a a" "well_desert.py well_desert_b b"
"wall_octagon.py wall_octagon_seg seg" "wall_octagon.py wall_octagon_corner corner" "wall_octagon.py wall_octagon_gate gate" "wall_octagon.py wall_octagon_breach breach")
for j in "${JOBS[@]}"; do
  while [ $(jobs -r | wc -l) -ge ${PAR:-4} ]; do sleep 2; done
  BAKE_DEVICE=CPU ./build.sh $j &
done
wait
for j in "${JOBS[@]}"; do set -- $j; echo "$2 $(grep -o "tris': [0-9]*" logs/$2.log | head -1) $(tail -1 logs/$2.log)"; done
echo ALLDONE
