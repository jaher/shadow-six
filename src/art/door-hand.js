/**
 * A man's hand on a vehicle door (user request 2026-10-07 "Can we have the commando arm close the door of the car").
 * The doors of cars, lorry cabs and the half-track swung open and shut on a timer; the figures (art/vehicle-crew.js)
 * now do it with their hands:
 *  - getting in, once he sits he reaches out — leaning toward the door as far as his fist needs (≤ 40°) — closes his
 *    fist round the door's edge near its free end (further toward the hinge for a short man: `fitGrip`) and pulls it
 *    shut: the door's angle is the pull's (`closeKey`) and his fist is laid on the door at that angle every frame
 *    (`reachDoor`: two-bone arm IK, wrist turned to the door, fingers round the edge, the fingers pointing away from
 *    his shoulder for the longest reach), so the door never moves while his hand floats; then he lets go;
 *  - getting out, his hand pushes it open before he rises (`openKey`); the last man out by a door steps down beside
 *    it and swings it shut by its outer edge (`shutKey`), bent over it (≤ 65°) and crouching when it is low;
 *  - the half-track's two rear doors take a hand each.
 * How far a door opens for a seat (`boardFrac`): wide enough to climb through, no wider than the seated man reaches.
 * Pure geometry and timelines are node-tested (tests/unit/door-hand.test.mjs); the skeleton side runs in the GPU tests
 * truck-straps-doors and vehicle-door-hands.
 * @module art/door-hand
 */
import * as THREE from 'three';
import { gripPoint, palmSign, curlFingers } from './boat-crew.js';
import { wpos, wquat, handFrame, handQuat, twoBoneIKPole } from './characters/commandos_a/ca_ik.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const DEG = Math.PI / 180;

/** Seconds per phase of a hand on a door. */
export const DOOR_HAND = Object.freeze({
  reach: 0.35,  // hand from the wheel / his lap onto the pull
  pull: 0.5,    // the door swung shut by the hand (ease in, firm at the end)
  let: 0.3,     // hand off the door, back to the clip's
  push: 0.45,   // getting out: the door pushed open
  shut: 0.5,    // standing outside: swung shut by its outer edge
});
/** Grip spot on a door: from the free edge (share of the door's length) and up its height (share), m off the skin. */
export const DOOR_GRIP = Object.freeze({ edge: 0.17, up: 0.62, top: 0.07, skin: 0.03 });
/** Nominal seated shoulder relative to the seat socket (m: outboard, up, back) and reach with a lean (m). */
export const SEATED_SHOULDER = Object.freeze({ out: 0.2, up: 0.46, back: 0.11, reach: 0.56, lean: 0.24 });

/**
 * Door geometry in the model frame from its sidecar part (pivot, vertical axis, limits) and the door's mesh box at rest.
 * @param {{node:string,pivot:number[],axis?:number[],limits_deg?:number[]}} def @param {{min:number[],max:number[]}} box
 * @returns {object} rig: node, pivot, open (signed rad at fraction 1), side (+1 the door is on the model's +x side),
 *   len, gIn / gOut (grip spots inside / outside, door shut), y
 */
