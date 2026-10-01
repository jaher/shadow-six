/**
 * BEL Mission 19 — "Frustrate Retaliation" (buildable layout: docs/missions/m19.md). Owned by MISSIONS.
 * A small coal-mining works at Oldenburg, west of Bremen, 12 January 1945: three V2 rockets stand on their
 * launch pads inside a plank palisade on the far bank of a fast river. Green Beret, Sniper (the medic), Marine
 * and Sapper start prone behind a rock mound on the N edge, beside a tank shed and a surveillance bunker. The
 * river runs SW → NE: boats go downstream only (the `current` set-piece), swimmers can fight it. One low
 * timber rail trestle crosses it; a mine cart shuttles over it. Inside the base a conveyor carries crawling
 * men over the palisade once its switch (the flashing red lamp) is thrown. Destroy the three V2s (remote
 * bombs or the four barrels by the watchtower), then everyone into the rowboat by the NE shore and let the
 * current take it out by the N edge.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (see the commit message):
 *  - flat map (the river is deep water at y 0, the trestle deck at ground level);
 *  - the W palisade runs straight N–S at x 99 from the white wall to z 61 (the dossier's slanted line left the
 *    conveyor switch outside the base); the coal heap by the belt, the boiler house, the tall house, the
 *    cable-drum crates and the dog pen's small objects are nudged 0.5–4 m to clear fences and routes;
 *  - the start rock mound is split: the mound S of the team plus a boulder W of it (the dossier's mound covered
 *    the painted start figures); the team starts at z 1.5–2.5;
 *  - a few posts/waypoints move ≤ 3 m off footprints (e1, e2, e9, e20–e22, e26–e30, Patrol 36, MG14 and MG50
 *    onto dry land);
 *  - `z_base` has no engine `onHeard` (the engine hears every explosion map-wide): scripts/m19.js replays the
 *    zone's hearing (shots, barks, cries heard by a man inside the base; explosions within 25 m of it), so the
 *    bridge charge alarms only the N bank, as in Prima;
 *  - the bridge charge is a script (scripts/m19.js): a bomb within 4 m of mid-span removes 9 m of deck (water
 *    again, swimmable), drowns anyone on it, breaks the track and fires the N-bank event RN; the mine cart
 *    (harmless rail, never stopped by the engine) turns back short of the break; the RN alert is held for good;
 *  - the rowboat's mooring notch is cut out of the current area (it would drift off before it is used); it
 *    lies in the shallows (the Marine boards, the others step in); once o1 is done and all are aboard it rows
 *    itself out to the N edge (the engine's scripted escape; ESC skips);
 *  - the tank crew and the lorry driver are vehicle crews (not map census men); the lorry driver's gate-sentry
 *    tailboard check (§14 #5, optional flavour: it would turn the post sentry e30 into a walker) and the barracks
 *    survivor (§14 #8) are left out. The lorry is no ride into the base: the briefing's "small truck" is the mine
 *    cart (dossier §14 #1), and BEL has no stowing away in an enemy-driven lorry; our briefing names the railway
 *    and the conveyor;
 *  - 15 isolated sentries, not Kildread's 13: Prima's own numbered post e35 (E fence) and the shore guard e51 seen
 *    on the fan map (NE shore) are both kept on purpose (the census test names them);
 *  - the plank palisade is opaque (scripts/m19.js sealPalisade: B.HIGH, not the see-through wire B.FENCE), so the
 *    guards inside never see the shore, the boat or a man outside [review: the boarding seen from the base]; a
 *    sniper's round, and any bullet at a barrel, still goes through the boards (`shotThrough`): Prima's Sniper
 *    shoots the caged dog from the S edge and ooc/fd fire the barrels by the rockets "through the fence";
 *  - the caged dog d3 (`quietBody`): its bark is a cue the guards investigate, not the siren [K]; shot unseen, its
 *    death and its body alarm nobody (Prima shoots it before the climb);
 *  - after a siren the base squads walk back into their barracks once it has been quiet for 120 s
 *    (scripts/m19.js squadsHome); the engine's squads would loop the drums corridor for good.
 */

import { m19Script, onNorthAlarm, ZONE_BASE } from './scripts/m19.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)

// ---------------------------------------------------------------- terrain (dossier §4.2)
/** T_river: the fast river, in on the W edge (z 82–104), out on the N edge (x 112–141). */
export const RIVER = [[0, 82], [10, 75], [25, 68], [45, 65], [55, 60], [60, 52], [64, 46], [68, 40], [72, 36], [78, 32], [84, 28],
  [90, 25], [96, 20], [100, 16], [106, 10], [110, 4], [112, 0], [141, 0], [138, 6], [133, 14], [126, 19], [118, 22], [112, 28],
  [105, 36], [97, 41], [90, 45], [84, 52], [78, 60], [72, 62], [68, 64], [60, 72], [52, 79], [45, 86], [30, 95], [20, 104], [0, 104]];
