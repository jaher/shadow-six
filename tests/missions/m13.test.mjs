/**
 * BEL M13 "David and Goliath" (docs/missions/m13.md): schema + §10.5 test #14, the quay faces (ramps only), the lock
 * gates (closed gates stop swimmers and torpedoes), the torpedo-only bow target, the fuel tanks, the tank depot,
 * the dock zone, objective/extraction wiring and the dossier's triggers (§11).
 * Run with the unit suite: node tests/unit/run.mjs m13
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { B } from '../../src/world/grid.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';

const M = () => getMission('m13');
const START = { x: 79, z: 152.5 };
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
/** Open both lock gates in a grid-only world (what the levers do). */
const openLocks = (ctx) => { for (const id of ['lock_s', 'lock_n']) ctx.world.setpieces.get(id).setOpen(true); };

test('m13: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [87, 188]);
  assert.equal(m.par.time, 720);
  assert.equal(m.theater, 'coast');
  assert.equal(m.coneColors, 'green');
});

/** The def with both lock gates latched open (the intended solution works both levers, dossier §12). */
const opened = () => ({ ...M(), setpieces: M().setpieces.map((s) => (s.type === 'lock_gate' ? { ...s, open: true } : s)) });

test('m13: §10.5 #14 — loads; with the locks latched open every start reaches every target; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(opened()), []);
  // as built (both gates shut) the only problems are reachability ones: the harbour is locked in until a gate opens
  const probs = checkMission(M());
  assert.deepEqual(probs.filter((p) => !/cannot reach/.test(p)), []);
});

test('m13: §3.8 row 13 loadout exactly (GB/Sniper 4 rounds/Marine, raft on site/Sapper 1 remote bomb/Driver medic, no shovel, no SMG)', () => {
  const L = belLoadout(13);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, M().commandos.find((c) => c.role === r).inventory);
  assert.equal(inv('greenberet').shovel, undefined, 'no shovel from M12 on');
  assert.equal(inv('sniper').sniperRifle, 4);
  assert.equal(inv('sapper').remoteBomb, 1);
  assert.equal(inv('driver').smg, undefined);
  const raft = M().vehicles.find((x) => x.id === 'raft');
  assert.ok(raft && raft.vehicleType === 'raft' && raft.seats === 5, 'the inflatable waits on the ledge rim, five seats');
  const v = (id) => M().vehicles.find((x) => x.id === id);
  assert.equal(v('sub').vehicleType, 'minisub');
  assert.deepEqual(v('sub').operators, ['diver']);
  assert.equal(v('pier_gun').vehicleType, 'cannon');
  assert.equal(v('truck').vehicleType, 'truck');
  assert.equal(M().structures.filter((s) => s.explosive === 'barrel').length, 2, 'two explosive barrels on site');
});

test('m13: enemy census matches Kildread/Prima (19 single men + Patrol 11 of 3; both lock operators hold their posts)', () => {
  const m = M();
  const singles = m.enemies.filter((e) => !e.squad);
  assert.equal(singles.length, 19);
  assert.deepEqual([...new Set(m.enemies.map((e) => e.prima))].sort((a, b) => a - b), Array.from({ length: 20 }, (_, k) => k + 1));
  assert.deepEqual(m.enemies.filter((e) => e.squad?.id === 'p11').map((e) => e.soldierType), ['sergeant', 'trooper', 'trooper']);
  for (const id of ['e5', 'e13']) assert.ok(m.enemies.find((e) => e.id === id).flags.holdsPost, id);
  assert.deepEqual(Object.keys(m.barracks), ['hut_a']);
  assert.equal(m.barracks.hut_a.pool, 6);
  const pz = m.vehicles.find((v) => v.id === 'pz2');
  assert.ok(pz.crew.length && pz.driveable === false, 'the tank is crewed and cannot be taken');
});

