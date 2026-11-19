/**
 * LIGHTS OUT mission 1: "Dry Stone" (docs/expansion/e01.md). Contrada Sant'Elia, Valle d'Itria, Puglia, 14 September
 * 1943, 16:30. An inland karst valley of trulli, olive groves and dry-stone walls; a Referat N detachment packs up in a
 * fortified farm (masseria). The tutorial slot: Green Beret, Driver, Sapper.
 *
 * Take Hauptmann Steinmetz alive and put him in the detachment's lorry (deliver), take the key tables from the radio
 * room before he burns them on the alarm (the `evidence` set-piece, missions/setpieces-bcd.js), put a time bomb on the
 * masts' coupling hut on the threshing floor (the mission's long fuse, `timeBombFuse`), and drive out by the north road
 * in the German lorry, past the cistern tower: a German lorry passes where a walker cannot.
 *
 * Layout (metres from the NW corner, +x east, +z south; headings in degrees from +x towards +z, `deg()` for the
 * radians the engine wants; route `look` and `post.sweep` stay in degrees):
 *   - SW: the olive grove (the team's start) and the looted hamlet (trulli round a piazza with a well, a chapel): two
 *     foragers and no alarm zone at all, the practice area
 *   - the white road: W edge → piazza → the checkpoint boom (zone z_road) → the masseria's gate → E, then N past the
 *     cistern tower (zone z_exit) to the exit at the NE edge
 *   - centre-E: the masseria (zone z_mas, RMAS + siren): 3 m rubble walls, an arched gate in the S wall; the main house
 *     along the N wall, the watch tower at its E end (a sentry on top), the radio room S of the tower (walled, roofed,
 *     walkable inside: Steinmetz and his operator at their tables), the officers' wing down the E side, the stables
 *     (the garrison) down the W side, the DF van and the lorry in the courtyard
 *   - W of the masseria: the threshing floor inside a wire fence (zone z_mast), two lattice masts and their coupling hut
 *   - N and E: stubble fields cut by dry-stone walls (low cover, art/e01-dressing.js), almond trees, a ruined trullo
 *     on a rocky knoll
 * Engine notes (the design's figures tuned to the engine): buildings have no walkable interiors, so the radio room is
 * a walled annex with a doorway (its walls `wall` runs, its roof a visual slab); the lieutenant waits in the officers'
 * wing's doorway; the lorry driver dozes on a bale by the stables; the knoll is a rocky rise at ground level.
 * @module missions/expansion/e01_dry_stone
 */
import { registerExpansionMission } from './registry.js';
import { E01_DRESSING } from '../../art/e01-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null, sweep) => ({ x, z, wait, look, ...(sweep != null ? { sweep } : {}) }); // `look`, `sweep` (each side, at the halt) in DEGREES

/**
 * The afternoon's heat haze: over these bleached fields every guard's sight carries 28 m (14 m for a man lying down)
 * instead of 36 / 18 — the design's ~30 m bands (docs/expansion/e01.md §8). Applied to every spawn below.
 */
export const HAZE = { far: 28, near: 14 };
/** Where a woken forager shouts "Alarm!": the piazza by the well (no zone hears it; the hamlet is the practice area). */
const PIAZZA_ALARM = [53.6, 107.6];
const hazed = (e) => ({ ...e, vision: { ...HAZE, ...(e.vision || {}) } });

/**
 * A post: heading and sweep in degrees. `sweep` is the head's swing each side (the engine's amplitude, ±): with the 70°
 * cone a post covers heading ± (35 + sweep) — the design's arcs (docs/expansion/e01.md §7) set each value.
 */
const post = (id, soldierType, x, z, headingDeg, sweep, extra = {}) => ({
  id, soldierType, x, z, heading: deg(headingDeg), post: { heading: deg(headingDeg), sweep }, ...extra,
});

