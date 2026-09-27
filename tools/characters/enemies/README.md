# SHADOW SIX: German enemy set

This set covers the German enemy roster: bible §5 and design-spec §4.1. It is built on `../pipeline/` (MPFB body, the UAL skeleton and the shared `anims.glb`/`weapons.glb`), and none of the pipeline's files are modified. Paths below are relative to `scratchpad/chars/enemies/`.

## Commands
| Step | Command |
|---|---|
| Specs (99) | `python3 tools/enemy_types.py --out specs` (`--types rifleman,...`, `--n`) |
| Build (4 parallel, ~14 s each) | `tools/build.sh out specs/*.json` |
| Sidecars and index | `python3 tools/sidecar.py out` writes `out/<id>.json` and `out/enemies_index.json` |
| Enemy clips | `node ../pipeline/web/serve.mjs 8797 &`, then `PORT=8797 node ../pipeline/tools/run_page.mjs ../enemies/web/build_enemy_anims.js x` |
| Review renders | `tools/review_all.sh [types]` writes `review/<type>/` |
| Variety test | `node tools/variety_test.mjs`: 60 scenarios of 30 soldiers, with neighbour duplicates and distinct signatures reported |

## Roster (`specs/`, `out/`)
| soldierType | Variants | Look (silhouette kept per type) | Weapon |
|---|---|---|---|
| rifleman | 32 | M40 field grey, M35 helmet, Y-straps, pouches, bread bag, canteen, gas-mask can, bayonet | kar98k |
| trooper | 8 | as the rifleman, with MP40 magazine pouches | mp40 |
| sentry | 8 | M40 greatcoat to mid-calf, dark-green collar, double-breasted, coat belt; a third are older reservists | kar98k (idle `smoke`) |
| sergeant | 6 | M36 with Tresse braid, peaked cap, Luger holster on the left front, map case, binoculars | luger |
| officer | 6 | Open-collar tunic with shirt and tie, peaked cap with silver cords, breeches, riding boots, brown belt | walther_p38 |
| mg | 6 | Helmet, pistol holster, MG tool pouch, spare-barrel case on the back | mg34 |
| engineer | 6 | Rolled sleeves, work gloves, black branch straps, satchel charge on a cross-strap, shovel | none (`detonate`) |
| crew | 6 | Black Panzer jacket and trousers, black side cap; half of them wear headphones | walther_p38 |
| afrika | 12 | DAK tropical drill. Headgear 60 % sand M35, 30 % long-peaked cap, 10 % pith helmet. 30 % goggles, 20 % shorts, 40 % rolled sleeves | kar98k |
| winter | 8 | White snow smock over field grey, white-washed helmet; 25 % Bergmütze | kar98k |
| general | 1 | Schleper (M15): generic heavy-set man of about 52, grey leather greatcoat, silver boards, plain silver tabs, peaked cap with cords, riding boots | none (`walk_hands_back`; `walkSpeedScale` 0.8) |

Aliases in `enemykit.js`: soldier → rifleman, truckDriver → crew, courier → trooper, gunner → mg.

## Variety (bible §5.2)
- **Head archetypes:** each type draws its 16 archetypes from its own seeded permutation, with no repeats inside its first 16 variants.
- **Face modifiers:**
  - Archetype modifiers are applied at ×1.7 (×1.3 in the second cycle).
  - The 6 bible jitter modifiers vary by ±0.25.
  - A **proportion layer** adds 18 gaussian modifiers with σ ≈ 0.4: face width, length and depth, nose, mouth, eyes, chin, ears, brows, cheekbones, forehead and neck.
  - A **resting expression** uses 1–2 MPFB expression units (frown, squint, pressed lips, and so on).
- **Skin and hair:**
  - Skin: 6 tone presets with ±4 % jitter; the skin texture band follows age (young <27, middle-aged <45, old).
  - Complexion decals: freckles, moles, a scar in 12 % of variants, nasolabial folds and crow's feet by age, broken veins (Schleper).
  - Iris colour: 6 presets. Hair colour follows the bible odds and greys with age. Brows: 12 assets.
- **Facial hair:**
  - Per type, following the bible odds.
  - Moustache: a trimmed chevron at least 3.2 cm half-width, spanning the full mouth. A toothbrush shape is impossible by construction (an `assert` in `enemy_face.py`).
  - A beard is heavy painted stubble.
  - Glasses follow the bible odds.
- **Uniform:** cloth tint ±6 % (value plus warm/cool shift), wear/dirt 0.08–0.42, helmet paint wear (scuffs to bare steel, dust), and kit extras (for example, no canteen).
- **Runtime:**
  - `web/enemy_variety.js` `assignEnemyVariants(missionId, spawns, variantsByType)`. The hard rule works on the variant: no two soldiers within 30 m or in the same squad share one, across all types. The soft rule gives members of the same squad different archetypes.
  - `enemykit.spawnEnemy` adds per-instance height 0.97–1.03, width 0.97–1.04 and a cloth-only tint (a shader patch on the `_mask` cloth channel).

