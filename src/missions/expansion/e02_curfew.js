/**
 * LIGHTS OUT mission 2: Curfew (docs/expansion/e02.md). Owned by MISSIONS.
 * Quartiere Scirocco, Naples, 29 September 1943, 23:10, blackout. The city has risen; a Referat N direction-finding
 * team works from the Palazzo Scirocco over a quarter that climbs from the port to the hill in three steps:
 *   A (y 0)  Via Marina and the lower quarter: the burning-tram barricade (the start), the roadblock, three vicoli and
 *            the cross-alley, the low house with the washing on its terrace;
 *   B (y 4)  the piazza, the palazzo (courtyard, DF van, cellar), the church and its bell tower;
 *   C (y 8)  Via Alta, the motor pool and the aqueduct cistern (the exit).
 * Take the bearings log from the van (o1), put the roof searchlight out (o2), free Captain Hollis (o3), and get
 * everyone, Hollis and Tonino too, into the cistern (o4). If the palazzo raises its alarm while its sleeping driver is
 * free, the van drives off with the log and the mission is lost (scripts/e02.js).
 *
 * Conventions (as M12/M20): dossier headings / rot in DEGREES (0 = E, 90 = S), converted with deg(); route `look` and
 * `post.sweep` stay in degrees. Briefing text is our own wording. Every building is a gameplay box whose `h` is its
 * height over the level it stands on (grid.blockBase measures that level); the quarter's art is drawn by
 * missions/scripts/e02.js and art/e02-dressing.js on these very boxes.
 *
 * Deviations from the design (docs/expansion/e02.md §0 notes them too):
 *  - the levels are `cliff` polygons raised cell by cell (the M5/M20 method); the Scalinata, both salite and the
 *    vehicle ramp are structure `ramps` (cells that climb, M3/M8); the bell tower is a `watchtower` deck with a ladder;
 *  - the searchlight stands at (26,47) and the belfry at (66,59): 41.8 m apart, inside the sniper rifle's 45 m (the
 *    design's (20,46) was 48 m from the belfry);
 *  - the van is scripted (a vehicle may not drive on a raised level): it rolls through the palazzo's rear gate, up
 *    the ramp and off along Via Alta on its own path (scripts/e02.js vanFlight);
 *  - the barricade strip is not a `noWalk` for enemies only (the engine's noWalk is for everyone, and the team
 *    starts there): nobody's beat or squad route enters it;
 *  - c3 does not go inside: he waits 25 s at the main door facing it.
 */
import { registerExpansionMission } from './registry.js';
import { joinStructures } from '../schema.js';
import { plateauWalkways } from '../scripts/m05.js';
import { e02Script, VAN_PATH } from '../scripts/e02.js';
import { E02_PROPS, E02_FURNITURE, E02_VARIANTS } from '../../art/e02-dressing.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)

/** Level heights (design §1): A the port, B the piazza, C Via Alta; the palazzo roof and the belfry; the terrace. */
export const Y = { A: 0, B: 4, C: 8, ROOF: 16, BELL: 16, TERRACE: 4.5 };

// ---------------------------------------------------------------- the quarter's boxes (x0, z0, x1, z1, height over its level)
/** Rect box → structure fields. */
const box = (x0, z0, x1, z1) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
/** A block of tufa houses (not enterable, roofs not walkable). `level`: the level it stands on (art lifts it). */
const block = (id, x0, z0, x1, z1, h, level = 'A', extra = {}) => ({ id, type: 'house', variant: 'tufa_townhouse', ...box(x0, z0, x1, z1), rot: 0, h,
  mat: 'plaster', roof: 'roofTerracotta', level, nav: true, chimney: false, ...extra });

/** Level A (y 0): the lower quarter between the retaining wall (z 92) and Via Marina (z 118). */
export const BLOCKS_A = [
  block('blk_a1', 0, 92, 24, 104, 13),
  block('blk_a2', 0, 107, 24, 118, 13),
  block('blk_b1', 27, 92, 46, 104, 13),
  block('blk_b1e', 46, 98, 48.5, 104, 13),
  block('blk_b2', 27, 107, 36, 118, 13),
  block('blk_c1', 54, 92, 74, 104, 13),
  block('blk_c1w', 52, 98, 54, 104, 13),
  // the corner house on Vico 2's east side keeps its street door unlocked (a hideout: a man inside is out of sight)
  block('blk_c2', 52, 107, 74, 118, 13, 'A', { enterable: true, door: [51.6, 110.4], label: 'House' }),
  block('blk_d1', 77, 92, 100, 104, 13),
  block('blk_d2', 77, 107, 100, 118, 13),
];
/** The low house in the court off the cross-alley: its terrace (y 4.5) carries the washing line; an outside stair E. */
export const LOW_HOUSE = { id: 'lowh', type: 'flat_roof_house', variant: 'tufa_low_terrace', ...box(36, 110, 43, 118), rot: 0, h: Y.TERRACE,
  mat: 'plaster', roofWalk: true, level: 'A', chimney: false,
  ramps: [{ id: 'lowh_stair', points: [[43.75, 117.4], [43.75, 111.6]], width: 1.3, y0: 0, y1: Y.TERRACE }] };
