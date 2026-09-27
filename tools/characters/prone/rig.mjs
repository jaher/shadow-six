// rig.mjs - UAL skeleton posing kit for the prone clip baker (CC0 project code).
// World-direction authoring: every bone is set from a world "along" direction (toward its main child joint) and a
// world "front" direction (the rest-pose +Z side: belly/face for the spine, thumb side for the arms, kneecap for the
// legs, instep for the feet), so a pose is written as geometry (where the elbow is, which way the forearm points)
// instead of Euler angles. Frame: the character faces +Z, +X is his left, +Y up, ground at y = 0 (UAL, 1.80 m).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync } from 'node:fs';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FING = ['thumb', 'index', 'middle', 'ring', 'pinky'];
// main child joint per bone (defines the bone's "along" axis)
const CHILD = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'Head', Head: null };
for (const s of ['l', 'r']) Object.assign(CHILD, {
  ['clavicle_' + s]: 'upperarm_' + s, ['upperarm_' + s]: 'lowerarm_' + s, ['lowerarm_' + s]: 'hand_' + s, ['hand_' + s]: 'middle_01_' + s,
  ['thigh_' + s]: 'calf_' + s, ['calf_' + s]: 'foot_' + s, ['foot_' + s]: 'ball_' + s, ['ball_' + s]: 'ball_leaf_' + s,
});
for (const s of ['l', 'r']) for (const f of FING) for (let i = 1; i <= 3; i++) CHILD[`${f}_0${i}_${s}`] = i < 3 ? `${f}_0${i + 1}_${s}` : `${f}_04_leaf_${s}`;
export const ANIMATED = Object.keys(CHILD);

export async function loadUAL(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(ab, '', res, rej));
  return new Rig(g.scene, g.animations);
}

