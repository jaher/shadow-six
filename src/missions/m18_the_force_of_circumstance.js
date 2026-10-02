/**
 * BEL Mission 18 — "The Force of Circumstance" (buildable layout: docs/missions/m18.md). Owned by MISSIONS.
 * The Maas bridge north of Liège again, 16 December 1944: the Ardennes offensive has broken through and the
 * bridge the team saved in September (M16) must now go. Green Beret, Marine, Sapper and Driver start prone
 * behind the ruined field walls in the SE. The Sapper's three remote charges are German ones, in a green case
 * on the island under the bridge; one on each marked deck point A, B, C (or a Panzer III shell on the German
 * charge lying there) brings the span down, in any order and at any interval. A vacant Panzer III waits in
 * the NW corner behind the German camp; the Marine's boat lies on the N island. Then everyone into the lorry
 * by the S road. The whole map raises the siren (not a loss: reinforcements from three barracks until each
 * is razed); cries on the two islands reach no one.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid, engine; see the commit message):
 *  - no shared `maas-map.js`: M16's committed file is another author's, so the M16 terrain and structures are
 *    copied here with the M18 changes (flat map: the river is deep water at y 0; the deck girders are cleared
 *    over deep water by M16's `deck_underpass` set-piece so the Marine swims under the spans);
 *  - "RALL" is the engine's siren event RINT; the island zones are silent (onSeen/onHeard null, listed first) and the
 *    bank zone `ignoreFrom`s them (noises from the islands, and bodies lying there, trip nothing on the banks);
 *  - marker C is pulled 2 m onto the deck (the painted spot sits on the S girder); the markers are drawn as the
 *    bridge's German charges;
 *  - the red house is an enterable hideout (the engine has no two-door pass-through); the covered way to the
 *    tank runs along its W side instead;
 *  - `sd_w` turns round on the W road at (2,22) (30 s out of sight behind the NW houses) instead of leaving the map;
 *  - the bridge falls whole (the deck over water reverts to river, the land approaches stay as road);
 *    scripts/m18.js drowns anyone on the span, keeps the Panzer III immune to bombs and shells, drops the team
 *    prone on the first tick (spawn `stance` is not read) and path-finds the S-road drive-off;
 *  - `rail_line` width 9 (4.5 m either side): Prima's grenade at e14 lands on the platform, ~4 m off the rails;
 *    e14, e16, e8, P15 and P45 were moved 2–6 m off the rails (the train killed them and raised the siren);
 *  - e13 stands 3.7 m from e14 (one grenade takes both [P]); the station squad loops N of the railway and the fields
 *    squad 14 m or more off the start walls (review: the train killed the first, the second walked over the team);
 *  - the lorry stands at (91.5,143.5), 8.3 m off the rail axis (at (90.5,141) it stopped the first train for good);
 *  - no lone survivor stumbles out of a razed barracks (the garrison has no such rule; dossier §14 #6);
 *  - the charges on the island are a plain pickup (3 remote bombs); the detonator comes with the first planted.
 */

import { m18Tick, onBridgeDown, MARKERS } from './scripts/m18.js';
import { joinStructures } from './schema.js';
import './scripts/m16.js'; // registers the `deck_underpass` set-piece (same bridge)

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)

// ---------------------------------------------------------------- terrain (m16.md §4.2 + m18.md §4.2)
/** T1 the Maas, NE → SW (deep water; the engine rims it with a 2 m shallow band). */
const RIVER = [[0, 104], [24, 88], [40, 73], [59, 50], [76.5, 28], [100, 0], [166, 0], [148.5, 22.4], [111, 70], [97.7, 79],
  [89, 95], [78.3, 110.6], [67.5, 119.6], [58, 150], [0, 150]];
/** T4 the bridge island I_S (6 m N), T5 the N island I_N (3 m N). */
export const ISLAND_S = [[38.6, 103.3], [40.2, 88.2], [48.3, 83.2], [55, 79], [60, 79], [62.1, 84.4], [65.3, 97], [58.9, 104.6]];
export const ISLAND_N = [[87.3, 39.6], [88, 25], [98.1, 13.8], [107.5, 10.4], [113.9, 7.6], [119.7, 10.4], [119.7, 19.4], [112.5, 23.9],
  [105.3, 27.2], [98.1, 30.6], [90.9, 38.4]];
/** T5b the reed neck: wadeable shallows joining I_N to the W bank (I_N is really a peninsula). */
const REED_NECK = [[77, 27.5], [80, 21], [88.5, 19], [90, 28], [84, 31]];
/** T11 the railway (both ends off the map); the train stops with its engine at (160, 64.3), coaches by the platform. */
export const RAIL = [[212, 13.5], [200.6, 24.5], [139.5, 84.3], [103, 120.3], [73.2, 150], [62, 161]];
const ROADS = {
  nw: [[0, 25], [25.7, 54]],
  bridgehead: [[91.5, 108.5], [103, 121], [119, 130]],
  ne: [[119, 130], [135, 117.5], [187.5, 66.5], [201, 53.5]],
  south: [[119, 130], [139.5, 148.7], [140.5, 150]],
};

