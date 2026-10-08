/**
 * BEL Mission 12 — "Up on the Roof" (buildable layout: docs/missions/m12.md). Owned by MISSIONS.
 * Tunis, 15 March 1943. A German sweep has scattered our men through the old town by the harbour. The Spy
 * (in uniform) walks the courtyard; the Green Beret hides in a house on its west side, the Sniper in a shack on
 * the northern roof terrace; our Informer sits in a cell off the courtyard. The courtyard is a dead end at
 * street level: the only way east and south is over the roofs (ledge y 4, upper roofs y 8, the palace's raised
 * roof y 10), down onto the mosque platform (y 2.2, deliberately below the roof rule) and down to the south quay,
 * where a Kübelwagen waits beside the harbour HQ. Free the Informer, then get all four men into the car.
 * A siren in the north (z < 66) only brings three men out of the palace; ANY alert in the south (the east
 * houses, the mosque, the quay) reaches the harbour HQ and fails the mission 5 s later (§7.1, §8.1).
 *
 * Conventions: dossier headings/rot in DEGREES (0 = E, 90 = S), converted with deg(); route `look` and
 * `post.sweep` stay in degrees. All positions are plan (ground) positions (dossier §1 projection note).
 * Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (engine / grid fit, see the commit message):
 *  - D1 (spawn inside a hideout) is not an engine feature: a `start` trigger admits the GB and the Sniper
 *    into their hideout doors on the first tick (dossier T3 fallback); `hideout` stays on the defs as data;
 *  - D2 stepped roofs are split structures (w_block_front A / w_block_rear B, palace B / palace_c C);
 *    the palace's raised roof sits at y 10, not 10.5, so B and C see each other under the 2 m roof rule
 *    (dossier §6 intent) and it lies wholly inside the palace's east half;
 *  - the mosque platform is a polygon (`cliff` area + walkway strips at y 2.2, the M5/M10 method) with holes
 *    for the prayer hall, the minaret, the north pavilion and the HQ, and with its east corner cut for the
 *    alley and the arcade house (the dossier's rotated 28 × 32 rect overlapped both);
 *  - planks between roofs are walkways (P1, the roof steps palace↔terrace, terrace↔souk, mid_block↔palace,
 *    P2 at y 7.5 between y 8 and y 7); stairs are `ladders[]` with kind 'stairs' (the M6/M9 method);
 *  - a blind wall closes the lane E of the courtyard (the dossier's "no ground route east");
 *  - house_tile shrunk to 10 × 9 and w_block_front widened to x 21 so L1 stands outside it and the balcony
 *    meets the jail ledge; ladder/stair ends nudged ≤ 1.5 m onto their surfaces; e12 and e32 moved ≤ 5 m
 *    onto walkable roof; the w_block light well is cosmetic (not modelled);
 *  - roof props are lifted by the script (the shack, the kiosk, the L2 stair-head hut and the big box also get
 *    their cells blocked again).
 *
 * Fix round (mis_play_12 findings):
 *  - the mosque is modelled as the fan map draws it: arcades A1/A2 and court walls C1/C2 (h 3, sight blockers,
 *    stamped after the elevation pass) split the platform into courts with doors; the big box blocks sight. The
 *    lower level Kildread mentions is not modelled (the courts and doors carry his route);
 *  - every walkable roof has a parapet (B.LOW ring) and a low wall where two terraces meet, with doorways; the
 *    roof guards are not `elevated`, so low cover hides bodies and prone men from them; a stair-head hut at L2;
 *  - the HQ's ears are the script's (southHears): a shout from the north never trips RSEHQ, gunfire still does;
 *  - e8 and e18 leave their posts to look at a body (Prima); e25/e31 routes nudged off the new walls;
 *  - the start trigger admits a man only at t < 1 s and at his spawn (a re-fired trigger after a load is harmless);
 *  - the jail door is on the ground (opened from the courtyard).
 *
 * Fix round 2 (mis_play_12 r2 findings, dossier §12 #18–#21):
 *  - the five ledge men ([2], [5], [14]–[16]) overlook the courtyard (`overlooks`, an engine flag that lifts the
 *    roof rule for a viewer looking down only): the ledge must be cleared before the jailbreak (Prima, ooc, NL);
 *  - the arcade roof has a 1.2 m N/W parapet (full sight blocker): [29] no longer sees P2 or the pavilion roof;
 *  - the palace squad's exit route keeps ≥ 6 m from the foot of L2; the dossier's team waits in the GB's hideout
 *    and the Informer's cell during the north phase;
 *  - art: blind arcades and merlons on the mosque's inner walls, a ribbed dome on the prayer hall (script visuals).
 */

import { plateauWalkways, rectPoly } from './scripts/m05.js';
import { m12Script, startHidden } from './scripts/m12.js';
import { joinStructures } from './schema.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)
const R30 = deg(-30); // palace, mosque complex, HQ (art axes, dossier §1)
const R60 = deg(60); // the souk arcade

/** Level heights (dossier §5): A ledge, B upper roofs, C raised palace roof, P mosque platform. */
export const LEVEL = { A: 4, B: 8, C: 10, E3: 4.5, P: 2.2, PAV: 7, ARC: 6 };

// ---------------------------------------------------------------- structures (dossier §5.1)
const flat = (id, variant, x, z, w, d, h, extra = {}) => ({ id, type: 'flat_roof_house', variant, x, z, rot: 0, w, d, h, mat: 'plaster', roofWalk: true, ...extra });
const backdrop = (id, variant, x, z, w, d, h, extra = {}) => flat(id, variant, x, z, w, d, h, { roofWalk: false, ...extra });
const walk = (points, y, width = 1.4) => ({ points, width, y });

