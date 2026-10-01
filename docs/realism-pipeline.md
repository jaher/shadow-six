# Realism pipeline: decisions, production plan and rendering architecture

*SHADOW SIX (Commandos: Behind Enemy Lines tribute), three.js r186. Decision document, **v2**, 2026-09-26
(v1 was written the same day from two reports; v2 folds in all six verified reports).
This is the file `docs/ARCHITECTURE.md` points to for every asset and render decision.*

## How to read this document

**Evidence base.** All six evaluation reports are now in `docs/realism-raw/`. Each has an independent
**Verification** section, written by a verifier who re-fetched the licences and re-ran the prototype.

| Area | Report | Status (v2) |
|---|---|---|
| Sourced 3D props, vehicles, set pieces | `realism-raw/models.md` | **Verified.** The verifier corrected the licence table: 10 of 42 Sketchfab models drifted. |
| Blender-scripted vehicles, buildings, props | `realism-raw/blender.md` | **Verified.** The verifier rebuilt a prototype and listed fixes: tangents, AO stacking, pivots, glass, decals. |
| PBR textures + HDRI lighting | `realism-raw/textures.md` | **Verified** (licences, the 42 asset ids, the prototype numbers). The "photographic desert" claim was **refuted**: flat stucco, fbm splat camouflage blobs, lawn grass, blue snow cast, black water, pink night lamps. |
| Characters + animation | `realism-raw/characters.md` | **Verified** route and licences. Corrections: Bandai-Namco mocap is NC (rejected), CMU residual risk, soldier pixel heights are smaller than v1 said, close zoom is not yet realistic. |
| Voices + SFX | `realism-raw/audio.md` | **Verified** engine and most sources. **Refuted:** Freesound 177556 (built from BY-NC samples) and Piper Thorsten (lessac-finetuned). The 40 m hearing cull is replaced by per-category distances. |
| Render pipeline + presets | `realism-raw/rendering.md` | **Verified** as the pipeline choice (licences, vendored-byte hashes, frame re-run, NaN fix). Timings are best-case only. Grass cards and tyre decals are visual bugs. |

**Status tags used below.** **VERIFIED** means an independent verifier confirmed it (licence fetched, prototype re-run
with matching numbers). **CORRECTED (v2)** means a verifier refuted or amended the v1 text and the fix is applied here.
Untagged items are decisions or estimates that nobody has independently checked yet.

`scratchpad/` below means `<claude-tmp>`.
It is temporary. Every prototype path listed here should be copied into the repo (`tools/`, `src/`) before it is lost; see §4 R1.

**What the synthesis author re-checked for v1 (2026-09-26), still valid:**
- **Licences, live:**
  - All 72 Freesound SFX sources were still CC0 on the day (`scratchpad/synth/fs_live.txt`). **v2:** CC0 on the
    page is not enough. 177556 is a derivative of BY-NC samples and is removed (§1.5.1).
  - Quaternius UAL1, UAL2 and UBC `License.txt` say CC0 1.0 (**VERIFIED** again by the characters verifier).
  - The MakeHuman/MPFB core-asset licence is CC0 (**VERIFIED**; LICENSE.md §D: no claim on outputs).
  - ACCAD mocap is CC BY 3.0 (**VERIFIED**).
  - Kokoro-82M is Apache-2.0 (**VERIFIED**) and Chatterbox is MIT.
  - Kenney audio packs are CC0 (**VERIFIED**).
  - pmndrs `postprocessing` 6.39.5 is Zlib and `n8ao` 2.0.1 is ISC with a CC0 repo licence (**VERIFIED**).
    glTF-Transform and meshoptimizer are MIT.
- **GPU benchmark of the render presets** at 1080p on the RTX 5090 (§3.8). **v2:** these are best-case numbers; a
  verifier on a shared GPU measured 1.3–1.7× higher GPU time.
- **The night black-frame bug**: cause isolated to NaN/Inf reaching bloom; a sanitizer pass fixes it (**VERIFIED**, §3.3).

**Honest realism verdict (all six verifiers agree).** At the game camera the prototypes read as a good modern indie
RTS, not as photographs. Tech is not the limit; **content is**.
- **CORRECTED (v2): soldiers are small.** With the brief's 40–80 m wide ortho views at 1080p, a 1.8 m soldier is about
  **45 px tall at 44 m, 33 px at 60 m and 25 px at 80 m** (characters verifier). v1's 57 px / 115 px assumed a narrower
  26 m view. Close zoom (about 20 m wide) gives about 100–120 px.
- At that size perceived realism comes from the **scene**, and for soldiers from silhouette, kit colour, animation
  quality and a contact shadow, not from faces or cloth detail:
  - lighting balance and a sun:sky ratio near 5:1,
  - terrain that does not tile, with a **level-authored** splat and a macro colour map (not fbm noise),
  - contact decals and scatter, grime and per-instance variation on buildings,
  - clutter, real vegetation (not generated grass cards), a water shader tuned to the view,
  - colour grading, haze and a moonlit (blue, not green) night grade.
- What is **production-worthy today** (rendering verifier, 1:1 crop): the terrain splat transitions, PBR buildings
  with contact shadows, and N8AO. What is **not**: grass cards (black silhouettes), tyre-track decals (dashed ladder),
  water (flat slate or black), trees (grey-green blobs), and stand-in soldiers.

This plan spends effort there first (§2.11 "realism budget").

**Screenshots** (in `docs/screenshots/`):
- `eval-pipeline-overview.jpg`, `eval-pipeline-night-nan.jpg`, `eval-pipeline-characters.jpg` (v1 synthesis).
- Per-report evaluation and verification shots: `eval-models-*`, `eval-verify-models-*`, `eval-blender-*`,
  `eval-verify_blender-*`, `eval-rendering-*`, `eval-verify-rendering-*` (including a 1:1 crop of the 1080p frame),
  and those named in each report for textures, characters and audio.

---

## 0. Decisions at a glance

| Area | Decision | Confidence |
|---|---|---|
| Textures | **Poly Haven (CC0)** first, then **ambientCG (CC0)** (**VERIFIED**: licences and all 42 ids). Download 2k JPG `diff / nor_gl / arm` sets. Terrain layers go into **`sampler2DArray` texture arrays by default** (sampler budget is 13–16 units). Ship **KTX2** (encoding still untested: `toktx` missing). Albedo clamped to about 0.75 (§1.1). | High for licence; medium for the look |
| Terrain | Splat with height blending, hex tiling and **level-authored soft splat painting plus a mandatory macro colour map**. **CORRECTED (v2):** fbm-noise splats read as camouflage blobs at 80 m. Detailed R&D in `docs/terrain-pipeline.md` (§1.8). | Medium |
| HDRI / lighting | **Poly Haven HDRIs (CC0)**, 1k `.hdr` for IBL. Sun extracted into a shadow-casting `DirectionalLight`, env texels clamped at 24, auto `environmentIntensity` (sun:sky about 5:1) (**VERIFIED**: prototype numbers reproduce). Warm fill / white balance per theater: snow had a blue cast (§1.1.5). | Medium-high |
| Small props, rocks | **Poly Haven models (CC0)**, optimised by `gltf-transform` (512–1k WebP/KTX2, meshopt) (§1.2) | High (**VERIFIED**) |
| Vehicles, set pieces from the web | **Sketchfab CC-BY via Objaverse**, only for the short list in §1.2.2 that is still CC-BY. There is a **live licence gate** at intake, a Blender split and re-bake, and an attribution record. | Medium (licence drift is real, **VERIFIED**) |
| Buildings, armour, trains, boats, modular kits | **Script them in Blender 4.2 LTS (OptiX)** with `blib.py`: model, bake a 2k atlas, then GLB. Variants are arguments: dak / grey / snow / burnt / ruined (§1.3). | High for buildings, props and wheeled vehicles; **medium-low for tracked AFVs** |
| Trees, vegetation | Bake **impostors and cards** in Blender from Poly Haven fir, pine and sapling scans (CC0). Palms: ElectroNick *Palm Trees* (CC-BY) (§1.2.3). **No runtime-generated grass cards** (verified as the worst visual defect). | Medium (untested) |
| Characters | **MakeHuman/MPFB2 (CC0) bodies** built headless in Blender 4.2.9, **rebound** onto the **Quaternius UAL skeleton (CC0)** (`rebindToUAL`, `adaptClip`). Clips: UAL1/UAL2 (CC0) plus **ACCAD (CC BY 3.0)**; procedural crawl. Target **10–12k tris, 2 materials (atlas mandatory), 1–1.5 MB** (§1.4). | Medium (route **VERIFIED**; uniforms and kit are the critical path) |
| Audio engine | Drop-in WebAudio `createAudio`: ortho listener at the camera's ground centre, StereoPanner, synthetic convolution IRs per biome, buses and a limiter, 48-voice cap. **CORRECTED (v2):** per-category `maxDistance` instead of the 40 m cull; per-mission loading and streamed ambience beds (§1.5). | High (**VERIFIED** re-run) |
| SFX | **Freesound CC0 plus Kenney CC0**, each source checked for provenance, not only its licence field (**CORRECTED:** 177556 removed). Built by `sfx_build.py` into Opus OGG plus an MP3 fallback (§1.5.1). | High |
| Voices | **Kokoro-82M (Apache-2.0)** for English, **Chatterbox Multilingual (MIT)** for German, French and shouts. **CORRECTED (v2): no Piper Thorsten** (lessac-finetuned, research-only data); no other lessac-derived Piper voices either. QA by Whisper round-trip (§1.5.2). | Medium (accents are the weak point) |
| Renderer | **WebGL2 `WebGLRenderer`**, ortho camera. **pmndrs `postprocessing` 6.39.5 + N8AO 2.0.1** chain: opaque → depth copy → transparent → AO → NaN-guard → bloom/tonemap/grade → overlays → SMAA. Four presets (§3). | High (**VERIFIED** as the pipeline choice; timings are best-case) |
| Tone mapping | **AgX in post** plus a per-theater grade (saturation −0.05, contrast +0.06, vignette; optional LUT); ACES stays a user option. Note: `CONFIG.render.toneMapping` is currently `'aces'` (renderer.js falls back to AgX only when unset), so switching the default is a one-line CONFIG change made together with the pmndrs chain. The textures report preferred ACES (punchier sky-lit shadows); the rendering A/B found that ACES skews fire to yellow and over-saturates grass. Both reports agree the grade matters more than the operator; decide in the realism loop on the final content. | Medium (unresolved A/B; tune in the realism loop) |
| VFX, water, terrain, talking faces | **Dedicated R&D tracks**, running now: `docs/vfx-pipeline.md`, `docs/water-pipeline.md`, `docs/terrain-pipeline.md`, `docs/talking-portraits.md` (§1.8). | — |

---

## 1. Final decisions per area

### 1.1 Textures and HDRI (verified report: `realism-raw/textures.md`; corrections applied in v2)

