/**
 * Continuous shore field (user request 2026-09-30: "make the edges of the shore more smooth and less polygonal").
 *
 * A signed distance (m, > 0 in water, < 0 on land) to every shoreline of a map, sampled on a fine lattice
 * (`res`, 0.25 m: half a nav cell) and read bilinearly, built from the mission's own water shapes instead of the
 * 0.5 m nav cells:
 *  - `path` features (rivers): the centreline and its per-point widths are smoothed (smoothCurve: sharp corners
 *    pre-cut, then limited Chaikin corner cutting — never more than ~0.5 m from the authored shape) → a smooth
 *    tapered ribbon with flat ends (as grid.fillLine);
 *  - `poly` / `rect` features (lakes, fjords, reservoirs, canals): the outline, smoothed the same way; edges that
 *    run along / outside the map boundary are open water, not shore (they never draw a bank at the map edge);
 *  - `circle` features (islets, ponds): true circles;
 *  - features compose in mission order like the nav raster (later ones win: an islet disc cuts the river), with a
 *    1.6 m smooth union / subtraction so shapes that meet get a fillet instead of a crease.
 * Wherever the nav grid's wet cells disagree with the analytic shapes by more than a cell (structure footprints,
 * the apron's extruded shores, roads), the field falls back to an exact Euclidean distance of the cell mask,
 * smoothed, blended in over a couple of metres. A gentle low-frequency noise (±~0.25 m) keeps banks from looking
 * machine-drawn. The deep-water field (`deep`) is the wet field shifted in by `shoreShallowWidth` (the nav shore
 * rim, map-builder applyShoreShallows) plus explicit shallow features.
 *
 * Consumers: the terrain carve and apron carve (art/terrain/terrain.js, art/apron.js), the ground splat's wet line
 * (terrain-layers buildSplat), the water bake's shore distance (foam, ice rim) and the water mask. Gameplay keeps the
 * nav grid: its wet cells agree with the sign of this field everywhere but within ~one cell of the drawn shore
 * (tests/unit/shore-field.test.mjs). Pure (no three.js / DOM).
 * @module world/shore-field
 */
import { T } from './grid.js';

const isWet = (c) => c === T.WATER || c === T.SHALLOW;
const CODES = { ground: T.GROUND, road: T.ROAD, sand: T.SAND, snow: T.SNOW, grass: T.GRASS, water: T.WATER, shallow: T.SHALLOW, mud: T.MUD };
const codeOf = (c) => (typeof c === 'number' ? c : CODES[c] ?? T.GROUND);
const pts2 = (P) => P.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]));
/** Smooth maximum (polynomial, radius k): shapes that meet blend with a fillet instead of a crease. */
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k / 4; };
/** Fillet radius (m) where two shapes meet (a river mouth into a lake, a camp polygon cutting a bank). */
const K = 1.6;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Smooth a polyline / polygon. Sharp corners (turn > `sharp` deg) are pre-cut by a chord `cut` m inside the corner; then `iters` rounds of Chaikin corner cutting, each cut at most `maxCut` m from a vertex (a
 * quadratic B-spline in the limit: tangent-continuous, never outside the outline's convex corners, straight sides
 * stay straight; gentle bends of a coarse outline move by centimetres, sharp ones by ~0.5 m); finally collinear
 * runs are thinned (deviation < `tol` m). Points may carry extra coordinates (a width), interpolated linearly.
 * Open curves keep their end points.
 * @param {number[][]} P [[x, z, ...extra]]
 * @returns {number[][]} closed: the first point is not repeated at the end
 */
