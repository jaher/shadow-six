/**
 * LIGHTS OUT mission 7: "White Out" (docs/expansion/e07.md). Hochjoch pass, Ötztal Alps, 23 March 1945, 10:40, snow
 * glare. Original SHADOW SIX mission (the boundary of docs/expansion/README.md §0): our own setting, objectives,
 * placements and briefing.
 *
 * Five commandos (Green Beret, Sapper, Driver, Spy, Sniper) dropped in the night onto a high snowfield. The heavy
 * container with the Sapper's charges and the Driver's rifle came down on the open snow under the ridge (o1, o1b). A
 * three-lorry convoy of Referat N stands by the summit hotel: the middle lorry carries the press for the key tables,
 * and its Feldwebel smashes the type plates at the first alarm in the hotel's zone (BCD's `evidence` set-piece) unless the
 * team takes them first (o2). The pass is closed by the cornice charge over the avalanche gallery, or by the fuel bowser
 * blown up in the tunnel (o3). Major Vering is taken at his desk on the hotel's sun terrace, cuffed, carried to the
 * goods cable car and loaded aboard (o4, rules.captiveCargo). Everyone into the car: it climbs to the ridge station
 * (o5) — shot down by the flak on the summit if the ridge has raised its alarm (RSUM).
 *
 * Conventions: headings / rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). The ridge (y 30) is a plateau of walkway strips (scripts/m05.js
 * plateauWalkways); its men see down to the snowfield only where they `overlooks` (the roof rule hides the rest).
 *
 * Deviations from the design file are listed in docs/expansion/e07.md §0 (kept in sync with this def).
 */
import { registerExpansionMission } from './registry.js';
import { plateauWalkways, holesOf } from '../scripts/m05.js';
import {
  RIDGE, RIDGE_FACE, RIDGE_Y, SPUR_W, SPUR_E, CORNICE_BANK, CORNICE_AT, HOTEL, TERRACE, PLATE_CASE, SMASH_AT,
  CAR_LOW, CAR_TOP, CAR_BEND, CAR_EXIT, e07Script,
} from '../scripts/e07.js';
import { buildE07Art, buildE07ArtG } from '../../art/e07-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` in DEGREES
const Y = RIDGE_Y;
/** The ridge men stand at the cliff's lip (the first walkway cell): from there they look down over the snowfield. */
const EDGE = 107.6;

// ---------------------------------------------------------------- the ridge (y 30): station, OP, flak
const RIDGE_PROPS = [
  { id: 'ridge_station', type: 'cable_car_station', variant: 'upper_blockhouse', label: 'Ridge station', x: 111, z: 99, rot: 0, w: 8, d: 6, h: 6,
    asset: 'cable_station_upper_snow', nav: false, fixed: true },
  { id: 'op_dugout', type: 'bunker', variant: 'dugout_snow', label: 'Observation post', x: 115.5, z: 43, rot: deg(180), w: 5, d: 4, h: 2.2,
    asset: 'bunker_snow', nav: false, fixed: true },
  { id: 'op_flak', type: 'aa_gun', variant: 'flak38_quad_towed', label: 'Flak', x: 113.5, z: 35.5, rot: deg(225), w: 3.2, d: 3.2, h: 1.2, block: 1, nav: false, fixed: true },
  { id: 'op_light', type: 'searchlight', variant: 'searchlight_60', x: 117.6, z: 37.2, r: 0.8, h: 1.6, nav: false, fixed: true },
  { id: 'op_ammo', type: 'crates', variant: 'ammo_boxes', x: 117.4, z: 33, rot: deg(15), w: 1.6, d: 1.0, h: 0.8, block: 1, fixed: true },
];
const RIDGE_HOLES = holesOf(RIDGE_PROPS);

// ---------------------------------------------------------------- terrain (dossier §4.1)
const ROAD = [[60, 200], [60, 150], [59, 141], [54.5, 135.5], [50, 128], [49.5, 116], [51, 106], [55, 99], [58, 93], [58, 61], [58, 49], [58, 0]];

// ---------------------------------------------------------------- enemies (dossier §7)
const walker = (id, x, z, h, pts, extra = {}) => ({
  id, soldierType: extra.type || 'soldier', x, z, heading: deg(h), flags: { investigates: true, followsTracks: true, ...(extra.flags || {}) },
  route: { type: extra.loop ? 'LOOP' : 'PINGPONG', vel: extra.vel ?? 1.0, points: pts },
  ...(extra.y != null ? { y: extra.y, elevated: true } : {}), ...(extra.overlooks ? { overlooks: true } : {}), ...(extra.only ? { only: extra.only } : {}),
});
const sentry = (id, x, z, h, sweep, extra = {}) => ({
  id, soldierType: extra.type || 'sentry', x, z, heading: deg(h),
  flags: { investigates: !!extra.investigates, holdsPost: !extra.investigates, followsTracks: !!extra.investigates, ...(extra.flags || {}) },
  post: { heading: deg(h), sweep, ...(extra.period ? { period: extra.period } : {}) },
  ...(extra.y != null ? { y: extra.y, elevated: true } : {}), ...(extra.overlooks ? { overlooks: true } : {}), ...(extra.only ? { only: extra.only } : {}),
  ...(extra.more || {}),
});

