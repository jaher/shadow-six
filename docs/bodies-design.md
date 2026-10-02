# SHADOW SIX: bodies design (blast physics, blood, drag & shoulder carry, buddy rescue)

**Status: BINDING** for branch `feat/bodies` (worktree `commandos-wt-bodies`). This document covers PROGRESS steps
**4x** (blast shock-wave physics) and **4y** (blood), plus the user request of 2026-09-27: *"We should be able to drag
buddies and also carry them on the shoulders when dragging them."* The implementation follows this file. Any change to a
rule here is made in this file first, with a short reason. Every number tagged [rec] is our own value. Each one lives in
exactly one `CONFIG` block (§0.4), so tuning never touches code.

Contents: §0 hard rules and rule layering · §1 module map and data flow · §A physics (4x) · §B blood (4y) ·
§C drag, shoulder carry and buddy rescue · §D save/load, performance budgets, options · §E tests · §F work order ·
§G open points.

---

## 0. Hard rules

### 0.1 BEL exactness
- The kill rules, damage and radii of BEL do not change. `world.explode()` decides every death and every hit point
  before physics runs. Physics and blood are a presentation layer on top.
- There is one exception. The **resting place of a body** is decided by physics (§A.4). It is fed back to gameplay:
  AI body discovery, carry targets, the deck-edge rule (§4.7) and the save file.
- Under the **Classic 1998 rules** preset (§0.3), gameplay matches the 1998 original exactly: only the Green Beret and
  the Spy can move bodies (by shoulder carry), any commando death fails the mission, and nobody drops a body when shot.
  `tests/unit/bel-lock.test.mjs` and every other BEL suite stay green when run under that preset.
- The guards react to **bodies, not blood** (§4.7). Blood, drag trails, smears and drips are visible only to the
  player. The one exception is footprints, which keep the existing §4.8 rules (§C.9).

### 0.2 Determinism
- The simulation stays deterministic at `CONFIG.sim.dt = 1/60`. Physics steps inside `Game.tick()` with the
  deterministic Rapier build (§A.1).
- Caps, sleeping and simulation "LOD" never depend on the camera **or on the graphics preset**. They depend only on
  simulation state, in entity-id order. The ragdoll and prop caps are one fixed set (`CONFIG.physics.gameplayCaps`:
  8 / 48); the preset only scales visual extras (debris). Only visual-only extras (glass shards, grass whip, cloth,
  drips) may be culled by the camera, and none of those extras feeds gameplay. A replay made on 'low' matches one
  made on 'ultra' (unit test `physics-determinism`).
- Without physics (WASM failure, `NULL_PHYSICS`) the mission plays with `physicsGameplay` off (set at mission start
  and saved): bodies stay where they died and cover stays put, like the 1998 rules.
- All randomness (spatter directions, pool noise, tumble spin) comes from `world.rng` streams keyed by entity id, and
  never from `Math.random`.

### 0.3 Rule layering: campaign ruleset + house rules
- `world.rules` stays the campaign ruleset (`CONFIG.rulesets.BEL | BCD`). It is **not edited**, because bel-lock pins
  every flag in it.
- A new layer, **`world.house`**, holds rules that are not in the 1998 original. The mission loader builds it from
  `CONFIG.houseRules.presets[name]` merged with the player's per-rule overrides. The preset is chosen in OPTIONS → GAME
  PREFERENCES → RULES (§D.3).

| House rule | `shadowSix` (default) | `classic1998` | Meaning |
|---|---|---|---|
| `dragBodies` | **on** | off | Every commando can DRAG a body (§C.2). Shoulder carry stays GB + Spy in every preset |
| `buddyRescue` | **on** | off | A commando at 0 HP is DOWNED instead of dead (§C.6). Comrades can drag, carry and revive him |
| `dropWhenShot` | **on** | off | A carrier or dragger who takes damage drops his load at once (§C.4) |
| `ragdollAllDeaths` | on | on | Every death ends in a short ragdoll settle on the terrain (§A.4) |
| `physicsGameplay` | **on** | off | A thrown / settled body's resting place, a toppled prop's nav / LOS footprint and a guard knocked off his feet (§A.5) count for gameplay. Off = the 1998 behaviour: physics is drawn but bodies keep their death spot, cover keeps its footprint, blast throws are a slump |
| `runningNoise` | **on** | off | Guards hear a commando running upright near them: a level-1 `footsteps` noise every 2.7 m, its radius by the surface underfoot (design-spec §4.4 "Running is heard"). Walking, crawling, swimming and a disguised Spy stay silent. Off = BEL: movement is silent |

- A house rule is read at mission load and stays fixed until the mission ends. The save file stores `world.house`, so
  loading a save restores the rules it was made with. Changing the option mid-mission takes effect at the next load or
  restart.
- A new ability (`drag`, `carryToggle`) declares `houseRule: 'dragBodies'`, and the revive branch of `firstAid`
  checks `house.buddyRescue`. `abilitiesForRole()` filters on
  it, so under `classic1998` the ability lists per role are identical to today's. bel-lock is extended (not weakened)
  with one case: "under `classic1998` the ability ids per role equal the pinned BEL list".
- `CONFIG.mission.failOnCommandoDeath` stays `true`. Buddy rescue does not touch that rule; it only delays death (§C.6).

### 0.4 Where the numbers live
- `CONFIG.physics`: the Rapier world, impulse model, ragdolls, props, vehicles and caps (§A).
- `CONFIG.blood`: causes, pools, surfaces, stains, trails and budgets (§B).
- `CONFIG.bodies`: drag, carry, transitions and the downed state (§C).
- `CONFIG.houseRules`: presets and labels (§0.3).
- The existing `CONFIG.abilities.carry` (`pick 1.0, drop 0.8, reach 1.2`) and `CONFIG.units.carry = 1.6` keep their
  spec values and stay authoritative for shoulder carry.

### 0.5 Compatibility with branches in flight
The public APIs used by other branches are only extended, never renamed:
- `c.carrying` (the load entity) keeps its meaning, and gains `c.carryMode ∈ {'shoulder','drag'}`.
- A transported unit keeps `state === 'carried'` and `carriedBy`, in both modes.
- `handTarget()`, `dropCarried()`, `Unit.takeDamage()` / `die()` and the `unit:killed` event keep their signatures.

What each branch provides or expects:
- **feat/phase3** (wind): the blast front calls `world.wind?.addImpulse?.(…)`, which is a no-op when absent (§A.8).
- **feat/crawl**: DOWNED uses its own stance `'downed'`, not `'crawl'`, so crawl tuning cannot change it.
- **feat/hud-icons**: new portrait glyphs `downed`, `carried`, `dragged`, `carrying`, `dragging` go through the icon
  set.
- **feat/missions**: new optional mission flags are `guest.cannotWalk` and `mission.houseRules` (forced overrides).
- **feat/clipping**: ragdolls and dragged bodies use the same occluder and cut-away materials as units.

Merge conflicts are resolved at merge time.

---

## 1. Module map and data flow

| Module | Layer | Role |
|---|---|---|
| `vendor/rapier/` | vendor | `@dimforge/rapier3d-deterministic-compat` (Apache-2.0), exact version pinned in `VERSION`, `LICENSE` copied, the WASM embedded in the compat JS (it works in node tests and in the browser with no fetch). Listed in CREDITS.md |
| `src/physics/world-physics.js` | sim | `createPhysics(world)` (async init at mission load), `step(dt)` inside `Game.tick`, static colliders, collision groups, caps, events, `serialize()`/`restore()` |
| `src/physics/blast.js` | sim | Blast impulse model (§A.3): falloff, occlusion, targets. Subscribes to the existing explosion event |
| `src/physics/ragdoll.js` | sim | Ragdoll builder (11 bodies, UAL skeleton), pose matching, settle detection, pose bake (§A.4) |
| `src/physics/props.js` | sim | Loose props as dormant → dynamic bodies, settle, nav re-stamp (§A.6) |
| `src/physics/vehicles.js` | sim + visual | Light-vehicle rock/flip; spring-damper rock for heavy vehicles (§A.7) |
| `src/render/blood/*.js` | visual | wounds, spatter, pools (flow sim), surfaces, stains, smears, footprints, drips (§B) |
| `src/abilities/bodies.js` | sim | the `drag` and `carryToggle` abilities; transport helpers used by `hand`/`drop`/`firstAid` in shared.js (§C) |
| `src/entities/downed.js` | sim | The DOWNED state machine for commandos (§C.6) |
| `src/art/unit-model.js`, `unit-anim-map.js` | visual | New clips (§C.10), ragdoll ↔ skeleton binding, stain uniforms |

**Tick order** in `Game.tick()` (fixed 1/60 s): commandos → enemies → BEL ticks → vehicles → projectiles →
interactables → **`world.physics.step(dt)`** (blast impulses queued this tick → Rapier step → settle checks →
`body:settled` / `prop:settled` events) → objectives → extraction → fx. Explosions queue their impulse in the tick in
which they happen. The ragdoll moves from the next step on.

**Events added**:
- `body:settled {unit, x, y, z}`
- `prop:settled {ent}`
- `unit:downed {unit, cause, source}`
- `unit:revived {unit, by}`
- `load:picked {carrier, load, mode}`
- `load:dropped {carrier, load, how: 'gentle'|'shot'|'died'}`
- `load:mode {carrier, mode}`

`render/fx.js` and `render/blood` listen to these. They never write simulation state.

---

## A. Physics (step 4x)

### A.1 Engine
- **Rapier 3D, deterministic compat build**, vendored (no CDN; offline). It has cross-platform bit determinism
  (IEEE-strict WASM). We set `integrationParameters.dt = CONFIG.sim.dt` and never use a variable step.
  `numSolverIterations = 4` [rec]. CCD is on for debris and helmets only.
- `createPhysics()` is awaited in `game.loadMission` next to `prepareMissionArt`. If the WASM fails to initialise,
  `world.physics` is a **null object**. Every call is a no-op, bodies use the canned death clip plus terrain conform, and
  a warning is logged. Gameplay is identical because the kill rules never depended on physics.
- Headless tests use the same module (node + compat WASM). Browser tests run it in the real renderer.