export function smoothCurve(P, { closed = false, sharp = 32, cut = 0.45, iters = 5, maxCut = 2.5, tol = 0.004 } = {}) {
  const n = P.length;
  if (n < 3) return P.map((p) => p.slice());
  const lerp = (a, b, t) => a.map((v, d) => v + (b[d] - v) * t);
  // 1. pre-cut sharp corners
  let Q = [];
  for (let k = 0; k < n; k++) {
    const p = P[k];
    if (!closed && (k === 0 || k === n - 1)) { Q.push(p.slice()); continue; }
    const a = P[(k - 1 + n) % n], b = P[(k + 1) % n];
    const ix = p[0] - a[0], iz = p[1] - a[1], ox = b[0] - p[0], oz = b[1] - p[1];
    const Li = Math.hypot(ix, iz), Lo = Math.hypot(ox, oz);
    if (Li < 1e-6 || Lo < 1e-6) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (ix * ox + iz * oz) / (Li * Lo)))) * 180 / Math.PI;
    if (turn <= sharp) { Q.push(p.slice()); continue; }
    const r = Math.min(cut / Math.sin((turn * Math.PI) / 360), 0.4 * Li, 0.4 * Lo); // the cut chord passes `cut` m inside the corner
    Q.push(lerp(p, a, r / Li), lerp(p, b, r / Lo));
  }
  // 2. limited Chaikin
  for (let it = 0; it < iters; it++) {
    const m = Q.length, R = [];
    if (!closed) R.push(Q[0]);
    const segs = closed ? m : m - 1;
    for (let s = 0; s < segs; s++) {
      const a = Q[s], b = Q[(s + 1) % m], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const c = Math.min(0.25, maxCut / L);
      if (closed || s > 0) R.push(lerp(a, b, c));
      if (closed || s < segs - 1) R.push(lerp(a, b, 1 - c));
    }
    if (!closed) R.push(Q[m - 1]);
    Q = R;
  }
  // 3. thin collinear runs
  const out = [Q[0]];
  let k0 = 0;
  for (let k = 2; k <= Q.length; k++) {
    const b = k < Q.length ? Q[k] : closed ? Q[0] : null;
    if (!b) break;
    const a = Q[k0], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
    let ok = L < 4;
    for (let q = k0 + 1; ok && q < k; q++) ok = Math.abs((Q[q][0] - a[0]) * dz - (Q[q][1] - a[1]) * dx) / L < tol;
    if (!ok) { out.push(Q[k - 1]); k0 = k - 1; }
  }
  if (!closed) out.push(Q[Q.length - 1]);
  return out;
}

/** A fine lattice over [ox, ox + w] x [oz, oz + d] at `h` m: texel centres at o + (i + 0.5) h. */
function lattice(ox, oz, w, d, h) {
  const nx = Math.max(2, Math.ceil(w / h)), nz = Math.max(2, Math.ceil(d / h));
  return { ox, oz, h, nx, nz, N: nx * nz };
}

/** Texel index range [i0, i1] x [j0, j1] covering the world box, clipped to the lattice (null when empty). */
function span(L, x0, z0, x1, z1) {
  const i0 = Math.max(0, Math.floor((x0 - L.ox) / L.h - 0.5)), i1 = Math.min(L.nx - 1, Math.ceil((x1 - L.ox) / L.h - 0.5));
  const j0 = Math.max(0, Math.floor((z0 - L.oz) / L.h - 0.5)), j1 = Math.min(L.nz - 1, Math.ceil((z1 - L.oz) / L.h - 0.5));
  return i0 > i1 || j0 > j1 ? null : { i0, i1, j0, j1 };
}

/**
 * Field of a path (tapered ribbon; flat ends like grid.fillLine) into F (max-composed; F pre-filled with -M).
 * @param {number[][]} S smoothed samples [[x, z, width]]
 */
function stampPath(L, F, S, M) {
  const last = S.length - 2;
  for (let s = 0; s <= last; s++) {
    const [ax, az, wa] = S[s], [bx, bz, wb] = S[s + 1];
    const ha = wa / 2, hb = wb / 2, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len, r = Math.max(ha, hb) + M;
    const sp = span(L, Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r);
    if (!sp) continue;
    for (let j = sp.j0; j <= sp.j1; j++) {
      const z = L.oz + (j + 0.5) * L.h;
      for (let i = sp.i0; i <= sp.i1; i++) {
        const x = L.ox + (i + 0.5) * L.h, px = x - ax, pz = z - az;
        const along = px * ux + pz * uz, lat = Math.abs(-px * uz + pz * ux);
        let v;
        if (along < 0 && s === 0) v = Math.min(ha - lat, along); // flat start
        else if (along > len && s === last) v = Math.min(hb - lat, len - along); // flat end
        else {
          const t = Math.min(len, Math.max(0, along)), ex = px - ux * t, ez = pz - uz * t;
          v = ha + (hb - ha) * (t / len) - Math.hypot(ex, ez);
        }
        const k = j * L.nx + i;
        if (v > F[k]) F[k] = v;
      }
    }
  }
}

/**
 * Field of a closed outline (signed distance, + inside) into F (pre-filled with -M). Edges flagged `open[k]` (along
 * or outside the map boundary) count for inside / outside but are not shore: no distance to them.
 */
