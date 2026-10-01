/**
 * BEL Mission 8 — "Pyrotechnics" (buildable layout: docs/missions/m08.md). Owned by MISSIONS.
 * Tell el Eisa, west of El Alamein, Egypt, 19 October 1942. The first desert map: a 4 m plateau of mud-brick
 * ruins in the N (the start yard in the NW, the 210 mm gun in the NE) looks down on an Afrika Korps supply
 * depot. The Green Beret and the Sniper must burn it: the six racks of oil barrels (o1), both fuel tanks (o2)
 * and the water reservoir (o3). Ten loose explosive barrels are the only tools; the racks go up as one chain,
 * but nothing reaches the tanks or the reservoir until the Green Beret lays barrels there. The whole map is one
 * alarm zone (seen OR heard → RINT; the first blast empties the domed barracks and the SW pillbox). Six
 * seconds after all three objectives burn, a friendly Willys jeep comes down the E track to the E end of the
 * timber bridge; the 210 mm gun and the Gatling by the bridge fire on it while their crews live (trigger
 * `hunt`), so both must be silenced first. Everyone aboard → it leaves N.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep`
 * stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Plateau positions already carry the dossier's +5 m z
 * shift (§4.1). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (grid fit / engine, see the commit message):
 *  - the plateau and both ramps are `walkways` strips (dossier fallbacks D1/D2), rendered by scripts/m08.js;
 *  - the jeep's 6 s delay is a hidden helper objective `o_burn` set by a tick trigger (no `spawnDelay`, D7);
 *    the escape itself is a hidden objective o4 shown when the jeep is called;
 *  - the gun/Gatling "fire on any vehicle" rule is the trigger verb `hunt` (fires only while crewed);
 *  - e1 stands N of the start yard's N wall (its dossier spot was inside the yard), e2 and e3 face S (their
 *    dossier headings looked straight into the start yard); the (71,27) hedgehog is left out for ramp_ne;
 *  - the bridge deck is centred on the road (z 33, not 33.5); the wadi is cut N and S of it;
 *  - the clothesline blocks movement as well as sight (no sight-only block class); e17, e18, e21 and e22
 *    stand 0.5–1.5 m off tent / house walls they overlapped.
 */

import { PLATEAU_Y, TANK_DECK_Y, ROOF_Y, segmentHoles, plateauStrips, rampWalkways, m08Script } from './scripts/m08.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (§4.1)
const Y = PLATEAU_Y;

// ---------------------------------------------------------------- terrain shapes (dossier §4)
/** T2 the plateau (elev 4). */
const PLATEAU = [[0, 0], [79, 0], [76, 6], [70, 13], [66, 20], [60, 22], [42, 23], [38, 27], [20, 27], [18, 29], [11, 33], [6, 38], [0, 43]];
/** T6 the N wadi, cut N and S of the bridge deck (z 30.5–35.5). */
const WADI_N = [[79, 0], [96, 0], [95, 30.2], [79, 30.2]];
const WADI_MID = [[78.6, 35.8], [95.6, 35.8], [96, 37], [97, 50], [99, 60], [97, 66], [92, 62], [85, 55], [80, 40], [78, 37]];
/** T7 the SE wadi round the depot's E side (±5 m about (88,58) (84,70) (78,82) (70,93) (62,105)). */
const WADI_SE = [[84, 56], [79.5, 69], [74, 80], [66, 90], [57, 105], [67, 105], [74, 96], [82, 84], [88.5, 71], [92, 60]];
/** T8 the terrace drop S of the camp (map-edge scenery). */
const DROP_S = [[0, 98], [12, 96.5], [20, 103], [30, 98], [41, 94], [70, 93], [74, 96], [74, 105], [0, 105]];

/** Ramps: the W road cut and the NE supply track to the gun ([x, z, y] ends, width, steps of ≤ 0.4 m). */
const RAMP_W = { a: [14, 30, Y], b: [15, 44, 0], width: 5, steps: 10 };
const RAMP_NE = { a: [66.2, 17.4, Y], b: [72, 29, 0], width: 3, steps: 10 };

