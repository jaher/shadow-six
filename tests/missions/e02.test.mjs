/**
 * LIGHTS OUT e02 "Curfew" (docs/expansion/e02.md): schema, the Easy / Hard garrisons, and the design's acceptance
 * list — the van's flight (it leaves on the palazzo's alarm with the log and a free driver, and fails the mission; it
 * stays put with the driver cuffed), rank recognition (the gate sergeant sees through a private's tunic and passes a
 * sergeant's, the lieutenant sees through a sergeant's, the dog through any), Tonino's pack pulls l2 and not l1, and
 * Captain Hollis counts at the exit.
 * Run with the unit suite: node tests/unit/run.mjs e02
 */
import { test, assert } from '../unit/lib.mjs';
import { MISSIONS, getMission } from '../../src/missions/index.js';
import { validateMission, normalizeMission } from '../../src/missions/schema.js';
import { headlessMission } from '../../tools/solutions/headless.mjs';
import { recognises } from '../../src/ai/bcd-ranks.js';
import { canSee, coneAt } from '../../src/ai/perception.js';
import { vanAlarm, VAN_FAIL } from '../../src/missions/scripts/e02.js';
import { packLanded } from '../../src/ai/bcd-reactions.js';
import { EXIT } from '../../src/missions/expansion/e02_curfew.js';
import '../../src/abilities/index.js';

const M = () => getMission('e02');
// (the second van's crew [H] folds into the vehicle: schema.foldVehicleCrews)
const garrison = (m) => m.enemies.filter((e) => e.soldierType !== 'pow').length + (m.vehicles || []).reduce((n, v) => n + (v.crew?.length || 0), 0);
const run = (s, sec) => { for (let i = 0, n = Math.round(sec / s.dt); i < n; i++) s.step(); };

test('e02: registered in the BCD expansion, validates on Easy and Hard, garrisons of 21 and 30', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m), 'registered');
  assert.equal(m.campaign, 'BCD');
  for (const difficulty of ['easy', 'hard']) {
    const v = validateMission(normalizeMission(m, { difficulty, quiet: true }));
    assert.deepEqual(v.errors, [], `${difficulty}: no errors`);
  }
  assert.equal(garrison(normalizeMission(m, { difficulty: 'easy', quiet: true })), 21, 'Easy: 21');
  assert.equal(garrison(normalizeMission(m, { difficulty: 'hard', quiet: true })), 30, 'Hard: 30');
});

test('e02: the van leaves on the palazzo alarm with a free driver and the log aboard, and the mission is lost', () => {
  const s = headlessMission('e02', { difficulty: 'hard' }), w = s.world;
  run(s, 0.5); // (the script lays the log on the tailboard at its first tick)
  const van = w.byId('van_df');
  assert.ok(van && w.byId('df_log'), 'the van and the log on its tailboard');
  assert.equal(vanAlarm(w), true, 'RHQ arms the flight');
  run(s, 30);
  assert.ok(van.x >= 99 || van.drivenOff, `the van drove off (at ${van.x.toFixed(1)}, ${van.z.toFixed(1)})`);
  assert.equal(w.scriptFail, VAN_FAIL, 'the mission is lost');
});

test('e02: with its driver cuffed the van stays put on the alarm; with the log taken the alarm is only an alarm', () => {
  const s = headlessMission('e02', { difficulty: 'hard' }), w = s.world;
  run(s, 2); // (settled on its wheels)
  const van = w.byId('van_df'), drv = w.byId('vdrv'), x0 = van.x, z0 = van.z;
  // (the courtyard cleared first, as in play: a comrade who sees a bound man frees him and shouts — RHQ)
  for (const e of w.enemies.filter((q) => ['c1', 'c2', 'c3', 'c5'].includes(q.tag))) w.remove(e);
  drv.ko = 'bound';
  assert.equal(vanAlarm(w), false, 'no driver: the flight is not armed');
  run(s, 30);
  assert.ok(Math.hypot(van.x - x0, van.z - z0) < 0.01, 'the van has not moved');
  assert.ok(!w.scriptFail, 'nothing lost');
  const s2 = headlessMission('e02', { difficulty: 'hard' }), w2 = s2.world;
  w2.objectives.find((o) => o.id === 'o1').done = true;
  assert.equal(vanAlarm(w2), false, 'the log already taken: the van has nothing to save');
});