function stampPoly(L, F, S, open, M) {
  const n = S.length;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of S) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const sp = span(L, x0 - M, z0 - M, x1 + M, z1 + M);
  if (!sp) return;
  const bw = sp.i1 - sp.i0 + 1, bh = sp.j1 - sp.j0 + 1, D = new Float32Array(bw * bh).fill(M);
  for (let e = 0; e < n; e++) {
    if (open[e]) continue;
    const [ax, az] = S[e], [bx, bz] = S[(e + 1) % n], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-12;
    const s2 = span(L, Math.min(ax, bx) - M, Math.min(az, bz) - M, Math.max(ax, bx) + M, Math.max(az, bz) + M);
    if (!s2) continue;
    for (let j = s2.j0; j <= s2.j1; j++) {
      const z = L.oz + (j + 0.5) * L.h;
      for (let i = s2.i0; i <= s2.i1; i++) {
        const x = L.ox + (i + 0.5) * L.h, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z), q = (j - sp.j0) * bw + (i - sp.i0);
        if (d < D[q]) D[q] = d;
      }
    }
  }
  // inside: even-odd crossings per texel row
  const xs = [];
  for (let j = sp.j0; j <= sp.j1; j++) {
    const z = L.oz + (j + 0.5) * L.h;
    xs.length = 0;
    for (let e = 0; e < n; e++) {
      const [ax, az] = S[e], [bx, bz] = S[(e + 1) % n];
      if ((az > z) !== (bz > z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    let c = 0;
    for (let i = sp.i0; i <= sp.i1; i++) {
      const x = L.ox + (i + 0.5) * L.h;
      while (c < xs.length && xs[c] < x) c++;
      const d = D[(j - sp.j0) * bw + (i - sp.i0)], v = c & 1 ? d : -d, k = j * L.nx + i;
      if (v > F[k]) F[k] = v;
    }
  }
}

/** Field of a circle into F (pre-filled with -M). */
function stampCircle(L, F, cx, cz, r, M) {
  const sp = span(L, cx - r - M, cz - r - M, cx + r + M, cz + r + M);
  if (!sp) return;
  for (let j = sp.j0; j <= sp.j1; j++) {
    const z = L.oz + (j + 0.5) * L.h;
    for (let i = sp.i0; i <= sp.i1; i++) {
      const v = r - Math.hypot(L.ox + (i + 0.5) * L.h - cx, z - cz), k = j * L.nx + i;
      if (v > F[k]) F[k] = v;
    }
  }
}

/** Exact squared Euclidean distance transform (Felzenszwalb-Huttenlocher), in place on f (0 = site, 1e20 = none). */
function edt2(f, nx, nz) {
  const n = Math.max(nx, nz), v = new Int32Array(n), zb = new Float64Array(n + 1), g = new Float64Array(n), d = new Float64Array(n);
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) g[q] = get(q);
    let k = 0; v[0] = 0; zb[0] = -Infinity; zb[1] = Infinity;
    for (let q = 1; q < len; q++) {
      const sAt = () => ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      let s = sAt();
      while (s <= zb[k]) { k--; s = sAt(); }
      k++; v[k] = q; zb[k] = s; zb[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (zb[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
    for (let q = 0; q < len; q++) set(q, d[q]);
  };
  for (let i = 0; i < nx; i++) pass(nz, (q) => f[q * nx + i], (q, x) => { f[q * nx + i] = x; });
  for (let j = 0; j < nz; j++) pass(nx, (q) => f[j * nx + q], (q, x) => { f[j * nx + q] = x; });
  return f;
}

/** Exact signed distance (m, cell centres, + where `ins[k]`) of a cell mask: ±(distance to the other side − cell/2). */
export function maskSignedDistance(ins, nx, nz, cell) {
  const N = nx * nz, a = new Float64Array(N), b = new Float64Array(N), out = new Float32Array(N);
  for (let k = 0; k < N; k++) { a[k] = ins[k] ? 1e20 : 0; b[k] = ins[k] ? 0 : 1e20; }
  edt2(a, nx, nz); edt2(b, nx, nz);
  for (let k = 0; k < N; k++) out[k] = ins[k] ? Math.min(Math.sqrt(a[k]) * cell, 1e4) - cell / 2 : -(Math.min(Math.sqrt(b[k]) * cell, 1e4) - cell / 2);
  return out;
}

/** Separable box blur (radius r texels), clamped borders, in place. */
function boxBlur(F, nx, nz, r) {
  const tmp = new Float32Array(Math.max(nx, nz));
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) { let s = 0; for (let d = -r; d <= r; d++) s += F[j * nx + Math.min(nx - 1, Math.max(0, i + d))]; tmp[i] = s / (2 * r + 1); }
    for (let i = 0; i < nx; i++) F[j * nx + i] = tmp[i];
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) { let s = 0; for (let d = -r; d <= r; d++) s += F[Math.min(nz - 1, Math.max(0, j + d)) * nx + i]; tmp[j] = s / (2 * r + 1); }
    for (let j = 0; j < nz; j++) F[j * nx + i] = tmp[j];
  }
}

/** Bilinear sampler over a lattice array (clamped). */
function sampler(L, F) {
  const { ox, oz, h, nx, nz } = L;
  return (x, z) => {
    const fx = Math.min(nx - 1, Math.max(0, (x - ox) / h - 0.5)), fz = Math.min(nz - 1, Math.max(0, (z - oz) / h - 0.5));
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, tz = fz - j, k = j * nx + i;
    return (F[k] * (1 - tx) + F[k + 1] * tx) * (1 - tz) + (F[k + nx] * (1 - tx) + F[k + nx + 1] * tx) * tz;
  };
}

/** Smooth value noise in [-1, 1] (world space, seeded). */
function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1; }
function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Bank irregularity (m): ±~0.22 m over ~4-5 m plus ±~0.03 m over ~1.3 m (finer ripples read as facets, not detail). */
export function shoreNoise(x, z, seed = 0) {
  return 0.2 * vnoise(x / 4.3 + 0.37 * z / 4.3, z / 4.3 - 0.37 * x / 4.3, seed + 11) + 0.03 * vnoise(x / 1.3, z / 1.3, seed + 23);
}

