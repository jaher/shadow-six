/**
 * The men in an open boat, drawn (visual only — the sim never reads any of it). Before this module the inflatable raft,
 * the rowboat and the escape boat sailed off empty: a unit that boards is hidden (entities/vehicle.js enter) and only
 * cars / lorries drew their occupants (art/vehicle-crew.js). Now, per occupant of a boat with no enemy crew records:
 *
 *  - a figure with the man's own look (real character model, weapon stowed) on a SEAT of the hull's layout
 *    (BOAT_SEATS, else the library model's standing sockets), parented to the posed hull so it bobs and rolls with it;
 *    the operator (the Marine) always takes seat 0, the others the first free seat and keep it while aboard;
 *  - every seated man's legs are fitted to the hull (two-bone leg IK onto the seat's foot spots on the floorboards /
 *    floor / tube): no boot through the planking, the floor or a thwart, knees up where the seat is low;
 *  - the Marine kneels at the raft's stern and PADDLES: a single-bladed paddle gripped in both fists (the paddle runs
 *    through both palms; the raft's own port paddle leaves its rowlock, the starboard one is stowed along the top of
 *    the starboard tube), one stroke per wake stroke on alternating sides, in step with the catch rings the wake draws
 *    (art/water.js WakeTracker.strokeOf); pivoting on the spot he strokes on one side only; at rest the paddle lies
 *    across his thighs, and setting off or stopping he raises it upright before him on the way (the shaft and blade
 *    clear of the tubes, the thwart and the floor at every phase: tests/unit/boat-oars.test.mjs, GPU boat-oars);
 *  - in the rowboat he ROWS: facing aft on the midship thwart, a fist round each oar handle, the oars turning between
 *    their thole pins on the gunwales (art/oars.js): catch (blades dip, arms out, leaning toward the stern) → drive
 *    (blades in, lean back, handles to the chest) → feathered recovery, the stroke clock the wake's (both blades ring
 *    out at each catch); the inside oar shortens its stroke in a turn and backs water when he pivots on the spot; at
 *    rest he holds them with the blades flat on the water; with men aboard but nobody at the oars they trail
 *    alongside, in an empty boat they are shipped inside along the thwarts (the model's own oars are hidden);
 *  - getting in is shown: from the bank he steps over the tube / gunwale and sits down, from the water he hoists
 *    himself in; getting out he stands up, steps over the side and walks to the spot the sim put him on, where his
 *    own model takes over (it stays hidden until then). The sim's timing is unchanged (boardTime, instant exit).
 *  - the Biber mini-sub is enclosed (its pilot sits under the hatch, which already opens and closes as he boards):
 *    nobody is drawn there.
 *
 * Every pose is a pure function of the stroke / transition time, unit-tested in tests/unit/boat-crew.test.mjs and
 * tests/unit/boat-oars.test.mjs; the figures are UnitModels (art/unit-model.js) whose `overlay` hook writes the legs,
 * the paddling / rowing arms and the closed fists after the mixer (two-bone IK, like the shovel in art/shovel-dig.js).
 * @module art/boat-crew
 */
import * as THREE from 'three';
import { twoBoneIKPole, wpos, wquat, handFrame, handQuat } from './characters/commandos_a/ca_ik.js';
import { T as TERRAIN } from '../world/grid.js';
import { OAR, ROW, EASY, TRAIL, rowKey, backKey, mixOar, oarPoints, oarDir, oarAnglesThrough } from './oars.js';
import { groundOf } from './boat-rest.js';

export { ROW, rowKey, OAR } from './oars.js';

const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ seats

/**
 * Seat layouts per library type, hull model space (+z bow, +x the boat's LEFT, y up from the waterline). pose:
 *   paddle  kneeling, paddling (the raft's Marine)          root on the floor   clip kneel_shoot
 *   row     on a thwart facing aft, rowing (yaw π)          pelvis on the seat  clip sit
 *   floor   on the bottom, knees up, hands on the tubes     root on the floor   clip boat_sit (guest raft clip)
 *   tube    on the inflatable's tube                        pelvis on the seat  clip sit
 *   bench   on a thwart / the stern sheets                  pelvis on the seat  clip sit
 *   stand   standing on deck                                root on the deck    clip idle
 * `p`: the root (root poses) or the seat top under the pelvis (seated poses). `feet` {l, r}: hull-space ankle spots
 * the legs are fitted to ([x, y, z, toe?] — toe = lowest the toes may go; knee 'down' for a kneeling leg), y = the
 * floor under the sole + 8.5 cm. `rim`: height of the tube top / gunwale / deck edge a man steps over.
 */
export const BOAT_SEATS = Object.freeze({
  // the inflatable (2.7 × 1.3 m, tubes ~0.30 high, floor 0.02 between |x| 0.25 from z −0.9 to 0.9, the cross-thwart
  // tube z −0.33 … −0.17 topped at 0.21; raft.py): the Marine kneels at the stern (front foot up on the thwart, back
  // knee on the floor, back foot on the stern tube — his paddle sweeps both sides over the tubes beside him, so the
  // men keep low or forward of it): one sits on the floor before the thwart, knees up; one on the bow tube facing aft;
  // M13's 4th and 5th on the side tubes forward, feet in the bow's well
  raft: { rim: 0.32, seats: [
    { p: [0, 0.02, -0.62], pose: 'paddle', feet: { l: [0.16, 0.295, -0.27, 0.22], r: [-0.13, 0.385, -1.05, 0.31], kneeR: 'down' } },
    { p: [0, 0.02, 0.02], pose: 'floor', feet: { l: [0.17, 0.105, 0.44], r: [-0.17, 0.105, 0.44] } },
    { p: [0, 0.42, 1.1], yaw: PI, pose: 'tube', feet: { l: [-0.055, 0.105, 0.8], r: [0.055, 0.105, 0.8] } },
    { p: [0.37, 0.3, 0.42], yaw: -0.9, pose: 'tube', feet: { l: [0.19, 0.105, 0.66], r: [0.11, 0.105, 0.56] } },
    { p: [-0.37, 0.3, 0.42], yaw: 0.9, pose: 'tube', feet: { l: [-0.11, 0.105, 0.56], r: [-0.19, 0.105, 0.66] } },
  ] },
  // the wooden rowboat (3.9 × 1.4 m, floorboards at 0.043, thwarts topped at 0.357 / 0.337 / 0.357 at z −1.2 / −0.15
  // / 1.05; rowboat.py): the oarsman on the midship thwart facing aft (feet braced on the boards before him), two men
  // side by side in the stern sheets facing him (feet tucked back clear of his), one on the bow thwart (feet together
  // on the keel boards where the bow narrows), then the bottom boards forward of the oarsman (M7 / M14: five aboard)
  rowboat: { rim: 0.52, seats: [
    { p: [0, 0.337, -0.15], yaw: PI, pose: 'row', feet: { l: [-0.14, 0.128, -0.53], r: [0.14, 0.128, -0.53] } },
    { p: [0.23, 0.357, -1.2], pose: 'bench', feet: { l: [0.27, 0.128, -1.03], r: [0.12, 0.128, -1.03] } },
    { p: [0, 0.357, 1.05], pose: 'bench', feet: { l: [0.09, 0.128, 1.36], r: [-0.09, 0.128, 1.36] } },
    { p: [0, 0.043, 0.25], pose: 'floor', feet: { l: [0.17, 0.128, 0.84], r: [-0.17, 0.128, 0.84] } },
    { p: [-0.23, 0.357, -1.2], pose: 'bench', feet: { l: [-0.12, 0.128, -1.03], r: [-0.27, 0.128, -1.03] } },
  ] },
});
/**
 * Standing spots moved off the deck fittings, per library asset and socket name ([x, z]; the deck height stays the
 * socket's): the patrol boat's after-deck passenger sockets stand on its engine-room vents and the stern lookout on
 * the centre bollard, so the men stand on the clear deck beside them.
 */
export const STAND_FIX = Object.freeze({
  patrol_boat: { passenger_0: [-0.3, -4.75], passenger_1: [0.3, -4.75], passenger_2: [-0.3, -5.6], passenger_3: [0.3, -5.6], crew_stern: [0.45, -6.45] },
});
/** Library types whose occupants are never drawn: the Biber's pilot is enclosed under its hatch. */
export const ENCLOSED = new Set(['minisub']);

/**
 * Seat layout of a boat: its BOAT_SEATS entry, else the library model's standing deck sockets (the patrol / escape boat:
 * helm first, then the passengers on the after deck, the stern lookout; moved clear of the deck fittings, STAND_FIX),
 * else none.
 * @param {string} libType library type (vehicle-model `libType`) @param {object} [meta] model sidecar (sockets)
 * @returns {{rim:number, seats:{p:number[], yaw?:number, pose:string, feet?:object}[]}}
 */
