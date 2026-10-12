/**
 * Perf graph of the debug info HUD (`?debug`, debug/debug-mode.js): frame time per frame over the last GRAPH_SPAN ms as
 * bars (green ≤ 16.7 ms, amber ≤ 33.3 ms, red above; one column per CSS px keeps the WORST frame that fell in it, so a
 * single spike is never averaged away), main-thread CPU ms as a line on the same scale, guide lines at 16.7 / 33.3 ms,
 * and the GPU memory total as a thin line on its own scale. DOM-free: drawPerfGraph takes any 2D context.
 * Cost: FrameSeries.push is three typed-array writes per frame (no allocation); columns + drawing run only at the HUD's
 * 4 Hz refresh and only while the graph is visible.
 * @module debug/perf-graph
 */

/** Time span of the graph (ms). */
export const GRAPH_SPAN = 15000;
const FRAME_60 = 1000 / 60, FRAME_30 = 1000 / 30;

/** Timestamped samples with up to two values each, in typed-array rings (oldest overwritten first). */
export class FrameSeries {
  /** @param {number} [cap] samples kept (4096 = 15 s at 270 Hz) */
  constructor(cap = 4096) {
    this.t = new Float64Array(cap);
    this.a = new Float32Array(cap);
    this.b = new Float32Array(cap);
    this.head = 0;
    this.n = 0;
  }

  push(t, a, b = 0) {
    const cap = this.t.length;
    const i = (this.head + this.n) % cap;
    this.t[i] = t; this.a[i] = a; this.b[i] = b;
    if (this.n < cap) this.n++;
    else this.head = (this.head + 1) % cap;
  }

  clear() { this.head = 0; this.n = 0; }

  /** The newest sample's values, or null. */
  last() {
    if (!this.n) return null;
    const i = (this.head + this.n - 1) % this.t.length;
    return { t: this.t[i], a: this.a[i], b: this.b[i] };
  }

  /**
   * Bucket the samples of [now - span, now] into `cols` columns (oldest left): the max of `a` and of `b` per column,
   * NaN for a column without a sample. @returns {number} samples used
   */
  columns(now, span, cols, outA, outB) {
    outA.fill(NaN, 0, cols);
    if (outB) outB.fill(NaN, 0, cols);
    const cap = this.t.length, t0 = now - span;
    let used = 0;
    for (let k = 0; k < this.n; k++) {
      const i = (this.head + k) % cap, t = this.t[i];
      if (t < t0 || t > now) continue;
      const c = Math.min(cols - 1, Math.floor(((t - t0) / span) * cols));
      const a = this.a[i], b = this.b[i];
      if (!(outA[c] >= a)) outA[c] = a;
      if (outB && !(outB[c] >= b)) outB[c] = b;
      used++;
    }
    return used;
  }
}

/** Y scale (ms at the top) for a typical frame: 50 ms (16.7 / 33.3 guides at 1/3, 2/3), else the next step. */
export function graphScale(ms) {
  for (const s of [50, 100, 200, 500, 1000]) if (!(ms > s)) return s;
  return 1000;
}

/**
 * The scale of a set of column values: the 90th percentile + 25 % (so a loading hitch or two does not flatten every
 * other frame: frames above the top are drawn full height in red, the worst one is labelled).
 * @param {Float32Array} vals @param {number} cols @param {Float32Array} [scratch] ≥ cols long (no allocation)
 */
export function robustScale(vals, cols, scratch) {
  const sc = scratch && scratch.length >= cols ? scratch : new Float32Array(cols);
  let n = 0;
  for (let c = 0; c < cols; c++) if (vals[c] > 0) sc[n++] = vals[c];
  if (!n) return graphScale(0);
  const sorted = sc.subarray(0, n).sort();
  return graphScale(sorted[Math.min(n - 1, Math.floor(n * 0.9))] * 1.25);
}

/** Bar colour of a frame time. */
export function frameColor(ms) {
  return ms <= FRAME_60 + 0.8 ? '#6fdc74' : ms <= FRAME_30 + 1 ? '#ffcf4a' : '#ff6250';
}

/**
 * Draw the graph in CSS px (the caller sets the context's transform for the device pixel ratio).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w @param {number} h CSS px
 * @param {{frame: Float32Array, cpu?: Float32Array|null, gpu?: Float32Array|null, cols: number, gpuNowMB?: number|null,
 *   spanS?: number}} d  per-column values (NaN = no sample), `cols` of them
 * @returns {{yMax: number, bars: number, spikes: number}}
 */
