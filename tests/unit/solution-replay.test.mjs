/**
 * Debug SOLUTION replay, pure parts: the solution registry (every tools/solutions/*.solution.mjs is playable from the
 * debug select, and bundled), the tick pacer (1× = real time, 8× cap, fast-forward by wall time) and the driver's
 * stop (no order reaches the game once a replay is stopped, even through a solution's own try/catch).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, near } from './lib.mjs';
import { catalogFromFiles, _setCatalog, hasSolution, solutionIds } from '../../src/debug/solutions.js';
import { TickPacer, SPEEDS, TURBO_MS, describeOrder } from '../../src/debug/solution-replay.js';
import { makeDriver, SolutionAborted } from '../../tools/solutions/driver.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every saved solution is in the debug catalog with nothing to register (the folder is the catalog; bundled by glob)', async () => {
  const names = readdirSync(join(ROOT, 'tools/solutions'));
  const files = names.filter((f) => f.endsWith('.solution.mjs')).map((f) => f.replace('.solution.mjs', ''));
  assert.ok(files.includes('m03'));
  const cat = catalogFromFiles(names);
  assert.deepEqual(cat.map((e) => e.id), [...files].sort());
  _setCatalog(cat);
  try {
    assert.deepEqual([...solutionIds()].sort(), [...files].sort());
    assert.ok(hasSolution('m03') && !hasSolution('m01x') && !hasSolution(null) && !hasSolution('toString'));
    const src = readFileSync(join(ROOT, 'src/debug/solutions.js'), 'utf8');
    // esbuild bundles every file a template-literal import() can reach (glob import): one pattern covers them all
    assert.ok(src.includes('import(`../../tools/solutions/${id}.solution.mjs`)'), 'glob import of the solutions');
    assert.ok(src.includes('import(`../../tools/solutions/${id}.walkthrough.mjs`)'), 'glob import of the walkthroughs');
    assert.ok(/__SS_SOLUTIONS__/.test(readFileSync(join(ROOT, 'tools/build/build.mjs'), 'utf8')), 'the web build bakes the catalog in');
    const mod = await import('../../tools/solutions/m03.solution.mjs');
    assert.equal(typeof mod.solve, 'function');
    assert.ok(/^[A-Z]+$/.test(mod.STAGES.map((s) => s[0]).join('')));
    for (const [, title, fn] of mod.STAGES) assert.ok(typeof title === 'string' && title && typeof fn === 'function');
  } finally { _setCatalog(null); }
});

test('the driver is browser-pure: no node-only (headless) import left in driver.mjs', () => {
  const src = readFileSync(join(ROOT, 'tools/solutions/driver.mjs'), 'utf8');
  assert.ok(!/import\(['"]\.\/headless/.test(src) && !/from ['"]node:/.test(src));
});

test('pacer: 1x grants one tick per 1/60 s of real time, Nx N times that, capped per frame', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8 });
  let ticks = 0;
  const run = (frames, dt) => { for (let f = 0; f < frames; f++) { p.frame(dt, f * dt * 1000); while (p.canTick(0)) { p.take(); ticks++; } } };
  run(60, 1 / 60);
  near(ticks, 60, 1, '1x, 60 fps, 1 s');
  ticks = 0; run(30, 1 / 30);
  near(ticks, 60, 1, '1x at 30 fps still real time');
  for (const s of SPEEDS) { p.setSpeed(s); ticks = 0; run(60, 1 / 60); near(ticks, 60 * s, 1, `${s}x`); }
  p.setSpeed(3); assert.equal(p.speed, 8, 'only the listed speeds');
  p.setSpeed(1); ticks = 0; run(1, 5); // a 5 s hitch (tab switch): no burst of hundreds of ticks
  assert.ok(ticks <= 8, `hitch capped (${ticks})`);
});

test('pacer: tickMs caps the wall time of one frame\'s ticks; the rest of its budget waits, nothing is lost', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [1, 4, 8], speed: 8, tickMs: 10 });
  p.frame(1 / 60, 0); // 8 ticks granted
  let n = 0, now = 0;
  while (p.canTick(now)) { p.take(now); n++; now += 3; } // 3 ms a tick
  assert.equal(n, 4, `ticks within 10 ms of the frame's first (${n})`);
  assert.ok(p.budget >= 3.99, 'the rest of the budget is kept');
  p.frame(1 / 60, 16);
  now = 16; let m = 0;
  while (p.canTick(now)) { p.take(now); m++; now += 1; }
  assert.equal(m, 10, `next frame: its ticks run while within 10 ms (${m})`);
  const q = new TickPacer({ simDt: 1 / 60, speeds: [1, 8], speed: 8 }); // default: no cap
  q.frame(1 / 60, 0); let k = 0;
  while (q.canTick(0)) { q.take(1e6 * k); k++; }
  assert.equal(k, 8, 'no cap by default');
});

test('pacer: endFrame ends this frame\'s ticks; the next frame goes on with the rest of the budget (fast-forward unaffected)', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: [1, 4], speed: 4 });
  p.frame(2 / 60, 0); // 8 ticks granted
  let n = 0;
  while (p.canTick(0)) { p.take(0); n++; if (n === 3) p.endFrame(); }
  assert.equal(n, 3, 'the frame stops at the tick that ended it');
  assert.ok(p.budget >= 4.99, `the rest kept (${p.budget})`);
  p.frame(1 / 60, 16);
  let m = 0;
  while (p.canTick(16)) { p.take(16); m++; }
  assert.equal(m, 9, `next frame: the rest and its own grant (${m})`);
  p.setTurbo(true); p.frame(1 / 60, 32); p.endFrame();
  assert.equal(p.canTick(33), true, 'a fast-forward runs by wall time');
});

test('pacer: paused grants nothing; fast-forward runs by wall time per frame', () => {
  const p = new TickPacer({ simDt: 1 / 60 });
  p.paused = true;
  p.frame(1, 0);
  assert.equal(p.canTick(0), false);
  p.paused = false;
  p.setTurbo(true);
  p.frame(1 / 60, 1000);
  assert.ok(p.canTick(1000) && p.canTick(1000 + TURBO_MS - 1) && !p.canTick(1000 + TURBO_MS));
  for (let i = 0; i < 1000; i++) p.take();
  assert.ok(p.canTick(1001), 'fast-forward is not counted in ticks');
  p.setTurbo(false);
  assert.ok(!p.canTick(1001), 'back to the frame budget');
});

test('captions describe the orders', () => {
  const gb = { role: 'greenberet', stance: 'crawl' };
  assert.equal(describeOrder(gb, { type: 'move', x: 82.5, z: 30 }), 'Green Beret: crawl to 83, 30');
  assert.equal(describeOrder({ role: 'diver' }, { type: 'ability', id: 'harpoon', target: { tag: 'e3' } }), 'Marine: harpoon → e3');
  assert.equal(describeOrder({ role: 'spy' }, { type: 'ability', id: 'leaveVehicle', target: { role: 'spy' } }), 'Spy: leave vehicle → spy');
  assert.equal(describeOrder({ role: 'sapper' }, { type: 'stance', stance: 'stand' }), 'Sapper: stand up');
});

/** A world just big enough for the driver. */
function fakeWorld() {
  const issued = [];
  const c = { role: 'greenberet', x: 0, z: 0, alive: true, stance: 'stand', issue(o) { issued.push(o); return true; } };
  const w = { time: 0, commandos: [c], enemies: [], vehicles: [], interactables: [], objectives: [], events: { on: () => () => {} } };
  return { w, c, issued };
}

