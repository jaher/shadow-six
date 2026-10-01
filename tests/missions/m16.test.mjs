/**
 * BEL M16 "Stop Wildfire" (docs/missions/m16.md): schema + §10.5 test #14, the bridge (walkers stay on the deck,
 * swimmers pass under, the island only by water), the exact §3.8 loadout, the Kildread census, the one-zone
 * alarm, the engineers (siren → all run; arrival → DETONATE → loss; a lorry over a plunger strands its man),
 * the objectives and the lorry extraction by the S road (§10).
 * Run with the unit suite: node tests/unit/run.mjs m16
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { createObjectives, checkObjectives, updateExtractionVehicle, skipExtractionDrive } from '../../src/core/objectives.js';
import { DETONATORS, SAPPERS, coveringVehicle } from '../../src/missions/scripts/m16.js';
import { ABILITIES } from '../../src/abilities/index.js';

const M = () => getMission('m16');
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
const at = (id) => { const e = M().enemies.find((q) => q.id === id); return { x: e.x, z: e.z }; };

test('m16: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [201, 150]);
  assert.equal(m.par.time, 720);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.coneColors, 'green');
  assert.deepEqual(m.startDisguised, []);
});

test('m16: §10.5 #14 — loads; every start reaches every target and the lorry; no start in a cone; routes walkable', () => {
  // kill targets are men, not structures: checkMission cannot place them, so they are checked by hand below
  const probs = checkMission(M()).filter((p) => !/^objective target e1[4-7] has no walkable approach$/.test(p));
  assert.deepEqual(probs, []);
  const g = loadGrid(M()).grid;
  for (const c of M().commandos) {
    const swim = c.role === 'diver';
    for (const id of ['e14', 'e15']) assert.ok(reach(g, c, at(id), c.role, { swim }), `${c.role} reaches ${id}`);
    assert.ok(reach(g, c, { x: 97, z: 133.5 }, c.role, { swim }), `${c.role} reaches the lorry`);
  }
  const ma = M().commandos.find((c) => c.role === 'diver');
  for (const id of ['e16', 'e17']) assert.ok(reach(g, ma, at(id), 'diver', { swim: true }), `the Marine swims to ${id}`);
  assert.ok(reach(g, { x: 194, z: 11 }, { x: 37.5, z: 71.5 }, 'spy'), 'the Spy walks over the bridge to his hide under the W end');
  assert.ok(reach(g, { x: 194, z: 11 }, { x: 196, z: 101 }, 'spy'), 'and to the clothesline');
});

test('m16: the bridge — walkers keep to the deck, swimmers pass under it, the island is reached only by water', () => {
  const g = loadGrid(M()).grid;
  const deckMid = { x: 58.6, z: 81.25 }, island = at('e16');
  assert.ok(g.walkableAt(deckMid.x, deckMid.z), 'deck over the water is walkable');
  assert.ok(reach(g, { x: 30, z: 74 }, { x: 100, z: 117 }, 'spy'), 'W bank → E bank over the deck');
  assert.ok(!reach(g, deckMid, island, 'spy'), 'no stepping off the deck onto the island');
  assert.ok(!reach(g, island, deckMid, 'spy'), 'the island sappers cannot climb onto the deck');
  assert.ok(!reach(g, { x: 30, z: 74 }, island, 'spy'), 'no walking to the island');
  assert.ok(reach(g, { x: 112, z: 68 }, { x: 51, z: 83.5 }, 'diver', { swim: true }), 'Marine: E beach → the island inlet, under the spans');
  // every sapper can run to his plunger; run times (4.5 m/s) as in the dossier §8.4
  const run = (id, pt) => {
    const p = findPath(g, pt.x, pt.z, DETONATORS[M().enemies.find((e) => e.id === id).plunger].x,
      DETONATORS[M().enemies.find((e) => e.id === id).plunger].z, { maxNodes: 400000 });
    assert.ok(p, `${id} reaches his plunger`);
    return p.reduce((a, q, k) => (k ? a + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0) / 4.5;
  };
  for (const id of SAPPERS) {
    const e = M().enemies.find((q) => q.id === id);
    for (const pt of e.route ? e.route.points : [e]) { const t = run(id, pt); assert.ok(t > 0.5 && t < 5, `${id} run ${t.toFixed(1)} s`); }
  }
  assert.equal(M().enemies.find((e) => e.id === 'e16').plunger, M().enemies.find((e) => e.id === 'e17').plunger, 'the island pair share D_I');
});

test('m16: §3.8 row 16 loadout exactly (Sniper 5 rounds, Marine with diving gear, Spy medic without the uniform)', () => {
  const L = belLoadout(16);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('sniper', M().commandos[0].inventory).sniperRifle, 5);
  const truck = M().vehicles.find((v) => v.id === 'truck');
  assert.deepEqual(truck.operators, ['spy'], 'only the Spy drives the lorry');
  assert.ok(M().interactables.some((i) => i.interactKind === 'clothesline'), 'the uniform hangs on site');
  assert.ok(!M().commandos.some((c) => c.inventory.uniform), 'nobody starts with it');
});

test('m16: enemy census = Kildread (14 walkers, 16 sentries, 21 men in 5 patrols, 2 bunkers, 4 sappers, 3 garrisons)', () => {
  const es = M().enemies;
  assert.equal(es.length, 57);
  assert.equal(es.filter((e) => e.soldierType === 'soldier' && e.route && !e.squad).length, 14);
  assert.equal(es.filter((e) => e.soldierType === 'sentry').length, 16);
  const squads = {};
  for (const e of es.filter((q) => q.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(Object.values(squads).sort(), [3, 4, 4, 5, 5]);
  assert.deepEqual(es.filter((e) => e.structure).map((e) => e.structure).sort(), ['pb_e', 'pb_w']);
  assert.deepEqual(es.filter((e) => e.soldierType === 'engineer').map((e) => e.id), SAPPERS);
  for (const id of SAPPERS) { const e = es.find((q) => q.id === id); assert.equal(e.onArrive, 'DETONATE'); assert.ok(e.detonator); }
  assert.deepEqual(Object.keys(M().barracks).sort(), ['hut_fields', 'nw_grey', 'station']);
});

test('m16: one silent zone over the whole map (seen or heard → siren); DETONATE is the alarm-fail', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const [x, z] of [[1, 1], [200, 1], [100, 75], [1, 149], [200, 149]]) assert.equal(a.zoneAt(x, z)?.id, 'z_all');
  assert.equal(M().zones.length, 1);
  assert.equal(M().zones[0].onSeen, 'RINT');
  assert.equal(M().zones[0].onHeard, 'RINT');
  assert.deepEqual(M().alarmFail.events, ['DETONATE']);
  const o = Object.fromEntries(M().objectives.map((q) => [q.id, q]));
  assert.deepEqual(o.o1.targets, SAPPERS);
  assert.equal(o.o1.type, 'kill');
  assert.equal(o.o2.type, 'escape');
  assert.equal(o.o2.vehicleId, 'truck');
  assert.deepEqual(M().extraction.spawnWhen, ['o1']);
});

/** Full M16 sim with live brains, the alarm and the objectives (the director runs the triggers). */
function m16Sim() {
  const s = makeSim(M(), { brains: true });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.flags = {};
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  w.objectives = createObjectives(s.mission.objectives);
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  // park the team out of every cone, far from everything (the NE corner of the wood)
  for (const c of w.commandos) { c.x = 199; c.z = 2; }
  s.run(0.1);
  return s;
}
const siren = (w) => w.alarm.fireEvent('RINT', { zoneId: 'z_all', cause: 'test', x: 20, z: 20 });

