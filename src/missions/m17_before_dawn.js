/**
 * BEL Mission 17 — "Before Dawn" (buildable layout: docs/missions/m17.md). Owned by MISSIONS.
 * Riveauvillé (Ribeauvillé), north of Colmar, Alsace, 28 November 1944. Claude Gilbert, head of the local
 * Resistance, and four of his men sit in the wire cage of a prison camp, to be shot at first light. The team
 * (Green Beret, Marine, Spy already in uniform) starts SW, beyond a gorge. The gorge has a sliding bridge whose
 * one lever is on its N side; the camp's back gate in the N wall only opens from a control box inside; a fuel
 * tank by the gateway between the upper and lower camp can flood that gateway with oil. Free the five, then
 * everyone (all five prisoners too) into the lorry in the NW. The whole map is one silent zone.
 *
 * Conventions: dossier headings/rot in DEGREES (0 = E, 90 = S), converted with deg(); route `look` and
 * `post.sweep` stay in degrees. The camp is drawn on the painted diagonal: C(u, v) maps camp coordinates
 * (u along 332°, v along 62°, origin the camp's NW corner (22.5, 107.8)) to metres. Briefing text is ours.
 *
 * Deviations from the dossier (grid / engine fit; see the commit message):
 *  - flat map (as M16): the river is deep water at y 0, the gorge is a `ravine` gap (blocked cells) with the
 *    `mobile_bridge` deck over it; the deck overlaps both lips by 2–3 m so it lands on solid ground;
 *  - the camp walls were squared onto the u/v axes so that no hut crosses a wall (hut_e, hut_s, t5 and the SE
 *    barracks moved ≤ 3 m); the E walls meet at u 44 and the divide is closed E of hut_ne; the gorge's E end was
 *    run up against the W wall so nothing walks round it (dossier §4.1);
 *  - the pen's gate sits at the middle of its S side (67.7, 103.2) (the `prison_pen` prop), 2.8 m E of the
 *    dossier's point; e12 and the crates moved clear of it; the jail door is just outside the gate;
 *  - the river's S shore is pulled 1–1.5 m N at the pillbox so a man can pass behind it (dossier's footprint
 *    filled the whole strip); the barrel's spot "directly behind" it is (63, 84.4);
 *  - the winch lorry carrying the bridge lever is a static prop N of the deck (not a vehicle: nobody can drive
 *    or hide in it), the lever 1 m off its tailgate at (15.5, 122.8); the GB's climb lands at (2.5, 124.6),
 *    W of the (smaller) W rocks;
 *  - low brick walls block sight like any wall (dossier D4 fallback); the zigzag cosmetic walls are left out;
 *  - D1: the jailed prisoners are drawn in the cage (scripts/m17.js); D2 checked: the payload key is `id`;
 *    D3: the guests' ids are their follow tags;
 *  - o1 is a `script` objective set when the pen is opened (M10 pattern); a dead prisoner is a loss through
 *    the engine's "one of your men died" rule (guests are commandos) and trigger T7's message.
 */

import { GUESTS, setLockedGate, openPen, showCaged, northAlarm, lineUp, investigateBlast } from './scripts/m17.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- camp axes (dossier §4.1, §5.2)
const CAMP_O = [22.5, 107.8];
const U = [Math.cos(deg(332)), Math.sin(deg(332))];
const V = [Math.cos(deg(62)), Math.sin(deg(62))];
/** Camp coordinates → metres [x, z]. */
export const C = (u, v) => [r2(CAMP_O[0] + u * U[0] + v * V[0]), r2(CAMP_O[1] + u * U[1] + v * V[1])];
const CAMP_ROT = deg(332);

