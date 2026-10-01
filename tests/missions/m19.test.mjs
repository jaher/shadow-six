/**
 * BEL M19 "Frustrate Retaliation" (docs/missions/m19.md): schema + §10.5 test #14 (every start reaches every V2
 * and the boat with the intended abilities — over the trestle on foot, the Marine by water; no start in a cone;
 * every route walkable), the exact §3.8 loadout, the Kildread census, the zones (RN on the N bank, the base's
 * replayed hearing), the bridge charge, the watchtower bomb, the conveyor, the current, the cart, the objectives
 * and the boat extraction.
 * Run with the unit suite: node tests/unit/run.mjs m19
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
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { BRIDGE, BRIDGE_CUT, bridgeDown, northBank } from '../../src/missions/scripts/m19.js';
import { BOAT, CONVEYOR, SWITCH } from '../../src/missions/m19_frustrate_retaliation.js';
import { ABILITIES } from '../../src/abilities/registry.js';
import { canSee, bodiesOf } from '../../src/ai/perception.js';
import { structureDoorPoint } from '../../src/entities/interactables.js';

const M = () => getMission('m19');
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
/** Walkable spots beside each rocket (the S side of its pad) and on the shore by the boat. */
const V2_SPOTS = { v2_w: { x: 118, z: 43.5 }, v2_m: { x: 130, z: 40.5 }, v2_e: { x: 141, z: 50.5 } };
const SHORE = { x: 127, z: 19 };

test('m19: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [151, 104]);
  assert.equal(m.par.time, 840);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.coneColors, 'green');
  assert.ok(m.briefing.text && m.briefing.historical && m.briefing.hints.length >= 5);
  assert.ok(!m.alarmFail, 'no special fail (§8): an alarm is survivable');
});

test('m19: §10.5 #14 — loads; no start in a cone; routes walkable; every start reaches the V2s and the boat', () => {
  // the checker paths the escape boat on foot (no swim): the rowboat is rowed over deep water, checked below
  assert.deepEqual(checkMission(M()).filter((p) => p !== 'escape vehicle boat cannot reach its exit'), []);
  const { grid: g } = loadGrid(M());
  assert.ok(reach(g, BOAT, { x: 124, z: 1 }, 'diver', { swim: true }), 'the boat goes down the river to the N-edge exit');
  for (const c of M().commandos) {
    // on foot over the trestle (the S gate is open), nobody swims
    for (const [id, p] of Object.entries(V2_SPOTS)) assert.ok(reach(g, c, p, c.role), `${c.role} walks to ${id}`);
    assert.ok(reach(g, c, SHORE, c.role), `${c.role} walks to the boat's shore`);
  }
  const ma = M().commandos.find((c) => c.role === 'diver');
  assert.ok(reach(g, ma, { x: 44, z: 92 }, 'diver', { swim: true }), 'the Marine swims to the SE bank\'s SW shore (Phase 3)');
  assert.ok(reach(g, ma, BOAT, 'diver', { swim: true }), 'the Marine swims to the boat');
});

test('m19: the GB climbs the white wall and the palisade by the switch; nobody else does; the belt is the others\' way in', () => {
  const { grid: g } = loadGrid(M());
  // shut the S gate for this check (it stands open at the start)
  g.fillOrientedRect(122, 81.5, 4.6, 1.4, Math.atan2(-1, 4), 'block', B.HIGH);
  const out = { x: 101.5, z: 92 }, inside = { x: 104.5, z: 76 };
  assert.ok(reach(g, out, inside, 'greenberet'), 'GB over the white wall');
  for (const r of ['sniper', 'sapper', 'diver']) assert.ok(!reach(g, out, inside, r, { swim: r === 'diver' }), `${r} cannot get in with the gate shut`);
  assert.ok(reach(g, { x: 96, z: 65.5 }, { x: 101, z: 67 }, 'greenberet'), 'GB over the palisade at the switch');
  assert.ok(g.walkableAt(...CONVEYOR.exit), 'the belt sets riders down on a walkable spot inside');
  assert.ok(g.walkableAt(CONVEYOR.a[0], CONVEYOR.a[1]), 'the belt foot is reachable');
});