export class Rig {
  constructor(scene, animations = []) {
    this.scene = scene; this.animations = animations; this.B = {};
    scene.traverse((o) => { if (o.name && !(o.name in this.B)) this.B[o.name] = o; });
    this.rest = {};
    for (const n of Object.keys(this.B)) this.rest[n] = { p: this.B[n].position.clone(), q: this.B[n].quaternion.clone() };
    scene.updateMatrixWorld(true);
    this.restW = {}; this.len = {};
    for (const n of ANIMATED) {
      const b = this.B[n]; if (!b) continue;
      const qw = b.getWorldQuaternion(new THREE.Quaternion()), p = this.wp(n);
      const c = CHILD[n] && this.B[CHILD[n]] ? this.wp(CHILD[n]) : null;
      const along = c ? c.clone().sub(p).normalize() : V(0, 1, 0).applyQuaternion(qw);
      this.len[n] = c ? c.distanceTo(p) : 0.2;
      // rest "front": +Z world for everything (arms in the T-pose: thumb side; legs: kneecap; spine/head: belly/face);
      // the feet point forward-down at rest, so their front is the instep (+Y world)
      const f0 = /^(foot|ball)_/.test(n) ? V(0, 1, 0) : V(0, 0, 1);
      this.restW[n] = { q: qw, basis: basis(along, f0) };
    }
  }
  wp(n) { return this.B[n].getWorldPosition(new THREE.Vector3()); }
  wq(n) { return this.B[n].getWorldQuaternion(new THREE.Quaternion()); }
  reset() { for (const n in this.rest) { this.B[n].position.copy(this.rest[n].p); this.B[n].quaternion.copy(this.rest[n].q); } this.update(); }
  update() { this.scene.updateMatrixWorld(true); }
  /** World rotation of bone n so that its along axis points `along` and its front side faces `front`. */
  orient(n, along, front) {
    const R = this.restW[n]; if (!R) return;
    const Rw = basis(along, front).multiply(R.basis.clone().transpose());   // rest-world frame -> target frame
    const qw = new THREE.Quaternion().setFromRotationMatrix(Rw).multiply(R.q);
    const b = this.B[n]; b.parent.updateMatrixWorld(true);
    b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(qw));
    b.updateMatrixWorld(true);
  }
  /** World quaternion bone n would get from orient(n, along, front). */
  worldQ(n, along, front) {
    const R = this.restW[n];
    return new THREE.Quaternion().setFromRotationMatrix(basis(along, front).multiply(R.basis.clone().transpose())).multiply(R.q);
  }
  /**
   * Arm IK: palm point of hand s at `palm` with the hand along `ha` / thumb toward `thumb`, elbow toward `pole`.
   * Returns the palm error (m).
   */
  handTo(s, palm, ha, thumb, pole) {
    const Q = this.worldQ('hand_' + s, ha, thumb);
    const off = this.B['middle_01_' + s].position.clone().multiplyScalar(0.55).applyQuaternion(Q);
    const W = palm.clone().sub(off);
    const fr = (d1, d2) => { const f = d2.clone().addScaledVector(d1, -d2.dot(d1)); return f.lengthSq() > 1e-6 ? f : thumb; };
    this.chain('upperarm_' + s, 'lowerarm_' + s, W, pole, fr, (d1, d2) => thumb);
    this.orient('hand_' + s, ha, thumb); this.update();
    return this.wp('hand_' + s).lerp(this.wp('middle_01_' + s), 0.55).distanceTo(palm);
  }
  /** Rotate bone n by world rotation q (keeps children attached). */
  rotW(n, q) {
    const b = this.B[n]; b.parent.updateMatrixWorld(true);
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.clone().invert().multiply(q).multiply(pq).multiply(b.quaternion)); b.updateMatrixWorld(true);
  }
  /** Current world along / front of bone n. */
  axes(n) {
    const R = this.restW[n], q = this.wq(n).multiply(R.q.clone().invert());
    const e = R.basis.elements;
    return { along: V(e[4], e[5], e[6]).applyQuaternion(q), front: V(e[8], e[9], e[10]).applyQuaternion(q) };
  }
  /** Put the pelvis bone origin at world p. */
  pelvisAt(p) { const b = this.B.pelvis; b.parent.updateMatrixWorld(true); b.position.copy(b.parent.worldToLocal(p.clone())); b.updateMatrixWorld(true); }
  /** Two-bone chain a-b-c: joint b placed toward `pole`, c at `target` (clamped to reach); fronts from `frontOf`. */
  chain(a, b, target, pole, frontA, frontB) {
    const A = this.wp(a), L1 = this.len[a], L2 = this.len[b];
    const d = target.clone().sub(A); const D = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
    const u = d.normalize();
    const cosA = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pv = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const K = A.clone().addScaledVector(u, L1 * cosA).addScaledVector(pv, L1 * sinA);
    const C = A.clone().addScaledVector(u, D);
    const d1 = K.clone().sub(A).normalize(), d2 = C.clone().sub(K).normalize();
    this.orient(a, d1, frontA(d1, d2)); this.orient(b, d2, frontB(d1, d2));
    return K;
  }
  /** Curl the fingers of hand s: amount 0 (flat) .. 1 (fist); thumb separately; spread fans the fingers. */
  curl(s, amt, thumb = amt * 0.6, spread = 0) {
    // hinge axes from the rest pose (world): palm normal is -Y (T-pose palms down), fingers point out along +-X
    const sx = s === 'l' ? 1 : -1, along = V(sx, 0, 0), palmN = V(0, -1, 0);
    const hinge = new THREE.Vector3().crossVectors(along, palmN);             // fingers roll toward the palm
    for (const f of FING) for (let i = 1; i <= 3; i++) {
      const n = `${f}_0${i}_${s}`, b = this.B[n]; if (!b) continue;
      const R = this.restW[n]; b.quaternion.copy(this.rest[n].q);
      let ax = hinge, k = amt * (i === 1 ? 1.35 : i === 2 ? 1.6 : 1.1);
      if (f === 'thumb') { const ta = V(R.basis.elements[4], R.basis.elements[5], R.basis.elements[6]); ax = new THREE.Vector3().crossVectors(ta, palmN.clone().add(V(0, 0, -0.6))).normalize(); k = thumb * (i === 1 ? 0.5 : 0.8); }
      b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax.clone().applyQuaternion(R.q.clone().invert()).normalize(), k));
      if (spread && i === 1 && f !== 'thumb') b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(palmN.clone().applyQuaternion(R.q.clone().invert()), sx * spread * ({ index: 1, middle: 0.3, ring: -0.4, pinky: -1 })[f]));
    }
  }
  /** Snapshot of local quaternions (ANIMATED bones) + pelvis local position. */
  snap() {
    const q = {}; for (const n of ANIMATED) if (this.B[n]) q[n] = this.B[n].quaternion.toArray();
    return { q, p: this.B.pelvis.position.toArray() };
  }
  apply(s) { for (const n in s.q) this.B[n].quaternion.fromArray(s.q[n]); this.B.pelvis.position.fromArray(s.p); this.update(); }
}

/** Orthonormal basis matrix with columns [x = front × along... ]: y = along, z = front (orthogonalised), x = y × z. */
export function basis(along, front) {
  const y = along.clone().normalize();
  const z = front.clone().addScaledVector(y, -front.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