/** The ski patrol: sergeant + two troopers on skis, one file, the snowfield's clock (≈ 2 min a lap on Hard). */
// (the snowfield's upper half: up past the cornice, across under the OP, down by the container and back along the
// spur's foot; the lower snowfield, the cliff foot by the station and the drop-zone rocks are left to the ridge's eyes)
const SKI_LOOP = [P(76, 30, 8, 270), P(98, 44, 8, 0), P(92, 70, 8, 90), P(74, 60, 8, 180)];
const SKI = [[76, 30], [76, 31.4], [76, 32.8]].map(([x, z], k) => ({
  id: `sk${k + 1}`, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: deg(60),
  flags: { investigates: true, followsTracks: true }, squad: { id: 'ski', leader: 'sk1', columns: 1 },
  route: { type: 'LOOP', vel: 1.6, points: SKI_LOOP },
}));

const ENEMIES = [
  // ===== the pass road: summit, tunnel, gallery (z_pass)
  { id: 'mg_pass', soldierType: 'mg', x: 45.2, z: 104.2, heading: deg(80), emplacement: 'mg_pass_gun', structure: 'mg_pass_ring',
    post: { heading: deg(80), sweep: 60, giro: 150 } },
  sentry('ps1', 61.8, 95.2, 135, 40), // (the tunnel's south mouth: down the road as it bends past the cross)
  walker('ps2', 58, 89, 90, [P(58, 89, 8, 90), P(58, 64.5, 8, 270)]),
  sentry('ps3', 55.6, 58.6, 270, 50),
  sentry('ps5', 44.2, 97.2, 180, 50),
  walker('ps4', 39.5, 101, 0, [P(39.5, 101, 6, 180), P(39.5, 111, 6, 90)], { only: 'hard' }),
  sentry('g1', 54.2, 18.6, 270, 50),
  walker('g2', 58, 45.5, 270, [P(58, 45.5, 8, 90), P(58, 25.5, 8, 270)]),
  sentry('g3', 63.6, 52.4, 100, 40, { only: 'hard' }),
  // ===== the ridge (y 30, z_summit): flak crew, OP, ridge path, station
  // (the flak covers the north road and the valley it climbs out of: north-west to north)
  sentry('fk1', 112.6, 33.6, 255, 60, { type: 'crew', y: Y, overlooks: true }),
  sentry('fk2', 115.6, 35.2, 265, 60, { type: 'crew', y: Y, overlooks: true }),
  sentry('op1', EDGE, 40.6, 225, 80, { y: Y, overlooks: true }),
  // (the ridge path along the lip, from the OP to the station's north wall; at his south end he looks out over the container)
  walker('op2', EDGE, 60, 90, [P(EDGE, 60, 10, 180), P(EDGE, 93, 10, 210)], { y: Y, overlooks: true }),
  // (Hard: the OP's spotter, glasses on the upper snowfield and the cornice's slope with the lookout's; a narrow sweep,
  // never along the lip nor down the cliff's foot south of the OP)
  sentry('op3', EDGE, 47, 245, 20, { y: Y, overlooks: true, only: 'hard' }),
  // (on the dock's lip south of the station: the cable, the lower station and its lane; the station hides him from the path)
  sentry('rs1', EDGE, 106.6, 165, 25, { y: Y, overlooks: true }),
  sentry('rs2', 113.6, 103.2, 0, 0, { type: 'soldier', y: Y }), // at the haulage winch on the dock, his back to the berth
  // ===== the snowfield (z_snow): the ski patrol
  ...SKI,
  // ===== the hotel, the station, the convoy (z_hotel)
  sentry('h1', 61.8, 127.2, 90, 50),
  sentry('h2', 52.4, 117.2, 180, 50),
  walker('h3', 46, 132, 0, [P(46, 132, 6, 180), P(72, 132, 6, 180)]), // (at each end he looks back along the yard)
  sentry('h4', 66.2, 112.6, 270, 50),
  sentry('h5', 51.6, 126.6, 180, 50, { only: 'hard' }),
  // (at his desk with his back to the snowfield, facing the hotel's gable and its French windows)
  { id: 'vering', soldierType: 'officer', name: 'Major Konrad Vering', x: 78.6, z: 119.8, heading: deg(180), post: { heading: deg(180), sweep: 0 },
    flags: { holdsPost: true, investigates: false } },
  // (the adjutant at the Major's elbow by the gable's French windows, reading the signals over his shoulder)
  sentry('adj', 76.6, 121.4, 180, 20, { type: 'lieutenant' }),
  sentry('rad', 77.2, 116.6, 270, 0, { type: 'soldier' }),
  sentry('st1', 59.6, 112.6, 270, 30, { type: 'soldier' }),
  sentry('st2', 61.4, 112.4, 290, 30, { type: 'soldier' }),
  sentry('cs1', 93.8, 121.8, 180, 0, { type: 'soldier' }), // at the station's controls, his back to the dock
  sentry('cs2', 96.8, 128.8, 200, 40), // the dock sentry: the lane up from the lorries and the yard's east end
  walker('cv1', 62.6, 147.8, 90, [P(62.6, 147.8, 6, 0), P(62.6, 172.5, 6, 90)]),
  sentry('cv2', 79.4, 139.6, 180, 40),
  sentry('cv4', 68.4, 174.6, 90, 50),
  // (Hard: a second man on the road side of the lorries, the opposite way to cv1)
  walker('cv3', 60.0, 172.5, 270, [P(60.0, 172.5, 4, 180), P(60.0, 147.8, 4, 180)], { only: 'hard' }), // (at each end he looks back down the lorries)
  { id: 'pf1', soldierType: 'sergeant', x: 74.4, z: 161.6, heading: deg(15), post: { heading: deg(15), sweep: 50 }, flags: { holdsPost: true, investigates: false, followsTracks: false } },
  sentry('pr1', 71.6, 159.8, 225, 0, { type: 'soldier' }), // (oiling the press on the tail's corner, his back to the snowfield)
  { id: 'd1', soldierType: 'truckDriver', x: 62.6, z: 156.2, heading: deg(90), post: { heading: deg(90), sweep: 0 } },
  // ===== the hamlet (z_hamlet)
  walker('hm1', 48, 168.6, 0, [P(48, 168.6, 6), P(74, 178.4, 6)]),
  sentry('hm2', 66, 180.6, 135, 30), // (at the chapel: the road up from the valley)
  walker('hm3', 50, 196.4, 0, [P(50, 196.4, 5, 90), P(74, 197, 5, 90)]),
  sentry('hd', 85.2, 178.8, 180, 40, { only: 'hard' }),
  { id: 'hd_dog', soldierType: 'dog', x: 86.8, z: 178.4, heading: deg(180), post: { heading: deg(180), sweep: 40 }, only: 'hard' },
  ...[[41, 150.4], [43.2, 152.8], [46, 150.6], [44.4, 148.6], [47, 153]].map(([x, z], k) => ({ id: `ch${k + 1}`, soldierType: 'chicken', x, z, heading: deg(k * 70) })),
];