/** The current's area: the river minus the rowboat's mooring notch (x 123–131.5, z 13 → shore). */
export const CURRENT_AREA = [...RIVER.slice(0, 20), [131.5, 13], [123, 13], [122, 20.5], ...RIVER.slice(21)];
/** The mine railway (60 cm gauge): the adit → the carts → the trestle → the SE yard buffer. */
export const RAIL = [[5.5, 34], [26, 39.5], [50, 45.5], [57, 49.5], [80, 61], [95, 64.5]];
const ROAD_S = [[122, 104], [122.5, 82], [121, 72]];

const TERRAIN = [
  // frozen-grass patches: the N-bank fields, the SE bank W and S of the yard
  { type: 'poly', terrain: 'grass', points: [[45, 0], [110, 0], [100, 16], [84, 28], [60, 30], [45, 26]] },
  { type: 'poly', terrain: 'grass', points: [[20, 104], [30, 95], [45, 86], [60, 72], [72, 64], [85, 70], [95, 90], [95, 104]] },
  { type: 'poly', terrain: 'grass', points: [[124, 104], [138, 80], [151, 60], [151, 104]] },
  // coal-black mud round the mine, the carts and the SE yard
  { type: 'poly', terrain: 'mud', points: [[5, 20], [30, 26], [34, 44], [24, 50], [5, 48]] },
  { type: 'circle', terrain: 'mud', x: 90, z: 70, r: 8 },
  { type: 'path', terrain: 'road', width: 4, points: ROAD_S },
  { type: 'poly', terrain: 'water', points: RIVER }, // last: the patches above never paint over the river
];

// ---------------------------------------------------------------- structures (dossier §5)
const rock = (id, x, z, w, d, h = 2.5) => ({ id, type: 'rocks', variant: 'rock_temperate', x, z, rot: 0, w, d, h, block: 2 });
const tree = (x, z, k, pre = '') => ({ id: `tree_${pre}${k}`, type: k % 4 === 3 ? 'pine' : 'tree', variant: 'deciduous_bare', x, z, r: 0.4, h: 8 + (k % 3), seed: 1919 + k + (pre === 's' ? 50 : 0) }); // the S belt seeds apart from the N one (unique trees)
const coal = (id, x, z, r, h = 1.6) => ({ id, type: 'rocks', variant: 'coal_heap', x, z, rot: 0, w: 2 * r, d: 2 * r, h, mat: 'coal', block: 1 });
const cart = (id, x, z, variant = 'mine_cart_loaded') => ({ id, type: 'train_car', variant, x, z, rot: deg(22), w: 1.8, d: 1.2, h: 1.3, block: 1 });
const ruin = (id, points, h = 1.4, block = 1) => ({ id, type: 'wall', variant: 'ruin_wall', points, h, width: 0.8, mat: 'stone', block });
const bags = (id, x, z, rot, w) => ({ id, type: 'sandbags', x, z, rot: deg(rot), w, d: 0.8, h: 0.9 });
/** An MG nest: sandbags on three sides, open towards the rear (`back`, degrees). */
const nest = (id, x, z, back) => {
  const f = deg(back + 180), s = deg(back + 90);
  return [
    bags(`${id}_f`, x + Math.cos(f) * 1.8, z + Math.sin(f) * 1.8, back + 90, 3.2),
    bags(`${id}_l`, x + Math.cos(s) * 1.8, z + Math.sin(s) * 1.8, back, 2.4),
    bags(`${id}_r`, x - Math.cos(s) * 1.8, z - Math.sin(s) * 1.8, back, 2.4),
  ];
};
/** The plank palisade: impassable and opaque (scripts/m19.js sealPalisade); a rifle round, or any bullet at a barrel, goes through. */
const palisade = (id, points) => ({ id, type: 'fence', variant: 'palisade_plank', points, h: 3, width: 0.4, mat: 'planks', shotThrough: true });
const v2 = (id, x, z) => [
  { id, type: 'v2_rocket', variant: 'v2_pad_gantry', label: 'V2 rocket', x, z, r: 0.85, h: 14, destructible: true },
  { id: `${id}_pad`, type: 'launch_pad', variant: 'v2_firing_table', x, z, rot: 0, w: 6, d: 6, h: 0.4, block: 0 },
  { id: `${id}_gantry`, type: 'radio_mast', variant: 'v2_service_gantry', x: x + 2.4, z, rot: 0, w: 1.6, d: 1.6, h: 15, block: 2 },
];
const barrel = (id, x, z) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 });

