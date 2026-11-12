/**
 * M20 "Operation Valhalla": the castle's age (castle pass, user 2026-11-10: "Castle has signs of age", then "Castle very
 * well maintained though"): centuries of patina on a castle that has been carefully kept up — never decay. One decal
 * layer over the masonry and the roofs, seeded per wall, tower and building (no tiling):
 *  - weathered, varied stone tones (soft washes of ochre, grey, green-grey over the faces);
 *  - subtle rain streaks under the merlons, the parapets' copings, the sills and the towers' galleries;
 *  - light lichen and a little moss at north-facing bases;
 *  - neat historical repairs in slightly different stone (limestone or the red Black Forest sandstone), freshly pointed;
 *  - blocked-up older openings (an arched window or a loop walled up in later masonry);
 *  - slate and tile roofs with a natural mottle and a few neatly replaced slates;
 *  - worn, dished stair treads and polished thresholds under the gates and at the portals;
 *  - a clean but stained waterline where the masonry stands in the moat.
 * Nothing broken, missing, sagging or overgrown: the battlements, walls and roofs are complete and sound (the garrison
 * keeps it smart). Visual only — added to the scene, never measured (gameplay geometry identical) — one mesh, one
 * material, one canvas atlas: one draw call, a few thousand triangles, no per-frame cost.
 * @module art/m20-age
 */
import * as THREE from 'three';
import { segFrame, localFrame } from './castle-kit.js';
import { towerPlan, BAILEY_PLAN, WATER_Y, BED_Y, CASTLE_C } from './m20-castle.js';
import { churchFrame, planOf } from './m20-church.js';

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the atlas (8 × 4 cells of 128 px)
/** Cell of each decal kind: [col, row]. */
export const AGE_CELLS = {
  streakA: [0, 0], streakB: [1, 0], streakC: [2, 0], sill: [3, 0], washWarm: [4, 0], washGrey: [5, 0], washGreen: [6, 0], washDark: [7, 0],
  lichen: [0, 1], moss: [1, 1], waterline: [2, 1], repairA: [3, 1], repairB: [4, 1], blockedArch: [5, 1], blockedSlit: [6, 1], polish: [7, 1],
  tread: [0, 2], slateMottle: [1, 2], slateNew: [2, 2], tileMottle: [3, 2], tileNew: [4, 2], shingleMottle: [5, 2],
};
const COLS = 8, ROWS = 4, CELL = 128;

