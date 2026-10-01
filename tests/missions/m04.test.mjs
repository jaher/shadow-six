/**
 * BEL M4 "Restore Pride" (docs/missions/m04.md): schema + §10.5 test #14, the loadout, the enemy roster from the
 * retail file, the bridge / ladder / pier geometry, zones, the arch collapse, the air-drop, the objective and
 * boat-escape wiring, and the script (crossing booms, lorry errands, courier bike, no vehicles on the bridge).
 * Run with the unit suite: node tests/unit/run.mjs m04
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { makeSim } from '../unit/abilsim.mjs';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { bridgeRule, TRUCK_STOPS, RAIL_GUARD } from '../../src/missions/scripts/m04.js';
import { P7_RINT, COURIER_RUN, BOAT } from '../../src/missions/m04_restore_pride.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const M = () => getMission('m04');

test('m04: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m04: §10.5 #14 — loads; every start reaches the villa, its steps and the boat; no start in a cone; routes walkable', () => {
  // mission-check samples every enemy's cone; the lorry driver has none (truckDriver: vision null) and rides the cab
  const m = M();
  assert.deepEqual(checkMission({ ...m, enemies: m.enemies.filter((e) => e.soldierType !== 'truckDriver') }), []);
});

const path = (g, a, b, o = {}) => findPath(g, a.x, a.z, b.x, b.z, { maxNodes: 400000, ...o });
const START = { x: 3, z: 165 };

test('m04: §3.8 row 4 loadout (GB shovel; Sniper 4 rounds; Sapper trap + 3 grenades, no bomb; Driver medic, no SMG; Marine raft)', () => {
  const L = belLoadout(4);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, M().commandos.find((c) => c.role === r).inventory);
  assert.equal(inv('sniper').sniperRifle, 4);
  assert.equal(inv('sapper').grenade, 3);
  assert.ok(!inv('sapper').timeBomb && !inv('driver').smg, 'bomb and SMG only from the air-drop');
  assert.equal(inv('diver').inflatableBoat, 1, '§3.8 row 4: the Marine carries the raft (IT_BALSA)');
  const crate = M().interactables.find((i) => i.id === 'drop');
  assert.deepEqual(crate.contents, { timeBomb: 1, sniperRifle: 3, smg: 20 });
});

test('m04: roster = the retail file (10 walkers, 24 posts, 3 MG, a 5-man and five 3-man patrols, courier, driver: 59)', () => {
  const m = M();
  assert.equal(m.enemies.length, 59);
  const squads = {};
  for (const e of m.enemies) if (e.squad) (squads[e.squad.id] ||= []).push(e.id);
  assert.deepEqual(Object.values(squads).map((s) => s.length).sort(), [3, 3, 3, 3, 3, 5]);
  const solo = m.enemies.filter((e) => !e.squad);
  assert.equal(solo.filter((e) => e.soldierType === 'soldier' && e.route).length, 10, 'walkers');
  assert.equal(solo.filter((e) => e.soldierType === 'sentry').length, 24, 'posts');
  assert.equal(solo.filter((e) => e.soldierType === 'mg').length, 3, 'MG gunners');
  assert.equal(solo.filter((e) => e.soldierType === 'courier').length, 1);
  assert.equal(solo.filter((e) => e.soldierType === 'truckDriver').length, 1);
  for (const g of ['mg_br_gun', 'mg_x_gun', 'mg_pier_gun']) assert.ok(m.enemies.some((e) => e.emplacement === g), g);
  assert.deepEqual(Object.keys(m.barracks).sort(), ['garr1', 'garr2', 'jail_hut']);
  assert.deepEqual(m.jails, ['jail_hut']);
  assert.equal(m.par.time, 755);
});

/** Does any cell of this world path carry the bridge layer inside `poly` (x/z box)? */
const crosses = (g, p, [x0, x1, z0, z1]) => p.some((q) => q.x >= x0 && q.x <= x1 && q.z >= z0 && q.z <= z1 && g.bridge[g.idx(...Object.values(g.worldToCell(q.x, q.z)))]);

test('m04: the inlet splits the map — on foot the NE bank is reached only over the rail bridge; no shallow shore (only the raft rims)', () => {
  const { grid: g } = loadGrid(M());
  const ne = { x: 130, z: 100 };
  const p = path(g, START, ne, { role: 'sapper' });
  assert.ok(p, 'SW start → NE bank on foot');
  assert.ok(crosses(g, p, [96, 123, 119, 147]), 'the path runs over the trestle deck');
  // cut the deck: no dry route remains (the Marine can still swim)
  g.fillPoly([[96.1, 142.3], [119.6, 118.8], [124.9, 124.1], [101.4, 147.6]], 'block', 2);
  assert.equal(path(g, START, ne, { role: 'sapper' }), null, 'no second land bridge');
  assert.ok(path(g, START, ne, { role: 'diver', swim: true }), 'the Marine swims');
  // no shallow shore anywhere; the only wading cells are the raft rims round the wreck and along the landing stage
  const stray = [];
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    if (g.terrain[g.idx(i, j)] !== 6) continue;
    const c = g.cellCenter(i, j);
    const wreck = Math.hypot(c.x - 119.3, c.z - 144.8) < 5, stage = c.x > 40.5 && c.x < 42.7 && c.z > 72.5 && c.z < 77.5;
    if (!wreck && !stage) stray.push(`(${c.x}, ${c.z})`);
  }
  assert.equal(stray.length, 0, `shallow cells off the raft rims: ${stray.slice(0, 5).join(' ')}`);
  // the rims lead nowhere on foot: from the wreck only the pillar ladder, from the landing stage only the pier ladder
  const noLadders = { ...M(), ladders: [] };
  const { grid: g2 } = loadGrid(noLadders);
  assert.equal(path(g2, { x: 118.8, z: 145.5 }, START, { role: 'sapper' }), null, 'wreck: no way off but the ladder');
  assert.equal(path(g2, { x: 37, z: 75 }, { x: 60, z: 50 }, { role: 'sapper' }), null, 'landing stage: no way off but the ladder');
});