export function boatLayout(libType, meta = null) {
  if (ENCLOSED.has(libType)) return { rim: 0, seats: [] };
  if (BOAT_SEATS[libType]) return BOAT_SEATS[libType];
  const fix = STAND_FIX[meta?.asset] || {};
  const socks = (meta?.sockets || []).filter((s) => /^stand_(helm|boat|lookout)/.test(s.pose || '') && Array.isArray(s.pos));
  const helm = socks.filter((s) => /helm/.test(s.pose)), rest = socks.filter((s) => !/helm/.test(s.pose));
  const seats = [...helm, ...rest].map((s) => {
    const f = fix[s.name], p = f ? [f[0], s.pos[1], f[1]] : [...s.pos];
    return { p, yaw: Math.atan2(s.dir?.[0] ?? 0, s.dir?.[2] ?? 1), pose: 'stand' };
  });
  return { rim: seats.length ? Math.max(...seats.map((s) => s.p[1])) + 0.25 : 0, seats };
}

/**
 * Stable seat assignment: an occupant keeps the seat he has; the operator takes seat 0, everyone else the first free
 * seat from 1 (seat 0 too on a boat nobody operates, `open0`). Men beyond the seats get none (not drawn).
 * @param {Map<object, number>} prev @param {object[]} occupants @param {object|null} driver @param {number} n seats
 * @param {boolean} [open0] seat 0 is free for anyone (scripted / escape boats: no operator)
 * @returns {Map<object, number>}
 */
export function assignBoatSeats(prev, occupants, driver, n, open0 = false) {
  const out = new Map(), taken = new Set();
  for (const u of occupants) {
    const k = prev?.get(u);
    if (k == null || k >= n || taken.has(k) || (k === 0 && !open0 && u !== driver)) continue;
    out.set(u, k); taken.add(k);
  }
  if (driver && occupants.includes(driver) && !out.has(driver) && !taken.has(0) && n > 0) { out.set(driver, 0); taken.add(0); }
  for (const u of occupants) {
    if (out.has(u)) continue;
    let k = open0 ? 0 : 1;
    while (k < n && taken.has(k)) k++;
    if (k < n) { out.set(u, k); taken.add(k); }
  }
  return out;
}

/** Clip candidates per seat pose (the first the character has wins). */
export const SEAT_CLIPS = Object.freeze({
  paddle: ['kneel_shoot', 'crouch_idle'], row: ['sit'], floor: ['boat_sit', 'sit'], tube: ['sit'], bench: ['sit'], stand: ['idle'],
});
/**
 * Clip and placement for a seat pose. mode 'root': the figure's root on the seat point (floor / deck: the clip's own
 * pelvis height is authored); 'settle': the pelvis measured in the posed clip and put just above the seat point.
 * @param {string} pose @param {(name:string)=>boolean} [has] does the character have this clip
 * @returns {{clip: string, mode: 'root'|'settle'}}
 */
export function seatClip(pose, has = () => true) {
  const c = SEAT_CLIPS[pose] || ['sit'];
  const clip = c.find((n) => has(n)) || c[c.length - 1];
  const mode = pose === 'stand' || pose === 'paddle' || (pose === 'floor' && clip === 'boat_sit') ? 'root' : 'settle';
  return { clip, mode };
}

// ------------------------------------------------------------------ paddling (root-local: x his left, y up, z his front)

/** Paddle: T-grip to blade tip (m); the lower hand's grip down the shaft (m); the blade length (m). */
export const PADDLE = Object.freeze({ length: 1.45, lower: 0.5, blade: 0.44 });
/**
 * One stroke on his LEFT (s = +1; mirrored for the right). G = the top hand on the T-grip, T = where the blade points
 * (the paddle is rigid: the tip lies PADDLE.length from the grip along G→T), bend = forward lean, twist = shoulders
 * turned to his left, lean = body rolled out over the stroke side. Catch far forward, pull back to the hip, lift out,
 * raise the paddle upright in front of him (T-grip low, blade high — both fists keep it, clear of the men forward)
 * and bring it down on the other side's catch. The top hand reaches out over the side so the shaft stays steep,
 * clear of the side tube (crown ~0.30 at |x| 0.46, root-local here with the root at the floor).
 */
const STROKE = [
  { u: 0.00, G: [0.27, 1.00, 0.32], T: [1.18, -0.50, 0.85], bend: 0.32, twist: -0.30, lean: 0.18 },
  { u: 0.30, G: [0.30, 0.96, 0.08], T: [1.2, -0.50, 0.14], bend: 0.18, twist: -0.02, lean: 0.2 },
  { u: 0.55, G: [0.28, 0.95, -0.12], T: [1.12, -0.18, -0.60], bend: 0.10, twist: 0.25, lean: 0.14 },
  { u: 0.78, G: [0.02, 0.88, 0.22], T: [0.06, 2.10, 0.70], bend: 0.10, twist: 0.00, lean: 0.00 },
];
/** Pivoting: the recovery comes back to the same side (feathered forward, low over the water). */
const TURN_BACK = { G: [0.24, 1.10, 0.22], T: [1.25, 0.50, 0.90], bend: 0.20, twist: -0.12, lean: 0.14 };
/** At rest: the paddle across his thighs, both hands on the shaft (the top hand at his right). */
export const HOLD = Object.freeze({ G: [-0.42, 0.62, 0.30], T: [1.30, 0.58, 0.32], bend: 0.06, twist: 0, lean: 0, top: 'r', lowerAt: 0.75 });
/**
 * Raised upright before him, square to his front (the recovery's top: T-grip low at his chest, blade high): the way
 * the paddle goes between the rest hold and a stroke.
 */
export const UPRIGHT = Object.freeze({ G: [0, 0.88, 0.22], T: [0, 2.10, 0.70], bend: 0.10, twist: 0, lean: 0 });
/**
 * Phase at which the hands change over on the grip in the recovery: just after the paddle stands upright, its blade
 * tipping toward the next stroke's side. Later, the hand still low on the shaft would have to reach across his body
 * after the blade (out of reach on his left: the shaft was then laid through the fist wherever it fell short, down
 * through the port tube).
 */
export const SWITCH_U = 0.82;

const mirror = (k, s) => ({ G: [k.G[0] * s, k.G[1], k.G[2]], T: [k.T[0] * s, k.T[1], k.T[2]], bend: k.bend, twist: k.twist * s, lean: k.lean * s });
function mixKey(a, b, k) {
  return { G: a.G.map((v, i) => lerp(v, b.G[i], k)), T: a.T.map((v, i) => lerp(v, b.T[i], k)), bend: lerp(a.bend, b.bend, k),
    twist: lerp(a.twist, b.twist, k), lean: lerp(a.lean, b.lean, k) };
}

/**
 * Paddle pose at phase u (0..1) of a stroke on side s (+1 his left, −1 his right). `same`: the next stroke is on the
 * same side (pivoting). @returns {{G:number[], T:number[], bend:number, twist:number, lean:number, top:'l'|'r', wet:boolean}}
 */
export function paddleKey(u, s, same = false) {
  u = ((u % 1) + 1) % 1;
  const last = STROKE.length - 1;
  let k;
  if (u >= STROKE[last].u) {
    const to = same ? mirror(STROKE[0], s) : mirror(STROKE[0], -s);
    // pivoting: on from TURN_BACK, where the exit led (it used to restart from the exit here: a snap every stroke)
    const from = same ? mirror(TURN_BACK, s) : mirror(STROKE[last], s);
    k = mixKey(from, to, smooth((u - STROKE[last].u) / (1 - STROKE[last].u)));
  } else {
    let i = last;
    while (i > 0 && STROKE[i].u > u) i--;
    const a = STROKE[i], b = STROKE[i + 1];
    const bb = same && i + 1 === last ? TURN_BACK : b;
    k = mixKey(mirror(a, s), mirror(bb, s), smooth((u - a.u) / (b.u - a.u)));
  }
  // the hand on the grip is the one away from the stroke; it changes over as the raised paddle tips across (SWITCH_U)
  const top = (same || u < SWITCH_U ? s : -s) > 0 ? 'r' : 'l';
  return { ...k, top, wet: u < STROKE[2].u, lowerAt: PADDLE.lower };
}

/**
 * The paddler's pose: strokes while moving (phase u, side s, pivoting → same side), the rest hold when not, blended
 * by `act` (0 hold … 1 stroking). Between the two the paddle is raised UPRIGHT before him and brought down again —
 * never blended straight across: from the lap (blade on his left) to a stroke on his right that swept the blade
 * down through the floor, the thwart and the tubes, and into the man sitting before him. The hands change over up
 * there when the stroke wants the left one on the grip.
 */
