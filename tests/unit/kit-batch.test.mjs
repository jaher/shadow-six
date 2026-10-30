/**
 * art/kit-batch.js: the Germans' rigid kit (squad extras, guns) drawn as one InstancedMesh per (geometry, material)
 * inside a drawn frame — the meshes stay in the graph, off every camera's layers only between kitBegin and kitEnd.
 *   node tests/unit/run.mjs kit-batch
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { registerKit, unregisterKit, kitBegin, kitEnd, disposeKit, kitStats, kitSolo } from '../../src/art/kit-batch.js';

const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1), mat = new THREE.MeshStandardMaterial({ color: 0x334422 });
const gun = new THREE.CylinderGeometry(0.01, 0.01, 1, 6), gunMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

function platoon(n = 3) {
  const scene = new THREE.Scene(), men = [];
  for (let i = 0; i < n; i++) {
    const root = new THREE.Group(); root.position.set(i * 2, 0, i); root.rotation.y = i * 0.7; scene.add(root);
    const bone = new THREE.Bone(); bone.position.y = 1.2; root.add(bone);
    const tin = new THREE.Mesh(geo, mat); tin.position.set(0, 0.1, -0.15); bone.add(tin);
    const rifle = new THREE.Mesh(gun, gunMat); rifle.castShadow = true; rifle.position.set(0.2, 1, 0); root.add(rifle);
    men.push({ root, bone, tin, rifle });
  }
  scene.updateMatrixWorld(true);
  return { scene, men };
}
const proxies = (scene) => { const out = []; scene.traverse((o) => { if (o.isInstancedMesh) out.push(o); }); return out; };

test('kit-batch: one instanced draw per item for the platoon, same world matrices, meshes off the layers until kitEnd', () => {
  disposeKit();
  const { scene, men } = platoon(3);
  assert.equal(registerKit(men.flatMap((m) => [m.tin, m.rifle])), 6);
  kitBegin(scene);
  const P = proxies(scene).filter((p) => p.visible);
  assert.equal(P.length, 2, 'a batch per item kind');
  const tins = P.find((p) => p.geometry === geo), rifles = P.find((p) => p.geometry === gun);
  assert.equal(tins.count, 3); assert.equal(rifles.count, 3);
  assert.equal(rifles.castShadow, true); assert.equal(tins.castShadow, false);
  const M = new THREE.Matrix4();
  men.forEach((m, i) => {
    tins.getMatrixAt(i, M);
    assert.ok(M.elements.every((v, k) => Math.abs(v - m.tin.matrixWorld.elements[k]) < 1e-6), 'instance = the mesh world matrix');
    assert.equal(m.tin.layers.mask, 0, 'the mesh itself is off the layers while the batch draws it');
  });
  kitEnd();
  for (const m of men) { assert.equal(m.tin.layers.mask, 1); assert.equal(m.rifle.layers.mask, 1); }
  assert.equal(proxies(scene)[0].parent.visible, false, 'batches hidden outside a drawn frame');
  disposeKit();
});

test('kit-batch: hidden men, stained (per-draw hook) and re-materialed meshes are not drawn by a batch', () => {
  disposeKit();
  const { scene, men } = platoon(3);
  registerKit(men.map((m) => m.tin));
  men[0].root.visible = false;                                         // culled / hidden man
  men[1].tin.onBeforeRender = () => {};                                // blood/stains.js feeds his stains per draw
  kitBegin(scene);
  const tins = proxies(scene).find((p) => p.geometry === geo);
  assert.equal(tins.count, 1, 'only the visible, unhooked one');
  assert.equal(men[0].tin.layers.mask, 1); assert.equal(men[1].tin.layers.mask, 1, 'the hooked mesh draws itself');
  kitEnd();
  assert.equal(kitStats().registered, 2, 'the hooked mesh left the batches');
  const other = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  men[2].tin.material = other;                                         // another material: moves to its own batch
  kitBegin(scene); kitEnd();
  kitBegin(scene);
  const P = proxies(scene).filter((p) => p.visible && p.count);
  assert.ok(P.some((p) => p.material === other && p.count === 1), 'batched under its new material');
  kitEnd();
  disposeKit();
});

test('kit-batch: bounds computed over a frame\'s instances are unset the next frame; unregister and dispose', () => {
  disposeKit();
  const { scene, men } = platoon(2);
  registerKit(men.map((m) => m.tin));
  kitBegin(scene);
  const tins = proxies(scene).find((p) => p.geometry === geo);
  tins.computeBoundingSphere();
  kitEnd();
  men[0].root.position.x += 50; scene.updateMatrixWorld(true);
  kitBegin(scene);
  assert.equal(tins.boundingSphere, null, 'stale bounds dropped (a cull asks again over these instances)');
  kitEnd();
  unregisterKit([men[0].tin]);
  kitBegin(scene);
  assert.equal(proxies(scene).find((p) => p.geometry === geo).count, 1);
  kitEnd();
  disposeKit();
  assert.equal(kitStats().groups, 0);
  assert.equal(proxies(scene).length, 0, 'batches removed');
});

test('kit-batch: the warm-up frame (keep) fills the batches and leaves the meshes drawn too (both programs compiled)', () => {
  disposeKit();
  const { scene, men } = platoon(2);
  registerKit(men.map((m) => m.tin));
  kitBegin(scene, true);
  assert.equal(proxies(scene).find((p) => p.geometry === geo).count, 2);
  for (const m of men) assert.equal(m.tin.layers.mask, 1, 'the mesh draws itself in the warm-up frame');
  kitEnd();
  disposeKit();
});

test('kit-batch: kitSolo — one man by his own meshes for the rest of the frame, the others from a copy without him; the root is never lens-culled whole', () => {
  disposeKit();
  const { scene, men } = platoon(3);
  registerKit(men.flatMap((m) => [m.tin, m.rifle]));
  assert.equal(kitSolo(men[1].root), 0, 'outside a drawn frame: nothing to do');
  kitBegin(scene);
  assert.equal(proxies(scene)[0].parent.userData.lensKeep, true, 'world-space instances: bounds in the root frame go stale');
  const tins = proxies(scene).find((p) => p.geometry === geo && p.visible), before = tins.instanceMatrix.array.slice();
  assert.equal(kitSolo(men[1].root), 2, 'his tin and rifle');
  assert.equal(men[1].tin.layers.mask, 1); assert.equal(men[1].rifle.layers.mask, 1);
  assert.equal(men[0].tin.layers.mask, 0, 'the others stay batched');
  assert.equal(tins.visible, false, 'the batch drawn earlier in the frame is not changed (three uploads it once per frame number) …');
  assert.deepEqual([...tins.instanceMatrix.array], [...before], '… its matrices untouched');
  const live = proxies(scene).filter((p) => p.visible && p.count && p.geometry === geo);
  assert.equal(live.length, 1, '… a copy draws the tins instead');
  const c = live[0], M = new THREE.Matrix4(), same = (a, b) => a.elements.every((v, k) => Math.abs(v - b.elements[k]) < 1e-6);
  assert.equal(c.count, 2, 'without his');
  c.getMatrixAt(0, M); assert.ok(same(M, men[0].tin.matrixWorld));
  c.getMatrixAt(1, M); assert.ok(same(M, men[2].tin.matrixWorld));
  assert.equal(c.receiveShadow, tins.receiveShadow); assert.equal(c.material, tins.material);
  assert.ok(c.instanceMatrix.version > 0, 'uploaded at its first draw');
  assert.deepEqual(c.instanceMatrix.updateRanges.map((u) => [u.start, u.count]), [[0, 32]], 'its filled part');
  assert.equal(kitSolo(men[1].root), 0, 'once');
  assert.equal(kitSolo(men[0].root), 2, 'a second man the same frame');
  assert.equal(proxies(scene).find((p) => p.visible && p.count && p.geometry === geo).count, 1, 'both left out');
  kitEnd();
  for (const m of men) { assert.equal(m.tin.layers.mask, 1); assert.equal(m.rifle.layers.mask, 1); }
  kitBegin(scene);
  assert.equal(men[1].tin.layers.mask, 0, 'batched again the next frame');
  assert.equal(tins.visible, true); assert.equal(c.visible, false, 'the copy hidden again');
  kitEnd();
  disposeKit();
  assert.equal(proxies(scene).length, 0, 'copies disposed with their batch');
});
