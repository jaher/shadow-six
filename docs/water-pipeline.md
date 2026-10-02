# Water pipeline (final)

SHADOW SIX renders every sea, harbour, river, reservoir, lake and fjord with one water system, built for the fixed
high 3/4 orthographic camera. Its base is prototype W-A (an FFT ocean composited inside the engine's
post-processing), with grafts from W-B: lace foam, shadow-aware caustics, bed capture and flow fields, ripple
behaviour, the `sample()` API, turbidity presets and a fully frozen option. It also fixes all 12 must-fix items from
the water judge's verdict.

**Status.** The module works and was checked headless on the RTX 5090 (`--use-angle=gl`). It rendered all scenes
and presets without losing the WebGL context, and without console errors or 404s. The engine hook, preset
switching, `dispose()`, `sample()`, the late-FX layer, the ripple walls and exact time periodicity were all tested
from scripts (see **Verification**).

**Integrated (art integration step 3).** The module now lives in `src/art/water/` (textures in `assets/water/`,
licences in `assets/water/LICENSE.md` and `CREDITS.md`); the game adapter is `src/art/water.js` and is described
in §10 below. The R&D copy stays in `scratchpad/water/final/`, laid out as follows:

| Path | Contents |
|---|---|
| `src/water/index.js` | `createWater()` / `WaterSystem`: bodies, frame update, reflections, lights and shadows, `sample()`, quality |
| `src/water/passes.js` | `DepthStashPass`, `WaterPass`, `LateFxPass`, `FX_LAYER = 11`, `ensureDepthTextures()` |
| `src/water/material.js` | Surface shader (GLSL; linear HDR out), `TIME_LOOP = 256` |
| `src/water/fft.js` | GPU FFT ocean cascades (Stockham, JONSWAP, quantised dispersion, `FFT_PERIOD = 256`) |
| `src/water/caustics.js` | Caustics from the detail cascade (area-ratio / Jacobian texture) |
| `src/water/ripples.js` | Interactive ripple simulation, with an environment render (walls, shallows, current) |
| `src/water/bake.js` | Per-body CPU bake: current, foam/turbulence, depth, and distance to shore |
| `src/water/fields.js` | From W-B: bed capture, chamfer distance transform, pressure-projection flow, wake foam |
| `src/water/grid.js` | `waterBodiesFromGrid()`: nav-grid water cells → bodies |
| `engine/renderer-water-slot.patch` | Proposed engine change: `addPostHook('afterWorld' \| 'afterAO')` (applies cleanly to `src/engine/renderer.js`) |
| `engine/renderer.js` | Patched copy used by the demo (only the config import path differs) |
| `tex/` | Runtime textures with their licences (`tex/LICENSE.md`) |
| `demo/`, `tools/` | Demo (`?scene=harbor\|river\|lake\|fjord&light=day\|overcast\|night\|snow\|dusk&preset=…`) and headless tools |

The module should move to `src/art/water/` with `tex/` next to it, or be given `opts.textureBase`.

Screenshots at 1920×1080, `high` preset:

- `docs/screenshots/water-final-harbor.jpg`
- `docs/screenshots/water-final-river.jpg`
- `docs/screenshots/water-final-fjord.jpg`

## 1. API (the `createWater` contract is unchanged)

```js
import { createWater, FX_LAYER, waterBodiesFromGrid } from './water/index.js';
const water = createWater(engineRenderer, scene, camera, { quality: 'high', envMap: hdrEquirect, envIntensity, envRotation });
water.addBody({ type: 'river', polygon: [[x, z], …] | mask: (x, z) => bool, level: 0, depth: 2,
                preset: 'river',            // or look: …, one of sea harbor lake river fjord reservoir clear muddy
                flow: { dir: [1, 0], speed: 1.2, centerline: [[x, z], …] }, obstacles: [{ x, z, r }],
                bed: (x, z) => y,           // optional; otherwise the scene is captured from above
                ice: 3,                     // shore ice shelf width (m); frozen: true = fully frozen surface
                surf: { amp: 0.22, length: 7, period: 6.5 }, turbidity, foam, sheen, capture: true });
for (const b of waterBodiesFromGrid(grid, mission)) water.addBody(b);   // nav-grid water cells
water.disturb(x, z, strength, radius, foam);  // splashes, swimmers, boat bow and prop wash, bodies falling in
water.update(dt);                             // once per frame, BEFORE engine.render()
water.sample(x, z) → { depth, flow: [vx, vz], level, type, shore, ice, body } | null   // gameplay queries
water.depthAt(x, z) → metres | -1
water.setQuality('low' | 'medium' | 'high' | 'ultra'); water.setSea({ wind: 14, chop: 1.6 }); water.dispose();
particle.layers.set(FX_LAYER);                // smoke, spray and muzzle flashes that must draw OVER water
```