test('m19: §3.8 row 19 loadout exactly (Sniper 7 rounds + medic, Sapper trap + 2 remotes, Marine no raft; rowboat + 4 barrels)', () => {
  const L = belLoadout(19);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, M().commandos.find((c) => c.role === r).inventory);
  assert.equal(inv('sniper').sniperRifle, 7);
  assert.equal(inv('sapper').remoteBomb, 2);
  assert.equal(inv('sapper').bearTrap, 1);
  assert.ok(!inv('sapper').grenade && !inv('sapper').timeBomb, 'no grenades, no time bombs');
  assert.ok(!inv('diver').inflatableBoat, 'no raft: the rowboat is on site');
  assert.equal(L.medic, 'sniper');
  const boat = M().vehicles.find((v) => v.id === 'boat');
  assert.equal(boat.vehicleType, 'rowboat');
  assert.deepEqual(boat.operators, ['diver']);
  assert.equal(M().structures.filter((s) => s.explosive === 'barrel').length, L.site.barrels);
});

test('m19: enemy census = Kildread (21 walkers, 13 + 2 sentries, patrols 2/3/4/4/4, 3 MG, bunker, tower, Panzer II, driver, 3 garrisons, 4 dogs)', () => {
  const es = M().enemies;
  const walkers = es.filter((e) => e.soldierType === 'soldier' && e.route && !e.squad);
  assert.equal(walkers.length, 21, 'walkers');
  const sentries = es.filter((e) => e.soldierType === 'sentry' && !e.tower);
  assert.equal(sentries.length, 15, '13 isolated + e35 [P] + e51 [img]');
  assert.equal(es.filter((e) => e.tower === 'tower').length, 1, 'the tower gunner');
  const squads = {};
  for (const e of es.filter((q) => q.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(Object.values(squads).sort(), [2, 3, 4, 4, 4]);
  assert.equal(es.filter((e) => e.soldierType === 'mg').length, 3);
  assert.deepEqual(es.filter((e) => e.structure).map((e) => e.structure), ['bunker_n']);
  const dogs = es.filter((e) => e.soldierType === 'dog');
  assert.equal(dogs.length, 4);
  assert.equal(dogs.filter((d) => d.caged).length, 1, 'one caged dog');
  for (const d of dogs.filter((q) => q.handler)) assert.equal(es.find((e) => e.id === d.handler)?.soldierType, 'sergeant', `${d.id} heels to a patrol sergeant`);
  const men = es.filter((e) => e.soldierType !== 'dog' && !e.vehicle);
  assert.equal(men.length, 58, '59 men on the map (e1–e60 without e23), the lorry driver aboard');
  assert.ok(!men.some((e) => e.id === 'e23'), 'Prima\'s 23 is the caged dog');
  const V = Object.fromEntries(M().vehicles.map((v) => [v.id, v]));
  assert.equal(V.tk1.vehicleType, 'panzer2');
  assert.equal(es.filter((e) => e.vehicle === 'tk1').length, 2, 'the tank crew');
  assert.deepEqual(es.filter((e) => e.vehicle === 'lt').map((e) => e.soldierType), ['truckDriver']);
  assert.equal(V.cart.vehicleType, 'mine_cart');
  assert.deepEqual(Object.keys(M().barracks).sort(), ['barr_n', 'barr_s', 'office']);
  for (const id of Object.keys(M().barracks)) assert.ok(M().structures.find((s) => s.id === id).flag, `${id} flies a flag`);
  assert.equal(M().barracks.office.squads[0].event, 'RN', 'the office answers the N-bank alarm');
});

test('m19: zones — RN near the N bunker (seen only), RINT in the base (seen; hearing replayed by the script)', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  const zs = Object.fromEntries(M().zones.map((z) => [z.id, z]));
  assert.equal(zs.z_n.onSeen, 'RN');
  assert.equal(zs.z_n.onHeard, null, 'shots by the start do not alarm the bunker [K]');
  assert.equal(zs.z_base.onSeen, 'RINT');
  assert.equal(a.zoneAt(43, 18.5)?.id, 'z_n');
  assert.equal(a.zoneAt(130, 50)?.id, 'z_base');
  assert.equal(a.zoneAt(121, 28)?.id, 'z_base', 'the tower foot');
  for (const [x, z] of [[40, 2], [15, 40], [30, 60], [60, 90], [90, 75]]) assert.equal(a.zoneAt(x, z), null, `(${x}, ${z}) is outside every zone`);
  assert.ok(northBank(40, 3) && northBank(50, 45) && !northBank(90, 70) && !northBank(130, 50), 'north-bank test');
});

/** Full M19 sim with live brains, the alarm, the director (set-pieces, triggers, script) and the objectives. */
function m19Sim({ brains = true } = {}) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.flags = {};
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  w.objectives = createObjectives(s.mission.objectives);
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  s.run(0.1);
  // park the team behind the start mound (out of every cone)
  return s;
}
const o = (w, id) => w.objectives.find((q) => q.id === id);
const fired = (w, ev) => w.alarm.zonesFired.filter((f) => f.event === ev).length;

