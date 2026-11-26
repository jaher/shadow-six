/**
 * LIGHTS OUT e03 "Winter Quarters" (docs/expansion/e03.md): the registration and the counts, then the design's
 * acceptance list (§15) on the real mission, headless (tools/solutions/headless.mjs, the plain build):
 *   - the well: on the hall's alarm the chief carries the key-table binder to the camp well and the mission fails;
 *     nothing happens once a commando holds the binder, or with the chief down;
 *   - the kennel: the dogs stay kennelled until an alarm, then the handler lets them out (Easy: 20 s later); not with
 *     the handler cuffed;
 *   - Oberst Ansbach: killing him fails the mission; any alarm sends him and his escort indoors;
 *   - the rope ferry rides its cable only; the team aboard and the far bank make the escape once o1 and o2 are done;
 *   - the main mast's one charge: fired off its mark (the mast standing, nothing else can drop it) the mission fails
 *     0.5 s on, on Hard and Easy (negative controls: set and not fired, taken back, or fired on the mark — no fail);
 *   - the private's tunic passes the operators and hd1, not the chief, the sergeants or the Gestapo; the trainer's
 *     coat passes the sergeants;
 *   - the trainer flees to the barn and alarms when he sees a commando; the manager reports one to the nearest
 *     armed man, who raises the alarm (negative controls: unseen, nothing happens);
 *   - the puppet: the cuffed sergeant on strings talks to hd1; seen, the controller loses him;
 *   - the lions charge a man inside the ring's kerb and never leave it; the open pen gate lets the ostriches out;
 *   - a quick load plays on as the run it interrupted: the circus animals keep their wander timers (30 s on, the same
 *     world), and an alarm raised on the load's first tick still sends the chief to the well, opens the kennel and
 *     takes the Oberst indoors (negative controls: a save without the timers parts, a load whose set pieces wait for
 *     the director's first tick misses the alarm).
 * Run with the unit suite: node tests/unit/run.mjs e03
 */
import { test, assert } from '../unit/lib.mjs';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { getMission } from '../../src/missions/index.js';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { knockOut, cuff, takePuppet } from '../../src/ai/bcd-enemy.js';
import { recognises } from '../../src/ai/bcd-ranks.js';
import { canSee } from '../../src/ai/perception.js';
import { spawnInventory } from '../../src/items.js';
import { E03 } from '../../src/missions/expansion/e03-layout.js';
import { lineT } from '../../src/missions/setpieces-errands.js';
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';
import { NO_CHARGE_FAIL, mastChargesLeft, checkMastCharge } from '../../src/missions/scripts/e03.js';

const WELL_FAIL = 'THE KEY TABLES ARE AT THE BOTTOM OF THE WELL.';
const ANIMALS = new Set(['lion', 'ostrich', 'chicken']);

/** A fresh headless e03 (Hard unless `easy`), its set-pieces initialised. */
function sim(easy = false) {
  const s = headlessMission('e03', { patch: easy ? (d) => ({ ...d, difficulty: 'easy' }) : null });
  const w = s.world, log = [];
  for (const ev of ['alarm:zone', 'enemy:spotted', 'enemy:flee', 'enemy:snitched', 'bcd:errand', 'enemy:distracted']) w.events.on(ev, (p) => log.push({ ev, p, t: w.time }));
  const run = (sec, until = null) => { const n = Math.round(sec / s.dt); for (let k = 0; k < n; k++) { s.step(); if (until?.()) return true; } return false; };
  run(0.2);
  return { ...s, w, log, run, get: (t) => w.enemies.find((e) => e.tag === t), c: (r) => w.commandos.find((c) => c.role === r) };
}
/** Put a commando somewhere out of the way (the river bank, west), standing still. */
const park = (c, x, z) => { c.x = x; c.z = z; c.stop?.(); };
const near = (u, p, r) => Math.hypot(u.x - p[0], u.z - p[1]) <= r;

