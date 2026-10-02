/**
 * M11 oilfield pipe runs (docs/fuel-tanks.md §5.4 `oil_pipe_run`): the original joins its white process columns with a
 * pale pipe on low stools, red flanges and handwheel valves. Neighbouring `oil_tanks_vertical` columns of one cluster
 * (centres ≤ 9 m apart) get a run along the straight line between them: a nozzle stub out of each shell at 1.45 m, an
 * elbow down to the run (pipe centre 0.6 m) on concrete stools every ~2 m, red flanges at every joint, two red
 * handwheel gate valves and a small ground manifold (tee, valve, elbows) at mid-run. A run is LOW dressing (no nav
 * cells: crossable) and is dropped when its line would cross another structure's footprint.
 * `pipeRunPairs` is pure (node-testable); `buildPipeRun` makes the three.js meshes (3 merged meshes per run).
 * @module art/fuel-pipes
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isFuelStructure, isColumnFootprint } from './fuel-tanks.js';

export const PIPE = Object.freeze({ maxGap: 9, shellR: 1.5, nozzleY: 1.45, runY: 0.6, r: 0.1, stool: 2.0 });

const isColumn = (s) => isFuelStructure(s) && s.variant === 'oil_tanks_vertical' && isColumnFootprint(s);

/** Does segment a→b (world xz) pass through structure s's footprint (rect w × d at rot, or circle r)? */
function crosses(s, a, b, pad = 0.2) {
  const n = 12;
  for (let k = 1; k < n; k++) {
    const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
    if (s.r != null && s.w == null) { if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true; continue; }
    if (s.w == null || s.d == null || s.x == null) continue;
    const r = s.rot ?? 0, dx = x - s.x, dz = z - s.z;
    const lx = dx * Math.cos(r) + dz * Math.sin(r), lz = -dx * Math.sin(r) + dz * Math.cos(r);
    if (Math.abs(lx) < s.w / 2 + pad && Math.abs(lz) < s.d / 2 + pad) return true;
  }
  return false;
}

/**
 * The pipe runs of a mission: pairs of column tanks ≤ PIPE.maxGap apart whose connecting line stays clear of every
 * other footprint. Each pair is listed once, owned by the tank with the smaller id (it builds the meshes).
 * @param {object[]} structures mission structures
 * @returns {{owner: object, other: object, a: number[], b: number[], len: number}[]} a/b = run ends at the shells (xz)
 */
export function pipeRunPairs(structures = []) {
  const cols = structures.filter(isColumn), out = [];
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const [p, q] = String(cols[i].id ?? i) < String(cols[j].id ?? j) ? [cols[i], cols[j]] : [cols[j], cols[i]];
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > PIPE.maxGap || d < 2 * PIPE.shellR + 1) continue;
      const ux = dx / d, uz = dz / d;
      const a = [p.x + ux * PIPE.shellR, p.z + uz * PIPE.shellR], b = [q.x - ux * PIPE.shellR, q.z - uz * PIPE.shellR];
      // the plinths are the pair's own footprints (r 1.75): only OTHER structures may block the line
      const blocked = structures.some((s) => s !== p && s !== q && s.x != null && crosses(s, [p.x + ux * 1.9, p.z + uz * 1.9], [q.x - ux * 1.9, q.z - uz * 1.9]));
      if (!blocked) out.push({ owner: p, other: q, a, b, len: d - 2 * PIPE.shellR });
    }
  }
  return out;
}

const MAT = {};
function mats() {
  if (!MAT.pipe) {
    MAT.pipe = new THREE.MeshStandardMaterial({ color: 0xb8b5aa, roughness: 0.55, metalness: 0.15 });
    MAT.red = new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.5, metalness: 0.1 });
    MAT.stool = new THREE.MeshStandardMaterial({ color: 0x9c968a, roughness: 0.95 });
    for (const m of Object.values(MAT)) m.userData.shared = true;
  }
  return MAT;
}

/** Cylinder geometry from p to q (THREE.Vector3), radius r. */
function cyl(p, q, r, seg = 10) {
  const d = new THREE.Vector3().subVectors(q, p), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
  return g;
}

