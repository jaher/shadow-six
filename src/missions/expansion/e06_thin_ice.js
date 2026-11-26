/**
 * LIGHTS OUT mission 6: "Thin Ice" (docs/expansion/e06.md). Fährhafen Lütjenbrook, a train-ferry port on the
 * Holstein Baltic coast, 19 January 1945, frozen dusk. The last sealed wagon of Referat N's receivers and key-table
 * press waits on the ferry berth for a ferry the ice has stopped. Lower the raised rail link-span with its own door
 * sentry on puppet strings, put the span master to sleep before he raises it again, bind the shunter's driver (on the
 * berth's alarm the engine would pull the wagon inland), take a Feldgendarm's sergeant tunic, and push the wagon over
 * the span and off its end into the harbour. The Marine dives the ice-breaker's channel to the searchlight tower at
 * the harbour mouth and to the tug's gunner; the team walks out over the sea ice between mines frozen in since
 * Christmas. The fishing families on the west quay are a hard constraint.
 *
 * Conventions: x east, z south (m from the NW corner); headings and `rot` in radians via deg(); route `look` and
 * `post.sweep` in degrees (0 = E, 90 = S, 180 = W, 270 = N). The sea and the harbour basin are walkable ground painted
 * as ice (terrain `paint: 'ice'`, `flat`); the ice-breaker's channel and the lead round the tug are water, which only
 * the Marine enters. Hard is the base data; `only: 'hard'` entries and the Easy patch make the Easy variant.
 */
import { registerExpansionMission } from './registry.js';
import { joinStructures } from '../schema.js';
import {
  E06, reraiseDue, reraise, shuntDue, shuntLeg, wagonInland, searchlightOut, swingDue, swingCrew, dutyRaiseDue,
  shuntDisarmNow, shuntDisarmed,
} from '../scripts/e06.js';
import { e06Visuals } from '../../art/e06-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look });
const H = 'hard'; // `only: H` — Hard-only entries (docs/bcd-plan.md §1.12)

// ---------------------------------------------------------------- terrain (design §4.1)
/** The frozen sea north of the moles (painted ice, level). It runs past the map edges so the apron keeps the ice. */
export const SEA_ICE = [[-40, -40], [220, -40], [220, 28], [-40, 28]];
/** The frozen harbour basin and the berth's slip under the link-span. */
export const BASIN_ICE = [[16, 32], [176, 32], [176, 56], [160, 56], [160, 66], [16, 66]];
/** The berth's slip under the link-span: kept open for the ferry (water: the wagon goes into it off the span's end). */
export const SLIP = [[163.5, 40], [172.5, 40], [172.5, 56], [163.5, 56]];
/**
 * The ice-breaker's channel from the open sea through the harbour mouth, and the lead it has broken round the tug: a
 * broken, irregular edge — bays where slabs fell in, tongues where a floe froze back on, chipped corners (generated
 * once from the old outline by a seeded wander inside per-edge bands, then frozen here), straight only through the
 * harbour mouth between the moles' heads and along the searchlight tower's face; the strip south of the lead stays
 * >= 4.2 m wide, the tug >= 1 m off the ice.
 */
export const CHANNEL = [
  [83, -40], [97, -40], [97, -37.7], [97.4, -33.9], [97.7, -31.7], [96.8, -29.2], [97.6, -26.9], [96.9, -24.5],
  [96, -20.7], [96.9, -18.6], [97.6, -16.4], [97.1, -14.3], [97, -12.1], [96.8, -8.9], [96.4, -6.3], [96.8, -2.8],
  [96.6, 0.6], [96.4, 3.6], [97.5, 6.5], [96.7, 9.1], [97.3, 11.5], [96.7, 14.6], [96.7, 17], [96.6, 20.8],
  [96.2, 23.5], [97, 26], [97, 29], [103, 38], [105.2, 39], [105.2, 41.5], [108, 40.8], [109.3, 42.8], [110.6, 44.4],
  [112.2, 46], [114, 47.5], [115.6, 47.9], [117.7, 49.7], [119.8, 48.4], [121.5, 47.5], [123.7, 46.7], [125.6, 50],
  [127.1, 49.8], [129.3, 48.9], [130.7, 47.3], [132.1, 47.2], [134.3, 48.1], [135.4, 49.2], [135.7, 49.9],
  [134.4, 51.5], [134.2, 53.3], [134.5, 55], [134.9, 56], [135.3, 57.4], [136.8, 58.3], [136.6, 59.6], [137.4, 60.7],
  [136.6, 61.6], [135.6, 59.8], [133.8, 59.4], [131.8, 60.5], [130, 60.9], [127.7, 61.1], [126.2, 61.2],
  [124.3, 61.3], [122.7, 60.6], [121.1, 61.4], [119.9, 61.7], [118.2, 61.2], [116.5, 60.9], [114.5, 60.7],
  [113.3, 61.2], [112.1, 61.4], [110.6, 60.7], [109.5, 61.2], [108.2, 60.3], [107, 59.9], [106, 61.6], [104.9, 60.5],
  [105.5, 59.2], [103.6, 57.8], [103.6, 55.9], [103.7, 54.2], [102.7, 53.1], [102, 52], [100.9, 49.9], [99.9, 48.4],
  [97.6, 48.2], [96.2, 46.6], [94.6, 45.2], [92.9, 43.5], [91.2, 43.1], [89.7, 41.9], [89, 40], [87.9, 38.4],
  [86.9, 37], [86.8, 34.9], [85.4, 33.4], [84.6, 31.9], [83.5, 30], [83, 29], [83, 26.7], [83, 23.7], [83, 20.6],
  [82.3, 17.6], [82.4, 14.2], [84, 10.8], [82.4, 7.2], [82.5, 4.3], [83.3, 1.6], [82.7, -1.7], [83, -5.2],
  [82.9, -7.5], [82.7, -11.3], [82.3, -15], [82.5, -18.9], [83.4, -21.5], [83.5, -25], [82.2, -27.4], [82.1, -31.2],
  [82.3, -34.9], [82.2, -37.8]
];

