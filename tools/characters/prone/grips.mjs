// grips.mjs - weapon grip frames in hand-bone space (CC0 project code). A grip frame G is the pose of the weapon's
// grip point (origin) and axes (+Z muzzle, +Y sights) in the local space of hand_r; the runtime places a prop with
// weapon = hand_r.matrixWorld * G * roll * translate(-socket). Authored here from the baked poses so the weapon sits
// exactly where the clip expects it (fist around the sling at the front swivel, knife blade forward, ...).
import * as THREE from 'three';

/** Palm / fist centre of hand s (same point the runtime weapons.js palm() uses). */
export const fistPoint = (R, s) => R.wp('hand_' + s).lerp(R.wp('middle_01_' + s), 0.55);

/** World matrix of a weapon frame: origin p, forward d (+Z), up hint u (+Y). */
export function frameM(p, d, u) {
  const z = d.clone().normalize(), y = u.clone().addScaledVector(z, -u.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}
/** Hand-local grip frame from a hand pose and the wanted world weapon frame. */
export function gripFrom(R, s, Wm) {
  R.update();
  const H = R.B['hand_' + s].matrixWorld.clone();
  return H.invert().multiply(Wm);
}
/** World weapon frame (grip point) for grip G on hand s of the current pose. */
export const gripWorld = (R, s, G) => { R.update(); return R.B['hand_' + s].matrixWorld.clone().multiply(G); };
/** Round a matrix for export. */
export const packM = (m) => m.elements.map((v) => +v.toFixed(5));
