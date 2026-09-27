# SHADOW SIX building & bridge kit

`KIT = <claude-tmp>`

## Layout
| Path | What |
|---|---|
| `lib/1k`, `lib/2k` | Shared tiling PBR textures `<id>_{diff,nor,arm}.{jpg,webp}` (ARM = R ao, G rough, B metal), `decals_rgba.{png,webp}`, `signs_diff` |
| `lib/materials.json` | 37 materials: `tile_m` (metres per repeat), grain, roughness/metal, grime, mean albedo, maps, source + licence, texel density |
| `lib/decals.json` | UV rects of the decal atlas (16 cells) and sign atlas (16 signs) |
| `blender/kit.py` | Single import for asset scripts (re-exports every module below) |
| `tools/` | `build_lib.py` (texture grading), `make_procedural.py`, `make_decals.py`, `glb_post.py`, `validate.py`, `lib_sheet.py` |
| `review/` | `render.mjs` (+ `server.mjs`, `review.html`, `review_views.js`, `sheet.py`) |
| `examples/` | `farmhouse_normandy.py`, `bridge_stone_arch.py`, outputs in `examples/out/<name>/` |

## Pipeline (what makes it realistic and cheap)
- Geometry is built in WORLD coordinates (metres, Blender Z-up, ground z=0, pivot = ground centre, **front faces Blender -Y** = glTF +Z = game south at rot 0; north = +Y).
- **UV0** = world-scale projection (1 UV = one `tile_m` tile) -> shared tiling textures (no per-asset atlas). Mode `aligned` (u along face, v up / up-slope) or `beam` (grain along an axis).
- **COLOR_0** vertex colour multiplies base colour: per-part tint jitter, rising-damp dirt band at the base (walls are auto-bisected at 0.12/0.35/0.7/1.2 m), moss on north/low faces, large-scale tone variation, water-line band when `water_level` is set. Alpha channel = decal opacity.
- **UV1 + baked AO** (Cycles, 1024 px, embedded JPEG) -> glTF `occlusionTexture` texCoord 1.
- Decals (streaks under sills, soot, moss, waterline, posters...) = alpha-blended quads from the shared decal atlas, `specular 0`.
- `glb_post.py` rewrites every `kit:<id>[~rrggbb]` material to reference `lib/<res>/<id>_*.jpg` by **relative URI** (or `--lib-url` prefix for the game repo; `--webp` for EXT_texture_webp). Tint `~rrggbb` -> `baseColorFactor`.
- LODs: LOD1 = drop parts < 0.3 m + planar dissolve 4 deg + collapse 45% (~37% of LOD0); LOD2 = drop parts < 0.9 m + 4 deg + collapse 30% (~20-25%; collapse below ~0.2 tears thin roof slabs - use an impostor if you need less). Per-part `lod='keep'` (curved surfaces, e.g. cambered road) / `lod='drop'`. Doors are separate nodes pivoted at the hinge (`door_<id>`), decals node `decals`. `finalize(recenter=True)` moves the bbox centre to the pivot and shifts all metadata.

## Running
```bash
B42=$SCRATCH/realism/characters/blender-4.2.9-linux-x64/blender      # or /usr/bin/blender (4.0, CPU bake)
PYTHONPATH=$SCRATCH/realism/blender-modeling/pydeps42 BAKE_DEVICE=CPU \
  $B42 -b --factory-startup --python-use-system-env --python my_asset.py -- outdir
node $KIT/review/render.mjs outdir/my_asset.glb outdir/review --views game1,game2,close,close_se,front,top [--theater snow|desert]
python3 $KIT/tools/validate.py outdir/my_asset.glb --budget 15000 [--bridge]
```
GPU is shared: `BAKE_DEVICE=CPU` is often faster than a contended OptiX bake (AO 1024 px ~ 20-60 s CPU).
`KIT_TEXTURED=1` builds full textured Principled node trees in Blender (for Blender renders / unique atlas bakes).
`--lod` adds LOD1/LOD2 at 0.5x to the sheet. For a GLB without a sidecar, render.mjs writes a fallback `<name>.kit.json` (rasterised cells, hull footprint, eave/roof height, hull climb edges).
Review views: `game1/game2/game05` (ortho, pitch 40, yaw 0, 40 px/m x zoom), `close`/`close_se` (3/4 perspective), `detail`, `front` (elevation), `top` (0.5 m grid + footprints red=HIGH orange=LOW, doors green, walkable roofs blue, climb edges yellow, ladders magenta, auto cells red tint). HDRI kloofendal_43d_clear_puresky (Poly Haven CC0), sun from NW, AgX (`--tone aces`), GTAO.

