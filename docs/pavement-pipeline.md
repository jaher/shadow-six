# Pavement, roads & street furniture (PROGRESS step 3p)

The user asked for "all kinds of highly detailed pavement" and "did you make lamp posts?". This step adds a road
and pavement system on top of the terrain splat and the trails, the street furniture that goes with it (lamp posts
first), night street lighting, and a schema for missions 4-20 to author their road networks.

Screenshots are in `docs/screenshots/p3-pavement-*.jpg`. Frames come from `tools/perf/paveshot.mjs`, and the look-dev
map is `src/missions/dev/pavement-gallery.js` (not listed in the campaign).

| File | Role |
|---|---|
| `src/world/roads.js` | Pure data, runs in Node: the `SURFACES` catalogue, `normalizeRoadNetwork`, the centripetal Catmull-Rom `sampleCenterline`, and the `RoadIndex` spatial index (`at`, `surfaceAt`, `raiseAt`, `covers`, `trailInfo`). Also grid painting, the terrain splat painter, pre-trampling, and `expandFurniture` |
| `src/art/pavement/pavement-glsl.js` | The pavement shader, injected into `MeshStandardMaterial` |
| `src/art/pavement/pavement-material.js` | One material per road or area, all sharing one program. Holds the theatre colours and the POM steps per preset |
| `src/art/pavement/road-mesh.js` | Road ribbons, gridded area meshes, profile extrusion (kerbs, skirts, quay coping and wall), and polygon edge paths |
| `src/art/pavement/details.js` | Drains, manholes, quay bollards, mooring rings, rails and the shared detail materials |
| `src/art/pavement/index.js` | `buildPavement(net, ctx)` |
| `src/art/furniture/lamps.js` | Nine lamp variants and their `LAMP_LIGHT` values |
| `src/art/furniture/street-props.js` | Bench, Morris column, level crossing, bollard, milestone, signs, fences, canvas sign and poster textures, and sagging wires |
| `src/art/furniture/index.js` | `buildFurniture(F, ctx)`. Draws furniture instanced and returns the light emitters |
| `src/render/street-lights.js` | Night glow, ground light pools, and the fixed pool of real point lights |
| `assets/textures/pavement/` | Nine CC0 Poly Haven sets at 1k and 512. `pavement.json` holds tile sizes and credits (11 MB in total) |

## 1. Mission schema (backwards compatible)

```js
roads: [{ id?, surface, points: [[x, z], …], width = 6, spline = true,
  kerb?: true | { h = 0.14, w = 0.25, side: 'both'|'left'|'right', paint: 'blackout'|null, gutter = true, drains = 24 },
  sidewalk?: true | { w = 2, surface = 'flags', side },
  rails?: true | { gauge = 1.435, tracks = 1|2, spacing = 3.3, offset = 0 },          // grooved tram rails, flush
  markings?: 'dashed'|'centre'|'edges'|'dashed_edges', craters?: [[x, z, r]], manholes?: spacing,
  wear = 0.5, cracks, patches = 0, weeds = 0.3, puddles = 0.3, edge: 'ragged'|'hard',
  lamps?: { variant, spacing = 22, side: 'alternate'|'both'|'left'|'right', hooded?, damaged?: [index…], block? },
  grid?: false }],                                    // grid:false = visual only (the nav grid keeps its code)
pavements: [{ id?, surface = 'flags', points | x, z, w, d, angle = 0, raise = 0, kerb?, edge,
  quay?: { edges: [i…], bollards = 12, rings = true, railing?: spacing }, craters?, cracks, patches, weeds, puddles, grid? }],
furniture: [{ type: 'lamp', variant, x, z, rot, hooded?, damaged?, lean?, lit?, block? },
  { type: 'floodlight'|'searchlight_pole'|'wall_lamp'|'street_lamp', … }, { type: 'bench'|'bollard'|'morris_column'|'milestone', x, z, rot },
  { type: 'sign', variant: 'plate'|'fingerpost'|'wehrmacht'|'andreaskreuz', text: 'LINE 1\nLINE 2' },
  { type: 'crossing', x, z, rot, w }, { type: 'telegraph', points, spacing = 35, h = 7, wires = 4 },
  { type: 'fence', variant: 'picket'|'railing'|'rail'|'wire', points, h }],
terrain: [{ type: 'path', terrain: 'road', …, surface? }]   // legacy roads; `surface` opts them into 3p
```

