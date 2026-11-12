# Roads, tracks, paths, ruts and desire lines (terrain round 1)

Every road, track and trodden path is drawn from one visual model in `src/world/roads.js`; the per-mission data that
model reads (desire lines, vehicle ruts, per-road look options, fans, pole slides, the camp decal's mask) lives in
`src/world/line-extras.js`, keyed by mission id. Nothing here reaches the simulation.

## What the game reads (unchanged)

- **The road network.** `normalizeRoadNetwork()` returns the same enumerable `{theater, roads, areas, furniture}`: grid
  codes (`paintRoadGrid`), `RoadIndex`, rail clearance and alignment read it. The only addition is a NON-enumerable
  `net.missionId` (and a WeakMap with the map size), so `JSON.stringify(net)` — the splat cache key — and the grid paint
  are byte-identical to master for all 21 missions (`tests/unit/road-paint.test.mjs`).
- **The splat's floats.** `splat.f32` is what every CPU reader of the ground reads: the guards' print visibility
  (`materialAt` → `printVisibility`, ai/footprints.js), the desert scrub plan (nebkha mounds the bodies rest on), grass
  and clutter density. `terrainPainter` — the splat build's paint hook — is master's painter, unchanged (a unit test
  compares it with a frozen copy on every mission), so the floats are master's byte for byte.
- **Furniture.** Blocking furniture never moves; only `block: false` telegraph poles may slide along their line (M12).

## The four visual channels

| channel | where | what |
|---|---|---|
| splat look | `roadLookPainter`, laid over the finished splat's GPU bytes by `overlayRoadLookG` (art/terrain.js, in the terrain's `ready`, once per cached splat: `splat.roadLook = roadLookKey(net)`), and over the scenery apron's bytes by `overlayApronLookG` (carried on along each road crossing from the map's last metres, as the apron's own road paint is) | crowned carriageway, darker soft shoulders, wheel-lane wear tone, ragged crumbly edge, 0.6-1.2 m wandering verge, spray fringe, open-end taper, junction fillets, desert tongues / windrows, desire lines and ruts' beds, slab wash / pad rings / fans |
| pre-trample stamps | `pretrampleRoads` → `trails.js _preLinesG` (record: false, re-stamped after a lost context) | 1-4 wandering rut PAIRS per road, packed centre (`flatten`), verge walkers, boot lanes, cart / vehicle / tracked ruts, static stamps |
| trail shader | `trails-glsl.js` | tread only inside the ruts, re-cut every 6-8 m, crumbly rut walls, soft-edged trample |

All look terms and stamps are pure functions of world x, z (no grid reads, no clamping to the map), so the apron's
road crossings continue them without a seam; courses that touch the map edge run 16 m past it. The 3D grass tufts and
the ground clutter are planted from the floats on the map and in the apron alike, so they are master's to the tuft (the
grass placement is one random stream: thinning any of it reshuffles the whole sward and its merged draws); on the
trodden lines the pre-trampled prints press them flat (the grass shader reads the trail field).

## The road model

- **Courses**: the authored polyline, corners filleted (~6 m, `roundCorners`) or Catmull-Rom (3p splines), or a visual
  `course` override (M3's camp track bent past the well). Soft roads that continue one another end to end (an end within
  1.5 m of another's, directions within ~40°) are chained into ONE course (`chainRoads`: M3's station road and works
  road), so their crown and lanes run through the joint. Width wanders ±7 % along a 19 m noise, or within a
  `widthRange` (M11 3.5-6 m, M17 3.4-4.6 m).
