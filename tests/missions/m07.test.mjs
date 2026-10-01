/**
 * BEL M7 "Chase of the Wolves" (docs/missions/m07.md): schema + §10.5 test #14, the two land parties kept apart
 * (they meet only by boat), the rowboat's water routes, the split alarm zones, objective/extraction wiring and the
 * dossier's triggers (§11): only a charge on the torpedo stack sinks a U-boat, a gun's blast raises the W base,
 * losing the rowboat or running out of charges fails the mission.
 * Run with the unit suite: node tests/unit/run.mjs m07
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid, applyIntendedAbilities, boatReach, escapeReaches } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { T, B } from '../../src/world/grid.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';
import { UBOATS, chargesLeft, afloat } from '../../src/missions/scripts/m07.js';
import { Entity } from '../../src/entities/entity.js';
import { restoreWorld } from '../../src/save.js';

const M = () => getMission('m07');
const GROUP_A = { x: 15, z: 50 }, GROUP_B = { x: 103.5, z: 25.5 };
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });

test('m07: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [144, 195]);
  assert.equal(m.par.time, 840);
  assert.equal(m.theater, 'snow');
});

test('m07: §3.8 row 7 loadout exactly (GB/Marine/Sapper/Driver/Spy; Marine without knife; charges only in the crate)', () => {
  const L = belLoadout(7);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('diver', M().commandos[1].inventory).knife, undefined, 'the Marine has no knife');
  assert.equal(spawnInventory('sapper', M().commandos[2].inventory).timeBomb, undefined, 'the Sapper lands without charges');
  const crate = M().interactables.find((i) => i.interactKind === 'crate');
  assert.deepEqual(crate.contents, { timeBomb: 4 }, 'four time bombs in the air-drop crate');
  assert.equal(M().vehicles.find((v) => v.id === 'rowboat').seats, 5, 'the rowboat carries all five');
  assert.ok(M().interactables.some((i) => i.interactKind === 'clothesline'), 'the uniform is on site');
});

test('m07: §10.5 #14 — loads; starts reach both U-boats, their charge markers and the rowboat; no start in a cone; routes walkable', () => {
  // the rowboat's route to the buoy is checked over water by the validator (fix: it used land A*)
  assert.deepEqual(checkMission(M()), []);
});

test('m07: enemy count matches Kildread (10 walkers, 5 sentries, patrols 2/2/2 + 3/3/3 + 5, two gunners, Gatling, 3 garrisons)', () => {
  const m = M();
  const squads = {};
  for (const e of m.enemies) if (e.squad) (squads[e.squad.id] ||= []).push(e.id);
  assert.deepEqual(Object.values(squads).map((s) => s.length).sort(), [2, 2, 2, 3, 3, 3, 5]);
  const solo = m.enemies.filter((e) => !e.squad && ['soldier', 'sentry'].includes(e.soldierType));
  assert.equal(solo.filter((e) => e.route).length, 10, 'walkers');
  assert.equal(solo.filter((e) => !e.route).length, 5, 'sentries');
  assert.equal(m.enemies.filter((e) => e.soldierType === 'gunner').length, 2, '210 mm gunners');
  assert.equal(m.enemies.filter((e) => e.soldierType === 'mg').length, 1, 'Gatling');
  assert.deepEqual(Object.keys(m.barracks).sort(), ['barr_dock', 'barr_mid', 'barr_vil']);
  for (const id of ['gun22', 'gun23']) assert.equal(m.vehicles.find((v) => v.id === id).vehicleType, 'mortar210');
  const ht = m.vehicles.find((v) => v.id === 'halftrack');
  assert.ok(ht && ht.driveable && !m.enemies.some((e) => e.vehicle === 'halftrack'), 'the half-track is vacant');
});

test('m07: the parties meet only by boat — group A reaches the crate, the dock and the half-track; group B the village and the rowboat', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  const A = { crate: { x: 15, z: 6.5 }, dock: { x: 20, z: 100 }, pocket: { x: 50, z: 62 }, halftrack: { x: 26.5, z: 117.5 }, slipway: { x: 8, z: 108 }, gun22: { x: 8, z: 90 } };
  const Bp = { village: { x: 120, z: 82 }, jetty: { x: 117, z: 123 }, barrels: { x: 131, z: 63 }, mole: { x: 70, z: 160 }, salientE: { x: 57, z: 137 } };
  for (const [n, p] of Object.entries(A)) {
    assert.ok(reach(g, GROUP_A, p, 'sapper'), `group A → ${n}`);
    assert.ok(!reach(g, GROUP_B, p, 'greenberet'), `group B cannot walk to ${n}`);
  }
  for (const [n, p] of Object.entries(Bp)) {
    assert.ok(reach(g, GROUP_B, p, 'greenberet'), `group B → ${n}`);
    assert.ok(!reach(g, GROUP_A, p, 'sapper'), `group A cannot walk to ${n}`);
  }
  // the pier and both U-boats are an island: nobody gets there on foot, the Marine can swim
  for (const id of ['uboat_1', 'uboat_2']) {
    const mk = ctx.world.markers.get(UBOATS[id].marker);
    assert.ok(g.walkableAt(mk.x, mk.z), `${id} after deck is walkable`);
    for (const [who, from] of [['sapper', GROUP_A], ['greenberet', GROUP_B]]) assert.ok(!reach(g, from, mk, who), `${who} cannot walk onto ${id}`);
    assert.ok(reach(g, GROUP_B, mk, 'diver', { swim: true }), `the Marine can swim to ${id}`);
  }
  assert.ok(!reach(g, GROUP_A, { x: 20, z: 145 }, 'sapper'), 'the pier is an island');
  // gate_n is the only way into the dockyard; the NE gate is locked (opening it would join the pocket to the village side)
  const gate = ctx.handle.structures.get('gate_n');
  for (let k = 0; k < g.size; k++) if (g.owner[k] === gate.owner) g.block[k] = B.HIGH;
  assert.ok(!reach(g, GROUP_A, A.dock, 'sapper'), 'with gate_n shut the dock is closed');
  assert.ok(M().structures.find((s) => s.id === 'gate_ne').locked);
});

test('m07: the rowboat can reach the slipway, the pier and float, both U-boats and the red buoy over water', () => {
  const { grid: g } = loadGrid(M());
  const boat = M().vehicles.find((v) => v.id === 'rowboat');
  const near = boatReach(g, boat);
  assert.ok(near(boat.x, boat.z, 1), 'the boat floats free at the jetty');
  assert.ok(near(8, 110, 3), 'slipway (group A pick-up)');
  assert.ok(near(37.5, 164, 3), 'the float at the pier end');
  assert.ok(near(35, 158.5, 3), 'the pier end');
  const ex = M().extraction.exit;
  assert.ok(near(ex.x, ex.z, ex.r), 'the red buoy');
  // group B boards at the jetty; group A from the slipway's walkable edge; the Sapper lands on the pier
  assert.ok(g.walkableAt(122.5, 129.5), 'jetty tip walkable');
  assert.ok(g.walkableAt(9, 107), 'slipway walkable');
});

test('m07: split zones — starts, the crate corner, heights, ruins, jetties and mole outside; dock/pocket in z_w; village in z_vil', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const c of M().commandos) assert.equal(a.zoneAt(c.x, c.z), null, `${c.role} start`);
  for (const [x, z] of [[15, 6], [20, 16], [99, 38.5], [84, 43], [80, 110], [117, 123], [70, 160], [91, 88]]) assert.equal(a.zoneAt(x, z), null, `(${x},${z}) outside`);
  for (const [x, z] of [[50, 62], [65, 76], [20, 90], [26.5, 120], [16, 125.5], [5, 93], [47, 139]]) assert.equal(a.zoneAt(x, z)?.id, 'z_w', `(${x},${z}) in z_w`);
  for (const [x, z] of [[98, 64], [120, 82], [134.8, 78], [135, 103]]) assert.equal(a.zoneAt(x, z)?.id, 'z_vil', `(${x},${z}) in z_vil`);
  const [zw, zv] = M().zones;
  assert.deepEqual([zw.onSeen, zw.onHeard, zw.siren], ['RINT', null, true]);
  assert.deepEqual([zv.onSeen, zv.onHeard, zv.siren], ['RVIL', 'RVIL', false]);
  assert.equal(M().alarmFail ?? null, null);
});

/** Full M7 sim with the alarm, stepped like Game.step; messages and zone alarms recorded. */
function m07Sim(brains = false) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  s.alarms = [];
  s.msgs = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ zone: p.zone?.id ?? p.zone ?? p.id, event: p.event }));
  w.events.on('message', (p) => s.msgs.push(p.text));
  w.objectives = createObjectives(s.mission.objectives);
  s.run(0.1); // first BEL tick: the trigger director installs
  return s;
}
const targetOf = (w, id) => w.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));
/** A time bomb that goes off after `fuse` s (the real charge: bomb:exploded + class `bomb`). */
async function plant(s, x, z, fuse = 0.2) {
  const { Bomb } = await import('../../src/abilities/charges.js');
  s.world.add(new Bomb({ x, z, bombKind: 'time', fuse, owner: s.cmd('sapper') }));
  s.run(fuse + 0.3);
}

