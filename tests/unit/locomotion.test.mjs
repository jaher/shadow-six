/**
 * Locomotion: smooth walking and unit-vs-unit avoidance (playtest 2026-09-30: "some soldiers when they walk are
 * jerking, we need to have them walk smoother and without crossing each other").
 * Headless traces (loco-trace.mjs) of the M1–M3 patrols plus small commando / patrol scenes.
 */
import { test, assert } from './lib.mjs';
import { makeSim, stubBrain } from './abilsim.mjs';
import { missionSim, trace, smoothness, closest } from './loco-trace.mjs';
import { getMission } from '../../src/missions/index.js';
import { Entity } from '../../src/entities/entity.js';
import { CONFIG } from '../../src/config.js';
import { restoreWorld } from '../../src/save.js';
import { Input } from '../../src/engine/input.js';

/** Largest |Δspeed|/dt while cruising (both ticks above `v`): a stop at a halt is a stop, not a spike. */
function cruiseAccel(s, v = 0.3) {
  let m = 0;
  for (let k = 1; k < s.length; k++) if (s[k - 1].v > v && s[k].v > v) m = Math.max(m, Math.abs(s[k].v - s[k - 1].v) * 60);
  return m;
}

/** Smallest centre distance between any two live, standing men of `ids` over the trace (from t ≥ t0). */
function minPair(tr, ids, t0 = 0) {
  let best = { d: Infinity, a: null, b: null, t: 0 };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = tr.samples[ids[i]], B = tr.samples[ids[j]];
    for (let k = 0; k < Math.min(A.length, B.length); k++) {
      if (A[k].t < t0 || !A[k].alive || !B[k].alive) continue;
      const d = Math.hypot(A[k].x - B[k].x, A[k].z - B[k].z);
      if (d < best.d) best = { d, a: ids[i], b: ids[j], t: A[k].t };
    }
  }
  return best;
}

const withAvoid = (on, fn) => { const was = CONFIG.units.avoid.on; CONFIG.units.avoid.on = on; try { return fn(); } finally { CONFIG.units.avoid.on = was; } };

test('M1 south patrol pair (e8 + e9, PINGPONG): no stop-start stutter, no idle flashes, never walk through each other', () => {
  const sim = missionSim(getMission('m01'));
  const tr = trace(sim, ['e8', 'e9'], 140);
  const lead = smoothness(tr.samples.e8), mate = smoothness(tr.samples.e9);
  assert.equal(lead.stopStarts, 0, `leader stutters ${JSON.stringify(lead)}`);
  assert.equal(mate.stopStarts, 0, `follower stutters ${JSON.stringify(mate)}`); // was 161 in 90 s
  assert.ok(mate.animFlips <= 2.5 * lead.animFlips, `follower walk/idle flips ${mate.animFlips} vs leader ${lead.animFlips}`); // was 333
  assert.ok(cruiseAccel(tr.samples.e9) < 4, `follower speed spikes ${cruiseAccel(tr.samples.e9).toFixed(2)} m/s²`);
  const c = closest(tr, 'e8', 'e9');
  assert.ok(c.d >= 0.85, `pair overlaps: ${c.d.toFixed(2)} m at t=${c.t.toFixed(1)}`); // was 0.005 (walked through)
});

test('pass-through route waypoints do not stop the walker (no one-tick idle at corners); a LOOP closes without a stop', () => {
  for (const [m, id] of [['m01', 'e8'], ['m01', 'e10'], ['m03', 'e29']]) {
    const sim = missionSim(getMission(m));
    const tr = trace(sim, [id], 150);
    assert.equal(smoothness(tr.samples[id]).stopStarts, 0, `${m} ${id}`);
  }
});

test('M1–M3 patrols and squads: nobody overlaps another man while walking (≥ 0.6 m centre to centre after the start)', () => {
  for (const m of ['m01', 'm02', 'm03']) {
    const def = getMission(m), sim = missionSim(def);
    const ids = def.enemies.filter((e) => e.route || e.squad).map((e) => e.id);
    const tr = trace(sim, ids, 150);
    const b = minPair(tr, ids, 2);
    assert.ok(b.d >= 0.6, `${m}: ${b.a}–${b.b} ${b.d.toFixed(2)} m at t=${b.t.toFixed(1)}`);
  }
});

test('squad followers keep a steady pace on a straight leg (no speed oscillation)', () => {
  const sim = missionSim(getMission('m01'));
  const tr = trace(sim, ['e8', 'e9'], 30);
  const leg = tr.samples.e9.filter((s) => s.t > 14 && s.t < 28);
  const vs = leg.map((s) => s.v);
  assert.ok(Math.max(...vs) - Math.min(...vs) < 0.12, `pace ${Math.min(...vs).toFixed(2)}–${Math.max(...vs).toFixed(2)} m/s`);
});

