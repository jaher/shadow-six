/**
 * LIGHTS OUT mission 5: Cold Iron (docs/expansion/e05.md). Hammerø, a granite islet off the north tip of Bornholm
 * (a fictional islet off a real island), 14 October 1944, 17:30, an autumn gale at dusk. Referat N's Baltic intercept
 * and direction-finding station fills an old star fort: a signal mast on the NE bastion, receivers in a brick casemate
 * against the east rampart whose iron door opens only to the garrison, the station's card index in the commandant's
 * study, and the Gestapo's regional office in the old powder magazine, where Grethe Holm is being questioned. The fort's
 * company lives in a hut camp on the east glacis and walks in and out over the drawbridge, which is down.
 *
 * Spy, Green Beret and Marine land in the SW cove. In by the ammunition hoist from the harbour magazine; a cuffed yard
 * walker on puppet strings opens the casemate; the adjutant's tunic (hanger) makes the Spy an officer; the Gestapo at the
 * office door are taken from their blind side and the Kriminalrat is bound at his desk, which disarms the burn script;
 * Grethe joins when a commando reaches her; her small talk holds the guardroom sentry; the bridge keeper on strings raises
 * the drawbridge against the garrison on the glacis; then back down the hoist and along the shore to the folboats.
 *
 * Conventions (as the base missions): metres from the NW corner, +x east, +z south; `heading` / `rot` in radians via
 * deg(); route `look` and `post.sweep` in degrees (0 = E, 90 = S, 180 = W, 270 = N).
 *
 * Deviations from the design doc (docs/expansion/e05.md §16 keeps the list):
 *  - the yard and the glacis share the ground level (y 0): the engine's drawbridge deck is a ground-level span; the
 *    ramparts are 6 m walks over a wet moat (as the design), the moat's water lies below the banks only in the art;
 *  - rooms the design walks into (the Gestapo office, the commandant's study, the radio casemate, the keeper's switch
 *    room, the hoist house, the harbour magazine) are walls with doorways (invisible gameplay walls, drawn by
 *    scripts/e05-art.js) whose roofs lift off while a commando is inside: the engine's buildings are otherwise solid.
 *    Their gameplay walls stand to the roof ridge (8.5 m) so a rampart walker's eye (7.65 m) never looks into them;
 *  - the hoist's top stands in a brick hoist house against the south rampart (a casemate cut into the rampart would be
 *    a pit the wall walk looks into); the keeper's switch room is a brick room against the gatehouse's inner face;
 *  - `yg` watches the parade from the east rampart, not from the casemate roof (a roof post looks down into its room);
 *  - positions are tuned to the engine's cones (the design's are design values); the camp sits east of the ring road
 *    inside the 110 m map.
 */
import { registerExpansionMission } from './registry.js';
import { joinStructures } from '../schema.js';
import { plateauWalkways } from '../scripts/m05.js';
import { e05Script } from '../scripts/e05.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)

/** Levels (design §1): the sea, the yard and the glacis at 0, the wall walk at 6. */
export const Y = { WALK: 6 };
/** Height of the rooms' gameplay walls: to the roof ridge (a roof hides its room from the wall walk). */
export const ROOM_H = 8.5;

// ---------------------------------------------------------------- the fort (design §3, §4)
/** The yard (inside the ramparts). */
export const YARD = { x0: 36, z0: 50, x1: 76, z1: 90 };
/** The rampart ring's outer edge (the walk is the 6 m band between it and the yard). */
export const RAMP = { x0: 30, z0: 44, x1: 82, z1: 96 };
/** The gate passage through the south rampart (ground level) and the drawbridge over the south moat. */
export const GATE = { x0: 53.75, x1: 58.25, z0: 90, z1: 96 };
export const BRIDGE = { x: 56, z: 99, w: 6.6, d: 4.6, rot: deg(90) }; // w along rot: z 95.7–102.3; x 53.7–58.3
/** Round bastions on the rampart's corners (r 5): NW, NE, SE, SW. */
export const BASTIONS = [['b_nw', 32, 46], ['b_ne', 80, 46], ['b_se', 80, 94], ['b_sw', 32, 94]];
const BASTION_R = 5;
const circle = (x, z, r, n = 16) => Array.from({ length: n }, (_, k) => [+(x + r * Math.cos((k / n) * Math.PI * 2)).toFixed(2), +(z + r * Math.sin((k / n) * Math.PI * 2)).toFixed(2)]);
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** The four bands of the rampart (the S band split at the gate passage). */
export const BANDS = {
  ramp_n: rect(RAMP.x0, RAMP.z0, RAMP.x1, YARD.z0),
  ramp_w: rect(RAMP.x0, YARD.z0, YARD.x0, YARD.z1),
  ramp_e: rect(YARD.x1, YARD.z0, RAMP.x1, YARD.z1),
  ramp_sw: rect(RAMP.x0, YARD.z1, GATE.x0, RAMP.z1),
  ramp_se: rect(GATE.x1, YARD.z1, RAMP.x1, RAMP.z1),
};
const level = (id, variant, points, y = Y.WALK, holes = []) => ({ id, type: 'cliff', variant, mat: 'stone', points, h: y, block: 2,
  walkways: plateauWalkways(points, holes, y) });

/** Room = four gameplay walls (invisible: drawn by scripts/e05-art.js) with doorway gaps. */
const WALL_T = 0.5;
/**
 * The wall runs of a room whose outer footprint is x0..x1 × z0..z1, cut at its doorways: one structure per run (the
 * first carries the `room` record the art builds the house from: footprint and every doorway).
 * @param {string} id
 * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1  outer footprint
 * @param {Array<[('N'|'S'|'E'|'W'), number, number?]>} doors [side, centre along that side (x for N/S, z for E/W), width]
 * @returns {object[]}
 */
export function roomRuns(id, x0, z0, x1, z1, doors) {
  const h = WALL_T / 2, X0 = x0 + h, X1 = x1 - h, Z0 = z0 + h, Z1 = z1 - h; // wall centrelines
  // the loop clockwise from the NW corner: N (x up), E (z up), S (x down), W (z down); arc length s along it
  const lenN = X1 - X0, lenE = Z1 - Z0, P = 2 * (lenN + lenE);
  const at = (q) => { // the loop point at arc length q
    q = ((q % P) + P) % P;
    if (q <= lenN) return [X0 + q, Z0];
    if (q <= lenN + lenE) return [X1, Z0 + (q - lenN)];
    if (q <= 2 * lenN + lenE) return [X1 - (q - lenN - lenE), Z1];
    return [X0, Z1 - (q - 2 * lenN - lenE)];
  };
  const sOf = (side, u) => (side === 'N' ? u - X0 : side === 'E' ? lenN + (u - Z0) : side === 'S' ? lenN + lenE + (X1 - u) : 2 * lenN + lenE + (Z1 - u));
  const gaps = doors.map(([side, u, gap = 1.6]) => { const c = sOf(side, u); return [c - gap / 2, c + gap / 2]; }).sort((a, b) => a[0] - b[0]);
  const corners = [lenN, lenN + lenE, 2 * lenN + lenE, P];
  const runs = gaps.map(([, e], k) => {
    let s0 = e, s1 = gaps[(k + 1) % gaps.length][0];
    if (s1 <= s0) s1 += P;
    const pts = [at(s0)];
    for (const c of [...corners, ...corners.map((v) => v + P)]) if (c > s0 && c < s1) pts.push(at(c));
    pts.push(at(s1));
    return pts.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]);
  });
  const first = doors[0];
  const room = { x0, z0, x1, z1, side: first[0], at: first[1], gap: first[2] ?? 1.6, doors: doors.map(([side, u, gap = 1.6]) => ({ side, at: u, gap })) };
  return runs.map((points, k) => ({ id: k ? `${id}_${k}` : id, type: 'wall', variant: 'room_wall', points, width: WALL_T, h: ROOM_H, mat: 'brick', visual: false, ...(k ? {} : { room }) }));
}
/** A one-door room (its single wall run): roomRuns with one doorway. */
export function room(id, x0, z0, x1, z1, side, u, gap = 1.6) { return roomRuns(id, x0, z0, x1, z1, [[side, u, gap]])[0]; }

