/**
 * BEL Mission 4 — "Restore Pride" (buildable layout: docs/missions/m04.md). Owned by MISSIONS.
 * Stokkan near Trondheim, Norway, 10 March 1941. A fjord inlet splits the map diagonally: the team lands on the
 * SW bank (derelict rail yard, empty Panzer II), the German HQ villa stands on the NE bank inside a double wall.
 * A steel trestle carries the main line over the inlet; a train crosses about every 34 s. The Sapper has no
 * charge: the time bomb, 3 sniper rounds and the Driver's SMG are in an RAF air-drop crate in the NE woods. The
 * patrol boat at the villa's jetty takes the team out once the villa is down and everyone is aboard.
 * Every enemy, route, wait and heading comes from the retail mission file (dossier §0, §7).
 *
 * Conventions: dossier headings/rot in DEGREES (0 = E, 90 = S), converted with deg(); route `look` and
 * `post.sweep` stay in degrees; route `vel` in VEL units (× 0.9 m/s). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (see the commit message): the villa footprint is 12 × 10 m centred (76.5, 27.5) so
 * its steps, door and the demolition marker (80.5, 36) lie in front of it (the dossier rect swallowed them); the
 * inner timber wall is extended at both ends to meet the map edge and the fjord cliff (otherwise 2 m / 5 m gaps
 * bypass the arch); the E forest's E edge sits at x 178.5 so the crate lies outside it; the arch is a decorative
 * prop over the 4.4 m wall gap (never a door) and falls through the `arch_fall` collapse; the patrol boat
 * is moored along the landing stage (not steerable; `boardAny` lets every man board it without the Marine); the Marine carries the raft (retail `IT_BALSA`, Kildread's kit list; spec
 * §3.8 row 4 updated) for the wreck ↔ landing-stage ferry; the truck driver's errands stand him at the door of the shack / villa for 5 s
 * instead of inside (killable there, dossier §12 fallback).
 */

import { m04Script, TRUCK_STOPS } from './scripts/m04.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)
const rect = (x0, x1, z0, z1, terrain) => ({ type: 'rect', terrain, x: x0, z: z0, w: x1 - x0, d: z1 - z0 });

/** Deterministic scatter of pines over a rectangle (visual trees inside a blocking forest poly: `block: 0`). */
function scatter(x0, x1, z0, z1, n, seed, extra = {}) {
  const out = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cols = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / Math.max(1, z1 - z0))));
  const rows = Math.ceil(n / cols);
  for (let k = 0; k < n; k++) {
    const i = k % cols, j = Math.floor(k / cols);
    const x = x0 + ((i + 0.25 + rnd() * 0.5) * (x1 - x0)) / cols;
    const z = z0 + ((j + 0.25 + rnd() * 0.5) * (z1 - z0)) / rows;
    out.push({ type: 'pine', x: +x.toFixed(1), z: +z.toFixed(1), r: 0.45, h: 10 + Math.round(rnd() * 5), seed: seed + k, ...extra });
  }
  return out;
}

// ---------------------------------------------------------------- key positions
/** The HQ villa (objective) and the demolition marker on its front steps (retail target point + truck door). */
const VILLA = { x: 76.5, z: 27.5, w: 12, d: 10 };
const STEPS = { x: 80.5, z: 36.0 };
/** The inner stone arch: collapses from any explosion within 3 m. */
const ARCH = { x: 94.8, z: 48.6 };
/** The patrol boat's mooring: hull 0.5 m off the landing stage's S edge (z 77), so every man steps aboard. */
export const BOAT = { x: 37.0, z: 78.7, h: 180 };
/** Rail bridge deck ends (x + z = 242.6, the main line). */
const BR_A = [97.5, 145.1], BR_B = [121.5, 121.1];
/** Railway: one straight line x + z = 242.6, clipped to the map edges (retail rail runs off-map both ends). */
const RAIL = [[199, 43.6], [71.6, 171]];

// ---------------------------------------------------------------- terrain (dossier §3)
/** T1 the fjord and the inlet (water as drawn on the fan map). */
const WATER = [[0, 0], [65, 0], [64, 3], [62, 6], [60, 10], [60, 18], [58, 21], [56, 27], [54, 30], [53, 39], [51, 45], [49, 48],
  [47, 51], [46, 57], [45, 62], [47, 70], [50, 78], [53, 81], [54, 84], [59, 87], [62, 90], [66, 93], [70, 96], [73, 99], [76, 102],
  [80, 105], [83, 108], [86, 111], [89, 114], [94, 117], [96, 120], [99, 123], [104, 126], [106, 129], [108, 132], [111, 136],
  [116, 141], [121, 144.3], [125, 146.3], [131.7, 151.7], [138, 156], [141, 159], [143, 162], [147, 165], [150, 168], [153, 171],
  [140, 171], [131.7, 163.7], [127.7, 161], [122.3, 157.7], [117, 154.3], [113, 151], [110.3, 149], [105, 147.7], [97, 143],
  [97, 139.7], [93, 135], [89, 131.7], [85.8, 127.8], [80.3, 123.4], [74.8, 119], [68.2, 114.6], [61.6, 110.2], [55, 106.9],
  [49.5, 102.5], [44, 98.1], [36.3, 92.6], [33, 88.2], [22, 85.5], [11, 85.5], [0, 88.8]];
/** The gorge under the trestle, between the two NE cliffs (drawn as the cliff foot + water). */
const GORGE = [[104, 126], [119.6, 119.6], [123.4, 121.6], [121, 144.3], [116, 141], [111, 136], [108, 132], [106, 129]];
/** Road centreline: SE edge → level crossing → round the woods → outer gate → arch → roundabout. */
const ROAD = [[199, 111.3], [175.1, 87.8], [165, 77.5], [153, 65.5], [148.8, 61.4], [143.3, 59.1], [137.8, 59.8], [132.5, 63.8],
  [127.4, 68.4], [121.7, 70.2], [115.2, 68.3], [109.4, 63.9], [104, 58], [97.4, 51.4], [94.8, 48.6], [90.8, 44.7], [88.5, 42.8]];