test('m16 hook: the siren sends all four sappers running; the first to reach his plunger blows the bridge', () => {
  const s = m16Sim(), w = s.world;
  s.run(2);
  assert.ok(!w.scriptFail, `quiet start (${w.scriptFail})`);
  siren(w);
  s.run(0.2);
  for (const id of SAPPERS) assert.equal(s.get(id).brain.state, 'ALARM_RUN', `${id} runs`);
  s.run(8, () => !!w.scriptFail);
  assert.match(String(w.scriptFail), /BRIDGE HAS BEEN BLOWN/);
});

test('m16 hook: a sapper stopped short never fires from afar (arrival only, dossier §14 #1)', () => {
  const s = m16Sim(), w = s.world;
  for (const id of ['e14', 'e16', 'e17']) s.get(id).die('test', null);
  const e15 = s.get('e15');
  siren(w);
  s.run(0.2);
  e15.stop();
  s.run(1);
  assert.ok(!w.scriptFail, 'no detonation 1 s after stopping mid-run');
  s.run(12, () => !!w.scriptFail);
  assert.match(String(w.scriptFail), /BRIDGE HAS BEEN BLOWN/, 'he re-paths and gets there');
  assert.ok(Math.hypot(e15.x - DETONATORS.D_E.x, e15.z - DETONATORS.D_E.z) < 1.5, 'fired at the plunger');
});