const TERRAIN = [
  { type: 'poly', terrain: 'water', points: RIVER },
  { type: 'poly', terrain: 'grass', points: ISLAND_S },
  { type: 'poly', terrain: 'grass', points: ISLAND_N },
  { type: 'poly', terrain: 'shallow', points: REED_NECK },
  { type: 'circle', terrain: 'grass', x: 86.5, z: 55, r: 2 },
  { type: 'poly', terrain: 'ground', points: [[109, 0], [120, 0], [120, 4], [109, 4]] },
  { type: 'path', terrain: 'road', width: 6, points: ROADS.nw },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.bridgehead },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.ne },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.south },
  // T12 the ploughed SE field; T13 wet mud round the station, the fountain, the NW houses and the camp; the tank yard
  { type: 'poly', terrain: 'ground', points: [[171, 103], [201, 98], [201, 150], [160, 150]] },
  { type: 'circle', terrain: 'mud', x: 184, z: 34, r: 8 },
  { type: 'circle', terrain: 'mud', x: 180, z: 97, r: 5 },
  { type: 'circle', terrain: 'ground', x: 18, z: 10, r: 10 },
  { type: 'circle', terrain: 'mud', x: 44, z: 22, r: 9 },
  { type: 'poly', terrain: 'mud', points: [[0, 4], [10, 4], [10, 20], [0, 20]] },
  // T14 shell scrapes in the S fields (visual)
  ...[[158, 112], [163, 128], [171, 139], [192, 139], [148, 140]].map(([x, z]) => ({ type: 'circle', terrain: 'mud', x, z, r: 1.3 })),
];

// ---------------------------------------------------------------- structures (m16.md §5 + m18.md §5)
const BRIDGE_ROT = deg(39.6);
const house = (id, variant, x, z, w, d, h, extra = {}) => ({ id, type: 'house', variant, x, z, rot: deg(-45), w, d, h, ...extra });
const tree = (x, z, k) => ({ id: `tree_${k}`, type: 'tree', variant: 'broadleaf', x, z });
const rock = (id, x, z) => ({ id, type: 'rocks', x, z, r: 1.5 });
const tent = (x, z, k) => ({ id: `tent_${k}`, type: 'tent', variant: 'tent_ridge_field', x, z, rot: deg(-25), w: 5, d: 3.5, h: 2.2 });
const lowWall = (id, points) => ({ id, type: 'wall', variant: 'ruined_stone_low', points, h: 1.2, width: 0.6, mat: 'stone', block: 1 });
const belt = (id, points) => ({ id, type: 'fence', variant: 'czech_hedgehog_wire', points, h: 1.4, width: 1.2 });
const bags = (id, x, z, rot, w) => ({ id, type: 'sandbags', x, z, rot: deg(rot), w, d: 0.8, h: 0.9 });
const barrel = (id, x, z) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, explosive: 'barrel', carriable: true });

const BRIDGE_SET = [
  // §5.1 the objective: only `multi_charge` (A + B + C) brings it down; tanks may drive on the deck
  // (open Pratt truss 6 m high, bowstring arch to 14 m over the main span, as M16: the deck, the charges and I_S show)
  { id: 'bridge', type: 'truss_bridge', variant: 'truss_bridge_maas', x: 58.6, z: 81.25, rot: BRIDGE_ROT, w: 85.4, d: 9, h: 14,
    trussH: 6, arch: [-16.5, 14], mat: 'metalRust', destructible: true, indestructible: true, vehiclesAllowed: true, charges: MARKERS.map((m) => ({ x: m.x, z: m.z })) },
  { id: 'pb_w', type: 'bunker', variant: 'pillbox_round', x: 21, z: 56, rot: 0, w: 5, d: 5, h: 3, mat: 'concrete', destructible: true, bunker: true },
  { id: 'pb_e', type: 'bunker', variant: 'pillbox_round', x: 87.5, z: 113, rot: 0, w: 5, d: 5, h: 3, mat: 'concrete', destructible: true, bunker: true },
  // the green explosives case on I_S (the pickup itself is `items[]`)
  { id: 'crate_bombs', type: 'crates', variant: 'explosives_case', x: 50.5, z: 88.5, rot: deg(30), w: 1.0, d: 0.6, h: 0.5, block: 0 },
  // MG pits: on the W bank below the bridge, and on the island
  bags('mg_w_n', 24, 72.8, 0, 3), bags('mg_w_s', 24, 76.4, 0, 3), bags('mg_w_w', 22.2, 74.6, 90, 3),
  bags('mg_isl_e', 47.9, 90, 90, 3), bags('mg_isl_s', 46, 91.9, 0, 3),
  bags('sandbags_isl', 48, 94.5, 25, 2.2),
  { id: 'isl_hut', type: 'hut', variant: 'timber_shed', x: 57.2, z: 91.5, rot: deg(-30), w: 4, d: 4, h: 2.6, destructible: true },
  { id: 'isl_jetty', type: 'pier', variant: 'pier_timber', x: 60, z: 101, rot: deg(-30), w: 5, d: 9 },
];