// ---------------------------------------------------------------- terrain (dossier §4.2)
const RIVER_N = [[0, 58], [18, 63], [30, 64], [45, 64.4], [55, 63], [63, 61], [72, 58], [80, 55.5], [85.5, 52.5], [90, 51.5]];
const RIVER_S = [[90, 74.2], [76.5, 77], [67.5, 77.5], [58.5, 81], [49.5, 86], [40.5, 92.4], [30, 96], [18, 98], [0, 96]];
export const RIVER = [...RIVER_N, ...RIVER_S];
/** The gorge SW: its E end runs up against the camp's W wall. */
export const RAVINE = [[0, 125.5], [12, 126], [28, 124.5], [33, 125.5], [36.5, 133.5], [40.5, 137.5], [22, 139], [12, 145], [0, 147]];
/** Mobile-bridge deck (17 m + 3 m on the N lip, axis 75°) and the S landing it crushes when it slides out. */
export const DECK = [[9.8, 125.6], [14.6, 124.3], [19.8, 143.6], [15.0, 144.9]];
export const CRUSH = [[14.6, 144.9], [19.8, 143.6], [20.4, 146], [15.2, 147.3]];
/** The road bridge: S end on land (14.7, 98.6), N end on land (45.8, 61.7). */
const BRIDGE = { x: 30.25, z: 80.13, rot: deg(310.2), w: 48.5, d: 6 };
export const GATEWAY = { x: C(26.25, 31.5)[0], z: C(26.25, 31.5)[1] };

const ROADS = {
  n: [[0, 48.5], [18, 48], [40, 49], [49, 51], [50.5, 56], [45.8, 61.7]],
  hq: [[40, 49], [31.5, 44]],
  riverside: [[14.7, 98.6], [30, 100.5], [49.3, 91.5], [60, 86.5], [70, 80.5]],
  w: [[14.7, 98.6], [11.3, 100], [7.7, 105], [10.4, 119], [12.2, 125]],
  s: [[17.4, 146], [18, 147], [27, 168], [31.5, 175], [58.5, 175], [74, 175], [89.6, 179]],
  gate: [[73, 175], [72.5, 161], C(19.5, 60), C(22, 45), GATEWAY],
};

const TERRAIN = [
  { type: 'poly', terrain: 'water', points: RIVER },
  // bare camp earth: upper and lower yards
  { type: 'poly', terrain: 'ground', points: [C(0, 0), C(55.5, 0), C(55.5, 28), C(44, 28), C(44, 61), C(39.3, 70), C(6, 70), C(6, 50), C(0, 28)] },
  { type: 'poly', terrain: 'ground', points: RAVINE },
  ...Object.values(ROADS).map((points) => ({ type: 'path', terrain: 'road', width: 4, points })),
];

// ---------------------------------------------------------------- structures (dossier §5)
const brick = (id, extra) => ({ id, type: 'wall', variant: 'stockade_prison_brick_railing', mat: 'brick', h: 2.2, width: 0.5, block: 2, ...extra });
const camp = (id, type, variant, [x, z], w, d, h, extra = {}) => ({ id, type, variant, x, z, rot: CAMP_ROT, w, d, h, ...extra });
const tower = (id, uv, h) => ({ id, type: 'watchtower', variant: 'watchtower_stilt', x: C(...uv)[0], z: C(...uv)[1], rot: deg(h), w: 3, d: 3, h: 6, deckY: 6 });
const rock = (id, x, z, w, d, h = 2.5) => ({ id, type: 'rocks', variant: 'rock_temperate', x, z, rot: 0, w, d, h, block: 2 });
const tree = (x, z, k) => ({ id: `tree_${k}`, type: 'tree', variant: 'deciduous_bare', x, z, r: 0.4, h: 8 + (k % 3), seed: 1717 + k });

