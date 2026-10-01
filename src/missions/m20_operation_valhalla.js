/**
 * BEL Mission 20 — "Operation Valhalla" (buildable layout: docs/missions/m20.md). Owned by MISSIONS.
 * Gundelfingen castle, north of Freiburg, 11 February 1945: the campaign's last mission and the only one with all
 * six men. An octagonal fortress on a crag, its floor stepping down from the château HQ (NW, y 13) through the
 * terraces and a continuous wall walk (y 7) to the courts. The Green Beret and the Spy start behind a rock under
 * the W wall (the castle's single climb spot); the Sniper, Marine, Sapper and Driver in the E fields. Blow up the
 * HQ (Sapper's charges only), destroy both V2s on their trailers, then all six leave in the Panzer III by the SW
 * gate. The firing range forgives pistol shots, a lever by a flashing red lamp opens the underwater water gate,
 * the Spy's uniform hangs on a line in the W quarter, and a fixed anti-tank gun covers the tank.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). All positions are TRUE plan positions (dossier §1: painted z +
 * 1.19·y already applied). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (see the commit message):
 *  - levels are `cliff` polygons raised cell by cell (the M5/M12 method), drawn as prisms by scripts/m20.js;
 *    stairs are `ladders[]` with kind 'stairs' (the M6/M9/M12 method); the wall walk crosses the two gate arches
 *    and the water gate on short plank links (a cell cannot be both a walk at y 7 and a passage at y 0);
 *  - the T_n rampart's SE corner is cut (104–108, 26–32) and the ammunition wagon moved to (84,58) so the Sniper's
 *    41 m shot from e44's post at the AT gunner is clear (§14 E6); the inner gatehouse's E stair (S_ge) is left
 *    out (nothing uses it); huts, crates and a few posts move ≤ 3 m off the roads and footprints;
 *  - the roof rule is switched off by `rules.roofRule: false` (§14 E1, read by ai/perception.js);
 *  - e55 is the atgun's linked gunner; scripts/m20.js marks him `elevated` so knife and syringe refuse him (§14 E5;
 *    the rifle, the pistol and a bomb do not) and fires the gun's cannon at the Panzer III while he lives and sees
 *    it move with a commando at its controls (the engine's linked gunner only fires his rifle): shoot him before
 *    the tank's first move;
 *  - the AT gun sits at (77, 50.5) and the tank at (83, 37): the cannon's 13.5 m minimum range, the Sniper's line
 *    (43.6 m) clear of blk_n, the crates and the first V2 (moved to (96, 50));
 *  - the whole-map zone fires RINT (the engine's siren event), the dossier's RALL;
 *  - the HQ is a bomb-only destructible; the engine's explosive-target radius (half its long side + 3 m) stands
 *    for "within 3 m of the footprint" (§14 E4, no marker).
 */

import { plateauWalkways, rectPoly } from './scripts/m05.js';
import { m20Script } from './scripts/m20.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)

/** Level heights (dossier §4.3). */
export const Y = { WB: 4, NE: 4, NW: 7, BAT: 7, SW: 10, N: 10, HQ: 13, ROOF: 20, TUR: 26 };

// ---------------------------------------------------------------- levels (dossier §4.3, true metres)
/** The HQ terrace (y 13): the dossier's rect minus the château's footprint. */
export const T_HQ = [[4, 62], [26.5, 62], [26.5, 52], [38, 52], [38, 78], [4, 78]];
export const T_SW = [[22, 78], [38, 78], [38, 91], [22, 91]];
export const T_NW = [[38, 32], [56, 32], [56, 72], [38, 72]];
/** The N range roof / rampart (y 10), its SE corner cut for the Sniper's line (§14 E6). */
export const T_N = [[38, 14], [108, 14], [108, 26], [104, 32], [38, 32]];
/** The W bastion terrace (y 4) plus the inner gatehouse's W tower top. */
export const T_WB = [[56, 42], [69.2, 42], [69.2, 70], [64, 70], [64, 62], [56, 62]];
/** The NE terrace (y 4), clipped S of the rampart (z ≥ 32). */
export const T_NE = [[102, 32], [112, 32], [128, 45], [128, 51], [102, 51]];
/**
 * Parapets: raised one-cell strips 1.4 m above their level. The grid's 2.5D sight test lets a raised cell block
 * only when it is higher than both ends, so a bare terrace edge hides nobody from the ground; these strips stand
 * for the edge and its parapet [P "keep to the centre of the path"].
 *  - T_hq's S edge and its E edge where the W quarter's yard meets it (z ≥ 72.5), T_sw's E and S edges: the S strip
 *    of the HQ terrace (where e1 walks and the climb lands) and the SW bastion are out of sight of the W quarter
 *    (e29–e32), T_nw and the SW battlements (e7). The climbs and ladders cross them on their links. The forecourt
 *    stays open to the yard by T_nw's corner, so a tank there can still shell the door guards.
 *  - the balustrade (z 68.75, x 4–23 and 33.5–37.4, open between) between the château's forecourt and the S strip:
 *    the door guards (e35, e36, facing S) and e40 do not see e1 walk the strip's W half or his body there ("out of
 *    sight" [ooc]); e37's walk S and e40 do not see e2's post by the searchlight ("no need to hide the body" [ooc]).
 *    Through the opening a tank in the yard still reaches the door guards and e39.
 *  - T_n's S edge by e49's post: the N court (e50) does not see him knifed.
 * The turret (y 26) still sees and is seen over all of them [P "some of the soldiers below can see the tower"].
 */
export const PARAPET_H = 1.4;
export const PARAPETS = [
  ['t_par_hq_e', [[37.4, 72.5], [38, 72.5], [38, 78], [37.4, 78]], Y.HQ],
  ['t_par_hq_s', [[22, 77.5], [37.4, 77.5], [37.4, 78], [22, 78]], Y.HQ],
  ['t_par_sw_e', [[37.4, 78], [38, 78], [38, 91], [37.4, 91]], Y.SW],
  ['t_par_sw_s', [[22, 90.4], [38, 90.4], [38, 91], [22, 91]], Y.SW],
  ['t_par_hq_b', [[4, 68.5], [23, 68.5], [23, 69], [4, 69]], Y.HQ],
  ['t_par_hq_b2', [[33.5, 68.5], [37.4, 68.5], [37.4, 69], [33.5, 69]], Y.HQ],
  ['t_par_n', [[92, 31.4], [104, 31.4], [104, 32], [92, 32]], Y.N],
];
/** The crag under the HQ and the W wall (impassable). */
const CRAG = [[0, 10], [40, 10], [40, 14], [38, 14], [38, 32], [27, 32], [27, 38], [4.5, 38], [4.5, 79], [22, 80], [22, 82], [0, 82]];
const FOREST = [[0, 0], [157, 0], [157, 18], [140, 24], [118, 12], [40, 9], [0, 12]];

