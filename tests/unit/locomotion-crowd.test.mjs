/**
 * Locomotion in a crowd (playtest 2026-09-30, verifier round 2): men stacked on one spot, doorways, two men sent to
 * one spot by a wall, a patrol passing a man by its waypoint, released barracks squads, and the squad followers'
 * walk / idle flicker. Headless (abilsim / loco-trace), deterministic.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { missionSim } from './loco-trace.mjs';
import { getMission } from '../../src/missions/index.js';
import { Entity } from '../../src/entities/entity.js';
import { B } from '../../src/world/grid.js';
import { Alarm } from '../../src/ai/alarm.js';

function field(cs) {
  Entity.nextId = 1;
  return makeSim({ commandos: cs.map(([role, x, z]) => ({ role, x, z })) });
}

/** A wall across x = 25 with a 1.5 m doorway (walkable z 49.5–51). */
function doorway(sim) {
  const g = sim.world.grid;
  g.fillRect(24.75, 0, 0.5, 49.25, 'block', B.HIGH);
  g.fillRect(24.75, 50.75, 0.5, 9.25, 'block', B.HIGH);
}

/** Step `secs`; per tick: closest pair distance (from t0), largest one-tick move (m), ticks on blocked cells. */
function run(sim, men, secs, t0 = 0.5) {
  let min = Infinity, minT = 0, jump = 0, off = 0;
  const prev = men.map((u) => [u.x, u.z]);
  for (let k = 0; k < Math.round(secs * 60); k++) {
    sim.step();
    men.forEach((u, i) => {
      jump = Math.max(jump, Math.hypot(u.x - prev[i][0], u.z - prev[i][1]));
      prev[i] = [u.x, u.z];
      if (u.path && !sim.world.grid.walkableAt(u.x, u.z)) off++;
    });
    if (k / 60 < t0) continue;
    for (let i = 0; i < men.length; i++) for (let j = i + 1; j < men.length; j++) {
      const d = Math.hypot(men[i].x - men[j].x, men[i].z - men[j].z);
      if (d < min) { min = d; minT = k / 60; }
    }
  }
  return { min, minT, jump, off };
}

test('two men stacked on one spot, sent the same way (a squad on one track), walk off apart and stay apart', () => {
  const sim = field([['greenberet', 15, 45], ['sapper', 15, 45]]);
  const [a, b] = [sim.cmd('greenberet'), sim.cmd('sapper')];
  a.moveTo(30, 45); b.moveTo(30, 45); // was: 0 m apart all the way (neither dodged a man exactly on top of him)
  const r = run(sim, [a, b], 12, 1);
  assert.ok(r.min >= 0.75, `still inside each other after 1 s: ${r.min.toFixed(2)} m at ${r.minT.toFixed(2)} s`);
  assert.ok(r.jump <= 2.9 / 60, `one-tick jump ${(r.jump * 60).toFixed(1)} m/s`);
  assert.ok(!a.path && !b.path, 'both arrive');
});

test('doorway: a teammate standing in the gap steps aside; the walker neither squeezes through him nor jumps sideways', () => {
  const sim = field([['greenberet', 20, 50], ['sniper', 25, 50]]);
  doorway(sim);
  const [a, b] = [sim.cmd('greenberet'), sim.cmd('sniper')];
  a.moveTo(30, 50);
  const r = run(sim, [a, b], 20);
  assert.ok(r.min >= 0.85, `passed ${r.min.toFixed(2)} m from the man in the door at ${r.minT.toFixed(2)} s`);
  assert.ok(r.jump <= 2.9 / 60, `one-tick jump ${(r.jump * 60).toFixed(1)} m/s`);
  assert.equal(r.off, 0, 'never on a blocked cell');
  assert.ok(!a.path && Math.hypot(a.x - 30, a.z - 50) < 0.3, 'through the door, on his spot');
});

test('doorway head-on: one man holds outside while the other comes through (no squeeze)', () => {
  const sim = field([['greenberet', 20, 50], ['sapper', 30, 50]]);
  doorway(sim);
  const [a, b] = [sim.cmd('greenberet'), sim.cmd('sapper')];
  a.moveTo(30, 50); b.moveTo(20, 50);
  const r = run(sim, [a, b], 25);
  assert.ok(r.min >= 0.85, `passed at ${r.min.toFixed(2)} m (${r.minT.toFixed(2)} s)`);
  assert.ok(r.jump <= 2.9 / 60, `one-tick jump ${(r.jump * 60).toFixed(1)} m/s`);
  assert.ok(!a.path && !b.path, 'both through');
});