/** A small grass field with commandos `cs` ([role, x, z]) and optional walls / enemies. */
function field(cs, extra = {}) {
  Entity.nextId = 1;
  return makeSim({ commandos: cs.map(([role, x, z]) => ({ role, x, z })), ...extra });
}

/** Step until every man is standing again (or `secs` pass); trace all of them. */
function walkAll(sim, ids, secs) {
  const tr = trace(sim, ids, secs);
  return { tr, arrived: ids.every((id) => !sim.get(id).path) };
}

test('head-on: two commandos on the same line pass each other (keep right), both arrive on their spots', () => {
  const sim = field([['greenberet', 10, 30], ['sapper', 40, 30]]);
  const a = sim.cmd('greenberet'), b = sim.cmd('sapper');
  a.issue({ type: 'move', x: 40, z: 30 }); b.issue({ type: 'move', x: 10, z: 30 });
  const { tr, arrived } = walkAll(sim, [a.id, b.id], 20);
  assert.ok(arrived, 'both arrive');
  const c = closest(tr, a.id, b.id);
  assert.ok(c.d >= 0.8, `passed at ${c.d.toFixed(2)} m`);
  assert.ok(Math.hypot(a.x - 40, a.z - 30) < 0.3 && Math.hypot(b.x - 10, b.z - 30) < 0.3, 'on their spots (the lane closes at the goal)');
  for (const id of [a.id, b.id]) assert.ok(smoothness(tr.samples[id]).maxTurn < 0.2, 'no heading flips while dodging');
});

test('crossing: a commando waits for / steps round another crossing his path — no overlap, both arrive', () => {
  const sim = field([['greenberet', 10, 30], ['sapper', 25, 15]]);
  const a = sim.cmd('greenberet'), b = sim.cmd('sapper');
  a.issue({ type: 'move', x: 40, z: 30 }); b.issue({ type: 'move', x: 25, z: 45 });
  const { tr, arrived } = walkAll(sim, [a.id, b.id], 25);
  assert.ok(arrived, 'both arrive');
  const c = closest(tr, a.id, b.id);
  assert.ok(c.d >= 0.8, `crossed at ${c.d.toFixed(2)} m (t=${c.t.toFixed(1)})`);
});

test('a commando walks round a man standing on his line, and stops beside one standing on his goal', () => {
  const sim = field([['greenberet', 10, 30], ['sapper', 25, 30], ['sniper', 40, 30]]);
  const a = sim.cmd('greenberet');
  a.issue({ type: 'move', x: 40, z: 30 });
  const { tr } = walkAll(sim, [a.id, sim.cmd('sapper').id, sim.cmd('sniper').id], 25);
  assert.ok(!a.path, 'he stopped');
  const b = minPair(tr, [a.id, sim.cmd('sapper').id, sim.cmd('sniper').id]);
  assert.ok(b.d >= 0.8, `${b.a}–${b.b} ${b.d.toFixed(2)} m`);
  assert.ok(Math.hypot(a.x - 40, a.z - 30) < 1.3, 'beside the man on his goal');
});

test('corridor (1.6 m between walls): head-on walkers never deadlock — both get through', () => {
  const walls = [{ type: 'wall', points: [[15, 29.2], [35, 29.2]] }, { type: 'wall', points: [[15, 30.8], [35, 30.8]] }];
  const sim = field([['greenberet', 10, 30], ['sapper', 40, 30]], { structures: walls });
  const a = sim.cmd('greenberet'), b = sim.cmd('sapper');
  assert.ok(a.issue({ type: 'move', x: 40, z: 31.8 }) && b.issue({ type: 'move', x: 10, z: 28.2 }));
  const { arrived } = walkAll(sim, [a.id, b.id], 40);
  assert.ok(arrived, `both through (a ${a.x.toFixed(1)},${a.z.toFixed(1)} b ${b.x.toFixed(1)},${b.z.toFixed(1)})`);
  const g = sim.world.grid;
  for (const u of [a, b]) assert.ok(g.walkableAt(u.x, u.z), 'never pushed into a wall');
});

test('group move: five commandos from a huddle to formation slots never overlap and all arrive', () => {
  const cs = [['greenberet', 10, 10], ['sapper', 10.8, 10], ['sniper', 10, 10.8], ['driver', 10.8, 10.8], ['spy', 11.6, 10.4]];
  const sim = field(cs);
  const ids = cs.map(([r]) => sim.cmd(r).id);
  // the real group order (InputController.orderMove: first man on the point, the rest on a 1.2 m ring)
  const orders = Input.prototype.orderMove.call({ selection: cs.map(([r]) => sim.cmd(r)), game: { enqueue: (f) => f() } }, 40, 40);
  assert.equal(orders.map((o) => +Math.hypot(o.x - 40, o.z - 40).toFixed(3)).join(), '0,1.2,1.2,1.2,1.2', 'formation offsets');
  const { tr, arrived } = walkAll(sim, ids, 40);
  assert.ok(arrived, 'all arrive');
  // they start huddled closer than two bodies; walking together they may brush shoulders, never pass through
  const b = minPair(tr, ids, 1.5);
  assert.ok(b.d >= 0.7, `${b.a}–${b.b} ${b.d.toFixed(2)} m at t=${b.t.toFixed(1)}`);
  const end = ids.map((id) => sim.get(id));
  for (let i = 0; i < end.length; i++) for (let j = i + 1; j < end.length; j++) assert.ok(Math.hypot(end[i].x - end[j].x, end[i].z - end[j].z) >= 1.15, 'formed up 1.2 m apart');
});