// ---------------------------------------------------------------- water and roads (dossier §4.5 T3–T5)
/** The moat: 4 m outside the curtain, from the SW bastion round S, SE and E to the pond. */
export const MOAT = [[31, 96], [49.8, 114.2], [55.1, 120.8], [60.7, 121.6], [97.7, 132.3], [101.2, 131.9], [141.7, 100.6], [143.5, 97], [143.5, 74]];
export const POOL = { x: 131, z: 79, w: 4.5, d: 8 };
export const CHANNEL = { x: 135.5, z: 81, w: 6, d: 2.5 };
/** The water gate's wall cells (blocked while shut; the set-piece `wg_ctl`). */
export const WATER_GATE = { x: 136.5, z: 81, w: 5, d: 2.5 };
export const LEVER = [135.8, 75.5];
const ROAD_SW_OUT = [[54, 125.5], [48, 130], [32, 141], [0, 157]];
const ROAD_SE_OUT = [[124.5, 122.5], [140, 138], [157, 147]];
/** Inside: SW gate → junction → tunnel → N court; junction → SE gate; junction → the E road court. */
export const ROAD_IN = [[58, 110], [66, 102], [80, 93], [76, 82], [72, 72], [72, 56], [80, 46]];
const ROAD_SE_IN = [[80, 93], [98, 99], [113.5, 111.5]];
const ROAD_E = [[80, 93], [95, 86], [108, 74], [116, 62], [104, 56]];
export const RANGE = [[100, 68], [118, 68], [135, 72], [135, 106], [122, 106], [108, 104], [100, 98]];

const TERRAIN = [
  { type: 'poly', terrain: 'mud', points: RANGE },
  { type: 'rect', terrain: 'mud', x: 40, z: 74, w: 22, d: 30 }, // the W quarter's yards
  { type: 'rect', terrain: 'road', x: 70, z: 33, w: 32, d: 29 }, // the N court's cobbles
  { type: 'rect', terrain: 'road', x: 104, z: 52, w: 16, d: 14 }, // the E road court
  { type: 'path', terrain: 'road', width: 5, points: ROAD_SW_OUT },
  { type: 'path', terrain: 'road', width: 5, points: ROAD_SE_OUT },
  { type: 'path', terrain: 'road', width: 5, points: ROAD_IN },
  { type: 'path', terrain: 'road', width: 4, points: ROAD_SE_IN },
  { type: 'path', terrain: 'road', width: 4, points: ROAD_E },
  // last: water over everything else
  { type: 'path', terrain: 'water', width: 4, points: MOAT },
  { type: 'circle', terrain: 'water', x: 143.5, z: 73, r: 3 },
  { type: 'rect', terrain: 'water', ...CHANNEL },
  { type: 'rect', terrain: 'water', ...POOL },
];

// ---------------------------------------------------------------- structures (dossier §5)
const rock = (id, x, z, r, h = 2.5) => ({ id, type: 'rocks', variant: 'rock_limestone_frost', x, z, rot: 0, w: 2 * r, d: 2 * r, h, block: 2 });
const tree = (x, z, k) => ({ id: `pine_${k}`, type: 'pine', variant: 'pine_frost', x, z, r: 0.45, h: 11 + (k % 4), seed: 2000 + k });
const level = (id, variant, points, y, holes = []) => ({ id, type: 'cliff', variant, mat: 'stone', points, h: y, block: 2,
  walkways: plateauWalkways(points, holes, y) });
/** A curtain stretch: 5 m of limestone, its whole top a wall walk at y 7 (dossier §4.3 BAT). */
const curtain = (id, points, h = Y.BAT) => ({ id, type: 'castle_wall', variant: 'curtain_limestone_crenellated', points, width: 5, h, mat: 'stone',
  walkways: [{ points, width: 5, y: Y.BAT }] });
const hut = (id, x, z, rot, extra = {}) => ({ id, type: 'hut', variant: 'hut_timber_barrack', x, z, rot: deg(rot), w: 10, d: 6, h: 4, mat: 'planks', ...extra });
const crates = (id, x, z, w = 1.4, d = 1.4, extra = {}) => ({ id, type: 'crates', variant: 'crates_ammo', x, z, rot: 0, w, d, h: 1.1, block: 1, ...extra });
const bags = (id, x, z, rot, w) => ({ id, type: 'sandbags', x, z, rot: deg(rot), w, d: 0.8, h: 1.0 });
const pole = (x, z, k) => ({ id: `pole_${k}`, type: 'telegraph_pole', x, z, r: 0.2, h: 7 });
/** A gatehouse (two roofed towers, an open arch between them) with its tower tops on the wall walk. */
const gatehouse = (id, label, x, z, rot) => {
  const r = deg(rot), c = Math.cos(r), s = Math.sin(r);
  const at = (lx, lz) => [+(x + lx * c - lz * s).toFixed(2), +(z + lx * s + lz * c).toFixed(2)];
  return { id, type: 'castle_gate', variant: 'gatehouse_twin_tower_slate', label, x, z, rot: r, w: 12, d: 8, h: 10, mat: 'stone',
    walkways: [-4, 4].map((lx) => ({ points: [at(lx, -3.5), at(lx, 3.5)], width: 3.5, y: Y.BAT })) };
};

