/**
 * BEL Mission 16 — "Stop Wildfire" (buildable layout: docs/missions/m16.md). Owned by MISSIONS.
 * The Maas bridge north of Liège, 4 September 1944. Four German engineers have wired the steel truss bridge:
 * e14 on the W bank (plunger D_W in a sandbag pit), e16 and e17 on the island under the spans (shared plunger
 * D_I) and e15 at the E bridgehead (plunger D_E on the deck). The whole map is one silent zone: anything seen or
 * heard sounds the siren, the siren sends every living sapper running, and a sapper who reaches his plunger blows
 * the bridge (alarmFail DETONATE). The team (Sniper 5 rounds, Marine, Spy with the only licence to drive the
 * lorry) starts in the NE wood; the Spy's uniform dries on a clothesline in the E village. Kill the four almost
 * together, then everyone into the lorry: the drive-off leaves by the south road.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid, engine; see the commit message):
 *  - flat map: the river is deep water at y 0 (no −3 m surface, no bank slopes); the bridge deck is a walkable
 *    truss_bridge whose girders keep walkers and surface swimmers on (or off) it; a diver passes under the water
 *    spans (`deck_underpass`, scripts/m16.js). Piers, abutments and the four charges are part of the bridge model, not
 *    grid props (a pier footprint would cut the deck);
 *  - "RALL" is the engine's siren event RINT (the only event that starts the siren and wakes every sapper);
 *  - the engineer arrival fix (dossier §14 #1) and the lorry block live in m16Tick, not in enemy-brain.js;
 *  - the Spy's hide "under the bridge" is on the W shore beside the deck (37.5,71.5); e14's E turn moved there
 *    (38,72.5) off the deck girder; e37's N turn, P26's N turn, e8's walk and the barrels moved off blocked or
 *    wet cells; the barrels sit 9 m from the lorry so the barrel blast (6.75 m) cannot reach it;
 *  - the drive-off: the extraction adopts the parked lorry (spawnAt/spawnWhen ['o1']); when everyone is aboard
 *    after o1 the drive-off starts and the win is recorded at once (dossier §10.2: the win never depends on the
 *    drive; scripts/m16.js sets `drivenOff`); the lorry then path-finds to the S road exit as scenery;
 *  - a disguised Spy boarding the lorry in view is routine (`rules.spyMayBoard`), not a suspicious act;
 *  - the island's N shore lies under the deck, so the dossier's N-shore inlet (51,83.5) does not exist: the
 *    Marine dives under the spans (grid `underpass`) and waits in the water off the W shore (37,92), 7 m from e16,
 *    where the harpoon reaches the island pair; the harpoon brings him to the surface for the shot (weapons.js, §3
 *    "from the water surface"), so he is visible for it; the walkthrough's surface-and-knife from the shallows (42,86.5) works too;
 *  - Patrol 25 walks (100,131)↔(114,133): 4 m clear of the parked lorry and 6 m off the railway (the dossier's
 *    (88,131)↔(114,137) grazes the lorry's hull and puts its W end on the rails, where the train kills them).
 */

import { m16Tick, DETONATORS, CHARGES, SAPPERS } from './scripts/m16.js';
import { explosionReach } from '../abilities/explosions.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)

// ---------------------------------------------------------------- terrain (dossier §4.2)
/** T1 the Maas, NE → SW (deep water; the engine rims it with a 2 m shallow band). */
const RIVER = [[0, 104], [24, 88], [40, 73], [59, 50], [76.5, 28], [100, 0], [166, 0], [148.5, 22.4], [111, 70], [97.7, 79],
  [89, 95], [78.3, 110.6], [67.5, 119.6], [58, 150], [0, 150]];
/** T4 the bridge island I_S (moved 6 m N so pier P2 stands on its N tip), T5 the N island I_N. */
const ISLAND_S = [[38.6, 103.3], [40.2, 88.2], [48.3, 83.2], [55, 79], [60, 79], [62.1, 84.4], [65.3, 97], [58.9, 104.6]];
const ISLAND_N = [[87.3, 39.6], [88, 25], [98.1, 13.8], [107.5, 10.4], [113.9, 7.6], [119.7, 10.4], [119.7, 19.4], [112.5, 23.9],
  [105.3, 27.2], [98.1, 30.6], [90.9, 38.4]];
/** T11 the railway (both ends off the map); the train stops with its engine at (160, 64.3), coaches by the platform. */
export const RAIL = [[212, 13.5], [200.6, 24.5], [139.5, 84.3], [103, 120.3], [73.2, 150], [62, 161]];
const ROADS = {
  nw: [[0, 25], [25.7, 54]],                                          // T7 to the bridge's W end
  bridgehead: [[91.5, 108.5], [103, 121], [119, 130]],               // T8 over the level crossing
  ne: [[119, 130], [135, 117.5], [187.5, 66.5], [201, 53.5]],        // T9 between the timber house and the block
  south: [[119, 130], [139.5, 148.7], [140.5, 150]],                 // T10 the escape road
};

