/**
 * LIGHTS OUT mission 4: "Black Rain" (docs/expansion/e04.md). Puits Sainte-Barbe colliery, Creutzberg, Lorraine (a
 * fictional pit in the real Moselle coal basin), 11 August 1944, summer rain. Green Beret, Driver, Sapper, Sniper.
 *
 * Referat N's direction-finding post for eastern France sits on top of the colliery's spoil heap (a timber hut with a
 * loop aerial, 18 m up); the bearing archive is in the station chief's office beside the pithead lamp room. The team
 * comes in from the hedge on the north verge: over the main line behind a coal train, through the exchange sidings,
 * the Driver's rifle on the water-tower sentry, a spoil wagon pushed along the tub tramway as a moving wall, the
 * archive (on the centre alarm the chief carries it to the shaft: lost), remote charges on the two DF lorries, then the
 * incline: winch-only, its winchman cuffed and worked on strings while three men ride up in the spoil skip and the
 * Green Beret climbs the gully; the DF hut goes up on top and the team leaves down the heap's far side.
 *
 * Conventions as the base missions: headings / rot in DEGREES here, converted with deg(); route `look` and
 * `post.sweep` stay in degrees (0 = E, 90 = S, 180 = W, 270 = N). Briefing text is our own wording.
 *
 * Engine-driven deviations from the design (docs/expansion/e04.md §0 "As built"): no building interiors — the lamp-room
 * operators stand outside, the archive is taken by walking into the office (structure `entry`); the spoil heap is four
 * nested `cliff` sight rings (4.5 / 9 / 13.5 / 18 m) so the rim sentry looks down over the flanks; the winch stands
 * under a lean-to on the winding house's east side; the east path is a stepped track with one landing.
 */
import { registerExpansionMission } from './registry.js';
import { joinStructures } from '../schema.js';
import { levelStrips, offsetPoly, clipRect, rampSteps, e04Script } from '../scripts/e04.js';
import { E04_DRESSING, E04_FURNITURE, E04_TREES, buildE04Art } from '../../art/e04-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES

// ---------------------------------------------------------------- the spoil heap (T6; §4.2 `heap`)
export const TOP_Y = 18;
/** The flat top (y 18): convex, the DF hut and the incline's top stop on it. */
export const TOP = [[175, 28], [186, 27], [189.5, 30], [190, 44], [187.5, 49.5], [180, 50.5], [175, 47.5], [173, 40], [173, 31]];
/** (clipped at x 194.4: east of it the heap's foot is HEAP_EAST, north and south of the exit pocket) */
const ring = (d) => clipRect(offsetPoly(TOP, d), 0, 0, 194.4, 110);
/** Sight rings (outer first): each a cliff of its own height, so lines of sight follow the slope, not an 18 m wall. */
export const HEAP_RINGS = [{ id: 'heap_r0', points: ring(8.5), h: 4.2 }, { id: 'heap_r1', points: ring(5.8), h: 9 }, { id: 'heap_r2', points: ring(3), h: 13.5 }];
/** The heap's flanks run on to the east map edge north and south of the pocket (no way round the heap by the edge). */
const HEAP_EAST = [{ id: 'heap_en', points: [[194.5, 16.5], [200, 16.5], [200, 42], [194.5, 42]], h: 4.5 },
  { id: 'heap_es', points: [[194.5, 50.5], [200, 50.5], [200, 62], [194.5, 58]], h: 4.5 }];
/** The east path down the far side, a switchback on the east flank (≈ 29°, ≤ 0.3 m a step): leg A north off the top's
 *  east edge, a landing at y 9, leg B back south into the pocket. */
export const PATH_A = { a: [191.3, 43.6, TOP_Y], b: [191.3, 26.4, 9], width: 2.6, steps: 34 };
export const LANDING = [[190.0, 23.4], [197.8, 23.4], [197.8, 26.4], [190.0, 26.4]];
export const PATH_B = { a: [196.5, 26.4, 9], b: [196.5, 44.6, 0], width: 2.6, steps: 36 };
/** The pocket at the heap's east foot (y 0): the exit, reached only down the east path. */
export const POCKET = [[194.5, 42], [200, 42], [200, 50.5], [194.5, 50.5]];
export const EXIT = { x: 197.4, z: 46.4, r: 3.2 };