const EAST = [
  // zone A: the station (garrison g_station; one grenade by the platform door razes it) and its plank platform
  { id: 'station', type: 'barracks', variant: 'station_building', x: 182, z: 28.6, rot: deg(-45), w: 12, d: 7, h: 7, mat: 'brick',
    flag: true, garrison: true, door: deg(90), destructible: true, grenadeDestructible: true },
  { id: 'platform', type: 'pier', variant: 'station_platform_planks', x: 188, z: 33.5, rot: deg(-45), w: 22, d: 3.5 },
  // freight wagons on the stub siding N of the station (cover)
  { id: 'wagon_1', type: 'train_car', variant: 'rail_yard_derelict_boxcar', x: 194, z: 19.5, rot: deg(-40), w: 10, d: 3, h: 3.5 },
  // zone B: the timber house by the road (hideout), the house block round its yard, the grey townhouse, the fountain
  house('house_road', 'farmhouse_normandy', 177, 59, 10, 8, 9, { mat: 'woodDark', enterable: true, door: deg(90) }),
  house('blk_n', 'house_belgian_brick', 188, 73, 8, 8, 10, { mat: 'brick' }),
  house('blk_w', 'house_belgian_brick', 182, 85, 10, 8, 10, { mat: 'brick' }),
  house('blk_e', 'house_belgian_brick', 192, 82, 8, 10, 10, { mat: 'brick', enterable: true, door: deg(180) }),
  { id: 'town_grey', type: 'house', variant: 'townhouse_stucco', x: 198, z: 80, rot: 0, w: 6, d: 10, h: 12, mat: 'plaster' },
  { id: 'fountain_e', type: 'well', variant: 'fountain_statue', x: 177, z: 95, r: 2, h: 1.5 },
  // zone C: the fields hut (garrison g_fields, "the barracks with the flag"), the red tractor wreck, the field walls
  { id: 'hut_fields', type: 'barracks', variant: 'brick_hut', x: 173, z: 109, rot: deg(-45), w: 6, d: 5, h: 3.2, mat: 'brick',
    flag: true, garrison: true, door: deg(90), destructible: true, grenadeDestructible: true },
  { id: 'bulldozer', type: 'ruins', variant: 'bulldozer_rusty', x: 178, z: 122, rot: deg(-30), w: 4.5, d: 2.6, h: 2.2, mat: 'metalRust' },
  lowWall('wall_f1', [[189, 105], [193, 109]]),
  lowWall('wall_f2', [[180, 112], [184, 114], [184, 117]]),
  lowWall('wall_f3', [[188, 125], [194, 129]]),
  lowWall('wall_f4', [[184, 133], [188, 135]]),
  lowWall('wall_f5', [[175, 139], [178, 141]]),
  rock('rock_e1', 151, 82), rock('rock_e2', 140, 97), rock('rock_e3', 157, 108), rock('rock_k', 151, 127), rock('rock_e5', 189, 15),
  // zone D: the hedgehog belt along the E bank top (gaps at (100,99), (131,75), (152,52.5))
  belt('belt_a', [[95, 103], [98.6, 100.3]]),
  belt('belt_b', [[101.4, 97.7], [105, 94], [125, 81.5], [129.5, 76.4]]),
  belt('belt_c', [[132.5, 73.6], [138, 69], [142, 60], [148, 52], [150.5, 52.3]]),
  belt('belt_d', [[153.5, 52.7], [157, 53]]),
  { id: 'lx_boom_n', type: 'sign', variant: 'level_crossing_boom', x: 99.5, z: 119, rot: BRIDGE_ROT, r: 0.2, h: 1.2, block: 0 },
  { id: 'lx_boom_s', type: 'sign', variant: 'level_crossing_boom', x: 106.5, z: 122.5, rot: BRIDGE_ROT, r: 0.2, h: 1.2, block: 0 },
  // the four explosive barrels (Kildread "on site"): one between the houses, three by the lorry (10 m off its hull)
  barrel('barrel_se', 186, 94),
  barrel('brl_1', 100.5, 143.5), barrel('brl_2', 102.5, 143.8), barrel('brl_3', 104, 143.5),
  { id: 'wreck_car', type: 'ruins', variant: 'car_wreck_burnt', x: 123, z: 51.5, rot: deg(20), w: 4, d: 2, h: 1.4, mat: 'metalRust' },
  ...[[164.5, 23.5], [171, 26.5], [157, 30.6], [159, 36.7], [150, 41.8], [179.6, 6.1], [186.8, 2], [190.8, 3], [198, 8.2], [194, 1],
    [160, 70.6], [170.4, 96.1]].map(([x, z], k) => tree(x, z, `e${k}`)),
  ...[[140, 119], [153, 106.5], [166, 94], [179, 81.5], [192, 69]].map(([x, z], k) => ({ id: `pole_${k}`, type: 'telegraph_pole', x, z })),
];