const BACKDROP = [
  { id: 'shed_harbour', type: 'house', variant: 'warehouse_corrugated', x: 5, z: 11, rot: 0, w: 10, d: 18, h: 7, mat: 'greyPaint', roof: 'roofTin', nav: false },
  backdrop('house_nw', 'medina_block_qubba', 15.5, 10, 11, 12, 11, { dome: true }),
  backdrop('n_row_1', 'medina_facade_shutters', 23.5, 7, 7, 10, 11),
  backdrop('n_row_2', 'medina_facade_shutters', 31.5, 7, 9, 10, 11),
  backdrop('n_row_3', 'medina_facade_awning', 40, 7, 8, 10, 11),
];

/** The west block, the jail and the palace (the courtyard's north side). */
const WEST = [
  flat('house_tile', 'medina_tile_roof', 5, 41.5, 10, 9, LEVEL.A, { roofFinish: 'tile' }),
  // the GB's hideout: the front (ledge) half of the stepped west block; its door opens S onto the courtyard
  flat('w_block_front', 'medina_stepped_front', 15.5, 40.5, 11, 5, LEVEL.A, { enterable: true, door: [16.5, 43.6] }),
  flat('w_block_rear', 'medina_stepped_rear', 15, 32, 10, 12, LEVEL.B, { lightWell: [12, 27, 19, 32] }),
  // the jail: a cell block whose roof is "the ledge over the prison" (door = the S face)
  flat('jail_block', 'medina_jail_cell', 25.5, 33.5, 11, 9, LEVEL.A, { label: 'Jail', jail: true, door: deg(90), barredWindow: [24.5, 38] }),
  flat('mid_block', 'medina_roof_terrace', 23.5, 22.5, 7, 13, LEVEL.B, { walkways: [walk([[26, 22], [29.5, 22.2]], LEVEL.B)] }),
  // garrison 1 (the siren's three men): tiled facade, green domes, arcaded colonnade; B roof over it
  { id: 'palace', type: 'flat_roof_house', variant: 'palace_tiled_domes', label: 'Palace', x: 37, z: 23, rot: R30, w: 16, d: 12, h: LEVEL.B,
    mat: 'plaster', roofWalk: true, dome: true, flag: true, garrison: true, door: deg(90),
    walkways: [walk([[43.06, 19.5], [46, 19.5]], LEVEL.B), walk([[45.06, 22.96], [48.5, 26.5]], LEVEL.B)] },
  { id: 'palace_c', type: 'flat_roof_house', variant: 'palace_raised_roof', x: 39.6, z: 21.5, rot: R30, w: 5, d: 8, h: LEVEL.C, mat: 'plaster', roofWalk: true },
];

/** The northern terrace (the Sniper's shack), the souk and the east houses. */
const EAST = [
  flat('n_terrace', 'medina_roof_terrace', 53, 13.5, 18, 15, LEVEL.B, { walkways: [walk([[55, 20.5], [56, 23.5]], LEVEL.B)] }),
  // the Sniper's hideout: a small flat-roofed shack ON the terrace (lifted by the script), door W
  { id: 'sn_hut', type: 'hut', variant: 'rooftop_shack', x: 53, z: 15.5, rot: 0, w: 5, d: 5, h: 2.6, mat: 'plaster', enterable: true, door: [50.2, 15.5], baseY: LEVEL.B },
  // the stair-head hut over L2 (fix round: a roof shed that breaks the palace's view down the souk)
  { id: 'l2_hut', type: 'hut', variant: 'rooftop_stairhead', x: 50, z: 29.8, rot: 0, w: 2.4, d: 2.4, h: 2.5, mat: 'plaster', baseY: LEVEL.B },
  { id: 'souk', type: 'flat_roof_house', variant: 'souk_arcade', label: 'Souk', x: 57, z: 36, rot: R60, w: 26, d: 12, h: LEVEL.B, mat: 'plaster', roofWalk: true, awnings: true },
  flat('house_e1', 'medina_balconies', 70.5, 35, 11, 26, LEVEL.B),
  flat('house_e2', 'medina_mosaic_terrace', 67, 57, 18, 18, LEVEL.B, { walkways: [walk([[57.8, 63.4], [50.2, 69.1]], 7.5, 1.2)] }),
  { id: 'kiosk', type: 'mosque', variant: 'qubba_green_dome', x: 64.5, z: 51.5, rot: 0, w: 6, d: 6, h: 3.5, mat: 'plaster', dome: true, roofWalk: false, baseY: LEVEL.B },
  flat('house_e3', 'medina_mosaic_terrace', 65.5, 76, 21, 20, LEVEL.E3),
  // the lane E of the courtyard is walled off: the courtyard is a dead end at street level
  { id: 'wall_lane', type: 'wall', variant: 'medina_blind_wall', mat: 'plaster', points: [[51.4, 52.4], [51.4, 50.2], [57.6, 50.2]], h: 3.5, width: 1.0 },
  // ... and so is the gap between the palace and the souk north of L2 (the streets behind are backdrop)
  { id: 'wall_gap', type: 'wall', variant: 'medina_blind_wall', mat: 'plaster', points: [[46.6, 24.2], [45.4, 27.9]], h: 3.5, width: 1.0 },
];

// ---------------------------------------------------------------- the mosque complex and the HQ (dossier §5.1)
const HALL = { id: 'mosque_hall', type: 'mosque', variant: 'prayer_hall_ribbed_dome', label: 'Mosque', x: 34.5, z: 79, rot: R30, w: 10, d: 10, h: 7, mat: 'plaster', dome: true, roofWalk: false };
const MINARET = { id: 'minaret', type: 'minaret', variant: 'minaret_octagonal', x: 22.5, z: 83, r: 3, h: 24, mat: 'plaster', nav: false }; // not climbable (dossier)
const PAV = { id: 'mosque_pav_n', type: 'flat_roof_house', variant: 'mosque_tower_pavilion', x: 47, z: 70, rot: R30, w: 7, d: 7, h: LEVEL.PAV, mat: 'plaster', roofWalk: true };
// garrison 2: the harbour HQ, built into the platform's S corner; its door opens onto the S quay. NEVER alarm it.
const HQ = { id: 'hq_se', type: 'barracks', variant: 'barracks_desert_hq', label: 'Harbour HQ', x: 47, z: 103.5, rot: R30, w: 10, d: 7, h: 5,
  mat: 'plaster', roof: 'roofTar', flag: true, garrison: true, door: deg(90), nav: false };
