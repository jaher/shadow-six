# assets/terrain: sources and licences

Everything here is CC0 (public domain) or the project's own procedural work. Nothing comes from the original game.
Built by the terrain R&D pipeline (docs/terrain-pipeline.md; `tools/pack_layers.py`, `pack_bark.py`, `build_foliage.py` in the
terrain scratch pack). Processing: de-lighting (low-frequency luminance flattened), albedo calibrated to a target mean linear
albedo, snow speck cleanup, and packing into per-theater layer strips (albedo, normal, data = height/roughness/AO).

## Ground layers: `{temperate,desert,snow}_{albedo,normal,data}.jpg` (1K) and `*_{albedo,normal}_2k.jpg` (2K, ultra preset)
| layer | source | licence |
|---|---|---|
| grass | ambientCG **Grass004** (ambientcg.com) | CC0 |
| grassdry | Poly Haven **withered_grass** (polyhaven.com) | CC0 |
| dirt | Poly Haven **dry_ground_01** | CC0 |
| mud | Poly Haven **brown_mud_02** | CC0 |
| gravel | Poly Haven **gravel_floor_02** | CC0 |
| sand | Poly Haven **dense_sand** | CC0 |
| sand2 | Poly Haven **sand_01** | CC0 |
| wetsand | Poly Haven **coast_sand_01** | CC0 |
| rockd / rocks | Poly Haven **rocks_ground_02** (desaturated / tinted variants) | CC0 |
| road | Poly Haven **rocky_trail_02** | CC0 |
| leaves | Poly Haven **forest_leaves_02** | CC0 |
| snowold | Poly Haven **snow_03** | CC0 |
| snow, snowpack | procedural (FFT noise) | own work, CC0 |

## Trees
- `bark_albedo.jpg`, `bark_normal.jpg`, `bark.json`: Poly Haven **bark_brown_02, bark_platanus, bark_willow, pine_bark, palm_bark**
  and ambientCG **Bark012** (CC0). Birch bark is synthesised (own work).
- `foliage.png`, `foliage.json`: leaf-cluster cards composed from ambientCG **LeafSet004, LeafSet010, LeafSet013, LeafSet022,
  LeafSet024, LeafSet030, PineNeedles001** (CC0). Twigs and palm fronds are procedural.
- Tree geometry is generated at runtime from a per-tree seed by `src/art/terrain/treegen.js` (own code).

## Procedural (no files)
Grass blades, tufts, wildflowers, stones, snow sparkle and particles, drifts, trail/footprint stamps, frozen-pond ice and
tree impostor atlases are generated at runtime (own code).