/** §5.1 the curtain, the gates, the retaining levels (listed before the terraces: a later raise wins). */
const CURTAIN = [
  curtain('cw_sw', [[33, 91], [52.3, 110.3]]),
  gatehouse('gh_sw', 'South-west gate', 57, 114, 15),
  curtain('cw_s', [[61.5, 117.5], [99, 128], [112, 117.8]]),
  gatehouse('gh_se', 'South-east gate', 116, 114, -45),
  // the timber bridges over the moat, on each gate's axis
  { id: 'br_sw', type: 'bridge', variant: 'bridge_timber_moat_lanterns', x: 55.06, z: 121.25, rot: deg(105), w: 9, d: 4.5, h: 0.5 },
  { id: 'br_se', type: 'bridge', variant: 'bridge_timber_moat', x: 121.3, z: 119.3, rot: deg(45), w: 9, d: 4.5, h: 0.5 },
  curtain('cw_e1', [[119.8, 110.3], [139, 97], [139, 83.6]]),
  curtain('cw_e2', [[139, 80.9], [139, 50], [134, 46], [106, 20.2]]),
  { id: 'cw_w', type: 'castle_wall', variant: 'curtain_limestone_crag', points: [[4, 78.5], [22, 79.5]], width: 4, h: Y.HQ, mat: 'stone' },
  { id: 'bartizan_s', type: 'watchtower', variant: 'bartizan_round_decor', x: 99, z: 130.8, w: 1.2, d: 1.2, h: 8.5, deckY: 0.1 },
  // the inner gatehouse between the S courts and the N court (its W tower top belongs to T_wb)
  { id: 'gh_in', type: 'castle_gate', variant: 'gatehouse_inner_portcullis', label: 'Inner gate', x: 72, z: 66, rot: 0, w: 16, d: 8, h: 8, mat: 'stone' },
  { id: 'crag', type: 'cliff', variant: 'crag_limestone', mat: 'rock', points: CRAG, h: Y.HQ, block: 2 },
  { id: 'forest', type: 'pine', variant: 'forest', points: FOREST, h: 16, block: 2 },
];

/** §4.3 the raised levels (prisms drawn by scripts/m20.js); the turret after T_hq (its deck wins). */
const LEVELS = [
  level('t_ne', 'terrace_limestone', T_NE, Y.NE, [{ poly: rectPoly(119, 42, 10, 6, deg(45)) }]), // blk_ne stands on it
  level('t_wb', 'terrace_limestone', T_WB, Y.WB),
  level('t_nw', 'terrace_limestone', T_NW, Y.NW),
  level('t_n', 'range_roof_rampart', T_N, Y.N),
  level('t_sw', 'bastion_limestone', T_SW, Y.SW),
  level('t_hq', 'terrace_limestone', T_HQ, Y.HQ),
  // parapets and the forecourt balustrade (1.4 m stone, one cell): edge cover for the terraces [P "keep to the centre"]
  ...PARAPETS.map(([id, poly, y]) => ({ id, type: 'cliff', variant: 'parapet_limestone', mat: 'stone', points: poly, h: y + PARAPET_H, block: 0,
    walkways: plateauWalkways(poly, [], y + PARAPET_H) })),
  { id: 'turret', type: 'watchtower', variant: 'turret_round_crenellated', label: 'Turret', x: 29, z: 57, rot: 0, w: 5, d: 5, h: Y.TUR, deckY: Y.TUR },
];

/** §5.2 buildings. The château (o1) is lifted onto its terrace by the script. */
export const HQ = { id: 'hq', type: 'house', variant: 'chateau_hq', label: 'Headquarters', x: 15.5, z: 50, rot: 0, w: 22, d: 24, h: 20,
  mat: 'stone', roof: 'roofSlate', flag: true, destructible: true, bombOnly: true, baseY: Y.HQ,
  walkways: [{ points: [[19.5, 60], [26, 60]], width: 3, y: Y.ROOF }] }; // the roof ledge under the turret (NL "the ladder up")
const BUILDINGS = [
  HQ,
  { id: 'hq_wing', type: 'house', variant: 'chateau_wing', x: 32.25, z: 42, rot: 0, w: 11.5, d: 20, h: 8, mat: 'stone', roof: 'roofSlate', baseY: Y.HQ },
  { id: 'n_range', type: 'house', variant: 'castle_range_block', x: 71, z: 23, rot: 0, w: 66, d: 18, h: Y.N, mat: 'stone' }, // T_n is its roof
  { id: 'blk_n', type: 'house', variant: 'stair_tower', x: 90, z: 35.5, rot: 0, w: 8, d: 5, h: Y.N, mat: 'stone', roof: 'roofSlate' },
  { id: 'blk_ne', type: 'house', variant: 'stair_block', label: 'Stair block', x: 119, z: 42, rot: deg(45), w: 10, d: 6, h: 3.5, mat: 'stone',
    roof: 'roofSlate', baseY: Y.NE, enterable: true, door: deg(90) },
  { id: 'bk_e', type: 'barracks', variant: 'house_half_timber_turret', label: 'Range barracks', x: 126, z: 62.5, rot: 0, w: 12, d: 11, h: 12,
    mat: 'plaster', roof: 'roofSlate', flag: true, garrison: true, door: deg(90), destructible: true },
  { id: 'bk_s', type: 'barracks', variant: 'hut_timber_barrack', label: 'Barracks', x: 76, z: 97, rot: deg(-30), w: 11, d: 7, h: 4.5,
    mat: 'planks', flag: true, garrison: true, door: deg(270), destructible: true },
  { id: 'h_st', type: 'house', variant: 'house_half_timber_steeple', x: 66, z: 86, rot: deg(-30), w: 10, d: 7, h: 7, mat: 'plaster', roof: 'roofSlate' },
  hut('h_w1', 54, 82, -30), hut('h_w2', 50, 96, -30), hut('h_w3', 60, 100.5, -30, { w: 8, d: 5 }),
  hut('h_s1', 88, 106, -30), hut('h_s2', 72, 110, -30),
  hut('h_s3', 88, 118, 20, { label: 'Hut', enterable: true, door: deg(270) }),
  hut('h_s4', 96, 106, -30, { w: 8 }), hut('h_s5', 105, 116, 20, { w: 8, d: 5 }),
  { id: 'h_tur', type: 'house', variant: 'house_turret_small', x: 95, z: 118.5, rot: 0, w: 4, d: 4, h: 8, mat: 'plaster', roof: 'roofSlate' },
  { id: 'outhouse', type: 'hut', variant: 'outhouse', x: 44, z: 78.5, rot: 0, w: 1.5, d: 1.5, h: 2.5, mat: 'planks' },
  { id: 'shelter', type: 'hut', variant: 'open_shed_bench', x: 104.5, z: 89, rot: deg(-30), w: 4, d: 8, h: 3, mat: 'planks', block: 1 },
];