### A.2 Colliders and groups
Static colliders are built once per mission:
- **TERRAIN**: a heightfield from `world.groundY` sampled at 0.5 m [rec], clipped to the playable map.
- **STATIC**: cuboids from the building footprints and gameplay obstacles (grid blockers), walls, walkable roofs and
  decks (map-library walkables, at their height), bridge decks (`world.groundY` deck heights), stairs (as ramps), cliffs
  (from the mission cliff polygons), and pier obstacles.

| Group | Collides with |
|---|---|
| TERRAIN, STATIC | everything |
| RAGDOLL | TERRAIN, STATIC, PROP, VEHICLE (not other ragdolls: the pile-up cost is avoided; overlap is resolved by the settle nudge §A.4) |
| PROP | TERRAIN, STATIC, PROP, RAGDOLL, VEHICLE |
| VEHICLE (kinematic unless flipping) | TERRAIN, STATIC, PROP, RAGDOLL |
| DEBRIS / HELMET / WEAPON | TERRAIN, STATIC only |

Live units are **not** physics bodies. Each has a kinematic capsule (r 0.3, h 1.6) that only pushes PROP and RAGDOLL
bodies, so walking through a settled crate never blocks a unit. Unit movement stays grid-based.

### A.3 Blast impulse model
- **Input**: the explosion event already emitted by `world.explode(x, z, radius, amount, source, kind)`, plus the
  explosion class of spec §3.6. Every class gets a charge `Q` [rec], in the ratio grenade 1 : bomb (time/remote) 3 :
  explosive barrel 2 : fuel tank 4 : vehicle 2.5 : tank shell 1.5. The kill radius `R_k` is the radius already passed.
- **Reach**: `R_b = CONFIG.physics.blast.reachMul (2.5) × R_k`. Nothing outside `R_b` is touched.
- **Falloff**: peak impulse on a target of effective area `A` at distance `r`:
  `J(r) = J0 · Q · A / (1 + (r / r0)²)`, where `r0 = 0.35 · R_k` and `J0 = 900` [rec]. The result is clamped so that
  the resulting speed `Δv ≤ 11 m/s` (ragdoll) or `≤ 16 m/s` (props). *(Changed at implementation from 14 / 18: at 14 m/s
  a point-blank body left the game view; 11 still throws a man 6–8 m.)*
  - **Direction**: from the blast centre to the target centre, with a lift component
    `+0.35 · (1 − r/R_b)` in y, normalised.
  - **Angular kick**: `0.15 · |J| × lever arm` to the part hit, so bodies tumble.
- **Occlusion** (walls shield):
  - Cast 3 rays from `(x, 0.4, z)` to the target at heights 0.3, 1.0 and 1.6 m. Test them against STATIC colliders
    (Rapier `castRay`) and against `grid.lineOfSight` OCLU for the thin walls the colliders miss.
  - `occ = open rays / 3`. The impulse multiplier is `max(occ, 0.15)`: a wall still passes some diffracted pressure.
    Fully shielded targets inside `R_k` still die by the BEL rules, but their ragdoll barely moves.
  - The same occlusion factor scales the survivor stagger (§A.5), grass whip and snow blow-off.
- **Order**: targets are processed sorted by entity id. The impulse lands at the first physics step after the blast.
  Timing is not delayed by the shock-front speed for bodies, since the shock front passes 30 m in about 0.09 s.
  Visual-only responses (grass, trees, dust, water, glass) are delayed by the front `t = r / 340 m/s`.

### A.4 Ragdolls
- **Rig**: 11 bodies on the UAL skeleton that both character kits share: pelvis, spine/chest, head, upper and lower arm
  ×2, thigh ×2, shin ×2 (feet and hands follow their parents). Capsules sized from the skin's bone lengths. Total mass
  75 kg [rec], split by the Dempster ratios.
- **Joints**:
  - spherical joints with cone limits: neck 40°, shoulder 85°, hip 70°, spine 30°;
  - revolute joints with limits: knee 0…140°, elbow 0…145°;
  - light joint damping [rec], so limbs do not flail.
- **When**:
  - **Blast death** (the unit died from `kind === 'explosion'` and a blast impulse reached it): full ragdoll with the
    §A.3 impulse on the pelvis and chest.
  - **Any other death**, when `house.ragdollAllDeaths` is on: the death clip plays to its fall point (clip marker
    `ragdollAt`, default 70 %). Then the ragdoll takes over with the clip velocities and no impulse. This "settle"
    conforms the body to slopes, stairs, roof and deck edges.
  - **Survivors** never become full ragdolls (§A.5).
- **Pose matching**: at activation, each body gets the current world transform of its bone. Linear and angular
  velocities are finite differences over the last two animated frames. Blending from animation to ragdoll takes
  0.15 s. For the settle case, a PD pose-drive toward the dead pose fades from 40 % to 0 over 0.6 s, so a settled body
  looks like a man, not a pile.
- **Settle**: a ragdoll is settled when every body's `|v| < 0.05 m/s` and `|ω| < 0.2 rad/s` (thin limbs 0.6 rad/s) for
  0.5 s, or after a hard timeout of 6 s. *(Implementation: once pelvis and chest rest for 0.25 s the limbs get heavy
  damping, and one second later a limb still chattering against a joint limit on the heightfield no longer blocks the
  settle — the core bodies decide. Ragdoll bodies get 2 extra solver iterations.)* Then:
  1. **Bake the pose**: store 11 local quaternions (quantised 16-bit) plus the root transform on the unit
     (`unit.bodyPose`). Remove the rigid bodies. The model shows the baked pose from now on, with the `dead` clip
     frozen.
  2. **Feed back to gameplay**:
     - `unit.x/z` = the pelvis projected to the ground; `unit.y` = the ground or roof height there.
     - If that cell is not walkable (inside a building, blocker or deep water), the position is nudged to the nearest
       walkable cell within 1.5 m, and the visual pose is translated by the same offset over 0.3 s.
     - Bodies never end inside a building (spec §4.7).
     - A body in deep water is marked `sunk` (removed from perception, as today for drowned men).
  3. Emit `body:settled`. The AI sees the body at its final place. While in flight, the body is visible to perception
     at its current pelvis position, updated per tick.
- **Knock-loose items**: on a blast death, and on a survivor fall (§A.5) where the impulse > 60 % of the fall
  threshold:
  - the helmet or cap (and the weapon prop, for the dead) becomes a small dynamic body (group HELMET/WEAPON) thrown
    with the same impulse direction;
  - these are visual only;
  - BCD `droppedWeapon` pickups keep their gameplay position (the body position) and do not follow the prop.
- **Censored mode**: the ragdoll still runs, so the final position is identical, but the render shows the gravestone at
  the settled position once settled. No flying corpses are drawn: the body is hidden during flight and a dust puff marks
  the landing.

### A.5 Survivors: stagger and fall (visual only)
Units that are alive after the blast, within `R_b`, and with occluded impulse `J_eff` get a reaction based on the
speed it would give them (`J_eff / 75 kg`):

| `J_eff / 75 kg` | Reaction | Clip | Length |
|---|---|---|---|
| < 0.6 m/s | flinch: head duck, arms up | `hit` | 0.4 s |
| 0.6 … 2.5 m/s | stagger: 1–2 steps away from the blast | `knockback` | 0.8 s |
| ≥ 2.5 m/s | fall and get up | `knockback` → `blast_fall` → `stand_up` | 2.2 s |

- **Visual only.** The simulation position, state, cone and AI timers do not change. The model plays an animation
  override, and the visual root offset (≤ 0.6 m, along the impulse) blends back to the unit's position when the clip
  ends. This keeps BEL gameplay exact. The AI already reacts to the explosion noise by the existing rules.
- Commandos get the same visuals. A downed commando (§C.6) caught in a blast is already down: under BEL damage he
  takes damage and so dies. His body is thrown like a blast death.
- Crawling, swimming and seated units only flinch. Units in vehicles shake with the vehicle (§A.7).

### A.6 Loose props
- **Catalogue flag** `phys: {mass, shape: 'box'|'cyl'|'compound', fragile?: bool}` on props from building-props,
  dressing and interactables. It is given to: crates, non-explosive barrels, jerrycans, the top layer of sandbags,
  planks, fence sections, bicycles, carts, tables, chairs, buckets, laundry baskets, and debris chunks of destroyed
  structures (debris.js hands its chunks to physics when present).
- **Dormant** props have no rigid body. When a blast's `J_eff` on a prop exceeds its wake threshold (`0.8 m/s × mass`),
  the prop becomes a dynamic body with the impulse applied. A thrown prop can wake others by contact, since they are
  real bodies once awake.
- **Settle**: the same test as ragdolls (§A.4). Afterwards the body is removed (it becomes dormant again), and the
  final transform is stored in the entity and the save.
- **Navigation**:
  - Props under 0.6 m tall, or of mass under 20 kg, never touch the navigation grid.
  - Larger props (carts, tables, fence sections, stacked crates) had a gameplay footprint. It is cleared at wake and
    re-stamped at settle.
  - A re-stamp is refused on cells holding a unit, a door approach cell, ladder or climb links, or a bridge deck; the
    prop is nudged up to 1 m away, or else turned nav-neutral. So a blast can never trap a commando or block an
    objective path.
  - Tests pin this (§E).
- **Explosive barrels, fuel tanks and every gameplay interactable** keep their BEL behaviour. A carryable barrel
  (GB) that is thrown keeps its interactable semantics at its new position. A barrel that is hiding a body
  (`hidesBody`) is **not** made dynamic, because the original hiding rule wins.

### A.7 Vehicles
- **Light vehicles** (motorcycle and sidecar, Kübelwagen, Schwimmwagen, bicycle, cart):
  - Occupied or intact: visual rock only, as a roll/pitch spring-damper on the body mesh driven by the impulse
    (≤ 18°).
  - Destroyed by the blast (BEL damage rules decide that): the wreck becomes a dynamic body. It flips or rolls if the
    impulse is big enough, then settles; the wreck footprint is re-stamped as in §A.6.
  - An intact vehicle's gameplay state (position, occupants, drivable) never changes.
- **Heavy vehicles** (trucks, halftracks, tanks, the SdKfz): a suspension rock only (spring-damper, ≤ 5° roll, 0.8 s),
  plus a canvas-cover shake (cloth, handed to feat/phase3 wind if present).
- **Boats**: a heave and roll on the water, visual only.