// ---------------------------------------------------------------- set pieces
/** The DF hut on the top (o2): a timber hut with its loop aerial; footprint cut out of the top's walkways. */
export const DF_HUT = { x: 182, z: 37.5, w: 5, d: 4, h: 3.4 };
/** The incline: winch-only skip from the heap's SW foot to the top; the winch on the winding house's east side. */
export const INCLINE = { a: [181.5, 67.5, 0], b: [181.5, 48.5, TOP_Y] };
export const WINCH = [178.3, 60.3];
export const WINDING_HOUSE = { x: 174, z: 61.5 };
/** The gully: the Green Beret's climb up the heap's south flank. */
export const GULLY = { a: [186.5, 60.6, 0], b: [186.5, 48.8, TOP_Y] };
/** The tub tramway (the push rail) and the two spoil wagons. */
export const TRAMWAY = [[58, 68], [178, 68]];
export const PUSH_RAIL = [[60, 68], [104, 68]];
/** The east spoil wagon's own run of the tramway: from the lorries' south side to the winding house (it rolls east). */
export const PUSH_RAIL_E = [[141, 68], [168, 68]];
/** The shaft collar the chief drops the archive in, his office door, the archive inside. */
export const SHAFT = [120.5, 44.6];
export const OFFICE = { x: 154, z: 37.5 };
export const OFFICE_DOOR = [154, 42.6];
export const ARCHIVE = [154, 37.3];
/** The main line (z 12) and the exchange sidings (z 18, z 22.5). */
export const MAIN_LINE = [[0, 12], [200, 12]];
const SIDING_N = [[12, 18], [152, 18]], SIDING_S = [[18, 22.5], [56, 22.5]];

const holeRect = (x, z, w, d, m = 0.3) => [[x - w / 2 - m, z - d / 2 - m], [x + w / 2 + m, z - d / 2 - m], [x + w / 2 + m, z + d / 2 + m], [x - w / 2 - m, z + d / 2 + m]];
/** The top's walkways, the DF hut's footprint left blocked (raised cells lose their block). */
const TOP_WALKS = levelStrips(TOP, TOP_Y).flatMap((s) => {
  const [hx0, hz0] = holeRect(DF_HUT.x, DF_HUT.z, DF_HUT.w, DF_HUT.d)[0], [hx1, hz1] = holeRect(DF_HUT.x, DF_HUT.z, DF_HUT.w, DF_HUT.d)[2];
  const z = s.points[0][1];
  if (z < hz0 || z > hz1) return [s];
  const [a, b] = [s.points[0][0], s.points[1][0]], out = [];
  if (hx0 - 0.25 > a) out.push({ ...s, points: [[a, z], [+(hx0 - 0.25).toFixed(2), z]] });
  if (b > hx1 + 0.25) out.push({ ...s, points: [[+(hx1 + 0.25).toFixed(2), z], [b, z]] });
  return out;
});

// (gameplay only: the heap's surface is drawn by art/e04-dressing.js buildHeap)
const cliff = (id, points, h, extra = {}) => ({ id, type: 'cliff', variant: 'spoil_heap', points, h, block: 2, climbable: false, fixed: true, visual: false, ...extra });
const HEAP = [
  ...HEAP_RINGS.map((r) => cliff(r.id, r.points, r.h)),
  ...HEAP_EAST.map((r) => cliff(r.id, r.points, r.h)),
  cliff('heap_top', TOP, TOP_Y, { walkways: TOP_WALKS }),
  // (after the rings: their walkways overwrite the flank cells they cross; the exit pocket is open ground)
  cliff('heap_path_a', [[190, 26.4], [192.6, 26.4], [192.6, 43.6], [190, 43.6]], TOP_Y, { variant: 'heap_path', walkways: rampSteps(PATH_A.a, PATH_A.b, PATH_A.width, PATH_A.steps) }),
  cliff('heap_landing', LANDING, 9, { variant: 'heap_path', walkways: levelStrips(LANDING, 9) }),
  cliff('heap_path_b', [[195.2, 26.4], [197.8, 26.4], [197.8, 42.0], [195.2, 42.0]], 9, { variant: 'heap_path', walkways: rampSteps(PATH_B.a, PATH_B.b, PATH_B.width, PATH_B.steps) }),
];