const TERRAIN = [
  { type: 'poly', terrain: 'water', points: RIVER },
  { type: 'poly', terrain: 'grass', points: ISLAND_S },
  { type: 'poly', terrain: 'grass', points: ISLAND_N },
  { type: 'circle', terrain: 'grass', x: 86.5, z: 55, r: 2 },        // T6 islets
  { type: 'poly', terrain: 'ground', points: [[109, 0], [120, 0], [120, 4], [109, 4]] },
  { type: 'path', terrain: 'road', width: 6, points: ROADS.nw, surface: 'belgian' },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.bridgehead, surface: 'belgian' },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.ne, surface: 'belgian' },
  { type: 'path', terrain: 'road', width: 6.5, points: ROADS.south },
  // T12 ploughed field SE; T13 bare earth round the station, the fountain, the NW houses and the tent camp
  { type: 'poly', terrain: 'ground', points: [[171, 103], [201, 98], [201, 150], [160, 150]] },
  { type: 'circle', terrain: 'ground', x: 184, z: 34, r: 9 },
  { type: 'circle', terrain: 'ground', x: 180, z: 97, r: 6 },
  { type: 'circle', terrain: 'ground', x: 18, z: 10, r: 10 },
  { type: 'circle', terrain: 'ground', x: 44, z: 22, r: 11 },
];

// ---------------------------------------------------------------- structures (dossier §5)
const BRIDGE_ROT = deg(39.6);
const house = (id, variant, x, z, w, d, h, extra = {}) => ({ id, type: 'house', variant, x, z, rot: deg(-45), w, d, h, ...extra });
const tree = (x, z, k) => ({ id: `tree_${k}`, type: 'tree', variant: 'broadleaf', x, z });
const rock = (id, x, z) => ({ id, type: 'rocks', x, z, r: 1.5 });
const tent = (x, z, k) => ({ id: `tent_${k}`, type: 'tent', variant: 'tent_ridge_field', asset: 'tent_ridge_field', x, z, rot: deg(-25), w: 5, d: 3.5, h: 2.2 });
const lowWall = (id, points) => ({ id, type: 'wall', variant: 'ruined_stone_low', points, h: 1.2, width: 0.6, mat: 'stone', block: 1 });
/** Czech hedgehogs + barbed wire along the E bank top: stops feet, not eyes (B.FENCE), with three gaps. */
const belt = (id, points) => ({ id, type: 'fence', variant: 'czech_hedgehog_wire', points, h: 1.4, width: 1.2 });

const BRIDGE_SET = [
  // §5.1 the steel through-truss, deck at ground level from (25.7,54) to (91.5,108.5); never destructible here
  // (open Pratt truss 6 m high, bowstring arch to 14 m over the main span P1–P3; ART: truss_bridge_maas model)
  { id: 'bridge', type: 'truss_bridge', variant: 'truss_bridge_maas', x: 58.6, z: 81.25, rot: BRIDGE_ROT, w: 85.4, d: 9, h: 14,
    trussH: 6, arch: [-16.5, 14], mat: 'metalRust', indestructible: true, charges: CHARGES.map(([x, z]) => ({ x, z })) },
  // the round pillboxes turn their three embrasures (model front ±45°, local +z) onto their crew's watch: rot = heading − 90°;
  // pb_w stands on the bank S of the W ramp, 7 m from the dossier's (21,56): its 5 m drum (and sandbags) clears the NW road's
  // setts and the ramp parapet's end (it used to sit on both), and the W-road patrol still passes 5 m off its W side
  { id: 'pb_w', type: 'bunker', variant: 'pillbox_round', asset: 'pillbox_round_be', x: 21.6, z: 62.8, rot: deg(110), w: 5, d: 5, h: 3, mat: 'concrete' },
  { id: 'pb_e', type: 'bunker', variant: 'pillbox_round', asset: 'pillbox_round_be', x: 87.5, z: 113, rot: deg(20), w: 5, d: 5, h: 3, mat: 'concrete' },
  // the three plungers (visual boxes; the sappers' `detonator` spawns hold the logic)
  { id: 'D_W', type: 'detonator', x: DETONATORS.D_W.x, z: DETONATORS.D_W.z, rot: deg(45) },
  { id: 'D_W_bags_n', type: 'sandbags', x: 22.5, z: 75, rot: 0, w: 3.5, d: 0.8, h: 0.9 },
  { id: 'D_W_bags_s', type: 'sandbags', x: 22.5, z: 79.2, rot: 0, w: 3.5, d: 0.8, h: 0.9 },
  { id: 'D_W_bags_w', type: 'sandbags', x: 20.4, z: 77.1, rot: deg(90), w: 3.4, d: 0.8, h: 0.9 },
  { id: 'D_I', type: 'detonator', x: DETONATORS.D_I.x, z: DETONATORS.D_I.z, rot: 0 },
  { id: 'D_E', type: 'detonator', x: DETONATORS.D_E.x, z: DETONATORS.D_E.z, rot: BRIDGE_ROT,
    alignFree: 'on the bridge deck, square to the bridge (BRIDGE_ROT), not to the wire belt beyond it' },
  { id: 'isl_hut', type: 'hut', variant: 'timber_shed', asset: 'shed_tarred_be', x: 57.2, z: 91.5, rot: deg(-30), w: 4, d: 4, h: 2.6 },
  { id: 'isl_jetty', type: 'pier', variant: 'pier_timber', x: 60, z: 101, rot: deg(-30), w: 5, d: 9 },
];