test('m16 hook: the lorry parked over the E-deck plunger strands e15 against its hull ([DE][fd])', () => {
  const s = m16Sim(), w = s.world, truck = s.get('truck'), e15 = s.get('e15');
  for (const id of ['e14', 'e16', 'e17']) s.get(id).die('test', null);
  truck.x = DETONATORS.D_E.x; truck.z = DETONATORS.D_E.z; truck.heading = (39.6 * Math.PI) / 180;
  s.run(0.2);
  assert.equal(coveringVehicle(w, DETONATORS.D_E.x, DETONATORS.D_E.z), truck);
  siren(w);
  s.run(25);
  assert.ok(!w.scriptFail, String(w.scriptFail));
  assert.equal(e15.brain.state, 'ALARM_RUN', 'still trying');
  assert.ok(Math.hypot(e15.x - DETONATORS.D_E.x, e15.z - DETONATORS.D_E.z) > 1.2, 'stuck at the hull');
  e15.die('test', null);
  s.run(0.5);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done, 'o1: all four dead');
  assert.ok(s.msgs.some((m) => /bridge is safe/.test(m)), 'T5');
});

test('m16 hook: with the four dead an alarm is survivable; everyone in the lorry = the win at boarding (§10.2), then the drive-off', () => {
  const s = m16Sim(), w = s.world, truck = s.get('truck');
  for (const id of SAPPERS) s.get(id).die('test', null);
  s.run(0.5);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done);
  siren(w);
  s.run(1);
  assert.ok(!w.scriptFail, 'no failure after o1');
  // park the lorry on the bridge deck (a far-bank boarding) and load the team there
  truck.x = 80; truck.z = 99; truck.heading = (39.6 * Math.PI) / 180;
  for (const c of w.commandos) { c.x = 78; c.z = 97; }
  const spy = s.cmd('spy');
  assert.equal(truck.enter(spy), true, 'the Spy drives');
  for (const r of ['sniper', 'diver']) assert.equal(truck.enter(s.cmd(r)), true, `${r} boards`);
  s.run(0.5);
  assert.equal(s.flags.evacPhase, 'leave', 'drive-off started');
  assert.ok(truck._m16Routed, 'the drive-off is path-found');
  assert.ok(w.objectives.find((o) => o.id === 'o2').done, 'won at boarding, before the lorry has gone anywhere');
  const x0 = truck.x, z0 = truck.z;
  s.run(3);
  assert.ok(Math.hypot(truck.x - x0, truck.z - z0) > 3, 'and it still drives off (scenery)');
});

test('m16 fix: the win never depends on the drive-off — alerted patrols on the road cannot turn it into a loss', () => {
  const s = m16Sim(), w = s.world, truck = s.get('truck');
  for (const id of SAPPERS) s.get(id).die('test', null);
  s.run(0.5);
  siren(w);
  s.run(1);
  for (const c of w.commandos) { c.x = truck.x; c.z = truck.z + 2; assert.equal(truck.enter(c), true); }
  s.run(0.3);
  assert.ok(w.objectives.find((o) => o.id === 'o2').done, 'o2 at boarding');
  truck.destroy?.(null, 'test'); // the drive-off runs into P25/P26 and the lorry is shot to pieces
  s.run(0.5);
  assert.ok(!w.scriptFail, `no T4 loss after the win (${w.scriptFail})`);
  assert.ok(w.objectives.filter((o) => o.required).every((o) => o.done), 'still won');
});

test('m16 hook: boarding before o1 does nothing; the lorry destroyed is a loss (T4)', () => {
  const s = m16Sim(), w = s.world, truck = s.get('truck');
  truck.x = 196; truck.z = 4; // out of every cone (Patrol 25 walks past the lorry's N side)
  for (const c of w.commandos) { c.x = truck.x; c.z = truck.z - 2; truck.enter(c); }
  s.run(1);
  assert.notEqual(s.flags.evacPhase, 'leave');
  assert.ok(!w.objectives.find((o) => o.id === 'o2').done);
  assert.ok(s.msgs.some((m) => /Spy can drive/.test(m)), 'T2');
  for (const c of [...truck.occupants || []]) truck.exit?.(c);
  truck.destroy?.(null, 'test');
  s.run(0.5);
  assert.match(String(w.scriptFail), /LORRY IS GONE/);
});

