import * as THREE from 'three';
import { dressingMaterial, consolidate, rng, seedOf, boxUV } from './dressing.js';

/**
 * M3 art pass: the Norwegian roundpole fence (skigard) — pairs of upright stakes (staur) every ~1.5 m, tied with
 * withies (band) at three heights, and split poles (skier) leaning ~40° along the run, laid through each pair and
 * resting on the next, all the same way. Grey weathered timber; one merged mesh per material (two draws for a run).
 * A see-through fence (`fence` type, B.FENCE footprint): a man cannot step through it, eyes see between the poles.
 * @param {number[][]} points polyline [x, z]
 * @param {{h?: number, id?: string}} o h = height of the top pole ends (default 1.25 m)
 * @returns {THREE.Group}
 */
export function buildSkigard(points, { h = 1.25, id = 'skigard' } = {}) {
  const g = new THREE.Group(); g.name = 'kit:fence:skigard';
  const R = rng(seedOf(id)), wood = dressingMaterial('logs'), band = dressingMaterial('beam');
  const stakeGeo = boxUV(new THREE.CylinderGeometry(0.04, 0.05, 1, 6), 1);
  const poleGeo = boxUV(new THREE.CylinderGeometry(0.035, 0.045, 1, 5), 1);
  const bandGeo = new THREE.TorusGeometry(0.1, 0.018, 4, 8);
  const add = (geo, mat, x, y, z, sy, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(1, sy, 1); m.rotation.set(rx, ry, rz, 'YXZ');
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const lean = THREE.MathUtils.degToRad(40), run = h / Math.tan(lean); // horizontal reach of one pole
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, yaw = Math.atan2(-uz, ux);
    const n = Math.max(1, Math.round(L / 1.5)), step = L / n;
    for (let i = 0; i <= n; i++) {
      if (k > 0 && i === 0) continue; // the joint's pair belongs to the previous run
      const t = i * step, x = ax + ux * t, z = az + uz * t, sh = h + 0.18 + R() * 0.12;
      for (const s of [-1, 1]) add(stakeGeo, wood, x + nx * s * 0.07, sh / 2 - 0.05, z + nz * s * 0.07, sh, (R() - 0.5) * 0.06, 0, s * 0.05);
      for (const y of [0.3, 0.72, h - 0.05]) add(bandGeo, band, x, y, z, 1, Math.PI / 2, yaw + Math.PI / 2, 0);
    }
    // the skier: from the ground at t up to the top of the pair ahead, one every ~0.32 m, all leaning the same way
    // (the run's first and last poles are cut short so nothing reaches past its end stakes)
    const lenPole = Math.hypot(run, h) + 0.2;
    for (let tm = 0.12; tm < L - 0.1; tm += 0.3 + R() * 0.06) {
      const reach = Math.min(1, (2 * Math.min(tm, L - tm)) / (Math.cos(lean) * lenPole)), side = (R() - 0.5) * 0.06;
      const x = ax + ux * tm + nx * side, z = az + uz * tm + nz * side, len = lenPole * reach;
      if (len < 0.4) continue;
      add(poleGeo, wood, x, (h / 2 + 0.02) * (tm < L / 2 ? reach : 1) + (tm < L / 2 ? 0 : (h / 2 + 0.02) * (1 - reach)), z, len, 0, yaw,
        -(Math.PI / 2 - lean) + (R() - 0.5) * 0.05);
    }
  }
  return consolidate(g);
}