export function doorRig(def, box) {
  const p = def.pivot, L = def.limits_deg || [0, 75];
  const open = (Math.abs(L[1]) >= Math.abs(L[0]) ? L[1] : L[0]) * DEG;
  const ax = def.axis || [0, 1, 0], up = ax[1] >= 0 ? 1 : -1;
  const side = Math.sign((box.min[0] + box.max[0]) / 2) || Math.sign(p[0]) || 1;
  // the free edge: the end of the door farthest from its hinge (along the model z, doors are side doors / rear doors)
  const alongZ = Math.abs(box.max[2] - box.min[2]) >= Math.abs(box.max[0] - box.min[0]);
  const k = alongZ ? 2 : 0;
  const far = Math.abs(box.min[k] - p[k]) > Math.abs(box.max[k] - p[k]) ? box.min[k] : box.max[k];
  const len = Math.abs(far - p[k]);
  const at = far + (p[k] - far) * DOOR_GRIP.edge;
  const h = box.max[1] - box.min[1], y = Math.min(box.max[1] - DOOR_GRIP.top, box.min[1] + h * DOOR_GRIP.up);
  const inner = side > 0 ? box.min[0] : box.max[0], outer = side > 0 ? box.max[0] : box.min[0];
  let gIn, gOut;
  if (alongZ) {
    gIn = [inner - side * DOOR_GRIP.skin, y, at];
    gOut = [outer + side * DOOR_GRIP.skin, y, at];
  } else { // a rear door across the hull (the half-track's): inside = toward the front (+z); taken by its top edge
    const zIn = Math.max(box.min[2], box.max[2]), zOut = Math.min(box.min[2], box.max[2]), yt = box.max[1] - 0.1;
    gIn = [at, yt, zIn + DOOR_GRIP.skin];
    gOut = [at, yt, zOut - DOOR_GRIP.skin];
  }
  return { node: def.node, pivot: p.slice(), up, open, side, len, alongZ, gIn, gOut, y, k, far, y0: box.min[1], y1: box.max[1] };
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
/**
 * Grip spot of a door at opening fraction `frac` (model frame): the shut spot turned about the hinge.
 * @param {'in'|'out'} which @returns {THREE.Vector3}
 */
export function doorPoint(rig, frac, which = 'in', out = new THREE.Vector3(), edge = DOOR_GRIP.edge) {
  const g = which === 'out' ? rig.gOut : rig.gIn, P = rig.pivot;
  _q.setFromAxisAngle(_Y, rig.open * rig.up * frac);
  out.set(g[0] - P[0], g[1] - P[1], g[2] - P[2]);
  if (edge !== DOOR_GRIP.edge && rig.far != null) out.setComponent(rig.k, rig.far + (P[rig.k] - rig.far) * edge - P[rig.k]); // further along the door
  return out.applyQuaternion(_q).add(_p.set(P[0], P[1], P[2]));
}

/** Where along a door a hand may take it (share of its length from the free edge): the pull first, then nearer the hinge. */
export const GRIP_EDGES = Object.freeze([DOOR_GRIP.edge, 0.27, 0.37, 0.47]);

/** The door's own axes at `frac` (model frame): `a` along the door (hinge → free edge), `n` its outward face normal. */
export function doorAxes(rig, frac) {
  _q.setFromAxisAngle(_Y, rig.open * rig.up * frac);
  const g = rig.gIn, P = rig.pivot;
  const a = new THREE.Vector3(g[0] - P[0], 0, g[2] - P[2]).normalize().applyQuaternion(_q);
  const n = rig.alongZ ? new THREE.Vector3(rig.side, 0, 0).applyQuaternion(_q) : new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
  return { a, n };
}

/**
 * How far a door is opened for a man getting in or out of `seat` (fraction of its full swing): wide enough to climb
 * through (≥ `min`), no wider than the seated man can reach its pull from his seat with a lean (SEATED_SHOULDER).
 * @param {object} rig @param {number[]} seat the seat socket (model frame) @param {number} [min=0.5]
 */
export function boardFrac(rig, seat, min = 0.5) {
  const S = SEATED_SHOULDER, side = Math.sign(rig.gIn[0]) || rig.side;
  const sh = new THREE.Vector3(seat[0] + side * S.out, seat[1] + S.up, seat[2] - S.back);
  const reach = S.reach + S.lean;
  let best = min;
  for (let f = min; f <= 1.0001; f += 0.02) if (doorPoint(rig, f, 'in').distanceTo(sh) <= reach) best = f;
  return +clamp(best, min, 1).toFixed(3);
}

/**
 * Pulling a door shut from the seat, t s after he sat down: IK weight w (hand on the pull), door fraction (× the
 * fraction it stood open at), lean weight. Ends shut with the hand back. @returns {{w:number, door:number, lean:number, done:boolean}}
 */
export function closeKey(t) {
  const T = DOOR_HAND;
  if (t < T.reach) { const k = smooth(t / T.reach); return { w: k, door: 1, lean: k, done: false }; }
  const c = t - T.reach;
  if (c < T.pull) { const k = c / T.pull; const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k); return { w: 1, door: 1 - e, lean: 1 - e * 0.85, done: false }; }
  const k = (c - T.pull) / T.let;
  return { w: 1 - smooth(k), door: 0, lean: 0.15 * (1 - smooth(k)), done: k >= 1 };
}

