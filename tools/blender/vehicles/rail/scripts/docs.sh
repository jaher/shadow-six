#!/bin/bash
# docs.sh -> refresh docs/screenshots/veh-rail-*.jpg from out/*/review PNGs (run after review_all)
D=$(cd "$(dirname "$0")" && pwd); O=$D/../out; SS=<repo>/docs/screenshots
r() { echo "$1=$O/$2/review/$3_$4.png"; }
python3 $D/compose.py $SS/veh-rail-lineup.jpg "SHADOW SIX rail group (rework 2): close views, 1.8 m soldier for scale" 4 320 close \
  $(r loco_br52 loco_br52 loco_br52_dr close_se) $(r tender_t30 tender_t30 tender_t30_dr close_se) $(r railgun_k5 railgun_k5 railgun_k5_grey close_se) \
  $(r coach coach coach_green close_se) $(r wagon_open wagon_open wagon_open_brown close_se) $(r wagon_tank wagon_tank wagon_tank_grey close_se) \
  $(r wagon_covered wagon_covered wagon_covered_brown close_se) $(r wagon_flat wagon_flat wagon_flat_brown close_se) $(r tram_fr tram_fr tram_fr_green close_se) \
  $(r mine_tipper mine_tipper mine_tipper_rust close_se) $(r mine_cart mine_cart mine_cart_rust close_se) $(r handcar handcar handcar_wood close_se) \
  $(r rail_crane rail_crane rail_crane_black close_se) $(r crane_idler rail_crane_idler rail_crane_idler_black close_se)
python3 $D/compose.py $SS/veh-rail-variants.jpg "Rail variants: winter / DAK-Italy camo / burnt wrecks" 4 320 close \
  $(r loco_winter loco_br52 loco_br52_winter close) $(r loco_burnt loco_br52 loco_br52_burnt close) $(r tender_winter tender_t30 tender_t30_winter close) $(r tender_burnt tender_t30 tender_t30_burnt close) \
  $(r k5_dak railgun_k5 railgun_k5_dak close) $(r k5_winter railgun_k5 railgun_k5_winter close) $(r k5_burnt railgun_k5 railgun_k5_burnt close_se) $(r tank_burnt wagon_tank wagon_tank_burnt close_se) \
  $(r coach_winter coach coach_winter close) $(r coach_burnt coach coach_burnt close) $(r open_winter wagon_open wagon_open_winter close) $(r tram_burnt tram_fr tram_fr_burnt close)
python3 $D/compose.py $SS/veh-rail-game.jpg "Rail group at the game camera (40 deg, 2x zoom)" 4 320 game2 \
  $(r loco loco_br52 loco_br52_dr game2) $(r tender tender_t30 tender_t30_dr game2) $(r k5 railgun_k5 railgun_k5_grey game2) $(r open wagon_open wagon_open_brown game2) \
  $(r tank wagon_tank wagon_tank_grey game2) $(r coach coach coach_green game2) $(r tram tram_fr tram_fr_green game2) $(r crane rail_crane rail_crane_black game2)
python3 $D/compose.py $SS/veh-rail-side.jpg "Rail group side elevations (east side = vehicle left, +X)" 4 320 side \
  $(r loco loco_br52 loco_br52_dr side_e) $(r tender tender_t30 tender_t30_dr side_e) $(r k5 railgun_k5 railgun_k5_grey side_e) $(r k5_burnt railgun_k5 railgun_k5_burnt side_e) \
  $(r coach coach coach_green side_e) $(r open wagon_open wagon_open_brown side_e) $(r tank wagon_tank wagon_tank_grey side_e) $(r covered wagon_covered wagon_covered_brown side_e) \
  $(r flat wagon_flat wagon_flat_brown side_e) $(r tram tram_fr tram_fr_green side_e) $(r crane rail_crane rail_crane_black side_e) $(r handcar handcar handcar_wood side_e)
python3 $D/compose.py $SS/veh-rail-wrecks.jpg "Rail wrecks: burnt variants stay on the rails (bogies/wheelsets seated), K5 barrel section beside the track" 4 320 close \
  $(r loco loco_br52 loco_br52_burnt close_se) $(r tender tender_t30 tender_t30_burnt close_se) $(r k5 railgun_k5 railgun_k5_burnt close_se) $(r tank wagon_tank wagon_tank_burnt close_se) \
  $(r coach coach coach_burnt close_se) $(r open wagon_open wagon_open_burnt close_se) $(r covered wagon_covered wagon_covered_burnt close_se) $(r flat wagon_flat wagon_flat_burnt close_se)
ls -la $SS/veh-rail-*
