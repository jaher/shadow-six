# SHADOW SIX: building, structure and set-piece inventory

This is the art team's checklist of every building, structure, bridge and large set piece in the original game. It covers all 20 *Behind Enemy Lines* missions (**BEL M1-M20**) and all 8 *Beyond the Call of Duty* missions (**BCD B1-B8**).

**How it was built:**
- Two separate inventories were merged:
  - **Method A** went mission by mission, using 18 stitched fan-wiki maps and the walkthrough text.
  - **Method B** went source by source: retail `.MIS` mission files, `.WAD` sprite archives, `GLOBAL.STR` tooltips, walkthroughs, the Prima guide and 10 wiki maps.
- A completeness critic then re-checked **M6, M10 and M17** against their full maps (none of the three had been viewed by Method A), plus **M8**, where the two methods disagreed. The critic added 14 types (see §4).

The working notes are in `scratchpad/notes/inv_mission.notes.md`, `inv_source.notes.md` and `inv_merge.notes.md`.

**Sections:**
1. Master table (§1): one row per buildable type.
2. Per-mission checklist (§2).
3. Diff against the art team's current groups, with build batches (§3).
4. Critic log and open points (§4).

## Legend

**Type ids:**
- Ids are snake_case.
- **base** is the ARCHITECTURE `buildProp` catalogue type the id extends, used as `type` + `variant`. For example, `house` + `variant:'log_cabin'`.
- **new** in the base column means the type needs a new catalogue entry. Where design-spec §7.7 already names one, that name is used (`villa`, `lighthouse`, `uboat_pen`, `railway_gun`, `lock_gate`, `control_shack`, `casemate_gun`, `tram`, `cemetery`, `truss_bridge`, `mobile_bridge`, `battleship`, `cable_car`, `drilling_rig`, `mosque`, `flat_roof_house`, `telephone`).

**Gameplay flags:**

| Flag | Meaning |
|---|---|
| **D** | Destructible by charge, grenade or barrel. It needs a ruined/rubble variant (`RUINA` tiles). |
| **Db** | Only a Sapper bomb destroys it (engine `.CASASFUERTES`). |
| **E** | Enterable; commandos hide inside. Engine `CASA`. The interior is a 2D layout and needs no modelled interior, unless the entry says "interior". |
| **B** | A barracks (`CUARTEL`) that spawns reaction patrols until it is destroyed. |
| **J** | A jail (`CARCEL`) that holds captured men. |
| **R** | Walkable roof or top. |
| **L** | Has a ladder or stairs (`ESCALA`). |
| **C** | Climbable by the Green Beret. |
| **dr** | Has an operable door, gate, lever or switch. |

**Size:** real-world metres, W × D × H. It is an estimate from the map sprites against a 1.8 m soldier.

**Status** is measured against the art team's five current groups:
- **`norway` / `desert` / `europe` / `military` / `bridges`**: a group already covers the type.
- **`VAR:<group>`**: a group covers the type, but a mission needs a specific variant.
- **`NEW`**: no group covers it.

**Sources:**
- **[img]**: seen on a map image.
- **[txt]**: walkthrough, Prima or wiki.
- **[MIS]**: a mission-file token.
- **[WAD]**: a sprite name.
- **[STR]**: a tooltip.
- **[inf]**: inferred.

---

## 1. Master table

### 1.1 Houses and civilian buildings

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `house_log_cabin` | house | Norwegian log cabin with a snow-laden gable roof and 1 storey | Norway | M2, M3 (4-5 in the palisade), M5 (village), M6 | E, D | 7×5×5 | norway |
| `house_timber_farm` | house | 2-storey timber farmhouse, snowy roof | Norway | M1 (rendezvous, `ALBERGUE01-03`) | E, C | 10×7×8 | norway |
| `house_norse_fishing` | house | Dark-tarred and red-painted Norwegian coastal houses, some with boat-shed annexes | Norway coast | M7 (E village) | E; the village barracks is D, B | 9×6×7 | VAR:norway |
| `house_bombed_log` | ruins | Roofless, bombed-out 2-storey log house. **Interior** needed: floors, chequer-tile floor, white interior stairs, interior ladder, grandfather clock, round log corner turret, exterior stairs, a C broken wall | Norway | **M6 (×2)** | E, C, L | 16×12×8 | VAR:europe (ruined houses) |
| `house_whitewash_flat` | flat_roof_house | Whitewashed flat-roof house with parapet | N. Africa | M8, M9, M11 | E, R | 8×7×4 | desert |
| `house_adobe_redtile` | house | Adobe row house with a red-tile pent roof | N. Africa | M8 (×6) | E | 6×5×4 | VAR:desert |
| `house_stone_pitched` | house | Stone house with a pitched roof, desert village | N. Africa | M9 | E | 7×6×5 | VAR:desert |
| `house_domed_arcade` | house | White domed house with an arcaded courtyard and flag | N. Africa | M8 (the "whitewashed domed barracks") | E, D | 14×12×7 | VAR:desert |
| `medina_block` | flat_roof_house | Dense medina block: 2-4 storeys, white or ochre render, parapets, roof terraces, **roof ladders, exterior stairs, arched balconies, pergolas**, small green-tiled **qubba** roof domes. Continuous rooftop routes | Tunis | M12 | E, R, L | 10-20 × 10-20 × 7-14 | VAR:desert |
| `souk_arcade` | new | Arcaded souk colonnade with shopfronts | Tunis | M12 | — | 30×6×6 | NEW |
| `palace_tiled_domes` | new | Palace with a tiled facade and green domes | Tunis | M12 | E, R | 25×20×12 | NEW |
| `farmhouse_normandy` | house | Normandy farmhouse | France/Belgium | M16/M18 (NE farm) | E | 12×8×8 | europe |
| `house_belgian_brick` | house | Belgian brick house or townhouse, gabled or hipped, 2-3 storeys. Some are damaged | Belgium | M16/M18 (NE village) | E | 8×8×10 | europe |
| `townhouse_stucco` | house | 3-4 storey stucco townhouse, grey (M16) or cream (M15) | France/Belgium | M15 (N), M16/M18 (NW) | E | 10×10×13 | NEW |
| `townhouse_corner_turret` | house | Second-Empire corner block: 4 storeys, **round corner turret**, slate mansard, **ground-floor shopfronts with red awnings**, balcony with ladder or fire escape | France | M15 (Sniper roof) | E, R, L | 20×15×16 | NEW |
| `mansion_hq_mansard` | villa | HQ mansion: brick with stone quoins, slate mansard, dormers, tall chimneys, Nazi banners. Low wall with iron railings and gates, W parterre garden, E car yard | France | M15 | **D** (objective), E | 30×15×15 | NEW |
| `house_half_timber` | house | Half-timbered (Fachwerk) house, red tile, 2-3 storeys | Germany | B5 (S village), B6 (village) | E | 9×8×10 | europe |
| `house_half_timber_turret` | house | 2-storey half-timbered house with a round turret; also serves as a gate-tower house | Germany | M20 (by the range) | E | 12×9×12 | built: europe `house_halftimber_d` (Breisgau, corner turret, flag) |
| `house_timber_hq_L` | house | Dark timber L-shaped 2-storey HQ house, porch stairs, flag | Alsace | M17 (N bank) [img] | E | 18×12×9 | VAR:norway |
| `house_greek_whitewash` | house | Whitewashed Cretan house with terracotta roof; some have chimneys | Crete | B3 (13 `CASA`) | E | 7×6×5 | NEW |
| `church_greek_white` | new | White Greek church with a Byzantine/baroque bell-gable facade; the start is inside it | Crete | B3 | E | 16×10×12 | NEW (europe church does not fit) |
| `canal_house_dutch` | house | Dutch canal house: stepped or bell gables, brick, 3-4 storeys, red tile, dormers. About 30 (`ALBE`) | Netherlands | B8 | E | 6×12×14 | NEW |
| `club_corner_turret` | house | Corner club/hotel with a turret; the "nightclub" (`BOITE DE NUIT` [STR]) meeting place | Netherlands | B8 | E | 16×14×15 | NEW |
| `farmhouse_brick_dutch` | house | Brick farmhouse or cottage | Netherlands | B8 | E | 12×8×7 | VAR:europe |
| `farmhouse_baltic` | house | Steep-roofed half-timbered farmhouse with yard, pond and well; walled farm with barn, house and shed | N. Germany | B6 (S farm) | E | 16×10×10 | VAR:europe |
| `villa_alpine` | villa | Half-timbered Alpine/Tudor villa with a turret; used as the barracks | Serbia | B2 (NW) | E, B, D | 18×12×12 | NEW |
| `villa_neogothic` | villa | Neo-Gothic villa or château: conical turrets, slate mansard, dormers, flags | Serbia/Germany | B2 (SE, HQ); see also `chateau_hq` | E | 20×15×16 | NEW |
| `palace_u_shaped` | villa | U-shaped 3-storey palace: stucco, mansard, dormers, **glazed skylight roof**, front perron stairs, arched loggia pavilion, E-door platform, L/R parterres. The general's uniform is on the roof | Prussia | B5 | E, R, L | 60×35×16 | NEW |
| `villa_round_bay` | villa | Small 2-storey villa with a round bay; probably the jail holding the Spy (`CARCEL_OFICINAS`) | Prussia | B5 | E, J | 12×10×9 | NEW |
| `shop_front` | house | Row of shopfronts: 12 `TIENDA01-12` in B4 (they may be the 10 `TIEN14-23` objects, [inf]); M15 ground floors | Germany/France | B4, M15 | E | 6×6×8 | europe |
| `restaurant_pavilion` | house | Half-timbered restaurant or tavern pavilion (`CASA_TASCA`) with picnic tables | Serbia | B2 | E | 14×10×7 | NEW |

