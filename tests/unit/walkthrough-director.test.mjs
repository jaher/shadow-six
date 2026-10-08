/**
 * Debug VIDEO MODE camera director maths (src/debug/walkthrough-director.js) and its pacing (TickPacer speeds / skip
 * waits boost, src/debug/solution-replay.js): framing puts every point inside the free rectangle, centred; the acting
 * men win when everything does not fit; the free rectangle avoids the HUD's corner block; the spring settles.
 */
import { test, assert, near } from './lib.mjs';
import { framePoints, frameWithPriority, freeRect, screenMetres, spring } from '../../src/debug/walkthrough-director.js';
import { TickPacer } from '../../src/debug/solution-replay.js';
import { WALK_SPEEDS, SKIP_BOOST } from '../../src/debug/walkthrough.js';

const deg = (d) => (d * Math.PI) / 180;
/** Screen px of world point p for a camera at target (tx, tz) / zoom, as CameraController projects it (orthographic). */
function project(p, view, t, zoom) {
  const ppm = 40 * zoom, a = screenMetres(p, view.az, view.el), c = screenMetres({ x: t.x, y: 0, z: t.z }, view.az, view.el);
  return { x: view.width / 2 + (a.u - c.u) * ppm, y: view.height / 2 + (a.w - c.w) * ppm };
}

test('framePoints: every point inside the free rectangle, the box centred in it, at any yaw / pitch', () => {
  for (const [az, el] of [[0, 40], [15, 40], [-30, 64], [45, 55]]) {
    const view = { az: deg(az), el: deg(el), width: 1280, height: 720 };
    const rect = { x: 160, y: 130, w: 900, h: 380 };
    const pts = [{ x: 100, y: 0, z: 40 }, { x: 112, y: 2, z: 47 }, { x: 95, y: 7, z: 52 }];
    const f = framePoints(pts, view, rect);
    assert.ok(f.fit, `${az}/${el} fits`);
    const s = pts.map((p) => project(p, view, f, f.zoom));
    for (const q of s) assert.ok(q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h, `${az}/${el}: ${JSON.stringify(q)} in the rect`);
    const cx = (Math.min(...s.map((q) => q.x)) + Math.max(...s.map((q) => q.x))) / 2, cy = (Math.min(...s.map((q) => q.y)) + Math.max(...s.map((q) => q.y))) / 2;
    near(cx, rect.x + rect.w / 2, 0.5, 'centred x');
    near(cy, rect.y + rect.h / 2, 0.5, 'centred y');
  }
});

test('framePoints: one man is shown with ground around him (min span), zoom kept in its range', () => {
  const view = { az: deg(15), el: deg(40), width: 1280, height: 720 };
  const f = framePoints([{ x: 50, y: 0, z: 50 }], view, { x: 0, y: 100, w: 1280, h: 500 });
  assert.ok(f.zoom <= 1.35 && f.zoom >= 0.42);
  const g = framePoints([{ x: 0, y: 0, z: 0 }, { x: 300, y: 0, z: 300 }], view, { x: 0, y: 100, w: 1280, h: 500 });
  assert.ok(!g.fit && Math.abs(g.zoom - 0.42) < 1e-9, 'too wide: the widest zoom, not fitted');
});

test('frameWithPriority: when all cannot fit, the acting men stay in the picture', () => {
  const view = { az: deg(15), el: deg(64), width: 839, height: 412 };
  const rect = { x: 6, y: 111, w: 557, h: 176 };
  const actor = { x: 101, y: 0, z: 14.6 }, far = { x: 77, y: 0, z: 35.5 };
  const f = frameWithPriority([actor, far], 1, view, rect);
  const q = project(actor, view, f, f.zoom);
  assert.ok(q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h, `the actor is in the free rect (${JSON.stringify(q)})`);
});

test('freeRect: the larger of "above the HUD block" and "beside it"', () => {
  const desk = freeRect({ width: 1280, height: 720, top: 130, bottom: 150, right: 60, block: { x: 935, y: 497, w: 345, h: 224 } });
  assert.deepEqual([desk.x, desk.y, desk.w, Math.round(desk.h)], [0, 130, 1220, 367], 'desktop: full width above the knapsack');
  const land = freeRect({ width: 839, height: 412, top: 111, bottom: 80, right: 42, block: { x: 563, y: 233, w: 276, h: 179 } });
  assert.deepEqual([land.x, land.w], [0, 563], 'phone landscape: beside the knapsack');
});

test('spring: settles on the target without overshoot, from any start', () => {
  let x = 0, v = 0;
  let maxX = 0;
  for (let i = 0; i < 180; i++) { [x, v] = spring(x, v, 10, 3.2, 1 / 60); maxX = Math.max(maxX, x); }
  near(x, 10, 0.05, 'settled in 3 s');
  assert.ok(maxX <= 10 + 1e-6, 'no overshoot');
});

test('video mode pace: ½× to 4×, skip waits raises it, the pacer refuses other speeds', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: WALK_SPEEDS });
  assert.equal(p.speed, 1);
  let ticks = 0;
  const run = (frames, dt) => { for (let f = 0; f < frames; f++) { p.frame(dt, f * dt * 1000); while (p.canTick(0)) { p.take(); ticks++; } } };
  for (const s of WALK_SPEEDS) { p.setSpeed(s); ticks = 0; run(60, 1 / 60); near(ticks, 60 * s, 1, `${s}x`); }
  p.setSpeed(8);
  assert.equal(p.speed, 4, '8x is not a walkthrough speed');
  p.setSpeed(1); p.boost = SKIP_BOOST; ticks = 0; run(60, 1 / 60);
  near(ticks, 60 * SKIP_BOOST, 1, 'skip waits: 4x the chosen speed');
  assert.equal(p.rate, SKIP_BOOST);
});
