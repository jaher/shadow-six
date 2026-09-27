/**
 * Regression tests for playtest replay findings, round 2 (m01–m03 scripted playthroughs).
 */
import { test, assert } from './lib.mjs';
import { makeWorld as mk, addCommando, run, DT } from './ai-harness.mjs';
import { Entity } from '../../src/entities/entity.js';

const makeWorld = (m = {}) => { Entity.nextId = 1; return mk(m); };

/** Game.step order, interactables included (commandos → enemies → BEL → vehicles → projectiles → interactables). */
function stepFull(w, n = 1) {
  for (let i = 0; i < n; i++) {
    w.rebuildSpatial(); w.refreshDynamicOccluders();
    for (const list of [w.commandos, w.enemies]) for (const e of [...list]) if (!e.removed) e.update(DT);
    w.runBelTicks(DT);
    for (const list of [w.vehicles, w.projectiles, w.interactables]) for (const e of [...list]) if (!e.removed) e.update(DT);
    w.alarm.update(DT); w.flushRemovals(); w.time += DT; w.tick++;
  }
}

test('m01: guards killed by one barrel blast never react to each other\'s deaths (no spotted / warning / ger_combat)', async () => {
  const { Barrel } = await import('../../src/entities/interactables.js');
  await import('../../src/abilities/index.js');
  // three guards around the barrel, all facing the prone Driver ~9 m off (replay e10/e11/e12)
  const w = makeWorld({ enemies: [
    { id: 'g1', soldierType: 'soldier', x: 20, z: 20, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'g2', soldierType: 'soldier', x: 20, z: 21.5, heading: 0, post: { heading: 0, sweep: 0 } },
    { id: 'g3', soldierType: 'soldier', x: 20, z: 18.5, heading: 0, post: { heading: 0, sweep: 0 } },
  ] });
  const b = new Barrel({ x: 20.8, z: 20 });
  w.add(b);
  const dr = addCommando(w, 'driver', 29.9, 20, Math.PI);
  dr.setStance('crawl');
  run(w, 1);
  for (const id of ['g1', 'g2', 'g3']) assert.equal(w.byId(id).brainState, 'IDLE', `${id} calm before the shot`);
  const log = [];
  for (const t of ['enemy:spotted', 'ui:warning', 'unit:killed', 'alarm:zone']) w.events.on(t, () => log.push(t));
  w.events.on('bark', (p) => log.push(`bark:${p.line}`));
  w.events.on('enemy:state', (p) => log.push(`state:${p.to ?? p.state ?? ''}`));
  assert.ok(dr.useAbility('pistol', b), 'shot ordered');
  for (let i = 0; i < 120 && !b.exploded; i++) stepFull(w);
  assert.ok(b.exploded, 'barrel went off');
  for (const id of ['g1', 'g2', 'g3']) assert.equal(w.byId(id).alive, false, `${id} killed by the blast`);
  assert.equal(log.filter((l) => l === 'unit:killed').length, 3);
  assert.ok(!log.includes('enemy:spotted'), `no spotted: ${log.join(',')}`);
  assert.ok(!log.includes('ui:warning'), `no seen warning: ${log.join(',')}`);
  assert.ok(!log.includes('bark:ger_combat'), `no combat bark: ${log.join(',')}`);
  assert.ok(!log.includes('state:COMBAT'), `nobody enters COMBAT: ${log.join(',')}`);
});

async function missionSim(id) {
  const { makeSim } = await import('./abilsim.mjs');
  const { getMission } = await import('../../src/missions/index.js');
  const { Alarm } = await import('../../src/ai/alarm.js');
  const s = makeSim(getMission(id));
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  return s;
}

/** Measure the leader's mean ground speed over `secs` (sim run), plus where he ends up. */
function speedOver(s, u, secs) {
  let d = 0, px = u.x, pz = u.z;
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) { s.step(1 / 60); d += Math.hypot(u.x - px, u.z - pz); px = u.x; pz = u.z; }
  return d / secs;
}

test('m03 §4.9/§7.6: RINT sends patrol p5 running to (26,56) at ~2.7 m/s, then it resumes its own loop', async () => {
  const s = await missionSim('m03'), w = s.world, e29 = s.get('e29');
  s.run(1);
  const d0 = Math.hypot(e29.x - 26, e29.z - 56);
  w.alarm.fireEvent('RINT', { cause: 'test', x: 30, z: 50 });
  assert.equal(e29.brain.state, 'REINFORCE', 'p5 leader switched to its alarm route');
  const v = speedOver(s, e29, 3);
  assert.ok(v >= 2.4 && v <= 3.1, `runs at ~2.7 m/s (got ${v.toFixed(2)})`);
  assert.ok(Math.hypot(e29.x - 26, e29.z - 56) < d0 - 5, `heads for (26,56): ${e29.x.toFixed(1)},${e29.z.toFixed(1)}`);
  const reached = s.run(30, () => Math.hypot(e29.x - 26, e29.z - 56) < 0.5);
  assert.ok(reached, `reached (26,56): at ${e29.x.toFixed(1)},${e29.z.toFixed(1)}`);
  s.run(1);
  // resume: the own loop (VEL 1 = 0.9 m/s), joined at its nearest waypoint (30,54)
  const route = e29.route.map((p) => `${p.x},${p.z}`);
  for (const p of ['2,49', '14,52', '30,54', '10,55']) assert.ok(route.includes(p), `own loop point ${p} in ${route}`);
  const v2 = speedOver(s, e29, 2);
  assert.ok(v2 > 0.5 && v2 < 1.3, `resumes at patrol pace (got ${v2.toFixed(2)})`);
});

