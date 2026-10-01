# VFX pipeline (final) — SHADOW SIX

Status: the final best-of VFX library, built from the three prototypes (A: Mantaflow flipbooks,
B: real-time volumetrics, C: GPU particles) following the three judge reports
(art direction, tech/perf, engine integration). The library lives in
`src/render/vfx/` (12 ES modules, about 1.8k lines, no shipped textures; lab copy in `scratchpad/vfx/final/vfx/`). It is
integrated into the game (see §6). Everything in it is original code or procedurally generated at startup, so it can be redistributed
in the public repository. The one exception is the Ashima/Gustavson simplex noise (MIT, attributed in `glsl.js`).

Screenshots: `docs/screenshots/vfx-final-*.jpg`.

## 1. Design in one paragraph

**C is the runtime backbone.** It is a single GPU particle pool. Particle state lives in a float DataTexture,
and the vertex shader evaluates motion analytically: drag, buoyancy, wind and curl noise. Fire puffs cool along
a blackbody curve into lit soot, so there is no pop at the fireball-to-smoke hand-off. The pool is drawn by one
engine post pass (`FxPass`, the idea from A) into an offscreen premultiplied HDR target at a capped absolute
resolution. It is soft against a shared engine depth texture and composited with depth-occluded heat haze.
The additive "hot" pool is drawn after the composite, at full resolution. It holds sparks, embers, muzzle
petals, tracers and flashes, and is manually depth-tested (the sparks-after-volumes ordering from B).
Several new pieces answer the judges' must-fixes:
- a procedural flame-tongue sprite;
- a dirt-fountain grenade;
- a directional muzzle star;
- buoyant narrow smoke columns;
- torn "wisp" smoke cells;
- instanced multiply decals in the engine `decalScene`;
- one shared pool of 6 point lights;
- per-preset budgets with oldest-first recycling.

```
RenderPass(scene) → RenderPass(decalScene: vision cones + VFX decals) → [GTAO] → FxPass → [Bloom] → OutputPass(tone map) → SMAA/FXAA
                                                                                 │
             engine depth: GTAO.depthTexture (high/ultra) or composer RT DepthTexture (low/medium)
FxPass: 1) smoke/fire/flame pool → fxRT (RGBA16F premultiplied, height ≤ 540/720/900/1080 by preset)
        2) composite  scene·(1−a) + fx, with heat haze (skipped where geometry is in front of the source)
        3) hot pool (sparks, petals, tracers, flashes), additive at full resolution, depth-tested in the shader
        When nothing is live: no-op (needsSwap=false, 0 draws).
```

### What was taken from each prototype

| From | Kept | Dropped |
|---|---|---|
| C particles | Pool and analytic motion, blackbody fire→soot shading (the best E1/E6/tanker fireballs), sparks and embers, instanced debris with smoke trails, torn barrel shell and lid, chain reactions (`addExplosive`/`blast`), seeded fixed-step scheduler | Pool mesh in the main scene (GTAO artefact, cones drawn over smoke), CPU `Float64Array.sort`, the 32k silent drop, the heat RT rendered inside `update()`, sprite puffs clipping on geometry |
| A flipbook | Offscreen accumulation pass with soft depth test + composite + haze; the tall-domain Mantaflow re-sim toolchain (`blender/sim.py --kind tongue`, `render.py`, `pack.py`) | Sphere-phase fireball, black oily chimney smoke, `Math.random` debris, atlas leaks (no atlases are shipped at runtime now) |
| B volumetric | Ordering (sparks after smoke), `decalScene` option, depth-aware ideas, the fixed light-pool concept, the aftermath look (scorch + scattered debris) | The raymarcher itself (see §8): at +1–13 ms (5090) it does not fit the 4 ms budget, and the particle columns now read as columns |

## 2. API

```js
import { createVfx } from './vfx/index.js';
const vfx = createVfx(scene, camera, engineRenderer, { wind: new THREE.Vector3(1.6, 0, 0.5), groundHeight: (x, z) => h });
vfx.spawn(kind, pos, opts)   // → null, or a handle {stop()} for persistent effects
vfx.update(dt)               // fixed 1/60 s internal step: deterministic at any frame rate
vfx.setQuality('low'|'medium'|'high'|'ultra')   // follows engine.setPreset automatically when attached
vfx.stats()                  // {smoke, hot, particles, recycled, debris, decals, lights, emitters, haze, draws, pressure, quality, fxRes}
vfx.addExplosive(object3D, 'barrel_explosion', opts)   // chain reactions: blasts arm props in range (0.2–0.8 s cook-off)
vfx.shakeOffset()            // deterministic camera-shake vector for the camera controller
vfx.setEnvironment({wind, auto:false, sunDir, ...})    // by default sun, hemisphere, IBL and fog are read from the scene every frame
vfx.dispose()                // removes the pass, lights, decals and debris, and frees GPU memory (verified by renderer.info)
```

If `renderer` is the engine `Renderer`, `createVfx` attaches itself (`vfx/engine.js`) as described in §6.
If it is a bare `WebGLRenderer`, the host inserts `vfx.pass` and sets `vfx.depthProvider`.