test('m04: ladders — the sunken tank only by the E-pillar ladder, the landing stage only by the pier ladder (on foot)', () => {
  const { grid: g } = loadGrid(M());
  const byEnd = (x, z) => g.links.find((l) => Math.hypot(l.a.x - x, l.a.z - z) < 1.5);
  const deck = { x: 111, z: 131.5 }, wreck = { x: 119.3, z: 144.8 }, pier = { x: 36.5, z: 67.5 }, stage = { x: 37, z: 75.5 };
  assert.ok(path(g, deck, wreck), 'deck → sunken tank');
  assert.ok(path(g, pier, stage), 'pier → landing stage');
  g.setLinkEnabled(byEnd(118.6, 143.3).id, false);
  g.setLinkEnabled(byEnd(36.7, 74.2).id, false);
  assert.equal(path(g, deck, wreck), null, 'no dry way down to the wreck');
  assert.equal(path(g, pier, stage), null, 'no dry way down to the landing stage');
  assert.ok(path(g, { x: 110, z: 140 }, wreck, { role: 'diver', swim: true }), 'from the water onto the wreck (raft / diver entry point)');
  assert.ok(path(g, { x: 40, z: 80 }, stage, { role: 'diver', swim: true }), 'from the water onto the landing stage');
});

test('m04: arch — the corridor reaches the inner yard only through the arch; any explosion within 3 m seals it for good', () => {
  const s = makeSim(M(), { brains: false });
  const g = s.world.grid;
  const corridor = { x: 106, z: 44 }, yard = { x: 78, z: 42 }, garr1 = { x: 101.3, z: 11.3 };
  assert.ok(path(g, corridor, yard), 'corridor → yard through the arch');
  assert.ok(path(g, garr1, yard), 'garrison 1 → yard');
  applyExplosion(s.world, 95.5, 52.5, 'grenade'); // 4.1 m off: nothing
  assert.ok(path(g, corridor, yard), 'a grenade 4 m off leaves the arch standing');
  applyExplosion(s.world, 95.6, 50.2, 'grenade');
  assert.equal(path(g, corridor, yard), null, 'sealed');
  assert.equal(path(g, garr1, yard), null, 'r0 cannot reach the yard');
  assert.ok(path(g, garr1, corridor), 'the squads still pour into the corridor');
});

test('m04: zones — the SW bank, the bridge head, the crossing, the forests and the SE are silent; the HQ, gate and walls are not', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const c of M().commandos) assert.equal(a.zoneAt(c.x, c.z), null, `${c.role} start`);
  for (const [x, z] of [[39.4, 103.6], [97.7, 153.8], [119.4, 116.8], [165, 77.5], [180.8, 33.4], [158.8, 126.5], [142.3, 84.2]]) {
    assert.equal(a.zoneAt(x, z), null, `(${x},${z}) silent`);
  }
  const Z = (x, z) => a.zoneAt(x, z)?.id;
  assert.equal(Z(STEPS().x, STEPS().z), 'z_hq');
  assert.equal(Z(37.5, 67.6), undefined, 'the pier lies below the plateau, outside z_hq');
  assert.equal(Z(52, 59), 'z_hq', 'the stair head');
  assert.equal(Z(59.4, 63), 'z_hq', 'the pier MG nest on the cliff top');
  assert.equal(Z(106, 44), 'z_hq', 'the corridor');
  assert.equal(Z(123, 63.5), 'z_front', 'the road in front of the gate');
  assert.equal(Z(95.3, 69), 'z_front', 'the jail hut');
  const ev = Object.fromEntries(M().zones.map((z) => [z.id, z.onSeen]));
  assert.deepEqual(ev, { z_hq: 'RINT', z_front: 'REXT', z_outer_ne: 'RPER', z_outer_sw: 'RPER' });
});
const STEPS = () => M().markers.find((m) => m.id === 'villa_steps');

/** Full M4 sim (alarm + objectives), stepped like Game.step. */
function m04Sim(brains = true) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  s.alarms = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ t: w.time, zone: p.zone?.id ?? p.zone ?? null, event: p.event }));
  w.objectives = createObjectives(s.mission.objectives);
  return s;
}
const villa = (w) => w.interactables.find((i) => i.interactKind === 'explosiveTarget' && i.tag === 'villa');
const obj = (w, id) => w.objectives.find((o) => o.id === id);

