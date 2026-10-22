/**
 * Video mode AUTO speed (src/debug/auto-pace.js): the speed wanted from what is about to happen (paceTarget), the eased
 * speed (AutoPace), the frame-rate ceiling (PerfCeiling) and the game reading (PaceSensor) — fast through dead time,
 * eased down to 1× into a key action, ½× for blasts and the climax, at most 2.5× while a caption is read, smooth ramps,
 * and nothing written to the game.
 */
import { test, assert, near } from './lib.mjs';
import { paceTarget, AutoPace, PerfCeiling, PaceSensor, SteadyGrant, readTime, inClimax, isTrueWait, AUTO_PACE, ACTION_RATE, EVENT_WINDOWS } from '../../src/debug/auto-pace.js';
import { TickPacer } from '../../src/debug/solution-replay.js';
import { EventBus } from '../../src/core/events.js';

const DEG = Math.PI / 180;
/** Run AutoPace at 60 fps for `sec` wall seconds toward `target` (a number or t → number); returns the rates. */
const run = (ap, target, sec, max = 8) => {
  const out = [];
  for (let i = 0, n = Math.round(sec * 60); i < n; i++) out.push(ap.step(typeof target === 'function' ? target(i / 60) : target, 1 / 60, max));
  return out;
};

test('auto pace: dead time runs at the films\' cruise under the ceiling (4×; 8× / crawl 6× while the frame rate holds)', () => {
  assert.equal(paceTarget({}).rate, 4);
  for (const m of ['idle', 'crawl', 'walk']) assert.equal(paceTarget({ motion: m }).rate, 4, m);
  assert.equal(paceTarget({ motion: 'idle' }, { ceiling: 8 }).rate, 8);
  assert.equal(paceTarget({ motion: 'crawl' }, { ceiling: 8 }).rate, 6);
  assert.equal(paceTarget({ motion: 'walk' }, { ceiling: 8 }).rate, 4);
  assert.equal(paceTarget({ motion: 'idle' }, { ceiling: 5 }).rate, 5, 'never above the ceiling');
  assert.equal(paceTarget({ motion: 'idle' }).why, 'idle');
});

test('auto pace: a key action is eased into (rate × (1 + seconds to go − 0.6), the films\' lead), 1× at the stab', () => {
  const at = (eta) => paceTarget({ action: { id: 'knife', rate: ACTION_RATE.knife, eta } }).rate;
  assert.equal(at(5), 4);
  near(at(2.6), 3, 1e-9);
  near(at(1.6), 2, 1e-9);
  near(at(0.6), 1, 1e-9, '1× from 0.6 s before the stab');
  near(at(0), 1, 1e-9);
  for (let e = 0; e < 4; e += 0.25) assert.ok(at(e) <= at(e + 0.25) + 1e-12, `monotonic at ${e}`);
  assert.equal(paceTarget({ action: { id: 'knife', rate: 1, eta: 0 } }).why, 'knife');
  near(paceTarget({ action: { id: 'use', rate: ACTION_RATE.use, eta: 0 } }).rate, 1, 1e-9, 'the clothesline take (use): 1×, as a kill');
  // the key actions and their rates (what the films slowed for; the M3 review: the clothesline take too)
  for (const id of ['knife', 'harpoon', 'pistol', 'sniper', 'timeBomb', 'remoteBomb', 'uniform', 'handcuff', 'syringe', 'use', 'cutters', 'trap']) assert.equal(ACTION_RATE[id], 1, id);
  for (const id of ['decoyToggle', 'distract']) assert.equal(ACTION_RATE[id], 1.5, id);
  for (const id of ['shovel', 'dive', 'climb', 'leaveVehicle']) assert.equal(ACTION_RATE[id], undefined, `${id} is not a moment`);
  assert.equal(ACTION_RATE.raft, 1, 'the raft inflated / folded is watched');
});