test('m13: quay faces — a swimmer climbs out only at the five ramps or the pontoon; nobody walks off a quay', () => {
  const ctx = loadGrid(M()), g = ctx.grid;
  openLocks(ctx);
  const diver = (a, b) => reach(g, a, b, 'diver', { swim: true });
  const docks = { dock: { x: 50, z: 108 }, fuel: { x: 76, z: 43.5 }, mw: { x: 8, z: 84 }, sw: { x: 20, z: 145 }, jetty: { x: 60, z: 145 } };
  const water = { x: 50, z: 125 };
  for (const [n, p] of Object.entries(docks)) assert.ok(diver(water, p), `the Marine reaches the ${n} (via a ramp)`);
  assert.ok(diver(water, { x: 55, z: 68 }), 'and the sub pontoon');
  // stop up every ramp and the gangway: nothing is reachable from the water any more (the pontoon floats)
  for (const t of M().terrain.filter((q) => q.terrain === 'shallow')) {
    if (t.type === 'rect') g.fillRect(t.x, t.z, t.w, t.d, 'block', B.HIGH); else g.fillPoly(t.points, 'block', B.HIGH);
  }
  g.fillRect(58.5, 63.5, 3.5, 3.5, 'block', B.HIGH);
  for (const [n, p] of Object.entries(docks)) assert.ok(!diver(water, p), `no climbing out onto the ${n} away from the ramps`);
  // walkers never leave the quays
  assert.ok(!reach(g, { x: 60, z: 145 }, { x: 60, z: 125 }, 'greenberet'), 'no walking into the water');
});

test('m13: the lock gates — shut, they stop swimmers; the S lock is the only way into the harbour, the N lock into the battleship basin', () => {
  const ctx = loadGrid(M()), g = ctx.grid;
  const roads = { x: 31, z: 165 }, sBasin = { x: 31, z: 127 }, wChannel = { x: 22, z: 58 }, shipBasin = { x: 22, z: 30 };
  const diver = (a, b) => reach(g, a, b, 'diver', { swim: true });
  assert.ok(!diver(roads, sBasin), 'S lock shut: harbour closed');
  assert.ok(!diver(wChannel, shipBasin), 'N lock shut: battleship basin closed');
  ctx.world.setpieces.get('lock_s').setOpen(true);
  assert.ok(diver(roads, sBasin) && diver(roads, wChannel), 'S lock open: in through the harbour mouth');
  assert.ok(!diver(roads, shipBasin));
  ctx.world.setpieces.get('lock_n').setOpen(true);
  assert.ok(diver(wChannel, shipBasin), 'N lock open');
  // the GB's climb is the only way from the ledge onto the jetty on foot
  assert.ok(reach(g, START, { x: 70, z: 147 }, 'greenberet'), 'GB climbs up');
  assert.ok(!reach(g, { x: 77, z: 154.5 }, { x: 70, z: 147 }, 'sniper'), 'the others cannot');
});

function m13Sim({ noStart = false } = {}) {
  const s = makeSim(M(), { brains: false });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); if (w.objectives) checkObjectives(w); }; // the game evaluates objectives every step
  s.alarms = [];
  s.msgs = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ zone: p.zone?.id ?? p.zone, event: p.event }));
  w.events.on('message', (p) => s.msgs.push(p.text));
  w.objectives = createObjectives(s.mission.objectives);
  if (!noStart) s.run(0.1); // first BEL tick: the trigger director installs
  return s;
}
const targetOf = (w, id) => w.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));
const obj = (w, id) => w.objectives.find((o) => o.id === id);
/** Put the Marine in the sub at (x, z) facing `h` degrees and fire one torpedo. */
function fireTorpedo(s, x, z, h) {
  const sub = s.get('sub'), ma = s.cmd('diver');
  if (!sub.occupants.includes(ma)) { ma.x = sub.x; ma.z = sub.z; assert.equal(sub.enter(ma), true, 'the Marine boards'); }
  sub.x = x; sub.z = z; sub.heading = (h * Math.PI) / 180;
  assert.equal(sub.fireAt({ x: x + Math.cos(sub.heading) * 20, z: z + Math.sin(sub.heading) * 20 }), true, 'torpedo away');
  s.run(7);
  checkObjectives(s.world);
}

test('m13 hook: a torpedo through the open N lock into the bow sinks the ship (o_ship) and wakes the port (T2); a shut gate stops it', () => {
  const s = m13Sim(), w = s.world, ship = targetOf(w, 'bismarck2');
  assert.ok(ship, 'the battleship is an explosive target');
  fireTorpedo(s, 22, 60, 270);
  assert.ok(!ship.destroyed, 'the shut N gate takes the torpedo');
  assert.equal(s.get('sub').torpedoes, 1);
  w.setpieces.get('lock_n').setOpen(true);
  fireTorpedo(s, 22, 60, 270);
  assert.ok(ship.destroyed, 'bow hit: she goes down');
  assert.ok(obj(w, 'o_ship').done);
  s.run(5);
  assert.ok(s.alarms.some((a) => a.zone === 'z_dock' && a.event === 'RINT'), 'T2 raises the dock');
  assert.ok(!w.scriptFail, 'no torpedoes left, but the ship is sunk: no T7 fail');
});