- **Cross-section**: the carriageway blended to the theatre's surface mix, a lighter packed crown (~40 % of the width),
  darker soft shoulders where the wheels run, the wheel lanes, a crumbly last 0.4 m, then a patchy verge. The palettes'
  own scans decide the recipes: temperate 'dirt' is a cracked clay and the meadow's tone is the tufts' season palette,
  so trodden ground is damp 'mud' earth with the stony 'road' trail and gravel on packed crowns; the snow palette's 'ice'
  slot is a frozen-pond look and is kept off roads (the glazed centre is lighter packed snow); desert pistes are grey
  compacted dust and gravel lag across the whole carriageway (never a red ribbon), loose sand only in patches between
  the ruts and in drift tongues every ~12 m, the verge darkening the plain's own mix (no pale halo). On snow roads
  `glaze` (0-1) is how far traffic has polished the packed lanes: a brighter crown, cleaner even grey lanes, shallower
  ruts.
- **Ends**: an end on another road is joined (no taper; its lane tone and ruts fade over 4 m into the other road's); on
  the map edge it runs on; anywhere else it is open: tapered and ragged over the last 6-8 m, the verge fading over
  10 m, the ruts stopping 2-4 m short and spreading. Where a road — or a lone vehicle / cart / tank line — runs onto a
  pavement its ruts become a fading film (2.5 m, `hardCarry`), never a rut ploughed through stone nor a pair of dark
  ruled stripes across a slab (the pavement shader turns any trail into a full film); boots keep their prints there.
- **Junctions**: a smooth minimum of the edge distances (3-6 m fillets) plus worn corner fans (rut lines cutting the
  inside corners). Roads running along each other merge by max, never by sum.
- **Rut lanes** (`roadRutLanes`, shared with the hard ribbons' shader): 1-4 pairs, gauge 1.6-1.8 m ±0.11, offset
  wandering ±0.3 m along a 15-25 m noise; the pair nearest the crown carries the traffic (full wear), the others a share
  of it; wear × (1 − 1.5|u|²). Each wheel 2-5 braided passes with their own jitter and drift; the rut deepens and
  shallows along its length (0.3-1 × along an 8.5 m noise), so a lane is never one even stripe and puddles form in its
  deeper stretches only. A road's rut is a trough worn by traffic: 0.4 m wide, stamped with the `worn` profile
  (trails-glsl: rounded walls across the whole width, smeared tread, a low broad lip — no sub-texel wall for the low sun
  to catch as a bright ruled line), berm ×0.22; on temperate ground (wet mud, whose sheen catches a steep sunlit wall)
  0.6 m wide and ×0.85 as deep (`rutW` / `rutLoad` per road). A lone line of a few passes (vehicle, cart, tank) keeps
  more of its print (`worn` 0.25-0.5) and its berm, and its painted tone is a tyre's width, not a road's wheel lane.
- **Nothing rolls over what stands** (`laneDetours`, fed by `roadObstacles(mission, net)`: the structures with a
  footprint — buildings, huts, tents, wells, crates, drums, rocks, tree trunks, bollards, posts — and the furniture's
  lamps and signs; not what is driven or walked on): every 0.5 m the lateral spans those things block (footprint +
  0.3 m) are kept clear of each lane's wheels (gauge + tyre). A run of road where a lane runs into something swerves to
  ONE side — the side that clears it everywhere with the smaller shift — within the road and its verge (+0.9 m), eased
  in and out over 3 m + 2 × the shift (1 m box-filtered); where nothing fits (a hut astride the track, hedgehogs across
  the road) the lane's ruts and worn tone stop, ramped over 1.5 m, and run on past it. The setts' frozen films
  (`hardRuts`) and the ruts run past a hard end (`rutsPast`) swerve the same way. The well in M3's camp street, M6's
  roadblock hedgehogs, the houses flush with M17's lanes and M7's quay bollards no longer stand on a rut.
- **Walkers**: each its own stride (0.62-0.8 m), phase and depth, so a file of walkers never prints in ranks; boot lanes
  in deep snow ~40 passes.

## Line extras (per mission)

`roads` (per-road options matched by geometry, `{near: [x, z]}`, so a re-laid road keeps working and a reference that
matches nothing is a no-op: widths, pairs, gauge, wear, glaze, verge caps, ends, a visual `course` such as M10's curve
through the N gate), `lines` (foot / boot / drag / cart / vehicle / tracked / sled), `stamps` (outrigger and
track-link marks), `fans` (mud / grit / gravel where wheels leave a surface or stop), `areas` (slab wash, pad rings),
`poles` (non-blocking pole slides), `toRoad` (desire lines from doors to the nearest road), `campRuts` (M9 decal mask
+ scuff, matched by the decal's seed), `recipe: 'thaw'` (M6). Every line and door path keeps out of buildings, huts and
tents (a unit test walks them against the structures' footprints): lanes go round the houses door to door. A wheel
line (vehicle, cart, tank, sled) also keeps its whole width — gauge + tyres — off everything standing (props, posts,
lamps, bollards, rocks, trunks; only its own end may meet its subject: the parked car, the beached boat, the pad), a
trodden line keeps its trodden core (w/2 − 0.35 m) off the props, and neither crosses a fence or wall except through a
gate wide enough for it (unit-tested on all 21 missions). So M7's quay carts and half-track run inland of the lamp
row (the quay strip itself, bollards at its face and lamps at its back, carries no ruts: `pairs: 0`), the beach sled is
hauled from h_6's deck to its boat, M3's patrol walks the switchyard aisle between the cage rows, M15's cemetery paths
start at its gate and the bowser comes off the north street, M10's nest path goes round the wire belts' ends. The
game's placement rules move some point props by their drawn shapes (in the browser only: a node build checks them but
leaves them, "data shapes; not moved") — M7's quay bollards stand 3.5 m in off the water, M5's crates 1.8 m off cabin h5
— so the test also holds every line clear of those in-game spots (`IN_GAME_MOVES`, read from `world.placement` in the
game): M7's half-track swings its tracks in round bollard 7, 4.5 m ahead of its nose, and M5's village footpath threads
between cabin h4 and the crates. (The road ruts need no such table: `roadObstacles` reads the placed mission the map
builder hands the terrain, so their swerves follow the props wherever the placement put them.)

## Decals

- `art/camp-ruts.js`: lanes masked out where a road runs (the road's own paint is the lane there), low-alpha scuff
  patches over the hardpan.
- `art/airstrip.js`: the rolled strip blurs 2 m into the sand in wind-drawn streaks, rutted thresholds (the turning arcs
  wholly on the strip), and the marker
  stones are real whitewashed stones (one instanced draw, no cast shadow: theirs is painted along the mission's sun).

## Wiring (art/terrain.js, a few lines)

`terrainPainter(drawn)` stays in the splat build's paint hook (the gameplay floats); `roadLookPainter(drawn, …,
{missionId, obstacles})` is built beside it (`drawn`: the render-only `art` courses where a mission has them — its network copy
carries no missionId, hence the option); `overlayRoadLookG` runs in the terrain's `ready` before the apron, and
`overlayApronLookG` right after the apron is built (the apron keeps the gameplay `paint` and master's crossing lines,
`roadEdgeLines`, so its floats and tufts are unchanged); `pretrampleRoads(drawn.net, {missionId, W, D, obstacles})` gives the
stamp jobs (`obstacles = roadObstacles(mission, ctx.roads.net)`: both see the same swerves). The ground-paint lane's own byte overlay (`overlayPaintG`) reads the floats and runs first; the road look reads the
bytes and runs after it (roads win).

## Checks

`tests/unit/road-paint.test.mjs` (network / grid byte-identity, gameplay painter = master's on every mission, the look
only on the bytes, the apron's crossing lines = master's and its look past the edge only, bounded verge, taper, fillets,
max-not-sum, purity, rut lanes, deterministic stamps) and
`tests/unit/line-extras.test.mjs` (every line on its map or leaving it on purpose, none through a building, references
resolve, poles clear of M12's vehicles, decal data, wheel ruts only a short film on hard ground, wheel lines clear of
everything standing and no line through a fence but at a gate — with a negative control on the old data —,
determinism); road-paint also checks that no rut of any road, setts film or line extra rolls over a standing thing on
any mission, and that the swerve round a well is eased, deterministic and leaves the network untouched.
