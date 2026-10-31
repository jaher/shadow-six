/**
 * engine/matrix-freeze.js withSceneMatrices: a burst of renders of one scene (the load's vehicle warm-up frames: main
 * pass, GTAO normals, x-ray, mirror…) updates the scene's world matrices once, not once per render — three's
 * WebGLRenderer.render() walks the whole scene for its matrices on every call while scene.matrixWorldAutoUpdate is on
 * (M18's load: ~900 whole-scene walks, ~4 s of main thread). The matrices the renders see are those of the moment.
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { withSceneMatrices } from '../../src/engine/matrix-freeze.js';

/** three's render() as far as the scene's matrices go (WebGLRenderer.render: `if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld()`). */
const render = (scene, seen) => { if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld(); seen.push(scene.children[0].matrixWorld.elements[12]); };

function sceneWithCounter() {
  const scene = new THREE.Scene(), box = new THREE.Object3D(), child = new THREE.Object3D();
  box.add(child); scene.add(box);
  let n = 0; const f = scene.updateMatrixWorld;
  scene.updateMatrixWorld = function (...a) { n++; return f.apply(this, a); };
  return { scene, box, child, calls: () => n };
}

test('matrix freeze: a burst of six renders updates the scene once, with the moment\'s matrices', () => {
  const { scene, box, child, calls } = sceneWithCounter();
  box.position.x = 7; child.position.z = 2;
  const seen = [];
  const r = withSceneMatrices(scene, () => { for (let i = 0; i < 6; i++) render(scene, seen); return 'done'; });
  assert.equal(r, 'done');
  assert.equal(calls(), 1, 'one whole-scene update for the burst');
  assert.deepEqual(seen, [7, 7, 7, 7, 7, 7], 'every render saw the moved box');
  assert.equal(child.matrixWorld.elements[12], 7); assert.equal(child.matrixWorld.elements[14], 2);
  assert.equal(scene.matrixWorldAutoUpdate, true, 'the flag is back on after');
  // without the freeze: one walk per render (what the warm-up did)
  const seen2 = [];
  for (let i = 0; i < 6; i++) render(scene, seen2);
  assert.equal(calls(), 7);
});

test('matrix freeze: the flag comes back on when the burst throws; a frozen scene is left as it is', () => {
  const { scene, calls } = sceneWithCounter();
  assert.throws(() => withSceneMatrices(scene, () => { throw new Error('lost context'); }), /lost context/);
  assert.equal(scene.matrixWorldAutoUpdate, true);
  // inside Game.render's window (flag already off: its one update done): no extra update, still off after
  scene.matrixWorldAutoUpdate = false;
  const before = calls();
  withSceneMatrices(scene, () => render(scene, []));
  assert.equal(calls(), before, 'no update inside a frozen window');
  assert.equal(scene.matrixWorldAutoUpdate, false, 'the caller\'s window keeps its flag');
  assert.equal(withSceneMatrices(null, () => 3), 3, 'no scene: just runs');
});