/** Pushing it open from the seat before he rises (t from the start): ends open, the hand still on it. */
export function openKey(t) {
  const T = DOOR_HAND;
  if (t < T.reach) { const k = smooth(t / T.reach); return { w: k, door: 0, lean: 0.15 * k, done: false }; }
  const k = (t - T.reach) / T.push;
  return { w: 1, door: smooth(k), lean: 0.15 + 0.85 * smooth(k), done: k >= 1 };
}

/** Standing outside, swinging it shut by the outer edge (t from the start): reach, swing, let go. */
export function shutKey(t) {
  const T = DOOR_HAND, R = 0.3, L = 0.2;
  if (t < R) { const k = smooth(t / R); return { w: k, door: 1, done: false }; }
  const c = t - R;
  if (c < T.shut) { const k = c / T.shut; return { w: 1, door: 1 - k * k * (3 - 2 * k), done: false }; }
  const k = (c - T.shut) / L;
  return { w: 1 - smooth(k), door: 0, done: k >= 1 };
}

// ------------------------------------------------------------------ the pose

const _w = new THREE.Vector3(), _d = new THREE.Vector3(), _ax = new THREE.Vector3(), _qq = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const SPINE = [['spine_01', 0.4], ['spine_02', 0.35], ['spine_03', 0.25]];
/** Furthest he leans toward a door (rad): seated, out of the doorway; standing outside, bent forward to it. */
const LEAN_MAX = 40 * DEG, STAND_LEAN_MAX = 65 * DEG;

/**
 * Crouch: the pelvis lowered `drop` m, the legs folding (two-bone IK) so each foot stays where the clip put it, knees
 * forward along `fwd` (world). @returns {number} the drop applied
 */
