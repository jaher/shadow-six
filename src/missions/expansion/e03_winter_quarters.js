/**
 * LIGHTS OUT mission 3, "Winter Quarters" (docs/expansion/e03.md). Our own mission, built with the expansion-style
 * mechanics of the BCD ruleset (docs/bcd-plan.md §1, docs/expansion/MECHANICS.md).
 *
 * Zirkus Adria's winter quarters at Dolní Lhota on the Elbe meadows, Bohemia, 16 April 1944, 09:30, a bright spring
 * morning. Referat N runs a Protectorate intercept station out of the circus's riding hall (its masts stand on the
 * exercise ground east of it); the circus people stay on under requisition. The Spy, the Green Beret, the Marine and
 * the Sapper take the key-table binder from the chief's table (on alarm the chief drops it down the camp well), drop
 * the main mast with a time bomb and leave over the Elbe on the rope ferry. Oberst Ansbach takes coffee on the
 * villa's veranda with two Gestapo men: seen, not touched (killing him fails the mission).
 *
 * Layout (x east, z south; the river along the south edge, the camera looking north):
 *   W  the wagon park (painted living wagons in rows, mud lanes, the menagerie tent), the ostrich paddock and the
 *      stable tent north of it; the willows and the start in the SW corner
 *   C  the half-raised big top with the lions' ring; the lawn and the camp well between it and the villa
 *   N  the riding hall (the intercept station: its walls are structures, its inside walkable), the mast field E of it
 *   E  the owner's villa with its west veranda (Ansbach), the barn (the garrison), the orchard
 *   S  the towpath, the ferry landing and the rope ferry's cable across the Elbe
 *
 * Conventions: headings/rot in DEGREES converted with deg(); route `look` and `post.sweep` stay in degrees (as m01-m20).
 * Briefing in our own words (docs/expansion/README.md §0).
 * @module missions/expansion/e03_winter_quarters
 */
import { registerExpansionMission } from './registry.js';
import { E03 } from './e03-layout.js';
import { e03Script, checkMastCharge } from '../scripts/e03.js';
import { E03_DRESSING, E03_TREES, E03_TERRAIN, E03_PAVEMENTS, E03_ROADS, E03_FURNITURE, E03_PUDDLE_BARE } from '../../art/e03-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` in DEGREES (enemy-brain reads wp.look * DEG)

// ------------------------------------------------------------------ the riding hall (the intercept station)
const HALL = E03.HALL; // { x0: 60, x1: 100, z0: 8, z1: 32 }: brick base, timber upper, high hipped roof, roof lantern
const DOOR_W = 3.2; // riding-hall doors: wide enough for a horse and rider
/** The hall's walls as one structure of runs with the three door openings (W, S, E). */
const HALL_WALLS = [
  [[HALL.x0, HALL.z0], [HALL.x1, HALL.z0], [HALL.x1, E03.DOOR_E[1] - DOOR_W / 2]],
  [[HALL.x1, E03.DOOR_E[1] + DOOR_W / 2], [HALL.x1, HALL.z1], [E03.DOOR_S[0] + DOOR_W / 2, HALL.z1]],
  [[E03.DOOR_S[0] - DOOR_W / 2, HALL.z1], [HALL.x0, HALL.z1], [HALL.x0, E03.DOOR_W[1] + DOOR_W / 2]],
  [[HALL.x0, E03.DOOR_W[1] - DOOR_W / 2], [HALL.x0, HALL.z0]],
];

// ------------------------------------------------------------------ the camp
/** A painted living wagon (B.HIGH body: a man hides behind it). */
const wagon = (id, x, z, o = {}) => ({ id, type: 'crates', variant: 'circus_wagon', label: 'Living wagon', x, z, rot: 0, w: 7, d: 2.6, h: 3.4, block: 2, fixed: true, visual: false, ...o });
const WAGONS = [
  // row A (the trainer's wagon at its west end) — row B — row C (the manager's at its east end)
  // (a2 stands 1.2 m clear of the trainer's wagon and 1.8 m of a3: parked wagons, not a coupled train)
  wagon('wagon_a1', ...E03.TRAINER_WAGON, { label: 'The trainer\'s wagon', paint: 'oxblood' }), wagon('wagon_a2', 23.2, 45, { paint: 'mustard' }), wagon('wagon_a3', 32, 45, { paint: 'cream' }),
  wagon('wagon_c1', 12, 71, { paint: 'mustard' }), wagon('wagon_c2', 22, 71, { paint: 'cream' }), wagon('wagon_c3', 32, 71, { paint: 'oxblood' }),
  wagon('wagon_d1', 12, 80, { paint: 'cream' }), wagon('wagon_d2', 22, 80, { paint: 'oxblood' }), wagon('wagon_d3', ...E03.MANAGER_WAGON, { label: 'The manager\'s wagon', paint: 'mustard' }),
];
/** The ostrich paddock (field fence, its gate on the east side). */
const PADDOCK = E03.PADDOCK; // x 8-30, z 14-38
const GATE_P = E03.OSTRICH_GATE; // (30, 26)
const PEN_GAP = 1.7; // half the pen gate's width (PenGate w 3.2 + posts)