test('e03: LIGHTS OUT slot 3, valid on Easy and Hard; 28 / 33 men, 12 animals; Spy, GB, Marine, Sapper with the remote charge', () => {
  const d = getMission('e03');
  assert.equal(d.campaign, 'BCD'); assert.equal(d.number, 3); assert.equal(d.title, 'Winter Quarters');
  for (const difficulty of ['easy', 'hard']) {
    const m = normalizeMission(d, { quiet: true, difficulty });
    const v = validateMission(m);
    assert.deepEqual([v.errors ?? [], v.warnings ?? []].flat(), [], `${difficulty}: validateMission`);
    const men = m.enemies.filter((e) => !ANIMALS.has(e.soldierType));
    assert.equal(men.length, difficulty === 'easy' ? 28 : 33, `${difficulty}: men`);
    assert.equal(m.enemies.length - men.length, 12, `${difficulty}: 3 lions, 4 ostriches, 5 hens`);
  }
  assert.deepEqual(d.commandos.map((c) => c.role).sort(), ['diver', 'greenberet', 'sapper', 'spy']);
  const sap = spawnInventory('sapper', d.commandos.find((c) => c.role === 'sapper').inventory, 'BCD');
  assert.equal(sap.remoteBomb, 1); assert.equal(sap.detonator, 1); assert.ok(!sap.timeBomb, 'no time bomb (the kit never mixes them)');
  assert.equal(d.objectives.length, 3);
});

test('e03 well: on the hall\'s alarm the chief takes the binder from his table to the well and the mission fails', () => {
  const s = sim();
  const lt = s.get('lt'), binder = () => s.w.interactables.find((i) => i.interactKind === 'pickup' && i.tag === 'binder' && !i.removed);
  assert.ok(binder(), 'the binder lies on the chief\'s table');
  s.w.alarm.raise('z_hall', 'seen', 90, 40);
  assert.ok(s.run(150, () => !!s.w.scriptFail), 'the mission fails');
  assert.equal(s.w.scriptFail, WELL_FAIL);
  assert.ok(!binder(), 'the binder is gone from the table');
  assert.ok(near(lt, E03.WELL, 3.5), `the chief stands at the well (${lt.x.toFixed(1)},${lt.z.toFixed(1)})`);
  const ph = s.log.filter((l) => l.ev === 'bcd:errand' && l.p.kind === 'errand').map((l) => l.p.phase);
  assert.deepEqual(ph, ['start', 'taken', 'done']);
});

test('e03 well: nothing goes down the well once a commando holds the binder (o1), or with the chief knocked out', () => {
  { // the Spy (a private's tunic: the operators let him be) takes the binder while the chief reports at the villa
    const s = sim(), spy = s.c('spy'), lt = s.get('lt');
    const b = s.w.interactables.find((i) => i.tag === 'binder');
    assert.ok(s.run(200, () => lt.x > 100), 'the chief walks out to report');
    spy.disguised = true; spy.uniformType = 'soldier';
    park(spy, b.x - 0.6, b.z - 1.2);
    assert.ok(spy.issue({ type: 'ability', id: 'hand', target: b }), 'the Spy picks it up');
    assert.ok(s.run(6, () => s.w.objectives.find((o) => o.id === 'o1').done), 'o1 done');
    assert.ok((spy.inventory.get('documents') ?? 0) > 0, 'the Spy carries it');
    s.w.alarm.raise('z_hall', 'seen', 90, 40);
    s.run(120);
    assert.equal(s.w.scriptFail ?? null, null, 'no fail');
    assert.ok(!s.log.some((l) => l.ev === 'bcd:errand' && l.p.phase === 'taken'), 'nobody takes anything to the well');
  }
  { // the chief knocked out and cuffed before the alarm: the binder stays on the table
    const s = sim(), lt = s.get('lt'), gb = s.c('greenberet');
    knockOut(lt, gb, s.w); cuff(lt, gb, s.w);
    s.w.alarm.raise('z_hall', 'seen', 90, 40);
    s.run(120);
    assert.equal(s.w.scriptFail ?? null, null);
    assert.ok(s.w.interactables.some((i) => i.tag === 'binder' && !i.removed), 'still on the table');
  }
});

