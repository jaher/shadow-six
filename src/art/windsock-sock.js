/**
 * Continuous windsock fabric: one tapered, banded tube bent along a smooth spine, replacing the library model's four
 * rigid hinged segments (sock_seg1..4), whose joints showed slits and overlapping ring edges when the sock drooped.
 * The segment nodes are still posed (they carry the hinge angles and the tests read them); only their meshes hide.
 *
 *   const sock = createWindsockSock(redMat, whiteMat);   // add sock.mesh under every LOD's sock_yaw node
 *   sock.update([a1, a2, a3, a4], fill, time);           // hinge angles (rad, + = droop), fill 0..1, seconds
 *
 * Spine: the bend angle θ(s) along the arc length s is piecewise linear through the rigid chain's cumulative angles
 * at the segment midpoints, so the tube follows the same envelope as the hinges, with no kinks. Shape: throat Ø 0.9 m
 * tapering to Ø 0.3 m over 3.6 m, five 0.72 m bands red / white / red / white / red (library windsock dims).
 * A limp sock (low fill) also collapses: the cloth flattens and narrows toward the tail; a full one ripples slightly.
 * @module art/windsock-sock
 */

import * as THREE from 'three';

export const SOCK = Object.freeze({ length: 3.6, r0: 0.45, r1: 0.15, bands: 5, segL: 30, segR: 20, hinge: 0.9 });

/** Bend angle at arc length s from the four hinge angles (cumulative chain angle at each segment's midpoint). */
export function sockBendAt(angles, s) {
  const n = angles.length, h = SOCK.length / n;
  const cum = []; let a = 0;
  for (const x of angles) cum.push(a += x);
  const u = s / h - 0.5; // knot k at the midpoint of segment k
  if (u <= 0) return cum[0] * Math.max(0.5, 1 + u); // half the first hinge bends right at the hoop
  if (u >= n - 1) return cum[n - 1];
  const k = Math.floor(u), f = u - k;
  return cum[k] + (cum[k + 1] - cum[k]) * f;
}

/**
 * @param {THREE.Material} red @param {THREE.Material} white (the library's veh:red / veh:white, double-sided)
 * @returns {{mesh: THREE.Mesh, geometry: THREE.BufferGeometry, update: (angles: number[], fill: number, t: number) => void, spine: (s:number)=>THREE.Vector3}}
 */
export function createWindsockSock(red, white) {
  const { segL, segR } = SOCK, ringN = segR + 1, nV = (segL + 1) * ringN;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  for (let i = 0; i <= segL; i++) for (let j = 0; j <= segR; j++) {
    const k = i * ringN + j; uv[k * 2] = j / segR; uv[k * 2 + 1] = i / segL;
  }
  const redIdx = [], whiteIdx = [], perBand = segL / SOCK.bands;
  for (let i = 0; i < segL; i++) {
    const out = Math.floor(i / perBand) % 2 === 0 ? redIdx : whiteIdx;
    for (let j = 0; j < segR; j++) {
      const a = i * ringN + j, b = a + 1, c = a + ringN, d = c + 1;
      out.push(a, b, c, b, d, c); // counter-clockwise seen from outside (front face = outer cloth)
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // the library materials are vertex-coloured (COLOR_0 bake ≈ 0.83 on the sock): the same level, stitched seams + hems
  const col = new Float32Array(nV * 3);
  for (let i = 0; i <= segL; i++) {
    const s = i / segL, edge = Math.min(1, Math.abs(((s * SOCK.bands) % 1) - 0.5) * 2); // 1 at a band seam
    const v = 0.83 * (1 - 0.08 * Math.pow(edge, 6) - 0.12 * (i === 0 || i === segL ? 1 : 0)); // GLB bake ≈ 0.83; seams, hems
    for (let j = 0; j <= segR; j++) col.fill(v, (i * ringN + j) * 3, (i * ringN + j) * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex([...redIdx, ...whiteIdx]);
  geometry.addGroup(0, redIdx.length, 0);
  geometry.addGroup(redIdx.length, whiteIdx.length, 1);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1.2, 1.4), 2.6); // covers droop .. streamed
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -3.7, -0.5), new THREE.Vector3(0.5, 0.5, 3.7));
  const mesh = new THREE.Mesh(geometry, [red, white]);
  mesh.name = 'sock_cloth'; mesh.castShadow = true; mesh.receiveShadow = true;

  const P = [], TH = [];
  const spine = (s) => {
    const i = Math.max(0, Math.min(segL, Math.round((s / SOCK.length) * segL)));
    return new THREE.Vector3(0, P[i * 2], P[i * 2 + 1]);
  };
  function update(angles, fill = 1, t = 0) {
    const ds = SOCK.length / segL;
    let y = 0, z = 0;
    for (let i = 0; i <= segL; i++) { // integrate the spine in the sock's y-z plane (+z = streamed out, + angle = down)
      const s = i * ds, th = sockBendAt(angles, s);
      if (i > 0) { const tm = sockBendAt(angles, s - ds / 2); y -= Math.sin(tm) * ds; z += Math.cos(tm) * ds; }
      P[i * 2] = y; P[i * 2 + 1] = z; TH[i] = th;
    }
    const limp = 1 - Math.max(0, Math.min(1, fill));
    for (let i = 0; i <= segL; i++) {
      const s = i / segL, th = TH[i], cy = Math.cos(th), sy = Math.sin(th);
      // normal N (in the bend plane, perpendicular to the tangent (0,-sin,cos)) = (0, cos, sin); binormal = +x
      let r = SOCK.r0 + (SOCK.r1 - SOCK.r0) * s;
      r *= 1 - limp * 0.22 * s + (1 - limp) * 0.025 * Math.sin(t * 9 - s * 11) * s; // collapse when limp, ripple when full
      const flat = 1 - limp * 0.2 * Math.min(1, s * 1.6); // a limp sock hangs flattened (side to side stays wide)
      // a slack sock falls into lengthwise folds (deeper toward the tail), which smooth out as it fills
      const fold = limp * 0.07 * Math.min(1, s * 2.5), fph = 1.3 + s * 2.2;
      for (let j = 0; j <= segR; j++) {
        const a = (j / segR) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), k = (i * ringN + j) * 3;
        const fr = 1 + fold * Math.sin(5 * a + fph), q = (fold * 5 * Math.cos(5 * a + fph)) / fr; // q = r'(α) / r
        const ox = r * fr * ca, on = r * fr * sa * flat;
        pos[k] = ox; pos[k + 1] = P[i * 2] + on * cy; pos[k + 2] = P[i * 2 + 1] + on * sy;
        const nx = ca * flat + sa * q * flat, nn = sa - ca * q; // section normal ∝ (y', -x') of (r·cos, r·sin·flat)
        const nl = Math.hypot(nx, nn) || 1;
        nor[k] = nx / nl; nor[k + 1] = (nn / nl) * cy; nor[k + 2] = (nn / nl) * sy;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
  }
  update([0, 0, 0, 0], 1, 0);
  return { mesh, geometry, update, spine };
}