/** The stair's landing on a masonry pier at the terrace's north-east corner: a flight is got on to only at its foot or
 *  head, head-on (grid runs), so its head lands on this, level with the terrace beside it. */
export const LOW_LANDING = { id: 'lowh_landing', type: 'flat_roof_house', variant: 'tufa_stair_landing', ...box(43, 110, 44.6, 111.6), rot: 0, h: Y.TERRACE,
  mat: 'plaster', roofWalk: true, level: 'A', chimney: false };
/** The court's yard walls: along Vico 2 (E) and on Via Marina (S). The Via Marina wall keeps a gap by the stair's foot
 *  (x 44.4–45.9, where its gate has gone for firewood): the court opens onto the avenue there and onto the cross-alley. */
export const COURT_GAP = [45.15, 117.75];
const COURT_WALLS = [
  { id: 'court_wall_e', type: 'wall', variant: 'tufa_yard_wall', points: [[48.5, 107.4], [48.5, 117.6]], width: 0.5, h: 2.6, mat: 'plaster' },
  { id: 'court_wall_s', type: 'wall', variant: 'tufa_yard_wall', points: [[45.9, 117.75], [48.5, 117.75]], width: 0.5, h: 2.6, mat: 'plaster' },
];

/** Level B (y 4): the palazzo (a U round its courtyard), its neighbours, the upper blocks, the church. */
export const PALAZZO = {
  nw: { id: 'pal_nw', ...box(10, 44, 22, 50) }, // the main door (20, 50) on its courtyard face; the garrison
  ne: { id: 'pal_ne', ...box(26, 44, 36, 50) }, // the searchlight platform on its roof
  w: { id: 'pal_w', ...box(10, 50, 16, 66) }, // the cellar (Hollis) on its ground floor; the cellar door (16, 62)
  s: { id: 'pal_s', ...box(10, 66, 36, 72) },
};
const palWing = (p, h, extra = {}) => ({ ...p, type: 'house', variant: 'palazzo_wing', rot: 0, h, mat: 'plaster', roof: 'roofTerracotta', level: 'B', nav: true, chimney: false, ...extra });
export const PAL_ROOF = { x: 30, z: 47, y: Y.ROOF }; // the searchlight crew's post (c4)
export const BLOCKS_B = [
  palWing(PALAZZO.nw, 12, { label: 'Palazzo Scirocco', flag: false, garrison: true, door: [20, 50.3] }),
  palWing(PALAZZO.ne, 12),
  // the searchlight's platform on the north-east wing's roof (y 16): a deck of its own (c4's post), so the wing keeps
  // its height over the courtyard (a wing carrying walkways would measure its height from the ground: grid.blockBase)
  { id: 'sl_deck', type: 'watchtower', variant: 'roof_platform', label: 'Searchlight', ...box(28.6, 45.8, 31.4, 48.2), rot: 0, h: Y.ROOF, deckY: Y.ROOF, level: 'B', nav: true },
  palWing(PALAZZO.w, 12, { jail: true }),
  palWing(PALAZZO.s, 12),
  // the courtyard's east wall on the lane, the arched gate in it (z 56–60)
  { id: 'pal_ewall_n', type: 'house', variant: 'palazzo_screen', ...box(35.4, 50, 36.4, 56), rot: 0, h: 4.6, mat: 'plaster', level: 'B', nav: true },
  { id: 'pal_ewall_s', type: 'house', variant: 'palazzo_screen', ...box(35.4, 60, 36.4, 66), rot: 0, h: 4.6, mat: 'plaster', level: 'B', nav: true },
  // the rear carriage gate at the androne's north mouth (shut; the van's script swings it open)
  { id: 'pal_gate_n', type: 'house', variant: 'palazzo_rear_gate', ...box(22, 43.6, 26, 44.4), rot: 0, h: 5, mat: 'plaster', level: 'B', nav: true },
  block('blk_uw', 0, 44, 10, 72, 13, 'B'),
  block('blk_usw', 0, 72, 36, 92, 12, 'B'),
  block('blk_u2', 0, 24.5, 21, 44, 12, 'B'),
  block('blk_u2b', 27, 24.5, 40, 44, 12, 'B'),
  block('blk_u2c', 36, 44, 40, 50, 12, 'B'),
  block('blk_u1', 43.5, 24.5, 80, 54, 11, 'B'),
  block('blk_u5', 86, 24.5, 100, 92, 13, 'B'),
  // the church: nave and transepts under a majolica dome, the facade W onto the piazza, steps at its foot
  { id: 'church', type: 'house', variant: 'church_baroque_med', label: 'Church', ...box(66, 62, 80, 84), rot: 0, h: 14, mat: 'plaster', level: 'B', nav: true, chimney: false },
];
/** The bell tower NW of the church: its belfry (y 16) is the Sniper's perch; iron rungs up its east face, where the
 *  tower's own body stands between the climber and the roof searchlight (c4 looks from the west-north-west). */
