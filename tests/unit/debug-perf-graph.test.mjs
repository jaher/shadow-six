/**
 * Debug info HUD perf graph (src/debug/perf-graph.js) and minimize state (src/debug/debug-options.js): the per-frame
 * ring, per-column bucketing (a spike keeps its column), the y scale, the drawing (on a recording 2D-context stand-in),
 * the one-line minimized text, the remembered statsMin option and the capture flags.
 */
import { test, assert } from './lib.mjs';
import { FrameSeries, GRAPH_SPAN, graphScale, robustScale, frameColor, drawPerfGraph, compactLine } from '../../src/debug/perf-graph.js';
import { DEFAULT_OPTIONS, normalizeOptions, loadOptions, saveOptions, parseDebugParams, STORAGE_KEY } from '../../src/debug/debug-options.js';

test('perf graph: the frame ring keeps the newest samples, no allocation per push', () => {
  const r = new FrameSeries(8);
  assert.equal(r.last(), null);
  for (let i = 0; i < 20; i++) r.push(i * 10, i, i * 2);
  assert.equal(r.n, 8);
  assert.deepEqual(r.last(), { t: 190, a: 19, b: 38 });
  const a = new Float32Array(4), b = new Float32Array(4);
  assert.equal(r.columns(190, 80, 4, a, b), 8, 'the 8 kept samples in the span');
  assert.ok(Number.isNaN(a[0]) || a[0] >= 12, 'the oldest kept sample is #12');
  r.clear();
  assert.equal(r.n, 0);
  assert.equal(r.columns(190, 80, 4, a, b), 0);
  assert.ok([...a].every(Number.isNaN), 'empty columns are NaN');
});

test('perf graph: columns keep the worst frame of each column — a single spike is never averaged away', () => {
  const r = new FrameSeries(4096);
  let t = 0;
  for (let i = 0; i < 900; i++) { t += 16.7; r.push(t, i === 450 ? 250 : 16.7, 5); } // 15 s at 60 Hz, one 250 ms hitch
  const cols = 300, a = new Float32Array(cols), b = new Float32Array(cols);
  const used = r.columns(t, GRAPH_SPAN, cols, a, b);
  assert.ok(used >= 895 && used <= 900, `samples in the span (${used})`);
  const max = Math.max(...a.filter((v) => !Number.isNaN(v)));
  assert.equal(Math.round(max), 250, 'the spike survives bucketing (3 frames per column)');
  assert.equal(a.filter((v) => v > 100).length, 1, 'in one column');
  assert.ok(b.every((v) => Number.isNaN(v) || Math.abs(v - 5) < 1e-6), 'second value bucketed too');
  // samples outside the span are ignored; newest is at the right edge
  r.push(t + 10000, 40, 1);
  const a2 = new Float32Array(cols);
  r.columns(t + 10000, GRAPH_SPAN, cols, a2, null);
  assert.equal(Math.round(a2[cols - 1]), 40);
});

test('perf graph: y scale — 50 ms by default (guides at 1/3, 2/3), robust to a few hitches', () => {
  assert.equal(graphScale(0), 50);
  assert.equal(graphScale(16.7), 50);
  assert.equal(graphScale(50), 50);
  assert.equal(graphScale(51), 100);
  assert.equal(graphScale(180), 200);
  assert.equal(graphScale(5000), 1000);
  const cols = 100, v = new Float32Array(cols).fill(16.7);
  v[10] = 900; v[50] = 400; v[70] = NaN;
  assert.equal(robustScale(v, cols, new Float32Array(cols)), 50, 'two loading hitches do not flatten the rest');
  v.fill(30);
  assert.equal(robustScale(v, cols), 50, '30 ms frames (×1.25 = 37.5) still fit 50');
  v.fill(45);
  assert.equal(robustScale(v, cols), 100);
  assert.equal(robustScale(new Float32Array(4).fill(NaN), 4), 50, 'no samples');
  assert.equal(frameColor(16.7), '#6fdc74');
  assert.equal(frameColor(25), '#ffcf4a');
  assert.equal(frameColor(40), '#ff6250');
});

