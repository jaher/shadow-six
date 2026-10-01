/**
 * BEL M9 "A Courtesy Call" (docs/missions/m09.md): schema + §10.5 test #14, the walls / gates / climb spot, the
 * whole-map zone, the census, the dormant Panzers (D1) and their drive-out (D1b), the tanker-at-the-shed case
 * end to end (D3), objective wiring (barrel pile → both centre houses, one bomb → radio hut + aerial, bunker
 * falls to a barrel) and the lorry extraction (15 s after o1–o5, tainted, pz1 hunts it).
 * Run with the unit suite: node tests/unit/run.mjs m09
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';

const M = () => getMission('m09');
const path = (g, a, b, role) => findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000 });
const len = (p) => p.reduce((s, q, k) => (k ? s + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);

test('m09: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.title, 'A Courtesy Call');
  assert.equal(m.theater, 'desert');
  assert.equal(m.coneColors, 'desert');
  assert.deepEqual(m.size, [103, 122]);
  assert.equal(m.par.time, 540);
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m09: §3.8 row 9 loadout exactly; the Spy starts in uniform; 4 drums and the fuel tanker on site', () => {
  const L = belLoadout(9);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('sniper', M().commandos[1].inventory).sniperRifle, 5);
  assert.deepEqual(M().startDisguised, ['spy']);
  const loose = M().structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel' && s.carriable);
  assert.equal(loose.length, L.site.barrels, 'four loose explosive drums');
  assert.equal(M().structures.find((s) => s.id === 'drums_y').explosive, undefined, 'the yellow drum stack is not explosive');
  const tanker = M().vehicles.find((v) => v.id === 'tanker');
  assert.equal(tanker.vehicleType, 'opel_blitz_tanker');
  assert.deepEqual(tanker.operators, ['driver']);
});

test('m09: §10.5 #14 — loads; starts reach every objective and the lorry; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M()), []);
});

test('m09: enemy census matches Kildread/Prima (4 walkers, 5 sentries, 3 patrols of 3, 3 Panzer IVs, 1 garrison)', () => {
  const m = M();
  const singles = m.enemies.filter((e) => !e.squad);
  assert.equal(singles.filter((e) => e.route).length, 4, 'walkers');
  assert.equal(singles.filter((e) => !e.route).length, 5, 'sentries');
  assert.deepEqual(singles.map((e) => e.prima).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const squads = {};
  for (const e of m.enemies.filter((x) => x.squad)) (squads[e.squad.id] ||= []).push(e);
  assert.deepEqual(Object.keys(squads).sort(), ['pt_nw', 'pt_se', 'pt_yard']);
  for (const [id, men] of Object.entries(squads)) {
    assert.equal(men.length, 3, id);
    assert.ok(men.every((e) => e.reactEvents?.includes('RINT') && e.alarmRoute?.run), `${id} reacts to RINT`);
  }
  const tanks = m.vehicles.filter((v) => v.vehicleType === 'panzer4');
  assert.equal(tanks.length, 3);
  assert.ok(tanks.every((t) => t.crew.length === 2 && t.driveable === false));
  assert.deepEqual(Object.keys(m.barracks), ['barr']);
  assert.equal(m.barracks.barr.pool, 10);
  assert.deepEqual(m.barracks.barr.squads.map((s) => [s.event, s.size]), [['RINT', 4]]);
});

test('m09: walls and gates — the forecourt is shut from the S except by gate_s or the GB stub; the yard by gap_s', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  const GB = { x: 49.5, z: 105 }, FORE = { x: 36, z: 86 }, YARD = { x: 58, z: 48 };
  const links = g.links;
  links.forEach((l) => g.setLinkEnabled(l.id, false));
  // gate_s closed, no climb: the only way into the forecourt is the long way round (W opening or E gate)
  const round = path(g, GB, FORE, 'sniper');
  assert.ok(round && len(round) > 45, `long way round (${round && len(round).toFixed(0)} m)`);
  // the GB's climb over the broken stub
  links.forEach((l) => g.setLinkEnabled(l.id, true));
  const climb = path(g, GB, FORE, 'greenberet');
  assert.ok(climb && len(climb) < 25, `the GB climbs the stub (${climb && len(climb).toFixed(0)} m)`);
  assert.ok(M().climbLinks.every((l) => l.roles.join() === 'greenberet'));
  // gate_s opened: everyone walks straight in
  const gate = ctx.handle.structures.get('gate_s');
  g.clearOwner(gate.owner);
  const walk = path(g, GB, FORE, 'sniper');
  assert.ok(walk && len(walk) < 25, `through gate_s (${walk && len(walk).toFixed(0)} m)`);
  // forecourt → yard through the inner S gap
  assert.ok(path(g, FORE, YARD, 'sniper'), 'forecourt to yard');
  // the barracks terrace (y 4) only by its outside stairs
  assert.ok(Math.abs(g.elevAt(87, 52.5) - 4) < 0.01, 'barracks terrace at 4 m');
  assert.ok(path(g, YARD, { x: 87, z: 52.5 }, 'sniper'), 'up the stairs');
  links.forEach((l) => g.setLinkEnabled(l.id, false));
  assert.equal(path(g, YARD, { x: 87, z: 52.5 }, 'sniper'), null, 'no other way up');
  links.forEach((l) => g.setLinkEnabled(l.id, true));
});

test('m09: one alarm zone over the whole map, seen or heard → RINT; no alarm failure', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const [x, z] of [[49.5, 105], [58.5, 2.5], [50, 50], [102, 121], [16, 95]]) assert.equal(a.zoneAt(x, z)?.id, 'z_all', `(${x},${z})`);
  assert.equal(M().zones.length, 1);
  assert.equal(M().zones[0].onSeen, 'RINT');
  assert.equal(M().zones[0].onHeard, 'RINT');
  assert.equal(M().alarmFail ?? null, null);
});

/** Full M9 sim with the alarm and the objectives, stepped like Game.step (the director runs the script). */
function m09Sim(brains = false) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  s.flags = {};
  s.evac = () => updateExtractionVehicle(w, s.flags);
  return s;
}
const ent = (w, id) => w.byId(id);
const gone = (e) => !e || e.removed || e.destroyed || e.exploded || e.alive === false;
const objDone = (w, id) => w.objectives.find((o) => o.id === id).done;
const TANKS = ['pz1', 'pz2', 'pz3'];
const raise = (w) => w.alarm.raise('z_all', 'seen', 50, 50, { sensor: 'seen' });
/** Park the tanker across the bay fronts (the Driver's job, §11 step 11). */
function parkAtShed(w) { const t = ent(w, 'tanker'); t.x = 25.5; t.z = 26.5; t.heading = -Math.PI / 4; w.rebuildSpatial(); return t; }