export function drawPerfGraph(ctx, w, h, d) {
  const { frame, cpu = null, gpu = null, cols } = d;
  let max = 0;
  for (let c = 0; c < cols; c++) if (frame[c] > max) max = frame[c];
  const yMax = robustScale(frame, cols, d.scratch);
  const cw = w / cols, top = 11, gh = h - top - 1; // a label row above the plot
  const y = (ms) => top + gh - (Math.min(ms, yMax) / yMax) * gh;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, top, w, gh + 1);
  // frame bars, one path per colour
  let bars = 0, spikes = 0;
  for (const col of ['#6fdc74', '#ffcf4a', '#ff6250']) {
    ctx.beginPath();
    let any = false;
    for (let c = 0; c < cols; c++) {
      const v = frame[c];
      if (!(v > 0) || frameColor(v) !== col) continue;
      const yy = y(v);
      ctx.rect(c * cw, yy, Math.max(1, cw), top + gh - yy);
      any = true;
      bars++;
      if (v > yMax) spikes++;
    }
    if (any) { ctx.fillStyle = col; ctx.fill(); }
  }
  if (spikes) { // clipped frames: a white tick on top
    ctx.beginPath();
    for (let c = 0; c < cols; c++) if (frame[c] > yMax) ctx.rect(c * cw, top, Math.max(1, cw), 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  // guides: 16.7 / 33.3 ms
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash?.([3, 3]);
  ctx.beginPath();
  for (const g of [FRAME_60, FRAME_30]) { const yy = Math.round(y(g)) + 0.5; ctx.moveTo(0, yy); ctx.lineTo(w, yy); }
  ctx.stroke();
  ctx.setLineDash?.([]);
  // main CPU (same ms scale), GPU MB (own scale)
  const line = (vals, color, scale) => {
    ctx.beginPath();
    let pen = false;
    for (let c = 0; c < cols; c++) {
      const v = vals[c];
      if (!(v >= 0)) continue; // an empty column (GPU MB is sampled at 4 Hz): the line goes on to the next sample
      const xx = c * cw + cw / 2, yy = scale(v);
      if (pen) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      pen = true;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };
  if (cpu) line(cpu, '#7fd6ff', y);
  let gmax = 0;
  if (gpu) for (let c = 0; c < cols; c++) if (gpu[c] > gmax) gmax = gpu[c];
  if (gpu && gmax > 0) line(gpu, '#d79bff', (mb) => top + gh - (mb / (gmax * 1.25)) * gh);
  // labels
  ctx.font = '9px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  ctx.textBaseline = 'top';
  const label = (s, x, yy, color, align = 'left', bg = false) => {
    ctx.textAlign = align;
    if (bg) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(align === 'left' ? x - 1 : x - s.length * 5.5 - 1, yy, s.length * 5.5 + 2, 10); }
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(s, x + 1, yy + 1);
    ctx.fillStyle = color;
    ctx.fillText(s, x, yy);
  };
  label(`frame ms ≤${yMax}`, 0, 0, '#e6ffe0');
  label('cpu', 82, 0, '#7fd6ff');
  if (gpu && gmax > 0) label(`GPU ${d.gpuNowMB != null ? Math.round(d.gpuNowMB) : Math.round(gmax)} MB`, 108, 0, '#d79bff');
  const span = `${d.spanS ?? GRAPH_SPAN / 1000} s`;
  label(span, w, 0, '#cfc6b0', 'right');
  if (max > yMax) label(`max ${max >= 100 ? Math.round(max) : max.toFixed(1)} ·`, w - span.length * 5.5 - 4, 0, '#ff8a7a', 'right');
  if (y(FRAME_60) - y(FRAME_30) >= 10) { // (too close to read on a long scale)
    label('16.7', 1, Math.round(y(FRAME_60)) - 10, 'rgba(255,255,255,0.85)', 'left', true);
    label('33.3', 1, Math.round(y(FRAME_30)) - 10, 'rgba(255,255,255,0.85)', 'left', true);
  }
  return { yMax, bars, spikes, max };
}

/** The minimized HUD's one line: FPS · frame ms · GPU MB (any of them '-' when unknown). */
export function compactLine(s = {}) {
  const f = s.frame, g = s.gpu;
  const fps = f && f.avg > 0 ? (1000 / f.avg).toFixed(0) : '-';
  const ms = f && Number.isFinite(f.avg) ? f.avg.toFixed(1) : '-';
  const mb = g && Number.isFinite(g.total) ? (g.total / 1048576).toFixed(0) : '-';
  return `FPS ${fps} · ${ms} ms · GPU ${mb} MB`;
}