export const BELL = { id: 'bell_tower', type: 'watchtower', variant: 'campanile_tufa', label: 'Bell tower', ...box(64, 57, 68, 61), rot: 0, h: Y.BELL, deckY: Y.BELL, level: 'B' };
export const BELL_LADDER = { id: 'L_bell', x: 68.25, z: 59, y: Y.B, top: [67.1, 59, Y.BELL], raised: false, heading: deg(180), face: 'E' };
export const SNIPER_PERCH = { x: 66.2, z: 58.2, y: Y.BELL };

/** Level C (y 8): the blocks north of Via Alta, the cistern lane, the aqueduct stair-head (the exit). */
export const CISTERN = { id: 'cistern', type: 'ruins', variant: 'aqueduct_stairhead', label: 'Aqueduct cistern', ...box(9.5, 0, 15.5, 4), rot: 0, h: 5, level: 'C' };
export const BLOCKS_C = [
  block('blk_u3w', 0, 0, 9.5, 16, 12, 'C'),
  block('blk_u3e', 15.5, 0, 43.5, 16, 12, 'C'),
  block('blk_u4', 43.5, 0, 78, 16, 11, 'C'),
  { ...CISTERN, nav: true },
];
export const EXIT = { x: 12.5, z: 6.6, r: 2.6 };

// ---------------------------------------------------------------- levels (cliff + walkways), ramps, parapets
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** The B band: everything from the C edge (z 24.5) to the retaining wall (z 92), less the Scalinata's notch. */
export const LB = [[0, 24.5], [100, 24.5], [100, 92], [54, 92], [54, 88.2], [46, 88.2], [46, 92], [0, 92]];
export const LC = rect(0, 0, 100, 24.5);
const holesOf = (list) => list.map((s) => ({ poly: rect(s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2) }));
/** Props standing on a raised level: a raised cell carries no block (map-builder applyElevation), so a full blocker
 *  (the motor pool's lorries and tent) is a hole in its level, and low cover (the fountain's basin, the generator, the
 *  kennel) is a `bump`: cells raised to its top, which hide by height a man lying behind them, as low cover does. */
const onLevel = (lv, pred) => E02_PROPS.filter((s) => s.level === lv && pred(s));
const HOLES_B = holesOf([...BLOCKS_B, BELL, ...onLevel('B', (s) => s.block === 2)]);
const HOLES_C = holesOf([...BLOCKS_C, ...onLevel('C', (s) => s.block === 2)]);
const circle = (x, z, r, n = 16) => Array.from({ length: n }, (_, k) => [x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r]);
const bumpPoly = (s) => (s.r != null ? circle(s.x, s.z, s.r) : rect(s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2));
const bump = (s, y) => ({ id: `${s.id}_bump`, type: 'cliff', variant: 'prop_bump', mat: 'stone', points: bumpPoly(s), h: y + s.h, block: 0,
  walkways: plateauWalkways(bumpPoly(s), [], y + s.h) });
export const BUMPS = [...onLevel('B', (s) => s.block === 1).map((s) => bump(s, Y.B)), ...onLevel('C', (s) => s.block === 1).map((s) => bump(s, Y.C))];
const level = (id, variant, points, y, holes) => ({ id, type: 'cliff', variant, mat: 'stone', points, h: y, block: 2, level: id === 'lvl_b' ? 'B' : 'C',
  walkways: plateauWalkways(points, holes, y) });
/** A parapet strip (one raised cell, `ph` above its level): it hides what lies behind the edge from below. */
const PARAPET_H = 1.1;
const parapet = (id, points, y) => ({ id, type: 'cliff', variant: 'tufa_balustrade', mat: 'stone', points, h: y + PARAPET_H, block: 0,
  walkways: plateauWalkways(points, [], y + PARAPET_H) });