// ---------------------------------------------------------------- the plateau (L1, y 4)
/** Ruined mud-brick walls [id, points, h]: ≥ 1.8 m block movement and sight, lower stubs are crouch cover. */
const RUIN_WALLS = [
  ['rw1', [[2, 7], [9, 5.5]], 2.2], ['rw2', [[10, 10], [13.5, 10], [13.5, 14.5]], 2.4], ['rw3', [[0, 20], [9, 16]], 1.8],
  ['rw4', [[4.5, 22], [8.5, 26]], 1.4], ['rw5', [[10, 5], [18.5, 5]], 2.2], ['rw6', [[10, 17], [18.5, 17], [18.5, 22]], 2.0],
  ['rw7', [[20, 5], [25.8, 5], [25.8, 14.6]], 2.6], ['rw8', [[20, 15.4], [24.6, 19.8]], 1.8], ['rw9', [[28, 17], [34, 24]], 2.0],
  ['rw10', [[32.5, 8.5], [39, 8.5], [39, 22]], 2.4], ['rw11', [[41, 8.5], [50, 8.5], [50, 17]], 2.4], ['rw12', [[46, 13.7], [56, 13.7]], 1.6],
  ['rw13', [[46, 5], [58, 5]], 2.2], ['rw14', [[52, 10], [58, 10], [58, 15]], 2.0], ['rw15', [[2.2, 28.5], [4.5, 31]], 1.4],
];
// linear walls always block HIGH (props.js), so the low single-segment stubs are oriented `ruins` rects (B.LOW)
const RUINS = RUIN_WALLS.map(([id, points, h]) => {
  if (h >= 1.8) return { id, type: 'wall', variant: 'ruins_mudbrick', mat: 'stone', points, h, width: 0.8 };
  const [[ax, az], [bx, bz]] = points;
  return { id, type: 'ruins', variant: 'ruins_mudbrick_low', mat: 'stone', x: (ax + bx) / 2, z: (az + bz) / 2, rot: Math.atan2(bz - az, bx - ax), w: Math.hypot(bx - ax, bz - az) + 0.8, d: 0.8, h, block: 1 };
});
/** The gun pit's S parapet and the concertina on the rim W of it. */
const GUN_PARAPET = { id: 'gun_pit', type: 'sandbags', variant: 'gun_pit_open', x: 62.5, z: 16.2, rot: 0, w: 7, d: 1, h: 1.2, block: 1 };
const WIRE_GUN = { id: 'wire_gun', type: 'fence', variant: 'wire_on_stakes', points: [[54, 21], [60, 21]], h: 1.2 };
/** Explosive drums on the plateau (B1, B2 at the top of the slope; B3 in the start yard). */
const drum = (id, x, z) => ({ id, type: 'barrels', variant: 'fuel_explosive', x, z, r: 0.3, h: 0.9, explosive: 'barrel', carriable: true, destructible: true, hp: 1 });
const PLATEAU_DRUMS = [drum('b1', 18.5, 21.5), drum('b2', 23.2, 20.7), drum('b3', 5.6, 14)];

const PLATEAU_WALKS = plateauStrips(PLATEAU, [
  ...RUIN_WALLS.flatMap(([, points]) => segmentHoles(points, 0.8)),
  ...segmentHoles([[59, 16.2], [66, 16.2]], 1.0),
  ...segmentHoles(WIRE_GUN.points, 0.3),
]);

// ---------------------------------------------------------------- the depot (L0)
const rack = (id, x, z) => ({ id, type: 'barrels', variant: 'barrel_rack', label: 'Oil barrels', x, z, rot: 0, r: 0.8, h: 1.6,
  explosive: 'barrel', carriable: false, destructible: true, hp: 1 });
/** o1 the oil-barrel store: six racks 5.2–6.0 m apart, one chain (§5.4). */
const RACKS = [rack('rack_1', 44, 55.5), rack('rack_2', 47, 51), rack('rack_3', 46.7, 60), rack('rack_4', 51.2, 56), rack('rack_5', 51.8, 47.5), rack('rack_6', 55, 52.3)];
/** B4–B10: the loose drums in the store (all inside its chain; none reaches a tank or the reservoir). */
const DEPOT_DRUMS = [drum('b4', 49.5, 48), drum('b5', 54.6, 47.3), drum('b6', 53.8, 57), drum('b7', 49, 59.5), drum('b8', 48, 62.5), drum('b9', 43, 62), drum('b10', 57, 46)];