const TERRAIN = [
  // (the theatre's own snow lies on the ice; the wind has scoured it off in streaks along its line (from the north-east),
  // baring the grey ice: art/terrain.js featurePainter `patches`)
  { type: 'poly', terrain: 'ground', points: SEA_ICE, paint: 'ice', flat: true, edge: 0.6, keep: 0.38,
    patches: { cover: 0.42, scale: 10, stretch: 3.2, angle: 28, seed: 61 } },
  { type: 'poly', terrain: 'ground', points: BASIN_ICE, paint: 'ice', flat: true, edge: 0.6, keep: 0.42,
    patches: { cover: 0.34, scale: 7, stretch: 2.4, angle: 18, seed: 62 } },
  { type: 'poly', terrain: 'water', points: CHANNEL }, // (after the ice: the channel and the slip cut it)
  { type: 'poly', terrain: 'water', points: SLIP },
];

// ---------------------------------------------------------------- the link-span, the berth, the rails (design §4.2)
/** The rail link-span (the catalogue's drawbridge): 8 m wide over the slip, 14 m long, hinged on the quay at z 56. */
export const SPAN = { x: 168, z: 49, w: 8, d: 14, rot: 0 };
/** The span master's cabin: a brick room 5 × 4 m on the berth quay east of the hinge, its door gap in the east wall. */
export const CABIN = { x0: 172, x1: 177, z0: 56.5, z1: 60.5, door: [57.6, 59.4] }; // (the door in its east wall, z span)
/** The searchlight tower on the east mole's end at the harbour mouth: its deck (y 5.5), the ladder on its channel face. */
export const TOWER = { x: 100.5, z: 30, y: 5.5 };
/** The terminal's clock tower on the quay front: tw1's gallery (y 10) over the basin. */
export const CLOCK = { x: 80, z: 73.6, y: 10 };
/** The berth track: inland (south) to the quay edge; on the lowered span it runs on to (168, 42). */
export const BERTH_TRACK = [[168, 124], [168, 56]];
/**
 * The sealed wagon's rail and its drop point (its centre past z 46: over the end of the span into the harbour). A push
 * rolls the wagon to the rail end farther from it, so the rail runs on north past the span's end (where it never
 * gets): pushed from anywhere on the berth track, the wagon goes north.
 */
export const WAGON_RAIL = [[168, 116], [168, -30]];
export const WAGON_DROP = [168, 46];

const cabinWall = (id, a, b) => ({ id, type: 'wall', variant: 'wall_brick_cabin', mat: 'brick', points: [a, b], h: 3, width: 0.3, block: 2, visual: false, clipAllow: ['span_cabin_n', 'span_cabin_e1', 'span_cabin_e2', 'span_cabin_s', 'span_cabin_w'] });
const CABIN_WALLS = [
  cabinWall('span_cabin_n', [CABIN.x0, CABIN.z0], [CABIN.x1, CABIN.z0]),
  cabinWall('span_cabin_e1', [CABIN.x1, CABIN.z0], [CABIN.x1, CABIN.door[0]]),
  cabinWall('span_cabin_e2', [CABIN.x1, CABIN.door[1]], [CABIN.x1, CABIN.z1]),
  cabinWall('span_cabin_s', [CABIN.x1, CABIN.z1], [CABIN.x0, CABIN.z1]),
  cabinWall('span_cabin_w', [CABIN.x0, CABIN.z1], [CABIN.x0, CABIN.z0]),
];

/** A rail siding / the berth track (`rail_track`). */
const track = (id, points, variant) => ({ id, type: 'rail_track', points, flatBed: true, ...(variant ? { variant } : {}) }); // (flatBed: no render relief through the ballast)
/** A static wagon on a siding (`train_car`: B.HIGH cover). */
const wagon = (id, x, z, variant = 'covered_goods', w = 8) => ({ id, type: 'train_car', variant, x, z, rot: 0, w, d: 3, h: variant === 'covered_goods' ? 3.5 : 2.5 });

const RAILS = [
  track('berth_track', BERTH_TRACK),
  track('siding_a', [[104, 92], [150, 92], [161, 89.4], [167.6, 81]]),
  track('siding_b', [[108.5, 100], [156, 100]]),
  track('siding_c', [[124, 108], [156, 108]], 'rusty'),
  wagon('wagon_a1', 117, 92), wagon('wagon_a2', 127, 92), wagon('wagon_a3', 141, 92),
  wagon('wagon_b1', 115, 100, 'flatcar_tarp'), wagon('wagon_b2', 135, 100), wagon('wagon_b3', 145, 100),
  wagon('wagon_c1', 136, 108), wagon('wagon_c2', 148, 108),
];

