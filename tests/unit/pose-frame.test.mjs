/**
 * engine/pose-frame.js: inside a drawn frame a character skeleton computes its bone matrices once (three re-did it for
 * every render() pass), with the very values of three's Skeleton.update, and re-uploads its bone texture only when one
 * changed. Outside a drawn frame it updates on every call, as before.
 *   node tests/unit/run.mjs pose-frame
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { poseOncePerFrame, beginDrawnFrame, endDrawnFrame } from '../../src/engine/pose-frame.js';

function rig() {
  const root = new THREE.Bone(), mid = new THREE.Bone(), tip = new THREE.Bone();
  root.add(mid); mid.add(tip); mid.position.set(0, 0.5, 0.1); tip.position.set(0.05, 0.4, 0);
  mid.quaternion.setFromEuler(new THREE.Euler(0.3, 0.1, -0.2)); tip.quaternion.setFromEuler(new THREE.Euler(-0.4, 0.2, 0.05));
  root.updateMatrixWorld(true);
  const bones = [root, mid, tip];
  const inv = bones.map((b) => b.matrixWorld.clone().invert());
  root.position.set(1, 0, 2); root.updateMatrixWorld(true);
  return { bones, mine: poseOncePerFrame(new THREE.Skeleton(bones, inv.map((m) => m.clone()))), ref: new THREE.Skeleton(bones, inv.map((m) => m.clone())) };
}

test('pose-frame: the same bone matrices as Skeleton.update, once per drawn frame', () => {
  const { bones, mine, ref } = rig();
  beginDrawnFrame();
  mine.update(); ref.update();
  assert.deepEqual([...mine.boneMatrices], [...ref.boneMatrices], 'bit for bit');
  bones[1].quaternion.setFromEuler(new THREE.Euler(0.9, 0, 0)); bones[0].updateMatrixWorld(true);
  const before = [...mine.boneMatrices];
  mine.update();                                       // a later pass of the same frame: nothing redone
  assert.deepEqual([...mine.boneMatrices], before);
  endDrawnFrame();
  beginDrawnFrame();
  mine.update(); ref.update();
  assert.deepEqual([...mine.boneMatrices], [...ref.boneMatrices], 'the next frame has the new pose');
  endDrawnFrame();
  mine.update(); ref.update();                         // outside a drawn frame: every call
  assert.deepEqual([...mine.boneMatrices], [...ref.boneMatrices]);
});

test('pose-frame: the bone texture is re-uploaded only when a matrix changed', () => {
  const { bones, mine } = rig();
  mine.computeBoneTexture();
  const tex = mine.boneTexture;
  beginDrawnFrame(); mine.update(); endDrawnFrame();
  const v0 = tex.version;
  beginDrawnFrame(); mine.update(); endDrawnFrame();
  assert.equal(tex.version, v0, 'a still pose uploads nothing');
  bones[2].quaternion.setFromEuler(new THREE.Euler(0, 0.5, 0)); bones[0].updateMatrixWorld(true);
  beginDrawnFrame(); mine.update(); endDrawnFrame();
  assert.ok(tex.version > v0, 'a changed pose is uploaded');
});