test('m04 hook: the villa falls only to a bomb on its steps (grenades, a bomb 4 m off: nothing) → o1', () => {
  const s = m04Sim(false), w = s.world;
  const mk = w.markers.get('villa_steps');
  assert.ok(mk && mk.r === 3 && villa(w)?.marker === 'villa_steps');
  applyExplosion(w, mk.x, mk.z, 'grenade');
  applyExplosion(w, mk.x + 4, mk.z, 'bomb');
  assert.ok(!villa(w).destroyed, 'still standing');
  checkObjectives(w);
  assert.ok(!obj(w, 'o1').done);
  applyExplosion(w, mk.x - 1, mk.z + 1, 'bomb');
  assert.ok(villa(w).destroyed, 'bomb on the steps');
  checkObjectives(w);
  assert.ok(obj(w, 'o1').done);
  assert.ok(!obj(w, 'o3').done, 'the boat is still to board');
});

test('m04 hook: the air-drop crate gives each man his share; the Sapper holding the bomb completes o2', () => {
  const s = m04Sim(false), w = s.world;
  const crate = w.interactables.find((i) => i.interactKind === 'crate');
  assert.ok(crate && Math.hypot(crate.x - 180.8, crate.z - 33.4) < 0.1);
  const sap = s.cmd('sapper'), sn = s.cmd('sniper'), dr = s.cmd('driver');
  for (const c of [sap, sn, dr]) { c.x = 180.8; c.z = 35; crate.interact?.(c) ?? crate.use?.(c); }
  assert.equal(sap.inventory.get('timeBomb'), 1);
  assert.equal(sn.inventory.get('sniperRifle'), 7, '4 + 3 rounds');
  assert.equal(dr.inventory.get('smg'), 20, 'SMG, 100 rounds');
  s.run(0.3);
  assert.ok(obj(w, 'o2').done, 'o2 done');
  assert.equal(obj(w, 'o2').required, false);
});

test('m04 hook: the boat waits for o1 and the whole team, then sails W off the map → escaped', () => {
  const s = m04Sim(false), w = s.world;
  const flags = {};
  const boat = s.get('pboat');
  assert.ok(boat && boat.isBoat);
  const men = w.commandos;
  for (const c of men) assert.ok(boat.enter(c), `${c.role} boards from the landing stage`);
  s.run(1, () => { updateExtractionVehicle(w, flags); return false; });
  assert.ok(Math.hypot(boat.x - BOAT.x, boat.z - BOAT.z) < 0.5, 'it does not leave before o1');
  const mk = w.markers.get('villa_steps');
  applyExplosion(w, mk.x, mk.z, 'bomb');
  checkObjectives(w);
  assert.ok(obj(w, 'o1').done);
  s.run(30, () => { updateExtractionVehicle(w, flags); checkObjectives(w); return obj(w, 'o3').done; });
  assert.equal(flags.evacPhase, 'leave');
  assert.ok(obj(w, 'o3').done, `escaped (boat at ${boat.x.toFixed(1)}, ${boat.z.toFixed(1)})`);
});

test('m04 script: no land vehicle over the rail bridge (the Panzer II stays on the SW bank); the boat is unaffected', () => {
  const s = m04Sim(false), w = s.world;
  s.run(0.2); // the director starts the script on the first BEL tick
  assert.ok(w.driveRules?.includes(bridgeRule));
  const tank = s.get('pz2'), moto = s.get('moto');
  assert.equal(bridgeRule(tank, 30, 110), true, 'around the rail yard');
  tank.x = 94; tank.z = 149; // at the SW abutment
  assert.equal(bridgeRule(tank, 125, 118), false, 'across the bridge');
  assert.equal(bridgeRule(tank, 105, 139), false, 'onto the deck');
  assert.equal(tank.canDriveTo(125, 118), false);
  assert.equal(bridgeRule(tank, 85, 160), true, 'back into the yard');
  assert.equal(bridgeRule(moto, 104, 138), false, 'the bike cannot cross either');
  assert.equal(bridgeRule(moto, 150, 90), true);
  assert.equal(bridgeRule(s.get('pboat'), 0, 81.5), true);
});

test('m04 script: the train closes the level-crossing booms, kills a man on the bridge deck, spares the man on the sunken tank', () => {
  const s = m04Sim(false), w = s.world;
  const boom = w.byId('boom_x1'), train = s.get('train');
  assert.ok(boom && boom.open, 'booms up at the start');
  const sn = s.cmd('sniper'), gb = s.cmd('greenberet');
  sn.setPosition(109.5, 133.1); // on the deck
  gb.setPosition(119.3, 144.8); // on the wreck, under the E pillar
  s.run(9);
  assert.ok(!train.hiddenRail, 'the train is running');
  assert.equal(boom.open, false, 'booms down while the train is near the crossing');
  s.run(21, () => sn.alive === false && boom.open);
  assert.equal(sn.alive, false, 'caught on the bridge');
  assert.notEqual(gb.alive, false, 'safe below the deck');
  assert.ok(boom.open, 'booms up again after the train');
});

