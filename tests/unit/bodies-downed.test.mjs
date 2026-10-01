/** bodies-design §C.6–§C.8, §E: buddy rescue — DOWNED, bleed-out, revive, mission flow. */
import { test, assert, near } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { nobodyLeftToHelp } from '../../src/entities/downed.js';

const P = CONFIG.bodies.downed;
/** Game._lossCondition without a renderer (it only reads this.world). */
const loss = async (world) => {
  const { Game } = await import('../../src/game.js');
  return Game.prototype._lossCondition.call({ world }, {});
};

test('downed: a lethal downable hit leaves him DOWNED (alive, hp 0, unit:downed); drowning / run over kill', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'driver', x: 12, z: 10 }], enemies: [guard('e', 20, 10)] }, { brains: false });
  const sn = s.cmd('sniper'), dr = s.cmd('driver');
  const ev = [];
  s.world.events.on('unit:downed', (p) => ev.push(p));
  sn.takeDamage(sn.hp, s.get('e'), 'shot');
  assert.equal(sn.alive, true);
  assert.equal(sn.hp, 0);
  assert.equal(sn.state, 'downed');
  assert.equal(sn.stance, 'downed');
  assert.ok(sn.isLow, 'a low target');
  assert.equal(ev.length, 1);
  near(sn.downed.t, P.bleedOut, 1e-9);
  for (const cause of ['drown', 'runover', 'train', 'fall']) {
    const t = makeSim({ commandos: [{ role: 'driver', x: 10, z: 10 }] }, { brains: false });
    const c = t.cmd('driver');
    c.takeDamage(c.hp, null, cause);
    assert.equal(c.alive, false, cause);
  }
  dr.takeDamage(dr.hp + P.overkillMax + 1, s.get('e'), 'shot');
  assert.equal(dr.alive, false, 'overkill above the cap kills');
});

test('downed: under the 1998 rules 0 HP is dead', () => {
  const s = makeSim({ houseRules: { buddyRescue: false }, commandos: [{ role: 'sniper', x: 10, z: 10 }] }, { brains: false });
  const c = s.cmd('sniper');
  c.takeDamage(c.hp, null, 'shot');
  assert.equal(c.alive, false);
  assert.equal(c.downed, null);
});

test('downed: any further hit kills; the 60 s bleed-out kills; the mission fails (died)', async () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'spy', x: 14, z: 10 }] }, { brains: false });
  const c = s.cmd('sniper');
  c.takeDamage(c.hp, null, 'shot');
  c.takeDamage(1, null, 'shot');
  assert.equal(c.alive, false, 'finishing hit');
  assert.equal((await loss(s.world))?.code, 'died');
  const t = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'spy', x: 14, z: 10 }] }, { brains: false });
  const d = t.cmd('sniper');
  d.takeDamage(d.hp, null, 'shot');
  t.run(P.bleedOut - 0.5);
  assert.equal(d.alive, true, 'still bleeding');
  assert.equal(await loss(t.world), null, 'no loss while he is only down');
  t.run(1);
  assert.equal(d.alive, false, 'bled out');
  assert.equal((await loss(t.world))?.code, 'died');
});

test('downed: abilities refused ("He\'s down."), he crawls at 0.3 m/s', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e', 12, 10)] }, { brains: false });
  const c = s.cmd('greenberet');
  c.takeDamage(c.hp, null, 'shot');
  assert.equal(c.issue({ type: 'ability', id: 'knife', target: s.get('e') }), false);
  assert.equal(c.lastRefusal.text, "He's down.");
  assert.equal(c.issue({ type: 'stance', stance: 'stand' }), false);
  assert.ok(c.issue({ type: 'move', x: 10, z: 30 }));
  near(c.speed, P.crawlSpeed, 1e-9);
  const z0 = c.z;
  s.run(5);
  near(c.z - z0, 1.5, 0.05);
  assert.equal(c.state, 'downed');
});

test('revive: K on a downed man takes 4.0 s, spends 1 dose, 34 HP, he stands', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10, inventory: { firstAid: 6 } }, { role: 'spy', x: 11, z: 10 }], firstAid: false }, { brains: false });
  const sn = s.cmd('sniper'), spy = s.cmd('spy');
  spy.takeDamage(spy.hp, null, 'shot');
  const doses = sn.inventory.get('firstAid');
  assert.ok(doses > 0, 'the sniper is the medic here');
  const rev = [];
  s.world.events.on('unit:revived', (p) => rev.push(p));
  assert.ok(sn.issue({ type: 'ability', id: 'firstAid', target: spy }), sn.lastRefusal?.text);
  s.run(3.9);
  assert.ok(spy.downed, 'not before 4.0 s');
  assert.equal(spy.reviving?.by, sn);
  s.run(0.2);
  assert.equal(spy.downed, null);
  assert.equal(spy.hp, P.reviveHp);
  assert.equal(spy.state, 'active');
  assert.equal(spy.stance, 'stand');
  assert.equal(sn.inventory.get('firstAid'), doses - 1);
  assert.equal(rev[0]?.by, sn);
});