/** o2 fuel tanks: twin horizontal tanks under a walkway frame (deck y 4.5, a strip to the ladder head). */
// the walkway frame covers the whole top (a deck at y 4.5 over the twin tanks): a man on it is seen from the yard and
// can be shot from it — NL/DE snipe a tank guard "from the small houses" — the tank body under him does not blind the
// line (a 1.4 m strip left the rest of the footprint a sight-blocking HIGH box). `deck` = the guard's beat + ladder head.
const fuelTank = (id, x, z, w, d, deck) => ({ id, type: 'fueltank', variant: 'fuel_tank_horizontal', label: 'Fuel tank', x, z, rot: 0, w, d, h: TANK_DECK_Y,
  destructible: true, destroyedBy: ['explosion'], hp: 100, beat: deck,
  walkways: [{ id: `${id}_deck`, points: [[x - w / 2 + 0.25, z], [x + w / 2 - 0.25, z]], width: d, y: TANK_DECK_Y }] });
const TANK_B = fuelTank('tank_b', 58.5, 72.5, 9, 7, [[58.5, 69.8], [58.5, 75.3], [60.5, 75.3]]);
const TANK_A = fuelTank('tank_a', 67.7, 65.5, 8.5, 6.3, [[67.7, 63.2], [67.7, 68], [70.5, 68]]);

const house = (id, x, z, door) => ({ id, type: 'house', variant: 'house_adobe_redtile', x, z, rot: 0, w: 6, d: 5, h: 4, mat: 'plaster', enterable: true, door: deg(door) });
const tent = (id, x, z) => ({ id, type: 'tent', variant: 'tent_pyramid_desert', x, z, rot: 0, w: 5, d: 5, h: 3 });
const hedgehog = (id, x, z) => ({ id, type: 'crates', variant: 'czech_hedgehog', x, z, rot: deg(45), w: 1.4, d: 1.4, h: 1.2, block: 1 });
const wire = (id, points) => ({ id, type: 'fence', variant: 'wire_on_stakes', points, h: 1.2 });

