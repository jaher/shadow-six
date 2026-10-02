# Vegetation pipeline (plan): "as real as possible"

User request (2026-09-30, while playing): *"Work on making vegetation as real as possible."* Earlier requests that
still apply: *"Grass should look more realistic rather than a repeated texture"*, *"All trees should look
different"*, *"Trees and foliage should also be affected by the wind"* and *"make the leaves of the pine trees more
realistic"*.

This document lists the vegetation we have today, the look we want in each theatre, and the technique, budget and
order of work for each plant type. It builds on `docs/terrain-pipeline.md` (ground, grass, trees and impostors),
`docs/wind-pipeline.md` (the shared wind field) and `docs/realism-pipeline.md` (asset sources and renderer
limits).

**Not covered here: pines, spruces and firs.** They are being rebuilt on branch `feat/pine-needles` (new
`conifers.js`, a baked needle atlas and `makeNeedleMaterials`). This plan reuses that work: its atlas layout,
coverage-preserving alpha, crown AO attribute and translucency. It also keeps `generateTree`, `SPECIES`,
`LEAF_LAYERS` and the `aInfo`/`aRoot` vertex layout compatible with that branch.

---

## 1. Inventory: what exists today (master 8e995a0)

### 1.1 Systems

| system | file(s) | what it draws | technique | wind | LOD / budget |
|---|---|---|---|---|---|
| Grass | `art/terrain/grass.js`, `grass-glsl.js` | Grass tufts wherever the splat has grass weight | Instanced 3D blades. There are only **two tuft meshes**: green (seed 11, 0.18–0.46 m) and dry (seed 12, 0.20–0.55 m). Tufts sit on a **jittered grid** at 9 × density per m², 8 m chunks, per-instance height, colour and rotation. | Drag ∝ v², oscillation, gust waves, trampling from the trail RT | Shuffled-prefix density LOD by zoom and distance. Blades 5/7/9/10 by preset. Not in the GTAO prepass. About 47k tufts on a meadow map. |
| Ground clutter | `art/terrain/clutter.js` | Stones (all theatres), five wildflowers (temperate), weed rosettes (temperate and desert) | Instanced meshes. A flower is a 3-sided stem plus a **flat scalloped disc**. A weed is **5–8 flat leaf quads radiating from a point** (`weedGeo`). | none | `q.clutter` 0.4/0.7/1/1.3. Placement is random per m². |
| Desert "camel-thorn" | `clutter.js` `weedGeo` × 2.2 | The low desert plants on open sand | **The same flat star rosette, scaled 2.2× and tinted brown.** This is the orchestrator's "flat star-shaped paper cut-outs lying on the ground". | none | Same as clutter |
| Trees, bushes, hedges | `art/terrain/treegen.js`, `vegetation.js`, `treegen.worker.js` | Every mission `tree`/`pine`/`palm`/`bush` structure that has an x/z | A seeded procedural generator (every tree unique). Bark tubes plus leaf **cluster cards** from `assets/terrain/foliage.webp` (ambientCG leaf scans). Geometry is merged per 20 m chunk, giving two draw calls (bark and leaves). Workers are used for 40 or more trees. | Hierarchical: trunk bend, branch sway, leaf flutter, palm whip. Stiffness per kind. | `MAX_UNIQUE` 150/300/400/500. The rest becomes impostors. Card count is ×0.45/0.7/1/1.15 by preset. |
| Impostors | `art/terrain/impostors.js` | Interiors of dense stands above the unique budget | Two prototypes per species, six azimuths baked at the game pitch (albedo plus view-space normal), lit at runtime, one instanced draw. | Trunk lean and sway on the billboard | 128–224 px tiles. 50–69 MB of atlases on forest maps. |
| Snow on plants | `art/terrain/snowfx.js` `SNOW_COVER_GLSL` | Snow load on conifers and stones; broadleaves leafless in snow | Shader coverage with a noise clump mask | `wind-fx.js` shakes snow puffs off conifers in gusts | none |
| Placement pruning | `world/placement.js` `pruneTree` | Raises crown base and narrows crowns near buildings | Placement hints `crownBase` and `crownR` | none | none |

### 1.2 Species (`treegen.js SPECIES`) and how missions get them (`art/terrain.js treePlacement`)

- **Broadleaf** (`kind: 'broad'`): oak, beech, plane, poplar, birch, olive and dead_tree. Also cypress, which reuses
  the poplar shape with fir cards.
- **Conifer:** spruce, fir and pine. The pines branch owns these.
- **Palm:** date_palm. Its fronds are **solid folded ribbons**: a 7-segment strip with a V fold, textured with one
  frond card. Palms have no trunk leaf-base pattern, no dead skirt and no date clusters.
- **Bush** (`kind: 'bush'`): hedge, shrub and desert_shrub. Each is 3–6 thin stems plus 22–90 leaf cards scattered
  in an ellipsoid. **Hedge and shrub share the same `hedge` leaf layer.** `desert_shrub` uses the `scrub` cards with
  35 % of them dropped.
- `treePlacement` mapping:
  - `tree` → a random pick from oak, beech, plane, birch or poplar in temperate and coast; olive in desert;
    birch or oak in snow.
  - `bush` → shrub or hedge in temperate; desert_shrub in desert.
  - `palm` → date_palm.
  - The mission `variant` field is ignored except for `dead` and `bare_winter`. `broadleaf_normandy`,
    `scrub_desert` and `pine_frost` have no effect.

### 1.3 Per mission

From `treePlacement` over every structure (`node` inventory, sandbox and BCD included):

| mission | theatre | trees and bushes | other vegetation | gaps |
|---|---|---|---|---|
| M00 sandbox | temperate | 1 each of poplar, beech, pine, shrub and hedge | grass, flowers | none |
| M01 | snow | 9 spruce, 3 fir, bare birch, bare oak, bare beech | dry grass poking through snow | No juniper or low birch scrub. Bare trees have no twig density. |
| M02 / M03 | snow | 8 spruce + 3 fir / 6 spruce + 3 fir | same | same |
| M04 | snow | 125 spruce, 37 fir, plus a `forest` area polygon | same | **Forest area polygons are skipped.** `map-builder.js:726` keeps point trees only, so the area blocks the grid but draws nothing. Verify in game. |
| M05 / M07 | snow | 72 spruce + 18 fir / 20 spruce + 8 fir | same | none |
| M06 Masi, Finnmark, 10 May | temperate | 15 pine, 8 spruce | lush green meadow grass | **Wrong biome and season.** Finnmark in May is just past the thaw: mountain-birch scrub still bare, dwarf birch, juniper, crowberry and lichen heath, straw-coloured last-year grass, snow patches. |
| M08 Pyrotechnics | desert | 3 desert_shrub, 3 date_palm | weed stars | Flat stars. Palms are ribbons. |
| M09 / M10 | desert | 13 / 12 desert_shrub | weed stars, dry grass on `grassdry` | same |
| M11 In the Soup | desert | 22 desert_shrub, 3 date_palm | weed stars | same |
| M12 Up on the Roof | desert | 2 date_palm | town: no planting | No courtyard plants (fig, oleander, bougainvillea). |
| M13 David & Goliath | coast | **none** | temperate grass, flowers | No dune grass, no hedgerow, no reeds. |
| M14 D-Day | coast | 14 broadleaves (`broadleaf_normandy`, random oak, beech, plane, birch and poplar) | temperate grass on the bluff; beach bare | No marram on the dunes. The bocage has no hedgerows. The variant is ignored. |
| M15 Butcher | temperate | 16 broadleaf/pine and 6 shrub/hedge | grass, flowers | Hedges are generic blobs. |
| M16 Liège (Maas), 4 Sep | temperate | 16 broadleaves | grass, flowers | No riverside plants: willow, alder, reeds on the Maas banks. Late-summer seed heads and yellowing missing. (Not Normandy: only M13 and M14 are on the Channel coast.) |
| M17 Alsace 28 Nov · M18 Liège 16 Dec · M19 Oldenburg 12 Jan | temperate | 13–17 mixed broadleaves (M19 adds pine and spruce) | green grass, summer wildflowers | **These are winter missions drawn in full summer leaf.** Broadleaves should be bare (oak and beech keep some brown leaves), grass winter-brown, no flowers. No vineyards (Alsace), orchards or riverside willows. M18 has a "reed neck" with **no reeds**. |
| M20 Gundelfingen near Freiburg, 11 Feb | temperate | 7 pine and 3 spruce (`pine_frost`), plus a `forest` area polygon (x 0–157, z 0–24) | grass | The forest strip is not drawn. The before shot at 80:14 shows dark grass and no trees, the same bug as M04. There are no beech, oak or birch, so it does not read as a Black Forest-edge mixed wood. It is also a February mission: broadleaves should be bare and the grass brown. |
| B00 BCD sandbox | temperate | none | grass | none |