test('e02: the gate sergeant sees through a private\'s tunic and passes a sergeant\'s; the lieutenant sees through a sergeant\'s; the dog through any', () => {
  const s = headlessMission('e02', { difficulty: 'hard' }), w = s.world;
  const spy = w.commandos.find((c) => c.role === 'spy');
  const as = (u) => ({ ...spy, x: spy.x, z: spy.z, disguised: true, uniformType: u });
  const p1 = w.enemies.find((e) => e.tag === 'p1'), c3 = w.enemies.find((e) => e.tag === 'c3'), p2 = w.enemies.find((e) => e.tag === 'p2');
  const dog = w.enemies.find((e) => e.tag === 'dog1');
  assert.equal(recognises(p1, as('soldier'), w), true, 'p1 (sergeant) sees through a private\'s tunic');
  assert.equal(recognises(p1, as('sergeant'), w), false, 'p1 passes a sergeant\'s');
  assert.equal(recognises(p2, as('soldier'), w), false, 'p2 (a private) passes a private\'s');
  assert.equal(recognises(c3, as('sergeant'), w), true, 'c3 (lieutenant) sees through a sergeant\'s');
  assert.equal(recognises(c3, as('officer'), w), false, 'c3 passes an officer\'s');
  assert.equal(recognises(dog, as('officer'), w), true, 'the dog sees through any uniform');
  // and in his cone: the dog barks at the Spy in a tunic in front of him
  const ahead = { x: dog.x + Math.cos(dog.heading) * 5, z: dog.z + Math.sin(dog.heading) * 5 };
  const target = { x: ahead.x, z: ahead.z, y: dog.y || 0, isLow: false, isVisibleToEnemies: true, alive: true, kind: 'commando', disguised: true, uniformType: 'sergeant' };
  assert.notEqual(canSee(dog, target, w, { cone: coneAt(dog, w.time) }), 'none', 'the dog sees the disguised Spy');
});

test('e02: Tonino\'s pack landing at the foot of the steps pulls l2, not l1 (at the avenue end of his beat)', () => {
  const s = headlessMission('e02', { difficulty: 'hard' }), w = s.world;
  const l1 = w.enemies.find((e) => e.tag === 'l1'), l2 = w.enemies.find((e) => e.tag === 'l2');
  l1.x = 50.25; l1.z = 116; l1.heading = Math.PI / 2; // (his halt at the avenue end, looking out over Via Marina)
  const lured = [];
  w.events.on('bcd:pack-lured', (p) => lured.push(p?.enemy?.tag));
  const who = packLanded(w, { x: 47, z: 97 });
  assert.equal(who?.tag, 'l2', `l2 goes for the pack (${lured.join(',')})`);
  assert.ok(!lured.includes('l1'), 'l1 does not');
  assert.equal(l2.brain.state, 'CIGS');
});

test('e02: everyone must reach the cistern — the exit does not count until Captain Hollis is there too', () => {
  const s = headlessMission('e02', { difficulty: 'easy' }), w = s.world;
  const hollis = w.commandos.find((c) => c.guestId === 'hollis');
  for (const id of ['o1', 'o2', 'o3']) w.objectives.find((o) => o.id === id).done = true; // (the exit counts last)
  const put = (c, x, z) => { c.x = x; c.z = z; c.y = w.grid.elevAt(x, z); c.path = null; };
  for (const [i, c] of w.commandos.filter((q) => q !== hollis).entries()) put(c, EXIT.x - 1 + (i % 3) * 0.8, EXIT.z - 0.6 + Math.floor(i / 3) * 0.8);
  run(s, 1);
  const o4 = () => w.objectives.find((o) => o.id === 'o4').done;
  assert.ok(!o4(), 'Hollis still in the cellar: not yet');
  hollis.state = 'active'; put(hollis, EXIT.x + 0.8, EXIT.z + 0.8);
  run(s, 2);
  assert.ok(o4(), 'all of them in the cistern, Hollis too');
});
