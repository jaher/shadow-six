/**
 * BEL Mission 15 — "The End of the Butcher" (buildable layout: docs/missions/m15.md). Owned by MISSIONS.
 * Compiègne, 26 August 1944. SS-Gruppenführer Helmut Schleper, "the Butcher" of the Paris Resistance, has gone
 * to ground in a mansion in Compiègne and leaves for Berlin tomorrow with a list of our agents in the Reich. Every
 * morning he paces his walled garden; its NE corner is the one spot the flat roof across the garden street can
 * see. The whole town is one silent zone: any alarm sends him running for a car (yard car through the house
 * first, then the curb car by the gate) and reaching it loses the mission (alarmFail GENERAL_ESCAPED). His HQ
 * must go too: the only charge on the map is the fuel tanker, and a tram that hits it on the rails is an
 * "accident" that raises no alarm. Then everyone into the van in the cemetery and out by the NW road.
 *
 * Conventions: the dossier's headings/rot are DEGREES (0 = E, 90 = S, 180 = W, 270 = N), converted with deg();
 * route `look` and `post.sweep` stay in degrees. The street grid is turned 15° (axis A); rotated blocks are
 * placed in their local frame with `loc()`. Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid / engine fit, see the commit message):
 *  - flat map: the canal basins are deep water at y 0 behind 0.9 m parapets (no −3 m surface); the stair flights
 *    S1/S2 are shallow strips (wading) in the parapet gaps; the culverts are closed (no water between basins);
 *  - the corner block is 26 × 22 (not 30 × 25) so the W avenue stays open, and it is split into its W part
 *    (house, door D1), the flat roof R (y 12.5) and the SE turret; the balcony B (y 4.5) is a walkway along its
 *    S face (rotated with the block, not an axis-aligned rect);
 *  - the tram runs x 5 → 76 on the map (not from off-map); stops S1/S2 lie on the track polyline;
 *  - gates are open gaps (the dossier has them all open); the SdKfz stands 3.5 m further S, clear of the block;
 *  - the general's run, car priority, "through the house" crossing, hearing filter, HQ demolition point and silent
 *    accident destruction live in scripts/m15.js (dossier §14 E1–E3, E6), not in enemy-brain.js;
 *  - routes nudged ≤ 2 m off walls, trees and parked cars (e2, e3, e5, e27, p17, the garden walks).
 */

import { m15Tick, reachesHQ, destroyHQ, HQ_POINT, GARDEN_DOOR } from './scripts/m15.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)
const ROT = 15; // axis A (the tram street, the block faces)
const r2 = (v) => Math.round(v * 100) / 100;
/** World point of local (lx, lz) in a block centred at (cx, cz) turned `rot` degrees. */
export const loc = (cx, cz, lx, lz, rot = ROT) => {
  const c = Math.cos(deg(rot)), s = Math.sin(deg(rot));
  return [r2(cx + lx * c - lz * s), r2(cz + lx * s + lz * c)];
};

/** Levels (dossier §4.3): B the balcony, R the flat roof of the corner block. */
export const LEVEL = { B: 4.5, R: 12.5 };

// ---------------------------------------------------------------- the corner block (dossier §5.2)
export const CB = { x: 20, z: 50, w: 26, d: 22 };
const cb = (lx, lz) => loc(CB.x, CB.z, lx, lz);
const BAL_LZ = 9.9; // the balcony strip (lz 8.8–11) along the S face
const [cwX, cwZ] = cb(-6, 0);
const [crX, crZ] = cb(7, -1.1);
const [ctX, ctZ] = cb(10.5, BAL_LZ);
export const D1 = cb(-9, 11.9); // the team's hide (door on the S face, "near the half-track")
export const UNIFORM = cb(3.5, BAL_LZ); // the clothes rack on the balcony
export const SNIPER_SPOT = cb(12, -10); // R's NE corner: the shot at the garden's NE corner
const CORNER = [
  { id: 'corner_block', type: 'house', variant: 'townhouse_corner_turret', label: 'Café de la Paix', x: cwX, z: cwZ, rot: deg(ROT),
    w: 14, d: CB.d, h: 16, mat: 'plaster', roof: 'roofTar', enterable: true, door: D1, awnings: true,
    walkways: [{ points: [cb(-11.5, BAL_LZ), cb(8, BAL_LZ)], width: 2.2, y: LEVEL.B }] },
  { id: 'corner_roof', type: 'flat_roof_house', variant: 'townhouse_corner_flat_roof', x: crX, z: crZ, rot: deg(ROT),
    w: 12, d: 19.8, h: LEVEL.R, mat: 'plaster', roofWalk: true, parapet: 0.8 },
  { id: 'corner_turret', type: 'house', variant: 'townhouse_round_turret', x: ctX, z: ctZ, rot: deg(ROT), w: 5, d: 2.2, h: 16, mat: 'plaster', roof: 'roofTar' },
];