### A.8 Doors, glass, vegetation, snow, dust, water (visual only)
Every response below is delayed by the shock front `t = r / 340 m/s` and scaled by occlusion:
- **Doors**: map-builder door nodes within `1.5 × R_k` swing open away from the blast. They use a damped hinge
  (in the code, not in Rapier), overshoot, and stay ajar. The gameplay door or hideout state does not change.
  Destroyed-variant swaps keep their existing rules.
- **Glass**: window panes within `1.8 × R_k`, found through the building's window-material tags, shatter. There are
  `glass_shards` VFX (debris.js, instanced, CCD off, 2 s life, camera-culled), a tinkle SFX, and the pane material
  swaps to a broken-frame variant. The pane stays broken for the rest of the mission and is saved as a list of pane ids.
- **Trees, bushes and grass**:
  - With feat/phase3: `world.wind.addImpulse({x, z, strength: Q·occ, radius: R_b, speed: 340})`. The WindField
    carries an outward ring front that bends canopies, whips grass and shakes leaves and pine snow loose.
  - Without feat/phase3: a fallback grass-only uniform ring in the terrain shader (the same front model).
- **Snow, dust and sand**:
  - On the ground: a radial blow-mark stamp (trails `crater` stamp + an outward `blast_streak` stamp added in
    `trails.js`).
  - Off roofs: `snow_blowoff` / `dust_blowoff` emitters along the roof edges facing the blast, within `R_b`.
  - Ground dust ring: the existing VFX shockwave ring, with the surface picked by the terrain material.
- **Water**: a ripple ring (`water.addRipple(x, z, amplitude, speed)`), plus a spray sheet if the blast is within 2 m
  of water. Stunned-fish floats belong to 4f.

### A.9 Caps, sleeping, LOD
- Rapier sleeping is on, and `step()` skips an empty island set.
- **Hard caps, deterministic, not camera-based**:

  | Cap | low | medium/high | ultra |
  |---|---|---|---|
  | Active ragdolls | 4 | 8 | 12 |
  | Active props | 24 | 48 | 64 |
  | Active debris / helmets / weapons | 32 | 64 | 96 |

  When over the cap, the lowest-priority candidate by (impulse ↓, entity id ↑) falls back:
  - a ragdoll falls back to the canned death clip plus terrain-conform IK;
  - a prop gets a scripted hop (a ballistic arc with no collisions, landing at a deterministic point that the §A.6
    rules clamp);
  - both results feed back to gameplay the same way.

  The caps come from the **quality preset** stored in `world.house.physicsTier` at mission load. That makes the tier
  part of the deterministic state: a save or replay made on "ultra" reproduces its results on "low" because the tier
  is loaded from the save.
- **Visual LOD only for non-gameplay parts**: glass shards, grass whip, and cloth or helmet spin beyond 80 m from the
  camera are culled or simplified. Bodies and props are never simulated differently by distance.
- **Budget**: `physics.step` ≤ **1.0 ms p95** on the high preset with 8 ragdolls + 48 props active (test machine), and
  ≤ 0.05 ms when idle (all asleep). WASM heap ≤ 32 MB.

### A.10 Save/load of physics
- **Nothing in flight**: the save stores only the settled results. These are `unit.bodyPose` (quantised pose + root),
  prop transforms plus their nav re-stamp, the broken pane list, open door angles, and wreck transforms.
- **Bodies still moving**: the save adds `physics.snapshot` = Rapier `world.takeSnapshot()` (base64). On load it is
  restored with `World.restoreSnapshot`, so the continuation is bit-identical. The static colliders are rebuilt the same
  way before restore. The snapshot is 150 to 600 KB and is only present while something moves. The save UI shows no
  difference.
- The mapping of rigid-body handles to entity ids and bones is saved with the snapshot.

### A.11 Implementation status (work order steps 4–6, commit "Bodies: physics")
Code: `src/physics/` (`world-physics`, `statics`, `ragdoll`, `ragdoll-template`, `blast`, `blast-apply`, `feedback`,
`props`, `persist`, `rapier-loader`, `null-physics`, `qmath`), `src/core/house-rules.js`, `src/art/ragdoll-pose.js`,
`src/render/physics-visuals.js`, `src/render/blast-marks.js` (+ `blast-mark-textures.js`), door/glass hooks in
`src/world/map-library.js`, VFX `glass_shards`. Tests: `tests/unit/physics-determinism|physics-rules.test.mjs`,
browser `tests/bodies-physics*.test.mjs`; screenshots `docs/screenshots/bodies-physics-*.jpg`.

- **Done as specified**: vendored deterministic Rapier (null object on failure, warm-up at load), heightfield + merged
  grid cuboids (loose-prop cells excluded), collision groups, kinematic unit capsules (only while something simulates,
  units within 5 m), blast model with 3-ray occlusion + grid LOS, lift and tumble kick, id-ordered targets, caps per
  tier with the (impulse ↓, id ↑) pick and a queue for bodies over the cap, settle + bake + gameplay feedback (nudge
  ≤ 1.5 m, 6 m fallback, never in a building, `sunk` in deep water, roof height), corpses thrown again from their baked
  pose, survivors' flinch / stagger / fall-and-get-up (visual only, ≤ 0.6 m lean), knock-loose enemy helmets (visual
  ballistic arc, not a Rapier body), loose props (wake, tumble, settle, nav re-stamp rules, nudge ≤ 1 m, else
  nav-neutral), vehicle rock (light ≤ 18°, heavy ≤ 5°, delayed by the front), library doors swing ajar, library window
  glass blown out + shards, `world.wind?.addImpulse`, censored path (hidden in flight, dust puff, graves), save/load
  (house layer + tier, pending settles, moved props, Rapier snapshot + handle maps while moving, marks, doors/glass
  restored from the marks).
- **Ground marks** (orchestrator request 2026-09-27): every explosion class leaves a mark sized by class
  (`CONFIG.physics.marks`): soft ground → a crater stamped into the terrain trail field (depression + ejecta berm,
  fades over the layer's trail life, ~40 min on snow) + a churned-earth decal with radial streaks and clods; hard
  floors (road, rock, decks, roofs, structures) → a ragged soot burst with spatter and chips; water → the existing
  water column only. Saved with the game.
- **Visual mapping** (instead of the PD drive): the model draws `bodyRot · spawnRot⁻¹ · base`, base = the character's
  idle pose for a blast (the ragdoll template is that pose) or, for a settle, the settled death clip (`dead` /
  `dead_prone`, its last frame, grounded on the root plane like the kit runtimes ground it): the settle ragdoll spawns
  lying supine 0.55 m behind the unit (measured on the UAL `die` clip end), which is that pose. *(Changed 2026-10-01,
  user: "bodies kind of floating above the ground when killed": the base used to be captured from the skeleton as
  drawn when the ragdoll took over — at 1.2 s the die → dead cross-fade is still running, so corpses froze half up,
  jack-knifed 0.2–0.5 m in the air or half sunk.)* What is on screen at the takeover (the end of the fall, a put-down)
  eases into the ragdoll's pose over 0.35 s. The live pose record keys its base exactly like the baked one (anchor,
  spawn rotations and pelvis rounded alike): a key that changed at the bake re-captured the base from the posed
  skeleton and applied the settle rotation twice — the body popped 0.2–0.8 m on the frame it settled.
- **Room to lie** (2026-10-01, user: "When you leave a body close to a rock it starts moving/jerking"): the colliders a
  settling body meets can be larger than what is drawn (a rock's STATIC cuboids are its nav footprint, a crate stack's
  PROP box its def size), and a settle ragdoll spawned inside one was shoved out every step — a 0.25–0.8 m slide, or a
  thrash to the 6 s timeout. A body put down or released (`dropSpot`) is laid where the lying pose starts inside no
  STATIC / PROP / VEHICLE collider (`PhysicsWorld.lyingFits`, a Rapier shape query), shifted aside before it is ever
  turned; any settle spawn without room still starts on the nearest spot with room (≤ 1.5 m, same heading) and the
  model glides there over 0.3 s (not for a man run over, who lies where the wheels caught him).
- **Blast fidelity (review fixes)**: a light vehicle wrecked by a close blast (Δv > `vehicles.flipDv` 3.5 m/s) is
  thrown onto its side, or its roof above 2× that, and stays there (`vehicle.blastFlip`, saved; visual); heavy and
  armoured vehicles only rock. Glass blows out **per pane**: each building glass mesh is split into its connected
  islands (one per window) with a per-vertex broken flag, panes facing away from the blast have 0.55× the reach, and
  each broken pane throws its own shard burst. The front lifts snow / dust off the roof edges facing it and off the
  open ground in a ring (`dust_kick`); without the wind system (feat/phase3) the grass is pressed flat radially
  (trail `flatten` stamps, not recorded). Palisade logs close to a blast are torn out and thrown, those further lean
  away (visual; the wall's nav / LOS footprint is unchanged). Crate stacks are 70 kg/m³ and tip / tumble (the upper
  face takes the impulse, ≤ 8 rad/s). On snow the bomb debris and the grenade column are white powder with a few
  jets of frozen soil, and the grenade crater is the carved bowl with dirty-snow ejecta plus a faint powder burn.
  Still open: the drag constraint ragdoll (part C uses the tow model, §C.2).
- **Tuned values** (all in `CONFIG.physics`): `J0 = 900`, Δv clamps 11 / 16 m/s (§A.3), crate stacks 70 kg/m³.
- **Measured** (this machine, node + Chrome WASM): 8 ragdolls ≈ 0.6–0.7 ms p50 / 1.0–1.3 ms p95 per step; 8 ragdolls +
  48 props ≈ 0.8 ms p50 / 1.9 ms p95 (over the 1.0 ms budget in that worst case); the blast tick itself costs ≈ 0.5 ms
  per new ragdoll and ≈ 0.15 ms per woken prop; idle 0 (nothing steps). Browser perf probe per preset:
  `node tests/run.mjs bodies-physics-perf`.

---

## B. Blood (step 4y)

### B.0 Principles
- **Gameplay-neutral.** Blood is a pure presentation system (`src/render/blood/`) driven by events: `unit:damaged`,
  `unit:killed`, `unit:downed`, `body:settled`, `load:*`, and the per-frame footfalls. It never writes simulation
  state. The guards react to bodies per the original (§4.7), never to blood.