/** Mission terrain entries → normalized features [{type, c, ...}] (world coordinates). */
export function shoreFeatures(mission = {}) {
  const out = [];
  for (const f of mission.terrain || []) {
    const c = codeOf(f.terrain);
    if (f.type === 'path' && f.points?.length > 1) out.push({ type: 'path', c, points: pts2(f.points), widths: f.widths, width: f.width ?? 3 });
    else if (f.type === 'poly' && f.points?.length > 2) out.push({ type: 'poly', c, points: pts2(f.points) });
    else if (f.type === 'rect') out.push({ type: 'rect', c, x: f.x, z: f.z, w: f.w, d: f.d });
    else if (f.type === 'circle') out.push({ type: 'circle', c, x: f.x, z: f.z, r: f.r });
  }
  return out;
}

/** Smoothed outline of a closed polygon; runs between map-boundary vertices are smoothed open, boundary edges kept. */
function smoothOutline(P, onEdge) {
  const n = P.length, pinned = P.map(onEdge);
  const first = pinned.indexOf(true);
  if (first < 0) return smoothCurve(P, { closed: true });
  const out = [];
  for (let s = 0; s < n; s++) { // runs start at every pinned vertex
    const a = (first + s) % n;
    if (!pinned[a]) continue;
    let b = (a + 1) % n; const run = [P[a]];
    while (!pinned[b]) { run.push(P[b]); b = (b + 1) % n; }
    run.push(P[b]);
    const S = run.length > 2 ? smoothCurve(run) : run.map((p) => p.slice());
    out.push(...S.slice(0, -1)); // the run's last vertex starts the next run
  }
  return out;
}

/**
 * Build the shore field over a terrain-code grid.
 * @param {{cols:number, rows:number, cell:number, terrain:Uint8Array}} codes code grid (nav grid, or the apron
 *   field's extended grid); its (0, 0) corner is world (o.ox, o.oz)
 * @param {object} mission normalized mission (terrain, baseTerrain, shoreShallowWidth, size)
 * @param {{ox?:number, oz?:number, feats?:object[], W?:number, D?:number, res?:number, margin?:number,
 *   noise?:number, seed?:number, tol?:number}} [o] feats default to the mission's terrain features (the apron passes
 *   its extended set); W x D = the playable map (boundary edges are open water)
 */
