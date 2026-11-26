/**
 * LIGHTS OUT e05 "Cold Iron": the islet's heath (docs/expansion/e05.md §13; review r1: "the island is a flat lawn …
 * heather / bracken / granite"; review r2: the first clumps were faceted star pyramids — "origami"; review r3: their
 * successors, smooth lobed domes, read as piles of brown boulders). Visual only — no gameplay footprint, nothing a unit
 * stands on, hides behind or walks round:
 *  - heather (ling, in October): no surface of its own — each clump is a crowd of sprigs, alpha-cut cards with a drawn
 *    sprig on them (wiry dark stems branching up, bristly shoots of scale leaves, the summer's dead flower spikes gone
 *    rust and grey-straw at the tips), rooted over a ragged, lobed footprint, leaning out at the rim, standing taller
 *    here and lower there (a noisy, non-convex top with gaps where the ground shows); its body from the game's high
 *    camera a few overlapping crown mats (cards with a lobed, holed mass of shoots seen from above, tilted down to the
 *    rim at their own heights), the upright sprigs standing through and above them. Each sprig its own tone from the
 *    design palette: grey-purple ling (#5a4a5a), peat-brown old wood, rust and grey-green; each clump a cast from a
 *    field over the heath (patches of rust, of grey-purple, of grey-green a few metres across). Clumps of every size
 *    gather in drifts and run together into ragged mats, with bare gaps and paths between the drifts;
 *  - dead bracken in its own drifts: fans of frond cards (a drawn frond, its pinnae cut out by alpha) arching out and
 *    drooping, tawny to rust;
 * on the heath's bare ground (`ground` cells), never on a road, a path, a structure, a deck, the glacis's sward, the
 * shingle, or an excluded rect (the camp's yard, the cove's landing, the harbour, the fort inside its moat).
 *  - heathPlan (pure): the clumps' places, kinds, sizes and tones from the nav grid and the mission's paths;
 *  - heatherClump (pure): one clump's cards — upright sprigs, crown mats, sprigs lying over the top (positions,
 *    normals, uv, colours, indices);
 *  - buildHeath: one InstancedMesh per geometry variant (six draws), set on the drawn ground (terrain.surfaceAt); the
 *    clumps throw their ragged shadows at the presets whose grass casts (heathCastsShadow).
 * @module art/e05-heath
 */
import * as THREE from 'three';
import { TERRAIN_QUALITY } from './terrain/terrain.js';

const T_GROUND = 0;
/** Heather clump geometries (each its own footprint, sprig crowd and mix of sprig kinds). */
export const HEATHER_VARIANTS = 4;
const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Integer hash → [0,1). */
function h2(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1] (bilinear over hashed lattice, smoothstep weights). */
function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(i, j, s), b = h2(i + 1, j, s), c = h2(i, j + 1, s), d = h2(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm2 = (x, z, s) => 0.62 * vnoise(x, z, s) + 0.38 * vnoise(x * 2.3 + 7.1, z * 2.3 - 3.7, s + 1);
/** Distance from (x, z) to the polyline `pts`. */
function distPolyline(x, z, pts) {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}
/**
 * Cluster field: 1 at a drift's heart falling to 0 at its rim, 0 in the gaps — one drift per `scale` m cell, its own
 * radius (0.22–0.5 of a cell) and centre, so drifts differ in size and bare ground opens between them.
 */
export function driftField(x, z, scale, seed) {
  const fx = x / scale, fz = z / scale, i0 = Math.floor(fx), j0 = Math.floor(fz);
  let best = 0;
  for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
    if (h2(i, j, seed + 3) < 0.18) continue; // some cells hold no drift at all: wider gaps
    const px = i + h2(i, j, seed), pz = j + h2(i, j, seed + 1), rad = 0.22 + 0.28 * h2(i, j, seed + 2);
    const d = Math.hypot((fx - px) * (1 + 0.35 * (h2(i, j, seed + 4) - 0.5)), fz - pz) / rad;
    if (d < 1) best = Math.max(best, 1 - d * d);
  }
  return best;
}

/** The heather's cast over the heath (pure, [0, 1]): 0 rust / peat-brown, ½ grey-purple ling, 1 grey-green — patches a
 * few metres across (a third of the clumps in each, roughly). */
export function heatherHue(x, z, seed = 5) {
  const n = fbm2(x / 8.5 + 3.3, z / 8.5 - 1.7, seed + 77) + 0.35 * (vnoise(x / 3.1, z / 3.1, seed + 79) - 0.5);
  return Math.min(1, Math.max(0, (n - 0.5) * 1.3 + 0.5));
}
/**
 * The heath's clumps (pure). `grid` {cols, rows, cell, terrain, block?, bridge?, elev?}; `paths`: [{points, width}]
 * (kept clear by width / 2 + `pathMargin`); `exclude`: [[x0, z0, x1, z1]]. Each clump stands where its own cell and the
 * eight round it are bare ground, unblocked and level. Deterministic from `seed`.
 * @returns {{x:number, z:number, kind:'heather'|'bracken', v:number, s:number, h:number, rot:number, tone:number, hue?:number}[]}
 */
