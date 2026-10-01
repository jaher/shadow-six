/**
 * Procedural textures for persistent explosion ground marks (render/blast-marks.js): a 2-cell atlas (512 × 256).
 *   left  'soil'  — soft ground: dark churned earth in the crater bowl, a blackened rim, radial soil streaks and clods
 *   right 'soot'  — hard floors: radial soot burst with ragged spiky edges, darker core, fine spatter streaks, chips
 * RGB = multiply tint (white = unchanged), A = coverage. Canvas 2D (browser only).
 * @module render/blast-mark-textures
 */

import * as THREE from 'three';

/** Small deterministic PRNG (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Radial profile with a ragged edge: r(θ) = base · (1 + Σ harmonics + spikes). */
function ragged(R, n = 180, amp = 0.18, spikes = 0) {
  const h = Array.from({ length: 6 }, () => [R() * 6.283, 0.5 + R()]);
  const sp = Array.from({ length: spikes }, () => [R() * 6.283, 0.25 + R() * 0.6, 0.03 + R() * 0.05]);
  return (th) => {
    let v = 1;
    h.forEach(([p, a], k) => { v += (amp * a / (k + 1)) * Math.sin(th * (k + 2) + p); });
    for (const [p, len, wdt] of sp) { const d = Math.abs(Math.atan2(Math.sin(th - p), Math.cos(th - p))); if (d < wdt) v += len * (1 - d / wdt); }
    return v;
  };
}

function blob(ctx, cx, cy, rad, prof, fill) {
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) { const th = (i / 180) * Math.PI * 2, r = rad * prof(th); ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r); }
  ctx.fillStyle = fill; ctx.fill();
}

function streaks(ctx, R, cx, cy, n, r0, r1, w, col) {
  for (let i = 0; i < n; i++) {
    const th = R() * Math.PI * 2, a = r0 * (0.8 + R() * 0.4), b = r1 * (0.55 + R() * 0.45), ww = w * (0.4 + R());
    const g = ctx.createLinearGradient(cx + Math.cos(th) * a, cy + Math.sin(th) * a, cx + Math.cos(th) * b, cy + Math.sin(th) * b);
    g.addColorStop(0, col(0.75)); g.addColorStop(1, col(0));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(th - ww) * a, cy + Math.sin(th - ww) * a);
    ctx.lineTo(cx + Math.cos(th) * b, cy + Math.sin(th) * b);
    ctx.lineTo(cx + Math.cos(th + ww) * a, cy + Math.sin(th + ww) * a);
    ctx.fillStyle = g; ctx.fill();
  }
}

function dots(ctx, R, cx, cy, n, r0, r1, s0, s1, col) {
  for (let i = 0; i < n; i++) {
    const th = R() * Math.PI * 2, r = r0 + (r1 - r0) * Math.sqrt(R()), s = s0 + (s1 - s0) * R() * R();
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(th) * r, cy + Math.sin(th) * r, s, s * (0.6 + R() * 0.4), R() * 3, 0, Math.PI * 2);
    ctx.fillStyle = col(0.5 + R() * 0.5); ctx.fill();
  }
}

let ATLAS = null;
/** @returns {THREE.CanvasTexture} the shared atlas */
export function blastMarkAtlas() {
  if (ATLAS) return ATLAS;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 512, 256);
  // --- soil (soft ground): churned earth bowl, blackened ring, radial ejecta
  let R = prng(1947);
  const soil = (a) => `rgba(66,51,38,${a})`, char = (a) => `rgba(40,32,26,${a})`, clod = (a) => `rgba(64,49,36,${a})`;
  streaks(ctx, R, 128, 128, 46, 38, 124, 0.05, soil);
  dots(ctx, R, 128, 128, 170, 44, 122, 0.8, 4.2, clod);
  blob(ctx, 128, 128, 58, ragged(R, 180, 0.22, 7), soil(0.62));
  blob(ctx, 128, 128, 44, ragged(R, 180, 0.16), char(0.55));
  // churned frozen earth in the bowl: lumps of lighter and darker soil, a few snow crumbs left bright
  dots(ctx, R, 128, 128, 260, 0, 46, 1.2, 5.5, (a) => (R() < 0.5 ? `rgba(92,72,54,${a * 0.8})` : `rgba(34,27,21,${a * 0.7})`));
  dots(ctx, R, 128, 128, 40, 10, 50, 0.8, 2.2, (a) => `rgba(255,255,255,${a * 0.9})`);
  // --- soot (hard floor): radial burst with spiky edges, spatter streaks, chips
  R = prng(1944);
  const soot = (a) => `rgba(24,22,21,${a})`;
  streaks(ctx, R, 384, 128, 90, 16, 126, 0.03, soot);
  streaks(ctx, R, 384, 128, 40, 10, 90, 0.07, soot);
  dots(ctx, R, 384, 128, 220, 30, 124, 0.5, 2.2, soot);
  const g = ctx.createRadialGradient(384, 128, 4, 384, 128, 80);
  g.addColorStop(0, 'rgba(22,20,19,1)'); g.addColorStop(0.5, 'rgba(30,28,26,0.9)'); g.addColorStop(1, 'rgba(40,37,34,0)');
  blob(ctx, 384, 128, 74, ragged(R, 180, 0.24, 14), g);
  blob(ctx, 384, 128, 30, ragged(R, 180, 0.3, 5), 'rgba(16,15,14,0.85)');
  dots(ctx, R, 384, 128, 40, 8, 60, 1, 3, (a) => `rgba(70,66,60,${a * 0.6})`);   // chipped pits
  // alpha → the shader reads the coverage from A; soften the outer edge of each cell
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  ATLAS = tex;
  return tex;
}