test('m19 hook: the team starts prone; a pistol shot at the start alarms nobody', () => {
  const s = m19Sim(), w = s.world;
  for (const c of w.commandos) assert.equal(c.stance, 'crawl', `${c.role} prone`);
  w.emitNoise(39, 3, 18, 'pistol', s.cmd('sniper'));
  s.run(0.5);
  assert.equal(fired(w, 'RN'), 0);
  assert.equal(fired(w, 'RINT'), 0);
});

test('m19 hook: the bridge charge drops mid-span (river again), kills whoever is on it, stops the cart, fires RN only; the tank sorties', () => {
  const s = m19Sim(), w = s.world, g = w.grid;
  const mid = { x: BRIDGE.x, z: BRIDGE.z };
  assert.ok(g.walkableAt(mid.x, mid.z) && !bridgeDown(w), 'the trestle is walkable');
  const e = s.get('e40');
  e.x = mid.x + 2; e.z = mid.z + 1; e.stop?.();
  const tk = s.get('tk1'), z0 = tk.z;
  applyExplosion(w, mid.x - 1, mid.z, 'bomb', null);
  s.run(0.3);
  assert.ok(bridgeDown(w), 'down');
  assert.ok(!g.walkableAt(mid.x, mid.z) && g.isWater(Math.floor(mid.x / g.cell), Math.floor(mid.z / g.cell)), 'mid-span is river');
  assert.ok(g.walkableAt(60, 51) && g.walkableAt(77, 59.5), 'the two ends still stand');
  assert.equal(e.alive, false, 'the man on the span goes into the river');
  assert.ok(s.msgs.some((m) => /bridge is down/.test(m)));
  assert.equal(fired(w, 'RN'), 1, 'RN: the N-bank alarm');
  assert.equal(fired(w, 'RINT'), 0, 'the base 33 m away hears nothing [P]');
  assert.ok(!w.alarm.active, 'no siren');
  assert.ok(s.msgs.some((m) => /Alarm on the north bank/.test(m)), 'T3');
  assert.ok(w.alarm.barracks.office.squads[0].released, 'the office squad comes out');
  assert.ok(w.railBlocks.some((b) => Math.hypot(b.x - mid.x, b.z - mid.z) < 3), 'the track is broken');
  s.run(8);
  assert.ok(tk.z > z0 + 6, `the Panzer II leaves its shed (z ${tk.z.toFixed(1)})`);
  const grid = g;
  assert.ok(!reach(grid, { x: 50, z: 45 }, { x: 90, z: 65 }, 'sapper'), 'the N bank is cut off on foot');
  assert.ok(reach(grid, { x: 50, z: 45 }, { x: 90, z: 65 }, 'diver', { swim: true }), 'the Marine can still swim across');
  const n = w.enemies.filter((q) => q.alive && northBank(q.x, q.z) && q.soldierType !== 'dog');
  assert.ok(n.length && n.every((q) => q.alertLevel >= 2), 'the N bank is on alert');
  // the bang itself is map-wide noise (§4.4): the base may look round, but no siren and nobody leaves a barracks
  assert.ok(!w.alarm.active && fired(w, 'RINT') === 0, 'still no siren in the base');
  assert.ok(!w.alarm.barracks.barr_n.squads[0].released && !w.alarm.barracks.barr_s.squads[0].released, 'the base garrisons stay in');
});