export function heathPlan(grid, { seed = 5, step = 0.8, paths = [], exclude = [], pathMargin = 0.9, max = 3400 } = {}) {
  const out = [], { cols, rows, cell } = grid;
  const bare = (i, j) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return false;
    const k = j * cols + i;
    return grid.terrain[k] === T_GROUND && !(grid.block?.[k]) && !(grid.bridge?.[k]) && !((grid.elev?.[k] || 0) > 0.05);
  };
  const W = cols * cell, D = rows * cell;
  for (let gz = 0, zi = 0; gz < D; gz += step, zi++) for (let gx = 0, xi = 0; gx < W; gx += step, xi++) {
    const x = gx + h2(xi, zi, seed) * step, z = gz + h2(xi, zi, seed + 1) * step;
    // drifts: heather gathers in clusters inside broad patches; bracken in drifts of its own; bare ground between
    const patch = ss(0.3, 0.6, fbm2(x / 19, z / 19, seed + 11));
    const hd = driftField(x, z, 7.5, seed + 40) * patch, bd = driftField(x + 31.7, z - 12.3, 9, seed + 60) * ss(0.45, 0.7, fbm2(x / 23 + 5, z / 23 - 9, seed + 23));
    const r = h2(xi, zi, seed + 2);
    let kind = null, w = 0;
    if (bd > 0.08 && r < 0.12 + 0.55 * bd) { kind = 'bracken'; w = bd; } else if (hd > 0.05 && r < 0.2 + 0.8 * hd) { kind = 'heather'; w = hd; }
    if (!kind) continue;
    const i = Math.floor(x / cell), j = Math.floor(z / cell);
    let ok = true;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) ok = bare(i + di, j + dj);
    if (!ok) continue;
    if (exclude.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
    if (paths.some((p) => distPolyline(x, z, p.points) < (p.width ?? 2) / 2 + pathMargin)) continue;
    const q = h2(xi, zi, seed + 3), q2 = h2(xi, zi, seed + 4), q3 = h2(xi, zi, seed + 5);
    // size grows towards a drift's heart (the old plants in the middle, young ones at the rim), every one its own;
    // heather: `s` the clump's reach (m, its sprigs root within it), `h` its tallest sprigs (ling, 0.2–0.55 m), `hue` its
    // cast from a field over the heath (0 rust / peat-brown, ½ grey-purple ling, 1 grey-green young growth) so the mottle
    // reads in patches a few metres across; the clump's variant follows the patch more often than not
    const hue = heatherHue(x, z, seed), lean = h2(xi, zi, seed + 6) < 0.65;
    out.push(kind === 'heather'
      ? { x, z, kind, v: lean ? (hue > 0.6 ? 1 : hue < 0.4 ? 2 : (q2 < 0.5 ? 0 : 3)) : Math.floor(q2 * HEATHER_VARIANTS * 0.999), hue, s: 0.32 + 0.9 * w * (0.55 + 0.45 * q) + 0.12 * q3, h: 0.2 + 0.26 * w * (0.55 + 0.45 * q2) + 0.09 * q3, rot: q3 * Math.PI * 2, tone: q2 }
      : { x, z, kind, v: Math.floor(q * 2) % 2, s: 0.45 + 0.4 * w + 0.15 * q, h: 0.42 + 0.3 * w * (0.6 + 0.4 * q2), rot: q3 * Math.PI * 2, tone: q });
    if (out.length >= max) return out;
  }
  return out;
}

// ---------------------------------------------------------------- textures (browser: canvas; node: none)
const HAS_DOM = typeof document !== 'undefined';
let SPRIG_TEX = null, FROND_TEX = null;
/**
 * The sprigs the heather is made of (sRGB): the wood, the shoots' scale leaves and the dead flower spikes at the tips,
 * per sprig kind — 0 ling in its autumn grey-purple (the design's #5a4a5a) with rust and faded-purple spikes; 1 young
 * grey-green shoots with straw tips; 2 old flowering stems, a column of rust and grey-straw dead bells on each; 3 old
 * leggy wood, its foliage thin and dark.
 */
// (drawn for the game's camera: a sprig is 20–40 px on screen at the closest zoom, so its strokes are bold — leaves 4–6
// px wide on a 128 px tile — and the colours a little lighter than the design's swatches, which the dusk light darkens)
const SPRIG_KINDS = [
  { wood: ['#3a2b20', '#463427', '#503c2c'], leaf: ['#5e4e5c', '#54454f', '#665765', '#545240', '#5e5048', '#4e4250'], spike: ['#8a5432', '#975e38', '#7a6270', '#a08a68'], spikeP: 0.55, step: 3.2, stems: 10 },
  { wood: ['#413226', '#4c3b2e'], leaf: ['#5f6852', '#6b745c', '#56604a', '#626852', '#5e4e5c'], spike: ['#a08c66', '#8e7e5a'], spikeP: 0.25, step: 3.2, stems: 10 },
  { wood: ['#3a2b20', '#503c2c'], leaf: ['#544838', '#5e5040', '#5e4e5c', '#564a3c'], spike: ['#8a5432', '#975e38', '#a6926c', '#7a6270', '#b09a74'], spikeP: 0.95, step: 3.6, stems: 9 },
  { wood: ['#564a40', '#62564a', '#45382c'], leaf: ['#4a4038', '#564c4c', '#4f4a40', '#5e4e5c'], spike: ['#7e6654', '#8a644c'], spikeP: 0.25, step: 4.4, stems: 8 },
];
/** The crowns seen from above (atlas tiles 4–7), one per sprig kind: the kind's leaves, wood and spikes, how many
 * dead spikes are dotted over it. */