test('m07 hook: a charge on the hull away from the torpedoes only scorches it (T2); on the torpedo stack it sinks the boat → o1', async () => {
  const s = m07Sim(), w = s.world, g = w.grid;
  const mk = w.markers.get('u1_charge'), t1 = targetOf(w, 'uboat_1'), t2 = targetOf(w, 'uboat_2');
  assert.ok(t1 && t2, 'both U-boats are explosive targets');
  assert.ok(Math.hypot(t1.x - mk.x, t1.z - mk.z) < 0.5, 'the target sits on the torpedo stack');
  assert.equal(t1.marker, 'u1_charge');
  const b = UBOATS.uboat_1, c = Math.cos((b.rot * Math.PI) / 180), sn = Math.sin((b.rot * Math.PI) / 180);
  const fwd = { x: mk.x + c * 9, z: mk.z + sn * 9 }; // 9 m forward along the deck
  assert.ok(g.walkableAt(fwd.x, fwd.z), 'a deck cell');
  await plant(s, fwd.x, fwd.z);
  assert.ok(!t1.destroyed, 'a charge 9 m from the torpedoes does not sink it');
  assert.ok(s.msgs.some((m) => /scorched paint/.test(m)), 'T2 hint');
  checkObjectives(w);
  assert.ok(!w.objectives.find((o) => o.id === 'o1').done);
  await plant(s, mk.x + 1.5, mk.z + 1);
  assert.ok(t1.destroyed, 'charge by the torpedoes: U-boat 1 goes down');
  assert.ok(!t2.destroyed, 'the other boat is untouched');
  checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done);
  assert.ok(!w.objectives.find((o) => o.id === 'o2').done && !w.objectives.find((o) => o.id === 'o3').done);
  assert.ok(!g.walkableAt(mk.x, mk.z), 'the after deck is under water');
  assert.ok(g.walkableAt(20, 145) && g.walkableAt(w.markers.get('u2_charge').x, w.markers.get('u2_charge').z), 'pier and U-boat 2 still walkable');
  await plant(s, w.markers.get('u2_charge').x, w.markers.get('u2_charge').z);
  checkObjectives(w);
  assert.ok(t2.destroyed && w.objectives.find((o) => o.id === 'o2').done);
  s.run(0.2);
  assert.ok(s.msgs.some((m) => /Both U-boats/.test(m)), 'T3');
  assert.equal(w.scriptFail ?? null, null);
});