export function crouch(B, drop, fwd, guard = null) {
  if (!B?.pelvis || drop <= 1e-4) return 0;
  const feet = ['l', 'r'].map((s) => (B['foot_' + s] ? { s, p: wpos(B['foot_' + s]), q: wquat(B['foot_' + s]) } : null)).filter(Boolean);
  const pel = B.pelvis, wp = wpos(pel);
  wp.y -= drop;
  guard?.touch(pel);
  pel.position.copy(pel.parent.worldToLocal(wp));
  pel.updateMatrixWorld(true);
  for (const f of feet) {
    const th = B['thigh_' + f.s], ca = B['calf_' + f.s], fo = B['foot_' + f.s];
    if (!th || !ca) continue;
    guard?.touch(th); guard?.touch(ca); guard?.touch(fo);
    twoBoneIKPole(th, ca, fo, f.p, wpos(ca).addScaledVector(fwd, 0.6), f.q);
  }
  return drop;
}
const ARM = (s) => ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_' + s, 'upperarm_' + s, 'lowerarm_' + s, 'hand_' + s,
  ...['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((d) => ['01', '02', '03'].map((j) => `${d}_${j}_${s}`))];

/** Rotate bone b by `angle` about the WORLD axis `axis`. */
export function turnWorld(b, axis, angle) {
  if (!b || Math.abs(angle) < 1e-5) return;
  b.parent.getWorldQuaternion(_q2);
  _ax.copy(axis).applyQuaternion(_q2.invert()).normalize();
  _qq.setFromAxisAngle(_ax, angle);
  b.quaternion.premultiply(_qq);
  b.updateMatrixWorld(true);
}

/** Shoulder → grip reach of arm s, fully stretched (m). */
function armReach(B, s) {
  const a = wpos(B['upperarm_' + s]), b = wpos(B['lowerarm_' + s]), c = wpos(B['hand_' + s]);
  return a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(gripPoint(B, s));
}

/**
 * Fist `s` round a door's edge at world point g: the bar (the edge) along `a`, the palm facing `pn`, the fingers
 * across it pointing away from the shoulder `sh` (the longest reach: the wrist stays on his side of the edge),
 * closed round it; elbow toward `pole`. w < 1 blends from the clip's hand. (art/boat-crew.js gripBar, the fingers'
 * side chosen for reach rather than from the clip.) @returns {number} grip error (m)
 */
function gripEdge(B, s, g, a, pn, sh, pole, w = 1) {
  const hand = B['hand_' + s], ps = palmSign(B)[s];
  const n = pn.clone().addScaledVector(a, -pn.dot(a)).normalize();
  const fd = new THREE.Vector3().crossVectors(n, a).normalize();
  if (fd.dot(g.clone().sub(sh)) < 0) fd.negate();
  let q = handQuat(B, s, ps, fd, n);
  if (w < 0.999) q = wquat(hand).slerp(q, w);
  const tgt = w < 0.999 ? gripPoint(B, s).lerp(g, w) : g.clone();
  for (let i = 0; i < 2; i++) {
    const off = gripPoint(B, s).sub(wpos(hand)).applyQuaternion(wquat(hand).invert()).applyQuaternion(q);
    twoBoneIKPole(B['upperarm_' + s], B['lowerarm_' + s], hand, tgt.clone().sub(off), pole, q);
  }
  curlFingers(B, s, w, tgt, a);
  return gripPoint(B, s).distanceTo(tgt);
}

/**
 * Hand `s` of a figure onto a door's grip spot at fraction `frac` (`which` 'in' / 'out' face, `edge` = where along
 * the door; frame: the vehicle model object the rig is in): the torso leans toward it as far as the arm falls short
 * (seated ≤ 40°; `stand`ing ≤ 65°, then a crouch ≤ 0.35 m), the fist closes round the door's edge there (`gripEdge`),
 * elbow out and down. w < 1 blends from the clip's pose (lean, crouch, hand), `lean` weights the lean.
 * @returns {{err:number, target:THREE.Vector3, lean:number, drop:number, reach:number}|null} grip error (m), the
 *   target (world), lean (rad) and crouch (m) applied
 */
export function reachDoor(m, frame, rig, frac, which, s, w = 1, lean = 1, guard = null, edge = DOOR_GRIP.edge, stand = which === 'out') {
  const B = m.real?.inner?.bones;
  if (!B?.['hand_' + s] || !B.spine_01 || w <= 0.001) return null;
  for (const n of ARM(s)) if (B[n]) guard?.touch(B[n]);
  m.root.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const T = frame.localToWorld(doorPoint(rig, frac, which, new THREE.Vector3(), edge));
  const { a, n } = doorAxes(rig, frac);
  const aw = a.transformDirection(frame.matrixWorld), nw = n.transformDirection(frame.matrixWorld);
  // fist round the door's edge: bar along the door, palm against its face (inside: facing out; outside: facing in)
  const pn = which === 'out' ? nw.clone().negate() : nw.clone();
  const grip = (wt) => {
    const sh = wpos(B['upperarm_' + s]);
    const pole = sh.clone().addScaledVector(_w.set(0, 1, 0), -0.6).addScaledVector(T.clone().sub(sh).setY(0).normalize(), -0.25);
    return gripEdge(B, s, T, aw, pn, sh, pole, wt);
  };
  const reach = armReach(B, s), up = _w.set(0, 1, 0);
  const bendBy = (ang) => { // lean toward the spot, the collarbone reaching out with it
    const sh = wpos(B['upperarm_' + s]), d = _d.copy(T).sub(sh);
    d.y = 0; if (d.lengthSq() < 1e-6) return;
    d.normalize();
    const axis = new THREE.Vector3().crossVectors(up, d).normalize();
    for (const [nm, k] of SPINE) turnWorld(B[nm], axis, ang * k);
    if (B.neck_01) turnWorld(B.neck_01, axis, -ang * 0.4); // the head stays up
    const cl = B['clavicle_' + s];
    if (cl) {
      const sh2 = wpos(B['upperarm_' + s]), c0 = wpos(cl), v1 = sh2.clone().sub(c0), v2 = T.clone().sub(c0);
      const ax2 = new THREE.Vector3().crossVectors(v1, v2);
      if (ax2.lengthSq() > 1e-10) turnWorld(cl, ax2.normalize(), Math.min(6 * DEG, v1.angleTo(v2) * 0.25) * Math.min(1, ang / (8 * DEG)));
    }
  };
  // how far he must lean (and, standing, crouch) for his fist to reach the spot (the wrist turned to the door reaches
  // less than the stretched arm): found with the full grip, then the pose taken back and applied × the grip weight
  const standing = stand, maxLean = standing ? STAND_LEAN_MAX : LEAN_MAX;
  const saved = [...new Set([...ARM(s), ...LEGS])].map((nm) => B[nm] && [B[nm], B[nm].quaternion.clone(), B[nm].position.clone()]).filter(Boolean);
  const fwd = new THREE.Vector3().copy(T).sub(wpos(B.pelvis)).setY(0).normalize();
  if (standing) for (const nm of LEGS) if (B[nm]) guard?.touch(B[nm]);
  let need = 0, drop = 0, err = grip(1);
  if (lean > 0.001) {
    for (let it = 0; it < 8 && err > 0.004 && need < maxLean - 1e-3; it++) {
      const sh = wpos(B['upperarm_' + s]), hgt = Math.max(0.3, sh.y - wpos(B.spine_01).y);
      const ang = Math.min(maxLean - need, Math.asin(clamp((err * 1.15 + 0.004) / hgt, 0, 1)));
      if (ang <= 1e-4) break;
      bendBy(ang); need += ang;
      err = grip(1);
    }
    for (let it = 0; standing && it < 3 && err > 0.004 && drop < 0.35; it++) { // still short: down on his knees a little
      const d = Math.min(0.35 - drop, err * 1.1 + 0.005);
      crouch(B, d, fwd); drop += d;
      err = grip(1);
    }
  }
  if (w < 0.999 || lean < 0.999) {
    for (const [b, q, p] of saved) { b.quaternion.copy(q); b.position.copy(p); }
    m.root.updateWorldMatrix(true, true);
    const k = Math.min(1, lean) * w, leant = need * k;
    if (leant > 1e-4) bendBy(leant);
    if (drop * k > 1e-4) crouch(B, drop * k, fwd);
    err = grip(w);
    return { err, target: T, lean: leant, drop: drop * k, reach };
  }
  return { err, target: T, lean: need, drop, reach };
}
const LEGS = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];