## Script skeleton
```python
import sys; sys.path.insert(0, KIT + '/blender'); import kit as K
K.begin('house_x', seed=3, theater='temperate', snow=False, water_level=None)
poly = [(-5,-3),(5,-3),(5,3),(-5,3)]                      # CCW footprint, outer wall face
w = K.opening(poly, 0, 2.5, 1.0, 1.4, 0.9, 0.55)          # edge 0 = front (-Y), 2.5 m from its start
d = K.opening(poly, 0, 5.0, 1.1, 2.2, 0.0, 0.55, 'segment', 'door')
K.wall_ring(poly, 3.0, 0.55, 'fieldstone', [w, d], plinth=('ashlar', 0.4, 0.04))
K.window(w, shutters='open', surround='ashlar_limestone'); K.door(d, 'front', 'plank', 'green')
R = K.roof_gable(0, 0, 10, 6, 3.0, 45, 'roof_slate')
K.gable(poly, 1, 3.0, R.z_ridge - R.lift, 0.55, 'fieldstone'); K.gable(poly, 3, 3.0, R.z_ridge - R.lift, 0.55, 'fieldstone')
K.finalize(outdir)          # AO bake, LOD0-2 GLBs, <name>.kit.json sidecar, <name>.credits.json, .blend
```

## API (all in `kit`)
### core (`kit_core`)
- `begin(name, seed=1, theater='temperate'|'coast'|'snow'|'desert'|'frost', snow=False, water_level=None)` -> Asset; `A()` current asset; `rng()` seeded RNG.
- `mat(mid, tint=None)` library material (tint = sRGB multiplier -> distinct material); `mat_textured(mid, tint, mapping='UV'|'BOX', res)`; `MATS` = materials.json.
- `part(bm, mid, name, uv='aligned'|'beam'|'keep', axis, rot90, uv_scale, node='main', grime=None, tint, smooth, bisect=True, jitter=0.06, mat_tint, alpha=1)` -> object. `P(mid, builder, *args, **kw)` one-primitive shortcut.
- bmesh builders (world coords): `box_bm(bm, center, size, rot_z, taper)`, `hexa_bm(bm, p8)`, `beam_bm(bm, p0, p1, w, h, up, roll)`, `cyl_bm(bm, p0, p1, r, segs, r1, caps)`, `prism_bm(bm, poly2d, z0, z1)`, `loft_bm(bm, rings)`, `quad`, `uv_faces`, `uv_rect(bm, face, rect)`.
- polygons: `poly_offset(poly, d)`, `ccw(poly)`, `poly_area`.
- metadata (sidecar, GAME coords x east / z south): `footprint(poly, block='HIGH'|'LOW'|'FENCE'|'NONE', kind)`, `footprint_rect(cx, cy, w, d, rot, block)`, `door_meta(...)` (auto by `door`), `roof_meta(poly, elev, walkable)`, `climb_meta(p0, p1, top)`, `ladder_meta(bottom, top, elev)`, `anchor(name, pos, heading_vec, **extra)`.
### walls / openings (`kit_arch`)
- `opening(poly, edge, t, w, h, sill, thick, shape='rect'|'arch'|'segment', kind='window'|'door', rise=None)` -> `Frame` (`fr.p(x, z, d)` local point; `fr.outline()`).
- `wall_ring(poly, h, thick, mid, frames, z0=0, plinth=(mid, h, proj))` closed walls with true boolean openings + registers HIGH footprint. `ring_bm(bm, outer, inner, z0, z1)`.
- `gable(poly, edge, z_eave, z_ridge, thick, mid, frames)` triangular gable on a wall edge (pass `R.z_ridge - R.lift`).
- `window(fr, style='casement'|'single'|'fixed'|'sash', panes=(cols, rows), frame='white'|(r,g,b), recess=0.1, sill=mid|None, lintel=mid|None, surround=mid|None, shutters=None|'open'|'closed'|'ajar', shutter_color, shutter_style='plank'|'louvred', curtain=0.6, bars=False, streak=True, interior=True)` frame, sashes, glazing bars, dirty glass, interior darkness card, curtain hint, sill, lintel/voussoirs, jamb blocks, shutters with hinges, rain-streak decal.
- `door(fr, did, style='plank'|'panel'|'glazed'|'double'|'barn', color, open_deg=0, hinge='left', step=mid, lintel, surround)` -> node name `door_<did>` (pivot at hinge) + door meta.
- `voussoirs(fr, mid)`, `jamb_blocks(fr, mid)`, `shutter_pair(fr, state, tint, style)`, `boolean_cut(bm, frames)`, `cut_object(ob, cutter_bm)`. `PAINT` named colours.
### roofs (`kit_roof`)
- `roof_gable(cx, cy, L, W, z_eave, pitch=45, mid='roof_slate', rot=0, eave_oh=0.35, gable_oh=0.25, thick=0.12, ridge='auto', fascia, barge, gutters=True, sag, wobble, hip=False, walk=False)` -> `Roof` (`z_ridge`, `lift`, `w(lx, ly, z)`, `parts`): sagging slabs, ridge cap (round tiles / angle / turf), fascia, bargeboards, gutters + downpipes with brackets and shoes.
- `roof_hip(...)`, `roof_sod(cx, cy, L, W, z_eave, pitch=27)` (turf + eave logs), `roof_shed(x0, y0, x1, y1, z_low, z_high, mid, low_side='-y')`, `roof_flat(poly, z, mid, parapet_h, parapet_t, parapet_mid, coping, walkable=True, spouts=True)` (walkable roof + climb edges).
- `chimney(x, y, z_base, z_top, w, d, mid, cap, pots, rot)` (corbel, cap, pots, soot decals, 'smoke' anchor); `dormer(R, lx, side=-1, w, h, wall, roof, pitch=50, window_kw)` (cuts the main roof).
### details (`kit_detail`)
- `quoins(poly, z0, z1, mid)`, `course(poly, z, h, proj, mid)`, `cornice(poly, z, mid, steps)`.
- `stairs(p0, direction, width, rise, n, mid, solid=True, cheek=None)` -> top point (+ ladder link + LOW footprint); `ladder(bottom, top_z, normal)`; `railing(p0, p1, h, style='iron'|'timber'|'pipe')`; `balcony(o, n, w, d, z, slab, rail)`; `sign(center, normal, w, kind, board, hanging=False)` (kinds in `lib/decals.json` 'signs': kommandantur, achtung_minen, halt_sperrgebiet, cafe_gare, boulangerie, mairie, landhandel, fjordheim, brucke_12t, pont, garage, post, epicerie, wache, estaminet, ferme); `wall_lantern(o, n, z)`.
### weathering / damage (`kit_weather`)
- `decal(kind, center, normal, w, h, up, alpha=0.85)`; kinds: streak_rain, streak_rust, moss_patch, damp_base, soot, crack, waterline, lichen, efflorescence, stain_blotch, dirt_splash, streak_long, poster_fr, poster_de, poster_no, stain_rust_blotch. `decal_on_frame(fr, kind, x, z, w, h)`.
- `snow_pass(thick=0.09, min_nz=0.45)` top-facing snow layer on everything (call before finalize).
- `bite(center, radius, squash, seed)` blast hole through walls/roofs (window parts inside are removed); `roof_holes(R, [(lx, ly, r)], battens=True)` missing covering + exposed rafters/battens; `rubble(center, radius, height, mids, n, beams, tiles)` (LOW footprint); `scorch_openings()` soot above openings.
### bridges (`kit_bridge`; road along X, river flows along Y, banks z=0, water negative)
- `Deck(x0, x1, z_end, camber)` (`.z(x)`), `arch_profile(xc, span, spring, rise)`.
- `masonry_body(deck, arches, width, z_found, mid)` solid body minus arch openings; `arch_ring(xc, span, spring, rise, width, mid, depth, block)` voussoirs + soffit; `cutwater(x, pier_w, width, z_bot, z_top, mid, upstream=-1)` pointed + round cutwaters, caps, starlings; `pilaster(x, y_face, z0, z1)`; `band(deck, y_face, x0, x1, dz)` string course; `parapet(deck, y_face, x0, x1, h, t, mid, coping)` with coping stones + end piers; `wing_walls(x_end, side, width, z_bot, length, splay)`; `abutment(x, side, width, z_top, z_bot)`; `road(deck, x0, x1, width, surface, kerb)`; `lamp_post(p, h)`.
- `stone_arch_bridge(spans=((span, rise),...), pier_w, width, water, bed, spring, camber, ...)` complete bridge.
- Steel: `ibeam_bm`, `rivet_bm`, `rivet_line`, `gusset_bm`, `steel_truss(x0, x1, z_deck, height, width, panels, kind='pratt'|'warren'|'howe', rivets=True)`, `plate_girder(x0, x1, y, z_top, depth)`. Timber: `timber_trestle(x0, x1, z_deck, width, bents|z_ground)`, `deck_planks(x0, x1, z, width)`.
- `bridge_meta(deck, x0, x1, width, water, river_width)` -> sidecar `bridge` block + NONE-block deck footprint (nav `bridge` layer).
### export (`kit_export`)
- `finalize(outdir, ao_res=1024, ao_samples=96, lods=((0.45, 0.3, 4.0), (0.14, 0.9, 12.0)), lib_res='1k', webp=False, skip_ao=False, lib_url=None)`.
- Lower level: `unwrap_ao(objs)`, `bake_ao(objs, res, samples)`, `build_lod(level, parts, ratio, min_size, dissolve_deg)`, `export_glb(path, objs)`, `auto_footprint(objs)`.