test('m13 hook: aft of the bow the armour holds (T8); a remote bomb on the N quay never reaches her; no torpedoes left fails (T7)', () => {
  const s = m13Sim(), w = s.world, ship = targetOf(w, 'bismarck2'), g = w.grid;
  applyExplosion(w, 40, 28.2, 'bomb'); // a torpedo on the hull amidships
  assert.ok(!ship.destroyed, 'amidships: nothing');
  // the nearest walkable N-quay cell to the bow
  let best = null;
  for (let z = 28; z < 50; z += 0.5) for (let x = 20; x < 45; x += 0.5) {
    if (g.walkableAt(x, z) && (!best || Math.hypot(x - 21, z - 28) < best.d)) best = { x, z, d: Math.hypot(x - 21, z - 28) };
  }
  applyExplosion(w, best.x, best.z, 'bomb');
  assert.ok(!ship.destroyed, `a charge on the quay at (${best.x},${best.z}) does not sink her`);
  w.events.emit('hit', { x: 40, z: 28.2, weapon: 'torpedo', surface: 'shore', target: null });
  s.run(0.2);
  assert.ok(s.msgs.some((m) => /armour held/.test(m)), 'T8 hint');
  s.get('sub').torpedoes = 0;
  s.run(1);
  assert.ok(!w.scriptFail, 'not before the 3 s re-check');
  s.run(3);
  assert.match(String(w.scriptFail), /NO TORPEDOES LEFT/);
});

test('m13 hook: the remote bomb by the cradle takes both fuel tanks (chain) → o_fuel, and the blast raises the dock', () => {
  const s = m13Sim(), w = s.world, mk = w.markers.get('fuel_charge');
  applyExplosion(w, mk.x, mk.z, 'bomb');
  s.run(1.5);
  for (const id of ['fuel_1', 'fuel_2']) assert.ok(w.interactables.find((i) => (i.tag ?? i.id) === id)?.destroyed, `${id} destroyed`);
  checkObjectives(w);
  assert.ok(obj(w, 'o_fuel').done);
  assert.ok(s.alarms.some((a) => a.zone === 'z_dock' && a.event === 'RINT'), 'T2b');
  assert.ok(!obj(w, 'o_buoy').done, 'no escape before the ship');
});

test('m13 hook: the Panzer II is blind in its garage until RINT; then it drives out and a hit on the sub fails the mission (T4/T5)', () => {
  const s = m13Sim(), w = s.world, tank = s.get('pz2');
  for (const c of w.commandos) { c.x = 2; c.z = 186; } // out of every cone: the tank must not stop to fight
  s.run(2);
  assert.equal(tank.vision, null, 'blind before the alarm');
  assert.ok(Math.hypot(tank.x - 80, tank.z - 96.5) < 0.5, 'parked');
  w.alarm.fireEvent('RINT', { zoneId: 'z_dock', cause: 'test', x: 70, z: 60 });
  s.run(60, () => w.scriptFail);
  assert.ok(tank.z > 103, `it came out of the door (${tank.x.toFixed(1)}, ${tank.z.toFixed(1)})`);
  assert.ok(tank.vision, 'eyes open');
  assert.ok(s.get('sub').destroyed, 'the moored sub is shot up');
  assert.match(String(w.scriptFail), /TANK HAS SUNK THE MINI-SUBMARINE/);
});

test('m13 hook: the truck across the garage door keeps the tank in and the sub safe', () => {
  const s = m13Sim(), w = s.world, tank = s.get('pz2'), truck = s.get('truck');
  truck.x = 80; truck.z = 105; truck.heading = 0;
  s.run(0.5);
  w.alarm.fireEvent('RINT', { zoneId: 'z_dock', cause: 'test', x: 70, z: 60 });
  s.run(40);
  assert.ok(tank.z < 103.5 && tank.x > 74 && tank.x < 86, `still in the garage (${tank.x.toFixed(1)}, ${tank.z.toFixed(1)})`);
  assert.ok(!s.get('sub').destroyed, 'the sub is safe');
  assert.ok(!w.scriptFail, String(w.scriptFail));
  s.run(20);
  assert.ok(w.vehicles.some((v) => v.tag === 'pboat' && !v.destroyed), 'T3: the patrol boat has come in');
});

