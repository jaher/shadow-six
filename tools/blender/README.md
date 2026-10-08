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
- M8 (Tell el Eisa, `manifest-tell-el-eisa.json` + `manifest-tell-el-eisa-bridge.json`): `desert/q_m08.txt` lists the builds
  (red-tile adobe row houses with the door N / W, the riveted water reservoir and its burst ruin, jerrycan supply dumps,
  the desert timber trestle over the wadi).

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
