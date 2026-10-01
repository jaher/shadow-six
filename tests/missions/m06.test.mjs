/**
 * BEL M6 "Menace of the Leopold" (docs/missions/m06.md): schema + §10.5 test #14, deck access, the silent zone,
 * objective/extraction wiring and the dossier's test hooks (§11): the armoured-car bomb raises no alarm, the gun
 * only falls to a charge within 3 m of `leopold_charge`, the truck comes in NE after o1.
 * Run with the unit suite: node tests/unit/run.mjs m06
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
import { installSetpieces } from '../../src/missions/setpieces.js';
import { canSee } from '../../src/ai/perception.js';

const M = () => getMission('m06');
const DECK_W = { x: 32, z: 35 }; // centre of the W ruin's upper floor (y 3.2)
const path = (g, a, b, role) => findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000 });

test('m06: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m06: §3.8 row 6 loadout exactly (GB knife/pistol/decoy/shovel; Sniper 5 rounds + kit; Sapper trap + 2 remote bombs)', () => {
  const L = belLoadout(6);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('sapper', M().commandos[2].inventory).remoteBomb, 2);
  assert.equal(spawnInventory('sniper', M().commandos[1].inventory).sniperRifle, 5);
});

test('m06: §10.5 #14 — loads; starts reach the gun, its charge marker and the truck; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M()), []);
});

test('m06: enemy count matches Kildread (13 walkers, 18 sentries, patrols of 2 and 3, Gatling, armoured car)', () => {
  const m = M();
  const foot = m.enemies.filter((e) => !e.vehicle);
  const squads = {};
  for (const e of foot) if (e.squad) (squads[e.squad.id] ||= []).push(e.id);
  assert.deepEqual(Object.values(squads).map((s) => s.length).sort(), [2, 3]);
  const solo = foot.filter((e) => !e.squad && e.soldierType !== 'mg');
  assert.equal(solo.filter((e) => e.route).length, 13, 'walkers');
  assert.equal(solo.filter((e) => !e.route).length, 18, 'sentries');
  assert.equal(foot.filter((e) => e.soldierType === 'mg').length, 1, 'Gatling');
  assert.ok(m.vehicles.some((v) => v.vehicleType === 'sdkfz' && v.route));
  assert.deepEqual(Object.keys(m.barracks).sort(), ['barr_c', 'chapel', 'hq']);
});

test('m06: W ruin deck — GB up and down by the climb spot; everyone by the ladder and both stairways; NE ruin by its ladder', () => {
  const ctx = loadGrid(M());
  const g = ctx.grid;
  assert.ok(Math.abs(g.elevAt(DECK_W.x, DECK_W.z) - 3.2) < 0.01, 'W ruin upper floor at 3.2 m');
  assert.ok(Math.abs(g.elevAt(120, 44) - 3.2) < 0.01, 'NE ruin upper floor at 3.2 m');
  const links = g.links;
  const only = (keep) => links.forEach((l) => g.setLinkEnabled(l.id, l === keep));
  const byEnd = (x, z) => links.find((l) => Math.hypot(l.a.x - x, l.a.z - z) < 1.5 || Math.hypot(l.b.x - x, l.b.z - z) < 1.5);
  const start = M().commandos[0];
  only(null);
  assert.equal(path(g, start, DECK_W, 'greenberet'), null, 'no ground route onto the deck');
  // climb spot: the GB only
  only(byEnd(18.8, 36));
  assert.ok(path(g, start, DECK_W, 'greenberet'), 'GB climbs onto the W ruin');
  assert.ok(path(g, DECK_W, { x: 10, z: 60 }, 'greenberet'), 'GB climbs back down');
  assert.equal(path(g, start, DECK_W, 'sapper'), null, 'the Sapper cannot use the climb spot');
  // ladder + stairs: everyone, both ways
  for (const [x, z] of [[45.4, 27], [30, 49], [47, 45]]) {
    only(byEnd(x, z));
    for (const role of ['greenberet', 'sniper', 'sapper']) {
      assert.ok(path(g, start, DECK_W, role), `${role} up the link at (${x},${z})`);
      assert.ok(path(g, DECK_W, { x: 60, z: 70 }, role), `${role} down the link at (${x},${z})`);
    }
  }
  only(byEnd(108.8, 51));
  assert.ok(path(g, { x: 104, z: 52 }, { x: 120, z: 44 }, 'greenberet'), 'NE ruin ladder');
  links.forEach((l) => g.setLinkEnabled(l.id, true));
});

test('m06: silent zone — start corner, SW field, barricade guard and the armoured car turn-round are outside; the ruin → gun inside; noise never alarms', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const c of M().commandos) assert.equal(a.zoneAt(c.x, c.z), null, `${c.role} start`);
  for (const [x, z] of [[24, 52.5], [14, 77], [38, 78], [28, 57], [12, 48], [21, 66], [64, 92]]) assert.equal(a.zoneAt(x, z), null, `(${x},${z}) outside`);
  for (const [x, z] of [[32, 35], [59, 60], [90, 74], [98, 55], [106, 17], [120, 44], [112, 6]]) assert.equal(a.zoneAt(x, z)?.id, 'z_base', `(${x},${z}) inside`);
  assert.equal(M().zones[0].onHeard, null);
  assert.equal(M().zones[0].onSeen, 'RINT');
  assert.equal(M().alarmFail ?? null, null);
});

/** Full M6 sim with brains and the alarm, stepped like Game.step. */
function m06Sim(brains = true) {
  const s = makeSim(M(), { brains });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  s.alarms = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ t: w.time, zone: p.zone?.id ?? p.zone ?? p.id, event: p.event }));
  w.objectives = createObjectives(s.mission.objectives);
  return s;
}
const gunTarget = (w) => w.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === 'leopold' || i.id === 'leopold'));