/** §5.2 the camp: low brick walls with iron railings, the locked back gate, the wire cage (the jail). */
export const PEN_C = C(42.1, 8.6), PEN_GATE = C(42.1, 17.2), PEN_DOOR = C(42.1, 18.7);
export const BACK_GATE = C(30.4, 0), GATE_BOX = C(27.4, 1.2), VALVE = C(30.2, 25);
const CAMP = [
  brick('wall_e1', { points: [C(55.5, 0), C(55.5, 28)] }),
  brick('wall_e2', { points: [C(55.5, 28), C(38, 28)] }),                 // buried in hut_ne W of u 40.7
  brick('wall_e3', { points: [C(44, 28), C(44, 61)] }),                   // runs into the map's E edge
  brick('wall_w', { points: [C(0, 0), C(0, 28), C(6, 50), C(6, 70)] }),
  brick('wall_div', { points: [C(0, 28), C(10.8, 31.5)] }),              // then hut_flag · gateway · hut_ne
  brick('wall_s', { segments: [[C(6, 70), C(17, 70)], [C(22, 70), C(39.2, 70)]] }), // the open main gate u 17–22
  { id: 'gate_back', type: 'gate', variant: 'iron', label: 'Back gate', x: BACK_GATE[0], z: BACK_GATE[1], rot: CAMP_ROT, w: 3, h: 2.6, locked: true },
  // open: 'N' — the camp's brick wall_n is the cage's N side (a mesh side there would let the riverside see in)
  { id: 'pen', type: 'prison_pen', variant: 'wire_cage', x: PEN_C[0], z: PEN_C[1], rot: CAMP_ROT, w: 17, d: 17.2, h: 2.4, gateSide: 'S', open: 'N',
    door: { x: PEN_DOOR[0], z: PEN_DOOR[1] } },
  { id: 'pen_gate', type: 'gate', variant: 'jail_door_mesh', x: PEN_GATE[0], z: PEN_GATE[1], rot: CAMP_ROT, w: 2.4, h: 2.4, locked: true },
  // wall_n after the pen: where the cage's W and E sides meet it, its brick cells win (stamps overwrite)
  brick('wall_n', { segments: [[C(0, 0), C(28.9, 0)], [C(31.9, 0), C(55.5, 0)]] }),
  // upper camp (the prison yard)
  camp('house_w', 'house', 'house_timber_crossgable', C(11, 15.7), 12, 9, 7, { mat: 'woodDark', enterable: true }),
  camp('shed_w', 'hut', 'showers_slatted', C(10.8, 2.6), 5, 3, 2.6, { label: 'Showers', mat: 'planks' }),
  camp('shed_ne', 'hut', 'shed_slatted', C(47.3, 2.8), 5, 3, 2.6, { mat: 'planks' }),
  { id: 'water_tank', type: 'well', variant: 'water_tank_caged', x: C(4.4, 22.9)[0], z: C(4.4, 22.9)[1], r: 1.2, h: 3, block: 2 },
  camp('fuel_tank', 'fueltank', 'fuel_tank_elevated', C(33.7, 25), 5, 3, 6, { label: 'Fuel tanks', block: 2 }),
  camp('crates_u', 'crates', 'crates_pile', C(47.5, 20.5), 3, 3, 1.5, { block: 1 }),
  camp('crates_w', 'crates', 'crates_logs', C(15, 21.8), 4, 2, 1.2, { block: 1 }),
  { id: 'barrel_1', type: 'barrels', variant: 'fuel_explosive', x: C(41.1, 22.3)[0], z: C(41.1, 22.3)[1], r: 0.3, h: 0.9,
    explosive: 'barrel', carriable: true, destructible: true, hp: 1 },
  { id: 'lamp_1', type: 'lamp_post', variant: 'floodlight_loudspeaker', x: C(38, 6)[0], z: C(38, 6)[1] },
  { id: 'lamp_2', type: 'lamp_post', variant: 'floodlight_loudspeaker', x: C(30, 18)[0], z: C(30, 18)[1] },
  // the divide and the lower camp (garrison barracks_se), 5 towers
  camp('hut_flag', 'barracks', 'hut_pow_long', C(17.3, 31.5), 13, 7, 4.5, { flag: true, mat: 'woodDark' }),
  camp('hut_ne', 'barracks', 'hut_pow_long', C(34.7, 30.5), 12, 7, 4.5, { mat: 'woodDark' }),
  camp('hut_e', 'barracks', 'hut_pow_long', C(36, 41.2), 11, 7, 4.5, { mat: 'woodDark' }),
  camp('hut_s', 'barracks', 'hut_pow_long', C(13, 54), 12, 7, 4.5, { mat: 'woodDark' }),
  camp('barracks_se', 'barracks', 'hut_pow_long_crossgable', C(36, 55), 12, 10, 6, { mat: 'woodDark', garrison: true, door: deg(90) }),
  tower('t1', [9.3, 46.5], 200), tower('t2', [15.9, 65.9], 120), tower('t3', [24.4, 67.5], 60),
  tower('t4', [26.5, 47.5], 30), tower('t5', [5.5, 37], 90),
  { id: 'lamp_3', type: 'lamp_post', variant: 'floodlight_loudspeaker', x: C(20, 60)[0], z: C(20, 60)[1] },
  { id: 'sign_gate', type: 'sign', variant: 'kommandantur_board', x: C(16, 71.2)[0], z: C(16, 71.2)[1], rot: CAMP_ROT },
];