### 1.2 Military buildings (barracks, HQs, huts, stores)

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `barracks_timber_long` | barracks | Long, single-storey weathered timber barracks with a snowy gable roof, L-shaped or rectangular | Norway | M1 (×2), M3, M5 (×2, summit) | B, D, E | 22×7×5 | norway |
| `barracks_log_flag` | barracks | Log garrison barracks with a flagpole | Norway | M2 (inside and outside the camp) | B, D | 16×7×5 | norway |
| `barracks_rendered_hip` | barracks | White-rendered barracks with a snowy hip roof | Norway | M7 (×2-3) | B, D, E | 20×9×7 | VAR:norway |
| `barracks_desert` | barracks | Flat-roof desert barracks. Some have guards on the roof | N. Africa | M8, M9, M10, M11, M12 | B, D, R | 18×8×4 | desert |
| `barracks_corrugated_gable` | barracks | Long corrugated-iron gable barracks with a flag; brick or timber hipped corrugated in M19 | Desert/Germany | M10 (NE), M19 (×2-3) | B, D | 24×9×6 | VAR:military |
| `barracks_concrete_2st` | barracks | 2-storey flat-roof grey concrete barracks/blockhouse with outside stairs | Atlantic Wall | M14 (4-5) | B, E, R, L | 16×10×7 | BUILT (M14 pass: `barracks_concrete_2st`, `barracks_concrete_1st`) |
| `hut_timber_barrack` | hut | Small wooden barrack hut: plank walls, grey shingle roof | Germany | M20 (about 12, S courts), B5 (small wooden huts) | E | 10×5×4 | built: europe `hut_timber_barrack_a-d` |
| `hut_pow_long` | hut | Long wooden prisoner hut on a raised floor, grey pitched roof. M17 variant: dark timber, one cross-gable | Germany/Alsace | B7 (about 10), M17 (5-6) | E | 30×8×5 | VAR:military (stockade) |
| `nissen_hut` | hut | Corrugated half-cylinder (Nissen/Quonset) hut | Norway/France | M2 (in the camp), M13 (×3) | E | 10×6×4 | NEW |
| `quonset_hangar` | hangar | Large Quonset arched hangar | Norway | M7 (NW) | E | 30×15×8 | VAR:military |
| `hq_villa_brick` | villa | Red-brick 2-3 storey HQ (`JEFATURA`): stone steps, circular drive around a fountain or monument, double walls with gatehouses, inner-court barracks, steps down to a pier | Norway | M4 | **D** (charge on steps), E | 22×14×12 | military |
| `hq_log_flatroof` | house | Log HQ with a flat roof section, rooftop gear and flag; a guard stands on the roof | Norway | M6 | R, L | 14×10×6 | VAR:norway |
| `stone_chapel_tower` | house | Stone building with a round tower, slate roof, arched door and flag | Norway | M6 (NW) [img, critic] | E | 16×8×10 | NEW |
| `fortified_block_tower` | house | Stone-and-timber block with a round stone tower, flag, lean-to open canopy, ladder and platform | Norway | M6 (the "NE fortified block") [img, critic] | L, R | 16×12×10 | NEW |
| `hq_domed_terraced` | new | Whitewashed, flagged command post: terraced, with a dome and outside stairs | N. Africa | M9, M11 (central garrison, guards on the roof) | **D**, R, L | 16×12×8 | NEW |
| `domed_block` | house | Flat-roof block with an observatory-like dome | N. Africa | M10 (walled compound) [img] | E | 10×10×7 | VAR:desert |
| `warehouse_adobe` | house | Flat-roof adobe warehouse with a large door | N. Africa | M9 (E and W) | D, E | 16×10×6 | VAR:desert |
| `weapons_store` | house | Weapons or bomb store: a small, heavy flat-roof store with a door | N. Africa | M9 (the team hides in it), M10 (**objective**, S edge) | **D**, E | 10×8×4 | VAR:desert |
| `warehouse_large` | house | Large brick or corrugated warehouse with a huge black door | Europe | B4 (`E`), M12 (corrugated harbour shed) | E | 30×15×10 | NEW |
| `ammo_house` | house | Ammunition house (`CASA_MUNICION`) | Germany | B7 | E, D [inf] | 8×6×4 | NEW |
| `tent_ridge_field` | tent | European grey/dark ridge tent, alone or in rows | All | M3, M6 (about 15), M16/M18 (about 6), B3 (camps), B4 (forecourt, about 12) | D (`LONA`) | 4×3×2.2 | NEW |
| `tent_pyramid_desert` | tent | Tan pyramid or square tent | N. Africa | M8, M10 (×3), M11 | D | 5×5×3 | desert |
| `tent_large_barrack` | tent | Large "barrack tent" or tarp shelter over equipment; covers the HS 293 bomb in B3 | Crete/Norway | B3, M4 (`LONA1-4`) | D | 12×6×4 | NEW |
| `guard_hut` | hut | Timber guard hut | All | M1, M2, M4 | E | 3×3×3 | norway |
| `sentry_box` | hut | Sentry box (guérite, `GARI`/`GARE`, tooltip `GUERITE`): 1-man upright box | All | M1 (end of the stone wall), M2 (gate), B5 (×12) | — | 1.2×1.2×2.4 | VAR:norway (guard hut) |
| `jail_cell` | new | Small jail cell or cell block with a barred door. It can be a room in a building (`CARCEL`) | All | M4, M12 (off the courtyard), M17 (cage-type gate), B5 (×2), B7 (punishment cells `CELDAS_CASTIGO`) | J, dr | 6×4×3 | NEW |
| `comms_hut_antenna` | hut | Small communications hut cabled to a lattice antenna mast; in M9 the mast stands in a sandbag ring | N. Africa/Norway | M5 (antenna), M9 (**2 objectives**: mast and hut) | **D** | hut 4×3×3; mast 18 h | NEW |
| `relay_station` | hut | Timber radio relay hut with a tall lattice radio mast and a parked vehicle (`RADI0000-2`, `RADIOEXP`) | Norway | M1 (**objective**, NW island) | **D** | hut 5×4×3; mast 20 h | NEW |
| `radar_station` | new | Radar building with a Würzburg dish and antenna mast (`CASA04`) | Norway/Guernsey | M5 (summit, **objective**), B1 (**objective**) | **D** | bldg 10×6×4; dish 7.5 Ø | norway (building); VAR for the dish |
| `hangar_metal` | hangar | Metal hangar with a corrugated gable roof | Desert/Germany | M10, B6 (×2, `CASA_HANGAR`) | E | 35×30×10 | military |
| `control_tower_airfield` | new | Airfield control-tower building: brick, with a tower | Germany | B6 | E, R | 14×10×12 | NEW |
| `pilot_house` | house | Pilots' house (`CASA_PILOTO`) and workshop at the airfield | Germany | B6 | E | 10×8×6 | VAR:europe |
| `officers_residence` | villa | Commandant's or officers' house: stone, slate roof. It hosts the review (`CASA_SALE_REVISTA`) | Germany | B7 (**objective**), B5 (`CASA_REACT_RESIDENCIA`) | **D**, E | 16×10×10 | NEW |
| `guardhouse_brick` | house | Brick or stone guardhouse at a camp gate | Germany/Guernsey | B7, B1 | E | 10×6×5 | VAR:military |