Nothing in the code or assets produces reeds, crops, vines or ivy, hedgerow banks, flowering shrubs, cacti or
agaves, or dune grass. The coast palette is a copy of temperate (`PALETTES.coast`), so beaches never get
shore-specific plants.

### 1.4 Before shots

Taken with `tools/perf/shot.mjs` (preset high, 1280×720, centred on the first commando) at zoom 1 and zoom 2:
M1, M6, M8, M11, M14, M16 and M20, plus close-ups on the vegetation. They are in the session scratchpad
(`veg/before-*.jpg`), not in the repo. What they show:

- **Grass** (M16, M20, M6): reads as grass at zoom 1. It is a very even carpet with no clumping. Blade tips are too
  pale and too regular. Patterns repeat because every tuft is one of two meshes on a jittered grid.
- **Desert** (M8, M11):
  - Open sand with nothing standing up. The few weeds are flat brown stars.
  - `desert_shrub` reads as 3–6 spindly sticks with a few cards, like dead weeds rather than a living shrub.
  - Date palms have a smooth bare trunk (no leaf bases and no dead-frond skirt) and single-ribbon fronds.
  - The M8 start shot caught the terrain before it had finished building. `shot.mjs` does not wait for
    `terrain.ready`, which is a tooling caveat for after-shots.
- **Normandy** (M14): the beach and bluff edge are bare sand and grass. No marram, no sea kale, no hedgerow.
- **Broadleaves** (M14, M16, M20): card clumps read well at zoom 1. At zoom 2 (M14 close-up) the crowns are noisy
  card clusters with **near-black voids** inside, ragged rectangular card edges and repeated clumps. Every
  species has the same uniform olive tone.
- **Conifers** (M6): a star-shaped silhouette from above (the pines branch fixes this).

---

## 2. Target look per theatre

References are Wikimedia Commons photos (CC0, CC-BY or CC-BY-SA). They were downscaled to ≤ 900 px for study only
and are **not shipped**. The list is in the scratchpad at `veg/ref/SOURCES.txt`: desert ×5, Norway ×4, Normandy
coast ×5, temperate ×4.

Realism starts from the **date and place** of each mission, not the theatre tag. Four of the "temperate" missions
are winter missions.

| mission(s) | place, date | vegetation state |
|---|---|---|
| M01–M05, M07 | Norway coast and fjords, Feb–May 1941/42 | Snow. Spruce and pine (pines branch). Bare birch and alder. Juniper and dwarf willow as dark lumps half-buried in the snow. Straw-coloured grass poking through on wind-scoured ground. |
| M06 | Masi, Finnmark, 10 May | Thaw. Mountain birch (*Betula pubescens* ssp. *czerepanovii*): low, multi-stem, bare or with a first green haze. Dwarf birch, juniper and crowberry heath. Grey-green lichen mats. Last year's straw grass. Snow in hollows. Sparse Scots pine. |
| M08–M11 | Western Desert (Egypt, Libya), Oct–Dec | Sparse. 90 % bare ground. Plants grow in **clumps around their own wind-blown sand mound** (nebkha). Species: camel-thorn (*Alhagi*), white broom (*Retama raetam*), saltbush and *Haloxylon*, drinn grass tussocks (*Stipagrostis pungens*), dead tumble twigs. Date palms only at wells or oases, in groups with suckers at the base. |
| M12 | Tunis, 15 Mar | Spring in the Mediterranean. Olives, date and Canary palms, agave and prickly pear on field edges, eucalyptus along roads, green annual grass with yellow oxalis and poppies. |
| M13 | Le Havre, 15 May | Port town on the coast. Ruderal weeds in rubble (buddleia, rosebay willowherb, ragwort), sycamore and plane in streets, marram on any dune. |
| M14 | Juno, La Rivière, 25 May | Beach. Strandline (sea rocket, sea kale). Dune and marram grass on the sea wall and bluff, blowing in the wind. Inland: **bocage** of earth banks topped with hawthorn, hazel, blackthorn and pollarded oak and ash. Lush May grass, cow parsley, buttercups. Orchards with apple blossom over. |
| M15 | Compiègne, 26 Aug | Late summer. Oak and beech forest (Forêt de Compiègne). Yellowing hay, wheat stubble, dusty verges, brambles, nettles. |
| M16 | Liège, 4 Sep | Late summer by the river. Poplar rows, willows and alder on the Maas banks, **reeds**, meadows with seed heads, first yellowing. |
| M17 | Alsace, 28 Nov | Late autumn. **Vineyards** (bare vines on wires). Oak and beech with brown leaves hanging on, others bare. Wet brown grass. Leaf litter. |
| M18 | Liège, 16 Dec | Winter (Battle of the Bulge). Bare broadleaves, frosted brown grass, reeds dry and buff, light snow or rime. |
| M19 | Oldenburg, 12 Jan | Winter, north German lowland. Bare oak, birch and alder. Pine plantations. Heather and moor grass, buff and grey. Mud. |
| M20 | Gundelfingen near Freiburg, 11 Feb | Winter at the edge of the Black Forest. Spruce and fir forest (pines branch) mixed with bare beech and oak. Frosted grass. Bare vineyards on the castle slope. Ivy on walls and trunks. |

### 2.1 Desert (North Africa)
- **Ground cover is ~5–10 %**, in clumps that each sit on a small sand mound (nebkha) with a wind-shadow tail
  downwind (wind preset `desert`).
- **Nothing lies flat.** Every desert plant is a 3D volume: a dome of thin, wiry, grey-green to buff twigs.
  - Camel-thorn: 0.3–0.8 m, spiny, many fine twigs at 45°.
  - Retama: 1–2.5 m. Long, almost leafless green rods arch out from a woody base.
  - Saltbush and *Haloxylon*: grey-green, dense, 0.5–1.5 m. Jointed stems.
  - Drinn tussocks: 0.4–1 m. A fountain of stiff straw blades, green only at the base.
- Dead plants are as common as live ones: grey, bleached twig skeletons.
- **Date palms** grow in groups. Each has a fibrous trunk with diamond leaf-base stubs and a dead-frond skirt
  hanging below a crown of 20–30 pinnate fronds. Each frond is a rachis with paired leaflets that make a
  V-section. Suckers grow at the foot, and date bunches hang in October.