// ---------------------------------------------------------------- buildings (design §4.2)
const house = (id, asset, x, z, w, d, h, extra = {}) => ({ id, type: 'house', variant: 'house_fisher_brick', asset, x, z, rot: 0, w, d, h, snowRoof: true, ...extra });
const BUILDINGS = [
  // the fishing village: a brick church and half-timbered fishermen's houses (Holstein Fachwerk under snow)
  { id: 'church', type: 'house', variant: 'church_brick_village', asset: 'church_village_b', x: 26, z: 88, rot: 0, w: 31.8, d: 13, h: 24, snowRoof: true },
  house('house_a', 'house_halftimber_a', 11, 106, 11.2, 8, 12.2),
  house('house_b', 'house_halftimber_c', 25.5, 106, 11.3, 7.8, 10.3),
  house('house_c', 'house_halftimber_e', 40, 106, 11.1, 8.4, 14.8),
  // net sheds on the west shore, behind the families' quay
  { id: 'net_shed_n', type: 'hut', variant: 'fishing_shed', asset: 'fishing_shed_a_snow', x: 8, z: 41, rot: 0, w: 8.9, d: 12.2, h: 6.8 },
  { id: 'net_shed_s', type: 'hut', variant: 'fishing_shed', asset: 'fishing_shed_b_snow', x: 8, z: 56, rot: 0, w: 8.9, d: 11.2, h: 5.7 },
  // the ferry terminal (waiting hall, harbourmaster, the signals office), the goods shed, the Marine-Flak barracks
  // (drawn by e06 art: art/e06-dressing.js ferryTerminal — a red-brick North German terminal; the library's stations are French)
  { id: 'terminal', type: 'house', variant: 'ferry_terminal_brick', label: 'Ferry terminal', x: 76, z: 81, rot: 0, w: 52, d: 13, h: 9, visual: false },
  // its clock tower on the quay front (tw1's gallery at y 10; drawn by e06 art with the terminal)
  { id: 'clock_tower', type: 'watchtower', variant: 'terminal_clock_tower', label: 'Clock tower', x: CLOCK.x, z: CLOCK.z, rot: 0, w: 4.4, d: 4.4, h: 16, deckY: CLOCK.y, visual: false },
  { id: 'goods_shed', type: 'house', variant: 'goods_shed_brick', asset: 'station_rail_goods', x: 144, z: 81, rot: 0, w: 16.6, d: 12.5, h: 7.2, snowRoof: true },
  { id: 'barracks', type: 'barracks', variant: 'barracks_navy_brick', asset: 'barracks_a_snow', x: 96, z: 107, rot: Math.PI, w: 19.4, d: 13.9, h: 7.6,
    garrison: true, flag: true, door: -Math.PI / 2 },
  { id: 'kennel', type: 'hut', variant: 'dog_kennel', label: 'Kennel', x: 84, z: 97.2, rot: 0, w: 1.8, d: 1.9, h: 1.4, visual: false, only: H },
  // the coal bunker for the engines and the tug
  // (the bunker is drawn by e06 art: a timber hopper on posts; the heap is the kit's own)
  { id: 'coal_hopper', type: 'hut', variant: 'coal_bunker_timber', label: 'Coal bunker', x: 119, z: 113.5, rot: 0, w: 5.2, d: 4.6, h: 5.4, visual: false },
  // (the heap is drawn by e06 art too: black lumps under a broken crust of snow — the kit's slag heap read as white boulders)
  { id: 'coal_heap', type: 'rocks', variant: 'slag_heap', label: 'Coal heap', x: 127.5, z: 114.5, rot: 0, w: 6.4, d: 6.4, h: 1.8, block: 1, visual: false },
  // the quay crane over the berth's approach
  { id: 'crane', type: 'bunker', variant: 'crane_dock_portal', x: 150, z: 68.5, rot: 0, w: 1.2, d: 1.2, h: 12, mat: 'metalRust', block: 2 },
  // the searchlight tower at the harbour mouth (its crew on the deck), and the harbour watch tower on the quay
  { id: 'sl_tower', type: 'watchtower', variant: 'searchlight_tower', label: 'Searchlight tower', x: TOWER.x, z: TOWER.z, rot: 0, w: 4.5, d: 4.5, h: 6, deckY: TOWER.y, visual: false }, // (drawn by e06 art: a concrete tower and its searchlight)
  // the ice-breaker tug moored in its lead (her gunner and skipper aboard)
  { id: 'tug', type: 'crates', variant: 'icebreaker_tug', label: 'Ice-breaker tug', x: 120, z: 56.5, rot: Math.PI, w: 18, d: 6, h: 3.2, block: 2,
    vehicleArt: 'harbour_tug', vehicleArtFit: 1, vehicleArtTheater: 'temperate' },
  // the link-span's lifting gantry: two lattice legs on piers in the ice at the span's outer end (drawn by e06 art)
  { id: 'gantry_w', type: 'bunker', variant: 'linkspan_gantry_leg', x: 162.6, z: 42.5, rot: 0, w: 1.6, d: 1.6, h: 10, mat: 'metalRust', block: 2, visual: false },
  { id: 'gantry_e', type: 'bunker', variant: 'linkspan_gantry_leg', x: 173.4, z: 42.5, rot: 0, w: 1.6, d: 1.6, h: 10, mat: 'metalRust', block: 2, visual: false },
  ...CABIN_WALLS,
];

/** Trees: bare village limes and a few spruces in the gardens (3D trees, never cards). */
const tree = (x, z, k, variant = 'deciduous_bare', h = 9) => ({ id: `tree_${k}`, type: 'tree', variant, x, z, r: 0.45, h: h + (k % 3), seed: 6060 + k });
const pine = (x, z, k) => ({ id: `pine_${k}`, type: 'pine', x, z, r: 0.5, h: 8 + (k % 4), seed: 6160 + k });
const TREES = [
  tree(4, 71, 1), tree(44, 98, 2), tree(4, 98, 3), tree(46, 114, 4), tree(18, 117.6, 5, 'deciduous_bare', 8), tree(33, 116, 6, 'deciduous_bare', 8),
  pine(2, 116, 1), pine(52, 118, 2), pine(60, 112, 3), pine(2, 36, 4), pine(14, 64, 5),
];

/** Mines frozen into the sea ice (sea mines, e01's asset in its iced skin). Rows z 9 / 14 / 19; Easy drops every third. */
const MINE_ROWS = [
  { z: 19, xs: [103, 111, 119, 127, 135, 143, 151, 159, 167, 175] },
  { z: 14, xs: [107, 115, 123, 131, 139, 147, 155, 163] },
  { z: 9, xs: [119, 127, 135, 143] },
];
export const MINES = MINE_ROWS.flatMap((r, i) => r.xs.map((x, k) => ({ kind: 'seaMine', id: `mine_${i}_${k}`, x, z: r.z, label: 'Sea mine (frozen in)', ...((k + i) % 3 === 2 ? { only: H } : {}) })));