- **Off switches**: the option BLOOD = off, or CENSORED MODE = on, gives **no blood at all**. That covers pools,
  spatter, stains, smears, drips, bloody prints, and the water cloud. Drag furrows (a terrain deformation) still stamp.
  Censored mode also shows gravestones instead of bodies (§A.4).
- **Realistic, not cartoonish**:
  - volumes and colours from forensic references;
  - no fountain gore and no dismemberment;
  - a muted saturation that matches the game's grade;
  - it reads at the game camera (about 25 m) and holds up at the closest zoom.

### B.1 Per-cause wounds
This table replaces the current `NO_BLOOD_CAUSE` set in fx.js. The user's 4y list is later than spec §4.7 and wins
over it for the harpoon and the bear trap. The **syringe stays bloodless**, as in the original.

| Cause | At the hit | Spatter | Pool volume [rec] | Notes |
|---|---|---|---|---|
| `shot` (pistol, rifle, sniper) | entry puff (fine mist, 0.15 s) at the hit bone | exit spatter cone (20°) along the shot direction: 3–8 droplet decals over 0.5–2.5 m | 0.8 L | projected onto ground, walls, vehicles and any unit in the cone (their stain slot, §B.4) |
| `smg`, `mg` (bursts) | one puff per hit | one cone per hit (≤ 3 per unit per 0.2 s) | 1.0 L | several wounds → several stain slots |
| `knife` | short arterial spurt: 3 pulses over 1.0 s, arcs of 0.3–0.9 m | pulse droplets | 1.5 L | stains on the victim's collar and chest and the attacker's knife hand and sleeve |
| `explosion` classes (grenade, bomb, barrel, shell, vehicle) | scattered spatter, radial, sparse | 6–14 droplet decals within 2 m of the body's path | 0.4 L | scorch dominates. The pool starts at the **settled** position (§A.4) |
| `harpoon` | entry wound with a small spurt | 2–4 droplets | 1.0 L | the harpoon prop stays in the body |
| `trap` (bear trap) | leg wound | droplets on the jaws + a stain on the trap mesh | 0.6 L | pool at the leg |
| `vehicle` run over | smear along the tyre path, 1.5 m | — | 0.6 L | a tyre-print smear decal |
| `syringe`, `injection`, `poison`, `chloroform`, `punch`/KO, `drown`, `electric`, `fire` | none | none | 0 | fire gives a charred tint on the body instead |
| non-lethal hit on a commando or enemy | puff + 1–3 droplets | small | 0 (a stain only) | a downed commando bleeds (§C.6) |

### B.2 Growing pools
- **Origin**: the wound bone's world position (pelvis or chest for most causes) projected to the ground under the
  **current** body position. It is re-anchored at `body:settled`.
- **Timing**: the pool starts 0.5–1.5 s after death. It grows for 20–60 s (by cause, larger for arterial). It stops
  when its volume is exhausted or when the body is moved (§B.5), and restarts with the remaining volume where the body
  is laid down.
- **Flow simulation** (CPU, deterministic from the unit id seed):
  - Each pool has a local 64 × 64 height and volume grid at 2.5 cm cells (1.6 m square, rotated to the slope).
  - Every step it takes the terrain height (`world.groundY` + the surface micro-height from its material height map)
    and moves liquid down the gradient (a virtual-pipe flow).
  - The surface absorbs liquid per §B.3. Noise-modulated edge tension gives lobed, natural edges.
  - Steepness pushes the pool downhill (an elongated tongue); flat ground gives a rounded pool.
  - Updates run at 10 Hz, round-robin with at most 4 pools per frame. A pool freezes (no more updates) once it stops.
- **Render**:
  - Each pool is a projected decal (`decalScene`, depth-tested; it wraps terrain and steps) that reads a
    thickness/coverage tile from a shared **R16F atlas** (2048², 32 × 32 tiles of 64²).
  - **Colour by age**:
    - fresh arterial red `#6e0a0a` (linear-ish);
    - after 2–4 min, dark maroon `#3a0605`;
    - after 10–15 min, dried brown `#2a1308`.
    - Thin edges dry first: an edge ring darkens and cracks slightly.
  - **Wetness**: roughness goes from 0.06 (fresh) to 0.75 (dry). Normals come from the thickness gradient, with a
    meniscus at the edge. Specular uses the scene environment (sky/HDRI or probe) with Schlick fresnel, so the pool
    reflects the sky and lights while it is wet, then turns matte.
  - **Water/rain**: a wet ground or rain (when present) dilutes the pool (lighter, wider, faster fade).

### B.3 Surface response
The surface comes from the terrain splat layer and material under the pool; roofs and decks give their material.

| Surface | Absorption | Look |
|---|---|---|
| **Snow** | high, diffusive | soaks in and diffuses. A darker saturated core; a **feathered pinkish-red bleed halo** (a second diffusion channel, 3× wider, low density); a grainy capillary spread (noise-driven anisotropic diffusion along the snow grain); a slight **melt depression** (a trail stamp `melt`, −1.5 cm, soft) under the core. It stays vivid ×4 longer (cold), with slower darkening and no cracking |
| Sand, dirt, gravel | high | absorbed dark matte patch with a small wet sheen for 30 s; gravel shows liquid between the stones (height map biases the flow) |
| Grass | medium | liquid runs to the soil below and **darkens the blades**: the grass shader samples a world-space **blood mask RT** (an R8 channel beside the trail RT) and tints them red-brown |
| Mud | medium | a darker, faint red film on the wet mud; a short life |
| Stone, pavement, cobbles, concrete, wood decks | low | a glossy pool that **follows cracks and joints** (the material height map lowers the joints and the flow fills them first); it dries into a dark crust |
| Metal (vehicle floors, ship decks) | none | a thin glossy film that beads |
| Ice (frozen ponds) | none | like stone but slow to dry, with a deeper red under the ice gloss |
| Water (swimmable) | — | no decal. A faint red dispersing cloud (a volume particle in the water pass: 12 s, drifting with the current) |

### B.4 Clothing stains
- The character shader (humanoid-real and charkit materials) gets a hook through `onBeforeCompile`. It holds **8 wound
  slots per unit**, `{boneIndex, localPos, radius, age, kind}`, as a uniform array filled by blood/stains.js.
- A stain spreads from about 2 cm to 6–14 cm over 30 s (by cause), soaking along the fabric. The fabric's albedo map
  luminance acts as a capillary noise. The stain darkens with age like the pools, and wet fabric gets a lower
  roughness for 2 min.
- **Entry and exit wounds** take one slot each. A knife attacker gets a hand and sleeve slot (a small spray).
  Spatter that hits a nearby unit (§B.1) adds a faint slot on it.
- **Budget**: 8 slots. The oldest and smallest slot is recycled, and slots are written only on events.

### B.5 Drag trails, smears, drips, bloody footprints
These are the parts of the blood system that connect to §C:
- **Drag furrow** (terrain deformation):
  - While `carryMode === 'drag'`, the heels trail a `drag` trail stamp every 0.25 m at the heel positions. On snow,
    sand and mud it is a furrow; on grass it is flattened grass.
  - This replaces today's rule, which stamps `drag` for **any** carry: `art/terrain.js:370` and
    `art/terrain/game-adapter.js:72`. Shoulder carry stamps no furrow.
  - Visual only: the AI does not follow furrows (spec §4.8).
- **Blood smear**: while a bleeding body (one with pool volume left, or a downed commando) is dragged, a smear-strip
  decal follows the torso contact point.
  - It is written into a world-space ribbon: a decal strip with a 0.18–0.35 m width that follows the terrain.
  - Its intensity is proportional to the remaining bleed rate and fades out as the volume runs down.
  - Smears on snow bleed with a halo, as in §B.3.
- **Drips**: a bleeding body on a shoulder drips 1 drop per 0.3–1.5 s (from the bleed rate), falling from the wound's
  position. The result is a small drop decal (2–4 cm, crown shape on hard ground, a soaked dot on snow).
  A downed commando being carried drips too.
- **Bloody footprints**:
  - A unit whose foot lands on a fresh pool (wet: age below 3 min, or 10 min on snow) gets `bloodyFeet = 6`.
  - Each following footfall stamps a boot-print decal with opacity `bloodyFeet / 6` and decrements the counter.
    It uses the existing walker-stamp positions and the boot-print mask.
  - This applies to commandos and enemies alike. It is visual only and invisible to the AI; the gameplay footprint
    list of §4.8 is unchanged.
- **Downed crawl**: a downed commando crawling (§C.6) leaves a smear, and a small pool where he stops.

### B.6 Budgets
| Element | low | high | ultra | Recycling |
|---|---|---|---|---|
| Pools (sim + decal) | 16 | 48 | 64 | oldest dry pool first; a recycled pool is baked into a static decal if the static-decal slots allow |
| Spatter / drip / print decals | 128 | 256 | 512 | oldest first |
| Smear ribbon length | 60 m | 200 m | 400 m | oldest segment first |
| Stain slots per unit | 4 | 8 | 8 | oldest and smallest |

- **CPU**: ≤ 0.3 ms per frame (pool sim plus decal upkeep).
- **GPU**: ≤ 0.4 ms at 1080p high (decals are one instanced draw per material class; the pool atlas is updated only
  for changed tiles).
- **Memory**: the pool atlas is 8 MB; the blood mask RT shares the trail RT resolution.

### B.7 Save/load of blood
- **Pools** are saved as `{id, unitId, x, z, rot, cause, surface, volumeLeft, age, seed, stopped}`. On load, each pool
  is **re-simulated deterministically** from the seed to its age. The capped fast-forward runs over several frames
  behind the loading screen.
- **Decals** (spatter, drips, prints) are saved as compact arrays `{kind, x, y, z, nx, ny, nz, size, rot, age}`,
  capped at the budget.
- Stain slots per unit, smear ribbons (polyline + widths + ages), and bloody-feet counters are saved too.
- Everything is optional on load. An old save without these fields loads without blood.