/** The yard's buildings (design §4.2). Rooms have interiors; the others are solid blocks drawn by the art pass. */
export const ROOMS = {
  house_cmd: room('house_cmd', 40, 53, 54, 64, 'S', 47), // the commandant's house: the study is its west half
  office_g: room('office_g', 39.5, 75, 47.5, 83, 'E', 79), // the old powder magazine: the Gestapo office
  radio_cas: room('radio_cas', 66, 61, 76, 81, 'S', 69, 1.8), // the radio casemate; the iron door fills its doorway
  keeper: room('keeper', 58.5, 86, 62.5, 90, 'E', 88.0, 1.4), // the bridge keeper's switch room, against the gatehouse; its door
  // opens on the alley between it and the hoist house (the gate's men never see it)
  // (the hoist house: two runs, ROOM_EXTRA below)
  magazine: room('magazine', 80, 124.5, 88, 130.5, 'S', 84, 1.8), // the harbour magazine: the hoist's bottom stop
};
/**
 * The hoist house (the hoist's top stop inside): two plank doors — east on the sheltered pocket between the radio
 * casemate, the hoist house and the SE stair, west on the alley to the bridge keeper's switch room.
 */
// (both 1.8 m: the west door was 1.6, and its gate posts — body solids men keep their whole body off — left a 1.2 m way
// a planner's body-clearance tier could not find: a man ordered in from the alley stopped on the threshold)
export const HOIST_HOUSE = roomRuns('hoist_top', 64, 85.5, 70, 90, [['E', 88.0, 1.8], ['W', 88.0, 1.8]]);
/** The radio casemate's iron door: opens to the garrison and to a puppet only (`door: 'enemy'`). */
// (the doors stand to the room walls' height in the gameplay grid — the masonry over a doorway is a wall too: an eye on
// the rampart walk 7.65 m up looked over a 2.4 m leaf into the dark rooms; `leafH` is the leaf the art draws)
// (`inside`: a point on the garrison's side — the casemate's hall — from which the door opens to anyone: a commando shut
// in there is not trapped; from the yard only its own men and a puppet open it)
export const IRON_DOOR = { id: 'iron_door', type: 'gate', variant: 'iron_door_casemate', x: 69, z: 80.75, rot: 0, w: 1.8, h: ROOM_H, leafH: 2.6, d: 0.5, block: 2, door: 'enemy', inside: [69, 78], visual: false }; // (block 2: a solid leaf, not bars: shut, nobody sees in)
/** The hoist house's plank door (east side, on the pocket by the SE stair): shut, nobody sees into the dark house. */
export const HOIST_DOOR = { id: 'hoist_door', type: 'gate', variant: 'door_plank_e05', x: 69.75, z: 88.0, rot: deg(90), w: 1.8, h: ROOM_H, leafH: 2.4, d: 0.3, block: 2, visual: false };
export const HOIST_DOOR_W = { id: 'hoist_door_w', type: 'gate', variant: 'door_plank_e05', x: 64.25, z: 88.0, rot: deg(90), w: 1.8, h: ROOM_H, leafH: 2.4, d: 0.3, block: 2, visual: false };
/** Solid buildings (drawn by the art pass; their footprints block like any building). */
const SOLIDS = [
  { id: 'quarters', type: 'house', variant: 'officers_quarters_e05', label: "Officers' quarters", x: 62, z: 55.75, rot: 0, w: 12, d: 5.5, h: 7, mat: 'brick', visual: false },
  { id: 'guardroom', type: 'house', variant: 'guardroom_e05', label: 'Guardroom', x: 49, z: 87.5, rot: 0, w: 6, d: 5, h: 5, mat: 'brick', visual: false },
  // (the shelter stands on the NE bastion's walk, its corners within 4.3 m of the drum's centre — inside the breastwork,
  // clear of the mast — open to the west, where the Kriminalrat stands at its stove)
  { id: 'signal_hut', type: 'hut', variant: 'signal_shelter_e05', label: 'Signal station', x: 83.0, z: 46.0, rot: 0, w: 2.0, d: 2.0, h: 2.6, mat: 'planks', block: 0, baseY: Y.WALK, visual: false },
];

/** Interior pieces the art draws and the scripts read (desk positions, the hoist stops, the switch). */
export const SPOTS = {
  index: [42.2, 58.4], // the card index on the commandant's desk (study, west half of the house)
  callbook: [72.9, 71], // the call-sign book on the casemate's duty desk
  grethe: [41.3, 79], // Grethe's chair in the Gestapo office
  stove: [83.45, 46.15], // the signal station's stove, inside its shelter on the NE bastion (the burn script's end)
  hoistTop: [67, 88.2],
  hoistBottom: [84, 127.6],
  switch: [59.6, 89.45], // the bridge switch on the switch room's south wall (under the rampart, the bridge beyond)
};

// ---------------------------------------------------------------- terrain (design §4.1)
/**
 * The island (land); the sea is the base terrain. A granite islet's coast: headlands and bights all round (the map's
 * east edge leaves it ≤ 109 m, the camp's yard ≥ 107.6 between z 50 and 88), the harbour cut and the mole straight
 * (masonry), the south shore and the cove as the team's route needs them.
 */
export const ISLAND = [
  // north: the cliffs' coast, bights between low headlands
  [12, 20], [15, 14.5], [20, 11.5], [24, 8], [29, 7.2], [33, 8.4], [38, 6.2], [44, 5], [50, 6.6], [55, 5.4], [61, 6.8], [66, 5.2],
  [72, 6.4], [78, 4.8], [84, 6.2], [90, 5.6], [96, 6], [99, 9.5], [102.5, 12.4], [104, 16],
  // east: low rocky shore under the camp
  [105.6, 22], [106.9, 28.5], [108.3, 34], [107.8, 40], [108.9, 46.5], [108.3, 52], [108.9, 59], [108.4, 66], [108.9, 72.5],
  [109.0, 79], [108.4, 86], [108.8, 93], [109.0, 101], [108.0, 109], [108.9, 116], [107.9, 122], [108, 128],
  // the mole and the harbour cut (masonry), the south shore, the cove
  [108, 152], [103.4, 152], [103.4, 133], [82, 133], [82, 154], [72, 156], [56, 156], [36, 155], [26, 155], [14, 151], [11, 142], [13, 120],
  // west: the cliffs' coast
  [11.2, 114], [12.6, 107], [10.4, 100], [11.6, 93], [9.2, 86], [10.6, 79], [8.6, 72], [9.8, 65], [8, 60], [9.4, 53], [7.8, 46],
  [9.6, 39], [8.9, 32], [11.2, 26]];
/** The fort's glacis (design T5): the cropped sward round the moat, out to the ring road's far verge (rounded, ragged). */
export const GLACIS = [[20, 33], [27, 27.5], [38, 25.6], [50, 26.8], [62, 25.4], [74, 27], [85, 26.2], [93, 31], [97.2, 40], [96.4, 52],
  [97.8, 64], [96.6, 76], [97.6, 88], [94.2, 100], [88, 108.6], [76, 112.4], [62, 111.2], [50, 112.6], [38, 111.4], [27, 108.2],
  [19.6, 101], [15.4, 90], [16.6, 78], [14.6, 66], [15.8, 54], [14.8, 43]];