/**
 * Where along the door this man takes it (GRIP_EDGES): the pull near the free edge when his fist reaches it (with the
 * lean) at every given opening `fracs`, else the first spot nearer the hinge that it reaches — a short man grips the
 * door further in. Probes on the figure's current (clip) pose and puts it back. @returns {number} edge share
 */
export function fitGrip(m, frame, rig, fracs, which, s, stand = which === 'out') {
  const B = m.real?.inner?.bones;
  if (!B?.['hand_' + s]) return DOOR_GRIP.edge;
  const bones = [...new Set([...ARM(s), ...LEGS])].map((n) => B[n]).filter(Boolean), saved = bones.map((b) => [b.quaternion.clone(), b.position.clone()]);
  const back = () => { bones.forEach((b, i) => { b.quaternion.copy(saved[i][0]); b.position.copy(saved[i][1]); }); m.root.updateWorldMatrix(true, true); };
  let best = DOOR_GRIP.edge, bestErr = Infinity;
  for (const e of GRIP_EDGES) {
    let worst = 0;
    for (const f of fracs) { worst = Math.max(worst, reachDoor(m, frame, rig, f, which, s, 1, 1, null, e, stand)?.err ?? 1); back(); }
    if (worst < 0.008) return e;
    if (worst < bestErr) { bestErr = worst; best = e; }
  }
  return best;
}