test('m09 hook: the Panzers are dormant before the alarm — no cone, no fire, even at a commando in front of the shed', () => {
  const s = m09Sim(), w = s.world;
  const dr = s.cmd('driver');
  dr.x = 30; dr.z = 32; // 10 m in front of pz2's bay, in the open
  s.run(5);
  for (const id of TANKS) {
    const v = ent(w, id);
    assert.equal(v.vision, null, `${id} has no cone`);
    assert.ok(!v.destroyed && v.crewed, `${id} crewed`);
    assert.ok(Math.hypot(v.x - v.spawn.x, v.z - v.spawn.z) < 0.1, `${id} still in its bay`);
  }
  assert.ok(dr.alive, 'nobody fired');
  assert.equal(s.count('shot'), 0);
  assert.equal(w.alarm.zonesFired.length, 0);
});

test('m09 hook (D1/D1b): the alarm wakes the tanks — cones live, they drive out along their routes and stand there', () => {
  const s = m09Sim(), w = s.world;
  s.run(0.5);
  raise(w);
  s.run(45);
  const ends = { pz1: [22, 92], pz2: [52, 62], pz3: [70, 40] };
  for (const id of TANKS) {
    const v = ent(w, id);
    assert.ok(v.vision, `${id} cone live`);
    assert.ok(!v.destroyed, `${id} intact`);
    const [x, z] = ends[id];
    assert.ok(Math.hypot(v.x - x, v.z - z) < 2.5, `${id} at its post (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  }
  assert.ok(!ent(w, 'tanker').destroyed, 'the tanker by the bunker is left alone');
});

test('m09 hook (D3): tanker parked across the shed front + alarm → the tanks shoot it and all three are wrecked', () => {
  const s = m09Sim(), w = s.world;
  s.run(0.5);
  parkAtShed(w);
  raise(w);
  s.run(5, () => TANKS.every((id) => ent(w, id).destroyed));
  assert.ok(ent(w, 'tanker').destroyed, 'tanker exploded');
  for (const id of TANKS) assert.ok(ent(w, id).destroyed, `${id} wrecked`);
  // no tank got out of its bay
  for (const id of TANKS) { const v = ent(w, id); assert.ok(Math.hypot(v.x - v.spawn.x, v.z - v.spawn.z) < 4, `${id} died in the shed`); }
});

test('m09 hook: the drum pile between the centre houses takes the weapons store and the command post (o3, o4)', () => {
  const s = m09Sim(), w = s.world;
  ent(w, 'brl1').ignite(0, s.cmd('spy'));
  s.run(3);
  for (const id of ['brl1', 'brl2', 'brl3', 'brl4']) assert.ok(gone(ent(w, id)), `${id} went up`);
  checkObjectives(w);
  assert.ok(objDone(w, 'o3') && objDone(w, 'o4'), 'both centre houses');
  for (const id of ['o1', 'o2', 'o5']) assert.ok(!objDone(w, id), `${id} untouched`);
  assert.ok(w.alarm.zonesFired.length > 0, 'the blast is heard map-wide → RINT');
});

test('m09 hook: one bomb at the cable midpoint takes the radio hut and the aerial; a drum by the bunker razes it', () => {
  const s = m09Sim(), w = s.world;
  applyExplosion(w, 75, 75, 'bomb', s.cmd('sapper'));
  s.run(0.5);
  checkObjectives(w);
  assert.ok(objDone(w, 'o1') && objDone(w, 'o2'), 'radio hut + aerial');
  // Kildread: the bunker is sandbags and thatch — a barrel (or the tanker) is enough (bombOnly:false)
  const b = ent(w, 'brl3'); b.x = 18.5; b.z = 45.8; w.rebuildSpatial();
  b.ignite(0, s.cmd('greenberet'));
  s.run(2);
  checkObjectives(w);
  assert.ok(objDone(w, 'o5'), 'bunker');
  assert.ok(!objDone(w, 'o3'), 'the carried drum left the pile');
});

test('m09 hook: a bomb at the barracks door razes the garrison — it releases nobody', () => {
  const s = m09Sim(), w = s.world;
  applyExplosion(w, 87, 61.5, 'bomb', s.cmd('sapper'));
  s.run(0.5);
  assert.ok(gone(ent(w, 'barr')) || w.structures.get('barr')?.destroyed || [...w.interactables].find((i) => i.tag === 'barr')?.destroyed, 'barracks razed');
  let squads = 0;
  w.events.on('reinforcements', () => squads++);
  const before = w.enemies.length;
  s.run(10);
  assert.ok(w.alarm.zonesFired.length > 0, 'the blast raised the alarm');
  assert.equal(squads, 0, 'no squad released');
  assert.ok(w.enemies.length <= before, 'nobody came out');
  // control: the alarm with the barracks standing releases its squad of 4
  const s2 = m09Sim(), w2 = s2.world;
  let out = [];
  w2.events.on('reinforcements', (p) => { out = out.concat(p.units || []); });
  raise(w2);
  s2.run(3);
  assert.equal(out.length, 4, 'a squad of four');
});

/** o1–o5 done (targets down), the forecourt and the outside patrols cleared as in §11. */
function doneSim() {
  const s = m09Sim(), w = s.world;
  for (const id of ['o1', 'o2', 'o3', 'o4', 'o5']) Object.assign(w.objectives.find((o) => o.id === id), { done: true });
  for (const e of w.enemies.filter((x) => ['e1', 'e2', 'e3'].includes(x.tag) || /^pt_(nw|se)/.test(x.tag))) e.die('test', null);
  return s;
}

test('m09 hook: our lorry is called 15 s after o1–o5 (not before), comes in on the W road, parks at (16,95), tainted', () => {
  const s = doneSim(), w = s.world;
  s.run(14, () => !!s.evac());
  assert.equal(w.byId('evac'), null, 'no lorry before 15 s');
  assert.equal(w.objectives.find((o) => o.id === 'o6').hidden, true);
  s.run(20, () => { s.evac(); return s.flags.evacPhase === 'wait'; });
  const evac = w.byId('evac');
  assert.ok(evac && !evac.destroyed, 'lorry on the map');
  assert.ok(objDone(w, 'o_ready'));
  assert.equal(w.objectives.find((o) => o.id === 'o6').hidden, false, 'o6 shown');
  assert.ok(Math.hypot(evac.x - 16, evac.z - 95) < 3, `waits at (16,95): (${evac.x.toFixed(1)},${evac.z.toFixed(1)})`);
  s.run(0.5);
  assert.ok(evac.tainted, 'fair game for the enemy (T3)');
  // everyone aboard → it drives W off the map and o6 completes
  for (const c of w.commandos) { c.x = evac.x - 2; c.z = evac.z + 2; assert.ok(evac.enter(c), `${c.role} boards`); }
  s.run(30, () => { s.evac(); checkObjectives(w); return objDone(w, 'o6'); });
  assert.ok(objDone(w, 'o6'), 'escaped');
  assert.ok(w.objectives.filter((o) => o.required).every((o) => o.done), 'mission won');
});

test('m09 hook: after the alarm pz1 drives to the pick-up point and destroys our lorry (the mission is lost) [DE]', () => {
  const s = doneSim(), w = s.world;
  s.run(0.5);
  raise(w);
  s.run(90, () => { s.evac(); return !!w.byId('evac')?.destroyed; });
  assert.ok(w.byId('evac')?.destroyed, 'pz1 kills the lorry');
  // with the armour wrecked in the shed first (tanker trick), the lorry survives the same wait
  const s2 = doneSim(), w2 = s2.world;
  s2.run(0.5);
  parkAtShed(w2);
  raise(w2);
  s2.run(40, () => { s2.evac(); return s2.flags.evacPhase === 'wait'; });
  s2.run(20);
  assert.ok(TANKS.every((id) => ent(w2, id).destroyed), 'armour wrecked');
  assert.ok(w2.byId('evac') && !w2.byId('evac').destroyed, 'the lorry waits unharmed');
});

// ---------------------------------------------------------------- fix round (findings 2026-09-27)
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';

/** A commando standing in pz2's (and pz1's) cone once the tanks are awake: in front of the shed, 18 m out. */
const IN_CONE = { x: 29, z: 40 };

test('m09 regression: the dormant Panzers see nothing before the script\'s first BEL tick (vehicle brains run first)', () => {
  const s = m09Sim(), w = s.world, dr = s.cmd('driver');
  dr.x = IN_CONE.x; dr.z = IN_CONE.z; w.rebuildSpatial();
  // Game.step runs the vehicles before the first BEL tick installs the mission script: the brain itself must sleep
  for (let k = 0; k < 3; k++) for (const id of TANKS) ent(w, id).update(1 / 60);
  assert.equal(w.alarm.zonesFired.length, 0, 'no alarm from a sleeping tank');
  for (const id of TANKS) assert.equal(ent(w, id).brain.state, 'parked', `${id} did not attack`);
  s.run(3);
  assert.equal(w.alarm.zonesFired.length, 0);
  assert.ok(dr.alive && !ent(w, 'tanker').destroyed);
});

test('m09 regression: a quick load with a commando in a tank cone keeps the Panzers asleep (no alarm, no shot)', () => {
  const s = m09Sim(), w = s.world, dr = s.cmd('driver');
  s.run(2);
  dr.x = IN_CONE.x; dr.z = IN_CONE.z;
  s.run(1);
  assert.equal(w.alarm.zonesFired.length, 0);
  const S = JSON.parse(JSON.stringify({ ...w.serialize(), nextId: Entity.nextId, ai: w.ai?.serialize?.() ?? null }));
  const A = JSON.parse(JSON.stringify(w.alarm.serialize()));
  const s2 = m09Sim(), w2 = s2.world;
  restoreWorld(w2, S);
  w2.alarm.deserialize(A);
  w2._belAcc = 0; // worst case: the first two steps after the load run the vehicles before any BEL tick
  const d2 = s2.cmd('driver');
  assert.ok(Math.hypot(d2.x - IN_CONE.x, d2.z - IN_CONE.z) < 0.5, 'the Driver is back in the cone');
  for (let k = 0; k < 6; k++) s2.step();
  assert.equal(w2.alarm.zonesFired.length, 0, 'no alarm on the first steps after the load');
  s2.run(3);
  assert.equal(w2.alarm.zonesFired.length, 0);
  assert.ok(d2.alive && !ent(w2, 'tanker').destroyed, 'nobody fired');
  for (const id of TANKS) assert.equal(ent(w2, id).vision, null, `${id} asleep again`);
});

test('m09 regression: on RINT pt_nw runs S down the W side past the lorry spot and pt_se in over the trap — a blast does not turn them aside', () => {
  const s = m09Sim(true), w = s.world;
  for (const c of [...w.commandos]) w.remove(c); // nobody to see: the test is about the run itself
  w.flushRemovals();
  s.run(1);
  w.alarm.raise('z_all', 'heard', 18.5, 46, { sensor: 'heard' });
  w.events.emit('noise', { x: 18.5, z: 46, radius: 80, kind: 'explosion', level: 3 }); // the bunker bomb
  const best = { nw: Infinity, se: Infinity }, states = new Set();
  s.run(50, () => {
    const a = ent(w, 'pt_nwa'), b = ent(w, 'pt_sea');
    best.nw = Math.min(best.nw, Math.hypot(a.x - 12, a.z - 91));
    best.se = Math.min(best.se, Math.hypot(b.x - 75.2, b.z - 30.8));
    states.add(a.brain.state).add(b.brain.state);
    if (w.time > 20 && !best.second) { best.second = true; w.events.emit('noise', { x: 70.5, z: 79.5, radius: 80, kind: 'explosion', level: 3 }); } // a 2nd blast mid-run
    return false;
  });
  assert.ok(!states.has('INVESTIGATE'), `no INVESTIGATE on the run (${[...states]})`);
  assert.ok(best.nw < 3, `pt_nw passes the lorry's parking spot (min ${best.nw.toFixed(1)} m from (12,91))`);
  assert.ok(best.se < 2, `pt_se crosses the trap point in gate_e (min ${best.se.toFixed(1)} m)`);
});

test('m09 regression: pz1 shelling our lorry loses with "YOU NO LONGER HAVE AN ESCAPE VEHICLE."; our own blast names the truck', () => {
  const s = doneSim(), w = s.world;
  s.run(0.5);
  raise(w);
  s.run(90, () => { s.evac(); return !!w.byId('evac')?.destroyed; });
  assert.ok(w.byId('evac')?.destroyed, 'pz1 kills the lorry');
  s.run(0.2);
  assert.equal(w.scriptFail, 'YOU NO LONGER HAVE AN ESCAPE VEHICLE.');
  const s2 = doneSim(), w2 = s2.world;
  s2.run(20, () => { s2.evac(); return s2.flags.evacPhase === 'wait'; });
  const evac = w2.byId('evac');
  assert.ok(evac && !evac.destroyed);
  evac.destroy(s2.cmd('sapper'), 'bomb');
  s2.run(0.2);
  assert.equal(w2.scriptFail, 'YOU DESTROYED THE TRUCK, BUT YOU NEEDED IT TO ESCAPE.');
});

test('m09 regression: the tanker parked ~1 m short of the shed-front spot (a plain move order) still takes all three Panzers', () => {
  const s = m09Sim(), w = s.world;
  s.run(0.5);
  const t = ent(w, 'tanker'); t.x = 24.9; t.z = 27.4; t.heading = -Math.PI / 4; w.rebuildSpatial();
  assert.ok(Math.hypot(ent(w, 'pz3').x - t.x, ent(w, 'pz3').z - t.z) > 9.5, 'pz3 is > 9.5 m away (the old 9 m radius missed it)');
  raise(w);
  s.run(10, () => TANKS.every((id) => ent(w, id).destroyed));
  assert.ok(t.destroyed, 'tanker shot');
  for (const id of TANKS) assert.ok(ent(w, id).destroyed, `${id} wrecked`);
  // at its own place by the bunker the tanker's fireball reaches no Panzer in its bay
  const s2 = m09Sim(), w2 = s2.world;
  s2.run(0.5);
  ent(w2, 'tanker').destroy(s2.cmd('sniper'), 'shot');
  s2.run(0.5);
  for (const id of TANKS) assert.ok(!ent(w2, id).destroyed, `${id} untouched by the bunker-side blast`);
});

test('m09 regression: the five hideout doors stand at the dossier §5.1 door points, not at the map origin', () => {
  const ctx = loadGrid(M());
  const doors = [...(ctx.world.entities?.values?.() ?? ctx.world.entities)].filter((i) => i.interactKind === 'door' && i.params?.enterable);
  const want = { wstore: [52, 47.3], cp: [65, 62], house_n1: [48.5, 17], house_n2: [54.5, 24.5], house_ne: [61, 28] };
  for (const [id, [x, z]] of Object.entries(want)) {
    const d = doors.find((i) => i.params.structure?.id === id), s = d?.params.structure;
    assert.ok(d, `${id}: door spawned`);
    assert.ok(Math.hypot(d.x - x, d.z - z) < 0.01, `${id}: door at (${d.x},${d.z})`);
    const off = Math.hypot(Math.max(Math.abs(d.x - s.x) - s.w / 2, 0), Math.max(Math.abs(d.z - s.z) - s.d / 2, 0));
    assert.ok(off <= 1.0, `${id}: door within 1 m of its footprint (${off.toFixed(2)})`);
  }
});
