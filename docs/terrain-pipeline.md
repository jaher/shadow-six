# Terrain & vegetation pipeline (final)

The final ground and vegetation system for SHADOW SIX. It merges the two prototypes the terrain judge compared
(`docs/screenshots/terrain-judge-*.jpg`). **T-B is the base**: the splat ground, grass, clutter, trails and the
performance work. **T-A supplied the grafts**: the high-level trail API, the snow look, the desert tone and
clutter, and crown density. Every item on the judge's must-fix list has been addressed (see §8).

- **Code:** `scratchpad/terrain/final/`, with `src/`, `engine/`, `demo/`, `tools/` and `assets/`.
- **Screenshots:** `docs/screenshots/terrain-final-*.jpg`.

| File | Role |
|---|---|
| `src/terrain.js` | `createTerrain()`: heightfield (carved under water, flat ice in snow), splat material, trail system, grass, clutter, snow FX, `preTrample()` |
| `src/terrain-layers.js` | Per-theatre palettes (8 layers: tile, softness, wetness, snow, grass, ice, slush, tint), the CPU splat with warped and feathered masks, undulation and snow drifts |
| `src/terrain-glsl.js` | Hex-tiling splat shader: height blend, macro variation, trail relief and self-shadow, puddles, frozen-pond ice, road slush, stable snow glints |
| `src/trails.js`, `src/trails-glsl.js` | Deformation render targets, stamps (tyre, track, boot, crawl, drag, crater, flatten), in-place fade, CPU record ring and gameplay query |
| `src/grass.js`, `src/grass-glsl.js` | Instanced 3D grass tufts with a ragged verge, trampling, wind, and zoom/distance density LOD |
| `src/clutter.js` | Stones and pebbles, wildflowers, weeds, and desert camel-thorn shrubs |
| `src/snowfx.js` | Falling snow and the snow-cover shader chunk (used on trees and stones) |
| `src/treegen.js` | One seeded tree generator (broadleaf, conifer, palm, bush) with T-A crown density, B's scans, and worker-safe code (THREE is injected) |
| `src/treegen.worker.js` | Module worker that generates chunk vertex arrays off the main thread |
| `src/vegetation.js` | `createVegetation()`: a unique-tree budget, geometry merged per 20 m chunk, translucent foliage, snow load, and impostor forests |
| `src/impostors.js` | Impostor atlases (albedo and view-space normal) baked from real prototypes at the game camera pitch, plus the instanced billboard material |
| `src/game-adapter.js` | Game glue: `createTerrainHandle` (synchronous, with `.ready`), footprint event wiring, unit and vehicle stamping, `tracksNear` for the AI |
| `engine/renderer.js` | Patched copy of `src/engine/renderer.js`: the water post hooks, **alpha-aware GTAO** and **environment grading** (`engine/renderer-terrain.patch`, 72 added lines) |
| `engine/gtao-alpha.js`, `engine/env-grade.js` | The two renderer fixes (must-fix 1 and 2) as small modules imported by the renderer |
| `demo/`, `tools/` | Demo (`?theater&preset&zoom&cx&cz&forest=N&veg=0&water=0&dbg=1`), `look.mjs`, `perf.mjs`, `beforeafter.mjs`, `sparkle.mjs`, `probe.mjs` |

## 1. Design

- **Asset-driven ground.** Each theatre uses eight de-lit CC0 photoscan layers, packed as three `sampler2DArray`s
  (albedo, normal, data = AO/roughness/height). Dry ground is floored at roughness 0.62 in the shader: the packed
  grass (~0.26) and gravel (~0.47) maps blew lawns out to white at the sun's mirror angle under the orthographic
  camera (fix/water-glare); ice, slush, wet ruts and puddles keep their own low roughness. The layers are blended
  through a CPU-built splat (four texels per metre, two RGBA8 textures). For each pixel the shader keeps only the
  three strongest layers, samples each with hex tiling, and height-blends them. The approach is data-driven: a
  mission can re-weight layers with `opts.paint(x, z, w)` (forest floor under trees, burnt patches) and never
  touches the shader.
- **One world-space deformation field.** Every trail (tyre, track, boot, crawl, drag, crater) is a stamp into one
  map-sized RG16F render target. The terrain vertex shader displaces the ground by the field scaled by each layer's
  softness, and the fragment shader derives relief normals, rut self-shadowing, darkening, wet puddles, slush and
  compacted snow from it. Every material therefore responds with no per-material special cases in gameplay code.
- **A CPU mirror for gameplay.** The same stamp calls write a ring buffer of records `{kind, x, z, heading, id, t,
  material, visibility}`. The AI queries these records; it never reads the GPU texture.
- **The fixed game camera drives LOD.** The camera is orthographic, so screen size does not depend on distance.
  Grass density, blade width and glint cell size therefore follow the pixel footprint (metres per pixel), and
  impostors are baked at the camera's own pitch.
- **Renderer fixes live in the renderer.** Nothing in terrain or vegetation monkeypatches passes or rebalances
  ambient per material any more. The two engine problems the judge found are fixed at the source (§2.1, §2.2).

## 2. Techniques per feature

### 2.0 Anti-tiling (feat/anti-tiling)
- **Hex rotations are hashed.** The paper's rotation, angle = |x·y| + |x+y| + π, advances by about a whole radian per
  vertex. Wrapped, it beat every ~2π vertices (about 3 m) into a regular lattice of rings on high-contrast layers (the
  rocky and old-snow patches of M1). Rotations and offsets now come from a sin-free hash.
