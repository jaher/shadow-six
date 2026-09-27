# SHADOW SIX - armour group (vehicles/armour)

Blender 4.2 scripts (reproducible) -> glTF LOD0-2 + sidecar per asset. Built on `realism/blender-modeling/blib.py`
(Opel Blitz pipeline: procedural PBR paint + grime materials, Cycles-baked unique atlas) via `scripts/vlib.py`.

## Assets (`out/<name>/`)
| name | script | what |
|---|---|---|
| panzer4_g / panzer4_f2 | pz4.py g / f2 | Pz.Kpfw. IV Ausf. G (double-baffle brake, Rommelkiste, 1 headlamp) / F2 (ball brake, twin headlamps, both turret visors, smoke rack, spare wheels), KwK 40 L/43 at full 6.62 m |
| panzer3_l / panzer3_j | pz3.py l / j | Pz.Kpfw. III Ausf. L (KwK 39 L/60, 20 mm Vorpanzer on mantlet + driver plate) / J early-1942 (short KwK 38 L/42); own low turret w/ sloped roof + bin, torsion-bar running gear |
| panzer2_f | pz2.py | Pz.Kpfw. II Ausf. F, 2 cm KwK 30/38; inboard low superstructure, real + dummy visor, leaf-spring wheels visible |
| sdkfz251_c | sdkfz251.py | Sd.Kfz. 251/1 Ausf. C half-track: faceted body (upper plates 17 deg in), Schachtellaufwerk, fender line + lockers, MG shield w/ wings, rear AA MG |
| sdkfz231_8rad | sdkfz231.py | Sd.Kfz. 231 (8-Rad), all-wheel steering, Bugpanzer on the upper nose, mudguards + boxes, lug tyres, faceted open turret, wire-mesh screens |
| flak88 | flak88.py | 8.8 cm Flak 18/36 on Kreuzlafette 36 (box-section girders): equilibrators, recuperator/recoil brake, breech + tray, handwheels + pan seats, Zuenderstellmaschine (twin drums + crank), one-piece 2.24 m field shield with barrel slot + cradle slot cover, folding top, side wings |
| morser18_21cm | morser18.py | 21 cm Mörser 18 in firing position; double-recoil (barrel in cradle + upper carriage on rails), massive L/31 tube |
| mg34_tripod / mg42_tripod | mg_tripod.py mg34/mg42 | MG 34 / MG 42 (square slotted jacket) on MG-Lafette 34 + MG-Zieleinrichtung 34, Patronenkasten |
| mgnest_ring / mgnest_horseshoe | mg_nest.py ring/horseshoe | dug-in sandbag nests: bag variants, entry gap + trench (ring), feathered spoil apron |

Per asset: `<name>_lod{0,1,2}.glb` (intact), `<name>_burnt_lod{0,1,2}.glb` (destroyed/burnt: posed nodes, parts
dropped), `tex/` (shared by all LODs, referenced by relative URI: `<name>_<variant>_{albedo,orm}_<2k|1k>.jpg`,
`<name>_normal_*.jpg`, `track_<kgs|zpw>_<variant>_*.jpg`), `<name>.veh.json` sidecar, `<name>.credits.json`, `.blend`.
LOD0 uses the 2k set, LOD1/2 the 1k set (MG tripods: 1k/512).

## Paint variants (texture swap, same geometry)
`grey` RAL 7021 Dunkelgrau (default, referenced by the GLBs), `dak` RAL 8000 Gelbbraun + sand dust, `winter` worn
lime whitewash over grey + snow on top faces, `burnt` (only in the *_burnt GLBs). Swap = replace `_grey_` by
`_<variant>_` in every texture URI (e.g. a GLTFLoader LoadingManager URL modifier), including the track textures.
Markings are baked into the albedo: Balkenkreuz (black, white flanks) + tactical numbers only (spec 10.6).

## Sidecar (`<name>.veh.json`, glTF/game coords: +x = vehicle LEFT, y up, +z = vehicle front; metres)
- `nodes[]`: name, parent, kind (body, turret, gun, wheel, steer, track, hatch, door, weapon_traverse, weapon_elev),
  `pivot` (rest pose, model space), `local` (relative to parent), `axis` (node-local rotation axis), limits
  (`elev_min/max`, `traverse_deg`, `open_deg`, `steer_max_deg`, `steer_ratio`), wheel `radius`, `drives_track`.