test('m07 hook: any charge inside either 3 m marker circle sinks its U-boat', async () => {
  for (const id of ['uboat_1', 'uboat_2']) {
    for (let k = 0; k < 4; k++) {
      const s = m07Sim(), w = s.world, mk = w.markers.get(UBOATS[id].marker), a = (k * Math.PI) / 2 + 0.4;
      await plant(s, mk.x + 2.8 * Math.cos(a), mk.z + 2.8 * Math.sin(a));
      assert.ok(targetOf(w, id).destroyed, `${id} rim ${k}`);
    }
  }
});

test('m07 hook: blowing a 210 mm gun raises the W base (T1: RINT + siren); a noise alone never does', async () => {
  const s = m07Sim(), w = s.world;
  applyExplosion(w, 80, 110, 'bomb'); // a blast in the ruins field: heard everywhere
  s.run(1);
  assert.ok(!s.alarms.some((a) => a.event === 'RINT'), 'noise does not raise z_w');
  assert.ok(s.alarms.some((a) => a.event === 'RVIL'), 'but it empties the village barracks (onHeard RVIL)');
  assert.equal(w.alarm.active, false, 'no siren');
  const gun = s.get('gun22');
  await plant(s, 7, 90.5); // the Sapper's charge beside gun 22
  assert.ok(gun.destroyed, 'gun 22 destroyed');
  s.run(1);
  assert.ok(s.alarms.some((a) => a.zone === 'z_w' && a.event === 'RINT'), 'T1: z_w raised');
  assert.equal(w.alarm.active, true, 'siren');
});