/** A 16-gon round a centre (pavements). */
const disc = (x, z, r, n = 16) => Array.from({ length: n }, (_, k) => [+(x + Math.cos((k / n) * Math.PI * 2) * r).toFixed(2), +(z + Math.sin((k / n) * Math.PI * 2) * r).toFixed(2)]);

/** The white road: from the W edge through the piazza and the checkpoint to the gate, then E and N to the exit. */
// (it dog-legs round the jazzo at the hamlet's north-east corner: no straight sight line from the checkpoint into the piazza)
export const ROAD_IN = [[0, 110], [50, 110], [58, 108.4], [63.5, 108.9], [68.5, 107.2], [71.2, 102.6], [73.2, 96.8], [80, 84.2], [88, 79.8]];
/** The jazzo: the hamlet's high-walled dry-stone sheepfold (2.3 m), its gate on the west side. */
export const JAZZO = [[63.2, 99.3], [65.8, 99.4], [68.6, 99.8], [68.4, 102.9], [68.2, 106.0], [66.5, 105.95], [64.6, 105.8], [62.9, 105.7], [63.0, 103.5]];
/** (its south wall has fallen in between JAZZO[5] and JAZZO[6]: a breach onto the piazza, its stones in a heap) */
export const ROAD_OUT = [[88, 79.8], [96, 82.6], [106, 79], [113.6, 71.5], [114.2, 60], [114.2, 0]];

/** The masseria (gameplay boxes). */
export const MAS = {
  wall: [[84.8, 76], [76, 76], [76, 40], [110, 40], [110, 76], [91.2, 76]],
  gate: { x: 88, z: 76 },
  room: { x0: 102.95, x1: 109.05, z0: 48.2, z1: 54.8, door: [50.1, 51.9] }, // the radio room's wall lines, its W doorway
  stove: [107.3, 53.95],   // where Steinmetz stands to burn the tables (W of the stove)
  table: [105.6, 52.2],    // the map table, the key-table case on it
};
/** The courtyard sentries' loop (y1, and y2 in the opposite phase). */
// (at each corner he looks out: at the house, the radio room, the south wall, the stables' end; 15° each side)
const YARD_LOOP = [P(86, 57.6, 5, 270, 15), P(99.6, 57.6, 5, 0, 15), P(99.6, 72.6, 5, 90, 15), P(86, 72.6, 5, 180, 15)];