function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Paint the atlas (canvas 2D). Every cell's alpha fades to 0 at its border (no hard decal edges). */
function paintAtlas() {
  const c = document.createElement('canvas'); c.width = COLS * CELL; c.height = ROWS * CELL;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const R = rng(1945);
  const cell = (name, fn) => { const [cx, cy] = AGE_CELLS[name]; g.save(); g.translate(cx * CELL, cy * CELL); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); fn(g); g.restore(); };
  const soft = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
  // rain streaks: thin irregular runs from the top, fading down (three variants)
  for (const [name, n, a] of [['streakA', 7, 0.42], ['streakB', 11, 0.36], ['streakC', 5, 0.46]]) cell(name, () => {
    for (let k = 0; k < n; k++) {
      const x = 14 + R() * 100, wd = 2 + R() * 7, len = 40 + R() * 86;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(36,33,28,${a})`); gr.addColorStop(0.6, `rgba(40,37,31,${a * 0.5})`); gr.addColorStop(1, 'rgba(40,37,31,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - wd, 0); g.lineTo(x + wd, 0); g.lineTo(x + wd * 0.4 + (R() - 0.5) * 4, len); g.lineTo(x - wd * 0.4 + (R() - 0.5) * 4, len); g.closePath(); g.fill();
    }
    soft(64, 4, 64, '46,42,36', a * 0.5);
  });
  cell('sill', () => { for (let k = 0; k < 6; k++) { const x = 20 + R() * 88, len = 30 + R() * 60, gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(46,42,36,0.3)'); gr.addColorStop(1, 'rgba(46,42,36,0)'); g.fillStyle = gr; g.fillRect(x - 3, 0, 6 + R() * 6, len); } });
  // tone washes: soft mottled blobs
  for (const [name, col, a] of [['washWarm', '132,104,70', 0.26], ['washGrey', '84,84,80', 0.24], ['washGreen', '72,84,58', 0.22], ['washDark', '40,38,34', 0.22]]) cell(name, () => {
    for (let k = 0; k < 14; k++) soft(30 + R() * 68, 30 + R() * 68, 18 + R() * 30, col, a * (0.5 + R() * 0.5));
  });
  // light lichen: pale green-grey and ochre-orange rosettes, sparse
  cell('lichen', () => {
    for (let k = 0; k < 60; k++) {
      const x = 12 + R() * 104, y = 40 + R() * 80, r = 1.5 + R() * 4.5;
      g.fillStyle = R() < 0.7 ? `rgba(140,146,112,${0.35 + R() * 0.3})` : `rgba(160,116,62,${0.3 + R() * 0.3})`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    soft(64, 110, 60, '120,130,96', 0.12);
  });
  // a little moss at the base: low, soft, mottled
  cell('moss', () => {
    const gr = g.createLinearGradient(0, CELL, 0, 30); gr.addColorStop(0, 'rgba(42,56,30,0.46)'); gr.addColorStop(1, 'rgba(42,56,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, CELL, CELL);
    for (let k = 0; k < 40; k++) soft(R() * CELL, 90 + R() * 38, 4 + R() * 10, '60,78,40', 0.2);
  });
  // the waterline: a stained band below the high-water mark, a faint tide line above it
  cell('waterline', () => {
    const gr = g.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, 'rgba(26,34,22,0.74)'); gr.addColorStop(0.5, 'rgba(30,38,24,0.66)'); gr.addColorStop(0.56, 'rgba(46,52,38,0.34)'); gr.addColorStop(0.7, 'rgba(56,58,48,0.16)'); gr.addColorStop(1, 'rgba(56,58,48,0)');
    g.fillStyle = gr; g.fillRect(0, 0, CELL, CELL);
  });
  // neat historical repairs: a patch of later coursed blocks with ragged course ends (as a mason cuts back to sound
  // stone), crisp pale pointing; toned to the masonry's rendered albedo (a slightly different stone, not a sticker)
  // (toned down a fifth: the repair read as a pale blank rectangle on the curtain, review 2026-11-11)
  for (const [name, stone, mortar] of [['repairA', [96, 91, 81], '110,105,96'], ['repairB', [102, 77, 64], '112,105,95']]) cell(name, () => {
    for (let y = 8, row = 0; y < 116; y += 15, row++) {
      const x0 = 10 + R() * 18 + (row % 2) * 6, x1 = 118 - R() * 18;
      for (let x = x0; x < x1 - 8; x += 22 + R() * 6) {
        const t = 0.93 + R() * 0.12, bw = Math.min(21 + R() * 5, x1 - x);
        g.fillStyle = `rgba(${stone.map((v) => Math.round(v * t)).join(',')},0.6)`; g.fillRect(x, y, bw, 12.5);
        g.fillStyle = `rgba(${mortar},0.62)`; g.fillRect(x + bw, y, 1.6, 12.5);
      }
      g.fillStyle = `rgba(${mortar},0.55)`; g.fillRect(x0, y + 12.5, x1 - x0, 1.6);
    }
  });
  // blocked-up openings: the old dressed surround with the later infill of smaller courses
  cell('blockedArch', () => {
    const fillInfill = () => { for (let y = 20, row = 0; y < 124; y += 9, row++) for (let x = 34 - (row % 2) * 8; x < 94; x += 16) { const t = 0.88 + R() * 0.16; g.fillStyle = `rgba(${Math.round(84 * t)},${Math.round(80 * t)},${Math.round(72 * t)},0.78)`; g.fillRect(x + 1, y + 1, 14, 7); } };
    g.save(); g.beginPath(); g.moveTo(34, 124); g.lineTo(34, 52); g.quadraticCurveTo(34, 16, 64, 14); g.quadraticCurveTo(94, 16, 94, 52); g.lineTo(94, 124); g.closePath(); g.clip();
    g.fillStyle = 'rgba(90,86,78,0.74)'; g.fillRect(0, 0, CELL, CELL); fillInfill(); g.restore();
    g.strokeStyle = 'rgba(104,100,90,0.78)'; g.lineWidth = 6; g.beginPath(); g.moveTo(31, 126); g.lineTo(31, 52); g.quadraticCurveTo(31, 11, 64, 10); g.quadraticCurveTo(97, 11, 97, 52); g.lineTo(97, 126); g.stroke();
  });
  cell('blockedSlit', () => {
    g.fillStyle = 'rgba(100,96,88,0.72)'; g.fillRect(44, 6, 40, 116);
    for (let y = 12; y < 116; y += 10) { const t = 0.88 + R() * 0.16; g.fillStyle = `rgba(${Math.round(86 * t)},${Math.round(82 * t)},${Math.round(74 * t)},0.78)`; g.fillRect(56, y, 16, 8); }
  });
  // polish: a threshold worn smooth and pale by centuries of feet
  cell('polish', () => { soft(64, 64, 64, '160,156,146', 0.26); soft(64, 64, 30, '170,166,156', 0.18); });
  // a worn, dished tread: paler and smoother where the feet go, a soft darker rim
  cell('tread', () => { soft(64, 64, 60, '60,56,50', 0.16); g.save(); g.scale(1, 0.62); soft(64, 103, 50, '170,165,154', 0.38); g.restore(); });
  // roofs: the natural mottle and a few neatly replaced slates / tiles
  for (const [name, a, b] of [['slateMottle', '104,112,126', '46,52,62'], ['tileMottle', '160,112,88', '96,56,42'], ['shingleMottle', '128,120,104', '62,56,46']]) cell(name, () => {
    for (let k = 0; k < 18; k++) soft(20 + R() * 88, 20 + R() * 88, 10 + R() * 22, R() < 0.5 ? a : b, 0.24 + R() * 0.12);
  });
  for (const [name, col] of [['slateNew', [52, 58, 72]], ['tileNew', [150, 80, 56]]]) cell(name, () => {
    for (let k = 0; k < 7; k++) {
      const x = 22 + Math.floor(R() * 5) * 18 + (k % 2) * 9, y = 20 + Math.floor(R() * 5) * 18, t = 0.92 + R() * 0.16;
      g.fillStyle = `rgba(${col.map((v) => Math.round(v * t)).join(',')},0.92)`; g.fillRect(x, y, 16, 13);
      g.fillStyle = 'rgba(20,20,22,0.35)'; g.fillRect(x, y + 13, 16, 1.5);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.name = 'm20:age';
  return tex;
}

let AGE_MAT = null;
/** The decals' material: lit, alpha-blended over the masonry, no depth write, pulled toward the camera. */
export function ageMaterial() {
  if (AGE_MAT) return AGE_MAT;
  AGE_MAT = new THREE.MeshStandardMaterial({ map: HAS_DOM ? paintAtlas() : null, color: 0xffffff, roughness: 0.92, metalness: 0, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.FrontSide });
  AGE_MAT.name = 'm20:age';
  AGE_MAT.userData.snowCover = true; // (no snow pass on decals)
  AGE_MAT.userData.aoExclude = true;
  return AGE_MAT;
}

// ---------------------------------------------------------------- the decal buffer
/** Collects decal quads: centre P, unit vectors `right`, `up` (in the surface), its outward normal; size w × h. */
class Decals {
  constructor() { this.pos = []; this.uv = []; this.nrm = []; this.idx = []; }
  quad(kind, P, right, up, w, h, n, { flipU = false } = {}) {
    const [cx, cy] = AGE_CELLS[kind], pad = 2 / CELL;
    let u0 = (cx + pad) / COLS, u1 = (cx + 1 - pad) / COLS;
    const v1 = 1 - (cy + pad) / ROWS, v0 = 1 - (cy + 1 - pad) / ROWS; // (canvas y down; uv.y up: the cell's top is v1)
    if (flipU) [u0, u1] = [u1, u0];
    const b = this.pos.length / 3, hw = w / 2, hh = h / 2;
    for (const [su, sv, tu, tv] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
      this.pos.push(P[0] + right[0] * su * hw + up[0] * sv * hh, P[1] + right[1] * su * hw + up[1] * sv * hh, P[2] + right[2] * su * hw + up[2] * sv * hh);
      this.uv.push(tu, tv); this.nrm.push(n[0], n[1], n[2]);
    }
    // wound to face along n
    const cr = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  /** A decal on a vertical face: face point (x, z) of the face line, outward normal (nx, nz), along t, at height y (centre). */
  wall(kind, x, z, t, nx, nz, y, w, h, off = 0.03, o = {}) {
    this.quad(kind, [x + nx * off, y, z + nz * off], [t[0], 0, t[1]], [0, 1, 0], w, h, [nx, 0, nz], o);
  }
  /** A decal lying on a horizontal surface (y), its long side along `t`. */
  floor(kind, x, y, z, t, w, h) { this.quad(kind, [x, y, z], [t[0], 0, t[1]], [-t[1], 0, t[0]], w, h, [0, 1, 0]); }
  mesh() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, ageMaterial());
    m.name = 'm20art:age'; m.renderOrder = 1; m.receiveShadow = true; m.castShadow = false;
    m.userData.clip = false; // (scenery: never measured, never an obstacle)
    return m;
  }
}

// ---------------------------------------------------------------- the surfaces
const pick = (R, list) => list[Math.floor(R() * list.length)];
const STREAKS = ['streakA', 'streakB', 'streakC'], WASHES = ['washWarm', 'washGrey', 'washGreen', 'washDark'];
const north = (nz) => nz < -0.35; // (z grows southward: an outward normal toward −z faces north)

/** A curtain's faces (castle-kit buildCurtain's profile: core ± half, the parapet + 0.32 out, the talus from `base`). */
function curtainFaces(D, s, R, o) {
  const pts = s.points, half = (s.width ?? 5) / 2, h = s.h ?? 7, crag = /crag/.test(s.variant || '');
  const base = crag ? 0 : -1.6, tal = crag ? 0.6 : 1.1, wet = !crag;
  for (let k = 0; k + 1 < pts.length; k++) {
    const F = segFrame(pts[k], pts[k + 1], crag ? [pts[0][0], 60] : CASTLE_C), L = F.L;
    if (L < 3) continue;
    const at = (u, w) => F.at(u, w), nO = F.n, nI = [-F.n[0], -F.n[1]];
    // outer face: streaks down the parapet from under the merlons' copings and down the wall from the corbel table
    for (let u = 1 + R() * 1.5; u < L - 1; u += 1.6 + R() * 1.8) {
      const [px, pz] = at(u, half + 0.32), sw = 0.5 + R() * 0.5;
      D.wall(pick(R, STREAKS), px, pz, F.t, nO[0], nO[1], h + 0.55, sw, 1.2, 0.03);
      if (R() < 0.6) { const [qx, qz] = at(u + (R() - 0.5) * 0.4, half); const len = 1.4 + R() * 2.4; D.wall(pick(R, STREAKS), qx, qz, F.t, nO[0], nO[1], h - 0.85 - len / 2, sw * 0.8, len, 0.03); }
    }
    // tone washes, a neat repair or two, an older opening walled up (outer face, between the talus and the corbels)
    for (let u = 2 + R() * 3; u < L - 2; u += 4 + R() * 5) { const [px, pz] = at(u, half); D.wall(pick(R, WASHES), px, pz, F.t, nO[0], nO[1], 3.2 + R() * (h - 5.5), 3 + R() * 3, 2 + R() * 1.6, 0.035); }
    if (L > 12 && R() < 0.8) { const u = L * (0.2 + R() * 0.6), [px, pz] = at(u, half); D.wall(R() < 0.65 ? 'repairA' : 'repairB', px, pz, F.t, nO[0], nO[1], 3.2 + R() * 1.8, 1.8 + R() * 1.4, 1.2 + R() * 0.8, 0.04); }
    if (L > 16 && R() < 0.55) { const u = L * (0.15 + R() * 0.7), [px, pz] = at(u, half); const arch = R() < 0.5; D.wall(arch ? 'blockedArch' : 'blockedSlit', px, pz, F.t, nO[0], nO[1], 4.0, arch ? 1.1 : 0.42, arch ? 1.6 : 1.5, 0.045); }
    // the waterline round the talus (it leans out: each piece on the slope at the water's height)
    if (wet) for (let u = 0.6; u < L - 0.6; u += 2.6) {
      const wl = WATER_Y, f = (2.4 - wl) / (2.4 - base), ww = half + tal * f + 0.03, [px, pz] = at(u + 1.3, ww);
      const slope = Math.atan2(tal, 2.4 - base), up = [-nO[0] * Math.sin(slope), Math.cos(slope), -nO[1] * Math.sin(slope)];
      D.quad('waterline', [px, wl + 0.4, pz], [F.t[0], 0, F.t[1]], up, 2.75, 1.4, [nO[0] * Math.cos(slope), Math.sin(slope), nO[1] * Math.cos(slope)]);
    }
    // a little lichen and moss where the outer face looks north, at the talus' top (above the water)
    if (north(nO[1])) for (let u = 1 + R() * 4; u < L - 1; u += 5 + R() * 5) { const [px, pz] = at(u, half); D.wall(R() < 0.5 ? 'lichen' : 'moss', px, pz, F.t, nO[0], nO[1], 3.0, 1.6, 0.9, 0.035); }
    // inner face: streaks under the walk's kerb, washes; moss at a north-looking base (ground level, the bailey)
    if (!crag) {
      for (let u = 1.5 + R() * 2; u < L - 1.5; u += 2.2 + R() * 2.6) { const [px, pz] = at(u, -half), len = 1 + R() * 1.6; D.wall(pick(R, STREAKS), px, pz, [-F.t[0], -F.t[1]], nI[0], nI[1], h - len / 2, 0.5 + R() * 0.4, len, 0.03); }
      for (let u = 3 + R() * 3; u < L - 3; u += 6 + R() * 6) { const [px, pz] = at(u, -half); D.wall(pick(R, WASHES), px, pz, [-F.t[0], -F.t[1]], nI[0], nI[1], 2.2 + R() * 3, 3 + R() * 2.5, 2 + R() * 1.5, 0.035); }
      if (north(nI[1]) && o.groundAt) for (let u = 2 + R() * 3; u < L - 2; u += 5 + R() * 4) { const [px, pz] = at(u, -half), gy = o.groundAt(px - nI[0] * 0.5, pz - nI[1] * 0.5); if (Math.abs(gy) < 0.3) D.wall('moss', px, pz, [-F.t[0], -F.t[1]], nI[0], nI[1], gy + 0.45, 1.8, 0.9, 0.035); }
    }
  }
}

/** A round (or D) tower's shaft: streaks under its gallery, washes, the waterline round its foot; its cone's mottle. */
function towerFaces(D, t, R) {
  const round = t.kind === 'round';
  const [cx, cz] = round ? [t.x, t.z] : t.F.at(t.u, 2.5);
  const face = round ? t.face : Math.atan2(t.F.n[1], t.F.n[0]), r = t.r, top = t.top, y0 = BED_Y;
  const a0 = round ? face - Math.PI * 0.85 : face - Math.PI / 2 + 0.15, a1 = round ? face + Math.PI * 0.85 : face + Math.PI / 2 - 0.15;
  const onShaft = (a, rr, y, kind, w, h, off = 0.03) => {
    const nx = Math.cos(a), nz = Math.sin(a);
    D.quad(kind, [cx + nx * (rr + off), y, cz + nz * (rr + off)], [-nz, 0, nx], [0, 1, 0], w, h, [nx, 0, nz]);
  };
  for (let a = a0 + R() * 0.3; a < a1; a += 0.42 + R() * 0.3) {
    onShaft(a, r, top - 0.9 - 1.2, pick(R, STREAKS), 0.55, 2.4);
    if (R() < 0.5) onShaft(a + 0.1, r + 0.45, top + 1.1, pick(R, STREAKS), 0.5, 1.1);
  }
  for (let a = a0 + 0.3; a < a1; a += 0.9 + R() * 0.6) onShaft(a, r, 3 + R() * (top - 6), pick(R, WASHES), 1.6, 2.4, 0.04);
  // the waterline on the battered foot (radius r + 0.75 at the bed, r at 3.6 m up)
  const fH = Math.min(3.6, top - y0 - 2), rAt = (y) => r + 0.75 * (1 - Math.min(1, Math.max(0, (y - y0) / fH)));
  for (let a = a0; a < a1; a += 0.32) {
    const nx = Math.cos(a), nz = Math.sin(a), ra = rAt(WATER_Y - 0.35), rb = rAt(WATER_Y + 0.75), mid = (ra + rb) / 2 + 0.04;
    const tilt = Math.atan2(ra - rb, 1.1);
    D.quad('waterline', [cx + nx * mid, WATER_Y + 0.2, cz + nz * mid], [-nz, 0, nx], [-nx * Math.sin(tilt), Math.cos(tilt), -nz * Math.sin(tilt)], 0.36 * (r + 0.5), 1.1, [nx, 0, nz]);
  }
  // north-looking lichen above the foot
  const an = -Math.PI / 2;
  if (Math.cos(an - face) > -0.2) onShaft(an + (R() - 0.5) * 0.6, r, y0 + fH + 0.8, 'lichen', 1.4, 1.0);
  // the cone: mottle and a few neatly replaced slates on its outer side
  const yE = top + 1.75, rr = r + 0.75, hh = rr * (t.cone ?? (round ? 2.3 : 2.0));
  for (let k = 0; k < 5; k++) {
    const a = face + (R() - 0.5) * (round ? 2.6 : 2.0), f = 0.12 + R() * 0.5, rad = rr * (1 - f) + 0.04, y = yE + hh * f;
    const nx = Math.cos(a), nz = Math.sin(a), sl = Math.atan2(rr, hh); // the cone's slope from the vertical
    const n = [nx * Math.cos(sl), Math.sin(sl), nz * Math.cos(sl)], up = [-nx * Math.sin(sl), Math.cos(sl), -nz * Math.sin(sl)];
    D.quad(k < 3 ? 'slateMottle' : 'slateNew', [cx + nx * rad, y, cz + nz * rad], [-nz, 0, nx], up, 0.9 * (1 - f) + 0.4, 1.1, n);
  }
}

/** The gatehouses: streaks under the crown, washes, the polished threshold through the arch. */
function gateFaces(D, s, R, o) {
  const F = localFrame(s.x, s.z, s.rot ?? 0), W2 = s.w / 2, D2 = s.d / 2, inner = /inner/.test(s.variant || '');
  const Y = inner ? s.h : 7, half = inner ? s.w / 6 : 2.25;
  for (const side of [1, -1]) {
    const n = [F.n[0] * side, F.n[1] * side], t = [F.t[0] * side, F.t[1] * side];
    for (let u = -W2 + 0.8 + R(); u < W2 - 0.6; u += 1.5 + R() * 1.4) {
      if (Math.abs(u) < half + 0.4) continue; // (the arch)
      const [px, pz] = F.at(u, side * D2), len = 1.4 + R() * 1.8;
      D.wall(pick(R, STREAKS), px, pz, t, n[0], n[1], Y - 1.6 - len / 2, 0.55, len, 0.04);
    }
    for (const u of [-W2 * 0.6, W2 * 0.6]) { const [px, pz] = F.at(u + (R() - 0.5), side * D2); D.wall(pick(R, WASHES), px, pz, t, n[0], n[1], 2.6 + R() * 1.5, 2.6, 2.2, 0.045); }
  }
  // the threshold: across the passage on its floor where the leaves close (inside, off the bridge's deck)
  const [tx, tz] = F.at(0, inner ? 0 : -1.45), gy = o.groundAt ? o.groundAt(tx, tz) : 0;
  D.floor('polish', tx, gy + 0.02, tz, F.t, half * 2 - 0.4, 0.7);
}

/** The keep: streaks under the donjon's and the hall's parapets, washes, the waterline on its W plinth, repairs. */
function keepFaces(D, s, R) {
  const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.z - s.d / 2, z1 = s.z + s.d / 2, y0 = s.baseY ?? 0, xm = 19.5, zh = 53;
  const yHall = y0 + 13, yDon = y0 + 20, yE = y0 + 7;
  const runs = [ // [a, b, normal, top]
    [[x0, z1], [xm, z1], [0, 1], yHall], [[xm, z1], [x1, z1], [0, 1], yE], // S faces: the hall, the E block
    [[x1, z0], [x1, z1], [1, 0], yE], [[xm, z0], [xm, zh], [1, 0], yDon], // E faces: the E block, the donjon above it
    [[x0, z0], [xm, z0], [0, -1], yDon], [[x0, z0], [x0, zh], [-1, 0], yDon], [[x0, zh], [x0, z1], [-1, 0], yHall], // N and W faces
  ];
  for (const [a, b, n, top] of runs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (let u = 0.8 + R(); u < L - 0.6; u += 1.4 + R() * 1.6) { const len = 1.4 + R() * 2.2; D.wall(pick(R, STREAKS), a[0] + t[0] * u, a[1] + t[1] * u, t, n[0], n[1], top - 0.3 - len / 2, 0.55, len, 0.04); }
    for (let u = 2 + R() * 2; u < L - 2; u += 4 + R() * 4) D.wall(pick(R, WASHES), a[0] + t[0] * u, a[1] + t[1] * u, t, n[0], n[1], y0 + 2.5 + R() * (top - y0 - 5), 3.2, 2.6, 0.045);
    if (north(n[1])) for (let u = 1 + R() * 2; u < L - 1; u += 4 + R() * 3) D.wall(R() < 0.6 ? 'lichen' : 'moss', a[0] + t[0] * u, a[1] + t[1] * u, t, n[0], n[1], y0 + 0.5, 1.6, 0.9, 0.04);
  }
  // a walled-up older window high on the donjon's W face, a neat repair on the hall's S face
  D.wall('blockedArch', x0, 44.5, [0, -1], -1, 0, yDon - 5.5, 1.3, 1.9, 0.05);
  D.wall('repairA', 16.8, z1, [1, 0], 0, 1, y0 + 6.2, 2.2, 1.4, 0.05);
  // the waterline along the W face's plinth (battered 0.45 m out at the bed)
  for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.4) {
    const f = (3.0 - WATER_Y) / (3.0 - BED_Y), xw = x0 - 0.5 - 0.45 * f - 0.03;
    D.quad('waterline', [xw, WATER_Y + 0.2, z], [0, 0, -1], [0.1, 0.995, 0], 2.5, 1.1, [-1, 0.1, 0]);
  }
  // the portal's threshold, worn pale (the porch flight's top under the door, x 10.1-13.9)
  D.floor('polish', 12, y0 + 0.462, z1 + 0.1, [1, 0], 1.9, 0.22);
  // the donjon's pyramid (S and E faces): its mottle and a few replaced slates
  const ax = (x0 + xm) / 2, az = (z0 + zh) / 2, hp = (xm - x0) / 2 - 1.0, base = yDon + 0.9, rise = 9.5, sl = Math.atan2(rise, hp);
  for (const [dir, k0] of [[[0, 1], 0], [[1, 0], 1]]) {
    for (let k = 0; k < 4; k++) {
      const d = hp * (0.25 + R() * 0.55), lat = (R() - 0.5) * d * 1.2, y = base + rise * (1 - d / hp);
      const px = ax + dir[0] * d + (dir[1] ? lat : 0), pz = az + dir[1] * d + (dir[0] ? lat : 0);
      const n = [dir[0] * Math.sin(sl), Math.cos(sl), dir[1] * Math.sin(sl)], up = [-dir[0] * Math.cos(sl), Math.sin(sl), -dir[1] * Math.cos(sl)];
      D.quad(k < 2 + k0 ? 'slateMottle' : 'slateNew', [px + n[0] * 0.03, y + n[1] * 0.03, pz + n[2] * 0.03], [dir[1], 0, -dir[0]], up, 2.2, 1.8, n);
    }
  }
}

/** A saddle roof's slopes (BAILEY_PLAN extents, art/m20-castle.js saddle): mottle and a few replaced slates or tiles. */
function saddleMottle(D, F, u0, u1, w0, w1, ye, yr, oh, roof, R, n = 3) {
  const wm = (w0 + w1) / 2, hw = (w1 - w0) / 2 + oh, yeo = ye - oh * (yr - ye) / ((w1 - w0) / 2), sl = Math.atan2(yr - yeo, hw);
  const mott = roof === 'slate' ? 'slateMottle' : roof === 'shingle' ? 'shingleMottle' : 'tileMottle', fresh = roof === 'shingle' ? null : roof === 'slate' ? 'slateNew' : 'tileNew';
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
    const f = 0.2 + R() * 0.6, u = u0 + (u1 - u0) * (0.1 + R() * 0.8), w = wm + side * hw * (1 - f), y = yeo + (yr - yeo) * f;
    const [x, z] = F.at(u, w), nx = F.n[0] * side, nz = F.n[1] * side;
    const nrm = [nx * Math.sin(sl), Math.cos(sl), nz * Math.sin(sl)], up = [-nx * Math.cos(sl), Math.sin(sl), -nz * Math.cos(sl)];
    D.quad(k === n - 1 && fresh ? fresh : mott, [x + nrm[0] * 0.03, y + nrm[1] * 0.03, z + nrm[2] * 0.03], [F.t[0], 0, F.t[1]], up, k === n - 1 && fresh ? 1.0 : 2.2, k === n - 1 && fresh ? 0.9 : 1.6, nrm);
  }
}

/** The church: streaks under its eaves and belfry, washes, lichen at the north-looking base, the portal's threshold,
 *  the nave roof's mottle. */
function churchFaces(D, s, R) {
  const F = churchFrame(s), P = planOf(s), y0 = s.baseY ?? 0, [n0, n1] = P.nave, NH = P.naveH, TH = P.towerH;
  for (const side of [1, -1]) {
    const nx = F.n[0] * side, nz = F.n[1] * side;
    for (let u = n0 + 0.6; u < n1 - 0.4; u += 1.3 + R() * 1.2) { const [x, z] = F.at(u, side * NH), len = 1.2 + R() * 1.6; D.wall(pick(R, STREAKS), x, z, F.t, nx, nz, y0 + P.naveEave - 0.3 - len / 2, 0.5, len, 0.04); }
    for (let u = n0 + 1.5; u < n1 - 1; u += 3 + R() * 2) { const [x, z] = F.at(u, side * NH); D.wall(pick(R, WASHES), x, z, F.t, nx, nz, y0 + 2 + R() * 3, 2.2, 2, 0.05); }
    if (north(nz)) for (let u = n0 + 0.5; u < n1; u += 3 + R() * 2) { const [x, z] = F.at(u, side * NH); D.wall('lichen', x, z, F.t, nx, nz, y0 + 0.6, 1.4, 0.8, 0.05); }
    // the tower's sides under the belfry
    for (let u = P.tower[0] + 0.6; u < P.tower[1] - 0.4; u += 1.1 + R()) { const [x, z] = F.at(u, side * TH); D.wall(pick(R, STREAKS), x, z, F.t, nx, nz, y0 + P.towerTop - 4.2 - 1, 0.5, 2, 0.04); }
  }
  // the tower's front: streaks from the belfry's sill; the portal's threshold on the top step
  for (let w = -TH + 0.6; w < TH - 0.4; w += 1.1 + R()) { const [x, z] = F.at(P.tower[0], w); D.wall(pick(R, STREAKS), x, z, [-F.n[0], -F.n[1]], -F.t[0], -F.t[1], y0 + P.towerTop - 4.2 - 1.1, 0.5, 2.2, 0.04); }
  const [px, pz] = F.at(-0.15, 0);
  D.floor('polish', px, y0 + 0.612, pz, [F.n[0], F.n[1]], 1.6, 0.28);
  saddleMottle(D, F, n0, n1, -NH, NH, y0 + P.naveEave, y0 + P.naveRidge, 0.35, 'slate', R, 3);
}

/** The bailey's buildings (BAILEY_PLAN): their roofs' mottle and a few replaced slates or tiles. */
function baileyRoofs(D, m) {
  for (const [id, p] of Object.entries(BAILEY_PLAN)) {
    const s = (m.structures || []).find((q) => q.id === id);
    if (!s || p.kind === 'chapel' || p.hip) continue;
    const R = rng(hash(`age:${id}`)), F = localFrame(s.x, s.z, s.rot ?? 0);
    saddleMottle(D, F, p.u0, p.u1, p.w0, p.w1, p.ye ?? 2.5, p.yr ?? 5.4, p.oh ?? 0.45, p.roof ?? 'tiles', R, 2);
  }
}

/** Worn, dished treads on every stone stair (castle-kit buildStairFlight: n treads of ~0.2 m, their tops). */
function stairTreads(D, m) {
  for (const l of m.ladders || []) {
    if (l.kind !== 'stairs') continue;
    const a = { x: l.x, y: l.y ?? 0, z: l.z }, b = { x: l.top[0], y: l.top[2] ?? 0, z: l.top[1] };
    const run = Math.hypot(b.x - a.x, b.z - a.z), rise = b.y - a.y, n = Math.max(2, Math.ceil(Math.abs(rise) / 0.2)), tr = run / n;
    const t = [(b.x - a.x) / run, (b.z - a.z) / run];
    for (let i = 0; i < n; i++) {
      const top = a.y + (rise * (i + 1)) / n, u = (i + 0.5) * tr;
      D.floor('tread', a.x + t[0] * u, top + 0.012, a.z + t[1] * u, [-t[1], t[0]], 1.2, Math.max(0.18, tr * 0.85));
    }
  }
}

/**
 * The age layer of the whole castle. o: {groundAt(x, z) → y}. Returns one mesh (the decals) — scenery, unmeasured.
 */
export function buildAge(m, o = {}) {
  const D = new Decals();
  for (const s of m.structures || []) {
    if (s.type === 'castle_wall' && s.points) curtainFaces(D, s, rng(hash(`age:${s.id}`)), o);
    else if (s.type === 'castle_gate') gateFaces(D, s, rng(hash(`age:${s.id}`)), o);
  }
  for (const [k, t] of towerPlan(m).entries()) towerFaces(D, t, rng(hash(`age:tower:${k}`)));
  const hq = (m.structures || []).find((s) => s.id === 'hq');
  if (hq) keepFaces(D, hq, rng(hash('age:hq')));
  const ch = (m.structures || []).find((s) => s.id === 'church');
  if (ch) churchFaces(D, ch, rng(hash('age:church')));
  baileyRoofs(D, m);
  stairTreads(D, m);
  const mesh = D.mesh();
  mesh.userData.decals = D.idx.length / 6;
  return mesh;
}