#### 1.1.1 Sources and licence (**VERIFIED**)
- **Poly Haven:** every asset is CC0, and redistribution is allowed (https://polyhaven.com/license, checked by both verifiers). The API ToS §2.4 asks scripted calls to send a unique `User-Agent`. The "Powered by Poly Haven" credit applies only to live API use, not to self-hosted files, but we credit them anyway.
- **ambientCG:** every asset is CC0 1.0, and "you can include the raw files in your project, for example a video game" (https://docs.ambientcg.com/license/).
- **Other licences in the texture set:** the three.js `waternormals.jpg` is MIT (imported from jbouny/ocean, also MIT; **VERIFIED**). All 42 Poly Haven ids (32 textures, 10 HDRIs) exist in the API (**VERIFIED**).
- **CORRECTED (v2):** the HDRI entries in `manifest.json` had an empty `source` field. Fill `source: "polyhaven"` plus the page URL for every entry before it goes into `LICENSES.json`.
- **Rejected:** Quixel Megascans (licence tied to Unreal Engine), BlenderKit "Royalty Free", and TurboSquid/CGTrader "free" (no redistribution).

#### 1.1.2 Download recipe (proven in `scratchpad/realism/pbr-hdri/tools/manifest.py`)
```bash
UA="shadow-six-assets/1.0 (+github.com/jaher)"
curl -s -A "$UA" https://api.polyhaven.com/files/<id>   # JSON: diffuse/nor_gl/arm -> {1k,2k,4k,8k}.{jpg,png,exr}.url
# texture set, 2k JPG (the source for KTX2 encoding):
curl -sLO -A "$UA" https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<id>/<id>_diff_2k.jpg
curl -sLO -A "$UA" https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<id>/<id>_nor_gl_2k.jpg
curl -sLO -A "$UA" https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<id>/<id>_arm_2k.jpg
# HDRI, 1k (IBL only; the sky is never visible from the game camera):
curl -sLO -A "$UA" https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/<id>_1k.hdr
# ambientCG:
curl -sL -A "$UA" "https://ambientcg.com/api/v2/full_json?id=Grass004&include=downloadData"
curl -sLO -A "$UA" "https://ambientcg.com/get?file=Grass004_2K-JPG.zip"   # then pack AO/Roughness/Metalness -> arm
```
Conventions the prototype verified:
- `nor_gl` is the OpenGL (+Y) convention that three.js expects; the mean colour is (127, 126, 250).
- `arm` is R = AO, G = roughness, B = metal. One texture feeds `aoMap`, `roughnessMap` and `metalnessMap`.
- Some sets name the diffuse differently (`book_pattern` uses `col1`) or leave out the AO (`cobblestone_floor_001` has it only in `arm`). The downloader must read `files/<id>` and must not guess filenames.

**Shipping format.** Encode **KTX2** from the 2k JPGs:
- UASTC for normals.
- ETC1S (or UASTC plus RDO) for albedo and arm.
- 1k mips for low and medium, 2k for high and ultra.
- Tools: KTX-Software `toktx`, or `gltf-transform uastc/etc1s`. `toktx` is not installed on this machine yet.
- **UNVERIFIED (v2):** KTX2 has not been encoded or measured yet. The memory and size figures below are estimates, and UASTC normal maps may be larger than the JPGs. Measure on one full theater set before committing the budget in §2.12.

Until KTX2 is wired in, ship **WebP**; the prototypes proved WebP works. VRAM is the reason to switch: WebP decodes to RGBA8, about 21 MB per 2k set with mips, against roughly 4–6 MB as KTX2.

#### 1.1.3 Chosen texture slots (33, all CC0; manifest in `scratchpad/realism/pbr-hdri/manifest.json`)

Tile size is the real-world size one texture repeat covers.

| Slot | Asset | Tile | Notes / use |
|---|---|---|---|
| desert_sand | PH `dense_sand` | 1.8 m | primary desert ground (warm tan) |
| desert_sand_ripples | PH `aerial_sand` | 15 m | large-scale ripples and ruts. Needs a warm tint; the verifier saw its dark blotches compete with shadows, so use it at low weight. |
| desert_rocky / alt | PH `rocky_trail_02` / `sandy_gravel_02` | 2 / 2.5 m | rocky desert, plateaus |
| dry_grass_steppe | PH `withered_grass` | 2 m | Norway olive-khaki grass, dry fields |
| green_meadow | ambientCG `Grass004` | 1.4 m | lush Normandy grass. **Texture alone reads as a flat lawn at every zoom (verifier: the biggest realism failure, 3 of 5 theaters); it needs vegetation geometry, see §1.1.4.** PH `leafy_grass` is beige (mean sRGB 151, 131, 89), so it is only an accent. |
| snow_fresh / snow_trampled | PH `snow_02` / `snow_01` | 2 m | Norway, late-war frost. Snow needs about +1.5 exposure bias. **CORRECTED (v2):** use one snow albedo and vary only normals and roughness; the cloud-shaped patches were confirmed. |
| snow_road | PH `aerial_mud_1` (slush ruts) | 8 m | `snow_05` chevrons repeat visibly along roads. Rejected for roads. |
| mud / mud_tracks | PH `brown_mud_02` / `aerial_mud_1` | 1.3 / 8 m | tracks, V2 base (M19), riverbanks |
| gravel | PH `gravel_floor_02` | 2 m | yards, rail ballast |
| dirt_road_tracks | PH `dirt_aerial_02` | 20 m | dirt roads with tyre tracks at the right scale |
| cobblestone / rural | PH `cobblestone_floor_001` / `cobblestone_large_01` | 2.4 / 4 m | towns (M15, M20), courtyards |
| paved_road | PH `aerial_asphalt_01` | 30 m | Norway asphalt, quays |
| rock_cliff / desert cliff | PH `rock_face_03` / `cliff_side` | 2.7 / 1.8 m | cliffs, outcrops (triplanar) |
| brick_wall | PH `red_brick` | 1.4 m | European buildings |
| stucco_white | PH `white_stucco` (+ `white_rough_plaster` only as a grime layer) | 2 m | desert and Tunis houses. `white_rough_plaster` at 1 m reads as camouflage. **CORRECTED (v2):** at 1:1 the stucco house read as a flat pinkish-white box. Clamp albedo to about 0.75 (real whitewash is 0.6–0.8) and add a high-contrast grime mask plus AO/edge darkening. |
| stone_wall | PH `stone_wall` | 2 m | Normandy farms, walls, the castle |
| concrete_bunker | PH `concrete_wall_007` | 2.2 m | formboard concrete: bunkers, casemates, dam, U-boat pens |
| wood_planks | PH `weathered_planks` | 2 m | huts, towers, piers |
| roof_terracotta / roof_slate | PH `roof_09` / `roof_slates_02` | 2–2.5 / 3 m | France and Belgium / Norway and castle. **CORRECTED (v2):** `roof_09` at 4 m looked oversized and chunky; use a smaller tile or another tile set. |
| corrugated_metal | PH `worn_corrugated_iron` | 1.8 m | Nissen huts, sheds, hangars |
| vehicle_paint | PH `green_metal_rust` | 1 m | base for all vehicle paint. Retint with a luminance-preserving tint to RAL 8000, 7021 or 7028. |
| canvas_tarp / burlap | PH `book_pattern` (col1) / `hessian_230` | 0.3 m | tarps, tents, sandbags |
| bark / bark_pine | PH `bark_brown_02` / `pine_bark` | 1–2 m | trees, logs |
| also used by the Blender kit | PH `rust_coarse_01`, `weathered_peeling_timber`, `wood_planks_grey`, `weathered_plank_siding`, `rough_plaster_broken`; ambientCG `Fabric045`, `Rubber004` | — | see `scratchpad/realism/blender-modeling/asset_manifest.json` (21 entries, all CC0) |

**Still missing, add in production:**
- wet beach sand and seabed (M14, BCD 1),
- harbour concrete and quay edges (M7, M13),
- tram and rail track (M15, M16),
- tarmac with snow edge,
- thatch (not needed for BEL),
- slate with snow cover (use the snow top-mask),
- ceramic tiles for Tunis roofs (M12),
- sandbag burlap in DAK tan.

All of them are available on Poly Haven or ambientCG. Search `api.polyhaven.com/assets?t=textures` by category.

**Rejected on look:**
- `sand_01`, which is olive.
- ambientCG `Ground093C`, `Ground097` and `Ground080`, which look cartoony.
- ambientCG `PaintedMetal005/006/011/013/014`, whose colours are wrong.
- `concrete_wall_008`, which is too plain.
- PH `leafy_grass` as a primary lawn.

#### 1.1.4 Terrain material (decision; the detailed R&D is `docs/terrain-pipeline.md`, see §1.8)
There is one heightfield mesh per mission, with 2 segments per metre (render-tech `terrain.js buildTerrainGeometry`). It uses `MeshStandardMaterial` with `onBeforeCompile`:
- **Layer arrays:** `DataArrayTexture` stacks for albedo, `nor_gl` and `arm`, up to 8 layers per theater (render-tech `loadLayerArrays`). **This is the default path, not an upgrade:** separate textures used 13–16 samplers, and the WebGL2 minimum is 16. Uncompressed arrays cost 117 MB VRAM at 1k, so KTX2 is needed for 2k.
- **Splat map:**
  - 4 texels per metre (`buildSplatAndHeight`). **CORRECTED (v2):** v1 painted it from `grid.terrain` plus fbm noise. At 80 m the textures verifier saw sharp, uniform "camouflage blobs" on both desert and Normandy. The splat must be **level-authored with soft brushes** (roads, field edges, wheel ruts, wear around buildings), with noise only as a small edge breakup.
  - **A low-frequency macro colour map plus a detail normal is mandatory**, not an option.
  - It also has a *damage/decal channel* for scorch marks, tracks and craters, so decals cost nothing per frame.
- **Blending:**
  - Blend layers by **height** (from the arm or an extra height map), with a soft contrast of 0.2.
  - **NaN-safe weights:** mask each layer's height with `step(w)`. Otherwise a zero-weight layer can win, all weights become 0, `normalize(0)` gives NaN, and the frame goes black (the PBR prototype hit exactly this bug).
- **Anti-tiling:**
  - Hex-tiling on small-tile layers (the `hex` option in render-tech).
  - A macro variation noise (the `macro` option).
  - An aerial 8–30 m layer at low weight, which carries believable large features: ripples, ruts, drifts.
- **Water edge:** a darker wet rim where the height is near water level. This matches the original, which shows "shorelines have a darker wet rim".
- **Vegetation is geometry, not texture.** Grass fields need tufts or cards baked in Blender from CC0 scans and colour-matched to the grass layer, dithered and faded by the splat's grass weight. The runtime-generated cards in render-tech read as black leaf silhouettes at zoom 1 (rendering verifier: "the dominant visual defect"). Until the atlas exists, **ship with grass off**. Grass is a blocker for Normandy and the Benelux.
- **Why not DecalGeometry:** it costs about 29 ms per decal on a 43k-tri terrain (measured), so it is only for walls. Ground decals go into the splat damage channel or into projected decal boxes that sample `depthRT`.

**Prototype code:**
- `scratchpad/realism/render-tech/src/{terrain.js,layout.js,proc.js}`, which is the more complete version.
- `scratchpad/realism/pbr-hdri/proto/main.js` (`terrainMaterial`, `retint`, `grime`, HDRI sun extraction).

#### 1.1.5 HDRIs and lighting presets (all Poly Haven CC0; authors for credits)

| Preset | HDRI (1k .hdr) | Author | Used for |
|---|---|---|---|
| `desert_noon` | `goegap` | Greg Zaal | M8–M11, BCD 3 (Crete) |
| `desert_town` | `goegap` or `qwantani_noon_puresky` (Greg Zaal, Jarod Guest) | — | M12 Tunis |
| `clear_day` | `kloofendal_48d_partly_cloudy_puresky` (Zaal, Guest); alt `kloofendal_43d_clear_puresky` (Zaal) | — | M6, M13–M16, BCD 2/4/5 |
| `overcast_snow` | `snowy_park_01` | Oliksiy Yakovlyev | M1–M5, M7 (Norway, Feb–Mar) |
| `overcast_snow_alt` | `snow_field_puresky` | Jarod Guest, Sergej Majboroda | alternate Norway sky |
| `overcast_temperate` | `overcast_soil_puresky` | Guest, Majboroda | M18, M19, M20 (Dec–Feb, frost), BCD 6–8 |
| `golden_hour` | `spruit_sunrise`; alt `lilienstein` (Andreas Mischok) | Greg Zaal | M17 "Before Dawn" (dawn grade), M14 option |
| `dusk` | `qwantani_dusk_2_puresky` | Zaal, Guest | optional dusk variants |
| `night` | `moonlit_golf` (moon, EU treeline) or `rogland_clear_night` (used by render-tech); `kloppenheim_02` has town glow | Greg Zaal | optional night variants and the night theater |

The original BEL is **daylight-only**: no source mentions night missions (`research-raw/visuals.md`). The "night" theater named in the architecture is therefore an optional variant; M17 and M9 dawn can use `golden_hour`.

**Lighting method.** This is proven in the prototypes; auto values are in render-tech `main.js`.

1. **Load and filter the environment.**
   - `HDRLoader` (r186; `RGBELoader` is a deprecated alias), then `PMREMGenerator` once per mission.
   - 1k is enough, because the game camera never shows the sky.
   - Clamp HDRI texels above about 24 before the PMREM, so the sun disc does not dominate the specular reflections.
2. **Build the sun light.**
   - Extract the sun from the unclamped HDRI: find the brightest region and integrate it to get direction, colour and intensity.
   - Put that into one `DirectionalLight` with shadows.
   - Then **override the azimuth** so shadows fall toward the screen's lower right, as in the original ("key light from the upper left", `visuals.md`). The textures prototype found that side light (about −80° from the view direction) reads best, and that back-light turns walls black.
3. **Set the sky fill level.**
   - `scene.environmentIntensity = skyFrac/(1−skyFrac) · sunI · sin(el) / E_sky`, with `skyFrac` ≈ 0.2. That gives 0.44 for kloofendal.
   - Unclipped goegap measures 40:1 sun:sky, which gives pitch-black shadows. Target about 5:1.
4. **Exposure bias per preset:** snow about +1.5 EV; desert noon −0.2 EV.
   - **CORRECTED (v2), snow:** overcast snow read strongly blue (mean frame RGB 126/144/172). The cause is sky-only IBL with no sun, not the asset. White-balance the IBL or add a weak warm fill light, and apply the exposure bias with a neutral grade.
   - **CORRECTED (v2), night:** the night lamp came out pink in the textures prototype and the render-tech night grade is yellow-green. Night needs a moonlit blue grade and period tungsten lamps (about 2700 K).
   - **VERIFIED:** the goegap prototype numbers reproduce (sun 17.11, sky 0.31, boost 7.9, exposure 0.152), and aerial layers fix the flat look of noise-only ground.
5. **Fog / haze:**
   - Use distance fog along the view ray. It is subtle at an ortho camera but gives depth for tall objects.
   - Add a height haze in the grade for aerial perspective on large maps.


### 1.2 Props and models from the web (verified report: `realism-raw/models.md`, with the verifier's corrections applied)

#### 1.2.1 Poly Haven models (CC0): primary source for small props, rocks and clutter
Download:
```bash
curl -s -A "$UA" https://api.polyhaven.com/files/<id>   # gltf.{1k,2k}.gltf.url + include map
```
Fetch the 1k glTF and the files in its `include` map. Then run the optimiser (below). The verified size is 0.15–0.5 MB per prop, with no visible loss at 104 px/m.

| Use | PH ids |
|---|---|
| Drums, cans, crates | `barrel_03` (recolour: modern blue → period grey/olive), `barrel_stove`, `Barrel_01/02`, `wooden_barrels_01`, `metal_jerrycan_green` (WWII can, 47 cm), `wooden_military_crate`, `old_military_crate`, `wooden_crate_01/02`, `ammo_box`, `cement_bag` (sandbag reference) |
| Lamps, misc | `Lantern_01`, `wooden_lantern_01`, `street_lamp_01` (Europe towns), `portable_searchlight`, `vintage_radio_transceiver`, `wooden_ladder`, `large_iron_gate`, `concrete_road_barrier`, `stone_fire_pit`, `hand_truck`, `old_tyre`, `rusted_spade_01`, `picke_dirty_01`, `binoculars`, `old_gas_mask`, `propane_tank`, `covered_car` |
| Weapons (held, dropped, crates) | `bolt_action_rifle_7_62` (Mosin-like; use it as a Kar98k stand-in until one is scripted), `stick_grenade`, `service_pistol`. Decimate each to under 2k tris. |
| Rocks, cliffs | `namaqualand_boulder_03/04`, `boulder_01`, `rock_moss_set_01`, `rock_face_01`, `namaqualand_cliff_01/02`, `coast_rocks_01`, `mountainside`. 65k → 3.2k tris is indistinguishable. |
| Wood clutter | `tree_stump_01`, `dead_tree_trunk_02`, `wine_barrel_01`, `modular_wooden_pier` |
| Vegetation (bake sources) | `fir_sapling`, `fir_sapling_medium`, `pine_sapling_small`, `fir_tree_01`, `pine_tree_01`, `searsia_lucida`, `shrub_02`, `wild_rooibos_bush`, `island_tree_02`, `quiver_tree_02` |

#### 1.2.2 Sketchfab CC-BY via the Objaverse mirror: live-checked short list
Download without auth: `https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-XXX/<uid>.glb`. The path comes from `object-paths.json.gz`.

**Attribution line:** `"<Title>" by <author> (https://sketchfab.com/3d-models/<uid>), CC BY 4.0, modified: split, decimated, re-textured, re-encoded.`

**Approved (still CC BY on the live Sketchfab API, 2026-09-26):**

| Asset | uid | Author | Action before use |
|---|---|---|---|
| Willys Jeep SAS Desert Patrol Car | `869dcf5c5f5943abb3e82e49b84daa17` | jeandiz | Delete the pink "star" mesh. Refit to **3.36 m** (a Willys MB), not 3.6. Split the wheels. |
| Sd.Kfz. 222 | `e44b183694e042a6b78ff8b57f8701f4` | Arbuzz747 | It is one mesh: split out the turret and wheels. Refit on **all three axes** (4.8 × 1.95 × 2.0 m); single-axis fitting made it +15/+27% too big. Retexture from winter white to DAK and grey. |
| SDKFZ 251 | `f1ef76c3419e49de9360fdcf4973aab3` | Applepie68905 | re-bake through the grime pipeline |
| Flak 18-36 88 mm | `95b1335520714a78b83f67a1c04a75da` | bear17 | spec-gloss → `metalrough`, then retexture (it comes out flat grey) |
| Flak Searchlight | `bc6233051f70457a9a13b38c46fc9cb9` | ragnar | — |
| Junkers Ju 87 Stuka | `80fe9909938a44159d1906a81092c006` | scorpion81 | decimate, **check the tail insignia** |
| BF 109 F-2 | `e48914913f2140158bee87495916d64e` | GRIP420 | "fictive" camouflage → retexture. Check the insignia. |
| Palm Trees (2 palms) | `20f8a8d5054b4191afb7cf3270dbd586` | ElectroNick | 24k → 12k tris. Leaves: `alphaTest` plus `alphaToCoverage`. |
| Tent (olive wall tent) | `979c0784868b4fdeb2b4563f65e0b5b4` | venik42 | — |
| Telephone Poles | `a76b68b838424a89b7db8a38f4c3d546` | caboose3d | the wires are procedural lines |
| Tank Trap (Czech hedgehog) | `483a5b9634b541c18180936ef434a522` | Killian_Delias | — |
| Oil Drums (3-drum group) | `f98003d19cd247f8aa4daad50c28512a` | OliverTriplett | optional; PH drums are preferred |
| Old Ammo Crate | `6a834e917e4f4194a29e9f66e6915d8a` | pajamakeke | optional |
| Old house (wooden) | `19a1121bab5a4aaaad4d973abe5b61cb` | Tim0 | Norway filler house |
| Old Well with Hanging Bucket | `7fa29793eff14a7587ee0af15446a675` | **glowbox3d** (not ra3id) | the `well` prop |
| Old wooden cart | `c06d6248b9d64173b376926ee212fd6f` | GreenG | clutter |
| Victorian Street Lamp | `b7cebcfb4b1c4d4a97e22072800704ca` | Discovered | decimate from 166k |
| Sandbags (single) | `8cda4370170746d393aa311a7c080c50` | Evanz | reference only; the modular kit is scripted |

**Live CC BY but not yet downloaded.** Candidates to test next:
- Opel Blitz 3,6-6700A (davidfalke) `dcb21bc97b61419db82389db4f1b364e`
- Opel Blitz 1939 (3DDomino) `f697ea3ecc0343a7b18607aaf397ebe0`
- Ju 52 (manilov.ap) `1d30f9ae16…`, needed for the M10 escape
- Flak 88 (shamanoff)
- Kar98k (dsamuta)
- MG 42 (caliope)
- Hangar (thetrady)
- Watch tower (_SeF_)
- Skovfogedegen oak scan (rigsters)
- Tiger 1/2, Panther and the Sherman scan, as bake or reference sources only

**Rejected (licence drift found by the verifier; never ship):**

| Rejected model | uid / author | Live status |
|---|---|---|
| *Opel Blitz Truck* | `9fedd4af…` (lokeig) | now CC BY-NC |
| *Croft Barn House* | `3c4c2689…` | now Standard store licence |
| *Sandbags – Defense line* | `e1a4c79a…` | now CC BY-SA |
| *Bunker LO36* | `5395f54f…` (matousekfoto) | licence removed |
| *Heap of construction debris* | `f76f6ec4…` (matousekfoto) | licence removed |
| *Jerrycan* | `573c8ad9…` (shedmon) | licence removed |
| *Wooden Fence* | `bd8afe2f…` (shedmon) | licence removed |
| *Pak 40 & ZiS-3* | `cb0bc925…` (Sellpet) | licence removed |
| *Dodge Truck Military ww2* | `318cab64…` | deleted |
| *U-Boat* | `eae3d9b1…` | deleted |
| *Sd Kfz 232*, *GMC CCKW scan*, *Pine Trees and Rocks rescan* | — | withdrawn |

- **Rejected on quality:** Panzer IV "Toshueyi" (toy proportions, width/length 0.70 against a real 0.47), Arabic Palmtree (stylised), Nissen Hut (colour broken after conversion), Abbey Wall Ruins (monolith, too much moss), European Buildings Pack 1 (128–512 px textures).
- **Rejected sources:** Quaternius, Kenney and OpenGameArt 3D (stylised low-poly), Smithsonian 3D and ambientCG 3D (nothing relevant).

#### 1.2.3 Intake pipeline: `tools/assets/intake.mjs`, to be built from `scratchpad/realism/cc0-models/`
1. **Download** (Poly Haven API or Objaverse URL).
2. **Licence gate (mandatory, from the verifier):**
   - `GET https://api.sketchfab.com/v3/models/<uid>` (no auth). Refuse the model unless `license.slug ∈ {by, cc0}` **today**.
   - Save the JSON with its date to `assets/licenses/<uid>.json`.
   - Refuse anything that is NC, ND, SA, Standard, withdrawn or deleted. Be wary of more models from matousekfoto.
   - Grep the description for "ripped", "extracted" and game names.
3. **Convert:** `gltf-transform metalrough in.glb tmp.glb` if the file uses `KHR_materials_pbrSpecularGlossiness`; r186's GLTFLoader cannot read it. Check the albedo afterwards for colour shifts.
4. **Clean up:** strip stray and ground meshes (baked ground discs, text labels, the "star" mesh).
5. **Normalise scale on three axes** against `assets/dimensions.json`. Reject anything more than 10% off, which also catches toy proportions. Use `Box3.setFromObject(obj, true)`; the loose variant returns a cube on meshopt-quantised files.
6. **Split movable parts** (wheels, turret, hatch) in Blender. Then optimise with `--join false --flatten false`; the defaults merge nodes.
7. **Optimise:** `gltf-transform optimize tmp.glb out.glb --simplify-ratio 0.3 --simplify-error 0.01 --texture-size 512 --texture-compress webp --compress meshopt` (verified results in `models.md` §4). Later use `--texture-compress ktx2`. **Never simplify foliage**; it thins visibly. Use impostors for foliage.
8. **Recolour and unify.** Re-bake sourced vehicles through the Blender grime and atlas stack (§1.3) so that more than 20 authors' texel densities and wear levels match.
9. **Remove insignia.** Swastikas on aircraft tails are painted out; this matches the original's German release. Keep the Balkenkreuz.
10. **Record** the asset in `assets/ATTRIBUTION.md` / `CREDITS.md`.

**Material fixes on load** (`src/engine/assets.js`):
- Foliage: `alphaTest = 0.5`, `transparent = false`, `alphaToCoverage = true`. BLEND leaves cast rectangular shadows.
- `castShadow` / `receiveShadow` on everything.
- Anisotropy 8–16.
- `setMeshoptDecoder(MeshoptDecoder)` and `KTX2Loader.detectSupport(renderer)`.

**Trees (decision): impostors.**
- Bake 8-view or octahedral billboard impostors, plus 2–3 cross-card LODs, in Blender from PH `fir_tree_01` (7.9M tris) and `pine_tree_01` (17.4M), both CC0 bake sources.
- Target: about 200–800 tris per tree, one 2k atlas per species (albedo, normal, depth).
- Deciduous trees: bake from `island_tree_02`, or model with the Blender Sapling add-on.
- This is **untested**; it is the top item in the realism loop.
- Fallback: `fir_sapling_medium` at 153k tris, only for 5–10 hero trees per map.

### 1.3 Vehicles, buildings and kits: scripted Blender production (verified report: `realism-raw/blender.md`)

**Decision.** Headless Blender Python scripts are the **main production path** for:
- all buildings,
- modular kits (walls, sandbags, wire, trenches),
- wheeled vehicles, boats and trains,
- gameplay props.

Tracked AFVs are a separate, higher-risk track (below). Everything can be rebuilt from text:
- geometry from bmesh plus modifiers,
- CC0 textures, box-projected,
- one `grime` stack,
- a Cycles bake to **one atlas per asset**: 2k albedo (with 45% cavity AO), 2k normal, 1k ORM,
- a GLB that three.js loads with no custom code.

**Tooling (pin it).**
- **Blender 4.2.9 LTS**: `https://download.blender.org/release/Blender4.2/blender-4.2.9-linux-x64.tar.xz`. The local tarball's sha256 is `dfbc127a7d28f9c2175b23bf9d6701b2855f31eedfb391f9a6e60adb24572846`. Compare it with the official `.sha256` file in a browser; the download site sits behind a Cloudflare check for curl.
  - The system Blender 4.0.2 has **no sm_120 kernels**, so it bakes on the CPU only, 5–10× slower.
  - 4.2 needs `--python-use-system-env` plus `PYTHONPATH` for Pillow (a cp311 wheel installed into `pydeps42/`).
- Wrapper `tools/blender.sh`: it downloads, checks the sha256, unpacks into `~/.cache/shadow-six/blender-4.2.9/`, and runs `blender -b --factory-startup --python-use-system-env "$@"` with `BAKE_DEVICE=GPU`.
- The first OptiX run JIT-compiles kernels (about 80 s, then cached).
- Run 2–3 Blender processes in parallel. A full rebuild of about 80 variants takes **30–40 min on the RTX 5090**.

**Code to move into the repo** (from `scratchpad/realism/blender-modeling/`):
- `blib.py` (952 lines): geometry helpers, UVs, `NG` node builder, `pbr_layer`, `grime`, `unwrap_atlas`, `bake_atlas`, `export_glb`, `preview`.
- Asset scripts: `truck.py` (Opel Blitz, `dak|grey|burnt`), `house.py` (North-African house), `tower.py` (watchtower).
- Helpers: `lod.py`, `glbpack.py` (pure-Python WebP repack), `scene_render.py`, `web/{server.mjs,viewer.html,shot.mjs}`.
- Target layout: `tools/blender/{blib.py,assets/*.py,lod.py,glbpack.py}`, `tools/build_assets.py`, `assets/registry.json`.

```bash
BAKE_DEVICE=GPU tools/blender.sh --python tools/blender/assets/truck.py -- full dak 2048   # model → bake → GLB → preview
tools/blender.sh out/truck_dak/truck_dak.blend -P tools/blender/lod.py -- assets/models/truck_dak 0.5 0.2
python3 tools/blender/glbpack.py out/truck_dak/truck_dak.glb assets/models/truck_dak.glb --webp   # 2k/2k/1k
```

**Fix before scaling past the four prototypes.** These are the verifier's findings:
1. **Tangents.** Export with `export_tangents=True`. three.js otherwise derives tangents from screen-space derivatives, which do not match the MikkTSpace bake and produce seams on the house's high-to-low normals.
2. **AO is counted three times:** in the albedo cavity, in the ORM `aoMap` and in N8AO. **Rule: keep the cavity AO in the albedo at 45%, set `aoMapIntensity` to 0.5, and give N8AO a small radius** (§3.4). Tune once on a dressed tile.
3. **Pivot at ground centre.** `house_a` spans x −4.46…+6.46, which fails the validator. Fix it in `house.py`.
4. **Glass.** Windows are opaque black today. Add a dark glass material: roughness 0.05, specular on, receiving env reflections; optionally a faint interior card.
5. **Every dark decal or soot material gets `Specular IOR Level` = 0** (exported as `KHR_materials_specular {specularFactor: 0}`). This was the navy-blue scorch bug.
6. **Decal and tint kit:**
   - Per-instance tint through an instanced colour attribute.
   - Per-instance wear through a vertex colour or a `userData` uniform.
   - A shared decal atlas: cracks, stains, soot streaks, unit markings, number plates, posters, shutters.
7. **Push grime contrast and micro-normal detail** so scripted assets match the photoscanned Poly Haven rocks and props next to them.
8. **Bakes are not bit-identical** (about 5/255 noise). CI must diff tri counts and dimensions, not pixels.

**Budgets** (validated by the prototypes):

| Class | LOD0 tris | Textures | LODs | GLB |
|---|---|---|---|---|
| Wheeled vehicle, boat | 8–15k (truck 13.8k, burnt 10.8k) | 2k albedo, 2k normal, 1k ORM atlas. Wheels, turret, doors and hatches are separate nodes, each baked in its own pass. | 50% / 20% (Decimate, UV+SHARP delimit) | ≈1.0–1.2 MB WebP |
| Tracked AFV | ≤20k | same | same | ≤1.5 MB |
| Building | 3–10k (house 7.2k) | unique 2k atlas. Buildings over 15 m add a shared tiling trim sheet. | 50% | ≈0.9 MB |
| Tower, large prop | ≤5k (tower 5.2k) | 1k–2k | none | ≈1 MB |
| Small prop | 0.3–3k | a shared prop atlas, or instanced | none | ≤0.3 MB |

- **Pick the LOD by zoom level**, not by distance: zoom 0.55 → LOD1 or LOD2. The camera is fixed.
- A dense mission (200–300 instances) comes to about 1.5–3M tris at LOD0, which is easy on the 5090.

**Variants and damage.**
- **Climate** is a material-only argument:
  - `dak` uses RAL 8000; `grey` uses RAL 7021; RAL 7028 dunkelgelb is for 1943 and later.
  - `snow` is a top-dust mask with a white albedo, lower roughness breakup and a flattened normal. It needs no extra geometry. It was **named in `tower.py` but never implemented**.
- **Vehicles, `burnt`** (proven):
  - a heat-field material,
  - soft parts removed (canvas, tyres, glass, 45% of the planks),
  - sag and lean,
  - a ground scorch decal.
  - Or ship only the alternate atlas (≈0.6 MB) when the UVs are identical.
  - The burning phase belongs to VFX; swap the model when the fire ends.
- **Buildings, `ruined`:**
  - Boolean "bite" cutters shaped by noisy voxel remesh, or Cell Fracture.
  - Instanced rubble: 3–5 unique chunks plus beams. Scorch streaks above the openings.
  - About +30% tris.
  - In-mission blast damage = the intact mesh plus decals; the full ruin mesh swaps in only on destruction (`Interactable.onDestroyed`).

**Tracked AFVs (Panzer II/III/IV, the Sd.Kfz. 251 if it is scripted, Flak 38).**
- Script them from **blueprint dimensions**, with human review of silhouette sheets.
- Tracks: a geometry-nodes link array, or a scripted instanced link along a curve, plus separate road-wheel nodes.
- Plan **3–6 h each**, not 1–2 h.
- Alternative: use the live CC-BY Tiger, Panther or Sherman scans only as bake and reference sources. No free Panzer II/III/IV at correct proportions exists.

**Effort** (from the report):
- Vehicles 1–2 h each; tracked vehicles 3–6 h.
- Buildings about 1 h each. Simple props 10–20 min each.
- About **30–50 agent-hours for about 40 types**, plus 1–2 human contact-sheet reviews.

### 1.4 Characters and animation (verified report: `realism-raw/characters.md`; prototype `scratchpad/realism/characters/`)

**Decision: MakeHuman bodies on a Quaternius skeleton.**
- **Bodies:** MakeHuman bodies from **MPFB2** (Blender extension 2.0.8) with **CC0 system assets**.
- **Skeleton:** **rebound onto the Quaternius Universal Animation Library skeleton** (UE-style, 65 bones, CC0). All UAL clips then play natively.
- **Mocap (CORRECTED v2):** ACCAD (CC BY 3.0) has the right actions (crawl, lie, look around) but **its BVH rest pose is broken** (torso along +X, L/R hips inconsistent), so a world-delta retarget turns the belly crawl into a supine crawl. The **prone crawl is now procedural** (`web/crawl.js`, our own code: `makeProneCrawl`, direction-keyed), which reads well from above (**VERIFIED**). ACCAD stays usable after fixing its rest pose in Blender (import BVH, apply frame-0 rest, re-export) for go-prone / stand-up transitions and `LookAround`. CMU BVH retargets correctly (standard T-pose) and is the fallback (restrictions below).
- **Kit:** period kit is separate meshes attached to bones.
- **Result (VERIFIED, with limits):** the rebind has no stretched limbs, purple joint blobs or floating bones; the 1:1 crops at 44–60 m view width show plausible human figures with correct proportions and gait, clearly better than mannequins (`docs/screenshots/eval-verify-characters-sheet.jpg`, `eval-verify-characters-game44m-1to1.jpg`).
- **Not yet realistic at close zoom** (verifier, `eval-verify-characters-close.jpg`): the M35 helmet sits low over the eyes and looks like plastic; the officer's cap is oversized; the civilian suit's lapels and striped shirt show; the Kar98k is a brown box with a rod; fingers are open and the left hand floats off the fore-stock; every "german" has the same face; the diver reads as a dark-skinned naked man, not a wetsuit. It is a strong technical base with placeholder dressing.
- **Pixel reality (CORRECTED v2):** at the brief's 40–80 m view widths a soldier is 25–45 px tall (§ How to read). Faces, skin and textile detail are invisible there; silhouette (helmet, webbing, rifle), uniform colour and value, animation quality and contact shadow carry realism. Faces matter only at close zoom and in portraits (`docs/talking-portraits.md`).

**Licences (checked 2026-09-26; all re-fetched and VERIFIED by the characters verifier):**
- MakeHuman/MPFB: "All core assets are shared under Creative Commons, CC0 … you do not need to … give attribution" (static.makehumancommunity.org/about/license.html). MPFB's code is GPL but is not shipped.
- **Use only system assets** from `makehuman_system_assets_cc0.zip`. Community assets carry their own licences (often CC-BY) and must be checked one by one.
- Quaternius UAL1, UAL2 and Universal Base Characters: `License.txt` says CC0 1.0.
- ACCAD: "Open Motion Project by ACCAD/The Ohio State University is licensed under a Creative Commons Attribution 3.0 Unported License". This credit line goes in CREDITS.
- **Rejected:**
  - Mixamo: Adobe terms, and raw animation files cannot be redistributed in a public repo.
  - **Bandai-Namco Research Motion** (CC BY-NC 4.0; the report mislabelled it NC-ND) and **Ubisoft LAFAN1** (CC BY-NC-ND): NC.
- **CMU mocap: allowed with restrictions (CORRECTED v2).** It is a custom licence (free for any use, "not resell … even in converted form"), not an open one. A public repo can be forked and resold, so there is a residual risk. Prefer UAL/ACCAD clips. Use CMU only for actions nothing else covers (`111_03` crawl reference, `90_16` fall-on-face death, `13_33` ladder), **baked into `anims.glb`, never as a raw BVH folder**, with the credit "Motion data from mocap.cs.cmu.edu (NSF EIA-0196217)".
  - Quaternius UBC bodies: stylised, not realistic. They remain a fallback mannequin.

**Pipeline** (prototype code; move it to `tools/characters/` and `src/art/`):
1. `mpfb_make2.py`. Run it as `BLENDER_USER_RESOURCES=…/bl_user blender-4.2.9 -b -P mpfb_make2.py -- out.glb '{"skin":…,"clothes":[…],"age":…,"muscle":…,"height":…,"tint":…}'` (the MPFB extension must be enabled in that user dir). It does the following:
   - Creates the human with `create_human(detailed_helpers=True, …)`.
   - **Root cause of the earlier broken limbs:** `detailed_helpers=False` leaves no `joint-*` vertex groups. The rig then fits template coordinates about 0.9 m below the mesh.
   - Adds the `game_engine` rig, a skin, CC0 clothes (`male_casualsuit01–06`, `male_worksuit01`, `shoes03` boots, `fedora`) and an optional proxy mesh.
   - Bakes shape keys, tints, and downscales textures to 1k JPEG.
2. Runtime `web/rig.js`:
   - `rebindToUAL()` poses and fits the UAL skeleton to the MakeHuman bind joints, recomputes `boneInverses` and remaps `skinIndex` by bone name.
   - `adaptClip()` **strips the `.position` and `.scale` tracks on every bone except the pelvis.** UAL GLB clips carry T+R+S tracks on all 65 bones, which stretches limbs on other proportions.
   - `retargetBVH(bvh, ual1.scene, {map: BVH_MAPS.cmu})` retargets CMU BVHs correctly (ACCAD needs its rest pose fixed first).
3. `web/props.js`: procedural M35 helmet, Kar98k, belt, peaked cap and beret (placeholders: fine at game scale, crude up close).
4. `web/crawl.js`: `makeProneCrawl`, `overrideUpper(clip, upperClip, {t})` (e.g. rifle walk = `Walk_Loop` + `Pistol_Aim_Down`) and the rifle sockets: `attachRifleHand` (trail/carry on `hand_r`), `attachRifleInPose` (low ready, character-space direction), **`attachRifleAuto({mode:'shoulder'})`** (butt on the right shoulder, axis to the palms' midpoint: aiming) and `attachRifleBack` (slung on `spine_03`). Keep these socket functions when the placeholder meshes are replaced. Demos: `scenes/r4_lineup.js`, `r5_final.js`, `b1_perf.js`.
5. Root causes fixed in the prototype (report §7, **VERIFIED** to hold): `detailed_helpers=True`, clip position/scale stripping, and the rest listed there. Read §7 before porting.

**Production decisions:**
- **Do the rebind offline.** A Node or Blender step writes one GLB per character that is already skinned to the UAL skeleton. The clips go in **one shared `assets/anims/ual_clips.glb`**: the UAL1 and UAL2 subset plus the retargeted ACCAD clips plus our own authored clips. Runtime then needs no fitting; `AnimationMixer` clips are shared by name.
- **Budgets.** Today each GLB is about 30k tris, **7 materials**, 53 joints and 4.3–5.7 MB (german: 5.24 MB, 30,016 tris; **VERIFIED**). Bench: 30 animated soldiers at 1080p in **3.62 ms/frame**, mixers 0.19 ms, rebind about 3 ms per character type at spawn, on a bare stage. Wide maps hold 30–60 enemies, so **the atlas (1–2 materials, 2 draw calls) and LOD are mandatory, not optional** (verifier).
  - Target LOD0 **≤ 12k tris**: delete body faces under clothes (the MPFB delete-group helpers) and use the low-poly eyes and brows.
  - LOD1 ≈ 5k for zoom 0.55.
  - One 1k atlas per variant (albedo, normal, ORM) plus shared skin and face textures.
  - **≤ 1.5 MB** per character, KTX2.
  - 40 enemies × 12k = about 0.5M skinned tris.
  - Update mixers only for on-screen units, and at 30 Hz or 15 Hz at zoom 0.55.
  - Clips: one `anims.glb` with only the used tracks after `adaptClip` (quaternions only), estimated 1–2 MB for 30 clips (not measured).
- **Uniforms (period-accurate): the critical path to "extremely realistic"** (verifier risk 1; not yet estimated). MakeHuman's CC0 wardrobe is civilian; a tinted `male_casualsuit05` passes as a field tunic only at game distance. Build the garments as Blender-scripted meshes fitted to the MakeHuman base (or authored as MakeClothes `.mhclo`), textured with CC0 fabrics (ambientCG `Fabric045`, PH `book_pattern`, `hessian_230`) and baked folds:
  - Heer M36 feldgrau tunic, trousers and jackboots.
  - DAK tropical tunic, with field cap or pith helmet.
  - Winter white smock and trousers.
  - Officer's tunic, breeches and peaked cap. The **Spy's disguise uses the same mesh**.
  - Black Panzer wrap for tank crews.
  - Kriegsmarine / harbour guards (M7, M13): optional.
  - British battledress for the Sniper, Sapper and Driver; beret, cap or helmet per role.
  - The Green Beret's battledress with rolled sleeves.
  - The Marine's wetsuit with rebreather and fins. The current diver suit is purple and orange (from the MakeHuman "special_suit" skin) and must be retextured.
  - The Spy's civilian suit.
- **Kit (Blender-scripted, CC0 textures, or CC0 museum scans / the CC-BY Kar98k by dsamuta from §1.2.2).** Webbing, pouches, gas-mask canister and bread bag are the **key silhouette cues at 30–45 px**. Build these properly, replacing the procedural web meshes: M35 helmet, Kar98k, MP40, Luger, Lee-Enfield No. 4 with scope (Sniper), Thompson (Driver), Colt pistol, knife, harpoon gun, sapper's knapsack, Y-strap webbing, pouches, gas-mask canister, bread bag, canteen, binoculars.
- **Faces and silhouettes.** Each commando needs a distinct silhouette:
  - MPFB macros: height 2.10 m for the Green Beret, 1.75 m for the Sapper, and so on (`research-raw/characters.md`).
  - Face targets.
  - Headgear. The architecture contract lists beret / sniper cap / diving mask / sapper helmet / driver cap / spy hat.
  - **Vary faces per instance** with MPFB macro and target randomisation (today one GLB per type = identical faces).
  - Close-up portrait quality belongs to the talking-portraits R&D (§1.8, `docs/talking-portraits.md`).
- **Close-zoom shading** (verifier risk 3): plain `MeshStandardMaterial` looks waxy on skin and plastic on wool up close. Add `MeshPhysicalMaterial` **sheen** on cloth, a cheap **wrap/SSS term on skin** (close-zoom preset only), and baked cloth-wrinkle normal/roughness maps.
- **Close-zoom fixes before any showcase (CORRECTED v2):** helmet `drop` 0.155 → about 0.11 (brim at the brow); peaked cap scale about 0.8 with less drop; diver gets a black rubber wetsuit material (roughness about 0.35, desaturated near-black, no skin texture), not darkened skin; left-hand IK on the fore-stock; closed grip fingers.
- **Known visual bugs:** foot sliding is the most visible tell at 30–45 px, so **speed matching or root motion per clip is required**; the rifle on the back sticks up while crawling (attach it to `spine_03` with a crawl-specific offset); the hair clips through helmets (hide the hair, as `dressMaterials({hideHair})` already does).

**Animation mapping** (the names come from `ARCHITECTURE.md`):

| Game anim | Source clip | Route |
|---|---|---|
| `idle`, `walk`, `run` | UAL1 `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop` / `Sprint_Loop` | download (CC0) |
| `crawl`, `crawl_idle` | **procedural `makeProneCrawl`** (`crawl.js`, **VERIFIED** reads from above). Transitions go-prone / stand-up: ACCAD `A8_CrouchToLie`, `A10_LieToCrouch` after a Blender rest-pose fix, or keyed like the crawl; CMU `111_03` as reference | code (+ BVH, CC BY) |
| crouch-walk (spy, sneaking) | UAL1 `Crouch_Fwd_Loop`, `Crouch_Idle_Loop` | download |
| `swim`, `dive` | UAL1 `Swim_Fwd_Loop`, `Swim_Idle_Loop`; `dive` = swim plus a pitch-down root offset | download + code |
| `aim`, `shoot` (pistol) | UAL1 `Pistol_Aim_*`, `Pistol_Shoot`, `Pistol_Reload` | download |
| `aim`, `shoot` (**rifle, SMG, MG**) | interim: UAL1 `Pistol_Aim_Neutral/Up/Down` + `attachRifleAuto({mode:'shoulder'})`; rifle walk = `overrideUpper(Walk_Loop, Pistol_Aim_Down)`. Final: **no free source.** Author an **upper-body additive layer** (spine and arms masked) in Blender on the UAL skeleton: rifle hold, aim, recoil, bolt cycle, MP40 hip fire, MG gunner seated | Blender script |
| `stab` | author (knife thrust); UAL1 `Sword_Attack` as a base | Blender |
| `punch` | UAL1 `Punch_Jab`, `Punch_Cross` | download |
| `throw` (grenade, decoy) | UAL2 `OverhandThrow` | download |
| `plant` (bomb, trap), `use` | UAL1 `Fixing_Kneeling`, `Interact`, `PickUp_Table`; UAL2 `Chest_Open` | download |
| `climb` | UAL2 `ClimbUp_1m` for low walls. Author loops for pole, wall and rope climbing (the Green Beret's key ability) | download + Blender |
| `carry_idle`, `carry_walk` | UAL2 `Walk_Carry_Loop` plus a posed idle; the body is parented to the shoulder bone | download + code |
| `die`, `dead` | UAL1 `Death01` (**VERIFIED** reads from above), `Hit_Chest`, `Hit_Head`; UAL2 `Hit_Knockback`; extra variants CMU `90_16`, `85_15` (baked only); `dead` = the last frame | download |
| `surrender`, `salute` | author: hands-up hold, salute | Blender |
| `look_around` | ACCAD `Male2_A4_LookAround` | BVH |
| drive / man gun / sit | UAL1 `Driving_Loop`, `Sitting_*` | download |
| talking / radio (briefing, sergeant) | UAL1 `Idle_Talking_Loop`; UAL2 `Idle_TalkingPhone_Loop`, `Idle_FoldArms_Loop`, `Yes`, `Idle_No_Loop` | download |

- Crossfade 0.15–0.25 s. Clips are in place, and playback rate = unit speed / clip speed.
- At 25–45 px (normal views) foot IK is not needed, but **foot sliding is visible**: match playback rate to ground speed per clip. Left-hand IK on the rifle fore-stock is needed for close zoom. The UAL pistol clips look generic and modern; a bolt-action cycle and a proper rifle aim are unbuilt (verifier risk 4).

### 1.5 Voices and SFX (verified report: `realism-raw/audio.md`; prototype `scratchpad/realism/audio/` (`$W`), voices `scratchpad/voices/`)

This **replaces the architecture's "all sounds synthesized" line.** Real recorded CC0 SFX plus neural TTS voices are now the plan; the `createAudio` interface is unchanged.

**Verifier's verdict:** the SFX pipeline and runtime are sound and reproducible (**VERIFIED** re-run on the RTX 5090: pan split 9 dB, occlusion HF drop about 16 dB, limiter peak −0.63 dBFS, 8 loop seams OK, offline render 47× realtime; the 24 s town mix is full-band with a real stereo image). Two licence claims and one design flaw were wrong; all three are fixed below.

#### 1.5.0 Runtime: `lab/engine.js` becomes `src/audio/audio.js` (**VERIFIED**)
- About 270 lines, no dependencies, drop-in for the stub: `createAudio(events)` unchanged, plus `setAmbience`, `setEnvironment`, `loadManifest(url, {categories})`, `tickAmbience`, `unlock`. `SOUND_MAP` and `BIOMES` move to `src/audio/sounds.js`.
- **Listener for the ortho camera:** the camera centre on the ground plus yaw (`audio.update(cx, cz, yaw)`); pan = lateral offset / half-width through a `StereoPannerNode` (HRTF at the real camera height would make everything equally far and centred). **CORRECTED (v2):** use the **live frustum half-width** (zoom-aware), not the hard-coded `viewHalfWidth: 30`.
- Air-absorption low-pass (20 kHz at 0 m to about 3.5 kHz at 120 m), optional speed-of-sound delay (cap 250 ms), occlusion callback `world.occlusion(x,z,lx,lz)` reusing the LOS raycast (700 Hz low-pass, −9 dB), distance-scaled reverb send.
- **Synthetic outdoor IRs** built in about 1 ms (`open` 1.4 s, `snow` damped 0.8 s, `town` facade slapbacks 1.8 s, `harbor` 2.4 s); measured CC-BY IRs (OpenAIR, per-file licence check) are a later upgrade.
- Buses sfx/amb/voice/ui/music → glue compressor → limiter; round-robin with detune and gain jitter; voice caps (footstep 10, gun 14, explosion 6, voice 4, total 48) with quietest/oldest stealing.
- **Distance model (CORRECTED v2):** v1 attenuated everything to silence at `CONFIG.audio.hearingRadius` (40 m). That is the legacy **AI hearing** radius; as a playback cull it silences shots the player can see at the screen edge (−180 dB at 45 m) and makes a rifle at 35 m sound like a toy. Use **per-category `maxDistance` and rolloff**: footsteps/cloth/knife about 30 m, voices about 60 m, small arms about 400 m (ref about 25 m, gentle rolloff), MG and explosions about 1.5 km. Let air absorption and reverb carry distance. AI hearing stays in the stealth/noise system.
- **Distance timbre:** add `*_distant` layers per weapon family (or crossfade `sniper_echo` / `explosion_distant` tails by distance); low-pass on one close recording is not enough.
- **Memory (CORRECTED v2):** 187 MB decoded for 39 categories, so **per-mission loading and streamed ambience beds are mandatory**.

#### 1.5.1 SFX
- **Sources:**
  - **Freesound, CC0 only**: 72 source sounds (the verifier re-fetched a sample of 10: all CC0). **CC0 on the page is not enough: check the description for derived material (CORRECTED v2).** All 72 were re-checked live on 2026-09-26; list in `scratchpad/synth/fs_live.txt`, metadata in `realism/audio/fsq/*.jsonl`.
  - **Kenney CC0 packs** (**VERIFIED**): `impact-sounds` (footsteps on carpet, concrete, grass, snow and wood; impacts), `rpg-audio` (doors, knife, cloth, creaks), `interface-sounds`, `ui-audio`, `voiceover-pack`.
- **Period-authentic highlight:** **craigsmith**'s 1930s–40s Hollywood nitrate FX libraries (donated to USC and released CC0 via Freesound): distant artillery, MG bursts, a hand-crank siren, a tank engine.
- **Provenance rejects:**
  - morganpurkis MG42 `387508` and SMG `390663`: edits of *Day of Infamy* game SFX.
  - Any sound whose description mentions a game or a film rip.
  - **REMOVED (v2): Hugofski `177556`** (was `explosion_large_177556_0`): built from Superex1110 77535 and keston 61807 (**CC BY-NC 4.0**) and dkustic 76145/76146 (CC BY 3.0); the uploader could not relicense them. Delete it from `picks.py`, the manifest and the built files; keep unfa `156500` (synthesised CC0) or pick a replacement.
  - **Uncertain provenance:** SuperPhat `410442` Lee-Enfield ("stacked" recordings, source unstated). Prefer kyles `450852` as the primary Lee-Enfield. `163456` ("used in a flash game") appears to be the author's own recording: acceptable.
  - qubodup's sniper sounds come from US-military public-domain video (DVIDS). That is acceptable; note it in CREDITS.
- **What exists now (VERIFIED: 512 non-empty OGG, 512 manifest entries, all CC0-1.0):** `tools/sfx_build.py` turns the sources into **41 Freesound categories plus Kenney, 512 files (9.2 MB OGG: 5.6 MB Freesound-derived, 3.6 MB Kenney)**, plus `out/web/sfx/manifest.json` with source URL, author and licence for every file:
  - **one-shots:** split on silence into round-robin variants, mono, peak −1 dBFS, Opus 64k.
  - **loops:** a steady segment with an equal-power crossfade, stereo Opus 96k.
  - **long cues:** a trimmed excerpt.
  - Categories: rifle (Lee-Enfield, M1), bolt cycle, pistol, Thompson, heavy MG, period MG, sniper echo, ricochet, casings, knife, body fall, footsteps (sand, grass, gravel, snow, wood, metal, running wood), crawl, grenade, large and distant explosions, artillery bed, bomb tick, air-raid and hand-crank sirens, dog, tank and truck engines, splash, swim, desert and snow wind, birds, crickets, radio static, Morse, wood and metal doors, small metal.
- **Format decision:** **Opus-in-OGG primary, MP3 fallback** (for older Safari). **CORRECTED (v2):** only **134 MP3 twins exist, all Freesound**; the 378 Kenney files are OGG-only, so older Safari/iOS gets no Kenney footsteps or UI. Build MP3 (or AAC) twins for Kenney too, and test gapless loops on Safari; decode with `decodeAudioData`. The files are **HQ previews** (`cdn.freesound.org/previews/<id//1000>/<id>_<user>-hq.mp3`, about 183 kbps). Originals need a Freesound login or OAuth token. Previews are fine at game scale; fetching originals is optional later work (a user token is needed).
- **Mixing rules** (from the research: the original has almost no in-mission music):
  - Positional sounds are attenuated by distance to the camera centre with **per-category `maxDistance`** (§1.5.0; not the 40 m `hearingRadius`).
  - A low-pass filter when the source is behind a building.
  - Ambience beds per theater crossfading over about 4 s, plus positional **sweeteners** every 6–20 s (distant dog, far shelling, a door in town). This deliberately restores the demo's "noisy mother nature" layer.
  - Beds today: desert `wind_desert` (KasDonatov 402710), snow `wind_snow`, countryside/town birds plus breeze, night crickets, front `artillery_period` (craigsmith). **Coasts and harbors have no bed at all yet** (surf, lapping, gulls, rope and hull creak are the first gap to fill).
  - **German weapons (authenticity gap):** Kar98k and MP40 borrow the Lee-Enfield and Thompson; there is no MG42. Stopgap: procedural MG42 by re-triggering the `mg_heavy` transient at 20 Hz ±3 % jitter; replace with a clean-provenance CC0 recording if found.
  - Footsteps: the animation emits `step_<surface>` from the terrain material (sand, grass, gravel, snow, wood, metal, concrete; add mud and wading).
- **Still missing:**
  - vehicles: motorcycle, boat engine, rowing, tram bell and rails, train (steam loco plus whistle), Ju 52 and autogyro propellers, cable-car motor;
  - water: surf and lapping;
  - tools and weapons: harpoon, wire cutters, shovel, decoy clockwork, spy syringe, torpedo launch and hit;
  - world: generator hum, searchlight carbon-arc hum, church bell, bridge creak, steel door, prison-camp ambience, V2 hiss (M19), crane and floodgate machinery (M13), dam break (M3), castle bell (M20), music stingers.
  - ambience: flies and canvas flap (desert), snow creak, ice and pine gusts (Norway), cows and stream (France), owl, frogs (night), aircraft (Ju 52, Stuka dive).
  - Same route for all of them: Freesound CC0 search (`tools/fs_search.py`) with the same live licence **and provenance** gate, then `sfx_build.py`; `lab/procedural.js` fills a category until then. Stingers and music: CC0 orchestral from Freesound/OpenGameArt, or commission.
  - CREDITS: a script over `manifest.json` emits `CREDITS.md` (author, URL, CC0) with provenance notes for craigsmith and qubodup.

#### 1.5.2 Voices
**Engines:**
- **Kokoro-82M** (`hexgrad/Kokoro-82M`, **Apache-2.0**, run with `kokoro-onnx`) is the **main English voice**. The British voices `bm_george`, `bm_lewis`, `bm_daniel` and `bm_fable`, and the American `am_michael`, `am_onyx`, `am_eric`, `am_fenrir` and `am_adam`, all round-trip through Whisper with similarity of about 0.87–1.0.
- **Chatterbox Multilingual** (`ResembleAI/chatterbox`, **MIT**, torch plus CUDA) is used for:
  - **German** enemy barks with native pronunciation,
  - the **French** Spy,
  - **expressive** shouts and pain (`exaggeration` 0.6, `cfg_weight` 0.5).
  - It is proven to run on the 5090: `scratchpad/voices/raw/cbtest/{en,fr,de}_*.wav`.
  - Its outputs carry an inaudible Perth watermark, which is harmless.
  - Zero-shot cloning needs a reference clip. **Tightened in v2 to match the project rule "never clone real people's voices":** a CC0 dataset (Thorsten-Voice) or a LibriVox reader is still a real, identifiable person, so do **not** clone them. Use Chatterbox's built-in default conditioning with pitch/tempo/exaggeration variation, or recordings from consenting project contributors (consent recorded in CREDITS). Never clone an actor or the original game's cast.
- **Piper: CORRECTED (v2), effectively out.** Every Piper voice's licence follows its dataset (`MODEL_CARD`):
  - **`de_DE-thorsten-high` is "Finetuned from U.S. English lessac voice"** (verifier), so it carries the lessac/Blizzard-2013 research-only taint despite its CC0 dataset. v1 kept it as the German fallback; **do not ship it.** The same applies to thorsten-medium/-emotional, `en_US-joe`, `en_GB-vctk`, `northern_english_male` and most English "medium" voices.
  - `en_US-norman` (LibriVox PD, trained from scratch) is the only clean candidate, and it was not re-checked by the verifier: re-read its MODEL_CARD before use.
  - Kokoro's accented German fails the QA gate ("Feuer", 0.76–0.84), so **enemy German depends on Chatterbox alone**. Its fallback is a second Chatterbox voice, then Kokoro-accented German for non-critical barks.
- **Rejected:**
  - `en_GB-alan` (dataset "All Rights Reserved", also lessac-finetuned; **VERIFIED**).
  - Semaine, Pavoque, hfc_male and ryan (NC).
  - `en_US-lessac-high` (research-only).
  - `de_DE-mls-medium`, which babbles; Whisper similarity 0.15–0.23.

**Casting by accent** (research: `research-raw/characters.md`, `visuals.md` §10.3; write **new lines**, never copy the originals):

| Role | Voice target | First choice | Fallback |
|---|---|---|---|
| Green Beret (Irish boxer, 2.10 m) | deep Irish | Chatterbox with a consented contributor's Irish reference | Kokoro `bm_lewis`, lowered 1–2 semitones |
| Sniper (upper-class, ice-cold) | RP English | Kokoro `bm_george` or `bm_fable` | Chatterbox |
| Marine (Australian, sarcastic) | Australian | Chatterbox with a consented contributor's AU reference | Kokoro `bm_daniel` |
| Sapper (Liverpool, fire brigade) | English (Scouse optional) | Kokoro `bm_lewis` or `bm_daniel` | — |
| Driver (Brooklyn) | American | Kokoro `am_michael` or `am_onyx` | Chatterbox; Piper `norman` only after a MODEL_CARD re-check |
| Spy (French, speaks German) | French-accented English, plus German | Chatterbox `fr` / `de` | Kokoro accented |
| Col. Montague Smith (briefings) | older British officer | Kokoro `bm_george`, slower, with a radio or room IR | Chatterbox |
| German soldiers (3–4 voices), sergeant, officer, MG gunner | native German | Chatterbox `de` (default conditioning with varied pitch/exaggeration, or consented contributors' references) | another Chatterbox reference; **not Piper Thorsten (CORRECTED v2)** |

**Post-processing** (`tools/post.py`):
- trim,
- active-RMS level to −20 dBFS,
- soft-limit at −1 dBFS,
- **Opus 40k mono** (about 5.6 KB per bark; 322 prototype files are 1.79 MB).
- There is also a `_radio` variant: 350–2800 Hz bandpass, tanh saturation, hiss and squelch. Whisper still recognises it, except "Feuer" and "Halt".

**QA gate:** `tools/eval_voices.py`, a faster-whisper-small round-trip. Similarity must be at least 0.85. Also check f0, clipping and silence padding.
- Kokoro with `lang='de'` (accented German) scores 0.76–0.84 and fails "Feuer", so it is **not for enemy Germans**.

**Talking portraits.** The user wants lip-synced faces. Portrait lip-sync keys can come from Kokoro's native phoneme timings, or from a wav2vec2 phoneme CTC alignment. That R&D now runs as a dedicated track (§1.8, `docs/talking-portraits.md`).

### 1.6 Rendering pipeline: summary (verified report: `realism-raw/rendering.md`)
WebGL2 `WebGLRenderer` with an orthographic camera and one `DirectionalLight` sun with **PCF** shadows (`PCFSoftShadowMap` is removed in r186, **VERIFIED**). The post chain moves from the engine's three-addon `EffectComposer` to pmndrs `postprocessing` 6.39.5 plus **N8AO** 2.0.1 (**VERIFIED**: licences, vendored-byte hashes, re-run frames match). Four presets measured at about 1.9–4.3 ms GPU per frame at 1080p on the RTX 5090 **on an idle GPU; a verifier on the shared GPU measured 1.3–1.7× more** (§3.8). **Add the NaN-sanitizer pass to the current chain now**, before the migration (it fixes the night black frame). **Full architecture in §3.**

### 1.7 Interim decisions while the R&D tracks run
Until each dedicated doc (§1.8) lands, engine code uses these stand-ins. The track doc overrides this section.
- **VFX:** soft particles with a procedural smoke flipbook (render-tech `proc.js makeSmokeFlipbook`, `f_smoke_soft.png`), drawn in the transparent layer and sampling `depthRT`.
- **Water:** render-tech `scene.js buildWater` (procedural normal map `proc.js makeWaterNormal`, depth-based colour, shore rim), **plus a Fresnel/env term**: every verifier found the stand-in water reads as a flat slate or a black rectangle. BEL colours: fjord teal `#103f3a`, river `#107083`. Scrolling normals: three.js `waternormals.jpg` (MIT, **VERIFIED**).
- **Terrain:** the §1.1.4 splat with hex tiling, level-authored soft splat and a macro colour map. **Grass: OFF** (no runtime grass cards) until the terrain track ships a real atlas-based grass.
- **Talking portraits:** static portraits rendered from the character GLBs with a close camera (`r4_face.png` shows the MakeHuman skin ceiling).

### 1.8 Dedicated R&D tracks
Four areas were split out of this document because each needed its own competing prototypes and a judge. The docs are being written concurrently; **when a track doc lands, it is authoritative for its area** and this document only keeps the integration contract (layer, pass order, budgets, licence rules from §5).

| Track | Doc | Prototypes (scratchpad) | Scope | Integration contract kept here |
|---|---|---|---|---|
| VFX (smoke, fire, explosions, muzzle flash, dust, snow, rain) | `docs/vfx-pipeline.md` | `vfx/flipbook/` (A: offline Blender Mantaflow flipbooks, 6-way lightmaps, motion vectors), `vfx/volumetric/` (B: real-time raymarched volumes), `vfx/particles/` (C: GPU particles) | which approach per effect, flipbook atlas budget, emissive bloom levels | transparent layer 1; reads `depthRT` for soft particles; emissive only through selective bloom; no NaN (sanitizer §3.3) |
| Water (sea, harbor, rivers, canals, fjords) | `docs/water-pipeline.md` | `water/a/` (FFT ocean), `water/b/` (hybrid flow maps, ripples, planar reflection), `water/final/` (A with B grafted, judged) | wave model, shoreline foam, reflections at the ortho view, swimming/boat wakes | transparent layer; reads `depthRT` for depth colour and shore; env/Fresnel from the theater HDRI; per-preset reflection cost |
| Terrain (splat, vegetation, trails, snow) | `docs/terrain-pipeline.md` | `terrain/a/` (own tree generator, extra CC0 layers), `terrain/b/` (`DataArrayTexture` layers, hex tiling top-3 of 8, height blend, trail render target, instanced grass tufts) | splat authoring, macro colour, texture arrays, footprints and tyre trails, trees, grass | one terrain material per mission; texture arrays (§1.1); trails as a world RT, not decal geometry (§3); CC0/permissive textures only |
| Talking portraits and voice quality | `docs/talking-portraits.md` | `faces/realtime/` (MPFB head with 34 CC0 expression-unit morphs, driven by phoneme timings), `faces/neural/` (neural portrait + talking-head models with licence-clean weights only) | briefing and dialogue portraits, lip-sync, voice casting | portraits are UI (overlay), not scene; **no cloning of real faces or voices**; generator models only with Apache/MIT-type weights; every model's licence recorded (§5) |

Licence rules for all tracks are the same as §5: CC0 or public domain preferred, CC-BY with attribution recorded, generator outputs only from permissively licensed models, no NC/ND/personal-use, no ripped assets.

---

## 2. Asset production plan

**Routes:**
- **DL**: download from a CC0 or CC-BY source through the intake gate.
- **BL**: Blender script (`tools/blender/assets/*.py`, via `blib.py`).
- **CODE**: procedural at runtime or at build time (JS/Python).
- **BAKE**: Blender bake from a CC0 source, such as tree impostors.
- **TTS**: neural voice generation.

Each asset gets an entry in `assets/registry.json` with: id, route, source URLs, licence, variants, budget, and the missions that use it.

### 2.1 Theater and lighting matrix (all 28 missions)

`theater` is the value passed to `buildTerrain(grid, theater)`. `preset` is the lighting preset from §1.1.5. The unique set pieces listed here are the hard assets.

| # | Mission (place, date) | theater / preset | Ground layers | Unique set pieces |
|---|---|---|---|---|
| 1 | Baptism of Fire (Sola, Feb 41) | snow / overcast_snow | snow_01/02, dry_grass, rock, asphalt | relay hut with antenna mast, L-shaped timber barracks, pier, fuel drums, island |
| 2 | A Quiet Blow-Up (Lofoten, Mar 41) | snow / overcast_snow | snow, rock banks | log cabins with snowy roofs, palisade fort, fuel depot tanks, **patrol boat**, river islets |
| 3 | Reverse Engineering (Eidfjord, Mar 41) | snow / overcast_snow | snow, rock gorge, gravel | **concrete arch dam** with sluices, power station, electric chain-link fence, lattice pylons, reservoir |
| 4 | Restore Pride (Trondheim, Mar 41) | coast / overcast_snow | dry grass, snow patches, cliffs, rail ballast | **HQ villa**, rail yard with wagons, **trestle bridge**, steam train, fjord cliffs, motorcycle with sidecar, escape patrol boat |
| 5 | Blind Justice (Herdla, May 41) | snow / overcast_snow | heavy snow, granite | log village, pine groves, **cable car** plus summit base, **radar dish**, antenna |
| 6 | Menace of the Leopold (Masi, May 41) | temperate / clear_day | spring grass, mud, craters | **railway gun "Leopold"**, bombed two-storey house (interior ladder), barbed wire, craters, HQ |
| 7 | Chase of the Wolves (Arendal, Feb 42) | coast / overcast_snow | snow, harbour concrete | **U-boat pens**, docked **Type VII U-boats**, harbour walls, lighthouse and mole, fishing boats, ruins |
| 8 | Pyrotechnics (Tell el Eisa, Oct 42) | desert / desert_noon | dense_sand, rocky, cliff | ruins on a plateau, cliff road, fuel-tank depot, round water tower, huts, truck |
| 9 | A Courtesy Call (Bab el Qattara) | desert / desert_noon (dawn grade) | sand, stone-wall compound | walled camp, warehouses, HQ, antenna, **3× Panzer IV**, minefields, fuel truck |
| 10 | Operation Icarus (El Agheila) | desert / desert_noon | sand, concrete apron | tents, prisoner cage, **hangar**, **airfield with Ju 52, Stukas**, 4+1 Panzer IV |
| 11 | In the Soup (Maradah oil fields) | desert / desert_noon | rocky desert, oil crater | **oil drilling rigs**, flagged barracks, water tower, tunnel mouth, Opel Blitz fuel truck, Sd.Kfz. 251 |
| 12 | Up on the Roof (Tunis, Mar 43) | desert / desert_town | cobbles, stucco, harbour | **flat-roof Arab town** (walkable rooftops), **mosque with minaret and dome**, harbour, Kübelwagen |
| 13 | David and Goliath (Le Havre, May 44) | coast / clear_day | harbour concrete, quays | **battleship replica**, piers, **floodgates/locks**, cranes, **Biber mini-sub**, patrol boat, Panzer II |
| 14 | D-Day Kick Off (La Rivière) | coast / clear_day or golden_hour | beach sand, rock ridge | **coastal casemates**, sea wall, field guns, Panzer II, beach obstacles |
| 15 | End of the Butcher (Compiègne, Aug 44) | temperate / clear_day | cobbles, canal park grass | French town streets, **fountain roundabout**, **mansion HQ**, canal, **tram and tracks**, cemetery, Citroën 15CV, fuel truck, van |
| 16 | Stop Wildfire (Maas bridge, Sep 44) | temperate / clear_day | fields, roads, rail | **steel truss bridge**, river, railway with a passing train, clothesline, very wide map |
| 17 | Before Dawn (Riveauvillé, N of Colmar, Nov 44) | temperate / golden_hour (dawn) | frost grass, rock | cliff to climb, **lever-operated mobile bridge**, **POW camp with 5 watchtowers**, old mill, bunker |
| 18 | Force of Circumstance (Maas, Dec 44) | temperate-frost / overcast_temperate | frost fields (no snow) | same map as M16, train station, river island, German camp, Panzer III |
| 19 | Frustrate Retaliation (Oldenburg, Jan 45) | temperate-frost / overcast_temperate | mud, coal, frost | **coal mine plus conveyor**, mine cart, **V2 rockets and gantries**, fast river, bridge, dogs |
| 20 | Operation Valhalla (castle, Feb 45) | temperate-frost / overcast_temperate | cobbles, stone | **walled gothic castle** (courtyards, dark slate roofs), firing range, water gate, Panzer III, gun emplacement |
| B1 | Dying Light (Guernsey, Jul 40) | coast / clear_day | grass cliffs, beach | white **lighthouse**, fort, radar antenna, AA batteries, sea-mine chains, cliff lift |
| B2 | Asphalt Jungle (Belgrade zoo, Apr 41) | temperate / clear_day | park grass, paths | **zoo pits and cages**, villa, lions, ostriches, small lorry |
| B3 | Dropped Out of the Sky (Crete, Jun 42) | desert (Mediterranean dry) / desert_noon | dry grass, rock gorge | river gorge with bridge, white church village, **classical ruins**, cart |
| B4 | Thor's Hammer (Bonn, Sep 43) | temperate / overcast_temperate | rail yard ballast | **rail gun**, **armoured train**, station hall, roundhouse, pushable carriages, locomotive |
| B5 | Guess Who's Coming Tonight (Rastenburg) | temperate / clear_day | forest floor | château, bunkers, forest, armoured car |
| B6 | Eagle's Nest (Neubrandenburg, Nov 44) | temperate-frost / overcast_temperate | airfield concrete, frost | **Me 262 ×2, Me 163, He 162, Bf 109 ×2, Do 17**, fuel tanks, farmhouse village |
| B7 | The Great Escape (Nuremberg POW camp) | temperate-frost / overcast_temperate | mud, frost | fenced hut camp, towers, river |
| B8 | Dangerous Friendships (Nijmegen, Dec 44) | coast (canal city) / overcast_temperate | cobbles, canals | **Dutch canal houses**, **drawbridge**, tugboat, club interior(?) |

`night` is an **optional variant**; BEL is daylight-only. Any mission can load `preset=night` for an "after dark" mode.

**Theater kits:**
- **Norway** (M1–M7): snow, olive grass, granite, pines and birches, timber architecture, fjord water.
- **Desert** (M8–M12, B3): sand, rock, palms, adobe and stucco, tents, airfields.
- **Europe temperate / frost** (M6, M13–M20, B2, B4–B8): grass or frost fields, stone and brick towns, deciduous trees and conifers, rail, rivers, harbours.

### 2.2 Characters (route: MPFB body (CC0) + BL uniform/kit + offline rebind; target ≤12k tris, ≤1.5 MB)

| Group | Variants to build | Count |
|---|---|---|
| Commandos | Green Beret, Sniper, Marine (land plus wetsuit/rebreather/fins), Sapper, Driver, Spy (civilian suit plus **German officer disguise**). Each has a unique face, height and headgear. Snow variants: white smocks for M1–M5 and M7 (confirm in the missions research). | 6 bodies, about 9 outfits |
| German Heer (feldgrau) | rifleman (Kar98k), MP40 trooper, sergeant (Luger, patrol leader), officer (peaked cap; matches the Spy disguise), MG gunner, sentry (greatcoat, winter), tank crew (black wrap), engineer | 8 |
| Afrika Korps (tan) | rifleman, MP40, sergeant, officer, MG gunner, tank crew | 6 (material variants of the Heer meshes) |
| Winter | rifleman and sergeant in white smocks, greatcoat sentries | 3 (material variants) |
| Kriegsmarine / Luftwaffe (optional) | harbour guard (M7, M13), airfield crew (M10, B6) | 2 |
| Specials | General "Butcher" (M15), POW prisoners (M17, B7), civilian tram driver (M15), Alsatian dog (M19 only: **BL** body with a keyframed trot and bark. No photoreal CC0 rigged dog was found; the Quaternius animals are stylised. Low priority.), B-campaign NPCs (Maj. Skopje, Natasha, SS Col. von Below, pilots, zookeeper) | about 8, later |
| Briefing | Col. Montague Smith: **voice only** (the original never shows him) | 0 meshes |

**Total:** about 6 commando bodies and about 14 enemy mesh variants, with theater changes as material swaps (§1.3 climate rule). The commandos also get close-up portrait renders (§1.8 talking portraits).

**v2 production notes (from the characters verifier):**
- **Uniforms and kit are the critical path and the largest content cost; estimate them first.** Author each garment once as a MakeHuman MHCLO on the base mesh so MPFB fits it to every body. Priority: Heer M36/M40 Feldbluse + trousers + Knobelstiefel → DAK tunic and shorts → winter smock → officer tunic + breeches + riding boots → British battledress and the commandos' kit → diver wetsuit with rebreather → Spy's German uniform.
- Kit silhouette cues first (visible at 25–45 px): helmet shape, Y-strap webbing, pouches, gas-mask canister, bread bag, canteen, rifle.
- Enemies: randomise MPFB face/build macros **per instance** (several GLBs per type, or morph targets) so no two sentries are clones.
- Every character: one atlas, 1–2 materials, LOD0 ≤ 12k, LOD1 ≈ 5k, KTX2 + meshopt, ≤ 1.5 MB.

### 2.3 Animations
The §1.4 mapping table covers the 22 contract names. The full list to produce:

- **Download** (UAL1/UAL2, CC0): about 30 clips, which are only extracted and stripped.
- **Procedural code** (`crawl.js`, done in the prototype): prone crawl forward/back and the crawl idle (**VERIFIED**; replaces the ACCAD crawl because ACCAD's BVH rest pose is broken).
- **BVH retarget** (ACCAD, CC BY 3.0, after a Blender rest-pose fix): crouch-to-lie, lie-to-crouch, lie idle, look around, stand-to-ready (5). CMU (restricted, baked only): extra deaths `90_16`, `85_15`, ladder `13_33`.
- **Blender-authored on the UAL skeleton** (about 25):
  - Rifle and SMG upper-body layers: hold, aim with **left-hand IK on the fore-stock**, fire recoil, bolt cycle, reload, patrol carry, sling on back. (Interim: UAL pistol aim + `attachRifleAuto`.)
  - MG gunner: prone or seated fire.
  - Knife stab.
  - Syringe (Spy), wire-cut, dig (shovel), harpoon fire (Marine), torpedo, oars (rowing), carry-body idle.
  - Climbing: pole, wall and rope loops.
  - Surrender, salute, dragging a body.
  - Guards: smoke idle, sleep, alarm run with arm wave.
  - Death variants: front, back, blown by an explosion.
  - Driver entering and leaving a vehicle.
- **Per-clip speed matching** (playback rate = ground speed / clip speed) or root motion for every locomotion clip: foot sliding is the most visible tell at game distance.
- **Code** (procedural): turret yaw and gun pitch, wheel spin, track UV scroll, boat bob, train or tram along a spline, the cable car, the conveyor, the mobile bridge lever, floodgates, the drawbridge, doors.

### 2.4 Props: the `buildProp` catalogue (ARCHITECTURE.md) → route

| Type | Route and source | Variants |
|---|---|---|
| `barracks` | BL (timber for Norway, stucco for desert, brick for Europe; the Nissen hut is also BL, since the downloaded model's colour is broken) | theater × intact/ruined; a door as an interactable |
| `house` | BL (§2.5) | per theater, 3–6 each |
| `hut` | BL; DL fallback: Old house (Tim0, CC-BY) for Norway | theater |
| `bunker` | BL (formboard concrete: pillbox, garrison bunker, MG bunker, casemate) | intact / ruined |
| `watchtower` | BL (`tower.py` prototype; **add the `snow` variant**) | wood / stone (castle) |
| `wall` | BL modular kit: dry-stone, mortared stone, brick, adobe/stucco, concrete, palisade (Norway), castle curtain wall | straight, corner, end, gate gap |
| `fence` | BL: post-and-wire, **barbed-wire concertina (curve plus an instanced coil)**, chain-link with electric insulators (M3), picket, rail | straight segments along `points` |
| `gate` | BL, plus PH `large_iron_gate` | open / closed |
| `sandbags` | BL modular kit: straight, corner, U-emplacement, MG nest ring. PH `cement_bag` is the shape reference; texture `hessian_230` (tint tan or grey) | theater tint |
| `crates` | DL PH `wooden_military_crate`, `old_military_crate`, `wooden_crate_01/02`, `ammo_box` | stacked clusters |
| `barrels` | DL PH `barrel_03` (recolour), `barrel_stove`, `Barrel_01/02`; the red fuel drums are a recolour | explosive / normal |
| `fueltank` | BL (horizontal and vertical tanks with ladders; the M8 depot) | intact / burnt |
| `tent` | DL venik42 *Tent* (CC-BY) plus BL bell tent and desert squad tent | olive / tan |
| `tree`, `pine` | Decided by the terrain track (§1.8; the current stand-ins read as grey-green blobs). Default: BAKE impostors from PH `fir_tree_01`, `pine_tree_01`, `island_tree_02`; add BL Sapling birch and oak | snow-laden canopy variant |
| `palm` | DL ElectroNick *Palm Trees* (CC-BY) | 2 species |
| `bush` | Terrain track (§1.8). Default: BAKE cards from PH `searsia_lucida`, `shrub_02`; ground clutter from `fir_sapling`, `pine_sapling_small` | theater |
| `rocks`, `cliff` | DL PH boulders, cliffs, `rock_moss_set_01` (optimised to 3–5k tris); large cliffs = terrain height plus triplanar `rock_face_03` / `cliff_side` | snow top-mask |
| `bridge` | BL: steel truss (M16/M18), trestle rail bridge (M4), stone arch, wooden footbridge, **lever-operated mobile bridge** (M17), **drawbridge** (B8) | intact / destroyed |
| `road`, `river`, `lake`, `sea` | CODE: terrain splat (`docs/terrain-pipeline.md`), water surface (`docs/water-pipeline.md`; interim §1.7), shore rim | — |
| `pier` | DL PH `modular_wooden_pier` plus BL concrete quay | — |
| `radio_mast` | BL: lattice mast, relay antenna, **radar dish** (M5), Würzburg-style | — |
| `generator` | BL | — |
| `aa_gun` | DL bear17 *Flak 18-36* (CC-BY, re-bake) plus BL Flak 38 20 mm | — |
| `searchlight` | DL ragnar *Flak Searchlight* (CC-BY) plus PH `portable_searchlight` | light on / off |
| `lamp_post` | DL PH `street_lamp_01`; *Victorian Street Lamp* (CC-BY, decimated) | lit at night |
| `telegraph_pole` | DL caboose3d *Telephone Poles* (CC-BY); CODE wires (catenary lines) | — |
| `sign` | BL plus a CODE canvas texture (German road signs, period typefaces) | — |
| `rail_track` | BL modular straight, curve and switch (sleepers plus rails) along `points` | — |
| `train_car` | BL: freight wagon, flatcar, tank wagon, passenger coach, **steam locomotive**, armoured train (B4) | — |
| `ruins` | BL: the "ruined" pass on building meshes plus rubble chunks | — |
| `hangar` | BL (arched corrugated). DL fallback: *Hangar* (thetrady, CC-BY, not yet tested) | — |
| `plane` | DL Ju 87 and Bf 109 (CC-BY, insignia removed); Ju 52 (manilov.ap, CC-BY, **needs testing**); B6 jets (Me 262, Me 163, He 162, Do 17) as BL | parked |
| `uboat` | BL Type VII (the downloaded U-boat was deleted from Sketchfab, and its quality was low) | docked / sunk |
| `dam` | BL concrete arch dam with sluices (M3) | intact / breached |
| `crater` | CODE: terrain height dent plus a splat damage channel (terrain track); BL rim debris | — |
| `trench` | CODE terrain cut plus a BL revetment kit (planks, wattle, sandbags) | — |
| `well` | DL glowbox3d *Old Well with Hanging Bucket* (CC-BY) | — |

**Clutter kit** (for the realism budget; DL Poly Haven props plus small BL items):
- jerrycans, ammo cans, stick-grenade crates, radio sets, lanterns, ladders, spades, picks, wheelbarrows, carts, tyres, fire pits, laundry lines, posters,
- awnings and water jars (desert), fishing nets and boats (Norway), bicycles and tables (Europe),
- flags: none from asset packs — every enemy flag is the procedural one in `src/art/flags.js` (historical 1935–45 flag by user decision 2026-09-30, Balkenkreuz banner under Options → INSIGNIA → NEUTRAL).

### 2.5 Buildings (route: BL, `house.py`-style scripts; 3–10k tris; intact plus ruined)

| Theater | Types |
|---|---|
| Norway | log cabin (snowy roof), timber barracks (straight and L-shaped), half-timbered hut, Nissen hut, **HQ villa** (M4), power station (M3), relay hut (M1), fishing house, boat shed, lighthouse (M7), **U-boat pen** (M7), cable-car stations (M5), radar summit base (M5), rail-yard shed |
| Desert | whitewashed flat-roof house A/B/C (prototype `house_a`), ochre adobe house, **Tunis town blocks with walkable roofs and stairs** (M12), **mosque with dome and minaret**, desert HQ, warehouse, round water tower, oil derrick and pump (M11), tunnel mouth |
| Europe | Normandy stone farmhouse, brick town house, French town block (M15), **mansion HQ** (M15), café, church and **cemetery** (M15, B3), train station (M18, B4), roundhouse (B4), old mill (M17), POW huts (M17, B7), casemate (M14), harbour warehouse and crane (M13), floodgate and lock (M13), mine buildings plus conveyor (M19), **V2 gantry** (M19), **gothic castle kit** (M20: curtain wall, towers, keep, courtyard buildings, slate roofs), Dutch canal houses (B8), zoo pits and cages (B2), château (B5), classical ruins (B3) |

**Facade materials (CORRECTED v2, textures verifier):** `white_stucco` rendered as a flat pinkish-white box (albedo near 1.0, grime invisible on lit faces), and `roof_09` terracotta looks chunky at the game scale. Clamp albedo to about 0.75, bake grime/AO/edge wear into the atlas (visible on lit faces too), add per-instance tint and dirt variation, and prefer smaller-scale roof tiles. Do not use `white_rough_plaster` at a 1 m repeat (it tiles like camouflage).

**Interiors.** BEL buildings are entered as "hide inside" spaces, not rendered rooms. Only the door, window glow and roof matter. Interiors are skipped except where a mission shows them (the M6 bombed house has a visible interior ladder: build it as an open ruin).

### 2.6 Vehicles

| Vehicle | Missions | Route |
|---|---|---|
| Opel Blitz cargo truck (DAK, grey, snow) + burnt | 1, 2, 4, 13, 16, 18 + desert | **BL `truck.py`** (done, three variants) |
| Opel Blitz fuel truck | 9, 11, 15 | BL (a `truck.py` variant with a tank body) |
| Motorcycle + sidecar (BMW R75) | 4 | BL |
| Sd.Kfz. 251 half-track | 6, 7, 11, 15 | DL Applepie68905 (CC-BY), re-bake, split. Or BL. |
| Sd.Kfz. 222 armoured car | optional | DL Arbuzz747 (CC-BY), retexture and split |
| Panzer II | 4, 13, 14, 19 | **BL (tracked track)** |
| Panzer III | 18, 20 | **BL (tracked track)** |
| Panzer IV | 9, 10 | **BL (tracked track)** |
| Kübelwagen | 12 | BL |
| Willys jeep (friendly, M8) + friendly truck | 3, 6, 8, 9, 15, 17, 18 | DL jeandiz *Willys SAS* (CC-BY; refit to 3.36 m, split) |
| Citroën 15CV (general's car) | 15 | BL |
| Van (escape) | 15 | BL (the truck script, van body) |
| Inflatable boat ("Zodiac"), deflatable | 1, 2, 3, 17, 18 | BL (inflated and deflated meshes, plus a shape-key morph) |
| Rowboat | 7, 13, 14, 19 | BL |
| Patrol boat with MG | 2, 4, 13 | BL |
| Biber mini-sub, torpedo | 13 | BL |
| Battleship replica | 13 | BL (large; a hero set piece, only 1–2 camera screens wide) |
| Steam locomotive, freight wagons, tram | 4, 6, 16, 18, 15, B4 | BL |
| Railway gun "Leopold", rail gun (B4) | 6, B4 | BL |
| Ju 52 (escape) | 10 | DL manilov.ap (CC-BY, test it) or BL |
| Autogyro | 5 | BL |
| Cable car | 5 | BL |
| Mine cart + conveyor | 19 | BL |
| Stuka, Bf 109 (parked) | 10 + airfields | DL (CC-BY, insignia removed) |
| Tugboat (B8), jets (B6), armoured train (B4) | BCD | BL, later |

**Totals:** about 25 BL vehicles (3 tracked) and 5 DL vehicles, each with an intact and a `burnt` variant.

### 2.7 Textures and HDRIs (route: DL, then KTX2 encode)
- **Terrain and material sets:** the 33 slots in §1.1.3, plus about 8 missing ones (wet sand, seabed, harbour concrete, rail and tram track, snow-edge tarmac, Tunis roof tiles, tan burlap, coal and slag for M19). That is about 41 sets: about 82 MB of 1k JPG source, about 330 MB of 2k.
- **Ship per mission:** only the theater's 6–8 terrain layers plus the building atlases actually used, packed as **texture arrays** (sampler budget 13–16 units, §1.1).
- **KTX2 encoding is still untested** (`toktx` was missing in the textures evaluation): install KTX-Software (Apache-2.0) or use `gltf-transform` `ktx2` and measure quality and size before committing to the budgets below. Uncompressed texture arrays measured 117 MB of VRAM in the render prototype.
- **Macro colour maps** (one per mission, low-res, level-authored) are now mandatory production assets (CORRECTED v2: fbm-noise splats read as camouflage blobs at 80 m).
- **HDRI manifest:** the `source` field was empty for the HDRIs (textures verifier); fill author, URL and licence for every entry before CREDITS generation.
- **HDRIs:** 9 presets (§1.1.5). Ship 1k `.hdr` (1.1–1.7 MB each); keep the 2k only as a build source.
- **Blender kit inputs:** the 21 CC0 sets in `blender-modeling/asset_manifest.json`. They are baked into the atlases, not shipped separately.

### 2.8 SFX list (route: DL from Freesound CC0 or Kenney, then `sfx_build.py`)

Game events come from the ARCHITECTURE event table.

| Event / system | Categories (built ✓ / to do ✗) |
|---|---|
| `shot` | ✓ rifle_lee_enfield (primary: kyles 450852; 410442 provenance uncertain), rifle_m1 (stand-in for Kar98k), rifle_bolt_cycle, pistol, smg_thompson_single, mg_heavy, mg_period, sniper_echo, ricochet, shell_casings. ✗ distinct Kar98k, MP40 burst, **MG42** (procedural 20 Hz stopgap), Luger, tank cannon, boat MG, harpoon; `*_distant` layer per weapon family. |
| `explosion` | ✓ explosion_grenade, explosion_large (**rebuild without 177556**; unfa 156500 stays), explosion_distant, artillery_period (bed). ✗ fuel-tank fireball, building collapse, bridge collapse, dam break, debris rain. |
| Movement | ✓ fs_sand, fs_grass, fs_gravel, fs_snow, fs_wood, fs_metal, fs_running_wood, crawl, swim, splash; Kenney footsteps on concrete, carpet and snow. ✗ mud, shallow water wading, ladder climb, rope climb, rowing. |
| Actions | ✓ knife_stab, body_fall, door_wood, door_metal, metal_small, bomb_tick, Kenney cloth. ✗ wire cutters, shovel dig, decoy clockwork, syringe, raft inflate and deflate, pick-up and drop body, grenade pin. |
| `alarm:start` | ✓ siren_airraid, siren_handcrank. ✗ bell alarm, whistle. |
| Vehicles | ✓ truck_engine, tank_engine. ✗ motorcycle, boat motor, train (loco chuff, whistle, rail clatter), tram, Ju 52 and autogyro propellers, cable car, conveyor, tank tracks squeal, turret traverse, brakes, horns. |
| Ambience beds | ✓ wind_desert, wind_snow, birds, crickets, radio_static, morse. ✗ **surf and harbour water, gulls, rope and hull creak (coasts have no bed at all)**, river, fire crackle, electric fence hum, generator, searchlight hum, church bells, distant dogs. |
| `bark` (dog) | ✓ dog |
| UI | ✓ Kenney interface-sounds and ui-audio (clicks, confirm, error). ✗ stingers (won, lost, objective) and briefing music (CC0 orchestral, or commission). |

About 60 categories are still to do, at about 2–6 source sounds each. The runtime budget stays **≤ 15 MB OGG for all SFX**, lazy-loaded **per mission** (decoded PCM is the real limit: 187 MB for 39 categories, **VERIFIED**), with ambience beds streamed through `<audio>`/`MediaElementSource` rather than decoded. Every file gets an MP3/AAC twin (Kenney too).

### 2.9 Voice lines (route: TTS, then `post.py`, then Whisper QA; write new lines)

| Speaker | Line types | Count |
|---|---|---|
| 6 commandos | select (4), move order (4), action ack (3), can't do (2), found item / done (2), hurt (3), death (2), discovered (1) | about 20 each = **120** |
| German soldiers (4 voices × 3 variants of each line) | "Halt! Wer da?", "Was war das?", "Da ist jemand!", "Alarm!", "Feuer!", "Achtung!", body found, "Hände hoch!", giving up the search, patrol chatter, pain, death | about 12 lines × 4 voices × 3 = **144** |
| Sergeant / officer | orders, "Guten Tag" reply to the Spy disguise, capture lines | about 20 |
| Spy (German, speaking as an officer) | "Guten Tag", distraction orders | about 6 |
| Col. Montague Smith | 20 BEL briefings (about 150–250 words each) plus the map walkthrough, plus 8 BCD later | 20–28 long files |
| Radio variants | alarm and briefing lines | automatic (`_radio`) |

**Engines per speaker (v2):** Kokoro for the English commandos and the Colonel; **Chatterbox only** for German enemies and the Spy's German/French (no Piper; no cloning of identifiable third-party speakers, §1.5.2). Lip-sync timing data for portraits is produced alongside (`docs/talking-portraits.md`).

**Budget:** barks about 300 × 6 KB ≈ 2 MB; briefings about 28 × 90 s at 32 kbps ≈ 10 MB, streamed. Store the text in `assets/audio/voice/lines.json` next to the files, so regeneration is one command.

### 2.10 Decals, VFX textures, UI art
- **Decal atlas (CODE + BL bake):**
  - ground: scorch, crater, tyre and track marks, footprints in snow, oil, blood pool, dirt skirts under buildings;
  - walls: cracks, bullet holes, soot streaks, posters, unit markings, number plates.
  - The render prototype's `proc.js makeDecalAtlas` is the start. **CORRECTED (v2):** its tyre-track decals render as a dashed "ladder" (a bug), and `DecalGeometry` on the 43k-tri terrain costs **29 ms per decal** (33 decals = 0.8–0.97 s at load; the verifier measured up to 1.4–1.8 s on the shared GPU box), so it is acceptable only for static decals baked at load and **never at runtime**: ground marks (tyre tracks, footprints, trails) go through the terrain track's world render target or a splat channel; wall decals are baked into atlases or drawn as pre-built quads. Photographic decals come from PH or ambientCG CC0 textures (for example the `aerial_*` ruts, `dry_ground_01` cracks).
- **VFX:** smoke, fire and explosion flipbooks, muzzle flash, sparks, dust. Decided by `docs/vfx-pipeline.md` (flipbook vs volumetric vs GPU particles, §1.8); interim in §1.7.
- **UI:** portraits are rendered from our characters. Icons are CODE/SVG. No original game art.

### 2.11 Realism budget and production order
The verifiers agree that **scene integration** is where realism is won. So the order is:
1. **Lighting and terrain first.** Build 1 dressed tile per theater, about 40 × 25 m:
   - HDRI sun extraction and caps,
   - terrain splat with height blend, hex-tiling and macro,
   - contact decals (dirt skirts),
   - scatter and **real vegetation from the terrain track; no generated grass cards** (they render as black silhouettes, the worst defect all verifiers found),
   - a Fresnel/env water surface (water track),
   - white balance / warm fill per theater (snow had a blue cast; night must grade blue, not green-yellow or pink under lamps),
   - grade.
   - **Acceptance:** zoom 1 and zoom 2 renders compared side by side with period photographs and with the original's palette (`visuals.md` table).
2. **The modular kits:** walls, fences, sandbags, rail, trenches, craters. They cover the most screen area in every mission.
3. **Buildings per theater**, in mission order: Norway, then desert, then Europe. Each gets per-instance tint, the decal kit and clutter.
4. **Characters:** fix the rig pipeline offline, then uniforms, the rifle animation layer and kit.
5. **Vehicles:** wheeled first, tracked last.
6. **Hero set pieces** as missions need them: the dam, U-boat pens, battleship, castle, V2 site.
7. **Trees:** the impostor bake (or the terrain track's generator), needed from M1 on, so run it in parallel with step 1.

**Critical path (v2):** step 1 depends on the terrain and water tracks, and step 4 on the uniform/kit authoring, which the characters verifier calls the largest unestimated cost. Estimate uniforms first. Steps 2, 3 and 5 are proven routes (Blender scripts) and can run in parallel. Every step ends with a 1:1 crop review at 44 m and 80 m view widths plus a close-zoom shot.

### 2.12 Size budgets
- **Per mission download:** ≤ 60–100 MB. Terrain layers about 15 MB (KTX2 2k), buildings and props about 25 MB, characters about 15 MB, vehicles about 10 MB, audio about 8 MB, HDRI about 1.5 MB.
- **VRAM, high preset:** ≤ 1 GB with KTX2 (≤ 2 GB as WebP).
- **Whole game on GitHub Pages:** ≤ 1 GB total. Keep build sources (2k JPG, 1k HDR, `.blend`) out of the repo: scripts regenerate them. The Blender scripts and registry *are* the source.

---

## 3. Rendering architecture for the engine

The target is `src/engine/renderer.js`, owned by the foundation team. Today the engine chain is RenderPass → GTAO → UnrealBloom → OutputPass → SMAA/FXAA, with PCF and the tone mapping from `CONFIG.render.toneMapping` (currently `'aces'`; `renderer.js` falls back to AgX only for an unknown value. The rendering verifier read the fallback as the default; the effective default is ACES). The render prototype's chain below is measured and fixes known problems:
- AO halos from grass and smoke,
- cone colours shifted by tone mapping,
- a missing depth copy for soft particles and water.

**Status: VERIFIED as the pipeline choice** (licences, vendored-byte SHA-1s `postprocessing.js` 507f4bb9… and `N8AO.js` efe3181f… identical to jsdelivr, re-run frames match: day high mean RGB 101/105/82, night 65/65/38, draws 738/847, shadow texel 1.98 cm, `envI` 0.436). **Not yet evidence of a realistic look**: that depends on content (§2.11).

**Migrate to it.** Before the migration, **add the SanitizePass (step 5) to the current engine chain as a `ShaderPass`** so the night black frame cannot reach users. Prototype code: `scratchpad/realism/render-tech/src/main.js`, lines 190–260 (the post chain), and `scene.js` (`buildOverlays`, `buildNightLights`, `buildGrass`, `buildWater`, `buildDecals`).

**Engine status (art integration, 2026-09-26).** The engine keeps three's `EffectComposer` for now (the terrain
track's alpha-aware GTAO and the water track's post hooks are built on it) and has landed the fixes this section
asks for: SanitizePass (step 5) before bloom, AgX in `OutputPass` (ACES option) followed by a per-theater LUT
(`LUTPass`, `engine/grade.js`), per-mission lighting from the mission file with the vendored 1k HDRIs
(texel clamp 24 + automatic `skyFrac` fill), NW sun, X-ray silhouettes (`GreaterDepth`, design-spec §2.4) and the
CI frame-stats smoke test (`tests/render-frames.test.mjs`). Engine frame times per preset are in the
`QUALITY_PRESETS` comment of `src/engine/renderer.js`. The pmndrs/N8AO migration and MSAA remain open.

### 3.1 Renderer
- `new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })`. MSAA lives in the composer's buffer.
- `outputColorSpace = SRGBColorSpace`.
- `toneMapping = NoToneMapping` (tone mapping happens in post).
- `shadowMap.type = PCFShadowMap`. r186 **removed `PCFSoftShadowMap`**, which now falls back with a warning. Softness comes from `shadow.radius`.
- **WebGPU:** not now. Headless Chromium on this machine only exposes a SwiftShader WebGPU adapter, so it cannot be measured, and the pmndrs chain is WebGL-only. Revisit it with `WebGPURenderer` plus TSL post after BEL ships.
- **Vendoring** (no build step):
  - `vendor/addons/ext/postprocessing.js`: pmndrs 6.39.5, Zlib. Its peer range is three ≥0.168 and <0.187, so **it pins us to r186**.
  - `vendor/addons/ext/N8AO.js`: 2.0.1, ISC.
  - Import-map keys: `"postprocessing"` and `"three/examples/jsm/"`, the latter mapped to `vendor/addons/` because N8AO imports `three/examples/jsm/postprocessing/Pass.js`.

### 3.2 Scene layers
| Layer | Content | Drawn in |
|---|---|---|
| 0 `OPAQUE` | terrain, buildings, props, vehicles, characters, alpha-tested foliage and impostors | pass 1 |
| 1 `TRANSPARENT` | water, smoke, fire, beams (searchlight cones), soft particles, blended decals (grass only if the terrain track ships alpha-blended grass; default alpha-tested in layer 0) | pass 3 (after the depth copy) |
| 2 `OVERLAY` | vision cones, selection rings, move markers, path preview, ability range circles, placement ghosts | pass 7 (after tone mapping) |
| 3 `PICK` | invisible pick proxies (never rendered) | raycast only |

### 3.3 Frame order (post chain)
```
shadow maps  (sun DirectionalLight PCF; ≤2–4 shadowed spotlights at night)
 1 RenderPass(scene, cam[layer 0])              → HalfFloat MSAA buffer (+depth)
 2 DepthCopy                                     → depthRT (float): pre-transparent scene depth
 3 RenderPass(scene, cam[layer 1], clear=false)  → same buffer; depth-tested, no depth write
 4 N8AOPostPass(depth = depthRT)                 → AO on opaque only (no halos from grass/smoke/water)
 5 SanitizePass (NEW)                            → rgb = isnan||isinf ? 0 : min(rgb, 64.0)
 6 EffectPass(Bloom(mipmapBlur, threshold≈1.0) → ToneMapping(AgX) → HueSaturation/BrightnessContrast
               or LUT3D per theater → Vignette(0.32/0.42 subtle))
 7 OverlayPass(scene, cam[layer 2])              → display-referred colours, manual depth test vs depthRT
 8 SMAA (high/ultra) | FXAA (low) | Copy          → screen
DOM HUD on top (ui/*)
```
- **Why step 5.** At night the prototype renders an **almost black frame** (mean 6.5/255) whenever *spotlights plus MSAA plus bloom* are all on. Turning off any one of them restores the image (mean 63/255): `nb_*` and `e_night*` runs in `render-tech/shots/`. This is a NaN/Inf from the spot-lit or beam pixels. The MSAA resolve carries it and the mip-blur bloom spreads it across the whole screen.
  - The PBR prototype hit the same class of bug through NaN terrain normals, where GTAO spread a NaN into a black frame.
  - Fix at the source too (clamp the beam shader and `normalize(max(v, eps))`). Keep the sanitize pass as a guard; it costs about 0.05 ms.
  - **The root cause is still unknown** (verifier): the sanitizer masks it. Add a **CI frame-stats smoke test** (headless Chromium, `--use-angle=gl`, `gl.isContextLost()` false, mean RGB 25–200 and std > 15 for day, night, zoom-in and ultra frames).
- **Selection x-ray (optional, high and ultra).** pmndrs `OutlineEffect` (`xRay: true`) shows commandos hidden behind roofs. This helps gameplay; BEL itself had no such effect, so it defaults to off in "classic" mode.

### 3.4 AO, shadows, lighting details
- **AO budget.** The verifier warned that AO was being counted three times.
  - Baked cavity AO stays in the albedo at 45%.
  - `aoMapIntensity` is 0.5.
  - N8AO settings: `aoRadius` about 1.5–2 m, `distanceFalloff` 1, `intensity` 2–3, `halfRes` on medium.
  - N8AO beat three's GTAO and SSAO on cost and on halo artefacts in the prototype (`c_*` shots).
- **Sun shadows.** The camera is orthographic with a fixed pitch, so a **single shadow map fitted to the view footprint** is enough; no CSM is needed.
  - The footprint is about 46 × 34 m at zoom 1 and about 85 × 62 m at zoom 0.55. Refit it on zoom change, snapped to texels to avoid shimmer.
  - 4096² gives about **2 cm per texel** at zoom 1 (measured `shadowTexelCm` 1.98). That is enough for rifle-sized contact shadows.
  - Rejected: VSM (light bleeding) and CSM / the r186 `SunLight` cascades (not needed for a fixed-pitch ortho view; kept only as a last-resort option for very long shadows).
  - Normal bias 0.02, bias −0.0002.
  - Update the shadow map every frame on high and ultra. On low and medium, update only when something moved or at 30 Hz.
- **Environment:** one PMREM per mission from the 1k HDRI with the texel clamp. `scene.environmentIntensity` is set automatically (§1.1.5). No per-object env maps; water uses its own reflection.
- **Night:**
  - Moon `DirectionalLight` at about 0.25, bluish (0.55, 0.65, 1.0), with the night HDRI at `envI` 1.
  - **≤16 point lights** (lamps, windows, fires), with windows as emissive at 4. Use no shadows on point lights.
  - **≤2 (high) or 4 (ultra) shadowed spotlights** for searchlights, each with an additive beam mesh on layer 1.
  - Grade blue and desaturated. Window glow stays warm; the prototype turned lamps pinkish under the grade, so exempt emissive from the grade or grade before bloom.
  - **CORRECTED (v2):** both night prototypes came out with a yellow-green cast, not moonlit blue. Lower `envI` to about 0.3–0.5 at night, make the moon bluer, and grade towards BEL's dark blue night.
- **Grading:** per-theater parameters in `CONFIG.render.grades` (saturation, contrast, lift, gain, optional `LUT3D` from a `.cube` we create). Match the original's measured palettes (`visuals.md`): low saturation (S 0.10–0.40) and mid-dark values.
- **Tone mapping:** AgX in post (`ToneMappingEffect` AGX, `renderer.toneMapping = NoToneMapping`) as the recommendation; ACES filmic as an option; switch `CONFIG.render.toneMapping` together with the chain migration. The textures prototype found ACES punchier and AgX greyer; the rendering A/B found ACES skews fire and explosions to yellow and over-saturates grass. The grade closes most of the gap. **Open:** decide on final content in the realism loop.

### 3.5 Vision cones and overlays (gameplay readability first)
- Cones stay the `VisionCone` fan meshes from `grid.castRay` (contract). They are drawn **on layer 2 after tone mapping**, so their green, yellow and red are exact, with a **manual depth test against `depthRT`** (`buildOverlays`: `if (gl_FragCoord.z > sceneD + eps) discard`).
- The depth test lets roofs and walls hide cone parts under them. **Where the cone is hidden, draw a 25% ghost** instead of discarding, so gameplay information is never lost. Rings already do this (`mix(0.95, 0.35, occl)`).
- Cones follow the terrain height (vertices sample `heightAt` + 0.06 m) and are `DoubleSide`: the prototype found that flipped fans vanished otherwise.
- Selection rings, move markers and path previews use the same pass and material family.
- **The transparent pass must not write depth into `depthRT`.** Grass cards would otherwise speckle the cones (a prototype bug that was fixed).

### 3.6 Picking
- **Never raycast render meshes** (skinned characters, 0.5M-tri scenes).
- Ground: `screenToGround` intersects the ortho ray with the terrain heightfield. Do a coarse plane hit at y = 0, then 2–3 Newton steps on `heightAt(x, z)`.
- Units: an analytic ray test against a **vertical capsule** per unit (radius `CONFIG.units.pickRadius` 0.6 m, height 1.8 m standing, 0.5 m crawling), using `world.entitiesInRadius` around the ground hit plus the capsule height projected along the view ray (1.8 m × cos 40° / sin 40° ≈ 2.1 m of ground offset). Take the nearest to the camera. Selecting by clicking a head then works.
- Interactables and vehicles: oriented boxes on layer 3 (`PICK`), tested with `Raycaster.layers.set(3)`. Doors, pickups, bodies and explosive targets register their proxy boxes.
- Drag-box selection: project the unit anchors to the screen and test against the rectangle, so it is independent of meshes.

### 3.7 Geometry, draw calls, streaming
- **Instancing:**
  - `InstancedMesh` for repeated props (crates, drums, sandbag segments, fence posts, rocks, impostor trees). Per-instance colour gives tint and per-instance `userData` gives wear.
  - `BatchedMesh` for static unique buildings that share one atlas material.
- Target **≤ 1,000 draws** and **≤ 1.5M tris** on high. The prototype ran 640–850 draws and 0.36–0.78M tris.
- **LOD by zoom:** zoom ≤ 0.8 uses LOD1 for buildings and vehicles and LOD1 characters. Animation mixers update at 30 Hz at zoom 0.55.
- **Grass (CORRECTED v2):** the prototype's camera-azimuth-facing cards render as **black leaf-shaped silhouettes** at 1:1 and destroy the ground read at zoom 1 and 3 (rendering verifier: the dominant visual defect, worse than v1's "dark blotches"). **Ship with grass off** until the terrain track (`docs/terrain-pipeline.md`) delivers a real atlas (Blender-rendered cards or low-poly tufts) that passes a 1:1 crop review. The preset density slots (0/8/14/24 per m², `alphaToCoverage` with MSAA, shadows on ultra) stay as the budget.
- **Loading:** `src/engine/assets.js` handles:
  - `GLTFLoader` with `MeshoptDecoder` and `KTX2Loader` (basis transcoder vendored in `vendor/addons/libs/basis/`),
  - `HDRLoader`,
  - `AudioContext.decodeAudioData`,
  - one manifest per mission, preloaded at the briefing screen.
- **Shader warm-up:** `renderer.compileAsync(scene, cam)` behind the loading screen. `KHR_parallel_shader_compile` is not exposed headless, so expect about 2.5–3 s total mission load on the 5090.

### 3.8 Quality presets (prototype values: `render-tech/src/settings.js`; frame times are **best-case**, CORRECTED v2)

Frame times are wall-clock medians over 150 frames at **1920 × 1080 on the RTX 5090** (ANGLE/Vulkan, headless), each with a forced sync. Scene: 40 soldiers, 8 buildings, water, grass, particles, decals, 476k tris, about 740 draws.

| Setting | low | medium | high (default) | ultra |
|---|---|---|---|---|
| AA | FXAA | SMAA | MSAA 4× | MSAA 8× + SMAA |
| AO (N8AO) | off | low, half-res | medium | high |
| Shadow map | 1024, r 1.5 | 2048, r 2 | 4096, r 2.5 | 8192, r 3 |
| Bloom / grade / fog | off / on / on | on | on | on |
| Terrain textures | 512, hex-tiling off | 1k, hex on | 1k (2k aerial), hex on | 2k, hex on |
| Grass density | 0 | 8 | 14 | 24 + shadows |
| Night spotlights (shadowed) / point lights | 0 / 8 | 1 / 12 | 2 / 16 | 4 / 16 |
| Anisotropy | 4 | 8 | 16 | 16 |
| **Measured frame time** (wall, idle GPU) | **1.9 ms** | **2.9 ms** | **3.2 ms** (night 3.5) | **4.3 ms** |
| GPU timer, idle GPU (rendering report) | 0.34 ms | 1.02 ms | 1.36 ms (night 1.83) | 2.23 ms |
| GPU timer, shared GPU at 35 % load (verifier) | — | — | 1.81 ms (night 3.37) | 3.69 ms |

- **CORRECTED (v2):** on a shared GPU the verifier measured 1.3–1.7× the GPU time and 5.6–9.0 ms wall medians (p95 up to 15 ms). Everything is still far under 16.6 ms on a 5090, but **these are best-case numbers: re-measure on the engine with a quiet GPU and on one real mid-range machine before setting auto-detect thresholds.**

- **Headroom.** A mid-range GPU (RTX 3060 / RX 6600 class) is roughly 5–8× slower than the 5090. That estimate is **not measured**. On that basis, high should run at about 16–26 ms and medium at about 15–23 ms, so **medium is the 60 fps default for mid-range hardware and high for high-end**. The contract's target (60 fps at 1080p on "high" with 40 enemies) holds on modern upper-mid GPUs.
- **Auto-detect:**
  - Run a 60-frame benchmark on first launch and pick the highest preset under 12 ms (threshold to be calibrated on real mid-range hardware, not from the table above).
  - Include a DPR cap.
  - Expose a dynamic-resolution option (0.75–1.0 scale) for laptops.

### 3.9 Test and QA hooks for rendering
- **Headless GPU launch:**
  - **CORRECTED (v2): use `--use-angle=gl --ignore-gpu-blocklist --enable-gpu`** with chromium-1223 (`~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`). The Vulkan flags (`--use-angle=vulkan` plus `VK_ICD_FILENAMES`) now lose the WebGL context on this machine. Every verifier ran with ANGLE GL on the RTX 5090 (`ANGLE (NVIDIA ... OpenGL 4.5.0)`).
  - Check `gl.isContextLost()` after every capture; the render prototype page does not call it itself.
  - Put this in `tests/harness.mjs`.
- **Smoke checks per theater screenshot:**
  - mean luminance between 25 and 200,
  - per-channel standard deviation above 15, which catches NaN black frames and blank renders,
  - no `console.error`.
- **Golden shots:** 1 dressed tile per theater at zoom 1 and 2, saved to `docs/screenshots/` for the realism review loop (PROGRESS 4b-c).
- **Benchmark:** `window.__bench(n)` from the render prototype. It reads `EXT_disjoint_timer_query_webgl2` plus wall time with `readPixels` sync; port it to `src/debug/test-api.js`.

---

## 4. Risks and fallbacks

| # | Risk | Likelihood / impact | Mitigation | Fallback |
|---|---|---|---|---|
| R1 | **Prototypes and the Blender 4.2.9 install live in the `/tmp` scratchpad** and will be lost | high / high | Copy `blib.py` and the asset scripts, `glbpack.py`, `lod.py`, `rig.js`, `props.js`, `mpfb_make2.py`, `sfx_build.py`, `post.py`, `gen_voices.py`, `eval_voices.py`, `terrain.js`, `proc.js`, `scene.js` (overlays, night, water, grass), **`crawl.js`, audio `lab/engine.js`, `picks.py`, `fs_search.py`, `manifest.json`** and the manifests into `tools/` and `src/` **now**. Pin the Blender URL and sha256 in `tools/blender.sh`. | Rebuild from this doc, since every command is recorded here |
| R2 | **Sketchfab licence drift**: 24% of the downloaded set changed | high / high | CC0 first; the live `api.sketchfab.com/v3/models/<uid>` gate; archived licence JSON; re-check before each release | Replace the asset with a BL model |
| R3 | **Realism ceiling**: all prototypes read as "good indie, not photoreal" | high / high | The §2.11 order, with lighting and terrain first. Acceptance tiles compared with period photos. The art-director review loop (PROGRESS 4b-c). Per-instance variation, clutter and decals budgeted from day one. | Accept "high-quality realistic RTS" and spend effort on the readability the original is known for |
| R4 | **Buildings and trees are unproven at scale**, yet they are most of the pixels | medium / high | One dressed tile per theater before mass production. Build the tree impostor bake first. | Trees: PH `fir_sapling_medium` at 153k for 5–10 hero trees plus cards. Buildings: simpler massing with stronger decals. |
| R5 | **Tracked AFVs look like toys** (Pz II/III/IV) | medium / medium | Blueprint dimensions, 3-axis validation, human silhouette review, 3–6 h per tank | Re-bake the live CC-BY Tiger or Panther scans as stand-ins (wrong type, correct realism). Or reduce tanks to parked set pieces. |
| R6 | **NaN/Inf black frames**: at night with bloom (measured), and from terrain normals (measured); **root cause still unknown** (verifier) | measured / high | `SanitizePass` **added to the current engine chain now**, source clamps, NaN-safe splat weights, the CI frame-stats smoke test (mean 25–200, std > 15, context not lost) | Disable bloom on night presets |
| R7 | **Characters: uniforms and kit are the critical path** (verifier: largest, unestimated content cost); no free rifle animations; close zoom not realistic (helmet/cap fit, same faces, waxy skin, plastic wool, open fingers, foot sliding) | high / high | Estimate uniforms first; author MHCLO garments and kit in Blender; per-instance face macros; speed-matched locomotion; sheen/wrap shading for close zoom; close-zoom fixes of §1.4 | UAL pistol poses + `attachRifleAuto`; tinted MakeHuman suits (reads at 25–45 px only); limit close zoom until fixed |
| R8 | **Voice accents and TTS licensing**: every Piper voice we tried is lessac-derived or unclear, **including Thorsten** (CORRECTED v2); German enemies depend on Chatterbox alone | medium / medium | Kokoro (Apache-2.0) + Chatterbox (MIT) with default conditioning or consented contributors' references; Whisper QA; never clone identifiable people | Neutral British/American voices; volunteer recordings released CC0 |
| R9 | **pmndrs `postprocessing` supports three < 0.187 only** | certain on upgrade / medium | Freeze r186; vendor the exact files | three's own `EffectComposer` chain (GTAO or SSAO + UnrealBloom + OutputPass + SMAA). The prototype's `pp=three` mode works; it costs about 1–2 ms more and shows AO halos on grass |
| R10 | **VRAM and download size** (WebP decodes to RGBA8; uncompressed texture arrays measured 117 MB) and **KTX2 encoding still untested** | medium / medium | Test KTX-Software `toktx` or `gltf-transform etc1s/uastc` early; per-mission manifests; per-mission audio with streamed beds (187 MB decoded otherwise) | 1k textures on low and medium; drop ultra 2k |
| R11 | **Performance numbers are best-case**: shared-GPU re-runs were 1.3–1.7× slower; mid-range GPUs never measured | medium / medium | Re-measure on the engine with a quiet GPU and on a real mid-range machine before fixing auto-preset thresholds; dynamic resolution; zoom LOD; animation throttling; atlas characters (7 materials → 2) | Low preset |
| R12 | **Sensitive insignia** on downloaded aircraft and vehicles | medium / high | Manual texture check at intake; paint out swastikas; downloaded flags are never used (enemy flags come from `src/art/flags.js`, spec §10.6) | Retexture the whole asset |
| R13 | **Provenance of CC0 sounds and uploads**: game rips posted as CC0, and **CC0 uploads built from NC/BY samples** (Freesound 177556, removed) | medium / high | Read every description for sources, not just the licence field; reject known rips (morganpurkis) and derivatives of non-CC0 samples; prefer period libraries (craigsmith), Kenney and own recordings | Replace the sound from another CC0 source or `procedural.js` |
| R14 | **Scale and proportion errors** from single-axis fitting | medium / medium | `assets/dimensions.json` with 3-axis checks; reject anything more than 10% off; capsules in the review shots | — |
| R15 | **Style mismatch** between scanned PH assets and softer scripted assets | high / medium | Re-bake sourced vehicles through the grime stack; push grime contrast and micro-normals; one grade | Use fewer scanned hero assets next to scripted ones |
| R16 | **Headless GPU flakiness** (WebGL context lost) | measured / low | **`--use-angle=gl --ignore-gpu-blocklist --enable-gpu`** (Vulkan flags now lose the context); check `isContextLost()`; retry once | SwiftShader (slow) |
| R17 | **Non-deterministic bakes** (±5/255) | certain / low | CI compares tris, dimensions and file lists, not pixels | — |
| R18 | **Freesound previews are lossy MP3s**; the originals need a login | certain / low | Fine at game scale | A user Freesound token to fetch the originals |
| R19 | **Dedicated R&D tracks** (VFX, water, terrain, portraits, §1.8) may change the pipeline | medium / medium | Integration contract kept here: layer 1 for all transparent effects, `depthRT` available, `world.fx.spawn`, water as one mesh with its own material, terrain as one material with texture arrays, portraits as UI | The §1.7 interim stand-ins |
| R20 | **Visible-content defects** (rendering verifier's 1:1 crop): grass cards as black silhouettes, dashed tyre-track decals, flat/black water, grey-green blob trees, yellow-green night | certain today / high | Grass off; fix decal UVs/alpha or move tracks to the terrain RT; water Fresnel/env; tree impostors from the terrain track; blue night grade | Hide the element (grass off, no tracks) rather than ship a visible bug |
| R21 | **Audio realism flaws**: 40 m playback cull silences visible shots; hard-coded pan width; no MG42 or distinct German weapons; coasts without ambience; Kenney OGG-only on older Safari | certain today / medium | Per-category `maxDistance`, live frustum half-width, distant layers, procedural MG42 stopgap, coast bed first, MP3/AAC twins for all files | `procedural.js` fallbacks |
| R22 | **Tone-mapping choice unresolved** (textures report: ACES; rendering report: AgX; CONFIG today: ACES) | certain / low | A/B on the finished dressed tiles per theater in the realism loop; grade does most of the work | Keep ACES, the current CONFIG value |

---

## 5. Credits and licences

**Rules:**
- Every shipped asset has a row in `CREDITS.md`, generated from `assets/registry.json`.
- CC-BY assets also carry the exact attribution line and a saved licence snapshot in `assets/licenses/`.
- CC0 credit is optional, but we give it.
- No NC, ND, SA, "royalty-free", store-licensed, or ripped assets.

| Source | What we use | Licence | Verified | Attribution text / notes |
|---|---|---|---|---|
| Poly Haven (polyhaven.com) | textures (§1.1.3), HDRIs (§1.1.5), prop and rock models (§1.2.1) | CC0 1.0 | polyhaven.com/license (both verifiers) | "Textures, HDRIs and models from Poly Haven (CC0)". Authors per asset from `api.polyhaven.com/info/<id>`: Greg Zaal (goegap, kloofendal, spruit_sunrise, moonlit_golf, rogland, kloppenheim, qwantani), Jarod Guest, Sergej Majboroda, Oliksiy Yakovlyev, Andreas Mischok, Rob Tuytel, Dimitrios Savva, Dario Barresi, Rico Cilliers, Charlotte Baglioni, Jenelle van Heerden, Amal Kumar, James Ray Cock, colormass |
| ambientCG (ambientcg.com) | Grass004, Fabric045, Rubber004 (+ more) | CC0 1.0 | docs.ambientcg.com/license (verifier) | "Contains assets from ambientCG.com (CC0)" |
| Sketchfab via Objaverse (`allenai/objaverse`, ODC-By wrapper) | the approved list in §1.2.2 | CC BY 4.0 per model | live `api.sketchfab.com/v3/models/<uid>`, 2026-09-26 (verifier) | `"<Title>" by <author> (https://sketchfab.com/3d-models/<uid>), CC BY 4.0, modified.` For example: "Willys Jeep SAS Desert Patrol Car" by jeandiz; "Sd.Kfz. 222" by Arbuzz747; "SDKFZ 251" by Applepie68905; "Flak 18-36 88mm Anti-Aircraft cannon" by bear17; "Flak Searchlight" by ragnar; "Junkers Ju 87 Stuka" by scorpion81; "BF 109 F-2 Messerschmitt" by GRIP420; "Palm Trees" by ElectroNick; "Tent" by venik42; "Telephone Poles" by caboose3d; "Tank Trap" by Killian_Delias; "Old house" by Tim0; "Old Well with Hanging Bucket" by glowbox3d; "Old wooden cart" by GreenG; "Victorian Street Lamp" by Discovered |
| Quaternius (quaternius.com) | Universal Animation Library 1 and 2 (clips and skeleton); UBC as a fallback mannequin | CC0 1.0 | **VERIFIED** (`License.txt` in the zips, itch.io page) | "Animations by @Quaternius (CC0)" |
| MakeHuman / MPFB2 (makehumancommunity.org) | body meshes, skins, clothes, rig from the **system assets** | CC0 1.0 (assets); MPFB code GPL, a build tool only | **VERIFIED** (asset headers "explicitly released as CC0", `LICENSE.md` §C/§D: no claim on output) | "Characters built with MakeHuman/MPFB (CC0 assets)" |
| ACCAD Open Motion Project (Ohio State University) | go-prone / stand-up transitions, lie idle, look-around BVHs (retargeted after a rest-pose fix; the crawl itself is procedural) | **CC BY 3.0 Unported** | **VERIFIED** (accad.osu.edu motion-lab page) | "Motion capture: Open Motion Project by ACCAD/The Ohio State University, licensed under CC BY 3.0. Modified (retargeted)." |
| CMU Graphics Lab Motion Capture Database | only actions nothing else covers (`90_16`, `85_15` deaths, `13_33` ladder), **baked into `anims.glb`, never raw BVH** | custom: free use, "may not resell this data directly, even in converted form" | **VERIFIED** terms; residual fork-resale risk (§1.4) | "Motion data from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| Freesound (freesound.org) | 71 source sounds (§1.5.1; 177556 removed) | CC0 1.0 | all live 2026-09-26 (synthesis); a sample of 10 **VERIFIED** independently; **provenance** checked per description (v2) | Per-sound credit: "<title> by <user> (freesound.org/s/<id>)". Includes craigsmith (Hollywood nitrate FX, USC), qubodup (DVIDS public-domain sources), unfa, kyles, SuperPhat, Kostrava, … (full list in the SFX `manifest.json`) |
| Kenney (kenney.nl) | impact, interface, RPG, UI and voiceover audio packs | CC0 1.0 | **VERIFIED** (`License.txt`, kenney.nl page) | "Audio by Kenney (www.kenney.nl), CC0" |
| Kokoro-82M (hexgrad) | English TTS voices | Apache-2.0 | **VERIFIED** (HF README `license: apache-2.0`) | "Voices generated with Kokoro-82M (Apache-2.0)" |
| Chatterbox Multilingual (Resemble AI) | German, French and expressive TTS | MIT | Hugging Face API (synthesis check; not re-verified) | "Voices generated with Chatterbox (MIT, Resemble AI)"; watermarked output; reference voices only default or consented (§1.5.2) |
| Piper voices (rhasspy) | **none shipped (CORRECTED v2)**; `en_US-norman` (LibriVox PD) only after its MODEL_CARD is re-checked | per-voice dataset; Piper runtime MIT | model cards; Thorsten-high found lessac-finetuned (verifier) | — |
| three.js r186 | engine, addons (GLTFLoader, KTX2Loader, HDRLoader, basis, meshopt decoder), `waternormals.jpg` | MIT | vendored; **VERIFIED** | "three.js © three.js authors (MIT)" |
| pmndrs postprocessing 6.39.5 | post chain | Zlib | **VERIFIED** (GitHub `LICENSE.md`, npm; vendored SHA-1 507f4bb9… matches) | "postprocessing © 2015 Raoul van Rüschen (Zlib)"; keep the header |
| N8AO 2.0.1 | ambient occlusion | ISC (repo licence CC0 1.0) | **VERIFIED** (npm, repo; vendored SHA-1 efe3181f… matches) | "N8AO by N8python (ISC)"; keep the header |
| meshoptimizer decoder | GLB geometry decode | MIT | npm (me) | — |
| Build tools, not shipped | Blender 4.2 (GPL), glTF-Transform 4.x (MIT), sharp (Apache-2.0), KTX-Software (Apache-2.0, mixed "NOASSERTION"), faster-whisper (MIT), ffmpeg (imageio-ffmpeg static build; LGPL/GPL tool), Pillow (HPND) | — | — | Not distributed; list them in the README |
| Our own work | Blender-scripted meshes, baked atlases (derived from CC0 inputs), procedural textures and decals, generated voices, code | Project licence (CC0 or MIT for the art: user decision) | — | "Original assets © SHADOW SIX contributors" |

**Excluded (never use):**
- Original *Commandos* game files, sprites, sounds or voices, and any rips of them.
- Quixel Megascans.
- Mixamo.
- BlenderKit "Royalty Free".
- TurboSquid/CGTrader "free".
- Sketchfab NC, ND, SA or Standard models, including the drifted list in §1.2.2.
- Piper `en_GB-alan`, Semaine, Pavoque, hfc_male and ryan voices; **Piper Thorsten (all variants), joe, vctk, northern_english_male and any lessac-finetuned voice** (CORRECTED v2).
- Zero-shot cloning of any identifiable person's voice or face (actors, the original cast, dataset speakers such as Thorsten or LibriVox readers) without recorded consent.
- **Bandai-Namco Research Motion (CC BY-NC 4.0)**, Ubisoft LAFAN1 (CC BY-NC-ND), "personal use" BVH packs.
- Raw CMU BVH folders in the repo (baked clips only; see the CMU row).
- Freesound sounds by morganpurkis (game-SFX edits) and **Freesound 177556** (Hugofski; built from CC BY-NC samples); any CC0 upload built from non-CC0 samples.
- ez-tree's bundled leaf textures (unknown licence; the terrain track uses its own generator).
- Talking-head / face models whose weights are NC or depend on non-commercial face-recognition weights (for example Wav2Lip, SadTalker with BFM, Sonic, FLOAT, and insightface-based pipelines), per the portraits track's licence screen; `docs/talking-portraits.md` is authoritative.

---

## Appendix A: prototype code index (scratchpad → repo target)

| Prototype path (under `scratchpad/realism/`) | What it proves | Repo target |
|---|---|---|
| `cc0-models/site/{index.html,harness.js,catalog.js}`, `tools/run.mjs`, `node/stats.mjs` | model loading, fitting, ortho game camera, dioramas, GPU headless runner | `tools/assets/intake.mjs`, `tools/shots/` |
| `blender-modeling/{blib.py,truck.py,house.py,tower.py,lod.py,glbpack.py,scene_render.py,web/}` | scripted model → bake → GLB; LODs; WebP pack; three.js review shots | `tools/blender/` |
| `pbr-hdri/tools/{manifest.py,sheets.py,hdri_sheet.py}`, `proto/main.js` | texture and HDRI selection, download manifest, terrain splat, HDRI sun extraction, retint and grime | `tools/assets/textures.py`, `src/art/terrain.js`, `src/engine/lighting.js` |
| `render-tech/src/{main.js,settings.js,terrain.js,scene.js,proc.js,layout.js}`, `tools/{shoot.mjs,shoot_synth.mjs}`, `vendor_ext/` | the post chain, presets, overlays, night lights, grass, water, decals, benchmark | `src/engine/renderer.js`, `src/render/*`, `src/art/terrain.js`, `vendor/addons/ext/` |
| `characters/{mpfb_make2.py,web/rig.js,web/props.js,web/crawl.js,web/lib.js,scenes/{r4_lineup,r5_final,b1_perf}.js}`, `blender-4.2.9-linux-x64/` | MakeHuman → UAL rebind, BVH retarget, clip adaptation, kit attachment | `tools/characters/`, `src/art/humanoid.js` |
| `audio/tools/{sfx_build.py,picks.py,fs_search.py,gen_voices.py,gen_kokoro_de.py,post.py,eval_voices.py}`, `out/web/{sfx,voices}` | SFX build and manifest, TTS generation, post-processing, Whisper QA | `tools/audio/`, `assets/audio/` |
| `../voices/tools/{cb_test.py,common.py}` | Chatterbox Multilingual on CUDA | `tools/audio/chatterbox_gen.py` |
| `audio/lab/{engine.js,procedural.js,test.js,run.mjs}`, `audio/out/lab/scenario_town.wav` | WebAudio runtime (ortho listener, IRs, buses, voice caps, ambience), procedural fallbacks, GPU test harness (**VERIFIED** re-run) | `src/audio/audio.js`, `src/audio/sounds.js`, `tests/audio/` |
| `verify2c/`, `verify2_audio/`, `verify2_rendering/` (under `scratchpad/`) | the independent verifiers' re-runs and contact sheets | reference only |
| `../vfx/*`, `../water/{a,b,final}`, `../terrain/{a,b}`, `../faces/{realtime,neural}` | dedicated R&D tracks (§1.8) | see each track doc |
