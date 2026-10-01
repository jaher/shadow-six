/**
 * BEL M18 "The Force of Circumstance" (docs/missions/m18.md): schema + §10.5 test #14 (every start reaches every
 * objective and the lorry with the intended abilities, no start in a cone, every route walkable), the exact §3.8
 * loadout, the Kildread census, the zones (islands silent, the rest RINT), the cumulative A/B/C charges (bombs and
 * shells, not grenades), the station grenade (barracks + track), the tank on the deck, the objectives and the lorry
 * extraction by the S road.
 * Run with the unit suite: node tests/unit/run.mjs m18
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives, updateExtractionVehicle, skipExtractionDrive } from '../../src/core/objectives.js';
import { MARKERS, DECK } from '../../src/missions/scripts/m18.js';

const M = () => getMission('m18');
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
const mk = (id) => MARKERS.find((m) => m.id === id);

test('m18: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [201, 150]);
  assert.equal(m.par.time, 900);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.coneColors, 'green');
  assert.ok(m.briefing.text && m.briefing.hints.length >= 5);
});

test('m18: §10.5 #14 — loads; every start reaches the bridge and the lorry; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M()), []);
  const g = loadGrid(M()).grid;
  const crate = M().items[0], tank = M().vehicles.find((v) => v.id === 'pz3'), raft = M().vehicles.find((v) => v.id === 'raft');
  for (const c of M().commandos) {
    const swim = c.role === 'diver';
    assert.ok(reach(g, c, { x: 90.5, z: 137 }, c.role, { swim }), `${c.role} reaches the lorry`);
    for (const m of MARKERS) assert.ok(reach(g, c, m, c.role, { swim }), `${c.role} reaches marker ${m.id} over the E approach`);
  }
  const at = (r) => M().commandos.find((c) => c.role === r);
  assert.ok(reach(g, at('diver'), raft, 'diver', { swim: true }), 'the Marine swims to the boat on I_N');
  assert.ok(reach(g, at('diver'), crate, 'diver', { swim: true }), 'the Marine (and the boat) reach the crate on I_S');
  assert.ok(!reach(g, at('sapper'), crate, 'sapper'), 'the crate is reached only by water (ferry)');
  assert.ok(reach(g, crate, { x: 100, z: 95 }, 'diver', { swim: true }), 'from the crate the boat lands on the E beach');
  assert.ok(reach(g, at('driver'), { x: tank.x + 3, z: tank.z + 4 }, 'driver'), 'the Driver can get to the Panzer III');
  assert.ok(reach(g, { x: 70, z: 22 }, raft, 'greenberet'), 'the reed neck joins the N island to the W bank (P23 walks it)');
});

test('m18: §3.8 row 18 loadout exactly (GB, Marine, Sapper 2 grenades + trap, Driver medic; bombs and boat on site)', () => {
  const L = belLoadout(18);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const sa = spawnInventory('sapper', M().commandos.find((c) => c.role === 'sapper').inventory);
  assert.equal(sa.grenade, 2);
  assert.equal(sa.bearTrap, 1);
  assert.ok(!sa.remoteBomb && !sa.timeBomb, 'no bombs at the start');
  assert.equal(L.medic, 'driver');
  assert.ok(!spawnInventory('driver', M().commandos.find((c) => c.role === 'driver').inventory).smg, 'no SMG');
  assert.deepEqual(M().items.map((i) => [i.itemId, i.count]), [['remoteBomb', 3]]);
  const V = Object.fromEntries(M().vehicles.map((v) => [v.id, v]));
  assert.equal(V.pz3.vehicleType, 'panzer3');
  assert.deepEqual(V.pz3.operators, ['driver']);
  assert.deepEqual(V.truck.operators, ['driver']);
  assert.equal(V.raft.seats, 3, 'the boat carries the Marine + 2');
  assert.equal(M().vehicles.filter((v) => v.vehicleType === 'mgNest').length, 2);
  assert.equal(M().structures.filter((s) => s.explosive === 'barrel').length, 4, 'four barrels on site');
});

test('m18: enemy census = Kildread (20 walkers, 14 sentries, 2×2 + 6×3 + 4 + 5 patrols, 2 MG, 2 bunkers, 2 SdKfz, 3 garrisons)', () => {
  const es = M().enemies;
  assert.equal(es.filter((e) => e.soldierType === 'soldier' && e.route && !e.squad).length, 20);
  assert.equal(es.filter((e) => e.soldierType === 'sentry').length, 14);
  const squads = {};
  for (const e of es.filter((q) => q.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(Object.values(squads).sort(), [2, 2, 3, 3, 3, 3, 3, 3, 4, 5]);
  assert.equal(es.filter((e) => e.soldierType === 'mg').length, 2);
  assert.deepEqual(es.filter((e) => e.structure).map((e) => e.structure).sort(), ['pb_e', 'pb_w']);
  assert.equal(es.filter((e) => !e.vehicle).length, 69, '69 on foot');
  assert.deepEqual(M().vehicles.filter((v) => v.vehicleType === 'sdkfz').map((v) => v.route && v.crew.length), [2, 2]);
  assert.deepEqual(Object.keys(M().barracks).sort(), ['hut_fields', 'nw_h3', 'station']);
  for (const id of Object.keys(M().barracks)) assert.ok(M().structures.find((s) => s.id === id).destructible, `${id} can be razed`);
});

/** Full M18 sim with live brains, the alarm and the objectives (the director runs the triggers). */
function m18Sim({ brains = true } = {}) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.flags = {};
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  w.objectives = createObjectives(s.mission.objectives);
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  // park the team out of every cone, far from everything (the SE corner behind the start wall)
  for (const c of w.commandos) { c.x = 199; c.z = 148; }
  s.run(0.1);
  return s;
}
const o = (w, id) => w.objectives.find((q) => q.id === id);

