// barrel_pose.mjs - the Green Beret's explosive-drum hold on his own skeleton (CC0 project code).
//
// Pose kit for bake_barrel.mjs. Everything is authored on greenberet.glb (the only man who carries a drum: items.js
// PICKUP_ROLES.barrel), so the clips' local rotations put HIS hands exactly where they were solved. Frame: he faces
// +Z, +X is his left, +Y up, ground at y = 0 (the GLB's own: 1.99 m with the beret, hip joints at 1.10 m).
//
// The drum frame D: origin at the centre of the drum's base, x = his left, y = the drum's axis (up), z = forward.
// The grip is one fixed place in D for every clip (both palms on the sides, a little behind the widest line, above the
// middle, fingers forward round the drum, thumbs up): so the drum can be read back from either hand bone at run time
// (art/barrel-carry.js) and stays on the hands through every cross-fade.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readGlbArrayBuffer } from '../../glb-io.mjs';
import { Rig, V } from '../prone/rig.mjs';
export { V };

export const D2R = Math.PI / 180;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const sstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const frac = (x) => x - Math.floor(x);

/** The drum (art/kit-props.js buildExplosiveDrum): hoop radius, height. */
export const DRUM = { r: 0.321, h: 0.916 };
/**
 * The grip in the drum frame: palm point (hand bone → 0.55 of the way to middle_01, the runtimes' palm()) `out` m off
 * the hoop radius, `ang` rad behind the widest line (toward his chest), `h` m above the base.
 */
export const GRIP = { out: 0.032, ang: 22 * D2R, h: 0.60, curl: 0.06, thumb: -0.4 };

/** GLB in node, geometry and bones only. */
export async function loadGlb(path) {
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  return new Promise((res, rej) => L.parse(readGlbArrayBuffer(path), '', res, rej));
}

/** The Green Beret's rig (Rig of prone/rig.mjs on greenberet.glb) + his skinned meshes. */
export async function loadGB(root) {
  const g = await loadGlb(new URL('assets/characters/commandos/greenberet.glb', root).pathname);
  const R = new Rig(g.scene);
  R.gltf = g;
  R.info = g.scene.userData.shadowSix || {};
  R.meshes = [];
  g.scene.traverse((o) => { if (o.isSkinnedMesh && /^(LOD0|LOD0_alpha|headgear)$/.test(o.name)) R.meshes.push(o); });
  // palm normals / finger axes at rest (hand space) for the hand orientation and the finger curl
  R.handRest = {};
  for (const s of ['l', 'r']) {
    const h = R.wp('hand_' + s), f = R.wp('middle_01_' + s).sub(h).normalize();
    const u = R.wp('index_01_' + s).sub(R.wp('pinky_01_' + s)).normalize();       // toward the thumb side
    const n = (s === 'l' ? new THREE.Vector3().crossVectors(f, u) : new THREE.Vector3().crossVectors(u, f)).normalize(); // palm faces
    R.handRest[s] = { f, n, q: R.wq('hand_' + s), palm: R.B['middle_01_' + s].position.clone().multiplyScalar(0.55) };
  }
  return R;
}

const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
/** Set bone n's WORLD rotation. */
export function setWorldQ(R, n, q) {
  const b = R.B[n]; b.parent.updateMatrixWorld(true);
  b.quaternion.copy(b.parent.getWorldQuaternion(q0).invert().multiply(q)); b.updateMatrixWorld(true);
}
/** World rotation taking the orthonormal pair (a0, b0) onto (a1, b1). */
export function pairQ(a0, b0, a1, b1) {
  const m = (a, b) => { const x = a.clone().normalize(), z = new THREE.Vector3().crossVectors(x, b).normalize(), y = new THREE.Vector3().crossVectors(z, x); return new THREE.Matrix4().makeBasis(x, y, z); };
  return new THREE.Quaternion().setFromRotationMatrix(m(a1, b1).multiply(m(a0, b0).transpose()));
}

/** Rotation for a body segment: yaw (+ = turns left), pitch (+ = leans forward), roll (+ = leans to his right). */
export function segQ(yaw = 0, pitch = 0, roll = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, -roll, 'YXZ'));
}
const UP = V(0, 1, 0), FWD = V(0, 0, 1);

/**
 * Standing torso: hip-joint centre at `hip`; pelvis yaw / pitch / roll; the spine bends `back` (rad, + = leans back) more
 * toward the chest, twists `twist` and leans sideways `side` (+ = to his right) at the chest; neck / head look ahead,
 * the head pitched `head` (+ = down) and turned `headYaw`.
 */