/** Sheltered hollows of greener sward out on the heath (south and east slopes). */
const SWARD = [
  [[33, 118], [41, 115.6], [49, 117.4], [52, 122.8], [46, 127.2], [36, 126.2], [31.4, 122]],
  [[60, 121.4], [66, 119.2], [70.6, 123.4], [66.8, 128.2], [59.6, 126.8]],
  [[99.6, 98.4], [104.2, 96.6], [106.6, 103.2], [103.8, 110.4], [99.4, 107.2]],
];
/** Shingle in the north bights (between the cliffs) and on the east shore south of the camp. */
const SHINGLE = [
  [[47.2, 6.4], [50, 6.9], [53.6, 6.0], [53.2, 8.2], [50, 8.9], [47.6, 8.1]],
  [[74.6, 5.9], [78, 5.2], [81.6, 5.9], [80.8, 7.8], [77.4, 8.4], [74.8, 7.6]],
  [[107.2, 90.4], [108.4, 92.6], [108.1, 97.4], [106.9, 95.8]],
];
/** The cove where the team lands (start and exit) and the folboats lie. */
export const COVE = { x: 20, z: 148, r: 6 };
const RING_ROAD = [[56, 108], [76, 105], [88, 96], [93, 82], [94, 70], [93, 58], [88, 44], [76, 35], [56, 32], [36, 35], [24, 44],
  [18, 56], [16, 70], [18, 84], [24, 96], [36, 105], [56, 108]];
const HARBOUR_ROAD = [[56, 108], [62, 114], [70, 120], [77, 125.5]];
const SHORE_PATH = [[22, 146], [34, 147], [48, 146.5], [62, 145], [72, 141], [77, 134]];
const MOAT = [rect(24, 38, 88, 44), rect(24, 96, 88, 102), rect(24, 44, 30, 96), rect(82, 44, 88, 96)];
const TERRAIN = [
  // the islet's heath (granite, heather, bracken: the `ground` mix of dirt, gravel and dry grass), the glacis's
  // cropped sward round the fort, greener hollows on the south and east slopes, shingle in the bights
  { type: 'poly', terrain: 'ground', points: ISLAND },
  { type: 'poly', terrain: 'grass', points: GLACIS },
  ...SWARD.map((points) => ({ type: 'poly', terrain: 'grass', points })),
  ...SHINGLE.map((points) => ({ type: 'poly', terrain: 'sand', points })),
  // granite and gravel: the yard, the camp's yard, the harbour quays
  { type: 'rect', terrain: 'ground', x: YARD.x0, z: YARD.z0, w: YARD.x1 - YARD.x0, d: YARD.z1 - YARD.z0 },
  { type: 'rect', terrain: 'ground', x: 96, z: 53, w: 11, d: 34 },
  { type: 'rect', terrain: 'ground', x: 76, z: 122, w: 31, d: 11 },
  { type: 'rect', terrain: 'ground', x: 76, z: 133, w: 6, d: 21 },
  { type: 'rect', terrain: 'ground', x: 103.4, z: 133, w: 4.6, d: 19 },
  // the cove's shingle beach, hugging the shore between the rocks
  { type: 'poly', terrain: 'sand', points: [[12.2, 143.5], [15.4, 143.2], [19.6, 144.2], [23.8, 145.6], [26.4, 148.4], [27.8, 151.6], [26.2, 154.4], [21.4, 153.9], [16.6, 152.6], [13.2, 150.4], [11.4, 146.8]] },
  { type: 'path', terrain: 'road', width: 4, points: RING_ROAD },
  { type: 'path', terrain: 'road', width: 3.5, points: HARBOUR_ROAD },
  { type: 'path', terrain: 'road', width: 2.5, points: [[94, 70], [97, 70]] },
  { type: 'path', terrain: 'ground', width: 1.8, points: SHORE_PATH },
  // the wet moat (6 m), then the bastions over it; the harbour basin
  ...MOAT.map((p) => ({ type: 'poly', terrain: 'water', points: p })),
  ...BASTIONS.map(([, x, z]) => ({ type: 'circle', terrain: 'ground', x, z, r: BASTION_R })),
  { type: 'rect', terrain: 'water', x: 82, z: 133, w: 21.4, d: 27 },
];

/**
 * The harbour's granite quays and the mole, paved (art review r2: their decks drew as the islet's cracked dry ground):
 * one area, visual only (`grid: false`: the walk grid keeps the TERRAIN rects above), laid in granite quay slabs, damp
 * and weedy in the joints; its water faces (the mole's sea and basin sides and end, the north quay's and the west quay's
 * basin faces, the west quay's end on the shore) carry the coping, the masonry quay wall, bollards and mooring rings.
 */
const QUAY_PAVE = {
  id: 'quay_harbour', surface: 'quay', grid: false, edge: 'hard',
  points: [[76, 126.6], [108, 126.6], [108, 152], [103.4, 152], [103.4, 133], [82, 133], [82, 154], [76, 155.2]],
  quay: { edges: [1, 2, 3, 4, 5, 6], bollards: 9, rings: true },
  wear: 0.5, cracks: 0.3, patches: 0, weeds: 0.3, puddles: 0.35, seed: 5105,
};
/** On the quays (visual only, `block: false`): life rings on their posts facing the basin, the capstan by the magazine. */
const QUAY_FURNITURE = [
  { type: 'lifebuoy', id: 'buoy_n', x: 94.5, z: 132.1, rot: 0, block: false },               // north quay: faces S
  { type: 'lifebuoy', id: 'buoy_mole', x: 104.25, z: 142.5, rot: Math.PI / 2, block: false }, // the mole: faces W
  { type: 'lifebuoy', id: 'buoy_w', x: 81.15, z: 142.5, rot: -Math.PI / 2, block: false },     // west quay: faces E
  { type: 'capstan', id: 'capstan_q', x: 90.5, z: 131.4, rot: 0, block: false },
];

// ---------------------------------------------------------------- structures (design §4.2)
// (`visual: false`: the rampart and the bastions are drawn by scripts/e05-art.js — the masonry ring, its faces run down
// to the moat bed — and nothing else: no rock prism kept hidden under the facing, where a ray, a capture or a stray
// visibility toggle still found it; review r3. Gameplay unchanged: the footprints, levels and walks are the def's)
const LEVELS = [
  ...Object.entries(BANDS).map(([id, pts]) => ({ ...level(id, 'rampart_granite', pts), visual: false })),
  ...BASTIONS.map(([id, x, z]) => ({ ...level(id, 'bastion_granite', circle(x, z, BASTION_R)), visual: false })),
];
/** Wall-walk links over the gate passage (the passage below stays at ground level). */
const ladder = (id, bottom, top, heading, extra = {}) => ({ id, x: bottom[0], z: bottom[1], y: bottom[2] ?? 0, top, raised: false, heading: deg(heading), ...extra });
const stairs = (id, bottom, top, heading) => ladder(id, bottom, top, heading, { kind: 'stairs', solid: true });
const plank = (id, a, b, heading) => ladder(id, a, b, heading, { kind: 'plank' });
/** Corner stairs, yard ↔ wall walk (design §4.2 stairs_x4): each flight runs along a face and lands on a corner. */
export const STAIRS = [
  stairs('S_nw', [44.6, 51.2, 0], [35.0, 48.8, Y.WALK], 180),
  stairs('S_ne', [67.8, 51.2, 0], [77.2, 48.8, Y.WALK], 0),
  stairs('S_se', [74.8, 82.6, 0], [77.2, 91.6, Y.WALK], 90),
  stairs('S_sw', [44.8, 88.8, 0], [35.0, 91.4, Y.WALK], 180),
];
const LINKS = [...STAIRS, plank('P_gate', [53.0, 93, Y.WALK], [59.0, 93, Y.WALK], 0)];

/** Rocks and the island's wind-bent pines (3D trees). */
const rock = (id, x, z, r, h = 1.8) => ({ id, type: 'rocks', variant: 'rock_granite_sea', x, z, rot: 0, w: 2 * r, d: 2 * r, h, block: 2 });
const pine = (x, z, k, h = 7) => ({ id: `pine_${k}`, type: 'pine', variant: 'pine_windswept', x, z, r: 0.45, h: h + (k % 3), seed: 5100 + k });
/**
 * The north and west coasts' granite cliffs: rock massifs (castle `buildCliff` faces, `coastal_granite` as M13's) from
 * the shoreline 4–7 m inland, 3.5–5.5 m high, broken by the bights (design §3: "cliffs north and west").
 */
