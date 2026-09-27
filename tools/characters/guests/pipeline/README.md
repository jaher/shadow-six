# SHADOW SIX character pipeline

Character spec JSON → Blender 4.2 + MPFB 2.0.8 (CC0 MakeHuman assets) → GLB skinned to the Quaternius UAL skeleton, with one atlas, LOD0/1/2 and a hideable headgear mesh. A shared `anims.glb` holds every clip for that skeleton, and `weapons.glb` holds the props and their sockets.

Proven end to end on the Green Beret (`specs/greenberet.json`) and a German rifleman (`specs/german_rifleman.json`), plus 10 seeded enemy variants (`specs/gen/`).

Paths below are relative to `scratchpad/chars/pipeline/`. `$S` is the scratchpad.

## Commands
| Step | Command | Output |
|---|---|---|
| Build one character (about 10–15 s) | `tools/bl.sh blender/build_char.py specs/<id>.json ../out` | `../out/<id>.glb` (final), `<id>.report.json`, `<id>_{albedo,normal}.jpg`, `<id>_orm.jpg`, `<id>_alpha.png`, `<id>.blend`, `<id>.raw.glb` |
| Build many (4 in parallel) | `tools/build_many.sh ../out/gen specs/gen/*.json` | one GLB and log per spec |
| Enemy variant specs | `python3 tools/enemy_spec.py --type rifleman --variants 16 --out specs/gen` | Types: rifleman, trooper, sergeant, officer, mg, afrika, winter, crew |
| Weapons and props | `tools/bl.sh blender/build_weapons.py ../out` | `../out/weapons.glb` (15 props, 1 material, 300 KB) |
| Animation library | `node web/serve.mjs 8793 &` then `node tools/run_page.mjs web/jobs/build_anims.js /tmp/x` | `../out/anims.glb` (61 clips, 2.85 MB) and `anims.json` |
| Review renders | `JOB_ARGS='{"chars":[{"url":"/chars/out/<id>.glb","name":"x","weapon":"kar98k"}],"weapons":"/chars/out/weapons.glb","views":["heads","turn","game1x","game2x","strip"],"clips":["walk"]}' node tools/run_page.mjs web/jobs/review.js ../review/final/v 1600 900` | PNGs: head close-ups (front/side/¾), 8-view turnaround, orthographic game camera (pitch 40°, 40 and 80 px/m), animation frame strips |
| Headgear gallery and fit test | `tools/bl.sh blender/test_headgear.py specs/<id>.json <outprefix> m35,beret,...` | `<outprefix>_<type>_{f,s}.png` and `_fit.json` |
| Offline rebind only | `python3 tools/rebind.py raw.glb out.glb [--extras x.json] [--no-quantize]` | GLB on the UAL skeleton, KHR_mesh_quantization |

- `tools/bl.sh` sets `BLENDER_USER_RESOURCES=$S/realism/characters/bl_user`, where MPFB is enabled.
- The server is `web/serve.mjs`, port 8793. It serves `/vendor/` (three r186), `/ex/` (three examples) and `/` (the scratchpad). A `POST /save?path=` writes under `chars/`.

