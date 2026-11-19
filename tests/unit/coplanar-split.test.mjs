/**
 * art/coplanar-split.js (user 2026-11-18: "Make sure there is no z-fighting in the geometry"): coplanar overlapping
 * faces of a library asset are separated at load — a synthetic sill on a ledge, a doubled face, a shared geometry —
 * and the shipped LIGHTS OUT kit buildings (building-fixups COPLANAR_SPLIT) load with no coplanar overlap left.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { readGlbArrayBuffer } from '../../tools/glb-io.mjs';
import { GLTFLoader } from '../../src/engine/glb-gzip.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeManifest, EXTRA_MANIFESTS } from '../../src/art/building-library.js';
import { separateCoplanar, coplanarPairs, triOverlap } from '../../src/art/coplanar-split.js';
import { COPLANAR_SPLIT } from '../../src/art/building-fixups.js';

/** Coplanar overlapping pairs left under root (same test as the split's own). */
function pairsLeft(root) {
  root.updateMatrixWorld(true);
  const T = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const P = o.geometry.getAttribute('position'), I = o.geometry.index, n = I ? I.count : P.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(P, I ? I.getX(t + k) : t + k).applyMatrix4(o.matrixWorld));
      const nr = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      const a2 = nr.length(); if (a2 < 2e-6) continue; nr.divideScalar(a2);
      const lo = [0, 1, 2].map((c) => Math.min(...v.map((q) => q.getComponent(c)))), hi = [0, 1, 2].map((c) => Math.max(...v.map((q) => q.getComponent(c))));
      T.push({ v, n: nr, d: nr.dot(v[0]), area: a2 / 2, lo, hi });
    }
  });
  return coplanarPairs(T);
}

/** A 1 m wall slab (front face z = 0) and a sill box whose front face is flush with it, plus its top flush with a ledge. */
function sillScene() {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.3).translate(0, 1, -0.15), new THREE.MeshStandardMaterial({ name: 'brick' }));
  const sill = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.3).translate(0, 0.83, -0.15), new THREE.MeshStandardMaterial({ name: 'ashlar' }));
  root.add(wall, sill);
  return { root, wall, sill };
}

test('coplanar-split: triOverlap of two coplanar triangles', () => {
  const n = new THREE.Vector3(0, 1, 0);
  const a = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];
  const b = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)];
  assert.ok(Math.abs(triOverlap(a, b, n) - 0.5) < 1e-9);
  const c = [new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 0, 1), new THREE.Vector3(3, 0, 0)];
  assert.equal(triOverlap(a, c, n), 0);
});

test('coplanar-split: a sill flush with its wall sits proud of it, the wall stays put', () => {
  const { root, wall, sill } = sillScene();
  assert.ok(pairsLeft(root).length > 0, 'the synthetic case fights before');
  const wallBefore = Array.from(wall.geometry.getAttribute('position').array);
  const r = separateCoplanar(root);
  assert.ok(r.moved > 0 && r.pairs > 0);
  assert.equal(pairsLeft(root).length, 0, 'no coplanar overlap after');
  assert.deepEqual(Array.from(wall.geometry.getAttribute('position').array), wallBefore, 'the larger surface does not move');
  // the sill's front face (z = 0) moved out by the lift; nothing moved more than 2 lifts
  const P = sill.geometry.getAttribute('position');
  let maxZ = -Infinity;
  for (let i = 0; i < P.count; i++) maxZ = Math.max(maxZ, P.getZ(i));
  assert.ok(Math.abs(maxZ - 0.006) < 1e-6, `sill front at ${maxZ}`);
  assert.equal(sill.geometry.index.count, 36, 'same triangles');
});

test('coplanar-split: a doubled face inside one mesh is split; a shared geometry is cloned', () => {
  const g = new THREE.PlaneGeometry(1, 1);
  const twice = new THREE.BufferGeometry();
  const P = g.getAttribute('position'), U = g.getAttribute('uv'), N = g.getAttribute('normal');
  const pos = [], uv = [], nor = [];
  for (let k = 0; k < 2; k++) for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); uv.push(U.getX(i) + k * 0.5, U.getY(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); }
  twice.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  twice.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  twice.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const idx = Array.from(g.index.array);
  twice.setIndex([...idx, ...idx.map((i) => i + P.count)]);
  const root = new THREE.Group();
  const a = new THREE.Mesh(twice, new THREE.MeshStandardMaterial());
  const b = new THREE.Mesh(twice, new THREE.MeshStandardMaterial());
  b.position.x = 5;
  root.add(a, b);
  assert.ok(pairsLeft(root).length >= 2);
  separateCoplanar(root);
  assert.equal(pairsLeft(root).length, 0);
  assert.notEqual(a.geometry, b.geometry, 'the shared geometry was cloned before one copy moved');
});

test('coplanar-split: a pier top through a 7° roof sheet ends wholly under it (crossings)', () => {
  const root = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2 + (7 * Math.PI) / 180), new THREE.MeshStandardMaterial({ name: 'roof' }));
  const pier = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ name: 'pier' }));
  root.add(roof, pier);
  root.updateMatrixWorld(true);
  const tilt = Math.tan((7 * Math.PI) / 180);
  const P = pier.geometry.getAttribute('position');
  const before = Array.from({ length: P.count }, (_, i) => P.getY(i) + P.getZ(i) * tilt); // height over the roof: both signs
  assert.ok(Math.min(...before) < 0 && Math.max(...before) > 0, 'the pier top crosses the roof');
  separateCoplanar(root, { crossings: false });
  assert.ok(Math.min(...Array.from({ length: P.count }, (_, i) => P.getY(i) + P.getZ(i) * tilt)) < 0, 'not moved without crossings');
  separateCoplanar(root, { crossings: true });
  const Q = pier.geometry.getAttribute('position'), I = pier.geometry.index; // (moved faces use appended vertices)
  const after = Array.from(I.array, (i) => Q.getY(i) + Q.getZ(i) * tilt);
  assert.ok(after.every((h) => h < 0) || after.every((h) => h > 0), `one side of the roof: ${after.map((h) => h.toFixed(4))}`);
  assert.ok(Math.max(...after.map(Math.abs)) < 0.05, 'a small move');
});

const P = (f) => new URL(`../../${f}`, import.meta.url);
const M = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json')));
for (const x of EXTRA_MANIFESTS) mergeManifest(M, JSON.parse(readFileSync(P(`assets/models/buildings/${x}.json`))));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
const load = (name, lod) => new Promise((res, rej) => loader.parse(readGlbArrayBuffer(P(`assets/models/${M.assets[name].lods[lod].url}`)), '', (g) => res(g.scene), rej));

test('coplanar-split: the LIGHTS OUT kit buildings load with no coplanar overlap (every LOD)', async () => {
  const bad = [];
  for (const [name, opt] of COPLANAR_SPLIT) {
    for (let lod = 0; lod < M.assets[name].lods.length; lod++) {
      const root = await load(name, lod);
      const before = pairsLeft(root).length;
      // (building-fixups applyAssetFixups runs this last on every COPLANAR_SPLIT asset; its other passes load textures)
      const r = separateCoplanar(root, { crossings: false, ...opt });
      const after = pairsLeft(root).length;
      if (after) bad.push(`${name} L${lod}: ${after} pairs left (of ${before})`);
      if (before && !r.moved) bad.push(`${name} L${lod}: nothing moved`);
    }
  }
  assert.equal(bad.join('; '), '');
});