const STRUCTURES = [
  // --- terrain: the plateau (raised by walkways), the ramps (after it: they overwrite its rim), wadis, S drop
  // block 1 (LOW): the rim and the cells left around the ruins stop walking but not sight — guards above and below
  // see each other across the escarpment (dossier T3; the plateau is terrain, not a roof: rules.roofRule false)
  { id: 'plateau', type: 'cliff', variant: 'plateau_top', points: PLATEAU, h: Y, block: 1, walkways: PLATEAU_WALKS },
  { id: 'ramp_w', type: 'road', variant: 'road_cut', points: [RAMP_W.a.slice(0, 2), RAMP_W.b.slice(0, 2)], width: RAMP_W.width,
    walkways: rampWalkways(RAMP_W.a, RAMP_W.b, RAMP_W.width, RAMP_W.steps) },
  { id: 'ramp_ne', type: 'road', variant: 'supply_track', points: [RAMP_NE.a.slice(0, 2), RAMP_NE.b.slice(0, 2)], width: RAMP_NE.width,
    walkways: rampWalkways(RAMP_NE.a, RAMP_NE.b, RAMP_NE.width, RAMP_NE.steps) },
  { id: 'wadi_n', type: 'cliff', variant: 'ravine', points: WADI_N, h: 0.3, block: 1 },
  { id: 'wadi_mid', type: 'cliff', variant: 'ravine', points: WADI_MID, h: 0.3, block: 1 },
  { id: 'wadi_se', type: 'cliff', variant: 'ravine', points: WADI_SE, h: 0.3, block: 1 },
  { id: 'drop_s', type: 'cliff', variant: 'drop', points: DROP_S, h: 0.5, block: 2 },
  // --- the plateau: ruins, gun-pit parapet, rim wire, drums
  ...RUINS, GUN_PARAPET, WIRE_GUN, ...PLATEAU_DRUMS,
  // --- the lower road strip, the Gatling pit and the bridge
  { id: 'slab_n', type: 'sandbags', variant: 'blast_wall_revetment', x: 66, z: 27.5, rot: deg(60), w: 4, d: 1.5, h: 2.5, block: 2 },
  { id: 'slab_c', type: 'sandbags', variant: 'blast_wall_revetment', x: 61.4, z: 38.6, rot: deg(70), w: 4, d: 1.5, h: 2.5, block: 2 },
  { id: 'mg_pit', type: 'sandbags', variant: 'mg_nest_sandbag', x: 75.3, z: 25.9, rot: deg(150), ring: { r: 2 }, h: 1.0, block: 1 },
  hedgehog('hh_1', 68, 27), hedgehog('hh_2', 74.5, 28), hedgehog('hh_3', 77, 28), hedgehog('hh_4', 80, 28.5),
  { id: 'bridge', type: 'bridge', variant: 'bridge_timber_trestle', x: 87.5, z: 33, rot: 0, w: 19, d: 5, h: 0.5 },
  ...[[44, 41.5], [84, 63], [86, 57]].map(([x, z], k) => ({ id: `scrub_${k + 1}`, type: 'bush', variant: 'scrub_desert', x, z, r: 1 })),
  // --- the depot: the domed barracks (garrison A, roof guard on its terrace), palms, the oil drums W
  { id: 'barracks', type: 'flat_roof_house', variant: 'house_domed_arcade', label: 'Barracks', x: 30.2, z: 59.5, rot: 0, w: 11.5, d: 9, h: ROOF_Y,
    roofY: ROOF_Y, roofWalk: true, mat: 'plaster', flag: true, garrison: true, destructible: true, destroyedBy: ['explosion'], hp: 100, door: deg(180) },
  ...[[38, 53], [39.5, 57.5], [37, 60]].map(([x, z], k) => ({ id: `palm_${k + 1}`, type: 'palm', variant: 'date_palm', x, z, r: 0.35, h: 7 + k, seed: 801 + k })),
  { id: 'drums_w1', type: 'barrels', variant: 'oil_tanks_vertical', x: 4.75, z: 63.75, rot: 0, w: 6.5, d: 7.5, h: 2.2, block: 2 },
  { id: 'drums_w2', type: 'barrels', variant: 'oil_tanks_vertical', x: 11.25, z: 59.5, rot: 0, w: 3.5, d: 7, h: 2.2, block: 2 },
  ...RACKS, ...DEPOT_DRUMS, TANK_B, TANK_A,
  { id: 'reservoir', type: 'fueltank', variant: 'water_reservoir_round', label: 'Water reservoir', x: 70.5, z: 45.3, rot: 0, r: 3.75, h: 6, mat: 'greyPaint',
    destructible: true, destroyedBy: ['explosion'], hp: 100 },
  // --- the south: tents, the five houses (hideouts), the clothesline, the SW pillbox (garrison B)
  tent('tent_w', 9, 78), tent('tent_e', 17.5, 74.5),
  house('house_1', 25, 86, 270), house('house_2', 28.7, 82, 270), house('house_3', 33.6, 78.5, 270), house('house_4', 42.7, 78, 180), house('house_5', 46.5, 83, 180),
  { id: 'clothesline', type: 'wall', variant: 'clothesline_sheets', mat: 'canvas', points: [[33.3, 88.5], [37.3, 88.5]], h: 2, width: 0.3 },
  { id: 'bunker_sw', type: 'bunker', variant: 'pillbox_round', label: 'Pillbox', x: 11.5, z: 92, rot: 0, w: 11, d: 6, h: 3, mat: 'concrete', flag: true, garrison: true, door: deg(270) },
  { id: 'crates_sw', type: 'crates', x: 3.5, z: 92.5, rot: 0, w: 1.5, d: 1.2, h: 1, block: 1 },
  { id: 'rubble_se', type: 'rocks', variant: 'rubble', x: 66.8, z: 86, r: 1, h: 0.6, block: 1 },
  // --- wire (see-through, uncrossable; no cutters in this mission)
  wire('wire_n', [[31, 50], [40, 45.5], [50, 41], [56, 39], [66, 39.5], [78, 39.5]]),
  wire('wire_e', [[78, 39.5], [78, 59], [72, 78], [70, 92]]),
  wire('wire_s', [[70, 92], [41, 93], [30, 97], [20, 100], [12, 97], [6, 97]]),
  wire('wire_w', [[0, 78], [6, 84]]),
  wire('wire_wadi_w', [[79, 0], [79, 29.5]]),
];