test('m13 hook: extraction — the inflatable seats all five; everyone aboard at the red buoy wins once ship and fuel are gone', () => {
  const s = m13Sim(), w = s.world, ma = s.cmd('diver');
  ma.x = 76; ma.z = 157.5;
  const raft = w.spawnVehicle('raft', { x: 76, z: 158, heading: 0 });
  raft.enter(ma);
  s.run(0.2);
  assert.equal(raft.def.seats, 5, 'm13Tick: five seats');
  for (const r of ['greenberet', 'sniper', 'sapper', 'driver']) { const c = s.cmd(r); c.x = 76; c.z = 157.5; assert.equal(raft.enter(c), true, `${r} boards`); }
  const ex = M().extraction.zone;
  raft.x = ex.x; raft.z = ex.z;
  checkObjectives(w);
  assert.ok(!obj(w, 'o_buoy').done, 'not before ship and fuel');
  for (const id of ['o_ship', 'o_fuel']) obj(w, id).done = true;
  const r = checkObjectives(w);
  assert.ok(obj(w, 'o_buoy').done && r.won, 'mission won');
});

test('m13 hook: the supply boat horns, e5 opens the S lock, the boat crosses and the gate shuts behind it; with e5 dead it waits outside', () => {
  const s = m13Sim(), w = s.world, boat = s.get('supply'), lock = w.setpieces.get('lock_s');
  s.run(40);
  assert.ok(Math.hypot(boat.x - 31, boat.z - 163) < 1.5, `T1: waiting at the gate (${boat.x.toFixed(1)}, ${boat.z.toFixed(1)})`);
  assert.equal(lock.open, false);
  s.run(12, () => lock.open);
  assert.ok(lock.open, 'e5 opens for the boat');
  s.run(30);
  assert.ok(boat.z < 135, `the boat is inside (${boat.z.toFixed(1)})`);
  s.run(20);
  assert.equal(lock.open, false, 'shut again behind it');
  // no operator: the boat never gets back out
  s.get('e5').die?.('test', null);
  s.run(70);
  assert.equal(lock.open, false, 'nobody opens it');
  assert.ok(boat.z < 135, 'the boat waits inside');
  // a commando on the lever latches it open for good
  lock.latched = true; lock.setOpen(true);
  s.run(60);
  assert.equal(lock.open, true, 'latched');
});

// ---------------------------------------------------------------- fix round (findings 2026-09-27)
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';
import { ellipseFar, pointInCone } from '../../src/ai/perception.js';
import { CONFIG } from '../../src/config.js';
import { makeVision } from '../../src/entities/enemy.js';
import { TANK_ROUTE } from '../../src/missions/m13_david_and_goliath.js';
import { inGarage } from '../../src/missions/scripts/m13.js';

/** A sim built with the game's deterministic ids (Game.loadMission resets the counter), so a save maps onto it. */
const freshSim = (o) => { Entity.nextId = 1; return m13Sim(o); };
/** Serialize a sim's world + alarm and restore it into a fresh sim (a quick load). */
function quickLoad(s) {
  const w = s.world;
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), nextId: Entity.nextId, ai: w.ai?.serialize?.() ?? null }));
  const A = JSON.parse(JSON.stringify(w.alarm.serialize()));
  const s2 = freshSim({ noStart: true }), w2 = s2.world; // Game.loadMission: a fresh world, nothing stepped yet
  restoreWorld(w2, S);
  w2.alarm.deserialize(A);
  return s2;
}

