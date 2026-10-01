/**
 * BEL M14 "D-Day Kick Off" (docs/missions/m14.md): schema + §10.5 test #14, the §3.8 row 14 loadout, the census,
 * the island's levels (ridge GB-only, gun roofs, the g2 sand drift, the g3 ladder), the tank lane, the rowboat's
 * water routes, the z_wall zone, the gun hit rules (bombs; a carried barrel for g4), and the objective/trigger wiring
 * (team seated in the boat, T1 explosion alarm, T4 soft-lock, losing the boat, extraction at the red buoy).
 * Run with the unit suite: node tests/unit/run.mjs m14
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid, applyIntendedAbilities } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { T, B } from '../../src/world/grid.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';
import { createObjectives, checkObjectives } from '../../src/core/objectives.js';
import { GUNS, BARRELS, RIDGE_Y, ROOF_Y, meansLeft, gunsStanding } from '../../src/missions/scripts/m14.js';
import { canSeeVehicle } from '../../src/ai/vehicle-ai.js';

const M = () => getMission('m14');
const START = { x: 3.5, z: 183.5 };
const reach = (g, a, b, role, o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });

test('m14: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  assert.equal(m.campaign, 'BEL');
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(m.size, [134, 209]);
  assert.equal(m.par.time, 900);
  assert.equal(m.theater, 'coast');
  assert.equal(m.coneColors, 'green');
  assert.equal(m.alarmFail ?? null, null, 'no alarm-fail');
});

test('m14: §3.8 row 14 loadout exactly (Sniper 8 rounds, Sapper trap + 3 remote bombs, Driver medic without SMG, no shovel)', () => {
  const L = belLoadout(14);
  assert.deepEqual(M().commandos.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of M().commandos) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  const inv = (r) => spawnInventory(r, M().commandos.find((c) => c.role === r).inventory);
  assert.equal(inv('sniper').sniperRifle, 8);
  assert.equal(inv('sapper').remoteBomb, 3);
  assert.ok(inv('sapper').bearTrap >= 1, 'the trap');
  assert.equal(inv('sapper').timeBomb, undefined);
  assert.equal(inv('sapper').grenade, undefined);
  assert.equal(inv('greenberet').shovel, undefined, 'no shovel (§3.8 row 12)');
  assert.equal(inv('driver').smg, undefined);
  assert.equal(inv('driver').firstAid, 6);
  // on site: 3 barrels, the tank, the rowboat, 5 MG nests
  const m = M();
  assert.equal(m.structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel').length, 3);
  assert.deepEqual(m.vehicles.map((v) => v.vehicleType).sort(), ['mgNest', 'mgNest', 'mgNest', 'mgNest', 'mgNest', 'panzer2', 'rowboat']);
  const pz = m.vehicles.find((v) => v.id === 'pz2');
  assert.ok(pz.driveable && !(pz.crew || []).length && !m.enemies.some((e) => e.vehicle === 'pz2'), 'the Panzer II is empty');
  assert.equal(m.vehicles.find((v) => v.id === 'boat').seats, 5);
});

test('m14: §10.5 #14 — loads; the team reaches all four guns and the boat; no start in a cone; every route walkable', () => {
  // the only land-path problem is the rowboat's own route to the buoy, which is over water (checked below)
  const probs = checkMission(M()).filter((p) => p !== 'escape vehicle boat cannot reach its exit');
  assert.deepEqual(probs, []);
});

test('m14: census matches Kildread (24 walkers, 18 posts, five 3-man patrols, 5 Gatling gunners, 2 garrisons of 10)', () => {
  const m = M();
  const squads = {};
  for (const e of m.enemies) if (e.squad) (squads[e.squad.id] ||= []).push(e.id);
  assert.deepEqual(Object.keys(squads).sort(), ['p1', 'p12', 'p3', 'p37', 'p43']);
  assert.ok(Object.values(squads).every((s) => s.length === 3));
  const solo = m.enemies.filter((e) => !e.squad && ['soldier', 'sentry'].includes(e.soldierType));
  assert.equal(solo.filter((e) => e.route).length, 24, 'walkers');
  assert.equal(solo.filter((e) => !e.route).length, 18, 'posts');
  const mgs = m.enemies.filter((e) => e.soldierType === 'mg');
  assert.equal(mgs.length, 5);
  for (const e of mgs) assert.ok(m.vehicles.some((v) => v.id === e.emplacement && v.gunner === e.id), `${e.id} mans his nest`);
  assert.equal(m.enemies.length, 62);
  assert.deepEqual(Object.keys(m.barracks).sort(), ['bar_n', 'bar_s']);
  for (const b of Object.values(m.barracks)) assert.equal(b.pool, 10);
  // Prima's numbers 1–46 all present (patrols share theirs)
  const nums = new Set(m.enemies.map((e) => e.prima).filter(Boolean));
  for (let k = 1; k <= 46; k++) assert.ok(nums.has(k), `Prima ${k}`);
});

test('m14: levels — the ridge is GB-only (5 climb spots), g1 and bar_n roofs GB-only, g2 roof by the sand drift, g3 by the ladder', () => {
  const ctx = loadGrid(M());
  applyIntendedAbilities(ctx);
  const g = ctx.grid;
  const elevAt = (x, z) => g.elev[g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell))];
  const crest = [{ x: 14, z: 102 }, { x: 52, z: 93.5 }, { x: 72, z: 85 }];
  for (const p of crest) assert.ok(Math.abs(elevAt(p.x, p.z) - RIDGE_Y) < 0.01 && g.walkableAt(p.x, p.z), `crest (${p.x},${p.z})`);
  const roofs = { g1: M().enemies.find((e) => e.id === 'e8'), g2: M().enemies.find((e) => e.id === 'e25'), g3: { x: 90, z: 58 }, bar_n: { x: 57.5, z: 68.5 } };
  for (const [id, p] of Object.entries(roofs)) assert.ok(elevAt(p.x, p.z) > 3 && g.walkableAt(p.x, p.z), `${id} roof walkable`);
  for (const p of crest) {
    assert.ok(reach(g, START, p, 'greenberet'), `GB climbs to the crest (${p.x},${p.z})`);
    for (const r of ['sapper', 'sniper', 'driver']) assert.ok(!reach(g, START, p, r), `${r} cannot reach the crest`);
  }
  assert.ok(reach(g, START, roofs.g1, 'greenberet') && !reach(g, START, roofs.g1, 'sapper'), 'g1 roof: GB only');
  assert.ok(reach(g, START, roofs.bar_n, 'greenberet') && !reach(g, START, roofs.bar_n, 'sniper'), 'bar_n roof: GB only');
  for (const r of ['sapper', 'sniper', 'greenberet']) {
    assert.ok(reach(g, START, roofs.g2, r), `${r} walks up the sand drift onto g2`);
    assert.ok(reach(g, START, roofs.g3, r), `${r} climbs the g3 ladder`);
  }
  // the S and N halves meet on foot only through the E passes: blocking the passes cuts them apart
  for (let z = 70; z <= 100; z += 0.5) for (let x = 74; x <= 100; x += 0.5) {
    const k = g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));
    if (g.elev[k] < 0.3 && z > 76 && z < 92) g.block[k] = B.HIGH;
  }
  assert.ok(!reach(g, START, { x: 30, z: 70 }, 'sapper'), 'without the E passes the N half is cut off (sapper)');
});

/** Water cells a rowboat can use (water/shallow, no block), eroded by one cell; BFS from the boat. */
function boatReach(g, from) {
  const { cols, rows } = g, ok = new Uint8Array(cols * rows), ok2 = new Uint8Array(cols * rows), seen = new Uint8Array(cols * rows);
  for (let k = 0; k < ok.length; k++) ok[k] = (g.terrain[k] === T.WATER || g.terrain[k] === T.SHALLOW) && g.block[k] !== B.HIGH && !g.bridge[k] ? 1 : 0;
  for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
    let a = 1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) a &= ok[(j + dj) * cols + i + di];
    ok2[j * cols + i] = a;
  }
  const s = g.idx(Math.floor(from.x / g.cell), Math.floor(from.z / g.cell)), q = [s];
  seen[s] = 1;
  while (q.length) {
    const k = q.pop(), i = k % cols, j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj, kk = jj * cols + ii;
      if (ii >= 0 && jj >= 0 && ii < cols && jj < rows && !seen[kk] && ok2[kk]) { seen[kk] = 1; q.push(kk); }
    }
  }
  return (x, z, r = 3) => {
    for (let j = Math.floor((z - r) / g.cell); j <= (z + r) / g.cell; j++) for (let i = Math.floor((x - r) / g.cell); i <= (x + r) / g.cell; i++) {
      if (i >= 0 && j >= 0 && i < cols && j < rows && seen[j * cols + i] && Math.hypot((i + 0.5) * g.cell - x, (j + 0.5) * g.cell - z) <= r) return true;
    }
    return false;
  };
}