## 3. Per-effect technique

All counts go through `vfx.n()`, which scales them by the quality tier density and the live budget pressure.
Colours are linear albedo, lit with the same 1/π Lambert as `MeshStandardMaterial`, so smoke sits correctly
against world surfaces in every theater.

| Kind | Technique |
|---|---|
| `explosion_large` (E1) | HDR flash + light pulse (420 cd → 0) → 80 + 26 FIRE puffs expanding radially (high drag, 0.3 s) with a single coherent hot core from frame 1, buoyant roll-up, blackbody cooling (2000–2900 K) into lit soot → 3 staggered secondary blasts → narrow buoyant aftermath column (26 s) → 45 instanced chunks (35% smoke-trailing, 30% burning), 200 sparks, 100 embers, shock ring (screen-space refraction) + dust skirt, scorch decal, 18 s residual flame field, heat haze, shake, chain-reaction blast (14 m) |
| `explosion_small` | Shell / mortar: short flash, small fireball (0.6–1.4 s), dirt fountain (14 jets), dust body + dark smoke, sparks, shock + skirt, scorch |
| `grenade` (E2) | NO fireball. 50 ms flash + 1-frame light, **dirt fountain**: 16 ballistic jets (10–18 m/s, cone ≤ 0.5 rad) of velocity-stretched dark clods (surface-dependent colour) plus 22 instanced clods. Grey-brown dust body (delayed 60 ms so the jets read first), dust skirt, crater decal |
| `barrel_explosion` (E6, hero) | Rupture flash, sooty fuel fireball (1700–2300 K, strong buoyancy → rolling mushroom in 3 waves), torn shell + lid (hero meshes, tumbling, smouldering flames when resting, glowing edges decay), chunks, then `fuel_pool_fire`. Chained barrels (`chainFrom`) get 60% fireball, no extra smoke burst and a smaller pool, so a 4-drum chain does not fog the screen |
| `tanker_explosion` | E1 (×1.2) + 3 sequential barrel ruptures along the tank + a 60 s `burning_wreck` |
| `burning_wreck` (E3) | Flame tongues sampled on the wreck **top** (oriented footprint, `h` = top height): 34/s normal + 9/s large, so the flames rise 1.5–3 m above the hull instead of hiding inside it. Soot column (narrow base, widening, wind-bent), embers, flickering light + haze. Returns a handle |
| `fuel_pool_fire` | 5 random lobes (irregular pool), tall tongues (40·R/s) + large tongues with detaching hot puffs, black column, embers, light, haze, dark fuel-stain decals |
| `fire_small` | Campfire: short tongues, embers, thin grey-white wood-smoke plume (the chimney recipe), 14 cd flicker light, scorch |
| `chimney_smoke` (E4) | **Ambient** (own pool, readability-limited, §6.4). A thin, continuous plume anchored on the stack top: ~32 faint wisps/s × `activity` (0 cold · 0.45 faint · 1 · 1.5 busy) with a slow draught/stoking modulation (periods 60–140 s). Stack-sized at birth (0.3–0.38 m, born within 12 cm above the stack, 0.12 s fade-in) → ~0.9 m; leave at 1.3–1.6 m/s, rise on buoyancy, bend over with `world.wind` (mean + gust fronts in the shader) and dilute within ~6–10 m of rise in calm air, sooner and flatter in wind (life × 0.45–1; opacity × up to 1.45 in wind so the longer, more diluted plume still reads). One coherent curl-noise field for all ambient wisps whose amplitude grows slowly with age (narrow at the stack, meanders and tears further out); velocity-stretched wisp cells with soft rims; alpha ∝ (1 − age)^1.6. Shading is smooth only (soft dome normal, density self-shadow, Henyey-Greenstein forward scatter on thin edges, bluer as it ages): atlas normal detail on wisps a few dozen pixels wide read as grain and boiled. Light bluish-grey (snow albedo [0.27, 0.3, 0.38], displayed a little darker than the snow; elsewhere [0.33, 0.34, 0.38]) |
| `smoke_column` | Generic persistent column (`color: black/grey/white`) |
| `smoke_puff` | Rifle / impact smoke: 5 small torn wisps along `dir` |
| `muzzle_flash` (E5) | **2–3 frame** (45 ms) HDR star aligned to the barrel: a forward petal 0.65–0.95 m (×weapon factor: pistol 0.65, MG 1.1) + 3 side petals at 120°, explicit yellow→orange HDR ramp (10→4), min on-screen size 7×28 px so it reads at 40–50 m view width. 45 ms flash sprite, **1-frame light pool** (45 cd, 20 ms), smoke puff, and a 260 m/s tracer (not for pistols) |
| `tracer` | Additive streak with a fixed 6 m length and a bright head, 260 m/s, width ≥ 2.5 px |
| `dust_kick` | Bullet impact: 6 stretched ballistic grains + 3 dust wisps, surface-coloured |
| `vehicle_dust_trail` | Handle-returning emitter following `opts.target` (Object3D); rate is proportional to speed |
| `mud_spray` | Wet dark clumps, ballistic, plus instanced clods |
| `water_splash` | Stretched white spray jets (vertical crown) + low foam wisps (+ flash for shells); `scale` 0.2 = bullet |
| `blood_puff` | Muted dark-red mist + droplets + small delayed decal (restrained, like the original) |
| `sparks` | Metal impact: 18 hot sparks in a cone + tiny flash + puff |

