/**
 * Forest AREA structures (a tree/pine type with `points`, e.g. M04 and M20 `variant: 'forest'`) → seeded
 * Poisson-disc tree placements inside the polygon (docs/vegetation.md §3.10). The area's gameplay footprint is
 * unchanged (map-builder blocks it as before); this only draws the wood that was missing. Edge trees are larger and
 * kept unique; interior trees are impostor candidates (hero: false).
 * @module terrain/forest-fill
 */
import { rng, fbm, vnoise } from './noise.js';

const pt = (p) => (Array.isArray(p) ? p : [p.x, p.z]);

/** Point-in-polygon (even-odd). */
export function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the polygon outline. */
function edgeDist(x, z, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L));
    d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return d;
}

/**
 * @param {{type:string, variant?:string, points:Array, seed?:number, h?:number}} def forest area
 * @param {(d:object, k:number)=>object|null} place treePlacement(def, theater, k) bound to the theatre
 * @param {{spacing?:number, max?:number, occupied?:Array<{x:number,z:number}>}} [o] occupied: trees the mission already
 *   placed (point trees, scatter) — seeded into the Poisson grid so the fill never stands a twin trunk beside them
 * @returns {object[]} placements (treePlacement results with hero/scale set)
 */
export function fillForest(def, place, o = {}) {
  if (!Array.isArray(def?.points) || def.points.length < 3) return [];
  const poly = def.points.map(pt);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const seed0 = def.seed ?? Math.floor(Math.abs(x0 * 7919 + z0 * 104729 + x1 * 31 + z1 * 17)) + 4049;
  const r = rng(seed0);
  const sp = o.spacing ?? 4.4, cell = sp / Math.SQRT2, max = o.max ?? 700;
  const cols = Math.ceil((x1 - x0) / cell) + 1, grid = new Map(), out = [];
  const near = (x, z, d) => {
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const q = grid.get((cj + b) * cols + ci + a);
      if (q && Math.hypot(q[0] - x, q[1] - z) < d) return true;
    }
    return false;
  };
  // the mission's own trees in / near the polygon are occupied seeds (critic: M04 scatter + fill = interpenetrating twins)
  const seeds = [];
  for (const q of o.occupied || []) if (q.x > x0 - sp && q.x < x1 + sp && q.z > z0 - sp && q.z < z1 + sp) seeds.push([q.x, q.z]);
  const nearSeed = (x, z, d) => { for (const q of seeds) if (Math.hypot(q[0] - x, q[1] - z) < d) return true; return false; };
  const tries = Math.ceil(((x1 - x0) * (z1 - z0)) / (sp * sp) * 6);
  for (let k = 0; k < tries && out.length < max; k++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
    if (!inPoly(x, z, poly)) continue;
    const e = edgeDist(x, z, poly);
    if (e < 0.8) continue;                                             // trunks stay inside the footprint
    const d = sp * (0.8 + 0.45 * r()) * (e < 4 ? 0.85 : 1);            // denser, fuller edge
    if (near(x, z, d) || nearSeed(x, z, d)) continue;
    grid.set(Math.floor((z - z0) / cell) * cols + Math.floor((x - x0) / cell), [x, z]);
    const p = place({ type: def.type, variant: def.forestVariant ?? def.variant, x, z, h: def.h ? def.h * (0.75 + 0.4 * r()) : undefined, seed: (seed0 + out.length * 7919) >>> 0 }, out.length);
    if (!p) continue;
    p.hero = e < 4 && r() < 0.5;                                       // part of the edge stays unique
    p.fill = true;                                                     // interior: impostor candidate (vegetation.js maxVisualUnique)
    out.push(p);
  }
  return out;
}

/**
 * Hedgerow (bocage) along a polyline → seeded placements: overlapping field-hedge crowns (hawthorn / blackthorn
 * 'hedge', hazel, the odd shrub) every ~1.5 m with a ragged run, skipping `gaps` ([from, to] metres along the line,
 * e.g. a field gate), plus standard trees (oak, ash) every 10–20 m. Visual (mission.vegetation.hedgerows): a mission
 * that wants the hedge to block or give cover places matching bush / wall structures; walkers brushing through a
 * visual hedge part it (vegetation.agitate).
 * @param {{points:Array, gaps?:number[][], seed?:number, h?:number, standards?:boolean}} def
 * @returns {object[]} placements for createVegetation
 */
export function hedgerowPlacements(def) {
  if (!Array.isArray(def?.points) || def.points.length < 2) return [];
  const pts = def.points.map(pt);
  const r = rng(def.seed ?? Math.floor(Math.abs(pts[0][0] * 7919 + pts[0][1] * 104729)) + 911);
  const out = [], H = def.h ?? 2.6;
  let s = 0, nextStd = 6 + r() * 10;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < L; d += (def.spacing ?? 1.2) + r() * 0.7) {
      const at = s + d;
      if ((def.gaps || []).some(([g0, g1]) => at >= g0 && at <= g1)) continue;
      const t = d / L, x = ax + (bx - ax) * t + (r() - 0.5) * 0.5, z = az + (bz - az) * t + (r() - 0.5) * 0.5;
      const k = r();
      const species = k < 0.55 ? 'hedge' : k < 0.85 ? 'hazel' : 'shrub';
      out.push({ species, x, z, seed: Math.floor(r() * 1e9), scale: (H / 2.6) * (0.75 + 0.45 * r()) * (def.spacing ? Math.sqrt(def.spacing / 1.2) : 1), hero: def.hero ?? true });
      if (def.standards !== false && at >= nextStd) {
        out.push({ species: r() < 0.6 ? 'oak' : 'ash', x: x + (r() - 0.5), z: z + (r() - 0.5), seed: Math.floor(r() * 1e9), scale: 0.65 + 0.3 * r(), hero: true });
        nextStd = at + 10 + r() * 10;
      }
    }
    s += L;
  }
  return out;
}