const ARCADE = flat('arcade_house', 'medina_ruined_arcade', 59.5, 91.5, 9, 11, LEVEL.ARC);
/**
 * The arcade roof's N and W parapet (fix round 2): a 1.2 m wall that turns [29]'s back on the town. Without it he
 * saw 26–38 m N from his beat, over plank P2 and the pavilion roof (both on his side of the roof rule). Full sight
 * blocker, stamped after the elevation pass; the gap at the SW corner is the L6 ladder head.
 */
export const ARCADE_PARAPET = [[[55.4, 93.4], [55.4, 86.4], [63.8, 86.4]]];
const ARC_WALLS = ARCADE_PARAPET.map((points, k) => ({ id: `arcade_parapet_${k + 1}`, type: 'wall', variant: 'medina_parapet', mat: 'plaster', points, h: 1.2, width: 0.6 }));

/** The raised stone platform (y 2.2): the dossier's rotated rect with the E corner cut for the alley. */
export const PLATFORM = [[21.9, 81.1], [46.1, 67.1], [54.9, 82.4], [54.9, 91.5], [52.5, 91.5], [52.5, 100.45], [37.9, 108.9]];
const PLATFORM_HOLES = [
  { poly: rectPoly(HALL.x, HALL.z, HALL.w, HALL.d, HALL.rot) },
  { x: MINARET.x, z: MINARET.z, r: MINARET.r },
  { poly: rectPoly(PAV.x, PAV.z, PAV.w, PAV.d, PAV.rot) },
  { poly: rectPoly(HQ.x, HQ.z, HQ.w, HQ.d, HQ.rot) },
];

/**
 * The mosque's inner walls (fix round, dossier §5.3 "arcade ranges … that block sight across the platform"; fan
 * map: arcaded courts): A1 and A2 run at 60° from the prayer hall's S and E corners and split the platform into
 * the W walk (e28), the hall court (e25, e26) and the E walk (e24, e27, e32, the big box); A1 has a door and runs
 * on to the HQ. The court walls C1 (the pavilion court, e24's, open at its E end) and C2 (the S rim above the HQ,
 * e30/e31, entered by a door at C2's W end and past C2's E end, where the SE stairs go down) run at −30°. All h 3, full sight blockers (stamped after
 * the elevation pass by the script; the meshes are lifted onto the platform).
 */
export const MOSQUE_WALL_LINES = {
  A1: [[[32.7, 85.8], [35.7, 91.0]], [[36.5, 92.4], [41.4, 100.9]]],
  A2: [[[41.3, 80.8], [46.1, 89.1]]],
  C1: [[[43.4, 84.4], [50.4, 80.4]]],
  C2: [[[41.5, 97.3], [49.4, 92.7]]],
};
const MOSQUE_WALLS = Object.entries(MOSQUE_WALL_LINES).flatMap(([id, segs]) => segs.map((points, k) => ({
  id: `mosque_${id.toLowerCase()}_${k + 1}`, type: 'wall', variant: id[0] === 'A' ? 'mosque_arcade' : 'mosque_court_wall', mat: 'plaster',
  points, h: 3, width: 0.8,
})));
const MOSQUE_LINES = [...MOSQUE_WALLS, ...ARC_WALLS].map((w) => ({ points: w.points, width: 1.0 }));

const MOSQUE = [
  { id: 'mosque_platform', type: 'cliff', variant: 'mosque_platform_stone', mat: 'stone', points: PLATFORM, h: LEVEL.P, block: 2,
    walkways: plateauWalkways(PLATFORM, PLATFORM_HOLES, LEVEL.P) },
  HALL, MINARET, PAV, HQ, ARCADE, ...MOSQUE_WALLS, ...ARC_WALLS,
];

// ---------------------------------------------------------------- the harbour (dossier §4, §5.2)
// the N quay runs straight W of x 40 (it wobbled ±3°: the quarter's 0° house fronts read as a mistake against it)
const QUAY_N = [[0, 46.65], [40, 46.65], [48, 47.4], [51.6, 51.9]];
const QUAY = [
  { id: 'quay_n', type: 'wall', variant: 'quay_granite_bollards', mat: 'stone', points: QUAY_N, h: 1.2, width: 0.6 },
  { id: 'quay_s', type: 'wall', variant: 'quay_granite_bollards', mat: 'stone', points: [[20, 90.5], [0.5, 114]], h: 1.2, width: 0.6 },
];