**Flame tongues** (`MODE.FLAME`, `shaders.js`). Each tongue is a quad anchored at its base. It is
2.5–4.5× taller than it is wide and bent quadratically by the wind. The fragment shader tapers a flame
profile and distorts it with two upward-scrolling octaves of the tileable detail noise. The same noise cuts
the top into separate licks. Colour comes from a blackbody ramp (1500 K rim → 1750–2300 K core), and the
tongue is emissive only (no soot on the tongue itself, which avoided dark "holes"). Many short-lived
(0.45–0.9 s) overlapping tongues give the flicker.

**Mantaflow flame atlas.** The tall-domain re-sim was run as the judges asked: `--kind tongue`, domain
2.5×2.5×5 m at 128×128×256, no wall contact, 110 frames, packed as `fx/tongue_*`. It gave compact
ball-shaped flames at the game scale, so the procedural tongue ships instead. The toolchain is kept in §5
for further iterations.

**Smoke shading.** Puffs use a 4×4 GPU-baked atlas: 8 lumpy "billow" cells (7 eroded spheres + fBm) and
8 torn "wisp" cells (domain-warped fBm). Each cell stores fake normals, thickness and density. Detail noise
erodes the edges, and the erosion threshold rises with age, so puffs dissipate instead of lingering as
cotton balls. Puffs are stretched along their screen-space velocity. Lighting combines sun + hemisphere/IBL
ambient + the 6 FX lights (fire lights its own smoke) + self-shadowing + distance fog. Every puff is a soft
particle: its alpha fades over 0.5 × size in front of the engine depth, so there is no hard clipping on
walls, trucks or the ground.

## 4. Performance per preset

Measured on the RTX 5090 in headless Chromium (`--use-angle=gl`), 1920×1080 window (ultra at devicePixelRatio 2,
i.e. a 3840×2160 buffer), W = 60 m view, 5×3 spawn grid. **GPU** is an `EXT_disjoint_timer_query_webgl2` query around
`FxPass` only (median of 60 frames). Whole-frame queries were too noisy on the shared GPU (±1 ms clock-state jitter).
**CPU** is `vfx.update()` (fixed steps + bucket sort + uploads). Instanced debris, decals and hero meshes render in the
engine's own passes: at most 2 instanced draws plus 4 per live barrel (shell and lid, with shadows). Source: `out/bench_low_medium_high_ultra.json`.

| Scenario (t = 0.6 s / 3 s) | low GPU ms | medium | high | ultra (4K) | CPU ms (high) | particles (high) |
|---|---|---|---|---|---|---|
| idle (nothing live) | 0.00 | 0.00 | 0.00 | 0.00 | 0.02 | 0 |
| E1 ×1 | 0.02 | 0.04 | 0.11 / 0.10 | 0.19 | 0.13 | 1.7k |
| E1 ×5 | 0.05 | 0.14 / 0.16 | 0.30 | 0.46 | 0.43 / 0.38 | 8.4k |
| E1 ×15 | 0.13 / 0.14 | 0.31 / 0.33 | 0.82 / 0.92 | 1.22 / 2.65 | 0.62 / 0.83 | 19.7k (cap 26k) |
| E2 ×15 grenades | 0.02 | 0.04 | 0.13 | 0.19 | 0.18 | 0.9k |
| E3 ×15 wrecks | 0.02 / 0.03 | 0.04 / 0.06 | 0.07 / 0.14 | 0.16 / 0.23 | 0.11 | 0.7–1.0k |
| E4 ×15 chimneys | 0.01 / 0.03 | 0.02 / 0.03 | 0.04 / 0.09 | 0.07 / 0.13 | 0.07–0.10 | 0.7–1.6k |
| E6 ×15 barrels | 0.12 / 0.09 | 0.27 / 0.19 | 0.53 / 0.35 | 1.05 / 0.53 | 0.41 / 0.50 | 12k |
| typical fight (2 E1, 3 wrecks, 3 chimneys, 2 grenades) | 0.04 | 0.09 / 0.10 | 0.18 / 0.19 | 0.29 / 0.30 | 0.27 / 0.18 | 3.7k |

The prototypes on the same machine, for comparison: C cost +2.73 ms for E1×15 plus a 2.7–4.8 ms CPU sort, and silently
dropped particles at 32k. B cost +12.3 ms for E1×15 and 0.9 ms of fixed cost as soon as any volume was live. A cost +0.49 ms
but kept 113 MB of atlases in VRAM.

**Mid-laptop estimate** (RTX 4050 Laptop ≈ 9× slower than the 5090, CPU ≈ 2.5× slower): a typical fight costs about
0.8 ms GPU + 0.4 ms CPU on medium and about 1.7 ms + 0.6 ms on high, well inside the 4 ms VFX cap. The worst case
(15 simultaneous E1 on high) would be about 8 ms GPU. That case is absorbed by the budget rules below: emitter
thinning, recycling and the lower density on medium/low.

