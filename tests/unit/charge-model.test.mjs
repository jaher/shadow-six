/**
 * The Sapper's charges as real objects (user 2026-10-08: "The explosive looks like a circle, make it look realistic";
 * src/art/demolition-charge.js): a slab bundle with ties and a detonator, the watch delay (time) or the receiver with
 * its aerial (remote); 25–35 cm, a few hundred triangles from shared geometry; the armed cue (watch hand + ticks, pilot
 * lamp); lying on the ground it was set on, tilted to the slope (≤ 30°); the same model in his hand (plant / take).
 */
import { test, assert, near } from './lib.mjs';
import * as THREE from 'three';
import { makeSim } from './abilsim.mjs';
import { makeCharge, makeMillsBomb, chargeWeapon, triangleCount, CHARGE_SCALE } from '../../src/art/demolition-charge.js';
import { chargeProp } from '../../src/art/unit-anim-map.js';
import { PROPS } from '../../src/art/characters/commandos_b/weapons.js';
import { Bomb, Grenade } from '../../src/abilities/charges.js';
import { Entity } from '../../src/entities/entity.js';
import { restoreWorld } from '../../src/save.js';
import { headingToRotY } from '../../src/core/math.js';

const names = (o) => { const s = new Set(); o.traverse((c) => s.add(c.name)); return s; };
const size = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

test('charge model: a slab bundle with ties and a detonator; the time charge has the watch, the remote the receiver and aerial', () => {
  const t = makeCharge('time'), r = makeCharge('remote');
  assert.equal(t.name, 'time_charge');
  assert.equal(r.name, 'remote_charge');
  for (const o of [t, r]) for (const n of ['slab_a', 'slab_b', 'tie', 'detonator', 'det_tube', 'det_cap']) assert.ok(names(o).has(n), `${o.name}: ${n}`);
  for (const n of ['watch_case', 'watch_dial', 'watch_hand']) assert.ok(names(t).has(n), n);
  for (const n of ['rx_box', 'rx_lamp', 'aerial_rod']) assert.ok(names(r).has(n), n);
  assert.ok(!names(t).has('rx_box') && !names(r).has('watch_dial'));
});

test('charge model: 25–35 cm, sits on y = 0, a few hundred triangles, geometry and materials shared by every charge', () => {
  for (const k of ['time', 'remote']) {
    const c = makeCharge(k), s = size(c), b = new THREE.Box3().setFromObject(c);
    assert.ok(s.z >= 0.25 && s.z <= 0.35, `${k} long side (along +z, its heading) ${s.z.toFixed(3)} m`);
    assert.ok(s.x >= 0.12 && s.x <= 0.25, `${k} width ${s.x.toFixed(3)} m`);
    assert.ok(s.y >= 0.09, `${k} stands up off the ground (${s.y.toFixed(3)} m), not a flat disc`);
    assert.ok(Math.abs(b.min.y) < 0.005, `${k} rests on the ground (min y ${b.min.y.toFixed(4)})`);
    const n = triangleCount(c);
    assert.ok(n > 150 && n <= 600, `${k}: ${n} triangles`);
    const a = makeCharge(k), m1 = [], m2 = [];
    c.traverse((o) => o.isMesh && m1.push(o)); a.traverse((o) => o.isMesh && m2.push(o));
    m1.forEach((o, i) => {
      assert.equal(o.geometry, m2[i].geometry, `${k} ${o.name}: one geometry for every charge`);
      assert.ok(o.geometry.userData.shared && [].concat(o.material).every((mm) => mm.userData.shared), `${k} ${o.name}: kept on dispose`);
    });
  }
  assert.equal(CHARGE_SCALE, 1.2);
});

test('armed cue: the watch hand sweeps once round over the fuse and the dial flashes at each tick (2 → 4 Hz); the pilot lamp winks, steady once fired', () => {
  const t = makeCharge('time').userData.charge;
  near(t.tick({ fuse: 10, fuse0: 10 }).hand, 0, 1e-9, 'set: 12 o\'clock');
  near(t.tick({ fuse: 5, fuse0: 10 }).hand, Math.PI, 1e-9, 'half the fuse: half a turn');
  near(t.tick({ fuse: 0, fuse0: 10 }).hand, 2 * Math.PI, 1e-9, 'full turn as it goes off');
  let flashes = 0, prev = false;
  for (let e = 0; e <= 10; e += 1 / 120) { const lit = t.tick({ fuse: 10 - e, fuse0: 10 }).lit; if (lit && !prev) flashes++; prev = lit; }
  assert.ok(Math.abs(flashes - 30) <= 1, `≈30 ticks over a 10 s fuse (2t + t²/F at t = F): ${flashes}`);
  let early = 0, late = 0; prev = false;
  for (let e = 0; e <= 10; e += 1 / 120) { const lit = t.tick({ fuse: 10 - e, fuse0: 10 }).lit; if (lit && !prev) (e < 2 ? early++ : e > 8 ? late++ : 0); prev = lit; }
  assert.ok(late > early, `faster at the end (${early} in the first 2 s, ${late} in the last 2 s)`);
  const r = makeCharge('remote').userData.charge;
  const lit = [];
  for (let s = 0; s < 3; s += 1 / 60) lit.push(r.tick({ time: s }).lit);
  const on = lit.filter(Boolean).length / lit.length;
  assert.ok(on > 0.08 && on < 0.25, `a short wink each second (on ${Math.round(on * 100)} %)`);
  assert.equal(r.tick({ time: 0.5, detonating: true }).lit, true, 'fired: steady');
});

