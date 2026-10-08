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