/** Put the Marine in his gear, submerged, at (x, z) (what the `dive` ability does in the shallows). */
function submerge(ma, x, z) {
  ma.x = x; ma.z = z; ma.diving = true; ma.stance = 'dive'; ma.underwater = true;
}

test('m16 fix: the diving Marine swims UNDER the bridge — E beach N of the spans → the island (live unit, not just findPath)', () => {
  const s = m16Sim(), ma = s.cmd('diver');
  submerge(ma, 110, 70.5);
  assert.ok(ma.issue({ type: 'move', x: 37, z: 92 }), 'order accepted');
  const last = ma.path[ma.path.length - 1];
  assert.ok(Math.hypot(last.x - 37, last.z - 92) < 1, `the path is not cut at the deck (ends ${last.x.toFixed(1)},${last.z.toFixed(1)})`);
  assert.ok(ma.path.every((p) => { const g = s.world.groundAt(p.x, p.z); return g.water || g.shallow || s.world.grid.underpassAt(p.x, p.z); }), 'water only');
  s.run(120, () => !ma.path);
  assert.ok(Math.hypot(ma.x - 37, ma.z - 92) < 1, `arrived (${ma.x.toFixed(1)}, ${ma.z.toFixed(1)})`);
  assert.equal(ma.stance, 'dive');
  assert.ok(!s.world.scriptFail, String(s.world.scriptFail));
});

