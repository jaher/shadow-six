/**
 * M15's ruined wing (scripts/m15.js ruinWing: at the HQ blast the S wing and the service range take the house's first
 * mesh's material) must have its programs before the blast: the mission's warmObjects (ruinWarmObjects) hands the load's
 * warm-up frame copies of both parts, where they stand, in exactly the material ruinWing will give them; the parts
 * themselves stay untouched until then. The vfx hero shell warm (render/vfx warmObjects) is the debris material.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { ruinWarmObjects, ruinWing } from '../../src/missions/scripts/m15.js';
import mission from '../../src/missions/m15_the_end_of_the_butcher.js';
import { heroMaterial } from '../../src/render/vfx/effects.js';

function part(name, mats, at) {
  const g = new THREE.Group(); g.name = name; g.position.set(...at); g.rotation.y = 0.4;
  for (const m of mats) g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
  return g;
}

function world() {
  const brick = new THREE.MeshStandardMaterial({ name: 'kit:brick_red' });
  const hq = part('hq', [brick, new THREE.MeshStandardMaterial({ name: 'kit:slate' })], [60, 0, 50]);
  const holder = new THREE.Group(); holder.position.set(5, 0, -3); // (a part nested under a moved parent)
  const wing = part('hq_wing', [new THREE.MeshStandardMaterial({ name: 'kit:brick_dark' }), new THREE.MeshStandardMaterial({ name: 'kit:granite' })], [56.5, 0, 74.5]);
  holder.add(wing);
  const communs = part('hq_communs', [new THREE.MeshStandardMaterial({ name: 'dressing:brick' })], [70, 0, 45]);
  const ent = { hq: { object3d: hq, destroyed: false } };
  const structures = new Map([['hq_wing', { object3d: wing }], ['hq_communs', { object3d: communs }]]);
  return { w: { byId: (id) => ent[id], structures }, brick, wing, communs };
}

test('ruinWarmObjects: copies of the wing and the range, where they stand, in the material ruinWing gives them', () => {
  const { w, brick, wing, communs } = world();
  const warm = ruinWarmObjects(w);
  assert.equal(warm.objects.length, 2);
  for (const [c, src] of [[warm.objects[0], wing], [warm.objects[1], communs]]) {
    src.updateMatrixWorld(true);
    assert.ok(c.matrix.equals(src.matrixWorld), "placed at the part's world matrix");
    c.traverse((o) => { if (o.isMesh) assert.equal(o.material, brick); });
  }
  // the parts themselves untouched until the blast
  wing.traverse((o) => { if (o.isMesh) assert.notEqual(o.material, brick); });
  warm.done();
  // at the blast ruinWing gives the parts that same material
  ruinWing(w);
  for (const p of [wing, communs]) p.traverse((o) => { if (o.isMesh) assert.equal(o.material, brick); });
  assert.equal(ruinWarmObjects(w).objects.length, 0, 'ruined already: nothing left to warm');
});

test('the M15 mission hands warmObjects to the load; the vfx hero shell warm uses the debris material', () => {
  assert.equal(mission.warmObjects, ruinWarmObjects);
  const a = heroMaterial(new THREE.Color(0x3f4a2a)), b = heroMaterial(new THREE.Color(0x123456));
  for (const k of ['type', 'side', 'roughness', 'metalness', 'transparent', 'vertexColors']) assert.equal(a[k], b[k], k);
  assert.equal(a.side, THREE.DoubleSide);
});
