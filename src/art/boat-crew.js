/**
 * The men in an open boat, drawn (visual only — the sim never reads any of it). Before this module the inflatable raft,
 * the rowboat and the escape boat sailed off empty: a unit that boards is hidden (entities/vehicle.js enter) and only
 * cars / lorries drew their occupants (art/vehicle-crew.js). Now, per occupant of a boat with no enemy crew records:
 *
 *  - a figure with the man's own look (real character model, weapon stowed) on a SEAT of the hull's layout
 *    (BOAT_SEATS, else the library model's standing sockets), parented to the posed hull so it bobs and rolls with it;
 *    the operator (the Marine) always takes seat 0, the others the first free seat and keep it while aboard;
 *  - the Marine kneels at the raft's stern and PADDLES: a single-bladed paddle in his hands (the raft's own port
 *    paddle leaves its rowlock, the starboard one is shipped along the tube), one stroke per wake stroke on alternating
 *    sides, in step with the catch rings the wake draws (art/water.js WakeTracker.strokeOf); pivoting on the spot he
 *    strokes on one side only; at rest the paddle lies across his thighs. In the rowboat he ROWS: facing aft on the
 *    midship thwart, hands on the looms, both oars sweeping (catch, drive, feathered recovery) while it moves;
 *  - getting in is shown: from the bank he steps over the tube / gunwale and sits down, from the water he hoists
 *    himself in; getting out he stands up, steps over the side and walks to the spot the sim put him on, where his
 *    own model takes over (it stays hidden until then). The sim's timing is unchanged (boardTime, instant exit).
 *  - the Biber mini-sub is enclosed (its pilot sits under the hatch, which already opens and closes as he boards):
 *    nobody is drawn there.
 *
 * Every pose is a pure function of the stroke / transition time, unit-tested in tests/unit/boat-crew.test.mjs; the
 * figures are UnitModels (art/unit-model.js) whose `overlay` hook writes the paddling / rowing arms after the mixer
 * (two-bone IK, like the Green Beret's shovel in art/shovel-dig.js).
 * @module art/boat-crew
 */
import * as THREE from 'three';
import { twoBoneIKPole, wpos } from './characters/commandos_a/ca_ik.js';
import { T as TERRAIN } from '../world/grid.js';

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
 *   tube    on the inflatable's side tube                   pelvis on the seat  clip sit
 *   bench   on a thwart / the stern sheets                  pelvis on the seat  clip sit
 *   stand   standing on deck                                root on the deck    clip idle
 * `rim`: height of the tube top / gunwale / deck edge a man steps over getting in or out.
 */
export const BOAT_SEATS = Object.freeze({
  // the inflatable (2.7 × 1.3 m, tubes Ø 0.38 with their top at y 0.44): the Marine kneels at the stern, the men sit on
  // the floor one behind the other facing the bow; a 4th and 5th (M13's five-seat raft) on the side tubes
  raft: { rim: 0.44, seats: [
    { p: [0, 0.02, -0.62], pose: 'paddle' }, // his trailing foot stays inside the stern tube
    { p: [0, 0.02, 0.02], pose: 'floor' },
    { p: [0, 0.02, 0.6], pose: 'floor' },
    { p: [0.47, 0.44, -0.35], pose: 'tube' },
    { p: [-0.47, 0.44, 0.3], pose: 'tube' },
  ] },
  // the wooden rowboat (3.9 × 1.4 m): the oarsman on the midship thwart facing aft, a man in the stern sheets facing him,
  // one on the bow thwart, then the bottom boards forward and a second man in the stern sheets (M7 / M14: five aboard)
  rowboat: { rim: 0.82, seats: [
    { p: [0, 0.36, -0.15], yaw: PI, pose: 'row' },
    { p: [0.12, 0.38, -1.2], pose: 'bench' },
    { p: [0, 0.38, 1.1], pose: 'bench' },
    { p: [0, 0.05, 0.36], pose: 'floor' },
    { p: [-0.24, 0.38, -1.22], pose: 'bench' },
  ] },
});
/** Library types whose occupants are never drawn: the Biber's pilot is enclosed under its hatch. */
export const ENCLOSED = new Set(['minisub']);

/**
 * Seat layout of a boat: its BOAT_SEATS entry, else the library model's standing deck sockets (the patrol / escape boat:
 * helm first, then the passengers on the after deck, the stern lookout), else none.
 * @param {string} libType library type (vehicle-model `libType`) @param {object} [meta] model sidecar (sockets)
 * @returns {{rim:number, seats:{p:number[], yaw?:number, pose:string}[]}}
 */
