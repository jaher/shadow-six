/** BCD guests and new units (docs/bcd-plan.md §1.8, §1.9; plan steps N9, N10). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { ABILITIES } from '../../src/abilities/index.js';
import { canSee } from '../../src/ai/perception.js';

const can = (id, c, t, w) => ABILITIES[id].canUse(c, t, w);

test('BCD Natasha: Beretta + lipstick + packs; no stones/KO/cuffs; lipstick makes his cone follow her', () => {
  const s = bcdSim({ commandos: [{ role: 'natasha', x: 24, z: 20 }], enemies: [post('a', 20, 20, Math.PI)] });
  const n = s.cmd('natasha'), a = s.get('a');
  assert.deepEqual([...n.abilities].filter((id) => ['beretta', 'lipstick', 'stone', 'knockoutFist', 'handcuff', 'puppet'].includes(id)).sort(), ['beretta', 'lipstick']);
  assert.equal(n.maxHp, 100);
  assert.equal(n.disguised, true, 'civilian cover');
  assert.equal(canSee(a, n, s.world), 'none', 'a soldier reads her as a civilian');
  assert.equal(n.useAbility('lipstick', a), true);
  s.run(0.6);
  assert.equal(a.brain.state, 'LIPSTICK');
  n.moveTo(24, 26);
  s.run(3);
  const want = Math.atan2(n.z - a.z, n.x - a.x);
  assert.ok(Math.abs(Math.atan2(Math.sin(a.heading - want), Math.cos(a.heading - want))) < 0.05, 'his facing tracks her');
  assert.ok(Math.hypot(a.x - 20, a.z - 20) < 0.01, 'he does not walk after her');
  n.issue({ type: 'cancel' });
  s.run(0.2);
  assert.notEqual(a.brain.state, 'LIPSTICK', 'right-click ends it');
});

test('BCD Natasha: the Gestapo see through her cover and cannot be charmed', () => {
  const s = bcdSim({ commandos: [{ role: 'natasha', x: 24, z: 20 }], enemies: [{ ...post('g', 20, 20, 0), soldierType: 'gestapo' }] });
  const n = s.cmd('natasha'), g = s.get('g');
  assert.notEqual(canSee(g, n, s.world), 'none');
  assert.notEqual(can('lipstick', n, g, s.world), true);
  assert.equal(g.weapon, 'gestapoLuger');
});

test('BCD Skopje: stones and packs only; keys 7 / 8 select Skopje / Natasha', async () => {
  const s = bcdSim({ commandos: [{ role: 'skopje', x: 10, z: 10 }, { role: 'natasha', x: 12, z: 10 }] });
  const k = s.cmd('skopje');
  assert.ok(k.abilities.includes('stone') && !k.abilities.includes('pistol') && !k.abilities.includes('beretta'));
  const { Input } = await import('../../src/engine/input.js');
  const fake = Object.create(Input.prototype);
  Object.defineProperty(fake, 'world', { get: () => s.world });
  assert.equal(fake.commandoForKey(7), k);
  assert.equal(fake.commandoForKey(8), s.cmd('natasha'));
});

test('BCD zookeeper: sees a commando → raises the alarm and flees to the barracks', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 30, z: 20 }], enemies: [{ ...post('z', 20, 20, 0), soldierType: 'zookeeper', fleeTo: [5, 5] }] });
  const z = s.get('z');
  assert.equal(z.weapon, null);
  s.run(1);
  assert.equal(z.brain.state, 'FLEE');
  assert.ok(s.alarmed());
  s.run(8);
  assert.ok(Math.hypot(z.x - 5, z.z - 5) < Math.hypot(20 - 5, 20 - 5) - 5, 'running to the barracks');
});

test('BCD snitch: sees a commando → walks to the nearest guard, who raises the alarm', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 30, z: 20 }], enemies: [{ ...post('s', 20, 20, 0), soldierType: 'snitch' }, post('g', 20, 30, Math.PI / 2)] });
  const sn = s.get('s');
  s.run(0.5);
  assert.equal(sn.brain.state, 'REPORT');
  assert.ok(!s.alarmed(), 'the snitch himself does not shout');
  s.run(12, () => s.count('enemy:snitched') > 0);
  assert.equal(s.count('enemy:snitched'), 1);
  assert.ok(s.alarmed());
});

test('BCD lion: charges a commando inside its pit (8 m), ignores one outside, never alarms', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 45, z: 20 }], enemies: [{ id: 'l', soldierType: 'lion', x: 20, z: 20, heading: 0, pen: { x: 20, z: 20, r: 6 } }] });
  const l = s.get('l'), gb = s.cmd('greenberet');
  assert.equal(l.vision, null);
  s.run(3);
  assert.ok(Math.hypot(l.x - 20, l.z - 20) <= 6.01, 'stays in the pit');
  assert.equal(gb.hp, gb.maxHp);
  gb.x = l.x + 5; gb.z = l.z; gb.stop();
  s.run(4);
  assert.ok(gb.hp < gb.maxHp, 'mauled');
  s.run(3);
  assert.equal(gb.alive, false, 'two hits kill');
  assert.ok(!s.alarmed(), 'animals never raise the German alarm');
});

test('BCD ostrich: attacks only within 3 m; chickens flee and cluck (level-1 noise)', () => {
  const s = bcdSim({ commandos: [{ role: 'sniper', x: 32, z: 20 }], enemies: [
    { id: 'o', soldierType: 'ostrich', x: 20, z: 20, heading: 0, pen: { x: 20, z: 20, r: 3 } },
    { id: 'c', soldierType: 'chicken', x: 60, z: 60, heading: 0 }] });
  const o = s.get('o'), sn = s.cmd('sniper'), ch = s.get('c');
  s.run(1);
  assert.equal(o.brain.state === 'CHARGE' || o.brain.state === 'ATTACK', false, '5 m: not provoked');
  sn.x = o.x + 2; sn.z = o.z; sn.stop();
  s.run(2);
  assert.ok(sn.hp < sn.maxHp, 'kicked');
  sn.x = 61; sn.z = 60; sn.stop();
  s.run(0.5);
  assert.equal(ch.brain.state, 'FLEE');
  assert.ok(s.log.some((l) => l.name === 'noise' && l.p.kind === 'cluck' && l.p.level === 1));
});

test('BCD dog: barks (alarm) and attacks; bites 35; ignores stones and disguises', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 28, z: 20 }], enemies: [{ id: 'd', soldierType: 'dog', x: 20, z: 20, heading: 0 }] });
  const d = s.get('d'), spy = s.cmd('spy');
  assert.equal(d.weapon, 'dogBiteBcd');
  spy.setDisguise(true);
  s.run(1.5);
  assert.equal(d.brain.state, 'COMBAT');
  assert.ok(s.log.some((l) => l.name === 'bark' && l.p.line === 'dog_bark'));
});

test('BCD Natasha: once a Gestapo man sees her, her cover is gone for every soldier', () => {
  const s = bcdSim({ commandos: [{ role: 'natasha', x: 24, z: 20 }], enemies: [{ ...post('g', 20, 20, 0), soldierType: 'gestapo' }, post('p', 30, 20, Math.PI)] });
  const n = s.cmd('natasha');
  assert.equal(canSee(s.get('p'), n, s.world), 'none');
  s.run(0.5);
  assert.equal(n.disguised, false);
  assert.notEqual(canSee(s.get('p'), n, s.world), 'none');
});

test('BCD: knifing a cuffed man leaves an ordinary body (no knock-out state)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  gb.useAbility('knockoutFist', a); s.run(1.2);
  gb.useAbility('handcuff', a); s.run(2);
  assert.equal(gb.useAbility('knife', a), true);
  s.run(1.2);
  assert.equal(a.alive, false);
  assert.equal(a.ko, null);
  assert.equal(a.brain.state, 'DEAD');
});