// ---------------------------------------------------------------- props (dossier §5.3)
const crate = (id, variant, x, z, w = 1.2, d = 1.2, h = 1.1, extra = {}) => ({ id, type: 'crates', variant, x, z, rot: 0, w, d, h, block: 1, ...extra });
const barrel = (id, x, z, extra = {}) => ({ id, type: 'barrels', variant: 'barrel_wood', x, z, r: 0.35, h: 0.9, block: 1, ...extra });
const PROPS = [
  // the courtyard: the barrel pile opposite the door, the bale cart
  ...[[24.5, 42], [25.5, 42.5], [26, 41.5], [25, 43.3], [26.5, 43], [27, 42]].map(([x, z], k) => barrel(`barrel_c${k + 1}`, x, z)),
  crate('cart_court', 'bale_cart', 38, 37, 2.6, 1.6, 1.6),
  // the S quay: crates and sacks, a basket, the carts and the tarp stack
  crate('crates_q1', 'crates_sacks', 23.5, 100, 3, 2.5, 1.4),
  crate('basket_q', 'basket', 29, 102, 0.8, 0.8, 0.8),
  crate('cart_q1', 'bale_cart', 27, 111, 2.6, 1.6, 1.6),
  crate('tarp_q', 'tarp_stack', 18.5, 110, 2.4, 1.8, 1.0),
  crate('cart_q2', 'barrel_cart', 48, 111, 2.6, 1.6, 1.6),
  crate('cart_q3', 'bale_cart', 62, 99.5, 2.6, 1.6, 1.6),
  ...[[66, 4], [75, 5]].map(([x, z], k) => ({ id: `palm_${k + 1}`, type: 'palm', x, z, r: 0.5, h: 8 })),
  // art pass: the harbour command's motor pool at the W end of the S quay (library vehicles, decor + cover), two quay palms
  { id: 'truck_q', type: 'crates', variant: 'truck_parked', label: 'Truck', x: 11.5, z: 118, rot: 0, w: 6, d: 2.3, h: 2.6, block: 2, vehicleArt: 'opel_blitz_cargo' },
  { id: 'car_q', type: 'crates', variant: 'car_parked', label: 'Car', x: 26, z: 118.4, rot: 0, w: 4.6, d: 1.8, h: 1.6, block: 2, vehicleArt: 'citroen11' },
  { id: 'moto_q', type: 'crates', variant: 'moto_parked', label: 'Motorcycle', x: 19.2, z: 117.8, rot: 0, w: 2.4, d: 1.7, h: 1.1, block: 1, vehicleArt: 'r75_sidecar' },
  ...[[2.5, 116.5], [50.5, 118.8]].map(([x, z], k) => ({ id: `palm_q${k + 1}`, type: 'palm', x, z, r: 0.5, h: 9 })),
];
/** Props standing on roofs: cosmetic (raised cells lose their block), lifted by the script to their level. */
const ROOF_PROPS = [
  barrel('barrel_t1', 4, 39, { baseY: LEVEL.A }), barrel('barrel_t2', 6, 38.5, { baseY: LEVEL.A }), barrel('barrel_t3', 8, 39.5, { baseY: LEVEL.A }),
  barrel('barrel_s1', 11.5, 36, { baseY: LEVEL.B }),
  crate('crates_c', 'crates_pile', 41.2, 19.4, 1.6, 1.4, 1.2, { baseY: LEVEL.C }), // "the crates" of e6 (on C)
  crate('crates_souk1', 'crates_pile', 56, 29, 1.4, 1.4, 1.2, { baseY: LEVEL.B }), // the "pile of boxes"
  crate('crates_souk2', 'crates_pile', 58, 30.5, 1.4, 1.4, 1.2, { baseY: LEVEL.B }),
  crate('crates_souk3', 'crates', 57.5, 32.5, 1.2, 1.2, 1.1, { baseY: LEVEL.B }),
  crate('basket_souk', 'basket', 60, 39, 0.8, 0.8, 0.8, { baseY: LEVEL.B }),
  crate('bales_souk', 'bales', 49.5, 26.5, 1.6, 1.2, 1.0, { baseY: LEVEL.B }),
  crate('cushions', 'cushions_rugs', 22, 18, 1.8, 1.2, 0.6, { baseY: LEVEL.B }), // "hide him behind the cushions"
  crate('big_box', 'crate_big', 51.5, 88, 2, 2, 1.8, { baseY: LEVEL.P }), // Kildread's "big box" lure spot on the platform
];

const STRUCTURES = [...BACKDROP, ...WEST, ...EAST, ...MOSQUE, ...QUAY, ...PROPS, ...ROOF_PROPS];

// ---------------------------------------------------------------- ladders and stairs (dossier §6; everyone)
const ladder = (id, x, z, y, top, extra = {}) => ({ id, x, z, y, top, raised: false, ...extra });
const stairs = (id, x, z, y, top, heading) => ladder(id, x, z, y, top, { kind: 'stairs', heading: deg(heading) });
const LADDERS = [
  ladder('L1', 10.8, 44.6, 0, [9.4, 44.2, LEVEL.A], { heading: deg(180) }), // "the ladder in the west", by the GB's door
  stairs('S1', 10.6, 40.5, LEVEL.A, [10.6, 36.2, LEVEL.B], 270), // w_block outer stair ("the door in the stairs")
  ladder('L2', 45.3, 29.2, 0, [47, 27.2, LEVEL.B], { heading: deg(300) }), // "the ladder by 13": courtyard → souk roof
  ladder('L3', 26.5, 30.3, LEVEL.A, [26.5, 28.5, LEVEL.B], { heading: deg(270) }), // "the ladder behind 14"
  ladder('L4', 30.5, 39.2, 0, [30.5, 37.4, LEVEL.A], { heading: deg(270) }), // courtyard ↔ jail ledge
  stairs('C1', 35.7, 23.75, LEVEL.B, [38.3, 22.25, LEVEL.C], 330), // palace roof → raised roof
  stairs('S3', 70, 68.2, LEVEL.E3, [70, 64.5, LEVEL.B], 270), // house_e2 ↔ house_e3 ("the stairs" of 23)
  stairs('S4', 52, 79.5, LEVEL.P, [56, 78.5, LEVEL.E3], 350), // house_e3 ↔ platform
  ladder('L5', 45.4, 75.8, LEVEL.P, [46, 73.5, LEVEL.PAV], { heading: deg(290) }), // platform ↔ pavilion roof
  stairs('S6', 35.5, 112, 0, [38.5, 105, LEVEL.P], 290), // SW stairs: platform → S quay
  stairs('S7', 54, 97.5, 0, [51.5, 95, LEVEL.P], 225), // SE stairs: platform → the alley
  ladder('L6', 54.4, 95.5, 0, [56, 94.5, LEVEL.ARC], { heading: deg(0) }), // alley → arcade roof
];