test('m18: the islands are silent zones listed first; the rest of the map is one RINT zone (not a loss)', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  assert.deepEqual(M().zones.map((z) => z.id), ['z_isl_n', 'z_isl_s', 'z_all']);
  assert.equal(a.zoneAt(100, 20)?.id, 'z_isl_n', 'N island');
  assert.equal(a.zoneAt(84, 25)?.id, 'z_isl_n', 'the reed neck');
  assert.equal(a.zoneAt(50, 92)?.id, 'z_isl_s', 'bridge island');
  for (const [x, z] of [[1, 1], [200, 1], [185, 30], [20, 20], [1, 149], [200, 149]]) assert.equal(a.zoneAt(x, z)?.id, 'z_all');
  const zs = Object.fromEntries(M().zones.map((z) => [z.id, z]));
  assert.equal(zs.z_isl_n.onSeen, null);
  assert.equal(zs.z_isl_s.onHeard, null);
  assert.equal(zs.z_all.onSeen, 'RINT');
  assert.ok(!M().alarmFail, 'the siren is survivable');
  assert.equal(a.raise('z_isl_s', 'body', 50, 92), null, 'a cry on the island reaches no one');
});

test('m18 hook: A, B, C are cumulative in any order and at any interval; bombs and shells count, grenades do not', () => {
  const s = m18Sim(), w = s.world, bridge = w.byId('bridge');
  assert.ok(bridge && !bridge.destroyed, 'the bridge is a target');
  const g = w.grid, mid = { x: 45.4, z: 70.3 }; // over the W channel
  assert.ok(g.walkableAt(mid.x, mid.z), 'deck walkable');
  applyExplosion(w, mk('C').x, mk('C').z, 'bomb', null);
  s.run(0.2);
  assert.ok(s.msgs.some((m) => /Charge C has gone off \(1 of 3\)/.test(m)), 'progress C');
  s.run(60);
  applyExplosion(w, mk('A').x, mk('A').z, 'grenade', null);
  s.run(0.2);
  assert.ok(!s.msgs.some((m) => /Charge A/.test(m)), 'a grenade does not set off a charge');
  applyExplosion(w, mk('A').x + 1, mk('A').z, 'shell', null);
  s.run(0.2);
  assert.ok(s.msgs.some((m) => /Charge A has gone off \(2 of 3\)/.test(m)), 'a tank shell on A counts');
  assert.ok(!bridge.destroyed, 'two of three: still standing');
  // a man on the span goes down with it
  const e = s.get('p46');
  s.run(120);
  e.x = mid.x; e.z = mid.z; e.stop?.();
  applyExplosion(w, mk('B').x, mk('B').z, 'bomb', null);
  s.run(0.5);
  assert.ok(bridge.destroyed, 'third marker: the bridge falls');
  assert.ok(!g.walkableAt(mid.x, mid.z), 'the span over the river is gone');
  assert.equal(e.alive, false, 'anyone on the span dies');
  assert.ok(o(w, 'o1').done, 'o1 done');
  assert.ok(s.msgs.some((m) => /bridge is down/.test(m)), 'T5');
});