const CROWN_KINDS = SPRIG_KINDS.map((K, k) => ({
  wood: K.wood,
  leaf: k === 1 ? [...K.leaf, ...SPRIG_KINDS[0].leaf.slice(0, 3)] : k === 3 ? [...K.leaf, '#3e3436', '#463a3e'] : K.leaf,
  spike: K.spike, spikes: [16, 8, 40, 6][k],
}));
/** The atlas: 4 × 2 tiles of 128² — 0–3 the upright sprigs (SPRIG_KINDS), 4–7 the crowns (CROWN_KINDS). */
export const ATLAS_COLS = 4, ATLAS_ROWS = 2;
const ATLAS_W = 512, ATLAS_H = 256;
/** Atlas tile `t`'s uv rectangle [u0, v0, u1, v1] (canvas row 0 is uploaded at the top, v = 1). */
export function tileUV(t) {
  const du = 1 / ATLAS_COLS, dv = 1 / ATLAS_ROWS, u0 = (t % ATLAS_COLS) * du, v0 = 1 - (Math.floor(t / ATLAS_COLS) + 1) * dv;
  return [u0 + 0.002, v0 + 0.004, u0 + du - 0.002, v0 + dv - 0.004];
}
/**
 * A heather crown seen from above, drawn into the `T`² tile at (ox, oy): a lobed outline (three octaves of waves round
 * the circle), dark wood under, a mass of scale-leaf strokes over it radiating from a few growing points, holes where
 * the ground shows through, shoots poking out past the outline (longer strokes at the rim, pointing out), and the dead
 * flower spikes dotted over the top. Nothing reaches the tile's edge (no straight cut where the tile ends).
 */
function drawCrown(g, ox, oy, T, K, k) {
  let n = 0;
  const rnd = () => h2(k * 613 + 71, n++, 5501);
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
  const cx = ox + T / 2, cy = oy + T / 2, p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
  const R = (a) => 36 * (1 + 0.2 * Math.sin(3 * a + p1) + 0.13 * Math.sin(5 * a + p2) + 0.09 * Math.sin(9 * a + p3));
  const rimOf = (x, y) => Math.hypot(x - cx, y - cy) / R(Math.atan2(y - cy, x - cx));
  const hole = (x, y) => vnoise((x - ox) / 9, (y - oy) / 9, 300 + k) > 0.76;
  const hubs = Array.from({ length: 4 }, () => { const a = rnd() * 6.28, r = rnd() * 15; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
  const M = 5; // (a stroke's round cap reaches lineWidth / 2 further)
  const stroke = (x, y, a, L) => {
    // (shortened where it would leave the tile)
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = L;
    if (dx > 1e-6) t = Math.min(t, (ox + T - M - x) / dx); else if (dx < -1e-6) t = Math.min(t, (ox + M - x) / dx);
    if (dy > 1e-6) t = Math.min(t, (oy + T - M - y) / dy); else if (dy < -1e-6) t = Math.min(t, (oy + M - y) / dy);
    t = Math.max(0, t);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * t, y + dy * t); g.stroke();
  };
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const [hx, hy] = hubs[i % hubs.length], a = rnd() * 6.28, L = 12 + 22 * rnd();
    g.strokeStyle = pick(K.wood); g.lineWidth = 2.4 + 1.6 * rnd();
    stroke(hx, hy, a, L);
  }
  for (let i = 0; i < 560; i++) {
    const a0 = rnd() * 6.28, rr = Math.sqrt(rnd()), x = cx + Math.cos(a0) * rr * R(a0), y = cy + Math.sin(a0) * rr * R(a0), rim = rr;
    if (hole(x, y)) continue;
    let best = hubs[0], bd = Infinity;
    for (const h of hubs) { const dd = Math.hypot(x - h[0], y - h[1]); if (dd < bd) { bd = dd; best = h; } }
    const a = Math.atan2(y - best[1], x - best[0]) + (rnd() - 0.5) * 1.4, L = rim > 0.8 ? 8 + 9 * rnd() : 5 + 6 * rnd();
    g.strokeStyle = pick(K.leaf); g.lineWidth = 3.6 + 2 * rnd();
    stroke(x, y, a, L);
  }
  for (let i = 0, placed = 0; i < 400 && placed < K.spikes; i++) {
    const x = cx + (rnd() - 0.5) * 100, y = cy + (rnd() - 0.5) * 100;
    if (rimOf(x, y) > 0.92 || hole(x, y)) continue;
    g.fillStyle = pick(K.spike);
    g.beginPath(); g.arc(x, y, 2.2 + 1.4 * rnd(), 0, Math.PI * 2); g.fill();
    placed++;
  }
  g.restore();
}
/**
 * The heather atlas (512 × 256, alpha-cut; tiles in ATLAS_COLS × ATLAS_ROWS of 128²): in tiles 0–3 one sprig of `SPRIG_KINDS[k]` rooted at the tile's
 * bottom — wiry stems branching up and out, each shoot thick with scale leaves (short strokes either side, two to three
 * pixels wide so they survive the mip chain), dead flower spikes at the tips. The transparent texels carry the
 * sprig's own mean colour (no dark fringe where the alpha cut filters).
 */