const COAST_CLIFFS = [
  { id: 'cliff_nw', type: 'cliff', variant: 'coastal_granite', h: 4.6, points: [[13.6, 18.6], [15.6, 14.4], [20.2, 11.2], [24.4, 7.6], [29, 6.8], [33.2, 8.0], [38.2, 5.8], [42.6, 5.2], [43.2, 9.2], [38.4, 11.6], [33.6, 12.2], [28.4, 11.8], [23.4, 14.2], [19.4, 17.6], [16.0, 21.2]] },
  { id: 'cliff_n', type: 'cliff', variant: 'coastal_granite', h: 5.4, points: [[55.4, 5.0], [61, 6.4], [66, 4.8], [71.6, 6.0], [72.2, 9.8], [67.6, 11.8], [62.4, 10.4], [57.6, 11.4], [54.2, 9.0]] },
  { id: 'cliff_ne', type: 'cliff', variant: 'coastal_granite', h: 3.8, points: [[83.4, 5.8], [90, 5.2], [96, 5.6], [99.2, 9.2], [101.8, 12.6], [99.2, 15.2], [94.6, 11.8], [89.4, 10.6], [84.4, 10.2]] },
  { id: 'cliff_w1', type: 'cliff', variant: 'coastal_granite', h: 4.2, points: [[10.8, 26.4], [8.5, 32], [9.2, 39], [7.4, 46], [9.0, 53], [7.6, 60], [11.6, 58.4], [13.2, 52.6], [12.4, 45.6], [14.0, 39.4], [13.2, 32.4], [14.6, 27.6]] },
  { id: 'cliff_w2', type: 'cliff', variant: 'coastal_granite', h: 3.6, points: [[9.4, 65], [8.2, 72], [10.2, 79], [8.8, 86], [11.2, 93], [10.0, 100], [12.6, 98.4], [13.4, 91.2], [12.2, 84.6], [13.0, 77.4], [12.0, 70.8], [12.8, 66.2]] },
];
/** Tors on the heath: low granite whalebacks (walk round, see over) and boulder heaps. */
const tor = (id, x, z, pts, h) => ({ id, type: 'cliff', variant: 'coastal_granite', h, points: pts.map(([dx, dz]) => [x + dx, z + dz]) });
const TORS = [
  tor('tor_1', 31, 20.6, [[-3.2, -0.6], [-1.4, -2.4], [1.8, -2.0], [3.4, 0.2], [1.6, 2.2], [-1.6, 1.8]], 1.6),
  tor('tor_2', 48.6, 18.4, [[-2.2, -1.0], [0.4, -1.8], [2.8, -0.4], [2.0, 1.6], [-0.8, 1.9], [-2.6, 0.8]], 1.2),
  tor('tor_3', 66.2, 20.2, [[-3.6, -0.4], [-1.8, -2.0], [1.4, -1.8], [3.8, -0.2], [2.2, 1.8], [-1.2, 2.0]], 2.0),
  tor('tor_4', 85.4, 21.8, [[-2.0, -1.4], [1.0, -1.8], [2.6, 0.2], [0.8, 1.8], [-1.8, 1.2]], 1.4),
  tor('tor_5', 101.4, 37.6, [[-1.6, -1.6], [1.2, -1.8], [2.0, 0.6], [0.2, 2.0], [-1.8, 0.8]], 1.3),
  rock('rk_t1', 34.6, 23.2, 1.0, 0.9), rock('rk_t2', 52.4, 21.6, 1.2, 1.0), rock('rk_t3', 70.8, 22.6, 0.9, 0.8), rock('rk_t4', 22.6, 30.4, 1.1, 1.0),
  rock('rk_t5', 89.4, 19.4, 1.0, 0.9), rock('rk_t6', 41.4, 13.8, 1.3, 1.1),
];
/** Gorse and juniper (3D bushes) in clumps on the north and west heath. */
const bush = (k, x, z, h = 1.0) => ({ id: `bush_${k}`, type: 'bush', x, z, r: 0.7, h });
const BUSHES = [[25.6, 21.4, 1.1], [27.2, 22.8, 0.9], [44.2, 22.6, 1.2], [45.6, 21.4, 0.8], [58.6, 16.4, 1.0], [60.2, 17.8, 1.3],
  [77.6, 17.2, 0.9], [79.2, 18.6, 1.1], [93.8, 24.4, 1.0], [18.2, 40.2, 1.0], [17.0, 61.8, 0.9], [16.4, 96.4, 1.1], [18.8, 116.6, 1.0],
  [97.4, 30.6, 1.2], [36.4, 17.0, 0.8]].map(([x, z, h], k) => bush(k, x, z, h));

const NATURE = [
  // the cove's rocks (the folboats hide among them) and the shore under the glacis
  rock('rk_c1', 13.5, 144, 2.2, 2.2), rock('rk_c2', 27.5, 152.5, 1.8), rock('rk_c3', 12.5, 152, 1.5), rock('rk_s1', 44, 151.5, 1.6), rock('rk_s2', 60.5, 151.5, 1.4),
  // fallen granite at the cliffs' feet and on the east shore
  rock('rk_n2', 51.4, 8.6, 1.4, 1.5), rock('rk_n4', 100.8, 16.2, 1.6, 1.8), rock('rk_w4', 12.5, 124, 1.8),
  rock('rk_e1', 105, 28, 1.8), rock('rk_e2', 105.5, 100, 1.6), rock('rk_e3', 106.2, 44.6, 1.3, 1.4), rock('rk_e4', 106.4, 116.4, 1.5, 1.6),
  // the granite cliffs of the north and west coasts (rock massifs rising out of the sea: nobody's way goes there)
  ...COAST_CLIFFS,
  // tors: low granite whalebacks and boulder heaps on the heath north of the fort and on the east glacis's edge
  ...TORS,
  // gorse and juniper in clumps on the heath (north and west, away from every way the men walk)
  ...BUSHES,
  ...[[20, 24], [38, 16], [64, 15], [86, 18], [100, 34], [16.6, 47.6], [25.0, 16.2], [16, 110], [32, 126], [46, 132], [100, 104], [102, 118], [64, 132]]
    .map(([x, z], k) => pine(x, z, k)),
];