const EAST = [
  // zone A: the station (garrison g_station) and its plank platform
  { id: 'station', type: 'barracks', variant: 'station_building', asset: 'station_halt_be', x: 182, z: 28.6, rot: deg(-45), w: 12, d: 7, h: 7, mat: 'brick',
    flag: true, garrison: true, door: deg(90) },
  { id: 'platform', type: 'pier', variant: 'station_platform_planks', x: 188, z: 33.5, rot: deg(-45), w: 22, d: 3.5 },
  // zone B: the timber house by the road (hideout), the house block round its yard, the grey townhouse, the fountain
  house('house_road', 'farmhouse_normandy', 177, 59, 10, 8, 9, { asset: 'farmhouse_mosan_a', mat: 'woodDark', enterable: true, door: deg(90) }),
  house('blk_n', 'house_belgian_brick', 188, 73, 8, 8, 10, { asset: 'house_belgian_brick_a', mat: 'brick' }),
  house('blk_w', 'house_belgian_brick', 182, 85, 10, 8, 10, { asset: 'house_belgian_brick_b', mat: 'brick' }),
  house('blk_e', 'house_belgian_brick', 192, 82, 8, 10, 10, { asset: 'house_belgian_brick_w', mat: 'brick', enterable: true, door: deg(180) }),
  { id: 'town_grey', type: 'house', variant: 'townhouse_stucco', asset: 'townhouse_stucco_be_a', x: 198, z: 80, rot: 0, w: 6, d: 10, h: 12, mat: 'plaster' },
  { id: 'fountain_e', type: 'well', variant: 'fountain_statue', x: 177, z: 95, r: 2, h: 1.5 },
  // zone C: the fields hut (garrison g_fields), the rusty bulldozer, the ruined field walls
  { id: 'hut_fields', type: 'barracks', variant: 'brick_hut', asset: 'hut_brick_be', x: 173, z: 109, rot: deg(-45), w: 6, d: 5, h: 3.2, mat: 'brick',
    flag: true, garrison: true, door: deg(90) },
  { id: 'bulldozer', type: 'ruins', variant: 'bulldozer_rusty', asset: 'bulldozer_rusty', x: 178, z: 122, rot: deg(-30), w: 4.5, d: 2.6, h: 2.2, mat: 'metalRust' },
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
  // the level crossing (booms up) and the explosive barrels by the lorry (9 m off its hull)
  { id: 'lx_boom_n', type: 'sign', variant: 'level_crossing_boom', x: 99.5, z: 119, rot: BRIDGE_ROT, r: 0.2, h: 1.2, block: 0 },
  { id: 'lx_boom_s', type: 'sign', variant: 'level_crossing_boom', x: 106.5, z: 122.5, rot: BRIDGE_ROT, r: 0.2, h: 1.2, block: 0 },
  { id: 'brl_1', type: 'barrels', variant: 'fuel_explosive', x: 104, z: 147, explosive: 'barrel', carriable: true },
  { id: 'brl_2', type: 'barrels', variant: 'fuel_explosive', x: 105.4, z: 147.6, explosive: 'barrel', carriable: true },
  { id: 'brl_3', type: 'barrels', variant: 'fuel_explosive', x: 106.8, z: 147, explosive: 'barrel', carriable: true },
  // the burnt car lies half in the E-bank shallows (the dossier's (123,51.5) is deep water on this flat river; r2)
  { id: 'wreck_car', type: 'ruins', variant: 'car_wreck_burnt', x: 125.5, z: 50, rot: deg(20), w: 4, d: 2, h: 1.4, mat: 'metalRust',
    vehicleArt: 'citroen11', wreck: true }, // art pass: a burnt-out Traction Avant (was a shrunken bombed house)
  // the NE wood (the start) and scattered trees
  ...[[164.5, 23.5], [171, 26.5], [157, 30.6], [159, 36.7], [150, 41.8], [179.6, 6.1], [186.8, 2], [190.8, 3], [198, 8.2], [194, 1],
    [160, 70.6], [170.4, 96.1]].map(([x, z], k) => tree(x, z, `e${k}`)),
  // telegraph poles along the NE road (S side; pole_3 stands 0.7 m nearer the road, clear of blk_w's eave since the art pass)
  ...[[140, 119], [153, 106.5], [166, 94], [178.5, 81], [192, 69]].map(([x, z], k) => ({ id: `pole_${k}`, type: 'telegraph_pole', x, z })),
];

