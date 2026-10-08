/**
 * BEL Mission 1 — "Baptism of Fire" (design-spec §7.4 buildable layout). Owned by MISSIONS.
 * Sola, near Stavanger, 20 Feb 1941. A still fjord splits the map: the relay station and the barracks
 * sit on the north landmass, the Marine starts alone on the eastern peninsula (reachable only across
 * the water), the Green Beret and the Driver start south of the coast road. No alarm zones, no garrisons,
 * no extraction (the mission ends 5 s after the relay is destroyed, §8.1).
 *
 * Conventions: every heading/rot below is written in DEGREES in the spec and converted with deg(); route `look` stays in degrees
 * (0 = E, 90 = S, 180 = W, 270 = N); `post.sweep` stays in degrees (enemy.js/makeVision convention).
 * Briefing text is our own wording (§7.3).
 */

const deg = (d) => (d * Math.PI) / 180;
/** Route point helper: look in degrees (kept in degrees; the brain converts). */
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG, §4.1)

export default {
  id: 'm01',
  campaign: 'BEL',
  title: 'Baptism of Fire',
  subtitle: 'Sola, near Stavanger, Norway · 20 February 1941',
  date: '1941-02-20',
  place: 'Sola, near Stavanger, Norway',
  theater: 'snow',
  treeSnow: 1, // snow load on the conifers (0..1.3; art/terrain.js): fresh, heavy snowfall
  coneColors: 'green',
  size: [65, 171],
  seed: 1941_0220,
  briefing: {
    historical: 'February 1941. From Sola, outside Stavanger, the Luftwaffe flies its patrols and raids out over the North Sea, and the airfield\'s signals pass through a small relay station nearby. Silence it, and the bombers fly blind.',
    text: 'Your men have landed apart, officer. The Marine is on the eastern peninsula; the Green Beret and the Driver are south of the coast road. Regroup at the wooden jetty, cross the fjord, and destroy the relay station in the north-west corner of the island. There are fuel drums by the barracks, and the Green Beret can handle those. Good luck.',
    objectivesSummary: 'Destroy the relay station.',
    hints: [
      'Regroup at the south jetty.',
      'The raft lies on the peninsula\'s west shore; only the Marine can use it.',
      'Guards follow fresh footprints in the snow. Crawling leaves none they can see.',
      'Sentries can see a body on the open shore from across the still fjord. Clear the south bank before the peninsula, or hide the bodies.',
      'A fuel drum shot next to the station will do the job. Shoot it from well back: the parked car will go up too.',
    ],
  },
  lighting: { sunElevDeg: 15, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast', fog: 150, lut: 'norway' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.2 },
  shoreShallowWidth: 2.0,
  baseTerrain: 'snow',
  terrain: [
    // T1 packed camp ground
    { type: 'rect', terrain: 'ground', x: 8, z: 4, w: 38, d: 32 },
    // T2 deep fjord (leaves the Marine's peninsula x 36–65, z 55–98 joined only to the east edge)
    { type: 'poly', terrain: 'water', points: [[0, 45], [10, 43.5], [22, 45], [34, 42.5], [46, 41], [56, 38.5], [65, 37],
      [65, 53], [56, 54], [46, 55.5], [39, 57], [36.5, 64], [35.5, 76], [36, 88], [38, 96], [46, 98.5], [56, 98], [65, 97.5],
      [65, 104], [54, 104.5], [42, 103.5], [34, 102], [26, 103], [14, 102.5], [0, 103]] },
    // T3 shallow rim: automatic (shoreShallowWidth)
    // T4 trampled grass around the house
    { type: 'rect', terrain: 'grass', x: 20, z: 105, w: 24, d: 23 },
    // T5 coast road
    { type: 'path', terrain: 'road', points: [[0, 154], [14, 142], [26, 131], [40, 135], [52, 140], [65, 147]], width: 6, surface: 'snow_packed' },
  ],
  // step 3p road network (world/roads.js): a rutted snow track through the camp, a concrete pad at the relay station
  roads: [
    { id: 'camp_track', surface: 'snow_packed', points: [[42, 37], [36, 31], [26, 26], [16, 21], [12.5, 17]], width: 3, wear: 0.7 },
  ],
  pavements: [
    { id: 'relay_pad', surface: 'concrete', points: [[8, 14.8], [17.5, 14.8], [17.5, 19], [8, 19]], cracks: 0.4, weeds: 0.3, patches: 0.1, edge: 'ragged' },
  ],
  // street furniture: visual only in the locked BEL layout (block: false keeps every route and sight line as tuned)
  furniture: [
    { type: 'lamp', variant: 'norway_wood', x: 15, z: 146.5, rot: -2.21, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 31, z: 136.2, rot: -Math.PI / 2, block: false },
    { type: 'floodlight', x: 43.5, z: 31, rot: -2.36, block: false },
    { type: 'floodlight', x: 7.5, z: 20, rot: -0.6, block: false },
    { type: 'lamp', variant: 'wall_lamp', x: 15.05, z: 12, rot: 0, hooded: true, block: false },
    { type: 'sign', variant: 'fingerpost', x: 39.5, z: 35.5, rot: 0.6, text: 'SOLA 3 km', block: false },
  ],
  structures: [
    // --- north landmass: the relay station (objective) and the camp
    { id: 'relay_hut', type: 'hut', variant: 'relay_station', x: 12, z: 12, rot: 0, w: 6, d: 5, h: 3.5,
      destructible: true, destroyedBy: ['explosion'], debris: true, fire: true, hp: 100 },
    { id: 'relay_mast', type: 'radio_mast', x: 16.08, z: 6.4, // legs clear of the hut's eaves (placement rule b)
      rot: 0, r: 0.5, h: 18, destructible: true, destroyedBy: ['explosion'], collapses: true, hp: 100 },
    // door to the N (rot 180°: its stoop and steps no longer stand in the alley between the two barracks, which a
    // commando crawls through as well as walks: user 2026-10-07 "Yes reopen it"); gable door E
    { id: 'barr_L_a', type: 'barracks', variant: 'timber_long', x: 32, z: 19, rot: deg(180), w: 16, d: 7, h: 4.5 },
    // turned E-W and 3.5 m clear of barr_L_a (placement rule c: its roof and snow skirt crossed barr_L_a's; porch E)
    { id: 'barr_L_b', type: 'barracks', variant: 'timber_long', x: 37, z: 29, rot: 0, w: 8, d: 6, h: 4.5 },
    { id: 'barr_2', type: 'barracks', variant: 'timber_long', x: 14, z: 32, rot: 0, w: 12, d: 6, h: 4.5 },
    // piers: w = length along the heading, d = deck width
    { id: 'pier_n', type: 'pier', x: 42, z: 39, rot: deg(90), w: 7, d: 2.5 },
    { id: 'mg1', type: 'sandbags', variant: 'mg_ring', x: 22, z: 39.5, rot: deg(90), ring: { r: 1.8 }, h: 1.0, block: 1 },
    // --- south bank
    { id: 'jetty_s', type: 'pier', x: 32, z: 99, rot: deg(270), w: 7, d: 2.5, rendezvous: true },
    { id: 'house_s', type: 'house', variant: 'timber_2storey', x: 30.5, z: 113, rot: 0, w: 10, d: 8, h: 7, snowRoof: true, enterable: false },
    { id: 'wall_s', type: 'wall', variant: 'stone_plank_roof', points: [[25.5, 117], [21, 125], [17.5, 132]], width: 0.6, h: 1.8, climbable: true },
    { id: 'sbox', type: 'hut', variant: 'sentry_box', x: 16.5, z: 134, rot: deg(26.6), w: 1.6, d: 1.6, h: 2.4 },
    { id: 'debris', type: 'crates', variant: 'timber_debris', x: 27, z: 127, rot: deg(30), w: 3, d: 2, h: 1, block: 1 },
    { id: 'rubble', type: 'ruins', variant: 'rubble', x: 9.5, z: 150.5, rot: 0, w: 3.5, d: 2, h: 1.0, block: 1 },
    { id: 'rocks_drv', type: 'rocks', x: 57, z: 150, rot: 0, w: 7, d: 4, h: 2.5 },
    { id: 'rocks_s1', type: 'rocks', x: 10, z: 166, rot: 0, w: 5, d: 3, h: 2 },
    { id: 'rocks_s2', type: 'rocks', x: 40, z: 164, rot: 0, w: 4, d: 3, h: 2 },
    { id: 'islet_1', type: 'rocks', x: 18, z: 72, rot: 0, w: 5, d: 4, h: 3 },
    { id: 'islet_2', type: 'rocks', x: 23, z: 78, rot: 0, w: 3, d: 3, h: 2 },
    // telegraph poles along the road (wire spans between consecutive poles)
    ...[[6, 141], [20.13, 128.92], [36, 130], [50, 135], [62, 141]].map(([x, z], k) => ({ id: `pole_${k + 1}`, type: 'telegraph_pole', x, z, h: 7, wireTo: k < 4 ? `pole_${k + 2}` : null })),
    // pines (occluder r 0.8), unique seeds
    ...[[2, 20], [30, 9], [54, 4], [60, 10], [62, 22], [58, 30], [52, 34], [14, 110], [18, 106], [32, 146], [36, 150], [28, 152]]
      .map(([x, z], k) => ({ type: 'pine', x, z, r: 0.8, h: 8 + ((k * 7) % 5), seed: 101 + k })),
    // bare deciduous trees (occluder r 0.7)
    ...[[12, 118], [20, 114], [58, 118], [62, 124], [54, 122]].map(([x, z], k) => ({ type: 'tree', variant: 'bare_winter', x, z, r: 0.7, h: 7 + (k % 3), seed: 201 + k })),
    // explosive fuel drums (class `barrel`, GB can carry them)
    // placed clear of the barracks' steps and snow skirts (placement rule b); b1–b3 stand by barr_L_a's SE corner,
    // 1.5 m N of the alley's line (1 m E): the walk between the two barracks comes out past them (user 2026-10-07)
    ...[['b1', 42.8, 22.0], ['b2', 43.46, 22.31], ['b3', 42.05, 22.29], ['b4', 21.95, 32.95], ['b5', 21.94, 34.09]]
      .map(([id, x, z]) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 })),
  ],
  vehicles: [
    // x 37.2, not 37.5: the cell at x 37.5 is shore snow; 37.2 is in the shallow rim (spec Appendix A).
    { id: 'raft', vehicleType: 'raft', x: 37.2, z: 60.5, heading: deg(180), inflated: true, suspicious: false, operators: ['diver'] },
    { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 51, z: 139.5, heading: deg(22.6), driveable: true, seats: 6, hits: 30 },
    { id: 'kubel_decor', vehicleType: 'car', variant: 'kubelwagen', x: 20, z: 12, heading: deg(90), driveable: false },
    // the mounted MG inside the mg1 sandbag ring (manned by e13; the Driver can capture it)
    { id: 'mg1_gun', vehicleType: 'mgNest', x: 22, z: 39.5, heading: deg(90), gunner: 'e13', driveable: true },
  ],
  commandos: [
    { role: 'greenberet', x: 16, z: 158, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'diver', x: 61, z: 96, heading: deg(270), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
    { role: 'driver', x: 60, z: 158, heading: deg(270), inventory: { pistol: 1, smg: 20, firstAid: 6 } },
  ],
  // 13 enemies (Prima numbers in `prima`)
  enemies: [
    // the Marine's peninsula
    { id: 'e1', prima: 1, soldierType: 'soldier', x: 48, z: 58, heading: deg(0), flags: { holdsPost: true, investigates: false },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(48, 58, 4, 270), P(62, 57, 4, 270)] } },
    { id: 'e2', prima: 2, soldierType: 'soldier', x: 58, z: 76, heading: deg(180), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(58, 76, 3, 0), P(42, 78, 3, 180)] } },
    { id: 'e3', prima: 3, soldierType: 'sentry', x: 40, z: 60.5, heading: deg(270), partner: 'e1', flags: { holdsPost: true, investigates: false },
      post: { heading: deg(270), sweep: 35, period: 5 } },
    // north shore, across the water
    { id: 'e4', prima: 4, soldierType: 'soldier', x: 12, z: 42.5, heading: deg(0), flags: { investigates: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(12, 42.5, 3, 90), P(30, 42.5, 3, 90)] } },
    { id: 'e5', prima: 5, soldierType: 'soldier', x: 36, z: 40, heading: deg(0), flags: { holdsPost: true, investigates: false },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(36, 40, 3, 90), P(52, 37, 3, 90)] } },
    // south bank
    { id: 'e6', prima: 6, soldierType: 'sentry', x: 6, z: 146, heading: deg(270), flags: { investigates: true, holdsPost: false },
      post: { heading: deg(270), sweep: 35 } },
    { id: 'e7', prima: 7, soldierType: 'sentry', x: 27, z: 121, heading: deg(20), flags: { investigates: true, holdsPost: false },
      post: { heading: deg(20), sweep: 40 } },
    // patrol p2: walks N–S down to the truck and turns there
    { id: 'e8', prima: 8, soldierType: 'sergeant', x: 46, z: 112, heading: deg(90), squad: { id: 'p2', leader: 'e8', columns: 1 },
      flags: { followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(46, 112, 4, 270), P(49, 125), P(53, 137, 4, 90)] } },
    { id: 'e9', prima: 9, soldierType: 'trooper', x: 45.6, z: 110.5, heading: deg(90), squad: { id: 'p2', leader: 'e8', columns: 1 },
      flags: { followsTracks: true },
      route: { type: 'PINGPONG', vel: 1.0, points: [P(46, 112, 4, 270), P(49, 125), P(53, 137, 4, 90)] } },
    // patrol p3: circles the relay and the barracks
    ...['e10', 'e11', 'e12'].map((id, k) => ({
      id, prima: 10 + k, soldierType: k ? 'trooper' : 'sergeant', x: 5, z: 36 + k * 1.5, heading: deg(270),
      squad: { id: 'p3', leader: 'e10', columns: 1 }, flags: { followsTracks: true },
      route: { type: 'LOOP', vel: 1.0, points: [P(5, 36), P(5, 6), P(26, 3, 4, 270), P(46, 8), P(48, 18), P(46, 33, 4, 90), P(28, 37.5), P(5, 36)] },
    })),
    // MG gunner in the mg1 nest, covering the southern approach across the fjord
    { id: 'e13', prima: 13, soldierType: 'mg', x: 22, z: 39.5, heading: deg(90), emplacement: 'mg1_gun',
      post: { heading: deg(90), sweep: 35, giro: 180 } },
  ],
  items: [],
  zones: [], // Kildread: "the entire map is safe" — shouts and bodies trigger only local reactions
  jails: [], // no jail: patrols fire on sight, sentries hold
  barracks: {},
  climbLinks: [
    // wall_s (stone wall with a plank roof) — the GB climbs over it (§7.4 solution step 2). Both directions.
    { a: [18.18, 127.96, 0], b: [20.32, 129.04, 0], roles: ['greenberet'] },
    { a: [22.2, 120.41, 0], b: [24.3, 121.59, 0], roles: ['greenberet'] },
  ],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the relay station', type: 'destroy', targets: ['relay_hut', 'relay_mast'], required: true, endsMission: true },
  ],
  extraction: null, // the win fires 5 s after o1 completes with no commando dead (§8.1)
  rendezvous: { x: 32, z: 101, r: 4 }, // jetty_s (hint only; not an objective)
  par: { time: 155 }, // [data: PAR_TICKS 3100]
  cameraStart: { x: 30, z: 150, zoom: 1 },
  startDisguised: [],
};