### 2.2 Norway (winter)
The pines branch owns the conifers. For everything else:
- Bare birch has white bark with dark lenticels and a fine purple-brown twig haze. The **twig density reads as a
  soft halo** from the game camera, not as individual sticks.
- Juniper and willow scrub are dark masses with snow caps.
- Dry grass poking through snow (existing).

### 2.3 Normandy, Le Havre, Belgium coast (May)
- **Marram** on dunes and the bluff edge: blue-grey-green, 0.6–1.2 m, rolled stiff blades in dense clumps with
  bare sand between. Sand gathers at the base. Moves strongly in the `coast` wind.
- **Bocage hedgerows:** an earth bank 1–1.5 m high, topped with a 2–4 m hedge (hawthorn, hazel, blackthorn and
  bramble), with standard oak, ash and elm every 10–20 m. The hedge itself is dense, irregular and layered, with
  a ragged top and bramble trailing out of the bank.
- **Reeds** at the water's edge: *Phragmites*, 2–3 m. Green in May, buff in winter. Feathery plumes. Dense stands
  with a sharp edge into open water.

### 2.4 Temperate inland (France, Belgium, Germany)
- The season comes from the date (table above).
- Summer (M15, M16): grass with seed heads, clumpy and uneven, mixed green and straw, with patches of clover,
  plantain and yarrow. Nettles and docks along walls. Broadleaves are distinctly different species: oak
  (lobed clumps, irregular dome), beech (smooth grey trunk, layered sprays), plane (patchy bark), poplar
  (columnar), willow (pollards by the water) and fruit trees.
- Winter (M17–M20): bare crowns with real twig hierarchy, marcescent brown leaves on young oak and beech, ivy
  on trunks, brown and grey grass, frost.

---

## 3. Technique per type

### 3.0 Rules that apply to all types
- **No flat ground cut-outs.** Every plant has height and volume, receives and casts shadows, and has some
  silhouette against the ground from the 40° camera. Retire `weedGeo` for anything wider than 0.3 m.
- **Alpha.** The renderer has `antialias:false` with SMAA/FXAA in post and no MSAA, so `alphaToCoverage` falls back
  to a plain threshold. Use the pines branch's **coverage-preserving alpha test** (alpha scaled up with the mip
  level, `needleAlpha`) on every card material. Bake atlases opaque and bled, with coverage in a separate channel,
  so mips never darken.
- **Normals.**
  - Cards: tangent normal maps from the bake, mixed with bent crown normals (`bendNormals`, already in
    `generateTree`) so a crown shades as one volume.
  - Grass: blade normals bent outward from the tuft centre.
- **Translucency.** The current leaf term (`0.07 + 0.16·back + 0.3·forward-scatter`) becomes a **thickness map**
  per card (thin leaf edges glow, twigs do not) plus a per-species transmission colour: yellow-green for beech,
  blue-green for marram, buff for dry grass.
- **Colour variation at three scales.**
  1. Per plant: hue and brightness from the seed (exists).
  2. Per clump or card: age, sun and shade, and dead tips.
  3. Per field: low-frequency patches of greener and drier grass driven by the terrain wetness and splat.

  Nothing reads as a single tint.
- **Placement is ecological, not uniform.**
  - Use Poisson-disc or clumped (Neyman–Scott) processes, not jittered grids.
  - Density is driven by the splat, wetness, slope, distance to water, distance to walls and paths, and the
    wind shadow.
  - Plants avoid paths (the trail records already exist) and grow along fence lines, walls and building edges.
- **Wind.** Every new plant gets an `aRoot`/`aInfo` (or grass-style) wind response from `WIND_GLSL`. Stiffness
  classes: grass 0.4, reed 0.6, marram 0.7, shrub 1.25, hedge 1.6 (a hedge barely moves as a mass; its outer
  sprays flutter), palm 1.35 with frond whip. Gust fronts must visibly travel across reed beds and dune grass.
- **Seasons.** Add a `mission.vegetation.season` field (`spring | summer | autumn | winter`) and a `thaw` flag,
  defaulting from the theatre. It drives leafless broadleaves, grass colour and height, flowers on or off, reed
  colour and marcescent leaves. Snow missions keep today's behaviour.

### 3.1 Grass (all non-snow theatres)
Keep the instanced 3D blades, which work and are budgeted. Fix the repetition:
- **Tuft archetypes.** Use **8–12 tuft meshes** instead of two:
  - fine meadow;
  - coarse tussock;
  - seed-head grass: a stem with a panicle card on top;
  - flattened or trodden;
  - clover and forb rosettes (3D, cupped, not flat);
  - dry straw;
  - winter brown, flopped over;
  - dune grass;
  - drinn.

  Each species mix is a weighted table per theatre and season.
- **Clumped placement.** Replace the jittered grid with blue-noise points modulated by two noise octaves and a
  clump process (3–7 tufts per clump, gaps between clumps). Density follows the splat and wetness.
- **Blade shading.**
  - Colour runs from root to tip: dark and desaturated at the root, lighter towards the tip, with dead brown tips
    in late summer.
  - There is a per-blade hue jitter.
  - Specular sheen comes from the blade normal. The pale *flanks* show in gusts (exists).
  - **The bright white-ish tips are removed.**
- **Ground tie-in.** Darken the ground under grass with the existing ×0.64, plus a contact AO term from tuft
  density so tufts do not float.
- **Budget.** Keep about 47k tufts on a meadow map at high. Vertex count goes up by at most 20 % for the new
  archetypes. The extra variety comes from choosing among more meshes, not from more blades.

### 3.2 Desert ground plants (replace the flat stars)
- **Technique.** Real low-poly 3D shrubs, built as instanced *archetypes* of 600–1,500 triangles each and
  generated once per mission by a seeded `shrubgen` that shares its wind and lighting with treegen:
  - a woody base;
  - recursive wiry twigs as thin 3-sided tubes, plus **twig cards** (alpha cards of fine spiny twigs from a baked
    atlas) for the fine hair;
  - small leaf or thorn clusters.
- **Archetypes.** 6–10 per species, with per-instance scale, rotation, tint and a "dead" variant.
  - Camel-thorn: hemispherical, spiny.
  - Retama: arching rods, a fountain.
  - Saltbush: dense grey ball.
  - Drinn: a fountain of straw blades, using a grass-blade mesh with stiffness 0.7.
  - Dead twig skeleton.
- **Nebkha.** Each shrub stamps a small sand mound plus a downwind tail into the terrain (`opts.paint` and
  height), so the plant sits *in* the ground. This removes the "sticker" look.
- **Placement.** Clustered near wadis, roads and walls (water run-off), spaced well apart (Poisson radius 3–8 m)
  on open sand. Mission `bush` structures (`scrub_desert`) become hero instances of the same archetypes.
- **Budget.** At most 2,000 instances per map. About 1.5 M triangles at high and about 0.4 M at low, where
  archetypes drop their twig cards. One draw per archetype per material.

### 3.3 Palms
- **Date palm, rebuilt.**
  - Trunk: tapered, with a diamond leaf-base pattern (bark texture plus a normal and displacement ring every
    7–10 cm). A slight curve and lean (existing).
  - Crown: 20–30 fronds with phyllotaxis (exists). Each frond is a **rachis tube plus 30–60 pairs of leaflet
    cards** in a V, shortening towards the tip. Leaflets are separate narrow strips, not one textured ribbon.
    Older fronds droop.
  - A **dead-frond skirt** of 5–15 brown fronds hanging down the trunk, unless the palm is pruned.
  - Suckers at the base. Optional date bunches (orange) in October, under the crown.