// ---------------------------------------------------------------- set dressing (low cover, off every route)
const dress = (id, x, z, rot, w, d, h, variant, extra = {}) => ({ id, type: 'crates', variant, x, z, rot: deg(rot), w, d, h, block: 1, fixed: true, ...extra });
const DRESSING = [
  // the families' brazier and bundles on the west quay, a refugee handcart, frozen nets
  dress('brazier', 31.5, 70.5, 0, 0.9, 0.9, 0.9, 'brazier_drum', { block: 1, label: 'Brazier' }),
  dress('bundles', 37.5, 72.5, 10, 2.2, 1.2, 0.8, 'refugee_bundles', { label: 'Bundles' }),
  dress('handcart', 25.5, 72.8, 80, 2.2, 1.3, 1.1, 'handcart', { asset: 'handcart_wood', label: 'Handcart' }),
  dress('nets_w', 45.5, 70.5, 0, 2.6, 1.4, 0.9, 'fish_gear', { label: 'Frozen nets' }),
  // fishing boats frozen in at the west quay
  // (sunk into the ice on a crust of rafted floes; the temperate skin under the scene's snow: art/static-vehicles.js)
  dress('boat_ice_1', 22, 61.5, 75, 4, 1.8, 0.9, 'boat_beached', { vehicleArt: 'rowboat', vehicleArtHide: ['oar_l', 'oar_r'], vehicleArtTheater: 'temperate', sink: 0.16, list: 4, ice: true, label: 'Frozen-in boat' }),
  dress('boat_ice_2', 30, 59, 95, 4, 1.8, 0.9, 'boat_beached', { vehicleArt: 'rowboat', vehicleArtHide: ['oar_l', 'oar_r'], vehicleArtTheater: 'temperate', sink: 0.14, list: -3, ice: true, label: 'Frozen-in boat' }),
  dress('cutter_ice', 40, 58, 82, 9, 3, 1.4, 'boat_moored', { block: 2, vehicleArt: 'fishing_boat', vehicleArtFit: 1, vehicleArtTheater: 'temperate', sink: 0.22, list: 2, ice: true, label: 'Frozen-in cutter' }),
  // the berth: salt sacks at the span's quay end, cable drums, coal by the yard, the terminal's crates
  dress('salt_sacks', 161.5, 60.5, 0, 2.4, 1.4, 0.9, 'sandbag_pile', { label: 'Salt sacks' }),
  dress('drums_berth', 179, 64, 90, 2, 1.6, 1, 'inert_stack', { type: 'barrels', label: 'Drums' }),
  dress('cable_drums', 157, 63, 0, 2.7, 1.6, 1.4, 'cable_reels', { label: 'Cable drums' }),
  dress('crates_quay', 124, 68.5, 0, 2.2, 2.2, 1.2, 'dock_cargo', { asset: 'dock_cargo_a' }),
  dress('crates_yard', 130, 74.5, 0, 2.2, 2.2, 1.2, 'dock_cargo', { asset: 'dock_cargo_c' }),
  dress('buffer_a', 103.4, 92, 0, 1.6, 0.9, 1.4, 'buffer_stop', { block: 2 }),
  dress('buffer_b', 107.9, 100, 0, 1.6, 0.9, 1.4, 'buffer_stop', { block: 2 }),
  dress('buffer_b2', 156.6, 100, 180, 1.6, 0.9, 1.4, 'buffer_stop', { block: 2 }),
  dress('buffer_c', 156.6, 108, 180, 1.6, 0.9, 1.4, 'buffer_stop', { block: 2 }),
  dress('woodpile_v', 47, 110.5, 90, 3, 1.5, 1, 'log_pile', { asset: 'log_pile_stack' }),
];

/** Street furniture (visual only): hooded quay lamps, the ferry timetable, the Kiel fingerpost. */
const FURNITURE = [
  ...[[52, 73.6], [88, 73.6], [104, 73.6], [130, 73.6], [158, 66.8], [171, 62.8]].map(([x, z]) => ({ type: 'lamp', variant: 'harbour', x, z, rot: deg(270), block: false })),
  { type: 'sign', variant: 'board', x: 64.5, z: 73.4, rot: deg(-90), text: 'FÄHRE GEDSER\nKEIN VERKEHR', block: false },
  { type: 'sign', variant: 'fingerpost', x: 49, z: 75.8, rot: deg(0), text: 'KIEL 61 km', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 159.5, z: 75.6, rot: deg(-90), text: 'FÄHRBETT\nZUTRITT VERBOTEN', block: false },
];

/** Paved surfaces: the granite quays and moles, the snow-packed village street and yard lanes (visual + road codes). */
const PAVEMENTS = [
  { id: 'quay_south', surface: 'quay', points: [[16, 66], [160, 66], [160, 56], [176, 56], [176, 32], [180, 32], [180, 74], [16, 74]], quay: { edges: [0, 1, 2, 3], bollards: 10 } },
  { id: 'mole_west', surface: 'quay', points: [[16, 28], [83, 28], [83, 32], [16, 32]], quay: { edges: [0, 2], bollards: 6 } },
  { id: 'mole_east', surface: 'quay', points: [[97, 28], [180, 28], [180, 32], [97, 32]], quay: { edges: [0, 2], bollards: 6 } },
];
const ROADS = [
  { id: 'village_street', surface: 'snow_packed', points: [[0, 77], [24, 77], [48, 76]], width: 5 },
  { id: 'yard_lane_w', surface: 'snow_packed', points: [[108, 74], [108, 118]], width: 4 },
];