export function buildShoreField(codes, mission = {}, o = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { cols, rows, cell, terrain } = codes;
  const ox = o.ox ?? 0, oz = o.oz ?? 0, h = o.res ?? 0.25, M = o.margin ?? 4;
  const W = o.W ?? mission.size?.[0] ?? cols * cell, D = o.D ?? mission.size?.[1] ?? rows * cell;
  const L = lattice(ox, oz, cols * cell, rows * cell, h), N = L.N;
  const base = codeOf(mission.baseTerrain || 'ground');
  const sw = mission.shoreShallowWidth > 0 ? mission.shoreShallowWidth : 0;
  const wet = new Float32Array(N).fill(isWet(base) ? M : -M);
  const deep = new Float32Array(N).fill(base === T.WATER ? M : -M);
  const F = new Float32Array(N);
  const E = 0.25, onEdge = (p) => p[0] <= E || p[1] <= E || p[0] >= W - E || p[1] >= D - E;
  const side = (p) => (p[0] <= E ? 1 : 0) | (p[0] >= W - E ? 2 : 0) | (p[1] <= E ? 4 : 0) | (p[1] >= D - E ? 8 : 0);
  for (const f of o.feats ?? shoreFeatures(mission)) {
    let S = null, bb;
    if (f.type === 'path') {
      const P = f.points, ws = Array.isArray(f.widths) ? f.widths : null;
      S = smoothCurve(P.map((p, k) => [p[0], p[1], ws ? ws[Math.min(k, ws.length - 1)] : f.width ?? 3]), { tol: 0.02 }); // long chords: few, cheap stamps
      const r = Math.max(...S.map((s) => s[2])) / 2 + M;
      bb = [Math.min(...S.map((s) => s[0])) - r, Math.min(...S.map((s) => s[1])) - r, Math.max(...S.map((s) => s[0])) + r, Math.max(...S.map((s) => s[1])) + r];
    } else if (f.type === 'poly' || f.type === 'rect') {
      const P = f.type === 'rect' ? [[f.x, f.z], [f.x + f.w, f.z], [f.x + f.w, f.z + f.d], [f.x, f.z + f.d]] : f.points;
      S = smoothOutline(P, onEdge);
      bb = [Math.min(...S.map((s) => s[0])) - M, Math.min(...S.map((s) => s[1])) - M, Math.max(...S.map((s) => s[0])) + M, Math.max(...S.map((s) => s[1])) + M];
    } else if (f.type === 'circle') bb = [f.x - f.r - M, f.z - f.r - M, f.x + f.r + M, f.z + f.r + M];
    else continue;
    const sp = span(L, ...bb);
    if (!sp) continue;
    for (let j = sp.j0; j <= sp.j1; j++) F.fill(-M, j * L.nx + sp.i0, j * L.nx + sp.i1 + 1);
    if (f.type === 'path') stampPath(L, F, S, M);
    else if (f.type === 'circle') stampCircle(L, F, f.x, f.z, f.r, M);
    else stampPoly(L, F, S, S.map((p, k) => side(p) & side(S[(k + 1) % S.length])), M);
    const wetF = isWet(f.c), deepF = f.c === T.WATER;
    for (let j = sp.j0; j <= sp.j1; j++) for (let i = sp.i0; i <= sp.i1; i++) {
      const k = j * L.nx + i, v = Math.max(-M, Math.min(M, F[k]));
      wet[k] = wetF ? smax(wet[k], v, K) : -smax(-wet[k], v, K);
      deep[k] = deepF ? smax(deep[k], v, K) : -smax(-deep[k], v, K);
    }
  }
  for (let k = 0; k < N; k++) if (wet[k] - sw < deep[k]) deep[k] = wet[k] - sw; // the nav shore rim
  return finishField(L, codes, wet, deep, { M, tol: o.tol ?? 0.4, noise: o.noise ?? 1, seed: o.seed ?? 0, t0 });
}