test('m04 script: the motorcycle left on the level crossing stops the train there for good', () => {
  const s = m04Sim(false), w = s.world;
  const moto = s.get('moto'), train = s.get('train');
  moto.x = 165; moto.z = 77.5; moto.heading = Math.PI / 4;
  s.run(30);
  assert.ok(!train.hiddenRail && train.speed === 0, 'stopped');
  assert.ok(train.x > 165 && train.z < 77.5, `held NE of the crossing (${train.x.toFixed(1)}, ${train.z.toFixed(1)})`);
  void w;
});

test('m04 script: the lorry driver rides the cab, runs his errand at the crossing shack (the lorry waits), gets back in and drives on', () => {
  const s = m04Sim(true), w = s.world;
  const truck = s.get('truck'), e49 = s.get('e49'), A = TRUCK_STOPS.A;
  s.run(0.2);
  assert.equal(e49.state, 'inVehicle', 'in the cab at the start');
  assert.ok(truck.crewed && truck.canEnter(s.cmd('driver')) !== true, 'crewed: the Driver cannot take it');
  assert.ok(s.run(40, () => e49.state !== 'inVehicle'), 'he gets out at stop A');
  assert.ok(Math.hypot(truck.x - A.x, truck.z - A.z) < 2.5, 'at stop A');
  const door = A.walk.at(-1);
  assert.ok(s.run(15, () => Math.hypot(e49.x - door[0], e49.z - door[1]) < 1), 'walks to the shack door');
  s.run(3);
  assert.ok(Math.hypot(truck.x - A.x, truck.z - A.z) < 2.5, 'the lorry waits for him');
  assert.ok(s.run(20, () => e49.state === 'inVehicle'), 'back in the cab');
  assert.ok(s.run(40, () => Math.hypot(truck.x - A.x, truck.z - A.z) > 20), `drives on towards the HQ (t ${w.time.toFixed(1)}: ${truck.x.toFixed(1)}, ${truck.z.toFixed(1)})`);
  void w;
});

test('m04 script: the driver killed on his errand leaves the lorry standing — the Driver can take it', () => {
  const s = m04Sim(true);
  const truck = s.get('truck'), e49 = s.get('e49');
  assert.ok(s.run(40, () => e49.state !== 'inVehicle' && s.world.time > 1), 'errand');
  s.run(1);
  e49.die('knife', s.cmd('greenberet'));
  const at = { x: truck.x, z: truck.z };
  s.run(12);
  assert.ok(Math.hypot(truck.x - at.x, truck.z - at.z) < 0.5, 'no ghost driver');
  assert.ok(!truck.crewed);
  assert.equal(truck.canEnter(s.cmd('driver')), true, 'free for the Driver');
});

test('m04 script: the courier rides the bike to the jail hut and brings out its patrol (REXT, no siren); the bike stays there', () => {
  const s = m04Sim(true), w = s.world;
  const e26 = s.get('e26'), moto = s.get('moto');
  s.run(0.2);
  e26.brain._startAlarmRun(110, 125); // spotted someone at the bridge
  assert.ok(s.run(4, () => (e26.brain.goal?.idx ?? 0) >= 2), 'on his way');
  assert.ok(Math.hypot(moto.x - e26.x, moto.z - e26.z) < 1, 'riding the bike');
  assert.ok(s.run(40, () => s.alarms.some((a) => a.event === 'REXT')), 'REXT at the jail hut');
  assert.ok(Math.hypot(moto.x - 96.6, moto.z - 72.5) < 3, `bike parked by the jail hut (${moto.x.toFixed(1)}, ${moto.z.toFixed(1)})`);
  assert.equal(w.alarm.active, false, 'no siren');
  assert.ok(w.enemies.some((e) => String(e.tag ?? e.id).startsWith('jail_hut#')), 'the jail-hut patrol is out');
  // fix-4 #11: he used to stand frozen at the door in ALARM_RUN for good
  const pool = w.alarm.barracks.jail_hut.pool;
  s.run(1);
  assert.ok(!w.enemies.includes(e26) && e26.alive !== false, 'he went inside (removed, not killed)');
  assert.equal(w.alarm.barracks.jail_hut.pool, pool + 1, 'joined the garrison');
});

test('m04: scripted legs are walkable — p7\'s RINT run to the pier and back, its BUCL loop, the courier\'s ride, the lorry errands', () => {
  const { grid: g } = loadGrid(M());
  const legs = (list, closed = false) => {
    const p = list.map(([x, z]) => ({ x, z }));
    const out = [];
    for (let k = 0; k + 1 < p.length; k++) out.push([p[k], p[k + 1]]);
    if (closed) out.push([p.at(-1), p[0]]);
    return out;
  };
  const all = [
    ...legs([[82.4, 70.2], ...P7_RINT.to]), ...legs(P7_RINT.loop, true), ...legs([P7_RINT.to.at(-1), P7_RINT.loop[0]]),
    ...legs([[63.1, 55.4], [67.3, 48.1]]), ...legs([[119.4, 116.8], ...COURIER_RUN]),
  ];
  for (const st of Object.values(TRUCK_STOPS)) all.push(...legs([[st.x, st.z], ...st.walk]), ...legs([st.walk.at(-1), ...st.back]));
  for (const [a, b] of all) assert.ok(path(g, a, b), `(${a.x},${a.z}) → (${b.x},${b.z})`);
});