// ---------------------------------------------------------------- commandos and guest (design §5)
const COMMANDOS = [
  { id: 'ma', role: 'diver', x: 15, z: 97.5, heading: 0, inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, stones: 50 } },
  { id: 'sa', role: 'sapper', x: 19, z: 98, heading: 0, inventory: { pistol: 1, remoteBomb: 1, grenade: 2, wireCutters: 1, bearTrap: 1, stones: 50, cigarettes: 2 } },
  { id: 'dr', role: 'driver', x: 23, z: 97.5, heading: 0, inventory: { pistol: 1, smg: 100, leeEnfield: 50, firstAid: 2, stones: 50 } },
  { id: 'sp', role: 'spy', x: 27, z: 98, heading: 0, inventory: { pistol: 1, lethalInjection: 1, firstAid: 6, stones: 50 } },
  { id: 'gr', role: 'grethe', x: 31, z: 97.5, heading: 0 },
];

// ---------------------------------------------------------------- enemies (design §7; Hard = base, `only: H` extras)
const sentry = (id, x, z, h, sweep, extra = {}) => ({ id, soldierType: 'sentry', x, z, heading: deg(h), post: { heading: deg(h), sweep }, ...extra });
const walker = (id, a, b, extra = {}, type = 'soldier') => ({
  id, soldierType: type, x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), flags: { investigates: true },
  route: { type: 'PINGPONG', vel: 1.0, points: [a, b] }, ...extra,
});
const civil = (id, x, z, h) => ({ id, soldierType: 'pow', x, z, heading: deg(h), label: 'Fisherfolk' });

const ENEMIES = [
  // ===== the village and the west quay (z_west): the families' quay is watched, not patrolled
  sentry('v1', 36, 67.6, 270, 40),
  walker('v2', P(4, 78, 6, 90), P(46, 78, 6, 270)),
  sentry('vq1', 47.5, 73.4, 0, 40),
  { ...sentry('v3', 30, 113, 90, 40), only: H }, // the back gardens behind the houses, looking south over the fields
  civil('f1', 30, 69.4, 0), civil('f2', 31.2, 72, 300), civil('f3', 33.6, 72.2, 210), civil('f4', 34.6, 69.4, 160),
  civil('f5', 10.3, 110.8, 90), civil('f6', 24.8, 110.8, 90), civil('f7', 39.3, 110.8, 90), civil('f8', 42, 96.5, 180),

  // ===== the moles and the harbour mouth (z_mole)
  sentry('wm1', 18, 30, 0, 40),
  walker('wm2', P(26, 30, 8, 270), P(78, 30, 8, 270)),
  sentry('wm3', 81, 30, 280, 40), // the west mole's end: out to sea over the harbour mouth
  // the searchlight crew on the tower's deck: two at the light looking out to sea, on Hard a third over the basin
  sentry('sl1', TOWER.x - 0.9, 29.2, 270, 60, { y: TOWER.y, elevated: true, overlooks: true, tower: 'sl_tower', flags: { holdsPost: true, investigates: false } }),
  sentry('sl2', TOWER.x + 0.9, 29.2, 270, 60, { y: TOWER.y, elevated: true, overlooks: true, tower: 'sl_tower', flags: { holdsPost: true, investigates: false } }),
  { ...sentry('sl3', TOWER.x + 0.6, 31.3, 90, 50, { y: TOWER.y, elevated: true, overlooks: true, tower: 'sl_tower', flags: { holdsPost: true, investigates: false } }), only: H },
  walker('em1', P(110, 30, 8, 270), P(156, 30, 8, 270)),
  { id: 'mg_mole', soldierType: 'mg', x: 160, z: 30, heading: deg(250), post: { heading: deg(250), sweep: 30 }, only: H },

  // ===== the terminal, the quay and the yard (z_quay)
  sentry('q1', 72, 72.8, 270, 50),
  walker('q2', P(50, 69, 6, 270), P(108, 69, 6, 270)),
  sentry('q3', 104, 80, 0, 40),
  sentry('tw1', CLOCK.x, CLOCK.z, 270, 45, { y: CLOCK.y, elevated: true, overlooks: true, tower: 'clock_tower', flags: { holdsPost: true, investigates: false } }),
  walker('t1', P(66, 73.4, 40, 270), P(110, 73.2, 20, 270), {}, 'lieutenant'), // the port duty officer: the terminal's quay front, looking over the basin
  { id: 'tug_mg', soldierType: 'mg', x: 112.4, z: 56.5, y: 2.2, heading: deg(270), structure: 'tug', post: { heading: deg(270), sweep: 30 } }, // the bow gun: over the basin ice and the channel
  { id: 'tug_sk', soldierType: 'truckDriver', x: 123.6, z: 56.5, y: 3.15, heading: deg(180), structure: 'tug', post: { heading: deg(180), sweep: 0 } }, // (on the open bridge over the wheelhouse: its top at y 3.14)
  sentry('cr1', 147.5, 72, 90, 50), // the crane's foot: down the quay road along the goods shed's front
  sentry('gs1', 134.4, 80.5, 180, 40),
  walker('y1', P(106, 96, 6, 0), P(126, 96, 6, 180)), // between the barracks and the sidings
  { ...walker('y2', P(106, 77.5, 6, 180), P(132, 77.5, 6, 90)), only: H }, // (Hard) the quay road between the terminal and the goods shed
  sentry('cb1', 122.5, 110.2, 0, 40),
  sentry('cs1', 108, 96, 0, 40),
  // the yard's foot patrol (a sergeant and two troopers: patrol men cannot be knocked out): round the yard between the
  // terminal's east end and the goods shed, west behind the quay road, east along the sidings
  ...['p1a', 'p1b', 'p1c'].map((id, k) => ({
    id, soldierType: k ? 'trooper' : 'sergeant', x: 130 + 1.5 * k, z: 81.5, heading: deg(180), flags: { investigates: true },
    squad: { id: 'p1', leader: 'p1a', columns: 1 },
    route: { type: 'LOOP', vel: 1.0, points: [P(130, 81.5), P(108, 81.5, 6, 90), P(108, 88), P(130, 88)] },
  })),

  // ===== the berth (z_berth)
  sentry('sp1', 162.5, 57.6, 270, 40),
  { id: 'k1', soldierType: 'soldier', label: 'Span master', x: 175.4, z: 58.6, heading: deg(225), post: { heading: deg(225), sweep: 0 }, flags: { holdsPost: true, investigates: false } }, // at his window over the span
  sentry('b1', 178.7, 58.5, 90, 50), // outside the cabin's door, down the berth's east edge
  // the Feldgendarmerie escort either side of the sealed wagon, backs to it: e1 over the sidings, e2 over the berth's
  // east edge
  { id: 'e1', soldierType: 'sergeant', label: 'Feldgendarm', x: 164.4, z: 96, heading: deg(180), post: { heading: deg(180), sweep: 40 }, flags: { holdsPost: true } },
  { id: 'e2', soldierType: 'sergeant', label: 'Feldgendarm', x: 171.6, z: 100, heading: deg(0), post: { heading: deg(0), sweep: 40 }, flags: { holdsPost: true } },
  { ...sentry('e4', 76, 89.4, 90, 40, { soldierType: 'sergeant' }), label: 'Feldgendarm', only: H }, // (Hard) the terminal's yard door
  walker('e3', P(168, 64, 8, 270), P(168, 86, 8, 90)),
  { id: 'sh1', soldierType: 'truckDriver', label: 'Engine driver', x: 165.7, z: 112.6, heading: deg(0), post: { heading: deg(0), sweep: 0 } },
  sentry('sh2', 164.4, 108.8, 90, 40),

  // ===== the barracks (z_barracks)
  sentry('bk1', 96, 98.4, 270, 40),
  { ...walker('bk2', P(86, 97, 6, 270), P(110, 97, 6, 270)), only: H },
  // (Hard) the dog handler and his dog at the kennel by the barracks' north front: over the lane behind the terminal
  { ...sentry('fd', 86.6, 97.6, 270, 40), only: H },
  { id: 'fd_dog', soldierType: 'dog', x: 82.4, z: 96.8, heading: deg(270), post: { heading: deg(270), sweep: 30 }, only: H },
];