### 1.3 Fortifications and defences

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `watchtower_stilt` | watchtower | Timber stilt watchtower with a roofed platform and ladder | All | M2 (×2 MG towers), M17 (×5), M19, B5 (perimeter towers `TORRE_PERIMETRO`), B7 (corners, `TORRE_SO`) | L, R, D (M19) | 3×3×8 | military |
| `tower_round_log` | new | Cylindrical log tower with a snow-capped conical top at a palisade corner. These are the M6 "round wooden watchtowers" | Norway | M6 (×4-5) [img, critic] | L [inf] | 4 Ø × 7 | NEW |
| `searchlight_tower` | searchlight | Searchlight on a tower, with an interrupter (`FOCO`, `FOCODEST`, `INTERFOC`) | Germany | BCD extra map `MAPA0009` (a B7 variant) | D | 3×3×7 | VAR:military |
| `mg_nest_sandbag` | sandbags | Sandbag MG/Gatling nest ring, open behind (`NIDOMET`/`METRBASE`) | All | M1, M4 (×3), M6, M10 (×3), M14 (×5), B1 (×3), B4 (×2), B5 (×4) | — | 4 Ø × 1.2 | military |
| `bunker_concrete` | bunker | Flat concrete bunker, flagged in places, releases patrols | All | M3 (dam abutment + about 4 garrison bunkers), M5 (SE, D), M8 (SW), M10 (airfield), M19 | D (M3, M5) | 8×6×3 | military |
| `pillbox_round` | bunker | Round concrete pillbox, possibly with a cupola | Belgium/Alsace/Prussia/Desert | M16/M18 (both bridge ends, D in M18), M17 (riverside, D), M8 (SW, with cupola) [img], B5 | D | 6 Ø × 3 | NEW |
| `bunker_sandbag_thatch` | bunker | Sandbag bunker with a thatch or timber roof | N. Africa | M9 (**objective**) | **D** | 8×6×2.5 | VAR:military |
| `dugout_airfield` | bunker | Long, low, log/sandbag-roofed dugout bunker | N. Africa | M10 (airfield NW; it releases patrols) [img] | — | 14×6×2.5 | NEW |
| `casemate_embrasure` | casemate_gun | Concrete casemate/blockhouse with a gun embrasure (Atlantic Wall) | France | M14 (×2) | **D** | 12×10×5 | BUILT (M14 pass: `casemate_h612` 8×9, `casemate_h679` 12×9, + destroyed) |
| `gun_turret_block` | casemate_gun | Concrete block with a rotating gun turret | France | M14 | **D** | 10×10×5 | BUILT (M14 pass, + destroyed) |
| `gun_pit_open` | new | Open circular concrete gun pit, for a coastal gun or a flak/AA gun | France/Guernsey/Norway/Desert | M14 (coastal), M7 (×2 210 mm coastal guns), M8 (210 mm on the escarpment), B1 (×5 AA `ANTI01-05`) | **D** | 10 Ø × 1.5 | BUILT (M14 pass: 155 mm GPF on a Kreisbettung, + destroyed) |
| `aa_ring_sandbag` | aa_gun | Circular sandbag AA emplacement | Germany | B6, B5 (apron AA) | D | 7 Ø × 1.2 | VAR:military |
| `flak_rampart` | aa_gun | Flakvierling on a castle rampart, with crates | Germany | M20 (N rampart) | D | 4×4×2 | built: M20 procedural (art/field-guns.js) |
| `at_gun_emplacement` | new | Fixed anti-tank or pier gun emplacement: a sandbag or concrete gun position | France/Germany | M13 (pier gun by the floodgate), M20 (N rampart, covers the Panzer III) | — | 5×5×1.5 | NEW |
| `blockhouse_wolfsschanze` | bunker | Flat-roofed camouflaged concrete blockhouse; one has a rooftop platform with stairs. Includes a long low concrete barracks | Prussia | B5 (SE compound) | R, L, B | 20×12×6 | NEW |
| `bunker_cupola` | bunker | Round concrete bunker with an armoured cupola | Prussia | B5 | — | 8 Ø × 3 | NEW (shares a mesh with `pillbox_round`) |
| `at_wall_segment` | wall | Free-standing concrete anti-tank wall segment | France | M14 (its watchers trigger the alarm) | — | 8×1×2.5 | BUILT (M14 pass: 8 m section, tiled along `sea_wall` runs) |
| `blast_wall_revetment` | wall | Free-standing concrete blast-wall or revetment segments on an apron | N. Africa | M10 (E apron) [img, critic] | — | 10×1×2 | NEW |
| `dragons_teeth` | new | A row of concrete dragon's teeth | France | M14 | — | 1.2×1.2×1.2 each | BUILT (M14 pass) |
| `czech_hedgehog` | new | Steel Czech hedgehog (beach or wire obstacle) | All | M14 (hundreds), M6, M8, M10 (wire belts), M11, M15 (roadblock) | — | 1.8 | BUILT (M14 pass) |
| `beach_tetrahedron` | new | Concrete tetrahedron or pyramid beach obstacle | France | M14 | — | 1.5 | BUILT (M14 pass) |
| `wire_on_stakes` | fence | Barbed wire on stakes, and wire belts | All | M4 (gorge rim), M6, M8, M10, M14 | cut | linear | VAR:military |
| `trench_ruins` | trench | Trench with low ruined foundation walls | N. Africa | M10 (start) [img] | cover | area | VAR:desert |
| `v2_pad_gantry` | new | V2 upright on a launch table, with a service gantry | Germany | M19 (×3, **objective**) | **D**, L | 6×6×16 | military |
| `v2_meillerwagen` | new | V2 on its Meillerwagen trailer | Germany | M20 (×2, **objective**) | **D** | 14×3×3 | built: military `v2_meillerwagen` (+ `_b`, `_destroyed`) |
| `firing_range` | new | Dirt yard with wooden target frames, timber fences and benches | Germany | M20 | — | 30×20 | built: military `firing_range(_b)`; M20 targets + bullet stops procedural (art/field-guns.js) |
| `stockade_prison` | fence | Prison-camp enclosure. **M17**: low brick walls with an iron-railing top, zigzag inner divisions, iron gate, back gate with a wall control box, inner wire-mesh yard. **B7**: double barbed-wire fence with named gates N1/N2, S1/S2, E1/E2 | Alsace/Germany | M17, B7 | dr | area | VAR:military |
| `palisade_log` | wall | Vertical-log palisade. **M2**: diamond camp, a ladder that can be raised or lowered, log gateway with sentry box and barrier; C, D at the E corner. **M3**: E-bank camp. **M6**: compounds and free-standing segments | Norway | M2, M3, M6 | C, D, L, dr | linear, 4 h | NEW |
| `palisade_plank` | wall | Tall timber plank palisade fence with gate | Germany | M19 (V2 base) | dr | linear, 4 h | NEW |
| `wall_mudbrick` | wall | Mud-brick perimeter wall with an arched gate (M10); octagonal adobe perimeter (M9); stone-wall lines with 2 gates (M11) | N. Africa | M9, M10, M11 | C | linear, 3 h | desert (octagonal wall) |
| `fence_chainlink` | fence | Chain-link or wire-mesh fence on iron posts, including a mesh corridor with iron gates | Desert/Norway | M3 (electric, cuttable), M8 (perimeter), M9 (W gate corridor), M10 (compound/apron divider) [img] | cut, dr | linear, 2.5 h | NEW |
| `prisoner_cage` | fence | Small mesh prisoner cage | N. Africa | M10 (holds McRae) | J, dr | 8×6×3 | VAR:military (stockade) |
| `castle_fortress` | wall | Octagonal fortress: thick stone curtain walls with walkable rampart tops, several terrace levels joined by stair flights, arched gate tunnels, conical bartizans, moat, SW and SE gatehouses with moat bridges. There is **one C spot on the W wall** | Germany | M20 | R, L, C (1 spot) | 200×200 site | built: M20 procedural (art/castle-kit.js: curtains, terraces, gatehouses, towers, stairs, bridges, water gate) |
| `chateau_hq` | villa | Neo-Gothic château HQ: conical towers, slate mansard, dormers | Germany | M20 (**objective**) | **Db** | 30×20×20 | built: military `chateau_hq` (+ `_destroyed`) |