test('auto pace: ½× around a blast (from 0.8 s before the fuse runs out to 3 s after) and for the climax', () => {
  assert.equal(paceTarget({ fuse: 20 }).rate, 4, 'a long fuse: no hurry yet');
  near(paceTarget({ fuse: 0.8 }).rate, 0.5, 1e-9);
  near(paceTarget({ fuse: 2.8 }).rate, 1.5, 1e-9);
  assert.equal(paceTarget({ fuse: 0.8 }).why, 'charge');
  near(paceTarget({ blastAgo: 0 }).rate, 0.5, 1e-9);
  near(paceTarget({ blastAgo: 3 }).rate, 0.5, 1e-9);
  near(paceTarget({ blastAgo: 5 }).rate, 1.5, 1e-9, 'then eased back up');
  assert.equal(paceTarget({ blastAgo: 20 }).rate, 4);
  near(paceTarget({}, { climax: true }).rate, AUTO_PACE.climax, 1e-9);
  assert.equal(AUTO_PACE.climax, 0.5);
  assert.equal(paceTarget({ fuse: 0 }, { climax: true }).rate, AUTO_PACE.min, 'never under ½×');
  // the climax: the escape after the last blast, in the last chapter (M3: the dam blows 3.5 s before chapter J, the
  // truck comes in and the men board for 11 s), for 15 s at most
  assert.ok(inClimax(2966.1, 2966.1, 2962.6) && inClimax(2976.9, 2966.1, 2962.6), 'M3: chapter J after the dam blast');
  assert.ok(!inClimax(2978, 2966.1, 2962.6), '… for 15 s after the blast');
  assert.ok(!inClimax(2960, null, 2950), 'not before the last chapter');
  assert.ok(!inClimax(100, 50, null), 'the last chapter without a blast: no climax');
  assert.ok(!inClimax(100, 50, 30), 'a blast long before the last chapter: no climax');
  assert.ok(inClimax(310, 0, 304.1), 'a blast inside a long last chapter');
});

test('auto pace: events, striking distance, near misses, the step\'s subject, captions', () => {
  near(paceTarget({ windows: [{ rate: EVENT_WINDOWS.kill[1], why: 'kill', left: 1 }] }).rate, 1, 1e-9, 'after a kill');
  near(paceTarget({ windows: [{ rate: 1, why: 'kill', left: -0.5 }] }).rate, 2, 1e-9, 'then eased back up, briskly (no dead air)');
  assert.equal(paceTarget({ windows: [{ rate: 1, why: 'kill', left: -1.5 }] }).rate, 4);
  assert.equal(paceTarget({ windows: [{ rate: 1, why: 'kill' }, { rate: 1.5, why: 'beat' }] }).why, 'kill');
  near(paceTarget({ near: 2 }).rate, 2, 1e-9, 'beside a guard');
  assert.equal(paceTarget({ near: 6 }).rate, 4);
  near(paceTarget({ cone: 0 }).rate, 1.5, 1e-9, 'a cone touching a man');
  near(paceTarget({ cone: 0, turning: true }).rate, 1.125, 1e-9, '… turning to him');
  near(paceTarget({ cone: 1.5 }).rate, 2.75, 1e-9);
  assert.equal(paceTarget({ cone: 3 }).rate, 4);
  near(paceTarget({ subject: 3 }).rate, 1.5, 1e-9, 'closing in on the step\'s guard');
  near(paceTarget({ subject: 7.5 }).rate, 2.75, 1e-9);
  assert.equal(paceTarget({ subject: 12 }).rate, 4);
  near(paceTarget({ object: 2 }).rate, 1.5, 1e-9, 'the step\'s man beside the thing it names: about to act on it');
  assert.equal(paceTarget({ object: 2 }).why, 'at it');
  assert.equal(paceTarget({ object: 5 }).rate, 4);
  near(paceTarget({}, { reading: 3 }).rate, 2.5, 1e-9, 'a caption being read');
  assert.equal(paceTarget({}, { reading: -1 }).rate, 4, 'read');
  // the slowest wins
  near(paceTarget({ near: 2, action: { id: 'knife', rate: 1, eta: 1.1 }, windows: [{ rate: 1.75, why: 'beat' }] }, { reading: 2 }).rate, 1.5, 1e-9);
  // reading time: 1 s + 1 s per 26 characters, 2.5–7 s
  assert.equal(readTime(''), 0);
  near(readTime('x'.repeat(10)), 2.5, 1e-9);
  near(readTime('x'.repeat(78)), 4, 1e-9);
  near(readTime('x'.repeat(240)), 7, 1e-9);
});