/** §5.1 outside the camp: the river crossing, the pillbox, the gorge and its sliding bridge, the N bank. */
export const LEVER = [15.2, 122.3];
const OUTSIDE = [
  { id: 'bridge_road', type: 'bridge', variant: 'bridge_timber_deck_long', ...BRIDGE, mat: 'planks' },
  { id: 'pillbox', type: 'bunker', variant: 'pillbox_round', label: 'Surveillance bunker', x: 63, z: 81, rot: deg(200), w: 5, d: 5, h: 3,
    mat: 'concrete', destructible: true, hp: 100, destroyFx: ['bigBlast'] },
  { id: 'gorge', type: 'ravine', variant: 'rock_gorge', points: RAVINE },
  { id: 'mbridge_deck', type: 'mobile_bridge', variant: 'mobile_bridge_sliding', x: 14.8, z: 134.6, rot: deg(75), w: 20.5, d: 5, h: 0.4 },
  { id: 'truck_winch', type: 'ruins', variant: 'truck_opel_parked', label: 'Winch lorry', x: 18.5, z: 120.5, rot: deg(120), w: 6.5, d: 2.4, h: 2.8,
    mat: 'olivePaint', block: 2 },
  { id: 'crane', type: 'radio_mast', variant: 'crane_tower_jib', x: 20, z: 113, r: 1.6, h: 14 },
  // N bank: the HQ house (garrison hq_n), the old mill, the MG nest by the bridge
  { id: 'hq_n', type: 'barracks', variant: 'house_timber_hq_L', x: 27, z: 40.6, rot: deg(316), w: 16, d: 10, h: 9, mat: 'woodDark',
    flag: true, garrison: true, door: deg(90) },
  { id: 'mill', type: 'watermill', variant: 'watermill', label: 'The old mill', x: 80, z: 46.5, rot: CAMP_ROT, w: 12, d: 10, h: 9 },
  { id: 'mill_deck', type: 'pier', variant: 'pier_timber', x: 74, z: 55, rot: CAMP_ROT, w: 5, d: 5 },
  { id: 'mg_n_ring', type: 'sandbags', variant: 'mg_nest_sandbag', x: 45.9, z: 53.9, rot: deg(105), ring: { r: 1.6 }, h: 1.0, block: 1 },
  { id: 'crates_n1', type: 'crates', variant: 'crates', x: 33.5, z: 46.5, rot: deg(316), w: 2, d: 2, h: 1.1, block: 1 },
  { id: 'crates_n2', type: 'crates', variant: 'crates', x: 22, z: 51.5, rot: deg(2.6), w: 2, d: 2, h: 1.1, block: 1 },
  // rocks named in the walkthroughs
  rock('rock_c1', 13, 14, 4, 5, 3), rock('rock_c2', 14, 21, 4, 5, 3), rock('rock_c3', 13.5, 28, 4, 5, 3), rock('rock_c4', 10, 31, 4, 5, 3),
  rock('rock_bn', 38, 59.5, 4, 3), rock('rock_mill', 59, 51, 5, 4, 3), rock('rock_ne', 82, 23, 4, 4),
  rock('rock_small', 15.5, 109, 3.5, 3), rock('rock_w', 5.5, 122.5, 4, 3, 3),
  rock('rock_start1', 7.5, 156, 6, 5, 4), rock('rock_start2', 9, 161.5, 5, 4, 3),
  ...[[21.6, 9], [26.6, 6.3], [46.4, 14], [64.8, 14.7], [77.4, 19.6], [69.3, 37.8], [34.7, 51.8],
    [1.8, 100.5], [5.4, 101.5], [86, 88], [87.5, 93], [14.4, 166], [36.9, 153.3]].map(([x, z], k) => tree(x, z, k)),
  ...[[13.3, 116], [1.8, 173.6], [17.6, 162.4], [36, 168], [51.3, 179.2], [72, 182], [79.6, 168]]
    .map(([x, z], k) => ({ id: `pole_${k}`, type: 'telegraph_pole', x, z })),
];

const STRUCTURES = [...CAMP, ...OUTSIDE];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–26)
/** Lone walker (PINGPONG, 1.0 m/s), starting at the first point facing the second. */
const walker = (id, prima, pts) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: pts[0].x, z: pts[0].z, heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x),
  flags: { investigates: true }, route: { type: 'PINGPONG', vel: 1.0, points: pts },
});
/** Post guard: holds his post, sweeping a total arc of `arc`° about heading `h`. The dossier's figures are total
 *  arcs; the engine's post.sweep is the ± amplitude A (θ = A·sin, §4.2), so it gets arc / 2 (as M4–M16's 20–50). */
