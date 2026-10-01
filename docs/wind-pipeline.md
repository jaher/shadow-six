# Wind pipeline (PROGRESS step 4w)

User requests: *"clothing and flags should be affected by the wind too, wind should be realistic"*,
*"trees and foliage should also be affected by the wind"*, *"flags should also be affected by the wind"*.

## One field, CPU and GPU

`src/world/wind.js` holds the wind. `World` creates a `WindField` for every mission (`world.wind`). It works the
same way on the CPU and the GPU.

- **Parameters.** Every theater has a preset (`WIND_PRESETS`). A mission can override it with an optional
  `weather.wind` field: `{preset?, dirDeg?, speed?, gustiness?, turbulence?, spacing?, width?, blow?, devils?}`.
  `normalizeMission` passes `weather` through unchanged.
- **Dawn and dusk are calm.** When the sun is below 6° (or `weather.timeOfDay` is dawn or dusk), the field
  switches to the `calm` preset. Snow maps are the exception and keep blowing.
- **Direction.** `dirDeg` is the heading the wind blows *towards* in world XZ (0° = +X).

| preset | mean m/s (10 m) | gustiness | character |
|---|---|---|---|
| calm | 1.3 | 0.18 | dawn / dusk, glassy water, flags hang |
| temperate | 4.5 | 0.45 | leaves lifted in gusts |
| urban | 3.5 | 0.5 | swirly (turbulence 0.65) |
| coast | 8 | 0.7 | gusty, whitecaps |
| fjord | 7.5 | 0.8 | gusty katabatic squalls |
| snow | 6.5 | 0.65 | blowing snow, spindrift |
| desert | 5 | 0.22 | hot, steady, occasional dust devils |

### The model

The wind at a point is a pure function of `(x, z, t)`, where `t` is **sim time**. It is built from these parts:

- **The mean wind** (direction and speed).
- **Gust fronts.** Three families of curved bands travel downwind at about 1.1× the mean speed plus 1.5 m/s.
  Each band has its own strength and lateral patchiness. The fronts show up as waves rolling through grass and
  canopies, and as cat's paws on water.
- **Turbulence.** Advected, incommensurate sines add speed variation of about ±22 % × turbulence and wobble the
  direction.
- **A slow envelope** of lulls and stronger spells.
- **A dust devil vortex** on desert maps.

Because the field is a pure function of sim time, it is deterministic under the fixed-step sim, frozen while paused,
and never needs saving.

### Sampling it

- **CPU.** `wind.sample(x, z, t)` returns `{x, z, speed, gust, turb}`.
- **GPU.** `WIND_GLSL` defines `windSample(vec2 xz)`, which returns `(vel.xz, gust, turb)`, plus `windStr(w)`, which
  returns a value from 0 to 1 (1 = 16 m/s). Four `vec4` uniforms (`WIND_UNIFORMS`) feed it and are shared by every
  material. `Game.render` calls `wind.frame(interpolated sim time, view centre)` once per displayed frame.
- **Keeping them in sync.** The CPU and GLSL versions must stay identical. `tests/unit/wind.test.mjs` checks the
  front constants.

## Consumers

