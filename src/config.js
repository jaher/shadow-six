/**
 * CONFIG — every tunable gameplay number, grouped per system (docs/ARCHITECTURE.md § config).
 *
 * The group layout and the values follow docs/design-spec.md §10.3 (the binding CONFIG mapping); every
 * key cites its spec section ("§x.y"), with the original-source tag where the spec gives one:
 * [EXE] executable, [data] mission/unit data, [manual], [guide], [rec] recommended (our choice).
 * **All durations are in seconds, all distances in metres, all angles in DEGREES** unless the key name
 * says otherwise (runtime code converts: Enemy.vision carries radians, see entities/enemy.js).
 * BEL conversions (§10.1): 1 BEL tick = 0.05 s (20 Hz), 1 BEL map unit = 0.045 m.
 *
 * Keys marked LEGACY are foundation placeholders still read by the placeholder brain/weapons code;
 * the owning team migrates to the spec key named next to them and then deletes the legacy key.
 * Teams may append keys at the END of their own group only (see ARCHITECTURE "Cross-team interfaces").
 * Pure module (no three.js).
 * @module config
 */

const deg = (d) => (d * Math.PI) / 180;
/** Radius used for "map-wide" noise/effects (larger than any map; finite so spatial queries and JSON stay sane). */
export const MAP_WIDE = 1e4;
/** Instant-kill damage value (knife, sniper, harpoon, syringe, trap, run-over; §4.1). */
export const KILL = 1e5;