### 1.4 Industrial and utility

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `fuel_tank_horizontal` | fueltank | Large horizontal cylinder tanks on cradles. **M8**: twin tanks under a frame with a roof walkway, ladders, guards on top | All | M2 (×2, **objective**), M8 (2 blocks, **objective**), M13 (×3, **objective**), M12 | **D** (`DEPO`), L, R | 10×4×4 each | NEW |
| `fuel_tank_elevated` | fueltank | Twin cylinder tanks on a raised frame, with a ladder and an **oil valve** (spills oil to be ignited) | Alsace | M17 [img] | D, L, dr | 5×3×6 | NEW |
| `fuel_tank_pushable` | fueltank | Wheeled fuel bowser that can be pushed (`DEPOSEMP`) | Germany | B6 (×4) | D | 5×2×2.5 | NEW |
| `oil_tanks_vertical` | fueltank | White vertical process tanks with pipework (`TUBO`) | N. Africa | M11 (2 clusters at the rigs) | D | 5 Ø × 7 | NEW |
| `water_reservoir_round` | new | Squat riveted round water reservoir on a low base | N. Africa | M8 (**objective**) [img] | **D** | 10 Ø × 6 | NEW |
| `water_tower_legs` | new | Tank on a lattice or timber-leg tower | Desert/Germany | M11 (SW camp), B7 (timber, in the yard), M19 (small cylindrical tank at the mine) | D [inf] | 4 Ø × 10 | NEW |
| `windpump` | new | Lattice windmill water pump | N. Africa | M10 (in the compound; A mistook it for a radio mast), M11 | — | 3×3×9 | NEW |
| `drilling_rig` | drilling_rig | Lattice pyramidal oil derrick on a pump skid | N. Africa | M11 (×4, **objective**) | **D** | 6×6×25 | desert |
| `well` | well | Stone well, possibly with a ladder (`ESCALA_POZO`) | All | M3, M16/M18, B6 (ladder), B7 | L (B6) | 2 Ø | desert (VAR:europe for the stone well with ladder) |
| `dam_arch` | dam | Curved concrete arch dam spanning a gorge, with a walkable crest road. 27 `PRES` tiles and **5 numbered spillway gates** (`1COM-5COM`) over the reservoir (`EMBA`) | Norway | M3 (**objective**, charge at the base) | **D**, R | 120×10×40 | bridges (VAR: 5 spillway gates) |
| `hydro_station` | house | Hydro power-station admin building and barracks; a large shed (`ALMA`/`CASE`) | Norway | M3 | E | 16×10×7 | VAR:norway |
| `transformer_cage` | new | Fenced transformer cage with insulators (`AISL`); about 12 set in a grid | Norway | M3 | — | 5×5×4 | NEW |
| `electric_fence_switch` | fence | Powered chain-link fence (`ALAM` ×12) with a fence switch box or switch tower | Norway | M3 | cut, dr | linear | NEW |
| `power_pylon` | new | Lattice power-line pylon | Norway | M3 (crosses the river) | — | 6×6×25 | NEW |
| `tunnel_portal` | new | Rock-cut tunnel portal with an arched masonry face; it collapses on a charge | N. Africa | M11 (N cliff) | **Db** | 10×4×7 | NEW |
| `tank_shed_open` | new | Open-front multi-bay tank shed or garage: timber or corrugated, some with broken roofs | N. Africa/Germany | M9 (3 bays, 3 Panzer IVs roll out), M10 (about 5 sheds), M19 (with smokestack) | — | 8×12×5 per bay | NEW |
| `garage_brick` | house | Brick garage/warehouse with a big door (the Panzer II garage); a truck can block it | France | M13 | dr | 14×10×7 | NEW |
| `gantry_hoist` | new | Lattice A-frame gantry hoist over a tank under repair | N. Africa | M9, M10 [img] | — | 8×4×7 | NEW |
| `crane_tower_jib` | new | Lattice steel tower or jib crane | Alsace/Germany | M17 (outside the NW camp wall) [img], M19 (rail base) | — | 4×4×14 | NEW |
| `crane_dock_portal` | new | Dockside portal jib crane, on rails in one case | France/Germany | M13 (×2), B4 (yard cranes), M7 (dock crane) | — | 8×8×18 | NEW |
| `gantry_crane_overhead` | new | Overhead travelling gantry crane over tracks | Germany | B4 | — | 25×6×10 | NEW |
| `coal_mine_complex` | new | Timber pithead/headframe on a cliff with an exterior stair and ramps; adit entrance; coal heaps and mine carts; brick boiler/pump house with chimney | Germany | M19 (NW) | L | 20×15×15 | NEW |
| `mining_office` | house | Brick mining office with a flag | Germany | M19 | E | 10×8×7 | NEW |
| `conveyor_incline` | new | Inclined conveyor belt on a steel frame, from a coal hopper into the base shed. A **switch reverses it**; it carries crawling men | Germany | M19 | dr | 40×3×8 | NEW |
| `coal_hopper` | new | Coal hopper/bunker | Germany | M19 | — | 6×6×8 | NEW |
| `watermill` | new | Half-timber and stone watermill with a waterwheel and a deck on the river | Alsace/Netherlands | M17 (old mill) [img], B8 (`MOLINO_AGUA`, **D** `EXPL_MOLINO01`) | E, D (B8) | 12×10×9 | europe |
| `windmill_post` | new | Dutch timber post/smock mill with **animated sails** (`ASPA1/2`, `ASPAMOL`) on a round mound | Netherlands | B8 (×2) | — | 6×6×18 | NEW |
| `shed_timber_long` | hut | Long timber-roofed shed, open shelter or pergola | N. Africa/Netherlands | M11, B2 (ostrich paddock shed), B7 (bridge shed `CASA_COBERTIZO_PUENTE`) | E [inf] | 12×5×4 | NEW |
| `henhouse` | hut | Henhouse/chicken coop (`GALLINERO`, `GALL`) | Norway/Prussia/Germany | M4 (D), B5, B6 | D | 3×2×2 | NEW |
| `dog_kennel` | new | Dog cage/kennel pen | Germany | M19 | dr | 4×3×2 | NEW |
| `outhouse` | hut | Latrine/outhouse | Germany | M19, M20 | E [inf] | 1.5×1.5×2.5 | built: M20 procedural (castle-kit buildOuthouse) |

### 1.5 Rail, harbour and airfield

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `station_building` | house | 2-storey brick station with a hip roof and platform; acts as a barracks in M18 | Belgium | M16/M18 | E, B, D (M18) | 20×10×9 | europe |
| `station_hall_grand` | new | Grand station hall: stone, slate mansard, 3 pavilions, walkable roof, long platform canopies, island platforms with lamps, walled forecourt (`CASA_ESTACION`, `CUARTEL_ANDENES`) | Germany | B4 | E, R, B | 80×25×18 | NEW |
| `goods_shed` | house | Rail goods shed | Belgium/Germany | M16/M18, B4 | E | 20×10×6 | NEW |
| `roundhouse_turntable` | new | Brick semicircular roundhouse with arched doors, and a turntable (2 roundhouses) | Germany | B4 | — | 40×30×9 | NEW |
| `depot_sawtooth` | new | Brick workshop/depot with a sawtooth roof and tall chimney | Germany | B4 | E | 30×20×10 | NEW |
| `signal_box` | hut | Signal box, lamp huts, small brick rail houses | Germany/Belgium | B4, M16/M18 | E | 6×4×7 | NEW |
| `signal_gantry` | new | Signal gantries and lattice signal masts ("metal tower") | Germany | B4 | — | 15×1×8 | NEW |
| `level_crossing` | new | Road/rail level crossing: boom barriers (`BARRERAPASO1/2`), barrier control box (`CONTRBARRTREN1/2`) and crossing shack | Norway/Belgium | M4 (the supply truck stops here), M16/M18 | dr | 10×8 | NEW |
| `road_barrier` | new | Boom barrier (`BRRE`, `BARRIERE`) | All | M1, M2 (gate), B5 (gatehouses) | dr | 5×0.3×1.2 | NEW |
| `rail_yard_derelict` | train_car | Derelict freight wagons and carriages, sidings, rubble, buffer stops, stacks of sleepers and rails | Norway/Germany | M4 (SW yard), B4 | — | 12×3×4 per wagon | VAR (catalogue `train_car`) |
| `mine_railway` | rail_track | Narrow-gauge mine railway with mine carts | Germany | M19 | — | linear | NEW |
| `quay_granite` | new | Cut-granite quays and moles: bollards, iron railings, quay-face stairs, slipways, and a lattice beacon mast on each mole head | France/Norway/Tunis | M13, M7 (stone mole with lighthouse, U-boat ramp), M12 (quay basin) | — | linear, 3 h | NEW |
| `quay_brick_canal` | new | Brick canal quay walls with water stairs | Netherlands | B8 | — | linear | NEW |
| `pontoon_minisub` | pier | Floating pontoon/pad reached by 2 ladders | France | M13 | L | 10×6 | VAR:bridges |
| `marina_jetties` | pier | Many small timber finger jetties with fishing boats and a rowboat | Norway | M7 (about 20 boats) | — | 15×2 each | VAR:bridges |
| `wharf_timber` | pier | Timber wharf or dock | Netherlands | B8 (W, the escape launch) | — | 30×8 | bridges |
| `uboat_pen_open` | uboat_pen | U-boat dock: 2 long concrete finger piers with 2 U-boats, a platform with a ladder between them, a dock crane. **Not a covered bunker** in the original | Norway | M7 | L | 80×40 | VAR:military (the current model is a covered pen) |
| `lighthouse_small` | lighthouse | Small white lighthouse on the end of a stone mole | Norway | M7 | — | 3 Ø × 10 | military |
| `lighthouse_round` | lighthouse | Tall white round lighthouse with internal stairs and ladders (`FARO01`, tooltip `PHARE`) | Guernsey | B1 (**objective**) | **D**, L, R | 6 Ø × 25 | VAR:military |
| `lift_tower_cliff` | new | Lattice lift tower down the cliff to the beach (`ASCENSOR`, tooltip `ASCENSEUR`) | Guernsey | B1 | dr | 3×3×30 | NEW |
| `airfield_strip` | road | Runway, taxiways and paved apron | Desert/Germany | M10, B6 | — | area | VAR |

### 1.6 Bridges, piers and water structures

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `bridge_stone_arch` | bridge | Stone arch bridge with 1, 3 or 5 arches | Europe | M15 (E and W canal bridges) [txt]; generic | — | 10-50 long | bridges |
| `bridge_timber_trestle` | bridge | Timber plank trestle road bridge | All | **M8** (over the N-S wadi; the extraction point; a Gatling guards it). The critic's image check shows timber, not stone. Also B3 (gorge), B7 (road bridge, bridge house `CASA_PUENTE`) | — | 20×5 | bridges |
| `bridge_timber_deck_long` | bridge | Long timber-deck road bridge with railings on piles over a wide river | Alsace | M17 (main river, N side) [img, critic] | — | 60×5 | VAR:bridges |
| `rail_trestle_timber` | rail_bridge | Tall timber trestle railroad bridge over a gorge; ladder on a pier; a steam train crosses | Norway | M4 | L | 80×5×30 | bridges |
| `rail_bridge_mine_low` | rail_bridge | Low, long mine-rail trestle over a fast river; the only bridge on the map | Germany | M19 | — | 40×3×3 | VAR:bridges |
| `truss_bridge_maas` | truss_bridge | Steel through-truss with a central bowstring arch span and flat truss approaches on concrete/masonry piers. Charge markers A/B/C sit under it, with a detonator on the island landing | Belgium | M16 (wired), M18 (**Db**, objective) | **Db** (M18) | 200×10×20 | bridges |
| `mobile_bridge_sliding` | mobile_bridge | Sliding red-timber plank "mobile bridge" over a rocky ravine: a lever on the N bank, or controls in the adjacent truck | Alsace | M17 | dr | 15×5 | bridges |
| `bascule_bridge_dutch` | mobile_bridge | Timber double-leaf bascule drawbridge with overhead balance beams (`PUENTE`), switch `INTERRUPTOR` | Netherlands | B8 | dr | 15×5×8 | VAR:bridges |
| `footbridge_plank` | bridge | Small plank footbridge | All | B7, B8 (2-3) | — | 8×1.5 | bridges |
| `pier_timber` | pier | Wooden pier or jetty | Norway | M1 (N island SE shore, S bank), M4 (HQ pier with patrol boat), M16/M18 (island landing) | — | 15×3 | bridges |
| `jetty_stone` | pier | Small stone landing or jetty | Guernsey | B1 | — | 10×4 | VAR:bridges |
| `lock_gate` | lock_gate | Steel lock/flood gate leaves between mole heads; each has a `control_shack` with a glass window and a lattice beacon mast. They open and close, and stay open once the operator is dead | France | M13 (×2) | dr | 20×2×8 | bridges |
| `moat_bridge` | bridge | Short bridge over the moat at a gatehouse | Germany | M20 (SW, SE) | — | 10×4 | built: M20 procedural timber moat bridges (castle-kit); bridges `moat_bridge_fixed/draw` |
| `water_gate_underwater` | new | Underwater gate in the E wall, opened by a lever with a flashing red light; the pool is fed by the moat | Germany | M20 | dr | 4×1×3 | built: M20 procedural grated arch (castle-kit; the grate rises with the lever) |
| `canal_basin_sunken` | new | Sunken canal basins: stone retaining walls, stair ramps, tree-lined park strips | France | M15 | — | area, 3 deep | NEW |
| `underwater_pipe` | new | Underwater pipe used to cross the river | Germany | B7 | — | linear | NEW (minor) |
| `sea_mine_chain` | new | Sea mines on chains; there are 22 | Guernsey | B1 | D | 1 Ø | NEW (minor) |