### B.8 Implementation status (work order step 7, commit "Bodies: blood")
Code: `src/render/blood/` — `model.js` (cause table, on/off switch, surfaces, colour/age curve, budgets + recycling,
bloody feet; pure), `pool-sim.js` (deterministic flow), `index.js` (`BloodSystem` = `world.blood`: events, bleeders,
records, transport, save/load), `layers.js` → `pools.js` (atlas + merged conforming mesh), `decals.js` (instanced
spatter / drips / prints / tyre smear, `textures.js` canvas atlas), `smears.js` (ribbon ring), `stains.js` (per-unit
material clones), `mask.js` (grass blood mask), `glsl.js` (shared colour curve + terrain-trail following). Hooks:
`Game` creates it after the blast marks, `update(dt)` in `Game.step` after fx, `frame()` in `Game.render`; `save.js`
field `blood`; terrain `trails.onStep` (bloody prints on the real footfalls), trail kind `melt`, grass `tBloodG`,
`stampWorld`/`stampUnits` furrow only for `carryMode === 'drag'` (`dragHeels()`), VFX `blood_cloud` (water).
Tests: `tests/unit/blood-model|blood-system.test.mjs`, browser `tests/bodies-blood*.test.mjs`; screenshots
`docs/screenshots/bodies-blood-snow-strip|snow-close|surfaces.jpg`.

- **Done as specified**: per-cause wounds (§B.1, syringe/KO/drown/electric/fire bloodless, harpoon + trap bleed per
  G1), exit spatter cones with wall hits and sprayed bystanders, knife spurt in 3 pulses + attacker sleeve/hand slots,
  sparse radial blast spatter (pool at the settled spot), run-over tyre smear; pools start 0.5–1.5 s after death,
  grow 20–60 s, stop when the body is moved and restart with the remaining volume where it is laid down, re-anchor at
  `body:settled`; flow sim = 64² cells of 2.5 cm (coarser for > 1 L), flux-limited 8-neighbour pipes, noise-modulated
  edge tension, slope tongue (tile rotated downhill), micro-height per surface (joints on paved floors, planks, gravel,
  snow grain), absorption to capacity, porous-medium capillary spread with patchy permeability; snow: fast soak, a
  vivid core with darker clots, fibrous edges along the grain, a faint pink halo channel (3× diffusion), a −1.5 cm melt
  dip (trail stamp), ×4 slower darkening, no cracks; colour by age (fresh → maroon → dried brown) and wetness
  (roughness 0.06 → 0.75, meniscus normals from the thickness gradient, thin edges dry first into a darker ring) lit by
  the sun, shadows and the sky environment; clothing stains (8 slots / 4 on low, spread over 30 s, glossy for 2 min);
  drag smears (streaky, breaking up as the bleed weakens, snow halo), shoulder drips (crown on hard floors, soaked dot
  on snow), bloody boot prints ×6 fading, downed-crawl smear via `unit:downed` / `unit:revived` (fires once part C
  lands); budgets per preset (medium between low and high); BLOOD off / CENSORED: nothing recorded, layers hidden;
  water: a dispersing red cloud, no decal; save = pools `(seed, age, stopAt)` re-simulated, decals / smears as compact
  arrays, stains, bleeders, bloody feet (old saves load without blood).
- **Additions**: blood geometry replays the terrain's trail displacement (pools, smears and drops lie IN footprints,
  furrows, craters and the melt dip); surfaces `road` (packed track: low absorption) and `paved` (raised floors, joint
  micro-height) besides `hard` (rock); a pool that is moved before it bled is dropped.
- **Deviations**: the pool atlas is RGBA8 512² (8 × 8 tiles, 64 pools = the ultra cap, 1 MB) instead of an R16F 2048²
  (8 MB): R liquid, G soaked, B halo, A ever wet. The halo reaches ~1.5–2× the core radius (a 1.6 m tile cannot hold
  3×; the halo channel diffuses 3× faster as specified). Spatter decal sizes are a little above forensic sizes so they
  read at the game camera. Wall spatter only on high walls (B.HIGH); vehicles take none.
- **Not done / open**: rain dilution (no rain yet); per-texel crack pattern of dried crusts (a darker dried ring only);
  bodies lying on library bridge decks use the deck height through `world.groundY`, other raised floors use the grid
  elevation.
- **Measured** (this machine, headless Chrome GPU, M1, 8 kills at once + growing pools; low / medium / high / ultra):
  blood CPU (tick + frame) mean 0.19 / 0.12 / 0.13 / 0.17 ms per frame, p95 0.3–0.4 ms at the 0.1 ms timer
  resolution (a frame that steps a snow pool: ≈ 0.1–0.15 ms per flow step + a 16 KB tile upload; stepping is capped
  at 4 pools / ≈ 0.2 ms per frame and catches up later without changing the result); render-time delta with the
  layers shown vs hidden 0.13 / 0.46 / 0.21 / −0.13 ms (mean, noise-level; empty layers are not drawn at all) on every
  preset. Probe: `node tests/run.mjs bodies-blood-perf`.

---

## C. Drag, shoulder carry and buddy rescue (new)

### C.1 Who can do what
| Transport | Who | Speed | House rule | Original? |
|---|---|---|---|---|
| **SHOULDER CARRY** (fireman's carry) | Green Beret, Spy, as in the original (§3.2 table, `items.canPickUp(role,'body')`) | **1.6 m/s** (`CONFIG.units.carry`), can't run | always | yes |
| **DRAG** (by the collar or under the arms, walking backwards) | all six commandos | **0.8 m/s** [rec] (`CONFIG.bodies.drag.speed`), can't run | `dragBodies` | **no**, labelled "not in the 1998 original" |
| Guests (McRae, the Informer, Gilbert; BCD Natasha and Skopje) | cannot transport anyone | — | — | — |

What can be moved:
- enemy bodies (dead);
- BCD knocked-out (`stunned`) and handcuffed (`bound`) men, as today (`world.rules.knockouts`);
- guests or prisoners who can't walk (mission flag `guest.cannotWalk`, or a guest who is DOWNED);
- **DOWNED commandos** (`buddyRescue`).

Dead commandos are not transport targets: their death already fails the mission (§C.6). Hidden bodies (under a barrel)
stay hidden, as today.

Common restrictions (spec §3.4 and §4.7, both modes):
- The transporter cannot run, crawl, climb (walls or ladders; `pathQuery` `noLinks`), swim or dive, enter buildings or
  hideouts, or board vehicles. The one exception is loading a downed buddy or a `cannotWalk` guest into a vehicle
  (§C.8).
- He cannot use any other ability; every other ability returns "Drop it first." as today.
- Shoulder carry lifts nothing heavier than a man (barrels keep the existing barrel carry).

### C.2 Drag
- **Grab**: H on a body (§C.5), approach to 1.2 m, then **1.0 s** `drag_grab`. He kneels at the head, hooks his hands
  under the armpits or grips the collar, and hauls the torso up about 35°. The body's state becomes `'carried'` and
  `carriedBy` is set (both unchanged API), `c.carrying = body` and `c.carryMode = 'drag'`.
- **Moving**: he walks **backwards** facing the body, using the existing `drag` clip (`moveDir -1`, groundSpeed 1.35
  scaled to 0.8 m/s by the LOCOMOTION rate rule). Idle uses the new `drag_idle`, a crouched hold with small breathing
  and re-grip motions.
  - Path following uses `heading = pathDir + π`. The turn rate is capped at 180°/s [rec], because turning with a load
    is slow, which also makes the body swing believably.
  - The body's **gameplay position** is kinematic and deterministic: `pelvis = dragger − 0.95 m · pathDir`, projected
    to the ground. So it rides the dragger's walkable path, with no physics dependency.
- **Body visuals**:
  - Physics tier available and under the ragdoll cap: the body is a **constrained ragdoll**. Spherical joints tie
    both upper-arm/chest points to kinematic anchors at the dragger's hand sockets, and the rest is limp. Ground
    friction 0.9 makes the heels trail and bump over steps, and the head lolls.
  - Fallback (cap reached, low tier or no physics): the authored `being_dragged` pose. The torso is pinned at the hand
    sockets, the pelvis follows on the ground, and 2-bone IK drops the legs to the terrain with a 0.4 s lag.
  - Either way the heels stamp the drag furrow (§B.5), and a bleeding body smears blood.
- **Release**: right-click (the existing drop), **0.6 s** `drag_release`. He lowers the shoulders to the ground and the
  body ends on its back, with a small settle. `load:dropped {how:'gentle'}`.

### C.3 Shoulder carry
- Pick up from the ground: H on a body, **1.0 s** (spec §3.2, unchanged). The clip is the new `lift_to_shoulder`: he
  squats, rolls the body across his shoulders (one arm through the legs, holding the wrist) and stands. It is authored
  at exactly 1.0 s. `c.carryMode = 'shoulder'`.
- **Moving**: `carry_walk` / `carry_idle` as today (1.6 m/s, `CONFIG.units.carry`). The body is attached by the
  existing `carried` pose (pivot on the pelvis) at the shoulder socket, and bleeding bodies drip (§B.5).
- **Legs (carry-legs fix)**: the carrier's / dragger's clip is chosen once per state (`Commando._holdAnim`, asked by
  `Unit._updateAnim`) so the gait plays at speed; before, walk and carry_walk swapped every tick, which restarted the
  mixer and froze his legs mid-stride. The load's limbs swing with each of his steps (`art/carry-gait.js` springs,
  `loadGait` in art/transport-contact.js): shins and arms over the shoulder swing fore and aft, a dragged man's legs
  wiggle and his knees bump at every tug. The hold pose's 35° torso pitch tipped his legs ~0.45 m into the ground;
  `groundDraggedLegs` now swings each leg back up by two-bone IK so the ankle trails 0.08 m above the terrain (any
  depth; keeping the pose's / the knee bump's reach and sideways swing), a rise followed at once, a dip settled into
  over ~0.4 s, eased in / out over grab, toDrag, release and toShoulder (`dragGroundWeight`); through the rest of any
  lift / lower an ankle is only kept out of the snow. In a transition the ground level is the transporter's: lowered
  from the shoulder (toDrag) the load's own y is still the 1.2 m carry height, which aimed the heels (and the drag end
  key's pelvis) 1.2 m up: his legs kicked out at the carrier's chest and snapped down when the lower ended. Lowered
  into the drag his ankles now stay -0.003 to +0.07 m on the snow (bodies-dragcarry `lowerHeels`); frames:
  docs/screenshots/carry-legs-lower-to-drag.jpg. Standing still, the
  springs settle; only the `carried` clip's slight sway remains. Before/after: docs/screenshots/carry-legs-before-after.jpg;
  dragged legs side / front: docs/screenshots/carry-legs-drag-heels.jpg.