- **Capture tags.** Objects with `userData.waterIgnore` or `userData.dynamic` (soldiers, boats, vehicles) are
  left out of the bed capture. The terrain mesh should carry `userData.waterTerrain`, or be passed as
  `opts.terrain`, so that solid obstacles embedded in it can be detected.
- **Debug views.** `opts.dbg` shows one layer of the shading: 1 = raw bed, 2 = bed with caustics, 3 = reflection,
  4 = no caustics, 5 = no refraction offset, 7 = foam, 8 = sun visibility, 9 = specular, 10 = refraction,
  11 = lit foam.

## 2. Frame pipeline and integration with `renderer.js`

```
water.update(dt):  FFT cascades (sea 97 m, detail 21 m) → caustics → ripple env + ripple steps (60 Hz)
                   → lights/shadow uniforms → planar reflection per water level (mirrored ortho camera, clip plane)
engine.render():   RenderPass(world) → decals → [afterWorld] DepthStashPass → GTAO
                   → [afterAO] WaterPass → LateFxPass → bloom → OutputPass (tone map) → SMAA/FXAA → overlayScene
```

- **Official engine hook (must-fix 2).** `engine/renderer-water-slot.patch` adds `renderer.addPostHook(slot, fn)`
  with two slots:
  - `afterWorld`: world colour and depth are in the read buffer.
  - `afterAO`: before bloom and tone mapping.

  Each `fn(composer, passes, renderer)` returns the passes to insert, and is re-run on every composer rebuild,
  such as a preset change. The patch changes about 40 lines and nothing else. `createWater` uses the hook when it
  exists. Until the engine owner merges the patch, the water system falls back to a shim that wraps
  `_buildComposer` once to produce the same chain (`water.hookMode === 'official' | 'shim'`). Both modes were
  tested through `setPreset(low → ultra)`, `setQuality`, `addBody` / `removeBody` and `dispose()`; `dispose()`
  restores the original chain.
- **No ambient occlusion on water (must-fix 3).** `DepthStashPass` copies the world depth into an R32F target right
  after the world render. This includes alpha-tested foliage but not decals. The water is then composited after
  GTAO, so GTAO never sees it and cannot darken the surface, while the bed under the water keeps its AO. The
  `WaterPass` copies the AO'd colour, restores the stashed depth with `gl_FragDepth`, and draws the water scene
  depth-tested against the world. Soldiers wading, piers and hulls therefore occlude the water correctly.
- **Transparent objects after the water (must-fix 4).** Objects that live only on `FX_LAYER` (11) are drawn by
  `LateFxPass` after the water, into the same colour and depth buffer. They are depth-tested against the world and
  the water, get no AO, and are still bloomed and tone-mapped. Lights are auto-enabled on that layer.
  - Test: a smoke puff drawn over the harbour came out at (205, 204, 200) with `FX_LAYER`. The same puff on
    layer 0 was painted over by the water, at (38, 68, 62).
  - Recommendation: the engine should adopt `LateFxPass`, or its own late-transparent pass, for maps without water.
- **Planar reflections.** One render per distinct water level, up to 0 / 1 / 2 / 3 levels by preset, at
  0.35–0.75× resolution. The camera is the mirrored ortho camera, with a clip plane at the water level. The shadow
  map is frozen during this render (`autoUpdate` is restored afterwards). Where nothing is reflected, the shader
  falls back to the HDRI sky. `FX_LAYER` objects are not reflected.
- **Sun shadow map.** The water samples the engine's PCF sun shadow map (`sun.shadow.map.depthTexture`, a
  `sampler2DShadow`, 3×3 taps) at two places:
  - at the surface, which gates sun glints, foam lighting and crest SSS;
  - at the bed, which gates caustics.

  The result: no caustics and no sun glitter in the shadow of piers, bridges, quays or hulls.
- **Order of calls.** Call `water.update(dt)` before `engine.fitShadowToView()` / `engine.render()`. The water uses
  the previous frame's shadow matrix for its reflection pass, and the current frame's shadow matrix for
  compositing, because the world render updates it first.

## 3. Techniques

