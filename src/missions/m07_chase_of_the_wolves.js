/**
 * BEL Mission 7 — "Chase of the Wolves" (buildable layout: docs/missions/m07.md). Owned by MISSIONS.
 * Arendal harbour, southern Norway, 7 February 1942. Snow, overcast, a calm harbour. Two U-boats lie at the
 * open finger pier of the W naval base; the pier is an island, so the Sapper can only reach it by boat. The
 * team lands in two parties: the Sapper, Driver and Spy N of the W base's wall, the Green Beret and Marine on
 * the NE heights above the Norwegian fishing village. The charges (4 time bombs) are in an air-drop crate by
 * the NW hangar; the rowboat is moored in the village marina. Sink both boats with a charge on the after deck
 * by the spare torpedoes (markers `u1_charge`, `u2_charge`), then row everyone to the red buoy in the SE.
 * Two alarm zones (dossier §9): `z_w` W of the middle wall (seen → RINT + siren; noise → investigators only)
 * and `z_vil` (seen or heard → silent RVIL, the village barracks empties). Blowing either 210 mm gun raises
 * `z_w` (T1); losing the rowboat is a loss (T4).
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep`
 * stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit, see the commit message): decks sit at water level (flat map, as the
 * M3 dam crest), so the float ladder is not needed and the rowboat unloads straight onto the pier; the
 * U-boats are `battleship` extra props (variant `uboat_docked`) so their explosive target sits on the
 * torpedo stack (`targetAt`); U-boat 2 moves 1.8 m NE to lie flush against the pier; the gate piers are
 * stretched so `gate_n` is the only 2 m opening; the N ridge is closed against the N crags (the 2 m slot at
 * (54,11) would have joined the two parties by land); the rowboat moves 1.5 m off the jetty tip.
 */

import { UBOATS, hullPoint, nearUboatHull, inMarker, afloat, chargesLeft, spawnVillageOfficer } from './scripts/m07.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain reads wp.look * DEG)

/** Rect pier/jetty between two points (width `w`): centre, length, rotation. */
const span = (id, a, b, width, extra = {}) => ({
  id, type: 'pier', x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(2),
  d: width, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), ...extra,
});

/** Torpedo-stack demolition markers (dossier §10), on each hull's after deck. */
const U1 = hullPoint(UBOATS.uboat_1, UBOATS.uboat_1.torpX);
const U2 = hullPoint(UBOATS.uboat_2, UBOATS.uboat_2.torpX);

/**
 * A moored U-boat: a walkable deck at water level (`deck:true`: bridge cells) whose explosive target is the
 * torpedo stack on the after deck. `removeCrest` sinks the deck (its cells become deep water) when it goes.
 */
const uboat = (id) => {
  const b = UBOATS[id];
  return {
    id, type: 'battleship', variant: 'uboat_docked', label: 'U-boat', x: b.x, z: b.z, rot: deg(b.rot), w: b.w, d: b.d, h: 5, deck: true, deckY: 1.2,
    destructible: true, bombOnly: true, targetAt: [b.torpX, 0], marker: b.marker, hp: 100,
    destroyFx: ['explode', 'removeCrest', 'sinkStern'], torpedoStack: true,
  };
};
/** The conning tower (`uboat_tower`): B.HIGH, it stays above water when the hull settles. */
const tower = (id, b) => ({ id, type: 'uboat_tower', variant: 'uboat_conning_tower', ...hullPoint(b, 2), rot: deg(b.rot), w: 5, d: 2.4, h: 4, mat: 'greyPaint', block: 2 });

/** Fieldstone wall with a barbed-wire coping (not climbable). */
const wall = (id, points, extra = {}) => ({ id, type: 'wall', variant: 'wall_stone_zigzag', mat: 'stone', points, h: 3, width: 0.6, ...extra });
/** Norwegian timber house (enterable; `door` = the standing point outside its door). */
const house = (id, x, z, w, d, h, door, variant = 'house_norse_fishing') =>
  ({ id, type: 'house', variant, x, z, rot: 0, w, d, h, mat: 'woodDark', snowRoof: true, enterable: true, door });
const pine = (x, z, k) => ({ type: 'pine', x, z, r: 0.5, h: 9 + (k % 6), seed: 701 + k });
const ruin = (id, x, z, w = 5, d = 4) => ({ id, type: 'ruins', variant: 'burned_timber', x, z, rot: 0, w, d, h: 3, block: 1 });
const boat = (id, x, z, rot, variant = 'boat_moored', block = 2) => ({ id, type: 'crates', variant, x, z, rot: deg(rot), w: variant === 'boat_moored' ? 9 : 4, d: variant === 'boat_moored' ? 3 : 1.8, h: 1.4, block });