- **Legacy roads.** A mission written before 3p has only `terrain` roads. These become soft roads with the theatre's
  default surface (snow: `snow_packed`, desert: `sand_road`, otherwise `dirt`). They are pre-trampled exactly as before,
  so missions 4-20 look the same until they opt in.
- **Rotation.** `rot` for furniture follows the prop convention: local +X, the lamp arm, points along (cos rot, sin rot).
- **Posts block their navigation cell.** Lamp posts, bollards, telegraph poles and signs use `B.FENCE` (movement only,
  sight passes). The Morris column uses `B.HIGH`. `block: false` makes a piece visual only; M1-M3 use this so their
  tuned routes stay unchanged.
- **Validation.** `validateMission` warns about unknown surfaces and malformed entries.

## 2. Surfaces

| Surface | Kind | Texture (Poly Haven) | Notes |
|---|---|---|---|
| `setts` | hard | cobblestone_floor_03 | granite setts in courses square to the kerb (road-space UVs follow curves) |
| `belgian` | hard | cobblestone_floor_08 | domed Belgian blocks, deeper POM |
| `pave_fan` | hard | patterned_cobblestone | segmental arcs / fan pavé |
| `brick_herringbone` | hard | herringbone_brick | |
| `flags` | hard | precast_stone_paving | sidewalks, platforms |
| `asphalt` | hard | tarred_gravel | tar macadam: tar-sealed cracks and construction joint, patches |
| `asphalt_cracked` | hard | asphalt_02 | |
| `concrete` | hard | damaged_concrete_floor | 5 × 5 m slabs, each sampling its own piece of the scan, expansion joints |
| `quay` | hard | precast_stone_paving (grey, 1.7× scale) | coping, masonry wall, bollards, rings, chains |
| `gravel`, `dirt`, `mud`, `sand_road`, `snow_packed`, `slush` | soft | terrain splat layers | painted into the splat, pre-trampled ruts and puddles, slush |

Albedo textures are flattened at pack time. Luminance is divided by a wrapped 1/10-size blur and normalised to a
target brightness per material. This removes the tile-scale light and dark banding that showed as stripes along long
streets.

## 3. Pavement shader (`pavement-glsl.js`)

- **Coordinates.** Every vertex carries `aPave = (s along, t across, edge distance, half width)`, the pattern direction
  and `aPvMisc = (crater damage, gutter width, marking code, road flag)`. Areas use rotated world coordinates.
- **Steep parallax occlusion mapping.** The shader ray-marches the CC0 height map (`ard.b`) with relief interpolation.
  Because the camera is orthographic, the view vector is constant. Steps per preset are low 0, medium 8, high 14 and
  ultra 24. Steps change as a uniform, so there is no recompile.