- **Canary palm** for M12 (Tunis): a thick straight trunk and a dense, rounder crown.
- **Wind.** Frond whip exists. Add leaflet flutter at the frond tips.
- **Budget.** About 6–10k triangles per hero palm, with impostors past the budget (oasis groves).

### 3.4 Shrubs and bushes (temperate, coast, Norway)
- **Technique.** Procedural branching like treegen (2–3 levels, short internodes), with **species leaf cards** at
  the twig tips rather than cards scattered in an ellipsoid. Crown-shell normals.
- **Species.**
  - Hawthorn: small lobed leaves, white blossom in May (M14).
  - Hazel: multi-stem, large round leaves.
  - Elder.
  - Bramble: arching canes as spline tubes with leaf cards, trailing over walls and banks.
  - Buddleia (rubble at Le Havre).
  - Juniper (Norway): dense needle cards, reusing the pines atlas.
  - Dwarf birch.
  - Oleander (Tunis).
- Each species gets its own `LEAF_LAYERS` entry (today `hedge` and `shrub` share one).

### 3.5 Hedges and bocage hedgerows
- Add a **new linear structure** `hedgerow` with `points`, `width`, `h` and `bank` (an earth bank height):
  - **Bank:** extruded along the polyline with a rounded profile, splatted dirt and grass, with grass and bramble
    on it. It blocks movement and gives partial cover, as in Commandos.
  - **Hedge:** a seeded run of overlapping shrub crowns (hawthorn, hazel, blackthorn) generated *along* the
    polyline, with a ragged top, gaps and a different density per side. Standard oaks or ashes every 10–20 m
    are hero trees.
  - Gameplay footprint: the bank and hedge are one obstacle that blocks line of sight above 1.8 m. **Footprints
    stay identical to today's `bush` and `hedge` placements** where missions already place them.
- **Technique.** treegen bush crowns chained along the curve and merged into the 20 m chunks. No new draw calls.
- **Garden hedges** (privet and box, M15 and M13 towns): trimmed boxes. A rounded box mesh with small-leaf cards
  over its shell (a shell of 2 layers, dense), slightly irregular.

### 3.6 Deciduous trees
Keep treegen. It is already procedural, seeded and unique. Improve the following:
- **Species-specific architecture.**
  - Oak: crooked, horizontal limbs.
  - Beech: fan-like ascending branches with layered sprays.
  - Plane: open crown.
  - Lombardy poplar: fastigiate.
  - Willow (new): pollards with a knob and whips, or weeping.
  - Ash (new): sparse, upward, pinnate leaves.
  - Alder (new): conical, by water.
  - Apple (new): small, spreading, orchard rows.
  - Sycamore and horse chestnut (new): town trees.
- **Leaves.** Rebake `foliage.webp` like the pines' `needles.webp`: twig sprays with real leaves at scan
  resolution, opaque and bled albedo, a normal map, a coverage channel and thickness. Use 3–4 spray variants per
  species, not two.
- **Leaf cards at twig tips only**, following the branch direction (exists). Add a sun-facing bias (phototropism)
  so the outer shell is denser on top and south, and a shade-gap fraction so the crown shows sky holes.
- **Bare trees** (winter missions and snow): the twig levels need their own fine **twig cards** (an atlas of
  branching twig silhouettes). A bare crown then reads as a fine purple-brown haze, not 4-sided sticks.
  Marcescent brown-leaf cards on young oak and beech.
- **Ivy** on trunks (M20, M17): leaf cards spiralling up the trunk, from treegen's bark path.
- **Trunk base.** Root flare (exists), plus a soil, litter and moss ring decal painted into the splat (forest
  floor paint exists).

### 3.7 Reeds, dune grass and shore plants
- **Reeds** (`Phragmites`). Instanced stems: a tapered blade strip of 4–6 segments with 4–8 alternate leaf
  ribbons, plus a **plume card** on top.
  - Grown by the water mask: the `SHALLOW` cells and a 0–3 m land band, with 40–120 stems/m² in a sharp-edged
    stand and sparse outliers.
  - Height 1.8–3 m.
  - Season colour: green (May to Sep) or buff with a grey plume (winter).
  - Wind: stiffness 0.6, with the whole stand waving as gust fronts pass.
  - Drawn through the grass system (same chunks, LOD and trampling). A boat or wading unit parts them by trail
    flattening.
- **Marram and dune grass.** A tuft archetype in the grass system: rolled, stiff, blue-green blades of 0.6–1.2 m
  in tight clumps. Placed by a new `dune` splat weight on coast sand above the high-tide line, sand bank and bluff
  faces.
- **Strandline.** Sparse sea rocket and sea kale (3D rosettes, cupped leaves) and wrack lines (a splat decal).

### 3.8 Crops, vines and orchards (new, mission-placed)
- `field` area structure: `crop: 'wheat' | 'stubble' | 'hay' | 'beet' | 'fallow'`, plus a row direction.
  - Wheat (M15 August): golden, 0.9 m. Drawn as grass-system tufts with ear cards in rows.
  - Stubble: short.
  - Hay: bales and windrows as props.
- `vineyard` area (M17 and M20, Alsace and Baden): posts and wires as props, plus bare vine stocks (twisted
  trunk tube and canes, leafless in winter).
- `orchard`: apple or pear in a grid of hero trees (the new `apple` species).

### 3.9 Ground clutter
- Flowers become small 3D heads (petal cards in a cup) on curved stems, with leaves, placed in drifts.
  - May (M13, M14): buttercup, cow parsley (umbel cards), red campion.
  - Summer (M15, M16): yarrow, knapweed, chicory.
  - **Winter (M17–M20): none.**
- Weeds become 3D dock and plantain rosettes (cupped leaves rising 10–25°) and nettle clumps (upright stems)
  along walls.
- Fallen leaves: a litter splat under broadleaves (exists as `leaves`), plus sparse leaf cards on top in autumn
  and winter.
- Norway: lichen and crowberry heath patches as splat plus small cushion clumps (M06).

### 3.10 Mission data hooks (backwards compatible)
- `treePlacement` honours `variant` as a hint:
  - `broadleaf_normandy` → oak, ash, hawthorn standards, elm;
  - `scrub_desert` → the desert shrub mix;
  - `pine_frost` → the conifer mix from the pines branch, plus bare beech and oak in M20.

  Unknown variants keep today's defaults.
- **Forest area polygons** (`type: 'pine' | 'tree'` with `points`, M04 and M20) are filled with seeded
  Poisson-disc trees (spacing 3.5–6 m, edge trees larger and fuller). Interior trees become impostors. The gameplay
  footprint is unchanged. This fixes the missing forests.
- Optional `mission.vegetation`: `{ season, thaw, grassMix, hedgerows:[...], fields:[...], reeds:bool, dunes:bool }`.
  Every key has a theatre and date default, so no mission *needs* editing.

---

## 4. Interaction rules

- **Trampling.** Grass, reeds, dune grass and crops flatten under walkers and vehicles through the existing
  `flatTexture`. Shrubs do not flatten. Vehicles crush desert shrubs and small bushes, which then swap to the
  "dead/crushed" archetype (one instance attribute).
- **Explosions and fire.** Plants in a blast radius get scorched (`burnt` tint, shed leaves). Wildfire (M16)
  burns grass to stubble.
- **Gameplay is unchanged.** Vegetation never changes sight or collision except where a structure already
  declares it (bush and hedge footprints, the new hedgerow bank). Grass and reeds are visual only. Tall reeds and
  crops may hide prone units *visually*. AI sight stays grid-based and the clip and alignment tests stay green.