test('m19 hook: the cart shuttles over the trestle; after the charge it never passes the break', () => {
  const s = m19Sim({ brains: false }), w = s.world, cart = s.get('cart');
  let minX = cart.x;
  s.run(80, () => { minX = Math.min(minX, cart.x); return false; });
  assert.ok(minX < BRIDGE.x - 5, `the cart crosses to the mine side (min x ${minX.toFixed(1)})`);
  const s2 = m19Sim({ brains: false }), w2 = s2.world, c2 = s2.get('cart');
  applyExplosion(w2, BRIDGE.x, BRIDGE.z, 'bomb', null);
  let min2 = c2.x;
  s2.run(200, () => { min2 = Math.min(min2, c2.x); return false; });
  assert.ok(min2 > BRIDGE.x + 2, `the cart stops short of the break (min x ${min2.toFixed(1)})`);
  void w;
});

test('m19 hook: the base hears — shots near its men sound the siren, the caged dog\'s bark does not; a blast within 25 m does, farther does not', () => {
  const s = m19Sim({ brains: false }), w = s.world;
  applyExplosion(w, 70, 36, 'bomb', null); // on the N bank, ~33 m from the palisade zone
  s.run(0.3);
  assert.equal(fired(w, 'RINT'), 0, 'a distant blast is not the base\'s business');
  const d3 = s.get('d3');
  w.emitNoise(d3.x, d3.z, 18, 'bark', d3);
  s.run(0.2);
  assert.equal(fired(w, 'RINT'), 0, 'the caged dog barks: a cue the guards investigate, not the siren [K]');
  w.emitNoise(112, 66, 18, 'pistol', s.cmd('greenberet'));
  s.run(0.2);
  assert.equal(fired(w, 'RINT'), 1, 'a pistol shot by the pen');
  assert.ok(w.alarm.active, 'siren');
  assert.ok(w.alarm.barracks.barr_s.squads[0].released && w.alarm.barracks.barr_n.squads[0].released, 'both base garrisons turn out');
  const s2 = m19Sim({ brains: false }), w2 = s2.world;
  applyExplosion(w2, 110, 100, 'bomb', null); // S of the base, 10 m off the zone
  s2.run(0.3);
  assert.equal(fired(w2, 'RINT'), 1, 'a blast by the base is heard');
  const s3 = m19Sim({ brains: false }), w3 = s3.world;
  w3.emitNoise(128, 45, 18, 'pistol', s3.cmd('greenberet'));
  s3.run(0.2);
  assert.equal(fired(w3, 'RINT'), 1, 'a pistol shot among the barracks');
  const s4 = m19Sim({ brains: false }), w4 = s4.world;
  w4.emitNoise(60, 95, 18, 'pistol', s4.cmd('diver'));
  s4.run(0.2);
  assert.equal(fired(w4, 'RINT') + fired(w4, 'RN'), 0, 'pistol lures on the SE bank\'s SW shore raise no alarm [K]');
});