// ------------------------------------------------------------------ enemies
// (`s`: the head's swing AMPLITUDE, ± degrees about the heading; the design's sweep figures are whole arcs, halved here)
const sweep = (heading, s) => ({ heading: deg(heading), sweep: s });
const post = (id, type, x, z, heading, s, o = {}) => ({ id, soldierType: type, x, z, heading: deg(heading), post: sweep(heading, s), ...o });
const walker = (id, type, pts, o = {}) => ({ id, soldierType: type, x: pts[0].x, z: pts[0].z, heading: deg(pts[0].look ?? 0),
  flags: { investigates: true }, route: { type: o.loop ? 'LOOP' : 'PINGPONG', vel: o.vel ?? 1.0, points: pts }, ...o.extra });

const ENEMIES = [
  // --- 7.1 the gate and the road (zone z_gate)
  post('g1', 'sentry', 54, 4.5, 270, 20),
  post('g2', 'sentry', 58.5, 4.5, 90, 20),
  { ...post('mg_gate', 'mg', 62.5, 7.5, 90, 30), only: 'hard', post: { heading: deg(90), sweep: 30, giro: 180 } },
  walker('d1', 'soldier', [P(56, 9, 5, 90), P(56, 50, 5, 270)]),
  post('kh', 'soldier', ...E03.HANDLER, 90, 20, { flags: { investigates: true } }),
  ...E03.DOGS.map(([id, x, z]) => ({ id, soldierType: 'dog', x, z, heading: deg(90), caged: true, post: sweep(90, 20) })),
  // --- 7.2 the hall, the mast field, the lawn and the villa (zone z_hall)
  // the station's chief, Leutnant Brandt: at his table a minute, then he walks out by the S door to report at the villa
  walker('lt', 'lieutenant', [P(...E03.TABLE_STAND, 60, 90), P(80, 29.5), P(80, 36), P(93, 50), P(...E03.VERANDA_FOOT, 30, 0)], { vel: 1.0 }),
  ...E03.OPERATORS.map(([id, x, z]) => ({ ...post(id, 'soldier', x, z, 270, 0), hearingMul: 0.5 })),
  post('hd1', 'sentry', ...E03.HD1, 90, 25),
  post('hd2', 'sentry', 101.5, 20, 0, 20),
  walker('m1', 'soldier', [P(108, 10, 6, 270), P(140, 10, 6, 0)]),
  { ...post('m2', 'sentry', 128, 18, 90, 20), only: 'hard' },
  // h1 on the water tower's walkway, S of the tank
  { ...post('h1', 'sentry', E03.TOWER[0], E03.TOWER[1] + 2.15, 90, 30), elevated: true, y: E03.TOWER_DECK, overlooks: true },
  // Oberst Ansbach and his two Gestapo men: 90 s at the veranda's rail looking W over the lawn, then 60 s at the
  // French windows of the drawing room (their backs to the lawn) — three routes of one length, in step
  { id: 'ansbach', soldierType: 'officer', x: E03.ANSBACH_OUT[0], z: E03.ANSBACH_OUT[1], heading: deg(180), skin: 'general',
    route: { type: 'PINGPONG', vel: 0.8, points: [P(...E03.ANSBACH_OUT, 90, 180), P(...E03.ANSBACH_IN, 60, 0)] } },
  ...E03.ESCORT.map(([id, dz, look]) => ({ id, soldierType: 'gestapo', x: E03.ANSBACH_OUT[0], z: E03.ANSBACH_OUT[1] + dz, heading: deg(look),
    route: { type: 'PINGPONG', vel: 0.8, points: [P(E03.ANSBACH_OUT[0], E03.ANSBACH_OUT[1] + dz, 90, look), P(E03.ANSBACH_IN[0], E03.ANSBACH_IN[1] + dz, 60, 0)] },
    flags: { investigates: false } })),
  post('v1', 'sentry', 124, 51.5, 270, 20),
  post('t1', 'sergeant', ...E03.T1, E03.T1_LOOK, 20),
  // (b1 stands where the passage under the barn's bridge deck opens W of the ramp, looking N past it: under the deck
  // he could not be seen from above)
  post('b1', 'sentry', 121.3, 84.5, 270, 20),
  { ...walker('b2', 'soldier', [P(114, 87, 5, 90), P(136, 87, 5, 90)]), only: 'hard' },
  // --- 7.3 the camp, the towpath and the camp patrol (zone z_camp)
  // the camp patrol: sergeant + two troopers in file, ~4 min round the wagon park (immune to knock-outs)
  ...[['p1a', 0], ['p1b', 1], ['p1c', 2]].map(([id, k]) => ({
    id, soldierType: k ? 'trooper' : 'sergeant', x: E03.P1_LOOP[0].x - k * 1.2, z: E03.P1_LOOP[0].z, heading: deg(90),
    squad: { id: 'p1', leader: 'p1a', columns: 1 }, reactEvents: ['RCAMP'],
    route: { type: 'LOOP', vel: 1.0, points: E03.P1_LOOP }, alarmRoute: { run: { x: 30, z: 51, vel: 3 }, resume: true },
  })),
  // c1: the menagerie tent's east end, watching north up the camp's east lane (the hens, the stable tent's yard)
  post('c1', 'sentry', ...E03.C1, 270, 25),
  // c2 [Hard]: the menagerie tent's west door, watching the camp's west lane (he follows prints in its mud)
  { ...post('c2', 'sentry', 15.2, 60, 180, 20, { flags: { investigates: true, followsTracks: true } }), only: 'hard' },
  post('s1', 'sentry', 41.5, 16, 180, 25),
  // the animal trainer (keeper type: unarmed; sees a commando → shouts and runs for the barn) and the manager (snitch)
  { id: 'zk', soldierType: 'zookeeper', x: E03.KERB[0], z: E03.KERB[1], heading: deg(337), fleeTo: E03.BARN_DOOR, skin: 'trainer',
    route: { type: 'LOOP', vel: 0.9, points: E03.ZK_LOOP } },
  { id: 'mgr', soldierType: 'snitch', x: E03.MGR_LOOP[0].x, z: E03.MGR_LOOP[0].z, heading: deg(270), skin: 'manager',
    route: { type: 'LOOP', vel: 0.8, points: E03.MGR_LOOP } },
  post('r1', 'sentry', ...E03.R1, 0, 25),
  // r2 [Hard]: the towpath's east post below the lawn, watching the river (the Marine passes him under water)
  { ...post('r2', 'sentry', ...E03.R2, 90, 20), only: 'hard' },
  // --- the animals (not counted): three lions in the ring, four ostriches in the paddock, five hens by the stable tent
  ...[[63, 71], [69, 72.5], [66, 77.5]].map(([x, z], k) => ({ id: `lion${k + 1}`, soldierType: 'lion', x, z, heading: deg(90 * k), pen: { x: E03.RING[0], z: E03.RING[1], r: E03.RING_R } })),
  ...[[14, 20], [22, 24], [16, 31], [25, 33]].map(([x, z], k) => ({ id: `os${k + 1}`, soldierType: 'ostrich', x, z, heading: deg(70 * k),
    pen: { points: [[PADDOCK.x0 + 1, PADDOCK.z0 + 1], [PADDOCK.x1 - 1, PADDOCK.z0 + 1], [PADDOCK.x1 - 1, PADDOCK.z1 - 1], [PADDOCK.x0 + 1, PADDOCK.z1 - 1]] },
    penGate: 'ostrich_gate', roam: { x: 38, z: 30, r: 16 } })),
  ...[[50.2, 29.5], [52.4, 31], [50.8, 33.2], [52.6, 34.4], [51.2, 36]].map(([x, z], k) => ({ id: `ch${k + 1}`, soldierType: 'chicken', x, z, heading: deg(60 * k) })),
];