test('m07 hook: the barrel at the village barracks takes it and patrol 8 out; silent RVIL; one sergeant staggers out (T5)', () => {
  const s = m07Sim(), w = s.world;
  const p8 = ['p8a', 'p8b'].map((id) => s.get(id));
  for (const [k, e] of p8.entries()) { e.x = 128.5 - k * 1.5; e.z = 81; }
  w.rebuildSpatial();
  applyExplosion(w, 130.8, 79.5, 'barrel');
  s.run(0.5);
  assert.ok(targetOf(w, 'barr_vil').destroyed, 'barracks destroyed');
  assert.ok(p8.every((e) => e.alive === false), 'patrol 8 killed');
  assert.ok(s.alarms.some((a) => a.zone === 'z_vil' && a.event === 'RVIL'));
  assert.ok(!s.alarms.some((a) => a.event === 'RINT') && !w.alarm.active, 'silent: no siren, no base alarm');
  s.run(3);
  assert.ok(s.get('e_vil_off')?.alive, 'T5 survivor');
});

test('m07 hook: losing the rowboat fails the mission (T4)', () => {
  const s = m07Sim(), w = s.world;
  s.get('rowboat').destroy?.(null, 'shell');
  s.run(0.3);
  assert.match(String(w.scriptFail), /rowboat/);
});

test('m07 hook: fewer charges than U-boats afloat fails the mission (T6); four in the crate never does', () => {
  const ok = m07Sim(), w0 = ok.world;
  assert.equal(chargesLeft(w0), 4);
  assert.equal(afloat(w0), 2);
  ok.run(5);
  assert.equal(w0.scriptFail ?? null, null, 'no fail with the crate full');
  // the Sapper takes the charges: still four
  const crate = w0.interactables.find((i) => i.interactKind === 'crate');
  const sap = ok.cmd('sapper');
  sap.x = crate.x; sap.z = crate.z + 1;
  crate.interact(sap);
  assert.equal(sap.inventory.get('timeBomb'), 4, 'the Sapper takes all four');
  assert.equal(chargesLeft(w0), 4);
  ok.run(4);
  assert.equal(w0.scriptFail ?? null, null);
  // only one charge left for two boats
  sap.inventory.set('timeBomb', 1);
  ok.run(1);
  assert.equal(w0.scriptFail ?? null, null, 'not before the 3 s re-check');
  ok.run(3);
  assert.match(String(w0.scriptFail), /Not enough charges/);
});

test('m07 hook: extraction — all five aboard the rowboat at the red buoy completes o3 only once both boats are sunk', () => {
  const s = m07Sim(), w = s.world, v = s.get('rowboat');
  const order = ['diver', 'greenberet', 'sapper', 'driver', 'spy'];
  for (const r of order) { const c = s.cmd(r); c.x = 123; c.z = 130; }
  for (const r of order) assert.equal(v.enter(s.cmd(r)), true, `${r} boards (${v.canEnter?.(s.cmd(r))})`);
  assert.equal(v.occupants.length, 5, 'five seats');
  const ex = M().extraction.exit;
  v.x = ex.x; v.z = ex.z;
  checkObjectives(w);
  assert.ok(!w.objectives.find((o) => o.id === 'o3').done, 'not before the U-boats are sunk');
  for (const id of ['o1', 'o2']) w.objectives.find((o) => o.id === id).done = true;
  const r = checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o3').done, 'o3 done');
  assert.ok(r.won, 'mission won');
});