// ---------------------------------------------------------------- the HQ block (dossier §5.1)
const HQ_N = { x: 63, z: 58, w: 14, d: 22 };
const hqL = [r2(HQ_POINT.x - HQ_N.x), r2(HQ_POINT.z - HQ_N.z)];
// world → local offset of the demolition point (targetAt is in the block frame)
const c15 = Math.cos(deg(ROT)), s15 = Math.sin(deg(ROT));
const HQ_TARGET_LOCAL = [r2(hqL[0] * c15 + hqL[1] * s15), r2(-hqL[0] * s15 + hqL[1] * c15)];
const HQ = [
  { id: 'hq', type: 'villa', variant: 'mansion_hq_mansard', label: 'Schleper\'s headquarters', x: HQ_N.x, z: HQ_N.z, rot: deg(ROT),
    w: HQ_N.w, d: HQ_N.d, h: 15, mat: 'brick', roof: 'roofTar', banners: true, flag: false, garrison: true,
    destructible: true, bombOnly: true, targetAt: HQ_TARGET_LOCAL, marker: 'hq_point', hp: 100, destroyFx: ['bigBlast', 'fire'], quietDestroy: true, // the trigger announces it (one message)
    door: deg(270) }, // the rear door on the N face: the garrison's exit
  { id: 'hq_wing', type: 'villa', variant: 'mansion_hq_mansard_wing', x: 56.5, z: 74.5, rot: deg(ROT), w: 19, d: 11, h: 15,
    mat: 'brick', roof: 'roofTar', steps: false },
  // the garden wall: brick to 1.2 m with a railing above (blocks feet, not eyes); the gate gap at (40, 56.3)
  { id: 'garden_wall_n', type: 'fence', variant: 'wall_brick_railing', points: [[45, 39], [58, 42.5], [59.1, 45.6]], h: 2.2, width: 0.5, mat: 'brick' },
  { id: 'garden_wall_w', type: 'fence', variant: 'wall_brick_railing', points: [[45, 39], [40.4, 54.6]], h: 2.2, width: 0.5, mat: 'brick' },
  { id: 'garden_wall_sw', type: 'fence', variant: 'wall_brick_railing', points: [[39.5, 57.9], [36, 69.5], [47.5, 72.58]], h: 2.2, width: 0.5, mat: 'brick' }, // S run on the 15° grid, into hq_wing's W face
  // the E car yard; the rear gate gap (74.3, 49.6)–(79.7, 51.1) on the tram street
  { id: 'yard_wall_n', type: 'fence', variant: 'wall_brick_railing', points: [[72.6, 49.2], [74.3, 49.6]], h: 2.2, width: 0.5, mat: 'brick' },
  { id: 'yard_wall_e', type: 'fence', variant: 'wall_brick_railing', points: [[79.7, 51.1], [80.7, 51.4], [80.7, 83], [64.3, 80.5]], h: 2.2, width: 0.5, mat: 'brick' },
];
/** Garden trees (horse chestnuts), box hedges; the SE roadblock beyond the yard. */
const GARDEN = [
  { id: 'chestnut_1', type: 'tree', variant: 'horse_chestnut', x: 44.6, z: 43.2, h: 11, crown: 3 },
  { id: 'chestnut_2', type: 'tree', variant: 'horse_chestnut', x: 40.3, z: 61.5, h: 11, crown: 3 },
  { id: 'chestnut_3', type: 'tree', variant: 'horse_chestnut', x: 40.2, z: 67.3, h: 11, crown: 3 },
  ...[[47.5, 50], [51.5, 50.5], [46.5, 57], [50.5, 57.5], [46.5, 63], [51, 62]].map(([x, z], k) => ({ id: `hedge_${k + 1}`, type: 'bush', variant: 'box_parterre', x, z, r: 0.8, h: 0.6 })),
  // DEVIATION (dossier §13 #18): the dossier's roadblock centre (77,77) falls inside our car yard (its wall runs to z 83),
  // so the roadblock, its 4 hedgehogs and sentry e31 sit ~10 m S, just outside the yard's SE corner; the Morris column moves with them
  { id: 'roadblock_se', type: 'sandbags', variant: 'roadblock_sandbag_arc', x: 76, z: 88.5, rot: deg(8.7), w: 4, d: 0.8, h: 1.1 }, // ∥ yard_wall_e's S run
  ...[[72.5, 85], [79.3, 86], [70.5, 91], [80, 95]].map(([x, z], k) => ({ id: `hedgehog_${k + 1}`, type: 'sandbags', variant: 'czech_hedgehog', x, z, w: 1.4, d: 1.4, h: 1.2 })),
];

// ---------------------------------------------------------------- the N side: townhouse, fuel lot, cemetery (dossier §5.3)
const TH = { x: 26, z: 7 };
export const D2 = loc(TH.x, TH.z, -3, 7.9); // "the door in front of the fire hydrant"
const tomb = (id, x, z) => ({ id, type: 'crates', variant: 'sarcophagus', x, z, rot: deg(15), w: 2, d: 1, h: 1.1 });
const NORTH = [
  { id: 'townhouse', type: 'house', variant: 'townhouse_stucco_shopfront', label: 'Townhouse', x: TH.x, z: TH.z, rot: deg(ROT), w: 14, d: 14, h: 13,
    mat: 'plaster', roof: 'roofTar', enterable: true, door: D2 },
  { id: 'hydrant', type: 'sign', variant: 'fire_hydrant', x: 19.5, z: 16, h: 0.8 },
  // NW: the bombed block behind its railing (decoration, not enterable)
  { id: 'ruins_nw', type: 'ruins', variant: 'bombed_block', x: 3, z: 9, rot: deg(-20), w: 5, d: 16, h: 4, nav: false }, // no walkable library top over the railing
  { id: 'ruins_nw_rail', type: 'fence', variant: 'iron_railing', points: [[9.4, 0], [6.2, 12], [3.97, 20.3], [0, 19.24]], h: 1.8, width: 0.3 }, // runs on the 15° grid; (fix round) turns W to the map edge short of the tram's terminus (it parked across the old last run)
  // the cemetery: railing on a kerb (blocks feet, not eyes), the gate gap (46.6, 22.6)–(51.8, 23.9) open, 5.4 m wide about the dossier's centre (49.2, 23.3) so the van can be driven out by clicks (fix pass 15)
  { id: 'cem_fence_w', type: 'fence', variant: 'iron_railing_kerb', points: [[46.83, 0], [41.2, 21], [46.6, 22.6]], h: 1.8, width: 0.3 }, // W run on the 15° grid
  { id: 'cem_fence_s', type: 'fence', variant: 'iron_railing_kerb', points: [[51.8, 23.9], [81, 31]], h: 1.8, width: 0.3 },
  { id: 'chapel', type: 'house', variant: 'mausoleum_chapel', x: 73, z: 12, rot: 0, w: 6, d: 5, h: 5, mat: 'stone', roof: 'roofTar' },
  ...[60, 62.4, 64.8, 67.2, 69.6].map((x, k) => tomb(`tomb_n${k + 1}`, x, 1.8)),
  ...[62.5, 65, 67.5, 70].map((x, k) => tomb(`tomb_s${k + 1}`, x, 20)),
  ...[56, 58.5].map((x, k) => tomb(`tomb_w${k + 1}`, x, 11)),
  ...[[45, 5], [45.2, 13], [52, 14.5], [61, 23.5], [72.5, 24], [79, 21]].map(([x, z], k) => ({ id: `cypress_${k + 1}`, type: 'pine', variant: 'cypress', x, z, h: 9 })),
];

