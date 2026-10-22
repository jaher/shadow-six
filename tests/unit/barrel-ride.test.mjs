/** Carried-barrel ride (the fallback for a carrier without the barrel clips; with them the drum rides his hands:
 *  art/barrel-carry.js, tests/unit/barrel-carry): the drum is posed from the carrier's animated pelvis
 *  (Barrel.renderUpdate), not left gliding on his sim transform — bob present while he walks, settled while he stands,
 *  untouched unladen; the rest pose is taken once he stands with it, every offset clamped. */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { Barrel } from '../../src/entities/interactables.js';

function rig() {
  const root = new THREE.Group();                    // the carrier's model root (== his object3d here)
  const pelvis = new THREE.Bone(); pelvis.name = 'pelvis';
  pelvis.position.set(0, 1.02, 0.02);
  root.add(pelvis);
  const carrier = { model: { root }, object3d: root, heading: 0, _moving: false, x: 0, z: 0, y: 0 };
  const barrel = new Barrel({ x: 0, z: 0.35, object3d: new THREE.Group() });
  barrel.carriedBy = carrier;
  return { pelvis, carrier, barrel };
}

test('carried barrel rides the carrier pelvis bob', () => {
  const { pelvis, carrier, barrel } = rig();
  barrel.object3d.position.set(0, 0.9, 0.35);
  barrel.renderUpdate(1 / 60);                       // baseline (standing)
  carrier._moving = true;
  const ys = [];
  for (let i = 0; i < 120; i++) {                    // two seconds of walking bob (±6 cm at 1 Hz)
    pelvis.position.y = 1.02 + Math.sin(i / 60 * Math.PI * 2) * 0.06;
    barrel.object3d.position.set(0, 0.9, 0.35);      // syncTransform re-poses from the sim each frame
    barrel.renderUpdate(1 / 60);
    ys.push(barrel.object3d.position.y);
  }
  const pk = Math.max(...ys) - Math.min(...ys);
  assert.ok(pk > 0.06, `drum bobs with the body (pkpk ${(pk * 100).toFixed(1)} cm)`);
});

test('carried barrel settles when the carrier stands', () => {
  const { pelvis, carrier, barrel } = rig();
  barrel.object3d.position.set(0, 0.9, 0.35);
  barrel.renderUpdate(1 / 60);
  carrier._moving = true;
  for (let i = 0; i < 30; i++) { pelvis.position.y = 1.02 + Math.sin(i / 60 * Math.PI * 2) * 0.06; barrel.object3d.position.set(0, 0.9, 0.35); barrel.renderUpdate(1 / 60); }
  carrier._moving = false; pelvis.position.y = 1.02;
  let y = 0;
  for (let i = 0; i < 90; i++) { barrel.object3d.position.set(0, 0.9, 0.35); barrel.renderUpdate(1 / 60); y = barrel.object3d.position.y; }
  assert.ok(Math.abs(y - 0.9) < 0.01, `drum settles back to its carry height (${y.toFixed(3)})`);
});

test('unladen barrel is not posed by renderUpdate', () => {
  const barrel = new Barrel({ x: 0, z: 0, object3d: new THREE.Group() });
  barrel.object3d.position.set(3, 0, 4);
  barrel.renderUpdate(1 / 60);
  assert.equal(barrel.object3d.position.y, 0);
  assert.equal(barrel.object3d.rotation.x, 0);
});

test('carried barrel: the rest pose is not taken while he is still crouched from the pick-up (capture 2026-10-22)', () => {
  const { pelvis, carrier, barrel } = rig();
  carrier._animOverride = { name: 'plant', t: 0.1 };      // the pick-up clip still playing: pelvis low
  pelvis.position.y = 0.55;
  for (let i = 0; i < 6; i++) { barrel.object3d.position.set(0, 0.9, 0.35); barrel.renderUpdate(1 / 60); }
  carrier._animOverride = null; pelvis.position.y = 1.06;  // he stands with it
  let y = 0;
  for (let i = 0; i < 120; i++) { barrel.object3d.position.set(0, 0.9, 0.35); barrel.renderUpdate(1 / 60); y = barrel.object3d.position.y; }
  assert.ok(Math.abs(y - 0.9) < 0.01, `the drum at its carry height, not lifted by the crouch (${y.toFixed(3)}; was 0.9 + 0.47)`);
});

test('carried barrel: the ride offset is clamped up and down as well as fore / aft / sideways', () => {
  const { pelvis, carrier, barrel } = rig();
  barrel.object3d.position.set(0, 0.9, 0.35);
  barrel.renderUpdate(1 / 60);
  pelvis.position.y = 1.02 + 0.4;                          // a pose far off the rest
  let y = 0;
  for (let i = 0; i < 30; i++) { barrel.object3d.position.set(0, 0.9, 0.35); barrel.renderUpdate(1 / 60); y = barrel.object3d.position.y; }
  assert.ok(y - 0.9 <= 0.07 + 1e-9, `clamped (${(y - 0.9).toFixed(3)} m)`);
});