test('m06 hook: the gun falls only to a charge within 3 m of leopold_charge (a bomb 4 m off does nothing) → o1 done', () => {
  const s = m06Sim(false), w = s.world;
  const mk = w.markers.get('leopold_charge');
  assert.ok(mk && mk.r === 3);
  const gun = gunTarget(w);
  assert.ok(gun, 'the Leopold is an explosive target');
  assert.equal(gun.marker, 'leopold_charge');
  applyExplosion(w, mk.x, mk.z + 4, 'bomb');
  applyExplosion(w, mk.x - 4, mk.z, 'grenade');
  assert.ok(!gun.destroyed, '4 m off / grenade: still standing');
  assert.equal(checkObjectives(w).changed.length, 0);
  applyExplosion(w, mk.x + 1.5, mk.z + 1.5, 'bomb');
  assert.ok(gun.destroyed, 'bomb at the foot of the ladder');
  checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done);
  assert.ok(!w.objectives.find((o) => o.id === 'o2').done, 'escape still open');
});

test('m06 hook: remote bomb at the armoured car\'s W turn-round destroys it; e14 stands clear of the blast — no alarm, no siren', () => {
  const s = m06Sim(true), w = s.world;
  const car = s.get('sdkfz'), e14 = s.get('e14');
  s.run(1);
  assert.ok(Math.hypot(car.x - 24, car.z - 52.5) < 1.5, 'the car waits at its W turn-round');
  assert.equal(w.alarm.zoneAt(car.x, car.z), null, 'turn-round outside z_base');
  applyExplosion(w, 24.5, 55, 'bomb', s.cmd('sapper'));
  s.run(4);
  assert.ok(car.destroyed, 'armoured car destroyed');
  assert.equal(e14.alive, true, 'e14 is clear of the 9 m wreck blast (his body would be found from inside the zone)');
  assert.ok(Math.hypot(e14.x - 24, e14.z - 52.5) > 10);
  assert.deepEqual(s.alarms, [], 'no zone alarm (noise never alarms z_base)');
  assert.equal(w.alarm.active, false, 'no siren');
});