test('m19 hook: bombs and barrels take the V2s (rocket + pad); o1 on the third; a barrel razes a barracks', () => {
  const s = m19Sim({ brains: false }), w = s.world;
  for (const id of ['v2_w', 'v2_m', 'v2_e']) assert.ok(w.byId(id) && !w.byId(id).destroyed, `${id} standing`);
  applyExplosion(w, 118, 43, 'bomb', null);
  s.run(0.3);
  assert.ok(w.byId('v2_w').destroyed, 'a remote bomb by the W rocket');
  assert.ok(s.msgs.some((m) => /1 of 3 rockets/.test(m)), 'T4');
  applyExplosion(w, 131, 40.5, 'barrel', null);
  s.run(0.3);
  assert.ok(w.byId('v2_m').destroyed, 'a barrel by the middle rocket');
  assert.ok(!o(w, 'o1').done);
  // a barrel between the E rocket and barr_n takes both [P][ooc]
  applyExplosion(w, 139, 46.5, 'barrel', null);
  s.run(0.3);
  assert.ok(w.byId('v2_e').destroyed, 'the E rocket');
  assert.ok(w.alarm.barracks.barr_n.destroyed, 'barr_n razed: it sends nobody');
  assert.ok(o(w, 'o1').done, 'o1 done');
  assert.ok(s.msgs.some((m) => /launch site is finished/.test(m)), 'T5');
  assert.ok(!o(w, 'o2').done, 'o2 waits for the boat');
});

test('m19 hook: a bomb at the watchtower\'s legs kills the gunner; the tower stays up', () => {
  const s = m19Sim({ brains: false }), w = s.world, e52 = s.get('e52');
  assert.ok(e52.alive && e52.y > 5, 'the gunner is on the platform');
  applyExplosion(w, 121, 29.2, 'bomb', null);
  s.run(0.3);
  assert.equal(e52.alive, false, 'gunner dead');
  assert.ok(s.msgs.some((m) => /watchtower gunner is dead/.test(m)));
  assert.ok(w.grid.elevAt(121, 26.5) > 5, 'the platform still stands');
});

test('m19 hook: the conveyor runs out of the base until its switch (red lamp) is thrown; then it carries a crawling man inside', () => {
  const s = m19Sim({ brains: false }), w = s.world;
  const sw = w.interactables.find((i) => (i.tag ?? i.id) === 'conv_switch');
  assert.ok(sw && Math.hypot(sw.x - SWITCH[0], sw.z - SWITCH[1]) < 0.1, 'the switch device');
  assert.ok(sw.blink, 'its lamp flashes');
  const sa = s.cmd('sapper'), gb = s.cmd('greenberet');
  const [ax, az] = CONVEYOR.a, [bx, bz] = CONVEYOR.b, L = Math.hypot(bx - ax, bz - az);
  const at = (t) => ({ x: ax + ((bx - ax) * t) / L, z: az + ((bz - az) * t) / L });
  Object.assign(sa, at(4)); sa.setStance?.('crawl');
  Object.assign(gb, at(6)); gb.setStance?.('stand');
  s.run(2);
  const d = Math.hypot(sa.x - ax, sa.z - az);
  assert.ok(d < 2.5, `running outwards it carries him back to the foot (${d.toFixed(1)} m)`);
  assert.ok(Math.hypot(gb.x - at(6).x, gb.z - at(6).z) < 0.3, 'a standing man is not carried');
  assert.equal(sw.interact(gb), true, 'thrown');
  assert.ok(s.msgs.some((m) => /belt now runs into the base/.test(m)), 'T2');
  s.run(20);
  assert.ok(Math.hypot(sa.x - CONVEYOR.exit[0], sa.z - CONVEYOR.exit[1]) < 0.5, `set down inside (${sa.x.toFixed(1)}, ${sa.z.toFixed(1)})`);
  assert.ok(w.alarm.zoneAt(sa.x, sa.z)?.id === 'z_base' && sa.x > 99, 'inside the palisade');
});