// ---------------------------------------------------------------- enemies (dossier §8; Prima numbers where sure)
/** Dossier §8 sweep periods (s): the quick 8 s posts; every other sentry sweeps over 10 s. */
const SWEEP_8S = new Set(['e1', 'e2', 'e7', 'e20']);
const sentry = (id, prima, x, z, h, sweep, inv, extra = {}) => ({ id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, heading: deg(h),
  flags: { investigates: inv, holdsPost: !inv }, post: { heading: deg(h), sweep, period: SWEEP_8S.has(id) ? 8 : 10 }, ...extra });
const walker = (id, prima, type, pts, extra = {}, flags = {}) => {
  const [a, b] = pts;
  return { id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x),
    flags: { investigates: true, ...flags }, route: { type, vel: 1.0, points: pts }, ...extra };
};
const UP = { y: Y };

const ENEMIES = [
  // ===== Phase 1: the plateau (y 4), Prima 1–13 (plateau order inferred, §8.1)
  sentry('e1', 1, 10.5, 2.5, 180, 45, true, UP), // N of the start yard's N wall; the first decoy behind rw1 pulls him
  sentry('e2', 2, 21.3, 7.5, 90, 30, true, UP),
  sentry('e3', 10, 18.2, 16, 90, 45, true, UP), // by the truck yard, over B1/B2
  walker('e4', 4, 'PINGPONG', [P(4, 23, 3, 90), P(10, 31, 3, 45)], UP),
  walker('e5', 5, 'PINGPONG', [P(26.5, 16.5, 4, 90), P(29, 22.5, 4, 90)], UP), // W of rw9
  walker('e6', 6, 'PINGPONG', [P(26, 25.5, 3, 90), P(37, 25.5, 3, 90)], UP), // looks down at the cliff foot at each end
  sentry('e7', 7, 37.2, 18, 135, 30, false, UP),
  walker('e8', 8, 'PINGPONG', [P(44, 19.5, 3, 90), P(56, 18.5, 3, 90)], UP), // rim beat W of the gun; watches the depot
  walker('e9', 9, 'PINGPONG', [P(44, 7, 4, 270), P(56, 7.5, 4, 0)], UP),
  sentry('e10', null, 59.7, 14.2, 90, 50, false, UP), // the gun guard: faces S, down over the depot and the road
  walker('e11', 11, 'LOOP', [P(33, 11), P(37.5, 11, 3, 0), P(37.5, 15), P(33, 15, 3, 180)], UP),
  sentry('e12', 12, 17.2, 28.2, 100, 30, false, UP), // the two road guards cover each other
  sentry('e13', 13, 11.8, 30.5, 80, 30, false, UP),

  // ===== Phases 2–3: the depot (L0), Prima 14–28
  walker('e14', 14, 'PINGPONG', [P(4, 52, 3, 270), P(17, 48, 3, 0)], {}, { followsTracks: true }), // his W end is hidden by drums_w1
  walker('e15', 15, 'PINGPONG', [P(23.5, 60.5, 2, 0), P(12, 54.5, 2, 270)], {}, { followsTracks: true }), // barracks door ↔ the car
  walker('e16', 16, 'PINGPONG', [P(10.5, 64.2, 6, 270), P(14, 66, 6, 0)]),
  sentry('e17', 17, 12.5, 80.5, 0, 30, true),
  sentry('e18', 18, 21, 75, 45, 45, true),
  // the roof guard on the barracks terrace (y 4.5): out of knife reach, a rifle round only
  walker('e19', 19, 'PINGPONG', [P(27, 59, 4, 270), P(34.5, 59, 4, 0)], { y: ROOF_Y, elevated: true, structure: 'barracks' }, { holdsPost: true }),
  sentry('e20', 20, 31.2, 85.4, 315, 45, true), // watches houses 1–3 and the tents
  walker('e21', 21, 'LOOP', [P(38.5, 77), P(37.5, 73, 2, 270), P(46, 73), P(49.5, 79, 2, 0), P(44, 86.5), P(38.5, 77)]),
  walker('e22', 22, 'PINGPONG', [P(50.5, 80, 3, 0), P(28, 91, 3, 180)]), // passes in front of the clothesline
  sentry('e23', 23, 40, 66.7, 90, 60, true),
  walker('e24', 24, 'LOOP', [P(56, 55), P(58, 45, 3, 270), P(40, 50), P(37.5, 64, 3, 90), P(56, 55)]),
  walker('e25', 25, 'PINGPONG', [P(39, 49, 3, 270), P(50, 44.5, 3, 315)]), // just inside wire_n
  walker('e26', 26, 'PINGPONG', [P(58.5, 70, 3, 270), P(58.5, 75, 3, 90)], { y: TANK_DECK_Y, elevated: true, structure: 'tank_b' }), // on tank_b (his own tank does not blind him)
  sentry('e27', 27, 67.7, 65.5, 180, 60, false, { y: TANK_DECK_Y, elevated: true, structure: 'tank_a' }), // on tank_a: the most dangerous post
  walker('e28', 28, 'PINGPONG', [P(45, 64, 2, 270), P(56, 66, 2, 0)]),

  // ===== Phase 4: the road strip, the guns and the bridge, Prima 29–32
  { id: 'e29', prima: 29, soldierType: 'gunner', x: 62.7, z: 14.2, y: Y, heading: deg(0), emplacement: 'gun210', post: { heading: deg(0), sweep: 40 } },
  sentry('e30', 30, 64.3, 25.2, 200, 40, true),
  walker('e31', 31, 'PINGPONG', [P(72, 33, 3, 180), P(97, 33, 3, 0)]), // over the bridge; comes up ramp_ne after a GB seen on the plateau
  { id: 'e32', prima: 32, soldierType: 'mg', x: 75.3, z: 25.9, heading: deg(150), emplacement: 'gatling', post: { heading: deg(150), sweep: 50, giro: 180 } },
];