test('m14: the rowboat reaches the SW beach, the red buoy, and rounds the island to the E, NE and N beaches', () => {
  const { grid: g } = loadGrid(M());
  const boat = M().vehicles.find((v) => v.id === 'boat');
  const near = boatReach(g, boat);
  assert.ok(near(boat.x, boat.z, 1), 'the boat floats free');
  const ex = M().extraction.exit;
  assert.ok(near(ex.x, ex.z, ex.r), 'the red buoy');
  for (const [n, x, z] of [['SW beach W end', 2, 190], ['S beach', 65, 160], ['E beach', 106, 108], ['NE beach', 118, 60], ['N beach W end', 10, 26], ['off mg5', 60, 12]]) {
    assert.ok(near(x, z, 4), `${n}`);
  }
  // the boat unloads at the SW beach's W end: the shallow rim touches walkable sand there
  assert.ok(g.walkableAt(START.x, START.z) && g.terrain[g.idx(Math.floor(START.x / g.cell), Math.floor(START.z / g.cell))] === T.SAND);
});

/** Cells a 3 m-wide hull can use: walkable ground (elev ≤ 0.3, no block, not water), eroded by 3 cells. */
function tankReach(g, from) {
  const { cols, rows } = g, ok = new Uint8Array(cols * rows), ok2 = new Uint8Array(cols * rows), seen = new Uint8Array(cols * rows);
  for (let k = 0; k < ok.length; k++) ok[k] = g.block[k] === B.NONE && g.terrain[k] !== T.WATER && g.elev[k] <= 0.3 ? 1 : 0;
  const R = 3;
  for (let j = R; j < rows - R; j++) for (let i = R; i < cols - R; i++) {
    let a = 1;
    for (let dj = -R; dj <= R && a; dj++) for (let di = -R; di <= R && a; di++) a &= ok[(j + dj) * cols + i + di];
    ok2[j * cols + i] = a;
  }
  const s = g.idx(Math.floor(from.x / g.cell), Math.floor(from.z / g.cell)), q = [s];
  seen[s] = 1;
  while (q.length) {
    const k = q.pop(), i = k % cols, j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj, kk = jj * cols + ii;
      if (ii >= 0 && jj >= 0 && ii < cols && jj < rows && !seen[kk] && ok2[kk]) { seen[kk] = 1; q.push(kk); }
    }
  }
  return (x, z, r = 3) => {
    for (let j = Math.floor((z - r) / g.cell); j <= (z + r) / g.cell; j++) for (let i = Math.floor((x - r) / g.cell); i <= (x + r) / g.cell; i++) {
      if (i >= 0 && j >= 0 && i < cols && j < rows && seen[j * cols + i]) return true;
    }
    return false;
  };
}