test('m13 regression: a quick load with the Marine in front of the garage door keeps the Panzer II blind (no RINT, no shot)', () => {
  const s = freshSim(), w = s.world, ma = s.cmd('diver');
  s.run(2);
  ma.x = 80.2; ma.z = 110.8; w.rebuildSpatial(); // 14 m S of the door, dead ahead of the tank's nose
  s.run(1);
  assert.equal(w.alarm.zonesFired.length, 0);
  const s2 = quickLoad(s), w2 = s2.world;
  w2._belAcc = 0; // worst case: the vehicles step before the first BEL tick installs the mission script
  const m2 = s2.cmd('diver');
  assert.ok(Math.hypot(m2.x - 80.2, m2.z - 110.8) < 0.5, 'the Marine is back in front of the door');
  for (let k = 0; k < 6; k++) s2.step();
  assert.equal(w2.alarm.zonesFired.length, 0, 'no alarm on the first steps after the load');
  // worst case (the reviewer's game saw the cone back for ~3 s): the tank's brain alone, the Marine creeping about
  const tank = s2.get('pz2'), spotted = [];
  w2.events.on('enemy:spotted', (p) => { if (p.enemy === tank) spotted.push(p); });
  if (!tank.vision) { tank.vision = makeVision('tank', tank.spawn); tank.sweepActive = true; } // the rebuilt cone, before m13Tick blanks it
  for (let k = 0; k < 180; k++) { m2.x += k % 60 < 30 ? 0.02 : -0.02; w2.rebuildSpatial(); tank.update(1 / 60); w2.time += 1 / 60; }
  assert.equal(spotted.length, 0, 'the dormant tank spots nobody');
  assert.equal(w2.alarm.zonesFired.length, 0);
  s2.run(5);
  assert.equal(w2.alarm.zonesFired.length, 0);
  assert.ok(m2.alive, 'nobody fired');
  assert.notEqual(s2.get('pz2').brain.state, 'attack');
});

/** Can a viewer at (x, z) looking `look`° with sweep amplitude `sweep`° ever see (tx, tz)? (cone geometry, no LOS) */
function everSees(x, z, look, sweep, tx, tz) {
  const V = CONFIG.stealth.vision.soldier, half = (V.fov / 2) * (Math.PI / 180);
  for (let a = -sweep; a <= sweep; a += 1) {
    const th = (a * Math.PI) / 180, far = ellipseFar(V.far, th);
    const cone = { x, z, heading: (look * Math.PI) / 180 + th, halfFov: half, near: far / 2, far };
    if (pointInCone(cone, tx, tz)) return true;
  }
  return false;
}

test('m13 regression: the 34–36 m sightlines through the intended kill order are broken (e20/e10, e19/Patrol 11, e7/e3, e8/R4)', () => {
  const e = (id) => M().enemies.find((q) => q.id === id);
  const W = CONFIG.stealth.vision.patrolWatch.sweep;
  const e10 = e('e10'), e20 = e('e20'), e3 = e('e3');
  // (a) e20 on the pontoon never sees e10's post (the Phase 2 kill)
  assert.ok(!everSees(e20.x, e20.z, 135, e20.post.sweep, e10.x, e10.z), 'e20 sees e10\'s body');
  // (b) e19's S end: Patrol 11's S turn and its rear men (Phase 3 sniper kills)
  const s19 = e('e19').route.points[1];
  for (const [x, z] of [[66, 104.9], [66, 108], [66, 107.5], [67.1, 110.3]]) {
    assert.ok(!everSees(s19.x, s19.z, s19.look, W, x, z), `e19 at his S end sees (${x},${z})`);
    assert.ok(Math.hypot(x - s19.x, z - s19.z) > CONFIG.stealth.vision.soldier.far, 'nor walking S');
  }
  // (d) e7 looking down R2 from (70,108) never sees e3's post (the Phase 1 knife)
  const p7 = e('e7').route.points[0];
  assert.ok(!everSees(p7.x, p7.z, p7.look, W, e3.x, e3.z), 'e7 sees e3\'s body');
  // ... while e3 himself still never sees the GB knifing e1 at the jetty's E end (Phase 1, first kill)
  assert.ok(!everSees(e3.x, e3.z, 270, e3.post.sweep, 71.1, 145), 'e3 sees the GB at e1');
  // (e) e8's W post never looks down onto the R4 ramp
  const p8 = e('e8').route.points[0];
  assert.ok(!everSees(p8.x, p8.z, p8.look, W, 14.7, 132.9), 'e8 sees the R4 ramp');
});

