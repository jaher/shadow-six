/**
 * Debug info HUD numbers (src/debug/debug-stats.js): rolling window, whole-frame draws / triangles across mid-frame
 * renderer.info resets, input → frame latency, and the HUD text.
 */
import { test, assert, near } from './lib.mjs';
import { RollingWindow, FrameDraws, InputLatency, statsLines, fmtMs, fmtCount, fmtMB } from '../../src/debug/debug-stats.js';

test('debug stats: rolling window avg / p95 / max over the span', () => {
  const w = new RollingWindow(2000);
  assert.equal(w.stats(0), null, 'empty → null');
  for (let i = 0; i < 100; i++) w.push(i * 16, 16); // 1.6 s of 16 ms frames
  w.push(1600, 80); // one hitch
  const s = w.stats(1600);
  assert.equal(s.n, 101);
  assert.equal(s.max, 80);
  assert.equal(s.p95, 16, 'one spike in 101 frames is not the p95');
  near(s.avg, (100 * 16 + 80) / 101, 1e-9);
  assert.equal(s.min, 16);
});

test('debug stats: a spike stays in the max for the whole span, then leaves', () => {
  const w = new RollingWindow(2000);
  let t = 0;
  w.push(t, 120); // the spike
  for (let i = 0; i < 200; i++) { t += 16; w.push(t, 16); }
  assert.equal(w.stats(1999).max, 120, 'still there just under 2 s later (the HUD refreshes every 250 ms)');
  assert.equal(w.stats(2001).max, 16, 'gone once older than the span');
  assert.ok(w.stats(2001).n < 201);
});

test('debug stats: rolling window ring overflow keeps the newest samples', () => {
  const w = new RollingWindow(1e9, 8);
  for (let i = 0; i < 20; i++) w.push(i, i);
  const s = w.stats(20);
  assert.equal(s.n, 8);
  assert.equal(s.min, 12);
  assert.equal(s.max, 19);
  w.clear();
  assert.equal(w.stats(20), null);
});

/** A three.js renderer.info stand-in: draws add to render.calls / triangles, reset() zeroes them. */
function fakeInfo() {
  const info = { render: { calls: 0, triangles: 0, frame: 0 }, memory: { geometries: 0, textures: 0 }, autoReset: false };
  info.reset = function () { this.render.calls = 0; this.render.triangles = 0; };
  info.draw = (calls, tris) => { info.render.calls += calls; info.render.triangles += tris; };
  return info;
}

test('debug stats: FrameDraws counts the passes before a mid-frame reset (water mirror) — whole frame', () => {
  const info = fakeInfo(), fd = new FrameDraws();
  fd.attach(info);
  info.draw(150, 900000); // the previous frame's main pass: still in the counters at the next frame start
  fd.begin();
  info.draw(20, 100000); // map frame: mirror, FFT, trails — before Renderer.render
  info.reset(); // Renderer.render: info.reset() at its start
  info.draw(150, 900000); // shadow, world, post
  const d = fd.end();
  assert.deepEqual(d, { calls: 170, tris: 1000000, preCalls: 20, preTris: 100000 });
  // what renderer.stats() (info after the frame) reports: the main part only
  assert.equal(info.render.calls, 150);
});

test('debug stats: FrameDraws without a reset, with several resets (split views), and outside a frame', () => {
  const info = fakeInfo(), fd = new FrameDraws();
  fd.attach(info);
  info.draw(5, 50);
  fd.begin();
  info.draw(10, 100);
  assert.deepEqual(fd.end(), { calls: 10, tris: 100, preCalls: 0, preTris: 0 }, 'no reset: the delta since begin');
  fd.begin();
  info.draw(3, 30); info.reset(); info.draw(40, 400); info.reset(); info.draw(50, 500);
  assert.deepEqual(fd.end(), { calls: 93, tris: 930, preCalls: 3, preTris: 30 });
  info.draw(7, 70);
  info.reset(); // a reset outside a frame changes nothing
  assert.equal(fd.calls, 93);
});

test('debug stats: FrameDraws follows a new info object (three makes one on a restored context)', () => {
  const a = fakeInfo(), b = fakeInfo(), fd = new FrameDraws();
  fd.attach(a);
  fd.attach(a); // idempotent: one wrapper
  fd.begin(); a.draw(2, 20); a.reset(); a.draw(3, 30);
  assert.equal(fd.end().calls, 5);
  fd.attach(b);
  fd.begin(); a.reset(); b.draw(4, 40); b.reset(); b.draw(6, 60);
  assert.deepEqual(fd.end(), { calls: 10, tris: 100, preCalls: 4, preTris: 40 }, 'the old info no longer counts');
});