test('m19 hook: the fast river — no rowing upstream, an idle boat drifts NE, the moored boat stays put', () => {
  const s = m19Sim({ brains: false }), w = s.world, boat = s.get('boat');
  s.run(20);
  assert.ok(Math.hypot(boat.x - BOAT.x, boat.z - BOAT.z) < 0.2, 'moored: no drift before it is used');
  boat.x = 95; boat.z = 30; boat.stop?.();
  assert.equal(boat.canDriveTo(85, 40), false, 'upstream (SW): refused');
  assert.ok(s.msgs.some((m) => /too strong to row upstream/.test(m)));
  assert.equal(boat.canDriveTo(102, 22), true, 'downstream (NE): fine');
  s.run(3);
  assert.ok(boat.x > 97 && boat.z < 28, `an idle boat drifts downstream (${boat.x.toFixed(1)}, ${boat.z.toFixed(1)})`);
});

test('m19 hook: boat before o1 waits; V2s gone + everyone aboard → out by the N edge → win; the boat lost is a loss', () => {
  const s = m19Sim(), w = s.world, boat = s.get('boat');
  for (const e of w.enemies) e.die('test', null); // a cleared map (the guards would answer the blasts)
  const ma = s.cmd('diver'), gb = s.cmd('greenberet');
  gb.x = SHORE.x; gb.z = SHORE.z; gb.stop?.();
  s.run(0.3);
  assert.ok(s.msgs.some((m) => /Keep it for the way out/.test(m)), 'T6');
  const board = (c) => { c.x = boat.x + 0.5; c.z = boat.z + 1.5; c.stop?.(); return boat.enter(c); };
  assert.equal(board(ma), true, 'the Marine boards first');
  for (const c of w.commandos) if (c !== ma) assert.equal(board(c), true, `${c.role} boards in the shallows`);
  s.run(2);
  assert.notEqual(s.flags.evacPhase, 'leave', 'not before the rockets are gone');
  for (const [x, z] of [[118, 43], [130, 40.5], [141, 50.5]]) applyExplosion(w, x, z, 'bomb', null);
  s.run(0.5);
  assert.ok(o(w, 'o1').done);
  s.run(0.5);
  assert.equal(s.flags.evacPhase, 'leave', 'the boat pushes off');
  const won = s.run(40, () => o(w, 'o2').done);
  assert.ok(won, `out by the N edge (${boat.x.toFixed(1)}, ${boat.z.toFixed(1)})`);
  assert.ok(!w.scriptFail);
  const s2 = m19Sim({ brains: false });
  s2.get('boat').destroy(null, 'test');
  s2.run(0.5);
  assert.match(String(s2.world.scriptFail), /BOAT HAS BEEN DESTROYED/);
  assert.doesNotMatch(String(s2.world.scriptFail), /YOU DESTROYED/, 'neutral: the guards may have done it (playtest s_g1)');
});

test('m19: Prima\'s key sightlines — the Sniper at the shed\'s SE corner sees e3 on the pithead roof; the pithead and the tower are raised', () => {
  const { grid: g } = loadGrid(M());
  assert.equal(g.elevAt(8.5, 28), 4.5, 'e3 stands on the pithead roof');
  assert.equal(g.elevAt(121, 26.5), 5.5, 'the watchtower platform');
  assert.ok(g.lineOfSight(35, 24.5, 8.5, 28, { targetY: 4.5 + 1.7 }), 'shot on e3 from the shed corner (round 1)');
  assert.ok(reach(g, { x: 8.5, z: 24 }, { x: 8.5, z: 30 }, 'sniper'), 'up the pithead ladder to the roof');
  for (const [x, z] of BRIDGE_CUT) assert.ok(Number.isFinite(x) && Number.isFinite(z));
});

// ---------------------------------------------------------------- playtest fixes (review round 1)

const barrelOf = (w, id) => w.interactables.find((i) => (i.tag ?? i.id) === id);

