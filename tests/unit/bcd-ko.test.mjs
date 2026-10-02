/** BCD knock-outs and handcuffs (docs/bcd-plan.md §1.1, §1.2; plan steps N3, N4). */
import { test, assert } from './lib.mjs';
import { bcdSim, post } from './bcd-sim.mjs';
import { CONFIG } from '../../src/config.js';
import { ABILITIES } from '../../src/abilities/index.js';

const G = { role: 'greenberet', x: 20, z: 21 };

test('BCD KO: fist on an unaware back → stunned; wakes after 30 s and raises the alarm', () => {
  const s = bcdSim({ commandos: [G], enemies: [post('a', 20, 20, Math.PI)] }); // faces -x, GB behind him (+z side)
  const gb = s.cmd('greenberet'), e = s.get('a');
  assert.ok(gb.abilities.includes('knockoutFist'), gb.abilities.join());
  assert.ok(gb.abilities.includes('knife'), 'the knife stays (W under BCD)');
  assert.equal(gb.useAbility('knockoutFist', e), true);
  s.run(1.5);
  assert.equal(e.ko, 'stunned');
  assert.equal(e.brain.state, 'STUNNED');
  assert.equal(e.alive, true);
  assert.equal(e.weapon, null, 'weapon dropped');
  assert.ok(!s.alarmed(), 'silent KO, unseen');
  s.run(CONFIG.bcd.koDuration - 3);
  assert.equal(e.ko, 'stunned', 'still out before 30 s');
  s.run(3);
  assert.equal(e.ko, null, 'woke');
  assert.equal(e.weapon, null, 'unarmed until he picks his weapon up (review fix, §1.2)');
  s.run(CONFIG.bcd.rearmTime + 0.1);
  assert.ok(e.weapon, 'rearmed');
  assert.ok(s.count('enemy:woke') === 1);
  assert.ok(s.alarmed(), 'woke → alarm');
});

test('BCD KO: re-knocking a stunned man resets the timer', () => {
  const s = bcdSim({ commandos: [G], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), e = s.get('a');
  gb.useAbility('knockoutFist', e);
  s.run(20);
  assert.equal(e.ko, 'stunned');
  gb.useAbility('knockoutFist', e);
  s.run(1);
  assert.ok(e.koT > CONFIG.bcd.koDuration - 1.5, `timer reset (${e.koT})`);
});

test('BCD KO: an aware target (sees the attacker) takes the swing and nothing happens', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 21, z: 20 }], enemies: [post('a', 20, 20, 0)] }); // faces the GB
  const gb = s.cmd('greenberet'), e = s.get('a');
  gb.useAbility('knockoutFist', e);
  s.run(1);
  assert.equal(e.ko, null);
  assert.ok(s.count('enemy:ko-missed') >= 1 || e.brain.isAware());
});

test('BCD KO: patrol members, dogs and animals are immune (canUse refuses)', () => {
  const s = bcdSim({ commandos: [G], enemies: [
    { id: 'p', soldierType: 'trooper', x: 30, z: 30, heading: 0 },
    { id: 'd', soldierType: 'dog', x: 40, z: 40, heading: 0 },
    { id: 'l', soldierType: 'lion', x: 60, z: 60, heading: 0 },
    { id: 'g', soldierType: 'gestapo', x: 50, z: 20, heading: 0 },
  ] });
  const gb = s.cmd('greenberet');
  for (const id of ['p', 'd', 'l']) assert.notEqual(abilityCanUse('knockoutFist', gb, s.get(id), s.world), true, id);
  assert.equal(abilityCanUse('knockoutFist', gb, s.get('g'), s.world), true, 'Gestapo can be knocked out when unaware');
});

function abilityCanUse(id, c, t, w) { return ABILITIES[id].canUse(c, t, w); }

