/**
 * BEL M11 "In the Soup" (docs/missions/m11.md): schema + §10.5 test #14, the three levels (plateaus y 6, mesa y 4,
 * bunker roof y 3.5), the sealed quarry, the tunnel bore, the three local alarms (heardLocal), objective and
 * extraction wiring, and the dossier's acceptance checks (§14.1): the tanker between the N rigs fells both, the
 * barrels and the process tank each fell one; the N half-track comes through the tunnel on EV_N and dies in it
 * when it falls; the vacant half-track climbs the W road and wins with all five aboard once the rigs burn.
 * Run with the unit suite: node tests/unit/run.mjs m11
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
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';
import { rigsImpossible } from '../../src/missions/scripts/m11.js';
import { fireFromVehicle } from '../../src/abilities/operate.js';
import { ABILITIES } from '../../src/abilities/registry.js';

const M = () => getMission('m11');
const ROLES = ['greenberet', 'sniper', 'sapper', 'driver', 'spy'];
const path = (g, a, b, role) => findPath(g, a[0], a[1], b[0], b[1], { role, maxNodes: 400000 });
const START = [7, 66];
/** The two quarry rigs: nobody can enter the pit (ooc, dossier §4.2 / §12 #18); they fall to fuel only. */
const QUARRY_SKIP = ROLES.flatMap((role) => ['rig_nw', 'rig_ne'].map((target) => ({ role, target })));

test('m11: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.title, 'In the Soup');
  assert.equal(m.theater, 'desert');
  assert.equal(m.coneColors, 'desert');
  assert.deepEqual(m.size, [101, 153]);
  assert.equal(m.par.time, 780);
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m11: §3.8 row 11 loadout exactly (Sniper 5 rounds, Sapper grenade + 3 bombs, Driver the kit); Spy in uniform; 5 barrels', () => {
  const L = belLoadout(11);
  const m = M();
  assert.deepEqual(m.commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of m.commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(L.medic, 'driver');
  assert.deepEqual(m.startDisguised, ['spy']);
  assert.equal(L.startDisguised, true);
  const loose = m.structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel' && s.carriable);
  assert.equal(loose.length, L.site.barrels, 'five loose explosive barrels');
  assert.ok(m.vehicles.some((v) => v.vehicleType === 'sdkfz' && v.driveable && !v.crew), 'the vacant half-track');
  assert.ok(m.vehicles.some((v) => v.vehicleType === 'mgNest'), 'the Gatling');
});

test('m11: §10.5 #14 — loads; starts reach every objective and the half-track; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M(), { skipReach: QUARRY_SKIP }), []);
});

test('m11: the quarry is sealed for everyone (all links on); its rigs are in shot from the reachable ridge', () => {
  const { grid: g } = loadGrid(M());
  for (const role of ROLES) {
    assert.equal(path(g, START, [70, 42], role), null, `${role} cannot enter the quarry`);
    assert.equal(path(g, [90, 57], [85, 46], role), null, `${role} cannot drop in from the ridge`);
  }
  for (const role of ['greenberet', 'sniper']) assert.ok(path(g, START, [91, 55], role), `${role} reaches the ridge over the quarry`);
  // the ridge stand S of rig_ne: brl_q1 in pistol reach, the tanker's middle stop in rifle reach
  assert.ok(Math.hypot(94.2 - 91, 36 - 55) < 20);
  assert.ok(Math.hypot(88.5 - 91, 33.8 - 55) < 25);
  assert.ok(g.elevAt(91, 55) === 6 && g.elevAt(88.5, 33.8) === 0);
});