export function paddlePose(u, s, same, act) {
  const k = paddleKey(u, s, same);
  if (act >= 0.999) return k;
  const h = { ...HOLD, wet: false };
  if (act <= 0.001) return h;
  const a = smooth(act);
  if (a < 0.5) {
    const b = a * 2;
    return { ...mixKey(HOLD, UPRIGHT, b), top: 'r', wet: false, lowerAt: lerp(HOLD.lowerAt, PADDLE.lower, b) };
  }
  const b = a * 2 - 1;
  return { ...mixKey(UPRIGHT, k, b), top: k.top, wet: k.wet && b > 0.5, lowerAt: PADDLE.lower };
}

// ------------------------------------------------------------------ rowing: the oars per side (art/oars.js)

/**
 * The two oars' keys at row phase u: forward strokes (moving), the inside oar's stroke shortened by `turn` (−1 … 1,
 * + = turning to starboard: the port oar pulls the long stroke), backing water when pivoting (`pivot`); blended from
 * the rest hold by `act` and from trailing (nobody at the oars) by `hold`. @returns {{1: object, '-1': object, bend:number}}
 * keyed by side (+1 port, −1 starboard).
 */
export function oarKeys(u, { act = 1, hold = 1, turn = 0, pivot = false } = {}) {
  const out = {};
  const fwd = rowKey(u);
  const mid = (ROW.catch + ROW.finish) / 2;
  for (const s of [1, -1]) {
    const inside = -s * turn;                              // > 0: this oar is on the inside of the turn
    const k = pivot && inside > 0 ? backKey(u) : { ...fwd };
    // a turn under way: the inside oar takes a short stroke; pivoting: both short (one pulls, one backs)
    if (pivot) k.sweep = mid + (k.sweep - mid) * 0.7;
    else if (inside > 0) k.sweep = mid + (k.sweep - mid) * (1 - 0.65 * clamp(inside, 0, 1));
    out[s] = mixOar(TRAIL, mixOar(EASY, k, smooth(act)), smooth(hold));
  }
  // pivoting, one oar pulls while the other backs: he sits up between the two (each hand reaches its own handle)
  const bend = pivot ? (out[1].bend + out[-1].bend) / 2 : lerp(EASY.bend, fwd.bend, smooth(act));
  out.bend = lerp(TRAIL.bend, bend, smooth(hold));
  return out;
}

// ------------------------------------------------------------------ boarding / leaving paths

/**
 * Path of a man getting in (from S, hull model space, to his seat Z) or out (Z → E): over the rim point R on the side
 * nearest the outside point. Segments: approach (walk / hoist from the water) S→R, step down R→Z, sit (or the reverse:
 * stand up, step over, walk off). Pure. @param {{x,y,z}} out the outside point @param {{x,y,z}} seat
 * @param {{l:number, w:number, rim:number}} hull
 * @returns {{R:{x,y,z}, inside:boolean, d1:number, d2:number, t1:number, t2:number, t3:number, dur:number}}
 */
export function boardPath(out, seat, hull) {
  const hl = hull.l / 2, hw = hull.w / 2;
  const inside = Math.abs(out.x) < hw + 0.1 && Math.abs(out.z) < hl + 0.1;
  let R;
  if (inside) R = { x: out.x, y: seat.floor ?? 0.02, z: out.z };
  else if (Math.abs(out.x) / hw >= Math.abs(out.z) / hl) R = { x: Math.sign(out.x) * (hw - 0.16), y: hull.rim, z: clamp(out.z, -hl + 0.45, hl - 0.45) };
  else R = { x: clamp(out.x, -hw + 0.3, hw - 0.3), y: hull.rim, z: Math.sign(out.z) * (hl - 0.16) };
  const d1 = Math.hypot(out.x - R.x, out.z - R.z), d2 = Math.hypot(R.x - seat.x, R.z - seat.z);
  const t1 = inside ? 0.2 : clamp(d1 / 1.4, out.wet ? 0.7 : 0.4, 1.6);
  const t2 = clamp(d2 / 1.3, 0.3, 1.4), t3 = 0.45;
  return { R, inside, d1, d2, t1, t2, t3, dur: t1 + t2 + t3 };
}

/**
 * Root placement along a boarding path at time t (s): {x, y, z, clip, face} where face = the point he walks toward
 * (null = turn to the seat's own heading). `dir` 'in' runs S→R→Z then sits; 'out' stands, Z→R→E.
 */
export function pathPoint(P, S, Z, t, dir = 'in') {
  const { R, t1, t2, t3 } = P;
  if (dir === 'out') {
    // stand up (t3), step over the side (t2), walk off (t1)
    if (t < t3) return { x: Z.x, y: lerp(Z.y, Z.floor ?? Z.y, smooth(t / t3)), z: Z.z, clip: 'stand', face: null };
    if (t < t3 + t2) {
      const k = smooth((t - t3) / t2);
      return { x: lerp(Z.x, R.x, k), y: lerp(Z.floor ?? Z.y, R.y, Math.sin(k * PI / 2)), z: lerp(Z.z, R.z, k), clip: 'walk', face: R };
    }
    const k = clamp((t - t3 - t2) / t1, 0, 1);
    return { x: lerp(R.x, S.x, k), y: lerp(R.y, S.y, smooth(k)), z: lerp(R.z, S.z, k), clip: k < 1 ? 'walk' : 'stand', face: S };
  }
  if (t < t1) {
    const k = clamp(t / t1, 0, 1);
    // from the water he hauls himself up onto the tube (late, fast); from the bank he steps up onto it
    const ky = S.wet ? smooth((k - 0.25) / 0.75) : Math.sin(k * PI / 2);
    return { x: lerp(S.x, R.x, smooth(k)), y: lerp(S.y, R.y, ky), z: lerp(S.z, R.z, smooth(k)), clip: S.wet ? 'hoist' : 'walk', face: R };
  }
  if (t < t1 + t2) {
    const k = smooth((t - t1) / t2);
    return { x: lerp(R.x, Z.x, k), y: lerp(R.y, Z.floor ?? Z.y, smooth(k * 1.4)), z: lerp(R.z, Z.z, k), clip: 'walk', face: Z };
  }
  const k = smooth((t - t1 - t2) / t3);
  return { x: Z.x, y: lerp(Z.floor ?? Z.y, Z.y, k), z: Z.z, clip: 'seat', face: null };
}

// ------------------------------------------------------------------ props

let PADDLE_GEO = null;
/** Low-poly single-bladed paddle: origin at the T-grip, shaft down −Y, blade face +Z, tip at y = −PADDLE.length. */
export function makePaddle() {
  if (!PADDLE_GEO) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a3a30, roughness: 0.8 });
    const L = PADDLE.length, B = PADDLE.blade;
    const shaft = new THREE.CylinderGeometry(0.016, 0.018, L - B + 0.04, 6, 1); shaft.translate(0, -(L - B + 0.04) / 2 - 0.02, 0);
    const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.11, 5); grip.rotateZ(PI / 2); grip.translate(0, -0.01, 0);
    const sh = new THREE.Shape();
    sh.moveTo(-0.03, 0); sh.lineTo(0.03, 0); sh.quadraticCurveTo(0.085, -0.06, 0.085, -0.16); sh.lineTo(0.08, -B + 0.06);
    sh.quadraticCurveTo(0.07, -B, 0, -B); sh.quadraticCurveTo(-0.07, -B, -0.08, -B + 0.06); sh.lineTo(-0.085, -0.16); sh.quadraticCurveTo(-0.085, -0.06, -0.03, 0);
    const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false, curveSegments: 3 });
    blade.translate(0, -(L - B), -0.006);
    PADDLE_GEO = { wood, shaft, grip, blade };
  }
  const G = PADDLE_GEO;
  const g = new THREE.Group(); g.name = 'prop_paddle';
  for (const geo of [G.shaft, G.grip, G.blade]) { const m = new THREE.Mesh(geo, G.wood); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

let OAR_GEO = null;
/**
 * Low-poly oar (art/oars.js OAR): origin at the thole pivot, the loom along +X (pivot → blade), the handle at
 * x −inboard … −inboard + grip, a leather sleeve where it bears on the pins, the square blade in the X-Y plane
 * (feathering turns it about X).
 */
export function makeOar() {
  if (!OAR_GEO) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.85 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.7 });
    const out = OAR.length - OAR.inboard, b0 = out - OAR.blade, h0 = -OAR.inboard + OAR.grip;
    const along = (geo, x0, x1) => { geo.rotateZ(-PI / 2); geo.translate((x0 + x1) / 2, 0, 0); return geo; };
    const loom = along(new THREE.CylinderGeometry(0.019, 0.024, b0 + 0.02 - h0, 7, 1), h0, b0 + 0.02);
    const handle = along(new THREE.CylinderGeometry(0.017, 0.017, OAR.grip, 6, 1), -OAR.inboard, h0);
    const sleeve = along(new THREE.CylinderGeometry(0.029, 0.029, 0.2, 7, 1), -0.09, 0.11);
    const sh = new THREE.Shape(), w = OAR.bladeW / 2;
    sh.moveTo(0, -0.02); sh.lineTo(0.08, -w * 0.8); sh.lineTo(OAR.blade - 0.04, -w); sh.quadraticCurveTo(OAR.blade, -w, OAR.blade, 0);
    sh.quadraticCurveTo(OAR.blade, w, OAR.blade - 0.04, w); sh.lineTo(0.08, w * 0.8); sh.lineTo(0, 0.02); sh.lineTo(0, -0.02);
    const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false, curveSegments: 2 });
    blade.translate(b0, 0, -0.007);
    const pin = new THREE.CylinderGeometry(0.013, 0.015, 0.16, 6, 1); pin.translate(0, 0.08, 0);
    OAR_GEO = { wood, leather, loom, handle, sleeve, blade, pin };
  }
  const G = OAR_GEO;
  const g = new THREE.Group(); g.name = 'prop_oar';
  for (const [geo, mat] of [[G.loom, G.wood], [G.handle, G.wood], [G.sleeve, G.leather], [G.blade, G.wood]]) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  return g;
}
/** A pair of thole pins on the gunwale either side of an oar's pivot (hull space, side s). */
function makeTholes(s) {
  makeOar();
  const g = new THREE.Group(); g.name = 'prop_tholes';
  for (const dz of [-0.045, 0.045]) {
    const m = new THREE.Mesh(OAR_GEO.pin, OAR_GEO.wood); m.castShadow = true;
    m.position.set(s * OAR.pivot[0], OAR.gunwale - 0.01, OAR.pivot[2] + dz);
    g.add(m);
  }
  return g;
}