const TERRAIN = [
  // T2 SW bank (rail yard, centre), T4 NE bank (HQ, forests, crossing, SE meadow): grass under snow patches
  { type: 'poly', terrain: 'grass', points: [[0, 92], [32, 91], [46, 104], [60, 113], [78, 125], [95, 137], [96, 147], [86, 158], [70, 171], [12, 171], [12, 150], [0, 146]] },
  { type: 'poly', terrain: 'grass', points: [[66, 0], [199, 0], [199, 100], [185, 112], [175, 125], [160, 135], [150, 140], [140, 135], [122, 123], [110, 110], [90, 95], [62, 76], [47, 57], [56, 33], [60, 15]] },
  // T3 / T5 snow patches (footprints show on snow)
  rect(40, 60, 110, 125, 'snow'), rect(0, 10, 146, 171, 'snow'), rect(52, 72, 138, 150, 'snow'), rect(28, 34, 150, 160, 'snow'),
  rect(58, 70, 0, 30, 'snow'), rect(86, 100, 4, 14, 'snow'), rect(118, 135, 8, 20, 'snow'), rect(160, 175, 8, 14, 'snow'),
  rect(185, 199, 18, 45, 'snow'), rect(130, 175, 42, 56, 'snow'), rect(120, 135, 40, 58, 'snow'), rect(177, 199, 55, 68, 'snow'),
  rect(100, 125, 104, 116, 'snow'), rect(125, 145, 125, 135, 'snow'), rect(160, 199, 145, 171, 'snow'), rect(95, 140, 150, 171, 'snow'),
  // T8 trampled ground: villa forecourt, pier-stair head, crossing shack yard, rail-yard dirt
  rect(70, 84, 36, 46, 'ground'), rect(50, 60, 48, 58, 'ground'), rect(168, 178, 74, 82, 'ground'), rect(12, 30, 112, 130, 'ground'),
  rect(30, 46, 145, 160, 'ground'),
  // T6 the road, T7 the roundabout ring (grass island with the statue)
  { type: 'path', terrain: 'road', points: ROAD, width: 5 },
  { type: 'circle', terrain: 'road', x: 85.2, z: 39.2, r: 6.8 },
  { type: 'circle', terrain: 'grass', x: 85.2, z: 39.2, r: 3.5 },
  // T1 water last (wins over the land polys), plus the gorge under the trestle
  { type: 'poly', terrain: 'water', points: WATER },
  { type: 'poly', terrain: 'water', points: GORGE },
  // a 1 m wading rim round the sunken tank and along the landing stage's E edge: the Marine launches / lands the
  // raft there (Kildread's wreck ↔ landing-stage ferry; the E edge, clear of the moored boat); neither rim touches any other walkable ground
  { type: 'poly', terrain: 'shallow', points: [[119.5, 149.5], [114.6, 144.6], [119.1, 140.1], [124.0, 145.0]] },
  rect(41, 42.2, 73, 77, 'shallow'),
];

// ---------------------------------------------------------------- structures (dossier §4)
/** Banks: impassable but see-through (`block: 3` = B.FENCE) so the tank and the Sniper shoot across the inlet. */
const FENCE = 3;
const cliff = (id, points, h = 7) => ({ id, type: 'cliff', variant: 'fjord_cliff_grey', points, h, block: FENCE });
const mgRing = (id, x, z, rot) => ({ id, type: 'sandbags', variant: 'mg_nest_sandbag', x, z, rot: deg(rot), ring: { r: 1.6 }, h: 1.0, block: 1 });

const HQ = [
  // the villa: objective, time bomb only, on its front steps (retail CUARTEL: bomb 1, shot/grenade −1)
  { id: 'villa', type: 'villa', variant: 'hq_villa_brick', x: VILLA.x, z: VILLA.z, rot: 0, w: VILLA.w, d: VILLA.d, h: 12,
    destructible: true, bombOnly: true, targetAt: [STEPS.x - VILLA.x, 6.5], marker: 'villa_steps', hp: 100,
    enterable: true, destroyFx: ['bigBlast', 'fire'], banners: true },
  { id: 'statue', type: 'well', variant: 'statue_monument', x: 85.2, z: 39.2, r: 1.5, h: 4, block: 2 },
  // inner timber fence (extended to the map edge and to the fjord cliff) with the 4.4 m arch gap at (94.8, 48.6)
  { id: 'wall_inner', type: 'wall', variant: 'timber_fence', mat: 'woodDark', h: 2.5, width: 0.5,
    segments: [[[71.8, 0], [74, 2], [110, 34], [96.6, 47.0]], [[93.0, 50.4], [70, 73.5], [66, 77.6]]] },
  // the stone arch over the gap: decorative until `arch_fall` brings it down (rubble blocks the gap)
  { id: 'arch', type: 'ruins', variant: 'stone_arch', x: ARCH.x, z: ARCH.z, rot: deg(135), w: 5.6, d: 0.9, h: 4.5, block: 0,
    nav: false, clip: false }, // the gap stays open at ground level: no walkable library top (it would open the fence
  // ends), no visual nav block across the passage; its pillars stand on the fence ends, already blocked
  // outer masonry wall with an iron railing; its gate between the two gatehouses
  { id: 'wall_outer', type: 'wall', variant: 'masonry_railing', mat: 'plaster', h: 4.0, width: 0.6,
    segments: [[[100, 7.5], [127, 32], [107.3, 52.3]], [[97.5, 60], [76, 83]]] },
  { id: 'gh_a', type: 'hut', variant: 'gatehouse_double_wall', x: 105.8, z: 53.8, rot: deg(45), w: 3, d: 3, h: 5 },
  { id: 'gh_b', type: 'hut', variant: 'gatehouse_double_wall', x: 99.0, z: 58.5, rot: deg(45), w: 3, d: 3, h: 5 },
  // boom barrier (auto for enemy vehicles: left up; never a barrier to men on foot; an explosion breaks it)
  { id: 'gate_outer', type: 'gate', variant: 'barrier_boom', x: 103.9, z: 58.3, rot: deg(315), w: 5.5, open: true, rammable: true },
  // the two garrisons between the walls (indestructible) and the jail hut outside (garrison + jail, bomb-destructible)
  { id: 'garr1', type: 'barracks', variant: 'log_garrison', x: 98.2, z: 7.4, rot: deg(42), w: 6, d: 5, h: 4.5, flag: true, garrison: true, door: 0 },
  { id: 'garr2', type: 'barracks', variant: 'log_garrison', x: 92.8, z: 2.6, rot: deg(42), w: 6, d: 5, h: 4.5, garrison: true, door: deg(117) },
  { id: 'house_a', type: 'house', variant: 'timber_house', x: 97.0, z: 28.0, rot: deg(42), w: 8, d: 6, h: 5, snowRoof: true, enterable: true },
  { id: 'house_b', type: 'hut', variant: 'timber_shed', x: 90.0, z: 24.5, rot: deg(42), w: 4.5, d: 5, h: 4, enterable: true },
  { id: 'tent1', type: 'tent', variant: 'tent_large_barrack', x: 108.5, z: 17, rot: deg(42), w: 5, d: 4, h: 3, destructible: true, hp: 60 },
  { id: 'tent2', type: 'tent', variant: 'tent_large_barrack', x: 113.5, z: 22.5, rot: deg(42), w: 5, d: 4, h: 3, destructible: true, hp: 60 },
  { id: 'henhouse', type: 'hut', variant: 'henhouse', x: 62, z: 12, rot: 0, w: 3, d: 2, h: 2, destructible: true, hp: 30 },
  // the jetty: shed at the stair head, timber stair down the cliff, pier deck, low landing stage, MG nest
  { id: 'shed_pier', type: 'hut', variant: 'timber_shed', x: 56.0, z: 51.5, rot: 0, w: 3.5, d: 3.5, h: 3.5, enterable: true, destructible: true, hp: 60 },
  { id: 'stair_pier1', type: 'pier', variant: 'timber_stair', x: 44.75, z: 60.15, rot: deg(135.8), w: 11.5, d: 2.4 },
  { id: 'stair_pier2', type: 'pier', variant: 'timber_stair', x: 38.25, z: 64.9, rot: deg(158.2), w: 6.5, d: 2.4 },
  { id: 'pier_main', type: 'pier', variant: 'pier_timber', x: 36.5, z: 67.5, rot: 0, w: 11, d: 7 },
  { id: 'pier_float', type: 'pier', variant: 'landing_stage', x: 37.0, z: 75.0, rot: 0, w: 8, d: 4 },
  mgRing('mg_pier', 59.4, 63.0, 335),
  // the fjord face below the yard (the stair gap at z 56–62)
  cliff('cliff_hq', [[66.3, 0], [63, 6.6], [59.7, 19.8], [56.4, 33], [54.2, 41.8], [52, 49.5], [49, 55.5], [46.5, 56], [47, 51], [49, 48],
    [51, 45], [53, 39], [54, 30], [56, 27], [58, 21], [60, 18], [60, 10], [62, 6], [64, 3], [65, 0]]),
  // single pines in and around the compound (the stair-head one sits off r0's loop point (70.4, 58.9))
  ...[[61, 22], [63, 34], [60.5, 44], [72, 46.5], [70.5, 53], [68.3, 61.8], [66, 66], [97, 71], [107, 4], [119, 14], [120, 40], [125, 46],
    [122, 52], [117, 57], [112, 61]].map(([x, z], k) => ({ type: 'pine', x, z, r: 0.45, h: 9 + (k % 5), seed: 401 + k })),
];

