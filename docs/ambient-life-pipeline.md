# Ambient life pipeline (PROGRESS step 4f)

User request: *"make sure the sea has some fish"*. The follow-up extras are gulls over harbours and coasts, crows
in fields and ducks on ponds. None of this affects gameplay and none of it is saved.

## Layout

| file | role |
|---|---|
| `src/world/fish-sim.js` | Pure, deterministic fish boids: `FISH_SPECIES`, `FISH_HABITATS`, `fishHabitat()`, `fishPlan()`, `FishSim` |
| `src/world/bird-sim.js` | Pure bird behaviour: `BIRD_SPECIES`, `birdPlan()`, `BirdSim`, `windAtHeight()` |
| `src/world/bird-ground.js` | Feet and gait of the birds that stand (crows, gulls): `legDims`, `feetGait`, `feetAir`, `turnTo`, `peckCurve` |
| `src/world/duck-water.js` | Ducks (eiders, mallards): flock, swimming activities, chop, alarm, take-off run, formation flight, glide-in and skid (`DUCK_HABITS`, `duckSwim`, `duckFlee`, `duckRun`, `duckAir`, `duckFinal`, `duckSkid`, `chop`) |
| `src/art/duck-model.js` | Duck hull, head and wings with per-fragment plumage (drake / hen), GPU wing flap / fold, head, neck and tail poses (`duckGeometry`, `createDuckMesh`, `writeDucks`) |
| `src/art/duck-wake.js` | V wakes and take-off wash behind the ducks: one dynamic ribbon mesh on the late FX layer (`createDuckWakes`) |
| `src/art/fish-model.js` | Procedural fish body, instanced swimming shader, soft bed shadows (`createFishMesh`, `writeFish`, `createFishShadows`) |
| `src/art/bird-model.js` | Low-poly birds with GPU wing flap, fold and peck, two plumages per species (`createBirdMesh`, `writeBirds`; ducks dispatch to duck-model.js) |
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

User request (2026-10-11): *"You can add some fish in the water too"*: the fish were there but rarely seen (two
herring schools in M1 half a metre down, dark backs over a dark bed, cod at the bottom). Now every habitat also has
fish where they show: shoals of small fish over the shallows, big fish cruising high, leaps with splashes, shoals
dimpling the surface and flashing as they wheel; herring, sprat and mullet have steel-blue backs (lighter than the old
navy, which matched the dark water) and the herring ride higher (5–35 % of the column). In M1 the fish now change
~3× as many pixels plainly at zoom 1 (1220 vs 413 pixels changed by > 45 of 765, median over 10 s on the biggest
school; `tools/perf/fishclip.mjs --vis=1`).

| habitat | when | species (adult sizes, behaviour) |
|---|---|---|
| fjord | `fjord` preset or a snow-theatre sea (M1, M3, M7) | Norwegian spring-spawning herring (0.29–0.37 m, schools of 45–75, upper water), saithe / pollock (0.5–0.75 m, 10–16, mid-water, along banks and piers), coastal cod (0.55–0.9 m, 2–4 near the bed), **sprat** shoals (8–13 cm, 35–60, in 0.7 m of water), **sea trout** (0.4–0.7 m, singles, leaping) |
| sea | other seas, harbour presets (M13, M14, M16, M18) | thick-lipped grey mullet (14–24 just under the surface, hugging piers and quays, now and then leaping), European sea bass (4–7, mid-water), **sand smelt** shoals over the shallows |
| medsea | the desert theatre's seas and harbours (M12 Tunis) | mullet, **gilthead bream** (0.25–0.45 m, 4–9, round the quays), sand smelt |
| river | Norway rivers (M2, M3, M4) | brown trout (singles and pairs) and grayling shoals **holding station head-upstream** (rheotaxis) at lies they change now and then, **Atlantic salmon** in the pools (0.6–0.9 m, leaping), **minnow** shoals in the shallows |
| lowriver | lowland rivers (M17, M19) | **chub** under the banks near the surface, **roach** shoals, **pike**, trout, minnows |
| lake | Norway lakes, a raised reservoir (M3) | perch shoals (barred flanks), trout, pike, minnows |
| lowlake | lowland lakes and ponds (M15, M20) | perch, roach, **carp** (0.5–0.8 m, 2–4, bronze, scaled, cruising and slurping just under the surface, now and then a heavy leap), **pike** (0.6–1 m, alone, lying still at the margins, darting), minnows |

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
- **Showing themselves** (the visible-fish pass).
  - **Shallows.** Sprat, sand smelt and minnows prefer a water depth (`dPref` 0.45–0.7 m) near the banks, close
    under the surface: dark, shifting clouds over the light shallow bed, where fish are easiest to see from above.
  - **Big fish high.** Carp and chub cruise 0.1–0.45 m down; pike hold a lie at the margin, motionless for long
    spells (≥ 70 % of the time), glide slowly to a new lie every 40–90 s, and dart (3.6 m/s, 0.35 s) now and then
    — never into the bank — scattering the small fish round them.
  - **Leaps.** Salmon, sea trout, trout, mullet, carp and chub leap (per fish per minute 0.03–0.35): a fast swim up
    through the column, out on a ballistic arc (up to ~0.5 m for a salmon, low and long for a mullet, a twisting flop
    for a carp), back in nose first. A small splash and ripple going out, a bigger splash (the WakeTracker spray) and
    a ring going in, and a quiet splash sound (`ambient:fishjump` → `fish_splash`, ambience bus, ≥ 2 s apart).
  - **Nervous water.** A shoal riding high (rise ≥ 0.25 / min, within 40 cm of the surface) dimples the surface
    above it: a small ring every 0.25–0.75 s.
  - **Flash wave.** When a shoal wheels (a goal turn over 0.8 rad) or is startled, all its members flash their
    silver flanks within 0.35 s, front to back: the glint that gives a shoal away from above. The mirror flanks get
    the scene environment at 0.65 (was 0.3).