const WEST = [
  // zone G: the NW town (the grey shop-front house is garrison g_town), the monument, the tent camp
  house('nw_h1', 'house_belgian_brick', 6.5, 5.5, 9, 8, 9, { asset: 'house_belgian_brick_c', mat: 'brick' }),
  house('nw_h2', 'house_belgian_brick', 15, 7, 8, 8, 9, { asset: 'house_belgian_brick_a', mat: 'brick' }),
  { id: 'nw_grey', type: 'barracks', variant: 'townhouse_stucco', asset: 'townhouse_stucco_be_b', x: 17, z: 16.5, rot: deg(-45), w: 8, d: 8, h: 12, mat: 'plaster',
    flag: true, garrison: true, door: deg(90) },
  house('nw_h3', 'farmhouse_normandy', 30, 6.5, 9, 8, 9, { asset: 'farmhouse_mosan_b', mat: 'woodDark' }),
  { id: 'monument', type: 'well', variant: 'fountain_statue', x: 22.5, z: 2.5, r: 1.5, h: 2.5 },
  ...[[47.4, 6.5], [53.6, 13.1], [42.8, 22], [37.5, 28], [31.4, 34.5]].map(([x, z], k) => tent(x, z, k)),
  rock('rock_w1', 12.6, 53.6), rock('rock_w2', 8, 62),
  ...[[4.6, 39], [4, 43], [5, 75], [10, 90]].map(([x, z], k) => tree(x, z, `w${k}`)),
];

const RAILWAY = [
  { id: 'rail_main', type: 'rail_track', points: [[201, 24.1], [139.5, 84.3], [103, 120.3], [73.2, 150]] },
];

// ---------------------------------------------------------------- art pass: set dressing (visual only, clear of every
// route, post, cone and the solution's spots; furniture and paving never touch the walk grid: block false / grid false)
/** A point in a structure's local frame (+x along `rot`, +z its door side) → world [x, z]. */
const local = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) - lz * Math.sin(rot), cz + lx * Math.sin(rot) + lz * Math.cos(rot)];
const ST = (lx, lz) => local(182, 28.6, deg(-45), lx, lz);
/** Two parked machines on free ground: a BMW R75 combination behind the station, a Kübelwagen by the town garrison. */
const PARKED = [
  { id: 'moto_station', type: 'crates', variant: 'vehicle_parked', label: 'Motorcycle', x: ST(-3.5, -7.6)[0], z: ST(-3.5, -7.6)[1], rot: deg(-45),
    w: 2.4, d: 1.7, h: 1.1, block: 1, vehicleArt: 'r75_sidecar' },
  { id: 'kubel_town', type: 'crates', variant: 'vehicle_parked', label: 'Car', x: 5, z: 17.5, rot: Math.atan2(29, 25.7), // parallel to the NW road
    w: 3.8, d: 1.7, h: 1.4, block: 1,
    vehicleArt: 'kubelwagen' },
];
/** Belgian setts (pavés): the station forecourt on the road side, the little square round the NW monument. */
const PAVEMENTS = [
  { id: 'pave_station', surface: 'belgian', points: [ST(-7.5, -3.6), ST(7.5, -3.6), ST(7.5, -9.5), ST(-7.5, -9.5)],
    wear: 0.6, weeds: 0.4, cracks: 0.3, puddles: 0.15, edge: 'ragged', grid: false },
  { id: 'pave_monument', surface: 'belgian', points: [[19, 0], [26, 0], [26.5, 4.5], [24.5, 6.5], [20.5, 6.5], [18.5, 4.5]],
    wear: 0.5, weeds: 0.45, cracks: 0.3, puddles: 0.1, edge: 'ragged', grid: false },
];
const FURNITURE = [
  // platform lamps at both ends of the plank platform, a lamp on the station forecourt
  { type: 'lamp', variant: 'platform', x: local(188, 33.5, deg(-45), 8.5, 0.6)[0], z: local(188, 33.5, deg(-45), 8.5, 0.6)[1], rot: deg(45), block: false },
  { type: 'lamp', variant: 'platform', x: local(188, 33.5, deg(-45), -8.5, 0.6)[0], z: local(188, 33.5, deg(-45), -8.5, 0.6)[1], rot: deg(45), block: false },
  { type: 'lamp', variant: 'paris_single', x: ST(5.5, -8.8)[0], z: ST(5.5, -8.8)[1], rot: deg(-135), block: false },
  // St Andrew's crosses on the verge of each approach to the level crossing, a fingerpost in the SW corner of the
  // S-road junction, kilometre stones on the NE road (all clear of the carriageway: art-m16 test)
  { type: 'sign', variant: 'andreaskreuz', x: 96.0, z: 120.1, rot: deg(-45), block: false },
  { type: 'sign', variant: 'andreaskreuz', x: 110.0, z: 119.6, rot: deg(135), block: false },
  { type: 'sign', variant: 'fingerpost', x: 116.2, z: 134.9, rot: deg(-40), text: 'LIEGE 9 km', block: false },
  { type: 'milestone', x: 153.1, z: 106.1, rot: deg(-44), text: 'N 2\nLIEGE 11', block: false },
  { type: 'milestone', x: 182.4, z: 77.7, rot: deg(-44), text: 'N 2\nVISE 6', block: false },
  // the NW town square: a lamp and two benches by the monument; a bench by the village fountain
  { type: 'lamp', variant: 'paris_single', x: 26.2, z: 6.2, rot: deg(-90), block: false },
  { type: 'bench', x: 19.6, z: 4.2, rot: deg(-90), block: false },
  { type: 'bench', x: 25.6, z: 2.4, rot: deg(90), block: false },
  { type: 'bench', x: 180.6, z: 92.4, rot: deg(-135), block: false },
];

