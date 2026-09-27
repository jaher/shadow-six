/**
 * BEL Mission 2 — "A Quiet Blow-Up" (design-spec §7.5 buildable layout). Owned by MISSIONS.
 * Stamsund, Lofoten (Operation Claymore), 1 Mar 1941. A river runs SE across the map: the team starts
 * behind the palisade of the small SW settlement; the walled camp with the fuel depot, two MG towers,
 * a garrison and the escape truck stands on the NE bank, whose whole area is the `z_ne` alarm zone.
 *
 * Conventions: headings/rot in DEGREES in the spec, converted with deg(); route `look` and `post.sweep` stay in
 * degrees. Briefing text is our own wording (§7.3).
 */

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG, §4.1)

// SE wall edge E(71,35) → S(46,58); the 4 m gate gap is centred on (56, 48.8)
const GATE = { x: 56, z: 48.8 };
const SE = [(46 - 71) / Math.hypot(25, 23), (58 - 35) / Math.hypot(25, 23)];
const gapA = [+(GATE.x - SE[0] * 2).toFixed(2), +(GATE.z - SE[1] * 2).toFixed(2)];
const gapB = [+(GATE.x + SE[0] * 2).toFixed(2), +(GATE.z + SE[1] * 2).toFixed(2)];

// p3 loop (also the camp garrison squad's loop after its exit run)
const P3_LOOP = [P(20, 34), P(38, 14.5, 3, 225), P(64, 32.5), P(64, 40, 3, 45), P(46, 53), P(20, 34)];
const OUT_LOOP = [P(58, 54), P(68, 44), P(78, 52), P(70, 62)];