const def = {
  id: 'e01', campaign: 'BCD', number: 1,
  title: 'Dry Stone', place: "Contrada Sant'Elia, Valle d'Itria, Italy", date: '1943-09-14',
  pin: { lat: 40.78, lon: 17.24 },
  context: 'Puglia, the second week of September 1943. Italy has changed sides, our army is ashore at Taranto and Bari, and the Germans are pulling north through the olive country, taking what they can and burning the rest.',
  subtitle: "Contrada Sant'Elia, Valle d'Itria · 14 September 1943",
  theater: 'temperate',
  coneColors: 'green',
  size: [120, 140],
  seed: 1943_0914,
  briefing: {
    historical: 'Among the units pulling out is a small detachment of Referat N, the radio counter-intelligence group that has been finding our agents\' transmitters across the Adriatic all summer. It has been working from a fortified farm among the trulli of the Valle d\'Itria, and it leaves tonight.',
    text: 'Three of you, in daylight, across a valley of dry-stone walls. The station chief is a Hauptmann Steinmetz. He knows how Referat N finds a set, and London wants him talking, so he comes with you alive. His key tables are in the radio room beside the farm\'s tower: bring them. The masts stand on the old threshing floor outside the walls, fed from a coupling hut. A charge there and the station never comes back on the air. Then take their own lorry out of their own gate and up the north road. You have new tools for quiet work: a fist, a cosh, handcuffs, a pocketful of stones. Learn them in the hamlet, where two foragers are robbing the houses and nobody is listening.',
    objectivesSummary: 'Take Hauptmann Steinmetz alive and put him in the lorry. Take the key tables from the radio room. Blow the mast coupling hut. Drive everyone out in the lorry by the north road.',
    hints: [
      'A man you knock out wakes in about half a minute and shouts. Handcuff him and he stays quiet until a comrade finds him. The cuffs take his cigarettes; you will want them later.',
      'A stone thrown near a guard makes him look at it. Three in quick succession bring a walking guard over to search; a sentry at his post only looks.',
      'The field walls are low. A man lying behind one is hidden; a man standing is not.',
      'The Driver\'s rifle kills with one round at thirty paces and is heard at twenty. Count the men within twenty paces before you fire.',
      'If the farm\'s alarm sounds, Steinmetz burns his tables. Get to him first.',
      'The Sapper\'s charges are long-fused today, four minutes: set the hut\'s when the farm is all but yours, and be gone when it blows.',
      'A cuffed man fits through a doorway: carry him into a trullo, the sentry box or a field hut and nobody will find him.',
      'In this heat haze a sentry\'s eyes carry less far than usual. Use it.',
      'Carry a handcuffed prisoner to the lorry and put him in the back. Nobody stops a German lorry on a German road. They stop men on foot.',
    ],
  },
  lighting: { sunElevDeg: 34, sunAzimuthDeg: 235, kelvin: 5200, hdri: 'clear', fog: 320, lut: 'temperate_late_summer' },
  vegetation: { dry: 0.78, flowers: 0.15 }, // September stubble, parched (art/terrain/veg-profile.js)
  ambience: [['crickets', 0.3]],            // the afternoon's cicadas
  baseTerrain: 'ground',
  terrain: [
    // the stubble fields (dry grass) N of the farm and S of the road
    { type: 'rect', terrain: 'grass', x: 0, z: 0, w: 120, d: 33 },
    { type: 'rect', terrain: 'grass', x: 82, z: 87, w: 38, d: 53 },
    { type: 'rect', terrain: 'grass', x: 0, z: 34, w: 42, d: 50 },
    // (the white road is the gravel drawn by `roads`: a terrain `road` path under it showed as a rutted mud track)
  ],
  roads: [
    { id: 'road_in', surface: 'gravel', points: ROAD_IN, width: 4.5, wear: 0.15 },
    { id: 'road_out', surface: 'gravel', points: ROAD_OUT, width: 4.5, wear: 0.12 },
  ],
  pavements: [
    { id: 'courtyard', surface: 'setts', points: [[76.5, 49.8], [109.5, 49.8], [109.5, 75.6], [76.5, 75.6]], cracks: 0.35, weeds: 0.3, patches: 0 },
    { id: 'threshing_floor', surface: 'setts', points: disc(58, 52, 8), cracks: 0.25, weeds: 0.45 },
    { id: 'piazza', surface: 'setts', points: disc(56, 110, 6.5), cracks: 0.3, weeds: 0.4 },
  ],
  structures: [
    // --- the masseria (zone z_mas): the compound wall with its arched gate
    { id: 'mas_wall', type: 'wall', variant: 'masseria_rubble', h: 3.0, width: 0.7, segments: [MAS.wall] },
    { id: 'mas_gate', type: 'masseria_gate', x: MAS.gate.x, z: MAS.gate.z, rot: 0, w: 6.4, d: 1.2, h: 4.8, open: 4.0,
      navParts: [{ x: -2.6, z: 0, w: 1.2, d: 1.2, block: 2 }, { x: 2.6, z: 0, w: 1.2, d: 1.2, block: 2 }] },
    // a stone buttress against the gate's west pier, outside (the gate's old mounting block on its top)
    { id: 'gate_buttress', type: 'e01_prop', variant: 'buttress', x: 85.0, z: 77.5, rot: 0, w: 1.2, d: 2.2, h: 2.4, block: 2 },
    { id: 'house', type: 'masseria_house', x: 88.5, z: 45.2, rot: 0, w: 21, d: 8.4, h: 7, stair: 'W', enterable: true },
    { id: 'tower', type: 'masseria_tower', x: 105.9, z: 44.1, rot: 0, w: 6.6, d: 6.6, h: 11, top: 10, stair: 'W' },
    // the radio room: plastered walls with a W doorway (z 50.1–51.9), its roof slab, the set, the map table, the stove
    { id: 'radio_walls', type: 'wall', variant: 'masseria_room', h: 3.4, width: 0.45,
      points: [[MAS.room.x0, MAS.room.door[1]], [MAS.room.x0, MAS.room.z1], [MAS.room.x1, MAS.room.z1], [MAS.room.x1, MAS.room.z0], [MAS.room.x0, MAS.room.z0], [MAS.room.x0, MAS.room.door[0]]] },
    { id: 'radio_roof', type: 'masseria_roof', x: 106, z: 51.5, rot: 0, w: 6.55, d: 7.05, h: 3.4, pipe: [1.7, 2.45], clipAllow: ['tower'] },
    { id: 'radio_set', type: 'e01_prop', variant: 'radio_set', x: 108.3, z: 50.2, rot: deg(90), w: 1.4, d: 0.6, block: 1 },
    { id: 'map_table', type: 'e01_prop', variant: 'map_table', x: MAS.table[0], z: MAS.table[1], rot: deg(90), w: 1.6, d: 1.0, block: 1 },
    { id: 'stove', type: 'e01_prop', variant: 'stove', x: 108.15, z: 54.0, rot: deg(180), w: 0.7, d: 0.7, h: 3.4, block: 1 },
    { id: 'officers_wing', type: 'masseria_house', x: 106.1, z: 64.5, rot: deg(90), w: 16, d: 6.4, h: 6, stair: 'none', enterable: true },
    { id: 'stables', type: 'masseria_stable', x: 80.6, z: 62, rot: deg(-90), w: 18, d: 7, h: 5, garrison: true, flag: false },
    // --- the threshing floor (zone z_mast): the wire fence (its gate open on the E side), the masts, the coupling hut
    { id: 'floor_fence', type: 'fence', variant: 'chainlink', h: 2.0, segments: [[[72, 57.8], [72, 34], [44, 34], [44, 70], [72, 70], [72, 62.2]]] },
    { id: 'mast_w', type: 'radio_mast', x: 50, z: 45, h: 22 },
    { id: 'mast_e', type: 'radio_mast', x: 66, z: 45, h: 22 },
    { id: 'coupler', type: 'hut', variant: 'comms_hut_antenna', asset: 'comms_hut_antenna_bq', nav: false, label: 'Coupling hut', x: 58, z: 40.8, rot: 0,
      w: 4.2, d: 3.4, h: 3.2, mat: 'wood', destructible: true, bombOnly: true, hp: 100 },
    // --- the road: the checkpoint's boom and sentry box (zone z_road), the cistern tower by the north road (z_exit)
    { id: 'boom', type: 'gate', variant: 'barrier_boom', x: 72.6, z: 98.6, rot: deg(19), w: 5, open: false },
    { id: 'sentry_box', type: 'hut', variant: 'sentry_box', x: 77.0, z: 99.6, rot: deg(200), w: 1.6, d: 1.6, h: 2.4, enterable: true }, // (its open front to the north-west: a cuffed man fits inside)
    // the jazzo (sheepfold) at the hamlet's north-east corner: 2.3 m dry-stone walls, a gate to the west
    { id: 'jazzo', type: 'wall', variant: 'drystone_field', h: 2.3, width: 0.8, segments: [JAZZO.slice(0, 6), JAZZO.slice(6), [[63.1, 100.9], JAZZO[0]]] },
    { id: 'cistern', type: 'cistern_tower', x: 104, z: 24, r: 3, h: 8 },
    // a casedda (the small stone field trullo of these fields) by the compound's south-west corner: a cuffed man fits inside
    { id: 'casedda', type: 'trullo', x: 78.4, z: 80.6, r: 2.1, h: 3.8, doorDeg: 270, enterable: true, small: true },
    // --- the hamlet (no zone): eight trulli round the piazza, the chapel, the well; two trulli open (bodies inside)
    { id: 't1', type: 'trullo', x: 57, z: 99.4, r: 3.4, h: 6, doorDeg: 90, enterable: true },
    { id: 't2', type: 'trullo', x: 50.4, z: 104.6, r: 2.9, h: 5.4, doorDeg: 70 },
    { id: 't3', type: 'trullo', x: 73.8, z: 113.8, r: 3.2, h: 5.8, doorDeg: 180 },
    { id: 't4', type: 'trullo', x: 44.6, z: 118.6, r: 3.3, h: 5.9, doorDeg: 330, chimney: 200 },
    { id: 't5', type: 'trullo', x: 56.6, z: 121.6, r: 3.5, h: 6.1, doorDeg: 270, door: deg(270), enterable: true },
    { id: 't6', type: 'trullo', x: 67.6, z: 119.6, r: 3.1, h: 5.6, doorDeg: 200 },
    { id: 't7', type: 'trullo', x: 37.0, z: 126.0, r: 3.0, h: 5.5, doorDeg: 315 },
    { id: 't8', type: 'trullo', x: 48.4, z: 130.2, r: 3.3, h: 5.9, doorDeg: 280, chimney: 60 },
    { id: 'chapel', type: 'chapel_small', x: 44, z: 93.6, rot: 0, w: 6, d: 8, h: 7, enterable: true },
    { id: 'well', type: 'well', x: 56, z: 110, r: 0.9, fixed: true },
    // --- the knoll W of the threshing floor: the ruined trullo among the rocks
    { id: 'ruin', type: 'trullo_ruin', x: 30, z: 68, r: 2.6, h: 2.2 },
    { id: 'knoll_rocks', type: 'rocks', x: 31.5, z: 71.5, r: 1.6, h: 1.1 },
    { id: 'knoll_rocks2', type: 'rocks', x: 26.2, z: 66.2, r: 1.2, h: 0.9 },
    ...E01_DRESSING,
  ],
  commandos: [
    { role: 'greenberet', x: 12, z: 124, heading: deg(340), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'driver', x: 16, z: 126, heading: deg(340), inventory: { pistol: 1, smg: 100, firstAid: 2 } },
    { role: 'sapper', x: 14, z: 128, heading: deg(340), inventory: { pistol: 1, timeBomb: 2, grenade: 3, wireCutters: 1, bearTrap: 1, cigarettes: 2 } },
  ],
  enemies: [
    // --- the hamlet: the practice area (no zone)
    // f1 loots the trulli round the piazza: at every halt he faces a doorway (t4's, t5's, t1's, t2's), his back to the
    // open piazza; the jazzo and the trulli keep the piazza out of the checkpoint's sight
    // (the practice area: a forager who wakes runs to the piazza to raise the alarm, not to the farm — PIAZZA_ALARM)
    { id: 'f1', soldierType: 'soldier', x: 51.5, z: 115.6, heading: deg(160), alarmPoint: PIAZZA_ALARM, route: { type: 'LOOP', vel: 1.0, points: [P(51.5, 115.6, 8, 160, 10), P(56.8, 115.0, 8, 90, 10), P(57.4, 104.6, 10, 270, 10), P(52.1, 109.2, 8, 250, 10)] } },
    { ...post('f2', 'sentry', 44, 98.4, 90, 5), alarmPoint: PIAZZA_ALARM },
    // --- the road (z_road): the checkpoint
    post('cp1', 'sentry', 75.6, 98.0, 110, 15), // down the road at the hamlet's corner (the jazzo screens the piazza)
    { id: 'cp2', soldierType: 'soldier', x: 77.6, z: 87.2, heading: deg(225), route: { type: 'PINGPONG', vel: 1.0, points: [P(77.6, 87.2, 6, 135, 15), P(85.4, 81.0, 6, 60, 10)] } }, // SW down the road at the boom; ESE down the outbound road
    // the cistern tower's lookout (Hard), on its top
    post('ct1', 'sentry', 104, 24, 270, 25, { only: 'hard', elevated: true, overlooks: true, overWalls: true, y: 8 }),
    // --- the threshing floor (z_mast)
    { id: 'm1', soldierType: 'soldier', x: 50, z: 57.2, heading: deg(0), route: { type: 'PINGPONG', vel: 1.0, points: [P(50, 57.2, 6, 90), P(66, 57.2, 6, 90)] } },
    post('m2', 'sentry', 58, 43.3, 90, 5, { only: 'hard' }),
    // --- the masseria (z_mas)
    post('g1', 'sentry', 91.9, 78.4, 75, 5), // down the approach road east of the checkpoint, 35°–115°
    post('g2', 'sentry', 105.9, 44.1, 200, 0, { elevated: true, overlooks: true, overWalls: true, y: 10 }), // west over the house roof at the threshing floor, 165°–235°: the yard's east side is behind him
    { id: 'y1', soldierType: 'soldier', x: 86, z: 57.6, heading: deg(270), route: { type: 'LOOP', vel: 1.0, points: YARD_LOOP } },
    // (Hard) a second man walks the house front between the yard's north corners, looking at the house and the radio room
    { id: 'y2', soldierType: 'soldier', x: 99.4, z: 57.6, heading: deg(0), only: 'hard', route: { type: 'PINGPONG', vel: 1.0, points: [P(86.6, 57.6, 5, 270, 15), P(99.4, 57.6, 5, 0, 15)] } },
    post('st1', 'sentry', 85.4, 62, 0, 5),
    post('w1', 'soldier', 88.9, 53.2, 270, 0),
    post('k1', 'sentry', 88.5, 50.6, 180, 5, { only: 'hard' }),
    { id: 'lt1', soldierType: 'lieutenant', x: 101.8, z: 64.5, heading: deg(0), route: { type: 'PINGPONG', vel: 1.0, points: [P(101.8, 64.5, 20, 0), P(104.2, 51.0, 15, 0)] } },
    post('op1', 'soldier', 107.4, 50.2, 0, 0),
    post('hptm', 'officer', 104.7, 53.4, 0, 0, { label: 'Hauptmann Steinmetz', cigs: 1 }),
    post('drv1', 'truckDriver', 86.2, 69.4, 0, 0),
    // the patrol outside the walls (Hard): a sergeant and two troopers
    ...[['p1a', 74.2, 37.5], ['p1b', 74.2, 38.9], ['p1c', 74.2, 40.3]].map(([id, x, z], k) => ({
      id, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(270), only: 'hard', jail: 'stables',
      squad: { id: 'p1', leader: 'p1a', columns: 1 },
      // (along the north and east sides and back: the gate side is the gate sentry's and the road's)
      route: { type: 'PINGPONG', vel: 1.0, points: [P(74.2, 37.5, 4), P(112.4, 37.5, 0), P(112.4, 72.0, 4)] },
    })),
  ].map(hazed),
  vehicles: [
    // the detachment's lorry, packed, by the officers' wing (out under the arch: back it up, then round to the gate)
    { id: 'lorry', vehicleType: 'truck', variant: 'opel_canvas', x: 97, z: 66.4, heading: deg(90), driveable: true, operators: ['driver'], seats: 6, hits: 30 },
    { id: 'van', vehicleType: 'truck', variant: 'opel_blitz_cargo_grey', label: 'DF lorry', x: 92.6, z: 53.4, heading: deg(0), driveable: false },
  ],
  setpieces: [
    // the key tables in their case on the map table (o2), burned at the stove when the farm's alarm sounds
    { type: 'evidence', id: 'tables', at: MAS.table, y: 0.83, rot: deg(90), label: 'Key tables', objective: 'o2', take: 0.8,
      burn: { actor: 'hptm', at: MAS.stove, events: ['RMAS'], time: { easy: 40, hard: 25 }, face: 0,
        warn: 'Steinmetz is burning the key tables!', fail: 'THE KEY TABLES ARE ASH.' } },
  ],
  zones: [
    { id: 'z_mas', poly: [[73, 36], [114, 36], [114, 80.5], [73, 80.5]], onSeen: 'RMAS', onHeard: 'RMAS', siren: true },
    { id: 'z_mast', poly: [[43, 33], [73, 33], [73, 71], [43, 71]], onSeen: 'RQ', onHeard: 'RQ', siren: false },
    // (the checkpoint hears only what happens on the road: a shout in the hamlet, the practice area, never escalates)
    { id: 'z_road', poly: [[60, 80.5], [120, 80.5], [120, 100], [60, 100]], onSeen: 'RQ', onHeard: 'RQ', siren: false, heardLocal: true },
    { id: 'z_exit', poly: [[96, 0], [120, 0], [120, 80.5], [114, 80.5], [114, 36], [96, 36]], onSeen: 'RQ', onHeard: 'RQ', siren: false },
  ],
  jails: ['stables'],
  barracks: {
    stables: { pool: 6, squads: [
      { event: 'RMAS', size: 3, exitRoute: [P(86.6, 62), P(92, 62)], loop: [P(88, 74.4), P(100.2, 57.2), P(86.4, 57.2)] },
      { event: 'RQ', size: 2, exitRoute: [P(86.6, 62), P(88, 74), P(88, 80.4)], loop: [P(72.2, 91.8), P(85, 81.4)] },
    ] },
  },
  objectives: [
    { id: 'o1', text: 'Take Hauptmann Steinmetz alive and put him in the lorry', type: 'deliver', targets: ['hptm'] },
    { id: 'o2', text: 'Take the key tables from the radio room', type: 'script' },
    { id: 'o3', text: 'Blow the mast coupling hut', type: 'destroy', targets: ['coupler'], bombOnly: true },
    { id: 'o4', text: 'Everyone, with the prisoner, in the lorry and out by the north road', type: 'escape', vehicleId: 'lorry' },
  ],
  extraction: { vehicleId: 'lorry', exit: { x: 114.2, z: 4, r: 6 }, spawnWhen: [] },
  triggers: [
    { on: 'unit:killed', when: (p) => (p?.unit?.tag ?? p?.unit?.id) === 'hptm', do: [{ fail: 'THE SIGNALS OFFICER IS DEAD. LONDON WANTED HIM TALKING.' }] },
    { on: 'vehicle:destroyed', when: (p, w) => (p?.vehicle?.tag ?? p?.vehicle?.id) === 'lorry' && !w.objectives?.find((o) => o.id === 'o4')?.done,
      do: [{ fail: 'THE LORRY IS GONE. THERE IS NO WAY OUT.' }] },
    { on: 'objective', match: { id: 'o2', status: 'done' }, do: [{ message: 'The key tables are ours. Now the Hauptmann.', kind: 'objective' }] },
    { on: 'bomb:armed', once: true, do: [{ message: 'The charge is set. A long fuse: be gone before it blows.', kind: 'info' }] },
  ],
  timeBombFuse: 240, // a long fuse (s): set when the raid on the radio room starts, it blows after the lorry is out
  par: { time: 1200 }, // the reference solution (tools/solutions/e01.solution.mjs) takes about 1180 s: the long fuse sets the pace
  cameraStart: { x: 20, z: 118, zoom: 1 },
  variants: {
    easy: { par: { time: 1260 }, routeSpeedMul: 0.8, pauseMul: 2.5, timeBombFuse: 300,
      enemyPatch: { g2: { post: { heading: deg(200), sweep: 0 } } } },
    hard: { par: { time: 1200 }, timeBombFuse: 240,
      enemyPatch: { st1: { post: { heading: 0, sweep: 35 } }, g1: { post: { heading: deg(70), sweep: 15 } } } },
  },
};

registerExpansionMission(def);
export default def;