- **Clearances.** Nothing spawns on roads or pavement (`exclude`), inside building footprints, on walls or within
  0.6 m of interactable doors. Placement pruning (`pruneTree`) applies to new hero plants.
- **Snow.** Plants in the snow theatre carry snow caps on their upward faces (`snowCoverage`). Winter temperate
  missions get rime frost (a light blue-white tint on upward faces), not full snow, unless the lighting sets
  `snow`.
- **Water.** Reeds and shore plants appear in water reflections. Wading in a reed bed parts the stems.

---

## 5. LOD, impostors and budgets

Frame budget for all vegetation at **high, 1280×720, medium hardware**: **≤ 4.0 ms** (today about 2.6 ms for a
1,600-tree forest plus about 3 ms of grass on a meadow).

| type | count (typical map) | triangles at high | LOD steps |
|---|---|---|---|
| grass and dune tufts | 30–50k | ≤ 4.5 M (today 4.3 M) | density prefix, blade widening (exists) |
| reeds | 2–15k stems | ≤ 0.6 M | density prefix; plume cards dropped past 0.85 of the view |
| desert shrubs | ≤ 2k | ≤ 1.5 M | twig cards dropped at low; impostor cards beyond the view half-width |
| shrubs and hedgerows | ≤ 400 crowns | ≤ 1.2 M | card count × preset (exists) |
| deciduous hero trees | ≤ `MAX_UNIQUE` | ≤ 3 M | chunk merge (exists); bare trees use twig cards, not tubes, beyond level 2 |
| forest interiors | any | 2 tris each | impostors (exists); add **close-zoom swap-back** within 20 m of the view centre at zoom ≥ 2.5 |
| palms | ≤ 30 hero | ≤ 0.3 M | impostors in oasis groves |

- **Memory.** New atlases total 48 MB or less at high: foliage rebake 2k × layers, twig and thorn 1k, reed and
  marram 1k, palm leaflet 1k. Each has a 512 variant for low, following the `TEX_512_PRESETS` pattern of the
  terrain layers.
- **Build time.** Generation stays on the workers. A mission must reach `ready` in ≤ 1.5 s more than today at
  high (measured by `tools/perf/measure-load.mjs`).
- **Draw calls.** At most 12 extra (one per new archetype group per material).

---

## 6. Plan of work (branch `feat/vegetation`)

1. **Desert first** (the worst visual bug):
   - `shrubgen` archetypes;
   - nebkha stamping;
   - replace the flat `weedGeo` stars;
   - desert placement.

   Unit test: no desert clutter mesh has a bounding-box height below 0.2 × its width.
2. **Seasons and forest areas.**
   - `season` from the mission date; winter missions bare;
   - forest polygons filled;
   - variant hints in `treePlacement`.
3. **Grass variety:** tuft archetypes, clumped blue-noise placement, tip colour fix, winter-brown and dune
   archetypes.
4. **Reeds and marram** (M14, M16, M18 reed neck, M13).
5. **Bocage hedgerows** (`hedgerow` structure; M14 inland, M13 outskirts, and field edges in M15) and species shrubs.
6. **Palms** (leaflets, skirt, suckers; Canary palm for M12).
7. **Leaf atlas rebake** (pines-style sprays plus thickness), twig cards for bare crowns, new species (willow,
   ash, alder, apple), ivy.
8. **Crops, vineyards and orchards** where missions ask for them.

For every step:
- before/after shots at zoom 1 and 2 on M1, M6, M8, M11, M14, M16 and M20;
- `node tests/unit/run.mjs` and `node tests/run.mjs` green;
- a perf delta against §5.

---

## 7. Pass 1: ground cover (implemented)

Branch `feat/vegetation`. Covers §3.1 (grass), §3.2 (desert ground plants), §3.7 (reeds, marram) and the flower and
weed parts of §3.9. Trees, palms, hedgerows and forests are later passes.

| piece | file | what it does |
|---|---|---|
| Profile | `art/terrain/veg-profile.js` | `vegetationProfile(mission, theater)` turns the mission date and place into a season (`spring`, `summer`, `late`, `autumn`, `winter`, `thaw` for M06) with dryness, flowers, seed heads, frost and height, plus the archetype mix per theatre and season. `mission.vegetation` overrides any key. `groundTint` browns the meadow ground layers with the season. |
| Archetypes | `art/terrain/grass-arch.js` | 10 seeded tuft meshes on one vertex layout: meadow, straw, forb (cupped 3D rosette), snow-poke, seed-head grass (stems with nodding panicles), tussock, flopped winter grass, marram, reed (2–2.7 m stems, leaf ribbons, plume), drinn (straw fountain with awns). |
| Placement | `art/terrain/grass-place.js` | Neyman–Scott clumps (2–6 tufts round a centre, one species per clump, bare gaps between). Species drift with low-frequency noise, so no grid repeat. Dryness per tuft comes from season, dry splat, field patches, verge and wetness. Reeds grow in sharp-edged stands on fresh water: the water band (land 0–2.4 m from the shore plus the shallows), never in deep water, decks or structures. They are off by default in the `coast` theatre (the Channel is salt) and never grow within 3 m of beach sand. Marram grows in clumps on coast sand above the strand. Drinn grows sparsely on desert sand. |
| Grass shader | `grass-glsl.js` | Colour per archetype from root to tip, lush to dry, with dead tips in late summer. The white tip bleach is gone. There is per-blade hue jitter and rime frost in winter, and the specular is tinted by the blade colour. Wind amplitude follows the stiffness class (reed 0.75 m, marram 0.42, grass 0.28, forb 0.05). Seed heads and plumes flutter. Density LOD fades each instance by its shuffled rank, so nothing pops on zoom. |
| Desert scrub | `art/terrain/scrub-geo.js`, `scrub.js` | Camel-thorn (a spiny dome of twigs and thorn leaves), saltbush (a grey-green leaf-shell ball), retama (arching rods) and dead twig skeletons. Each is 400–1,800 triangles, instanced (≤ 8 draws), with wind bend and shadows. They are placed sparsely, denser on run-off ground and road verges. Each plant gets a **nebkha**: a sand mound plus a downwind tail stamped into the heightfield before the terrain mesh is built. The mound fades to zero on flattened pads, so footprints stay level. Plants stay 1.6 m clear of mission spawns and patrol waypoints (`spawnClearance`). |
| Clutter | `clutter.js` | The flat star weed (`weedGeo`) is retired. Temperate weeds are now 3D dock and plantain rosettes (cupped leaves rising 35–60°, some with a seed spike). Flowers have cupped heads and stem leaves, with a mix per season. There are no flowers in winter or the thaw. The desert gets no clutter weeds; its plants are the scrub archetypes. |

Seasons by mission:
- M13, M14: spring.
- M15: summer.
- M16: late summer.
- M17: autumn.
- M18–M20: winter.
- M06: thaw.
- Desert: dry.
- Snow theatre: snow-poke tufts with rime.

Trampling still uses the trail flatten RT, which springs back over `flatTau` (420 s). Reeds and marram flatten the
same way.

Budget (high preset):
- Meadow: about 8.5 tufts/m² where the splat is full grass, against about 8 before.
- Chunks are now 16 m, with one draw per archetype present: about the same draw count as 8 m × 2 meshes.
- Desert: 80–260 scrub plants per map (`placeScrub`, cap 2,000), 0.1–0.3 M triangles.
- Grass placement costs about 0.2–0.4 s more per meadow map at load. It still runs on the main thread, before
  `ready`.