// ---------------------------------------------------------------- buildings and works (§4.2)
const wagon = (id, x, z) => ({ id, type: 'train_car', variant: 'coal_open', label: 'Coal wagon', x, z, rot: 0, w: 10, d: 2.8, h: 3.2, fixed: true });
const STRUCTURES = [
  ...HEAP,
  // --- rails: the main line, the exchange sidings, the tub tramway (the push rail)
  // (flatBed: the ground's render relief is levelled under the ballast, as M19's mine railway: the bed no longer
  // undulates ±12 cm through the 3 cm ballast and the sleepers, which z-fought along the crossings — zfight.mjs)
  { id: 'main_line', type: 'rail_track', points: MAIN_LINE, flatBed: true },
  { id: 'siding_n', type: 'rail_track', variant: 'rusty', points: SIDING_N, flatBed: true },
  { id: 'siding_s', type: 'rail_track', variant: 'rusty', points: SIDING_S, flatBed: true },
  { id: 'tramway', type: 'rail_track', variant: 'rusty', points: TRAMWAY, flatBed: true },
  // static coal wagons on the sidings (B.HIGH): a maze between the fence and the screens
  wagon('cw1', 21, 18), wagon('cw2', 31.5, 18), wagon('cw3', 51, 18), wagon('cw4', 61.5, 18), wagon('cw5', 72, 18),
  wagon('cw6', 95, 18), wagon('cw7', 105.5, 18), wagon('cw8', 125, 18), wagon('cw9', 135.5, 18), wagon('cw10', 146, 18),
  wagon('cw11', 25, 22.5), wagon('cw12', 45, 22.5), wagon('cw13', 83.5, 18),
  // --- the north fence (chainlink 2 m): a gap at the level crossing x 38–42
  { id: 'fence_nw', type: 'fence', variant: 'chainlink', points: [[0, 14.6], [37.6, 14.6]], h: 2 },
  { id: 'fence_ne', type: 'fence', variant: 'chainlink', points: [[42.4, 14.6], [200, 14.6]], h: 2 },
  // --- the pit gate on the west road
  { id: 'gate', type: 'gate', variant: 'barrier_boom', x: 30, z: 50, rot: deg(90), w: 4.6, d: 0.3, h: 1.2, fixed: true },
  { id: 'gate_box', type: 'hut', variant: 'sentry_box', x: 33.6, z: 46.4, rot: deg(90), w: 1.8, d: 1.8, h: 2.6, asset: 'guard_hut_b', fixed: true },
  { id: 'weigh', type: 'hut', variant: 'weighbridge_hut', label: 'Weighbridge hut', x: 18, z: 55.5, rot: 0, w: 4.1, d: 3.9, h: 3.4, asset: 'lock_control_shack', fixed: true },
  // --- the screens and washery (drawn by art/e04-dressing.js: corrugated iron on a steel frame, conveyor gallery)
  { id: 'screens', type: 'hangar', variant: 'screens_washery', label: 'Screens and washery', x: 78, z: 35, rot: 0, w: 44, d: 14, h: 12, fixed: true,
    walkways: [{ id: 'gantry_n', points: [[70.4, 28.35], [99.6, 28.35]], width: 0.7, y: 8 }, { id: 'gantry_s', points: [[70.4, 41.65], [92.6, 41.65]], width: 0.7, y: 8 }] },
  // --- the water tower (deck y 10.3 for its sentry)
  { id: 'water_tower', type: 'watchtower', variant: 'water_tower_legs', label: 'Water tower', x: 90, z: 50, rot: 0, w: 5, d: 4.8, h: 10.3, deckY: 10.3,
    asset: 'water_tower_legs_ms', fixed: true },
  // --- the shaft: the headframe (deck y 14 for its sentry; drawn as a steel lattice headframe) and its winding engine house
  { id: 'headframe', type: 'watchtower', variant: 'headframe_steel', label: 'Headframe', x: 120.5, z: 39, rot: 0, w: 7, d: 7, h: 14, deckY: 14, fixed: true },
  { id: 'engine_house', type: 'house', variant: 'winding_engine_house', label: 'Winding engine house', x: 109, z: 47, rot: 0, w: 12, d: 11.9, h: 8.4,
    asset: 'garage_brick', fixed: true },
  // --- the lamp room and the chief's office (the archive: walk in by the office door)
  { id: 'lamp_room', type: 'house', variant: 'lamp_room', label: 'Lamp room', x: 140, z: 37, rot: 0, w: 16.6, d: 12.5, h: 7.2,
    asset: 'station_rail_goods', fixed: true },
  { id: 'office', type: 'house', variant: 'chief_office', label: "Station chief's office", x: OFFICE.x, z: OFFICE.z, rot: 0, w: 6.6, d: 6, h: 6,
    asset: 'hut_brick_be', fixed: true, entry: { path: [[OFFICE_DOOR[0], 43.6], [OFFICE_DOOR[0], 40.5]], at: ARCHIVE, face: 0 } },
  // --- the pithead baths (the garrison: door W)
  { id: 'baths', type: 'barracks', variant: 'barracks_corrugated_iron', label: 'Pithead baths', x: 123.2, z: 56.6, rot: 0, w: 13.5, d: 10.5, h: 6.6,
    asset: 'barracks_c', flag: true, garrison: true, door: deg(180), fixed: true },
  // --- the incline winding house at the heap's foot (the winch under its east lean-to)
  { id: 'inc_house', type: 'hut', variant: 'incline_winding_house', label: 'Incline winding house', x: WINDING_HOUSE.x, z: WINDING_HOUSE.z, rot: 0, w: 6.6, d: 6, h: 6,
    asset: 'hut_brick_be', fixed: true },
  // --- the DF hut on the top (o2): bomb only
  { id: 'df_hut', type: 'hut', variant: 'df_hut_loop', label: 'DF hut', x: DF_HUT.x, z: DF_HUT.z, rot: 0, w: DF_HUT.w, d: DF_HUT.d, h: DF_HUT.h, fixed: true,
    destructible: true, bombOnly: true, destroyedBy: ['explosion'], hp: 100 },
  // --- the smithy and the pit-prop stacks on the slurry (B.HIGH cover)
  { id: 'smithy', type: 'hut', variant: 'forge_shed', label: 'Smithy', x: 90, z: 81, rot: 0, w: 4, d: 4.2, h: 3.4, asset: 'shed_tarred_be', fixed: true },
  ...[[48, 80], [54.5, 80.4], [61, 82], [67.5, 80]].map(([x, z], k) => ({ id: `props_${k + 1}`, type: 'crates', variant: 'timber_stack', label: 'Pit props', visual: false,
    x, z, rot: deg(k % 2 ? 4 : -3), w: 4.2, d: 1.8, h: 2.4, block: 2, fixed: true })),
  ...E04_DRESSING,
  ...E04_TREES,
];

