/**
 * Flicker in a run of frames (thumbnails: tools/perf/flicker-probe.js on the game's canvas, or decoded screencast
 * frames): a region — a cell of a gx × gy grid, or the whole frame — that changes sharply and changes back within a
 * few frames (A-B-A), or keeps alternating. A camera pan, a fade or a texture sharpening in changes a region and
 * leaves it changed (no revert); a frame drawn black, a texture missing for a frame, a mesh shown for one frame, an
 * exposure step undone do revert.
 *
 *   detectFlicker(frames, {grid: [8, 8], T: 16, maxB: 3}) → {events, cells, stats}
 *   frames: [{i, t, w, h, px: Uint8Array|base64 (RGBA, rows bottom-up as WebGL reads them or top-down: either), m}]
 * @module tools/perf/flicker-detect
 */

const toU8 = (px) => (px == null ? null : typeof px === 'string' ? new Uint8Array(Buffer.from(px, 'base64')) : px);

/** Per-cell mean [luma, r, g, b] of one RGBA thumbnail (cells: gx × gy, plus the whole frame last). */
export function cellMeans(px, w, h, gx, gy, ch = 4) {
  const n = gx * gy, out = new Float32Array((n + 1) * 4), cnt = new Uint32Array(n + 1);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(gy - 1, Math.floor((y * gy) / h));
    for (let x = 0; x < w; x++) {
      const cx = Math.min(gx - 1, Math.floor((x * gx) / w)), o = (y * w + x) * ch;
      const r = px[o], g = px[o + 1], b = px[o + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      for (const c of [cy * gx + cx, n]) { const k = c * 4; out[k] += l; out[k + 1] += r; out[k + 2] += g; out[k + 3] += b; cnt[c]++; }
    }
  }
  for (let c = 0; c <= n; c++) for (let j = 0; j < 4; j++) out[c * 4 + j] /= cnt[c] || 1;
  return out;
}

/** Distance of two cells: the largest of |Δluma| and the colour channels' |Δ| (0-255). */
const dist = (a, b, k) => Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]), Math.abs(a[k + 3] - b[k + 3]));

/**
 * @param {object[]} frames @param {{grid?: number[], T?: number, TG?: number, maxB?: number, back?: number,
 *   hidden?: (m) => boolean, rgb?: number}} [o] T: a cell's jump (0-255) that counts; TG: the whole frame's;
 *   maxB: the longest B run (frames); back: how close the return must come to A (fraction of the jump);
 *   hidden: frames whose canvas does not show (an opaque loading screen) are skipped; rgb: channels per pixel (4 or 3)
 */