test('auto pace: the speed eases (no jump, no overshoot): 4× → 1× in under a second, 1× → 4× in about one', () => {
  const ap = new AutoPace(4);
  const down = run(ap, 1, 1.2);
  assert.ok(down[0] > 3.9, `no jump on the first frame (${down[0]})`);
  assert.ok(down[Math.round(0.25 * 60)] > 1.6, `still easing at 0.25 s (${down[15]})`);
  assert.ok(down[59] < 1.15, `about 1× after a second (${down[59]})`);
  assert.ok(Math.min(...down) >= 0.99, `no undershoot (${Math.min(...down)})`);
  for (let i = 1; i < down.length; i++) assert.ok(Math.abs(Math.log2(down[i] / down[i - 1])) < 0.12, `smooth at frame ${i}`);
  const up = new AutoPace(1);
  const r = run(up, 4, 2);
  assert.ok(r[0] < 1.05 && r[Math.round(0.3 * 60)] < 2.6, `eases up (${r[0]}, ${r[18]})`);
  assert.ok(r[Math.round(1.2 * 60)] > 3.5, `near 4× within ~1.2 s (${r[72]})`);
  assert.ok(Math.max(...r) <= 4 + 1e-9, 'no overshoot');
  for (let i = 1; i < r.length; i++) assert.ok(Math.abs(Math.log2(r[i] / r[i - 1])) < 0.12, `smooth at frame ${i}`);
});

test('auto pace: a slow-down holds the next speed-up (no pumping), the ceiling always wins', () => {
  const ap = new AutoPace(1);
  const r = run(ap, (t) => (Math.floor(t / 0.2) % 2 ? 1 : 4), 4);
  assert.ok(Math.max(...r) < 1.6, `a flickering moment keeps it slow (${Math.max(...r).toFixed(2)})`);
  const c = new AutoPace(4);
  const r2 = run(c, 8, 1, 4);
  assert.ok(Math.max(...r2) <= 4 + 1e-9, 'under the ceiling');
  const f = new AutoPace(8);
  const r5 = run(f, 8, 1.2, 4); // (the frame rate dropped: the ceiling fell to 4×)
  assert.ok(r5[0] > 7.8 && r5[r5.length - 1] < 4.2, `eased down under a falling ceiling, no jump (${r5[0].toFixed(2)} → ${r5[r5.length - 1].toFixed(2)})`);
  const d = new AutoPace(4);
  run(d, 1, 0.25); // (a short slow moment, just ended)
  const r0 = d.rate;
  const r3 = run(d, 4, 0.45);
  assert.ok(Math.max(...r3) <= r0 + 1e-9, `the speed-up waits ~0.5 s after a slow-down (${r0.toFixed(2)} → ${Math.max(...r3).toFixed(2)})`);
  const r4 = run(d, 4, 1.5);
  assert.ok(r4[r4.length - 1] > 3.5, 'then it rises');
  const e = new AutoPace(2);
  e.reset(1);
  assert.equal(e.rate, 1);
  assert.equal(e.step(4, 0), 1, 'no time, no change');
});

test('auto pace: the frame-rate ceiling — 8× only while frames are quick and ticks cheap; 4× at once when frames slow', () => {
  const pc = new PerfCeiling();
  assert.equal(pc.ceiling, 4);
  for (let i = 0; i < 900; i++) pc.frame(1 / 60, 0.2);
  near(pc.ceiling, 8, 1e-9, 'fast frames, cheap ticks: 8×');
  for (let i = 0; i < 90; i++) pc.frame(1 / 25, 0.2);
  assert.equal(pc.ceiling, 4, 'slow frames: back to 4×');
  const heavy = new PerfCeiling();
  for (let i = 0; i < 600; i++) heavy.frame(1 / 60, 2.5);
  assert.equal(heavy.ceiling, 4, 'expensive ticks: 4× (8 ms of ticks a frame would not reach more)');
  const mid = new PerfCeiling();
  for (let i = 0; i < 1200; i++) mid.frame(1 / 60, 1.25);
  near(mid.ceiling, 6.4, 0.05, '8 ms / 1.25 ms per tick → 6.4×');
});