export const LEVELS = [
  level('lvl_b', 'tufa_retaining', LB, Y.B, HOLES_B),
  level('lvl_c', 'tufa_retaining', LC, Y.C, HOLES_C),
  // the piazza's balustrade over the lower quarter (either side of the Scalinata) and the church strip's
  parapet('bal_w', rect(36, 91.5, 46, 92), Y.B),
  parapet('bal_e', rect(54, 91.5, 86, 92), Y.B),
  ...BUMPS,
];
/** Stepped lanes and the vehicle ramp: cells that climb from their foot to their head (map-builder raiseRamp). */
export const SCALINATA = { points: [[50, 93.2], [50, 88.2]], width: 8, y0: Y.A, y1: Y.B };
export const SALITA_W = { points: [[41.75, 54], [41.75, 24.6]], width: 3.5, y0: Y.B, y1: Y.C, floor: Y.B };
export const SALITA_E = { points: [[83, 54], [83, 24.6]], width: 6, y0: Y.B, y1: Y.C, floor: Y.B };
export const RAMP_N = { points: [[24, 43.6], [24, 24.6]], width: 6, y0: Y.B, y1: Y.C, smooth: true };
const RAMPS = [
  { id: 'scalinata', type: 'road', variant: 'scalinata_tufa', ...box(46, 88.2, 54, 93.2), rot: 0, h: 0.2, block: 0, level: 'A', ramps: [{ id: 'scal', ...SCALINATA }] },
  { id: 'salita_w', type: 'road', variant: 'salita_steps', ...box(40, 24.6, 43.5, 54), rot: 0, h: 0.2, block: 0, level: 'B', ramps: [{ id: 'sal_w', ...SALITA_W }] },
  { id: 'salita_e', type: 'road', variant: 'salita_steps', ...box(80, 24.6, 86, 54), rot: 0, h: 0.2, block: 0, level: 'B', ramps: [{ id: 'sal_e', ...SALITA_E }] },
  { id: 'ramp_n', type: 'road', variant: 'ramp_setts', ...box(21, 24.6, 27, 43.6), rot: 0, h: 0.2, block: 0, level: 'B', ramps: [{ id: 'ramp', ...RAMP_N }] },
];

// ---------------------------------------------------------------- Via Marina: barricade, roadblock, port wall
export const TRAM = { id: 'tram_wreck', type: 'crates', variant: 'tram_burning', label: 'Burning tram', ...box(13.8, 122.5, 16.2, 135), rot: 0, h: 3.4, block: 2, level: 'A' };
const VIA_MARINA = [
  TRAM,
  { id: 'barr_crates_n', type: 'crates', variant: 'barricade_junk', label: 'Barricade', ...box(16.2, 121.2, 18.4, 122.6), rot: 0, h: 1.4, block: 1, level: 'A' },
  { id: 'barr_crates_s', type: 'crates', variant: 'barricade_junk', label: 'Barricade', ...box(13.6, 135, 18, 137), rot: 0, h: 1.6, block: 2, level: 'A' },
  { id: 'rb_bags', type: 'sandbags', variant: 'roadblock_sandbag_arc', label: 'Roadblock', x: 90, z: 128, rot: deg(180), w: 3.4, d: 7.5, h: 1.2, block: 1, level: 'A' },
  { id: 'port_wall', type: 'wall', variant: 'sea_wall_tufa', points: [[0, 138.6], [100, 138.6]], width: 2.8, h: 3.2, mat: 'stone', level: 'A' },
];

// ---------------------------------------------------------------- the motor pool on Via Alta (level C)
const MOTOR_POOL = [
  { id: 'mp_fence_w', type: 'fence', variant: 'chainlink', points: [[78.3, 16.2], [78.3, 0]], h: 2.4, width: 0.2, level: 'C' },
  { id: 'mp_fence_s1', type: 'fence', variant: 'chainlink', points: [[78.3, 16.2], [81.6, 16.2]], h: 2.4, width: 0.2, level: 'C' },
  { id: 'mp_fence_s2', type: 'fence', variant: 'chainlink', points: [[86.4, 16.2], [100, 16.2]], h: 2.4, width: 0.2, level: 'C' },
];

/** Structures in stamp order: levels first (a later raise wins), then the ramps, then what stands on the levels. */
const STRUCTURES_RAW = [
  ...LEVELS, ...RAMPS,
  ...BLOCKS_A, LOW_HOUSE, LOW_LANDING, ...COURT_WALLS,
  ...BLOCKS_B, BELL,
  ...BLOCKS_C,
  ...VIA_MARINA, ...MOTOR_POOL,
  ...E02_PROPS,
];
/**
 * What art/e02-art.js draws itself (E02_VARIANTS) is drawn exactly on its gameplay box, its catalogue placeholder
 * hidden: `clip: false` keeps the map builder from measuring that hidden placeholder (the procedural house's porch and
 * door steps stamped walk blocks into the alleys and closed the low house's stair foot; map-builder stampVisualNav).
 */