export default {
  id: 'm02',
  campaign: 'BEL',
  title: 'A Quiet Blow-Up',
  subtitle: 'Stamsund, Lofoten Islands · 1 March 1941',
  date: '1941-03-01',
  place: 'Stamsund, Lofoten (Operation Claymore)',
  theater: 'snow',
  coneColors: 'green',
  size: [82, 104],
  seed: 1941_0301,
  briefing: {
    historical: 'Operation Claymore strikes the Lofoten Islands. Fuel stored at Stamsund feeds the German armour in the north; burn it and their tanks go nowhere.',
    text: 'You start in the small settlement south of the river. The depot is inside the walled camp on the far bank: two big fuel tanks. A patrol boat works the river, so hide when you hear its engine. The camp\'s ladder is pulled up; your Green Beret will have to go over the wall. There\'s a truck inside the camp. Blow the depot and drive out through the south-east gate, and don\'t stop for anyone.',
    objectivesSummary: 'Destroy the fuel depot. Escape in the truck through the south-east gate.',
    hints: [
      'Anything suspicious on the far bank raises the alarm.',
      'Hide when the patrol boat passes; pack the raft after crossing.',
      'The packed raft slows the Marine down. Send him off a little ahead of the others.',
      'The ladder can be lowered from the top of the wall.',
      'Footprints in the snow can lead a curious guard into a trap.',
      'Drive the truck out of the SE gate without stopping.',
    ],
  },
  lighting: { sunElevDeg: 16, sunAzimuthDeg: 315, kelvin: 6200, hdri: 'overcast', fog: null, lut: 'norway', riverColor: '#107083' },
  water: { velocity: 0.6, angleDeg: 40, turbulence: 0.4 },
  shoreShallowWidth: 1.5, // T2 auto rim 1.5 m
  baseTerrain: 'snow',
  terrain: [
    // T1 river (SW bank = start, NE bank = camp)
    { type: 'path', terrain: 'water', points: [[0, 36], [18, 50], [36, 64], [52, 78], [64, 92], [70, 104]], width: 12 },
    // islets (land discs in the river; rocks + a pine on each)
    { type: 'circle', terrain: 'snow', x: 24, z: 58.5, r: 2.2 },
    { type: 'circle', terrain: 'snow', x: 48, z: 78, r: 2 },
    // T3 camp interior (packed, trampled)
    { type: 'poly', terrain: 'ground', points: [[16, 33], [42, 10], [71, 35], [46, 58]] },
    // T4 escape road from the SE gate to the east edge
    { type: 'path', terrain: 'road', points: [[56, 49], [62, 56], [70, 62], [82, 68]], width: 5, surface: 'snow_packed' },
  ],
  // step 3p road network: truck tracks inside the camp (packed, trampled ground), a trodden path through the
  // settlement that stays snow for gameplay (grid: false)
  roads: [
    { id: 'camp_track', surface: 'snow_packed', points: [[56, 48], [53, 41], [47, 33], [41.5, 28.4]], width: 3.5, wear: 0.8 },
    { id: 'depot_track', surface: 'slush', points: [[53, 41], [58.5, 40.5], [63, 39.5]], width: 3, wear: 0.6 },
    { id: 'village_path', surface: 'snow_packed', points: [[8, 103], [8.5, 92], [12, 86], [20, 80], [28, 78]], width: 1.8, grid: false, wear: 0.3 },
  ],
  // street furniture: visual only in the locked BEL layout
  furniture: [
    { type: 'lamp', variant: 'norway_wood', x: 5, z: 88, rot: 0, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 23, z: 83.5, rot: -Math.PI / 2, hooded: true, block: false },
    { type: 'floodlight', x: 42, z: 13.5, rot: Math.PI / 2, block: false },
    { type: 'floodlight', x: 67, z: 35, rot: Math.PI, block: false },
    { type: 'sign', variant: 'fingerpost', x: 59, z: 51, rot: -0.8, text: 'STAMSUND 2 km', block: false },
    { type: 'telegraph', points: [[82, 72], [70, 66], [58, 58]], spacing: 14, h: 6.5, wires: 2, block: false },
  ],
  structures: [
    // --- the walled camp (NE bank). Closed palisade W(16,33) → N(42,10) → E(71,35) → S(46,58) → W,
    // gate gap on the SE edge. The SW edge (22.5,38.4)–(29.5,44.3) is climbable (GB) and carries the
    // wall walk `walk_sw` (y 2.2) where e5 stands.
    { id: 'camp_wall', type: 'wall', variant: 'palisade_wire', h: 3.0, width: 0.5,
      segments: [[gapB, [46, 58], [16, 33], [42, 10], [71, 35], gapA]],
      climbable: { from: [22.5, 38.4], to: [29.5, 44.3] },
      walkways: [{ id: 'walk_sw', points: [[22.72, 38.13], [29.72, 44.03]], width: 1.4, y: 2.2 }] },
    { id: 'gate_se', type: 'gate', variant: 'barrier_boom', x: GATE.x, z: GATE.z, rot: deg(317), w: 4, operable: true, rammable: true },
    // sentry box just outside the gate on the SW verge of T4, clear of the straight truck line to the exit
    { id: 'sbox_se', type: 'hut', variant: 'sentry_box', x: 54.4, z: 52.3, rot: deg(317), w: 1.6, d: 1.6, h: 2.4 },
    // buildings run parallel to the palisade edge they stand by (NW edge −41.5°, NE edge 40.8°, SE edge 137.4°, SW edge −140.2°)
    { id: 'barr_camp', type: 'barracks', variant: 'log_garrison', x: 37.74, z: 24.01, rot: deg(318.5), w: 12, d: 6, h: 4.5, flag: true, garrison: true },
    { id: 'cab1', type: 'hut', variant: 'log_cabin', x: 29.26, z: 36.77, rot: deg(219.8), w: 5, d: 4, h: 3.5 },
    // the depot: two tanks end to end along the NE edge, between p3's wall-side leg and the camp track
    { id: 'depot_a', type: 'fueltank', variant: 'horizontal_cradle', x: 49.64, z: 27.94, rot: deg(40.8), w: 9, d: 3.4, h: 3.5, destructible: true, bombOnly: false, hp: 100 },
    { id: 'depot_b', type: 'fueltank', variant: 'horizontal_cradle', x: 57.21, z: 34.47, rot: deg(40.8), w: 9, d: 3.4, h: 3.5, destructible: true, bombOnly: false, hp: 100 },
    // MG towers stand just inside the palisade, outer legs against it (placement rule a: never astride the wall);
    // t1 sits 3 m SW along the NW edge of the aligned barracks' W end
    { id: 't1', type: 'watchtower', variant: 'timber_mg', x: 27.06, z: 26.49, rot: deg(228), w: 3, d: 3, h: 5.5, deckY: 5.5 },
    { id: 't2', type: 'watchtower', variant: 'timber_mg', x: 54.42, z: 23.93, rot: deg(311), w: 3, d: 3, h: 5.5, deckY: 5.5 },
    { id: 'crates1', type: 'crates', x: 46, z: 48, rot: deg(317.4), w: 2, d: 2, h: 1.2, block: 1 },
    ...[['bar1', 25, 33], ['bar2', 26, 33], ['bar3', 48.5, 36.2], ['bar4', 49.4, 36.8]]
      .map(([id, x, z]) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 })),
    // garrison outside the E corner, parallel to the SE edge that runs on to the gate road (a charge within 6.75 m of the E corner razes it)
    { id: 'barr_out', type: 'barracks', variant: 'log_garrison', x: 73.26, z: 39.18, rot: deg(47.4), w: 6, d: 8, h: 4, flag: true, garrison: true, razeRadius: 6.75, destructible: true, hp: 100 },
    // cover between the SW wall and the river
    { id: 'rocks_n1', type: 'rocks', x: 21.83, z: 40.75, rot: 0, w: 4, d: 2.5, h: 2.2 },
    { id: 'rocks_n2', type: 'rocks', x: 34, z: 51, rot: 0, w: 4, d: 2.5, h: 2.2 },
    { id: 'rocks_n3', type: 'rocks', x: 40.31, z: 55.81, rot: 0, w: 3, d: 2, h: 2 },
    // islets in the river (land discs in `terrain`)
    { id: 'islet1', type: 'rocks', x: 23.4, z: 58.9, r: 1.0, h: 1.6 },
    { type: 'pine', x: 25.01, z: 59.03, r: 0.45, h: 9, seed: 301 }, // clear of the boat lane and the rock
    { id: 'islet2', type: 'rocks', x: 47.4, z: 78.4, r: 0.9, h: 1.5 },
    { type: 'pine', x: 48.75, z: 78.95, r: 0.45, h: 10, seed: 302 },
    // --- the SW settlement: palisade with openings S (x 6–10) and E (z 76–80)
    { id: 'sw_wall', type: 'wall', variant: 'palisade', h: 2.2, width: 0.4,
      segments: [[[10, 97], [28, 97], [28, 80]], [[6, 97], [1, 97], [1, 70], [28, 70], [28, 76]]] },
    { id: 'cabA', type: 'hut', variant: 'log_cabin', x: 6.5, z: 80, // clear of the W palisade
      rot: 0, w: 7, d: 5, h: 4, snowRoof: true },
    { id: 'cabB', type: 'hut', variant: 'log_cabin', x: 16, z: 91, rot: 0, w: 7, d: 5, h: 4, snowRoof: true },
    ...[[4, 50], [12, 58], [36, 76], [44, 92], [60, 70], [70, 20], [78, 8], [8, 20], [20, 6]]
      .map(([x, z], k) => ({ type: 'pine', x, z, r: 0.6, h: 9 + (k % 5), seed: 311 + k })),
  ],
  vehicles: [
    { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 50, z: 44, heading: deg(47.4), driveable: true, seats: 6, hits: 30, escape: true },
    { id: 'pboat', vehicleType: 'patrolboat', x: 1, z: 36.8, heading: deg(39), driveable: false, crew: ['e17'], engineAudible: 60,
      route: { type: 'PINGPONG', speed: 2.5, points: [P(1, 36.8, 15), P(18, 50), P(36, 64), P(52, 78), P(66, 95, 15)] } },
  ],
  commandos: [
    { role: 'greenberet', x: 8, z: 101, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 11, z: 101, heading: deg(270), inventory: { pistol: 1, sniperRifle: 5 } },
    { role: 'diver', x: 14, z: 101, heading: deg(270), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 1 } },
    { role: 'sapper', x: 17, z: 101, heading: deg(270), inventory: { pistol: 1, bearTrap: 1, timeBomb: 2 } },
    { role: 'driver', x: 20, z: 101, heading: deg(270), inventory: { pistol: 1, smg: 20, firstAid: 6 } },
  ],
  enemies: [
    // SW settlement: three walkers that support each other (trap + footprint lures)
    { id: 'e1', prima: 1, soldierType: 'soldier', x: 4, z: 73, heading: deg(0), flags: { investigates: true, followsTracks: true },
      route: { type: 'LOOP', vel: 1.0, points: [P(4, 73), P(24, 73, 3, 0), P(24, 85), P(11, 85, 3, 180), P(11, 75)] } },
    { id: 'e2', prima: 2, soldierType: 'soldier', x: 14, z: 78, heading: deg(56), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(14, 78, 4, 90), P(24, 92, 4, 180)] } },
    { id: 'e3', prima: 3, soldierType: 'soldier', x: 22.13, z: 95.08, heading: deg(270), flags: { investigates: true, followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(22, 95, 3, 90), P(22, 76, 3, 270)] } },
    // NE bank outside the SW wall, in front of the rocks (snipe him there)
    { id: 'e4', prima: 4, soldierType: 'soldier', x: 20, z: 42.5, heading: deg(37), flags: { holdsPost: true, investigates: false },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(20, 42.5, 3, 135), P(40, 57.5, 3, 135)] } },
    // on the wall walk beside the (raised) ladder, watching the river
    { id: 'e5', prima: 5, soldierType: 'sentry', x: 28.60, z: 43.08, // on the walk's deck, 0.3 m off the palisade line (≥ 0.32 m: e7 finds the body, §7.5 step 2)
      heading: deg(130), elevated: true, y: 2.2,
      flags: { holdsPost: true, investigates: false }, post: { heading: deg(130), sweep: 35 } },
    { id: 'e6', prima: 6, soldierType: 'soldier', x: 30, z: 31, heading: deg(41), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(30, 31, 3, 180), P(51, 49.5, 5, 40)] } },
    { id: 'e7', prima: 7, soldierType: 'soldier', x: 47.28, z: 21.41, heading: deg(41), flags: { holdsPost: true, investigates: false },
      // loop round the depot, parallel to the NE edge
      route: { type: 'LOOP', vel: 1.0, points: [P(47.28, 21.41, 2, 41), P(63.98, 35.81, 2, 315), P(59.01, 41.57), P(42.31, 27.17, 2, 180)] } },
    // MG gunners on the towers, facing outward
    { id: 'e8', soldierType: 'mg', x: 27.06, z: 26.49, heading: deg(228), elevated: true, y: 5.5, tower: 't1', post: { heading: deg(228), sweep: 50, giro: 180 } },
    { id: 'e9', soldierType: 'mg', x: 54.42, z: 23.93, heading: deg(311), elevated: true, y: 5.5, tower: 't2', post: { heading: deg(311), sweep: 50, giro: 180 } },
    // patrol p3 (sergeant + 2 troopers) circling inside the camp
    ...[['e10', 20, 34], ['e11', 21.2, 35.4], ['e12', 21.81, 36.92]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(313), jail: 'barr_camp',
      squad: { id: 'p3', leader: 'e10', columns: 1 }, route: { type: 'LOOP', vel: 1.0, points: P3_LOOP },
    })),
    // patrol p4 (sergeant + 3 troopers, 2 columns) along the east edge; RINT sends it to the gate road
    ...[['e13', 80.5, 4], ['e14', 79, 4], ['e15', 80.5, 2.5], ['e16', 79, 2.5]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(90), jail: 'barr_camp', reactEvents: ['RINT'],
      squad: { id: 'p4', leader: 'e13', columns: 2 },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(80.5, 4, 5, 180), P(80.5, 96, 5, 180)] },
      alarmRoute: { run: { x: 62, z: 54, vel: 3 }, loop: { type: 'LOOP', vel: 1.0, points: OUT_LOOP } },
    })),
    // the patrol boat's MG gunner (vision mg, sweep 60, facing travel)
    { id: 'e17', soldierType: 'mg', x: 1, z: 36.8, heading: deg(39), vehicle: 'pboat', post: { heading: deg(39), sweep: 60, giro: 180 } },
  ],
  items: [],
  zones: [
    { id: 'z_ne', poly: [[0, 0], [82, 0], [82, 104], [74, 104], [64, 84], [52, 70], [36, 56], [18, 42], [0, 28]], onSeen: 'RINT', onHeard: 'RINT' },
  ],
  jails: ['barr_camp'],
  barracks: {
    barr_camp: { pool: 10, squads: [{ event: 'RINT', size: 4, exitVel: 3, exitRoute: [P(41.04, 27.71), P(46, 40), P(52, 48)], loopVel: 2, loop: P3_LOOP }] },
    barr_out: { pool: 5, squads: [{ event: 'RINT', size: 3, exitRoute: [P(70.5, 44), P(66, 50)], loop: OUT_LOOP }] },
  },
  climbLinks: [
    // GB over the climbable SW edge: river side → wall walk, wall walk → camp interior
    { a: [23.73, 41.0, 0], b: [23.72, 39.3, 2.2], roles: ['greenberet'] },
    { a: [29.1, 43.6, 2.2], b: [30.15, 42.45, 0], roles: ['greenberet'] },
  ],
  ladders: [
    // the camp ladder, left pulled up: lowered from the top of the wall (1.0 s)
    { id: 'ladder_sw', x: 27.4, z: 43.0, y: 0, top: [27, 42.2, 2.2], raised: true, lowerTime: 1.0, heading: deg(130) },
    // [rec] inner steps from the wall walk down into the camp (lets the team follow the GB inside)
    { id: 'ladder_sw_in', x: 27.15, z: 39.95, y: 0, top: [26.22, 41.06, 2.2], raised: false },
  ],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the fuel depot', type: 'destroy', targets: ['depot_a', 'depot_b'], required: true },
    { id: 'o2', text: 'Escape in the truck through the south-east gate', type: 'escape', required: true, vehicleId: 'truck' },
  ],
  // exit on the T4 road end, inside the drivable area (the truck's nose stops ~3 m short of the E edge);
  // it lies on the straight line truck start (50,44) → gate → exit, so one double-click drives it out.
  // reaching the exit with o1 still pending (a bomb ticking) → (C)ONTINUE / (Q)UICK LOAD dialog (§8.1)
  extraction: { vehicleId: 'truck', exit: { x: 78, z: 66, r: 4 }, spawnWhen: [] },
  par: { time: 480 },
  cameraStart: { x: 16, z: 92, zoom: 1 },
  startDisguised: [],
};