test('auto pace: ticks per frame follow the eased speed — no burst after a long frame, no jump while easing', () => {
  // the walkthrough's loop: AutoPace → pacer.boost on a 1× pacer, the grant for a steady frame time (SteadyGrant)
  const pacer = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [0.5, 1, 2, 4] });
  const ap = new AutoPace(1), grant = new SteadyGrant();
  const perFrame = [];
  const frame = (dt, target) => {
    pacer.boost = ap.step(target, dt, 4);
    pacer.frame(grant.frame(dt), 0);
    let n = 0;
    while (pacer.canTick(0)) { pacer.take(); n++; }
    perFrame.push(n);
    return n;
  };
  for (let i = 0; i < 120; i++) frame(1 / 60, 4); // easing 1× → 4×
  let jump = 0;
  for (let i = 1; i < perFrame.length; i++) jump = Math.max(jump, Math.abs(perFrame[i] - perFrame[i - 1]));
  assert.ok(jump <= 1, `while easing, the ticks per frame change by one at most (${perFrame.slice(0, 60).join('')})`);
  assert.equal(perFrame[perFrame.length - 1], 4, '4× = 4 ticks a frame at 60 fps');
  const hitch = frame(0.25, 4); // a quarter-second frame (a shader compile)
  assert.ok(hitch <= 5, `no catch-up burst after the hitch (${hitch} ticks; a raw 4× grant would be 60)`);
  const after = [frame(1 / 60, 4), frame(1 / 60, 4), frame(1 / 60, 4)];
  assert.ok(Math.max(...after) <= 5, `and none on the frames after (${after})`);
  // a sustained slower frame rate is followed: 30 fps at 4× = 8 ticks a frame within a second
  for (let i = 0; i < 40; i++) frame(1 / 30, 4);
  assert.equal(perFrame[perFrame.length - 1], 8);
});

test('auto pace: a true wait is the solution waiting with nobody acting and nothing to slow for', () => {
  assert.ok(isTrueWait({ motion: 'idle' }, { why: 'idle' }, { waiting: 'e19 down his beat' }));
  assert.ok(!isTrueWait({ motion: 'idle' }, { why: 'idle' }, { waiting: null }), 'the solution is not waiting (planning, an order)');
  assert.ok(!isTrueWait({ motion: 'idle' }, { why: 'idle' }, { waiting: 'x', busy: true }), 'a man acts');
  assert.ok(!isTrueWait({ motion: 'crawl' }, { why: 'crawl' }, { waiting: 'x' }), 'a man moves');
  for (const why of ['caption', 'cone', 'closing in', 'kill', 'charge', 'climax']) assert.ok(!isTrueWait({ motion: 'idle' }, { why }, { waiting: 'x' }), `${why}: not a true wait`);
});

// ------------------------------------------------------------------ the sensor, on a small fake world

const vision = (far = 36) => ({ fov: 70 * DEG, fovDeg: 70, far, near: far / 2, range: far, nearRange: far / 2, sweep: 0, sweepDeg: 0, period: 5, elliptical: false, ellipseRatio: 0.5, eyeHeight: 1.7, phase: 0 });
function fakeWorld() {
  const w = { time: 0, events: new EventBus(), commandos: [], enemies: [], interactables: [], vehicles: [], objectives: [],
    grid: { lineOfSight: () => true }, mission: { rules: {} } };
  const man = (role, x, z, o = {}) => ({ kind: 'commando', role, id: role, x, z, y: 0, alive: true, stance: 'stand', isVisibleToEnemies: true, isLow: false, world: w, ...o });
  const guard = (tag, x, z, heading, o = {}) => ({ kind: 'enemy', tag, id: tag, x, z, y: 0, heading, alive: true, vision: vision(), brain: { isAware: () => false }, world: w, ...o });
  return { w, man, guard };
}
/** advance the fake world by `sec` in steps of 1/60 s, calling `move` each step, sampling the sensor every step */
const advance = (S, w, sec, move = () => {}, ctx = {}) => { let s; for (let i = 0; i < Math.round(sec * 60); i++) { w.time += 1 / 60; move(1 / 60); s = S.sample(w.time, ctx); } return s; };