// ---------------------------------------------------------------- enemies (dossier §8; `prima` = Prima's soldier number)
// Nobody arrests in M12 (jail:false, dossier §12 #6): the only jail holds the Informer; every patrol shoots.
// Not `elevated`: every raised man here stands on a flat roof or terrace, where low cover (the parapets, the
// terrace walls) hides a body or a prone man from him; the roof rule already blinds him to the streets (§4.2).
const lvl = (y) => (y ? { y, elevated: false } : {});
const sentry = (id, prima, x, z, y, h, sweep, extra = {}) => ({ id, prima, soldierType: 'sentry', x, z, heading: deg(h), jail: false, ...lvl(y),
  flags: { holdsPost: true }, post: { heading: deg(h), sweep, period: 8 }, ...extra });
const walker = (id, prima, y, pts, vel = 1.0, extra = {}) => {
  const [a, b] = pts;
  return { id, prima, soldierType: 'soldier', x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), jail: false, ...lvl(y),
    flags: { investigates: true }, route: { type: 'PINGPONG', vel, points: pts }, ...extra };
};
/** 3-man patrol (sergeant + 2 troopers) in one column behind the leader. */
const patrol = (ids, sq, x, z, h, route, extra = {}) => ids.map((id, k) => ({
  id, soldierType: k === 0 ? 'sergeant' : 'trooper', x: +(x - Math.cos(deg(h)) * 1.2 * k).toFixed(2), z: +(z - Math.sin(deg(h)) * 1.2 * k).toFixed(2),
  heading: deg(h), jail: false, squad: { id: sq, leader: ids[0], columns: 1 }, flags: { investigates: true, followsTracks: true }, route, ...extra,
}));
const { A, B: BB, C, E3, P: PY, ARC } = LEVEL;
/** A posted man who leaves his post to look at a body or a noise (Prima's [8] and [18]); census: still a sentry. */
const LOOKS = { flags: { holdsPost: false, investigates: true } };
/** A ledge man overlooking the courtyard (fix round 2; ooc "overlooking the lower level", NL, Kildread): he sees down
 *  past the roof rule; the courtyard still cannot see him. */
const OVER = { overlooks: true };

/** The courtyard patrol's loop (also the palace squad's loop on the siren). */
export const COURT_LOOP = [P(33, 44.8), P(43, 40.5, 4, 0), P(50, 46), P(33, 45.8), P(14, 45.2, 3, 180)];
/** The quay patrol's beat (its E turn is just N of the car; the HQ squad loops it on RSEHQ). */
export const QUAY_BEAT = [P(8, 112.5, 4, 180), P(30, 115), P(46, 115), P(58, 110), P(66, 106, 4, 0)];

const ENEMIES = [
  // ===== Phase 1: the courtyard and the ledge (z_court)
  walker('e1', 1, 0, [P(12, 45.3, 3, 180), P(30, 45.3, 3, 0)]),
  walker('e2', 2, A, [P(2, 39, 3, 270), P(9, 43.5, 3, 90)], 0.9, OVER),
  sentry('e3', 3, 12, 33.5, BB, 90, 60),
  sentry('e4', 4, 18.5, 36.8, BB, 90, 40),
  walker('e5', 5, A, [P(11.5, 40.5, 2, 180), P(19.5, 39), P(22.5, 36, 3, 90)], 0.9, OVER),
  // ===== Phase 2: the northern rooftops (z_court)
  walker('e6', 6, C, [P(38.6, 22.1, 2, 180), P(41.2, 20.6, 4, 90)], 0.8),
  walker('e7', 7, BB, [P(29.5, 21.5, 3, 180), P(38, 16.5, 2, 0)]),
  sentry('e8', 8, 37, 28.8, BB, 90, 60, LOOKS), // "finds 6's body and walks over" [P]
  sentry('e9', 9, 59.5, 35.5, BB, 90, 50),
  walker('e10', 10, BB, [P(53.5, 27.5, 2, 180), P(58.5, 34.5, 3, 90)], 0.9),
  sentry('e11', 11, 67, 33, BB, 180, 50),
  sentry('e12', 12, 51, 25.5, BB, 180, 50),
  sentry('e13', 13, 51.5, 19.5, BB, 180, 60),
  // ===== Phase 3: the jail ledge (z_court)
  sentry('e14', 14, 27.5, 31, A, 90, 50, OVER),
  sentry('e15', 15, 22, 30.5, A, 90, 40, OVER),
  sentry('e16', 16, 26, 36.5, A, 90, 60, OVER),
  // ===== Phase 4: the east roofs (e17–e19 z_court; e20–e23 on house_e3, z_sehq)
  walker('e17', 17, BB, [P(59.5, 49.5, 2, 270), P(60, 62, 3, 90)], 0.9),
  sentry('e18', 18, 72, 60.5, BB, 180, 60, LOOKS), // "finds the body and comes over" [P]
  walker('e19', 19, BB, [P(63.5, 60.5, 2, 180), P(74, 63.5, 3, 0)], 0.9),
  sentry('e20', 20, 57.5, 69.5, E3, 90, 50),
  walker('e21', 21, E3, [P(60, 72, 3, 180), P(72, 74, 3, 0)]),
  walker('e22', 22, E3, [P(62, 82, 3, 180), P(74, 80, 3, 0)]),
  sentry('e23', 23, 70, 70.5, E3, 90, 40),
  // ===== Phase 5: the mosque platform (z_sehq)
  walker('e24', 24, PY, [P(47, 76, 2, 180), P(53, 82, 3, 0)], 0.8),
  walker('e25', 25, PY, [P(41, 84, 2, 180), P(44.5, 90.5, 3, 90)]), // along arcade A2 (fix round: off its line)
  sentry('e26', 26, 38, 86.5, PY, 0, 60),
  walker('e27', 27, PY, [P(46, 92, 2, 180), P(52, 86, 3, 0)]),
  walker('e28', 28, PY, [P(31, 92, 3, 180), P(38, 99, 2, 90)]),
  walker('e29', 29, ARC, [P(57.5, 95.3, 2, 180), P(62.5, 95.3, 3, 90)]), // arcade roof, S side, behind its N/W parapet: he cannot see P2 or the pavilion roof (fix round 2)
  sentry('e30', 30, 47, 97, PY, 90, 50),
  walker('e31', 31, PY, [P(42.6, 100.4, 2, 180), P(45.6, 98.6, 3, 90)]), // the S rim, E of arcade A1 (fix round)
  walker('e32', 32, PY, [P(50, 91, 2, 180), P(53.5, 86, 3, 90)]),
  // ===== Phase 6: the S quay (z_sehq)
  sentry('e33', 33, 42.5, 109.5, 0, 200, 45),
  walker('e34', 34, 0, [P(20.5, 104.5, 3, 0), P(27, 106.5, 3, 180)]),
  walker('e35', 35, 0, [P(9, 105.5, 3, 270), P(15, 108, 2, 0)]),
  // ===== the two 3-man patrols
  ...patrol(['e36', 'e37', 'e38'], 'pt_court', 33, 44.8, 0, { type: 'LOOP', vel: 1.0, points: COURT_LOOP }),
  ...patrol(['e39', 'e40', 'e41'], 'pt_quay', 8, 112.5, 0, { type: 'PINGPONG', vel: 1.0, points: QUAY_BEAT }),
];