// ---------------------------------------------------------------- interactables (design §4.2, §9)
const INTERACTABLES = [
  { kind: 'drawbridge', id: E06.span, label: 'Link-span', x: SPAN.x, z: SPAN.z, rect: { ...SPAN }, raised: true },
  { kind: 'drawbridgeSwitch', id: E06.spanSwitch, label: 'Span switch', x: 172.8, z: 57.3, targets: [E06.span] },
  { kind: 'pushable', id: E06.wagon, label: 'Sealed wagon', x: 168, z: 98, heading: -Math.PI / 2, size: [10, 2.8], rail: WAGON_RAIL, drop: { at: WAGON_DROP, noise: 16 } }, // (a heavy splash: the berth's quay end hears it, not the mole)
  { kind: 'pushable', id: E06.shunter, label: 'Shunting engine', x: 168, z: 110.6, heading: -Math.PI / 2, size: [8, 2.8], rail: WAGON_RAIL, roles: [], bombable: true },
  ...MINES,
];

// ---------------------------------------------------------------- zones and the garrison (design §8)
const Z_WEST = [[0, 64], [48, 64], [48, 120], [0, 120]];
const Z_MOLE = [[0, 22], [180, 22], [180, 36], [0, 36]];
const Z_BARRACKS = [[78, 96], [112, 96], [112, 120], [78, 120]];
const Z_QUAY = [[48, 36], [160, 36], [160, 120], [48, 120]];
const Z_BERTH = [[160, 36], [180, 36], [180, 120], [160, 120]];

const BARRACKS = {
  barracks: { pool: 8, squads: [
    // the berth's alarm: three men out of the north door, along the yard to the berth track and up it to the span
    { event: 'RB', size: 3, exitVel: 2.7, exitRoute: [P(96, 99), P(110, 96), P(161, 95)], loopVel: 1.8, loop: [P(161, 95), P(161, 64), P(170, 64), P(161, 64)] },
    // the quay's alarm: three men to the terminal's yard side and along the quay
    { event: 'RQ', size: 3, exitVel: 2.7, exitRoute: [P(96, 99), P(106, 92), P(106, 75)], loopVel: 1.8, loop: [P(106, 75), P(56, 71), P(150, 71), P(106, 75)] },
    // the moles' alarm: two men over the basin ice to the east mole
    { event: 'RM', size: 2, exitVel: 2.7, exitRoute: [P(96, 99), P(108, 92), P(108, 72), P(140, 40), P(140, 31)], loopVel: 1.8, loop: [P(140, 31), P(110, 31), P(156, 31)] },
  ] },
};