// ---------------------------------------------------------------- terrain (dossier §4)
/** T6 the harbour: the quay face (0,102)→(49.5,146.7), the lighthouse mole's notch, the pebble beach E. */
const HARBOUR = [[0, 102], [49.5, 146.7], [57, 148], [60, 160], [64, 176], [70, 184.5], [78, 185.5], [84, 180], [84, 160], [82, 150],
  [89.4, 135.2], [108.7, 127.3], [131.4, 111.6], [144, 107.7], [144, 195], [0, 195]];
const TERRAIN = [
  // T9 ruins field and T10 village streets (trodden: footprints do not show)
  { type: 'poly', terrain: 'ground', points: [[64, 94], [100, 92], [102, 112], [92, 125], [70, 128], [62, 112]] },
  { type: 'poly', terrain: 'ground', points: [[94, 60], [144, 58], [144, 106], [131, 111], [110, 120], [94, 100]] },
  // T8 the swept quay strip inside the dock (4 m wide along the quay face)
  { type: 'path', terrain: 'road', points: [[1.3, 100.5], [50.8, 145.2]], width: 4 },
  // T6 harbour, T7 the small W inlet (water last: it wins over the land polys)
  { type: 'poly', terrain: 'water', points: HARBOUR },
  { type: 'poly', terrain: 'water', points: [[0, 54], [3, 56], [3, 68], [0, 70]] },
  // T11 the slipway: the rails run down into the water here (group A's pick-up point)
  { type: 'poly', terrain: 'shallow', points: [[6, 102], [13, 108.5], [9.7, 113.4], [3.7, 108]] },
];

// ---------------------------------------------------------------- structures (dossier §5)
const cliff = (id, points) => ({ id, type: 'cliff', variant: 'coastal_granite_snow', points, h: 8 });
const CLIFFS = [
  cliff('cliff_n', [[36, 0], [56, 0], [54, 10], [48, 17], [40, 16], [36, 8]]),
  // the N ridge: its W end overlaps the N crags so the slot at (54,11) is shut (the parties meet only by boat)
  cliff('ridge_n', [[53, 8], [72, 8], [88, 10], [100, 12], [101, 18], [96, 24], [84, 30], [74, 32], [70, 40], [67, 49], [62, 50], [56, 47], [60, 36], [56, 26], [53, 14]]),
  cliff('spur_ne', [[109, 13], [112, 13], [123, 34], [121, 39], [117, 36]]),
  cliff('crags_e', [[113, 40], [121, 37], [129, 27], [144, 26], [144, 50], [137, 54], [130, 58], [124, 66], [118, 66], [114, 56]]),
];

const BUILDINGS = [
  { id: 'hangar_nw', type: 'hangar', variant: 'quonset_hangar', x: 19, z: 26, rot: 0, w: 16, d: 11, h: 7 },
  house('hut_gate', 22, 56.5, 10, 6, 4, [18.5, 52.5], 'barracks_rendered_hip'),
  // the three garrisons (Kildread's "3 Bunkers"); a bomb or a barrel empties them for good (§4.9)
  { id: 'barr_dock', type: 'barracks', variant: 'barracks_rendered_hip', x: 10.5, z: 77, rot: 0, w: 11, d: 8, h: 6, mat: 'plaster',
    flag: true, garrison: true, destructible: true, hp: 100, door: Math.PI / 2 },
  { id: 'barr_mid', type: 'barracks', variant: 'barracks_rendered_hip', x: 65.2, z: 81.5, rot: 0, w: 11, d: 9, h: 6, mat: 'plaster',
    flag: true, garrison: true, destructible: true, hp: 100, door: -Math.PI / 2 },
  { id: 'barr_vil', type: 'barracks', variant: 'house_norse_fishing', x: 134.8, z: 83.5, rot: 0, w: 8, d: 9, h: 6, mat: 'woodDark',
    flag: true, banners: true, garrison: true, destructible: true, hp: 100, door: Math.PI },
  house('house_mid', 50.4, 73.5, 11, 9, 6, [50.4, 78.8], 'barracks_rendered_hip'),
  // the timber gantry over the slip rails: two portals (B.HIGH posts), open between them; the square posts stand
  // square to w_inner (41.7°) beside it
  ...[[-5, -3], [-5, 3], [5, -3], [5, 3]].map(([lx, lz], k) => {
    const c = Math.cos(deg(35)), s = Math.sin(deg(35));
    return { id: `gantry_post_${k + 1}`, type: 'bunker', variant: 'gantry_timber', x: +(34 + lx * c - lz * s).toFixed(2), z: +(84 + lx * s + lz * c).toFixed(2), rot: deg(41.7), w: 0.8, d: 0.8, h: 6, mat: 'woodDark', block: 2 };
  }),
  // the village (tarred / red-painted timber, all enterable)
  house('h_big', 107, 62.5, 13, 22, 8, [99.8, 66]),
  house('h_1', 114, 74, 8, 10, 6, [114, 79.8]),
  house('h_2', 124.5, 72.5, 7, 8, 6, [124.5, 77.3]),
  house('h_3', 118.5, 88.5, 7, 10, 6, [114.3, 88.5]),
  house('h_4', 99.5, 86, 9, 17, 8, [104.8, 88]),
  house('h_5', 127, 97, 12, 10, 8, [127, 91.3]),
  house('h_6', 100.5, 99, 8, 7, 5, [100.5, 103.3]),
  { id: 'boathouse', type: 'house', variant: 'boathouse', x: 137, z: 111, rot: deg(20), w: 8, d: 12, h: 6, mat: 'woodDark', snowRoof: true },
  ruin('ruin_1', 88.8, 90), ruin('ruin_2', 82.4, 106), ruin('ruin_3', 89.5, 110), ruin('ruin_4', 88, 118), ruin('ruin_5', 70.8, 123), ruin('ruin_6', 133, 67),
  { id: 'racks_e', type: 'ruins', variant: 'fish_drying_racks', x: 142.5, z: 77, rot: 0, w: 3, d: 26, h: 4, block: 1 },
  { id: 'lighthouse', type: 'lighthouse', variant: 'lighthouse_small', x: 76.5, z: 171, r: 2.5, h: 16, mat: 'plaster' },
];