test('m18 hook: a grenade by the platform razes the station barracks and breaks the track: the next train stops short', () => {
  const s = m18Sim(), w = s.world;
  const e14 = s.get('e14');
  applyExplosion(w, e14.x, e14.z, 'grenade', null);
  s.run(0.5);
  assert.ok(w.byId('station').destroyed, 'station razed');
  assert.ok(w.alarm.barracks.station.destroyed, 'g_station sends nobody');
  assert.equal(e14.alive, false);
  assert.equal(w.railBlocks.length, 1, 'track damaged');
  assert.ok(s.msgs.some((m) => /track is damaged/.test(m)));
  const train = w.byId('train');
  s.run(120);
  assert.ok(Math.hypot(train.x - 200.6, train.z - 24.5) < 30 || train.x > 186, `the train never passes the station (${train.x.toFixed(1)}, ${train.z.toFixed(1)})`);
});

test('m18 hook: the Panzer III — the Driver only, immune to bombs, drives over the deck from the W bank to the E bank', () => {
  const s = m18Sim(), w = s.world, tank = s.get('pz3');
  s.run(0.2);
  const sa = s.cmd('sapper'), dr = s.cmd('driver');
  assert.ok(!tank.canOperate?.(sa), 'the Sapper cannot drive it');
  applyExplosion(w, tank.x + 1, tank.z, 'bomb', null);
  applyExplosion(w, tank.x - 1, tank.z, 'shell', null);
  s.run(0.2);
  assert.ok(!tank.destroyed, 'bombs and shells do nothing');
  tank.x = 29; tank.z = 56.8; tank.heading = Math.atan2(DECK.b.z - DECK.a.z, DECK.b.x - DECK.a.x);
  dr.x = tank.x - 2; dr.z = tank.z + 2;
  assert.equal(tank.enter(dr), true, 'the Driver boards');
  s.run(0.2);
  assert.ok(tank.canDriveTo(88, 105.6), 'straight over the deck');
  assert.ok(tank.driveTo(88, 105.6, true));
  s.run(40, () => tank.x > 86);
  assert.ok(tank.x > 86, `crossed to the E bank (${tank.x.toFixed(1)}, ${tank.z.toFixed(1)})`);
});

test('m18 hook: the Sapper picks up the three charges on I_S (message); the boat seats the Marine + 2', () => {
  const s = m18Sim(), w = s.world, sa = s.cmd('sapper');
  sa.inventory.set?.('remoteBomb', 3);
  s.run(0.3);
  assert.ok(s.msgs.some((m) => /Three German charges/.test(m)), 'T1');
  const raft = s.get('raft');
  assert.equal(raft.seats ?? raft.capacity, 3);
});