test('three men sent through a doorway file through it (nobody walks inside another)', () => {
  const sim = field([['greenberet', 20, 48], ['sapper', 20, 50], ['sniper', 20, 52]]);
  doorway(sim);
  const men = ['greenberet', 'sapper', 'sniper'].map((r) => sim.cmd(r));
  men[0].moveTo(30, 50); men[1].moveTo(30.2, 48.8); men[2].moveTo(30, 51.2);
  const r = run(sim, men, 25);
  assert.ok(r.min >= 0.75, `${r.min.toFixed(2)} m at ${r.minT.toFixed(2)} s`);
  assert.ok(r.jump <= 3.4 / 60, `one-tick jump ${(r.jump * 60).toFixed(1)} m/s`);
  assert.ok(men.every((u) => !u.path), 'all through');
});

test('M0: two commandos sent to one spot by the compound wall: one stops beside, no sideways snapping, never in the wall', () => {
  Entity.nextId = 1;
  const sim = missionSim(getMission('m00')), w = sim.world;
  for (const e of [...w.enemies]) w.remove(e);
  w.commandos.forEach((c, i) => c.setPosition(4 + i, 58));
  const [a, b] = w.commandos;
  a.setPosition(48, 40); b.setPosition(50, 38);
  for (let k = 0; k < 6; k++) sim.step();
  a.moveTo(45.9, 34.3); b.moveTo(45.9, 34.3);
  const r = run(sim, [a, b], 15);
  assert.ok(r.min >= 0.85, `${r.min.toFixed(2)} m apart at ${r.minT.toFixed(2)} s`);
  assert.ok(r.jump <= 3.0 / 60, `one-tick jump ${(r.jump * 60).toFixed(1)} m/s`);
  assert.equal(r.off, 0, 'never on a blocked cell');
});

test('M0: a patrol passes a commando standing by its waypoint at a body width (and keeps its timing alone)', () => {
  const stops = (withMan) => {
    Entity.nextId = 1;
    const sim = missionSim(getMission('m00')), w = sim.world;
    const pw = w.enemies.find((e) => (e.tag ?? e.id) === 'patrol_west');
    for (const e of [...w.enemies]) if (e !== pw) w.remove(e);
    pw.brain._perceive = () => {}; pw.brain.hear = () => {};
    w.commandos.forEach((c, i) => c.setPosition(4 + i, 58));
    const c = w.commandos[0];
    if (withMan) c.setPosition(15, 27);
    let min = Infinity, was = true;
    const at = [];
    for (let k = 0; k < 60 * 60; k++) {
      sim.step();
      if (withMan) min = Math.min(min, Math.hypot(pw.x - c.x, pw.z - c.z));
      if (was && !pw.path) at.push(+(k / 60).toFixed(2));
      was = !!pw.path;
    }
    return { min, at };
  };
  const alone = stops(false), by = stops(true);
  assert.deepEqual(alone.at.slice(0, 3), [0, 20.47, 40.62], 'route timing alone');
  assert.ok(by.min >= 0.8, `walked ${by.min.toFixed(2)} m from the man by his waypoint`);
});

test('a released barracks squad appears a body width apart round the door (not stacked on one spot)', () => {
  for (const m of ['m02', 'm03']) {
    const sim = missionSim(getMission(m)), w = sim.world;
    if (!w.alarm) w.alarm = new Alarm(w);
    const units = [];
    w.events.on('reinforcements', (e) => units.push(...e.units));
    sim.step();
    w.alarm.fireEvent('RINT', {});
    sim.step();
    assert.ok(units.length >= 2, `${m}: squads released`);
    let min = Infinity;
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) min = Math.min(min, Math.hypot(units[i].x - units[j].x, units[i].z - units[j].z));
    assert.ok(min >= 0.8, `${m}: two of them ${min.toFixed(2)} m apart`);
    for (const u of units) assert.ok(w.grid.walkableAt(u.x, u.z), `${m}: ${u.id} on walkable ground`);
  }
});

test('M1–M3 patrols and squads over 120 s: no walk / idle flicker (animation segments under 0.25 s)', () => {
  let total = 0;
  const where = [];
  for (const m of ['m01', 'm02', 'm03']) {
    const sim = missionSim(getMission(m));
    const U = sim.world.enemies.filter((e) => e.squad?.id || e.route);
    const st = new Map(U.map((u) => [u, { a: u._anim, k0: 0 }]));
    for (let k = 0; k < 120 * 60; k++) {
      sim.step();
      for (const u of U) {
        const s = st.get(u);
        if (u._anim === s.a) continue;
        if (s.k0 > 0 && k - s.k0 < 15 && (s.a === 'walk' || s.a === 'idle')) { total++; where.push(`${m} ${u.tag}@${(s.k0 / 60).toFixed(2)}`); }
        s.a = u._anim; s.k0 = k;
      }
    }
  }
  assert.ok(total <= 3, `${total} flashes: ${where.slice(0, 8).join(', ')}`); // was 68 (base of this fix)
});