/** §5.1 the N bank: the start, the tank shed, the bunker, the mine, the fields. */
const NORTH = [
  { id: 'office', type: 'barracks', variant: 'mining_office', label: 'Mining office', x: 6, z: 14, rot: 0, w: 12, d: 9, h: 9, mat: 'woodDark',
    flag: true, garrison: true, door: deg(0), destructible: true },
  { id: 'headframe', type: 'mine_building', variant: 'timber_adit', label: 'Pithead', x: 8.5, z: 31, rot: 0, w: 7, d: 10, h: 4.5, mat: 'planks',
    roofWalk: true, roofY: 4.5 },
  { id: 'cliff_w', type: 'cliff', variant: 'rock_face', points: [[0, 19], [5, 19], [5, 46], [0, 46]], h: 12 },
  { id: 'shed', type: 'tank_shed', variant: 'tank_shed_open', label: 'Tank shed', x: 28, z: 17.5, rot: 0, w: 11, d: 12, h: 5, open: 'S', smokestack: true },
  { id: 'tank_small', type: 'fueltank', variant: 'water_tower_legs_small', x: 20.5, z: 22, r: 1.2, h: 3, block: 2 },
  { id: 'bunker_n', type: 'bunker', variant: 'bunker_concrete_round', x: 43, z: 18.5, rot: 0, w: 5, d: 5, h: 2.5, mat: 'concrete', bunker: true },
  ...[[15, 35], [17, 35.8], [19, 36.6], [21, 37.4], [23, 38.2]].map(([x, z], k) => cart(`cart_n${k}`, x, z)),
  cart('cart_empty', 27, 40, 'mine_cart_empty'),
  coal('coal_n', 18, 45, 3),
  { id: 'crates_coal', type: 'crates', variant: 'coal_crates', x: 12.5, z: 44, rot: 0, w: 2, d: 3, h: 1, block: 1 },
  ruin('ruins_a', [[46, 33], [50, 33]]),
  ruin('ruins_b', [[51.5, 37], [61.9, 35]]),
  ruin('ruins_c', [[46, 41.5], [50, 41.5]]),
  ruin('ruins_d', [[52, 38.5], [54, 40.2]]),
  ruin('wall_L', [[62, 25], [65, 30], [71.5, 24.5]], 1.6, 2),
  ...nest('nest_14', 54.5, 55.5, 150),
  // rocks and trees (dossier §4.2)
  rock('rock_mound', 39, 9.25, 18, 7.5, 3), rock('rock_start_w', 33.5, 1.5, 3, 3), rock('rock_small', 20, 10, 2.5, 4),
  rock('rock_ne1', 53, 7, 6, 10), rock('rock_ne2', 75, 13, 6, 6), rock('rock_w1', 12, 52, 2.5, 2.5), rock('rock_w2', 16, 63, 2.5, 2),
  rock('rock_13', 37, 57, 3, 5), rock('rock_w3', 5, 77, 2.5, 2.5),
  ...[[61, 5], [64, 10], [67, 13], [69, 18], [78, 2], [82, 22], [100, 6], [24, 52], [31, 58], [3, 68]].map(([x, z], k) => tree(x, z, k, 'n')),
];

/** §5.2 the railway, the trestle, the SE yard outside the base. */
export const BRIDGE = { x: 68.5, z: 55.25, w: 25.7, d: 3, rot: 26.6 };
export const CONVEYOR = { a: [88.5, 81.5], b: [103.5, 70], exit: [105, 71.5] };
export const SWITCH = [100, 66.5];
const YARD = [
  { id: 'rail', type: 'rail_track', variant: 'mine_railway', points: RAIL, width: 1.2 },
  { id: 'bridge', type: 'rail_bridge', variant: 'rail_bridge_mine_low', label: 'Rail trestle', x: BRIDGE.x, z: BRIDGE.z, rot: deg(BRIDGE.rot),
    w: BRIDGE.w, d: BRIDGE.d, h: 1.5 },
  { id: 'buffer_se', type: 'crates', variant: 'rail_buffer', x: 96, z: 64.8, rot: deg(12), w: 1.5, d: 2, h: 1, block: 1 },
  { id: 'crane', type: 'radio_mast', variant: 'crane_tower_jib', x: 84.5, z: 65.5, rot: 0, w: 2.5, d: 2.5, h: 7, block: 2 },
  coal('coal_se', 90, 69.5, 2.5),
  { id: 'boiler', type: 'house', variant: 'boiler_house', label: 'Boiler house', x: 95.5, z: 52, rot: 0, w: 10, d: 11, h: 7, mat: 'brick',
    enterable: true, door: deg(90) },
  { id: 'chimney', type: 'minaret', variant: 'brick_chimney', x: 98, z: 49, r: 0.8, h: 14, mat: 'brick' },
  { id: 'hopper', type: 'hut', variant: 'coal_hopper', x: 86, z: 84, rot: 0, w: 4, d: 4, h: 5, mat: 'metalRust' },
  { id: 'conv', type: 'conveyor', variant: 'conveyor_incline', label: 'Coal conveyor', x: 96, z: 75.75, rot: Math.atan2(-11.5, 15), w: 18.9, d: 1.6, h: 3, block: 0 },
  coal('coal_w', 96, 80.5, 2, 1.4),
  { id: 'white_wall', type: 'wall', variant: 'whitewashed_concrete', points: [[101.5, 82.5], [101.5, 89.5]], width: 5, h: 3, mat: 'plaster', block: 2 },
  { id: 'crates_gate', type: 'crates', variant: 'crates_pile', x: 118, z: 86, rot: 0, w: 4, d: 5, h: 1.8, block: 2 },
  { id: 'wreck_car', type: 'ruins', variant: 'car_wreck_burnt', x: 133.5, z: 84, rot: deg(20), w: 4.5, d: 2.5, h: 1.4, mat: 'metalRust' },
  // the SE bank's rocky cliffs (Phase 3) and the yard rocks
  rock('rock_se1', 63, 85, 3, 2.5), rock('rock_se2', 71, 92, 3, 2), rock('rock_se3', 66, 96.5, 2.5, 2.5), rock('rock_se4', 78, 82, 3, 3),
  rock('rock_se5', 70, 75, 3, 2), rock('rock_se6', 42.5, 101.5, 5, 4), rock('rock_se7', 52, 84.5, 3, 2.5), rock('rock_se8', 81, 94, 3, 2.5),
  rock('rock_yard', 89.5, 89, 3, 2), rock('rock_s', 114, 97, 5, 6), rock('rock_ne', 141, 10, 8, 6),
  ...[[55, 98], [80, 99], [88, 99], [108, 93], [137, 88], [141, 94], [149, 82]].map(([x, z], k) => tree(x, z, k, 's')),
];