// ---------------------------------------------------------------- garrisons (dossier §9; exit 2.7 m/s, loops 1.8 m/s)
const BARRACKS = {
  // RINT (the courtyard siren): three men out of the palace door onto the courtyard loop
  palace: { pool: 5, squads: [
    { id: 'pal', event: 'RINT', size: 3, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, exitRoute: [P(38.5, 33), P(36, 42)], loop: COURT_LOOP.map((p) => P(p.x, p.z)) },
  ] },
  // RSEHQ (fatal): four men pour out onto the quay during the 5 s before the loss
  hq_se: { pool: 10, squads: [
    { id: 'hq', event: 'RSEHQ', size: 4, leader: 'sergeant', exitVel: 2.7, loopVel: 1.8, exitRoute: [P(49.5, 111)], loop: QUAY_BEAT.map((p) => P(p.x, p.z)) },
  ] },
};

// ---------------------------------------------------------------- vehicles (dossier §8.8)
/** The getaway car: ours, parked on the S quay; it leaves E by itself once all four are aboard. */
const VEHICLES = [
  { id: 'kubel', vehicleType: 'kubelwagen', x: 69, z: 111.5, heading: 0, driveable: true, friendly: true, seats: 4 },
];

// ---------------------------------------------------------------- commandos (§3.8 row 12; dossier §7)
const COMMANDOS = [
  // hidden in the west block (D1 fallback: admitted by the start trigger); no shovel from M12 on
  { role: 'greenberet', x: 16.5, z: 44.2, heading: deg(90), hideout: 'w_block_front', inventory: {} },
  // hidden in the rooftop shack on the northern terrace; 7 rounds
  { role: 'sniper', x: 50, z: 15.5, y: LEVEL.B, heading: deg(180), hideout: 'sn_hut', inventory: { sniperRifle: 7 } },
  // in the courtyard, in uniform (startDisguised); carries the mission's first-aid kit (6 doses)
  { role: 'spy', x: 36, z: 41, heading: deg(180), inventory: { firstAid: 6 } },
  // the guest: our Informer, locked in the courtyard cell (character-bible §6.2). Unarmed; key 7.
  { role: 'guest', id: 'informer', guestId: 'informer', name: 'The Informer', nickname: 'Informer', x: 25.5, z: 34, heading: deg(90),
    jailed: true, jailId: 'jail_block', inventory: {} },
];
/** [role, hideout structure, spawn] triples the start trigger admits (only a man still at his spawn, t < 1 s). */
export const START_HIDDEN = [['greenberet', 'w_block_front', { x: 16.5, z: 44.2 }], ['sniper', 'sn_hut', { x: 50, z: 15.5 }]];

/** Lifted roof props [id, y] and the re-blocked roof props (the shack, the kiosk, the big box on the platform). */
const LIFT = [['sn_hut', LEVEL.B], ['kiosk', LEVEL.B], ['l2_hut', LEVEL.B], ...ROOF_PROPS.map((s) => [s.id, s.baseY]), ...MOSQUE_WALLS.map((s) => [s.id, LEVEL.P]), ...ARC_WALLS.map((s) => [s.id, LEVEL.ARC])];
const REBLOCK = [{ x: 53, z: 15.5, w: 5, d: 5 }, { x: 64.5, z: 51.5, w: 6, d: 6 }, { x: 50, z: 29.8, w: 2.4, d: 2.4 }, { x: 51.5, z: 88, w: 2, d: 2 }];
/** The south zone (the harbour HQ's side of z 66). */
const Z_SEHQ = [[0, 66], [76, 66], [76, 120], [0, 120]];
/** Walkable roofs for the parapet / terrace-wall pass (first match wins), the planks it leaves open. */
/** Doorways in the terrace walls (gaps in the parapet pass). */
const DOORWAYS = [[60.5, 49], [65, 36], [71, 48], [20, 27.5], [20.6, 38.2]]; // souk→house_e2, souk→house_e1, house_e1→house_e2, w_block→mid_block, balcony→jail ledge
const ROOFS = [...WEST, ...EAST, PAV, ARCADE].filter((d) => d.roofWalk && d.w).map((d) => ({ id: d.id, poly: rectPoly(d.x, d.z, d.w, d.d, d.rot ?? 0) }));
const PLANKS = [...WEST, ...EAST].flatMap((d) => (d.walkways || []).map((k) => ({ points: k.points, r: (k.width ?? 1.4) / 2 + 0.6 })));