const INLET = [
  // the HQ plateau's S face (stair gap → bridge) and the cliff E of the bridge down to the S edge
  cliff('cliff_ne_w', [[45.5, 62.5], [50, 65], [56, 71], [61.6, 75], [70.4, 79.4], [83.6, 88.2], [94.6, 93.7], [105, 103], [110.3, 110],
    [115.7, 114.3], [119.6, 119.6], [106, 129], [104, 126], [99, 123], [96, 120], [94, 117], [89, 114], [86, 111], [83, 108], [80, 105],
    [76, 102], [73, 99], [70, 96], [66, 93], [62, 90], [59, 87], [54, 84], [53, 81], [50, 78], [47, 70], [45, 62]], 8),
  cliff('cliff_ne_e', [[123.4, 121.6], [126.3, 123.7], [131.7, 127], [135.7, 131.7], [141.6, 135.5], [152.7, 144.3], [161.6, 153.2],
    [170.5, 162.1], [174.9, 171], [153, 171], [150, 168], [147, 165], [143, 162], [141, 159], [138, 156], [131.7, 151.7], [125, 146.3],
    [121, 144.3], [116, 141], [111.5, 135.5]], 8),
  // low rock rim along the SW bank's water edge (gap for the bridge abutment at x 97–99.5)
  { id: 'rim_sw', type: 'fence', variant: 'rock_rim', mat: 'rock', h: 1.5, width: 1.2,
    segments: [[[97, 139.7], [93, 135], [89, 131.7], [85.8, 127.8], [80.3, 123.4], [74.8, 119], [68.2, 114.6], [61.6, 110.2], [55, 106.9],
      [49.5, 102.5], [44, 98.1], [36.3, 92.6], [33, 88.2], [22, 85.5], [11, 85.5], [0, 88.8]],
    [[140, 171], [131.7, 163.7], [127.7, 161], [122.3, 157.7], [117, 154.3], [113, 151], [110.3, 149], [105, 147.7], [99.5, 146.6]]] },
  // the main line and the steel lattice trestle over the inlet (3 stone pillars; foot traffic only)
  { id: 'rail_main', type: 'rail_track', segments: [[RAIL[0], [123.3, 119.3]], [[95.8, 146.8], RAIL[1]]] },
  { id: 'bridge_rail', type: 'rail_bridge', variant: 'rail_trestle_steel', x: (BR_A[0] + BR_B[0]) / 2, z: (BR_A[1] + BR_B[1]) / 2,
    rot: deg(315), w: Math.hypot(BR_B[0] - BR_A[0], BR_B[1] - BR_A[1]) + 1, d: 4, h: 7, pillars: [[106, 136.6], [111.3, 131.3], [116.5, 126.1]] },
  // the sunken tank at the foot of the E pillar: a walkable platform reached only by the pillar ladder (or swimming)
  { id: 'wreck_tank', type: 'pier', variant: 'sunken_tank', x: 119.3, z: 144.8, rot: deg(45), w: 4.5, d: 4 },
  // the level crossing: two booms across the road 5.5 m either side of the rails (retail hinges (169.4, 78.6) and
  // (165.1, 73.8)); open, closed while the train is near (script). And the crossing keeper's shack.
  { id: 'boom_x1', type: 'gate', variant: 'barrier_boom', x: 168.9, z: 81.4, rot: deg(315), w: 6, open: true },
  { id: 'boom_x2', type: 'gate', variant: 'barrier_boom', x: 161.1, z: 73.6, rot: deg(315), w: 6, open: true },
  { id: 'crossing_box', type: 'generator', variant: 'crossing_control_box', x: 178.2, z: 64.6, rot: deg(45), w: 0.8, d: 0.6, h: 1.4, block: 1 },
  { id: 'shack_x', type: 'hut', variant: 'crossing_shack', x: 171.5, z: 74.0, rot: deg(45), w: 4, d: 4, h: 3.5, enterable: true },
  // dead sidings into the derelict rail yard
  { id: 'siding_a', type: 'rail_track', variant: 'rusty', points: [BR_A, [91.3, 151], [79, 157], [66, 157.5], [51.7, 149.8], [44, 142], [17.6, 120], [10, 114]] },
  { id: 'siding_b', type: 'rail_track', variant: 'rusty', points: [[0, 125], [29.7, 154]] },
  { id: 'buffer_a', type: 'crates', variant: 'buffer_stop', x: 10, z: 114, rot: deg(40), w: 1, d: 2.6, h: 1.2, block: 1 },
  { id: 'buffer_b', type: 'crates', variant: 'buffer_stop', x: 29.3, z: 153.6, rot: deg(45), w: 1, d: 2.6, h: 1.2, block: 1 },
];

