#!/bin/bash
# refresh docs/screenshots/art-norway-*.jpg from the review renders (rework 2)
T=<claude-tmp>
D=<repo>/docs/screenshots
python3 $T/hero.py $D/art-norway-village.jpg "SHADOW SIX - Norway village (rework 2): timber houses, barns w/ sloped dry-stone wing walls, naust, cabins, rorbu, hjell" \
  house_timber_a:close house_timber_b:close house_timber_c:close barn_a:close barn_b:close naust_a:close naust_b:close log_cabin_a:close fishing_shed_b:close drying_rack_a:close drying_rack_b:close fishing_shed_a:close
python3 $T/hero.py $D/art-norway-military.jpg "SHADOW SIX - Norway military / infrastructure (rework 2)" \
  barracks_a:close barracks_b:close barracks_cd:close guard_hut_a:close guard_hut_b:close radar_dish_a:close radar_dish_ad:close radar_building_a:close radar_building_ad:close dam_house_b:close cable_station_lower:close cable_car_cabin:close
python3 $T/hero.py $D/art-norway-winter.jpg "SHADOW SIX - Norway winter variants (rework 2): wind ripples, scoured ridges, bare patches, cornices, drifts (game zoom 1x)" \
  house_timber_a_snow:game1:0.6 house_timber_c_snow:game1:0.6 barn_a_snow:game1:0.6 barracks_a_snow:game1:0.6 barracks_ad_snow:game1:0.6 naust_b_snow:game1:0.6 log_cabin_a_snow:game1:0.6 radar_building_ad_snow:game1:0.6 cable_station_lower_snow:game1:0.6
