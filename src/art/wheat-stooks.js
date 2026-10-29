/**
 * M16 second art pass (the Maas, 4 September 1944): a row of wheat stooks on a harvested field — the sheaves bound at
 * the waist and stood up in pairs, ears together, to dry before carting (a "stook" / "shock" of 8–10 sheaves).
 * One row is a `crates` structure with `variant: 'wheat_stooks'` (art/props.js): `w` its length (local x), `d` its
 * depth, `n` the stooks along it; every stook stands inside its own `stookNavParts` rect (art/stook-layout.js: the
 * gameplay footprint the map builder blocks, B.LOW — what is drawn is what stops a walker; sight passes over a 1.25 m
 * stook as over any low cover). Merged per material (art/dressing.js consolidate): two draws per row (straw, twine).
 * @module art/wheat-stooks
 */
import * as THREE from 'three';
import { dressingMaterial, consolidate, rng, seedOf } from './dressing.js';
import { STOOK, stookX, stookCount } from './stook-layout.js';

export { STOOK, stookX, stookNavParts } from './stook-layout.js';

let SHEAF = null;
/** A bound sheaf, butt at y 0 and ears up: stubble-cut butt, tight waist at the twine band, the ears fanned out. */
function sheafGeometry() {
  if (SHEAF) return SHEAF;
  const prof = [[0.001, 0], [0.085, 0.0], [0.095, 0.08], [0.07, 0.42], [0.062, 0.5], [0.075, 0.58], [0.12, 0.86], [0.13, 0.98], [0.07, 1.1], [0.001, 1.13]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  SHEAF = new THREE.LatheGeometry(prof, 9);
  return SHEAF;
}

/**
 * @param {{id?: string, w?: number, d?: number, n?: number}} p
 * @returns {THREE.Group} the row, merged per material
 */
export function buildStooks(p) {
  const w = p.w ?? 9, n = stookCount({ ...p, w }), R = rng(seedOf(p.id ?? `stooks@${p.x},${p.z}`));
  const g = new THREE.Group(); g.name = 'dressing:wheat_stooks';
  const sheaves = [], bands = [], M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const yawQ = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    // the stook's ridge runs along local z (north–south on a row along x, as stooks were set to dry both faces),
    // its pairs of sheaves leaning together across it (local x)
    const cx = stookX(k, n, w) + (R() - 0.5) * 0.1, yaw = (R() - 0.5) * 0.3, pairs = R() < 0.5 ? 4 : 5;
    yawQ.setFromAxisAngle(UP, yaw);
    for (let i = 0; i < pairs; i++) {
      for (const side of [-1, 1]) {
        const along = ((i - (pairs - 1) / 2) / pairs) * (STOOK.d - 0.35), lean = 0.36 + R() * 0.08;
        const bx = side * (0.3 + R() * 0.04), bz = along + (R() - 0.5) * 0.04;
        e.set((R() - 0.5) * 0.1, 0, side * lean, 'XYZ');
        q.copy(yawQ).multiply(new THREE.Quaternion().setFromEuler(e));
        const sc = 0.95 + R() * 0.12;
        s.set(sc, ((STOOK.h / 1.13) * (0.95 + R() * 0.04)) / Math.cos(lean), sc);
        t.set(bx, 0, bz).applyQuaternion(yawQ).add(new THREE.Vector3(cx, 0, 0));
        M.compose(t, q, s);
        sheaves.push(sheafGeometry().clone().applyMatrix4(M));
        bands.push(new THREE.CylinderGeometry(0.066, 0.066, 0.045, 9).translate(0, 0.5, 0).applyMatrix4(M));
      }
    }
  }
  for (const [list, mat] of [[sheaves, dressingMaterial('straw')], [bands, dressingMaterial('burlap')]]) {
    for (const geo of list) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    }
  }
  return consolidate(g);
}

/**
 * A kitchen garden's beds (variant 'garden_beds'): earthed-up rows of dug soil across the plot (local x) and a row of
 * cabbages / leeks along each. Under a picket fence, knee-high at most: nothing to stop a walker or an eye (block 0).
 * @param {{id?: string, w?: number, d?: number, rows?: number}} p plot w × d (m)
 * @returns {THREE.Group} merged per material (two draws)
 */
export function buildGardenBeds(p) {
  const w = p.w ?? 4, d = p.d ?? 3, rows = p.rows ?? Math.max(2, Math.round(d / 0.9)), R = rng(seedOf(p.id ?? `beds@${p.x},${p.z}`));
  const g = new THREE.Group(); g.name = 'dressing:garden_beds';
  const soil = dressingMaterial('mud'), leaf = dressingMaterial('sod');
  for (let r = 0; r < rows; r++) {
    const z = -d / 2 + (d * (r + 0.5)) / rows;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.12, Math.min(0.6, (d / rows) * 0.7)).translate(0, 0.06, z), soil);
    bed.receiveShadow = true; g.add(bed);
    const n = Math.max(2, Math.floor((w - 0.3) / 0.45));
    for (let k = 0; k < n; k++) {
      const s = 0.13 + R() * 0.05, x = -w / 2 + 0.25 + (k * (w - 0.5)) / (n - 1) + (R() - 0.5) * 0.06;
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1).scale(s, s * 0.75, s).translate(x, 0.12 + s * 0.6, z + (R() - 0.5) * 0.06), leaf);
      c.rotation.y = R() * 3; c.castShadow = true; c.receiveShadow = true; g.add(c);
    }
  }
  return consolidate(g);
}
