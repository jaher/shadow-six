/**
 * BEL M15 "The End of the Butcher" (docs/missions/m15.md): schema + §10.5 test #14, the exact §3.8 loadout, the
 * Kildread census, the levels (balcony B 4.5, roof R 12.5) and the Sniper's line to the garden's NE corner, the
 * canal (parapets, the Marine's stairs), the one-zone alarm, the general (deaf to footsteps; any alarm → yard car
 * through the house, else the curb car; reaching it loses), the HQ's demolition point (the tram-tanker accident is
 * silent), the tanker softlock fail, and the van extraction by the NW road (§10).
 * Run with the unit suite: node tests/unit/run.mjs m15
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid, applyIntendedAbilities } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { LEVEL, SNIPER_SPOT, UNIFORM, D1, D2, GENERAL_PAUSE, TANKER_ON_RAILS, S1, S2 } from '../../src/missions/m15_the_end_of_the_butcher.js';
import { HQ_POINT, GARDEN_DOOR, MAIN_DOOR, chooseCar, inPoly, GARDEN, destroyHQ, m15Tick } from '../../src/missions/scripts/m15.js';

const M = () => getMission('m15');
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
const pt = ([x, z]) => ({ x, z });
const cen = (poly) => ({ x: poly.reduce((a, p) => a + p[0], 0) / poly.length, z: poly.reduce((a, p) => a + p[1], 0) / poly.length });

test('m15: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.title, 'The End of the Butcher');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [81, 139]);
  assert.equal(m.par.time, 660);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.coneColors, 'green');
  assert.deepEqual(m.startDisguised, []);
});

test('m15: §10.5 #14 — loads; every start reaches every target and the van; no start in a cone; routes walkable', () => {
  // the general is a man, not a structure: checkMission cannot place him, so he is checked by hand below
  const probs = checkMission(M()).filter((p) => p !== 'objective target schleper has no walkable approach');
  assert.deepEqual(probs, []);
  const ctx = loadGrid(M());
  applyIntendedAbilities(ctx);
  const g = ctx.grid;
  for (const c of M().commandos) {
    const swim = c.role === 'diver';
    for (const [name, p] of [['the general\'s pause', GENERAL_PAUSE], ['the garden door', GARDEN_DOOR], ['the demolition point', { x: 71, z: 46 }],
      ['the van', { x: 55, z: 18 }], ['door D1', pt(D1)], ['door D2', pt(D2)]]) {
      assert.ok(reach(g, c, p, c.role, { swim }), `${c.role} reaches ${name}`);
    }
  }
  // every point of the general's walk is walkable and inside the garden
  for (const p of M().enemies.find((e) => e.id === 'schleper').route.points) {
    assert.ok(g.walkableAt(p.x, p.z), `walk point (${p.x},${p.z})`);
    assert.ok(inPoly(GARDEN, p.x, p.z), `walk point (${p.x},${p.z}) is in the garden`);
  }
  assert.ok(g.walkableAt(MAIN_DOOR.x, MAIN_DOOR.z), 'the main door opens onto the yard');
});

test('m15: the corner block — ladders to the balcony (uniform) and the roof (the Sniper\'s perch, 20 m from the NE corner)', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  const el = (p) => +g.elevAt(p.x, p.z).toFixed(2);
  assert.equal(el(pt(UNIFORM)), LEVEL.B, 'the uniform is on the balcony');
  assert.equal(el(pt(SNIPER_SPOT)), LEVEL.R, 'the perch is on the flat roof');
  assert.equal(el(pt(D1)), 0);
  const sn = M().commandos.find((c) => c.role === 'sniper');
  const r = findPath(g, sn.x, sn.z, SNIPER_SPOT[0], SNIPER_SPOT[1], { role: 'sniper', maxNodes: 400000 });
  assert.ok(r, 'the Sniper climbs L1 and L2 to the perch');
  assert.ok(r.some((p) => Math.abs(g.elevAt(p.x, p.z) - LEVEL.B) < 0.1), 'by way of the balcony');
  for (const l of g.links) g.setLinkEnabled(l.id, false);
  assert.ok(!reach(g, sn, pt(SNIPER_SPOT), 'sniper'), 'no way up without the ladders');
  const d = Math.hypot(SNIPER_SPOT[0] - GENERAL_PAUSE.x, SNIPER_SPOT[1] - GENERAL_PAUSE.z);
  assert.ok(d > 15 && d < 25, `the shot is ${d.toFixed(1)} m`);
  assert.ok(g.lineOfSight(SNIPER_SPOT[0], SNIPER_SPOT[1], GENERAL_PAUSE.x, GENERAL_PAUSE.z, { viewerElevated: true, viewerY: LEVEL.R, targetY: 1.7 }),
    'clear line from the roof to the pause point');
});

test('m15: the canal — parapets keep walkers out, the Marine goes in at the E stairs and out at the W stairs', () => {
  const g = loadGrid(M()).grid;
  const ma = M().commandos.find((c) => c.role === 'diver');
  const s1 = cen(S1), s2 = cen(S2);
  assert.ok(reach(g, ma, s2, 'diver'), 'the E stairs from the street');
  assert.ok(reach(g, s2, s1, 'diver', { swim: true }), 'swim S2 → S1 inside the central basin');
  assert.ok(!reach(g, { x: 35, z: 99 }, { x: 35, z: 112 }, 'spy'), 'nobody walks across the basin');
  assert.ok(reach(g, { x: 28.5, z: 97 }, { x: 28.5, z: 102.6 }, 'spy'), 'e4 walks down S1 to the water');
});

test('m15: §3.8 row 15 loadout exactly (Sniper 4 rounds, Marine, Driver medic, Spy without the uniform)', () => {
  const L = belLoadout(15);
  const team = M().commandos;
  assert.deepEqual(team.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of team) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, team.find((c) => c.role === r).inventory);
  assert.equal(inv('sniper').sniperRifle, 4);
  assert.equal(inv('driver').firstAid, 6);
  assert.equal(L.medic, 'driver');
  assert.ok(!inv('driver').smg, 'the Driver has no SMG this time');
  assert.equal(M().interactables.filter((i) => i.interactKind === 'clothesline').length, 1, 'one uniform, on the balcony');
  const types = M().vehicles.map((v) => v.vehicleType).sort();
  assert.deepEqual(types, ['citroen15', 'citroen15', 'opel_blitz_tanker', 'sdkfz', 'tram', 'van']);
});

test('m15: enemy census = Kildread (17 walkers, 11 sentries, one 3-man and three 5-man patrols, the general)', () => {
  const m = M();
  const singles = m.enemies.filter((e) => !e.squad && e.soldierType !== 'general');
  assert.equal(singles.filter((e) => e.route).length, 17, 'walkers');
  assert.equal(singles.filter((e) => !e.route).length, 11, 'sentries');
  const squads = {};
  for (const e of m.enemies.filter((x) => x.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(squads, { p7: 5, p17: 5, p10: 5, p22: 3 });
  assert.equal(m.enemies.length, 47, '46 men + the general');
  assert.equal(m.enemies.filter((e) => e.soldierType === 'general').length, 1);
  assert.ok(m.enemies.every((e) => e.flags?.followsTracks === false || e.soldierType === 'general'), 'cobbles: nobody follows tracks');
  assert.deepEqual(Object.keys(m.barracks), ['hq']);
  assert.deepEqual(m.barracks.hq.squads.map((s) => [s.event, s.size]), [['RINT', 4], ['RINT', 4]]);
  assert.equal(m.vehicles.find((v) => v.id === 'sdkfz').crew.length, 2);
});

test('m15: one silent zone over the whole map; GENERAL_ESCAPED is the alarm-fail', () => {
  const m = M();
  assert.equal(m.zones.length, 1);
  assert.deepEqual(m.zones[0].poly, [[0, 0], [81, 0], [81, 139], [0, 139]]);
  assert.equal(m.zones[0].onSeen, 'RINT');
  assert.equal(m.zones[0].onHeard, 'RINT');
  assert.equal(m.alarmFail.event, 'GENERAL_ESCAPED');
  assert.deepEqual(m.objectives.map((o) => [o.id, o.type, o.required]), [['o1', 'kill', true], ['o2', 'destroy', true], ['o3', 'escape', true]]);
  assert.deepEqual(m.extraction.spawnWhen, ['o1', 'o2']);
  assert.deepEqual(m.enemies.find((e) => e.id === 'schleper').cars, ['car_yard', 'car_curb']);
});

/** Full M15 sim with live brains, the alarm and the objectives (the director runs the triggers). */
function m15Sim() {
  const s = makeSim(M(), { brains: true });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.flags = {};
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  w.objectives = createObjectives(s.mission.objectives);
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  // park the team in the SW ruin, out of every cone
  for (const c of w.commandos) { c.setPosition?.(8, 136); c.x = 8; c.z = 136; }
  s.run(0.1);
  return s;
}
const siren = (w) => w.alarm.fireEvent('RINT', { zoneId: 'z_town', cause: 'test', x: 10, z: 130 });
const zoneEvents = (w) => w.alarm.zonesFired.map((f) => f.event);
const done = (w, id) => w.objectives.find((o) => o.id === id).done;

