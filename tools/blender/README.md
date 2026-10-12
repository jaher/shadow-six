# tools/blender — building & bridge kit

These scripts regenerate every GLB in `assets/models/buildings/` and `assets/models/bridges/` (193 assets, 3 LODs each).
The runtime side is `src/art/building-library.js`, and the data it reads is `assets/models/buildings/manifest.json`.

## Layout
| Path | What |
|---|---|
| `kit/blender/kit*.py` | The kit, imported with `import kit as K`: walls and openings, roofs, details, weathering and damage, bridges (arches, cutwaters, trusses, trestles), export (AO bake, LODs, sidecars). The API is documented in `kit/README.md`. |
| `kit/tools/` | `build_lib.py` (texture grading), `make_procedural.py`, `make_decals.py`, `glb_post.py`, `validate.py` (budgets and sidecar checks), `lib_sheet.py` |
| `kit/review/` | Headless three.js review renderer: `node kit/review/render.mjs <glb> <outdir> --views game1,game2,close,front,top [--theater snow] [--lod]`. It needs a Poly Haven HDRI (`kloofendal_43d_clear_puresky_1k.hdr`, CC0) in `kit/review/hdri/`, which is not shipped. |
| `kit/src/` | Texture sourcing: `dl.py` plus `sources.json`/`lib_config.json` (Poly Haven / ambientCG ids, all CC0) |
| `kit/lib/{materials,decals}.json` | Material table (tile size, roughness, source and licence) and decal/sign atlas layout. The same files ship in `assets/textures/lib/`. |
| `norway/`, `desert/`, `europe/`, `military/`, `bridges/` | One script per asset family: `scripts/<family>.py` builds all its variants (snow, destroyed, …). Each family also has helpers (`nfx*.py`, `dz*.py`, `eu_*.py`, `mil.py`, `brfix*.py`, `lodfix.py`) and procedural texture generators (`tools/make_*_tex*.py`). The `rw*/` folders hold rework-round scripts (sidecar notes, screenshot sheets). |
| `fueltanks/` | Fuel-tank family (docs/fuel-tanks.md): `fuel_tanks.py -- <outroot> <asset> [intact\|destroyed] [seed] [snow]` with one module per type (`t_cradle`, `t_farm`, `t_quay`, `t_column`, `t_elevated`) on the shared helpers `ft.py`; `build_all.sh` rebuilds all 24 assets and runs `ship.py` (AO JPEG + gltfpack + merge into the buildings manifest, group `fuel`); `make_stencils.py` / `make_grating.py` write the CC0 stencil and open-grating atlases; `studio.sh` renders the review sheets (zoom 1; `VIEW=game2` for zoom 2). Build logs carry `BOUNDS` (parts outside the footprint + 0.3 m) and, for wrecks, `OVERLAP` (BVH clashes between named part groups) lines; `ft.finalize` hides the decal quads during the AO bake (they used to bake dark rectangles into the shells). |
| `consolidate/` | Ships the assets into the game: `pack.py` (meshopt, quantisation, AO resized per LOD, texture URIs rewritten to `../../../textures/lib/1k/`), `textures.py` (only referenced maps: 1k JPEG q80, plus 2k WebP q70 albedo for "ultra"), `sidecars.py`, `build_manifest.py` + `catalogue.py` (types → variants), `credits_md.py`. |

## Rebuilding
1. Run `tools/blender/relocate.sh`. The scripts were written in a scratch workspace and hard-code its path. This rewrites that path to this folder and links `kit/lib/1k` to `assets/textures/lib/1k`.
2. Set up Blender 4.2 (4.0.2 also works; the AO bake runs on CPU) with Pillow/numpy on `PYTHONPATH`, then build a family:
   `BAKE_DEVICE=CPU blender -b --factory-startup --python-use-system-env --python tools/blender/norway/scripts/barn.py -- <outdir> a 1`
   Each script's docstring gives its `Usage:` line. The arguments after `--` are usually `outdir variant seed [snow]`; some scripts
   take only `variant seed` and write to their family's `out/`. A build writes `<asset>.glb`, `_lod1.glb`, `_lod2.glb`,
   `.kit.json`, `.credits.json` and `review/`. The batch files `*.sh` and `q*.txt` list the exact commands used.
3. Validate: `python3 tools/blender/kit/tools/validate.py <glb> --budget 15000` (use `--bridge --budget 25000` for bridges).
4. Ship: `consolidate/pack.py`, `textures.py`, `sidecars.py`, then `build_manifest.py`. Run them from a folder that has `../<family>/out`, or edit `ART` in `pack.py`. They need `gltfpack` (`npm i gltfpack`).

