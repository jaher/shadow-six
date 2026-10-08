# Credits

SHADOW SIX is an unofficial, non-commercial fan tribute to *Commandos: Behind Enemy Lines* (Pyro Studios / Eidos
Interactive, 1998). It is not affiliated with, endorsed by or connected to Pyro Studios, Eidos, Square Enix or
Kalypso Media. 'Commandos' is a trademark of its owner. No assets from the original game are used; all art, audio
and code are original or CC0/redistributable (see CREDITS.md).

## Code

| Component | Author | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org/) r186 and addons (`vendor/`) | three.js authors | MIT |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.9.15 build (`vendor/three-mesh-bvh/`, clipping audit only; licence file kept) | Garrett Johnson and contributors | MIT |
| Draco decoder (`vendor/addons/libs/draco/`) | Google | Apache-2.0 |
| Basis Universal transcoder (`vendor/addons/libs/basis/`) | Binomial LLC | Apache-2.0 |
| meshoptimizer decoder (`vendor/addons/libs/meshopt_decoder.module.js`) | Arseny Kapoulkine | MIT |
| fflate (`vendor/addons/libs/fflate.module.js`) | Arjun Barrett | MIT |
| zstddec (`vendor/addons/libs/zstddec.module.js`) | Don McCurdy | MIT |
| ktx-parse (`vendor/addons/libs/ktx-parse.module.js`) | Don McCurdy | MIT |
| stats.js (`vendor/addons/libs/stats.module.js`) | mrdoob | MIT |
| [playwright-core](https://playwright.dev/) (tests only) | Microsoft | Apache-2.0 |
| [Rapier](https://rapier.rs/) 3D, deterministic compat build `@dimforge/rapier3d-deterministic-compat` 0.21.0 (`vendor/rapier/`, WASM inlined; blast / ragdoll physics) | Dimforge (Sébastien Crozet) | Apache-2.0 (`vendor/rapier/LICENSE`) |
| SHADOW SIX game code (`src/`, `tools/`, `tests/`) | project contributors | MIT |

## Art assets

<!-- One row per imported asset: file(s), source URL, author, licence (CC0 / CC-BY …), changes made. -->

| Asset | Source | Author | Licence |
| --- | --- | --- | --- |
| Buildings & bridges: `assets/models/buildings/`, `assets/models/bridges/`, `assets/textures/lib/` | see *Buildings & bridges* below | SHADOW SIX project; Poly Haven / ambientCG artists | CC0 1.0 |
| Vehicle library: `assets/models/vehicles/<group>/` (cars & motorcycles, armour, aircraft, naval, rail; own Blender geometry by `tools/blender/vehicles/`, CC0 texture sets — see *Vehicles* below). The first-generation Opel Blitz truck GLBs (`truck_*.glb`) were retired at the vehicle integration | [Poly Haven](https://polyhaven.com/), [ambientCG](https://ambientcg.com/) | SHADOW SIX project; Poly Haven / ambientCG artists | CC0 1.0 |
| `assets/textures/pavement/{1k,512}/setts_*.jpg` (pavement: Cobblestone Floor 03; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/cobblestone_floor_03) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/belgian_*.jpg` (pavement: Cobblestone Floor 08; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/cobblestone_floor_08) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/pave_fan_*.jpg` (pavement: Patterned Cobblestone; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/patterned_cobblestone) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/brick_*.jpg` (pavement: Herringbone Brick; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/herringbone_brick) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/flags_*.jpg` (pavement: Precast Stone Paving; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/precast_stone_paving) | Dimitrios Savva | CC0 |
| `assets/textures/pavement/{1k,512}/asphalt_*.jpg` (pavement: Tarred Gravel; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/tarred_gravel) | Dimitrios Savva | CC0 |
| `assets/textures/pavement/{1k,512}/asphalt_cracked_*.jpg` (pavement: Asphalt 02; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/concrete_*.jpg` (pavement: Damaged Concrete Floor; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/damaged_concrete_floor) | Rob Tuytel | CC0 |
| `assets/textures/pavement/{1k,512}/grate_*.jpg` (pavement: Metal Grate Rusty; 2k source → 1k / 512, albedo low-frequency flattened, ARD = AO + roughness + displacement packed) | [Poly Haven](https://polyhaven.com/a/metal_grate_rusty) | Rob Tuytel, Dimitrios Savva | CC0 |
| `assets/textures/pavement/512/{setts,belgian,pave_fan,brick}_sid.png` (stone-ID maps for anti-tiling: segmented from the CC0 height maps above by tools/render/pave_stones.py) | SHADOW SIX (derived from the Poly Haven scans above) | SHADOW SIX contributors | CC0 |
| `assets/hdri/snowy_park_01_1k.hdr` (IBL, Snowy Park 01; 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/snowy_park_01) | Oliksiy Yakovlyev | CC0 |
| `assets/hdri/snow_field_puresky_1k.hdr` (IBL, Snow Field (Pure Sky); 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/snow_field_puresky) | Jarod Guest, Sergej Majboroda | CC0 |
| `assets/hdri/goegap_1k.hdr` (IBL, Goegap; 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/goegap) | Greg Zaal | CC0 |
| `assets/hdri/kloofendal_43d_clear_puresky_1k.hdr` (IBL, Kloofendal 43d Clear (Pure Sky); 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | Greg Zaal | CC0 |
| `assets/hdri/overcast_soil_puresky_1k.hdr` (IBL, Overcast Soil (Pure Sky); 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/overcast_soil_puresky) | Jarod Guest, Sergej Majboroda | CC0 |
| `assets/hdri/spruit_sunrise_1k.hdr` (IBL, Spruit Sunrise; 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/spruit_sunrise) | Greg Zaal | CC0 |
| `assets/hdri/qwantani_dusk_2_puresky_1k.hdr` (IBL, Qwantani Dusk 2 (Pure Sky); 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/qwantani_dusk_2_puresky) | Greg Zaal, Jarod Guest | CC0 |
| `assets/hdri/moonlit_golf_1k.hdr` (IBL, Moonlit Golf; 1k, unmodified) | [Poly Haven](https://polyhaven.com/a/moonlit_golf) | Greg Zaal | CC0 |
| `assets/luts/*.cube` (per-theater grades baked by `tools/render/bake-luts.mjs`) | this project | project contributors | CC0 |
| `assets/terrain/{temperate,desert,snow}_{albedo,normal,data}.webp`, `_2k` / `_512.webp` (ground layer strips; de-lit, calibrated, repacked; full list in `assets/terrain/CREDITS.md`) | [Poly Haven](https://polyhaven.com/textures) (withered_grass, dry_ground_01, brown_mud_02, gravel_floor_02, dense_sand, sand_01, coast_sand_01, rocks_ground_02, rocky_trail_02, forest_leaves_02, snow_03), [ambientCG](https://ambientcg.com) (Grass004) | Poly Haven artists; ambientCG (Lennart Demes) | CC0 |
| `assets/water/waternormals.jpg` (water micro-normal detail; unmodified; MIT notice kept in `assets/water/LICENSE.md`) | [three.js examples](https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg) | three.js authors | MIT |
| `assets/water/foam2.png` (lace foam / fbm mask / noise channels, generated procedurally) | this project (water R&D tools) | project contributors | CC0 |
| `assets/terrain/bark_*.jpg` (tree bark atlas) | Poly Haven (bark_brown_02, bark_platanus, bark_willow, pine_bark, palm_bark), ambientCG (Bark012) | Poly Haven artists; ambientCG | CC0 |
| `assets/terrain/foliage.webp`, `foliage_n.webp` (leaf / twig spray atlas: broadleaf, shrub, ivy, gorse, acacia and palm-leaflet sprays procedural, `tools/render/build_leaves.py`; conifer and palm-frond tiles composed) | own work (procedural sprays); ambientCG (LeafSet004/010/013/022/024/030, PineNeedles001) for the conifer / palm tiles | project contributors; ambientCG | CC0 |
| `assets/terrain/needles.webp`, `needles_n.webp` (conifer needle-spray atlas: Norway spruce sprays and comb curtains, Scots / stone pine tufts and pads; albedo, needle normals, coverage; procedural, `tools/render/build_needles.py`) | this project | project contributors | CC0 |
| `assets/portraits/**` (talking-portrait clips, 256 px VP9 WebM + H.264 MP4 + poster stills; 6 commandos × 8 lines × primary/urgent take + idle + talk loop; full component list in `assets/portraits/LICENSES.json`) | AI-generated, synthetic faces from written descriptions only (no photo, likeness or voice of a real person): portraits with Z-Image-Turbo (Tongyi-MAI; unsloth GGUF) + Qwen3-4B text encoder, animation with JoyVASA (jdh-algo) + chinese-hubert-base (TencentGameMate) + LivePortrait (KwaiVGI), face crop with MediaPipe FaceLandmarker; voices are the `assets/audio/voice` pack | project contributors | project output of Apache-2.0 / MIT models |
| `assets/ui/tex/wool-olive@1x/@2x.webp` (M1 army-blanket camo weave; recoloured to the olive tokens + our tileable Worley camo mask and speckle) | [ambientCG Fabric031](https://ambientcg.com/view?id=Fabric031), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `assets/ui/tex/webbing@1x/@2x.webp` (M2 canvas webbing, recoloured khaki) | [ambientCG Fabric019](https://ambientcg.com/view?id=Fabric019), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `assets/ui/tex/paper-aged@…`, `paper-note@…` (M3 aged paper / notebook stock; our procedural stain + foxing layer) | [ambientCG Paper003](https://ambientcg.com/view?id=Paper003), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `assets/ui/tex/brushed-steel-mask@…` (M5 stamped-steel card titles) | [ambientCG Metal009](https://ambientcg.com/view?id=Metal009), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `assets/ui/tex/leather@…` (M7 Help folder edge) | [ambientCG Leather037](https://ambientcg.com/view?id=Leather037), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `assets/ui/tex/oak@…` (M8 campaign map table) | [ambientCG Wood049](https://ambientcg.com/view?id=Wood049), downloaded 2026-09-26 | ambientCG (Lennart Demes) | CC0 1.0 |
| `src/ui/europe-coast.js` (Europe and North Africa coastlines for the briefing map and the mission-select map table; clamped and simplified by `tools/ui/build_coast.mjs`) | [Natural Earth 1:50m land](https://www.naturalearthdata.com/), via github.com/nvkelso/natural-earth-vector, downloaded 2026-09-26 | Natural Earth | Public domain |
| `assets/ui/emblem.svg`, `emblem-height.svg` (the SHADOW SIX raven emblem), `leader.svg`, `pin-*.svg`, `insignia`, stamps, keycaps, key art layers | made for SHADOW SIX (`tools/ui/make_emblem.py`, hand-written SVG) | SHADOW SIX contributors | ours (MIT project licence) |
| `assets/ui/wordmark.svg` (SHADOW SIX wordmark) | Alfa Slab One outlines, roughened by `tools/ui/make_wordmark.py` | outlines derived from JM Solé's Alfa Slab One | SIL OFL 1.1 derivative (`assets/fonts/OFL-AlfaSlabOne.txt`); not shipped as a font |
| `assets/ui/tex/grain-256.png`, `assets/ui/tex/speck-512.png`, `assets/ui/diorama/*.webp` (film grain, camo speckle; engine stills of our own missions) | generated by `tools/ui/build_textures.py` / `tools/ui/bake_dioramas.mjs` | SHADOW SIX contributors | ours |
| `assets/ui/keyart/hero.webp` (S03 title-splash hero), `assets/ui/keyart/tiny-portrait.webp` (S20 debrief figure, Help dossier print) | offline Cycles renders of the project's Green Beret character model (MakeHuman / MPFB base mesh and skin, CC0; outfit textures from ambientCG, CC0), posed, lit and graded by `tools/ui/keyart/render.py` + `grade.py`; the hero's Colt M1911A1 modelled procedurally by `tools/ui/keyart/colt1911.py` | SHADOW SIX contributors | ours (CC0 inputs) |
| `assets/ui/emblem-badge-height.svg` (the front-end badge layout, height map), `src/ui/splash-fx.js` (splash fire and searchlight shader) | made for SHADOW SIX (`tools/ui/make_emblem.py`) | SHADOW SIX contributors | ours (MIT project licence) |
| `assets/ui/briefing/norway-harbour.webp` | [Raid on the Lofoten Islands, 4 March 1941 N396](https://commons.wikimedia.org/wiki/File:Raid_on_the_Lofoten_Islands,_4_March_1941_N396.jpg) (Imperial War Museums), via Wikimedia Commons, downloaded 2026-09-26; cropped and graded by `tools/ui/build_briefing_photos.py` | War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/briefing/norway-landing.webp`, `norway-vaagso.webp` | [Raid on Vaagso, 27 December 1941 N470](https://commons.wikimedia.org/wiki/File:Raid_on_Vaagso,_27_December_1941_N470.jpg), [N459](https://commons.wikimedia.org/wiki/File:Raid_on_Vaagso,_27_December_1941_N459.jpg) (Imperial War Museums), via Wikimedia Commons | War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/briefing/norway-airfield.webp` (hand-tinted; M1) | [Herdla airfield bombing Operation Archery](https://commons.wikimedia.org/wiki/File:Herdla_airfield_bombing_Operation_Archery.jpg) (Imperial War Museums C 2724), via Wikimedia Commons, downloaded 2026-09-27; cropped and graded by `tools/ui/build_briefing_photos.py` | No. 114 Squadron RAF (official photograph) | Public domain (Crown copyright expired) |
| `assets/ui/briefing/norway-commandos.webp`, `norway-prisoners.webp` (M3) | [Commandos archery](https://commons.wikimedia.org/wiki/File:Commandos_archery.jpg) (IWM N 530), [Captured German troops norway](https://commons.wikimedia.org/wiki/File:Captured_German_troops_norway.jpg) (Raid on Vaagso, 27 December 1941), via Wikimedia Commons, downloaded 2026-09-27 | Lt E G Malindine, War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/briefing/lofoten-craft.webp`, `norway-snow.webp` (M2) | [Troops returning from shore in landing craft after raiding the Lofoten islands, Norway, 4 March 1941. A3321](https://commons.wikimedia.org/wiki/File:Troops_returning_from_shore_in_landing_craft_after_raiding_the_Lofoten_islands,_Norway,_4_March_1941._A3321.jpg), [Raid on Vaagso, 27 December 1941 N456](https://commons.wikimedia.org/wiki/File:Raid_on_Vaagso,_27_December_1941_N456.jpg) (Imperial War Museums), via Wikimedia Commons, downloaded 2026-09-27 | Lt R G G Coote, Royal Navy official photographer; Lt E G Malindine, War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/briefing/stuka.webp` (hand-tinted; cropped clear of tail markings) | [The British Army in North Africa 1941 E3900E](https://commons.wikimedia.org/wiki/File:The_British_Army_in_North_Africa_1941_E3900E.jpg) (Imperial War Museums), via Wikimedia Commons | War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/briefing/desert.webp` | [Ju 87 burning near Tobruk 1941](https://commons.wikimedia.org/wiki/File:Ju_87_burning_near_Tobruk_1941.jpg), via Wikimedia Commons | War Office official photographer | Public domain |
| `assets/ui/briefing/france-tank.webp`, `france-road.webp` | [The British Army in France 1940 F4591](https://commons.wikimedia.org/wiki/File:The_British_Army_in_France_1940_F4591.jpg), [F4863](https://commons.wikimedia.org/wiki/File:The_British_Army_in_France_1940_F4863.jpg) (Imperial War Museums), via Wikimedia Commons | War Office official photographer | Public domain (Crown copyright expired) |
| `assets/ui/icons/**` (HUD icons: 35 knapsack items and count minis, 41 top-bar / pack / notebook renders incl. hover / pressed / active / disabled states, the rendered rucksack and brass count tag, 30 cursors, 6 portrait stamps; WebP 2×–6× + PNG fallbacks, `manifest.json`) | offline Blender 4.2 Cycles studio renders of our own models, built by `tools/blender/icons/` (models, materials, printed labels and vector cursors all own work; no real brands or insignia) | SHADOW SIX contributors | ours (MIT project licence; CC0 inputs below) |
| textures used by the icon renders (`tools/blender/icons/mats.py`; not shipped as files) | Poly Haven [`fine_grained_wood`](https://polyhaven.com/a/fine_grained_wood), [`dark_wood`](https://polyhaven.com/a/dark_wood), [`brown_leather`](https://polyhaven.com/a/brown_leather), [`fabric_leather_02`](https://polyhaven.com/a/fabric_leather_02), [`rusty_metal_02`](https://polyhaven.com/a/rusty_metal_02), [`metal_plate`](https://polyhaven.com/a/metal_plate), [`wool_boucle`](https://polyhaven.com/a/wool_boucle), [`leather_red_02`](https://polyhaven.com/a/leather_red_02), [`rock_face_03`](https://polyhaven.com/a/rock_face_03), [`hessian_230`](https://polyhaven.com/a/hessian_230); [ambientCG Fabric030](https://ambientcg.com/view?id=Fabric030) | Poly Haven artists; ambientCG (Lennart Demes) | CC0 1.0 |
| studio lighting of the icon renders (not shipped) | Poly Haven HDRI [`studio_small_09`](https://polyhaven.com/a/studio_small_09) | Poly Haven artists | CC0 1.0 |
| hands, eye and stance figures in the icons (`tool/hand*`, `tool/eye.*`, `cursor/hand.open`, `grab`, `fist*`, `tool/stance.*`) | MakeHuman system assets via MPFB (skins, high-poly eyes, eyelashes, eyebrows, expression targets); the stance figures are the game's own Green Beret model | MakeHuman community; SHADOW SIX contributors | CC0 1.0 (system assets) |

### Buildings & bridges

204 buildings and bridges (`assets/models/buildings/<theater>/`, `assets/models/bridges/`, 3 LODs each) are procedural
geometry scripted in Blender with the SHADOW SIX kit (`tools/blender/`; own work, CC0). The M20 castle masonry, field
guns and range props are procedural three.js geometry (`src/art/castle-kit.js`, `src/art/field-guns.js`; own work, CC0)
textured from the same library. They share one texture library
(`assets/textures/lib/1k` default, `2k` albedo for the ultra preset; metadata `assets/textures/lib/materials.json`).
Every source is listed below; per-asset lists are in each `<asset>.credits.json`. Baked AO maps, decal/sign atlases
and all lettering are own work. The review HDRI (Poly Haven `kloofendal_43d_clear_puresky`, CC0) is not shipped.
Poly Haven maps were regraded, tiled and resized; procedural maps are generated by the listed scripts.

| Library material(s) | Source | Author | Licence |
| --- | --- | --- | --- |
| `adobe_ochre` | [Poly Haven `clay_plaster` (Clay Plaster)](https://polyhaven.com/a/clay_plaster) | Amal Kumar | CC0 1.0 |
| `ashlar` | [Poly Haven `stone_block_wall` (Stone Block Wall)](https://polyhaven.com/a/stone_block_wall) | Amal Kumar | CC0 1.0 |
| `ashlar_limestone` | [Poly Haven `white_sandstone_blocks_02` (White Sandstone Blocks 02)](https://polyhaven.com/a/white_sandstone_blocks_02) | Rob Tuytel | CC0 1.0 |
| `bitumen_felt` | [Poly Haven `bitumen` (Bitumen)](https://polyhaven.com/a/bitumen) | Rob Tuytel | CC0 1.0 |
| `board_batten`, `boards_weathered`, `log_hewn`, `mesh_screen`, `paint_metal`, `roof_pantile_black`, `tar_paper`, `tar_paper_batten`, `weatherboard_paint` | Procedural (tools/blender/norway/tools/make_nor_tex.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `brick_dark` | [Poly Haven `dark_brick_wall` (Dark Brick Wall)](https://polyhaven.com/a/dark_brick_wall) | Dario Barresi, Dimitrios Savva | CC0 1.0 |
| `brick_red` | [Poly Haven `red_brick_03` (Red Brick 03)](https://polyhaven.com/a/red_brick_03) | Rob Tuytel | CC0 1.0 |
| `burlap_bag` | Procedural (tools/blender/military/tools/make_mil_tex.py, own work); derived from Poly Haven `hessian_230` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |
| `camo_netting` | Procedural (tools/blender/military/tools/make_mil_tex4.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `canvas` | [Poly Haven `rough_linen` (Rough Linen)](https://polyhaven.com/a/rough_linen) | colormass, Rico Cilliers | CC0 1.0 |
| `cast_iron` | [Poly Haven `rusty_metal_03` (Rusty Metal 03)](https://polyhaven.com/a/rusty_metal_03) | Amal Kumar | CC0 1.0 |
| `cobblestone` | [Poly Haven `cobblestone_05` (Cobblestone 05)](https://polyhaven.com/a/cobblestone_05) | Rob Tuytel | CC0 1.0 |
| `concrete_aggregate`, `snow_soft`, `water_flow` | Procedural (tools/blender/bridges/tools2/make_br_tex.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `concrete_board` | [Poly Haven `wood_textured_concrete` (Wood Textured Concrete)](https://polyhaven.com/a/wood_textured_concrete) | Dimitrios Savva | CC0 1.0 |
| `concrete_bunker` | [Poly Haven `concrete_wall_008` (Concrete Wall 008)](https://polyhaven.com/a/concrete_wall_008) | Dario Barresi, Charlotte Baglioni | CC0 1.0 |
| `concrete_camo`, `concrete_formwork`, `concrete_slab` | Procedural (tools/blender/military/tools/make_mil_tex.py, own work); derived from Poly Haven `concrete_wall_008` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |
| `concrete_camo_heer` | Procedural (tools/blender/military/tools/make_mil_tex.py, own work); derived from Poly Haven `concrete_bunker (lib)` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |
| `concrete_dam` | Procedural (tools/blender/bridges/tools2/make_dam_tex.py, own work); derived from concrete_board (lib, CC0 Poly Haven) | SHADOW SIX project (own work) | CC0 1.0 |
| `corrugated_galv` | [Poly Haven `worn_corrugated_iron` (Worn Corrugated Iron)](https://polyhaven.com/a/worn_corrugated_iron) | Jenelle van Heerden, Dimitrios Savva | CC0 1.0 |
| `corrugated_rust` | [Poly Haven `rusty_corrugated_iron` (Rusty Corrugated Iron)](https://polyhaven.com/a/rusty_corrugated_iron) | Charlotte Baglioni | CC0 1.0 |
| `corrugated_zinc` | [Poly Haven `corrugated_iron_02` (Corrugated Iron 02)](https://polyhaven.com/a/corrugated_iron_02) | Jenelle van Heerden, Sergej Majboroda | CC0 1.0 |
| `curtain`, `glass_dirty`, `interior_dark` | Procedural (tools/make_procedural.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `darj_panel` | Procedural (own work, SHADOW SIX art pass) | SHADOW SIX project (own work) | CC0 1.0 |
| `decals`, `signs` | Procedural (tools/make_decals.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `decals_dz` | Procedural (tools/blender/desert/scripts/make_decals_dz.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `deck_planks` | [Poly Haven `wood_planks_dirt` (Wood Planks Dirt)](https://polyhaven.com/a/wood_planks_dirt) | Rob Tuytel | CC0 1.0 |
| `door_planks`, `wood_paint` | [Poly Haven `weathered_peeling_timber` (Weathered Peeling Timber)](https://polyhaven.com/a/weathered_peeling_timber) | Dimitrios Savva | CC0 1.0 |
| `fieldstone` | [Poly Haven `rustic_stone_wall` (Rustic Stone Wall)](https://polyhaven.com/a/rustic_stone_wall) | Dimitrios Savva | CC0 1.0 |
| `fieldstone_grey` | [Poly Haven `stone_wall_04` (Stone Wall 04)](https://polyhaven.com/a/stone_wall_04) | Amal Kumar | CC0 1.0 |
| `floor_checker`, `granite_polished`, `limestone_smooth`, `stele_face` | Procedural (own work, europe rework make_stone.py) | SHADOW SIX project (own work) | CC0 1.0 |
| `foliage_atlas` | Procedural (own work, europe rework rw/make_foliage.py) | SHADOW SIX project (own work) | CC0 1.0 |
| `granite` | [Poly Haven `granite_wall` (Granite Wall)](https://polyhaven.com/a/granite_wall) | Dimitrios Savva | CC0 1.0 |
| `gravel` | [Poly Haven `gravel_road` (Gravel Road)](https://polyhaven.com/a/gravel_road) | Amal Kumar | CC0 1.0 |
| `gravel_grey` | [Poly Haven `gravel` (Gravel)](https://polyhaven.com/a/gravel) | Dimitrios Savva | CC0 1.0 |
| `hessian` | [Poly Haven `hessian_230` (Hessian 230)](https://polyhaven.com/a/hessian_230) | colormass, Rico Cilliers | CC0 1.0 |
| `limewash_lumpy` | [Poly Haven `medieval_wall_01` (Medieval Wall 01)](https://polyhaven.com/a/medieval_wall_01) | Rob Tuytel | CC0 1.0 |
| `limewash_worn` | [Poly Haven `plastered_stone_wall` (Plastered Stone Wall)](https://polyhaven.com/a/plastered_stone_wall) | Rob Tuytel | CC0 1.0 |
| `mud` | [Poly Haven `brown_mud_02` (Brown Mud 02)](https://polyhaven.com/a/brown_mud_02) | Rob Tuytel | CC0 1.0 |
| `mud_render2` | [Poly Haven `dirt_floor` (Dirt Floor)](https://polyhaven.com/a/dirt_floor) | eye-candy.xyz | CC0 1.0 |
| `mudbrick` | [Poly Haven `clay_block_wall` (Clay Block Wall)](https://polyhaven.com/a/clay_block_wall) | Amal Kumar | CC0 1.0 |
| `palm_frond_dz` | Procedural (tools/blender/desert/scripts/make_fronds.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `palm_log` | [Poly Haven `bark_brown_01` (Bark Brown 01)](https://polyhaven.com/a/bark_brown_01) | Rob Tuytel | CC0 1.0 |
| `patio_flags` | [Poly Haven `floor_tiles_04` (Floor Tiles 04)](https://polyhaven.com/a/floor_tiles_04) | Rob Tuytel | CC0 1.0 |
| `plaster_limewash` | [Poly Haven `white_rough_plaster` (White Rough Plaster)](https://polyhaven.com/a/white_rough_plaster) | Rob Tuytel | CC0 1.0 |
| `plaster_rough` | [Poly Haven `rough_plaster_03` (Rough Plaster 03)](https://polyhaven.com/a/rough_plaster_03) | Rob Tuytel | CC0 1.0 |
| `plaster_white` | [Poly Haven `white_plaster_rough_02` (White Plaster Rough 02)](https://polyhaven.com/a/white_plaster_rough_02) | Rob Tuytel | CC0 1.0 |
| `rock_cliff` | [Poly Haven `cliff_side` (Cliff Side)](https://polyhaven.com/a/cliff_side) | James Ray Cock, Jenelle van Heerden, Dario Barresi | CC0 1.0 |
| `roof_shingle` | [ambientCG `WoodSiding013` (None)](https://ambientcg.com/view?id=WoodSiding013) | ambientCG (Lennart Demes) | CC0 1.0 |
| `roof_slate` | [Poly Haven `roof_slates_02` (Roof Slates 02)](https://polyhaven.com/a/roof_slates_02) | Rob Tuytel | CC0 1.0 |
| `roof_slate_b` | [Poly Haven `grey_roof_tiles_02` (Grey Roof Tiles 02)](https://polyhaven.com/a/grey_roof_tiles_02) | Rob Tuytel | CC0 1.0 |
| `roof_terracotta` | [Poly Haven `clay_roof_tiles_02` (Clay Roof Tiles 02)](https://polyhaven.com/a/clay_roof_tiles_02) | Amal Kumar | CC0 1.0 |
| `roof_thatch` | [Poly Haven `reed_roof_04` (Reed Roof 04)](https://polyhaven.com/a/reed_roof_04) | Rob Tuytel | CC0 1.0 |
| `roof_tile_flat` | [Poly Haven `clay_roof_tiles_03` (Clay Roof Tiles 03)](https://polyhaven.com/a/clay_roof_tiles_03) | Amal Kumar | CC0 1.0 |
| `rubble_stone` | [Poly Haven `stone_wall` (Stone Wall)](https://polyhaven.com/a/stone_wall) | Dario Barresi, Charlotte Baglioni | CC0 1.0 |
| `sand` | [Poly Haven `dense_sand` (Dense Sand)](https://polyhaven.com/a/dense_sand) | Dimitrios Savva | CC0 1.0 |
| `sandstone_ochre` | [Poly Haven `sandstone_blocks_04` (Sandstone Blocks 04)](https://polyhaven.com/a/sandstone_blocks_04) | Rob Tuytel | CC0 1.0 |
| `scree_grey` | [Poly Haven `gray_rocks` (Gray Rocks)](https://polyhaven.com/a/gray_rocks) | Dimitrios Savva | CC0 1.0 |
| `screed_lime` | [Poly Haven `grey_plaster_02` (Grey Plaster 02)](https://polyhaven.com/a/grey_plaster_02) | Rob Tuytel | CC0 1.0 |
| `setts_granite` | [Poly Haven `cobblestone_floor_03` (Cobblestone Floor 03)](https://polyhaven.com/a/cobblestone_floor_03) | Rob Tuytel | CC0 1.0 |
| `snow` | [Poly Haven `snow_01` (Snow 01)](https://polyhaven.com/a/snow_01) | Rob Tuytel | CC0 1.0 |
| `sod` | [Poly Haven `sparse_grass` (Sparse Grass)](https://polyhaven.com/a/sparse_grass) | Amal Kumar | CC0 1.0 |
| `steel_galv`, `steel_painted` | [Poly Haven `rusty_painted_metal` (Rusty Painted Metal)](https://polyhaven.com/a/rusty_painted_metal) | Amal Kumar | CC0 1.0 |
| `steel_grating`, `tent_canvas` | Procedural (tools/blender/military/tools/make_mil_tex.py, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `timber_beam` | [Poly Haven `wood_planks_grey` (Wood Planks Grey)](https://polyhaven.com/a/wood_planks_grey) | Rob Tuytel | CC0 1.0 |
| `timber_cladding` | [Poly Haven `wood_plank_wall` (Wood Plank Wall)](https://polyhaven.com/a/wood_plank_wall) | Dimitrios Savva | CC0 1.0 |
| `timber_creosote` | Procedural (tools/blender/military/tools/make_mil_tex.py, own work); derived from Poly Haven `wood_planks_grey` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |
| `timber_grey` | [Poly Haven `weathered_planks` (Weathered Planks)](https://polyhaven.com/a/weathered_planks) | Dario Barresi, Dimitrios Savva | CC0 1.0 |
| `timber_siding` | [Poly Haven `weathered_plank_siding` (Weathered Plank Siding)](https://polyhaven.com/a/weathered_plank_siding) | Dimitrios Savva | CC0 1.0 |
| `timber_tarred` | [Poly Haven `dark_wooden_planks` (Dark Wooden Planks)](https://polyhaven.com/a/dark_wooden_planks) | Amal Kumar | CC0 1.0 |
| `turf_grass` | Procedural (tools/blender/norway/tools/make_nor_tex.py, own work); derived from Poly Haven `sparse_grass` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |

### Vehicles

53 vehicles, guns and props (`assets/models/vehicles/<group>/`: cars_moto, armour, aircraft, naval, rail; LOD0 + LOD2,
burnt/destroyed and theater paint variants; index `assets/models/vehicles/manifest.json`) are procedural geometry scripted
in Blender (`tools/blender/vehicles/`; own work, CC0), including every marking (Balkenkreuz, tactical numbers, hull
lettering), baked AO, procedural paint/whitewash/burn shaders and track textures. They use the shared texture library
(`assets/textures/lib/1k`, 37 maps added for vehicles) and per-asset armour atlases (`assets/models/vehicles/armour/tex/`).
Per-asset lists are merged in `assets/models/vehicles/credits.json`. Reference photos were used for proportions only
and are not shipped. All texture sources are CC0 1.0.

| Material(s) | Source | Author | Licence |
| --- | --- | --- | --- |
| `air_corr`, `air_fabric`, `air_skin` | Procedural (`tools/blender/vehicles/aircraft/scripts/make_air_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `bitumen_felt` | [Poly Haven `bitumen` (Bitumen)](https://polyhaven.com/a/bitumen) | Rob Tuytel | CC0 1.0 |
| `canvas` | [Poly Haven `rough_linen` (Rough Linen)](https://polyhaven.com/a/rough_linen) | colormass, Rico Cilliers | CC0 1.0 |
| `cast_iron` | [Poly Haven `rusty_metal_03` (Rusty Metal 03)](https://polyhaven.com/a/rusty_metal_03) | Amal Kumar | CC0 1.0 |
| `coal` | Procedural (`tools/blender/vehicles/rail/scripts/make_rail_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `corrugated_rust` | [Poly Haven `rusty_corrugated_iron` (Rusty Corrugated Iron)](https://polyhaven.com/a/rusty_corrugated_iron) | Charlotte Baglioni | CC0 1.0 |
| `deck_planks` | [Poly Haven `wood_planks_dirt` (Wood Planks Dirt)](https://polyhaven.com/a/wood_planks_dirt) | Rob Tuytel | CC0 1.0 |
| `glass_dirty` | Procedural (`tools/blender/kit/tools/make_procedural.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `gravel_grey` | [Poly Haven `gravel` (Gravel)](https://polyhaven.com/a/gravel) | Dimitrios Savva | CC0 1.0 |
| `heat` | Procedural (`tools/blender/vehicles/rail/scripts/make_heat_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `hessian` | [Poly Haven `hessian_230` (Hessian 230)](https://polyhaven.com/a/hessian_230) | colormass, Rico Cilliers | CC0 1.0 |
| `k5camo`, `k5ww`, `rivet` | Procedural (`tools/blender/vehicles/rail/scripts/make_k5_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `limewash_worn` | [Poly Haven `plastered_stone_wall` (Plastered Stone Wall)](https://polyhaven.com/a/plastered_stone_wall) | Rob Tuytel | CC0 1.0 |
| `mud` | [Poly Haven `brown_mud_02` (Brown Mud 02)](https://polyhaven.com/a/brown_mud_02) | Rob Tuytel | CC0 1.0 |
| `snow_soft` | Procedural (`tools/blender/bridges/tools2/make_br_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `steel_galv` | [Poly Haven `rusty_painted_metal` (Rusty Painted Metal)](https://polyhaven.com/a/rusty_painted_metal) | Amal Kumar | CC0 1.0 |
| `steel_grating` | Procedural (`tools/blender/military/tools/make_mil_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `timber_creosote` | Procedural (`tools/blender/military/tools/make_mil_tex.py`, own work); derived from Poly Haven `wood_planks_grey` (CC0) | SHADOW SIX project (own work) | CC0 1.0 |
| `timber_grey` | [Poly Haven `weathered_planks` (Weathered Planks)](https://polyhaven.com/a/weathered_planks) | Dario Barresi, Dimitrios Savva | CC0 1.0 |
| `timber_tarred` | [Poly Haven `dark_wooden_planks` (Dark Wooden Planks)](https://polyhaven.com/a/dark_wooden_planks) | Amal Kumar | CC0 1.0 |
| `veh_burnt` | Procedural (`tools/blender/vehicles/cars_moto/scripts/make_burnt_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `veh_paint` | Procedural (`tools/blender/vehicles/cars_moto/scripts/make_veh_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `veh_paintc` | Procedural (`tools/blender/vehicles/cars_moto/scripts/make_paintc_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `veh_tyre`, `veh_wreck` | Procedural (`tools/blender/vehicles/cars_moto/scripts/make_cm_tex.py`, own work) | SHADOW SIX project (own work) | CC0 1.0 |
| `wood_paint` | [Poly Haven `weathered_peeling_timber` (Weathered Peeling Timber)](https://polyhaven.com/a/weathered_peeling_timber) | Dimitrios Savva | CC0 1.0 |

Armour group (baked per-asset atlases):

| Used for | Source | Licence |
| --- | --- | --- |
| green_metal_rust (paint breakup/normal) | Poly Haven | CC0 1.0 |
| rust_coarse_01 (bare steel, tracks) | Poly Haven | CC0 1.0 |
| Rubber004 (tyres) | ambientCG | CC0 1.0 |
| weathered_planks (tool handles, stocks) | Poly Haven | CC0 1.0 |
| Fabric030 / Fabric045 (sandbags, canvas) | ambientCG | CC0 1.0 |
| sand_01 / dense_sand (earth) | Poly Haven | CC0 1.0 |
| geometry, procedural paint/whitewash/burn shaders, track texture, markings (Balkenkreuz, tactical numbers) | own work (SHADOW SIX, Blender script) | CC0 1.0 |

## Fonts

| Asset | Source | Author | Licence |
| --- | --- | --- | --- |
| `assets/fonts/Anton-Regular.ttf` (UI titles) | [google/fonts `ofl/anton`](https://github.com/google/fonts/tree/main/ofl/anton) | Vernon Adams | SIL OFL 1.1 (`assets/fonts/OFL-Anton.txt`) |
| `assets/fonts/Oswald-VF.ttf` (UI text) | [google/fonts `ofl/oswald`](https://github.com/google/fonts/tree/main/ofl/oswald) | Vernon Adams, Kalapi Gajjar, Cyreal | SIL OFL 1.1 (`assets/fonts/OFL-Oswald.txt`) |
| `assets/fonts/*.woff2` (menu subsets: Latin-1 + Latin Extended-A, built with fontTools `pyftsubset`) | the TTFs listed here | as listed | as listed |
| `assets/fonts/Staatliches-Regular.woff2` (menu card titles) | [google/fonts `ofl/staatliches`](https://github.com/google/fonts/tree/main/ofl/staatliches) | Brian LaRossa, Erica Carras (The Staatliches Authors) | SIL OFL 1.1 (`assets/fonts/OFL-Staatliches.txt`) |
| `assets/fonts/ArchivoNarrow-VF.woff2` (briefing body, captions) | [google/fonts `ofl/archivonarrow`](https://github.com/google/fonts/tree/main/ofl/archivonarrow) | Omnibus-Type (The Archivo Narrow Project Authors) | SIL OFL 1.1 (`assets/fonts/OFL-ArchivoNarrow.txt`) |
| `assets/fonts/SpecialElite-Regular.woff2` (typed documents, passwords, tips) | [google/fonts `apache/specialelite`](https://github.com/google/fonts/tree/main/apache/specialelite) | Brian J. Bonislawsky, Astigmatic (AOETI) | Apache-2.0 (`assets/fonts/LICENSE-SpecialElite-Apache-2.0.txt`) |

## Audio

<!-- Sound effects and voices: recorded files in assets/audio (built by tools/audio/build_assets.py); anything not
listed falls back to the procedural placeholders in `src/audio/synth.js` (some vehicles and tools; the music bus never uses a placeholder). -->

Full per-file list (one row per source recording, with URL and author): **`assets/audio/CREDITS.md`**.

| Asset | Source | Author | Licence |
| --- | --- | --- | --- |
| `assets/audio/sfx/{fs_*,rifle_*,pistol,sniper_echo,mg_*,explosion_*,siren_*,dog,…}` (trimmed, split, loudness-normalised, Opus + MP3) | [Freesound](https://freesound.org) (61 source recordings; licence and provenance re-checked live 2026-09-26) | craigsmith (USC 1930s–40s nitrate FX library), kyles, qubodup (DVIDS public-domain footage), unfa, Kostrava and others — see `assets/audio/CREDITS.md` | CC0 |
| `assets/audio/sfx/k_*` (footsteps, impacts, cloth, doors, UI; re-encoded Opus + MP3) | [Kenney](https://kenney.nl) impact-sounds, rpg-audio, interface-sounds, ui-audio | Kenney | CC0 |
| `assets/audio/sfx/{surf,river,wind_air,wind_cold,wind_sand}` (ambience beds, procedural) and `bomb_tick1` (single ticks cut from Freesound 487730) | this project (`tools/audio/procedural_beds.py`) | project contributors | CC0 |
| `assets/audio/narration/**` (the briefing's 1940s newsreel narrator: one clip per briefing line and per map-tour caption, Opus + MP3, word timings; docs/narration.md) | AI-generated: Kokoro-82M (hexgrad) blend am_onyx+bm_lewis+am_eric with British G2P, Praat PSOLA cadence and a synthetic period chain (`tools/audio/narration`); an original voice, no real person cloned or imitated, no reference recordings; the text is our own briefing and tour text | project contributors | project output of an Apache-2.0 model |
| `assets/audio/voice/**` (voices v2: every commando line in his own voice, primary + urgent take, pain/death sounds; German barks and the guards' pain cries — stabbed, shot, blown up, knocked out; word/viseme timing JSON) | AI-generated: Kokoro-82M (hexgrad) and Chatterbox-Multilingual (Resemble AI, PerTh watermark); each commando is a distinct blend of stock Kokoro voicepacks (no pack shared between two men; the French Spy blends Romance-language packs), pitch/formant-shifted; Chatterbox takes are referenced only on those synthetic blends; the German guards are Chatterbox's own built-in synthetic voice (two of them tape-shifted), their cries shaped with Praat PSOLA bends and a synthetic choke / fry / breath chain (`tools/audio/cries`); no real person cloned | project contributors | project output of Apache-2.0 / MIT models |
| Menu foley (`ui_*` ids: rifle safety tick, bolt latch, Bakelite toggle, typewriter strike and bell, paper, coin clink, telegraph buzz, projector, lamp chain) | procedural recipes in `src/audio/synth.js`, played by `src/ui/ui-sound.js` | SHADOW SIX contributors | ours |
| `assets/audio/music/*` (the whole soundtrack: menu, six campaign themes, three briefings, tutorial, credits, start / success / unsuccessful / exit / promotion stingers, the in-mission suspense score; OGG Vorbis + MP3) | original composition for this project (symbolic scores rendered with orchestral samples from [VS Chamber Orchestra 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) and VSCO 1 percussion by Versilian Studios — Sam Gossner, Simon Dalzell; sample cutting by Elan Hickler/Soundemote) | project contributors; samples Versilian Studios | music: project licence; samples CC0 1.0 — per-cue list in `assets/audio/music/CREDITS.md` |

## Research references

Gameplay facts (controls, loadouts, mission data) were gathered from public sources: the original game
manual, *Prima's Official Strategy Guide* (1998), Kildread's GameFAQs FAQ, CommandosHQ and the Commandos
fandom wiki. Details and citations: `docs/research-raw/`.

## Characters & animation

Realistic soldiers, guests and dogs in `assets/characters/` (built by `tools/characters/`; ids, files and sources in
`assets/characters/manifest.json`). Everything shipped is CC0 or project-authored; no CC-BY, NC or mocap-derived data.

| Asset | Source | Author | Licence |
| --- | --- | --- | --- |
| Human bodies, skins, eyes, eyebrows, eyelashes (all commandos, 99 enemy variants, guests) | MakeHuman system assets via [MPFB 2.0.8](https://static.makehumancommunity.org/mpfb.html) for Blender 4.2 | MakeHuman community | CC0 1.0 (system assets). The MPFB add-on itself is GPL and is not shipped. |
| Skeleton and base animation clips (`assets/characters/anims/*.glb`) | [Universal Animation Library 1 + 2](https://quaternius.com/) (UAL1/UAL2) | Quaternius | CC0 1.0 (`License.txt` in the packs) |
| Cloth detail maps baked into the uniform atlases | [ambientCG](https://ambientcg.com/) Fabric030, Fabric045, Rubber004 | Lennart Demes | CC0 1.0 |
| Uniforms, kit, headgear and headgear fit, weapons and props (`weapons/*.glb`), dogs (geometry, rig and clips), procedural crawl, IK clips (go_prone, get_up, crouch_walk, swim glide, drag, tied/follow/boarding, prone deaths), gait re-synthesis, runtimes (`src/art/characters/`, `src/art/humanoid-real.js`) | SHADOW SIX project code (Blender Python + three.js) | project | CC0 1.0 |

Notes:
- Faces are MakeHuman targets with seeded archetypes (16 enemy face types); no scan or photo of a real person is used.
- Uniform insignia are plain: no swastikas, SS runes or death's heads on characters. Enemy flagpoles fly the historical 1935-45 German flag (Options > INSIGNIA > NEUTRAL shows a Balkenkreuz banner instead).
- Rejected sources: Bandai-Namco Research Motion (NC licence); CMU mocap is allowed only as baked clips and is not used here; ACCAD BVH is not used (broken rest pose).