test('m16 fix: the deck edges over water stay closed to walkers and surface swimmers (girders), open to divers only', () => {
  const g = loadGrid(M()).grid;
  const len = (p) => p.reduce((a, q, k) => (k ? a + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);
  // round 1: a surface swimmer stepped onto the deck from the water anywhere along the span. Now the only way up
  // from the river is the 2.5 m girder gap at the E-bank shallows (r2, [DE]): from the S-side water off the E
  // span, the way to the deck runs through that gap
  const gap = { x: 80.8, z: 105.8 };
  const up = findPath(g, 73.5, 101.5, 77, 99, { swim: true, maxNodes: 400000 });
  assert.ok(!up || len(up) > 30 || (len(up) > 10 && up.some((q) => Math.hypot(q.x - gap.x, q.z - gap.z) < 2.5)),
    `no climbing onto the deck over the river (path ${up && len(up).toFixed(1)} m)`);
  // a surface swimmer cannot cross the bridge line in the river: N-side water → S-side water only by diving
  assert.ok(!reach(g, { x: 70, z: 80 }, { x: 72, z: 96 }, 'diver', { swim: true, noLinks: true }) ||
    len(findPath(g, 70, 80, 72, 96, { swim: true, maxNodes: 400000 })) > 30, 'surface swimmers go round by the banks');
  assert.ok(reach(g, { x: 70, z: 80 }, { x: 72, z: 96 }, 'diver', { swim: true, dive: true }), 'divers pass under');
});

test('m16 fix: a disguised Spy boarding the lorry in view of e15 is not unmasked (rules.spyMayBoard, §6.1/§9)', () => {
  const s = m16Sim(), w = s.world, truck = s.get('truck'), spy = s.cmd('spy'), e15 = s.get('e15');
  spy.setDisguise(true);
  spy.stance = 'stand';
  truck.x = 104; truck.z = 121; truck.heading = 0;
  spy.x = 104; spy.z = 123;
  e15.x = 100; e15.z = 117; e15.heading = Math.atan2(123 - 117, 104 - 100); // staring at him from 7 m
  s.run(0.1);
  assert.ok(spy.useAbility('enterVehicle', truck), 'boarding order accepted');
  s.run(3, () => spy.state === 'inVehicle');
  assert.equal(spy.state, 'inVehicle', 'aboard');
  s.run(1);
  assert.equal(s.count('enemy:unmasked-spy'), 0, 'not unmasked');
  assert.ok(spy.disguised && !truck.tainted, 'still in uniform, the lorry untainted');
  assert.ok(!w.scriptFail && e15.brain.state !== 'ALARM_RUN', `no siren (${w.scriptFail})`);
});

test('m16 fix: Patrol 25 keeps 3 m clear of the parked lorry and off the railway', () => {
  const truck = M().vehicles.find((v) => v.id === 'truck');
  const pts = M().enemies.find((e) => e.id === 'e25').route.points;
  const hullN = truck.z - 1.2; // the hull's N side (6 × 2.4 m, heading 0)
  for (let u = 0; u <= 1; u += 0.02) {
    const x = pts[0].x + u * (pts[1].x - pts[0].x), z = pts[0].z + u * (pts[1].z - pts[0].z);
    if (x > truck.x - 4 && x < truck.x + 4) assert.ok(hullN - (z + 1.4) >= 2.9, `route at (${x.toFixed(1)}, ${z.toFixed(1)}) (+1.4 m second rank)`);
    // and off the railway (x + z = 223.3 by the lorry): the train ran the W end over and the siren went
    assert.ok((x + z - 223.3) / Math.SQRT2 >= 5, `route at (${x.toFixed(1)}, ${z.toFixed(1)}) clear of the rails`);
  }
});

test('m16 fix: T1 fires when the Spy WEARS the uniform, not when he takes it off the line; the team starts prone', () => {
  assert.ok(M().commandos.every((c) => c.stance === 'crawl'), 'prone start (dossier §7)');
  const s = m16Sim(), spy = s.cmd('spy');
  spy.inventory.set?.('uniform', 1);
  s.run(1);
  assert.ok(!s.msgs.some((m) => /Uniform on/.test(m)), 'not at pickup');
  spy.setDisguise(true);
  s.run(0.5);
  assert.ok(s.msgs.some((m) => /Uniform on/.test(m)), 'on wearing');
});

test('m16 fix: a knife order the diving Marine cannot carry out is refused with a message (the harpoon works)', () => {
  const s = m16Sim(), ma = s.cmd('diver'), e16 = s.get('e16');
  submerge(ma, 37, 92.2);
  s.run(0.1);
  assert.equal(ma.useAbility('knife', e16), false, 'refused');
  assert.match(String(ma.lastRefusal?.text), /from the water/);
  assert.ok(!ma.path && !ma.pendingAbility, 'no pointless swim');
  assert.equal(ABILITIES.harpoon.canUse(ma, e16, s.world), true, 'the harpoon reaches him from the water');
});

test('m16 fix r2: after the bridge goes up the cosmetic charges hurt no one and T3 stays quiet', () => {
  const s = m16Sim(), w = s.world;
  const e15 = s.get('e15');
  e15.x = DETONATORS.D_E.x; e15.z = DETONATORS.D_E.z; // standing at his plunger, 2-3 m from the E-abutment charge
  siren(w);
  s.run(8, () => !!w.scriptFail);
  assert.match(String(w.scriptFail), /BRIDGE HAS BEEN BLOWN/);
  const booms = [];
  w.events.on('explosion', (p) => booms.push(p));
  s.run(3);
  assert.equal(booms.length, 4, 'the four charges still go up (fx/sfx)');
  for (const id of SAPPERS) assert.ok(s.get(id).alive !== false, `${id} survives the cosmetic charges`);
  // even a real kill after the loss does not bring the 'clock is running' flavour line
  s.get('e14').die?.('knife', null);
  s.run(0.2);
  assert.ok(!s.msgs.some((m) => /One engineer down/.test(m)), `no T3 after the loss (${s.msgs.join(' | ')})`);
});

test('m16 fix r2: the Marine wading in the E-bank shallows climbs onto the bridgehead through the girder gap ([DE])', () => {
  const s = m16Sim(), g = s.world.grid;
  const len = (p) => p.reduce((a, q, k) => (k ? a + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);
  // r2_h2: undived at (79.3,106.6) he was routed over the land S of the girder end, past P26 and pb_e, and shot
  const p = findPath(g, 79.3, 106.6, 84, 104, { swim: true, role: 'diver', maxNodes: 400000 });
  assert.ok(p && len(p) < 7, `short climb onto the deck (${p && len(p).toFixed(1)} m)`);
  assert.ok(p.every((q) => q.z < 108.5), 'never by the land S of the girder end (pb_e)');
  // the gap is at the bank only: the rest of the S girder over the water is intact
  const ix = (x, z) => Math.floor(z / g.cell) * g.cols + Math.floor(x / g.cell);
  assert.equal(g.block[ix(76.25, 102.25)], 1, 'S girder over the river still closed');
});