// ---------------------------------------------------------------- garrisons (§9; exit 2.7 m/s, loops 1.8 m/s)
const A1_LOOP = [P(14, 29), P(30, 24.5), P(50, 20), P(60, 18.5), P(50, 20), P(30, 24.5), P(14, 29), P(15, 44), P(40, 36), P(70, 33), P(40, 36), P(15, 44)];
const A2_LOOP = [P(38, 66), P(56, 64), P(66, 58), P(60, 44), P(40, 50), P(24, 66), P(38, 66)];
const B1_LOOP = [P(20, 82), P(32, 91), P(48, 88), P(46, 70), P(22, 70), P(12, 84), P(20, 82)];

/** Plateau structures and drums lifted to y 4 by the script (meshes; drum entities). */
const LIFT = [...RUINS, GUN_PARAPET, WIRE_GUN, ...PLATEAU_DRUMS].map((s) => s.id);

export default {
  id: 'm08',
  campaign: 'BEL',
  title: 'Pyrotechnics',
  subtitle: 'Tell el Eisa, Egypt · 19 October 1942',
  date: '1942-10-19',
  place: 'Tell el Eisa, west of El Alamein, Egypt',
  theater: 'desert',
  coneColors: 'desert',
  size: [112, 105],
  seed: 1942_1019,
  briefing: {
    historical: 'October 1942. Montgomery now commands the Eighth Army at El Alamein, and both armies are digging in for the battle that will decide North Africa. Until it begins, small raiding parties are to strike at Rommel\'s rear. Today\'s target is the supply base at Tell el Eisa: burn it and a whole armoured division runs dry.',
    text: 'You will set out from the ruined village on the ridge in the north-west. Get down into the camp and destroy everything that matters: every rack of oil barrels, both fuel tanks and that great water reservoir. Once the lot is burning, one of our jeeps will pick you up at the bridge. That is all. Good luck.',
    objectivesSummary: 'Blow up the oil barrels, both fuel tanks and the reservoir, then meet our jeep at the bridge.',
    hints: [
      'Clear the ground round the bridge before our jeep arrives. More than one gun covers that spot.',
      'You can hide inside the houses, and in the parked car and truck.',
      'Barrels set out in a line go up one after another. One good shot could take the whole depot.',
      'Nothing on this map goes unnoticed: anyone who sees you, or hears a shot, will sound the alarm.',
      'The guard on the barracks roof and the men on the fuel tanks are out of reach of a knife from the ground.',
    ],
  },
  lighting: { sunElevDeg: 62, sunAzimuthDeg: 160, kelvin: 5200, hdri: 'desert_clear_noon', fog: 220, lut: 'desert_noon' },
  water: null,
  baseTerrain: 'sand',
  terrain: [
    // T9 the trampled camp yard: SAND underfoot (the GB burrows and everyone leaves tracks here, as in the original:
    // NL digs in by the houses, K burrows N of the barracks for e15 to follow his tracks). A darker 'trampled sand'
    // look is an art-team item (terrain art paints per code only).
    { type: 'poly', terrain: 'sand', points: [[0, 48], [30, 46], [56, 40], [78, 42], [78, 60], [72, 78], [70, 92], [41, 93], [30, 97], [12, 96], [0, 84]] },
    // T2 packed sand over rock on the plateau (visual; the walkways raise it)
    { type: 'poly', terrain: 'ground', points: PLATEAU },
    // T4/T5 roads: the W cut, the lower road to the bridge, the E tracks (jeep in from the N, out to the S)
    { type: 'path', terrain: 'road', points: [[14, 29], [14.5, 36], [15, 44]], width: 5 },
    { type: 'path', terrain: 'road', points: [[15, 44], [22, 41], [40, 36], [60, 33], [78, 33], [97, 33]], width: 5 },
    { type: 'path', terrain: 'road', points: [[97, 33], [101, 26], [104, 14], [106, 0]], width: 4 },
    { type: 'path', terrain: 'road', points: [[99, 36], [104, 50], [107, 70], [109, 90], [110, 105]], width: 4 },
    { type: 'path', terrain: 'road', points: [[72, 29], [69, 22], [66.2, 17.4]], width: 3 },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['house_1', 'house_2'], ['house_2', 'house_3'], ['house_4', 'house_5']]),
  items: [],
  interactables: [],
  vehicles: [
    // the 210 mm gun (never manned by commandos): shells the jeep while e29 lives; a barrel blast wrecks it
    { id: 'gun210', vehicleType: 'mortar210', x: 62.7, z: 12.2, y: Y, heading: deg(0), gunner: 'e29', driveable: false },
    // the Gatling by the bridge (e32 mans it)
    { id: 'gatling', vehicleType: 'mgNest', x: 75.3, z: 25.9, heading: deg(150), gunner: 'e32', driveable: false },
    // parked and empty: nobody can drive them (no Driver), anyone can hide inside
    { id: 'truck_p', vehicleType: 'truck', variant: 'opel_blitz_desert', x: 12.3, z: 21.5, y: Y, heading: deg(0), driveable: false },
    { id: 'car', vehicleType: 'horch', variant: 'horch_desert', x: 19.3, z: 60.6, heading: deg(180), driveable: false },
  ],
  commandos: [
    // prone in the NW start yard of the ruins (walls N, E and S), on the plateau
    { role: 'greenberet', x: 3.5, z: 11.5, y: Y, heading: deg(0), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { role: 'sniper', x: 2.5, z: 13.5, y: Y, heading: deg(0), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 6, firstAid: 6 } },
  ],
  enemies: ENEMIES,
  // the plateau, the tank walkways and the barracks terrace are open levels, not roofs: guards on them see the
  // ground and are seen from it (NL: the tank guards "oversee a very large part of the terrain"; DE: the camp
  // watches the Sniper on the rim). §4.2 roof rule off, as in M20.
  // decoyMaxDwell: a guard stares at a pulsing lure for at most 75 s, then goes back to his post (replay m08: one
  // decoy on the plateau parked the whole camp and both squads indefinitely)
  rules: { roofRule: false, decoyMaxDwell: 75 },
  // K: "anything suspect or seen in the ENTIRE map will immediately sound the alarm": no safe corner
  zones: [
    { id: 'z_all', poly: [[0, 0], [112, 0], [112, 105], [0, 105]], onSeen: 'RINT', onHeard: 'RINT', siren: true },
  ],
  jails: [],
  barracks: {
    barracks: { pool: 10, squads: [
      { event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [P(23.5, 60), P(16, 50), P(15, 44), P(14, 29)], loopVel: 1.8, loop: A1_LOOP },
      { event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [P(23.5, 60), P(24, 66), P(38, 66)], loopVel: 1.8, loop: A2_LOOP },
    ] },
    bunker_sw: { pool: 5, squads: [
      { event: 'RINT', size: 3, exitVel: 2.7, exitRoute: [P(12, 88), P(20, 82)], loopVel: 1.8, loop: B1_LOOP },
    ] },
  },
  // the Green Beret's climb spots down (and up) the escarpment (§7.1)
  climbLinks: [
    { id: 'cl_gun', a: [63, 20.5, Y], b: [63, 24.8, 0], roles: ['greenberet'] },
    { id: 'cl_w', a: [4, 39.5, Y], b: [6.5, 43.5, 0], roles: ['greenberet'] },
    { id: 'cl_mid', a: [30, 26, Y], b: [30, 30.5, 0], roles: ['greenberet'] },
    { id: 'cl_e', a: [48, 22.2, Y], b: [48, 26.5, 0], roles: ['greenberet'] },
  ],
  // the fuel tanks' walkway ladders (anyone)
  ladders: [
    { id: 'ladder_b', x: 60.5, z: 77, y: 0, top: [60.5, 75.3, TANK_DECK_Y], raised: false, heading: deg(270) },
    { id: 'ladder_a', x: 70.5, z: 69.5, y: 0, top: [70.5, 68, TANK_DECK_Y], raised: false, heading: deg(270) },
  ],
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Destroy the oil-barrel store', type: 'destroy', targets: RACKS.map((r) => r.id), required: true },
    { id: 'o2', text: 'Destroy both fuel tanks', type: 'destroy', targets: ['tank_a', 'tank_b'], required: true },
    { id: 'o3', text: 'Destroy the water reservoir', type: 'destroy', targets: ['reservoir'], required: true },
    // helper: set 6 s after o1–o3 burn (the jeep's call-in, dossier D7); never shown, never required
    { id: 'o_burn', text: 'The depot is burning', type: 'script', required: false, hidden: true },
    { id: 'o4', text: 'Get both men aboard the jeep at the bridge', type: 'escape', required: true, hidden: true, vehicleId: 'jeep' },
  ],
  triggers: [
    // §6.1 the 210 mm gun and the Gatling fire on the friendly jeep for as long as they are crewed (map-wide gun;
    // the Gatling covers the bridgehead). Vehicle.fireAt refuses once the gunner is dead.
    { on: 'start', once: true, do: [{ hunt: 'gun210', target: 'jeep', range: 80 }, { hunt: 'gatling', target: 'jeep', range: 30 }] },
    { on: 'tick', once: true, delay: 3, when: (_p, w) => allBurning(w),
      do: [{ message: 'Everything is burning. Our jeep is on its way to the bridge.', kind: 'objective' }] },
    { on: 'tick', once: true, delay: 6, when: (_p, w) => allBurning(w),
      do: [{ objective: 'o_burn', set: 'done' }, { objective: 'o4', set: 'show' }] },
    { on: 'vehicle:destroyed', match: { vehicle: 'gun210' }, once: true, do: [{ message: 'The big gun is out of action.', kind: 'info' }] },
    // the jeep is our only way out (§8.1 vehicle wording, naming the jeep as M12 names its car; dossier §10.3)
    { on: 'vehicle:destroyed', match: { vehicle: 'jeep' }, once: true, when: (_p, w) => !w.objectives?.find((o) => o.id === 'o4')?.done,
      do: [{ fail: 'YOU DESTROYED THE JEEP, BUT YOU NEEDED IT TO ESCAPE.' }] },
  ],
  script: m08Script({
    plateau: PLATEAU,
    ramps: [RAMP_W, RAMP_NE],
    wadis: [WADI_N, WADI_MID, WADI_SE],
    hide: ['plateau', 'wadi_n', 'wadi_mid', 'wadi_se'],
    lift: LIFT,
    liftVehicles: ['gun210', 'truck_p'],
  }),
  // the friendly Willys comes down the E track 6 s after o1–o3, stops at the E bridgehead and waits; with both
  // men aboard it drives back N off the map. Destroyed (the gun: one shell; the Gatling: 30 hits) = loss (§8.1).
  extraction: {
    vehicleId: 'jeep', vehicleType: 'willys', friendly: true, seats: 4, spawnWhen: ['o_burn'],
    spawnAt: { x: 105, z: -6, heading: deg(100) }, arrive: { x: 98.5, z: 31, speed: 7 },
    exit: { x: 105, z: 1, r: 3 }, leave: { x: 105, z: -12 },
  },
  alarmFail: null,
  par: { time: 600 },
  cameraStart: { x: 12, z: 22, zoom: 1 },
  startDisguised: [],
};

/** o1–o3 all done. */
function allBurning(world) {
  const list = world.objectives || [];
  return ['o1', 'o2', 'o3'].every((id) => list.find((o) => o.id === id)?.done);
}