## Spec format (`specs/greenberet.json` is the reference)
```jsonc
{ "id": "greenberet",
  "body": { "age_years": 34, "muscle": 0.95, "weight": 0.72, "proportions": 0.8, "height_m": 2.0,   // bible §0.4: age = 0.5+(y-25)/130; height calibrated on the measured mesh
            "modifiers": { "head/head-square": 0.6, "nose/nose-hump-decr": 0.4, "cheek/cheek-bones-incr": 0.5, "eyebrows/eyebrows-trans-down-up": -0.3 } },
            // any MPFB target: file name, bare name (+ sign picks incr/decr, up/down, in/out…), or bipolar category; l-/r- sides auto-added
  "skin": { "base": "middleage_caucasian_male", "tint": [1.06,0.97,0.93], "ruddy": 0.35, "stubble": 0.25 },
  "brows": { "asset": "eyebrow010", "color": [0.09,0.06,0.045] },
  "hair": { "style": "crop|none", "color": [0.11,0.075,0.05], "length": 0.006 },
  "facial_hair": "none|moustache|beard", "glasses": false,
  "outfit": "heer_m40|heer_m36|dak|winter_smock|panzer|officer_heer|british_bd|british_smock|commando_sleeveless|commando_jumper|wetsuit|civilian_tweed",
  "outfit_opts": { "tunic": [r,g,b], "trousers": [...], "boots": [...], "camo_cols": [[...]], "shorts": true, "rolled": true },   // sRGB 0..1
  "kit": ["belt","belt_web","ystraps","braces","ammo_pouches","bread_bag","canteen","gasmask_can","bayonet","holster_r","decoy_radio","shovel_back","pick_belt","knife_sheath_chest","no_details"],
  "headgear": { "type": "m35|mk3|pith|beret|watch_cap|comforter|officer_cap|field_cap|dak_cap|camo_cap|flat_cap|side_cap",
                "color": [...], "camo": [[...]], "badge": true, "drape_deg": 22, "pulled": "right",
                "offset": { "up": 0, "fwd": 0, "pitch_deg": 0, "roll_deg": 0, "yaw_deg": 0, "scale": 1 } },   // per-character overrides
  "weapon": { "primary": "kar98k" },
  "budget": { "lod0": 12000, "lod1": 5000, "lod2": 2000 }, "atlas_size": 1024 }
```

## Blender modules (`blender/`)
| Module | Role | Key functions |
|---|---|---|
| `body.py` | MPFB human | `calibrated_body(spec)` (height-macro calibration), `resolve_target(name, v)`, `finalize_body(human, spec)`: rig `game_engine`, skin, low-poly eyes, brows, lashes, bakes shape keys, grounds the mesh, refits the rig |
| `measure.py` | Landmarks | `measure(human, rig, parts)`: crotch, belt, knee, brow line, eye top and centres, crown, ears, nape, skull slices, bone heads/tails |
| `shell.py` | Garment engine | `make_shell(ctx, name, face_pred, offset_fn, smooth, shape_fn, cuts=[(co, n[, sel])])`: body-surface shell with inherited skin weights, anatomy smoothing with push-out, plane-cut hems and rim fold. Also `slice_convexify`, `delete_covered` |
| `uniform.py` + `outfits.py` | Period garments | `top(hem, sleeves, collar, open_v)`, `legs(bottom, style)`, `boots(style=jack/riding/ankle/lace_high/shoe/flippers)`, `gaiters`, `fullsuit`; presets in `outfits.build_outfit` |
| `kit.py` | Insignia and kit | Pleated pockets, buttons, shoulder straps, collar tabs (no swastikas or eagles), belts, Y-straps and braces, and the belt-hung items (`Kit.hang(deg, drop, builder)`), `glasses` |
| `headfit.py` + `headgear.py` | Headgear fit | See the next section |
| `skin.py` | Face look | Masks (beard, flush), skin tint, stubble, ruddiness, crop `hair_cap` (smoothed hairline), `facial_hair` (moustache ≥ 3.4 cm half-width; a toothbrush shape is impossible by construction) |
| `bake.py` | Budget pass | `strip_helpers`, `join`, `atlas_uv` (face ×2.2 texel boost), `bake_atlas` (Cycles GPU: diffuse×AO, normal, roughness → albedo JPEG, normal JPEG, ORM), `make_lod`, `_mask` attribute (skin/cloth) |
| `build_weapons.py` | Weapon props | Part DSL (`W().box/.cyl/.sock`) for kar98k, mp40, mg34, mg42, luger, walther_p38, colt1911, no4_sniper, thompson, knife, harpoon_gun, syringe, time_bomb, remote_bomb, stick_grenade. Sockets: `grip_r`, `grip_l`, `butt`, `muzzle`, `sling_f`, `sling_b`, `tip`, `scope`, `bipod`. Weapon space: +Z muzzle, +Y up, origin = right grip |

