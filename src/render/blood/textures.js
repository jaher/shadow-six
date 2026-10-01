/**
 * Procedural decal atlas for blood (4 × 4 tiles of 256 px, drawn once on a 2D canvas, deterministic): round drops
 * with satellites, directional streaks (tile +x = travel direction), a crown drip for hard floors, a soaked dot for
 * snow, left/right boot prints with lug soles, a tyre-tread smear, an arterial spurt, and two big splats.
 * Alpha = coverage, red = relative thickness (darker, glossier centre). Tile order = index.js DK.
 * @module render/blood/textures
 */
import * as THREE from 'three';
import { rng32 } from './model.js';

const T = 256, N = 4;
let atlas = null;

function blob(g, r, cx, cy, rad, rough = 0.18, n = 28, sx = 1, sy = 1) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + (r() - 0.5) * rough;
    const x = cx + Math.cos(a) * rad * k * sx, y = cy + Math.sin(a) * rad * k * sy;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
}

/** Radial fill: thick (red 255) centre → thinner rim (red ~120), alpha 1. */
function thick(g, cx, cy, rad) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
  gr.addColorStop(0, 'rgba(255,0,0,1)'); gr.addColorStop(0.7, 'rgba(200,0,0,1)'); gr.addColorStop(1, 'rgba(120,0,0,1)');
  return gr;
}

function drop(g, r, sat) {
  const c = T / 2, rad = T * (0.2 + r() * 0.06);
  g.fillStyle = thick(g, c, c, rad); blob(g, r, c, c, rad, 0.22);
  for (let i = 0; i < sat; i++) {
    const a = r() * 6.283, d = rad * (1.25 + r() * 0.9), s = T * (0.012 + r() * 0.03);
    g.fillStyle = 'rgba(170,0,0,1)'; blob(g, r, c + Math.cos(a) * d, c + Math.sin(a) * d, s, 0.3, 12);
  }
}

function streak(g, r) {
  const c = T / 2;
  // a teardrop travelling to +x: round head, tapering tail behind, a few satellites ahead
  g.fillStyle = thick(g, c + T * 0.18, c, T * 0.12);
  blob(g, r, c + T * 0.18, c, T * 0.1, 0.15, 20, 1.25, 0.9);
  g.beginPath(); g.moveTo(c + T * 0.1, c - T * 0.075); g.quadraticCurveTo(c - T * 0.15, c - T * 0.02, c - T * 0.4, c); g.quadraticCurveTo(c - T * 0.15, c + T * 0.02, c + T * 0.1, c + T * 0.075);
  g.fillStyle = 'rgba(150,0,0,1)'; g.fill();
  for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(160,0,0,1)'; blob(g, r, c + T * (0.33 + i * 0.05), c + (r() - 0.5) * T * 0.08, T * (0.012 + r() * 0.015), 0.3, 10); }
}

function crown(g, r) {
  const c = T / 2, rad = T * 0.17;
  g.fillStyle = thick(g, c, c, rad * 1.3);
  g.beginPath();
  const n = 22;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2, k = i % 2 ? 1.0 + r() * 0.12 : 1.18 + r() * 0.35;
    const x = c + Math.cos(a) * rad * k, y = c + Math.sin(a) * rad * k;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  for (let i = 0; i < 14; i++) { const a = r() * 6.283, d = rad * (1.7 + r() * 0.9); g.fillStyle = 'rgba(150,0,0,1)'; blob(g, r, c + Math.cos(a) * d, c + Math.sin(a) * d, T * (0.008 + r() * 0.014), 0.3, 10); }
}

function soak(g, r) {
  // a drop that soaked into snow: a vivid, slightly ragged core wicking out into a feathered, faint fringe
  const c = T / 2;
  for (let i = 0; i < 4; i++) {
    const rad = T * (0.3 - i * 0.03), gr = g.createRadialGradient(c, c, T * 0.1, c, c, rad);
    gr.addColorStop(0, 'rgba(90,0,0,0.3)'); gr.addColorStop(1, 'rgba(60,0,0,0)');
    g.fillStyle = gr; blob(g, r, c + (r() - 0.5) * 8, c + (r() - 0.5) * 8, rad, 0.45, 20);
  }
  g.fillStyle = thick(g, c, c, T * 0.17); blob(g, r, c, c, T * 0.15, 0.35, 26);
  for (let i = 0; i < 7; i++) { const a = r() * 6.283, d = T * (0.12 + r() * 0.06); g.fillStyle = 'rgba(200,0,0,0.9)'; blob(g, r, c + Math.cos(a) * d, c + Math.sin(a) * d, T * (0.02 + r() * 0.03), 0.4, 10); }
}