- **Put down gently**: right-click, **0.8 s** (spec §3.3, unchanged), with the new `put_down` clip. He kneels, the body
  slides off to lie on its side or back, and a small settle follows.

### C.4 Switching, and dropping when hit
- **Drag → shoulder** (GB and Spy only): press H again, or use the "Lift" button while dragging. This takes **1.0 s**
  (`drag_to_shoulder`, the lift from a half-raised torso). The body stays `'carried'` throughout. Other roles see the
  button greyed out with the tooltip "Only the Green Beret and the Spy can shoulder a man."
- **Shoulder → drag**: Shift+H or the "Drag" button while carrying. This takes **0.8 s** (`shoulder_to_drag`: lower to
  the ground, take the collar). It is useful for keeping a low profile under a slope or roof edge. The dragger's body
  and silhouette stay standing, which is how the original treats a carrier; drag gives no stealth bonus.
- **Drop when shot** (`dropWhenShot`): if the transporter takes damage (`unit:damaged`, any cause, amount > 0) he
  drops the load at once:
  - A body on his shoulder falls as a ragdoll from about 1.4 m, with a small impulse along the hit direction. Its
    gameplay position is where it lands, clamped as in §A.4. A dragged body just drops.
  - He plays `hit` and loses the transport. `load:dropped {how:'shot'}`. A downed buddy who is dropped is not
    re-damaged by the fall.
  - Under `classic1998` nothing drops, as in the original (he keeps carrying).
- **Transporter dies or goes down**: the load drops at once (as today in `Commando.die`), and the same happens when he
  becomes DOWNED.
- **The load wakes up** (BCD knock-out timer) while carried or dragged: dropped at once, then the existing
  bcd-reactions rules apply. A bound man stays bound.

### C.5 Controls, cursors, UI
- **H** (the `hand` ability, unchanged id and key) on a transportable target:
  - GB or Spy: **shoulder carry**.
  - Anyone else: **drag** if `dragBodies` is on, otherwise the existing "Can't carry bodies." refusal.
- **Shift+H**: the new `drag` ability (`hotkey: null` in the BEL map; a separate rebindable binding `dragBody =
  Shift+H` in `KEY_BINDINGS`). It arms the hand cursor in **drag mode** for any role, so the GB and the Spy can choose to
  drag. Once armed, the mode is latched, so a plain click picks the target. Shift-click stays the cone/probe tool when
  nothing is armed. The rebinding UI's conflict swap covers it.
- **While transporting**:
  - **H** = lift to shoulder (if able);
  - **Shift+H** = lower to drag;
  - **right-click** = put down gently (the existing `drop` semantics, first match in `Commando.cancel`);
  - move clicks move him;
  - a double-click (run) walks, as in spec §3.2 heavy loads.
- **Cursors** (cursor-sprites): `hand` stays the carry cursor, animated as a grab over a valid target. A new
  `hand_drag` sprite (two hands pulling a collar) appears over a target when the result would be a drag. The target
  itself shows a highlight ring, as today. Invalid targets show the existing forbidden overlay.
- **Action bar**:
  - While transporting, a context button pair appears: **Lift** (shoulder icon) or **Drag** (collar icon), and
    **Put down**.
  - Tooltips show the key and the speed ("Drag — 0.8 m/s, walks backwards").
  - Non-original abilities get a small ✦ badge. The tooltip line "Not in the 1998 original" is shown only under the
    `shadowSix` preset.
- **Portraits** (feat/hud-icons glyphs):
  - the transporter shows `carrying` or `dragging`;
  - a carried or dragged downed buddy shows `carried` or `dragged` over his DOWNED state (§C.7).
- **Tips** (ui/tips.js): "Any commando can drag a body. Only the Green Beret and the Spy can carry one on their
  shoulders." "Drop a body before you are seen: guards react to a man moving a body at once."

### C.6 Buddy rescue: the DOWNED state (`buddyRescue`)
- **Entry**: `Unit.takeDamage()` on a commando or guest whose hp would reach 0. If `world.house.buddyRescue` is on and
  the hit is **downable**, the unit becomes DOWNED instead of calling `die()`. Otherwise it dies exactly as today.
  - A hit is **not downable**, so he dies at once as in the original, when:
    - the cause is `drown`, `crush`/`vehicle` (run over), `train` or `fall`;
    - it is an explosion with the victim within `0.5 × R_k` of the centre;
    - the overkill is large (`amount − hpBefore > CONFIG.bodies.downed.overkillMax`, 60 [rec]; tank shells, point-blank
      MG);
    - it is any hit on an **already DOWNED** unit (§C.6 bleed-out and finishing).
- **State**:
  - `unit.downed = {t: bleedOut, cause, source, since}`, `state = 'downed'` (a new `UNIT_STATES` entry, immobile unless
    ordered to crawl), `alive` stays **true**, `hp = 0`, and the stance is `'downed'`.
  - The `unit:downed` event fires. Any action in progress is cancelled, the load drops (§C.4), and the selection stays
    possible.
- **Bleed-out timer**: `CONFIG.bodies.downed.bleedOut = 60 s` [rec], shown on his portrait (§C.7).
  - It keeps running while he is carried, dragged or revived.
  - It does **not** pause in active pause beyond normal sim time (it is sim time).
  - When it reaches 0 he dies: `die(downed.cause, downed.source)`.
- **What he can do**:
  - Every ability is refused ("He's down."). `freeToAct` gains the DOWNED check, and the `hand`, `drag`, `firstAid`
    and `revive` abilities cannot be used **by** him.
  - A move order makes him **crawl** at `CONFIG.bodies.downed.crawlSpeed = 0.3 m/s` [rec] using `downed_crawl`. It
    uses the normal prone path rules and leaves a smear (§B.5). With no order he lies still (`downed_idle`: breathing,
    a hand on the wound, head movement, so the player can tell he is alive).
  - He cannot self-heal, even if he is a medic.
- **Visibility and the AI**:
  - A DOWNED commando is a **low target**: the prone LOS rules (`B.LOW`) and the deck-edge rule apply.
  - A guard who sees him takes it as a **body found** (BODY state §4.6: alarm through the zone, the patrol rule of
    §4.7). The guard also marks him as an attack target: a guard in ATTACK or ALARM with a line of fire **shoots him**.
    Any hit kills (the downed rule above), and the mission fails.
  - Guards never carry or capture downed commandos.
  - A carried or dragged downed buddy is `'carried'` (hidden from perception, as today). The guards see the
    transporter carrying a body (§C.9).
- **Revive**: a branch of the existing `firstAid` ability (K; the medic roles of spec §3.3: Driver, Spy, Sniper; it
  needs a `firstAid` dose). Target: a DOWNED commando or guest within `CONFIG.abilities.firstAid.range` (1.2 m).
  - It takes **4.0 s** [rec] (`revive_give` + `revive_receive`, both kneeling) and consumes **1 dose** (the existing
    6-dose kit).
  - The downed man comes back to **34 HP** (one dose, `firstAid.heal`), then `stand_up` (1.2 s) to `state 'active'`.
  - `unit:revived` fires, and his pool and smear stop bleeding.
  - Being hit during a revive cancels it and the dose is not spent. A revived man can be healed further with normal
    K doses.
- **No new ability id for the revive.** K (`firstAid`) on a downed man does the revive: `firstAid` gains a
  downed-target branch, gated on `house.buddyRescue`. So the key and cursor stay K and the syringe cursor, and
  bel-lock's key map is unchanged. Its canUse "Pick a wounded commando" accepts DOWNED targets when `buddyRescue` is on.
- **No medic or no doses left**: the downed man can still be carried to the exit (§C.8). When nobody can revive him,
  the HUD message warns: "No first aid left — get Tiny out!"

### C.7 HUD, voice and messages for a downed man
- **Portrait**:
  - desaturated, with a red pulsing frame (1 Hz, 2 Hz under 15 s);
  - a **bleed-out ring** plus seconds counter over the face;
  - a `downed` glyph, plus the `carried` / `dragged` glyph while transported;
  - a green `revive` progress ring during the revive.
  Clicking the portrait selects him and centres the camera, as today; the double-click jump works.
- **Barks** (bark-lines.js, subtitles on; censored mode uses the clean line set):
  - on `unit:downed`, the **nearest other commando within 40 m** (else the selected one) calls "Man down!" or a
    variant with the name ("Tiny's hit!");
  - the downed man groans (a pain loop, sparse);
  - revived: "Thanks, mate." / "Back on my feet.";
  - at 15 s left, one "Hurry, he's fading!".
  - Lines per character voice (the audio manifest); missing lines fall back to a generic take.
- **Message line**: "TINY IS DOWN — 60 s" (kind `alert`), "TINY REVIVED", "TINY BLED OUT".
- **Sound**: a heartbeat loop that gets faster under 15 s while he is selected or on screen.
- **Minimap/overview**: a pulsing red dot for downed men.

### C.8 Mission flow
- **Death is still failure**: bleed-out, a finishing hit, or a non-downable hit → `die()` → `failOnCommandoDeath` → the
  §8.1 "ONE OR MORE OF YOUR MEN DIED…" loss after the 5 s grace. This is the original rule.
- **Nobody left to act**: if every commando is DOWNED, captured or jailed, and no guest can act, the mission fails at
  once with "NOBODY LEFT TO HELP" (the same loss code `died`). This saves the player a 60 s wait.
- **Extraction**:
  - A DOWNED commando, or a `cannotWalk` guest, counts as **present** in an exit zone when he lies in it or is carried
    or dragged into it.
  - For a vehicle extraction, the transporter can **load him into the vehicle** with the `board` cursor while
    transporting: 1.5 s [rec], a free seat is needed, the load becomes an occupant (`state 'inVehicle'`), and the
    transporter stays outside. This exception applies only to downed buddies and `cannotWalk` guests; bodies still
    cannot be taken into vehicles.
  - A mission can be won with men still downed. The debrief shows "WOUNDED" on their line, but the rank and medal
    rules do not change.
- **Guests** are covered by the same rules: they go DOWNED, and a guest's death fails the mission as before. Guests
  who `cannotWalk` are a mission-data state (not bleeding, no timer) that only transport or the vehicle load moves.