## Headgear fit guarantee (`headfit.py`)
1. The skull is measured from the finished mesh: a polar table of the scalp, ears and hair radius per 10° and per cm; the brow top from the brow mesh; the eye top and centres; ear top and bottom; nape (ear bottom minus 8 mm).
2. Each headgear is built radially around those measurements.
   - The rim follows `rim_profile(front, side, back)`, with the front at brow + 10–16 mm.
   - Caps get a band that hugs the skull at req + 5 mm.
   - Visors start at the band front and have their tip clamped at or above eye-top + 8 mm.
3. Per-character `offset` overrides are applied, then everything is pushed out of the head and hair surface by 4–6 mm.
4. Verification: rays from the top of each eyeball (yaw −25…25°, elevation 0/5/10°) must not hit the headgear, and the lowest front edge must be at or above the brow line. On a failure the headgear is lifted 2 mm at a time, up to 3 cm. The result goes in `report.headgear_fit`.
5. Current results: all 10 types report `eyes_clear` on both test heads (`review/headgear_fit_report.json`). The front edge sits 10–30 mm above the brow.

## Runtime (web/, ES modules, three r186)
```js
import { loadCharacter, loadAnimLibrary, createHumanoid, lodFor, patchShading } from './charkit.js';
import { loadWeapons, equip, twoBoneIK, HOLD } from './weapons.js';
import { assignVariants, instanceJitter } from './variety.js';
const lib = await loadAnimLibrary('out/anims.glb');            // clips by game name; meta: loop, duration, groundSpeed (m/s)
const tpl = await loadCharacter('out/greenberet.glb');         // meshes LOD0, LOD0_alpha, LOD1, LOD2, headgear; scene.userData.shadowSix
const h = createHumanoid(tpl, lib);                            // h.object, h.bones, h.parts, h.mixer
h.setAnim('walk', { speed: 1.4 });                             // foot-slide fix: timeScale = speed / (groundSpeed * pelvisRatio)
h.setAnim('die', { loop: false });  h.update(dt);
h.autoLOD(pxPerMetre);   h.show('headgear', false);  h.setColors({ tint: [1,1,1] });  h.setDisguise(bool);
const W = await loadWeapons('out/weapons.glb'); equip(h, W, 'kar98k');   // re-solved on every setAnim
// holds: aim / lowready (right palm grip, forward = shoulder->palms, LEFT-HAND two-bone IK to grip_l each frame),
//        sling (right shoulder, muzzle up), back (crawl/swim/carry), drop (die/dead/surrender), hand (pistol/knife/syringe/bombs)
```

- **Clip names** (61): idle walk run sprint walk_formal crouch_idle crouch_walk crawl crawl_idle swim swim_idle dive aim aim_up aim_down shoot rifle_shoot reload pistol_idle kneel_shoot punch jab stab syringe throw plant use pickup open climb lower_ladder carry_idle carry_walk carry_barrel drag die dead hit hit_head knockback surrender handsup_held salute wave look_around talk phone fold_arms yes no drive sit sit_enter sit_exit push dig bury chop stand_up roll torch.
- **Clip sources:**
  - UAL1/UAL2, CC0.
  - the prone set (`crawl*`, `crawl_idle*`, `prone_*`, `go_prone`, `get_up`, `die_prone`, `dead_prone`): authored keyframes in `tools/characters/prone/` (see `docs/crawl-animation.md`).
  - Keyed with the `poses.js` DSL: surrender, handsup_held, salute, wave, look_around, stab, syringe, kneel_shoot, drag, lower_ladder, carry_idle, rifle_shoot, dive, dead.
- **Adding a clip:** add one `K(name, {base, upper, keys:[{t, base_t, dirs:{bone:[x,y,z]}, spine, head, pelvisY}]})` in `authoredClips`, then rerun `build_anims.js`.

## Measured results (proof characters)
| | Green Beret | German rifleman |
|---|---|---|
| LOD0 + headgear + brows (tris) | 11 306 + 352 + 192 = **11 850** | 11 030 + 628 + 192 = **11 850** |
| LOD1 / LOD2 (tris) | 5 000 / 2 000 | 5 000 / 2 000 |
| Materials | 2 (atlas, alpha brows) | 2 |
| GLB size (anims excluded) | **1.15 MB** | **1.17 MB** |
| Build time | 9.4 s | 11.5 s |