test('m18 hook: boarding before o1 does nothing; after the fall everyone in the lorry → drive-off by the S road → win (ESC skips)', () => {
  const s = m18Sim(), w = s.world, truck = s.get('truck');
  // a cleared map (Prima's route leaves nobody standing; otherwise the whole garrison answers the blast on the road)
  for (const e of w.enemies) e.die('test', null);
  for (const c of w.commandos) { c.x = truck.x; c.z = truck.z - 2; assert.equal(truck.enter(c), true, `${c.role} boards`); }
  s.run(1);
  assert.notEqual(s.flags.evacPhase, 'leave', 'no drive-off before the bridge is down');
  w.byId('abc').hits = { A: 1, B: 1 };
  applyExplosion(w, mk('C').x, mk('C').z, 'bomb', null);
  s.run(0.5);
  assert.ok(o(w, 'o1').done);
  s.run(0.5);
  assert.equal(s.flags.evacPhase, 'leave', 'drive-off started');
  assert.ok(truck._m18Routed, 'the drive-off is path-found');
  const won = s.run(40, () => o(w, 'o2').done);
  assert.ok(won, `the lorry leaves by the S road (${truck.x.toFixed(1)}, ${truck.z.toFixed(1)})`);
  assert.ok(!w.scriptFail);
  // ESC
  const s2 = m18Sim(), w2 = s2.world, t2 = s2.get('truck');
  applyExplosion(w2, mk('A').x, mk('A').z, 'bomb', null);
  applyExplosion(w2, mk('B').x, mk('B').z, 'shell', null);
  applyExplosion(w2, mk('C').x, mk('C').z, 'bomb', null);
  for (const c of w2.commandos) { c.x = t2.x; c.z = t2.z - 2; assert.equal(t2.enter(c), true); }
  s2.run(0.5);
  skipExtractionDrive(w2, s2.flags); // ESC during the drive: nothing left to skip (the win is recorded at boarding)
  s2.run(0.2);
  assert.ok(o(w2, 'o2').done, 'won at once');
});

test('m18 hook: the lorry destroyed is a loss (§8.1 message); the siren alone is not', () => {
  const s = m18Sim(), w = s.world;
  w.alarm.fireEvent('RINT', { zoneId: 'z_all', cause: 'test', x: 185, z: 120 });
  s.run(3);
  assert.ok(!w.scriptFail, 'siren: no loss');
  assert.ok(w.alarm.active, 'siren sounding');
  s.get('truck').destroy(s.cmd('sapper'), 'grenade');
  s.run(0.5);
  assert.match(String(w.scriptFail), /YOU DESTROYED THE TRUCK/, 'the team blew it up: §8.1 wording');
  // review g1: the enemy destroying it does not blame the player
  const s2 = m18Sim(), w2 = s2.world;
  s2.get('truck').destroy(s2.get('p40_b'), 'mp40');
  s2.run(0.5);
  assert.match(String(w2.scriptFail), /THE TRUCK IS GONE/);
  assert.doesNotMatch(String(w2.scriptFail), /YOU DESTROYED/);
});

test('m18 hook: a quiet start — the team drops prone behind the SE wall and 90 s pass with no siren (train, SdKfz, patrols)', () => {
  const s = makeSim(M(), { brains: true }), w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  s.run(1);
  for (const c of w.commandos) assert.equal(c.stance, 'crawl', `${c.role} prone`);
  s.run(90);
  assert.equal(w.alarm.active, false, 'no siren');
  assert.ok(w.commandos.every((c) => c.alive), 'nobody hurt');
  assert.ok(w.enemies.filter((e) => !e.vehicle).every((e) => e.alive), 'the train kills nobody on its own');
});

// ---------------------------------------------------------------- review fixes (M18 playtest)

/** Live sim with the team left prone at the start (no parking): brains, alarm, objectives. */
function m18Start() {
  const s = makeSim(M(), { brains: true }), w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  s.dead = [];
  w.events.on('unit:killed', (p) => s.dead.push({ tag: p.unit.tag ?? p.unit.role, cause: p.cause, t: w.time }));
  return s;
}