- **Anti-tiling** (feat/anti-tiling). The paving pattern stays regular; the texture's own repeat does not show.
  - *Slab shuffle* (`flags`, `quay`). The world slab grid (`tile / 4`; running bond on quays) has procedural joints
    that breathe a little, a rounded arris and chipped corners. Every slab takes one of the scan's own 16 slabs at
    random (`SLAB_SRC`: its joint centres, measured on the height map), turned by a random quarter turn or mirrored,
    with its own tone, hue, settle tilt and roughness; about 6 % are paler replacements or older, darker slabs. No POM.
  - *Block shuffle* (`setts`, `belgian`). Courses stay continuous, but every run of about four stones along a course
    shows a random piece of a random course of the scan (`COURSES`: the scan's course boundaries).
    `tools/render/pave_stones.py` segments each height map into stones and writes a stone-ID map
    (`512/<set>_sid.png`, RGB, NEAREST): the stone's centre, its wrap offset, and its share of the scan's mean
    tone. A texel belongs to the block that holds its stone's centre. Otherwise it is looked up through the
    neighbouring block across the nearest run end or course edge, and the joint widens where neither has a stone.
    Cuts therefore always fall between stones.
  - *Per-stone variation* (`setts`, `belgian`, `pave_fan`, `brick`). The stone ID plus its world block is a key that is
    unique for every stone in the world. Each stone gets its own tone (a few darker ones), hue, roughness and, from
    about 6 px, a settle tilt. The scan's own per-stone tones (which repeat with the tile) are divided out
    (`STONES.norm`). Stones under about 3 px fade to their mean, so panning never glitters.
  - *Hex tiling* (tar macadam): three rotated and offset taps, contrast-preserving (`art/anti-tiling-glsl.js`). On low
    it is a rotated second sample under a noise mask. Concrete slabs keep a random piece of the scan each, now with a
    per-slab tone.
  - *Macro variation* everywhere: colour drift (about 12 m), grime (about 3 m), clustered oil and damp stains, and
    sun-bleached patches. It comes from three fetches of a small tileable noise at incommensurate scales and angles.
  - Measured on the rendered frame (`tests/anti-tiling.test.mjs`, `tools/perf/tilemetric.py`): the correlation of the
    high-passed luminance with itself one texture period away fell from 0.85-0.91 to 0.12-0.18 on flags and quays,
    from 0.68 to 0.30 on setts and from 0.88 to 0.36 on Belgian blocks, which equals the regular course grid's own
    baseline.
- **Wear.** Polished wheel lanes (one or two lanes depending on width), oil streaks between the wheels, and dirt in
  joints and at the edges.
- **Cracks and seams.** A Voronoi crack network appears only where a noise mask allows. On asphalt, some cracks are
  sealed with glossy tar, and so is the centre construction joint. Craters raise crack density nearby.
- **Repair patches.** Rectangles across a lane on roads, or at odd angles on areas. Asphalt gets fresher tar; stone
  gets a tar patch. Each patch has a sealed rim.
- **Weeds.** Weeds grow in joints and cracks where traffic is light: at the edges, and on areas more than roads.
- **Ragged edges.** A road without a kerb crumbles into the verge. The shader discards fragments below a noise
  threshold, and the splat painter puts gravel or packed snow underneath.
- **Gutters.** Kerbed roads get a gutter strip: setts laid along the kerb, a 3 cm dip, wetter and dirtier. Drain grates
  are spaced roughly every `drains` m.
- **Markings.** Worn white paint for period centre dashes and edge lines. Kerbs can carry blackout paint (1 m
  alternating white bands, from the wartime blackout).
- **Shell craters.** Vertex damage scorches and shatters the surface. The core is discarded, so the carved and
  scorched ground under it shows through.
- **Weather.** In snow, snow packs the joints first, drifts at the edges and is cleared to wet slush in the wheel lanes.
  Wetness comes from the theatre, or 0.85 when `weather.rain` is set. Puddles fill the joints first, then cover whole
  stones, and have mirror roughness, so they reflect the environment map.
- **Trail films.** The shader samples the terrain's trail field (the RG16F ruts and berms texture). Tyres and boots
  crossing the paving leave mud, slush or dust films in the theatre's colour. Stone takes no deformation.
  `printVisibility` on hard surfaces is at most 0.05, so guards cannot follow prints over setts.
- **Terrain integration.** `buildTerrain` receives the `RoadIndex`. Soft roads re-weight the splat and are
  pre-trampled. Grass tufts and clutter (stones, flowers, weeds, shrubs) are never placed on hard paving (`covers`).
  `world.groundY` adds the sidewalk, quay or platform raise, so walkers stand on the kerb.

## 4. Street furniture and lamps

- **Lamp variants.** `paris_single` is the French/Belgian cast-iron candelabra with a lamplighter's ladder rest and a
  four-pane lantern. The others are `paris_double`, `wall_bracket`, `norway_wood` (a creosoted pole with an iron arm,
  enamel reflector and service wire), `harbour` (globe), `platform` (swan-neck and enamel shade), `floodlight` (two
  German box floods on a timber pole), `searchlight` (a 60 cm drum on a railed platform) and `wall_lamp`.
- **Lamp modifiers.** `hooded` fits a blackout slot hood: the lamp is dim and blue-ish, its pool shrinks, and its
  light is about 25 % of normal. `damaged` breaks the glass (unlit) and leans the lamp 8°. `lean` sets any angle.
- **Other furniture.** Benches, street bollards, the Morris column (with period posters that carry no real brands or
  insignia), fingerposts, enamel plates and Wehrmacht black-on-yellow boards (text only, no insignia), St Andrew's
  crosses, French milestones, level crossings (timbers, crosses, striped barrier arms), fences (picket, railing,
  post-and-rail, wire), and telegraph lines.
- **Wires.** Catenary spans with sag ≈ 0.0022·L² + 0.08 m. Each wire has an `aSway` weight (sin πt) for the shared
  wind sway shader (step 4w), so gusts rock the wires. Mission `telegraph_pole` structures with `wireTo` (the M1 coast
  road) now get their wires, and unrotated poles are turned across their line.
- **Instancing.** Identical pieces share one merged geometry per material and are drawn with one instanced mesh.
  The gallery has 22 lamps and 11 props in 46 instanced draws.

## 5. Night lighting (`render/street-lights.js`)

- **Glowing glass.** Lamp glass is emissive at night (2.6 tungsten orange, or 2.2 when hooded), which reaches the HDR
  bloom threshold without clipping to a cold white under the night grade. Lamp colours are ~2400–2700 K, pre-saturated.
- **Night rig.** A mission asking for a night HDRI on a day theater gets the night lighting (cold dim moon, dark fill,
  night fog/LUT) from `resolveLighting`, so warm pools read against blue moonlight.
- **Ground pools.** Every lit lamp throws an additive light pool on the ground, all drawn in one instanced call.
  Floodlight pools are 1.5× longer and pushed out along the beam.
- **Real lights.** A fixed pool of PointLights (low 0, medium 3, high 6, ultra 8), created once per mission so there
  are no shader recompiles, follows the lamps nearest the view centre with a smooth hand-over. Characters and walls
  under a lamp are lit for real. Intensity = the variant's nominal value × `LAMP_GAIN` (2.2).
- **Daytime.** Glass is off, and there are no pools and no lights.

## 6. BEL missions (M1-M3, snow, Norway 1941)

- **M1.** The coast road becomes `snow_packed`. A rutted camp track runs from the north pier past the barracks to the
  relay station, with a concrete pad at the station. Norwegian wooden lamps stand on the coast road, with German
  floodlights at the camp, a hooded wall lamp on the relay hut and a fingerpost. The telegraph poles get their wires.
- **M2.** Truck tracks lead inside the camp (packed snow, plus slush to the depot). A trodden path crosses the
  settlement with `grid: false`, so it stays snow for footprints. The settlement has wooden lamps (one hooded), the
  camp has two floodlights, and a telegraph line with a fingerpost runs along the escape road.
- **M3.** A works road leads to the shed, which gets a concrete apron. There is a concrete switchyard under the
  transformer cages, and camp tracks on the east bank. Yard floodlights, a hooded wall lamp on the admin building,
  lamps at the gate and an "ADGANG FORBUDT" plate complete it.
- **Gameplay unchanged.** All new roads and areas lie on ground cells that were already packed ground or road, or they
  use `grid: false`. All furniture has `block: false`. Footprints, routes and sight lines therefore stay exactly as
  tuned.

## 7. Performance

All figures are GPU-synced medians of 60 frames at 1280×720 on a shared RTX 5090, headless ANGLE. The view is the
gallery at zoom 0.8, which is dense and the worst case. Each cell is frame ms with the pavement and furniture shown,
then hidden (`tools/perf/paveshot.mjs --perf=1`):

| Preset | Day (shown / hidden) | Night (shown / hidden) |
|---|---|---|
| low | 1.1 / 0.9 | 1.3 / 0.9 |
| medium | 2.0 / 1.0 | 2.3 / 1.4 |
| high | 2.5 / 1.6 | 2.3 / 1.2 |
| ultra | 2.2 / 2.0 | 2.5 / 1.9 |

The cost is about +0.2 ms on low and about +1 ms on medium and high, where most of it is POM. Ultra's difference is
within noise.

- **Build time.** 25–40 ms for the gallery (8 roads and areas, 48 k triangles, 39 meshes) and 2–10 ms for M1-M3.
- **Draw calls.** One per road chunk (48 m), area, kerb or sidewalk strip. Details and furniture are instanced.

## 8. Known limitations

- Junctions of two ribbons overlap. The later road draws on top, with no blended junction mesh. Author a paved area
  for a proper square or junction.
- Kerbs and sidewalks follow the ribbon's offset curves. On very tight bends (radius under 2× the offset) the inner
  kerb can fold.
- Puddles reflect the environment map only. There is no screen-space reflection of nearby lamps or buildings.
- Real point lights do not cast shadows. The ground pools are flat decals and can float a few centimetres over steep
  undulation.
- Level-crossing timbers do not cut the road mesh. They sit 6 cm above it.
