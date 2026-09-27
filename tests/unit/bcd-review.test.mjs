/** BCD review fixes (regressions for the post-merge review findings). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { CONFIG } from '../../src/config.js';
import { knockOut } from '../../src/ai/bcd-enemy.js';

test('BCD review: several observers of a stunned man → one ko-found, one alarm shout, a completed revive (no livelock)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 70, z: 70 }], enemies: [
    post('a', 20, 20, Math.PI), post('b', 30, 20, Math.PI), post('c', 10, 20, 0), post('d', 31, 22, Math.PI),
    post('a2', 20, 34, Math.PI), post('b2', 30, 34, Math.PI), post('c2', 10, 34, 0)] });
  const a = s.get('a'), a2 = s.get('a2');
  knockOut(a, null, s.world);
  s.step();
  knockOut(a2, null, s.world);
  s.run(CONFIG.bcd.reviveTime + 20, () => a.ko === null && a2.ko === null);
  assert.equal(a.ko, null, 'revived');
  assert.equal(a2.ko, null, 'revived');
  assert.equal(s.count('enemy:ko-found'), 2, 'one finder reports each man');
  assert.equal(s.count('enemy:revived'), 2);
  assert.ok(s.count('bark', (p) => p.line === 'ger_alarm') <= 2, 'one alarm shout per body');
});

test('BCD review: an officer who sees through a private\'s uniform raises the alarm; an officer\'s uniform fools him', () => {
  for (const [uni, alarm] of [['soldier', true], ['officer', false]]) {
    const s = bcdSim({ commandos: [{ role: 'spy', x: 26, z: 20 }], enemies: [post('o', 20, 20, 0, { soldierType: 'officer' })] });
    const spy = s.cmd('spy');
    spy.setDisguise(true); spy.uniformType = uni;
    s.run(3);
    assert.equal(s.alarmed(), alarm, `${uni} uniform → alarm ${alarm}`);
  }
});

test('BCD review: dogs see through uniforms but not Natasha\'s civilian cover', async () => {
  const { recognises } = await import('../../src/ai/bcd-ranks.js');
  const s = bcdSim({ commandos: [{ role: 'natasha', x: 26, z: 20 }, { role: 'spy', x: 30, z: 30 }], enemies: [{ id: 'd', soldierType: 'dog', x: 20, z: 20, heading: 0 }] });
  const dog = s.get('d'), nat = s.cmd('natasha'), spy = s.cmd('spy');
  spy.setDisguise(true); spy.uniformType = 'officer';
  assert.equal(nat.uniformType, 'civilian');
  assert.equal(recognises(dog, nat, s.world), false);
  assert.equal(recognises(dog, spy, s.world), true);
});

test('BCD review: clotheslines and uniform pickups add typed wardrobe entries; unmask clears the worn rank', async () => {
  const { unmaskSpy } = await import('../../src/abilities/system.js');
  const s = bcdSim({ commandos: [{ role: 'spy', x: 20, z: 20 }], interactables: [
    { kind: 'clothesline', id: 'cl', x: 21, z: 20 },
    { kind: 'pickup', id: 'uo', itemId: 'uniform', uniform: 'officer', x: 20, z: 21 }] });
  const spy = s.cmd('spy'), w = s.world;
  spy.wardrobe = ['sergeant']; spy.gainItem('uniform', 1); // from the hanger
  const cl = w.interactables.find((i) => i.tag === 'cl'), uo = w.interactables.find((i) => i.tag === 'uo');
  assert.equal(cl.canUse(spy), true, 'clothesline usable with a non-empty wardrobe');
  assert.equal(cl.interact(spy), true);
  assert.deepEqual([...spy.wardrobe], ['sergeant', 'soldier']);
  assert.equal(uo.interact(spy), true);
  assert.deepEqual([...spy.wardrobe], ['sergeant', 'soldier', 'officer'], 'M5 UNIFORME: officer');
  spy.uniformType = 'officer'; spy.setDisguise(true);
  unmaskSpy(w, spy, null, 'test');
  assert.equal(spy.uniformType, null, 'no stale officer rank after an unmask');
});

test('BCD review: a lone sergeant can be knocked out; a squad leader sergeant and troopers cannot', async () => {
  const { koImmune } = await import('../../src/ai/bcd-enemy.js');
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 70, z: 70 }], enemies: [
    { id: 'sg', soldierType: 'sergeant', x: 20, z: 20, heading: 0 },
    { id: 'lead', soldierType: 'sergeant', x: 30, z: 30, heading: 0, squad: { id: 'q', leader: true } },
    { id: 'tr', soldierType: 'trooper', x: 40, z: 40, heading: 0 }] });
  assert.equal(koImmune(s.get('sg')), null);
  assert.notEqual(koImmune(s.get('lead')), null);
  assert.notEqual(koImmune(s.get('tr')), null);
});

test('BCD review: a man who wakes runs to his alarm point before the alarm (he can be intercepted)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 70, z: 70 }], enemies: [post('a', 20, 20, Math.PI, { alarmPoint: [40, 20] })] });
  const a = s.get('a');
  knockOut(a, null, s.world);
  s.run(CONFIG.bcd.koDuration + 0.5);
  assert.equal(a.ko, null, 'woke');
  assert.equal(a.brain.state, 'ALARM_RUN');
  assert.ok(!s.alarmed(), 'no alarm on the spot');
  s.run(20, () => s.alarmed());
  assert.ok(s.alarmed(), 'alarm at the alarm point');
  assert.ok(Math.hypot(a.x - 40, a.z - 20) < 2, `at the alarm point (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
});

test('BCD review: a freed man is unarmed until he picks his weapon up where he fell', async () => {
  const { rouse, cuff } = await import('../../src/ai/bcd-enemy.js');
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 70, z: 70 }], enemies: [post('a', 20, 20, Math.PI)] });
  const a = s.get('a'), w0 = a.weapon;
  knockOut(a, null, s.world); cuff(a, null, s.world);
  rouse(a, s.world, 'freed');
  assert.equal(a.weapon, null, 'unarmed on the spot');
  s.step();
  assert.equal(a.weapon, null);
  s.run(CONFIG.bcd.rearmTime + 0.1);
  assert.equal(a.weapon, w0, 'rearmed after the pickup');
});

test('BCD review: selecting another man releases the puppet', async () => {
  const { takePuppet, cuff } = await import('../../src/ai/bcd-enemy.js');
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }, { role: 'driver', x: 30, z: 30 }], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), dr = s.cmd('driver'), a = s.get('a'), w = s.world;
  knockOut(a, gb, w); cuff(a, gb, w);
  gb.selected = true;
  assert.equal(takePuppet(a, gb, w), true);
  s.step();
  gb.selected = false; dr.selected = true;
  w.events.emit('unit:selected', { units: [dr] });
  assert.equal(gb.puppet, null);
  assert.equal(a.puppetOf, null);
  assert.equal(a.ko, 'bound', 'sits down cuffed');
  assert.equal(gb.releaseBcdPuppet(), false);
});

test('BCD review: the puppet walks up to a soldier before talking (D), and not beyond the puppet range', async () => {
  const { takePuppet, cuff } = await import('../../src/ai/bcd-enemy.js');
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI), post('t', 28, 20, 0), post('far', 20, 60, 0)] });
  const gb = s.cmd('greenberet'), a = s.get('a'), t = s.get('t'), w = s.world;
  knockOut(a, gb, w); cuff(a, gb, w);
  assert.equal(takePuppet(a, gb, w), true);
  assert.ok(gb.abilities.includes('puppetDistract'), 'D talk available while a puppet is active');
  assert.equal(gb.useAbility('puppetDistract', s.get('far')), true); // issued; refused by range inside
  s.run(0.5);
  assert.notEqual(s.get('far').brain.state, 'DISTRACTED', 'no talk at 40 m');
  assert.equal(gb.useAbility('puppetDistract', t), true);
  s.run(0.3);
  assert.notEqual(t.brain.state, 'DISTRACTED', 'not frozen at 8 m');
  s.run(8, () => t.brain.state === 'DISTRACTED');
  assert.equal(t.brain.state, 'DISTRACTED');
  assert.ok(Math.hypot(a.x - t.x, a.z - t.z) <= CONFIG.abilities.distractRange + 0.6, 'the puppet walked over');
  assert.ok(Math.hypot(gb.x - 20, gb.z - 21) < 0.01, 'the controller stays put');
});

test('BCD review: knapsack shows the cigarette count and ∞ for the Lee-Enfield; stones stay count-less', async () => {
  const { COUNT_DISPLAY } = await import('../../src/ui/knapsack-model.js');
  assert.equal(COUNT_DISPLAY.cigarettes, 'number');
  assert.equal(COUNT_DISPLAY.leeEnfield, 'infinite');
  assert.equal(COUNT_DISPLAY.stones, undefined);
});

test('BCD review: ruleset data guards (BEL mission warnings, BEL set untouched, no animal brain under BEL)', async () => {
  const { validateMission } = await import('../../src/missions/schema.js');
  const { ACTIVATABLE } = await import('../../src/entities/interactables.js');
  await import('../../src/entities/bcd-interactables.js');
  const v = validateMission({ id: 'x', size: [50, 50], campaign: 'BEL', commandos: [{ role: 'natasha', x: 1, z: 1 }],
    enemies: [{ soldierType: 'gestapo', x: 2, z: 2 }, { soldierType: 'lion', x: 3, z: 3 }], interactables: [{ kind: 'seaMine', x: 4, z: 4 }] });
  assert.equal(v.warnings.filter((m) => /only in campaign BCD/.test(m)).length, 4, v.warnings.join('\n'));
  assert.ok(!ACTIVATABLE.has('pushable') && !ACTIVATABLE.has('lift'), 'BEL ACTIVATABLE untouched');
  const bel = bcdSim({ campaign: 'BEL', enemies: [{ id: 'l', soldierType: 'lion', x: 10, z: 10, heading: 0 }] });
  assert.equal(bel.get('l').brain.constructor.name, 'EnemyBrain');
  const bcd = bcdSim({ enemies: [{ id: 'l', soldierType: 'lion', x: 10, z: 10, heading: 0 }] });
  assert.equal(bcd.get('l').brain.constructor.name, 'AnimalBrain');
});