const drawnHere = (s) => (E02_VARIANTS[s.type]?.includes(s.variant) ? { ...s, clip: false } : s);
/** Touching boxes are one terrace of houses (party walls): placement rule (c) joins (schema.joinStructures). */
function touchingPairs(list) {
  const boxes = list.filter((s) => s.w != null && s.d != null && /^(house|flat_roof_house|ruins|watchtower)$/.test(s.type));
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2, gz = Math.abs(a.z - b.z) - (a.d + b.d) / 2;
    if (gx < 2.5 && gz < 2.5) out.push([a.id, b.id]);
  }
  return out;
}
export const STRUCTURES = joinStructures(STRUCTURES_RAW.map(drawnHere), touchingPairs(STRUCTURES_RAW));

// ---------------------------------------------------------------- the team (design §5)
export const START = { spy: [8, 123.5], greenberet: [10, 128], sniper: [6, 130.5], tonino: [11.6, 124.6] };
const COMMANDOS = [
  { role: 'spy', x: START.spy[0], z: START.spy[1], heading: deg(270), inventory: {} },
  { role: 'greenberet', x: START.greenberet[0], z: START.greenberet[1], heading: deg(0), inventory: { shovel: 1 } },
  { role: 'sniper', x: START.sniper[0], z: START.sniper[1], heading: deg(0), inventory: { sniperRifle: 4 } },
  { role: 'tonino', x: START.tonino[0], z: START.tonino[1], heading: deg(0), inventory: { cigarettes: 5 } },
  // Captain Hollis, our liaison officer, locked in the palazzo cellar; freed, he follows the team (MECHANICS escort)
  { role: 'guest', id: 'hollis', guestId: 'hollis', name: 'Captain Hollis', nickname: 'Hollis', x: 13, z: 62, heading: deg(0),
    jailed: true, jailId: 'pal_w', follow: 'team', inventory: {} },
];