test('e03 kennel: the dogs stay in until an alarm, then the handler opens the gate (Easy 20 s later); not with him cuffed', () => {
  const inKennel = (d) => d.x > E03.KENNEL.x0 - 0.5 && d.x < E03.KENNEL.x1 + 0.5 && d.z > E03.KENNEL.z0 - 0.5 && d.z < E03.KENNEL.z1 + 0.5;
  { // Hard: at once
    const s = sim();
    s.run(30);
    assert.ok(['dog1', 'dog2'].every((id) => inKennel(s.get(id))), 'kennelled before any alarm');
    s.w.alarm.raise('z_camp', 'seen', 30, 70);
    assert.ok(s.run(30, () => s.log.some((l) => l.ev === 'bcd:errand' && l.p.kind === 'kennel')), 'released');
    s.run(20);
    assert.ok(['dog1', 'dog2'].every((id) => !inKennel(s.get(id))), 'the dogs are out');
  }
  { // Easy: 20 s after the alarm
    const s = sim(true);
    s.w.alarm.raise('z_gate', 'seen', 56, 20);
    const t0 = s.w.time;
    assert.ok(s.run(60, () => s.log.some((l) => l.ev === 'bcd:errand' && l.p.kind === 'kennel')), 'released');
    assert.ok(s.w.time - t0 >= 20, `not before 20 s (${(s.w.time - t0).toFixed(1)})`);
  }
  { // the handler cuffed: they stay in
    const s = sim(), kh = s.get('kh'), gb = s.c('greenberet');
    knockOut(kh, gb, s.w); cuff(kh, gb, s.w);
    s.w.alarm.raise('z_gate', 'seen', 56, 20);
    s.run(40);
    assert.ok(!s.log.some((l) => l.ev === 'bcd:errand' && l.p.kind === 'kennel'), 'no release');
    assert.ok(['dog1', 'dog2'].every((id) => inKennel(s.get(id))), 'still kennelled');
  }
});

test('e03 Ansbach: killing him fails the mission; an alarm sends him and his two Gestapo indoors', () => {
  { const s = sim(), a = s.get('ansbach');
    a.die('bullet', s.c('greenberet'));
    s.run(1);
    assert.equal(s.w.scriptFail, 'LONDON WANTS ANSBACH ALIVE, AND LATER. HIS INDEX IS ON ITS WAY TO BERLIN.'); }
  { const s = sim();
    s.w.alarm.raise('z_camp', 'seen', 30, 70);
    s.run(40);
    for (const id of ['ansbach', 'ge1', 'ge2']) {
      const e = s.get(id);
      assert.ok(e.x > E03.ANSBACH_IN[0] - 1.2 && Math.abs(e.z - E03.ANSBACH_IN[1]) < 4, `${id} indoors (${e.x.toFixed(1)},${e.z.toFixed(1)})`);
    }
    s.run(120);
    assert.ok(s.get('ansbach').x > E03.ANSBACH_IN[0] - 1.2, 'and he stays there'); }
});