## Add-on manifests (per-mission art passes)
An art pass ships its new assets without rebuilding the whole library: `consolidate/addon_manifest.py <art_root> <repo> <addon>
<group> type=a,b ...` packs the named builds (and their `_destroyed` / `_snow` twins) into `assets/models/buildings/<group>/` and
writes `assets/models/buildings/<addon>.json` (same entry schema, `assets` + `types` only). `src/art/building-library.js`
merges every name in `EXTRA_MANIFESTS` after `manifest.json`. Missions reach the assets through `VARIANT_HINTS`
(`src/art/building-props.js`) by `variant` name; register them under their own types (not `crates`, `sign`, `house` …)
so unhinted structures of other missions keep their looks. §7.7 extra props (`casemate_gun`, `flat_roof_house`, `sea_wall`)
switch to the library only for hinted variants; a hinted `sea_wall` tiles its 8 m section along the run.
- M14 (Atlantic Wall, `manifest-atlantic-wall.json`): `military/q_m14.txt` lists the builds.
- M13 (Le Havre docks, `manifest-le-havre.json`): `military/q_m13.txt` lists the builds (Nissen huts, brick tank garage, lock-control
  shacks, sea-lock gate with `leaf` doors, dockside jib crane, launch on its slip trolley, dock cargo stacks).
- M15 (Compiegne, `manifest-compiegne.json`): `europe/q_m15.txt` lists the builds (`townhouse_fr.py` + `th_*.py` on `fr_common.py`:
  the Second-Empire corner block in its three gameplay parts with mansard, lucarnes, shop fronts with striped awnings and 3D
  lettering, terrace and iron balcony B, flat roof R, round turret; the cream townhouse; `cemetery_fr.py`: family chapel, chest tombs).
- M8 (Tell el Eisa, `manifest-tell-el-eisa.json` + `manifest-tell-el-eisa-bridge.json`): `desert/q_m08.txt` lists the builds
  (red-tile adobe row houses with the door N / W, the riveted water reservoir and its burst ruin, jerrycan supply dumps,
  the desert timber trestle over the wadi).
- M19 (Oldenburg coal mine + V-2 base, `manifest-oldenburg.json`): `europe/q_m19.txt` lists the builds (`olden.py`, `olden_small.py`,
  `v2_kit.py` on `od_common.py`: the stilted timber mine office, the brick boiler house, corrugated-iron barracks, the tall brick
  house, the timber hut, the plank pithead with its walkable flat roof, adit portal and canted rail doorway, the coal hopper, the Ringstand-type
  observation bunker, privy, kennel, oil-drum stack, heightfield coal heap, pit props, the yard derrick, and the V-2 pad as
  its three gameplay pieces: the A4 on the firing-table ring, the Brennstand on its pad, the servicing tower).
- M16 (the Maas bridge, Belgium; `manifest-maas.json`, M18 shares the map): `europe/q_m16.txt` lists the builds (Mosan brick
  houses with bluestone trims and wall anchors, one with the door on the W gable, whitewashed / brick farmhouses, grey rendered
  townhouses, the village railway halt with its platform canopy, a brick field hut, the island's tarred plank shed, the round
  camouflaged pillbox, the ridge field tent, an abandoned crawler bulldozer). Own types only; M16 picks them by `asset`.
- M6 (Masi, Finnmark; `manifest-masi.json`): `norway/q_m06.txt` lists the builds (`masi_ruin.py`: the two roofless bombed log
  manors with their walkable plank deck at 3.2 m, burnt upper storey broken off along the mission's parapets / partitions,
  chimney stack, white stone stairs and ladder at the mission's links; `masi_tower.py`: the round laft log tower with its
  snow-capped shingle cone and the rubble-granite round tower; `masi_garrison.py`: the stone chapel, the log barrack with a
  sod roof and a flat roof section, the fortified HQ block with its walkable roof at 6.5 m, each with a burnt-out
  `_destroyed` twin; `masi_small.py`: lean-to, burnt log house, long-case clock, wheeled Gatling, log pile, handcart). Own
  types only; M6 picks them by `asset`.
- M9 (Bab el Qattara, `manifest-bab-el-qattara.json`): `desert/q_m09.txt` lists the builds (`bq_*.py` on `bq_common.py`: the open
  three-bay corrugated tank shed with its torn roof and rolled camouflage net, sandstone houses under Marseille tiles and the
  weapons store with its porch, the whitewashed NE hideout, the command post with its mud-brick annex, the domed garrison block
  with arcade and roof terrace, the board-and-batten radio hut behind its blast wall, the sandbag bunker under palm thatch, the
  A-frame engine hoist, the yellow drum dump, Afrika Korps ammunition stacks; destroyed twins of the five targets). Own `*_bq`
  types only; M9 picks them by `asset` with `nav: false` (gameplay footprints unchanged).

## Conventions
- Blender Z-up, 1 unit = 1 m. The pivot is the ground centre and the front faces Blender −Y, which is glTF +Z (game south at `rot` 0).
- Sidecars (`<asset>.kit.json`) use game coordinates: x east, y up, z south; `heading = atan2(dz, dx)`.
  - footprints: `HIGH`, `LOW`, `FENCE`, or `NONE` (bridge decks, quays)
  - doors: hinge-pivoted `door_<id>` nodes
  - roofs: `elev`, `walkable`
  - climb edges, ladders
  - anchors: smoke, lights, MG posts, charge spots, levers
  - `bridge` block: deck polygon, deck top, water level, spans, piers
- Budgets: LOD0 buildings 3–15k tris (landmarks up to 30k), bridges up to 25k. LOD1 is about 40% and LOD2 about 12%. After compression every shipped GLB is under 1 MB.
- No swastikas or SS runes (spec §10.6). Flags use the Balkenkreuz.