const _ox = new THREE.Vector3(), _oy = new THREE.Vector3(), _oz = new THREE.Vector3(), _om = new THREE.Matrix4();
/**
 * Shipped (an empty boat): each oar lifted out of its pins and laid fore-and-aft over the thwarts along its side,
 * handle aft, blade forward on edge — inside the hull from z −1.3 to 1.3 (the hull's inner half-breadth there is
 * ≥ 0.43 at this height, rowboat.py stations). Hull space of the oar's pivot point and its +X (loom) axis.
 */
export const SHIPPED = Object.freeze({ x: 0.4, y: 0.425, z: -1.3 + OAR.inboard });
const _shipQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
const _sp = new THREE.Vector3(), _sq = new THREE.Quaternion();
/**
 * Pose an oar object (hull space, child of the hull group) at side s: sweep / pitch about its pivot, feathered; with
 * `ship` > 0 blended toward its shipped place inside the boat (SHIPPED).
 */
export function setOar(obj, s, sweep, pitch, feather, ship = 0) {
  const d = oarDir(s, sweep, pitch);
  _ox.set(d[0], d[1], d[2]);
  _oy.set(0, 1, 0).addScaledVector(_ox, -_ox.y).normalize();                 // square: blade face upright
  _oz.crossVectors(_ox, _oy);
  const f = feather * s;
  _oy.multiplyScalar(Math.cos(f)).addScaledVector(_oz, Math.sin(f));          // feathered about the loom
  _oz.crossVectors(_ox, _oy);
  _om.makeBasis(_ox, _oy, _oz);
  obj.quaternion.setFromRotationMatrix(_om);
  obj.position.set(s * OAR.pivot[0], OAR.pivot[1], OAR.pivot[2]);
  if (ship > 0.001) {
    const k = smooth(ship);
    _sp.set(s * SHIPPED.x, SHIPPED.y, SHIPPED.z);
    // lifted on the way so it clears the gunwale: up by 0.25 m at mid-blend
    obj.position.lerp(_sp, k).y += 0.25 * Math.sin(PI * k);
    obj.quaternion.slerp(_sq.copy(_shipQ), k);
  }
  obj.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ skeleton overlays

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const SPINE = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];
const DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const FINGER_BONES = [];
for (const s of ['l', 'r']) for (const d of DIGITS) for (const j of ['01', '02', '03']) FINGER_BONES.push(`${d}_${j}_${s}`);
const ARMS = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', ...FINGER_BONES];
const LEGS = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
/**
 * Palm-normal sign per hand (ca_ik handFrame: n = finger axis × knuckle line · sign), measured once per skeleton in
 * the clip's pose: the thumb sits on the palm side of the knuckles. The UAL hands are mirror images (left +1, right
 * −1 on the commandos' kits), the fallback when the thumb test is inconclusive.
 */
const PSIGN = new WeakMap();
export function palmSign(B) {
  let ps = PSIGN.get(B);
  if (ps) return ps;
  ps = { l: 1, r: -1 };
  for (const s of ['l', 'r']) {
    if (!B['thumb_02_' + s] || !B['index_01_' + s] || !B['pinky_01_' + s]) continue;
    const { n } = handFrame(B, s, 1);
    const km = wpos(B['index_01_' + s]).lerp(wpos(B['pinky_01_' + s]), 0.5);
    const d = n.dot(wpos(B['thumb_02_' + s]).sub(km));
    if (Math.abs(d) > 0.006) ps[s] = d > 0 ? 1 : -1;
  }
  PSIGN.set(B, ps);
  return ps;
}
/**
 * Where a bar held in the fist runs (hand-bone frame): this far from the wrist toward the middle knuckle, this far
 * out on the palm side — the oar handle / paddle shaft axis inside the closed fingers.
 */
export const GRIP = Object.freeze({ t: 0.82, off: 0.032 });
/** Finger flexion per joint (rad) for a fist round a ~4 cm bar; the thumb's turn per joint (01, 02, 03) is capped by `thumb`. */
export const CURL = { j: [1.2, 1.35, 0.85], thumb: [0.5, 0.7, 0.7] };

/** Rotate bone b by `angle` about the WORLD axis `axis`. */
function turnWorld(b, axis, angle) {
  if (!b || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_q2);
  const local = _a.copy(axis).applyQuaternion(_q2.invert()).normalize();
  _q.setFromAxisAngle(local, angle);
  b.quaternion.premultiply(_q);
  b.updateMatrixWorld(true);
}

/** Torso: forward bend, shoulders turned, rolled out sideways (root-local frame axes in world). */
function torso(B, bend, twist, lean) {
  const bendAxis = _b.copy(_l).negate();
  for (const [n, k] of SPINE) {
    const b = B[n]; if (!b) continue;
    turnWorld(b, bendAxis, -bend * k);
    turnWorld(b, _u, twist * k);
    turnWorld(b, _f, -lean * k);
  }
  if (B.neck_01) turnWorld(B.neck_01, bendAxis, 0.6 * bend * 0.4); // the head stays up, eyes ahead
}

function frameAxes(root) {
  root.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q); _l.set(1, 0, 0).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q);
}

/** Elbow pole of arm s: out to his side, down and back. */
function elbowPole(B, s) {
  const sg = s === 'l' ? 1 : -1;
  return wpos(B['upperarm_' + s]).addScaledVector(_l, 0.5 * sg).addScaledVector(_u, -0.6).addScaledVector(_f, -0.2);
}

/** Shoulder → grip point reach of arm s, fully stretched (m). */
function armReach(B, s) {
  const a = wpos(B['upperarm_' + s]), b = wpos(B['lowerarm_' + s]), c = wpos(B['hand_' + s]);
  return a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(gripPoint(B, s));
}

/** Two-bone arm IK: hand `s` to world point p, elbow out to the side and down. */
function arm(B, s, p) {
  twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], p, elbowPole(B, s));
}

/** The grip point of hand s (world): the axis of a bar held in its fist (GRIP). */
export function gripPoint(B, s, out = new THREE.Vector3()) {
  const { n } = handFrame(B, s, palmSign(B)[s]);
  return out.copy(wpos(B['hand_' + s])).lerp(wpos(B['middle_01_' + s]), GRIP.t).addScaledVector(n, GRIP.off);
}

/**
 * Close the fingers of hand s round a bar (k = 0 open as the clip has them … 1 a fist): the four fingers flexed toward
 * the palm, the thumb wrapped over the bar (a short CCD bringing its tip against the bar on the fingers' side) when
 * the bar (point g, axis a) is given.
 */