const WEST = [
  // zone G: the NW town (the timber farmhouse is garrison g_town), the red house by the tank yard, the camp
  house('nw_h1', 'house_belgian_brick', 6.5, 5.5, 9, 8, 9, { mat: 'brick' }),
  house('nw_h2', 'house_belgian_brick', 15, 7, 8, 8, 9, { mat: 'brick' }),
  house('red_house', 'house_belgian_brick', 17.5, 16.5, 8, 8, 10, { mat: 'brick', enterable: true, door: deg(90), label: 'Red house' }),
  { id: 'nw_h3', type: 'barracks', variant: 'farmhouse_normandy', x: 30, z: 6.5, rot: deg(-45), w: 9, d: 8, h: 9, mat: 'woodDark',
    flag: true, garrison: true, door: deg(90), destructible: true },
  { id: 'monument', type: 'well', variant: 'fountain_statue', x: 22.5, z: 2.5, r: 1.5, h: 2.5 },
  bags('sb_nw1', 15.5, 22.8, 27, 5), bags('sb_nw2', 26.5, 16, -39, 5.5), bags('sb_nw3', 36.5, 9, 34, 3.5),
  ...[[47.4, 6.5], [53.6, 13.1], [42.8, 22], [37.5, 28], [31.4, 34.5]].map(([x, z], k) => tent(x, z, k)),
  rock('rock_w1', 12.6, 53.6), rock('rock_w2', 8, 62),
  ...[[4.6, 39], [4, 43], [5, 75], [10, 90]].map(([x, z], k) => tree(x, z, `w${k}`)),
];

const RAILWAY = [
  { id: 'rail_main', type: 'rail_track', points: [[201, 24.1], [139.5, 84.3], [103, 120.3], [73.2, 150]] },
];

const STRUCTURES = [...BRIDGE_SET, ...EAST, ...WEST, ...RAILWAY];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–31)
/** Lone walker: PINGPONG (or LOOP) over `pts` (1.0 m/s), starting at the first point facing the second. */
const walker = (id, prima, pts, type = 'PINGPONG') => ({
  id, prima, soldierType: 'soldier', x: pts[0].x, z: pts[0].z, heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x),
  flags: { investigates: true }, route: { type, vel: 1.0, points: pts },
});
/** Post guard: holds his post and investigates bodies only (§8 default). */
const sentry = (id, prima, x, z, h, sweep) => ({
  id, prima, soldierType: 'sentry', x, z, heading: deg(h), flags: { holdsPost: true, investigates: false }, post: { heading: deg(h), sweep },
});
/** A patrol: sergeant `ids[0]` + troopers in single file on one shared route. */
const patrol = (ids, prima, sq, type, points) => ids.map((id, k) => ({
  id, prima, soldierType: k ? 'trooper' : 'sergeant', x: points[0].x, z: points[0].z + 1.2 * k,
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: !k }, squad: { id: sq, leader: ids[0], columns: 1 },
  route: { type, vel: 1.0, points },
}));
/** Surveillance-bunker crew (M3 pattern): vision `bunker`, 40°, near 18 / far 36, sweep 50. */
const bunkerCrew = (id, structure, x, z, h) => ({
  id, soldierType: 'crew', x, z, heading: deg(h), structure, firesOnSight: true,
  vision: { fov: 40, near: 18, far: 36, sweep: 50 }, post: { heading: deg(h), sweep: 50 },
});
/** MG gunner at an emplacement (M4 pattern). */
const mg = (id, x, z, h, sweep, gun) => ({ id, soldierType: 'mg', x, z, heading: deg(h), emplacement: gun, post: { heading: deg(h), sweep, giro: 180 } });
/** SdKfz crew (not in the census): rides `veh`. */
const crew = (id, veh, x, z, h) => ({ id, soldierType: 'crew', x, z, heading: deg(h), vehicle: veh });