export function boatLayout(libType, meta = null) {
  if (ENCLOSED.has(libType)) return { rim: 0, seats: [] };
  if (BOAT_SEATS[libType]) return BOAT_SEATS[libType];
  const socks = (meta?.sockets || []).filter((s) => /^stand_(helm|boat|lookout)/.test(s.pose || '') && Array.isArray(s.pos));
  const helm = socks.filter((s) => /helm/.test(s.pose)), rest = socks.filter((s) => !/helm/.test(s.pose));
  const seats = [...helm, ...rest].map((s) => ({ p: [...s.pos], yaw: Math.atan2(s.dir?.[0] ?? 0, s.dir?.[2] ?? 1), pose: 'stand' }));
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
 * swing the paddle up and across in front of him to the other side's catch.
 */
const STROKE = [
  { u: 0.00, G: [0.10, 1.00, 0.32], T: [0.95, -0.50, 0.85], bend: 0.32, twist: -0.30, lean: 0.16 },
  { u: 0.30, G: [0.16, 0.96, 0.08], T: [1.00, -0.50, 0.14], bend: 0.18, twist: -0.02, lean: 0.18 },
  { u: 0.55, G: [0.16, 0.95, -0.12], T: [0.92, -0.18, -0.60], bend: 0.10, twist: 0.25, lean: 0.12 },
  { u: 0.78, G: [0.04, 1.15, 0.25], T: [0.10, 1.60, 1.30], bend: 0.14, twist: 0.00, lean: 0.00 },
];
/** Pivoting: the recovery comes back to the same side (feathered forward, low over the water). */
const TURN_BACK = { G: [0.10, 1.10, 0.22], T: [1.05, 0.50, 0.90], bend: 0.20, twist: -0.12, lean: 0.12 };
/** At rest: the paddle across his thighs, both hands on the shaft (the top hand at his right). */
export const HOLD = Object.freeze({ G: [-0.42, 0.62, 0.30], T: [1.30, 0.58, 0.32], bend: 0.06, twist: 0, lean: 0, top: 'r', lowerAt: 0.75 });

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
    const from = same ? mirror(TURN_BACK, s) : mirror(STROKE[last], s);
    const base = same ? mixKey(mirror(STROKE[last - 1], s), from, smooth((u - STROKE[last].u) / 0.08)) : from;
    k = mixKey(base, to, smooth((u - STROKE[last].u) / (1 - STROKE[last].u)));
  } else {
    let i = last;
    while (i > 0 && STROKE[i].u > u) i--;
    const a = STROKE[i], b = STROKE[i + 1];
    const bb = same && i + 1 === last ? TURN_BACK : b;
    k = mixKey(mirror(a, s), mirror(bb, s), smooth((u - a.u) / (b.u - a.u)));
  }
  // the hand on the grip is the one away from the stroke; it changes over as the paddle crosses (u ≈ 0.9)
  const top = (same || u < 0.9 ? s : -s) > 0 ? 'r' : 'l';
  return { ...k, top, wet: u < STROKE[2].u, lowerAt: PADDLE.lower };
}

/**
 * The paddler's pose: strokes while moving (phase u, side s, pivoting → same side), the rest hold when not, blended
 * by `act` (0 hold … 1 stroking).
 */
export function paddlePose(u, s, same, act) {
  const k = paddleKey(u, s, same);
  if (act >= 0.999) return k;
  const h = { ...HOLD, wet: false };
  if (act <= 0.001) return h;
  const a = smooth(act);
  return { ...mixKey(h, k, a), top: act > 0.5 ? k.top : 'r', wet: k.wet && act > 0.5, lowerAt: lerp(HOLD.lowerAt, PADDLE.lower, a) };
}

// ------------------------------------------------------------------ rowing (oars: art/vehicle-library posePart)

/** Row cycle (one stroke per two wake strokes): catch → drive (blades in) → release → feathered recovery. */
export const ROW = Object.freeze({ catch: 0.5, finish: -0.42, lift: 0.16, drive: 0.45 });
/**
 * Oar sweep / lift and the oarsman's lean at phase u of a row stroke (sweep + = blades forward toward the bow).
 * @returns {{sweep:number, lift:number, bend:number}}
 */
export function rowKey(u) {
  u = ((u % 1) + 1) % 1;
  if (u < ROW.drive) { const k = smooth(u / ROW.drive); return { sweep: lerp(ROW.catch, ROW.finish, k), lift: 0, bend: lerp(0.38, -0.22, k) }; }
  const r = (u - ROW.drive) / (1 - ROW.drive);
  const lift = ROW.lift * smooth(r / 0.15) * (1 - smooth((r - 0.85) / 0.15));
  const k = smooth((r - 0.08) / 0.84);
  return { sweep: lerp(ROW.finish, ROW.catch, k), lift, bend: lerp(-0.22, 0.38, k) };
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

// ------------------------------------------------------------------ skeleton overlays

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const SPINE = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];
const TOUCHED = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'];

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