test('m15 hook: the general walks his garden and ignores footsteps; a shot or the siren sends him running', () => {
  const s = m15Sim(), w = s.world, gen = s.get('schleper');
  s.run(6);
  assert.ok(Math.hypot(gen.x - GARDEN_DOOR.x, gen.z - GARDEN_DOOR.z) > 2, 'he is out walking');
  assert.ok(inPoly(GARDEN, gen.x, gen.z), 'inside the garden');
  gen.brain.hear({ x: gen.x + 3, z: gen.z, radius: 10, kind: 'footstep', level: 1 });
  s.run(0.2);
  assert.notEqual(gen.brain.state, 'ALARM_RUN', 'footsteps do not frighten him');
  siren(w);
  s.run(0.2);
  assert.equal(gen.brain.state, 'ALARM_RUN', 'the siren does');
  assert.equal(gen.brain._m15.car, 'car_yard', 'yard car first');
  assert.equal(gen.brain._m15.phase, 'toDoor', 'through the house');
});

test('m15 hook: siren → he crosses the house, reaches the yard car → GENERAL_ESCAPED → mission lost', () => {
  const s = m15Sim(), w = s.world, gen = s.get('schleper');
  siren(w);
  s.run(12, () => gen.brain._m15?.phase === 'inside');
  assert.equal(gen.brain._m15.phase, 'inside', 'in the house');
  s.run(8, () => gen.brain._m15?.phase === 'toCar');
  assert.ok(Math.hypot(gen.x - MAIN_DOOR.x, gen.z - MAIN_DOOR.z) < 3, 'out of the main door into the yard');
  s.run(10, () => !!w.scriptFail);
  assert.ok(zoneEvents(w).includes('GENERAL_ESCAPED'));
  assert.match(String(w.scriptFail), /REACHED HIS CAR/);
  assert.equal(gen.vehicle, s.get('car_yard'), 'aboard the yard car');
});

