/** BCD Spy (hanger, wardrobe, rank table), Driver (Lee-Enfield, SMG on W), puppet (plan steps N6–N8). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { CONFIG } from '../../src/config.js';
import { ABILITIES } from '../../src/abilities/index.js';
import { recognises, puppetCanDistract } from '../../src/ai/bcd-ranks.js';
import { canSee } from '../../src/ai/perception.js';
import { World } from '../../src/world/world.js';

const can = (id, c, t, w) => ABILITIES[id].canUse(c, t, w);

test('BCD rank table: who sees through which uniform (Gestapo always; BEL never)', () => {
  const w = new World({ size: [10, 10], mission: { campaign: 'BCD' } });
  const V = (soldierType, squad = null) => ({ soldierType, squad, world: w });
  const T = (uniformType) => ({ disguised: true, uniformType });
  const M = {
    soldier: { soldier: false, sergeant: true, officer: true, gestapo: true },
    zookeeper: { soldier: false, sergeant: false, officer: true, gestapo: true },
    sergeant: { soldier: false, sergeant: false, officer: true, gestapo: true },
    officer: { soldier: false, sergeant: false, officer: false, gestapo: true },
    civilian: { soldier: false, sergeant: false, officer: false, gestapo: true },
  };
  for (const [u, row] of Object.entries(M)) for (const [v, want] of Object.entries(row)) assert.equal(recognises(V(v), T(u), w), want, `${v} vs ${u}`);
  assert.equal(recognises(V('trooper', { id: 's', leader: 'x' }), T('soldier'), w), false, 'a trooper is a private');
  assert.equal(recognises({ soldierType: 'soldier', tag: 'x', squad: { id: 's', leader: 'x' }, world: w }, T('soldier'), w), true, 'a patrol leader is a sergeant');
  assert.equal(recognises(V('lieutenant'), T('sergeant'), w), true);
  const bel = new World({ size: [10, 10] });
  for (const v of ['gestapo', 'officer', 'sergeant']) assert.equal(recognises({ soldierType: v, world: bel }, T('soldier'), bel), false, `BEL ${v}`);
});

test('BCD disguise in perception: a sergeant spots the Spy in a private’s uniform, a soldier does not', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 30, z: 30 }], enemies: [post('s', 20, 30, 0), { ...post('g', 20, 34, 0), soldierType: 'sergeant' }] });
  const spy = s.cmd('spy');
  spy.uniformType = 'soldier'; spy.setDisguise(true);
  assert.equal(canSee(s.get('s'), spy, s.world), 'none');
  assert.notEqual(canSee(s.get('g'), spy, s.world), 'none');
  spy.uniformType = 'officer';
  assert.equal(canSee(s.get('g'), spy, s.world), 'none', 'officer uniform passes a sergeant');
});

test('BCD hanger + wardrobe: T takes a stunned man’s uniform; U cycles private → officer → plain → private', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI), { ...post('o', 60, 60, Math.PI), soldierType: 'officer' }] });
  const spy = s.cmd('spy'), a = s.get('a'), o = s.get('o');
  assert.ok(spy.abilities.includes('knockoutChloroform') && spy.abilities.includes('hanger'));
  assert.notEqual(can('hanger', spy, a, s.world), true, 'not on an awake man');
  spy.useAbility('knockoutChloroform', a);
  s.run(1.6);
  assert.equal(a.ko, 'stunned', 'chloroform 1.2 s');
  spy.useAbility('hanger', a);
  s.run(2.3);
  assert.deepEqual(spy.wardrobe, ['soldier']);
  assert.equal(a.uniformTaken, true);
  // officer: carried into reach
  spy.x = 60; spy.z = 61; o.heading = Math.PI; o.post.heading = Math.PI;
  spy.useAbility('knockoutChloroform', o); s.run(1.6);
  spy.useAbility('hanger', o); s.run(2.3);
  assert.deepEqual(spy.wardrobe, ['soldier', 'officer']);
  const seq = [];
  for (let k = 0; k < 4; k++) { assert.equal(spy.useAbility('uniform', spy), true, `U #${k + 1}`); s.run(CONFIG.bcd.uniformChange + 0.2); seq.push(spy.disguised ? spy.uniformType : 'plain'); }
  assert.deepEqual(seq, ['soldier', 'officer', 'plain', 'soldier']);
});

test('BCD distract (D): never on the Gestapo', () => {
  const s = bcdSim({ commandos: [{ role: 'spy', x: 21, z: 20 }], enemies: [{ ...post('g', 20, 20, 0), soldierType: 'gestapo' }, post('p', 30, 30, 0)] });
  const spy = s.cmd('spy');
  spy.setDisguise(true);
  assert.notEqual(can('distract', spy, s.get('g'), s.world), true);
  assert.equal(can('distract', spy, s.get('p'), s.world), true);
});

test('BCD Lee-Enfield (E): one-shot kill at 27 m, refused at 28 m, 2.5 s bolt, pistol-class noise', () => {
  const s = bcdSim({ commandos: [{ role: 'driver', x: 10, z: 30 }], enemies: [post('a', 37, 30, 0), post('b', 38, 34, 0), post('c', 30, 40, Math.PI / 2)] });
  const d = s.cmd('driver');
  assert.ok(d.abilities.includes('rifle'));
  assert.equal(d.inventory.get('leeEnfield'), 50, 'hidden count 50');
  const b = s.get('b');
  assert.notEqual(can('rifle', d, b, s.world), true, `${Math.hypot(b.x - d.x, b.z - d.z).toFixed(1)} m`);
  assert.equal(d.useAbility('rifle', s.get('a')), true);
  s.run(0.8);
  assert.equal(s.get('a').alive, false, 'one shot kills at 27 m');
  const n = s.log.find((l) => l.name === 'noise' && l.p.source === d);
  assert.ok(n && n.p.radius === 18 && n.p.kind === 'pistol');
  assert.equal(can('rifle', d, s.get('a'), s.world) === true, false);
  const c = s.get('c');
  assert.equal(can('rifle', d, c, s.world), 'Reloading.');
  s.run(2.5);
  assert.equal(can('rifle', d, c, s.world), true);
});

test('BCD puppet (R): take a cuffed man, walk him through a door; losing sight of him raises the alarm', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI)],
    interactables: [{ kind: 'door', id: 'door1', x: 26, z: 20 }] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  gb.useAbility('knockoutFist', a); s.run(1.2);
  gb.useAbility('handcuff', a); s.run(2);
  assert.equal(gb.useAbility('puppet', a), true);
  s.run(0.1);
  assert.equal(a.puppetOf, gb);
  assert.equal(a.brain.state, 'PUPPET');
  const door = s.world.interactables.find((i) => i.tag === 'door1');
  assert.equal(door.open, false);
  assert.equal(gb.useAbility('puppet', door), true);
  s.run(9);
  assert.equal(door.open, true, 'the puppet opened the door');
  assert.equal(gb.x, 20, 'the controller stays put');
  gb.issue({ type: 'move', x: 20, z: 36 }); // plain move orders go to the puppet (§1.3)
  s.run(1);
  assert.ok(a.isMoving && Math.hypot(gb.x - 20, gb.z - 21) < 0.01);
  s.run(25, () => !a.puppetOf);
  assert.equal(a.puppetOf, null, 'out of 13.5 m range → lost');
  assert.equal(a.ko, null);
  assert.ok(s.alarmed());
});

test('BCD puppet: release (R on him) sits him down still cuffed; rank decides who he can talk to', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [{ ...post('a', 20, 20, Math.PI), soldierType: 'sergeant' }] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  a.squad = null;
  gb.useAbility('knockoutFist', a); s.run(1.2);
  assert.equal(a.ko, 'stunned', 'a lone sergeant (no squad) is a sentry: he can be knocked out (review fix)');
  const priv = { soldierType: 'soldier' }, sgt = { soldierType: 'sergeant' }, off = { soldierType: 'officer' }, gst = { soldierType: 'gestapo' };
  const trooper = { soldierType: 'trooper', squad: { id: 'p' } };
  assert.equal(puppetCanDistract(priv, priv), true);
  assert.equal(puppetCanDistract(priv, sgt), false);
  assert.equal(puppetCanDistract(priv, trooper), false);
  assert.equal(puppetCanDistract(sgt, trooper), true);
  assert.equal(puppetCanDistract(sgt, off), false);
  assert.equal(puppetCanDistract(off, off), true);
  assert.equal(puppetCanDistract(off, gst), false);
});

function puppetSetup(extraEnemies = []) {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI), ...extraEnemies] });
  const gb = s.cmd('greenberet'), a = s.get('a');
  gb.useAbility('knockoutFist', a); s.run(1.2);
  gb.useAbility('handcuff', a); s.run(2);
  gb.useAbility('puppet', a); s.run(0.1);
  assert.equal(a.puppetOf, gb);
  return { s, gb, a };
}

test('BCD puppet loss rules: controller seen by another enemy / controller shot / controller inside a house', () => {
  { // seen: a guard 30 m away turns to face the controller
    const { s, gb, a } = puppetSetup([post('g', 40, 21, 0)]);
    const g = s.get('g');
    g.heading = Math.PI; g.post.heading = Math.PI;
    s.run(0.5);
    assert.equal(a.puppetOf, null, 'seen → lost');
    assert.ok(s.count('enemy:woke', (p) => p.why === 'puppet:seen') === 1);
    assert.equal(gb.puppet, null);
  }
  { // shot at
    const { s, a } = puppetSetup();
    s.cmd('greenberet').takeDamage(10, { faction: 'enemy', x: 0, z: 0 }, 'rifle');
    s.run(0.1);
    assert.equal(a.puppetOf, null);
    assert.ok(s.count('enemy:woke', (p) => p.why === 'puppet:shot') === 1);
  }
  { // inside a house
    const { s, gb, a } = puppetSetup();
    gb.hidden = true;
    s.run(0.1);
    assert.equal(a.puppetOf, null);
    assert.ok(s.alarmed());
  }
  { // released with R on him: sits down, still cuffed, no alarm
    const { s, gb, a } = puppetSetup();
    gb.useAbility('puppet', a);
    s.run(0.2);
    assert.equal(a.puppetOf, null);
    assert.equal(a.ko, 'bound');
    assert.equal(a.brain.state, 'BOUND');
    assert.ok(!s.alarmed());
  }
});