test('m14: the Panzer II can drive from the tank yard to gun 4, through the W pass to gun 1 and out through gap_n to the SW pocket', () => {
  const { grid: g } = loadGrid(M());
  const pz = M().vehicles.find((v) => v.id === 'pz2');
  const near = tankReach(g, pz);
  assert.ok(near(pz.x, pz.z, 1), 'the tank has room where it stands');
  for (const [n, x, z] of [['gun 4', 42, 58], ['bar_n door', 48, 68.5], ['gun 3 front', 88, 67], ['W pass', 78.5, 90], ['gun 2 rear', 76, 100],
    ['gun 1 camp', 46, 118], ['gap_n', 23, 114], ['SW pocket', 12, 140]]) assert.ok(near(x, z, 3), n);
});

test('m14: z_wall — the starts, every beach and the SW pocket are outside; the guns, barracks, tank yard and E ridge inside', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const c of M().commandos) assert.equal(a.zoneAt(c.x, c.z), null, `${c.role} start`);
  const outside = [[20, 165], [12, 140], [5, 120], [14, 102], [65, 150], [88, 136], [104, 104], [109, 70], [107, 57.5], [98, 44], [40, 37], [60, 26]];
  for (const [x, z] of outside) assert.equal(a.zoneAt(x, z), null, `(${x},${z}) outside`);
  const inside = [[54, 125.5], [90, 99.5], [90.5, 60], [42, 48], [55.5, 104], [57.5, 68.5], [10, 78], [52, 93.5], [33.5, 127.5], [15, 75.5]];
  for (const [x, z] of inside) assert.equal(a.zoneAt(x, z)?.id, 'z_wall', `(${x},${z}) inside`);
  const z = M().zones[0];
  assert.deepEqual([z.onSeen, z.onHeard, z.siren], ['RINT', null, true]);
  // the Marine's water kills (P18, P27, P34, P35) and the beach patrols all stand outside
  for (const id of ['mg1g', 'e27', 'e34', 'e35', 'e36', 'p1a', 'p3a', 'p12a', 'p37a', 'p43a', 'e13', 'e14', 'mg5g']) {
    const e = M().enemies.find((q) => q.id === id);
    assert.equal(a.zoneAt(e.x, e.z), null, `${id} outside`);
  }
});