test('m19 fix: the plank palisade is opaque — the guards inside never see the boat shore (playtest s_g1: the boarding seen through it)', () => {
  const s = m19Sim({ brains: false }), w = s.world, g = w.grid;
  for (const [x, z] of [[127, 45], [147, 37], [128.5, 41], [126, 52], [140, 40]]) {
    for (const [bx, bz] of [[127, 19], [128.2, 22.4], [126, 25]]) assert.ok(!g.lineOfSight(x, z, bx, bz, {}), `(${x}, ${z}) → (${bx}, ${bz}) is blind`);
  }
  const sn = s.cmd('sniper'), e32 = s.get('e32'), e33 = s.get('e33');
  sn.x = 128.2; sn.z = 22.4; sn.setStance('stand');
  for (const e of [e32, e33]) { e.heading = Math.atan2(sn.z - e.z, sn.x - e.x); assert.equal(canSee(e, sn, w), 'none', `${e.id} does not see a standing man on the shore`); }
  const boat = s.get('boat');
  assert.equal(canSee({ ...e32, heading: Math.atan2(boat.z - e32.z, boat.x - e32.x), vision: e32.vision, alive: true }, boat, w, { dynamic: false }), 'none', 'nor the boat');
});

test('m19 fix: the canonical endgame — barrels by v2_m and v2_e, the Sniper fires them from the N shore through the planks (playtest: no way to do it)', () => {
  const s = m19Sim({ brains: false }), w = s.world, g = w.grid;
  const sn = s.cmd('sniper');
  sn.x = 128.2; sn.z = 22.4; sn.setStance('stand'); sn.stop?.();
  const b1 = barrelOf(w, 'barrel_1'), b2 = barrelOf(w, 'barrel_2');
  b1.x = 130; b1.z = 34.5; // N of the middle rocket
  b2.x = 143; b2.z = 45; // NE of the E rocket
  s.run(0.1);
  for (const b of [b1, b2]) {
    assert.ok(!g.lineOfSight(sn.x, sn.z, b.x, b.z, {}), 'the planks hide it from the eye');
    assert.equal(ABILITIES.sniper.canUse(sn, b, w), true, `the rifle reaches ${b.id ?? b.tag} through the fence`);
  }
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: b1 }), 'order accepted');
  s.run(2.5);
  assert.ok(w.byId('v2_m').destroyed, 'the middle rocket goes up');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: b2 }), 'second order accepted');
  s.run(2.5);
  assert.ok(w.byId('v2_e').destroyed, 'the E rocket goes up');
  // the pistol has no such reach at a man behind the planks (only a rifle round goes through)
  const gb = s.cmd('greenberet'), e31 = s.get('e31');
  gb.x = 116; gb.z = 29; e31.x = 116; e31.z = 37; gb.setStance('stand');
  assert.equal(ABILITIES.pistol.canUse(gb, e31, w), 'No line of sight.');
});

test('m19 fix: the caged dog shot through the pen rails from the S edge raises nothing; its body alarms nobody; the bark is no siren (playtest s_d5)', () => {
  const s = m19Sim(), w = s.world;
  const sn = s.cmd('sniper'), d3 = s.get('d3');
  sn.x = 110; sn.z = 98; sn.setStance('stand'); sn.stop?.();
  s.run(0.2);
  assert.equal(ABILITIES.sniper.canUse(sn, d3, w), true, 'in the rifle\'s line through the fence and the pen rails');
  const witnesses = ['e24', 'e26', 'e28'].filter((id) => canSee(s.get(id), { x: d3.x, z: d3.z, kind: 'body', alive: false }, w) !== 'none');
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: d3 }));
  s.run(2);
  assert.equal(d3.alive, false, 'the dog is dead');
  assert.ok(!bodiesOf(w).includes(d3), 'its body is nobody\'s business');
  s.run(30);
  assert.equal(fired(w, 'RINT'), 0, `no siren (guards with the pen in view at the shot: ${witnesses.join(',') || 'none'})`);
  assert.ok(!w.alarm.active);
  for (const id of ['e24', 'e26', 'e28']) assert.notEqual(s.get(id).brain.state, 'COMBAT', `${id} is not hunting`);
});