function sprigTexture() {
  if (SPRIG_TEX || !HAS_DOM) return SPRIG_TEX;
  const NW = ATLAS_W, NH = ATLAS_H, T = 128, c = document.createElement('canvas'); c.width = NW; c.height = NH;
  const g = c.getContext('2d');
  g.clearRect(0, 0, NW, NH);
  g.lineCap = 'round'; g.lineJoin = 'round';
  SPRIG_KINDS.forEach((K, kind) => {
    const ox = (kind % ATLAS_COLS) * T, oy = Math.floor(kind / ATLAS_COLS) * T;
    let n = 0;
    const rnd = () => h2(kind * 977 + 31, n++, 4409);
    const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
    g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
    const shoots = [];
    // the wood: stems from the root, branching twice, each a wobbling polyline tapering as it climbs
    const M = 14; // (room for the leaves round a tip: no sprig meets its tile's edge, which would cut it off straight)
    const branch = (x, y, ang, len, w, depth) => {
      const n0 = Math.max(3, Math.round(len / 6)), pts = [[x, y]];
      let a = ang;
      for (let s = 0; s < n0; s++) {
        a += (rnd() - 0.5) * 0.42 + (-Math.PI / 2 - a) * 0.06; // wander, pulled back towards the light
        const nx = x + Math.cos(a) * (len / n0), ny = y + Math.sin(a) * (len / n0);
        if (nx < ox + M || nx > ox + T - M || ny < oy + M) break;
        x = nx; y = ny;
        pts.push([x, y]);
      }
      const segs = pts.length - 1;
      if (segs < 1) return;
      g.strokeStyle = pick(K.wood);
      for (let s = 0; s < segs; s++) {
        g.lineWidth = Math.max(2.2, w * (1 - (0.55 * s) / segs));
        g.beginPath(); g.moveTo(pts[s][0], pts[s][1]); g.lineTo(pts[s + 1][0], pts[s + 1][1]); g.stroke();
      }
      shoots.push({ pts, depth });
      if (depth < 2 && segs >= 2) {
        const kids = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < kids; k++) {
          const t = 0.3 + 0.5 * rnd(), i = Math.min(segs - 1, Math.floor(t * segs)), [bx, by] = pts[i];
          const da = (0.3 + 0.5 * rnd()) * (rnd() < 0.5 ? -1 : 1);
          branch(bx, by, Math.atan2(pts[i + 1][1] - by, pts[i + 1][0] - bx) + da, len * (0.4 + 0.22 * rnd()), w * 0.7, depth + 1);
        }
      }
    };
    for (let s = 0; s < K.stems; s++) {
      const x = ox + T / 2 + (rnd() - 0.5) * 30, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.5;
      branch(x, oy + T - 3, ang, 58 + 56 * rnd(), kind === 3 ? 6 : 5, 0);
    }
    // the shoots: scale leaves along the upper four fifths of every branch, either side, angled up — bold, a body of
    // foliage with holes, the outline ragged with shoot tips
    for (const { pts, depth } of shoots) {
      const L = pts.length - 1;
      for (let s = Math.floor(L * 0.2); s < L; s++) {
        const [x0, y0] = pts[s], [x1, y1] = pts[s + 1], seg = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
        for (let u = 0; u < seg; u += K.step) {
          const px = x0 + (x1 - x0) * (u / seg), py = y0 + (y1 - y0) * (u / seg);
          for (const sg of [-1, 1]) {
            if (rnd() < (kind === 3 ? 0.4 : 0.1)) continue;
            const la = a + sg * (0.35 + 0.55 * rnd()), ll = 6 + 7 * rnd();
            g.strokeStyle = pick(K.leaf); g.lineWidth = 4.2 + 2.2 * rnd();
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(la) * ll, py + Math.sin(la) * ll); g.stroke();
          }
        }
      }
      // the dead flower spikes: a column of bells along the last third of a twig
      if (depth >= 1 && rnd() < K.spikeP) {
        for (let s = Math.floor(L * 0.6); s < L; s++) {
          const [x0, y0] = pts[s], [x1, y1] = pts[s + 1], seg = Math.hypot(x1 - x0, y1 - y0);
          for (let u = 0; u < seg; u += 4.2) {
            const px = x0 + (x1 - x0) * (u / seg) + (rnd() - 0.5) * 5, py = y0 + (y1 - y0) * (u / seg);
            g.fillStyle = pick(K.spike);
            g.beginPath(); g.arc(px, py, 2.8 + 1.8 * rnd(), 0, Math.PI * 2); g.fill();
          }
        }
      }
    }
    g.restore();
  });
  CROWN_KINDS.forEach((K, k) => drawCrown(g, ((4 + k) % ATLAS_COLS) * T, Math.floor((4 + k) / ATLAS_COLS) * T, T, K, k));
  // (the transparent texels take their tile's mean colour: filtered at the alpha cut, an edge darkens no further. A
  // canvas keeps its pixels premultiplied — a texel with no alpha keeps no colour — so the atlas goes up as data)
  const img = g.getImageData(0, 0, NW, NH), d = img.data;
  for (let tile = 0; tile < ATLAS_COLS * ATLAS_ROWS; tile++) {
    const ox = (tile % ATLAS_COLS) * T, oy = Math.floor(tile / ATLAS_COLS) * T;
    let r = 0, gg = 0, b = 0, w = 0;
    for (let y = oy; y < oy + T; y++) for (let x = ox; x < ox + T; x++) { const k = (y * NW + x) * 4, a = d[k + 3] / 255; r += d[k] * a; gg += d[k + 1] * a; b += d[k + 2] * a; w += a; }
    if (w > 0) { r /= w; gg /= w; b /= w; }
    for (let y = oy; y < oy + T; y++) for (let x = ox; x < ox + T; x++) {
      const k = (y * NW + x) * 4;
      if (d[k + 3] === 0) { d[k] = r; d[k + 1] = gg; d[k + 2] = b; } // (getImageData is un-premultiplied: edge texels keep their stroke's colour)
    }
  }
  // rows bottom-up (v = 0 at the canvas's foot, as a flipped canvas texture would have it)
  const data = new Uint8Array(NW * NH * 4);
  for (let y = 0; y < NH; y++) data.set(d.subarray((NH - 1 - y) * NW * 4, (NH - y) * NW * 4), y * NW * 4);
  SPRIG_TEX = new THREE.DataTexture(data, NW, NH, THREE.RGBAFormat);
  SPRIG_TEX.colorSpace = THREE.SRGBColorSpace;
  SPRIG_TEX.magFilter = THREE.LinearFilter;
  SPRIG_TEX.minFilter = THREE.LinearMipmapLinearFilter;
  SPRIG_TEX.generateMipmaps = true;
  SPRIG_TEX.anisotropy = 4;
  SPRIG_TEX.needsUpdate = true;
  return SPRIG_TEX;
}
/** A dead bracken frond (64 × 256, alpha): a rachis up the middle, alternate pinnae tapering to the tip, curled ends. */
function frondTexture() {
  if (FROND_TEX || !HAS_DOM) return FROND_TEX;
  const Wd = 64, H = 256, c = document.createElement('canvas'); c.width = Wd; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, Wd, H);
  g.lineCap = 'round';
  for (let k = 0; k < 22; k++) {
    const t = k / 22, y = H - 14 - t * (H - 26), len = (Wd / 2 - 3) * Math.sin(Math.PI * (0.18 + 0.82 * (1 - t))) * (0.75 + 0.25 * h2(k, 1, 4));
    for (const sgn of [-1, 1]) {
      const yy = y + (sgn > 0 ? 3 : 0), shade = 150 + 60 * h2(k, sgn + 3, 2);
      g.strokeStyle = `rgb(${shade}, ${Math.round(shade * 0.55)}, ${Math.round(shade * 0.26)})`;
      g.lineWidth = 4.5 * (1 - 0.6 * t);
      g.beginPath(); g.moveTo(Wd / 2, yy); g.quadraticCurveTo(Wd / 2 + sgn * len * 0.6, yy - 4, Wd / 2 + sgn * len, yy - 9 - 6 * t); g.stroke();
      // the pinnules: short ticks along each pinna
      g.lineWidth = 2;
      for (let m = 1; m < 5; m++) { const u = m / 5, px = Wd / 2 + sgn * len * u, py = yy - (9 + 6 * t) * u * u; g.beginPath(); g.moveTo(px, py); g.lineTo(px + sgn * 2, py + 4); g.stroke(); }
    }
  }
  g.strokeStyle = 'rgb(118, 70, 36)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(Wd / 2, H); g.lineTo(Wd / 2, 10); g.stroke();
  FROND_TEX = new THREE.CanvasTexture(c);
  FROND_TEX.colorSpace = THREE.SRGBColorSpace;
  FROND_TEX.anisotropy = 4;
  return FROND_TEX;
}