test('driver: once aborted, ticks and orders throw SolutionAborted — even after a solution swallows one', async () => {
  const { w, issued } = fakeWorld();
  let stop = false, steps = 0;
  const seen = [];
  const D = makeDriver(w, { step: () => { steps++; w.time += 1 / 60; }, quiet: true, log: () => {}, aborted: () => stop,
    onOrder: (role, u, o) => seen.push(`${role}:${o.type}`) });
  D.order('greenberet', { type: 'move', x: 1, z: 1 });
  assert.deepEqual(seen, ['greenberet:move']);
  await D.wait(0.5);
  assert.equal(steps, 30);
  stop = true;
  await assert.rejects(D.wait(1), SolutionAborted);
  try { await D.wait(1); } catch { /* a solution's own `try { await D.face(…) } catch {}` */ }
  assert.throws(() => D.order('greenberet', { type: 'move', x: 2, z: 2 }), SolutionAborted);
  await assert.rejects(D.stance('greenberet', 'crawl'), SolutionAborted);
  assert.equal(issued.length, 1, 'no order after the stop');
  assert.equal(steps, 30, 'no tick after the stop');
});

test('driver: a promise step (the live replay waits for the next frame) is awaited in order', async () => {
  const { w } = fakeWorld();
  const log = [];
  const D = makeDriver(w, { step: () => new Promise((r) => setTimeout(() => { w.time += 1 / 60; log.push(w.time); r(); }, 0)), quiet: true, log: () => {} });
  await D.until(() => w.time > 0.1, 1, 'time');
  assert.equal(log.length, 7);
});