/** The dock: finger pier (an island), gangways, the two U-boats, rails, crane, gun pits; the marina jetties. */
const WATERSIDE = [
  // the granite quay face (the T8 strip is its land side): iron bollards every 6 m, decor only (no block)
  ...Array.from({ length: 11 }, (_, k) => ({ id: `quay_bollard_${k + 1}`, type: 'sign', variant: 'quay_granite_bollard', x: +(2.2 + k * 4.45).toFixed(2), z: +(102.4 + k * 4.02).toFixed(2), r: 0.2, h: 0.6, block: 0 })),
  span('pier', [0, 126], [35, 158.5], 8, { variant: 'uboat_pen_open' }),
  span('float', [36, 162.5], [39, 165.5], 3, { variant: 'timber_float' }),
  span('gw_1', [19.2, 131.1], [14.8, 135.9], 1.5, { variant: 'steel_gangway' }),
  span('gw_2', [24.2, 136.1], [19.8, 140.9], 1.5, { variant: 'steel_gangway' }),
  uboat('uboat_1'), uboat('uboat_2'),
  tower('uboat_1_tower', UBOATS.uboat_1), tower('uboat_2_tower', UBOATS.uboat_2),
  { id: 'slip_rails', type: 'rail_track', points: [[41, 81.6], [30, 89], [18, 100], [7.5, 112], [5, 116]] },
  { id: 'crane_dock', type: 'bunker', variant: 'crane_dock_portal', x: 36, z: 112, rot: deg(45), w: 1.2, d: 1.2, h: 12, mat: 'metalRust', block: 2 },
  { id: 'gun22_pit', type: 'sandbags', variant: 'gun_pit_open', x: 5, z: 93, rot: deg(120), ring: { r: 3, arc: 300 }, h: 0.8, block: 1 },
  { id: 'gun23_pit', type: 'sandbags', variant: 'gun_pit_open', x: 47, z: 139, rot: deg(110), ring: { r: 3, arc: 300 }, h: 0.8, block: 1 },
  span('jetty_w', [115, 121], [124, 131], 2.5, { variant: 'marina_jetties' }),
  span('jetty_e1', [138, 117], [138, 126], 3, { variant: 'marina_jetties' }),
  span('jetty_e2', [138, 126], [132, 135], 3, { variant: 'marina_jetties' }),
  { id: 'buoy', type: 'sign', variant: 'buoy_red', x: 140, z: 180, r: 0.6, h: 1.5, block: 0 },
  // 15 moored fishing boats (obstacles on the water, they break sight across the marina)
  ...[[96, 138, 60], [107, 136.5, 55], [116, 131, 65], [117, 138, 50], [131.4, 122, 70], [142, 121, 90], [133, 141, 60], [138, 138, 55],
    [121, 147, 60], [133, 147, 65], [111, 157.5, 55], [141, 160, 70], [136.5, 168, 50], [114.6, 179.7, 60], [132, 187, 65]]
    .map(([x, z, r], k) => boat(`boat_m${k + 1}`, x, z, r)),
  // 14 hauled-up boats and dinghies on the beach and in the ruins field (low cover)
  ...[[74, 126], [78, 124], [80, 133], [86, 131], [73, 135], [89, 127], [94, 118], [97, 121], [99, 115], [104, 114], [110, 107], [118, 107], [120, 110], [123, 106]]
    .map(([x, z], k) => boat(`boat_b${k + 1}`, x, z, k === 0 || k === 4 ? 37 : 30 + 25 * (k % 4), 'boat_beached', 1)), // b1/b5 lie along w_salient
];