/** Grid fallback where the cells disagree with the analytic shapes, noise, samplers. */
function finishField(L, codes, wet, deep, { M, tol, noise, seed, t0 }) {
  const { cols, rows, cell, terrain } = codes, NC = cols * rows, N = L.N;
  const sWet = sampler(L, wet), sDeep = sampler(L, deep);
  const foreign = new Uint8Array(NC);
  let nForeign = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, x = L.ox + (i + 0.5) * cell, z = L.oz + (j + 0.5) * cell, c = terrain[k];
    const a = sWet(x, z), d = sDeep(x, z);
    if ((isWet(c) !== a > 0 && Math.abs(a) > tol) || ((c === T.WATER) !== d > 0 && Math.abs(d) > tol + 0.3)) { foreign[k] = 1; nForeign++; }
  }
  if (nForeign) {
    // exact distance of the cell masks, rounded at cell level (no stairs), blended in around the foreign cells
    const sdW = maskSignedDistance(terrain.map((c) => (isWet(c) ? 1 : 0)), cols, rows, cell);
    const sdD = maskSignedDistance(terrain.map((c) => (c === T.WATER ? 1 : 0)), cols, rows, cell);
    boxBlur(sdW, cols, rows, 1); boxBlur(sdW, cols, rows, 1); boxBlur(sdD, cols, rows, 1); boxBlur(sdD, cols, rows, 1);
    const fd = maskSignedDistance(foreign, cols, rows, cell);
    const wc = new Float32Array(NC);
    for (let k = 0; k < NC; k++) wc[k] = 1 - ss(0.75, 2.75, -fd[k]);
    const r = L.h / cell;
    for (let j = 0; j < L.nz; j++) {
      const fz = Math.min(rows - 1, Math.max(0, (j + 0.5) * r - 0.5)), cj = Math.min(rows - 2, Math.floor(fz)), tz = fz - cj;
      for (let i = 0; i < L.nx; i++) {
        const fx = Math.min(cols - 1, Math.max(0, (i + 0.5) * r - 0.5)), ci = Math.min(cols - 2, Math.floor(fx)), tx = fx - ci, q = cj * cols + ci;
        const a = (1 - tx) * (1 - tz), b = tx * (1 - tz), c = (1 - tx) * tz, d = tx * tz;
        const w = wc[q] * a + wc[q + 1] * b + wc[q + cols] * c + wc[q + cols + 1] * d;
        if (w <= 1e-3) continue;
        const gw = sdW[q] * a + sdW[q + 1] * b + sdW[q + cols] * c + sdW[q + cols + 1] * d;
        const gd = sdD[q] * a + sdD[q + 1] * b + sdD[q + cols] * c + sdD[q + cols + 1] * d;
        const k = j * L.nx + i;
        wet[k] += (Math.max(-M, Math.min(M, gw)) - wet[k]) * w;
        deep[k] += (Math.max(-M, Math.min(M, gd)) - deep[k]) * w;
      }
    }
  }
  if (noise) {
    // the noise never pushes a nav cell further across the drawn line: it fades out (smoothly, bilinear over the
    // cells) wherever a cell centre already sits on the wrong side of the noiseless field, e.g. a sharp corner's cut
    const keep = new Float32Array(NC).fill(1);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, x = L.ox + (i + 0.5) * cell, z = L.oz + (j + 0.5) * cell, c = terrain[k];
      const a = sWet(x, z), d = sDeep(x, z);
      const wrong = Math.max(isWet(c) ? -a : a, (c === T.WATER ? -d : d) - 0.3);
      if (wrong > 0.1) keep[k] = 1 - ss(0.1, 0.3, wrong);
    }
    const r = L.h / cell;
    for (let j = 0; j < L.nz; j++) for (let i = 0; i < L.nx; i++) {
      const k = j * L.nx + i, near = Math.min(Math.abs(wet[k]), Math.abs(deep[k]));
      if (near >= 3.5) continue; // the noise fades out 2.5-3.5 m from any shore (no cost far from water)
      const fz = Math.min(rows - 1, Math.max(0, (j + 0.5) * r - 0.5)), cj = Math.min(rows - 2, Math.floor(fz)), tz = fz - cj;
      const fx = Math.min(cols - 1, Math.max(0, (i + 0.5) * r - 0.5)), ci = Math.min(cols - 2, Math.floor(fx)), tx = fx - ci, q = cj * cols + ci;
      const kp = keep[q] * (1 - tx) * (1 - tz) + keep[q + 1] * tx * (1 - tz) + keep[q + cols] * (1 - tx) * tz + keep[q + cols + 1] * tx * tz;
      const n = noise * kp * (1 - ss(2.5, 3.5, near)) * shoreNoise(L.ox + (i + 0.5) * L.h, L.oz + (j + 0.5) * L.h, seed);
      wet[k] += n; deep[k] += n;
    }
  }
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return {
    ox: L.ox, oz: L.oz, res: L.h, nx: L.nx, nz: L.nz, margin: M, wet, deep, foreignCells: nForeign, ms,
    /** Signed distance (m) to the nearest shore: > 0 in water (shallow or deep), < 0 on land; clamped to ±margin. */
    wetAt: sampler(L, wet),
    /** Signed distance (m) to the deep-water edge: > 0 in deep (swimming) water. */
    deepAt: sampler(L, deep),
  };
}