test('a planted Bomb is the charge model, laid along the planter\'s heading; the thrown grenade is a Mills bomb', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10, heading: 0.7, inventory: { timeBomb: 1 } }] }, { brains: false });
  const sp = s.cmd('sapper');
  sp.issue({ type: 'ability', id: 'timeBomb', target: sp });
  s.run(1.05);
  const b = s.world.interactables.find((i) => i.interactKind === 'bomb');
  assert.equal(b.object3d.name, 'time_charge');
  near(b.heading, 0.7, 1e-9, 'along his heading');
  near(b.fuse0, 10, 1e-9);
  const r = new Bomb({ x: 1, z: 1, bombKind: 'remote' });
  assert.equal(r.object3d.name, 'remote_charge');
  const g = new Grenade({ from: { x: 0, z: 0 }, to: { x: 5, z: 0 } });
  assert.equal(g.object3d.name, 'mills_bomb');
  assert.ok(triangleCount(g.object3d) <= 300);
});

test('it lies on the ground it was set on: the visual relief\'s slope (≤ 30°), flat where the relief is flat (decks, floors)', () => {
  const s = makeSim({ commandos: [{ role: 'sapper', x: 10, z: 10 }] }, { brains: false });
  const w = s.world;
  const tiltDeg = (b) => (b._tilt ? (2 * Math.acos(Math.min(1, Math.abs(b._tilt.w))) * 180) / Math.PI : 0);
  w.groundY = (x) => 0.3 * x; // 16.7° up towards +x
  const a = w.add(new Bomb({ x: 12, z: 10, bombKind: 'time' }));
  a.syncTransform(1);
  near(tiltDeg(a), (Math.atan(0.3) * 180) / Math.PI, 0.05, 'tilted to the slope');
  near(a.object3d.position.y, 3.6, 1e-6, 'on the relief');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(a.object3d.quaternion);
  assert.ok(up.x < 0, 'its top leans away from the rise (normal (-0.3, 1, 0))');
  w.groundY = (x) => 3 * x; // a rock edge (72°)
  const e = w.add(new Bomb({ x: 12, z: 12, bombKind: 'remote' }));
  e.syncTransform(1);
  near(tiltDeg(e), 30, 0.05, 'never more than 30°');
  w.groundY = () => 0;
  const f = w.add(new Bomb({ x: 14, z: 10, bombKind: 'time', heading: 1.1 }));
  f.syncTransform(1);
  assert.equal(f._tilt, null, 'flat');
  near(f.object3d.rotation.y, headingToRotY(1.1), 1e-6, 'turned to its heading (headingToRotY)');
  const along = new THREE.Box3().setFromObject(f.object3d).getSize(new THREE.Vector3());
  const dir = new THREE.Vector3(Math.cos(1.1), 0, Math.sin(1.1));
  assert.ok(Math.abs(along.x * Math.abs(dir.x) + along.z * Math.abs(dir.z)) > 0.25, 'its long side along the heading');
});

test('in his hand: the same models as commandos_b clip props (plant / take_charge), the one the action sets or takes back', () => {
  for (const k of ['time', 'remote']) {
    const wpn = chargeWeapon(k);
    assert.ok(wpn.sockets.grip_r, `${k}: grip_r`);
    assert.ok(names(wpn.root).has(`${k}_charge`), `${k}: the ground model inside`);
  }
  assert.ok(PROPS.time_bomb.includes('plant') && PROPS.time_bomb.includes('take_charge'));
  assert.ok(PROPS.remote_bomb.includes('plant') && PROPS.remote_bomb.includes('take_charge'));
  assert.equal(chargeProp('timeBomb'), 'time_bomb');
  assert.equal(chargeProp('remoteBomb'), 'remote_bomb');
  assert.equal(chargeProp('takeCharge', { bombKind: 'remote' }), 'remote_bomb');
  assert.equal(chargeProp('takeCharge', { bombKind: 'time' }), 'time_bomb');
  assert.equal(chargeProp('trap'), null, 'the bear trap is set empty-handed (same plant clip)');
});

test('save / load keeps the fuse it was set with (the watch hand) and its heading', () => {
  const def = { commandos: [{ role: 'sapper', x: 10, z: 10, heading: -0.4, inventory: { timeBomb: 1 } }] };
  const id0 = Entity.nextId;
  const a = makeSim(def, { brains: false });
  const sp = a.cmd('sapper');
  sp.issue({ type: 'ability', id: 'timeBomb', target: sp });
  a.run(3);
  const snap = JSON.parse(JSON.stringify({ ...a.world.serialize(), nextId: Entity.nextId }));
  Entity.nextId = id0;
  const b = makeSim(def, { brains: false });
  restoreWorld(b.world, snap);
  const bomb = b.world.interactables.find((i) => i.interactKind === 'bomb');
  near(bomb.fuse0, 10, 1e-9);
  near(bomb.heading, -0.4, 1e-9);
  assert.equal(bomb.object3d.name, 'time_charge');
});