const sentry = (id, prima, x, z, h, arc, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h), flags: { holdsPost: true, investigates: false },
  post: { heading: deg(h), sweep: arc / 2 }, ...extra,
});
/** 3-man patrol (sergeant + 2 troopers) in single file; patrols ARREST (the map has a jail, §4.5). */
const patrol = (ids, prima, sq, pts) => {
  const h = Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x);
  return ids.map((id, k) => ({
    id, ...(prima ? { prima } : {}), soldierType: k ? 'trooper' : 'sergeant',
    x: r2(pts[0].x - Math.cos(h) * 1.2 * k), z: r2(pts[0].z - Math.sin(h) * 1.2 * k), heading: h,
    flags: { investigates: true, followsTracks: true }, squad: { id: sq, leader: ids[0], columns: 1 },
    route: { type: 'PINGPONG', vel: 1.0, points: pts },
  }));
};
/** Tower sentry on a 6 m platform. */
const towerman = (id, t, h) => {
  const s = CAMP.find((q) => q.id === t);
  return { id, soldierType: 'sentry', x: s.x, z: s.z, y: 6, elevated: true, tower: t, heading: deg(h),
    flags: { holdsPost: true, investigates: false }, post: { heading: deg(h), sweep: 45 } }; // ±45 (a 90° arc)
};
const at = (u, v, wait = 0, look = null) => P(...C(u, v), wait, look);

const WEST = [ // Phase 1: the mobile bridge and the W strip
  sentry('e1', 1, 13.5, 117.5, 300, 90),
  sentry('e2', 2, 7.4, 119.4, 0, 60),
  walker('e3', 3, [P(12.5, 101.5, 3, 300), P(12.5, 113, 3, 90)]),
  sentry('e4', 4, 18.5, 100.5, 90, 60),
];
const UPPER = [ // Phase 2: the prison yard, 9 men
  walker('e5', 5, [at(6, 5.7, 3, 180), at(13, 7.5), at(18.5, 9.5, 3, 0)]),
  sentry('e6', 6, ...C(14.5, 3.5), 90, 60),
  sentry('e7', 7, ...C(19, 16.4), 90, 60),
  walker('e8', 8, [at(20.5, 24.5, 3, 90), at(27, 15, 3, 330)]),
  sentry('e9', 9, ...C(32.3, 3.5), 90, 90),
  sentry('e10', 10, ...C(29.4, 19.2), 180, 60),
  walker('e11', 11, [at(32.3, 21, 3, 270), at(46, 22.5, 3, 0)]),
  sentry('e12', 12, ...C(45.5, 19.2), 200, 60),
  walker('e13', 13, [at(43.8, 25.5, 3, 90), at(52.5, 24.7), at(52.9, 8, 3, 250)]),
];
const NORTH = [ // Phases 3–5: the mill, the bridgehead, the road to the lorry
  walker('e14', 14, [P(71, 50, 3, 180), P(76, 40), P(87, 40, 4, 90)]),
  walker('e15', 15, [P(55.8, 55.5, 3, 90), P(66, 56.5, 3, 0)]),
  sentry('e18', 18, 49, 60.2, 150, 40), // Prima: he watches the bridge deck (131–155°), not the far bank
  walker('e19', 19, [P(28.8, 61, 3, 90), P(12, 59.5, 3, 90)]),
  walker('e20', 20, [P(32.6, 54, 4, 90), P(40, 56, 3, 0)]),
  walker('e21', 21, [P(43, 57.5, 3, 180), P(56, 59, 3, 330)]), // [rec] ours: he watches the shore road (W to the bridge, NE to the mill)
  walker('e22', 22, [P(50, 47, 3, 90), P(58, 44, 3, 0)]),
  { id: 'e23', prima: 23, soldierType: 'mg', x: 45.9, z: 53.9, heading: deg(105), emplacement: 'mg_n', post: { heading: deg(105), sweep: 40, giro: 120 } },
  sentry('e24', 24, 22.5, 49.5, 60, 60),
  walker('e25', 25, [P(22.3, 31.2, 3, 180), P(19.5, 48, 3, 90)]),
  sentry('e27', null, 18, 23.5, 90, 60),
];
const LOWER = [ // the lower camp: 2 walkers and the five tower sentries
  walker('e28', null, [P(58.5, 132.5, 3, 270), P(67, 131, 3, 90)]),
  walker('e29', null, [P(64, 142.5, 3, 180), P(70.5, 148, 3, 90)]),
  towerman('t1s', 't1', 200), towerman('t2s', 't2', 120), towerman('t3s', 't3', 60), towerman('t4s', 't4', 30), towerman('t5s', 't5', 90),
];
/** e_bk's head: ±40 about 200° (cone 140–260° with the 20° half field): the whole road bridge (160–228°), but
 *  not the back gate (138°), the path from it (≤ 135°) nor the barrel's spot behind him (90°). */