/** Full M14 sim with the alarm, stepped like Game.step; messages and zone alarms recorded. */
function m14Sim(brains = false) {
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
  s.run(0.1); // first BEL tick: the trigger director installs, the `start` trigger seats the team
  return s;
}
const targetOf = (w, id) => w.interactables.find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));
/** A remote bomb planted at (x, z) and fired at once (bomb:exploded + class `bomb`). */
async function blast(s, x, z) {
  const { Bomb } = await import('../../src/abilities/charges.js');
  s.world.add(new Bomb({ x, z, bombKind: 'time', fuse: 0.1, owner: s.cmd('sapper') }));
  s.run(0.5);
}

test('m14 hook: the whole team starts seated in the rowboat, the Marine at the oars', () => {
  const s = m14Sim(), v = s.get('boat');
  assert.equal(v.occupants.length, 5, 'five aboard');
  assert.equal(v.driver?.role, 'diver', 'the Marine rows');
  for (const c of s.world.commandos) assert.equal(c.vehicle, v, `${c.role} aboard`);
  assert.ok(!v.tainted, 'nobody saw them board');
});

test('m14 hook: a bomb at each casemate/turret and a barrel carried to the pit destroy the guns; o1 completes', async () => {
  const s = m14Sim(), w = s.world;
  for (const id of GUNS) assert.ok(targetOf(w, id), `${id} is an explosive target`);
  for (const id of ['g1', 'g2', 'g3']) {
    const t = targetOf(w, id);
    await blast(s, t.x + 0.5, t.z + 0.5);
    assert.ok(t.destroyed, `${id} destroyed by a charge at its target point`);
  }
  // a shell (tank cannon) never harms a bunker gun; a barrel 5 m from the pit does
  const t4 = targetOf(w, 'g4');
  applyExplosion(w, t4.x, t4.z - 5, 'shell'); // the tank's cannon at the pit's edge
  s.run(0.3);
  assert.ok(!t4.destroyed);
  applyExplosion(w, t4.x + 5, t4.z + 1, 'barrel');
  s.run(0.8);
  assert.ok(t4.destroyed, 'a barrel against the pit destroys g4');
  checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done);
  s.run(0.3);
  assert.ok(s.msgs.some((m) => /All four guns/.test(m)), 'T3 message');
  assert.equal(w.scriptFail ?? null, null);
});