export function torso(R, o) {
  const yaw = o.yaw || 0, pitch = o.pitch || 0, roll = o.roll || 0;
  const P = segQ(yaw, pitch, roll);
  R.orient('pelvis', UP.clone().applyQuaternion(P), FWD.clone().applyQuaternion(P)); R.update();
  const hc = R.wp('thigh_l').lerp(R.wp('thigh_r'), 0.5);
  R.pelvisAt(R.wp('pelvis').add(o.hip.clone().sub(hc))); R.update();
  const back = o.back || 0, tw = o.twist || 0, sd = o.side || 0;
  for (const [n, k] of [['spine_01', 0.25], ['spine_02', 0.6], ['spine_03', 1]]) {
    const Q = segQ(yaw + tw * k, pitch - back * k, roll + sd * k);
    R.orient(n, UP.clone().applyQuaternion(Q), FWD.clone().applyQuaternion(Q));
  }
  const ch = pitch - back;
  const N = segQ(yaw + tw * 0.6, ch * 0.45 + (o.neck ?? 0.1), (roll + sd) * 0.3);
  R.orient('neck_01', UP.clone().applyQuaternion(N), FWD.clone().applyQuaternion(N));
  const H = segQ(yaw + (o.headYaw || 0), o.head ?? 0.05, 0);
  R.orient('Head', UP.clone().applyQuaternion(H), FWD.clone().applyQuaternion(H));
  R.update();
}

/** Shoulders drawn forward (`prot`, rad) and up (`elev`, rad) round the load, about the chest's own axes. */
export function shoulders(R, prot = 0, elev = 0) {
  const C = R.wq('spine_03').multiply(R.restW.spine_03.q.clone().invert());
  const up = UP.clone().applyQuaternion(C), fw = FWD.clone().applyQuaternion(C);
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1;
    R.rotW('clavicle_' + s, new THREE.Quaternion().setFromAxisAngle(up, -sx * prot).multiply(new THREE.Quaternion().setFromAxisAngle(fw, -sx * elev)));
  }
  R.update();
}

/** Palm point of hand s (the runtimes' palm(): hand bone → middle_01 at 0.55). */
export const palmOf = (R, s) => R.wp('hand_' + s).lerp(R.wp('middle_01_' + s), 0.55);

/**
 * Arm IK: palm point at `palm`, fingers along `F`, palm facing `N`, elbow toward `pole`. @returns palm error (m)
 */
export function handTo(R, s, palm, F, N, pole) {
  const H = R.handRest[s];
  const Q = pairQ(H.f, H.n, F, N).multiply(H.q);
  // (the palm offset: 0.55 of middle_01's local position in hand space, turned by the hand's world rotation)
  const W = palm.clone().sub(H.palm.clone().applyQuaternion(Q));
  const thumb = new THREE.Vector3().crossVectors(N, F).multiplyScalar(s === 'l' ? 1 : -1).normalize();   // thumb side
  R.chain('upperarm_' + s, 'lowerarm_' + s, W, pole, (d1, d2) => { const f = d2.clone().addScaledVector(d1, -d2.dot(d1)); return f.lengthSq() > 1e-6 ? f : thumb; }, () => thumb);
  setWorldQ(R, 'hand_' + s, Q); R.update();
  return palmOf(R, s).distanceTo(palm);
}

/** Relaxed hanging arm: hand at `palm` (world), fingers down, palm toward the thigh, elbow back. */
export function hangArm(R, s, palm) {
  const sx = s === 'l' ? 1 : -1;
  return handTo(R, s, palm, V(0, -1, 0.15).normalize(), V(-sx, 0, 0.1).normalize(), V(sx * 0.2, 0, -1));
}

/** Fingers of hand s curled `amt` rad per joint (thumb `th`), about hinges from the rest geometry (A-pose safe). */
export function curl(R, s, amt, th = amt * 0.5, spread = 0) {
  const H = R.handRest[s];
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) for (let i = 1; i <= 3; i++) {
    const n = `${f}_0${i}_${s}`, b = R.B[n]; if (!b) continue;
    b.quaternion.copy(R.rest[n].q);
    const Rw = R.restW[n];
    const along = V(Rw.basis.elements[4], Rw.basis.elements[5], Rw.basis.elements[6]);
    const hinge = new THREE.Vector3().crossVectors(along, H.n).normalize();
    let k = f === 'thumb' ? th * (i === 1 ? 0.4 : 0.7) : amt * (i === 1 ? 0.8 : i === 2 ? 1.1 : 0.8);
    if (f !== 'thumb' && i === 1 && spread) k = k;
    const local = hinge.clone().applyQuaternion(Rw.q.clone().invert()).normalize();
    b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(local, k));
    if (spread && i === 1 && f !== 'thumb') {
      const sp = ({ index: 1, middle: 0.3, ring: -0.4, pinky: -1 })[f] * spread;
      b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(H.n.clone().applyQuaternion(Rw.q.clone().invert()).normalize(), sp));
    }
  }
  R.update();
}

/**
 * Leg: ankle at A, knee toward `pole`, foot turned `yaw` (+ = toes left) and pitched `pitch` (+ = heel up / toes down),
 * the toes (ball) flat on the ground when `toesFlat`.
 */