/** Two-bone arm IK: hand `s` to world point p, elbow out to the side and down. */
function arm(B, s, p) {
  const sh = wpos(B['upperarm_' + s]), sg = s === 'l' ? 1 : -1;
  twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], p, sh.addScaledVector(_l, 0.5 * sg).addScaledVector(_u, -0.6).addScaledVector(_f, -0.2));
}

/**
 * Write the paddling pose on the model's bones and place the paddle (root-local key P from paddlePose; w = weight of
 * the paddling arms over the clip's own — 0 while getting in). @returns {boolean} pose written
 */
export function applyPaddlePose(m, P, paddle, guard, w = 1) {
  const B = m.real?.inner?.bones;
  if (!B || !B.hand_r || !B.hand_l || !B.upperarm_l || w <= 0.001) { if (paddle) paddle.visible = false; return false; }
  for (const n of TOUCHED) if (B[n]) guard?.touch(B[n]);
  const root = m._body?.() || m.root;
  m.root.updateMatrixWorld(true);
  frameAxes(root);
  torso(B, P.bend * w, P.twist * w, P.lean * w);
  const G = root.localToWorld(new THREE.Vector3(...P.G)), Tt = root.localToWorld(new THREE.Vector3(...P.T));
  const dir = Tt.sub(G).normalize();
  const top = P.top || 'r', low = top === 'r' ? 'l' : 'r';
  const lowP = G.clone().addScaledVector(dir, P.lowerAt ?? PADDLE.lower);
  if (w >= 0.999) { arm(B, top, G); arm(B, low, lowP); }
  else { // blend: IK toward the hands' current spots → keys
    const pT = wpos(B['hand_' + top]).lerp(G, w), pL = wpos(B['hand_' + low]).lerp(lowP, w);
    arm(B, top, pT); arm(B, low, pL);
  }
  if (paddle) {
    paddle.visible = w > 0.5;
    // paddle frame: −Y along the shaft (grip → tip), +Z (blade face) toward his front
    const y = dir.clone().negate();
    let z = _a.copy(_f).addScaledVector(y, -_f.dot(y));
    if (z.lengthSq() < 1e-6) z = _a.copy(_u).addScaledVector(y, -_u.dot(y));
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z).setPosition(wpos(B['hand_' + top]).lerp(wpos(B['middle_01_' + top] || B['hand_' + top]), 0.5));
    _inv.copy(paddle.parent.matrixWorld).invert();
    _m.premultiply(_inv);
    _m.decompose(paddle.position, paddle.quaternion, paddle.scale);
    paddle.updateMatrixWorld(true);
  }
  return true;
}

/**
 * Oarsman: hands on the two looms (world points), lean `bend` toward his front (the stern). @returns {boolean}
 */
export function applyRowPose(m, hands, bend, guard) {
  const B = m.real?.inner?.bones;
  if (!B || !B.hand_r || !B.hand_l || !B.upperarm_l || !hands) return false;
  for (const n of TOUCHED) if (B[n]) guard?.touch(B[n]);
  const root = m._body?.() || m.root;
  m.root.updateMatrixWorld(true);
  frameAxes(root);
  torso(B, bend, 0, 0);
  arm(B, 'l', hands.l); arm(B, 'r', hands.r);
  return true;
}

// ------------------------------------------------------------------ the crew