test('m06 hook: blowing the gun raises the base (T1), reveals o2 and calls the truck in from the NE; it stops NE of the Gatling', () => {
  const s = m06Sim(false), w = s.world;
  installSetpieces(w, s.mission, { meshes: false });
  const flags = {};
  s.run(0.2);
  assert.equal(updateExtractionVehicle(w, flags), null, 'no truck before o1');
  const mk = w.markers.get('leopold_charge');
  applyExplosion(w, mk.x, mk.z, 'bomb');
  checkObjectives(w);
  let truck = null;
  s.run(20, () => { truck = updateExtractionVehicle(w, flags); return flags.evacPhase === 'wait'; });
  assert.ok(w.alarm.active, 'T1: the base is raised as the truck comes in');
  assert.ok(s.alarms.some((a) => a.event === 'RINT'), 'RINT');
  assert.equal(w.objectives.find((o) => o.id === 'o2').hidden, false, 'o2 shown');
  assert.ok(truck && !truck.destroyed && truck.friendly !== false, 'friendly truck spawned');
  assert.equal(flags.evacPhase, 'wait');
  assert.ok(truck.tainted, 'T1 taints the truck: every enemy gun that sees it fires on it');
  assert.ok(Math.hypot(truck.x - 112, truck.z - 6) < 3, `waits at (112,6): (${truck.x.toFixed(1)},${truck.z.toFixed(1)})`);
  const e34 = s.get('e34');
  assert.ok(Math.hypot(e34.x - truck.x, e34.z - truck.z) < 16, 'within the Gatling\'s reach: kill e34 before the gun blows');
});

test('m06 hook: any bomb inside the 3 m marker circle brings the gun down (the whole circle is within the blast candidate radius)', () => {
  for (let k = 0; k < 8; k++) {
    const s = m06Sim(false), w = s.world;
    const mk = w.markers.get('leopold_charge'), a = (k * Math.PI) / 4;
    applyExplosion(w, mk.x + 2.9 * Math.cos(a), mk.z + 2.9 * Math.sin(a), 'bomb');
    assert.ok(gunTarget(w).destroyed, `bomb at ${k * 45}° on the marker rim`);
  }
});

// ---- replay m06 regressions (mis_fix_6) -------------------------------------------------------------------------

test('m06 regression: the N edge is sealed — the NE wire belt meets the rocks N of the Gatling; the only way E is round its S end', () => {
  const g = loadGrid(M()).grid;
  for (const [a, b] of [[{ x: 86, z: 10 }, { x: 112, z: 6 }], [{ x: 80, z: 3 }, { x: 110, z: 3 }], [{ x: 95, z: 1 }, { x: 107, z: 1 }]]) {
    const p = path(g, a, b, 'greenberet');
    assert.ok(p, `route (${a.x},${a.z}) → (${b.x},${b.z})`);
    // the barrier: the wire (95,24) → (104.5,6.5), on through the rock pile to the map edge
    const bar = [[95, 24], [104.5, 6.5], [102, 3], [102, -1]];
    const cross = (a1, a2, b1, b2) => {
      const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      return d(a1, a2, b1) * d(a1, a2, b2) < 0 && d(b1, b2, a1) * d(b1, b2, a2) < 0;
    };
    const pts = [[a.x, a.z], ...p.map((q) => [q.x, q.z])];
    for (let i = 1; i < pts.length; i++) for (let k = 1; k < bar.length; k++) {
      assert.ok(!cross(pts[i - 1], pts[i], bar[k - 1], bar[k]), `route crosses the belt at (${pts[i]})`);
    }
    assert.ok(pts.some(([x, z]) => z > 23 && x > 93 && x < 98), 'goes round the belt\'s S end');
  }
});