export const CONFIG = {
  /** Simulation loop and time base (§10.1). */
  sim: {
    dt: 1 / 60, // fixed simulation step (s). ARCHITECTURE: CONFIG.sim.dt = 1/60
    belTick: 0.05, // one original BEL logic tick (s) — every tick value in the spec is converted with this [EXE]
    belUnit: 0.045, // one BEL map unit (m) [EXE/data]
    belTickHz: 20, // tick-integer rules rate (COULD option 16–25); dt20 = 1/belTickHz (§10.1)
    belTickEvery: 3, // tick-integer rules run on every 3rd sim step at belTickHz 20 (60/20) (§10.1)
    maxStepsPerFrame: 8, // spiral-of-death guard: at most this many ticks per rendered frame
    timeScale: 1, // global speed multiplier (debug)
    seed: 1337, // default world RNG seed (missions may override) (§10.5 determinism)
    graceCountdown: 5.0, // end states re-checked after 5 s = 100 ticks [EXE] (§8.1)
  },

  /** Rendering (non-gameplay) defaults; presets live in engine/renderer.js. */
  render: {
    preset: 'high', // 'low' | 'medium' | 'high' | 'ultra'
    toneMapping: 'agx', // 'agx' (design-spec §2.4) | 'aces' (punchier option) | 'neutral' | 'none'
    lut: true, // per-theater display-referred 3D LUT after tone mapping (engine/grade.js; mission lighting.lut)
    /** X-ray silhouettes for commandos hidden behind roofs/trees (design-spec §2.4): muted team colour at 35 %. */
    xray: { enabled: true, color: 0x1d3d12, rim: 0xc8ff90, opacity: 0.95, margin: 1.0 }, // dark team-green fill + bright rim (art review); margin 1.0 m: a long gun aimed at the camera must not x-ray its owner's chest
    exposure: 1.0,
    maxDelta: 0.25, // clamp frame delta after tab switches (s)
  },

  /** Camera: fixed 3/4 view (§2). */
  camera: {
    pitchDeg: 40, // §2.1 pitch below horizontal; BEL projects map depth by sin 40°
    yawDeg: 15, // §2.1 BEL was 0 (north up, walls face the screen head-on); +15° shows a sliver of each building's shaded east side (Options → CAMERA ANGLE: 0 / 15 / 45)
    zoomLevels: [0.5, 1, 2], // §2.2 discrete zoom steps (camera.zoom)
    pxPerMeterAt1x: 40, // §2.2 screen pixels per metre at zoom 1 (1080p reference)
    edgePx: 8, // §2.3 pointer within this many px of the edge scrolls
    scrollSpeed: 30, // §2.3 edge/arrow pan speed at zoom 1 (m/s), scaled by 1/zoom
    zoomTween: 0.25, // §2.2 zoom tween duration (s)
    recenterTween: 0.35, // §2.3 recentre-on-unit tween (s)
    boundsMargin: 4, // §2.3 how far (m) the view edge may go beyond the map edge
    reachMargin: 2, // with yaw: every map point can be scrolled at least this far (m) inside the view (camera.js clampHalfExtents)
    focusInset: 0.24, // with yaw: a recentre/track/tour keeps the view void-free unless the point would sit in this outer fraction of the half-view (camera.js focusTarget)
    distance: 150, // camera distance from its target along the view ray (m); orthographic → clipping only
    defaultZoom: 1, // §2.2 1× "normal"; also numpad * / Backspace
    edgeScroll: true, // §2.3 (game.options.edgeScroll / edgeScrollOverHud override at runtime)
  },

  /**
   * Scenery apron past the playable map (art/apron.js; design-spec §2.3 "never see the map boundary"). Not walkable,
   * the nav grid is unchanged. The camera keeps its true ground footprint inside `width` (camera.js apronMinZoom).
   */
  apron: {
    width: 90, // m of detailed scenery past every map edge (zoom 0.5 at 45° on a 3840x1080 view reaches ~83 m)
    skirt: 600, // m of plain far ground beyond it (safety cover for extreme views; never reached by the clamp)
    cell: 1, // m, apron heightfield / code-field resolution (0.5 m within seamBand of the map edge)
    seamBand: 6, // m: heights blend from the map's own edge heights into the apron's
    fade: 24, // m: outer band where the apron relief settles to y = 0 (meets the flat skirt)
    treeFalloff: 45, // m: forest density thins to ~1/e at this distance past the edge
    grassBand: 30, // m: the map's 3D grass continues past the edge, thinning out (noisy line) over this band
    rutPeriod: 14, // m: a road leaving the map repeats (mirrored to and fro) its last metres of ruts / paint past the edge
  },

  /** Humanoid units (commandos, guests; enemy movement speeds live in CONFIG.ai) (§3.1, §3.2). */
  units: {
    walk: 2.25, // §3.1 every commando walks 2.25 m/s = 0.1125 m/tick [EXE]
    run: { greenberet: 5.4, driver: 5.4, default: 4.5 }, // §3.1 [EXE]
    crawl: 0.9, // §3.1 [inf]
    carry: 1.6, // §3.1 GB/Spy carrying a body or barrel; cannot run [rec]
    raftCarryPenalty: 0.9, // §3.1 Marine with packed raft: walk 1.35, run 3.6 (−1 u/tick = −0.9 m/s) [EXE]
    swim: 1.8, // §3.1 Marine swim/dive [rec]
    row: 2.5, // §3.1 raft rowing [rec]
    hp: { greenberet: 200, sniper: 100, diver: 160, sapper: 130, driver: 130, spy: 160, guest: 100, natasha: 100, skopje: 100, enemy: 200 }, // §3.1 [EXE]; enemy = §4.1 [inf]
    stanceDown: 0.5, // §3.3 crawl (C) takes 0.5 s
    stanceUp: 0.6, // §3.3 stand (S) takes 0.6 s
    dblClickMs: 350, // §5.2 double-click window (run / fast drive)
    turnRateDeg: 540, // §3.1 commando turn rate [rec]
    radius: 0.45, // §3.1 collision cylinder R10 = 0.45 m [data]
    separation: 0.5, // §3.1 soft separation between units [rec]
    // local avoidance (src/entities/avoidance.js): lateral lane dodge layered on the path track (route progress and
    // patrol timing unchanged) + lower-priority walkers wait for a crossing priority walker; clear = 2 × radius;
    // sep: the hard floor between two commandos walking whatever the plan, walls and lanes did (Unit._keepApart)
    avoid: { on: true, clear: 0.9, sep: 0.8, hyst: 0.15, moving: 0.15, together: 0.3, sameWay: 0.94, look: 4.0, horizon: 1.5, crossCos: 0.6, laneMax: 1.0, laneRate: 0.7, laneAccel: 3.0, ghostAfter: 1.5, dropBack: 0.6, brakeT: 0.6, arriveLook: 2.0, cornerR: 0.5, steerTurn: 9.4, wallR: 0.25, laneOut: 1.5, brake: 4.0 },
    height: 1.8, // standing height (m): BEL 40 units
    pickRadius: 0.6, // generous screen picking radius (m)
    arriveEps: 0.08, // waypoint reached distance (m)
    autoWalkCancel: 3.0, // §3.3 melee auto-walk cancels if the target moves > 3 m from the click [rec]
    roster: {
      greenberet: { name: 'Jerry McHale', nickname: 'Tiny' }, // §3.0 canonical US-manual set
      sniper: { name: 'Sir Francis T. Woolridge', nickname: 'Duke' },
      diver: { name: 'James Blackwood', nickname: 'Fins' },
      sapper: { name: 'Thomas Hancock', nickname: 'Inferno' },
      driver: { name: 'Sid Perkins', nickname: 'Tread' },
      spy: { name: 'René Duchamp', nickname: 'Spooky' },
      natasha: { name: 'Natasha "Lips" van de Zand', nickname: 'Lips' }, // BCD guest (bcd-plan §1.8)
      skopje: { name: 'Maj. Dragiša Skopje', nickname: 'Skopje' }, // BCD guest
    },
    // §3.0 optional locale name tables (`names.eu`): per-role overrides merged over `roster` when
    // `nameLocale` names a table. Off (null) by default: BEL ships the canonical US-manual names.
    names: {
      eu: {
        greenberet: { name: "Jack O'Hara", nickname: 'Butcher' },
        sapper: { nickname: 'Fireman' },
        spy: { nickname: 'Frenchy' },
      },
    },
    nameLocale: null,
    // Number-key order: 1..6 select Green Beret, Sniper, Marine, Sapper, Driver, Spy (§5.1).
    selectOrder: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
    // --- LEGACY (unit.js placeholder movement; migrate to the spec keys above) ---
    turnRate: deg(540), // rad/s = turnRateDeg
    enemyTurnRate: deg(180), // rad/s = CONFIG.ai.bodyTurnDeg (§4.1)
    stanceChangeTime: 0.5, // LEGACY (unused): Unit.setStance uses stanceDown / stanceUp
  },

  /** Stealth: vision cones, noise, footprints (§4.2, §4.4, §4.8). Angles in degrees. */
  stealth: {
    // Vision profiles (§4.2 table). fov = FULL aperture (deg); near/far (m); sweep = amplitude A (deg,
    // θ(t) = A·sin(2πt/P + φ)); period P (s); elliptical = far(θ) = ab/√((b cosθ)²+(a sinθ)²), b = a/3.
    vision: {
      soldier: { fov: 70, near: 18, far: 36, sweep: 50, period: 5.0, elliptical: true }, // [EXE Vista01] sentries DEMORA 100
      patrolWatch: { sweep: 50, period: 2.5 }, // walkers at waypoint waits: VIGILARDEF 50°, DEMORA 50 [data]
      dog: { fov: 90, near: 18, far: 36, sweep: 40, period: 5.0, elliptical: true },
      snitch: { fov: 70, near: 18, far: 18, sweep: 30, period: 5.0, elliptical: false }, // BCD snitch POW: near band only [rec]
      mg: { fov: 40, near: 14.4, far: 28.8, sweep: 50, period: 5.0, elliptical: false }, // sweep 35–60 per spawn
      bunker: { fov: 40, near: 18, far: 36, sweep: 50, period: 5.0, elliptical: false }, // near/far per mission
      cannon: { fov: 70, near: 18, far: 36, sweep: 20, period: 5.0, elliptical: false },
      tank: { fov: 70, near: 22.5, far: 45, sweep: 155, period: 5.0, elliptical: false }, // Panzer II/III/IV crew
      sdkfz: { fov: 40, near: 24.75, far: 49.5, sweep: 155, period: 5.0, elliptical: false },
      truck: null, // no cone: run-over box only (CONFIG.vehicles.runoverBox)
      train: null, // polygon box (CONFIG.vehicles.train.box)
    },
    // soldierType → vision profile (§4.1 roster "Vision profile" column; null = no cone).
    profileByType: {
      sentry: 'soldier', soldier: 'soldier', sergeant: 'soldier', trooper: 'soldier', officer: 'soldier',
      courier: 'soldier', engineer: 'soldier', general: 'soldier', tutorial: 'soldier', dog: 'dog', mg: 'mg',
      crew: 'tank', gunner: 'cannon', truckDriver: null,
      // BCD unit types (bcd-plan §1.9; BEL missions never place them)
      gestapo: 'soldier', lieutenant: 'soldier', zookeeper: 'soldier', snitch: 'snitch', pow: null,
      lion: null, ostrich: null, chicken: null,
    },
    ellipseMode: 'classic', // §4.2 'classic' (b = a/3) | 'wide' (b = a) | 'short' (b = a/3, ranges × 0.75)
    ellipseRatio: 1 / 3, // §4.2 b = a/3 [EXE VISTAELIPTICA]
    shortRangeMul: 0.75, // §4.2 'short' mode range multiplier
    eyeHeight: 1.65, // §4.2 [EXE]
    sweepPhaseMax: 1.0, // §4.2 per-enemy random phase φ in 0–1.0 s (seeded) [EXE]
    footprint: { walkStep: 0.75, runStep: 1.6, life: 90, fade: 30, trailFollow: 4, trailMax: 40, minVisibility: 0.15 }, // §4.8 [rec]; §4.6 TRACKS
    rooftopDelta: 2.0, // §4.2 roof rule: invisible to viewers more than 2 m lower (and vice versa)
    roofY: 2.5, // §4.2 a unit with y ≥ 2.5 m is "on a roof" (M12)
    seenListMax: 16, // §4.3 at most 16 seen objects per enemy per tick [EXE]
    spotterHighlight: { alpha: 0.75, dur: 1.0 }, // §4.2 display: spotter cone brightens for 1 s
    coneAlpha: 0.5, // §4.2 flat 50% alpha
    coneColors: { green: { near: '#02BC6F', far: '#07675A' }, desert: { near: '#D26E02', far: '#6B4C01' } }, // §4.2 [EXE]
    coneRays: 96, // §10.2 ≥ 96 rays across the aperture (≤ 0.75° apart)
    probeRing: 0.6, // §4.2 probe marker ring diameter (m)
    // Noise kinds (§4.4): level (1..3) and radius (m); MAP_WIDE = map-wide. Movement is silent.
    noise: {
      pistol: { level: 2, radius: 18 },
      rifle: { level: 2, radius: 22.5 },
      smg: { level: 3, radius: 25 },
      mg: { level: 3, radius: 36 },
      explosion: { level: 3, radius: MAP_WIDE },
      decoy: { level: 1, radius: 13.5, pulse: 1.5 },
      halt: { level: 2, radius: 18 },
      mandown: { level: 2, radius: 18 },
      alarmShout: { level: 3, radius: 36 },
      bark: { level: 2, radius: 18 },
      spyUnmask: { level: 1, radius: 9 },
      phone: { level: 1, radius: 13.5, pulse: 2 },
      horn: { level: 1, radius: 22.5 },
      stone: { level: 1, radius: 4 }, // BCD stone click (bcd-plan §1.4)
      push: { level: 1, radius: 6 }, // BCD pushable wagon/tank (§1.10)
      cluck: { level: 1, radius: 6 }, // BCD chickens (§1.9)
      footsteps: { level: 1, radius: 7.5 }, // SHADOW SIX house rule runningNoise: a running commando's step (radius by surface: runNoise)
      siren: { level: 0, radius: 0 }, // cosmetic: the alarm travels through zone events
    },
    zoneHeardLevel: 2, // §4.9 onHeard sensors fire on level ≥ 2
    // SHADOW SIX house rule `runningNoise` (§4.4; not in BEL, where movement is silent): a commando running upright makes a
    // level-1 'footsteps' noise every `step` m (the first after step·startFrac m). Hearing radius by the surface under his
    // feet (src/ai/running-noise.js stepSurface), × rules.enemyHearingMul; dogs × dogMul (1: a dog that turns and sees
    // a man goes straight for him, no "Halt!", so a longer reach would be an instant alarm at 15–18 m). All [rec]: every
    // radius is inside the 18 m near band so a guard who turns can see the runner. Walking, crawling, swimming are silent.
    runNoise: {
      step: 2.7, startFrac: 0.5, dogMul: 1,
      radius: { deck: 12, floor: 12, road: 10, shallow: 9, ground: 7.5, snow: 7.5, grass: 6, sand: 6, mud: 6 }, // snow crunches
      susp: { decay: 0.5, alertAt: 3, searchAt: 6, repath: 0.75, barkEvery: 6 }, // brain _hearSteps: suspicion memory
    },
    bushBlocksLowOnly: true, // §4.2 a 2 m bush blocks only low targets [rec]
    // --- AI team additions (Stage 1) ---
    alertTint: false, // §4.2/§10.4 #5 modern option: alerted cones red (alertLevel 2) / yellow (1); faithful = off
    alertTintColors: { 1: '#E0C030', 2: '#E04030' },
    coneRayTol: 0.08, // §10.2 cone mesh: adaptive ray refinement until the fan edge is within this (m)
    coneMaxRays: 1200, // cap on refined rays per cone rebuild
    multiCone: 1, // cones shown at once (BEL: 1; "multi-view" up to 6)
  },

  /** Enemy AI (§4.1, §4.3–§4.7). */
  ai: {
    nervousness: { T: 50, decayPerTick: 1, closeRange: 2.25, heldValue: 1000, bodyBonusDiv: 25, dispMul: 2 }, // §4.5 [EXE]: N += floor(dispMul·d²), d in BEL units
    investigate: { speed: 1.8, look: 4.0, runSpeed: 3.8, arrive: 1.5, lookSweep: 90, mateShot: 8 }, // §4.6 INVESTIGATE
    decoy: { radius: 13.5, pulse: 1.5, giveUp: 5.0, standOff: 2.0, shockIgnore: 20, maxDwell: null }, // §4.6 DECOY [rec]; shockIgnore: s deaf to lures after a level-3 shock / broken lure; maxDwell: s (null = none; missions: rules.decoyMaxDwell)
    search: { time: 20, points: 3, radius: 8, look: 2 }, // §4.6 SEARCH
    lostTarget: 3.0, // §4.6 COMBAT → SEARCH after target lost 3 s
    chaseSpeed: 3.8, // §4.1 [data: German run stride 55 vs 75]
    halt: { cooldown: 3, moveTol: 0.3 }, // §4.5 CHALLENGE re-shout / held-commando move tolerance
    partnerGlance: { every: 25, dur: 2.5 }, // §4.1/§4.6 [EXE TIEMPOENTREMIRADAS 500, TIEMPOMIRANDOCOMPA 50]
    panic: { stuck: 5, wander: 2, minMove: 0.2 }, // §4.6 panic unstick [data]
    aim: 0.5, // §4.6 COMBAT aim time (s)
    enemyHP: 200, // §4.1 [inf]: 3 pistol hits
    velMul: 0.9, // §4.1 route speed = VEL × 0.9 m/s (default VEL 1.0)
    defaultVel: 1.0,
    reinforceVel: { exit: 3, loop: 2 }, // §4.1 reaction squads: 2.7 m/s exit, 1.8 m/s loop
    bodyTurnDeg: 180, // §4.1 body turn 180°/s [rec]; head turn instant [EXE PASO 90]
    // SHADOW SIX smooth turn on the spot (enemy-brain _turnTo / _turnStep) instead of BEL's instant snap for noise turns
    // (steps, shots, barks, "Halt!", lures), a lure walker's / body finder's / distracted man's / partner glance's turn and
    // a post's turn back to its heading: accelerate at `accel` °/s², cruise at bodyTurnDeg (the walking body turn), brake
    // at brake·accel onto the bearing — 180° in 1.15 s, 90° in 0.65 s, 45° in 0.4 s. The cone turns with the body each
    // step. A noise turn stops the head sweep (it fades back in over `sweepIn` s once he faces the bearing); a head
    // turned away when the turn starts comes round with the body (head carry, at most `headRate` °/s), so the cone never
    // jumps. "Halt!" (CHALLENGE / HOLD): the head — the cone — swings onto the commando at `aimRate` °/s and stays on him
    // while the body turns to him at the eased rate (no body snap). [rec]
    turn: { accel: 1000, brake: 0.9, sweepIn: 1.0, headRate: 240, aimRate: 360 },
    squadSpacing: 1.2, // §4.1 troopers follow the leader's breadcrumbs 1.2 m apart
    // squad follower speed controller (playtest: the M1 south patrol pair stuttered and walked through each other):
    // leader pace + braking catch-up to the slot, accel-limited; never closer than minGap to a mate ahead
    squadFollow: { catchUp: 1.5, accel: 1.5, decel: 2.5, gain: 1.5, arrive: 0.06, stop: 0.12, minWalk: 0.4, lookahead: 0.7, minGap: 0.9, gapGain: 3, gapHyst: 0.35, startT: 0.25 },
    body: { arrive: 1.5, kneel: 1.0, alarmDelay: 1.0 }, // §4.6 BODY
    noiseTurnHold: 8, // §4.4 holdsPost: sweep re-centred on a level-1 noise for 8 s
    arrest: { arrive: 1.5, escortSpeed: 1.8, rescueTime: 1.5 }, // §4.10
    raftShots: 3, raftUnattended: 3, // §4.3 raft seen unattended (no commando within 3 m) deflates after 3 hits
    engineerRun: 4.5, // §4.1 M16 engineer runs to his detonator
    courierSpeed: 9, // §4.6 ALARM_RUN motorbike
    // --- AI team additions (Stage 1) ---
    fire: { roundGap: 0.05 }, // s between rounds of an SMG burst [rec]; the MG fires its rounds weapons.mg.cadence apart
    holdLost: 0.5, // §4.5 held commando out of sight this long = "flees out of sight" → COMBAT [rec]
    submissive: false, // §4.5 option Submissive (a held, moving commando stops); default Indifferent
    alarmReactRadius: 36, // §4.9 posts within this radius of a RINT turn to face it (level-3 reaction) [rec]
  },

  /** Alarm, zones, reinforcements (§4.9). */
  alarm: {
    sirenGain: 0.75, // SIRENA01 start gain [EXE]
    sirenFadePerSec: 0.03, // 0.0015 per 50 ms [EXE] → silent after 25 s
    sirenDur: 25, // HUD alarm lamp + siren (s); a new RINT restarts it
    sirenEvent: 'RINT', // the only event that starts the siren [EXE]
    reinforceExit: 2.7, // squad exit-route speed (VEL 3)
    reinforceLoop: 1.8, // squad loop speed (VEL 2), forever
    regen: 20, // destroyed squad rebuilt from the pool 20 s after its last member dies [rec]
    // --- AI team additions (Stage 1) ---
    // Maps without a `zones` key (sandbox/tests) or with mission.noZonesFallback: the whole map acts as one zone
    // with these sensors (never M1's explicit `zones: []` — §7.4 "the entire map is safe"), so an
    // enemy entering COMBAT / seeing a kill / completing BODY still starts the siren (§4.9 onSeen).
    noZonesFallback: { onSeen: 'RINT', onHeard: null },
  },

  /**
   * Weapons (§3.3, §4.1, §4.11). Spec keys: range (m), dmg (per hit/round; KILL = instant death),
   * cadence (s between shots/bursts), rounds (per burst), noise (radius m; kind per §4.4), reload/aim (s).
   * Enemy shots are deterministic hits (§4.1) → accuracy 1. `damage`/`interval` are filled in as aliases
   * of dmg/cadence below (LEGACY readers). Items reference these keys (items.js `weapon`).
   */
  weapons: {
    pistol: { range: 13.5, dmg: 80, cadence: 0.15, noise: 18, noiseKind: 'pistol', accuracy: 1 }, // §3.3 commando pistol
    luger: { range: 13.5, dmg: 80, cadence: 0.5, noise: 18, noiseKind: 'pistol', accuracy: 1 }, // §4.1 sergeant pistol
    sniper: { range: 45, dmg: KILL, reload: 0.5, aim: 0.6, noise: 0, accuracy: 1 }, // §3.3 silent, one shot kills
    smg: { range: 18, rounds: 5, dmg: 200, fanDeg: 15, cadence: 0.8, burstDur: 0.25, noise: 25, noiseKind: 'smg', accuracy: 1 }, // §3.3 Driver; a round that hits kills (Kildread / CommandosHQ: "kills in one hit")
    harpoon: { range: 9, dmg: KILL, reload: 3.0, noise: 0, accuracy: 1 }, // §3.3 silent, unlimited
    grenade: { range: 13.5, flight: 1.0, throwTime: 0.7, explosion: 'grenade', noise: MAP_WIDE, noiseKind: 'explosion' }, // §3.3
    timeBomb: { fuse: 10.0, plant: 1.0, explosion: 'bomb', noise: MAP_WIDE, noiseKind: 'explosion' }, // §3.3 [manual/data]
    remoteBomb: { plant: 1.0, explosion: 'bomb', noise: MAP_WIDE, noiseKind: 'explosion' }, // §3.3
    syringe: { range: 1.2, dmg: KILL, dur: 0.9, hit: 0.5, noise: 0 }, // §3.3 Spy, no blood
    rifle: { range: 36, dmg: 80, cadence: 1.0, aim: 0.5, noise: 22.5, noiseKind: 'rifle', accuracy: 1 }, // §4.1 Kar98k
    mp40: { range: 18, rounds: 5, dmg: 100, cadence: 1.0, noise: 25, noiseKind: 'smg', accuracy: 1 }, // §4.1 trooper
    mg: { range: 28.8, dmg: 100, rounds: 5, cadence: 0.25, noise: 36, noiseKind: 'mg', accuracy: 1 }, // §4.1 [EXE TIEMPO_RECARGA 5]
    tankMg: { range: 45, dmg: 110, rounds: 10, roundRate: 10, cadence: 0.25, noise: 36, noiseKind: 'mg', accuracy: 1 }, // §3.7 [data PNZ2]
    cannon: { minRange: 13.5, reload: 1.5, explosion: 'shell', noise: MAP_WIDE, noiseKind: 'explosion' }, // §3.7 [data RECARGA 30]
    dogBite: { range: 1.2, dmg: 25, cadence: 1.0, noise: 0 }, // §4.1 [EXE 25; rec cadence]
    // BCD (bcd-plan §1.7, §1.9): Driver's Lee-Enfield; Gestapo Luger (crack shots); animal attacks
    leeEnfield: { range: 27, dmg: KILL, reload: 2.5, aim: 0.6, noise: 18, noiseKind: 'pistol', accuracy: 1 },
    gestapoLuger: { range: 13.5, dmg: 100, cadence: 0.5, noise: 18, noiseKind: 'pistol', accuracy: 1.25 },
    dogBiteBcd: { range: 1.2, dmg: 35, cadence: 1.0, noise: 0 }, // BCD German shepherd (§1.9)
    lionClaw: { range: 1.6, dmg: 110, cadence: 1.5, noise: 0 },
    ostrichKick: { range: 1.4, dmg: 40, cadence: 1.0, noise: 0 },
    electric: { dmg: 20 }, // §4.11 per contact
    fire: { dps: 100 }, // §3.6 [EXE FUEGO = 100]
    // Explosion classes (§3.6): lethal = instant-death radius, dmgRadius/dmg = outer damage ring,
    // structures = what it destroys, chain = barrel ignition radius (+ delay).
    explosions: {
      bomb: { lethal: 6.75, dmgRadius: 0, dmg: 0, structures: 'any', targetRadius: 3.0, chain: 6.75, chainDelay: 0 }, // [data .RADIO 150]
      barrel: { lethal: 5.0, dmgRadius: 6.75, dmg: 100, structures: 'any', chain: 6.75, chainDelay: 0.2 },
      fuelTank: { lethal: 7.5, dmgRadius: 10.1, dmg: 100, structures: 'any', chain: 10.1, chainDelay: 0.2 }, // BCD pushable tank: 1.5× barrel (§1.10) [rec]
      grenade: { lethal: 0, lethalDmg: 200, lethalRadius: 4.5, dmgRadius: 6.75, dmg: 100, structures: 'grenadeDestructible', chain: 4.5, chainDelay: 0 },
      vehicle: { lethal: 0, dmgRadius: 9, dmg: 180, structures: 'light', chain: 6.75, chainDelay: 0 }, // [data .DANO 180 .RADIO 200]
      shell: { lethal: 2.25, dmgRadius: 4.5, dmg: 150, structures: 'allButBunker', chain: 4.5, chainDelay: 0 },
      mine: { lethal: 3.0, dmgRadius: 0, dmg: 0, structures: 'none', chain: 3.0, chainDelay: 0 }, // §4.11 land mine: 3 m, lethal (M5 dossier §6.2)
    },
    // --- LEGACY (placeholder brain / items / projectiles) ---
    smgBurst: { fanAngle: deg(15), rays: 5, bursts: 20 }, // → smg.fanDeg / smg.rounds; bursts = item count
    movingTargetMul: 1, lowTargetMul: 1, minAccuracy: 1, // deterministic hits (§4.1)
  },

  /** Abilities (§3.3, §3.4). Owners append per-ability keys at the end. */
  abilities: {
    // contact: the last step in to body contact, the victim held (abilities/knife-contact.js); false = the classic stab at arm's length
    knife: { reach: 1.2, dur: 0.6, hit: 0.3, range: 1.2, windup: 0.3, duration: 0.6, noise: 0, contact: true }, // §3.3 (range/windup/duration = LEGACY aliases)
    syringe: { dur: 0.9, hit: 0.5, reach: 1.2 }, // §3.3
    timeBomb: { fuse: 10 }, // §3.3
    firstAid: { heal: 34, doses: 6, dur: 1.5, at: 0.5, range: 1.2 }, // §3.3 +34 HP per dose, 6 doses
    dig: 2.0, // §3.3 shovel: dig 2.0 s
    rise: 1.0, // §3.3 shovel: rise 1.0 s
    moundPickRadius: 0.85, // a buried GB is clicked / tapped at his mound (engine/input.js pickEntity), m
    cutters: 3.0, // §3.3 cut time [rec]
    cutGap: 1.5, // §3.3 1.5 m gap in fence cells (legacy: a hole is cut now, cutHole)
    // the cutters open a round hole low in the wire (crawl only, grid crawlway): w × h m, bottom y0 above the ground
    // (art/wire-obstacles HOLE mirrors it); he kneels `standoff` m from the wire (hips; from a crawl too), snips at
    // `snips` (s into the cut; the first one finds out whether the wire is live) and pushes the flap away from `peel`
    cutHole: { w: 0.96, h: 0.86, y0: 0.05, standoff: 0.6, snips: [0.75, 1.15, 1.5, 1.85, 2.2], peel: 2.45 },
    raftDeploy: 2.0, // §3.3
    dive: 1.5, // §3.3 diving gear on/off
    uniform: 1.5, // §3.3 Spy re-dress
    distractRange: 1.5, // §3.3 Spy walks to within 1.5 m
    distractBreak: 3.0, // §3.4 distraction break-off distance/time
    climbSpeed: 0.5, // §3.3 vertical m/s [rec]
    carry: { pick: 1.0, drop: 0.8, reach: 1.2 }, // §3.3 carryBody / carryBarrel
    trap: { set: 1.0, pick: 1.0, trigger: 0.5, range: 1.5 }, // §3.3 bear trap
    decoyPlant: 0.8, // §3.3 decoyDrop
    hand: { reach: 1.2, min: 0.6, max: 1.0 }, // §3.3 role-gated pick-up
    jailOpen: 1.5, // §4.10 rescue: activate the jail door
    turretTurnDeg: 90, // §3.3 vehicleFire turrets rotate 90°/s
    approachRepath: 0.5, // s between re-path attempts while walking into range of a moving target
    approachRepathMove: 0.5, // m the approach target must move before the auto-walk re-paths (static targets: one path)
    approachTimeout: 30, // give up walking into range after this many seconds
    // autoStand melee (knife, BCD knock-outs, cuffs, hanger) ordered from a crawl: he crawls in and stands up only this
    // many metres beyond the ability's reach (user request 2026-10-01; BEL stood him up at the click). 0.6 s stand
    // + ~0.45 s step-in at 2.25 m/s still lands on a stationary or slowly-turning guard.
    crawlStandLead: 1.0,
    // --- ABILITIES team (§3.2–§3.6) ---
    pistolDraw: { greenberet: 0.3, spy: 0.2, driver: 0.2, default: 0.25 }, // §3.2 draw time
    ladderSpeed: 0.8, // §3.2 everyone climbs ladders at 0.8 m/s [rec]
    activation: { door: 0.5, switch: 1.0, ladder: 1.0, vehicle: 0.5, gun: 0.8, clothesline: 1.5 }, // §3.2 [rec]
    remoteDelay: 0.2, // §3.4 detonator radio delay
    ammoBox: 3, // §3.4 sniper ammo box +3 [data CAJABALA .BALAS 3]
    phoneRing: 10, // phone rings for 10 s of phone-noise pulses (lure) [rec]
    surfaceTime: 0.6, // §3.4 Marine surfaces 0.6 s to knife from the water
    shoreReach: 1.2, // §3.4 knife from the water: enemy within 1.2 m of the shoreline
    raftPack: 2.0, // §3.4 H on the raft: deflate and pack 2.0 s
    grenadeSelf: true, // §3.4 friendly fire on (thrower included)
    electricDmg: 20, // §3.4 live electric fence: 20 damage, cut fails
    doorWatch: 6, // §3.2 an enemy who saw a man enter a door looks around it for 6 s
    boardDist: 1.5, // board a vehicle from within 1.5 m
    guestSpacing: 1.0, // §3.5 Gilbert's group follows in single file at 1.0 m
  },

  /** Vehicles, emplacements, trains (§3.7, §3.6). Speeds m/s, turn °/s. */
  vehicles: {
    truck: { slow: 3, fast: 9, turn: 60 }, // §3.7 truck, car, jeep
    car: { slow: 3, fast: 9, turn: 60 },
    tank: { slow: 2, fast: 5, turn: 45 }, // §3.7 tank, half-track
    halftrack: { slow: 2, fast: 5, turn: 45 },
    motorcycle: { slow: 10, fast: 10, turn: 90 }, // §3.7 fast only
    boat: { slow: 2.5, fast: 4, turn: 45 }, // §3.7 boats
    raft: { slow: 2.5, fast: 4, turn: 120 }, // §3.7 the paddled inflatable pivots fast [rec] (45°/s left it in a 10 s fuse's blast)
    runoverBox: [1.8, 5.4, 1.35], // §3.7 front sensor box: from 1.8 to 5.4 m ahead, ±1.35 m (fast speed kills)
    hits: { truck: 30, jeep: 30, horch: 30, kubel: 20, car: 60, van: 60, sdkfz: 500, panzer2: 1000 }, // §3.7 [data .IMPACTOS] bullets to destroy
    bulletImmune: ['panzer3', 'panzer4', 'playerPanzer2'], // §3.7
    grenadeImmune: ['panzer3', 'panzer4'], // §3.7 only bombs and shells
    wreckBurn: 20, // §3.7 wrecks burn 20 s, then stay as B.HIGH
    exitRadius: 3, // §3.7 passengers step out onto walkable cells within 3 m
    train: { box: [-31.5, 16, 3.4] }, // §3.7 [data] kill box along the track (behind, ahead, ±across)
    capacity: { truck: 6, car: 4, jeep: 4, kubel: 4, tank: 2, halftrack: 6, boat: 6, raft: 3, motorcycle: 1, plane: 6, emplacement: 1 }, // [rec]
    // ---- VEHICLES team (appended; entities/vehicle.js registry reads these) ----
    seats: { // §3.2 capacities [data] (driver included); overrides `capacity` per registry type
      raft: 3, rowboat: 3, motorcycle: 2, kubelwagen: 4, willys: 4, sdkfz: 5, van: 5, truck: 6, opel_blitz: 6,
      opel_blitz_tanker: 2, horch: 6, citroen15: 4, panzer2: 6, panzer3: 6, panzer4: 6, patrolboat: 6, minisub: 2,
      autogyro: 2, ju52: 8, ju87: 2, tram: 12, train: 0, mgNest: 1, cannon: 1,
    },
    plane: { slow: 4, fast: 12, turn: 30 }, // [rec] taxi / take-off roll (McRae)
    rail: { slow: 6, fast: 12, turn: 360 }, // [rec] trains and trams follow their track
    boardTime: 0.5, gunMountTime: 0.8, // §3.2 activation: vehicle 0.5 s, manned-gun post 0.8 s
    alignDeg: 3, // turn in place until the nose is within this of the target, then drive straight (§3.7)
    probeStep: 0.25, // m: straight-line reachability sampling
    ramNoise: 20, // m: noise radius of a fast vehicle smashing through a barrier / light gate (§3.7 ramming) [rec]
    runoverSpeedFrac: 0.9, // §3.7 run-over kills only once the actual speed reaches 90% of the vehicle's fast speed
    runoverDodge: 2.0, // m: at slow speed an enemy in the sensor box steps this far aside (§3.7)
    tankerHits: 1, // §3.6 fuel tanker: any hit explodes it
    raftHits: 3, // §4.3 unattended raft deflates after 3 hits
    heavyArmor: ['panzer3', 'panzer4'], // §3.7 only bombs and shells destroy them
    wreckFireRadius: 2.5, // m around the hull where the burning wreck deals CONFIG.weapons.fire.dps
    torpedo: { speed: 8, range: 120, count: 2, explosion: 'bomb' }, // §7.1 M13 mini-sub: 2 torpedoes, straight runs
    shellSpeed: 60, // m/s tank-cannon shell (visual flight; explodes at the aim point or first wall)
    loseTarget: 3.0, // s an enemy vehicle keeps firing/stopped after losing sight (PARAYDISPARA), then resumes
    trainSchedule: { period: 60, speed: 12, delay: 10 }, // [rec] default periodic schedule (s, m/s, first delay s)
  },

  /** Audio (AUDIO owner) (§9). */
  audio: {
    masterVolume: 0.8,
    channels: ['master', 'sfx', 'voice', 'music', 'ui'], // §9 engine
    // Distance model (realism-pipeline v2 §1.5.0): per-category ref/max distances live in audio/manifest.js
    // DISTANCE (footsteps 30 m, voices 60 m, small arms 400 m, MG/explosions 1.5 km) — NOT the 40 m AI hearing radius.
    rolloff: 1, // inverse-distance rolloff factor (WebAudio 'inverse' model)
    airDistance: 120, // m at which the air-absorption low-pass reaches airMinHz
    airMinHz: 3500,
    farLayerAt: 160, // m beyond which explosions play the distant recordings (distance timbre)
    bedFade: 4, // s ambience-bed crossfade
    burstTail: 0.3, // s a recorded MG burst keeps sounding after the shooter's last round (MG cadence 0.25 s)
    dedupe: 0.08, // s: the same SFX id at the same spot within this window plays once
  },

  /** Mission flow, scoring, passwords (§8). Owner: CORE2. */
  mission: {
    failOnCommandoDeath: true, // §8.1 any commando/guest dies → loss after the grace countdown
    lostDelay: 5.0, // §8.1 grace countdown (s)
    wonDelay: 1.5,
    objectiveWinDelay: 5.0, // §7.4/§8.1 extraction:null missions (M1) win 5 s after the last required objective, if no commando is dead
    escapeContinueWindow: 15, // §8.1 "escaped, targets not done" → Continue: 15 s to complete
    timeStars: [1, 1.5, 2.5], // §8.2 time ≤ P·k → 3/2/1 silver stars [rec]
    damageStars: [0.10, 0.30, 0.60], // §8.2 damage loss ≤ → 3/2/1 silver stars [rec]
    ranks: ['Lance-Corporal', 'Corporal', 'Sergeant', 'Quartermaster', 'Lieutenant', 'Captain', 'Major',
      'Colonel', 'Brigadier', 'General', 'Field-Marshal'], // §8.2 one rank per 6 gold stars
    starsPerRank: 6,
    m20MinRank: 5, // §8.2 Captain or higher unlocks M20
  },
  passwords: {
    // §8.3: our own whitening keys and a 36-symbol alphabet without 0/O/1/I (padded with - + etc.).
    K1: 0x5a3c9, K2: 0xc6b27,
    alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ-+*=',
  },

  /**
   * Campaign rulesets (§10.3; ARCHITECTURE "Campaigns & rulesets"). The active mission's ruleset is
   * `world.rules`. Systems check flags instead of hard-coding BEL behaviour. BCD values are placeholders
   * until docs/bcd-plan.md; nothing BCD-only may be enabled under BEL.
   */
  rulesets: {
    BEL: {
      id: 'BEL',
      knockouts: false, handcuffs: false, puppet: false, stones: false, cigarettes: false, spyChloroform: false,
      spyUniformFromCaptives: false, driverClub: false, driverRifle: false,
      disguiseRanks: false, sergeantsSeeThroughDisguise: false, difficulty: false, commandoWarnings: false,
      pushables: false, seaMines: false, lifts: false, drawbridges: false, animals: false, guests: false, mudTracks: false,
      hotkeys: null, careerStartGold: 0, maxGold: 60, // maxGold: gold a career can earn (20 × 3; read under BCD only)
      enemyAccuracyMul: 1, enemyHearingMul: 1,
    },
    BCD: {
      id: 'BCD',
      knockouts: true, handcuffs: true, puppet: true, stones: true, cigarettes: true, spyChloroform: true,
      spyUniformFromCaptives: true, driverClub: true, driverRifle: true,
      // bcd-plan §1.6: rank-based disguise recognition (`sergeantsSeeThroughDisguise` = legacy alias)
      disguiseRanks: true, sergeantsSeeThroughDisguise: true, difficulty: true, commandoWarnings: true,
      pushables: true, seaMines: true, lifts: true, drawbridges: true, animals: true, guests: true, mudTracks: true,
      // bcd-plan §2: the BCD key layout {abilityId: key}; defs not listed keep their BEL `hotkey`
      hotkeys: {
        harpoon: 'e', sniper: 'e', rifle: 'e', decoyDrop: 'g', handcuff: 'j', cutters: 'j', raft: 'n',
        pistol: 'q', puppet: 'r', hanger: 't', cigarettes: 'v', smg: 'w', knife: 'w', trap: 'w', syringe: 'w',
        knockoutFist: 'x', knockoutClub: 'x', knockoutChloroform: 'x', stone: 'y', lipstick: 'd', beretta: 'q', handGuest: 'h',
      },
      careerStartGold: 36, maxGold: 24, // bcd-plan §1.13: start at Major (36) + at most 24 gold earned (8 × 3) = Field Marshal at 60
      enemyAccuracyMul: 1, enemyHearingMul: 1, // BCD has no global difficulty multipliers (§1.0)
    },
  },

  /**
   * House rules (docs/bodies-design.md §0.3): rules that are NOT in the 1998 original. `world.house` is resolved from
   * a preset + per-rule overrides at mission load (core/house-rules.js); `world.rules` (above) is never edited.
   */
  houseRules: {
    default: 'shadowSix',
    presets: {
      // physicsGameplay: a thrown / settled body's resting place and a toppled prop's footprint feed back to gameplay
      // (AI body discovery, nav, cover). Off = the 1998 behaviour: physics is drawn but gameplay positions stay put.
      // runningNoise: guards hear a commando running nearby (stealth.runNoise). Off = the 1998 rule: movement is silent.
      shadowSix: { dragBodies: true, buddyRescue: true, dropWhenShot: true, ragdollAllDeaths: true, physicsGameplay: true, runningNoise: true },
      classic1998: { dragBodies: false, buddyRescue: false, dropWhenShot: false, ragdollAllDeaths: true, physicsGameplay: false, runningNoise: false },
    },
    labels: { shadowSix: 'SHADOW SIX', classic1998: 'CLASSIC 1998', custom: 'CUSTOM' },
  },

  /**
   * Drag, shoulder carry and buddy rescue (docs/bodies-design.md §C). Shoulder carry keeps `abilities.carry` (pick 1.0,
   * drop 0.8) and `units.carry` (1.6 m/s) — the spec values; everything here is [rec] unless noted.
   */
  bodies: {
    drag: {
      speed: 0.8, // m/s walking backwards, can't run
      turnRate: Math.PI, // rad/s cap while transporting (180°/s)
      offset: 0.95, // m: the body's pelvis sits this far behind the dragger along the path
      reach: 0.45, // m: his hands (collar / armpits) ahead of him; the pelvis trails offset − reach behind them (tow)
      yawRate: 5, // 1/s: the body's yaw eases towards the hands → pelvis line (exponential)
      heel: 0.82, // m pelvis → heels along the body (the furrow; art/terrain/game-adapter HEEL)
      grab: 1.0, release: 0.6, // s
      toShoulder: 1.0, toDrag: 0.8, // s (drag → shoulder lift / shoulder → drag lower)
    },
    dropFallH: 1.4, // m a shouldered body falls from when the carrier is hit
    vehicleLoad: 1.5, // s to load a downed buddy / cannotWalk guest into a vehicle
    downed: {
      bleedOut: 60, // s from DOWNED to death
      crawlSpeed: 0.3, // m/s
      overkillMax: 60, // damage beyond the remaining hp above this kills outright
      blastCore: 0.5, // × R_k: inside this an explosion kills outright
      fatal: ['drown', 'crush', 'vehicle', 'runover', 'train', 'fall'], // causes that are never downable
      revive: 4.0, // s (one first-aid dose)
      reviveHp: 34, // HP after the revive (one dose)
      standUp: 1.2, // s getting up after the revive
      hurry: 15, // s left: faster pulse / heartbeat, "Hurry, he's fading!"
      barkRange: 40, // m: the nearest other commando within this calls "Man down!"
      coverRange: 3.0, // m: a guard who sees a downed man walks up to this distance and covers him
      finishDelay: 8.0, // s of covering (any guard) before the finishing shot: the in-sight rescue window
    },
  },

  /**
   * Blast shock-wave physics (docs/bodies-design.md §A, PROGRESS 4x). Presentation layer: `world.explode()` still
   * decides every death; only a body's resting place is fed back to gameplay. [rec] values unless noted.
   */
  physics: {
    enabled: true,
    gravity: -9.81, solverIterations: 4,
    terrainStep: 1.0, // heightfield sample spacing (m): 1 m keeps the save snapshot small (§A.10); slopes are gentle
    staticH: { high: 3.2, low: 0.9, fence: 1.1 }, // collider heights of grid blockers (m)
    blast: {
      reachMul: 2.5, // R_b = reachMul × R_k
      J0: 900, r0Mul: 0.35, lift: 0.35, angular: 0.15,
      maxDvBody: 11, maxDvProp: 16, // m/s clamps (design §A.3 max 14/18; tuned down so point-blank bodies stay on screen)
      area: { body: 0.7, standingMin: 0.25 }, // effective frontal area (m²)
      rays: [0.3, 1.0, 1.6], rayFrom: 0.4, occMin: 0.15, front: 340,
      Q: { grenade: 1, bomb: 3, barrel: 2, fuelTank: 4, vehicle: 2.5, shell: 1.5 },
    },
    ragdoll: {
      mass: 75, settleAt: 1.2, // s after death (die clip end) for the settle ragdoll
      linDamp: 0.05, angDamp: 0.6, jointDamp: 2.0, friction: 0.8,
      limits: { neck: 40, shoulder: 85, hip: 70, spine: 30, knee: 140, elbow: 145 },
      blend: 0.15, drive: { from: 0.4, time: 0.6 },
      settleV: 0.05, settleW: 0.2, settleHold: 0.5, timeout: 6,
      nudge: 1.5, nudgeFar: 6, nudgeBlend: 0.3,
    },
    // fall: 0.9 s going down, lying dazed, 1.2 s getting up; a guard knocked down is blind and holds fire meanwhile
    // (physicsGameplay; the 1998 rules keep it a visual flinch of the same length)
    survivor: { flinch: 0.6, fall: 2.5, maxOffset: 0.6, times: { hit: 0.4, knockback: 0.8, fall: 3.4 }, getUp: 1.2 },
    props: { wake: 0.8, navMinH: 0.6, navMinMass: 20, nudge: 1.0 },
    vehicles: { lightRoll: 18, heavyRoll: 5, heavyTime: 0.8, stiffness: 60, damping: 7, flipDv: 3.5, flipTime: 0.9 },
    doors: { reachMul: 1.5 }, glass: { reachMul: 1.8 },
    looseItemFrac: 0.6, // knock-loose helmets when J > 60 % of the fall threshold
    // §0.2 determinism: the ragdoll and prop caps decide which body / prop gets simulated, and that result feeds
    // gameplay, so they are ONE fixed set for every graphics preset (a replay made on 'low' matches one on 'ultra').
    gameplayCaps: { ragdolls: 8, props: 48 },
    // purely visual extras (debris chips, glass shards) scale with the quality preset
    caps: {
      low: { debris: 32 },
      medium: { debris: 64 },
      high: { debris: 64 },
      ultra: { debris: 96 },
    },
    classicThrow: 0.3, // × blast Δv on bodies when physics is visual only (physicsGameplay off): a slump, not a flight
    // ground marks (orchestrator 2026-09-27): crater (soft ground) / scorch (hard floors) size per class, metres
    marks: { grenade: 1.3, shell: 1.6, barrel: 2.0, vehicle: 2.6, bomb: 3.0, fuelTank: 3.4 },
  },

  /**
   * Blood (docs/bodies-design.md §B, PROGRESS 4y). Pure presentation: never read by gameplay or the AI. Volumes (L)
   * and colours from forensic references; every other number is [rec].
   */
  blood: {
    // §B.1 wound classes. spatter: [min, max] droplet decals, cone half-angle (deg), range [min, max] m.
    causes: {
      // grow: s over which the wound empties into the pool (most of it early: a visible pool within ~20 s)
      shot: { puff: 1, spatter: [3, 8], cone: 20, range: [0.5, 2.5], pool: 0.8, grow: [14, 22], wound: 'spine_03', stain: 0.13 },
      burst: { puff: 1, spatter: [3, 6], cone: 22, range: [0.5, 2.2], pool: 1.0, grow: [16, 26], wound: 'spine_03', stain: 0.11, perUnit: 3, window: 0.2 },
      knife: { puff: 0, spurt: { pulses: 3, time: 1.0, arc: [0.3, 0.9], drops: 5 }, pool: 1.5, grow: [25, 35], wound: 'neck_01', stain: 0.14, attacker: true },
      explosion: { puff: 0, radial: [6, 14], range: [0.3, 2.0], pool: 0.6, grow: [10, 16], wound: 'spine_02', stain: 0.1 },
      harpoon: { puff: 1, spatter: [2, 4], cone: 25, range: [0.3, 1.2], pool: 1.0, grow: [30, 45], wound: 'spine_03', stain: 0.10 },
      trap: { puff: 0, spatter: [2, 4], cone: 180, range: [0.1, 0.5], pool: 0.6, grow: [25, 35], wound: 'calf_r', stain: 0.07 },
      bite: { puff: 1, spatter: [1, 3], cone: 60, range: [0.2, 0.8], pool: 0.5, grow: [25, 35], wound: 'lowerarm_l', stain: 0.08 },
      runover: { puff: 0, smear: 1.5, pool: 0.6, grow: [20, 30], wound: 'pelvis', stain: 0.12 },
      nonLethal: { puff: 1, spatter: [1, 3], cone: 20, range: [0.3, 1.2], pool: 0, wound: 'spine_03', stain: 0.06 },
    },
    // cause id (weapon ids included) → class above; anything listed in `none` never bleeds (syringe stays bloodless)
    alias: {
      shot: 'shot', bullet: 'shot', pistol: 'shot', luger: 'shot', rifle: 'shot', sniper: 'shot', sniperRifle: 'shot', leeEnfield: 'shot', damage: 'shot',
      smg: 'burst', mp40: 'burst', mg: 'burst', tankMg: 'burst',
      knife: 'knife', harpoon: 'harpoon', trap: 'trap', bite: 'bite', dogBite: 'bite', runover: 'runover', train: 'runover',
      explosion: 'explosion', grenade: 'explosion', bomb: 'explosion', timeBomb: 'explosion', remoteBomb: 'explosion', shell: 'explosion',
      barrel: 'explosion', vehicle: 'explosion', torpedo: 'explosion', fuelTank: 'explosion',
    },
    none: ['syringe', 'injection', 'poison', 'chloroform', 'punch', 'ko', 'knockout', 'drown', 'electric', 'fire'],
    // §B.2 pools: 64 × 64 cells of 2.5 cm, 10 Hz steps, ≤ 4 pools per frame; start delay after death (s)
    pool: { n: 64, cell: 0.025, hz: 10, perFrame: 4, sub: 3, delay: [0.5, 1.5], film: 1.4, maxAge: 1800, settleAfter: 12 },
    // colour by age (sRGB hex; the shader converts): fresh → dark (2–4 min) → dried (10–15 min)
    colors: { fresh: '#6e0a0a', dark: '#3a0605', dry: '#2a1308', snowCore: '#a3101c', halo: '#c24a5a' },
    age: { dark: [120, 240], dry: [600, 900] },
    // §B.3 surfaces. absorb = liquid → soaked per s; cap = soak capacity (mm); halo = snow bleed channel;
    // dryMul = drying time multiplier (snow stays vivid ×4), sheen = s of wet gloss on absorbent ground
    surfaces: {
      snow: { absorb: 0.35, cap: 3.5, spread: 0.14, halo: 3, dryMul: 4, crack: 0, micro: 'grain', melt: 0.015, wetAge: 600 },
      soil: { absorb: 0.25, cap: 5, spread: 0.03, halo: 0, dryMul: 1, crack: 0.3, micro: 'soil', sheen: 30 },
      gravel: { absorb: 0.18, cap: 3, spread: 0.02, halo: 0, dryMul: 1, crack: 0.2, micro: 'gravel', sheen: 30 },
      grass: { absorb: 0.12, cap: 4, spread: 0.02, halo: 0, dryMul: 1, crack: 0.2, micro: 'soil', tintGrass: 1 },
      mud: { absorb: 0.10, cap: 3, spread: 0.02, halo: 0, dryMul: 0.6, crack: 0, micro: 'soil', film: 1 },
      hard: { absorb: 0.004, cap: 0.4, spread: 0, halo: 0, dryMul: 1, crack: 1, micro: 'rock' },
      paved: { absorb: 0.004, cap: 0.4, spread: 0, halo: 0, dryMul: 1, crack: 1, micro: 'joints' }, // floors, roofs, platforms
      wood: { absorb: 0.02, cap: 1, spread: 0.01, halo: 0, dryMul: 1, crack: 0.6, micro: 'planks' },
      metal: { absorb: 0, cap: 0, spread: 0, halo: 0, dryMul: 1, crack: 0.2, micro: 'none', tension: 2.2 },
      ice: { absorb: 0, cap: 0, spread: 0, halo: 0, dryMul: 3, crack: 0, micro: 'none', tension: 1.4 },
      road: { absorb: 0.03, cap: 0.8, spread: 0.01, halo: 0, dryMul: 1, crack: 0.7, micro: 'soil', tension: 1.1 },
    },
    // §B.4 clothing stains
    stain: { grow: 30, start: 0.035, wetFor: 120, spray: 0.04 }, // start: the hole and first soak show at once
    // §B.5 trails, drips, prints
    trail: {
      smearWidth: [0.18, 0.35], smearStep: 0.08, dripEvery: [0.3, 1.5], drop: [0.02, 0.04],
      bleedRate: 0.02, dragLoss: 0.01, bloodyFeet: 6, wetAge: 180, footR: 0.12,
    },
    water: { cloud: 12 },
    // §B.6 budgets per quality preset (medium between low and high)
    budgets: {
      low: { pools: 16, decals: 128, smear: 60, stains: 4 },
      medium: { pools: 32, decals: 192, smear: 120, stains: 8 },
      high: { pools: 48, decals: 256, smear: 200, stains: 8 },
      ultra: { pools: 64, decals: 512, smear: 400, stains: 8 },
    },
  },

  /**
   * Beyond the Call of Duty tunables (docs/bcd-plan.md §1.14). Every [rec] number lives here; nothing
   * reads this block under the BEL ruleset.
   */
  bcd: {
    koDuration: 30, koReach: 1.2, koTime: { fist: 0.6, blackjack: 0.6, chloroform: 1.2 }, koHit: 0.3,
    rearmTime: 1.5, rearmReach: 2, // §1.2 [rec]: a roused man picks his weapon up where he fell
    reviveTime: 3, cuffTime: 1.5, freeTime: 4, lootTime: 0.8, hangerTime: 2.0, uniformChange: 1.5,
    puppet: { range: 13.5 },
    stones: { range: 12, flight: 0.6, noiseRadius: 4, lookTime: 4, window: 20, investigateAt: 3, investigateLook: 6, hiddenCount: 50 },
    cigarettes: { range: 10, flight: 0.7, pickupTime: 3, perSoldier: 1 },
    lipstick: { range: 6 },
    rifle: { hiddenCount: 50 }, // stats in CONFIG.weapons.leeEnfield (§1.7)
    gestapoAccuracy: 1.25,
    animals: {
      lion: { radius: 8, speed: 6, hits: 2, cadence: 1.5, dmg: 110 },
      ostrich: { radius: 5, provoke: 3, dmg: 40, cadence: 1, speed: 5 },
      chicken: { flee: 3, noiseRadius: 6, speed: 3 },
      dog: { bite: 35, cadence: 1 },
    },
    push: { wagon: 0.8, tank: 0.6, noiseRadius: 6, reach: 1.5 },
    seaMine: { trigger: 1.5 }, lift: { travel: 6, capacity: 4 }, drawbridge: { time: 5 },
    zookeeperFlee: 3.8, snitchReport: 6,
    officerRecognise: 1.0, // §1.6 [rec]: seconds an unarmed officer watches a Spy he sees through before he shouts the alarm
    easy: { routeSpeedMul: 0.8, pauseMul: 2.5 }, // reference values; the missions carry their own data
    warnings: { redHz: 4, redHold: 1.5 },
    // §1.6 rank levels: uniform worn / viewer soldierType → level (Gestapo 3 always recognises)
    rankOfUniform: { soldier: 0, zookeeper: 1, sergeant: 1, officer: 2 },
    rankOfViewer: {
      soldier: 0, sentry: 0, trooper: 0, mg: 0, crew: 0, gunner: 0, engineer: 0, courier: 0, snitch: 0,
      sergeant: 1, officer: 2, lieutenant: 2, general: 2, gestapo: 3,
    },
  },
};