### C.9 AI reactions to moving bodies
- **The original's rule applies to both modes**: seeing a commando who is carrying **or dragging** a body gives
  `N = 1000` at once (`enemy-brain.js` checks `c.carrying`, which stays set in drag mode), so an immediate CHALLENGE.
  The disguised Spy is unmasked (`suspiciousAct(world, c, 'carry')`) when seen dragging, as when carrying.
- A transported body (either mode) is `'carried'`, so it is removed from BODY discovery while moving. The guard reacts
  to the man, as the original does.
- **Footprints**: the transporter stamps his normal gameplay prints on snow and sand (§4.8, walking backwards in drag
  mode, with the heading reversed). Drag furrows, smears and blood are visual only; the AI ignores them.
- A downed buddy being revived is seen as a downed commando (§C.6) plus a commando kneeling beside him. The normal
  nervousness rules apply to the medic.

### C.10 Animations
New clips are project-authored keyed poses on the UAL skeleton (CC0, `poses.js`, like `carry_walk`/`carried`), so
both kits (commandos_a/b, enemies, guests) share them. Every clip is added to `unit-anim-map.js` (the gameplay name →
candidates list) with fallbacks, so a missing clip never breaks.

| Gameplay name | Clip | Length / speed | Fallback | Notes |
|---|---|---|---|---|
| `drag_grab` | new | 1.0 s | `pickup` | kneel at the head, hook the armpits, haul |
| `drag_walk` | existing `drag` | 1.35 → 0.8 m/s (`LOCOMOTION`) | `walk` reversed | feet planted, `moveDir −1` |
| `drag_idle` | new | loop 2.0 s | `crouch_idle` | crouched hold, re-grip |
| `drag_release` | new | 0.6 s | `plant` | |
| `lift_to_shoulder` | new | 1.0 s (spec pick-up time) | `pickup` | squat, roll on, stand |
| `drag_to_shoulder` | new | 1.0 s | `lift_to_shoulder` | from the half-raised torso |
| `shoulder_to_drag` | new | 0.8 s | `put_down` | |
| `carry_walk` / `carry_idle` | existing | 1.6 m/s | — | fireman's carry |
| `put_down` | new | 0.8 s (spec drop time) | `plant` | kneel, body slides off |
| `being_dragged` | new pose | loop | `dead` + IK | torso up about 35°, arms up, head lolled, heels on the ground; replaced by the drag ragdoll when active |
| `being_carried` | existing `carried` | loop | `dead` | pivot on the pelvis |
| `downed_fall` | new | 0.9 s | `die` (cut at 70 %) | collapse, alive |
| `downed_idle` | new | loop 3.0 s | `crawl_idle` | breathing, a hand on the wound, head lifts |
| `downed_crawl` | new | 0.3 m/s | `crawl` at 0.33× | one-arm pull, a leg dragging |
| `revive_give` | new | 4.0 s | `use` | kneel, bandage, dose |
| `revive_receive` | new | 4.0 s | `downed_idle` | |
| `stand_up` | existing | 1.2 s | `idle` | after the revive |
| `blast_fall` | new | 0.8 s | `knockback` | survivor fall (§A.5) |

- **Sync**: transitions (grab, lift, put-down) drive **both** skeletons from one paired clip. A pair such as
  `lift_to_shoulder` + `lifted_to_shoulder` is authored against a shared root, and the load's root is pinned to the
  transporter's socket track during the clip.
- **Hands**: the carrier's weapon is holstered (`weaponFor` → `false` during transport).

### C.11 How bodies, blood and physics work together
| Situation | Physics | Blood | Terrain |
|---|---|---|---|
| Blast death | full ragdoll → settle → gameplay position | sparse spatter along the flight; the pool starts at the settled spot | scorch/blow mark |
| Other death | death clip → small settle (`ragdollAllDeaths`) | cause wounds (§B.1); the pool at the settled wound | — |
| Dragging a bleeding body | constrained ragdoll or IK pose | **smear ribbon**, the pool pauses and restarts where released | heel furrow |
| Shoulder carry of a bleeding body | attached pose | **drips** | normal prints only |
| Dropped when shot | ragdoll fall from the shoulder | a new pool at the landing spot | — |
| Downed commando | — (alive, animated) | wound stain, a growing pool while still, smear while crawling or dragged, drips while carried | crawl furrow |
| Revive | — | bleeding stops (the pool freezes and dries) | — |
| Anyone steps in a fresh pool | — | bloody prints ×6 | normal prints |
| Censored or blood off | unchanged | none | furrows only |