function box(c, sx, sy, sz, yaw = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.rotateY(yaw);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Handwheel gate valve at c on a pipe along unit u: body, bonnet up, red wheel. */
function valveAt(c, u, pipe, red) {
  pipe.push(cyl(c.clone().addScaledVector(u, -0.16), c.clone().addScaledVector(u, 0.16), PIPE.r * 1.35, 12));
  pipe.push(cyl(c, c.clone().add(new THREE.Vector3(0, 0.38, 0)), 0.05, 8));
  const w = new THREE.TorusGeometry(0.17, 0.018, 6, 16);
  w.rotateX(Math.PI / 2);
  w.translate(c.x, c.y + 0.4, c.z);
  red.push(w);
  for (let k = 0; k < 2; k++) {
    const s = new THREE.BoxGeometry(0.34, 0.02, 0.025);
    s.rotateY(k * Math.PI / 2);
    s.translate(c.x, c.y + 0.4, c.z);
    red.push(s);
  }
}

/**
 * Meshes of one pipe run in WORLD coordinates (the caller re-parents them).
 * @param {{a: number[], b: number[], len: number}} run from pipeRunPairs
 * @returns {THREE.Group} name 'pipe_run'
 */
export function buildPipeRun(run) {
  const M = mats(), pipe = [], red = [], stool = [];
  const A = new THREE.Vector3(run.a[0], 0, run.a[1]), Bv = new THREE.Vector3(run.b[0], 0, run.b[1]);
  const u = new THREE.Vector3().subVectors(Bv, A).normalize();
  const side = new THREE.Vector3(-u.z, 0, u.x);
  const at = (p, y, along = 0, off = 0) => p.clone().addScaledVector(u, along).addScaledVector(side, off).setY(y);
  const ends = [[A, 1], [Bv, -1]];
  for (const [P, s] of ends) {                                     // nozzle stub, flange, elbow down to the run
    const n0 = at(P, PIPE.nozzleY, -0.05 * s), n1 = at(P, PIPE.nozzleY, 0.45 * s);
    pipe.push(cyl(n0, n1, PIPE.r));
    red.push(cyl(at(P, PIPE.nozzleY, 0.2 * s), at(P, PIPE.nozzleY, 0.26 * s), PIPE.r * 1.7, 14));
    pipe.push(cyl(n1, at(P, PIPE.runY, 0.45 * s), PIPE.r));
    pipe.push(new THREE.SphereGeometry(PIPE.r * 1.05, 10, 6).translate(n1.x, n1.y, n1.z));
  }
  const p0 = at(A, PIPE.runY, 0.45), p1 = at(Bv, PIPE.runY, -0.45), L = p0.distanceTo(p1);
  pipe.push(new THREE.SphereGeometry(PIPE.r * 1.05, 10, 6).translate(p0.x, p0.y, p0.z));
  pipe.push(new THREE.SphereGeometry(PIPE.r * 1.05, 10, 6).translate(p1.x, p1.y, p1.z));
  pipe.push(cyl(p0, p1, PIPE.r));
  const n = Math.max(1, Math.round(L / PIPE.stool));
  const yaw = Math.atan2(-u.z, u.x);
  for (let k = 0; k <= n; k++) {                                   // stools + red flanges at the joints
    const c = p0.clone().lerp(p1, k / n);
    stool.push(box(new THREE.Vector3(c.x, (PIPE.runY - PIPE.r) / 2, c.z), 0.22, PIPE.runY - PIPE.r, 0.32, yaw));
    if (k > 0 && k < n) red.push(cyl(c.clone().addScaledVector(u, -0.03), c.clone().addScaledVector(u, 0.03), PIPE.r * 1.7, 14));
  }
  for (const f of [1 / 3, 2 / 3]) valveAt(p0.clone().lerp(p1, f), u, pipe, red);
  // ground manifold at mid-run: a tee to the side, a small valve, an elbow down into a stub on the ground
  const m = p0.clone().lerp(p1, 0.5);
  const m1 = m.clone().addScaledVector(side, 0.8), m2 = m1.clone().setY(0.12);
  pipe.push(cyl(m, m1, 0.06, 8), cyl(m1, m2, 0.06, 8), cyl(m2, m2.clone().addScaledVector(side, 0.35), 0.06, 8));
  pipe.push(new THREE.SphereGeometry(0.065, 8, 6).translate(m1.x, m1.y, m1.z));
  valveAt(m.clone().addScaledVector(side, 0.45), side, pipe, red);
  stool.push(box(new THREE.Vector3(m2.x, 0.05, m2.z).addScaledVector(side, 0.35), 0.3, 0.1, 0.3, yaw));
  const g = new THREE.Group();
  g.name = 'pipe_run';
  for (const [list, mat] of [[pipe, M.pipe], [red, M.red], [stool, M.stool]]) {
    const geo = mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)), false);
    list.forEach((q) => q.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}