// ---------------------------------------------------------------- geometry
/** Per-sprig tones (multipliers on the drawn sprig): ling grey-purple, peat-brown, rust, grey-green, faded straw-grey. */
const SPRIG_TONES = [[0.94, 0.9, 0.98], [0.82, 0.75, 0.68], [1.02, 0.82, 0.7], [0.86, 0.95, 0.86], [1.0, 0.96, 0.9]];
const TONE_W = [0.36, 0.22, 0.16, 0.16, 0.1];
/** Sprig kinds' weights per clump variant: [ling, shoots, spikes, old wood]. */
const KIND_MIX = [[0.5, 0.15, 0.25, 0.1], [0.34, 0.36, 0.14, 0.16], [0.3, 0.1, 0.46, 0.14], [0.44, 0.18, 0.16, 0.22]];

/**
 * One heather clump (pure; unit reach — its sprigs root within a radius of about 1 — and unit height): a crowd of sprig
 * cards, no surface of its own. Its footprint is a ragged lobed outline (two octaves of noise round the circle: deep
 * bays, never a disc); its top a noise field over the footprint, tall here and low there, falling off to the rim — where
 * it drops too low a sprig is left out and the ground shows through. Each sprig is a card (sometimes a crossed pair)
 * rooted under the ground, leaning out more the nearer the rim, its own height, width, kind of sprig (atlas tile) and
 * tone; three to five crown mats (atlas tiles 4–7) overlap over the middle at half to four fifths of the local top,
 * sloping down towards the rim, and a few sprigs lie across them, so from above the clump has a body of shoots with
 * bristly twigs over it, never a lid. Normals follow the clump's volume (out from a centre under the ground and up,
 * each card tilted a little its own way); the upright sprigs' colours darken to the root.
 * @param {number} variant
 * @returns {{pos:number[], nor:number[], uv:number[], col:number[], idx:number[], cards:number, height:number, reach:number, tiles:number[]}}
 */