test('auto pace sensor: who moves (walk / crawl / idle), a walk-up to a knife, a charge\'s fuse', () => {
  const { w, man, guard } = fakeWorld();
  const gb = man('greenberet', 0, 0), sp = man('sapper', 50, 50);
  w.commandos.push(gb, sp);
  const S = new PaceSensor(w).attach();
  assert.equal(advance(S, w, 1).motion, 'idle');
  assert.equal(advance(S, w, 1.2, (dt) => { gb.x += 2.25 * dt; }).motion, 'walk');
  gb.stance = 'crawl';
  assert.equal(advance(S, w, 1.2, (dt) => { gb.x += 0.9 * dt; }).motion, 'crawl');
  gb.stance = 'stand';
  const e5 = guard('e5', gb.x + 5.5, 0, Math.PI); // (facing him: irrelevant to a knife's walk-up)
  w.enemies.push(e5);
  gb.pendingAbility = { def: { id: 'knife' }, target: e5, run: false, lastTp: { x: e5.x, z: e5.z } };
  let s = S.sample(w.time);
  assert.equal(s.action?.id, 'knife');
  near(s.action.eta, (5.5 - 1) / 2.25, 1e-6, 'seconds to the stab at walking pace');
  gb.pendingAbility = null;
  w.interactables.push({ interactKind: 'bomb', fuse: 6.5, x: 3, z: 3 }, { interactKind: 'bomb', fuse: Infinity, x: 9, z: 9 }, { interactKind: 'bomb', fuse: 2, exploded: true, x: 1, z: 1 });
  s = S.sample(w.time);
  near(s.fuse, 6.5, 1e-9, 'the nearest live fuse');
  S.detach();
});

test('auto pace sensor: kills, blasts, objectives… open their windows; a key action under way is a moment for 1.5 s', () => {
  const { w, man, guard } = fakeWorld();
  const gb = man('greenberet', 0, 0);
  const e1 = guard('e1', 2, 0, 0);
  w.commandos.push(gb);
  w.enemies.push(e1);
  const S = new PaceSensor(w).attach();
  w.time = 10;
  w.events.emit('unit:killed', { unit: e1 });
  let s = S.sample(10.5);
  assert.deepEqual(s.windows.map((x) => [x.why, x.rate]), [['kill', 1]]);
  near(S.sample(12).windows[0].left, -0.5, 1e-9, 'the kill window is 1.5 s, then eases out');
  assert.equal(S.sample(15.5).windows.length, 0, 'and is gone');
  w.time = 20;
  w.events.emit('explosion', { x: 5, z: 5 });
  near(S.sample(21).blastAgo, 1, 1e-9);
  w.events.emit('alarm:start', {});
  assert.ok(S.sample(21).windows.some((x) => x.why === 'alarm' && x.rate === 1));
  gb.currentAction = {};
  gb.currentActionId = 'timeBomb';
  w.time = 30;
  w.events.emit('ability:start', { unit: gb, id: 'timeBomb' });
  assert.equal(S.sample(30.5).action?.id, 'timeBomb');
  assert.equal(S.sample(32).action, null, 'under way after 1.5 s');
  S.detach();
  w.time = 40;
  w.events.emit('unit:killed', { unit: e1 });
  assert.equal(S.sample(40.1).windows.length, 0, 'detached: no more windows');
});

test('auto pace sensor: a near miss is a man at work about to enter a cone (the AI\'s own rule); a man lying still is dead time', () => {
  const { w, man, guard } = fakeWorld();
  const e = guard('e9', 0, 0, 0); // looking along +x, 70° aperture, 36 m
  const gb = man('greenberet', 20, 20 * Math.tan(37 * DEG)); // 2° outside the cone's edge at ~25 m: ~0.9 m off
  w.enemies.push(e);
  w.commandos.push(gb);
  const S = new PaceSensor(w);
  let s = advance(S, w, 1.2);
  assert.equal(s.cone, Infinity, 'lying still by the cone: dead time');
  s = advance(S, w, 1.2, (dt) => { gb.x += 0.2 * dt; gb.z = gb.x * Math.tan(37 * DEG); });
  assert.ok(s.cone <= 1.5, `moving along its edge: a near miss (${s.cone})`);
  gb.disguised = true;
  s = advance(S, w, 0.6, (dt) => { gb.x += 0.2 * dt; gb.z = gb.x * Math.tan(37 * DEG); });
  assert.equal(s.cone, Infinity, 'the Spy in uniform is never a near miss');
  gb.disguised = false;
  gb.isVisibleToEnemies = false; // (dug in, under water)
  s = advance(S, w, 0.6, (dt) => { gb.x += 0.2 * dt; gb.z = gb.x * Math.tan(37 * DEG); });
  assert.equal(s.cone, Infinity, 'a man the guard cannot see is no near miss');
  gb.isVisibleToEnemies = true;
  gb.x = 10; gb.z = 10 * Math.tan(60 * DEG); // far off the edge
  s = advance(S, w, 0.6, (dt) => { gb.x += 0.2 * dt; gb.z = gb.x * Math.tan(60 * DEG); });
  assert.equal(s.cone, Infinity, 'well clear of the cone');
  // striking distance and the step's subject: men at work only
  gb.x = 1.5; gb.z = -3;
  s = advance(S, w, 0.6, (dt) => { gb.z += 0.5 * dt; }, { actors: [gb], subjects: [e] });
  assert.ok(s.near < 3.5 && s.subject < 3.5, `beside the step's guard (${s.near}, ${s.subject})`);
  s = advance(S, w, 1.2, () => {}, { actors: [gb], subjects: [e] });
  assert.ok(s.near === Infinity && s.subject === Infinity, 'still: dead time');
});