test('m19 fix: a silent rifle kill from outside the fence sends nobody to the shooter (playtest s_g3: the Sniper at (126,25) hunted down)', () => {
  const s = m19Sim(), w = s.world;
  const sn = s.cmd('sniper'), e33 = s.get('e33');
  sn.x = 126; sn.z = 25; sn.setStance('crawl'); sn.stop?.();
  s.run(0.2);
  assert.equal(ABILITIES.sniper.canUse(sn, e33, w), true);
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: e33 }));
  s.run(2);
  assert.equal(e33.alive, false);
  let near = null;
  s.run(90, () => { near = w.enemies.find((e) => e.alive && !e.removed && e.soldierType !== 'dog' && Math.hypot(e.x - sn.x, e.z - sn.z) < 8 && (e.tag ?? e.id) !== 'e52'); return !!near; });
  assert.ok(!near, `nobody comes to the shooter (${near?.tag ?? near?.id} ${near?.brain?.state} t${w.time.toFixed(0)})`);
  assert.ok(sn.alive, 'the Sniper lives');
  for (const e of w.enemies) if (e.alive && e.lastSeen?.target === sn) assert.ok(Math.hypot(e.lastSeen.x - sn.x, e.lastSeen.z - sn.z) > 8, `${e.id} never placed the shooter`);
});

test('m19 fix: the base squads go back in 120 s after the siren stops; a new siren sends them out again (playtest s_k9/s_r2: 400 s blocked)', () => {
  const s = m19Sim(), w = s.world;
  w.alarm.fireEvent('RINT', { zoneId: 'z_base', cause: 'test', x: 130, z: 60 });
  s.run(0.5);
  const sq = (id) => w.alarm.barracks[id].squads[0];
  const out = [...sq('barr_n').members, ...sq('barr_s').members];
  assert.equal(out.length, 6, 'two squads of three turn out');
  const pool0 = w.alarm.barracks.barr_n.pool + w.alarm.barracks.barr_s.pool;
  s.run(25 + 100);
  assert.ok(!w.alarm.active, 'the siren has stopped');
  assert.ok(out.every((e) => e.alive && !e.removed), 'still out before the 120 s');
  const home = s.run(140, () => out.every((e) => e.removed));
  assert.ok(home, `all six back in (${out.filter((e) => !e.removed).map((e) => `${e.id}@${e.x.toFixed(0)},${e.z.toFixed(0)}/${e.brain?.state}`).join(' ')})`);
  assert.equal(w.alarm.barracks.barr_n.pool + w.alarm.barracks.barr_s.pool, pool0 + 6, 'back in the pool');
  assert.ok(!sq('barr_n').released && !sq('barr_s').released);
  w.alarm.fireEvent('RINT', { zoneId: 'z_base', cause: 'test', x: 130, z: 60 });
  s.run(0.5);
  assert.equal(sq('barr_n').members.length + sq('barr_s').members.length, 6, 'out again on the next siren');
  assert.ok(sq('barr_n').members.every((e) => !out.includes(e)), 'fresh men');
});

test('m19 fix: every enterable hideout\'s door point sits just outside its own walls (numeric door sides)', () => {
  for (const st of M().structures.filter((q) => q.enterable)) {
    const [x, z] = structureDoorPoint(st);
    const dx = Math.abs(x - st.x), dz = Math.abs(z - st.z);
    const out = dx > st.w / 2 || dz > st.d / 2;
    assert.ok(out && dx <= st.w / 2 + 1.5 && dz <= st.d / 2 + 1.5, `${st.id} door (${x.toFixed(1)}, ${z.toFixed(1)}) beside (${st.x}, ${st.z})`);
  }
});

test('m19 census note: 15 isolated sentries = Kildread\'s 13 + Prima\'s 35 + the shore guard on the fan map, documented in the header', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/missions/m19_frustrate_retaliation.js', import.meta.url), 'utf8');
  assert.match(src, /e35[^\n]*e51|e51[^\n]*e35/, 'the two extra sentries are named in the deviations');
});