// ---------------------------------------------------------------- triggers (design §9)
const FAMILY_DEAD = "A FISHERMAN'S CHILD IS DEAD. THAT IS NOT WHO WE ARE.";
const TRIGGERS = [
  // the span master raises the span again once it has been down a while (Hard 60 s, Easy 120 s), unless he is down
  { on: 'tick', once: false, when: (p, w) => reraiseDue(w), do: [{ run: (w) => reraise(w) }] },
  // the engine disarmed for good (§9: its driver cuffed or dead, or the engine wrecked): latched by this once trigger,
  // whose count is saved — a berth squad that frees the driver later does not set the engine going again
  { id: E06.disarmed, on: 'tick', when: (p, w) => shuntDisarmNow(w), do: [{ run: (w) => shuntDisarmed(w) }] },
  // the berth's alarm: the shunting engine pulls out (Hard 10 s, Easy 30 s later) if its driver is awake and free,
  // runs up to the wagon, couples and pulls it inland; each leg is polled from saved state
  { on: 'tick', once: false, when: (p, w) => shuntDue(w), do: [{ run: (w) => shuntLeg(w) }] },
  { on: 'tick', when: (p, w) => wagonInland(w), do: [{ fail: 'THE WAGON HAS GONE INLAND.' }] },
  // o1 dressing: the wagon over the end of the span
  { on: 'pushable:drop', match: { pushable: E06.wagon }, do: [{ message: "The wagon goes over the end of the span and through the ice. Referat N's last station is on the bottom of the harbour.", kind: 'info' }] },
  // o2: the searchlight crew dead or cuffed
  { on: 'tick', when: (p, w) => searchlightOut(w), do: [{ objective: 'o2', set: 'done' }, { message: 'The searchlight tower is out. Nothing will find you on the ice now.', kind: 'info' }] },
  // the moles' or the quay's alarm: the searchlight swings onto the basin
  { on: 'tick', once: false, when: (p, w) => swingDue(w), do: [{ run: (w) => swingCrew(w) }] },
  // the quay's alarm: the duty officer runs to the span cabin and raises the span if it is down and clear
  { on: 'alarm:zone', match: { event: 'RQ' }, do: [{ send: E06.dutyOfficer, to: [[179.4, 62.5], [178.4, 58.5], [173.8, 57.8]] }] },
  { on: 'tick', once: false, when: (p, w) => dutyRaiseDue(w), do: [{ run: (w) => reraise(w, 'The duty officer is raising the link-span.') }] },
  // hard constraints
  { on: 'unit:killed', match: { unit: 'pow' }, do: [{ fail: FAMILY_DEAD }] },
  { on: 'unit:killed', match: { unit: 'grethe' }, do: [{ fail: 'GRETHE IS DEAD. THERE IS NO WAY HOME FOR THE OTHERS NOW.' }] },
];

/**
 * The library buildings whose coplanar faces are set apart by baked plans on these instances only (art/coplanar-baked.js:
 * the village church and houses, the net sheds, the naval barracks — no z-fighting, nothing done at load but moving
 * the baked triangles, and the assets left as they are for every other mission).
 */
export const BAKED_SPLIT = [
  { id: 'church', asset: 'church_village_b' }, { id: 'house_a', asset: 'house_halftimber_a' }, { id: 'house_b', asset: 'house_halftimber_c' },
  { id: 'house_c', asset: 'house_halftimber_e' }, { id: 'net_shed_n', asset: 'fishing_shed_a_snow' }, { id: 'net_shed_s', asset: 'fishing_shed_b_snow' },
  { id: 'barracks', asset: 'barracks_a_snow' },
];

/** The mission script: its rules are data triggers; `visuals` draws the harbour's own art as the load ends. */
const E06_SCRIPT = () => {};
E06_SCRIPT.visuals = (world) => e06Visuals(world, { ...E06_ART, baked: BAKED_SPLIT });
const E06_ART = {
  span: SPAN, cabin: CABIN, clock: CLOCK, tower: TOWER, channel: CHANNEL,
  wagon: E06.wagon, shunter: E06.shunter, spanId: E06.span, crew: ['sl1', 'sl2', 'sl3'],
  legs: [{ x: 162.6, z: 42.5 }, { x: 173.4, z: 42.5 }],
  // pressure ridges on the sea (beyond the map's north edge, and under the west mole) and a refrozen crack in the basin,
  // the fishermen's holes off the west quay — all off the routes and beats
  ridges: [
    [[-30, -9], [10, -5.5], [48, -7], [90, -4], [130, -8.5], [175, -5], [215, -7.5]],
    [[24, 24.4], [38, 23.2], [52, 24.6], [66, 23.4], [77, 25.0]],
    { pts: [[24, 50.6], [36, 52.0], [47, 52.6], [58, 51.4], [70, 52.2], [84, 54.0]], h: 0.4 }, // (the refrozen crack: low rubble)
  ],
  holes: [[54.5, 58.6], [62.5, 57.2], [71.5, 59.4]],
  avoid: [[83.6, 6, 3], [95.5, 29.8, 3.2], [97.95, 30.6, 2]], // (the Marine's dive and his surfacing at the tower's ladder)
  // the fast ice's broken edge (art/e06-ice.js iceEdge): where the banks are the frozen sheet, which are stone (quays,
  // moles), the slip, and the Marine's dive down the channel from the west bank (no slab over his way)
  seaIce: SEA_ICE, basinIce: BASIN_ICE, slip: SLIP, quays: PAVEMENTS.map((p) => p.points),
  swim: [[83.3, 7.1], [84, 8.4], [84.66, 9.65], [85.34, 10.92], [86.02, 12.18], [86.7, 13.45]],
};