/** Walls and gates (dossier §5.3): fieldstone, 3 m, barbed-wire coping, not climbable. */
const WALLS = [
  wall('w_outer', [[0, 40.7], [20, 58.3], [27.7, 65.4]]),
  wall('w_west', [[0, 77.7], [20, 60.6]]),
  // the gate into the dockyard: 2 m, timber leaves open. Too narrow for the half-track
  { id: 'gate_n', type: 'gate', variant: 'gate_stone_piers_timber', x: 28.5, z: 66, rot: deg(40), w: 2.0, h: 3, open: true },
  // the runs end at the gates' piers: joined (clipAllow), not cut back by the library gate's swung leaves
  wall('w_inner', [[29.04, 66.47], [60.5, 94.5]], { clipAllow: ['gate_n'] }),
  wall('w_ne', [[61.8, 48], [72.4, 56.8]]),
  wall('w_ne2', [[74.33, 58.19], [88.5, 69.5]], { clipAllow: ['gate_ne'] }),
  // NE gate: arched double doors, shut and locked (no source uses it)
  { id: 'gate_ne', type: 'gate', variant: 'gate_arched_double', x: 73.5, z: 57.6, rot: deg(38), w: 2.6, h: 3, locked: true },
  { id: 'barrier_ne', type: 'crates', variant: 'barrier_timber', x: 76, z: 58.5, rot: deg(38), w: 2.5, d: 0.4, h: 1.1, block: 1 },
  // the middle wall: it splits the alarm zones
  wall('w_middle', [[88.5, 69.5], [60.5, 94.5], [42.6, 111.5]]),
  wall('w_salient', [[42.6, 111.5], [64.6, 128], [49.5, 145.5]]),
  // low rocks in the shallows off the wall's S end: nobody wades round it, but gun 23 sees the pen water over them
  { id: 'rocks_salient', type: 'rocks', points: [[48.7, 145], [50.3, 145], [50.5, 150.5], [48.5, 150.5]], h: 0.7, block: 1 },
];

/** Props (dossier §5.4). */
const PROPS = [
  // the two fuel drums N of the village barracks (both have a scripted use: barracks + patrol 8, patrol 12)
  { id: 'barrel_1', type: 'barrels', variant: 'fuel_explosive', x: 131, z: 60.5, explosive: 'barrel', carriable: true },
  { id: 'barrel_2', type: 'barrels', variant: 'fuel_explosive', x: 133, z: 61.5, explosive: 'barrel', carriable: true },
  // the Gatling nest in the middle pocket's E corner (open behind the gunner)
  { id: 'mg_ne_nest', type: 'sandbags', variant: 'mg_nest_sandbag', x: 74.5, z: 68.5, rot: deg(200), ring: { r: 1.8 }, h: 1.0, block: 1 },
  // air-drop crate under a draped parachute (the charges), crate stacks
  { id: 'airdrop', type: 'crates', variant: 'airdrop_crate', x: 15, z: 4.5, rot: 0, w: 1.2, d: 1.2, h: 1.0, block: 0 },
  { id: 'parachute', type: 'sign', variant: 'parachute_draped', x: 12, z: 7.8, r: 0.5, h: 3, block: 0 },
  ...[[20, 95], [38, 116], [47, 60]].map(([x, z], k) => ({ id: `crates_${k + 1}`, type: 'crates', x, z, rot: 0, w: 2, d: 2, h: 1.2, block: 1 })),
  // the hedgehog in the crag gap
  { id: 'hedgehog_n', type: 'crates', variant: 'czech_hedgehog', x: 46, z: 23, rot: deg(45), w: 1.4, d: 1.4, h: 1.2, block: 1 },
  // rocks: the start rock that hides group B, two boulders, the low chain E of it, the mole rim
  { id: 'rock_start', type: 'rocks', points: [[100.5, 28], [107.5, 27], [107.5, 36], [101, 36.5]], h: 3, block: 2 },
  { id: 'rock_nw', type: 'rocks', x: 29.5, z: 10.6, r: 2.5, h: 2.4 },
  { id: 'rock_pocket', type: 'rocks', x: 47, z: 53.5, r: 2.8, h: 2.4 },
  ...[[114, 36], [116.5, 37], [119, 38]].map(([x, z], k) => ({ id: `rock_chain_${k + 1}`, type: 'rocks', x, z, r: 1.2, h: 1, block: 1 })),
  ...[[59, 150], [62, 162], [66, 176], [72, 182.5], [79.5, 181.5], [83, 168], [83, 155]]
    .map(([x, z], k) => ({ id: `rock_mole_${k + 1}`, type: 'rocks', x, z, r: 1.3, h: 0.9, block: 1 })),
  // pines, h 9–14; (59,108) is "the tree near the little corner of the wall"
  ...[[7, 5.5], [12, 7], [3, 17], [29.5, 4.5], [20, 41.5], [25.5, 44.8], [8.6, 61.6], [45, 32.5], [51.4, 42.5], [59, 4.5], [71.5, 42], [73, 39],
    [87, 48], [89.5, 44], [86.7, 51], [92.5, 58], [103.5, 20], [54.8, 86], [79, 65.5], [79, 90], [55.4, 110], [59, 108], [64.4, 133],
    [122.5, 45], [129.5, 18], [133.5, 12], [136.5, 23], [140, 52]].map(([x, z], k) => pine(x, z, k)),
];