### C.12 Implementation status (work order steps 1–3, commit "Bodies: dragcarry")
Code: `src/abilities/bodies.js` (`drag`, `carryToggle`, transport helpers `isTransportable` / `findLoad` / `transportMode` /
`takeLoad` / `liftHint`), `hand` / `drop` / `firstAid` in `shared.js` (routing, put-down / release timing, the revive
branch + `resume`), `enterVehicle` in `drive.js` (loading a downed man), `common.dropCarried(c, how)` (drag spot,
`load:dropped`), `src/entities/downed.js` (DOWNED state machine, barks, "nobody left"), `Commando` (`carryMode`,
`carryTransition`, `downed`, `cannotWalk`, `_placeDragged`, `takeDamage` → drop when hit / downed / finishing hit,
`moveHeadingOffset` / `moveTurnRate`), `Unit` (`'downed'` state + stance, crawl speed, anim names), the registry's
`houseRule` / `houseRoles` gating (`abilitiesForRole(role, campaign, house)`), AI (`enemy-brain._onCommandoSeen`:
a seen downed man = body alarm + COMBAT), `game._lossCondition` ("NOBODY LEFT TO HELP"), input (`KEY_BINDINGS.dragBody`
with `SHIFT_BINDINGS`, `def.redirect`, `def.cursorFor`), UI (`hand_drag` cursor, Lift / Drag / Put down buttons with the
✦ badge, portrait glyphs + bleed-out / revive rings + seconds, alert line, minimap pulse, tips, OPTIONS → GAME
PREFERENCES → RULES), audio (rescue lines + rules, heartbeat loop, carry / drop sounds), save fields. Animations:
`src/art/body-clips.js` (derived clips spliced from each kit's own UAL clips at load, all four kits), `unit-anim-map`
entries with fallbacks, `src/art/transport-pose.js` (the load's placement, blended through every transition),
`unit-model` (`forceMixerWrite`, hands empty while transporting). Physics: a body picked up ends its settle ragdoll; a
body knocked off a shoulder falls as a ragdoll from ~1.1 m with the hit direction. Tests: `tests/unit/bodies-drag|
bodies-downed|bodies-ai|bodies-rules|bodies-save.test.mjs` + a classic1998 case in `bel-lock`; browser
`tests/bodies-dragcarry.test.mjs`, `bodies-dragcarry-downed.test.mjs`, `bodies-dragcarry-perf.test.mjs`; screenshots
`docs/screenshots/bodies-dragcarry-*.jpg`.

- **Done as specified**: the rule layer and both presets; every commando drags (0.8 m/s, backwards, no run, 180°/s turn
  cap, no links / swimming / buildings / vehicles, "Drop it first."), GB + Spy shoulder (spec 1.0 / 0.8 s); H / Shift+H
  switching (1.0 / 0.8 s) with the refusal text; the body 0.95 m behind the dragger on walkable ground; drop when hit
  (flag on/off); a waking BCD knock-out is dropped, a cuffed man stays bound; guards react to a dragger exactly as to a
  carrier (N = 20·T, Spy unmasked); DOWNED with every non-downable case, 60 s bleed-out, crawl 0.3 m/s, abilities
  refused, K revive (4 s, one dose, 34 HP, get-up 1.2 s, cancelled by a hit on the medic, resumed after a load), the
  finishing hit, "nobody left to help", the exit zone counting a carried downed man, loading him into a vehicle (1.5 s,
  never the driver), guests downed too, `cannotWalk` guests; save/load of every new field (transitions resolve, old
  saves load, a non-GB/Spy carrier becomes a drag).
- **Animations**: the §C.10 clips are built at library load from the kit's own clips (layers of source clips per bone
  set with time maps and weight ramps; left arms mirrored from the right with the UAL twin sign pattern `[1, −1, −1]`):
  `drag_walk` (backwards walk + bent back + the hold's arms), `drag_idle`, `drag_grab`, `drag_release`,
  `lift_to_shoulder`, `drag_to_shoulder`, `shoulder_to_drag`, `put_down`, `being_dragged` (the lying pose, both arms up
  past the head, head lolling), `downed_fall`, `downed_idle`, `downed_crawl` (a limp right leg, one-armed pull),
  `revive_give`; `revive_receive` = `downed_idle`; the revived man gets up with `get_up` (prone). The load follows the
  transporter's clip in step (`pendingLift` / `carryTransition` progress): its placement is blended in yaw and tilt
  separately (no tumbling), with a small lift arc; the dragged body's torso is raised 35° about the pelvis, the pelvis
  at the gameplay position and the chest pulled under the dragger's hands.
- **Deviations**: DOWNED lies PRONE (like the design's crawl fallbacks) — a supine idle would flip on every crawl
  order. The drag ragdoll constraint (§C.2 first bullet) is not built: every tier uses the authored `being_dragged`
  pose, with the heels grounded by two-bone IK (`groundDraggedLegs`: each leg swung up so the ankle trails 0.08 m above the terrain; a dip eased over ~0.4 s). The shouldered body's ragdoll
  fall is started from a lying template raised ~1.1 m (the settle template), not from the carried pose.
- **Not done / open**: the briefing notebook does not yet print a mission's forced house rules; no voice pack for the
  rescue lines (synth + subtitles); no minimap tooltip for the downed dot.
- **Measured** (this machine, headless Chrome GPU, M1, a drag + a shoulder carry + a downed crawl at once; low / medium
  / high / ultra): CPU of the three transported men's model updates 0.28 / 0.31 / 0.31 / 0.28 ms mean, p95 0.4–0.5 ms;
  frame (render + gl.finish) p95 1.7 / 3.9 / 4.5 / 3.8 ms moving vs 1.6 / 3.6 / 4.5 / 3.4 ms standing still (within
  the 6–9 ms high budget). Probe: `node tests/run.mjs bodies-dragcarry-perf`.

---

## D. Save/load, performance budgets, options

### D.1 Save (src/save.js, `SAVE_VERSION` stays 1; every new field is optional)
- `world.house`: the preset name and the resolved flags, plus `physicsTier`.
- Per commando: `carrying` (id, existing), `carryMode`, the transition in progress `{kind, t}`, `downed {t, cause,
  sourceId, since}`, `bloodyFeet`, and stain slots.
  - Loading **resumes** a transition in progress (grab, lift, lower, put-down, release, revive) with its elapsed time
    (`timedTask({t0})` + `def.resume`; the drag trail is saved too), so the continuation equals the uninterrupted run
    (unit test `bodies-save`); an old save without the resumable action resolves it to its end state (the revive
    was already resumed with its remaining time).
- Per unit body: `bodyPose` (§A.4), `settled`.
- Physics: settled props, wrecks, panes and doors, plus the snapshot when anything moves (§A.10).
- Blood: §B.7.
- **Compatibility**: old saves load with the house rules of the **current preset** (`dragBodies` etc.). A body saved
  as `carried` by a non-GB/Spy is a drag.

### D.2 Performance budgets (high preset, the reference test machine, the M9 or M14 load)
| System | CPU p95 | GPU | Memory |
|---|---|---|---|
| Physics step (8 ragdolls + 48 props active) | ≤ 1.5 ms (1.0 before CCD on blast ragdolls / props) | — | WASM ≤ 32 MB |
| Worst single physics tick (three blasts at once) | ≤ 12 ms | — | — |
| Save: packed Rapier snapshot while anything moves | — | — | M1 ≈ 83 K chars, M3 ≈ 130 K chars (was 418 K / 737 K) |
| Physics idle | ≤ 0.05 ms | — | — |
| Blood (pools + decals + stains) | ≤ 0.3 ms | ≤ 0.4 ms | atlas 8 MB |
| Drag ragdoll (constraint) | counted in the ragdoll cap | — | — |

`tests/render-frames` must stay within the current frame budget (the high preset at 6–9 ms per frame).

Measured by `tests/bodies-physics-perf` (HIGH, 1920×1080, 60 live enemies with AI on screen, three grenades at once;
frame = the sim ticks of one displayed frame + one render + gl.finish): physics p95 ≈ 1.2 ms, worst tick ≈ 6 ms, the
blasts add ≈ 2–4 ms to the frame p95. The absolute 16.6 ms target is **not met on the headless test machine**: the
same view runs at ≈ 17–22 ms p95 before any blast (render-bound: 60 characters, terrain, post). The first explosion
of a mission also costs a one-off ≈ 150 ms shader-compile hitch (no pre-warm yet). Both are outside the bodies
systems and are reported, not asserted.

### D.3 Options (ui/options-panel.js, ui-config.js)
GAME PREFERENCES gains a **RULES** group:
- `rulesPreset`: `SHADOW SIX` (default) | `CLASSIC 1998` | `CUSTOM` (set automatically when a toggle differs from a
  preset). The detail pane for CLASSIC 1998 says: "Exactly the 1998 rules: only the Green Beret and the Spy move
  bodies, and any death fails the mission."
  Options saved before a house rule existed take that rule's value from their saved preset (`loadOptions`), so a
  CLASSIC 1998 player stays CLASSIC 1998 when a new rule arrives.
- `dragBodies`: DRAG BODIES (ALL COMMANDOS). Description: "Any commando can drag a body, slowly and walking backwards.
  Not in the 1998 original."
- `buddyRescue`: BUDDY RESCUE. Description: "A commando at 0 health is downed for 60 s instead of dying. Drag or carry
  him to safety and revive him with the first aid kit. Not in the 1998 original."
- `dropWhenShot`: DROP BODIES WHEN HIT. Description: "A man carrying or dragging a body drops it when he is hit. Not in
  the 1998 original."
- `ragdollAllDeaths` (VIDEO or GAME, visual): BODIES SETTLE WITH PHYSICS.
- `runningNoise`: RUNNING IS HEARD. Description: "Guards hear a commando running nearby, louder on roads, decks and
  floors, quieter on grass, sand and mud. Walking and crawling stay silent. Not in the 1998 original." Its companion
  display option `noiseRings` (NOISE RINGS, default on) draws a faint ring from the runner's feet to the hearing radius.

The existing `blood` and `censored` options gate §B. The options take effect at the next mission start or load; the
panel says so while a mission is running.

Mission data may force house rules. For example, a tutorial can force `buddyRescue: false`. The mission definition's
`houseRules` override wins over the options, and the briefing notebook shows it.

---

## E. Tests (every suite stays green: `node tests/unit/run.mjs`, `node tests/run.mjs`)

**Unit (node, headless):**
- `bodies-rules.test.mjs`:
  - under `classic1998`, the ability ids per role, the hotkeys and every BEL flag equal the pinned bel-lock lists;
  - only the GB and the Spy can `hand` a body;
  - no downed state (0 HP means dead, then the `died` loss after the grace);
  - a carrier who is shot keeps his load.
- `bodies-drag.test.mjs`:
  - every role can drag under `shadowSix`, and guests cannot;
  - drag speed is 0.8 m/s, a run order walks, `noLinks`, and there is no entry to buildings or vehicles;
  - the dragger heads backwards;
  - the body's gameplay position stays 0.95 m behind the dragger and is walkable;
  - release takes 0.6 s and the body lies down;
  - H while dragging as GB lifts in 1.0 s; as the Sniper it is refused with the reason text; Shift+H lowers in 0.8 s;
  - drop when shot (with the flag on and off);
  - a transported BCD knock-out who wakes is dropped;
  - bound men stay bound.
- `bodies-downed.test.mjs`:
  - lethal downable damage leads to DOWNED (alive, hp 0, `unit:downed`), and non-downable causes kill;
  - overkill above the cap kills;
  - the bleed-out at 60 s kills, and the mission fails;
  - a hit on a downed man kills;
  - the downed man's abilities are refused and his crawl runs at 0.3 m/s;
  - K on a downed man revives in 4.0 s: 1 dose, 34 HP, standing;
  - a hit during the revive cancels it and the dose is kept;
  - with no doses it is refused;
  - all men downed means "NOBODY LEFT TO HELP";
  - a downed man in the exit zone counts, and loading into a vehicle works;
  - a guest goes DOWNED too.
- `bodies-ai.test.mjs`:
  - seen dragging gives N = 1000 and a CHALLENGE, and the disguised Spy is unmasked;
  - a transported body is not BODY-discoverable;
  - a seen downed commando gives BODY plus a target, and a guard in ATTACK shoots him;
  - guards ignore blood, smears and furrows.
- `physics-determinism.test.mjs`:
  - two headless runs of the same blast scenario (M1 barrel, 3 guards, 10 crates) give bit-identical settled body and
    prop positions and poses;
  - save mid-flight (snapshot) → load → continue gives the same result as an uninterrupted run;
  - the physics tier comes from the save, not the machine.
- `physics-rules.test.mjs`:
  - the kill set of every explosion class equals today's for a grid of positions (physics on and off);
  - settled bodies are walkable-adjacent (≤ 1.5 m) and never inside a building footprint or deep water;
  - props never re-stamp onto doors, ladders, links or unit cells;
  - an explosive barrel still explodes; a barrel hiding a body stays put;
  - a missing or failed physics init gives identical gameplay (null object);
  - active caps are honoured, with deterministic fallback selection.
- `blood-model.test.mjs` (pure data/logic):
  - the cause table (syringe gives no blood; censored or blood off gives no spawns);
  - pool flow runs downhill on a sloped test field and conserves volume;
  - the snow surface gives a halo channel and a 4× dry time;
  - the colour/age curve;
  - the budget recycling order;
  - save → load gives the same pool masks (seeded re-simulation);
  - bloody feet decrement;
  - drag stamps furrows only in drag mode (the regression for `terrain.js:370` / `game-adapter.js:72`).
- `bodies-save.test.mjs`: carryMode, downed timer, transitions, house rules, bodyPose, props, panes and blood all
  round-trip; an old save without the fields loads.

**Browser (GPU headless, `tests/run.mjs bodies`):**
- a blast ragdoll in M1 with frame captures (≤ 1000 px, ≤ 300 KB): the body lands on the slope;
- the drag of a bleeding body on snow (M1 Sola, snow) shows the furrow, smear and halo;
- the shoulder carry with drips;
- the downed portrait ring;
- a pool on stone versus on snow at close zoom;
- a perf probe within the §D.2 budgets;
- censored mode: gravestone, no blood.

---

## F. Work order (small steps; each ends green and committed on `feat/bodies`)

1. **House-rules layer + drag/carry gameplay**:
   - `world.house`, the options, `carryMode`, the `drag` and `carryToggle` abilities, `hand` routing, drop when shot;
   - the terrain furrow fix;
   - AI checks;
   - tests `bodies-rules`, `bodies-drag`, `bodies-ai`.
2. **DOWNED + revive + HUD + barks + mission flow**, with `bodies-downed` and save fields.
3. **Animations** (§C.10) in the pose library, plus the map entries and the paired transitions. Screenshots.
4. **Rapier vendoring + `world-physics`**: static colliders, step, null object, determinism test.
5. **Ragdolls** (blast + settle + drag constraint), gameplay feedback, the censored path; physics-rules tests.
6. **Blast model**: survivors, props, vehicles, doors, glass, wind/terrain/water hooks.
7. **Blood**: wounds and spatter → pools (flow, surfaces, snow) → stains → smears, drips, prints → budgets → save.
8. **Polish and review**: the AD pass at the game camera and at close zoom, the perf pass, and a PROGRESS.md entry.
   Merge after the review.

---

## G. Open points (to decide during implementation; the defaults above apply until changed here)
1. **The harpoon and the bear trap bleed** (the user's 4y wins over spec §4.7). If the AD review finds it off-tone,
   limit them to a stain and a small pool.
2. The drag speed of 0.8 m/s and the bleed-out of 60 s are [rec]. Tune them after playtests on M2/M5, keeping the
   stealth puzzle of the originals intact.
3. Should a GB or Spy **shoulder-carry a downed buddy up a ladder**? The spec says no climbing while carrying, and that
   is kept.
4. Loading bodies (not buddies) into vehicles stays forbidden (original).
5. A Rapier upgrade must keep the deterministic compat build. Pin the version, and let the determinism test gate any
   bump.