test('e03 ferry: the punt keeps to its cable; the Marine hauls the team over and the escape counts once o1 and o2 are done', () => {
  const s = sim(), v = s.w.byId('ferry');
  for (const id of ['r1', 'r2', 'p1a', 'p1b', 'p1c', 't1']) { const e = s.get(id); if (e) s.w.remove(e); } // (the bank's guards: dealt with)
  const [A, B] = E03.CABLE.map(([x, z]) => ({ x, z }));
  assert.ok(v, 'the ferry');
  // everyone onto the landing stage's end, then aboard
  const boardAt = [[43.2, 99.6], [44.8, 99.6], [43.2, 98.6], [44.8, 98.6]];
  s.w.commandos.forEach((c, k) => park(c, ...boardAt[k]));
  for (const c of s.w.commandos) assert.ok(c.issue({ type: 'ability', id: 'enterVehicle', target: v }), `${c.role} boards`);
  assert.ok(s.run(20, () => s.w.commandos.every((c) => c.vehicle === v)), `all aboard (${s.w.commandos.map((c) => `${c.role}:${c.vehicle ? 'in' : c.state}`).join(' ')})`);
  assert.equal(v.driver?.role, 'diver', 'the Marine at the rope');
  // a click off the cable: the punt goes to the nearest point of it, never off it
  s.w.commandos.find((c) => c.role === 'diver').issue({ type: 'move', x: 60, z: 118 });
  let off = 0;
  s.run(30, () => { off = Math.max(off, Math.abs(v.x - A.x)); return false; });
  assert.ok(off < 0.05, `stays on the cable (max ${off.toFixed(3)} m off)`);
  assert.ok(lineT(A, B, v.x, v.z) > 0.95, 'at the far end');
  const o3 = () => s.w.objectives.find((o) => o.id === 'o3');
  assert.ok(!o3().done, 'the escape waits for o1 and o2');
  s.w.objectives.find((o) => o.id === 'o1').done = true; // (the binder taken)
  s.w.byId('mast_c').destroyed = true; // (the main mast down: o2)
  s.run(0.5);
  assert.ok(s.w.objectives.find((o) => o.id === 'o2').done, 'o2 done');
  assert.ok(o3().done, 'escape done');
});

test('e03 disguise: the private\'s tunic passes the operators and hd1, not the chief, the sergeants or the Gestapo; the coat passes sergeants', () => {
  const s = sim(), spy = s.c('spy');
  spy.disguised = true; spy.uniformType = 'soldier';
  for (const id of ['op1', 'op2', 'op3', 'hd1', 'hd2', 'c1', 's1', 'r1']) assert.ok(!recognises(s.get(id), spy, s.w), `${id} is fooled by a private's tunic`);
  for (const id of ['lt', 't1', 'p1a', 'ansbach', 'ge1', 'ge2']) assert.ok(recognises(s.get(id), spy, s.w), `${id} sees through a private's tunic`);
  spy.uniformType = 'zookeeper';
  for (const id of ['t1', 'p1a']) assert.ok(!recognises(s.get(id), spy, s.w), `${id} is fooled by the trainer's coat`);
  for (const id of ['lt', 'ge1']) assert.ok(recognises(s.get(id), spy, s.w), `${id} sees through the coat`);
  // and the cone rule agrees: in hd1's face, a tunic is invisible to him, a bare Spy is not
  const hd1 = s.get('hd1');
  park(spy, hd1.x, hd1.z + 4);
  spy.uniformType = 'soldier';
  assert.equal(canSee(hd1, spy, s.w), 'none', 'hd1 does not see a private');
  spy.disguised = false; spy.uniformType = null;
  assert.notEqual(canSee(hd1, spy, s.w), 'none', 'he sees the Spy without it');
});

test('e03 trainer: seeing a commando he shouts and runs for the barn (unseen: he goes on with his rounds)', () => {
  { const s = sim(), zk = s.get('zk'), gb = s.c('greenberet');
    park(gb, zk.x + Math.cos(zk.heading) * 6, zk.z + Math.sin(zk.heading) * 6);
    assert.ok(s.run(5, () => s.log.some((l) => l.ev === 'enemy:flee')), 'he flees');
    assert.ok(s.log.some((l) => l.ev === 'alarm:zone'), 'and the alarm is up');
    s.run(60);
    assert.ok(near(zk, E03.BARN_DOOR, 6), `at the barn (${zk.x.toFixed(1)},${zk.z.toFixed(1)})`); }
  { const s = sim();
    s.run(120);
    assert.ok(!s.log.some((l) => l.ev === 'enemy:flee' || l.ev === 'alarm:zone'), 'no commando, no flight'); }
});