/**
 * Forest understorey (visual only, inside the area's footprint): brambles, hazel and the odd shrub in the lighter
 * gaps, fallen boughs on the litter. Sparse (≈ 1 per 70 m²) and kept 1 m inside the outline.
 * @param {{points:Array, seed?:number}} def forest area
 * @returns {object[]} placements for createVegetation (fallen boughs unique; brambles / hazel impostor candidates)
 */
export function forestUnderstorey(def, theater = 'temperate') {
  if (!Array.isArray(def?.points) || def.points.length < 3) return [];
  const poly = def.points.map(pt);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const r = rng((def.seed ?? Math.floor(Math.abs(x0 * 131 + z1 * 977))) + 6151), out = [];
  const n = Math.min(160, Math.round(((x1 - x0) * (z1 - z0)) / 70));
  for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
    if (!inPoly(x, z, poly) || edgeDist(x, z, poly) < 1) continue;
    k++;
    const u = r(), seed = Math.floor(r() * 1e9);
    if (u < 0.42) out.push({ species: 'fallen', x, z, seed, scale: 0.7 + 0.6 * r(), hero: true, understorey: true });
    else if (theater === 'snow') continue;                       // brambles and hazel stay under the snow
    else if (u < 0.75) out.push({ species: 'bramble', x, z, seed, scale: 0.8 + 0.5 * r(), hero: false, understorey: true });
    else out.push({ species: u < 0.92 ? 'hazel' : 'shrub', x, z, seed, scale: 0.6 + 0.35 * r(), hero: false, understorey: true });
  }
  return out;
}

/**
 * Forest floor for the splat (buildSplat opts.paint): under the forest areas plus a ~3.5 m crown-overhang margin,
 * the meadow gives way to brown leaf litter (broadleaf woods) or needle duff (spruce / pine: dark dirt with litter
 * patches), feathered by noise at the edge. Grass layers drop out, so no tufts grow under the canopy.
 * @param {object[]} forests forest area defs ({type, variant, points})
 * @param {string[]} layers the theatre palette's layer names
 * @returns {((x:number, z:number, w:Float32Array)=>void)|null}
 */
export function forestFloorPainter(forests, layers) {
  const iL = layers.indexOf('leaves'), iD = layers.indexOf('dirt');
  const grassy = ['grass', 'grassdry', 'snow', 'snowold', 'sand', 'sand2'].map((n) => layers.indexOf(n)).filter((i) => i >= 0);
  if (iL < 0 || iD < 0 || !forests?.length) return null;
  const M = 3.5, areas = [];
  for (const f of forests) {
    if (!Array.isArray(f?.points) || f.points.length < 3) continue;
    const poly = f.points.map(pt);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    x0 -= M + 1; z0 -= M + 1; x1 += M + 1; z1 += M + 1;
    const W = Math.ceil(x1 - x0) + 1, D = Math.ceil(z1 - z0) + 1, cov = new Float32Array(W * D);
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const x = x0 + i, z = z0 + j;
      cov[j * W + i] = inPoly(x, z, poly) ? 1 : Math.max(0, 1 - edgeDist(x, z, poly) / M);
    }
    areas.push({ x0, z0, x1, z1, W, D, cov, needle: f.type === 'pine' ? 0.7 : 0.15 });
  }
  return (x, z, w) => {
    for (const a of areas) {
      if (x < a.x0 || z < a.z0 || x >= a.x1 - 1 || z >= a.z1 - 1) continue;
      const fx = x - a.x0, fz = z - a.z0, i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, c = a.cov, W = a.W;
      const cv = (c[j * W + i] * (1 - tx) + c[j * W + i + 1] * tx) * (1 - tz) + (c[(j + 1) * W + i] * (1 - tx) + c[(j + 1) * W + i + 1] * tx) * tz;
      if (cv <= 0) continue;
      const n = fbm(x / 6, z / 6, 3, 4211), e = vnoise(x * 0.9, z * 0.9, 4213);
      const f = Math.min(1, Math.max(0, cv * 1.5 - 0.25 + (e - 0.5) * 0.6));   // ragged edge
      if (f <= 0) continue;
      let g = 0;
      for (const k of grassy) { g += w[k] * f; w[k] *= 1 - f; }
      const duff = a.needle > 0.5 ? (n < 0.6 ? 0.75 : 0.25) : (n > 0.62 ? 0.4 : 0.08);   // needle duff vs leaf litter patches
      w[iL] += g * (1 - duff); w[iD] += g * duff;
    }
  };
}