test('m07: gun 23 sits W of the salient and sees the pen water — the float, the channel — over the low rocks (fix: wall screened it)', async () => {
  const { canSee } = await import('../../src/ai/perception.js');
  const s = m07Sim(), w = s.world, g = w.grid, g23 = s.get('g23');
  assert.deepEqual(M().structures.find((x) => x.id === 'w_salient').points.at(-1), [49.5, 145.5], 'the salient ends at the quay');
  for (const [x, z] of [[50.8, 157.5], [45.5, 150.7], [37.5, 164]]) assert.ok(g.lineOfSight(g23.x, g23.z, x, z), `gun 23 → (${x},${z}) open`);
  const v = s.get('rowboat'), m = s.cmd('diver');
  m.x = 123; m.z = 130;
  assert.equal(v.enter(m), true);
  v.x = 50.8; v.z = 157.5;
  let seen = false;
  for (let i = 0; i < 80 && !seen; i++) { s.run(0.1); seen = canSee(g23, v, w) !== 'none'; }
  assert.ok(seen, 'g23 sees the rowed boat in the channel');
});

/** The Marine rows the boat to (x, z); the Driver sits in the half-track at its start. */
function m07Crewed(x, z) {
  const s = m07Sim(true), w = s.world, v = s.get('rowboat'), m = s.cmd('diver');
  m.x = 123; m.z = 130;
  assert.equal(v.enter(m), true);
  v.x = x; v.z = z;
  s.fires = []; s.gunShots = [];
  w.events.on('vehicle:fire', (p) => s.fires.push({ v: p.vehicle?.tag, weapon: p.weapon }));
  w.events.on('shot', (p) => { if (/^g2[23]$/.test(p.shooter?.tag ?? '')) s.gunShots.push(`${p.shooter.tag}:${p.weapon}>${p.target?.tag ?? p.target?.role}`); });
  return s;
}

test('m07: a 210 mm gunner fires his gun, not a rifle — one shell sinks the rowboat he sees (T4 loss)', () => {
  const s = m07Crewed(40, 158), w = s.world;
  s.run(12, () => s.get('rowboat').destroyed);
  assert.ok(s.get('rowboat').destroyed, `rowboat sunk (fires ${JSON.stringify(s.fires)})`);
  assert.ok(s.fires.some((f) => f.v === 'gun23' && f.weapon === 'cannon'), 'gun 23 fired its shell');
  assert.deepEqual(s.gunShots, [], 'no rifle shots from the gunners');
  assert.match(String(w.scriptFail ?? ''), /rowboat has gone down/);
});

test('m07: the half-track parked out of both gun cones is safe — a gunner cannot swing his gun round at it (giro)', () => {
  const s = m07Crewed(123, 131), ht = s.get('halftrack'), d = s.cmd('driver'), g23 = s.get('g23');
  d.x = ht.x - 2; d.z = ht.z;
  assert.equal(ht.enter(d), true);
  ht.tainted = true;
  g23.brain._enterCombat(ht, { seen: false }); // handed over without a sighting (the replay's case)
  s.run(8);
  assert.ok(!ht.destroyed, 'half-track intact');
  assert.deepEqual(s.fires.filter((f) => /^gun2[23]$/.test(f.v)), [], 'neither gun fired');
  assert.deepEqual(s.gunShots, [], `no gunner shots: ${s.gunShots.slice(0, 4)}`);
  const off = Math.abs((((g23.heading * 180) / Math.PI - 110) % 360 + 540) % 360 - 180);
  assert.ok(off <= 55.01, `g23 stays inside his traverse (off ${off.toFixed(1)}°)`);
});

test('m07: the body dump the notebook names — the walled W corner by the inlet is reachable from the dockyard and outside z_w', () => {
  const { grid: g } = loadGrid(M());
  const s = makeSim(M(), { brains: false }), a = new Alarm(s.world);
  for (const p of [{ x: 11.9, z: 60 }, { x: 13.5, z: 62.3 }]) {
    assert.ok(reach(g, { x: 21, z: 69.5 }, p, 'spy'), `dockyard → (${p.x},${p.z})`);
    assert.equal(a.zoneAt(p.x, p.z), null, `(${p.x},${p.z}) outside the zones`);
  }
  assert.ok(M().briefing.hints.some((h) => /walled corner by the inlet/.test(h)), 'the notebook points there');
});