const byIdAlive = (w, id) => { const v = w.byId(id); return v && !v.destroyed && v.alive !== false ? v : null; };
const objDone = (w, id) => !!(w.objectives || []).find((o) => o.id === id)?.done;

// ---------------------------------------------------------------- the mission
export default {
  id: 'm12',
  campaign: 'BEL',
  title: 'Up on the Roof',
  subtitle: 'Tunis, Tunisia · 15 March 1943',
  date: '1943-03-15',
  place: 'Tunis, Tunisia',
  theater: 'desert',
  coneColors: 'green', // urban ground (§2.4 row 12), not the orange desert set
  size: [76, 120],
  seed: 1943_0315,
  briefing: {
    historical: 'March 1943. The Allied armies are pressing into Tunisia, where the Mareth Line is holding them hard. A handful of our men slipped into Tunis to study the Axis defences, but a sweep through the old town scattered them and caught our local contact. They are lying low near the harbour, waiting for us.',
    text: 'There is no siren yet, officer, but they know you are here and they are searching street by street. Your three men are holed up apart from one another. The streets belong to the Germans; the rooftops can still be yours. Our local contact is locked in a cell on the courtyard. Get him out, gather everybody, and make for the car we have left on the quay in the south-east. And whatever you do down there, do it without a sound: there is a headquarters right beside that car.',
    objectivesSummary: 'Free the Informer from the courtyard cell. Then get all four men, the Informer included, into the car on the south-east quay.',
    hints: [
      'Free our contact first, then bring every man, him included, out of the town.',
      'Up on the roofs you cannot be seen from the streets below, and the men down there cannot be seen from up there either. What happens on a roof stays on the roof.',
      'The car is parked on the quay in the south-east corner. It leaves only when everyone is aboard.',
      'Noise in the north only stirs the courtyard. Noise near the harbour headquarters will be the end of us.',
      'The mosque terrace is only a few steps above the quay: the men below can see what happens on it.',
    ],
  },
  lighting: { sunElevDeg: 45, sunAzimuthDeg: 135, kelvin: 5500, hdri: 'clear', fog: 220, lut: 'tunis' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.15 }, // the still harbour basin
  shoreShallowWidth: 0, // quay walls: no shallows
  baseTerrain: 'ground',
  terrain: [
    // T1 the harbour basin (deep; no boat in this mission)
    { type: 'poly', terrain: 'water', points: [[0, 47.05], [40, 47.05], [48, 47.8], [52, 52.4], [50, 60], [46, 67], [20, 82], [20, 90], [0, 114]] },
    // T2 the courtyard cobbles, T3 the S quay street, T4 the alley (paint)
    { type: 'poly', terrain: 'road', points: [[0, 43], [44, 43], [44, 27], [58, 50], [52, 52], [48, 47.5], [0, 47]] },
    { type: 'poly', terrain: 'road', points: [[0, 114], [20, 92], [22, 100], [38, 113], [64, 98], [76, 98], [76, 120], [0, 120]] },
    { type: 'rect', terrain: 'road', x: 52.5, z: 92, w: 3, d: 12 },
  ],
  // art pass: the old town's stone paving over the painted roads (visual only, grid:false: the nav keeps its codes).
  // Its edges run under the wall bases (the palace front, the mosque platform up to the minaret) so no sand wedge shows,
  // and the quay's carries on past the S / E map edges (the apron), like the road under it, instead of stopping there.
  pavements: [
    { id: 'pave_court', surface: 'setts', points: [[0, 37], [20, 37], [30.8, 36.5], [30.8, 29.1], [31.4, 29.1], [32.9, 31.9], [46.75, 23.9], [50, 26.5], [58, 50], [52, 52.4], [48, 47.6], [0, 47.05]], wear: 0.6, weeds: 0.25, cracks: 0.3, patches: 0, puddles: 0.05, grid: false },
    { id: 'pave_quay', surface: 'setts', points: [[-6, 121.2], [0, 114], [20, 90.6], [20.1, 84.5], [22.2, 80.9], [38.15, 108.7], [52.2, 100.3], [52.2, 91.2], [55.5, 91.2], [55.5, 97], [64, 97], [64, 86], [76, 86], [84, 86], [84, 128], [-6, 128]], wear: 0.7, weeds: 0.3, cracks: 0.35, patches: 0, puddles: 0.05, grid: false },
  ],
  // bracket lamps on the courtyard houses, globe lamps on the S shore, the harbour command's telephone line along the S
  // quay, its board; all visual only (block:false) so no route or sight line changes
  furniture: [
    { type: 'lamp', variant: 'wall_bracket', x: 13.6, z: 43.05, rot: Math.PI / 2, block: false },
    { type: 'lamp', variant: 'wall_bracket', x: 22.6, z: 38.05, rot: Math.PI / 2, block: false },
    { type: 'lamp', variant: 'wall_bracket', x: 3.2, z: 46.05, rot: Math.PI / 2, block: false },
    { type: 'lamp', variant: 'harbour', x: 12.9, z: 100.4, rot: deg(40), block: false },
    { type: 'lamp', variant: 'harbour', x: 4.6, z: 110.2, rot: deg(40), block: false },
    { type: 'lamp', variant: 'harbour', x: 40.5, z: 118.6, rot: deg(-90), block: false },
    { type: 'telegraph', points: [[1, 119], [30, 119], [56, 118.9], [75.5, 117.5]], spacing: 13, h: 7, wires: 3, block: false },
    { type: 'sign', variant: 'wehrmacht', x: 34.2, z: 118.9, rot: deg(-90), text: 'HAFENKOMMANDANTUR\nTUNIS', block: false },
  ],
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures(STRUCTURES, [['shed_harbour', 'house_nw'], ['house_nw', 'n_row_1'], ['house_nw', 'mid_block'], ['n_row_1', 'n_row_2'], ['n_row_2', 'n_row_3'], ['n_row_3', 'n_terrace'], ['house_tile', 'w_block_front'], ['house_tile', 'w_block_rear'], ['w_block_front', 'w_block_rear'], ['w_block_front', 'jail_block'], ['w_block_rear', 'jail_block'], ['w_block_rear', 'mid_block'], ['jail_block', 'mid_block'], ['jail_block', 'palace'], ['mid_block', 'palace'], ['palace', 'palace_c'], ['palace', 'n_terrace'], ['n_terrace', 'sn_hut'], ['n_terrace', 'souk'], ['l2_hut', 'souk'], ['souk', 'house_e1'], ['souk', 'house_e2'], ['souk', 'kiosk'], ['house_e1', 'house_e2'], ['house_e1', 'kiosk'], ['house_e2', 'kiosk'], ['house_e2', 'house_e3'], ['house_e3', 'arcade_house']]),
  items: [],
  interactables: [
    // the cell door: frees the Informer (§4.10: not while an enemy sees you)
    { kind: 'jail', id: 'jail_door', x: 27.2, z: 39.2, jailId: 'jail_block' },
  ],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // two zones split at z 66: the north (courtyard, ledge, roofs, souk, e1/e2) sounds a survivable siren; the
  // south (house_e3, the mosque, the quay) alerts the harbour HQ, which fails the mission (alarmFail)
  zones: [
    { id: 'z_court', poly: [[0, 0], [76, 0], [76, 66], [0, 66]], onSeen: 'RINT', onHeard: 'RINT', siren: true },
    // its heard sensor is the script's (southHears): a shout from the north never reaches the HQ, gunfire does
    { id: 'z_sehq', poly: Z_SEHQ, onSeen: 'RSEHQ', onHeard: null, siren: false },
  ],
  jails: ['jail_block'],
  barracks: BARRACKS,
  climbLinks: [], // every level change has a ladder or stairs (dossier §6)
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Free the Informer from the courtyard cell', type: 'script', required: true },
    { id: 'o2', text: 'Everyone, the Informer too, into the car on the south-east quay', type: 'escape', required: true, vehicleId: 'kubel' },
  ],
  setpieces: [],
  triggers: [
    // T3 (D1 fallback): the GB and the Sniper start inside their hideouts
    { on: 'start', once: true, do: [{ run: (w) => startHidden(w, START_HIDDEN) }] },
    // T0: o1 the moment the cell is opened
    { on: 'unit:freed', match: { unit: 'informer' }, once: true, do: [
      { objective: 'o1', set: 'done' },
      { message: 'The contact is free. Take him over the roofs, east and then south, to the car.', kind: 'objective' },
    ] },
    // T2: first step into the harbour zone
    { on: 'area', area: { rect: { x: 0, z: 66, w: 76, d: 54 } }, who: 'commando', once: true,
      do: [{ message: 'Harbour headquarters ahead. Not a sound from here on.', kind: 'warn' }] },
    // the car is our only way out (§8.1 vehicle wording)
    { on: 'vehicle:destroyed', match: { vehicle: 'kubel' }, once: true, when: (_p, w) => !objDone(w, 'o2'),
      do: [{ fail: 'YOU DESTROYED THE CAR, BUT YOU NEEDED IT TO ESCAPE.' }] },
    // boarding before the Informer is out: the car waits (§8.1 "all your men must escape")
    { on: 'vehicle:enter', match: { vehicle: 'kubel' }, once: false, when: (_p, w) => !objDone(w, 'o1') && !!byIdAlive(w, 'kubel'),
      do: [{ message: 'ALL YOUR MEN MUST ESCAPE. The Informer is still in his cell.', kind: 'info' }] },
  ],
  script: m12Script({
    prisms: [{ poly: PLATFORM, y: LEVEL.P }],
    hide: ['mosque_platform'],
    lift: LIFT,
    block: REBLOCK,
    lines: MOSQUE_LINES,
    parapets: { roofs: ROOFS, keep: PLANKS, doors: DOORWAYS },
    southZone: { id: 'z_sehq', poly: Z_SEHQ },
    // fix round 2 art pass: blind arcades on the mosque's inner walls, a ribbed dome on the prayer hall
    arcades: { lines: MOSQUE_WALLS.map((w) => ({ points: w.points, y: LEVEL.P, h: w.h, width: w.width })) },
    dome: { x: HALL.x, z: HALL.z, y: HALL.h, r: 3.4 },
  }),
  // the car is on the quay from the start; once o1 is done and every living man is aboard it drives E off the map
  extraction: { vehicleId: 'kubel', vehicleType: 'kubelwagen', friendly: true, seats: 4, spawnWhen: ['o1'],
    spawnAt: { x: 69, z: 111.5, heading: 0 }, exit: { x: 75, z: 111.5, r: 3 }, leave: { x: 84, z: 111.5, speed: 7 } },
  alarmFail: { event: 'RSEHQ', message: 'THE HARBOUR HEADQUARTERS HAS BEEN ALERTED.' },
  par: { time: 600 },
  cameraStart: { x: 30, z: 40, zoom: 1 },
  startDisguised: ['spy'],
};