- **Sin-free hashes.** `fract(sin(x) · 43758)` loses precision on the GPU once x reaches about 10⁵ (the 16-per-metre
  turf cells across a 200 m map), so every terrain hash is a Hoskins hash.
- **The noise texture's G channel** (seed 202) ran about 1 sd darker along its border, so each lookup drew a dark grid
  at its repeat (5.3 m tussocks, 23 m macro): regular stripes over the meadows. It is now seed 207, rescaled to the
  old mean and sd. Small-scale lookups (`tbNz`) read two copies at incommensurate scales and angles, contrast restored,
  so none has a visible period.
- **Smooth, variance-preserving hex blend** (fix/anti-tiling-seams). The paper's luminance-weighted pow-5 weights
  switched from one tap to the next along the straight Voronoi edges of the hex lattice, which showed as straight-edged
  patches on low-contrast layers. Its blend also flattened heights where cells meet, so the layers' height blend
  followed the lattice. The weights are now barycentric², and albedo, normal slope and data blend about each layer's
  mean (its coarsest mip), scaled by 1/√Σw² (Heitz & Neyret 2018). Contrast is kept, and no cell edge shows.
- **Low preset** (one sample per layer): a slow domain warp (±0.8 m over about 13 m), so the repeats no longer sit on a
  lattice. On M1's rocky ground on low, the correlation at the 3 m texture period fell from 0.88 to 0.10.

### 2.1 Alpha-tested foliage in GTAO (must-fix 1)
`engine/gtao-alpha.js` subclasses `GTAOPass`. For the normal/depth prepass it no longer sets
`scene.overrideMaterial`. It swaps the material of each object instead:
- `userData.aoMaterial` on the object or its material wins. Vegetation sets it on leaf chunks: a `MeshNormalMaterial`
  with the same wind vertex code and the card's alpha test.
- `userData.aoExclude` leaves the object out of the prepass. It is used for grass (its self-occlusion is baked into
  the blade colour) and for impostors.
- Any material with `alphaTest > 0` and a `map` or `alphaMap` automatically gets a cached cut-out normal material.
- Everything else uses the stock normal material.

The pass then renders without a scene override and restores the materials. As a result, B's `patchGTAO`,
`attachRenderer` and the `update()` precondition are gone, and there are no black squares or dark spruce fragments.
`vegetation.attachRenderer()` is kept as a no-op so existing callers still work.

### 2.2 Blue environment and `envMapIntensity` (must-fix 2)
- **`envSaturation` and `envWarmth`.** These are new per-theatre `THEATER_LIGHTING` fields. The equirect HDR is
  graded once in a half-float pass before PMREM filtering (the procedural `Sky` gets the same grade through
  `onBeforeCompile`). Defaults are day theatres 0.5–0.65, with warmth 0.1 (0.2 in the desert), and night 1.0.
  This takes the cyan out of the diffuse IBL (grey sand, teal foliage) for every material at once, so T-A's
  `applyAmbientBalance` has been dropped.
- **`Renderer.bindEnvironment(material, scale)`.** three.js replaces `material.envMapIntensity` with
  `scene.environmentIntensity` whenever `material.envMap` is null (see `WebGLRenderer`, `refreshMaterial`). A bound
  material gets the environment texture explicitly, so `envMapIntensity = theater.envIntensity × scale` takes
  effect, and it is re-applied on every theatre or HDR change. The binding is released on `dispose`.

### 2.3 Water against undulating ground (must-fix 3)
- **Carving.** The heightfield is carved from the grid: deep water to −1.2 m and shallows to −0.35 m, tested with
  a 4-tap cell test at ±0.3 m so banks slope instead of stepping.
- **Continuous shorelines (game integration, 2026-09-30).** In the game, the carve (`carveDepth`) reads
  the shore field from `src/world/shore-field.js` instead of the cells. That field is a 0.25 m signed distance
  built from the mission's smoothed water shapes: river ribbons with per-point widths, smoothed lake and fjord
  outlines, and circles (the M2 islets are authored as lobed outlines), with a gentle ±0.25 m noise. The same field drives the apron carve, the splat's
  wet and deep lines, and the water's shore distance (ice rim, contact foam). Banks are smooth curves instead of the
  0.5 m staircase or the octagons left by the chamfer distance. See `docs/water-pipeline.md` §10, "Banks".
- **Snow theatre.** Water cells become a flat ice sheet (−0.06 m with a 2 % residual undulation) drawn by the terrain
  ice shader, so no water plane can clip through the ground.
- **The stub water plane is replaced.** The demo uses the final water system
  (`scratchpad/water/final`: `createWater` and `waterBodiesFromGrid(grid)`). The terrain mesh is tagged
  `userData.waterTerrain`, so the water's bed capture reads the carved ground.

### 2.4 Splat masks and transitions (must-fix 4, 5)
- **Warped grid lookup.** The splat samples the grid code at a warped position: 1.3 m fBm plus 0.45 m value noise.
  Road verges and patch borders are therefore ragged instead of following cell lines.
- **Feathered, noise-thresholded masks.** A "not base ground" indicator is box-blurred over 1.5 m. The splat
  blends from the patch or road rules into the theatre's base rules by
  `smoothstep(0.25, 0.85, feather + 2.2·edgeNoise)`. Borders become irregular transition zones instead of discs
  with smooth edges. Water and shallows are never feathered, so they stay aligned with the water mask. With the shore
  field (`opts.shore`), the wet code and the shallow/deep line come from the field rather than from the cells. In
  that case non-snow theatres get a damp wet-sand or mud band within 0.8 m of the drawn shore.