/** The harbour (design §4.2): the magazine (a room), the quay, the mole, the boat sheds. */
const HARBOUR = [
  // (the boat sheds, the camp's huts and the kennel are drawn by scripts/e05-art.js on their boxes: the library's
  // stand-ins for them — a Norwegian turf-roofed shed at three times the kennel's size — overlapped the drawn ones)
  { id: 'shed_1', type: 'hut', variant: 'boathouse_small', label: 'Boat shed', x: 72.5, z: 136.5, rot: deg(90), w: 5, d: 4, h: 3.2, mat: 'planks', visual: false },
  { id: 'shed_2', type: 'hut', variant: 'boathouse_small', label: 'Boat shed', x: 72.5, z: 143, rot: deg(90), w: 5, d: 4, h: 3.2, mat: 'planks', visual: false },
  { id: 'drums_q', type: 'barrels', x: 92, z: 126.2, r: 0.9, h: 1.1 },
  { id: 'crates_q', type: 'crates', variant: 'crates_ammo', x: 97, z: 126.5, rot: 0, w: 2.4, d: 1.4, h: 1.1, block: 1 },
  // the MG ring at the mole's end (design §13 landmarks; review r3: the gun stood bare on the deck): a 270° ring of
  // sandbags round mg_mole's tripod, its open back to the mole's root, closed to the south over the mouth — sized to the
  // mole's deck (x 103.4–108, its end at z 152: the front course stops 0.1 m short of the coping, the gun at its centre
  // + 0.4). Visual only (block 0, clip false): no footprint and no measured nav stamp — the gunner, hq4's turn at
  // (105.2, 149) and every sight line over the mole are as tuned
  { id: 'mg_mole_ring', type: 'sandbags', variant: 'mg_ring', x: 105.2, z: 150.6, rot: deg(90), ring: { r: 1.15, arc: 270, width: 0.6 }, h: 0.9, block: 0, clip: false },
];
/** The hut camp on the east glacis (the garrison) and its kennel. */
const hut = (id, x, z) => ({ id, type: 'hut', variant: 'hut_timber_barrack_b', label: 'Barrack hut', x, z, rot: 0, w: 10, d: 5.5, h: 4, mat: 'planks', visual: false });
const CAMP = [
  { ...hut('camp', 102, 70), garrison: true, door: deg(180), label: 'Garrison huts' },
  hut('hut_2', 102, 61), hut('hut_3', 102, 79),
  { id: 'camp_fence', type: 'fence', variant: 'post_and_wire', segments: [[[96.5, 66.5], [96.5, 54], [107, 54]], [[96.5, 73.5], [96.5, 86], [107, 86]]], h: 1.4, width: 0.3 },
  { id: 'kennel', type: 'hut', variant: 'dog_kennel', x: 99.5, z: 88.4, rot: 0, w: 1.4, d: 1.2, h: 1.2, mat: 'planks', visual: false },
];
/** Props the gameplay sees (the rest is dressing, drawn by the art pass). */
const PROPS = [
  { id: 'crates_y', type: 'crates', variant: 'crates_ammo', x: 61, z: 82.6, rot: 0, w: 2.2, d: 1.2, h: 1.1, block: 1 },
  // (`roofW` 2.0: the well's roof stops 0.1 m short of the parade's stores stack 0.2 m west of the well's rim; at the
  // kit's 2.4 m its eaves ran into the stack's tarpaulin. The well stays where it was: it hides the guardroom door
  // from the quarters sentry, which the intended solution needs)
  { id: 'well_y', type: 'well', x: 56, z: 73, r: 0.9, h: 1, block: 1, roofW: 2.0 },
  // the yard's stores, drawn by scripts/e05-art.js (yardStores, woodStack, drums, a water butt): low blockers here
  { id: 'stores_ne', type: 'crates', variant: 'stores_tarp', x: 73.45, z: 58.6, rot: 0, w: 4.4, d: 2.0, h: 1.3, block: 1, visual: false },
  { id: 'wood_w', type: 'crates', variant: 'woodstack', x: 39.6, z: 57.2, rot: 0, w: 0.8, d: 3.4, h: 1.0, block: 1, visual: false },
  { id: 'butt_w', type: 'crates', variant: 'water_butt', x: 39.6, z: 60.7, rot: 0, w: 0.8, d: 0.8, h: 0.9, block: 1, visual: false },
  { id: 'drums_y', type: 'crates', variant: 'drums', x: 69.15, z: 54.7, rot: 0, w: 1.4, d: 1.5, h: 0.9, block: 1, visual: false },
  { id: 'stack_lane', type: 'crates', variant: 'stores_tall', x: 64.7, z: 72.6, rot: 0, w: 1.6, d: 2.6, h: 2.1, block: 2, visual: false },
  // the courtyard behind the hoist house: a tall stack of stores under canvas across the passage's east end (against the
  // hoist house's NE corner) screens it from the yard; the way in is the strip along the casemate wall, past the iron
  // door (the radio casemate's stores: the design's "ammo boxes and stores by the casemate")
  { id: 'stack_pass', type: 'crates', variant: 'stores_tall', x: 70.85, z: 84.5, rot: 0, w: 1.9, d: 2.2, h: 2.2, block: 2, visual: false },
  // the parade's stores dump: a tall stack under canvas between the officers' quarters and the Gestapo office's door
  // (the quarters' door sentry sees the parade over it, not the office's door, 23 m off behind it)
  { id: 'stack_parade', type: 'crates', variant: 'stores_tall', x: 53.4, z: 72.3, rot: 0, w: 3.0, d: 1.4, h: 2.4, block: 2, visual: false },
];
const STRUCTURES = [...LEVELS, ...Object.values(ROOMS), ...HOIST_HOUSE, IRON_DOOR, HOIST_DOOR, HOIST_DOOR_W, ...SOLIDS, ...HARBOUR, ...CAMP, ...PROPS, ...NATURE];

// ---------------------------------------------------------------- enemies (design §7)
/** Sweep period per post, 9–12 s from the id (equal periods would keep every sweep in step all mission). */
export const sweepPeriod = (id) => 9 + ([...id].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7) % 7) / 2;
const at = (y) => (y ? { y, elevated: true } : {});
/** A post guard (holds his post; investigates bodies only). */
const sentry = (id, x, z, y, h, sweep, extra = {}) => ({
  id, soldierType: 'sentry', x, z, ...at(y), heading: deg(h), jail: false,
  flags: { holdsPost: true, investigates: false }, post: { heading: deg(h), sweep, period: sweepPeriod(id) }, ...extra,
});
/** A lone walker on `pts` (PINGPONG unless LOOP), 1.0 m/s, from the first point facing the second. */
const walker = (id, y, pts, extra = {}, type = 'PINGPONG') => ({
  id, soldierType: 'soldier', x: pts[0].x, z: pts[0].z, ...at(y), jail: false,
  heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x), flags: { investigates: true }, route: { type, vel: 1.0, points: pts }, ...extra,
});

/** The ring-road patrol: sergeant + two troopers, a lap ≈ 4 min (design §7.1). */
export const P1_ROUTE = [P(56, 108, 6, 0), P(76, 105), P(88, 96), P(93, 82), P(94, 70, 6, 0), P(93, 58), P(88, 44), P(76, 35), P(56, 32, 6, 270),
  P(36, 35), P(24, 44), P(18, 56), P(16, 70, 6, 180), P(18, 84), P(24, 96), P(36, 105)];
const patrol = (ids, sq, points) => ids.map((id, k) => ({
  id, soldierType: k ? 'trooper' : 'sergeant', x: points[0].x - 1.3 * k, z: points[0].z, jail: false,
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: !k }, squad: { id: sq, leader: ids[0], columns: 1 }, route: { type: 'LOOP', vel: 1.0, points },
}));