const STRUCTURES = [...CLIFFS, ...BUILDINGS, ...WATERSIDE, ...WALLS, ...PROPS];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers 1–23)
/** Lone walker: PINGPONG between a and b (1.0 m/s), starting at a facing b. */
const walker = (id, prima, a, b, flags = {}, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
  flags: { investigates: true, ...flags }, route: { type: 'PINGPONG', vel: 1.0, points: [a, b] }, ...extra,
});
/** Post guard: `holds` = returns to his post after a look (holdsPost), else he investigates. */
const sentry = (id, prima, x, z, h, sweep, { holds = true, investigates = !holds, tracks = false } = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h),
  flags: { holdsPost: holds, investigates, ...(tracks ? { followsTracks: true } : {}) }, post: { heading: deg(h), sweep },
});
/**
 * Patrol squad: sergeant + troopers in file behind him (1.5 m apart, back along the first leg). `route` is the
 * shared PINGPONG; `extra` adds reactEvents/alarmRoute for the patrols the base siren sends to the dock.
 */
const patrol = (sq, prima, n, route, columns = 1, flags = {}, extra = {}) => {
  const [a, b] = route;
  const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  return Array.from({ length: n }, (_, k) => {
    const row = Math.floor(k / columns), col = k % columns - (columns - 1) / 2;
    return {
      id: `${sq}${'abcde'[k]}`, prima, soldierType: k ? 'trooper' : 'sergeant',
      x: +(a.x - ux * 1.5 * row - uz * 1.2 * col).toFixed(2), z: +(a.z - uz * 1.5 * row + ux * 1.2 * col).toFixed(2), heading: Math.atan2(uz, ux),
      flags: { investigates: true, ...flags }, squad: { id: sq, leader: `${sq}a`, columns },
      route: { type: 'PINGPONG', vel: 1.0, points: route }, ...extra,
    };
  });
};

const DOCK_LOOP = [P(16, 88), P(28, 97), P(44, 126), P(30, 114), P(14, 104)];
const POCKET_LOOP = [P(34, 60), P(57, 66), P(74, 73), P(57, 66)];

