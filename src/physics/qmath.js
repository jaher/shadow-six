/**
 * Tiny quaternion / vector helpers for the physics sim (plain {x,y,z,w} objects; no three.js in the sim path).
 * @module physics/qmath
 */

export const qId = () => ({ x: 0, y: 0, z: 0, w: 1 });
export const qAxis = (ax, ay, az, a) => { const s = Math.sin(a / 2); return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) }; };
/** Rotation about +Y taking the local +Z (character forward) to world heading h (heading = atan2(dz, dx)). */
export const qHeading = (h) => qAxis(0, 1, 0, Math.PI / 2 - h);

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qNorm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; }

/** Rotate vector v by quaternion q. */
export function qRot(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z, iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
  return { x: ix * w + iw * -x + iy * -z - iz * -y, y: iy * w + iw * -y + iz * -x - ix * -z, z: iz * w + iw * -z + ix * -y - iy * -x };
}

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vCross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vLen = (a) => Math.hypot(a.x, a.y, a.z);
export function vNorm(a) { const l = vLen(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
/** Round to 1e-4 (deterministic, compact save values). */
export const r4 = (v) => Math.round(v * 1e4) / 1e4;