// ---------------------------------------------------------------- the S side: canal, fountain, ruins, start (dossier §4.2, §5.4)
/** The three sunken basins (deep water, flat map) and the two stair flights (shallow strips). */
export const W1 = [[0, 88], [11, 88], [8, 107], [0, 107]];
export const W2 = [[20, 102], [50, 106], [54, 108], [49, 124], [20, 118]];
export const W3 = [[63, 116], [81, 119], [81, 134], [61, 129]];
export const S1 = [[26, 98.2], [31, 98.9], [31, 104], [26, 103.5]]; // the W stairs, down to the S into W2's NW corner
export const S2 = [[50.2, 106.3], [53.6, 108.3], [49.4, 122.8], [46.6, 121.8]]; // the E stairs, down to the W
const parapet = (id, points) => ({ id, type: 'wall', variant: 'canal_parapet_stone', points, h: 0.9, width: 0.5, mat: 'stone', block: 1 });
const CANAL = [
  parapet('parapet_w1', [[0, 87.8], [11.2, 87.8], [8.2, 107.2], [0, 107.2]]),
  parapet('parapet_w2_w', [[26, 102.5], [19.7, 101.7], [19.7, 118.2], [49.1, 124.3]]),
  parapet('parapet_w2_n', [[31, 103.2], [50, 105.7], [53.9, 107.7]]),
  parapet('parapet_w3', [[61, 129.3], [62.8, 115.8], [81, 118.8]]),
  parapet('parapet_w3_s', [[61, 129.3], [81, 134.2]]),
];
const SOUTH = [
  { id: 'fountain', type: 'well', variant: 'fountain_statue', x: 24.5, z: 80, r: 5, h: 0.7, statueH: 6 },
  // the street "bridges" between the basins (flat map, culverts closed): gameplay only, the basins' quay parapets are
  // their parapets and the setts run across them (art pass: no castle drawbridge model stretched over the street)
  { id: 'bridge_w', type: 'bridge', variant: 'bridge_stone_arch', x: 15.5, z: 100, rot: deg(95), w: 20, d: 9, h: 0.3, visual: false },
  { id: 'bridge_e', type: 'bridge', variant: 'bridge_stone_arch', x: 57, z: 118, rot: deg(100), w: 24, d: 8, h: 0.3, visual: false },
  // the burned-out house (roofless, 3 m walls); its entrance is the gap in the E wall
  { id: 'ruin_s', type: 'wall', variant: 'ruin_burnt_walls', points: [[5, 139], [5, 123], [24, 123], [24, 129]], h: 3, width: 0.5, mat: 'stone' },
  { id: 'ruin_s_e', type: 'wall', variant: 'ruin_burnt_walls', points: [[24, 133], [24, 139]], h: 3, width: 0.5, mat: 'stone' },
  { id: 'wreck_1', type: 'crates', variant: 'car_wreck_burnt', x: 33, z: 133.2, rot: deg(10), w: 4.2, d: 1.8, h: 1.4, vehicleArt: 'citroen11', wreck: true },
  { id: 'wreck_2', type: 'crates', variant: 'car_wreck_overturned', x: 29, z: 136.5, rot: deg(60), w: 4.2, d: 1.8, h: 1.2, vehicleArt: 'horch901', wreck: true },
  // (art pass: the junked cars are burnt-out library wrecks, a Citroen Traction and a Horch staff car; footprints unchanged)
  { id: 'wall_stub_se', type: 'wall', variant: 'ruin_wall_stub', points: [[45, 130.5], [49, 132]], h: 1.6, width: 0.5, mat: 'stone' },
  { id: 'roadblock_sw', type: 'sandbags', variant: 'sandbag_post', x: 2, z: 121.5, w: 2.4, d: 0.8, h: 1.1 },
  { id: 'sentry_box_sw', type: 'hut', variant: 'sentry_box', x: 2.2, z: 124.5, w: 1.5, d: 1.5, h: 2.4 },
  { id: 'knife_rests', type: 'fence', variant: 'knife_rest_wood', points: [[0, 127], [4.3, 127.8]], h: 1.2, width: 0.8 },
  { id: 'fence_w_a', type: 'wall', variant: 'wood_fence_broken', points: [[0, 76], [5, 77]], h: 1.5, width: 0.3, mat: 'wood' },
  { id: 'fence_w_b', type: 'wall', variant: 'wood_fence_broken', points: [[6.2, 78.5], [8.2, 82]], h: 1.5, width: 0.3, mat: 'wood' },
  { id: 'morris_column', type: 'well', variant: 'morris_column', x: 76.5, z: 99.5, r: 0.6, h: 4, block: 2 },
  ...[[27, 92.5], [40, 91.5], [50, 95.5], [73, 110], [4, 83], [3, 112]].map(([x, z], k) => ({ id: `plane_${k + 1}`, type: 'tree', variant: 'plane_tree', x, z, h: 10 })),
];