## Files
- **`blender/build_enemy.py`:** `build_char.py` plus these hooks:
  - `enemy_mat`: tint, wear, helmet wear, complexion and iris.
  - `enemy_outfits`: greatcoat, general_coat, officer_heer with a narrow V, panzer without the skin gap.
  - `enemy_kit`: the kit items.
  - `enemy_headgear`: cords and goggles, re-verified with the eye-ray check; they are dropped if they would block the eyes.
  - `enemy_face`: moustache.
- **`web/build_enemy_anims.js`:** writes `out/enemy_anims.glb` with smoke, walk_hands_back, idle_hands_back, binoculars, point and detonate. These are keyed on UAL frames (CC0) and are 0.28 MB after key reduction.
- **`out/<id>.glb` / `<id>.json` / `<id>.report.json`:**
  - `.glb`: LOD0/1/2, a hideable `headgear` mesh, one atlas material and one alpha material for the brows.
  - `.json`: the sidecar (sockets, headgear fit, supported clips, variety key).
- **Licences:**
  - MakeHuman/MPFB system assets: CC0. Quaternius UAL: CC0. ambientCG: CC0.
  - Everything else is project code (CC0).
  - No swastikas, eagles, SS runes or death's heads. Collar tabs, braid and boards are plain.

## Results (final build)
- **Characters:** 99 GLBs.
- **Top detail level (LOD0):** 11,398–11,650 triangles, including headgear and brows. The target is at most 12k.
- **Lower levels of detail:** LOD1 has 5,000 triangles and LOD2 has 2,000.
- **Materials and size:** 2 materials each (atlas and alpha brows). File sizes are 0.99–1.30 MB, 118 MB for all 99.
- **Headgear:** fits on all 99, verified by eye rays (`eyes_clear`), with the front edge 9–36 mm above the brow.
  - Soft caps: crown coverage is re-verified after smoothing, and 0 scalp points are exposed.
  - Cords and goggles are re-checked with the eye rays.
- **Variety:** `node tools/variety_test.mjs` runs 60 scenarios (20 missions × clustered riflemen / clustered mixed / spread squads) of 30 soldiers each. It finds 0 neighbour duplicates, and all 30 soldiers are distinct in every scenario.
- **Build time:** 13–15 s per character on a machine with nothing else running (20–35 s while other workflows share it).

