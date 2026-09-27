#!/bin/bash
# final screenshots -> docs/screenshots/art-military-*.jpg
cd <claude-tmp>
D=<repo>/docs/screenshots; O=out
python3 mk_sheet.py $D/art-military-bridge.jpg 1800 3 "Castle gate moat bridge (rework 3): refuges + cutwaters, humped setts deck, splayed wings, drawbridge" \
  $O/castle_gate/review/castle_gate_game1s.png="game 1x (bridge)" $O/castle_gate/review/castle_gate_game2s.png="game 2x" \
  $O/castle_gate/review/castle_gate_side_e.png="from the east: arches, starlings" $O/castle_gate/review/castle_gate_close_se.png="close SE" $O/castle_gate_ruin/review/castle_gate_ruin_side_e.png="castle_gate_ruin (burnt spires, soot, rubble piles)" $O/castle_gate/review/castle_gate_side_w.png="from the west"
python3 mk_sheet.py $D/art-military-landmarks.jpg 1800 3 "Military landmarks (rework 3)" \
  $O/castle_gate/review/castle_gate_game1.png="castle_gate 1x" $O/uboat_pen/review/uboat_pen_close_se.png="uboat_pen (90 m)" $O/uboat_pen/review/uboat_pen_game2.png="uboat_pen roof 2x" \
  $O/hangar/review/hangar_close_se.png="hangar (canvas)" $O/hangar_a/review/hangar_a_close.png="hangar_a (corrugated)" $O/uboat_pen/review/uboat_pen_side_e.png="uboat_pen long wall (stair tower, pipes, lifts)" \
  $O/lighthouse/review/lighthouse_close_se.png="lighthouse" $O/lighthouse_destroyed/review/lighthouse_destroyed_close_se.png="lighthouse_destroyed" $O/castle_tower_ruin/review/castle_tower_ruin_close_se.png="castle_tower_ruin" \
  $O/uboat_pen_snow/review/uboat_pen_snow_game2.png="uboat_pen_snow 2x" $O/castle_wall_moat/review/castle_wall_moat_close_se.png="castle_wall_moat" $O/firing_range/review/firing_range_close_se.png="firing_range"
python3 mk_sheet.py $D/art-military-defences.jpg 1800 3 "Military defences (rework 3)" \
  $O/bunker/review/bunker_close_se.png="bunker (camo, net)" $O/bunker/review/bunker_game2.png="bunker 2x" $O/bunker_destroyed/review/bunker_destroyed_close_se.png="bunker_destroyed" \
  $O/casemate/review/casemate_close_se.png="casemate (M272 visor)" $O/casemate_camo/review/casemate_camo_game2.png="casemate_camo 2x" $O/mg_nest/review/mg_nest_game2.png="mg_nest 2x" \
  $O/casemate_camo/review/casemate_camo_close_se.png="casemate_camo (Heer paint)" $O/casemate_destroyed/review/casemate_destroyed_close_se.png="casemate_destroyed" $O/mg_nest_destroyed/review/mg_nest_destroyed_close_se.png="mg_nest_destroyed" \
  $O/watchtower/review/watchtower_close_se.png="watchtower" $O/watchtower_destroyed/review/watchtower_destroyed_close_se.png="watchtower_destroyed" $O/firing_range/review/firing_range_game1.png="firing_range 1x"
ls -la $D/art-military-*.jpg