export function leg(R, s, A, pole, yaw = 0, pitch = 0, toesFlat = false) {
  const kf = (d) => { const f = pole.clone().addScaledVector(d, -pole.dot(d)); return f.lengthSq() > 1e-8 ? f.normalize() : FWD.clone(); };
  R.chain('thigh_' + s, 'calf_' + s, A, pole, (d1) => kf(d1), (d1, d2) => kf(d2));
  R.update();
  const Y = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  const lat = V(1, 0, 0).applyQuaternion(Y);
  const Q = new THREE.Quaternion().setFromAxisAngle(lat, pitch).multiply(Y).multiply(R.restW['foot_' + s].q);
  setWorldQ(R, 'foot_' + s, Q);
  if (toesFlat) setWorldQ(R, 'ball_' + s, Y.clone().multiply(R.restW['ball_' + s].q));
  else { R.B['ball_' + s].quaternion.copy(R.rest['ball_' + s].q); }
  R.update();
}

/** Rest-pose geometry of a foot: ankle relative to the ball joint and to the heel point (ground contact). */
export function footGeo(R, s) {
  const A = R.restAnkle?.[s];
  if (A) return A;
  const ank = R.restPos['foot_' + s], ball = R.restPos['ball_' + s];
  const heel = V(ank.x, 0, ank.z - 0.05);
  const g = { ankFromBall: ank.clone().sub(V(ball.x, 0, ball.z)), ankFromHeel: ank.clone().sub(heel), len: ball.z - heel.z, ank, ball };
  (R.restAnkle ||= {})[s] = g;
  return g;
}

/**
 * Ankle position for a foot on the ground: `at` = the ground point under the ankle at rest (x, z), turned `yaw`, the
 * foot pitched `pitch` about the heel (< 0: toes up at the heel strike) or about the ball (> 0: heel off), lifted `lift`.
 */
export function ankleFor(R, s, at, yaw, pitch, lift = 0) {
  const g = footGeo(R, s), Y = new THREE.Quaternion().setFromAxisAngle(UP, yaw), lat = V(1, 0, 0).applyQuaternion(Y);
  const base = V(at.x, 0, at.z);
  const restAnk = V(0, g.ank.y, 0);                                       // ankle above `at` when flat
  let pivot, rel;
  if (pitch < 0) { pivot = base.clone().add(V(0, 0, -0.05).applyQuaternion(Y)); rel = restAnk.clone().sub(V(0, 0, -0.05)).applyQuaternion(Y); }
  else { const bz = g.ball.z - g.ank.z; pivot = base.clone().add(V(0, 0, bz).applyQuaternion(Y)); rel = restAnk.clone().sub(V(0, 0, bz)).applyQuaternion(Y); }
  rel.applyAxisAngle(lat, pitch);
  return pivot.add(rel).add(V(0, lift, 0));
}

/** Drum frame (Matrix4) from its base centre, tilt (rad, + = top toward him) and yaw. */
export function drumFrame(base, tilt = 0, yaw = 0) {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -tilt));
  return new THREE.Matrix4().compose(base.clone(), q, V(1, 1, 1));
}
/** Grip targets of hand s in the world for drum frame M: palm point, finger direction, palm normal. */
export function gripOf(M, s, G = GRIP) {
  const sx = s === 'l' ? 1 : -1, r = DRUM.r + G.out;
  const radial = V(sx * Math.cos(G.ang), 0, -Math.sin(G.ang));            // out of the drum's side, a little back
  const tang = V(sx * Math.sin(G.ang), 0, Math.cos(G.ang));               // round the drum toward its front
  const palm = radial.clone().multiplyScalar(r).add(V(0, G.h, 0));
  const F = tang.clone().addScaledVector(V(0, -1, 0), 0.32).normalize();   // fingers forward and a little down
  const N = radial.clone().negate();                                       // palm on the drum
  const rot = new THREE.Quaternion().setFromRotationMatrix(M);
  return { palm: palm.applyMatrix4(M), F: F.applyQuaternion(rot), N: N.applyQuaternion(rot) };
}
/** Both hands onto the drum at frame M (elbows out and back). @returns max palm error (m) */
export function gripDrum(R, M, { elbowOut = 1, elbowBack = 0.55, elbowDown = 0.6, curlAmt = GRIP.curl, thumb = GRIP.thumb } = {}) {
  let err = 0;
  const rot = new THREE.Quaternion().setFromRotationMatrix(M);
  for (const s of ['l', 'r']) {
    const sx = s === 'l' ? 1 : -1, g = gripOf(M, s);
    const pole = V(sx * elbowOut, -elbowDown, -elbowBack).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, new THREE.Euler().setFromQuaternion(rot, 'YXZ').y));
    err = Math.max(err, handTo(R, s, g.palm, g.F, g.N, pole));
    curl(R, s, curlAmt, thumb);
  }
  return err;
}

/** Bone world positions at rest (before any posing). */
export function snapRest(R) {
  R.restPos = {};
  for (const n of Object.keys(R.B)) if (R.B[n].isBone) R.restPos[n] = R.wp(n);
}
