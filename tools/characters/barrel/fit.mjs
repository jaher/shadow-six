// fit.mjs - clearance of the Green Beret's skinned body to the drum (CC0 project code): the bake's check and fit.
//
// The same test as the in-game capture (commandos-shots barrel-carry tools/capture.mjs): every vertex of his drawn
// meshes (LOD0, LOD0_alpha, headgear), skinned on the CPU, its region from its dominant bone; the signed distance to
// the drum cylinder (hoop radius, base to top) in the drum's own frame, negative inside.
import * as THREE from 'three';
import { DRUM } from './barrel_pose.mjs';

const regionOf = (n) => /^(hand|index|middle|pinky|ring|thumb)/.test(n) ? 'hand' + (n.endsWith('_l') ? 'L' : 'R')
  : /^(lowerarm|upperarm|clavicle)/.test(n) ? 'arm' : /^(Head|neck)/.test(n) ? 'head' : /^(spine|pelvis|root)/.test(n) ? 'torso' : 'leg';
export const REGIONS = ['handL', 'handR', 'arm', 'head', 'torso', 'leg'];

/** Per-vertex region / skull flags of R.meshes (cached on R). */
function tables(R) {
  if (R._fit) return R._fit;
  R._fit = R.meshes.map((o) => {
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, bn = o.skeleton.bones;
    const reg = new Array(si.count), skull = new Uint8Array(si.count);
    for (let i = 0; i < si.count; i++) {
      let bi = si.getX(i), bw = sw.getX(i);
      for (const [a, b] of [[si.getY(i), sw.getY(i)], [si.getZ(i), sw.getZ(i)], [si.getW(i), sw.getW(i)]]) if (b > bw) { bw = b; bi = a; }
      reg[i] = regionOf(bn[bi].name);
      skull[i] = bn[bi].name === 'Head' && bw > 0.6 && o.name === 'LOD0' ? 1 : 0;
    }
    return { o, reg, skull, n: si.count };
  });
  return R._fit;
}

/**
 * Clearance of the posed body to the drum at world frame M (Matrix4: origin = base centre, +y = axis).
 * @returns {{[region:string]: {min:number, deep:number, n:number}, chin:number, headLow:number}} min: closest vertex (m,
 *   < 0 inside); deep: vertices more than 1 cm inside; chin: lowest skull vertex (world y)
 */
export function clearance(R, M, { r = DRUM.r, h = DRUM.h, tol = 0.01 } = {}) {
  R.update();
  const inv = M.clone().invert(), v = new THREE.Vector3(), out = { chin: 1e9 };
  for (const k of REGIONS) out[k] = { min: 1e9, deep: 0, n: 0 };
  for (const T of tables(R)) {
    for (let i = 0; i < T.n; i++) {
      T.o.getVertexPosition(i, v); v.applyMatrix4(T.o.matrixWorld);
      if (T.skull[i] && v.y < out.chin) out.chin = v.y;
      v.applyMatrix4(inv);
      const dh = Math.hypot(v.x, v.z) - r, dy = Math.max(v.y - h, -v.y);
      const sd = dh <= 0 && dy <= 0 ? Math.max(dh, dy) : Math.hypot(Math.max(dh, 0), Math.max(dy, 0));
      const A = out[T.reg[i]];
      if (sd < A.min) A.min = sd;
      if (sd < 0) A.n++;
      if (sd < -tol) A.deep++;
    }
  }
  return out;
}

/** One line: closest vertex per region (cm) and the deep counts. */
export function fmtClear(c) {
  return REGIONS.map((k) => `${k} ${(c[k].min * 100).toFixed(1)}${c[k].deep ? `(!${c[k].deep})` : ''}`).join('  ');
}