/** §5.3 the two V2s on their trailers (o2) and the N court's hardware. */
export const V2S = ['v2a', 'v2b'];
const v2 = (id, x, z) => ({ id, type: 'v2_rocket', variant: 'v2_meillerwagen_lying', label: 'V2 rocket', x, z, rot: deg(30), w: 14, d: 3, h: 3,
  destructible: true, grenadeDestructible: true });
const MILITARY = [
  v2('v2a', 96, 50), v2('v2b', 94, 65),
  { id: 'wagon_ammo', type: 'train_car', variant: 'covered_wagon_shells', x: 84, z: 58, rot: deg(30), w: 5, d: 2.5, h: 2.5, block: 2 },
  { id: 'wagon_crate', type: 'train_car', variant: 'covered_wagon', x: 85, z: 50, rot: deg(30), w: 5, d: 2.5, h: 2.5, block: 2 },
  crates('crates_n1', 93.5, 42.5), crates('crates_n2', 96, 43),
  { id: 'flak_court', type: 'aa_gun', variant: 'flak38_quad_towed', x: 86, z: 73.5, rot: 0, w: 4, d: 2.5, h: 2.2, block: 1 },
  { id: 'flak_road', type: 'aa_gun', variant: 'flak38_quad_towed', x: 111, z: 66.5, rot: 0, w: 4, d: 2.5, h: 2.2, block: 1 },
  // the AT gun's sandbag half-ring, open to the N (the gun faces the tank)
  bags('atgun_bag_w', 74.8, 51.5, 80, 2.6), bags('atgun_bag_s', 77, 52.9, 0, 2.6), bags('atgun_bag_e', 79.2, 51.5, 100, 2.6),
  bags('sandbag_se', 108, 108, 45, 3), // the SE gate's inner corner [fd]
  // on the terraces (visual only: lifted by the script; raised cells carry no block)
  { id: 'flak_hq', type: 'flak', variant: 'flak38_quad_round_emplacement', x: 35.5, z: 55, r: 2.2, h: 1, block: 0, baseY: Y.HQ },
  { id: 'flak_n', type: 'flak', variant: 'flak38_quad_round_emplacement', x: 88, z: 19, r: 2.2, h: 1, block: 0, baseY: Y.N },
  { id: 'gun_hq', type: 'aa_gun', variant: 'towed_field_gun', x: 22, z: 70, rot: 0, w: 3, d: 2, h: 1.6, block: 0, baseY: Y.HQ },
  crates('crates_hq1', 27, 66, 1.4, 1.4, { block: 0, baseY: Y.HQ }), crates('crates_hq2', 29, 67.5, 1.4, 1.4, { block: 0, baseY: Y.HQ }),
  crates('crates_n3', 64, 28, 1.4, 1.4, { block: 0, baseY: Y.N }), crates('crates_n4', 66, 30, 1.4, 1.4, { block: 0, baseY: Y.N }),
  { id: 'sl_hq', type: 'searchlight', x: 37, z: 76.5, r: 0.6, h: 1.8, block: 0, baseY: Y.HQ },
  { id: 'sl_t', type: 'searchlight', x: 30, z: 58.5, r: 0.6, h: 1.8, block: 0, baseY: Y.TUR },
  { id: 'sl_n', type: 'searchlight', x: 93, z: 30, r: 0.6, h: 1.8, block: 0, baseY: Y.N },
  // the poles stand ≥ 4 m off the roads' centrelines (pole_1 off the SW exit road: the tank's way out)
  ...[[22, 140], [10, 147], [34, 130], [124, 128], [137, 134], [148, 142]].map(([x, z], k) => pole(x, z, k)),
  { id: 'lamp_rng', type: 'lamp_post', x: 108, z: 84.5, r: 0.2, h: 4 },
];

/** §5.4 the firing range, the well, the pool and the water gate. */
const RANGE_PROPS = [
  { id: 'range', type: 'firing_range', variant: 'firing_range_targets', x: 120, z: 74, rot: 0, w: 14, d: 4, h: 1.2 },
  ...[[115, 78], [118, 82], [124, 83], [127, 88], [121, 94], [117, 98.5], [112, 99.5]].map(([x, z], k) =>
    ({ id: `tgt_${k + 1}`, type: 'sign', variant: 'target_frame_silhouette', x, z, rot: 0, w: 1, d: 0.3, h: 1.8, block: 1 })),
  { id: 'stop_1', type: 'fence', variant: 'bullet_stop_timber_sandbag', points: [[116.5, 71.5], [122, 75.5]], width: 0.8, h: 2.2, block: 2 },
  { id: 'stop_2', type: 'fence', variant: 'bullet_stop_timber_sandbag', points: [[128.5, 93], [131, 100]], width: 0.8, h: 2.2, block: 2 },
  { id: 'stop_3', type: 'fence', variant: 'bullet_stop_timber_sandbag', points: [[116, 105], [124, 100]], width: 0.8, h: 2.2, block: 2 },
  { id: 'well', type: 'well', x: 128, z: 77.5, r: 0.9, h: 1, block: 1 },
  { id: 'water_gate', type: 'water_gate', variant: 'water_gate_grated_arch', x: 139, z: 82.25, rot: deg(90), w: 2.7, d: 5, h: 3 },
  { id: 'lever_box', type: 'lever', variant: 'lever_box_red_lamp', x: LEVER[0], z: LEVER[1], rot: 0 },
];

/** §4.5 T8/T9 rocks and single pines. `rk_w1` covers the W group, `rk_e2` the E group, `rk_e7` the SE bridge. */
const NATURE = [
  rock('rk_w1', 10.5, 87, 3), rock('rk_w2', 20, 115, 3), rock('rk_w3', 14, 122, 1.5), rock('rk_w4', 15, 141, 2.5),
  rock('rk_w5', 46, 140.5, 2.5), rock('rk_w6', 42, 150, 2),
  rock('rk_e1', 130, 27, 1.8), rock('rk_e2', 148, 34, 3), rock('rk_e3', 137, 40, 2.5), rock('rk_e4', 149, 50, 1.5),
  rock('rk_e5', 150, 68, 2.5), rock('rk_e6', 150, 98, 2.5), rock('rk_e7', 130, 128, 2.5),
  ...[[33, 118], [37, 129], [146, 60], [152, 88], [134, 150], [152, 108], [145, 26], [153, 22], [6, 105]].map(([x, z], k) => tree(x, z, k)),
];