test('m02 §4.9: RINT sends patrol p4 running to (62,54), then onto its alarm loop', async () => {
  const s = await missionSim('m02'), w = s.world, e13 = s.get('e13');
  s.run(1);
  w.alarm.fireEvent('RINT', { cause: 'test', x: 40, z: 40 });
  assert.equal(e13.brain.state, 'REINFORCE', 'p4 leader switched to its alarm route');
  assert.deepEqual([e13.route[0].x, e13.route[0].z], [62, 54], 'first leg: the run point');
  assert.ok(e13.route.some((p) => p.x === 68 && p.z === 44), 'then the alarm loop (58,54)(68,44)(78,52)(70,62)');
  const v = speedOver(s, e13, 3);
  assert.ok(v >= 2.4 && v <= 3.1, `runs at ~2.7 m/s (got ${v.toFixed(2)})`);
});

test('m02 §3.3: an out-of-range SMG order is refused (ranged: no auto-walk) with an on-screen reason', async () => {
  const { makeSim } = await import('./abilsim.mjs');
  await import('../../src/abilities/index.js');
  const s = makeSim({ commandos: [{ role: 'driver', x: 47.3, z: 44, inventory: { pistol: 1, smg: 20 } }], enemies: [{ id: 'g', soldierType: 'soldier', x: 31.1, z: 32 }] }, { brains: false });
  const w = s.world, dr = s.cmd('driver'), g = s.get('g');
  const msgs = [], refused = [];
  w.events.on('message', (m) => msgs.push(m));
  w.events.on('ability:refused', (p) => refused.push(p));
  assert.equal(dr.issue({ type: 'ability', id: 'smg', target: g }), false, '20.2 m > 18 m: refused');
  assert.ok(!dr.pendingAbility && !dr.isMoving, 'no walk into range (spec §3.3: auto-walk is melee + hand only)');
  assert.equal(refused[0]?.reason, 'Out of range.');
  assert.equal(dr.lastRefusal?.text, 'Out of range.');
  assert.ok(msgs.some((m) => m.kind === 'warn' && /Out of range/.test(m.text)), 'HUD warn message');
  Object.assign(dr, { x: 40, z: 38 });
  assert.equal(dr.issue({ type: 'ability', id: 'smg', target: g }), true, 'in range: fires');
});

test('m03 §3.4: the Spy cannot Distract the dam bunker crew (e34) — refused with a reason, not a silent no-op', async () => {
  const s = await missionSim('m03'), w = s.world, spy = s.cmd('spy'), e34 = s.get('e34');
  const { ABILITIES } = await import('../../src/abilities/index.js');
  spy.disguised = true;
  Object.assign(spy, { x: 22, z: 50, path: null });
  const r = ABILITIES.distract.canUse(spy, e34, w);
  assert.equal(typeof r, 'string', 'forbidden cursor on a bunker crew');
  assert.equal(spy.issue({ type: 'ability', id: 'distract', target: e34 }), false, 'order refused');
  assert.ok(spy.lastRefusal?.text, 'with a reason');
  assert.equal(ABILITIES.distract.canUse(spy, s.get('e18'), w), true, 'a sentry in the open can still be distracted');
});

test('m02 §4.5 pboat: fires on sight without a challenge, but flags the sighting (spotted + warning + zone) and aims 0.5 s first', async () => {
  const s = await missionSim('m02'), w = s.world, boat = s.get('pboat'), sn = s.cmd('sniper');
  for (const c of w.commandos) if (c !== sn) Object.assign(c, { x: 5, z: 115, path: null });
  s.run(0.5);
  const bh = boat.heading;
  Object.assign(sn, { x: boat.x + Math.cos(bh) * 18, z: boat.z + Math.sin(bh) * 18, y: 0, path: null });
  const log = [];
  w.events.on('enemy:spotted', (p) => { if (p.vehicle === boat) log.push({ t: w.time, k: 'spotted', target: p.target }); });
  w.events.on('enemy:challenge', (p) => { if (boat.crew.includes(p.enemy)) log.push({ t: w.time, k: 'challenge' }); });
  w.events.on('ui:warning', (p) => log.push({ t: w.time, k: `warn:${p.kind}` }));
  w.events.on('vehicle:fire', (p) => { if (p.vehicle === boat) log.push({ t: w.time, k: 'fire' }); });
  w.events.on('alarm:zone', () => log.push({ t: w.time, k: 'zone' }));
  s.run(4, () => log.some((l) => l.k === 'fire'));
  const sp = log.find((l) => l.k === 'spotted'), fire = log.find((l) => l.k === 'fire');
  assert.ok(sp && sp.target === sn, `boat flags the sniper: ${log.map((l) => l.k)}`);
  assert.ok(log.some((l) => l.k === 'warn:seen'), 'portrait flash');
  assert.ok(!log.some((l) => l.k === 'challenge'), 'no challenge (fire on sight)');
  assert.ok(fire, 'and then fires');
  assert.ok(fire.t - sp.t >= 0.45, `aims ~0.5 s before the first burst (got ${(fire.t - sp.t).toFixed(2)})`);
});