const SW_BANK = [
  // derelict rail yard: burnt boxcar, overturned coach, loco + tender off the rails (Kildread's hides)
  { id: 'wagon_box', type: 'train_car', variant: 'rail_yard_derelict_boxcar', x: 23.0, z: 119.5, rot: deg(40), w: 12, d: 3.2, h: 3.5 },
  { id: 'wagon_coach', type: 'train_car', variant: 'rail_yard_derelict_coach', x: 35.5, z: 119.5, rot: deg(70), w: 14, d: 3, h: 3 },
  { id: 'wagon_loco', type: 'train_car', variant: 'rail_yard_derelict_loco', x: 38.0, z: 136.0, rot: deg(40), w: 12, d: 3, h: 3.5 },
  { id: 'ruin_house', type: 'ruins', variant: 'brick_shell_2storey', x: 23.0, z: 138.0, rot: deg(40), w: 10, d: 8, h: 6 },
  { id: 'ruin_w1', type: 'ruins', variant: 'wall_ruined_stone', x: 19.5, z: 157, rot: deg(40), w: 5, d: 1, h: 2.2 },
  { id: 'ruin_w2', type: 'ruins', variant: 'wall_ruined_stone', x: 22.5, z: 163.5, rot: deg(130), w: 4, d: 1, h: 2.8 },
  { id: 'ruin_w3', type: 'ruins', variant: 'wall_ruined_stone', x: 15.5, z: 166.5, rot: deg(40), w: 5, d: 1, h: 1.8 },
  { id: 'debris_logs', type: 'crates', variant: 'timber_debris', x: 40.0, z: 162.0, rot: deg(20), w: 7, d: 3, h: 1.5, block: 1 },
  { id: 'debris_cart', type: 'crates', variant: 'timber_debris', x: 90.0, z: 161.0, rot: deg(60), w: 4, d: 3, h: 1.5, block: 1 },
  { id: 'rocks_yard1', type: 'rocks', variant: 'granite_spire', x: 10.5, z: 124, rot: 0, w: 6, d: 5, h: 4 },
  { id: 'rocks_yard2', type: 'rocks', variant: 'granite_spire', x: 20, z: 108.5, rot: 0, w: 5, d: 4, h: 3.5 },
  { id: 'rocks_rim', type: 'rocks', variant: 'outcrop', x: 83.5, z: 138.5, rot: 0, w: 5, d: 9, h: 3.5 },
  { id: 'rock_s', type: 'rocks', x: 96.7, z: 156.6, r: 1.5, h: 1.2, block: 1 },
  mgRing('mg_br', 97.7, 153.8, 290),
  // knife-rests with barbed wire: split the yard (W) from the bridge approach (E); the one way through is the
  // N opening beside `rocks_rim` (x 78–84, z 125–133). Impassable for vehicles too.
  { id: 'wire', type: 'fence', variant: 'wire_on_stakes', h: 1.4, width: 0.6,
    points: [[79, 141], [74.7, 146.8], [72.7, 152.7], [71.4, 157.3], [70.1, 161.9], [68.1, 165.8], [65.5, 171]] },
  // groves: the start grove hides the team; the centre grove by the wire
  ...scatter(0.5, 10, 149, 163, 12, 4101),
  ...scatter(47, 65, 128, 144, 14, 4201),
  ...[[15.4, 96], [21, 97], [26, 104], [58.5, 118], [90, 141], [56, 101]].map(([x, z], k) => ({ type: 'pine', x, z, r: 0.45, h: 10 + (k % 4), seed: 4301 + k })),
];

/** Dense pine masses: one blocking polygon each (sight and movement) + visual trees without footprints. */
const forest = (id, points, box, n, seed) => [
  { id, type: 'pine', variant: 'forest', points, h: 14, block: 2 },
  ...scatter(box[0], box[1], box[2], box[3], n, seed, { block: 0 }),
];

const NE_BANK = [
  // jail hut outside the outer wall (garrison of 5 + the jail for every patrol; a bomb razes it)
  { id: 'jail_hut', type: 'barracks', variant: 'jail_cell', x: 95.3, z: 65.2, rot: deg(45), w: 5, d: 4, h: 3.5, flag: true, garrison: true,
    jail: true, door: 0, destructible: true, hp: 100, enterable: true },
  // the RAF air-drop: crate + white parachute canopy spread N (no block)
  { id: 'crate_drop', type: 'crates', variant: 'airdrop_crate', x: 180.8, z: 33.4, rot: 0, w: 1.2, d: 1.2, h: 1.0, block: 0 },
  { id: 'canopy', type: 'sign', variant: 'parachute_canopy', x: 180, z: 28.5, rot: deg(90), w: 9, d: 5, h: 0.2, block: 0 },
  ...forest('forest_w', [[135, 16], [155, 16], [155, 45], [145, 46], [135, 40]], [136, 154, 17, 44], 24, 4401),
  ...forest('forest_e', [[160, 16], [178.5, 16], [178.5, 53], [170, 53], [160, 47.5]], [161, 177.5, 17, 52], 26, 4501),
  ...forest('treeline_n', [[115, 0], [199, 0], [199, 19], [187, 19], [187, 5], [115, 5]], [116, 198, 0.5, 4.5], 16, 4601),
  ...scatter(115, 130, 39, 55, 8, 4701), // grove_gate: the GB's cover for the decoy on e46
  ...scatter(133, 150, 67, 84, 10, 4801), // grove_x: S of the road, mg_x at its S edge
  ...scatter(115, 129, 91, 109, 10, 4901), // grove_moto: N of the bridge head
  ...scatter(164, 175, 110, 127, 8, 5001), // grove_se: patrol p5 circles it
  ...scatter(182, 199, 69, 89, 10, 5101), // grove_ne: E of the crossing
  mgRing('mg_x', 142.3, 84.2, 75),
  { id: 'rocks_x1', type: 'rocks', x: 163, z: 94.5, rot: 0, w: 7, d: 7, h: 3.5 }, // 2 m NE of the fan map: e36 passes clear of the train
  { id: 'rocks_x2', type: 'rocks', x: 151, z: 116, rot: 0, w: 10, d: 10, h: 4 },
  { id: 'rocks_x3', type: 'rocks', x: 186, z: 90, rot: 0, w: 4, d: 6, h: 2.5 },
  ...[['ruin_se1', 158.8, 126.5, 30, 8, 6, 2.5], ['ruin_se2', 165.8, 141, 20, 5.5, 4, 2], ['ruin_se3', 182.5, 139, 150, 6, 5, 2.5],
    ['ruin_se4', 190.5, 120.5, 20, 9, 5, 2.5], ['ruin_se5', 196, 130, 60, 5, 4, 2]]
    .map(([id, x, z, r, w, d, h]) => ({ id, type: 'ruins', variant: 'wall_ruined_stone', x, z, rot: deg(r), w, d, h })),
];

const STRUCTURES = [...HQ, ...INLET, ...SW_BANK, ...NE_BANK];

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const TRUCK_ROUTE = [
  P(198, 110.3, 15), P(175.1, 87.8), P(TRUCK_STOPS.A.x, TRUCK_STOPS.A.z, 1),
  P(165, 77.5), P(153, 65.5), P(148.8, 61.4), P(143.3, 59.1), P(137.8, 59.8), P(132.5, 63.8), P(127.4, 68.4), P(121.7, 70.2), P(115.2, 68.3),
  P(109.4, 63.9), P(104, 58), P(97.4, 51.4), P(90.8, 44.7), P(90.1, 43), P(90, 39.9), P(90.6, 36.7), P(90.5, 34.4), P(88.7, 32),
  P(TRUCK_STOPS.B.x, TRUCK_STOPS.B.z, 1),
  P(90.6, 36.5), P(90.2, 43.2), P(94.9, 48.7), P(102.9, 56.7), P(106.4, 61), P(115, 68.2), P(121.7, 70.3), P(127.2, 68.1), P(137.3, 59.8),
  P(143.3, 59), P(149.1, 61.6), P(165, 77.5), P(TRUCK_STOPS.C.x, TRUCK_STOPS.C.z, 1), P(186, 98.5),
];