test('m18 fix: the parked lorry is clear of the train — two full passes in 200 s, the train kills nobody', () => {
  const s = m18Start(), w = s.world, train = s.get('train'), truck = s.get('truck');
  assert.ok(!train._inBoxOf(truck.x, truck.z, -1e3, 1e3, 3.4 + 3 + 1), 'lorry ≥ 1 m outside the blocker box across the rails');
  let passes = 0;
  w.events.on('train:pass', () => passes++);
  s.run(200);
  assert.ok(passes >= 2, `train passes: ${passes}`);
  assert.ok(!train.railRunning || Math.hypot(train.x - 98.4, train.z - 124.9) > 5, 'not stuck at the level crossing');
  assert.deepEqual(s.dead.filter((d) => d.cause === 'train'), [], 'nobody under the train');
});

test('m18 fix: the islands\' cries do not reach the banks — I_N cleared while P23 walks its loop: no siren', () => {
  const s = m18Start(), w = s.world;
  for (const c of w.commandos) { c.x = 199; c.z = 148; }
  s.run(0.2);
  for (const id of ['e19', 'e20', 'e21', 'p22', 'p22_a']) s.get(id).die('test', null);
  let found = 0;
  w.events.on('enemy:body-found', () => found++);
  s.run(300);
  assert.ok(found >= 3, `the bodies are found (${found})`);
  assert.equal(w.alarm.zonesFired.length, 0, `no zone event (${w.alarm.zonesFired.map((z) => `${z.zone}/${z.cause}`).join(' ')})`);
  assert.equal(w.alarm.active, false);
  // the option itself: noises from (or shouts about) the islands, and bodies there, trip nothing on the banks;
  // the team seen on an island still does, and so does an explosion
  const a = new Alarm(makeSim(M(), { brains: false }).world);
  assert.equal(a.raise('z_all', 'heard', 97, 28, { sensor: 'heard' }), null, 'a cry on I_N');
  assert.equal(a.raise('z_all', 'heard', 62, 42, { sensor: 'heard', about: { x: 91, z: 33 } }), null, 'a bank shout about I_N');
  assert.equal(a.raise('z_all', 'body', 50, 92, { sensor: 'seen' }), null, 'a body on I_S seen from the bank');
  assert.equal(a.raise('z_all', 'heard', 62, 42, { sensor: 'heard' }), 'RINT', 'a cry on the bank');
  const b = new Alarm(makeSim(M(), { brains: false }).world);
  assert.equal(b.raise('z_all', 'seen', 97, 28, { sensor: 'seen' }), 'RINT', 'the team seen on I_N');
});

test('m18 fix: an early siren with the team still prone at the start walls is survivable (180 s)', () => {
  const s = m18Start(), w = s.world;
  s.run(5);
  w.alarm.fireEvent('RINT', { zoneId: 'z_all', cause: 'test', x: 90, z: 30 });
  let near = Infinity;
  for (let k = 0; k < 180; k++) {
    s.run(1);
    for (const e of w.enemies) if (e.alive && String(e.tag).startsWith('hut_fields')) for (const c of w.commandos) near = Math.min(near, Math.hypot(e.x - c.x, e.z - c.z));
  }
  assert.ok(w.commandos.every((c) => c.alive), `all alive (${s.dead.filter((d) => !String(d.tag).startsWith('e') && !String(d.tag).includes('#')).map((d) => d.tag)})`);
  assert.ok(near > 12, `the fields squad keeps off the start walls (${near.toFixed(1)} m)`);
  assert.deepEqual(s.dead.filter((d) => d.cause === 'train').map((d) => d.tag), [], 'the station squad no longer walks the rails');
});

