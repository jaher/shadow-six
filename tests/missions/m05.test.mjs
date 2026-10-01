/**
 * BEL Mission 5 "Blind Justice" (docs/missions/m05.md): loads, design-spec §10.5 test #14 (reachability with the
 * intended abilities: cable car for both, the GB's east-face climb; no start in a cone; every route walkable),
 * the summit plateau, the mines, the phones, the cable car on demand, the barrel blasts and the escape wiring.
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { makeSim } from '../unit/abilsim.mjs';
import { getMission, MISSIONS } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { LINK } from '../../src/world/grid.js';
import { explode } from '../../src/entities/projectile.js';
import { checkObjectives } from '../../src/core/objectives.js';
import { distToPolyline } from '../../src/missions/setpieces-transport.js';
import { leaveVehicle } from '../../src/abilities/drive.js';
import '../../src/abilities/index.js';

const def = () => getMission('m05');
const SUMMIT_TARGETS = ['radar', 'g3_barracks', 'extraction:autogyro'];

test('m05: registered in BEL after m03, validates without errors or warnings', () => {
  const m = def();
  assert.ok(m, 'm05 registered');
  assert.equal(m.campaign, 'BEL');
  assert.ok(MISSIONS.indexOf(m) > MISSIONS.findIndex((x) => x.id === 'm03'));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test('m05: loadout and team exactly as §3.8 row 5', () => {
  const m = def();
  const by = Object.fromEntries(m.commandos.map((c) => [c.role, c.inventory]));
  assert.deepEqual(Object.keys(by).sort(), ['greenberet', 'spy']);
  assert.deepEqual(by.greenberet, { knife: 1, pistol: 1, decoy: 1, shovel: 1 });
  assert.deepEqual(by.spy, { pistol: 1, lethalInjection: 1, firstAid: 6 });
  assert.deepEqual(m.startDisguised, []);
});

test('m05 #14: routes walkable, no start in a cone, ground targets reachable', () => {
  const skipReach = [];
  for (const role of ['greenberet', 'spy']) for (const target of SUMMIT_TARGETS) skipReach.push({ role, target });
  const probs = checkMission(def(), { skipReach })
    // summit targets have no GROUND approach by design (goalsFor filters raised cells): checked below
    .filter((p) => !SUMMIT_TARGETS.some((t) => p === `objective target ${t} has no walkable approach`));
  assert.deepEqual(probs, []);
});

/** Walkable plateau cells (y 16) around a summit point. */
function summitGoals(grid, x, z, R) {
  const out = [];
  for (let dz = -R; dz <= R; dz += 0.5) for (let dx = -R; dx <= R; dx += 0.5) {
    const i = Math.floor((x + dx) / grid.cell), j = Math.floor((z + dz) / grid.cell);
    if (grid.inBounds(i, j) && grid.isWalkable(i, j) && Math.abs(grid.elev[grid.idx(i, j)] - 16) < 0.3) out.push({ x: (i + 0.5) * grid.cell, z: (j + 0.5) * grid.cell, d: Math.hypot(dx, dz) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 4);
}
const reach = (grid, c, goals, role) => goals.some((g) => findPath(grid, c.x, c.z, g.x, g.z, { role, maxNodes: 600000 }));

test('m05 #14: summit reachable by cable car (both) and by the east climb (GB only)', () => {
  const m = def();
  const ctx = loadGrid(m);
  const { grid } = ctx;
  const targets = { radar: [94, 31, 4], g3_barracks: [100.5, 51, 8], autogyro: [79, 25, 4], b2: [84, 55, 2] };
  const goals = Object.fromEntries(Object.entries(targets).map(([k, [x, z, R]]) => [k, summitGoals(grid, x, z, R)]));
  for (const [k, g] of Object.entries(goals)) assert.ok(g.length, `${k} has walkable plateau cells`);
  const gb = m.commandos.find((c) => c.role === 'greenberet'), spy = m.commandos.find((c) => c.role === 'spy');
  // Route B: the east face, GB only (no cable car link yet)
  for (const k of Object.keys(goals)) {
    assert.ok(reach(grid, gb, goals[k], 'greenberet'), `GB climbs to ${k}`);
    assert.ok(!reach(grid, spy, goals[k], 'spy'), `Spy cannot reach ${k} without the cable car`);
  }
  // Route A: the cable car (exits of both stations), modelled as a link for everyone
  const st = m.setpieces.find((s) => s.type === 'cable_car').stations;
  grid.addLink(LINK.LADDER, { x: st[0].exit[0], z: st[0].exit[1], y: 0 }, { x: st[1].exit[0], z: st[1].exit[1], y: 16 }, { roles: null });
  for (const k of Object.keys(goals)) assert.ok(reach(grid, spy, goals[k], 'spy'), `Spy rides up to ${k}`);
  // both station exits stand on walkable cells at their heights
  for (const [x, z, y] of [[...st[0].exit, 0], [...st[1].exit, 16]]) {
    const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
    assert.ok(grid.isWalkable(i, j) && Math.abs(grid.elev[grid.idx(i, j)] - y) < 0.3, `station exit (${x},${z}) walkable at y ${y}`);
  }
});

test('m05: plateau raised, summit buildings still block, massif blocks sight from the field', () => {
  const { grid } = loadGrid(def());
  const at = (x, z) => grid.idx(Math.floor(x / grid.cell), Math.floor(z / grid.cell));
  assert.equal(grid.elev[at(84, 20)], 16);
  assert.ok(grid.block[at(100.5, 51)] > 0, 'g3_barracks blocks');
  assert.ok(grid.block[at(72, 44)] > 0, 'top_station blocks');
  assert.ok(grid.block[at(94, 31)] > 0, 'radar pedestal blocks');
  assert.ok(grid.block[at(75, 68)] > 0, 'massif blocks');
  assert.ok(!grid.lineOfSight(50, 75, 84, 40, { viewerY: 0, targetY: 17.7 }), 'no sight from the lower field onto the summit');
});

// ------------------------------------------------------------------ set-pieces (headless sim, inert brains)
const sim = () => makeSim(def(), { brains: false });

test('m05: every mine lies ≥ 3 m off the patrol tracks, the garrison routes and the climb approach', () => {
  const m = def();
  const lines = [];
  for (const e of m.enemies) if (e.route) lines.push([[e.x, e.z], ...e.route.points.map((p) => [p.x, p.z])]);
  for (const b of Object.values(m.barracks)) for (const s of b.squads) lines.push([...s.exitRoute, ...s.loop].map((p) => [p.x, p.z]));
  lines.push([[98, 94], [100, 90.5]]);
  const mines = m.setpieces.find((s) => s.type === 'minefield').mines;
  assert.equal(mines.length, 14);
  assert.ok(mines.some(([x, z]) => x === 86 && z === 109), "Prima's mine inside the wide turn");
  for (const [x, z] of mines) for (const l of lines) assert.ok(distToPolyline(l, x, z) >= 3, `mine (${x},${z}) is ${distToPolyline(l, x, z).toFixed(2)} m from a route`);
});

test('m05: a mine kills a commando who steps on it; guards never set them off', () => {
  const s = sim();
  const gb = s.cmd('greenberet');
  const guard = s.get('p19a');
  guard.x = 58; guard.z = 110; // the garrison knows where they are
  s.run(0.3);
  assert.ok(guard.alive, 'guard unharmed');
  gb.x = 58; gb.z = 110.2; gb.y = 0;
  s.run(0.3);
  assert.equal(gb.alive, false, 'GB killed by the mine');
  assert.ok(s.count('explosion') >= 1);
});

test('m05: the south phone rings the north one (e8 hears it, the patrols do not); a second use hangs up', () => {
  const s = sim();
  s.run(0.1); // lazy set-piece init + mission script
  const gb = s.cmd('greenberet');
  gb.x = 36.5; gb.z = 113.6;
  const phone = s.get('phone_s');
  assert.ok(phone && phone.interact(gb), 'phone_s used');
  s.run(3);
  const rings = s.events.filter((e) => e.name === 'noise' && e.p.kind === 'phone');
  assert.ok(rings.length >= 1, 'the north phone pulses phone noise');
  const n = rings[0].p;
  assert.ok(Math.hypot(n.x - 50.5, n.z - 51.8) < 0.1, 'at the north phone');
  const hears = (x, z) => Math.hypot(x - n.x, z - n.z) <= n.radius;
  const m = def();
  assert.ok(hears(48, 46.5), 'e8 is within earshot');
  // nobody else stands or walks within earshot (the pm patrol's route stays > radius away)
  for (const e of m.enemies) {
    if (e.id === 'e8') continue;
    const pts = [[e.x, e.z], ...(e.route?.points || []).map((p) => [p.x, p.z])];
    assert.ok(distToPolyline(pts, n.x, n.z) > n.radius || (e.y || 0) > 1, `${e.id} stays out of earshot`);
  }
  const dir = s.world.setpieces;
  assert.ok(dir.get('phones').ringing.phone_n > 0, 'still ringing after 3 s');
  phone.interact(gb); // hang up
  s.run(0.2);
  assert.ok(!(dir.get('phones').ringing.phone_n > 0), 'hung up');
});

test('m05: the cable car moves only with a man aboard and stays at the far station', () => {
  const s = sim();
  const cab = s.get('cablecar'), spy = s.cmd('spy');
  s.run(5);
  assert.ok(cab.railS < 0.01, 'parked at the lower berth while empty');
  spy.x = 40; spy.z = 93;
  assert.ok(cab.enter(spy), 'Spy boards');
  s.run(30);
  assert.ok(cab.railS > cab.trackLen - 0.01, 'the cabin reached the top');
  assert.equal(spy.state, 'inVehicle', 'keepAboard: the Spy stays in the parked cabin');
  s.run(20);
  assert.ok(cab.railS > cab.trackLen - 0.01, 'the cabin waits at the top with its rider');
  assert.ok(leaveVehicle(spy), 'Spy gets out');
  assert.ok(Math.hypot(spy.x - 64.5, spy.z - 51.5) < 2.5 && Math.abs(spy.y - 16) < 0.6, `Spy on the top deck (${spy.x.toFixed(1)},${spy.z.toFixed(1)},${spy.y})`);
  s.run(5);
  assert.ok(cab.railS > cab.trackLen - 0.01, 'empty: it stays');
  assert.ok(cab.enter(spy), 'Spy boards again');
  s.run(30);
  assert.ok(cab.railS < 0.01 && spy.state === 'inVehicle', 'rides down and stays aboard');
  assert.ok(leaveVehicle(spy), 'gets out at the bottom');
  assert.ok(Math.hypot(spy.x - 39.5, spy.z - 95) < 2.5 && (spy.y || 0) < 0.6, 'on the lower deck');
});

test('m05 fix: Prima 5A round trip - the Spy rides down, stays inside, the GB boards and both ride up', () => {
  const s = sim();
  const cab = s.get('cablecar'), spy = s.cmd('spy'), gb = s.cmd('greenberet');
  s.run(0.5);
  // the car and the Spy start at the top
  spy.x = 40; spy.z = 93; cab.enter(spy); s.run(30); leaveVehicle(spy);
  assert.ok(cab.railS > cab.trackLen - 0.01);
  assert.ok(cab.enter(spy), 'Spy boards at the top');
  s.run(30);
  assert.ok(cab.railS < 0.01, 'down');
  s.run(15);
  assert.ok(cab.railS < 0.01 && spy.state === 'inVehicle', 'parked at the bottom with the Spy inside');
  gb.x = 40; gb.z = 93;
  assert.ok(cab.enter(gb), 'GB boards 15 s later');
  s.run(4);
  assert.ok(cab.railS > 0.5, 'the cabin left with both');
  assert.ok(!leaveVehicle(spy) && spy.state === 'inVehicle', 'nobody gets out between stations');
  s.run(30);
  assert.ok(cab.railS > cab.trackLen - 0.01 && gb.state === 'inVehicle' && spy.state === 'inVehicle', 'both at the top');
});

test('m05 fix: the disguised Spy boards the cable car in view of the lift guards (Route B)', () => {
  for (const exempt of [true, false]) {
    const s = makeSim(def(), { brains: true });
    s.run(0.1);
    const cab = s.get('cablecar'), spy = s.cmd('spy'), e11 = s.get('e11');
    spy.setDisguise(true);
    spy.x = 40.5; spy.z = 92.5;
    // e11 stares straight at him from 4 m
    e11.x = 37; e11.z = 92.5; e11.heading = 0; if (e11.post) { e11.post.heading = 0; e11.post.sweep = 0; }
    if (!exempt) s.world.mission = { ...s.world.mission, rules: {} };
    s.world.events.emit('ability:start', { unit: spy, id: 'enterVehicle', target: cab });
    assert.ok(cab.enter(spy), 'boards');
    s.run(0.2);
    if (exempt) assert.ok(spy.disguised && s.count('enemy:unmasked-spy') === 0, 'rules.spyMayBoard: not suspicious');
    else assert.ok(!spy.disguised && s.count('enemy:unmasked-spy') >= 1, 'control: the §3.4 boarding rule still applies elsewhere');
  }
});

test('m05 fix: a noise that swings a sentry round does not make him a witness of the kill in the same instant', () => {
  const s = makeSim(def(), { brains: true });
  s.run(0.1);
  const w = s.world, e15 = s.get('e15'), spy = s.cmd('spy'), p18 = s.get('p18a');
  spy.setDisguise(true);
  // e15 faces E (away); the Spy stands 10 m W of him on the plateau, the victim beyond the Spy
  e15.x = 95; e15.z = 40; e15.heading = 0; e15.post.heading = 0; e15.post.sweep = 0;
  spy.x = 85; spy.z = 40; spy.y = 16;
  p18.x = 80; p18.z = 40;
  e15.brain.hear({ x: 80, z: 40, radius: 1000, kind: 'explosion', level: 3, source: null });
  assert.ok(Math.abs(Math.cos(e15.heading) + 1) < 0.05, 'the blast swung him round (W)');
  p18.brain.enemy.hp = 0;
  const saw = e15.brain.notifyKill(p18, spy);
  assert.equal(saw, false, 'the kill in the same instant is judged with the cone he had (facing E)');
  assert.ok(spy.disguised && s.count('enemy:unmasked-spy') === 0, 'the Spy stays disguised');
  w.time += 0.5;
  assert.equal(e15.brain.notifyKill(p18, spy), true, 'half a second later he does see it');
});

test('m05 fix: a mine has a 3 m lethal blast (dossier §6.2), not the grenade 6.75 m', () => {
  const s = sim();
  s.run(0.1);
  const gb = s.cmd('greenberet'), spy = s.cmd('spy');
  gb.x = 58; gb.z = 110.2; gb.y = 0;
  spy.x = 58; spy.z = 114; spy.y = 0; // 4 m behind him in his tracks
  s.run(0.3);
  assert.equal(gb.alive, false, 'GB killed');
  assert.ok(spy.alive, 'the man 4 m behind survives');
  assert.equal(s.last('explosion').p.radius, 3);
});

test('m05 fix: the pm patrol never reads tracks at the E end of h1 or on e3 beat (N end > 18 m near band)', () => {
  const pm = def().enemies.find((e) => e.id === 'pma');
  const pts = [[pm.x, pm.z], ...pm.route.points.map((p) => [p.x, p.z])];
  const zN = Math.min(...pts.map(([, z]) => z));
  const [xN] = pts.find(([, z]) => z === zN);
  for (const [x, z] of [[32, 31], [28.5, 23], [29.5, 24.5], [19, 33]]) {
    assert.ok(Math.hypot(x - xN, z - zN) > 18, `(${x},${z}) is ${Math.hypot(x - xN, z - zN).toFixed(1)} m from pm's N end`);
  }
});

test('m05: b1 razes the summit barracks (kills p18 at its S end and e16), one officer gets out; the radar survives', () => {
  const s = sim();
  s.run(0.1);
  const p18 = ['p18a', 'p18b', 'p18c'].map((id) => s.get(id));
  // the patrol at the S end of its beat, next to the drum ("wait until the patrol is next to the barrel")
  p18.forEach((e, k) => { e.x = 93 - k * 0.8; e.z = 53 - k * 1.2; });
  const b1 = s.get('b1');
  b1.takeDamage(100, null);
  s.run(1);
  const g3 = s.get('g3_barracks'), radar = s.get('radar');
  assert.ok(g3.destroyed, 'g3_barracks destroyed');
  assert.ok(!radar.destroyed, 'radar untouched');
  for (const e of [...p18, s.get('e16')]) assert.equal(e.alive, false, `${e.tag ?? e.id} killed`);
  assert.ok(s.get('e17').alive && s.get('e15').alive, 'far guards survive');
  s.run(1.5);
  const off = s.get('g3_officer');
  assert.ok(off && off.alive, 'the officer got out');
  s.run(0.5);
  assert.ok(Math.abs(off.y - 16) < 0.6, 'on the plateau');
});

test('m05: a drum carried to the dish destroys the radar (o1); the escape needs everyone aboard the autogyro', () => {
  const s = sim();
  const w = s.world;
  w.objectives = def().objectives.map((o) => ({ required: true, hidden: false, ...o, done: false, failed: false }));
  s.run(0.1);
  const b2 = s.get('b2');
  b2.x = 91.5; b2.z = 31; // carried next to the pedestal
  b2.takeDamage(100, null);
  s.run(1);
  checkObjectives(w);
  const o = Object.fromEntries(w.objectives.map((x) => [x.id, x]));
  assert.ok(s.get('radar').destroyed && o.o1.done, 'radar destroyed, o1 done');
  assert.ok(!o.o2.done && !o.o3.done);
  const v = s.get('autogyro');
  const [gb, spy] = [s.cmd('greenberet'), s.cmd('spy')];
  gb.x = 78; gb.z = 28; spy.x = 80; spy.z = 28; gb.y = spy.y = 16;
  assert.ok(v.enter(gb), 'GB boards');
  for (let k = 0; k < 60; k++) { s.run(0.05); checkObjectives(w); }
  assert.ok(!o.o3.done && !v.drivenOff, 'no take-off without the Spy');
  assert.ok(v.enter(spy), 'Spy boards');
  for (let k = 0; k < 600 && !o.o3.done; k++) { s.run(0.05); checkObjectives(w); }
  assert.ok(v.drivenOff || v.z < 0, 'the autogyro flew off the map edge');
  assert.ok(o.o3.done, 'escape objective done');
});