export function heatherClump(variant) {
  let n = 0;
  const rnd = () => h2(variant * 7919 + 13, n++, 4271);
  const pos = [], nor = [], uv = [], col = [], idx = [], tiles = [];
  const ph = rnd() * 10;
  const edge = (a) => 0.6 + 0.58 * vnoise(Math.cos(a) * 1.4 + ph, Math.sin(a) * 1.4 - ph, 51 + variant)
    + 0.28 * (vnoise(Math.cos(a) * 3.3 + 2 * ph, Math.sin(a) * 3.3 + ph, 57 + variant) - 0.5);
  const top = (x, z, d) => (1 - 0.6 * d * d) * (0.42 + 0.78 * vnoise(x * 1.9 + ph, z * 1.9 - ph, 61 + variant))
    * (0.82 + 0.36 * vnoise(x * 4.3 - ph, z * 4.3 + ph, 67 + variant));
  const mix = KIND_MIX[variant % KIND_MIX.length];
  const pickW = (w) => { let t = rnd() * w.reduce((a, b) => a + b, 0); for (let k = 0; k < w.length; k++) { t -= w[k]; if (t <= 0) return k; } return 0; };
  /** A card rooted at (x, y0, z): `w` wide, `h` long up its own axis — tilted `lean` rad from upright towards azimuth
   * `dir` — its face turned to yaw `yaw`; atlas `tile`, tone `tone`; mirrored when `flip`. */
  const card = (x, z, y0, w, h, yaw, lean, dir, tile, tone, flip) => {
    const ux = Math.sin(lean) * Math.cos(dir), uy = Math.cos(lean), uz = Math.sin(lean) * Math.sin(dir);
    let wx = Math.cos(yaw), wy = 0, wz = Math.sin(yaw);
    const dd = wx * ux + wz * uz; wx -= dd * ux; wy -= dd * uy; wz -= dd * uz;
    let wl = Math.hypot(wx, wy, wz);
    if (wl < 0.2) { wx = -Math.sin(dir); wy = 0; wz = Math.cos(dir); wl = 1; } // (face turned along its lean: square it)
    wx /= wl; wy /= wl; wz /= wl;
    const hw = w / 2, b = pos.length / 3;
    const P = [[x - wx * hw, y0 - wy * hw, z - wz * hw], [x + wx * hw, y0 + wy * hw, z + wz * hw]];
    P.push([P[1][0] + ux * h, P[1][1] + uy * h, P[1][2] + uz * h], [P[0][0] + ux * h, P[0][1] + uy * h, P[0][2] + uz * h]);
    const jx = (rnd() - 0.5) * 0.6, jz = (rnd() - 0.5) * 0.6;
    for (const p of P) {
      pos.push(...p);
      // (the clump's volume: out from a centre under the ground — the tops face the sky, the rim faces out, the side
      // away from the sun goes dark)
      const nx = p[0] + jx, ny = (p[1] + 0.45) * 0.9, nz = p[2] + jz, nl = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / nl, ny / nl, nz / nl);
    }
    const [u0, v0, u1, v1] = tileUV(tile), [ua, ub] = flip ? [u1, u0] : [u0, u1];
    uv.push(ua, v0, ub, v0, ub, v1, ua, v1);
    const [tr, tg, tb] = SPRIG_TONES[tone], kr = 0.5 + 0.1 * rnd();
    col.push(tr * kr, tg * kr, tb * kr, tr * kr, tg * kr, tb * kr, tr, tg, tb, tr, tg, tb);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    tiles.push(tile);
  };
  /** A crown mat centred at (x, y, z): `w` × `l`, its face tilted `tilt` rad from level, sloping down towards azimuth
   * `dir`, turned to yaw `yaw` in its plane; atlas `tile` (a crown), tone `tone`. */
  const crown = (x, z, y, w, l, yaw, tilt, dir, tile, tone) => {
    const nx0 = Math.sin(tilt) * Math.cos(dir), ny0 = Math.cos(tilt), nz0 = Math.sin(tilt) * Math.sin(dir);
    let ux = Math.cos(yaw), uy = 0, uz = Math.sin(yaw);
    const dd = ux * nx0 + uz * nz0; ux -= dd * nx0; uy -= dd * ny0; uz -= dd * nz0;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const vx = ny0 * uz - nz0 * uy, vy = nz0 * ux - nx0 * uz, vz = nx0 * uy - ny0 * ux, hw = w / 2, hl = l / 2, b = pos.length / 3;
    const jx = (rnd() - 0.5) * 0.4, jz = (rnd() - 0.5) * 0.4;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [x + ux * hw * su + vx * hl * sv, y + uy * hw * su + vy * hl * sv, z + uz * hw * su + vz * hl * sv];
      pos.push(...p);
      const nx = p[0] + jx, ny = (p[1] + 0.45) * 0.9, nz = p[2] + jz, nl = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / nl, ny / nl, nz / nl);
    }
    const [u0, v0, u1, v1] = tileUV(tile);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const [tr, tg, tb] = SPRIG_TONES[tone], k = 0.74 + 0.14 * rnd();
    for (let q = 0; q < 4; q++) col.push(tr * k, tg * k, tb * k);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    tiles.push(tile);
  };
  // the standing sprigs
  const N = 34 + Math.floor(rnd() * 11);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, e = edge(a), r = Math.sqrt(rnd()) * e * 0.96, d = r / e;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ht = top(x, z, d);
    if (ht < 0.2) continue; // (a gap in the clump: the ground shows through)
    const h = ht * (0.72 + 0.45 * rnd()), w = 0.3 + 0.28 * rnd();
    // (shoots stand up; the rim's lean out a little more — never lie down flat, which reads as leaf litter from above)
    const lean = 0.06 + 0.42 * Math.pow(d, 1.3) + 0.14 * rnd(), dir = a + (rnd() - 0.5) * 1.2, yaw = rnd() * Math.PI * 2;
    const tile = pickW(mix), tone = pickW(TONE_W);
    card(x, z, -0.08, w, h, yaw, lean, dir, tile, tone, rnd() < 0.5);
    if (rnd() < 0.42) card(x, z, -0.08, w * (0.8 + 0.3 * rnd()), h * (0.82 + 0.2 * rnd()), yaw + Math.PI / 2 + (rnd() - 0.5) * 0.5, lean * (0.7 + 0.5 * rnd()), dir + (rnd() - 0.5) * 0.8, pickW(mix), pickW(TONE_W), rnd() < 0.5);
  }
  // the crown: a few mats of shoots seen from above (crown tiles: a lobed, holed mass of scale leaves with shoots poking
  // out past its outline), overlapping over the clump's middle at their own heights and tilts, sloping down towards the
  // rim — the body that a crowd of upright sprigs alone leaves see-through from the game's high camera. The upright
  // sprigs stand through and above them: the ragged top and outline
  const K = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < K; i++) {
    const a = rnd() * Math.PI * 2, e = edge(a), r = Math.sqrt(rnd()) * e * 0.5, d = r / e;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ht = top(x, z, d), size = (0.78 + 0.4 * rnd()) * Math.min(1.1, e);
    const tilt = 0.16 + 0.26 * rnd() + 0.3 * d, dir = a + (rnd() - 0.5) * 0.8;
    crown(x, z, Math.max(0.12, ht * (0.48 + 0.3 * rnd())), size * (0.85 + 0.3 * rnd()), size * (0.85 + 0.3 * rnd()), rnd() * Math.PI * 2, tilt, dir, 4 + pickW(mix), pickW(TONE_W));
  }
  // the sprigs lying across the top (seen from above: twigs over the crown), rooted inside the clump
  const M = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < M; i++) {
    const a = rnd() * Math.PI * 2, e = edge(a), r = Math.sqrt(rnd()) * e * 0.6, d = r / e;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, ht = top(x, z, d);
    card(x, z, ht * (0.3 + 0.25 * rnd()), 0.3 + 0.18 * rnd(), 0.36 + 0.2 * rnd(), rnd() * Math.PI * 2, 0.7 + 0.3 * rnd(), rnd() * Math.PI * 2, pickW(mix), pickW(TONE_W), rnd() < 0.5);
  }
  let height = 0, reach = 0;
  for (let i = 0; i < pos.length; i += 3) { height = Math.max(height, pos[i + 1]); reach = Math.max(reach, Math.hypot(pos[i], pos[i + 2])); }
  return { pos, nor, uv, col, idx, cards: idx.length / 6, height, reach, tiles };
}