// ---------------------------------------------------------------- the tram street (dossier §4.1, §6.1)
/** The tram's line (one track used); the two stops are track points with a 12 s wait. */
export const TRACK = [[5, 23.71], [20, 28], [31, 31.52, 12], [45, 36], [55, 39.2, 12], [70, 44], [76, 45.67]];
const STREET = [
  { id: 'tram_track', type: 'tram_track', variant: 'tram_track_catenary', points: TRACK.map(([x, z]) => [x, z]), width: 2.2 },
  { id: 'tram_stop_1', type: 'sign', variant: 'tram_stop_shelter', x: 30, z: 36.3, h: 2.6 },
  { id: 'tram_stop_2', type: 'sign', variant: 'tram_stop_shelter', x: 56.5, z: 36, h: 2.6 },
  ...[[6, 17], [24, 35.8], [64, 28.2], [42, 96]].map(([x, z], k) => ({ id: `lamp_${k + 1}`, type: 'lamp_post', variant: 'lamp_cast_iron', x, z, h: 4.5 })),
  // the rest of the curb lamps (dossier §5.4 "~40"): pure decoration, no footprint (block 0), so no gameplay effect
  ...[[15, 20.5], [33, 25.5], [39, 24], [56, 27], [72, 30.8], [79, 33], [4, 33], [36, 39.8], [3.5, 48], [3.5, 63], [24, 44], [24, 58],
    [38.5, 47], [34.5, 63], [12, 86], [30, 88], [46, 84.5], [52, 89], [60, 86], [70, 86], [66, 90], [74, 96], [36, 100.5], [56, 101],
    [66, 103], [8, 116], [28, 123.5], [42, 126.5], [70, 136.5]].map(([x, z], k) => ({ id: `lamp_${k + 5}`, type: 'lamp_post', variant: 'lamp_cast_iron', x, z, h: 4.5, block: 0 })),
];

const STRUCTURES = [...CORNER, ...HQ, ...GARDEN, ...NORTH, ...CANAL, ...SOUTH, ...STREET];

// ---------------------------------------------------------------- terrain (dossier §4.1, §4.2)
const TERRAIN = [
  { type: 'poly', terrain: 'grass', points: [[45, 39], [58, 42.5], [59.1, 45.6], [53.4, 66.8], [48.7, 66.7], [47.3, 72], [36, 69.5]] }, // T1 the parterre
  { type: 'poly', terrain: 'grass', points: [[22, 90], [60, 95], [61, 100], [54, 106], [22, 100]] }, // T2
  { type: 'poly', terrain: 'grass', points: [[68, 106], [81, 108], [81, 117], [64, 114]] }, // T3
  { type: 'poly', terrain: 'grass', points: [[0, 74], [9, 76], [6, 88], [0, 88]] }, // T4
  { type: 'poly', terrain: 'ground', points: [[33, 0], [46, 0], [41, 20], [33, 17]] }, // T5 the fuel lot
  { type: 'poly', terrain: 'grass', points: [[46, 0], [81, 0], [81, 31], [41, 22]] }, // T6 the cemetery
  { type: 'poly', terrain: 'ground', points: [[5, 123], [24, 123], [24, 139], [5, 139]] }, // T7 the ruin floor
  { type: 'poly', terrain: 'ground', points: [[0, 0], [11, 0], [1, 28], [0, 28]] }, // T8 the NW ruins
  { type: 'poly', terrain: 'water', points: W1 },
  { type: 'poly', terrain: 'water', points: W2 },
  { type: 'poly', terrain: 'water', points: W3 },
  { type: 'poly', terrain: 'shallow', points: S1 },
  { type: 'poly', terrain: 'shallow', points: S2 },
];

// ---------------------------------------------------------------- art pass: paved streets (step 3p, visual only)
// Granite setts laid along axis A over every street, square and yard (grid false: the cobble nav terrain, routes and
// cones stay as tuned). The street area is split into pieces that border the lawns, the fuel lot, the ruins and the
// basins exactly (no hole support in a pavement polygon); shared borders use hard edges so no seam shows. The streets
// run on past the map edges (tram street W/E, NW road, E and S streets) so the town does not stop at a bare verge.
const SETTS = { surface: 'setts', angle: deg(ROT), edge: 'hard', grid: false, wear: 0.55, weeds: 0.18, puddles: 0.22, patches: 0, cracks: 0.2 }; // (no repair patches: they drew as hard dark rectangles on the squares)
const PAVEMENTS = [
  // the tram street and the NW road, from the ruins / townhouse / fuel lot / cemetery down to the corner block and garden
  { id: 'setts_n', ...SETTS, points: [[11, 0], [16, -20], [36, -20], [33, 0], [33, 17], [41, 20], [41, 22], [81, 31], [101, 36.2], [101, 57.2], [81, 52], [72.6, 49.2], [59.1, 45.6],
    [58, 42.5], [45, 39], [1.26, 27.28]] }, // (the border with setts_m runs on the 15° grid, under the corner block)
  // the W avenue, the garden street, the HQ yard and the E street down to the fountain square and the park strips
  { id: 'setts_m', ...SETTS, points: [[1.26, 27.28], [45, 39], [36, 69.5], [47.3, 72], [48.7, 66.7], [53.4, 66.8], [59.1, 45.6], [72.6, 49.2], [81, 52], [101, 57.2], [101, 108], [81, 108],
    [68, 106], [61, 100], [60, 95], [22, 90], [11, 88], [6, 88], [9, 76], [0, 74], [-20, 74], [-20, 22.64], [0, 28], [1, 28]] },
  // the W bridge street, the S street and the E bridge street round the basins and the burned-out house
  { id: 'setts_s', ...SETTS, points: [[0, 107], [8, 107], [11, 88], [22, 90], [22, 100], [19.7, 101.7], [19.7, 118.2], [49.1, 124.3], [54, 108], [54, 106],
    [61, 100], [68, 106], [64, 114], [81, 117], [81, 119], [63, 116], [61, 129], [81, 134], [101, 139], [101, 159], [24, 159], [24, 123], [5, 123], [5, 159], [-20, 159], [-20, 107]] },
  // the walk between the park strip and the central basin's N parapet, either side of the W stairs
  { id: 'setts_c1', ...SETTS, points: [[19.7, 101.7], [22, 100], [26, 100.75], [26, 102.5]] },
  { id: 'setts_c2', ...SETTS, points: [[31, 101.7], [54, 106], [53.9, 107.7], [50, 105.7], [31, 103.2]] },
];