test('e03 barn: its ramp is walled off and the passage under its bridge open; b1 stands clear of both; the squads come out under the bridge and go round the ramp', () => {
  // (barn_b is drawn turned a half turn: its earth ramp runs N from the bridge deck over the byre doors, docs §16.4 #7)
  const s = sim(), g = s.w.grid, R = E03.BARN_RAMP, DECK = [E03.BARN[0] - 1.67, E03.BARN[0] + 1.67];
  const inRamp = (x, z) => x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1;
  for (let z = R.z0 + 0.3; z < R.z1 - 0.3; z += 0.5) for (let x = R.x0 + 0.3; x < R.x1 - 0.3; x += 0.5) {
    assert.ok(!g.walkableAt(x, z), `the ramp's body at (${x.toFixed(1)}, ${z.toFixed(1)}) is no way on foot`);
  }
  for (const [x, z] of [...E03.BARN_BYRES, ...E03.BARN_PASSAGE, E03.BARN_DOOR]) assert.ok(g.walkableAt(x, z), `(${x}, ${z}) under or beside the bridge is open`);
  const b1 = s.get('b1');
  assert.ok(!inRamp(b1.x, b1.z) && (b1.x < DECK[0] - 0.4 || b1.x > DECK[1] + 0.4), `b1 stands in the open, not on the ramp nor under its deck (${b1.x}, ${b1.z})`);
  // the hall's alarm: two squads of three come out at the byre doors and leave the passage W and E of the ramp
  const men = [];
  s.w.events.on('reinforcements', (p) => { if (p.barracksId === 'barn') men.push(...p.units); });
  s.w.alarm.raise('z_hall', 'seen', 90, 40);
  const doors = E03.BARN_BYRES;
  let seen = 0, onRamp = null;
  for (let k = 0; k < Math.round(40 / s.dt); k++) {
    s.step();
    for (const e of men) {
      if (!e.seen0) { e.seen0 = true; seen++; assert.ok(doors.some((d) => Math.hypot(e.x - d[0], e.z - d[1]) < 2), `${e.id} comes out at a byre door (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`); }
      if (!onRamp && inRamp(e.x, e.z)) onRamp = `${e.id} at (${e.x.toFixed(2)}, ${e.z.toFixed(2)}), t ${s.w.time.toFixed(1)}`;
    }
  }
  assert.equal(seen, 6, 'both RINT squads came out');
  assert.equal(onRamp, null, 'nobody walks through the ramp');
  assert.ok(men.every((e) => e.z < E03.BARN_RAMP.z0 || Math.abs(e.x - E03.BARN[0]) > 3), 'all of them are out past the ramp');
});

test('e03 manager: a commando in his sight → he walks to the nearest armed man, who raises the alarm; a Spy in uniform passes', () => {
  { const s = sim(), mg = s.get('mgr'), gb = s.c('greenberet');
    park(gb, mg.x + Math.cos(mg.heading) * 5, mg.z + Math.sin(mg.heading) * 5);
    assert.ok(s.run(60, () => s.log.some((l) => l.ev === 'enemy:snitched')), 'he reports');
    assert.ok(s.log.some((l) => l.ev === 'alarm:zone'), 'the alarm'); }
  { const s = sim(), mg = s.get('mgr'), spy = s.c('spy');
    for (const id of ['p1a', 'p1b', 'p1c', 'c2']) { const e = s.get(id); if (e) s.w.remove(e); } // (their sergeant sees through a tunic)
    spy.disguised = true; spy.uniformType = 'soldier';
    park(spy, mg.x + Math.cos(mg.heading) * 5, mg.z + Math.sin(mg.heading) * 5);
    s.run(30);
    assert.ok(!s.log.some((l) => l.ev === 'enemy:snitched' || l.ev === 'alarm:zone'), 'a man in uniform is no news'); }
});