test('m13 regression: the supply boat\'s horn is routine (level 0, no guard investigates) and stops once the lock is latched', () => {
  const s = makeSim(M()), w = s.world;
  w.alarm = new Alarm(w);
  const horns = [];
  w.events.on('noise', (n) => { if (n.kind === 'horn') horns.push(n); });
  s.run(60, () => horns.length > 0);
  assert.ok(horns.length, 'the boat horns at the S lock');
  assert.equal(horns[0].level, 0);
  s.run(3);
  for (const id of ['e4', 'e5', 'e8']) assert.ok(!['INVESTIGATE', 'DECOY'].includes(s.get(id).brain.state), `${id} ${s.get(id).brain.state}`);
  const lock = w.setpieces.get('lock_s');
  lock.latched = true; lock.setOpen(true);
  horns.length = 0;
  s.run(150);
  assert.equal(horns.length, 0, 'no horn at a latched-open gate');
});

test('m13 regression: the lock gates\' own device/door events sit at the gate, not at the map origin', () => {
  const s = m13Sim(), w = s.world;
  const lock = w.setpieces.get('lock_s');
  s.events.length = 0;
  lock.setOpen(true);
  const ev = s.events.find((q) => q.name === 'device' && q.p.id === 'lock_s');
  assert.ok(ev && Math.hypot(ev.p.x - 30.75, ev.p.z - 146.5) < 0.1, `lock_s at (${ev?.p.x}, ${ev?.p.z})`);
  const n = w.setpieces.get('lock_n');
  assert.ok(Math.hypot(n.x - 23.25, n.z - 48.5) < 0.1, 'lock_n at its gate');
});

test('m13 regression (engine): a save taken right after a load, before the first tick, keeps the latched S gate', () => {
  const s = freshSim(), w = s.world, lock = w.setpieces.get('lock_s');
  lock.latched = true; lock.setOpen(true);
  s.run(0.2);
  const s2 = quickLoad(s);
  // no tick yet: save again straight away, and load that
  const again = JSON.parse(JSON.stringify(s2.world.serialize())).entities.find((d) => d.tag === 'lock_s');
  assert.ok(again && again.sp.latched === true && again.sp.open === true, JSON.stringify(again?.sp));
  const s3 = quickLoad(s2);
  s3.run(0.2);
  assert.ok(s3.world.setpieces.get('lock_s').open && s3.world.setpieces.get('lock_s').latched, 'still latched open');
});

test('m13 regression: the tank drives out of the garage before it hunts the sub; the truck starts by the garage, off its route', () => {
  const tr = M().vehicles.find((v) => v.id === 'truck');
  assert.ok(Math.hypot(tr.x - 68.5, tr.z - 104) < 2, 'truck parked by the garage (dossier (68.5,104))');
  const pg = M().vehicles.find((v) => v.id === 'pier_gun');
  assert.equal(pg.giro, 180, 'pier gun: ±90° about 112');
  const s = m13Sim(), w = s.world, tank = s.get('pz2');
  assert.equal(s.get('pier_gun').giro, 180);
  for (const c of w.commandos) { c.x = 2; c.z = 186; }
  const shots = [];
  w.events.on('vehicle:fire', (p) => { if (p.vehicle === tank && p.target?.tag === 'sub') shots.push({ x: tank.x, z: tank.z, t: w.time }); });
  s.run(1);
  const t0 = w.time;
  w.alarm.fireEvent('RINT', { zoneId: 'z_dock', cause: 'test', x: 70, z: 60 });
  s.run(90, () => w.scriptFail);
  assert.ok(shots.length, 'it hunts the sub');
  for (const q of shots) assert.ok(!inGarage(q), `fired from inside the garage at (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`);
  assert.ok(shots[0].t - t0 > 4, `first shot ${(shots[0].t - t0).toFixed(1)} s after the alarm`);
  assert.ok(Math.hypot(s.get('truck').x - tr.x, s.get('truck').z - tr.z) < 0.5, 'the tank drove round the parked truck');
  assert.equal(TANK_ROUTE[0][0], 80);
});

test('m13 regression: the shack lever latches an already-open S gate OPEN (it stood open behind the dead e5 and the lever shut it)', () => {
  const s = m13Sim(), w = s.world, lock = w.setpieces.get('lock_s'), ma = s.cmd('diver');
  lock.setOpen(true); // open for the boat
  s.get('e5').die?.('test', null); // the operator dies: nobody shuts it
  s.run(20);
  assert.equal(lock.open, true);
  const lever = s.get('lever_s');
  ma.x = lever.x; ma.z = lever.z + 0.8; w.rebuildSpatial();
  lever.interact(ma);
  s.run(2);
  assert.ok(lock.open && lock.latched, `open ${lock.open} latched ${lock.latched}`);
  lever.interact(ma); s.run(2);
  assert.equal(lock.open, false, 'a second pull shuts it (the lever still toggles once latched)');
});

