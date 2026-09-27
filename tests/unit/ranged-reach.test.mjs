/**
 * Ranged abilities: range and forbidden cursor (design-spec §3.3 "Out-of-range feedback" / "Auto-walk",
 * §3.4 Sniper lens). Ranged abilities (pistol, sniper, smg, harpoon, grenade, trap, vehicleFire) never
 * walk into range: canUse refuses out-of-range / no-LOS targets (forbidden cursor, issue() refused).
 * Melee abilities and `hand` keep auto-walking.
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { Input } from '../../src/engine/input.js';

/** Drive Input._updateTargetCursor with a stub (no DOM): returns the cursor it sets. */
function cursorFor(s, abilityId, commando, target) {
  const def = ABILITIES[abilityId];
  let cur = null;
  const fake = {
    targeting: { abilityId, def, commando, commandos: [commando] },
    resolveTarget: () => target,
    world: s.world,
    setCursor: (c) => { cur = c; },
  };
  Input.prototype._updateTargetCursor.call(fake, 0, 0);
  return cur;
}

test('§3.4 sniper: enemy at 53 m → forbidden lens, order refused, he never walks; at 40 m he shoots', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 5, z: 10 }], enemies: [guard('far', 58, 10, Math.PI), guard('near', 45, 14, Math.PI)] }, { brains: false });
  const sn = s.cmd('sniper'), far = s.get('far'), near = s.get('near');
  assert.equal(ABILITIES.sniper.canUse(sn, far, s.world), 'Out of range.');
  assert.equal(cursorFor(s, 'sniper', sn, far), 'forbidden');
  assert.equal(sn.issue({ type: 'ability', id: 'sniper', target: far }), false, 'refused beyond 45 m');
  s.run(6);
  assert.ok(Math.abs(sn.x - 5) < 1e-6, `did not walk (x=${sn.x})`);
  assert.ok(far.alive, 'no shot beyond 45 m');
  assert.equal(cursorFor(s, 'sniper', sn, near), 'scope');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: near }));
  s.run(3, () => !near.alive);
  assert.equal(near.alive, false);
  assert.ok(Math.abs(sn.x - 5) < 1e-6, 'shot from where he stands');
});

test('§3.4 sniper / harpoon: no LOS (wall between) → forbidden', () => {
  const s = makeSim({
    structures: [{ type: 'wall', points: [[12, 0], [12, 20]] }],
    commandos: [{ role: 'sniper', x: 5, z: 10 }, { role: 'diver', x: 5, z: 12 }],
    enemies: [guard('e', 18, 10, Math.PI)],
  }, { brains: false });
  const e = s.get('e');
  assert.equal(ABILITIES.sniper.canUse(s.cmd('sniper'), e, s.world), 'No line of sight.');
  assert.equal(cursorFor(s, 'sniper', s.cmd('sniper'), e), 'forbidden');
  assert.equal(ABILITIES.harpoon.canUse(s.cmd('diver'), e, s.world), 'Out of range.');
});

test('§3.3 pistol / smg / harpoon / grenade / trap: beyond range → forbidden, refused, no approach walk', () => {
  const s = makeSim({
    commandos: [{ role: 'sapper', x: 5, z: 10, inventory: { grenade: 2 } }, { role: 'driver', x: 5, z: 20, inventory: { smg: 20 } }, { role: 'diver', x: 5, z: 30 }],
    enemies: [guard('e1', 58, 10, Math.PI), guard('e2', 40, 20, Math.PI), guard('e3', 30, 30, Math.PI)],
  }, { brains: false });
  const sp = s.cmd('sapper'), dr = s.cmd('driver'), mr = s.cmd('diver');
  const cases = [
    [sp, 'pistol', s.get('e1')], [sp, 'grenade', { x: 45, z: 10 }], [sp, 'trap', { x: 8, z: 10 }],
    [dr, 'smg', s.get('e2')], [dr, 'pistol', { x: 25, z: 20 }], [mr, 'harpoon', s.get('e3')],
  ];
  for (const [c, id, t] of cases) {
    assert.equal(ABILITIES[id].canUse(c, t, s.world), 'Out of range.', `${id} canUse`);
    assert.equal(cursorFor(s, id, c, t), 'forbidden', `${id} cursor`);
    assert.equal(c.issue({ type: 'ability', id, target: t }), false, `${id} refused`);
  }
  s.run(6);
  assert.ok(Math.abs(sp.x - 5) < 1e-6 && Math.abs(dr.x - 5) < 1e-6 && Math.abs(mr.x - 5) < 1e-6, 'nobody walked');
  assert.ok(['e1', 'e2', 'e3'].every((id) => s.get(id).alive));
  // in range they are fine
  assert.equal(ABILITIES.pistol.canUse(sp, { x: 18, z: 10 }, s.world), true);
  assert.equal(ABILITIES.grenade.canUse(sp, { x: 18, z: 10 }, s.world), true);
  assert.equal(ABILITIES.trap.canUse(sp, { x: 6, z: 10 }, s.world), true);
  assert.equal(ABILITIES.smg.canUse(dr, { x: 22, z: 20 }, s.world), true);
});

test('§3.3 ranged pending order whose target slips out of range is dropped, not chased', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 5, z: 10 }], enemies: [guard('e', 45, 10, 0)] }, { brains: false });
  const sn = s.cmd('sniper'), e = s.get('e');
  assert.ok(sn.issue({ type: 'stance', stance: 'crawl' }));
  s.run(0.6);
  // simulate a pending sniper order and the target stepping to 52 m
  sn.pendingAbility = { def: ABILITIES.sniper, target: e, run: false, t: 0, repathT: 0, click: null };
  e.x = 57;
  sn._updatePending(0.1);
  assert.equal(sn.pendingAbility, null);
  s.run(3);
  assert.ok(Math.abs(sn.x - 5) < 1e-6 && e.alive);
});

test('§3.3 auto-walk stays for melee: knife walks up to a far enemy', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 5, z: 10 }], enemies: [guard('e', 20, 10, 0)] }, { brains: false });
  const gb = s.cmd('greenberet'), e = s.get('e');
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e, run: true }));
  s.run(8, () => !e.alive);
  assert.equal(e.alive, false);
});

test('§3.3 vehicleFire: a spot beyond every mounted weapon\'s range → forbidden; in range → fires', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 5, z: 5 }] }, { brains: false });
  const dr = s.cmd('driver');
  const car = s.world.spawnVehicle('sdkfz', { x: 10, z: 30 });
  assert.ok(car.enter(dr));
  const far = { x: 70, z: 30 }, ok = { x: 40, z: 30 };
  assert.equal(ABILITIES.vehicleFire.canUse(dr, far, s.world), 'Out of range.');
  assert.equal(cursorFor(s, 'vehicleFire', dr, far), 'forbidden');
  assert.equal(dr.issue({ type: 'ability', id: 'vehicleFire', target: far }), false);
  assert.equal(ABILITIES.vehicleFire.canUse(dr, ok, s.world), true);
});