// raked gravel walk (soft surface painted into the ground, visual only) round the HQ parterre
const ROADS = [
  // the parterre's raked walk: the general's morning round (GENERAL_WALK), from the garden door and back
  { id: 'garden_walk', surface: 'gravel', points: [[GARDEN_DOOR.x, GARDEN_DOOR.z], [50, 66], [41.5, 63], [43.5, 52], [47, 44.5], [55, 45], [55.5, 53], [GARDEN_DOOR.x, GARDEN_DOOR.z]],
    width: 1.8, wear: 0.25, weeds: 0.15, spline: false, grid: false },
];

// street furniture (visual only, block false: off every patrol route): park benches facing the basins, a second
// Morris column on the fountain square, a French road sign at the NW road and the Feldkommandantur board by the yard
const FURNITURE = [
  { type: 'bench', x: 36, z: 101.5, rot: 0.185, block: false },
  { type: 'bench', x: 45.5, z: 103.2, rot: 0.185, block: false },
  { type: 'bench', x: 74.5, z: 113.1, rot: 0.175, block: false },
  { type: 'morris_column', x: 14, z: 75.5, block: false },
  { type: 'sign', variant: 'plate', x: 10.4, z: 7.5, rot: deg(285), text: 'NOYON 24\nSOISSONS 38', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 80.2, z: 84.5, rot: deg(180), text: 'FELDKOMMANDANTUR\nCOMPIEGNE', block: false },
];

// ---------------------------------------------------------------- ladders (dossier §5.2; everyone climbs)
const LADDERS = [
  { id: 'L1', x: cb(5.5, 12.4)[0], z: cb(5.5, 12.4)[1], y: 0, top: [...cb(5.5, BAL_LZ), LEVEL.B], raised: false, heading: deg(285) }, // street → balcony
  { id: 'L2', x: cb(7.2, BAL_LZ)[0], z: cb(7.2, BAL_LZ)[1], y: LEVEL.B, top: [...cb(7.2, 7.4), LEVEL.R], raised: false, heading: deg(285) }, // balcony → roof
];

// ---------------------------------------------------------------- enemies (dossier §8; ids = Prima's numbers)
// Cobbles everywhere: nobody follows footprints (dossier §4.1). Nobody arrests: every man shoots (jail:false).
const lvl = (y) => (y ? { y, elevated: y >= 2.5 } : {});
const sentry = (id, prima, x, z, h, sweep, extra = {}) => ({ id, prima, soldierType: 'sentry', x, z, heading: deg(h), jail: false,
  flags: { holdsPost: true, followsTracks: false }, post: { heading: deg(h), sweep, period: 8 }, ...extra });
const walker = (id, prima, pts, { y = 0, vel = 1.0, h = null, type = 'PINGPONG', ...extra } = {}) => {
  const [a, b] = pts;
  return { id, prima, soldierType: 'soldier', x: a.x, z: a.z, heading: h != null ? deg(h) : Math.atan2(b.z - a.z, b.x - a.x), jail: false,
    ...lvl(y), flags: { investigates: true, followsTracks: false }, route: { type, vel, points: pts }, ...extra };
};
/** An n-man patrol (sergeant + troopers) in one column behind the leader, looping `pts`; the alarm speeds it up. */
const patrol = (ids, prima, sq, x, z, h, pts, type = 'LOOP') => ids.map((id, k) => ({
  id, prima: k === 0 ? prima : null, soldierType: k === 0 ? 'sergeant' : 'trooper',
  x: r2(x - Math.cos(deg(h)) * 1.2 * k), z: r2(z - Math.sin(deg(h)) * 1.2 * k), heading: deg(h), jail: false,
  squad: { id: sq, leader: ids[0], columns: 1 }, flags: { investigates: true, followsTracks: false }, reactEvents: ['RINT'],
  route: { type, vel: 1.2, points: pts },
}));
const bal = (lx) => cb(lx, BAL_LZ);