test('m15 hook: with the HQ gone he takes the curb car through the gate; shot on the way, the alarm is harmless', () => {
  const s = m15Sim(), w = s.world, gen = s.get('schleper');
  w.byId('hq').destroy(null, 'test');
  s.run(0.2);
  assert.ok(done(w, 'o2'), 'o2');
  assert.ok(zoneEvents(w).includes('RINT'), 'a noisy demolition raises the alarm');
  s.run(0.2);
  assert.equal(gen.brain._m15.car, 'car_curb', 'the yard route is cut: the curb car');
  assert.deepEqual(chooseCar(w, 50, 50)?.car?.tag, 'car_curb');
  s.run(1.5);
  gen.takeDamage(1e5, s.cmd('sniper'), 'bullet');
  s.run(0.5);
  assert.ok(done(w, 'o1'), 'o1: the Butcher is dead');
  s.run(5);
  assert.ok(!w.scriptFail, String(w.scriptFail));
});

test('m15 hook: HQ gone quietly, then the siren: he runs out of the garden gate to the curb car and escapes', () => {
  const s = m15Sim(), w = s.world, gen = s.get('schleper');
  destroyHQ(w, { kind: 'barrel', accident: true, x: HQ_POINT.x, z: HQ_POINT.z });
  s.run(0.3);
  assert.ok(done(w, 'o2'));
  assert.deepEqual(zoneEvents(w), [], 'the accident raises nothing');
  siren(w);
  s.run(0.2);
  assert.equal(gen.brain._m15.car, 'car_curb');
  s.run(20, () => !!w.scriptFail);
  assert.match(String(w.scriptFail), /REACHED HIS CAR/);
  assert.equal(gen.vehicle, s.get('car_curb'));
});

