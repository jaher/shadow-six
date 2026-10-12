/**
 * Debug info HUD numbers (`?debug`, the corner readout of debug/debug-mode.js): pure helpers, no DOM.
 *  - RollingWindow: the last `spanMs` of timestamped samples (frame intervals, CPU ms, draws, triangles) → avg / p95 /
 *    max. A spike stays in the max for the whole span (2 s), long enough to read at the HUD's 4 Hz refresh.
 *  - FrameDraws: whole-frame draw calls and triangles. Renderer.render resets `renderer.info` at its start, but the
 *    water mirror, the FFT / ripple / caustics / trail passes run before it in Game.render (map frame): their counts
 *    were wiped. This wraps `info.reset` to add up every segment of the frame and keeps the part drawn before the first
 *    reset apart ("offscreen" passes).
 *  - InputLatency: event.timeStamp of a pointer / key / wheel input → the end of the next drawn frame (Game.render
 *    returned: the frame's GL commands are submitted; GPU, compositor and display time come on top).
 *  - statsLines: the HUD text for them.
 * @module debug/debug-stats
 */

/** Timestamped samples over the last `spanMs` (a ring buffer: no allocation per sample). */
export class RollingWindow {
  /** @param {number} [spanMs] @param {number} [cap] samples kept at most (1024 = 2 s at 500 Hz) */
  constructor(spanMs = 2000, cap = 1024) {
    this.span = spanMs;
    this.t = new Float64Array(cap);
    this.v = new Float64Array(cap);
    this.s = new Float64Array(cap); // sort scratch
    this.head = 0;
    this.n = 0;
  }

  push(t, v) {
    const cap = this.t.length;
    const i = (this.head + this.n) % cap;
    this.t[i] = t;
    this.v[i] = v;
    if (this.n < cap) this.n++;
    else this.head = (this.head + 1) % cap;
  }

  /** Drop the samples older than `now - span`. */
  trim(now) {
    const cap = this.t.length, lo = now - this.span;
    while (this.n && this.t[this.head] < lo) { this.head = (this.head + 1) % cap; this.n--; }
  }

  clear() { this.head = 0; this.n = 0; }

  /**
   * Stats of the samples inside the span at `now`, or null when there are none. p95: nearest rank.
   * @returns {{n: number, avg: number, min: number, max: number, p95: number, sum: number}|null}
   */
  stats(now) {
    this.trim(now);
    const n = this.n;
    if (!n) return null;
    const cap = this.t.length, s = this.s;
    let sum = 0, min = Infinity, max = -Infinity;
    for (let k = 0; k < n; k++) {
      const v = this.v[(this.head + k) % cap];
      s[k] = v;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const sorted = s.subarray(0, n).sort();
    return { n, avg: sum / n, min, max, p95: sorted[Math.max(0, Math.ceil(n * 0.95) - 1)], sum };
  }
}

/**
 * Whole-frame draw calls / triangles from a three.js `renderer.info` that something resets mid-frame.
 * attach(info) once per info object (three makes a new one on a restored context), begin() before the frame,
 * end() after it.
 */
export class FrameDraws {
  constructor() {
    this.info = null;
    this.active = false;
    this.c0 = 0; this.t0 = 0;
    this.calls = 0; this.tris = 0;
    this.preCalls = 0; this.preTris = 0;
    this.resets = 0;
  }

  /** Wrap `info.reset` (idempotent per object). */
  attach(info) {
    if (!info || this.info === info) return;
    this.info = info;
    if (info.__frameDraws) { info.__frameDraws.target = this; return; }
    const orig = info.reset;
    const hook = { target: this };
    info.__frameDraws = hook;
    info.reset = function reset(...a) {
      hook.target?._segment(info);
      return orig.apply(this, a);
    };
  }

  _segment(info) {
    if (!this.active || info !== this.info) return;
    const c = info.render.calls - this.c0, t = info.render.triangles - this.t0;
    this.calls += c; this.tris += t;
    if (!this.resets) { this.preCalls = this.calls; this.preTris = this.tris; }
    this.resets++;
    this.c0 = 0; this.t0 = 0; // the reset zeroes the counters
  }

  begin() {
    const r = this.info?.render;
    this.active = !!r;
    this.c0 = r ? r.calls : 0; this.t0 = r ? r.triangles : 0;
    this.calls = 0; this.tris = 0; this.preCalls = 0; this.preTris = 0; this.resets = 0;
  }

  /** @returns {{calls: number, tris: number, preCalls: number, preTris: number}} the frame's totals */
  end() {
    const r = this.info?.render;
    if (this.active && r) { this.calls += r.calls - this.c0; this.tris += r.triangles - this.t0; }
    this.active = false;
    return { calls: this.calls, tris: this.tris, preCalls: this.preCalls, preTris: this.preTris };
  }
}

/**
 * Input → frame latency. input(event.timeStamp, now) on each discrete input (pointerdown, keydown, wheel); frame(now)
 * after each drawn frame turns every pending input into a sample. An input that waited longer than `staleMs` (a load,
 * a hidden tab) is dropped as not a frame latency (the frame-time max shows such a stall anyway).
 */
export class InputLatency {
  constructor({ keep = 32, staleMs = 1000, maxPending = 16 } = {}) {
    this.keep = keep;
    this.staleMs = staleMs;
    this.maxPending = maxPending;
    this.pending = [];
    this.samples = [];
    this.last = null;
    this.stale = 0;
    this.total = 0;
  }