const OUTER = [ // §7.1 outside the moat
  ...patrol(['p1a', 'p1b', 'p1c'], 'p1', P1_ROUTE),
  { id: 'dh', soldierType: 'soldier', x: 97.5, z: 86.8, heading: deg(140), jail: false, flags: { holdsPost: true, investigates: false },
    post: { heading: deg(140), sweep: 40, period: sweepPeriod('dh') }, only: 'hard' },
  { id: 'dh_dog', soldierType: 'dog', x: 98.6, z: 86.2, heading: deg(140), handler: 'dh', flags: { investigates: true },
    post: { heading: deg(140), sweep: 60 }, only: 'hard' },
];
/** Gestapo loop on the wall walk (the clock of the mission): corners with a look into the yard (design §7.3). */
export const G4_ROUTE = [P(33, 47, 10, 45), P(79, 47, 10, 135), P(79, 93, 10, 225), P(33, 93, 10, 315)];
/** g5 [H]: the same loop the other way round, from the SE corner. */
export const G5_ROUTE = [G4_ROUTE[2], G4_ROUTE[1], G4_ROUTE[0], G4_ROUTE[3]];
/** The west rampart's walker, out over the moat at both ends. */
export const R_W_ROUTE = [P(31.5, 53, 8, 180), P(31.5, 87, 8, 180)];
const gestapo = (id, y, pts, type = 'LOOP', extra = {}) => ({ ...walker(id, y, pts, extra, type), soldierType: 'gestapo' });
const RAMPARTS = [ // §7.3 the wall walk (y 6)
  sentry('r_nw', 31.5, 45.5, Y.WALK, 225, 60),
  sentry('r_ne', 79, 44.8, Y.WALK, 300, 60),
  sentry('r_se', 81, 95, Y.WALK, 120, 50),
  sentry('r_sw', 31, 95, Y.WALK, 125, 50),
  walker('r_w', Y.WALK, R_W_ROUTE),
  gestapo('g4', Y.WALK, G4_ROUTE),
  { ...gestapo('g5', Y.WALK, G5_ROUTE), only: 'hard' },
  { ...walker('r_e', Y.WALK, [P(80.5, 53, 8, 0), P(80.5, 87, 8, 0)]), only: 'hard' },
  sentry('yg', 78.5, 56, Y.WALK, 200, 50), // over the parade's north half, from the east rampart
];
/** The Kriminalrat's round: the office desk (with Grethe), the study, the signal station, back (design §7.4). */
export const G3_ROUTE = [P(44.2, 79, 40, 180), P(48.2, 79), P(48.5, 66), P(47, 62.6), P(44.6, 59.4, 30, 180), P(47, 62.6), P(48.5, 66),
  P(58, 66), P(66, 53), P(68.5, 51.6), P(77.2, 48.8), P(82, 45.6, 40, 315), P(77.2, 48.8), P(68.5, 51.6), P(66, 53), P(58, 66),
  P(48.5, 66), P(48.2, 79)];
/**
 * The yard's two walkers (y1, y3 in opposite phase) pace the north side of the parade, from the commandant's house to
 * the officers' quarters: at the house end they look north at its front, at the quarters end north-east at the
 * quarters' door and the casemate's corner (and turn back by the north: their backs to the parade's south half). They
 * watch the house and the parade's north half; the south half (the office's east face, the gate) is out of their eyes
 * except as they turn. (The design's loop round the west half was tuned on narrower cones: with the engine's 70°
 * elliptical cones, two walkers on it saw the whole west half all the time.)
 */
export const Y_BEAT = [P(51.2, 67.2, 8, 270), P(61.0, 67.2, 8, 315)];
/** The puppet's beat (y2): the lane west of the radio casemate, from the quarters' corner (looking north) down and into
 * the passage between the casemate and the hoist house, where he halts by the iron door looking west out along it at the
 * yard; the courtyard behind the stores stack is at his back there. */
export const Y2_ROUTE = [P(62.8, 63.4, 10, 270), P(62.8, 80.4), P(68.6, 83.4, 12, 180)];
/** The adjutant's beat: half a minute inside the commandant's house (at the stair, looking north), then out of its
 * door, down the parade's west side to the guardroom (half a minute there, looking south), and back. */
export const ADJ_ROUTE = [P(50.6, 60.6, 30, 270), P(47, 62.6), P(47, 66.4), P(51, 71), P(51, 82.2), P(49, 83.8, 30, 90)];
const YARD_MEN = [ // §7.4 the yard (y 0)
  walker('y1', 0, Y_BEAT), // from the house end
  walker('y3', 0, [...Y_BEAT].reverse()), // from the quarters end: opposite phase
  walker('y2', 0, Y2_ROUTE), // the lane by the casemate down to the SE corner: the puppet
  { id: 'rs1', soldierType: 'soldier', x: 74, z: 64.5, heading: deg(0), jail: false, flags: { holdsPost: true, investigates: false },
    post: { heading: deg(0), sweep: 0 } }, // at his receiver, headphones on, back to the casemate's hall
  { id: 'rs2', soldierType: 'soldier', x: 74, z: 77, heading: deg(0), jail: false, flags: { holdsPost: true, investigates: false },
    post: { heading: deg(0), sweep: 0 } },
  sentry('oq1', 62, 60.5, 0, 90, 50), // the quarters' door, south over the parade
  { ...sentry('oq2', 57.5, 60, 0, 200, 40), only: 'hard' }, // west-north-west at the house's east wall
  sentry('gs1', 54.6, 89.6, 0, 90, 30), sentry('gs2', 57.4, 89.6, 0, 90, 30), // the gate passage's inner mouth, out along the passage at the bridge
  sentry('gr1', 52.6, 89.0, 0, 45, 40), // the guardroom's door sentry, at the passage and the bridge beyond it
  { id: 'k1', soldierType: 'soldier', x: 59.9, z: 88.7, heading: deg(90), jail: false, flags: { holdsPost: true, investigates: false },
    post: { heading: deg(90), sweep: 0 } }, // the bridge keeper at his switch panel, his back to the door
  { id: 'cmd', soldierType: 'officer', x: 43.6, z: 58.4, heading: deg(180), jail: false, post: { heading: deg(180), sweep: 0 } }, // at his desk
  { id: 'adj', soldierType: 'lieutenant', x: ADJ_ROUTE[0].x, z: ADJ_ROUTE[0].z, heading: deg(270), jail: false, flags: { investigates: false },
    route: { type: 'PINGPONG', vel: 1.0, points: ADJ_ROUTE } },
  { ...sentry('g1', 48.3, 76.6, 0, 270, 40), soldierType: 'gestapo' }, // either side of the office door, along its face
  { ...sentry('g2', 48.3, 81.4, 0, 90, 40), soldierType: 'gestapo' },
  { id: 'g3', soldierType: 'gestapo', x: 44.2, z: 79, heading: deg(180), jail: false, flags: { investigates: false },
    route: { type: 'LOOP', vel: 1.0, points: G3_ROUTE } }, // the Kriminalrat (the burn script's actor)
  { ...sentry('cs1', 73.2, 86.2, 0, 270, 40), only: 'hard' }, // in the courtyard behind the hoist house, watching the way in past the iron door: the hoist house door behind him
];
const HARBOUR_MEN = [ // §7.2 the harbour
  sentry('hq1', 79.8, 140, 0, 45, 50), // the west quay: the mole and the mouth
  sentry('hq2', 101.5, 131.5, 0, 90, 50), // the mole's root, south along the mole
  walker('hq4', 0, [P(105.2, 135, 8, 0), P(105.2, 149, 8, 0)]), // the mole top, out to sea at both ends
  sentry('mq1', 86.4, 132, 0, 90, 40), // the magazine door, south over the basin
  { id: 'mg_mole', soldierType: 'mg', x: 105.2, z: 151, heading: deg(90), emplacement: 'mg_mole_gun', jail: false,
    post: { heading: deg(90), sweep: 60 } }, // over the mouth
  { ...walker('hq3', 0, [P(89, 131, 14, 90), P(100, 131, 6, 90)]), only: 'hard' }, // the north quay, looking out over the basin at both ends
];
const ENEMIES = [...OUTER, ...RAMPARTS, ...YARD_MEN, ...HARBOUR_MEN];
/** A beat with every halt `wait` s long. */
const waitsOf = (pts, wait) => pts.map((p) => (p.wait ? { ...p, wait } : p));
/**
 * r_w's look at his south end on Hard: the design's 100° is a COMPASS bearing (its g4 corners are 135 / 225 / 315 / 45
 * compass), east-south-east into the yard; route `look`s here are the code's headings (0 = E, 90 = S), so 100 − 90 = 10.
 */
export const R_W_HARD_LOOK = 10;
/** Hard's routes (design §12; schema applyVariant merges an enemyPatch entry over the man's own fields). */
export const HARD_PATCH = {
  g4: { route: { type: 'LOOP', vel: 1.0, points: waitsOf(G4_ROUTE, 15) } },
  g5: { route: { type: 'LOOP', vel: 1.0, points: waitsOf(G5_ROUTE, 15) } },
  y2: { route: { type: 'PINGPONG', vel: 1.0, points: waitsOf(Y2_ROUTE, 6) } },
  r_w: { route: { type: 'PINGPONG', vel: 1.0, points: [R_W_ROUTE[0], { ...R_W_ROUTE[1], look: R_W_HARD_LOOK }] } },
};

