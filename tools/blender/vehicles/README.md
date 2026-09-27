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