- **Feeding cues.**
  - **Flank flashes:** feeding fish roll 0.6–1 rad for about 0.35 s, turning the mirror flank to the sky. The rate
    is set per species, from herring at 10 per minute down to cod at 1.
  - **Surface rises:** trout and grayling take flies, and mullet and herring dimple the surface ("nervous water").
    The fish swims up to the surface film, and the director hands a faint ring to the water's ripple sim
    (`water.disturb`, normals only, at most 6 per frame). So a river shows its fish by their rise rings even where
    the bodies are too deep to see.
- **The M3 dam.** When a draining reservoir's dam is destroyed (`structure:destroyed` of a body's `drainOn`), the
  burst stuns up to 3 fish by the breach and scatters the rest. Fish left on dry bed as the reservoir drains leave the
  sim (stranded fish are never drawn); there are never fish in the breach's surge (it is not a water body).
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
| mallard (drakes and hens, half each) | Ponds, lakes, rivers slower than 1.1 m/s (M2–M4, M15, M17, M20) | A loose flock near the bank; they paddle, preen, rest, up-end to feed, and spring straight up off the water when flushed. See *Ducks*. |
| common eider (55 % drakes) | Northern seas and fjords (M1, M3, M7) | Rafts of 4–8 offshore; they dive for mussels, and run across the water to take off. See *Ducks*. |

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

## Ducks

User request: *"make the ducks more realistic (as seen in mission 1)"*. Before, they were the generic bird spindle
(117 triangles, two vertex colours per sex) sitting half sunk, paddling at a constant 0.28 m/s to random points
with an instant start and stop, overlapping, with a plain splash and the generic flee / land of the other birds.

- **Species and plumage** (`src/art/duck-model.js`). Common eiders on the Norway fjords and seas (M1), mallards on
  ponds and rivers. The plumage is painted per fragment from the rest-pose position and a pattern coordinate per part,
  so boundaries are crisp and follow the moving head, tail and wings, and fine barring fades out (fwidth) where it
  would alias at zoom 1.
  - Drake eider: white back and upper flanks, cream-pink breast, black flanks, belly, rump and tail, the white
    rear-flank spot, white head with a black cap and pale green nape, olive bill; in flight white forewing and back
    against black flight feathers.
  - Hen eider: warm rufous brown, densely barred dark; dark speculum between thin white bars.
  - Drake mallard: bottle-green head, white collar, chestnut breast, pale grey flanks, black rear, whitish tail,
    yellow bill. Hen mallard: scalloped buff-brown, dark crown and eye stripe, orange bill with a dark saddle. Both:
    the blue speculum bordered white.
- **Proportions and posture.** A lofted hull (~300 triangles with head, neck, tail and wings) whose origin is the
  waterline: ~45 % of the body depth rides under the surface. Broad back, full breast, short thick neck; the eider's
  wedge head (forehead straight into the bill), the mallard's round head and flat bill; tail flat on the water
  (eider) or cocked (mallard). Folded wings lie tucked in the flank feathers with the primaries crossed over the rump.