const HIP_ABOVE_SEAT = 0.1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
/** Handle end of an oar (oar node local, starboard oar; mirrored x for port). */
const OAR_HANDLE = [0.78, 0.29, -0.06];
/** Shipped starboard paddle (raft): turned in along the tube (blade forward) and levelled. */
const SHIPPED = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 1.4, -0.56, 'YXZ'));

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
  const rig = { paddleT: 0, rowT: 0, act: 0, lastH: v.heading, yawRate: 0, takenL: false, shipped: false };
  const open0 = !v.driveable || !(v.def.operators || []).length;

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
    const f = { u, k, m, pose: s.pose, clip: null, mode: 'root', floor: s.pose === 'stand' ? s.p[1] : layout.rim > 0.6 ? 0.05 : 0.02,
      tr: null, place: null, t: 0, ready: false, clipNow: null, yaw: s.yaw || 0, out: false, paddle: null };
    m.root.visible = false;
    group.add(m.root);
    // a boat figure always carries an overlay: weapons stay stowed (unit-model _wantWeapon), arms paddle / row
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
    if (w && moving) return { u: w.t / w.period, s: -(w.side || 1), same: false }; // wake side +1 = boat's right = his −x
    rig.paddleT += dt;
    const per = 0.9 * (turning ? 0.85 : 1);
    // pivoting: forward strokes on the outside of the turn (heading increasing = turning right → stroke on his left)
    const s = turning ? (rig.yawRate > 0 ? 1 : -1) : (Math.floor(rig.paddleT / per) % 2 ? -1 : 1);
    return { u: (rig.paddleT % per) / per, s, same: turning };
  }

  function overlay(f, guard) {
    if (!f.ready) return false;
    if (f.pose === 'paddle' && f.u === v.driver) {
      const w = f.tr ? (f.tr.dir === 'in' ? smooth((f.tr.t - f.tr.P.t1 - f.tr.P.t2) / f.tr.P.t3) : f.tr.dir === 'out' ? 1 - smooth(f.tr.t / 0.25) : 1) : 1;
      if (w > 0.5 && !f.paddle) { f.paddle = makePaddle(); group.add(f.paddle); }
      const P = paddlePose(rig.st?.u ?? 0, rig.st?.s ?? 1, rig.st?.same ?? false, rig.act);
      // his slung harpoon gun is laid in the boat while he paddles (the kneeling clip would shoulder it)
      if (w > 0.5) f.m.root.traverse((o) => { if (o.isMesh && /^weapon_/.test(o.name) && o.visible) o.visible = false; });
      return applyPaddlePose(f.m, P, f.paddle, guard, w);
    }
    if (f.pose === 'row' && f.u === v.driver && rig.hands && !f.tr) return applyRowPose(f.m, rig.hands, rig.rowBend ?? 0.1, guard);
    return false;
  }

  /** Paddles in their rowlocks, oars: the paddle he holds leaves its lock, the other is shipped; the oars row. */
  function boatParts(dt) {
    const pf = [...figs.values()].find((f) => f.pose === 'paddle' && f.u === v.driver && !f.out && f.paddle?.visible);
    const takeL = !!pf;
    if (takeL !== rig.takenL) { rig.takenL = takeL; vis.showPart?.('paddle_l', !takeL); vis.posePart?.('paddle_r', takeL ? SHIPPED : null); }
    const rf = [...figs.values()].find((f) => f.pose === 'row' && f.u === v.driver && !f.out);
    if (!rf || !vis.parts?.oar_r) { if (rig.oars) { vis.posePart?.('oar_r', null); vis.posePart?.('oar_l', null); rig.oars = false; } rig.hands = null; return; }
    const moving = (v.speed || 0) > 0.15;
    rig.rowAct = clamp((rig.rowAct || 0) + (moving ? 1 : -1) * dt / 0.4, 0, 1);
    if (moving || rig.rowAct > 0) rig.rowT += dt;
    const k = rowKey(rig.rowT / 1.8), a = smooth(rig.rowAct);
    const sweep = k.sweep * a, lift = k.lift * a;
    // starboard oar: + yaw swings the blade forward (handle aft); + z-roll lifts the blade (port mirrored)
    vis.posePart?.('oar_r', _q.setFromEuler(new THREE.Euler(0, sweep, -lift, 'YXZ')));
    vis.posePart?.('oar_l', _q.setFromEuler(new THREE.Euler(0, -sweep, lift, 'YXZ')));
    rig.oars = true;
    rig.rowBend = lerp(0.1, k.bend, a);
    const P = vis.parts;
    P.oar_r.updateWorldMatrix(true, false); P.oar_l.updateWorldMatrix(true, false);
    rig.hands = { r: P.oar_r.localToWorld(new THREE.Vector3(...OAR_HANDLE)), l: P.oar_l.localToWorld(new THREE.Vector3(-OAR_HANDLE[0], OAR_HANDLE[1], OAR_HANDLE[2])) };
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
    update(dt) {
      if (v.destroyed) { for (const f of [...figs.values()]) drop(f); group.visible = false; return; }
      if (dt > 0) { const dh = wrapPi((v.heading ?? 0) - rig.lastH); rig.lastH = v.heading ?? 0; rig.yawRate += (dh / dt - rig.yawRate) * Math.min(1, dt * 8); }
      sync();
      rig.st = stroke(dt);
      boatParts(dt);
      for (const f of [...figs.values()]) step(f, dt);
    },
    dispose() {
      for (const f of [...figs.values()]) drop(f);
      group.removeFromParent();
    },
  };
  return api;
}