const VEHICLES = [
  // escape: the patrol boat moored along the landing stage's S edge, bow W (retail VEHICULOHUIDA LANCHA). Not
  // steerable; anyone boards it from the landing stage (`boardAny`); it sails W by itself once o1 is done and
  // everyone is aboard.
  { id: 'pboat', vehicleType: 'patrolboat', x: BOAT.x, z: BOAT.z, heading: deg(BOAT.h), driveable: false, boardAny: true, seats: 6, hits: 60, escape: true },
  // the empty Panzer II among the old wagons (Ctrl+click: hull MG, 45 m; Prima / dossier §6.1, Kildread "armed like
  // the SdKfz" — no cannon: a map-wide shell with no range cap cleared the HQ yard from across the fjord).
  // Kept on the SW bank (script driveRules).
  { id: 'pz2', vehicleType: 'panzer2', x: 39.4, z: 103.6, heading: deg(150), driveable: true, operators: ['driver'], seats: 5, weapons: ['tankMg'] },
  // the courier's motorcycle at the E bridge head (0.9 m further from the rails than the retail (123.5, 113.5), clear of
  // the train's stop box); parked on the level crossing it stops the train
  { id: 'moto', vehicleType: 'motorcycle', x: 122.6, z: 113.0, heading: deg(315), driveable: true, operators: ['driver'] },
  // the supply lorry: crossing shack ↔ villa, driven by e49 (unarmed, never alarms). Kill him on an errand: it is yours.
  { id: 'truck', vehicleType: 'truck', variant: 'opel_canvas', x: 198, z: 110.3, heading: deg(224), driveable: true, seats: 6, hits: 30,
    crew: [{ id: 'e49', soldierType: 'truckDriver' }], route: { type: 'LOOP', speed: 9, points: TRUCK_ROUTE } },
  // the train: straight main line NE → SW, ~34 s cycle (20 s on the map at 9 m/s), kills anyone on the rails;
  // it stops while a vehicle stands on the track ahead (the motorcycle on the crossing)
  { id: 'train', vehicleType: 'train', x: RAIL[0][0], z: RAIL[0][1], heading: deg(135), track: RAIL,
    schedule: { mode: 'once', speed: 9, period: 14, delay: 8 }, driveable: false, horn: true },
  // the three MG nests (the Driver can take a gun once its gunner is dead)
  { id: 'mg_br_gun', vehicleType: 'mgNest', x: 97.7, z: 153.8, heading: deg(290), gunner: 'e20', driveable: true },
  { id: 'mg_x_gun', vehicleType: 'mgNest', x: 142.3, z: 84.2, heading: deg(75), gunner: 'e37', driveable: true },
  { id: 'mg_pier_gun', vehicleType: 'mgNest', x: 59.4, z: 63.0, heading: deg(335), gunner: 'e55', driveable: true },
];

// ---------------------------------------------------------------- commandos (§3.8 row 4 + retail .INTERFACE)
const COMMANDOS = [
  { role: 'greenberet', x: 1.2, z: 164.8, heading: deg(60), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
  { role: 'sniper', x: 1.9, z: 166.8, heading: deg(120), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 4 } },
  { role: 'diver', x: 3.4, z: 163.4, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 1 } },
  { role: 'sapper', x: 5.0, z: 164.6, heading: deg(210), stance: 'crawl', inventory: { pistol: 1, bearTrap: 1, grenade: 3 } },
  { role: 'driver', x: 3.6, z: 166.2, heading: deg(0), stance: 'crawl', inventory: { pistol: 1, firstAid: 6 } },
];

/** The RAF air-drop crate: each man takes what he can carry (Sapper: time bomb, Sniper: 3 rounds, Driver: SMG). */
const INTERACTABLES = [
  { kind: 'crate', id: 'drop', x: 180.8, z: 33.4, contents: { timeBomb: 1, sniperRifle: 3, smg: 20 } },
];

// ---------------------------------------------------------------- enemies (dossier §7; retail file, Prima numbers)
const JAIL = 'jail_hut';
/** Post guard. `holds` = BANPE1 (holdsPost), else BANPE2 (investigates). Sweep in degrees (null = profile default). */
const post = (id, prima, x, z, h, holds, sweep = null, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h), jail: JAIL,
  flags: { holdsPost: holds, investigates: !holds, followsTracks: true }, post: { heading: deg(h), sweep }, ...extra,
});
/** Lone walker (BAP2 investigates; BAP1 keeps its route). `vel` in VEL units (1.7 = 1.5 m/s). */
const walker = (id, prima, x, z, type, vel, points, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x, z, heading: Math.atan2(points[0].z - z, points[0].x - x) || 0, jail: JAIL,
  flags: { investigates: true, followsTracks: true }, route: { type, vel, points }, ...extra,
});
/** Patrol: members in column behind the leader (`leaderType` sergeant = NCO with a pistol, else a trooper leads). */
const patrol = (ids, prima, sq, x, z, h, leaderType, route, extra = {}) => ids.map((id, k) => ({
  id, prima, soldierType: k === 0 ? leaderType : 'trooper', x: +(x - Math.cos(deg(h)) * 1.2 * k).toFixed(2), z: +(z - Math.sin(deg(h)) * 1.2 * k).toFixed(2),
  heading: deg(h), jail: JAIL, squad: { id: sq, leader: ids[0], columns: 1 }, flags: { investigates: true, followsTracks: true }, route, ...extra,
}));
const mg = (id, prima, x, z, h, sweep, giro, gun) => ({ id, prima, soldierType: 'mg', x, z, heading: deg(h), emplacement: gun, post: { heading: deg(h), sweep, giro } });

const SW_ENEMIES = [
  // the ruined house and the start (Prima 1–6): knife them one by one, bodies W of the house
  post('e1', 1, 29.3, 155.5, 70, false),
  post('e2', 2, 27.0, 144.4, 70, false, 50),
  walker('e3', 3, 35.9, 146.4, 'LOOP', 1.0, [P(32.4, 150.3), P(30.9, 158.9), P(32.4, 167.2), P(40.9, 169.3), P(49, 161.4, 2.3), P(45.3, 154.1),
    P(43.6, 150.8), P(38.7, 147.4), P(32.3, 144.1)]),
  post('e4', 4, 19.2, 131.4, 135, false),
  post('e5', 5, 6.9, 126.7, 120, false),
  post('e6', 6, 23.4, 109.4, 315, false),
  // patrol 7 (sergeant + 2): a figure of eight round the yard and the fjord shore, never stops
  ...patrol(['e7', 'e8', 'e9'], 7, 'p8', 3.4, 118.6, 270, 'sergeant', { type: 'LOOP', vel: 1.0, points: [P(3.4, 118.6), P(4.3, 105.5), P(8.2, 102.4),
    P(13.8, 105.1), P(19.6, 104), P(27, 97.6), P(30, 98.3), P(31.9, 106.1, 2.25), P(34.1, 107.2), P(36, 105.4), P(35.8, 101.9), P(24.8, 91.5), P(5, 99.3),
    P(2.7, 103), P(7.9, 117.2), P(7.1, 119.6), P(5, 120.2)] }),
  post('e10', 8, 42.8, 119.1, 330, false),
  walker('e11', 9, 39.5, 127.9, 'LOOP', 1.7, [P(38.3, 130.8), P(30.4, 127.3), P(25.2, 128.6, 3.5, 215), P(24.8, 127.8), P(40.5, 127.8)]),
  post('e12', 10, 64.6, 139.0, 50, false),
  // the three round the Panzer II: e14 answers a pistol shot, e13/e15/e16 hold their posts
  post('e13', 11, 33.4, 92.4, 290, true),
  post('e14', 12, 37.1, 101.5, 165, false),
  post('e15', 13, 43.2, 105.8, 90, true),
  post('e16', 14, 56.8, 110.5, 320, true),
  walker('e17', 15, 80.4, 146.9, 'LOOP', 1.7, [P(80.2, 150.4), P(81, 143.3), P(80, 138.6), P(80.9, 135, 1.5, 240), P(80, 138.6), P(81, 143.3), P(80.1, 150.4, 1.5)],
    { post: { sweep: 40 } }),
  // the bridge approach: MG nest, its guards and the 5-man patrol (Prima 16–19)
  post('e18', 16, 86.8, 164.5, 180, true),
  post('e19', 17, 93.4, 157.6, 240, false),
  mg('e20', 18, 97.7, 153.8, 290, 45, 180, 'mg_br_gun'),
  ...patrol(['e21', 'e22', 'e23', 'e24', 'e25'], 19, 'p9', 101.7, 154.6, 270, 'sergeant', { type: 'LOOP', vel: 1.0, points: [P(101.7, 154.6), P(105.7, 153.1),
    P(116.1, 162.9), P(117.5, 165.3), P(117.5, 167.7), P(116.3, 169.1), P(103.1, 168.1), P(99.9, 164.3, 1.5), P(99.8, 159.1)] }),
];