test('m14 hook: the barrel stack blowing up where it stands (14 m off) does not reach gun 4', () => {
  const s = m14Sim(), w = s.world;
  applyExplosion(w, 55.5, 54, 'barrel');
  s.run(0.8);
  assert.ok(BARRELS.every((id) => { const b = s.get(id); return !b || b.exploded || b.destroyed || b.removed; }), 'the chain takes all three');
  assert.ok(!targetOf(w, 'g4').destroyed, 'g4 still standing');
});

test('m14 hook: T1 — a blast inside the fortified line raises RINT and the siren; one out on the beach does not', () => {
  const s = m14Sim(), w = s.world;
  applyExplosion(w, 20, 165, 'barrel'); // SW beach
  s.run(0.5);
  assert.ok(!s.alarms.some((a) => a.event === 'RINT') && !w.alarm.active, 'beach blast: no alarm');
  applyExplosion(w, 60, 88, 'grenade'); // behind the ridge E end, inside z_wall
  s.run(0.5);
  assert.ok(s.alarms.some((a) => a.zone === 'z_wall' && a.event === 'RINT'), 'z_wall raised');
  assert.ok(w.alarm.active, 'siren');
});

test('m14 hook: T4 soft-lock — fewer charges than standing guns fails; the full kit never does', () => {
  const s = m14Sim(), w = s.world;
  assert.equal(gunsStanding(w), 4);
  assert.equal(meansLeft(w), 6, '3 remote bombs + 3 barrels');
  s.run(2);
  assert.equal(w.scriptFail ?? null, null);
  for (const id of BARRELS) applyExplosion(w, s.get(id).x, s.get(id).z, 'barrel');
  s.run(1);
  assert.equal(meansLeft(w), 3);
  assert.match(String(w.scriptFail), /EXPLOSIVES/, 'three bombs for four guns: dead end');
});

test('m14: no enemy cone covers the boat where it starts, nor the SW landing spot', () => {
  const boat = M().vehicles.find((v) => v.id === 'boat');
  for (const [x, z] of [[boat.x, boat.z], [2, 187]]) {
    const def = { ...M(), commandos: M().commandos.map((c) => ({ ...c, x, z })) };
    const probs = checkMission(def).filter((p) => /cone/.test(p));
    assert.deepEqual(probs, [], `(${x},${z})`);
  }
});

test('m14 hook: losing the rowboat fails the mission', () => {
  const s = m14Sim(), w = s.world;
  s.get('boat').destroy?.(null, 'shell');
  s.run(0.3);
  assert.match(String(w.scriptFail), /BOAT/);
});

test('m14 (review): the boat-loss text blames the player only when the player sank it (playtest r_a3e: an MG did)', () => {
  const s = m14Sim();
  const mg = s.world.enemies.find((e) => e.id === 'mg5g') || s.world.enemies[0];
  s.get('boat').destroy(mg, 'shell');
  s.run(0.3);
  assert.match(String(s.world.scriptFail), /THE BOAT WAS LOST/);
  assert.doesNotMatch(String(s.world.scriptFail), /YOU DESTROYED/);
  const s2 = m14Sim();
  s2.get('boat').destroy(s2.world.commandos[0], 'explosion');
  s2.run(0.3);
  assert.match(String(s2.world.scriptFail), /YOU DESTROYED THE BOAT/);
});

test('m14 hook: extraction — everyone aboard the rowboat at the red buoy wins only once all four guns are down', () => {
  const s = m14Sim(), w = s.world, v = s.get('boat');
  assert.equal(v.occupants.length, 5);
  const ex = M().extraction.exit;
  v.x = ex.x; v.z = ex.z;
  checkObjectives(w);
  assert.ok(!w.objectives.find((o) => o.id === 'o2').done, 'not with the guns standing');
  for (const id of GUNS) targetOf(w, id).destroy?.(null, 'bomb');
  checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done, 'o1 done');
  const r = checkObjectives(w);
  assert.ok(w.objectives.find((o) => o.id === 'o2').done, 'o2 done');
  assert.ok(r.won, 'mission won');
});