test('e03 puppet: the cuffed sergeant on strings talks hd1 round; seen, the Green Beret loses him (and he shouts)', () => {
  const s = sim(), t1 = s.get('t1'), hd1 = s.get('hd1'), gb = s.c('greenberet');
  for (const id of ['p1a', 'p1b', 'p1c', 'd1', 'lt']) { const e = s.get(id); if (e) s.w.remove(e); } // (passers-by)
  s.run(0.2);
  knockOut(t1, gb, s.w); cuff(t1, gb, s.w);
  // (carried) beside the hall's south door, east of hd1; the Green Beret along the hall's south wall, west, behind him
  t1.x = hd1.x + 2.4; t1.z = hd1.z + 2.0; park(gb, E03.HALL.x0 + 13.5, E03.HALL.z1 + 1.1);
  assert.ok(s.w.grid.lineOfSight(gb.x, gb.z, t1.x, t1.z), 'the controller sees his man');
  assert.deepEqual(s.w.enemies.filter((e) => e.alive && e.vision && canSee(e, gb, s.w) !== 'none').map((e) => e.tag), [], 'nobody sees the controller');
  assert.ok(takePuppet(t1, gb, s.w), 'on strings');
  assert.ok(gb.issue({ type: 'ability', id: 'puppetDistract', target: hd1 }), 'talk to hd1');
  assert.ok(s.run(8, () => hd1.brain?.distractedBy === t1), 'hd1 turns to the puppet');
  s.run(4);
  assert.equal(t1.puppetOf, gb, 'still on strings');
  assert.ok(!s.log.some((l) => l.ev === 'alarm:zone'), 'no alarm');
  // the controller steps out in front of hd2's eyes (the hall's east door): control lost, the sergeant shouts
  park(gb, E03.DOOR_E[0] + 6, E03.DOOR_E[1]);
  s.run(2);
  assert.ok(t1.puppetOf !== gb, 'the puppet is lost');
  assert.ok(s.log.some((l) => l.ev === 'alarm:zone'), 'and the alarm is up');
});

test('e03 ring: the lions charge a man inside the kerb and never leave the ring; the open gate lets the ostriches roam', () => {
  { const s = sim(), sa = s.c('sapper');
    park(sa, E03.RING[0] + 2, E03.RING[1] + 1);
    s.run(6);
    assert.ok(!sa.alive || sa.hp < sa.maxHp || s.w.enemies.some((e) => e.soldierType === 'lion' && e.brain?.state !== 'IDLE'), 'charged');
    s.run(40);
    for (const id of ['lion1', 'lion2', 'lion3']) assert.ok(near(s.get(id), E03.RING, E03.RING_R + 0.6), `${id} stays in the ring`); }
  { const s = sim(), gate = s.w.interactables.find((i) => i.tag === 'ostrich_gate'), gb = s.c('greenberet');
    park(gb, gate.x + 1.2, gate.z);
    const inPaddock = (o) => o.x < E03.PADDOCK.x1 + 0.2;
    assert.ok(['os1', 'os2', 'os3', 'os4'].every((id) => inPaddock(s.get(id))), 'all in the paddock');
    assert.ok(gb.issue({ type: 'ability', id: 'use', target: gate }), 'the Green Beret opens the gate');
    s.run(90);
    assert.ok(['os1', 'os2', 'os3', 'os4'].some((id) => !inPaddock(s.get(id))), 'the birds are out'); }
});

// ------------------------------------------------------------------ the main mast's one charge

