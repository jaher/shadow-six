/** §3.2 pistol while moving: "A unit already moving keeps moving and can fire when in range." (also the SMG). */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';

test('§3.2 pistol fired while walking: the shot lands and the unit keeps walking', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10, heading: 0 }], enemies: [guard('e1', 18, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.issue({ type: 'move', x: 10, z: 30 }));
  s.run(0.5);
  assert.ok(gb.path, 'moving before the shot');
  const z0 = gb.z;
  assert.ok(gb.issue({ type: 'ability', id: 'pistol', target: e }));
  assert.ok(gb.path, 'path kept when the pistol order is given');
  assert.notEqual(gb.state, 'busy', 'not set busy while firing on the move');
  s.run(1);
  assert.equal(e.hp, 120, 'the shot hits (80)');
  assert.ok(gb.path, 'still walking after the shot');
  assert.ok(gb.z > z0 + 0.5, `kept moving (${z0.toFixed(2)} → ${gb.z.toFixed(2)})`);
  assert.equal(gb.armed, 'pistol', 'pistol stays drawn');
});

test('§3.2 pistol from a standstill still halts and acts (busy during the draw)', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10, heading: 0 }], enemies: [guard('e1', 18, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.issue({ type: 'ability', id: 'pistol', target: e }));
  assert.equal(gb.state, 'busy');
  s.run(0.6);
  assert.equal(e.hp, 120);
  assert.equal(gb.x, 10);
  assert.equal(gb.z, 10);
});

test('§3.2 SMG burst while walking: the driver keeps walking', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 10, z: 10, inventory: { smg: 20 } }], enemies: [guard('a', 20, 12)] }, { brains: false });
  const dr = s.cmd('driver'), a = s.get('a');
  assert.ok(dr.issue({ type: 'move', x: 10, z: 30 }));
  s.run(0.5);
  const z0 = dr.z;
  assert.ok(dr.issue({ type: 'ability', id: 'smg', target: { x: a.x, z: a.z } }));
  s.run(1);
  assert.equal(dr.inventory.get('smg'), 19, 'one burst fired');
  assert.ok(dr.path, 'still walking after the burst');
  assert.ok(dr.z > z0 + 0.5, 'kept moving');
});

test('§3.2 a shot on the move keeps the legs walking (no shoot pose gliding along; M3 video "walk in all configurations")', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10, heading: 0 }], enemies: [guard('e1', 18, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e1');
  assert.ok(gb.issue({ type: 'move', x: 10, z: 30 }));
  s.run(0.5);
  assert.equal(gb._anim, 'walk');
  assert.ok(gb.issue({ type: 'ability', id: 'pistol', target: e }));
  const seen = new Set();
  for (let i = 0; i < 60; i++) { s.run(1 / 60); if (gb.path) seen.add(gb._anim); }
  assert.equal(e.hp, 120, 'the shot still hits');
  assert.deepEqual([...seen], ['walk'], `walking clip all along while moving (saw ${[...seen]})`);
  // stopping inside the shot window brings the shot pose back
  gb.issue({ type: 'ability', id: 'pistol', target: e });
  gb.stop(); s.run(1 / 30);
  assert.equal(gb._anim, 'shoot', 'standing still: the shot pose');
});

test('§3.2 a crawler firing on the move keeps crawling (no prone shoot pose sliding along)', () => {
  const s = makeSim({ commandos: [{ role: 'diver', x: 10, z: 10, heading: 0 }], enemies: [guard('e1', 16, 12, 0)] }, { brains: false });
  const dv = s.cmd('diver'), e = s.get('e1');
  dv.setStance('crawl'); s.run(1);
  assert.ok(dv.issue({ type: 'move', x: 10, z: 20 }));
  s.run(0.5);
  assert.equal(dv._anim, 'crawl');
  assert.ok(dv.issue({ type: 'ability', id: 'pistol', target: e }));
  const seen = new Set();
  for (let i = 0; i < 40; i++) { s.run(1 / 60); if (dv.path) seen.add(dv._anim); }
  assert.deepEqual([...seen], ['crawl'], `crawling clip all along (saw ${[...seen]})`);
});

test('a Green Beret dug in with the shovel is never eased aside by a man standing on him (§3.4 "cannot move")', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10, heading: 0 }], enemies: [guard('e1', 10.3, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet');
  gb.buried = true; gb.state = 'hidden';
  s.run(1);
  assert.equal(gb.x, 10); assert.equal(gb.z, 10);
  // (the premise: unburied, the same man is eased off him)
  gb.buried = false; gb.state = 'active';
  s.run(1);
  assert.ok(Math.hypot(gb.x - 10, gb.z - 10) > 0.05, 'standing, he is eased aside');
});