### 1.7 Religious, civic, landmark and leisure

| id | base | Description, style, materials | Theater | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|---|
| `mosque_minaret` | mosque | Great mosque on a raised platform with stair flights, a tall square/octagonal minaret with a balcony, a ribbed dome and arcaded courtyards | Tunis | M12 | E, R, L | 40×40×35 | desert |
| `church_european` | new | Stone church | Europe | generic europe group; no confirmed BEL instance [inf] | E | 25×12×25 | europe |
| `cemetery` | cemetery | Chest tombs/sarcophagi, cypresses, iron-railing fence with a cemetery gate, and a small chapel or kiosk | France | M15 (NE; the exit van waits here) | dr | 40×30 | europe (VAR: chapel/kiosk, chest tombs) |
| `fountain_statue` | new | Fountain roundabout with a statue, monument, or plaza fountain with an iron-railing park and brick gate piers | Europe | M4 (drive monument), M15 (roundabout), B2 (garden courtyard), B8 (plaza) | — | 8-15 Ø | NEW |
| `tram_set` | tram | Tram car, tram track, overhead catenary poles, tram stop (`TRAMWAY` [STR]) | France | M15 | — | linear | NEW |
| `street_furniture_fr` | lamp_post | Morris advertising column and cast-iron street lamps | France | M15; lamps in B2 and B4 | — | 1.2 Ø × 4 | NEW (minor) |
| `temple_doric_ruin` | ruins | Classical Doric temple ruin: standing columns, pediment, stepped podium | Crete | B3 | — | 20×12×10 | NEW |
| `stoa_ruin` | ruins | Ruined colonnade (stoa) with foundations | Crete | B3 | — | 30×6×6 | NEW |
| `tholos_base` | ruins | Round tholos base | Crete | B3 | — | 10 Ø | NEW |
| `mausoleum` | new | Mausoleum/pantheon that acts as a reaction barracks (`CUARTEL_PANTEON`) | Crete | B3 | B, D | 8×8×7 | NEW |
| `zoo_animal_pit` | new | Circular sunken animal pit: concentric rock terraces, plank ramps, moat, iron railing ring; holds the lions (`ZONA_FOSO`) | Serbia | B2 | — | 40 Ø | NEW |
| `zoo_garden_court` | new | Circular formal garden courtyard: fountain, pond, hedges, iron fence ring with gates, small pavilion (`ZONA_JARDIN`) | Serbia | B2 | dr | 40 Ø | NEW |
| `zoo_cage_house` | new | Small cage house: brick base with a barred iron-and-glass cupola roof (about 9) | Serbia | B2 | E | 6 Ø × 5 | NEW |
| `zoo_glasshouse` | new | Large glasshouse/aviary pavilion | Serbia | B2 | E | 25×12×10 | NEW |
| `zoo_kiosk_octagon` | new | Octagonal domed kiosk or cage | Serbia | B2 | — | 6 Ø × 6 | NEW |
| `zoo_gate` | gate | Ornate zoo entrance gatehouse: brick arch with iron gates; also the ostrich gate `PUERTAAVESTRUCES` | Serbia | B2 | dr | 12×4×8 | NEW |
| `zoo_paddocks` | fence | Ostrich paddock with shed, elephant enclosure/house (`BARRIGA_ELEFANTE`), stable (`CASA_ESTABLO`), keeper's house (`GUARDA`), cart shed (`CASA_CARRICOCHE`), ticket/guard booth | Serbia | B2 | E | area | NEW |
| `wall_brick_railing` | wall | Brick perimeter wall with iron railings and piers | Serbia/France | B2, M15 (the mansion) | — | linear, 2 h | VAR:europe (garden walls) |

### 1.8 Large set pieces (static or scripted, building-scale)

| id | base | Description | Missions | Flags | Size (m) | Status |
|---|---|---|---|---|---|---|
| `battleship_replica` | battleship | Bismarck-class replica: teak deck, 4 twin turrets, superstructure, moored along the N quay | M13 (**objective**, torpedo to the forward hull) | **D** | 250×36×30 | NEW |
| `uboat_docked` | uboat | Docked U-boats | M7 (×2, **objective**, charges at the stern torpedo room) | **D** | 67×6×5 | military |
| `railway_gun_k5` | railway_gun | "Leopold" K5 railway gun on a curved spur | M6 (**objective**, charge at the foot of its ladder) | **D**, L | 32×4×6 | NEW |
| `railway_gun_karl` | railway_gun | "Karl"/"Thor" siege gun on rails | B4 (**objective**, 2 charges) | **D** | 30×4×5 | NEW |
| `armoured_train` | train_car | Armoured train wagons (`VAPE01-03`), locomotives, pushable wagons (`VAGO01`) | B4; M4 and M16/M18 (steam train) | D (B4) | 15×3×4 | NEW |
| `aircraft_parked` | plane | Ju 52, Ju 87 Stukas, B6 prototypes, escape jet | M10, B6 | D | 15-29 span | military (catalogue `plane`) |
| `aircraft_wreck` | ruins | Crashed aircraft wreckage | M4 [inf] | — | 15 | NEW (minor) |
| `cable_car` | cable_car | Lower station with bullwheel, summit station, cabin on cable, support towers | M5 | — | stations 12×8×8 | norway (VAR: cabin and towers) |

### 1.9 Walls, gates and small structures

| id | base | Description | Missions | Status |
|---|---|---|---|---|
| `wall_drystone_leanto` | wall | Low dry-stone wall with a plank lean-to roof; guards stand in its shadow; it ends in a sentry box | M1 | VAR:europe (garden walls) |
| `wall_stone_zigzag` | wall | Long zigzag stone wall that splits the alarm zones, with a timber gateway and dockyard gate | M7 | VAR:military |
| `wall_ruined_stone` | ruins | Ruined stone wall, including arched gateways | M3 (start), M4 (arch at the camp entrance), M11 (ridge) | VAR:europe |
| `ruins_mudbrick` | ruins | Mud-brick ruins used as cover | M8 (N plateau), M10, M11 | VAR:desert |
| `wall_field_stone` | wall | Stone field walls and terraces | B3, B6 | europe |
| `fence_picket_timber` | fence | Timber picket fence with openings | M2, M16/M18, B5, B8 | europe |
| `wall_timber` | wall | Wooden walls | B5 | VAR |
| `fence_concrete_post` | fence | Concrete-post and wire perimeter fence with gatehouse, guard huts and barrier | B5 | NEW |
| `double_wire_fence` | fence | Double barbed-wire fence, inner and outer | B7 | VAR:military |
| `gatehouse_double_wall` | gate | Gatehouses on the M4 HQ double walls; a grenade can collapse a gate | M4 | VAR:military |
| `wall_telephone` | telephone | Wall-mounted field telephone, used as a lure | M5 (×2) | NEW (minor) |
| `telegraph_pole` | telegraph_pole | Telegraph/telephone poles | M1, M16/M18, M17, M20, M10 | catalogue |
| `clothesline` | — | Rendered by the `uniform` pickup | M3, M5, M7, M16/M18, M20 | catalogue |
| `radio_mast_ring` | radio_mast | Lattice radio mast; in M9 it stands in a sandbag ring | M1, M9, M10 (NE, by the barracks), B1 | VAR (catalogue `radio_mast`) |
| `market_stall` | new | Market stall | B8 | NEW (minor) |
| `haystack` | new | Haystacks, hay and milk wagons | B8 | NEW (minor) |
| `buoy` | new | Red buoy | M7, M13, B1 | NEW (minor) |
| `airdrop_crate` | crates | Air-drop crate with a white parachute | M4, M7 | VAR (catalogue `crates`) |
| `roadblock` | new | SdKfz roadblock with hedgehogs and sandbags | M15 | uses `czech_hedgehog` + `sandbags` |
| `crater` | crater | Shell crater | M6, M10 | catalogue |
| `oil_crater` | crater | Black oil pit | M11 | VAR (catalogue `crater`) |

---