// ---------------------------------------------------------------- enemies (design §7; base = Easy, `only: 'hard'` the extras)
const post = (id, type, x, z, h, sweep, extra = {}) => ({ id, soldierType: type, x, z, heading: deg(h), post: { heading: deg(h), sweep, ...(extra.period ? { period: extra.period } : {}) }, ...extra });
const walker = (id, type, points, extra = {}) => ({ id, soldierType: type, x: points[0].x, z: points[0].z, heading: 0, route: { type: 'PINGPONG', vel: 1.15, points }, ...extra });
const at = (y) => (y ? { y } : {});
const ENEMIES = [
  // --- Via Marina (z_port)
  { id: 'a1', soldierType: 'mg', x: 90.8, z: 128, heading: deg(180), emplacement: 'mg_rb', post: { heading: deg(180), sweep: 50, giro: 180 } },
  post('a2', 'sentry', 87.4, 124, 180, 30),
  post('a3', 'sentry', 87.4, 132.2, 180, 30),
  walker('a4', 'soldier', [P(25.5, 124, 6, 270), P(80, 124, 6, 90)]),
  // --- the lower quarter (z_quarter)
  walker('l1', 'soldier', [P(50.25, 116, 5, 90), P(50.25, 99.5, 5, 270)]),
  post('l2', 'sentry', 47.2, 93.6, 90, 50),
  post('l3', 'sentry', 25.6, 105.5, 0, 40),
  post('l4', 'sentry', 75.5, 105.5, 180, 40, { only: 'hard' }),
  // the dog pair walks the cross-alley's west part, from its far end to the low house (at its east end it turns to look
  // back west, the low house between it and the court): Vico 2's crossing is l3's and [H] l4's
  walker('l5', 'soldier', [P(36, 105.5, 8, 180), P(6, 105.5, 8, 0)], { route: { type: 'PINGPONG', vel: 0.95, points: [P(36, 105.5, 8, 180), P(6, 105.5, 8, 0)] } }),
  { id: 'dog1', soldierType: 'dog', x: 37.5, z: 105.5, heading: deg(180), handler: 'l5', flags: { investigates: true } },
  // --- the piazza and the church (level B)
  // the gate's two posts stare out east across the square's north half (the fountain, the church front, the belfry, the
  // foot of Salita W); the south half, below the fountain, is p3's and p5's
  post('p1', 'sergeant', 38.2, 55.6, 0, 0, at(Y.B)),
  post('p2', 'sentry', 38.2, 60.6, 0, 0, at(Y.B)),
  { id: 'p3', soldierType: 'soldier', x: 44, z: 70, heading: 0, ...at(Y.B),
    route: { type: 'LOOP', vel: 1.15, points: [P(44, 70, 4, 270), P(58, 70, 4, 0), P(58, 86, 4, 0), P(44, 86, 4, 180)] } },
  post('p4', 'sentry', 64.5, 86.5, 225, 0, { ...at(Y.B), only: 'hard' }), // (below the church's south-west corner, looking up the square)
  // the sergeant of the piazza: on the balustrade beside the head of the Scalinata, looking up into the square (the
  // hanger's sergeant: his tunic passes the gate)
  post('p5', 'sergeant', 55.2, 87.0, 270, 0, at(Y.B)),
  // (p6 [H] stands in the motor pool by the lorries, looking west down Via Alta)
  post('p6', 'soldier', 90, 18, 180, 40, { ...at(Y.C), only: 'hard' }),
  // --- the palazzo courtyard (z_palazzo, level B)
  post('c1', 'sentry', 28, 60, 180, 30, at(Y.B)),
  post('c2', 'sentry', 18.4, 61, 0, 40, at(Y.B)),
  walker('c3', 'lieutenant', [P(24, 64.4, 20, 270), P(20, 51.2, 25, 270)], { ...at(Y.B), route: { type: 'PINGPONG', vel: 1.0, points: [P(24, 64.4, 20, 270), P(20, 51.2, 25, 270)] } }),
  { id: 'vdrv', soldierType: 'truckDriver', x: 22.2, z: 58.6, heading: deg(0), ...at(Y.B), post: { heading: deg(0), sweep: 0 }, flags: { holdsPost: true, investigates: false } },
  // (the searchlight sweeps the courtyard's south side, the square's south-west quarter and the lower town's west roofs;
  // the gate and Salita W are behind its arc)
  post('c4', 'soldier', PAL_ROOF.x, PAL_ROOF.z, 100, 40, { y: Y.ROOF, elevated: true, period: 9, vision: { fov: 20, near: 22, far: 45, elliptical: false },
    flags: { holdsPost: true, investigates: false } }),
  // (c5 [H] stands in the carriage way behind the van, looking up to the rear gate and the ramp)
  post('c5', 'soldier', 23.0, 46.6, 270, 30, { ...at(Y.B), only: 'hard' }),
  // --- Via Alta and the motor pool (level C)
  walker('u1', 'soldier', [P(20, 20, 6, 270), P(70, 20, 6, 90)], at(Y.C)),
  post('u2', 'sentry', 12.5, 15.2, 90, 40, at(Y.C)),
  post('u3', 'sentry', 84, 21.4, 180, 40, at(Y.C)),
  post('u4', 'sentry', 94, 8, 180, 60, { ...at(Y.C), only: 'hard' }),
  { id: 'dog2', soldierType: 'dog', x: 96, z: 12.6, heading: deg(180), ...at(Y.C), post: { heading: deg(180), sweep: 120 }, only: 'hard' },
  post('u5', 'sentry', 83, 26.4, 90, 40, { ...at(Y.C), only: 'hard' }),
  // --- the second DF van cruising Via Marina [H] (its crew folds into the vehicle: schema.foldVehicleCrews)
  { id: 'van2d', soldierType: 'truckDriver', x: 92, z: 132, heading: deg(180), vehicle: 'van2', only: 'hard' },
  { id: 'van2s', soldierType: 'soldier', x: 92, z: 132, heading: deg(180), vehicle: 'van2', post: { heading: 0, sweep: 30 }, only: 'hard' },
  // --- the insurgents behind the barricade: ambient, unarmed, no eyes
  { id: 'ins1', soldierType: 'pow', x: 3.2, z: 121.4, heading: deg(20) },
  { id: 'ins2', soldierType: 'pow', x: 4.6, z: 133.8, heading: deg(330) },
  { id: 'ins3', soldierType: 'pow', x: 2.4, z: 127.6, heading: deg(0) },
];

const VEHICLES = [
  { id: 'mg_rb', vehicleType: 'mgNest', x: 90.8, z: 128, heading: deg(180), gunner: 'a1', driveable: false },
  // the DF van in the courtyard, nose to the androne; its loop aerial on the roof (art)
  { id: 'van_df', vehicleType: 'van', variant: 'van_civilian_grey', label: 'DF van', x: 24, z: 60, heading: deg(270), driveable: false },
  { id: 'van2', vehicleType: 'van', variant: 'van_civilian_grey', label: 'DF van', x: 92, z: 132, heading: deg(180), driveable: false, only: 'hard',
    route: { type: 'PINGPONG', speed: 5, points: [P(92, 132, 4), P(28, 132, 10)] } },
];