test('m14: the three barrels stand 14 m from gun 4 and can be carried; gun 4 is not bomb-only', () => {
  const m = M();
  const g4 = m.structures.find((s) => s.id === 'g4');
  for (const id of BARRELS) {
    const b = m.structures.find((s) => s.id === id);
    assert.ok(b.carriable && b.explosive === 'barrel');
    const d = Math.hypot(b.x - g4.x, b.z - g4.z);
    assert.ok(d > 13.5 && d < 16, `${id} at ${d.toFixed(1)} m`);
  }
  for (const id of GUNS) {
    const g = m.structures.find((s) => s.id === id);
    assert.equal(g.bombOnly, false, `${id} bombOnly false`);
    assert.ok(g.bunker && g.roofWalk, `${id} bunker + walkable roof`);
  }
  assert.equal(ROOF_Y, 3.5);
});

/** A water point in front of enemy `id` that he sees the boat at (scan of his cone), or null. */
function waterInView(s, id) {
  const w = s.world, g = w.grid, e = s.get(id), v = s.get('boat');
  for (let r = 6; r <= 16; r += 1) for (let a = -20; a <= 20; a += 5) {
    const h = e.heading + (a * Math.PI) / 180, x = e.x + Math.cos(h) * r, z = e.z + Math.sin(h) * r;
    const k = g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell));
    if (g.terrain[k] !== T.WATER && g.terrain[k] !== T.SHALLOW) continue;
    v.x = x; v.z = z;
    if (canSeeVehicle(e, v, w)) return { x, z, h };
  }
  return null;
}

test('m14 (review): the rowboat under way in an enemy cone is spotted and tainted; lying still it is not', () => {
  const s = m14Sim(true), w = s.world, v = s.get('boat');
  assert.equal(v.spawn.suspicious, undefined, 'no dead `suspicious` field on the boat');
  const spotted = [];
  w.events.on('enemy:spotted', (p) => spotted.push(p));
  const id = ['e36', 'e27', 'e34', 'mg1g', 'mg5g'].find((q) => waterInView(s, q));
  assert.ok(id, 'a beach guard overlooks the water');
  const e = s.get(id), p = waterInView(s, id);
  v.heading = p.h + Math.PI / 2;
  s.run(0.2);
  assert.ok(!v.tainted && !spotted.length, 'a boat lying still is not spotted');
  assert.ok(v.driveTo(p.x + Math.cos(v.heading) * 3, p.z + Math.sin(v.heading) * 3) || v.followPath([{ x: p.x + 0.5, z: p.z }]), 'rowing');
  s.run(0.3);
  assert.ok(v.tainted, 'the gunner saw the boat rowed past');
  assert.ok(spotted.some((q) => q.enemy === e && q.target === s.cmd('diver')), 'enemy:spotted names the rower');
  assert.equal(e.brain.state, 'COMBAT');
  assert.equal(e.brain.target, v, 'he fights the boat');
});

test('m14 (review): the W pass between the ridge tip and the E boulders takes the Panzer II (E pass blocked)', () => {
  const { grid: g } = loadGrid(M());
  const pz = M().vehicles.find((v) => v.id === 'pz2');
  // width of the W pass: open low ground between the ridge tip and the boulders along z 80–85
  const cellOpen = (x, z) => { const k = g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell)); return g.block[k] === B.NONE && g.elev[k] <= 0.3; };
  for (let z = 80.25; z <= 85; z += 0.5) {
    let run = 0, best = 0;
    for (let x = 70.25; x <= 86; x += 0.5) { run = cellOpen(x, z) ? run + 0.5 : 0; best = Math.max(best, run); }
    assert.ok(best >= 4, `W pass ≥ 4 m wide at z ${z} (${best} m)`);
  }
  // shut the E pass: the tank still reaches the S half through the W pass
  for (let z = 74; z <= 92; z += 0.5) for (let x = 86.5; x <= 100; x += 0.5) g.block[g.idx(Math.floor(x / g.cell), Math.floor(z / g.cell))] = B.HIGH;
  const near = tankReach(g, pz);
  for (const [n, x, z] of [['W pass S mouth', 78.5, 90], ['gun 2 rear', 76, 100], ['gun 1 camp', 46, 118]]) assert.ok(near(x, z, 3), n);
});