  /** @param {number} ts event.timeStamp (performance.now() time base) @param {number} now performance.now() */
  input(ts, now) {
    if (!(ts > 0) || ts > now + 50 || ts < now - 60000) ts = now; // no / foreign time base: count from the handler
    if (this.pending.length < this.maxPending) this.pending.push(ts);
  }

  /** @returns {number} samples added */
  frame(now) {
    const p = this.pending;
    if (!p.length) return 0;
    let added = 0;
    for (let i = 0; i < p.length; i++) {
      const ms = Math.max(0, now - p[i]);
      if (ms > this.staleMs) { this.stale++; continue; }
      this.samples.push(ms);
      if (this.samples.length > this.keep) this.samples.shift();
      this.last = ms;
      this.total++;
      added++;
    }
    p.length = 0;
    return added;
  }

  /** Forget pending inputs (a load started: no frame follows soon). */
  drop() { this.pending.length = 0; }

  /** @returns {{last: number, avg: number, p95: number, max: number, n: number}|null} over the last `keep` samples */
  stats() {
    const s = this.samples, n = s.length;
    if (!n) return null;
    const sorted = s.slice().sort((a, b) => a - b);
    let sum = 0;
    for (const v of s) sum += v;
    return { last: this.last, avg: sum / n, p95: sorted[Math.max(0, Math.ceil(n * 0.95) - 1)], max: sorted[n - 1], n };
  }
}

// ---------------------------------------------------------------- formatting

const MB = 1048576;
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
/** Milliseconds: 1 decimal under 100, whole above; '-' for none. */
export const fmtMs = (v) => (!ok(v) ? '-' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
/** Counts: 1234 → 1.2k, 1234567 → 1.23M. */
export const fmtCount = (n) => (!ok(n) ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
/** Bytes → MB: whole MB from 10 up, 1 decimal below. */
export const fmtMB = (b) => (!ok(b) ? '-' : b / MB >= 10 ? (b / MB).toFixed(0) : (b / MB).toFixed(1));

/**
 * The latency / triangles / memory lines of the info HUD: a table of avg / p95 / max over the rolling window (input →
 * frame: over the last inputs, plus the last one), then GPU memory and the object / heap line. Every field may be
 * null (not measured yet / unavailable: a '-' cell, or the line is left out — the JS heap only exists in Chromium).
 * @param {{
 *   span?: number,
 *   frame?: {avg: number, p95: number, max: number}|null,
 *   cpu?: {avg: number, p95: number, max: number}|null, render?: {avg: number, p95: number, max: number}|null,
 *   input?: {last: number, avg: number, p95: number, max: number, n: number}|null,
 *   calls?: {avg: number, p95: number, max: number}|null, tris?: {avg: number, p95: number, max: number}|null,
 *   pre?: {calls: number, tris: number}|null,
 *   gpu?: {tex: number, buf: number, rb: number, fb: number, total: number}|null,
 *   three?: {textures: number, geometries: number}|null,
 *   heap?: {used: number}|null,
 * }} s
 * @returns {string[]}
 */
export function statsLines(s = {}) {
  const span = ok(s.span) ? `${(s.span / 1000).toFixed(0)} s` : '2 s';
  const row = (label, st, fmt, tail = '') => {
    const cells = st ? [st.avg, st.p95, st.max].map((v) => fmt(v).padStart(6)).join(' ') : ['-', '-', '-'].map((v) => v.padStart(6)).join(' ');
    return `${label.padEnd(11)}${cells}${tail ? `  ${tail}` : ''}`;
  };
  const f = s.frame, i = s.input, pre = s.pre;
  const off = (v, fmt) => (pre && v > 0 ? `offscreen ${fmt(v)}` : '');
  const out = [
    `${''.padEnd(11)}${['avg', 'p95', 'max'].map((h) => h.padStart(6)).join(' ')}  (${span})`,
    row('frame', f, fmtMs, `ms  FPS ${f ? (1000 / f.avg).toFixed(0) : '-'}`),
    row('main cpu', s.cpu, fmtMs, 'ms'),
    row('render cpu', s.render, fmtMs, 'ms'),
    row('input→frame', i, fmtMs, i ? `ms  last ${fmtMs(i.last)} (${i.n})` : 'ms  (click, tap, key)'),
    row('draws', s.calls, fmtCount, off(pre?.calls, fmtCount)),
    row('tris', s.tris, fmtCount, off(pre?.tris, fmtCount)),
  ];
  const g = s.gpu;
  if (g) out.push(`GPU ${fmtMB(g.total)} MB  tex ${fmtMB(g.tex)}  buf ${fmtMB(g.buf)}  rb ${fmtMB(g.rb)}  canvas~${fmtMB(g.fb)}`);
  const t = s.three, h = s.heap;
  const mem = [t && `three.js ${t.textures} tex  ${t.geometries} geo`, h && ok(h.used) && `JS heap ${fmtMB(h.used)} MB`].filter(Boolean);
  if (mem.length) out.push(mem.join('   '));
  return out;
}