const ZONE_C = [ // the SE fields (Prima Phase 1, "the most difficult part")
  walker('e1', 1, [P(184, 121, 4, 270), P(197, 123, 4, 0)]),
  sentry('e2', 2, 179.5, 118, 330, 40),
  walker('e3', 3, [P(176, 126, 4, 90), P(183, 112, 3, 0)]),
  sentry('e4', 4, 191, 102, 200, 60),
  walker('e5', 5, [P(178, 99, 4, 180), P(195, 100, 4, 0)]),
  walker('e32', null, [P(176, 131, 4, 45), P(168, 140, 5, 180)]),
  walker('e33', null, [P(183, 78, 4, 0), P(186, 91, 4, 90)]),
  walker('e34', null, [P(170, 128, 3, 90), P(158, 122), P(159, 105.5, 4, 270)], 'LOOP'),
  walker('e35', null, [P(171.5, 129.5, 3, 90), P(159.5, 123.5), P(159.5, 109.5, 4, 270)], 'LOOP'),
  ...patrol(['p6', 'p6_a'], 6, 'p6', 'LOOP', [P(167, 104, 3, 90), P(180, 104), P(181, 115, 3, 180), P(167, 116)]),
  ...patrol(['p7', 'p7_a', 'p7_b'], 7, 'p7', 'LOOP', [P(158, 100, 4, 180), P(174, 92.5), P(196, 97, 4, 0), P(199, 112), P(186, 110), P(170, 100)]),
  ...patrol(['p40', 'p40_a', 'p40_b'], null, 'p40', 'LOOP', [P(138, 140, 4, 180), P(151, 124), P(166, 120, 3, 0), P(158, 138)]),
  ...patrol(['p41', 'p41_a', 'p41_b'], null, 'p41', 'LOOP', [P(128, 146, 3, 90), P(112, 139), P(104, 139, 5, 180), P(116, 133)]),
];
const ZONE_BA = [ // the E village and the station (Prima Phase 2)
  walker('e8', 8, [P(166, 67, 4, 180), P(179, 70, 4, 0)]),
  walker('e9', 9, [P(166, 50, 5, 315), P(152, 64, 4, 225)]),
  walker('e36', null, [P(136, 94), P(144, 94), P(144, 101, 3, 0), P(136, 101)], 'LOOP'),
  walker('e37', null, [P(144, 101), P(144, 94), P(136, 94, 3, 180), P(136, 101)], 'LOOP'),
  walker('e38', null, [P(120, 74, 4, 315), P(140, 58, 4, 45)]),
  ...patrol(['p15', 'p15_a', 'p15_b'], 15, 'p15', 'LOOP', [P(155, 80, 4, 225), P(166, 64.5), P(184, 52, 4, 0), P(194, 56), P(172, 70)]),
  walker('e12', null, [P(176, 40, 3, 0), P(163, 52, 4, 225)]),
  sentry('e13', 13, 184.8, 33.2, 135, 60), // 3.7 m from e14: one grenade takes both [P] (review: 5.5 m left him standing)
  sentry('e14', 14, 182.8, 36.3, 135, 40),
  walker('e16', 16, [P(179, 37, 4, 180), P(193.5, 25, 4, 0)]),
  sentry('e17', 17, 176, 19, 225, 50),
  sentry('e18', 18, 176, 6, 200, 50),
  walker('e11', null, [P(164, 24, 5, 225), P(184, 12, 4, 0)]),
];
const ZONE_EN = [ // the N island and the boat (Prima Phase 3): five men, cries unheard
  sentry('e19', 19, 91, 33, 90, 50),
  sentry('e20', 20, 97, 29.5, 110, 40),
  walker('e21', 21, [P(104, 17, 4, 45), P(116, 11, 4, 0)]),
  ...patrol(['p22', 'p22_a'], 22, 'p22', 'PINGPONG', [P(93, 24, 3, 180), P(110, 20, 3, 0)]),
];
const ZONE_G = [ // the German camp and the tank yard (Prima Phase 4)
  ...patrol(['p23', 'p23_a', 'p23_b', 'p23_c', 'p23_d'], 23, 'p23', 'LOOP',
    [P(26, 42, 4, 180), P(50, 30), P(66, 20), P(82, 24.5), P(96, 22, 6, 60), P(82, 24.5), P(58, 20), P(34, 20), P(24, 30)]),
  sentry('e24', 24, 52, 27, 200, 60),
  walker('e25', 25, [P(38, 4, 3, 180), P(58, 6, 3, 0)]),
  sentry('e26', 26, 52, 18.5, 135, 50),
  walker('e27', 27, [P(34, 31, 3, 90), P(41, 17, 3, 0)]),
  sentry('e28', 28, 31, 38.5, 135, 50),
  sentry('e29', 29, 62, 42, 45, 50),
  sentry('e30', 30, 15.5, 26, 90, 60),
  walker('e31', 31, [P(10, 24, 4, 180), P(8, 19, 4, 270)]),
];
const ZONE_FED = [ // the bridgeheads and the bridge island (Prima Phase 5)
  ...patrol(['p50', 'p50_a', 'p50_b'], null, 'p50', 'LOOP', [P(8, 34, 3, 45), P(20, 48), P(16, 62), P(17, 75, 4, 90), P(12, 62)]),
  mg('e51', 24, 74.6, 60, 60, 'mg_w_gun'),
  bunkerCrew('e59', 'pb_w', 21, 56, 200),
  mg('e54', 46, 90, 110, 70, 'mg_isl_gun'),
  walker('e57', null, [P(41, 92.5, 4, 180), P(55, 96, 4, 90)]),
  { ...sentry('e43', null, 82, 113, 200, 40), post: { heading: deg(200), sweep: 40, looks: [{ heading: deg(200), t: 8 }, { heading: deg(20), t: 6 }] } },
  bunkerCrew('e58', 'pb_e', 87.5, 113, 110),
  ...patrol(['p45', 'p45_a', 'p45_b', 'p45_c'], null, 'p45', 'LOOP', [P(96, 118, 4, 200), P(108, 108), P(120, 95), P(128, 86, 4, 315), P(116, 99), P(102, 113)]),
  ...patrol(['p46', 'p46_a', 'p46_b'], null, 'p46', 'PINGPONG', [P(76, 114, 4, 0), P(62, 140, 4, 180)]),
];
const CREWS = [crew('sdw_d', 'sd_w', 4, 52, 300), crew('sdw_g', 'sd_w', 4, 52, 300), crew('sde_d', 'sd_e', 121, 128, 315), crew('sde_g', 'sd_e', 121, 128, 315)];