/** The courier's ride: to the bike, round the bridge-head grove, along the road to the jail hut; he fires REXT at its door. */
export const COURIER_RUN = [[122.2, 114.8], [133.1, 104.1], [125.5, 83.6], [105.5, 70.7], [97.8, 72.4], [96.6, 72.5], [96.7, 74.2], [98.5, 73.5], [97.2, 69.2]];

const NE_ENEMIES = [
  // the motorcycle courier at the E bridge head (Prima 20): never fires; on anything suspicious he rides for the
  // jail hut and brings out its patrol (REXT, silent). Killed on the way: nothing happens.
  { id: 'e26', prima: 20, soldierType: 'courier', x: 119.4, z: 116.8, heading: deg(135), jail: JAIL,
    flags: { holdsPost: true, investigates: false, followsTracks: true }, post: { heading: deg(135), sweep: null },
    exitRoute: COURIER_RUN, alarmEvent: 'REXT', bike: 'moto' },
  // patrol 21 (3 men) along the inlet's N rim
  ...patrol(['e27', 'e28', 'e29'], 21, 'p2', 95.4, 89.9, 0, 'trooper', { type: 'LOOP', vel: 1.8, points: [P(96.4, 89), P(99.3, 91.5), P(124.4, 83.7),
    P(126.9, 83.9), P(128.1, 86.1), P(127.3, 88.8), P(124.7, 89.6), P(101.1, 83.7), P(96.3, 86)] }),
  walker('e30', 22, 121.2, 90.9, 'LOOP', 1.7, [P(112.2, 86.6), P(121.9, 90.1), P(127, 91), P(112.2, 86.4)]),
  post('e31', 23, 157.1, 121.2, 310, false),
  post('e32', 24, 159.0, 97.4, 120, true),
  // patrol 25 (3 men) round the SE grove
  ...patrol(['e33', 'e34', 'e35'], 25, 'p5', 176.0, 144.0, 225, 'trooper', { type: 'LOOP', vel: 1.4, points: [P(168.2, 134.2), P(175.5, 133.1),
    P(180.3, 129.6), P(182.1, 121.4), P(181.5, 113.8), P(176.5, 107.7), P(169.7, 106.4), P(163, 113), P(163.2, 121.1)] }),
  walker('e36', 26, 153.4, 97.6, 'LOOP', 1.7, [P(167.8, 103.5), P(172.4, 101.7), P(175, 96.7, 1), P(164.7, 87.6, 1.5), P(159.6, 90.7), P(153.4, 96.8, 1)]),
  mg('e37', 27, 142.3, 84.2, 75, 40, 90, 'mg_x_gun'),
  walker('e38', 28, 169.3, 142.4, 'LOOP', 1.7, [P(171, 140.8, 1.5), P(170.5, 141.8), P(181.8, 144.8, 1), P(175.6, 146.7), P(170.5, 141.7)]),
  post('e39', 29, 189.7, 138.5, 240, false),
  post('e40', 30, 188.9, 114.2, 330, false),
  post('e41', 31, 175.5, 75.1, 310, false), // at the crossing shack
  walker('e42', 32, 190.0, 62.1, 'PINGPONG', 1.7, [P(187.1, 64.9, 1.5), P(192.8, 62.5), P(195.7, 56, 1.5)]),
  // patrol 33 (3 men) round both forests, past the air-drop crate
  ...patrol(['e43', 'e44', 'e45'], 33, 'p1', 186.3, 33.1, 263, 'trooper', { type: 'LOOP', vel: 1.65, points: [P(186.3, 33.1), P(184, 15.3), P(181.2, 11.3),
    P(154.2, 8.6), P(137.7, 14.6), P(130.9, 22.7), P(128.2, 36.7), P(130.5, 46), P(138.2, 51.8), P(162.5, 56.1), P(168.3, 58.6), P(179.6, 55.2),
    P(184.9, 51.3)] }),
  // the outer gate (Prima 34–36): snipe the rear guard e47 first, while the barrier guard e48 looks away
  walker('e46', 34, 123.3, 63.3, 'PINGPONG', 1.7, [P(119.7, 64.7, 0.5), P(123, 63.5), P(134.2, 54.4), P(136.4, 53.6, 0.5)]),
  post('e47', 35, 104.8, 55.8, 45, true),
  post('e48', 36, 109.2, 57.4, 45, false),
  // the lorry driver (Prima 37): unarmed, never raises an alarm, ignores bodies; rides in `truck` (script errands)
  { id: 'e49', prima: 37, soldierType: 'truckDriver', x: 196.5, z: 107.5, heading: deg(224), weapon: null,
    flags: { holdsPost: true, investigates: false, followsTracks: false, ignoresBodies: true }, post: { heading: deg(224) }, driverOf: 'truck' },
];

/** p7's RINT run: through the arch, down the stair to the pier and back up; then the `BUCL` loop at the stair head. */
export const P7_RINT = {
  to: [[97.2, 51.1], [92.7, 45.9], [59.9, 56], [55.5, 60.1], [48.4, 60.4], [41.3, 61.4], [37.4, 63.6], [34.3, 66.3], [37.4, 63.7], [41.2, 61.3],
    [48.4, 60.6], [55.5, 60.3], [60.1, 56.1], [69.9, 55.3], [71.1, 57.3]],
  loop: [[72.3, 60.3], [69.9, 65.4], [65.4, 67], [62.9, 64.3], [63.1, 61.1], [60.8, 56], [61.7, 52.6], [65.8, 51.6]],
};