- `tracks[]`: belt node, `v_per_m` -> scroll `texture.offset.y += v_per_m * distance` on the track material maps;
  wheels/sprockets spin at `distance / radius`.
- `sockets[]` (crew/driver/commander/riders/troops/exits, with `pose` hints), `muzzles[]` (main gun, coax, hull MG,
  with dir + weapon id), `emitters[]` (exhaust, dust, mud, blast_dust, smoke, casings), `lights[]` (headlights with
  `cover: blackout`, Notek convoy light), `contacts[]` (track front/rear, wheels, feet -> terrain trail stamper).
- `dims_real`, `bbox_game`, `lods[]` (file, tris, bytes), `variants{}` (texture files per variant + theater), `info`.

## Rework 1 (detail pass)
- Detail geometry (`V.D`, `V.weld`, `V.bolt_row`, `V.plate_edge`: weld beads, bolt/rivet rows, hinges, straps) is baked
  high->low into the normal map (+ a grime accent in albedo); it costs no triangles.
- Tracks: `track_belt` now has link relief (2 rows per link: tread groove + hinge-pin bosses, coarse ground run).
  Sidecar `tracks[].snap`: when the vehicle stops, round `offset.y` to a multiple of `snap` so texture joints line up
  with the geometric grooves. Wheels: `road_wheel2` (twin tyres + hub cap), `sprocket2`, `spoked_idler`, `return_roller`.
- Weathering: `_weather_extra` (faded/darker panels, rain streaks, speckled mud spray, oil stains) on all paint.
- Mörser 18 sidecar: `mount.recoil_m` (upper carriage on its rails, game axis `recoil_axis_game`) + `gun.barrel_recoil_m`.

## Rebuild / review
```
scripts/run.sh pz4.py g            # one asset (log: scripts/logs/), BAKE_DEVICE=GPU default (CPU works)
scripts/rebuild_all.sh             # everything, two parallel chains
bash scripts/review.sh panzer4_g   # kit review renderer (+ real 1.8 m crew soldier) -> review/<name>/<name>_review.jpg
```
References (internal only): `vehicles/refs/armour/` (+ `urls.json`).

## Rework 2 (review fixes)
- Handedness verified: Blender +X = glTF +X = vehicle LEFT; drivers (251, 231, Panzers) sit on +X = left. Only the
  sidecar `coords` text was wrong ("x right") and is fixed.
- `vlib.set_mats` BUGFIX: `materials.clear()` dropped the `material_index` attribute (Blender 4.x), so every
  `lathe_mat` split was lost and all tyres/rubber rims baked in body paint. Wheels now bake black/dark-grey rubber.
- Atlas push-pull fill (`_fill`) of unbaked texels (was black, ~45% of the atlas) + hard edges re-derived after
  LOD decimation (`_decimate` -> sharp by 32 deg): LOD1/2 match LOD0 shading, no dark/blotchy pop.
- Paint: matte (rough 0.68-0.90), fine mottling instead of panel-sized fade, stronger cavity grime + streaks,
  less top dust on grey/winter. Burnt: dark brown steel, orange only in hot spots, soot band/top/stains, ash on
  up-faces. Earth/sandbags burn to scorched soil (`_scorch`), not grey.
- `V.burnt_swap(intact, burnt)`: burnt-only replacement meshes (231: burnt-off tyres -> bare rims + cord remnants,
  hull lowered 0.17 m). `burnt_drop` also matches node names (whole weapon nodes removed, no floating parts).
- Ground feather: `V.A.feather = {node: (h0, h1)}` adds COLOR_0 RGBA (alpha = smoothstep of height) and an
  alphaMode BLEND copy of the material in the GLB; the nests' spoil aprons (`apron` node) fade into the terrain.
- Per asset: 251 lockers (0.26 m bins, lid seam, hasps), 231 flat-faceted nose, staggered 30 mm tread lugs, tail
  light on the hull; flak88 shield/fuze setter/seats/girders; nests: entry boards inside the gap, stepped wall ends,
  lumpy spoil, sandbag tied ears + end fold, hessian weave scale.