// ---------------------------------------------------------------- fix round 2
import { turnTowardsAngle } from '../../src/core/math.js';

test('m13 regression: the census is Kildread\'s 10 moving + 9 isolated guards (§7.1 row 13), plus Patrol 11', () => {
  const singles = M().enemies.filter((e) => !e.squad);
  assert.equal(singles.filter((e) => e.route?.points?.length > 1).length, 10, 'walkers');
  assert.equal(singles.filter((e) => e.post && !e.route).length, 9, 'sentries');
  assert.ok(M().enemies.find((e) => e.id === 'e15').route, 'e15 is the 10th walker');
});

/** Every cone a walker shows over one leg end: the wait (look ± patrol sweep) and the turn onto the next leg. */
function legEndSees(at, look, next, tx, tz) {
  const V = CONFIG.stealth.vision.soldier, half = (V.fov / 2) * (Math.PI / 180), D = Math.PI / 180;
  const cone = (h, th) => { const far = ellipseFar(V.far, th); return { x: at.x, z: at.z, heading: h + th, halfFov: half, near: far / 2, far }; };
  const W = CONFIG.stealth.vision.patrolWatch.sweep;
  for (let a = -W; a <= W; a += 1) if (pointInCone(cone(look * D, a * D), tx, tz)) return 'wait';
  let h = look * D; const out = Math.atan2(next.z - at.z, next.x - at.x);
  for (let i = 0; i < 300; i++) { h = turnTowardsAngle(h, out, CONFIG.units.enemyTurnRate * 0.01); if (pointInCone(cone(h, 0), tx, tz)) return 'turn'; }
  return null;
}

test('m13 regression: e14 turning N at his S end never sweeps the e19 kill spot (turned through the E with look 90)', () => {
  const [n14, s14] = M().enemies.find((e) => e.id === 'e14').route.points;
  // the GB's approach behind e19, the knife spots and e19's body at his S end (replay: GB seen at (63.7,66.8))
  for (const [x, z] of [[63.7, 66.8], [65.5, 65.5], [66.5, 64.4], [62.5, 67.3], [62.5, 68], [64.5, 66.5]]) {
    for (const [dx, dz] of [[0, 0], [0.2, -0.3], [-0.2, 0.2]]) { // he stops within 0.3 m of the waypoint
      const at = { x: s14.x + dx, z: s14.z + dz };
      assert.equal(legEndSees(at, s14.look, n14, x, z), null, `e14 at (${at.x},${at.z}) sees (${x},${z})`);
    }
  }
  // the old look 90 did (the bug this guards)
  assert.equal(legEndSees(s14, 90, n14, 63.7, 66.8), 'turn');
});

test('m13 regression: e15\'s beat never turns him S onto the sub pad, the e19 kill spot or the Sniper\'s Phase 4 spot', () => {
  const [a, b] = M().enemies.find((e) => e.id === 'e15').route.points;
  const V = CONFIG.stealth.vision.soldier, half = (V.fov / 2) * (Math.PI / 180);
  for (const [x, z] of [[61.5, 53.5], [61.5, 59], [63.7, 66.8], [55, 68], [62, 62]]) { // (walking E he does face row_s's E end, where the GB waits before e17)
    assert.equal(legEndSees(a, a.look, b, x, z), null, `at the E end he sees (${x},${z})`);
    assert.equal(legEndSees(b, b.look, a, x, z), null, `at the W end he sees (${x},${z})`);
    for (const [p, q] of [[a, b], [b, a]]) { // walking: heading along the leg, no sweep
      const h = Math.atan2(q.z - p.z, q.x - p.x);
      for (let k = 0; k <= 10; k++) {
        const c = { x: p.x + ((q.x - p.x) * k) / 10, z: p.z + ((q.z - p.z) * k) / 10, heading: h, halfFov: half, near: V.far / 2, far: V.far };
        assert.ok(!pointInCone(c, x, z), `walking he sees (${x},${z})`);
      }
    }
  }
});