test('m04: the banks are see-through — the documented cross-inlet shots have a clear line (tank → courier, ledge → pier, Sniper → mg_x)', () => {
  const { grid: g } = loadGrid(M());
  const los = (a, b) => g.lineOfSight(a[0], a[1], b[0], b[1], { targetY: 1.7 });
  assert.ok(los([81, 130], [119.4, 116.8]), 'wire opening → courier e26 (Prima step 4)');
  assert.ok(Math.hypot(119.4 - 81, 116.8 - 130) <= 45, 'within the tank MG range');
  assert.ok(los([48, 104], [37.5, 67.6]), 'tank ledge → pier guard e56 (metamud)');
  assert.ok(los([48, 104], [63.1, 55.4]), 'tank ledge → stair-head walker e53 (metamud)');
  assert.ok(los([122, 108], [142.3, 84.2]), 'bridge head → MG e37 (Prima step 5)');
});

// fix-4 #1: the boat lay 1.9 m off the landing stage (boarding needs <= 1.8 m) and only the Marine could board it
test('m04: every man boards the patrol boat from the landing stage by himself — with or without the Marine aboard', () => {
  for (const marineFirst of [false, true]) {
    const s = m04Sim(false), w = s.world, boat = s.get('pboat');
    for (const e of w.enemies) e.die('knife'); // the pier MG would shoot up the boat once someone is seen boarding
    assert.equal(boat.driveable, false, 'not steerable (retail exit vehicle)');
    const order = marineFirst ? ['diver', 'greenberet', 'sniper', 'sapper', 'driver'] : ['greenberet', 'sniper', 'sapper', 'driver', 'diver'];
    for (const r of order) {
      const c = s.cmd(r);
      c.setPosition(35.5, 74.5); // on the landing stage, by the pier ladder
      assert.equal(ABILITIES.enterVehicle.canUse(c, boat, w), true, `${r} may board`);
      assert.ok(c.issue({ type: 'ability', id: 'enterVehicle', target: boat }));
      assert.ok(s.run(20, () => c.vehicle === boat), `${r} aboard (marine first: ${marineFirst})`);
    }
    assert.ok(Math.hypot(boat.x - BOAT.x, boat.z - BOAT.z) < 0.2, 'moored until the villa is down');
  }
});

// fix-4 #2: e36's route touched the train's kill band; the train ran him over ~2 min into every game and the bodies
// set off a chain of shouts, REXT releases and more men under the train (11 dead by t 300 with no order given)
const railDist = (x, z) => Math.abs(x + z - 242.6) / Math.SQRT2; // the main line
test('m04: every enemy post, route point and squad route stays ≥ 4.4 m from the main line (train band ±3.4 m)', () => {
  const m = M(), bad = [];
  const chk = (who, x, z) => { if (x > 70 && railDist(x, z) < 4.4) bad.push(`${who} (${x}, ${z}) ${railDist(x, z).toFixed(2)} m`); };
  for (const e of m.enemies) { chk(e.id, e.x, e.z); for (const p of e.route?.points || []) chk(e.id, p.x, p.z); }
  for (const [b, def] of Object.entries(m.barracks)) for (const sq of def.squads) for (const p of [...sq.exitRoute, ...sq.loop]) chk(`${b}/${sq.id}`, p.x, p.z);
  for (const [x, z] of [...P7_RINT.to, ...P7_RINT.loop]) chk('p7', x, z);
  assert.deepEqual(bad, []); // (the courier's bike ride passes 3.8 m off: a vehicle only stops the train)
});

test('m04: left alone for 320 s nobody dies — the train runs over no one, no zone fires, no siren', () => {
  const s = m04Sim(true), w = s.world;
  let trains = 0;
  const dead = [];
  w.events.on('train:pass', () => trains++);
  w.events.on('unit:killed', (p) => dead.push(p.unit?.tag ?? p.unit?.id));
  s.run(320);
  assert.ok(trains >= 9, `the train ran (${trains})`);
  assert.deepEqual(dead, []);
  assert.deepEqual(w.enemies.filter((e) => !e.alive).map((e) => e.tag ?? e.id), []);
  assert.deepEqual(s.alarms, []);
  assert.equal(w.alarm.active, false);
});