const STRUCTURES = [...CURTAIN, ...LEVELS, ...BUILDINGS, ...MILITARY, ...RANGE_PROPS, ...NATURE];

// ---------------------------------------------------------------- links (dossier §6.1): climbs (GB), ladders + stairs (everyone)
/** The castle's single climb spot: the W wall below the HQ [P][DE "only one possibility"][NL][ooc]. */
export const CLIMB_W = { id: 'cl_w', a: [15, 76.5, Y.HQ], b: [15, 83, 0], roles: ['greenberet'] };
const CLIMBS = [
  CLIMB_W,
  { id: 'cl_in', a: [30, 77, Y.HQ], b: [30, 80, Y.SW], roles: ['greenberet'] }, // "the drainpipe" [fd]: T_hq → the SW bastion
];
const ladder = (id, bottom, top, heading, extra = {}) => ({ id, x: bottom[0], z: bottom[1], y: bottom[2] ?? 0, top, raised: false, heading: deg(heading), ...extra });
const stairs = (id, bottom, top, heading) => ladder(id, bottom, top, heading, { kind: 'stairs' });
const plank = (id, a, b, heading) => ladder(id, a, b, heading, { kind: 'plank' });
/** The Sniper's firing point (e44's post) and the AT gunner (§14 E6: 41 m, inside the rifle's 45 m). */
export const SNIPER_POST = { x: 114, z: 27.5, y: Y.BAT };
export const TANK_AT = { x: 83, z: 37 };
export const ATGUN = { x: 77, z: 50.5 }; // ≥ 13.5 m (the cannon's minimum range) from the tank
export const L_RNG = ladder('L_rng', [134.5, 71, 0], [138.5, 71, Y.BAT], 0); // "the ladder down into the firing range" [P]
const LADDERS = [
  ladder('L_in', [36.5, 80, Y.SW], [36.5, 77, Y.HQ], 270), // everyone's way between the SW bastion and T_hq (the Sapper's)
  ladder('L_hq1', [24.5, 63.5, Y.HQ], [24.5, 60.5, Y.ROOF], 270), // T_hq → the HQ roof ledge
  ladder('L_hq2', [25.5, 60, Y.ROOF], [27.8, 58, Y.TUR], 315), // the roof ledge → the turret deck ("the small ladder")
  L_RNG,
  stairs('S_sw', [37, 95.5, Y.BAT], [35, 89.5, Y.SW], 250), // T_sw → the SW battlements
  stairs('S_nw2', [41, 66, Y.NW], [36.5, 63, Y.HQ], 215), // T_nw → T_hq ("the stairs in front of the flak" [NL])
  stairs('S_n3', [47.5, 34, Y.NW], [47.5, 30.5, Y.N], 270), // T_nw ↔ T_n
  stairs('S_nw1', [58.5, 50, Y.WB], [54.5, 50, Y.NW], 180), // T_wb ↔ T_nw
  stairs('S_gw', [61, 77, 0], [66, 68.5, Y.WB], 300), // the W quarter ↔ T_wb: "the stairs by 32's post" [P]
  stairs('S_n', [90.5, 40, 0], [90.5, 31, Y.N], 270), // blk_n: the N court ↔ T_n ("the big stairs" [DE])
  stairs('S_ne1', [98.5, 42, 0], [103, 42, Y.NE], 0), // the N court ↔ T_ne (the Driver's way to the tank)
  stairs('S_e', [113.5, 58, 0], [113.5, 50, Y.NE], 270), // the E road court ↔ T_ne
  stairs('S_ne2', [125, 46.5, Y.NE], [129.5, 41.5, Y.BAT], 315), // T_ne ↔ the NE battlements (by blk_ne)
  stairs('S_ne3', [111, 25, Y.BAT], [106, 21.5, Y.N], 215), // the NE battlements ↔ T_n
  // the wall walk over the two gate arches and the water gate (the passages below stay at ground level)
  plank('P_gsw', [54.07, 113.26, Y.BAT], [59.93, 114.74, Y.BAT], 15),
  plank('P_gse', [113.9, 116.1, Y.BAT], [118.1, 111.9, Y.BAT], 315),
  plank('P_wg', [139, 85, Y.BAT], [139, 79.5, Y.BAT], 270),
];

// ---------------------------------------------------------------- enemies (dossier §8; `prima` = Prima's soldier number)
// Nobody arrests in the castle (no cells): jail false everywhere. Heights: `y` = the level the man stands on.
const at = (y) => (y ? { y } : {});
/**
 * Sweep period per post, 9–12 s from the id: the engine's random phase is under a second, so equal periods would
 * keep every sentry's sweep in step for the whole mission and some blind windows would never open.
 */
export const sweepPeriod = (id) => 9 + ([...id].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7) % 7) / 2;
/** Post guard: holds his post and investigates bodies only (§8 default). */
const sentry = (id, prima, x, z, y, h, sweep, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, ...at(y), heading: deg(h), jail: false,
  flags: { holdsPost: true, investigates: false }, post: { heading: deg(h), sweep, period: sweepPeriod(id) }, ...extra,
});
/** Lone walker: PINGPONG over `pts` (1.0 m/s) from the first point, facing the second. */
const walker = (id, prima, y, pts, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: pts[0].x, z: pts[0].z, ...at(y), jail: false,
  heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x), flags: { investigates: true }, route: { type: 'PINGPONG', vel: 1.0, points: pts }, ...extra,
});
/** A patrol: sergeant `ids[0]` + troopers in file on one LOOP route. */
const patrol = (ids, prima, sq, points) => ids.map((id, k) => ({
  id, ...(prima ? { prima } : {}), soldierType: k ? 'trooper' : 'sergeant', x: points[0].x, z: points[0].z + 1.2 * k, jail: false,
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: !k }, squad: { id: sq, leader: ids[0], columns: 1 }, route: { type: 'LOOP', vel: 1.0, points },
}));

