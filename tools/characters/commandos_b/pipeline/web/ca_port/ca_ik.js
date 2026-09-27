// ca_ik.js - IK / pose helpers for the commandos_a overlay (CC0 project code). Works on any UAL-named skeleton.
import * as THREE from 'three';

export const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
export const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());
export function setWorldQuat(b, q) { b.quaternion.copy(wquat(b.parent).invert().multiply(q)); b.updateMatrixWorld(true); }
export function rotWorld(b, q) { setWorldQuat(b, q.clone().multiply(wquat(b))); }
// swing bone b so that the world direction b->childPos becomes `dir` (minimal rotation)
export function aimBone(b, childPos, dir) {
  const cur = childPos.clone().sub(wpos(b)).normalize();
  rotWorld(b, new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize()));
}

// two-bone IK with an explicit pole: a (upper) -> b (mid) -> c (end) ; c's origin goes to `target`,
// the mid joint bends toward `pole` (a world point). c keeps (or takes) world rotation `endQ`.
export function twoBoneIKPole(a, b, c, target, pole, endQ = null) {
  a.updateMatrixWorld(true);
  const pa = wpos(a), pb = wpos(b), pc = wpos(c);
  const l1 = pb.distanceTo(pa), l2 = pc.distanceTo(pb);
  const keep = endQ || wquat(c);
  const toT = target.clone().sub(pa); let d = toT.length();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
  const n = toT.normalize();
  // elbow in the plane (a, target, pole)
  const pv = pole.clone().sub(pa); const perp = pv.addScaledVector(n, -pv.dot(n));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(n, -n.y);
  perp.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const elbow = pa.clone().addScaledVector(n, x).addScaledVector(perp, h);
  const end = pa.clone().addScaledVector(n, d);
  aimBone(a, pb, elbow.clone().sub(pa));
  aimBone(b, wpos(c), end.clone().sub(wpos(b)));
  setWorldQuat(c, keep);
  return wpos(c).distanceTo(target);
}

// hand frame: finger axis (hand -> middle_01) and palm normal (sign fixed so palms face DOWN in the UAL rest pose)
export function handFrame(B, s, sign) {
  const h = wpos(B['hand_' + s]), f = wpos(B['middle_01_' + s]).sub(h).normalize();
  const side = wpos(B['index_01_' + s]).sub(wpos(B['pinky_01_' + s])).normalize();
  const n = new THREE.Vector3().crossVectors(f, side).multiplyScalar(sign).normalize();
  return { f, n };
}
// world rotation for hand `s` so that its finger axis -> fDir and palm normal -> nDir
export function handQuat(B, s, sign, fDir, nDir) {
  const { f, n } = handFrame(B, s, sign);
  const m0 = basis(f, n), m1 = basis(fDir, nDir);
  const q0 = new THREE.Quaternion().setFromRotationMatrix(m0), q1 = new THREE.Quaternion().setFromRotationMatrix(m1);
  const delta = q1.multiply(q0.invert());
  return delta.multiply(wquat(B['hand_' + s]));
}
function basis(f, n) {
  const z = f.clone().normalize(); const y = n.clone().addScaledVector(z, -n.dot(z)).normalize(); const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
// palm contact point (in the hand) : 55% toward middle_01, pushed `off` metres along the palm normal
export function palmPoint(B, s, sign, off = 0.015) {
  const { n } = handFrame(B, s, sign);
  return wpos(B['hand_' + s]).lerp(wpos(B['middle_01_' + s]), 0.55).addScaledVector(n, off);
}
// palm sign: +1/-1 so that handFrame().n points down (-Y) in the skeleton's bind pose (call on an un-animated clone)
export function palmSigns(B) {
  const out = {};
  for (const s of ['l', 'r']) out[s] = handFrame(B, s, 1).n.y < 0 ? 1 : -1;
  return out;
}