test('replay: a section the solution marks unpaced (two flows of its own stepping the world in turn) ticks at once, interleaving as the logic run does; the paced step parks one flow at a time', async () => {
  const { SolutionReplay } = await import('../../src/debug/solution-replay.js');
  /** the M4 bridgehead pattern: flow B started inside flow A, both stepping until each is done; the (flow, tick) log */
  const play = async (makeStep, onDriver = () => {}) => {
    const { w } = fakeWorld();
    w.tick = 0;
    const order = [];
    const D = makeDriver(w, { step: makeStep(w), quiet: true, log: () => {}, watch: false });
    onDriver(D);
    const flow = (name, n) => D.until(() => { order.push(`${name}${w.tick}`); return order.filter((s) => s.startsWith(name)).length > n; }, 5, name);
    D.unpaced = true;
    try {
      const b = (async () => { await flow('b', 4); await D.wait(2 / 60); await flow('b', 7); })();
      await flow('a', 6);
      await b;
    } finally { D.unpaced = false; }
    return { order: order.join(' '), D };
  };
  // the logic run: every step at once
  const logic = await play((w) => () => { w.time += 1 / 60; w.tick++; });
  // a live replay with no frame budget at all: only the unpaced section can tick
  let rp = null;
  let timer = null;
  const live = await Promise.race([play((w) => {
    rp = new SolutionReplay({ world: w, input: {}, state: 'playing', step(dt) { w.time += dt; w.tick++; } }, { id: 'm04', stages: [] });
    return () => rp._step();
  }, (D) => { rp.driver = D; }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('the flows never finish: a parked flow is never woken')), 2000); })]);
  clearTimeout(timer);
  assert.equal(live.order, logic.order, 'the same flows on the same ticks');
  // (outside such a section a replay with no budget parks the flow until a frame grants a tick)
  live.D.unpaced = false;
  const r = rp._step();
  assert.ok(r && typeof r.then === 'function', 'paced: waits for a frame');
});

test('replay: a tick that set off an explosion ends its frame\'s ticks and the next frame only draws; the frame after goes on (one held frame per HOLD_GAP_MS, none while fast-forwarding)', async () => {
  const { SolutionReplay } = await import('../../src/debug/solution-replay.js');
  const { EventBus } = await import('../../src/core/events.js');
  const { w } = fakeWorld();
  const ev = new EventBus();
  ev.deferring = true; // (Game.step deferVisuals: the blast's visuals wait for the next frame)
  let drawn = 0;
  ev.onLate('explosion', () => { drawn++; });
  ev.onLate('shot', () => {});
  const booms = new Set([6, 20]), log = [];
  w.tick = 0;
  const game = { world: w, input: {}, state: 'playing', events: ev,
    step(dt) { w.time += dt; w.tick++; log.push(w.tick); ev.emit('shot', {}); if (booms.has(w.tick)) ev.emit('explosion', { t: w.tick }); } };
  const rp = new SolutionReplay(game, { id: 'm06', stages: [] }, { speed: 4 });
  rp._camera = rp._caption = rp._syncBar = () => {};
  // one displayed frame: the replay's frame, the game's (its late calls, its draw), then the frame's ticks
  const frame = () => { rp._frame(1 / 60); ev.flushLate(); let n = 0; while (rp._ready()) { rp._tick(); n++; } return n; };
  assert.equal(frame(), 4, '4x: four ticks a frame');
  assert.equal(frame(), 2, 'the frame stops at the tick that set off the explosion (tick 6)');
  assert.equal(drawn, 0);
  assert.equal(frame(), 0, 'the next frame runs no tick: it only draws the blast');
  assert.equal(drawn, 1, 'its late calls (the blast\'s visuals) were made in that frame');
  const n4 = frame();
  assert.ok(n4 >= 4, `the frame after goes on, its grant kept (${n4} ticks)`);
  while (w.tick < 20) frame();
  assert.equal(rp._blastHeld, 0, 'a second blast within HOLD_GAP_MS holds nothing');
  assert.ok(frame() > 0, 'the frame after it runs its ticks');
  assert.deepEqual(log, Array.from({ length: log.length }, (_, i) => i + 1), 'the same ticks, one after the other');
  // (HOLD_GAP_MS later a blast holds again; while fast-forwarding never)
  rp._blastAt = -Infinity;
  booms.add(w.tick + 2);
  const t0 = w.tick;
  frame();
  assert.equal(w.tick, t0 + 2, 'a blast HOLD_GAP_MS after the last hold ends its frame again');
  assert.equal(frame(), 0, 'and holds the next one');
  rp._blastAt = -Infinity;
  rp.pacer.setTurbo(true);
  booms.add(w.tick + 1);
  const t1 = w.tick;
  rp._frame(1 / 60); ev.flushLate();
  for (let i = 0; i < 5 && rp._ready(); i++) rp._tick();
  assert.equal(w.tick, t1 + 5, 'fast-forward: no hold');
});