const ENEMIES = [
  // ===== the NE heights (group B, Phase 1; outside every zone)
  walker('e1', 1, P(99, 38.5, 3, 180), P(109.5, 31, 3, 270), { followsTracks: true }),
  walker('e2', 2, P(95, 49, 3, 180), P(110, 46, 3, 0), { followsTracks: true }),
  ...patrol('p3', 3, 2, [P(84, 43, 4, 180), P(102, 38, 4, 0)]),

  // ===== the village (Phase 2; z_vil unless stated)
  sentry('e4', 4, 98, 64, 150, 50, { holds: true, investigates: true, tracks: true }),
  walker('e5', 5, P(95, 71, 3, 180), P(107, 76.5, 3, 0)),
  walker('e6', 6, P(91, 82, 3, 270), P(92, 95, 3, 90)),
  ...patrol('p8', 8, 2, [P(106, 81.5, 4, 180), P(128.5, 81, 4, 0)]),
  { id: 'e7', prima: 7, soldierType: 'soldier', x: 129.5, z: 77.5, heading: deg(0), flags: { investigates: true },
    route: { type: 'LOOP', vel: 1.0, points: [P(129.5, 77.5), P(140, 77.5, 2, 0), P(140, 90), P(129.5, 90, 2, 180)] } },
  sentry('e9', 9, 135, 103, 200, 40, { holds: true, investigates: true }),
  ...patrol('p10', 10, 2, [P(100, 118, 4, 180), P(126, 108, 4, 0)]),
  sentry('e11', 11, 117, 123, 45, 40),

  // ===== the lighthouse mole (outside every zone): N stop 3.5 m outside w_salient, S stop at the lighthouse
  ...patrol('p12', 12, 3, [P(59.5, 138.5, 5, 180), P(61, 150), P(71, 165, 5, 90)]),

  // ===== the NW corner (crate patrol, outside z_w) and the middle pocket (z_w)
  ...patrol('p14', 14, 3, [P(8, 16, 4, 270), P(36, 12, 4, 0)], 1, { followsTracks: true }),
  ...patrol('p13', 13, 3, [P(34, 60, 4, 180), P(57, 66), P(74, 73, 4, 0)], 1, {}, {
    jail: 'barr_mid', reactEvents: ['RINT'],
    alarmRoute: { run: { x: 57, z: 66, vel: 3 }, loop: { type: 'PINGPONG', vel: 1.0, points: POCKET_LOOP.slice(0, 3) } },
  }),
  walker('e10', null, P(60, 55, 3, 180), P(70, 60, 3, 45)),
  { id: 'e_mg', soldierType: 'mg', x: 74.5, z: 68.5, heading: deg(200), emplacement: 'mg_ne', post: { heading: deg(200), sweep: 50, giro: 180 } },

  // ===== the dock (Phase 4; z_w)
  walker('e15', 15, P(21, 69.5, 3, 0), P(17, 86, 3, 180)),
  walker('e16', 16, P(25, 78, 3, 270), P(24, 90, 3, 90)),
  walker('e17', 17, P(54.5, 97, 3, 315), P(43.5, 107, 3, 225)),
  sentry('e18', 18, 29.5, 93.5, 90, 40),
  sentry('e19', 19, 39.5, 89.5, 60, 40),
  walker('e20', 20, P(12, 110, 3, 135), P(30, 118, 3, 0)),
  ...patrol('p21', 21, 5, [P(14, 96, 5, 180), P(32, 103), P(46, 128, 5, 90)], 2, {}, {
    jail: 'barr_dock', reactEvents: ['RINT'],
    alarmRoute: { run: { x: 28, z: 97, vel: 3 }, loop: { type: 'LOOP', vel: 1.0, points: DOCK_LOOP } },
  }),
  // the two 210 mm gunners: one shot kills any commando-driven vehicle they see
  { id: 'g22', prima: 22, soldierType: 'gunner', x: 5, z: 93, heading: deg(120), emplacement: 'gun22', post: { heading: deg(120), sweep: 20, giro: 110 } },
  { id: 'g23', prima: 23, soldierType: 'gunner', x: 47, z: 139, heading: deg(110), emplacement: 'gun23', post: { heading: deg(110), sweep: 20, giro: 110 } },
];

// ---------------------------------------------------------------- vehicles (dossier §8.6)
const VEHICLES = [
  // the vacant SdKfz 251 half-track in the dock: the Driver's. Parked out of both gun cones; too wide for gate_n
  { id: 'halftrack', vehicleType: 'halftrack', variant: 'sdkfz251', x: 26.5, z: 120, heading: deg(42), driveable: true, behavior: 'parked' },
  // the rowboat at the tip of the marina's W jetty: rowed by the Marine; five seats so the whole team fits
  { id: 'rowboat', vehicleType: 'rowboat', x: 126, z: 129.5, heading: deg(45), seats: 5, operators: ['diver'], suspicious: false },
  // the two 210 mm guns (unmannable) and the Gatling (the Driver may take it once e_mg is dead)
  { id: 'gun22', vehicleType: 'mortar210', x: 5, z: 93, heading: deg(120), giro: 110, gunner: 'g22', driveable: false },
  { id: 'gun23', vehicleType: 'mortar210', x: 47, z: 139, heading: deg(110), giro: 110, gunner: 'g23', driveable: false },
  { id: 'mg_ne', vehicleType: 'mgNest', x: 74.5, z: 68.5, heading: deg(200), gunner: 'e_mg', driveable: true },
];