const HQ_ENEMIES = [
  // patrol 38–40 (sergeant + 2, one column) in the corridor between the walls; does not follow tracks
  ...patrol(['e50', 'e51', 'e52'], 38, 'p7', 82.4, 70.2, 315, 'sergeant', { type: 'LOOP', vel: 1.8, points: [P(104.7, 43.1), P(104.9, 41.2), P(114.1, 31.9),
    P(115.6, 31.9), P(116.9, 33.2), P(116.7, 34.9), P(107.1, 44.6), P(106, 44.5)] }, { flags: { investigates: true, followsTracks: false } }),
  // the stair-head walker (BAP1: keeps his route); on RINT he stops at (67.3, 48.1) facing NNW
  walker('e53', 41, 63.1, 55.4, 'LOOP', 1.7, [P(62.1, 51.6), P(58.1, 58), P(55.3, 60), P(49.5, 60.3, 1), P(55.1, 60.1), P(58.2, 58)],
    { flags: { investigates: false, holdsPost: false, followsTracks: true } }),
  post('e54', 42, 69.0, 69.6, 215, false),
  mg('e55', 43, 59.4, 63.0, 335, 35, 180, 'mg_pier_gun'),
  post('e56', 44, 37.5, 67.6, 340, true), // on the pier, by the boat
  walker('e57', null, 73.3, 40.1, 'PINGPONG', 1.5, [P(70.6, 37.3, 1), P(73, 42.6), P(77.3, 38.1, 1)]),
  post('e58', null, 83.5, 41.4, 145, true), // by the statue
  post('e59', null, 62.6, 31.5, 90, true), // W lawn
];

const ENEMIES = [...SW_ENEMIES, ...NE_ENEMIES, ...HQ_ENEMIES];

// ---------------------------------------------------------------- zones, barracks (dossier §8)
/** Retail sound zones PELIGRO → RINT (siren), DELANTERA → REXT, EXTERIOR → RPER; shapes designed (dossier §8.2).
 *  `reach`: z_hq / z_front ignore what their men see or hear more than that far outside them, so the SW bank and
 *  the bridge head stay silent as designed. The pier below the cliff is outside z_hq: its guard e56 (who hears shouts and
 *  sees the tank on the SW shore across the water) fights on his own; a fight up on the plateau still sounds the siren. */
const ZONES = [
  { id: 'z_hq', onSeen: 'RINT', onHeard: 'RINT', reach: 6,
    // the plateau only (to the cliff top and the stair head): the pier and the landing stage below lie outside it
    poly: [[62, 0], [100, 0], [100, 7.5], [127, 32], [107.3, 52.3], [97.5, 60], [76, 83], [66, 79], [61.6, 75], [56, 71], [50, 65], [45.5, 62.5],
      [46.5, 56], [50, 46], [55, 30], [59, 15]] },
  { id: 'z_front', onSeen: 'REXT', onHeard: 'REXT', reach: 8,
    poly: [[107.3, 52.3], [127, 32], [137, 40], [141, 56], [131, 72], [114, 75], [100, 75], [91, 71], [97.5, 60]] },
  { id: 'z_outer_ne', onSeen: 'RPER', onHeard: 'RPER', poly: [[100, 0], [114, 0], [139, 25], [137, 40], [127, 32], [100, 7.5]] },
  { id: 'z_outer_sw', onSeen: 'RPER', onHeard: 'RPER', poly: [[76, 83], [97.5, 60], [91, 71], [100, 75], [86, 91], [72, 88]] },
];

const pts = (list, speed) => list.map(([x, z]) => ({ ...P(x, z), ...(speed ? { speed } : {}) }));
const BARRACKS = {
  // GUARNICION: REAC_PAT_JEFATURA — corridor → arch → the inner yard (RUNO loop). Blocked arch: stuck in the corridor.
  garr1: { pool: 10, squads: [{ id: 'r0', event: 'RINT', size: 5, leader: 'sergeant', regen: true, exitVel: 2.7, loopVel: 1.8,
    exitRoute: pts([[101.3, 11.3], [104.9, 21], [112.5, 31.1], [113.4, 36.7], [100.3, 49.8], [96.7, 50.4], [92.1, 46], [90.9, 44.9]]),
    loop: pts([[82.8, 49.4], [78.8, 55.1], [70.4, 58.9], [65.6, 57.9], [65.4, 51.3], [84, 35.3], [87.3, 35.6], [90.3, 41.4]]) }] },
  garr2: { pool: 10, squads: [
    // REAC_PAT_ENTRE_MUROS: the SW corridor (RDOS loop)
    { id: 'r3', event: 'RINT', size: 5, leader: 'sergeant', regen: true, exitVel: 1.8, loopVel: 1.8,
      exitRoute: pts([[88.8, 1.6], [87.6, 2.6], [88.1, 6.1], [110.1, 26.6], [114.9, 31]], 1.8),
      loop: pts([[115.6, 36], [100.3, 49.3], [96.2, 54.1], [81.5, 72], [79.1, 72.8], [77.6, 71.1], [78.3, 68.4], [95.3, 53.4], [99.3, 48.5], [112.8, 32.8],
        [114.4, 32.9], [115.6, 33.9]]) },
    // PAT_REAC_PERIMETRO: walks the corridor (RPRR loop), released silently
    { id: 'r6', event: 'RPER', size: 3, regen: false, exitVel: 1.8, loopVel: 1.8,
      exitRoute: pts([[88.6, 2], [87.8, 4.5], [89.9, 8], [112.9, 29.6], [116.9, 30.1], [118.1, 32.5], [116.3, 33.7]], 1.8),
      loop: pts([[113.5, 37.1], [84.6, 61.7], [84.2, 64.2], [85.3, 65.8], [87.4, 65.8], [111.3, 34.5], [112.9, 34.4], [113.8, 35.4]]) },
  ] },
  // CASA_CARCEL: PAT_REAC_SIDECAR — the courier's patrol, out to the bridge head (silent)
  jail_hut: { pool: 5, squads: [{ id: 'r4', event: 'REXT', size: 3, regen: false, exitVel: 1.5, loopVel: 1.8, sweep: 60,
    exitRoute: pts([[97.2, 69.2]], 1.5),
    loop: pts([[134.1, 90.4], [134.2, 96.8], [131.9, 102.7], [127.7, 108.2], [122.8, 110.8], [117.6, 111.2], [113.8, 109], [109.9, 100], [107.7, 85],
      [110.6, 78.1], [117.9, 75.7], [126.6, 77.3]]) }] },
};

// ---------------------------------------------------------------- ladders (retail ESCA_FC / ESCA_LADO)
const LADDERS = [
  // the E pillar: bridge deck ↔ the sunken tank (the refuge from the train; the raft/diver entry point)
  { id: 'ladder_br', x: 118.6, z: 143.3, y: 0, top: [117.3, 127.2, 0], raised: false, heading: deg(270) },
  // pier deck ↔ the landing stage beside the patrol boat
  { id: 'ladder_pier', x: 36.7, z: 74.2, y: 0, top: [35.6, 70.7, 0], raised: false, heading: deg(270) },
];