// ---------------------------------------------------------------- commandos and Grethe (design §5)
const COMMANDOS = [
  { role: 'spy', x: 20.5, z: 146.5, heading: deg(0), inventory: { pistol: 1, lethalInjection: 1, firstAid: 6 } },
  { role: 'greenberet', x: 22.5, z: 148.5, heading: deg(0), inventory: { knife: 1, pistol: 1, decoy: 1, shovel: 1 } },
  { role: 'diver', x: 18.5, z: 150.2, heading: deg(0), inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  // held for questioning in the Gestapo office: out of play until a commando reaches her chair (design §5)
  // (her BCD kit: the pocket pistol and her small talk; two packs of cigarettes from her coat pocket, design §5)
  { role: 'grethe', x: SPOTS.grethe[0], z: SPOTS.grethe[1], heading: deg(0), inventory: { cigarettes: 2 }, joinsAt: { x: SPOTS.grethe[0], z: SPOTS.grethe[1], r: 3 } },
];

// ---------------------------------------------------------------- zones and the garrison (design §8)
const Z_FORT = [[22, 36], [90, 36], [90, 104], [22, 104]];
const Z_HARBOUR = [[70, 120], [110, 120], [110, 160], [70, 160]];
const Z_OUTER = [[0, 0], [110, 0], [110, 160], [0, 160]];
const ZONES = [
  { id: 'z_fort', poly: Z_FORT, onSeen: 'RFORT', onHeard: 'RFORT', siren: true },
  { id: 'z_harbour', poly: Z_HARBOUR, onSeen: 'RHARB', onHeard: 'RHARB', siren: true },
  // (the cove and the south shore path west of x 60 raise nothing: local reactions only, design §8)
  { id: 'z_outer', poly: [[0, 0], [110, 0], [110, 120], [64, 120], [64, 140], [0, 140]], onSeen: 'ROUT', onHeard: 'ROUT' },
];
const squad = (event, size, exitRoute, loop, extra = {}) => ({ event, size, exitVel: 2.6, exitRoute, loopVel: 1.8, loop, ...extra });
const BARRACKS = {
  camp: { pool: 8, squads: [
    // RFORT: over the bridge (if down) into the yard; with the bridge up they stop at the outer bank and wait
    squad('RFORT', 3, [P(94, 70), P(88, 96), P(76, 105), P(56, 106), P(56, 99), P(56, 92)], [P(56, 86), P(50, 75), P(50, 66), P(57, 66), P(57, 86)]),
    squad('RFORT', 3, [P(94, 70), P(88, 96), P(76, 105), P(56, 106), P(56, 99), P(56, 92)], [P(60, 84), P(64, 70), P(60, 66), P(56, 78)]),
    // RHARB: down the harbour road to the quay
    squad('RHARB', 2, [P(94, 70), P(88, 96), P(76, 105), P(62, 114), P(70, 120), P(77, 125.5)], [P(80, 127), P(95, 128), P(80, 127)]),
  ] },
};

// ---------------------------------------------------------------- objectives (design §6)
export const MSG = {
  burned: 'THE CARD INDEX IS BURNING ON HAMMERØ.',
  lark: 'LARK IS DEAD.',
};
const OBJECTIVES = [
  { id: 'o1', text: "Take the card index from the commandant's study", type: 'script', required: true },
  { id: 'o2', text: 'Reach Grethe Holm in the Gestapo office', type: 'script', required: true },
  { id: 'o3', text: "Take the station's call-sign book from the radio casemate", type: 'script', required: true },
  { id: 'o4', text: 'Raise the drawbridge and shut the camp out of its own fort', type: 'script', required: true },
  { id: 'o5', text: 'Everyone, with Grethe, back to the folboats in the cove', type: 'escape', required: true },
];

const def = {
  id: 'e05', campaign: 'BCD', number: 5,
  title: 'Cold Iron', place: 'Hammerø fort, off Bornholm, Denmark', date: '1944-10-14',
  pin: { lat: 55.30, lon: 14.77 },
  context: 'October 1944. The Germans have disbanded the Danish police and the Gestapo have the country to themselves. Referat N\'s Baltic station sits in an old star fort on a granite islet off Bornholm, and three days ago the Gestapo arrested the woman who typed most of its cards.',
  subtitle: 'Hammerø fort, off Bornholm · 14 October 1944',
  theater: 'coast',
  coneColors: 'green',
  size: [110, 160],
  seed: 1944_1014,
  briefing: {
    historical: 'October 1944. The Germans have disbanded the Danish police and the Gestapo have the country to themselves. Referat N\'s Baltic station sits in an old star fort on a granite islet off Bornholm: a mast on the north-east bastion, receivers in a casemate, and in the commandant\'s study the card index of two hundred names that the station\'s bearings have produced. Three days ago the Gestapo arrested the woman who typed most of those cards.',
    text: 'Grethe Holm, code name Lark, has worked the switchboard of Referat N\'s Copenhagen office since 1942 and passed us every name that crossed it. They know that now. She is on Hammerø, in the Gestapo office in the fort, being questioned by a Kriminalrat who has not yet had her shot because he wants the rest of her friends. Three of you land on the islet at dusk. The fort\'s garrison lives in a hut camp on the glacis and walks in and out over a drawbridge; inside the walls at night there are only the Gestapo, the signals people and the gate. Go in by the ammunition hoist from the harbour magazine. Get Grethe out, take the index, take the station\'s call-sign book from the radio casemate: its door opens only to their own men, so handcuff one and work him like a puppet. Then raise the bridge from the switch room by the gate and leave the way you came: the camp stays outside its own fort until morning.',
    objectivesSummary: 'Take the card index and the call-sign book, reach Grethe in the Gestapo office, raise the drawbridge, then everyone back to the folboats in the cove.',
    hints: [
      'The hoist carries four, or one carried man and two. It creaks: keep the nearest sentry well off.',
      'The Gestapo wear black. They see through every uniform and they do not stop to talk. They can be knocked out from behind like anyone else.',
      'A puppet opens doors his own side keeps locked and works switches. Keep him within pistol range and in sight, and keep yourself unseen while you hold the strings.',
      'Grethe can stop a soldier with a question and keep his eyes on her while she talks. Not a Gestapo man.',
      'The bridge keeper lowers the bridge again the moment he can. See to him.',
      'If the fort\'s alarm sounds, the Kriminalrat takes the index to the signal station and burns it.',
    ],
  },
  // Baltic dusk (design §13): a low western sun under cloud, cold light; raised from the design's 6° so the yard reads
  lighting: { sunElevDeg: 17, sunAzimuthDeg: 245, kelvin: 5400, hdri: 'dusk', fog: 170, lut: 'coast', exposure: 1.18 },
  // (velocity 0: the moat, a water body off the map edge, would otherwise be drawn as a foaming river — the sea's waves
  // come from the wind. `calm`: the moat and the harbour basin behind its mole are sheltered water, no whitecaps — the
  // gale's whitecaps stay on the open sea, where they read as surf instead of ice floes. The rects run 3 m over the
  // banks (the shader fades the whitecaps back in over a rect's last 3 m: here only at the basin's mouth, z 152–155)
  // the heath's clumps (art/e05-heath.js, visual only) keep off the fort inside its moat (the yard is bare ground too),
  // the harbour (quay, mole, sheds), the camp's yard and the cove's landing
  e05HeathExclude: [[22, 36, 90, 104], [69, 121, 110, 160], [95.5, 52.5, 110, 87.5], [11, 139, 29, 157]],
  // the islet's landforms (art/terrain: visual only — knolls of granite under the heath, the swards in shallow
  // hollows), each on open ground clear of every structure, way, keep-out and the shore (review r2: "real ground
  // undulation away from the fort"); r: the bump's reach, h: its rise (m)
  groundRelief: [
    { x: 53, z: 123, r: 9.4, h: 2.0 }, { x: 24, z: 134, r: 9.2, h: 2.2 }, { x: 92, z: 116, r: 7.4, h: 1.5 }, { x: 28, z: 117, r: 7, h: 1.4 },
    { x: 39, z: 137, r: 6.6, h: 1.3 }, { x: 58, z: 137, r: 5.8, h: 1.0 }, { x: 39, z: 125, r: 5.1, h: -0.6 }, { x: 80, z: 117, r: 4.6, h: 0.8 },
    { x: 49, z: 140, r: 4, h: -0.5 }, { x: 66, z: 126, r: 3.9, h: -0.55 }, { x: 102, z: 94, r: 3.8, h: -0.45 }, { x: 72, z: 15, r: 3.7, h: 0.7 },
    { x: 80, z: 12, r: 3.5, h: 0.6 }, { x: 68, z: 149, r: 3.5, h: 0.5 }, { x: 39, z: 116, r: 3.5, h: 0.6 }, { x: 101, z: 49, r: 3.4, h: 0.55 },
  ],
  // (`shoreFoam` / `foam` / `surf`: the gale's shore band and whitecaps softened to broken, streaky water — at the
  // defaults the surf along the east shore under the camp read as a bank of snow; review r2)
  // (`reflUnbias`: the walls' reflections stay on their walls — the moat showed a ruler-straight pale band of sky at
  // the foot of every rampart face and a dark one off the counterscarp; review r3)
  water: { velocity: 0, angleDeg: 300, turbulence: 0.5, color: '#2f4a52', calm: [[20, 34, 92, 106], [79, 130, 106.4, 155]],
    shoreFoam: 0.5, foam: 0.7, surf: { amp: 0.12 }, reflUnbias: true },
  weather: { wind: { preset: 'gale', dirDeg: 300, speed: 14, gustiness: 0.6 } },
  shoreShallowWidth: 1.0,
  rules: { roofRule: false }, // the wall walk and the yard see each other (open ground, as M20's terraces)
  baseTerrain: 'water',
  terrain: TERRAIN,
  pavements: [QUAY_PAVE],
  furniture: QUAY_FURNITURE,
  structures: joinStructures(STRUCTURES, [
    // the rampart is one masonry ring: bands meet bands and bastions; rooms and the gate stand against it
    ['ramp_n', 'ramp_w'], ['ramp_n', 'ramp_e'], ['ramp_sw', 'ramp_w'], ['ramp_se', 'ramp_e'], ['ramp_n', 'b_nw'], ['ramp_n', 'b_ne'],
    ['ramp_w', 'b_nw'], ['ramp_e', 'b_ne'], ['ramp_sw', 'b_sw'], ['ramp_w', 'b_sw'], ['ramp_se', 'b_se'], ['ramp_e', 'b_se'],
    ['radio_cas', 'ramp_e'], ['keeper', 'ramp_se'], ['hoist_top', 'ramp_se'],
    ['iron_door', 'radio_cas'], ['hoist_door', 'hoist_top'], ['hoist_door_w', 'hoist_top_1'], ['hoist_door_w', 'hoist_top'], ['hoist_door', 'hoist_top_1'], ['hoist_top_1', 'ramp_se'], ['stack_pass', 'hoist_top'], ['stack_pass', 'hoist_top_1'], ['signal_hut', 'b_ne'], ['camp', 'camp_fence'], ['hut_2', 'camp_fence'], ['hut_3', 'camp_fence'],
  ]),
  items: [],
  interactables: [
    { kind: 'pickup', itemId: 'documents', id: 'index', x: SPOTS.index[0], z: SPOTS.index[1], label: 'Card index' },
    { kind: 'pickup', itemId: 'documents', id: 'callbook', x: SPOTS.callbook[0], z: SPOTS.callbook[1], label: 'Call-sign book' },
    { kind: 'lift', id: 'hoist', label: 'Ammunition hoist', x: SPOTS.hoistBottom[0], z: SPOTS.hoistBottom[1], a: [SPOTS.hoistBottom[0], SPOTS.hoistBottom[1], 0], b: [SPOTS.hoistTop[0], SPOTS.hoistTop[1], 0] },
    { kind: 'drawbridge', id: 'drawbridge', x: BRIDGE.x, z: BRIDGE.z, rect: BRIDGE },
    { kind: 'drawbridgeSwitch', id: 'bridge_switch', x: SPOTS.switch[0], z: SPOTS.switch[1], targets: ['drawbridge'] },
  ],
  vehicles: [
    { id: 'mg_mole_gun', vehicleType: 'mgNest', x: 105.2, z: 151, heading: deg(90), gunner: 'mg_mole', driveable: false },
  ],
  commandos: COMMANDOS,
  enemies: ENEMIES,
  zones: ZONES,
  jails: [],
  barracks: BARRACKS,
  climbLinks: [],
  ladders: LINKS,
  // the hoist's two stops and the stair feet stay reachable whatever the drawn art closes (map-builder missionWayPoints)
  navKeep: [SPOTS.hoistTop, SPOTS.hoistBottom, ...STAIRS.map((s) => [s.x, s.z]), [84, 132.2], [71.2, 88.0], [63.2, 88.0], [69, 82]],
  triplines: [],
  objectives: OBJECTIVES,
  extraction: { zone: { x: COVE.x, z: COVE.z, r: COVE.r } },
  // the mission script's own state (the papers, the burn, the keeper's clock), saved with the game (scripts/e05.js)
  setpieces: [{ type: 'e05_state', id: 'e05_state' }],
  triggers: [
    { on: 'start', do: [{ message: 'Hammerø. The index, the call-sign book, Grethe, the bridge; then back to the folboats.', kind: 'info' }] },
  ],
  script: e05Script,
  // read by scripts/e05.js (the burn script's two stops, the failure texts)
  // (`stove`: where the Kriminalrat stands to burn the index — in the shelter's open front, the stove at his knees)
  e05Spots: { study: [44.6, 59.4], stove: [82.4, 45.4], stoveAt: SPOTS.stove, index: SPOTS.index, hoist: { top: SPOTS.hoistTop, bottom: SPOTS.hoistBottom } },
  // read by scripts/e05-art.js (the fort's outline for the parapets and the counterscarp)
  e05Fort: { ramp: RAMP, bastions: BASTIONS, bastionR: BASTION_R, moat: { x0: 24, z0: 38, x1: 88, z1: 102 }, mast: [80.4, 44.4] },
  e05Fail: MSG,
  alarmFail: null,
  // (the design's 960 / 1050 s; the reference solution, careful never to stand in a live cone, wins at about 1294 s on
  // Hard and 1508 s on Easy: par is set just above it, as for e04)
  par: { time: 1380 },
  cameraStart: { x: 24, z: 140 },
  startDisguised: [],
  variants: {
    easy: { par: { time: 1620 }, routeSpeedMul: 0.8, pauseMul: 2.5,
      enemyPatch: { yg: { post: { heading: deg(200), sweep: 40, period: sweepPeriod('yg') } },
        gs1: { post: { heading: deg(90), sweep: 20, period: sweepPeriod('gs1') } }, gs2: { post: { heading: deg(90), sweep: 20, period: sweepPeriod('gs2') } },
        r_se: { post: { heading: deg(120), sweep: 40, period: sweepPeriod('r_se') } } },
      burnTime: 45, relowerAfter: 120 },
    // the design's Hard tightening (§12): the black coats look into the yard 15 s at each corner, the puppet halts 6 s at
    // each end of his beat, and the west rampart's walker glances into the yard at his south end (the design's compass
    // 100°: heading 10°, east-south-east, R_W_HARD_LOOK)
    hard: { par: { time: 1380 }, burnTime: 30, relowerAfter: 60, enemyPatch: HARD_PATCH },
  },
};

registerExpansionMission(def);
export default def;