| what | where | how |
|---|---|---|
| grass | `art/terrain/grass-glsl.js` | Blades lean with drag (∝ v²) and oscillate. Gust fronts roll through as waves: the blades tilt so their paler flanks show. |
| trees, bushes, hedges | `art/terrain/vegetation.js` `vpars()` + `treegen.js` `aRoot` | Hierarchical, SpeedTree-style motion sampled at each tree's root: (1) the trunk bends with a static lean plus sway at its natural frequency (≈ 3.5/H Hz, h² cantilever profile, length kept); (2) branches sway with their own phase, set by position; (3) leaves and needles flutter (needles are stiffer); (4) palm fronds whip. Stiffness depends on the kind of tree (conifer 0.65, broadleaf 1, bush 1.25, palm 1.35). |
| impostors | `art/terrain/impostors.js` | The same trunk lean and sway, applied to the billboard (the bake is done with the wind off). |
| flags | `art/cloth.js` `VerletCloth` + `art/flags.js` | A Verlet grid of 17 × 9 particles, with the hoist edge laced to the pole. Constraints: structural, shear and bend, plus tethers so the flag does not over-stretch. Forces: gravity (bunting 0.15 kg/m²) and aerodynamic force per triangle, `½ρA[Cn(v_r·n)\|v_r·n\|n + Ct v_r]`, plus a travelling flutter wave. The result is slack in a calm, streaming at about 6 m/s, and snapping in gusts. The geometry really moves, so shadows are correct. Steps are fixed at 1/60 s on sim time, and off-screen flags are skipped. A gust filling a flag emits `wind:flag` (halyard clank). |
| clothing | `art/cloth-wind.js` `applyClothWind` (called from `unit-model.js prepareMeshes`) | Flutter weights are derived at load from the bind pose and the `_mask` cloth channel: coat and parka skirts that stand off the leg bones, sleeves (loosest at the cuff), scarves and collars, cap ribbons, and straps. The vertex shader runs *after* `skinning_vertex` and pushes vertices along the **relative** air velocity (wind minus the character's own velocity, measured over sim time), using a phase that is continuous in space so UV-seam duplicates stay welded. Offsets are at most 12 cm. The x-ray, shadow and GTAO passes draw the pose without flutter. |
| tents, truck canvas | `applyFlap` + `aFlap` (`dressing.js buildTent`, `vehicle-model.js canvasFlap` (Opel Blitz cargo cover); windsocks: `static-vehicles.js windsockTicker` (yaw downwind with inertia, fill ∝ speed, full at ≈ 15 kt, gust flutter)) | Windward panels are pushed in and leeward panels billow out, with a ripple that snaps in gusts. Seams, poles and hoops stay fixed. |
| ropes, wires | `applySway` + `swayWeights` (palisade wire strands, tent guy ropes) | Lateral sway (sin(πt) along the span). |
| clothesline (M3) | `art/clothesline.js` | Two posts, a sagging line, and pegged Verlet laundry: the M36 tunic and trousers (`clothesline_uniform`, hidden once the Spy takes them), a shirt and a towel. |
| smoke, fire, dust, sparks | `render/fx.js _windTick`, `render/vfx/shaders.js gustPush` | VFX `uWind` = MEAN wind × 0.75 (ground-level fraction, lull envelope), low-passed over 1.2 s; each puff is pushed downwind by the gust band at its own position (flame tongues lean with it), so a front crosses plumes in step with the grass, trees and flags beside them. |
| falling snow | `art/terrain/snowfx.js` | Flakes follow the mean wind, integrated over sim time, plus a bounded gust swirl. The share of ground drift grows with speed. |
| water | `art/water/material.js`, `art/water.js windSpectra` | The FFT sea and detail spectra use the mission speed and heading. Detail ripples scroll with the wind. Gusts roughen the surface (cat's paws), and wind whitecaps appear from about Beaufort 4–5. |
| blown debris | `render/wind-particles.js` | One instanced draw, stateless on the GPU. Leaves hop and tumble, sand and spindrift form ribbons, and spray flecks fly. Particles appear only where the local wind lifts them. |
| snow off pines, dust devils | `render/wind-fx.js` (created by `map-builder` on the first frame) | Gust > 0.3 at speeds of 6.5 m/s or more shakes `snow_puff` off conifers near the view. The desert vortex emits `dust_devil` slices at 10 Hz. It also emits `wind:gust` at the view centre. |
| audio | `audio/audio.js update`, `event-map.js`, `synth.js gust/halyard` | The gain of the wind beds follows speed and gust at the listener. `wind:gust` plays a gust whoosh (ambience bus, gated by nature sounds). `wind:flag` plays the halyard snap-hook clank. |

## Testing and tools

- `tests/unit/wind.test.mjs` covers presets, determinism and pause, the travel speed of gust fronts, cloth
  behaviour and freezing, flag clank, clothing weights, the clothesline and the tent flap.
- `tests/p3-wind.test.mjs` runs on the GPU in the real game (M2 gale, desert sandbox).
- `node tools/perf/windshot.mjs --mission=m02 --at=36:26 --zoom=2.5 --frames=4 --gap=0.5 --wind=fjord --perf=1`
  renders frame sequences for motion review.
