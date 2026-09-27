# tools/blender/vehicles: Opel Blitz trucks

These scripts regenerate the six truck GLBs in `assets/models/vehicles/`. The runtime is `src/art/truck-model.js`.

| File | Body | Paint | Tris (drawn) | Size |
|---|---|---|---|---|
| `truck_dak.glb` | cargo (canvas bed) | RAL 8000 Afrika Korps tan | ~13.8k | 1.2 MB |
| `truck_grey.glb` | cargo | RAL 7021 panzer grey | ~13.8k | 1.0 MB |
| `truck_burnt.glb` | cargo wreck (bare bows, sagging on rims) plus the ground scorch decal | burnt | ~10.8k | 1.1 MB |
| `truck_{dak,grey}_tanker.glb` | Kfz. 385-style ~3000 l tank body on the same chassis | tan / grey | ~13.9k | 1.1 MB |
| `truck_burnt_tanker.glb` | tanker wreck plus the scorch decal | burnt | ~11.6k | 1.0 MB |

Each file is one 2048² baked atlas (albedo, normal and ORM with AO) as WebP (`EXT_texture_webp`). It holds these nodes:
`truck_body`, plus `wheel_FL/FR/RL/RR` pivoted at the hub (0.45 m radius; the left wheels are authored rotated π about Y), plus `scorch_decal` in the burnt files only.
The front faces glTF +Z, the pivot is the ground centre, and the truck is 6.2 m × 2.39 m.

## Files
- `truck.py`: the model, materials, bake and export. Usage:
  `blender -b --factory-startup --python-use-system-env --python truck.py -- <model|full> <dak|grey|burnt> [res=2048] [cargo|tanker]`
  - `model` renders a quick unbaked EEVEE preview.
  - `full` bakes the atlas, exports `out/truck_<variant>[_tanker]/*.glb` and renders previews.
- `blib.py`: the shared helper library for primitives, procedural materials, atlas bake and GLB export.
- `glbpack.py`: re-encodes the embedded textures. Shipped files use `glbpack.py in.glb out.glb --webp`, which gives albedo and normal at 2k and ORM at 1k.
- `lod.py`: optional LOD chain from a `.blend` (Decimate, same atlas). No LODs ship: a truck is under 14k tris and only a few are on a map.
- `dl.py` and `asset_manifest.json`: texture sourcing, all CC0, from Poly Haven and ambientCG. They list the source and licence of every map.

## Rebuilding
1. Blender 4.0.2 or 4.2 needs Pillow and numpy on the system Python path, hence `--python-use-system-env`. The AO and atlas bakes run on the CPU, about 45 to 70 s per variant. Set `BAKE_DEVICE=GPU` with 4.2 to bake on the GPU.
2. Run `python3 dl.py` once. It fills `tex/` (the CC0 texture sets `Fabric045`, `Rubber004`, `rust_coarse_01`, `green_metal_rust`, `weathered_planks`, …) and `hdri/`. The HDRI is only used for the preview renders (`goegap_2k.hdr`).
3. Build every variant, pack it and copy it:
   ```sh
   for v in dak grey burnt; do for b in cargo tanker; do
     blender -b --factory-startup --python-use-system-env --python truck.py -- full $v 2048 $b
     n=truck_$v$([ $b = tanker ] && echo _tanker)
     python3 glbpack.py out/$n/$n.glb ../../../assets/models/vehicles/$n.glb --webp
   done; done
   ```

## Notes
- The burnt scorch decal is set to `specularFactor 0` (KHR_materials_specular). Without it the near-black soot reflects the sky and reads navy blue in three.js.
- No national insignia and no swastikas (spec §10.6). Registration plates are blank.

---

# Realistic vehicle library (`assets/models/vehicles/<group>/`)

53 scripted-Blender vehicles, guns and props in five groups. The runtime is `src/art/vehicle-library.js`; the index is
`assets/models/vehicles/manifest.json`. The six `truck_*.glb` files above are the older Opel Blitz set used by
`src/art/truck-model.js`; the library's `opel_blitz_cargo` / `opel_blitz_tanker` replace them once vehicle.js is wired.