export function curlFingers(B, s, k = 1, g = null, a = null) {
  if (k <= 0.001 || !B['index_01_' + s]) return;
  const { f, n } = handFrame(B, s, palmSign(B)[s]);
  const ax = new THREE.Vector3().crossVectors(f, n).normalize();       // flexion turns the fingers toward the palm
  for (const d of ['index', 'middle', 'ring', 'pinky']) CURL.j.forEach((an, i) => turnWorld(B[`${d}_0${i + 1}_${s}`], ax, an * k));
  const tip = B['thumb_04_leaf_' + s] || B['thumb_03_' + s];
  if (!g || !a || !tip || !B['thumb_01_' + s]) return;
  for (let it = 0; it < 2; it++) {
    for (const j of ['03', '02', '01']) {
      const b = B[`thumb_${j}_${s}`]; if (!b || b === tip) continue;
      const tp = wpos(tip), c = tp.clone().sub(g), on = g.clone().addScaledVector(a, c.dot(a));
      const want = on.addScaledVector(n, -0.022);                       // against the bar, round on the fingers' side
      const jp = wpos(b), from = tp.sub(jp), to = want.sub(jp);
      if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) continue;
      _q.setFromUnitVectors(from.normalize(), to.normalize());
      const ang = 2 * Math.acos(clamp(_q.w, -1, 1));
      if (ang < 1e-4) continue;
      const lim = Math.min(ang, CURL.thumb[['01', '02', '03'].indexOf(j)] * 1.6) * k;
      const axis = new THREE.Vector3(_q.x, _q.y, _q.z).normalize();
      turnWorld(b, axis, lim);
    }
  }
}

/**
 * Hand s round a bar: its grip point (GRIP) onto world point g, the bar along world axis a, the palm facing `pn`
 * (made ⟂ a), the fingers across the bar on the side nearest the clip's and closed round it; elbow toward `pole`.
 * w < 1 blends from the clip's hand (position, rotation, fingers). @returns {number} grip error (m)
 */
export function gripBar(B, s, g, a, pn, pole, w = 1, curl = true) {
  const hand = B['hand_' + s];
  const ps = palmSign(B)[s];
  const n = pn.clone().addScaledVector(a, -pn.dot(a)).normalize();
  const cur = handFrame(B, s, ps);
  const fd = new THREE.Vector3().crossVectors(n, a).normalize();
  if (fd.dot(cur.f) < 0) fd.negate();
  let q = handQuat(B, s, ps, fd, n);
  if (w < 0.999) q = wquat(hand).slerp(q, w);
  const tgt = w < 0.999 ? gripPoint(B, s).lerp(g, w) : g.clone();
  for (let i = 0; i < 2; i++) {
    const off = gripPoint(B, s).sub(wpos(hand)).applyQuaternion(wquat(hand).invert()).applyQuaternion(q);
    twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], hand, tgt.clone().sub(off), pole, q);
  }
  if (curl) curlFingers(B, s, w, tgt, a);
  return gripPoint(B, s).distanceTo(tgt);
}

/**
 * Seated legs on the hull: each ankle to its seat spot (`feet.l/r` hull space, blended by w from the clip), the knee
 * bent up toward his front (or down onto the floor: `kneeL/R` 'down'), the foot turned as the clip holds it but
 * pitched up when its toes would dip under the spot's `toe` height. @returns {boolean}
 */
export function fitLegs(m, hullObj, feet, w = 1, guard = null) {
  const B = m.real?.inner?.bones;
  if (!B?.thigh_l || !feet || w <= 0.001) return false;
  for (const n of LEGS) if (B[n]) guard?.touch(B[n]);
  const root = m._body?.() || m.root;
  m.root.updateWorldMatrix(true, true); // the hull moved this frame: fresh matrices from the vehicle root down
  frameAxes(root);
  hullObj.updateWorldMatrix(true, false);
  const up = _b.set(0, 1, 0).transformDirection(hullObj.matrixWorld).clone();
  for (const s of ['l', 'r']) {
    const spot = feet[s];
    if (!spot) continue;
    const foot = B['foot_' + s], keep = wquat(foot);
    const want = hullObj.localToWorld(new THREE.Vector3(spot[0], spot[1], spot[2]));
    const tgt = w < 0.999 ? wpos(foot).lerp(want, w) : want;
    const down = feet['knee' + s.toUpperCase()] === 'down';
    const knee = wpos(B['calf_' + s]);
    const pole = down ? knee.addScaledVector(up, -0.5).addScaledVector(_f, 0.1) : knee.addScaledVector(up, 0.35).addScaledVector(_f, 0.35);
    twoBoneIKPole(B['thigh_' + s], B['calf_' + s], foot, tgt, pole, keep);
    const toeY = spot[3];
    const toeB = B['ball_leaf_' + s] || B['ball_' + s];
    if (toeY != null && toeB) {                                // toes clear of the floor / tube under them
      const ank = hullObj.worldToLocal(wpos(foot)), toe = hullObj.worldToLocal(wpos(toeB));
      const fv = toe.clone().sub(ank), len = fv.length();
      if (toe.y < toeY && len > 0.02) {
        const want = Math.asin(clamp((toeY - ank.y) / len, -1, 1)), now = Math.asin(clamp(fv.y / len, -1, 1));
        const axW = wpos(toeB).sub(wpos(foot)).cross(up).normalize();
        turnWorld(foot, axW, (want - now) * w);
      }
    }
  }
  return true;
}

/**
 * Write the paddling pose on the model's bones and place the paddle (root-local key P from paddlePose; w = weight of
 * the paddling arms over the clip's own — 0 while getting in). Both fists close on the paddle: the top hand round the
 * T-grip, the lower hand round the shaft; the paddle is then laid through both grip points (the hands never slip off
 * it, wherever the arm IK fell short). @returns {boolean} pose written
 */
export function applyPaddlePose(m, P, paddle, guard, w = 1) {
  const B = m.real?.inner?.bones;
  if (!B || !B.hand_r || !B.hand_l || !B.upperarm_l || w <= 0.001) { if (paddle) paddle.visible = false; return false; }
  for (const n of ARMS) if (B[n]) guard?.touch(B[n]);
  const root = m._body?.() || m.root;
  m.root.updateWorldMatrix(true, true); // the hull moved this frame: fresh matrices from the vehicle root down
  frameAxes(root);
  torso(B, P.bend * w, P.twist * w, P.lean * w);
  const G = root.localToWorld(new THREE.Vector3(...P.G)), Tt = root.localToWorld(new THREE.Vector3(...P.T));
  const dir = Tt.sub(G).normalize();
  const top = P.top || 'r', low = top === 'r' ? 'l' : 'r';
  const lowAt = P.lowerAt ?? PADDLE.lower;
  // the paddle's frame: −Y along the shaft (grip → tip), +Z (blade face) toward his front, X along the T-grip
  const frame = (d) => {
    const y = d.clone().negate();
    const z = _a.copy(_f).addScaledVector(y, -_f.dot(y));
    if (z.lengthSq() < 1e-6) z.copy(_u).addScaledVector(y, -_u.dot(y));
    z.normalize();
    return { x: new THREE.Vector3().crossVectors(y, z).normalize(), y, z: z.clone() };
  };
  const F = frame(dir);
  // top hand: palm down onto the T-grip (along the paddle's x), lower hand: palm toward the shaft from his side
  gripBar(B, top, G, F.x, dir, elbowPole(B, top), w);
  // the lower hand on the shaft: where the key puts it, else slid along the shaft to the nearest spot his arm
  // reaches (the recovery swings the paddle high across him)
  const shL = wpos(B['upperarm_' + low]);
  const lowAtP = (at) => G.clone().addScaledVector(dir, at);
  let at = lowAt, eLow = gripBar(B, low, lowAtP(at), dir, lowAtP(at).sub(shL), elbowPole(B, low), w, false);
  if (eLow > 0.008 && w > 0.5) {
    for (const d of [0.08, -0.08, 0.16, -0.16, 0.24, -0.24, 0.32, -0.3]) {
      const a2 = clamp(lowAt + d, 0.16, 0.8);
      const e2 = gripBar(B, low, lowAtP(a2), dir, lowAtP(a2).sub(shL), elbowPole(B, low), w, false);
      if (e2 < eLow) { eLow = e2; at = a2; }
      if (e2 < 0.008) break;
    }
    if (eLow > 0.008 || at !== lowAt) eLow = gripBar(B, low, lowAtP(at), dir, lowAtP(at).sub(shL), elbowPole(B, low), w, false);
  }
  curlFingers(B, low, w, gripPoint(B, low), dir);
  if (paddle) {
    paddle.visible = w > 0.5;
    const gt = gripPoint(B, top), gl = gripPoint(B, low);
    const d2 = gl.clone().sub(gt);
    const dd = d2.length() > 0.08 && d2.dot(dir) > 0 ? d2.normalize() : dir;   // through both fists
    const F2 = frame(dd);
    _m.makeBasis(F2.x, F2.y, F2.z).setPosition(gt);
    _inv.copy(paddle.parent.matrixWorld).invert();
    _m.premultiply(_inv);
    _m.decompose(paddle.position, paddle.quaternion, paddle.scale);
    paddle.updateMatrixWorld(true);
  }
  return true;
}

