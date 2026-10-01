#!/bin/bash
# docs.sh -> docs/screenshots/veh-cars_moto-{lineup,variants,game}.jpg from the review renders
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
D=$(cd "$(dirname "$0")" && pwd); O=$D/../out; S=$REPO/docs/screenshots
R() { echo "$O/$1/review/$2_$3.png"; }
python3 $D/compose.py $S/veh-cars_moto-lineup.jpg "SHADOW SIX - cars & motorcycles (LOD0, close view, 1.8 m soldier for scale)" 4 320 close \
  "R75 grey=$(R r75_sidecar r75_sidecar_grey close)" "Kubel grey=$(R kubelwagen kubelwagen_grey close)" \
  "Horch 901 grey=$(R horch901 horch901_grey close)" "Citroen 11 black=$(R citroen11 citroen11_black close)" \
  "Willys MB od=$(R willys_mb willys_mb_od close)" "Blitz cargo grey=$(R opel_blitz_cargo opel_blitz_cargo_grey close)" \
  "Blitz tanker grey=$(R opel_blitz_tanker opel_blitz_tanker_grey close_se)" "Citroen 11 grey=$(R citroen11 citroen11_grey close_se)"
python3 $D/compose.py $S/veh-cars_moto-variants.jpg "cars & motorcycles - DAK / winter / destroyed variants" 4 320 close \
  "R75 dak=$(R r75_sidecar r75_sidecar_dak close)" "Kubel dak=$(R kubelwagen kubelwagen_dak close)" \
  "Horch dak=$(R horch901 horch901_dak close)" "Blitz winter=$(R opel_blitz_cargo opel_blitz_cargo_winter close)" \
  "R75 burnt=$(R r75_sidecar r75_sidecar_burnt close)" "Kubel burnt=$(R kubelwagen kubelwagen_burnt close)" \
  "Horch burnt=$(R horch901 horch901_burnt close)" "Citroen burnt=$(R citroen11 citroen11_burnt close)" \
  "Willys burnt=$(R willys_mb willys_mb_burnt close)" "Blitz cargo burnt=$(R opel_blitz_cargo opel_blitz_cargo_burnt close)" \
  "Tanker burnt=$(R opel_blitz_tanker opel_blitz_tanker_burnt close_se)" "Kubel winter=$(R kubelwagen kubelwagen_winter close)"
python3 $D/compose.py $S/veh-cars_moto-game.jpg "cars & motorcycles at the game camera (ortho 40 deg, 2x zoom = 80 px/m)" 4 320 game2 \
  "R75=$(R r75_sidecar r75_sidecar_grey game2)" "Kubel=$(R kubelwagen kubelwagen_grey game2)" "Horch=$(R horch901 horch901_grey game2)" \
  "Citroen=$(R citroen11 citroen11_black game2)" "Willys=$(R willys_mb willys_mb_od game2)" "Blitz=$(R opel_blitz_cargo opel_blitz_cargo_grey game2)" \
  "Tanker=$(R opel_blitz_tanker opel_blitz_tanker_grey game2)" "Tanker burnt=$(R opel_blitz_tanker opel_blitz_tanker_burnt game2)"
