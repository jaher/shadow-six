/**
 * debug/ray-grid.js anyHit — the video-mode director's yaw check — answers exactly what three's Raycaster does
 * (`intersectObjects(meshes, false).length > 0`) over gridded meshes: indexed and not, groups with per-group materials
 * of every side, draw ranges, scaled / rotated / translated meshes, near / far, layers, meshes it must leave to three.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { anyHit, buildGridG, gridOf, gridable } from '../../src/debug/ray-grid.js';

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const R = (a, b) => a + (b - a) * rnd();
const build = (m) => { const g = buildGridG(m.geometry, m.material); let r; while (!(r = g.next()).done); return r.value; };

function soup(n, spread, size) {
  const p = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const cx = R(-spread, spread), cy = R(-spread, spread), cz = R(-spread, spread);
    for (let v = 0; v < 3; v++) { p[t * 9 + v * 3] = cx + R(-size, size); p[t * 9 + v * 3 + 1] = cy + R(-size, size); p[t * 9 + v * 3 + 2] = cz + R(-size, size); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g;
}
const sides = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide];
function scene() {
  const meshes = [];
  // a house-like box set, an indexed sphere, a triangle soup with big triangles, a grouped mesh, a draw range
  const box = new THREE.BoxGeometry(6, 3, 4, 8, 4, 6);
  const m1 = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  m1.position.set(R(-5, 5), 1.5, R(-5, 5)); m1.rotation.y = R(0, 6); m1.scale.set(R(0.6, 1.6), R(0.6, 1.6), R(0.6, 1.6));
  const sph = new THREE.SphereGeometry(2, 24, 16);
  const m2 = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ side: sides[(rnd() * 3) | 0] }));
  m2.position.set(R(-8, 8), R(0, 3), R(-8, 8));
  const s = soup(1500, 6, 0.5);
  for (let t = 0; t < 12; t++) for (let v = 0; v < 9; v++) s.attributes.position.array[t * 9 + v] *= 8; // a few big ones
  const m3 = new THREE.Mesh(s, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m3.position.set(R(-6, 6), 0, R(-6, 6));
  const gb = new THREE.BoxGeometry(4, 4, 4, 3, 3, 3); // groups 0..5, one material per face
  const m4 = new THREE.Mesh(gb, sides.concat(sides).map((sd) => new THREE.MeshBasicMaterial({ side: sd })));
  m4.material[2] = undefined; // a group without a material: never hit (three would throw; nothing reaches it)
  m4.position.set(R(-6, 6), 2, R(-6, 6)); m4.rotation.set(R(0, 1), R(0, 6), R(0, 1));
  const dr = soup(900, 4, 0.8); dr.setDrawRange(300, 1200);
  const m5 = new THREE.Mesh(dr, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  m5.position.set(R(-4, 4), 1, R(-4, 4));
  const ib = new THREE.BoxGeometry(2, 6, 2, 2, 6, 2).toNonIndexed();
  const m6 = new THREE.Mesh(ib, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  m6.position.set(R(-6, 6), 3, R(-6, 6));
  // an instanced mesh (a palisade's logs): every instance at its own matrix
  const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 10, 2), new THREE.MeshBasicMaterial({ side: sides[(rnd() * 3) | 0] }), 40);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < logs.count; i++) logs.setMatrixAt(i, M.compose(new THREE.Vector3(R(-6, 6), 1.5, R(-6, 6)), q.setFromEuler(e.set(R(-0.1, 0.1), R(0, 6), R(-0.1, 0.1))), new THREE.Vector3(1, R(0.8, 1.2), 1)));
  logs.computeBoundingSphere();
  logs.position.set(R(-3, 3), 0, R(-3, 3));
  meshes.push(m1, m2, m3, m5, m6, logs);
  if (rnd() < 0.5) meshes.push(new THREE.Mesh(gb.clone(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))); // ungridded: three answers
  for (const m of meshes) m.updateMatrixWorld(true);
  m4.updateMatrixWorld(true);
  return { meshes, grouped: m4 };
}

test('ray-grid anyHit = Raycaster.intersectObjects(…).length > 0 (random scenes, random rays)', () => {
  let rays = 0, hits = 0, mism = 0;
  for (let sc = 0; sc < 12; sc++) {
    const { meshes, grouped } = scene();
    const objs = [...meshes];
    // (the grouped mesh with an undefined group material is tested apart: three throws on it)
    for (const m of objs.slice(0, 6)) build(m);
    assert.ok(objs.slice(0, 6).every((m) => gridOf(m)), 'grids built (the instanced logs too)');
    const rc = new THREE.Raycaster();
    for (let n = 0; n < 1500; n++) {
      const o = new THREE.Vector3(R(-14, 14), R(-2, 6), R(-14, 14));
      // (most rays aimed near a mesh: grazing its edges and corners as often as its faces)
      const tgt = objs[(rnd() * objs.length) | 0].position;
      const d = rnd() < 0.75 ? new THREE.Vector3(tgt.x + R(-3, 3), tgt.y + R(-2, 2), tgt.z + R(-3, 3)).sub(o).normalize() : new THREE.Vector3(R(-1, 1), R(-0.4, 1), R(-1, 1)).normalize();
      rc.set(o, d); rc.near = rnd() < 0.2 ? R(0, 3) : 0; rc.far = rnd() < 0.5 ? R(2, 30) : 80;
      const want = rc.intersectObjects(objs, false).length > 0, got = anyHit(rc, objs);
      rays++; if (want) hits++;
      if (want !== got) mism++;
    }
    // grouped / per-group sides (minus the undefined group, compared against three on the same faces)
    grouped.material[2] = grouped.material[3];
    build(grouped);
    for (let n = 0; n < 800; n++) {
      const o = new THREE.Vector3(R(-12, 12), R(-2, 6), R(-12, 12)), p = grouped.position;
      const d = new THREE.Vector3(p.x + R(-3, 3), p.y + R(-3, 3), p.z + R(-3, 3)).sub(o).normalize();
      rc.set(o, d); rc.near = 0; rc.far = 80;
      const want = rc.intersectObjects([grouped], false).length > 0, got = anyHit(rc, [grouped]);
      rays++; if (want) hits++;
      if (want !== got) mism++;
    }
  }
  assert.equal(mism, 0, `${mism} mismatches in ${rays} rays (${hits} hits)`);
  assert.ok(hits > rays * 0.3 && hits < rays * 0.9, `a fair share of hits (${hits}/${rays})`);
});

test('ray-grid: layers, custom raycast, a geometry changed after its grid was built, sliced build', () => {
  const g = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.updateMatrixWorld(true);
  const it = buildGridG(g, m.material);
  let slices = 0; while (!it.next().done) slices++;
  const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 1));
  assert.equal(anyHit(rc, [m]), true);
  m.layers.set(3);
  assert.equal(anyHit(rc, [m]), rc.intersectObjects([m], false).length > 0, 'layers as three');
  m.layers.set(0);
  // moved vertices: the grid no longer matches → three answers (and the caller is told it needs a grid)
  g.attributes.position.array.forEach((v, i, a) => { a[i] = v + 20; }); g.attributes.position.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
  let need = 0;
  assert.equal(gridOf(m), null, 'stale grid not used');
  assert.equal(anyHit(rc, [m], () => need++), false); assert.equal(need, 1);
  const c = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()); c.raycast = () => {}; c.updateMatrixWorld(true);
  assert.equal(gridable(c), false); assert.equal(anyHit(rc, [c]), false, 'a custom raycast is asked itself');
  const big = new THREE.Mesh(new THREE.SphereGeometry(3, 120, 80), new THREE.MeshBasicMaterial()); big.updateMatrixWorld(true);
  const it2 = buildGridG(big.geometry, big.material); let n2 = 0; while (!it2.next().done) n2++;
  assert.ok(n2 >= 3, `a big mesh builds in slices (${n2})`);
});