- **Rebind accuracy:** joint error at most 6e-16 m.
- **Variant GLBs:** 1.17–1.19 MB each.
- **Review images** in `../review/`: `heads_closeup.jpg`, `turnaround.jpg`, `game_1x_crop_1to1.jpg`, `game_2x.jpg`, `strips_{greenberet,german}.jpg`, `headgear_fit_gallery.jpg`, `tmp/faces_sheet.jpg` (enemy variety).

## Known limits and next steps
- **Garments** are body shells (perfect fit, inherited weights), not cloth-simulated. There are no wrinkle normal maps yet; baked AO carries the folds.
- **Animations:**
  - `crawl` groundSpeed is 0.14 m/s: the hands, not the feet, drive it, so tune the crawl speed in-game.
  - `anims.glb` is 2.85 MB. Sharing time accessors, or meshopt compression, would shrink it.
  - UAL pistol poses stand in for rifle aim; the left-hand IK fixes the support hand.
- **Weapons** are low-poly primitive props, fine at game zoom and crude at close zoom. The CC-BY Kar98k (`models.md`) could replace them, keeping the sockets.
- **Not yet built:**
  - A disguise outfit in the same GLB (`setDisguise` toggles `outfit*` / `disguise*` parts once built).
  - The diver's rebreather, the Sapper's satchel, grenades on the chest.
  - Per-instance cloth tint in the shader.
- **Faces:** the 16 archetypes run at ×1.4 strength with ±0.25 jitter. They read as different people at close zoom, but share one MakeHuman skin texture per age band. Skin decals (scars, wrinkles) are the next variety lever.

## Licences
- MakeHuman/MPFB system assets: CC0. Only system assets are used, and MPFB (GPL) code is not shipped.
- Quaternius UAL1/UAL2: CC0.
- ambientCG Fabric030, Fabric045, Rubber004: CC0.
- All geometry generators, keyed clips, crawl, IK, headgear, weapons and uniforms are project code (CC0).
- No swastikas, SS runes or death's heads anywhere. Insignia are plain collar tabs and shoulder straps, and cap badges are plain roundels.

## Guests runtime (rework guests r1)
- `web/guestkit.js`: `loadGuestLib()` = `commandos_b/out/anims.glb` (rework gaits, crawl v2, prone death) + `guests/out/guest_anims.glb` overlay (guest clips win);
  `createGuest(tpl, lib, {id})` wraps `charkit.createHumanoid` (charkit/ground/synth/weapons copied from commandos_b; previous guests copies in `web/orig_r1/`).
  - speed picks the gait: walk -> walk | walk_fast, run -> run_slow | run | run_fast, tied_walk -> tied_walk | tied_walk_fast.
  - `setTied(bool)`: idle/walk/run -> tied_idle/tied_walk (run capped at 2.3 m/s). `setFollowing(bool)`: idle/walk -> follow_idle/follow_walk (M17 single file).
  - M17 guests (Gilbert + 4) cannot crawl: crawl/crawl_idle -> crouch_walk/crouch_idle.
  - stand -> crawl plays go_prone first; crawl -> stand plays get_up; die while running -> die_run_{0,25,50,75} (nearest run phase),
    forward fall, root moved 1.3 m on completion -> dead_prone. Posture changes fade 0.35 s.
  - clips with meta.travel / travelYaw / next (die_run*, board_boat, board_truck, board_car): at the end guestkit moves/turns the root and plays `next` with no fade.
- `web/ground.js` (guests copy): toe/boot penetration raised by the full depth; `footLift()` = constant pelvis lift for standing/gait clips (STAND_CLIPS).
- `web/guest_synth.js` (poseClip / overlay), `web/guest_board.js` (boarding), `web/jobs/build_guest_anims.js` (all guest clips).
- Build: `PORT=8851 node tools/run_page.mjs web/jobs/build_guest_anims.js ../rw/bld` ; sidecars: `python3 ../tools_sidecar.py`.
- Verify: `cd ../rw && JOB_ARGS='{"ids":[...guests]}' node run.mjs job_anim.js final` (copy of chars/anim_check on guestkit; summ.py), strips `job_strip.js` + `sheet.py`, game view `job_game.js`.