// ---- derived aliases (single source of truth: the spec keys above) ----
(function deriveAliases(C) {
  const W = C.weapons;
  for (const w of Object.values(W)) {
    if (!w || typeof w !== 'object') continue;
    if (w.dmg !== undefined && w.damage === undefined) w.damage = w.dmg; // LEGACY alias
    if (w.cadence !== undefined && w.interval === undefined) w.interval = w.cadence; // LEGACY alias
    if (w.reload !== undefined && w.interval === undefined) w.interval = w.reload;
  }
  W.sniperRifle = W.sniper; // item key (items.js) → spec key
  W.injection = W.syringe; // item key → spec key
  W.timeBomb.delay = W.timeBomb.fuse; // LEGACY (projectile.js)
  W.grenade.fuse = W.grenade.flight; // LEGACY (projectile.js)
  const E = W.explosions;
  W.grenade.radius = E.grenade.lethalRadius; W.grenade.damage = E.grenade.lethalDmg; // LEGACY placeholders
  W.timeBomb.radius = E.bomb.lethal; W.timeBomb.damage = KILL;
  W.remoteBomb.radius = E.bomb.lethal; W.remoteBomb.damage = KILL;
  W.cannon.radius = E.shell.lethal; W.cannon.damage = KILL;
})(CONFIG);

/**
 * Ruleset for a campaign id (unknown/absent → BEL).
 * @param {string} [campaign]
 */
export function rulesFor(campaign) {
  return CONFIG.rulesets[campaign] || CONFIG.rulesets.BEL;
}

/**
 * Vision profile for a soldierType (§4.1 → §4.2), or null when the type has no cone.
 * @param {string} soldierType
 * @returns {object|null} CONFIG.stealth.vision entry (degrees)
 */
export function visionProfileFor(soldierType) {
  const S = CONFIG.stealth;
  const p = soldierType in S.profileByType ? S.profileByType[soldierType] : (S.vision[soldierType] ? soldierType : 'soldier');
  return p ? S.vision[p] : null;
}

/** Speed (m/s) for an enemy route VEL value (§4.1: VEL × 0.9). */
export function velToSpeed(vel = CONFIG.ai.defaultVel) {
  return vel * CONFIG.ai.velMul;
}

export default CONFIG;