test('m06 regression: the N strip is guarded — every point from x 20 to 70 along the N edge is watched within 60 s', () => {
  const s = m06Sim(true), w = s.world;
  const pts = [[20, 5], [30, 4], [40, 9], [50, 7], [60, 3], [70, 8]].map(([x, z]) => ({ x, z, seen: null }));
  for (let t = 0; t < 60 && pts.some((p) => !p.seen); t += 0.25) {
    s.run(0.25);
    for (const p of pts) {
      if (p.seen) continue;
      const u = { x: p.x, z: p.z, y: 0, kind: 'commando', isLow: false, isVisibleToEnemies: true, alive: true };
      const e = w.enemies.find((q) => q.alive && q.vision && canSee(q, u, w) !== 'none');
      if (e) p.seen = e.tag || e.id;
    }
  }
  for (const p of pts) assert.ok(p.seen, `(${p.x},${p.z}) never watched`);
});

test('m06 regression: the W ruin deck has partitions (block sight on the deck), parapets (block walking, not sight) and the clock', () => {
  const g = loadGrid(M()).grid;
  const los = (a, b) => g.lineOfSight(a[0], a[1], b[0], b[1], { viewerY: 3.2, targetY: 3.2 });
  const climbTop = [20.8, 36], e2 = [24, 28];
  // e7's W stop, e5's walk and e3's walk no longer see the climb top; e5/e7 no longer see e2's post
  for (const v of [[26, 36], [33, 36], [40, 38], [34, 41]]) assert.equal(los(v, climbTop), false, `(${v}) → climb top`);
  for (const v of [[26, 36], [33, 36], [40, 38], [34, 41]]) assert.equal(los(v, e2), false, `(${v}) → e2's post`);
  assert.equal(los([27, 31], e2), true, 'e3 still watches e2 inside the N room');
  // parapets: a man on the deck is still seen from the ground over them; the climb spot, ladder and stair heads are open
  assert.equal(g.lineOfSight(12, 48, 22, 42, { viewerY: 0, targetY: 3.2 }), true, 'ground → deck over the W parapet');
  for (const [x, z] of [[20.8, 36], [43.4, 27], [30, 45.5], [43.4, 42]]) assert.ok(Math.abs(g.elevAt(x, z) - 3.2) < 0.01, `link head (${x},${z}) on the deck`);
  assert.ok(g.elevAt(22.5, 27.5) > 5, 'the clock stands on the deck');
  assert.ok(g.elevAt(20.3, 30) > 4 && g.elevAt(20.3, 30) < 4.5, 'W parapet 1 m');
});

test('m06 regression: e11 at the barricade never has the GB\'s climb foot in his cone', () => {
  const s = m06Sim(true), w = s.world, e11 = s.get('e11'), c = M().climbLinks[0].a;
  const u = { x: c[0], z: c[1], y: 0, kind: 'commando', isLow: true, isVisibleToEnemies: true, alive: true };
  const U = { ...u, isLow: false };
  for (let t = 0; t < 30; t += 0.1) {
    s.run(0.1);
    assert.equal(canSee(e11, u, w), 'none', `prone at t ${t.toFixed(1)}`);
    assert.equal(canSee(e11, U, w), 'none', `standing at t ${t.toFixed(1)}`);
  }
});

test('m06 regression: the Leopold\'s objective message names it; the lost truck gives the truck message even if its blast kills a man', () => {
  const s = m06Sim(false), w = s.world;
  installSetpieces(w, s.mission, { meshes: false });
  const msgs = [];
  w.events.on('message', (m) => msgs.push(m.text));
  const mk = w.markers.get('leopold_charge');
  applyExplosion(w, mk.x, mk.z, 'bomb');
  assert.ok(msgs.some((t) => /^The Leopold railway gun destroyed\./.test(t)), msgs.join(' | '));
  assert.ok(!msgs.some((t) => /k5/i.test(t)));
  const tr = M().triggers.find((t) => t.on === 'vehicle:destroyed');
  assert.equal(tr.match.vehicle, 'evac_truck');
  assert.match(tr.do[0].fail, /DESTROYED THE TRUCK/);
});