/** A heather clump's geometry (heatherClump into a BufferGeometry). */
function heatherGeometry(variant) {
  const C = heatherClump(variant), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(C.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(C.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(C.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C.col, 3));
  g.setIndex(C.idx);
  return g;
}

/**
 * Dead bracken (unit size): `F` frond cards fanning out of the root, each a strip of 5 pieces arching up and out and
 * drooping at the tip, the frond drawn along it (v = 0 at the root, 1 at the tip); a little twist per frond.
 */
function brackenGeometry(variant) {
  const F = variant ? 8 : 6, S = 5, pos = [], uv = [], col = [], idx = [];
  for (let f = 0; f < F; f++) {
    const a = (f / F) * Math.PI * 2 + (h2(f, 1, 4 + variant) - 0.5) * 0.8, ca = Math.cos(a), sa = Math.sin(a);
    const reach = 0.55 + h2(f, 2, 4 + variant) * 0.5, lift = 0.6 + h2(f, 3, 4 + variant) * 0.45, wd = 0.13 + 0.05 * h2(f, 5, 4);
    const tw = (h2(f, 6, 4 + variant) - 0.5) * 0.9;
    const base = pos.length / 3;
    for (let s = 0; s <= S; s++) {
      const t = s / S, r = reach * t, y = lift * (Math.sin(t * Math.PI * 0.82) * 1.05 - 0.22 * t * t) - 0.05;
      const w = wd * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95))), roll = tw * t;
      const wx = -sa * Math.cos(roll), wz = ca * Math.cos(roll), wy = Math.sin(roll);
      pos.push(ca * r - wx * w, y - wy * w, sa * r - wz * w, ca * r + wx * w, y + wy * w, sa * r + wz * w);
      uv.push(0, t, 1, t);
      const k = 0.7 + 0.3 * t; col.push(k, k, k, k, k, k);
    }
    for (let s = 0; s < S; s++) { const p = base + s * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The heath's instanced clumps for world `w` (needs w.grid; the drawn ground from w.terrain.surfaceAt when ready).
 * `opts`: heathPlan options; `paths` default to the mission's terrain paths.
 * @returns {THREE.Group|null}
 */
export function buildHeath(w, opts = {}) {
  const g = w?.grid;
  if (!g?.terrain || !g.cell) return null;
  const paths = opts.paths ?? (w.mission?.terrain || []).filter((t) => t.type === 'path' && Array.isArray(t.points)).map((t) => ({ points: t.points, width: t.width }));
  const plan = heathPlan(g, { ...opts, paths });
  const real = !!(w.terrain?.real && typeof w.terrain.surfaceAt === 'function');
  const ground = real ? (x, z) => { const y = w.terrain.surfaceAt(x, z); return Number.isFinite(y) ? y : 0; } : () => 0;
  const group = new THREE.Group();
  group.name = 'e05:heath';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
  // heather: alpha-cut sprig cards, both faces lit by the clump's own volume normal (three turns a back face's normal
  // round: turned back again here, so a card seen from behind is not dark)
  const heatherMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, map: sprigTexture(), alphaTest: 0.42, transparent: false });
  heatherMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n\tnormal *= faceDirection;\n\tnonPerturbedNormal = normal;\n#endif')
      // (the sprigs' coverage through the mip chain: each level down averages the strokes with the gaps between them
      // and the alpha cut would thin a distant clump to nothing — the alpha is raised by the level the texel is
      // sampled at, so a clump keeps its body at every zoom)
      .replace('#include <alphatest_fragment>',
        '{ vec2 sx = dFdx( vMapUv * vec2( 512.0, 256.0 ) ), sy = dFdy( vMapUv * vec2( 512.0, 256.0 ) );\n\tfloat lod = max( 0.0, 0.5 * log2( max( dot( sx, sx ), dot( sy, sy ) ) ) );\n\tdiffuseColor.a *= 1.0 + 0.32 * lod; }\n#include <alphatest_fragment>');
  };
  heatherMat.customProgramCacheKey = () => 'e05heather';
  const brackenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, map: frondTexture(), alphaTest: 0.45, transparent: false });
  const sets = [
    ...Array.from({ length: HEATHER_VARIANTS }, (_, v) => ['heather', v, heatherGeometry(v), heatherMat]),
    ...[0, 1].map((v) => ['bracken', v, brackenGeometry(v), brackenMat]),
  ];
  for (const [kind, v, geo, mat] of sets) {
    const list = plan.filter((p) => p.kind === kind && p.v === v);
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, k) => {
      Q.setFromAxisAngle(Y, p.rot);
      // (sunk a little: the sprigs' roots under the ground's own unevenness)
      P.set(p.x, ground(p.x, p.z) - 0.02, p.z);
      if (kind === 'heather') S.set(p.s * (0.88 + 0.24 * p.tone), p.h, p.s * (1.12 - 0.24 * p.tone)); else S.set(p.s, p.h, p.s);
      M.compose(P, Q, S);
      m.setMatrixAt(k, M);
      // heather: a clump's cast over its sprigs' own mottle — most the drawn ling, some greyer-green at a drift's heart,
      // some gone russet; bracken: tawny to rust (winter-dead). sRGB (the working space is linear: these read pastel)
      if (kind === 'heather') {
        const gr = ss(0.55, 0.85, p.hue), ru = ss(0.45, 0.15, p.hue), j = 0.94 + 0.12 * p.tone;
        C.setRGB(j * (0.8 - 0.06 * gr + 0.1 * ru), j * (0.74 + 0.1 * gr - 0.0 * ru), j * (0.8 - 0.06 * gr - 0.12 * ru), THREE.SRGBColorSpace);
      } else C.setRGB(0.95 + 0.05 * p.tone, 0.84 + 0.1 * p.tone, 0.78 + 0.06 * p.tone, THREE.SRGBColorSpace);
      m.setColorAt(k, C);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.name = `e05:heath:${kind}${v}`;
    // (each clump throws its own ragged shadow — the alpha-cut sprigs in the sun's depth pass — at the presets whose
    // grass casts, high and ultra: without it a clump read as a flat stain on the ground; review r3. The preset is read
    // as the shadow map is drawn, so a preset switched mid-mission follows, as the grass's own rebuild does)
    Object.defineProperty(m, 'castShadow', { get: () => heathCastsShadow(w), set() {}, configurable: true, enumerable: true });
    m.receiveShadow = true;
    // (out of the GTAO prepass, as the base game's grass and tree cards: a crowd of crossed cards occludes itself to
    // black there; a clump's own shade is in its colours, darker to the roots)
    m.userData.aoExclude = true;
    group.add(m);
  }
  return group;
}

/** Whether the heath casts shadows in world `w` now: as the grass does, at the terrain's quality preset (shadowsGrass). */
export function heathCastsShadow(w) {
  return !!TERRAIN_QUALITY[w?.terrain?.quality]?.shadowsGrass;
}