export const BUNKER_POST = { heading: 200, sweep: 40 };
const BUNKER = [ // the surveillance bunker's one gunner: scans the road bridge, blind to his rear (§8.6)
  { id: 'e_bk', soldierType: 'crew', x: 63, z: 81, heading: deg(BUNKER_POST.heading), structure: 'pillbox', firesOnSight: true,
    vision: { fov: 40, near: 18, far: 36, sweep: BUNKER_POST.sweep }, post: { heading: deg(BUNKER_POST.heading), sweep: BUNKER_POST.sweep } },
];
const PATROLS = [ // §8.7 four 3-man patrols
  ...patrol(['p16a', 'p16b', 'p16c'], 16, 'p16', [P(30, 100.5, 3, 180), P(49.3, 91.5), P(59.5, 87.2, 3, 0)]),
  ...patrol(['p17a', 'p17b', 'p17c'], 17, 'p17', [P(20, 101, 4, 90), P(17.5, 97.5), P(43.8, 64.5), P(47, 58, 4, 0)]),
  ...patrol(['p26a', 'p26b', 'p26c'], 26, 'p26', [P(18.5, 12, 3, 180), P(34, 16), P(62, 18, 3, 0)]),
  ...patrol(['psa', 'psb', 'psc'], null, 'ps', [P(22, 150, 4, 270), P(27, 168), P(31.5, 175), P(58.5, 175), P(86, 178, 4, 0)]),
];

const ENEMIES = [...WEST, ...UPPER, ...NORTH, ...LOWER, ...BUNKER, ...PATROLS];