- Tests: `tests/unit/vegetation-ground.test.mjs`.
- After shots use the same framings as the §1.4 before shots (the session scratchpad `veg/after/pair-*.jpg`).
- What reads differently now:
  - M16 meadow: clumps of mixed species with seed heads, plus a reed bed on the Maas.
  - M06: straw thaw grass.
  - M20: frost-browned February sward.
  - M08 and M11: 3D camel-thorn and drinn instead of flat stars.
  - M14 beach: clear of reeds, with marram on the dunes.

---

## 8. Pass 2: trees, shrubs, hedges and palms (implemented)

Branch `feat/vegetation`. Covers §3.3 (palms), §3.4 (shrubs), §3.5 (hedges; bocage as a data hook), §3.6
(deciduous trees), the seasons and forest areas of §3.10 and the interaction rules of §4. Pines, spruces and firs are
untouched (branch `feat/pine-needles`); this pass keeps its API: `generateTree(species, seed, q, bark, leaves, at)`,
`SPECIES`, `LEAF_LAYERS` (new names appended), the `aInfo`/`aRoot` layout, and the same `aExt` (crown AO, snow catch)
attribute and `GeoAcc.vert(…, ext)` signature as that branch, written identically so the two merge cleanly.

| piece | file | what it does |
|---|---|---|
| Leaf atlas | `tools/render/build_leaves.py` → `assets/terrain/foliage.webp` (512 px tiles, grid of 8), `foliage_n.webp` (256 px: rg normal, b coverage), `foliage.json` | Procedural leaf sprays, two per species, rasterised at 4× as two-half blades (midrib fold, curl, serration, lobes, pale undersides, a few yellowing leaves): oak, beech, birch, poplar, plane, olive, hawthorn / blackthorn (`hedge`), desert scrub, willow, ash (pinnate), apple (with fruit), hazel, acacia (bipinnate + white thorns), marcescent oak / beech (`brown`), bare twig sprays (`twig`: purple-brown birch-like and grey oak-like), ivy, gorse (yellow flowers) and palm leaflets (`palmleaf`, green and dead). Albedo opaque and bled (gaps hold a darker bleed: the crown interior), so mips never darken. The conifer and palm-frond tiles of the old atlas are carried over unchanged. |
| Leaf material | `vegetation.js` | Coverage-preserving alpha test (`leafAlpha`, the pines branch's approach; no MSAA in the pipeline), per-leaf normal map on top of the bent crown normal, translucency through thin blades (`1 − mass` from a coverage mip) with a forward-scatter lobe, crown AO from `aExt.x`, and seasons (`uSeason`): late-summer fading and per-leaf autumn turning. Shadow depth and GTAO-normal programs use the same alpha. |
| Broadleaves | `broadleaf.js` | A seeded crown **envelope** per tree (profile `dome`, `ovoid`, `oval`, `column`, `cone`, `umbrella`, `round` × three azimuthal lobes × an offset), clear bole below the crown base, limbs aimed at the envelope and stopped by it. Sprays only at the twig tips, facing the sky (phototropism), weeping where the species weeps, with shade gaps (whole branches dropped) and a shell fill. Crown AO from the depth inside the envelope and the height in the crown. Bare crowns: twig sprays, marcescent brown leaves on 60 % of oaks and beeches. Ivy spiralling up a share of big trunks. Pollarded willows (a knobbly head of straight whips) for half the willows. |
| Species | `treegen.js` | Oak (wide dome, crooked limbs), beech (tall ovoid, layered flat sprays), plane, Lombardy poplar (column), birch (narrow, weeping, white bark), olive, **willow**, **ash** (open crown, pinnate leaves), **alder**, **apple**, **hawthorn** (small tree), **horse chestnut**, **acacia** (flat table) and `acacia_shrub`. |
| Shrubs, hedges | `shrubs.js` | A fountain of stems with side shoots aimed at a seeded envelope: ragged dome (shrub, hazel, gorse), layered field hedge with a ragged top and a thin, stemmy base (`hedge`), clipped box (`box`, superellipsoid) and a wind-sheared wedge for coastal shrubs (`sea_buckthorn`: low on the windward side, streaming downwind in world space). Species sprays at the shoot tips and over the shell; leafless in winter. |
| Palms | `palms.js` | Date palm: tapered trunk with a sawtooth leaf-base ring every ~25 cm and boots under the crown, 24–36 pinnate fronds in phyllotaxis (young upright, old drooping), each a rachis tube with 26–42 pairs of separate leaflet quads in a V section, a dead-frond skirt (unless pruned), suckers at the foot and orange date bunches when ripe (Aug–Dec). `date_palm_town` (pruned) and `canary_palm` (thick trunk, dense round crown of arching fronds). Wind: frond whip (exists) plus leaflet flutter. |
| Seasons | `veg-profile.js` `treeSeason` | From the mission date: spring and summer in leaf; late summer (M15, M16) fading with ~6 % turned leaves and apples; October turning; November–February bare (M17–M20) with marcescent oak and beech and ivy on 25–30 % of big trunks; desert evergreen with dates when ripe; snow theatre bare. `mission.vegetation.trees` overrides. |
| Placement | `art/terrain.js` | `VARIANT_SPECIES`: `broadleaf_normandy` (oak, ash, hawthorn, apple, beech), `broadleaf`, `deciduous_bare`, `plane_tree`, `horse_chestnut`, `cypress`, `box_parterre`, `scrub_desert` / `camel_thorn`, `date_palm`; `pine_frost` (M20) turns 30 % of its pines into beech and oak. Theatre pools for variant-less trees and bushes (coast: sea buckthorn and gorse). Generic broadleaves within ~8 m of water become willow, alder or poplar. |
| Forest areas | `forest-fill.js` `fillForest` | `tree`/`pine` structures with `points` (M04, M20) are filled with a seeded Poisson-disc wood (4.4 m, 3.7 m in the snow), trunks inside the footprint, denser and partly unique at the edge, interior trees impostor candidates. The gameplay footprint is unchanged. M20's strip becomes a mixed spruce / pine / bare beech and oak wood. |
| Hedgerows | `forest-fill.js` `hedgerowPlacements`, `bocage.js` | Bocage along a polyline (`mission.vegetation.hedgerows: [{points, gaps?, h?, standards?, spacing?}]`): overlapping hawthorn / blackthorn, hazel and shrub crowns every ~1.5 m with gate gaps and oak / ash standards every 10–20 m. Visual only. Since critic round 1 the farmland fringe (§9) lays hedges out automatically where they cannot change gameplay. `tools/perf/vegshot.mjs --hedge=1` shows one. |
| Interaction | `art/terrain.js` `brushWorld`, `vegetation.agitate`, `scrub.crush` | Walkers and vehicles moving within reach of a bush, hedge or small tree part its sprays (pushed away from them) and shake them, and the shake dies out about 0.6 s after they pass (8 strongest movers, shader `uAgit`). Moving land vehicles crush the desert scrub under them: the plant is pressed flat, splayed and browned for the rest of the mission. Visual only: cover, sight and collision stay with the structures. |
| Look-dev | `tools/perf/vegshot.mjs` | Sandbox groves (`--grove=theatre:species,…`, `--type`, `--date`, `--hedge`) or a mission framing, zoom 1/2 frames, and `--perf` (tree cost by interleaved frames with the vegetation shown / hidden, GPU timer query when available). |

### 8.1 Pass 2 cost (measured)

`tools/perf/vegshot.mjs --perf=1 --frames=240`, preset high, 1280×720, zoom 1, master `984c277f` (before) against
this branch (after), same framing, two interleaved rounds each, averaged. "Tree GPU" is the GPU timer difference
between frames with the trees shown and hidden (paired frames); "frame GPU" is the whole frame. The GPU was shared with
other jobs, so single numbers move by about ±0.3 ms.

| mission (framing) | trees | tree triangles | draw calls (frame) | tree GPU ms | frame GPU ms |
|---|---|---|---|---|---|
| M06 Norway (123, 14), pines only | 23 → 23 | 49k → 49k | 392 → 404 | 0.53 → 0.43 | 2.35 → 2.67 |
| M14 Normandy (3, 118) | 14 → 14 | 64k → 106k | 370 → 362 | 0.72 → 0.39 | 5.12 → 5.22 |
| M16 Liège (190.8, 3) | 16 → 16 | 68k → 88k | 403 → 409 | 0.18 → 0.40 | 6.17 → 6.39 |
| M20 forest edge (141.6, 10.5) | 9 → 86 | 20k → 324k | 494 → 515 | 0.11 → 1.08 | 5.99 → 7.00 |

- All four stay inside the §5 vegetation budget (≤ 4.0 ms). The largest rise is M20: its forest polygon used to be
  drawn as 9 loose pines and is now a filled wood of 86 trees (77 more), all unique at this size. Bigger woods fall
  back to baked impostors past the preset's `MAX_UNIQUE`. The impostors are baked at load from the new geometry, so
  nothing needs rebaking offline.
- The frame triangle totals also include the pass 1 ground cover (grass, scrub mounds): M16 4.5 M → 6.2 M.
- Atlases: `foliage.webp` 1.78 MB → 0.97 MB, plus the new `foliage_n.webp` at 1.21 MB (net +0.39 MB per mission
  that has trees).
- Tree generation runs on the workers. It took about 0.1 s for M14 and M16 and 0.9 s for M20's wood.
- Tests: `tests/unit/vegetation-trees.test.mjs` (species, seeded uniqueness, seasons, forest fill, hedgerows, brushing
  and crushing). The GPU suites below pass: terrain, clipping, p3-wind, loading, render-frames, vehicles,
  smoke-missions, webbuild and p3-pavement.
- Before / after sheet: `docs/screenshots/vegetation-before-after.jpg` (regenerated in §9).

## 9. Critic round 1 fixes

- **Bare winter crowns** (`broadleaf.js`): a leafless tree grows one more order of real, tapered twig tubes
  (`bareLevels`: the summer tip level forks into 4th / 5th order twigs, never thinner than 11 mm so they do not
  shimmer), so the limb structure reads at zoom 0.5 and 1. Twig spray cards are smaller (0.7×) and sit only on about
  half the outermost twig tips; their card area is under 35 % of the summer crown's (unit test), so the crown stays
  mostly see-through. Snow lies on the upper faces of the limbs only: the twig sprays hold almost none
  (`vegetation.js TWIG_LAYER`). Marcescence: `marcTrees` (30 %, 12 % in the snow theatre) of oaks and beeches keep
  brown leaves at `marc` × a summer crown's density (8–30 %, unit test), on the lower and inner branches. Norway
  (`snow` theatre) picks birch for 3 in 4 variant-less trees and 4 in 5 `bare_winter` trees.
- **Root flare**: the straight stick roots are gone. Big trees get 4–6 short buttresses that swell out of the trunk
  foot and arch down into the soil within about a metre (six curved segments, partly buried), and bark within 0.45 m
  of the ground takes on a soil tone (`soilGrade`).
- **Winter and thaw sward** (`terrain-glsl.js uSward`, `veg-profile.js swardOf`): the grass terrain layers
  desaturate and brown toward the tufts' olive and straw (winter 0.82, thaw 0.78, November 0.7, autumn 0.45, late
  summer 0.18), with flattened dead mats in 3–10 m clumps. Placement (`grass-place.js`): in winter the dead sward
  gathers in matted, flopped clumps (more tufts, mostly `flopped`) with thinner ground between.