test('m07: the rowboat clears the lighthouse mole tip on a straight course that hugs it (fix: wedged on the tip rocks)', () => {
  const s = m07Sim(), v = s.get('rowboat'), m = s.cmd('diver');
  m.x = 123; m.z = 130;
  assert.equal(v.enter(m), true);
  for (const [[ax, az], [bx, bz]] of [[[69.8, 186.8], [77.3, 187.8]], [[64, 188], [84, 187.5]]]) {
    v.x = ax; v.z = az; v.heading = Math.atan2(bz - az, bx - ax);
    assert.ok(v.driveTo(bx, bz), `course (${ax},${az}) → (${bx},${bz}) accepted`);
    s.run(15, () => Math.hypot(v.x - bx, v.z - bz) < 0.6);
    assert.ok(Math.hypot(v.x - bx, v.z - bz) < 0.6, `reached (${bx},${bz}); stopped at (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  }
});

test('m07: a sunk U-boat is announced by name, never by the art variant id (fix: "Uboat docked destroyed.")', async () => {
  const s = m07Sim(), mk = s.world.markers.get('u1_charge');
  await plant(s, mk.x, mk.z);
  assert.ok(targetOf(s.world, 'uboat_1').destroyed);
  assert.ok(s.msgs.includes('U-boat destroyed.'), JSON.stringify(s.msgs));
  assert.ok(!s.msgs.some((t) => /uboat|docked/i.test(t)), JSON.stringify(s.msgs));
});

test('m07 save/load: a quickload replays the same future — patrol files, waits and sweeps match a straight run (fix: squad trail lost)', () => {
  const fresh = () => { Entity.nextId = 1; return m07Sim(true); };
  const snap = (s) => s.world.enemies.map((e) => `${e.tag}:${e.x.toFixed(3)},${e.z.toFixed(3)},${e.heading.toFixed(3)},${e.brain.state}`);
  const a = fresh();
  a.run(25);
  const S = JSON.parse(JSON.stringify({ ...a.world.serialize(), nextId: Entity.nextId, ai: a.world.ai?.serialize?.() ?? null }));
  const AL = JSON.parse(JSON.stringify(a.world.alarm.serialize()));
  const A = [];
  for (let i = 0; i < 15; i++) { a.run(1); A.push(snap(a)); }
  const b = fresh();
  restoreWorld(b.world, S);
  b.world.alarm.deserialize(AL);
  for (let i = 0; i < 15; i++) {
    b.run(1);
    const B = snap(b), bad = B.filter((x, k) => x !== A[i][k]);
    assert.deepEqual(bad, [], `t+${i + 1}s diverged: ${bad.slice(0, 2)} vs ${A[i].filter((x, k) => x !== B[k]).slice(0, 2)}`);
  }
});

test('m07: the validator checks a boat escape over water — the rowboat reaches the buoy, a truck there would not', () => {
  const { grid: g } = loadGrid(M());
  const boat = M().vehicles.find((v) => v.id === 'rowboat'), ex = M().extraction.exit;
  assert.ok(escapeReaches(g, boat, ex), 'rowboat → red buoy over water');
  assert.ok(!escapeReaches(g, { ...boat, vehicleType: 'truck' }, ex), 'a land vehicle cannot drive to a buoy');
});

test('m07: the 210 mm guns read as artillery — a sandbag pit and a long raised barrel, not a flat box (fix: art)', async () => {
  const THREE = await import('three');
  const { Vehicle } = await import('../../src/entities/vehicle.js');
  const v = new Vehicle({ vehicleType: 'mortar210', x: 0, z: 0, heading: 0 });
  v.model.setTurretHeading(0);
  v.model.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(v.model.root);
  assert.ok(box.max.z >= 3.8, `barrel reaches ${box.max.z.toFixed(2)} m forward`);
  assert.ok(box.max.y >= 2.2, `barrel raised to ${box.max.y.toFixed(2)} m`);
  let meshes = 0; v.model.root.traverse((o) => { if (o.isMesh) meshes++; });
  assert.ok(meshes >= 12, 'pit sandbags + carriage + barrel');
});