test('BCD cuffs: only on a stunned man; cancels the wake timer; the pack moves to the cuffer', () => {
  const s = bcdSim({ commandos: [G], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), e = s.get('a');
  assert.notEqual(abilityCanUse('handcuff', gb, e, s.world), true, 'not on an awake man');
  gb.useAbility('knockoutFist', e);
  s.run(1.2);
  assert.equal(e.cigs, 1);
  assert.equal(gb.useAbility('handcuff', e), true);
  s.run(2);
  assert.equal(e.ko, 'bound');
  assert.equal(e.brain.state, 'BOUND');
  assert.equal(e.cigs, 0);
  assert.equal(gb.inventory.get('cigarettes'), 1, 'pack moved automatically');
  s.run(40);
  assert.equal(e.ko, 'bound', 'no wake-up when cuffed');
  assert.ok(!s.alarmed());
});

test('BCD cuffs: a comrade who sees a bound man frees him (4 s) and both raise the alarm', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 20, z: 21 }], enemies: [post('a', 20, 20, Math.PI),
    { id: 'b', soldierType: 'soldier', x: 40, z: 20, heading: Math.PI, route: { type: 'PINGPONG', points: [{ x: 40, z: 20 }, { x: 39, z: 20 }] } }] });
  const gb = s.cmd('greenberet'), a = s.get('a'), b = s.get('b');
  b.brain._set('IDLE');
  // hold b away (he faces away) while the GB works
  b.heading = 0; b.sweepActive = false;
  gb.useAbility('knockoutFist', a);
  s.run(1.2);
  gb.useAbility('handcuff', a);
  s.run(2);
  assert.equal(a.ko, 'bound');
  gb.setPosition?.(70, 70); gb.x = 70; gb.z = 70; // leave
  b.route = null; b.post = { x: 40, z: 20, heading: Math.PI, sweep: 0 }; b.heading = Math.PI; b.brain._routeType = 'STOPPED';
  const found = s.run(3, () => b.brain.state === 'REVIVE');
  assert.ok(found, `comrade noticed (state ${b.brain.state})`);
  s.run(15, () => a.ko === null);
  assert.equal(a.ko, null, 'freed');
  assert.ok(s.count('enemy:freed') === 1);
  assert.ok(s.alarmed(), 'both raise the alarm');
});

test('BCD KO: a comrade who sees a stunned man raises the alarm and revives him', () => {
  const s = bcdSim({ commandos: [G], enemies: [post('a', 20, 20, Math.PI), post('b', 30, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), a = s.get('a'), b = s.get('b');
  b.heading = 0;
  b.post.heading = 0;
  gb.useAbility('knockoutFist', a);
  s.run(1.2);
  assert.equal(a.ko, 'stunned');
  gb.x = 70; gb.z = 70;
  gb.stop();
  b.post.heading = Math.PI; b.heading = Math.PI;
  s.run(2, () => b.brain.state === 'REVIVE');
  assert.equal(b.brain.state, 'REVIVE');
  assert.ok(s.alarmed(), 'stunned man found = body (alarm)');
  s.run(10, () => a.ko === null);
  assert.equal(a.ko, null, 'revived');
});

test('BCD KO: save/load round-trips a stunned man mid-KO', () => {
  const s = bcdSim({ commandos: [G], enemies: [post('a', 20, 20, Math.PI)] });
  const gb = s.cmd('greenberet'), e = s.get('a');
  gb.useAbility('knockoutFist', e);
  s.run(5);
  const d = JSON.parse(JSON.stringify(e.serialize()));
  assert.equal(d.bcd.ko, 'stunned');
  const t0 = d.bcd.koT;
  e.ko = null; e.koT = 0; e.brain.state = 'IDLE';
  e.deserialize(d);
  assert.equal(e.ko, 'stunned');
  assert.equal(e.koT, t0);
  assert.equal(e.brain.state, 'STUNNED');
});

test('BCD KO from a crawl: like the knife, he crawls in and stands up only when close (user request 2026-10-01)', () => {
  const s = bcdSim({ commandos: [{ role: 'greenberet', x: 27, z: 20 }], enemies: [post('a', 20, 20, Math.PI)] }); // GB 7 m behind him
  const gb = s.cmd('greenberet'), e = s.get('a');
  gb.setStance('crawl');
  s.run(0.6);
  assert.equal(gb.useAbility('knockoutFist', e), true);
  assert.equal(gb.stance, 'crawl', 'no stand-up at the click');
  const standAt = CONFIG.bcd.koReach + CONFIG.abilities.crawlStandLead;
  let stoodAt = null;
  s.run(10, () => {
    if (gb.stance === 'crawl') return false;
    stoodAt = Math.hypot(e.x - gb.x, e.z - gb.z);
    return true;
  });
  assert.ok(stoodAt !== null && stoodAt <= standAt + 1e-6 && stoodAt > CONFIG.bcd.koReach, `stood up close (${stoodAt})`);
  s.run(3, () => e.ko === 'stunned');
  assert.equal(e.ko, 'stunned', 'knocked out from behind');
  assert.ok(!s.alarmed());
});