**Budget rules** (`VFX_QUALITY` in `index.js`, selected automatically from the engine preset):

| Preset | smoke cap | hot cap | density | FX target height | heat haze | debris cap |
|---|---|---|---|---|---|---|
| low | 9 000 | 3 000 | 0.55 | 540 px | off | 160 |
| medium | 16 000 | 5 000 | 0.75 | 720 px | on | 300 |
| high | 26 000 | 8 000 | 1.0 | 900 px | on | 450 |
| ultra | 36 000 | 12 000 | 1.0 | 1080 px | on | 600 |

Above 70% smoke-pool fill, continuous emitters thin out (down to 35%). At the cap, the oldest particle slot is
recycled; nothing is dropped. The composite and haze copy are scissored to the projected screen rectangle of the
live effects, and the pass is a no-op when nothing is live.

## 5. Assets and how to regenerate them

The runtime ships **no texture files**. Every texture is baked on the GPU at startup (`vfx/textures.js`):

| Texture | Size | Content |
|---|---|---|
| `puff` | 1024² RGBA8 + mips | 4×4 atlas: rows 0–1 are billow puffs (7 eroded soft spheres + fBm), rows 2–3 are torn wisps (domain-warped fBm). RG = fake normal, B = thickness, A = density |
| `detail` | 256² tileable | 3-channel fBm for edge erosion, flame distortion and heat-haze noise |
| `scorch` | 512² | Radial char mark with streaks and specks (scorch, crater, fuel stain and blood tints are applied in the decal shader) |

VRAM: about 7 MB of baked textures + 5.5 MB of particle state (float DataTextures at the ultra caps) + the FX target
(RGBA16F, ≤ 1920×1080 = 16.6 MB) and the haze copy (sized to the effect rectangle). The prototype A atlases took 113.6 MB.
There is nothing to compress to KTX2 unless the optional flipbook tier below is shipped.

Offline tools, kept for the optional Mantaflow flame tier and for future flipbooks. All paths are relative
to `scratchpad/vfx/final/`. They need Blender 4.2 (Mantaflow + Cycles) and the prototype-A venv (OpenEXR, cv2).
- `blender/sim.py --kind tongue --res 256 --frames 110 --fuel 1.2 --brate 0.9 --vz 2.5 --fvort 1.5 --out sims/tongue`
  runs a tall-domain flame sim: 2.5×2.5×5 m, 128×128×256 voxels, 3 small emitters in the middle so there is no wall contact. Bake time is about 10 minutes on CPU.
- `tools/render_tongue.sh` renders it with Cycles (`blender/render.py`: 6 camera-aligned sun lightgroups + emission,
  55° ortho game camera, 48 frames, 512 px) and packs it with `../flipbook/tools/pack.py` into `fx/tongue_{A,B,M}.webp` + `tongue.json`
  (6-way lightmaps, emission/alpha, optical-flow motion vectors, 10-frame loop cross-fade). The render takes 57 s on the RTX 5090.
- The other prototype-A kinds (`explo`, `billow`, `puff`, `dust`, `fire`) use the same scripts with `--kind`.

Look-dev and validation tools (`scratchpad/vfx/final/tools/`):
- `serve.mjs`: static server on :8977. It maps `/proj/` to the repo, `/final/` to the library and `/assets/` to the CC0 Poly Haven textures and HDRIs.
- `demo/index.html?theater=desert|snow|overcast|night&preset=…&W=…&tx/ty/tz`: lab scene on the real engine `Renderer`.
- `capture.mjs jobs/*.json outdir/`: deterministic time-stepped captures. `sheet.py` builds contact sheets.
- `bench.mjs low medium high ultra`: GPU timer queries on the whole frame, CPU `update()` time, particle and draw counts → `out/bench_*.json`.
- `verify.mjs`: pass order per preset, shared depth, preset round trip, determinism, GTAO isolation, budget recycling, dispose → `out/verify.json`.

Licences: the lab ground textures and HDRIs are Poly Haven CC0 (aerial_sand, snow_02, leafy_grass, Grass004,
goegap, kloofendal_43d_clear_puresky, overcast_soil_puresky, moonlit_golf). They are used only in the lab, not by the library.
Simplex noise is by Ashima Arts / Stefan Gustavson (MIT). Blender, Mantaflow and Cycles are GPL tools whose outputs we may use freely.

## 6. Integration into the game

**Installed** (branch feat/art-integration, "Art integration: vfx"): the library is in `src/render/vfx/`, and
`src/render/fx.js` is the game adapter (the lab `game-fx.js` was folded into it). Screenshots:
`docs/screenshots/int-vfx-m1-drum-chain-wreck.jpg`, `int-vfx-m2-fueltank-tracers.jpg`, `int-vfx-m3-charge-tracers.jpg`.

### 6.1 Engine (`src/engine/renderer.js`)