// ---------------------------------------------------------------- vehicles (dossier §8.8)
const TRUCK = { x: 6.3, z: 13.7, heading: deg(160) };
const VEHICLES = [
  // the escape lorry NW: boarding is the extraction; nobody in this team drives, so it leaves by itself
  { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', ...TRUCK, seats: 8, friendly: true },
  { id: 'mg_n', vehicleType: 'mgNest', x: 45.9, z: 53.9, heading: deg(105), gunner: 'e23', driveable: true },
  // §3.8 row 17: the raft is on site (W strip, by the road bridge's S end), not in the Marine's pack
  { id: 'raft', vehicleType: 'raft', x: 7, z: 94.5, heading: deg(0), inflated: true, suspicious: false, operators: ['diver'] },
];

// ---------------------------------------------------------------- commandos (§3.8 row 17, exact) and guests
const guest = (id, name, [x, z], follow = null) => ({ role: 'guest', id, guestId: follow ? 'prisoner' : id, name, nickname: name.split(' ').pop(), x, z,
  heading: deg(90), jailed: true, jailId: 'pen', noCrawl: true, ...(follow ? { follow } : {}), inventory: {} });
const COMMANDOS = [
  { role: 'greenberet', x: 2.7, z: 156.8, heading: deg(0), inventory: {} },   // knife, pistol, decoy; no shovel from M12 on
  { role: 'diver', x: 1.8, z: 158.8, heading: deg(0), inventory: {} },        // knife, harpoon, pistol, diving gear
  { role: 'spy', x: 1.8, z: 161.7, heading: deg(0), inventory: { firstAid: 6 } }, // in uniform (startDisguised); the medic
  // Claude Gilbert heads the file; his four men follow in single file and cannot crawl (character-bible §6.3)
  guest('gilbert', 'Claude Gilbert', C(40, 9)),
  guest('fr1', 'Resistance man Marcel', C(38.5, 7.5), 'gilbert'),
  guest('fr2', 'Resistance man Henri', C(41, 6), 'fr1'),
  guest('fr3', 'Resistance man Luc', C(43.5, 7), 'fr2'),
  guest('fr4', 'Resistance man Émile', C(44, 10.5), 'fr3'),
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
const RIVER_MID = [[0, 77], [18, 80.5], [30, 80], [45, 76.7], [55, 73], [63, 70.8], [72, 68.5], [80, 67], [90, 62.9]];
export const ZONES = [
  // the whole map is one silent zone; it is split at the river only to choose which garrison turns out
  { id: 'z_n', poly: [[0, 0], [90, 0], ...RIVER_MID.slice().reverse()], onSeen: 'RINT_N', onHeard: null },
  { id: 'z_s', poly: [...RIVER_MID, [90, 185], [0, 185]], onSeen: 'RINT', onHeard: null, siren: true },
];
const squadSE = () => ({ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [at(30, 62), at(26.25, 45), at(26.25, 31.5), at(26, 20)],
  loopVel: 1.8, loop: [at(26, 20), at(20, 8), at(8, 6), at(20, 8)] });
const BARRACKS = {
  barracks_se: { pool: 12, squads: [squadSE(), squadSE(), squadSE()] },
  hq_n: { pool: 6, squads: [{ event: 'RINT_N', size: 3, exitVel: 2.7, exitRoute: [P(40, 49), P(46, 57.5)],
    loopVel: 1.8, loop: [P(46, 57.5), P(40, 49), P(18, 48.5), P(40, 49)] }] },
};

// ---------------------------------------------------------------- the mission
export const SEND_ON_BLAST = ['e18', 'e19', 'e20', 'e21', 'p17a', 'p17b', 'p17c'];
/** T4: where each of SEND_ON_BLAST runs to look (the patrol by its leader): round the rubble's W side, on the path. */
export const BLAST_SPOTS = [[57, 88.5], [60.5, 86.2], [54.5, 90], [61.8, 84.4], [52.5, 91], [52.5, 91], [52.5, 91]];

export default {
  id: 'm17',
  campaign: 'BEL',
  title: 'Before Dawn',
  subtitle: 'Riveauvillé, north of Colmar, Alsace · 28 November 1944',
  date: '1944-11-28',
  place: 'Riveauvillé (Ribeauvillé), north of Colmar, Alsace, France',
  theater: 'temperate',
  coneColors: 'green',
  size: [90, 185],
  seed: 1944_1128,
  briefing: {
    historical: 'November 1944. The airborne gamble in Holland has failed, yet the Allies are still grinding towards the Rhine. In a small town north of Colmar the Germans have caught Claude Gilbert, who leads the Resistance in the region, with four of his people. They face a firing squad at first light.',
    text: 'Easy to say, officer, and hard to do: get Gilbert and his four men out of that camp and bring them north. One of our lorries will be waiting in the north-west. Beside the camp a gorge cuts the road, and there is a sliding bridge over it; the lever that works it is on the north side. And if you cannot find a way in, remember that the Germans will gladly open the gate for a prisoner. Good luck.',
    objectivesSummary: 'Free Claude Gilbert and his four companions from the cage. Then everyone, all five of them included, into the lorry in the north-west.',
    hints: [
      'The sliding bridge over the gorge is worked from its north end. Out, it lets you across. Back, it keeps them out.',
      'Being taken prisoner is one way through the wire. Choose who: the Marine would lose his diving kit.',
      'The back gate in the north wall only answers to the control box inside it. Shut, nobody gets in or out that way.',
      'The fuel tanks by the inner gateway have a valve. Open it well, and a single shot does the rest.',
      'The prisoners walk in a line behind Gilbert. They cannot crawl, and anyone who looks their way will see them.',
      'Every man, and all five prisoners, must be aboard the lorry in the north-west.',
    ],
  },
  lighting: { sunElevDeg: 20, sunAzimuthDeg: 315, kelvin: 6500, hdri: 'overcast', fog: 200, lut: 'temperate_overcast' },
  water: { velocity: 0.25, angleDeg: 180, turbulence: 0.15, color: '#1d5a5c' },
  shoreShallowWidth: 1.5,
  baseTerrain: 'grass',
  terrain: TERRAIN,
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['pen', 'shed_ne'], ['pen', 'pillbox'], ['hut_s', 't1']]),
  items: [],
  interactables: [
    // the cage's jail door, just outside the pen gate: frees every jailed man at once (§4.10, unseen)
    { kind: 'jail', id: 'pen_door', x: PEN_DOOR[0], z: PEN_DOOR[1], jailId: 'pen' },
  ],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  zones: ZONES,
  jails: ['pen'],
  jailStrips: ['divingGear'],
  barracks: BARRACKS,
  // the Green Beret's climb: down and up the gorge at its far W end, where the rock steps down (§6)
  climbLinks: [{ id: 'climb_gorge', a: [2.5, 148.5, 0], b: [2.5, 124.6, 0], roles: ['greenberet'] }],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Free Claude Gilbert and his four companions', type: 'script', required: true },
    { id: 'o2', text: 'Get everyone, all five prisoners too, to the lorry in the north-west', type: 'escape', required: true, vehicleId: 'truck' },
  ],
  setpieces: [
    { type: 'mobile_bridge', id: 'mbridge', extended: false, moveTime: 3, deck: { poly: DECK },
      lever: { at: LEVER, id: 'lever_bridge' }, crushArea: { poly: CRUSH } },
    { type: 'gate_control', id: 'backgate', control: { at: GATE_BOX, id: 'gate_box', label: 'Gate control box' }, doors: [], open: false },
    { type: 'fuel_valve', id: 'oil', valve: { at: VALVE, id: 'valve' }, clicks: 3, spill: { x: GATEWAY.x, z: GATEWAY.z, r: 4.5 }, growTime: 8, burnTime: 120 },
  ],
  triggers: [
    // D1: the prisoners are drawn in the cage
    { on: 'start', do: [{ run: (w) => showCaged(w) }] },
    // the control box swings the locked back gate (scripts/m17.js)
    { on: 'door', match: { id: 'backgate' }, once: false, do: [{ run: (w, _d, p) => setLockedGate(w, 'gate_back', !!p?.open) }] },
    // T1 the pen opened: all five are out (o1)
    { on: 'unit:freed', match: { unit: 'gilbert' }, do: [
      { run: (w) => openPen(w) }, { objective: 'o1', set: 'done' },
      { message: 'Gilbert: "Merci, messieurs. We follow you. Lead the way."', kind: 'objective' },
    ] },
    // the freed five stand in a line along the cage's S side instead of stacked on the door point
    { on: 'unit:freed', match: { unit: GUESTS }, once: false, do: [{ run: (w, _d, p) => lineUp(w, p?.unit) }] },
    // T3 the oil burns: the whole camp hears it (the siren) and the lower garrison runs for the gateway
    { on: 'fire', match: { on: true }, do: [{ event: 'RINT', x: GATEWAY.x, z: GATEWAY.z }, { noise: { x: GATEWAY.x, z: GATEWAY.z, radius: 30, kind: 'explosion' } }] },
    // T4 the pillbox blown: Patrol 17 and soldiers 18–21 come over the river, each to his own spot by the rubble,
    // look about and go home (Prima: two going E, two coming back; Kildread: the Spy waits there for them)
    { on: 'structure:destroyed', match: { id: 'pillbox' }, do: [{ run: (w) => investigateBlast(w, SEND_ON_BLAST, BLAST_SPOTS) }] },
    // T6 a N-bank alarm sounds the same siren and turns out the lower garrison as well
    { on: 'alarm:zone', match: { event: 'RINT_N' }, once: false, do: [{ run: (w, _d, p) => northAlarm(w, p) }] },
    // T7 a prisoner killed (the engine's "one of your men died" rule ends the mission too)
    { on: 'unit:killed', match: { unit: GUESTS }, do: [{ fail: 'ONE OF THE PRISONERS HAS BEEN KILLED.' }] },
    // T8 the Marine jailed: he loses the diving gear (jailStrips)
    { on: 'unit:jailed', match: { unit: 'diver' }, do: [{ message: 'They have taken the Marine\'s diving kit.', kind: 'warn' }] },
  ],
  // the lorry is here from the start: once o1 is done and every living man (the five included) is aboard, it
  // drives off the W edge (ESC skips)
  extraction: { vehicleId: 'truck', spawnAt: { ...TRUCK }, spawnWhen: ['o1'], exit: { x: 1, z: 14.5, r: 3 }, leave: { x: -12, z: 15, speed: 7 } },
  alarmFail: null,
  par: { time: 780 },
  cameraStart: { x: 10, z: 152, zoom: 1 },
  startDisguised: ['spy'],
};
