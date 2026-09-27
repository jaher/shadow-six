/**
 * Weapon hand-overs (src/art/characters/weapon-handover.js; review: after a prone shot the No.4 jumped from the support
 * hand to the right fist and stood vertical for ~6 frames): a change of placement key blends the gun in character-root
 * space over DUR from where it was drawn, and a fixed bone-local placement comes back untouched afterwards. Also the
 * MP40 carries its own crawl grip (magazine in the fist, not rolled sideways).
 */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { weaponHandover, DUR } from '../../src/art/characters/weapon-handover.js';
import { proneGrip, GRIPS } from '../../src/art/characters/prone-grips.js';

function rig() {
  const object = new THREE.Group(), hl = new THREE.Object3D(), hr = new THREE.Object3D();
  hl.name = 'hand_l'; hr.name = 'hand_r'; hl.position.set(0.3, 0.1, 0.5); hr.position.set(-0.3, 0.1, 0.5);
  hr.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);   // right hand turned: its local frame differs
  object.add(hl, hr);
  const w = new THREE.Object3D(); hl.add(w);
  object.updateMatrixWorld(true);
  return { h: { object, weapon: w, _wKey: 'pg:l' }, hl, hr, w };
}
const world = (o) => { o.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

test('hand-over: a key change blends the gun from its last drawn placement, then settles on the new grip', () => {
  const { h, hr, w } = rig();
  for (let i = 0; i < 5; i++) weaponHandover(h, 1 / 60);
  const before = world(w);
  // runtime re-seats the gun in the right hand (fixed bone-local grip, as the bone-parented runtimes do at setAnim)
  hr.add(w); w.position.set(0, 0, 0.2); w.quaternion.identity(); h._wKey = 'pg:r';
  const target = world(w);
  weaponHandover(h, 1 / 60);
  const first = world(w);
  assert.ok(first.distanceTo(before) < 0.06 * before.distanceTo(target) + 1e-6, 'first frame stays near the old placement');
  let prev = first, maxStep = 0;
  for (let t = 1 / 60; t < DUR + 0.05; t += 1 / 60) { weaponHandover(h, 1 / 60); const p = world(w); maxStep = Math.max(maxStep, p.distanceTo(prev)); prev = p; }
  assert.ok(prev.distanceTo(target) < 1e-4, 'ends on the new grip');
  assert.ok(maxStep < 0.2 * before.distanceTo(target), 'no jump: max per-frame step ' + maxStep.toFixed(3));
  assert.ok(w.position.distanceTo(new THREE.Vector3(0, 0, 0.2)) < 1e-6, 'bone-local placement restored after the blend');
});

test('hand-over: no blend without a key change or after another prop is equipped', () => {
  const { h, hl, w } = rig();
  weaponHandover(h, 1 / 60);
  w.position.set(0, 0, 0.1); const p = world(w).clone();
  weaponHandover(h, 1 / 60);
  assert.ok(world(w).distanceTo(p) < 1e-6, 'same key: placement untouched');
  const w2 = new THREE.Object3D(); hl.add(w2); w2.position.set(0.5, 0, 0); h.weapon = w2; h._wKey = 'std';
  const p2 = world(w2).clone(); weaponHandover(h, 1 / 60);
  assert.ok(world(w2).distanceTo(p2) < 1e-6, 'new prop: shown where it is placed');
});

test('MP40 crawl grip: the fist holds the magazine, the gun points forward (not the magazine rolled sideways)', () => {
  assert.ok(GRIPS.crawl_mp40, 'crawl_mp40 grip generated');
  for (const clip of ['crawl', 'crawl_idle', 'prone_turn_l', 'go_prone', 'get_up']) {
    const g = proneGrip(clip, 'mp40', { grip_r: { position: new THREE.Vector3() } });
    assert.ok(g && !g.hide && g.hand === 'r', clip + ': MP40 in the right fist');
  }
  const t = proneGrip('crawl', 'thompson', {}), m = proneGrip('crawl', 'mp40', {});
  assert.ok(t.local !== m.local, 'Thompson keeps its foregrip grip');
});