The renderer got a third official post-hook slot, `'fx'`, run after every `'afterAO'` hook. `vfx/engine.js`
(`attachToEngine`) registers the FxPass there with `addPostHook('fx', …)`. It no longer wraps `_buildComposer`; that
path stays only as a fallback for an engine without the slot. The pass is `keepAlive`: the engine disposes every pass
on a rebuild, but only `vfx.dispose()` frees this one. Verified order (M1, which has water):
- low: `Render › Render(decals, off) › DepthStash › XRay › Water › Render(late decals) › LateFx › FxPass › Sanitize › Output › LUT › FXAA`
- high/ultra: `… › AlphaAwareGTAO › Water › Render(late decals) › LateFx › FxPass › Sanitize › UnrealBloom › Output › LUT › SMAA`

Smoke and fire therefore draw over rivers and fjords, and HDR flames still feed bloom and tone mapping.

**Shared depth (`renderer.fxDepth`).** The pass uses:
- the read buffer's DepthTexture when the water is in the chain (the WaterPass restores the world depth and writes the surface);
- otherwise GTAO's depth texture (after GTAO's swap, the ping-pong depth is stale);
- otherwise a DepthTexture attached to the composer targets.

The FxPass draws into the read buffer itself. Sampling a depth texture attached to that buffer is a WebGL feedback
loop (`INVALID_OPERATION` 1282, found by the water test), so in that case the depth is first copied to an R32F target.
The copy is one full-screen draw, and it only happens while effects are live. The VFX quality follows `setPreset`.

**Camera shake.** `CameraRig.shake = () => {x, y} | null` offsets the main camera in its own plane (single view only).
Game wires it to `world.fx.shakeOffset()`, which returns null with the new **Reduced motion** option
(`options.reducedMotion`, Display section of the options panel).

**Sim vs frame.** `fx.update(dt)` runs in the 60 Hz sim tick (`vfx.advance`: fixed steps, events, emitters). It is
frozen while paused and follows the game speed. `fx.frame()` runs once per displayed frame from `Game.render` (sort,
upload, lights, decals), so several sim ticks per frame cost only one sort.

### 6.2 Game (`src/render/fx.js` and events)

In node tests there is no WebGL renderer. The adapter still maps every event and logs each spawn in `fx.items`
(`{kind, x, z, opts}`), which is what `tests/unit/vfx-integration.test.mjs` checks.

| Event / source | Effect |
|---|---|
| `explosion` `bomb` | `explosion_large` (scale r/9) |
| `explosion` `shell` / `grenade` | `explosion_small` / `grenade` (dirt fountain; the surface comes from the terrain cell: sand, snow, grass, mud or dirt) |
| `explosion` `barrel` (a Barrel entity) | `barrel_explosion` (torn shell, lid, fuel pool fire). A drum set off within 8 m and 2.5 s of another blast gets the lighter `chainFrom` look. The chain itself is gameplay (`Barrel.ignite`, 0.2 s). Drums are registered with `vfx.addExplosive` but never armed, so the VFX never detonates a drum the game did not |
| `explosion` `structure` | Fuel tank → `tanker_explosion` + a 90 s `fuel_pool_fire`, then a smoke column. Other structures → `explosion_large` + a 60 s `burning_wreck` on the flattened footprint, then a smouldering column for the rest of the mission |
| `explosion` in water | The water system spawns the `water_splash` column (the FX draws it itself when there is no water system) |
| `vehicle:destroyed` | `explosion_small` (or `tanker_explosion` for the Opel Blitz tanker) + a `burning_wreck` on the hull top, oriented by the heading. The hull's own `vehicle`/silent `barrel` blasts are folded in rather than drawn twice. When the game's `fire` off event arrives (§3.6 wreck burn, 20 s), the flames stop and a black smouldering `smoke_column` stays. Boats → splash + blast; MG nests → blast + a short column |
| `shot` | `muzzle_flash` 0.7 m ahead of the muzzle, aligned to the target. Muzzle height follows stance (standing 1.35, crouched 0.9, prone 0.3), MG nest (1.1), vehicle MG (1.8) and tank MG (2.0). Weapon size classes: pistol/luger, rifle, sniper, smg/mp40, mg/tankMg. Every weapon except pistols gets a 260 m/s tracer. When the round arrives: `blood_puff` on a soldier (unless blood is off or censored), `sparks` on a vehicle, otherwise `dust_kick` or a small `water_splash` |
| `vehicle:fire` `cannon` | Cannon-sized `muzzle_flash` + blast smoke. The shell explodes as `shell` |
| `hit` | Knife or harpoon on flesh → `blood_puff`. Projectile on a wall or metal → `sparks` |
| `unit:killed` | `blood_puff` + blood pool decal, except for bloodless causes (syringe, drowning, fire, electric, explosions, train) or when blood is off or censored |
| Land vehicles (per tick) | `vehicle_dust_trail` (rate ∝ speed) on sand, snow powder and dirt roads. `mud_spray` from the rear wheels on mud cells |
| Structures (at map build) | `chimney_smoke` from the **chimney anchors of the actual model** (building-library sidecar `anchors[kind='chimney']`, transformed by the placed instance — also for instanced repeats, whose model node is disposed — then snapped onto the drawn stack top +5 cm by a short ray), a model child named `/chimney/`, or a mission `chimney: true / {x, z, y, activity}`. Library models without a chimney anchor, ruins and destroyed variants never smoke; only procedural (non-library) houses/huts get a seeded brick stack, seated on the roof surface under it (raycast). Per-chimney activity is seeded by id and theater (snow: 15 % cold, 35 % faint, 40 % normal, 10 % busy; elsewhere 40 % cold); a map with chimneys always has one lit. It stops on `structure:destroyed` |
| Mission `fx: [{kind, x, z, …}]` | Any kind, e.g. campfires (`fire_small`) or a `smoke_column` |