// ---------------------------------------------------------------- trees (3D pines; the frost forest W of the road)
function scatter(poly, n, seed, avoid = []) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const inside = (x, z, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 80; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!inside(x, z, poly)) continue;
    if (out.some(([a, b]) => Math.hypot(a - x, b - z) < 3.2)) continue;
    if (avoid.some(([a, b, r = 3.5]) => Math.hypot(a - x, b - z) < r)) continue;
    out.push([+x.toFixed(1), +z.toFixed(1)]);
  }
  return out;
}
/** Points along every enemy route and post (trees keep off them) + the road. */
const AVOID = (() => {
  const out = [];
  const line = (pts, r = 3.5) => { for (let k = 1; k < pts.length; k++) { const [a, b] = [pts[k - 1], pts[k]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= L; t += 1) out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L, r]); } };
  for (const e of ENEMIES) { out.push([e.x, e.z, 4]); if (e.route) line([[e.x, e.z], ...e.route.points.map((p) => [p.x, p.z])]); }
  line(ROAD, 5.5);
  return out;
})();
const pines = (id, pts, h0 = 9, seed0 = 7000) => pts.map(([x, z], k) => ({ id: `${id}_${k + 1}`, type: 'pine', variant: 'pine_frost', x, z, r: 0.45, h: h0 + ((k * 5) % 6), seed: seed0 + k }));
const TREES = [
  ...pines('wood_n', scatter([[0, 0], [40, 0], [40, 56], [38, 92], [30, 104], [0, 112]], 46, 71, AVOID), 10, 7000),
  ...pines('wood_s', scatter([[0, 112], [30, 108], [36, 124], [34, 146], [26, 162], [0, 170]], 30, 72, [...AVOID, [36, 160, 7], [44, 152, 5]]), 9, 7100),
  ...pines('wood_sw', scatter([[0, 170], [26, 166], [36, 176], [36, 200], [0, 200]], 18, 73, [...AVOID, [44, 175, 8], [46, 190, 8]]), 9, 7200),
  ...pines('wood_se', [[96, 186], [101, 192], [92, 196], [104, 182], [88, 199]], 10, 7300),
  ...pines('stand_pass', [[38, 58], [34, 66], [36.5, 78]], 9, 7400),
];

