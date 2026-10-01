/**
 * BEL M10 "Operation Icarus" (docs/missions/m10.md): schema + §10.5 test #14, the §3.8 loadout and McRae, the
 * census, the airfield shelf and its ramp, the two zones, and the dossier's acceptance checks (§14.1): the lure shot
 * raises nothing, boarding the vacant Panzer IV sounds the camp alarm and wakes the tanks, grenades kill the
 * crewed tanks but not the stolen one, pz24 parks below the ramp, the Ju 52 is indestructible and only McRae
 * flies it, and the full objective chain (free McRae → store → everyone aboard → take-off) wins.
 * Run with the unit suite: node tests/unit/run.mjs m10
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { B } from '../../src/world/grid.js';
import { CONFIG } from '../../src/config.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { installSetpieces } from '../../src/missions/setpieces.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { PZ21_ROUTE, PZ24_ROUTE, PZ22_LOOP } from '../../src/missions/m10_operation_icarus.js';
import { m10Tick, STANDBY_EYES } from '../../src/missions/scripts/m10.js';
import { canSee, coneAt, hears } from '../../src/ai/perception.js';
import { viewerFor } from '../../src/ai/vehicle-ai.js';

const M = () => getMission('m10');
const path = (g, a, b, role) => findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000 });
const START = { x: 11.5, z: 58 };
const JU52 = { x: 91, z: 27 }; // beside the plane's hull
const RAMP_HEAD = { x: 73, z: 47.5 };
const plen = (p) => p.reduce((a, q, k) => (k ? a + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);

test('m10: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  assert.equal(m.theater, 'desert');
  assert.equal(m.coneColors, 'desert');
  assert.deepEqual(m.size, [119, 209]);
  assert.equal(m.par.time, 780);
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m10: §3.8 row 10 loadout exactly (+ McRae jailed in the pen); 4 site barrels; the vacant tank and the plane', () => {
  const L = belLoadout(10);
  const team = M().commandos.filter((c) => c.role !== 'guest');
  assert.deepEqual(team.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of team) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(spawnInventory('sniper', team[1].inventory).sniperRifle, 3);
  assert.equal(spawnInventory('driver', team[3].inventory).smg, 20, '100 rounds = 20 bursts');
  const guests = M().commandos.filter((c) => c.role === 'guest');
  assert.deepEqual(guests.map((g) => g.guestId), L.guests);
  assert.equal(guests[0].jailed, true);
  assert.equal(guests[0].jailId, 'pen');
  const loose = M().structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel' && s.carriable);
  assert.equal(loose.length, L.site.barrels, 'four loose explosive barrels');
  const pz4 = M().vehicles.find((v) => v.id === 'pz4');
  assert.ok(pz4.driveable && pz4.operators.includes('driver') && !pz4.crew, 'the vacant Panzer IV');
  assert.deepEqual(M().vehicles.find((v) => v.id === 'ju52').operators, ['mcrae']);
});

test('m10: §10.5 #14 — loads; starts reach every objective and the Ju 52; no start in a cone; routes walkable', () => {
  assert.deepEqual(checkMission(M()), []);
});

test('m10: census (Kildread): 9 walkers, 9 sentries, two 3-man patrols, 3 MG gunners, 4 crewed Panzer IVs, 2 garrisons of 9', () => {
  const m = M();
  const singles = m.enemies.filter((e) => !e.squad && e.soldierType !== 'mg');
  assert.equal(singles.filter((e) => e.route).length, 9, 'walkers');
  assert.equal(singles.filter((e) => !e.route).length, 9, 'sentries');
  const squads = {};
  for (const e of m.enemies.filter((x) => x.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(squads, { p4: 3, p20: 3 });
  const gunners = m.enemies.filter((e) => e.soldierType === 'mg');
  assert.deepEqual(gunners.map((g) => g.emplacement), ['mg_1', 'mg_2', 'mg_3']);
  const crewed = m.vehicles.filter((v) => v.vehicleType === 'panzer4' && v.crew?.length);
  assert.deepEqual(crewed.map((v) => v.id), ['pz21', 'pz22', 'pz23', 'pz24']);
  assert.ok(crewed.every((v) => v.behavior === 'standby' && v.driveable === false));
  assert.deepEqual(Object.keys(m.barracks).sort(), ['barracks', 'dugout']);
  assert.equal(m.barracks.barracks.pool, 9);
  assert.equal(m.barracks.dugout.pool, 9);
  assert.deepEqual(m.barracks.barracks.squads.map((s) => s.event), ['RINT', 'RINT', 'RINT']);
  assert.deepEqual(m.barracks.dugout.squads.map((s) => s.event), ['RINT_AIR', 'RINT_AIR', 'RINT_AIR']);
});

test('m10: the airfield is a 5 m shelf; the only way up is the road ramp; the GB alone climbs the W wall', () => {
  const { grid: g } = loadGrid(M());
  for (const [x, z] of [[91, 27], [21, 36], [60, 40], [110, 10]]) assert.ok(Math.abs(g.elevAt(x, z) - 5) < 0.01, `shelf at (${x},${z})`);
  for (const [x, z] of [[11.5, 58], [48, 177], [67, 90], [100, 70]]) assert.equal(g.elevAt(x, z), 0, `floor at (${x},${z})`);
  const mid = g.elevAt(70.2, 56.5);
  assert.ok(mid > 1 && mid < 4, `ramp half-way up: ${mid}`);
  const up = path(g, START, JU52, 'driver');
  assert.ok(up, 'the team walks up to the plane');
  assert.ok(up.some((p) => Math.hypot(p.x - 70.2, p.z - 56.5) < 3), 'by the ramp');
  // straight below the W rim the walk goes all the way round by the ramp
  const round = path(g, { x: 30, z: 55 }, { x: 30, z: 46 }, 'greenberet');
  assert.ok(round && plen(round) > 60, `the escarpment is a wall (${round && plen(round).toFixed(1)} m)`);
  const cl = M().climbLinks;
  assert.equal(cl.length, 1);
  assert.deepEqual(cl[0].roles, ['greenberet']);
});

test('m10: belts W1 and E2 run up to the rim — no walk from the ruins or the E field to the ramp foot along the cliff', () => {
  const { grid: g } = loadGrid(M());
  const maxZ = (p) => Math.max(...p.map((q) => q.z));
  // playtest: (30,58) → (47.8,55.8) → ramp foot skipped the N gate, the road, e11 and g3
  const w = path(g, { x: 30, z: 58 }, { x: 67, z: 66 }, 'sapper');
  assert.ok(w && maxZ(w) > 120, `ruins → ramp foot goes round by the N gate (max z ${w && maxZ(w).toFixed(0)})`);
  const e = path(g, { x: 100, z: 60 }, { x: 67, z: 66 }, 'sapper');
  assert.ok(e && maxZ(e) > 90, `E field → ramp foot goes round the S end of E2 (max z ${e && maxZ(e).toFixed(0)})`);
});

/** Is (x, z) seen by any of `ids` (crewed vehicles) at any time in a 12 s window? low = prone. */
function tankSees(w, ids, x, z, low) {
  for (const id of ids) {
    const e = viewerFor(w.byId(id));
    for (let t = 0; t < 12; t += 0.25) {
      if (canSee(e, { kind: 'commando', x, z, y: 0, isLow: low, alive: true }, w, { cone: coneAt(e, t) }) !== 'none') return id;
    }
  }
  return null;
}