// ------------------------------------------------------------------ the def
const def = {
  id: 'e03', campaign: 'BCD', number: 3,
  title: 'Winter Quarters', place: 'Dolní Lhota, Bohemia', date: '1944-04-16',
  pin: { lat: 50.20, lon: 15.30 },
  context: 'Referat N has moved a listening station into the Protectorate, to hunt the Czech and Polish sets that London and Moscow drop into the hills. It sits in the riding hall of a circus in its winter quarters on the Elbe meadows.',
  subtitle: 'Dolní Lhota, Bohemia · 16 April 1944',
  theater: 'temperate',
  coneColors: 'green',
  size: [150, 120],
  seed: 1944_0416,
  briefing: {
    historical: 'April 1944. The Reich holds Bohemia as a protectorate and hunts every radio that talks to London. Its listeners are good at it: three sets were found in the hills this winter, and their operators were shot.',
    text: 'Four of you. The station\'s key-table binder lies on the chief\'s table in the riding hall. The chief, a Leutnant Brandt, walks over to the villa every few minutes to report. Take the binder, then drop the main mast with a charge at its foot: that puts the hall off the air for a season. The circus ground is full of eyes that are not soldiers. The trainer runs for the barracks if he sees you, and the manager sells whatever he sees. The lions are loose in the ring at this hour, so walk round it. Keep three paces from the birds. You leave by the rope ferry at the towpath. One thing more. The head of Referat N, Oberst Ansbach, takes his coffee on the villa\'s veranda with two men in black beside him. They see through any coat. You will see him, and you will not touch him. Dead, his index goes to Berlin and two hundred people hang. Alive, next year, he is ours.',
    objectivesSummary: 'Take the key-table binder from the riding hall. Drop the main mast. Everyone onto the rope ferry and across the Elbe.',
    hints: [
      'The trainer stands at the ring with his back to the camp while the lions work. If he sees you, he shouts and runs. Chloroform first.',
      'The manager in the bowler hat is an informer. He walks to the nearest sentry with whatever he has seen. He is a civilian: the fist works.',
      'A handcuffed man can be worked like a puppet (R) from within pistol range, as long as you can see him and nobody can see you. A sergeant on strings can talk to privates and patrols.',
      'If the hall\'s alarm sounds, the chief takes the binder to the well. Take the binder first; drop the mast last.',
      'The dogs are kennelled at the gate until the alarm. Then they are not.',
      'A private\'s tunic passes the privates. The chief, the Oberst and the men in black see through it.',
    ],
  },
  lighting: { sunElevDeg: 40, sunAzimuthDeg: 135, kelvin: 5600, hdri: 'clear_day', fog: 260, lut: 'temperate' },
  water: { velocity: 0.4, angleDeg: 0, turbulence: 0.25, color: '#3f6a5c' }, // the Elbe flows east, pale green
  ambient: { habitat: 'river', fish: true, birds: true },
  shoreShallowWidth: 3,
  baseTerrain: 'grass',
  // render-only: no grass tufts or litter on the riding hall's trodden floor (indoors; its earth takes no prints), nor
  // up through the villa veranda's deck (it lies at ground level from its rail to the villa's W wall), nor on the
  // menagerie tent's floor (seen through its doorways: trodden earth and old straw round the empty cage wagons), nor up
  // through the standing water of the puddles (art/e03-dressing.js E03_PUDDLES)
  bareGround: [[[E03.HALL.x0, E03.HALL.z0], [E03.HALL.x1, E03.HALL.z0], [E03.HALL.x1, E03.HALL.z1], [E03.HALL.x0, E03.HALL.z1]],
    [[E03.VERANDA.x0 - 0.25, E03.VERANDA.z0 - 0.25], [E03.VERANDA.x1, E03.VERANDA.z0 - 0.25], [E03.VERANDA.x1, E03.VERANDA.z1 + 0.25], [E03.VERANDA.x0 - 0.25, E03.VERANDA.z1 + 0.25]],
    [[E03.MEN_TENT[0] - 11.2, E03.MEN_TENT[1] - 4.6], [E03.MEN_TENT[0] + 11.2, E03.MEN_TENT[1] - 4.6], [E03.MEN_TENT[0] + 11.2, E03.MEN_TENT[1] + 4.6], [E03.MEN_TENT[0] - 11.2, E03.MEN_TENT[1] + 4.6]],
    ...E03_PUDDLE_BARE],
  vegetation: { farmland: false, reeds: true },
  terrain: [
    { type: 'rect', terrain: 'water', x: 0, z: E03.RIVER_Z, w: 150, d: 120 - E03.RIVER_Z }, // T1 the Elbe
    ...E03_TERRAIN,
  ],
  roads: E03_ROADS,
  pavements: E03_PAVEMENTS,
  furniture: E03_FURNITURE,
  markers: [
    // o2: the charge goes at the foot of the main mast (its concrete footing, the S side: out of the mast's legs)
    { id: 'mast_charge', x: E03.MAST_CHARGE[0], z: E03.MAST_CHARGE[1], r: 2.5, target: 'mast_c' },
  ],
  structures: [
    // --- the riding hall: its walls (drawn by art/e03-dressing.js with the roof, the lantern and the brick base)
    { id: 'hall', type: 'wall', variant: 'riding_hall', segments: HALL_WALLS, width: 0.7, h: 4.6, visual: false },
    // inside: the receivers on their trestles along the N wall, the chief's table, the jumps stacked in the SW corner
    ...E03.OPERATORS.map(([id, x], k) => ({ id: `trestle_${k + 1}`, type: 'crates', variant: 'radio_trestle', label: 'Receivers', x, z: 10.3, rot: 0, w: 4.2, d: 1.2, h: 1.0, block: 1, fixed: true, visual: false })),
    { id: 'chief_table', type: 'crates', variant: 'chief_table', label: 'The chief\'s table', x: E03.TABLE[0], z: E03.TABLE[1], rot: 0, w: 2.2, d: 1.1, h: 0.8, block: 1, fixed: true, visual: false },
    { id: 'wall_map', type: 'crates', variant: 'map_board', label: 'Wall map', x: 97.9, z: 26, rot: deg(90), w: 2.6, d: 0.4, h: 2.2, block: 1, fixed: true, visual: false },
    // the jumps: one stack in the SW corner, one against the wall W of the S door (a man lying behind it is out of sight
    // of the chief's table and of the door)
    { id: 'jumps', type: 'crates', variant: 'show_jumps', label: 'Show jumps', x: E03.JUMPS[0][0], z: E03.JUMPS[0][1], rot: 0, w: 4.4, d: 2.2, h: 1.4, block: 1, fixed: true, visual: false },
    { id: 'jumps_door', type: 'crates', variant: 'show_jumps', label: 'Show jumps', x: E03.JUMPS[1][0], z: E03.JUMPS[1][1], rot: deg(E03.JUMPS[1][2]), w: 2.8, d: 1.6, h: 1.4, block: 1, fixed: true, visual: false },
    // --- the mast field (chain-link, the gate on the hall's E door open), three lattice masts and the generator hut
    { id: 'mast_fence', type: 'fence', variant: 'chainlink', h: 2.0,
      segments: [[[104, 22.4], [104, 40], [144, 40], [144, 6], [104, 6], [104, 17.6]]] },
    { id: 'mast_a', type: 'radio_mast', variant: 'lattice_mast', label: 'Mast', x: 112, z: 22, rot: 0, r: 1.0, h: 22, block: 2 },
    { id: 'mast_c', type: 'radio_mast', variant: 'lattice_mast', label: 'Main mast', x: E03.MAST_C[0], z: E03.MAST_C[1], rot: 0, r: 1.2, h: 26, block: 2,
      destructible: true, bombOnly: true, marker: 'mast_charge', destroyedBy: ['explosion'], collapses: true, hp: 100 },
    { id: 'mast_b', type: 'radio_mast', variant: 'lattice_mast', label: 'Mast', x: 138, z: 30, rot: 0, r: 1.0, h: 22, block: 2 },
    { id: 'genhut', type: 'hut', variant: 'generator_hut', label: 'Generator hut', x: 118, z: 35.5, rot: 0, w: 4, d: 3, h: 3, asset: 'hut_brick_be', hum: true },
    // --- the water tower between the hall and the lawn (h1 on its deck)
    { id: 'water_tower', type: 'fueltank', variant: 'water_tower_legs', label: 'Water tower', x: E03.TOWER[0], z: E03.TOWER[1], rot: 0, r: 2.4, h: 10, block: 2, visual: false },
    // --- the big top (half-raised: its king poles, the bandstand) and the lions' ring (a kerb: a step, not a wall)
    ...E03.KING_POLES.map(([x, z], k) => ({ id: `king_pole_${k + 1}`, type: 'telegraph_pole', variant: 'king_pole', x, z, r: 0.3, h: 13, block: 2, visual: false })),
    ...E03.SIDE_POLES.map(([x, z], k) => ({ id: `side_pole_${k + 1}`, type: 'telegraph_pole', variant: 'side_pole', x, z, r: 0.12, h: 3.6, block: 2, visual: false })),
    { id: 'bandstand', type: 'crates', variant: 'bandstand', label: 'Bandstand', x: 66, z: 87.5, rot: 0, w: 6, d: 2.6, h: 1.0, block: 2, fixed: true, visual: false },
    // (a fence, not a wall: it stops feet, not eyes — a 0.6 m step round the sawdust)
    { id: 'ring', type: 'fence', variant: 'ring_kerb', points: E03.RING_KERB, width: 0.45, h: 0.6, visual: false, wire: false },
    // --- the camp: the menagerie tent (its three empty cage wagons inside: art), the living wagons (washing hung
    //     between those of rows C and D: art)
    { id: 'men_tent', type: 'tent', variant: 'menagerie_tent', label: 'Menagerie tent', x: E03.MEN_TENT[0], z: E03.MEN_TENT[1], rot: 0, w: 22, d: 9, h: 5.5, visual: false },
    ...WAGONS,
    // the ostrich paddock: field fence, closed but for the pen gate's gap on the E side
    { id: 'paddock', type: 'fence', variant: 'paddock_rail', h: 1.6, width: 0.25,
      segments: [[[PADDOCK.x1, GATE_P[1] - PEN_GAP], [PADDOCK.x1, PADDOCK.z0], [PADDOCK.x0, PADDOCK.z0], [PADDOCK.x0, PADDOCK.z1], [PADDOCK.x1, PADDOCK.z1], [PADDOCK.x1, GATE_P[1] + PEN_GAP]]] },
    { id: 'stable_tent', type: 'tent', variant: 'stable_tent', label: 'Stable tent', x: 42, z: 22, rot: 0, w: 14, d: 10, h: 5.5, visual: false },
    // the hens' yard south of the stable tent: a low wattle hurdle (they scatter through its gaps)
    // --- the lawn: the camp well (the binder's grave) and the hay cart (the puppet controller's cover)
    { id: 'well', type: 'well', variant: 'well_village', label: 'Camp well', x: E03.WELL[0], z: E03.WELL[1], rot: 0, r: 0.9, h: 1.0 },
    { id: 'hay_cart', type: 'crates', variant: 'hay_cart', label: 'Hay cart', x: E03.HAY_CART[0], z: E03.HAY_CART[1], rot: deg(20), w: 4.0, d: 2.0, h: 2.5, block: 2, fixed: true, visual: false },
    // --- the owner's villa (cream render, slate, its timber veranda on the W face) and the barn (the garrison)
    { id: 'villa', type: 'villa', variant: 'circus_villa', label: 'The owner\'s villa', x: E03.VILLA[0], z: E03.VILLA[1], rot: 0, w: 20, d: 15, h: 9, visual: false },
    { id: 'villa_porch', type: 'crates', variant: 'villa_porch', label: 'Porch', x: 124, z: 53.85, rot: 0, w: 3.4, d: 1.3, h: 0.5, block: 1, fixed: true, visual: false },
    { id: 'veranda_rail', type: 'fence', variant: 'veranda_rail', segments: E03.VERANDA_RAILS, h: 1.0, width: 0.2, visual: false, wire: false },
    // (`artRot`: the model only, a half turn — its big doors and ramp face the barn road on the N, where the garrison
    // door is (E03.BARN_DOOR) and b1 stands; the 14 × 9 footprint is the same either way)
    { id: 'barn', type: 'barracks', variant: 'winter_barn_timber', label: 'Barn', x: E03.BARN[0], z: E03.BARN[1], rot: 0, artRot: Math.PI, w: 14, d: 9, h: 8, asset: 'barn_b', garrison: true, flag: false },
    // its earth ramp (drawn by the model): nobody walks through its stone sides — a wall's height where it meets the
    // bridge, low cover down the slope to its foot; the passage under the bridge deck stays open (E03.BARN_RAMP)
    { id: 'barn_ramp', type: 'crates', variant: 'barn_ramp', label: 'Barn ramp', x: (E03.BARN_RAMP.x0 + E03.BARN_RAMP.x1) / 2, z: (E03.BARN_RAMP.zLow + E03.BARN_RAMP.z1) / 2,
      rot: 0, w: E03.BARN_RAMP.x1 - E03.BARN_RAMP.x0, d: E03.BARN_RAMP.z1 - E03.BARN_RAMP.zLow, h: 2.4, block: 2, fixed: true, visual: false },
    { id: 'barn_ramp_foot', type: 'crates', variant: 'barn_ramp', label: 'Barn ramp', x: (E03.BARN_RAMP.x0 + E03.BARN_RAMP.x1) / 2, z: (E03.BARN_RAMP.z0 + E03.BARN_RAMP.zLow) / 2,
      rot: 0, w: E03.BARN_RAMP.x1 - E03.BARN_RAMP.x0, d: E03.BARN_RAMP.zLow - E03.BARN_RAMP.z0, h: 1.2, block: 1, fixed: true, visual: false },
    // --- the gate on the north road and its guard hut; the kennel yard W of it
    { id: 'gate_n', type: 'gate', variant: 'barrier_boom', x: 56, z: 1.5, rot: 0, w: 5, open: false },
    { id: 'gate_hut', type: 'hut', variant: 'guard_hut', label: 'Guard hut', x: 61.5, z: 3.5, rot: 0, w: 3.6, d: 2.8, h: 3.2, asset: 'guard_hut_a' },
    { id: 'kennel_fence', type: 'fence', variant: 'chainlink', h: 1.9,
      segments: [[[E03.KENNEL_GATE[0] - 1.4, E03.KENNEL.z1], [E03.KENNEL.x0, E03.KENNEL.z1], [E03.KENNEL.x0, E03.KENNEL.z0], [E03.KENNEL.x1, E03.KENNEL.z0], [E03.KENNEL.x1, E03.KENNEL.z1], [E03.KENNEL_GATE[0] + 1.4, E03.KENNEL.z1]]] },
    // the kennel's gate: locked; the handler opens it on an alarm (bcd_kennel), nobody else does
    { id: 'kennel_gate', type: 'gate', variant: 'chainlink', x: E03.KENNEL_GATE[0], z: E03.KENNEL_GATE[1], rot: 0, w: 2.8, h: 1.9, open: false, locked: true },
    // the dogs' two kennels: a gameplay box each, drawn by art/e03-kit.js (addSmallProp 'dog_kennel')
    { id: 'kennel_a', type: 'crates', variant: 'dog_kennel', label: 'Kennel', x: 46, z: 3.5, rot: 0, w: 1.6, d: 1.4, h: 1.4, block: 1, fixed: true, visual: false },
    { id: 'kennel_b', type: 'crates', variant: 'dog_kennel', label: 'Kennel', x: 52, z: 3.5, rot: 0, w: 1.6, d: 1.4, h: 1.4, block: 1, fixed: true, visual: false },
    // --- the river: the ferry landing (a timber stage, its steps into the water at its W end)
    { id: 'landing', type: 'pier', variant: 'landing_stage_timber', x: E03.LANDING[0], z: E03.LANDING[1], rot: deg(90), w: 6, d: 3.4, h: 0.4, visual: false },
    ...E03_DRESSING,
    ...E03_TREES,
  ],
  commandos: [
    { role: 'spy', x: 8, z: 91.5, heading: deg(0), inventory: { pistol: 1, lethalInjection: 1, firstAid: 6, cigarettes: 0 } },
    { role: 'greenberet', x: 5.5, z: 93, heading: deg(0), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    // (one remote charge: the kit never mixes time and remote bombs (items.normalizeSapperInventory); he fires it from the ferry)
    { role: 'sapper', x: 9, z: 95, heading: deg(0), inventory: { pistol: 1, remoteBomb: 1, grenade: 3, wireCutters: 1, bearTrap: 1, cigarettes: 2 } },
    { role: 'diver', x: 5.5, z: 96.5, heading: deg(90), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  ],
  enemies: ENEMIES,
  vehicles: [
    // the rope ferry: a flat punt hauled along its cable (the Marine at the rope), moored at the landing's steps
    { id: 'ferry', vehicleType: 'rope_ferry', x: E03.FERRY[0], z: E03.FERRY[1], heading: deg(90), operators: ['diver'], seats: 8, boardAny: true, friendly: true, suspicious: false },
  ],
  items: [
    // the key-table binder on the chief's table (anyone picks it up)
    { id: 'binder', itemId: 'documents', label: 'Key-table binder', x: E03.BINDER[0], z: E03.BINDER[1], y: 0.82, count: 1 },
  ],
  interactables: [
    { kind: 'penGate', id: 'ostrich_gate', x: GATE_P[0], z: GATE_P[1], rot: deg(90) },
  ],
  objectives: [
    { id: 'o1', text: 'Take the key-table binder from the chief\'s table in the riding hall', type: 'script', required: true },
    { id: 'o2', text: 'Drop the main mast', type: 'destroy', targets: ['mast_c'], marker: 'mast_charge', required: true, bombOnly: true },
    { id: 'o3', text: 'Everyone onto the ferry and across the Elbe', type: 'escape', vehicleId: 'ferry', required: true },
  ],
  // the ferry is there from the start; it has left once it is inside `exit` (the far bank) with men aboard
  extraction: { vehicleId: 'ferry', vehicleType: 'rope_ferry', friendly: true, exit: { x: E03.EXIT[0], z: E03.EXIT[1], r: 5 } },
  zones: [
    { id: 'z_gate', poly: [[38, 0], [58, 0], [58, 42], [38, 42]], onSeen: 'RGATE', onHeard: 'RGATE', siren: false },
    // (the hall's alarm is the siren event RINT: docs/expansion/e03.md calls it RHALL)
    { id: 'z_hall', poly: [[58, 0], [150, 0], [150, 97], [100, 97], [100, 86], [58, 86]], onSeen: 'RINT', onHeard: 'RINT', siren: true, alarmPoint: [80, 38] },
    { id: 'z_camp', poly: [[6, 0], [38, 0], [38, 42], [58, 42], [58, 86], [100, 86], [100, 97], [150, 97], [150, E03.RIVER_Z], [6, E03.RIVER_Z]], onSeen: 'RCAMP', onHeard: 'RCAMP', siren: false },
  ],
  jails: [],
  barracks: {
    // (the squads come out of the byre doors under the bridge deck and leave the passage W or E of the ramp)
    barn: { pool: 8, squads: [
      { event: 'RINT', size: 3, door: E03.BARN_BYRES[0], exitRoute: [P(...E03.BARN_PASSAGE[0]), P(110, 56)], loop: [P(80, 37), P(58, 20), P(102, 22), P(96, 50)] },
      { event: 'RINT', size: 3, door: E03.BARN_BYRES[1], exitRoute: [P(...E03.BARN_PASSAGE[1]), P(140, 52), P(146, 42)], loop: [P(146, 30), P(146, 4), P(106, 4), P(106, 44)] },
      { event: 'RGATE', size: 2, door: E03.BARN_BYRES[0], exitRoute: [P(...E03.BARN_PASSAGE[0]), P(110, 56), P(56, 56)], loop: [P(56, 10), P(56, 50)] },
      { event: 'RCAMP', size: 2, door: E03.BARN_BYRES[0], exitRoute: [P(...E03.BARN_PASSAGE[0]), P(110, 56), P(56, 56)], loop: [P(48, 51), P(8, 51), P(8, 76), P(48, 76)] },
    ] },
  },
  climbLinks: [],
  ladders: [],
  triplines: [],
  setpieces: [
    // o1: done once a commando holds the binder
    { type: 'bcd_item_objective', id: 'binder_taken', item: 'binder', itemId: 'documents', objective: 'o1' },
    // the well: on the hall's alarm the chief takes the binder from his table to the camp well (quiet or lose)
    { type: 'bcd_errand', id: 'well_errand', actor: 'lt', item: 'binder', itemId: 'documents', objective: 'o1', events: ['RINT'],
      fetch: [[80, 36], [80, 29.5], E03.TABLE_STAND], carry: [[80, 29.5], [80, 36]], to: [E03.WELL[0], E03.WELL[1] - 1.4],
      wait: { easy: 15, hard: 8 }, fail: 'THE KEY TABLES ARE AT THE BOTTOM OF THE WELL.' },
    // the kennel: on any alarm the handler lets the dogs out (Easy: 20 s later)
    { type: 'bcd_kennel', id: 'kennel', dogs: E03.DOGS.map(([id]) => id), handler: 'kh', gate: E03.KENNEL_GATE, handlerAt: [E03.KENNEL_GATE[0], E03.KENNEL_GATE[1] + 1.5],
      events: ['RGATE', 'RCAMP', 'RINT'], delay: { easy: 20, hard: 0 } },
    // Oberst Ansbach and his escort go indoors on any alarm and stay there
    { type: 'bcd_withdraw', id: 'ansbach_indoors', events: ['RGATE', 'RCAMP', 'RINT'],
      units: [['ansbach', E03.ANSBACH_IN, 0], ...E03.ESCORT.map(([id, dz]) => [id, [E03.ANSBACH_IN[0], E03.ANSBACH_IN[1] + dz], 0])] },
    // the rope ferry rides its cable across the Elbe
    { type: 'bcd_cable_ferry', id: 'ferry_cable', vehicle: 'ferry', line: E03.CABLE, speed: 1.4 },
  ],
  triggers: [
    // Oberst Ansbach is not to be touched (docs/expansion/e03.md §6)
    { on: 'unit:killed', match: { unit: 'ansbach' }, do: [{ fail: 'LONDON WANTS ANSBACH ALIVE, AND LATER. HIS INDEX IS ON ITS WAY TO BERLIN.' }] },
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'The key tables are ours. Now the main mast.', kind: 'objective' }] },
    { on: 'objective', match: { id: 'o2', status: 'done' }, do: [{ message: 'The main mast is down. Everyone onto the ferry.', kind: 'objective' }] },
    // soft-lock guard: the one charge gone off with the main mast still standing (fired off its mark): nothing else
    // can drop it, so the mission fails (scripts/e03.js checkMastCharge, as M20's T7)
    { on: 'bomb:exploded', once: false, delay: 0.5, do: [{ run: (w, dir) => checkMastCharge(w, dir) }] },
  ],
  script: e03Script,
  // the trees, wagons and posters on the bank west of the landing: the start in the willows
  cameraStart: { x: 16, z: 82, zoom: 1 },
  // (par from the reference solution, tools/solutions/e03.solution.mjs: it wins at about 1049 s on Hard and 1511 s on
  // Easy — the trainer's round and the chief's walks to the villa set the pace, Easy's 2.5× halts most of all)
  par: { time: 1080 },
  variants: {
    // Easy: routes 0.8×, waits 2.5× (the chief away ~3.5 min, Ansbach in ~2.5 min); softer sweeps on two posts
    easy: { par: { time: 1560 }, routeSpeedMul: 0.8, pauseMul: 2.5,
      enemyPatch: { h1: { post: sweep(90, 20) }, hd1: { post: sweep(90, 15) } } },
    hard: { par: { time: 1080 },
      enemyPatch: { t1: { post: sweep(E03.T1_LOOK, 35) }, r1: { heading: deg(20), post: sweep(20, 25) } } },
  },
};

registerExpansionMission(def);
export default def;