test('e03 charge: the one remote charge fired off the main mast\'s mark fails the mission 0.5 s on; set on the mark it drops the mast and nothing fails', () => {
  /** The Sapper sets his charge at (x, z), walks off to the start and fires it; returns the sim and the blast time. */
  const fireAt = (x, z, { easy = false } = {}) => {
    const s = sim(easy), sap = s.c('sapper');
    // (nobody about: only the charge decides; the animals stay in their pens)
    for (const e of [...s.w.enemies]) if (!ANIMALS.has(e.soldierType)) s.w.remove(e);
    park(sap, x, z);
    assert.ok(sap.issue({ type: 'ability', id: 'remoteBomb' }), `the Sapper sets his charge (${sap.lastRefusal?.text ?? ''})`);
    assert.ok(s.run(5, () => s.w.interactables.some((i) => i.interactKind === 'bomb' && i.placed)), 'set');
    assert.equal(sap.inventory.get('remoteBomb') ?? 0, 0, 'his only charge');
    park(sap, 9, 95);
    s.run(10);
    assert.equal(s.w.scriptFail ?? null, null, 'a charge set and not fired: nothing fails');
    let tBlast = null;
    s.w.events.on('bomb:exploded', () => { tBlast = s.w.time; });
    assert.ok(sap.issue({ type: 'ability', id: 'detonate' }), 'fired');
    assert.ok(s.run(3, () => tBlast != null), 'it goes off');
    return { s, tBlast };
  };
  for (const easy of [false, true]) { // off the mark (by the landing): the mast stands, nothing else can drop it
    const { s, tBlast } = fireAt(30, 92, { easy });
    const mast = s.w.byId('mast_c');
    assert.ok(!mast.destroyed, 'the mast stands');
    assert.equal(s.w.scriptFail ?? null, null, 'not at once: the trigger waits 0.5 s');
    assert.ok(s.run(2, () => !!s.w.scriptFail), `${easy ? 'Easy' : 'Hard'}: the mission fails`);
    assert.equal(s.w.scriptFail, NO_CHARGE_FAIL);
    assert.ok(s.w.time - tBlast >= 0.45 && s.w.time - tBlast <= 0.65, `0.5 s after the blast (${(s.w.time - tBlast).toFixed(2)})`);
  }
  { // negative control: on the mark at the mast's foot the charge drops it (o2) and the mission plays on
    const { s } = fireAt(...E03.MAST_CHARGE);
    s.run(1);
    assert.ok(s.w.byId('mast_c').destroyed, 'the main mast is down');
    assert.ok(s.w.objectives.find((o) => o.id === 'o2').done, 'o2 done');
    s.run(30);
    assert.equal(s.w.scriptFail ?? null, null, 'no fail');
  }
  { // the counter: the charge in the knapsack, set, taken back (house rule recoverCharges) — it counts all along
    const s = sim(), w = s.w, sap = s.c('sapper');
    for (const e of [...w.enemies]) if (!ANIMALS.has(e.soldierType)) w.remove(e);
    assert.equal(mastChargesLeft(w), 1, 'in the knapsack');
    park(sap, 30, 92);
    assert.ok(sap.issue({ type: 'ability', id: 'remoteBomb' }));
    let min = Infinity;
    assert.ok(s.run(5, () => { min = Math.min(min, mastChargesLeft(w)); return w.interactables.some((i) => i.interactKind === 'bomb' && i.placed); }), 'set');
    assert.equal(mastChargesLeft(w), 1, 'set on the ground');
    const b = w.interactables.find((i) => i.interactKind === 'bomb' && i.placed);
    assert.ok(sap.issue({ type: 'ability', id: 'takeCharge', target: b }), `taken back (${sap.lastRefusal?.text ?? ''})`);
    assert.ok(s.run(8, () => { min = Math.min(min, mastChargesLeft(w)); return b.taken; }), 'taken');
    s.run(0.5);
    assert.equal(min, 1, 'the count never dropped');
    assert.equal(sap.inventory.get('remoteBomb'), 1, 'back in the knapsack');
    assert.equal(checkMastCharge(w, w.setpieces), false, 'one charge left: no fail');
    sap.inventory.set('remoteBomb', 0);
    assert.equal(mastChargesLeft(w), 0);
    w.byId('mast_c').destroyed = true;
    assert.equal(checkMastCharge(w, w.setpieces), false, 'the mast already down: nothing to guard');
    assert.equal(w.scriptFail ?? null, null);
    w.byId('mast_c').destroyed = false;
    assert.equal(checkMastCharge(w, w.setpieces), true, 'none left and the mast standing: fail');
    assert.equal(w.scriptFail, NO_CHARGE_FAIL);
  }
});