### 6.3 In-game performance (M1, 1280×720, RTX 5090 ANGLE-GL headless, `__game.bench(60)` whole frame)

The typical fight is a 5-drum chain, a burning truck wreck, a grenade and 3 chimneys: about 2.2k particles, 22 emitters and 18 FX draws.

| Preset | GPU idle → fight (ms) | wall idle → fight (ms) | FX CPU per frame (update + frame) |
|---|---|---|---|
| low | 0.53 → 0.64 | 1.3 → 1.7 | 0.13 ms |
| medium | 0.93 → 1.16 | 2.2 → 2.1 | 0.15 ms |
| high | 1.69 → 1.70 | 3.1 → 3.0 | 0.19 ms |
| ultra | 1.97 → 2.21 | 3.3 → 3.4 | 0.15 ms |

The added GPU cost of a fight is about 0.1 to 0.25 ms here, within the lab figures in §4 (×9 on a mid laptop ≈ 1–2 ms).

### 6.4 Ambient smoke and readability (feat/chimney-smoke)

The user asked for chimney smoke that looks realistic and does not get in the way. From the 40° game camera, smoke
rising from a roof projects over the ground behind and above the building on screen, exactly where guards, cones and
paths are. So chimney plumes are thin, light bluish-grey and continuous from the stack top (they read as wood smoke,
not as stains), and the readability work is done locally where they cross units and cones, not by turning the whole
plume down. Before/after: `docs/screenshots/smoke-before-after.jpg` (M1/M2/M3, zoom 1 and 2, BEFORE = the dense
pre-rework plume, AFTER = this) and `smoke-m0{1,2,3}-z{0.5,1,2}-after.jpg`.

**Ambient layer.** Chimney smoke is emitted with `ambient: true` (aux flag = 1) into its own pool `vfx.amb`
(`ambCap` 2.5k/4.5k/7.5k/9k per preset: 30 busy chimneys fit the high preset; unsorted, so it is drawn in spawn order
and pans never reshuffle overlapping wisps; its own pressure thins chimneys above 60 % fill) and accumulated into its
own target. Only `chimney_smoke` is ambient by default. Fire and wreck smoke keep their full strength and stay out of
the pool: the persistent `fire_large` column, the `fuel_pool_fire` column, `burning_wreck`, `smoke_column` and the
campfire plume of `fire_small`. A burning building or fuel depot should still put up a black column. `smoke_column`
can opt in with `{ambient: true}`. Explosion smoke stays dramatic and is not limited.

**Composite** (FxPass, per pixel where the ambient layer has coverage):
1. *Background estimate*: the darkest of 5 taps (±4 px) of the scene copy. Ground texture, footprint edges and falling
   snowflakes (small, bright, moving) therefore never modulate the plume pixel by pixel. Using the raw pixel made the
   plume speckle and boil as flakes passed.
2. *Tone band*: the smoke's own lit luminance is kept within 0.5–1.8 × the background (reference never below a dimly
   lit ground, 0.1 / exposure), keeping its hue (`AMBIENT_RULES.toneMin/toneMax`). The VFX light uniforms can disagree
   with what lights the ground (night theaters, lamps). A wisp much darker than the ground reads as a stain, and one
   much brighter reads as a white sheet.