test('revive: the bleed-out is held while the medic works: a revive begun with 2 s left succeeds', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10, inventory: { firstAid: 6 } }, { role: 'spy', x: 11, z: 10 }], firstAid: false }, { brains: false });
  const sn = s.cmd('sniper'), spy = s.cmd('spy');
  spy.takeDamage(spy.hp, null, 'shot');
  spy.downed.t = 2.0;
  assert.ok(sn.issue({ type: 'ability', id: 'firstAid', target: spy }));
  s.run(P.revive + 0.2);
  assert.equal(spy.alive, true);
  assert.equal(spy.downed, null, 'revived');
});

test('revive: a hit on the medic cancels it and the dose is kept; no doses → refused', () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10, inventory: { firstAid: 6 } }, { role: 'spy', x: 11, z: 10 }], firstAid: false }, { brains: false });
  const sn = s.cmd('sniper'), spy = s.cmd('spy');
  spy.takeDamage(spy.hp, null, 'shot');
  const doses = sn.inventory.get('firstAid');
  assert.ok(doses > 0);
  assert.ok(sn.issue({ type: 'ability', id: 'firstAid', target: spy }));
  s.run(2);
  sn.takeDamage(10, null, 'shot');
  s.run(3);
  assert.ok(spy.downed, 'revive cancelled');
  assert.equal(sn.inventory.get('firstAid'), doses);
  sn.inventory.delete('firstAid'); sn.refreshAbilities();
  assert.equal(sn.issue({ type: 'ability', id: 'firstAid', target: spy }), false);
});

test('mission flow: all men downed → NOBODY LEFT TO HELP; a downed man carried into the exit counts', async () => {
  const s = makeSim({ commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'greenberet', x: 12, z: 10 }] }, { brains: false });
  const [a, b] = [s.cmd('sniper'), s.cmd('greenberet')];
  a.takeDamage(a.hp, null, 'shot');
  assert.equal(nobodyLeftToHelp(s.world), false);
  b.takeDamage(b.hp, null, 'shot');
  assert.equal(nobodyLeftToHelp(s.world), true);
  assert.match((await loss(s.world)).reason, /NOBODY LEFT TO HELP/);
  const t = makeSim({ extraction: { x: 30, z: 10, r: 3 }, objectives: [{ id: 'esc', type: 'escape', text: 'escape' }],
    commandos: [{ role: 'sniper', x: 10, z: 10 }, { role: 'greenberet', x: 11, z: 10 }] }, { brains: false });
  const [c, gb] = [t.cmd('sniper'), t.cmd('greenberet')];
  c.takeDamage(c.hp, null, 'shot');
  assert.ok(gb.issue({ type: 'ability', id: 'hand', target: c }), gb.lastRefusal?.text);
  t.run(2, () => gb.carrying === c);
  assert.equal(gb.carryMode, 'shoulder');
  assert.equal(c.state, 'carried');
  gb.issue({ type: 'move', x: 30, z: 10 });
  t.run(20);
  const { extractionStatus } = await import('../../src/core/objectives.js');
  const st = extractionStatus(t.world);
  assert.equal(st.escaped, 2, 'the carrier and the downed man he carries');
  assert.ok(c.downed, 'still bleeding');
});

test('mission flow: a downed buddy is loaded into a vehicle (1.5 s); the transporter stays out', () => {
  const s = makeSim({ commandos: [{ role: 'driver', x: 10, z: 10 }, { role: 'sniper', x: 11, z: 10 }], vehicles: [{ id: 'car', vehicleType: 'willys', x: 16, z: 10 }] }, { brains: false });
  const dr = s.cmd('driver'), sn = s.cmd('sniper');
  sn.takeDamage(sn.hp, null, 'shot');
  dr.issue({ type: 'ability', id: 'hand', target: sn });
  s.run(2, () => dr.carrying === sn);
  assert.equal(dr.carryMode, 'drag');
  assert.ok(dr.issue({ type: 'ability', id: 'enterVehicle', target: s.get('car') }), dr.lastRefusal?.text);
  s.run(12, () => sn.state === 'inVehicle');
  assert.equal(sn.state, 'inVehicle');
  assert.equal(dr.state, 'active');
  assert.equal(dr.carrying, null);
  assert.notEqual(s.get('car').driver, sn, 'a downed man never drives');
});

test('guests go DOWNED too; a cannotWalk guest can only be transported', () => {
  const s = makeSim({ commandos: [{ role: 'guest', id: 'mcrae', x: 10, z: 10 }, { role: 'guest', id: 'pris', x: 20, z: 10, cannotWalk: true }, { role: 'spy', x: 21, z: 10 }] }, { brains: false });
  const g = s.get('mcrae'), p = s.get('pris'), spy = s.cmd('spy');
  g.takeDamage(g.hp, null, 'shot');
  assert.equal(g.state, 'downed');
  assert.equal(p.issue({ type: 'move', x: 25, z: 10 }), false);
  assert.ok(spy.issue({ type: 'ability', id: 'hand', target: p }), spy.lastRefusal?.text);
  s.run(2, () => spy.carrying === p);
  assert.equal(spy.carrying, p);
});