/** Patrol loops (also used by the garrison squads). */
export const LOOP_P7 = [P(15.5, 90), P(60, 93), P(61, 108), P(58, 127), P(15.5, 121)]; // the "conductor" round the canal
export const LOOP_P17 = [P(26, 74, 6, 90), P(1.5, 70), P(1.5, 68), P(1.5, 40), P(9, 33.5), P(36, 40), P(37.5, 50), P(33, 64.5)];
export const LOOP_P10 = [P(66, 86), P(80, 90.5, 5, 90), P(62, 98), P(36, 86), P(34, 76)];
export const LOOP_P22 = [P(78, 27.5), P(79, 6.5, 4, 180), P(52, 4.5), P(50, 20, 4, 90)];
export const FILE_25 = [P(70.5, 77.5, 3, 90), P(78.8, 80), P(79.5, 54, 3, 270), P(74.5, 53)];
/** The general's garden walk: the 15 s pause at the NE corner is the Sniper's shot (dossier §8.4). */
export const GENERAL_WALK = [P(50, 66), P(41.5, 63), P(43.5, 52), P(47, 44.5), P(55, 45, 15, 180), P(55.5, 53), P(GARDEN_DOOR.x, GARDEN_DOOR.z, 20, 180)];
export const GENERAL_PAUSE = { x: 55, z: 45 };

const ENEMIES = [
  // ===== the S bank (Phase 1)
  walker('e1', 1, [P(21, 136, 8, 270), P(25, 131), P(26, 124), P(8, 121.5, 4, 180)], { h: 270 }),
  walker('e2', 2, [P(46, 125.2, 5, 90), P(22, 121, 5, 270)]),
  walker('e3', 3, [P(62.5, 131.5, 4, 180), P(77, 134.8, 4, 0)]),
  walker('e5', 5, [P(4, 108.5, 3, 270), P(5, 119.5, 6, 90)]),
  walker('e8', 8, [P(61, 104, 3, 270), P(58.5, 125, 3, 90)]),
  // ===== the canal's N side and the fountain (Phases 1–2)
  walker('e4', 4, [P(24, 92, 6, 180), P(28, 96), P(28.5, 102.6, 3, 90)]), // down the W stairs to the water and back
  sentry('e6', 6, 24.5, 97, 270, 60), // head of S1, back to the water
  walker('e9', 9, [P(36, 86, 4, 180), P(62, 98, 4, 90)]),
  walker('e12', 12, [P(4, 70, 4, 270), P(20, 69.5, 4, 0)]),
  // ===== the corner block (Phase 2): e13 below the balcony, e14/e15 on it (B), e16 on the roof (R)
  walker('e13', 13, [P(...cb(-11, 12.9), 3, 195), P(...cb(4.6, 12.9), 5, 15)]),
  walker('e14', 14, [P(...bal(-10.5), 4, 195), P(...bal(-2), 4, 15)], { y: LEVEL.B }),
  sentry('e15', 15, ...bal(1.5), 195, 30, lvl(LEVEL.B)),
  sentry('e16', 16, ...cb(2, -10), 15, 90, lvl(LEVEL.R)),
  // ===== the HQ: gate, garden, yard (Phases 3–4)
  sentry('e26', 26, 38.3, 55.2, 195, 60),
  walker('e27', 27, [P(36, 44, 4, 285), P(33, 61.5, 4, 105)]),
  sentry('e28', 28, 47, 41.8, 100, 60),
  walker('e29', 29, [P(42.3, 46.5, 5, 15), P(38.8, 65.5, 5, 15)]),
  sentry('e30', 30, 52, 65.3, 285, 60),
  sentry('e23', 23, 77, 52.8, 285, 90),
  walker('e25a', 25, FILE_25, { h: 100, type: 'LOOP' }), // the yard's 3-man file circles the yard in line (dossier §8.4, §13 #5)
  walker('e25b', null, FILE_25, { h: 100, type: 'LOOP' }),
  walker('e25c', null, FILE_25, { h: 100, type: 'LOOP' }),
  sentry('e31', null, 76, 86.5, 105, 90),
  // ===== the N street and the cemetery (Phases 3–4)
  walker('e20', 20, [P(14, 19, 4, 180), P(40, 25.5, 4, 15)]),
  sentry('e21', 21, 34.8, 16, 105, 60, { idle: 'smoke' }),
  sentry('e18', 18, 34, 36.8, 285, 60),
  walker('e19', 19, [P(46, 28, 4, 270), P(70, 34.5, 4, 195)]),
  sentry('e24', 24, 76, 16.5, 195, 60),
  // ===== the four patrols (Kildread: one of 3, three of 5)
  ...patrol(['p7', 'p7b', 'p7c', 'p7d', 'p7e'], 7, 'p7', 15.8, 112, 270, LOOP_P7),
  ...patrol(['p17', 'p17b', 'p17c', 'p17d', 'p17e'], 17, 'p17', 26, 74, 180, LOOP_P17.slice(1).concat(LOOP_P17[0])),
  ...patrol(['p10', 'p10b', 'p10c', 'p10d', 'p10e'], 10, 'p10', 34, 76, 17, LOOP_P10),
  ...patrol(['p22', 'p22b', 'p22c'], 22, 'p22', 50, 20, 15, LOOP_P22),
  // ===== the Butcher: unarmed, never alarms, walks his garden; any alarm → he runs for a car (scripts/m15.js)
  { id: 'schleper', soldierType: 'general', script: 'general', name: 'SS-Gruppenführer Helmut Schleper', nickname: 'Schleper',
    x: 50, z: 66, heading: deg(200), hp: 100, jail: false, cars: ['car_yard', 'car_curb'],
    flags: { holdsPost: false, investigates: false, followsTracks: false }, route: { type: 'LOOP', vel: 0.8, points: GENERAL_WALK } },
];
// the file's 2nd and 3rd men start 1.6 m and 3.2 m behind the first (all head S down the yard)
Object.assign(ENEMIES.find((e) => e.id === 'e25a'), { x: 73.8, z: 57 });
Object.assign(ENEMIES.find((e) => e.id === 'e25b'), { x: 74.1, z: 55.4 });
Object.assign(ENEMIES.find((e) => e.id === 'e25c'), { x: 74.4, z: 53.8 });