## 2. Per-mission checklist

Each mission lists the §1 ids it needs, with counts. **Bold** marks an objective. **[i]** means the entry was confirmed on a map image.

### BEL, Norway
- **M1 Baptism of Fire (Sola)** [i]:
  - **`relay_station`**.
  - `barracks_timber_long` ×2 (one L-shaped, one rectangular).
  - `house_timber_farm` (`ALBERGUE01-03` = 3 houses).
  - `wall_drystone_leanto` ending in a `sentry_box`.
  - `pier_timber` ×2.
  - `mg_nest_sandbag`, `road_barrier`, `telegraph_pole`s.
  - `bridge` ×3 (`PUEN` sprites; small stream bridges [WAD]).
- **M2 A Quiet Blow-Up (Stamsund)** [i]:
  - `house_log_cabin` ×2 and several more inside the camp.
  - `fence_picket_timber`.
  - `palisade_log` (diamond; raisable ladder; gate with `sentry_box` and `road_barrier`).
  - `watchtower_stilt` ×2.
  - `barracks_log_flag` ×2 (inside and outside the E corner).
  - `nissen_hut`.
  - **`fuel_tank_horizontal` ×2**.
- **M3 Reverse Engineering (Sysendam)** [i]:
  - **`dam_arch`** (5 gates).
  - `power_pylon`s.
  - `hydro_station` (admin, barracks, large shed).
  - `transformer_cage` ×12.
  - `electric_fence_switch`.
  - `bunker_concrete` (1 abutment bunker, **D**; about 4 garrison bunkers).
  - `palisade_log` camp with `house_log_cabin` ×4-5.
  - `well`, `tent_ridge_field`, `wall_ruined_stone`.
- **M4 Restore Pride (Stokkan)** [i]:
  - `rail_yard_derelict`.
  - Timber building or barn (`CASETA`) [inf].
  - `rail_trestle_timber` with the steam train.
  - `level_crossing` with its shack.
  - `wire_on_stakes`, `mg_nest_sandbag` ×3.
  - **`hq_villa_brick`** (`JEFATURA`) with `fountain_statue`, `gatehouse_double_wall` ×2, inner barracks ×2 and `jail_cell` (`CARCEL`).
  - `pier_timber`.
  - `henhouse` (**D**).
  - `tent_large_barrack`/tarps (`LONA1-4`).
  - `wall_ruined_stone` arch.
  - `airdrop_crate`, `aircraft_wreck` [inf].
- **M5 Blind Justice (Herdla)** [i]:
  - `house_log_cabin` village.
  - `cable_car` (2 stations, cabin, towers).
  - **`radar_station`** with its antenna.
  - `barracks_timber_long` ×2.
  - `guard_hut`.
  - `wall_telephone` ×2.
  - `bunker_concrete` (flagged, **D**).
  - A minefield.
- **M6 Menace of the Leopold (Masi)** [i, critic]:
  - `house_bombed_log` ×2 (interior; the first is the way in).
  - **`railway_gun_k5`**, plus a flatcar and an open wagon on the rail.
  - `palisade_log` compounds with `tower_round_log` ×4-5.
  - `hq_log_flatroof`.
  - `stone_chapel_tower`.
  - `fortified_block_tower`.
  - `tent_ridge_field` ×about 15.
  - `mg_nest_sandbag`, `czech_hedgehog` with wire, `crater`s, log stacks.
  - A burned ruin (S).
- **M7 Chase of the Wolves (Arendal)** [i]:
  - **`uboat_pen_open`** with **`uboat_docked` ×2**.
  - `crane_dock_portal`.
  - `wall_stone_zigzag` with gates.
  - `barracks_rendered_hip` ×2-3.
  - `quonset_hangar`.
  - `quay_granite` mole with `lighthouse_small`.
  - `house_norse_fishing` village, boat sheds (norway `boathouse`), ruins.
  - `marina_jetties`.
  - **`gun_pit_open` ×2** (210 mm coastal guns).
  - `buoy`, `airdrop_crate`.

### BEL, North Africa
- **M8 Pyrotechnics (Tell el Eisa)** [i, critic]:
  - `ruins_mudbrick` (N plateau start).
  - `gun_pit_open` (210 mm, **D**).
  - `czech_hedgehog` with wire.
  - **`water_reservoir_round`**.
  - **`fuel_tank_horizontal`** (2 blocks, with ladder and walkway).
  - `bridge_timber_trestle` over the wadi (the exit).
  - `house_domed_arcade`.
  - `house_adobe_redtile` ×6.
  - `barracks_desert` (flat-roof, guard on roof).
  - `tent_pyramid_desert` ×2.
  - `pillbox_round` with cupola, flagged (SW).
  - `fence_chainlink` perimeter.
- **M9 A Courtesy Call (Bab el Qattara)** [i]:
  - `wall_mudbrick` (octagonal; E gap, W `fence_chainlink` corridor with iron gates).
  - `tank_shed_open` (3 bays).
  - **`bunker_sandbag_thatch`**.
  - `gantry_hoist`.
  - **`warehouse_adobe` ×2**.
  - **`weapons_store`**.
  - **`hq_domed_terraced`**.
  - **`comms_hut_antenna`** (mast in a sandbag ring, and the hut).
  - `barracks_desert`.
  - `house_stone_pitched`, `house_whitewash_flat`.
- **M10 Operation Icarus (El Agheila)** [i, critic]:
  - `trench_ruins` start.
  - `airfield_strip` with a Ju 52 and 2 Ju 87s (optional **D**).
  - `dugout_airfield`.
  - `wire_on_stakes` belts with `czech_hedgehog`s.
  - `mg_nest_sandbag` ×3.
  - `wall_mudbrick` with arch gate.
  - `prisoner_cage`.
  - `domed_block`.
  - `windpump`.
  - `radio_mast_ring` (NE).
  - `tent_pyramid_desert` ×3.
  - `fence_chainlink` divider.
  - Concrete apron with `blast_wall_revetment`s.
  - `hangar_metal`.
  - `tank_shed_open` ×about 5.
  - `gantry_hoist` (tank under repair).
  - `barracks_corrugated_gable` (NE, flag).
  - **`weapons_store`** (bomb store, S).
  - Fuel-drum stacks, `crater`s.
- **M11 In the Soup (Maradah)** [i]:
  - **`drilling_rig` ×4**, with `oil_tanks_vertical` ×2 clusters.
  - **`tunnel_portal`**.
  - N HQ (`hq_domed_terraced` style).
  - Central garrison (`hq_domed_terraced`, roof guards).
  - SW camp: `tent_pyramid_desert`, `barracks_desert` (**D**), `water_tower_legs`.
  - `oil_crater`.
  - `wall_mudbrick`/`wall_ruined_stone` lines with 2 gates.
  - `windpump`.
  - `shed_timber_long`/pergola.
  - `house_whitewash_flat`.
  - `czech_hedgehog`, palms.
- **M12 Up on the Roof (Tunis)** [i]:
  - `medina_block` ×many.
  - `souk_arcade`.
  - `palace_tiled_domes`.
  - Plaza and courtyard.
  - `jail_cell` (the Informer).
  - `quay_granite` harbour basin and quay street.
  - `warehouse_large` (corrugated harbour shed).
  - `mosque_minaret`.
  - Second HQ (SE).
  - `fuel_tank_horizontal`.
  - `barracks_desert`.

### BEL, France and the Low Countries
- **M13 David and Goliath (Le Havre)** [i]:
  - **`battleship_replica`**.
  - `quay_granite` (bollards, stairs).
  - `lock_gate` ×2 with `control_shack`.
  - `crane_dock_portal` ×2.
  - **`fuel_tank_horizontal` ×3**.
  - `nissen_hut` ×3.
  - `garage_brick` (Panzer II).
  - `pontoon_minisub`.
  - `at_gun_emplacement` (pier gun).
  - `buoy`, crates.
- **M14 D-Day Kick Off (La Rivière)** [i] — art pass done (`manifest-atlantic-wall.json`; also `blockhouse_small`, `shed_concrete`,
  `house_coastal_normandy`, `sign_minen`, `sign_sperrgebiet`, `buoy_red`):
  - **`gun_pit_open`, `gun_turret_block`, `casemate_embrasure` ×2** (4 guns, all different).
  - `barracks_concrete_2st` ×2 (image) to ×4-5 (source B).
  - `at_wall_segment`s.
  - `dragons_teeth`.
  - `czech_hedgehog`, `beach_tetrahedron`, `wire_on_stakes`.
  - `mg_nest_sandbag` ×5.
  - A climbable rock ridge.
- **M15 The End of the Butcher (Compiègne)** [i]:
  - **`mansion_hq_mansard`** (parterre, `wall_brick_railing`).
  - `townhouse_corner_turret` (Sniper roof, balcony with ladder).
  - `townhouse_stucco` (cream).
  - `fountain_statue` roundabout.
  - `tram_set`.
  - `street_furniture_fr`.
  - `canal_basin_sunken` with `bridge_stone_arch` ×2.
  - `cemetery` (gate, chapel/kiosk).
  - Bombed ruins (NW, S).
  - `roadblock`.
  - `shop_front`s.