test('m11: levels — plateaus y 6 (one bore between them), mesa y 4 by ladder or pick, bunker roof y 3.5 by ladder', () => {
  const { grid: g } = loadGrid(M());
  for (const [x, z] of [[30, 30], [80, 57], [80, 8], [57.5, 22.5], [1.5, 41]]) assert.equal(g.elevAt(x, z), 6, `y 6 at (${x},${z})`);
  assert.equal(g.elevAt(85, 112), 4, 'mesa');
  assert.equal(g.elevAt(50, 61), 3.5, 'bunker roof');
  for (const [x, z] of [[70, 42], [40, 70], [90, 75], [15, 130], [7, 66]]) assert.equal(g.elevAt(x, z), 0, `floor (${x},${z})`);
  const mid = g.elevAt(5.5, 53);
  assert.ok(mid > 2 && mid < 5, `the W road half-way up (${mid})`);
  // the HQ plateau is joined to the N plateau only through the bore
  const via = path(g, [30, 30], [80, 8], 'sniper');
  const near = (pts, x, z, r) => pts.some((p, k) => k > 0 && [0, 0.25, 0.5, 0.75, 1].some((f) => Math.hypot(pts[k - 1].x + (p.x - pts[k - 1].x) * f - x, pts[k - 1].z + (p.z - pts[k - 1].z) * f - z) < r));
  assert.ok(via && near(via, 57.5, 22.5, 3), 'through the tunnel');
  const links = g.links;
  links.forEach((l) => g.setLinkEnabled(l.id, false));
  assert.equal(path(g, [90, 75], [85, 112], 'spy'), null, 'no ground route onto the mesa');
  assert.equal(path(g, [40, 70], [50, 61], 'spy'), null, 'no ground route onto the roof');
  assert.ok(path(g, START, [30, 30], 'spy'), 'the W road climbs to the plateau');
  links.forEach((l) => g.setLinkEnabled(l.id, true));
  assert.ok(path(g, [90, 75], [85, 112], 'spy'), 'ld_mesa');
  assert.ok(path(g, [40, 70], [50, 61], 'spy'), 'ld_bunker');
  assert.ok(path(g, [50, 61], [48, 55], 'sapper'), 'ld_scarp: roof → ridge (the Sapper to the tunnel)');
  assert.deepEqual(M().climbLinks.map((c) => c.roles), M().climbLinks.map(() => ['greenberet']));
});

test('m11: enemy census (Kildread 18 moving + 10 posted + the gate-1 guard, four 3-man patrols, the Gatling), 3 garrisons', () => {
  const m = M();
  const single = m.enemies.filter((e) => !e.squad && e.soldierType !== 'mg');
  assert.equal(single.filter((e) => e.route).length, 18, 'walkers');
  assert.equal(single.filter((e) => !e.route).length, 11, 'sentries (10 + e_g1)');
  const squads = new Map();
  for (const e of m.enemies.filter((q) => q.squad)) squads.set(e.squad.id, [...(squads.get(e.squad.id) || []), e]);
  assert.deepEqual([...squads.keys()].sort(), ['pat13', 'pat14', 'pat28', 'pat30']);
  for (const [id, men] of squads) assert.equal(men.length, 3, id);
  assert.equal(m.enemies.find((e) => e.soldierType === 'mg')?.emplacement, 'mg_e');
  assert.deepEqual(Object.keys(m.barracks).sort(), ['barracks_sw', 'bunker_c', 'hq_n']);
  assert.deepEqual(m.barracks.barracks_sw.squads.map((s) => s.event), ['RINT', 'RINT']);
  assert.deepEqual(m.barracks.bunker_c.squads.map((s) => s.event), ['EV_C', 'EV_C', 'EV_C']);
  assert.deepEqual(m.barracks.hq_n.squads.map((s) => s.event), ['EV_N', 'EV_N']);
});

/** M11 sim with the alarm and the objectives (buildMap installed the set-pieces; the tick trigger does the glue). */
function m11Sim() {
  const s = makeSim(M(), { brains: false });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  s.run(0.1);
  return s;
}
const gone = (e) => !e || e.removed || e.destroyed || e.exploded || e.alive === false;
const objDone = (w, id) => w.objectives.find((o) => o.id === id).done;