- **Swimming** (`src/world/duck-water.js`). Every duck rides a small wind-driven chop (two travelling wave
  trains: 3–16 mm heave, a few degrees of pitch and roll, neighbours out of step) and drifts with 2.5 % of the wind
  and the current. Activities: paddle to a spot round the flock centre (speed eased ≤ 0.3 m/s² with a surge on each
  ~1.8 Hz stroke, turns eased ≤ 0.9 rad/s), drift and look round (head saccades), preen (back, flank, breast, the
  bill working), rest with the head laid back, the wing-flap display (rise up, a few deep beats, settle), a tail wag
  after settling. Eiders dive for mussels in water over 1 m deep (a forward plunge with the tail flicked up, 8–17 s
  under water, surfacing 2–6 m on; ~15 % of the time under); mallards up-end (tail in the air). A diving duck is
  seen to go down (driving down at ~1 m/s): between 8 and 48 cm under the surface it darkens into the water (its colour goes to the deep
  water's near-black, which the water pass tints like the bed; only the last, nearly black stretch dissolves) and is
  only then left out; coming up it rises nose-up for 1 s, fading in the same way,
  the head breaks the surface with a ring of shed droplets, it shakes its head and tail and paddles off with a
  small wake. (User: *"In the duck video it feels like one duck appears out of nowhere"*: an eider surfacing was
  drawn all at once 26 cm under the surface.)
- **Flock.** One flock per plan entry; its centre wanders over open water within 8 m of home every 25–50 s (eiders
  off the shore); members keep ~1.5 body lengths apart (sideways sculling), stragglers paddle back.
- **Alarm and flush.** Someone moving inside 1.6 × the wary radius: necks up, heads to the danger, the flock swims off
  bunched. Inside the wary radius, or a gunshot / explosion / loud noise: the flock flushes, one way out (away from the
  danger, turned into a strong wind), each member after a 0.04–0.44 s startle. A diver under water hears nothing.
- **Take-off.** Eiders run across the surface for 1.1–1.6 s to ~7 m/s: wings at full beat slapping the water at the
  bottom of each downstroke, feet pattering left / right, the hull lifting out, a splash at the start. Mallards spring
  straight up (3.4 m/s). One `ambient:flush` per bird; the audio plays one flurry per flock.
- **Flight.** Steady fast beats, neck stretched forward; eiders 2–4 m over the water, mallards 5–9 m. The first bird
  up leads; the others hold slots off its heading (a line / loose V, 1.7 m back and 1.15 m out per rank), aiming
  where the slot will be.
- **Landing.** The leader swings round to come in from downwind 14 m out, then a long straight glide on set wings
  (a shallow V, small whiffling beats) down a 9° (eider) / 12° (mallard) path, braking beats over the last 3 m,
  and touches down 1.5 m short of the spot at 2.6–4 m/s: a **skid** along the water (spray every 0.05 s, the wings
  held up, then folded), then a tail wag. The others peel off and land beside it.
- **Wakes** (`src/art/duck-wake.js`). Every duck making way on the water leaves a trail of bow points (every 0.12 s
  or 0.3 m); each point's crest spreads sideways at v·tan 22°, so two arms open behind the duck, bend with its
  track and stay on the water when it stops (fading over 3.6 s). The crests are light (the sky's colour from the
  water's sky irradiance) with a darker trough inside, broken into short wavelets. At speed (run, skid) a dashed
  foam wash runs down the middle (the feet's splashes, left, right). One ribbon mesh on the late FX layer, after the
  water: no ripple-sim drops are spent (the boat wakes keep the 48 per frame). Paddling still drops a faint ring in
  the ripple sim now and then, take-offs and landings splash (`WakeTracker.splash`).
- **Sound** (`src/audio`). Quiet and rare, on the ambience bus, gated by *Nature sounds*: a drake eider's soft
  "ah-OOO" coo, a hen eider's low grunts, a mallard's falling quacks (each duck every 25–80 s, the audio skips any
  call within 5 s of the last), and one flurry of wings and splashes when a flock takes off. Synth recipes
  (`eider_coo`, `eider_grunt`, `quack`, `wing_flurry`), ~12 dB under a footstep at the same distance, heard within
  ~60 m of the view centre.

## Budget and performance

Per displayed frame, the director steps both sims on the sim-time delta, gathers threats from `world.entities`,
culls to the ortho view rectangle (the camera frustum projected onto y = −0.5, with birds shifted along the view
ray by their height), and uploads only the visible instances.

- **Draw calls:** one per fish species (up to 3), one for all bed shadows, one per bird species (up to 4), and one
  for all the duck wakes.
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

Visible fish (2026-10-11): the fish population went up (M1 175 → 539 fish: four herring schools, sprat shoals, sea
trout; a lowland lake ~70 → ~330 with minnows, roach, carp, pike), and stays cheap:
- **Simulation LOD.** The director passes its view rectangle to `FishSim.setFocus`; schools more than 12 m outside it
  are stepped at 5 Hz with the time they missed (alarmed schools always at full rate). Big shoals look at 14 members a
  step for their separation (a different stretch each step), not all of them.
- **One object shape** for every species (all optional keys filled, same order) and every fish (all fields set at
  spawn), and no allocation in the per-fish fright path: a mixed lake was 3× slower per fish with mixed shapes.
- **Render LOD.** Small shoal fish (sprat, sand smelt, minnows: 3–5 px long at zoom 1) use a 7 × 6-ring body (< 120
  triangles) instead of 12 × 8.
- Measured (node, loaded machine): a full lowland lake (331 fish, every school at full rate) 0.23 ms per 60 Hz step,
  vs 0.02 ms for master's 72 perch and trout; in the game most schools are off screen. The GPU test's director time
  for M1 (539 fish, sims + threats + culling + upload) is ~0.12 ms per frame.

Realistic ducks (M1, 8 eiders, measured on a heavily shared machine, so only the CPU figures are meaningful): the bird
sim went from 0.030 to 0.057 ms per 60 Hz step for 20 birds (node, M1-like plan: 8 eiders, 6 gulls, 6 crows); the wake
ribbons cost 0.05–0.08 ms per displayed frame with all 8 eiders making way (worst case; ~1.1k vertices, ≤ 2.5k
triangles, uploaded only when present); the director (sims, threats, culling, instance + wake upload) measured
0.21–0.29 ms against 0.07–0.22 ms before at zoom 1–2. GPU: an eider is 304 triangles (was 117) and the wakes are one
more draw call; frame time with the bird meshes shown / hidden stayed inside the ±5 ms noise of the shared GPU.

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
- `tests/unit/fish.test.mjs`: small shoals in the shallows near the banks, big fish high, leaps (out and in, clear of
  the water, never left in the air), pike lurking ≥ 70 % of the time and darting, nervous-water dimples, a swimmer
  scattering a minnow shoal, stranded fish out of the sim and not drawn, no fish in puddles, the M3 dam burst stunning
  fish (director), the cost of a full lake.
- `tests/fish-visible.test.mjs` (GPU): M1 fish plainly visible at zoom 1 (pixels changed by > 45 of 765 with the fish
  shown vs hidden: 986 vs 425 on master, must be > 700), species per theatre (M1, M2, M15, M12), leaps on M2, a swimmer scattering a
  shoal, the director cost.
- `node tools/perf/fishclip.mjs --mission=m01 --zoom=1 --secs=8 --fps=30 --out=<dir> [--sp=carp] [--vis=1]
  [--startle=blast|swim] [--leap=salmon@0.4] [--follow=0.05] [--calm=1]` records fish frames, a trace (leaps, the
  screen position of fish in the air, scared fish) and the visibility measure.
- `tests/unit/ducks.test.mjs`: the flock spawn and spacing, eased paddling and turns, activities (preen, dive /
  up-end, flap), riding the chop, alarm then flush, the eider's take-off run (distance, lift-off speed, splashes,
  wing slaps, foot patter), formation flight and the glide-in → skid → swim landings, mallards' up-ending and jump,
  determinism, the model (budget, span, folded wings on the body, divers hidden, plumage per sex), the V wakes and the
  sounds (rare calls, one flurry per flock, silent with Nature sounds off).
- `tests/ducks-m1.test.mjs` (GPU): M1 eiders drawn with drakes and hens, wakes on the late FX layer, a gunshot makes
  the flock run off and fly, director cost, no black frame.
- `node tools/perf/duckclip.mjs --mission=m01 --zoom=2 --secs=8 --fps=30 --out=<dir> [--startle=shot] [--follow=0.1]
  [--zoomTo=1@0.4] [--perf=1] [--lineup=1 --zoom=4 --dpr=2 --at=x:z]` records duck frames, a trace (with the sound
  events), the cost, or a frozen line-up of poses for model close-ups.
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
- **Only the ducks call.** Gulls and crows are silent (the theatre's bird bed covers them); ducks coo / grunt /
  quack now and then and a flushed flock makes one flurry (`ambient:call`, `ambient:flush`).
- **Ducks never leave the water.** They do not haul out on the shore ice or the rocks, so they never walk (no
  waddle; the model has no legs: the feet are under the water or tucked in flight). They stay 2 m inside the map
  edge (`env.bounds`).
- **Birds do not avoid buildings in flight.** Their flight bands, 3–15 m, clear most roofs, and they land only on
  piers, open water and open fields.
