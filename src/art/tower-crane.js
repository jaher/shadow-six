/**
 * M17 art pass: the lattice tower crane outside the prison camp's NW wall (dossier §5.1 `crane`, building-inventory
 * `crane_tower_jib`): a square lattice mast on a ballasted concrete cross base, a slewing ring and operator's cab,
 * a triangular lattice jib (local +x) with the trolley and a hook block on its cables, a counter-jib with stacked
 * concrete counterweights, the tower head (A-frame) and its tie bars. Local frame: mast foot at the origin, the jib
 * along +x (the structure's `rot` turns it). Visual only: the gameplay footprint is the mast's circle.
 * @module art/tower-crane
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dressingMaterial, buildLattice } from './dressing.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** A square-section bar from a to b (thickness t). */
function bar(a, b, t) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.BoxGeometry(t, L, t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).toNonIndexed();
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();

function meshOf(geos, mat, name, cast = true) {
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
  for (const g of geos) g.dispose();
  m.name = name; m.castShadow = cast; m.receiveShadow = true;
  return m;
}

/** Triangular lattice girder from x0 to x1 at height y (width w, depth h: two bottom chords, one top chord). */
function girder(G, x0, x1, y, w, h, t = 0.06) {
  const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 1.2)), s = Math.sign(x1 - x0) || 1;
  const bl = (x) => V(x, y, -w / 2), br = (x) => V(x, y, w / 2), tp = (x) => V(x, y + h, 0);
  G.push(bar(bl(x0), bl(x1), t), bar(br(x0), br(x1), t), bar(tp(x0), tp(x1 - s * 0.3), t));
  for (let k = 0; k < n; k++) {
    const a = x0 + ((x1 - x0) * k) / n, b = x0 + ((x1 - x0) * (k + 1)) / n;
    G.push(bar(bl(a), tp(b), t * 0.6), bar(br(a), tp(b), t * 0.6), bar(bl(b), br(b), t * 0.6));
  }
}

/**
 * @param {{h?: number, r?: number, jib?: number}} p `h` the hook height of the jib (m, default 14), `jib` its length
 * @returns {THREE.Group}
 */
export function buildTowerCrane(p = {}) {
  const H = Math.max(8, (p.h ?? 14) - 1.6), J = p.jib ?? 12, CJ = 4.2, root = new THREE.Group(); root.name = 'kit:tower_crane';
  const mast = buildLattice({ h: H }, { base: 1.5, top: 1.5, arms: false });
  root.add(mast);
  const S = [], C = [], K = [];
  // cross base: two concrete beams + ballast blocks
  for (const rot of [0, Math.PI / 2]) C.push(new THREE.BoxGeometry(4.2, 0.45, 0.7).rotateY(rot).translate(0, 0.22, 0).toNonIndexed());
  for (const [x, z] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) C.push(box(0.9, 0.55, 0.9, x, 0.28, z));
  // slewing ring, turntable, cab
  S.push(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 16).translate(0, H + 0.18, 0).toNonIndexed(), box(2.2, 0.25, 1.8, 0, H + 0.48, 0));
  K.push(box(1.3, 1.25, 1.2, 0.5, H + 1.2, 1.25));                                         // cab (painted)
  S.push(box(1.36, 0.08, 1.26, 0.5, H + 1.86, 1.25));
  // jib (+x) and counter-jib (−x)
  girder(S, 0.8, J, H + 0.6, 1.0, 1.0);
  girder(S, -0.8, -CJ, H + 0.6, 1.2, 0.5);
  for (const z of [-0.6, 0.6]) S.push(bar(V(-0.8, H + 0.6, z), V(-CJ, H + 0.6, z), 0.08));
  for (let k = 0; k < 3; k++) C.push(box(0.75, 0.9, 1.6, -CJ + 0.55 + k * 0.8, H + 0.15, 0)); // counterweights
  // tower head and tie bars
  const top = V(0, H + 3.6, 0);
  for (const z of [-0.6, 0.6]) S.push(bar(V(-0.7, H + 0.6, z), top, 0.1), bar(V(0.7, H + 0.6, z), top, 0.1));
  S.push(bar(top, V(J * 0.62, H + 1.6, 0), 0.05), bar(top, V(J - 0.3, H + 1.6, 0), 0.04), bar(top, V(-CJ + 0.2, H + 1.1, 0), 0.06));
  // trolley, cables and hook block
  const tx = J * 0.7, hookY = Math.max(3.2, H * 0.42);
  S.push(box(0.9, 0.3, 0.9, tx, H + 0.45, 0));
  for (const z of [-0.12, 0.12]) S.push(bar(V(tx, H + 0.3, z), V(tx, hookY + 0.45, z), 0.02));
  K.push(box(0.35, 0.5, 0.25, tx, hookY + 0.2, 0));
  S.push(new THREE.TorusGeometry(0.16, 0.04, 6, 12, Math.PI * 1.4).rotateZ(Math.PI * 0.8).translate(tx, hookY - 0.15, 0).toNonIndexed());
  // ladder up the mast's inner face (cosmetic) and a guard rail along the jib walk
  for (const z of [-0.15, 0.15]) S.push(bar(V(-0.6, 0.5, z), V(-0.6, H, z), 0.04));
  for (let y = 0.8; y < H; y += 0.35) S.push(bar(V(-0.6, y, -0.15), V(-0.6, y, 0.15), 0.025));
  root.add(meshOf(S, dressingMaterial('steel'), 'kit:tower_crane:steel'), meshOf(C, dressingMaterial('concrete'), 'kit:tower_crane:concrete'));
  const paint = dressingMaterial('steel').clone(); paint.color = new THREE.Color(0xc69a3c); paint.name = 'kit:tower_crane:ochre';
  root.add(meshOf(K, paint, 'kit:tower_crane:cab'));
  return root;
}
