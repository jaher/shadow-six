# Clipping / interpenetration audit

User report: *"Be careful with objects crossing other objects, for example turrets crossing a fence."*
This page describes the audit tool built for it, what it found on M1, M2, M3, the m00 sandbox and the b00 BCD sandbox
(e8eea3f, "before"), and the generic placement / clearance rules that fix it ("after"): **zero unintended static or turret
overlaps on all five maps** (31 before) and 175 → 69 → **26** moving penetrations deeper than 5 cm (first fix, then the
second pass on the verifier's findings: see "Second pass"). Tanks and armoured cars parked beside every wall, fence and
building side of the five maps (the turret probe, 349 parked guns) never swing a barrel or turret through them, and no
prop floats over a slope.

## Tool

| piece | what |
|---|---|
| `src/debug/clip-rules.js` | Pure rules, unit-tested in `tests/unit/clip-rules.test.mjs`: category per structure type (regex table, size fallback), intended contacts, joints, baseline keys and diff |
| `src/debug/clip-geom.js` | Triangle-exact measurement with three-mesh-bvh 0.9.15 (MIT, vendored in `vendor/three-mesh-bvh/`). BVHs are built over Float32 copies of the positions, so game geometry is never touched |
| `src/debug/clip-audit.js` | Collects the scene items and runs the static audit, the turret sweep and the dynamic audit. Test mode: `await __game.clipAudit()` loads it lazily and exposes it as `__game.clip` |
| `tools/audit/clipping.mjs` | CLI (GPU headless via the test harness). Writes `docs/clipping/<mission>.json` and 2×-zoom crops `docs/screenshots/clip-<mission>-{s,t,d}<n>.jpg` (640×400, about 30–50 KB) |
| `tests/clipping.test.mjs` | GPU test, about 21 s. For all five maps, fails on any unintended static or turret overlap that is not in `tests/clip-baseline.json`. It also checks the detector itself: an MG nest parked 0.7 m from barracks `barr_2` must be caught when its barrel sweeps through the wall (`turrets({raw: true})`), and that rule (d) keeps the same gun's barrel out of the wall in play. Every map must have visual nav blocks stamped, no floating / buried prop, a clean turret probe (≤ 8 cm), and on M2 the wall-walk sentry `e5` shot beside the palisade must lie clear of it |
| `__game.clip.turretProbe()` | Guns the maps don't have yet: a `panzer2` and an `sdkfz` are parked where they could really drive (every hull point passable at ≤ 0.4 m spacing: blocks, visual nav blocks, eaves) as close as possible beside every wall, fence, gate, building, tower, tent and pole side, and their guns swept over their open arcs. The GPU test requires no overlap deeper than 8 cm |
| `__game.clip.floating()` | Rule (b) seating: each prop's flat bottom (vertices within 4 cm of its lowest) against the terrain right under it: a corner more than 5 cm above the ground (hanging over a slope or a dip) or a base buried deeper than 0.5 m. Over water / carved banks is skipped |
| `__game.clip.entity(tag)` | One unit or vehicle, posed now, against the statics (probes and tests: a body after its death clip) |
| `__game.clip.fit()` | Rule (c) report: per structure, how far its visual reaches beyond its `w × d` footprint, at the base (< 1 m) and in full (eaves, flags) |
| `tools/audit/clip-shots.mjs` | Before / after crops for this page from `docs/clipping/shots.json` (same framing as the audit's crops, box outlined in green) |

```
node tools/audit/clipping.mjs --mission m01            # static + turrets + 180 s dynamic, 6 crops
node tools/audit/clipping.mjs --dynamic 0              # all 5 maps, static + turrets only (~40 s)
node tools/audit/clipping.mjs --dynamic 0 --write-baseline   # accept the current overlaps
node tests/run.mjs clipping                            # the guard test
```

### What is audited

- **Static items**:
  - every structure's render tree. Library buildings are audited at LOD0. Instanced repeats are split per instance and matched back to their structure id.
  - dressing: walls, rocks, cliffs, tents, sandbags, crates, poles.
  - flags, which are audited as part of their building.
  - vegetation chunks, split into `trunk` and `foliage`. Each is reported under the nearest tree id, e.g. `pine#19~trunk`.
  - interactable props (drums, mines, pickups).
  - parked vehicles, and characters in their spawn pose. Characters are skinned meshes, posed with `getVertexPosition`.
  - optional: clutter stones (`--clutter`).
- **Broad phase**: an 8 m XZ spatial hash over the world boxes of the items. **Narrow phase**: `bvhcast` plus exact triangle/triangle intersection segments. For each pair that touches, the tool reports:
  - **contact**: summed length of the intersection lines, in metres
  - **depth**: the deepest vertex of one item inside the other's solid, capped at 1.5 m. A vertex counts as inside when it is behind the nearest face (triangle winding) *and* behind the first face hit along at least 2 of 3 probe rays. This keeps open shells and slabs from swallowing points
  - **volume**: a Monte Carlo estimate
  - the world point and box
- **Turret probe** (`turretProbe`) and **floating props** (`floating`), see the table above; both run in the CLI and the GPU test.
- **Turret sweep**: every vehicle or emplacement with a `turret` node traverses its arc in 10° steps. The arc is `giro` around the post heading, or 360° when no `giro` is set. Each step is tested against the static items. Since rule (d) the sweep follows the gun's own open arc with the barrel lifted as in play; `raw: true` sweeps everything.
- **Dynamic audit**: 180 s of sim per map, sampled every 0.5 s. It includes:
  - patrols and vehicle routes running on their own.
  - commandos ordered every 12 s to random points 35 cm outside the boxes of buildings, walls, fences, towers and props. The commandos are made invulnerable for the audit only.
  - at 60 s and 120 s, the two enemies closest to a wall or building are killed so their bodies get sampled.
  - characters sampled at LOD0 with no off-screen throttling, plus vehicles and guns.
  - only penetrations deeper than 5 cm are kept, as the worst per pair with first time, count, unit state and a crop.

### Intended contacts (allow-list) and how to extend it

Categories come from `CATEGORY_RULES` (for example `watchtower→tower`, `fence`, `wall`, `bridge`, `pier`, `rocks`,
`ground`, …). Unknown types fall back to `building` or `prop` by footprint size, so new content from missions 4–20 and
phase 3 street furniture is covered automatically.

- **Never audited**:
  - `ground`-layer types: roads, rivers, rails, trenches, craters, pavement, kerbs and decals
  - terrain, water, snow (shader-based), impostors, shadow/proxy/decal/selection meshes
  - intra-item contacts
- **Natural pairs**: rocks/cliff/ruins among themselves, foliage/foliage, bridge↔rocks/cliff/pier (abutments), sandbags↔emplacement, prop↔prop (stacks), character/vehicle↔foliage.
- **Joints**: a wall or fence run touching a gate, tower, pole, building or wall within 1.25 m of one of the run's *ends*, with a contact box no longer than 3 m. A run that passes through something is still reported.
- **Crew**: a character crewing a vehicle or gun (`gunner`, `emplacement`, crew refs, occupants) against it.
- **Resting contact**: depth ≤ 2 cm and contact ≤ 0.5 m.
- **Resting on a surface**: depth ≤ 3 cm and a flat contact (≤ 12 cm tall): feet on a deck, a drum on a slab.
- **Data hooks**, for new content without code changes:
  - structure `clipAllow: [id | type | category]` declares an explicit join, e.g. a fence run attached to a gate post.
  - structure `clipCategory: '…'` overrides the category.
  - structure `clip: false` excludes a structure.
  - any `Object3D` can set `userData.clip = false` to be skipped, or `userData.clipCategory`.
- **Baseline**: `tests/clip-baseline.json` holds the accepted keys, `mission:idA|idB`. The test fails on new keys. The CLI lists fixed keys to prune. **It is empty since the fix**: every overlap is new and fails the test.

## Fixes: generic placement and clearance rules

All rules are data-driven, so missions 4–20 (`feat/missions`) and the phase 3 street furniture (`feat/phase3`) get them after
merge without code changes. They are unit-tested in `tests/unit/placement.test.mjs` (one test per rule).

| module | what |
|---|---|
| `src/world/placement.js` | Pure rules (node-testable): categories, shapes, clearances, run cutting / chaining, tower attach, point relocation, crown pruning, spawns, footprint conflicts (schema), turret arcs, body settling |
| `src/world/placement-geom.js` | 2D plan geometry: rect / circle polygons, segment clipping, polygon inflate / hull / distance |
| `src/world/placement-visual.js` | Browser side: what the visuals really occupy — rasterized render triangles in a height band (`planCells`, interiors filled), plan hulls, measured deck / floor surfaces (`deckField`, `measureTop`), low walkable surfaces (`lowSurfaces`), overhangs (`overheadCells`: eaves, porch roofs, boughs) and parts standing on any walking surface (`standingCells`) |
| `src/world/map-builder.js` | Two-pass build: every structure is built, the rules run on the visual shapes (`placeStructures`), changed structures are rebuilt; then nav-only blocks (`stampVisualNav`), levelled prop bases (`stampFlatBase`), overhangs (`stampOverhead`, `stampTreeBranches`), standing visuals (`stampStanding`), measured decks and feet surfaces |
| `src/world/grid.js` | Layers the rules write: `navBlock` (walking only), `overLo/overHi` and `softLo/softHi` (overhangs, boughs), `blockTop` (measured top of footprint cells), `solid` (standing visuals at quarter-cell resolution), `flatExtra` (terrain levelled) |

Hooks for mission data: `fixed: true` (never moved), `onLine: 'gap' | 'attach'` (towers), `clipAllow: [id | type | category]`
(an explicit join: never cut or moved against that item), `clip: false` (ignored), `crownBase` / `crownR` (tree pruning,
normally set by the rules).

### (a) Linear runs: walls, fences, palisades, wire, sandbag lines

- The **visual** run is cut where it meets a solid (building, tower, gate, bunker, bridge / dam, tent, big prop, gate-like
  interactables such as pen gates) or a higher-ranked run (wall > sandbags > fence > wire). Each cut end stops 6 cm short
  of the solid's real visual outline; the fence builder puts its end posts there. The **nav footprint keeps the authored
  line**, so no gap ever opens under a cut.
- Runs of one kind (type, variant, width, height) that share an end are chained into one run: proper corners instead of
  two walls overlapping for 17.5 m (M0 `wall#2` / `wall#3`).
- A **watchtower standing on a run** moves to the run's inner side (towards the enclosure) with its splayed legs 8 cm off
  the fence face; it slides along the run when the inner spot is taken. Units posted on it (`tower: id`) follow.
  `onLine: 'gap'` keeps it and cuts the run instead. **This is the user's example**: M2 `t1` / `t2` stood astride the palisade.
- Wall walks (`walkways`): a plank deck on posts is now drawn (units used to stand in the air), the palisade stakes step
  0.2 m off the walk and the deck starts at their rails, so a sentry on the walk never stands inside the stakes. The deck
  is cut at solids like the run.
- Gate leaves without a heading line up with the run they sit in (b00 pen gate stood across its fence).

### (b) Point props: trees, bushes, rocks, crates, drums, poles, dressing, pickups

- Exclusion zones by category pair (`CLEARANCE`): e.g. drum vs building 0.1 m, pole vs building 0.3 m + eaves, tree trunk
  vs road 0.6 m, anything vs a vehicle route corridor (half-width by vehicle type). Obstacles are the real visual outline
  at body height (snow skirts, steps, woodpiles, porches and the barn ramp count; hollow interiors are filled).
- Conflicting props move to the nearest free spot within 4.5 m (seeded ring search: same result every build, never into
  water, never onto another prop); scenery without a spot is dropped, named / gameplay objects are kept with a warning.
  Authored stacks (prop on prop) stay.
- Trees: the trunk keeps the clearances above; the **crown** is pruned for what stands within its reach (0.35 × height):
  lowest branches lifted over walls, rocks and boats (`crownBase`), crown narrowed next to tall buildings (`crownR`).
- Without visual shapes (grid-only node builds) points are checked and logged but not moved.
- **Seating** (`stampFlatBase`): the terrain is levelled under every prop's and building's visual base (below 0.6 m, plus
  one cell around), interactable props included, not only under its gameplay footprint. A well, a crate or a lift on a
  slope no longer hangs over the downhill side (M3 `well` 0.12 m, b00 `lift1` 0.07 m, `knap_drv` 0.06 m).

### (c) Buildings and mission data

- `validateMission` warns when building / tower / tent footprints overlap, stand closer than 1.2 m (two eaves), or sink
  into a bridge / dam deck (`footprintConflicts`). m01–m03 validate with no warnings; new missions get flagged.
- Library buildings: the visual's extra reach beyond the footprint (steps, porches, woodpiles, flagpoles, tower legs) is
  handled by rule (e) nav blocks and by the placement shapes, not by squeezing the asset.
- The dam's snow cover draped over its hidden crags is stripped with them (`stripDrape`): it floated over the gorge.
- The drawbridge placeholder span lay along the canal instead of across it (w / d swapped); fixed.

### (d) Turrets and emplacement guns

- `turretArc`: for every 5° of traverse, the barrel elevation needed to clear the static obstacles within the barrel's
  reach (the structure's height from its def, or its measured visual top in that cell when taller: `blockTop`), or
  *closed* when more than 25° would be needed. The barrel is sampled along its line and 0.2 m either side of it (a
  diagonal wall's cell staircase leaves corner gaps a single line slips through).
- **Overhangs**: eaves, porch and lean-to roofs, balconies (`grid.overLo`, from the visuals above 1.8 m over open cells)
  and tree boughs (`grid.softLo`, from the generated bark) close every angle where they come down to the barrel or the
  turret roof; the turret housing (its box turned to that angle) closes it too. A gun whose housing is already under an
  overhang keeps still (every angle closed) instead of turning through it.
- In play the gun lifts its barrel over low obstacles (fences, sandbags) and skips closed arcs (snaps to the nearest open
  angle); `canTraverse` refuses targets in a closed arc. Both placeholder and catalogue models have a `gunPivot`.
- The audit's turret sweep follows the same arcs (`turrets({raw: true})` sweeps everything, the detector check).

### (e) Characters and vehicles

- **Nav-only blocks** (`grid.navBlock`): every walkable cell under a structure's visual at body height (0.3–1.8 m) becomes
  unwalkable — steps, porches' posts, woodpiles, tower legs, wall end caps, bridge counterweights, a dam's arch off its
  deck. Sight and cover are unchanged. Door approaches and ladder / climb ends keep a 0.9 m free disc. Cleared when the
  structure is destroyed. Idle pushable wagons / tanks stamp their footprint too (they are approached at their edge).
- **Clearance**: A* adds 35 % cost to cells touching a blocked cell, and path smoothing keeps 0.35 m (the body) off
  walls, so arms and rifles stay out of walls where there is room.
- **Measured surfaces**: bridge / dam / pier decks are measured on the visual (the walking level is what connects, in
  small steps, to the deck's median height; railings, parapets, lamp posts and end blocks become nav blocks); watchtower decks and MG posts stand on the measured floor; units' feet stand on the low
  walkable surfaces of the visuals (steps, ramps, porch boards, snow skirts) instead of sinking through them.
- **Bodies**: a dying unit falls backward from a stand or a walk and forward from a run (the death clips). When a wall,
  a building or a deck edge is in the way the corpse turns to the nearest free direction; where none is fully free (a
  narrow wall walk) it takes the line that stays clear longest (walls cost 3× a deck edge, the likely fall side weighs
  more). It then slides up to 1.2 m off walls / buildings (same surface height), and up to 0.6 m off *standing visuals*
  the nav grid does not see (`grid.solid`: what rises 0.15–1.2 m above the local walking surface, e.g. palisade stakes
  beside a wall walk, railings, crates).
- **Spawns** on the ground are pushed out of solids; elevated posts are authored against their deck edges.
- **Vehicles**: nav blocks stop land vehicles too, and the drive probe covers the full hull width (+5 cm) with a sample
  every ≤ 0.4 m across it (a lone post or a trunk used to slip between the three samples). Overhangs lower than the
  vehicle's own height (hull + turret, measured on the model: `hullHeight()`) stop it, so a tank never parks with its
  turret inside a cabin's eaves. Boughs don't (a hull brushes through them).
- **Body clearance** (`VIS_NAV_MARGIN`, 0.2 m): a cell is a visual nav block when a visual comes within 0.2 m of its
  centre (0.1 m beside bridge / pier decks), so a walker on the nearest free cell keeps shoulders and boots off a post,
  a log end or a kerb.
- **Kerbs and plinths**: the feet stand on the highest low surface within 0.18 m of the body's centre, so a boot steps
  up onto a kerb, a bridge abutment or a snow skirt instead of pushing into its side.
- **Devices and movable decks**: small standing devices are solid (a switch post, a floating sea mine: nav block and
  approached at their edge); a lowered drawbridge carries its walkers on its boards (`world.surfaces`, feet at the boards'
  top instead of the carved bank under them) and keeps swimmers 0.35 m off its sides.
- **Turrets** turned the wrong way visually: models applied `turret.rotation.y = local` while the hull uses
  `headingToRotY` (π/2 − h), so every barrel off the hull axis was mirrored (and pointed at things the gun was not aiming
  at). Both model families now apply `−local`.
- BCD placeholder devices stood half underground and rotated 90° (the wagon lay across its rail): they stand on the
  ground, keep their length along the heading; the lift is an open cage (riders stand inside, not inside a block); the
  drawbridge boards are flush with the banks.

### Targeted data fixes (shipped missions)

The rules run on every mission at load. For the five shipped maps their visual-driven moves are also baked into the
mission data, so the node unit tests (grid only, no visuals) and the browser play the same positions, and the rules
find nothing left to do (they stay as the safety net for new content).

| map | change |
|---|---|
| m00 | drum, bush and lamp post moved clear of barracks1's steps, the road and the bridge ramp |
| M1 | `barr_L_b` turned E–W and moved to z 29 (its roof and snow skirt crossed `barr_L_a`'s); `relay_mast` 1.65 m off the hut's eaves; drums `b2`–`b5` clear of the barracks' steps / skirts; `pole_2` 0.15 m off `wall_s` |
| M2 | **`t1` / `t2` inside the palisade, outer legs against it** (e8 / e9 with them); `cab1` and `cabA` clear of the palisades; drums `bar1` / `bar2`, rocks `rocks_n1` / `rocks_n3`, the islet pines clear of the cabin, the palisade and the boat lane; `e3`, `e12` out of `cabB` / `cab1`; `e5` 0.3 m off the palisade line on the new walk deck (≥ 0.32 m breaks the §7.5 step 2 body puzzle, `tests/unit/m02-walkway.test.mjs`) |
| M3 | the east transformer-cage column at x 55 (was 56: clear of `st_barr2`'s steps and `pylon_1`'s legs); `pylon_3`, a pine and the `bombs_shed` pickup (it lay on the barn's ramp) moved; `e24` out of `st_barr1` |
| b00 | none (the pen gate and the drawbridge were fixed in code) |

## Second pass: the verifier's findings

An independent verification of the first fix (its re-run of this audit, a 455-gun turret stress test beside every wall
and fence, a tile-by-tile visual sweep of M1–M3 at 2× zoom) confirmed the static / turret results and found what the
first pass missed. Each item below is now fixed by a generic rule (they apply to missions 4–20 and phase 3 as well) and
guarded by a test; the audit tool gained the checks that would have caught them.

| verifier finding | cause | fix (generic) | now |
|---|---|---|---|
| M2 sentry `e5`'s corpse draped through the top of the palisade (0.159 m) | on the 1.4 m wall walk no fall line is fully free, so `fallHeading` kept the heading (towards the stakes); the stakes stand over walk cells the nav grid calls open | the fall takes the line that stays clear longest, weighted to the side the death clip falls (backward from a stand, forward from a run); a quarter-cell layer of *standing visuals* (`grid.solid`: what rises 0.15–1.2 m above the local ground / deck / walk) and `settleSolid` slide the body up to 0.6 m off them | clear at every one of 24 headings; M2 bodies 1 → 0; GPU test |
| Turret arcs and the drive probe ignored roof eaves (tank beside M2 `cabA` 0.40 m, `cabB` 0.14 m) | both worked from footprint cells, eaves counted as open ground | `grid.overLo/overHi` from the visuals above 1.8 m over open cells: the drive probe refuses overhangs lower than the vehicle (`hullHeight()`), a gun closes every angle where one comes down to its barrel or turret roof (turret housing included); tree boughs (`softLo`) close gun angles too | turret probe on all five maps: 0 overlaps (349 parked guns); unit tests |
| — found by the new turret probe | the drive probe's three nose samples let a lone post / trunk slip between them; a barrel line slipped through a diagonal wall's cell corners; wall / rock heights came from the data `h`, lower than the visual | ≤ 0.4 m nose samples; barrel sampled ±0.2 m across; `grid.blockTop` = measured visual top of footprint cells | as above |
| Moving units still clipped (m00 bridge 0.11–0.17, M2 `cabA` / `cabB` / `cab1` 0.10–0.13, b00 drawbridge 0.12–0.15 and switch 0.15, M3 squads / diver) | walkers passed right beside visuals whose edge fell just short of a cell centre; a single ground height per body let the leading boot into a kerb's side; the drawbridge boards stood 0.15 m above the carved bank the feet followed; devices were not solid | 0.2 m body clearance in the visual nav blocks; feet on the highest low surface within 0.18 m; movable decks carry their walkers (`world.surfaces`); switch posts and sea mines are solid and approached at their edge; the drawbridge keeps swimmers off its sides | m00 9 → 5 (bridge 4 → 0), M2 11 → 0, b00 7 → 0, M3 36 → 17 (squads at cabin corners / a ramp, the dam, a door frame remain: see Results) |
| Floating props on slopes (M3 `well` 0.12, b00 `lift1` 0.07, `knap_drv` 0.06) | the terrain was levelled under footprints only | `stampFlatBase`: the ground is levelled under every prop's visual base (+1 cell), interactables included | `clip.floating()`: 0 on all five maps; GPU test |

| | before (verifier's crop) | after |
|---|---|---|
| M2 `e5` shot on the wall walk | ![](screenshots/clip-before2-m02-e5body.jpg) | ![](screenshots/clip-after2-m02-e5body.jpg) |
| `panzer2` beside M2 `cabA` (before: spawned under the eaves, turret at 60°; after: parked where it can drive, turret asked to 230°, snapped to the nearest open angle) | ![](screenshots/clip-before2-m02-tank-cabA.jpg) | ![](screenshots/clip-after2-m02-tank-cabA.jpg) |
| b00 driver at the drawbridge's east end | ![](screenshots/clip-before2-b00-drawbridge.jpg) | ![](screenshots/clip-after2-b00-drawbridge.jpg) |

## Results: before → after

Same maps, same audit (`node tools/audit/clipping.mjs`: static + turret sweep + 180 s dynamic, seed 7).

Dynamic columns: before → first fix (6d58e47, the verifier's re-run) → second pass.

| map | items | unintended static + turret | turret probe: overlaps / parked guns | floating props | dynamic penetrations > 5 cm | of which bodies | worst dynamic depth |
|---|---|---|---|---|---|---|---|
| m00 | 30 → 29 | 2 → **0** | **0** / 48 | **0** / 12 | 24 → 9 → **5** | 3 → 0 → 0 | 0.25 → 0.17 → 0.075 m |
| M1 | 68 | 6 → **0** | **0** / 94 | **0** / 23 | 15 → 6 → **4** | 0 → 0 → 0 | 0.50 → 0.30 → 0.30 m |
| M2 | 66 | 15 → **0** | **0** / 76 | **0** / 20 | 30 → 11 → **0** | 0 → 1 → **0** | 0.55 → 0.16 → — |
| M3 | 109 | 5 → **0** | **0** / 87 | **0** / 32 (was 1) | 76 → 36 → **17** | 0 → 0 → 0 | 1.50 → 0.31 → 0.30 m |
| b00 | 39 | 3 → **0** | **0** / 44 | **0** / 10 (was 2) | 30 → 7 → **0** | 0 → 0 → 0 | 1.10 → 0.23 → — |
| **total** | | **31 → 0** | **0** / 349 | **3 → 0** | **175 → 69 → 26** | 3 → 1 → **0** | |

`tests/clip-baseline.json` is empty: no overlap is accepted any more, and `tests/clipping.test.mjs` fails on any new one.
m00 lost one item (wall#3 is drawn by wall#2's chained run). The three remaining (allowed) static contacts are all
"resting on a surface", under 1 cm deep: the MG gunners e8 / e9 standing on their measured tower decks, and the snow
skirts of M1's two long barracks meeting on the ground between them.

The dynamic run is not a gate (it is one seeded run, a tool rather than a test). What remains is small and local:

- **M3 dam (9 of 17)**: the arch crest curves while its nav deck is the straight 27 × 4 m rect; walkers crossing near
  both ends brush the curved parapet ends and the abutment blocks (0.2–0.28 m). The deck is measured, the parapets,
  lamp posts and end blocks are nav blocks, the landings follow the abutment tops, and the crossing stays open (the
  mission's only one). Fixing the rest means authoring the dam's walkable deck as a curve.
- Garrison squads leaving a barracks pass its door frame (M3 `camp_barr`, 0.30 m at the first step out): door
  approaches keep a free disc on purpose.
- Striding feet and shins at building corners and ramps: M3 squads at `cabin_1`'s corner (0.18 m) and on `st_shed`'s
  ramp (0.17 m), the diver past a pine's low bough (0.09 m). A walking boot reaches ~0.5 m ahead of the body; the
  0.2 m clearance and the stepped feet do not cover a full stride.
- Sandbag walls brushed by passing walkers (m00, 0.06–0.075 m); the diver's arm at a jetty edge (M1, 0.12 m).
- The GB climbing over M1 `wall_s` (0.3 m at the climb, the plank roof) and past `pole_2` (0.12 m).

### Before / after: static (all 25 cropped findings)

Same framing as the audit's crops; the green box is where the red finding was.

| map | pair | before | after |
|---|---|---|---|
| m00 | `bridge` × `lamp_post#21` | ![](screenshots/clip-before-m00-s1.jpg) | ![](screenshots/clip-after-m00-s1.jpg) |
| m00 | `wall#2` × `wall#3` | ![](screenshots/clip-before-m00-s2.jpg) | ![](screenshots/clip-after-m00-s2.jpg) |
| m01 | `barr_L_a` × `barr_L_b` | ![](screenshots/clip-before-m01-s1.jpg) | ![](screenshots/clip-after-m01-s1.jpg) |
| m01 | `relay_hut` × `relay_mast` | ![](screenshots/clip-before-m01-s2.jpg) | ![](screenshots/clip-after-m01-s2.jpg) |
| m01 | `barr_2` × `b5` | ![](screenshots/clip-before-m01-s3.jpg) | ![](screenshots/clip-after-m01-s3.jpg) |
| m01 | `barr_L_b` × `b1` | ![](screenshots/clip-before-m01-s4.jpg) | ![](screenshots/clip-after-m01-s4.jpg) |
| m01 | `barr_2` × `b4` | ![](screenshots/clip-before-m01-s5.jpg) | ![](screenshots/clip-after-m01-s5.jpg) |
| m02 | `camp_wall` × `cab1` | ![](screenshots/clip-before-m02-s1.jpg) | ![](screenshots/clip-after-m02-s1.jpg) |
| m02 | `sw_wall` × `cabA` | ![](screenshots/clip-before-m02-s2.jpg) | ![](screenshots/clip-after-m02-s2.jpg) |
| m02 | `cab1` × `bar2` | ![](screenshots/clip-before-m02-s3.jpg) | ![](screenshots/clip-after-m02-s3.jpg) |
| m02 | `cab1` × `bar1` | ![](screenshots/clip-before-m02-s4.jpg) | ![](screenshots/clip-after-m02-s4.jpg) |
| m02 | `islet1` × `pine#19~trunk` | ![](screenshots/clip-before-m02-s5.jpg) | ![](screenshots/clip-after-m02-s5.jpg) |
| m02 | `camp_wall` × `t2` | ![](screenshots/clip-before-m02-s6.jpg) | ![](screenshots/clip-after-m02-s6.jpg) |
| m02 | `camp_wall` × `e5` | ![](screenshots/clip-before-m02-s7.jpg) | ![](screenshots/clip-after-m02-s7.jpg) |
| m02 | `camp_wall` × `t1` | ![](screenshots/clip-before-m02-s8.jpg) | ![](screenshots/clip-after-m02-s8.jpg) |
| m02 | `cab1` × `rocks_n1` | ![](screenshots/clip-before-m02-s9.jpg) | ![](screenshots/clip-after-m02-s9.jpg) |
| m02 | `camp_wall` × `gate_se` | ![](screenshots/clip-before-m02-s10.jpg) | ![](screenshots/clip-after-m02-s10.jpg) |
| m03 | `dam` × `dam_bunker` | ![](screenshots/clip-before-m03-s1.jpg) | ![](screenshots/clip-after-m03-s1.jpg) |
| m03 | `st_shed` × `bombs_shed` | ![](screenshots/clip-before-m03-s2.jpg) | ![](screenshots/clip-after-m03-s2.jpg) |
| m03 | `st_fence` × `pine#59~foliage` | ![](screenshots/clip-before-m03-s3.jpg) | ![](screenshots/clip-after-m03-s3.jpg) |
| m03 | `dam` × `st_fence` | ![](screenshots/clip-before-m03-s4.jpg) | ![](screenshots/clip-after-m03-s4.jpg) |
| m03 | `cage_12` × `pylon_1` | ![](screenshots/clip-before-m03-s5.jpg) | ![](screenshots/clip-after-m03-s5.jpg) |
| b00 | `bridge1` × `boat1` | ![](screenshots/clip-before-b00-s1.jpg) | ![](screenshots/clip-after-b00-s1.jpg) |
| b00 | `bridge1` × `mine1` | ![](screenshots/clip-before-b00-s2.jpg) | ![](screenshots/clip-after-b00-s2.jpg) |
| b00 | `fence#2` × `pen_gate` | ![](screenshots/clip-before-b00-s3.jpg) | ![](screenshots/clip-after-b00-s3.jpg) |

The user's example, M2 `t1`: the tower now stands inside the palisade with its outer legs against it, and the wall walk
has a deck (e5 no longer stands in the air or in the stakes):

| map | what | after |
|---|---|---|
| m02 | t1 at its new spot, outer legs against camp_wall | ![](screenshots/clip-after-m02-t1-new.jpg) |
| m02 | walk_sw: plank deck, stakes stepped off it, e5 on the deck | ![](screenshots/clip-after-m02-walk.jpg) |
| b00 | wagon1 along its rail, standing on the ground (nav-blocked at rest) | ![](screenshots/clip-after-b00-wagon.jpg) |

### Before / after: dynamic (worst cases)

| map | pair (before) | before | after (same spot) |
|---|---|---|---|
| m00 | `sentry_bridge` × `wall#3` | ![](screenshots/clip-before-m00-d1.jpg) | ![](screenshots/clip-after-m00-d1.jpg) |
| m00 | `sapper` × `bridge` | ![](screenshots/clip-before-m00-d3.jpg) | ![](screenshots/clip-after-m00-d3.jpg) |
| m01 | `e9` × `house_s` | ![](screenshots/clip-before-m01-d1.jpg) | ![](screenshots/clip-after-m01-d1.jpg) |
| m02 | `pboat` × `pine#19~trunk` | ![](screenshots/clip-before-m02-d1.jpg) | ![](screenshots/clip-after-m02-d1.jpg) |
| m02 | `e1` × `cabB` | ![](screenshots/clip-before-m02-d5.jpg) | ![](screenshots/clip-after-m02-d5.jpg) |
| m03 | `camp_barr#0.0.1` × `dam` | ![](screenshots/clip-before-m03-d1.jpg) | ![](screenshots/clip-after-m03-d1.jpg) |
| m03 | `sapper` × `dam` | ![](screenshots/clip-before-m03-d2.jpg) | ![](screenshots/clip-after-m03-d2.jpg) |
| b00 | `driver` × `wagon1` | ![](screenshots/clip-before-b00-d1.jpg) | ![](screenshots/clip-after-b00-d1.jpg) |

## Before (e8eea3f)

| mission | items | pairs tested | contacts | allowed | unintended static | turrets / hits | dynamic run (samples) | dyn. penetrations > 5 cm | of which bodies | audit wall time |
|---|---|---|---|---|---|---|---|---|---|---|
| m00 | 30 | 20 | 5 | 3 | 2 | 0 / 0 | 180 s (360) | 24 | 3 | 170 s |
| m01 | 68 | 19 | 7 | 1 | 6 | 1 / 0 | 180 s (360) | 15 | 0 | 98 s |
| m02 | 66 | 50 | 16 | 1 | 15 | 0 / 0 | 180 s (360) | 30 | 0 | 467 s |
| m03 | 109 | 109 | 6 | 1 | 5 | 0 / 0 | 180 s (360) | 76 | 0 | 333 s |
| b00 | 39 | 4 | 3 | 0 | 3 | 0 / 0 | 180 s (360) | 30 | 0 | 49 s |
| **total** | 312 | 202 | 37 | 6 | **31** | 1 / 0 | 15 min sim | **175** | 3 | |

Static audit cost is 0.1–1.1 s per map. The wall times above are dominated by the dynamic run. The per-sample character
broad phase was added after this run, which roughly halves m02.

**Static and turret, unintended (31, all accepted into the baseline at the time):**

| categories | n | | categories | n |
|---|---|---|---|---|
| building / prop | 7 | | building / pole | 1 |
| building / wall | 2 | | building / rocks | 1 |
| tower / wall | 2 | | building / tower | 1 |
| rocks / trunk | 2 | | bridge / building | 1 |
| character / tower | 2 | | bridge / pole | 1 |
| character / wall | 1 | | bridge / fence | 1 |
| building / character | 1 | | fence / foliage | 1 |
| building / building | 1 | | fence / pole | 1 |
| wall / wall | 1 | | fence / prop | 1 |
| gate / wall | 1 | | gate / vehicle | 1 |
| | | | gate / prop | 1 |

**Dynamic (175 pairs):**

| categories | n | | categories | n |
|---|---|---|---|---|
| building / character | 79 | | character / sandbags | 4 (+1 body) |
| bridge / character (incl. dam) | 35 | | character / trunk | 3 |
| character / prop | 25 | | building / character (body) | 2 |
| character / wall | 11 | | character / pier, / tower | 2 + 2 |
| character / gate | 6 | | vehicle / trunk | 2 |
| | | | character / pole, / cliff; vehicle / gate | 1 each |

### Worst static cases

| # | mission | pair | depth / contact / volume | crop |
|---|---|---|---|---|
| 1 | m03 | `dam` (bridge) × `dam_bunker`: the bunker is sunk into the dam crest | 1.29 m / 18.0 m / 4.6 m³ | ![](screenshots/clip-before-m03-s1.jpg) |
| 2 | m01 | `barr_L_a` × `barr_L_b`: two long barracks overlap, roofs cross | 0.51 m / 70.3 m / 1.6 m³ | ![](screenshots/clip-before-m01-s1.jpg) |
| 3 | m02 | `camp_wall` (palisade) × `cab1`: the palisade runs through the cabin | 0.42 m / 6.2 m | ![](screenshots/clip-before-m02-s1.jpg) |
| 4 | m02 | `camp_wall` × watchtowers `t1`, `t2`: **towers standing astride the palisade** (the user's example) | 0.14 m / 16.5 m and 12.1 m | ![](screenshots/clip-before-m02-s8.jpg) |
| 5 | m02 | `sw_wall` × `cabA`; `camp_wall` × `gate_se` (the gate leaves are 25 m of contact with the wall line) | 0.33 m / 6.2 m; 0.09 m / 24.9 m | ![](screenshots/clip-before-m02-s2.jpg) |
| 6 | m02 | `cab1` × drums `bar1`, `bar2`; `cab1` × `rocks_n1` | 0.27–0.29 m | ![](screenshots/clip-before-m02-s3.jpg) |
| 7 | m01 | `relay_hut` × `relay_mast`: a mast leg comes down through the hut roof edge | 0.20 m / 0.9 m | ![](screenshots/clip-before-m01-s2.jpg) |
| 8 | m00 | `bridge` × `lamp_post#21`; `wall#2` × `wall#3` run along each other for 17.5 m | 0.20 m; 0 / 17.5 m | ![](screenshots/clip-before-m00-s2.jpg) |
| 9 | m02 | tree trunks growing out of islet rocks (`pine#19`, `pine#21`) | 0.17 m | ![](screenshots/clip-before-m02-s5.jpg) |
| 10 | m03 | fences through things: `st_fence` × `dam`, `st_fence` × pine foliage, `cage_12` × `pylon_1` | contact 2.5 / 7.7 / 1.5 m | ![](screenshots/clip-before-m03-s5.jpg) |
| 11 | b00 | `bridge1` (swing bridge, cat. gate) × moored `boat1` and × `mine1` | 0.13 m / 10.4 m; 0.10 m | ![](screenshots/clip-before-b00-s1.jpg) |
| 12 | m01 | fuel drums `b1`, `b3`, `b4`, `b5` pushed 2–8 cm into the barracks walls | 0.02–0.08 m | ![](screenshots/clip-before-m01-s3.jpg) |

Spawn poses: `e5` stands 14 cm into the `camp_wall` walkway (m02), and `e8`/`e9` into the watchtower decks by 5 cm. `e12`
spawns against `cab1`.

**Turrets**: the current content has a single turret, the M1 MG nest `mg1_gun`, which is clean over its full arc. Tanks
and armoured cars are not placed yet in these maps. The sweep does work: the GPU test parks that nest 0.7 m from a barracks
wall and the barrel is caught (for example 0.05 m into the wall solid, 320°). Missions 4–20 get it automatically.

### Worst dynamic cases (180 s each)

| mission | pair (worst of the kind) | depth / samples | crop |
|---|---|---|---|
| m03 | **everyone walks inside the dam parapet / crest**: 35 unit×dam pairs, the worst `e6`, `e7`, `camp_barr#0.0.1` | 1.2–1.5 m (depth cap), ≤ 99 samples | ![](screenshots/clip-before-m03-d2.jpg) |
| m03 | units walking through `dam_bunker` (`sapper`, `e32`, `e17`, …) | 0.6–1.0 m | ![](screenshots/clip-before-m03-d1.jpg) |
| b00 | **every unit walks through the `wagon1` and `tank1` props** (no blocking footprint) | 1.1 m / 0.74 m | ![](screenshots/clip-before-b00-d1.jpg) |
| m02 | patrol boat `pboat` driving through the pine trunks on the islets | 0.55 m | ![](screenshots/clip-before-m02-d1.jpg) |
| m02 | sentries `e1`, `e2`, `e3` standing inside cabin `cabB` for the whole run; commandos brushing `cabA`/`cabB` corners | 0.42–0.51 m, 150–310 samples | ![](screenshots/clip-before-m02-d5.jpg) |
| m02 | at the alarm (t≈26 s) released garrison `e14`, `e16` pass through the walls of `barr_out` (spawn/exit point vs mesh, to check) | 0.39 m | |
| m01 | patrols `e8`, `e9` walking through the front of `house_s` (porch/steps slab above the nav ground, suspected) | 0.48–0.50 m, 146–164 samples | ![](screenshots/clip-before-m01-d1.jpg) |
| m01 | `diver` × `jetty_s`; commandos / `e6` brushing through the stone wall `wall_s` | 0.42 m; 0.30 m | ![](screenshots/clip-before-m01-d5.jpg) |
| m00 | every unit crossing `bridge` sinks 19–23 cm into the deck | 0.19–0.23 m, ≤ 32 samples | ![](screenshots/clip-before-m00-d3.jpg) |
| m00 | sentry and sniper walking alongside `wall#3` with the rifle and arm in the bricks | 0.25 m | ![](screenshots/clip-before-m00-d1.jpg) |
| m00 | **bodies**: `guard_fuel` and `patrol_east` killed next to `hut1` lie 10–11 cm inside its wall; `sentry_bridge`'s body is inside `sandbags#7` | 0.10–0.11 m; 0.08 m | |

The raw per-pair data (times, positions, unit states, counts, crops) is in `docs/clipping/<mission>.json`.

## Recommended fixes (as written before the fix; all done, see "Fixes")

1. **Linear runs vs structures (map-builder)**: split wall and fence runs where they cross a footprint that is not a
   joint. This covers buildings, towers, gates, pylons, dams and bridges (M2 palisade × watchtowers, cabins and `gate_se`;
   M3 `st_fence`, `cage_12`). An alternative is to move the run to the footprint edge and emit `clipAllow` for the joint.
   Watchtowers on a wall line should cut a gap as wide as the tower.
2. **Placement validation**: offset props (drums, crates, rocks) that are placed "against" a building out of its
   footprint plus 10 cm. M1 `b1–b5`, M2 `bar1/bar2/rocks_n1`, M3 `bombs_shed`. Reject trees whose trunk base is
   inside a rock or cliff prop, or on a boat route (M2 islet pines × `pboat`).
3. **Navigation vs meshes**:
   - Give every catalogue prop a blocking footprint derived from its mesh bounds or library sidecar (b00 `wagon1` and `tank1`, M3 `dam_bunker`, M1 `house_s` porch).
   - Take walk heights on bridge and dam decks from the deck mesh, not `deckY` (M0 bridge sinks 0.2 m, M3 dam parapet is walkable).
   - Inflate wall block cells by about 0.3 m for body clearance (arms and rifles in walls).
4. **Spawns and garrison release**: check enemy spawn points and barracks exit points against building meshes with
   `clip-geom.insideDepth` (M2 `e1–e3` inside `cabB`, released `e14`/`e16` crossing the walls of `barr_out`).
5. **Bodies**: when a unit dies, test the death-pose box against nearby static items. If it penetrates, slide the body
   out along the contact normal, or rotate the fall direction away from the wall (M0 `hut1`, `sandbags#7`).
6. **Boats**: moored boats and bridge spans. b00 `boat1` sits under or into the swing bridge `bridge1`.

## Limitations

- **Depth** is penetration into the other item's *solid*. A barrel poking through a thin wall into a hollow room gives a
  small depth but a non-zero contact length, which is why contact is reported (and ranked) too. One-sided categories
  (`foliage`, `fence`, `flag`, `wire`) are never used as the "inside" reference, so their pairs rank by contact only.
  Depth is capped at 1.5 m.
- **Dynamic run coverage**:
  - one deterministic 180 s run per map (seed 7), not exhaustive.
  - the commandos are invulnerable.
  - unit-vs-unit and unit-vs-vehicle pairs are not audited.
  - units in vehicles, hidden, buried, held or underwater are skipped.
  - crops of dynamic findings are taken at the moment of the worst sample.
- **Coverage gaps**:
  - terrain and ground layers are excluded by design.
  - clutter stones only with `--clutter`.
  - forest-scatter trees drawn as impostors are not audited; only the unique, fully generated trees are.
- **Baseline keys** use structure ids. Unnamed structures (`wall#2`) are keyed by their index in the mission, so reordering
  `structures[]` re-keys them. Regenerate with `--write-baseline`.
- **Placement rules** (this fix):
  - point props move only when the visual shapes are known (browser build). Grid-only node builds check and log but do
    not move them, so for the shipped maps the moves are baked into the mission data (node and browser agree). New
    content (missions 4–20, phase 3) is moved at load in the browser; bake the `[placement]` console log into its data to
    keep its node tests on the same positions.
  - visual nav blocks, measured decks and feet surfaces exist only in the browser build (grid-only builds have none).
  - buildings are never moved at runtime: overlapping / crowded footprints are schema warnings, fixed in the data.
  - elevated posts (wall walks, decks) are not pushed out: the mission places them against their deck edges (M2 e5).
  - crown pruning (`crownBase` / `crownR`) applies to conifers; broadleaf trees rely on the trunk clearances.
  - a turret arc is a barrel band (5° steps, the line ±0.2 m) against grid cells with measured heights and overhangs;
    thin obstacles narrower than a 0.5 m cell can still be missed by the arc but are caught by the audit's
    triangle-exact sweep and the turret probe.
  - the likely fall side of a body is guessed from the unit's last animation (run → forward, else backward); a death
    clip that falls sideways is covered only by the both-ways checks.
  - tree boughs close gun angles but do not stop hulls (a tank brushes through branches); the bough layer comes from
    the generated bark, so impostor trees have none.
  - the turret probe parks two placeholder models (`panzer2`, `sdkfz`); catalogue models with longer barrels are covered
    by the same arcs (their `gun` reach / height) but not probed.
- **Browser tests**: all 41 pass (second pass: re-run, all 41 green). `ui-layout` ("the map sheet keeps the 16 px gutter") is intermittent on this machine,
  at e8eea3f as well (checked on a clean checkout); unrelated to this work.