const STRUCTURES = [...BRIDGE_SET, ...EAST, ...WEST, ...RAILWAY, ...PARKED];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–26)
/** Lone walker: PINGPONG between a and b (1.0 m/s), starting at a facing b. */
const walker = (id, prima, a, b, flags = {}) => ({
  id, prima, soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
  flags: { investigates: true, ...flags }, route: { type: 'PINGPONG', vel: 1.0, points: [a, b] },
});
/** Post guard: holds his post and investigates bodies only (dossier §8 default); `investigates` for S12. */
const sentry = (id, prima, x, z, h, sweep, { investigates = false } = {}) => ({
  id, prima, soldierType: 'sentry', x, z, heading: deg(h), flags: { holdsPost: !investigates, investigates }, post: { heading: deg(h), sweep },
});
/** A patrol: sergeant `ids[0]` + troopers on one shared route (dossier §8.7: 3 + 4 + 4 + 5 + 5 men). */
const patrol = (ids, prima, sq, type, points, columns = 2) => ids.map((id, k) => ({
  id, prima, soldierType: k ? 'trooper' : 'sergeant', x: points[0].x + 0.8 * (k % 2), z: points[0].z + 1.4 * Math.floor(k / 2),
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: true }, squad: { id: sq, leader: ids[0], columns },
  route: { type, vel: 1.0, points },
}));
/** An engineer (§4.1): unarmed, 200 HP, runs to `det` at the slightest sign and fires DETONATE on arrival. */
const sapper = (id, prima, det, extra) => ({
  id, prima, soldierType: 'engineer', detonator: { ...DETONATORS[det] }, onArrive: 'DETONATE', plunger: det,
  flags: { investigates: false, holdsPost: true }, ...extra,
});
/** Surveillance-bunker crew (M3 pattern): vision `bunker`, 40°, near 18 / far 36, sweep 50. */
const bunkerCrew = (id, structure, x, z, h) => ({
  id, soldierType: 'crew', x, z, heading: deg(h), structure, firesOnSight: true,
  vision: { fov: 40, near: 18, far: 36, sweep: 50 }, post: { heading: deg(h), sweep: 50 },
});