| Folder | Assets | Script entry points |
|---|---|---|
| `cars_moto/` | r75_sidecar, kubelwagen, horch901, citroen11, willys_mb, opel_blitz_cargo, opel_blitz_tanker | `scripts/{r75,kubelwagen,horch,citroen,willys,blitz}.py` on `scripts/veh.py`, `scripts/validate.py`, `lib/materials_add.json` (+ `make_*_tex.py`) |
| `armour/` | panzer2_f, panzer3_j/l, panzer4_f2/g, sdkfz251_c, sdkfz231_8rad, flak88 (+noshield), morser18_21cm, mg34/mg42_tripod, mgnest_ring/horseshoe | `scripts/run.sh {pz2,pz3,pz4,sdkfz251,sdkfz231,flak88,morser18,mg_tripod,mg_nest}.py <arg>`, `scripts/vlib.py` (on `../blib.py`), `scripts/rebuild_all.sh` |
| `aircraft/` | ju52_3m, ju87_b, bf109_e, fi156_storch, fw_c30_autogiro, fuel_bowser, bomb_trolley, starter_cart, chocks, windsock | `scripts/{ju52,ju87,bf109,storch,c30,props}.py` on `scripts/ac.py` + `veh.py`, `scripts/check.py` |
| `naval/` | battleship_bismarck, uboat_viic, patrol_boat (HS 114), minisub_biber, fishing_boat, harbour_tug, rowboat, raft | `scripts/{battleship,uboat,patrol_boat,biber,fishing_boat,tug,rowboat,raft}.py` on `scripts/nav.py` + `veh.py` |
| `rail/` | loco_br52, tender_t30, coach, wagon_covered/open/flat/tank, railgun_k5, rail_crane (+idler), tram_fr, handcar, mine_cart, mine_tipper | `scripts/<asset>.py`, `scripts/rail.py`, `scripts/wheelcheck.py`, `lib` textures from `make_heat_tex.py` |
| `consolidate/` | ships the outputs into the game | `pack_veh.py` → `stage_tex.py` → `build_manifest_veh.py` (see below) |

Each group folder keeps its own README (build commands, conventions, rework notes) and `review_tool/` (three.js review renderer).

## Rebuilding
1. `tools/blender/vehicles/relocate_vehicles.sh` (scripts hard-code the scratch workspace), then merge
   `kit_materials.json` (the kit material table with the `veh_*`, `air_*` and wood-paint entries) into `tools/blender/kit/lib/materials.json`.
2. Blender 4.2 with Pillow/numpy (`--python-use-system-env`); each group README lists the exact command per asset.
   Outputs: `<group>/out/<asset>/<model>{,_lod1,_lod2}.glb` + `.kit.json` (armour: `<asset>_lod{0,1,2}.glb`, `_burnt_lod*`, `.veh.json`, `tex/`).
3. Ship: `cd consolidate && GLTFPACK=<gltfpack> python3 pack_veh.py && python3 stage_tex.py && python3 build_manifest_veh.py`,
   then copy `consolidate/ship/assets/*` over `assets/`. `node shot.mjs "<query>" out.jpg` renders the library in Chromium
   (`_vehtest.html`-style page; see the script).

## What ships (budget: vehicle assets ≤ 60 MB, 57.9 MB used)
- meshopt + quantised GLBs (`gltfpack -cc -kn -km -ke -vp 14 -vtf`); every node name is kept, so moving parts keep their pivots.
- LOD0 and LOD2 only. LOD1 (~40%) is built but not shipped; the library draws LOD0 at zoom ≥ 0.75 and LOD2 below.
- Baked AO embedded per LOD (LOD0 384 px, 640 px for ships, trains and the Ju 52; LOD2 96/128 px), lightly blurred.
- Shared textures by relative URI: `assets/textures/lib/1k/` (37 new files, the rest reused from the building library);
  armour atlases in `models/vehicles/armour/tex/` at 1k (the 2k set is not shipped; ORM at 512 px). Armour paint =
  texture swap `_grey_` → `_dak_` / `_winter_` (the library's LoadingManager URL modifier).
- 16 variants are built but not shipped (manifest `assets.<asset>.unshipped`, list in `consolidate/prune.json`):
  paint-only duplicates, Bismarck camo, K5 dak, rowboat painted and the winter sets of freight wagons, crane, handcar and mine cars.
- Sidecar per model: `<group>/<model>.json` (unified schema: parts with pivots/axes/limits, sockets, muzzles, emitters,
  lights with blackout flags, contacts, tracks, toggles). Model space: +x = vehicle LEFT, y up, +z = front.