const def = {
  id: 'e06', campaign: 'BCD', number: 6,
  title: 'Thin Ice', place: 'Fährhafen Lütjenbrook, Holstein, Germany', date: '1945-01-19',
  pin: { lat: 54.35, lon: 11.05 },
  context: 'January 1945. Referat N has lost its Baltic station and its index, and Ansbach is moving what is left of it out of the Reich by train ferry: one sealed wagon with the receivers and the press that prints his key tables. It waits on the ferry berth at Lütjenbrook, and the ferry cannot come in until the ice-breaker has cut the channel through.',
  subtitle: 'Fährhafen Lütjenbrook, Holstein · 19 January 1945',
  theater: 'snow',
  coneColors: 'green',
  treeSnow: 0.6,
  size: [180, 120],
  seed: 1945_0119,
  briefing: {
    historical: "January 1945. Ansbach has lost his Baltic station and his index, and he is moving what is left of Referat N out of the Reich by train ferry: a sealed wagon with the receivers and the machine that prints his key tables, bound for Denmark and a quiet pier in Norway. The wagon stands on the berth at Lütjenbrook. The ferry has not come: the harbour froze three nights ago and the port's ice-breaker clears the channel a little more each day. Tomorrow it will be through.",
    text: "Four of you and Grethe, whose uniform gets her into any signals office in Germany. That wagon is the last of Referat N's hardware. I want it at the bottom of the harbour, and I want it done without a bang: the port is a naval flak station and its barracks is two hundred metres from the berth. The berth's link-span is up because there is no ferry in. The span master lowers it from his cabin, and he raises it again the moment he can. Lower it, roll the wagon over the end and let the Baltic have it. A shunting engine stands behind the wagon with its driver dozing on the footplate: if the berth sounds its alarm, he pulls the wagon inland and you have lost. See to him first. A searchlight tower stands at the harbour mouth; put its crew out, because you leave over the sea ice north-east of the moles, through a barrage of mines frozen in since Christmas. Walk between them. The fishing families on the west quay are not part of this. Not one of them is to be hurt.",
    objectivesSummary: 'Lower the link-span, push the sealed wagon over it into the harbour, put out the searchlight tower, and get everyone, Grethe too, over the sea ice to the boats in the north-east.',
    hints: [
      'The ice holds a man. It does not hold a man where the ice-breaker has been: the dark water is the channel and the lead round the tug. Only the Marine goes in there.',
      'A man on puppet strings works a switch like any soldier. The span master sees a sentry at the switch and nothing wrong. Then he raises the span again, unless you have seen to him.',
      'Grethe can stop a soldier with a question. A man answering a question does not see who walks up behind him.',
      'The Feldgendarmes are sergeants: they know a private\'s face. Take one of their tunics before you walk among them.',
      'A shunting engine needs its driver. He dozes on the footplate behind the wagon.',
      'A rifle bullet sets off a mine from a long way away. Everyone on the moles turns towards the bang.',
      'The duty officer walks the quay from the terminal to the berth and back. He outranks every tunic you can take.',
    ],
  },
  baseTerrain: 'ground',
  terrain: TERRAIN,
  shoreShallowWidth: 1.2,
  // (no shore shelf of the water's own: the channel's and the slip's broken fast-ice edge is drawn as ice, slab by slab —
  // art/e06-ice.js iceEdge; the shader's shelf traced one smooth white stroke round the water, verifier r2)
  // (`harbor` optics: a harbour basin's murky water, its bed and the ice's underwater faces lost a few cm down;
  // `mirrorRange`: the reflection's depth spread over 64 m of height — nothing in the harbour stands taller — not the
  // camera's ~700 m, on which the searchlight tower's mirror image flickered: art/water/index.js)
  water: { velocity: 0.05, angleDeg: 0, turbulence: 0.08, color: '#0e1418', ice: 0, preset: 'harbor', mirrorRange: 64 },
  // §9: a man ordered onto the channel's or the lead's open water refuses (only the Marine swims it)
  waterRefusal: 'The ice ends here.',
  lighting: { sunElevDeg: 3, sunAzimuthDeg: 235, kelvin: 4800, hdri: 'dusk', fog: 140, lut: 'temperate_frost' },
  weather: { wind: { preset: 'calm' } },
  ambient: { fish: false, birds: true, habitat: 'sea', density: 0.4 },
  pavements: PAVEMENTS,
  roads: ROADS,
  furniture: FURNITURE,
  structures: joinStructures([...BUILDINGS, ...RAILS, ...TREES, ...DRESSING], [
    ['span_cabin_n', 'span_cabin_e1'], ['span_cabin_e2', 'span_cabin_s'], ['span_cabin_s', 'span_cabin_w'], ['span_cabin_w', 'span_cabin_n'],
    ['terminal', 'clock_tower'],
  ]),
  commandos: COMMANDOS,
  enemies: ENEMIES,
  vehicles: [],
  items: [],
  interactables: INTERACTABLES,
  zones: [
    { id: 'z_west', poly: Z_WEST, onSeen: 'RW', onHeard: 'RW', siren: false },
    { id: 'z_mole', poly: Z_MOLE, onSeen: 'RM', onHeard: 'RM', siren: false },
    { id: 'z_barracks', poly: Z_BARRACKS, onSeen: 'RBK', onHeard: 'RBK', siren: true },
    { id: 'z_berth', poly: Z_BERTH, onSeen: 'RB', onHeard: 'RB', siren: true },
    { id: 'z_quay', poly: Z_QUAY, onSeen: 'RQ', onHeard: 'RQ', siren: true },
  ],
  jails: [], // (design §1: none — the patrol takes on a man it catches; nobody is walked to the barracks)
  barracks: BARRACKS,
  objectives: [
    { id: 'o1', text: 'Roll the sealed wagon over the link-span and into the harbour', type: 'destroy', targets: [E06.wagon] },
    { id: 'o2', text: 'Put out the searchlight tower at the harbour mouth (its crew dead or in handcuffs)', type: 'script' },
    { id: 'o3', text: 'Everyone, Grethe too, over the sea ice to the boats at the ice edge', type: 'escape' },
  ],
  extraction: { x: 176, z: 6, r: 8 },
  triggers: TRIGGERS,
  script: E06_SCRIPT,
  climbLinks: [],
  // the searchlight tower's iron ladder on its channel face: the Marine climbs it straight out of the water (§9)
  ladders: [{ id: 'lad_sl', x: TOWER.x - 2.55, z: 30.6, y: 0, top: [TOWER.x - 1.7, 30.6, TOWER.y], raised: false, heading: deg(0) }],
  triplines: [],
  alarmFail: null,
  par: { time: 1320 },
  cameraStart: { x: 24, z: 96, zoom: 1 },
  startDisguised: [],
  variants: {
    easy: {
      par: { time: 1440 }, routeSpeedMul: 0.8, pauseMul: 2.5,
      enemyPatch: {
        sp1: { post: { heading: deg(270), sweep: 20 } },
        cr1: { post: { heading: deg(90), sweep: 40 } },
        e1: { post: { heading: deg(180), sweep: 30 } },
        e2: { post: { heading: deg(0), sweep: 30 } },
      },
    },
    hard: { par: { time: 1320 } },
  },
};

registerExpansionMission(def);
export default def;