test('m10: shed_3\'s W wall is solid (fence_f3 stops at its corner): pz24 cannot see back into the compound', () => {
  const s = makeSim(M(), { brains: false }), w = s.world;
  m10Tick(w);
  w.alarm = { zonesFired: [{ event: 'RINT' }] };
  m10Tick(w); // widest cone: the alarm profile
  // playtest: spotted and shelled the GB at (34.8,190.9) through its own back wall
  for (const [x, z] of [[34.8, 190.9], [41, 187], [52, 178], [55, 172], [56, 180]]) {
    assert.equal(tankSees(w, ['pz24'], x, z, false), null, `pz24 sees (${x},${z})`);
  }
  const f3 = M().structures.find((x) => x.id === 'fence_f3').points;
  const shedW = M().structures.find((x) => x.id === 'shed_3').points;
  assert.ok(f3.every(([, z]) => z < 175.3), 'f3 ends at the NW corner of shed_3');
  assert.ok(shedW.length === 4, 'shed_3 three walls');
});

test('m10 hook: on standby the shed tanks watch only their mouths — a prone Driver can crawl to the vacant tank; the alarm widens them', () => {
  const s = makeSim(M(), { brains: false }), w = s.world;
  m10Tick(w);
  const ids = ['pz21', 'pz22', 'pz23', 'pz24'];
  for (const id of ids) assert.equal(w.byId(id).vision.fovDeg, STANDBY_EYES.fov, `${id} standby cone`);
  // behind shed 1, down the E strip, across S of the inverted-T wall to the mouth of shed 5
  const WP = [[96, 128], [110, 136], [114, 148], [115, 175], [104, 186], [103, 197]];
  let bad = [];
  for (let k = 0; k + 1 < WP.length; k++) {
    const p = findPath(w.grid, WP[k][0], WP[k][1], WP[k + 1][0], WP[k + 1][1], { role: 'driver', maxNodes: 400000 });
    assert.ok(p, `crawl leg ${k}`);
    for (let n = 0; n + 1 < p.length; n++) {
      const a = p[n], b = p[n + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < L; t += 0.5) {
        const x = a.x + ((b.x - a.x) * t) / L, z = a.z + ((b.z - a.z) * t) / L, v = tankSees(w, ids, x, z, true);
        if (v) bad.push(`${v}@${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], 'the prone crawl stays out of every standby cone');
  assert.ok(Math.hypot(103 - w.byId('pz4').x, 197 - w.byId('pz4').z) < 4, 'ends beside the vacant Panzer IV');
  // the camp alarm: full 'tank' profile back (70° cone + turret sweep); the E strip entry is covered again
  w.alarm = { zonesFired: [{ event: 'RINT' }] };
  m10Tick(w);
  for (const id of ids) assert.ok(w.byId(id).vision.fovDeg > STANDBY_EYES.fov && w.byId(id).vision.sweepDeg > 0, `${id} awake`);
  assert.ok(tankSees(w, ids, 114, 147, true), 'awake, pz21 watches the E strip entry');
});

test('m10: two zones — the camp reacts to sight only, the airfield to sight and sound; the ruins and the road are in none', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const [x, z] of [[11.5, 58], [24, 73], [12, 98], [67, 90], [54, 62]]) assert.equal(a.zoneAt(x, z), null, `no zone at (${x},${z})`);
  for (const [x, z] of [[31, 151], [48, 177], [88, 121], [106, 199]]) assert.equal(a.zoneAt(x, z)?.id, 'z_camp', `camp at (${x},${z})`);
  for (const [x, z] of [[91, 20], [21, 30]]) assert.equal(a.zoneAt(x, z)?.id, 'z_air', `airfield at (${x},${z})`);
  const zc = M().zones.find((z) => z.id === 'z_camp'), za = M().zones.find((z) => z.id === 'z_air');
  assert.equal(zc.onSeen, 'RINT');
  assert.equal(zc.onHeard, null);
  assert.equal(za.onSeen, 'RINT_AIR');
  assert.equal(za.onHeard, 'RINT_AIR');
  assert.equal(M().alarmFail ?? null, null, 'no alarm-fail script');
});

/** Hull clearance along a straight leg: no blocked or raised cell within the half-width (+0.2 m). */
function legClear(g, a, b, half = 1.45 + 0.2) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.1) return null;
  const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  for (let t = 0; t <= len; t += 0.25) {
    for (let o = -half; o <= half + 1e-6; o += 0.25) {
      const x = a.x + ux * t - uz * o, z = a.z + uz * t + ux * o;
      const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
      const k = g.idx(i, j);
      if (g.block[k] !== B.NONE || g.elev[k] > 0.3) return { x: +x.toFixed(2), z: +z.toFixed(2) };
    }
  }
  return null;
}

test('m10: the alarm routes of pz21 (apron), pz24 (to below the ramp) and pz22 (E-side loop) are clear for a Panzer IV hull', () => {
  const { grid: g, handle } = loadGrid(M());
  // the N gate starts open; clear it in the grid as the game does
  const gate = handle.structures.get('gate_n');
  g.clearOwner(gate.owner);
  const spot = (id) => { const v = M().vehicles.find((x) => x.id === id); return { x: v.x, z: v.z }; };
  const r24 = [spot('pz24'), ...PZ24_ROUTE.map(([x, z]) => ({ x, z }))];
  for (let k = 0; k + 1 < r24.length; k++) assert.equal(legClear(g, r24[k], r24[k + 1]), null, `pz24 leg ${k} (${r24[k].x},${r24[k].z})→(${r24[k + 1].x},${r24[k + 1].z})`);
  const r21 = [spot('pz21'), ...PZ21_ROUTE.map(([x, z]) => ({ x, z }))];
  for (let k = 0; k + 1 < r21.length; k++) assert.equal(legClear(g, r21[k], r21[k + 1]), null, `pz21 leg ${k}`);
  const r22 = [spot('pz22'), ...PZ22_LOOP];
  for (let k = 0; k + 1 < r22.length; k++) assert.equal(legClear(g, r22[k], r22[k + 1]), null, `pz22 leg ${k}`);
  assert.equal(legClear(g, PZ22_LOOP[PZ22_LOOP.length - 1], PZ22_LOOP[0]), null, 'pz22 loop closes');
  // the ramp itself is raised: no tank ever climbs it (the dossier's chevaux-de-frise stop)
  assert.ok(legClear(g, { x: 67.5, z: 66.5 }, RAMP_HEAD), 'the ramp is closed to vehicles');
});

/** Full M10 sim: alarm, objectives, triggers (the director runs the mission script on its first tick). */
function m10Sim() {
  const s = makeSim(M(), { brains: false });
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  w.objectives = createObjectives(s.mission.objectives);
  installSetpieces(w, s.mission, { meshes: false });
  s.run(0.1);
  return s;
}
const objDone = (w, id) => w.objectives.find((o) => o.id === id).done;
const events = (w) => w.alarm.zonesFired.map((f) => f.event);

test('m10 hook: grenades kill the crewed Panzer IVs and the Stukas, not the stolen tank; the Ju 52 survives anything', () => {
  const s = m10Sim(), w = s.world;
  m10Tick(w);
  const pz21 = w.byId('pz21'), pz4 = w.byId('pz4'), ju = w.byId('ju52'), st = w.byId('stuka_a');
  applyExplosion(w, pz21.x, pz21.z, 'grenade', s.cmd('sapper'));
  assert.ok(pz21.destroyed, 'a grenade in shed 1 destroys pz21');
  applyExplosion(w, pz4.x, pz4.z, 'grenade', s.cmd('sapper'));
  assert.ok(!pz4.destroyed, 'the vacant Panzer IV keeps its heavy armour');
  applyExplosion(w, ju.x, ju.z, 'bomb', null);
  for (let k = 0; k < 60; k++) ju.hit?.(null, 'bullet');
  assert.ok(!ju.destroyed, 'the Ju 52 is indestructible');
  assert.equal(ju.y, 5, 'parked on the shelf');
  applyExplosion(w, st.x, st.z, 'grenade', s.cmd('sapper'));
  assert.ok(st.destroyed, 'a Stuka dies to a grenade');
  applyExplosion(w, w.byId('stuka_b').x, w.byId('stuka_b').z, 'barrel', null);
  s.run(0.2);
  assert.ok(objDone(w, 'o3'), 'o3 (optional) done');
  assert.equal(w.objectives.find((o) => o.id === 'o3').required, false);
});

test('m10 hook: a pistol shot at the start raises nothing; boarding the vacant tank sounds the camp alarm and wakes the tanks', () => {
  const s = m10Sim(), w = s.world;
  w.emitNoise(11.5, 58, 30, 'shot', s.cmd('driver'));
  s.run(0.5);
  assert.deepEqual(events(w), [], 'the ruins are in no zone');
  // the lure (dossier §14.1 #3): a pistol shot from the Driver's start slot reaches e1 and Patrol 4 at the N end of
  // its beat (playtest: from the old slot (10,54) the 18 m shot reached nobody)
  const D = M().commandos.find((c) => c.role === 'driver'), R = CONFIG.weapons.pistol.noise;
  for (const [x, z, who] of [[24, 73, 'e1'], [5, 76, 'Patrol 4 N end']]) assert.ok(Math.hypot(D.x - x, D.z - z) < R - 1, `${who} hears the Driver's pistol`);
  const before = w.enemies.length;
  const dr = s.cmd('driver'), pz4 = w.byId('pz4');
  dr.setPosition?.(pz4.x - 4, pz4.z); dr.x = pz4.x - 4; dr.z = pz4.z;
  assert.ok(pz4.enter(dr), 'the Driver boards');
  s.run(0.5);
  assert.ok(events(w).includes('RINT'), 'camp alarm');
  assert.ok(!events(w).includes('RINT_AIR'), 'the airfield has not heard it');
  assert.ok(w.enemies.length >= before + 9, 'garrison A releases its 3 squads');
  assert.equal(w.byId('pz22').brain.route?.type, 'LOOP', 'pz22 patrols the E side');
  assert.ok(w.byId('pz24').path || w.byId('pz24').goal, 'pz24 sets off for the airfield road');
  assert.ok(w.byId('pz21').path || w.byId('pz21').goal, 'pz21 rolls out onto the apron');
  assert.ok(pz4.tainted, 'the stolen tank is fair game for every gun that sees it');
  assert.ok(!w.byId('pz23').path, 'pz23 stays in its shed');
});

test('m10 hook: the garrisons leave by separate doors and lines — no squad stacks on another (one grenade, one squad)', () => {
  for (const [ev, gar, T] of [['RINT_AIR', 'dugout', 10], ['RINT', 'barracks', 10]]) {
    const s = makeSim(M(), {}), w = s.world;
    w.alarm = new Alarm(w);
    const step = s.step;
    s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
    s.run(0.2);
    w.alarm.fireEvent(ev, { zoneId: null, cause: 'test', x: 73, z: 49 });
    s.run(T);
    const lead = [0, 1, 2].map((k) => w.enemies.find((e) => e.spawn?.id === `${gar}#${k}.0.0`));
    assert.ok(lead.every(Boolean), `${gar}: three squads out`);
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const d = Math.hypot(lead[a].x - lead[b].x, lead[a].z - lead[b].z);
      assert.ok(d > 6, `${gar}: squads ${a} and ${b} ${d.toFixed(1)} m apart at t+${T}`);
    }
  }
});

test('m10 hook: a blast carries 60 m to the guards (rules.explosionHearing) but still wakes the airfield zone', () => {
  const s = m10Sim(), w = s.world;
  const e12 = w.enemies.find((e) => e.spawn?.id === 'e12'), g3 = w.enemies.find((e) => e.spawn?.id === 'g3');
  const bang = (x, z) => ({ x, z, radius: CONFIG.stealth.noise.explosion.radius, kind: 'explosion', level: 3 });
  // playtest: grenades at the ramp head pulled the camp up the road; the store blast pulled the dugout down
  assert.equal(hears(e12, bang(73, 47)), false, 'the camp does not hear the ramp head');
  assert.equal(hears(g3, bang(73, 47)), true, 'the road MG does');
  assert.equal(hears(e12, bang(48, 177)), true, 'the camp hears the store');
  applyExplosion(w, 48, 177, 'grenade', s.cmd('sapper'));
  s.run(1);
  assert.ok(events(w).includes('RINT_AIR'), 'the airfield zone still hears it: the dugout turns out');
  assert.ok(!events(w).includes('RINT'), 'no camp alarm from a bang');
  const dug = w.enemies.filter((e) => /^dugout/.test(e.spawn?.id || '') && e.alive);
  assert.equal(dug.length, 9, 'nine men out');
  // playtest: released by the store blast, they heard it too and walked down the road to the compound
  assert.ok(dug.every((e) => !hears(e, bang(48, 177))), 'the fresh dugout squads do not hear the store: they patrol the shelf');
});

test('m10 hook: boarding the Ju 52 before the store is down — McRae objects once per party, not once per man', () => {
  const s = m10Sim(), w = s.world;
  const said = [];
  w.events.on('message', (m) => { if (/bomb store goes up/.test(m.text || '')) said.push(w.time); });
  const ju = w.byId('ju52');
  for (const role of ['sniper', 'driver', 'greenberet', 'sapper']) {
    const c = s.cmd(role); c.x = ju.x + 2; c.z = ju.z + 7;
    assert.ok(ju.enter(c), `${role} boards`);
    s.run(0.3);
  }
  assert.equal(said.length, 1, `one line, got ${said.length}`);
});

test('m10 hook: on the alarm pz24 drives out through the N gate and parks on the road below the ramp, out of grenade reach of it', () => {
  const s = m10Sim(), w = s.world;
  w.alarm.fireEvent('RINT', { zoneId: 'z_camp', cause: 'test', x: 100, z: 190 });
  const v = w.byId('pz24');
  const [ex, ez] = PZ24_ROUTE[PZ24_ROUTE.length - 1];
  let maxElev = 0;
  s.run(240, () => { maxElev = Math.max(maxElev, w.grid.elevAt(v.x, v.z)); return Math.hypot(v.x - ex, v.z - ez) < 1.5; });
  assert.ok(Math.hypot(v.x - ex, v.z - ez) < 1.5, `pz24 below the ramp: (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  assert.ok(maxElev <= 0.3, 'never on raised ground');
  assert.ok(!v.destroyed);
  // playtest: parked at the ramp foot it could not see a man standing on the ramp above y 2.5 (roof rule) 12.9 m
  // away, who grenaded it; every hidden ramp point must now be beyond throw + blast
  for (let t = 0; t <= 1; t += 0.02) {
    const x = 67.5 + (73 - 67.5) * t, z = 64 + (49 - 64) * t;
    if (w.grid.elevAt(x, z) < 2.5) continue;
    assert.ok(Math.hypot(v.x - x, v.z - z) > 18, `ramp point (${x.toFixed(1)},${z.toFixed(1)}) within 18 m`);
  }
});

test('m10 hook: free McRae → store → everyone aboard the Ju 52 → McRae takes off W and the mission is won', () => {
  const s = m10Sim(), w = s.world;
  const mc = w.commandos.find((c) => c.guestId === 'mcrae');
  assert.equal(mc.state, 'jailed');
  const door = w.interactables.find((i) => i.interactKind === 'jail');
  assert.equal(door.jailed().length, 1);
  door.interact(s.cmd('greenberet'));
  s.run(0.2);
  assert.notEqual(mc.state, 'jailed', 'McRae is out');
  assert.ok(objDone(w, 'o1'), 'o1 done');
  const gate = w.interactables.find((i) => i.interactKind === 'door' && i.tag === 'pen_gate');
  assert.ok(gate && gate.open && !gate.locked, 'the pen gate is open');
  assert.ok(findPath(w.grid, mc.x, mc.z, 43, 181, { maxNodes: 400000 }), 'McRae can walk to the store');
  // the store: grenades do nothing, the time bomb at its door does
  applyExplosion(w, 42, 180, 'grenade', s.cmd('sapper'));
  s.run(0.1); checkObjectives(w);
  assert.ok(!objDone(w, 'o2'), 'a grenade does not destroy the store');
  applyExplosion(w, 43, 179.5, 'bomb', s.cmd('sapper'));
  s.run(0.1); checkObjectives(w);
  assert.ok(objDone(w, 'o2'), 'o2 done by the time bomb');
  // everyone aboard: the plane goes only once all are in
  const flags = {};
  const ju = w.byId('ju52');
  const men = w.commandos.filter((c) => c.alive !== false);
  assert.equal(men.length, 5, 'four commandos and McRae');
  for (const c of men.slice(0, 4)) { c.x = ju.x + 2; c.z = ju.z + 7; assert.ok(ju.enter(c), `${c.role} boards`); }
  s.run(1, () => { updateExtractionVehicle(w, flags); return false; });
  assert.ok(Math.hypot(ju.x - 91, ju.z - 20) < 0.5, 'waits for McRae');
  mc.x = ju.x + 2; mc.z = ju.z + 7;
  assert.ok(ju.enter(mc), 'McRae takes the controls');
  s.run(30, () => { updateExtractionVehicle(w, flags); checkObjectives(w); return objDone(w, 'o4'); });
  assert.ok(objDone(w, 'o4'), `escaped (plane at ${ju.x.toFixed(1)},${ju.z.toFixed(1)})`);
  assert.ok(checkObjectives(w).won || w.objectives.filter((o) => o.required).every((o) => o.done), 'mission won');
  assert.ok(ju.y > 5, 'the Junkers climbs as it leaves');
});