/** Per-tick positions of `id` for `secs` in a fresh M-mission sim, with `setup(sim)` run first. */
function route(m, id, secs, setup = null, also = []) {
  const sim = missionSim(getMission(m));
  setup?.(sim);
  const tr = trace(sim, [id, ...also], secs);
  const pts = tr.samples[id].map((s) => [s.x, s.z]);
  pts.tr = tr;
  return pts;
}

test('a patrol keeps its route timing exactly when another man walks across its path (patrols have right of way)', () => {
  // M1 e8 walks N–S on the road at x≈46–53 and passes z≈120 at t≈13 s; the sentry e7 (brain stubbed: he
  // just walks) crosses the road there at the same moment and has to give way
  const alone = route('m01', 'e8', 25);
  let cross = null;
  const crossed = route('m01', 'e8', 25, (sim) => {
    const c = sim.get('e7');
    c.brain = stubBrain(c);
    c.setPosition(36, 120.2); c.moveTo(58, 120.6);
    cross = c;
  }, ['e7']);
  assert.ok(cross.x > 50, 'the crosser got across');
  const near = closest(crossed.tr, 'e8', 'e7');
  assert.ok(near.d < 2.5 && near.d >= 0.8, `their paths met (${near.d.toFixed(2)} m at t=${near.t.toFixed(1)}) without contact`);
  let dev = 0;
  for (let k = 0; k < alone.length; k++) dev = Math.max(dev, Math.hypot(alone[k][0] - crossed[k][0], alone[k][1] - crossed[k][1]));
  assert.ok(dev < 1e-9, `patrol moved off his timing by ${dev.toFixed(4)} m`);
});

test('two patrols crossing (M2 e2 × e3): both dodge sideways, neither is delayed along his route', () => {
  const off = withAvoid(false, () => { const sim = missionSim(getMission('m02')); return trace(sim, ['e2', 'e3'], 230); });
  const on = (() => { const sim = missionSim(getMission('m02')); return trace(sim, ['e2', 'e3'], 230); })();
  const c = closest(on, 'e2', 'e3');
  assert.ok(c.d >= 0.75, `they pass at ${c.d.toFixed(2)} m (without avoidance ${closest(off, 'e2', 'e3').d.toFixed(2)})`);
  // the lane is lateral: the dodge never puts a man more than a lane width off his avoidance-free walk
  for (const id of ['e2', 'e3']) {
    let dev = 0;
    const A = off.samples[id], B = on.samples[id];
    for (let k = 0; k < A.length; k++) dev = Math.max(dev, Math.hypot(A[k].x - B[k].x, A[k].z - B[k].z));
    assert.ok(dev <= CONFIG.units.avoid.laneMax + 0.05, `${id} off his walk by ${dev.toFixed(2)} m`);
  }
});

test('avoidance is deterministic and survives save/load mid-dodge (replays)', () => {
  const run = (saveAt) => {
    let sim = field([['greenberet', 10, 30], ['sapper', 40, 30]]);
    sim.cmd('greenberet').issue({ type: 'move', x: 40, z: 30 }); sim.cmd('sapper').issue({ type: 'move', x: 10, z: 30 });
    const out = [];
    for (let k = 0; k < 60 * 14; k++) {
      if (k === saveAt) {
        const snap = JSON.parse(JSON.stringify({ ...sim.world.serialize(), nextId: Entity.nextId }));
        const sim2 = field([['greenberet', 10, 30], ['sapper', 40, 30]]);
        restoreWorld(sim2.world, snap);
        sim = sim2;
      }
      sim.step();
      const a = sim.cmd('greenberet'), b = sim.cmd('sapper');
      out.push(`${a.x.toFixed(6)},${a.z.toFixed(6)},${b.x.toFixed(6)},${b.z.toFixed(6)}`);
    }
    return out;
  };
  const ref = run(-1);
  assert.deepEqual(run(-1), ref, 'same run, same walk');
  const mid = run(6 * 60); // they are mid-dodge at 6 s
  assert.deepEqual(mid.slice(6 * 60), ref.slice(6 * 60), 'a load mid-dodge continues the identical walk');
});