function boot(g, r, mirror) {
  const c = T / 2, s = mirror ? -1 : 1;
  g.save(); g.translate(c, c); g.scale(1, s);
  // sole (toe +x): forefoot ellipse + narrow waist + heel block; lugs cut out as holes
  g.fillStyle = 'rgba(210,0,0,1)';
  g.beginPath(); g.ellipse(T * 0.16, 0, T * 0.19, T * 0.1, 0.06, 0, 6.283); g.fill();
  g.beginPath(); g.moveTo(-T * 0.05, -T * 0.075); g.lineTo(-T * 0.18, -T * 0.07); g.lineTo(-T * 0.18, T * 0.07); g.lineTo(-T * 0.05, T * 0.08); g.fill();
  g.beginPath(); g.ellipse(-T * 0.29, 0, T * 0.1, T * 0.085, 0, 0, 6.283); g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const x = -T * 0.38 + (i % 13) * T * 0.045, y = (Math.floor(i / 13) - 0.5) * T * 0.07 + (i % 2) * T * 0.02;
    if (x > -T * 0.2 && x < -T * 0.06) continue;
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(x, y - T * 0.012, T * 0.026, T * 0.024);
  }
  g.globalCompositeOperation = 'source-over';
  g.restore();
  void r;
}

function tyre(g, r) {
  g.fillStyle = 'rgba(190,0,0,1)';
  for (let x = 0; x < T; x += 14) {
    g.beginPath(); g.moveTo(x, T * 0.3); g.lineTo(x + 9, T * 0.5); g.lineTo(x, T * 0.7); g.lineTo(x + 5, T * 0.7); g.lineTo(x + 14, T * 0.5); g.lineTo(x + 5, T * 0.3); g.fill();
  }
  const gr = g.createLinearGradient(0, 0, T, 0); gr.addColorStop(0, 'rgba(255,0,0,0.9)'); gr.addColorStop(1, 'rgba(120,0,0,0.1)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, T, T); g.globalCompositeOperation = 'source-over';
  void r;
}

function spurt(g, r) {
  // arterial jet: a line of stretched drops, big → small along +x, slightly curved
  for (let i = 0; i < 9; i++) {
    const t = i / 8, x = T * (0.12 + t * 0.78), y = T * 0.5 + Math.sin(t * 2.2) * T * 0.05, s = T * (0.055 - t * 0.04);
    g.fillStyle = thick(g, x, y, s * 1.6); blob(g, r, x, y, s, 0.25, 16, 1.8, 0.9);
  }
}

function splat(g, r) {
  const c = T / 2, rad = T * 0.2;
  g.fillStyle = thick(g, c, c, rad * 1.2); blob(g, r, c, c, rad, 0.4, 36);
  for (let i = 0; i < 9; i++) {                                        // fingers
    const a = r() * 6.283, L = rad * (1.3 + r() * 0.7);
    g.fillStyle = 'rgba(170,0,0,1)';
    g.beginPath(); g.moveTo(c + Math.cos(a + 0.12) * rad * 0.8, c + Math.sin(a + 0.12) * rad * 0.8);
    g.lineTo(c + Math.cos(a) * L, c + Math.sin(a) * L); g.lineTo(c + Math.cos(a - 0.12) * rad * 0.8, c + Math.sin(a - 0.12) * rad * 0.8); g.fill();
    blob(g, r, c + Math.cos(a) * L, c + Math.sin(a) * L, T * 0.02, 0.3, 10);
  }
}

/** The shared atlas texture (built on first use; null without a DOM). */
export function bloodDecalAtlas() {
  if (atlas || typeof document === 'undefined') return atlas;
  const cv = document.createElement('canvas'); cv.width = cv.height = T * N;
  const g = cv.getContext('2d');
  const tiles = [
    (r) => drop(g, r, 3), (r) => drop(g, r, 6), (r) => drop(g, r, 1), (r) => drop(g, r, 9),
    (r) => streak(g, r), (r) => streak(g, r), (r) => crown(g, r), (r) => soak(g, r),
    (r) => boot(g, r, false), (r) => boot(g, r, true), (r) => tyre(g, r), (r) => spurt(g, r),
    (r) => splat(g, r), (r) => splat(g, r), () => {}, () => {},
  ];
  tiles.forEach((fn, i) => {
    g.save(); g.translate((i % N) * T, Math.floor(i / N) * T);
    g.beginPath(); g.rect(0, 0, T, T); g.clip();
    fn(rng32(0xb100d + i * 977));
    g.restore();
  });
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.NoColorSpace; atlas.anisotropy = 4; atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}
export const ATLAS_TILES = N;