// ---------------------------------------------------------------- enemies (§7)
const sentry = (id, x, z, h, sweep, extra = {}) => ({ id, soldierType: 'sentry', x, z, heading: deg(h), flags: { investigates: false, holdsPost: true },
  post: { heading: deg(h), sweep }, ...extra });
const guard = (id, type, x, z, h, sweep, extra = {}) => ({ id, soldierType: type, x, z, heading: deg(h), post: { heading: deg(h), sweep }, ...extra });
const walker = (id, pts, extra = {}) => ({ id, soldierType: 'soldier', x: pts[0].x, z: pts[0].z, heading: deg(pts[0].look ?? 0),
  flags: { investigates: true, followsTracks: true }, route: { type: 'PINGPONG', vel: 1.0, points: pts }, ...extra });
const up = (y) => ({ y, elevated: true });

const ENEMIES = [
  // ===== west (z_west)
  sentry('gt1', 27.6, 53.2, 180, 40), // up the west road from the boom
  { ...guard('gt2', 'soldier', 36, 45.6, 0, 50), only: 'hard' }, // into the yard
  walker('sd1', [P(24, 20.25, 6, 270), P(100, 20.25, 6, 90)]), // between the sidings
  sentry('sc1', 54.4, 35, 180, 40), // the screens' west door
  { id: 'sc2', soldierType: 'soldier', x: 54, z: 26.4, heading: 0, flags: { investigates: true, followsTracks: true },
    route: { type: 'LOOP', vel: 1.0, points: [P(54, 26.4), P(101.6, 26.4, 5, 270), P(101.6, 43.6, 5, 90), P(54, 43.6, 5, 180)] } }, // round the screens
  sentry('ws1', 78, 43.6, 90, 50), // the screens' south door
  guard('sb1', 'soldier', 88, 28.35, 270, 40, { ...up(8), flags: { investigates: false, holdsPost: true } }), // the north gantry: the sidings
  { ...sentry('sb2', 84, 41.65, 90, 60, up(8)), only: 'hard' }, // the south gantry: the yard's west half
  sentry('wt1', 90, 50, 90, 90, { ...up(10.3), tower: 'water_tower' }), // the water tower
  // ===== centre (z_centre)
  sentry('hf1', 122.6, 44.6, 90, 50), // the shaft gate
  sentry('hf2', 120.5, 39, 270, 90, { ...up(14), tower: 'headframe' }), // the headframe platform: the sidings and the line
  { id: 'lt', soldierType: 'lieutenant', x: 153.4, z: 44.8, heading: deg(270), flags: { investigates: true, followsTracks: false },
    route: { type: 'PINGPONG', vel: 1.0, points: [P(153.4, 44.8, 60, 270), P(140, 49.4), P(131, 49.4), P(115.7, 55.6, 40, 0)] } }, // office ↔ the baths' west door
  sentry('lr1', 130.4, 37, 180, 30), // the lamp room's west end
  walker('lr2', [P(134, 28.6, 5, 0), P(158, 28.6, 5, 180)]), // the lamp room's north side (the aerial lead-in)
  sentry('of1', 154, 44.2, 90, 40), // the office door: south over the lorries
  walker('y1', [P(104, 74.6, 6, 180), P(138, 74.6, 6, 90)]), // the slurry south of the tramway; at his east end he looks out over the lagoon
  { ...walker('y2', [P(104, 79.2, 6, 180), P(138, 79.2, 6, 90)]), only: 'hard' }, // the slurry further south, in step with y1
  sentry('tl1', 143, 57, 180, 50), // between the DF lorries
  { id: 'd1', soldierType: 'truckDriver', vehicle: 'lorry_a', x: 139, z: 56.5 }, // asleep in the cabs
  { id: 'd2', soldierType: 'truckDriver', vehicle: 'lorry_b', x: 147, z: 56.5 },
  sentry('b1', 115.2, 58.6, 180, 40), // the baths' west door: west over the yard
  { ...walker('gs1', [P(100, 87.2, 8, 90), P(140, 87.2, 8, 90)]), only: 'hard' }, // the lagoon bank with his dog
  { id: 'dog1', soldierType: 'dog', x: 100, z: 88.6, heading: 0, route: { type: 'PINGPONG', vel: 1.0, points: [P(100, 88.6, 8, 90), P(140, 88.6, 8, 90)] }, only: 'hard' },
  walker('lg1', [P(60, 91.6, 6, 90), P(150, 91.6, 6, 90)]), // the lagoon bank, looking at the water at both ends
  // the yard patrol (sergeant + 2): round the middle of the yard, never knocked out (patrol immunity)
  ...[[58, 46], [56.8, 46], [55.6, 46]].map(([x, z], k) => ({ id: `p1${'abc'[k]}`, soldierType: k ? 'trooper' : 'sergeant', x, z, heading: 0,
    flags: { investigates: true, followsTracks: true }, squad: { id: 'p1', leader: 'p1a', columns: 1 },
    route: { type: 'LOOP', vel: 1.0, points: [P(58, 46), P(84, 46, 4, 0), P(84, 60, 4, 90), P(58, 60, 4, 180)] } })),
  // ===== east (z_east)
  sentry('wh1', 176.2, 65.8, 0, 30), // the winding house's south-east corner: east over the incline foot
  { id: 'w1', soldierType: 'soldier', x: WINCH[0], z: 61.6, heading: deg(90), flags: { investigates: false, followsTracks: false },
    route: { type: 'PINGPONG', vel: 1.0, points: [P(WINCH[0], 61.6, 18, 90), P(179.2, 66.4), P(173.4, 66.6, 14, 0)] } }, // the winchman: at his drum watching the skip at the foot, then in the house's south door: the puppet
  sentry('iw1', 176, 86, 90, 40), // the lagoon's east bank: out over the slurry lagoon
  sentry('hp1', 176.6, 48.2, 60, 0, up(TOP_Y)), // the heap rim: down on the winch, the incline foot and the heap's south foot
  { ...sentry('hp2', 176.6, 31.8, 270, 40, up(TOP_Y)), only: 'hard' }, // the north rim: over the heap's north foot and the sidings' end
  guard('df1', 'soldier', DF_HUT.x, 40.3, 270, 0, { ...up(TOP_Y), flags: { investigates: false, holdsPost: true } }), // at the set by the hut door
  { ...sentry('df2', 185.4, 39.8, 0, 40, up(TOP_Y)), only: 'hard' }, // the hut's SE corner: east over the path down the far side
];