test('m11: three zones cover the whole map; each fires only for noises inside it (heardLocal, D1)', () => {
  const s = m11Sim(), w = s.world;
  for (let x = 0.5; x < 101; x += 10) for (let z = 0.5; z < 153; z += 10) assert.ok(w.alarm.zoneAt(x, z), `(${x},${z}) in a zone`);
  const fired = [];
  w.events.on('alarm:zone', (p) => fired.push(p.event));
  // Prima Phase 1–2: the barrel at barracks_sw's W wall, then Patrol 14's barrel by the water tower
  applyExplosion(w, 32, 119.5, 'barrel', null);
  s.run(0.5);
  assert.deepEqual([...new Set(fired)], ['RINT'], 'the camp blast: siren only');
  assert.ok(gone(w.byId('barracks_sw')), 'the barrel razes the camp barracks');
  fired.length = 0;
  applyExplosion(w, 40, 135, 'barrel', null);
  s.run(0.5);
  assert.ok(!fired.includes('EV_C') && !fired.includes('EV_N'), 'the bunker and the HQ never hear the camp');
  fired.length = 0;
  applyExplosion(w, 30.5, 92.5, 'bomb', null); // the yard rig
  s.run(0.5);
  assert.deepEqual([...new Set(fired)], ['EV_C']);
  assert.equal(M().alarmFail, null);
});

test('m11 hook: the tanker shuttles in the quarry; shot at its middle stop it fells both N rigs', () => {
  const s = m11Sim(), w = s.world, t = w.byId('tanker');
  let mid = false, px = t.x, pz = t.z;
  s.run(60, () => {
    const still = Math.hypot(t.x - px, t.z - pz) < 1e-4;
    px = t.x; pz = t.z;
    mid = still && Math.hypot(t.x - 88.5, t.z - 33.8) < 1.5;
    return mid;
  });
  assert.ok(mid, `waits between the rigs (at ${t.x.toFixed(1)},${t.z.toFixed(1)})`);
  for (const id of ['rig_nw', 'rig_ne']) assert.ok(!gone(w.byId(id)), `${id} untouched by the shuttle`);
  t.bulletHit(s.cmd('sniper'));
  s.run(2);
  for (const id of ['rig_nw', 'rig_ne']) assert.ok(gone(w.byId(id)), `${id} down`);
  assert.ok(!gone(w.byId('hq_n')), 'the HQ across the pit stands');
});

test('m11 hook: the fallbacks — brl_q1 fells rig_ne only; tank_q2 fells rig_nw only', () => {
  const s = m11Sim(), w = s.world;
  w.byId('brl_q1').ignite(0, s.cmd('greenberet'));
  s.run(2);
  assert.ok(gone(w.byId('rig_ne')) && !gone(w.byId('rig_nw')) && !gone(w.byId('tanker')));
  const s2 = m11Sim(), w2 = s2.world;
  w2.byId('tank_q2').ignite(0, s2.cmd('sniper'));
  s2.run(2);
  assert.ok(gone(w2.byId('rig_nw')) && !gone(w2.byId('rig_ne')));
});

test('m11 hook: with no fuel left for a standing N rig the mission is lost (§10.2 t_n_impossible)', () => {
  const s = m11Sim(), w = s.world;
  assert.equal(rigsImpossible(w), false);
  w.byId('tanker').destroyed = true;
  assert.equal(rigsImpossible(w), false, 'tank_q2 and the barrels still reach them');
  w.byId('tank_q2').exploded = true;
  s.run(0.5);
  assert.equal(w.scriptFail, 'THE LAST RIGS CAN NO LONGER BE DESTROYED.');
});