- **Waves.** Two GPU FFT cascades (Tessendorf, JONSWAP spectrum with a directional spread, finite depth) give
  displacement, normals and a folding term for whitecaps.
  - The sea gets both cascades as vertex displacement.
  - Rivers and lakes use the detail cascade as normals only, flow-mapped in rivers, plus `waternormals.jpg`
    micro detail.
  - Surf is an analytic shoaling wave driven by the depth field (Green's-law growth, breaking where H/d ≈ 0.78).
- **Long sessions (must-fix 9).** FFT dispersion is quantised to multiples of 2π/256 s, which makes the ocean
  exactly periodic. Every other animated term (flow-map phases, texture scrolls, surge lines and surf periods) also
  divides 256 s, and the CPU wraps the shader clock.
  - The large-scale roughness noise, which used to be offset by `flow·time` and sheared, is now two-phase
    flow-advected.
  - Tested: frames at t and t + 256 s are bit-identical, and so are frames at t = 10⁶ s and 10⁶ + 256 s.
- **Bed and flow data (W-B graft).** `addBody` captures the scene from above, over the body's bake grid, in three
  passes:
  1. The bed below `level + 0.35 m`, so bridge decks are cut away.
  2. The unclipped top, used where nothing is below.
  3. Closed solids crossing the surface, with the terrain hidden: back faces seen through the clip plane mark an
     obstacle, such as a pier, rock or hull.

  The capture takes about 7–27 ms. Its results feed the rest of the bake:
  - **Depth:** from `bed(x, z)` when given, else from the capture, else from a bank heuristic.
  - **Distance to shore:** a chamfer transform that treats solids as dry.
  - **River current:** A's centreline and bank-drag model, then W-B's pressure projection around the captured
    solids. Checked at the river bridge pier: 0.76 m/s upstream of the pier against 1.66 m/s alongside it.
  - **Wake streaks:** advected downstream (W-B), plus A's upstream-traced obstacle streaks.
- **Ripples (must-fix 7, W-B graft).** A 64 m window of the linear wave equation follows the camera. Each step
  reads an environment texture (depth and current) splatted from every body's bake, so that:
  - dry cells, banks and captured piers or quays are reflecting walls;
  - wave speed is min(c_deep, √(g·d)), so ripples slow in the shallows;
  - the state is advected with the current (semi-Lagrangian).

  Ripples now feed the surface normals only, never the vertices, so they no longer alias on the 0.75 m mesh or
  cross banks. Tested: a quay cell stays at 0 while a ring spreads at about 1.1 m/s.
- **Boat wakes.** The ripple texture is (height, velocity, wash foam, crest foam). Wash foam (.b) spreads and
  decays slowly (half-life about 1.6 s): the trail astern, splashes, paddle strokes. Crest foam (.a) never spreads and
  decays in about 0.25 s; `crest()` dabs it as capsules between a boat's Kelvin crest particles, so the V arms stay
  crisp lines that follow the particles out at tan 19.47°·v and downstream with the current. Up to 48 dabs per step.
  The look per theatre is in `docs/screenshots/raft-wake-*.jpg` (`node tools/water/raft-wake-shots.mjs`).
- **Optics.**
  - Screen-space refraction with a foreground-leak guard.
  - Beer–Lambert absorption along the view path and the sun path, with (absorption + turbidity) per RGB channel,
    plus in-scatter.
  - Schlick Fresnel.
  - GGX sun and point-light glints (the lamp glints form long reflections at night).
  - Crest SSS on the sea.
  - A soft shoreline fade, and fog.
- **River at game distance (must-fix 10).** The reflection is averaged over three sub-pixel facets, N and N tilted
  by ±σ, where σ is the unresolved slope variance. σ grows with the pixel footprint and with the wind-ruffled
  patches, a Toksvig-like approach. The GGX lobe is widened by the same σ, and `sheen` is 1.6 for rivers.
  - Unresolved ripples reflect brighter, lower sky, so a river reads as moving water rather than flat dark green,
    while the roughness patches (cat's paws, slicks) are advected with the current.
  - This is still physically based, at about 2–3 % Fresnel for a flat surface at 55°.
- **Caustics (must-fix 8, W-B graft).** Caustics are projected along the refracted sun ray onto the bed and blurred
  with depth.
  - They are gated by the shadow map at the bed and by `directFrac`, the sun's share of the bed lighting, so they
    modulate only the direct light. They are also dimmed at night.
  - In rivers they are two-phase advected with the local current.
- **Foam (must-fix 5, W-B graft).** Foam is built from W-B's histogram-equalised lace texture and a coverage
  threshold, and it is never fully opaque (at most 0.65 in rivers and 0.82 elsewhere, since foam is aerated
  water). Its edge widens with the pixel footprint, so it does not look cut out at close zoom. Sources of coverage:
  - a contact line that hugs banks, piers and rocks, using the distance field;
  - W-B's surge lines running up beaches;
  - per-pixel surf crests (the old per-vertex version caused the blocky clumps);
  - FFT whitecaps;
  - ripple and wake foam;
  - obstacle streaks.

  River foam is advected and stretched about 2.2× along the local current, and broken up by fbm noise into thin
  streaks.
- **Night (must-fix 6).** A `night` factor is computed from the key-light level.
  - Foam is lit only by moon, sky and lamps, at 0.55× albedo and 0.7× coverage, so it reads as dull grey and never
    glows.
  - The moon's glint cap falls from 400 to 25, because an orthographic camera spreads glitter over the whole
    screen.
  - The bed fades 2.2× faster at night (art direction), so harbours read as dark mirrors with lamp glints.
- **Ice.**
  - **Shore shelf** (`ice: width`): snow-covered old ice at the bank, then clear black ice, floes, slush and a
    crack network. The cracks are cell walls of the lace texture under a noise mask, not a grid.
  - **Fully frozen** (`frozen: true`, from W-B): wind-drifted snow patches over clear ice, with GGX glints on
    the ice.

## 4. Presets

| Quality | FFT N | Sea cascade | Caustics | Planar reflection levels × scale | Ripple grid | Sea mesh segment | Bake grid |
|---|---|---|---|---|---|---|---|
| low | 64 | no | off | 0 (HDRI sky only) | 256² | 1.67 m | 128 |
| medium | 128 | yes | 256² | 1 × 0.35 | 256² | 1.25 m | 192 |
| high | 256 | yes | 512² | 2 × 0.5 | 512² | 1 m | 256 |
| ultra | 256 | yes | 512² | 3 × 0.75 | 768² | 0.67 m | 320 |

Optical presets: `sea`, `harbor` (turbidity 0.1), `lake`, `river` (sheen 1.6), `fjord`, `reservoir`, `clear`
and `muddy` (turbidity 0.9). The last two are W-B's turbidity looks converted to this module's absorption and
scatter model; W-B's `river`, `sea`, `harbor`, `fjord` and `reservoir` looks map to the existing presets.

## 5. Integration with the nav grid's water cells

`waterBodiesFromGrid(grid, mission, opts)` reads `grid.terrain` (`T.WATER = 5`, `T.SHALLOW = 6`, `CELL = 0.5 m`)
and returns one `addBody` descriptor per 4-connected water component:

- **Outline:** the exact cell mask, `mask(x, z)`, plus the component's bounding polygon. The bake turns the mask
  into a signed distance to the bank with a chamfer transform.
- **Type:**
  - `sea` if the component touches the map edge on a `coast` theatre, or covers more than 25 % of the map;
  - `river` if `mission.water.velocity > 0` (the current comes from `angleDeg`);
  - `lake` otherwise.
- **Depth:** 2.5 m if deep cells are more than 20 % of the component, else 0.8 m. This is only a fallback,
  because the capture reads the real bed from the terrain mesh.
- **Other fields:** `bankWidth` comes from `mission.shoreShallowWidth`, and `foam` from `mission.water.turbulence`.

Tested on a 240×240 grid with a winding river: it produced one river body in 39 ms, the depth came from the
captured terrain, and `sample()` returned the current.

Gameplay should use `water.sample(x, z)` for swimming, wading and drifting (`depth`, `flow`, and `ice` for walkable
ice) and emit `unit:water` events. Visual splashes and wakes go through `water.disturb`. The art terrain module
(`buildTerrain`) should then return `water: null`, because this system owns the water surface.

## 6. Assets and licences

All runtime textures are in `tex/`; `tex/LICENSE.md` records each one.

| Asset | Origin | Licence |
|---|---|---|
| `waternormals.jpg` | three.js examples | MIT (full notice kept in `tex/LICENSE.md`) |
| `foam.png` | Generated by `tools/foamtex.py` (W-A) | CC0 |
| `gen/*` (lace foam, noise, ripple, caustics and wave atlases) | Generated by `tools/gen_textures.py` (W-B) | CC0 |
| `foam2.png` (the one used at runtime) | `tools/mergefoam.py`: R = W-B lace, G = W-A mask, B = W-B noise | CC0 |
| Demo HDRIs and PBR textures | Poly Haven (CC0), ambientCG `Grass004` (CC0) | CC0 (demo only) |

No NC, ND or ripped assets are used, and no generator model is involved.

## 7. Performance

Milliseconds per frame, measured over 90 frames with a synchronous readback after each (the demo's
`window.perf`), on an RTX 5090 with headless Chromium (`--use-angle=gl`) at 1920×1080 CSS pixels. "No water"
disables `WaterPass` and skips `update()`.

At **deviceScaleFactor 2**, so each preset runs at its real pixel ratio (low 1, medium 1.25, high 1.5, ultra 2;
ultra renders 3840×2160). This is must-fix 11. The GPU was idle.

| Scene | low | medium | high | ultra |
|---|---|---|---|---|
| Harbour, whole frame (no water) | 1.66 (1.58) | 1.91 (1.24) | 4.01 (3.19) | 5.68 (4.66) |
| River, whole frame (no water) | 1.20 (0.88) | 1.58 (1.07) | 2.91 (2.22) | 5.05 (4.07) |

At DPR 1, harbour: low 1.42 (1.12), medium 1.79 (1.08), high 2.47 (1.96), ultra 2.76 (2.04). Another process was
using the GPU at about 60 % during this run.

- **Water cost:** 0.1–0.7 ms at 1080p and about 1.0 ms at native 4K ultra. That covers the FFT, caustics, ripples,
  the planar reflection render(s), the depth stash and the full-screen composite.
- **CPU:** 0.1–0.5 ms per frame in `update()`.
- **`addBody`:** about 20 ms, of which the capture is 7–27 ms and the rest is bake, flow projection and wake foam.
  It runs at load time only.
- **Scaling with map complexity:** unlike W-B, there is no extra scene render for refraction, because the water
  reuses the composer's colour and the stashed depth. The planar reflection is the one pass whose cost grows with
  the map (limited by `reflection` levels × `reflScale`).

## 8. The judge's must-fix list

| # | Item | Resolution |
|---|---|---|
| 1 | Vertical streak bands | **Root cause: the demo's terrain, not the water.** Found by switching off, in turn, the caustics, the bed and the refraction (`?dbg=1` showed the bands in the raw bed). There were three causes. (a) The demo's `fbm` was a sum of sin·cos products, which made grid-aligned ridges; it is now value noise with rotated octaves. (b) The terrain normal map was sampled at world XZ while three.js built its TBN from the mesh UV, whose V is flipped, so the relief along Z was inverted and made bands aligned with the sun; the TBN now uses the same world UV. (c) The `aerial_sand` tile has a dark blob in every tile, so the harbour bed now uses `dense_sand` with anti-tiling. The band metric (`tools/bands.py`) went from 1.85 to 1.0. **Engine terrain must use the same UV for normal-map sampling and for its tangent frame.** |
| 2 | Engine hook | `addPostHook('afterWorld' \| 'afterAO')` patch, with a shim fallback |
| 3 | AO over water | Water is composited after GTAO, using the stashed world depth |
| 4 | Transparent objects under water | `FX_LAYER` + `LateFxPass`, verified by pixel readback |
| 5 | Foam | W-B lace, thin advected river streaks, fbm breakup, footprint-soft edges, capped opacity, per-pixel surf |
| 6 | Night foam | `night` factor dims foam; moon glint cap; night murk |
| 7 | Ripples | Normals only; walls, shallow-water speed and current drift from the environment texture |
| 8 | River caustics | Two-phase advection with the current |
| 9 | Long sessions | Quantised FFT with a 256 s loop, all terms periodic, clock wrapped on the CPU (bit-identical frames) |
| 10 | River at distance | Three-facet unresolved-slope reflection plus a widened GGX lobe, `sheen`, ruffle patches |
| 11 | Ultra perf | Measured at `deviceScaleFactor: 2` (table above) |
| 12 | Licences | `tex/LICENSE.md` keeps the MIT notice; W-B's generated textures are recorded as CC0 |

## 9. Known weaknesses and next steps

- **Glitter under an orthographic camera.** The view direction is the same for every pixel, so sun and moon
  glitter spread evenly over the screen instead of forming a glitter path. The caps and the night factor hide
  this, but a low sun behind the camera is not true to life.
- **Shore foam at close zoom.** It still reads as separate patches rather than continuous swash, and it has no
  foam advection by the surf's run-up or backwash.
- **Boat wakes.** They come from ripple sim plus `disturb` foam only, which gives roughly a V shape. A proper Kelvin
  wedge, or a wake particle trail, would be better for U-boats and patrol boats.
- **Thin obstacles.** Posts under about 0.5 m are not captured at bake resolution, so they get no flow deflection
  and no ripple walls. Pass them in `obstacles` if they matter.
- **One ripple window.** A 64 m window follows the camera, so a disturbance off-screen is lost. Multiple levels
  share one window placed at the first body's level.
- **Reflections.** Planar reflections exclude `FX_LAYER` objects. The low preset has only the HDRI sky, so piers
  and hulls are not reflected.
- **Night.** At night the demo's sand bed is lit by a grazing moon and is strongly textured. The night murk hides
  most of it, but mission lighting should keep the moon above about 30°.
- **Engine owner actions:**
  1. Apply `engine/renderer-water-slot.patch`.
  2. Adopt a late-transparent pass for maps without water.
  3. Tag terrain (`userData.waterTerrain`) and dynamic objects (`userData.dynamic`).
  4. Make sure terrain normal maps use consistent UVs.
- **Not done:**
  - underwater view for divers (the camera never goes below the surface);
  - rain rings;
  - boat hull buoyancy (gameplay can use `sample`, plus the FFT height readback that `fft.js` could expose);
  - an audio hookup.

## Verification (how to rerun)

```
cd scratchpad/water/final && python3 -m http.server 8741 &
node tools/shot.mjs name='scene=harbor&light=night&preset=high'       # PNG → shots/, reports context loss + errors
DPR=2 PERF=1 node tools/shot.mjs p='scene=river&preset=ultra'           # timing at the real pixel ratio
node tools/probe.mjs 'scene=harbor&fx=1' '<js expression>'              # API and pixel probes (FX layer, ripples, sample)
python3 tools/bands.py shots/*.png                                      # vertical-banding metric
tools/check.sh                                                          # syntax check of all modules
```

## 10. Game integration (`src/art/water.js`)

- **Build.** `map-builder` → `buildWater(renderer, world, grid, mission, theater)` after the terrain is ready (real
  terrain only), before units spawn, so the bed capture sees the carved ground, piers, rocks and hulls of the map but
  no soldiers. The map handle's `ready` also awaits `system.texturesReady` (foam/normal textures decoded before the
  first frame). `buildTerrain(..., {ownWater: true})` returns `water: null`; if the water build throws, the flat
  masked placeholder plane is used instead.
- **Bodies.** `waterBodyDescriptors` wraps `waterBodiesFromGrid` with the surface at `WATER_LEVEL = -0.1 m` (terrain:
  shallow bed -0.35 m, deep -1.2 m), the theatre preset (snow: `fjord` still water, `clear` rivers; desert rivers
  `muddy`; coast/night lakes `harbor`), a shore ice shelf on the Norway snow maps (`iceShelfWidth`: 2.6 m on still
  water, down to 0.6 m on fast rivers; M1 2.6, M2 1.8, M3 1.3), `frozen: true` when `mission.water.frozen`, and surf
  on non-snow seas. Mask bodies use their bounding box as the mesh; texels more than ~0.7 m outside the water cells
  are discarded (`maskCut`), so land dips inside the box never show water.
- **Banks.** The terrain carve now follows a bilinear signed distance to the wet/deep cells (`cellSignedDistance`,
  `carveDepth` in `src/art/terrain/terrain.js`), and the bake blurs its shore distance twice, so shorelines and ice
  edges are smooth lines instead of the 0.5 m cell staircase. The cell signed distance is evened out along the edge
  (`smoothSigned`: a ~1.5 m tent blur on the edge cells only, every cell keeping its side) so a bank running at a
  shallow angle to the grid (one 0.5 m jog every few metres, the M3 pool below the dam) carves a straight line; the
  shore ice ends where the bank rises out of the water (the per-pixel bed depth), not at the body's cell mask.
- **Interaction.** `WakeTracker` (per displayed frame, in `mapHandle.frame`, before `engine.render()`): swimmers,
  waders and divers emit alternating-sign strokes with foam; boats emit a bow wave, churning prop/paddle wash and two
  Kelvin shoulders every frame; entering the water (a commando wading in, a body falling in, a raft launched) and
  dying in it splash (ripple ring + `fx.spawn('splash')`). Events: grenade/charge/barrel `explosion` in water →
  water column (-0.6 m, foam 1) + ring of secondary drops + a large splash; `projectile:bounce` in water → splash;
  missed `shot` into water → spout; `unit:water` dive/surface/row → rings.
- **Dry hulls** (`src/art/water/hulls.js`). The surface is one sheet depth-tested against the world, and an open
  boat's floor sits at the waterline (raft floor +2 cm, rowboat floorboards +3 cm over a bilge below it), so as a
  hull bobbed (±5 cm), pitched and rolled, or a swell / surf crest ran under it, the water came up through the floor
  and the men sitting there looked as if they sat in water (M2: floor flooded in ~43 % of frames). Every frame
  `frame()` hands the water the boats as drawn (`dryHullOf`: the visual's world matrix, so bob, pitch, roll and the
  berth offset are included; nearest 8 to the view) and the shader (a) discards water fragments inside each hull's
  waterline plan, taken in the hull's frame at the fragment's height (a two-sided superellipse per library type,
  fitted inside the outer skin: the raft's tube centreline, the rowboat's lines from -10 to +25 cm with their flare,
  the decked patrol / fishing boats 8 cm down; the mini-sub runs awash and stays wet), and (b) lays the wave / surf
  displacement down round each hull in the vertex stage (still within 0.3 m of its waterline box, full waves 1.8 m
  out; the normals keep the waves' shading), since the hulls do not heave with the sea — no crest stands over a side
  tube. Wrecked or deflated hulls take water. GPU test: `tests/boat-dry-hull.test.mjs` (flat-magenta water, floor
  pixels read back every frame: M2 raft, M13 raft at sea, M14 rowboat).
- **Layering.** `lateDecals: true` moves the ground-decal pass after the water (vision cones and markers stay readable
  over rivers); FX spawn on `FX_LAYER` (`world.fx.lateLayer = 11`); `LateFxPass.roots` scans registered roots
  (`handle.addLateRoot`) every frame so a splash or smoke puff over the water draws on its first frame.
- **Fixes made while integrating.** No water draw before the first `update()` (a briefing frame bound unset inputs:
  GL sampler-type mismatch); planar reflections are skipped until the sun's shadow map exists; ripple foam weighs
  more in the foam coverage (`smoothstep(0, 0.5, rFoam) × 0.9`) so wakes read at game zoom; `dbg = 12` shows
  (ripple foam, coverage, lace density).
- **Tests.** `tests/unit/water-integration.test.mjs` (descriptors, ice/presets, M1–M3 grids, WakeTracker, FX layer,
  assets/credits) and `tests/water.test.mjs` (GPU: M2 build, hook order, `sample()`, wakes, grenade splash on the late
  layer, all presets without GL errors). Screenshots: `docs/screenshots/int-water-m1-fjord-swimmer-grenade.jpg`, `int-water-m2-river-boat-wake.jpg`,
  `int-water-m3-river-swimmer-grenade.jpg` (high preset, 1280×720).

- **In-game cost** (RTX 5090 headless, 1280×720 CSS px, preset pixel ratios, frame ms with a sync readback, water
  off → on; noisy, ±0.5 ms): low M2 1.6 → 1.8, M3 1.6 → 2.8; medium 1.9 → 2.3, 1.5 → 2.8; high 1.9 → 3.4,
  2.6 → 5.5 (the planar reflection re-renders the map, grass included); ultra 3.4 → 3.6, 4.3 → 4.9. CPU
  `frame()` 0.1–1.0 ms; build (capture + bake) 50–125 ms at load.

## 11. Water down the M3 dam (`src/render/dam-water*.js`, `src/render/dam-flow.js`)

The dam's falling water is drawn on the late FX layer on top of the water surface (the river body stays the
system's). The user asked for it to be "as realistic as possible"; reference notes (overflow spillways, plunge
pools, hydraulic jumps, tailwater, winter low flow) drove these choices. From a high oblique camera, the eye reads
motion at the right speed, stretching along the flow, a dark-to-white gradient down the fall, and spray at the foot.

- **Spillway sheets (`dam-water-mats.js` SHEET_FRAG).** The pattern is advected in *travel time*,
  `τ(s) = (√(v0² + 2gs) − v0)/g` (s = fall from the lip), so the water accelerates down the face and every feature
  stretches with the fall. At the top is a smooth glassy laminar sheet: sky reflection, streamwise striations, ridge
  glints and fast, broken Kelvin-Helmholtz ripple bands (~13 per second of travel time, from value noise, so they
  come at irregular spacings and never read as a ladder). A faint milky stage comes
  next. From the aeration inception point (3.9 m down the 5.4 m gate sheets, so that the transition is on screen:
  the camera never sees the crest), white fingers lengthen with the fall and merge into opaque streaked white water
  (alpha 0.9–1). The edges neck in and break into fingers that shed droplets. At the foot, an opaque, ragged
  impact band on the same clock meets a splash-crown ribbon (white water thrown up about 0.2–0.6 m, torn into jets),
  and the pool's boil and foam extend two cells under the curtain, so sheet and pool overlap without a seam. Trickles use the same clock (a clinging glassy film with droplet packets). A splash zone of
  spray-soaked dark concrete with a rime fringe, the wet streaks, the frozen trickles and the icicles stay.
- **Flow bake (`dam-flow.js`, ~0.2–0.4 s at load).** A 2D *stable-fluids* solver on a staggered 80×80 grid (0.7 m
  cells, in the dam frame) over the pool and river. The water mask comes from the nav grid's water/shallow cells
  downstream of the face's foot. The solver runs semi-Lagrangian advection, bank drag (a fast core and slow edges)
  and eddy viscosity, then SOR pressure projection with *mass sources*:
  - the boil where the plunging jet comes back up;
  - a sink at the face, so the **roller** runs back to the wall (−1.3 m/s at the surface);
  - entrainment sinks beside the jet, so the corners answer with **side eddies**;
  - the jet's downstream push.

  The final field is exactly mass-conserving (`div = sources`; unit-tested at < 1 % of |v|/h). It is scaled so
  that the core runs at 1.5 m/s. Two scalars are then advected through it to steady state: *foam* (22 s life:
  carried and thinned down the river, collecting in slack water) and *aeration* (2.2 s: the white boil and the
  jump). The result is uploaded as a half-float RGBA texture (current, foam, aeration). Foam and aeration are
  blurred over the water cells first (σ 2.2 m across, 1.1 m along the stream): advected without diffusion, they
  end on a straight line along the jet's flanks, which drew the boil as a box with ruler-straight sides. The
  shader also reads them through a ragged, slowly breathing warp (up to ~2 m across, ~0.8 m along), so the
  boil's flanks fray irregularly into the slack water.
- **Pool shader (`dam-water-pool-glsl.js`).** It is drawn on a mesh over the water cells only, with premultiplied
  alpha.
  - **Foam (`dam-water-foam.js`).** The foam is a persistent field on the GPU: ping-pong half-float targets
    (512×672 over the pool and the first ~40 m of river, 6 cm texels). Every 1/15 s it is advected by the baked
    current with MacCormack (limited), gathered where the surface converges (eddies, the roller at the face, the
    banks), thinned where it diverges, and faded over ~15 s; foam older than ~30 s (threads in the eddies) dies.
    It is born only on thin lines (the ragged roller toe, ~1.9 m past the boil, brightest under the two sheets, and
    each sheet's plunge) as big open cells, rafts and wandering lanes, so it leaves them at once and drifts off as
    whole patches. It neither streaks from fixed spots nor leaves in rings. Along with its thickness, each parcel
    carries its displacement since birth and its age. The pool shader draws the lace at that *material
    coordinate*: a Worley wall network (power diagram, curved walls, ~0.4 m cells with patches of ~0.8 m open cells,
    plus ~0.17 m cells in dense foam, walls of varying width eaten into bubbles by the foam texture). Thin foam
    is torn: its walls break into fragments with irregular gaps, so it reads as lace, not cracked ice. The lace is glued to the foam: it deforms with
    the strain, is never re-seeded or cross-faded, and a raft keeps its holes all the way downstream. Thickness sets
    the walls' width, from sparse grey threads (alpha ~0.35) to white rafts (~0.92). Where the strain packs the
    walls finer than ~2 px (shear layers, eddies), they turn into thin foam lines: ridges of a coarser noise at
    the same material coordinate, drawn out by the shear, with clear water between them. The shader samples the field back-traced along the current
    by the time since its last step, so the foam glides at the display rate. In the GPU test the whole dam-water layer
    costs ~0.9 ms (budget 1.5 ms).
  - **The plunge.** Two impact plumes under the sheets widen downstream and merge. Over them lie milky aerated
    water and a churning boil (two counter-sliding lace layers) whose size and brightness pulse by about ±15 % on
    an irregular 1.5–3.6 s clock. Upwelling domes lift (brighter) and push the lace outwards; their centres show
    darker clear water. The boil ends at a fixed, ragged, brighter toe line. Past it, the jump is 2–3 irregular
    humps decaying downstream. Their crests are lit and their troughs blue-grey (through the foam too), and the
    clear water in the troughs is darker. The aerated body clears past the jump.
  - **Surface.** A rough, flow-mapped surface adds sky Fresnel and sun glints (more in the boil and the fast core).
  - **Light.** Lit by the mission's sun direction and sky; dimmed at night.
  - **Stability.** Everything is anchored in world/dam space (no screen-space terms), so panning and zooming never
    swim. Every animated term divides the 3600 s clock wrap.
- **Spray and mist (`dam-water-spray.js`).** These are stateless GPU billboards, closed-form in (seed, time),
  with no per-frame CPU work. They come only from the two sheets' plunges (the trickles only ripple the pool), so
  everything stays within ~5 m of them.
  - 44 impact-cloud puffs, 1–3 m tall, stand in front of the face along each sheet's impact line. They are soft,
    torn and churning, they pulse, and they drift out and downwind. They hide the pool's contact line with the face.
  - 380 spray clumps and droplets are thrown up and out on ballistic arcs and fall back. A droplet is a translucent
    grey-blue streak along its screen velocity (up to 6×), so it never reads as the drifting snow.
  - 64 mist puffs: half are a low veil hugging the face's foot either side of the plunge (it dims the face and the
    walls' bases); half rise off the boil and drift downstream with the mission wind (`world.wind.sample`, eased
    over 2.5 s).
  - The billboards' axes form a right-handed basis. Mirrored, they were back-face culled, and until this fix no
    spray or mist was ever drawn.
- **Sound.** Three positional ambience layers stop when the dam is destroyed (`until: 'dam'`): `waterfall` (the
  rush at the face), `waterfall_roar` (the plunge's low roar: the surf sample at 0.62× rate, `small` distance class)
  and `rapids` (the tailwater, 15 m downstream, `vehicle` class). `audio.js` passes an ambience layer's `rate`.
- **Tests.** `tests/unit/dam-flow.test.mjs` bakes on the real M3 grid and checks:
  - continuity and that no current crosses a bank;
  - the roller and the jet;
  - a fast core and slow banks;
  - side eddies;
  - foam carried and thinning downstream;
  - aeration confined to the plunge;
  - determinism.

  `tests/dam-water.test.mjs` (GPU) checks:
  - the build and the FX layer;
  - the plunge as the brightest water;
  - the foam pattern moving **downstream** on screen (cross-correlation of a luminance profile along the jet,
    0.1–0.3 s apart, the dam water's own clock and foam field stepped);
  - that nothing moves while paused;
  - the render-time budget (layer visible vs hidden ≤ 1.5 ms).
- **Screenshots** (1280×720, high preset): `docs/screenshots/dam-water-overview-z05.jpg`, `dam-water-z1.jpg`,
  `dam-water-spillway-z2.jpg`, `dam-water-pool-z2.jpg`.
- **Known limits.**
  - The bake is 2D (surface currents only). The roller and the entrainment are modelled as sources and sinks,
    not resolved in depth.
  - No rainbow: M3 is overcast, and an orthographic camera has no per-pixel view angle to place one.
  - The mist does not leave wet decals on the banks; only the face's splash zone is soaked.