- **Rules with fractal thresholds.** Every mask threshold gets an `edgeN` perturbation (2.3 m fBm plus 0.6 m value
  noise), and sand and snow get wind-aligned streak noise. Dark rock outcrops are rare and broken up. Desert
  hardpan is pale dirt with a gravel lag and tongues of drifted sand. Snow `GROUND` is wind-scoured snow with grass
  tips poking through, not a grey blob. The splat blur is 0.5 m (it was 0.9 m).
- **Height blend in the shader.** The blend uses each layer's own height map (×0.9) plus a 1.9 m noise term (±0.35),
  so stones and clumps break across borders.
- **Grass verge.** Tuft placement uses a noise-jittered density (2.8 m and 0.9 m fBm) and
  `smoothstep(0.12, 0.7, g′)`. At the edge, tufts are up to 50 % shorter and more often dry, which gives a ragged,
  flattened and sparser falloff. Grass colour is toned down from B's saturated dark green to olive, and the ground
  under grass is darkened ×0.64 (it was ×0.5).

### 2.5 Theatre looks (T-A grafts)
- **Desert.** Per-layer linear tint multipliers give A's warm North-African sand (`[1.04, 0.90, 0.72]` on dune
  sand). Pebbles on sand (×3 density), low camel-thorn shrubs on open sand, and dry tussocks on scrub.
- **Snow.**
  - A's wind drifts: long ridges across the wind with a sharp lee side, added to B's sastrugi normals.
  - Frozen pond: dark clear ice with a two-scale crack network, trapped bubbles and wind-blown snow dust, at
    roughness 0.06–0.55 and a nearly flat normal.
  - Trampled roads: `preTrample()` drives vehicles along the road in two wheel lanes. The ruts turn into patchy,
    wet, brown-grey slush while the berms stay dirty white. This replaces B's flat grey band.
  - Snow-laden conifers and bare broadleaves are kept from B.
- **Temperate.**
  - A's muddy road: road wetness is 0.55, the road is pre-trampled at 1.25× load, and puddles form in low ruts
    (noise-modulated) with mirror roughness.
  - Stones on the road (×1.6).
  - Wildflowers and weeds are kept from B.

### 2.6 Trails (must-fix 8, 10, plus T-A API)
- **Memory (must-fix 10).**
  - Deformation uses one RG16F render target (R = rut, G = berm) at 16/24/32 texels per metre for
    low/medium/high+ultra. Grass flattening uses an R16F target at ¼ resolution. There is no ping-pong copy.
  - Fading is an in-place multiply blend (`dst *= exp(-Δt/τ_layer)`) every 6 s. This interval is long enough for
    half-float to make progress even with the 2400 s snow life.
  - The 80×60 m demo map needs 4.8 MB at 32 px/m, against about 40 MB for T-B, because it stores 4.1 B/px instead
    of 16.
- **Realism (must-fix 8).** Each stamp carries the ground's **cohesion**: sand 0.3, grass 0.6, snow 0.9, mud 1.
  Cohesion drives:
  - tread-lug crispness (`mix(0.5, pattern, 0.2 + 0.8·coh²)`), so dry sand slumps;
  - "sand spill" tongues that slide back into the rut and bump the berm;
  - crumbling rut walls.

  Every stamp also gets low-frequency track wander (±4.5 cm), width breathing, tread-spacing slip jitter, depth
  noise, worn grouser ends, boot toe-dig and gait jitter. Snow keeps crisp prints, because it is cohesive. Grass
  flattening is clearly readable at zoom 0.75 (darkened, yellowed, pressed tufts).
- **High-level API (T-A graft).** `stampTrail('vehicle', x, z, h, {id, type, speed})` stamps every wheel or track of
  a `car`, `jeep`, `truck` (dual rear tyres), `motorcycle`, `halftrack` (front tyres, rear tracks) or `tank`.
  `'walker'` (also `walk`, `run`, `crouch`) places alternating boot prints at the stride length, with toe-out and
  gait noise. `opts.onSpray({x, z, heading, material, wet, snow, speed, type, id})` fires on soft ground for dust,
  mud or snow-spray VFX. Records carry `visibility` (material print visibility × exp(−age/τ)) and `aiVisible`.
  `record:false` stamps only the visuals, and `recordTrail()` writes only the gameplay record.
- **Heading.** Facing is `(cos h, sin h)` in (x, z), as `docs/ARCHITECTURE.md` specifies. T-A's
  `(sin h, cos h)` convention was not carried over.

### 2.7 Snow glints (must-fix 12)
Glint cells are anchored in world space and are at least 2.5 px wide. The cell size is a power of two in metres,
chosen from `fwidth(worldXZ)`, which does not change while the orthographic camera pans. Each glint is a small
disc inside its cell. The test is `tools/sparkle.mjs`: five renders panned by 0.35 px each. The share of glint
pixels that change between frames (XOR/OR of the glint mask) fell from **0.82 (T-B) to 0.28 (final)**, while the
number of visible glints rose from 1–2 to about 44 px per 720p frame.