export function detectFlicker(frames, o = {}) {
  const [gx, gy] = o.grid || [8, 8], T = o.T ?? 16, TG = o.TG ?? 6, maxB = o.maxB ?? 3, back = o.back ?? 0.35;
  // a moving camera carries edges through the cells: one passing a cell in 1-3 frames reads as a blink. Where the
  // frames' camera (m.cam: target x, z, zoom) moved more than camGate CSS px between two frames of an event, the event is
  // the camera's (a pan at a low frame rate), counted apart — at 60 fps the director's pans move 1-2 px a frame
  const camGate = o.camGate ?? 3;
  // likewise a frame slower than maxGapMs (a loaded host: 8-25 fps) lets anything that moves — a guard's cone turning
  // 5° a frame, a man walking at 4× — cross a 16-px cell between two frames: such events are the frame rate's, counted
  // apart (on a 60 fps view, 17 ms a frame, nothing is)
  const maxGap = o.maxGapMs ?? 40;
  const camPx = (a, b) => {
    if (!a || !b) return 0;
    const ppm = 40 * Math.min(a[2], b[2]);
    return Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]) * ppm, Math.abs(Math.log(a[2] / b[2])) * 700);
  };
  const hidden = o.hidden || (() => false), ch = o.rgb || 4, n = gx * gy;
  const F = [];
  for (const f of frames) {
    const px = toU8(f.px);
    if (!px || hidden(f.m || {})) continue;
    F.push({ f, c: cellMeans(px, f.w, f.h, gx, gy, ch) });
  }
  const events = [];
  let cameraMotion = 0, lowFps = 0;
  for (let i = 1; i < F.length; i++) {
    const A = F[i - 1].c;
    const hit = [];
    for (let c = 0; c <= n; c++) {
      const k = c * 4, thr = c === n ? TG : T;
      const d0 = dist(F[i].c, A, k);
      if (d0 <= thr) continue;
      for (let len = 1; len <= maxB && i + len < F.length; len++) {
        const Bk = F[i + len - 1].c, C = F[i + len].c;
        if (dist(Bk, A, k) <= thr * 0.6) break; // the B run ended without coming back sharply: not a blink
        const dBack = dist(C, A, k), dJump = dist(C, F[i].c, k);
        if (dBack <= Math.max(3, d0 * back) && dJump > thr * 0.8) { hit.push({ cell: c === n ? 'all' : c, len, d: +d0.toFixed(1), back: +dBack.toFixed(1) }); break; }
      }
    }
    if (hit.length) {
      const all = hit.find((h) => h.cell === 'all'), cells = hit.filter((h) => h.cell !== 'all');
      const len = Math.max(...hit.map((h) => h.len));
      let moved = 0;
      for (let k = i; k <= Math.min(F.length - 1, i + len); k++) moved = Math.max(moved, camPx(F[k - 1].f.m?.cam, F[k].f.m?.cam));
      if (moved > camGate) { cameraMotion++; continue; }
      let gap = 0;
      for (let k = i; k <= Math.min(F.length - 1, i + len); k++) gap = Math.max(gap, F[k].f.t - F[k - 1].f.t);
      if (gap > maxGap) { lowFps++; continue; }
      events.push({
        at: i, frame: F[i].f.i, t: F[i].f.t, len, frames: F.slice(i - 1, i + len + 1).map((x) => x.f.i), whole: !!all,
        dWhole: all ? all.d : 0, nCells: cells.length, cells: cells.map((h) => h.cell), dMax: Math.max(...hit.map((h) => h.d)),
        bbox: bbox(cells.map((h) => h.cell), gx), m: F[i].f.m, mA: F[i - 1].f.m,
      });
    }
  }
  // a cell that keeps changing back and forth: sign alternations of big steps in a short window
  const alt = new Map();
  for (let c = 0; c < n; c++) {
    const k = c * 4;
    let run = 0, lastSign = 0;
    for (let i = 1; i < F.length; i++) {
      const d = F[i].c[k] - F[i - 1].c[k];
      if (Math.abs(d) <= T) { run = 0; lastSign = 0; continue; }
      const s = Math.sign(d);
      run = lastSign && s !== lastSign ? run + 1 : 1;
      lastSign = s;
      if (run >= 4) alt.set(c, (alt.get(c) || 0) + 1);
    }
  }
  return { events, alternating: [...alt].map(([cell, n]) => ({ cell, n })), stats: { frames: frames.length, analysed: F.length, grid: [gx, gy], T, TG, cameraMotion, lowFps, maxGap } };
}

/**
 * A blink you see: a blob — at least 4 cells of the grid (16 × 16 px cells at 1280 × 720: 64 × 16 px or more) or a cell
 * changing by 40 levels and back, or the whole frame. Smaller ones are a cone's edge moving by a cell, a snow flake, a
 * hand swinging. @param {object} e an event of detectFlicker
 */
export const visibleBlink = (e) => e.whole || e.nCells >= 4 || e.dMax >= 40;

/** Bounding box of grid cells, in grid units [x0, y0, x1, y1] (exclusive). */
export function bbox(cells, gx) {
  if (!cells.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const c of cells) { const x = c % gx, y = Math.floor(c / gx); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
  return [x0, y0, x1, y1];
}

/** One line per event (a report). */
export function describe(ev, gy = 8, flipY = true) {
  const b = ev.bbox ? (flipY ? [ev.bbox[0], gy - ev.bbox[3], ev.bbox[2], gy - ev.bbox[1]] : ev.bbox) : null;
  const m = ev.m || {};
  return `frame ${ev.frame} (+${ev.len}) t=${ev.t} ${ev.whole ? `WHOLE Δ${ev.dWhole} ` : ''}cells ${ev.nCells} Δmax ${ev.dMax}${b ? ` box x${b[0]}-${b[2]} y${b[1]}-${b[3]}` : ''} | st ${m.st} wt ${m.wt} ld ${m.ld} card ${m.card} hd ${m.hd} pr ${m.pr} cap "${m.cap || ''}" cam ${JSON.stringify(m.cam)}`;
}