// ---------------------------------------------------------------- the def
const RUN_EXIT = [[113.6, 59.6], [100.5, 66]];
const B_LOOP_W = [P(100.5, 66), P(56, 66), P(52, 44.5), P(100.5, 44.5)];
const B_LOOP_C = [P(118, 50), P(152, 47.6), P(152, 52.2), P(131, 52.2)];
const B_LOOP_E = [P(166, 66), P(178, 66), P(188, 63.4), P(178, 66)];

const SCRIPT_OPTS = {
  objective: 'o1', archive: 'archive', chief: 'lt', office: [OFFICE_DOOR[0], 44.2], shaft: SHAFT, alarm: 'RC', lockOn: 'RE',
  ring: 10, failText: 'THE ARCHIVE IS AT THE BOTTOM OF SAINTE-BARBE.',
  lorries: [{ id: 'lorry_a', to: [[139, 64.8], [100, 64.8], [60, 58], [44, 55], [2, 50]] }, { id: 'lorry_b', to: [[147, 64.8], [100, 64.8], [60, 58], [44, 55], [2, 50]] }],
  incline: 'incline', winchman: 'w1',
  art: (w) => buildE04Art(w, { top: TOP, topY: TOP_Y, rings: HEAP_RINGS, pocket: POCKET, pathA: PATH_A, pathB: PATH_B, landing: LANDING, incline: INCLINE,
    gully: GULLY, dfHut: DF_HUT, winch: WINCH, house: WINDING_HOUSE, tramway: TRAMWAY, shaft: SHAFT, shaftFrame: [120.5, 39], landingY: 9,
    roads: [[[0, 50], [36, 50], [44, 55], [60, 58]], [[100, 64.8], [166, 64.8]]], tracks: [MAIN_LINE, SIDING_N, SIDING_S, TRAMWAY] }),
};