test('m11 hook: EV_N sends the N half-track through the bore; the tunnel bomb crushes it and seals the north', () => {
  const s = m11Sim(), w = s.world, v = w.byId('ht_n');
  w.alarm.fireEvent('EV_N', { zoneId: 'z_n', cause: 'test', x: 30, z: 30 });
  s.run(20, () => v.z > 22);
  assert.ok(v.z > 22 && v.z < 29 && !v.destroyed, `in the bore (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  applyExplosion(w, 53.5, 30.5, 'bomb', s.cmd('sapper'));
  s.run(1);
  assert.ok(v.destroyed, 'crushed in the tunnel');
  assert.equal(w.grid.walkableAt(57.5, 22.5), false, 'the bore is rock');
  assert.equal(findPath(w.grid, 84.5, 22.5, 50, 36, { maxNodes: 400000 }), null, 'the HQ squads cannot reach the loop');
  // without the collapse it drives out onto the loop
  const s2 = m11Sim(), w2 = s2.world, v2 = w2.byId('ht_n');
  w2.alarm.fireEvent('EV_N', { zoneId: 'z_n', cause: 'test', x: 30, z: 30 });
  s2.run(25);
  assert.ok(Math.hypot(v2.x - 50, v2.z - 40) < 2 && v2.y === 6, 'on the loop');
});

/** Everyone aboard ht_ours, driven out through arch_e, the yard, gate 1 and up the W road. */
function driveOut(s) {
  const w = s.world, v = w.byId('ht_ours');
  for (const c of w.commandos) { c.x = v.x - 3; c.z = v.z + 2; assert.ok(v.enter(c), `${c.role} boards`); }
  const route = [[80, 74.5], [72.3, 69.1], [63, 72.9], [29.2, 60.6], [21.8, 53.9], [17.5, 57], [8, 56.5], [3, 50.5], [4, 44.5], [1.5, 41]];
  v.followPath(route.map(([x, z]) => ({ x, z })), { speed: 5 });
  s.run(60, () => !v.path && !v.goal);
  return v;
}

test('m11 hook: the half-track climbs the W road to the W edge; the escape counts only once all four rigs burn', () => {
  const s = m11Sim(), w = s.world;
  const v = driveOut(s);
  assert.ok(Math.hypot(v.x - 1.5, v.z - 41) < 3.5 && v.y === 6, `at the exit on the plateau (${v.x.toFixed(1)},${v.z.toFixed(1)} y ${v.y})`);
  assert.equal(checkObjectives(w).won, false, 'rigs still standing: no win');
  assert.ok(!objDone(w, 'o_escape'));
  for (const id of ['rig_w', 'rig_e', 'rig_nw', 'rig_ne']) w.byId(id).destroyed = true;
  const res = checkObjectives(w);
  assert.ok(objDone(w, 'o_rigs') && objDone(w, 'o_escape') && res.won, 'won');
});

test('m11 hook: the half-tracks never drive off a cliff edge (ridge → E valley floor)', () => {
  const s = m11Sim(), w = s.world, v = w.byId('ht_n');
  w.byId('htn_d'); // crew records only
  v.brain.state = 'done';
  v.x = 80; v.z = 57; v.heading = Math.PI / 2; v.y = 6;
  w.rebuildSpatial();
  v.followPath([{ x: 80, z: 75 }], { speed: 5 });
  s.run(8);
  assert.ok(v.z < 62.5 && v.y === 6, `stopped on the ridge (${v.z.toFixed(1)})`);
});

// ------------------------------------------------------------------ fix round 1 (playtest findings)

/** Put a unit (commando / enemy / hull) at (x, z) on the level there. */
function place(s, u, x, z) {
  u.x = x; u.z = z; u.y = s.world.grid.elevAt(x, z) || 0;
  s.world.rebuildSpatial();
}
/** Run until the tanker waits at W_mid between the N rigs. */
function tankerAtMid(s) {
  const t = s.world.byId('tanker');
  let px = t.x, pz = t.z;
  return s.run(60, () => {
    const still = Math.hypot(t.x - px, t.z - pz) < 1e-4;
    px = t.x; pz = t.z;
    return still && Math.hypot(t.x - 88.5, t.z - 33.8) < 1.5;
  });
}

test('m11 regression: from the ridge a real pistol round sets off brl_q3 (rig_ne falls); the rim is no sight wall', () => {
  const s = m11Sim(), w = s.world, sn = s.cmd('sniper'), b3 = w.byId('brl_q3');
  place(s, sn, 95, 53.8);
  assert.equal(sn.y, 6, 'on the ridge');
  assert.ok(Math.hypot(b3.x - sn.x, b3.z - sn.z) < 13.5, 'in pistol reach');
  assert.ok(w.grid.lineOfSight(sn.x, sn.z, b3.x, b3.z, { viewerY: 6, targetY: 0 }), 'the ridge overlooks the pit floor');
  assert.ok(sn.issue({ type: 'ability', id: 'pistol', target: b3 }), 'pistol order accepted');
  s.run(2);
  assert.ok(gone(b3), 'brl_q3 blown');
  assert.ok(gone(w.byId('rig_ne')), 'rig_ne down');
  assert.ok(!gone(w.byId('rig_nw')), 'rig_nw needs the tanker');
  for (const role of ROLES) assert.equal(path(w.grid, [90, 57], [85, 46], role), null, `${role}: the lip + drop still seal the pit`);
});

test('m11 regression: the half-track\'s MG on the ridge hits the tanker at W_mid (both N rigs fall); from the yard it never reaches the bunker roof (D4)', () => {
  const s = m11Sim(), w = s.world, v = w.byId('ht_ours'), dr = s.cmd('driver'), t = w.byId('tanker');
  place(s, dr, v.x - 3, v.z + 2);
  assert.ok(v.enter(dr), 'the Driver boards');
  place(s, v, 78, 56);
  s.run(0.2);
  assert.equal(v.y, 6, 'hull on the ridge');
  assert.ok(tankerAtMid(s), 'the tanker waits at W_mid');
  assert.equal(fireFromVehicle(dr, t), true, 'fires');
  s.run(3);
  assert.ok(t.destroyed, 'the tanker blows');
  for (const id of ['rig_nw', 'rig_ne']) assert.ok(gone(w.byId(id)), `${id} down`);
  // D4: a hull gun fires down from its own height, never up onto the bunker roof
  const s2 = m11Sim(), w2 = s2.world, v2 = w2.byId('ht_ours'), dr2 = s2.cmd('driver'), e26 = w2.byId('e26');
  place(s2, dr2, v2.x - 3, v2.z + 2);
  assert.ok(v2.enter(dr2));
  place(s2, v2, 52, 73);
  s2.run(0.2);
  const hp = e26.hp;
  fireFromVehicle(dr2, e26);
  s2.run(3);
  assert.equal(e26.hp, hp, 'the roof guard is out of the MG\'s reach');
});

test('m11 regression: t_n_impossible counts only fuel the team can still set off (grenade spent, brl_q3 gone, no half-track)', () => {
  const s = m11Sim(), w = s.world, sa = s.cmd('sapper');
  sa.inventory.set ? sa.inventory.set('grenade', 0) : (sa.inventory.grenade = 0);
  assert.equal(rigsImpossible(w), false, 'brl_q3 (pistol) and the half-track MG remain');
  w.byId('brl_q3').exploded = true;
  assert.equal(rigsImpossible(w), false, 'the half-track MG still reaches the tanker and the drums');
  w.byId('ht_ours').destroyed = true;
  assert.equal(rigsImpossible(w), true, 'nothing in reach can set the quarry fuel off');
  s.run(0.5);
  assert.ok(/HALF-TRACK|RIGS/.test(w.scriptFail), w.scriptFail);
});

test('m11 regression: the barrel that razes barracks_sw with Patrol 13 in the gap releases no squad (already rubble)', () => {
  const s = m11Sim(), w = s.world;
  const brl = w.byId('brl_s1');
  place(s, brl, 32.2, 119.6);
  [['s13', 31.3, 118.6], ['t13a', 31.0, 117.4], ['t13b', 30.6, 116.2]].forEach(([id, x, z]) => place(s, w.byId(id), x, z));
  const rein = [];
  w.events.on('reinforcements', (p) => rein.push(p));
  // a camp guard sees his sergeant die: the witnessed-kill RINT is raised while the blast is being applied
  let raised = false;
  w.events.on('unit:killed', (p) => {
    if (raised || p.unit?.faction !== 'enemy') return;
    raised = true;
    w.alarm.fireEvent('RINT', { zoneId: 'z_sw', cause: 'kill', x: p.unit.x, z: p.unit.z });
  });
  brl.takeDamage(1, s.cmd('spy'));
  s.run(1);
  assert.ok(raised, 'the kill was witnessed');
  assert.ok(gone(w.byId('barracks_sw')), 'razed');
  for (const id of ['s13', 't13a', 't13b']) assert.ok(gone(w.byId(id)), `${id} dead`);
  assert.equal(rein.length, 0, 'nobody comes out');
  assert.ok(w.alarm.barracks.barracks_sw.squads.every((q) => !q.released), 'no squad released');
});

test('m11 regression: every route leg is a direct walk (Patrol 13 stays inside the wire; no detour through the yard)', () => {
  const { grid: g } = loadGrid(M());
  const bad = [];
  for (const e of M().enemies) {
    const pts = e.route?.points;
    if (!pts || pts.length < 2) continue;
    const legs = pts.map((p, k) => [p, pts[k + 1] ?? (e.route.type === 'LOOP' ? pts[0] : null)]).filter(([, b]) => b);
    for (const [a, b] of legs) {
      const p = findPath(g, a.x, a.z, b.x, b.z, { maxNodes: 400000 });
      const straight = Math.hypot(b.x - a.x, b.z - a.z);
      let len = 0, q = { x: a.x, z: a.z };
      for (const n of p || []) { len += Math.hypot(n.x - q.x, n.z - q.z); q = n; }
      if (!p || len > straight * 1.35 + 3) bad.push(`${e.id} (${a.x},${a.z})→(${b.x},${b.z}) ${p ? len.toFixed(1) + ' vs ' + straight.toFixed(1) : 'no path'}`);
    }
  }
  assert.deepEqual(bad, []);
  const wp = M().enemies.find((e) => e.id === 's13').route.points[1];
  assert.ok(wp.z > 116, `Patrol 13's second point is S of wire_sw (${wp.x},${wp.z})`);
});

test('m11 regression: the six enterable buildings have their doors at the dossier points, not at the map origin', () => {
  const ctx = loadGrid(M());
  const doors = [...(ctx.world.entities?.values?.() ?? ctx.world.entities)].filter((i) => i.interactKind === 'door' && i.params?.enterable);
  const want = { house_w: [7.8, 105.2], house_y: [41.4, 91], dugout_y: [62, 86.6], house_e: [82, 71.2], house_l: [59.9, 126], house_a: [31.3, 127] };
  for (const [id, [x, z]] of Object.entries(want)) {
    const d = doors.find((i) => i.params.structure?.id === id), s = d?.params.structure;
    assert.ok(d, `${id}: door spawned`);
    assert.ok(Math.hypot(d.x - x, d.z - z) < 0.01, `${id}: door at (${d.x},${d.z})`);
    const c = Math.cos(-(s.rot || 0)), sn = Math.sin(-(s.rot || 0));
    const lx = (d.x - s.x) * c - (d.z - s.z) * sn, lz = (d.x - s.x) * sn + (d.z - s.z) * c;
    const off = Math.hypot(Math.max(Math.abs(lx) - s.w / 2, 0), Math.max(Math.abs(lz) - s.d / 2, 0));
    assert.ok(off <= 1.0, `${id}: door within 1 m of its walls (${off.toFixed(2)})`);
  }
});

test('m11 regression: an explosion pulls only the men within 45 m (D2), not every investigator on the map', () => {
  const s = m11Sim(), w = s.world;
  for (const e of w.enemies) e.brain.heard.length = 0;
  applyExplosion(w, 32, 119.5, 'barrel', null);
  s.run(0.2);
  const heard = (id) => w.byId(id).brain.heard.some((n) => n.kind === 'explosion');
  for (const id of ['e12', 'e11', 's14', 'e19']) assert.ok(heard(id), `${id} (within 45 m) hears it`);
  for (const id of ['e20', 'e21', 'e31', 'e_hq1', 's30', 'e29']) assert.ok(!heard(id), `${id} (far) does not`);
});

test('m11 regression: losing the escape half-track names it; the silent garrison alerts are no siren alarms (own stat)', () => {
  const s = m11Sim(), w = s.world;
  const a0 = w.stats.alarms || 0;
  w.alarm.fireEvent('EV_C', { zoneId: 'z_c', cause: 'test', x: 50, z: 80 });
  w.alarm.fireEvent('EV_C', { zoneId: 'z_c', cause: 'test', x: 50, z: 80 });
  w.alarm.fireEvent('EV_N', { zoneId: 'z_n', cause: 'test', x: 60, z: 40 });
  s.run(0.2);
  assert.equal(w.alarm.siren.active, false, 'no siren');
  assert.equal(w.stats.alarms, a0, 'silent EV_C / EV_N are not alarms');
  assert.equal(w.stats.zoneAlerts, 2, 'EV_C and EV_N counted once each');
  w.byId('ht_ours').destroy(null, 'explosion');
  s.run(0.5);
  assert.equal(w.scriptFail, 'YOU DESTROYED THE HALF-TRACK, BUT YOU NEEDED IT TO ESCAPE.');
});

test('m11 regression: a save taken right after a load (before the first tick) keeps the half-track\'s occupants', () => {
  const s = m11Sim(), w = s.world, v = w.byId('ht_ours'), dr = s.cmd('driver');
  place(s, dr, v.x - 3, v.z + 2);
  assert.ok(v.enter(dr));
  const d1 = v.serialize();
  assert.deepEqual(d1.occupants, [dr.id]);
  v.occupants = []; v.driver = null; // a freshly spawned hull on quick load …
  v.deserialize(d1); // … whose occupants wait for the first tick to relink
  const d2 = v.serialize();
  assert.deepEqual(d2.occupants, [dr.id], 'occupants survive the early save');
  assert.equal(d2.driver, dr.id);
});

test('m11 regression: heardLocal (D1) and the 45 m pull (D2) hold before the first script tick (a shout on the first step after a quick load)', () => {
  const s = makeSim(M(), { brains: false }), w = s.world; // no step: the lazy script / tick glue has not run
  w.alarm = new Alarm(w);
  assert.equal(w.alarm.raise('z_sw', 'heard', 69, 118.4, { sensor: 'heard' }), null, 'a shout in the lowlands does not sound the camp siren');
  assert.equal(w.alarm.raise('z_sw', 'heard', 30, 130, { sensor: 'heard' }), 'RINT', 'a noise in the camp does');
  const noises = [];
  w.events.on('noise', (n) => noises.push(n));
  applyExplosion(w, 30.5, 92.5, 'bomb', null);
  const blasts = noises.filter((n) => n.kind === 'explosion');
  assert.ok(blasts.some((n) => n.x === 30.5 && n.z === 92.5 && n.radius === 45), 'the bomb is heard 45 m out');
  assert.ok(blasts.every((n) => n.radius <= 45), JSON.stringify(blasts.map((n) => n.radius)));
});

test('m11 regression: the half-track drives from the plateau loop E along the ridge over the quarry and back (Prima\'s exit)', () => {
  const s = m11Sim(), w = s.world, v = w.byId('ht_ours');
  s.run(0.2);
  place(s, v, 50, 45);
  v.heading = Math.PI / 4;
  s.run(0.2);
  v.followPath([[53, 52], [56, 55.5], [62, 56.5], [80, 56.5]].map(([x, z]) => ({ x, z })), { speed: 5 });
  s.run(40, () => !v.path && !v.goal);
  assert.ok(Math.hypot(v.x - 80, v.z - 56.5) < 1.5 && v.y === 6, `on the ridge (${v.x.toFixed(1)},${v.z.toFixed(1)} y ${v.y})`);
  v.followPath([[62, 56.5], [56, 55.5], [53, 52], [50, 45]].map(([x, z]) => ({ x, z })), { speed: 5 });
  s.run(40, () => !v.path && !v.goal);
  assert.ok(Math.hypot(v.x - 50, v.z - 45) < 1.5, `back on the loop (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
});

// ------------------------------------------------------------------ fix round 2 (playtest findings)

test('m11 regression: the Sniper on the ridge shoots the tanker at W_mid with the rifle (dossier step 25); both N rigs fall', () => {
  const s = m11Sim(), w = s.world, sn = s.cmd('sniper'), t = w.byId('tanker');
  place(s, sn, 95, 54);
  assert.ok(tankerAtMid(s), 'the tanker waits at W_mid');
  const far = ABILITIES.sniper.canUse(sn, t, w);
  assert.equal(far, 'No line of sight.', 'from the E end rig_ne stands in the way (a sight reason, not "Pick an enemy.")');
  assert.ok(path(w.grid, [95, 54], [80.5, 57.5], 'sniper'), 'he walks W along the ridge');
  place(s, sn, 80.5, 57.5);
  assert.equal(sn.y, 6, 'on the ridge');
  { const r = ABILITIES.sniper.canUse(sn, t, w); assert.equal(r, true, `the hull is a rifle target (${r}; tanker ${t.x.toFixed(1)},${t.z.toFixed(1)})`); }
  const rounds = sn.inventory.get ? sn.inventory.get('sniperRifle') : sn.inventory.sniperRifle;
  assert.ok(sn.issue({ type: 'ability', id: 'sniper', target: t }), 'rifle order on the tanker accepted');
  s.run(4);
  assert.ok(t.destroyed, 'the tanker blows');
  for (const id of ['rig_nw', 'rig_ne']) assert.ok(gone(w.byId(id)), `${id} down`);
  const left = sn.inventory.get ? sn.inventory.get('sniperRifle') : sn.inventory.sniperRifle;
  assert.equal(left, rounds - 1, 'one round spent');
});

test('m11 regression: the half-track drives the W road leg by leg through both bends (no stall on a ramp corner)', () => {
  /** Board the Driver, set the hull at the first point, then one straight order per leg (two tries each). */
  const legs = (pts) => {
    const s = m11Sim(), w = s.world, v = w.byId('ht_ours'), dr = s.cmd('driver');
    place(s, dr, v.x - 3, v.z + 2);
    assert.ok(v.enter(dr));
    const [x0, z0] = pts[0], [x1, z1] = pts[1];
    place(s, v, x0, z0);
    v.heading = Math.atan2(z1 - z0, x1 - x0);
    s.run(0.2);
    for (const [x, z] of pts.slice(1)) {
      for (let k = 0; k < 2 && Math.hypot(v.x - x, v.z - z) > 1; k++) { v.driveTo(x, z); s.run(25, () => !v.goal); }
      assert.ok(Math.hypot(v.x - x, v.z - z) <= 1, `leg to (${x},${z}) ends at (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
    }
  };
  // down from the plateau (the playtest's stalling leg (4.5,51.5) → (8,56.5)) and out through gate 1
  legs([[4, 44.5], [4, 48], [4.5, 51.5], [8, 56.5], [17.5, 57], [25.5, 58]]);
  legs([[4, 44.5], [3, 50.5], [8, 56.5], [16.5, 57]]);
  // and back up
  legs([[25.5, 57.2], [17.5, 57], [8, 56.5], [4.5, 51.5], [4, 48], [4, 44.5]]);
});
