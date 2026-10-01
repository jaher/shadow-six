#!/bin/bash
# docs_rework2.sh: crops + captioned sheets -> docs/screenshots/veh-armour-{afv,guns,detail,variants}.jpg
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}"  # repo root (no machine paths)
cd $REPO/tools/blender/vehicles/armour/review
D=$REPO/docs/screenshots; T=docs_tmp; mkdir -p $T
crop() { python3 -c "
from PIL import Image; import sys
im=Image.open('$1').convert('RGB'); W,H=im.size; x0,y0,x1,y1=[float(v) for v in '$2'.split(',')]
im.crop((int(x0*W),int(y0*H),int(x1*W),int(y1*H))).resize((960,640),Image.LANCZOS).save('$T/$3.png')"; }
crop sdkfz231_8rad/sdkfz231_8rad_lod0_close.png 0.30,0.45,0.75,0.95 t231
crop sdkfz251_c/sdkfz251_c_lod0_close_se.png 0.40,0.30,0.95,0.85 l251
crop flak88/flak88_lod0_close_se.png 0.25,0.15,0.75,0.65 shield
crop mgnest_ring/mgnest_ring_lod0_close.png 0.25,0.25,0.75,0.75 bags
crop sdkfz251_c/sdkfz251_c_lod2_lod2_game05.png 0.40,0.35,0.60,0.65 l251lod2
crop sdkfz251_c/sdkfz251_c_lod0_game1.png 0.40,0.35,0.60,0.65 l251lod0
S=../scripts/docsheet.py
python3 $S $D/veh-armour-afv.jpg "SHADOW SIX armour (rework 2): Pz IV G/F2, Pz III L/J, Pz II F, SdKfz 251/1 C, SdKfz 231 8-Rad - close zoom" 3 \
 "Pz IV G=panzer4_g/panzer4_g_lod0_close.png" "Pz IV F2=panzer4_f2/panzer4_f2_lod0_close_se.png" "Pz III L=panzer3_l/panzer3_l_lod0_close.png" \
 "Pz III J=panzer3_j/panzer3_j_lod0_close_se.png" "Pz II F=panzer2_f/panzer2_f_lod0_close.png" "SdKfz 251/1 C=sdkfz251_c/sdkfz251_c_lod0_close.png" \
 "251 DAK=sdkfz251_c/sdkfz251_c_lod0_dak_close.png" "SdKfz 231 8-Rad=sdkfz231_8rad/sdkfz231_8rad_lod0_close_se.png" "231 DAK=sdkfz231_8rad/sdkfz231_8rad_lod0_dak_close.png"
python3 $S $D/veh-armour-guns.jpg "SHADOW SIX guns + emplacements (rework 2): 8.8 cm Flak 36, 21 cm Moerser 18, MG 34/42 Lafette, MG nests" 3 \
 "Flak 36=flak88/flak88_lod0_close.png" "Flak 36 (se)=flak88/flak88_lod0_close_se.png" "Flak 36 winter=flak88/flak88_lod0_winter_close_se.png" \
 "Moerser 18=morser18_21cm/morser18_21cm_lod0_close.png" "MG 42 tripod=mg42_tripod/mg42_tripod_lod0_close.png" "MG 34 tripod=mg34_tripod/mg34_tripod_lod0_close.png" \
 "MG nest ring=mgnest_ring/mgnest_ring_lod0_close.png" "MG nest horseshoe=mgnest_horseshoe/mgnest_horseshoe_lod0_close_se.png" "ring nest 1x=mgnest_ring/mgnest_ring_lod0_game2.png"
python3 $S $D/veh-armour-detail.jpg "Armour rework 2 details: rubber lug tyres, 251 lockers, one-piece Flak shield + slot cover, tied sandbags + feathered apron, LOD2 vs LOD0" 3 \
 "231 lug tyres=$T/t231.png" "251 lockers=$T/l251.png" "Flak 36 shield=$T/shield.png" "sandbags + apron=$T/bags.png" \
 "251 LOD2 (0.5x)=$T/l251lod2.png" "251 LOD0 (1x)=$T/l251lod0.png"
python3 $S $D/veh-armour-variants.jpg "Armour rework 2: destroyed/burnt variants (soot, ash, burnt-off tyres) + winter" 3 \
 "251 burnt=sdkfz251_c/sdkfz251_c_burnt_lod0_burnt_close.png" "231 burnt (bare rims)=sdkfz231_8rad/sdkfz231_8rad_burnt_lod0_burnt_close.png" "Flak 36 burnt=flak88/flak88_burnt_lod0_burnt_close.png" \
 "ring nest burnt=mgnest_ring/mgnest_ring_burnt_lod0_burnt_close.png" "Pz IV G burnt=panzer4_g/panzer4_g_burnt_lod0_burnt_close.png" "horseshoe burnt=mgnest_horseshoe/mgnest_horseshoe_burnt_lod0_burnt_close.png" \
 "251 winter=sdkfz251_c/sdkfz251_c_lod0_winter_close_se.png" "231 winter=sdkfz231_8rad/sdkfz231_8rad_lod0_winter_close_se.png" "ring nest winter=mgnest_ring/mgnest_ring_lod0_winter_close_se.png"