test('m18 fix: the win is recorded at boarding — live patrols on the S road cannot lose it (dossier §10.2)', () => {
  const s = m18Sim(), w = s.world, truck = s.get('truck');
  let won = false;
  w.byId('abc').hits = { A: 1, B: 1 };
  applyExplosion(w, mk('C').x, mk('C').z, 'bomb', null);
  s.run(0.5);
  assert.ok(o(w, 'o1').done);
  for (const c of w.commandos) { c.x = truck.x; c.z = truck.z - 2; assert.equal(truck.enter(c), true, `${c.role} boards`); }
  // P41 and P40 stand on the S road, alerted
  for (const [k, id] of ['p41', 'p41_a', 'p41_b', 'p40', 'p40_a', 'p40_b'].entries()) { const e = s.get(id); e.x = 112 + 3 * k; e.z = 136 + (k % 2); }
  s.run(1, () => (won = !!o(w, 'o2').done));
  assert.ok(won, 'o2 done at boarding');
  truck.destroy(s.get('p40_b'), 'mp40');
  s.run(0.5);
  assert.ok(!w.scriptFail, `a won mission stays won (${w.scriptFail})`);
});

test('m18 fix: the diving Marine passes under the bridge both ways (N→S and S→N), and leaves the boat by the deck free to swim', () => {
  const s = m18Sim({ brains: false }), ma = s.cmd('diver');
  const dive = (x, z) => { ma.x = x; ma.z = z; ma.diving = true; ma.stance = 'dive'; ma.underwater = true; ma.stop?.(); };
  for (const [x0, z0, x, z] of [[64, 68, 38, 91], [64.8, 69.3, 66, 92], [50, 120, 92, 42]]) {
    dive(x0, z0);
    assert.ok(ma.issue({ type: 'move', x, z }), `order (${x0},${z0}) → (${x},${z}) accepted`);
    s.run(150, () => !ma.path);
    assert.ok(Math.hypot(ma.x - x, ma.z - z) < 1, `arrived (${ma.x.toFixed(1)}, ${ma.z.toFixed(1)})`);
  }
  // review e2: out of the boat beside the deck in dive stance → not frozen
  const raft = s.get('raft');
  raft.x = 57.8; raft.z = 74.1;
  dive(57.8, 75.6);
  assert.equal(raft.enter(ma), true);
  s.run(0.2);
  assert.equal(raft.exit(ma), true, 'out');
  assert.ok(ma.issue({ type: 'move', x: 45, z: 72 }), 'can swim away N');
  s.run(60, () => !ma.path);
  assert.ok(Math.hypot(ma.x - 45, ma.z - 72) < 1, `swam off (${ma.x.toFixed(1)}, ${ma.z.toFixed(1)})`);
});

test('m18 fix: the station grenade (Prima Phase 2) kills 13, 14 and 16, and the razed station sends nobody', () => {
  const s = m18Sim(), w = s.world, sa = s.cmd('sapper');
  const released = [];
  w.events.on('reinforcements', (p) => released.push(p.barracksId));
  assert.ok(Math.hypot(s.get('e13').x - s.get('e14').x, s.get('e13').z - s.get('e14').z) < 4.5, 'e13 within the lethal ring of e14');
  const e14 = s.get('e14');
  applyExplosion(w, e14.x, e14.z, 'grenade', sa);
  s.run(1);
  for (const id of ['e13', 'e14', 'e16']) assert.equal(s.get(id).alive, false, `${id} dead`);
  assert.ok(w.byId('station').destroyed);
  assert.ok(!released.includes('station'), `no squad from the rubble (${released})`);
  assert.equal(w.alarm.barracks.station.pool, 6);
});

test('m18 fix: a grenade on P46 by the SW beach pulls only the men within 45 m (explosionPull), not the E/S garrison', () => {
  const s = m18Sim(), w = s.world, p46 = s.get('p46');
  s.run(200, () => Math.hypot(p46.x - 62.8, p46.z - 138.8) < 2);
  const x = p46.x, z = p46.z;
  const far = new Set(w.enemies.filter((e) => e.alive && Math.hypot(e.x - x, e.z - z) > 45));
  applyExplosion(w, x, z, 'grenade', s.cmd('sapper'));
  s.run(20);
  const came = [...far].filter((e) => e.alive && Math.hypot(e.x - x, e.z - z) < 40).map((e) => e.tag);
  assert.deepEqual(came, [], 'nobody from afar converges');
});