const ZONE_A = [ // the station (Prima Phase 1)
  walker('e1', 1, P(180, 36, 6, 0), P(168, 50, 5, 135)),
  sentry('e2', 2, 186.5, 32.5, 135, 60), // on the platform, the station wall at his back
  sentry('e3', 3, 190, 43, 90, 60),
  walker('e4', 4, P(199, 39, 4, 90), P(183, 52, 4, 180)),
];
const ZONE_B = [ // the E village (Prima Phases 1–2)
  walker('e5', 5, P(175, 43.5, 4, 0), P(163, 55, 4, 180)),
  sentry('e6', 6, 168, 66.5, 90, 60),
  walker('e7', 7, P(150, 86, 5, 225), P(181, 64, 4, 90)), // up the road to house_road's door and back
  walker('e8', 8, P(172.5, 78, 6, 225), P(172.5, 90, 4, 180)),
  sentry('e9', 9, 168, 106, 180, 40),
  walker('e10', 10, P(186, 97, 4, 0), P(182, 111, 5, 90)),
  sentry('e12', 12, 170, 97, 90, 90, { investigates: true }),
  ...patrol(['e11', 'e39', 'e40'], 11, 'p11', 'LOOP', [P(173, 99, 3, 180), P(185, 104), P(197, 104, 4, 0), P(199, 94), P(190, 92, 3, 270)], 1),
];
const ZONE_CD = [ // fields, the lorry and the E bridgehead (Prima Phases 3–4)
  ...patrol(['e13', 'e41', 'e42', 'e43'], 13, 'p13', 'PINGPONG', [P(150, 131, 5, 0), P(122, 143), P(100, 146, 5, 180)]),
  ...patrol(['e25', 'e44', 'e45', 'e46'], 25, 'p25', 'PINGPONG', [P(100, 131, 5, 225), P(114, 133, 5, 45)]),
  sentry('e19', 19, 108, 144, 225, 60),
  walker('e20', 20, P(121, 133, 4, 180), P(136, 146, 4, 90)),
  sentry('e21', 21, 95, 104.5, 180, 60),
  sentry('e22', 22, 102, 109, 270, 60),
  walker('e23', 23, P(107.3, 108.2, 4, 225), P(122.3, 93.2, 4, 45)),
  sentry('e24', 24, 112, 118, 180, 60),
  ...patrol(['e26', 'e47', 'e48', 'e49', 'e50'], 26, 'p26', 'PINGPONG', [P(73, 132, 5, 180), P(79, 121), P(82, 116.5, 5, 45)]),
  walker('e37', null, P(104, 78, 4, 200), P(123, 58.5, 4, 45)), // the E beach N of the bridge, past the car wreck
  sentry('e38', null, 127, 86, 225, 60),
  bunkerCrew('e57', 'pb_e', 87.5, 113, 110),
];
const SAPPER_LIST = [ // §8.4 the objective: "they watch one another"
  sapper('e14', 14, 'D_W', { x: 25, z: 74.5, heading: deg(-15), // W bank; his E turn is right by the Spy's hide
    route: { type: 'PINGPONG', vel: 1.0, points: [P(25, 74.5, 6, 45), P(38, 72.5, 5, 90)] } }),
  sapper('e15', 15, 'D_E', { x: 100, z: 117, heading: deg(218), // E bridgehead, walks past the pillbox
    route: { type: 'PINGPONG', vel: 1.0, points: [P(100, 117, 6, 45), P(92, 110.5, 6, 225)] } }),
  sapper('e16', 16, 'D_I', { x: 44, z: 90, heading: deg(0), post: { heading: deg(0), sweep: 60 } }), // the "slow" one
  sapper('e17', 17, 'D_I', { x: 54.5, z: 95.5, heading: deg(20), // the "fast" one on the island's S shore
    route: { type: 'PINGPONG', vel: 1.6, points: [P(54.5, 95.5, 3, 180), P(62.5, 98.5, 3, 45)] } }),
];
const ZONE_F = [ // the W bridgehead
  sentry('e18', 18, 16, 79, 45, 90),
  ...patrol(['e51', 'e52', 'e53', 'e54', 'e55'], null, 'pw', 'PINGPONG', [P(4, 30, 5, 225), P(21, 47), P(14, 70, 5, 45)]),
  bunkerCrew('e56', 'pb_w', 21.6, 62.8, 200),
  sentry('e28', null, 19, 36, 45, 60),
];
const ZONE_G = [ // NW town, tent camp and the N island (optional)
  sentry('e27', null, 24, 11, 90, 60),
  walker('e29', null, P(47, 15, 4, 0), P(58, 20, 4, 90)),
  sentry('e30', null, 36, 20, 90, 60),
  walker('e31', null, P(46, 32, 4, 180), P(56, 27, 4, 0)),
  sentry('e32', null, 37, 40, 45, 60),
  walker('e33', null, P(52, 37, 4, 270), P(60, 41, 4, 90)),
  sentry('e34', null, 69.6, 19, 45, 60),
  walker('e35', null, P(99, 20.5, 4, 45), P(112, 14, 4, 0)),
  walker('e36', null, P(91, 36, 4, 180), P(100, 27, 4, 45)),
];

const ENEMIES = [...ZONE_A, ...ZONE_B, ...ZONE_CD, ...SAPPER_LIST, ...ZONE_F, ...ZONE_G];

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const VEHICLES = [
  // the Opel Blitz by the S road: the Spy drives it in this mission (§3.8 row 16), four seats
  { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 97, z: 137.5, heading: deg(0), driveable: true, operators: ['spy'], seats: 4 },
  // the train: NE → SW, stops 12 s at the station (engine at (160,64.3), coaches by the platform), then runs on
  { id: 'train', vehicleType: 'train', x: 200.6, z: 24.5, heading: deg(135.6), driveable: false, horn: true,
    track: [RAIL[0], RAIL[1], [160, 64.3, 0], ...RAIL.slice(2)].map((p, k) => ({ x: p[0], z: p[1], wait: k === 2 ? 12 : 0 })),
    schedule: { mode: 'once', speed: 9, period: 60, delay: 15 } },
];