const INTERACTABLES = [
  // the cellar door (Hollis); the washing on the low house's terrace (a private's tunic)
  { kind: 'jail', id: 'cellar', x: 16.6, z: 62, jailId: 'pal_w' },
  { id: 'uniform_line', interactKind: 'clothesline', x: 40.4, z: 111.6, uniform: 'soldier', visualY: Y.TERRACE, visualRot: 0 },
];

// ---------------------------------------------------------------- alarm zones and the palazzo garrison (design §8)
export const Z_PALAZZO = rect(10, 44, 36.5, 72);
export const Z_PORT = rect(0, 118, 100, 140);
export const Z_ALL = rect(0, 0, 100, 140);
const BARRACKS = {
  pal_nw: { pool: 6, squads: [
    { event: 'RHQ', size: 3, exitVel: 2.6, exitRoute: [P(20, 51.5), P(30, 57), P(38.5, 58)], loopVel: 1.6, loop: [P(44, 70), P(58, 70), P(58, 86), P(44, 86)] },
    { event: 'RQ', size: 2, exitVel: 2.6, exitRoute: [P(20, 51.5), P(30, 57), P(38.5, 58), P(50, 86)], loopVel: 1.6, loop: [P(50.25, 96), P(50.25, 116), P(26, 105.5)] },
  ] },
};

export const LOG_AT = { x: 24, z: 63.6 }; // the bearings log on the van's tailboard (scripts/e02.js device)
export const GEN_LEVER = { x: 18.2, z: 51.4 }; // the generator's lever (cosmetic: the gate floodlights go out)