test('m04 script: a man on foot sent across the rails waits at the track while the train passes, then goes on', () => {
  const s = m04Sim(true), w = s.world, train = s.get('train'), e = s.get('e41');
  s.run(9, () => !train.hiddenRail);
  assert.ok(!train.hiddenRail, 'the train is on the map');
  e.setPosition(170.5, 79.5); // 5.1 m NE of the rails, the train ~45 m up the line
  e.brain.reinforce([{ x: 160, z: 71, wait: 0, speed: 1.8 }], [{ x: 160, z: 71, wait: 0, speed: 1.8 }], { loopVel: 1.8 });
  let held = false;
  s.run(12, () => { if (!train.hiddenRail && railDist(e.x, e.z) < RAIL_GUARD.pad + 3.4 + 0.1 && railDist(e.x, e.z) > 3.4) held = true; return false; });
  assert.notEqual(e.alive, false, 'not run over');
  assert.ok(held, 'waited at the edge of the track');
  assert.ok(s.run(30, () => Math.hypot(e.x - 160, e.z - 71) < 1.5), `crossed after the train (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`);
});

// fix-4 #3: r0's loop point sat inside the HQ pine and r3's first exit point inside garr2: both squads froze for good
test('m04: every barracks squad route is walkable and every leg paths (exit from the door, exit → loop, the loop closed)', () => {
  const { grid: g } = loadGrid(M());
  const bad = [];
  for (const [bid, def] of Object.entries(M().barracks)) {
    const b = M().structures.find((st) => st.id === bid);
    for (const sq of def.squads) {
      const pts = [...sq.exitRoute, ...sq.loop];
      for (const p of pts) if (!g.walkableAt(p.x, p.z)) bad.push(`${bid}/${sq.id} (${p.x}, ${p.z}) not walkable`);
      const legs = [];
      for (let k = 0; k + 1 < pts.length; k++) legs.push([pts[k], pts[k + 1]]);
      legs.push([sq.loop.at(-1), sq.loop[0]]);
      for (const [a, c] of legs) if (!path(g, a, c)) bad.push(`${bid}/${sq.id} (${a.x}, ${a.z}) → (${c.x}, ${c.z})`);
      if (Math.hypot(sq.exitRoute[0].x - b.x, sq.exitRoute[0].z - b.z) > 8) bad.push(`${bid}/${sq.id} exit starts far from its door`);
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

test('m04: released squads walk their loops — none freezes by a door or a tree (r0, r3 on RINT; r6 on RPER; r4 on REXT)', () => {
  const s = m04Sim(true), w = s.world;
  s.run(0.2);
  for (const ev of ['RINT', 'RPER', 'REXT']) w.alarm.fireEvent(ev, { cause: 'test', x: 100, z: 40 });
  const squads = { 'garr1#0': 'r0', 'garr2#0': 'r3', 'garr2#1': 'r6', 'jail_hut#0': 'r4' };
  const lead = (sq) => { const [b, k] = sq.split('#'); return w.alarm.barracks[b].squads[+k].members?.[0]; };
  for (const sq of Object.keys(squads)) assert.ok(lead(sq), `${squads[sq]} out`);
  s.run(90);
  const box = Object.fromEntries(Object.keys(squads).map((k) => [k, [Infinity, -Infinity, Infinity, -Infinity]]));
  for (let k = 0; k < 60; k++) {
    s.run(1);
    for (const sq of Object.keys(squads)) { const e = lead(sq), b = box[sq]; b[0] = Math.min(b[0], e.x); b[1] = Math.max(b[1], e.x); b[2] = Math.min(b[2], e.z); b[3] = Math.max(b[3], e.z); }
  }
  for (const [sq, r] of Object.entries(squads)) {
    const b = box[sq], span = Math.max(b[1] - b[0], b[3] - b[2]);
    assert.ok(span > 12, `${r} leader kept within ${span.toFixed(1)} m for 60 s (at ${lead(sq).x.toFixed(1)}, ${lead(sq).z.toFixed(1)})`);
  }
});

// fix-4 #10: r6 and r4 are `regen: false` (one release each) but were rebuilt from the pool 20 s after their last man fell
test('m04: r6 and r4 go out once and are never rebuilt; r0 is rebuilt from its pool 20 s after its last man falls', () => {
  const s = m04Sim(false), w = s.world;
  const sq = (b, k) => w.alarm.barracks[b].squads[k];
  for (const ev of ['RINT', 'RPER', 'REXT']) w.alarm.fireEvent(ev, { cause: 'test', x: 100, z: 40 });
  s.run(0.2);
  const first = { r0: sq('garr1', 0).members, r6: sq('garr2', 1).members, r4: sq('jail_hut', 0).members };
  for (const [r, list] of Object.entries(first)) { assert.ok(list.length > 0, `${r} out`); for (const e of list) e.die('knife'); }
  s.run(25);
  for (const ev of ['RINT', 'RPER', 'REXT']) w.alarm.fireEvent(ev, { cause: 'test', x: 100, z: 40 });
  s.run(0.2);
  assert.notEqual(sq('garr1', 0).members, first.r0, 'r0 rebuilt (regen: true)');
  assert.ok(sq('garr1', 0).members.every((e) => e.alive));
  assert.equal(sq('garr2', 1).members, first.r6, 'r6 not rebuilt');
  assert.equal(sq('jail_hut', 0).members, first.r4, 'r4 not rebuilt');
  assert.equal(w.enemies.filter((e) => e.alive && /^(garr2#1|jail_hut#)/.test(String(e.tag))).length, 0, 'no second r6 / r4');
});

// fix-4 #4: the pier guard e56 stands in z_hq and heard / saw fights on the SW shore across the fjord → the siren
test('m04: an alarm shout or a body on the SW shore reaches the pier guard but sounds no siren; a shout at the stair head does', () => {
  const s = m04Sim(true), w = s.world;
  s.run(0.5);
  const e13 = s.get('e13'), e56 = s.get('e56'), e53 = s.get('e53');
  let heard = false;
  const h = e56.brain.hear.bind(e56.brain);
  e56.brain.hear = (n) => { heard = true; return h(n); };
  e13.brain._alarmShout('seen', e13.x, e13.z); // SW shore, 25 m from e56 across the water
  s.run(0.5);
  assert.ok(heard, 'e56 heard it');
  assert.deepEqual(s.alarms, [], 'no zone event');
  assert.equal(w.alarm.active, false, 'no siren');
  // a kill seen across the fjord: the source lies far outside z_hq
  assert.equal(w.alarm.raise('z_hq', 'kill', 37.1, 101.5, { sensor: 'seen' }), null);
  assert.equal(w.alarm.raise('z_front', 'body', 120, 100, { sensor: 'seen' }), null, 'bridge head: no REXT');
  // e56 firing his rifle at the tank across the water (cont4 replay): his own shot, heard by e53 / e55 up top
  w.emitNoise(e56.x, e56.z, 22.5, 'rifle', e56);
  s.run(0.2);
  assert.deepEqual(s.alarms, [], 'the pier guard\'s shot sounds no siren');
  // at the stair head it still counts
  e53.setPosition(52, 59);
  e53.brain._alarmShout('seen', e53.x, e53.z);
  s.run(0.2);
  assert.ok(s.alarms.some((a) => a.event === 'RINT'), 'RINT from the stair head');
  assert.equal(w.alarm.active, true, 'siren');
  assert.equal(w.alarm.raise('z_hq', 'seen', 52, 59, { sensor: 'seen' }), 'RINT', 'the stair head is in z_hq');
  assert.equal(w.alarm.raise('z_hq', 'seen', 37.5, 72, { sensor: 'seen' }), null, 'the landing stage is not');
});

// fix-4 #5: the Panzer II fired its cannon at anything past 13.5 m (a map-wide shell with no range cap) and never its MG
test('m04: the Panzer II fires only its hull MG (45 m): the MG kills at 18 m, nothing past 45 m, no shells', () => {
  const s = m04Sim(false), w = s.world, tank = s.get('pz2'), dr = s.cmd('driver');
  assert.deepEqual(tank.def.weapons, ['tankMg']);
  dr.setPosition(41, 104.5);
  assert.ok(tank.enter(dr) && tank.driver === dr, 'the Driver takes the tank');
  assert.equal(tank.weaponFor(8), 'tankMg');
  assert.equal(tank.weaponFor(30), 'tankMg');
  assert.equal(tank.weaponFor(60), null, 'no cannon');
  assert.equal(ABILITIES.vehicleFire.canUse(dr, { x: tank.x + 60, z: tank.z }, w), 'Out of range.');
  const e16 = s.get('e16');
  assert.ok(tank.fireAt(e16), 'fires at e16');
  s.run(3);
  assert.equal(e16.alive, false, 'cut down by the MG');
  assert.equal(s.count('explosion'), 0, 'no shell');
  assert.ok(w.byId('e56').alive, 'the pier across the fjord untouched');
});

// fix-4 #7: a burst landed one 100-point round on a 200 HP soldier at 14 m; the pair it was meant for shot the Driver
test('m04: the air-drop SMG — one burst kills the man it is aimed at, at 10 m and at 14 m', () => {
  const s = m04Sim(false), w = s.world, dr = s.cmd('driver');
  const crate = w.interactables.find((i) => i.interactKind === 'crate');
  dr.x = 180.8; dr.z = 35; crate.interact?.(dr) ?? crate.use?.(dr);
  for (const [id, dx, dz] of [['e16', -10, 0], ['e12', 0, -14]]) {
    const e = s.get(id), d = Math.hypot(dx, dz);
    dr.setPosition(e.x + dx, e.z + dz);
    assert.ok(dr.issue({ type: 'ability', id: 'smg', target: { x: e.x, z: e.z } }), `burst at ${id}`);
    s.run(1.2);
    assert.equal(e.alive, false, `${id} killed by one burst at ${d} m`);
  }
  void w;
});

// fix-4 #8: the Marine carries the raft (IT_BALSA): the sunken tank ↔ landing stage ferry (Kildread, metamud, Ruetli)
test('m04: the Marine launches the raft from the sunken tank, ferries the GB to the landing stage and lands him there', () => {
  const s = m04Sim(false), w = s.world;
  for (const e of w.enemies) e.die('knife');
  const ma = s.cmd('diver'), gb = s.cmd('greenberet');
  ma.setPosition(115.6, 144.6); // the wading rim of the wreck
  gb.setPosition(118.8, 145.5); // on the wreck (down ladder_br)
  assert.ok(ma.issue({ type: 'ability', id: 'raft', target: ma }), 'raft out');
  s.run(3);
  const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
  assert.ok(raft && ma.vehicle === raft, 'Marine at the oars');
  assert.ok(gb.issue({ type: 'ability', id: 'enterVehicle', target: raft }));
  assert.ok(s.run(10, () => gb.vehicle === raft), 'GB aboard');
  assert.ok(ma.issue({ type: 'move', x: 42.6, z: 75 }));
  assert.ok(s.run(120, () => Math.hypot(raft.x - 42.6, raft.z - 75) < 1.5), `rowed to the landing stage (${raft.x.toFixed(1)}, ${raft.z.toFixed(1)})`);
  assert.ok(gb.issue({ type: 'ability', id: 'leaveVehicle', target: gb }));
  s.run(2);
  assert.ok(!gb.vehicle && gb.x > 32.9 && gb.x < 42.3 && gb.z > 72.9 && gb.z < 77.1, `GB on the landing stage (${gb.x.toFixed(1)}, ${gb.z.toFixed(1)})`);
});

// fix-4 #9: the one time bomb set off away from the steps left an unwinnable game running with no message
test('m04: the only time bomb wasted off the steps fails o1 (lost, with a message); on the steps it wins o1', () => {
  for (const [x, z, win] of [[85.5, 40.5, false], [80.5, 36.2, true]]) {
    const s = m04Sim(false), w = s.world, sap = s.cmd('sapper');
    const msgs = [];
    w.events.on('message', (p) => msgs.push(p?.text ?? ''));
    for (const e of w.enemies) e.die('knife');
    const crate = w.interactables.find((i) => i.interactKind === 'crate');
    sap.x = 180.8; sap.z = 35; crate.interact?.(sap) ?? crate.use?.(sap);
    assert.equal(sap.inventory.get('timeBomb'), 1);
    s.run(1);
    assert.ok(!obj(w, 'o1').failed, 'still winnable while he carries it');
    sap.setPosition(x, z);
    assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }), 'bomb set');
    s.run(3);
    assert.ok(!obj(w, 'o1').failed, 'still winnable while the fuse burns');
    sap.setPosition(x + 12, z + 12);
    s.run(12);
    checkObjectives(w);
    assert.equal(!!villa(w).destroyed, win);
    assert.equal(obj(w, 'o1').done, win);
    assert.equal(obj(w, 'o1').failed, !win, win ? 'won' : 'o1 failed → mission lost');
    assert.equal(msgs.some((t) => /charge is spent/.test(t)), !win, 'told why');
  }
});

// fix-4 #11: after a quick load taken while the train passed, the booms stayed down for good (the script's state is not
// saved) and the lorry waited at the crossing with e49 flipping RETURN ↔ IDLE in the cab for 20 min
test('m04 script: booms left down by a quick load are lifted once the train has gone; the lorry driver stays a rider', () => {
  const s = m04Sim(true), w = s.world, boom = w.byId('boom_x1'), train = s.get('train'), e49 = s.get('e49');
  assert.ok(s.run(20, () => boom.open === false), 'booms down for the train');
  w.m04.boomsDown = false; w.m04.clearT = 0; // what a restored game looks like: booms saved down, script state fresh
  e49.post = { x: e49.spawn.x, z: e49.spawn.z, heading: 0 }; // a restored brain with his spawn post
  e49.brain._set('RETURN');
  s.run(1);
  assert.equal(e49.post, null, 'a passive rider again');
  assert.equal(e49.brain.state, 'IDLE');
  assert.ok(s.run(30, () => boom.open === true && train.hiddenRail), 'booms up after the train');
  const states = new Set();
  s.run(60, () => { if (e49.state === 'inVehicle') states.add(e49.brain.state); return false; });
  assert.deepEqual([...states], ['IDLE'], 'no RETURN ↔ IDLE flip-flop in the cab');
});

// fix-4 #12: the retail fuse (7.5 s) and the prone start (dossier §10)
test('m04: the team starts prone; the air-drop time bomb burns 7.5 s (retail file), not the standard 10 s', () => {
  const s = m04Sim(false), w = s.world, sap = s.cmd('sapper');
  s.run(0.2);
  assert.deepEqual(w.commandos.map((c) => c.stance), ['crawl', 'crawl', 'crawl', 'crawl', 'crawl']);
  for (const e of w.enemies) e.die('knife');
  const crate = w.interactables.find((i) => i.interactKind === 'crate');
  sap.x = 180.8; sap.z = 35; crate.interact?.(sap) ?? crate.use?.(sap);
  sap.setPosition(150, 60);
  let armed = null, boom = null;
  w.events.on('bomb:armed', () => { armed = w.time; });
  w.events.on('bomb:exploded', () => { boom = boom ?? w.time; });
  assert.ok(sap.issue({ type: 'ability', id: 'timeBomb', target: sap }));
  s.run(12, () => boom != null);
  assert.ok(armed != null && boom != null);
  assert.ok(Math.abs(boom - armed - 7.5) < 0.1, `fuse ${(boom - armed).toFixed(2)} s`);
});