// ---------------------------------------------------------------- vehicles (dossier §6.1)
const [t0, t1] = TRACK;
export const TANKER_ON_RAILS = { x: 72, z: 44.56 }; // the solution's parking spot, 4.6 m from the demolition point
const VEHICLES = [
  // the tram: back and forth, 12 s at each stop; runs over anyone on the rails; hitting the tanker is an accident
  { id: 'tram', vehicleType: 'tram', variant: 'tram_ochre_green', x: t0[0], z: t0[1], heading: Math.atan2(t1[1] - t0[1], t1[0] - t0[0]), driveable: false,
    track: TRACK.map(([x, z, wait]) => ({ x, z, wait: wait || 0 })), schedule: { mode: 'pingpong', speed: 6, delay: 20, endWait: 10, accident: true } },
  // "the red fuel truck": one hit and it goes up (vehicle + barrel blast); the HQ's only charge
  { id: 'tanker', vehicleType: 'opel_blitz_tanker', variant: 'opel_blitz_tanker_red', x: 38, z: 6, heading: deg(315), driveable: true, operators: ['driver'] },
  // the general's cars: the yard car first (through the house), the curb car by the gate second
  { id: 'car_yard', vehicleType: 'citroen15', variant: 'citroen_traction_black', x: 77.5, z: 58.5, heading: deg(285), driveable: true, operators: ['driver'] },
  { id: 'car_curb', vehicleType: 'citroen15', variant: 'citroen_traction_black', x: 36.8, z: 59, heading: deg(285), driveable: true, operators: ['driver'] },
  // the armoured car at the garden street's S end: static, crewed, its commander watches the street and the fountain
  // commander's cone ±30° centred on 60 (dossier §6.1): the garden street's S end and the fountain, never ladder L1
  { id: 'sdkfz', vehicleType: 'sdkfz', variant: 'sdkfz231_8rad', x: 29.5, z: 68, heading: deg(60), post: { sweep: 30 }, driveable: false,
    crew: [{ soldierType: 'crew' }, { soldierType: 'crew' }], behavior: 'standby' },
  // the escape vehicle: our van in the cemetery, nose at the gate
  { id: 'van', vehicleType: 'van', variant: 'van_civilian_grey', x: 59, z: 16, heading: deg(193.7), driveable: true, operators: ['driver'], friendly: true, seats: 6 },
];

// ---------------------------------------------------------------- commandos (§3.8 row 15, exact; dossier §7)
const COMMANDOS = [
  { id: 'sn', role: 'sniper', x: 36.5, z: 136.2, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 4 } },
  { id: 'ma', role: 'diver', x: 39, z: 137, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1 } },
  { id: 'dr', role: 'driver', x: 41.5, z: 136.2, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, firstAid: 6 } },
  { id: 'sp', role: 'spy', x: 34, z: 137, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, lethalInjection: 1 } },
];

// ---------------------------------------------------------------- zone and garrison (dossier §9)
const Z_ALL = [[0, 0], [81, 0], [81, 139], [0, 139]];
const BARRACKS = {
  // Kildread's "1 bunker": the HQ garrison pours out of the rear door on the alarm; a destroyed HQ releases nobody
  hq: { pool: 8, squads: [
    { id: 'hq_yard', event: 'RINT', size: 4, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8,
      exitRoute: [P(70, 46.8), P(77, 47.5), P(77.5, 54)], loop: [P(74, 75), P(76, 55), P(61, 43.5), P(40, 35), P(36.5, 52), P(40, 80), P(70, 86.5)] },
    { id: 'hq_street', event: 'RINT', size: 4, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8,
      exitRoute: [P(70, 46.8), P(55, 40.2), P(38, 44)], loop: [P(36, 56), P(26, 74), P(2, 70), P(1.5, 40), P(36, 40)] },
  ] },
};

const objDone = (w, id) => !!(w.objectives || []).find((o) => o.id === id)?.done;
const hqGone = (w) => { const h = w.byId?.('hq'); return !h || !!h.destroyed; };
const spyDressed = (w) => w.commandos?.some((c) => c.role === 'spy' && c.alive !== false && c.disguised);