/**
 * Oarsman: torso lean `bend` toward his front (the stern), a fist round each oar's handle — `oars` [{s, key, obj}]
 * (side +1 port / −1 starboard, the oar key, its object) in the hull group `hullObj`; with the hands on (w ≈ 1) each
 * oar is then laid from its pivot through the fist that holds it. @returns {{err:number, hand:object}|null}
 */
export function applyRowPose(m, hullObj, oars, bend, guard, w = 1) {
  const B = m.real?.inner?.bones;
  if (!B || !B.hand_r || !B.hand_l || !B.upperarm_l || !oars || w <= 0.001) return null;
  for (const n of ARMS) if (B[n]) guard?.touch(B[n]);
  const root = m._body?.() || m.root;
  m.root.updateWorldMatrix(true, true); // the hull moved this frame: fresh matrices from the vehicle root down
  frameAxes(root);
  hullObj.updateWorldMatrix(true, false);
  // which fist holds which oar: the hand on that side of the boat (he faces aft: his right on the port oar)
  const xr = hullObj.worldToLocal(wpos(B.upperarm_r)).x, xl = hullObj.worldToLocal(wpos(B.upperarm_l)).x;
  const handOf = (s) => ((xr > xl) === (s > 0) ? 'r' : 'l');
  torso(B, bend * w, 0, 0);
  const down = _b.set(0, -1, 0).transformDirection(hullObj.matrixWorld).clone();
  let err = 0;
  const hand = {};
  for (const o of oars) {
    const h = handOf(o.s), P = oarPoints(o.s, o.key.sweep, o.key.pitch);
    const g = hullObj.localToWorld(new THREE.Vector3(...P.hand));
    const a = new THREE.Vector3(...P.dir).transformDirection(hullObj.matrixWorld);
    const pn = down.clone().multiplyScalar(0.85).addScaledVector(_f, 0.35);   // overhand: palm down onto the loom
    o.err = gripBar(B, h, g, a, pn, elbowPole(B, h), w);
    err = Math.max(err, o.err);
    hand[o.s] = h;
    if (w > 0.98 && o.obj) {                                                    // the oar through his fist
      const q = hullObj.worldToLocal(gripPoint(B, h));
      const ang = oarAnglesThrough(o.s, [q.x, q.y, q.z]);
      setOar(o.obj, o.s, ang.sweep, ang.pitch, o.key.feather);
      o.reach = ang.reach;
    }
  }
  return { err, hand };
}

// ------------------------------------------------------------------ the crew

const HIP_ABOVE_SEAT = 0.1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _lq = new THREE.Quaternion();
/**
 * The raft's starboard paddle stowed (raft.py: the paddle node pivots at its rowlock, its shaft along d from the
 * T-grip end 0.55 inboard to the tip 1.05 outboard, the blade flat): lifted out of the rowlock and laid along the
 * crown of the starboard tube, T-grip aft, blade forward — inside the boat, clear of the paddler's strokes.
 */
export const STOW = (() => {
  const piv = new THREE.Vector3(-0.6, 0.32, -0.55);
  const d0 = new THREE.Vector3(-0.85, -0.42, -0.30).normalize();          // rest shaft, T-grip → tip
  const grip0 = d0.clone().multiplyScalar(-0.55);                           // node-local T-grip end
  const A = new THREE.Vector3(-0.37, 0.337, -0.9), Bp = new THREE.Vector3(-0.38, 0.337, 0.7);
  const d1 = Bp.clone().sub(A).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(d0, d1);
  const up = new THREE.Vector3(0, 1, 0);
  const n0 = up.clone().addScaledVector(d0, -d0.y).normalize().applyQuaternion(q1); // the blade face normal, carried
  const n1 = up.clone().addScaledVector(d1, -d1.y).normalize();                     // … rolled to lie flat
  const roll = Math.atan2(new THREE.Vector3().crossVectors(n0, n1).dot(d1), n0.dot(n1));
  const q = new THREE.Quaternion().setFromAxisAngle(d1, roll).multiply(q1);
  const off = A.clone().sub(piv).sub(grip0.clone().applyQuaternion(q));
  /** where a node-local point of the paddle ends up, stowed (hull space) */
  const at = (local) => new THREE.Vector3(...local).applyQuaternion(q).add(piv).add(off);
  return { q, off, d0, at };
})();

/** Clearance a paddle blade in its rowlock keeps over the ground under it (m). */
export const BLADE_CLEAR = 0.012;

/**
 * A paddle in its rowlock on a boat resting on the ground (art/boat-rest.js): at rest its blade hangs over the side
 * into the water, so on a bank or a beach it would go into the ground. The paddle swings up about its rowlock (an
 * axis across its shaft) just far enough for every point of the blade to clear the ground under it: the blade lies
 * on the bank. Measured once from the node at rest (LOD0); posed on every LOD through `vis.posePart`.
 * @param {object} vis vehicle visual (parts, posePart) @param {string} name paddle part node
 * @returns {{name:string, lift:(groundAt:(x:number,z:number)=>number) => number}|null} lift → the angle (rad) needed
 */
export function rowlockFit(vis, name) {
  const node = vis?.parts?.[name];
  if (!node) return null;
  const restQ = node.quaternion.clone(), restP = node.position.clone();
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), m = new THREE.Matrix4(), p = new THREE.Vector3(), all = [];
  node.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) all.push(p.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  if (!all.length) return null;
  // the blade: the far end of the shaft from the rowlock (node origin)
  const far = all.reduce((a, b) => (b.lengthSq() > a.lengthSq() ? b : a)), d = far.clone().normalize(), reach = far.length();
  const blade = all.filter((q) => q.dot(d) > reach * 0.6);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(restQ.clone().invert());
  const axis = new THREE.Vector3().crossVectors(d, up);
  if (axis.lengthSq() < 1e-8) return null;
  axis.normalize();
  const q = new THREE.Quaternion(), w = new THREE.Vector3();
  /** lowest clearance of the blade over the ground with the paddle swung up by `a` rad */
  const clear = (a, groundAt) => {
    q.setFromAxisAngle(axis, a).premultiply(restQ);
    let c = Infinity;
    for (const b of blade) {
      w.copy(b).applyQuaternion(q).add(restP).applyMatrix4(node.parent.matrixWorld);
      const g = groundAt(w.x, w.z);
      if (g > -1e6) c = Math.min(c, w.y - g);
    }
    return c;
  };
  return {
    name, axis, blade: blade.length,
    lift(groundAt) {
      node.parent.updateWorldMatrix(true, false);
      if (clear(0, groundAt) >= BLADE_CLEAR) return 0;
      let lo = 0, hi = 0.05;
      while (hi < 1.4 && clear(hi, groundAt) < BLADE_CLEAR) { lo = hi; hi += 0.05; }
      for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (clear(mid, groundAt) < BLADE_CLEAR) lo = mid; else hi = mid; }
      return hi;
    },
    /** the rotation (node-local) for a lift angle */
    quat(a, out = new THREE.Quaternion()) { return out.setFromAxisAngle(axis, a); },
  };
}

/**
 * Boat crew figures for a vehicle (or null when there is nothing to draw: no seats, library model missing).
 * @param {object} v Vehicle entity (boat without crew records)
 * @param {{createUnitModel:Function, lookOf:Function}} deps
 * @returns {{figures:object[], occupants:Map<object,object>, update:(dt:number)=>void, dispose:()=>void}|null}
 */