test('m15 hook: the tram hits the tanker on the rails by the rear gate — HQ destroyed with no alarm (the accident)', () => {
  const s = m15Sim(), w = s.world, gen = s.get('schleper'), tk = s.get('tanker'), tram = s.get('tram');
  tk.setPosition?.(TANKER_ON_RAILS.x, TANKER_ON_RAILS.z); tk.x = TANKER_ON_RAILS.x; tk.z = TANKER_ON_RAILS.z;
  tk.heading = (15 * Math.PI) / 180;
  s.run(60, () => tk.destroyed);
  assert.ok(tk.destroyed, `the tram reached the tanker (tram at ${tram.x.toFixed(1)},${tram.z.toFixed(1)})`);
  s.run(2);
  assert.ok(w.byId('hq').destroyed, 'the HQ is destroyed');
  assert.ok(done(w, 'o2'), 'o2 done');
  assert.ok(Math.hypot(tk.x - HQ_POINT.x, tk.z - HQ_POINT.z) <= 6.75);
  assert.deepEqual(zoneEvents(w), [], 'no alarm');
  assert.notEqual(gen.brain.state, 'ALARM_RUN', 'the general keeps walking');
  assert.ok(!w.scriptFail, String(w.scriptFail));
  assert.ok(w.alarm.barracks.hq.destroyed, 'the garrison is gone with it');
});

test('m15 hook: the tanker blown up away from the HQ is a loss (nothing else can bring it down)', () => {
  const s = m15Sim(), w = s.world, tk = s.get('tanker');
  tk.destroy(null, 'test');
  s.run(2.5);
  assert.ok(!w.byId('hq').destroyed);
  assert.match(String(w.scriptFail), /HEADQUARTERS CAN NO LONGER BE DESTROYED/);
});

test('m15 hook: general dead + HQ destroyed → everyone into the van → it drives out by the NW road → win', () => {
  const s = m15Sim(), w = s.world, van = s.get('van');
  // the town emptied first (nobody sees the team board: an alarmed guard would taint and shoot up the van)
  for (const e of [...w.enemies]) if (e.tag !== 'schleper' && e.id !== 'schleper') w.remove(e);
  s.get('schleper').takeDamage(1e5, null, 'bullet');
  destroyHQ(w, { kind: 'barrel', accident: true, x: HQ_POINT.x, z: HQ_POINT.z });
  s.run(0.5);
  assert.ok(done(w, 'o1') && done(w, 'o2'));
  for (const c of w.commandos) { c.setPosition?.(van.x - 3, van.z); c.x = van.x - 3; c.z = van.z; assert.ok(van.enter(c), `${c.role} boards`); }
  s.run(40, () => done(w, 'o3'));
  assert.ok(done(w, 'o3'), `escaped (van at ${van.x.toFixed(1)},${van.z.toFixed(1)})`);
  assert.ok(!w.scriptFail, String(w.scriptFail));
});

test('m15 hook: losing the van before the escape fails the mission', () => {
  const s = m15Sim(), w = s.world;
  s.get('van').destroy(null, 'test');
  s.run(0.3);
  assert.match(String(w.scriptFail), /THE VAN IS GONE/);
});