const HQ_MEN = [ // §8.1 the HQ terrace and the SW bastion (Prima Phase 1: the GB alone)
  walker('e1', 1, Y.HQ, [P(32, 73, 4, 90), P(7, 73, 4, 180)]),
  sentry('e2', 2, 35.5, 75.5, Y.HQ, 60, 60), // "the guard by the searchlight" [ooc]
  sentry('e3', 3, 29.5, 56.5, Y.TUR, 135, 120), // atop the turret [P][NL][fd]
  walker('e4', 4, Y.SW, [P(24, 84, 3, 180), P(36, 86, 3, 0)]),
  sentry('e5', 5, 27, 89.5, Y.SW, 80, 40), sentry('e6', 6, 31, 89.5, Y.SW, 100, 40), // "the two looking south" [ooc]
];
const WALL_MEN = [ // §8.2 the battlements, counter-clockwise (Prima Phase 2)
  walker('e7', 7, Y.BAT, [P(40, 98, 3, 225), P(84, 123.5, 3, 90)]), // over the SW gate [DE]
  sentry('e63', null, 97.5, 127.5, Y.BAT, 70, 30, { partner: 'e64' }), // the S corner: leave them alive (T3)
  sentry('e64', null, 100.5, 127, Y.BAT, 110, 30, { partner: 'e63' }),
  sentry('e8', 8, 106, 122, Y.BAT, 120, 40),
  sentry('e9', 9, 124, 108.5, Y.BAT, 135, 40), // in view of the range below [P]
  walker('e10', 10, Y.BAT, [P(139, 95, 4, 0), P(139, 86.5, 4, 0)]), // watches the E field and the moat [NL]
  sentry('e11', 11, 139, 62, Y.BAT, 0, 90),
];
const RANGE_MEN = [ // §8.3 the firing range (Prima Phase 3)
  sentry('e12', 12, 132, 73.5, 0, 200, 40),
  walker('e13', 13, 0, [P(127, 70.5, 3, 0), P(108, 70.5, 3, 180)]),
  sentry('e14', 14, 121, 79.5, 0, 135, 40),
  sentry('e18', 18, 110, 80, 0, 0, 60, { post: { heading: 0, sweep: 60, period: 12 } }), // watches the ladder corner [P]
  sentry('e15', 15, 128.5, 88.5, 0, 180, 40), // "15's post", 4 m from the pool
  sentry('e16', 16, 125, 99, 0, 270, 30),
  sentry('e17', 17, 119, 89, 0, 180, 40),
  walker('e19', 19, 0, [P(108, 95, 12, 0), P(115, 97, 5, 0)]), // the shooter, "checking his target" [P]
  sentry('e20', 20, 113, 101.5, 0, 90, 40),
  sentry('e21', 21, 105, 100.5, 0, 225, 30),
  sentry('e62', null, 102, 108.5, 0, 45, 30), // "the soldier across the street" [P]
];
/** Patrol 26 (4 men): through the SW gate, the junction, the SE gate and back round the S field outside [P][ooc][DE]. */
export const P26_ROUTE = [P(36, 140, 5, 0), P(54, 127.5), P(57, 114), P(70, 101), P(80, 93, 4, 0), P(98, 99), P(116, 114),
  P(124.5, 123), P(110, 140, 5, 90), P(70, 145)];
const SW_MEN = [ // §8.4 the SW gate and the W quarter (Prima Phase 4)
  ...patrol(['p26', 'p26b', 'p26c', 'p26d'], 26, 'p26', P26_ROUTE),
  sentry('s25a', 25, 55.5, 115.7, 0, 105, 20), sentry('s25b', 25, 57.5, 116.2, 0, 105, 20), // rear pair, in the arch
  sentry('s25c', 25, 52.5, 127.5, 0, 105, 30), sentry('s25d', 25, 58, 128.5, 0, 105, 30), // front pair, beyond the bridge
  sentry('e22', 22, 60, 107.5, 0, 60, 40),
  sentry('e23', 23, 51, 103, 0, 300, 40),
  walker('e24', 24, 0, [P(55, 101, 3, 270), P(66, 96, 3, 0)]),
  sentry('e27', 27, 69, 97, 0, 225, 40),
  sentry('e65', null, 73, 104, 0, 225, 40), // "the soldier across the street from 27" [P]
  sentry('e28', 28, 48, 91, 0, 300, 40),
  walker('e29', 29, 0, [P(48, 75, 4, 270), P(58, 76.5, 4, 0)]),
  sentry('e30', 30, 47, 84, 0, 180, 40), // watches the clothesline [P]
  sentry('e31', 31, 45.5, 80.5, 0, 90, 40), // by the outhouse [fd]
  sentry('e32', 32, 61, 78.5, 0, 180, 60), // at the foot of S_gw: "the stairs by 32's post" [P]
  sentry('e33', 33, 47, 70.5, Y.NW, 60, 50, { flags: { holdsPost: true, investigates: true } }), // "at the top of the castle": comes down [P]
  sentry('e34', 34, 53, 70.5, Y.NW, 80, 40, { flags: { holdsPost: true, investigates: true } }), // faces T_wb, his back to the HQ strip
];
const HQ_GUARD = [ // §8.5 the HQ (Prima Phase 5: the Spy in uniform)
  sentry('e35', 35, 10, 64.5, Y.HQ, 90, 40), sentry('e36', 36, 15, 64.5, Y.HQ, 90, 40), // "the 2 outside the HQ" [fd]
  // "the guard above the flak ... patrols now and then" [NL]; at his S end he looks E over T_nw, not W down the strip
  walker('e37', 37, Y.HQ, [P(35, 59, 20, 0), P(36, 66, 6, 0)]),
  sentry('e38', 38, 37, 70, Y.HQ, 0, 40),
  sentry('e39', 39, 17, 67, Y.HQ, 270, 30),
  // watches e35 and e39 (sweep 60, not the dossier's 100: his S extreme would look down on e2's post)
  sentry('e40', 40, 29, 63, Y.HQ, 180, 60, { flags: { holdsPost: true, investigates: true }, post: { heading: deg(180), sweep: 60, period: 8 } }),
];
const TANK_MEN = [ // §8.6 the tank corner (Prima Phase 6)
  sentry('e42', 42, 117.5, 69.5, 0, 180, 40), // lured by the decoy by bk_e [P]
  sentry('e43', 43, 115.5, 46.5, Y.NE, 225, 40), // at blk_ne's door
  sentry('e44', 44, SNIPER_POST.x, SNIPER_POST.z, Y.BAT, 200, 40), // his post is the Sniper's firing point
  walker('e45', 45, Y.BAT, [P(116, 29.5, 3, 180), P(131, 43.5, 4, 0)]),
  sentry('e46', 46, 106, 62, 0, 180, 40),
  sentry('e47', 47, 111, 55, 0, 90, 40),
  sentry('e48', 48, 114, 69, 0, 90, 30), // by flak_road
  sentry('e49', 49, 103, 29, Y.N, 90, 60, { flags: { holdsPost: true, investigates: true } }), // "decides to come down" [P]
  sentry('e50', 50, 104, 53.5, 0, 270, 30),
  sentry('e51', 51, 99, 59, 0, 0, 40),
  sentry('e52', 52, 100, 45, 0, 180, 40),
  walker('e53', 53, 0, [P(97.5, 74, 4, 90), P(97.5, 40, 4, 270)]),
  sentry('e54', 54, 93, 57, 0, 180, 60), // between the V2s
  { id: 'e55', prima: 55, soldierType: 'gunner', x: ATGUN.x, z: ATGUN.z, heading: deg(294), emplacement: 'atgun', elevated: true, jail: false,
    post: { heading: deg(294), sweep: 40, giro: 180 } }, // the AT gunner: shoot him (knife/syringe refused)
  sentry('e56', 56, 86, 41.5, 0, 0, 40), // beside the tank
  ...patrol(['p57', 'p57b', 'p57c'], 57, 'p57', [P(74, 42, 4, 90), P(74, 56), P(76, 76), P(100, 77), P(111, 71, 3, 0), P(104, 58), P(84, 55)]),
];
const OTHER_MEN = [ // §8.7 the SE gate and the rest
  sentry('e58', null, 116.7, 116.1, 0, 45, 20), sentry('e59', null, 118.1, 114.7, 0, 45, 20), // rear pair, in the SE arch
  sentry('e60', null, 120.5, 126, 0, 45, 30), sentry('e61', null, 126.5, 125, 0, 45, 30), // front pair, beyond the bridge
  sentry('e66', null, 88, 22.5, Y.N, 90, 60), // the N Flak's crewman
  walker('e67', null, Y.N, [P(60, 26, 6, 90), P(100, 26, 6, 90)]),
];