test('m06 regression: armoured-car bomb with the whole garrison present — investigators stop at the burning wreck; no death, no alarm', () => {
  const s = m06Sim(true), w = s.world, car = s.get('sdkfz');
  const died = [];
  w.events.on('unit:killed', (p) => died.push(p.unit?.tag || p.unit?.id));
  s.run(20); // the car leaves its W turn-round …
  const clear = () => w.enemies.every((e) => !e.alive || e.vehicle || e.state === 'inVehicle' || Math.hypot(e.x - car.x, e.z - car.z) > 10);
  s.run(200, () => Math.hypot(car.x - 24, car.z - 52.5) < 1.5 && clear()); // … and comes back
  assert.ok(Math.hypot(car.x - 24, car.z - 52.5) < 1.5, 'back at the turn-round');
  const inv = new Set();
  w.events.on('enemy:state', (p) => { if (p.state === 'INVESTIGATE') inv.add(p.enemy?.tag || p.enemy); });
  applyExplosion(w, car.x + 0.5, car.z + 1, 'bomb', s.cmd('sapper'));
  let minD = Infinity;
  s.run(60, () => {
    if (car.burning) for (const e of w.enemies) if (e.alive && !e.vehicle && e.state !== 'inVehicle') minD = Math.min(minD, Math.hypot(e.x - car.x, e.z - car.z));
    return false;
  });
  assert.ok(car.destroyed);
  assert.deepEqual(died.filter((id) => id !== 'e38'), [], 'nobody walks into the fire');
  assert.ok(minD > 2.5, `closest approach to the burning wreck ${minD.toFixed(1)} m`);
  assert.deepEqual(s.alarms, [], 'no zone alarm');
  assert.equal(w.alarm.active, false);
});

test('m06 regression: a guard who sees a comrade die fights towards the body but does not "spot" the unseen killer', () => {
  const s = m06Sim(true), w = s.world, e20 = s.get('e20'), e21 = s.get('e21'), sap = s.cmd('sapper');
  s.run(0.5);
  e20.heading = Math.atan2(e21.z - e20.z, e21.x - e20.x);
  e20.post && (e20.post.heading = e20.heading);
  // 2 m nearer: at his post e21 sits on the rim of e20's swept cone (19.2 of 19.4 m), and the falling body
  // (death fall, ~0.3 m) can land just outside it — the case is the unseen killer, not the range edge
  e20.x += Math.cos(e20.heading) * 2; e20.z += Math.sin(e20.heading) * 2;
  const spotted = [];
  w.events.on('enemy:spotted', (p) => spotted.push(p.enemy?.tag || p.enemy));
  applyExplosion(w, e21.x, e21.z, 'bomb', sap);
  assert.equal(e21.alive, false);
  assert.ok(e20.brain.state === 'COMBAT' || e20.sawKill, 'e20 saw e21 die');
  assert.deepEqual(spotted, [], 'nobody spotted the Sapper, 60+ m away at the start');
});

test('m06 regression: T1 runs cleanly when e34\'s brain has no onBoardSeen (stub brain): no "[setpieces] action failed"', () => {
  const s = m06Sim(false), w = s.world;
  assert.equal(typeof s.get('e34').brain.onBoardSeen, 'undefined', 'stub brain lacks onBoardSeen');
  installSetpieces(w, s.mission, { meshes: false });
  const errs = [], orig = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  try {
    s.run(0.2);
    const mk = w.markers.get('leopold_charge');
    applyExplosion(w, mk.x, mk.z, 'bomb');
    checkObjectives(w);
    const flags = {};
    s.run(5, () => { updateExtractionVehicle(w, flags); return false; });
  } finally { console.error = orig; }
  assert.ok(w.byId('evac_truck')?.tainted, 'T1 fired (truck tainted)');
  assert.deepEqual(errs.filter((t) => /action failed/.test(t)), []);
});