/** §5.3 the V2 base (the palisade; the W side straight at x 99 so the switch is inside) and its N shore. */
const BASE = [
  palisade('pal_w', [[99, 83], [99, 61], [103.5, 55], [107, 47], [113, 30]]),
  palisade('pal_n', [[113, 30], [151, 33]]),
  palisade('pal_s1', [[104, 86], [120, 82]]),
  palisade('pal_s2', [[124, 81], [137, 77], [143, 60], [151, 49]]),
  { id: 'gate_s', type: 'gate', variant: 'plank_double_gate', label: 'South gate', x: 122, z: 81.5, rot: Math.atan2(-1, 4), w: 4, h: 3, open: true },
  { id: 'sentry_box', type: 'hut', variant: 'sentry_box', x: 126.5, z: 78, rot: 0, w: 1.5, d: 1.5, h: 2.6, mat: 'planks' },
  ...v2('v2_w', 118, 40), ...v2('v2_m', 130, 37), ...v2('v2_e', 141, 47),
  { id: 'barr_n', type: 'barracks', variant: 'barracks_corrugated_gable', x: 134.5, z: 45, rot: 0, w: 8, d: 7, h: 5, mat: 'metal',
    flag: true, garrison: true, door: deg(180), destructible: true },
  { id: 'barr_s', type: 'barracks', variant: 'barracks_corrugated_gable', x: 131, z: 66, rot: 0, w: 12, d: 9, h: 6, mat: 'metal',
    flag: true, garrison: true, door: deg(180), destructible: true },
  { id: 'outhouse', type: 'hut', variant: 'outhouse', x: 137.5, z: 39.5, rot: 0, w: 1.5, d: 1.5, h: 2.5, mat: 'planks' },
  { id: 'tall_house', type: 'house', variant: 'house_tall_narrow_brick', x: 108.5, z: 54, rot: 0, w: 4, d: 5, h: 11, mat: 'brick',
    enterable: true, door: deg(90) },
  { id: 'hut_n', type: 'house', variant: 'hut_timber_bigroof', x: 115, z: 51, rot: 0, w: 9, d: 8, h: 5, mat: 'woodDark', enterable: true, door: deg(90) },
  { id: 'crates_n', type: 'crates', variant: 'crates_pile', x: 120, z: 57, rot: 0, w: 4, d: 3, h: 1.5, block: 1 },
  { id: 'drums_conv', type: 'fueltank', variant: 'oil_drums_stack', x: 102, z: 62, rot: 0, w: 2.5, d: 5, h: 2, block: 2 },
  { id: 'pen', type: 'prison_pen', variant: 'dog_kennel', label: 'Dog pen', x: 111.5, z: 74, rot: 0, w: 9, d: 10, h: 2, gateSide: 'W' },
  { id: 'pen_gate', type: 'gate', variant: 'plank_gate', x: 107, z: 74, rot: deg(90), w: 2.4, h: 2, locked: true },
  { id: 'kennel', type: 'hut', variant: 'dog_kennel_box', x: 114, z: 77, rot: 0, w: 1.6, d: 1.4, h: 1.2, mat: 'planks' },
  { id: 'wreck_ht', type: 'ruins', variant: 'tractor_wreck_burnt', x: 114.5, z: 63.5, rot: deg(30), w: 5, d: 3, h: 1.8, mat: 'metalRust', block: 2 },
  { id: 'crates_v2', type: 'crates', variant: 'crates_cable_drums', x: 124, z: 46.5, rot: 0, w: 3, d: 5, h: 1.2, block: 1 },
  { id: 'drum_rust', type: 'fueltank', variant: 'rusty_drum_upright', x: 116, z: 80, r: 1, h: 2, block: 2 },
  // the four movable barrels (§3.8 "4 barrels"), 6 m S of the watchtower, inside the N fence
  barrel('barrel_1', 123.5, 32.5), barrel('barrel_2', 124.6, 33.2), barrel('barrel_3', 123.8, 34.4), barrel('barrel_4', 125, 35),
  // the watchtower just outside the N fence: a bomb at its legs kills the gunner, the tower stays up
  { id: 'tower', type: 'watchtower', variant: 'watchtower_stilt', label: 'Watchtower', x: 121, z: 26.5, rot: 0, w: 3, d: 3, h: 8, deckY: 5.5 },
];