// ---------------------------------------------------------------- commandos (§3.8 row 7, exact)
const COMMANDOS = [
  // group B: the NE heights, N of the start rock
  { role: 'greenberet', x: 103.5, z: 25.5, heading: deg(90), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
  { role: 'diver', x: 105, z: 26.5, heading: deg(90), inventory: { knife: 0, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  // group A: N of the W base's wall, W of the gate hut. The Sapper's charges are in the air-drop crate
  { role: 'sapper', x: 15, z: 50, heading: deg(90), inventory: { pistol: 1, bearTrap: 1, timeBomb: 0 } },
  { role: 'driver', x: 15.5, z: 52.5, heading: deg(90), inventory: { pistol: 1, firstAid: 6 } },
  { role: 'spy', x: 17.5, z: 51, heading: deg(0), inventory: { pistol: 1, lethalInjection: 1 } },
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
const Z_W = [[27.5, 64.5], [28, 44], [58, 44], [62, 50], [72.2, 56.6], [88.5, 69.5], [60.5, 94.5], [42.6, 111.5], [64.6, 128], [49.5, 145.5],
  [57, 148], [60, 160], [46, 190], [0, 190], [0, 77.7], [20, 60.6]];
const Z_VIL = [[94, 50], [113, 50], [114, 56], [118, 66], [124, 66], [130, 58], [137, 54], [144, 50], [144, 107.7], [131.4, 111.6], [122, 117],
  [110, 117], [104, 104], [94, 104]];

const NOT_ENOUGH = 'Not enough charges left to sink the U-boats.';

// ---------------------------------------------------------------- barbed wire (docs/barbed-wire.md §12)
/** The M4–M20 wire pass: see-through, uncrossable (B.FENCE) runs added where the wire belongs; none crosses a route
 *  or lengthens an approach (tests/unit/wire-placements.test.mjs). Drawn by the map's wire layer (art/wire-obstacles.js). */
const WIRE_PASS = [
  // concertina in front of the NE MG nest and round the W gun pit (on the map edge side)
  { id: 'wx_mg_ne', type: 'fence', variant: 'concertina', points: [[70.6, 69.5], [70.5, 67.9], [71.1, 66.4], [72.2, 65.2]], h: 1.2 },
  { id: 'wx_gun22', type: 'fence', variant: 'concertina', points: [[7.3, 98], [5.6, 98.5], [3.9, 98.4], [2.3, 97.8], [0.9, 96.7]], h: 1.2 },
];

export default {
  id: 'm07',
  campaign: 'BEL',
  title: 'Chase of the Wolves',
  subtitle: 'Arendal, southern Norway · 7 February 1942',
  date: '1942-02-07',
  place: 'Arendal harbour, southern Norway',
  theater: 'snow',
  coneColors: 'green',
  size: [144, 195],
  seed: 1942_0207,
  briefing: {
    historical: 'February 1942. On the first of the month the German navy changed the cipher of its U-boat signals, and overnight we went deaf. The Atlantic convoys have lost their best protection. One of the last messages we could read says a flotilla is putting in at Arendal, on Norway\'s southern coast. Those boats must never sail again.',
    text: 'You go ashore in two parties. The Sapper, the Driver and the Spy land just north of the naval base in the west; the Green Beret and the Marine come down on the heights above the fishing village in the north-east. We have dropped your demolition charges by parachute near the hangar. Collect them, get aboard both submarines and send them to the bottom. Then take a boat out to the red buoy in the south-east, where you will be picked up. Good luck.',
    objectivesSummary: 'Sink both U-boats with a charge on the after deck, by the spare torpedoes. Then row everyone out to the red buoy in the south-east.',
    hints: [
      'The charges came down by parachute close to the hangar. Nothing can be done until the Sapper has them.',
      'A charge only sinks a U-boat on its after deck, beside the spare torpedoes. Anywhere else it barely marks the paint.',
      'The submarines lie at a pier with no way to it from the land. You will need a boat.',
      'There is a half-track parked in the dock. Your Driver can put it to good use, but keep it out of sight of the big guns.',
      'A rowboat is tied up at the jetty below the village. It can carry all five of you out to the red buoy.',
      'West of the long middle wall, anyone who is seen brings out the whole base. In the village even a noise empties their barracks.',
      'A body left anywhere in the dockyard will be found, clothesline or not. Carry it west through the gap at the end of the lower wall, into the walled corner by the inlet: nobody looks in there.',
    ],
  },
  lighting: { sunElevDeg: 14, sunAzimuthDeg: 200, kelvin: 6000, hdri: 'winter_overcast_coast', fog: 150, lut: 'norway_winter' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.15, color: '#103f3a' },
  shoreShallowWidth: 2.0,
  baseTerrain: 'snow',
  terrain: TERRAIN,
  markers: [
    // demolition markers: a time bomb must go off within 3 m of the torpedo stack on each after deck
    { id: 'u1_charge', x: U1.x, z: U1.z, r: 3, target: 'uboat_1' },
    { id: 'u2_charge', x: U2.x, z: U2.z, r: 3, target: 'uboat_2' },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures([...STRUCTURES, ...WIRE_PASS], [['h_big', 'h_1'], ['h_3', 'h_5'], ['h_4', 'h_6'], ['uboat_1', 'uboat_1_tower'], ['uboat_2', 'uboat_2_tower'], ['boat_m3', 'boat_m4'], ['boat_m7', 'boat_m10']]),
  items: [],
  interactables: [
    // the air-drop crate: all four time bombs (only the Sapper can take them)
    { interactKind: 'crate', id: 'drop', x: 15, z: 4.5, contents: { timeBomb: 4 } },
    // "the curtain": the Spy's uniform on the clothesline by the dockyard gate
    { id: 'uniform_line', interactKind: 'clothesline', x: 18, z: 67.5 },
  ],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  zones: [
    { id: 'z_w', poly: Z_W, onSeen: 'RINT', onHeard: null, siren: true },
    { id: 'z_vil', poly: Z_VIL, onSeen: 'RVIL', onHeard: 'RVIL', siren: false },
  ],
  jails: ['barr_dock', 'barr_mid', 'barr_vil'],
  // garrisons: exit at 2.7 m/s, then loop at 1.8 m/s (pools [rec]: the dock is the big one, Prima's half-track fight)
  barracks: {
    barr_dock: { pool: 10, squads: [{ event: 'RINT', size: 4, exitVel: 2.7, exitRoute: [P(10.5, 83), P(16, 88)], loopVel: 1.8, loop: DOCK_LOOP }] },
    barr_mid: { pool: 5, squads: [{ event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [P(65, 76), P(60, 70)], loopVel: 1.8, loop: POCKET_LOOP }] },
    barr_vil: { pool: 5, squads: [{ event: 'RVIL', size: 3, exitVel: 2.7, exitRoute: [P(129, 83.5), P(124, 81.5)], loopVel: 1.8,
      loop: [P(124, 81.5), P(106, 81.5), P(106, 104), P(120, 110), P(106, 104), P(106, 81.5)] }] },
  },
  climbLinks: [],
  ladders: [],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Sink the first U-boat (a charge on the after deck, by the torpedoes)', type: 'destroy', targets: ['uboat_1'], marker: 'u1_charge', required: true, bombOnly: true },
    { id: 'o2', text: 'Sink the second U-boat (a charge on the after deck, by the torpedoes)', type: 'destroy', targets: ['uboat_2'], marker: 'u2_charge', required: true, bombOnly: true },
    { id: 'o3', text: 'Row everyone out to the red buoy in the south-east', type: 'escape', required: true, vehicleId: 'rowboat' },
  ],
  // dossier §11 (no set-piece needed: data + triggers)
  triggers: [
    // T1 [P][g3]: a 210 mm gun going up brings out whatever is left of the W garrisons
    { on: 'vehicle:destroyed', match: { vehicle: 'gun22' }, once: true, delay: 0.5, do: [{ alarm: 'z_w', x: 5, z: 93, cause: 'gun22' }] },
    { on: 'vehicle:destroyed', match: { vehicle: 'gun23' }, once: true, delay: 0.5, do: [{ alarm: 'z_w', x: 47, z: 139, cause: 'gun23' }] },
    // T2 [P][K]: a charge anywhere else on a hull only scorches it
    { on: 'bomb:exploded', once: false,
      when: (p, w) => { const id = nearUboatHull(p.x, p.z, 1); return !!id && afloat(w, [id]) > 0 && !inMarker(w, p.x, p.z, ['u1_charge', 'u2_charge']); },
      do: [{ message: 'Only scorched paint. The charge has to sit on the after deck, next to the torpedoes.', kind: 'hint' }] },
    // T3: both boats going down
    { on: 'objective', match: { status: 'done' }, once: true,
      when: (p, w) => ['o1', 'o2'].every((id) => w.objectives?.find((o) => o.id === id)?.done),
      do: [{ message: 'Both U-boats are going down! Everyone into the rowboat and out to the red buoy.', kind: 'info' }] },
    // T4 [rec]: no boat, no way home
    { on: 'vehicle:destroyed', match: { vehicle: 'rowboat' }, once: true, do: [{ fail: 'The rowboat has gone down. There is no way out of the harbour.' }] },
    // T5 [P][K]: one sergeant staggers out of the blown village barracks
    { on: 'structure:destroyed', match: { id: 'barr_vil' }, once: true, delay: 2.5, do: [{ run: (w) => spawnVillageOfficer(w) }] },
    // T6 [rec] soft-lock guard: fewer time bombs left than U-boats afloat (re-checked 3 s later before failing)
    { on: 'tick', once: false, when: (p, w) => !w.scriptFail && chargesLeft(w) < afloat(w), delay: 3,
      do: [{ run: (w, dir) => { if (chargesLeft(w) < afloat(w)) dir.fail(NOT_ENOUGH); } }] },
  ],
  // the rowboat is on the map from the start; the exit counts once o1 and o2 are done and all five are aboard
  extraction: { vehicleId: 'rowboat', exit: { x: 140, z: 180, r: 6 }, spawnWhen: [] },
  alarmFail: null,
  par: { time: 840 },
  cameraStart: { x: 100, z: 30, zoom: 1 },
  cameraGroups: [{ x: 100, z: 30 }, { x: 18, z: 52 }], // hotkey jump between the two landing parties
  startDisguised: [],
};