test('debug stats: input → frame latency from event.timeStamp to the end of the next drawn frame', () => {
  const L = new InputLatency();
  assert.equal(L.stats(), null);
  assert.equal(L.frame(100), 0, 'a frame without input: no sample');
  L.input(1000, 1004); // event 4 ms old when handled
  assert.equal(L.frame(1031), 1);
  assert.equal(L.stats().last, 31);
  L.input(2000, 2001); L.input(2008, 2009); // two inputs before one frame: one sample each
  assert.equal(L.frame(2030), 2);
  const s = L.stats();
  assert.equal(s.n, 3);
  assert.equal(s.last, 22);
  assert.equal(s.max, 31);
  near(s.avg, (31 + 30 + 22) / 3, 1e-9);
  assert.equal(L.frame(2050), 0, 'each input counts once');
});

test('debug stats: input latency drops stale inputs, fixes bad timestamps, keeps the last N', () => {
  const L = new InputLatency({ keep: 4, staleMs: 1000 });
  L.input(100, 100);
  assert.equal(L.frame(1500), 0, 'a load / hidden tab in between: no sample');
  assert.equal(L.stale, 1);
  L.input(0, 3000); // no timestamp: counted from the handler
  L.input(1e12, 3000); // epoch-ms time base: counted from the handler
  L.frame(3010);
  assert.deepEqual(L.samples, [10, 10]);
  for (let i = 0; i < 10; i++) { L.input(4000 + i * 100, 4000 + i * 100); L.frame(4000 + i * 100 + i); }
  assert.equal(L.stats().n, 4);
  assert.equal(L.stats().max, 9);
  assert.equal(L.stats().p95, 9);
  L.input(9000, 9000);
  L.drop();
  assert.equal(L.frame(9010), 0, 'drop() forgets pending inputs');
});

test('debug stats: number formats', () => {
  assert.equal(fmtMs(16.666), '16.7');
  assert.equal(fmtMs(123.4), '123');
  assert.equal(fmtMs(null), '-');
  assert.equal(fmtMs(NaN), '-');
  assert.equal(fmtCount(999), '999');
  assert.equal(fmtCount(1234), '1.2k');
  assert.equal(fmtCount(1234567), '1.23M');
  assert.equal(fmtCount(170.4), '170');
  assert.equal(fmtMB(400 * 1048576), '400');
  assert.equal(fmtMB(0.5 * 1048576), '0.5');
  assert.equal(fmtMB(undefined), '-');
});

test('debug stats: HUD lines — labelled table, offscreen part, GPU MB, heap only when known; phone-width lines', () => {
  const MB = 1048576;
  const full = statsLines({
    span: 2000,
    frame: { avg: 16.7, p95: 18.9, max: 33.4 }, cpu: { avg: 4.1, p95: 5, max: 6 }, render: { avg: 3.2, p95: 4, max: 5.1 },
    input: { last: 21, avg: 19, p95: 30, max: 34, n: 12 },
    calls: { avg: 170, p95: 182, max: 184 }, tris: { avg: 990000, p95: 1.1e6, max: 1.1e6 }, pre: { calls: 14, tris: 100000 },
    gpu: { tex: 345 * MB, buf: 40 * MB, rb: 10 * MB, fb: 17 * MB, total: 412 * MB },
    three: { textures: 455, geometries: 812 }, heap: { used: 182 * MB },
  });
  const text = full.join('\n');
  assert.match(text, /avg\s+p95\s+max\s+\(2 s\)/);
  assert.match(text, /frame\s+16\.7\s+18\.9\s+33\.4\s+ms\s+FPS 60/);
  assert.match(text, /main cpu\s+4\.1/);
  assert.match(text, /render cpu\s+3\.2/);
  assert.match(text, /input→frame\s+19\.0\s+30\.0\s+34\.0\s+ms\s+last 21\.0 \(12\)/);
  assert.match(text, /draws\s+170\s+182\s+184\s+offscreen 14/);
  assert.match(text, /tris\s+990\.0k\s+1\.10M\s+1\.10M\s+offscreen 100\.0k/);
  assert.match(text, /GPU 412 MB\s+tex 345\s+buf 40\s+rb 10\s+canvas~17/);
  assert.match(text, /three\.js 455 tex\s+812 geo\s+JS heap 182 MB/);
  for (const l of full) assert.ok(l.length <= 52, `fits a 390 px phone at 11 px monospace (${l.length}): ${l}`);
  const none = statsLines({}).join('\n');
  assert.match(none, /frame\s+-\s+-\s+-\s+ms\s+FPS -/);
  assert.match(none, /input→frame\s+-\s+-\s+-\s+ms\s+\(click, tap, key\)/);
  assert.doesNotMatch(none, /GPU|heap|offscreen/);
  const noHeap = statsLines({ three: { textures: 1, geometries: 2 }, heap: null }).join('\n');
  assert.match(noHeap, /three\.js 1 tex/);
  assert.doesNotMatch(noHeap, /heap/);
});