// ---------------------------------------------------------------- structures (dossier §4.2)
/** A Tyrolean farmhouse (art/e07-dressing.js draws it over the footprint box: rendered ground floor, log upper floor, balcony). */
const farmhouse = (id, x, z, w, d, h, rot = 0, extra = {}) => ({ id, type: 'house', variant: 'farmhouse_tyrol', label: 'Farmhouse', x, z, rot: deg(rot), w, d, h, snowRoof: true, ...extra });
const crates = (id, x, z, w, d, h = 1.1, rot = 0, variant, extra = {}) => ({ id, type: 'crates', ...(variant ? { variant } : {}), x, z, rot: deg(rot), w, d, h, block: 1, ...extra });
const rocks = (id, x, z, w, d, h, rot = 0) => ({ id, type: 'rocks', x, z, rot: deg(rot), w, d, h });

const STRUCTURES = [
  // --- terrain masses: the ridge (y 30) and its cliff foot, the spur either side of the tunnel, the snow bank
  { id: 'ridge_face', type: 'cliff', variant: 'granite_massif', points: RIDGE_FACE, h: 2.5, block: 2, climbable: false, nav: false },
  { id: 'ridge_top', type: 'cliff', variant: 'plateau_top', points: RIDGE, h: Y, block: 2, nav: false, walkways: plateauWalkways(RIDGE, RIDGE_HOLES, Y) },
  // (the spur's faces behind the south portal's abutments stand plumb on the outline, only ever recessed: art/dressing.js
  // buildCliff `abut` — the rock never bulges out through the concrete at the abutments' feet; the abutments run a metre
  // back into it, art/e07-dressing.js PORTAL)
  { id: 'spur_w', type: 'cliff', variant: 'rock_mass', points: SPUR_W, h: 14, block: 2, climbable: false, nav: false,
    abut: [[[55.4, 89.5], [55.4, 92]], [[55.4, 92], [52.4, 92]]] },
  { id: 'spur_e', type: 'cliff', variant: 'rock_mass', points: SPUR_E, h: 14, block: 2, climbable: false, nav: false,
    abut: [[[63.6, 92], [60.6, 92]], [[60.6, 92], [60.6, 89.5]]] },
  { id: 'cornice_bank', type: 'cliff', variant: 'snow_bank', label: 'Cornice', points: CORNICE_BANK, h: 4, block: 2, climbable: false, nav: false },
  // --- the avalanche gallery: its closed uphill wall (the roof and the pillars are drawn by the art)
  { id: 'gallery_wall', type: 'wall', variant: 'concrete_gallery', points: [[61.3, 22], [61.3, 48]], h: 4.6, width: 0.6, mat: 'concrete', nav: false },
  ...RIDGE_PROPS,
  // --- the summit: wayside cross, the MG ring, the pass hut
  { id: 'cross', type: 'sign', variant: 'wayside_cross', label: 'Wayside cross', x: 47.6, z: 101.2, r: 0.3, h: 3.2, block: 0, fixed: true },
  { id: 'mg_pass_ring', type: 'sandbags', variant: 'mg_ring', x: 45.2, z: 104.2, rot: deg(80), ring: { r: 1.8 }, h: 1.0, block: 1 },
  { id: 'pass_hut', type: 'hut', variant: 'log_cabin_small', asset: 'guard_hut_b_snow', label: 'Pass hut', x: 40.6, z: 94, rot: 0, w: 5, d: 4, h: 4, enterable: true, door: 0, snowRoof: true },
  // --- the hotel, its sun terrace (Vering's desk, the radio table), the lower cable-car station
  { id: 'hotel', type: 'house', variant: 'gasthof_alpine', label: 'Hotel Hochjoch', x: HOTEL.x, z: HOTEL.z, rot: 0, w: HOTEL.w, d: HOTEL.d, h: 13,
    enterable: true, garrison: true, flag: true, nav: false, snowRoof: true },
  { id: 'terrace', type: 'pier', variant: 'timber_deck', label: 'Sun terrace', x: TERRACE.x, z: TERRACE.z, rot: 0, w: TERRACE.w, d: TERRACE.d, h: 0.25, block: 0, nav: false },
  // (the terrace's rail: open to the yard at the south end, and its side steps down to the station lane on the east)
  { id: 'terrace_rail', type: 'fence', variant: 'rail_timber', points: [[75.2, 115.2], [80.8, 115.2], [80.8, 119.0]], h: 1.0, block: false },
  { id: 'terrace_rail_s', type: 'fence', variant: 'rail_timber', points: [[80.8, 122.6], [80.8, 124.8], [79.2, 124.8]], h: 1.0, block: false },
  crates('vering_desk', 79.9, 119.8, 0.8, 1.6, 0.8, 0, 'desk_field', { block: 1, label: 'Desk' }),
  crates('radio_table', 77.2, 115.8, 1.4, 0.6, 0.85, 0, 'field_radio', { block: 1, label: 'Radio' }),
  // (enterable: its engine-room door on the yard side, where a cuffed man can be put out of sight)
  { id: 'lower_station', type: 'cable_car_station', variant: 'lower', label: 'Cable car station', x: 89, z: 125, rot: 0, w: 8, d: 6, h: 7, nav: false, enterable: true },
  { id: 'woodpile_hotel', type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x: 54.6, z: 110.6, rot: 0, w: 3, d: 1.4, h: 1.2, block: 1, fixed: true },
  // --- the convoy: the press under its awning on the middle lorry's tailboard
  crates('press', 70.0, 158.4, 1.4, 1.8, 1.4, 0, 'printing_press', { label: 'Press' }),
  crates('stores_s', 71.4, 168.4, 1.6, 1.2, 1.0, 10, 'ammo_boxes'),
  // --- the yard and the station lane
  crates('yard_drums', 80.6, 131.8, 1.8, 1.2, 1.0, 0, 'fuel_drums'),
  crates('ski_rack', 75.8, 127.4, 2.4, 0.6, 1.6, 0, 'ski_rack', { label: 'Ski rack' }),
  // --- the snowfield: the start rocks, the ribs, the container
  // (the two rocks the team lands between are body solids by their real outline, map-builder `solidOutline`: one
  // min-area rect round each cluster spread a phantom corner over the pocket between them, and a man lying down there
  // to crawl out was wedged against rock that is not there)
  { ...rocks('rocks_dz', 100.4, 150.2, 9, 3, 2.8), solidOutline: true },
  { ...rocks('rocks_dz_w', 93.4, 156.6, 2.6, 9.4, 2.6, 4), solidOutline: true },
  rocks('rocks_dz_e', 106.4, 156.4, 2.2, 4.4, 2.2, -10),
  rocks('rib_1', 84, 108, 4.2, 1.6, 1.8, 10),
  rocks('rib_2', 89.6, 69, 3.2, 1.4, 1.5, -20),
  rocks('rib_3', 80.6, 93, 3, 1.5, 1.6, 15),
  crates('container', 94.5, 75.6, 2.0, 1.0, 0.8, 25, 'supply_canister', { label: 'Container' }),
  // --- the hamlet
  farmhouse('farm1', 44, 175.6, 12, 9, 8),
  farmhouse('farm2', 82.4, 171.8, 12, 9, 8, 0, { enterable: true }),
  farmhouse('farm3', 46.6, 189.8, 12, 9, 8),
  farmhouse('farm4', 80.4, 190.8, 12, 9, 8, 180),
  { id: 'chapel', type: 'house', variant: 'chapel_onion', label: 'Chapel', x: 65.6, z: 186.6, rot: 0, w: 6, d: 8, h: 10, snowRoof: true },
  { id: 'barn', type: 'barracks', variant: 'log_shed', asset: 'barn_a_snow', label: 'Barn', x: 36, z: 159.6, rot: deg(90), w: 10, d: 6, h: 6, snowRoof: true },
  { id: 'henhouse', type: 'hut', variant: 'henhouse', asset: 'henhouse_no_snow', label: 'Henhouse', x: 44.6, z: 156.2, rot: 0, w: 3, d: 2.4, h: 2.2 },
  { id: 'kennel', type: 'hut', variant: 'dog_kennel_tyrol', label: 'Kennel', x: 88.2, z: 178.4, rot: 0, w: 1.4, d: 1.2, h: 1.1 },
  ...TREES,
];