// ---------------------------------------------------------------- the mission
export default {
  id: 'm15',
  campaign: 'BEL',
  title: 'The End of the Butcher',
  subtitle: 'Compiègne, France · 26 August 1944',
  date: '1944-08-26',
  place: 'Compiègne, France',
  theater: 'temperate',
  coneColors: 'green',
  size: [81, 139],
  seed: 1944_0826,
  // farmland fringe (art/terrain/bocage.js): field hedges, crops and orchards on the clear map edges, hedges
  // backing walls (visual only: laid out clear of every gameplay point and route)
  vegetation: { farmland: { crops: ['stubble', 'stubble', 'wheat'], orchards: 0.3, walls: false } }, // (walls false: no trimmed hedge pressed into the W quay parapet)
  briefing: {
    historical: 'August 1944. Paris is free, and its people are in the streets cheering General de Gaulle. The Germans are pulling back to the north-east. Among the first to go was SS-Gruppenführer Helmut Schleper, the man Paris calls the Butcher for what he did to the Resistance. He is hiding in Compiègne, and tomorrow he leaves for Berlin.',
    text: 'You go in from the southern edge of the town, officer. Every morning Schleper takes a walk in the garden of the house he has made his headquarters, and that is when he is most exposed. Kill him, and while you are about it, bring the headquarters down as well. A van will be waiting for you in the cemetery to the north. Remember that the whole town is watched. If anyone raises the alarm, anywhere, they will bundle him into a car and he will be gone, and with him your mission. Quietly, gentlemen.',
    objectivesSummary: 'Kill General Schleper and destroy his headquarters, without an alarm while he lives. Then everyone into the van in the cemetery and out by the north-west road.',
    hints: [
      'Strike while the general is out walking in his garden.',
      'The slightest alarm and he will be driven away. Stay silent.',
      'His headquarters must be destroyed as well.',
      'When both jobs are done, take the van and leave by the north-west road.',
      'There is a German uniform on a balcony across the street from his house.',
      'A tram runs along the northern street. Anything left on its rails will not stop it.',
      'A body by the back gate of his house will not stay hidden for long. Better to keep that sentry talking.',
      'The soldier who paces the northern pavement turns his back on the west end each time he sets off east. Cross behind him then, in one go.',
    ],
  },
  lighting: { sunElevDeg: 40, sunAzimuthDeg: 315, kelvin: 5800, hdri: 'clear', fog: 240, lut: 'temperate_day' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.05, color: '#1d5a58' }, // the still canal basins
  shoreShallowWidth: 0, // stone basin walls: the only ways in are the two stair flights
  baseTerrain: 'road',
  terrain: TERRAIN,
  roads: ROADS,
  pavements: PAVEMENTS,
  furniture: FURNITURE,
  markers: [{ id: 'hq_point', x: HQ_POINT.x, z: HQ_POINT.z, r: 6.75, target: 'hq' }],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['corner_block', 'corner_roof'], ['corner_roof', 'corner_turret'], ['hq', 'hq_wing']]),
  items: [],
  // §3.4 the Spy's uniform on the clothes rack on the balcony (level B)
  // (art pass: the rack's posts stand on the balcony at 4.5 m, 0.65 m in from the walkway's centre line, along the facade)
  interactables: [{ id: 'uniform_rack', interactKind: 'clothesline', x: UNIFORM[0], z: UNIFORM[1], visualAt: cb(3.0, BAL_LZ - 0.65), visualY: LEVEL.B, visualRot: deg(ROT) }],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // the whole map is one silent zone (Kildread: "the ENTIRE MAP")
  zones: [{ id: 'z_town', poly: Z_ALL, onSeen: 'RINT', onHeard: 'RINT', siren: true }],
  jails: [],
  barracks: BARRACKS,
  climbLinks: [], // no Green Beret: every level change is a ladder
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Kill SS-Gruppenführer Helmut Schleper', type: 'kill', targets: ['schleper'], required: true },
    { id: 'o2', text: 'Destroy his headquarters', type: 'destroy', targets: ['hq'], marker: 'hq_point', required: true },
    { id: 'o3', text: 'Escape in the van by the north-west road', type: 'escape', vehicleId: 'van', required: true },
  ],
  setpieces: [],
  triggers: [
    // per-tick glue: the general's hearing and flight, the drive-off (scripts/m15.js)
    { on: 'tick', once: false, when: () => true, do: [{ run: (w) => m15Tick(w) }] },
    // the demolition point: a barrel/bomb class blast within 6.75 m of the NE corner (silent after an accident)
    { on: 'explosion', once: false, when: (p) => reachesHQ(p), do: [{ run: (w, d, p) => destroyHQ(w, p) }] },
    { on: 'structure:destroyed', match: { id: 'hq' }, do: [{ message: 'The headquarters is burning. Its garrison is finished.', kind: 'objective' }] },
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'The Butcher is dead. The alarm no longer matters: get to the van.', kind: 'objective' }] },
    // the tanker is the only charge: lost with the HQ still standing, the mission cannot be won (dossier §11)
    { on: 'vehicle:destroyed', match: { vehicle: 'tanker' }, delay: 1.5, do: [{ run: (w, d) => {
      if (hqGone(w)) return;
      w.events?.emit('message', { text: 'The headquarters still stands and there is nothing left to bring it down.', kind: 'warn' });
      d.fail('THE HEADQUARTERS CAN NO LONGER BE DESTROYED.');
    } }] },
    // the van is the only way out
    { on: 'vehicle:destroyed', match: { vehicle: 'van' }, when: (p, w) => !objDone(w, 'o3'),
      do: [{ fail: 'THE VAN IS GONE. THERE IS NO WAY OUT OF COMPIÈGNE.' }] },
    { on: 'tick', when: (p, w) => spyDressed(w), do: [{ message: 'Uniform on. The Spy can walk among them now.', kind: 'info' }] },
    { on: 'vehicle:stop', match: { vehicle: 'tram' }, do: [{ message: 'The tram has stopped. While it stands there it blocks the view across the street.', kind: 'info' }] },
  ],
  // the van is already in the cemetery: the extraction adopts it; once o1 + o2 are done and everyone is aboard it
  // path-finds out by the NW road (m15Tick); the Driver may also drive it there himself
  extraction: {
    vehicleId: 'van', spawnAt: { x: 59, z: 16, heading: deg(190) }, spawnWhen: ['o1', 'o2'],
    exit: { x: 14.5, z: 3, r: 5 }, leave: { x: 15, z: -12, speed: 7 },
    route: [[54, 19], [49.5, 24.5], [46, 28.5], [22, 24.5], [14.5, 19]], // out of the cemetery gate, W, then N up the NW road
  },
  alarmFail: { event: 'GENERAL_ESCAPED', message: 'SCHLEPER HAS REACHED HIS CAR. HE IS ON THE ROAD TO BERLIN, WITH THE LIST.' },
  par: { time: 660 },
  cameraStart: { x: 36, z: 128, zoom: 1 },
  startDisguised: [], // the uniform is on the balcony
  // dossier §9 / Variant B [DE]: a uniformed officer climbing into a German vehicle is routine, not a suspicious act
  rules: { spyMayBoard: ['van', 'tanker', 'car_yard', 'car_curb', 'tram'] },
};