// ------------------------------------------------------------------ save / load

/**
 * A quick save of `s` loaded into a freshly built e03, as save.js does: the snapshot (World.serialize, the id counter,
 * the AI director, the alarm), the mission rebuilt, the entities restored, the set pieces primed (`prime: false`: as
 * before the fix, they wait for the director's first tick). `edit(S)` changes the snapshot first (a negative control).
 */
function reload(s, { prime = true, edit = null } = {}) {
  const w = s.w;
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), nextId: Entity.nextId, ai: w.ai?.serialize?.() ?? null }));
  const A = JSON.parse(JSON.stringify(w.alarm?.serialize?.() ?? null));
  edit?.(S);
  const s2 = headlessMission('e03');
  const w2 = s2.world;
  restoreWorld(w2, S);
  if (A) w2.alarm.deserialize(A);
  if (prime) w2.setpieces.prime();
  const run = (sec) => { for (let k = 0, n = Math.round(sec / s2.dt); k < n; k++) s2.step(); };
  return { ...s2, w: w2, run, get: (t) => w2.enemies.find((e) => e.tag === t) };
}
/** Everyone's place and brain state, and the RNG: what a run is. */
const worldState = (w) => [...w.commandos, ...w.enemies].map((u) => `${u.tag ?? u.id} ${u.x.toFixed(5)},${u.z.toFixed(5)} ${u.brain?.state ?? ''}`).concat(`rng ${w.rng.state}`);
const ANIMAL_IDS = ['lion1', 'lion2', 'lion3', 'os1', 'os2', 'os3', 'os4'];

test('e03 save/load: the circus animals keep their wander timers — 30 s after a quick load is the same 30 s as without it', () => {
  const s = sim();
  s.run(25);
  const L = reload(s);
  assert.deepEqual(worldState(L.w), worldState(s.w), 'the same world right after the load');
  assert.ok(ANIMAL_IDS.some((id) => s.get(id).brain.wanderT > 0.5), 'some animal is mid-way through its wander wait');
  for (const id of ANIMAL_IDS) assert.equal(L.get(id).brain.wanderT, s.get(id).brain.wanderT, `${id}'s wander timer`);
  s.run(30); L.run(30);
  assert.deepEqual(worldState(L.w), worldState(s.w), '30 s on: the same world');
  // negative control: the save without the wander timers (as before) — every animal picks a new spot at once and
  // draws from the shared RNG: the world goes another way
  const s3 = sim();
  s3.run(25);
  const L3 = reload(s3, { edit: (S) => { for (const e of S.entities) if (e.brain?.animal) delete e.brain.wanderT; } });
  s3.run(30); L3.run(30);
  assert.notDeepEqual(worldState(L3.w), worldState(s3.w), 'without the timers the load parts from the run');
});

test('e03 save/load: an alarm on the first tick after a quick load sends the chief to the well, opens the kennel, takes the Oberst in', () => {
  for (const prime of [true, false]) {
    const s = sim();
    s.run(10);
    const L = reload(s, { prime });
    // (before the director's first 20 Hz tick: a challenge running out on the load's first tick)
    L.w.alarm.raise('z_hall', 'seen', 90, 40);
    L.run(3);
    const d = L.w.setpieces, well = d.get('well_errand'), kennel = d.get('kennel'), oberst = d.get('ansbach_indoors');
    if (prime) {
      assert.notEqual(well.phase, 'idle', 'the chief is on his way to the binder');
      assert.notEqual(kennel.phase, 'kennelled', 'the handler goes to the kennel gate');
      assert.ok(oberst.gone, 'the Oberst and his escort go indoors');
    } else { // negative control: set pieces initialised on the director's first tick never heard it (the old load)
      assert.equal(well.phase, 'idle', 'unprimed: the errand never heard the alarm');
      assert.equal(kennel.phase, 'kennelled', 'unprimed: the dogs stay in');
    }
  }
});