/** Was the lorry destroyed by the team (a commando, his thrown/planted charge, or a vehicle he drives)? */
const byPlayer = (src) => [src, src?.owner, src?.driver, src?.operator].some((q) => q?.faction === 'player');

const ENEMIES = [...ZONE_C, ...ZONE_BA, ...ZONE_EN, ...ZONE_G, ...ZONE_FED, ...CREWS];

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const VEHICLES = [
  // the vacant Panzer III in the NW tank yard: the Driver drives it (the GB may ride along); nothing here can hurt it
  { id: 'pz3', vehicleType: 'panzer3', x: 4, z: 14, heading: deg(30), driveable: true, operators: ['driver'], seats: 2, suspicious: false },
  // two SdKfz 231 on patrol (2 crew each): the W one turns round behind the NW houses, the E one at the crossroads
  { id: 'sd_w', vehicleType: 'sdkfz', x: 4, z: 52, heading: deg(300), driveable: false, crew: ['sdw_d', 'sdw_g'],
    route: { type: 'LOOP', speed: 4, points: [P(4, 52, 20), P(12, 42), P(3, 24, 30), P(12, 42), P(24, 60, 12)] } },
  { id: 'sd_e', vehicleType: 'sdkfz', x: 121, z: 128, heading: deg(315), driveable: false, crew: ['sde_d', 'sde_g'],
    route: { type: 'PINGPONG', speed: 4, points: [P(121, 128, 5), P(135, 117.5), P(187.5, 66.5), P(196, 58, 8)] } },
  // the escape lorry by the S road (the Driver drives; four seats)
  { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 91.5, z: 143.5, heading: deg(345), driveable: true, operators: ['driver'], seats: 4 },
  // the Marine's pneumatic boat in the shallows of the N island (Marine + 2)
  { id: 'raft', vehicleType: 'raft', x: 97.5, z: 32.5, heading: deg(20), inflated: true, suspicious: false, operators: ['diver'], seats: 3 },
  // the train: NE → SW about every 90 s, stops 12 s at the station; stops short of damaged track for good
  { id: 'train', vehicleType: 'train', x: 200.6, z: 24.5, heading: deg(135.6), driveable: false, horn: true,
    track: [RAIL[0], RAIL[1], [160, 64.3, 0], ...RAIL.slice(2)].map((p, k) => ({ x: p[0], z: p[1], wait: k === 2 ? 12 : 0 })),
    schedule: { mode: 'once', speed: 9, period: 70, delay: 15 } },
  // the two MG nests (the Driver can man them once their gunner is dead)
  { id: 'mg_w_gun', vehicleType: 'mgNest', x: 24, z: 74.6, heading: deg(60), gunner: 'e51', driveable: true, operators: ['driver'] },
  { id: 'mg_isl_gun', vehicleType: 'mgNest', x: 46, z: 90, heading: deg(110), gunner: 'e54', driveable: true, operators: ['driver'] },
];