/** The villa is down (its explosive target destroyed). */
const villaDown = (w) => !!w.interactables?.some((i) => i.interactKind === 'explosiveTarget' && (i.tag ?? i.id) === 'villa' && i.destroyed);
/** A time bomb still exists: carried by a living man, in the air-drop crate, or placed and not yet gone off. */
export const timeBombLeft = (w) => w.commandos.some((c) => c.alive !== false && (c.inventory?.get?.('timeBomb') ?? 0) > 0)
  || !!w.interactables?.some((i) => (i.interactKind === 'crate' && (i.contents?.timeBomb ?? 0) > 0)
    || (i.interactKind === 'bomb' && i.bombKind === 'time' && !i.exploded && !i.removed));

// ---------------------------------------------------------------- the mission
// ---------------------------------------------------------------- barbed wire (docs/barbed-wire.md §12)
/** The M4–M20 wire pass: see-through, uncrossable (B.FENCE) runs added where the wire belongs; none crosses a route
 *  or lengthens an approach (tests/unit/wire-placements.test.mjs). Drawn by the map's wire layer (art/wire-obstacles.js). */
const WIRE_PASS = [
  // a concertina in front of the crossing MG nest
  { id: 'wx_mg_x', type: 'fence', variant: 'concertina', points: [[146.4, 86.1], [145.5, 87.4], [144.2, 88.3], [142.7, 88.7], [141.1, 88.5], [140.1, 88.1]], h: 1.2 },
];

export default {
  id: 'm04',
  campaign: 'BEL',
  title: 'Restore Pride',
  subtitle: 'Stokkan, near Trondheim · 10 March 1941',
  date: '1941-03-10',
  place: 'Stokkan, near Trondheim, Norway',
  theater: 'snow',
  coneColors: 'green',
  size: [199, 171],
  seed: 1941_0310,
  briefing: {
    historical: 'March 1941. Night after night the bombs fall on British cities, and Britain needs a blow of its own. The German command for the Trondheim region has moved into a requisitioned villa at Stokkan. Level it, and every garrison in Norway will learn that nowhere is out of reach.',
    text: 'You come ashore in the south-west, across the inlet from the headquarters. The RAF dropped your extra kit and missed: the crate came down in the woods to the north-east, with the Sapper\'s charge, rounds for the Sniper and the Driver\'s machine pistol. Get it first, then get into the compound and blow the villa. A patrol boat is moored at the villa\'s jetty; it will take you out once everyone is aboard. They outnumber you badly. A lorry runs between the level crossing and the villa; wreck it in the inner gate and their garrison stays shut out. A vehicle left on the level crossing will stop the train. Good luck.',
    objectivesSummary: 'Recover the air-drop in the north-east woods. Blow up the HQ villa with a charge on its front steps. Leave aboard the patrol boat at the villa\'s jetty.',
    hints: [
      'Clear the south-west bank first. The empty Panzer II among the old wagons belongs to whoever reaches it.',
      'The motorcyclist at the east end of the bridge is a runner. If he sees you he rides for the camp and brings a patrol back.',
      'The train crosses the bridge every half minute or so. The ladder on the right-hand pier is the only refuge.',
      'The crate lies under a white parachute at the edge of the north-east woods.',
      'The inner gate is an old stone arch. A big enough blast will bring it down, and a burning lorry wedged in it will do the same job.',
      'The villa needs a proper charge on its front steps. Grenades will not do it.',
      'The lorry driver is unarmed and will never raise the alarm. Catch him on foot at one of his stops.',
    ],
  },
  lighting: { sunElevDeg: 16, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast', fog: 150, lut: 'norway' },
  water: { velocity: 0.6, angleDeg: 40, turbulence: 0.4 },
  shoreShallowWidth: 0, // every shore is cliff or rock rim: into the water only from the landing stage or the sunken tank
  baseTerrain: 'snow',
  terrain: TERRAIN,
  markers: [
    // demolition marker for o1: the time bomb must go off on the villa's front steps
    { id: 'villa_steps', x: STEPS.x, z: STEPS.z, r: 3, target: 'villa' },
  ],
  structures: [...STRUCTURES, ...WIRE_PASS],
  items: [],
  interactables: INTERACTABLES,
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  zones: ZONES,
  jails: [JAIL],
  barracks: BARRACKS,
  climbLinks: [],
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the German headquarters', type: 'destroy', targets: ['villa'], marker: 'villa_steps', required: true, bombOnly: true },
    { id: 'o2', text: 'Recover the air-dropped equipment', type: 'recover', targets: [], required: false },
    { id: 'o3', text: 'Get everyone aboard the patrol boat', type: 'escape', required: true, vehicleId: 'pboat' },
  ],
  setpieces: [
    // the inner arch comes down under any explosion within 3 m (bomb, grenade, barrel, burning vehicle): sealed for good
    { type: 'collapse', id: 'arch_fall', at: [ARCH.x, ARCH.z], r: 3, by: ['bomb', 'grenade', 'barrel', 'vehicle'],
      block: { poly: [[93.6, 51.6], [91.8, 49.8], [96.0, 45.6], [97.8, 47.4]] }, message: 'The arch has come down: the inner gate is sealed.' },
  ],
  triggers: [
    // o1 lost for good: the one time bomb went off anywhere but on the steps (the villa stands, none is left)
    { on: 'tick', once: true, when: (_p, w) => !villaDown(w) && !timeBombLeft(w),
      do: [{ message: 'The charge is spent and the headquarters still stands.', kind: 'warn' }, { objective: 'o1', set: 'failed' }] },
    // o2: shown done once the Sapper holds the crate's time bomb
    { on: 'tick', once: true, when: (_p, w) => w.commandos.some((c) => c.role === 'sapper' && c.alive !== false && (c.inventory?.get?.('timeBomb') ?? 0) > 0),
      do: [{ objective: 'o2', set: 'done' }, { message: 'The Sapper has the charge.', kind: 'info' }] },
    // p7 (Prima 38–40) on RINT: through the arch, down to the pier and back, then round the stair head (retail BUCL)
    { on: 'alarm:zone', match: { event: 'RINT' }, once: true, do: [{ send: ['e50', 'e51', 'e52'], to: P7_RINT.to, loop: P7_RINT.loop }] },
    // e53 on RINT: stops above the stair, facing NNW
    { on: 'alarm:zone', match: { event: 'RINT' }, once: true, do: [{ send: ['e53'], to: [[67.3, 48.1]], loop: [{ x: 67.3, z: 48.1, wait: 0, look: 330 }] }] },
  ],
  // level-crossing booms, the lorry driver's errands, the courier's bike, vehicles off the rail bridge
  script: m04Script,
  // the boat sails W off the map once o1 is done and every living commando is aboard (retail EXIT route DEMO, VEL 3)
  extraction: { vehicleId: 'pboat', spawnAt: { x: BOAT.x, z: BOAT.z, heading: deg(BOAT.h) }, spawnWhen: ['o1'], leave: { x: -6, z: 81.5, speed: 2.7 } },
  alarmFail: null,
  timeBombFuse: 7.5, // the retail file's fuse for the air-drop charge (the standard is 10 s)
  par: { time: 755 },
  cameraStart: { x: 14, z: 156, zoom: 1 },
  startDisguised: [],
};
