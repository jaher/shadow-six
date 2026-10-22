/**
 * M0 art pass (the sandbox: an occupied Flemish fuel depot). `brick_depot` (+ `brick_depot_wire`): the depot's yard wall
 * the generic kit drew as plain brick boxes — red brick laid over a tarred plinth (Flemish `teerplint`), a blue-stone
 * (hardsteen) coping with a drip, brick pilasters every ~3.5 m and at every corner, and square gate piers with stone
 * caps at the run ends a mission names in `gatePiers` (the passage at the road). Those ends are flush (nothing reaches
 * into the passage); every other end keeps the half-width overlap that closes a corner with the next run.
 * The body stays on the gameplay line (`width` wide, `h` high); pilasters and piers stand ≤ 0.13 m proud of the faces.
 * `_wire` adds the barbed-wire coping brackets (art/wire-obstacles.js `coping_bracket`, drawn by the map's wire layer).
 * @module art/depot-walls
 */
import * as THREE from 'three';
import { dressingMaterial, boxUV, consolidate } from './dressing.js';

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// a gate end: within 1 m of a named gate point (the map build may trim a run's end off a solid's face)
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;

/**
 * @param {number[][]} points the run (world x, z)
 * @param {{h:number,width:number,id?:string,gatePiers?:number[][]}} o
 * @param {() => number} R seeded random
 */
export function brickDepotWall(points, o, R = Math.random) {
  const h = o.h, width = o.width, root = new THREE.Group(); root.name = 'dressing:wall:brick_depot';
  const brick = dressingMaterial('brick'), brickDk = dressingMaterial('brickDark'), tar = dressingMaterial('tarPaper'), stone = dressingMaterial('granite');
  const gates = o.gatePiers || [], last = points.length - 1;
  const capH = 0.13, plinthH = 0.42, bodyH = h - capH;
  const add = (geo, mat, x, y, z, rot) => { const m = mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = rot; root.add(m); return m; };
  for (let k = 0; k < last; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, rot = -Math.atan2(bz - az, bx - ax);
    const gA = k === 0 && gates.some((g) => near(g, points[0])), gB = k + 1 === last && gates.some((g) => near(g, points[last]));
    // ends: a gate end stops 5 cm short, any other end overlaps by half the width (closes the corner with its neighbour)
    const eA = gA ? -0.05 : width / 2, eB = gB ? -0.05 : width / 2, Lw = L + eA + eB, sh = (eB - eA) / 2;
    const cx = (ax + bx) / 2 + tx * sh, cz = (az + bz) / 2 + tz * sh;
    add(boxUV(new THREE.BoxGeometry(Lw, bodyH, width), 2.2), brick, cx, bodyH / 2, cz, rot);
    add(boxUV(new THREE.BoxGeometry(Lw + 0.02, plinthH, width + 0.04), 1.4), tar, cx, plinthH / 2, cz, rot);   // tarred plinth
    add(boxUV(new THREE.BoxGeometry(Lw + 0.04, capH, width + 0.12), 1.2), stone, cx, bodyH + capH / 2, cz, rot); // coping + drip
    // a soldier course of darker headers under the coping
    add(boxUV(new THREE.BoxGeometry(Lw + 0.01, 0.11, width + 0.02), 1.0), brickDk, cx, bodyH - 0.07, cz, rot);
    // pilasters: at the vertices (corners) and every ~3.5 m between; none where a gate pier stands
    const n = Math.max(1, Math.round(L / 3.5));
    for (let i = 0; i <= n; i++) {
      // a vertex pier is drawn once, by the segment ending there; a run's own ends draw none (a gate pier, or a run cut
      // at a solid's face / chained into its neighbour by the map build)
      if (i === 0 || (i === n && k + 1 === last)) continue;
      const u = -L / 2 + (L * i) / n, px = (ax + bx) / 2 + tx * u, pz = (az + bz) / 2 + tz * u;
      const corner = i === n;
      const pw = corner ? width + 0.2 : 0.46, pd = width + (corner ? 0.2 : 0.14);
      add(boxUV(new THREE.BoxGeometry(pw, bodyH - 0.02, pd), 2.2), brick, px, (bodyH - 0.02) / 2, pz, rot);
      add(boxUV(new THREE.BoxGeometry(pw + 0.02, plinthH, pd + 0.02), 1.4), tar, px, plinthH / 2, pz, rot);
      add(boxUV(new THREE.BoxGeometry(pw + 0.06, 0.1, pd + 0.06), 1.2), stone, px, h + 0.03, pz, rot);
    }
    // gate piers: 0.76 m square, 0.4 m above the wall, a stone slab and a low pyramid cap; inside the run's own length
    for (const [isG, sx, sz, dir] of [[gA, ax, az, 1], [gB, bx, bz, -1]]) {
      if (!isG) continue;
      const s = 0.76, px = sx + tx * dir * (s / 2 + 0.12), pz = sz + tz * dir * (s / 2 + 0.12), ph = h + 0.4;
      add(boxUV(new THREE.BoxGeometry(s, ph - 0.14, s), 2.2), brick, px, (ph - 0.14) / 2, pz, rot);
      add(boxUV(new THREE.BoxGeometry(s + 0.02, plinthH + 0.08, s + 0.02), 1.4), tar, px, (plinthH + 0.08) / 2, pz, rot);
      add(boxUV(new THREE.BoxGeometry(s + 0.1, 0.14, s + 0.1), 1.2), stone, px, ph - 0.07, pz, rot);
      const cap = mesh(new THREE.ConeGeometry((s + 0.02) * 0.7, 0.22, 4, 1), stone);
      cap.position.set(px, ph + 0.11, pz); cap.rotation.y = rot + Math.PI / 4; root.add(cap);
    }
    // weathering: the odd replaced patch of darker brick (proud by 4 mm: no z-fight), seeded per run
    for (let q = 0; q < Math.floor(L / 6); q++) {
      if (R() < 0.45) continue;
      const u = -L / 2 + 1 + R() * Math.max(0.1, L - 2), side = R() < 0.5 ? 1 : -1, pw = 0.5 + R() * 0.9, ph = 0.3 + R() * 0.6;
      const px = (ax + bx) / 2 + tx * u - tz * side * (width / 2 + 0.004), pz = (az + bz) / 2 + tz * u + tx * side * (width / 2 + 0.004);
      add(boxUV(new THREE.BoxGeometry(pw, ph, 0.006), 1.0), brickDk, px, plinthH + 0.2 + R() * (bodyH - plinthH - ph - 0.4) + ph / 2, pz, rot);
    }
  }
  return consolidate(root);
}