/** The two SE-bank MG nests ("near" e17, "far" e50). */
const NESTS = [...nest('nest_17', 58.5, 75.5, 120), ...nest('nest_50', 37, 99, 130)];

const STRUCTURES = [...NORTH, ...YARD, ...NESTS, ...BASE];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–36)
/** Lone walker: PINGPONG (or LOOP) over `pts` (1.0 m/s), starting at the first point facing the second. */
const walker = (id, prima, pts, type = 'PINGPONG') => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: pts[0].x, z: pts[0].z, heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x),
  flags: { investigates: true }, route: { type, vel: 1.0, points: pts },
});
/** Post guard: holds his post and investigates bodies only (§8 default). */
const sentry = (id, prima, x, z, h, sweep, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h), flags: { holdsPost: true, investigates: false },
  post: { heading: deg(h), sweep }, ...extra,
});
/** A patrol: sergeant `ids[0]` + troopers in pairs (`columns`) on one shared route. */
const patrol = (ids, prima, sq, points, columns = 1) => ids.map((id, k) => ({
  id, ...(prima ? { prima } : {}), soldierType: k ? 'trooper' : 'sergeant',
  x: points[0].x + (columns > 1 ? (k % 2) * 1.2 : 0), z: points[0].z + 1.2 * (columns > 1 ? Math.floor(k / 2) : k),
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: !k }, squad: { id: sq, leader: ids[0], columns },
  route: { type: 'PINGPONG', vel: 1.0, points },
}));
/** §4.1 a dog: heels 1.5 m behind its handler (the patrol sergeant); barks and bites. */
const dog = (id, handler, x, z) => ({ id, soldierType: 'dog', x, z, handler, flags: { investigates: true } });
/** Surveillance-bunker crew (M3 pattern): vision `bunker`, 40°, near 18 / far 36. */
const bunkerCrew = (id, structure, x, z, h, sweep) => ({
  id, soldierType: 'crew', x, z, heading: deg(h), structure, firesOnSight: true,
  vision: { fov: 40, near: 18, far: 36, sweep }, post: { heading: deg(h), sweep },
});
/** MG gunner at an emplacement (M4 pattern). */
const mg = (id, prima, x, z, h, sweep, gun) => ({ id, ...(prima ? { prima } : {}), soldierType: 'mg', x, z, heading: deg(h), emplacement: gun,
  post: { heading: deg(h), sweep, giro: 180 } });
/** A vehicle crewman (not in the census): rides `veh`. */
const crew = (id, veh, x, z, h, soldierType = 'crew') => ({ id, soldierType, x, z, heading: deg(h), vehicle: veh });