- **Forest floor** (`forest-fill.js forestFloorPainter`, chained before the road painter in `buildSplat`): under the
  forest areas plus a 3.5 m crown-overhang margin the meadow gives way to brown leaf litter (broadleaf woods) or
  needle duff with litter patches (spruce / pine), ragged at the edge; grass weight drops, so no tufts grow there.
  `forestUnderstorey` adds brambles (new `bramble`), hazel, the odd shrub and fallen boughs (new `fallen`: a bent,
  half-sunk bough with arched side limbs) at about one per 70 m², visual only.
- **Marram** (`grass-arch.js`, `grass-place.js`, `grass.js`): a tussock is now 50–60 rolled, arching blades from a
  0.5 m base, 0.5–1.1 m tall, glaucous blue-green with straw. Tussocks grow in colonies of 3–14 on the dune crests
  (height above the 3 m neighbourhood) and along wind-aligned streaks, with bare sand in the swales; size follows the
  crest.
- **Meadow macro variation** (`grass-place.js meadowMacro`, terrain shader `uMeadowMacro`): 30 m mown / unmown swathes
  drive tuft height (0.42–1.42×) and the ground colour (lighter yellow-green against darker deep green), 17 m dry
  patches, 13 m thin / dense ground, trodden bare patches, taller forb and seed-head strips on the verges and along
  walls and fences, and species drifts over 11–27 m with sharper contrast, all visible from zoom 0.5.
- **Farmland fringe** (superseded in §10: the field hedges, standards and orchards moved past the map edge) (`bocage.js`, plan step 8, `mission.vegetation.farmland` on M13–M16 and M20): fields are packed
  into the open grass that no gameplay point or route comes near. `gameplayGeometry` collects every enemy, patrol
  route, commando, item, objective, zone, trigger, vehicle and the extraction; a field (12–40 m, rotated) must keep
  9 m from all of them over its whole area and hedge line, a lone field-edge hedge 8 m, a hedge backing a wall 6 m.
  Each field has a hedgerow with a gate gap (and gaps where it would meet a structure or a road) and holds wheat in
  drill rows (new `wheat`: stalks with nodding ears), stubble (new `stubble`), an orchard of apple trees, or pasture.
  Walls and fences get a trimmed hedge on their grass side no taller than the wall + 0.2 m, so the cover is unchanged.
  All of it is `visual`: no footprint, and `stampTreeBranches` leaves its branches out of the gun-arc cells. The M13
  port has no open grass, so it gets none; M14 gets a few lines inland. Unit test: every hedge plant, field corner
  and orchard tree is clear of gameplay, deterministic.
- Master merged (Atlantic Wall kit, pine needles); `art-m14` and the vegetation unit tests pass on the merge.
- Evidence: `docs/screenshots/vegetation-before-after.jpg`, master (left) against this branch (right) at zoom 0.5, 1 and
  2 for M01 (Norway, snow), M06 (Norway thaw), M08 (oasis), M11 (desert camp), M14 beach (marram) and inland
  (house_t), M16 (bocage, meadow), M17 (November) and M20 (Black Forest edge). Frames by `tools/perf/vegshot.mjs
  --mission=<id> --at=<x:z> --zooms=0.5,1,2` in both trees.