## Sidecar `<name>.kit.json` (game coords: x east, y up, z south; heading = atan2(dz, dx))
`footprints[{shape:'poly', points, block, kind}]`, `doors[{id, kind, pos, heading, width, height, node, approach}]`, `windows`, `roofs[{points, elev, walkable, kind}]`, `climb[{a, b, top}]`, `ladders[{a, b, y}]`, `anchors[{name, pos, heading, ...}]` (smoke, light, roof_ridge), `bridge{deck, deck_top, water_level, river_width, spans, piers}`, `parapets`, `bbox_game`, `height`, `auto_cells_0p5` (fallback raster, i=floor(x/0.5), j=floor(z/0.5)), `lods[{file, tris, bytes}]`, `materials`, `nodes`.

## Licences
All textures CC0 (Poly Haven / ambientCG; per-material source in `lib/materials.json`, per-asset `<name>.credits.json`); decals, signs, glass, interior and curtain textures are procedural own work (CC0). Sign lettering is original (no swastikas / SS runes).

## Additions from the military rework (art_rework_military_1)
- Materials (own work, CC0, derived from CC0 Poly Haven bases; generator `art/military/tools/make_mil_tex*.py`):
  `concrete_formwork` (2.7 m: board imprints, joints, tie-rod holes + rust weeping, pour lifts + efflorescence),
  `concrete_slab` (4 m: weathered tops, stains, lichen, hairline cracks), `concrete_camo` (5.4 m: formwork + 3-colour
  disruptive paint), `steel_grating` (0.6 m), `tent_canvas` (4 m: 1 m seams, patches), `corrugated_galv` (2.4 m: 76 mm
  corrugation, laps, rust runs), `timber_creosote` (1.5 m), `burlap_bag` (0.5 m sandbag burlap). The library
  `concrete_board`/`concrete_bunker` have ~3 % contrast and read as untextured grey: prefer the new ones.
- Known kit pitfalls (worked around in `art/military/scripts/mil.py`): tints > 1.0 overflow the `~rrggbb` key (teal
  colours); EXACT-boolean cut faces get collapsed UVs + black COLOR_0 (`mil.fix_cut_faces`); LOD2 stalls at 20-30 %
  with world-projected UVs (`mil._patch_lod`: cull smallest islands, one collapse, trim to ~11 %).
- Review: `review_water` land is now a textured ground plane; extra views `side_e`, `side_w`, `game1s`, `game2s`
  (game view shifted 30 % south, for long assets such as the castle gate bridge).
