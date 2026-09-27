// pose.mjs - prone body builders on the UAL rig (CC0 project code). All positions in metres, character facing +Z,
// +X = his left, ground y = 0. See docs/crawl-animation.md §3 for the target numbers.
import * as THREE from 'three';
import { V } from './rig.mjs';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const sstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const easeOut = (x) => { x = clamp01(x); return 1 - (1 - x) * (1 - x); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const frac = (x) => x - Math.floor(x);
const UP = V(0, 1, 0);
const rotAxis = (v, ax, a) => v.clone().applyAxisAngle(ax, a);

/** Frame of a body segment lying face down: F = along the body (toward the head), D = belly side, L = his left. */
export function segFrame(yaw = 0, pitch = 0, roll = 0) {
  let F = V(0, 0, 1), D = V(0, -1, 0);
  const Y = UP;
  F = rotAxis(F, V(1, 0, 0), -pitch); D = rotAxis(D, V(1, 0, 0), -pitch);           // pitch > 0: head end up
  F = rotAxis(F, Y, yaw); D = rotAxis(D, Y, yaw);                                     // yaw > 0: toward his left
  D = rotAxis(D, F, roll);                                                            // roll > 0: right side up (belly turns left)
  const L = new THREE.Vector3().crossVectors(D, F).negate();
  return { F, D, L: L.normalize() };
}
/** Map a rest-pose (standing, facing +Z) direction into a lying segment frame: rest up -> F, rest front -> D. */
export const toSeg = (fr, v) => fr.L.clone().multiplyScalar(v.x).addScaledVector(fr.F, v.y).addScaledVector(fr.D, v.z);

/**
 * Torso, neck and head lying prone.
 * o.hip: hip-joint centre (world); o.yaw/pitch/roll: pelvis; o.chest: extra pitch (rad) of the chest (spine_02/03,
 * shoulders up); o.twist: shoulder yaw relative to the hips; o.shRoll: chest roll; o.prot {l,r}: scapular slide
 * (+ forward, metres of the shoulder joint along the body); o.neck: neck extension (rad); o.head {pitch, yaw, roll}.
 */
export function layTorso(R, o) {
  const P = segFrame(o.yaw || 0, o.pitch || 0, o.roll || 0);
  R.orient('pelvis', P.F, P.D);
  R.update();
  const hc = R.wp('thigh_l').lerp(R.wp('thigh_r'), 0.5);
  R.pelvisAt(R.wp('pelvis').add(o.hip.clone().sub(hc)));
  const ch = o.chest || 0, tw = o.twist || 0, sr = o.shRoll ?? (o.roll || 0) * -0.3;
  const segs = [['spine_01', 0.25, 0.3, 0.5], ['spine_02', 0.6, 0.65, 0.8], ['spine_03', 1, 1, 1]];
  for (const [n, kc, kt, kr] of segs) {
    const fr = segFrame((o.yaw || 0) + tw * kt, (o.pitch || 0) + ch * kc, lerp(o.roll || 0, sr, kr));
    R.orient(n, fr.F, fr.D);
  }
  const C = segFrame((o.yaw || 0) + tw, (o.pitch || 0) + ch, sr);
  // clavicles: scapular slide along the body (protraction forward, retraction back) + a little elevation
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, n = 'clavicle_' + s;
    const rest = V(sx * 0.173, -0.017, -0.136).normalize();
    const p = (o.prot && o.prot[s]) || 0, el = (o.elev && o.elev[s]) || 0;
    R.orient(n, toSeg(C, rest.clone().add(V(0, p * 5.5, -el * 5))).normalize(), C.D);
  }
  // neck extended so the face looks along the ground; the head carries the rest
  const hd = o.head || {};
  const neckUp = o.neck ?? 0.95;
  const nF = C.F.clone().multiplyScalar(Math.cos(neckUp)).addScaledVector(UP, Math.sin(neckUp)).normalize();
  R.orient('neck_01', nF, new THREE.Vector3().crossVectors(C.L, nF));
  // head: face direction (pitch down from horizontal, yaw), crown perpendicular
  const hp = hd.pitch ?? 0.35, hy = (hd.yaw || 0) + (o.yaw || 0) + tw, hr = hd.roll || 0;
  let face = V(Math.sin(hy) * Math.cos(hp), -Math.sin(hp), Math.cos(hy) * Math.cos(hp));
  const side = new THREE.Vector3().crossVectors(UP, face).normalize();                 // his left
  let crown = new THREE.Vector3().crossVectors(face, side).normalize();
  crown = rotAxis(crown, face, -hr);
  R.orient('Head', crown, face);
  R.update();
  return { P, C };
}

/**
 * Arm lying on the ground: upper arm aimed at the elbow point E, forearm along D (from the elbow), hand along `ha`
 * with its thumb side toward `thumb`. Returns the actual elbow and wrist world positions.
 */
export function armPose(R, s, E, D, ha, thumb) {
  const S = R.wp('upperarm_' + s);
  const ua = E.clone().sub(S).normalize();
  const flex = D.clone().addScaledVector(ua, -D.dot(ua));
  R.orient('upperarm_' + s, ua, flex.lengthSq() > 1e-6 ? flex : thumb);
  R.orient('lowerarm_' + s, D, thumb);
  R.orient('hand_' + s, ha || D, thumb);
  R.update();
  return { E: R.wp('lowerarm_' + s), W: R.wp('hand_' + s) };
}

/**
 * Leg: ankle at A, knee toward `pole` (the kneecap faces the pole side), foot plantar-flexed by pf (rad) from the
 * neutral 90 deg ankle and everted/inverted by ev (rad, + = sole turned outward).
 */
export function legPose(R, s, A, pole, pf = 0.5, ev = 0) {
  const kneeFront = (d) => pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  R.chain('thigh_' + s, 'calf_' + s, A, pole, (d1) => kneeFront(d1), (d1, d2) => kneeFront(d2));
  R.update();
  const shin = R.axes('calf_' + s).along, k = kneeFront(shin);
  let T = k.clone().multiplyScalar(Math.cos(pf)).addScaledVector(shin, Math.sin(pf)).normalize();
  let inst = shin.clone().multiplyScalar(-Math.cos(pf)).addScaledVector(k, Math.sin(pf)).normalize();
  if (ev) inst = rotAxis(inst, T, (s === 'l' ? -1 : 1) * ev);
  R.orient('foot_' + s, T, inst);
  R.update();
}

/** Two-bone knee position for a standing / kneeling leg with an explicit knee point (no pole solve). */
export function legThrough(R, s, K, A, instep) {
  const H = R.wp('thigh_' + s);
  const d1 = K.clone().sub(H).normalize(), d2 = A.clone().sub(K).normalize();
  let f1 = V(0, 0, 1).addScaledVector(d1, -d1.z); f1 = f1.lengthSq() > 1e-6 ? f1.normalize() : V(0, 1, 0);
  const hinge = new THREE.Vector3().crossVectors(d1, f1).normalize();            // knee axis (consistent hinge)
  R.orient('thigh_' + s, d1, f1); R.orient('calf_' + s, d2, new THREE.Vector3().crossVectors(hinge, d2));
  if (instep) R.orient('foot_' + s, instep.T, instep.up);
  R.update();
}