const MINE = [ // zones A–B (Prima Phase 1)
  walker('e1', 1, [P(26, 6.5, 4, 180), P(21.5, 13.2, 4, 90)]),
  walker('e2', 2, [P(15, 7, 5, 180), P(18, 3.5, 5, 0)]),
  sentry('e3', 3, 8.5, 28, 45, 90, { y: 4.5, elevated: true }),
  walker('e4', 4, [P(27, 25, 5, 0), P(36, 26.5, 5, 90)]),
  walker('e5', 5, [P(31, 31, 5, 180), P(41, 27.5, 5, 0)]),
  sentry('e6', 6, 20, 14.5, 90, 50),
  { ...sentry('e7', 7, 13, 24, 0, 60), idle: 'smoke' },
  sentry('e8', 8, 23.5, 33.5, 90, 50),
  walker('e9', 9, [P(22.5, 46.5, 4, 90), P(29, 41.5, 4, 0)]),
  sentry('e10', 10, 10.5, 38.5, 45, 60),
  walker('e11', 11, [P(13, 40, 4, 180), P(30, 36.5, 4, 0)]),
  bunkerCrew('e48', 'bunker_n', 43, 18.5, 90, 50),
];
const FIELDS = [ // zones C–D (Prima Phase 2)
  ...patrol(['e12', 'e54', 'e55', 'e56'], 12, 'p12', [P(6, 62, 8, 0), P(22, 64), P(34, 62.5, 6, 180)], 2),
  sentry('e13', 13, 33, 54.5, 200, 60),
  mg('e14', 14, 54.5, 55.5, 330, 50, 'mg14'),
  walker('e40', null, [P(51.5, 46, 5, 0), P(44, 44, 5, 180)]),
  walker('e37', null, [P(48.5, 22.5, 5, 90), P(50, 13.5, 5, 270)]),
  walker('e38', null, [P(60.5, 33, 8, 0), P(58, 29, 4, 90)]),
  walker('e39', null, [P(70.5, 21, 5, 90), P(80, 18, 5, 0)]),
  ...patrol(['e41', 'e42', 'e43'], null, 'pn3', [P(54, 21, 5, 0), P(68, 21.5), P(74, 31, 5, 90)]),
  ...patrol(['e44', 'e45', 'e46', 'e47'], null, 'pn4', [P(76, 30, 6, 45), P(86, 23.5), P(94, 15.5, 6, 90)], 2),
  dog('d2', 'e44', 74.5, 29),
];
const SW_BANK = [ // zone E (Prima Phase 3, the Marine alone)
  walker('e15', 15, [P(40, 95, 4, 0), P(50, 91, 4, 315)]),
  sentry('e16', 16, 53, 90, 270, 50),
  mg('e17', 17, 58.5, 75.5, 300, 50, 'mg17'),
  mg('e50', null, 37, 99, 310, 40, 'mg50'),
  ...patrol(['e18', 'e57'], 18, 'p18', [P(60, 90, 5, 0), P(66, 100, 5, 90)]),
  dog('d1', 'e18', 58.5, 89),
  walker('e19', 19, [P(68, 93.5, 10, 0), P(70, 95.5, 6, 0)]),
  walker('e49', null, [P(62, 82, 5, 270), P(64, 78, 5, 300)]),
];
const YARD_MEN = [ // zone F (Prima Phase 4)
  walker('e20', 20, [P(94, 66, 5, 270), P(92.5, 76, 5, 90)]),
  walker('e21', 21, [P(94, 85.5, 5, 180), P(84, 87.5, 5, 180)]),
  walker('e22', 22, [P(99, 91, 5, 180), P(112, 90.5, 5, 0)]),
];
const BASE_MEN = [ // zones G–H (Prima Phases 4–5)
  // the caged dog: barks only; shot through the pen rails, its death and body alarm nobody who did not see the shooter
  { id: 'd3', soldierType: 'dog', x: 111.5, z: 73, caged: true, quietBody: true, heading: deg(180), post: { heading: deg(180), sweep: 180 } },
  sentry('e24', 24, 102.5, 68, 0, 50),
  walker('e25', 25, [P(106, 66, 4, 270), P(105.5, 79, 5, 90)]),
  sentry('e26', 26, 118.5, 64.5, 90, 50),
  sentry('e27', 27, 122.5, 71, 180, 50),
  sentry('e28', 28, 122.5, 61, 180, 50),
  walker('e29', 29, [P(123, 58, 3), P(139, 58), P(136.5, 73.5, 3), P(123, 74)], 'LOOP'),
  sentry('e30', 30, 124.8, 79.2, 90, 60),
  walker('e31', 31, [P(110.5, 39, 5, 0), P(121, 44, 5, 180)]),
  walker('e32', 32, [P(128.5, 41, 5, 180), P(126, 52, 5, 90)]),
  sentry('e33', 33, 147, 37, 180, 60),
  walker('e34', 34, [P(135, 53, 5, 180), P(143, 53, 5, 0)]),
  sentry('e35', 35, 146, 63, 180, 50),
  // Patrol 36: on the siren it runs in through the S gate, then walks back out to its own beat [P]
  ...patrol(['e36', 'e58', 'e59', 'e60'], 36, 'p36', [P(130, 86, 10, 180), P(144, 79), P(148, 66, 8, 270)], 2)
    .map((e) => ({ ...e, reactEvents: ['RINT'], alarmRoute: { run: { x: 122, z: 74, vel: 2.7 }, resume: true } })),
  dog('d4', 'e36', 128.5, 86.5),
  sentry('e52', null, 121, 26.5, 100, 70, { y: 5.5, elevated: true, tower: 'tower' }),
  sentry('e51', null, 140, 18, 45, 50),
];
const CREWS = [crew('tk1_d', 'tk1', 28, 18.5, 90), crew('tk1_g', 'tk1', 28, 18.5, 90), crew('e53', 'lt', 122.5, 95, 270, 'truckDriver')];

const ENEMIES = [...MINE, ...FIELDS, ...SW_BANK, ...YARD_MEN, ...BASE_MEN, ...CREWS];