### 2.8 Grass budget (must-fix 9)
- Instances are shuffled once per chunk, so any prefix is a uniform subset and `instanceCount` works as a density LOD.
- Density is `clamp(px_per_m / 55, 0.4, 1)`, about 0.56 at the game zoom of 0.75. Chunks beyond 0.85 of the
  half-width of the view get ×0.7 more.
- Blade width is multiplied by `1/√density` to keep coverage.
- Ultra is capped at density 1.15 with 10 blades (it was 1.4 with 12).
- Grass is left out of the GTAO prepass.

Meadow triangles at ultra fell from 9.8–11M to 4.5M, and frame time from 5.12 to 3.93 ms (§5).

### 2.9 Trees (must-fix 6, 7, plus T-A crowns)
- **One `treegen`.** B's species rules and CC0 bark and leaf scans, with T-A's full crowns:
  - **Denser foliage cards.** `tools/build_foliage.py` now adds canopy-fill leaves around the twigs. Broadleaf cards
    go from 10–17 % to about 40 % coverage, so each card reads as a leaf clump, not a skeletal twig.
  - **Crown-shell fill.** Clumped cards are seeded around existing twig leaves on the outer 45 % of the crown, so the
    canopy reads as a full mass from the high camera. They are never placed floating in empty air.
- **Conifers (needle sprays, `src/art/terrain/conifers.js`).** Pines read as flat cardboard clumps under snow
  caps, so conifer crowns were rebuilt from a baked needle-spray atlas:
  - **Atlas.** `tools/render/build_needles.py` draws every needle as a tapered three-strip polygon (cylindrical
    normal) on twigs and side shoots at 4× supersampling: Norway spruce sprays (2 variants), hanging comb curtains,
    the leader spray, Scots and stone pine tufts, and pad rosettes (a branch end seen from above). Colour follows
    needle age (new growth lighter, old needles darker, a few yellowing). `needles.webp` is opaque sRGB albedo with
    the colour bled into the gaps; `needles_n.webp` holds the needle normal (RG) and coverage (B). Both are opaque
    on purpose: the browser's premultiplied canvas decode zeroes the colour of transparent texels, which darkens
    the mips. The shader takes the needle mass (snow fill, AO) and the translucency from blurred mips of B.
    The gap texels hold a darker bleed (`GAP` 0.62 × the needle colour). Under minification the space between
    side shoots then reads as the shaded crown interior, so the shoot structure survives at zoom 2 instead of
    averaging into a soft smear. Scots pine cards are branchlets: a twig with alternating side shoots, each
    ending in its own small brush of paired needles, in a light grey/yellow-green. One big brush per card was about
    three times the size of a real tuft, and from the camera it read as a lobed broad leaf or a dark holly leaf.
  - **Spruce / fir.** Whorled tiers follow a cone. Low limbs sag with up-turned tips. Each limb carries arched spray
    cards (the snow sits on the convex top), hanging comb curtains on spruce, and short inter-whorl twigs. Limb
    tubes end under the outer spray, just below its centre line, so no snow-capped stick shows past the needles.
    Spray length scales with tree height (`H/10`, at least 0.38), so a small tree gets more, smaller sprays and not
    a few tree-sized cards. Curtains only grow on trees over 6 m. Each is cut into narrow two-row strips (about
    0.55 m) with gaps and their own drop, hanging under the limb, because one wide comb read as a flat dark plane.
  - **Clearance floors (`limbClearance`).** Mission trees carry placement floors (`clear`). The walk-under floor
    (1.95 m beyond the trunk's 0.35 m nav reach, clip-2 rule e) binds only the limb **wood**; the needle sprays stay
    where they grew, so a spruce keeps its lowest, widest, snow-laden tiers. An obstacle floor (`crownFloor`) lifts a
    sagging limb onto it with its sprays and drops a limb born under it. Removed parts are generated into a sink, so
    the rest of the tree (and its lean and yaw) is the same tree as without the floors. Every spray of a limb is drawn,
    the outer one too (it runs past the tip and carries the snow; the clip-2 cut dropped it from every limb).
  - **Pines.** Scots (rounded, layered pads), stone/umbrella (forked bole, limbs climbing to a flat canopy) and
    Aleppo (open, irregular). Limbs fork into twigs that end in pads of tufts under a rosette cap. The tufts
    radiate out of the pad with their faces turned to the sky, so a pad reads as a pom-pom of needles. Normals
    are bent per pad, so a pad shades as one cushion and not as separate "leaves". The tufts hold less than half the snow catch
    and the pad cap carries the load, because white flecks on every tuft read as separate leaves.
  - **Per-vertex `aExt`.** Crown AO comes from the radial depth in the tier and the tiers above, with curtains
    darker. The signed snow catch is sky exposure × geometric normal y. The fragment uses
    `max(face·catch, 0)`, so snow loads only the top face of a tier.
  - **Needle material** (`makeNeedleMaterials`, its own draw call per chunk in place of the leaf one):
    - alpha is coverage-preserving (scaled up with the mip level; the pipeline has no MSAA);
    - tangent normals come from screen derivatives;
    - transmission goes through thin needle edges (`1 − mass`), not the dense cores. The forward-scatter lobe is
      wide (`((1 + dot(−L, V)) / 2)²`, with V = (0, 0, 1) under the orthographic camera). From the fixed 40° view,
      a sun behind the trees sits only about 70° off the view axis, where the old `pow(·, 3)` lobe gave about 0.04;
    - snow bounce plus canopy scattering: indirect ×1.45 × AO, plus a green fill of `albedo·sun·0.05·AO`
      (0.4 × that off snow), so shaded skirts over bright snow stay dark green;
    - needle meshes skip the screen-space GTAO prepass (`userData.aoExclude`). Their crown AO is baked per
      vertex. From the 40° camera, GTAO read the stacked tiers as one deep crevice, and the lower skirts went
      near-black (10th-percentile luminance 2 against bright snow);
    - snow clumps sit on the dense spray cores (a coarse mip of the coverage), so the needle fringes stay green.
      A clump is opaque over the gaps between shoots, which used to punch black "ink dashes" through it. Its edge
      is lumpy (world noise at 21 and 47 /m), and it gets a gentle bump normal (the surface-gradient method) from
      a lump height of 1 to 3 cm, taken from the smooth load and not from the needle stencil. Crevices and thin
      edges are greyer, and green needle tips poke out at the edges. Speckle fixes: a fragment kept only by the snow
      body is pure snow (the dark gap-bleed albedo drew ink rims), needle normals fade out under snow, the old
      7 cm bump (slopes of about 3 at 21 to 47 /m) sprinkled one-pixel black facets through the clumps, and the
      needle shadow lookup is taken 12 cm toward the sun against card self-shadowing.
  - **Species by theater** (`art/terrain.js`): snow = Norway spruce 65 % + Scots pine; desert = Aleppo pine;
    coast = stone + Aleppo; elsewhere a Scots / spruce / Aleppo mix. The snow load is per mission (`treeSnow`:
    M1 1.0, M2 0.8, M3 1.15) and defaults to 1 in the snow theater.
  - **Wind.** All sprays of a limb share its phase. Flex runs 0.2 at the trunk to 1 at the tip, so tiers sway as
    units through the shared `vegWind`, with needle flutter on top.
  - **Impostors** are baked from the same needle meshes. A per-instance light gain (`IMP_NEEDLE_GAIN` 1.3, in
    `iDat.w`) stands in for the scattering and translucency the flat atlas cannot carry. The impostor albedo gets a
    4-tap unsharp mask (texels outside the silhouette count as the centre), because the ~1:1 bake looked softer
    than the mesh sprays. In `tests/pines.test.mjs`,
    impostor brightness is within 7 % of the meshes and coverage within 2 %.
  - **Cost.**
    - Average tris per tree, bark included, at high: spruce 6.2 k (was 4.8 k), Scots pine 6.7 k, fir 4.4 k,
      stone pine 3.9 k, Aleppo 3.8 k. Low is about 40–60 % cheaper (spruce 3.7 k, Scots pine 2.7 k, fir 3.0 k):
      no curtains or inter-whorl twigs, fewer and longer sprays, fewer tufts. Limb tubes have 2, 3 or 4 segments at
      low, medium or high, because limbs made up most of a low-preset Scots pine.
    - The draw calls are unchanged: needles replace the leaf mesh in conifer chunks. Only a chunk that mixes
      broadleaves and conifers draws one extra mesh.
    - Measured on M1/M2/M3 at high with `tools/perf/pineshot.mjs --perf`, before/after interleaved on a shared,
      loaded machine. Vegetation was shown and hidden on alternate frames, three runs of 300 frames each. The GPU
      tree cost (timer query) was 0.65/0.87/0.51 ms before and 0.57/0.09/0.44 ms after, inside the run-to-run noise
      of about ±0.5 ms. Draw calls were the same (496/426/287), and the scene tris rose by less than 1 %.
- **Translucency.** Foliage cards are lit with transmission and wrap:
  - diffuse term `albedo·sun·(0.07 + 0.16·back + 0.3·forward-scatter)`;
  - canopy multiple scattering (ambient ×1.3).

  Cards stay green on the shadow side instead of going black.
- **Snow.** Conifers carry a snow load (B's `snowCoverage`). Broadleaves in the snow theatre are leafless.

### 2.10 Forests: impostors and workers (must-fix 11)
- **Unique budget.** `MAX_UNIQUE` is 150/300/400/500 for low/medium/high/ultra.
  - Trees above the budget are ranked by stand density (neighbours within an 18 m window). Hedges, solitary trees,
    designed trees and anything flagged `hero` stay unique. Only forest interiors become impostors.
- **Impostors.** Two prototypes per species (plus bare and burnt variants) are generated.
  - Each prototype is baked from six azimuths at the camera's actual pitch into an sRGB albedo atlas and a
    view-space normal atlas. Tile size is 160/192/224/256 px by preset.
  - The impostors are drawn as one instanced, camera-facing billboard per tree, anchored at the root. The view
    tile is picked by camera azimuth minus the tree's rotation.
  - They are **lit at runtime**, with the atlas normals, by the same sun, hemisphere and IBL as the 3D trees, and
    they cast alpha-tested shadows. There is one draw call per forest.
- **Workers.** `treegen.worker.js` is a module worker, and THREE is injected because import maps do not apply
  inside workers. With 40 or more unique trees, generation runs on up to four workers. Typed arrays are
  transferred back, and new chunks replace old ones only when complete, so nothing pops.
- **Measured.** 1,610 trees built in 0.6–0.9 s on workers: 500 unique and 1,110 impostors, 50–69 MB of atlases.

## 3. Assets and licences

Everything is CC0 / public domain or own procedural work. Nothing is ripped from the original game, and there are
no faces or voices. The per-file record is `scratchpad/terrain/final/ASSETS.md` (inherited from T-B, extended).

| Asset | Source | Licence |
|---|---|---|
| Ground layers: grass | ambientCG **Grass004** | CC0 |
| Ground layers: dry grass, dirt, mud, gravel, sand ×2, wet sand, rock, road, leaves, old snow | Poly Haven **withered_grass, dry_ground_01, brown_mud_02, gravel_floor_02, dense_sand, sand_01, coast_sand_01, rocks_ground_02, rocky_trail_02, forest_leaves_02, snow_03** | CC0 |
| Snow, packed snow | procedural FFT noise (`tools/pack_layers.py`) | own work |
| Ice and slush (snow theatre) | shader-procedural on top of the gravel and road maps | own work |
| Bark | Poly Haven **bark_brown_02, bark_platanus, bark_willow, pine_bark, palm_bark**; ambientCG **Bark012**; birch synthesised | CC0 / own |
| Foliage cluster cards (`assets/foliage.png`, rebuilt denser) | ambientCG **LeafSet004/010/013/022/024/030, PineNeedles001** leaf scans composed by `tools/build_foliage.py`; twigs and palm fronds procedural | CC0 / own |
| HDRIs (demo lighting) | Poly Haven **goegap, kloofendal_43d_clear_puresky, snowy_park_01** (1k) | CC0 |
| Grass tufts, flowers, weeds, shrubs, stones, trail stamps, impostors, snow particles | procedural, own code | own work |
| Water (demo) | `scratchpad/water/final`; see `docs/water-pipeline.md` §6 | CC0 / own |

- **Downloads:** `https://dl.polyhaven.org/file/ph-assets/Textures/...` and
  `https://ambientcg.com/get?file=<id>_1K-PNG.zip` (`tex/dl.sh`, `acg/dl.sh`).
- **ez-tree:** the MIT-licensed `@dgreenheck/ez-tree` was studied but **not** used, because its inlined textures
  have unclear provenance.
- **Shipped size:** about 44 MB including the three demo HDRIs. The largest file is `foliage.png` (8.3 MB, 26 layers × 512²).

## 4. Integration

### 4.1 Renderer (`src/engine/renderer.js`)
Apply `engine/renderer-terrain.patch`. It is a unified diff against the current engine file and adds 72 lines:
- the water post hooks (the same patch as `docs/water-pipeline.md`);
- `import { AlphaAwareGTAOPass } from './gtao-alpha.js'`, used where `GTAOPass` was;
- `envSaturation` and `envWarmth` per theatre, with `gradeEquirect` / `gradeSkyMaterial` applied in
  `_applyEnvironment` and `_skyEnvironment`;
- `bindEnvironment(material, scale)` and `_rebindEnvironment()`.

Copy `engine/gtao-alpha.js` and `engine/env-grade.js` next to `renderer.js`. The public API is unchanged, and
materials that do not opt in behave exactly as before.

### 4.2 `src/art/terrain.js` and `src/world/map-builder.js`
`buildTerrain(grid, theater)` is currently synchronous and returns `{ground, water, update, dispose}`.
`createTerrainHandle` from `src/game-adapter.js` keeps that shape:

```js
// src/art/terrain.js
import { createTerrainHandle } from './terrain/game-adapter.js';   // copy scratchpad/terrain/final/src → src/art/terrain/
export function buildTerrain(grid, theater, ctx = {}) {
  return createTerrainHandle(ctx.renderer, ctx.scene, grid, theater, {
    quality: ctx.quality ?? 'medium', onSpray: ctx.onSpray,          // VFX hook: dust / mud / snow spray
    roads: ctx.mission?.terrain?.filter((t) => t.type === 'path' && t.terrain === 'road')
      .map((t) => ({ points: t.points.map((p) => [p.x ?? p[0], p.z ?? p[1]]), passes: 7, walkers: 3 })),
  });
}
// map-builder.js step 7:
terrain = buildTerrain(grid, theater, { renderer: world.renderer, scene: world.scene, mission });
world.scene?.add(terrain.ground);      // placeholder group; mesh, grass and clutter are parented to it when ready
// terrain.water is null: the final water system owns water, i.e.
//   for (const b of waterBodiesFromGrid(grid, mission)) water.addBody(b);
// Vegetation: createVegetation(world.scene, mission.vegetation.map((p) => ({ ...p, y: terrain.heightAt(p.x, p.z) })),
//   theater, { quality, terrain, renderer: world.renderer.renderer, camera }) after `await terrain.ready`.
```

- **Loading.** The loader awaits `terrain.ready` (texture decode plus splat, about 150–400 ms) and
  `createVegetation`, which builds on workers.
- **`groundAt(x, z).height`.** This can use `terrain.heightAt`. The undulation is at most ±0.35 m, carved to −1.2 m
  under water.
- **Presets.** `terrain.terrain.setQuality(p)` and `veg.setQuality(p)` follow `R.setPreset(p)`. The veg call returns
  a promise, because regeneration runs on workers.

### 4.3 Unit and vehicle trail stamping (world update, once per frame)
```js
terrain.update(dt, camera);                       // trails, grass, snow FX
stampUnits(terrain, world.units);                // boots (walker), crawl furrows, carried-body drags; visuals only
stampVehicles(terrain, world.vehicles);           // every wheel/track by vehicleType (VEHICLE_TRAIL map)
```

- **Visuals.** They are stamped on every soft material, grass included (flattening), with `record:false`.
- **Gameplay records** come from the existing `footprint` event (`wireFootprints(world.events, terrain)`: SNOW,
  SAND and MUD every 0.75 or 1.6 m, `aiVisible` kept). They therefore follow the rules in `CONFIG.stealth.footprint`
  exactly, with no duplicate prints. Vehicle tracks record themselves every 0.6 m as `kind:'vehicle'`, owned by the
  vehicle id.
- **Cost.** A vehicle costs 4–6 instanced stamps per frame, and a stamp batch is one draw call. The fade pass costs
  two full-screen quads every 6 s.

### 4.4 Footprint gameplay query (AI TRACKS §4.8)
```js
const seen = tracksNear(terrain, guard.x, guard.z, 3);   // newest first, aiVisible only, visibility ≥ 0.15
// → [{kind:'foot'|'vehicle'|'crawl'|'drag', x, z, heading, id, age, visibility, material}, …]
```

- **`visibility`** is the material's print visibility × exp(−age/τ). Print visibility is snow 1.0, sand 0.95,
  mud 0.9, grass 0.45, dirt 0.35, road 0.15, gravel 0.08 and rock 0.02. τ is the material's trail life: snow
  2400 s, mud 1800 s, sand 420 s, grass 500 s.
- **Following tracks.** Guards can follow the `heading` chain of records with the same `id`.
- **Unchanged.** `queryTrails(x, z, r, {maxAge, minVisibility, kinds, excludeId, aiOnly})` is the same call the
  prototypes had.
- **Verification.** In the demo, `queryTrails` returns the right material in every theatre (sand, mud or grass,
  snow). `tracksNear` returned the commando print and filtered the `aiVisible:false` one. `tools/probe.mjs`
  exercises the full chain.

## 5. Performance

**Setup.**
- RTX 5090, headless Chromium with ANGLE-GL, 1920×1080, zoom 0.75 (about 64 m wide), the judge's GPU-synced loop
  (`perf2`: N renders with a `readPixels` fence).
- The figures include the preset's `pixelRatio`, shadows, GTAO, bloom and SMAA, plus terrain, grass, clutter, trees,
  the actors and (desert only) the water system.
- The GPU was **shared** with other jobs during the runs (Blender renders, a diffusion model). Each figure is
  therefore the best of 4×40 frames, with the median in brackets (`tools/perf.mjs`, `shots/perfG-*.log`).

| Map (ms/frame) | low | medium (default) | high | ultra | T-B judged (low/med/high/ultra) |
|---|---|---|---|---|---|
| Desert, with the final water system | 0.53 (0.60) | 1.25 (1.32) | 1.45 (1.47) | 1.60 (1.71) | 0.33 / 0.54 / 1.02 / 1.21 (no water) |
| Desert, no water (`water=0`) | 0.37 | 0.65 | 1.15 | 1.34 | same |
| Meadow | 0.73 (0.76) | 1.27 (1.39) | 2.37 (2.42) | **3.67** (3.70) | 0.53 / 0.82 / 2.60 / **5.12** |
| Snow | 0.59 (0.62) | 0.81 (0.93) | 1.64 (1.68) | 2.33 (2.36) | 0.46 / 0.65 / 1.30 / 1.89 |
| Meadow + 1,500-tree forest (500 unique + 1,110 impostors) | 1.40 | 2.61 | 6.87 | 13.07 | not measured |

- **Meadow ultra** (must-fix 9): 4.3M triangles instead of 9.8M, and 3.67 ms instead of 5.12 ms. High costs
  2.37 ms against 2.60 ms before. Low and medium cost 0.2–0.45 ms more than T-B. This is probably the extra splat
  shader work (height-blend noise, the ice, slush and puddle paths) and the richer clutter; it was not profiled
  separately.
- **Snow and desert** cost 0.1–0.4 ms more than T-B at high and ultra. The extras are the ice, slush and glint code,
  the pre-trampled road texture reads and the richer clutter. Water adds about 0.6 ms at medium, the preset where
  the water system's reflections start.
- **Forest.** 1,610 trees at medium cost 2.6 ms. At ultra, 13 ms is dominated by 500 unique trees drawn three times
  (colour, 8192² shadow map, GTAO prepass) at pixel ratio 2. Lower `MAX_UNIQUE.ultra`, or leave leaf chunks out of
  the GTAO prepass (`userData.aoExclude`), if ultra must hold 60 fps in dense forests.
- **Memory.**
  - Trails: 4.8 MB (80×60 m at 32 px/m; T-B used about 40 MB).
  - Impostor atlases: 50–69 MB when a forest needs them (two RGBA8 atlases plus depth).
  - Grass: 47k tuft instances on the meadow map (the LOD draws 40–100 % of them).
  - Tree generation: 0.6–0.9 s for 1,610 trees on four workers, and 40–70 ms for the demo maps.
- **Mid-range GPUs (must-fix 13).** No mid-range card was available to this job. On a GPU about six times slower
  (roughly an RTX 3060 or RX 6600 against the 5090), medium extrapolates to about 5–8 ms and high to 9–15 ms.
  Treat these as estimates that still need a real run. **Medium is the default preset** in the demo, and it should
  be the default in `CONFIG` as well. Ultra is for high-end cards only.

## 6. Known weaknesses

1. **Impostors at close zoom.** Impostors are 192–224 px tiles. At zoom 2.5 and above they look soft next to unique
   trees, and there is no cross-fade when the camera pitch changes (they are baked at one pitch). Their shadows face
   the light, not the geometry. A later step could swap impostors inside the close-zoom view back to meshes, which
   workers make cheap.
2. **Spruce from directly above** still reads as a radial star of drooping branches at zoom 2.5 and above. That is
   close to reality, but sparse on the lower whorls.
3. **Road edges** are ragged at 0.3–3 m, but the demo's roads are still painted by the grid, so their centre lines
   are straight between polyline vertices. Real roads need curved splines from `mission.terrain` paths.
4. **Trail depth does not accumulate.** Stamps use MAX blending, so many passes do not deepen a rut; `preTrample`
   compensates with load 1.25. A heavily used road would need an additive "compaction" channel.
5. **The trail target is still full-map.** At 32 px/m a 240×240 m map is capped at 4096² (17 px/m, 64 MB). Tiled
   on-demand allocation (must-fix 10's second half) is not implemented.
6. **The frozen pond is terrain-only.** It is not linked to `water.sample()`'s `ice` flag. Gameplay must treat snow
   theatre water cells as walkable ice itself, or add a frozen water body.
7. **Mid-range performance is extrapolated**, not measured (§5).
8. **The renderer fixes are in a patched copy.** The project's `src/engine/renderer.js` was not edited, because this
   job may not write project source. The lighting owner must apply `renderer-terrain.patch`.

### 6.1 Art-integration review (game camera, M1–M3)

- **Snow drifts** (`terrain-layers.js undulation`): the T-A ridges were straight, 11 m apart and up to 0.6 m high.
  Under the missions' 15–19° sun they painted map-wide light/dark stripes. They are now domain-warped (curving,
  broken crests) and about half as high. The sun-lit Lambert variation dropped from cv 0.155 to 0.078
  (`tests/unit/art-review.test.mjs`).
- **Open-snow splat**: the old granular-snow layer (`snowold`) and rock appear only as broad, rare patches. At 0.3–1 m
  they read as dirt noise and hid the prints. The snow micro-normal boost was inverted (×0.65) and the sastrugi
  gradient halved: under a grazing sun, lit snow read as brushed fur.
- **Boot prints in deep snow** (`trails.js _steps`): the hole is 1.5× the sole (the walls collapse outward), scaled by
  `mat.snow × soft/0.12`. A 10 cm sole was 2–3 texels on the capped trail RT and vanished. `trails-glsl` scales the
  sole/heel ellipses by `0.2 / fw`. The terrain shades prints bluer and darker (`0.6, 0.7, 0.88`) and adds sky
  occlusion inside ruts (`tbAO × (1 − 0.45·rut·soft)`), so trails also read in shade.
- **Snow on conifer sprays** (`vegetation.js`): leaf coverage is broken into clumps (a noise mask), so the dark green
  shows. Fully frosted crowns read as cotton wool at zoom 2–4.

## 7. Verification (how to rerun)
```
cd scratchpad/terrain/final
node tools/look.mjs L desert,temperate,snow game,trails,road          # look-dev frames → shots/L-*.png
node tools/perf.mjs temperate [&forest=1500]                          # per-preset ms (best-of-4 + median)
node tools/beforeafter.mjs                                           # T-B prototype vs final, same views
node tools/sparkle.mjs                                               # glint stability while panning
node tools/probe.mjs "theater=snow" "<js>"                           # any in-page assertion (adapter, queries)
```
The WebGL context was never lost in any run. There were no page errors; the only console noise was the favicon
404.

## 8. The judge's must-fix list

| # | Item | Status |
|---|---|---|
| 1 | Alpha-tested foliage in GTAO | Fixed in the renderer (`AlphaAwareGTAOPass`, §2.1). `patchGTAO` and `attachRenderer` removed. No black squares, even without `veg.update()` |
| 2 | Blue env / `environmentIntensity` override | Fixed in the renderer: environment grade plus `bindEnvironment` (§2.2). `applyAmbientBalance` dropped |
| 3 | Water vs undulating ground | Carved bed and flat ice (§2.3). The stub plane is replaced by the final water system |
| 4 | Hard blob patches | Warped lookup, feathered noise-thresholded masks, height blend with noise (§2.4) |
| 5 | Grass/road transition, saturated green | Ragged verge, shorter/drier/sparser edge tufts, toned colour (§2.4) |
| 6 | Conifers: star, black clumps, teal | Golden-angle umbrella pines with shell tufts, green denser needle cards, translucency, env grade (§2.2, §2.9) |
| 7 | Sparse broadleaf crowns | About 40 % coverage cards, crown-shell clumps, translucent cards (§2.9) |
| 8 | Trail realism | Cohesion-driven slump and spill, wander, jitter, depth noise; A's API; readable grass flattening (§2.6) |
| 9 | Meadow grass budget | Shuffled-prefix LOD by zoom and distance, ultra cap, no AO prepass: 9.8M to 4.3M triangles, 5.12 to 3.67 ms (§2.8) |
| 10 | Trail texture memory | RG16F plus ¼-resolution R16F, in-place fade: about 40 MB to 4.8 MB. Tiling not done (§6.5) |
| 11 | Forests | Unique budget, lit impostors from baked prototypes, worker generation (§2.10) |
| 12 | Snow sparkle flicker | Footprint-sized, world-anchored cells; flicker 0.82 to 0.28 (§2.7) |
| 13 | Mid-range perf, medium default | Medium is the default; RTX 5090 numbers measured, mid-range extrapolated (§5, §6.7) |