/** A 2D-context stand-in that records the calls the graph makes. */
function fakeCtx() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = { calls, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '' };
  for (const m of ['clearRect', 'fillRect', 'beginPath', 'rect', 'fill', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'fillText']) ctx[m] = rec(m);
  return ctx;
}

test('perf graph: drawing — bars per column, clipped spikes, 16.7 / 33.3 guides, CPU and GPU lines, labels', () => {
  const cols = 120, f = new Float32Array(cols).fill(NaN), c = new Float32Array(cols).fill(NaN), g = new Float32Array(cols).fill(NaN);
  for (let i = 0; i < cols; i++) { f[i] = i === 60 ? 300 : i % 2 ? 16 : 25; c[i] = 6; }
  for (let i = 0; i < cols; i += 15) g[i] = 400 + i; // GPU MB at 4 Hz: sparse columns
  const ctx = fakeCtx();
  const out = drawPerfGraph(ctx, 240, 72, { frame: f, cpu: c, gpu: g, cols, gpuNowMB: 505, scratch: new Float32Array(cols) });
  assert.equal(out.yMax, 50);
  assert.equal(out.bars, cols);
  assert.equal(out.spikes, 1, 'the 300 ms frame is clipped');
  assert.equal(Math.round(out.max), 300);
  const n = (name) => ctx.calls.filter((k) => k[0] === name).length;
  assert.ok(n('rect') >= cols + 1, 'a bar per column + the spike tick');
  assert.equal(ctx.calls.filter((k) => k[0] === 'moveTo').length, 4, 'two guides + the CPU line + the GPU line');
  assert.ok(n('lineTo') >= cols - 1 + 2 + 7, 'the GPU line joins its sparse samples');
  const text = ctx.calls.filter((k) => k[0] === 'fillText').map((k) => k[1]);
  for (const s of ['frame ms ≤50', 'cpu', 'GPU 505 MB', '15 s', '16.7', '33.3', 'max 300 ·']) assert.ok(text.includes(s), `label ${s} (${text})`);
  // a smooth 60 fps run: no spike label
  const ctx2 = fakeCtx();
  const o2 = drawPerfGraph(ctx2, 240, 72, { frame: new Float32Array(cols).fill(16.6), cols });
  assert.equal(o2.spikes, 0);
  assert.ok(!ctx2.calls.some((k) => k[0] === 'fillText' && /^max/.test(k[1])));
});

test('perf graph: minimized one-liner', () => {
  assert.equal(compactLine({ frame: { avg: 16.67 }, gpu: { total: 412 * 1048576 } }), 'FPS 60 · 16.7 ms · GPU 412 MB');
  assert.equal(compactLine({}), 'FPS - · - ms · GPU - MB');
  assert.ok(compactLine({ frame: { avg: 33.4 }, gpu: null }).length <= 34, 'short enough for a pill at phone width');
});

test('debug options: statsMin remembered (default expanded); capture flags ?test=1 / clean', () => {
  assert.equal(DEFAULT_OPTIONS.statsMin, false);
  assert.equal(normalizeOptions({ statsMin: 1 }).statsMin, true);
  const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(saveOptions(st, { ...DEFAULT_OPTIONS, statsMin: true }), true);
  assert.equal(loadOptions(st).statsMin, true);
  assert.equal(JSON.parse(m.get(STORAGE_KEY)).statsMin, true);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(saveOptions(broken, { ...DEFAULT_OPTIONS, statsMin: true }), false, 'blocked storage: no throw');
  assert.equal(loadOptions(broken).statsMin, false);
  assert.equal(parseDebugParams('?debug').clean, false);
  assert.equal(parseDebugParams('?debug').test, false);
  assert.equal(parseDebugParams('?debug=clean').clean, true);
  assert.equal(parseDebugParams('?debug&clean').clean, true);
  assert.equal(parseDebugParams('?test=1&debug&walkthrough=m03').test, true);
  assert.equal(parseDebugParams('?clean').clean, false, 'no debug, no flag');
});