## Rework after the fit/animation review (review 1)
Verification: `rework/run.mjs` harness (port 8871) with `rework/fitjob_e.js` (the chars/fit metrics through enemykit), `rework/anim_e.js`, `rework/shots_e.js`; results `rework/full3.json`, `rework/anim2.json`; sheets `rework/sheets/`; docs `chars-enemies-{roster,faces,fixes}.jpg`.
- **Runtime (`web/enemy_runtime.js`, `web/enemy_weapons.js`, wired in `enemykit.js`):** anim-lib meta fix (userData.shadowSix on the child 'Scene': timeScale, loop flags, pelvis retarget); long guns re-solved every frame after the mixer: butt in the right shoulder pocket, bore 5.5 cm under the right eye along the facing, left hand IK'd to the fore-grip (IK error 0, butt 12-13 cm from the shoulder joint, yaw/pitch 0 on all 74 long-gun variants); MG34 support hand under the jacket; MP40 fired from the chest (folded stock) with the left hand on the magazine housing; ground clamp for die/dead (nothing under the ground); run/sprint stride warp (slip 3.7 -> 0.2-0.35 m/s); `h.bodyPosition()` = corpse footprint at the pelvis; static bounding sphere + frustum culling, one shared Skeleton per unit; LOD thresholds 120 / 50 px/m; props: detonator box, binoculars, cigarette.
- **Clips (`web/build_enemy_anims.js`):** rifle_aim / rifle_fire / rifle_reload base poses; die/dead override of Death01 with the arms kept off the helmet (head key at 0.15 s, controlled mid-fall key at 1.12 s, lying pose at 1.45 s): 0 helmet/arm intersections over 16 die frames; walk_hands_back re-keyed at 33 keys (slip 0.45 -> 0.10 m/s at Schleper's 0.72 m/s).
- **Build (`blender/enemy_kit.py`, `enemy_headgear.py`, `build_enemy.py`):** kit islands snapped onto their support and box-like kit (pouches, satchel, shovel, gas-mask can, cases, holster, binoculars) given the hanger's skin weights so it rides as one piece (no 10-15 mm float at idle or die); collar tabs rebuilt on the collar (the pipeline projection left 0.5 m silver blades where rays missed; none on snow smocks; officers on the lapel collar); officer shirt trimmed to the open collar + lapel edge laid on it (no shirt through the tunic); hem boundary loops smoothed; goggles strap one continuous ribbon on the relaxed crown; headphone cups on the ears (evaluated ear surface), band a taut hull on the cap; officer-cap crown lifted and hair clamped under all headgear (no hair through the crown); side-cap ridge compressed.
- **Result (full3, 99 characters, idle/run/die/dead x8 frames + neutral):** eyes clear everywhere; 0 headgear pokes or sinks except engineer_v04 run@0.82 (3 helmet verts vs the back); floating kit only the officers' belt buckle (three.js metric 11 mm; the Blender GLB shows it touching the belt, 0-0.8 mm, unresolved).

## Rework round 2 (fit/anim/perf review r2)
Verification harness `rework2/` (port 8871): `run.mjs` + `fitjob2.js` / `capjob.js` / `shots2.js` (copies of chars/fit r2 jobs through `/chars/fit/rt.js`, i.e. through enemykit), `float_e.js` (held poses 12 s), `snap_e.js` (transition jumps), `anim_e.js` (gait slip), `perf_e.js` / `perf_dc.js` (CPU, draw calls), `bl/*.py` (Blender GLB probes). Results `rework2/full2.json`, `capall.json`, sheets `rework2/sheets/fixes_r2.jpg`; docs `chars-enemies-{roster,faces,fixes}.jpg` via `python3 tools/final_sheets.py rework2/final rework2/sheets/fixes_r2.jpg`.
- **Held poses no longer float:** `groundClamp` restores the clean mixer pelvis value before adding the lift (PropertyMixer skips unchanged writes, so the lift accumulated: 91 m after 10 s). Object-space offset, no matrixWorld update. die/dead/shoot/reload/salute/hit/detonate stay within 1 cm over 12 s (enemykit and squadkit).
- **Rifle hold:** `enemy_weapons.js` sets neck/head on the stock (`HEAD` = 8 deg down, 4 deg cant; the clip bowed the head ~40 deg) and swivels the right elbow down/out (`ELBOW`); the forearm runs under the jaw. 0 helmet/cap intersections on all 74 long-gun variants (was 59/60 Kar98k). MG34 support palm on the jacket (4.8 cm -> 0.4 cm).
- **Hold cross-fades:** gun pose and hand IK blend with the incoming action weight; aim/unaim fades 0.35 s (gun moved 0.5-0.75 m in one frame, now <= 5 cm/frame). Schleper unclasps his hands through the plain idle before run/aim (0.5-0.7 m flip -> 0.08 m).
- **Gaits:** `enemy_anims.glb` now carries `walk_fast`, `run_slow`, `run_fast` (commandos_b re-synthesis, CC0 from UAL); `setAnim(name, {speed})` picks them (`GAIT`): alert walk 1.8 m/s 137 steps/min, slip <= 0.16 m/s (was a 175 spm shuffle); run 3.8 m/s symmetric feet. Running nods the head 7 deg (M35 rear skirt vs collar).
- **Sling:** slung long guns are pressed onto the back each frame from 24 hand-skinned probe points (6-8 cm off at mid-run -> <= 2 cm).
- **Perf:** skeleton-only matrix updates (`updBones`), matrix reads instead of `getWorld*`, no prop work when no prop is out: 30 enemies 1.3 -> 0.7 ms/frame (enemykit), 1.9 -> 1.2 ms via squadkit. Headgear merged into the LOD1/LOD2 body geometry per template (hiding it swaps the plain geometry back): 30 soldiers at LOD1/LOD2 = 102 draw calls incl. shadows.
- **Build:** `fix_buckles` (pipeline `kit.belt` made the buckle a 6 mm horizontal shelf through the belt; now a flat plate on it); `enemy_headgear`: peaked caps get a rebuilt closed peak (the pipeline peak was folded into a zigzag; droop picked by the eye-ray check), a band facing, the cockade seated on it and the chin cords along the peak root; the officer-crown lift no longer catches the peak; M35 liner lip sunk up to 10 mm, side vents re-seated on the shell; helmet scuffs soft grey instead of hard black.

## Known weaknesses
- **Shared skin texture:** every variant uses the MakeHuman skin texture of its age band. Identity comes from shape, expression, tone, iris and the complexion decals, and the faces still share a family resemblance under the helmet.
- **Coat and smock skirts:** they are rigid tubes weighted to the pelvis and thighs, with no cloth simulation. The knees can still clip the hem at full run.
- **Crew:** the Panzer wrap jacket has no lapels or piping, and reads as a plain black suit. The death's-head collar badges are omitted by rule. drive/sit are generic seat loops, not fitted to a hatch.
- **Officer tunic:** the open-collar lapel edge is still irregular at close zoom, and small light squares show at the breast pockets (cause not found).
- **Tropical cap and worn helmets:** the DAK tropical cap crown looks mottled. Sand helmets at wear 0.6 look blotchy at close zoom.
- **Missing:** no MG34 bipod / prone firing pose and no belt; no prone death (enemies do not crawl). Among the bible §5.2 extras, the bandage, scarf and snow on the shoulders are not built.
- **Rank insignia:** plain throughout. The officers' silver cords and the sergeants' braid are only readable at close zoom.