const def = {
  id: 'e04', campaign: 'BCD', number: 4,
  title: 'Black Rain', place: 'Puits Sainte-Barbe, Creutzberg, Lorraine, France', date: '1944-08-11',
  pin: { lat: 49.15, lon: 6.75 },
  context: 'August 1944. Our armies are breaking out of Normandy and the enemy is pulling his special units east. One of them is a direction-finding post for eastern France: since the winter it has worked from the top of a colliery spoil heap in the Lorraine coal basin, where its loop aerial sees every transmitter between Nancy and the Saar.',
  subtitle: 'Puits Sainte-Barbe, Lorraine · 11 August 1944',
  theater: 'temperate',
  coneColors: 'green',
  size: [200, 110],
  seed: 1944_0811,
  briefing: {
    historical: 'August 1944. The Allied armies are out of Normandy and racing east, and the enemy is moving his listening units back towards the Reich. In the Lorraine coal basin a direction-finding post that has hunted resistance radios since the winter is packing up to go.',
    text: 'Four of you, in daylight, in the rain. Their bearing archive has found a hundred sets; it is in the station chief\'s office beside the lamp room. Bring it out before anyone can throw it down the shaft, which is what they are told to do. Then the heap: the hut on top goes up with a charge, and their two lorries in the yard go up by remote when you are clear. The only way up the heap is the incline, a skip on a cable worked from the winch beside the winding house at its foot. Take the winchman when he steps into his doorway, handcuff him and work him like a puppet: a winchman sending up a skip is nothing to look at twice. The Green Beret can climb the gully on the heap\'s south side; nobody else can. You leave over the top and down the far side. Mind the coal train on the main line, and mind the slurry: it holds your footprints.',
    objectivesSummary: 'Take the bearing archive. Blow the DF hut on the heap and both DF lorries. Leave over the heap and down its far side.',
    hints: [
      'A spoil wagon pushed along the tramway is a wall that walks with you. Keep it between you and the eyes that matter.',
      'The Driver\'s rifle kills at thirty paces with one round, but it is as loud as a pistol. Shoot where nobody is within twenty paces of you.',
      'The coal train hides whatever is on the far side of it while it passes. It also kills whatever is on its track.',
      'The skip moves only when the winch is worked. A handcuffed winchman on strings works it like any winchman.',
      'If the alarm sounds round the pithead before you have the archive, the station chief carries it to the shaft.',
      'The slurry south of the tramway holds footprints, and the yard walkers follow them.',
    ],
  },
  lighting: { sunElevDeg: 38, sunAzimuthDeg: 200, kelvin: 6800, hdri: 'overcast_temperate', fog: 160, lut: 'temperate' },
  weather: { wind: { preset: 'gusty', dirDeg: 250 } },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.05, preset: 'slurry' }, // the slurry lagoon: black, oily, still
  baseTerrain: 'ground',
  terrain: [
    { type: 'rect', terrain: 'grass', x: 0, z: 0, w: 200, d: 10 }, // the north verge
    { type: 'poly', terrain: 'mud', points: [[40, 71], [176, 71], [178, 95], [40, 95]] }, // the slurry flats (prints)
    { type: 'poly', terrain: 'mud', points: [[0, 88], [40, 88], [40, 95], [0, 95]] },
    { type: 'rect', terrain: 'water', x: 0, z: 96, w: 200, d: 14 }, // the slurry lagoon
    { type: 'path', terrain: 'road', points: [[0, 50], [36, 50], [44, 55], [60, 58]], width: 4.5 }, // the west road into the yard
    { type: 'path', terrain: 'road', points: [[40, 0], [40, 16]], width: 4 }, // the level crossing
    { type: 'path', terrain: 'road', points: [[100, 64.8], [166, 64.8]], width: 2.4 }, // the lane along the baths and the lorries
    { type: 'rect', terrain: 'grass', x: 194.5, z: 42, w: 5.5, d: 8.5 }, // the pocket at the heap's east foot
  ],
  structures: joinStructures(STRUCTURES, [['lamp_room', 'office']]),
  furniture: E04_FURNITURE,
  vehicles: [
    // the coal train on the main line, E → W, every ~2 minutes (Hard) / ~2.5 (Easy); it hides what is behind it and
    // kills whatever stands on its track
    { id: 'coal_train', vehicleType: 'train', x: 199.5, z: 12, heading: deg(180), driveable: false, horn: true, only: 'hard',
      track: [[199.5, 12], [0.5, 12]], schedule: { mode: 'once', speed: 9, period: 95, delay: 20 } },
    { id: 'coal_train_easy', vehicleType: 'train', x: 199.5, z: 12, heading: deg(180), driveable: false, horn: true, only: 'easy',
      track: [[199.5, 12], [0.5, 12]], schedule: { mode: 'once', speed: 9, period: 125, delay: 20 } },
    // the two DF lorries (o3): remote charges, detonated from anywhere
    { id: 'lorry_a', vehicleType: 'truck', variant: 'opel_canvas', label: 'DF lorry', x: 139, z: 56.5, heading: deg(270), driveable: true },
    { id: 'lorry_b', vehicleType: 'truck', variant: 'opel_canvas', label: 'DF lorry', x: 147, z: 56.5, heading: deg(270), driveable: true },
  ],
  commandos: [
    { id: 'gb', role: 'greenberet', x: 9, z: 3.6, heading: deg(90), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
    { id: 'dr', role: 'driver', x: 6, z: 4.2, heading: deg(90), stance: 'crawl', inventory: { pistol: 1, smg: 100, firstAid: 2 } },
    { id: 'sa', role: 'sapper', x: 12, z: 4.4, heading: deg(90), stance: 'crawl',
      inventory: { pistol: 1, remoteBomb: 3, grenade: 3, wireCutters: 1, bearTrap: 1, cigarettes: 3 } }, // (BEL: never time and remote charges together: three remotes, the third for the DF hut)
    { id: 'sn', role: 'sniper', x: 3.4, z: 4.8, heading: deg(90), stance: 'crawl', inventory: { sniperRifle: 6, pistol: 1, firstAid: 2 } },
  ],
  enemies: ENEMIES,
  interactables: [
    { kind: 'pushable', id: 'wag_p1', variant: 'spoil', label: 'Spoil wagon', x: 64, z: 68, size: [4, 2.2], rail: PUSH_RAIL },
    { kind: 'pushable', id: 'wag_p2', variant: 'spoil', label: 'Spoil wagon', x: 143, z: 68, size: [4, 2.2], rail: PUSH_RAIL_E },
    { kind: 'lift', id: 'incline', label: 'Incline skip', x: INCLINE.a[0], z: INCLINE.a[1], a: INCLINE.a, b: INCLINE.b, winchOnly: true, enclosed: true,
      travel: 8, capacity: 4, boardR: 1.7, creak: 8, winchMsg: 'The skip is worked from the winding house.' },
    { kind: 'winch', id: 'incline_winch', label: 'Incline winch', x: WINCH[0], z: WINCH[1], targets: ['incline'] },
    { kind: 'documents', id: 'archive', label: 'Bearing archive', x: ARCHIVE[0], z: ARCHIVE[1], inside: 'office' },
  ],
  objectives: [
    { id: 'o1', text: 'Take the bearing archive from the chief\'s office', type: 'script', required: true },
    { id: 'o2', text: 'Blow the DF hut on the heap', type: 'destroy', targets: ['df_hut'], required: true },
    { id: 'o3', text: 'Blow both DF lorries', type: 'destroy', targets: ['lorry_a', 'lorry_b'], required: true },
    { id: 'o4', text: 'Everyone over the heap and down the far side', type: 'escape', required: true },
  ],
  extraction: { zone: { x: EXIT.x, z: EXIT.z, r: EXIT.r } },
  zones: [
    { id: 'z_west', poly: [[0, 14], [100, 14], [100, 95], [0, 95]], onSeen: 'RW', onHeard: 'RW' },
    { id: 'z_centre', poly: [[100, 14], [162, 14], [162, 95], [100, 95]], onSeen: 'RC', onHeard: 'RC', siren: true },
    { id: 'z_east', poly: [[162, 14], [200, 14], [200, 95], [162, 95]], onSeen: 'RE', onHeard: 'RE', siren: true },
  ],
  barracks: {
    baths: { pool: 8, squads: [
      { event: 'RW', size: 2, exitVel: 2.7, exitRoute: RUN_EXIT.map(([x, z]) => P(x, z)), loopVel: 1.8, loop: B_LOOP_W },
      { event: 'RC', size: 3, exitVel: 2.7, exitRoute: [P(113.6, 59.6), P(118, 50)], loopVel: 1.8, loop: B_LOOP_C },
      { event: 'RE', size: 3, exitVel: 2.7, exitRoute: [P(113.6, 59.6), P(131, 66), P(166, 66)], loopVel: 1.8, loop: B_LOOP_E },
    ] },
  },
  jails: [],
  climbLinks: [{ id: 'gully', a: GULLY.a, b: GULLY.b, roles: ['greenberet'] }],
  ladders: [{ id: 'gantry_ladder', x: 101.2, z: 29.2, top: [99.4, 28.35, 8] }],
  triplines: [],
  triggers: [
    { on: 'objective', match: { id: 'o1', status: 'done' }, once: true, do: [{ message: 'The archive is ours. Now the lorries, and the heap.', kind: 'objective' }] },
    { on: 'area', area: { poly: TOP }, who: 'commando', once: true, do: [{ message: 'The top of the heap. The DF hut and its loop aerial.', kind: 'info' }] },
  ],
  script: e04Script(SCRIPT_OPTS),
  // the heap's top is an open hill, not a roof: the rim sentry looks down on the yard and the yard sees men on the rim
  rules: { roofRule: false },
  alarmFail: null,
  par: { time: 1140 },
  cameraStart: { x: 14, z: 8, zoom: 1 },
  variants: {
    easy: { par: { time: 1200 }, routeSpeedMul: 0.8, pauseMul: 2.5, script: e04Script({ ...SCRIPT_OPTS, ring: 15 }),
      enemyPatch: {
        hf1: { post: { heading: deg(90), sweep: 20 } },
        hp1: { post: { heading: deg(60), sweep: 0 } },
      } },
    hard: { par: { time: 1140 },
      enemyPatch: { tl1: { post: { heading: deg(180), sweep: 70 } } } },
  },
};
registerExpansionMission(def);
export default def;