- Cost after the round (`vegshot --perf=1 --frames=160`, same framing, shared GPU, ±0.5 ms): M20 forest edge
  (141.6, 10.5) tree triangles 37k → 962k (wood, understorey, orchard, hedges; 323 trees, all unique under the high
  preset's 400), tree GPU about 0.1–0.8 ms; M16 (165, 30) 68k → 341k with the bocage fields, tree GPU about 1.2 ms. Both
  inside the §5 budget (≤ 4 ms).
- Tests after the round: unit 1195 passed, 0 failed. Full GPU suite (load average 31–40 on the shared machine): 71
  passed, 8 failed, all on timing or the 90 s per-test timeout (smoke-missions, gate-smash, bodies-blood-surfaces,
  bodies-physics-perf, characters-perf, portraits-pain, portraits-talk, touch-pixel7). touch-pixel7 passed on rerun.
  An interleaved A/B against a master snapshot under the same load fails the same way on master (gate-smash,
  bodies-physics-perf, smoke-missions and bodies-blood-surfaces all time out at 90 s on both; characters-perf and
  portraits-pain fail on master too), and mission load times match master (M01–M03, M16 within noise). These still
  need one green run on a quieter machine before the merge.

## 10. Critic round 2 fixes

- **Autumn leaves turn leaf by leaf** (`build_leaves.py`, `vegetation.js LEAF_MAP_FRAG`): the atlas bakes a per-leaf
  id into the alpha of `foliage_n.webp` (160–249 → 0..1, one id per blade, per palmate leaf and per compound ash leaf;
  255 = twig, fruit, blossom; ids bled 4 texels over the gaps so a bilinear tap at a leaf rim keeps its leaf). A leaf
  turns once the season passes its id, the ones at the front half-turned (yellow-green). The colour is a YIQ hue shift
  of the leaf's own albedo toward the species' autumn hue (`AUTUMN`: birch / poplar / hazel clear yellow, beech copper,
  oak russet, hawthorn red-orange, ash pale yellow; olive, ivy, gorse, conifers and palms never turn), so veins, the
  midrib fold and the shading stay. The old `floor(vVUv * 7)` cells (flat tan squares) are gone; the GPU test checks
  that turned / green boundaries on a screen-aligned spray card do not follow a 7 × 7 grid (8 % on it, uniform ≈ 7 %).
- **Bocage past the map edges, none in the map** (`bocage.js apronBocage / bankField`, `art/apron.js`): a visual-only
  2.6 m hedge or standard tree on walkable grass read as cover it does not give, so the in-map farmland keeps only its
  crop / pasture fields and the wall-backing hedges (≤ wall + 0.2 m, unit test: no standards, no orchard trees). The
  bocage lives on the never-walkable apron: a hedge framing each map margin 6–10 m out and a jittered, meandering field
  lattice (~56 m, 16 % of edges dropped for bigger fields), only on apron grass / bare ground ≥ 2.5 m off roads and
  water, with a gate gap per run. Every hedge stands on its earth bank: a flat-topped talus 1–1.5 m high, ~3.4 m at the
  foot, cut by the gates, added to the apron heightfield, its flanks painted bare soil with litter on top. The apron
  vegetation now follows the mission season (bare hedges in December). M16 gets 47 hedges (1167 plants), M20 54
  (1363); M13 is ringed by water and M15's apron continues the town paving, so they have no land for it.
- **Desert bushes are 3D scrub** (`art/terrain.js scrubHero`, `terrain/terrain.js`): every mission desert bush
  (`scrub_desert`, `camel_thorn`, a variant-less bush in the desert) becomes a hero instance of the scrub.js
  archetypes (saltbush / retama mostly, camel thorn for `camel_thorn`) scaled to its structure's radius and height, on
  its own nebkha mound; ambient scrub gives way around it and vehicles never crush it. No desert card shrub remains
  (GPU test).
- **Desert scatter shimmer** (`scrub-geo.js aWid`, `scrub.js SCRUB_PROJECT`): every scrub vertex carries its offset
  from the twig / leaf centre line and the local half-width; the vertex shader widens anything thinner than ~1.6 px at
  the current zoom along its own cross-section. Measured with the pure translation removed (phase correlation +
  Fourier shift of a 3 cm pan, `px > 48` residual): M09 zoom 0.5 0.15 % (master 0.20 %, round 1 0.29 %), zoom 1
  0.10 % (master 0.044 %, round 1 0.113 %): the remaining crawl at zoom 1 is the small saltbush leaves; M16 is under
  master at both zooms.
- **Date palms** (`palms.js`): fronds leave the crown 20–45° above horizontal (youngest steeper, oldest flat) with a
  gentle arch (25–40° of bend), glaucous lighter leaflets with little crown darkening; 70 leaf-base boots over the
  upper 60 % of the trunk (pale fresh cuts, dark weathered ones) and deeper leaf-base rings; the date stalks arch 1.1–
  1.6 m out between the fronds and hang fat orange bunches clear of the trunk. The rolls for the bunches are drawn
  whether or not the dates are ripe, so the season never reshapes the palm.
- **Forest fill seeds** (`forest-fill.js fillForest occupied`): the mission's own trees are occupied seeds of the
  Poisson grid. M04: 95 → 33 fill trees, none within 2 m of a mission trunk (was 16 within 1 m, 40 within 2 m).
- **Sward** (`terrain-glsl.js turfBlade`, `grass-place.js`): under and between the tufts the grass layers become a
  continuous turf in the tufts' own season colours (`turfUniforms` from `grassPalette`): blade bundles in 6 and 11 cm
  cells lying in swathes, shadowed gaps, 5–40 cm tussock / matted patches from mip-filtered noise; band-limited (a
  bundle under ~1.5 px fades to its mean). Tuft placement is Poisson-in-patches: 2–6 m dense patches with bigger
  clumps, thin ground between (M16 6.0 → 6.4 tufts / m², clumped).
- **Flowers and rosettes in the wind** (`clutter.js CLUTTER_PROJECT`): the shared wind bends them from the base
  (∝ height², stem stiffness 0.16 m flowers / 0.05 m rosettes), and walkers brushing through press them over (the
  grass trail / flatten RT). The rosettes' shadow pass bends with them.
- **Birch in February**: no twig-spray cards on birch (`twigSpray: 0`): they read as black dead-leaf balls; its fine
  pendulous twigs are the tubes. Marcescence stays on oak and beech only.
- **Load** (`vegetation.js maxVisualUnique`): visual-only plants (forest-fill interiors, understorey brambles / hazel,
  hedges) have their own unique budget (30 % of `MAX_UNIQUE`); past it the densest become impostors.
- **Tests**: `tests/vegetation.test.mjs` (GPU): desert scrub height / width 0.5–0.75 (flat stars ≈ 0.05), no card
  shrub, the wind moves the shrubs, the date palms and the flowers (two sim times, same view, layer-isolated), autumn
  turning off the UV grid. Unit: bocage (apron, banks, gates, determinism), in-map farmland (no standards / orchards),
  birch sprays, palm dates.
- **Load and tests after the round** (shared machine, load average 16–50 from other agents' Chromium; it never went
  idle): terrain `readyMs` M20 3.7 / 3.6 s against master 3.0 / 2.9 s (+0.7 s, was +4–5 s; in-map hedges and orchards
  gone, visual budget), M16 +0.5 s, M04 equal. `assets/load-budget.json` regenerated (`measure-load.mjs --budget`, M01
  high 80.3 MB). Unit 1283 passed, 0 failed. Full GPU suite: 113 passed, 7 failed; `characters-perf` passed on rerun;
  `view` (yaw-0 overshoot 2.742, a camera / apron clamp matter), `portraits-pain`, `portraits-talk`,
  `bodies-dragcarry-perf`, `bodies-physics-perf` and `gate-smash` failed 3 of 3 reruns and fail the same way on a
  clean master export under the same load. `vegetation`, `loading` (M01 within the new budget), `clipping`,
  `terrain`, `p3-wind`, `pines`, `render-frames` and every `edges-void-*` pass. A green run on an idle machine is
  still needed before the merge.
