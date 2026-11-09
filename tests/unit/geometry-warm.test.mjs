/**
 * engine/geometry-warm.js: the queue takes a subtree's plain meshes (not skinned / instanced ones), uploads them a byte
 * budget at a time (one mesh at least) through renderer.render with a material that draws nothing, into its own target,
 * and leaves every mesh and the renderer as they were; a disposed geometry is skipped; clear() empties it. Also the scope
 * warm-up's representatives (debug/walkthrough-scope.js highlightReps).
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { queueGeometryUpload, uploadQueued, clearGeometryUploads, geometryUploadsPending } from '../../src/engine/geometry-warm.js';
import { highlightReps } from '../../src/debug/walkthrough-scope.js';

function stubRenderer() {
  const calls = [];
  const r = {
    rt: 'screen', autoClear: true, shadowMap: { autoUpdate: true },
    getRenderTarget() { return this.rt; },
    setRenderTarget(t) { this.rt = t; },
    render(m, cam) {
      calls.push({ m, cam, mat: m.material, vis: m.visible, fc: m.frustumCulled, mwau: m.matrixWorldAutoUpdate, rt: this.rt, auto: this.autoClear, sh: this.shadowMap.autoUpdate });
    },
  };
  return { r, calls };
}
const mesh = (n, name) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); m.name = name; return m; };

test('geometry-warm: plain meshes queued, skinned and instanced left out', () => {
  clearGeometryUploads();
  const root = new THREE.Group(), lod = new THREE.Group(); lod.visible = false; root.add(lod);
  lod.add(mesh(10, 'a')); root.add(mesh(10, 'b'));
  root.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4));
  const sk = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); root.add(sk);
  queueGeometryUpload(root);
  assert.equal(geometryUploadsPending(), 2);
  clearGeometryUploads();
  assert.equal(geometryUploadsPending(), 0);
});

test('geometry-warm: uploads within the byte budget (one at least), hidden material, own target; everything put back', () => {
  clearGeometryUploads();
  const root = new THREE.Group(), lod = new THREE.Group(); lod.visible = false; root.add(lod);
  const big = [mesh(100000, 'big1'), mesh(100000, 'big2'), mesh(100000, 'big3')]; // 1.2 MB each
  for (const m of big) { m.frustumCulled = true; lod.add(m); }
  big[1].visible = false;
  queueGeometryUpload(root);
  const { r, calls } = stubRenderer(), cam = new THREE.PerspectiveCamera();
  const mats = big.map((m) => m.material);
  assert.equal(uploadQueued(r, cam, 2e6), 2, 'two meshes under a 2 MB budget (the second passes it)');
  assert.equal(geometryUploadsPending(), 1);
  for (const c of calls) {
    assert.equal(c.mat.visible, false, 'a material that draws nothing');
    assert.equal(c.vis, true); assert.equal(c.fc, false); assert.equal(c.mwau, false);
    assert.ok(c.rt && c.rt !== 'screen', 'its own target'); assert.equal(c.auto, false); assert.equal(c.sh, false);
    assert.equal(c.cam, cam);
  }
  assert.deepEqual(big.map((m) => m.material), mats, 'materials back');
  assert.deepEqual(big.map((m) => m.visible), [true, false, true], 'visibility back');
  assert.ok(big.every((m) => m.frustumCulled === true && m.matrixWorldAutoUpdate === true), 'flags back');
  assert.equal(r.rt, 'screen'); assert.equal(r.autoClear, true); assert.equal(r.shadowMap.autoUpdate, true);
  assert.equal(uploadQueued(r, cam, 1), 1, 'one at least, whatever the budget');
  assert.equal(uploadQueued(r, cam), 0, 'nothing left');
});

test('geometry-warm: a geometry gone (no position) is skipped', () => {
  clearGeometryUploads();
  const a = mesh(10, 'a'), b = mesh(10, 'b');
  const root = new THREE.Group(); root.add(a, b);
  queueGeometryUpload(root);
  a.geometry.deleteAttribute('position');
  const { r, calls } = stubRenderer();
  assert.equal(uploadQueued(r, new THREE.PerspectiveCamera()), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].m, b);
});

// (debug/walkthrough-scope.js highlightReps: the scope warm-up's meshes — one of each kind among the guards' models)

test('scope warm-up: one mesh of each kind among the guards (plain gun, skinned body / helmet, morphs), shown or not', () => {
  const guard = (gun) => {
    const root = new THREE.Group(), body = new THREE.Group(); body.visible = false; root.add(body);
    const geo = (extra) => { const g = new THREE.BoxGeometry(); if (extra) g.setAttribute('_mask', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4)); return g; };
    body.add(new THREE.SkinnedMesh(geo(true), new THREE.MeshStandardMaterial()));   // LOD0 body
    body.add(new THREE.SkinnedMesh(geo(false), new THREE.MeshStandardMaterial()));  // helmet
    if (gun) { const w = new THREE.Mesh(geo(false), new THREE.MeshStandardMaterial()); w.visible = false; body.add(w); } // the MP40, hidden
    return { object3d: root };
  };
  const reps = highlightReps([guard(false), guard(true), guard(true), { object3d: null }, {}]);
  assert.equal(reps.length, 3, 'skinned with mask, skinned plain, plain gun');
  assert.equal(reps.filter((m) => m.isSkinnedMesh).length, 2);
  assert.equal(reps.filter((m) => !m.isSkinnedMesh).length, 1);
});