test('auto pace sensor: reading the game writes nothing to it (the pacing never changes the run)', () => {
  const { w, man, guard } = fakeWorld();
  const gb = man('greenberet', 5, 1), sp = man('spy', 30, 30, { disguised: true });
  const e = guard('e2', 0, 0, 0);
  w.commandos.push(gb, sp);
  w.enemies.push(e);
  w.interactables.push({ interactKind: 'bomb', fuse: 4, x: 3, z: 3 }, { interactKind: 'trap', sprung: false, x: 8, z: 0 });
  gb.pendingAbility = { def: { id: 'knife' }, target: e, lastTp: { x: 0, z: 0 } };
  // (`_postOwner`: perception's own memo of a guard's post, which the AI's perception and the solution driver's exposure
  // watch fill in on every tick anyway)
  const snap = () => JSON.stringify({ c: w.commandos, e: w.enemies, i: w.interactables, t: w.time }, (k, v) => (['world', 'brain', 'target', '_postOwner'].includes(k) ? undefined : v));
  const before = snap();
  const S = new PaceSensor(w).attach();
  for (let i = 0; i < 30; i++) S.sample(w.time + i * 0.1, { actors: [gb], subjects: [e] });
  assert.equal(snap(), before);
  S.detach();
});

test('auto pace: a quiet stretch, then a knife — the curve speeds up, eases down to 1× at the stab, and back up after', () => {
  // the walkthrough's loop, offline: game ticks at 1/60 s, wall time per tick = dt / speed
  const ap = new AutoPace(1);
  const KILL = 40, WALK0 = 34; // the order at 34 s, 6.75 m from the guard at walking pace: the stab at ~37 s, dead at 40 s
  let t = 0, wall = 0;
  const rates = [];
  while (t < 50) {
    const sig = { motion: t < 30 ? 'idle' : 'walk', windows: [] };
    if (t >= WALK0 && t < KILL) sig.action = { id: 'knife', rate: 1, eta: Math.max(0, KILL - 3 - t) };
    if (t >= KILL && t < KILL + EVENT_WINDOWS.kill[0]) sig.windows.push({ rate: 1, why: 'kill' });
    const r = ap.rate;
    ap.step(paceTarget(sig).rate, (1 / 60) / r, 4);
    wall += (1 / 60) / r;
    rates.push([t, r]);
    t += 1 / 60;
  }
  const at = (s) => rates.find(([x]) => x >= s)[1];
  assert.ok(at(25) > 3.9, `quiet: 4× (${at(25)})`);
  assert.ok(at(WALK0 + 1) < at(WALK0) && at(KILL - 3) < 1.25, `eased down into the stab (${at(WALK0).toFixed(2)} → ${at(WALK0 + 1).toFixed(2)} → ${at(KILL - 3).toFixed(2)})`);
  assert.ok(at(KILL + 1) < 1.1, `1× just after the kill (${at(KILL + 1)})`);
  assert.ok(at(49) > 3.5, `back up to 4× (${at(49)})`);
  assert.ok(wall < 50 / 2, `the stretch plays in well under real time (${wall.toFixed(1)} s for 50 s)`);
});