- **M16 Stop Wildfire / M18 The Force of Circumstance (Maas)** [i]:
  - `truss_bridge_maas` (**Db** in M18).
  - `pillbox_round` ×2 (**D** in M18).
  - `pier_timber` island landing with detonator.
  - `rail_track` with `level_crossing` and the train.
  - `station_building` (barracks, **D** in M18).
  - `goods_shed`.
  - `signal_box`.
  - `house_belgian_brick` and `farmhouse_normandy` (NE).
  - `townhouse_stucco` (grey, NW).
  - `tent_ridge_field` ×about 6.
  - M18 only: SE fields barracks.
  - `well`, `fence_picket_timber`, `telegraph_pole`s.
- **M17 Before Dawn (Riveauvillé)** [i, critic]:
  - `mobile_bridge_sliding` (ravine).
  - `bridge_timber_deck_long` (river).
  - `stockade_prison` (brick and railing walls, iron gate, back gate with control box, cells).
  - `watchtower_stilt` ×5.
  - `hut_pow_long` ×5-6.
  - **`fuel_tank_elevated`** (valve).
  - `watermill` (old mill).
  - `pillbox_round` (**D**).
  - `house_timber_hq_L`.
  - `crane_tower_jib`.
  - `telegraph_pole`s.
  - A climbable cliff.
- **M19 Frustrate Retaliation (Oldenburg)** [i]:
  - `coal_mine_complex`, `mining_office`, `water_tower_legs` (small).
  - `mine_railway` with `rail_bridge_mine_low`.
  - `conveyor_incline` with `coal_hopper`.
  - `palisade_plank` with gate.
  - **`v2_pad_gantry` ×3**.
  - `watchtower_stilt` (**D**).
  - `barracks_corrugated_gable` ×2-3.
  - `tank_shed_open` with smokestack.
  - `dog_kennel`.
  - `bunker_concrete`.
  - `crane_tower_jib`.
  - `outhouse`.
- **M20 Operation Valhalla (Gundelfingen)** [i]:
  - `castle_fortress` (ramparts, terraces, gate tunnels, bartizans, moat).
  - **`chateau_hq`**.
  - **`v2_meillerwagen` ×2**.
  - `flak_rampart`.
  - `at_gun_emplacement`.
  - `hut_timber_barrack` ×about 12.
  - `house_half_timber_turret`.
  - `firing_range` with pool.
  - `water_gate_underwater` with lever.
  - Gatehouses ×2 with `moat_bridge` ×2.
  - `outhouse`, `telegraph_pole`s.

### BCD
- **B1 Dying Light (Guernsey)** [i]. [MIS: 4 `CASA`, 3 `CUARTEL`, 4 `ESCALA`, 3 MG nests]
  - **`lighthouse_round`**.
  - **`radar_station`** (`CASA04`).
  - **`gun_pit_open` ×5 (AA)**.
  - Stone fort buildings ×about 5: `guardhouse_brick`, barracks (stone, slate hip roof, **D**) and HQ.
  - `lift_tower_cliff`.
  - `jetty_stone`.
  - `sea_mine_chain` ×22.
  - `buoy`, stone stairs.
- **B2 The Asphalt Jungle (Belgrade Zoo)** [i]. [MIS: 9 `CASA`, 3 `CUARTEL`, 3 `ESCALA`]
  - `zoo_animal_pit`.
  - `zoo_garden_court`.
  - `zoo_cage_house` ×about 9.
  - `zoo_glasshouse`.
  - `zoo_kiosk_octagon`.
  - `zoo_gate` (plus the ostrich gate).
  - `zoo_paddocks` (ostrich shed, elephant house, stable, keeper's house, cart shed, ticket booth).
  - `villa_alpine` (barracks).
  - `restaurant_pavilion`.
  - `villa_neogothic` (HQ).
  - `wall_brick_railing`.
  - `CASA_BONITA_1/2` = 2 "pretty houses" [MIS], mapped to the villas [inf].
- **B3 Dropped Out of the Sky (Crete)** [i]. [MIS: 13 `CASA`, 2 `CUARTEL`, 3 `ESCALA`]
  - Gorge `bridge_timber_trestle`.
  - `house_greek_whitewash` ×about 12.
  - `church_greek_white` (the start).
  - `temple_doric_ruin`, `stoa_ruin`, `tholos_base`.
  - `mausoleum` (barracks).
  - Lower and upper camps: `tent_ridge_field`, `tent_large_barrack` (over the HS 293), a platform with a ladder.
  - `wall_field_stone` terraces, olive groves.
- **B4 Thor's Hammer (Bonn station)** [i]. [MIS: 18 `CASA`, 5 `CUARTEL`, 5 `ESCALA`, 2 MG nests]
  - `station_hall_grand`.
  - `tent_ridge_field` ×about 12 in the forecourt.
  - `roundhouse_turntable` ×2.
  - `depot_sawtooth`.
  - `warehouse_large`.
  - `goods_shed`, `signal_box`, lamp huts.
  - `signal_gantry`s.
  - `gantry_crane_overhead`, `crane_dock_portal` (yard).
  - **`railway_gun_karl`**.
  - **`armoured_train` wagons ×2**, locomotives ×2, pushable wagons ×2.
  - `shop_front` ×12 (`TIENDA`).
  - Car park.
  - `rail_yard_derelict` (buffer stops, sleepers).
- **B5 Guess Who's Coming Tonight (Wolf's Lair)** [i]. [MIS: 19 `CASA`, 4 `CUARTEL`, 9 `ESCALA`, 4 MG nests, 2 `CARCEL`]
  - `palace_u_shaped` (uniform on the roof).
  - `villa_round_bay` (jail/offices).
  - `officers_residence`.
  - `blockhouse_wolfsschanze` ×several.
  - `bunker_cupola`.
  - `aa_ring_sandbag`.
  - `fence_concrete_post` with `road_barrier`s and gatehouses (SE, W).
  - `watchtower_stilt` (perimeter towers L/R).
  - `sentry_box` ×12.
  - `house_half_timber` village with sheds.
  - `henhouse`.
  - `hut_timber_barrack`, `wall_timber`.
- **B6 Eagle's Nest (Neubrandenburg)** [i]. [MIS: 15 `CASA`, 3 `CUARTEL`]
  - `airfield_strip`.
  - `control_tower_airfield`.
  - `hangar_metal` ×2.
  - `pilot_house` and workshop.
  - `aa_ring_sandbag`s.
  - **`fuel_tank_pushable` ×4**.
  - **5 prototype aircraft**.
  - Barracks (**D**).
  - `farmhouse_baltic` with `well` (ladder), pond and walled farm (barn, shed).
  - `house_half_timber` village.
  - `wall_field_stone`.
  - `henhouse`.
- **B7 The Great Escape (Stalag, Nuremberg)** [i]. [MIS: 15 `CASA`, 3 `CUARTEL`, 1 `CARCEL`]
  - `stockade_prison`/`double_wire_fence` with named gates ×6.
  - `watchtower_stilt` at the corners.
  - `hut_pow_long` ×about 10.
  - `guardhouse_brick`.
  - `water_tower_legs` (timber).
  - **`officers_residence`** (`CASA_SALE_REVISTA`).
  - Guard barracks.
  - `jail_cell` (punishment cells).
  - `ammo_house`.
  - `well`.
  - `bridge_timber_trestle` (road bridge, bridge house) and `footbridge_plank`.
  - `shed_timber_long` (bridge shed).
  - `underwater_pipe`.
  - Variant map `MAPA0009`: `searchlight_tower`.
- **B8 Dangerous Friendships (Nijmegen)** [i]. [MIS: 31 `CASA`, 2 `CUARTEL`, 4 `ESCALA`]
  - `canal_house_dutch` ×about 30.
  - `club_corner_turret`.
  - `quay_brick_canal`.
  - `bascule_bridge_dutch` with switch.
  - `footbridge_plank` ×2-3.
  - `windmill_post` ×2.
  - **`watermill`** (**D**).
  - Boathouses (norway `boathouse`, in a Dutch brick/timber finish).
  - `wharf_timber`.
  - `farmhouse_brick_dutch`.
  - `fountain_statue` plaza.
  - `market_stall`, `haystack`, `fence_picket_timber`.

---

## 3. Diff against the art team's current groups

### 3.1 Types NOT yet covered (`NEW`), in build batches

- The batches run in campaign order, BEL first.
- Each batch is about 6 models that share materials or a theater.
- Batches 1-11 unblock all 20 BEL missions. Batches 12-16 are BCD only, which is built later (design-spec §7.2).