export function createBoatCrew(v, deps) {
  const model = v.model, vis = model?.visual;
  if (!vis?.object3d || !model.libType) return null;
  const layout = boatLayout(model.libType, vis.meta);
  if (!layout.seats.length) return null;
  const group = new THREE.Group(); group.name = 'boatcrew';
  vis.object3d.add(group);
  const hull = { l: model.dims?.l || v.def.size[0], w: model.dims?.w || v.def.size[1], rim: layout.rim };
  if (model.libType === 'raft') { hull.l = 2.7; hull.w = 1.3; } // the sidecar's measured box includes the shipped paddles
  const figs = new Map(); // unit → figure (aboard, or stepping out)
  let seats = new Map();
  const rig = { paddleT: 0, rowT: 0, act: 0, lastH: v.heading, yawRate: 0, takenL: false, rowAct: 0, hold: 0, ship: null };
  // the raft's paddles in their rowlocks (posed at rest now): swung up off the ground when the raft lies on a bank
  const locks = model.libType === 'raft' ? ['paddle_l', 'paddle_r'].map((n) => rowlockFit(vis, n)).filter(Boolean) : [];
  rig.lift = Object.fromEntries(locks.map((f) => [f.name, 0]));
  const open0 = !v.driveable || !(v.def.operators || []).length;
  // the rowboat's oars: ours (between the thole pins aft of the oarsman), the model's own pair hidden
  const oars = model.libType === 'rowboat' && vis.parts?.oar_r ? [1, -1].map((s) => {
    const obj = makeOar(); obj.name = s > 0 ? 'oar_port' : 'oar_starboard';
    group.add(obj); group.add(makeTholes(s));
    return { s, obj, key: { ...TRAIL } };
  }) : null;
  if (oars) { vis.showPart?.('oar_l', false); vis.showPart?.('oar_r', false); }

  const toLocal = (x, y, z) => { vis.object3d.updateWorldMatrix(true, false); return vis.object3d.worldToLocal(_v.set(x, y, z)).clone(); };
  const groundAt = (x, z) => v.world?.groundY?.(x, z) ?? 0;
  const terrainAt = (x, z) => v.world?.grid?.terrainAt?.(x, z);
  const wetAt = (x, z) => { const t = terrainAt(x, z); return t === TERRAIN.WATER || t === TERRAIN.SHALLOW; };
  /** Outside point (world x, z) in hull space, with the height a man stands at there. */
  const outside = (x, z, swim) => {
    const wet = swim || wetAt(x, z);
    const hy = vis.object3d.getWorldPosition(_w).y;
    const y = swim ? hy - 1.05 : wet ? Math.max(groundAt(x, z), hy - 0.55) : groundAt(x, z);
    const p = toLocal(x, y, z);
    return { x: p.x, y: p.y, z: p.z, wet };
  };

  function seatTarget(f) {
    const s = layout.seats[f.k];
    const yaw = s.yaw || 0;
    if (f.place) return { x: f.place.x, y: f.place.y, z: f.place.z, floor: f.floor, yaw };
    // before measuring: the root of a seated clip sits ~0.5 m under and ~0.27 m ahead of the pelvis
    if (f.mode === 'settle') return { x: s.p[0] + Math.sin(yaw) * 0.27, y: s.p[1] - 0.55, z: s.p[2] + Math.cos(yaw) * 0.27, floor: f.floor, yaw };
    return { x: s.p[0], y: s.p[1], z: s.p[2], floor: f.floor, yaw };
  }

  /** Measure where the root goes so the pelvis sits just above the seat (clip posed, root at the seat yaw). */
  function measure(f) {
    const s = layout.seats[f.k], root = f.m.root;
    const pel = f.m.real?.getSocket?.('pelvis');
    if (f.mode !== 'settle' || !pel) { f.place = { x: s.p[0], y: s.p[1], z: s.p[2] }; return; }
    const keep = root.position.clone(), keepYaw = root.rotation.y;
    root.position.set(0, 0, 0); root.rotation.y = s.yaw || 0;
    group.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const lp = group.worldToLocal(pel.getWorldPosition(_v));
    f.place = { x: s.p[0] - lp.x, y: s.p[1] - (lp.y - HIP_ABOVE_SEAT), z: s.p[2] - lp.z };
    root.position.copy(keep); root.rotation.y = keepYaw;
  }

  function setClip(f, name) {
    if (f.clipNow === name) return;
    f.clipNow = name;
    const has = (n) => !!f.m.real?.hasAnim?.(n);
    const pick = name === 'seat' ? f.clip : name === 'stand' ? 'idle' : name === 'hoist' ? (has('crouch_idle') ? 'crouch_idle' : 'idle') : name;
    f.m.setAnim(pick, { loop: true });
  }

  function newFigure(u, k) {
    const m = deps.createUnitModel(deps.lookOf(u));
    if (!m.isReal) { m.dispose?.(); return null; }
    const s = layout.seats[k];
    const f = { u, k, m, pose: s.pose, clip: null, mode: 'root', floor: s.pose === 'stand' ? s.p[1] : layout.rim > 0.45 ? 0.05 : 0.02,
      tr: null, place: null, t: 0, ready: false, clipNow: null, yaw: s.yaw || 0, out: false, paddle: null };
    m.root.visible = false;
    group.add(m.root);
    // a boat figure always carries an overlay: weapons stay stowed (unit-model _wantWeapon), legs fitted, arms paddle / row
    m.overlay = (mm, dt, guard) => overlay(f, guard);
    const bf = u.boardFrom, now = v.world?.time ?? 0;
    f.from = bf && now - bf.t < 1.5 && now > 0.5 && !u.downed && Math.hypot(bf.x - v.x, bf.z - v.z) < 6 ? { ...bf } : null;
    return f;
  }

  function start(f) { // the model is ready: pick the clip, place the figure (or begin the step-in)
    const has = (n) => !!f.m.real?.hasAnim?.(n);
    const sc = seatClip(f.pose, has);
    f.clip = sc.clip; f.mode = sc.mode; f.ready = true;
    const Z = seatTarget(f);
    if (f.from) {
      const S = outside(f.from.x, f.from.z, f.from.swim);
      f.tr = { dir: 'in', t: 0, S, P: boardPath(S, Z, hull) };
      f.m.root.position.set(S.x, S.y, S.z);
      f.m.root.rotation.y = Math.atan2(f.tr.P.R.x - S.x, f.tr.P.R.z - S.z);
      setClip(f, S.wet ? 'hoist' : 'walk');
    } else {
      setClip(f, 'seat');
      f.m.root.position.set(Z.x, Z.y, Z.z); f.m.root.rotation.y = Z.yaw;
      f.tr = { dir: 'sit', t: 0 }; // hidden until the clip has blended in, then measured
    }
  }

  function beginOut(f) {
    const u = f.u;
    if (!f.ready || u.alive === false || u.downed || u.diving || u.stance === 'dive' || u.underwater || !Number.isFinite(u.x) || v.destroyed) return false;
    if (Math.hypot(u.x - v.x, u.z - v.z) > 7) return false;
    const E = outside(u.x, u.z, false);
    const Z = { ...seatTarget(f), x: f.m.root.position.x, y: f.m.root.position.y, z: f.m.root.position.z };
    f.tr = { dir: 'out', t: 0, S: E, Z, P: boardPath(E, Z, hull), x0: u.x, z0: u.z };
    f.out = true;
    if (u.object3d) u.object3d.visible = false; // his own model takes over where the figure stops
    return true;
  }

  function finishOut(f) {
    const u = f.u;
    if (u.object3d && u.state !== 'inVehicle' && !u.vehicle && !u.buried && u.state !== 'jailed') u.object3d.visible = true;
    drop(f);
  }

  function drop(f) {
    if (f.paddle) { f.paddle.removeFromParent(); f.paddle = null; }
    f.m.overlay = null;
    f.m.dispose(); f.m.root.removeFromParent();
    figs.delete(f.u);
  }

  function sync() {
    const list = (v.occupants || []).filter((u) => u.alive !== false);
    seats = assignBoatSeats(seats, list, v.driver, layout.seats.length, open0);
    for (const [u, f] of figs) {
      if (f.out) continue;
      if (!list.includes(u) || seats.get(u) !== f.k) { if (!(u.vehicle !== v && beginOut(f))) drop(f); }
    }
    for (const [u, k] of seats) {
      if (figs.has(u)) continue;
      const f = newFigure(u, k);
      if (f) figs.set(u, f);
    }
  }

  /** Where the paddle stroke stands: from the wake's clock when it runs, else our own (same period). */
  function stroke(dt) {
    const w = v.world?.water?.wakes?.strokeOf?.(v);
    const moving = (v.speed || 0) > 0.15 || !!w?.moving;
    const turning = !moving && Math.abs(rig.yawRate) > 0.5;
    rig.act = clamp(rig.act + (moving || turning ? 1 : -1) * dt / 0.35, 0, 1);
    if (w && moving && !w.oars) return { u: w.t / w.period, s: -(w.side || 1), same: false }; // wake side +1 = boat's right = his −x
    rig.paddleT += dt;
    const per = 0.9 * (turning ? 0.85 : 1);
    // pivoting: forward strokes on the outside of the turn (heading increasing = turning right → stroke on his left)
    const s = turning ? (rig.yawRate > 0 ? 1 : -1) : (Math.floor(rig.paddleT / per) % 2 ? -1 : 1);
    return { u: (rig.paddleT % per) / per, s, same: turning };
  }

  /** Weight of a seated pose over the clip: 0 walking in / out, rising to 1 as he sits down (or falling as he rises). */
  function seatW(f) {
    const tr = f.tr;
    if (!tr) return 1;
    if (tr.dir === 'in') return smooth((tr.t - tr.P.t1 - tr.P.t2) / tr.P.t3);
    if (tr.dir === 'out') return 1 - smooth(tr.t / 0.25);
    return 1;
  }

  function overlay(f, guard) {
    if (!f.ready) return false;
    const s = layout.seats[f.k];
    if (f.m.real?.inner?.bones) palmSign(f.m.real.inner.bones); // read off the clip's own hands, before any write
    const w = seatW(f);
    let on = false;
    if (s.feet) on = fitLegs(f.m, vis.object3d, s.feet, w, guard) || on;
    if (f.pose === 'paddle' && f.u === v.driver) {
      if (w > 0.5 && !f.paddle) { f.paddle = makePaddle(); group.add(f.paddle); }
      const P = paddlePose(rig.st?.u ?? 0, rig.st?.s ?? 1, rig.st?.same ?? false, rig.act);
      // his slung harpoon gun is laid in the boat while he paddles (the kneeling clip would shoulder it)
      if (w > 0.5) f.m.root.traverse((o) => { if (o.isMesh && /^weapon_/.test(o.name) && o.visible) o.visible = false; });
      on = applyPaddlePose(f.m, P, f.paddle, guard, w) || on;
    }
    if (f.pose === 'row' && f.u === v.driver && oars && rig.hold > 0.001 && !f.out) {
      for (const o of oars) o.key = rig.keys[o.s];
      const r = applyRowPose(f.m, vis.object3d, oars, rig.bend, guard, Math.min(w, smooth(rig.hold)));
      if (r) { rig.gripErr = r.err; rig.hands = r.hand; on = true; }
    }
    return on;
  }

  /**
   * Paddles in their rowlocks (the paddle he holds leaves its lock, the other is stowed along the tube); the oars:
   * rowing / held / trailing, posed from the keys (the oarsman's overlay then lays each through his fist).
   */
  function boatParts(dt) {
    const pf = [...figs.values()].find((f) => f.pose === 'paddle' && f.u === v.driver && !f.out && f.paddle?.visible);
    const takeL = !!pf;
    if (takeL !== rig.takenL) {
      rig.takenL = takeL; vis.showPart?.('paddle_l', !takeL);
      vis.posePart?.('paddle_r', takeL ? STOW.q : null, takeL ? STOW.off : null);
      if (takeL) for (const f of locks) rig.lift[f.name] = 0;
    }
    // paddles left in their rowlocks: the blade lies on the ground instead of going into it (rises at once, settles back)
    if (!takeL && locks.length && v.world) {
      const groundAt = groundOf(v.world);
      for (const f of locks) {
        const want = f.lift(groundAt), cur = rig.lift[f.name];
        const a = want >= cur ? want : Math.max(want, cur - dt * 0.8);
        if (a !== cur || (a > 0 && !rig.liftPosed)) vis.posePart?.(f.name, a > 0 ? f.quat(a, _lq) : null, null);
        rig.lift[f.name] = a;
      }
      rig.liftPosed = true;
    }
    if (!oars) return;
    const rf = [...figs.values()].find((f) => f.pose === 'row' && f.u === v.driver && !f.out);
    const seated = !!rf && rf.ready && !rf.tr;
    rig.hold = clamp(rig.hold + (seated ? 1 : -1) * dt / 0.5, 0, 1);
    // nobody aboard: the oars are shipped inside; men aboard but nobody at the oars: they trail alongside
    const empty = !figs.size && !(v.occupants || []).length;
    rig.ship = clamp((rig.ship ?? (empty ? 1 : 0)) + (empty ? 1 : -1) * dt / 0.7, 0, 1);
    const w = v.world?.water?.wakes?.strokeOf?.(v);
    const moving = seated && ((v.speed || 0) > 0.15 || !!w?.moving);
    const pivot = seated && !moving && Math.abs(rig.yawRate) > 0.3;
    rig.rowAct = clamp(rig.rowAct + (moving || pivot ? 1 : -1) * dt / 0.4, 0, 1);
    rig.moving = moving; rig.pivot = pivot;
    let u;
    if (moving && w?.oars) { u = w.u; rig.rowT = u * 1.6; } // the wake's stroke clock: both blades ring out at its catch
    else { if (rig.rowAct > 0) rig.rowT += dt; u = (rig.rowT / 1.6) % 1; }
    const turn = clamp(rig.yawRate / 0.8, -1, 1);
    rig.keys = oarKeys(u, { act: rig.rowAct, hold: rig.hold, turn: moving || pivot ? turn : 0, pivot });
    rig.bend = rig.keys.bend;
    rig.u = u;
    for (const o of oars) { o.key = rig.keys[o.s]; setOar(o.obj, o.s, o.key.sweep, o.key.pitch, o.key.feather, rig.ship); }
  }

  function step(f, dt) {
    const m = f.m;
    if (!f.ready) {
      if (m.real?.inner) start(f);
      else { m.update(dt); return; }
    }
    const tr = f.tr;
    let shown = true;
    if (tr?.dir === 'sit') { // placed directly: hidden while the seat clip blends in, then measured
      tr.t += dt; shown = false;
      if (tr.t > 0.35) { measure(f); const Z = seatTarget(f); m.root.position.set(Z.x, Z.y, Z.z); f.tr = null; shown = true; }
    } else if (tr?.dir === 'in') {
      tr.t += dt;
      const P = tr.P, Z = seatTarget(f);
      if (!f.place && tr.t > P.t1 + P.t2 + 0.3) measure(f);
      const q = pathPoint(P, tr.S, seatTarget(f), Math.min(tr.t, P.dur), 'in');
      setClip(f, q.clip);
      m.root.position.set(q.x, q.y, q.z);
      face(f, q.face ? Math.atan2(q.face.x - q.x, q.face.z - q.z) : Z.yaw, dt, q.face ? 9 : 6);
      if (tr.t >= P.dur + 0.15) { if (!f.place) measure(f); const Z2 = seatTarget(f); m.root.position.set(Z2.x, Z2.y, Z2.z); m.root.rotation.y = Z2.yaw; f.tr = null; }
    } else if (tr?.dir === 'out') {
      tr.t += dt;
      const u = f.u;
      // he was given an order (or the sim moved him): his own model takes over at once
      if (u.state === 'inVehicle' || u.vehicle || u.alive === false || u.path || Math.hypot(u.x - tr.x0, u.z - tr.z0) > 0.3 || tr.t > tr.P.dur + 0.4) { finishOut(f); return; }
      const q = pathPoint(tr.P, tr.S, tr.Z, tr.t, 'out');
      setClip(f, q.clip);
      m.root.position.set(q.x, q.y, q.z);
      let yaw = q.face ? Math.atan2(q.face.x - q.x, q.face.z - q.z) : f.m.root.rotation.y;
      if (tr.t > tr.P.dur - 0.2) { // last steps: turn to the heading he will stand with
        const h = u.heading ?? v.heading;
        const d = toLocal(u.x + Math.cos(h), 0, u.z + Math.sin(h)).sub(toLocal(u.x, 0, u.z));
        yaw = Math.atan2(d.x, d.z);
      }
      face(f, yaw, dt, 9);
      if (tr.t >= tr.P.dur) { finishOut(f); return; }
    }
    m.update(dt);
    const show = shown && !v.destroyed && (f.out || (f.u.vehicle === v && f.u.alive !== false));
    if (m.root.visible !== show) m.root.visible = show;
  }

  function face(f, yaw, dt, rate) {
    const r = f.m.root.rotation;
    r.y += wrapPi(yaw - r.y) * Math.min(1, dt * rate);
  }

  const api = {
    figures: [],
    occupants: figs,
    seats: () => seats,
    /** The rowboat's oars ({s, obj, key, reach}) and the rig state (keys, hold, rowAct, u, gripErr, hands) — tests. */
    oars,
    rig,
    update(dt) {
      if (v.destroyed) { for (const f of [...figs.values()]) drop(f); group.visible = false; return; }
      // the turn rate per SIM second (a display frame without a sim tick tells nothing: high refresh rates, tests)
      const now = v.world?.time, sdt = now != null && rig.lastT != null ? now - rig.lastT : dt;
      if (sdt > 0) { const dh = wrapPi((v.heading ?? 0) - rig.lastH); rig.lastH = v.heading ?? 0; rig.yawRate += (dh / sdt - rig.yawRate) * Math.min(1, sdt * 8); }
      if (now != null) rig.lastT = now;
      sync();
      rig.st = stroke(dt);
      boatParts(dt);
      for (const f of [...figs.values()]) step(f, dt);
    },
    dispose() {
      for (const f of [...figs.values()]) drop(f);
      if (oars) { vis.showPart?.('oar_l', true); vis.showPart?.('oar_r', true); }
      group.removeFromParent();
    },
  };
  return api;
}
