/** BCD stones and cigarette packs (docs/bcd-plan.md §1.4, §1.5; plan step N5). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { CONFIG } from '../../src/config.js';
import { stoneLanded, packLanded } from '../../src/ai/bcd-reactions.js';
import { createPickup } from '../../src/entities/interactables.js';

const walker = (id, x, z, h = 0) => ({ id, soldierType: 'soldier', x, z, heading: h, route: { type: 'PINGPONG', points: [{ x, z }, { x: x + 0.5, z }] } });

test('BCD stone: thrown with Y (12 m arc, hidden count); a soldier within 4 m turns and looks, then resumes', () => {
  const s = bcdSim({ commandos: [{ role: 'sniper', x: 10, z: 30 }], enemies: [post('a', 30, 30, 0)] });
  const sn = s.cmd('sniper'), e = s.get('a');
  assert.equal(sn.inventory.get('stones'), CONFIG.bcd.stones.hiddenCount);
  assert.notEqual(sn.useAbility('stone', { x: 40, z: 30 }), true, 'beyond 12 m');
  assert.equal(sn.useAbility('stone', { x: 21, z: 30 }), true);
  s.run(1.2);
  assert.equal(sn.inventory.get('stones'), 49);
  assert.ok(s.count('bcd:stone') === 1);
  // the stone fell 9 m from him: out of reach of the 4 m click
  assert.equal(e.brain.state, 'IDLE');
  stoneLanded(s.world, 27, 31, sn);
  assert.equal(e.brain.state, 'STONE');
  assert.equal(e.brain.phase, 'look');
  s.run(0.2);
  assert.ok(Math.abs(e.heading) > 0.005 && Math.abs(Math.atan2(31 - 30, 27 - 30) - e.heading) > 0.5, 'turning round on the spot (SHADOW SIX smooth turn), not snapped');
  s.run(1.0);
  assert.ok(Math.abs(Math.atan2(31 - 30, 27 - 30) - e.heading) < 0.05, 'faces the point');
  s.run(CONFIG.bcd.stones.lookTime + 0.2);
  assert.notEqual(e.brain.state, 'STONE', 'look over');
  assert.ok(!s.alarmed(), 'never an alarm');
});

test('BCD stone: the 3rd stone within 20 s makes a walker go over and search; posts only look', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 5, z: 5 }], enemies: [walker('w', 30, 30), { ...post('p', 30, 50, 0), soldierType: 'sentry' }] });
  const w = s.get('w'), p = s.get('p');
  for (let k = 0; k < 2; k++) { stoneLanded(s.world, 32, 31); s.run(1); assert.equal(w.brain.phase, 'look', `stone ${k + 1}`); }
  stoneLanded(s.world, 33, 31);
  assert.equal(w.brain.phase, 'go', '3rd stone → investigate');
  s.run(4, () => w.brain.phase === 'search');
  assert.equal(w.brain.phase, 'search');
  assert.ok(Math.hypot(w.x - 33, w.z - 31) < 1.6);
  for (let k = 0; k < 3; k++) { stoneLanded(s.world, 31, 51); s.run(0.5); }
  assert.equal(p.brain.phase, 'look', 'holdsPost only looks');
  assert.ok(!s.alarmed());
});

test('BCD stone: the window is 20 s — three stones spread over 25 s never make him walk', () => {
  const s = bcdSim({ enemies: [walker('w', 30, 30)] });
  const w = s.get('w');
  for (let k = 0; k < 3; k++) { stoneLanded(s.world, 31, 31); assert.equal(w.brain.phase, 'look'); s.run(12); }
});

test('BCD pack: lands in a near band → the nearest soldier walks over, kneels 3 s (short cone), pockets it', () => {
  const s = bcdSim({ commandos: [{ role: 'driver', x: 5, z: 5, inventory: { cigarettes: 2 } }], enemies: [post('a', 30, 30, 0), post('b', 20, 30, 0)] });
  const a = s.get('a'), b = s.get('b');
  const pack = createPickup('cigarettes', 36, 30, 1);
  pack.object3d = null;
  s.world.add(pack);
  const who = packLanded(s.world, pack);
  assert.equal(who, a, 'a: near band (6 m); b is 16 m away (far band) and farther');
  assert.equal(a.brain.state, 'CIGS');
  s.run(6, () => a.brain.phase === 'kneel');
  assert.equal(a.brain.phase, 'kneel');
  assert.equal(a.vision.far, a.vision.near, 'cone shortened to the near band during the kneel');
  s.run(CONFIG.bcd.cigarettes.pickupTime + 0.2);
  assert.equal(a.cigs, 2, 'his own + the thrown pack');
  assert.ok(pack.removed || pack.count === 0);
  assert.equal(a.vision.far, 36, 'cone restored');
  assert.equal(b.brain.state, 'IDLE', 'only the nearest goes');
});

test('BCD pack: outside every near band it stays on the ground; aware men and Gestapo ignore packs', () => {
  const s = bcdSim({ enemies: [post('a', 30, 30, 0), { ...post('g', 30, 50, 0), soldierType: 'gestapo' }] });
  const far = createPickup('cigarettes', 55, 30, 1); far.object3d = null; s.world.add(far);
  assert.equal(packLanded(s.world, far), null, '25 m: far band only');
  const g = createPickup('cigarettes', 34, 50, 1); g.object3d = null; s.world.add(g);
  assert.equal(packLanded(s.world, g), null, 'Gestapo ignore packs');
  const a = s.get('a');
  a.brain._enterCombat(s.world.commandos[0] || { x: 0, z: 0, faction: 'player' });
  const n = createPickup('cigarettes', 33, 30, 1); n.object3d = null; s.world.add(n);
  assert.equal(packLanded(s.world, n), null, 'aware soldiers ignore packs');
});

test('BCD pack: V throws one (10 m); H loots a knocked-out man’s pack (0.8 s)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21, inventory: { cigarettes: 1 } }], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  assert.ok(gb.abilities.includes('cigarettes'));
  assert.notEqual(gb.useAbility('cigarettes', { x: 20, z: 40 }), true, '19 m: out of range');
  gb.useAbility('knockoutFist', a);
  s.run(1.2);
  assert.equal(gb.useAbility('hand', a), true);
  s.run(1.5);
  assert.equal(gb.inventory.get('cigarettes'), 2, 'looted');
  assert.equal(a.cigs, 0);
  assert.equal(gb.useAbility('cigarettes', { x: 25, z: 21 }), true);
  s.run(1.5);
  assert.equal(gb.inventory.get('cigarettes') ?? 0, 1);
  assert.ok(s.world.interactables.some((i) => i.itemId === 'cigarettes' && !i.removed), 'pack on the ground');
});