// ---------------------------------------------------------------- commandos (§3.8 row 18, exact): prone behind the SE wall
const COMMANDOS = [
  { role: 'greenberet', x: 192, z: 132, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1 } },
  { role: 'diver', x: 188.5, z: 131, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  { role: 'sapper', x: 190.5, z: 133.5, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, bearTrap: 1, grenade: 2 } },
  { role: 'driver', x: 194, z: 134.5, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, firstAid: 6 } },
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
const Z_ISL_N = [[76, 31], [78, 20], [86, 14], [96, 8], [114, 4], [123, 8], [123, 21], [100, 34], [92, 42], [84, 42]];
const Z_ISL_S = [[35, 106], [37, 87], [48, 80], [55, 76], [62, 76], [65, 84], [68, 97], [60, 108]];
const Z_ALL = [[0, 0], [201, 0], [201, 150], [0, 150]];
const squad = (exitRoute, loop) => ({ event: 'RINT', size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  // the station squad keeps to the N side of the railway, 6-7 m off the rails (its old loop ran along them: the train
  // killed it and the bodies drew the whole E garrison onto the track)
  station: { pool: 6, squads: [squad([P(185.5, 32.5), P(176, 38)], [P(176, 38), P(166, 50), P(152, 62), P(166, 50)])] },
  // the fields squad keeps 14 m or more off the SE start walls (review: its old loop passed 3 m from the prone Driver)
  hut_fields: { pool: 6, squads: [squad([P(175.5, 111.5), P(168, 116)], [P(168, 116), P(184, 108), P(176, 125), P(166, 138)])] },
  nw_h3: { pool: 6, squads: [squad([P(33, 10.5), P(32, 18)], [P(32, 18), P(50, 30), P(26, 42), P(20, 48)])] },
};

// ---------------------------------------------------------------- barbed wire (docs/barbed-wire.md §12)
/** The M4–M20 wire pass: see-through, uncrossable (B.FENCE) runs added where the wire belongs; none crosses a route
 *  or lengthens an approach (tests/unit/wire-placements.test.mjs). Drawn by the map's wire layer (art/wire-obstacles.js). */
const WIRE_PASS = [
  // rimed concertina in front of the W bank and island MG nests
  { id: 'wx_mg_w', type: 'fence', variant: 'concertina', points: [[28.4, 75.4], [27.9, 76.8], [26.9, 78], [25.5, 78.8], [24, 79.1], [22.5, 78.8]], h: 1.2 },
  { id: 'wx_mg_isl', type: 'fence', variant: 'concertina', points: [[46.3, 94.5], [45.2, 94.4], [43.8, 93.9], [42.6, 92.9], [41.8, 91.5]], h: 1.2 },
];

export default {
  id: 'm18',
  campaign: 'BEL',
  title: 'The Force of Circumstance',
  subtitle: 'The Maas bridge near Liège, Belgium · 16 December 1944',
  date: '1944-12-16',
  place: 'The Maas (Meuse) bridge north of Liège, Belgium',
  theater: 'temperate',
  coneColors: 'green',
  size: [201, 150],
  seed: 1944_1216,
  briefing: {
    historical: 'December 1944. Out of the fog of the Ardennes the Germans have thrown their last reserves at a thin Allied line, and the line is giving way. Their columns need the Maas crossings to keep moving west. Three months ago we fought to keep one of those bridges standing. Now it has to come down.',
    text: 'You know this ground better than anyone, officer. The difference is that this time you are on the other side of the argument. We have no charges of our own anywhere near, so you will have to use theirs: they keep a case of explosives on the island under the bridge. Put a charge on each of the three weak points of the span and bring it down. A lorry of ours will be waiting by the south road. When the bridge is gone, everybody in and drive out.',
    objectivesSummary: 'Blow the Maas bridge at its three marked points, then get everyone into the lorry and out by the south road.',
    hints: [
      'The enemy keeps explosives near the bridge, on the island beneath it. Only the Sapper can handle them.',
      'Three points on the deck will bring the span down. All three must go; the order does not matter.',
      'There is a German tank on the far bank, behind their camp. It would be a great help, and a shell on a marked point sets off the charge lying there.',
      'The trains stop at the station. A stopped train is a wall. Damaged track stops the next train for good.',
      'The whole area is on alert: anything seen anywhere brings the siren and fresh troops from their barracks. A barracks that is destroyed sends nobody.',
      'The Marine\'s boat lies on the island in the north of the river. It carries him and two more. Keep it out of sight and do not leave it unattended: a guard who spots it will shoot it full of holes, and anyone left on the deck when the span falls goes down with it.',
      'The lorry waits by the south road. Do not destroy it: it is the only way out.',
    ],
  },
  groundPalette: 'frost', // §2.4 frost variant: rimed grass, wet mud (the LUT below grades the frame)
  lighting: { sunElevDeg: 14, sunAzimuthDeg: 165, kelvin: 6800, hdri: 'overcast', fog: 180, lut: 'temperate_frost' },
  water: { velocity: 0.2, angleDeg: 225, turbulence: 0.25, color: '#1c4f55' },
  baseTerrain: 'grass',
  terrain: TERRAIN,
  markers: MARKERS.map((m) => ({ ...m })),
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures([...STRUCTURES, ...WIRE_PASS], [['bridge', 'pb_w'], ['bridge', 'pb_e'], ['blk_n', 'blk_e'], ['blk_w', 'blk_e'], ['blk_e', 'town_grey'], ['nw_h1', 'nw_h2'], ['nw_h2', 'red_house']]),
  // the green case: three German remote charges (Sapper only; the detonator comes with the first one planted)
  items: [{ id: 'bombs_crate', itemId: 'remoteBomb', x: 50.5, z: 88.5, count: 3 }],
  interactables: [],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // the islands first (alarm.zoneAt takes the first match): cries there reach no one; the rest is one silent zone
  zones: [
    { id: 'z_isl_n', poly: Z_ISL_N, onSeen: null, onHeard: null },
    { id: 'z_isl_s', poly: Z_ISL_S, onSeen: null, onHeard: null },
    // `ignoreFrom`: a cry, shot or alarm shout from the islands (or about a body there) does not reach the banks; a
    // bank guard who spots a body on an island goes to look (P23 "comes to look at the bodies" [P]) but trips nothing
    { id: 'z_all', poly: Z_ALL, onSeen: 'RINT', onHeard: 'RINT', siren: true, ignoreFrom: ['z_isl_n', 'z_isl_s'] },
  ],
  jails: [],
  // a blast pulls the men within 45 m to look (Kildread's end game: grenades on the patrols by the lorry, hide from
  // those who come); it still sounds the siren map-wide, but no longer walks the whole E/S garrison to the spot
  explosionPull: 45,
  barracks: BARRACKS,
  climbLinks: [],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Blow up the Maas bridge: charges at the three marked points', type: 'destroy', targets: ['bridge'], required: true },
    { id: 'o2', text: 'Then everyone into the lorry and out by the south road', type: 'escape', required: true, vehicleId: 'truck' },
  ],
  setpieces: [
    { type: 'deck_underpass', id: 'deck_underpass', structure: 'bridge' },
    { type: 'rail_line', id: 'rail', track: RAIL, width: 9, stopBy: ['grenade', 'bomb', 'shell'], blockR: 1.5 },
    { type: 'multi_charge', id: 'abc', target: 'bridge', markers: ['A', 'B', 'C'], by: ['bomb', 'shell'], window: 1e9 },
  ],
  triggers: [
    // per-tick glue: the charges picked up, marker progress, the S-road drive-off
    { on: 'tick', once: false, when: () => true, do: [{ run: (w) => m18Tick(w) }] },
    { on: 'structure:destroyed', match: { id: 'bridge' }, do: [{ run: (w) => onBridgeDown(w) }] },
    // T3: the tank
    { on: 'vehicle:enter', match: { vehicle: 'pz3' }, do: [{ message: 'Panzer III. Nothing on this side of the river can stop it.', kind: 'info' }] },
    // T5: the bridge is down
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'The bridge is down. Everyone to the lorry.', kind: 'objective' }] },
    // T6: the lorry is the only way out (§8.1 wording when the team blew it up; a neutral one when the enemy did)
    { on: 'vehicle:destroyed', match: { vehicle: 'truck' }, when: (p, w) => !w.objectives?.find((o) => o.id === 'o2')?.done && byPlayer(p.source),
      do: [{ fail: 'YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE.' }] },
    { on: 'vehicle:destroyed', match: { vehicle: 'truck' }, when: (p, w) => !w.objectives?.find((o) => o.id === 'o2')?.done && !byPlayer(p.source),
      do: [{ fail: 'THE TRUCK IS GONE. THERE IS NO WAY OUT.' }] },
  ],
  // the lorry is already here: the extraction adopts it; once o1 is done and everyone is aboard it drives off by the
  // S road (m18Tick path-finds the run to `exit`; ESC skips the drive)
  extraction: {
    vehicleId: 'truck', spawnAt: { x: 91.5, z: 143.5, heading: deg(345) }, spawnWhen: ['o1'],
    exit: { x: 139.5, z: 146.5, r: 5 }, leave: { x: 141, z: 163, speed: 7 },
  },
  par: { time: 900 },
  cameraStart: { x: 185, z: 128, zoom: 1 },
  startDisguised: [],
};