3. *Alpha ceiling*: linear up to 0.6, then soft to 0.92.
4. *Perceived cap*: the composite blends in linear HDR before the tone curve. AgX compresses a veil over snow and
   expands it in the darks, so the cap limits the change of the DISPLAYED value: perceived = |D(Lo) − D(Lb)| /
   max(D(Lb), 0.3), D = the AgX curve on a grey (gamma for other curves). The knee is soft: changes under 60 % of the
   cap pass untouched (so the plume's structure is not flattened), and above that they approach the cap. An 8-step
   bisection finds the layer's strength. Caps (`vfx/ambient.js` `AMBIENT_RULES`): 0.35 where the smoke overlaps the
   ground plane, 0.5 over roofs (more than 1.2–4.5 m above the local ground).

**Masks.** `FX._ambientMask()` sends, each frame, the entities near the live ambient smoke (its AABB grown by the
ground it can cover on screen): commandos, enemies and bodies, doors, pickups, switches, the probe ring (screen-space
capsules of their upright axis, r 0.7–0.9 m, soft to 1.8 r), and the shown vision cones (world sectors on the ground). The
cap drops to 0.35 × 0.1 = 0.035 over units and 0.35 × 0.12 = 0.042 over cones. A silhouette under a plume keeps its
contrast, and cones and selection rings are not tinted. Hidden units (garrisoned) leave no hole in the plume.

**Temporal stability.** At 30 fps steps (M3, zoom 1, mission wind), 59.6k → ~11k pixels per frame change their
perceived value by more than 0.05. Three causes were removed: the per-pixel background (snowflakes), the atlas normal
detail in the shading (grain), and an intermittent stack exit (too few, too opaque wisps). The remaining changes are
the edges of wisps moving with the wind (~8 px per frame at 6.5 m/s).

**Tests.** `tests/unit/chimney-smoke.test.mjs` covers: emission points = transformed anchors, also for instanced
repeats; no smoke from chimney-less models or ruins; the activity distribution; wisps born on the stack top; rise of
6–10 m in calm air and flatter in wind; slow variation; only chimney smoke ambient (fire / wreck / pool / column /
campfire smoke not); budgets; the soft knee; the limiter holds for random backgrounds.
`tests/chimney-smoke.test.mjs` (GPU, M1 + M3) checks:
- emission 5 cm above the drawn stack top;
- the plume clearly visible (> 3000 px with a perceived change > 0.04, max > 0.15);
- the plume anchored at the stack (perceived > 0.08 within 1.5 m above the stack top);
- the perceived change ≤ the roof cap everywhere;
- ≤ 0.035 (+ tolerance) over every unit's screen box, with a commando and an enemy moved right under a plume;
- the shown cone untinted;
- the FxPass cost of the ambient layer.

**Cost** (RTX 5090, FxPass GPU timer, 1280×720 high): +0.025 ms (M1, 161 live wisps) and +0.04 ms (M3, ~600–900 live
wisps) for the ambient pool draw, the scene copy, the tone band and the limiter.

## 7. Judge must-fix checklist

| Must-fix | Status |
|---|---|
| C smoke carpet (4-drum chain fogs 20 m at 2.5–8 s) | Fireball puff end size −30% (3.4–5.4 m ×1.3), life −20%, buoyancy +25–50%. The post-fireball burst goes from 30 to 10 puffs and chained drums add none. Pool column rate −30% with narrow spawn (`lat` 0.25–0.4). Columns rise at ~6 m/s terminal speed, so from 55° they displace up the screen |
| Soft particles (needs engine depth) | Every translucent sprite fades over 0.5 × size against `fxDepth`, and flames over 0.3 × size. Hot particles are manually depth-tested. Depth is shared (GTAO's texture or a composer DepthTexture); there is no duplicated prepass |
| E5 muzzle flash unreadable | 45 ms directional star (forward petal 0.65–0.95 m + 3 side petals), HDR yellow→orange, minimum 7×28 CSS px on screen, 45 ms flash, 1-frame (20 ms) 45 cd light pool, smoke puff, 260 m/s tracer. No vertical bloom streak and no head glow (the flash sprite is 0.5 m and positioned 0.7 m ahead of the soldier) |
| Fire tongues (E3, pool, tanker, campfire) | New procedural FLAME sprite (tall, anchored, wind-leaning, flickering). Wreck flames spawn on the hull top and rise 1.5–3 m above it. The Mantaflow tall-domain re-sim was done but not shipped (see §3) |
| E2 grenade | 16-jet brown dirt fountain + clods + short flash + grey-brown skirt. No fireball, no cotton balls. Visibly bigger than B's (about 5–6 m tall at 0.6 s) |
| Fireball onset | Single coherent hot core from frame 1 (C's radial puffs, high drag). No disc/decal phase. The barrel flash is cut to HDR 7 so it no longer blows out white; E1 keeps a short (0.14 s) HDR-16 flash |
| Cotton-ball look | Wisp atlas cells, age-growing erosion, velocity stretch, faster dissipation. Chimney/rifle/dust use small, many and torn wisps |
| E4 chimney | Reworked (feat/chimney-smoke): ambient wisp plume with per-chimney activity, readability-limited (§6.4). Lab framing uses `ty` so the plume stays in view |
| Engine retune (bloom 2.0, ACES/AgX) | Tuned inside the real engine at bloom threshold 2.0 with the default ACES (`CONFIG.render.toneMapping`). Flame/fireball cores exceed 2.0 and bloom; rims stay orange. Smoke uses the engine's 1/π Lambert, which removed the washed-out look the prototypes had at 3× brightness |
| Heat haze occlusion; static grain | Haze is skipped where scene depth is in front of the source (geometry occludes). Noise scrolls in time. Haze exists only on medium+ |
| Theaters (snow / overcast / night) | Sun, hemisphere, IBL and fog are pulled from the scene every frame. Validated in the lab: night fire lights smoke and ground (6 pooled lights feed both the materials and the particle shader); snow and overcast columns take sky colour and stay dark/sooty. Pooled lights cast no shadows; the flash pool (45–420 cd) is strong enough to read |
| Performance guard (4 ms cap) | Per-preset caps (smoke 9k/16k/26k/36k, hot 3k/5k/8k/12k), density scaling, budget pressure (emitters thin out above 70% fill), oldest-first recycling (never a silent drop; verified 40×E1 on low: 0 dropped), O(n) bucket sort (translucent tier only), fxRT height cap, scissored composite. Numbers are in §4 |
| B costs (prepass, debris draws, fixed pass cost, 0.5× buffer) | Volumetric layer not shipped. Debris is one InstancedMesh; decals are one instanced draw; the pass costs 0 draws when idle |
| Flipbook VRAM / KTX2 / leaks | No atlases at runtime (~6 MB of baked textures). `dispose()` frees everything: textures 19→13 and geometries 39→27 (the engine's own remain). The FX lights are removed |
| `vfx.stats()` + QUALITY presets | `stats()` returns particles, recycled, draws, lights, emitters, haze, pressure and fxRes. `VFX_QUALITY` keys match `QUALITY_PRESETS` and follow `setPreset` |
| Determinism | Seeded RNG per spawn, fixed 1/60 step, no `Math.random`. Verified: pixel-identical frames across fresh page loads on medium (GTAO noise makes high/ultra non-reproducible, as the integration judge noted) |
| Shared lights | One pool of 6 PointLights, strongest requests win each frame |
| E6 scale data-driven | `scale`, `chainRadius`, `poolDur`, `smokeK`, plus chained-drum reduction |
| Validate on mid-range and integrated GPUs | **Open.** Only the RTX 5090 was available. The laptop figures in §4 are ×9 estimates |

## 8. Known weaknesses and next steps

Integration (game):
- **Multi-view layouts** (2–4 camera views, §2.3) use the plain forward path, so they show no VFX. Only the single main view runs the post chain.
- **Decals are flat quads** at ground height + 2 cm (polygon offset). On steep carved banks, a large scorch can clip into the slope.
- **Chimneys** come from the library sidecar anchors; only procedural houses/huts still get a seeded brick stack.
  Wood smoke over snow is still low-contrast from the game camera, even after the snow theater's darker, denser plume.
- **Heat haze and pooled lights** are unchanged from the lab (8 haze sources, 6 shadowless lights: at night, fire light passes through walls).
- **Grenade in snow** (art review): white snow spray on white snow was nearly invisible at the game camera. On
  `surface: 'snow'` the recipe adds a second fountain of dark frozen soil, a black TNT smoke core, and a scorch decal.
- **Fireball hue (open)**: the barrel and drum fireballs render peach/salmon, not orange-yellow with black soot. This
  is AgX compressing the blackbody emission. Fire gain, the fire-light term and the LUT were ruled out, and a
  yellower blackbody decode only made them beige. Fixing it needs a renderer decision: an AgX "punchy" look, or
  restoring saturation on emission-dominated pixels.
- The M2 fuel-tank screenshot fires the structure blast directly (the M2 tanks are not destroyable interactables yet), so the tank mesh stays intact inside the fireball.

Library:
- **No volumetric layer.** B's raymarched columns (self-shadowed, wind-bent, the art judge's favourite E4 plume) are not
  shipped. At +1–13 ms on a 5090 they blow the 4 ms budget. The particle columns now read as columns, but they are
  sprite smoke: close up, the lighting is a normal-mapped approximation and there is no volumetric self-shadowing.
  Next step: a high/ultra-only B layer for at most 2 hero columns, at a fixed 960×540, reusing `fxDepth`, with sprites as fallback.
- **Flames are procedural**, not simulated. They look right at the game camera (tall, licking, leaning). At extreme
  zoom (< 8 m view) the repeated tongue silhouette becomes visible. The Mantaflow tall-domain atlas (`fx/tongue_*`) gave
  compact blobs; a second re-sim (vz 4, burning rate 0.55) was aborted for time. That route stays open with the §5 tools.
- **Sprite smoke from a steep camera.** Billboards face the camera, so a column seen from above is a stack of discs. The
  stretch/erosion/wisp cells hide this at 40–80 m, but a smooth 360° rotation or strong zoom can show it.
- **Ambient smoke is soft by design.** The perceived cap (0.35 over the ground, 0.5 over roofs) and the tone band keep
  plumes a light bluish-grey a little darker than the snow. In strong wind they lie flat and thin out quickly, as real
  wood smoke does. Missions can set `chimney: {…, activity}` per structure.
- **Ambient masks are ortho-only**: the unit capsules use the camera plane of the orthographic game camera (the FX run in
  the single main view only).
- **Heat haze** is screen-space, limited to 8 sources, and occlusion is a per-source depth test (a wall between the
  camera and part of a large fire can still wobble slightly at its edge).
- **Half-resolution edges.** On ultra (pixelRatio 2) the smoke is rendered at 1080p and upsampled bilinearly. There is a
  thin 1-px halo on high-contrast silhouettes behind smoke; a depth-aware upsample (from B) would fix it.
- **Pooled lights cast no shadows.** At night, fire light passes through walls (standard for pooled point lights).
- **Only validated on an RTX 5090** in headless Chromium (`--use-angle=gl`). The laptop figures are ×9 estimates.
  Integrated GPUs (Iris Xe / 680M) must be measured before the `low`/`medium` caps are final.
- **GTAO noise** makes high/ultra frames non-reproducible across reloads (engine-side). Run pixel-exact tests on medium.