const ENEMIES = [...HQ_MEN, ...WALL_MEN, ...RANGE_MEN, ...SW_MEN, ...HQ_GUARD, ...TANK_MEN, ...OTHER_MEN];

// ---------------------------------------------------------------- vehicles (dossier §6.2)
const VEHICLES = [
  // the Panzer III, vacant: the Driver drives, all six ride; heavy armour (bombs and shells only)
  { id: 'pz3', vehicleType: 'panzer3', label: 'Panzer III', x: TANK_AT.x, z: TANK_AT.z, heading: deg(180), driveable: true, operators: ['driver'], seats: 6, suspicious: false },
  // the fixed anti-tank gun (never manned by us); its gunner e55 fires on the tank once a commando is at the controls
  { id: 'atgun', vehicleType: 'atgunM20', label: 'Anti-tank gun', x: ATGUN.x, z: ATGUN.z, heading: deg(294), gunner: 'e55', driveable: false },
];

// ---------------------------------------------------------------- commandos (§3.8 row 20, exact; §3.8 team order): prone behind their rocks
const COMMANDOS = [
  { role: 'greenberet', x: 9, z: 91.5, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1 } },
  { role: 'sniper', x: 152.5, z: 31, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 5 } },
  { role: 'diver', x: 154.5, z: 32.5, heading: deg(180), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  { role: 'sapper', x: 152.5, z: 35, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, bearTrap: 1, grenade: 2, remoteBomb: 2 } },
  { role: 'driver', x: 154.5, z: 36.5, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, firstAid: 6 } }, // the medic
  { role: 'spy', x: 12, z: 92.5, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, lethalInjection: 1 } }, // no uniform
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
export const Z_ALL = [[0, 0], [157, 0], [157, 162], [0, 162]];
const squad = (exitRoute, loop) => ({ event: 'RINT', size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  bk_e: { pool: 6, squads: [squad([P(124, 70), P(116, 71)], [P(116, 71), P(106, 72), P(104, 58), P(110, 62)])] },
  bk_s: { pool: 6, squads: [squad([P(78, 88)], [P(78, 88), P(80, 93), P(70, 101), P(60, 109), P(70, 101)])] },
};

/** On the SW road's last stretch, clear of the map edge so a straight drive order to its centre is accepted. */
export const EXIT = { x: 4, z: 154, r: 6 };
/** The soft-lock guard (T7): both charges spent (none in hand, none armed) and the HQ still standing. */
export const NO_CHARGES_FAIL = 'WITHOUT EXPLOSIVES THE HEADQUARTERS CANNOT BE DESTROYED.';
export const TANK_FAIL = 'THE TANK HAS BEEN DESTROYED. THERE IS NO OTHER WAY OUT.';

/** T2: the Spy is dressed once he has put the uniform on (the clothesline only puts it in his kit). */
export const spyDressed = (w) => w.commandos?.some((c) => c.role === 'spy' && c.alive !== false && c.disguised === true);

export default {
  id: 'm20',
  campaign: 'BEL',
  title: 'Operation Valhalla',
  subtitle: 'Gundelfingen castle, north of Freiburg, Germany · 11 February 1945',
  date: '1945-02-11',
  place: 'Gundelfingen castle, north of Freiburg, Germany',
  theater: 'temperate',
  variant: 'frost',
  coneColors: 'green',
  size: [157, 162],
  seed: 1945_0211,
  briefing: {
    historical: 'February 1945. The Red Army is in East Prussia and the end of the Reich is in sight. Then a coded signal shakes Allied headquarters: an enemy agent has stolen the design of Fat Man, the atomic bomb of the Manhattan Project, and carried it across the Atlantic. The plans now sit in Gundelfingen castle, north of Freiburg. From there they are to go east to a hidden laboratory in the Carpathians, where a German bomb is close to finished.',
    text: 'Officer, this is the most important job we have ever handed you, and I can tell you almost nothing about it. You will be on your own. Get inside that fortress and leave nothing standing: the headquarters, and the two rockets parked in its courtyard. Then take the tank they keep there and drive out through the south-west gate. Do this and the war may be over. Fail, and heaven help us all. Every eye in London is on you and your men. Good luck, son.',
    objectivesSummary: 'Blow up the headquarters and destroy both V2 rockets, then everyone into the Panzer III and out through the south-west gate.',
    hints: [
      'Four sentries stand at each gate. There is only one place on the walls a climber can get up: the west wall, below the headquarters.',
      'On the firing range a pistol shot is just practice. The guards may come to look, but nobody sounds the alarm for it.',
      'A lever under a flashing red lamp, inside the east wall, opens an underwater gate from the moat.',
      'A German uniform hangs on a line in the west quarter.',
      'The two sentries standing together at the south corner of the walls watch each other. Kill either one and the whole castle hears of it.',
      'A tank stands in the north courtyard. A fixed anti-tank gun covers it, and its crewman cannot be reached with a knife. One hit from that gun and the tank is finished.',
      'The headquarters is stone: only the Sapper\'s charges will bring it down, and he has two. Place one close against its walls.',
    ],
  },
  lighting: { sunElevDeg: 15, sunAzimuthDeg: 200, kelvin: 6800, hdri: 'overcast', fog: 170, lut: 'temperate_frost' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.1, color: '#1d4a4c' },
  shoreShallowWidth: 0.5, // the moat and the pool are deep to the walls: only the Marine goes in
  rules: { roofRule: false }, // §4.4 / §14 E1: the wall walks and terraces are open ground, not roofs
  baseTerrain: 'grass',
  terrain: TERRAIN,
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['gh_sw', 'br_sw'], ['gh_se', 'br_se'], ['gh_se', 'h_s5'], ['turret', 'hq'], ['turret', 'flak_hq'], ['hq', 'hq_wing'], ['hq_wing', 'n_range'], ['hq_wing', 'flak_hq'], ['n_range', 'blk_n'], ['n_range', 'flak_n'], ['h_s1', 'h_s4'], ['h_s3', 'h_tur']]),
  items: [],
  // §3.4 the Spy's uniform on the clothesline in the W quarter ('use' it: the uniform goes in his kit; he then puts it on)
  interactables: [{ id: 'uniform_line', interactKind: 'clothesline', x: 42.5, z: 87.5 }],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // one zone for the whole castle and its approaches [§7.1 "whole castle alarm"]: seen or heard → the siren
  zones: [{ id: 'z_all', poly: Z_ALL, onSeen: 'RINT', onHeard: 'RINT', siren: true }],
  jails: [],
  barracks: BARRACKS,
  climbLinks: CLIMBS,
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Blow up the headquarters', type: 'destroy', targets: ['hq'], required: true },
    { id: 'o2', text: 'Destroy both V2 rockets', type: 'destroy', targets: V2S, required: true },
    { id: 'o3', text: 'Then everyone into the tank and out through the south-west gate', type: 'escape', required: true, vehicleId: 'pz3' },
  ],
  setpieces: [
    // pistol shots inside the range are routine: guards may look, the siren never sounds for them
    { type: 'firing_range', id: 'range_sp', kinds: ['pistol'], area: { poly: RANGE } },
    // the lever under the flashing red lamp opens the underwater water gate for good
    { type: 'gate_control', id: 'wg_ctl', once: true, open: false, area: { rect: WATER_GATE },
      control: { at: LEVER, id: 'lever_wg', label: 'Lever', blink: true, roles: null } },
  ],
  triggers: [
    { on: 'start', do: [{ message: 'Gundelfingen. The headquarters, both rockets, then out in their tank.', kind: 'info' }] },
    // T1 the water gate
    { on: 'device', match: { id: 'lever_wg' }, do: [{ message: 'The water gate is open. The Marine can swim in from the moat.', kind: 'info' }] },
    // T2 the uniform
    { on: 'tick', when: (p, w) => spyDressed(w), do: [{ message: 'The Spy is in German uniform.', kind: 'info' }] },
    // T3 the S-corner pair must be left alive (§7.1, Prima Phase 2): either death sounds the siren
    { on: 'unit:killed', match: { unit: ['e63', 'e64'] }, do: [{ alarm: 'global', cause: 'scorner', x: 99, z: 127 }] },
    // T4 the tank
    { on: 'vehicle:enter', match: { vehicle: 'pz3', unit: 'driver' },
      do: [{ message: 'Panzer III. While the anti-tank gun is manned, one hit will finish it.', kind: 'warn' }] },
    // T5 progress
    { on: 'structure:destroyed', match: { id: 'hq' }, do: [{ message: 'The headquarters is gone.', kind: 'objective' }] },
    { on: 'structure:destroyed', match: { id: V2S }, once: false,
      do: [{ run: (w) => { const n = V2S.filter((id) => w.byId(id)?.destroyed).length; if (n < 2) w.events.emit('message', { text: 'One rocket destroyed.', kind: 'info' }); } }] },
    { on: 'objective', match: { status: 'done' }, when: (p, w) => ['o1', 'o2'].every((id) => w.objectives?.find((o) => o.id === id)?.done),
      do: [{ message: 'Everyone into the tank. Out through the south-west gate.', kind: 'objective' }] },
    // T6 the tank is the only way out
    { on: 'vehicle:destroyed', match: { vehicle: 'pz3' }, do: [{ fail: TANK_FAIL }] },
    // T7 soft-lock guard: no charge left and the HQ still standing
    { on: 'bomb:exploded', once: false, delay: 0.5, do: [{ run: (w, dir) => checkCharges(w, dir) }] },
  ],
  // mission glue: the prone start, the terrace prisms and stairs, lifted terrace props
  script: m20Script,
  // the player drives the tank out: all living men aboard, o1 + o2 done, inside the SW road's exit
  extraction: { vehicleId: 'pz3', exit: EXIT },
  alarmFail: null,
  par: { time: 1080 },
  cameraStart: { x: 20, z: 88, zoom: 1 },
  startDisguised: [],
  flags: { shovel: false },
};

/** T7: fail when the Sapper has no bomb left, none is armed on the map and the HQ stands. */
export function checkCharges(w, dir) {
  const hq = w.byId?.('hq');
  if (!hq || hq.destroyed) return false;
  const left = (w.commandos || []).filter((c) => c.alive !== false).reduce((n, c) => n + (c.inventory?.get?.('remoteBomb') ?? 0) + (c.inventory?.get?.('timeBomb') ?? 0), 0);
  const armed = (w.interactables || []).some((i) => i.interactKind === 'bomb' && !i.removed && !i.exploded)
    || (w.projectiles || []).some((p) => !p.removed && (p.projKind === 'remoteBomb' || p.projKind === 'timeBomb'));
  if (left || armed) return false;
  if (dir?.fail) dir.fail(NO_CHARGES_FAIL);
  return true;
}