| # | Batch | Types | Missions unblocked |
|---|---|---|---|
| 1 | Norway signals and power | `relay_station`, `comms_hut_antenna`, `power_pylon`, `transformer_cage`, `electric_fence_switch`, `palisade_log`, `tower_round_log` | M1, M2, M3, M5, M6, M9 |
| 2 | Field camp and M6 set | `tent_ridge_field`, `tent_large_barrack`, `nissen_hut`, `stone_chapel_tower`, `fortified_block_tower`, `level_crossing` + `road_barrier` | M2, M3, M4, M6, M13, M16/18, B3, B4, B5 |
| 3 | Tanks and water | `fuel_tank_horizontal`, `fuel_tank_elevated`, `oil_tanks_vertical`, `water_reservoir_round`, `water_tower_legs`, `windpump` | M2, M8, M10, M11, M12, M13, M17, M19, B7 |
| 4 | Desert military works | `hq_domed_terraced`, `tank_shed_open`, `gantry_hoist`, `dugout_airfield`, `fence_chainlink`, `tunnel_portal`, `blast_wall_revetment` | M3, M8, M9, M10, M11, M19 |
| 5 | Tunis and harbour stone | `souk_arcade`, `palace_tiled_domes`, `jail_cell`, `warehouse_large`, `quay_granite` (with beacon masts) | M4, M7, M12, M13, M17, B4, B5, B7 |
| 6 | Le Havre docks | `battleship_replica`, `crane_dock_portal`, `garage_brick`, `at_gun_emplacement`, `buoy` | M7, M13, M20, B1, B4 |
| 7 | Atlantic Wall | `gun_pit_open`, `gun_turret_block`, `barracks_concrete_2st`, `at_wall_segment`, `dragons_teeth`, `czech_hedgehog`, `beach_tetrahedron` | M6, M7, M8, M10, M11, M14, M15, B1 |
| 8 | Compiègne town | `mansion_hq_mansard`, `townhouse_corner_turret`, `townhouse_stucco`, `fountain_statue`, `tram_set` + `street_furniture_fr`, `canal_basin_sunken` | M4, M15, M16/18, B2, B8 |
| 9 | Rail and pillboxes | `railway_gun_k5`, `pillbox_round` (+ `bunker_cupola`), `goods_shed`, `signal_box`, `mine_railway`, `crane_tower_jib` | M6, M8, M16/18, M17, M19, B4, B5 |
| 10 | Oldenburg coal mine and V2 base | `coal_mine_complex`, `mining_office`, `conveyor_incline`, `coal_hopper`, `palisade_plank`, `dog_kennel` | M19 |
| 11 | Castle interior and small huts | `chateau_hq`, `hut_timber_barrack`, `v2_meillerwagen`, `outhouse`, `henhouse`, `shed_timber_long`, `wall_telephone` | M4, M5, M11, M19, M20, B2, B5, B6, B7 |
| 12 | Guernsey and Crete | `lift_tower_cliff`, `sea_mine_chain`, `house_greek_whitewash`, `church_greek_white`, `temple_doric_ruin` + `stoa_ruin` + `tholos_base`, `mausoleum` | B1, B3 |
| 13 | Belgrade Zoo | `zoo_animal_pit`, `zoo_garden_court`, `zoo_cage_house`, `zoo_glasshouse` + `zoo_kiosk_octagon`, `zoo_gate` + `zoo_paddocks`, `villa_alpine`, `restaurant_pavilion`, `villa_neogothic` | B2 |
| 14 | Bonn railway works | `station_hall_grand`, `roundhouse_turntable`, `depot_sawtooth`, `signal_gantry`, `gantry_crane_overhead`, `railway_gun_karl`, `armoured_train` | B4 |
| 15 | Wolf's Lair, airfield and Stalag | `palace_u_shaped`, `villa_round_bay`, `blockhouse_wolfsschanze`, `fence_concrete_post`, `control_tower_airfield`, `fuel_tank_pushable`, `officers_residence`, `ammo_house` | B5, B6, B7 |
| 16 | Dutch canal town | `canal_house_dutch`, `club_corner_turret`, `quay_brick_canal`, `windmill_post`, `market_stall`, `haystack` | B8 |
| — | Minor, any time | `aircraft_wreck`, `underwater_pipe`, `roadblock` (a kit assembly) | M4, M15, B7 |

### 3.2 Covered types that need mission-specific variants (`VAR`)

- **norway:**
  - `house_norse_fishing`: red-painted and tarred village houses (M7).
  - `house_timber_hq_L`: L-shaped 2-storey timber HQ (M17).
  - `hq_log_flatroof`: roof guard and ladder (M6).
  - `barracks_rendered_hip`: white render (M7).
  - `hydro_station` (M3).
  - `sentry_box`: 1-man guérite (M1, M2, B5 ×12). It is a variant of the guard hut.
  - `radar_station`: needs the Würzburg dish (M5, B1).
  - `cable_car`: needs the cabin and support towers (M5).
  - Boathouse: a Dutch finish (B8).
- **desert:**
  - `house_adobe_redtile` (M8).
  - `house_stone_pitched` (M9).
  - `house_domed_arcade` (M8).
  - `domed_block` (M10).
  - `medina_block`: roof ladders, balconies, qubba domes and pergolas (M12).
  - `warehouse_adobe` and `weapons_store` (M9, M10).
  - `ruins_mudbrick` and `trench_ruins` (M8, M10, M11).
- **europe:**
  - `house_bombed_log`: a **multi-level interior** (M6 ×2).
  - `house_half_timber_turret` (M20).
  - `farmhouse_brick_dutch` (B8).
  - `farmhouse_baltic` (B6).
  - `pilot_house` (B6).
  - `well` with a ladder (B6).
  - `wall_drystone_leanto` (M1).
  - `wall_ruined_stone` with an arched gateway (M3, M4, M11).
  - `wall_brick_railing` (M15, B2).
  - `cemetery`: chest tombs and a chapel/kiosk (M15).
- **military:**
  - `barracks_corrugated_gable` (M10, M19).
  - `quonset_hangar` (M7).
  - `hut_pow_long`: the raised-floor B7 hut and the dark-timber M17 hut.
  - `stockade_prison`: the M17 brick-and-railing walls, and the B7 double wire with named gates.
  - `prisoner_cage` (M10).
  - `guardhouse_brick` (B1, B7).
  - `bunker_sandbag_thatch` (M9).
  - `aa_ring_sandbag` (B5, B6).
  - `flak_rampart` (M20).
  - `searchlight_tower` (`MAPA0009`).
  - `wire_on_stakes` (many missions).
  - `uboat_pen_open`: **open finger piers, not a covered pen** (M7).
  - `lighthouse_round`: tall, **D**, with internal stairs (B1).
  - `castle_fortress`: terrace stair flights, arched gate tunnels, bartizans (M20).
  - `water_gate_underwater` with a lever and red light (M20).
  - `gatehouse_double_wall` (M4).
  - `wall_stone_zigzag` (M7).
  - `double_wire_fence` (B7).
- **bridges:**
  - `dam_arch`: **5 numbered spillway gates** (M3).
  - `bridge_timber_deck_long` (M17).
  - `rail_bridge_mine_low` (M19).
  - `bascule_bridge_dutch` (B8).
  - `pontoon_minisub` (M13).
  - `marina_jetties` (M7).
  - `jetty_stone` (B1).
- **Catalogue props** needing variants: `radio_mast_ring`, `rail_yard_derelict` (`train_car`), `airdrop_crate`, `oil_crater`, `airfield_strip`.
- **Every D-flagged type needs a ruined/rubble state.** This covers every barracks, fuel tank, bunker and objective above.

---

## 4. Critic log and open points

**How the critic worked:**
- It re-checked **M6, M10 and M17** (a random pick among the missions Method A never viewed) against their full maps, cropped to 800-900 px.
- It also checked **M8**, where A and B disagreed.
- It used 7 images and found the gaps below. Every one is now in §1 and §2.

**Findings:**
- **M6:**
  - There are **two** bombed log houses, not one.
  - The "round wooden watchtowers" are **cylindrical log towers** set into the palisade (`tower_round_log`).
  - It adds `stone_chapel_tower` and `fortified_block_tower` (the NE block has a round stone tower and a lean-to canopy).
  - There are about 15 ridge tents and free-standing palisade segments.
  - A flatcar and an open wagon sit beside the Leopold.
  - The HQ is a log house with a flat roof section.
- **M10:**
  - The lattice tower in the walled compound is a **windpump**; the radio mast stands separately by the NE barracks.
  - It adds `blast_wall_revetment`s on the apron, `fence_chainlink` dividing compound from apron, and `dugout_airfield` (the airfield bunker is a long log/sandbag dugout, not concrete).
  - There are about 5 tank sheds, and a `gantry_hoist` over the tank under repair.
  - The compound has 3 pyramid tents.
- **M17:**
  - There is a **second bridge**: a long timber-deck road bridge over the main river (`bridge_timber_deck_long`), besides the sliding ravine bridge.
  - The prison walls are **low brick walls with an iron-railing top**, not timber.
  - It adds a lattice tower/jib crane outside the NW wall, and `house_timber_hq_L`.
  - The "fuel tank with ladder and valve" is a **twin tank on a raised frame**.
- **M8 (conflict resolved):**
  - The wadi bridge is **timber** (B was right; A said stone or concrete).
  - The water objective is a **squat riveted reservoir on a low base**, not a tall tower (A was right).
  - The fuel "tank farm" is 2 blocks of twin horizontal tanks under a walkway frame.
  - The SW bunker is round with a cupola, so `pillbox_round` is reused.

**Open points:**
- **M18 was not viewed by A**; B viewed it. M16 and M18 share one map, so M16 is treated as covered.
- The M18-only "SE fields barracks" and extra charge markers need a check on the map image.
- **M14 barracks count**: the image shows 2; B says 4-5. Build 1 model with 2 dressing variants.
- **B4**: the objects `TIEN14-23` (read as tents) and `TIENDA01-12` (read as shops) may overlap. Build both until a mission-file dump settles it.
- **BEL building tokens**: `CASA00-17`, the `A`/`B`/`C` variants and `CASA43-51` are interior-layout tokens. Retail files were read only for M1 and M4, so the other BEL missions cannot be mapped token by token. Treat the counts in §2 as the minimum.
- **`church_european`**: no BEL mission has a confirmed European church. The M6 `stone_chapel_tower` is the nearest match.
- **The M4 barn** is inferred from `CASETA`, "shed". The **M4 aircraft wreck** is also inferred.