const def = {
  id: 'e02', campaign: 'BCD', number: 2,
  title: 'Curfew', subtitle: 'Quartiere Scirocco, Naples · 29 September 1943',
  place: 'Quartiere Scirocco, Naples, Italy', date: '1943-09-29',
  pin: { lat: 40.84, lon: 14.25 },
  context: 'A direction-finding team of Referat N has moved into a palazzo above the port and is hunting the insurgents\' transmitter by night. Last night it also took our liaison officer.',
  theater: 'temperate',
  coneColors: 'green',
  size: [100, 140],
  seed: 2909,
  briefing: {
    historical: 'September 1943. Naples has risen against its garrison before our armies arrive. The Germans are rounding up men for labour in the north and wrecking the port behind them, and the city fights back street by street, with rifles, stones and barricades.',
    text: 'You go in at night with a guide, a boy called Tonino. His father died in the summer raids. He knows every stair of the quarter, and the soldiers buy their cigarettes from him. Trust him. A direction-finding team has set up in the Palazzo Scirocco. It keeps its bearings on the insurgents\' transmitter in a log aboard its van in the courtyard. Bring that log out and the transmitter stays hidden.\n\n'
      + 'A searchlight on the palazzo roof sweeps the piazza every night: put it out. Captain Hollis is in the palazzo cellar. Then everyone, Hollis and the boy included, goes down into the old aqueduct cistern on Via Alta. If the palazzo sounds its alarm, the van leaves with the log. A van needs its driver, and he sleeps in the cab. Your Spy will need better clothes than he has. Start with the washing lines.',
    objectivesSummary: 'Take the bearings log from the van. Put the roof searchlight out. Free Captain Hollis. Then everyone into the aqueduct cistern on Via Alta.',
    hints: [
      'Tonino cannot climb, but he can put a stone through a window at twelve paces and a packet of cigarettes at a soldier\'s feet.',
      'A soldier who sees a packet land near him walks over, kneels and pockets it. While he kneels he sees nothing.',
      'A private\'s tunic fools privates. Sergeants know their own men; officers know everyone. The hanger takes a better uniform off a better man.',
      'The dog in the cross-alley does not care what the Spy is wearing.',
      'If the palazzo sounds its alarm, the van leaves with the log. A van needs a driver.',
    ],
  },
  baseTerrain: 'road',
  terrain: [
    { type: 'rect', terrain: 'ground', x: 78, z: 0, w: 22, d: 16 }, // the motor pool's yard
    { type: 'rect', terrain: 'ground', x: 16, z: 50, w: 6, d: 6 }, // round the generator
  ],
  // Via Marina's tram line (the tram lies across it) and the lower quarter's basalt paving, past the map edges
  // (the tram line runs down the avenue's middle; its rails are torn up at the barricade, where the tram burns, and at
  // the roadblock: nothing stands on the track that is left)
  roads: [
    { id: 'via_marina_w', surface: 'setts', points: [[-30, 128.6], [20.5, 128.6]], width: 6.6, wear: 0.75 },
    { id: 'via_marina', surface: 'setts', points: [[20.5, 128.6], [84, 128.6]], width: 6.6, rails: { tracks: 1 }, wear: 0.6 },
    { id: 'via_marina_e', surface: 'setts', points: [[84, 128.6], [130, 128.6]], width: 6.6, wear: 0.7 },
  ],
  pavements: [{ id: 'basoli_a', surface: 'setts', grid: false, edge: 'hard', wear: 0.55, weeds: 0.04, puddles: 0.18, patches: 0, cracks: 0.25,
    points: [[-30, 91.8], [130, 91.8], [130, 137.3], [-30, 137.3]] }],
  furniture: E02_FURNITURE,
  structures: STRUCTURES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  vehicles: VEHICLES,
  interactables: INTERACTABLES,
  items: [],
  ladders: [BELL_LADDER],
  climbLinks: [],
  zones: [
    { id: 'z_palazzo', poly: Z_PALAZZO, onSeen: 'RHQ', onHeard: 'RHQ' },
    { id: 'z_port', poly: Z_PORT, onSeen: 'RPORT', onHeard: 'RPORT' },
    { id: 'z_quarter', poly: Z_ALL, onSeen: 'RQ', onHeard: 'RQ' },
  ],
  barracks: BARRACKS,
  jails: ['pal_w'],
  objectives: [
    { id: 'o1', text: 'Take the direction-finders\' bearings log from the van', type: 'script', required: true },
    { id: 'o2', text: 'Put the palazzo searchlight out', type: 'script', required: true },
    { id: 'o3', text: 'Free Captain Hollis from the palazzo cellar', type: 'script', required: true },
    { id: 'o4', text: 'Everyone, Hollis and Tonino too, into the aqueduct cistern on Via Alta', type: 'escape', required: true, zone: EXIT },
  ],
  extraction: { zone: EXIT },
  triggers: [
    { on: 'unit:freed', match: { unit: 'hollis' }, once: true, do: [
      { objective: 'o3', set: 'done' },
      { message: 'Hollis: "Good to see you. Lead on, I\'ll keep my head down."', kind: 'objective' },
    ] },
    { on: 'unit:killed', match: { unit: 'hollis' }, once: true, do: [{ fail: 'CAPTAIN HOLLIS IS DEAD.' }] },
    { on: 'unit:killed', match: { unit: 'tonino' }, once: true, do: [{ fail: 'THE BOY IS DEAD.' }] },
    // the quarter's and the palazzo's alarms sound the siren (the custom events release the garrison's squads)
    { on: 'alarm:zone', match: { event: ['RQ', 'RHQ'] }, once: false, do: [{ event: 'RINT' }] },
  ],
  // the tram burns all night (VFX burning_wreck on its top; the tram's own box blocks, so no sim fire is needed)
  fx: [{ kind: 'burning_wreck', x: TRAM.x, z: TRAM.z + 0.6, size: [1.8, 8.5], h: 3.1, fuel: 'oil' }],
  script: e02Script,
  rules: { roofRule: false }, // the levels are open streets, not roofs (as M8 / M20)
  vanPath: VAN_PATH,
  vanStart: 8,
  // (a full moon over the bay: a cold key from the north-west strong enough to read the town by, a blue sky fill)
  lighting: { hdri: 'night', lut: 'night', kelvin: 9000, sunElevDeg: 42, sunAzimuthDeg: 315, exposure: 1.9, sunIntensity: 0.7, sunColor: 0xb8c4ff,
    hemiSky: 0x3a4a6c, hemiGround: 0x141414, hemiIntensity: 0.6, envIntensity: 0.7 },
  ambient: { fish: false, birds: false },
  cameraStart: { x: 16, z: 122 },
  par: { time: 720 },
  variants: {
    easy: {
      par: { time: 800 }, routeSpeedMul: 0.8, pauseMul: 2.5, vanStart: 20,
      enemyPatch: { c2: { post: { heading: deg(0), sweep: 20 } } },
    },
    hard: {
      par: { time: 720 },
      enemyPatch: {
        c3: { route: { type: 'PINGPONG', vel: 1.0, points: [P(24, 64.4, 12, 270), P(20, 51.2, 25, 270)] } },
        u2: { post: { heading: deg(90), sweep: 60 } },
      },
    },
  },
  artVariants: E02_VARIANTS,
};

registerExpansionMission(def);
export default def;