// ---------------------------------------------------------------- vehicles (dossier §6.1)
export const BOAT = { x: 127, z: 17.2 };
/** The mine cart's run on the rails: the SE yard end ↔ the mine (it crosses the trestle). */
const CART_TRACK = [[93, 64], [80, 61], [57, 49.5], [50, 45.5], [30, 40.5]];
const VEHICLES = [
  // the Panzer II "on alert" in the shed: parked, crewed, fires on what it sees; drives out on the N-bank alarm
  { id: 'tk1', vehicleType: 'panzer2', x: 28, z: 17.5, heading: deg(90), driveable: false, suspicious: false },
  // the mine cart: harmless rail, one seat; any commando may ride it across (passengers are unseen)
  { id: 'cart', vehicleType: 'mine_cart', label: 'Mine cart', x: CART_TRACK[0][0], z: CART_TRACK[0][1], heading: deg(191),
    track: CART_TRACK.map(([x, z]) => ({ x, z, wait: 0 })), schedule: { mode: 'pingpong', speed: 2.2, endWait: 25, delay: 30 } },
  // the escape rowboat, moored off the NE shore (only the Marine rows; four seats; downstream only)
  { id: 'boat', vehicleType: 'rowboat', label: 'Rowboat', x: BOAT.x, z: BOAT.z, heading: deg(315), seats: 4, operators: ['diver'], suspicious: false },
  // the three MG nests (no Driver in the team: nobody else can man them)
  { id: 'mg14', vehicleType: 'mgNest', x: 54.5, z: 55.5, heading: deg(330), gunner: 'e14', driveable: false },
  { id: 'mg17', vehicleType: 'mgNest', x: 58.5, z: 75.5, heading: deg(300), gunner: 'e17', driveable: false },
  { id: 'mg50', vehicleType: 'mgNest', x: 37, z: 99, heading: deg(310), gunner: 'e50', driveable: false },
  // the light lorry in and out of the S gate; its driver has no cone [fd]
  { id: 'lt', vehicleType: 'truck', variant: 'opel_blitz_open', x: 122.5, z: 95, heading: deg(270), driveable: false,
    route: { type: 'PINGPONG', speed: 3, points: [P(122.5, 95, 60), P(122.5, 82), P(121, 72, 30)] } },
];