test('m14 (review): D3 — the Panzer II has its machine guns only (no cannon, no map-wide shell lure)', () => {
  const s = m14Sim(), pz = s.get('pz2');
  assert.deepEqual(pz.def.weapons, ['tankMg']);
  assert.ok(!pz.def.weapons.includes('cannon'));
});

test('m14 (review): a crawling commando told to board the beached rowboat stands up and gets in', () => {
  const s = m14Sim(), w = s.world, v = s.get('boat'), d = s.cmd('driver');
  // the boat run up on the SW beach's W end, the Driver 6 m inland lying flat (the landing in the scripted solution)
  v.x = 5.8; v.z = 189.9;
  s.run(0.1);
  assert.ok(v.exit(d), 'the Driver steps out');
  d.setPosition(7, 183.5, 0);
  d.setStance('crawl');
  s.run(1);
  assert.equal(d.stance, 'crawl');
  const msgs = [];
  w.events.on('message', (p) => msgs.push(p.text));
  assert.ok(d.useAbility('enterVehicle', v), 'order accepted');
  for (let i = 0; i < 300 && d.vehicle !== v; i++) s.run(0.1);
  assert.equal(d.vehicle, v, `boarded (at ${d.x.toFixed(1)},${d.z.toFixed(1)} ${d.stance}; ${msgs.join(' | ')})`);
});

test('m14 (review): one message per gun destroyed — the mission T2 line, no generic "Coastal gun destroyed."', async () => {
  const s = m14Sim(), w = s.world;
  for (const id of ['g1', 'g2', 'g3']) {
    const t = targetOf(w, id);
    await blast(s, t.x + 0.5, t.z + 0.5);
    assert.ok(t.destroyed, id);
  }
  s.run(0.3);
  assert.equal(s.msgs.filter((m) => /out of action/.test(m)).length, 3, s.msgs.join(' | '));
  assert.ok(!s.msgs.some((m) => /destroyed\./.test(m)), s.msgs.join(' | '));
});

test('m14 (review): a remote bomb planted on the g3 roof sits on the roof (y = the Sapper\'s elevation)', () => {
  const s = m14Sim(), w = s.world, v = s.get('boat'), sp = s.cmd('sapper');
  v.x = 5.8; v.z = 189.9; // run up on the SW beach
  s.run(0.1);
  assert.ok(v.exit(sp), 'the Sapper steps out');
  sp.setPosition(89.5, 60, 0);
  sp.y = ROOF_Y;
  s.run(0.1);
  assert.ok(Math.abs(sp.y - ROOF_Y) < 0.2, `the Sapper stands on the roof (y ${sp.y})`);
  assert.ok(sp.useAbility('remoteBomb', null), `plants (${sp.lastRefusal?.text} state ${sp.state} veh ${!!sp.vehicle})`);
  s.run(3);
  const bomb = w.interactables.find((i) => i.interactKind === 'bomb');
  assert.ok(bomb, 'bomb placed');
  assert.ok(Math.abs(bomb.y - ROOF_Y) < 0.2, `bomb y ${bomb.y}`);
  assert.ok(Math.abs(bomb.object3d.position.y - ROOF_Y) < 0.2, 'mesh on the roof');
});

test('m14 (review): g1–g3 need the bomb within 3 m of the target point (§3.3), not anywhere on the block', async () => {
  const s = m14Sim(), w = s.world;
  for (const id of ['g1', 'g2', 'g3']) {
    const t = targetOf(w, id);
    await blast(s, t.x + 4, t.z); // 4 m off: on the roof, but not at the embrasure / turret
    assert.ok(!t.destroyed, `${id} survives a bomb 4 m off its target point`);
    await blast(s, t.x + 2.5, t.z);
    assert.ok(t.destroyed, `${id} goes up with a bomb 2.5 m off`);
  }
});