test('m15: fix #1 — the SdKfz commander sweeps ±30° about 60°; ladder L1 and the balcony W end stay out of his cone', async () => {
  const { makeVision } = await import('../../src/entities/enemy.js');
  const { vehicleDef } = await import('../../src/entities/vehicle.js');
  const v = [...(M().vehicles || []), ...M().enemies].find((e) => e.id === 'sdkfz');
  assert.equal(v.post?.sweep, 30);
  assert.ok(Math.abs(v.heading - (60 * Math.PI) / 180) < 1e-6);
  const vis = makeVision(vehicleDef('sdkfz').vision, v);
  assert.equal(vis.sweepDeg, 30);
  const reachDeg = vis.sweepDeg + vis.fovDeg / 2; // widest angle the cone ever reaches off its heading
  const L1 = M().ladders.find((l) => l.id === 'L1');
  for (const [name, p] of [['L1 foot', L1], ['L1 top', { x: L1.top[0], z: L1.top[1] }]]) {
    const b = Math.atan2(p.z - v.z, p.x - v.x);
    const off = Math.abs(((b - v.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
    assert.ok(off > reachDeg + 5, `${name} is ${off.toFixed(0)}° off the SdKfz heading (cone reaches ${reachDeg}°)`);
  }
});

test('m15: fix #4 — the yard file e25a/b/c circles the yard (LOOP), and every leg incl. the closing one is walkable', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  const file = ['e25a', 'e25b', 'e25c'].map((id) => M().enemies.find((e) => e.id === id));
  for (const e of file) assert.equal(e.route.type, 'LOOP', `${e.id} loops`);
  const pts = file[0].route.points;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    assert.ok(reach(g, a, b, null), `leg (${a.x},${a.z}) → (${b.x},${b.z})`);
  }
});

test('m15: fix #7 — the silent accident shows the blast and fire, one message, and the wing stays ruined after a load', () => {
  const s = m15Sim(), w = s.world;
  const blasts = [];
  w.events.on('explosion', (e) => blasts.push(e));
  s.msgs.length = 0;
  destroyHQ(w, { kind: 'barrel', accident: true, x: HQ_POINT.x, z: HQ_POINT.z });
  s.run(1);
  assert.ok(w.byId('hq').destroyed);
  assert.ok(blasts.some((e) => e.kind === 'structure' && e.accident), 'an accident explosion event drives the FX');
  assert.deepEqual(zoneEvents(w), [], 'still no alarm');
  assert.equal(s.msgs.filter((t) => /headquarters/i.test(t)).length, 1, `one message: ${JSON.stringify(s.msgs)}`);
  const wing = w.structures.get('hq_wing').object3d;
  assert.ok(Math.abs(wing.scale.y - 0.35) < 1e-9, 'the wing is down');
  // a quick load rebuilds the meshes (full-height wing) and restores hq.destroyed: the tick re-applies the ruin
  wing.scale.y = 1; wing.userData.m15Ruined = false;
  m15Tick(w);
  assert.ok(Math.abs(wing.scale.y - 0.35) < 1e-9, 'the wing is down again after a load');
});

test('m15: fix #8 — the uniformed Spy boarding the van in view is not unmasked, and the van stays untainted (§9, Variant B)', () => {
  assert.deepEqual(M().rules.spyMayBoard.slice().sort(), ['car_curb', 'car_yard', 'tanker', 'tram', 'van']);
  const s = m15Sim(), w = s.world, van = s.get('van'), spy = s.cmd('spy'), g = s.get('e24');
  spy.setDisguise(true);
  spy.stance = 'stand';
  spy.setPosition?.(van.x - 3, van.z); spy.x = van.x - 3; spy.z = van.z;
  g.setPosition?.(van.x - 9, van.z + 3); g.x = van.x - 9; g.z = van.z + 3;
  g.heading = Math.atan2(spy.z - g.z, spy.x - g.x); // staring at him from ~7 m
  s.run(0.1);
  assert.ok(spy.useAbility('enterVehicle', van), 'boarding order accepted');
  s.run(4, () => spy.state === 'inVehicle');
  assert.equal(spy.state, 'inVehicle', 'aboard');
  s.run(1);
  assert.equal(s.count('enemy:unmasked-spy'), 0, 'not unmasked');
  assert.ok(spy.disguised && !van.tainted, 'still in uniform, the van untainted');
  assert.deepEqual(zoneEvents(w), [], 'no siren');
});

test('m15: fix #9 — the Driver backs the van out of the cemetery gate with plain straight-line clicks (the dossier route)', () => {
  const s = m15Sim(), w = s.world, van = s.get('van'), dr = s.cmd('driver');
  for (const e of [...w.enemies]) w.remove(e);
  dr.setPosition?.(van.x - 3, van.z); dr.x = van.x - 3; dr.z = van.z;
  assert.ok(van.enter(dr), 'the Driver boards');
  for (const [x, z] of [[54, 19], [49.5, 24.5], [46, 28.5], [22, 24.5]]) {
    assert.ok(van.driveTo(x, z, false), `click (${x}, ${z}) accepted`);
    s.run(25, () => !van.goal);
    assert.ok(Math.hypot(van.x - x, van.z - z) < 1, `reached (${x}, ${z}): van at (${van.x.toFixed(1)}, ${van.z.toFixed(1)})`);
  }
});

test('m15: fix round 2 — the HQ ruin keeps smouldering (smoke over the block and the wing, fire now and then)', () => {
  const s = m15Sim(), w = s.world;
  const spawned = [];
  w.fx = { spawn: (kind, x, z) => spawned.push({ kind, x, z }) };
  m15Tick(w);
  assert.equal(spawned.length, 0, 'nothing while the HQ stands');
  destroyHQ(w, { kind: 'barrel', accident: true, x: HQ_POINT.x, z: HQ_POINT.z });
  for (let i = 0; i < 6 * 60; i++) { m15Tick(w); w.time += 1 / 60; }
  const smoke = spawned.filter((e) => e.kind === 'smoke'), fire = spawned.filter((e) => e.kind === 'fire');
  assert.ok(smoke.length >= 8, `smoke keeps coming: ${smoke.length}`);
  assert.ok(fire.length >= 1, 'some fire');
  const wing = w.structures.get('hq_wing').def;
  assert.ok(smoke.some((e) => Math.hypot(e.x - wing.x, e.z - wing.z) < 5), 'over the wing too');
});
