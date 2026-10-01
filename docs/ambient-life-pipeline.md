# Ambient life pipeline (PROGRESS step 4f)

User request: *"make sure the sea has some fish"*. The follow-up extras are gulls over harbours and coasts, crows
in fields and ducks on ponds. None of this affects gameplay and none of it is saved.

## Layout

| file | role |
|---|---|
| `src/world/fish-sim.js` | Pure, deterministic fish boids: `FISH_SPECIES`, `FISH_HABITATS`, `fishHabitat()`, `fishPlan()`, `FishSim` |
| `src/world/bird-sim.js` | Pure bird behaviour: `BIRD_SPECIES`, `birdPlan()`, `BirdSim`, `windAtHeight()` |
| `src/world/bird-ground.js` | Feet and gait of the birds that stand (crows, gulls): `legDims`, `feetGait`, `feetAir`, `turnTo`, `peckCurve` |
| `src/art/fish-model.js` | Procedural fish body, instanced swimming shader, soft bed shadows (`createFishMesh`, `writeFish`, `createFishShadows`) |
| `src/art/bird-model.js` | Low-poly birds with GPU wing flap, fold and peck, two plumages per species (`createBirdMesh`, `writeBirds`) |
| `src/render/ambient-life.js` | Per-mission director `createAmbientLife(world, renderer)`: plans the life, wires events, and each frame steps the sims, culls and uploads instances |
| `src/world/map-builder.js` | Creates the director on the first frame after `handle.ready` (so the water's bed capture never sees it) as `mapHandle.life`, and disposes it |

Gaps of up to 5 s between frames (tools advancing seconds between renders) are caught up in chunks of 0.5 s or
less; longer jumps are skipped.

Both sims run on the **interpolated sim time** (`world.wind.t`, which `Game.render` publishes). Everything is
therefore frozen while paused and advances in step with the game. Their RNGs are seeded from `mission.seed`.

## Fish

**Habitats and species.** Each nav-grid water body is classified by `fishHabitat(body, theater)`, and the habitat
sets the species. Group counts scale with water area (groups per 1000 m², capped) and with the quality preset
(`FISH_DENSITY`: low 0.45, medium 0.7, high 1, ultra 1.25).

| habitat | when | species (adult sizes, behaviour) |
|---|---|---|
| fjord | `fjord` preset or a snow-theatre sea (M1's still fjord) | Norwegian spring-spawning herring (0.29–0.37 m, schools of 45–75, upper water column), saithe / pollock (0.5–0.75 m, schools of 10–16, mid-water, along banks and piers), coastal cod (0.55–0.9 m, 2–4 near the bed) |
| sea | other seas, harbour presets | thick-lipped grey mullet (schools of 14–24 just under the surface, hugging piers and quays), European sea bass (4–7, mid-water) |
| river | river bodies | brown trout (singles and pairs) and grayling shoals, **holding station head-upstream** (rheotaxis) at lies they change now and then |
| lake | lakes and ponds | perch shoals (barred flanks) and a few trout |

Frozen bodies get no fish. Missions may override this with the optional field
`ambient: {fish?: false, birds?: false, habitat?: 'fjord'|'sea'|'river'|'lake', density?: 0..2}`, which
`normalizeMission` passes through. Missions 4–20 can use it, for example M13 harbour → `habitat: 'sea'`.

**Behaviour** (`FishSim`, sub-stepped at 20 Hz or faster):

- **The school goal wanders through its habitat.** A school's goal moves at cruise speed and turns away from poor
  water. It scores 9 candidate headings on:
  - a depth preference;
  - a **shore and pier preference** built on the water bake's shore distance, which already counts piers, rocks and
    hulls as obstacles, so mullet and saithe patrol along piers.
- **Members steer with boids rules:** goal and formation offset, cohesion, alignment and separation. They keep to
  the species' depth band, which is a fraction of the local water column, clamped off the bed and the surface.
- **They never leave the water.** Each fish runs a look-ahead query at 5 Hz for dry cells, ice shelves and shallows.
  When the query fails, the fish follows the gradient of (shore + depth) back into open water.
- **Heading and tail beat come from the water-relative velocity.** The tail beats at U / (0.62 L) Hz, the observed
  stride of about 0.6 body lengths per beat. Fish in a current face upstream. Turns add a C-bend and a slight bank.
- **Fright.** There are two kinds of fright source:
  - **Threats**, which are continuous: divers 4.5 m, swimmers 3.5 m, waders 2.5 m, boats 6 m, with smaller radii
    when idle.
  - **Impulses**, which are events: splashes (WakeTracker), dives and surfacing, grenades bouncing into the water,
    missed shots into the water, explosions.

  Frightened fish do a C-start burst (acceleration ×4, up to 2–2.6 m/s) away from the source and sound 12 cm
  deeper. Schools flash-expand, the school goal flees, and the alarm decays over about 3 s before the school
  regroups.
- **Feeding cues.**
  - **Flank flashes:** feeding fish roll 0.6–1 rad for about 0.35 s, turning the mirror flank to the sky. The rate
    is set per species, from herring at 10 per minute down to cod at 1.
  - **Surface rises:** trout and grayling take flies, and mullet and herring dimple the surface ("nervous water").
    The fish swims up to the surface film, and the director hands a faint ring to the water's ripple sim
    (`water.disturb`, normals only, at most 6 per frame). So a river shows its fish by their rise rings even where
    the bodies are too deep to see.
- **Underwater blasts** (`explosion` on a wet cell) stun 2–4 fish inside 0.6 r. A stunned fish:
  1. rolls belly-up and floats to 3.5 cm under the surface, where its silver belly shows;
  2. drifts with the current and 3 % of the wind, with weak twitches;
  3. after 4–9 s rights itself and dives back to its school.

## Rendering fish under the water

Fish are **ordinary world geometry below `WATER_LEVEL`**. The water system reuses the scene colour and the stashed
world depth (`DepthStashPass` → `WaterPass`), so fish drawn in the world pass are part of the refracted "bed":

- **Beer–Lambert absorption over the stashed depth.** Fish near the surface stay clear and fade with depth. The
  `muddy` preset (turbidity 0.9) hides them.
- **The water's own effects apply to them.** Caustics play over their backs, refraction wobbles them with the
  ripples, and the planar reflection and Fresnel veil them as they do the bed. The reflection's global clip plane
  keeps them out of the mirror.
- **They are kept out of the bed capture.** Every mesh is tagged `userData.waterIgnore` / `dynamic`, and the
  director is only built after `mapHandle.ready`, so the capture never sees fish.

The fish model:

- **Body.** A procedural fusiform body of 12 × 8 rings, with the species' depth and width ratios, a forked caudal
  fin (fork depth per species), a dorsal fin and pectorals. Each fish is under 260 triangles.
- **Swimming** is vertex-animated on the GPU. It is a carangiform travelling wave (1 body wavelength, amplitude
  ∝ 0.12 + 0.88 u², tail tip about 0.1–0.2 L peak to peak) plus a C-bend for turns. Normals are rotated by the
  local slope. Phase, amplitude and bend are uploaded per instance from the CPU sim, so the motion freezes on pause.
- **Countershading and markings** are computed in the fragment shader: a dark back, a silver flank and a white
  belly. Perch get bars, trout spots, cod a mottle, saithe and cod a pale lateral line, mullet and bass faint
  stripes; every fish has an eye.
- **Underwater optics.**
  - Skin and mucus against water has n 1.37 vs 1.33, so F0 ≈ 0. Wet backs therefore get **no sheen** under water;
    the dielectric F0 is forced to 0.0004. Without this the backs reflected the overcast IBL and matched the bed.
  - Only the guanine mirror flanks (metalness 0.1–0.75 per species) reflect, which gives the silver flash of a
    turning school.
  - The scene IBL is calibrated dim (`environmentIntensity` about 0.12, lighting is sun-dominated), so the fish get
    `scene.environment` explicitly at 0.6. The mirror flanks then reflect the downwelling light and a school reads
    as silver slivers at gameplay zoom instead of vanishing into a dark bed.
- **Shadows.** Shadow maps ignore refraction: under water the sun is much steeper (Snell), and underwater light is
  diffuse. So fish cast no shadow-map shadow. Instead one instanced draw puts a soft elongated darkening on the bed
  under each fish:
  - it is offset along the **refracted** sun ray;
  - it gets wider and fainter the higher the fish swims above the bed;
  - under an overcast sky (`hdri: overcast`) only a faint occlusion right below the fish remains.

## Birds

`birdPlan` decides which birds appear where. Desert maps get none, and there are no crows at night.

| species | where | behaviour |
|---|---|---|
| herring gull | Seas, harbours, fjords, big rivers. About 35 % are first-winter brown birds. | They wheel on 7–15 m circles in flap-and-glide bouts. They land on pier deck edges and pier heads (`lifePerches` from the mission's `pier` / `jetty` structures, with y from `world.groundY`) or on the water, and sit 15–50 s. |
| hooded crow (black carrion crow on the alternate plumage) | Open snow, grass, ground or mud fields (`lifeFields`: obstacle-free 2 m grid) | They walk with alternating steps and a head-bob, hop, peck and look round (see *On the ground*), then commute between patches of the same fields. |
| mallard (drakes and ducks) | Ponds, lakes, rivers slower than 1.1 m/s | They paddle around home water near the bank, dabble tail-up, and leave faint ripples (`water.disturb`). |
| common eider | Northern seas and fjords (M1) | Rafts of 4–8. Eiders patter off the water to take off, while mallards spring straight up. |

- **Wind.** Every bird flies *through the air mass*. Its ground velocity is its air velocity plus the WindField
  wind at its height (log profile, z0 = 3 cm), capped at 1.05 × the species airspeed, because birds keep low in a
  gale.
  - The bird's heading follows its **air** velocity, so gulls crab, and in strong wind they hang into it nearly
    stationary.
  - Banking is coordinated: tan φ = vω/g.
  - Landings run as approach → final. The bird swings round to come in from downwind, flares with deep wingbeats,
    and settles **facing into the wind**. Sitting birds keep facing the wind, and ducks drift downwind at 2.5 % of
    the wind plus the current.
- **Flushing.** These events make birds take off:
  - gunshots (the `shot` event, not knives or injections) within about 55 m;
  - explosions within 90 m;
  - `noise` events with a radius of 10 m or more;
  - anyone or any vehicle *moving* inside the species' wary radius: gull 7 m, crow 11 m, mallard 10 m, eider 12 m.

  A flushed bird bursts off with fast wingbeats and climbs away. Ducks splash (`WakeTracker.splash`, which also
  frightens the fish below), fly a circuit and come back to land. The director emits `ambient:flush`
  `{x, z, species}` for audio hooks.
- **On the ground** (crows in the fields, gulls on pier decks; `src/world/bird-ground.js`). User report: *"walks walk
  strange on the ground, with abrupt movements"*. The old crows teleported 0.15–0.5 m with an instant heading snap
  about 0.7 times a second, had no legs (the body floated 6 cm up), and landings / take-offs popped (a 0.35 m snap
  onto the spot, pitch 0.5 → 0, wings folded and flaps stopped in one frame, a 25 cm jump up at take-off). Now:
  - **Activities, blended.** A crow walks to a spot 0.5–2.3 m off (0.3–0.6 m/s, accel ≤ 2 m/s², braking into the
    spot), pecks in bouts of 2–5 (a 0.1 s strike, a short hold, a slower lift, with the body pitching and crouching
    a little), stands looking round (head saccades of ~0.2 s, capped at 7 rad/s), or makes 1–2 two-footed hops
    (0.22–0.42 m, 5–9 cm high, ballistic flight time, a 0.1 s crouch before and a 0.14 s sink into the legs after).
    Turn rate ≤ 3.2 rad/s (2.6 walking, 1.2 into a strong wind), itself eased; a big turn is made on the spot first.
  - **Feet in world space.** A planted foot never moves. A gait clock (cycle 0.36 s slow … 0.22 s brisk) steps the
    left foot at phase 0 and the right at 0.5, each swinging 0.42 of a cycle on a low arc to v(C − T)/2 ahead of
    its hip, so one foot is always down and the stance is centred under the hip. Standing or turning on the spot,
    a foot more than 1.5 cm off its rest point shuffles back under the hip.
  - **Head-bob.** The head holds still in space while a foot is planted and thrusts forward with each step.
    A slight waddle rolls the body over the planted foot.
  - **Landing.** Legs come down and reach forward in the last 4 m. Within 1.2 m the bird sinks onto the spot under
    deep flaring beats: a perch is homed onto (settling within 4 cm; the rest is a critically damped shuffle, ω 9 rad/s,
    that starts from the touchdown's own drift), a field landing glides out its speed (decay 2.2/s, carried into the
    first steps), the water just runs out the remaining speed. Then the feet are planted where they are and a crouch
    spring (ω 20 rad/s, ζ 0.75) takes the sink rate. Wings fold and the pitch eases out in `_idle`; nothing is snapped.
    Gulls do not pick a post someone is standing near (1.5 × wary radius).
  - **Take-off from the feet.** A crouch on the spot (0.16 s, or 0.09 s when startled) with the wings opening and the
    body turning into the jump (≤ 6 rad/s), then the spring (2.6 m/s up); the legs trail and tuck under the belly.
    A timed take-off waits for the peck bout to end; only a startle cuts a peck.
  - **Startle.** Someone moving inside 1.6 × the wary radius makes crows walk off briskly (0.75 m/s) away from
    them, veering up to 80° round obstacles or water (boxed in: they stand alert); inside the wary radius they flush.
  - **Obstacles.** `env.blocked(x, z)` (grid block > 0 or a standing visual) keeps crows out of walls, palisades and
    rocks: spawn spots, walk / hop / walk-off targets need 0.25 m clearance and a clear straight path (sampled every
    0.6 m); while walking, a probe one body length plus the braking distance ahead brakes the crow (≤ 2.5 m/s²) and
    gives up a walk heading straight at an obstacle. (M2 report: a crow half inside the palisade logs; a 90 s M2 probe
    went from 117 frames of a crow standing in a blocked cell to 0.)
  - **Flocks.** Walk and hop targets keep 0.5 m (hops 0.35 m) from other crows and stay in open field within 9 m
    of home; no per-frame separation forces, so no jitter.
  - **Rendering.** Crows and gulls have legs (two crossed quads and a toe wedge each). `writeBirds` brings each sim
    foot into the body frame (`iLeg0` / `iLeg1`, plus head-bob and look), so planted feet stay put on screen
    whatever the body's pitch and roll. The body centre stands `0.27 × len` above the ground (it is part of `b.y`).
  - The sim already steps every displayed frame on the interpolated 60 Hz sim time, so no extra render
    interpolation is needed.
- **Wing animation.** Each wing has two panels. The arm rotates about the shoulder and the hand about the wrist,
  lagging about 50°. Folded wings sweep back along the flank with the primaries just past the tail. A
  `customDepthMaterial` runs the same animation, so the shadows match.

## Budget and performance

Per displayed frame, the director steps both sims on the sim-time delta, gathers threats from `world.entities`,
culls to the ortho view rectangle (the camera frustum projected onto y = −0.5, with birds shifted along the view
ray by their height), and uploads only the visible instances.

- **Draw calls:** one per fish species (up to 3), one for all bed shadows, and one per bird species (up to 3).
- **Measured cost.** Recorded on an RTX 5090 in headless Chromium at 1280×720, M1 framed on a herring school at
  zoom 2, with `tools/perf/fishshot.mjs --perf=1`.
  - *Director CPU* is the mean over 300 `frame()` calls at a 60 Hz sim step: sims, threats, culling and instance
    upload.
  - *Frame* is the median `Game.render` + `gl.finish` time with the life meshes shown, hidden, then shown again.
    These frame figures are noisy, about ±0.5 ms.

| preset | fish / birds | drawn fish | director CPU | frame on / off / on (ms) |
|---|---|---|---|---|
| low | 57 / 11 | 46 | 0.036 ms | 1.6 / 1.4 / 1.5 |
| medium | 124 / 15 | 60 | 0.054 ms | 2.3 / 2.3 / 2.2 |
| high | 175 / 20 | 86 | 0.12–0.13 ms | 2.7 / 1.7 / 2.1 · 2.3 / 2.0 / 2.7 |
| ultra | 315 / 20 | 173 | 0.179 ms | 2.0 / 1.9 / 2.4 |
| high, M2 river | 32 / 12 | 5 | 0.032 ms | 2.6 / 2.4 / 2.3 |

The ground gait (feet, head-bob, hops) raised the bird sim from about 0.014 to 0.056 ms per 60 Hz step for 20
birds (12 crows + 8 gulls, node on a loaded machine), still well inside the 0.3 ms budget.

The GPU work is small: at most about 173 fish × under 260 triangles, plus 1 shadow quad each, in 3–7 instanced draws.
It sits inside the measurement noise, and the whole feature stays within the 0.3 ms budget on every preset.

## Tests and tools

- `tests/unit/ambient-life.test.mjs` covers:
  - habitats and species, and population scaling;
  - fish staying in the water and the depth band, determinism, and freezing on pause;
  - trout rheotaxis;
  - flash expansion and C-start, and blast stun and recovery;
  - the bird plan per theatre;
  - wind-facing settling, flushing, landing again, and gales;
  - crows flushing on approach;
  - the director over a real `World` (M1 perches, events → stun and flush, pause);
  - model budgets, tags, culling and shadows.
- `tests/unit/bird-ground.test.mjs` steps crows and gulls at 60 Hz with someone walking past: per-frame displacement,
  speed-change and heading-change limits, planted feet never sliding, steps per metre walked, legs within reach,
  head-bob, hops and pecks, landing / take-off blends (height, pitch, fold, flap amplitude), determinism, the
  rendered foot landing exactly on the sim foot, a palisade across the field (never entered, bill kept out, eased
  braking), no timed take-off mid-peck, and no jerk when a gull settles on a post.
- `node tools/perf/birdclip.mjs --mission=m01 --sp=crow --zoom=2 --secs=8 --fps=30 --out=<dir>` records frames and a
  per-frame trace of the ground birds (60 Hz sim, rendered every step) for motion review.
- `tests/p3-fish.test.mjs` runs in the real game on the GPU: M1 species and birds, meshes tagged, fish under the
  surface, swim phases frozen on pause, a blast that stuns and scatters and flushes, the M2 trout, disposal, and the
  coast sandbox.
- `node tools/perf/fishshot.mjs --mission=m01 --at=school:herring --zoom=2 --frames=4 --gap=0.5 [--blast=1] [--shoot=1] [--perf=1]`
  renders frame sequences for motion review and measures cost with the life meshes shown and hidden.

## Known limits

- **Fish are small at gameplay zoom, as in life.** At zoom 1 a herring is about 13 px long and 2 px wide; at zoom 2
  it is about 26 px. A school reads as moving dark slivers with silver glints. At the zoom-1 overview, in deep or
  choppy water, fish are hard to see; this is on purpose.
- **No underwater camera and no fish–fish predation.** Gulls do not yet dive for stunned fish.
- **No bird calls.** Audio could hook `ambient:flush`.
- **Birds do not avoid buildings in flight.** Their flight bands, 3–15 m, clear most roofs, and they land only on
  piers, open water and open fields.