// ---------------------------------------------------------------- commandos (§3.8 row 16, exact)
const COMMANDOS = [
  { id: 'sn', role: 'sniper', x: 190, z: 8, heading: deg(135), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 5 } },
  { id: 'ma', role: 'diver', x: 186, z: 6.5, heading: deg(135), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1 } },
  { id: 'sp', role: 'spy', x: 194, z: 11, heading: deg(135), stance: 'crawl', inventory: { pistol: 1, lethalInjection: 1, firstAid: 6 } },
];

// ---------------------------------------------------------------- zone and garrisons (dossier §9)
const Z_ALL = [[0, 0], [201, 0], [201, 150], [0, 150]];
const squad = (exitRoute, loop) => ({ event: 'RINT', size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  station: { pool: 6, squads: [squad([P(185.5, 32.5), P(176, 40)], [P(176, 40), P(160, 72), P(150, 86), P(181, 64)])] },
  hut_fields: { pool: 6, squads: [squad([P(175.5, 111.5), P(168, 116)], [P(168, 116), P(130, 138), P(105, 128), P(130, 138)])] },
  nw_grey: { pool: 6, squads: [squad([P(20.5, 20), P(22, 30)], [P(22, 30), P(21, 47), P(14, 70), P(21, 47)])] },
};

/** Cosmetic: charge `k` goes up (the mission is already lost, §6.2); T6 fires them 0.5 s apart. Visual/audio only
 *  (the `explosion` event drives fx + sfx): no damage, so it cannot kill a sapper still standing at his plunger
 *  and fire another unit:killed (T3) after the loss (playtest r2 F1). */
const blowCharge = (k) => (w) => w.events?.emit('explosion', { x: CHARGES[k][0], z: CHARGES[k][1], radius: explosionReach('bomb'), kind: 'bomb', source: null, accident: true, cosmetic: true });
/** A sapper has already fired (§8 alarmFail) or the mission is over: no more flavour messages. */
const detonated = (w) => !!w.scriptFail; // alarmFail (DETONATE) sets it at once (setpieces.js installAlarmFail)
const spyDressed = (w) => w.commandos?.some((c) => c.role === 'spy' && c.alive !== false && c.disguised);

export default {
  id: 'm16',
  campaign: 'BEL',
  title: 'Stop Wildfire',
  subtitle: 'The Maas bridge near Liège, Belgium · 4 September 1944',
  date: '1944-09-04',
  place: 'The Maas (Meuse) bridge north of Liège, Belgium',
  theater: 'temperate',
  coneColors: 'green',
  size: [201, 150],
  seed: 1944_0904,
  // farmland fringe (art/terrain/bocage.js): field hedges, crops and orchards on the clear map edges, hedges
  // backing walls (visual only: laid out clear of every gameplay point and route)
  vegetation: { farmland: { crops: ['stubble', 'wheat', 'stubble'], orchards: 0.25 } },
  briefing: {
    historical: 'September 1944. The Allies are sweeping across Belgium, and the high command wants the Rhine crossed before winter. The Germans are falling back on the Siegfried Line and mean to leave nothing standing behind them. Next on their list is the big road bridge over the Maas at Liège. Our armour needs that bridge.',
    text: 'Listen carefully, officer; this one is delicate. Their engineers have already wired the bridge. There are four of them, each with his own charge, and they have orders to keep an eye on one another. At the first sign of trouble, any trouble anywhere, they blow it. So you cannot take them one at a time over an afternoon. You take them together, or near enough that it makes no difference. There is a lorry parked by the south road. When the last of them is down, get everybody into it and drive out. I want that bridge standing.',
    objectivesSummary: 'Kill the four engineers almost at once, before any of them reaches his plunger. Then everyone into the lorry and out by the south road.',
    hints: [
      'Four enemy engineers, four charges. Each man can fire only his own, and two of them share the plunger on the island.',
      'They watch each other. A body, a shot or a strange face near them, and they run for their plungers.',
      'If the alarm sounds anywhere on the map, all four run at once.',
      'Take them almost at the same moment, then everyone into the lorry by the south road.',
      'Our man can drive the lorry today; there is no one else to do it. A lorry parked over a plunger keeps its engineer away from it.',
      'The Marine can dive under the bridge spans. To strike he must come up: surface in the island shallows, then harpoon or knife.',
      'A German uniform is drying on a line in the village south of the station.',
      'Trains stop at the station for a few seconds and hide the platform. They do not stop for anyone on the rails.',
    ],
  },
  lighting: { sunElevDeg: 40, sunAzimuthDeg: 150, kelvin: 5800, hdri: 'clear', fog: 260, lut: 'temperate_late_summer' },
  water: { velocity: 0.2, angleDeg: 225, turbulence: 0.2, color: '#1f5f60' },
  baseTerrain: 'grass',
  terrain: TERRAIN,
  pavements: PAVEMENTS,
  furniture: FURNITURE,
  markers: [
    { id: 'plunger_w', ...DETONATORS.D_W, r: 2 },
    { id: 'plunger_i', ...DETONATORS.D_I, r: 2 },
    { id: 'plunger_e', ...DETONATORS.D_E, r: 2 },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['bridge', 'pb_w'], ['bridge', 'pb_e'], ['blk_n', 'blk_e'], ['blk_w', 'blk_e'], ['blk_e', 'town_grey'], ['nw_h1', 'nw_h2'], ['nw_h2', 'nw_grey']]),
  items: [],
  // §3.4 the Spy's uniform on the clothesline in the E village ('use' it, 1.5 s: dressed at once)
  interactables: [{ id: 'uniform_line', interactKind: 'clothesline', x: 196, z: 99 }],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // the whole map is one silent zone: anything seen or heard sounds the siren, and the siren wakes every sapper
  zones: [{ id: 'z_all', poly: Z_ALL, onSeen: 'RINT', onHeard: 'RINT', siren: true }],
  jails: [],
  // §6.1/§9: an officer climbing into a lorry is routine: a disguised Spy boarding it in view is not unmasked
  rules: { spyMayBoard: ['truck'] },
  barracks: BARRACKS,
  climbLinks: [],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Kill the four bridge engineers before any of them can fire his charge', type: 'kill', targets: SAPPERS, required: true },
    { id: 'o2', text: 'Then get everyone into the lorry and out by the south road', type: 'escape', required: true, vehicleId: 'truck' },
  ],
  // the S girder is open for 2.5 m where it meets the E-bank shallows: a Marine wading there climbs onto the
  // bridgehead ([DE]); everywhere else over the water the girders keep walkers on the deck (playtest r2)
  setpieces: [{ type: 'deck_underpass', id: 'deck_underpass', structure: 'bridge', gaps: [{ x: 80.8, z: 105.8, r: 1.4 }] }],
  triggers: [
    // per-tick glue: sappers detonate only on arrival; a lorry over a plunger strands its sapper; the drive-off
    { on: 'tick', once: false, when: () => true, do: [{ run: (w) => m16Tick(w) }] },
    // T1: the uniform is the key to the whole mission (fires once he WEARS it, not at the clothesline)
    { on: 'tick', when: (p, w) => spyDressed(w), do: [{ message: 'Uniform on. Nobody on the bridge will look at him twice.', kind: 'info' }] },
    // T2: the first time the Spy climbs into the lorry
    { on: 'vehicle:enter', match: { vehicle: 'truck', unit: 'spy' }, do: [{ message: 'The Spy can drive the lorry in this mission.', kind: 'info' }] },
    // T3: first engineer down: the clock is running
    { on: 'unit:killed', match: { unit: 'engineer' }, when: (p, w) => !detonated(w) && !SAPPERS.every((id) => w.byId?.(id)?.alive === false),
      do: [{ message: 'One engineer down. The others will notice soon.', kind: 'warn' }] },
    // T4: the lorry is the only way out
    { on: 'vehicle:destroyed', match: { vehicle: 'truck' }, when: (p, w) => !w.objectives?.find((o) => o.id === 'o2')?.done,
      do: [{ fail: 'THE LORRY IS GONE. THERE IS NO WAY OUT.' }] },
    // T5: all four dead
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'The bridge is safe. Everyone into the lorry.', kind: 'objective' }] },
    // T6: a sapper made it (alarmFail ends the mission): the charges go up one after another
    ...CHARGES.map((c, k) => ({ on: 'alarm:zone', match: { event: 'DETONATE' }, delay: 0.3 + 0.5 * k, do: [{ run: blowCharge(k) }] })),
  ],
  // the lorry is already here: the extraction adopts it; once o1 is done and everyone is aboard it drives off
  // by the S road (m16Tick path-finds the run to `exit`; ESC skips the drive)
  extraction: {
    vehicleId: 'truck', spawnAt: { x: 97, z: 137.5, heading: 0 }, spawnWhen: ['o1'],
    exit: { x: 139.5, z: 146.5, r: 5 }, leave: { x: 141, z: 163, speed: 7 },
  },
  alarmFail: { events: ['DETONATE'], message: 'THE BRIDGE HAS BEEN BLOWN.' },
  par: { time: 720 },
  cameraStart: { x: 185, z: 20, zoom: 1 },
  startDisguised: [], // the Spy starts WITHOUT the uniform (clothesline in the E village)
};