// ---------------------------------------------------------------- commandos (§3.8 row 19, exact): prone behind the rock mound
const COMMANDOS = [
  { role: 'greenberet', x: 37.5, z: 2.5, heading: deg(90), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1 } },
  { role: 'sniper', x: 39, z: 1.5, heading: deg(90), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 7, firstAid: 6 } },
  { role: 'diver', x: 40.5, z: 2.5, heading: deg(90), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  { role: 'sapper', x: 42, z: 1.5, heading: deg(90), stance: 'crawl', inventory: { pistol: 1, bearTrap: 1, remoteBomb: 2 } },
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
const Z_N = [[28, 8], [60, 8], [60, 34], [28, 34]];
const squad = (event, exitRoute, loop) => ({ event, size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  office: { pool: 6, squads: [squad('RN', [P(16, 21.5), P(24, 28)], [P(24, 28), P(40, 32), P(52, 44)])] },
  barr_n: { pool: 6, squads: [squad('RINT', [P(126, 49)], [P(126, 49), P(113, 58), P(136, 55.5)])] },
  barr_s: { pool: 6, squads: [squad('RINT', [P(120, 68)], [P(120, 68), P(110, 62), P(118, 78.5), P(134, 75)])] },
};

const V2S = ['v2_w', 'v2_m', 'v2_e'];

export default {
  id: 'm19',
  campaign: 'BEL',
  title: 'Frustrate Retaliation',
  subtitle: 'A coal-mining works at Oldenburg, Germany · 12 January 1945',
  date: '1945-01-12',
  place: 'A small coal-mining works at Oldenburg, west of Bremen, Germany',
  theater: 'temperate',
  variant: 'frost',
  coneColors: 'green',
  size: [151, 104],
  seed: 1945_0112,
  briefing: {
    historical: 'January 1945. France is free, and the Red Army waits in the ruins of Warsaw with Berlin next on its list. Hitler has one card left to play: the V2. The rockets are already falling on London, and nothing can stop one once it is in the air. A reconnaissance flight has found a launch site hidden inside a small mining works at Oldenburg, west of Bremen.',
    text: 'You go in from the north edge, officer, and the job is simple to say: those three launch pads must never fire again. Mind the river. It runs so fast that nobody rows against it, so think about where you cross. The mine railway and the coal conveyor both lead into the base; either could get you inside. When the rockets are gone, get everybody to the boat by the north-east shore and let the current carry you out.',
    objectivesSummary: 'Destroy the three V2 rockets on their launch pads, then escape downstream in the rowboat.',
    hints: [
      'Three rockets on three pads. All of them must go.',
      'The mine cart and the coal conveyor both lead into the base. The cart has room for one.',
      'Once everybody is across the bridge, a charge in the middle of it keeps the north bank out of the fight.',
      'Dogs bark at anything they see, and a barking dog brings soldiers. The one in the pen cannot come out, but it can still give you away.',
      'The river is fast. A boat will only go downstream; a swimmer can fight the current, slowly.',
      'The conveyor switch has a flashing red lamp. Thrown, the belt runs into the base and carries a man lying on it.',
      'The boat is moored below the base, by the north-east shore, under the watchtower. Do not lose it: it is the only way out.',
      'Nobody sees through the plank fence, but a rifle round goes through the boards. A fuel barrel set beside a rocket can be fired from outside.',
    ],
  },
  lighting: { sunElevDeg: 14, sunAzimuthDeg: 315, kelvin: 6800, hdri: 'overcast', fog: 180, lut: 'temperate_frost' },
  water: { velocity: 1.6, angleDeg: 315, turbulence: 0.6, color: '#1d5a5c' },
  baseTerrain: 'ground',
  terrain: TERRAIN,
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['hopper', 'conv'], ['v2_e_pad', 'barr_n'], ['tall_house', 'hut_n'], ['pen', 'kennel']]),
  items: [],
  interactables: [],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // RN: anything seen near the N bunker (a silent N-bank alarm: the tank and the office squad). The base's
  // hearing is replayed by scripts/m19.js (explosions only within 25 m), so `onHeard` stays null here.
  zones: [
    { id: 'z_n', poly: Z_N, onSeen: 'RN', onHeard: null },
    { id: 'z_base', poly: ZONE_BASE, onSeen: 'RINT', onHeard: null, siren: true },
  ],
  jails: [],
  barracks: BARRACKS,
  climbLinks: [
    { id: 'climb_white_wall', a: [101.5, 91, 0], b: [101.5, 81.5, 0], roles: ['greenberet'] },
    { id: 'climb_switch', a: [97.5, 65.5, 0], b: [100.5, 65.5, 0], roles: ['greenberet'] },
  ],
  ladders: [{ id: 'ld_pithead', x: 8.5, z: 25, y: 0, top: [8.5, 27.5, 4.5], raised: false, heading: deg(90) }],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the three V2 rockets on their launch pads', type: 'destroy', targets: V2S, required: true },
    { id: 'o2', text: 'Then everyone into the rowboat and out downstream by the north edge', type: 'escape', required: true, vehicleId: 'boat' },
  ],
  setpieces: [
    // the fast river: boats may not be ordered upstream; idle boats and swimmers drift NE (the mooring is exempt)
    { type: 'current', id: 'river', area: { poly: CURRENT_AREA }, velocity: 1.6, angleDeg: 315, noUpstream: true, drift: true },
    // the mine railway: damaged track (the bridge charge) stops the cart short of it
    { type: 'rail_line', id: 'mine_rail', track: RAIL, width: 1.2, stopBy: ['bomb', 'barrel'], blockR: 4 },
    // the watchtower: a bomb at its legs kills the gunner; the tower stays standing (barrels do nothing)
    { type: 'collapse', id: 'tower_blow', at: [121, 28.5], r: 3.5, by: ['bomb'], kill: { x: 121, z: 26.5, r: 2.2 },
      message: 'The watchtower gunner is dead.' },
    // the coal conveyor: runs out of the base at the start; its switch (flashing red lamp) reverses it
    { type: 'conveyor', id: 'belt', points: [CONVEYOR.a, CONVEYOR.b], width: 1.6, speed: 1.2, dir: -1, carries: 'crawl',
      exit: CONVEYOR.exit, switch: { at: SWITCH, id: 'conv_switch', blink: true } },
  ],
  triggers: [
    { on: 'start', do: [{ message: 'The river runs fast to the north-east. A boat will only go downstream.', kind: 'info' }] },
    { on: 'device', match: { id: 'conv_switch' }, do: [{ message: 'The belt now runs into the base. Lie on it to ride in.', kind: 'info' }] },
    // T3: the N-bank alarm (zone z_n or the bridge charge): the tank sorties, the N bank goes on alert, no siren
    { on: 'alarm:zone', match: { event: 'RN' }, do: [{ message: 'Alarm on the north bank!', kind: 'warn' }, { run: (w) => onNorthAlarm(w) }] },
    // T4/T5: the rockets
    { on: 'structure:destroyed', match: { id: V2S }, once: false,
      do: [{ run: (w) => { const n = V2S.filter((id) => w.byId(id)?.destroyed).length; if (n < 3) w.events.emit('message', { text: `${n} of 3 rockets destroyed.`, kind: 'info' }); } }] },
    { on: 'objective', match: { id: 'o1', status: 'done' }, do: [{ message: 'The launch site is finished. Everyone to the boat.', kind: 'objective' }] },
    // T6: the boat before the rockets
    { on: 'area', area: { x: BOAT.x, z: BOAT.z + 3, r: 4 }, who: 'commando', when: (_p, w) => !w.objectives?.find((o) => o.id === 'o1')?.done,
      do: [{ message: 'The boat. Keep it for the way out.', kind: 'info' }] },
    // §8.1: losing the boat loses the way out
    { on: 'vehicle:destroyed', match: { vehicle: 'boat' }, do: [{ fail: 'THE BOAT HAS BEEN DESTROYED. WITHOUT IT THERE IS NO WAY OUT.' }] },
  ],
  // mission glue: the prone start, the bridge charge, the base's hearing (explosions within 25 m only)
  script: m19Script,
  // the rowboat is on the map: once o1 is done and everyone is aboard, it goes out by the N edge (ESC skips)
  extraction: {
    vehicleId: 'boat', spawnAt: { x: BOAT.x, z: BOAT.z, heading: deg(315) }, spawnWhen: ['o1'],
    exit: { x: 124, z: 1, r: 6 }, leave: { x: 124, z: -10, speed: 3 },
  },
  alarmFail: null,
  par: { time: 840 },
  cameraStart: { x: 40, z: 14, zoom: 1 },
  startDisguised: [],
  flags: { shovel: false },
};