const MISSION = {
  id: 'e07', campaign: 'BCD', number: 7,
  title: 'White Out',
  subtitle: 'Hochjoch pass, Ötztal Alps · 23 March 1945',
  place: 'Hochjoch pass, Ötztal Alps, Austria',
  date: '1945-03-23',
  pin: { lat: 46.80, lon: 10.82 },
  context: 'Hochjoch, mid-morning, the sun hard on the snow. The convoy rests at the summit hotel until dusk; above the pass the ridge and a ski patrol watch the snowfield where your container came down.',
  theater: 'snow',
  // the convoy's fuel bowser (a pushable): the library's bowser in winter paint and its burnt wreck, drawn by
  // art/e07-dressing.js and preloaded behind the loading screen (art/static-vehicles.js staticVehicleAssets)
  vehicleArtExtra: ['fuel_bowser'],
  coneColors: 'green',
  treeSnow: 1.1,
  size: [120, 200],
  seed: 1945_0323,
  briefing: {
    historical: 'March 1945. What is left of Referat N is going into the mountains. Major Konrad Vering, Ansbach\'s deputy, has the last direction-finding lorry and the machine that prints their key tables in a three-lorry convoy over the Hochjoch pass. The pass is held by mountain troops, and the convoy has stopped at the hotel on the summit for fuel and a night\'s sleep.',
    text: 'Five of you dropped last night in a storm and landed in one piece, which is more than can be said for the heavy container: it came down on the snowfield under the ridge with the Sapper\'s charges and the Driver\'s rifle in it. Find it. Then close the pass. The north road runs through an avalanche gallery under a loaded cornice, and a charge in the right place brings the mountain down on it; if you prefer, the convoy\'s fuel bowser wedged in the tunnel and set alight does the same job, louder. The press is in the middle lorry. Its type plates are the only copies of April\'s keys, and the Feldwebel in charge has orders to smash them at the first alarm: take them first. Vering works at a desk on the hotel\'s sun terrace. Alive, please. The goods cable car behind the hotel runs up to a station on the ridge, and from there it is downhill into Italy and our lines. The summit observation post has a flak gun; the ski patrol has a view of everything.',
    objectivesSummary: 'Recover the Sapper\'s pack. Take the type plates. Close the pass. Take Major Vering alive to the cable car, and everyone up to the ridge.',
    hints: [
      'Snow holds tracks. So does the mud in the hotel yard. The ski patrol follows them: walk where they walk, crawl, or keep to the road.',
      'The Driver\'s rifle kills at twenty-seven paces, and it is as loud as a pistol. Count who is near before you fire, and who will walk past the body.',
      'The bowser can be pushed. Three bullets make it a bomb.',
      'If the hotel\'s alarm sounds, the Feldwebel at the press lorry smashes the plates. Thirty seconds.',
      'The cable car leaves only with all of you and the Major aboard, and only once the pack, the plates and the pass are seen to. A car in the air is a target for the flak if the ridge is awake.',
      'A sergeant sees through a private\'s tunic. So does an officer.',
      'A cuffed man on your shoulder can be loaded into the cable car like cargo.',
    ],
  },
  // mid-morning under a clear sky, the sun hard on old snow (the briefing's 'the sun hard on the snow'): last night's
  // storm is over — no falling snow (`snowfall: 0`, art/terrain.js), a clear-sky HDRI, a March sun at 10 o'clock in
  // the south-east (46.8° N: some 34° up), long crisp shadows, thin fog, the snow at full brightness
  lighting: { sunElevDeg: 34, sunAzimuthDeg: 125, kelvin: 5600, hdri: 'clear_day', fog: 700, lut: 'norway', exposure: 1.0 },
  snowfall: 0,
  water: null,
  baseTerrain: 'snow',
  terrain: [
    { type: 'path', terrain: 'road', points: ROAD, width: 5 },
    { type: 'rect', terrain: 'mud', x: 44, z: 126, w: 38, d: 13 }, // the hotel yard (thaw: footprints)
    { type: 'path', terrain: 'road', points: [[80, 131], [86, 129.5], [93, 129.6], [98.4, 128.4]], width: 3.2 }, // the station lane, packed to the dock
    { type: 'circle', terrain: 'road', x: 97, z: 125.6, r: 3.6 }, // the dock's trodden apron
    { type: 'rect', terrain: 'road', x: 83.6, z: 127.8, w: 12.4, d: 5.0 }, // the trodden apron before the station's engine-room door
    { type: 'path', terrain: 'ground', points: [[44, 170], [60, 174], [76, 180]], width: 3 }, // the hamlet lane
    { type: 'circle', terrain: 'ground', x: 98, z: 140, r: 5 }, // the frozen tarn (bare ice: no prints)
    { type: 'rect', terrain: 'ground', x: 106.8, z: 4, w: 13.2, d: 192 }, // the ridge top's wind-scoured crust
  ],
  // (render-only: no grass tuft or reed of the ground cover stands up through the tarn's open ice — the shore 0.6 m in
  // from its drawn outline, art/e07-dressing.js tarnR; tufts stay in the drift round it)
  bareGround: [[[102.4, 140.0], [102.3, 140.9], [102.0, 141.6], [101.5, 142.4], [101.0, 143.0], [100.3, 143.5], [99.6, 143.9], [98.8, 144.2],
    [98.0, 144.4], [97.1, 144.3], [96.3, 144.0], [95.7, 143.5], [95.0, 143.0], [94.5, 142.3], [94.2, 141.6], [94.0, 140.8], [94.0, 140.0],
    [94.1, 139.2], [94.3, 138.5], [94.6, 137.7], [95.1, 137.1], [95.7, 136.6], [96.4, 136.2], [97.2, 135.9], [98.0, 135.9], [98.8, 135.9],
    [99.6, 136.2], [100.3, 136.6], [101.0, 137.0], [101.5, 137.6], [102.0, 138.4], [102.3, 139.2]]],
  structures: STRUCTURES,
  furniture: [
    { type: 'sign', variant: 'fingerpost', x: 53.2, z: 102, rot: deg(-30), text: 'HOCHJOCH 2875 m\nPASSO', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 84.4, z: 131.4, rot: deg(-90), text: 'SEILBAHN\nZUTRITT VERBOTEN', block: false },
    { type: 'sign', variant: 'wehrmacht', x: 62.4, z: 57.4, rot: deg(-90), text: 'LAWINENGEFAHR', block: false },
    { type: 'lamp', variant: 'norway_wood', x: 58.4, z: 128.6, rot: 0, block: false },
    { type: 'lamp', variant: 'norway_wood', x: 82.6, z: 128.4, rot: deg(90), block: false },
  ],
  vehicles: [
    { id: 'cablecar', vehicleType: 'cable_car', x: CAR_LOW.x, z: CAR_LOW.z, heading: Math.atan2(CAR_TOP.z - CAR_LOW.z, CAR_TOP.x - CAR_LOW.x), friendly: true,
      track: [{ ...CAR_LOW }, { ...CAR_BEND }, { ...CAR_TOP }], schedule: { mode: 'pingpong', speed: 0.85, endWait: 1e9, delay: 1e9 } },
    { id: 'mg_pass_gun', vehicleType: 'mgNest', x: 45.2, z: 104.2, heading: deg(80), gunner: 'mg_pass', driveable: true },
    { id: 'kubel', vehicleType: 'kubelwagen', x: 48.6, z: 134, heading: deg(90) },
    { id: 'lorry_df', vehicleType: 'truck', x: 66, z: 152, heading: deg(180) },
    { id: 'lorry_press', vehicleType: 'truck', x: 66, z: 160, heading: deg(180), driveable: false },
    { id: 'lorry_stores', vehicleType: 'truck', x: 66, z: 168, heading: deg(180) },
  ],
  // the team in the drop-zone rocks' west pocket (x <= 97.3), between rocks_dz_w and the snowfield: out of every cone at
  // the start, and clear of the ridge face's shadow on the screen (at the 15° default yaw the plateau's rim hides a man
  // east of x ~97.5 under it; round 8 moved them there from x 96.6-103.6, where three were drawn as x-ray silhouettes);
  // each has room to lie down and turn his body any way (rocks_dz / rocks_dz_w solidOutline above)
  commandos: [
    { role: 'greenberet', x: 97.2, z: 160.2, heading: deg(270), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1, cigarettes: 1 } },
    { role: 'driver', x: 96.8, z: 154.4, heading: deg(270), inventory: { pistol: 1, smg: 100, firstAid: 2, leeEnfield: 0 } },
    { role: 'sapper', x: 96.5, z: 159.4, heading: deg(270), inventory: { pistol: 1, bearTrap: 0, cigarettes: 2 } },
    { role: 'spy', x: 97.3, z: 159.0, heading: deg(270), inventory: { pistol: 1, firstAid: 6 } },
    { role: 'sniper', x: 96.1, z: 153.6, heading: deg(270), inventory: { sniperRifle: 5, pistol: 1, firstAid: 2 } },
  ],
  enemies: ENEMIES,
  interactables: [
    { kind: 'knapsack', id: 'knap_sap', x: 92.6, z: 77.4, ownerRole: 'sapper', contents: { remoteBomb: 1, detonator: 1, grenade: 3, wireCutters: 1, bearTrap: 1 } },
    { kind: 'knapsack', id: 'knap_drv', x: 96.4, z: 77.2, ownerRole: 'driver', contents: { leeEnfield: 50 } },
    { kind: 'pushable', id: 'bowser', variant: 'tank', x: 76.4, z: 140.6, heading: 0, size: [4, 2] },
  ],
  items: [],
  zones: [
    // (alarm.zoneAt takes the first match: the hotel before the snowfield it cuts into)
    { id: 'z_hotel', poly: [[40, 106], [100, 106], [100, 136], [88, 136], [88, 176], [40, 176]], onSeen: 'RHOT', onHeard: 'RHOT', siren: true, heardLocal: true },
    { id: 'z_hamlet', poly: [[20, 176], [100, 176], [100, 200], [20, 200]], onSeen: 'RHAM', onHeard: 'RHAM', heardLocal: true },
    { id: 'z_summit', poly: [[104, 0], [120, 0], [120, 200], [104, 200]], onSeen: 'RSUM', onHeard: 'RSUM', heardLocal: true },
    { id: 'z_pass', poly: [[24, 0], [80, 0], [80, 106], [24, 106]], onSeen: 'RPASS', onHeard: 'RPASS' },
    { id: 'z_snow', poly: [[80, 0], [104, 0], [104, 200], [100, 200], [100, 170], [88, 170], [88, 136], [100, 136], [100, 106], [80, 106]], onSeen: 'RSNOW', onHeard: 'RSNOW', heardLocal: true },
  ],
  jails: [],
  barracks: {
    hotel: { pool: 6, squads: [
      { event: 'RHOT', size: 3, exitVel: 2.7, exitRoute: [P(64, 127.5), P(64, 133)], loopVel: 1.8, loop: [P(64, 133), P(80, 133), P(90, 130.5), P(84, 112), P(60, 109), P(48, 120), P(50, 133)] },
      { event: 'RHOT', size: 3, exitVel: 2.7, exitRoute: [P(64, 127.5), P(52, 124), P(51, 108)], loopVel: 1.8, loop: [P(51, 108), P(56, 98), P(52, 108), P(50, 124)] },
    ] },
  },
  climbLinks: [],
  ladders: [],
  triplines: [],
  setpieces: [
    { type: 'e07', id: 'e07' },
    // the cornice: a charge at its foot brings it down (scripts/e07.js closePass buries the gallery and the road)
    { type: 'collapse', id: 'cornice', at: CORNICE_AT, r: 4, by: ['bomb'] },
    // the quiet-or-lose rule (BCD `evidence`, missions/setpieces-bcd.js): the plates are a hand device on the press lorry's
    // tailboard (o2); on the hotel's alarm the Feldwebel pf1, while free, goes to the case and smashes them (30 s, Easy 45)
    { type: 'evidence', id: 'plates', at: PLATE_CASE, label: 'Type plates', objective: 'o2', take: 1.2, mesh: false,
      burn: { actor: 'pf1', at: SMASH_AT, events: ['RHOT'], time: { easy: 45, hard: 30 }, face: 225,
        warn: 'The Feldwebel is smashing the type plates!', fail: 'THE PLATES ARE SCRAP. APRIL\'S KEYS ARE GONE.' } },
    // keepAboard: the riders stay in the car at the ridge station (the win is the car docking there with everyone aboard)
    { type: 'cable_car', id: 'cablecar_line', vehicle: 'cablecar', keepAboard: true,
      stations: [{ at: [CAR_LOW.x, CAR_LOW.z], y: CAR_LOW.y, exit: [CAR_LOW.x + 0.4, CAR_LOW.z + 2.6] }, { at: [CAR_TOP.x, CAR_TOP.z], y: CAR_TOP.y, exit: [CAR_TOP.x + 2.2, CAR_TOP.z + 1.6] }] },
  ],
  triggers: [
    { on: 'objective', match: { id: 'o4', status: 'failed' }, once: true, do: [{ fail: 'VERING IS DEAD.' }] },
    { on: 'objective', match: { id: 'o1', status: 'done' }, once: true, do: [{ message: 'The Sapper has his charges back.', kind: 'objective' }] },
    { on: 'area', area: { x: 94.5, z: 75.6, r: 7 }, who: 'commando', once: true, do: [{ message: 'The container: split open, the parachute tangled round it. Each man takes his own pack.', kind: 'info' }] },
  ],
  script: e07Script(buildE07Art, buildE07ArtG),
  objectives: [
    { id: 'o1', text: 'Recover the Sapper\'s demolition pack from the container', type: 'script', required: true },
    { id: 'o1b', text: 'Recover the Driver\'s rifle from the container', type: 'script', required: false },
    { id: 'o2', text: 'Take the type plates from the press lorry', type: 'script', required: true },
    { id: 'o3', text: 'Close the pass: bring down the cornice, or burn the bowser in the tunnel', type: 'script', required: true },
    { id: 'o4', text: 'Take Major Vering alive to the cable car', type: 'deliver', targets: ['vering'], required: true },
    { id: 'o5', text: 'Everyone into the cable car: it takes you over the ridge', type: 'escape', required: true },
  ],
  extraction: { vehicleId: 'cablecar', exit: CAR_EXIT },
  rules: { explosionHearing: 45 },
  alarmFail: null,
  par: { time: 1080 },
  cameraStart: { x: 95, z: 151, zoom: 1 },
  variants: {
    easy: {
      par: { time: 1180 }, routeSpeedMul: 0.8, pauseMul: 2.5,
      // (design §12: on Easy op2 looks a little more down the slope at his south end, and cv1 looks south, down the lorry
      // line, at his north end — not east at the bowser and the station lane)
      enemyPatch: {
        op2: { route: { type: 'PINGPONG', vel: 1.0, points: [P(EDGE, 60, 10, 180), P(EDGE, 93, 10, 200)] } },
        cv1: { route: { type: 'PINGPONG', vel: 1.0, points: [P(62.6, 147.8, 6, 90), P(62.6, 172.5, 6, 90)] } },
      },
    },
    hard: {
      par: { time: 1080 },
      // (design §12: wider sweeps for the hotel door, the dock and the press lorry's Feldwebel)
      enemyPatch: { h1: { post: { heading: deg(90), sweep: 70 } }, cs2: { post: { heading: deg(200), sweep: 60 } }, pf1: { post: { heading: deg(15), sweep: 70 } } },
    },
  },
};

registerExpansionMission(MISSION);
export default MISSION;
